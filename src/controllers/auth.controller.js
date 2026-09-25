const bcrypt = require('bcryptjs');
const { signToken } = require('../utils/jwt');

// POST /api/auth/register
// body: { name, email_address, username, password, phone_number?, sex?, role }
// role: 'customer' | 'worker'  (admin không tự đăng ký qua endpoint này)
async function register(req, res) {
  const { name, email_address, username, password, phone_number, sex, role } = req.body;

  if (!name || !email_address || !username || !password || !role) {
    return res.status(400).json({ error: 'Thiếu thông tin bắt buộc (name, email_address, username, password, role).' });
  }
  if (!['customer', 'worker'].includes(role)) {
    return res.status(400).json({ error: "role phải là 'customer' hoặc 'worker'." });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const { rows } = await req.db.query(
    `INSERT INTO users (name, email_address, username, password_hash, phone_number, sex)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, email_address, username`,
    [name, email_address, username, passwordHash, phone_number || null, sex || null]
  );
  const user = rows[0];

  const table = role === 'customer' ? 'customers' : 'workers';
  await req.db.query(`INSERT INTO ${table} (user_id) VALUES ($1)`, [user.id]);

  const token = signToken({ id: user.id, role });
  res.status(201).json({ token, user: { ...user, role } });
}

// POST /api/auth/login
// body: { username, password }
async function login(req, res) {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Thiếu username hoặc password.' });
  }

  // Đọc trực tiếp bằng client đã có RLS 'anonymous' — policy users_select cho
  // phép anonymous đọc bằng id/đối tác chung đơn, KHÔNG cho đọc theo username.
  // Vì vậy bước xác thực đăng nhập cần một truy vấn không bị RLS chặn: ta
  // dùng SECURITY DEFINER function thay vì nới lỏng policy chung.
  const { rows } = await req.db.query('SELECT * FROM auth_lookup_user($1)', [username]);
  const user = rows[0];
  if (!user) {
    return res.status(401).json({ error: 'Sai username hoặc password.' });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'Sai username hoặc password.' });
  }

  const role = user.is_admin ? 'admin' : user.is_worker ? 'worker' : 'customer';
  const token = signToken({ id: user.id, role });
  res.json({
    token,
    user: { id: user.id, name: user.name, username: user.username, email_address: user.email_address, role },
  });
}

module.exports = { register, login };
