const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authRequired, requireRole } = require('../middleware/auth');
const services = require('../controllers/services.controller');

const router = Router();

router.get('/', asyncHandler(services.list));
router.post('/', authRequired, requireRole('admin'), asyncHandler(services.create));

module.exports = router;
