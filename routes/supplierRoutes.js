const express = require('express');
const router = express.Router();
const protect = require('../middleware/protectMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validateMiddleware');
const { supplierCreateSchema } = require('../validations/supplierValidation');
const { checkSubscription } = require('../middleware/subscriptionMiddleware');
const { listSuppliers, createSupplier } = require('../controllers/supplierController');

router.use(protect, tenantMiddleware);
router.use(checkSubscription);

router.get('/', listSuppliers);
router.post('/', authorize('admin', 'editor'), validate(supplierCreateSchema), createSupplier);

module.exports = router;
