module.exports = function errorHandler(err, req, res, next) {
  console.error(err);

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