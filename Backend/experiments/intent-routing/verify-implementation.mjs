import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createSophnetCompletion} from '../../packages/case-agent/src/sophnet.js';
import {createPersistedDiscussionService} from '../../packages/case-agent/src/persisted-discussion.js';
import {withFundMarketDefaults,loadFundMarketDefaults} from '../../packages/case-agent/src/fund-market-defaults.js';
import {validPlanContract} from '../../packages/platform-protocol/src/plan-contract.js';
import {workflowPosition} from '../../packages/case-agent/src/durable-workflow.js';
import {cases} from './cases.mjs';
const output=new URL('../../../.context/intent-routing/implementation-model-'+Date.now()+'.json',import.meta.url);
let apiKey;
try{apiKey=execFileSync('security',['find-generic-password','-s','codex.sophnet.ta-case-test-agent','-a','api-key','-w'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{throw new Error('Keychain unavailable; real model testing not performed');}
const provider=createSophnetCompletion({apiKey,maxTokens:8192});
const previous=JSON.parse(readFileSync(new URL('../../../.context/intent-routing/end-to-end-complete-context.json',import.meta.url),'utf8')).at(-1);
const jobs=process.env.VERIFY_CASE?[process.env.VERIFY_CASE]:['incident_complete_context','noncomparison','four_cases'];
const rows=[];
for(const id of jobs){
 const fixture=id==='incident_complete_context'?previous.input:cases.find(c=>c.id===id)?.input;
 const history=structuredClone(fixture.history??fixture.turns),trace=[];let saved,pending,revision=history.length/2;
 const repository={readCaseDiscussion:async()=>({turns:history,revision,pending}),getLatestSopProposal:async()=>saved,
 beginCaseDiscussionTurn:async(_t,_c,_k,turn)=>{assert.equal(turn.expectedRevision,revision);pending={...turn,turnNumber:++revision};return pending;},
 finishCaseDiscussionTurn:async(_t,_c,_k,turn)=>{history.push({role:'user',content:pending.userInput},{role:'assistant',content:turn.assistantReply});pending=null;return {revision};},
 finishCasePlanProposal:async(_t,_c,_k,turn)=>{saved={...turn,status:turn.draft?'DRAFT':'PENDING_CONFIRMATION',versionNumber:1,sourceTurnNumber:revision};history.push({role:'user',content:pending.userInput},{role:'assistant',content:turn.assistantReply});pending=null;return {revision,versionNumber:1};},abandonCaseDiscussionTurn:async()=>{pending=null;}};
 const complete=async request=>{const start=Date.now();try{const reply=await provider(request);trace.push({request,reply,ms:Date.now()-start});console.log(JSON.stringify({id,call:trace.length,ms:trace.at(-1).ms}));return reply;}catch(error){trace.push({request,error:{code:error.code,message:error.message}});throw error;}};
 const service=createPersistedDiscussionService({repository,routeComplete:complete,complete:withFundMarketDefaults(complete,loadFundMarketDefaults()),readChannels:async()=>({channels:[{id:'926',name:'网商银行',environment:'LOCAL',taCode:'27',distributorCode:'926',protocolVersion:'22'}]})});
 const row={id,input:fixture,repository:'memory-only',model:'DeepSeek-V4-Pro-0813'};
 try{row.result=await service.respond({token:'synthetic',chatPublicId:'synthetic-chat',casePublicId:id,userInput:fixture.userInput});row.saved=saved;row.contractValid=!!saved?.proposal.contract&&validPlanContract(saved.proposal.contract,saved.proposal);row.position=workflowPosition({chatStatus:'ACTIVE',caseStatus:saved?.draft?'DISCUSSING':'SOP_PENDING',plan:saved});
 assert.equal(row.contractValid,true);assert.equal(row.position.stage,'CONFIRM_PLAN_DATA');
 if(id==='incident_complete_context'){const p=saved.proposal;assert.equal(p.contract.applications.find(a=>a.businessCode==='022').fields.ApplicationAmount,'2000.00');assert.equal(p.contract.dataSpecification.accounts[0].branchCode,'926');assert.equal(p.contract.dataSpecification.funds[0].fundCode,'270008');assert.equal(new Set(p.exchangePlan.steps.filter(s=>s.direction==='SEND').map(s=>s.roundId)).size,1);assert.equal(p.contract.missing.length,0);assert.equal(p.contract.dataSpecification.missing.length,0);}
 row.passed=true;
 }catch(error){row.error={code:error.code||error.name,message:error.message};row.passed=false;}
 row.trace=trace;rows.push(row);writeFileSync(output,JSON.stringify(rows,null,2));console.log(JSON.stringify({id,passed:row.passed,stage:row.position?.stage,error:row.error}));
}
