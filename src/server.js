const app = require('./app');
const config = require('./config');

app.listen(config.port, () => {
  console.log(`THỢ NHANH API (v2, app-layer auth) đang chạy tại http://localhost:${config.port}`);
});