// GET /api/orders/:orderId/quotes
async function listByOrder(req, res) {
  const { rows } = await req.db.query('SELECT * FROM quotes WHERE order_id = $1 ORDER BY created_at', [req.params.orderId]);
  res.json(rows);
}

// POST /api/orders/:orderId/quotes  (thợ gửi báo giá phát sinh cho đơn)
// body: { description, price }
async function create(req, res) {
  const { description, price } = req.body;
  const { rows } = await req.db.query(
    `INSERT INTO quotes (order_id, worker_user_id, description, price, status)
     VALUES ($1, $2, $3, $4, 'pending') RETURNING *`,
    [req.params.orderId, req.user.id, description || null, price || null]
  );
  res.status(201).json(rows[0]);
}

// PATCH /api/quotes/:id/status  (khách hàng accept/reject báo giá phát sinh)
// body: { status } -- 'accepted' | 'rejected'
async function updateStatus(req, res) {
  const { status } = req.body;
  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: "status phải là 'accepted' hoặc 'rejected'." });
  }
  const { rows } = await req.db.query(
    'UPDATE quotes SET status = $1 WHERE id = $2 RETURNING *',
    [status, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy quote (hoặc không có quyền sửa).' });
  res.json(rows[0]);
}

module.exports = { listByOrder, create, updateStatus };
