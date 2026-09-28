const supabase = require('../config/database');

const ORDER_QUERY_WITH_NOTE = `
    id,
    order_number,
    student_id,
    stand_id,
    total_amount,
    payment_method,
    status,
    used_points,
    earned_points,
    note,
    created_at,
    stands (id, name, stand_number),
    profiles:student_id (id, full_name, phone_number, class_name),
    order_items (id, menu_id, quantity, price_at_time, note, menus(id, name, image_url, price))
`;

const ORDER_QUERY_FALLBACK = `
    id,
    order_number,
    student_id,
    stand_id,
    total_amount,
    payment_method,
    status,
    used_points,
    earned_points,
    created_at,
    stands (id, name, stand_number),
    profiles:student_id (id, full_name, phone_number, class_name),
    order_items (id, menu_id, quantity, price_at_time, menus(id, name, image_url, price))
`;

exports.createOrder = async (req, res) => {
    const { standId, items, paymentMethod, usePoints, note, notes } = req.body;
    const studentId = req.user.id;
    const orderNote = (note !== undefined ? note : (notes !== undefined ? notes : '')).toString().trim() || null;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ status: "error", message: "Keranjang pesanan kosong." });
    }

    try {
        // 1. Ambil dan validasi semua menu dari database
        const menuIds = items.map(it => it.menuId);
        const { data: menus, error: menuErr } = await supabase
            .from('menus')
            .select('id, price, stock, name, is_available, stand_id, stands(id, name, stand_number)')
            .in('id', menuIds);

        if (menuErr || !menus) throw new Error("Gagal mengambil data menu dari database.");

        const menuMap = {};
        for (const m of menus) {
            menuMap[m.id] = m;
        }

        // Validasi ketersediaan dan stok untuk setiap item di keranjang
        for (const it of items) {
            const menu = menuMap[it.menuId];
            if (!menu) {
                return res.status(400).json({ status: "error", message: "Menu dengan ID " + it.menuId + " tidak ditemukan." });
            }
            if (menu.is_available === false) {
                return res.status(400).json({ status: "error", message: 'Menu "' + menu.name + '" sedang tidak tersedia.' });
            }
            if (menu.stock <= 0 || menu.stock < it.quantity) {
                return res.status(400).json({ status: "error", message: "Stok " + menu.name + " tidak mencukupi atau habis. Sisa: " + menu.stock });
            }
        }

        // 2. Kelompokkan item berdasarkan stand_id menu
        const itemsByStand = {};
        for (const it of items) {
            const menu = menuMap[it.menuId];
            const targetStandId = menu.stand_id || standId;
            if (!targetStandId) {
                return res.status(400).json({ status: "error", message: "Stand untuk menu " + menu.name + " tidak terdefinisi." });
            }
            if (!itemsByStand[targetStandId]) {
                itemsByStand[targetStandId] = {
                    standId: targetStandId,
                    standName: menu.stands?.name || "Stand Kantin",
                    items: [],
                    subtotal: 0
                };
            }
            const itemNote = (it.note || '').toString().trim() || null;
            itemsByStand[targetStandId].items.push({
                menu_id: it.menuId,
                name: menu.name,
                quantity: it.quantity,
                price_at_time: menu.price,
                note: itemNote
            });
            itemsByStand[targetStandId].subtotal += menu.price * it.quantity;
        }

        // 3. Tangani pemotongan poin (jika usePoints = true)
        let totalUsedPoints = 0;
        let remainingDiscount = 0;
        if (usePoints) {
            const { data: student } = await supabase.from('profiles').select('points').eq('id', studentId).single();
            if (student && student.points >= 20) {
                totalUsedPoints = 20;
                remainingDiscount = 10000;
                await supabase.from('profiles').update({ points: student.points - 20 }).eq('id', studentId);
            } else {
                return res.status(400).json({ status: "error", message: "Poin tidak mencukupi (Minimal 20 Poin)." });
            }
        }

        // 4. Normalisasi metode pembayaran
        const methodUpper = (paymentMethod || 'CASH').toString().toUpperCase().trim();
        const isQris = methodUpper === 'QRIS';
        const dbPaymentMethod = isQris ? 'QRIS' : 'CASH';
        const prefix = isQris ? 'Q' : 'C';

        const standKeys = Object.keys(itemsByStand);
        const createdOrders = [];

        // 5. Buat order terpisah untuk masing-masing stand
        for (const sId of standKeys) {
            const group = itemsByStand[sId];
            let orderDiscount = 0;
            if (remainingDiscount > 0) {
                orderDiscount = Math.min(group.subtotal, remainingDiscount);
                remainingDiscount -= orderDiscount;
            }

            const standFinalTotal = Math.max(0, group.subtotal - orderDiscount);
            const standUsedPoints = orderDiscount > 0 ? totalUsedPoints : 0;
            const standEarnedPoints = Math.floor(standFinalTotal / 10000);

            const randomNum = Math.floor(1000 + Math.random() * 9000);
            const orderNumber = prefix + "-" + randomNum;

            const orderInsertData = {
                order_number: orderNumber,
                student_id: studentId,
                stand_id: sId,
                total_amount: standFinalTotal,
                payment_method: dbPaymentMethod,
                status: isQris ? 'PENDING_PAYMENT' : 'READY_FOR_PICKUP',
                used_points: standUsedPoints,
                earned_points: standEarnedPoints,
                note: orderNote
            };

            let { data: newOrder, error: orderError } = await supabase
                .from('orders')
                .insert([orderInsertData])
                .select('*, stands (id, name, stand_number)')
                .single();

            // Fallback jika kolom note belum ada di Supabase
            if (orderError && orderError.message && orderError.message.includes('note')) {
                console.warn('[ORDER] Kolom note belum ada di tabel orders. Menyimpan pesanan tanpa kolom note...');
                delete orderInsertData.note;
                const retry = await supabase
                    .from('orders')
                    .insert([orderInsertData])
                    .select('*, stands (id, name, stand_number)')
                    .single();
                newOrder = retry.data;
                orderError = retry.error;
            }

            if (orderError) throw orderError;

            // Masukkan order_items & kurangi stok
            for (const item of group.items) {
                const itemInsertData = {
                    order_id: newOrder.id,
                    menu_id: item.menu_id,
                    quantity: item.quantity,
                    price_at_time: item.price_at_time,
                    note: item.note
                };

                let { error: itemErr } = await supabase.from('order_items').insert([itemInsertData]);
                if (itemErr && itemErr.message && itemErr.message.includes('note')) {
                    delete itemInsertData.note;
                    await supabase.from('order_items').insert([itemInsertData]);
                }

                const { data: cur } = await supabase.from('menus').select('stock').eq('id', item.menu_id).single();
                if (cur) {
                    await supabase.from('menus').update({ stock: Math.max(0, cur.stock - item.quantity) }).eq('id', item.menu_id);
                }
            }

            createdOrders.push({
                ...newOrder,
                id: newOrder.id,
                orderNumber: newOrder.order_number,
                order_number: newOrder.order_number,
                standId: newOrder.stand_id,
                standName: newOrder.stands?.name || group.standName,
                totalAmount: newOrder.total_amount,
                total_amount: newOrder.total_amount,
                paymentMethod: paymentMethod || dbPaymentMethod,
                payment_method: newOrder.payment_method,
                status: newOrder.status,
                barcode: newOrder.order_number,
                qrCode: newOrder.order_number,
                note: orderNote,
                notes: orderNote,
                createdAt: newOrder.created_at,
                created_at: newOrder.created_at,
                items: group.items.map(it => ({
                    menuId: it.menu_id,
                    menuName: it.name,
                    price: it.price_at_time,
                    quantity: it.quantity,
                    note: it.note
                }))
            });
        }

        const isMulti = createdOrders.length > 1;
        res.status(201).json({
            status: "success",
            message: isMulti
                ? createdOrders.length + " pesanan berhasil dibuat untuk stand berbeda!"
                : "Pesanan berhasil dibuat!",
            data: {
                ...createdOrders[0],
                orderNumber: createdOrders[0].order_number,
                paymentMethod: paymentMethod || dbPaymentMethod,
                note: orderNote,
                notes: orderNote,
                orders: createdOrders
            }
        });

    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

exports.getOrders = async (req, res) => {
    try {
        const user = req.user;
        const { status } = req.query;

        let query = supabase.from('orders').select(ORDER_QUERY_WITH_NOTE).order('created_at', { ascending: false });

        if (status) {
            query = query.eq('status', status);
        }

        if (user.role === 'STUDENT') {
            query = query.eq('student_id', user.id);
        } else if (user.role === 'SELLER') {
            const { data: stand } = await supabase.from('stands').select('id').eq('owner_id', user.id).maybeSingle();
            if (stand) {
                query = query.eq('stand_id', stand.id);
            } else {
                return res.status(200).json({ status: "success", data: [] });
            }
        }

        let { data: orders, error } = await query;

        // Fallback jika kolom note belum ada di Supabase
        if (error && error.message && error.message.includes('note')) {
            let fallbackQuery = supabase.from('orders').select(ORDER_QUERY_FALLBACK).order('created_at', { ascending: false });
            if (status) fallbackQuery = fallbackQuery.eq('status', status);
            if (user.role === 'STUDENT') fallbackQuery = fallbackQuery.eq('student_id', user.id);
            else if (user.role === 'SELLER') {
                const { data: stand } = await supabase.from('stands').select('id').eq('owner_id', user.id).maybeSingle();
                if (stand) fallbackQuery = fallbackQuery.eq('stand_id', stand.id);
            }
            const fallbackResult = await fallbackQuery;
            orders = fallbackResult.data;
            error = fallbackResult.error;
        }

        if (error) throw error;

        const formatted = (orders || []).map(o => ({
            id: o.id,
            orderNumber: o.order_number,
            order_number: o.order_number,
            standId: o.stand_id,
            standName: o.stands?.name || null,
            userId: o.student_id,
            studentName: o.profiles?.full_name || null,
            studentClass: o.profiles?.class_name || null,
            totalAmount: o.total_amount,
            total_amount: o.total_amount,
            paymentMethod: o.payment_method,
            payment_method: o.payment_method,
            status: o.status,
            note: o.note || null,
            notes: o.note || null,
            createdAt: o.created_at,
            created_at: o.created_at,
            barcode: o.order_number,
            qrCode: o.order_number,
            items: (o.order_items || []).map(it => ({
                menuId: it.menu_id,
                menuName: it.menus?.name || 'Menu',
                price: it.price_at_time,
                quantity: it.quantity,
                note: it.note || null
            }))
        }));

        res.status(200).json({
            status: "success",
            data: formatted
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

exports.getOrderDetail = async (req, res) => {
    const { orderId } = req.params;
    const user = req.user;

    try {
        const cleanOrderId = (orderId || '').trim();
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanOrderId);

        let query = supabase.from('orders').select(ORDER_QUERY_WITH_NOTE);
        if (isUuid) {
            query = query.eq('id', cleanOrderId);
        } else {
            query = query.ilike('order_number', cleanOrderId);
        }

        let { data: order, error } = await query.maybeSingle();

        // Fallback jika kolom note belum ada di Supabase
        if (error && error.message && error.message.includes('note')) {
            let fallbackQuery = supabase.from('orders').select(ORDER_QUERY_FALLBACK);
            if (isUuid) fallbackQuery = fallbackQuery.eq('id', cleanOrderId);
            else fallbackQuery = fallbackQuery.ilike('order_number', cleanOrderId);
            const fallbackResult = await fallbackQuery.maybeSingle();
            order = fallbackResult.data;
            error = fallbackResult.error;
        }

        if (error || !order) {
            return res.status(404).json({ status: "error", message: "Pesanan tidak ditemukan" });
        }

        // Verifikasi kepemilikan untuk SELLER
        if (user && user.role === 'SELLER') {
            const { data: sellerStand } = await supabase
                .from('stands')
                .select('id, name')
                .eq('owner_id', user.id)
                .maybeSingle();

            if (sellerStand && order.stand_id !== sellerStand.id) {
                const targetStandName = order.stands?.name || 'stand lain';
                return res.status(403).json({
                    status: "error",
                    message: "Pesanan #" + order.order_number + " adalah milik " + targetStandName + ", bukan stand Anda (" + sellerStand.name + ")."
                });
            }
        }

        const formatted = {
            id: order.id,
            orderNumber: order.order_number,
            order_number: order.order_number,
            standId: order.stand_id,
            standName: order.stands?.name || null,
            userId: order.student_id,
            studentName: order.profiles?.full_name || null,
            studentClass: order.profiles?.class_name || null,
            totalAmount: order.total_amount,
            total_amount: order.total_amount,
            paymentMethod: order.payment_method,
            payment_method: order.payment_method,
            status: order.status,
            note: order.note || null,
            notes: order.note || null,
            createdAt: order.created_at,
            created_at: order.created_at,
            barcode: order.order_number,
            qrCode: order.order_number,
            items: (order.order_items || []).map(it => ({
                menuId: it.menu_id,
                menuName: it.menus?.name || 'Menu',
                price: it.price_at_time,
                quantity: it.quantity,
                note: it.note || null
            }))
        };

        res.status(200).json({
            status: "success",
            data: formatted
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

// Update catatan pesanan (bisa dipanggil oleh siswa sebelum pesanan selesai / dibatalkan)
exports.updateOrderNote = async (req, res) => {
    const { orderId } = req.params;
    const { note, notes } = req.body;
    const user = req.user;

    const newNote = (note !== undefined ? note : notes);
    if (newNote === undefined) {
        return res.status(400).json({ status: "error", message: "Field 'note' wajib disertakan dalam request." });
    }

    try {
        const cleanOrderId = (orderId || '').trim();
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanOrderId);

        let query = supabase.from('orders').select('*');
        if (isUuid) {
            query = query.eq('id', cleanOrderId);
        } else {
            query = query.ilike('order_number', cleanOrderId);
        }

        const { data: order, error } = await query.maybeSingle();
        if (error || !order) {
            return res.status(404).json({ status: "error", message: "Pesanan tidak ditemukan" });
        }

        if (user.role === 'STUDENT' && order.student_id !== user.id) {
            return res.status(403).json({ status: "error", message: "Akses ditolak: Anda bukan pemilik pesanan ini." });
        }

        if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
            return res.status(400).json({
                status: "error",
                message: "Catatan tidak dapat diubah karena pesanan sudah berstatus " + order.status
            });
        }

        const trimmedNote = (newNote || '').toString().trim() || null;
        const { data: updatedOrder, error: updateErr } = await supabase
            .from('orders')
            .update({ note: trimmedNote })
            .eq('id', order.id)
            .select()
            .single();

        if (updateErr) {
            if (updateErr.message && updateErr.message.includes('note')) {
                return res.status(500).json({
                    status: "error",
                    message: "Kolom 'note' belum dibuat di database Supabase. Jalankan query: ALTER TABLE orders ADD COLUMN IF NOT EXISTS note TEXT;"
                });
            }
            throw updateErr;
        }

        res.status(200).json({
            status: "success",
            message: "Catatan pesanan berhasil diperbarui",
            data: {
                id: updatedOrder.id,
                orderNumber: updatedOrder.order_number,
                note: updatedOrder.note,
                notes: updatedOrder.note
            }
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

exports.completeOrder = async (req, res) => {
    const rawId = req.params.orderId || req.params.orderNumber;
    const identifier = (rawId || '').trim();

    try {
        let query = supabase.from('orders').select('*, stands (id, name, stand_number)');
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
        if (isUuid) {
            query = query.eq('id', identifier);
        } else {
            query = query.eq('order_number', identifier);
        }

        const { data: order, error: orderErr } = await query.maybeSingle();

        if (orderErr || !order) {
            return res.status(404).json({ status: "error", message: "Pesanan tidak ditemukan" });
        }

        // Verifikasi bahwa SELLER hanya bisa menyelesaikan pesanan milik stand-nya sendiri
        if (req.user && req.user.role === 'SELLER') {
            const { data: sellerStand } = await supabase
                .from('stands')
                .select('id, name')
                .eq('owner_id', req.user.id)
                .maybeSingle();

            if (sellerStand && order.stand_id !== sellerStand.id) {
                const targetStandName = order.stands?.name || 'stand lain';
                return res.status(403).json({
                    status: "error",
                    message: "Gagal: Pesanan #" + order.order_number + " adalah milik " + targetStandName + ", bukan stand Anda (" + sellerStand.name + ")."
                });
            }
        }

        if (order.status === 'COMPLETED') {
            return res.status(400).json({ status: "error", message: "Pesanan ini sudah diselesaikan sebelumnya" });
        }

        await supabase
            .from('orders')
            .update({ status: 'COMPLETED', updated_at: new Date() })
            .eq('id', order.id);

        if (order.earned_points > 0) {
            const { data: student } = await supabase
                .from('profiles')
                .select('points')
                .eq('id', order.student_id)
                .single();
            if (student) {
                await supabase
                    .from('profiles')
                    .update({ points: (student.points || 0) + order.earned_points })
                    .eq('id', order.student_id);
            }
        }

        res.status(200).json({ 
            status: "success", 
            message: "Pesanan " + order.order_number + " Selesai! Poin siswa berhasil ditambahkan.",
            data: {
                id: order.id,
                orderNumber: order.order_number,
                status: 'COMPLETED'
            }
        });

    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

exports.updateOrderStatus = async (req, res) => {
    const rawId = req.params.orderId;
    const identifier = (rawId || '').trim();
    const { status } = req.body;

    if (!status) {
        return res.status(400).json({ status: "error", message: "Status pesanan wajib diisi" });
    }

    const upperStatus = status.toUpperCase();
    if (upperStatus === 'CANCELLED') {
        return exports.cancelOrder(req, res);
    }

    try {
        let query = supabase.from('orders').select('*, stands (id, name, stand_number)');
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
        if (isUuid) {
            query = query.eq('id', identifier);
        } else {
            query = query.eq('order_number', identifier);
        }

        const { data: order, error: orderErr } = await query.maybeSingle();
        if (orderErr || !order) {
            return res.status(404).json({ status: "error", message: "Pesanan tidak ditemukan" });
        }

        // Verifikasi kepemilikan stand untuk SELLER
        if (req.user && req.user.role === 'SELLER') {
            const { data: sellerStand } = await supabase
                .from('stands')
                .select('id, name')
                .eq('owner_id', req.user.id)
                .maybeSingle();

            if (sellerStand && order.stand_id !== sellerStand.id) {
                const targetStandName = order.stands?.name || 'stand lain';
                return res.status(403).json({
                    status: "error",
                    message: "Akses ditolak: Pesanan #" + order.order_number + " adalah milik " + targetStandName + ", bukan stand Anda (" + sellerStand.name + ")."
                });
            }
        }

        const validStatuses = ['PENDING', 'PENDING_PAYMENT', 'COOKING', 'READY', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED'];
        if (!validStatuses.includes(upperStatus)) {
            return res.status(400).json({ status: "error", message: "Status tidak valid" });
        }

        if (upperStatus === 'COMPLETED') {
            return exports.completeOrder(req, res);
        }

        await supabase
            .from('orders')
            .update({ status: upperStatus, updated_at: new Date() })
            .eq('id', order.id);

        res.status(200).json({
            status: "success",
            message: "Status pesanan " + order.order_number + " diubah menjadi " + upperStatus,
            data: {
                id: order.id,
                orderNumber: order.order_number,
                status: upperStatus
            }
        });

    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

exports.cancelOrder = async (req, res) => {
    const rawId = req.params.orderId || req.params.orderNumber;
    const identifier = (rawId || '').trim();
    const user = req.user;

    try {
        let query = supabase.from('orders').select('*, order_items(id, menu_id, quantity)');
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
        if (isUuid) {
            query = query.eq('id', identifier);
        } else {
            query = query.ilike('order_number', identifier);
        }

        const { data: order, error: orderErr } = await query.maybeSingle();
        if (orderErr || !order) {
            return res.status(404).json({ status: "error", message: "Pesanan tidak ditemukan" });
        }

        // Cek hak akses
        if (user.role === 'STUDENT' && order.student_id !== user.id) {
            return res.status(403).json({ status: "error", message: "Anda tidak berhak membatalkan pesanan ini." });
        }

        if (order.status === 'COMPLETED') {
            return res.status(400).json({ status: "error", message: "Pesanan sudah selesai, tidak dapat dibatalkan." });
        }

        if (order.status === 'CANCELLED') {
            return res.status(400).json({ status: "error", message: "Pesanan ini sudah dibatalkan sebelumnya." });
        }

        // Siswa hanya boleh membatalkan jika pesanan belum masuk tahap COOKING
        if (user.role === 'STUDENT' && order.status === 'COOKING') {
            return res.status(400).json({
                status: "error",
                message: "Pesanan sedang dimasak oleh penjual dan tidak dapat dibatalkan."
            });
        }

        const { error: updateErr } = await supabase
            .from('orders')
            .update({ status: 'CANCELLED', updated_at: new Date() })
            .eq('id', order.id);

        if (updateErr) throw updateErr;

        // Kembalikan poin yang digunakan
        if (order.used_points > 0) {
            const { data: student } = await supabase.from('profiles').select('points').eq('id', order.student_id).single();
            if (student) {
                await supabase.from('profiles').update({ points: (student.points || 0) + order.used_points }).eq('id', order.student_id);
            }
        }

        // Kembalikan stok menu
        if (order.order_items && Array.isArray(order.order_items)) {
            for (const item of order.order_items) {
                const { data: menu } = await supabase.from('menus').select('stock').eq('id', item.menu_id).single();
                if (menu) {
                    await supabase.from('menus').update({ stock: menu.stock + item.quantity }).eq('id', item.menu_id);
                }
            }
        }

        res.status(200).json({
            status: "success",
            message: "Pesanan " + order.order_number + " berhasil dibatalkan. Stok dan poin telah dikembalikan.",
            data: {
                id: order.id,
                orderNumber: order.order_number,
                status: 'CANCELLED'
            }
        });

    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};
