const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { authRequired } = require('../middleware/auth');
const notifications = require('../controllers/notifications.controller');

const router = Router();
router.use(authRequired);

router.get('/', asyncHandler(notifications.list));
router.get('/unread-count', asyncHandler(notifications.unreadCount));
router.patch('/:id/read', asyncHandler(notifications.markRead));
router.patch('/read-all', asyncHandler(notifications.markAllRead));

module.exports = router;
