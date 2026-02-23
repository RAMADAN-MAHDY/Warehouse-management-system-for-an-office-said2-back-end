/**
 * Tenant Middleware - عزل البيانات على مستوى العميل
 * يتأكد من وجود customerId صالح في كل طلب محمي
 * يُستخدم بعد protectMiddleware
 */
const tenantMiddleware = (req, res, next) => {
    const customerId = req.customerId || req.user?.customerId;

    if (!customerId) {
        return res.status(403).json({
            status: false,
            message: 'Access denied: No Customer ID associated with this account. Please contact support.',
            data: null
        });
    }

    // تعيين customerId على req لضمان استخدامه في جميع العمليات
    req.customerId = customerId;
    next();
};

module.exports = tenantMiddleware;      
