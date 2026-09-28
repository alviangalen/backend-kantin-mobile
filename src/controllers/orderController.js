const supabase = require('../config/database');

exports.createOrder = async (req, res) => {
    const { standId, items, paymentMethod, usePoints } = req.body;
    const studentId = req.user.id;

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
            itemsByStand[targetStandId].items.push({
                menu_id: it.menuId,
                name: menu.name,
                quantity: it.quantity,
                price_at_time: menu.price,
                note: it.note || null
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

            const { data: newOrder, error: orderError } = await supabase
                .from('orders')
                .insert([{
                    order_number: orderNumber,
                    student_id: studentId,
                    stand_id: sId,
                    total_amount: standFinalTotal,
                    payment_method: dbPaymentMethod,
                    status: isQris ? 'PENDING_PAYMENT' : 'READY_FOR_PICKUP',
                    used_points: standUsedPoints,
                    earned_points: standEarnedPoints
                }])
                .select('*, stands (id, name, stand_number)')
                .single();

            if (orderError) throw orderError;

            // Masukkan order_items & kurangi stok
            for (const item of group.items) {
                await supabase.from('order_items').insert([{
                    order_id: newOrder.id,
                    menu_id: item.menu_id,
                    quantity: item.quantity,
                    price_at_time: item.price_at_time
                }]);

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
                createdAt: newOrder.created_at,
                created_at: newOrder.created_at,
                items: group.items.map(it => ({
                    menuId: it.menu_id,
                    menuName: it.name,
                    price: it.price_at_time,
                    quantity: it.quantity
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

        let query = supabase.from('orders').select(`
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
        `).order('created_at', { ascending: false });

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

        const { data: orders, error } = await query;
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
            createdAt: o.created_at,
            created_at: o.created_at,
            barcode: o.order_number,
            qrCode: o.order_number,
            items: (o.order_items || []).map(it => ({
                menuId: it.menu_id,
                menuName: it.menus?.name || 'Menu',
                price: it.price_at_time,
                quantity: it.quantity
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
        let query = supabase.from('orders').select(`
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
        `);

        const cleanOrderId = (orderId || '').trim();
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanOrderId);
        if (isUuid) {
            query = query.eq('id', cleanOrderId);
        } else {
            query = query.ilike('order_number', cleanOrderId);
        }

        const { data: order, error } = await query.maybeSingle();

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
            createdAt: order.created_at,
            created_at: order.created_at,
            barcode: order.order_number,
            qrCode: order.order_number,
            items: (order.order_items || []).map(it => ({
                menuId: it.menu_id,
                menuName: it.menus?.name || 'Menu',
                price: it.price_at_time,
                quantity: it.quantity
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

exports.completeOrder = async (req, res) => {
    const rawId = req.params.orderId || req.params.orderNumber;
    const identifier = (rawId || '').trim();
    const user = req.user;

    try {
        let query = supabase.from('orders').select('*, stands (id, name, stand_number)');
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

        // VALIDASI KETAT: Penjual TIDAK BISA scan pesanan milik stand lain!
        if (user && user.role === 'SELLER') {
            const { data: sellerStand } = await supabase
                .from('stands')
                .select('id, name')
                .eq('owner_id', user.id)
                .maybeSingle();

            if (!sellerStand) {
                return res.status(403).json({
                    status: "error",
                    message: "Akun penjual tidak terhubung dengan stand manapun."
                });
            }

            if (order.stand_id !== sellerStand.id) {
                const targetStandName = order.stands?.name || "stand lain";
                return res.status(403).json({
                    status: "error",
                    message: "Pesanan #" + order.order_number + " adalah milik \"" + targetStandName + "\", bukan stand Anda (\"" + sellerStand.name + "\"). Anda hanya dapat memproses pesanan untuk stand Anda sendiri."
                });
            }
        }

        if (order.status === 'COMPLETED') {
            return res.status(400).json({ status: "error", message: "Pesanan ini sudah diselesaikan sebelumnya" });
        }

        if (order.status === 'CANCELLED') {
            return res.status(400).json({ status: "error", message: "Pesanan ini sudah dibatalkan sebelumnya" });
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
    const identifier = req.params.orderId;
    const { status } = req.body;
    const user = req.user;

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

        // VALIDASI KETAT: Penjual TIDAK BISA update status pesanan milik stand lain!
        if (user && user.role === 'SELLER') {
            const { data: sellerStand } = await supabase
                .from('stands')
                .select('id, name')
                .eq('owner_id', user.id)
                .maybeSingle();

            if (!sellerStand || order.stand_id !== sellerStand.id) {
                const targetStandName = order.stands?.name || "stand lain";
                return res.status(403).json({
                    status: "error",
                    message: "Pesanan #" + order.order_number + " adalah milik \"" + targetStandName + "\", bukan stand Anda (\"" + (sellerStand ? sellerStand.name : 'Unknown') + "\")."
                });
            }
        }

        const validStatuses = ['PENDING', 'PENDING_PAYMENT', 'COOKING', 'READY', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED'];
        if (!validStatuses.includes(upperStatus)) {
            return res.status(400).json({ status: "error", message: "Status tidak valid" });
        }

        await supabase
            .from('orders')
            .update({ status: upperStatus, updated_at: new Date() })
            .eq('id', order.id);

        if (upperStatus === 'COMPLETED' && order.status !== 'COMPLETED' && order.earned_points > 0) {
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
            message: "Status pesanan " + order.order_number + " berhasil diubah ke " + upperStatus,
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

        // Verifikasi kepemilikan jika siswa
        if (user.role === 'STUDENT' && order.student_id !== user.id) {
            return res.status(403).json({ status: "error", message: "Anda tidak memiliki akses untuk membatalkan pesanan ini" });
        }

        if (order.status === 'CANCELLED') {
            return res.status(400).json({ status: "error", message: "Pesanan ini sudah dibatalkan sebelumnya" });
        }

        // Pesanan hanya bisa dibatalkan jika belum dimasak atau belum selesai
        if (order.status === 'COOKING' || order.status === 'COMPLETED') {
            return res.status(400).json({
                status: "error",
                message: "Pesanan tidak dapat dibatalkan karena pesanan sudah " + (order.status === 'COOKING' ? "sedang dimasak/dipersiapkan" : "selesai") + "."
            });
        }

        // 1. Ubah status pesanan menjadi CANCELLED
        const { error: updateErr } = await supabase
            .from('orders')
            .update({ status: 'CANCELLED', updated_at: new Date() })
            .eq('id', order.id);

        if (updateErr) throw updateErr;

        // 2. Kembalikan stok menu
        const items = order.order_items || [];
        for (const it of items) {
            if (it.menu_id && it.quantity > 0) {
                const { data: m } = await supabase.from('menus').select('stock').eq('id', it.menu_id).maybeSingle();
                if (m) {
                    await supabase.from('menus').update({ stock: m.stock + it.quantity }).eq('id', it.menu_id);
                }
            }
        }

        // 3. Kembalikan poin jika menggunakan poin
        if (order.used_points > 0) {
            const { data: student } = await supabase.from('profiles').select('points').eq('id', order.student_id).maybeSingle();
            if (student) {
                await supabase.from('profiles').update({ points: (student.points || 0) + order.used_points }).eq('id', order.student_id);
            }
        }

        res.status(200).json({
            status: "success",
            message: "Pesanan " + order.order_number + " berhasil dibatalkan.",
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
