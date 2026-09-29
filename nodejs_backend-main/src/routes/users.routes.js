const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authRequired } = require('../middleware/auth');
const { getMe, updateMe, getById } = require('../controllers/users.controller');

const router = Router();

router.get('/me', authRequired, asyncHandler(getMe));
router.patch('/me', authRequired, asyncHandler(updateMe));
router.get('/:id', authRequired, asyncHandler(getById));

module.exports = router;
