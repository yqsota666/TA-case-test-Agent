import {GlobalDataCatalog} from './global-data-catalog.jsx';
import {GlobalFileCatalog} from './global-file-catalog.jsx';
import {ProjectLifecycleCard} from './project-lifecycle.jsx';
import {accountStorageKey} from './account-storage.js';
import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {ArrowUp, ChevronRight, Folder, Menu, SquarePen, Workflow, Table2, File, FileText, FileArchive, UserRound, X} from 'lucide-react';
import './case-workbench.css';
import './workflow-actions.css';
import {FileExchangePanel} from './file-exchange.jsx';
import {ResultReview} from './result-review.jsx';
import './generated-draft.css';
import {WorkflowDiagram} from './workflow-diagram.jsx';
import {ExpectationReview} from './expectation-review.jsx';
import {liveSnapshot,requestCase,casePath} from './live-case-api.js';
import {discussionAction} from './discussion-actions.js';
import {MessageBody} from './message-body.jsx';
import {ThemePicker} from './theme-picker.jsx';
import {ProjectPicker} from './project-picker.jsx';
import {PlanDocument, planSummary} from './plan-document.jsx';

const storageKey = () => accountStorageKey();
const initialState = {selected: null, sets: [], drafts: {}, messages: {}};
function readState() {
  try {
    for (const key of [storageKey()]) {
      const state = JSON.parse(localStorage.getItem(key));
      if (Array.isArray(state?.sets) && state.drafts && state.messages) return state;
    }
  } catch { /* Storage may be unavailable in private browsing. */ }
  return initialState;
}
async function firstNodeRequest() {
  const params=new URLSearchParams(window.location.search);
  return liveSnapshot(params.get('chatId'),params.get('caseId'));
}

function Modal({title, children, onClose, className = ''}) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous=document.activeElement;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    dialog.showModal();
    return () => {dialog.close();document.body.style.overflow=previousOverflow;previous?.focus();};
  }, []);
  return <dialog ref={ref} className={`cw-modal ${className}`} aria-labelledby="cw-modal-title" onCancel={event=>{event.preventDefault();onClose();}}
    onClick={event => {if (event.target === event.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}}>
    <header><h2 id="cw-modal-title">{title}</h2><button className="cw-icon" aria-label="关闭弹窗" onClick={onClose}><X size={20}/></button></header>
    {children}
  </dialog>;
}

