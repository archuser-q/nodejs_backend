const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { register, login, googleAuth, requestEmailCode, verifyEmailCode } = require('../controllers/auth.controller');

const router = Router();

// Cổ điển — dự phòng cho App Khách nếu vẫn muốn dùng.
router.post('/register', asyncHandler(register));
router.post('/login', asyncHandler(login));

// App Thợ dùng 2 route dưới đây.
router.post('/google', asyncHandler(googleAuth));
router.post('/email/send-code', asyncHandler(requestEmailCode));
router.post('/email/verify-code', asyncHandler(verifyEmailCode));

module.exports = router;
