import {RecordDetails} from './assistant-ui/record-details.jsx';
import {DetailTabs,DetailTabPanel} from './assistant-ui/detail-tabs.jsx';
import {QuoteReply} from './assistant-ui/quote-reply.jsx';
import {quotedInput} from './assistant-ui/quoted-input.js';
import {CanvasSplit} from './assistant-ui/canvas-split.jsx';
import {DetailPanel} from './assistant-ui/detail-panel.jsx';
import {ArtifactCard} from './assistant-ui/artifact-card.jsx';
import {planArtifactMeta} from './chat-artifact-state.js';
import {ApprovalCard} from './assistant-ui/approval-card.jsx';
import {ThreadList} from './assistant-ui/thread-list.jsx';
import {NameButton} from './assistant-ui/name-button.jsx';
import './assistant-ui/elements.css';
import {MessageImages,readMessageImages} from './message-images.jsx';
import {GlobalDataCatalog} from './global-data-catalog.jsx';
import {GlobalFileCatalog} from './global-file-catalog.jsx';
import {ProjectLifecycleCard} from './project-lifecycle.jsx';
import {showProjectLifecycle} from './project-lifecycle.js';
import {accountStorageKey} from './account-storage.js';
import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Folder, Menu, SquarePen, Workflow, Table2, File, FileText, FileArchive, ArrowLeft, X} from './ui-icons.jsx';
import './case-workbench.css';
import './workflow-actions.css';
import {FileExchangePanel} from './file-exchange.jsx';
import {showExchangeEntry} from './exchange-entry.js';
import {ResultReview} from './result-review.jsx';
import './generated-draft.css';
import {WorkflowDiagram} from './workflow-diagram.jsx';
import './expectation-review.css';
import {planApproval} from './plan-approval.js';
import {liveSnapshot,requestCase,requestCaseStream,casePath} from './live-case-api.js';
import {discussionAction} from './discussion-actions.js';
import {MessageBody} from './message-body.jsx';
import {HistoricalPlan} from './historical-plan.jsx';
import {ThemePicker} from './theme-picker.jsx';
import {NewCaseForm,NewProjectForm,RenameForm} from './new-case-form.jsx';
import {PlanDocument, planSummary} from './plan-document.jsx';
import {RotateCcw} from './ui-icons.jsx';
import {ReplyFeedback} from './reply-feedback.jsx';
import {useSidebarResize} from './sidebar-resize.jsx';
import {ScrollToLatest} from './assistant-ui/scroll-to-latest.jsx';
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
    dialog.querySelector('[data-initial-focus]')?.focus();
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
  const [creatingCase,setCreatingCase]=useState(false);
  const namingOpened=useRef(false);
  const [page,setPage]=useState(()=>['data','files'].includes(new URLSearchParams(location.search).get('page'))?new URLSearchParams(location.search).get('page'):'chat');
  const resultDirty=useRef(false);
  const [newConversation, setNewConversation] = useState(true);
  const [newProjectId, setNewProjectId] = useState('');
  const [loading, setLoading] = useState(true);
  const [runningCases, setRunningCases] = useState({});
  const running=!!runningCases[state.selected];
  const [navigationFailure,setNavigationFailure]=useState(null);
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
  const currentSet = state.sets.find(set => set.cases.some(item => item.id === state.selected)) || state.sets.find(set=>set.id===newProjectId) || {id:newProjectId, name:"新项目", cases:[]};
  const projectReadOnly=!!currentSet.status && currentSet.status!=='ACTIVE';
  const currentCase = currentSet.cases.find(item => item.id === state.selected) || {name:"新对话"};
  const draftKey = newConversation ? `new:${newProjectId}` : state.selected;
  const draft = state.drafts[draftKey] || '';
  const images=imageDrafts[draftKey]||[];
  const quote=state.quotes?.[draftKey]||'';
  const [retryOriginalInput,setRetryOriginalInput]=useState('');
  const canDiscuss=newConversation||(!state.workflow?false:state.workflow.waiting?.includes('DISCUSS'));
  const recoveredPending=!newConversation&&!loading&&!running&&!!state.pending&&!nodeError;
  const inputDisabled=loading||!!navigationFailure||!canDiscuss||running||planBusy||!!state.pending||((completed||projectReadOnly)&&!newConversation);
  const approval=planApproval(state.plan,state.workflow);
  const addImages=async files=>{if(inputDisabled||readingImages)return;const request=viewRequest.current;setReadingImages(true);try{const added=await readMessageImages(files,images);if(request===viewRequest.current)setImageDrafts(v=>({...v,[draftKey]:[...(v[draftKey]||[]),...added]}));}catch(e){setNotice(e.message);}finally{setReadingImages(false);}};
  const savedMessages = newConversation ? [] : state.messages[state.selected] || [];
  const messages = streamReply?.caseId===state.selected && streamReply.text ? [...savedMessages,{id:'streaming-assistant',role:'assistant',text:streamReply.text,continuation:streamReply.failed?'回复中断，完整结果尚未同步。':undefined}] : savedMessages;
  const showEmptyGuidance = page==='chat' && !dataSetId && messages.length===0 && !loading && !running && !state.pending && !nodeError && !state.plan && (!state.generatedData || state.generatedData.status==='NOT_STARTED') && !completed && !projectReadOnly && (!state.workflow || state.workflow.stage==='DISCUSSION');
  const dataSet = state.sets.find(set => set.id === dataSetId);

  const applySnapshot = snapshot => {
    const id = snapshot.case?.id;
    setCompleted(['PASS','FAIL'].includes(snapshot.case?.status));
    setRetryInput(snapshot.pending?.userInput || '');
    setRetryImages(snapshot.pending?.images||[]);
    setRetryAction(snapshot.pending?.kind || 'DISCUSS');
    setNewConversation(!id);
    setNewProjectId(snapshot.project?.id || snapshot.projects?.find(project=>project.id===new URLSearchParams(location.search).get('chatId'))?.id || snapshot.projects?.[0]?.id || '');
    if(['customers','accounts','funds','holdings'].includes(new URLSearchParams(window.location.search).get('draftTable')))setDataSetId(snapshot.project?.id || null);
    setState(value => ({...value, selected:id || null,
      sets:(snapshot.projects || []).map(project=>({...project,expanded:value.sets.find(previous=>previous.id===project.id)?.expanded ?? project.expanded})),
      workflow:snapshot.workflow || null,
      generatedData:snapshot.generatedData || null,
      drafts: id ? value.drafts : {...value.drafts, 'new:':value.drafts['new:'] || snapshot.requirement},
      pending:snapshot.pending || null,
      plan:snapshot.plan || null,
      followup:snapshot.followup || null,
      messages: id ? {[id]:[...snapshot.turns.map((turn,index)=>({id:`turn-${index}`,role:turn.role,text:turn.content,images:turn.images,kind:turn.kind,draft:turn.draft,createdAt:turn.createdAt,durationMs:turn.durationMs,result:!!snapshot.plan && (snapshot.plan.sourceTurnNumber ? turn.role==='assistant' && (turn.sourceTurnNumber!==undefined?turn.sourceTurnNumber===snapshot.plan.sourceTurnNumber:index===snapshot.plan.sourceTurnNumber*2-1) : false)})),
        ...(snapshot.pending ? [{id:'pending-user',role:'user',text:snapshot.pending.userInput,images:snapshot.pending.images}] : [])]} : {},
    }));
  };
  const loadInitial = async () => {
    const request=++viewRequest.current;
    setLoading(true);setNodeError('');setNavigationFailure(null);
    try {
      const snapshot=await firstNodeRequest('state');
      if(request===viewRequest.current)applySnapshot(snapshot);
    } catch(error) {
      if(request===viewRequest.current){
        setNavigationFailure({initial:true});setNodeError('无法加载对话，请重试加载。');
        setState(value=>({...value,selected:null,workflow:null,plan:null,generatedData:null,pending:null,messages:{}}));
      }
    } finally {if(request===viewRequest.current)setLoading(false);}
  };
  useEffect(() => {
    loadInitial();
    return ()=>{++viewRequest.current;};
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

  const navigateCase = async (chatId,caseId) => {
    streamController.current?.abort();setStreamReply(null);
    const request=++viewRequest.current;
    setPage('chat');setLoading(true);setNodeError('');setNodeErrorCode('');setRetryInput('');setNavigationFailure(null);setDataSetId(null);setModal(null);setPlanBusy(false);setPlanError('');
    try {
      const snapshot=await liveSnapshot(chatId,caseId);
      if(request!==viewRequest.current)return;
      if(snapshot.case?.id!==caseId)throw new Error('所选 Case 不存在或已不可访问。');
      const url=new URL(window.location.href);url.searchParams.delete('draftTable');url.searchParams.delete('page');url.searchParams.set('chatId',chatId);url.searchParams.set('caseId',caseId);window.history.replaceState(null,'',url);
      applySnapshot(snapshot);
    } catch(error) {
      if(request===viewRequest.current){setNavigationFailure({chatId,caseId});setNodeError('无法打开所选 Case，请重试加载。');}
    } finally {if(request===viewRequest.current)setLoading(false);}
  };
  const selectCase = id => {
    const project=state.sets.find(item=>item.cases.some(c=>c.id===id));
    if(project)return navigateCase(project.id,id);
  };
  const openRelatedCatalog=(target,project,ids,batch,type)=>{const url=new URL(location.href);url.searchParams.set("page",target);url.searchParams.set("catalogCases",ids.join(","));if(batch){url.searchParams.set("catalogBatch",batch);if(type)url.searchParams.set("catalogType",type);else url.searchParams.delete("catalogType");}else{url.searchParams.delete("catalogBatch");url.searchParams.delete("catalogType");}if(project)url.searchParams.set("catalogProject",project);else url.searchParams.delete("catalogProject");if(target==="data")url.searchParams.set("dataTable","applications");history.replaceState(null,"",url);setPage(target);setModal(null);};
  const openCatalogCase=(chatId,caseId)=>navigateCase(chatId,caseId);
  const toggleSet = id => setState(value => ({...value, sets: value.sets.map(set => set.id === id ? {...set, expanded: !set.expanded} : set)}));
  const submitFirstNode = async (text, action=discussionAction({text,waiting:state.workflow?.waiting,messages}),sentImages=[],originalInput=text) => {
    if (running || loading || navigationFailure || ((completed || projectReadOnly) && !newConversation)) return;
    if(!newConversation && !state.workflow?.waiting?.includes(action))return;
    if(newConversation){openNewConversation(newProjectId);return;}
    const request=viewRequest.current;
    const sentQuote=quote;
    const operationId=crypto.randomUUID();
    const operationCase=state.selected;
    setState(value=>({...value,drafts:{...value.drafts,[draftKey]:''},quotes:{...value.quotes,[draftKey]:''}}));
    setImageDrafts(value=>({...value,[draftKey]:[]}));
    const controller=new AbortController();streamController.current=controller;setStreamReply(null);
    setRetryOriginalInput(originalInput);setRunningCases(v=>({...v,[operationCase]:operationId})); setNodeError('');setNodeErrorCode(''); setRetryInput(text);setRetryImages(sentImages); setRetryAction(action); setActiveAction(action);
    pendingScroll.current = true;
    try {
      let chatId=currentSet.id,caseId=state.selected;
      const beforeSnapshot=await liveSnapshot(chatId,caseId);
      if(request===viewRequest.current) {
        applySnapshot(beforeSnapshot);
        setState(value=>({...value,drafts:{...value.drafts,[caseId]:''},quotes:{...value.quotes,[caseId]:''},messages:{...value.messages,[caseId]:[...(value.messages[caseId]||[]),{id:'sending-user',role:'user',text,images:sentImages}]}}));
      }
      const path=casePath(chatId,caseId);
      const before=await requestCase(path+'/workflow');
      if(!before.waiting?.includes(action)){const error=new Error('当前流程已更新，请查看当前步骤后继续。');error.code='WORKFLOW_ACTION_UNAVAILABLE';throw error;}
      await requestCaseStream(path+(action==='PROPOSE_PLAN'?'/plan':'/discussion'),{userInput:text,...(sentImages.length?{images:sentImages}:{})},{signal:controller.signal,onReset:()=>{if(request===viewRequest.current)setStreamReply(null);},onDelta:delta=>{
        if(request===viewRequest.current)setStreamReply(value=>({caseId,text:(value?.caseId===caseId?value.text:'')+delta}));
      }});
      if(request===viewRequest.current)setStreamReply(null);
      await requestCase(path+'/workflow/resume',{eventId:crypto.randomUUID(),expectedStage:before.stage});
      const snapshot=await liveSnapshot(chatId,caseId);
      if(request===viewRequest.current)applySnapshot(snapshot);
      if(request===viewRequest.current)setStreamReply(null);
      if(request===viewRequest.current){
        setImageDrafts(v=>({...v,[draftKey]:[],[caseId]:[]}));
        setState(value=>({...value,drafts:{...value.drafts,[draftKey]:'',[caseId]:''},quotes:{...value.quotes,[draftKey]:'',[caseId]:''}}));
      }
    } catch(error) {
      if(request===viewRequest.current) {
        setStreamReply(value=>value?{...value,failed:true}:value);
        setNodeError(error.message);setNodeErrorCode(error.code||'');
        try {const snapshot=await firstNodeRequest('state');if(request===viewRequest.current)applySnapshot(snapshot);} catch { /* Keep the original input available for retry. */ }
        if(request===viewRequest.current) {
          setState(value=>({...value,drafts:{...value.drafts,[draftKey]:originalInput},quotes:{...value.quotes,[draftKey]:sentQuote}}));
          setImageDrafts(value=>({...value,[draftKey]:sentImages}));
          if(['BUSINESS_UNRELATED','BUSINESS_PURPOSE_REQUIRED'].includes(error.code)) {
            const id=new URL(window.location.href).searchParams.get('caseId')||draftKey;
            setRetryInput('');setRetryImages([]);
            setState(v=>({...v,drafts:{...v.drafts,[id]:originalInput}}));
            setImageDrafts(v=>({...v,[id]:sentImages}));
          }else{setRetryInput(text);setRetryImages(sentImages);setRetryAction(action);}
        }
      }
    } finally {
      if(request===viewRequest.current)pendingScroll.current=false;
      setRunningCases(v=>{if(v[operationCase]!==operationId)return v;const next={...v};delete next[operationCase];return next;});
    }
  };
  const sendComposer = text => {
    try {const body=quotedInput(text,quote);return submitFirstNode(body,quote||images.length?'DISCUSS':undefined,images,text);}
    catch(error){setNotice(error.message);}
  };
  const savePlanContent = async (index,item) => {
    const request=viewRequest.current;
    const {contract,...proposal}=state.plan.proposal;
    const next={...proposal,scenarios:proposal.scenarios.map((value,i)=>i===index?item:value)};
    setPlanBusy(true);setPlanError('');
    try {
      await requestCase(casePath(currentSet.id,state.selected)+'/plan/content',{versionNumber:state.plan.versionNumber,proposal:next});
      const snapshot=await liveSnapshot(currentSet.id,state.selected);
      if(request===viewRequest.current){applySnapshot(snapshot);setModal({type:'result'});}
    } finally {if(request===viewRequest.current)setPlanBusy(false);}
  };
  const savePreparedData=async changes=>{
    const request=viewRequest.current;
    setPlanBusy(true);setPlanError('');
    try {
      await requestCase(casePath(currentSet.id,state.selected)+'/plan/data',{versionNumber:state.plan.versionNumber,dataSpecification:state.plan.proposal.contract.dataSpecification,...changes});
      const snapshot=await liveSnapshot(currentSet.id,state.selected);
      if(request===viewRequest.current)applySnapshot(snapshot);
    } finally {if(request===viewRequest.current)setPlanBusy(false);}
  };
  const confirmPlan = async section => {
    const request=viewRequest.current;
    setPlanBusy(true);setPlanError('');
    try {
      const path=casePath(currentSet.id,state.selected);
      await requestCase(path+(section==='RETRY_DATA'?'/data/execute':'/plan/confirm'),{versionNumber:state.plan.versionNumber,...(section==='RETRY_DATA'?{}:{section})});
      const snapshot=await liveSnapshot(currentSet.id,state.selected);
      if(request!==viewRequest.current)return;
      applySnapshot(snapshot);
      if(section==='DATA' && snapshot.workflow?.stage==='CONFIRM_EXPECTATIONS')setModal({type:'result'});
      else if(section==='DATA')setPlanError('方案已更新，请重新审阅准备数据。');
      else setModal(null);
    } catch(error) {
      if(request===viewRequest.current){
        setPlanError(error.message);
        try {const snapshot=await liveSnapshot(currentSet.id,state.selected);if(request===viewRequest.current)applySnapshot(snapshot);}catch{}
      }
    } finally {if(request===viewRequest.current)setPlanBusy(false);}
  };
  const openGeneratedData = () => setModal({type:'generated-data'});
  const confirmDraft = async () => {
    const request=viewRequest.current;
    setPlanBusy(true);setPlanError('');
    try {
      await requestCase(casePath(currentSet.id,state.selected)+'/data/confirm',{revision:state.generatedData.revision});
      const snapshot=await liveSnapshot(currentSet.id,state.selected);
      if(request===viewRequest.current)applySnapshot(snapshot);
    } catch(error) {if(request===viewRequest.current)setPlanError(error.message);} finally {if(request===viewRequest.current)setPlanBusy(false);}
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
    if(running||loading||creatingCase)return;
    const project=state.sets.find(p=>p.id===projectId&&p.status==='ACTIVE')||state.sets.find(p=>p.status==='ACTIVE');
    setModal(project?{type:'new-case',projectId:project.id}:{type:'new-project'});
  };
  useEffect(()=>{
    if(page==='chat'&&!loading&&!navigationFailure&&!nodeError&&newConversation&&!namingOpened.current){
      namingOpened.current=true;
      const project=state.sets.find(p=>p.id===newProjectId&&p.status==='ACTIVE')||state.sets.find(p=>p.status==='ACTIVE');
      setModal(project?{type:'new-case',projectId:project.id}:{type:'new-project'});
    }
  },[loading,newConversation,newProjectId,page,navigationFailure,nodeError]);
  const sidebar = <>
    <div className="cw-brand"><img className="cw-brand-logo" src="/brand/ta-agent-bot-white.png" alt="" width="44" height="44"/><span>TA Test Agent</span></div>
    <nav className="cw-primary" aria-label="业务页面">
      <button type="button" disabled={running||loading||creatingCase} onClick={()=>setModal({type:'new-project'})}><SquarePen size={18}/><span>项目</span></button>
      <button onClick={() => {setPage('data');setModal(null);setNotice('');const url=new URL(location.href);url.searchParams.set('page','data');history.replaceState(null,'',url);}}><Table2 size={18}/><span>数据</span></button>
      <button onClick={() => {setPage('files');setModal(null);setNotice('');const url=new URL(location.href);url.searchParams.set('page','files');history.replaceState(null,'',url);}}><FileText size={18}/><span>文件</span></button>
    </nav>
    <nav className="cw-sets" aria-label="项目与 Case">
      {state.sets.map(set => <div className={`cw-set ${set.status!=='ACTIVE'?'is-sealed':''}`} key={set.id}>
        <div className="cw-set-heading">
          <NameButton className="cw-set-toggle" aria-expanded={set.expanded} aria-controls={`cases-${set.id}`} title="双击或按 F2 改名" onClick={() => toggleSet(set.id)} onRename={()=>setModal({type:'rename',projectId:set.id,name:set.name})}>
            <Folder size={18}/><span>{set.name}</span>
          </NameButton>
          <button className="cw-icon cw-add" aria-label={`在${set.name}中新建 Case`} title="新建 Case" disabled={set.status!=='ACTIVE'} onClick={() => openNewConversation(set.id)}><SquarePen size={18}/></button>
        </div>
        <div id={`cases-${set.id}`} className={`cw-set-children ${set.expanded ? 'is-expanded' : ''}`} inert={!set.expanded}>
          <div className="cw-set-children-inner">
            <ThreadList threads={set.cases.map(item=>({id:item.id,title:item.name,time:''}))}
              activeIndex={!dataSetId&&!newConversation?set.cases.findIndex(item=>item.id===state.selected):-1}
              onTitleRename={index=>setModal({type:'rename',projectId:set.id,caseId:set.cases[index].id,name:set.cases[index].name})}
              onActiveIndexChange={index=>selectCase(set.cases[index].id)}/>


          </div>
        </div>
      </div>)}
    </nav>
    <div className="cw-user">{accountControl}<ThemePicker /></div>
  </>;

  const renderedView=viewRequest.current;
  const refreshCurrentCase=async()=>{
    const snapshot=await liveSnapshot(currentSet.id,state.selected);
    if(renderedView===viewRequest.current)applySnapshot(snapshot);
  };
  return <CanvasSplit className={`cw-shell ${page==='chat'?'cw-liquid-home':''} ${page==='chat'&&['result','historical-plan','exchange','generated-data','review-result'].includes(modal?.type)?'has-detail':''} ${page!=='chat'?'cw-catalog-view':''}`} style={sidebarResize.style}>
    <a className="cw-skip" href="#cw-main">跳到对话</a>
    <aside id="cw-sidebar" className="cw-sidebar">{sidebar}{sidebarResize.separator}</aside>
    <CaseAssistant key={draftKey} messages={messages} draft={draft} loading={loading} running={running || !!state.pending}
      disabled={inputDisabled || readingImages} onSend={sendComposer}>
    <Thread id="cw-main" className="cw-main" tabIndex={-1}>
      <header className={`cw-header ${page!=='chat'?'is-catalog':''}`}>
        <button className="cw-icon cw-menu" aria-label="打开侧边栏" onClick={() => setModal({type: 'navigation'})}><Menu size={21}/></button>
        {page==='chat' && state.workflow && !newConversation && <button className="cw-live-flow cw-icon" title="查看当前流程" aria-label="查看当前流程" onClick={openWorkflow}><Workflow size={18} strokeWidth={1.6}/></button>}
        {page==='chat' && !newConversation && !messages.some(message=>message.result) && showExchangeEntry(state.plan,state.generatedData) && <button className="cw-icon" title="查看文件交换" aria-label="查看文件交换" onClick={()=>setModal({type:'exchange'})}><FileArchive size={18}/></button>}
        <h1 hidden={newConversation || page!=='chat'} title={`${dataSet?.name || currentSet.name} / ${dataSet ? '草稿数据' : currentCase.name}`}><span>{dataSet?.name || currentSet.name}</span><span className="cw-slash"> / </span>{dataSet ? '草稿数据' : currentCase.name}</h1>
      </header>
      <ThreadViewport ref={scroller} tabIndex={-1} hidden={!!dataSetId || page!=='chat'} className="cw-conversation" aria-label={newConversation ? '新对话' : `${currentCase.name}的对话`}
        onScroll={event => {if (!dataSetId && !newConversation) positions.current[state.selected] = event.currentTarget.scrollTop;}}>
        <div className={`cw-messages ${showEmptyGuidance ? 'cw-empty-conversation' : ''}`}>
          {showEmptyGuidance && <div className="cw-empty-guidance"><img className="cw-empty-robot" src="/brand/ta-agent-bot-white.png" alt="" aria-hidden="true"/><h2>想测试什么业务或规则？</h2><p>描述测试目标、已知条件和预期结果。<br/>还没想完整，也可以先说个大概。</p></div>}
          <ThreadMessages>{({message: runtimeMessage}) => {
            const message = runtimeMessage.metadata.custom.caseMessage || {
              id: runtimeMessage.id, role: runtimeMessage.role,
              text: runtimeMessage.content.filter(part => part.type === 'text').map(part => part.text).join('\n'),
            };
            if (!message.text && !message.result && !message.continuation && !message.images?.length) return null;
            return <ChatMessage message={message} onQuote={inputDisabled?undefined:text=>{setState(v=>({...v,quotes:{...v.quotes,[draftKey]:text}}));composer.current?.focus();}} text={message.result && state.plan ? planSummary(state.plan.proposal,state.plan.status) : message.kind==='PROPOSE_PLAN'?'当时的方案内容保留在详情中。':message.text}>
            <MessageImages images={message.images} onOpen={image=>setModal({type:'image',image})}/>
            {message.kind==='PROPOSE_PLAN' && !message.result && <ArtifactCard title="测试方案" variant="history" meta="历史内容" action="查看历史" onClick={()=>setModal({type:'historical-plan',message})}/>}
            {message.result && <ArtifactCard title="测试方案" meta={planArtifactMeta(state.plan,state.workflow)} variant={approval?.section?'primary':'secondary'} action="查看方案" onClick={()=>{setPlanError('');setModal({type:'result'});}}/>}
            {message.result && showExchangeEntry(state.plan,state.generatedData) && <ArtifactCard title="文件交换" kind="files" meta="申请文件与 TA 回传" variant={state.workflow?.stage==='FILE_EXCHANGE'?'primary':'secondary'} action="打开文件" onClick={()=>setModal({type:'exchange'})}/>}

          </ChatMessage>;}}</ThreadMessages>
          {state.plan&&!messages.some(m=>m.result) && <ArtifactCard title="测试方案" meta={planArtifactMeta(state.plan,state.workflow)} variant={approval?.section?'primary':'secondary'} action="查看方案" onClick={()=>{setPlanError('');setModal({type:'result'});}}/>}
          {state.workflow?.stage==='CONFIRM_EXPECTATIONS' && state.plan && <div className="cw-expect-handoff"><p>准备数据已确认。请在测试方案中核对并确认预期结果。</p></div>}
          {!newConversation && state.generatedData?.status==='VALIDATED' && <ArtifactCard title="准备数据" kind="data" meta={state.generatedData.reviewStatus==='CONFIRMED'?'已准备':'待审阅'} action="查看数据" onClick={openGeneratedData}/>}
          {!newConversation && ['EVALUATE_RESULT','CONFIRM_RESULT','CASE_FINAL'].includes(state.workflow?.stage) && <ArtifactCard title="结果核对" kind="result" variant={state.workflow.stage==='CASE_FINAL'?'secondary':'primary'} meta={state.workflow.stage==='CONFIRM_RESULT'?'待确认结果':state.workflow.stage==='CASE_FINAL'?'查看已保存结果':'待核对实际结果'} action="查看结果" onClick={()=>setModal({type:'review-result'})}/>}
          {!loading && !newConversation && currentSet.id && showProjectLifecycle(currentSet.status,currentCase.status) && <ProjectLifecycleCard chatId={currentSet.id} caseId={state.selected} onChanged={refreshCurrentCase} onNavigate={async target=>{if(renderedView!==viewRequest.current)return;if(target.casePublicId)await openCatalogCase(target.chatPublicId,target.casePublicId);else {const snapshot=await liveSnapshot(target.chatPublicId,null);if(renderedView!==viewRequest.current)return;applySnapshot(snapshot);openNewConversation(target.chatPublicId);}}}/>}
          {!newConversation && (loading||running) && !nodeError && <p className="cw-reply-status" role="status">{loading?'连接讨论服务…':(state.pending?.kind||activeAction)==='PROPOSE_PLAN'?'正在整理方案…':'正在回复…'}</p>}
          {recoveredPending && <ReplyFeedback role="status" title="上次回复未完成" message="可以重新尝试发送原输入。"><button type="button" disabled={completed||projectReadOnly} onClick={()=>submitFirstNode(state.pending.userInput,state.pending.kind||retryAction,state.pending.images||[],state.pending.userInput)}><RotateCcw size={15}/><span>重新尝试</span></button></ReplyFeedback>}
          {newConversation && (loading||running) && <p role="status">{loading?'连接讨论服务…':'正在回复…'}</p>}
          
          {nodeError && <ReplyFeedback title={navigationFailure?'暂时无法加载':'本次回复未完成'} message={nodeError}>{navigationFailure&&<button type="button" disabled={loading} onClick={()=>navigationFailure.initial?loadInitial():navigateCase(navigationFailure.chatId,navigationFailure.caseId)}>重新加载</button>}{retryInput && !completed && !['MODEL_BUDGET_EXHAUSTED','WORKFLOW_ACTION_UNAVAILABLE'].includes(nodeErrorCode) && <button type="button" disabled={running} aria-busy={running} onClick={()=>submitFirstNode(retryInput,retryAction,retryImages,retryOriginalInput||retryInput)}><RotateCcw size={15}/><span>{running?'重试中…':'重新尝试'}</span></button>}</ReplyFeedback>}
        </div>
      </ThreadViewport>
      {page==='chat' && dataSet && <section className="cw-draft-page" aria-label={`${dataSet.name}的准备数据`}>
        <h2>准备数据</h2>{dataSet.id===currentSet.id && state.generatedData?.status==='VALIDATED' ? <>
          <GeneratedData data={state.generatedData}/>
          {state.workflow?.stage==='CONFIRM_DRAFT' && state.plan?.dataApprovalMode!=='PLAN_CONFIRMED' && <footer className="cw-plan-confirm-footer">{planError&&<p role="alert">{planError}</p>}<button type="button" className="cw-primary-button" disabled={planBusy||running} onClick={confirmDraft}>{planBusy?'确认中…':'确认草稿'}</button></footer>}
        </> : <p>尚未生成。</p>}
      </section>}
      <div hidden={!!dataSetId || page!=='chat'} className="cw-composer-area">
        <ScrollToLatest viewportRef={scroller} active={!dataSetId&&page==='chat'&&!newConversation&&!loading} caseKey={state.selected}/>
        {!newConversation&&!loading&&!navigationFailure&&!canDiscuss&&<p className="cw-composer-stage" role="status">{state.workflow?.stage==='CONFIRM_DRAFT'?(state.plan?.dataApprovalMode==='PLAN_CONFIRMED'?'数据尚未准备完成，请打开测试方案重试。':'请查看草稿数据并确认后继续。'):state.workflow?.stage==='FILE_EXCHANGE'?'请打开文件交换，完成当前文件操作。':['EVALUATE_RESULT','CONFIRM_RESULT','CASE_FINAL'].includes(state.workflow?.stage)?'请打开结果核对，查看当前结果。':'请查看当前流程，完成当前步骤后继续。'}</p>}
        <div className="cw-composer-frame" onDragOver={event=>{if(Array.from(event.dataTransfer.types).includes('Files'))event.preventDefault();}} onDrop={event=>{if(event.dataTransfer.files.length){event.preventDefault();addImages(event.dataTransfer.files);}}}>
        {quote && <div className="aui-quote-draft"><QuoteReply quoted={quote} toolbarVisible={false}/><button className="cw-icon" type="button" aria-label="移除引用" disabled={inputDisabled} onClick={()=>setState(v=>({...v,quotes:{...v.quotes,[draftKey]:''}}))}><X size={16}/></button></div>}
        <MessageImages images={images} onRemove={index=>setImageDrafts(v=>({...v,[draftKey]:(v[draftKey]||[]).filter((_,i)=>i!==index)}))} onOpen={image=>setModal({type:'image',image})} disabled={inputDisabled||readingImages}/>
        {newConversation && <div className="cw-project-bar"><button type="button" className="cw-project-picker" onClick={()=>openNewConversation(newProjectId)}>{state.sets.some(project=>project.status==='ACTIVE')?'创建Case':'创建项目'}</button></div>}
        <input ref={imageInput} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={event=>{addImages(event.target.files);event.target.value='';}}/>
        <Composer ref={composer} value={draft} voiceEnabled={page==='chat'&&!dataSetId} hasImages={images.length>0} disabled={inputDisabled||readingImages} replying={running||!!state.pending}
          onImageSend={()=>sendComposer(draft.trim()||(quote?'':'请解析图片内容。'))}
          onPaste={event=>{const files=Array.from(event.clipboardData.items).filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile()).filter(Boolean);if(files.length){event.preventDefault();addImages(files);}}}
          onChange={event=>setState(value=>({...value,drafts:{...value.drafts,[draftKey]:event.target.value}}))}/>
        </div>
      </div>
      {page!=='chat' && <div className="gc-topbar"><button aria-label="返回对话" title="返回对话" onClick={()=>{setPage('chat');const url=new URL(location.href);url.searchParams.delete('page');history.replaceState(null,'',url);}}><ArrowLeft size={18}/></button><nav aria-label="业务页面">{[['data','数据'],['files','文件']].map(([key,label])=><button key={key} aria-current={page===key?'page':undefined} onClick={()=>{setPage(key);const url=new URL(location.href);url.searchParams.set('page',key);history.replaceState(null,'',url);}}>{label}</button>)}</nav></div>}
      {page==='data' && <GlobalDataCatalog onOpenCase={openCatalogCase} onOpenFiles={(project,ids,batch,type)=>openRelatedCatalog('files',project,ids,batch,type)}/>}
      {page==='files' && <GlobalFileCatalog onOpenCase={openCatalogCase} onOpenData={(project,ids,batch,type)=>openRelatedCatalog('data',project,ids,batch,type)}/>}
    </Thread>
    </CaseAssistant>
    <div className={`cw-notice ${notice ? 'is-visible' : ''}`} role="status">{notice}</div>
    {modal?.type==='image'&&<Modal title={modal.image.name} className="cw-image-modal" onClose={()=>setModal(null)}><img className="cw-full-image" src={modal.image.dataUrl} alt={modal.image.name}/></Modal>}
    {modal?.type === 'review-result' && <DetailPanel title="结果核对" kind="result" closeLabel="关闭结果核对" onClose={()=>{if(!resultDirty.current||window.confirm('有未保存的结果，确定关闭？'))setModal(null);}}><ResultReview chatId={currentSet.id} caseId={state.selected} readOnly={completed||currentSet.status!=='ACTIVE'} onDirtyChange={dirty=>{resultDirty.current=dirty;}} onChanged={async isCurrent=>{const snapshot=await liveSnapshot(currentSet.id,state.selected);if(isCurrent()&&renderedView===viewRequest.current)applySnapshot(snapshot);}}/></DetailPanel>}
    {modal?.type === 'exchange' && <DetailPanel title="文件交换" kind="files" closeLabel="关闭文件交换" onClose={()=>setModal(null)}><FileExchangePanel chatId={currentSet.id} caseId={state.selected} plan={state.plan} draft={state.generatedData} workflow={state.workflow} readOnly={completed||currentSet.status!=='ACTIVE'} onChanged={refreshCurrentCase}/></DetailPanel>}
    {modal?.type === 'workflow' && <Modal title="Case 流程" className="cw-flow-modal" onClose={()=>setModal(null)}><WorkflowDiagram workflow={modal.snapshot?.workflow || state.workflow} caseStatus={modal.snapshot?.case?.status || currentCase.status} plan={modal.snapshot?.plan || state.plan} data={modal.snapshot?.generatedData || state.generatedData} loading={modal.loading} error={modal.error} onRetry={openWorkflow}/></Modal>}
    {modal?.type==='new-project'&&<Modal title="创建项目" className="cw-row-editor" onClose={()=>{if(!creatingCase)setModal(null);}}><NewProjectForm onBusy={setCreatingCase} onCancel={()=>setModal(null)} onCreated={async chatId=>{
      const snapshot=await liveSnapshot(chatId,null);
      ++viewRequest.current;
      const url=new URL(location.href);url.searchParams.delete('caseId');url.searchParams.delete('page');url.searchParams.delete('draftTable');url.searchParams.set('chatId',chatId);history.replaceState(null,'',url);
      namingOpened.current=true;setPage('chat');setDataSetId(null);applySnapshot(snapshot);setNewProjectId(chatId);setModal(null);
    }}/></Modal>}
    {modal?.type==='new-case'&&<Modal title="创建Case" className="cw-row-editor" onClose={()=>{if(!creatingCase)setModal(null);}}><NewCaseForm project={state.sets.find(p=>p.id===modal.projectId)} onBusy={setCreatingCase} onCancel={()=>setModal(null)} onCreated={async(chatId,caseId)=>{
      const text=newConversation?(state.drafts[draftKey]||''):'',images=newConversation?(imageDrafts[draftKey]||[]):[];
      await openCatalogCase(chatId,caseId);
      setState(v=>({...v,drafts:{...v.drafts,[caseId]:text}}));
      setImageDrafts(v=>({...v,[caseId]:images}));
    }}/></Modal>}
    {modal?.type === 'rename' && <Modal title={modal.caseId?'重命名Case':'重命名项目'} className="cw-row-editor" onClose={()=>{if(!creatingCase)setModal(null);}}><RenameForm target={modal} onBusy={setCreatingCase} onCancel={()=>setModal(null)} onSaved={name=>{
      setState(value=>({...value,sets:value.sets.map(set=>set.id!==modal.projectId?set:modal.caseId?{...set,cases:set.cases.map(item=>item.id===modal.caseId?{...item,name}:item)}:{...set,name})}));
      setModal(null);
    }}/></Modal>}
    {modal?.type === 'navigation' && <Modal title="项目" onClose={() => setModal(null)}><div className="cw-mobile-sidebar">{sidebar}</div></Modal>}
    {modal?.type === 'generated-data' && <DetailPanel title="准备数据" kind="data" closeLabel="关闭准备数据" onClose={()=>setModal(null)}><GeneratedData data={state.generatedData} inPanel/>{state.workflow?.stage==='CONFIRM_DRAFT'&&state.plan?.dataApprovalMode!=='PLAN_CONFIRMED'&&<footer className="cw-plan-confirm-footer">{planError&&<p role="alert">{planError}</p>}<button type="button" className="cw-primary-button" disabled={planBusy||running} onClick={confirmDraft}>确认草稿</button></footer>}</DetailPanel>}
    {modal?.type === 'historical-plan'  && <DetailPanel title="测试方案" onClose={()=>setModal(null)}><HistoricalPlan message={modal.message} messages={messages} currentPlan={state.plan} onOpenCurrent={()=>{setPlanError('');setModal({type:'result'});}} onResume={()=>{setModal(null);composer.current?.focus();}}/></DetailPanel>}
    {modal?.type === 'result' && <DetailPanel title="测试方案" onClose={() => setModal(null)}>
      {state.plan && <PlanDocument key={state.selected+state.plan.versionNumber} proposal={state.plan.proposal} taskProgress={state.workflow?.tasks} locked={state.plan.status==='LOCKED'} onSaveOperations={applications=>savePreparedData({applications})} onSaveContent={savePlanContent} editable={['PENDING_CONFIRMATION','DRAFT'].includes(state.plan.status)&&!loading&&!navigationFailure&&!running&&!planBusy&&!state.pending&&!completed&&!projectReadOnly} onSave={dataSpecification=>savePreparedData({dataSpecification})} dataApproval={approval&&<footer className="cw-plan-confirm-footer"><p role="status">{approval.message}</p>{planError&&<p role="alert">{planError}</p>}{approval.section&&<button type="button" className="cw-primary-button" disabled={loading||!!navigationFailure||planBusy||running||!!state.pending||completed||projectReadOnly} onClick={()=>confirmPlan(approval.section)}>{planBusy?'处理中…':approval.label}</button>}</footer>}/>}
    </DetailPanel>}
  </CanvasSplit>;
}

