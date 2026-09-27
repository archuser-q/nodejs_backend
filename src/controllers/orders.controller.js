const pool = require('../config/db');

function canAccessOrder(req, order) {
  if (!req.user) return false;
  if (req.user.role === 'admin') return true;
  if (order.customer_user_id === req.user.id) return true;
  if (order.worker_user_id === req.user.id) return true;
  return false;
}

const VALID_STATUSES = ['pending', 'matched', 'in_progress', 'completed', 'cancelled'];

async function create(req, res) {
  const { latitude, longitude, repair_requests: items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Cần ít nhất 1 mục trong repair_requests.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: orderRows } = await client.query(
      `INSERT INTO orders (customer_user_id, latitude, longitude)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.user.id, latitude || null, longitude || null]
    );
    const order = orderRows[0];

    for (const item of items) {
      await client.query(
        `INSERT INTO repair_requests (order_id, job_descriptiion, quantity, price, warranty_expiry_date)
         VALUES ($1, $2, $3, $4, $5)`,
        [order.id, item.job_descriptiion || null, item.quantity || null, item.price || null, item.warranty_expiry_date || null]
      );
    }

    await client.query(
      `INSERT INTO order_history (order_id, status, changed_by_type, user_id)
       VALUES ($1, $2, 'customer', $3)`,
      [order.id, order.status, req.user.id]
    );

    await client.query('COMMIT');
    res.status(201).json(order);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function list(req, res) {
  let query = 'SELECT * FROM orders';
  let params = [];

  if (req.user.role === 'customer') {
    query += ' WHERE customer_user_id = $1';
    params = [req.user.id];
  } else if (req.user.role === 'worker') {
    query += ' WHERE worker_user_id = $1';
    params = [req.user.id];
  }
  query += ' ORDER BY create_at DESC';

  const { rows } = await pool.query(query, params);
  res.json(rows);
}

async function getById(req, res) {
  const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
  const order = rows[0];
  if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn.' });
  if (!canAccessOrder(req, order)) {
    return res.status(403).json({ error: 'Bạn không có quyền xem đơn này.' });
  }

  const [requests, history, payments, quotes] = await Promise.all([
    pool.query('SELECT * FROM repair_requests WHERE order_id = $1', [order.id]),
    pool.query('SELECT * FROM order_history WHERE order_id = $1 ORDER BY updated_at', [order.id]),
    pool.query('SELECT * FROM payments WHERE order_id = $1', [order.id]),
    pool.query('SELECT * FROM quotes WHERE order_id = $1', [order.id]),
  ]);

  res.json({
    ...order,
    repair_requests: requests.rows,
    history: history.rows,
    payments: payments.rows,
    quotes: quotes.rows,
  });
}

async function updateStatus(req, res) {
  const { status, note } = req.body;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status phải là một trong: ${VALID_STATUSES.join(', ')}` });
  }

  const { rows: existingRows } = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'Không tìm thấy đơn.' });
  if (!canAccessOrder(req, existing)) {
    return res.status(403).json({ error: 'Bạn không có quyền sửa đơn này.' });
  }

  const { rows } = await pool.query(
    'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
    [status, req.params.id]
  );

  await pool.query(
    `INSERT INTO order_history (order_id, status, changed_by_type, note, user_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [req.params.id, status, req.user.role, note || null, req.user.id]
  );

  res.json(rows[0]);
}

async function assignWorker(req, res) {
  const { worker_user_id } = req.body;
  if (!worker_user_id) return res.status(400).json({ error: 'Thiếu worker_user_id.' });

  const { rows } = await pool.query(
    `UPDATE orders SET worker_user_id = $1, status = 'matched' WHERE id = $2 RETURNING *`,
    [worker_user_id, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy đơn.' });

  await pool.query(
    `INSERT INTO order_history (order_id, status, changed_by_type, user_id)
     VALUES ($1, 'matched', 'admin', $2)`,
    [req.params.id, req.user.id]
  );

  res.json(rows[0]);
}

module.exports = { create, list, getById, updateStatus, assignWorker };