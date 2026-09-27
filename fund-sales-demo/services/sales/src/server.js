import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import {
  buildDataFile, buildIndexFile, dataFileName, indexFileName, parseDataFile, parseIndexFile,
  inspectDataFile, inspectIndexFile, normalizeExchangeFile, RETURN_CODES, FILE_DEFINITIONS, FIELD_REQUIREMENTS,
  TRANSACTION_BUSINESSES
} from '@fund-demo/protocol';
import { ExchangeTransport } from '@fund-demo/transport';
import { ArtifactStorage } from '@fund-demo/storage';
import { all, one, pool, transaction, waitForDb } from './db.js';

const app = express();
app.use(cors()); app.use(express.json({ limit: '2mb' }));
const transport = new ExchangeTransport();
const artifactStorage = new ArtifactStorage();
const ORG = process.env.ORG_CODE || '305';
const TA = process.env.TA_CODE || '27';
const directionOut = 'sales-to-ta';
const directionIn = 'ta-to-sales';
const SELF_API = process.env.SELF_API_URL || 'http://127.0.0.1:8081/api';
const TA_API = process.env.TA_API_URL || 'http://ta-service:8082/api';
const findIndexEntry = files => Object.entries(files).find(([,buffer]) => buffer.subarray(0,8).toString('ascii') === 'OFDCFIDX');
const ACCOUNT_BUSINESSES = {
  '001':'开户','002':'销户','003':'账户信息修改','004':'基金账户冻结',
  '005':'基金账户解冻','006':'账户卡挂失','007':'账户卡解挂',
  '008':'增加交易账户','009':'撤销交易账户'
};
const PROFILE_FIELDS=['address','mobile','email','cert_valid_date','bank_name','bank_no','bank_code','risk_level'];
const jsonValue=value=>typeof value==='string'?JSON.parse(value||'{}'):(value||{});
const DEMO_CUSTOMERS=[
  {name:'张晨',certificateNo:'110101199001011237',mobile:'13800001001',email:'zhangchen@example.com',address:'北京市东城区建国门内大街 1 号',birthday:'19900101',sex:'1',riskLevel:'1',regionCode:'1101',bankName:'中国工商银行',bankNo:'622202100000000001',bankCode:'102',balance:50000},
  {name:'李雨桐',certificateNo:'310101198805122461',mobile:'13800001002',email:'liyutong@example.com',address:'上海市黄浦区中山东一路 18 号',birthday:'19880512',sex:'0',riskLevel:'2',regionCode:'3101',bankName:'中国建设银行',bankNo:'621700100000000002',bankCode:'105',balance:120000},
  {name:'王浩然',certificateNo:'440106199507233572',mobile:'13800001003',email:'wanghaoran@example.com',address:'广州市天河区珠江新城 8 号',birthday:'19950723',sex:'1',riskLevel:'3',regionCode:'4401',bankName:'中国农业银行',bankNo:'622848100000000003',bankCode:'103',balance:300000},
  {name:'陈思琪',certificateNo:'330106198212084688',mobile:'13800001004',email:'chensiqi@example.com',address:'杭州市西湖区文三路 90 号',birthday:'19821208',sex:'0',riskLevel:'4',regionCode:'3301',bankName:'招商银行',bankNo:'622588100000000004',bankCode:'308',balance:800000},
  {name:'赵子轩',certificateNo:'510107199911305798',mobile:'13800001005',email:'zhaozixuan@example.com',address:'成都市武侯区人民南路 4 段',birthday:'19991130',sex:'1',riskLevel:'5',regionCode:'5101',bankName:'中国银行',bankNo:'621661100000000005',bankCode:'104',balance:1500000},
  {name:'周静怡',certificateNo:'420106197606186801',mobile:'13800001006',email:'zhoujingyi@example.com',address:'武汉市武昌区中北路 66 号',birthday:'19760618',sex:'0',riskLevel:'2',regionCode:'4201',bankName:'交通银行',bankNo:'622260100000000006',bankCode:'301',balance:200000},
  {name:'吴嘉诚',certificateNo:'320102199303157915',mobile:'13800001007',email:'wujiache@example.com',address:'南京市玄武区中山路 100 号',birthday:'19930315',sex:'1',riskLevel:'4',regionCode:'3201',bankName:'中信银行',bankNo:'622690100000000007',bankCode:'302',balance:600000},
  {name:'郑欣妍',certificateNo:'440305198711098021',mobile:'13800001008',email:'zhengxinyan@example.com',address:'深圳市南山区科技园科苑路 15 号',birthday:'19871109',sex:'0',riskLevel:'3',regionCode:'4403',bankName:'平安银行',bankNo:'622298100000000008',bankCode:'307',balance:450000}
];

