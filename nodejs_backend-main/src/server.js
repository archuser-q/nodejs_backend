const { Pool } = require('pg');
const app = require('./app');
const config = require('./config');
const { runBatchMatch } = require('./services/matching');

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`THỢ NHANH API đang chạy tại http://localhost:${config.port}`);
});

/**
 * Vòng lặp ghép cặp theo lô (Batch/Hungarian) — đề cương mục 6.1 ghi rõ
 * "định kỳ, ví dụ mỗi 5-10 giây". Đây là tiến trình HỆ THỐNG, không đại
 * diện 1 user cụ thể nên nối bằng owner (bypass RLS, thấy toàn bộ nền
 * tảng) — KHÁC với pool `thonhanh_app` mà mọi route HTTP dùng.
 *
 * MỚI — bản gốc không có vòng lặp nào cho chế độ batch (chỉ có sẵn cột
 * matching_config.mode nhưng chưa ai gọi runBatchMatch ở đâu cả).
 */
if (config.databaseOwnerUrl) {
  const ownerPool = new Pool({ connectionString: config.databaseOwnerUrl });

  async function tick() {
    try {
      const { rows } = await ownerPool.query('SELECT mode, batch_interval_seconds FROM matching_config ORDER BY id DESC LIMIT 1');
      const cfg = rows[0];
      if (cfg && cfg.mode === 'batch') {
        const result = await runBatchMatch(ownerPool);
        if (result.orders > 0) {
          // eslint-disable-next-line no-console
          console.log(`[batch-matching] ${result.matched}/${result.orders} đơn được ghép (${result.candidates} thợ ứng viên)`);
        }
      }
      const nextDelayMs = (cfg?.batch_interval_seconds || 8) * 1000;
      setTimeout(tick, nextDelayMs);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[batch-matching] Lỗi:', err.message);
      setTimeout(tick, 8000);
    }
  }

  tick();
} else {
  // eslint-disable-next-line no-console
  console.warn('[batch-matching] DATABASE_OWNER_URL chưa set — vòng lặp batch không chạy (chế độ instant vẫn hoạt động bình thường).');
}
