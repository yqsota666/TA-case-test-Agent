import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PlanDocument} from '../src/plan-document.jsx';
import {operationPlan} from '../../Backend/packages/case-agent/test/operation-chain-fixture.js';
import {operationTasks} from '../../Backend/packages/platform-protocol/src/operation-chain.js';
import '../src/case-workbench.css';
import '../src/base.css';
import '../src/defense-themes.css';
import '../src/spectral-components.css';
import '../src/compact-workbench.css';
import '../src/assistant-ui/elements.css';
import '../src/plan-comparison.css';
const params=new URLSearchParams(location.search),accounts=Number(params.get('accounts'))||2;
const initial=operationPlan({accounts,rounds:Number(params.get('rounds'))||2});
if(params.has('long'))initial.contract.dataSpecification.customers[0].name='合成长名称'.repeat(20);
if(params.has('readonly')){initial.contract.applications=[];initial.contract.expectations=[];initial.exchangePlan={status:'NOT_REQUIRED',steps:[],openQuestions:[]};}
if(params.has('missing'))initial.contract.missing=['赎回份额尚未明确，请继续讨论实际业务条件。'];
document.documentElement.dataset.theme='liquid';
function Fixture(){const [proposal,setProposal]=useState(initial);const progress=operationTasks(proposal).map(t=>({...t,state:t.businessCode==='001'?'CONFIRMED':t.businessCode==='022'?'WAITING_RETURN':'WAITING'}));
  return <main className="cw-shell" style={{display:'block'}}><section className="cw-modal" style={{position:'relative',width:'min(100%,680px)',height:'100dvh',margin:'auto',background:'var(--cw-surface)',display:'flex',flexDirection:'column'}}><header><h2>任务单 · 合成界面验收</h2></header><PlanDocument proposal={proposal} initialSection="tasks" taskProgress={params.has('progress')?progress:[]} locked={params.has('progress')} editable={!params.has('progress')} onSaveOperations={async applications=>setProposal(p=>({...p,contract:{...p.contract,applications}}))}/></section></main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
