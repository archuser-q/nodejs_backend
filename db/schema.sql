-- =====================================================================
-- THỢ NHANH — PostgreSQL schema với Row-Level Security (RLS)
-- =====================================================================
-- Dựa trên ERD bạn cung cấp. Có 2 điều chỉnh so với ERD gốc (đã trao đổi
-- trong hội thoại trước), ghi chú lại để bạn đối chiếu khi bảo vệ:
--   1) payments.order_id thay cho payments.customer_user_id — vì 1 payment
--      gắn với 1 đơn hàng cụ thể, khách hàng suy ra được qua order.
--   2) orders.latitude / orders.longitude — vị trí thực hiện sửa chữa của
--      CHÍNH đơn hàng đó, tách khỏi users.latitude/longitude (vị trí hồ sơ).
-- Nếu bạn muốn giữ đúng 100% ERD gốc (không có 2 thay đổi trên), sửa lại
-- phần tương ứng trước khi chạy.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. ROLES
-- ---------------------------------------------------------------------
-- thonhanh_owner: role sở hữu schema, dùng để chạy migration (KHÔNG dùng
--   role này trong connection string của app Node.js).
-- thonhanh_app:   role app Node.js dùng để kết nối. RLS chỉ có tác dụng
--   với role KHÔNG PHẢI chủ sở hữu bảng, nên app phải dùng role này.
-- Đổi mật khẩu trước khi dùng thật.
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

-- Chạy phần DDL bên dưới bằng owner (hoặc bằng superuser rồi ALTER OWNER).

-- ---------------------------------------------------------------------
-- 1. EXTENSIONS
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- cho gen_random_uuid() nếu cần sau này

-- ---------------------------------------------------------------------
-- 2. USER & SUBTYPES (User -> Customer / Worker / Admin)
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name              varchar(255) NOT NULL,
  sex               varchar(255),
  email_address     varchar(255) NOT NULL UNIQUE,
  username          varchar(255) NOT NULL UNIQUE,
  phone_number      varchar(255),
  authenticate_code varchar(255),
  password_hash     varchar(255) NOT NULL,
  is_verified       integer NOT NULL DEFAULT 0,
  is_active         integer NOT NULL DEFAULT 1,
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now(),
  balance           integer DEFAULT 0,
  avatar            varchar(255),
  longitude         float,
  latitude          float
);

