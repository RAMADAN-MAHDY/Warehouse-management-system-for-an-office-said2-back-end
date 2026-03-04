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
    exportSalesToExcel
} = require('../controllers/saleController');
const validate = require('../middleware/validateMiddleware');
const { saleSchema, updateSaleSchema, bulkDeleteSchema } = require('../validations/saleValidation');

// تطبيق حماية JWT وعزل العميل على جميع المسارات
router.use(protect, tenantMiddleware);

router.get('/export', exportSalesToExcel);
router.post('/', validate(saleSchema), addSaleInvoice);
router.get('/', getSaleInvoices);
router.put('/:id', validate(updateSaleSchema), updateSaleInvoice);
router.delete('/:id', deleteSaleInvoice);
router.post('/bulk-delete', validate(bulkDeleteSchema), bulkDeleteSaleInvoices);

module.exports = router;
