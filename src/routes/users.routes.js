const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authRequired, requireRole } = require('../middleware/auth');
const users = require('../controllers/users.controller');

const router = Router();

router.get('/me', authRequired, asyncHandler(users.getMe));
router.patch('/me', authRequired, asyncHandler(users.updateMe));
router.get('/:id', authRequired, asyncHandler(users.getById));
router.patch('/me/verification-doc', authRequired, requireRole('worker'), asyncHandler(users.setVerificationDoc));

module.exports = router;