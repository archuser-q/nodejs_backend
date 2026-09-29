// GET /api/admin/matching-config
async function get(req, res) {
  const { rows } = await req.db.query('SELECT * FROM matching_config ORDER BY id DESC LIMIT 1');
  res.json(rows[0] || null);
}

// PUT /api/admin/matching-config
// body: { weight_distance, weight_trust_score, weight_completion_rate, weight_workload, mode, offer_ttl_seconds, batch_interval_seconds }
// ĐÃ SỬA field theo đúng 4 tiêu chí đề cương mục 6.1 (trước đây có
// weight_price không khớp đề cương nào cả — xem ghi chú trong schema.sql).
async function upsert(req, res) {
  const {
    weight_distance, weight_trust_score, weight_completion_rate, weight_workload,
    mode, offer_ttl_seconds, batch_interval_seconds,
  } = req.body;
  const { rows } = await req.db.query(
    `INSERT INTO matching_config
       (weight_distance, weight_trust_score, weight_completion_rate, weight_workload, mode, offer_ttl_seconds, batch_interval_seconds, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [weight_distance, weight_trust_score, weight_completion_rate, weight_workload,
      mode, offer_ttl_seconds || 45, batch_interval_seconds || 8, req.user.id],
  );
  res.status(201).json(rows[0]);
}

module.exports = { get, upsert };
