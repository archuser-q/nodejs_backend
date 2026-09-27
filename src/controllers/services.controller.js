const pool = require('../config/db');

async function list(req, res) {
  const { rows } = await pool.query('SELECT * FROM services ORDER BY id');
  res.json(rows);
}

async function create(req, res) {
  const { name, category } = req.body;
  if (!name) return res.status(400).json({ error: 'Thiếu name.' });

  const { rows } = await pool.query(
    'INSERT INTO services (name, category) VALUES ($1, $2) RETURNING *',
    [name, category || null]
  );
  res.status(201).json(rows[0]);
}

module.exports = { list, create };