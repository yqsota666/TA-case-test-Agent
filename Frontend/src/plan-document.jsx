import {FileSchedule} from './file-schedule.jsx';
import {OperationTasks} from './operation-tasks.jsx';
import {planText} from './plan-language.js';
import React, {useState, useEffect, useRef} from 'react';
import {ChevronRight, X} from './ui-icons.jsx';
import './plan-editor.css';
import {PlanComparison} from './plan-comparison.jsx';
const text=value=>typeof value==='string'?planText(value.trim()):'';
const issueText=value=>text(value).replaceAll('exchangePlan.steps','文件安排').replaceAll('openQuestions','待确认问题').replaceAll('accountIndex','账户引用').replaceAll('stepId','业务动作引用');
const strings=value=>Array.isArray(value)?[...new Set(value.map(text).filter(Boolean))]:[];
export function normalizePlan(proposal={}) {
  return {objective:text(proposal.objective),preconditions:strings(proposal.preconditions),openQuestions:strings(proposal.openQuestions),constructionIssues:[...new Set([...(proposal.contract?.missing||[]),...(proposal.contract?.dataSpecification?.missing||[])].map(issueText).filter(Boolean))],dataSpecification:proposal.contract?.dataSpecification,
    scenarios:Array.isArray(proposal.scenarios)?proposal.scenarios.filter(item=>item&&typeof item==='object').map(item=>Object.fromEntries(['title','setup','action','expected','evidence'].map(key=>[key,text(item[key])]))):[],
    exchangePlan:proposal.exchangePlan&&typeof proposal.exchangePlan==='object'?{status:text(proposal.exchangePlan.status),steps:Array.isArray(proposal.exchangePlan.steps)?proposal.exchangePlan.steps:[],openQuestions:strings(proposal.exchangePlan.openQuestions)}:null};
}
export function planSummary(proposal,status) {
  if(status==='LOCKED')return '方案已确认。可以打开查看详情。';
  if(status==='DRAFT')return '测试方案已有内容，还需完善后确认。可以打开查看或直接修改。';
  return '方案已整理。可以打开查看、修改，确认后再继续。';
}
const dataTables={customers:{title:'客户',columns:[['name','名称'],['investorType','客户类型'],['simulatedBalance','模拟余额']]},accounts:{title:'账户',columns:[['customerIndex','所属客户'],['branchCode','开户网点']]},funds:{title:'基金',columns:[['fundCode','基金代码'],['fundName','名称'],['shareClass','份额类别'],['nav','单位净值']]},holdings:{title:'持仓',columns:[['accountIndex','所属账户'],['fundIndex','基金'],['totalVolume','初始份额']]}};
function PreparedPlanData({data,onSave,editable}) {
  const [editing,setEditing]=useState(null);
  const [selected,setSelected]=useState('customers'),table=dataTables[selected],rows=data[selected]||[];
  const value=(row,key)=>key==='investorType'?(String(row[key])==='1'?'个人':'机构'):key==='customerIndex'?(data.customers?.[row[key]]?.name||'—'):key==='accountIndex'?`准备账户 ${row[key]+1}`:key==='fundIndex'?(data.funds?.[row[key]]?.fundName||'—'):row[key];
  return <section className="cw-prepared-data"><div className="cw-plan-items-header"><h3>准备数据</h3><div className="cw-plan-view" role="group" aria-label="准备数据表">{Object.entries(dataTables).map(([key,item])=><button type="button" key={key} aria-pressed={selected===key} onClick={()=>setSelected(key)}>{item.title}</button>)}</div></div>
    {rows.length?<div className="cw-plan-comparison"><table><caption className="cw-sr-only">{table.title}准备数据</caption><thead><tr>{table.columns.map(([key,label])=><th scope="col" key={key}>{label}</th>)}{editable&&<th scope="col" className="cw-data-action">操作</th>}</tr></thead><tbody>{rows.map((row,index)=><tr key={index}>{table.columns.map(([key])=><td key={key}>{value(row,key)}</td>)}{editable&&<td className="cw-data-action"><button type="button" className="cw-row-edit" aria-label={`修改${table.title}第${index+1}行`} onClick={()=>setEditing({table:selected,index,row:{...row}})}>修改</button></td>}</tr>)}</tbody></table></div>:<p>无需准备初始{table.title}记录。</p>}
    {editing&&<PreparedRowEditor editing={editing} data={data} onClose={()=>setEditing(null)} onSave={async row=>{const next=structuredClone(data);next[editing.table][editing.index]=row;await onSave(next);setEditing(null);}}/>}
  </section>;
}
function reviewQuestions(plan) {
  const issues=[...new Set([...plan.openQuestions,...plan.constructionIssues,...(plan.exchangePlan?.openQuestions||[])])];
  const result=[];
  for (const issue of issues) {
    let message=issue;
    if (/请确认.*(?:01|02|03|04).*业务日期|文件安排为空.*业务日期/.test(issue)) {
      message='申请提交和TA确认日期尚未明确。请在对话中指定日期，或让AI推荐日期供审阅。';
    } else if (/准备模拟数据需要.*申请及对应回传步骤/.test(issue)) {
      message='AI尚未补齐申请与回传安排，暂不能生成申请文件。请在对话中让AI继续完善方案。';
    } else if (/不属于协议回传字段.*人工审阅/.test(issue)) {
      message='业务预期需要单独核验，TA回传只能核对协议结果。请让AI补充业务结果的核对方法。';
    }
    if (!result.includes(message)) result.push(message);
  }
  return result;
}
export function PlanDocument({proposal,onSave,onSaveContent,onSaveOperations,dataApproval,taskProgress=[],locked=false,editable=false}) {
  const plan=normalizePlan(proposal),questions=reviewQuestions(plan);
  return <div className="cw-plan-shell">
    <div className="cw-plan-document" tabIndex={0} role="region" aria-label="方案内容">
      {plan.objective&&<p className="cw-plan-objective">{plan.objective}</p>}
      {plan.scenarios.length>0?<PlanComparison plan={plan} sourceScenarios={proposal.scenarios} editable={editable} onSaveContent={onSaveContent}/>:<p>暂无测试项。</p>}
      {questions.length>0&&<section className="cw-plan-questions"><h3>还需完善</h3><ul>{questions.map(item=><li key={item}>{item}</li>)}</ul></section>}
      {plan.dataSpecification&&<details className="cw-review-common cw-plan-data-details"><summary>准备数据<ChevronRight size={15}/></summary><PreparedPlanData data={plan.dataSpecification} onSave={onSave} editable={editable}/></details>}
      <details className="cw-review-common cw-plan-data-details"><summary>执行与文件安排<ChevronRight size={15}/></summary><OperationTasks proposal={proposal} progress={taskProgress} locked={locked} editable={editable} onSave={onSaveOperations}/><FileSchedule exchangePlan={proposal.exchangePlan} ordered={proposal.contract?.version===4}/></details>
    </div>
    {dataApproval}
  </div>;
}

