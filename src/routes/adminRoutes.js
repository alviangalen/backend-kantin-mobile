const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const auth = require('../middlewares/authMiddleware');

// Seluruh route admin diproteksi JWT dan wajib role ADMIN
router.use(auth.protect);
router.use(auth.restrictTo('ADMIN'));

// =============================================================================
// 1. MANAJEMEN STAND & SELLER (SEPAKET & TERINTEGRASI)
// =============================================================================
// Tambah stand & seller sekaligus (sepaket)
router.post('/stands', adminController.createStandAndSeller);
// Ambil seluruh daftar stand
router.get('/stands', adminController.getAllStands);
// Ambil detail satu stand
router.get('/stands/:standId', adminController.getStandDetail);
// Update data stand
router.patch('/stands/:standId', adminController.updateStand);
router.put('/stands/:standId', adminController.updateStand);
// Hapus stand (akun seller tetap ada)
router.delete('/stands/:standId', adminController.deleteStand);

// =============================================================================
// 2. MANAJEMEN AKUN PENJUAL (SELLER)
// =============================================================================
// Tambah seller + stand sekaligus (alias endpoint)
router.post('/sellers', adminController.createStandAndSeller);
// Ambil seluruh daftar akun penjual
router.get('/sellers', adminController.getAllSellers);
// Hapus akun penjual beserta stand-nya
router.delete('/sellers/:sellerId', adminController.deleteSeller);

// =============================================================================
// 3. REKAPITULASI PEMASUKAN & KEUANGAN KANTIN (REVENUE)
// =============================================================================
// Total pemasukan semua stand dan performa per stand
router.get('/revenue', adminController.getRevenueAnalytics);
// Rincian pemasukan satu stand (QRIS, Tunai, Siap Cair)
router.get('/revenue/:standId', adminController.getStandRevenueDetail);

// =============================================================================
// 4. MANAJEMEN SISWA & SUSPEND AKUN
// =============================================================================
// Ambil seluruh daftar siswa (bisa search, filter kelas, & filter status aktif/suspend)
router.get('/students', adminController.getAllStudents);
// Tambah siswa baru secara manual
router.post('/students', adminController.createStudent);
// Ambil detail siswa beserta riwayat pesanan
router.get('/students/:studentId', adminController.getStudentDetail);
// Update data siswa
router.patch('/students/:studentId', adminController.updateStudent);
router.put('/students/:studentId', adminController.updateStudent);
// Suspend / Aktifkan akun siswa
router.patch('/students/:studentId/status', adminController.toggleStudentStatus);
// Hapus akun siswa
router.delete('/students/:studentId', adminController.deleteStudent);

// =============================================================================
// 5. MANAJEMEN KELAS & STATISTIK
// =============================================================================
// Rekapitulasi daftar kelas dan jumlah siswa per kelas
router.get('/classes', adminController.getClasses);

// =============================================================================
// 6. PELANGGARAN SISWA (VIOLATIONS)
// =============================================================================
// Ambil daftar pelanggaran siswa
router.get('/violations', adminController.getViolations);
// Tambah poin/catatan pelanggaran ke siswa
router.post('/violations/:userId', adminController.addViolation);

module.exports = router;
