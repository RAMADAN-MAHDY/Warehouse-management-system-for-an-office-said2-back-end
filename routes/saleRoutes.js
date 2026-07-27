const express = require('express');
const router = express.Router();
const protect = require('../middleware/protectMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');
const {
    addSaleInvoice,
    getSaleInvoices,
    updateSaleInvoice,
    deleteSaleInvoice,
    bulkDeleteSaleInvoices,
    exportSalesToExcel,
    getSalesByRepresentative,
    getSaleInvoiceAuditLogs,
    addSaleInvoicePayment,
    addSaleInvoiceGroup,
    addGroupPayment,
    getSaleInvoiceGroup
} = require('../controllers/saleController');
const validate = require('../middleware/validateMiddleware');
const {
    saleSchema,
    updateSaleSchema,
    bulkDeleteSchema,
    addSaleInvoicePaymentSchema,
    addSaleGroupSchema,
    addGroupPaymentSchema
} = require('../validations/saleValidation');

const { checkSubscription, checkLimit } = require('../middleware/subscriptionMiddleware');

// تطبيق حماية JWT وعزل العميل على جميع المسارات
router.use(protect, tenantMiddleware);
router.use(checkSubscription);

router.get('/export', exportSalesToExcel);
router.get('/representative/:representativeId', getSalesByRepresentative);
router.get('/group/:groupId', getSaleInvoiceGroup);
router.post('/group', checkLimit('sales'), validate(addSaleGroupSchema), addSaleInvoiceGroup);
router.post('/group/:groupId/payment', validate(addGroupPaymentSchema), addGroupPayment);
router.get('/:id/audit-logs', getSaleInvoiceAuditLogs);
router.post('/:id/payment', validate(addSaleInvoicePaymentSchema), addSaleInvoicePayment);
router.post('/', checkLimit('sales'), validate(saleSchema), addSaleInvoice);
router.get('/', getSaleInvoices);
router.put('/:id', validate(updateSaleSchema), updateSaleInvoice);
router.delete('/:id', deleteSaleInvoice);
router.post('/bulk-delete', validate(bulkDeleteSchema), bulkDeleteSaleInvoices);

module.exports = router;
