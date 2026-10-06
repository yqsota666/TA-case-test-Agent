import {authenticateSession,storeError} from './index.js';
import {validExchangePlan} from '../../platform-protocol/src/exchange-plan.js';
import {checkExchangeOrder,recordExchangeEvent,exchangeOrderContext} from './exchange-order.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = value => typeof value === 'string' ? JSON.parse(value) : value;
const fail = (code,message) => {throw storeError(code,409,message);};
export function createExchangePlanSupplementRepository({transaction}) {
  async function confirm(token,input) {
    if (![input.chatPublicId,input.casePublicId].every(value=>uuid.test(value??'')) ||
        !Number.isSafeInteger(input.baseVersionNumber) || input.baseVersionNumber<1 ||
        !validExchangePlan(input.exchangePlan) || input.exchangePlan.status!=='READY' ||
        !Array.isArray(input.mappings) || input.mappings.length>100 ||
        new Set(input.mappings.map(mapping=>mapping?.stepId)).size!==input.mappings.length ||
        !input.mappings.every(mapping=>mapping && Object.keys(mapping).length===3 &&
          typeof mapping.stepId==='string' && uuid.test(mapping.batchPublicId??'') &&
          Array.isArray(mapping.parseIds) && mapping.parseIds.length<=100 &&
          new Set(mapping.parseIds.map(String)).size===mapping.parseIds.length &&
          mapping.parseIds.every(value=>/^[1-9]\d{0,18}$/.test(String(value))))) {
      throw storeError('INVALID_INPUT',400,'时序计划、基础版本或文件映射无效');
    }
    return transaction(async db=>{
      const auth=await authenticateSession(db,token);
      const [[owner]]=await db.execute(`SELECT c.id AS chat_id,k.id AS case_id,c.status AS chat_status,k.status AS case_status
        FROM case_chats c JOIN cases k ON k.workspace_id=c.workspace_id AND k.chat_id=c.id
        WHERE c.workspace_id=? AND c.public_id=? AND k.public_id=? FOR UPDATE`,
        [auth.workspace_id,input.chatPublicId,input.casePublicId]);
      if(!owner)throw storeError('CASE_NOT_FOUND',404,'Case不存在');
      if(owner.chat_status!=='ACTIVE' || ['PASS','FAIL'].includes(owner.case_status))fail('CASE_NOT_WRITABLE','Case已结束，不能补充时序');
      const keys=[auth.workspace_id,owner.chat_id,owner.case_id];
      const [[base]]=await db.execute(`SELECT version_number,plan_json,status FROM case_sop_versions
        WHERE workspace_id=? AND chat_id=? AND case_id=? ORDER BY version_number DESC LIMIT 1 FOR UPDATE`,keys);
      if(!base || base.status!=='LOCKED' || Number(base.version_number)!==input.baseVersionNumber)fail('STALE_PLAN','请刷新最新已锁定Plan');
      const original=json(base.plan_json);
      if(original.exchangePlan?.status==='READY')fail('EXCHANGE_PLAN_ALREADY_DEFINED','已确认的时序不可通过补充入口改写');
      const mappings=[];
      for(const mapping of input.mappings) {
        const step=input.exchangePlan.steps.find(step=>step.stepId===mapping.stepId);
        if(!step || step.fileType==='05')fail('EXCHANGE_MAPPING_INVALID','映射步骤不存在或05尚不支持导入事实');
        const outbound=step.direction==='SEND'?step.fileType:step.fileType==='02'?'01':'03';
        const [[batch]]=await db.execute(`SELECT DISTINCT b.id,b.status,DATE_FORMAT(b.business_date,'%Y%m%d') AS business_date
          FROM exchange_batches b JOIN batch_applications ba ON ba.workspace_id=b.workspace_id AND ba.chat_id=b.chat_id AND ba.batch_id=b.id
          JOIN applications a ON a.workspace_id=ba.workspace_id AND a.chat_id=ba.chat_id AND a.id=ba.application_id
          WHERE b.workspace_id=? AND b.chat_id=? AND b.public_id=? AND a.case_id=? AND a.file_type=? FOR UPDATE`,
          [keys[0],keys[1],mapping.batchPublicId,keys[2],outbound]);
        if(!batch)fail('EXCHANGE_MAPPING_INVALID','映射批次不属于此Case和文件类型');
        if(step.direction==='SEND' && mapping.parseIds.length)fail('EXCHANGE_MAPPING_INVALID','发送步骤不能映射解析包');
        const parses=[];
        for(const parseId of mapping.parseIds) {
          const [[parsed]]=await db.execute(`SELECT id,expected_type,parsed_json FROM case_return_parses
            WHERE workspace_id=? AND chat_id=? AND case_id=? AND id=? AND batch_id=? FOR UPDATE`,[...keys,parseId,batch.id]);
          if(!parsed || parsed.expected_type!==step.fileType)fail('EXCHANGE_MAPPING_INVALID','解析包不属于映射的Case、批次或文件类型');
          parses.push({...parsed,result:json(parsed.parsed_json)});
        }
        mappings.push({...mapping,step,batch,parses,outbound});
      }
      if(new Set(mappings.map(mapping=>String(mapping.batch.id)+mapping.step.fileType)).size!==mappings.length)fail('EXCHANGE_MAPPING_INVALID','同批同类型不能映射到多个轮次');
      const version=Number(base.version_number)+1;
      await db.execute(`INSERT INTO case_sop_versions
        (workspace_id,chat_id,case_id,version_number,plan_json,status,locked_at) VALUES (?,?,?,?,?,'LOCKED',UTC_TIMESTAMP(3))`,
        [...keys,version,JSON.stringify({...original,exchangePlan:input.exchangePlan})]);
      await db.execute(`INSERT INTO case_exchange_plan_supplements
        (workspace_id,chat_id,case_id,plan_version,base_version,actor_user_id,mappings_json) VALUES (?,?,?,?,?,?,?)`,
        [...keys,version,input.baseVersionNumber,auth.user_id,JSON.stringify(input.mappings)]);
      // Topological iteration reuses only mapped, actual facts. No application or business data is rewritten.
      const pending=[...mappings];
      while(pending.length) {
        let progress=false;
        for(let i=pending.length-1;i>=0;i--) {
          const mapping=pending[i];
          if(!['DELIVERED','RECEIVED'].includes(mapping.batch.status)) {
            if(mapping.step.direction==='SEND' && mapping.step.businessTime.kind==='DATE' && mapping.step.businessTime.value!==mapping.batch.business_date)fail('EXCHANGE_DATE_MISMATCH','映射批次日期与计划不符');
            await db.execute(`INSERT INTO case_exchange_plan_bindings (workspace_id,chat_id,case_id,plan_version,step_id,batch_id,file_type) VALUES (?,?,?,?,?,?,?)`,[...keys,version,mapping.stepId,mapping.batch.id,mapping.step.fileType]);
            pending.splice(i,1);progress=true;continue;
          }
          try {
            if(mapping.step.direction==='SEND') {
              const checked=await checkExchangeOrder(db,keys,{stepId:mapping.stepId,direction:'SEND',fileType:mapping.step.fileType,
                businessDate:mapping.batch.business_date,batchId:mapping.batch.id,condition:'SENT'});
              await recordExchangeEvent(db,keys,checked,{condition:'SENT',batchId:mapping.batch.id});
            } else {
              for(const parsed of mapping.parses) {
                const checked=await checkExchangeOrder(db,keys,{stepId:mapping.stepId,direction:'RECEIVE',fileType:mapping.step.fileType,
                  businessDate:parsed.result.files[0]?.date,batchId:mapping.batch.id,parseId:parsed.id,condition:'PARSED'});
                await recordExchangeEvent(db,keys,checked,{condition:'PARSED',batchId:mapping.batch.id,parseId:parsed.id});
              }
              const [[aggregate]]=await db.execute(`SELECT COUNT(*) AS n,SUM(a.status='CONFIRMED' AND r.outcome='CONFIRMED') AS confirmed
                FROM applications a JOIN batch_applications ba ON ba.workspace_id=a.workspace_id AND ba.chat_id=a.chat_id AND ba.application_id=a.id
                LEFT JOIN sales_return_confirmations r ON r.workspace_id=a.workspace_id AND r.application_id=a.id
                WHERE a.workspace_id=? AND a.chat_id=? AND a.case_id=? AND ba.batch_id=? AND a.file_type=? FOR UPDATE`,[...keys,mapping.batch.id,mapping.outbound]);
              if(Number(aggregate.n)>0 && Number(aggregate.n)===Number(aggregate.confirmed)) {
                const [sources]=await db.execute(`SELECT r.parse_id FROM sales_return_confirmations r JOIN applications a ON a.workspace_id=r.workspace_id AND a.id=r.application_id
                  JOIN batch_applications ba ON ba.workspace_id=a.workspace_id AND ba.chat_id=a.chat_id AND ba.application_id=a.id
                  WHERE a.workspace_id=? AND a.chat_id=? AND a.case_id=? AND ba.batch_id=? AND a.file_type=? FOR UPDATE`,[...keys,mapping.batch.id,mapping.outbound]);
                if(sources.some(source=>!mapping.parseIds.map(String).includes(String(source.parse_id))))fail('EXCHANGE_MAPPING_INCOMPLETE','继承成功确认需要明确映射全部确认来源解析包');
                const parsed=mapping.parses[0];
                if(!parsed)fail('EXCHANGE_MAPPING_INCOMPLETE','成功确认缺少显式解析包映射');
                const checked=await checkExchangeOrder(db,keys,{stepId:mapping.stepId,direction:'RECEIVE',fileType:mapping.step.fileType,
                  businessDate:parsed.result.files[0]?.date,batchId:mapping.batch.id,parseId:parsed.id,condition:'CONFIRMED'});
                await recordExchangeEvent(db,keys,checked,{condition:'CONFIRMED',batchId:mapping.batch.id,parseId:parsed.id});
              }
            }
            pending.splice(i,1);progress=true;
          } catch(error) { if(error.code!=='ORDER_VIOLATION')throw error; }
        }
        if(!progress)fail('ORDER_VIOLATION','现有事实不满足补充计划的前置条件，请调整明确映射，不能猜测完成步骤');
      }
      const actual=await exchangeOrderContext(db,keys);
      return {versionNumber:version,status:'LOCKED',supplemented:true,
        message:'文件时序已补充并锁定；原业务目标、场景、申请和正式数据未改写。已发送和已确认事实仅按本次明确映射继承。',
        steps:input.exchangePlan.steps.map(step=>({...step,actual:{
          sent:actual.events.some(event=>event.stepId===step.stepId && event.condition==='SENT'),
          parsedPackages:new Set(actual.events.filter(event=>event.stepId===step.stepId && event.condition==='PARSED').map(event=>String(event.parse_id))).size,
          confirmed:actual.events.some(event=>event.stepId===step.stepId && event.condition==='CONFIRMED'),
        }}))};
    });
  }
  return Object.freeze({confirm});
}
