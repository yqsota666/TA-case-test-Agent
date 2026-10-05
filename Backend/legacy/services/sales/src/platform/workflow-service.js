import crypto from 'node:crypto';
import { authenticateSession, resolveRun, assertWritableRun, mapDatabaseError, scopeError } from './scope.js';
import { createRunStore } from './run-store.js';
import { createExchangeStore } from './exchange-store.js';
import { routeReturns,returnHistory } from './return-router.js';
import { FILE_DEFINITIONS, FIELD_REQUIREMENTS, TRANSACTION_BUSINESSES, encodeRecord } from '../../../../packages/platform-protocol/src/index.js';

export const fail = (message, code='INVALID_INPUT', status=400) => { throw scopeError(message,status,code); };
export const dateValue = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value||'') || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value) fail('业务日期无效');
  return value;
};
export const decimalValue=(value,scale=2)=>{
  if (typeof value!=='string' || !new RegExp(`^\\d{1,${16-scale}}(?:\\.\\d{1,${scale}})?$`).test(value)) fail('金额或份额格式无效，请保留精确的小数字符串');
  return value;
};
const cleanObject = input => {
  if (!input || typeof input!=='object' || Array.isArray(input)) fail('数据格式无效');
  if (Object.keys(input).some(k=>/^(workspace|chat|run|owner|taEnvironment|ta_code|distributor_code)/i.test(k))) fail('不能指定数据归属','SCOPE_OVERRIDE');
  return input;
};
const json = value => JSON.stringify(value);
const dateString = value => value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
export const metadata={ fields:{'01':FILE_DEFINITIONS['01'],'03':FILE_DEFINITIONS['03']},requirements:FIELD_REQUIREMENTS, businesses:TRANSACTION_BUSINESSES,
  accountBusinesses:{'001':'开户','002':'销户','003':'账户资料修改','004':'账户冻结','005':'账户解冻','006':'交易账户挂失','007':'交易账户解挂','008':'新增交易账户','009':'撤销交易账户'} };

