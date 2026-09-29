/**
 * MỚI — bản gốc chưa có controller nào cho hồ sơ/KYC/trạng thái online/
 * lịch rảnh của thợ (bảng `workers` gần như rỗng, chỉ có user_id). Đây là
 * phần App Thợ cần nhiều nhất vì đã build xong UI cho tất cả các mục này.
 */

// GET /api/workers/me
async function getMyProfile(req, res) {
  const { rows } = await req.db.query('SELECT * FROM workers WHERE user_id = $1', [req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Chưa có hồ sơ thợ.' });
  res.json(rows[0]);
}

// GET /api/workers/:id  (công khai — dùng khi khách xem hồ sơ thợ được ghép)
async function getById(req, res) {
  const { rows } = await req.db.query(
    `SELECT w.user_id, w.years_of_experience, w.trust_score, w.completion_rate, w.verification,
            u.name, u.avatar
       FROM workers w JOIN users u ON u.id = w.user_id
      WHERE w.user_id = $1`,
    [req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy thợ.' });
  res.json(rows[0]);
}

// POST /api/workers/me/verification  (nộp lần đầu HOẶC nộp lại sau khi bị từ chối)
// body: { years_of_experience, operating_center_latitude, operating_center_longitude,
//         operating_radius_km, id_card_front_url, id_card_back_url, certificate_urls, service_ids }
// Luôn đưa verification về 'pending' — Admin (Thành viên C) duyệt sau.
async function submitVerification(req, res) {
  const {
    years_of_experience, operating_center_latitude, operating_center_longitude,
    operating_radius_km, id_card_front_url, id_card_back_url, certificate_urls, service_ids,
  } = req.body;

  const { rows } = await req.db.query(
    `UPDATE workers SET
       years_of_experience = COALESCE($1, years_of_experience),
       operating_center_latitude = COALESCE($2, operating_center_latitude),
       operating_center_longitude = COALESCE($3, operating_center_longitude),
       operating_radius_km = COALESCE($4, operating_radius_km),
       id_card_front_url = COALESCE($5, id_card_front_url),
       id_card_back_url = COALESCE($6, id_card_back_url),
       certificate_urls = COALESCE($7, certificate_urls),
       verification = 'pending',
       verification_reject_reason = NULL
     WHERE user_id = $8 RETURNING *`,
    [
      years_of_experience || null, operating_center_latitude || null, operating_center_longitude || null,
      operating_radius_km || null, id_card_front_url || null, id_card_back_url || null,
      certificate_urls || null, req.user.id,
    ],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Chưa có hồ sơ thợ.' });

  if (Array.isArray(service_ids)) {
    await req.db.query('DELETE FROM worker_services WHERE worker_user_id = $1', [req.user.id]);
    for (const serviceId of service_ids) {
      await req.db.query('INSERT INTO worker_services (worker_user_id, service_id) VALUES ($1, $2)', [req.user.id, serviceId]);
    }
  }

  res.json(rows[0]);
}

// PATCH /api/workers/me/online  body: { is_online }
// Chặn bật online nếu chưa được duyệt — khớp đúng luồng App Thợ (nút bật
// online tự khoá tới khi verification === 'approved').
async function setOnlineStatus(req, res) {
  const { is_online } = req.body;
  if (is_online) {
    const { rows: checkRows } = await req.db.query('SELECT verification FROM workers WHERE user_id = $1', [req.user.id]);
    if (checkRows[0]?.verification !== 'approved') {
      return res.status(403).json({ error: 'Hồ sơ chưa được duyệt, chưa thể bật online.' });
    }
  }
  const { rows } = await req.db.query('UPDATE workers SET is_online = $1 WHERE user_id = $2 RETURNING *', [!!is_online, req.user.id]);
  res.json(rows[0]);
}

// GET /api/workers/me/availability
async function getAvailability(req, res) {
  const { rows } = await req.db.query(
    'SELECT day_of_week, period, is_available FROM worker_availability WHERE worker_user_id = $1 ORDER BY day_of_week, period',
    [req.user.id],
  );
  res.json(rows);
}

// PUT /api/workers/me/availability  body: { slots: [{ day_of_week, period, is_available }] }
async function setAvailability(req, res) {
  const { slots } = req.body;
  if (!Array.isArray(slots)) return res.status(400).json({ error: 'Thiếu slots.' });
  for (const slot of slots) {
    await req.db.query(
      `INSERT INTO worker_availability (worker_user_id, day_of_week, period, is_available)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (worker_user_id, day_of_week, period) DO UPDATE SET is_available = $4`,
      [req.user.id, slot.day_of_week, slot.period, !!slot.is_available],
    );
  }
  const { rows } = await req.db.query(
    'SELECT day_of_week, period, is_available FROM worker_availability WHERE worker_user_id = $1 ORDER BY day_of_week, period',
    [req.user.id],
  );
  res.json(rows);
}

module.exports = { getMyProfile, getById, submitVerification, setOnlineStatus, getAvailability, setAvailability };
