const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authRequired, requireRole } = require('../middleware/auth');
const reviews = require('../controllers/reviews.controller');

const router = Router();

router.get('/:workerId/reviews', asyncHandler(reviews.listByWorker));
router.post('/:workerId/reviews', authRequired, requireRole('customer'), asyncHandler(reviews.create));

module.exports = router;
