# THỢ NHANH — Backend (Node.js + Express + PostgreSQL RLS)

Backend REST API dựng theo ERD của đồ án, bật **Row-Level Security (RLS)**
ở tầng PostgreSQL: mỗi user (customer/worker/admin) chỉ thấy/sửa được
đúng phần dữ liệu của mình, kể cả khi có lỗi logic ở tầng ứng dụng.

## 1. Hai điều chỉnh so với ERD gốc

1. `payments.order_id` thay cho `payments.customer_user_id` — 1 payment
   gắn với 1 đơn hàng cụ thể; suy ra khách hàng qua `orders.customer_user_id`.
2. `orders.latitude` / `orders.longitude` — vị trí thực hiện sửa chữa của
   **chính đơn hàng đó** (có thể khác vị trí hồ sơ khách trong `users`),
   cần thiết cho thuật toán geospatial indexing/matching.

Nếu muốn giữ đúng 100% ERD gốc, sửa lại 2 chỗ này trong `db/schema.sql`
trước khi chạy.

## 2. Cài đặt

```bash
npm install
cp .env.example .env
# sửa .env: mật khẩu DB, JWT_SECRET
```

Tạo database rỗng trong PostgreSQL (>= 13), ví dụ:

```bash
createdb thonhanh
```

Chạy migration bằng role **owner** (script tự tạo 2 role `thonhanh_owner`
và `thonhanh_app` nếu chưa có — cần quyền superuser cho lần chạy đầu):

```bash
psql "postgresql://<superuser>@localhost:5432/thonhanh" -f db/schema.sql
# (tuỳ chọn) dữ liệu mẫu:
psql "postgresql://<superuser>@localhost:5432/thonhanh" -f db/seed.sql
```

Sau đó đổi mật khẩu 2 role trong PostgreSQL và cập nhật lại `.env` cho
khớp (`DATABASE_URL` dùng role `thonhanh_app`).

```bash
npm run dev   # hoặc npm start
```

Kiểm tra: `GET http://localhost:3000/health` → `{ "status": "ok" }`

## 3. Cách RLS hoạt động trong project này

- App Node.js kết nối bằng role **`thonhanh_app`** — role này **không phải
  chủ sở hữu bảng**, nên PostgreSQL luôn áp policy RLS cho mọi câu lệnh
  role này chạy (không cần nhớ bật `FORCE` mỗi query).
- Middleware `src/middleware/dbContext.js` mượn 1 client cho **mỗi
  request**, mở transaction, và chạy:
  ```sql
  SELECT set_config('app.current_user_id', '<id>', true);
  SELECT set_config('app.current_user_role', '<role>', true);
  ```
  Các policy trong `db/schema.sql` đọc lại 2 giá trị này qua
  `current_user_id()` / `current_user_role()` để quyết định quyền.
- Transaction tự COMMIT nếu response thành công, tự ROLLBACK nếu lỗi
  (status >= 400) — controller không cần tự `BEGIN/COMMIT`.
- Đăng nhập là **trường hợp đặc biệt**: lúc đó user chưa có JWT nên
  không SELECT được bảng `users` theo `username` qua RLS thông thường.
  `db/schema.sql` định nghĩa hàm `auth_lookup_user()` dạng
  `SECURITY DEFINER` chỉ để phục vụ đúng bước xác thực, không mở toang
  bảng `users`.

## 4. Cấu trúc thư mục

```
db/
  schema.sql   -- toàn bộ DDL + RLS policies (đọc kỹ, có chú thích)
  seed.sql     -- dữ liệu mẫu tối thiểu
src/
  config/      -- đọc .env, tạo pg Pool
  middleware/  -- auth (JWT), dbContext (RLS session), errorHandler
  controllers/ -- logic nghiệp vụ, 1 file / entity
  routes/      -- khai báo endpoint, gắn middleware theo route
  app.js       -- lắp ráp middleware + router
  server.js    -- điểm khởi chạy
```

## 5. Endpoint chính (tóm tắt)

| Method | Path | Ai gọi được | Ghi chú |
|---|---|---|---|
| POST | /api/auth/register | ai cũng gọi được | role: customer/worker |
| POST | /api/auth/login | ai cũng gọi được | trả JWT |
| GET/PATCH | /api/users/me | đã đăng nhập | |
| GET | /api/services | ai cũng gọi được | danh mục dịch vụ |
| GET/POST | /api/worker-services | GET public, POST worker | dùng cho matching |
| POST | /api/orders | customer | tạo đơn + repair_requests |
| GET | /api/orders, /api/orders/:id | đã đăng nhập | RLS tự lọc theo vai trò |
| PATCH | /api/orders/:id/status | liên quan tới đơn | tự ghi order_history |
| PATCH | /api/orders/:id/assign | admin | gán thợ theo kết quả matching |
| POST | /api/orders/:id/payments | customer | |
| PATCH | /api/payments/:id/status | admin | callback cổng thanh toán sandbox |
| POST | /api/orders/:id/quotes | worker | báo giá phát sinh |
| PATCH | /api/quotes/:id/status | customer | accept/reject |
| GET/POST | /api/workers/:id/reviews | GET public, POST customer | đầu vào cho trust score |
| GET | /api/orders/:id/history | liên quan tới đơn | audit trail trạng thái |
| GET/PUT | /api/admin/matching-config | admin | trọng số thuật toán ghép cặp |

## 6. Việc còn để lại cho các bước sau (thuật toán)

Project này **chỉ dựng khung CRUD + RLS**, chưa cài 3 thuật toán lõi của
đồ án (matching, geospatial indexing, trust score) — đúng như bạn yêu cầu
"để thuật toán sau". Các bảng/cột cần thiết đã có sẵn để cắm thuật toán
vào:
- Matching: `worker_services.trust_score`, `orders.latitude/longitude`,
  `users.latitude/longitude`, `matching_config`.
- Trust score: `reviews.rating_score`, `reviews.created_at` (recency).
- Geospatial indexing: toạ độ số thực ở `orders` và `users`.
