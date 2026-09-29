const express = require('express');
const cors = require('cors');

const { authOptional } = require('./middleware/auth');
const dbContext = require('./middleware/dbContext');
const errorHandler = require('./middleware/errorHandler');
const routes = require('./routes');

const app = express();

app.use(cors());
app.use(express.json());

// Thứ tự quan trọng: authOptional phải chạy TRƯỚC dbContext, vì dbContext
// đọc req.user để set biến session cho RLS (app.current_user_id/role).
app.use(authOptional);
app.use(dbContext);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api', routes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

module.exports = app;
