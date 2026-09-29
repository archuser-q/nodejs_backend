-- =====================================================================
-- THỢ NHANH — PostgreSQL schema với Row-Level Security (RLS)
-- =====================================================================
-- Bản này viết lại đáng kể so với bản khung đầu tiên, sau khi đối chiếu
-- với App Thợ (đã build xong phần giao diện, mock đầy đủ) — giữ nguyên
-- PHONG CÁCH và Ý TƯỞNG RLS gốc (rất tốt: transaction-per-request,
-- SECURITY DEFINER cho lúc đăng nhập, role owner/app tách biệt), chỉ mở
-- rộng/sửa phần LƯỢC ĐỒ DỮ LIỆU cho khớp với những gì App Thợ thực sự cần.
--
-- ĐỔI LỚN NHẤT: bỏ hẳn đăng nhập username/password làm mặc định — App Thợ
-- đã build xong theo 2 cách: đăng nhập Google, hoặc mã xác nhận gửi qua
-- email (không có mật khẩu ở cả 2 cách). Email/password vẫn GIỮ LẠI làm
-- lựa chọn thứ 3 (đổi identifier từ username -> email cho gọn), phòng khi
-- App Khách (Thành viên A) vẫn muốn dùng theo đúng đề cương gốc — nhưng
-- password_hash giờ NULLABLE vì 2 cách kia không có mật khẩu.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. ROLES  (giữ nguyên như bản gốc)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'thonhanh_owner') THEN
    CREATE ROLE thonhanh_owner LOGIN PASSWORD 'change_me_owner';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'thonhanh_app') THEN
    CREATE ROLE thonhanh_app LOGIN PASSWORD 'change_me_app';
  END IF;
END
$$;

-- ---------------------------------------------------------------------
-- 1. EXTENSIONS
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 2. USERS & SUBTYPES
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name              varchar(255) NOT NULL,
  sex               varchar(255),
  email_address     varchar(255) NOT NULL UNIQUE,
  phone_number      varchar(255),
  -- Cách tài khoản này đăng nhập — 1 user chỉ có ĐÚNG 1 cách (không cho
  -- trộn, tránh rắc rối "quên đăng ký bằng gì"). 'password' là lựa chọn dự
  -- phòng cho App Khách nếu Thành viên A vẫn muốn theo đúng đề cương gốc
  -- (SMS OTP/Google/Facebook) — chưa làm SMS OTP ở backend này, chỉ có sẵn
  -- chỗ cắm (thêm 1 giá trị auth_provider + bảng mã tương tự
  -- email_verification_codes khi cần, không cần đổi kiến trúc).
  auth_provider     varchar(20) NOT NULL DEFAULT 'password'
                      CHECK (auth_provider IN ('password', 'google', 'email_code')),
  google_id         varchar(255) UNIQUE,
  password_hash     varchar(255), -- NULL nếu auth_provider <> 'password'
  is_verified       boolean NOT NULL DEFAULT false,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now(),
  balance           integer NOT NULL DEFAULT 0, -- nguồn đúng: tổng từ wallet_transactions, cột này chỉ để đọc nhanh (xem trigger bên dưới)
  avatar            varchar(255),
  longitude         float,
  latitude          float,
  CONSTRAINT users_password_required_if_password_auth
    CHECK (auth_provider <> 'password' OR password_hash IS NOT NULL)
);

