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
const validate = require('../middleware/validateMiddleware');
const { itemSchema, expenseSchema } = require('../validations/itemValidation');

const { checkSubscription, checkLimit } = require('../middleware/subscriptionMiddleware');

// تطبيق حماية JWT وعزل العميل على جميع المسارات
router.use(protect, tenantMiddleware);
router.use(checkSubscription);

router.get('/', getAllItems);
router.get('/search', searchItems);
router.post('/', checkLimit('items'), validate(itemSchema), addItem);
router.put('/:id', validate(itemSchema), updateItem);
router.delete('/:id', deleteItem);
router.get('/export', exportToExcel);
router.get('/download/:id', downloadExcel);

// مصروفات
router.put('/expenses/:id', validate(expenseSchema), updateExpense);
router.delete('/expenses/:id', deleteExpense);

module.exports = router;
