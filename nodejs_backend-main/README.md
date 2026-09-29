# THỢ NHANH — Backend (Node.js + Express + PostgreSQL RLS)

Backend REST API dựng theo ERD của đồ án, bật **Row-Level Security (RLS)**
ở tầng PostgreSQL: mỗi user (customer/worker/admin) chỉ thấy/sửa được
đúng phần dữ liệu của mình, kể cả khi có lỗi logic ở tầng ứng dụng.

## 0. Cập nhật lớn trong đợt này

Bản khung đầu (CRUD + RLS, chưa có thuật toán) đã được rà soát và test
**thật** trên PostgreSQL (không chỉ đọc code) — tìm ra 3 bug RLS khá sâu,
viết lại phần auth cho khớp App Thợ đã build, và cài đặt xong cả 2 chế độ
của thuật toán ghép cặp (mục 6.1 đề cương). Chi tiết từng phần nằm trong
comment tại `db/schema.sql`/`src/services/matching.js`, tóm tắt ở đây:

**3 bug RLS chỉ lộ ra khi chạy thật (không thấy nếu chỉ đọc SQL):**
1. `FORCE ROW LEVEL SECURITY` (bản gốc bật ở mọi bảng) làm HỎNG chính cơ
   chế `SECURITY DEFINER` mà file dùng để đăng nhập — khi chạy đúng bằng
   role owner KHÔNG PHẢI superuser (đúng như hướng dẫn), hàm xác thực luôn
   trả về rỗng dù user có tồn tại, không báo lỗi gì cả. Đã bỏ FORCE (app
   luôn nối bằng `thonhanh_app`, không phải owner, nên vẫn bị RLS áp dụng
   đầy đủ như thiết kế — bỏ FORCE không làm yếu bảo mật thật).
2. Thợ không tự "Nhận đơn" được — `orders_update`/`orders_select` bản gốc
   chỉ cho sửa/thấy đơn NẾU đã là `worker_user_id` của đơn đó, nhưng "Nhận
   đơn" chính là hành động SET `worker_user_id` lần đầu (gà và trứng). Đã
   thêm điều kiện "đang có offer 'offered' còn hiệu lực" vào cả 2 policy.
3. Thêm điều kiện đó gây **đệ quy vòng** giữa policy của `orders` và
   `order_offers` (2 bảng tham chiếu chéo nhau) — Postgres tự phát hiện và
   từ chối chạy. Phá vòng bằng 1 hàm `SECURITY DEFINER`
   (`worker_has_active_offer`) thay cho subquery RLS thường ở 1 chiều.

Cả 3 bug này được xác nhận đã sửa bằng cách chạy toàn bộ vòng đời 1 đơn
hàng thật qua **HTTP thật** (không phải mock): đăng ký Google → nộp hồ sơ →
bị chặn bật online khi chưa duyệt → duyệt → bật online → khách tạo đơn →
**tự động ghép cặp ngay lập tức** → thợ thấy offer → nhận đơn → in_progress
→ completed — toàn bộ chạy đúng, có log lại trong lúc làm nếu cần xem lại.

**Viết lại phần auth** — bản gốc chỉ có username/password. App Thợ (đã
build xong UI) dùng Google hoặc mã xác nhận qua email, KHÔNG mật khẩu nào
cả. Giữ email/password làm phương án 3 (đổi username → email) phòng khi
App Khách vẫn cần theo đúng đề cương gốc (SMS OTP + Google/Facebook) — đây
là quyết định cần bàn với Thành viên A, xem mục 7.

**Cài đặt xong thuật toán ghép cặp** (mục 6.1 đề cương) — xem mục 6 bên
dưới, đã test cả đơn lẻ (instant) lẫn theo lô (batch/Hungarian), có test
Hungarian đối chiếu tay + brute-force để chắc thuật toán đúng.

