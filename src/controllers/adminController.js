const supabase = require('../config/database');
const { formatWhatsAppTarget } = require('../services/whatsappService');
const { deleteMenuImage } = require('../services/storageService');

function formatStudent(user) {
    if (!user) return null;
    return {
        id: user.id,
        name: user.full_name || null,
        fullName: user.full_name || null,
        phoneNumber: user.phone_number,
        role: user.role,
        nis: user.nis || null,
        className: user.class_name || null,
        studentClass: user.class_name || null,
        points: user.points || 0,
        violationCount: user.violation_count || 0,
        isActive: user.is_active !== undefined ? Boolean(user.is_active) : true,
        createdAt: user.created_at
    };
}

function formatStand(stand) {
    if (!stand) return null;
    return {
        id: stand.id,
        name: stand.name,
        standName: stand.name,
        counterSlot: stand.stand_number,
        counterNumber: stand.stand_number,
        standNumber: stand.stand_number,
        category: stand.category || 'Makanan',
        isOpen: stand.is_open,
        rating: stand.rating || 4.8,
        ownerId: stand.owner_id,
        ownerName: stand.profiles?.full_name || null,
        ownerPhone: stand.profiles?.phone_number || null,
        ownerIsActive: stand.profiles?.is_active !== undefined ? Boolean(stand.profiles?.is_active) : true,
        createdAt: stand.created_at
    };
}

// =============================================================================
// 1. MANAJEMEN SELLER & STAND (SEPAKET & TERINTEGRASI)
// =============================================================================

/**
 * Mendaftarkan Seller sekaligus Stand-nya dalam satu transaksi
 * Endpoint: POST /api/v1/admin/stands & POST /api/v1/admin/sellers
 */
exports.createStandAndSeller = async (req, res) => {
    const { ownerName, standName, phoneNumber, counterSlot, standNumber, category } = req.body;

    const chosenOwner = (ownerName || req.body.name || '').trim();
    const chosenStand = (standName || req.body.stand || '').trim();
    const chosenPhone = (phoneNumber || req.body.phone || '').toString().trim();
    const chosenSlot = (counterSlot || standNumber || req.body.slot || 'Stand 01').trim();
    const chosenCategory = (category || 'Makanan').trim();

    if (!chosenOwner) {
        return res.status(400).json({ status: "error", message: "Nama pemilik stand wajib diisi." });
    }
    if (!chosenStand) {
        return res.status(400).json({ status: "error", message: "Nama stand kantin wajib diisi." });
    }
    if (!chosenPhone) {
        return res.status(400).json({ status: "error", message: "Nomor WhatsApp penjual wajib diisi." });
    }

    try {
        const cleanPhone = chosenPhone.replace(/[^0-9]/g, '');
        const targetPhone = formatWhatsAppTarget(cleanPhone) || cleanPhone;

        // 1. Cek apakah akun penjual sudah terdaftar sebelumnya berdasarkan nomor HP
        const { data: existingUsers } = await supabase
            .from('profiles')
            .select('*')
            .or(`phone_number.eq.${cleanPhone},phone_number.eq.${targetPhone}`)
            .limit(1);

        let sellerUser = existingUsers && existingUsers.length > 0 ? existingUsers[0] : null;

        if (sellerUser) {
            // Update nama & pastikan role adalah SELLER dan akun aktif
            let updatePayload = { full_name: chosenOwner, role: 'SELLER', is_active: true };
            let { data: updatedSeller, error: updateSellerErr } = await supabase
                .from('profiles')
                .update(updatePayload)
                .eq('id', sellerUser.id)
                .select()
                .single();

            if (updateSellerErr && updateSellerErr.message && updateSellerErr.message.includes('is_active')) {
                delete updatePayload.is_active;
                const retry = await supabase.from('profiles').update(updatePayload).eq('id', sellerUser.id).select().single();
                updatedSeller = retry.data;
                updateSellerErr = null;
            }

            if (!updateSellerErr && updatedSeller) {
                sellerUser = updatedSeller;
            }
        } else {
            // Buat akun profile penjual baru
            let insertPayload = {
                phone_number: cleanPhone,
                full_name: chosenOwner,
                role: 'SELLER',
                points: 0,
                is_active: true
            };
            let { data: newSeller, error: createSellerErr } = await supabase
                .from('profiles')
                .insert([insertPayload])
                .select()
                .single();

            if (createSellerErr && createSellerErr.message && createSellerErr.message.includes('is_active')) {
                delete insertPayload.is_active;
                const retry = await supabase.from('profiles').insert([insertPayload]).select().single();
                newSeller = retry.data;
                createSellerErr = retry.error;
            }

            if (createSellerErr) throw createSellerErr;
            sellerUser = newSeller;
        }

        // 2. Buat Stand baru dan kaitkan dengan akun penjual (owner_id)
        const { data: newStand, error: createStandErr } = await supabase
            .from('stands')
            .insert([{
                owner_id: sellerUser.id,
                name: chosenStand,
                stand_number: chosenSlot,
                category: chosenCategory,
                is_open: true
            }])
            .select('*, profiles:owner_id(*)')
            .single();

        if (createStandErr) throw createStandErr;

        res.status(201).json({
            status: "success",
            message: `Stand '${chosenStand}' dan akun penjual '${chosenOwner}' berhasil didaftarkan!`,
            data: formatStand(newStand)
        });

    } catch (err) {
        console.error('[ADMIN] Gagal mendaftarkan stand & seller:', err.message);
        res.status(500).json({ status: "error", message: err.message });
    }
};

