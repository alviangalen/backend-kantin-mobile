const supabase = require('../config/database');

exports.createOrder = async (req, res) => {
    const { standId, items, paymentMethod, usePoints } = req.body;
    const studentId = req.user.id;

    try {
        let totalAmount = 0;
        const orderItemsData = [];

        for (const item of items) {
            const { data: menu, error } = await supabase
                .from('menus')
                .select('price, stock, name')
                .eq('id', item.menuId)
                .single();

            if (error || !menu) throw new Error(`Menu dengan ID ${item.menuId} tidak ditemukan.`);
            if (menu.stock < item.quantity) {
                return res.status(400).json({ status: "error", message: `Stok ${menu.name} tidak mencukupi. Sisa: ${menu.stock}` });
            }

            totalAmount += menu.price * item.quantity;
            orderItemsData.push({
                menu_id: item.menuId,
                quantity: item.quantity,
                price_at_time: menu.price
            });
        }

        let usedPoints = 0;
        let earnedPoints = 0;

        if (usePoints) {
            const { data: student } = await supabase.from('profiles').select('points').eq('id', studentId).single();
            
            if (student.points >= 20) {
                usedPoints = 20;
                totalAmount = Math.max(0, totalAmount - 10000); 
                
                await supabase.from('profiles').update({ points: student.points - 20 }).eq('id', studentId);
            } else {
                return res.status(400).json({ status: "error", message: "Poin tidak mencukupi (Minimal 20 Poin)." });
            }
        } else {
            earnedPoints = Math.floor(totalAmount / 10000);
        }

        const prefix = paymentMethod === 'QRIS' ? 'Q' : 'C';
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        const orderNumber = `${prefix}-${randomNum}`;
        const { data: newOrder, error: orderError } = await supabase
            .from('orders')
            .insert([{
                order_number: orderNumber,
                student_id: studentId,
                stand_id: standId,
                total_amount: totalAmount,
                payment_method: paymentMethod,
                status: paymentMethod === 'QRIS' ? 'PENDING_PAYMENT' : 'READY_FOR_PICKUP',
                used_points: usedPoints,
                earned_points: earnedPoints
            }])
            .select()
            .single();

        if (orderError) throw orderError;

        for (const item of orderItemsData) {
            item.order_id = newOrder.id; 
            
            await supabase.from('order_items').insert([item]);
            
            const { data: currentMenu } = await supabase.from('menus').select('stock').eq('id', item.menu_id).single();
            await supabase.from('menus').update({ stock: currentMenu.stock - item.quantity }).eq('id', item.menu_id);
        }

        res.status(201).json({
            status: "success",
            message: "Pesanan berhasil dibuat!",
            data: newOrder
        });

    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

exports.completeOrder = async (req, res) => {
    const { orderNumber } = req.params;

    try {
        const { data: order, error: orderErr } = await supabase
            .from('orders')
            .select('*')
            .eq('order_number', orderNumber)
            .single();

        if (orderErr || !order) {
            return res.status(404).json({ status: "error", message: "Pesanan tidak ditemukan" });
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
            await supabase
                .from('profiles')
                .update({ points: student.points + order.earned_points })
                .eq('id', order.student_id);
        }

        res.status(200).json({ 
            status: "success", 
            message: `Pesanan ${orderNumber} Selesai! Poin siswa berhasil ditambahkan.` 
        });

    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};