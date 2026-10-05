import crypto from 'node:crypto';
import {authenticateSession,resolveRun,assertWritableRun,mapDatabaseError} from './scope.js';
import {createChatInWorkspace} from './repository.js';
import {createRunStore} from './run-store.js';
import {fail,decimalValue,units,syntheticCertificate} from './workflow-service.js';
import {encodeRecord} from '../../../../packages/platform-protocol/src/index.js';

const payload=input=>{
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>/^(workspace|chat|run|owner|taEnvironment)/i.test(k)))fail('不能指定数据归属','SCOPE_OVERRIDE');
  return input;
};
const validateRecord=record=>{try{encodeRecord('01',record,'22');}catch(e){fail(e.message);}};
const profile=input=>{
  const p=payload(input??{}),allowed=['MobileTelNo','EmailAddress','AccountBank','BankAccount','BankAccountName','Address','PostCode'];
  if(Object.keys(p).some(k=>!allowed.includes(k)))fail('客户资料包含不支持的字段');
  for(const [k,v] of Object.entries(p)){if(typeof v!=='string')fail('客户资料格式无效');validateRecord({[k]:v});}
  return p;
};
const customerValues=b=>{
  if(typeof b.investorName!=='string'||!b.investorName.trim()||b.investorName.length>180)fail('请填写客户姓名');
  if(b.certificateNo!=null&&typeof b.certificateNo!=='string')fail('证件号格式无效');
  const c={investorName:b.investorName.trim(),investorType:b.investorType??'1',certificateType:b.certificateType??'0',certificateNo:(b.certificateNo||syntheticCertificate()).trim().toUpperCase(),branchCode:b.branchCode??'305',simulatedBalance:decimalValue(b.simulatedBalance??'0.00'),profile:profile(b.profile)};
  if(!['0','1'].includes(c.investorType)||!['0','9'].includes(c.certificateType)||!/^[A-Z0-9-]{1,40}$/.test(c.certificateNo)||!/^\w{1,9}$/.test(c.branchCode))fail('客户类型、证件或网点格式无效');
  validateRecord({InvestorName:c.investorName,CertificateNo:c.certificateNo,CertificateType:c.certificateType,BranchCode:c.branchCode});
  return c;
};
const placeholders=values=>values.map(()=>'?').join(',');
export function createCatalogService({transaction}){
  const inWorkspace=async(token,action)=>{
    try{return await transaction(async db=>action(db,await authenticateSession(db,token)));}catch(e){throw mapDatabaseError(e);}
  };
  const findCustomer=async(db,auth,publicId,lock=false)=>{
    const [[c]]=await db.execute(`SELECT * FROM catalog_customers WHERE workspace_id=? AND public_id=?${lock?' FOR UPDATE':''}`,[auth.workspace_id,publicId]);
    if(!c)fail('客户不存在','RECORD_NOT_FOUND',404);return c;
  };
  const state=(token,{after='0',search='',customerPublicId}={})=>inWorkspace(token,async(db,auth)=>{
    if(typeof after!=='string'||!/^\d{1,20}$/.test(after)||BigInt(after)>18446744073709551615n||typeof search!=='string'||search.length>100)fail('分页参数无效');
    // Protocol certificates are ASCII; a Chinese name must not be coerced to that charset.
    const asciiSearch=/^[\x00-\x7f]*$/.test(search),predicate=asciiSearch?'(investor_name LIKE ? OR certificate_no LIKE ?)':'investor_name LIKE ?';
    const parameters=[auth.workspace_id,after,`%${search}%`];if(asciiSearch)parameters.push(`%${search}%`);
    const [customers]=await db.execute(`SELECT id,public_id,investor_name,investor_type,certificate_type,certificate_no,branch_code,simulated_balance,profile_json
      FROM catalog_customers WHERE workspace_id=? AND id>? AND ${predicate} ORDER BY id LIMIT 101`,parameters);
    const [funds]=await db.execute('SELECT id,fund_code,fund_name,share_class,nav FROM catalog_funds WHERE workspace_id=? ORDER BY fund_code,share_class LIMIT 500',[auth.workspace_id]);
    const current=customerPublicId?await findCustomer(db,auth,customerPublicId):customers[0];
    const [positions]=current?await db.execute(`SELECT p.id,p.customer_id,p.fund_id,p.total_volume,p.available_volume,p.frozen_volume,f.fund_code,f.fund_name,f.share_class
      FROM catalog_positions p JOIN catalog_funds f ON f.workspace_id=p.workspace_id AND f.id=p.fund_id WHERE p.workspace_id=? AND p.customer_id=? ORDER BY p.id LIMIT 500`,[auth.workspace_id,current.id]):[[]];
    const [[counts]]=await db.execute(`SELECT (SELECT COUNT(*) FROM catalog_customers WHERE workspace_id=?) AS customers,
      (SELECT COUNT(*) FROM catalog_funds WHERE workspace_id=?) AS funds,(SELECT COUNT(*) FROM catalog_positions WHERE workspace_id=?) AS holdings,
      (SELECT COALESCE(SUM(simulated_balance),0) FROM catalog_customers WHERE workspace_id=?) AS balance`,Array(4).fill(auth.workspace_id));
    for(const k of ['customers','funds','holdings'])counts[k]=Number(counts[k]);
    return {mode:'CATALOG',customers:customers.slice(0,100),customerMore:customers.length>100,currentCustomer:current??null,funds,positions,counts};
  });
  const addCustomers=(token,input)=>inWorkspace(token,async(db,auth)=>{
    const b=payload(input),count=b.count??1;if(!Number.isInteger(count)||count<1||count>100)fail('一次新增 1–100 位客户');
    if(count>1&&b.certificateNo)fail('批量新增时请留空证件号');
    const created=[];
    for(let i=0;i<count;i++){
      const c=customerValues({...b,investorName:count===1?b.investorName:`${b.investorName} ${i+1}`}),publicId=crypto.randomUUID();
      const [r]=await db.execute(`INSERT INTO catalog_customers(public_id,workspace_id,investor_name,investor_type,certificate_type,certificate_no,branch_code,simulated_balance,profile_json) VALUES (?,?,?,?,?,?,?,?,?)`,[publicId,auth.workspace_id,c.investorName,c.investorType,c.certificateType,c.certificateNo,c.branchCode,c.simulatedBalance,JSON.stringify(c.profile)]);
      created.push({id:String(r.insertId),publicId});
    }return {created};
  });
  const updateCustomer=(token,publicId,input)=>inWorkspace(token,async(db,auth)=>{
    const existing=await findCustomer(db,auth,publicId,true),c=customerValues(payload(input));
    await db.execute(`UPDATE catalog_customers SET investor_name=?,investor_type=?,certificate_type=?,certificate_no=?,branch_code=?,simulated_balance=?,profile_json=? WHERE workspace_id=? AND id=?`,[c.investorName,c.investorType,c.certificateType,c.certificateNo,c.branchCode,c.simulatedBalance,JSON.stringify(c.profile),auth.workspace_id,existing.id]);return {ok:true};
  });
  const addFund=(token,input)=>inWorkspace(token,async(db,auth)=>{
    const b=payload(input);if(!/^\d{6}$/.test(b.fundCode??'')||typeof b.fundName!=='string'||!b.fundName.trim()||b.fundName.length>200||!/^\w$/.test(b.shareClass??'0'))fail('基金资料格式无效');
    await db.execute(`INSERT INTO catalog_funds(workspace_id,fund_code,share_class,fund_name,nav) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE fund_name=VALUES(fund_name),nav=VALUES(nav)`,[auth.workspace_id,b.fundCode,b.shareClass??'0',b.fundName.trim(),b.nav?decimalValue(b.nav,8):null]);return {ok:true};
  });
  const addPosition=(token,input)=>inWorkspace(token,async(db,auth)=>{
    const b=payload(input),c=await findCustomer(db,auth,b.customerPublicId,true);
    const [[f]]=await db.execute('SELECT id FROM catalog_funds WHERE workspace_id=? AND fund_code=? AND share_class=?',[auth.workspace_id,b.fundCode,b.shareClass??'0']);if(!f)fail('请先新增基金','RECORD_NOT_FOUND',404);
    const total=decimalValue(b.totalVolume),available=decimalValue(b.availableVolume??b.totalVolume),frozen=decimalValue(b.frozenVolume??'0.00');
    if(units(available)+units(frozen)>units(total))fail('可用份额与冻结份额之和不能超过总份额');
    await db.execute(`INSERT INTO catalog_positions(workspace_id,customer_id,fund_id,total_volume,available_volume,frozen_volume) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE total_volume=VALUES(total_volume),available_volume=VALUES(available_volume),frozen_volume=VALUES(frozen_volume)`,[auth.workspace_id,c.id,f.id,total,available,frozen]);return {ok:true};
  });
  async function copyIntoRun(db,auth,scope,customerPublicIds){
    if(!Array.isArray(customerPublicIds)||customerPublicIds.length>100||new Set(customerPublicIds).size!==customerPublicIds.length||customerPublicIds.some(v=>typeof v!=='string'||!/^[-a-f0-9]{36}$/i.test(v)))fail('请选择最多 100 位客户');
    if(!customerPublicIds.length)return {copied:0};
    const [customers]=await db.execute(`SELECT * FROM catalog_customers WHERE workspace_id=? AND public_id IN (${placeholders(customerPublicIds)}) ORDER BY id FOR UPDATE`,[auth.workspace_id,...customerPublicIds]);
    if(customers.length!==customerPublicIds.length)fail('所选客户不属于当前账户','RECORD_NOT_FOUND',404);
    const [already]=await db.execute(`SELECT source_customer_id FROM catalog_run_customers WHERE workspace_id=? AND chat_id=? AND run_id=? AND source_customer_id IN (${placeholders(customers)})`,[scope.workspace_id,scope.chat_id,scope.run_id,...customers.map(c=>c.id)]);
    if(already.length)fail('所选客户已经加入当前测试','ALREADY_IMPORTED',409);
    const [funds]=await db.execute('SELECT id,fund_code,fund_name,share_class,nav FROM catalog_funds WHERE workspace_id=? ORDER BY id LIMIT 501',[auth.workspace_id]);
    if(funds.length>500)fail('单次测试最多配置 500 只基金');
    const keys=[scope.workspace_id,scope.chat_id,scope.run_id],lifecycle={open:true},store=createRunStore(db,scope,lifecycle);
    try{
      for(const f of funds)await db.execute(`INSERT IGNORE INTO run_funds(workspace_id,chat_id,run_id,fund_code,fund_name,share_class,nav,parameters_json) VALUES (?,?,?,?,?,?,?,'{}')`,[...keys,f.fund_code,f.fund_name,f.share_class,f.nav]);
      for(const c of customers){
        const certificate=c.certificate_type==='0'?syntheticCertificate():`T${crypto.randomBytes(18).toString('hex').toUpperCase()}`;
        const copied=await store.createCustomer({investorName:c.investor_name,investorType:c.investor_type,certificateType:c.certificate_type,certificateNo:certificate,simulatedBalance:c.simulated_balance,profile:c.profile_json});
        const trading=await store.createTradingAccount(copied.publicId,{branchCode:c.branch_code});
        const [positions]=await db.execute(`SELECT p.total_volume,p.available_volume,p.frozen_volume,f.fund_code,f.share_class FROM catalog_positions p JOIN catalog_funds f ON f.workspace_id=p.workspace_id AND f.id=p.fund_id WHERE p.workspace_id=? AND p.customer_id=? ORDER BY p.id`,[auth.workspace_id,c.id]);
        for(const p of positions)await db.execute(`INSERT INTO target_positions(workspace_id,chat_id,run_id,customer_id,trading_account_id,fund_code,share_class,target_volume) VALUES (?,?,?,?,?,?,?,?)`,[...keys,copied.id,trading.id,p.fund_code,p.share_class,p.total_volume]);
        await db.execute('INSERT INTO catalog_run_customers(workspace_id,chat_id,run_id,customer_id,source_customer_id,snapshot_json) VALUES (?,?,?,?,?,?)',[...keys,copied.id,c.id,JSON.stringify({customer:c,positions})]);
      }
    }finally{lifecycle.open=false;}
    return {copied:customers.length};
  }
  const startChat=(token,input)=>inWorkspace(token,async(db,auth)=>{
    const b=payload(input);if(!/^\d{1,20}$/.test(String(b.channelId)))fail('请选择测试通道');
    await db.execute('SELECT id FROM workspaces WHERE id=? FOR UPDATE',[auth.workspace_id]);
    const [[open]]=await db.execute('SELECT chat_id FROM global_case_ledgers WHERE workspace_id=? AND ended_at IS NULL LIMIT 1',[auth.workspace_id]);
    if(open)fail('请先人工结束当前 Chat','CHAT_ALREADY_ACTIVE',409);
    const [[channel]]=await db.execute('SELECT ta_environment_id FROM exchange_channels WHERE workspace_id=? AND id=?',[auth.workspace_id,b.channelId]);if(!channel)fail('通道不存在','RECORD_NOT_FOUND',404);
    await db.execute('SELECT id FROM ta_environments WHERE id=? FOR UPDATE',[channel.ta_environment_id]);
    const ids=await createChatInWorkspace(db,auth,b),scope=await resolveRun(db,auth,ids),copied=await copyIntoRun(db,auth,scope,b.customerPublicIds??[]);return {...ids,...copied};
  });
  const importCustomers=(token,ids,input)=>inWorkspace(token,async(db,auth)=>{
    const b=payload(input),scope=await resolveRun(db,auth,ids);await assertWritableRun(db,auth,scope);
    await db.execute('SELECT id FROM ta_environments WHERE id=? FOR UPDATE',[scope.ta_environment_id]);
    const [[r]]=await db.execute('SELECT status FROM test_runs WHERE workspace_id=? AND chat_id=? AND id=? FOR UPDATE',[scope.workspace_id,scope.chat_id,scope.run_id]);
    if(scope.chat_status!=='ACTIVE'||!['DRAFT','ACTIVE'].includes(r.status))fail('当前测试只允许查看历史记录','RUN_LOCKED',409);
    return copyIntoRun(db,auth,scope,b.customerPublicIds??[]);
  });
  return {state,addCustomers,updateCustomer,addFund,addPosition,startChat,importCustomers};
}
