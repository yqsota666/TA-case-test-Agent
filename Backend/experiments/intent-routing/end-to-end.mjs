import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cases} from './cases.mjs';
import {route} from './router.mjs';
import {discussionAction} from '../../../Frontend/src/discussion-actions.js';
import {createPersistedDiscussionService} from '../../packages/case-agent/src/persisted-discussion.js';
import {createSophnetCompletion} from '../../packages/case-agent/src/sophnet.js';
import {loadFundMarketDefaults,withFundMarketDefaults} from '../../packages/case-agent/src/fund-market-defaults.js';
import {workflowPosition} from '../../packages/case-agent/src/durable-workflow.js';
import {validPlanContract} from '../../packages/platform-protocol/src/plan-contract.js';

const output=fileURLToPath(new URL('../../../.context/intent-routing/',import.meta.url));
mkdirSync(output,{recursive:true});
const completeContext=process.env.EXPERIMENT_COMPLETE_CONTEXT==='1';
const resultFile=output+(completeContext?'end-to-end-complete-context.json':'end-to-end-results.json');
const apiKey=execFileSync('security',['find-generic-password','-s','codex.sophnet.ta-case-test-agent','-a','api-key','-w'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
const provider=createSophnetCompletion({apiKey,maxTokens:8192});
const channels=[{id:'926',name:'网商银行',environment:'LOCAL',taCode:'27',distributorCode:'926',protocolVersion:'22'}];
const scope={token:'memory-only',chatPublicId:'synthetic-chat',casePublicId:'synthetic-case'};
const recovering=process.env.EXPERIMENT_RETRY_ERRORS==='1';
const results=recovering?JSON.parse(readFileSync(resultFile,'utf8')):[];
const latestBefore=[...new Map(results.map(r=>[`${r.id}:${r.method}`,r])).values()];
const jobs=recovering?latestBefore.filter(r=>r.error?.message==='PROVIDER_HTTP_429').map(r=>[r.id,r.method]):completeContext?[['incident_complete_context','tools']]:[['incident_can_generate','baseline'],['incident_can_generate','json'],['incident_can_generate','tools'],['four_cases','json'],['noncomparison','json']];
for(const [id,method] of jobs){
  let c=cases.find(c=>c.id===(completeContext?'incident_can_generate':id));
  if(completeContext){
    c=structuredClone(c);c.id=id;
    c.input.history[5].content='好，金额改为2,000.00元，其他条件沿用销售商926（网商银行）本地模拟通道。以下是草稿模拟数据，带【模拟假设】的字段都可以再改。账户申请01：销售商926，网点926，TA27，协议22，客户陈思远【模拟假设】，证件与手机号由系统合理模拟，交易账号不预填，由系统生成后关联。申购申请03：业务日期20260817，基金270008，份额类别0，申购金额2,000.00元，模拟净值1.00000000，前收费0.00元，计算费用0.00元，预期确认份额2,000.00份。预期回传：02账户确认成功；04申购确认成功，确认金额2,000.00元，确认份额2,000.00份，费用0.00元。当前仍是草稿模拟，不表示已向TA发起或已有正式账户、持仓。后续进入待审阅方案时，再在界面点击确认预期，不用聊天代替。';
  }
  const started=performance.now(),trace=[],rounds=[];
  let saved=null;
  const repository={
    assertCaseWritable:async()=>{},
    readCaseDiscussion:async()=>({revision:c.input.history.length/2,turns:c.input.history,pending:null}),
    beginCaseDiscussionTurn:async(_t,_ch,_ca,turn)=>{rounds.push(turn);return {turnNumber:turn.expectedRevision+1};},
    finishCaseDiscussionTurn:async(_t,_ch,_ca,turn)=>({revision:turn.turnNumber}),
    finishCasePlanProposal:async(_t,_ch,_ca,turn)=>{saved=turn;return {revision:turn.turnNumber,versionNumber:1};},
    abandonCaseDiscussionTurn:async()=>{},
    getLatestSopProposal:async()=>null,
  };
  const complete=withFundMarketDefaults(async request=>{
    const start=performance.now();
    try{const reply=await provider(request);trace.push({request,reply,latencyMs:Math.round(performance.now()-start)});console.log(JSON.stringify({id,method,modelCall:trace.length,latencyMs:trace.at(-1).latencyMs}));return reply;}
    catch(error){trace.push({request,error:{code:error.code,message:error.message},latencyMs:Math.round(performance.now()-start)});throw error;}
  },loadFundMarketDefaults());
  const service=createPersistedDiscussionService({repository,complete,readChannels:async()=>({channels}),readContext:async()=>({readOnly:true,stage:'DISCUSSION',plan:null,confirmations:{preparation:false,expectations:false}})});
  const row={id,method,attempt:(latestBefore.find(r=>r.id===id&&r.method===method)?.attempt||0)+1,input:c.input,repository:'in-memory only; no business database access',model:'DeepSeek-V4-Pro-0813'};
  try{
    const decision=method==='baseline'?{intent:discussionAction({text:c.input.userInput,waiting:c.input.allowedActions,messages:c.input.history.map(t=>({role:t.role,text:t.content}))})}:(await route({method,input:c.input,apiKey})).decision;
    row.decision=decision;
    const result=await service[decision.intent==='PROPOSE_PLAN'?'propose':'discuss']({...scope,userInput:c.input.userInput});
    row.result=result;
    row.savedProposal=!!saved;
    row.contractValid=saved?validPlanContract(saved.proposal.contract,saved.proposal):null;
    row.position=workflowPosition({chatStatus:'ACTIVE',caseStatus:saved?'SOP_PENDING':'DISCUSSING',plan:saved?{status:'PENDING_CONFIRMATION',proposal:saved.proposal}:null,dataConfirmed:false});
    if(saved){
      assert.equal(row.contractValid,true);
      assert.equal(row.position.stage,'CONFIRM_PLAN_DATA');
      assert.equal(result.phase,'PROPOSAL_PENDING');
      if(id==='incident_can_generate'||id==='incident_complete_context'){
        const p=saved.proposal;
        assert.equal(p.exchangePlan.status,'READY');
        assert.equal(p.contract.applications.length,2);
        assert.equal(p.contract.applications.find(a=>a.businessCode==='022').fields.ApplicationAmount,'2000.00');
        assert.equal(p.contract.dataSpecification.accounts[0].branchCode,'926');
        assert.equal(p.contract.dataSpecification.holdings.length,0);
        assert.equal(p.contract.dataSpecification.funds[0].fundCode,'270008');
        assert.equal(p.contract.dataSpecification.funds[0].nav,'1.00000000');
        assert.equal(p.contract.missing.length,0);
        assert.equal(p.contract.dataSpecification.missing.length,0);
        const send=p.exchangePlan.steps.filter(s=>s.direction==='SEND');
        assert.deepEqual(send.map(s=>s.fileType).sort(),['01','03']);
        assert.ok(send.every(s=>s.businessTime.value==='20260817'));
        assert.equal(new Set(send.map(s=>s.roundId)).size,1);
        assert.ok(p.contract.applications.some(a=>a.dependsOn?.some(d=>d.condition==='ORDERED')));
        assert.ok(!p.contract.applications.some(a=>'TAAccountID' in a.fields));
      }
      if(id==='four_cases'){assert.equal(saved.proposal.scenarios.length,4);assert.equal(saved.proposal.exchangePlan.status,'NOT_REQUIRED');}
      if(id==='noncomparison'){assert.equal(saved.proposal.scenarios.length,1);assert.equal(saved.proposal.exchangePlan.status,'NOT_REQUIRED');}
    }
    row.assertionsPassed=true;
  }catch(error){row.error={code:error.code||error.name,message:error.message};row.assertionsPassed=false;}
  row.latencyMs=Math.round(performance.now()-started);row.trace=trace;row.roundKinds=rounds.map(r=>r.kind||'DISCUSS');
  results.push(row);
  writeFileSync(resultFile,JSON.stringify(results,null,2));
  if(row.result)writeFileSync(output+`${id}-${method}.md`,['# 实际模型输出（实验，未人工确认）',`路线：${method}；下一阶段：${row.position.stage}；仓储：仅内存。`,row.result.reply].join('\n\n'));
  console.log(JSON.stringify({id,method,savedProposal:row.savedProposal,contractValid:row.contractValid,stage:row.position?.stage,assertionsPassed:row.assertionsPassed,error:row.error,latencyMs:row.latencyMs}));
}
