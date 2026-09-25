// GET /api/admin/matching-config
async function get(req, res) {
  const { rows } = await req.db.query('SELECT * FROM matching_config ORDER BY id DESC LIMIT 1');
  res.json(rows[0] || null);
}

// PUT /api/admin/matching-config
// body: { weight_distance, weight_trust_score, weight_price, mode }
async function upsert(req, res) {
  const { weight_distance, weight_trust_score, weight_price, mode } = req.body;
  const { rows } = await req.db.query(
    `INSERT INTO matching_config (weight_distance, weight_trust_score, weight_price, mode, updated_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [weight_distance, weight_trust_score, weight_price, mode, req.user.id]
  );
  res.status(201).json(rows[0]);
}

module.exports = { get, upsert };
