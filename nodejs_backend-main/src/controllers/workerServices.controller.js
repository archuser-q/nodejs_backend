// GET /api/worker-services?service_id=1  (dùng cho thuật toán matching: liệt kê thợ theo dịch vụ)
async function list(req, res) {
  const { service_id, worker_user_id } = req.query;
  const clauses = [];
  const values = [];

  if (service_id) {
    values.push(service_id);
    clauses.push(`service_id = $${values.length}`);
  }
  if (worker_user_id) {
    values.push(worker_user_id);
    clauses.push(`worker_user_id = $${values.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await req.db.query(
    `SELECT * FROM worker_services ${where} ORDER BY trust_score DESC`,
    values
  );
  res.json(rows);
}

// POST /api/worker-services  (thợ tự đăng ký dịch vụ mình làm)
// body: { service_id }
async function create(req, res) {
  const { service_id } = req.body;
  if (!service_id) return res.status(400).json({ error: 'Thiếu service_id.' });

  const { rows } = await req.db.query(
    `INSERT INTO worker_services (worker_user_id, service_id) VALUES ($1, $2) RETURNING *`,
    [req.user.id, service_id]
  );
  res.status(201).json(rows[0]);
}

module.exports = { list, create };
