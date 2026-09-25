// Bọc controller async để tự động forward lỗi cho errorHandler, tránh phải
// try/catch lặp lại ở từng controller.
module.exports = function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
