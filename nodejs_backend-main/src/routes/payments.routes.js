const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authRequired, requireRole } = require('../middleware/auth');
const payments = require('../controllers/payments.controller');

const router = Router();

router.patch('/:id/status', authRequired, requireRole('admin'), asyncHandler(payments.updateStatus));

module.exports = router;
