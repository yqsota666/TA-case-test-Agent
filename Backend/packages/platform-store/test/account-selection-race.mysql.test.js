import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import mysql from 'mysql2/promise';
import { applyMigrations, migrationConfig } from '../src/migrate.js';

test('MySQL: account selection and staging serialize in both orders, including pre-lock snapshots',
  {skip:process.env.CASE_CONFIRMATION_MYSQL !== '1',timeout:60000},async()=> {
    const config = migrationConfig();
    const database = 'ta_case_agent_test_race'+crypto.randomBytes(8).toString('hex');
    const root = await mysql.createConnection({...config,database:undefined});
    let db;
    try {
      await root.query(`CREATE DATABASE ${database}`);
      db = await mysql.createConnection({...config,database});
      await applyMigrations(db);
      const result = spawnSync(process.execPath,['--test',new URL('./confirmed-sales.mysql.test.js',import.meta.url).pathname],
        {env:{...process.env,CASE_DB_NAME:database,CASE_CONFIRMATION_RACE:'1'},encoding:'utf8',timeout:45000});
      assert.equal(result.status,0,result.stdout+result.stderr);
    } finally {
      if(db) await db.end();
      await root.query(`DROP DATABASE IF EXISTS ${database}`);
      await root.end();
    }
  });