export function CaseWorkbench() {
  const [state, setState] = useState(readState);
  const [modal, setModal] = useState(null);
  const [page,setPage]=useState(()=>['data','files'].includes(new URLSearchParams(location.search).get('page'))?new URLSearchParams(location.search).get('page'):'chat');
  const resultDirty=useRef(false);
  const [newConversation, setNewConversation] = useState(true);
  const [newProjectId, setNewProjectId] = useState('');
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [nodeError, setNodeError] = useState('');
  const [planBusy,setPlanBusy]=useState(false);
  const [planError,setPlanError]=useState('');
  const [retryInput, setRetryInput] = useState('');
  const [retryAction, setRetryAction] = useState('DISCUSS');
  const [activeAction, setActiveAction] = useState('DISCUSS');
  const [notice, setNotice] = useState('');
  const [dataSetId, setDataSetId] = useState(null);
  const scroller = useRef(null);
  const positions = useRef({});
  const composer = useRef(null);
  const flowRequest = useRef(0);
  const pendingScroll = useRef(false);
  const currentSet = state.sets.find(set => set.cases.some(item => item.id === state.selected)) || {id:newProjectId, name:"新项目", cases:[]};
  const projectReadOnly=!!currentSet.status && currentSet.status!=='ACTIVE';
  const currentCase = currentSet.cases.find(item => item.id === state.selected) || {name:"新对话"};
  const draftKey = newConversation ? `new:${newProjectId}` : state.selected;
  const draft = state.drafts[draftKey] || '';
  const messages = newConversation ? [] : state.messages[state.selected] || [];
  const dataSet = state.sets.find(set => set.id === dataSetId);

  const applySnapshot = snapshot => {
    const id = snapshot.case?.id;
    setCompleted(['PASS','FAIL'].includes(snapshot.case?.status));
    setRetryInput(snapshot.pending?.userInput || '');
    setRetryAction(snapshot.pending?.kind || 'DISCUSS');
    setNewConversation(!id);
    setNewProjectId(snapshot.project?.id || snapshot.projects?.[0]?.id || '');
    if(['customers','accounts','funds','holdings'].includes(new URLSearchParams(window.location.search).get('draftTable')))setDataSetId(snapshot.project?.id || null);
    setState(value => ({...value, selected:id || null,
      sets:snapshot.projects || [],
      workflow:snapshot.workflow || null,
      generatedData:snapshot.generatedData || null,
      drafts: id ? value.drafts : {...value.drafts, 'new:':value.drafts['new:'] || snapshot.requirement},
      pending:snapshot.pending || null,
      plan:snapshot.plan || null,
      followup:snapshot.followup || null,
      messages: id ? {[id]:[...snapshot.turns.map((turn,index)=>({id:`turn-${index}`,role:turn.role,text:turn.content,kind:turn.kind,createdAt:turn.createdAt,durationMs:turn.durationMs,result:!!snapshot.plan && (snapshot.plan.sourceTurnNumber ? turn.role==='assistant' && (turn.sourceTurnNumber!==undefined?turn.sourceTurnNumber===snapshot.plan.sourceTurnNumber:index===snapshot.plan.sourceTurnNumber*2-1) : false)})),
        ...(snapshot.pending ? [{id:'pending-user',role:'user',text:snapshot.pending.userInput}] : [])]} : {},
    }));
  };
  useEffect(() => {
    let active=true;
    firstNodeRequest('state').then(snapshot => {if(active)applySnapshot(snapshot);})
      .catch(error => {if(active)setNodeError(error.message);})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  }, []);
  useEffect(() => {
    if(!state.pending || !state.selected)return;
    const project=state.sets.find(item=>item.cases.some(c=>c.id===state.selected));
    if(!project)return;
    let active=true;
    const input=state.pending.userInput;
    const timer=setInterval(()=>{
      liveSnapshot(project.id,state.selected).then(snapshot=>{
        if(!active)return;
        applySnapshot(snapshot);
        if(!snapshot.pending)setState(value=>({...value,drafts:{...value.drafts,[state.selected]:value.drafts[state.selected]?.trim()===input.trim()?'':value.drafts[state.selected]}}));
      }).catch(()=>{});
    },5000);
    return()=>{active=false;clearInterval(timer);};
  },[state.selected,state.pending?.turnNumber]);
  useEffect(() => {
    try {localStorage.setItem(storageKey(), JSON.stringify(state));} catch {setNotice('浏览器未能保存，本次内容仅保留在当前页面。');}
  }, [state]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useLayoutEffect(() => {
    if (!dataSetId) scroller.current.scrollTop = newConversation ? 0 : positions.current[state.selected] || 0;
  }, [state.selected, dataSetId, newConversation]);
  useLayoutEffect(() => {
    composer.current.style.height = 'auto';
    composer.current.style.height = `${Math.min(Math.max(composer.current.scrollHeight, 28), 180)}px`;
  }, [draft]);
  useLayoutEffect(() => {
    if (pendingScroll.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
      composer.current.focus();
      pendingScroll.current = false;
    }
  }, [messages]);

  const selectCase = async id => {
    const project=state.sets.find(item=>item.cases.some(c=>c.id===id));
    if(!project)return;
    const url=new URL(window.location.href);url.searchParams.delete('draftTable');url.searchParams.delete('page');url.searchParams.set('chatId',project.id);url.searchParams.set('caseId',id);window.history.replaceState(null,'',url);
    setPage('chat');setLoading(true);setNodeError('');setDataSetId(null);setModal(null);
    try {applySnapshot(await liveSnapshot(project.id,id));} catch(error){setNodeError(error.message);} finally {setLoading(false);}
  };
  const openCatalogCase=async(chatId,caseId)=>{const url=new URL(location.href);url.searchParams.delete('page');url.searchParams.delete('draftTable');url.searchParams.set('chatId',chatId);url.searchParams.set('caseId',caseId);history.replaceState(null,'',url);setPage('chat');setDataSetId(null);setModal(null);setLoading(true);try{applySnapshot(await liveSnapshot(chatId,caseId));}catch(error){setNodeError(error.message);}finally{setLoading(false);}};
  const toggleSet = id => setState(value => ({...value, sets: value.sets.map(set => set.id === id ? {...set, expanded: !set.expanded} : set)}));
  const submitFirstNode = async (text, action=discussionAction({text,waiting:state.workflow?.waiting,messages})) => {
    if (running || loading || ((completed || projectReadOnly) && !newConversation)) return;
    setRunning(true); setNodeError(''); setRetryInput(text); setRetryAction(action); setActiveAction(action);
    pendingScroll.current = true;
    try {
      let chatId=currentSet.id,caseId=state.selected;
      if(newConversation) {
        chatId=newProjectId;
        if(!chatId)chatId=(await requestCase('/chats',{title:'新项目'})).publicId;
        caseId=(await requestCase(`/chats/${chatId}/cases`,{title:'新对话'})).publicId;
        const url=new URL(window.location.href);url.searchParams.delete('draftTable');url.searchParams.delete('page');url.searchParams.set('chatId',chatId);url.searchParams.set('caseId',caseId);window.history.replaceState(null,'',url);
      }
      applySnapshot(await liveSnapshot(chatId,caseId));
      setState(value=>({...value,messages:{...value.messages,[caseId]:[...(value.messages[caseId]||[]),{id:'sending-user',role:'user',text}]}}));
      const path=casePath(chatId,caseId);
      const before=await requestCase(path+'/workflow');
      if(!before.waiting?.includes(action))throw new Error('当前流程不支持此操作，请刷新后查看当前步骤。');
      if(action==='PROPOSE_PLAN' && messages.filter(m=>m.role==='assistant').length<2)throw new Error('请先完成两轮讨论，再整理方案。');
      await requestCase(path+(action==='PROPOSE_PLAN'?'/plan':'/discussion'),{userInput:text});
      await requestCase(path+'/workflow/resume',{eventId:crypto.randomUUID(),expectedStage:before.stage});
      const snapshot=await liveSnapshot(chatId,caseId);
      applySnapshot(snapshot);
      setState(value=>({...value,drafts:{...value.drafts,[draftKey]:''}}));
    } catch(error) {
      setNodeError(error.message);
      try {applySnapshot(await firstNodeRequest('state'));} catch { /* Keep the original input available for retry. */ }
      setRetryInput(text); setRetryAction(action);
    } finally {setRunning(false);}
  };
  const savePlanContent = async (index,item) => {
    const {contract,...proposal}=state.plan.proposal;
    const next={...proposal,scenarios:proposal.scenarios.map((value,i)=>i===index?item:value)};
    await requestCase(casePath(currentSet.id,state.selected)+'/plan/content',{versionNumber:state.plan.versionNumber,proposal:next});
    applySnapshot(await liveSnapshot(currentSet.id,state.selected));
    setModal({type:'result'});
  };
  const confirmPlan = async section => {
    setPlanBusy(true);setPlanError('');
    try {
      const path=casePath(currentSet.id,state.selected);
      await requestCase(path+'/plan/confirm',{versionNumber:state.plan.versionNumber,section});
      const snapshot=await liveSnapshot(currentSet.id,state.selected);
      applySnapshot(snapshot);
      if(section==='DATA' && snapshot.workflow?.stage==='CONFIRM_EXPECTATIONS')setModal({type:'expectations'});
      else if(section==='DATA')setPlanError('方案已更新，请重新审阅准备数据。');
      else setModal(null);
    } catch(error) {setPlanError(error.message);} finally {setPlanBusy(false);}
  };
  const openGeneratedData = () => {
    const url=new URL(window.location.href);url.searchParams.set('draftTable','customers');
    window.history.replaceState(null,'',url);setDataSetId(currentSet.id);setModal(null);
  };
  const confirmDraft = async () => {
    setPlanBusy(true);setPlanError('');
    try {
      await requestCase(casePath(currentSet.id,state.selected)+'/data/confirm',{revision:state.generatedData.revision});
      applySnapshot(await liveSnapshot(currentSet.id,state.selected));
    } catch(error) {setPlanError(error.message);} finally {setPlanBusy(false);}
  };
  const openWorkflow = async () => {
    const request=++flowRequest.current;
    setModal({type:'workflow', loading:true});
    try {
      const snapshot=await liveSnapshot(currentSet.id,state.selected);
      if(request===flowRequest.current)setModal(value=>value?.type==='workflow'?{type:'workflow',snapshot}:value);
    } catch(error) {
      if(request===flowRequest.current)setModal(value=>value?.type==='workflow'?{type:'workflow',error:error.message}:value);
    }
  };
  const send = event => {
    event.preventDefault();
    if (draft.trim()) submitFirstNode(draft.trim());
  };
  const openNewConversation = projectId => {
    const url=new URL(location.href);url.searchParams.delete('page');url.searchParams.delete('draftTable');url.searchParams.delete('caseId');if(projectId)url.searchParams.set('chatId',projectId);else url.searchParams.delete('chatId');history.replaceState(null,'',url);
    setPage('chat'); setNewProjectId(projectId); setNewConversation(true); setDataSetId(null); setModal(null); setNotice('');
  };
  const sidebar = <>
    <div className="cw-brand"><img className="cw-brand-logo" src="/brand/ta-agent-bot-white.png" alt="" width="44" height="44"/><span>TA Test Agent</span></div>
    <nav className="cw-primary" aria-label="业务页面">
      <button aria-current={page==='chat' && newConversation ? 'page' : undefined} onClick={() => openNewConversation(currentSet.id)}><SquarePen size={20}/><span>Chat</span></button>
      <button onClick={() => {setPage('data');setModal(null);setNotice('');const url=new URL(location.href);url.searchParams.set('page','data');history.replaceState(null,'',url);}}><Table2 size={20}/><span>数据</span></button>
      <button onClick={() => {setPage('files');setModal(null);setNotice('');const url=new URL(location.href);url.searchParams.set('page','files');history.replaceState(null,'',url);}}><File size={20}/><span>文件</span></button>
    </nav>
    <div className="cw-list-label">项目</div>
    <nav className="cw-sets" aria-label="项目与 Case">
      {state.sets.map(set => <div className={`cw-set ${set.status!=='ACTIVE'?'is-sealed':''}`} key={set.id}>
        <div className="cw-set-heading">
          <button className="cw-set-toggle" aria-expanded={set.expanded} aria-controls={`cases-${set.id}`} onClick={() => toggleSet(set.id)}>
            <Folder size={20}/><span>{set.name}</span>
          </button>
          <button className="cw-icon cw-add" aria-label={`在${set.name}中新建 Case`} title="新建 Case" disabled={set.status!=='ACTIVE'} onClick={() => openNewConversation(set.id)}><SquarePen size={18}/></button>
        </div>
        <div id={`cases-${set.id}`} className={`cw-set-children ${set.expanded ? 'is-expanded' : ''}`} inert={!set.expanded}>
          <div className="cw-set-children-inner">
            {set.cases.map(item => <button key={item.id} className={`cw-case ${!dataSetId && !newConversation && state.selected === item.id ? 'is-selected' : ''}`}
              title={item.name} aria-current={!dataSetId && !newConversation && state.selected === item.id ? 'page' : undefined} onClick={() => selectCase(item.id)}>
              <span>{item.name}</span>
            </button>)}

          </div>
        </div>
      </div>)}
    </nav>
    <div className="cw-user"><UserRound size={18}/><span>用户名</span><ThemePicker /></div>
  </>;

  return <div className="cw-shell">
    <a className="cw-skip" href="#cw-main">跳到对话</a>
    <aside className="cw-sidebar">{sidebar}</aside>
    <main id="cw-main" className="cw-main" tabIndex={-1}>
      <header className={`cw-header ${page!=='chat'?'is-catalog':''}`}>
        <button className="cw-icon cw-menu" aria-label="打开侧边栏" onClick={() => setModal({type: 'navigation'})}><Menu size={21}/></button>
        {page==='chat' && state.workflow && !newConversation && <button className="cw-live-flow cw-icon" title="查看当前流程" aria-label="查看当前流程" onClick={openWorkflow}><Workflow size={18} strokeWidth={1.6}/></button>}
        <h1 hidden={newConversation || page!=='chat'} title={`${dataSet?.name || currentSet.name} / ${dataSet ? '草稿数据' : currentCase.name}`}><span>{dataSet?.name || currentSet.name}</span><span className="cw-slash"> / </span>{dataSet ? '草稿数据' : currentCase.name}</h1>
      </header>
      <section ref={scroller} hidden={!!dataSetId || page!=='chat'} className="cw-conversation" aria-label={newConversation ? '新对话' : `${currentCase.name}的对话`}
        onScroll={event => {if (!dataSetId && !newConversation) positions.current[state.selected] = event.currentTarget.scrollTop;}}>
        <div className={`cw-messages ${newConversation ? 'cw-new-conversation' : ''}`}>
          {newConversation && <div className="cw-new-welcome"><span className="cw-welcome-bot"><img className="cw-welcome-logo" src="/brand/ta-agent-bot-white.png" alt="" width="144" height="144"/></span><h2>开始新对话</h2></div>}
          {messages.map(message => <article key={message.id} className={`cw-message cw-message-${message.role}`} aria-label={message.role === 'user' ? '我的消息' : 'AI 回复'}>
            <MessageBody message={message} text={message.result && state.plan ? planSummary(state.plan.proposal) : message.kind==='PROPOSE_PLAN'?'已整理测试方案。原回复保留在详情中。':message.text}>
            {message.kind==='PROPOSE_PLAN' && !message.result && <button className="cw-result" onClick={()=>setModal({type:'historical-plan',message})}>
              <span className="cw-result-icon" aria-hidden="true"><FileText size={20}/></span><span className="cw-result-copy"><span className="cw-result-title">历史测试方案</span></span><span className="cw-result-action">查看原回复 <ChevronRight size={16}/></span>
            </button>}
            {message.result && <button className="cw-result" onClick={() => setModal({type: 'result'})}>
              <span className="cw-result-icon" aria-hidden="true"><FileText size={20}/></span>
              <span className="cw-result-copy"><span className="cw-result-title">测试方案</span><span className="cw-result-summary">{state.plan?.status==='LOCKED'?'已确认':'查看与修改'}</span></span>
              <span className="cw-result-action">查看详情 <ChevronRight size={16}/></span>
            </button>}
            </MessageBody>
            {message.id===messages.at(-1)?.id && message.role==='assistant' && !message.result && state.workflow?.waiting?.includes('PROPOSE_PLAN') && messages.filter(m=>m.role==='assistant').length>=2 && <div className="cw-workflow-actions">
              <button type="button" disabled={running || loading || !!retryInput || !!draft.trim()} title={draft.trim()?'请先发送或清空输入框中的补充内容':undefined} onClick={()=>submitFirstNode('请根据刚才的讨论整理测试方案，供我审阅。','PROPOSE_PLAN')}><FileText size={15}/>整理方案</button>
            </div>}
          </article>)}
          {state.workflow?.stage==='CONFIRM_EXPECTATIONS' && state.plan && <div className="cw-expect-handoff"><p>准备数据已确认。接下来核对各测试项的预期结果。</p><button type="button" className="cw-result" onClick={()=>{setPlanError('');setModal({type:'expectations'});}}><span className="cw-result-icon"><FileText size={18}/></span><span><span className="cw-result-title">预期结果</span><span className="cw-result-summary">查看与修改</span></span><span className="cw-result-action">查看详情<ChevronRight size={14}/></span></button></div>}
          {!newConversation && state.generatedData?.status==='VALIDATED' && <button type="button" className="cw-result" onClick={openGeneratedData}>
            <span className="cw-result-icon" aria-hidden="true"><Table2 size={18}/></span><span className="cw-result-copy"><span className="cw-result-title">草稿数据</span><span className="cw-result-summary">{state.generatedData.reviewStatus==='CONFIRMED'?'已确认':'查看数据'}</span></span><span className="cw-result-action">查看详情<ChevronRight size={14}/></span>
          </button>}
          {!newConversation && ['EVALUATE_RESULT','CONFIRM_RESULT','CASE_FINAL'].includes(state.workflow?.stage) && <button type="button" className="cw-result" onClick={()=>setModal({type:'review-result'})}><span className="cw-result-icon" aria-hidden="true"><FileText size={18}/></span><span className="cw-result-copy"><span className="cw-result-title">结果核对</span></span><span className="cw-result-action">查看详情<ChevronRight size={14}/></span></button>}
          {!newConversation && state.plan?.proposal?.exchangePlan?.status==='READY' && <button type="button" className="cw-result" onClick={()=>setModal({type:'exchange'})}>
            <span className="cw-result-icon" aria-hidden="true"><FileArchive size={18}/></span><span className="cw-result-copy"><span className="cw-result-title">文件交换</span><span className="cw-result-summary">申请文件与 TA 回传</span></span><span className="cw-result-action">查看详情<ChevronRight size={14}/></span>
          </button>}
          {!newConversation && currentSet.id && <ProjectLifecycleCard chatId={currentSet.id} caseId={state.selected} onChanged={async()=>applySnapshot(await liveSnapshot(currentSet.id,state.selected))} onNavigate={async target=>{if(target.casePublicId)await openCatalogCase(target.chatPublicId,target.casePublicId);else {applySnapshot(await liveSnapshot(target.chatPublicId,null));openNewConversation(target.chatPublicId);}}}/>}
          {(loading || running || state.pending) && <p className="cw-node-status" role="status">{loading ? '连接讨论服务…' : (state.pending?.kind==='PROPOSE_PLAN' || activeAction==='PROPOSE_PLAN')?'正在整理方案…':'正在回复…'}</p>}
          
          {nodeError && <div className="cw-node-error" role="alert"><p>{nodeError}</p>{retryInput && !completed && <button type="button" disabled={running} onClick={()=>submitFirstNode(retryInput,retryAction)}>重试原输入</button>}</div>}
          {state.pending && !running && !nodeError && <div className="cw-workflow-actions"><button type="button" onClick={()=>submitFirstNode(state.pending.userInput,state.pending.kind)}>重试原请求</button></div>}
        </div>
      </section>
      {page==='chat' && dataSet && <section className="cw-draft-page" aria-label={`${dataSet.name}的草稿数据`}>
        <h2>草稿数据</h2>{dataSet.id===currentSet.id && state.generatedData?.status==='VALIDATED' ? <>
          <GeneratedData data={state.generatedData}/>
          {state.workflow?.stage==='CONFIRM_DRAFT' && <footer className="cw-plan-confirm-footer">{planError&&<p role="alert">{planError}</p>}<button type="button" className="cw-primary-button" disabled={planBusy||running} onClick={confirmDraft}>{planBusy?'确认中…':'确认草稿'}</button></footer>}
        </> : <p>尚未生成。</p>}
      </section>}
      <div hidden={!!dataSetId || page!=='chat'} className="cw-composer-area">
        <div className="cw-composer-frame">
        {newConversation && <div className="cw-project-bar">
          <ProjectPicker projects={state.sets} value={newProjectId} onChange={setNewProjectId}/>
        </div>}
        <form className="cw-composer" onSubmit={send}>
          <label className="cw-sr-only" htmlFor="cw-message">输入消息</label>
          <textarea id="cw-message" ref={composer} value={draft} placeholder="输入消息…" rows={1} disabled={loading || running || !!state.pending || ((completed || projectReadOnly) && !newConversation)}
            onChange={event => setState(value => ({...value, drafts: {...value.drafts, [draftKey]: event.target.value}}))}
            onKeyDown={event => {if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) send(event);}}/>
          <div className="cw-send-row"><button className="cw-send" type="submit" aria-label="发送消息" disabled={!draft.trim() || loading || running || !!state.pending || ((completed || projectReadOnly) && !newConversation)}><ArrowUp size={20}/></button></div>
        </form>
        </div>
      </div>
      {page==='data' && <GlobalDataCatalog onOpenCase={openCatalogCase}/>}
      {page==='files' && <GlobalFileCatalog onOpenCase={openCatalogCase}/>}
    </main>
    <div className={`cw-notice ${notice ? 'is-visible' : ''}`} role="status">{notice}</div>
    {modal?.type === 'review-result' && <Modal title="结果核对" className="cw-result-review-modal" onClose={()=>{if(!resultDirty.current||window.confirm('有未保存的结果，确定关闭？'))setModal(null);}}><ResultReview chatId={currentSet.id} caseId={state.selected} readOnly={completed||currentSet.status!=='ACTIVE'} onDirtyChange={dirty=>{resultDirty.current=dirty;}} onChanged={async isCurrent=>{const snapshot=await liveSnapshot(currentSet.id,state.selected);if(isCurrent())applySnapshot(snapshot);}}/></Modal>}
    {modal?.type === 'exchange' && <Modal title="文件交换" onClose={()=>setModal(null)}><FileExchangePanel chatId={currentSet.id} caseId={state.selected} plan={state.plan} draft={state.generatedData} workflow={state.workflow} readOnly={completed||currentSet.status!=='ACTIVE'} onChanged={async()=>applySnapshot(await liveSnapshot(currentSet.id,state.selected))}/></Modal>}
    {modal?.type === 'workflow' && <Modal title="Case 流程" className="cw-flow-modal" onClose={()=>setModal(null)}><WorkflowDiagram workflow={modal.snapshot?.workflow || state.workflow} caseStatus={modal.snapshot?.case?.status || currentCase.status} plan={modal.snapshot?.plan || state.plan} data={modal.snapshot?.generatedData || state.generatedData} loading={modal.loading} error={modal.error} onRetry={openWorkflow}/></Modal>}
    {modal?.type === 'navigation' && <Modal title="项目" onClose={() => setModal(null)}><div className="cw-mobile-sidebar">{sidebar}</div></Modal>}
    {modal?.type === 'historical-plan' && <Modal title="历史测试方案" className="cw-plan-modal" onClose={()=>setModal(null)}><div className="cw-plan-document"><MessageBody message={modal.message} text={modal.message.text}/></div></Modal>}
    {modal?.type === 'expectations' && state.plan && <Modal title="确认预期结果" className="cw-plan-modal" onClose={()=>setModal(null)}><ExpectationReview plan={state.plan} busy={planBusy} error={planError} onConfirm={()=>confirmPlan('EXPECTATIONS')} onSaveContent={savePlanContent}/></Modal>}
    {modal?.type === 'result' && <Modal title="测试方案" className="cw-plan-modal" onClose={() => setModal(null)}>
      {state.plan && <PlanDocument proposal={state.plan.proposal} onSaveContent={savePlanContent} editable={state.plan.status==='PENDING_CONFIRMATION'&&!running&&!planBusy} onSave={async dataSpecification=>{
        await requestCase(casePath(currentSet.id,state.selected)+'/plan/data',{versionNumber:state.plan.versionNumber,dataSpecification});
        applySnapshot(await liveSnapshot(currentSet.id,state.selected));
      }}/>}
      {state.workflow?.stage==='CONFIRM_PLAN_DATA' && <footer className="cw-plan-confirm-footer">{planError&&<p role="alert">{planError}</p>}<button type="button" className="cw-primary-button" disabled={planBusy||running} onClick={()=>confirmPlan('DATA')}>{planBusy?'确认中…':'确认准备数据'}</button></footer>}
    </Modal>}
  </div>;
}

