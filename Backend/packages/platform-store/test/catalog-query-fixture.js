import {randomBytes,randomUUID,createHash} from 'node:crypto';
import mysql from 'mysql2/promise';
import {migrationConfig} from '../src/migrate.js';
import {createCaseRepository,sessionTokenHash} from '../src/index.js';
import {createGlobalDataCatalog} from '../src/global-data-catalog.js';
import {createGlobalFileCatalog} from '../src/global-file-catalog.js';

export async function catalogFixture() {
  const db=await mysql.createConnection(migrationConfig());
  await db.beginTransaction();
  const close=async()=>{await db.rollback();await db.end();};
  try {
    const transaction=fn=>fn(db),repository=createCaseRepository({transaction});
    const owner=async()=>{
      const id=randomUUID(),token=randomBytes(32).toString('base64url');
      const [user]=await db.execute("INSERT INTO platform_users(public_id,email,password_hash,display_name) VALUES (?,?,?,'搜索合成验收')",[id,id+'@example.invalid','synthetic']);
      const [workspace]=await db.execute('INSERT INTO workspaces(public_id,owner_user_id) VALUES (?,?)',[randomUUID(),user.insertId]);
      await db.execute('INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))',[sessionTokenHash(token),user.insertId]);
      return {token,workspace:workspace.insertId};
    };
    const account=await owner(),foreign=await owner(),token=account.token,w=account.workspace;
    const chat=await repository.createChat(token,'合成搜索项目');
    const [[chatRow]]=await db.execute('SELECT id FROM case_chats WHERE workspace_id=? AND public_id=?',[w,chat.publicId]);
    const cases=[];
    for(let i=0;i<2;i++) {
      const item=await repository.createCase(token,chat.publicId,`合成查询${i+1}`);
      await repository.saveSopProposal(token,chat.publicId,item.publicId,{objective:'搜索验收',preconditions:[],scenarios:[{title:'查询',setup:'合成记录',action:'筛选',expected:'返回准确记录',evidence:'合成数据'}],openQuestions:[]});
      const [[row]]=await db.execute('SELECT k.id,s.id AS sop FROM cases k JOIN case_sop_versions s ON s.workspace_id=k.workspace_id AND s.chat_id=k.chat_id AND s.case_id=k.id WHERE k.workspace_id=? AND k.public_id=?',[w,item.publicId]);
      await db.execute("INSERT INTO case_data_executions(workspace_id,chat_id,case_id,sop_version_id,specification_json) VALUES (?,?,?,?,'{}')",[w,chatRow.id,row.id,row.sop]);
      cases.push({...row,publicId:item.publicId});
    }
    const data=createGlobalDataCatalog({transaction}),files=createGlobalFileCatalog({transaction});
    const channel=await data.saveDistributor(token,{input:{channel_name:'合成通道',ta_environment:'synthetic',ta_code:'99',distributor_code:'009',protocol_version:'22'}});
    for(let i=0;i<125;i++) {
      const item=cases[i%2],name=i===0?'含%_符号的合成客户':`合成客户${String(i).padStart(3,'0')}`;
      const [customer]=await db.execute('INSERT INTO case_generated_customers(public_id,workspace_id,chat_id,case_id,name,investor_type,simulated_balance) VALUES (?,?,?,?,?,?,?)',[randomUUID(),w,chatRow.id,item.id,name,i%3?'1':'0',i===0?'0.00':`${i}.01`]);
      if(i<2) {
        const accountNo=String(i+1).padStart(17,'0');
        await db.execute('INSERT INTO case_generated_accounts(workspace_id,chat_id,case_id,customer_id,account_no,branch_code) VALUES (?,?,?,?,?,?)',[w,chatRow.id,item.id,customer.insertId,accountNo,'009']);
      }
    }
    const [batch]=await db.execute("INSERT INTO exchange_batches(public_id,workspace_id,chat_id,channel_id,business_date,batch_number) VALUES (?,?,?,?, '2026-08-17',1)",[randomUUID(),w,chatRow.id,channel.id]);
    for(let i=0;i<3;i++) {
      const item=cases[i%2],record={TransactionAccountID:String(i%2+1).padStart(17,'0'),InvestorName:`协议客户${i%2+1}`,CertificateNo:i===0?'CERT-009':null,FundCode:'000009',ApplicationAmount:['9.99','10.01','100.00'][i],DistributorCode:'009',TransactionDate:'20260817',AppSheetSerialNo:`QUERY${i}`,IndividualOrInstitution:'1'};
      const [app]=await db.execute("INSERT INTO applications(public_id,workspace_id,chat_id,case_id,sop_version_id,channel_id,business_date,file_type,business_code,app_no,record_json,snapshot_hash,created_at) VALUES (?,?,?,?,?,?,'2026-08-17','03','022',?,?,?,?)",[randomUUID(),w,chatRow.id,item.id,item.sop,channel.id,record.AppSheetSerialNo,JSON.stringify(record),'a'.repeat(64),i===2?'2026-08-18 00:00:00.000':'2026-08-17 23:59:59.999']);
      await db.execute("INSERT INTO batch_applications(workspace_id,chat_id,channel_id,batch_id,application_id,file_type) VALUES (?,?,?,?,?,'03')",[w,chatRow.id,channel.id,batch.insertId,app.insertId]);
    }
    const bytes=Buffer.from('synthetic query file'),sha=createHash('sha256').update(bytes).digest('hex');
    await db.execute("INSERT INTO exchange_files(workspace_id,channel_id,chat_id,batch_id,direction,file_type,file_name,content_sha256,raw_bytes,record_count) VALUES (?,?,?,?,'OUTBOUND','03','OFD_QUERY.TXT',?,?,3)",[w,channel.id,chatRow.id,batch.insertId,sha,bytes]);
    const [parsed]=await db.execute("INSERT INTO case_return_parses(workspace_id,chat_id,case_id,batch_id,expected_type,content_sha256,parsed_json,actor_user_id) SELECT ?,?,?,?,'04',?,?,owner_user_id FROM workspaces WHERE id=?",[w,chatRow.id,cases[0].id,batch.insertId,sha,JSON.stringify({files:[{fileName:'OFD_RETURN.TXT',fileType:'04',date:'20260818'}]}),w]);
    await db.execute("INSERT INTO case_return_parse_files(workspace_id,chat_id,case_id,parse_id,file_name,content_sha256,raw_bytes) VALUES (?,?,?,?,'OFD_RETURN.TXT',?,?)",[w,chatRow.id,cases[0].id,parsed.insertId,sha,bytes]);
    return {db,data,files,token,foreign:foreign.token,cases,project:chat.publicId,close};
  }catch(error){await close();throw error;}
}
