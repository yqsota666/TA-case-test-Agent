import {QuoteReply} from './assistant-ui/quote-reply.jsx';
import {quotedInput} from './assistant-ui/quoted-input.js';
import {CanvasSplit} from './assistant-ui/canvas-split.jsx';
import {DetailPanel} from './assistant-ui/detail-panel.jsx';
import {ArtifactCard} from './assistant-ui/artifact-card.jsx';
import {ApprovalCard} from './assistant-ui/approval-card.jsx';
import {ThreadList} from './assistant-ui/thread-list.jsx';
import {WorkflowProgress} from './assistant-ui/workflow-progress.jsx';
import './assistant-ui/elements.css';
import {MessageImages,readMessageImages} from './message-images.jsx';
import {GlobalDataCatalog} from './global-data-catalog.jsx';
import {GlobalFileCatalog} from './global-file-catalog.jsx';
import {ProjectLifecycleCard} from './project-lifecycle.jsx';
import {showProjectLifecycle} from './project-lifecycle.js';
import {accountStorageKey} from './account-storage.js';
import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {ArrowUp, ChevronRight, Folder, Menu, SquarePen, Workflow, Table2, File, FileText, FileArchive, ArrowLeft, X} from './ui-icons.jsx';
import './case-workbench.css';
import './workflow-actions.css';
import {FileExchangePanel} from './file-exchange.jsx';
import {ResultReview} from './result-review.jsx';
import './generated-draft.css';
import {WorkflowDiagram} from './workflow-diagram.jsx';
import {ExpectationReview} from './expectation-review.jsx';
import {liveSnapshot,requestCase,requestCaseStream,casePath} from './live-case-api.js';
import {discussionAction} from './discussion-actions.js';
import {MessageBody} from './message-body.jsx';
import {ThemePicker} from './theme-picker.jsx';
import {ProjectPicker} from './project-picker.jsx';
import {PlanDocument, planSummary} from './plan-document.jsx';
import {MessageSquare, RotateCcw} from './ui-icons.jsx';
import './node-feedback.css';
import {useSidebarResize} from './sidebar-resize.jsx';
import {ThreadPrimitive} from '@assistant-ui/react';
import {CaseAssistant} from './case-assistant.jsx';
import {Thread, ThreadViewport, ThreadMessages, ChatMessage, Composer} from './assistant-ui/chat-kit.jsx';
import './case-assistant.css';

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

