const express = require('express');
const router = express.Router();
const menuController = require('../controllers/menuController');
const auth = require('../middlewares/authMiddleware');

// 1. Get all menus untuk customer / siswa
router.get('/', auth.protect, menuController.getAllMenus);

// 2. Get all menus milik stand seller yang sedang login (diletakkan sebelum /:menuId)
router.get('/me', auth.protect, auth.restrictTo('SELLER'), menuController.getMyMenus);

// 3. Tambah menu baru oleh seller
router.post('/', auth.protect, auth.restrictTo('SELLER'), menuController.addMenu);

// 4. Update stok menu secara spesifik
router.patch('/:menuId/stock', auth.protect, auth.restrictTo('SELLER'), menuController.updateMenuStock);

// 5. Update data menu
router.patch('/:menuId', auth.protect, auth.restrictTo('SELLER'), menuController.updateMenu);
router.put('/:menuId', auth.protect, auth.restrictTo('SELLER'), menuController.updateMenu);

// 6. Hapus menu
router.delete('/:menuId', auth.protect, auth.restrictTo('SELLER'), menuController.deleteMenu);

module.exports = router;
