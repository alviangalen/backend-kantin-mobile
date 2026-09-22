const cron = require('node-cron');
const supabase = require('../config/database');

cron.schedule('0 15 * * *', async () => {
    console.log('[CRON JOB] Memulai patroli pesanan menggantung...');

    try {
        const { data: abandonedOrders, error: fetchError } = await supabase
            .from('orders')
            .select('id, student_id, order_number')
            .eq('payment_method', 'CASH')
            .eq('status', 'READY_FOR_PICKUP');

        if (fetchError) throw fetchError;

        if (!abandonedOrders || abandonedOrders.length === 0) {
            console.log('[CRON JOB] Aman. Tidak ada pesanan Hit & Run hari ini.');
            return;
        }

        console.log(`[CRON JOB] Ditemukan ${abandonedOrders.length} pesanan bermasalah. Mengeksekusi penalti...`);

        for (const order of abandonedOrders) {
            await supabase
                .from('orders')
                .update({ status: 'CANCELLED', updated_at: new Date() })
                .eq('id', order.id);

            const { data: student } = await supabase
                .from('profiles')
                .select('violation_count')
                .eq('id', order.student_id)
                .single();

            const newViolationCount = (student.violation_count || 0) + 1;

            await supabase
                .from('profiles')
                .update({ violation_count: newViolationCount })
                .eq('id', order.student_id);

            console.log(`[PENALTI] Pesanan ${order.order_number} dibatalkan. Pelanggaran siswa ditambahkan menjadi: ${newViolationCount}`);

        }

        console.log('[CRON JOB] Patroli selesai.');

    } catch (err) {
        console.error('[CRON JOB ERROR]', err.message);
    }
}, {
    timezone: "Asia/Jakarta" 
});