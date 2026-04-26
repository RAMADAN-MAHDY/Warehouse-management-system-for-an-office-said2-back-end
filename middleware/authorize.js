module.exports = (...roles) => {
  return (req, res, next) => {
    if (!req.user || (req.user.role !== 'superadmin' && !roles.includes(req.user.role))) {
      return res.status(403).json({ status: false, message: 'Forbidden', data: null });
    }
    next();
  };
};
