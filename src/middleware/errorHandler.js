// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, next) {
  // eslint-disable-next-line no-console
  console.error(err);

  // Postgres RLS/constraint errors mapped to sensible HTTP codes.
  if (err.code === '42501' || /permission denied/i.test(err.message || '')) {
    return res.status(403).json({ error: 'Không có quyền truy cập dữ liệu này.' });
  }
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Dữ liệu đã tồn tại (trùng khóa duy nhất).' });
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Dữ liệu tham chiếu không hợp lệ.' });
  }
  if (err.code === '23514') {
    return res.status(400).json({ error: 'Dữ liệu không hợp lệ (vi phạm ràng buộc).' });
  }

  res.status(err.status || 500).json({ error: err.message || 'Lỗi hệ thống.' });
};
