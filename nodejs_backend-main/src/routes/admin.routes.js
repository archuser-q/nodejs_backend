const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authRequired, requireRole } = require('../middleware/auth');
const matchingConfig = require('../controllers/matchingConfig.controller');
const { runBatchMatch } = require('../services/matching');

const router = Router();

router.use(authRequired, requireRole('admin'));

router.get('/matching-config', asyncHandler(matchingConfig.get));
router.put('/matching-config', asyncHandler(matchingConfig.upsert));

// Kích hoạt thủ công 1 lượt ghép cặp theo lô — vòng lặp tự động định kỳ
// nằm ở server.js (đúng tinh thần đề cương "định kỳ mỗi 5-10 giây"), route
// này chủ yếu để test/demo có thể ép chạy ngay lúc cần mà không cần chờ.
router.post('/matching-config/run-batch', asyncHandler(async (req, res) => {
  const result = await runBatchMatch(req.db);
  res.json(result);
}));

module.exports = router;
