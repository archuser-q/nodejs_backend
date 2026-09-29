const { runInstantMatch } = require('../services/matching');

/**
 * VIẾT LẠI ĐÁNG KỂ so với bản gốc:
 *  - body nhận đúng field mà App Thợ/App Khách cần (service_id, description,
 *    address, price_estimate_min/max, is_scheduled...) thay vì chỉ có
 *    latitude/longitude + repair_requests thô.
 *  - Tạo đơn xong TỰ CHẠY thuật toán ghép cặp (chế độ instant chạy ngay
 *    trong request này; chế độ batch để đơn ở 'pending_match', vòng lặp
 *    định kỳ trong server.js sẽ xử lý — xem README mục thuật toán).
 *  - Thêm respondToOffer: thợ chấp nhận/từ chối/quan tâm 1 offer — đây là
 *    endpoint App Thợ cần cho "Nhận đơn"/"Từ chối"/"Quan tâm đơn này".
 *  - status enum + VALID_STATUSES khớp lược đồ mới (models.ts App Thợ).
 *  - Sửa lỗi chính tả create_at -> created_at (đã đổi tên cột trong schema).
 */

// POST /api/orders  (khách hàng tạo yêu cầu sửa chữa)
// body: { service_id, description, address, latitude, longitude,
//         price_estimate_min, price_estimate_max, is_scheduled, scheduled_at, photo_urls }
async function create(req, res) {
  const {
    service_id, description, address, latitude, longitude,
    price_estimate_min, price_estimate_max, is_scheduled, scheduled_at, photo_urls,
  } = req.body;

  const { rows: orderRows } = await req.db.query(
    `INSERT INTO orders
       (customer_user_id, service_id, description, address, latitude, longitude,
        price_estimate_min, price_estimate_max, is_scheduled, scheduled_at, photo_urls)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      req.user.id, service_id || null, description || null, address || null, latitude || null, longitude || null,
      price_estimate_min || null, price_estimate_max || null, !!is_scheduled, scheduled_at || null, photo_urls || [],
    ],
  );
  let order = orderRows[0];

  await req.db.query(
    `INSERT INTO order_history (order_id, status, changed_by_type, user_id) VALUES ($1, $2, 'customer', $3)`,
    [order.id, order.status, req.user.id],
  );

  // Đơn đặt hẹn trước (is_scheduled) CHƯA cần ghép cặp ngay — để nguyên
  // 'pending_match', hệ thống nhắc ghép cặp gần tới giờ hẹn (chưa làm ở
  // bản này, ghi TODO).
  if (!order.is_scheduled) {
    const { rows: cfgRows } = await req.db.query('SELECT mode FROM matching_config ORDER BY id DESC LIMIT 1');
    const mode = cfgRows[0]?.mode || 'instant';
    if (mode === 'instant' && service_id) {
      const matchResult = await runInstantMatch(req.db, order.id);
      if (matchResult) {
        const { rows } = await req.db.query('SELECT * FROM orders WHERE id = $1', [order.id]);
        order = rows[0];
      }
      // matchResult null nghĩa là không tìm được thợ nào phù hợp lúc này —
      // đơn ở lại 'pending_match', vòng lặp batch định kỳ (server.js) sẽ
      // thử lại, hoặc thợ tự thấy đơn này ở "Đơn khác gần bạn" và bấm
      // "Quan tâm đơn này".
    }
    // mode === 'batch': cố ý KHÔNG chạy gì ở đây — để vòng lặp định kỳ
    // trong server.js xử lý theo đúng tinh thần "gom theo lô" của đề cương,
    // chạy ngay trong request tạo đơn sẽ thành instant trá hình.
  }

  res.status(201).json(order);
}

// GET /api/orders  (RLS tự lọc: khách thấy đơn của mình, thợ thấy đơn được giao + đơn có offer + đơn pending_match đúng chuyên môn, admin thấy tất cả)
async function list(req, res) {
  const { rows } = await req.db.query('SELECT * FROM orders ORDER BY created_at DESC');
  res.json(rows);
}

// GET /api/orders/:id
async function getById(req, res) {
  const { rows } = await req.db.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy đơn (hoặc không có quyền xem).' });

  const [requests, history, payments, quotes, offers] = await Promise.all([
    req.db.query('SELECT * FROM repair_requests WHERE order_id = $1', [req.params.id]),
    req.db.query('SELECT * FROM order_history WHERE order_id = $1 ORDER BY updated_at', [req.params.id]),
    req.db.query('SELECT * FROM payments WHERE order_id = $1', [req.params.id]),
    req.db.query('SELECT * FROM quotes WHERE order_id = $1', [req.params.id]),
    req.db.query('SELECT * FROM order_offers WHERE order_id = $1 ORDER BY offered_at DESC', [req.params.id]),
  ]);

  res.json({
    ...rows[0],
    repair_requests: requests.rows,
    history: history.rows,
    payments: payments.rows,
    quotes: quotes.rows,
    offers: offers.rows,
  });
}

// PATCH /api/orders/:id/status
// body: { status, note?, cancel_reason?, final_price? }
const VALID_STATUSES = [
  'pending_match', 'offered', 'accepted', 'in_progress', 'completed',
  'reviewed', 'cancelled_by_customer', 'cancelled_by_worker', 'expired', 'disputed',
];

async function updateStatus(req, res) {
  const { status, note, cancel_reason, final_price } = req.body;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status phải là một trong: ${VALID_STATUSES.join(', ')}` });
  }

  const { rows } = await req.db.query(
    `UPDATE orders SET status = $1, cancel_reason = COALESCE($2, cancel_reason), final_price = COALESCE($3, final_price)
     WHERE id = $4 RETURNING *`,
    [status, cancel_reason || null, final_price || null, req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy đơn (hoặc không có quyền sửa).' });

  await req.db.query(
    `INSERT INTO order_history (order_id, status, changed_by_type, note, user_id) VALUES ($1, $2, $3, $4, $5)`,
    [req.params.id, status, req.user.role, note || null, req.user.id],
  );

  res.json(rows[0]);
}

// PATCH /api/orders/:id/assign  — admin can vẫn thiệp thủ công (tranh chấp,
// sự cố thuật toán) — KHÔNG còn là đường đi chính (đó là respondToOffer).
async function assignWorker(req, res) {
  const { worker_user_id } = req.body;
  if (!worker_user_id) return res.status(400).json({ error: 'Thiếu worker_user_id.' });

  const { rows } = await req.db.query(
    `UPDATE orders SET worker_user_id = $1, status = 'accepted' WHERE id = $2 RETURNING *`,
    [worker_user_id, req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy đơn (hoặc không có quyền sửa).' });

  await req.db.query(
    `INSERT INTO order_history (order_id, status, changed_by_type, note, user_id) VALUES ($1, 'accepted', 'admin', 'Admin gán thủ công', $2)`,
    [req.params.id, req.user.id],
  );

  res.json(rows[0]);
}

// PATCH /api/orders/:id/offers/respond  (App Thợ: Nhận đơn / Từ chối / Quan tâm đơn này)
// body: { action: 'accept' | 'decline' | 'interested' }
async function respondToOffer(req, res) {
  const { action } = req.body;
  if (!['accept', 'decline', 'interested'].includes(action)) {
    return res.status(400).json({ error: "action phải là 'accept' | 'decline' | 'interested'." });
  }
  const orderId = req.params.id;
  const workerId = req.user.id;

  if (action === 'interested') {
    // Đơn 'pending_match' — CHỈ ghi nhận quan tâm, KHÔNG tự gán (đúng thiết
    // kế App Thợ: "Quan tâm đơn này" không chiếm đơn ngay).
    await req.db.query(
      `INSERT INTO order_offers (order_id, worker_user_id, status)
       VALUES ($1, $2, 'interested')
       ON CONFLICT (order_id, worker_user_id) DO UPDATE SET status = 'interested', responded_at = now()`,
      [orderId, workerId],
    );
    return res.json({ ok: true, action: 'interested' });
  }

  if (action === 'accept') {
    // Thứ tự QUAN TRỌNG: update orders trước (còn offer 'offered' nên qua
    // được policy), rồi mới cập nhật order_offers — xem giải thích trong
    // schema.sql (orders_update/orders_select).
    const { rows } = await req.db.query(
      `UPDATE orders SET worker_user_id = $1, status = 'accepted' WHERE id = $2 AND status = 'offered' RETURNING *`,
      [workerId, orderId],
    );
    if (!rows[0]) {
      return res.status(409).json({ error: 'Đơn không còn ở trạng thái chờ nhận (có thể đã hết hạn hoặc người khác nhận trước).' });
    }
    await req.db.query(
      `UPDATE order_offers SET status = 'accepted', responded_at = now() WHERE order_id = $1 AND worker_user_id = $2`,
      [orderId, workerId],
    );
    await req.db.query(
      `INSERT INTO order_history (order_id, status, changed_by_type, user_id) VALUES ($1, 'accepted', 'worker', $2)`,
      [orderId, workerId],
    );
    return res.json(rows[0]);
  }

  // action === 'decline'
  await req.db.query(
    `UPDATE order_offers SET status = 'declined', responded_at = now() WHERE order_id = $1 AND worker_user_id = $2`,
    [orderId, workerId],
  );
  await req.db.query(`UPDATE orders SET status = 'pending_match' WHERE id = $1 AND status = 'offered'`, [orderId]);
  // Thử ghép ngay cho ứng viên tiếp theo (chế độ instant) — findCandidates
  // tự loại người vừa từ chối.
  const next = await runInstantMatch(req.db, orderId);
  res.json({ ok: true, action: 'declined', nextOffer: next });
}

module.exports = { create, list, getById, updateStatus, assignWorker, respondToOffer };
