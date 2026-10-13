import {operationPlan} from './operation-chain-fixture.js';
export function indexedPlan(options={}) {
 const plan=operationPlan(options);plan.contract.version=4;
 const open=plan.exchangePlan.steps[0];open.roundId='package';
 const trades={...plan.exchangePlan.steps.find(s=>s.fileType==='03'),stepId:'trades',roundId:'package',dependsOn:[]};
 const after=[{stepId:'open',condition:'SENT'},{stepId:'trades',condition:'SENT'}];
 plan.exchangePlan.steps=[open,trades,{...plan.exchangePlan.steps[1],roundId:'package',dependsOn:after},{...plan.exchangePlan.steps.find(s=>s.fileType==='04'),stepId:'returned',roundId:'package',dependsOn:after}];
 for(const a of plan.contract.applications){if(a.businessCode!=='001')a.stepId='trades';for(const d of a.dependsOn)d.condition='ORDERED';}
 return plan;
}