CREATE TABLE customers (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE admins (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);

-- WORKERS — bản gốc chỉ có mỗi user_id. App Thợ (đã build xong UI) cần đủ
-- các field bên dưới cho hồ sơ/KYC/trạng thái hoạt động — đây là phần
-- thiếu nhiều nhất so với bản gốc.
CREATE TABLE workers (
  user_id                    integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  years_of_experience        integer NOT NULL DEFAULT 0,
  operating_center_latitude  float,
  operating_center_longitude float,
  operating_radius_km        numeric(5,2) NOT NULL DEFAULT 5,
  is_online                  boolean NOT NULL DEFAULT false,
  verification               varchar(20) NOT NULL DEFAULT 'unverified'
                                CHECK (verification IN ('unverified', 'pending', 'approved', 'rejected')),
  verification_reject_reason varchar(500),
  id_card_front_url          varchar(255),
  id_card_back_url           varchar(255),
  certificate_urls           text[] NOT NULL DEFAULT '{}',
  -- Điểm tin cậy: ĐẶT Ở ĐÂY (1 điểm / thợ), KHÔNG đặt theo từng dịch vụ như
  -- bản gốc (worker_services.trust_score) — vì App Thợ đã build UI theo 1
  -- điểm / thợ (WorkerProfile.trustScore). CẦN THÀNH VIÊN A (chủ thuật
  -- toán Trust Score) XÁC NHẬN LẠI quyết định này — nếu bạn ấy có lý do
  -- muốn tính riêng theo từng dịch vụ, đổi lại không khó (chuyển 2 cột này
  -- qua worker_services, controller đọc chỗ khác thay vì đổi kiến trúc).
  trust_score                integer NOT NULL DEFAULT 0,
  completion_rate            numeric(5,4) NOT NULL DEFAULT 0,
  created_at                 timestamp NOT NULL DEFAULT now(),
  updated_at                 timestamp NOT NULL DEFAULT now()
);
-- current_order_id CỐ Ý KHÔNG có cột riêng (bản gốc định làm circular FK
-- với orders) — suy ra bằng truy vấn
-- "SELECT id FROM orders WHERE worker_user_id = X AND status IN
-- ('accepted','in_progress')" khi cần, khỏi phải đồng bộ 2 chiều.

-- ---------------------------------------------------------------------
-- 3. SERVICES & WORKER_SERVICES (năng lực/chuyên môn — KHÔNG còn trust_score)
-- ---------------------------------------------------------------------
CREATE TABLE services (
  id       integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name     varchar(255) NOT NULL,
  category varchar(255)
);

CREATE TABLE worker_services (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  worker_user_id integer NOT NULL REFERENCES workers(user_id) ON DELETE CASCADE,
  service_id     integer NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  UNIQUE (worker_user_id, service_id)
);

-- Lịch rảnh theo tuần — App Thợ đã build màn "Lịch làm việc" (lưới
-- Sáng/Chiều/Tối x Thứ 2-CN), bản gốc chưa có bảng cho tính năng này.
CREATE TABLE worker_availability (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  worker_user_id integer NOT NULL REFERENCES workers(user_id) ON DELETE CASCADE,
  day_of_week    integer NOT NULL CHECK (day_of_week BETWEEN 1 AND 7), -- 1=Thứ 2 ... 7=CN
  period         varchar(10) NOT NULL CHECK (period IN ('morning', 'afternoon', 'evening')),
  is_available   boolean NOT NULL DEFAULT false,
  UNIQUE (worker_user_id, day_of_week, period)
);

-- ---------------------------------------------------------------------
-- 4. ORDERS, ORDER_OFFERS (mới), REPAIR_REQUESTS
-- ---------------------------------------------------------------------
-- Trạng thái đơn: bản gốc chỉ có 5 giá trị thô (pending/matched/in_progress/
-- completed/cancelled) — App Thợ (đã build xong, đang chạy mock) cần chi
-- tiết hơn: phân biệt "offered" (đề nghị RIÊNG cho 1 thợ, có hạn phản hồi)
-- với "pending_match" (đơn khác gần đó — CHƯA offer cho ai), phân biệt ai
-- huỷ (khách/thợ) để hiển thị đúng lý do, "reviewed" tách khỏi "completed"
-- (đã hoàn thành nhưng có thể chưa được đánh giá), "expired" (offer hết
-- hạn không ai nhận), "disputed" (khiếu nại, việc của Thành viên C).
CREATE TABLE orders (
  id                 integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  status             varchar(30) NOT NULL DEFAULT 'pending_match'
                        CHECK (status IN (
                          'pending_match', 'offered', 'accepted', 'in_progress',
                          'completed', 'reviewed', 'cancelled_by_customer',
                          'cancelled_by_worker', 'expired', 'disputed'
                        )),
  customer_user_id   integer NOT NULL REFERENCES customers(user_id),
  worker_user_id     integer REFERENCES workers(user_id), -- chỉ set khi có thợ THỰC SỰ nhận (status >= 'accepted')
  service_id         integer REFERENCES services(id), -- thiếu ở bản gốc — cần để thuật toán lọc đúng chuyên môn
  description        varchar(1000), -- mô tả sự cố ban đầu của khách (repair_requests là hạng mục chi tiết SAU khi làm, xem ghi chú ở bảng đó)
  address            varchar(500), -- địa chỉ dạng chữ, bản gốc chỉ có toạ độ
  latitude           float,
  longitude          float,
  price_estimate_min integer,
  price_estimate_max integer,
  final_price        integer,
  payment_method     varchar(20) CHECK (payment_method IN ('cash', 'ewallet')),
  payment_status     varchar(20) NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid')),
  cancel_reason      varchar(500),
  is_scheduled       boolean NOT NULL DEFAULT false,
  scheduled_at       timestamp, -- đặt hẹn trước thay vì đặt ngay
  photo_urls         text[] NOT NULL DEFAULT '{}', -- ảnh khách đính kèm mô tả sự cố
  before_photo_urls  text[] NOT NULL DEFAULT '{}', -- ảnh thợ chụp trước khi sửa
  after_photo_urls   text[] NOT NULL DEFAULT '{}', -- ảnh thợ chụp sau khi hoàn thành
  created_at         timestamp NOT NULL DEFAULT now(),
  updated_at         timestamp NOT NULL DEFAULT now()
);

-- BẢNG MỚI — thiếu hẳn ở bản gốc, nhưng là bảng QUAN TRỌNG NHẤT cho thuật
-- toán ghép cặp: bản gốc coi ghép cặp là gán TRỰC TIẾP 1 lần
-- (orders.worker_user_id), không có chỗ lưu "đã đề nghị cho ai, ai từ
-- chối, hạn trả lời khi nào, ai chỉ mới bày tỏ quan tâm" — những thứ thuật
-- toán Weighted Scoring/Hungarian (mục 6.1 đề cương) cần để hoạt động
-- đúng (offer có hạn, hết hạn thì đề nghị người tiếp theo; Hungarian cần
-- biết đủ ứng viên + điểm số để giải bài toán gán tối ưu).
CREATE TABLE order_offers (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id       integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  worker_user_id integer NOT NULL REFERENCES workers(user_id) ON DELETE CASCADE,
  status         varchar(20) NOT NULL DEFAULT 'offered'
                   CHECK (status IN ('offered', 'accepted', 'declined', 'expired', 'interested')),
  score          numeric(6,4), -- điểm Weighted Scoring tại thời điểm đề nghị — lưu lại để giải thích được quyết định của thuật toán lúc bảo vệ
  offered_at     timestamp NOT NULL DEFAULT now(),
  responded_at   timestamp,
  expires_at     timestamp,
  UNIQUE (order_id, worker_user_id)
);

-- Hạng mục công việc CHI TIẾT (thường điền lúc/sau khi làm xong) — khác
-- orders.description (lời khách mô tả BAN ĐẦU). Phục vụ hoá đơn điện tử +
-- yêu cầu bảo hành theo từng hạng mục (đề cương 5.1).
CREATE TABLE repair_requests (
  id                   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_description      varchar(255), -- ĐÃ SỬA lỗi chính tả "job_descriptiion" ở bản gốc
  quantity             integer,
  price                integer,
  warranty_expiry_date timestamp,
  order_id             integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------
-- 5. PAYMENTS / QUOTES / REVIEWS  (giữ gần nguyên bản gốc)
-- ---------------------------------------------------------------------
CREATE TABLE payments (
  id       integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  amount   integer NOT NULL,
  method   varchar(255),
  status   varchar(255) NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending','paid','failed','refunded')),
  paid_at  timestamp,
  order_id integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE quotes (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  description    varchar(255),
  price          integer,
  created_at     timestamp NOT NULL DEFAULT now(),
  status         varchar(255) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','accepted','rejected')),
  worker_user_id integer NOT NULL REFERENCES workers(user_id),
  order_id       integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE reviews (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  content          varchar(255),
  rating_score     integer NOT NULL CHECK (rating_score BETWEEN 1 AND 5),
  created_at       timestamp NOT NULL DEFAULT now(),
  customer_user_id integer NOT NULL REFERENCES customers(user_id),
  worker_user_id   integer NOT NULL REFERENCES workers(user_id),
  order_id         integer REFERENCES orders(id), -- thiếu ở bản gốc — cần biết review này ứng với đơn nào (1 đơn chỉ nên review 1 lần)
  UNIQUE (order_id) -- phát hiện thiếu khi test: không có ràng buộc này thì 1 đơn review được nhiều lần
);

-- ---------------------------------------------------------------------
-- 6. ORDER_HISTORY / MATCHING_CONFIG  (giữ nguyên bản gốc)
-- ---------------------------------------------------------------------
CREATE TABLE order_history (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  status          varchar(255) NOT NULL,
  updated_at      timestamp NOT NULL DEFAULT now(),
  changed_by_type varchar(50) NOT NULL DEFAULT 'system'
                    CHECK (changed_by_type IN ('system','customer','worker','admin')),
  note            varchar(255),
  order_id        integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id         integer REFERENCES users(id)
);

-- ĐÃ SỬA để khớp ĐÚNG 4 tiêu chí trong đề cương mục 6.1 (khoảng cách,
-- rating/trust score, tỷ lệ hoàn thành, tải công việc hiện tại) — bản gốc
-- có "weight_price" nhưng đề cương không hề nhắc tới giá làm tiêu chí ghép
-- cặp, chỉ có ở bước báo giá phát sinh (quotes) là chuyện khác hẳn.
CREATE TABLE matching_config (
  id                     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  weight_distance        numeric(5,2) NOT NULL DEFAULT 0.35,
  weight_trust_score     numeric(5,2) NOT NULL DEFAULT 0.35,
  weight_completion_rate numeric(5,2) NOT NULL DEFAULT 0.15,
  weight_workload        numeric(5,2) NOT NULL DEFAULT 0.15,
  mode                   varchar(20) NOT NULL DEFAULT 'instant'
                           CHECK (mode IN ('instant','batch')),
  offer_ttl_seconds      integer NOT NULL DEFAULT 45, -- hạn thợ phải phản hồi 1 offer — App Thợ mock hiện dùng 45s
  batch_interval_seconds integer NOT NULL DEFAULT 8, -- đề cương: "định kỳ, ví dụ mỗi 5-10 giây" cho chế độ batch
  updated_at             timestamp NOT NULL DEFAULT now(),
  updated_by             integer REFERENCES admins(user_id)
);

-- ---------------------------------------------------------------------
-- 7. NOTIFICATIONS / WALLET_TRANSACTIONS  (mới — App Thợ đã build 2 màn này)
-- ---------------------------------------------------------------------
CREATE TABLE notifications (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       varchar(20) NOT NULL CHECK (type IN ('order', 'verification', 'payment', 'system')),
  title      varchar(255) NOT NULL,
  body       varchar(500),
  order_id   integer REFERENCES orders(id),
  is_read    boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);

-- users.balance là số dư ĐỌC NHANH — nguồn đúng là tổng các dòng ở đây
-- (giống sổ cái kế toán, không cho sửa/xoá — xem policy + trigger bên dưới).
CREATE TABLE wallet_transactions (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- luôn là thợ trong phạm vi hiện tại
  type       varchar(20) NOT NULL CHECK (type IN ('earning', 'withdrawal', 'adjustment')),
  amount     integer NOT NULL, -- dương = cộng ví (earning), âm = trừ ví (withdrawal, hoa hồng)
  order_id   integer REFERENCES orders(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION apply_wallet_transaction() RETURNS trigger AS $$
BEGIN
  UPDATE users SET balance = balance + NEW.amount WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wallet_transactions_apply
  AFTER INSERT ON wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION apply_wallet_transaction();

-- ---------------------------------------------------------------------
-- 8. EMAIL VERIFICATION CODES (mới — cho cách đăng nhập "mã gửi qua email")
-- ---------------------------------------------------------------------
-- Lưu HASH của mã, không lưu mã gốc — cùng tinh thần không lưu mật khẩu
-- gốc. Không dùng bcrypt ở đây (chậm, dùng cho mật khẩu cần chống brute
-- force lâu dài) — mã 6 số sống có 5 phút, SHA-256 (nhanh) là đủ, quan
-- trọng hơn là giới hạn số lần thử sai ở tầng controller.
CREATE TABLE email_verification_codes (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email        varchar(255) NOT NULL,
  code_hash    varchar(255) NOT NULL,
  expires_at   timestamp NOT NULL,
  consumed_at  timestamp,
  created_at   timestamp NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 9. updated_at TRIGGERS
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at   BEFORE UPDATE ON users   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_workers_updated_at BEFORE UPDATE ON workers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_orders_updated_at  BEFORE UPDATE ON orders  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- 10. ROW-LEVEL SECURITY
-- =====================================================================
CREATE OR REPLACE FUNCTION current_user_id() RETURNS integer AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::integer;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION current_user_role() RETURNS text AS $$
  SELECT COALESCE(NULLIF(current_setting('app.current_user_role', true), ''), 'anonymous');
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean AS $$
  SELECT current_user_role() = 'admin';
$$ LANGUAGE sql STABLE;

-- BUG THẬT PHÁT HIỆN KHI TEST: orders_select cần biết "thợ này có offer
-- 'offered' trên đơn X không" để cho thợ thấy đơn trước khi nhận, nhưng
-- order_offers_select LẠI cần biết "đơn Y có phải của khách hiện tại
-- không" — 2 policy tham chiếu chéo nhau => Postgres báo "infinite
-- recursion detected in policy". Cách chuẩn để phá vòng lặp này: đưa 1
-- chiều tham chiếu qua hàm SECURITY DEFINER (không chạy lại RLS của
-- order_offers khi được gọi từ policy của orders), thay vì subquery RLS
-- thường — chỉ cần phá 1 trong 2 chiều là đủ cắt vòng lặp.
CREATE OR REPLACE FUNCTION worker_has_active_offer(p_order_id integer, p_worker_id integer)
RETURNS boolean
SECURITY DEFINER SET search_path = public LANGUAGE sql AS $$
  SELECT EXISTS (
    SELECT 1 FROM order_offers
    WHERE order_id = p_order_id AND worker_user_id = p_worker_id AND status = 'offered'
  );
$$;

-- BUG THẬT ĐÃ TÌM RA VÀ SỬA KHI TEST TRÊN POSTGRES THẬT (không thấy được
-- nếu chỉ đọc code): bản gốc có thêm "FORCE ROW LEVEL SECURITY" ở mọi
-- bảng — nghe hợp lý ("an toàn hơn, áp cả cho owner"), nhưng THỰC TẾ làm
-- HỎNG chính cơ chế SECURITY DEFINER mà file này dùng để đăng nhập/đăng ký
-- (mục 11 bên dưới): khi FORCE bật, ngay cả owner (không phải superuser)
-- chạy qua SECURITY DEFINER cũng bị RLS chặn — nghĩa là auth_lookup_user
-- kiểu function sẽ LUÔN trả về rỗng dù user có tồn tại, im lặng không báo
-- lỗi gì cả. Kiểm chứng bằng cách chạy schema.sql với đúng role
-- thonhanh_owner KHÔNG PHẢI superuser (giống hướng dẫn ở đầu file) rồi thử
-- đăng nhập — lỗi này rất dễ bị bỏ sót nếu chỉ test bằng tài khoản
-- superuser (postgres owns bypass RLS mặc định, che mất bug).
-- Bỏ FORCE là đủ: app Node.js luôn kết nối bằng thonhanh_app (không phải
-- owner) nên vẫn bị RLS áp dụng đầy đủ như thiết kế — FORCE chỉ có ý nghĩa
-- nếu có người lỡ dùng role owner để chạy query thủ công, đánh đổi không
-- đáng so với việc làm hỏng toàn bộ luồng đăng nhập.
ALTER TABLE users                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers                ENABLE ROW LEVEL SECURITY;
ALTER TABLE workers                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE admins                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE services                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_services          ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_availability      ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_offers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_requests          ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_history            ENABLE ROW LEVEL SECURITY;
ALTER TABLE matching_config          ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications            ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_verification_codes ENABLE ROW LEVEL SECURITY;

-- ---- users --------------------------------------------------------------
CREATE POLICY users_select ON users FOR SELECT
  USING (
    is_admin()
    OR id = current_user_id()
    OR id IN (
      SELECT worker_user_id FROM orders WHERE customer_user_id = current_user_id()
      UNION
      SELECT customer_user_id FROM orders WHERE worker_user_id = current_user_id()
    )
  );
CREATE POLICY users_insert ON users FOR INSERT
  WITH CHECK (current_user_role() = 'anonymous' OR is_admin());
CREATE POLICY users_update ON users FOR UPDATE
  USING (is_admin() OR id = current_user_id())
  WITH CHECK (is_admin() OR id = current_user_id());
CREATE POLICY users_delete ON users FOR DELETE USING (is_admin());

-- ---- customers / workers / admins ----------------------------------------
CREATE POLICY customers_select ON customers FOR SELECT
  USING (is_admin() OR user_id = current_user_id()
         OR user_id IN (SELECT customer_user_id FROM orders WHERE worker_user_id = current_user_id()));
CREATE POLICY customers_insert ON customers FOR INSERT
  WITH CHECK (user_id = current_user_id() OR is_admin() OR current_user_role() = 'anonymous');
CREATE POLICY customers_update ON customers FOR UPDATE USING (is_admin() OR user_id = current_user_id());
CREATE POLICY customers_delete ON customers FOR DELETE USING (is_admin());

CREATE POLICY workers_select ON workers FOR SELECT USING (true); -- cần công khai để tìm/ghép cặp
CREATE POLICY workers_insert ON workers FOR INSERT
  WITH CHECK (user_id = current_user_id() OR is_admin() OR current_user_role() = 'anonymous');
CREATE POLICY workers_update ON workers FOR UPDATE USING (is_admin() OR user_id = current_user_id());
CREATE POLICY workers_delete ON workers FOR DELETE USING (is_admin());

CREATE POLICY admins_select ON admins FOR SELECT USING (is_admin());
CREATE POLICY admins_all ON admins FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- ---- services / worker_services / worker_availability --------------------
CREATE POLICY services_select ON services FOR SELECT USING (true);
CREATE POLICY services_write  ON services FOR INSERT WITH CHECK (is_admin());
CREATE POLICY services_update ON services FOR UPDATE USING (is_admin());
CREATE POLICY services_delete ON services FOR DELETE USING (is_admin());

CREATE POLICY worker_services_select ON worker_services FOR SELECT USING (true);
CREATE POLICY worker_services_insert ON worker_services FOR INSERT
  WITH CHECK (worker_user_id = current_user_id() OR is_admin());
CREATE POLICY worker_services_update ON worker_services FOR UPDATE
  USING (worker_user_id = current_user_id() OR is_admin());
CREATE POLICY worker_services_delete ON worker_services FOR DELETE
  USING (worker_user_id = current_user_id() OR is_admin());

CREATE POLICY worker_availability_select ON worker_availability FOR SELECT
  USING (is_admin() OR worker_user_id = current_user_id());
CREATE POLICY worker_availability_insert ON worker_availability FOR INSERT
  WITH CHECK (worker_user_id = current_user_id() OR is_admin());
CREATE POLICY worker_availability_update ON worker_availability FOR UPDATE
  USING (worker_user_id = current_user_id() OR is_admin());
CREATE POLICY worker_availability_delete ON worker_availability FOR DELETE
  USING (worker_user_id = current_user_id() OR is_admin());

-- ---- orders ---------------------------------------------------------------
CREATE POLICY orders_select ON orders FOR SELECT
  -- Thợ cũng cần thấy được đơn mà mình đang có offer 'offered' còn hiệu
  -- lực (chưa nhận) — thiếu điều kiện này thì KHÔNG CHỈ ảnh hưởng
  -- SELECT: UPDATE cũng ngầm cần điều kiện SELECT này để xác định dòng có
  -- "nhìn thấy" được không trước khi áp policy UPDATE riêng, nên đây chính
  -- là lý do khiến "Nhận đơn" (UPDATE orders SET worker_user_id=...) bị
  -- chặn dù policy orders_update đã cho phép — tìm ra khi test thật, không
  -- thấy được nếu chỉ đọc SQL. Dùng hàm worker_has_active_offer() thay vì
  -- subquery thẳng vào order_offers để tránh đệ quy vòng (xem giải thích ở
  -- khai báo hàm đó).
  --
  -- THÊM: thợ (đang online, đã duyệt) còn cần thấy các đơn 'pending_match'
  -- ĐÚNG CHUYÊN MÔN của mình dù CHƯA được offer riêng — đây chính là danh
  -- sách "Đơn khác gần bạn" mà App Thợ đã build UI (nút "Quan tâm đơn
  -- này"). Lọc theo bán kính chính xác để ở tầng query (ORDER BY khoảng
  -- cách, LIMIT N) chứ không đặt trong policy — vừa đơn giản hơn, vừa vì
  -- RLS chỉ nên quyết định "được/không được thấy", không nên gánh luôn việc
  -- xếp hạng theo khoảng cách.
  USING (is_admin() OR customer_user_id = current_user_id() OR worker_user_id = current_user_id()
         OR worker_has_active_offer(id, current_user_id())
         OR (
           status = 'pending_match' AND current_user_role() = 'worker'
           AND service_id IN (SELECT service_id FROM worker_services WHERE worker_user_id = current_user_id())
           AND EXISTS (SELECT 1 FROM workers w WHERE w.user_id = current_user_id() AND w.is_online AND w.verification = 'approved')
         ));
CREATE POLICY orders_insert ON orders FOR INSERT
  WITH CHECK (customer_user_id = current_user_id() AND current_user_role() = 'customer');
CREATE POLICY orders_update ON orders FOR UPDATE
  -- BUG THẬT PHÁT HIỆN KHI TEST: bản đầu USING chỉ cho phép thợ sửa đơn
  -- NẾU đã là worker_user_id của đơn đó — nhưng chính hành động "Nhận đơn"
  -- LÀ thao tác set worker_user_id lần đầu, nên thợ không tự nhận đơn được
  -- (update bị chặn 0 dòng, không báo lỗi gì, rất khó phát hiện nếu không
  -- test thật). Sửa: cho phép cả khi đơn đang có offer 'offered' còn hiệu
  -- lực gửi cho đúng thợ đó.
  USING (
    is_admin()
    OR customer_user_id = current_user_id()
    OR worker_user_id = current_user_id()
    OR worker_has_active_offer(id, current_user_id())
  )
  WITH CHECK (is_admin() OR customer_user_id = current_user_id() OR worker_user_id = current_user_id());
CREATE POLICY orders_delete ON orders FOR DELETE USING (is_admin());

-- ---- order_offers (mới) ----------------------------------------------------
-- SELECT: thợ thấy offer của mình; khách thấy offer trên đơn của họ (để
-- hiện kiểu "đang gửi tới 3 thợ gần bạn"); admin thấy hết.
CREATE POLICY order_offers_select ON order_offers FOR SELECT
  USING (is_admin() OR worker_user_id = current_user_id()
         OR order_id IN (SELECT id FROM orders WHERE customer_user_id = current_user_id()));
-- INSERT: thuật toán chạy NGAY trong request của khách lúc tạo đơn (chế độ
-- instant) hoặc trong request admin (chế độ batch) — không có "role hệ
-- thống" riêng ở tầng JWT nên mượn quyền của người đang thao tác.
CREATE POLICY order_offers_insert ON order_offers FOR INSERT
  WITH CHECK (is_admin() OR order_id IN (SELECT id FROM orders WHERE customer_user_id = current_user_id()));
-- UPDATE: thợ tự đổi trạng thái offer của mình (accept/decline/interested).
CREATE POLICY order_offers_update ON order_offers FOR UPDATE
  USING (is_admin() OR worker_user_id = current_user_id());
CREATE POLICY order_offers_delete ON order_offers FOR DELETE USING (is_admin());

-- ---- repair_requests -------------------------------------------------
CREATE POLICY repair_requests_select ON repair_requests FOR SELECT
  USING (is_admin() OR order_id IN (
    SELECT id FROM orders WHERE customer_user_id = current_user_id() OR worker_user_id = current_user_id()
  ));
CREATE POLICY repair_requests_write ON repair_requests FOR INSERT
  WITH CHECK (is_admin() OR order_id IN (
    SELECT id FROM orders WHERE customer_user_id = current_user_id() OR worker_user_id = current_user_id()
  )); -- ĐÃ NỚI so với bản gốc (trước chỉ cho khách) — thợ cũng cần ghi hạng mục lúc hoàn thành
CREATE POLICY repair_requests_update ON repair_requests FOR UPDATE
  USING (is_admin() OR order_id IN (
    SELECT id FROM orders WHERE customer_user_id = current_user_id() OR worker_user_id = current_user_id()
  ));
CREATE POLICY repair_requests_delete ON repair_requests FOR DELETE USING (is_admin());

-- ---- payments -----------------------------------------------------------
CREATE POLICY payments_select ON payments FOR SELECT
  USING (is_admin() OR order_id IN (
    SELECT id FROM orders WHERE customer_user_id = current_user_id() OR worker_user_id = current_user_id()
  ));
CREATE POLICY payments_insert ON payments FOR INSERT
  WITH CHECK (is_admin() OR order_id IN (SELECT id FROM orders WHERE customer_user_id = current_user_id()));
CREATE POLICY payments_update ON payments FOR UPDATE USING (is_admin());
CREATE POLICY payments_delete ON payments FOR DELETE USING (is_admin());

-- ---- quotes ---------------------------------------------------------------
CREATE POLICY quotes_select ON quotes FOR SELECT
  USING (is_admin() OR worker_user_id = current_user_id()
         OR order_id IN (SELECT id FROM orders WHERE customer_user_id = current_user_id()));
CREATE POLICY quotes_insert ON quotes FOR INSERT
  WITH CHECK (worker_user_id = current_user_id() AND current_user_role() = 'worker');
CREATE POLICY quotes_update ON quotes FOR UPDATE
  USING (is_admin() OR worker_user_id = current_user_id()
         OR order_id IN (SELECT id FROM orders WHERE customer_user_id = current_user_id()));
CREATE POLICY quotes_delete ON quotes FOR DELETE USING (is_admin() OR worker_user_id = current_user_id());

-- ---- reviews --------------------------------------------------------------
CREATE POLICY reviews_select ON reviews FOR SELECT USING (true);
CREATE POLICY reviews_insert ON reviews FOR INSERT
  WITH CHECK (customer_user_id = current_user_id() AND current_user_role() = 'customer');
CREATE POLICY reviews_update ON reviews FOR UPDATE USING (is_admin() OR customer_user_id = current_user_id());
CREATE POLICY reviews_delete ON reviews FOR DELETE USING (is_admin() OR customer_user_id = current_user_id());

-- ---- order_history ----------------------------------------------------
CREATE POLICY order_history_select ON order_history FOR SELECT
  USING (is_admin() OR order_id IN (
    SELECT id FROM orders WHERE customer_user_id = current_user_id() OR worker_user_id = current_user_id()
  ));
CREATE POLICY order_history_insert ON order_history FOR INSERT
  WITH CHECK (is_admin() OR order_id IN (
    SELECT id FROM orders WHERE customer_user_id = current_user_id() OR worker_user_id = current_user_id()
  ));
CREATE POLICY order_history_update ON order_history FOR UPDATE USING (is_admin());
CREATE POLICY order_history_delete ON order_history FOR DELETE USING (is_admin());

-- ---- matching_config ----------------------------------------------------
CREATE POLICY matching_config_select ON matching_config FOR SELECT USING (is_admin());
CREATE POLICY matching_config_write ON matching_config FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- ---- notifications (mới) --------------------------------------------------
CREATE POLICY notifications_select ON notifications FOR SELECT
  USING (is_admin() OR user_id = current_user_id());
-- INSERT nới hơn các bảng khác có chủ đích: thông báo thường được tạo cho
-- NGƯỜI KHÁC (vd: thợ cập nhật đơn -> tạo thông báo cho khách) trong cùng
-- request của người thao tác, không phải cho chính họ. Rủi ro thấp (chỉ là
-- gửi thông báo, không lộ/sửa dữ liệu người khác) nên chấp nhận đánh đổi
-- này thay vì thêm 1 SECURITY DEFINER function chỉ để insert.
CREATE POLICY notifications_insert ON notifications FOR INSERT
  WITH CHECK (current_user_role() <> 'anonymous');
CREATE POLICY notifications_update ON notifications FOR UPDATE
  USING (is_admin() OR user_id = current_user_id());
CREATE POLICY notifications_delete ON notifications FOR DELETE USING (is_admin());

-- ---- wallet_transactions (mới) ---------------------------------------------
CREATE POLICY wallet_transactions_select ON wallet_transactions FOR SELECT
  USING (is_admin() OR user_id = current_user_id());
CREATE POLICY wallet_transactions_insert ON wallet_transactions FOR INSERT
  WITH CHECK (is_admin() OR user_id = current_user_id());
-- Sổ cái — không cho sửa/xoá ngoài admin, giống order_history.
CREATE POLICY wallet_transactions_update ON wallet_transactions FOR UPDATE USING (is_admin());
CREATE POLICY wallet_transactions_delete ON wallet_transactions FOR DELETE USING (is_admin());

-- ---- email_verification_codes (mới) ----------------------------------------
-- Ai cũng gửi yêu cầu mã được (kể cả anonymous) — biết trước 1 email không
-- phải thông tin nhạy cảm, phần bảo mật thật nằm ở chỗ mã chỉ tới được
-- đúng hộp thư đó. Xác thực mã đi qua function SECURITY DEFINER bên dưới,
-- không qua SELECT trực tiếp bảng này.
CREATE POLICY email_verification_codes_insert ON email_verification_codes FOR INSERT WITH CHECK (true);
CREATE POLICY email_verification_codes_select ON email_verification_codes FOR SELECT USING (is_admin());
CREATE POLICY email_verification_codes_update ON email_verification_codes FOR UPDATE USING (is_admin());
CREATE POLICY email_verification_codes_delete ON email_verification_codes FOR DELETE USING (is_admin());

-- =====================================================================
-- 11. AUTH FUNCTIONS (SECURITY DEFINER — bypass RLS CHỈ cho đúng việc xác thực)
-- =====================================================================
-- Đăng ký bằng email + mật khẩu (dự phòng cho App Khách) — CŨNG PHẢI qua
-- SECURITY DEFINER: INSERT ... RETURNING lúc còn anonymous sẽ bị chặn bởi
-- chính users_select policy (không thấy được row mình vừa tạo, vì lúc đó
-- chưa có id để so `id = current_user_id()`) — cùng gốc rễ với bug FORCE ở
-- trên, chỉ là biểu hiện khác (RETURNING ngầm cần quyền SELECT trên row
-- vừa ghi). Mọi INSERT vào `users` lúc CHƯA đăng nhập phải đi qua function
-- SECURITY DEFINER như dưới đây, không gọi INSERT...RETURNING thẳng từ
-- app code.
CREATE OR REPLACE FUNCTION auth_register_user(p_name text, p_email text, p_password_hash text, p_role text)
RETURNS TABLE (id integer, name varchar, email_address varchar)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE v_id integer;
BEGIN
  IF p_role NOT IN ('customer', 'worker') THEN
    RAISE EXCEPTION 'role phải là customer hoặc worker' USING ERRCODE = '22023';
  END IF;
  INSERT INTO users (name, email_address, auth_provider, password_hash)
    VALUES (p_name, p_email, 'password', p_password_hash)
    RETURNING users.id INTO v_id;
  IF p_role = 'customer' THEN
    INSERT INTO customers (user_id) VALUES (v_id);
  ELSE
    INSERT INTO workers (user_id) VALUES (v_id);
  END IF;
  RETURN QUERY SELECT u.id, u.name, u.email_address FROM users u WHERE u.id = v_id;
END;
$$;

-- Đăng nhập/đăng ký Google — tìm theo google_id trước, rồi theo email (lỡ
-- trước đó đã có tài khoản email_code cùng email), không thấy thì tạo mới.
CREATE OR REPLACE FUNCTION auth_upsert_google_user(
  p_google_id text, p_email text, p_name text, p_avatar text, p_role text
) RETURNS TABLE (id integer, name varchar, email_address varchar, avatar varchar, is_new boolean)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE v_id integer; v_is_new boolean := false;
BEGIN
  SELECT u.id INTO v_id FROM users u WHERE u.google_id = p_google_id;
  IF v_id IS NULL THEN
    SELECT u.id INTO v_id FROM users u WHERE u.email_address = p_email;
    IF v_id IS NOT NULL THEN
      UPDATE users SET google_id = p_google_id WHERE users.id = v_id;
    END IF;
  END IF;
  IF v_id IS NULL THEN
    IF p_role NOT IN ('customer', 'worker') THEN
      RAISE EXCEPTION 'role phải là customer hoặc worker' USING ERRCODE = '22023';
    END IF;
    INSERT INTO users (name, email_address, auth_provider, google_id, avatar)
      VALUES (p_name, p_email, 'google', p_google_id, p_avatar)
      RETURNING users.id INTO v_id;
    IF p_role = 'customer' THEN
      INSERT INTO customers (user_id) VALUES (v_id);
    ELSE
      INSERT INTO workers (user_id) VALUES (v_id);
    END IF;
    v_is_new := true;
  END IF;
  RETURN QUERY SELECT u.id, u.name, u.email_address, u.avatar, v_is_new FROM users u WHERE u.id = v_id;
END;
$$;

-- Đăng nhập/đăng ký bằng email (gọi SAU KHI auth_verify_email_code trả
-- true) — không có mật khẩu, không có Google, chỉ email đã xác thực mã.
CREATE OR REPLACE FUNCTION auth_upsert_email_user(p_email text, p_name text, p_role text)
RETURNS TABLE (id integer, name varchar, email_address varchar, avatar varchar, is_new boolean)
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE v_id integer; v_is_new boolean := false;
BEGIN
  SELECT u.id INTO v_id FROM users u WHERE u.email_address = p_email;
  IF v_id IS NULL THEN
    IF p_role NOT IN ('customer', 'worker') THEN
      RAISE EXCEPTION 'role phải là customer hoặc worker' USING ERRCODE = '22023';
    END IF;
    INSERT INTO users (name, email_address, auth_provider)
      VALUES (COALESCE(p_name, ''), p_email, 'email_code')
      RETURNING users.id INTO v_id;
    IF p_role = 'customer' THEN
      INSERT INTO customers (user_id) VALUES (v_id);
    ELSE
      INSERT INTO workers (user_id) VALUES (v_id);
    END IF;
    v_is_new := true;
  END IF;
  RETURN QUERY SELECT u.id, u.name, u.email_address, u.avatar, v_is_new FROM users u WHERE u.id = v_id;
END;
$$;

-- Đăng nhập email + mật khẩu (dự phòng cho App Khách).
CREATE OR REPLACE FUNCTION auth_lookup_user_by_email(p_email text)
RETURNS TABLE (
  id integer, name varchar, email_address varchar, avatar varchar,
  password_hash varchar, is_admin boolean, is_worker boolean
)
SECURITY DEFINER SET search_path = public LANGUAGE sql AS $$
  SELECT u.id, u.name, u.email_address, u.avatar, u.password_hash,
    EXISTS (SELECT 1 FROM admins a WHERE a.user_id = u.id),
    EXISTS (SELECT 1 FROM workers w WHERE w.user_id = u.id)
  FROM users u WHERE u.email_address = p_email LIMIT 1;
$$;

-- Đăng nhập Google — tìm theo google_id (KHÔNG lộ password_hash vì tài
-- khoản Google không có, cột này sẽ luôn NULL với auth_provider='google').
CREATE OR REPLACE FUNCTION auth_lookup_user_by_google(p_google_id text)
RETURNS TABLE (id integer, name varchar, email_address varchar, avatar varchar, is_admin boolean, is_worker boolean)
SECURITY DEFINER SET search_path = public LANGUAGE sql AS $$
  SELECT u.id, u.name, u.email_address, u.avatar,
    EXISTS (SELECT 1 FROM admins a WHERE a.user_id = u.id),
    EXISTS (SELECT 1 FROM workers w WHERE w.user_id = u.id)
  FROM users u WHERE u.google_id = p_google_id LIMIT 1;
$$;

-- Đăng nhập bằng email (dùng SAU KHI đã xác thực mã qua
-- auth_verify_email_code bên dưới) — không cần mật khẩu.
CREATE OR REPLACE FUNCTION auth_lookup_user_by_email_only(p_email text)
RETURNS TABLE (id integer, name varchar, email_address varchar, avatar varchar, is_admin boolean, is_worker boolean)
SECURITY DEFINER SET search_path = public LANGUAGE sql AS $$
  SELECT u.id, u.name, u.email_address, u.avatar,
    EXISTS (SELECT 1 FROM admins a WHERE a.user_id = u.id),
    EXISTS (SELECT 1 FROM workers w WHERE w.user_id = u.id)
  FROM users u WHERE u.email_address = p_email LIMIT 1;
$$;

-- Xác thực + "tiêu" 1 mã gửi qua email (đánh dấu consumed_at, không cho
-- dùng lại). Trả về true/false thay vì trả dữ liệu, vì bước xác thực và
-- bước đăng nhập tách rời (controller tự gọi auth_lookup_user_by_email_only
-- sau khi hàm này trả true).
CREATE OR REPLACE FUNCTION auth_verify_email_code(p_email text, p_code_hash text)
RETURNS boolean
SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE v_id integer;
BEGIN
  SELECT id INTO v_id FROM email_verification_codes
    WHERE email = p_email AND code_hash = p_code_hash
      AND consumed_at IS NULL AND expires_at > now()
    ORDER BY created_at DESC LIMIT 1;
  IF v_id IS NULL THEN
    RETURN false;
  END IF;
  UPDATE email_verification_codes SET consumed_at = now() WHERE id = v_id;
  RETURN true;
END;
$$;

-- =====================================================================
-- 12. GRANTS
-- =====================================================================
GRANT USAGE ON SCHEMA public TO thonhanh_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO thonhanh_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO thonhanh_app;
GRANT EXECUTE ON FUNCTION current_user_id() TO thonhanh_app;
GRANT EXECUTE ON FUNCTION current_user_role() TO thonhanh_app;
GRANT EXECUTE ON FUNCTION is_admin() TO thonhanh_app;
GRANT EXECUTE ON FUNCTION worker_has_active_offer(integer, integer) TO thonhanh_app;
GRANT EXECUTE ON FUNCTION auth_lookup_user_by_email(text) TO thonhanh_app;
GRANT EXECUTE ON FUNCTION auth_lookup_user_by_google(text) TO thonhanh_app;
GRANT EXECUTE ON FUNCTION auth_lookup_user_by_email_only(text) TO thonhanh_app;
GRANT EXECUTE ON FUNCTION auth_verify_email_code(text, text) TO thonhanh_app;
GRANT EXECUTE ON FUNCTION auth_register_user(text, text, text, text) TO thonhanh_app;
GRANT EXECUTE ON FUNCTION auth_upsert_google_user(text, text, text, text, text) TO thonhanh_app;
GRANT EXECUTE ON FUNCTION auth_upsert_email_user(text, text, text) TO thonhanh_app;
