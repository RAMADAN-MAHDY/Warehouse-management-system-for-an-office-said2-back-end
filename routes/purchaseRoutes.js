const express = require('express');
const router = express.Router();
const protect = require('../middleware/protectMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');
const authorize = require('../middleware/authorize');
const { list, create, update, remove } = require('../controllers/purchaseController');

// تطبيق حماية JWT وعزل العميل على جميع المسارات
router.use(protect, tenantMiddleware);

router.get('/', list);
router.post('/', authorize('admin', 'editor'), create);
router.put('/:id', authorize('admin', 'editor'), update);
router.delete('/:id', authorize('admin'), remove);

module.exports = router;