CREATE TABLE customers (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE workers (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE admins (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------
-- 3. SERVICES & WORKER_SERVICES
-- ---------------------------------------------------------------------
CREATE TABLE services (
  id       integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name     varchar(255) NOT NULL,
  category varchar(255)
);

CREATE TABLE worker_services (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trust_score    integer NOT NULL DEFAULT 0,
  total_job_done integer NOT NULL DEFAULT 0,
  worker_user_id integer NOT NULL REFERENCES workers(user_id) ON DELETE CASCADE,
  service_id     integer NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  UNIQUE (worker_user_id, service_id)
);

-- ---------------------------------------------------------------------
-- 4. ORDERS & REPAIR_REQUESTS
-- ---------------------------------------------------------------------
CREATE TABLE orders (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  create_at        timestamp NOT NULL DEFAULT now(),
  status           varchar(255) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','matched','in_progress','completed','cancelled')),
  customer_user_id integer NOT NULL REFERENCES customers(user_id),
  worker_user_id   integer REFERENCES workers(user_id),
  -- Vị trí thực hiện sửa chữa của đơn này (có thể khác vị trí hồ sơ khách):
  latitude         float,
  longitude        float
);

CREATE TABLE repair_requests (
  id                  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_descriptiion    varchar(255),
  quantity            integer,
  price               integer,
  warranty_expiry_date timestamp,
  order_id            integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------
-- 5. PAYMENTS
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

-- ---------------------------------------------------------------------
-- 6. QUOTES (báo giá phát sinh, gắn với 1 order cụ thể)
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 7. REVIEWS (đầu vào cho thuật toán trust score)
-- ---------------------------------------------------------------------
CREATE TABLE reviews (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  content            varchar(255),
  rating_score       integer NOT NULL CHECK (rating_score BETWEEN 1 AND 5),
  created_at         timestamp NOT NULL DEFAULT now(),
  customer_user_id   integer NOT NULL REFERENCES customers(user_id),
  worker_user_id     integer NOT NULL REFERENCES workers(user_id)
);

-- ---------------------------------------------------------------------
-- 8. ORDER_HISTORY (audit trail trạng thái đơn hàng)
-- ---------------------------------------------------------------------
CREATE TABLE order_history (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  status          varchar(255) NOT NULL,
  updated_at      timestamp NOT NULL DEFAULT now(),
  changed_by_type varchar(50) NOT NULL DEFAULT 'system'
                    CHECK (changed_by_type IN ('system','customer','worker','admin')),
  note            varchar(255),
  order_id        integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id         integer REFERENCES users(id) -- nullable: NULL khi hệ thống tự đổi
);

-- ---------------------------------------------------------------------
-- 9. MATCHING_CONFIG (trọng số thuật toán ghép cặp do Admin cấu hình)
-- ---------------------------------------------------------------------
CREATE TABLE matching_config (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  weight_distance    numeric(5,2) NOT NULL DEFAULT 0.4,
  weight_trust_score numeric(5,2) NOT NULL DEFAULT 0.4,
  weight_price       numeric(5,2) NOT NULL DEFAULT 0.2,
  mode               varchar(20) NOT NULL DEFAULT 'instant'
                       CHECK (mode IN ('instant','batch')),
  updated_at         timestamp NOT NULL DEFAULT now(),
  updated_by         integer REFERENCES admins(user_id)
);

-- Đảm bảo mọi bảng đều mặc định updated_at hợp lý khi UPDATE:
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- 10. ROW-LEVEL SECURITY
-- =====================================================================
-- Quy ước: session của app.js SET LOCAL 2 biến trước mỗi transaction:
--   app.current_user_id   -> id của user đang đăng nhập (rỗng nếu anonymous)
--   app.current_user_role -> 'customer' | 'worker' | 'admin' | 'anonymous'
--
-- Helper functions để policy gọn hơn và tránh lỗi ép kiểu khi giá trị rỗng.

CREATE OR REPLACE FUNCTION current_user_id() RETURNS integer AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::integer;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION current_user_role() RETURNS text AS $$
  SELECT COALESCE(NULLIF(current_setting('app.current_user_role', true), ''), 'anonymous');
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean AS $$
  SELECT current_user_role() = 'admin';
$$ LANGUAGE sql STABLE;

-- Bật RLS + FORCE (áp dụng cả với role sở hữu bảng nếu lỡ dùng owner để query)
ALTER TABLE users            ENABLE ROW LEVEL SECURITY; ALTER TABLE users            FORCE ROW LEVEL SECURITY;
ALTER TABLE customers        ENABLE ROW LEVEL SECURITY; ALTER TABLE customers        FORCE ROW LEVEL SECURITY;
ALTER TABLE workers          ENABLE ROW LEVEL SECURITY; ALTER TABLE workers          FORCE ROW LEVEL SECURITY;
ALTER TABLE admins           ENABLE ROW LEVEL SECURITY; ALTER TABLE admins           FORCE ROW LEVEL SECURITY;
ALTER TABLE services         ENABLE ROW LEVEL SECURITY; ALTER TABLE services         FORCE ROW LEVEL SECURITY;
ALTER TABLE worker_services  ENABLE ROW LEVEL SECURITY; ALTER TABLE worker_services  FORCE ROW LEVEL SECURITY;
ALTER TABLE orders           ENABLE ROW LEVEL SECURITY; ALTER TABLE orders           FORCE ROW LEVEL SECURITY;
ALTER TABLE repair_requests  ENABLE ROW LEVEL SECURITY; ALTER TABLE repair_requests  FORCE ROW LEVEL SECURITY;
ALTER TABLE payments         ENABLE ROW LEVEL SECURITY; ALTER TABLE payments         FORCE ROW LEVEL SECURITY;
ALTER TABLE quotes           ENABLE ROW LEVEL SECURITY; ALTER TABLE quotes           FORCE ROW LEVEL SECURITY;
ALTER TABLE reviews          ENABLE ROW LEVEL SECURITY; ALTER TABLE reviews          FORCE ROW LEVEL SECURITY;
ALTER TABLE order_history    ENABLE ROW LEVEL SECURITY; ALTER TABLE order_history    FORCE ROW LEVEL SECURITY;
ALTER TABLE matching_config  ENABLE ROW LEVEL SECURITY; ALTER TABLE matching_config  FORCE ROW LEVEL SECURITY;

-- ---- users ------------------------------------------------------------
-- Ai cũng đọc được thông tin công khai tối thiểu để hiển thị tên thợ/khách
-- trong đơn hàng của mình; nhưng để đơn giản & an toàn cho MVP, ta giới hạn:
-- xem được hồ sơ của chính mình, hoặc admin xem tất cả, hoặc xem hồ sơ đối
-- tác đang có chung 1 đơn hàng (customer <-> worker qua orders).
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
  WITH CHECK (current_user_role() = 'anonymous' OR is_admin()); -- đăng ký mới hoặc admin tạo hộ

CREATE POLICY users_update ON users FOR UPDATE
  USING (is_admin() OR id = current_user_id())
  WITH CHECK (is_admin() OR id = current_user_id());

CREATE POLICY users_delete ON users FOR DELETE
  USING (is_admin());

-- ---- customers / workers / admins -------------------------------------
CREATE POLICY customers_select ON customers FOR SELECT
  USING (is_admin() OR user_id = current_user_id()
         OR user_id IN (SELECT customer_user_id FROM orders WHERE worker_user_id = current_user_id()));
-- Cho phép cả 'anonymous' vì bước tạo customer diễn ra ngay trong luồng
-- đăng ký (cùng transaction với INSERT users), trước khi user có JWT nên
-- current_user_id() vẫn chưa gắn được với id vừa tạo.
CREATE POLICY customers_insert ON customers FOR INSERT
  WITH CHECK (user_id = current_user_id() OR is_admin() OR current_user_role() = 'anonymous');
CREATE POLICY customers_update ON customers FOR UPDATE
  USING (is_admin() OR user_id = current_user_id());
CREATE POLICY customers_delete ON customers FOR DELETE
  USING (is_admin());

CREATE POLICY workers_select ON workers FOR SELECT
  USING (true); -- danh sách thợ cần hiển thị công khai cho việc tìm/ghép cặp
CREATE POLICY workers_insert ON workers FOR INSERT
  WITH CHECK (user_id = current_user_id() OR is_admin() OR current_user_role() = 'anonymous');
CREATE POLICY workers_update ON workers FOR UPDATE
  USING (is_admin() OR user_id = current_user_id());
CREATE POLICY workers_delete ON workers FOR DELETE
  USING (is_admin());

CREATE POLICY admins_select ON admins FOR SELECT USING (is_admin());
CREATE POLICY admins_all ON admins FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- ---- services / worker_services ----------------------------------------
CREATE POLICY services_select ON services FOR SELECT USING (true); -- danh mục công khai
CREATE POLICY services_write ON services FOR INSERT WITH CHECK (is_admin());
CREATE POLICY services_update ON services FOR UPDATE USING (is_admin());
CREATE POLICY services_delete ON services FOR DELETE USING (is_admin());

CREATE POLICY worker_services_select ON worker_services FOR SELECT USING (true);
CREATE POLICY worker_services_insert ON worker_services FOR INSERT
  WITH CHECK (worker_user_id = current_user_id() OR is_admin());
CREATE POLICY worker_services_update ON worker_services FOR UPDATE
  USING (worker_user_id = current_user_id() OR is_admin());
CREATE POLICY worker_services_delete ON worker_services FOR DELETE
  USING (worker_user_id = current_user_id() OR is_admin());

-- ---- orders --------------------------------------------------------------
CREATE POLICY orders_select ON orders FOR SELECT
  USING (is_admin() OR customer_user_id = current_user_id() OR worker_user_id = current_user_id());
CREATE POLICY orders_insert ON orders FOR INSERT
  WITH CHECK (customer_user_id = current_user_id() AND current_user_role() = 'customer');
CREATE POLICY orders_update ON orders FOR UPDATE
  USING (is_admin() OR customer_user_id = current_user_id() OR worker_user_id = current_user_id())
  WITH CHECK (is_admin() OR customer_user_id = current_user_id() OR worker_user_id = current_user_id());
CREATE POLICY orders_delete ON orders FOR DELETE
  USING (is_admin());

-- ---- repair_requests -------------------------------------------------
CREATE POLICY repair_requests_select ON repair_requests FOR SELECT
  USING (is_admin() OR order_id IN (
    SELECT id FROM orders WHERE customer_user_id = current_user_id() OR worker_user_id = current_user_id()
  ));
CREATE POLICY repair_requests_write ON repair_requests FOR INSERT
  WITH CHECK (order_id IN (SELECT id FROM orders WHERE customer_user_id = current_user_id()) OR is_admin());
CREATE POLICY repair_requests_update ON repair_requests FOR UPDATE
  USING (is_admin() OR order_id IN (
    SELECT id FROM orders WHERE customer_user_id = current_user_id() OR worker_user_id = current_user_id()
  ));
CREATE POLICY repair_requests_delete ON repair_requests FOR DELETE
  USING (is_admin());

-- ---- payments -----------------------------------------------------------
CREATE POLICY payments_select ON payments FOR SELECT
  USING (is_admin() OR order_id IN (
    SELECT id FROM orders WHERE customer_user_id = current_user_id() OR worker_user_id = current_user_id()
  ));
CREATE POLICY payments_insert ON payments FOR INSERT
  WITH CHECK (is_admin() OR order_id IN (SELECT id FROM orders WHERE customer_user_id = current_user_id()));
CREATE POLICY payments_update ON payments FOR UPDATE
  USING (is_admin());
CREATE POLICY payments_delete ON payments FOR DELETE
  USING (is_admin());

-- ---- quotes ---------------------------------------------------------------
CREATE POLICY quotes_select ON quotes FOR SELECT
  USING (is_admin() OR worker_user_id = current_user_id()
         OR order_id IN (SELECT id FROM orders WHERE customer_user_id = current_user_id()));
CREATE POLICY quotes_insert ON quotes FOR INSERT
  WITH CHECK (worker_user_id = current_user_id() AND current_user_role() = 'worker');
CREATE POLICY quotes_update ON quotes FOR UPDATE
  USING (is_admin() OR worker_user_id = current_user_id()
         OR order_id IN (SELECT id FROM orders WHERE customer_user_id = current_user_id())); -- khách accept/reject
CREATE POLICY quotes_delete ON quotes FOR DELETE
  USING (is_admin() OR worker_user_id = current_user_id());

-- ---- reviews --------------------------------------------------------------
CREATE POLICY reviews_select ON reviews FOR SELECT USING (true); -- điểm tin cậy cần công khai
CREATE POLICY reviews_insert ON reviews FOR INSERT
  WITH CHECK (customer_user_id = current_user_id() AND current_user_role() = 'customer');
CREATE POLICY reviews_update ON reviews FOR UPDATE
  USING (is_admin() OR customer_user_id = current_user_id());
CREATE POLICY reviews_delete ON reviews FOR DELETE
  USING (is_admin() OR customer_user_id = current_user_id());

-- ---- order_history ----------------------------------------------------
CREATE POLICY order_history_select ON order_history FOR SELECT
  USING (is_admin() OR order_id IN (
    SELECT id FROM orders WHERE customer_user_id = current_user_id() OR worker_user_id = current_user_id()
  ));
CREATE POLICY order_history_insert ON order_history FOR INSERT
  WITH CHECK (is_admin() OR order_id IN (
    SELECT id FROM orders WHERE customer_user_id = current_user_id() OR worker_user_id = current_user_id()
  ));
-- Lịch sử là log, không cho sửa/xoá thủ công ngoài admin:
CREATE POLICY order_history_update ON order_history FOR UPDATE USING (is_admin());
CREATE POLICY order_history_delete ON order_history FOR DELETE USING (is_admin());

-- ---- matching_config ----------------------------------------------------
CREATE POLICY matching_config_select ON matching_config FOR SELECT USING (is_admin());
CREATE POLICY matching_config_write ON matching_config FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

-- =====================================================================
-- 10b. LOGIN LOOKUP FUNCTION
-- =====================================================================
-- users_select policy CHỈ cho phép đọc hồ sơ của chính mình / đối tác chung
-- đơn hàng — hợp lý cho vận hành bình thường, nhưng lúc ĐĂNG NHẬP thì user
-- CHƯA có JWT (chưa có current_user_id()), nên không thể tự SELECT theo
-- username qua RLS thông thường. Giải pháp chuẩn: 1 function SECURITY
-- DEFINER, chỉ trả về đúng các cột cần cho việc xác thực, không phải mở
-- toang bảng users.
CREATE OR REPLACE FUNCTION auth_lookup_user(p_username text)
RETURNS TABLE (
  id integer,
  name varchar,
  username varchar,
  email_address varchar,
  password_hash varchar,
  is_admin boolean,
  is_worker boolean
)
SECURITY DEFINER
SET search_path = public
LANGUAGE sql
AS $$
  SELECT
    u.id, u.name, u.username, u.email_address, u.password_hash,
    EXISTS (SELECT 1 FROM admins a WHERE a.user_id = u.id) AS is_admin,
    EXISTS (SELECT 1 FROM workers w WHERE w.user_id = u.id) AS is_worker
  FROM users u
  WHERE u.username = p_username
  LIMIT 1;
$$;

-- Owner của function phải là role sở hữu bảng (thonhanh_owner) để
-- SECURITY DEFINER bypass RLS đúng như dự kiến. Nếu bạn chạy toàn bộ file
-- này bằng thonhanh_owner (như hướng dẫn ở đầu file) thì mặc định đã đúng.

-- =====================================================================
-- 11. GRANTS cho role app.js dùng để kết nối
-- =====================================================================
GRANT USAGE ON SCHEMA public TO thonhanh_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO thonhanh_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO thonhanh_app;
GRANT EXECUTE ON FUNCTION current_user_id() TO thonhanh_app;
GRANT EXECUTE ON FUNCTION current_user_role() TO thonhanh_app;
GRANT EXECUTE ON FUNCTION is_admin() TO thonhanh_app;
GRANT EXECUTE ON FUNCTION auth_lookup_user(text) TO thonhanh_app;

-- Lưu ý: bảng do thonhanh_owner sở hữu, thonhanh_app KHÔNG PHẢI owner nên
-- RLS luôn được áp dụng cho mọi câu lệnh app.js chạy qua role này.
