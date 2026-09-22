const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const auth = require('../middlewares/authMiddleware');

router.post('/checkout', auth.protect, auth.restrictTo('STUDENT'), orderController.createOrder);

router.patch('/:orderNumber/complete', auth.protect, auth.restrictTo('SELLER', 'ADMIN'), orderController.completeOrder);

module.exports = router;