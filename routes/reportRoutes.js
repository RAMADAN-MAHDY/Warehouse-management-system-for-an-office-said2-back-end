const express = require('express');
const router = express.Router();
const protect = require('../middleware/protectMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');
const {
    getSummary,
    getSalesReport,
    getInventoryReport,
    getProfitReport
} = require('../controllers/reportController');
const validate = require('../middleware/validateMiddleware');
const { reportQuerySchema } = require('../validations/reportValidation');

// جميع مسارات التقارير محمية بـ JWT وتنفيذ عزل العميل
router.use(protect, tenantMiddleware);

// GET /api/reports/summary - ملخص شامل للعميل
router.get('/summary', validate(reportQuerySchema, 'query'), getSummary);

// GET /api/reports/sales - تقرير المبيعات
router.get('/sales', validate(reportQuerySchema, 'query'), getSalesReport);

// GET /api/reports/inventory - تقرير المخزون
router.get('/inventory', validate(reportQuerySchema, 'query'), getInventoryReport);

// GET /api/reports/profit - تقرير الأرباح
router.get('/profit', validate(reportQuerySchema, 'query'), getProfitReport);

module.exports = router;
