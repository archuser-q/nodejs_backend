// GET /api/users/me
async function getMe(req, res) {
  const { rows } = await req.db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy user.' });
  res.json(rows[0]);
}

// PATCH /api/users/me
// body: bất kỳ tập con nào trong { name, sex, phone_number, avatar, longitude, latitude }
async function updateMe(req, res) {
  const allowed = ['name', 'sex', 'phone_number', 'avatar', 'longitude', 'latitude'];
  const fields = Object.keys(req.body).filter((k) => allowed.includes(k));
  if (fields.length === 0) {
    return res.status(400).json({ error: `Không có trường hợp lệ để cập nhật (cho phép: ${allowed.join(', ')}).` });
  }

  const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
  const values = fields.map((f) => req.body[f]);
  values.push(req.user.id);

  const { rows } = await req.db.query(
    `UPDATE users SET ${setClause} WHERE id = $${fields.length + 1} RETURNING *`,
    values
  );
  res.json(rows[0]);
}

// GET /api/users/:id  (RLS tự giới hạn: chỉ thấy chính mình / đối tác chung đơn / admin)
async function getById(req, res) {
  const { rows } = await req.db.query('SELECT id, name, avatar, sex FROM users WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy user (hoặc không có quyền xem).' });
  res.json(rows[0]);
}

// GET /api/admin/users  (chỉ admin — is_admin() trong RLS đã cho phép đọc
// toàn bộ bảng users, nên chỉ cần route này + requireRole('admin') ở tầng
// route để trả lỗi rõ ràng sớm cho client)
async function list(req, res) {
  const { rows } = await req.db.query(
    `SELECT u.id, u.name, u.email_address, u.username, u.phone_number,
            u.is_verified, u.is_active, u.created_at,
            EXISTS (SELECT 1 FROM customers c WHERE c.user_id = u.id) AS is_customer,
            EXISTS (SELECT 1 FROM workers w WHERE w.user_id = u.id) AS is_worker,
            EXISTS (SELECT 1 FROM admins a WHERE a.user_id = u.id) AS is_admin
     FROM users u
     ORDER BY u.created_at DESC`
  );
  res.json(rows);
}

// PATCH /api/admin/users/:id/active  (khoá/mở tài khoản)
// body: { is_active: 0 | 1 }
async function updateActive(req, res) {
  const { is_active } = req.body;
  const { rows } = await req.db.query(
    'UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id, name, is_active',
    [is_active, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy user.' });
  res.json(rows[0]);
}

module.exports = { getMe, updateMe, getById, list, updateActive };
