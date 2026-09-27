const pool = require('../config/db');

async function list(req, res) {
  const { service_id, worker_user_id } = req.query;
  const clauses = [];
  const values = [];

  if (service_id) {
    values.push(service_id);
    clauses.push(`ws.service_id = $${values.length}`);
  }
  if (worker_user_id) {
    values.push(worker_user_id);
    clauses.push(`ws.worker_user_id = $${values.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT ws.*, u.name AS worker_name
     FROM worker_services ws
     JOIN users u ON u.id = ws.worker_user_id
     ${where}
     ORDER BY ws.trust_score DESC`,
    values
  );
  res.json(rows);
}

async function create(req, res) {
  const { service_id } = req.body;
  if (!service_id) return res.status(400).json({ error: 'Thiếu service_id.' });

  const { rows } = await pool.query(
    `INSERT INTO worker_services (worker_user_id, service_id) VALUES ($1, $2) RETURNING *`,
    [req.user.id, service_id]
  );
  res.status(201).json(rows[0]);
}

async function remove(req, res) {
  const { rows } = await pool.query(
    'DELETE FROM worker_services WHERE id = $1 AND worker_user_id = $2 RETURNING id',
    [req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy (hoặc không phải của bạn).' });
  res.status(204).send();
}

module.exports = { list, create, remove };