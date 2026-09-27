const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authRequired, requireRole } = require('../middleware/auth');
const workerServices = require('../controllers/workerServices.controller');

const router = Router();

router.get('/', asyncHandler(workerServices.list));
router.post('/', authRequired, requireRole('worker'), asyncHandler(workerServices.create));
router.delete('/:id', authRequired, requireRole('worker'), asyncHandler(workerServices.remove));

module.exports = router;