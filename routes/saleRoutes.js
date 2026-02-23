const express = require('express');
const router = express.Router();
const protect = require('../middleware/protectMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');
const {
    addSaleInvoice,
    getSaleInvoices,
    updateSaleInvoice,
    deleteSaleInvoice,
    bulkDeleteSaleInvoices
} = require('../controllers/saleController');

// تطبيق حماية JWT وعزل العميل على جميع المسارات
router.use(protect, tenantMiddleware);

router.post('/', addSaleInvoice);
router.get('/', getSaleInvoices);
router.put('/:id', updateSaleInvoice);
router.delete('/:id', deleteSaleInvoice);
router.post('/bulk-delete', bulkDeleteSaleInvoices);

module.exports = router;
