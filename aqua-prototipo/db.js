const mysql = require('mysql2/promise');

const config = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'aquavisao',
  waitForConnections: true,
  connectionLimit: 10,
  timezone: 'Z',
  decimalNumbers: true
};

let pool;
function getPool() { return pool ||= mysql.createPool(config); }
async function ping() { const c = await getPool().getConnection(); try { await c.ping(); } finally { c.release(); } }
module.exports = { getPool, ping, config };
