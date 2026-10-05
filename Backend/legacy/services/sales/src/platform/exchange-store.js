import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { buildDataFile,buildIndexFile,dataFileName,indexFileName,parseDataFile,parseIndexFile,FILE_DEFINITIONS,encodeRecord,RETURN_CODES,confirmationCodeFor } from '../../../../packages/platform-protocol/src/index.js';
import { fail,dateValue,units,fromUnits } from './workflow-service.js';

const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const stringify=value=>JSON.stringify(value);
const canonical=value=>JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))));
const dateFromWire=value=>dateValue(`${String(value).slice(0,4)}-${String(value).slice(4,6)}-${String(value).slice(6,8)}`);
const dateText=value=>value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
const equal=(a,b)=>String(a??'').trim()===String(b??'').trim();
function expandArchive(archive){
    if(!archive||typeof archive.name!=='string'||!/^[\w.-]{1,100}\.zip$/i.test(archive.name)
      ||typeof archive.base64!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(archive.base64))
      fail('请选择有效的 ZIP 回传包');
    const bytes=Buffer.from(archive.base64,'base64');
    if(bytes.length>16*1024*1024)fail('ZIP 最大 16 MB','UPLOAD_TOO_LARGE',413);
    let entries;
    try{entries=new AdmZip(bytes).getEntries();}catch{fail('ZIP 文件无法读取','FILE_ERROR');}
    const files=[];let size=0;
    for(const entry of entries){
      if(entry.isDirectory)continue;
      const parts=entry.entryName.replaceAll('\\','/').split('/');
      if(parts.some(part=>part===''||part==='.'||part==='..'))fail('ZIP 文件路径无效','FILE_ERROR');
      if(parts.some(part=>part.startsWith('.')||part==='__MACOSX'))continue;
      const name=parts.at(-1);
      if(!/\.txt$/i.test(name))fail('ZIP 只能包含 TA 返回 TXT 文件','FILE_ERROR');
      size+=entry.header.size;
      if(entry.header.size>8*1024*1024||size>16*1024*1024||files.length>=50)
        fail('ZIP 解压后最多 50 个文件、总计 16 MB','UPLOAD_TOO_LARGE',413);
      const content=entry.getData();
      if(content.length!==entry.header.size)fail('ZIP 文件长度不一致','FILE_ERROR');
      files.push({name,sourceGroup:parts.slice(0,-1).join('/'),base64:content.toString('base64')});
    }
    return files;
}
export function parseReturnFiles({files:inputFiles,archive}){
    const input=archive?expandArchive(archive):inputFiles;
    if(!Array.isArray(input)||!input.length||input.length>50) fail('请选择 1–50 个返回文件');
    const names=new Set(),files=[];let total=0;
    for(const f of input){
      if(!f||typeof f!=='object'||typeof f.name!=='string'||!/^\w[\w.-]{0,99}$/.test(f.name)||!/^\S+\.txt$/i.test(f.name))fail('请选择有效的原始 TXT 文件');
      // Folder provenance separates same-named physical batches; it never determines
      // chat ownership and is never used as a filesystem path on the server.
      const sourceGroup=f.sourceGroup??'';
      if(typeof sourceGroup!=='string'||sourceGroup.length>512||/[\x00-\x1f\x7f]/.test(sourceGroup))fail('回传文件夹标识无效');
      const nameKey=JSON.stringify([sourceGroup,f.name.toUpperCase()]);
      if(names.has(nameKey))fail('同名返回文件请保留各自文件夹，或分批上传；无需切换 chat');
      if(typeof f.base64!=='string'||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.base64)) fail('文件内容编码无效');
      names.add(nameKey);const bytes=Buffer.from(f.base64,'base64');total+=bytes.length;
      if(bytes.length>8*1024*1024||total>16*1024*1024) fail('单文件最多 8 MB，单批最多 16 MB','UPLOAD_TOO_LARGE',413);
      try{
        const isIndex=bytes.subarray(0,8).toString('ascii')==='OFDCFIDX',parsed=isIndex?parseIndexFile(bytes):parseDataFile(bytes);
        if(parsed.version!=='22') fail('只接受 V2.2 返回文件');
        dateFromWire(parsed.date);
        if(!isIndex&&!['02','04','05'].includes(parsed.fileType)) fail('回传支持 02 / 04 / 05 与原始索引');
        if(!isIndex){
          if(parsed.fields.length!==FILE_DEFINITIONS[parsed.fileType].length)fail('字段布局不属于标准 V2.2 配置，文件未处理','UNSUPPORTED_PROFILE');
          for(const record of parsed.records)encodeRecord(parsed.fileType,record,'22');
        }
        const expected=isIndex?indexFileName({creator:parsed.creator,receiver:parsed.receiver,date:parsed.date,fileType:'02'}):dataFileName({creator:parsed.creator,receiver:parsed.receiver,date:parsed.date,fileType:parsed.fileType});
        // TA may suffix its file fragments; header is authoritative, prefix must still identify the same channel/day/type.
        const prefix=expected.replace(/\.TXT$/i,'');
        if(!new RegExp(`^${prefix}(?:_[0-9]{3,8})?\\.TXT$`,'i').test(f.name)) fail('文件名与文件头通道／日期／类型不符');
        files.push({name:f.name,sourceGroup,bytes,kind:isIndex?'INDEX':'DATA',type:isIndex?'OFI':parsed.fileType,records:parsed.records??[],parsed});
      }catch(e){fail(`${f.name}：${e.message}`,e.code||'FILE_ERROR');}
    }
    const data=files.filter(f=>f.kind==='DATA');if(!data.length) fail('请选择返回数据文件；索引不能单独导入');
    const groups=Object.values(Object.groupBy(files,f=>JSON.stringify([f.sourceGroup,f.parsed.creator,f.parsed.receiver,f.parsed.date])));
    for(const group of groups){
      const data=group.filter(f=>f.kind==='DATA'),names=new Set(data.map(f=>f.name.toUpperCase()));
      if(!data.length)fail('索引对应的回传日期缺少数据文件','INDEX_MISMATCH');
      for(const index of group.filter(f=>f.kind==='INDEX')){
        const declared=index.parsed.fileNames.map(n=>n.toUpperCase());
        if(new Set(declared).size!==declared.length||declared.some(n=>!names.has(n))||data.some(f=>!declared.includes(f.name.toUpperCase())))fail('索引声明与实际上传的数据文件不一致','INDEX_MISMATCH');
      }
    }
    return groups.sort((a,b)=>a[0].parsed.date.localeCompare(b[0].parsed.date));
}

