const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authRequired, requireRole } = require('../middleware/auth');
const workerServices = require('../controllers/workerServices.controller');

const router = Router();

// GET /api/worker-services?service_id=&worker_user_id=  -> dùng cho thuật toán matching
router.get('/', asyncHandler(workerServices.list));
router.post('/', authRequired, requireRole('worker'), asyncHandler(workerServices.create));

module.exports = router;
