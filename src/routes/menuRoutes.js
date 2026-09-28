const express = require('express');
const router = express.Router();
const menuController = require('../controllers/menuController');
const auth = require('../middlewares/authMiddleware');
const { uploadSingleImage, uploadOptionalImage } = require('../middlewares/uploadMiddleware');

// 1. Get all menus untuk customer / siswa
router.get('/', auth.protect, menuController.getAllMenus);

// 2. Get all menus milik stand seller yang sedang login
router.get('/me', auth.protect, auth.restrictTo('SELLER'), menuController.getMyMenus);

// 3. Upload file foto produk secara standalone (mengembalikan URL publik Supabase)
router.post('/upload-image', auth.protect, auth.restrictTo('SELLER', 'ADMIN'), uploadSingleImage, menuController.uploadImage);

// 4. Tambah menu baru oleh seller (Mendukung upload file foto langsung via field 'image' atau kirim JSON)
router.post('/', auth.protect, auth.restrictTo('SELLER'), uploadOptionalImage, menuController.addMenu);

// 5. Update foto khusus pada menu tertentu
router.post('/:menuId/image', auth.protect, auth.restrictTo('SELLER'), uploadSingleImage, menuController.updateMenuImage);
router.put('/:menuId/image', auth.protect, auth.restrictTo('SELLER'), uploadSingleImage, menuController.updateMenuImage);

// 6. Hapus foto pada menu tertentu (set image_url = null)
router.delete('/:menuId/image', auth.protect, auth.restrictTo('SELLER'), menuController.deleteMenuImage);

// 7. Update stok menu secara spesifik
router.patch('/:menuId/stock', auth.protect, auth.restrictTo('SELLER'), menuController.updateMenuStock);

// 8. Update data menu (nama, harga, stok, ketersediaan, atau foto)
router.patch('/:menuId', auth.protect, auth.restrictTo('SELLER'), uploadOptionalImage, menuController.updateMenu);
router.put('/:menuId', auth.protect, auth.restrictTo('SELLER'), uploadOptionalImage, menuController.updateMenu);

// 9. Hapus menu beserta fotonya dari storage
router.delete('/:menuId', auth.protect, auth.restrictTo('SELLER'), menuController.deleteMenu);

module.exports = router;
