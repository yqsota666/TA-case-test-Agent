import React,{useState} from 'react';
import {operationTasks,editableOperationFields} from '../../Backend/packages/platform-protocol/src/operation-chain.js';
import {planText,exchangeStepLabel,exchangeStepTime} from './plan-language.js';
import './operation-tasks.css';

const statusText={PROPOSED:'待确认',READY:'可准备申请',WAITING:'等待前序结果',BLOCKED:'前序结果不满足条件',UNSUPPORTED:'当前无法同步此业务',
  BATCHED:'已合批，待生成',GENERATED:'文件已生成，待交付',DELIVERED:'已交付，等待回传',WAITING_RETURN:'已交付，等待回传',CONFIRMED:'业务确认成功',FAILED:'业务确认失败'};
const conditionText={ORDERED:'在同一申请包内先执行',CONFIRMED:'成功确认',FAILED:'确认失败',SENT:'交付申请'};
const fieldNames={TransactionTime:'申请时间',ApplicationAmount:'申请金额',ApplicationVol:'申请份额',CurrencyType:'币种',ChargeType:'收费方式',CertificateType:'证件类型',CertificateNo:'模拟证件号码',LargeRedemptionFlag:'巨额赎回处理方式',DefDividendMethod:'分红方式',FrozenCause:'冻结原因',OriginalAppSheetNo:'原申请号'};
const timeText=value=>/^\d{6}$/.test(value??'')?value.match(/.{2}/g).join(':'):value;
const fieldText=(key,value)=>key==='TransactionTime'?timeText(value):key==='CurrencyType'&&value==='156'?'人民币':key==='ChargeType'?({'0':'前收费','1':'后收费'}[value]??value):value;
export function taskAccount(plan,task) {
  if(task.transactionAccountId)return `交易账户 ${task.transactionAccountId}`;
  const data=plan.contract.dataSpecification,account=data.accounts[task.accountIndex];
  return `${data.customers[account?.customerIndex]?.name??'待明确客户'} · 准备账户 ${task.accountIndex+1}`;
}
export function taskRows(proposal,progress=[]) {
  return operationTasks(proposal).map(task=>({...task,...progress.find(p=>p.key===task.key)}));
}
export function OperationTasks({proposal,progress=[],locked=false,editable=false,onSave}) {
  const rows=taskRows(proposal,progress),[editing,setEditing]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  if(!rows.length)return <p>{proposal.exchangePlan?.status==='NOT_REQUIRED'?'此方案无需账户申请操作，按测试项核对结果。':'尚未整理账户操作，请继续讨论并生成方案。'}</p>;
  const label=key=>{const index=rows.findIndex(t=>t.key===key),task=rows[index];return task?`第${index+1}项，${taskAccount(proposal,task)}的${task.name}`:'前序操作';};
  const save=async event=>{
    event.preventDefault();setBusy(true);setError('');
    try{
      const applications=proposal.contract.applications.map(a=>a.key===editing.key?{...a,fields:editing.fields,dependsOn:editing.dependsOn}:a);
      await onSave(applications);setEditing(null);
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };
  return <div className="cw-operation-tasks"><ol>{rows.map((task,index)=>{
    const step=proposal.exchangePlan.steps.find(s=>s.stepId===task.stepId),fund=proposal.contract.dataSpecification.funds[task.fundIndex];
    const expected=proposal.contract.expectations.filter(e=>e.selector.applicationKey===task.key).map(e=>planText(e.expectedQuote));
    const deps=task.dependsOn??[];
    return <li key={task.key}><header className="cw-task-header"><span className="cw-task-order" aria-hidden="true">{index+1}</span><div><h3>{task.name}</h3><p>{taskAccount(proposal,task)}{fund?` · ${fund.fundName}（${fund.fundCode}）`:''}</p></div><span className="cw-task-state">{statusText[task.state]??(locked?'等待准备申请':'待确认')}</span></header>
      <p className="cw-task-date">{exchangeStepTime(step)}{task.fields.TransactionTime?` · ${timeText(task.fields.TransactionTime)}`:''}</p>
      <p className="cw-task-dependencies">{deps.length?`前置条件：${deps.map(d=>`${label(d.applicationKey)}${conditionText[d.condition]}`).join('；')}`:
        step.dependsOn.length?`前置条件：${step.dependsOn.map(d=>{const parent=proposal.exchangePlan.steps.find(s=>s.stepId===d.stepId);return `${exchangeStepLabel(parent)}${conditionText[d.condition]??'解析完成'}`;}).join('；')}`:'前置条件：完成准备数据与预期确认'}</p>
      {!task.canApply&&<p className="cw-task-limitation">此业务可以按协议规划，当前尚不能同步正式业务结果。</p>}
      <details><summary>输入与预期</summary><dl>{Object.entries(task.fields).map(([key,value])=><div key={key}><dt>{fieldNames[key]??key}</dt><dd>{fieldText(key,value)||'尚未明确'}</dd></div>)}</dl>
        {expected.length?<ul>{[...new Set(expected)].map((e,i)=><li key={i}>{e}</li>)}</ul>:<p>逐笔预期请结合“测试项”审阅。</p>}
      </details>
      {editable&&proposal.contract.version>=3&&<button type="button" className="cw-row-edit" onClick={()=>{setEditing({key:task.key,fields:editableOperationFields(task),dependsOn:structuredClone(deps)});setError('');}}>修改{task.name}</button>}
      {editing?.key===task.key&&<form className="cw-task-editor" onSubmit={save}>
        {Object.entries(editing.fields).map(([key,value])=><label key={key}>{fieldNames[key]??key}<input required disabled={busy} type={key==='TransactionTime'?'time':'text'} step={key==='TransactionTime'?1:undefined} maxLength={500} value={key==='TransactionTime'?timeText(value):value} onChange={e=>setEditing({...editing,fields:{...editing.fields,[key]:key==='TransactionTime'&&e.target.value?e.target.value.replaceAll(':','').padEnd(6,'0'):e.target.value}})}/></label>)}
        <fieldset disabled={busy}><legend>前置操作</legend>{rows.filter(t=>t.key!==task.key).map(parent=>{const dep=editing.dependsOn.find(d=>d.applicationKey===parent.key);return <label key={parent.key}>{label(parent.key)}<select value={dep?.condition??''} onChange={e=>setEditing({...editing,dependsOn:[...editing.dependsOn.filter(d=>d.applicationKey!==parent.key),...(e.target.value?[{applicationKey:parent.key,condition:e.target.value}]:[])]})}><option value="">不依赖</option>{Object.entries(conditionText).filter(([key])=>proposal.contract.version===4?key==='ORDERED':key!=='ORDERED').map(([key,text])=><option key={key} value={key}>{text}</option>)}</select></label>;})}</fieldset>
        {error&&<p role="alert" className="cw-editor-error">{error}</p>}<div><button type="button" disabled={busy} onClick={()=>setEditing(null)}>取消</button><button type="submit" disabled={busy}>{busy?'保存中…':'保存修改'}</button></div>
      </form>}
    </li>;
  })}</ol></div>;
}
