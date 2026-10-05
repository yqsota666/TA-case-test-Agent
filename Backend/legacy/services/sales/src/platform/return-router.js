import {createExchangeStore,parseReturnFiles} from './exchange-store.js';
import {fail} from './workflow-service.js';

const summary=()=>({success:0,failure:0,partial:0,review:0,unmatched:0,duplicate:0,snapshots:0});
const collectRoutes=async(db,workspaceId,packageIds)=>{
  if(!packageIds.length)return new Map();
  const [rows]=await db.execute(`SELECT f.package_id AS packageInternalId,c.public_id AS chatPublicId,c.title,r.public_id AS runPublicId,r.run_number AS runNumber,
    COUNT(*) AS records,SUM(cf.outcome='SUCCESS') AS success,SUM(cf.outcome='FAILURE') AS failure,SUM(cf.outcome='PARTIAL') AS partial
    FROM file_records f JOIN test_runs r ON r.workspace_id=f.workspace_id AND r.chat_id=f.chat_id AND r.id=f.run_id
    JOIN test_chats c ON c.workspace_id=r.workspace_id AND c.id=r.chat_id
    LEFT JOIN confirmations cf ON cf.workspace_id=f.workspace_id AND cf.chat_id=f.chat_id AND cf.run_id=f.run_id AND cf.file_record_id=f.id
    WHERE f.workspace_id=? AND f.package_id IN (${packageIds.map(()=>'?').join(',')})
    GROUP BY f.package_id,c.public_id,c.title,r.public_id,r.run_number ORDER BY c.public_id,r.run_number`,[workspaceId,...packageIds]);
  const result=new Map();
  for(const {packageInternalId,...r} of rows){
    const id=String(packageInternalId);if(!result.has(id))result.set(id,[]);
    result.get(id).push({...r,records:Number(r.records),success:Number(r.success??0),failure:Number(r.failure??0),partial:Number(r.partial??0)});
  }
  return result;
};

