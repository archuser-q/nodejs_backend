const { Router } = require('express');

const router = Router();

router.use('/auth', require('./auth.routes'));
router.use('/users', require('./users.routes'));
router.use('/services', require('./services.routes'));
router.use('/worker-services', require('./workerServices.routes'));
router.use('/orders', require('./orders.routes'));
router.use('/payments', require('./payments.routes'));
router.use('/quotes', require('./quotes.routes'));
router.use('/workers', require('./workers.routes'));
router.use('/admin', require('./admin.routes'));

module.exports = router;
