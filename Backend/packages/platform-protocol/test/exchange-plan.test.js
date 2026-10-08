import test from 'node:test';
import assert from 'node:assert/strict';
import {validExchangePlan,validateExchangeOrder} from '../src/exchange-plan.js';
const step=(stepId,fileType,dependsOn=[],roundId='r1',required=true)=>({stepId,roundId,fileType,direction:['01','03'].includes(fileType)?'SEND':'RECEIVE',required,businessTime:{kind:'DATE',value:'20261006'},dependsOn});
const dep=(stepId,condition)=>({stepId,condition});
const plan={status:'READY',openQuestions:[],steps:[step('s01','01'),step('r02','02',[dep('s01','SENT')]),step('s03','03',[dep('r02','CONFIRMED')]),step('r04','04',[dep('s03','SENT')]),step('r05','05',[],'snapshot1',false)]};
const check=(stepId,completed=[],overrides={})=>{const s=plan.steps.find(s=>s.stepId===stepId);return validateExchangeOrder({plan,stepId,direction:s.direction,fileType:s.fileType,businessDate:'20261006',completed,...overrides});};
test('confirmed dependencies distinguish parsed 02 from success, and independent optional 05 has no global order',()=>{
 assert.equal(validExchangePlan(plan),true);
 assert.throws(()=>check('s03',[{stepId:'r02',condition:'PARSED'}]),{code:'ORDER_VIOLATION'});
 assert.equal(check('s03',[{stepId:'r02',condition:'CONFIRMED'}]).step.stepId,'s03');
 assert.equal(check('r05').step.required,false);
 assert.throws(()=>check('r04'),e=>e.code==='ORDER_VIOLATION' && e.missing[0].stepId==='s03');
 assert.equal(check('r04',[{stepId:'s03',condition:'SENT'},{stepId:'r04',condition:'PARSED'}]).duplicate,true);
});
test('existing account permits direct03 and more than two independent rounds are valid',()=>{
 const direct={...plan,steps:[step('direct03','03',[],'existing'),step('direct04','04',[dep('direct03','SENT')],'existing')]};
 assert.equal(validExchangePlan(direct),true);
 assert.doesNotThrow(()=>validateExchangeOrder({plan:direct,stepId:'direct03',direction:'SEND',fileType:'03',businessDate:'20261006'}));
 const multi={...plan,steps:[1,2,3].flatMap(n=>[step(`s${n}`,'01',[],`r${n}`),step(`r${n}`,'02',[dep(`s${n}`,'SENT')],`r${n}`)])};
 assert.equal(validExchangePlan(multi),true);
});
test('cycles, wrong-round return, wrong completion kinds and unknown dependencies are invalid',()=>{
 for(const mutate of [p=>p.steps[0].dependsOn=[dep('r02','PARSED')],p=>p.steps[1].roundId='other',p=>p.steps[1].dependsOn=[dep('s01','CONFIRMED')],p=>p.steps[2].dependsOn=[dep('unknown','PARSED')]]){
  const p=structuredClone(plan);mutate(p);assert.equal(validExchangePlan(p),false);
 }
});
test('unknown plan, wrong step/type/date and impossible calendar date cannot be accepted',()=>{
 assert.throws(()=>check('s01',[],{plan:undefined}),{code:'EXCHANGE_PLAN_REQUIRED'});
 assert.throws(()=>check('s01',[],{fileType:'03'}),{code:'EXCHANGE_STEP_MISMATCH'});
 assert.throws(()=>check('s01',[],{businessDate:'20261007'}),{code:'EXCHANGE_DATE_MISMATCH'});
 const p=structuredClone(plan);p.steps[0].businessTime.value='20260230';assert.equal(validExchangePlan(p),false);
 assert.equal(validExchangePlan({status:'UNPLANNED',steps:[],openQuestions:['需要哪一天？']}),true);
});

test('non-file business plans are explicit and cannot authorize TA file execution',()=>{
 const none={status:'NOT_REQUIRED',steps:[],openQuestions:[]};
 assert.equal(validExchangePlan(none),true);
 assert.equal(validExchangePlan({...none,steps:[step('unexpected','01')]}),false);
 assert.equal(validExchangePlan({...none,openQuestions:['unknown']}),false);
 assert.throws(()=>validateExchangeOrder({plan:none,stepId:'unexpected',direction:'SEND',fileType:'01',businessDate:'20261006'}),{code:'EXCHANGE_PLAN_REQUIRED'});
});
