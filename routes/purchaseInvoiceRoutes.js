const express = require('express');
const router = express.Router();
const protect = require('../middleware/protectMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validateMiddleware');
const { purchaseInvoiceCreateSchema } = require('../validations/purchaseInvoiceValidation');
const { checkSubscription } = require('../middleware/subscriptionMiddleware');
const {
    createPurchaseInvoice,
    listPurchaseInvoices,
    getPurchaseInvoice,
    cancelPurchaseInvoice,
    updatePurchaseInvoice
} = require('../controllers/purchaseInvoiceController');

router.use(protect, tenantMiddleware);
router.use(checkSubscription);

router.get('/', listPurchaseInvoices);
router.get('/:id', getPurchaseInvoice);
router.post('/', authorize('admin', 'editor'), validate(purchaseInvoiceCreateSchema), createPurchaseInvoice);
router.put('/:id', authorize('admin', 'editor'), updatePurchaseInvoice);
router.post('/:id/cancel', authorize('admin', 'editor'), cancelPurchaseInvoice);

module.exports = router;
