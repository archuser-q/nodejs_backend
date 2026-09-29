const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { signToken } = require('../utils/jwt');

/**
 * VIẾT LẠI TOÀN BỘ so với bản gốc (username/password cổ điển) — App Thợ
 * (đã build xong UI) chỉ dùng 2 cách: Google, hoặc mã xác nhận gửi qua
 * email — KHÔNG cách nào có mật khẩu. Giữ lại register/login cổ điển làm
 * phương án 3 (đổi username -> email cho gọn) phòng khi App Khách (Thành
 * viên A) vẫn cần — xem thảo luận trong README.
 *
 * QUAN TRỌNG: mọi hàm ở đây tạo user lúc CHƯA đăng nhập đều gọi qua
 * function SECURITY DEFINER (auth_register_user/auth_upsert_*), KHÔNG bao
 * giờ tự viết INSERT INTO users ... RETURNING thẳng trong controller — sẽ
 * dính đúng bug RLS đã tìm ra và ghi chú kỹ trong db/schema.sql.
 */

function issueSession(res, user, role) {
  const token = signToken({ id: user.id, role });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email_address, avatar: user.avatar, role } });
}

function roleFromLookup(row) {
  if (row.is_admin) return 'admin';
  if (row.is_worker) return 'worker';
  return 'customer';
}

// ---------------------------------------------------------------------
// Cổ điển: email + mật khẩu (dự phòng cho App Khách nếu cần)
// ---------------------------------------------------------------------
exports.register = async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !['customer', 'worker'].includes(role)) {
    return res.status(400).json({ error: 'Thiếu name/email/password hoặc role không hợp lệ (customer|worker).' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const { rows } = await req.db.query('SELECT * FROM auth_register_user($1, $2, $3, $4)', [name, email, passwordHash, role]);
  issueSession(res, rows[0], role);
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Thiếu email/password.' });
  const { rows } = await req.db.query('SELECT * FROM auth_lookup_user_by_email($1)', [email]);
  const user = rows[0];
  if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng.' });
  }
  issueSession(res, user, roleFromLookup(user));
};

// ---------------------------------------------------------------------
// Google — App Thợ dùng cách này làm phương thức chính
// ---------------------------------------------------------------------
// TODO(api): body hiện nhận thẳng thông tin Google (google_id/email/name/
// avatar) do CLIENT tự gửi lên — CHƯA xác thực chữ ký id_token thật với
// Google. Khi có domain thật + OAuth Client ID, đổi input thành 1
// `id_token` duy nhất, verify bằng thư viện `google-auth-library`
// (`OAuth2Client.verifyIdToken`) ở đây rồi mới lấy thông tin từ token ĐÃ
// XÁC THỰC, không tin thẳng dữ liệu client tự khai như bản này.
exports.googleAuth = async (req, res) => {
  const { google_id, email, name, avatar_url, role } = req.body;
  if (!google_id || !email || !name || !['customer', 'worker'].includes(role)) {
    return res.status(400).json({ error: 'Thiếu google_id/email/name hoặc role không hợp lệ (customer|worker).' });
  }
  const { rows } = await req.db.query('SELECT * FROM auth_upsert_google_user($1, $2, $3, $4, $5)', [
    google_id, email, name, avatar_url || null, role,
  ]);
  issueSession(res, rows[0], role);
};

// ---------------------------------------------------------------------
// Mã xác nhận qua email — App Thợ dùng làm phương thức thứ 2
// ---------------------------------------------------------------------
function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

// TODO(api): gửi `code` qua dịch vụ email thật (Resend/SendGrid...) thay vì
// trả về trong response / log ra console — xem biến EXPOSE_DEV_CODES bên
// dưới, mặc định TẮT nếu NODE_ENV=production để không lộ mã qua API.
exports.requestEmailCode = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Thiếu email.' });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = hashCode(code);
  await req.db.query(
    "INSERT INTO email_verification_codes (email, code_hash, expires_at) VALUES ($1, $2, now() + interval '5 minutes')",
    [email, codeHash],
  );

  // eslint-disable-next-line no-console
  console.log(`[auth] Ma xac nhan cho ${email}: ${code} (het han sau 5 phut)`);

  const exposeDevCode = process.env.NODE_ENV !== 'production' && process.env.EXPOSE_DEV_CODES !== 'false';
  res.json({ sent: true, ...(exposeDevCode ? { devCode: code } : {}) });
};

exports.verifyEmailCode = async (req, res) => {
  const { email, code, name, role } = req.body;
  if (!email || !code || !['customer', 'worker'].includes(role)) {
    return res.status(400).json({ error: 'Thiếu email/code hoặc role không hợp lệ (customer|worker).' });
  }
  const codeHash = hashCode(code);
  const { rows: verifyRows } = await req.db.query('SELECT auth_verify_email_code($1, $2) AS ok', [email, codeHash]);
  if (!verifyRows[0].ok) {
    return res.status(401).json({ error: 'Ma khong dung hoac da het han.' });
  }
  const { rows } = await req.db.query('SELECT * FROM auth_upsert_email_user($1, $2, $3)', [email, name || '', role]);
  issueSession(res, rows[0], role);
};
