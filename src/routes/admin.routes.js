const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authRequired, requireRole } = require('../middleware/auth');
const users = require('../controllers/users.controller');

const router = Router();

router.use(authRequired, requireRole('admin'));

router.get('/users', asyncHandler(users.list));
router.patch('/users/:id/active', asyncHandler(users.updateActive));
router.patch('/users/:id/verification', asyncHandler(users.reviewVerification));

module.exports = router;