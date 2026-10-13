import React,{useRef,useState} from 'react';
import {requestCase} from './live-case-api.js';
import './plan-editor.css';
function NameForm({label,projectName,onCreate,onCancel,onBusy,buttonLabel,initialName='',busyLabel='创建中…'}) {
  const [name,setName]=useState(initialName),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const submit=async event=>{
    event.preventDefault();if(busy)return;
    if(!name.trim()){setError('请填写名称，不能只输入空格。');return;}
    setBusy(true);onBusy(true);setError('');
    try{await onCreate(name.trim());}catch(e){setError(e.message);}finally{setBusy(false);onBusy(false);}
  };
  return <form onSubmit={submit}>
    {projectName&&<p>所属项目：{projectName}</p>}
    <div className="cw-editor-fields" style={{gridTemplateColumns:'minmax(0,1fr)'}}><label><span>{label}</span><input data-initial-focus required aria-label={label} value={name} maxLength={160} disabled={busy} onFocus={e=>e.target.select()} onChange={e=>setName(e.target.value)}/></label></div>
    {error&&<p role="alert" className="cw-editor-error">{error}</p>}
    <footer><button type="button" disabled={busy} onClick={onCancel}>取消</button><button type="submit" className="cw-primary-button" disabled={busy}>{busy?busyLabel:buttonLabel}</button></footer>
  </form>;
}
export function RenameForm({target,onSaved,...props}) {
  return <NameForm {...props} label={target.caseId?'Case名称':'项目名称'} initialName={target.name} buttonLabel="保存" busyLabel="保存中…" onCreate={async title=>{
    const path=target.caseId?`/chats/${target.projectId}/cases/${target.caseId}`:`/chats/${target.projectId}`;
    const saved=await requestCase(path+'/rename',{title});
    onSaved(saved.title);
  }}/>;
}
export function NewProjectForm({onCreated,...props}) {
  const created=useRef(null);
  return <NameForm {...props} label="项目名称" buttonLabel="创建项目" onCreate={async title=>{created.current??=await requestCase('/chats',{title});await onCreated(created.current.publicId);}}/>;
}
export function NewCaseForm({project,onCreated,...props}) {
  const created=useRef(null);
  return <NameForm {...props} label="Case名称" projectName={project.name} buttonLabel="创建Case" onCreate={async title=>{created.current??=await requestCase(`/chats/${project.id}/cases`,{title});await onCreated(project.id,created.current.publicId);}}/>;
}
