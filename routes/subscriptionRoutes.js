const express = require('express');
const router = express.Router();
const protect = require('../middleware/protectMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');
const { getSubscriptionStatus, submitPayment, activateSubscription } = require('../controllers/subscriptionController');
const isSuperAdmin = require('../middleware/superadminMiddleware');

router.use(protect, tenantMiddleware);

router.get('/status', getSubscriptionStatus);
router.post('/pay', submitPayment);

// مسار للمسؤول فقط لتفعيل الاشتراكات (لأغراض الاختبار أو الإدارة)
router.post('/activate/:transactionId', isSuperAdmin, activateSubscription);

module.exports = router;
