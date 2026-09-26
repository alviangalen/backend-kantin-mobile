const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const auth = require('../middlewares/authMiddleware');

// Endpoint Get Profile User yang sedang login
router.get('/me', auth.protect, authController.getMe);

// Endpoint Update Profile User
router.put('/me', auth.protect, authController.updateMe);
router.patch('/me', auth.protect, authController.updateMe);

module.exports = router;
