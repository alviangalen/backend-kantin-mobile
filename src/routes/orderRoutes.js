const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const auth = require('../middlewares/authMiddleware');

// Endpoint Checkout / Create Order (mendukung / dan /checkout)
router.post('/', auth.protect, auth.restrictTo('STUDENT'), orderController.createOrder);
router.post('/checkout', auth.protect, auth.restrictTo('STUDENT'), orderController.createOrder);

// Endpoint Riwayat Pesanan Siswa & Penjual
router.get('/', auth.protect, orderController.getOrders);

// Endpoint Detail Satu Pesanan
router.get('/:orderId', auth.protect, orderController.getOrderDetail);

// Endpoint Tambah / Perbarui Catatan Pesanan
router.patch('/:orderId/note', auth.protect, orderController.updateOrderNote);
router.put('/:orderId/note', auth.protect, orderController.updateOrderNote);

// Endpoint Pembatalan Pesanan oleh Siswa / Penjual / Admin
router.patch('/:orderId/cancel', auth.protect, orderController.cancelOrder);
router.post('/:orderId/cancel', auth.protect, orderController.cancelOrder);

// Endpoint Update Status Pesanan (COOKING, READY, COMPLETED, dll)
// Jika siswa memanggil status CANCELLED, izinkan lewat cancelOrder
const handleStatusUpdate = (req, res, next) => {
    if (req.user.role === 'STUDENT') {
        const s = (req.body.status || '').toUpperCase();
        if (s === 'CANCELLED') return orderController.cancelOrder(req, res);
        return res.status(403).json({ status: "error", message: "Siswa hanya memiliki akses untuk membatalkan pesanan" });
    }
    next();
};

router.patch('/:orderId/status', auth.protect, handleStatusUpdate, orderController.updateOrderStatus);
router.put('/:orderId/status', auth.protect, handleStatusUpdate, orderController.updateOrderStatus);

// Endpoint Pickup / Selesaikan Pesanan (mendukung /:orderId/pickup dan /:orderNumber/complete)
router.patch('/:orderId/pickup', auth.protect, auth.restrictTo('SELLER', 'ADMIN'), orderController.completeOrder);
router.patch('/:orderNumber/complete', auth.protect, auth.restrictTo('SELLER', 'ADMIN'), orderController.completeOrder);

module.exports = router;
