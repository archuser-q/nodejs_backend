// POST /api/orders  (khách hàng tạo yêu cầu sửa chữa)
// body: { latitude, longitude, repair_requests: [{ job_descriptiion, quantity, price, warranty_expiry_date }] }
async function create(req, res) {
  const { latitude, longitude, repair_requests: items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Cần ít nhất 1 mục trong repair_requests.' });
  }

  const { rows: orderRows } = await req.db.query(
    `INSERT INTO orders (customer_user_id, latitude, longitude)
     VALUES ($1, $2, $3) RETURNING *`,
    [req.user.id, latitude || null, longitude || null]
  );
  const order = orderRows[0];

  for (const item of items) {
    await req.db.query(
      `INSERT INTO repair_requests (order_id, job_descriptiion, quantity, price, warranty_expiry_date)
       VALUES ($1, $2, $3, $4, $5)`,
      [order.id, item.job_descriptiion || null, item.quantity || null, item.price || null, item.warranty_expiry_date || null]
    );
  }

  await req.db.query(
    `INSERT INTO order_history (order_id, status, changed_by_type, user_id)
     VALUES ($1, $2, $3, $4)`,
    [order.id, order.status, 'customer', req.user.id]
  );

  res.status(201).json(order);
}

// GET /api/orders  (RLS tự lọc: khách thấy đơn của mình, thợ thấy đơn được giao, admin thấy tất cả)
async function list(req, res) {
  const { rows } = await req.db.query('SELECT * FROM orders ORDER BY create_at DESC');
  res.json(rows);
}

// GET /api/orders/:id
async function getById(req, res) {
  const { rows } = await req.db.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy đơn (hoặc không có quyền xem).' });

  const [requests, history, payments, quotes] = await Promise.all([
    req.db.query('SELECT * FROM repair_requests WHERE order_id = $1', [req.params.id]),
    req.db.query('SELECT * FROM order_history WHERE order_id = $1 ORDER BY updated_at', [req.params.id]),
    req.db.query('SELECT * FROM payments WHERE order_id = $1', [req.params.id]),
    req.db.query('SELECT * FROM quotes WHERE order_id = $1', [req.params.id]),
  ]);

  res.json({
    ...rows[0],
    repair_requests: requests.rows,
    history: history.rows,
    payments: payments.rows,
    quotes: quotes.rows,
  });
}

// PATCH /api/orders/:id/status
// body: { status, note? }
// Ghi log vào order_history trong cùng transaction thay vì chỉ update orders.status.
const VALID_STATUSES = ['pending', 'matched', 'in_progress', 'completed', 'cancelled'];

async function updateStatus(req, res) {
  const { status, note } = req.body;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status phải là một trong: ${VALID_STATUSES.join(', ')}` });
  }

  const { rows } = await req.db.query(
    'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
    [status, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy đơn (hoặc không có quyền sửa).' });

  const changedByType = req.user.role; // 'customer' | 'worker' | 'admin'
  await req.db.query(
    `INSERT INTO order_history (order_id, status, changed_by_type, note, user_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [req.params.id, status, changedByType, note || null, req.user.id]
  );

  res.json(rows[0]);
}

// PATCH /api/orders/:id/assign  (kết quả thuật toán matching gán thợ cho đơn)
// body: { worker_user_id }
async function assignWorker(req, res) {
  const { worker_user_id } = req.body;
  if (!worker_user_id) return res.status(400).json({ error: 'Thiếu worker_user_id.' });

  const { rows } = await req.db.query(
    `UPDATE orders SET worker_user_id = $1, status = 'matched' WHERE id = $2 RETURNING *`,
    [worker_user_id, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy đơn (hoặc không có quyền sửa).' });

  await req.db.query(
    `INSERT INTO order_history (order_id, status, changed_by_type, user_id)
     VALUES ($1, 'matched', $2, $3)`,
    [req.params.id, req.user.role, req.user.id]
  );

  res.json(rows[0]);
}

module.exports = { create, list, getById, updateStatus, assignWorker };
