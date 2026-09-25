const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authRequired, requireRole } = require('../middleware/auth');

const orders = require('../controllers/orders.controller');
const repairRequests = require('../controllers/repairRequests.controller');
const payments = require('../controllers/payments.controller');
const quotes = require('../controllers/quotes.controller');
const orderHistory = require('../controllers/orderHistory.controller');

const router = Router();

router.post('/', authRequired, requireRole('customer'), asyncHandler(orders.create));
router.get('/', authRequired, asyncHandler(orders.list));
router.get('/:id', authRequired, asyncHandler(orders.getById));
router.patch('/:id/status', authRequired, asyncHandler(orders.updateStatus));
router.patch('/:id/assign', authRequired, requireRole('admin'), asyncHandler(orders.assignWorker));

router.get('/:orderId/repair-requests', authRequired, asyncHandler(repairRequests.listByOrder));
router.post('/:orderId/repair-requests', authRequired, requireRole('customer'), asyncHandler(repairRequests.create));

router.get('/:orderId/payments', authRequired, asyncHandler(payments.listByOrder));
router.post('/:orderId/payments', authRequired, requireRole('customer'), asyncHandler(payments.create));

router.get('/:orderId/quotes', authRequired, asyncHandler(quotes.listByOrder));
router.post('/:orderId/quotes', authRequired, requireRole('worker'), asyncHandler(quotes.create));

router.get('/:orderId/history', authRequired, asyncHandler(orderHistory.listByOrder));

module.exports = router;
