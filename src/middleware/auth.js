const { verifyToken } = require('../utils/jwt');

function authOptional(req, res, next) {
  const header = req.headers.authorization || '';
  const [, token] = header.split(' ');
  if (!token) return next();

  try {
    const payload = verifyToken(token);
    req.user = { id: payload.id, role: payload.role };
  } catch (err) {
    // token không hợp lệ/hết hạn -> coi như chưa đăng nhập
  }
  next();
}

function authRequired(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Bạn cần đăng nhập để thực hiện thao tác này.' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này.' });
    }
    next();
  };
}

module.exports = { authOptional, authRequired, requireRole };