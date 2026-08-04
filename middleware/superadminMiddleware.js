const isSuperAdmin = (req, res, next) => {
    if (req.user && (req.user.role === 'superadmin' || req.user.role === 'owner')) {
        next();
    } else {
        res.status(403).json({
            status: false,
            message: 'غير مسموح لك بالوصول لهذه المنطقة. صلاحيات سوبر أدمن أو مالك مطلوبة.'
        });
    }
};

module.exports = isSuperAdmin;