/**
 * Mendapatkan seluruh daftar Stand beserta informasi pemilik dan menu
 * Endpoint: GET /api/v1/admin/stands
 */
exports.getAllStands = async (req, res) => {
    try {
        const { data: stands, error } = await supabase
            .from('stands')
            .select('*, profiles:owner_id(*), menus(id)')
            .order('name', { ascending: true });

        if (error) throw error;

        // Ambil pemasukan hari ini untuk setiap stand
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

        const { data: completedOrders } = await supabase
            .from('orders')
            .select('stand_id, total_amount')
            .eq('status', 'COMPLETED')
            .gte('created_at', startOfToday);

        const revenueMap = {};
        if (completedOrders) {
            for (const ord of completedOrders) {
                revenueMap[ord.stand_id] = (revenueMap[ord.stand_id] || 0) + (ord.total_amount || 0);
            }
        }

        const formatted = (stands || []).map(s => {
            const item = formatStand(s);
            item.menuCount = s.menus ? s.menus.length : 0;
            item.todayRevenue = revenueMap[s.id] || 0;
            return item;
        });

        res.status(200).json({
            status: "success",
            data: formatted
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

/**
 * Mendapatkan detail Stand tertentu
 * Endpoint: GET /api/v1/admin/stands/:standId
 */
exports.getStandDetail = async (req, res) => {
    const { standId } = req.params;

    try {
        const { data: stand, error } = await supabase
            .from('stands')
            .select('*, profiles:owner_id(*), menus(*)')
            .eq('id', standId)
            .maybeSingle();

        if (error || !stand) {
            return res.status(404).json({ status: "error", message: "Stand tidak ditemukan." });
        }

        res.status(200).json({
            status: "success",
            data: {
                ...formatStand(stand),
                menus: stand.menus || []
            }
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

/**
 * Memperbarui data stand (nama, slot, kategori, status buka)
 * Endpoint: PATCH /api/v1/admin/stands/:standId
 */
exports.updateStand = async (req, res) => {
    const { standId } = req.params;
    const { name, standName, counterSlot, standNumber, category, isOpen, is_open, ownerId } = req.body;

    try {
        const updateData = {};
        const chosenName = (name || standName || '').trim();
        if (chosenName) updateData.name = chosenName;

        const chosenSlot = (counterSlot || standNumber || '').trim();
        if (chosenSlot) updateData.stand_number = chosenSlot;

        if (category !== undefined) updateData.category = category.trim();

        const openState = isOpen !== undefined ? isOpen : is_open;
        if (openState !== undefined) updateData.is_open = Boolean(openState);

        if (ownerId) updateData.owner_id = ownerId;

        const { data: updatedStand, error } = await supabase
            .from('stands')
            .update(updateData)
            .eq('id', standId)
            .select('*, profiles:owner_id(*)')
            .single();

        if (error || !updatedStand) {
            return res.status(404).json({ status: "error", message: "Stand tidak ditemukan." });
        }

        res.status(200).json({
            status: "success",
            message: "Data stand berhasil diperbarui",
            data: formatStand(updatedStand)
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

/**
 * Menghapus Stand (Akun seller tetap tersimpan di profiles)
 * Endpoint: DELETE /api/v1/admin/stands/:standId
 */
exports.deleteStand = async (req, res) => {
    const { standId } = req.params;

    try {
        // 1. Ambil menu-menu untuk menghapus foto dari storage
        const { data: menus } = await supabase
            .from('menus')
            .select('image_url')
            .eq('stand_id', standId);

        if (menus && menus.length > 0) {
            for (const m of menus) {
                if (m.image_url) await deleteMenuImage(m.image_url);
            }
        }

        // 2. Hapus menu milik stand ini
        await supabase.from('menus').delete().eq('stand_id', standId);

        // 3. Hapus stand (Akun seller di profiles TIDAK dihapus)
        const { error: delStandErr } = await supabase
            .from('stands')
            .delete()
            .eq('id', standId);

        if (delStandErr) throw delStandErr;

        res.status(200).json({
            status: "success",
            message: "Stand dan menunya berhasil dihapus. Akun penjual tetap tersimpan."
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

/**
 * Mendapatkan seluruh daftar Akun Penjual (Seller) beserta stan miliknya
 * Endpoint: GET /api/v1/admin/sellers
 */
exports.getAllSellers = async (req, res) => {
    try {
        const { data: sellers, error } = await supabase
            .from('profiles')
            .select('*, stands(id, name, stand_number, category, is_open)')
            .eq('role', 'SELLER')
            .order('full_name', { ascending: true });

        if (error) throw error;

        const formatted = (sellers || []).map(s => ({
            id: s.id,
            name: s.full_name,
            fullName: s.full_name,
            phoneNumber: s.phone_number,
            role: s.role,
            isActive: s.is_active !== undefined ? Boolean(s.is_active) : true,
            createdAt: s.created_at,
            stand: s.stands && s.stands.length > 0 ? {
                id: s.stands[0].id,
                name: s.stands[0].name,
                standNumber: s.stands[0].stand_number,
                category: s.stands[0].category,
                isOpen: s.stands[0].is_open
            } : null
        }));

        res.status(200).json({
            status: "success",
            data: formatted
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

/**
 * Menghapus akun Seller beserta stand yang dimilikinya
 * Endpoint: DELETE /api/v1/admin/sellers/:sellerId
 */
exports.deleteSeller = async (req, res) => {
    const { sellerId } = req.params;

    try {
        // 1. Cari stand milik seller jika ada
        const { data: stands } = await supabase
            .from('stands')
            .select('id')
            .eq('owner_id', sellerId);

        if (stands && stands.length > 0) {
            for (const st of stands) {
                // Hapus foto menu
                const { data: menus } = await supabase.from('menus').select('image_url').eq('stand_id', st.id);
                if (menus) {
                    for (const m of menus) {
                        if (m.image_url) await deleteMenuImage(m.image_url);
                    }
                }
                await supabase.from('menus').delete().eq('stand_id', st.id);
                await supabase.from('stands').delete().eq('id', st.id);
            }
        }

        // 2. Hapus profile seller
        const { error: delUserErr } = await supabase
            .from('profiles')
            .delete()
            .eq('id', sellerId);

        if (delUserErr) throw delUserErr;

        res.status(200).json({
            status: "success",
            message: "Akun penjual beserta stan miliknya berhasil dihapus dari sistem."
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

// =============================================================================
// 2. REKAPITULASI PEMASUKAN & KEUANGAN KANTIN (REVENUE)
// =============================================================================

/**
 * Total pemasukan keseluruhan kantin dan rincian per stand
 * Endpoint: GET /api/v1/admin/revenue
 */
exports.getRevenueAnalytics = async (req, res) => {
    const { startDate, endDate, period } = req.query;

    try {
        // Ambil semua stand
        const { data: stands, error: standErr } = await supabase
            .from('stands')
            .select('id, name, stand_number, profiles:owner_id(full_name)');

        if (standErr) throw standErr;

        // Query transaksi COMPLETED
        let query = supabase
            .from('orders')
            .select('id, stand_id, total_amount, payment_method, created_at')
            .eq('status', 'COMPLETED');

        if (startDate) query = query.gte('created_at', startDate);
        if (endDate) query = query.lte('created_at', endDate);

        if (!startDate && !endDate && period === 'today') {
            const now = new Date();
            const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
            query = query.gte('created_at', startOfToday);
        }

        const { data: orders, error: orderErr } = await query;
        if (orderErr) throw orderErr;

        const allOrders = orders || [];
        let grossIncome = 0;
        const standRevenueMap = {};

        for (const ord of allOrders) {
            const amount = ord.total_amount || 0;
            grossIncome += amount;
            if (!standRevenueMap[ord.stand_id]) {
                standRevenueMap[ord.stand_id] = { grossIncome: 0, totalOrders: 0 };
            }
            standRevenueMap[ord.stand_id].grossIncome += amount;
            standRevenueMap[ord.stand_id].totalOrders += 1;
        }

        // Biaya koperasi (contoh 5% dari pendapatan kotor)
        const koperasiFee = Math.round(grossIncome * 0.05);
        const netIncome = Math.max(0, grossIncome - koperasiFee);

        const standsRevenue = (stands || []).map(s => {
            const rev = standRevenueMap[s.id] || { grossIncome: 0, totalOrders: 0 };
            const progress = grossIncome > 0 ? (rev.grossIncome / grossIncome) : 0;
            return {
                standId: s.id,
                standName: s.name,
                ownerName: s.profiles?.full_name || 'Penjual',
                counterSlot: s.stand_number,
                grossIncome: rev.grossIncome,
                totalOrders: rev.totalOrders,
                progress: parseFloat(progress.toFixed(2))
            };
        }).sort((a, b) => b.grossIncome - a.grossIncome);

        res.status(200).json({
            status: "success",
            data: {
                grossIncome,
                netIncome,
                koperasiFee,
                totalOrders: allOrders.length,
                standsRevenue
            }
        });

    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

/**
 * Rincian pemasukan stand tertentu (QRIS, Tunai, Siap Cair)
 * Endpoint: GET /api/v1/admin/revenue/:standId
 */
exports.getStandRevenueDetail = async (req, res) => {
    const { standId } = req.params;

    try {
        const { data: stand, error: standErr } = await supabase
            .from('stands')
            .select('id, name, stand_number, profiles:owner_id(full_name, phone_number)')
            .eq('id', standId)
            .maybeSingle();

        if (standErr || !stand) {
            return res.status(404).json({ status: "error", message: "Stand tidak ditemukan." });
        }

        const { data: orders, error: orderErr } = await supabase
            .from('orders')
            .select('id, total_amount, payment_method, created_at')
            .eq('stand_id', standId)
            .eq('status', 'COMPLETED');

        if (orderErr) throw orderErr;

        let qrisBalance = 0;
        let cashBalance = 0;
        let grossIncome = 0;

        for (const o of (orders || [])) {
            const amount = o.total_amount || 0;
            grossIncome += amount;
            if (o.payment_method === 'QRIS') {
                qrisBalance += amount;
            } else {
                cashBalance += amount;
            }
        }

        res.status(200).json({
            status: "success",
            data: {
                standId: stand.id,
                standName: stand.name,
                ownerName: stand.profiles?.full_name || null,
                ownerPhone: stand.profiles?.phone_number || null,
                accountNumber: stand.stand_number || 'Slot 01',
                qrisBalance,
                cashBalance,
                readyToPayout: qrisBalance,
                grossIncome,
                totalOrders: (orders || []).length
            }
        });

    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

// =============================================================================
// 3. MANAJEMEN SISWA (CRUD, KELAS, & SUSPEND STATUS)
// =============================================================================

/**
 * Mendapatkan seluruh daftar Siswa (bisa filter kelas, pencarian, dan status aktif)
 * Endpoint: GET /api/v1/admin/students
 */
exports.getAllStudents = async (req, res) => {
    const { search, className, studentClass, status } = req.query;

    try {
        let query = supabase
            .from('profiles')
            .select('*')
            .eq('role', 'STUDENT')
            .order('full_name', { ascending: true });

        const targetClass = className || studentClass;
        if (targetClass) {
            query = query.eq('class_name', targetClass.trim());
        }

        if (status === 'active') {
            query = query.eq('is_active', true);
        } else if (status === 'suspended') {
            query = query.eq('is_active', false);
        }

        const { data: students, error } = await query;
        if (error) throw error;

        let filtered = students || [];
        if (search && search.trim() !== '') {
            const q = search.trim().toLowerCase();
            filtered = filtered.filter(s =>
                (s.full_name && s.full_name.toLowerCase().includes(q)) ||
                (s.phone_number && s.phone_number.includes(q)) ||
                (s.nis && s.nis.toLowerCase().includes(q))
            );
        }

        res.status(200).json({
            status: "success",
            data: filtered.map(formatStudent)
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

/**
 * Mendapatkan detail satu siswa
 * Endpoint: GET /api/v1/admin/students/:studentId
 */
exports.getStudentDetail = async (req, res) => {
    const { studentId } = req.params;

    try {
        const { data: student, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', studentId)
            .maybeSingle();

        if (error || !student) {
            return res.status(404).json({ status: "error", message: "Siswa tidak ditemukan." });
        }

        // Ambil riwayat pesanan siswa
        const { data: orders } = await supabase
            .from('orders')
            .select('id, order_number, total_amount, payment_method, status, created_at, stands(name)')
            .eq('student_id', studentId)
            .order('created_at', { ascending: false })
            .limit(10);

        res.status(200).json({
            status: "success",
            data: {
                ...formatStudent(student),
                recentOrders: orders || []
            }
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

/**
 * Admin membuat akun siswa baru secara manual
 * Endpoint: POST /api/v1/admin/students
 */
exports.createStudent = async (req, res) => {
    const { name, fullName, phoneNumber, nis, className, studentClass, points } = req.body;

    const chosenName = (fullName || name || '').trim();
    const chosenPhone = (phoneNumber || '').toString().trim();
    const chosenClass = (className || studentClass || '').trim() || null;
    const chosenNis = (nis || '').trim() || null;

    if (!chosenName) {
        return res.status(400).json({ status: "error", message: "Nama lengkap siswa wajib diisi." });
    }
    if (!chosenPhone) {
        return res.status(400).json({ status: "error", message: "Nomor HP siswa wajib diisi." });
    }

    try {
        const cleanPhone = chosenPhone.replace(/[^0-9]/g, '');

        let studentPayload = {
            phone_number: cleanPhone,
            full_name: chosenName,
            role: 'STUDENT',
            nis: chosenNis,
            class_name: chosenClass,
            points: parseInt(points, 10) || 0,
            violation_count: 0,
            is_active: true
        };
        let { data: newStudent, error } = await supabase
            .from('profiles')
            .insert([studentPayload])
            .select()
            .single();

        if (error && error.message && error.message.includes('is_active')) {
            delete studentPayload.is_active;
            const retry = await supabase.from('profiles').insert([studentPayload]).select().single();
            newStudent = retry.data;
            error = retry.error;
        }

        if (error) throw error;

        res.status(201).json({
            status: "success",
            message: "Akun siswa berhasil dibuat oleh admin",
            data: formatStudent(newStudent)
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

/**
 * Admin memperbarui data siswa
 * Endpoint: PATCH /api/v1/admin/students/:studentId
 */
exports.updateStudent = async (req, res) => {
    const { studentId } = req.params;
    const { name, fullName, phoneNumber, nis, className, studentClass, points, violationCount } = req.body;

    try {
        const updateData = {};
        const chosenName = (fullName || name || '').trim();
        if (chosenName) updateData.full_name = chosenName;

        if (phoneNumber) updateData.phone_number = phoneNumber.toString().replace(/[^0-9]/g, '');
        if (nis !== undefined) updateData.nis = (nis || '').trim() || null;

        const chosenClass = (className || studentClass || '').trim();
        if (chosenClass) updateData.class_name = chosenClass;

        if (points !== undefined) updateData.points = parseInt(points, 10);
        if (violationCount !== undefined) updateData.violation_count = parseInt(violationCount, 10);

        const { data: updated, error } = await supabase
            .from('profiles')
            .update(updateData)
            .eq('id', studentId)
            .select()
            .single();

        if (error || !updated) {
            return res.status(404).json({ status: "error", message: "Siswa tidak ditemukan." });
        }

        res.status(200).json({
            status: "success",
            message: "Data siswa berhasil diperbarui",
            data: formatStudent(updated)
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

/**
 * Suspend atau aktifkan akun siswa
 * Endpoint: PATCH /api/v1/admin/students/:studentId/status
 */
exports.toggleStudentStatus = async (req, res) => {
    const { studentId } = req.params;
    const { isActive, is_active } = req.body;

    const targetState = isActive !== undefined ? isActive : is_active;
    if (targetState === undefined) {
        return res.status(400).json({ status: "error", message: "Field 'isActive' (true/false) wajib disertakan." });
    }

    try {
        const { data: updated, error } = await supabase
            .from('profiles')
            .update({ is_active: Boolean(targetState) })
            .eq('id', studentId)
            .select()
            .single();

        if (error) {
            if (error.message && error.message.includes('is_active')) {
                return res.status(500).json({
                    status: "error",
                    message: "Kolom 'is_active' belum dibuat di database Supabase. Jalankan query: ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;"
                });
            }
            throw error;
        }

        if (!updated) {
            return res.status(404).json({ status: "error", message: "Siswa tidak ditemukan." });
        }

        const msg = Boolean(targetState) 
            ? `Akun siswa '${updated.full_name}' berhasil diaktifkan kembali.`
            : `Akun siswa '${updated.full_name}' berhasil disuspend (dinonaktifkan).`;

        res.status(200).json({
            status: "success",
            message: msg,
            data: formatStudent(updated)
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

/**
 * Menghapus akun siswa
 * Endpoint: DELETE /api/v1/admin/students/:studentId
 */
exports.deleteStudent = async (req, res) => {
    const { studentId } = req.params;

    try {
        const { error } = await supabase
            .from('profiles')
            .delete()
            .eq('id', studentId);

        if (error) throw error;

        res.status(200).json({
            status: "success",
            message: "Akun siswa berhasil dihapus dari sistem."
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

/**
 * Mendapatkan daftar seluruh Kelas dan jumlah siswa di setiap kelas
 * Endpoint: GET /api/v1/admin/classes
 */
exports.getClasses = async (req, res) => {
    try {
        const { data: students, error } = await supabase
            .from('profiles')
            .select('class_name')
            .eq('role', 'STUDENT')
            .not('class_name', 'is', null);

        if (error) throw error;

        const classMap = {};
        for (const s of (students || [])) {
            const cls = (s.class_name || '').trim();
            if (cls) {
                classMap[cls] = (classMap[cls] || 0) + 1;
            }
        }

        const classes = Object.keys(classMap).sort().map(className => ({
            className,
            studentCount: classMap[className]
        }));

        res.status(200).json({
            status: "success",
            data: classes
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

// =============================================================================
// 4. PELANGGARAN SISWA (VIOLATIONS)
// =============================================================================

/**
 * Mendapatkan daftar pelanggaran siswa
 * Endpoint: GET /api/v1/admin/violations
 */
exports.getViolations = async (req, res) => {
    try {
        const { data: students, error } = await supabase
            .from('profiles')
            .select('id, full_name, class_name, violation_count, phone_number')
            .eq('role', 'STUDENT')
            .gt('violation_count', 0)
            .order('violation_count', { ascending: false });

        if (error) throw error;

        const formatted = (students || []).map(s => ({
            id: s.id,
            userId: s.id,
            studentName: s.full_name || 'Siswa',
            studentClass: s.class_name || '-',
            amount: s.violation_count,
            note: `Total ${s.violation_count} kali pelanggaran kantin`,
            createdAt: new Date().toISOString()
        }));

        res.status(200).json({
            status: "success",
            data: formatted
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

/**
 * Menambahkan sanksi poin pelanggaran ke siswa
 * Endpoint: POST /api/v1/admin/violations/:userId
 */
exports.addViolation = async (req, res) => {
    const { userId } = req.params;
    const { points } = req.body;

    try {
        const { data: student, error: fetchErr } = await supabase
            .from('profiles')
            .select('violation_count')
            .eq('id', userId)
            .maybeSingle();

        if (fetchErr || !student) {
            return res.status(404).json({ status: "error", message: "Siswa tidak ditemukan." });
        }

        const additionalPoints = parseInt(points, 10) || 1;
        const newCount = (student.violation_count || 0) + additionalPoints;

        const { data: updated, error: updateErr } = await supabase
            .from('profiles')
            .update({ violation_count: newCount })
            .eq('id', userId)
            .select()
            .single();

        if (updateErr) throw updateErr;

        res.status(200).json({
            status: "success",
            message: `Pelanggaran berhasil ditambahkan (+ ${additionalPoints}). Total pelanggaran: ${newCount}`,
            data: formatStudent(updated)
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};
