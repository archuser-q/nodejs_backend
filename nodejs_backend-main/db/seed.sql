-- Seed dữ liệu mẫu tối thiểu để test nhanh. Chạy bằng thonhanh_owner
-- (owner bypass RLS mặc định vì không còn FORCE ROW LEVEL SECURITY — xem
-- giải thích trong schema.sql) SAU khi đã chạy schema.sql.
--
-- BUG THẬT ĐÃ SỬA: bản gốc seed 3 dịch vụ đa ngành (điện/nước/điều hoà) —
-- nhóm đã chốt CHỈ LÀM ĐIỆN (xem đề cương + App Thợ đã build), nên đổi
-- sang seed đúng các hạng mục điện mà App Thợ đang dùng (khớp
-- IssueCategory trong models.ts của App Thợ — dịch đúng nhãn tiếng Việt để
-- 3 app hiển thị đồng nhất, tránh mỗi app tự đặt tên khác nhau cho cùng 1
-- hạng mục).
INSERT INTO services (name, category) VALUES
  ('Mất điện', 'electrical'),
  ('Chập CB', 'electrical'),
  ('Lắp đặt mới', 'electrical'),
  ('Sửa thiết bị điện', 'electrical'),
  ('Điện công nghiệp', 'electrical'),
  ('Khác (điện)', 'electrical');

-- Khuyến nghị: tạo user qua API (POST /api/auth/google hoặc
-- /api/auth/email/verify-code hoặc /api/auth/register) để đi đúng qua các
-- function SECURITY DEFINER (auth_upsert_google_user/auth_register_user...)
-- thay vì INSERT tay — INSERT tay vào `users` lúc chưa đăng nhập sẽ dính
-- đúng bug RLS+RETURNING đã ghi chú trong schema.sql.

-- Trọng số Weighted Scoring khớp đề cương mục 6.1 (khoảng cách/trust
-- score/tỷ lệ hoàn thành/tải công việc) + hạn phản hồi offer khớp App Thợ
-- đang mock (45s) + chu kỳ batch trong khoảng đề cương gợi ý (5-10s).
INSERT INTO matching_config (weight_distance, weight_trust_score, weight_completion_rate, weight_workload, mode, offer_ttl_seconds, batch_interval_seconds)
VALUES (0.35, 0.35, 0.15, 0.15, 'instant', 45, 8);
