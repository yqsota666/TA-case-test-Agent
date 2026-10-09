import React,{useRef,useState} from 'react';
import {requestCase} from './live-case-api.js';
import './plan-editor.css';
function NameForm({label,projectName,onCreate,onCancel,onBusy,buttonLabel}) {
  const [name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const submit=async event=>{
    event.preventDefault();if(busy)return;
    if(!name.trim()){setError('请填写名称，不能只输入空格。');return;}
    setBusy(true);onBusy(true);setError('');
    try{await onCreate(name.trim());}catch(e){setError(e.message);}finally{setBusy(false);onBusy(false);}
  };
  return <form onSubmit={submit}>
    {projectName&&<p>所属项目：{projectName}</p>}
    <div className="cw-editor-fields" style={{gridTemplateColumns:'minmax(0,1fr)'}}><label><span>{label}</span><input data-initial-focus required aria-label={label} value={name} maxLength={160} disabled={busy} onChange={e=>setName(e.target.value)}/></label></div>
    {error&&<p role="alert" className="cw-editor-error">{error}</p>}
    <footer><button type="button" disabled={busy} onClick={onCancel}>取消</button><button type="submit" className="cw-primary-button" disabled={busy}>{busy?'创建中…':buttonLabel}</button></footer>
  </form>;
}
export function NewProjectForm({onCreated,...props}) {
  const created=useRef(null);
  return <NameForm {...props} label="项目名称" buttonLabel="创建项目" onCreate={async title=>{created.current??=await requestCase('/chats',{title});await onCreated(created.current.publicId);}}/>;
}
export function NewCaseForm({project,onCreated,...props}) {
  const created=useRef(null);
  return <NameForm {...props} label="Case名称" projectName={project.name} buttonLabel="创建Case" onCreate={async title=>{created.current??=await requestCase(`/chats/${project.id}/cases`,{title});await onCreated(project.id,created.current.publicId);}}/>;
}
