import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const migrationDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));

export function migrationStatements(sql) {
  const withoutComments = sql.split('\n').filter(line => !/^\s*--/.test(line)).join('\n');
  return withoutComments.split(';').map(part => part.trim()).filter(Boolean).map(statement => {
    const create = /^CREATE TABLE ([a-z][a-z0-9_]*)\s*\(/i.exec(statement);
    const compact = statement.replace(/\s+/g, ' ');
    const widenSopStatus = /^ALTER TABLE case_sop_versions DROP CHECK ck_sop_status, DROP CHECK ck_sop_lock, MODIFY COLUMN status VARCHAR\(24\) NOT NULL DEFAULT 'DRAFT', ADD CONSTRAINT ck_sop_status CHECK \(status IN \('DRAFT','PENDING_CONFIRMATION','LOCKED'\)\), ADD CONSTRAINT ck_sop_lock CHECK \(\(status='LOCKED'\)=\(locked_at IS NOT NULL\)\)$/i.test(compact);
    const addTurnKind = /^ALTER TABLE case_discussion_turns ADD COLUMN turn_kind VARCHAR\(16\) NOT NULL DEFAULT 'DISCUSS', ADD CONSTRAINT ck_discussion_kind CHECK \(turn_kind IN \('DISCUSS','PROPOSE_PLAN'\)\)$/i.test(compact);
    const addSopSource = /^ALTER TABLE case_sop_versions ADD COLUMN source_turn_number INT UNSIGNED NULL, ADD CONSTRAINT fk_sop_source_turn FOREIGN KEY \(workspace_id,chat_id,case_id,source_turn_number\) REFERENCES case_discussion_turns\(workspace_id,chat_id,case_id,turn_number\)$/i.test(compact);
    const widenReply = /^ALTER TABLE case_discussion_turns MODIFY COLUMN assistant_text MEDIUMTEXT NULL$/i.test(compact);
    if (!create && !widenSopStatus && !addTurnKind && !addSopSource && !widenReply) throw new Error('迁移语句不在允许的范围内');
    return { sql: statement, table: create?.[1] ?? (addTurnKind || widenReply ? 'case_discussion_turns' : 'case_sop_versions'),
      kind: create ? 'CREATE' : addTurnKind ? 'ADD_TURN_KIND' : addSopSource ? 'ADD_SOP_SOURCE' :
        widenReply ? 'WIDEN_REPLY' : 'WIDEN_SOP_STATUS',
      checksum: crypto.createHash('sha256').update(statement).digest('hex') };
  });
}

async function tableExists(db, name) {
  const [[row]] = await db.execute(`SELECT COUNT(*) AS count FROM information_schema.tables
    WHERE table_schema=DATABASE() AND table_name=?`, [name]);
  return Number(row.count) === 1;
}

async function stepApplied(db, step) {
  if (step.kind === 'CREATE') return tableExists(db, step.table);
  if (step.kind === 'ADD_TURN_KIND' || step.kind === 'ADD_SOP_SOURCE') {
    const table = step.kind === 'ADD_TURN_KIND' ? 'case_discussion_turns' : 'case_sop_versions';
    const column = step.kind === 'ADD_TURN_KIND' ? 'turn_kind' : 'source_turn_number';
    const [[row]] = await db.execute(`SELECT COUNT(*) AS count FROM information_schema.columns
      WHERE table_schema=DATABASE() AND table_name=? AND column_name=?`, [table, column]);
    return Number(row.count) === 1;
  }
  if (step.kind === 'WIDEN_REPLY') {
    const [[row]] = await db.execute(`SELECT data_type AS data_type FROM information_schema.columns
      WHERE table_schema=DATABASE() AND table_name='case_discussion_turns' AND column_name='assistant_text'`);
    if (!row) throw new Error('case_discussion_turns.assistant_text 不存在，无法扩展');
    return row.data_type === 'mediumtext';
  }
  const [[row]] = await db.execute(`SELECT character_maximum_length AS width
    FROM information_schema.columns WHERE table_schema=DATABASE()
      AND table_name='case_sop_versions' AND column_name='status'`);
  if (!row) throw new Error('case_sop_versions.status 不存在，无法扩展');
  return Number(row.width) >= 24;
}

// MySQL commits DDL implicitly. A step is journaled before each DDL operation,
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
      const steps = migrationStatements(source);
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
        const applied = await stepApplied(db, step);
        if (step.kind === 'CREATE' && !prior && applied) {
          throw new Error(`${step.table} 已存在且不属于本迁移，停止执行`);
        }
        if (!prior) {
          await db.execute(`INSERT INTO schema_migration_steps
            (version,step_number,table_name,statement_hash,status) VALUES (?,?,?,?,'STARTED')`,
          [name, number, step.table, step.checksum]);
        }
        if (!applied) {
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
