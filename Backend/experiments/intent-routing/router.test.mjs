import assert from 'node:assert/strict';
import test from 'node:test';
import {validateDecision} from './router.mjs';
test('routing output cannot bypass the server action allowlist or accept an ambiguous action',()=>{
  const decision={intent:'PROPOSE_PLAN',needsClarification:false,reason:'用户要求整理审阅草稿'};
  assert.throws(()=>validateDecision(decision,{allowedActions:['DISCUSS']}),/ACTION_NOT_ALLOWED/);
  assert.throws(()=>validateDecision({...decision,needsClarification:true},{allowedActions:['DISCUSS','PROPOSE_PLAN']}),/AMBIGUOUS_ACTION/);
  for(const value of [null,{...decision,intent:'PLAN_CONFIRM'},{...decision,unexpected:true},{...decision,needsClarification:'false'}])assert.throws(()=>validateDecision(value,{allowedActions:['DISCUSS','PROPOSE_PLAN']}),/INVALID_ROUTING_OUTPUT/);
});
