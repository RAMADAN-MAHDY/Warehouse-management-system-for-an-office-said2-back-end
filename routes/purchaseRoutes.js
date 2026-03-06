const express = require('express');
const router = express.Router();
const protect = require('../middleware/protectMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');
const authorize = require('../middleware/authorize');
const { list, create, update, remove, addPurchaseAdjustmentApi } = require('../controllers/purchaseController');
const validate = require('../middleware/validateMiddleware');
const { purchaseSchema } = require('../validations/purchaseValidation');
const { profitAdjustmentSchema } = require('../validations/reportValidation');

const { checkSubscription, checkLimit } = require('../middleware/subscriptionMiddleware');

// تطبيق حماية JWT وعزل العميل على جميع المسارات
router.use(protect, tenantMiddleware);
router.use(checkSubscription);

router.get('/', list);
router.post('/', authorize('admin', 'editor'), checkLimit('sales'), validate(purchaseSchema), create);
router.post('/adjust', authorize('admin', 'editor'), validate(profitAdjustmentSchema), addPurchaseAdjustmentApi);
router.put('/:id', authorize('admin', 'editor'), validate(purchaseSchema), update);
router.delete('/:id', authorize('admin'), remove);

module.exports = router;
