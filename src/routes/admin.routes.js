const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authRequired, requireRole } = require('../middleware/auth');
const matchingConfig = require('../controllers/matchingConfig.controller');

const router = Router();

router.use(authRequired, requireRole('admin'));

router.get('/matching-config', asyncHandler(matchingConfig.get));
router.put('/matching-config', asyncHandler(matchingConfig.upsert));

module.exports = router;
