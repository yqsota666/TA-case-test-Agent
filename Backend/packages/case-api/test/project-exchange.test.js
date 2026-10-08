import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createProjectExchangeService} from '../src/project-exchange.js';
const input={token:'owner',chatPublicId:'chat',casePublicId:'a'};
function fixture({pending=false,blocked=false,differentDate=false,dependencyDate=false}={}) {
 const cases=[{public_id:'a',status:'EXECUTING'},{public_id:'b',status:'EXECUTING'}];
 const state=new Map(),apps=new Map(),files=[],batches=[];
 for(const c of cases) {
  const intent={key:'open',fileType:'01',businessDate:c.public_id==='b'&&differentDate?'20260102':'20260101'};
  state.set(c.public_id,{revision:0,channelId:'7',intents:[intent],stagedKeys:[],files:[],waiting:[]});apps.set(c.public_id,[]);
 }
 const repository={listCases:async token=>{assert.equal(token,'owner');return {cases};},getLatestSopProposal:async(t,chat,c)=>({status:pending&&c==='b'?'DRAFT':'LOCKED',proposal:dependencyDate?{contract:{applications:[{key:'open',stepId:'send'}]},exchangePlan:{status:'READY',steps:[{stepId:'send',direction:'SEND',fileType:'01',businessTime:{value:'20260101'},dependsOn:[{stepId:'before',condition:'CONFIRMED'}]},{stepId:'before',direction:'RECEIVE',fileType:'04',businessTime:{value:c==='a'?'20251230':'20251231'},dependsOn:[]}]}}:{exchangePlan:{status:'READY'}}}),generatedData:async()=>({reviewStatus:'CONFIRMED'})};
 const preparations={read:async(t,s)=>structuredClone(state.get(s.casePublicId)),save:async(t,s)=>{const n={...s.state,revision:s.revision+1};state.set(s.casePublicId,n);return structuredClone(n);}};
 const exchangeRepository={listCaseApplications:async(t,s)=>({applications:apps.get(s.casePublicId)}),listOutboundFiles:async()=>({files}),createOutboundBatch:async(t,s)=>{const publicId=`batch${batches.length}`;batches.push(s);for(const arr of apps.values())for(const a of arr)if(s.applicationPublicIds.includes(a.publicId)){a.status='BATCHED';a.batchPublicId=publicId;}return {publicId};},generateOutboundFiles:async(t,s)=>{if(!files.some(f=>f.batchPublicId===s.batchPublicId))files.push({id:files.length,batchPublicId:s.batchPublicId});}};
 let stageCalls=0;
 const applicationPreparation={prepare:async s=>{assert.equal(s.deferBatching,true);stageCalls++;const current=state.get(s.casePublicId);for(const i of current.intents){if(blocked&&s.casePublicId==='b')continue;const arr=apps.get(s.casePublicId);if(!arr.length)arr.push({publicId:s.casePublicId,applicationNumber:'AI'+crypto.createHash('sha256').update(`${s.casePublicId}:7:${i.key}`).digest('hex').slice(0,22),fileType:i.fileType,businessDate:i.businessDate,channelId:'7',status:'READY'});current.stagedKeys=[i.key];}return structuredClone(current);}};
 const service=createProjectExchangeService({repository,preparations,exchangeRepository,applicationPreparation});
 return {service,files,batches,stageCalls:()=>stageCalls,state};
}
test('two confirmed Cases are staged before one shared file is generated, replay is stable',async()=>{const f=fixture();const result=await f.service.prepare(input);assert.equal(f.stageCalls(),2);assert.equal(f.batches.length,1);assert.deepEqual(f.batches[0].applicationPublicIds,['a','b']);assert.equal(result.files.length,1);await f.service.prepare(input);assert.equal(f.batches.length,1);assert.equal(f.files.length,1);});
test('unconfirmed sibling prevents any staging or generation',async()=>{const f=fixture({pending:true});assert.equal((await f.service.prepare(input)).phase,'WAITING_CHAT');assert.equal(f.stageCalls(),0);assert.equal(f.files.length,0);});
test('same group waits for every member to become stageable',async()=>{const f=fixture({blocked:true});await f.service.prepare(input);assert.equal(f.batches.length,0);assert.equal(f.files.length,0);});
test('different explicit dates never merge',async()=>{const f=fixture({differentDate:true});await f.service.prepare(input);assert.equal(f.batches.length,2);assert.equal(f.files.length,2);assert.ok(f.batches.every(b=>b.applicationPublicIds.length===1));});
test('foreign project identity fails before staging',async()=>{const f=fixture();await assert.rejects(f.service.prepare({...input,token:'foreign'}));assert.equal(f.stageCalls(),0);});
test('different prior business dates with identical topology remain separate waves',async()=>{const f=fixture({dependencyDate:true});await f.service.prepare(input);assert.equal(f.batches.length,2);});
test('waiting for sibling still rejects stale caller revision without saving',async()=>{const f=fixture({pending:true});f.state.get('a').revision=3;await assert.rejects(f.service.prepare({...input,revision:2}),/已更新/);assert.equal(f.state.get('a').revision,3);assert.equal(f.stageCalls(),0);});

