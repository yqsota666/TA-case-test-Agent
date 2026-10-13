import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PlanDocument} from '../src/plan-document.jsx';
import '../src/base.css';
import '../src/case-workbench.css';
import '../src/defense-themes.css';
import '../src/spectral-components.css';
import '../src/compact-workbench.css';
const params=new URLSearchParams(location.search),count=params.has('single')?1:params.has('four')?4:2;
const initial={objective:'合成验收：验证字段变化与预期，不执行真实业务',preconditions:['共同使用同一字段编码规则'],scenarios:Array.from({length:count},(_,i)=>({title:`合成情况${i+1}`,setup:`相同输入来源；字段${i%2?'状态':'编码'}设置为${i+1}`,action:'读取并核对导出内容',expected:params.has('long')?'长文本合成预期；'.repeat(55):`返回对应字段值${i+1}`,evidence:'比对原始记录与导出结果'})),openQuestions:params.has('missing')?['实际规则尚未提供，请补充后继续']:[],exchangePlan:{status:'NOT_REQUIRED',steps:[],openQuestions:[]},contract:{version:2,dataSpecification:{customers:[{name:'合成客户',investorType:'1',simulatedBalance:'1000.00'}],accounts:[{customerIndex:0,branchCode:'306'}],funds:[],holdings:[],missing:[]},applications:[],expectations:[],missing:[]}};
document.documentElement.dataset.theme='liquid';
function Fixture(){const [proposal,setProposal]=useState(initial),[notice,setNotice]=useState('');return <main className="cw-shell" style={{display:'block'}}><section className="cw-modal" style={{position:'relative',width:'min(100%,820px)',height:'100dvh',margin:'auto',background:'var(--cw-surface)',display:'flex',flexDirection:'column'}}><header><h2>方案精简 · 合成界面验收</h2></header><PlanDocument proposal={proposal} editable onSave={async dataSpecification=>{if(params.has('fail'))throw Error('合成保存失败，请重试');setProposal(p=>({...p,contract:{...p.contract,dataSpecification}}));setNotice('合成准备数据已更新');}} onSaveContent={async(index,item)=>{setProposal(p=>({...p,scenarios:p.scenarios.map((s,i)=>i===index?item:s)}));setNotice('合成情况已更新');}}/>{notice&&<p role="status">{notice}</p>}</section></main>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
