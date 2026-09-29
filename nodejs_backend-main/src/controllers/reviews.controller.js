// GET /api/workers/:workerId/reviews
async function listByWorker(req, res) {
  const { rows } = await req.db.query(
    'SELECT * FROM reviews WHERE worker_user_id = $1 ORDER BY created_at DESC',
    [req.params.workerId]
  );
  res.json(rows);
}

// POST /api/workers/:workerId/reviews  (khách hàng đánh giá thợ sau khi hoàn thành đơn)
// body: { content, rating_score }
// Lưu ý: việc TÍNH LẠI trust_score (Bayesian/recency-weighted) là thuật toán
// riêng sẽ cài đặt sau — controller này chỉ ghi dữ liệu đầu vào cho thuật
// toán đó, không tự cập nhật worker_services.trust_score.
async function create(req, res) {
  const { content, rating_score } = req.body;
  if (!rating_score || rating_score < 1 || rating_score > 5) {
    return res.status(400).json({ error: 'rating_score phải từ 1 đến 5.' });
  }

  const { rows } = await req.db.query(
    `INSERT INTO reviews (customer_user_id, worker_user_id, content, rating_score)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.user.id, req.params.workerId, content || null, rating_score]
  );
  res.status(201).json(rows[0]);
}

module.exports = { listByWorker, create };
