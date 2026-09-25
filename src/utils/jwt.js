const jwt = require('jsonwebtoken');
const config = require('../config');

// payload: { id, role } — role là 'customer' | 'worker' | 'admin'
function signToken(payload) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

module.exports = { signToken, verifyToken };