const compactDate = (date) => date.replaceAll('-', '');
const addDays = (yyyymmdd, days) => {
  const d = new Date(`${yyyymmdd.slice(0,4)}-${yyyymmdd.slice(4,6)}-${yyyymmdd.slice(6,8)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0,10).replaceAll('-', '');
};
const state = () => one('SELECT * FROM simulation_state WHERE id=1');
const sequence = async (prefix) => {
  const s = await state(); const [row] = await all('SELECT COUNT(*) n FROM customers');
  return `${prefix}${s.business_date}${String(Number(row?.n || 0) + Math.floor(Math.random()*9000)+1).padStart(8,'0')}`.slice(0,24);
};
const nextBatch = async (direction) => {
  const s = await state(); const row = await one('SELECT COUNT(*) n FROM batches WHERE scenario_id=? AND direction=? AND business_date=?', [s.scenario_id, direction, s.business_date]);
  return `BATCH${String(Number(row.n) + 1).padStart(4, '0')}`;
};
const sendFile = async (fileType, records, links = []) => {
  const s = await state(); const batchId = await nextBatch(directionOut);
  const dataName = dataFileName({ creator: ORG, receiver: TA, date: s.business_date, fileType });
  const indexName = indexFileName({ creator: ORG, receiver: TA, date: s.business_date, fileType });
  const data = buildDataFile({ creator: ORG, receiver: TA, date: s.business_date, summaryNo: Number(batchId.slice(5)), fileType, records });
  const index = buildIndexFile({ creator: ORG, receiver: TA, date: s.business_date, fileNames: [dataName] });
  const files = { [dataName]: data, [indexName]: index };
  const relative = await transport.putBatch(directionOut, s.scenario_id, s.business_date, batchId, files);
  const storage = await artifactStorage.putBatch(relative, files);
  const [inserted] = await pool.query('INSERT INTO batches(scenario_id,batch_id,direction,file_type,business_date,relative_path,status,record_count) VALUES (?,?,?,?,?,?,?,?)', [s.scenario_id,batchId,directionOut,fileType,s.business_date,relative,'SENT',records.length]);
  for (let i=0;i<links.length;i+=1) await pool.query('INSERT INTO batch_records(batch_db_id,file_type,business_type,business_id,app_no,record_index) VALUES (?,?,?,?,?,?)',[inserted.insertId,fileType,links[i].businessType,links[i].businessId,records[i]?.AppSheetSerialNo||links[i].appNo||null,i+1]);
  return { batchId, relative, dataName, indexName, recordCount: records.length, storage };
};
const sendPackage = async entries => {
  const s=await state(),batchId=await nextBatch(directionOut),summaryNo=Number(batchId.slice(5));
  const files={},fileNames=[];
  for(const entry of entries){
    const dataName=dataFileName({creator:ORG,receiver:TA,date:s.business_date,fileType:entry.fileType});
    files[dataName]=buildDataFile({creator:ORG,receiver:TA,date:s.business_date,summaryNo,fileType:entry.fileType,records:entry.records});
    fileNames.push(dataName);entry.dataName=dataName;
  }
  const indexName=indexFileName({creator:ORG,receiver:TA,date:s.business_date,fileType:entries[0].fileType});
  files[indexName]=buildIndexFile({creator:ORG,receiver:TA,date:s.business_date,fileNames});
  const relative=await transport.putBatch(directionOut,s.scenario_id,s.business_date,batchId,files);
  const storage=await artifactStorage.putBatch(relative,files);
  for(const entry of entries){
    const [inserted]=await pool.query('INSERT INTO batches(scenario_id,batch_id,direction,file_type,business_date,relative_path,status,record_count) VALUES (?,?,?,?,?,?,?,?)',[s.scenario_id,batchId,directionOut,entry.fileType,s.business_date,relative,'SENT',entry.records.length]);
    for(let i=0;i<(entry.links||[]).length;i+=1){const link=entry.links[i];await pool.query('INSERT INTO batch_records(batch_db_id,file_type,business_type,business_id,app_no,record_index) VALUES (?,?,?,?,?,?)',[inserted.insertId,entry.fileType,link.businessType,link.businessId,entry.records[i]?.AppSheetSerialNo||link.appNo||null,i+1]);}
  }
  return{batchId,relative,indexName,fileCount:entries.length,recordCount:entries.reduce((sum,entry)=>sum+entry.records.length,0),files:entries.map(entry=>({fileType:entry.fileType,dataName:entry.dataName,recordCount:entry.records.length})),storage};
};

const findBusinessIdByProtocolAppNo=async(fileType,appNo,businessCode)=>{
  const isAccount=fileType==='02'&&/^10[1-9]$/.test(businessCode||'');
  const businessType=isAccount?'accountApp':'order',sourceType=fileType==='02'?'01':'03';
  const direct=await one(isAccount?'SELECT id FROM account_applications WHERE app_no=?':'SELECT id FROM orders WHERE app_no=?',[appNo]);
  if(direct)return direct.id;
  const link=await one('SELECT business_id FROM batch_records WHERE file_type=? AND business_type=? AND app_no=? ORDER BY id DESC LIMIT 1',[sourceType,businessType,appNo]);
  return link?.business_id||null;
};

const requirementFor=(fileType,name,businessCode)=>{const rules=FIELD_REQUIREMENTS[fileType]||{};const required=[...(rules.required||[]),...(rules.requiredByBusiness?.[businessCode]||[])];if(required.includes(name))return{level:'required',label:'必填'};if(rules.conditional?.[name])return{level:'conditional',label:'条件必填',condition:rules.conditional[name]};return{level:'optional',label:'选填'};};
const validateEditedRecords=(fileType,records)=>{const fields=FILE_DEFINITIONS[fileType];for(const [index,record] of records.entries()){for(const field of fields){const rule=requirementFor(fileType,field.name,record.BusinessCode);if(rule.level==='required'&&(record[field.name]===null||record[field.name]===undefined||String(record[field.name]).trim()===''))throw new Error(`第 ${index+1} 条记录：${field.name} 为必填字段`);}}buildDataFile({creator:ORG,receiver:TA,date:'20000101',fileType,records});};

const AUTOMATION_STEPS=[
  {id:'seal',label:'申请封批',status:'waiting'},
  {id:'receive',label:'TA 接收',status:'waiting'},
  {id:'advance',label:'切换业务日',status:'waiting'},
  {id:'process',label:'TA 处理',status:'waiting'},
  {id:'confirm',label:'确认封批',status:'waiting'},
  {id:'writeback',label:'销售回写',status:'waiting'}
];
const postApi=async(base,path,body={})=>{const response=await fetch(`${base}${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(data.error||`${path} 请求失败（${response.status}）`);error.status=response.status;throw error;}return data;};
const automationRun=async id=>{const row=await one('SELECT * FROM automation_runs WHERE id=?',[id]);if(!row)return null;return{...row,steps:jsonValue(row.steps_json),result:jsonValue(row.result_json)};};
const markAutomationStep=async(id,stepId,status,detail)=>{const current=await automationRun(id),steps=current.steps.map(step=>step.id===stepId?{...step,status,detail:detail||null}:step);await pool.query('UPDATE automation_runs SET steps_json=? WHERE id=?',[JSON.stringify(steps),id]);};
const executeAutomation=async(id,{has01,has03,files})=>{
  const perform=async(stepId,action)=>{await markAutomationStep(id,stepId,'running');try{const result=await action();await markAutomationStep(id,stepId,'succeeded');return result}catch(error){await markAutomationStep(id,stepId,'failed',error.message);throw error;}};
  try{
    const result={};
    result.applicationBatch=await perform('seal',()=>postApi(SELF_API,'/batches/T',{files}));
    result.received=await perform('receive',async()=>{const items=[];if(has01)items.push(await postApi(TA_API,'/inbox/01'));if(has03)items.push(await postApi(TA_API,'/inbox/03'));return items;});
    result.businessDate=await perform('advance',()=>Promise.all([postApi(SELF_API,'/time/advance',{days:1}),postApi(TA_API,'/time/advance',{days:1})]));
    result.processed=await perform('process',async()=>{const items=[];if(has01)items.push(await postApi(TA_API,'/process/01'));if(has03)items.push(await postApi(TA_API,'/process/03'));return items;});
    result.confirmationBatch=await perform('confirm',()=>postApi(TA_API,'/batches/T1'));
    result.writeback=await perform('writeback',async()=>{const items=[];if(has01)items.push(await postApi(SELF_API,'/inbox/02'));if(has03)items.push(await postApi(SELF_API,'/inbox/04'));items.push(await postApi(SELF_API,'/inbox/05'));return items;});
    await pool.query("UPDATE automation_runs SET status='succeeded',result_json=?,finished_at=CURRENT_TIMESTAMP WHERE id=?",[JSON.stringify(result),id]);
  }catch(error){console.error(`automation run ${id} failed`,error);await pool.query("UPDATE automation_runs SET status='failed',error_detail=?,finished_at=CURRENT_TIMESTAMP WHERE id=?",[error.message,id]);}
};

async function pendingPreview(fileType){
  const s=await state();let rows,records,links;
  if(fileType==='01'){
    const time=new Date().toTimeString().slice(0,8).replaceAll(':','');
    const apps=await all("SELECT a.id application_id,a.app_no,a.business_code,a.business_date,a.transaction_account_id application_transaction_account_id,a.payload,c.* FROM account_applications a JOIN customers c ON c.id=a.customer_id WHERE a.status='PENDING' ORDER BY a.created_at");
    const toRecord=a=>{const payload=typeof a.payload==='string'?JSON.parse(a.payload||'{}'):(a.payload||{}),profile={...a,...payload};return {Address:profile.address,AppSheetSerialNo:a.app_no,CertificateType:'0',CertificateNo:a.certificate_no,InvestorName:a.name,TransactionDate:a.business_date,TransactionTime:time,IndividualOrInstitution:'1',PostCode:'510000',TransactionAccountID:a.application_transaction_account_id,DistributorCode:ORG,BusinessCode:a.business_code,InvestorsBirthday:a.birthday,DepositAcct:profile.bank_no,RegionCode:a.region_code,EmailAddress:profile.email,VocationCode:a.vocation_code,AnnualIncome:a.annual_income,MobileTelNo:profile.mobile,BranchCode:ORG,Sex:a.sex,TAAccountID:a.business_code==='001'?null:a.ta_account_id,TradingMethod:'10010000',MultiAcctFlag:'0',AcctNameOfInvestorInClearingAgency:profile.bank_name,AcctNoOfInvestorInClearingAgency:profile.bank_no,ClearingAgency:profile.bank_code,Nationality:a.nationality,CertValidDate:profile.cert_valid_date,ClientRiskRate:profile.risk_level,AcceptMethod:'1',IPAddress:'127.0.0.1'};};
    records=apps.map(toRecord);
    links=apps.map(a=>({businessType:'accountApp',businessId:a.application_id,appNo:a.app_no,label:`${a.name} · ${a.business_code} ${ACCOUNT_BUSINESSES[a.business_code]}`}));
    rows=records;
  }else if(fileType==='03'){
    rows=await all("SELECT o.*,c.name customer_name,c.transaction_account_id customer_transaction_account_id,c.ta_account_id,c.bank_no,c.region_code FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.status='PENDING' ORDER BY o.created_at");
    const time=new Date().toTimeString().slice(0,8).replaceAll(':','');
    records=rows.map(o=>{const payload=jsonValue(o.payload);return {...payload,AppSheetSerialNo:o.app_no,FundCode:o.fund_code,LargeRedemptionFlag:payload.LargeRedemptionFlag,TransactionDate:o.business_date,TransactionTime:time,TransactionAccountID:o.transaction_account_id||o.customer_transaction_account_id||o.transaction_account_id,DistributorCode:ORG,ApplicationVol:o.application_vol,ApplicationAmount:o.amount,BusinessCode:o.business_code||'022',TAAccountID:o.ta_account_id,DiscountRateOfCommission:'1.0000',DepositAcct:o.bank_no,RegionCode:o.region_code,CurrencyType:'156',BranchCode:ORG,OriginalAppSheetNo:payload.OriginalAppSheetNo,IndividualOrInstitution:'1',OriginalSerialNo:payload.OriginalSerialNo,TargetTransactionAccountID:payload.TargetTransactionAccountID,TargetRegionCode:payload.TargetRegionCode,DefDividendMethod:payload.DefDividendMethod,FrozenCause:payload.FrozenCause,ShareClass:'0',TargetShareType:'0',BackenloadDiscount:'1.0000',ChargeType:'0',IPAddress:'127.0.0.1'};});
    links=rows.map(o=>({businessType:'order',businessId:o.id,appNo:o.app_no,label:`${o.customer_name} · ${o.business_code||'022'} ${TRANSACTION_BUSINESSES[o.business_code||'022']?.name||'交易'}`}));
  }else throw new Error('仅支持预览 01 和 03');
  if(!rows.length){const error=new Error(fileType==='01'?'没有待发送账户申请':'没有待发送申购');error.status=409;throw error;}
  return{fileType,header:{marker:'OFDCFDAT',version:'22',creator:ORG,receiver:TA,date:s.business_date,sender:'SYSTEM',recipient:'SYSTEM',fieldCount:FILE_DEFINITIONS[fileType].length},fields:FILE_DEFINITIONS[fileType].map(f=>({...f,requirement:requirementFor(fileType,f.name)})),records:records.map((values,i)=>({...links[i],values,requirements:Object.fromEntries(FILE_DEFINITIONS[fileType].map(f=>[f.name,requirementFor(fileType,f.name,values.BusinessCode)]))}))};
}

async function receive(fileType, handler) {
  const s = await state(); const batches = await transport.listBatches(directionIn, s.scenario_id); const results = [];
  for (const batch of batches) {
    if (await one('SELECT id FROM batches WHERE scenario_id=? AND direction=? AND relative_path=? AND file_type=?', [s.scenario_id,directionIn,batch.relative,fileType])) continue;
    const files = await transport.readBatch(batch.relative);
    const dataEntry = Object.entries(files).find(([name]) => name.includes(`_${fileType}`) && name.endsWith('.TXT'));
    if (!dataEntry) continue;
    try {
      const indexEntry = findIndexEntry(files);
      if (!indexEntry) throw new Error('索引文件缺失');
      const index = parseIndexFile(indexEntry[1]); if (!index.fileNames.includes(dataEntry[0])) throw new Error('索引未声明数据文件');
      const parsed = parseDataFile(dataEntry[1]); await handler(parsed.records, parsed);
      const [inserted]=await pool.query('INSERT INTO batches(scenario_id,batch_id,direction,file_type,business_date,relative_path,status,record_count) VALUES (?,?,?,?,?,?,?,?)', [s.scenario_id,batch.batchId,directionIn,fileType,batch.date,batch.relative,'PROCESSED',parsed.records.length]);
      if(fileType==='02'||fileType==='04')for(let i=0;i<parsed.records.length;i+=1){const record=parsed.records[i],businessType=fileType==='02'?'accountApp':'order',businessId=await findBusinessIdByProtocolAppNo(fileType,record.AppSheetSerialNo,record.BusinessCode);if(businessId)await pool.query('INSERT INTO batch_records(batch_db_id,file_type,business_type,business_id,app_no,record_index) VALUES (?,?,?,?,?,?)',[inserted.insertId,fileType,businessType,businessId,record.AppSheetSerialNo,i+1]);}
      results.push({ batch: batch.batchId, records: parsed.records.length, status: 'PROCESSED' });
    } catch (error) {
      await pool.query('INSERT INTO batches(scenario_id,batch_id,direction,file_type,business_date,relative_path,status,record_count,error_detail) VALUES (?,?,?,?,?,?,?,?,?)', [s.scenario_id,batch.batchId,directionIn,fileType,batch.date,batch.relative,'FILE_ERROR',0,error.message]);
      results.push({ batch: batch.batchId, status: 'FILE_ERROR', error: error.message });
    }
  }
  if (!results.length) {
    const error = new Error(`没有待接收的 ${fileType} 文件，请先由发送方生成并发送`);
    error.status = 409;
    throw error;
  }
  return results;
}

async function previewIncoming(fileType) {
  const s = await state();
  const batches = await transport.listBatches(directionIn, s.scenario_id);
  const previews = [];
  for (const batch of batches) {
    if (await one('SELECT id FROM batches WHERE scenario_id=? AND direction=? AND relative_path=? AND file_type=?', [s.scenario_id,directionIn,batch.relative,fileType])) continue;
    const files = await transport.readBatch(batch.relative);
    const dataEntry = Object.entries(files).find(([name]) => name.includes(`_${fileType}`) && name.endsWith('.TXT'));
    if (!dataEntry) continue;
    const checks = [];
    const indexEntry = findIndexEntry(files);
    let index = null;
    if (!indexEntry) {
      checks.push({ label:'索引文件存在', ok:false, detail:'索引文件缺失' });
    } else {
      try {
        index = inspectIndexFile(indexEntry[1]);
        checks.push({ label:'索引文件格式', ok:true, detail:indexEntry[0] });
        const declared = index.fileNames.includes(dataEntry[0]);
        checks.push({ label:'索引声明数据文件', ok:declared, detail:declared ? dataEntry[0] : '索引未声明当前数据文件' });
      } catch (error) {
        checks.push({ label:'索引文件格式', ok:false, detail:error.message });
      }
    }
    let data = null;
    try {
      data = inspectDataFile(dataEntry[1]);
      checks.push({ label:'数据文件结构', ok:true, detail:`${data.recordCount} 条记录，${data.fields.length} 个字段` });
      checks.push({ label:'文件类型', ok:data.header.fileType===fileType, detail:`期望 ${fileType}，实际 ${data.header.fileType}` });
      checks.push({ label:'发送方与接收方', ok:data.header.creator===TA&&data.header.receiver===ORG, detail:`${data.header.creator} → ${data.header.receiver}` });
    } catch (error) {
      checks.push({ label:'数据文件结构', ok:false, detail:error.message });
    }
    previews.push({ batchId:batch.batchId, date:batch.date, relative:batch.relative, dataName:dataEntry[0], indexName:indexEntry?.[0]||null, index, data, checks, valid:checks.every(item=>item.ok) });
  }
  if (!previews.length) {
    const error = new Error(`没有待接收的 ${fileType} 文件，请先由发送方生成并发送`);
    error.status = 409;
    throw error;
  }
  return { fileType, sender:'广发基金 TA 系统（模拟）', receiver:'蚂蚁销售平台', batches:previews };
}

app.get('/api/health', (_req,res) => res.json({ service:'sales', ok:true }));
app.get('/api/storage', (_req,res) => res.json(artifactStorage.status()));
app.get('/api/batches/:id/files/:fileName/signed-url', async (req,res,next) => { try {
  const batch=await one('SELECT * FROM batches WHERE id=?',[req.params.id]);
  if(!batch)return res.status(404).json({error:'批次不存在'});
  const files=await transport.readBatch(batch.relative_path),requested=req.params.fileName;
  const sourceName=Object.prototype.hasOwnProperty.call(files,requested)?requested:Object.keys(files).find(candidate=>{
    if(candidate.startsWith('OFD_'))return false;
    return indexFileName({...parseIndexFile(files[candidate]),fileType:batch.file_type})===requested;
  });
  if(!sourceName)return res.status(404).json({error:'批次文件不存在'});
  const url=await artifactStorage.signedUrl(batch.relative_path,sourceName);
  res.json({mode:artifactStorage.mode,url,expiresIn:url?900:null,downloadPath:url?null:`/api/batches/${batch.id}/files/${encodeURIComponent(requested)}`});
} catch(e){next(e);} });
app.get('/api/state', async (_req,res,next) => { try { res.json({ simulation: await state(), customers: await all('SELECT * FROM customers ORDER BY created_at'), accountApplications:await all('SELECT * FROM account_applications ORDER BY created_at DESC'), transactionAccounts:await all('SELECT * FROM transaction_accounts ORDER BY created_at'), distributors:await all('SELECT * FROM sales_distributors ORDER BY is_local DESC,distributor_code'), custodyTransfers:await all('SELECT * FROM custody_transfers ORDER BY created_at DESC'), funds: await all('SELECT * FROM funds ORDER BY fund_code'), orders: await all('SELECT * FROM orders ORDER BY created_at DESC'), holdings: await all('SELECT * FROM holdings'), batches: await all('SELECT * FROM batches ORDER BY id DESC LIMIT 200'), batchRecords:await all('SELECT * FROM batch_records ORDER BY id DESC'), reconciliations: await all('SELECT * FROM reconciliations ORDER BY id DESC LIMIT 200') }); } catch(e){next(e);} });
app.put('/api/distributors/:code',async(req,res,next)=>{try{
  const code=String(req.params.code||'').trim().toUpperCase(),name=String(req.body.name||'').trim(),status=req.body.status==='DISABLED'?'DISABLED':'ENABLED';
  if(!/^[0-9A-Z]{1,9}$/.test(code))return res.status(400).json({error:'销售机构代码必须是 1-9 位数字或大写字母'});
  if(!name)return res.status(400).json({error:'销售机构名称不能为空'});
  const existing=await one('SELECT * FROM sales_distributors WHERE distributor_code=?',[code]);
  if(req.body.createOnly&&existing)return res.status(409).json({error:'销售机构代码已存在'});
  if(Number(existing?.is_local)===1)return res.status(409).json({error:'本地销售机构不能在此修改'});
  const taResponse=await fetch(`${TA_API}/distributors/${encodeURIComponent(code)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,status,createOnly:req.body.createOnly})});
  const taResult=await taResponse.json().catch(()=>({}));
  if(!taResponse.ok)return res.status(taResponse.status).json({error:taResult.error||'TA销售机构同步失败'});
  await pool.query(`INSERT INTO sales_distributors(distributor_code,distributor_name,status,is_local) VALUES (?,?,?,0) ON DUPLICATE KEY UPDATE distributor_name=VALUES(distributor_name),status=VALUES(status)`,[code,name,status]);
  res.json({ok:true,distributorCode:code});
}catch(e){next(e);}});
app.get('/api/batches/:fileType/preview',async(req,res,next)=>{try{res.json(await pendingPreview(req.params.fileType));}catch(e){next(e);}});
app.get('/api/inbox/:fileType/preview',async(req,res,next)=>{try{res.json(await previewIncoming(req.params.fileType));}catch(e){next(e);}});
app.get('/api/batches/:id/content', async (req,res,next) => { try {
  const batch=await one('SELECT * FROM batches WHERE id=?',[req.params.id]);
  if(!batch)return res.status(404).json({error:'批次不存在'});
  const files=await transport.readBatch(batch.relative_path);
  res.json({batch,files:Object.entries(files).sort(([a],[b])=>a.localeCompare(b)).map(([sourceName,buffer])=>{
    const compatible=normalizeExchangeFile(buffer);
    const inspected=sourceName.startsWith('OFD_')?inspectDataFile(compatible):inspectIndexFile(compatible);
    const name=inspected.kind==='index'?indexFileName({...inspected.header,fileType:batch.file_type}):sourceName;
    return{name,sourceName,...inspected};
  })});
} catch(e){next(e);} });
app.get('/api/batches/:id/files/:fileName', async (req,res,next) => { try {
  const batch=await one('SELECT * FROM batches WHERE id=?',[req.params.id]);
  if(!batch)return res.status(404).json({error:'批次不存在'});
  const files=await transport.readBatch(batch.relative_path),name=req.params.fileName;
  const sourceName=Object.prototype.hasOwnProperty.call(files,name)?name:Object.keys(files).find(candidate=>{
    if(candidate.startsWith('OFD_'))return false;
    const parsed=parseIndexFile(files[candidate]);
    return indexFileName({...parsed,fileType:batch.file_type})===name;
  });
  if(!sourceName)return res.status(404).json({error:'批次文件不存在'});
  const buffer=normalizeExchangeFile(files[sourceName]);
  res.setHeader('Content-Type','application/octet-stream');
  res.setHeader('Content-Disposition',`attachment; filename="${name.replaceAll('"','')}"`);
  res.setHeader('Content-Length',buffer.length);
  res.send(buffer);
} catch(e){next(e);} });

app.post('/api/customers', async (req,res,next) => { try {
  const id = crypto.randomUUID(); const b=req.body;
  await pool.query(`INSERT INTO customers(id,name,certificate_no,mobile,email,address,birthday,sex,cert_valid_date,bank_name,bank_no,balance,risk_level)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id,b.name,b.certificateNo,b.mobile||'',b.email||'',b.address||'',compactDate(b.birthday||'1990-01-01'),b.sex||'1',compactDate(b.certValidDate||'2099-12-31'),b.bankName||b.name,b.bankNo||'6222000000000000',b.balance??100000,b.riskLevel||'3']);
  res.status(201).json({id});
} catch(e){next(e);} });

app.put('/api/customers/:id', async (req,res,next) => { try {
  const customer=await one('SELECT id FROM customers WHERE id=?',[req.params.id]);
  if(!customer)return res.status(404).json({error:'客户不存在'});
  const b=req.body;
  await pool.query(`UPDATE customers SET name=?,certificate_no=?,mobile=?,email=?,balance=?,risk_level=? WHERE id=?`,[
    b.name,b.certificateNo,b.mobile||'',b.email||'',b.balance??0,b.riskLevel||'3',req.params.id
  ]);
  res.json({ok:true,id:req.params.id});
} catch(e){next(e);} });

app.post('/api/demo/seed',async(_req,res,next)=>{try{
  let created=0;
  for(const customer of DEMO_CUSTOMERS){
    const [result]=await pool.query(`INSERT IGNORE INTO customers(id,name,certificate_no,mobile,email,address,birthday,sex,cert_valid_date,nationality,vocation_code,annual_income,risk_level,region_code,bank_name,bank_no,bank_code,balance)
      VALUES (?,?,?,?,?,?,?,?,?,'156','99999',?,?,?,?,?,?,?)`,[crypto.randomUUID(),customer.name,customer.certificateNo,customer.mobile,customer.email,customer.address,customer.birthday,customer.sex,'20991231',100000,customer.riskLevel,customer.regionCode,customer.bankName,customer.bankNo,customer.bankCode,customer.balance]);
    created+=result.affectedRows;
  }
  res.json({ok:true,created,total:DEMO_CUSTOMERS.length,message:`已加载 ${created} 位新客户，演示客户共 ${DEMO_CUSTOMERS.length} 位`});
}catch(e){next(e);}});

app.post('/api/customers/:id/open', async (req,res,next) => { try {
  const s=await state(); const customer=await one('SELECT * FROM customers WHERE id=?',[req.params.id]); if(!customer) return res.status(404).json({error:'客户不存在'});
  if(!['NOT_OPENED','OPEN_FAILED'].includes(customer.open_status)) return res.status(409).json({error:'客户已开户或已有待处理开户申请'});
  const appNo=await sequence('OP'); const tx=`${s.business_date}${String(Date.now()).slice(-9)}`.slice(0,17);
  await transaction(async db=>{await db.query('UPDATE customers SET open_app_no=?, transaction_account_id=?, open_status=?,account_status=? WHERE id=?',[appNo,tx,'OPEN_PENDING','PENDING',customer.id]);await db.query('INSERT INTO account_applications(id,customer_id,app_no,business_code,status,business_date,transaction_account_id,payload) VALUES (?,?,?,?,?,?,?,?)',[crypto.randomUUID(),customer.id,appNo,'001','PENDING',s.business_date,tx,JSON.stringify({})]);});
  res.json({appNo,transactionAccountId:tx});
} catch(e){next(e);} });

app.post('/api/customers/:id/account-applications',async(req,res,next)=>{try{
  const s=await state(),customer=await one('SELECT * FROM customers WHERE id=?',[req.params.id]);
  if(!customer)return res.status(404).json({error:'客户不存在'});
  const businessCode=String(req.body.businessCode||'');
  if(!ACCOUNT_BUSINESSES[businessCode]||businessCode==='001')return res.status(400).json({error:'业务代码必须是 002-009'});
  if(customer.open_status!=='OPENED'||!customer.ta_account_id)return res.status(409).json({error:'只有已开户客户才能发起该账户业务'});
  if(await one("SELECT id FROM account_applications WHERE customer_id=? AND status IN ('PENDING','SENT')",[customer.id]))return res.status(409).json({error:'该客户已有待处理的账户业务申请'});
  const accounts=await all("SELECT * FROM transaction_accounts WHERE customer_id=? AND status='ACTIVE' ORDER BY is_primary DESC,created_at",[customer.id]);
  let target=String(req.body.transactionAccountId||customer.transaction_account_id||'');
  const selected=accounts.find(x=>x.transaction_account_id===target);
  if(businessCode==='004'&&customer.account_status!=='NORMAL')return res.status(409).json({error:'只有正常基金账户可冻结'});
  if(businessCode==='005'&&customer.account_status!=='FROZEN')return res.status(409).json({error:'只有冻结基金账户可解冻'});
  if(['006','007','009'].includes(businessCode)&&!selected)return res.status(409).json({error:'请选择有效的交易账户'});
  if(businessCode==='006'&&selected.card_status!=='NORMAL')return res.status(409).json({error:'只有正常账户卡可挂失'});
  if(businessCode==='007'&&selected.card_status!=='LOST')return res.status(409).json({error:'只有已挂失账户卡可解挂'});
  if(businessCode==='008')target=String(req.body.transactionAccountId||`${s.business_date}${String(Date.now()).slice(-9)}`).slice(0,17);
  if(businessCode==='008'&&await one('SELECT id FROM transaction_accounts WHERE transaction_account_id=?',[target]))return res.status(409).json({error:'新交易账户已存在'});
  if(businessCode==='009'&&accounts.length<=1)return res.status(409).json({error:'最后一个有效交易账户不能撤销'});
  let payload={};
  if(businessCode==='003'){
    payload=Object.fromEntries(PROFILE_FIELDS.map(key=>[key,req.body.profile?.[key]===undefined?customer[key]:String(req.body.profile[key]??'').trim()]));
    const changed=PROFILE_FIELDS.filter(key=>String(payload[key]??'')!==String(customer[key]??''));
    if(!changed.length)return res.status(409).json({error:'账户资料没有发生变化'});payload.changed_fields=changed;
    if(!/^[0-9]{8}$/.test(payload.cert_valid_date||''))return res.status(400).json({error:'证件有效日期必须为 YYYYMMDD'});
  }
  const id=crypto.randomUUID(),appNo=await sequence(`A${businessCode}`);
  await pool.query('INSERT INTO account_applications(id,customer_id,app_no,business_code,status,business_date,transaction_account_id,payload) VALUES (?,?,?,?,?,?,?,?)',[id,customer.id,appNo,businessCode,'PENDING',s.business_date,target,JSON.stringify(payload)]);
  res.status(201).json({id,appNo,businessCode,transactionAccountId:target});
}catch(e){next(e);}});

app.post('/api/batches/01', async (req,res,next) => { try {
  const preview=await pendingPreview('01'),submitted=req.body?.records,ids=submitted?.map(x=>x.businessId)||preview.records.map(x=>x.businessId);if(ids.length!==preview.records.length||new Set(ids).size!==preview.records.length||preview.records.some(x=>!ids.includes(x.businessId)))return res.status(409).json({error:'发送前待发记录已变化，请重新打开弹窗'});const byId=new Map(submitted?.map(x=>[x.businessId,x.values])||preview.records.map(x=>[x.businessId,x.values])),records=preview.records.map(x=>byId.get(x.businessId));validateEditedRecords('01',records);
  const result=await sendFile('01',records,preview.records);await pool.query(`UPDATE account_applications SET status='SENT' WHERE id IN (${ids.map(()=>'?').join(',')})`,ids);const openingCustomerIds=await all(`SELECT customer_id FROM account_applications WHERE business_code='001' AND id IN (${ids.map(()=>'?').join(',')})`,ids);if(openingCustomerIds.length)await pool.query(`UPDATE customers SET open_status='OPEN_SENT' WHERE id IN (${openingCustomerIds.map(()=>'?').join(',')})`,openingCustomerIds.map(x=>x.customer_id));res.json(result);
} catch(e){next(e);} });

app.post('/api/inbox/02', async (_req,res,next) => { try { res.json(await receive('02', async records => {
  await transaction(async c=>{for(const r of records){const [rows]=await c.query('SELECT * FROM account_applications WHERE app_no=? FOR UPDATE',[r.AppSheetSerialNo]);const application=rows[0];if(!application)continue;const success=r.ReturnCode==='0000',payload=typeof application.payload==='string'?JSON.parse(application.payload||'{}'):(application.payload||{}),code=application.business_code;await c.query('UPDATE account_applications SET status=?,return_code=?,error_detail=?,ta_serial_no=? WHERE id=?',[success?'CONFIRMED':'FAILED',r.ReturnCode,success?null:(RETURN_CODES[r.ReturnCode]||r.ErrorDetail),r.TASerialNO,application.id]);if(!success){if(code==='001')await c.query("UPDATE customers SET open_status='OPEN_FAILED',account_status='NOT_OPENED',open_return_code=?,open_error=? WHERE id=?",[r.ReturnCode,RETURN_CODES[r.ReturnCode]||r.ErrorDetail,application.customer_id]);continue;}if(code==='001'){await c.query("UPDATE customers SET open_status='OPENED',account_status='NORMAL',ta_account_id=?,open_return_code='0000',open_error=NULL WHERE id=?",[r.TAAccountID,application.customer_id]);await c.query("INSERT INTO transaction_accounts(id,customer_id,transaction_account_id,status,card_status,is_primary) VALUES (?,?,?,'ACTIVE','NORMAL',1) ON DUPLICATE KEY UPDATE status='ACTIVE',card_status='NORMAL'",[crypto.randomUUID(),application.customer_id,application.transaction_account_id]);}else if(code==='002'){await c.query("UPDATE customers SET open_status='CLOSED',account_status='CLOSED' WHERE id=?",[application.customer_id]);await c.query("UPDATE transaction_accounts SET status='REVOKED' WHERE customer_id=?",[application.customer_id]);}else if(code==='003'){await c.query('UPDATE customers SET address=?,mobile=?,email=?,cert_valid_date=?,bank_name=?,bank_no=?,bank_code=?,risk_level=? WHERE id=?',[payload.address,payload.mobile,payload.email,payload.cert_valid_date,payload.bank_name,payload.bank_no,payload.bank_code,payload.risk_level,application.customer_id]);}else if(code==='004')await c.query("UPDATE customers SET account_status='FROZEN' WHERE id=?",[application.customer_id]);else if(code==='005')await c.query("UPDATE customers SET account_status='NORMAL' WHERE id=?",[application.customer_id]);else if(code==='006'||code==='007')await c.query('UPDATE transaction_accounts SET card_status=? WHERE customer_id=? AND transaction_account_id=?',[code==='006'?'LOST':'NORMAL',application.customer_id,application.transaction_account_id]);else if(code==='008')await c.query("INSERT INTO transaction_accounts(id,customer_id,transaction_account_id,status,card_status,is_primary) VALUES (?,?,?,'ACTIVE','NORMAL',0)",[crypto.randomUUID(),application.customer_id,application.transaction_account_id]);else if(code==='009'){await c.query("UPDATE transaction_accounts SET status='REVOKED',is_primary=0 WHERE customer_id=? AND transaction_account_id=?",[application.customer_id,application.transaction_account_id]);const [primary]=await c.query("SELECT * FROM transaction_accounts WHERE customer_id=? AND status='ACTIVE' ORDER BY is_primary DESC,created_at LIMIT 1",[application.customer_id]);if(primary[0]){await c.query('UPDATE transaction_accounts SET is_primary=(transaction_account_id=?) WHERE customer_id=?',[primary[0].transaction_account_id,application.customer_id]);await c.query('UPDATE customers SET transaction_account_id=? WHERE id=?',[primary[0].transaction_account_id,application.customer_id]);}}} });
})); } catch(e){next(e);} });

app.post('/api/orders', async (req,res,next) => { try {
  const s=await state(),c=await one('SELECT * FROM customers WHERE id=?',[req.body.customerId]);
  const businessCode=String(req.body.businessCode||'022'),business=TRANSACTION_BUSINESSES[businessCode],values=req.body.values||req.body;
  if(!business)return res.status(400).json({error:`不支持的交易操作 ${businessCode}`});
  if(!c||c.open_status!=='OPENED')return res.status(409).json({error:'客户尚未开户成功'});
  if(c.account_status!=='NORMAL')return res.status(409).json({error:'基金账户非正常状态，不能发起交易'});
  const tx=await one("SELECT * FROM transaction_accounts WHERE customer_id=? AND transaction_account_id=? AND status='ACTIVE'",[c.id,c.transaction_account_id]);
  if(!tx||tx.card_status!=='NORMAL')return res.status(409).json({error:'当前交易账户不可用'});
  let fundCode=String(values.FundCode||values.fundCode||''),amount=Number(values.ApplicationAmount??values.amount??0),volume=Number(values.ApplicationVol||0),fund=null,original=null;
  if(businessCode==='052'){
    original=await one("SELECT * FROM orders WHERE customer_id=? AND app_no=? AND status='SENT'",[c.id,String(values.OriginalAppSheetNo||'')]);
    if(!original)return res.status(409).json({error:'只能撤销已发送且尚未确认的原申请'});
    fundCode=original.fund_code;
  }else if(!['058','070'].includes(businessCode)){
    fund=await one('SELECT * FROM funds WHERE fund_code=?',[fundCode]);
    if(!fund)return res.status(409).json({error:'基金不存在，请先接收 07 文件'});
  }
  const holding=fundCode?await one('SELECT * FROM holdings WHERE customer_id=? AND fund_code=?',[c.id,fundCode]):null;
  if(['020','022'].includes(businessCode)){
    const expectedStatus=businessCode==='020'?'1':'0';
    if(fund.fund_status!==expectedStatus)return res.status(409).json({error:businessCode==='020'?'基金当前不在募集认购期':'基金当前不可申购'});
    if(amount<Number(fund.min_first))return res.status(409).json({error:`低于最低申购金额 ${fund.min_first}`});
  }
  if(['024','026','031','036'].includes(businessCode)&&(!holding||volume<=0||volume>Number(holding.volume)))return res.status(409).json({error:'申请份额超过当前可用份额'});
  if(businessCode==='032'&&(!holding||volume<=0||volume>Number(holding.frozen_volume||0)))return res.status(409).json({error:'申请份额超过当前冻结份额'});
  if(['020','022','041'].includes(businessCode)&&Number(c.balance)-Number(c.frozen_balance)<amount)return res.status(409).json({error:'模拟银行卡可用余额不足'});
  if(['020','022','040','041'].includes(businessCode)&&amount<=0)return res.status(400).json({error:'申请金额必须大于 0'});
  if(businessCode==='026'){
    const targetDistributorCode=String(values.TargetDistributorCode||'').trim();
    if(!targetDistributorCode)return res.status(400).json({error:'请选择转入销售机构'});
    const targetDistributor=await one("SELECT * FROM sales_distributors WHERE distributor_code=? AND status='ENABLED'",[targetDistributorCode]);
    if(!targetDistributor)return res.status(409).json({error:'目标销售机构不存在或已停用'});
    if(Number(targetDistributor.is_local)===1||targetDistributorCode===ORG)return res.status(409).json({error:'转托管目标不能是当前销售机构'});
    if(!/^\d{17}$/.test(String(values.TargetTransactionAccountID||'')))return res.status(400).json({error:'目标交易账号必须为 17 位数字'});
  }
  if(businessCode==='036'){
    const targetFundCode=String(values.CodeOfTargetFund||'');
    if(!targetFundCode||targetFundCode===fundCode)return res.status(400).json({error:'目标基金必须与转出基金不同'});
    const targetFund=await one('SELECT fund_code,fund_status FROM funds WHERE fund_code=?',[targetFundCode]);
    if(!targetFund)return res.status(409).json({error:'目标基金不存在，请先接收 07 文件'});
    if(fund.fund_status!=='0'||targetFund.fund_status!=='0')return res.status(409).json({error:'转出基金和目标基金都必须处于正常交易状态'});
  }
  if(businessCode==='058'){
    const target=String(values.TargetTransactionAccountID||'');
    if(!/^\d{17}$/.test(target))return res.status(400).json({error:'新交易账号必须为 17 位数字'});
    if(await one('SELECT id FROM transaction_accounts WHERE transaction_account_id=?',[target]))return res.status(409).json({error:'新交易账号已存在'});
  }
  if(businessCode==='070'&&!/^\d{4}$/.test(String(values.TargetRegionCode||'')))return res.status(400).json({error:'变更后的地区编号必须为 4 位数字'});
  const payload=Object.fromEntries(business.inputs.filter(name=>!['FundCode','ApplicationAmount','ApplicationVol'].includes(name)).map(name=>[name,String(values[name]??'').trim()]));
  const id=crypto.randomUUID(),appNo=await sequence(`T${businessCode}`);
  await transaction(async db=>{
    await db.query('INSERT INTO orders(id,customer_id,app_no,fund_code,amount,status,business_date,business_code,application_vol,transaction_account_id,payload) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[id,c.id,appNo,fundCode||'',amount||0,'PENDING',s.business_date,businessCode,volume||0,c.transaction_account_id,JSON.stringify(payload)]);
    if(['020','022','041'].includes(businessCode))await db.query('UPDATE customers SET frozen_balance=frozen_balance+? WHERE id=?',[amount,c.id]);
  });
  res.status(201).json({id,appNo,businessCode});
} catch(e){next(e);} });

app.delete('/api/orders/:id/draft',async(req,res,next)=>{try{
  const order=await one("SELECT * FROM orders WHERE id=? AND status='PENDING'",[req.params.id]);
  if(!order)return res.status(404).json({error:'待确认的交易申请不存在或状态已变化'});
  await transaction(async db=>{
    await db.query("DELETE FROM orders WHERE id=? AND status='PENDING'",[order.id]);
    if(['020','022','041'].includes(order.business_code))await db.query('UPDATE customers SET frozen_balance=GREATEST(0,frozen_balance-?) WHERE id=?',[order.amount,order.customer_id]);
  });
  res.json({id:order.id,canceled:true});
}catch(e){next(e);}});

app.post('/api/batches/03', async (req,res,next) => { try {
  const preview=await pendingPreview('03'),submitted=req.body?.records,ids=submitted?.map(x=>x.businessId)||preview.records.map(x=>x.businessId);if(ids.length!==preview.records.length||new Set(ids).size!==preview.records.length||preview.records.some(x=>!ids.includes(x.businessId)))return res.status(409).json({error:'发送前待发记录已变化，请重新打开弹窗'});const byId=new Map(submitted?.map(x=>[x.businessId,x.values])||preview.records.map(x=>[x.businessId,x.values])),records=preview.records.map(x=>byId.get(x.businessId));validateEditedRecords('03',records);
  const result=await sendFile('03',records,preview.records); await pool.query(`UPDATE orders SET status=CASE WHEN business_code='070' THEN 'CONFIRMED' ELSE 'SENT' END WHERE id IN (${ids.map(()=>'?').join(',')})`,ids);for(const item of preview.records.filter(x=>x.values.BusinessCode==='070'))await pool.query('UPDATE customers SET region_code=? WHERE id=(SELECT customer_id FROM orders WHERE id=?)',[item.values.TargetRegionCode,item.businessId]);res.json(result);
} catch(e){next(e);} });

app.post('/api/batches/T',async(req,res,next)=>{try{
  const submittedByType=new Map((req.body?.files||[]).map(file=>[file.fileType,file.records]));
  const entries=[];
  for(const fileType of ['01','03']){try{
    const preview=await pendingPreview(fileType),submitted=submittedByType.get(fileType);
    let records=preview.records.map(item=>item.values);
    if(submitted){
      const ids=submitted.map(item=>item.businessId),expected=preview.records.map(item=>item.businessId);
      if(ids.length!==expected.length||new Set(ids).size!==expected.length||expected.some(id=>!ids.includes(id)))return res.status(409).json({error:`${fileType} 待封批记录已变化，请重新预览批次`});
      const byId=new Map(submitted.map(item=>[item.businessId,item.values]));
      records=preview.records.map(item=>byId.get(item.businessId));
    }
    validateEditedRecords(fileType,records);entries.push({fileType,records,links:preview.records});
  }catch(error){if(error.status!==409)throw error;}}
  if(!entries.length)return res.status(409).json({error:'当前 T 日没有待封批的账户或交易申请'});
  const result=await sendPackage(entries);
  const accountEntry=entries.find(entry=>entry.fileType==='01');if(accountEntry){const ids=accountEntry.links.map(item=>item.businessId);await pool.query(`UPDATE account_applications SET status='SENT' WHERE id IN (${ids.map(()=>'?').join(',')})`,ids);const customerIds=await all(`SELECT customer_id FROM account_applications WHERE business_code='001' AND id IN (${ids.map(()=>'?').join(',')})`,ids);if(customerIds.length)await pool.query(`UPDATE customers SET open_status='OPEN_SENT' WHERE id IN (${customerIds.map(()=>'?').join(',')})`,customerIds.map(item=>item.customer_id));}
  const orderEntry=entries.find(entry=>entry.fileType==='03');if(orderEntry){const ids=orderEntry.links.map(item=>item.businessId);await pool.query(`UPDATE orders SET status=CASE WHEN business_code='070' THEN 'CONFIRMED' ELSE 'SENT' END WHERE id IN (${ids.map(()=>'?').join(',')})`,ids);for(const item of orderEntry.links.filter(link=>link.values.BusinessCode==='070'))await pool.query('UPDATE customers SET region_code=? WHERE id=(SELECT customer_id FROM orders WHERE id=?)',[item.values.TargetRegionCode,item.businessId]);}
  res.json(result);
}catch(error){next(error);}});

app.get('/api/automation/runs',async(req,res,next)=>{try{const limit=Math.min(50,Math.max(1,Number(req.query.limit||20))),rows=await all(`SELECT * FROM automation_runs ORDER BY started_at DESC LIMIT ${limit}`);res.json(rows.map(row=>({...row,steps:jsonValue(row.steps_json),result:jsonValue(row.result_json)})));}catch(error){next(error);}});
app.get('/api/automation/runs/:id',async(req,res,next)=>{try{const run=await automationRun(req.params.id);if(!run)return res.status(404).json({error:'运行不存在'});res.json(run);}catch(error){next(error);}});
app.post('/api/automation/runs',async(req,res,next)=>{try{
  const active=await one("SELECT id FROM automation_runs WHERE status='running' ORDER BY started_at DESC LIMIT 1");
  if(active)return res.status(409).json({error:'已有自动运行正在执行',runId:active.id});
  const s=await state(),has01=Boolean(await one("SELECT id FROM account_applications WHERE business_date=? AND status='PENDING' LIMIT 1",[s.business_date])),has03=Boolean(await one("SELECT id FROM orders WHERE business_date=? AND status='PENDING' LIMIT 1",[s.business_date]));
  if(!has01&&!has03)return res.status(409).json({error:'当前业务日没有待处理业务'});
  const id=crypto.randomUUID(),files=req.body?.files||[];
  await pool.query("INSERT INTO automation_runs(id,scenario_id,business_date,status,steps_json) VALUES (?,?,?,'running',?)",[id,s.scenario_id,s.business_date,JSON.stringify(AUTOMATION_STEPS)]);
  setImmediate(()=>executeAutomation(id,{has01,has03,files}));
  res.status(202).json(await automationRun(id));
}catch(error){next(error);}});

app.post('/api/inbox/04', async (_req,res,next) => { try { res.json(await receive('04', async records => {
  await transaction(async db=>{ for(const r of records){let [rows]=await db.query('SELECT * FROM orders WHERE app_no=? FOR UPDATE',[r.AppSheetSerialNo]);let o=rows[0];if(!o){[rows]=await db.query("SELECT business_id FROM batch_records WHERE file_type='03' AND business_type='order' AND app_no=? ORDER BY id DESC LIMIT 1",[r.AppSheetSerialNo]);if(rows[0]?.business_id){[rows]=await db.query('SELECT * FROM orders WHERE id=? FOR UPDATE',[rows[0].business_id]);o=rows[0];}}if(!o)continue;const success=r.ReturnCode==='0000',code=o.business_code||'022',payload=jsonValue(o.payload);await db.query('UPDATE orders SET status=?,return_code=?,error_detail=?,confirmed_amount=?,confirmed_volume=?,fee=?,nav=?,ta_serial_no=? WHERE id=?',[success?'CONFIRMED':'FAILED',r.ReturnCode,success?null:(RETURN_CODES[r.ReturnCode]||r.ErrorDetail),r.ConfirmedAmount,r.ConfirmedVol,r.Charge,r.NAV,r.TASerialNO,o.id]);
    if(['020','022','041'].includes(code))await db.query('UPDATE customers SET frozen_balance=GREATEST(0,frozen_balance-?),balance=balance-? WHERE id=?',[o.amount,success?o.amount:0,o.customer_id]);
    if(success&&['020','022'].includes(code))await db.query('INSERT INTO holdings(customer_id,fund_code,volume,frozen_volume) VALUES (?,?,?,0) ON DUPLICATE KEY UPDATE volume=volume+VALUES(volume)',[o.customer_id,o.fund_code,r.ConfirmedVol]);
    if(success&&code==='024')await db.query('UPDATE holdings SET volume=volume-? WHERE customer_id=? AND fund_code=?',[o.application_vol,o.customer_id,o.fund_code]);
    if(success&&code==='024')await db.query('UPDATE customers SET balance=balance+? WHERE id=?',[r.ConfirmedAmount,o.customer_id]);
    if(success&&code==='029')await db.query('UPDATE holdings SET dividend_method=? WHERE customer_id=? AND fund_code=?',[payload.DefDividendMethod,o.customer_id,o.fund_code]);
    if(success&&code==='031')await db.query('UPDATE holdings SET volume=volume-?,frozen_volume=frozen_volume+? WHERE customer_id=? AND fund_code=?',[o.application_vol,o.application_vol,o.customer_id,o.fund_code]);
    if(success&&code==='032')await db.query('UPDATE holdings SET volume=volume+?,frozen_volume=frozen_volume-? WHERE customer_id=? AND fund_code=?',[o.application_vol,o.application_vol,o.customer_id,o.fund_code]);
    if(success&&code==='026')await db.query('UPDATE holdings SET volume=GREATEST(0,volume-?) WHERE customer_id=? AND fund_code=?',[o.application_vol,o.customer_id,o.fund_code]);
    if(success&&code==='026')await db.query(`INSERT INTO custody_transfers(app_no,customer_id,fund_code,volume,source_distributor_code,source_transaction_account_id,target_distributor_code,target_transaction_account_id,status,ta_serial_no,confirmation_date)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status),ta_serial_no=VALUES(ta_serial_no),confirmation_date=VALUES(confirmation_date)`,[o.app_no,o.customer_id,o.fund_code,o.application_vol,ORG,o.transaction_account_id,r.TargetDistributorCode||payload.TargetDistributorCode,r.TargetTransactionAccountID||payload.TargetTransactionAccountID,'CONFIRMED',r.TASerialNO,r.TransactionCfmDate]);
    if(success&&code==='036'){
      await db.query('UPDATE holdings SET volume=GREATEST(0,volume-?) WHERE customer_id=? AND fund_code=?',[o.application_vol,o.customer_id,o.fund_code]);
      await db.query('INSERT INTO holdings(customer_id,fund_code,volume,frozen_volume) VALUES (?,?,?,0) ON DUPLICATE KEY UPDATE volume=volume+VALUES(volume)',[o.customer_id,payload.CodeOfTargetFund,r.CfmVolOfTargetFund]);
    }
    if(success&&code==='040')await db.query('UPDATE customers SET balance=balance+? WHERE id=?',[o.amount,o.customer_id]);
    if(success&&code==='052'){
      const [originalRows]=await db.query('SELECT * FROM orders WHERE customer_id=? AND app_no=? FOR UPDATE',[o.customer_id,payload.OriginalAppSheetNo]);
      const original=originalRows[0];
      if(original&&['020','022','041'].includes(original.business_code))await db.query('UPDATE customers SET frozen_balance=GREATEST(0,frozen_balance-?) WHERE id=?',[original.amount,o.customer_id]);
      if(original)await db.query("UPDATE orders SET status='CANCELED' WHERE id=?",[original.id]);
    }
    if(success&&code==='058'){await db.query('UPDATE transaction_accounts SET transaction_account_id=? WHERE customer_id=? AND transaction_account_id=?',[payload.TargetTransactionAccountID,o.customer_id,o.transaction_account_id]);await db.query('UPDATE customers SET transaction_account_id=? WHERE id=?',[payload.TargetTransactionAccountID,o.customer_id]);}
  } });
})); } catch(e){next(e);} });

app.post('/api/inbox/07', async (_req,res,next) => { try { res.json(await receive('07', async records => {
  for(const r of records) await pool.query(`INSERT INTO funds(fund_code,fund_name,fund_status,nav,nav_date,accumulated_nav,min_first,min_additional,max_purchase,daily_max,fund_type,fund_type_name,manager_name,total_volume,fund_size)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE fund_name=VALUES(fund_name),fund_status=VALUES(fund_status),nav=VALUES(nav),nav_date=VALUES(nav_date),accumulated_nav=VALUES(accumulated_nav),min_first=VALUES(min_first),min_additional=VALUES(min_additional),max_purchase=VALUES(max_purchase),daily_max=VALUES(daily_max),fund_type=VALUES(fund_type),fund_type_name=VALUES(fund_type_name),manager_name=VALUES(manager_name),total_volume=VALUES(total_volume),fund_size=VALUES(fund_size)`,[r.FundCode,r.FundName,r.FundStatus,r.NAV,r.UpdateDate,r.AccumulativeNAV,r.MinBidsAmountByIndi,r.MinAppBidsAmountByIndi,r.IndiMaxPurchase,r.IndiDayMaxSumBuy,r.FundType,r.FundTypeName,r.FundManagerName,r.TotalFundVol,r.FundSize]);
})); } catch(e){next(e);} });

app.post('/api/inbox/05', async (_req,res,next) => { try { res.json(await receive('05', async records => {
  for(const r of records){ const c=await one('SELECT id FROM customers WHERE transaction_account_id=?',[r.TransactionAccountID]); if(!c) continue; const h=await one('SELECT volume,frozen_volume FROM holdings WHERE customer_id=? AND fund_code=?',[c.id,r.FundCode]); const sales=Number(h?.volume||0)+Number(h?.frozen_volume||0),ta=Number(r.TotalVolOfDistributorInTA),diff=ta-sales,status=Math.abs(diff)<0.005?'MATCHED':'DIFFERENT'; await pool.query('INSERT INTO reconciliations(customer_id,fund_code,sales_volume,ta_volume,difference,status,business_date) VALUES (?,?,?,?,?,?,?)',[c.id,r.FundCode,sales,ta,diff,status,r.TransactionCfmDate]); await pool.query('INSERT INTO holdings(customer_id,fund_code,volume,ta_volume,recon_status,recon_date) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE ta_volume=VALUES(ta_volume),recon_status=VALUES(recon_status),recon_date=VALUES(recon_date)',[c.id,r.FundCode,Number(h?.volume||0),ta,status,r.TransactionCfmDate]); }
})); } catch(e){next(e);} });

app.post('/api/reconciliations/:id/sync', async (req,res,next)=>{try{const r=await one('SELECT * FROM reconciliations WHERE id=?',[req.params.id]);if(!r)return res.status(404).json({error:'差异不存在'});await transaction(async db=>{await db.query('UPDATE holdings SET volume=GREATEST(0,?-frozen_volume),recon_status=? WHERE customer_id=? AND fund_code=?',[r.ta_volume,'SYNCED',r.customer_id,r.fund_code]);await db.query('UPDATE reconciliations SET status=? WHERE id=?',['SYNCED',r.id]);});res.json({ok:true});}catch(e){next(e);}});

app.post('/api/time/advance', async (req,res,next)=>{try{const s=await state();const days=Math.max(1,Number(req.body.days||1));await pool.query('UPDATE simulation_state SET previous_date=business_date,business_date=? WHERE id=1',[addDays(s.business_date,days)]);res.json(await state());}catch(e){next(e);}});
app.post('/api/reset', async (req,res,next)=>{try{const scenarioId=req.body.scenarioId||`RUN${Date.now()}`;await transaction(async db=>{for(const table of ['automation_runs','reconciliations','custody_transfers','holdings','orders','transaction_accounts','account_applications','account_changes','batch_records','batches','funds','customers']){try{await db.query(`DELETE FROM ${table}`)}catch(error){if(error.code!=='ER_NO_SUCH_TABLE')throw error;}}await db.query("UPDATE simulation_state SET scenario_id=?,business_date=?,previous_date=NULL WHERE id=1",[scenarioId,compactDate(req.body.businessDate||'2026-09-16')]);});res.json(await state());}catch(e){next(e);}});

app.use((error,_req,res,_next)=>{console.error(error);res.status(error.status||500).json({error:error.message});});
await waitForDb();
try{await pool.query('ALTER TABLE batches DROP INDEX uk_batch, ADD UNIQUE KEY uk_batch (scenario_id,direction,relative_path,file_type)');}catch(error){if(error.code!=='ER_CANT_DROP_FIELD_OR_KEY')throw error;}
try{await pool.query("ALTER TABLE customers ADD COLUMN account_status VARCHAR(16) DEFAULT 'NOT_OPENED'")}catch(error){if(error.code!=='ER_DUP_FIELDNAME')throw error;}
for(const sql of [
  "ALTER TABLE orders ADD COLUMN business_code CHAR(3) DEFAULT '022'",
  'ALTER TABLE orders ADD COLUMN application_vol DECIMAL(16,2) DEFAULT 0',
  'ALTER TABLE orders ADD COLUMN transaction_account_id CHAR(17)',
  'ALTER TABLE orders ADD COLUMN payload JSON',
  'ALTER TABLE holdings ADD COLUMN frozen_volume DECIMAL(16,2) DEFAULT 0',
  "ALTER TABLE holdings ADD COLUMN dividend_method CHAR(1) DEFAULT '1'"
]){try{await pool.query(sql)}catch(error){if(error.code!=='ER_DUP_FIELDNAME')throw error;}}
await pool.query(`CREATE TABLE IF NOT EXISTS account_applications (id VARCHAR(36) PRIMARY KEY,customer_id VARCHAR(36) NOT NULL,app_no VARCHAR(24) NOT NULL,business_code CHAR(3) NOT NULL,status VARCHAR(24) NOT NULL,business_date CHAR(8) NOT NULL,transaction_account_id CHAR(17),payload JSON,return_code CHAR(4),error_detail VARCHAR(200),ta_serial_no VARCHAR(20),created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY uk_account_application_app (app_no),KEY idx_account_application_customer (customer_id,status))`);
await pool.query(`CREATE TABLE IF NOT EXISTS transaction_accounts (id VARCHAR(36) PRIMARY KEY,customer_id VARCHAR(36) NOT NULL,transaction_account_id CHAR(17) NOT NULL,status VARCHAR(16) DEFAULT 'ACTIVE',card_status VARCHAR(16) DEFAULT 'NORMAL',is_primary TINYINT(1) DEFAULT 0,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY uk_sales_transaction_account (transaction_account_id),KEY idx_sales_transaction_customer (customer_id,status))`);
await pool.query(`CREATE TABLE IF NOT EXISTS sales_distributors (distributor_code VARCHAR(9) PRIMARY KEY,distributor_name VARCHAR(100) NOT NULL,status VARCHAR(16) NOT NULL DEFAULT 'ENABLED',is_local TINYINT(1) NOT NULL DEFAULT 0,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
await pool.query(`CREATE TABLE IF NOT EXISTS custody_transfers (id BIGINT AUTO_INCREMENT PRIMARY KEY,app_no VARCHAR(24) NOT NULL,customer_id VARCHAR(36) NOT NULL,fund_code CHAR(6) NOT NULL,volume DECIMAL(16,2) NOT NULL,source_distributor_code VARCHAR(9) NOT NULL,source_transaction_account_id CHAR(17) NOT NULL,target_distributor_code VARCHAR(9) NOT NULL,target_transaction_account_id CHAR(17) NOT NULL,status VARCHAR(24) NOT NULL,ta_serial_no VARCHAR(20),confirmation_date CHAR(8),created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY uk_custody_transfer_app (app_no))`);
await pool.query(`INSERT INTO sales_distributors(distributor_code,distributor_name,status,is_local) VALUES ('305','蚂蚁基金','ENABLED',1),('306','天天基金','ENABLED',0) ON DUPLICATE KEY UPDATE distributor_name=VALUES(distributor_name),status=VALUES(status),is_local=VALUES(is_local)`);
await pool.query("UPDATE customers SET account_status=CASE WHEN open_status='OPENED' THEN 'NORMAL' WHEN open_status='CLOSED' THEN 'CLOSED' WHEN open_status IN ('OPEN_PENDING','OPEN_SENT') THEN 'PENDING' ELSE 'NOT_OPENED' END WHERE account_status IS NULL OR account_status='NOT_OPENED'");
for(const customer of await all("SELECT * FROM customers WHERE open_status='OPENED' AND transaction_account_id IS NOT NULL")){await pool.query("INSERT IGNORE INTO transaction_accounts(id,customer_id,transaction_account_id,status,card_status,is_primary) VALUES (?,?,?,'ACTIVE','NORMAL',1)",[crypto.randomUUID(),customer.id,customer.transaction_account_id]);}
for(const customer of await all("SELECT * FROM customers WHERE open_app_no IS NOT NULL")){const applicationStatus=customer.open_status==='OPEN_PENDING'?'PENDING':customer.open_status==='OPEN_SENT'?'SENT':customer.open_status==='OPENED'?'CONFIRMED':'FAILED';await pool.query("INSERT IGNORE INTO account_applications(id,customer_id,app_no,business_code,status,business_date,transaction_account_id,payload,return_code,error_detail) VALUES (?,?,?,?,?,?,?,?,?,?)",[crypto.randomUUID(),customer.id,customer.open_app_no,'001',applicationStatus,customer.open_app_no.slice(2,10),customer.transaction_account_id,JSON.stringify({}),customer.open_return_code,customer.open_error]);}
if(await one("SELECT 1 ok FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='account_changes'")){await pool.query(`INSERT IGNORE INTO account_applications(id,customer_id,app_no,business_code,status,business_date,transaction_account_id,payload,return_code,error_detail,ta_serial_no,created_at) SELECT a.id,a.customer_id,a.app_no,'003',a.status,a.business_date,c.transaction_account_id,JSON_OBJECT('address',a.address,'mobile',a.mobile,'email',a.email,'cert_valid_date',a.cert_valid_date,'bank_name',a.bank_name,'bank_no',a.bank_no,'bank_code',a.bank_code,'risk_level',a.risk_level,'changed_fields',a.changed_fields),a.return_code,a.error_detail,a.ta_serial_no,a.created_at FROM account_changes a JOIN customers c ON c.id=a.customer_id`);}
await pool.query(`CREATE TABLE IF NOT EXISTS batch_records (id BIGINT AUTO_INCREMENT PRIMARY KEY,batch_db_id BIGINT NOT NULL,file_type CHAR(2) NOT NULL,business_type VARCHAR(16) NOT NULL,business_id VARCHAR(36) NOT NULL,app_no VARCHAR(24),record_index INT NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY uk_batch_record (batch_db_id,business_type,business_id),KEY idx_business_record (business_type,business_id,file_type))`);
await pool.query(`CREATE TABLE IF NOT EXISTS automation_runs (id VARCHAR(36) PRIMARY KEY,scenario_id VARCHAR(32) NOT NULL,business_date CHAR(8) NOT NULL,status VARCHAR(16) NOT NULL,steps_json JSON NOT NULL,result_json JSON,error_detail VARCHAR(500),started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,finished_at TIMESTAMP NULL,KEY idx_automation_runs (scenario_id,started_at))`);
for(const batch of await all("SELECT * FROM batches WHERE file_type IN ('01','02','03','04')")){
  if(await one('SELECT id FROM batch_records WHERE batch_db_id=? LIMIT 1',[batch.id]))continue;
  try{const files=await transport.readBatch(batch.relative_path),entry=Object.entries(files).find(([name])=>name.includes(`_${batch.file_type}`)&&name.endsWith('.TXT'));if(!entry)continue;const records=parseDataFile(entry[1]).records;for(let i=0;i<records.length;i+=1){const appNo=records[i].AppSheetSerialNo,businessType=['01','02'].includes(batch.file_type)?'accountApp':'order',source=await one(businessType==='accountApp'?'SELECT id FROM account_applications WHERE app_no=?':'SELECT id FROM orders WHERE app_no=?',[appNo]);if(source)await pool.query('INSERT IGNORE INTO batch_records(batch_db_id,file_type,business_type,business_id,app_no,record_index) VALUES (?,?,?,?,?,?)',[batch.id,batch.file_type,businessType,source.id,appNo,i+1]);}}catch(error){console.warn(`skip batch record backfill ${batch.id}: ${error.message}`);}
}
await pool.query("UPDATE batch_records br JOIN account_applications aa ON aa.app_no=br.app_no SET br.business_type='accountApp',br.business_id=aa.id WHERE br.file_type IN ('01','02') AND br.business_type IN ('customer','accountChange')");
app.listen(Number(process.env.PORT||8081),()=>console.log('sales-service listening'));
