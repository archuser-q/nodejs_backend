const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { signToken } = require('../utils/jwt');

async function register(req, res) {
  const { name, email_address, username, password, phone_number, sex, role } = req.body;

  if (!name || !email_address || !username || !password || !role) {
    return res.status(400).json({ error: 'Thiếu thông tin bắt buộc (name, email_address, username, password, role).' });
  }
  if (!['customer', 'worker'].includes(role)) {
    return res.status(400).json({ error: "role phải là 'customer' hoặc 'worker'." });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO users (name, email_address, username, password_hash, phone_number, sex)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email_address, username`,
      [name, email_address, username, passwordHash, phone_number || null, sex || null]
    );
    const user = rows[0];

    const table = role === 'customer' ? 'customers' : 'workers';
    await client.query(`INSERT INTO ${table} (user_id) VALUES ($1)`, [user.id]);

    await client.query('COMMIT');

    const token = signToken({ id: user.id, role });
    res.status(201).json({ token, user: { ...user, role } });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function login(req, res) {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Thiếu username hoặc password.' });
  }

  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.username, u.email_address, u.password_hash, u.is_active,
            EXISTS (SELECT 1 FROM admins a WHERE a.user_id = u.id) AS is_admin,
            EXISTS (SELECT 1 FROM workers w WHERE w.user_id = u.id) AS is_worker
     FROM users u
     WHERE u.username = $1`,
    [username]
  );
  const user = rows[0];
  if (!user) {
    return res.status(401).json({ error: 'Sai username hoặc password.' });
  }
  if (!user.is_active) {
    return res.status(403).json({ error: 'Tài khoản đã bị khoá.' });
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