**Mở rộng lược đồ** để khớp App Thợ đã build: bảng `order_offers` (mới —
theo dõi ai được offer/từ chối/quan tâm 1 đơn, thứ mà thuật toán ghép cặp
BẮT BUỘC phải có mà bản gốc chưa có), `workers` (thêm đủ field hồ sơ/KYC/
online/trust score — bản gốc gần như rỗng), `worker_availability`,
`notifications`, `wallet_transactions` (đều mới), sửa `orders.status` từ 5
giá trị thô thành đủ trạng thái App Thợ cần, sửa lỗi chính tả
`job_descriptiion`, sửa `matching_config` từ 3 trọng số không khớp đề
cương (có "giá", không có đề cương nào nhắc) thành đúng 4 tiêu chí (khoảng
cách/trust score/tỷ lệ hoàn thành/tải công việc).

## 1. Cài đặt

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
và `thonhanh_app` nếu chưa có — cần quyền superuser HOẶC bất kỳ role nào có
`CREATEROLE` cho lần chạy đầu; sau bước này mọi bảng/hàm nên do
`thonhanh_owner` sở hữu, không phải superuser — xem vì sao ở mục 3):

```bash
psql "postgresql://<superuser_hoặc_role_có_CREATEROLE>@localhost:5432/thonhanh" -f db/schema.sql
# (tuỳ chọn) dữ liệu mẫu:
psql "postgresql://<cùng_role_trên>@localhost:5432/thonhanh" -f db/seed.sql
```

Sau đó đổi mật khẩu 2 role trong PostgreSQL và cập nhật lại `.env` cho
khớp (`DATABASE_URL` dùng role `thonhanh_app`, `DATABASE_OWNER_URL` dùng
`thonhanh_owner` — role owner giờ CÓ dùng trong runtime, cho vòng lặp batch
matching, xem mục 6).

**Tạo admin đầu tiên:** chưa có API tự đăng ký làm admin (đúng ra không nên
có — ai cũng tự phong admin được thì hỏng). Tạo thủ công 1 lần:
```sql
INSERT INTO admins (user_id) VALUES (<id của 1 user đã đăng ký qua API>);
```

```bash
npm run dev   # hoặc npm start
```

Kiểm tra: `GET http://localhost:3000/health` → `{ "status": "ok" }`

## 2. Endpoint chính (tóm tắt)

| Method | Path | Ai gọi được | Ghi chú |
|---|---|---|---|
| POST | /api/auth/google | ai cũng gọi được | App Thợ dùng cách này |
| POST | /api/auth/email/send-code | ai cũng gọi được | gửi mã 6 số (log ra console, dev trả kèm `devCode`) |
| POST | /api/auth/email/verify-code | ai cũng gọi được | xác thực mã → trả JWT |
| POST | /api/auth/register, /login | ai cũng gọi được | cổ điển, dự phòng cho App Khách |
| GET/PATCH | /api/users/me | đã đăng nhập | không còn lộ password_hash (bug đã sửa) |
| GET | /api/services | ai cũng gọi được | 6 hạng mục điện (đã khớp App Thợ) |
| GET/PATCH | /api/workers/me | worker | hồ sơ của chính mình |
| POST | /api/workers/me/verification | worker | nộp lần đầu HOẶC nộp lại (mới) |
| PATCH | /api/workers/me/online | worker | tự chặn nếu verification ≠ approved (mới) |
| GET/PUT | /api/workers/me/availability | worker | lịch rảnh theo tuần (mới) |
| GET | /api/workers/:id | ai cũng gọi được | hồ sơ công khai |
| GET/POST | /api/workers/:id/reviews | GET public, POST customer | đầu vào cho trust score |
| POST | /api/orders | customer | tạo đơn — **tự chạy ghép cặp ngay nếu mode=instant** (mới) |
| GET | /api/orders, /api/orders/:id | đã đăng nhập | RLS tự lọc theo vai trò + đơn `pending_match` đúng chuyên môn cho thợ thấy (mới) |
| PATCH | /api/orders/:id/status | liên quan tới đơn | enum đủ trạng thái, tự ghi order_history |
| PATCH | /api/orders/:id/offers/respond | worker | accept/decline/interested — API đứng sau "Nhận đơn/Từ chối/Quan tâm đơn này" (mới) |
| PATCH | /api/orders/:id/assign | admin | can thiệp thủ công (tranh chấp) — không còn là đường đi chính |
| POST | /api/orders/:id/payments, PATCH /api/payments/:id/status | customer / admin | |
| POST | /api/orders/:id/quotes, PATCH /api/quotes/:id/status | worker / customer | báo giá phát sinh |
| GET/POST | /api/notifications | đã đăng nhập | (mới) |
| GET | /api/wallet, POST /api/wallet/withdraw | worker | (mới) — balance tự cập nhật qua trigger, không tự cộng trừ tay |
| GET/PUT | /api/admin/matching-config | admin | 4 trọng số đúng đề cương + `mode` + 2 mốc thời gian |
| POST | /api/admin/matching-config/run-batch | admin | ép chạy 1 lượt batch ngay (test/demo), vòng lặp tự động vẫn chạy riêng |

