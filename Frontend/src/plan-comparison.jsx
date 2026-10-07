import React,{useEffect,useRef,useState} from 'react';
import {ChevronRight,ClipboardCheck,Plus,X} from 'lucide-react';
import './plan-comparison.css';
export function ExpectedText({text=''}) {
  const parts=text.match(/[^；;\n]+[；;]?/g)?.map(p=>p.trim()).filter(Boolean)||[];
  return <ul className="cw-review-points">{parts.map((part,i)=><li key={i}>{part}</li>)}</ul>;
}
export function PlanComparison({plan,editable,onSaveContent}) {
  const [editing,setEditing]=useState(null);
  const splitConditions=text=>(text||'').match(/[^，,；;。]+[，,；;。]?/g)?.map(s=>s.trim()).filter(Boolean)||[];
  const conditions=plan.scenarios.map(s=>splitConditions(s.setup));
  const commonClauses=conditions.length>1?conditions[0].filter(clause=>conditions.every(parts=>parts.includes(clause))):[];
  const commonSetup=plan.scenarios.length>1 && plan.scenarios.every(s=>s.setup===plan.scenarios[0].setup)?plan.scenarios[0].setup:'';
  const common=[...new Set([...plan.preconditions,...(commonSetup?[commonSetup]:commonClauses)])];
  return <>
    {common.length>0&&<details className="cw-review-common"><summary>共同条件<ChevronRight size={15}/></summary><ul>{common.map((s,i)=><li key={i}>{s}</li>)}</ul></details>}
    <div className="cw-spectral-items">
      {plan.scenarios.map((item,index)=><details className="cw-spectral-item" key={index} open={index===0?true:undefined}>
        <summary><span className="cw-spectral-mark" aria-hidden="true"><ClipboardCheck size={19}/></span><strong>{item.title||`测试项 ${index+1}`}</strong><Plus className="cw-spectral-chevron" size={18} aria-hidden="true"/></summary>
        <div className="cw-spectral-item-body">
          <ExpectedText text={item.expected}/>
          <details className="cw-review-detail"><summary>条件与操作<ChevronRight size={13}/></summary><dl>
            {(commonSetup||conditions[index].filter(clause=>!commonClauses.includes(clause)).join(''))&&<><dt>条件</dt><dd>{commonSetup||conditions[index].filter(clause=>!commonClauses.includes(clause)).join('')}</dd></>}
            {item.action&&<><dt>操作</dt><dd>{item.action}</dd></>}
          </dl></details>
          {item.evidence&&<details className="cw-review-detail"><summary>核对依据<ChevronRight size={13}/></summary><p>{item.evidence}</p></details>}
          {editable&&<div className="cw-spectral-item-actions"><button type="button" onClick={()=>setEditing({index,item})} aria-label={`修改${item.title}`}>修改</button></div>}
        </div>
      </details>)}
    </div>
    {editing&&<PlanItemEditor item={editing.item} onClose={()=>setEditing(null)} onSave={async item=>{await onSaveContent(editing.index,item);setEditing(null);}}/>}
  </>;
}
function PlanItemEditor({item,onClose,onSave}) {
  const ref=useRef(null),[value,setValue]=useState(item),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const dialog=ref.current;dialog.showModal();return()=>dialog.close();},[]);
  return <dialog ref={ref} className="cw-modal cw-plan-item-editor" aria-labelledby="cw-plan-item-title" onCancel={event=>{event.preventDefault();if(!busy)onClose();}}><header><h2 id="cw-plan-item-title">修改测试项</h2><button type="button" className="cw-icon" disabled={busy} aria-label="关闭修改" onClick={onClose}><X size={20}/></button></header><form onSubmit={async event=>{event.preventDefault();setBusy(true);setError('');try{await onSave(Object.fromEntries(Object.entries(value).map(([key,text])=>[key,text.replace(/[\r\n]+/g,' ').trim()])));}catch(e){setError(e.message);}finally{setBusy(false);}}}><div className="cw-plan-edit-fields">{[['title','名称'],['setup','准备条件'],['action','操作'],['expected','预期结果'],['evidence','核对依据']].map(([key,label])=><label key={key}><span>{label}</span>{key==='title'?<input required maxLength={1000} disabled={busy} value={value[key]} onChange={e=>setValue({...value,[key]:e.target.value})}/>:<textarea required maxLength={1000} rows={key==='expected'?4:3} disabled={busy} value={value[key]} onChange={e=>setValue({...value,[key]:e.target.value})}/>}</label>)}</div>{error&&<p role="alert" className="cw-editor-error">{error}</p>}<footer><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="cw-primary-button" disabled={busy}>{busy?'审阅中…':'保存修改'}</button></footer></form></dialog>;
}
