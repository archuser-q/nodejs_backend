require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  databaseUrl: process.env.DATABASE_URL,
  // Dùng cho vòng lặp ghép cặp theo lô (server.js) — đây là tiến trình HỆ
  // THỐNG (không đại diện cho 1 user cụ thể nào), cần thấy toàn bộ đơn/thợ
  // trên nền tảng để giải bài toán gán tối ưu toàn cục, nên dùng owner
  // (bypass RLS) thay vì giả vờ là 1 admin cụ thể.
  databaseOwnerUrl: process.env.DATABASE_OWNER_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
};
