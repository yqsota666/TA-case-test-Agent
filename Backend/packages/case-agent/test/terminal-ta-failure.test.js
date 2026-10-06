import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaseResultGraph,terminalFailureSuggestion} from '../src/case-result-graph.js';
test('blocked legacy Case diagnoses FAIL without asking the model to invent future returns',async()=>{
 const snapshot={plan:{scenarios:[{expected:'状态CONFIRMED'}]},evidence:[],pending:[],issues:[],blockers:[{failedStepId:'r02',blockedStepIds:['s03','r04']}]};
 const graph=createCaseResultGraph({collect:async()=>snapshot,complete:async()=>{throw Error('must not call model for dependency failure');}});
 const result=await graph.invoke({});assert.equal(result.suggestion.outcome,'FAIL');assert.deepEqual(result.suggestion.blockers,snapshot.blockers);assert.deepEqual(result.suggestion.checks,[]);
});
test('unaffected pending operations and corrupt evidence prevent diagnostic FAIL from becoming confirmable',()=>{
 const snapshot={pending:[],issues:[],blockers:[{blockedStepIds:['s03','r04']}]};
 assert.equal(terminalFailureSuggestion({...snapshot,pending:['另一必需分支未收04']}),null);
 assert.equal(terminalFailureSuggestion({...snapshot,issues:['原件摘要不一致']}),null);
 assert.equal(terminalFailureSuggestion({...snapshot,blockers:[]}),null);
});