## 3. Cách RLS hoạt động trong project này

- App Node.js kết nối bằng role **`thonhanh_app`** — role này **không phải
  chủ sở hữu bảng**, nên PostgreSQL luôn áp policy RLS cho mọi câu lệnh
  role này chạy.
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
- Đăng nhập/đăng ký là **trường hợp đặc biệt**: lúc đó user chưa có JWT
  nên không SELECT/INSERT...RETURNING được bảng `users` qua RLS thông
  thường (kể cả chính row vừa tạo — xem bug #1 ở mục 0). `db/schema.sql`
  định nghĩa 1 nhóm hàm `SECURITY DEFINER` (`auth_lookup_user_by_*`,
  `auth_upsert_*`, `auth_register_user`, `auth_verify_email_code`) CHỈ để
  phục vụ đúng bước xác thực/đăng ký, không mở toang bảng `users`.
  **Quy tắc:** mọi thao tác ghi vào `users` lúc CHƯA đăng nhập phải đi qua
  1 trong các hàm này, không tự viết `INSERT INTO users ... RETURNING`
  thẳng trong controller.
- **KHÔNG dùng `FORCE ROW LEVEL SECURITY`** (khác bản gốc) — lý do ở mục 0.
  Nếu sau này có ai định thêm FORCE lại "cho chắc", đọc kỹ giải thích trong
  schema.sql trước đã — sẽ làm hỏng toàn bộ auth ngay lập tức, rất khó debug.

## 4. Cấu trúc thư mục

```
db/
  schema.sql   -- toàn bộ DDL + RLS policies + auth functions (đọc kỹ, có chú thích)
  seed.sql     -- dữ liệu mẫu tối thiểu
src/
  config/      -- đọc .env, tạo pg Pool (2 pool: app + owner)
  middleware/  -- auth (JWT), dbContext (RLS session), errorHandler
  controllers/ -- logic nghiệp vụ, 1 file / entity
  services/
    matching.js -- thuật toán ghép cặp (instant + batch/Hungarian) — xem mục 6
  routes/      -- khai báo endpoint, gắn middleware theo route
  app.js       -- lắp ráp middleware + router
  server.js    -- điểm khởi chạy + vòng lặp batch matching định kỳ
```

## 5. Quyết định cần bàn với team (không tự quyết 1 mình được)

1. **App Khách dùng auth kiểu gì?** Backend đã hỗ trợ sẵn cả 3: Google,
   mã email, và email+mật khẩu cổ điển. App Thợ dùng 2 cách đầu. Nếu App
   Khách (Thành viên A) vẫn theo đúng đề cương gốc (SMS OTP), cần bàn thêm
   — pattern y hệt `email_verification_codes`/`auth_verify_email_code` có
   thể tái dùng cho SMS OTP (đổi kênh gửi), không cần đổi kiến trúc.
2. **Trust score đặt ở `workers` (1 điểm/thợ) hay `worker_services` (theo
   từng dịch vụ)?** Đã chuyển về `workers` (khớp App Thợ đã build UI theo
   1 điểm/thợ) — cần Thành viên A (chủ thuật toán Trust Score) xác nhận
   lại, đổi ngược lại không khó nếu bạn ấy có lý do riêng.
3. **Geospatial Indexing (Thành viên C)** chưa đụng tới gì ở bản này —
   `findCandidates` trong `matching.js` đang lọc bằng cách quét thẳng
   bảng `workers` + tính Haversine ở tầng Node, đủ dùng cho quy mô demo vài
   thợ. Khi Thành viên C có index riêng (geohash/grid), thay phần quét thô
   đó bằng gọi qua index của bạn ấy — không cần đổi gì ở phần chấm điểm
   (`computeScore`), chỉ đổi cách LẤY danh sách ứng viên thô ban đầu.

## 6. Thuật toán ghép cặp (đề cương mục 6.1) — `src/services/matching.js`

**Chế độ 1 — instant (Weighted Scoring):** chạy NGAY trong request tạo đơn
(`POST /api/orders`, nếu `matching_config.mode = 'instant'`). Chấm điểm
từng ứng viên theo đúng 4 tiêu chí đề cương (khoảng cách Haversine chuẩn
hoá theo bán kính hoạt động, trust score, tỷ lệ hoàn thành, tải công việc
hiện tại = nghịch đảo số đơn đang xử lý), chọn cao nhất, tạo offer có hạn
trả lời (`offer_ttl_seconds`, mock App Thợ đang dùng 45s). Thợ từ chối →
gọi lại chính hàm này, tự loại người vừa từ chối, tìm ứng viên tốt tiếp
theo.

**Chế độ 2 — batch (Hungarian/Kuhn–Munkres):** vòng lặp trong
`server.js`, chạy định kỳ (`batch_interval_seconds`, đề cương gợi ý 5-10s)
NẾU `mode = 'batch'`. Gom toàn bộ đơn `pending_match` + toàn bộ thợ rảnh
liên quan, dựng ma trận điểm bằng ĐÚNG hàm chấm điểm của chế độ 1 (đề
cương yêu cầu vậy), giải bài toán gán 2 phía tối đa tổng điểm bằng thuật
toán Hungarian tự cài đặt (O(n³), không dùng thư viện ngoài).

**Đã kiểm chứng đúng**, không chỉ chạy không lỗi:
- Hungarian: so khớp tay 1 ma trận 3x3 + đối chiếu brute-force 1 ma trận
  4x4 — cả 2 ra đúng kết quả tối ưu.
- Instant: 1 thợ gần+trust cao+tỷ lệ hoàn thành cao thắng đúng 1 thợ xa
  hơn+điểm thấp hơn trên MỌI tiêu chí; thợ từ chối → offer tiếp theo đúng
  chuyển sang thợ còn lại.
- Toàn bộ chạy qua HTTP thật (Express + JWT + Postgres RLS thật), không
  phải gọi thẳng hàm trong Node REPL.

**Phần ⭐ "độ phù hợp kỹ năng" (mở rộng, không bắt buộc MVP) chưa làm** —
hiện chuyên môn (`worker_services`) đã là điều kiện LỌC ứng viên (không có
tag đúng dịch vụ thì không vào danh sách ứng viên), phần ⭐ sẽ là cộng thêm
điểm nếu đây là chuyên môn CHÍNH của thợ (vd: nhiều chuyên môn nhưng ưu
tiên người coi đây là sở trường số 1) — để dành nếu còn thời gian.
