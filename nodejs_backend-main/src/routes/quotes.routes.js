const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authRequired, requireRole } = require('../middleware/auth');
const quotes = require('../controllers/quotes.controller');

const router = Router();

router.patch('/:id/status', authRequired, requireRole('customer'), asyncHandler(quotes.updateStatus));

module.exports = router;
