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

// Endpoint Pickup / Selesaikan Pesanan (mendukung /:orderId/pickup dan /:orderNumber/complete)
router.patch('/:orderId/pickup', auth.protect, auth.restrictTo('SELLER', 'ADMIN'), orderController.completeOrder);
router.patch('/:orderNumber/complete', auth.protect, auth.restrictTo('SELLER', 'ADMIN'), orderController.completeOrder);

module.exports = router;
