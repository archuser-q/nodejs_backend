const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { register, login } = require('../controllers/auth.controller');

const router = Router();

router.post('/register', asyncHandler(register));
router.post('/login', asyncHandler(login));

module.exports = router;
