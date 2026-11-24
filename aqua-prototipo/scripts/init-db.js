require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

(async () => {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    multipleStatements: true
  });
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    await connection.query(sql);
    await connection.query(`USE \`${process.env.MYSQL_DATABASE || 'aquavisao'}\``);
    const values = Array.from({length:100}, (_,index) => {
      const i=index+1, code=String(i).padStart(3,'0'), sector=String((index%10)+1).padStart(2,'0');
      return [`CAIXA-${code}`,`Reservatório ${code}`,`Setor ${sector}`,10+((i*37)%88)];
    });
    await connection.query(`INSERT IGNORE INTO reservoirs
      (code,name,location,current_level_pct,data_source,communication_status)
      VALUES ?`, [values.map(row => [...row,'simulation','online'])]);
    console.log('Banco AquaVisão criado e populado com 100 reservatórios.');
  } finally { await connection.end(); }
})().catch(error => { console.error('Falha ao inicializar MySQL:', error.message); process.exitCode = 1; });
