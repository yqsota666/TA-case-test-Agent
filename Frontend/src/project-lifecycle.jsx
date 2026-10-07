import React,{useEffect,useId,useRef,useState} from 'react';
import {Archive,ChevronRight,RotateCcw,X} from 'lucide-react';
import {requestCase} from './live-case-api.js';
import {lifecycleView,lifecycleCommand,caseStatusLabel} from './project-lifecycle.js';
import './project-lifecycle.css';

export function ProjectLifecycleCard({chatId,caseId,request=requestCase,onChanged,onNavigate}) {
  const [open,setOpen]=useState(false);
  if(!chatId)return null;
  return <><button type="button" className="cw-result" onClick={()=>setOpen(true)}><span className="cw-result-icon"><Archive size={20}/></span><span className="cw-result-copy"><span className="cw-result-title">项目与复测</span></span><span className="cw-result-action">查看详情<ChevronRight size={16}/></span></button>
    {open&&<ProjectLifecycleDialog key={chatId} {...{chatId,caseId,request,onChanged,onNavigate}} onClose={()=>setOpen(false)}/>}</>;
}
export function ProjectLifecycleDialog({chatId,caseId,request=requestCase,onChanged,onNavigate,onClose}) {
  const [snapshot,setSnapshot]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const [intent,setIntent]=useState(null),[reason,setReason]=useState(''),[preserve,setPreserve]=useState(false);
  const ref=useRef(null),alive=useRef(true),pending=useRef(null),locked=useRef(false),titleId=useId();
  const path=`/chats/${chatId}/lifecycle`, view=lifecycleView(snapshot,caseId);
  async function read(){setLoading(true);setError('');try{const next=await request(path);if(alive.current)setSnapshot(next);}catch(e){if(alive.current)setError(e.message);}finally{if(alive.current)setLoading(false);}}
  useEffect(()=>{alive.current=true;const previous=document.activeElement,overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';ref.current.showModal();read();
    return()=>{alive.current=false;ref.current?.close();document.body.style.overflow=overflow;previous?.focus();};},[chatId,request]);
  function choose(kind){pending.current=null;setError('');setReason('');setPreserve(false);setIntent(kind);}
  async function submit(){
    if(locked.current)return;
    let command;try{command=lifecycleCommand(intent,{caseId,reason,preserve},'');}catch(e){setError(e.message);return;}
    const signature=JSON.stringify(command);
    if(!pending.current||pending.current.signature!==signature)pending.current={signature,id:crypto.randomUUID()};
    command=lifecycleCommand(intent,{caseId,reason,preserve},pending.current.id);
    locked.current=true;setBusy(true);setError('');
    try{const result=await request(`${path}/${command.route}`,command.body);
      if(!alive.current)return;
      const next=await request(path);if(!alive.current)return;setSnapshot(next);
      await onChanged?.();if(!alive.current)return;
      pending.current=null;setIntent(null);setReason('');
      if(result.chatPublicId){onClose();await onNavigate?.(result);}
    }catch(e){if(alive.current){setError(e.message);if(e.status===409){const next=await request(path).catch(()=>null);if(next&&alive.current)setSnapshot(next);}}}
    finally{locked.current=false;if(alive.current)setBusy(false);}
  }
  const targetLabel=intent==='normal'?'封存项目':intent==='force'?'提前封存':intent==='retest'?'创建关联复测':'开启新项目';
  return <dialog ref={ref} className="cw-modal cw-lifecycle-modal" aria-labelledby={titleId} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
    <header><h2 id={titleId}>项目与复测</h2><button type="button" className="cw-icon" aria-label="关闭弹窗" disabled={busy} onClick={onClose}><X size={20}/></button></header>
    <div className="cw-lifecycle-body" aria-busy={loading||busy}>
      {loading?<p role="status">正在读取项目…</p>:snapshot&&<>
        <div className="cw-lifecycle-heading"><h3>{snapshot.chat.title}</h3><span>{view.statusLabel}</span></div>
        {snapshot.chat.closedAt&&<time>{new Date(snapshot.chat.closedAt).toLocaleString('zh-CN')}</time>}
        {snapshot.chat.closeReason&&<p>{snapshot.chat.closeReason}</p>}
        <ul className="cw-lifecycle-cases">{snapshot.cases.map(item=><li key={item.publicId}><div><strong>{item.title}</strong>{item.predecessorCasePublicId&&<small>关联复测</small>}</div><span>{caseStatusLabel(item)}</span></li>)}</ul>
        {snapshot.cases.length===0&&<p>暂无对话。</p>}
        {view.successor&&<button type="button" className="cw-lifecycle-link" disabled={busy} onClick={()=>{onClose();onNavigate?.({chatPublicId:chatId,casePublicId:view.successor.publicId});}}>查看关联复测<ChevronRight size={15}/></button>}
        {!intent&&<div className="cw-lifecycle-actions">
          {view.canRetest&&<button type="button" disabled={busy} onClick={()=>choose('retest')}><RotateCcw size={16}/>关联复测</button>}
          {view.active&&<><button type="button" disabled={!view.canClose||busy} onClick={()=>choose('normal')}>封存项目</button><button type="button" disabled={busy} onClick={()=>choose('force')}>提前封存</button></>}
          {view.sealed&&<button type="button" disabled={busy} onClick={()=>choose('new-run')}>开启新项目</button>}
        </div>}
        {intent&&<form className="cw-lifecycle-confirm" onSubmit={event=>{event.preventDefault();submit();}}>
          <h3>{targetLabel}</h3>
          <p>{intent==='retest'?'保留本次失败记录，在当前项目中重新讨论和准备。':intent==='new-run'?'新项目为空白，已有正式数据与历史继续保留。':'封存后仅可查看，历史记录和实际结果保留。'}</p>
          {intent!=='normal'&&<label>说明<textarea autoFocus required maxLength={2000} value={reason} disabled={busy} onChange={event=>setReason(event.target.value)}/></label>}
          {intent==='new-run'&&<label className="cw-lifecycle-check"><input type="checkbox" checked={preserve} disabled={busy} onChange={event=>setPreserve(event.target.checked)}/>保留正式数据与历史记录</label>}
          <div className="cw-lifecycle-actions"><button type="button" disabled={busy} onClick={()=>setIntent(null)}>取消</button><button type="submit" disabled={busy||(intent==='normal'&&!view.canClose)||(intent==='retest'&&!view.canRetest)||(intent==='new-run'&&!preserve)}>{busy?'正在提交…':targetLabel}</button></div>
        </form>}
      </>}
      <div className="cw-lifecycle-error" role="alert">{error}{!snapshot&&!loading&&error&&<button type="button" onClick={read}>重新读取</button>}</div>
    </div>
  </dialog>;
}
