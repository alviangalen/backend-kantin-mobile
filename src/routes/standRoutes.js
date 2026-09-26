const express = require('express');
const router = express.Router();
const standController = require('../controllers/standController');

// Endpoint Get All Stands
router.get('/', standController.getAllStands);

module.exports = router;
