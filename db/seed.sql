-- Seed dữ liệu mẫu tối thiểu để test nhanh. Chạy bằng thonhanh_owner
-- (owner bypass RLS mặc định) SAU khi đã chạy schema.sql.
-- Mật khẩu mẫu: "password123" -> thay bằng hash thật khi test qua API đăng ký.

INSERT INTO services (name, category) VALUES
  ('Sửa điện', 'electrical'),
  ('Sửa nước', 'plumbing'),
  ('Sửa điều hòa', 'hvac');

-- Khuyến nghị: tạo user qua API POST /api/auth/register để password_hash
-- được sinh đúng (bcrypt), thay vì insert tay ở đây.

INSERT INTO matching_config (weight_distance, weight_trust_score, weight_price, mode)
VALUES (0.4, 0.4, 0.2, 'instant');