// This is authenticated workspace ingress. No chat/run identifier supplied by a browser
// determines the owner of a TA record; only server-side protocol identifiers do.
export async function routeReturns({db,auth,input}){
  const groups=parseReturnFiles(input),total=summary(),packages=[];
  const [channels]=await db.execute('SELECT * FROM exchange_channels WHERE workspace_id=?',[auth.workspace_id]);
  const batches=groups.map(files=>{
    const header=files[0].parsed,matching=channels.filter(c=>c.ta_code===header.creator&&c.distributor_code===header.receiver);
    if(matching.length!==1)fail('返回文件的 TA／销售机构无法唯一匹配已配置通道','WRONG_CHANNEL');
    return {files,channel:matching[0]};
  });
  // Same lock order as scoped writes. The environment lock also serializes TA account
  // creation and package deduplication across users of the same actual TA server.
  for(const id of [...new Set(batches.map(b=>String(b.channel.ta_environment_id)))].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1))
    await db.execute('SELECT id FROM ta_environments WHERE id=? FOR UPDATE',[id]);
  const [[activeChat]]=await db.execute(`SELECT chat_id FROM global_case_ledgers
    WHERE workspace_id=? AND ended_at IS NULL ORDER BY chat_id LIMIT 1`,[auth.workspace_id]);
  const [runs]=await db.execute(`SELECT r.*,r.id AS run_id,c.status AS chat_status,
    COALESCE(direct_chat.chat_id,parent_chat.chat_id) AS parent_chat_id,
    COALESCE(direct_chat.ended_at,parent_chat.ended_at) AS parent_ended_at FROM test_runs r
    JOIN test_chats c ON c.workspace_id=r.workspace_id AND c.id=r.chat_id
    LEFT JOIN global_case_ledgers direct_chat ON direct_chat.workspace_id=r.workspace_id AND direct_chat.chat_id=r.chat_id
    LEFT JOIN global_cases g ON g.workspace_id=r.workspace_id AND g.chat_id=r.chat_id AND g.run_id=r.id
    LEFT JOIN global_case_ledgers parent_chat ON parent_chat.workspace_id=g.workspace_id AND parent_chat.chat_id=g.parent_chat_id
    WHERE r.workspace_id=? ORDER BY r.id FOR UPDATE`,[auth.workspace_id]);
  const stores=new Map(runs.map(r=>[String(r.id),createExchangeStore({db,auth,scope:r})]));
  const runMap=new Map(runs.map(r=>[String(r.id),r]));
  const prepared=[];
  for(const {files,channel} of batches){
    const scope={...channel,channel_id:channel.id,workspace_id:auth.workspace_id},ingress=createExchangeStore({db,scope,auth});
    const p=await ingress.savePackage('INBOUND',`${files[0].parsed.date.slice(0,4)}-${files[0].parsed.date.slice(4,6)}-${files[0].parsed.date.slice(6,8)}`,files),counts=summary();
    if(p.duplicate)counts.duplicate=files.reduce((n,f)=>n+f.records.length,0);
    prepared.push({files,channel,ingress,p,counts});
  }
  // Process account confirmations first across ALL folders/packages on a day.
  // Input order must not make a 04/05 lose the 02 established in another folder.
  const ordered=prepared.filter(b=>!b.p.duplicate).flatMap(batch=>batch.files.filter(f=>f.kind==='DATA').map(file=>({batch,file})))
    .sort((a,b)=>a.file.parsed.date.localeCompare(b.file.parsed.date)||a.file.type.localeCompare(b.file.type));
  const touched=new Set();
  for(const {batch,file:f} of ordered){
    const {p,channel,ingress,counts}=batch;
    for(let i=0;i<f.records.length;i++){
      const record=f.records[i];
      // Global unique namespace indexes locate at most one owner. Workspace is
      // still required so another user's identifiers cannot become routing targets.
      const [owners]=await db.execute(f.type==='05'?
        'SELECT run_id FROM trading_accounts WHERE workspace_id=? AND ta_environment_id=? AND ta_code=? AND distributor_code=? AND transaction_account_no=?':
        'SELECT run_id FROM applications WHERE workspace_id=? AND ta_environment_id=? AND ta_code=? AND distributor_code=? AND app_no=?',
        [auth.workspace_id,channel.ta_environment_id,channel.ta_code,channel.distributor_code,f.type==='05'?record.TransactionAccountID??'':record.AppSheetSerialNo??'']);
      const owner=owners.length===1?runMap.get(String(owners[0].run_id)):null;
      if(!owner||owner.chat_status!=='ACTIVE'||!['DRAFT','ACTIVE'].includes(owner.status)
        ||owner.parent_ended_at||activeChat&&String(owner.parent_chat_id)!==String(activeChat.chat_id)){
        await ingress.quarantine(p,f,record,i+1,owner?'归属运行已封存；记录已隔离待核对':'无法唯一定位本工作空间的申请或账户；记录已隔离',counts);continue;
      }
      const store=stores.get(String(owner.id));await store.processRecord(p,f,record,i+1,counts);touched.add(String(owner.id));
    }
  }
  for(const id of touched)await stores.get(id).finishOutgoing();
  const allRoutes=await collectRoutes(db,auth.workspace_id,prepared.map(b=>b.p.id));
  for(const {files,p,counts} of prepared){
    if(!p.duplicate){
      await db.execute("UPDATE exchange_packages SET delivery_status='RETURN_RECEIVED',parse_status=? WHERE workspace_id=? AND id=?",[counts.unmatched?'QUARANTINED':'PROCESSED',auth.workspace_id,p.id]);
      await db.execute("INSERT INTO delivery_events(workspace_id,package_id,actor_user_id,event_type) VALUES (?,?,?,'RETURN_UPLOADED')",[auth.workspace_id,p.id,auth.user_id]);
    }
    packages.push({publicId:p.publicId,duplicate:!!p.duplicate,summary:counts,routes:allRoutes.get(String(p.id))??[],indexMissing:!files.some(f=>f.kind==='INDEX')});
    for(const k of Object.keys(total))total[k]+=counts[k];
  }
  return {publicId:packages.length===1?packages[0].publicId:undefined,duplicate:packages.every(p=>p.duplicate),summary:total,
    routes:packages.flatMap(p=>p.routes.map(r=>({...r,packageId:p.publicId}))),packages,indexMissing:packages.some(p=>p.indexMissing)};
}

export async function returnHistory(db,auth){
  const [packages]=await db.execute(`SELECT p.id,p.public_id AS publicId,p.business_date AS businessDate,p.parse_status AS parseStatus,p.created_at AS createdAt,
    (SELECT COUNT(*) FROM exchange_files f WHERE f.workspace_id=p.workspace_id AND f.package_id=p.id) AS files,
    (SELECT COUNT(*) FROM file_records f WHERE f.workspace_id=p.workspace_id AND f.package_id=p.id AND f.chat_id IS NULL) AS quarantined
    FROM exchange_packages p WHERE p.workspace_id=? AND p.direction='INBOUND' ORDER BY p.id DESC LIMIT 100`,[auth.workspace_id]);
  const routes=await collectRoutes(db,auth.workspace_id,packages.map(p=>p.id));
  for(const p of packages){p.routes=routes.get(String(p.id))??[];delete p.id;}
  const [quarantine]=await db.execute(`SELECT p.public_id AS packageId,f.file_name AS fileName,r.record_index AS recordIndex,r.match_reason AS reason
    FROM file_records r JOIN exchange_files f ON f.workspace_id=r.workspace_id AND f.id=r.file_id
    JOIN exchange_packages p ON p.workspace_id=r.workspace_id AND p.id=r.package_id
    WHERE r.workspace_id=? AND r.chat_id IS NULL ORDER BY r.id DESC LIMIT 100`,[auth.workspace_id]);
  return {packages,quarantine};
}