function PreparedRowEditor({editing,data,onClose,onSave}) {
  const ref=useRef(null),[row,setRow]=useState(editing.row),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const table=dataTables[editing.table];
  useEffect(()=>{ref.current.showModal();return ()=>ref.current?.close();},[]);
  const save=async event=>{event.preventDefault();setSaving(true);setError('');try {await onSave(row);} catch(e){setError(e.message);} finally {setSaving(false);}};
  return <dialog ref={ref} className="cw-modal cw-row-editor" aria-labelledby="cw-row-editor-title" onCancel={event=>{event.preventDefault();if(!saving)onClose();}}>
    <header><h2 id="cw-row-editor-title">修改{table.title}</h2><button type="button" className="cw-icon" aria-label="关闭编辑" disabled={saving} onClick={onClose}><X size={20}/></button></header>
    <form onSubmit={save}><div className="cw-editor-fields">{table.columns.map(([key,label])=>{
      const options=key==='investorType'?[['1','个人'],['0','机构']]:key==='customerIndex'?data.customers.map((c,i)=>[i,c.name]):key==='accountIndex'?data.accounts.map((_,i)=>[i,`准备账户 ${i+1}`]):key==='fundIndex'?data.funds.map((f,i)=>[i,f.fundName]):null;
      const format={simulatedBalance:['\\d{1,14}\\.\\d{2}','如 1000.00'],nav:['\\d{1,8}\\.\\d{8}','如 1.00000000'],totalVolume:['\\d{1,10}\\.\\d{8}','如 100.00000000'],fundCode:['\\d{6}','6位数字'],branchCode:['\\d{1,9}','1至9位数字'],shareClass:['[A-Z0-9]','1位大写字母或数字']}[key];
      return <label key={key}><span>{label}<small>必填</small></span>{options?<select required disabled={saving} value={row[key]} onChange={e=>setRow({...row,[key]:key==='investorType'?e.target.value:Number(e.target.value)})}>{options.map(([v,t])=><option value={v} key={v}>{t}</option>)}</select>:<input required disabled={saving} value={row[key]??''} maxLength={key==='name'?180:key==='fundName'?200:undefined} pattern={format?.[0]} title={format?.[1]} onChange={e=>setRow({...row,[key]:e.target.value})}/>}{format&&<span className="cw-field-help">{format[1]}</span>}</label>;
    })}</div>{error&&<p className="cw-editor-error" role="alert">{error}</p>}<footer><button type="button" disabled={saving} onClick={onClose}>取消</button><button type="submit" className="cw-primary-button" disabled={saving}>{saving?'保存中…':'保存修改'}</button></footer></form>
  </dialog>;
}
