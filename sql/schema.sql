CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
  user_id                 integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  verification_doc_url    varchar(500),
  verification_doc_status varchar(50) NOT NULL DEFAULT 'pending'
                             CHECK (verification_doc_status IN ('pending','approved','rejected'))
);

CREATE TABLE customer_worker (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_user_id integer NOT NULL REFERENCES customers(user_id) ON DELETE CASCADE,
  worker_user_id   integer NOT NULL REFERENCES workers(user_id) ON DELETE CASCADE,
  created_at       timestamp NOT NULL DEFAULT now(),
  UNIQUE (customer_user_id, worker_user_id)
);

CREATE TABLE messages (
  id                  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_worker_id  integer NOT NULL REFERENCES customer_worker(id) ON DELETE CASCADE,
  sender_user_id      integer NOT NULL REFERENCES users(id),
  content             varchar(1000) NOT NULL,
  sent_at             timestamp NOT NULL DEFAULT now(),
  is_read             integer NOT NULL DEFAULT 0
);

CREATE TABLE admins (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);

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

CREATE TABLE orders (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  create_at        timestamp NOT NULL DEFAULT now(),
  status           varchar(255) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','matched','in_progress','completed','cancelled')),
  customer_user_id integer NOT NULL REFERENCES customers(user_id),
  worker_user_id   integer REFERENCES workers(user_id),
  latitude         float,
  longitude        float
);

CREATE TABLE repair_requests (
  id                    integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_descriptiion      varchar(255),
  quantity              integer,
  price                 integer,
  warranty_expiry_date  timestamp,
  order_id              integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE
);

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
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  content           varchar(255),
  rating_score      integer NOT NULL CHECK (rating_score BETWEEN 1 AND 5),
  created_at        timestamp NOT NULL DEFAULT now(),
  customer_user_id  integer NOT NULL REFERENCES customers(user_id),
  worker_user_id    integer NOT NULL REFERENCES workers(user_id)
);

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

CREATE TABLE matching_config (
  id                 integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  weight_distance    numeric(5,2) NOT NULL DEFAULT 0.4,
  weight_trust_score numeric(5,2) NOT NULL DEFAULT 0.4,
  weight_price       numeric(5,2) NOT NULL DEFAULT 0.2,
  mode               varchar(20) NOT NULL DEFAULT 'instant'
                       CHECK (mode IN ('instant','batch')),
  updated_at         timestamp NOT NULL DEFAULT now(),
  updated_by         integer REFERENCES admins(user_id)
);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();



-- Drop tables
DROP TABLE IF EXISTS
  messages, customer_worker, order_history, matching_config,
  reviews, quotes, payments, repair_requests, orders,
  worker_services, services, admins, workers, customers, users
CASCADE;