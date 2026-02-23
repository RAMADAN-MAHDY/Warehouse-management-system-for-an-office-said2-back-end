const express = require('express');
const router = express.Router();
const protect = require('../middleware/protectMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');
const {
    getAllItems,
    searchItems,
    addItem,
    updateItem,
    exportToExcel,
    downloadExcel,
    deleteItem,
    updateExpense,
    deleteExpense
} = require('../controllers/itemController');

// تطبيق حماية JWT وعزل العميل على جميع المسارات
router.use(protect, tenantMiddleware);

router.get('/', getAllItems);
router.get('/search', searchItems);
router.post('/', addItem);
router.put('/:id', updateItem);
router.delete('/:id', deleteItem);
router.get('/export', exportToExcel);
router.get('/download/:id', downloadExcel);

// مصروفات
router.put('/expenses/:id', updateExpense);
router.delete('/expenses/:id', deleteExpense);

module.exports = router;
