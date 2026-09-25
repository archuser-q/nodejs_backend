// GET /api/orders/:orderId/repair-requests
async function listByOrder(req, res) {
  const { rows } = await req.db.query(
    'SELECT * FROM repair_requests WHERE order_id = $1 ORDER BY id',
    [req.params.orderId]
  );
  res.json(rows);
}

// POST /api/orders/:orderId/repair-requests
// body: { job_descriptiion, quantity, price, warranty_expiry_date }
async function create(req, res) {
  const { job_descriptiion, quantity, price, warranty_expiry_date } = req.body;
  const { rows } = await req.db.query(
    `INSERT INTO repair_requests (order_id, job_descriptiion, quantity, price, warranty_expiry_date)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.params.orderId, job_descriptiion || null, quantity || null, price || null, warranty_expiry_date || null]
  );
  res.status(201).json(rows[0]);
}

module.exports = { listByOrder, create };
