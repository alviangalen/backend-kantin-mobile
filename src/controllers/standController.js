const supabase = require('../config/database');

function formatStand(s) {
    if (!s) return null;
    return {
        id: s.id,
        name: s.name,
        standName: s.name,
        ownerId: s.owner_id,
        ownerName: s.profiles?.full_name || null,
        counterNumber: s.stand_number,
        counterSlot: s.stand_number,
        standNumber: s.stand_number,
        isOpen: s.is_open,
        category: s.category || 'Makanan',
        rating: 4.8,
        createdAt: s.created_at
    };
}

// 1. Get all stands (untuk browsing stand bagi siswa / publik)
exports.getAllStands = async (req, res) => {
    try {
        const { data: stands, error } = await supabase
            .from('stands')
            .select('*, profiles:owner_id(full_name)')
            .order('name', { ascending: true });

        if (error) throw error;

        res.status(200).json({
            status: "success",
            data: (stands || []).map(formatStand)
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

// 2. Get stand milik seller yang sedang login
exports.getMyStand = async (req, res) => {
    try {
        let { data: stand, error } = await supabase
            .from('stands')
            .select('*, profiles:owner_id(full_name)')
            .eq('owner_id', req.user.id)
            .maybeSingle();

        if (error) throw error;

        // Jika seller belum punya stand di DB, otomatis buatkan stand default
        if (!stand) {
            const { data: userProfile } = await supabase
                .from('profiles')
                .select('full_name')
                .eq('id', req.user.id)
                .single();

            const ownerName = userProfile?.full_name || 'Penjual';
            const defaultName = `Stand ${ownerName}`;

            const { data: newStand, error: createErr } = await supabase
                .from('stands')
                .insert([{
                    owner_id: req.user.id,
                    name: defaultName,
                    stand_number: 'Stand 01',
                    category: 'Makanan',
                    is_open: true
                }])
                .select('*, profiles:owner_id(full_name)')
                .single();

            if (createErr) throw createErr;
            stand = newStand;
        }

        res.status(200).json({
            status: "success",
            data: formatStand(stand)
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

// 3. Update stand milik seller yang sedang login (Nama Stand, Nomor Slot, Status Buka/Tutup)
exports.updateMyStand = async (req, res) => {
    const { name, standName, counterSlot, standNumber, category, isOpen, is_open } = req.body;

    try {
        let { data: stand } = await supabase
            .from('stands')
            .select('id')
            .eq('owner_id', req.user.id)
            .maybeSingle();

        const chosenName = (name || standName || '').trim();
        const chosenSlot = (counterSlot || standNumber || '').trim();
        const openState = isOpen !== undefined ? isOpen : is_open;

        if (!stand) {
            const { data: newStand, error: createErr } = await supabase
                .from('stands')
                .insert([{
                    owner_id: req.user.id,
                    name: chosenName || 'Stand Kantin',
                    stand_number: chosenSlot || 'Stand 01',
                    category: category || 'Makanan',
                    is_open: openState !== undefined ? Boolean(openState) : true
                }])
                .select('*, profiles:owner_id(full_name)')
                .single();

            if (createErr) throw createErr;
            return res.status(200).json({
                status: "success",
                message: "Profil stand berhasil dibuat",
                data: formatStand(newStand)
            });
        }

        const updateData = {};
        if (chosenName) updateData.name = chosenName;
        if (chosenSlot) updateData.stand_number = chosenSlot;
        if (category !== undefined && category !== null) updateData.category = category.trim();
        if (openState !== undefined) updateData.is_open = Boolean(openState);

        const { data: updatedStand, error: updateErr } = await supabase
            .from('stands')
            .update(updateData)
            .eq('id', stand.id)
            .select('*, profiles:owner_id(full_name)')
            .single();

        if (updateErr) throw updateErr;

        res.status(200).json({
            status: "success",
            message: "Profil stand berhasil diperbarui",
            data: formatStand(updatedStand)
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

// 4. Update stand berdasarkan standId (untuk seller pemilik atau admin)
exports.updateStandById = async (req, res) => {
    const { standId } = req.params;
    const { name, standName, counterSlot, standNumber, category, isOpen, is_open } = req.body;

    try {
        const updateData = {};
        const chosenName = (name || standName || '').trim();
        if (chosenName) updateData.name = chosenName;

        const chosenSlot = (counterSlot || standNumber || '').trim();
        if (chosenSlot) updateData.stand_number = chosenSlot;

        if (category !== undefined) updateData.category = category.trim();

        const openState = isOpen !== undefined ? isOpen : is_open;
        if (openState !== undefined) updateData.is_open = Boolean(openState);

        let query = supabase.from('stands').update(updateData).eq('id', standId);
        if (req.user.role === 'SELLER') {
            query = query.eq('owner_id', req.user.id);
        }

        const { data: updatedStand, error } = await query.select('*, profiles:owner_id(full_name)').single();
        if (error || !updatedStand) {
            return res.status(404).json({ status: "error", message: "Stand tidak ditemukan atau Anda tidak memiliki akses" });
        }

        res.status(200).json({
            status: "success",
            message: "Stand berhasil diperbarui",
            data: formatStand(updatedStand)
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

// 5. Get daftar menu milik stand tertentu
exports.getMenusByStand = async (req, res) => {
    const { standId } = req.params;

    try {
        const { data: menus, error } = await supabase
            .from('menus')
            .select('*, stands(id, name, stand_number)')
            .eq('stand_id', standId)
            .order('name', { ascending: true });

        if (error) throw error;

        res.status(200).json({
            status: "success",
            data: menus || []
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

// 6. Get Pendapatan / Omset Harian dan Histori Pendapatan untuk Seller
exports.getSellerRevenue = async (req, res) => {
    try {
        const { data: stand } = await supabase
            .from('stands')
            .select('id, name')
            .eq('owner_id', req.user.id)
            .maybeSingle();

        if (!stand) {
            return res.status(200).json({
                status: "success",
                data: {
                    standName: "Stand Anda",
                    todayIncome: 0,
                    grossIncome: 0,
                    completedOrders: 0,
                    activeQueueCount: 0,
                    readyCount: 0,
                    cookingCount: 0,
                    averagePrepMinutes: 7,
                    dailyHistory: [],
                    transactions: []
                }
            });
        }

        const { data: orders, error } = await supabase
            .from('orders')
            .select(`
                id,
                order_number,
                total_amount,
                payment_method,
                status,
                created_at,
                profiles:student_id (full_name, class_name),
                order_items (id, quantity, price_at_time, menus(name))
            `)
            .eq('stand_id', stand.id)
            .order('created_at', { ascending: false });

        if (error) throw error;

        const allOrders = orders || [];
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        let todayIncome = 0;
        let todayCompletedOrders = 0;
        let readyCount = 0;
        let cookingCount = 0;

        const dailyMap = {};

        for (const ord of allOrders) {
            const createdAt = new Date(ord.created_at);
            const dateStr = createdAt.toISOString().split('T')[0];

            if (ord.status === 'COMPLETED') {
                if (createdAt >= startOfToday) {
                    todayIncome += (ord.total_amount || 0);
                    todayCompletedOrders++;
                }

                if (!dailyMap[dateStr]) {
                    dailyMap[dateStr] = { date: dateStr, totalIncome: 0, orderCount: 0 };
                }
                dailyMap[dateStr].totalIncome += (ord.total_amount || 0);
                dailyMap[dateStr].orderCount += 1;
            } else if (ord.status === 'READY' || ord.status === 'READY_FOR_PICKUP') {
                readyCount++;
            } else if (ord.status === 'COOKING' || ord.status === 'PENDING' || ord.status === 'PENDING_PAYMENT') {
                cookingCount++;
            }
        }

        const activeQueueCount = readyCount + cookingCount;
        const dailyHistory = Object.values(dailyMap).sort((a, b) => b.date.localeCompare(a.date));

        const transactions = allOrders
            .filter(o => o.status === 'COMPLETED')
            .slice(0, 50)
            .map(o => ({
                id: o.id,
                orderNumber: o.order_number,
                totalAmount: o.total_amount,
                paymentMethod: o.payment_method,
                studentName: o.profiles?.full_name || 'Siswa',
                studentClass: o.profiles?.class_name || '-',
                createdAt: o.created_at,
                itemCount: (o.order_items || []).reduce((sum, it) => sum + (it.quantity || 1), 0)
            }));

        res.status(200).json({
            status: "success",
            data: {
                standId: stand.id,
                standName: stand.name,
                todayIncome,
                grossIncome: todayIncome,
                completedOrders: todayCompletedOrders,
                activeQueueCount,
                readyCount,
                cookingCount,
                averagePrepMinutes: 7,
                dailyHistory,
                transactions
            }
        });

    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};
