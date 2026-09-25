const { verifyToken } = require('../utils/jwt');

// Gắn req.user = { id, role } nếu có Bearer token hợp lệ. KHÔNG bắt buộc
// phải đăng nhập ở đây — dbContext sẽ set role 'anonymous' nếu không có
// req.user, và RLS ở DB sẽ tự chặn các thao tác cần đăng nhập.
function authOptional(req, res, next) {
  const header = req.headers.authorization || '';
  const [, token] = header.split(' ');
  if (!token) return next();

  try {
    const payload = verifyToken(token); // { id, role, iat, exp }
    req.user = { id: payload.id, role: payload.role };
  } catch (err) {
    // Token không hợp lệ/hết hạn -> coi như anonymous, không throw ở đây
    // để các route public vẫn hoạt động.
  }
  next();
}

// Dùng cho route bắt buộc phải đăng nhập.
function authRequired(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Bạn cần đăng nhập để thực hiện thao tác này.' });
  }
  next();
}

// Dùng cho route chỉ cho phép 1 hoặc nhiều role cụ thể (ngoài RLS, để trả
// lỗi rõ ràng sớm thay vì chờ DB từ chối).
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này.' });
    }
    next();
  };
}

module.exports = { authOptional, authRequired, requireRole };
