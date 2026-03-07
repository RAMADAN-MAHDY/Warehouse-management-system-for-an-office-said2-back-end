const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const protect = require('../middleware/protectMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');

router.use(protect);
router.use(tenantMiddleware);

router.get('/', notificationController.getNotifications);
router.put('/:id/read', notificationController.markAsRead);
router.put('/read-all', notificationController.markAllAsRead);

module.exports = router;