export function createExchangeStore({db,scope,auth}) {
  const keys=[scope.workspace_id,scope.chat_id,scope.run_id];
  const query=async(sql,args=[])=>{const [r]=await db.execute(sql,[...keys,...args]);return r;};
  async function packageFor(publicId,direction){
    const [p]=await query(`SELECT p.* FROM package_runs r JOIN exchange_packages p ON p.workspace_id=r.workspace_id AND p.id=r.package_id
      WHERE r.workspace_id=? AND r.chat_id=? AND r.run_id=? AND p.public_id=?`,[publicId]);
    if(!p||direction&&p.direction!==direction) fail('文件包不属于当前 chat 和运行','RECORD_NOT_FOUND',404);
    return p;
  }
  async function savePackage(direction,date,files){
    const contentHash=hash(Buffer.concat([...files].sort((a,b)=>a.name.localeCompare(b.name)).map(f=>Buffer.from(`${f.name}\0${hash(f.bytes)}\n`))));
    const [[existing]]=await db.execute('SELECT id,public_id FROM exchange_packages WHERE workspace_id=? AND channel_id=? AND direction=? AND content_hash=? FOR UPDATE',[scope.workspace_id,scope.channel_id,direction,contentHash]);
    if(existing){
      if(direction==='OUTBOUND'){
        const [owned]=await query('SELECT package_id FROM package_runs WHERE workspace_id=? AND chat_id=? AND run_id=? AND package_id=?',[existing.id]);
        if(!owned) fail('文件包不属于当前 chat','CROSS_CHAT_FILE',409);
      }
      return {duplicate:true,id:existing.id,publicId:existing.public_id};
    }
    const publicId=crypto.randomUUID();
    const [p]=await db.execute(`INSERT INTO exchange_packages(public_id,workspace_id,channel_id,direction,business_date,content_hash,archive_key,parse_status)
      VALUES (?,?,?,?,?,?,?,'VALIDATED')`,[publicId,scope.workspace_id,scope.channel_id,direction,date,contentHash,`db/${publicId}`]);
    if(direction==='OUTBOUND')await db.execute('INSERT INTO package_runs(workspace_id,chat_id,run_id,channel_id,package_id) VALUES (?,?,?,?,?)',[...keys,scope.channel_id,p.insertId]);
    for(const file of files){
      const [f]=await db.execute(`INSERT INTO exchange_files(workspace_id,channel_id,package_id,file_name,file_type,file_kind,content_hash,byte_length,record_count,index_origin,parse_status)
        VALUES (?,?,?,?,?,?,?,?,?,?,'VALIDATED')`,[scope.workspace_id,scope.channel_id,p.insertId,file.name,file.type,file.kind,hash(file.bytes),file.bytes.length,file.records?.length??0,file.kind==='INDEX'?(direction==='OUTBOUND'?'INTERNAL':'ORIGINAL'):null]);
      file.id=f.insertId;
      await db.execute('INSERT INTO exchange_file_contents(workspace_id,file_id,original_bytes) VALUES (?,?,?)',[scope.workspace_id,f.insertId,file.bytes]);
    }
    return {id:p.insertId,publicId};
  }
  async function saveRecord(p,file,record,index,{applicationId=null,status='MATCHED',reason=null,owned=true}={}){
    if(owned)await db.execute('INSERT IGNORE INTO package_runs(workspace_id,chat_id,run_id,channel_id,package_id) VALUES (?,?,?,?,?)',[...keys,scope.channel_id,p.id]);
    const [r]=await db.execute(`INSERT INTO file_records(workspace_id,channel_id,package_id,file_id,record_index,chat_id,run_id,application_id,record_hash,record_json,match_status,match_reason)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[scope.workspace_id,scope.channel_id,p.id,file.id,index,owned?scope.chat_id:null,owned?scope.run_id:null,applicationId,hash(stringify(record)),stringify(record),status,reason]);
    return r.insertId;
  }
  async function generate({applicationIds}){
    if(!Array.isArray(applicationIds)||!applicationIds.length||applicationIds.length>100||new Set(applicationIds.map(String)).size!==applicationIds.length||applicationIds.some(id=>!/^\d{1,20}$/.test(String(id)))) fail('请选择 1–100 笔待生成申请');
    const selected=await query(`SELECT * FROM applications WHERE workspace_id=? AND chat_id=? AND run_id=? AND id IN (${applicationIds.map(()=>'?').join(',')}) ORDER BY id FOR UPDATE`,applicationIds);
    if(selected.length!==applicationIds.length) fail('所选申请不属于当前 chat','CROSS_SCOPE_REFERENCE',404);
    if(selected.some(a=>!['DRAFT','READY'].includes(a.status))) fail('申请已经生成，使用已有文件包下载','ALREADY_GENERATED',409);
    const date=dateText(selected[0].business_date);
    if(selected.some(a=>dateText(a.business_date)!==date)) fail('一次生成只接受同一业务日期，请按日期分批');
    const wireDate=date.replaceAll('-',''),files=[],groups=Object.groupBy(selected,a=>a.file_type);
    // The MySQL auto-increment package sequence is not a TA daily-batch guarantee.
    // Use a fresh wire summary sequence under a channel/day lock, across every workspace.
    // An InnoDB environment row lock stays held until transaction commit, including other workspaces.
    await db.execute('SELECT id FROM ta_environments WHERE id=? FOR UPDATE',[scope.ta_environment_id]);
    {
      await db.execute(`INSERT INTO ta_daily_sequences(ta_environment_id,ta_code,distributor_code,business_date,last_summary_no)
        VALUES (?,?,?,?,1) ON DUPLICATE KEY UPDATE last_summary_no=last_summary_no+1`,[scope.ta_environment_id,scope.ta_code,scope.distributor_code,date]);
      const [[sequence]]=await db.execute(`SELECT last_summary_no FROM ta_daily_sequences WHERE ta_environment_id=? AND ta_code=? AND distributor_code=? AND business_date=?`,[scope.ta_environment_id,scope.ta_code,scope.distributor_code,date]);
      const summaryNo=sequence.last_summary_no;
      for(const [type,apps] of Object.entries(groups)){
        const info={creator:scope.distributor_code,receiver:scope.ta_code,date:wireDate,fileType:type,summaryNo,version:'22',records:apps.map(a=>a.record_json)};
        const name=dataFileName(info),bytes=buildDataFile(info);files.push({name,bytes,type,kind:'DATA',records:apps.map(a=>a.record_json),apps});
      }
      files.push({name:indexFileName({creator:scope.distributor_code,receiver:scope.ta_code,date:wireDate,fileType:'01'}),
        bytes:buildIndexFile({creator:scope.distributor_code,receiver:scope.ta_code,date:wireDate,fileNames:files.map(f=>f.name),version:'22'}),type:'OFI',kind:'INDEX'});
      const p=await savePackage('OUTBOUND',date,files);
      for(const f of files.filter(f=>f.kind==='DATA'))for(let i=0;i<f.records.length;i++)await saveRecord(p,f,f.records[i],i+1,{applicationId:f.apps[i].id});
      const ids=selected.map(a=>a.id),marks=ids.map(()=>'?').join(',');
      await db.execute(`UPDATE applications SET status='GENERATED' WHERE workspace_id=? AND chat_id=? AND run_id=? AND id IN (${marks})`,[...keys,...ids]);
      for(const a of selected)if(a.step_id)await db.execute("UPDATE workflow_steps SET status='GENERATED' WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=?",[...keys,a.step_id]);
      return {publicId:p.publicId,files:files.map(f=>({name:f.name,type:f.type,count:f.records?.length??0})),summaryNo};
    }
  }
  async function download(publicId){
    const p=await packageFor(publicId,'OUTBOUND');
    const [[foreign]]=await db.execute(`SELECT COUNT(*) AS n FROM package_runs WHERE workspace_id=? AND package_id=? AND (chat_id<>? OR run_id<>?)`,[scope.workspace_id,p.id,scope.chat_id,scope.run_id]);
    if(Number(foreign.n)>0) fail('合并文件包包含其他 chat，不能通过 chat 下载','SHARED_PACKAGE',409);
    const [[unowned]]=await db.execute('SELECT COUNT(*) AS n FROM file_records WHERE workspace_id=? AND package_id=? AND (chat_id IS NULL OR run_id IS NULL OR chat_id<>? OR run_id<>?)',[scope.workspace_id,p.id,scope.chat_id,scope.run_id]);
    if(Number(unowned.n)>0)fail('文件包含未归属当前 chat 的记录，不能下载原始文件','UNOWNED_PACKAGE_RECORD',409);
    const [files]=await db.execute('SELECT f.file_name,b.original_bytes FROM exchange_files f JOIN exchange_file_contents b ON b.workspace_id=f.workspace_id AND b.file_id=f.id WHERE f.workspace_id=? AND f.package_id=? ORDER BY f.id',[scope.workspace_id,p.id]);
    const zip=new AdmZip();for(const f of files)zip.addFile(f.file_name,f.original_bytes);
    await db.execute("INSERT INTO delivery_events(workspace_id,package_id,actor_user_id,event_type) VALUES (?,?,?,'DOWNLOADED')",[scope.workspace_id,p.id,auth.user_id]);
    if(p.delivery_status==='GENERATED')await db.execute("UPDATE exchange_packages SET delivery_status='DOWNLOADED' WHERE workspace_id=? AND id=?",[scope.workspace_id,p.id]);
    return {name:`TA-${dateText(p.business_date)}-${p.public_id.slice(0,8)}.zip`,bytes:zip.toBuffer()};
  }
  async function deliver(publicId,{evidence=''}){
    if(typeof evidence!=='string'||evidence.length>500) fail('交付备注最多 500 字');
    const p=await packageFor(publicId,'OUTBOUND');
    if(p.delivery_status==='RETURN_RECEIVED') fail('已有回传，不需要再次交付','ALREADY_RETURNED',409);
    if(p.delivery_status==='WAITING_RETURN')return {ok:true,duplicate:true};
    await db.execute("UPDATE exchange_packages SET delivery_status='WAITING_RETURN' WHERE workspace_id=? AND id=?",[scope.workspace_id,p.id]);
    await db.execute("INSERT INTO delivery_events(workspace_id,package_id,actor_user_id,event_type,evidence) VALUES (?,?,?,'DELIVERY_CONFIRMED',?)",[scope.workspace_id,p.id,auth.user_id,evidence]);
    const apps=await query('SELECT application_id FROM file_records WHERE workspace_id=? AND chat_id=? AND run_id=? AND package_id=?',[p.id]);
    for(const a of apps){
      await db.execute("UPDATE applications SET status='WAITING_RETURN' WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=? AND status='GENERATED'",[...keys,a.application_id]);
      await db.execute("UPDATE workflow_steps s JOIN applications a ON a.workspace_id=s.workspace_id AND a.chat_id=s.chat_id AND a.run_id=s.run_id AND a.step_id=s.id SET s.status='WAITING_RETURN' WHERE a.workspace_id=? AND a.chat_id=? AND a.run_id=? AND a.id=? AND a.status='WAITING_RETURN'",[...keys,a.application_id]);
    }return {ok:true};
  }
  async function inspect(publicId){
    const p=await packageFor(publicId),[files]=await db.execute('SELECT file_name,file_type,file_kind,record_count,byte_length,error_detail FROM exchange_files WHERE workspace_id=? AND package_id=?',[scope.workspace_id,p.id]);
    const records=await query('SELECT record_index,record_json,match_status,match_reason FROM file_records WHERE workspace_id=? AND chat_id=? AND run_id=? AND package_id=? ORDER BY file_id,record_index LIMIT 100',[p.id]);
    // Unknown records have no run ownership. Return only quarantine count, never their identities or raw fields.
    const [[unmatched]]=await db.execute("SELECT COUNT(*) AS count FROM file_records WHERE workspace_id=? AND package_id=? AND chat_id IS NULL",[scope.workspace_id,p.id]);
    return {package:{publicId:p.public_id,direction:p.direction,parseStatus:p.parse_status},files,records,unmatched:unmatched.count};
  }
  async function quarantine(p,f,r,index,reason,summary){
    await saveRecord(p,f,r,index,{status:'UNMATCHED',reason,owned:false});summary.unmatched++;
  }
  async function processRecord(p,f,r,index,summary){
      if(f.type==='05'){await snapshot(p,f,r,index,summary);return;}
      const [a]=await query(`SELECT a.*,t.transaction_account_no,t.branch_code,c.certificate_type,c.certificate_no
        FROM applications a JOIN trading_accounts t ON t.workspace_id=a.workspace_id AND t.chat_id=a.chat_id AND t.run_id=a.run_id AND t.id=a.trading_account_id
        JOIN test_customers c ON c.workspace_id=a.workspace_id AND c.chat_id=a.chat_id AND c.run_id=a.run_id AND c.id=a.customer_id
        WHERE a.workspace_id=? AND a.chat_id=? AND a.run_id=? AND a.app_no=? FOR UPDATE`,[r.AppSheetSerialNo??'']);
      const reason=matchReason(a,r,f);
      if(reason){await saveRecord(p,f,r,index,{status:a?'CONFLICT':'UNMATCHED',reason,owned:false,applicationId:null});summary.unmatched++;return;}
      if(r.TAAccountID){
        const [[existing]]=await db.execute('SELECT workspace_id,chat_id,run_id,customer_id FROM ta_accounts WHERE ta_environment_id=? AND ta_code=? AND ta_account_no=?',[scope.ta_environment_id,scope.ta_code,r.TAAccountID]);
        if(existing&&(!equal(existing.workspace_id,scope.workspace_id)||!equal(existing.chat_id,scope.chat_id)||!equal(existing.run_id,scope.run_id)||!equal(existing.customer_id,a.customer_id))){
          await quarantine(p,f,r,index,'TA 账号与申请归属冲突；记录已隔离',summary);return;
        }
      }
      const source=await saveRecord(p,f,r,index,{applicationId:a.id});
      const key=hash(stringify([a.app_no,f.type,r.BusinessCode,r.TASerialNO||hash(stringify(r)),r.TransactionCfmDate,r.FundCode,r.ShareClass]));
      const [prior]=await query('SELECT record_json FROM confirmations WHERE workspace_id=? AND chat_id=? AND run_id=? AND application_id=? AND confirmation_key=? FOR UPDATE',[a.id,key]);
      if(prior){
        const unchanged=canonical(prior.record_json)===canonical(r);
        if(!unchanged)await db.execute("UPDATE file_records SET match_status='CONFLICT',match_reason='同一 TA 确认键内容发生变化，需要人工核对' WHERE workspace_id=? AND id=?",[scope.workspace_id,source]);
        summary[unchanged?'duplicate':'unmatched']++;return;
      }
      if(['CONFIRMED','FAILED','CANCELED'].includes(a.status)){
        await db.execute("UPDATE file_records SET match_status='CONFLICT',match_reason='申请已经结束，新的确认记录需要人工核对' WHERE workspace_id=? AND id=?",[scope.workspace_id,source]);summary.unmatched++;return;
      }
      const outcome=r.ReturnCode==='0000'?(r.BusinessFinishFlag==='0'?'PARTIAL':'SUCCESS'):'FAILURE';
      const [c]=await db.execute(`INSERT INTO confirmations(workspace_id,chat_id,run_id,application_id,application_file_type,file_record_id,file_type,business_code,
        confirmation_key,return_code,error_detail,dictionary_reason,ta_serial_no,confirmation_date,application_date,confirmed_amount,confirmed_volume,nav,charge,fee_rate,business_finish_flag,outcome,record_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[...keys,a.id,a.file_type,source,f.type,r.BusinessCode,key,r.ReturnCode,r.ErrorDetail??null,RETURN_CODES[r.ReturnCode]??'未收录的 TA 返回代码',r.TASerialNO??null,
          dateFromWire(r.TransactionCfmDate),dateFromWire(r.TransactionDate),r.ConfirmedAmount??null,r.ConfirmedVol??null,r.NAV??null,r.Charge??null,r.RateFee??null,r.BusinessFinishFlag??null,outcome,stringify(r)]);
      summary[outcome.toLowerCase()]++;
      if(outcome!=='FAILURE'){
        const note=f.type==='02'?await accountEffect(a,r,c.insertId):await positionEffect(a,r,c.insertId,key);
        if(note){summary.review++;await db.execute('UPDATE file_records SET match_reason=? WHERE workspace_id=? AND id=?',[note,scope.workspace_id,source]);}
      }
      const appStatus=outcome==='FAILURE'?'FAILED':outcome==='PARTIAL'?'PARTIAL':'CONFIRMED',stepStatus=outcome==='FAILURE'?'FAILED':outcome==='PARTIAL'?'WAITING_RETURN':'PASSED';
      await db.execute('UPDATE applications SET status=? WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=?',[appStatus,...keys,a.id]);
      if(a.step_id)await db.execute('UPDATE workflow_steps SET status=? WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=?',[stepStatus,...keys,a.step_id]);

  }
  async function finishOutgoing(){
    // Mark only an outgoing package whose applications have all received final confirmations.
    const outgoing=await query(`SELECT p.id FROM package_runs pr JOIN exchange_packages p ON p.workspace_id=pr.workspace_id AND p.id=pr.package_id
      WHERE pr.workspace_id=? AND pr.chat_id=? AND pr.run_id=? AND p.direction='OUTBOUND'`,[]);
    for(const out of outgoing){
      const [[pending]]=await db.execute(`SELECT COUNT(*) AS n FROM file_records f JOIN applications a ON a.workspace_id=f.workspace_id AND a.chat_id=f.chat_id AND a.run_id=f.run_id AND a.id=f.application_id
        WHERE f.workspace_id=? AND f.package_id=? AND a.status NOT IN ('CONFIRMED','FAILED','CANCELED')`,[scope.workspace_id,out.id]);
      if(Number(pending.n)===0)await db.execute("UPDATE exchange_packages SET delivery_status='RETURN_RECEIVED' WHERE workspace_id=? AND id=?",[scope.workspace_id,out.id]);
    }
  }
  function matchReason(a,r,f){
    if(!a)return '未匹配到申请；记录已隔离';
    if(!['GENERATED','DELIVERED','WAITING_RETURN','PARTIAL','CONFIRMED','FAILED','CANCELED'].includes(a.status))return '申请尚未生成文件，不能接受回传';
    if(a.file_type!==(f.type==='02'?'01':'03'))return '返回文件类型与原申请不符';
    if(!equal(r.DistributorCode,scope.distributor_code)||!equal(r.TransactionAccountID,a.transaction_account_no))return '机构或交易账号与原申请不符';
    if(!equal(r.BusinessCode,a.file_type==='01'?String(Number(a.business_code)+100).padStart(3,'0'):confirmationCodeFor(a.business_code)))return '确认业务代码与原申请不符';
    if(!equal(r.TransactionDate,dateText(a.business_date).replaceAll('-','')))return '原申请日期不符';
    if(!/^\d{4}$/.test(r.ReturnCode??''))return '返回代码缺失或格式错误';
    try{dateFromWire(r.TransactionCfmDate);if(r.TransactionCfmDate<r.TransactionDate)return '确认日期早于申请日期';}catch{return '确认日期无效';}
    if(r.BranchCode&&!equal(r.BranchCode,a.branch_code))return '网点与原申请不符';
    if(a.file_type==='03'&&(!equal(r.FundCode,a.fund_code)||!equal(r.ShareClass,a.share_class)))return '基金或份额类别与原申请不符';
    if(a.ta_account_no&&((r.ReturnCode==='0000'&&a.file_type==='03')||r.TAAccountID)&&!equal(r.TAAccountID,a.ta_account_no))return 'TA 账号与原申请不符或缺失';
    if(a.file_type==='01'&&r.CertificateNo&&(!equal(r.CertificateNo,a.certificate_no)||!equal(r.CertificateType,a.certificate_type)))return '证件与原申请不符';
    if(r.ReturnCode==='0000'&&a.business_code==='001'&&(!r.TAAccountID||!/^\w{1,12}$/.test(r.TAAccountID)))return '成功开户确认缺少有效 TA 账号';
    if(r.ReturnCode==='0000'&&a.file_type==='03'&&['020','022','024','026','031','032','036'].includes(a.business_code)&&(!r.ConfirmedVol||!r.TASerialNO))return '成功交易确认缺少确认份额或 TA 流水号';
    return null;
  }
  async function accountEffect(a,r,confirmationId){
    if(a.business_code==='001'){
      const [linked]=await query('SELECT a.ta_account_no FROM trading_account_links l JOIN ta_accounts a ON a.workspace_id=l.workspace_id AND a.chat_id=l.chat_id AND a.run_id=l.run_id AND a.id=l.ta_account_id WHERE l.workspace_id=? AND l.chat_id=? AND l.run_id=? AND l.trading_account_id=?',[a.trading_account_id]);
      if(linked&&!equal(linked.ta_account_no,r.TAAccountID))return 'TA 返回成功，但当前交易账号已绑定其他 TA 账号，未自动替换，请人工核对';
      const [[existing]]=await db.execute('SELECT workspace_id,chat_id,run_id,customer_id,id FROM ta_accounts WHERE ta_environment_id=? AND ta_code=? AND ta_account_no=?',[scope.ta_environment_id,scope.ta_code,r.TAAccountID]);
      if(existing&&(!equal(existing.workspace_id,scope.workspace_id)||!equal(existing.chat_id,scope.chat_id)||!equal(existing.run_id,scope.run_id)||!equal(existing.customer_id,a.customer_id))) fail('TA 返回的基金账号已属于其他客户或 chat，整批未回写','CROSS_CHAT_TA_ACCOUNT',409);
      let ta=existing?.id;
      if(!ta){const [newAccount]=await db.execute(`INSERT INTO ta_accounts(workspace_id,chat_id,run_id,customer_id,ta_environment_id,ta_code,distributor_code,ta_account_no,source_confirmation_id)
        VALUES (?,?,?,?,?,?,?,?,?)`,[...keys,a.customer_id,scope.ta_environment_id,scope.ta_code,scope.distributor_code,r.TAAccountID,confirmationId]);ta=newAccount.insertId;}
      await db.execute('INSERT INTO trading_account_links(workspace_id,chat_id,run_id,customer_id,trading_account_id,ta_account_id) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE ta_account_id=VALUES(ta_account_id)',[...keys,a.customer_id,a.trading_account_id,ta]);
      await db.execute("UPDATE trading_accounts SET status='ACTIVE' WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=?",[...keys,a.trading_account_id]);return null;
    }
    const statuses={'002':'REVOKED','004':'FROZEN','005':'ACTIVE','006':'LOST','007':'ACTIVE','009':'REVOKED'};
    if(statuses[a.business_code])await db.execute('UPDATE trading_accounts SET status=? WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=?',[statuses[a.business_code],...keys,a.trading_account_id]);
    return a.business_code==='008'?'TA 业务成功；新增交易账户绑定需要人工核对':null;
  }
  async function positionEffect(a,r,confirmationId,key){
    if(!['020','022','024','031','032'].includes(a.business_code))return ['029','040','041','052','070'].includes(a.business_code)?null:'TA 业务成功；此业务的持仓变化请使用 05 对账核对';
    const [link]=await query('SELECT ta_account_id FROM trading_account_links WHERE workspace_id=? AND chat_id=? AND run_id=? AND trading_account_id=?',[a.trading_account_id]);
    if(!link)return 'TA 业务成功；缺少当前 chat 的开户确认，持仓未自动回写';
    const volume=units(r.ConfirmedVol);if(volume<0n)return 'TA 确认份额为负，需要人工核对';
    await db.execute(`INSERT IGNORE INTO positions(workspace_id,chat_id,run_id,customer_id,trading_account_id,ta_account_id,fund_code,share_class,branch_code)
      VALUES (?,?,?,?,?,?,?,?,?)`,[...keys,a.customer_id,a.trading_account_id,link.ta_account_id,a.fund_code,a.share_class,a.branch_code]);
    const [p]=await query('SELECT * FROM positions WHERE workspace_id=? AND chat_id=? AND run_id=? AND trading_account_id=? AND fund_code=? AND share_class=? AND branch_code=? FOR UPDATE',[a.trading_account_id,a.fund_code,a.share_class,a.branch_code]);
    let available=units(p.available_volume),frozen=units(p.frozen_volume),total=units(p.total_volume),delta=0n,frozenDelta=0n;
    if(['020','022'].includes(a.business_code)){delta=volume;available+=volume;total+=volume;}
    if(a.business_code==='024'){delta=-volume;available-=volume;total-=volume;}
    if(a.business_code==='031'){available-=volume;frozen+=volume;frozenDelta=volume;}
    if(a.business_code==='032'){available+=volume;frozen-=volume;frozenDelta=-volume;}
    if(available<0n||frozen<0n||total<0n||available+frozen>total)return 'TA 业务成功；确认份额与本地持仓冲突，未自动修改，请上传 05 核对';
    await db.execute('UPDATE positions SET available_volume=?,frozen_volume=?,total_volume=? WHERE workspace_id=? AND chat_id=? AND run_id=? AND id=?',[fromUnits(available),fromUnits(frozen),fromUnits(total),...keys,p.id]);
    await db.execute('INSERT INTO position_movements(workspace_id,chat_id,run_id,position_id,confirmation_id,effect_key,business_code,volume_delta,frozen_delta) VALUES (?,?,?,?,?,?,?,?,?)',[...keys,p.id,confirmationId,key,a.business_code,fromUnits(delta),fromUnits(frozenDelta)]);
    return null;
  }
  async function snapshot(p,file,r,index,summary){
    const [account]=await query(`SELECT t.* FROM trading_accounts t JOIN trading_account_links l ON l.workspace_id=t.workspace_id AND l.chat_id=t.chat_id AND l.run_id=t.run_id AND l.trading_account_id=t.id
      JOIN ta_accounts a ON a.workspace_id=l.workspace_id AND a.chat_id=l.chat_id AND a.run_id=l.run_id AND a.id=l.ta_account_id
      WHERE t.workspace_id=? AND t.chat_id=? AND t.run_id=? AND t.transaction_account_no=? AND a.ta_account_no=?`,[r.TransactionAccountID??'',r.TAAccountID??'']);
    if(!account||!equal(r.DistributorCode,scope.distributor_code)){
      await saveRecord(p,file,r,index,{status:'UNMATCHED',reason:'05 未匹配到当前 chat 已确认账户',owned:false});summary.unmatched++;return;
    }
    if(!r.FundCode||!r.TransactionCfmDate||r.AvailableVol==null||r.TotalFrozenVol==null||r.TotalVolOfDistributorInTA==null||r.WholeFlag&&!['0','1'].includes(r.WholeFlag)){
      await saveRecord(p,file,r,index,{status:'CONFLICT',reason:'05 份额或日期字段缺失，未生成快照'});summary.unmatched++;return;
    }
    try{dateFromWire(r.TransactionCfmDate);}catch{
      await saveRecord(p,file,r,index,{status:'CONFLICT',reason:'05 快照日期无效'});summary.unmatched++;return;
    }
    const record=await saveRecord(p,file,r,index);
    const [s]=await db.execute(`INSERT INTO position_snapshots(workspace_id,chat_id,run_id,trading_account_id,file_record_id,fund_code,share_class,branch_code,snapshot_date,
      available_volume,frozen_volume,total_volume,whole_flag,detail_flag,share_register_date,source_type,ta_serial_no,record_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[...keys,account.id,record,r.FundCode,r.ShareClass??null,r.BranchCode??null,dateFromWire(r.TransactionCfmDate),r.AvailableVol??'0.00',r.TotalFrozenVol??'0.00',r.TotalVolOfDistributorInTA??'0.00',r.WholeFlag??null,r.DetailFlag??null,r.ShareRegisterDate?dateFromWire(r.ShareRegisterDate):null,r.SourceType??null,r.TASerialNO??null,stringify(r)]);
    const [position]=await query('SELECT id,total_volume FROM positions WHERE workspace_id=? AND chat_id=? AND run_id=? AND trading_account_id=? AND fund_code=? AND share_class=? AND branch_code=?',[account.id,r.FundCode,r.ShareClass??'',r.BranchCode??'']);
    if(position){
      const difference=units(r.TotalVolOfDistributorInTA??'0.00')-units(position.total_volume);
      // WholeFlag alone does not make a detail row a total snapshot. Do not overwrite or zero missing holdings.
      const status=r.DetailFlag==='0'&&r.WholeFlag==='1'?(difference===0n?'MATCHED':'DIFFERENT'):'REVIEW';
      await db.execute('INSERT INTO reconciliations(workspace_id,chat_id,run_id,position_id,snapshot_id,sales_volume,ta_volume,difference,status) VALUES (?,?,?,?,?,?,?,?,?)',[...keys,position.id,s.insertId,position.total_volume,r.TotalVolOfDistributorInTA??'0.00',fromUnits(difference),status]);
    }
    summary.snapshots++;
  }
  return {generate,download,deliver,inspect,savePackage,processRecord,quarantine,finishOutgoing};
}
