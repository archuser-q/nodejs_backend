const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authRequired, requireRole } = require('../middleware/auth');
const orders = require('../controllers/orders.controller');

const router = Router();

router.post('/', authRequired, requireRole('customer'), asyncHandler(orders.create));
router.get('/', authRequired, asyncHandler(orders.list));
router.get('/:id', authRequired, asyncHandler(orders.getById));
router.patch('/:id/status', authRequired, asyncHandler(orders.updateStatus));
router.patch('/:id/assign', authRequired, requireRole('admin'), asyncHandler(orders.assignWorker));

module.exports = router;