function GeneratedData({data}) {
  const tables=[
    ['customers','客户',['姓名','客户类型','模拟余额'],data.customers.map(row=>[row.name,row.investor_type==='1'?'个人':'机构',row.simulated_balance])],
    ['accounts','账户',['客户','交易账户','分支'],data.accounts.map(row=>[data.customers.find(c=>String(c.id)===String(row.customer_id))?.name,row.account_no,row.branch_code])],
    ['funds','基金',['基金代码','基金名称','份额类别','净值'],data.funds.map(row=>[row.fund_code,row.fund_name,row.share_class,row.nav])],
    ['holdings','模拟持有',['交易账户','基金代码','份额类别','模拟份额'],data.holdings.map(row=>[data.accounts.find(a=>String(a.id)===String(row.account_id))?.account_no,row.fund_code,row.share_class,row.total_volume])],
  ];
  const selected=new URLSearchParams(window.location.search).get('draftTable') || 'customers';
  const [key,name,columns,rows]=tables.find(table=>table[0]===selected) || tables[0];
  const href=id=>{const url=new URL(window.location.href);url.searchParams.set('draftTable',id);url.hash='';return url.pathname+url.search;};
  return <div className="cw-generated-data">
    <nav className="cw-data-pages" aria-label="草稿数据页面">{tables.map(([id,label])=><a key={id} href={href(id)} aria-current={key===id?'page':undefined}>{label}</a>)}</nav>
    <section aria-label={name}><h3>{name}</h3><div className="cw-plan-comparison"><table><caption className="cw-sr-only">{name}</caption><thead><tr>{columns.map(column=><th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row,index)=><tr key={index}>{row.map((cell,j)=><td key={j}>{cell}</td>)}</tr>)}</tbody></table></div></section>
  </div>;
}
