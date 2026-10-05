import {createAgentStore,canonical,hash,reject} from './store.js';
import {readFacts} from './facts.js';
import {componentSchemas} from './component-schema.js';
import {refreshComponents,transition,assertNoNewInput} from './component-state.js';
import {defineCustomer,defineAccount,defineFund,validateData,prepareApplication,generateFile,waitDelivery} from './component-data.js';
import {receiveReturn,validateResult,reconcilePosition} from './component-returns.js';
import {evaluateCase,archiveCase} from './component-verdict.js';

export const componentHandlers={
  'customer.define':defineCustomer,'account.define':defineAccount,'fund.define':defineFund,'data.validate':validateData,
  'application.prepare':prepareApplication,'file.generate':generateFile,'file.deliver':waitDelivery,'return.receive':receiveReturn,
  'result.validate':validateResult,'position.reconcile':reconcilePosition,'case.evaluate':evaluateCase,'case.archive':archiveCase,
};
if(Object.keys(componentSchemas).some(k=>!componentHandlers[k]))throw new Error('Missing component handler');

const waitingCodes=new Set(['WAITING_05','ACCOUNT_NOT_CONFIRMED','ACCOUNT_STATUS','INSUFFICIENT_CONFIRMED_POSITION','ARCHIVE_BLOCKED']);
const reviewCodes=new Set(['POSITION_REVIEW','DATA_REVIEW','RESULT_REVIEW']);
export function createComponentService(options) {
  const {token,ids,leaseToken,eventId}=options,store=createAgentStore(options);
  const scoped=(fn,{write=false}={})=>store.withScope(token,ids,fn,{write,leaseToken});
  async function state({refresh=false}={}) {
    return scoped(async ctx=>{
      if(refresh)await assertNoNewInput(ctx,eventId);
      const data=await readFacts(ctx,token,ids);
      if(refresh&&data.plan?.schemaVersion===2)data.components=await refreshComponents(ctx,data.plan);
      return {...data,planVersion:ctx.runtime?.plan_version,executionVersion:ctx.runtime?.execution_version,
        archived:ctx.runtime?.status==='ARCHIVED'};
    },{write:refresh});
  }
  async function execute({stepId,planVersion}) {
    // This read also allows recovery after a committed archive closed the run.
    const cached=await scoped(async ctx=>{
      const data=await readFacts(ctx,token,ids),step=data.plan?.steps.find(s=>s.id===stepId);
      if(ctx.runtime?.plan_version!==planVersion)reject('计划已更新','PLAN_CONFLICT',409);
      if(!step||data.plan.schemaVersion!==2)reject('组件不存在','STEP_NOT_FOUND',404);
      const [[row]]=await ctx.db.execute('SELECT input_hash,result_json FROM agent_actions WHERE workspace_id=? AND chat_id=? AND run_id=? AND action_key=?',[...ctx.keys,'component:'+stepId]);
      if(row&&row.input_hash!==hash(step))reject('组件身份冲突','ACTION_CONFLICT',409);
      return {step,result:row?{...row.result_json,replayed:true}:null};
    });
    if(cached.result)return cached.result;
    return store.perform(token,ids,{toolName:cached.step.kind,actionKey:'component:'+stepId,input:cached.step,stepId,planVersion,leaseToken},async ctx=>{
      await assertNoNewInput(ctx,eventId);
      const data=await readFacts(ctx,token,ids),rows=await refreshComponents(ctx,data.plan);
      const row=rows.find(r=>r.step_key===stepId),step=data.plan.steps.find(s=>s.id===stepId);
      if(!['READY','WAITING_INPUT','REVIEW'].includes(row.status))reject('组件尚不满足依赖或已执行','DEPENDENCY_NOT_READY',409);
      await transition(ctx,row,'RUNNING');
      await ctx.db.query('SAVEPOINT component_effect');
      const result=await runHandler({...ctx,...data,components:rows,token,ids},step);
      const status=result.componentStatus??(result.waiting?'WAITING_INPUT':'SUCCEEDED');
      await transition(ctx,row,status,{output:result.waiting?undefined:result,wait:result.wait,error:result.ok===false?result:undefined});
      return {...result,componentId:step.id,componentStatus:status,...(status==='REVIEW'?{waiting:true}:{})};
    });
  }
  async function start(planVersion) {
    return scoped(async ctx=>{
      await assertNoNewInput(ctx,eventId);
      if(ctx.runtime.plan_version!==planVersion)reject('计划已更新','PLAN_CONFLICT',409);
      const data=await readFacts(ctx,token,ids);
      if(data.plan?.schemaVersion!==2)reject('execute_plan只用于组件计划','PLAN_INVALID');
      await ctx.db.execute('UPDATE agent_runs SET execution_version=?,wait_json=NULL WHERE workspace_id=? AND chat_id=? AND run_id=?',[planVersion,...ctx.keys]);
      return {ok:true,planVersion};
    },{write:true});
  }
  async function saveWait(data) {
    return scoped(async ctx=>{
      await assertNoNewInput(ctx,eventId);
      const pending=data.components.filter(r=>!['SUCCEEDED','SKIPPED','CANCELED'].includes(r.status));
      const wait={category:pending.some(r=>['REVIEW','FAILED'].includes(r.status))?'REVIEW':'RETURN',
        reason:pending.length?'等待外部输入或人工核对':'全部组件已完成',planVersion:data.planVersion,
        files:componentDownloads(data),
        components:pending.map(r=>({id:r.step_key,status:r.status,...r.wait_json,error:r.error_json}))};
      await ctx.db.execute('UPDATE agent_runs SET wait_json=? WHERE workspace_id=? AND chat_id=? AND run_id=?',[pending.length?canonical(wait):null,...ctx.keys]);
      return wait;
    },{write:true});
  }
  return {state,execute,start,saveWait};
}

export function componentDownloads(data) {
  return data.components.filter(r=>r.kind==='file.generate'&&r.status==='SUCCEEDED').flatMap(r=>{
    const output=r.output_json,pack=data.facts.packages.find(p=>p.public_id===output.packageId);
    if(!pack||pack.delivery_status==='RETURN_RECEIVED')return [];
    const definition=data.plan.steps.find(s=>s.id===r.step_key);
    return [{componentId:r.step_key,packageId:output.packageId,downloadUrl:output.downloadUrl,files:output.files,
      deliveryStatus:pack.delivery_status,applications:definition.params.applicationStepIds.map(id=>{
        const s=data.plan.steps.find(step=>step.id===id);return {stepId:id,fileType:s.params.fileType,businessCode:s.params.businessCode,businessDate:s.params.businessDate};
      })}];
  });
}

async function runHandler(ctx,step) {
  try{return await componentHandlers[step.kind](ctx,step);}
  catch(error){
    if(error.code==='NEW_INPUT'||error.code==='LEASE_LOST'||!(error.status>=400&&error.status<500))throw error;
    await ctx.db.query('ROLLBACK TO SAVEPOINT component_effect');
    if(waitingCodes.has(error.code))return {ok:true,waiting:true,wait:{category:'INPUT',code:error.code,reason:error.message}};
    return {ok:false,componentStatus:reviewCodes.has(error.code)?'REVIEW':'FAILED',code:error.code,reason:error.message};
  }
}
