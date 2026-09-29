// GET /api/orders/:orderId/payments
async function listByOrder(req, res) {
  const { rows } = await req.db.query('SELECT * FROM payments WHERE order_id = $1', [req.params.orderId]);
  res.json(rows);
}

// POST /api/orders/:orderId/payments  (khởi tạo thanh toán, ví dụ sandbox MoMo/VNPay)
// body: { amount, method }
async function create(req, res) {
  const { amount, method } = req.body;
  if (!amount) return res.status(400).json({ error: 'Thiếu amount.' });

  const { rows } = await req.db.query(
    `INSERT INTO payments (order_id, amount, method, status)
     VALUES ($1, $2, $3, 'pending') RETURNING *`,
    [req.params.orderId, amount, method || null]
  );
  res.status(201).json(rows[0]);
}

// PATCH /api/payments/:id/status  (admin xác nhận kết quả callback từ cổng thanh toán sandbox)
// body: { status }  -- 'paid' | 'failed' | 'refunded'
async function updateStatus(req, res) {
  const { status } = req.body;
  const { rows } = await req.db.query(
    `UPDATE payments SET status = $1, paid_at = CASE WHEN $1 = 'paid' THEN now() ELSE paid_at END
     WHERE id = $2 RETURNING *`,
    [status, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy payment (hoặc không có quyền sửa).' });
  res.json(rows[0]);
}

module.exports = { listByOrder, create, updateStatus };
