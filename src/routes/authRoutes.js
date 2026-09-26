const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const auth = require('../middlewares/authMiddleware');

// Endpoint get OTP Authentication
router.post('/request-otp', authController.requestOtp);

// Endpoint OTP Authentication Verification
router.post('/verify-otp', authController.verifyOtp);

// Endpoint Lengkapi Profil / Registrasi Pengguna
router.post('/register', authController.register);
router.post('/complete-profile', authController.register);

// Endpoint Mendapatkan profil sendiri via auth
router.get('/me', auth.protect, authController.getMe);

module.exports = router;
