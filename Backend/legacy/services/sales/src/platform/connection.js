import fs from 'node:fs';
import mysql from 'mysql2/promise';

export const PLATFORM_DATABASE = 'sales_platform_v2';

export function readPlatformConfig(filePath, overrides = process.env) {
  filePath = overrides.PLATFORM_ENV_FILE || filePath;
  const values = {};
  if (filePath && fs.existsSync(filePath)) {
    for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
      const match = /^(PLATFORM_DB_[A-Z]+)=(.*)$/.exec(line.trim());
      if (match) values[match[1]] = match[2];
    }
  }
  const setting = name => overrides[name] ?? values[name];
  const database = setting('PLATFORM_DB_NAME') || PLATFORM_DATABASE;
  if (database !== PLATFORM_DATABASE) throw new Error('新平台只允许连接 sales_platform_v2');
  const password = setting('PLATFORM_DB_PASSWORD');
  if (!password) throw new Error('缺少 PLATFORM_DB_PASSWORD，请先执行 db:platform:init');
  return {
    host: setting('PLATFORM_DB_HOST') || '127.0.0.1',
    port: Number(setting('PLATFORM_DB_PORT') || 3307),
    user: setting('PLATFORM_DB_USER') || 'sales_platform_v2',
    password, database,
    connectionLimit: 4, decimalNumbers: false,
    supportBigNumbers: true, bigNumberStrings: true, timezone: 'Z',
    multipleStatements: false
  };
}

export function createPlatformPool(config) {
  if (config.database !== PLATFORM_DATABASE) throw new Error('禁止使用旧数据库运行新平台');
  return mysql.createPool(config);
}

export function transactional(pool) {
  return async action => {
    const connection = await pool.getConnection();
    try {
      // Requests authenticate before acquiring the TA lock. Read the latest committed
      // state after waiting for another import, rather than retaining an older snapshot.
      await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await connection.beginTransaction();
      const result = await action(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };
}
