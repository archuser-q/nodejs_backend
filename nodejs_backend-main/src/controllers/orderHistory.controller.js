// GET /api/orders/:orderId/history
// Nguồn dữ liệu cho Chương 5: tính "thời gian ghép", "độ trễ khách chờ"
// bằng cách lấy khoảng cách updated_at giữa các dòng status kế tiếp.
async function listByOrder(req, res) {
  const { rows } = await req.db.query(
    'SELECT * FROM order_history WHERE order_id = $1 ORDER BY updated_at',
    [req.params.orderId]
  );
  res.json(rows);
}

module.exports = { listByOrder };
