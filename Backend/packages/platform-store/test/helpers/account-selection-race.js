import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { migrationConfig } from '../../src/migrate.js';
import { createExchangeRepository } from '../../src/exchange.js';
import { createReturnConfirmationRepository } from '../../src/return-confirmation.js';

function barrier() {
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  return { ready, release };
}

export async function verifyAccountSelectionRace({db,token,scope,channelId,planVersionId,accountPublicId,trade}) {
  const alternate = crypto.randomUUID();
  await db.execute(`INSERT INTO sales_confirmed_accounts
    (public_id,workspace_id,channel_id,transaction_account_id,ta_account_id,investor_name,investor_type,
     certificate_type,certificate_no,branch_code,source_confirmation_id)
    SELECT ?,workspace_id,channel_id,'RACEOTHER','RACETA',investor_name,investor_type,
      certificate_type,certificate_no,branch_code,source_confirmation_id
    FROM sales_confirmed_accounts WHERE public_id=?`,[alternate,accountPublicId]);
  await db.commit(); // The caller verifies this is a disposable database before invoking this helper.
  const stageDb = await mysql.createConnection(migrationConfig());
  const selectDb = await mysql.createConnection(migrationConfig());
  const pending = [];
  const gates = [];
  function transaction(conn,hook) {
    return async action => {
      await conn.beginTransaction();
      try {
        const result = await action({execute:async(sql,values) => {
          const output = await conn.execute(sql,values);
          await hook(sql);
          return output;
        }});
        await conn.commit();
        return result;
      } catch(error) { await conn.rollback(); throw error; }
    };
  }
  const selection = account => ({...scope,accountPublicId:account});
  const application = serial => ({...scope,sopVersionId:planVersionId,channelId,
    businessDate:trade.TransactionDate,fileType:'03',record:{...trade,AppSheetSerialNo:serial}});
  async function assertWaiting(operation) {
    const outcome = await Promise.race([operation.then(()=> 'settled'),new Promise(resolve=>setTimeout(()=>resolve('waiting'),100))]);
    assert.equal(outcome,'waiting');
  }
  try {
    // Staging owns the Case first: selection waits, then sees the newly committed application.
    const reached = barrier(), resume = barrier(); gates.push(resume);
    const stage = createExchangeRepository({transaction:transaction(stageDb,async sql => {
      if(sql.includes('FROM case_sales_account_refs r JOIN sales_confirmed_accounts')) {
        reached.release(); await resume.ready;
      }
    })});
    const select = createReturnConfirmationRepository({transaction:transaction(selectDb,async()=>{})});
    const staged = stage.stageApplication(token,application('RACESTAGEFIRST')); pending.push(staged);
    await reached.ready;
    const switched = select.selectAccount(token,selection(alternate)).then(result=>({result}),error=>({error})); pending.push(switched);
    await assertWaiting(switched);
    resume.release(); await staged;
    assert.equal((await switched).error?.code,'APPLICATION_ALREADY_STAGED');
    const [[row]] = await db.execute(`SELECT s.transaction_account_id,a.record_json
      FROM cases k JOIN case_sales_account_refs r ON r.workspace_id=k.workspace_id AND r.chat_id=k.chat_id AND r.case_id=k.id
      JOIN sales_confirmed_accounts s ON s.id=r.account_id AND s.workspace_id=r.workspace_id
      JOIN applications a ON a.workspace_id=k.workspace_id AND a.chat_id=k.chat_id AND a.case_id=k.id
      WHERE k.public_id=? AND a.app_no='RACESTAGEFIRST'`,[scope.casePublicId]);
    const snapshot = typeof row.record_json === 'string' ? JSON.parse(row.record_json) : row.record_json;
    assert.equal(snapshot.TransactionAccountID,row.transaction_account_id);
    await db.execute('DELETE FROM applications WHERE app_no=?',['RACESTAGEFIRST']);

    // Selection owns the Case first: staging waits and must read the new reference, not its auth snapshot.
    const selected = barrier(), commit = barrier(); gates.push(commit);
    const selecting = createReturnConfirmationRepository({transaction:transaction(selectDb,async sql => {
      if(sql.includes('INSERT INTO case_sales_account_refs')) { selected.release(); await commit.ready; }
    })});
    const staging = createExchangeRepository({transaction:transaction(stageDb,async()=>{})});
    const switchFirst = selecting.selectAccount(token,selection(alternate)); pending.push(switchFirst);
    await selected.ready;
    const stale = staging.stageApplication(token,application('RACESELECTFIRST')).then(result=>({result}),error=>({error})); pending.push(stale);
    await assertWaiting(stale);
    commit.release(); await switchFirst;
    assert.equal((await stale).error?.code,'APPLICATION_DATA_MISMATCH');
    const [[count]] = await db.execute('SELECT COUNT(*) AS n FROM applications WHERE app_no=?',['RACESELECTFIRST']);
    assert.equal(Number(count.n),0);
  } finally {
    for(const gate of gates) gate.release();
    await Promise.allSettled(pending);
    await stageDb.end(); await selectDb.end();
  }
}
