const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Endpoint get OTP Authentication
router.post('/request-otp', authController.requestOtp);

// Endpoint OTP Authentication Verification
router.post('/verify-otp', authController.verifyOtp);


module.exports = router;
