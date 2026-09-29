const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authRequired, requireRole } = require('../middleware/auth');
const reviews = require('../controllers/reviews.controller');
const workers = require('../controllers/workers.controller');

const router = Router();

router.get('/me', authRequired, requireRole('worker'), asyncHandler(workers.getMyProfile));
router.post('/me/verification', authRequired, requireRole('worker'), asyncHandler(workers.submitVerification));
router.patch('/me/online', authRequired, requireRole('worker'), asyncHandler(workers.setOnlineStatus));
router.get('/me/availability', authRequired, requireRole('worker'), asyncHandler(workers.getAvailability));
router.put('/me/availability', authRequired, requireRole('worker'), asyncHandler(workers.setAvailability));

router.get('/:id', asyncHandler(workers.getById));
router.get('/:workerId/reviews', asyncHandler(reviews.listByWorker));
router.post('/:workerId/reviews', authRequired, requireRole('customer'), asyncHandler(reviews.create));

module.exports = router;
