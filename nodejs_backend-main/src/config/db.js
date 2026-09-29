const { Pool } = require('pg');
const config = require('./index');

if (!config.databaseUrl) {
  // eslint-disable-next-line no-console
  console.warn('[db] DATABASE_URL is not set — set it in .env before starting the server.');
}

const pool = new Pool({
  connectionString: config.databaseUrl,
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[db] Unexpected error on idle client', err);
});

module.exports = pool;
