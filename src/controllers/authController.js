const supabase = require('../config/database');
const jwt = require('jsonwebtoken');
const { sendWhatsAppOtp, formatWhatsAppTarget } = require('../services/whatsappService');

const otpStore = {};

function getPhoneVariants(phone) {
    if (!phone) return [];
    const str = phone.toString().trim().replace(/[^0-9]/g, '');
    let core = str;
    if (core.startsWith('62')) {
        core = core.slice(2);
    } else if (core.startsWith('0')) {
        core = core.slice(1);
    }
    const variants = new Set([
        str,
        core,
        '0' + core,
        '62' + core,
        '+62' + core
    ]);
    return Array.from(variants).filter(Boolean);
}

function formatUserProfile(user, isNewUser = false, isProfileComplete = false) {
    const hasValidName = Boolean(
        user.full_name &&
        user.full_name.trim() !== '' &&
        user.full_name !== 'Pengguna Baru' &&
        user.full_name !== 'Pengguna' &&
        user.full_name !== 'User' && user.full_name.toUpperCase() !== 'EMPTY'
    );

    const complete = isProfileComplete || (hasValidName && !isNewUser);

    return {
        id: user.id,
        phoneNumber: user.phone_number,
        fullName: complete ? user.full_name : null,
        name: complete ? user.full_name : null,
        role: user.role,
        studentClass: complete ? (user.class_name || null) : null,
        className: complete ? (user.class_name || null) : null,
        nis: user.nis || null,
        points: user.points || 0,
        violationCount: user.violation_count || 0,
        isNewUser: !complete,
        isProfileComplete: complete
    };
}

exports.requestOtp = async (req, res) => {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
        return res.status(400).json({ status: "error", message: "Nomor HP wajib diisi" });
    }

    const cleanPhone = phoneNumber.toString().trim();
    const target = formatWhatsAppTarget(cleanPhone);
    const variants = getPhoneVariants(cleanPhone);
    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    // Simpan OTP untuk semua variasi nomor telepon
    const expiresAt = Date.now() + 5 * 60000;
    for (const v of variants) {
        otpStore[v] = { otp, expiresAt };
    }
    if (target) otpStore[target] = { otp, expiresAt };

    // Auto-cleanup setelah 10 menit
    const cleanupTimer = setTimeout(() => {
        for (const v of variants) {
            delete otpStore[v];
        }
        if (target) delete otpStore[target];
    }, 10 * 60000);
    if (cleanupTimer.unref) cleanupTimer.unref();

    // Kirim pesan WhatsApp menggunakan Fonnte
    const waResult = await sendWhatsAppOtp(cleanPhone, otp);

    if (!waResult.success) {
        console.error(`[AUTH] Gagal mengirim OTP ke WhatsApp (${cleanPhone}):`, waResult.reason);

        if (process.env.NODE_ENV === 'development') {
            console.log(`[DEV MODE] Kode OTP cadangan untuk ${cleanPhone} adalah: ${otp}`);
        }

        return res.status(500).json({
            status: "error",
            message: `Gagal mengirim kode OTP ke WhatsApp: ${waResult.reason}`
        });
    }

    console.log(`[AUTH] Kode OTP berhasil dikirim via WhatsApp ke ${cleanPhone}`);

    return res.status(200).json({
        status: "success",
        message: "Kode OTP telah dikirim ke WhatsApp Anda"
    });
};

