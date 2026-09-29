// MỚI — App Thợ đã build màn Thu nhập (Ví) + Rút tiền, cần endpoint thật.
// users.balance là số dư ĐỌC NHANH, tự cập nhật bởi trigger khi có dòng
// wallet_transactions mới (xem schema.sql) — controller này không tự cộng
// trừ balance bằng tay để tránh lệch nhau giữa 2 nơi.

// GET /api/wallet — số dư + giao dịch gần đây
async function getOverview(req, res) {
  const [{ rows: userRows }, { rows: txRows }] = await Promise.all([
    req.db.query('SELECT balance FROM users WHERE id = $1', [req.user.id]),
    req.db.query('SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.user.id]),
  ]);
  res.json({ balance: userRows[0]?.balance ?? 0, transactions: txRows });
}

// POST /api/wallet/withdraw  body: { amount }
async function withdraw(req, res) {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'amount phải > 0.' });

  const { rows: userRows } = await req.db.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
  if (!userRows[0] || userRows[0].balance < amount) {
    return res.status(400).json({ error: 'Số dư không đủ.' });
  }

  const { rows } = await req.db.query(
    `INSERT INTO wallet_transactions (user_id, type, amount) VALUES ($1, 'withdrawal', $2) RETURNING *`,
    [req.user.id, -Math.abs(amount)],
  );
  const { rows: afterRows } = await req.db.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
  res.status(201).json({ transaction: rows[0], balance: afterRows[0].balance });
}

module.exports = { getOverview, withdraw };