export function CaseWorkbench({accountControl}) {
  const sidebarResize = useSidebarResize();
  const [state, setState] = useState(readState);
  const [modal, setModal] = useState(null);
  const [page,setPage]=useState(()=>['data','files'].includes(new URLSearchParams(location.search).get('page'))?new URLSearchParams(location.search).get('page'):'chat');
  const resultDirty=useRef(false);
  const [newConversation, setNewConversation] = useState(true);
  const [newProjectId, setNewProjectId] = useState('');
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [streamReply,setStreamReply]=useState(null);
  const streamController=useRef(null);
  useEffect(()=>()=>streamController.current?.abort(),[]);
  const [completed, setCompleted] = useState(false);
  const [nodeErrorCode,setNodeErrorCode]=useState('');
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
  const imageInput=useRef(null);
  const [imageDrafts,setImageDrafts]=useState({});
  const [readingImages,setReadingImages]=useState(false);
  const [retryImages,setRetryImages]=useState([]);
  const flowRequest = useRef(0);
  const viewRequest = useRef(0);
  const pendingScroll = useRef(false);
  const currentSet = state.sets.find(set => set.cases.some(item => item.id === state.selected)) || {id:newProjectId, name:"新项目", cases:[]};
  const projectReadOnly=!!currentSet.status && currentSet.status!=='ACTIVE';
  const currentCase = currentSet.cases.find(item => item.id === state.selected) || {name:"新对话"};
  const draftKey = newConversation ? `new:${newProjectId}` : state.selected;
  const draft = state.drafts[draftKey] || '';
  const images=imageDrafts[draftKey]||[];
  const quote=state.quotes?.[draftKey]||'';
  const [retryOriginalInput,setRetryOriginalInput]=useState('');
  const inputDisabled=loading||running||!!state.pending||((completed||projectReadOnly)&&!newConversation);
  const addImages=async files=>{if(inputDisabled||readingImages)return;const request=viewRequest.current;setReadingImages(true);try{const added=await readMessageImages(files,images);if(request===viewRequest.current)setImageDrafts(v=>({...v,[draftKey]:[...(v[draftKey]||[]),...added]}));}catch(e){setNotice(e.message);}finally{setReadingImages(false);}};
  const savedMessages = newConversation ? [] : state.messages[state.selected] || [];
  const messages = streamReply?.caseId===state.selected && streamReply.text ? [...savedMessages,{id:'streaming-assistant',role:'assistant',text:streamReply.text,continuation:streamReply.failed?'回复中断，完整结果尚未同步。':undefined}] : savedMessages;
  const dataSet = state.sets.find(set => set.id === dataSetId);

  const applySnapshot = snapshot => {
    const id = snapshot.case?.id;
    setCompleted(['PASS','FAIL'].includes(snapshot.case?.status));
    setRetryInput(snapshot.pending?.userInput || '');
    setRetryImages(snapshot.pending?.images||[]);
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
      messages: id ? {[id]:[...snapshot.turns.map((turn,index)=>({id:`turn-${index}`,role:turn.role,text:turn.content,images:turn.images,kind:turn.kind,createdAt:turn.createdAt,durationMs:turn.durationMs,result:!!snapshot.plan && (snapshot.plan.sourceTurnNumber ? turn.role==='assistant' && (turn.sourceTurnNumber!==undefined?turn.sourceTurnNumber===snapshot.plan.sourceTurnNumber:index===snapshot.plan.sourceTurnNumber*2-1) : false)})),
        ...(snapshot.pending ? [{id:'pending-user',role:'user',text:snapshot.pending.userInput,images:snapshot.pending.images}] : [])]} : {},
    }));
  };
  useEffect(() => {
    let active=true;
    const request=viewRequest.current;
    firstNodeRequest('state').then(snapshot => {if(active && request===viewRequest.current)applySnapshot(snapshot);})
      .catch(error => {if(active && request===viewRequest.current)setNodeError(error.message);})
      .finally(()=>{if(active && request===viewRequest.current)setLoading(false);});
    return ()=>{active=false;};
  }, []);
  useEffect(() => {
    if(!state.pending || !state.selected || newConversation)return;
    const project=state.sets.find(item=>item.cases.some(c=>c.id===state.selected));
    if(!project)return;
    let active=true;
    const request=viewRequest.current;
    const input=state.pending.userInput;
    const timer=setInterval(()=>{
      liveSnapshot(project.id,state.selected).then(snapshot=>{
        if(!active || request!==viewRequest.current)return;
        applySnapshot(snapshot);
        if(!snapshot.pending&&snapshot.turns.some(turn=>turn.role==='user'&&turn.content===input)) {
          setState(value=>{let matches=false;try{matches=quotedInput(value.drafts[state.selected]||'',value.quotes?.[state.selected])===input.trim();}catch{}return matches?{...value,drafts:{...value.drafts,[state.selected]:''},quotes:{...value.quotes,[state.selected]:''}}:value;});
        }
      }).catch(()=>{});
    },5000);
    return()=>{active=false;clearInterval(timer);};
  },[state.selected,state.pending?.turnNumber,newConversation]);
  useEffect(() => {
    try {localStorage.setItem(storageKey(), JSON.stringify(state,(key,value)=>['images','imageAnalysis'].includes(key)?undefined:value));} catch {setNotice('浏览器未能保存，本次内容仅保留在当前页面。');}
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
    if (pendingScroll.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
      composer.current.focus();
      pendingScroll.current = false;
    }
  }, [messages]);

  const selectCase = async id => {
    streamController.current?.abort();setStreamReply(null);
    const project=state.sets.find(item=>item.cases.some(c=>c.id===id));
    if(!project)return;
    const request=++viewRequest.current;
    const url=new URL(window.location.href);url.searchParams.delete('draftTable');url.searchParams.delete('page');url.searchParams.set('chatId',project.id);url.searchParams.set('caseId',id);window.history.replaceState(null,'',url);
    setPage('chat');setLoading(true);setNodeError('');setDataSetId(null);setModal(null);
    try {const snapshot=await liveSnapshot(project.id,id);if(request===viewRequest.current)applySnapshot(snapshot);} catch(error){if(request===viewRequest.current)setNodeError(error.message);} finally {if(request===viewRequest.current)setLoading(false);}
  };
  const openCatalogCase=async(chatId,caseId)=>{streamController.current?.abort();setStreamReply(null);const request=++viewRequest.current;const url=new URL(location.href);url.searchParams.delete('page');url.searchParams.delete('draftTable');url.searchParams.set('chatId',chatId);url.searchParams.set('caseId',caseId);history.replaceState(null,'',url);setPage('chat');setDataSetId(null);setModal(null);setLoading(true);try{const snapshot=await liveSnapshot(chatId,caseId);if(request===viewRequest.current)applySnapshot(snapshot);}catch(error){if(request===viewRequest.current)setNodeError(error.message);}finally{if(request===viewRequest.current)setLoading(false);}};
  const toggleSet = id => setState(value => ({...value, sets: value.sets.map(set => set.id === id ? {...set, expanded: !set.expanded} : set)}));
  const submitFirstNode = async (text, action=discussionAction({text,waiting:state.workflow?.waiting,messages}),sentImages=[],originalInput=text) => {
    if (running || loading || ((completed || projectReadOnly) && !newConversation)) return;
    const request=viewRequest.current;
    const controller=new AbortController();streamController.current=controller;setStreamReply(null);
    setRetryOriginalInput(originalInput);setRunning(true); setNodeError('');setNodeErrorCode(''); setRetryInput(text);setRetryImages(sentImages); setRetryAction(action); setActiveAction(action);
    pendingScroll.current = true;
    try {
      let chatId=currentSet.id,caseId=state.selected;
      if(newConversation) {
        chatId=newProjectId;
        if(!chatId)chatId=(await requestCase('/chats',{title:'新项目'})).publicId;
        caseId=(await requestCase(`/chats/${chatId}/cases`,{title:'新对话'})).publicId;
        if(request===viewRequest.current) {const url=new URL(window.location.href);url.searchParams.delete('draftTable');url.searchParams.delete('page');url.searchParams.set('chatId',chatId);url.searchParams.set('caseId',caseId);window.history.replaceState(null,'',url);}
      }
      const beforeSnapshot=await liveSnapshot(chatId,caseId);
      if(request===viewRequest.current) {
        applySnapshot(beforeSnapshot);
        setState(value=>({...value,drafts:{...value.drafts,[caseId]:value.drafts[draftKey] || originalInput},quotes:{...value.quotes,[caseId]:value.quotes?.[draftKey]||''},messages:{...value.messages,[caseId]:[...(value.messages[caseId]||[]),{id:'sending-user',role:'user',text,images:sentImages}]}}));
      }
      const path=casePath(chatId,caseId);
      const before=await requestCase(path+'/workflow');
      if(!before.waiting?.includes(action))throw new Error('当前流程不支持此操作，请刷新后查看当前步骤。');
      if(action==='PROPOSE_PLAN' && messages.filter(m=>m.role==='assistant').length<2)throw new Error('请先完成两轮讨论，再整理方案。');
      await requestCaseStream(path+(action==='PROPOSE_PLAN'?'/plan':'/discussion'),{userInput:text,...(sentImages.length?{images:sentImages}:{})},{signal:controller.signal,onDelta:delta=>{
        if(request===viewRequest.current)setStreamReply(value=>({caseId,text:(value?.caseId===caseId?value.text:'')+delta}));
      }});
      if(request===viewRequest.current)setStreamReply(null);
      await requestCase(path+'/workflow/resume',{eventId:crypto.randomUUID(),expectedStage:before.stage});
      const snapshot=await liveSnapshot(chatId,caseId);
      if(request===viewRequest.current)applySnapshot(snapshot);
      if(request===viewRequest.current)setStreamReply(null);
      setImageDrafts(v=>({...v,[draftKey]:[],[caseId]:[]}));
      setState(value=>({...value,drafts:{...value.drafts,[draftKey]:'',[caseId]:''},quotes:{...value.quotes,[draftKey]:'',[caseId]:''}}));
    } catch(error) {
      if(request===viewRequest.current) {
        setStreamReply(value=>value?{...value,failed:true}:value);
        setNodeError(error.message);setNodeErrorCode(error.code||'');
        try {const snapshot=await firstNodeRequest('state');if(request===viewRequest.current)applySnapshot(snapshot);} catch { /* Keep the original input available for retry. */ }
        if(request===viewRequest.current) {
          if(['BUSINESS_UNRELATED','BUSINESS_PURPOSE_REQUIRED'].includes(error.code)) {
            const id=new URL(window.location.href).searchParams.get('caseId')||draftKey;
            setRetryInput('');setRetryImages([]);
            setState(v=>({...v,drafts:{...v.drafts,[id]:originalInput}}));
            setImageDrafts(v=>({...v,[id]:sentImages}));
          }else{setRetryInput(text);setRetryImages(sentImages);setRetryAction(action);}
        }
      }
    } finally {pendingScroll.current=false;setRunning(false);}
  };
  const sendComposer = text => {
    try {const body=quotedInput(text,quote);return submitFirstNode(body,quote||images.length?'DISCUSS':undefined,images,text);}
    catch(error){setNotice(error.message);}
  };
  const savePlanContent = async (index,item) => {
    const request=viewRequest.current;
    const {contract,...proposal}=state.plan.proposal;
    const next={...proposal,scenarios:proposal.scenarios.map((value,i)=>i===index?item:value)};
    await requestCase(casePath(currentSet.id,state.selected)+'/plan/content',{versionNumber:state.plan.versionNumber,proposal:next});
    const snapshot=await liveSnapshot(currentSet.id,state.selected);
    if(request===viewRequest.current){applySnapshot(snapshot);setModal({type:'result'});}
  };
  const confirmPlan = async section => {
    const request=viewRequest.current;
    setPlanBusy(true);setPlanError('');
    try {
      const path=casePath(currentSet.id,state.selected);
      await requestCase(path+'/plan/confirm',{versionNumber:state.plan.versionNumber,section});
      const snapshot=await liveSnapshot(currentSet.id,state.selected);
      if(request!==viewRequest.current)return;
      applySnapshot(snapshot);
      if(section==='DATA' && snapshot.workflow?.stage==='CONFIRM_EXPECTATIONS')setModal({type:'expectations'});
      else if(section==='DATA')setPlanError('方案已更新，请重新审阅准备数据。');
      else setModal(null);
    } catch(error) {if(request===viewRequest.current)setPlanError(error.message);} finally {setPlanBusy(false);}
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
  const openNewConversation = projectId => {
    streamController.current?.abort();setStreamReply(null);
    ++viewRequest.current;
    const url=new URL(location.href);url.searchParams.delete('page');url.searchParams.delete('draftTable');url.searchParams.delete('caseId');if(projectId)url.searchParams.set('chatId',projectId);else url.searchParams.delete('chatId');history.replaceState(null,'',url);
    setPage('chat'); setNewProjectId(projectId); setNewConversation(true); setDataSetId(null); setModal(null); setNotice('');
    setLoading(false);setCompleted(false);setNodeError('');setRetryInput('');
    setState(value=>({...value,selected:null,pending:null,workflow:null,plan:null,generatedData:null}));
  };
  const sidebar = <>
    <div className="cw-brand"><img className="cw-brand-logo" src="/brand/ta-agent-bot-white.png" alt="" width="44" height="44"/><span>TA Test Agent</span></div>
    <nav className="cw-primary" aria-label="业务页面">
      <button aria-current={page==='chat' && newConversation ? 'page' : undefined} onClick={() => openNewConversation(currentSet.id)}><SquarePen size={18}/><span>Chat</span></button>
      <button onClick={() => {setPage('data');setModal(null);setNotice('');const url=new URL(location.href);url.searchParams.set('page','data');history.replaceState(null,'',url);}}><Table2 size={18}/><span>数据</span></button>
      <button onClick={() => {setPage('files');setModal(null);setNotice('');const url=new URL(location.href);url.searchParams.set('page','files');history.replaceState(null,'',url);}}><FileText size={18}/><span>文件</span></button>
    </nav>
    <div className="cw-list-label">项目</div>
    <nav className="cw-sets" aria-label="项目与 Case">
      {state.sets.map(set => <div className={`cw-set ${set.status!=='ACTIVE'?'is-sealed':''}`} key={set.id}>
        <div className="cw-set-heading">
          <button className="cw-set-toggle" aria-expanded={set.expanded} aria-controls={`cases-${set.id}`} onClick={() => toggleSet(set.id)}>
            <Folder size={18}/><span>{set.name}</span>
          </button>
          <button className="cw-icon cw-add" aria-label={`在${set.name}中新建 Case`} title="新建 Case" disabled={set.status!=='ACTIVE'} onClick={() => openNewConversation(set.id)}><SquarePen size={18}/></button>
        </div>
        <div id={`cases-${set.id}`} className={`cw-set-children ${set.expanded ? 'is-expanded' : ''}`} inert={!set.expanded}>
          <div className="cw-set-children-inner">
            <ThreadList threads={set.cases.map(item=>({id:item.id,title:item.name,time:''}))}
              activeIndex={!dataSetId&&!newConversation?set.cases.findIndex(item=>item.id===state.selected):-1}
              onActiveIndexChange={index=>selectCase(set.cases[index].id)}/>


          </div>
        </div>
      </div>)}
    </nav>
    <div className="cw-user">{accountControl}<ThemePicker /></div>
  </>;

  return <CanvasSplit className={`cw-shell ${page==='chat'&&['result','expectations','historical-plan'].includes(modal?.type)?'has-detail':''} ${page!=='chat'?'cw-catalog-view':''}`} style={sidebarResize.style}>
    <a className="cw-skip" href="#cw-main">跳到对话</a>
    <aside id="cw-sidebar" className="cw-sidebar">{sidebar}{sidebarResize.separator}</aside>
    <CaseAssistant key={draftKey} messages={messages} draft={draft} loading={loading} running={running || !!state.pending}
      disabled={inputDisabled || readingImages} onSend={sendComposer}>
    <Thread id="cw-main" className="cw-main" tabIndex={-1}>
      <header className={`cw-header ${page!=='chat'?'is-catalog':''}`}>
        <button className="cw-icon cw-menu" aria-label="打开侧边栏" onClick={() => setModal({type: 'navigation'})}><Menu size={21}/></button>
        {page==='chat' && state.workflow && !newConversation && <button className="cw-live-flow cw-icon" title="查看当前流程" aria-label="查看当前流程" onClick={openWorkflow}><Workflow size={18} strokeWidth={1.6}/></button>}
        <h1 hidden={newConversation || page!=='chat'} title={`${dataSet?.name || currentSet.name} / ${dataSet ? '草稿数据' : currentCase.name}`}><span>{dataSet?.name || currentSet.name}</span><span className="cw-slash"> / </span>{dataSet ? '草稿数据' : currentCase.name}</h1>
      </header>
      <ThreadViewport ref={scroller} hidden={!!dataSetId || page!=='chat'} className="cw-conversation" aria-label={newConversation ? '新对话' : `${currentCase.name}的对话`}
        onScroll={event => {if (!dataSetId && !newConversation) positions.current[state.selected] = event.currentTarget.scrollTop;}}>
        <div className={`cw-messages ${newConversation ? 'cw-new-conversation' : ''}`}>
          {newConversation && <div className="cw-new-welcome"><span className="cw-welcome-bot"><img className="cw-welcome-logo" src="/brand/ta-agent-bot-white.png" alt="" width="144" height="144"/></span><h2>开始新对话</h2></div>}
          <ThreadMessages>{({message: runtimeMessage}) => {
            const message = runtimeMessage.metadata.custom.caseMessage || {
              id: runtimeMessage.id, role: runtimeMessage.role,
              text: runtimeMessage.content.filter(part => part.type === 'text').map(part => part.text).join('\n'),
            };
            if (!message.text && !message.result && !message.continuation && !message.images?.length) return null;
            return <ChatMessage message={message} onQuote={inputDisabled?undefined:text=>{setState(v=>({...v,quotes:{...v.quotes,[draftKey]:text}}));composer.current?.focus();}} text={message.result && state.plan ? planSummary(state.plan.proposal) : message.kind==='PROPOSE_PLAN'?'已整理测试方案。原回复保留在详情中。':message.text}>
            <MessageImages images={message.images} onOpen={image=>setModal({type:'image',image})}/>
            {message.kind==='PROPOSE_PLAN' && !message.result && <ArtifactCard title="历史测试方案" meta="查看原回复" onClick={()=>setModal({type:'historical-plan',message})}/>}
            {message.result && <ArtifactCard title="测试方案" meta={state.plan?.status==='LOCKED'?'已确认':'查看与修改'} onClick={()=>{setPlanError('');setModal({type:state.workflow?.stage==='CONFIRM_EXPECTATIONS'?'expectations':'result'});}}/>}
            {message.id===messages.at(-1)?.id && message.role==='assistant' && !message.result && state.workflow?.waiting?.includes('PROPOSE_PLAN') && messages.filter(m=>m.role==='assistant').length>=2 && <div className="cw-workflow-actions">
              <button type="button" disabled={running || loading || !!retryInput || (!!draft.trim()||images.length>0||readingImages)} title={draft.trim()?'请先发送或清空输入框中的补充内容':undefined} onClick={()=>submitFirstNode('请根据刚才的讨论整理测试方案，供我审阅。','PROPOSE_PLAN')}><FileText size={15}/>整理方案</button>
            </div>}
          </ChatMessage>;}}</ThreadMessages>
          {state.workflow?.stage==='CONFIRM_EXPECTATIONS' && state.plan && <div className="cw-expect-handoff"><p>准备数据已确认。接下来核对各测试项的预期结果。</p><button type="button" className="cw-result" onClick={()=>{setPlanError('');setModal({type:'expectations'});}}><span className="cw-result-icon"><FileText size={18}/></span><span><span className="cw-result-title">预期结果</span><span className="cw-result-summary">查看与修改</span></span><span className="cw-result-action">查看详情<ChevronRight size={14}/></span></button></div>}
          {!newConversation && state.generatedData?.status==='VALIDATED' && <button type="button" className="cw-result" onClick={openGeneratedData}>
            <span className="cw-result-icon" aria-hidden="true"><Table2 size={18}/></span><span className="cw-result-copy"><span className="cw-result-title">草稿数据</span><span className="cw-result-summary">{state.generatedData.reviewStatus==='CONFIRMED'?'已确认':'查看数据'}</span></span><span className="cw-result-action">查看详情<ChevronRight size={14}/></span>
          </button>}
          {!newConversation && ['EVALUATE_RESULT','CONFIRM_RESULT','CASE_FINAL'].includes(state.workflow?.stage) && <button type="button" className="cw-result" onClick={()=>setModal({type:'review-result'})}><span className="cw-result-icon" aria-hidden="true"><FileText size={18}/></span><span className="cw-result-copy"><span className="cw-result-title">结果核对</span></span><span className="cw-result-action">查看详情<ChevronRight size={14}/></span></button>}
          {!newConversation && state.plan?.proposal?.exchangePlan?.status==='READY' && <button type="button" className="cw-result" onClick={()=>setModal({type:'exchange'})}>
            <span className="cw-result-icon" aria-hidden="true"><FileArchive size={18}/></span><span className="cw-result-copy"><span className="cw-result-title">文件交换</span><span className="cw-result-summary">申请文件与 TA 回传</span></span><span className="cw-result-action">查看详情<ChevronRight size={14}/></span>
          </button>}
          {!loading && !newConversation && currentSet.id && showProjectLifecycle(currentSet.status,currentCase.status) && <ProjectLifecycleCard chatId={currentSet.id} caseId={state.selected} onChanged={async()=>applySnapshot(await liveSnapshot(currentSet.id,state.selected))} onNavigate={async target=>{if(target.casePublicId)await openCatalogCase(target.chatPublicId,target.casePublicId);else {applySnapshot(await liveSnapshot(target.chatPublicId,null));openNewConversation(target.chatPublicId);}}}/>}
          {!newConversation && (loading||running||!!state.pending) && <WorkflowProgress workflow={state.workflow} caseStatus={currentCase.status} plan={state.plan} data={state.generatedData} loading={loading} running={running||!!state.pending} error={nodeError} activeAction={state.pending?.kind||activeAction}/>}
          {newConversation && (loading||running) && <p role="status">{loading?'连接讨论服务…':'正在回复…'}</p>}
          
          {nodeError && <div className="cw-node-error cw-node-feedback" role="alert"><MessageSquare size={16} className="cw-feedback-icon"/><div className="cw-feedback-content"><p>{nodeError}</p>{retryInput && !completed && nodeErrorCode!=='MODEL_BUDGET_EXHAUSTED' && <button type="button" disabled={running} aria-busy={running} onClick={()=>submitFirstNode(retryInput,retryAction,retryImages,retryOriginalInput||retryInput)}><RotateCcw size={15}/><span>{running?'重试中…':'重试原输入'}</span></button>}</div></div>}
        </div>
      </ThreadViewport>
      {page==='chat' && dataSet && <section className="cw-draft-page" aria-label={`${dataSet.name}的草稿数据`}>
        <h2>草稿数据</h2>{dataSet.id===currentSet.id && state.generatedData?.status==='VALIDATED' ? <>
          <GeneratedData data={state.generatedData}/>
          {state.workflow?.stage==='CONFIRM_DRAFT' && <footer className="cw-plan-confirm-footer">{planError&&<p role="alert">{planError}</p>}<button type="button" className="cw-primary-button" disabled={planBusy||running} onClick={confirmDraft}>{planBusy?'确认中…':'确认草稿'}</button></footer>}
        </> : <p>尚未生成。</p>}
      </section>}
      <div hidden={!!dataSetId || page!=='chat'} className="cw-composer-area">
        <ThreadPrimitive.ScrollToBottom className="cw-scroll-bottom" aria-label="回到最新消息" title="回到最新消息"><ArrowUp size={18}/></ThreadPrimitive.ScrollToBottom>
        <div className="cw-composer-frame" onDragOver={event=>{if(Array.from(event.dataTransfer.types).includes('Files'))event.preventDefault();}} onDrop={event=>{if(event.dataTransfer.files.length){event.preventDefault();addImages(event.dataTransfer.files);}}}>
        {quote && <div className="aui-quote-draft"><QuoteReply quoted={quote} toolbarVisible={false}/><button className="cw-icon" type="button" aria-label="移除引用" disabled={inputDisabled} onClick={()=>setState(v=>({...v,quotes:{...v.quotes,[draftKey]:''}}))}><X size={16}/></button></div>}
        <MessageImages images={images} onRemove={index=>setImageDrafts(v=>({...v,[draftKey]:(v[draftKey]||[]).filter((_,i)=>i!==index)}))} onOpen={image=>setModal({type:'image',image})} disabled={inputDisabled||readingImages}/>
        {newConversation && <div className="cw-project-bar"><ProjectPicker projects={state.sets} value={newProjectId} onChange={setNewProjectId}/></div>}
        <input ref={imageInput} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={event=>{addImages(event.target.files);event.target.value='';}}/>
        <Composer ref={composer} value={draft} hasImages={images.length>0} disabled={inputDisabled||readingImages}
          onAttach={()=>imageInput.current.click()}
          onImageSend={()=>sendComposer(draft.trim()||(quote?'':'请解析图片内容。'))}
          onPaste={event=>{const files=Array.from(event.clipboardData.items).filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile()).filter(Boolean);if(files.length){event.preventDefault();addImages(files);}}}
          onChange={event=>setState(value=>({...value,drafts:{...value.drafts,[draftKey]:event.target.value}}))}/>
        </div>
      </div>
      {page!=='chat' && <div className="gc-topbar"><button aria-label="返回对话" title="返回对话" onClick={()=>{setPage('chat');const url=new URL(location.href);url.searchParams.delete('page');history.replaceState(null,'',url);}}><ArrowLeft size={18}/></button><nav aria-label="业务页面">{[['data','数据'],['files','文件']].map(([key,label])=><button key={key} aria-current={page===key?'page':undefined} onClick={()=>{setPage(key);const url=new URL(location.href);url.searchParams.set('page',key);history.replaceState(null,'',url);}}>{label}</button>)}</nav></div>}
      {page==='data' && <GlobalDataCatalog onOpenCase={openCatalogCase}/>}
      {page==='files' && <GlobalFileCatalog onOpenCase={openCatalogCase}/>}
    </Thread>
    </CaseAssistant>
    <div className={`cw-notice ${notice ? 'is-visible' : ''}`} role="status">{notice}</div>
    {modal?.type==='image'&&<Modal title={modal.image.name} className="cw-image-modal" onClose={()=>setModal(null)}><img className="cw-full-image" src={modal.image.dataUrl} alt={modal.image.name}/></Modal>}
    {modal?.type === 'review-result' && <Modal title="结果核对" className="cw-result-review-modal" onClose={()=>{if(!resultDirty.current||window.confirm('有未保存的结果，确定关闭？'))setModal(null);}}><ResultReview chatId={currentSet.id} caseId={state.selected} readOnly={completed||currentSet.status!=='ACTIVE'} onDirtyChange={dirty=>{resultDirty.current=dirty;}} onChanged={async isCurrent=>{const snapshot=await liveSnapshot(currentSet.id,state.selected);if(isCurrent())applySnapshot(snapshot);}}/></Modal>}
    {modal?.type === 'exchange' && <Modal title="文件交换" onClose={()=>setModal(null)}><FileExchangePanel chatId={currentSet.id} caseId={state.selected} plan={state.plan} draft={state.generatedData} workflow={state.workflow} readOnly={completed||currentSet.status!=='ACTIVE'} onChanged={async()=>applySnapshot(await liveSnapshot(currentSet.id,state.selected))}/></Modal>}
    {modal?.type === 'workflow' && <Modal title="Case 流程" className="cw-flow-modal" onClose={()=>setModal(null)}><WorkflowDiagram workflow={modal.snapshot?.workflow || state.workflow} caseStatus={modal.snapshot?.case?.status || currentCase.status} plan={modal.snapshot?.plan || state.plan} data={modal.snapshot?.generatedData || state.generatedData} loading={modal.loading} error={modal.error} onRetry={openWorkflow}/></Modal>}
    {modal?.type === 'navigation' && <Modal title="项目" onClose={() => setModal(null)}><div className="cw-mobile-sidebar">{sidebar}</div></Modal>}
    {modal?.type === 'historical-plan' && <DetailPanel title="历史测试方案" onClose={()=>setModal(null)}><div className="cw-plan-document"><MessageBody message={modal.message} text={modal.message.text}/></div></DetailPanel>}
    {modal?.type === 'expectations' && state.plan && <DetailPanel title="确认预期结果" onClose={()=>setModal(null)}><ExpectationReview key={state.selected+state.plan.versionNumber} plan={state.plan} busy={planBusy||running} error={planError} onConfirm={()=>confirmPlan('EXPECTATIONS')} onSaveContent={savePlanContent}/></DetailPanel>}
    {modal?.type === 'result' && <DetailPanel title="测试方案" onClose={() => setModal(null)}>
      {state.plan && <PlanDocument key={state.selected+state.plan.versionNumber} proposal={state.plan.proposal} taskProgress={state.workflow?.tasks} locked={state.plan.status==='LOCKED'} onSaveOperations={async applications=>{
        const request=viewRequest.current;
        await requestCase(casePath(currentSet.id,state.selected)+'/plan/data',{versionNumber:state.plan.versionNumber,dataSpecification:state.plan.proposal.contract.dataSpecification,applications});
        const snapshot=await liveSnapshot(currentSet.id,state.selected);if(request===viewRequest.current)applySnapshot(snapshot);
      }} onSaveContent={savePlanContent} editable={state.plan.status==='PENDING_CONFIRMATION'&&!running&&!planBusy} onSave={async dataSpecification=>{
        const request=viewRequest.current;
        await requestCase(casePath(currentSet.id,state.selected)+'/plan/data',{versionNumber:state.plan.versionNumber,dataSpecification});
        const snapshot=await liveSnapshot(currentSet.id,state.selected);if(request===viewRequest.current)applySnapshot(snapshot);
      }} dataApproval={state.workflow?.stage==='CONFIRM_PLAN_DATA'&&<footer className="cw-plan-confirm-footer">{planError&&<p role="alert">{planError}</p>}<button type="button" className="cw-primary-button" disabled={planBusy||running} onClick={()=>confirmPlan('DATA')}>{planBusy?'确认中…':'确认准备数据'}</button></footer>}/>}
    </DetailPanel>}
  </CanvasSplit>;
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
