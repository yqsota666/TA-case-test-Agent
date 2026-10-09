import React,{useEffect,useRef,useState} from 'react';
import {ChevronRight,ClipboardCheck,Plus,X} from './ui-icons.jsx';
import './plan-comparison.css';
export function ExpectedText({text=''}) {
  const parts=text.match(/[^；;\n]+[；;]?/g)?.map(p=>p.trim()).filter(Boolean)||[];
  const content=<ul className="cw-review-points">{parts.map((part,i)=><li key={i}>{part}</li>)}</ul>;
  return text.length>320?<><p className="cw-review-cell-text">{text.slice(0,140)}…</p><details className="cw-review-detail"><summary>展开完整预期<ChevronRight size={13}/></summary>{content}</details></>:content;
}
export function PlanComparison({plan,editable,onSaveContent}) {
  const [editing,setEditing]=useState(null);
  const clauses=value=>(value||'').split(/[，；;。\n]/).map(s=>s.trim()).filter(Boolean);
  const shared=key=>plan.scenarios.length>1?clauses(plan.scenarios[0][key]).filter(c=>plan.scenarios.every(s=>clauses(s[key]).includes(c))):[];
  const commonSetup=shared('setup'),commonAction=shared('action');
  const sharedContent=[...new Set([...commonSetup,...commonAction])];
  const common=[...new Set(plan.preconditions)].filter(c=>!sharedContent.includes(c));
  const difference=(item,key,common)=>clauses(item[key]).filter(c=>!common.includes(c)).join('；');
  return <>
    {sharedContent.length>0&&<p className="cw-review-baseline">{sharedContent.join('；')}</p>}
    {common.length>0&&<details className="cw-review-common"><summary>{plan.scenarios.length>1?'共同条件与操作':'基础条件'}<ChevronRight size={15}/></summary><ul>{common.map((s,i)=><li key={i}>{s}</li>)}</ul></details>}
    {plan.scenarios.length===1?<section className="cw-single-test"><h3>{plan.scenarios[0].title||'测试内容'}</h3><dl>{plan.scenarios[0].setup&&<><dt>条件</dt><dd>{plan.scenarios[0].setup}</dd></>}{plan.scenarios[0].action&&<><dt>操作</dt><dd>{plan.scenarios[0].action}</dd></>}<dt>预期结果</dt><dd><ExpectedText text={plan.scenarios[0].expected}/></dd></dl>{plan.scenarios[0].evidence&&<details className="cw-review-detail"><summary>核对依据<ChevronRight size={13}/></summary><p>{plan.scenarios[0].evidence}</p></details>}{editable&&<button type="button" className="cw-row-edit" onClick={()=>setEditing({index:0,item:plan.scenarios[0]})}>修改测试内容</button>}</section>:<div className="cw-review-table-wrap" tabIndex={0} aria-label="测试方案表格">
      <table className="cw-review-table"><caption className="cw-sr-only">各情况的条件、操作与预期</caption><thead><tr><th scope="col">情况</th><th scope="col">条件与操作</th><th scope="col">预期结果</th></tr></thead><tbody>
        {plan.scenarios.map((item,index)=>{const setup=difference(item,'setup',commonSetup),action=difference(item,'action',commonAction);return <tr key={index}>
          <th scope="row">{item.title||`情况 ${index+1}`}{editable&&<div className="cw-review-edit"><button type="button" onClick={()=>setEditing({index,item})} aria-label={`修改${item.title||`情况 ${index+1}`}`}>修改</button></div>}</th>
          <td data-label="条件与操作">{setup&&<p className="cw-review-cell-text">{setup}</p>}{action&&<p className="cw-review-cell-text">{action}</p>}{!setup&&!action&&<span>同共同条件与操作</span>}</td>
          <td data-label="预期结果"><ExpectedText text={item.expected}/>{(item.evidence||commonSetup.length||commonAction.length)&&<details className="cw-review-detail"><summary>完整条件与核对依据<ChevronRight size={13}/></summary><dl>{item.setup&&<><dt>条件</dt><dd>{item.setup}</dd></>}{item.action&&<><dt>操作</dt><dd>{item.action}</dd></>}{item.evidence&&<><dt>核对依据</dt><dd>{item.evidence}</dd></>}</dl></details>}</td>
        </tr>;})}
      </tbody></table>
    </div>}
    {editing&&<PlanItemEditor item={editing.item} onClose={()=>setEditing(null)} onSave={async item=>{await onSaveContent(editing.index,item);setEditing(null);}}/>}
  </>;
}
function PlanItemEditor({item,onClose,onSave}) {
  const ref=useRef(null),[value,setValue]=useState(item),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const dialog=ref.current;dialog.showModal();return()=>dialog.close();},[]);
  return <dialog ref={ref} className="cw-modal cw-plan-item-editor" aria-labelledby="cw-plan-item-title" onCancel={event=>{event.preventDefault();if(!busy)onClose();}}><header><h2 id="cw-plan-item-title">修改测试项</h2><button type="button" className="cw-icon" disabled={busy} aria-label="关闭修改" onClick={onClose}><X size={20}/></button></header><form onSubmit={async event=>{event.preventDefault();setBusy(true);setError('');try{await onSave(Object.fromEntries(Object.entries(value).map(([key,text])=>[key,text.replace(/[\r\n]+/g,' ').trim()])));}catch(e){setError(e.message);}finally{setBusy(false);}}}><div className="cw-plan-edit-fields">{[['title','名称'],['setup','准备条件'],['action','操作'],['expected','预期结果'],['evidence','核对依据']].map(([key,label])=><label key={key}><span>{label}</span>{key==='title'?<input required maxLength={1000} disabled={busy} value={value[key]} onChange={e=>setValue({...value,[key]:e.target.value})}/>:<textarea required maxLength={1000} rows={key==='expected'?4:3} disabled={busy} value={value[key]} onChange={e=>setValue({...value,[key]:e.target.value})}/>}</label>)}</div>{error&&<p role="alert" className="cw-editor-error">{error}</p>}<footer><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="cw-primary-button" disabled={busy}>{busy?'审阅中…':'保存修改'}</button></footer></form></dialog>;
}