export function createWorkflowService({transaction,archiveRoot,authenticate=authenticateSession,onReturns,onDelivery}) {
  const inRun=async(token,ids,action,{write=false}={})=>{
    const lifecycle={open:true};
    try{return await transaction(async db=>{
      const auth=await authenticate(db,token),scope=await resolveRun(db,auth,ids);
      if(write){
        await assertWritableRun(db,auth,scope);
        await db.execute('SELECT id FROM ta_environments WHERE id=? FOR UPDATE',[scope.ta_environment_id]);
        const [[locked]]=await db.execute('SELECT status FROM test_runs WHERE workspace_id=? AND chat_id=? AND id=? FOR UPDATE',[scope.workspace_id,scope.chat_id,scope.run_id]);
        if(scope.chat_status!=='ACTIVE'||!['DRAFT','ACTIVE'].includes(locked.status)) fail('当前运行只允许查看历史记录','RUN_LOCKED',409);
      }
      const keys=[scope.workspace_id,scope.chat_id,scope.run_id];
      const query=async(sql,params=[])=>{const [r]=await db.execute(sql,[...keys,...params]);return r;};
      return action({db,auth,scope,keys,query,store:createRunStore(db,scope,lifecycle),exchange:createExchangeStore({db,scope,auth,archiveRoot})});
    });}catch(e){throw mapDatabaseError(e);}finally{lifecycle.open=false;}
  };
  async function list(token){return transaction(async db=>{
    const auth=await authenticate(db,token);
    const [chats]=await db.execute(`SELECT c.public_id,c.title,c.status,c.created_at,r.public_id AS run_public_id,r.run_number,r.business_date,r.status AS run_status
      FROM test_chats c JOIN test_runs r ON r.workspace_id=c.workspace_id AND r.chat_id=c.id
      WHERE c.workspace_id=? ORDER BY c.id DESC,r.run_number DESC LIMIT 500`,[auth.workspace_id]);
    const [channels]=await db.execute('SELECT id,ta_code,distributor_code FROM exchange_channels WHERE workspace_id=?',[auth.workspace_id]);
    return {chats,channels};
  });}
  async function state(token,ids,{customerAfter='0',applicationAfter='0',confirmationBefore='18446744073709551615',search=''}={}){
    if(typeof confirmationBefore!=='string'||!/^\d{1,20}$/.test(confirmationBefore)||BigInt(confirmationBefore)>18446744073709551615n||typeof customerAfter!=='string'||typeof applicationAfter!=='string'||typeof search!=='string'||!/^\d{1,20}$/.test(customerAfter)||!/^\d{1,20}$/.test(applicationAfter)||BigInt(customerAfter)>18446744073709551615n||BigInt(applicationAfter)>18446744073709551615n||search.length>100) fail('分页参数无效');
    return inRun(token,ids,async({query,scope,db,keys,auth})=>{
      const [customers,applications,funds,targets,positions,confirmations,steps,packages,snapshots,reconciliations]=await Promise.all([
        query(`SELECT c.*,t.id AS trading_account_id,t.transaction_account_no,t.branch_code,t.status AS account_status,a.ta_account_no
          FROM test_customers c JOIN trading_accounts t ON t.workspace_id=c.workspace_id AND t.chat_id=c.chat_id AND t.run_id=c.run_id AND t.customer_id=c.id
          LEFT JOIN trading_account_links l ON l.workspace_id=t.workspace_id AND l.chat_id=t.chat_id AND l.run_id=t.run_id AND l.trading_account_id=t.id
          LEFT JOIN ta_accounts a ON a.workspace_id=l.workspace_id AND a.chat_id=l.chat_id AND a.run_id=l.run_id AND a.id=l.ta_account_id
          WHERE c.workspace_id=? AND c.chat_id=? AND c.run_id=? AND c.id>? AND (c.investor_name LIKE ? OR t.transaction_account_no LIKE ?) ORDER BY c.id LIMIT 101`,[customerAfter,`%${search}%`,`%${search}%`]),
        query(`SELECT a.*,c.investor_name FROM applications a JOIN test_customers c ON c.workspace_id=a.workspace_id AND c.chat_id=a.chat_id AND c.run_id=a.run_id AND c.id=a.customer_id
          WHERE a.workspace_id=? AND a.chat_id=? AND a.run_id=? AND a.id>? ORDER BY a.id LIMIT 101`,[applicationAfter]),
        query('SELECT * FROM run_funds WHERE workspace_id=? AND chat_id=? AND run_id=? ORDER BY fund_code LIMIT 200'),
        query('SELECT * FROM target_positions WHERE workspace_id=? AND chat_id=? AND run_id=? ORDER BY id LIMIT 500'),
        query('SELECT * FROM positions WHERE workspace_id=? AND chat_id=? AND run_id=? ORDER BY id LIMIT 500'),
        query(`SELECT c.*,a.app_no,a.file_type AS application_type,a.fund_code,t.investor_name,f.match_reason AS local_note FROM confirmations c
          JOIN file_records f ON f.workspace_id=c.workspace_id AND f.chat_id=c.chat_id AND f.run_id=c.run_id AND f.id=c.file_record_id
          JOIN applications a ON a.workspace_id=c.workspace_id AND a.chat_id=c.chat_id AND a.run_id=c.run_id AND a.id=c.application_id
          JOIN test_customers t ON t.workspace_id=a.workspace_id AND t.chat_id=a.chat_id AND t.run_id=a.run_id AND t.id=a.customer_id
          WHERE c.workspace_id=? AND c.chat_id=? AND c.run_id=? AND c.id<? ORDER BY c.id DESC LIMIT 101`,[confirmationBefore]),
        query(`SELECT s.*,a.id AS application_id,a.app_no,a.status AS application_status,c.investor_name FROM workflow_steps s
          LEFT JOIN applications a ON a.workspace_id=s.workspace_id AND a.chat_id=s.chat_id AND a.run_id=s.run_id AND a.step_id=s.id
          LEFT JOIN test_customers c ON c.workspace_id=a.workspace_id AND c.chat_id=a.chat_id AND c.run_id=a.run_id AND c.id=a.customer_id
          WHERE s.workspace_id=? AND s.chat_id=? AND s.run_id=? ORDER BY s.step_number LIMIT 500`),
        query(`SELECT p.public_id,p.direction,p.business_date,p.delivery_status,p.parse_status,p.created_at,
          (SELECT COUNT(*) FROM exchange_files f WHERE f.workspace_id=p.workspace_id AND f.package_id=p.id) AS file_count,
          (SELECT COUNT(*) FROM file_records f WHERE f.workspace_id=r.workspace_id AND f.chat_id=r.chat_id AND f.run_id=r.run_id AND f.package_id=p.id AND f.match_status<>'MATCHED') AS unmatched_count
          FROM package_runs r JOIN exchange_packages p ON p.workspace_id=r.workspace_id AND p.id=r.package_id
          WHERE r.workspace_id=? AND r.chat_id=? AND r.run_id=? ORDER BY p.id DESC LIMIT 500`),
        query('SELECT id,snapshot_date,fund_code,share_class,available_volume,total_volume,whole_flag,detail_flag FROM position_snapshots WHERE workspace_id=? AND chat_id=? AND run_id=? ORDER BY id DESC LIMIT 200'),
        query('SELECT * FROM reconciliations WHERE workspace_id=? AND chat_id=? AND run_id=? ORDER BY id DESC LIMIT 200')
      ]);
      const [[counts]]=await db.execute(`SELECT
        (SELECT COUNT(*) FROM test_customers WHERE workspace_id=? AND chat_id=? AND run_id=?) AS customers,
        (SELECT COUNT(*) FROM trading_accounts WHERE workspace_id=? AND chat_id=? AND run_id=? AND status='ACTIVE') AS opened,
        (SELECT COUNT(*) FROM run_funds WHERE workspace_id=? AND chat_id=? AND run_id=?) AS funds,
        (SELECT COALESCE(SUM(simulated_balance),0) FROM test_customers WHERE workspace_id=? AND chat_id=? AND run_id=?) AS balance,
        (SELECT COUNT(*) FROM applications WHERE workspace_id=? AND chat_id=? AND run_id=? AND status IN ('GENERATED','DELIVERED','WAITING_RETURN','PARTIAL')) AS waiting,
        (SELECT COUNT(*) FROM confirmations WHERE workspace_id=? AND chat_id=? AND run_id=? AND outcome='SUCCESS') AS success,
        (SELECT COUNT(*) FROM confirmations WHERE workspace_id=? AND chat_id=? AND run_id=? AND outcome='FAILURE') AS failure`,Array.from({length:7},()=>keys).flat());
      for(const name of ['customers','opened','funds','waiting','success','failure'])counts[name]=Number(counts[name]);
      const [messages]=await db.execute('SELECT id,author_role,content,created_at FROM chat_messages WHERE workspace_id=? AND chat_id=? ORDER BY id DESC LIMIT 200',keys.slice(0,2));
      const artifacts=await query(`SELECT DISTINCT f.application_id,p.public_id AS package_id FROM file_records f
        JOIN exchange_packages p ON p.workspace_id=f.workspace_id AND p.id=f.package_id AND p.direction='OUTBOUND'
        WHERE f.workspace_id=? AND f.chat_id=? AND f.run_id=? AND f.application_id IS NOT NULL ORDER BY f.application_id LIMIT 1000`);
      return {scope:{businessDate:dateString(scope.business_date),taCode:scope.ta_code,distributorCode:scope.distributor_code,status:scope.status},counts,
        customers:customers.slice(0,100),customerMore:customers.length>100,applications:applications.slice(0,100),applicationMore:applications.length>100,
        funds,targets,positions,confirmations:confirmations.slice(0,100),confirmationMore:confirmations.length>100,steps,packages,artifacts,messages:messages.reverse(),snapshots,reconciliations,
        returnInbox:await returnHistory(db,auth)};
    });
  }
  async function addCustomers(token,ids,input){return inRun(token,ids,async({store})=>{
    const b=cleanObject(input),count=b.count??1;
    if(!Number.isInteger(count)||count<1||count>100) fail('一次可新增 1–100 位模拟客户');
    if(typeof b.investorName!=='string'||!b.investorName.trim()||b.investorName.length>180)fail('请填写有效的客户姓名或批量名称前缀');
    try{encodeRecord('01',{InvestorName:count===1?b.investorName:`${b.investorName} ${count}`},'22');}catch{fail('姓名超过协议允许的 200 个 GB18030 字节，请缩短姓名');}
    const created=[];
    for(let i=0;i<count;i++){
      const c=await store.createCustomer({investorName:count===1?b.investorName:`${b.investorName} ${i+1}`,investorType:b.investorType??'1',
        certificateType:b.certificateType??'0',certificateNo:b.certificateNo||syntheticCertificate(),simulatedBalance:decimalValue(b.simulatedBalance??'100000.00'),profile:cleanObject(b.profile??{})});
      const t=await store.createTradingAccount(c.publicId,{branchCode:b.branchCode||'305'});created.push({...c,...t});
    }return {created};
  },{write:true});}
  async function addFund(token,ids,input){return inRun(token,ids,async({db,keys})=>{
    const b=cleanObject(input);
    if(!/^\d{6}$/.test(b.fundCode||'')||!/^\w$/.test(b.shareClass||'0')||!b.fundName?.trim()||b.fundName.length>200) fail('请填写六位基金代码、基金名称和一位份额类别');
    await db.execute(`INSERT INTO run_funds(workspace_id,chat_id,run_id,fund_code,fund_name,share_class,nav,parameters_json) VALUES (?,?,?,?,?,?,?,'{}')
      ON DUPLICATE KEY UPDATE fund_name=VALUES(fund_name),nav=VALUES(nav)`,[...keys,b.fundCode,b.fundName.trim(),b.shareClass||'0',b.nav?decimalValue(b.nav,8):null]);return {ok:true};
  },{write:true});}
  const defineCustomer=(token,ids,input)=>inRun(token,ids,async({store})=>{
    const b=cleanObject(input);
    try{encodeRecord('01',{...(b.profile??{}),InvestorName:b.investorName},'22');}catch(e){fail('客户协议资料不合法：'+e.message,'INVALID_PROTOCOL_FIELD');}
    return store.createCustomer({...b,certificateType:'0',certificateNo:syntheticCertificate()});
  },{write:true});
  const defineAccount=(token,ids,customerPublicId,input)=>inRun(token,ids,({store})=>store.createTradingAccount(customerPublicId,cleanObject(input)),{write:true});
  async function addTarget(token,ids,input){return inRun(token,ids,async({query,db,keys})=>{
    const b=cleanObject(input),[t]=await query('SELECT id,customer_id FROM trading_accounts WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=?',[b.tradingAccountId]);
    if(!t) fail('交易账户不属于当前 chat','RECORD_NOT_FOUND',404);
    const [fund]=await query('SELECT id FROM run_funds WHERE workspace_id=? AND chat_id=? AND run_id=? AND fund_code=? AND share_class=?',[b.fundCode,b.shareClass??'0']);
    if(!fund) fail('请先配置当前 chat 的基金');
    await db.execute('INSERT INTO target_positions(workspace_id,chat_id,run_id,customer_id,trading_account_id,fund_code,share_class,target_volume) VALUES (?,?,?,?,?,?,?,?)',
      [...keys,t.customer_id,t.id,b.fundCode,b.shareClass??'0',decimalValue(b.targetVolume)]);return {ok:true};
  },{write:true});}
  async function message(token,ids,input){return inRun(token,ids,async({db,keys})=>{
    const b=cleanObject(input);if(typeof b.content!=='string'||!b.content.trim()||b.content.length>10000) fail('请输入 1–10000 字的讨论内容');
    await db.execute("INSERT INTO chat_messages(workspace_id,chat_id,author_role,content) VALUES (?,?,'USER',?)",[...keys.slice(0,2),b.content.trim()]);return {ok:true};
  },{write:true});}
  async function addStep(token,ids,input){return inRun(token,ids,async({db,keys,query})=>{
    const b=cleanObject(input),type=b.fileType??'CHECK',date=dateValue(b.businessDate);
    if(!['01','03','CHECK'].includes(type)||!['NORMAL','NEGATIVE'].includes(b.testMode??'NORMAL'))fail('动作类型无效');
    if(type!=='CHECK'){
      if(type==='01'?!metadata.accountBusinesses[b.businessCode]:!TRANSACTION_BUSINESSES[b.businessCode])fail('业务类型不支持');
      const [account]=await query('SELECT id FROM trading_accounts WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=?',[b.tradingAccountId??'0']);
      if(!account)fail('交易账户不属于当前测试','RECORD_NOT_FOUND',404);
      if(type==='03'&&b.fundCode){const [f]=await query('SELECT id FROM run_funds WHERE workspace_id=? AND chat_id=? AND run_id=? AND fund_code=? AND share_class=?',[b.fundCode,b.shareClass??'0']);if(!f)fail('基金未配置在当前测试');}
    }
    const title=b.title||(type==='CHECK'?'人工核对':type==='01'?metadata.accountBusinesses[b.businessCode]:TRANSACTION_BUSINESSES[b.businessCode].name);
    if(typeof title!=='string'||!title.trim()||title.length>160||typeof (b.note??'')!=='string'||(b.note??'').length>1000)fail('动作名称或备注无效');
    const [[last]]=await db.execute('SELECT COALESCE(MAX(step_number),0)+1 AS n FROM workflow_steps WHERE workspace_id=? AND chat_id=? AND run_id=?',keys);if(last.n>500)fail('一个测试最多添加 500 个动作');
    const draft=type==='CHECK'?null:{fileType:type,businessCode:b.businessCode,businessDate:date,tradingAccountId:String(b.tradingAccountId),testMode:b.testMode??'NORMAL',fundCode:b.fundCode??'',shareClass:b.shareClass??'0',amount:decimalValue(b.amount??'1000.00'),volume:decimalValue(b.volume??'100.00')};
    const [r]=await db.execute(`INSERT INTO workflow_steps(workspace_id,chat_id,run_id,step_number,step_type,title,business_date,expected_result) VALUES (?,?,?,?,?,?,?,?)`,[...keys,last.n,type,title.trim(),date,json({source:'MANUAL',note:b.note??'',draft})]);
    return {id:String(r.insertId)};
  },{write:true});}
  async function checkStep(token,ids,stepId,input){return inRun(token,ids,async({db,keys,query})=>{
    const b=cleanObject(input),[s]=await query('SELECT step_type,expected_result FROM workflow_steps WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=? FOR UPDATE',[stepId]);
    if(!s||s.step_type!=='CHECK')fail('人工核对动作不存在','RECORD_NOT_FOUND',404);
    if(typeof b.done!=='boolean'||typeof(b.note??'')!=='string'||(b.note??'').length>1000)fail('核对结果无效');
    await db.execute('UPDATE workflow_steps SET status=?,expected_result=? WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=?',[b.done?'PASSED':'PENDING',json({...s.expected_result,checkNote:b.note??''}),...keys,stepId]);return {ok:true};
  },{write:true});}
  async function createApplication(token,ids,input){return inRun(token,ids,async({db,keys,query,store,scope})=>{
    const b=cleanObject(input),date=dateValue(b.businessDate),mode=b.testMode??'NORMAL';
    if(!(['01','03'].includes(b.fileType)) || (b.fileType==='01'?!metadata.accountBusinesses[b.businessCode]:!TRANSACTION_BUSINESSES[b.businessCode])) fail('业务类型不支持');
    let planned;
    if(b.workflowStepId){
      [planned]=await query('SELECT * FROM workflow_steps WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=? FOR UPDATE',[b.workflowStepId]);
      if(!planned)fail('动作不属于当前测试','RECORD_NOT_FOUND',404);
      if(planned.status!=='PENDING'||planned.step_type!==b.fileType||dateString(planned.business_date)!==date)fail('动作已执行或与申请不一致','STEP_CONFLICT',409);
      const draft=planned.expected_result?.draft;if(draft&&(draft.businessCode!==b.businessCode||draft.testMode!==mode||String(draft.tradingAccountId)!==String(b.tradingAccountId)))fail('申请与计划的业务、客户或模式不一致','STEP_CONFLICT',409);
    }
    const [t]=await query(`SELECT t.*,a.ta_account_no,c.profile_json,c.certificate_no FROM trading_accounts t
      JOIN test_customers c ON c.workspace_id=t.workspace_id AND c.chat_id=t.chat_id AND c.run_id=t.run_id AND c.id=t.customer_id
      LEFT JOIN trading_account_links l ON l.workspace_id=t.workspace_id AND l.chat_id=t.chat_id AND l.run_id=t.run_id AND l.trading_account_id=t.id
      LEFT JOIN ta_accounts a ON a.workspace_id=l.workspace_id AND a.chat_id=l.chat_id AND a.run_id=l.run_id AND a.id=l.ta_account_id
      WHERE t.workspace_id=? AND t.chat_id=? AND t.run_id=? AND t.id=?`,[b.tradingAccountId]);
    if(!t) fail('交易账户不属于当前 chat','RECORD_NOT_FOUND',404);
    if(mode==='NORMAL' && (b.fileType==='03'||b.businessCode!=='001')){
      if(!t.ta_account_no)fail('请先生成 01 开户并上传成功的 02 回传；失败场景请明确选择负向测试','ACCOUNT_NOT_CONFIRMED',409);
      const expected=b.fileType==='01'?({'005':'FROZEN','007':'LOST'}[b.businessCode]||'ACTIVE'):'ACTIVE';
      if(t.status!==expected)fail(`当前账户状态不允许此操作，需要 ${expected} 状态`,'ACCOUNT_STATUS',409);
    }
    const fields={...(b.fileType==='01'?t.profile_json:{}),...(b.fields??{})};
    if(b.fileType==='03'&&fields.FundCode){
      const [fund]=await query('SELECT id FROM run_funds WHERE workspace_id=? AND chat_id=? AND run_id=? AND fund_code=? AND share_class=?',[fields.FundCode,fields.ShareClass??'0']);
      if(!fund) fail('基金未配置在当前 chat');
    }
    if(mode==='NORMAL'&&['024','026','031','032','036'].includes(b.businessCode)){
      const [p]=await query('SELECT available_volume,frozen_volume FROM positions WHERE workspace_id=? AND chat_id=? AND run_id=? AND trading_account_id=? AND fund_code=? AND share_class=? AND branch_code=?',
        [t.id,fields.FundCode,fields.ShareClass??'0',t.branch_code]);
      const available=b.businessCode==='032'?p?.frozen_volume:p?.available_volume;
      if(!available || units(available)<units(b.applicationVolume??'0')) fail('当前 TA 确认份额不足；模拟目标份额不能用于正常赎回','INSUFFICIENT_CONFIRMED_POSITION',409);
    }
    const result=await store.createApplication({...b,fields});
    const [a]=await query('SELECT record_json FROM applications WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=?',[result.id]);
    const required=new Set([...(FIELD_REQUIREMENTS[b.fileType].required??[]),...(FIELD_REQUIREMENTS[b.fileType].requiredByBusiness?.[b.businessCode]??[])]);
    if(mode==='NEGATIVE') required.delete('TAAccountID');
    const missing=[...required].filter(name=>a.record_json[name]==null||String(a.record_json[name]).trim()==='');
    if(missing.length) fail(`必填字段缺失：${missing.join('、')}`,'MISSING_FIELDS');
    try{encodeRecord(b.fileType,a.record_json,'22');}catch(e){fail(`协议字段校验失败：${e.message}`,'INVALID_PROTOCOL_FIELD');}
    let stepId=planned?.id;
    if(planned)await db.execute("UPDATE workflow_steps SET status='READY' WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=?",[...keys,stepId]);
    else{
      const [[last]]=await db.execute('SELECT COALESCE(MAX(step_number),0)+1 AS n FROM workflow_steps WHERE workspace_id=? AND chat_id=? AND run_id=?',keys);
      const [step]=await db.execute(`INSERT INTO workflow_steps(workspace_id,chat_id,run_id,step_number,step_type,title,business_date,status,expected_result) VALUES (?,?,?,?,?,?,?,'READY',?)`,[...keys,last.n,b.fileType,`${b.businessCode} ${b.fileType==='01'?metadata.accountBusinesses[b.businessCode]:TRANSACTION_BUSINESSES[b.businessCode].name}`,date,json(b.expectedResult??{})]);stepId=step.insertId;
    }
    await db.execute("UPDATE applications SET step_id=?,status='READY' WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=?",[stepId,...keys,result.id]);
    await db.execute("UPDATE test_runs SET status='ACTIVE' WHERE workspace_id=? AND chat_id=? AND id=?",keys);
    return result;
  },{write:true});}
  const generate=(token,ids,input)=>inRun(token,ids,({exchange})=>exchange.generate(cleanObject(input)),{write:true});
  const deliver=(token,ids,packageId,input)=>inRun(token,ids,async({exchange,db,auth,scope})=>{
    const result=await exchange.deliver(packageId,cleanObject(input));
    if(onDelivery)await onDelivery({db,auth,scope,packageId});
    return result;
  },{write:true});
  const upload=async(token,ids,input)=>{
    try{return await transaction(async db=>{
      const auth=await authenticate(db,token);
      await db.execute('SELECT id FROM workspaces WHERE id=? FOR UPDATE',[auth.workspace_id]);
      // The legacy scoped URL remains compatible, but its selected chat is never a routing input.
      if(ids)await resolveRun(db,auth,ids);
      const result=await routeReturns({db,auth,input:cleanObject(input)});
      if(onReturns)await onReturns({db,auth,result});
      return result;
    });}catch(e){throw mapDatabaseError(e);}
  };
  const download=(token,ids,packageId)=>inRun(token,ids,({exchange})=>exchange.download(packageId));
  const inspect=(token,ids,packageId)=>inRun(token,ids,({exchange})=>exchange.inspect(packageId));
  return {list,state,addCustomers,addFund,defineCustomer,defineAccount,addTarget,message,addStep,checkStep,createApplication,generate,deliver,upload,download,inspect};
}
export const units=value=>{const s=String(value??'0');if(!/^-?\d+(\.\d{1,2})?$/.test(s)) fail('金额或份额格式错误');const sign=s.startsWith('-')?-1n:1n;const [a,b='']=s.replace('-','').split('.');return sign*BigInt(a+b.padEnd(2,'0'));};
export const fromUnits=n=>`${n<0n?'-':''}${(n<0n?-n:n)/100n}.${String((n<0n?-n:n)%100n).padStart(2,'0')}`;
export function syntheticCertificate(){
  const base=`11010119900101${String(crypto.randomInt(1,999)).padStart(3,'0')}`;
  // Identity uniqueness is enforced globally by the database, not by this generator.
  // Randomize the valid birth date and sequence to avoid a small fixed namespace.
  const year=1960+crypto.randomInt(60),month=String(1+crypto.randomInt(12)).padStart(2,'0'),day=String(1+crypto.randomInt(28)).padStart(2,'0');
  const first=base.slice(0,6)+year+month+day+base.slice(-3),weights=[7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2],checks='10X98765432';
  return first+checks[[...first].reduce((s,d,i)=>s+Number(d)*weights[i],0)%11];
}