function GeneratedData({data,inPanel=false}) {
  const [panelTable,setPanelTable]=useState('customers');
  const tabsId=React.useId();
  const tables=[
    ['customers','客户',['姓名','客户类型','模拟余额'],data.customers.map(row=>[row.name,row.investor_type==='1'?'个人':'机构',row.simulated_balance])],
    ['accounts','账户',['客户','交易账户','分支'],data.accounts.map(row=>[data.customers.find(c=>String(c.id)===String(row.customer_id))?.name,row.account_no,row.branch_code])],
    ['funds','基金',['基金代码','基金名称','份额类别','净值'],data.funds.map(row=>[row.fund_code,row.fund_name,row.share_class,row.nav])],
    ['holdings','模拟持有',['交易账户','基金代码','份额类别','模拟份额'],data.holdings.map(row=>[data.accounts.find(a=>String(a.id)===String(row.account_id))?.account_no,row.fund_code,row.share_class,row.total_volume])],
  ];
  const selected=inPanel?panelTable:new URLSearchParams(window.location.search).get('draftTable') || 'customers';
  const active=tables.find(table=>table[0]===selected)||tables[0],key=active[0];
  const href=id=>{const url=new URL(window.location.href);url.searchParams.set('draftTable',id);url.hash='';return url.pathname+url.search;};
  const contents=([_,name,columns,rows])=><><p className="cw-detail-note">{data.businessApplied?'请在数据页面查看对应的正式账户与持仓；这里保留本次准备记录。':'本次准备的数据，用于构造测试申请；正式账户和持仓以已确认回传为准。'}</p><section aria-label={name}><h3>{name}</h3>{!rows.length?<p className="cw-detail-empty">无需准备{name}记录。</p>:rows.length===1?<RecordDetails items={columns.map((label,i)=>[label,rows[0][i]])}/>:<div className="cw-plan-comparison" tabIndex={0} role="region" aria-label={`${name}准备数据列表`}><table><caption className="cw-sr-only">{name}</caption><thead><tr>{columns.map(column=><th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row,index)=><tr key={index}>{row.map((cell,j)=><td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>}</section></>;
  return <div className="cw-generated-data">
    <div className="cw-generated-data-nav">{inPanel?<DetailTabs id={tabsId} label="准备数据分区" items={tables.map(([id,label])=>[id,label])} value={key} onChange={setPanelTable}/>:<nav className="cw-data-pages" aria-label="准备数据页面">{tables.map(([id,label])=><a key={id} href={href(id)} aria-current={key===id?'page':undefined}>{label}</a>)}</nav>}</div>
    {inPanel?tables.map(table=><DetailTabPanel key={table[0]} id={tabsId} value={key} tab={table[0]} className="cw-generated-data-body">{contents(table)}</DetailTabPanel>):<div className="cw-generated-data-body">{contents(active)}</div>}
  </div>;
}
