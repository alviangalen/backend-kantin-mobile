const express = require('express');
const router = express.Router();
const standController = require('../controllers/standController');
const auth = require('../middlewares/authMiddleware');

// 1. Public / Siswa browse all stands
router.get('/', standController.getAllStands);

// 2. Seller Specific Routes (Diletakkan sebelum /:standId agar tidak bentrok)
router.get('/me', auth.protect, auth.restrictTo('SELLER'), standController.getMyStand);
router.patch('/me', auth.protect, auth.restrictTo('SELLER'), standController.updateMyStand);
router.put('/me', auth.protect, auth.restrictTo('SELLER'), standController.updateMyStand);

// 3. Seller Revenue & Omset Harian
router.get('/revenue', auth.protect, auth.restrictTo('SELLER', 'ADMIN'), standController.getSellerRevenue);
router.get('/me/revenue', auth.protect, auth.restrictTo('SELLER', 'ADMIN'), standController.getSellerRevenue);

// 4. Stand by ID
router.get('/:standId/menus', standController.getMenusByStand);
router.patch('/:standId', auth.protect, auth.restrictTo('SELLER', 'ADMIN'), standController.updateStandById);

module.exports = router;
