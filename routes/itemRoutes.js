const express = require('express');
const router = express.Router();
const protect = require('../middleware/protectMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');
const {
    getAllItems,
    getLowStockItems,
    searchItems,
    addItem,
    updateItem,
    exportToExcel,
    exportLowStockToExcel,
    deleteItem,
    updateExpense,
    deleteExpense,
    getItemMovements
} = require('../controllers/itemController');
const validate = require('../middleware/validateMiddleware');
const { itemCreateSchema, itemUpdateSchema, expenseSchema } = require('../validations/itemValidation');
const { checkSubscription, checkLimit } = require('../middleware/subscriptionMiddleware');

// تطبيق حماية JWT وعزل العميل على جميع المسارات
router.use(protect, tenantMiddleware);
router.use(checkSubscription);

router.get('/', getAllItems);
router.get('/low-stock', getLowStockItems);
router.get('/low-stock/export', exportLowStockToExcel);
router.get('/search', searchItems);
router.get('/:id/movements', getItemMovements);
router.post('/', checkLimit('items'), validate(itemCreateSchema), addItem);
router.put('/:id', validate(itemUpdateSchema), updateItem);
router.delete('/:id', deleteItem);
router.get('/export', exportToExcel);

// مصروفات
router.put('/expenses/:id', validate(expenseSchema), updateExpense);
router.delete('/expenses/:id', deleteExpense);

module.exports = router;
