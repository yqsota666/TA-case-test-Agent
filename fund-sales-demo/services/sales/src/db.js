import mysql from 'mysql2/promise';

export const pool = mysql.createPool({
  host: process.env.DB_HOST || 'mysql', port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'sales', password: process.env.DB_PASSWORD || 'sales',
  database: process.env.DB_NAME || 'sales', connectionLimit: 8, decimalNumbers: false
});

export async function waitForDb(retries = 60) {
  for (let i = 0; i < retries; i += 1) {
    try { await pool.query('SELECT 1'); return; } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

export async function one(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows[0] || null;
}

export async function all(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

export async function transaction(action) {
  const connection = await pool.getConnection();
  try { await connection.beginTransaction(); const result = await action(connection); await connection.commit(); return result; }
  catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
