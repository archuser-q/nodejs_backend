const pool = require('../config/db');
const { forbidUnlessOwnerOrAdmin } = require('../utils/authorize');

async function getMe(req, res) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy user.' });
  res.json(rows[0]);
}

async function updateMe(req, res) {
  const allowed = ['name', 'sex', 'phone_number', 'avatar', 'longitude', 'latitude'];
  const fields = Object.keys(req.body).filter((k) => allowed.includes(k));
  if (fields.length === 0) {
    return res.status(400).json({ error: `Không có trường hợp lệ để cập nhật (cho phép: ${allowed.join(', ')}).` });
  }

  const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
  const values = fields.map((f) => req.body[f]);
  values.push(req.user.id);

  const { rows } = await pool.query(
    `UPDATE users SET ${setClause} WHERE id = $${fields.length + 1} RETURNING *`,
    values
  );
  res.json(rows[0]);
}

async function getById(req, res) {
  const { rows } = await pool.query('SELECT id, name, avatar, sex FROM users WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy user.' });
  res.json(rows[0]);
}

async function setVerificationDoc(req, res) {
  const { verification_doc_url } = req.body;
  if (!verification_doc_url) {
    return res.status(400).json({ error: 'Thiếu verification_doc_url.' });
  }

  const { rows } = await pool.query(
    `UPDATE workers SET verification_doc_url = $1, verification_doc_status = 'pending'
     WHERE user_id = $2 RETURNING *`,
    [verification_doc_url, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy hồ sơ thợ.' });
  res.json(rows[0]);
}

async function list(req, res) {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email_address, u.username, u.phone_number,
            u.is_active, u.created_at,
            EXISTS (SELECT 1 FROM customers c WHERE c.user_id = u.id) AS is_customer,
            EXISTS (SELECT 1 FROM workers w WHERE w.user_id = u.id) AS is_worker,
            EXISTS (SELECT 1 FROM admins a WHERE a.user_id = u.id) AS is_admin,
            w.verification_doc_url, w.verification_doc_status
     FROM users u
     LEFT JOIN workers w ON w.user_id = u.id
     ORDER BY u.created_at DESC`
  );
  res.json(rows);
}

async function updateActive(req, res) {
  const { is_active } = req.body;
  const { rows } = await pool.query(
    'UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id, name, is_active',
    [is_active, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy user.' });
  res.json(rows[0]);
}

async function reviewVerification(req, res) {
  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: "status phải là 'approved' hoặc 'rejected'." });
  }

  const { rows } = await pool.query(
    `UPDATE workers SET verification_doc_status = $1 WHERE user_id = $2 RETURNING *`,
    [status, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy thợ.' });

  res.json(rows[0]);
}

module.exports = { getMe, updateMe, getById, setVerificationDoc, list, updateActive, reviewVerification };