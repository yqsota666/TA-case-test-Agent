import {planText,exchangeStepLabel,exchangeStepTime} from './plan-language.js';
import React, {useState, useEffect, useRef} from 'react';
import {ChevronRight, X} from 'lucide-react';
import './plan-editor.css';
import {PlanComparison} from './plan-comparison.jsx';
const text=value=>typeof value==='string'?planText(value.trim()):'';
const strings=value=>Array.isArray(value)?[...new Set(value.map(text).filter(Boolean))]:[];
export function normalizePlan(proposal={}) {
  return {objective:text(proposal.objective),preconditions:strings(proposal.preconditions),openQuestions:strings(proposal.openQuestions),constructionIssues:strings([...(proposal.contract?.missing||[]),...(proposal.contract?.dataSpecification?.missing||[])]),dataSpecification:proposal.contract?.dataSpecification,
    scenarios:Array.isArray(proposal.scenarios)?proposal.scenarios.filter(item=>item&&typeof item==='object').map(item=>Object.fromEntries(['title','setup','action','expected','evidence'].map(key=>[key,text(item[key])]))):[],
    exchangePlan:proposal.exchangePlan&&typeof proposal.exchangePlan==='object'?{status:text(proposal.exchangePlan.status),steps:Array.isArray(proposal.exchangePlan.steps)?proposal.exchangePlan.steps:[],openQuestions:strings(proposal.exchangePlan.openQuestions)}:null};
}
export function planSummary(proposal) {
  return '方案已整理。可以打开查看、修改，确认后再继续。';
}
function ScenarioDetail({item}) {
  const fields=[['条件',item.setup],['操作',item.action],['核对依据',item.evidence]].filter(([,value])=>value);
  return fields.length>0&&<dl className="cw-plan-item-fields">{fields.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
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
export function PlanDocument({proposal,onSave,onSaveContent,editable=false}) {
  const plan=normalizePlan(proposal);
  const [section,setSection]=useState('tests');
  const sections=[['tests','测试项'],['data','准备数据'],['exchange','文件安排']];
  return <div className="cw-plan-shell">
    <nav className="cw-spectral-nav" aria-label="方案内容区">{sections.map(([key,label])=><button type="button" key={key} aria-pressed={section===key} onClick={()=>setSection(key)}>{label}</button>)}</nav>
    <div className="cw-plan-document" key={section} tabIndex={0} role="region" aria-label="方案内容">
      {plan.objective&&<p className="cw-plan-objective">{plan.objective}</p>}
      {section==='tests'&&<>
        {plan.scenarios.length>0?<PlanComparison plan={plan} editable={editable} onSaveContent={onSaveContent}/>:<p>暂无测试项。</p>}
        {plan.openQuestions.length>0&&<section className="cw-plan-questions"><h3>还需确认</h3><ul>{plan.openQuestions.map(item=><li key={item}>{item}</li>)}</ul></section>}
      </>}
      {section==='data'&&(plan.dataSpecification?<PreparedPlanData data={plan.dataSpecification} onSave={onSave} editable={editable}/>:<p>尚未准备数据。</p>)}
      {section==='exchange'&&<div className="cw-spectral-exchange-plan">
        {plan.exchangePlan?.steps.length>0?<ol>{plan.exchangePlan.steps.map((step,index)=><li key={step.stepId||index}><strong>{exchangeStepLabel(step)}</strong>{exchangeStepTime(step)&&<p>{exchangeStepTime(step)}</p>}{step.required===false&&<span>可选</span>}</li>)}</ol>:<p>暂无文件安排。</p>}
        {plan.exchangePlan?.openQuestions.length>0&&<section><h3>还需确认</h3><ul>{plan.exchangePlan.openQuestions.map(item=><li key={item}>{item}</li>)}</ul></section>}
      </div>}
    </div>
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
