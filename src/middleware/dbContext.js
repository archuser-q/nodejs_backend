const pool = require('../config/db');

// Mỗi request mượn 1 client từ pool, mở transaction, và SET LOCAL 2 biến
// session mà các policy RLS trong schema.sql đọc qua current_user_id() /
// current_user_role(). Transaction COMMIT nếu response thành công
// (status < 400), ngược lại ROLLBACK — nên các controller chỉ cần
// req.db.query(...) và không cần tự quản lý transaction cho thao tác đơn.
module.exports = async function dbContext(req, res, next) {
  const client = await pool.connect();
  let finished = false;

  const finalize = async () => {
    if (finished) return;
    finished = true;
    try {
      if (res.statusCode >= 400) {
        await client.query('ROLLBACK');
      } else {
        await client.query('COMMIT');
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[dbContext] Failed to finalize transaction', err);
    } finally {
      client.release();
    }
  };

  try {
    await client.query('BEGIN');
    const userId = req.user ? String(req.user.id) : '';
    const role = req.user ? req.user.role : 'anonymous';
    await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId]);
    await client.query('SELECT set_config($1, $2, true)', ['app.current_user_role', role]);

    req.db = client;
    res.on('finish', finalize);
    res.on('close', finalize);
    next();
  } catch (err) {
    finished = true;
    client.release();
    next(err);
  }
};
