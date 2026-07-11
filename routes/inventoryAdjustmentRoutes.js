const express = require('express');
const router = express.Router();
const protect = require('../middleware/protectMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');
const validate = require('../middleware/validateMiddleware');
const { checkSubscription } = require('../middleware/subscriptionMiddleware');
const { inventoryAdjustmentCreateSchema } = require('../validations/inventoryAdjustmentValidation');
const {
    createInventoryAdjustment,
    listInventoryAdjustments
} = require('../controllers/inventoryAdjustmentController');

router.use(protect, tenantMiddleware);
router.use(checkSubscription);

router.get('/', listInventoryAdjustments);
router.post('/', validate(inventoryAdjustmentCreateSchema), createInventoryAdjustment);

module.exports = router;
