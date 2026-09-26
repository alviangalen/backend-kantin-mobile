const supabase = require('../config/database');
const jwt = require('jsonwebtoken');
const { sendWhatsAppOtp, formatWhatsAppTarget } = require('../services/whatsappService');

const otpStore = {};

function formatUserProfile(user, isNewUser = false, isProfileComplete = false) {
    const hasValidName = Boolean(
        user.full_name &&
        user.full_name.trim() !== '' &&
        user.full_name !== 'Pengguna Baru' &&
        user.full_name !== 'Pengguna' &&
        user.full_name !== 'User'
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
    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    // Simpan OTP dengan masa berlaku 5 menit
    const expiresAt = Date.now() + 5 * 60000;
    otpStore[cleanPhone] = { otp, expiresAt };
    if (target && target !== cleanPhone) {
        otpStore[target] = { otp, expiresAt };
    }

    // Auto-cleanup setelah 10 menit (unref agar tidak menahan proses)
    const cleanupTimer = setTimeout(() => {
        delete otpStore[cleanPhone];
        if (target) delete otpStore[target];
    }, 10 * 60000);
    if (cleanupTimer.unref) cleanupTimer.unref();

    // Kirim pesan WhatsApp menggunakan Fonnte
    const waResult = await sendWhatsAppOtp(cleanPhone, otp);

    if (!waResult.success) {
        console.error(`[AUTH] Gagal mengirim OTP ke WhatsApp (${cleanPhone}):`, waResult.reason);

        // Jika dalam mode development, log kode di console untuk kemudahan debugging developer
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
    const record = otpStore[cleanPhone] || (target ? otpStore[target] : null);

    if (!record || record.otp !== otp.toString().trim() || record.expiresAt < Date.now()) {
        return res.status(401).json({ status: "error", message: "OTP salah atau kedaluwarsa" });
    }

    try {
        let { data: user, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('phone_number', cleanPhone)
            .maybeSingle();

        if (!user && target && target !== cleanPhone) {
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

            // Masukkan data baru ke profiles tanpa data palsu nama / kelas
            const { data: newUser, error: insertError } = await supabase
                .from('profiles')
                .insert([{ 
                    phone_number: cleanPhone, 
                    full_name: '', // Mengisi string kosong untuk memenuhi constraint NOT NULL tanpa memberikan nama palsu
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
            // Periksa apakah profil pengguna sudah memiliki nama yang valid (bukan placeholder)
            const hasValidName = Boolean(
                user.full_name && 
                user.full_name.trim() !== '' && 
                user.full_name !== 'Pengguna Baru' && 
                user.full_name !== 'Pengguna' && 
                user.full_name !== 'User'
            );

            if (!hasValidName) {
                isNewUser = true;
                isProfileComplete = false;
            } else {
                isNewUser = false;
                isProfileComplete = true;
            }
        }

        delete otpStore[cleanPhone];
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
        if (stand) formattedUser.stand = stand;

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

    // Identifikasi user dari Bearer Token atau dari phoneNumber di body
    let userId = null;
    let userPhone = null;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        try {
            const token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            userId = decoded.id;
        } catch (e) {
            // Token tidak valid atau kedaluwarsa
        }
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
            query = query.eq('phone_number', userPhone);
        }

        const { data: user, error: userError } = await query.maybeSingle();

        if (userError || !user) {
            return res.status(404).json({ status: "error", message: "Profil pengguna tidak ditemukan" });
        }

        // Normalisasi role
        const roleInput = (role || user.role || 'STUDENT').toString().toUpperCase();
        let mappedRole = 'STUDENT';
        if (roleInput === 'PENJUAL' || roleInput === 'SELLER') {
            mappedRole = 'SELLER';
        } else if (roleInput === 'ADMIN') {
            mappedRole = 'ADMIN';
        }

        const chosenClass = (className || studentClass || req.body.class || '').trim() || null;
        const chosenNis = (nis || '').trim() || null;

        // Berikan bonus 5 loyalty poin jika siswa baru pertama kali melengkapi profil
        const bonusPoints = (mappedRole === 'STUDENT' && (user.points || 0) === 0) 
            ? 5 
            : (user.points || 0);

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
        if (standData) formattedUser.stand = standData;

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
        if (user.role === 'SELLER') {
            const { data: userStand } = await supabase
                .from('stands')
                .select('*')
                .eq('owner_id', user.id)
                .maybeSingle();
            stand = userStand;
        }

        const formattedUser = formatUserProfile(user);
        if (stand) formattedUser.stand = stand;

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

        const chosenClass = (className || studentClass || req.body.class || '').trim();
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
        if (stand) formattedUser.stand = stand;

        res.status(200).json({
            status: "success",
            message: "Profil berhasil diperbarui",
            data: formattedUser
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};
