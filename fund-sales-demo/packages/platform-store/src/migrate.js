import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const migrationDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));

function statements(sql) {
  const withoutComments = sql.split('\n').filter(line => !/^\s*--/.test(line)).join('\n');
  return withoutComments.split(';').map(part => part.trim()).filter(Boolean).map(statement => {
    const match = /^CREATE TABLE ([a-z][a-z0-9_]*)\s*\(/i.exec(statement);
    if (!match) throw new Error('迁移只允许独立的 CREATE TABLE 语句');
    return { sql: statement, table: match[1], checksum: crypto.createHash('sha256').update(statement).digest('hex') };
  });
}

async function tableExists(db, name) {
  const [[row]] = await db.execute(`SELECT COUNT(*) AS count FROM information_schema.tables
    WHERE table_schema=DATABASE() AND table_name=?`, [name]);
  return Number(row.count) === 1;
}

// MySQL commits DDL implicitly. A step is journaled before each CREATE TABLE,
// so an interruption after creation can resume without rerunning completed DDL.
export async function applyMigrations(db, { directory = migrationDirectory, afterCreate } = {}) {
  const [[lock]] = await db.execute("SELECT GET_LOCK(CONCAT(DATABASE(),':case_schema'),10) AS acquired");
  if (Number(lock.acquired) !== 1) throw new Error('另一个数据库迁移正在执行');
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE IF NOT EXISTS schema_migration_steps (
      version VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      step_number INT UNSIGNED NOT NULL,
      table_name VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      statement_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      status VARCHAR(8) NOT NULL,
      PRIMARY KEY (version,step_number),
      CONSTRAINT ck_migration_step_status CHECK (status IN ('STARTED','APPLIED'))
    ) ENGINE=InnoDB`);
    const names = fs.readdirSync(directory).filter(name => /^\d+_[a-z_]+\.sql$/.test(name)).sort();
    for (const name of names) {
      const source = fs.readFileSync(path.join(directory, name), 'utf8');
      const checksum = crypto.createHash('sha256').update(source).digest('hex');
      const steps = statements(source);
      const [[applied]] = await db.execute('SELECT checksum FROM schema_migrations WHERE version=?', [name]);
      if (applied) {
        if (applied.checksum !== checksum) throw new Error(`${name} 已应用但内容被修改`);
        continue;
      }
      for (const [index, step] of steps.entries()) {
        const number = index + 1;
        const [[prior]] = await db.execute(`SELECT table_name,statement_hash,status
          FROM schema_migration_steps WHERE version=? AND step_number=?`, [name, number]);
        if (prior && (prior.table_name !== step.table || prior.statement_hash !== step.checksum)) {
          throw new Error(`${name} 第 ${number} 步与已有迁移记录不一致`);
        }
        const exists = await tableExists(db, step.table);
        if (!prior && exists) throw new Error(`${step.table} 已存在且不属于本迁移，停止执行`);
        if (!prior) {
          await db.execute(`INSERT INTO schema_migration_steps
            (version,step_number,table_name,statement_hash,status) VALUES (?,?,?,?,'STARTED')`,
          [name, number, step.table, step.checksum]);
        }
        if (!exists) {
          if (prior?.status === 'APPLIED') throw new Error(`${step.table} 已被删除，无法继续迁移`);
          await db.query(step.sql);
          if (afterCreate) await afterCreate({ version: name, stepNumber: number, table: step.table });
        }
        await db.execute(`UPDATE schema_migration_steps SET status='APPLIED'
          WHERE version=? AND step_number=?`, [name, number]);
      }
      await db.execute('INSERT INTO schema_migrations(version,checksum) VALUES (?,?)', [name, checksum]);
    }
    return names;
  } finally {
    await db.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(),':case_schema'))");
  }
}

export function migrationConfig(env = process.env) {
  const database = env.CASE_DB_NAME;
  if (!/^ta_case_agent(?:_[a-z0-9]+)?$/.test(database || '')) {
    throw new Error('CASE_DB_NAME 必须是独立的 ta_case_agent 数据库');
  }
  if (!env.CASE_DB_USER || !env.CASE_DB_PASSWORD) throw new Error('缺少数据库账号或密码');
  return {
    host: env.CASE_DB_HOST || '127.0.0.1', port: Number(env.CASE_DB_PORT || 3306),
    user: env.CASE_DB_USER, password: env.CASE_DB_PASSWORD, database,
    multipleStatements: false, supportBigNumbers: true, bigNumberStrings: true, timezone: 'Z'
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const connection = await mysql.createConnection(migrationConfig());
  try {
    const names = await applyMigrations(connection);
    process.stdout.write(`已核对迁移：${names.join(', ')}\n`);
  } finally {
    await connection.end();
  }
}