function returnFixture({terminalSibling=false,mixedBatch=false}={}){
 const cases=[{public_id:'a',status:terminalSibling?'PASS':'EXECUTING'},{public_id:'b',status:'EXECUTING'}];
 const record=name=>({AppSheetSerialNo:name,ReturnCode:'0000'});
 const aFile={fileName:'a.txt',records:[record('a')]},bFile={fileName:'b.txt',records:[record('b1'),record('b2')]};
 const result=files=>({sha256:'same-package',files:structuredClone(files)});
 const parsed={a:{steps:[{batchPublicId:'batch',expectedType:'04',parses:[{parseId:'1',orderAccepted:true,result:result([aFile,bFile])}]}]},b:{steps:[{batchPublicId:'batch',expectedType:'04',parses:[{parseId:'2',orderAccepted:true,result:result([bFile,aFile])}]}]}};
 const calls=[],jobs=[];
 const confirmed={a:[{parseId:'1',recordIndex:0,outcome:'CONFIRMED'}],b:[{parseId:'2',recordIndex:1,outcome:'CONFIRMED'}]};
 const service=createProjectExchangeService({repository:{listCases:async()=>({cases})},exchangeRepository:{listCaseApplications:async(t,s)=>({applications:(s.casePublicId==='a'?['a']:['b1','b2']).map(applicationNumber=>({applicationNumber,batchPublicId:'batch',fileType:mixedBatch&&s.casePublicId==='a'?'01':'03'}))})},returnParsing:{read:async(t,s)=>structuredClone(parsed[s.casePublicId]),parse:async(t,s)=>{assert.ok(!terminalSibling||s.casePublicId!=='a');calls.push(s);return {phase:'PARSED',parseId:s.casePublicId==='a'?'1':'2'};}},returnConfirmation:{read:async(t,s)=>({batches:[{batchPublicId:'batch'}],confirmations:confirmed[s.casePublicId]})},applyAtomically:async(t,newJobs)=>{jobs.push(...newJobs);return {businessApplied:true};}});
 return {service,calls,jobs,parsed,confirmed};
}
test('same original bytes in reversed file order map selected record to each Case local index',async()=>{
 const f=returnFixture();await f.service.apply('owner',{chatPublicId:'chat',casePublicId:'a',parseId:'1',recordIndexes:[2],exchangeStepId:'a-receive'});
 assert.equal(f.jobs[0].casePublicId,'b');assert.deepEqual(f.jobs[0].recordIndexes,[1]);assert.equal(f.jobs[0].exchangeStepId,undefined);
});
test('confirmation aggregate maps sibling index back into caller file order',async()=>{
 const f=returnFixture();const result=await f.service.readConfirmation('owner',{chatPublicId:'chat',casePublicId:'a'});
 assert.deepEqual(result.confirmations.map(c=>[c.parseId,c.recordIndex]),[['1',0],['1',2]]);
});
test('caller explicit receive step remains local while sibling resolves own bound step',async()=>{
 const f=returnFixture();await f.service.parse('owner',{chatPublicId:'chat',casePublicId:'a',batchPublicId:'batch',expectedType:'04',exchangeStepId:'a-receive',files:[{base64:'original'}]});
 assert.equal(f.calls[0].exchangeStepId,'a-receive');assert.equal(f.calls[1].exchangeStepId,undefined);assert.deepEqual(f.calls[1].files,[{base64:'original'}]);
});
test('terminal sibling is not rewritten and active Case can parse and sync its own rows',async()=>{
 const f=returnFixture({terminalSibling:true});await f.service.parse('owner',{chatPublicId:'chat',casePublicId:'b',batchPublicId:'batch',expectedType:'04'});assert.deepEqual(f.calls.map(c=>c.casePublicId),['b']);
 await f.service.apply('owner',{chatPublicId:'chat',casePublicId:'b',parseId:'2',recordIndexes:[1,2]});assert.deepEqual(f.jobs.map(j=>j.casePublicId),['b']);assert.deepEqual(f.jobs[0].recordIndexes,[1]);
});
test('terminal historical records cannot be silently corrected by another Case upload',async()=>{
 const f=returnFixture({terminalSibling:true});f.parsed.b.steps[0].parses[0].result.files[1].records[0].ReturnCode='0001';
 await assert.rejects(f.service.apply('owner',{chatPublicId:'chat',casePublicId:'b',parseId:'2',recordIndexes:[2]}),/不能更改/);assert.equal(f.jobs.length,0);
});
test('unmappable same-digest record fails before any business apply',async()=>{
 const f=returnFixture();f.parsed.b.steps[0].parses[0].result.files[0].fileName='other.txt';
 await assert.rejects(f.service.apply('owner',{chatPublicId:'chat',casePublicId:'a',parseId:'1',recordIndexes:[2]}),/映射不一致/);assert.equal(f.jobs.length,0);
});
test('terminal caller cannot use aggregate route to write a still-active sibling',async()=>{
 const f=returnFixture({terminalSibling:true});await assert.rejects(f.service.apply('owner',{chatPublicId:'chat',casePublicId:'a',parseId:'1',recordIndexes:[2]}),/已结束/);assert.equal(f.jobs.length,0);
 await assert.rejects(f.service.parse('owner',{chatPublicId:'chat',casePublicId:'a',batchPublicId:'batch',expectedType:'04'}),/已结束/);assert.equal(f.calls.length,0);
});

