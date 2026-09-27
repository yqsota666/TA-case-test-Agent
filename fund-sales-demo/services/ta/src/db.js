import oracledb from 'oracledb';

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
let pool;

export async function waitForDb(retries = 90) {
  for (let i=0;i<retries;i+=1) {
    try {
      pool = await oracledb.createPool({
        user: process.env.DB_USER || 'ta', password: process.env.DB_PASSWORD || 'ta',
        connectString: process.env.DB_CONNECT || 'oracle:1521/FREEPDB1', poolMin: 1, poolMax: 8
      });
      const c=await pool.getConnection(); await c.execute('SELECT 1 FROM dual'); await c.close(); return;
    } catch(error) {
      try { await pool?.close(0); } catch {} pool=undefined;
      if(i===retries-1) throw error; await new Promise(r=>setTimeout(r,3000));
    }
  }
}

const normalized = row => Object.fromEntries(Object.entries(row).map(([k,v])=>[k.toLowerCase(),v]));
export async function all(sql, binds={}) { const c=await pool.getConnection(); try { const r=await c.execute(sql,binds); return r.rows.map(normalized); } finally { await c.close(); } }
export async function one(sql, binds={}) { return (await all(sql,binds))[0]||null; }
export async function exec(sql, binds={}) { const c=await pool.getConnection(); try { return await c.execute(sql,binds,{autoCommit:true}); } finally { await c.close(); } }
export async function transaction(action) { const c=await pool.getConnection(); try { const value=await action(c); await c.commit(); return value; } catch(e){await c.rollback();throw e;} finally{await c.close();} }
export { oracledb };
