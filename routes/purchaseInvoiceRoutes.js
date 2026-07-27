const express = require('express');
const router = express.Router();
const protect = require('../middleware/protectMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validateMiddleware');
const { purchaseInvoiceCreateSchema, purchaseInvoiceUpdateSchema } = require('../validations/purchaseInvoiceValidation');
const { createPaymentSchema } = require('../validations/purchaseInvoicePaymentValidation');
const { checkSubscription } = require('../middleware/subscriptionMiddleware');
const {
    createPurchaseInvoice,
    listPurchaseInvoices,
    getPurchaseInvoice,
    cancelPurchaseInvoice,
    updatePurchaseInvoice,
    getPurchaseInvoicesBySupplier,
    exportPurchaseInvoicesToExcel
} = require('../controllers/purchaseInvoiceController');
const {
    addPayment,
    listPayments,
    voidPayment
} = require('../controllers/purchaseInvoicePaymentController');

router.use(protect, tenantMiddleware);
router.use(checkSubscription);

router.get('/export', authorize('admin', 'editor'), exportPurchaseInvoicesToExcel);
router.get('/', listPurchaseInvoices);
router.get('/supplier/:supplierId', getPurchaseInvoicesBySupplier);
router.get('/:id/payments', listPayments);
router.post('/:id/payments', authorize('admin', 'editor'), validate(createPaymentSchema), addPayment);
router.post('/:id/payments/:paymentId/void', authorize('admin', 'editor'), voidPayment);
router.get('/:id', getPurchaseInvoice);
router.post('/', authorize('admin', 'editor'), validate(purchaseInvoiceCreateSchema), createPurchaseInvoice);
router.put('/:id', authorize('admin', 'editor'), validate(purchaseInvoiceUpdateSchema), updatePurchaseInvoice);
router.post('/:id/cancel', authorize('admin', 'editor'), cancelPurchaseInvoice);

module.exports = router;
