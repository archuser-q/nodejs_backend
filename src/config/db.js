const { Pool } = require('pg');
const config = require('./index');

if (!config.databaseUrl) {
  console.warn('[db] DATABASE_URL is not set — set it in .env before starting the server.');
}

const pool = new Pool({
  connectionString: config.databaseUrl,
});

pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle client', err);
});

module.exports = pool;