const express = require('express');
const router = express.Router();
const menuController = require('../controllers/menuController');
const auth = require('../middlewares/authMiddleware');

router.get('/', auth.protect, menuController.getAllMenus);

router.post('/', auth.protect, auth.restrictTo('SELLER'), menuController.addMenu);

module.exports = router;