test('mixed batch 02 fanout targets only Cases with 01, and 04 only Cases with 03',async()=>{
 const f=returnFixture({mixedBatch:true});
 await f.service.parse('owner',{chatPublicId:'chat',casePublicId:'a',batchPublicId:'batch',expectedType:'02',files:[{base64:'original02'}]});
 assert.deepEqual(f.calls.map(call=>[call.casePublicId,call.expectedType]),[['a','02']]);
 await f.service.parse('owner',{chatPublicId:'chat',casePublicId:'b',batchPublicId:'batch',expectedType:'04',files:[{base64:'original04'}]});
 assert.deepEqual(f.calls.map(call=>[call.casePublicId,call.expectedType]),[['a','02'],['b','04']]);
});
test('mixed batch caller with only the other file type cannot parse sibling returns',async()=>{
 const f=returnFixture({mixedBatch:true});
 await assert.rejects(f.service.parse('owner',{chatPublicId:'chat',casePublicId:'a',batchPublicId:'batch',expectedType:'04'}),/没有这类申请文件/);
 await assert.rejects(f.service.parse('owner',{chatPublicId:'chat',casePublicId:'b',batchPublicId:'batch',expectedType:'02'}),/没有这类申请文件/);
 assert.equal(f.calls.length,0);
});
