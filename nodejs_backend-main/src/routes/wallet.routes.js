const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authRequired, requireRole } = require('../middleware/auth');
const wallet = require('../controllers/wallet.controller');

const router = Router();
router.use(authRequired, requireRole('worker'));

router.get('/', asyncHandler(wallet.getOverview));
router.post('/withdraw', asyncHandler(wallet.withdraw));

module.exports = router;
