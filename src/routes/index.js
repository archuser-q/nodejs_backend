const { Router } = require('express');

const router = Router();

router.use('/auth', require('./auth.routes'));
router.use('/users', require('./users.routes'));
router.use('/admin', require('./admin.routes'));
router.use('/services', require('./services.routes'));
router.use('/worker-services', require('./workerServices.routes'));
router.use('/orders', require('./orders.routes'));

module.exports = router;