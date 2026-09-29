// MỚI — App Thợ đã build màn Thông báo thật (không còn placeholder), cần
// endpoint thật đứng sau nó.

// GET /api/notifications
async function list(req, res) {
  const { rows } = await req.db.query(
    'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC',
    [req.user.id],
  );
  res.json(rows);
}

// GET /api/notifications/unread-count
async function unreadCount(req, res) {
  const { rows } = await req.db.query(
    'SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND is_read = false',
    [req.user.id],
  );
  res.json({ count: rows[0].n });
}

// PATCH /api/notifications/:id/read
async function markRead(req, res) {
  const { rows } = await req.db.query(
    'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING *',
    [req.params.id, req.user.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy thông báo.' });
  res.json(rows[0]);
}

// PATCH /api/notifications/read-all
async function markAllRead(req, res) {
  await req.db.query('UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false', [req.user.id]);
  res.json({ ok: true });
}

module.exports = { list, unreadCount, markRead, markAllRead };
