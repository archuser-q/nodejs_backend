const app = require('./app');
const config = require('./config');

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`THỢ NHANH API đang chạy tại http://localhost:${config.port}`);
});