exports.verifyOtp = async (req, res) => {
    const { phoneNumber, otp } = req.body;

    if (!phoneNumber || !otp) {
        return res.status(400).json({ status: "error", message: "Nomor HP dan kode OTP wajib diisi" });
    }

    const cleanPhone = phoneNumber.toString().trim();
    const target = formatWhatsAppTarget(cleanPhone);
    const variants = getPhoneVariants(cleanPhone);

    let record = null;
    for (const v of variants) {
        if (otpStore[v]) {
            record = otpStore[v];
            break;
        }
    }
    if (!record && target && otpStore[target]) {
        record = otpStore[target];
    }

    if (!record || record.otp !== otp.toString().trim() || record.expiresAt < Date.now()) {
        return res.status(401).json({ status: "error", message: "OTP salah atau kedaluwarsa" });
    }

    try {
        // Cari user dengan pencarian multi-varian nomor HP
        let { data: users } = await supabase
            .from('profiles')
            .select('*')
            .in('phone_number', variants)
            .limit(1);

        let user = users && users.length > 0 ? users[0] : null;

        if (!user && target) {
            const { data: userByTarget } = await supabase
                .from('profiles')
                .select('*')
                .eq('phone_number', target)
                .maybeSingle();
            if (userByTarget) user = userByTarget;
        }

        let isNewUser = false;
        let isProfileComplete = false;

        if (!user) {
            isNewUser = true;
            isProfileComplete = false;

            const { data: newUser, error: insertError } = await supabase
                .from('profiles')
                .insert([{ 
                    phone_number: cleanPhone, 
                    full_name: '', 
                    role: 'STUDENT',
                    class_name: null,
                    nis: null,
                    points: 0
                }])
                .select()
                .single();

            if (insertError) throw insertError;
            user = newUser;
        } else {
            const hasValidName = Boolean(
                user.full_name && 
                user.full_name.trim() !== '' && 
                user.full_name !== 'Pengguna Baru' && 
                user.full_name !== 'Pengguna' && 
                user.full_name !== 'User' && user.full_name.toUpperCase() !== 'EMPTY'
            );

            if (!hasValidName) {
                isNewUser = true;
                isProfileComplete = false;
            } else {
                isNewUser = false;
                isProfileComplete = true;
            }
        }

        for (const v of variants) {
            delete otpStore[v];
        }
        if (target) delete otpStore[target];

        const token = jwt.sign(
            { id: user.id, role: user.role, phone_number: user.phone_number },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        let stand = null;
        if (user.role === 'SELLER') {
            const { data: userStand } = await supabase
                .from('stands')
                .select('*')
                .eq('owner_id', user.id)
                .maybeSingle();
            stand = userStand;
        }

        const formattedUser = formatUserProfile(user, isNewUser, isProfileComplete);
        if (stand) {
            formattedUser.stand = {
                id: stand.id,
                name: stand.name,
                ownerName: stand.owner_name || user.full_name || null,
                counterSlot: stand.stand_number,
                counterNumber: stand.stand_number,
                category: stand.category,
                isOpen: stand.is_open,
                rating: 4.8
            };
        }

        res.status(200).json({
            status: "success",
            message: isProfileComplete 
                ? "Verifikasi berhasil" 
                : "Nomor baru terverifikasi, silakan lengkapi profil",
            data: {
                token,
                isNewUser,
                isProfileComplete,
                user: formattedUser
            }
        });

    } catch (err) {
        res.status(500).json({ status: "error", message: "Terjadi kesalahan server", error: err.message });
    }
};

exports.register = async (req, res) => {
    const { name, fullName, role, nis, className, studentClass, standName } = req.body;

    const chosenName = (name || fullName || '').trim();
    if (!chosenName) {
        return res.status(400).json({ status: "error", message: "Nama lengkap wajib diisi" });
    }

    let userId = null;
    let userPhone = null;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        try {
            const token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            userId = decoded.id;
        } catch (e) {}
    }

    if (!userId && req.body.phoneNumber) {
        userPhone = req.body.phoneNumber.toString().trim();
    }

    if (!userId && !userPhone) {
        return res.status(401).json({
            status: "error",
            message: "Akses ditolak. Sesi login tidak ditemukan atau nomor HP tidak disertakan."
        });
    }

    try {
        let query = supabase.from('profiles').select('*');
        if (userId) {
            query = query.eq('id', userId);
        } else {
            const variants = getPhoneVariants(userPhone);
            query = query.in('phone_number', variants);
        }

        const { data: user, error: userError } = await query.maybeSingle();

        if (userError || !user) {
            return res.status(404).json({ status: "error", message: "Profil pengguna tidak ditemukan" });
        }

        const roleInput = (role || user.role || 'STUDENT').toString().toUpperCase();
        let mappedRole = 'STUDENT';
        if (roleInput === 'PENJUAL' || roleInput === 'SELLER') {
            mappedRole = 'SELLER';
        } else if (roleInput === 'ADMIN') {
            mappedRole = 'ADMIN';
        }

        const chosenClass = (className || studentClass || req.body.class || req.body.class_name || req.body.className || req.body.studentClass || '').trim() || null;
        const chosenNis = (nis || '').trim() || null;

        const bonusPoints = user.points || 0;

        const updatePayload = {
            full_name: chosenName,
            role: mappedRole,
            class_name: chosenClass,
            nis: chosenNis,
            points: bonusPoints
        };

        const { data: updatedUser, error: updateError } = await supabase
            .from('profiles')
            .update(updatePayload)
            .eq('id', user.id)
            .select()
            .single();

        if (updateError) throw updateError;

        let standData = null;
        if (mappedRole === 'SELLER' && standName) {
            const { data: existingStand } = await supabase
                .from('stands')
                .select('*')
                .eq('owner_id', user.id)
                .maybeSingle();

            if (!existingStand) {
                const { data: newStand, error: standError } = await supabase
                    .from('stands')
                    .insert([{
                        owner_id: user.id,
                        name: standName.trim(),
                        stand_number: req.body.counterSlot || 'Stand 01',
                        category: req.body.category || 'Makanan',
                        is_open: true
                    }])
                    .select()
                    .single();

                if (!standError) standData = newStand;
            } else {
                standData = existingStand;
            }
        }

        const token = jwt.sign(
            { id: updatedUser.id, role: updatedUser.role, phone_number: updatedUser.phone_number },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        const formattedUser = formatUserProfile(updatedUser, false, true);
        if (standData) {
            formattedUser.stand = {
                id: standData.id,
                name: standData.name,
                ownerName: standData.owner_name || updatedUser.full_name || null,
                counterSlot: standData.stand_number,
                counterNumber: standData.stand_number,
                category: standData.category,
                isOpen: standData.is_open,
                rating: 4.8
            };
        }

        res.status(200).json({
            status: "success",
            message: "Pendaftaran profil berhasil",
            data: {
                token,
                user: formattedUser,
                ...formattedUser
            }
        });

    } catch (err) {
        res.status(500).json({ status: "error", message: "Gagal melengkapi profil", error: err.message });
    }
};

exports.getMe = async (req, res) => {
    try {
        const { data: user, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', req.user.id)
            .single();

        if (error || !user) {
            return res.status(404).json({ status: "error", message: "Pengguna tidak ditemukan" });
        }

        let stand = null;
        let todayIncome = 0;
        let completedOrders = 0;

        if (user.role === 'SELLER') {
            const { data: userStand } = await supabase
                .from('stands')
                .select('*')
                .eq('owner_id', user.id)
                .maybeSingle();
            stand = userStand;

            if (stand) {
                const now = new Date();
                const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

                const { data: orders } = await supabase
                    .from('orders')
                    .select('total_amount')
                    .eq('stand_id', stand.id)
                    .eq('status', 'COMPLETED')
                    .gte('created_at', startOfToday);

                if (orders) {
                    todayIncome = orders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
                    completedOrders = orders.length;
                }
            }
        }

        const formattedUser = formatUserProfile(user);
        if (stand) {
            formattedUser.stand = {
                id: stand.id,
                name: stand.name,
                standName: stand.name,
                ownerName: stand.owner_name || user.full_name || null,
                counterSlot: stand.stand_number,
                counterNumber: stand.stand_number,
                standNumber: stand.stand_number,
                category: stand.category,
                isOpen: stand.is_open,
                rating: 4.8
            };
            formattedUser.todayIncome = todayIncome;
            formattedUser.todayRevenue = todayIncome;
            formattedUser.completedOrders = completedOrders;
        }

        res.status(200).json({
            status: "success",
            data: formattedUser
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

exports.updateMe = async (req, res) => {
    const { name, fullName, className, studentClass, nis } = req.body;

    try {
        const updatePayload = {};
        const chosenName = (name || fullName || '').trim();
        if (chosenName) updatePayload.full_name = chosenName;

        const chosenClass = (className || studentClass || req.body.class || req.body.class_name || req.body.className || req.body.studentClass || '').trim();
        if (chosenClass) updatePayload.class_name = chosenClass;

        if (nis !== undefined) updatePayload.nis = (nis || '').trim() || null;

        const { data: updatedUser, error } = await supabase
            .from('profiles')
            .update(updatePayload)
            .eq('id', req.user.id)
            .select()
            .single();

        if (error) throw error;

        let stand = null;
        if (updatedUser.role === 'SELLER') {
            const { data: userStand } = await supabase
                .from('stands')
                .select('*')
                .eq('owner_id', updatedUser.id)
                .maybeSingle();
            stand = userStand;
        }

        const formattedUser = formatUserProfile(updatedUser);
        if (stand) {
            formattedUser.stand = {
                id: stand.id,
                name: stand.name,
                ownerName: stand.owner_name || updatedUser.full_name || null,
                counterSlot: stand.stand_number,
                counterNumber: stand.stand_number,
                category: stand.category,
                isOpen: stand.is_open,
                rating: 4.8
            };
        }

        res.status(200).json({
            status: "success",
            message: "Profil berhasil diperbarui",
            data: formattedUser
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};
