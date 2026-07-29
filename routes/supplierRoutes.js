const express = require('express');
const router = express.Router();
const protect = require('../middleware/protectMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validateMiddleware');
const { supplierCreateSchema, supplierUpdateSchema } = require('../validations/supplierValidation');
const { checkSubscription } = require('../middleware/subscriptionMiddleware');
const { listSuppliers, createSupplier, getSupplier, updateSupplier, deleteSupplier, getSupplierPayments } = require('../controllers/supplierController');

router.use(protect, tenantMiddleware);
router.use(checkSubscription);

router.get('/', listSuppliers);
router.get('/:id/payments', getSupplierPayments);
router.get('/:id', getSupplier);
router.post('/', authorize('admin', 'editor'), validate(supplierCreateSchema), createSupplier);
router.put('/:id', authorize('admin', 'editor'), validate(supplierUpdateSchema), updateSupplier);
router.delete('/:id', authorize('admin', 'editor'), deleteSupplier);

module.exports = router;
