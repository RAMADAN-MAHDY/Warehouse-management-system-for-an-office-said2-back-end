const express = require('express');
const router = express.Router();
const protect = require('../middleware/protectMiddleware');
const isSuperAdmin = require('../middleware/superadminMiddleware');
const {
    getSystemStats,
    getAllUsers,
    updateUserStatus,
    deleteUserPermanently,
    approveTransaction,
    rejectTransaction,
    createPlan,
    getPlans,
    updatePlan,
    deletePlan,
    getAllTransactions,
    getAuditLogs,
    deleteAuditLogs,
    exportUsersExcel,
    exportTransactionsExcel,
    updateUserSubscription
} = require('../controllers/superadminController');

// حماية جميع المسارات بالسوبر أدمن
router.use(protect, isSuperAdmin);

// الإحصائيات
router.get('/stats', getSystemStats);

// التصدير
router.get('/users/export', exportUsersExcel);
router.get('/transactions/export', exportTransactionsExcel);

// المستخدمين والاشتراكات
router.get('/users', getAllUsers);
router.put('/users/:userId', updateUserStatus);
router.delete('/users/:userId', deleteUserPermanently);
router.put('/users/:userId/subscription', updateUserSubscription);

// الخطط
router.get('/plans', getPlans);
router.post('/plans', createPlan);
router.put('/plans/:id', updatePlan);
router.delete('/plans/:id', deletePlan);

// المدفوعات والتدقيق
router.get('/transactions', getAllTransactions);
router.post('/transactions/:transactionId/approve', approveTransaction);
router.post('/transactions/:transactionId/reject', rejectTransaction);
router.get('/audit-logs', getAuditLogs);
router.post('/audit-logs/bulk-delete', deleteAuditLogs);

module.exports = router;
