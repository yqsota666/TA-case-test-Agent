import React, {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {Activity,ArrowDownToLine,ArrowUp,Check,ChevronDown,ChevronRight,Database,FileArchive,FolderClosed,FolderOpen,LogOut,MessageSquare,Moon,Plus,RefreshCw,RotateCcw,Send,Sun,Table2,UploadCloud,X} from 'lucide-react';
import {BatchDataPreview} from './batch-data-preview.jsx';
import {WorkflowDatabaseBrowser} from './workflow-database-browser.jsx';
import {WorkflowDataEditor} from './workflow-data-editor.jsx';
import {WorkflowDataReview} from './workflow-data-review.jsx';
import {WorkflowApplicationFiles} from './workflow-application-files.jsx';
import './workflow.css';
import './workflow-openhands.css';

const themeKey='gf-workflow-theme-v2';
const newCaseData={chatId:import.meta.env.VITE_CASE_DATA_CHAT_ID,
  caseId:import.meta.env.VITE_CASE_DATA_CASE_ID,
  version:Number(import.meta.env.VITE_CASE_DATA_PLAN_VERSION||0)};
const requestNewPath=async(path,{method='GET',body}={})=>{
  const response=await fetch('/new-api'+path,{method,cache:'no-store',
    headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
  const value=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(value.message||value.error||`请求失败 (${response.status})`);
  return value;
};
const caseDataPath=(chatId,caseId)=>`/chats/${chatId}/cases/${caseId}`;
const markdownPlugins=[remarkGfm];
const initialTheme=()=>{try{return localStorage.getItem(themeKey)==='dark'?'dark':'light';}catch{return 'light';}};

const request=async(path,{method='GET',body}={})=>{
  const response=await fetch(`/api${path}`,{method,credentials:'same-origin',cache:'no-store',
    headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
  const value=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(value.error||`请求失败 (${response.status})`);error.code=value.code;error.status=response.status;throw error;}
  return value;
};
const date=value=>value?new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'尚无时间';
const phaseName={NO_CASES:'尚无 Case',SOP_REQUIRED:'需要确认 SOP',READY_TO_GENERATE:'可生成申请文件',WAITING_FOR_RETURN:'等待 TA 回传',BLOCKED_DEPENDENCY:'等待前置动作',REVIEW_REQUIRED:'需要核对',AWAITING_HUMAN_VERDICT:'等待人工复核',ALL_PASS:'全部通过',COMPLETE_WITH_FAILURE:'含失败结论'};
const actionName={PASS:'通过',FAIL:'失败',REVIEW:'待核对',WAITING:'等待执行',WAITING_RETURN:'等待回传',WAITING_05:'等待 05',PENDING:'待执行',SUCCESS:'成功'};
const sopStatusName={PROPOSED:'待确认',APPROVED:'已确认',SUPERSEDED:'已更新'};
const textOf=message=>{
  const item=message?.message_json??message;
  if(typeof item?.content==='string')return item.content;
  if(Array.isArray(item?.content))return item.content.map(part=>{
    if(typeof part==='string')return part;
    if(part.type==='text')return part.text;
    return '';
  }).filter(Boolean).join('\n');
  return '';
};
const visibleMessage=item=>{
  const role=item.message_json?.role;
  if(role!=='user'&&role!=='assistant')return null;
  const parts=item.message_json?.content;
  if(role==='assistant'&&Array.isArray(parts)&&parts.some(part=>
    part&&['tool-call','tool-result'].includes(part.type)))return null;
  const content=textOf(item).trim();
  return content?{item,role,content}:null;
};
const stateTone=value=>['FAIL','ERROR','COMPLETE_WITH_FAILURE'].includes(value)?'bad':
  ['PASS','ALL_PASS','DONE','APPROVED'].includes(value)?'good':'muted';

function Dialog({title,children,onClose}){
  useEffect(()=>{const close=event=>{if(event.key==='Escape')onClose();};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[onClose]);
  return <div className="wf-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="wf-dialog" role="dialog" aria-modal="true" aria-label={title}>
      <header><h2>{title}</h2><button type="button" className="wf-icon" aria-label="关闭" onClick={onClose}><X size={18}/></button></header>{children}
    </section>
  </div>;
}

function ConversationMessage({item,role,content}){
  const [expanded,setExpanded]=useState(false);
  const long=content.length>220||content.split('\n').length>8;
  const preview=content.split(/\n\|/)[0].replace(/\*\*|__|`/g,'')
    .replace(/^\s{0,3}#{1,6}\s*/gm,'').replace(/^\s*---\s*$/gm,'')
    .replace(/\bSOP 提案/g,'测试方案').replace(/\bSOP\b/g,'测试方案')
    .replace(/\bPROPOSED\b/g,'待确认')
    .replace(/\s+/g,' ').trim().slice(0,200);
  return <article className={`wf-message ${role}`}><div className="wf-message-meta"><strong>{role==='user'?'你':'助手'}</strong><time>{date(item.created_at)}</time></div>
    <div className="wf-message-body">{long&&!expanded?<span>{preview}…</span>:<ReactMarkdown remarkPlugins={markdownPlugins} skipHtml>{content}</ReactMarkdown>}</div>
    {long&&<button type="button" className="wf-message-toggle" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?'收起':'展开全文'}</button>}
  </article>;
}

function Login({onDone,theme,onToggleTheme}){
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const enter=async(demo=false)=>{setBusy(true);setError('');try{await request(demo?'/auth/demo':'/auth/login',
    {method:'POST',body:demo?{}:{email,password}});onDone();}catch(e){setError(e.message);}finally{setBusy(false);}};
  return <main className="wf-login" data-theme={theme}><form onSubmit={event=>{event.preventDefault();enter();}}><div className="wf-login-head"><div className="wf-mark">GF</div><button type="button" className="wf-icon" aria-label={theme==='dark'?'切换到白色主题':'切换到深色主题'} title={theme==='dark'?'切换到白色主题':'切换到深色主题'} onClick={onToggleTheme}>{theme==='dark'?<Sun size={17}/>:<Moon size={17}/>}</button></div>
    <h1>基金测试工作空间</h1><p>登录后查看 Chat、Case、SOP 和 TA 文件状态。</p>
    <label>邮箱<input type="email" required value={email} onChange={event=>setEmail(event.target.value)}/></label>
    <label>密码<input type="password" required value={password} onChange={event=>setPassword(event.target.value)}/></label>
    {error&&<p className="wf-error" role="alert">{error}</p>}
    <button className="wf-primary" disabled={busy}>登录</button><button type="button" className="wf-plain" disabled={busy} onClick={()=>enter(true)}>使用演示账号</button>
  </form></main>;
}

export function WorkflowApp(){
  const [theme,setTheme]=useState(initialTheme);
  const toggleTheme=()=>setTheme(current=>{const next=current==='dark'?'light':'dark';try{localStorage.setItem(themeKey,next);}catch{}return next;});
  const [user,setUser]=useState(undefined),[channels,setChannels]=useState([]),[chats,setChats]=useState([]);
  const [selectedChat,setSelectedChat]=useState(null),[selectedCase,setSelectedCase]=useState(null),[view,setView]=useState('discussion');
  const [collapsed,setCollapsed]=useState({}),[cases,setCases]=useState([]),[progress,setProgress]=useState(null);
  const [caseState,setCaseState]=useState(null),[agent,setAgent]=useState(null),[batches,setBatches]=useState([]);
  const [newData,setNewData]=useState(null);
  const [reviewTurns,setReviewTurns]=useState([]),[reviewBusy,setReviewBusy]=useState(false);
  const [showNewDataEditor,setShowNewDataEditor]=useState(false);
  const [generatedCatalog,setGeneratedCatalog]=useState([]);
  const [generatedSelection,setGeneratedSelection]=useState({chatId:newCaseData.chatId,caseId:newCaseData.caseId});
  const [showDataPlatform,setShowDataPlatform]=useState(false),[platformRows,setPlatformRows]=useState([]);
  const [platformChat,setPlatformChat]=useState('all'),[platformBusy,setPlatformBusy]=useState(false);
  const [loading,setLoading]=useState(false),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[dialog,setDialog]=useState(null);
  const [showBatchPreview,setShowBatchPreview]=useState(false);
  const [previewCases,setPreviewCases]=useState([]);
  const [title,setTitle]=useState(''),[channelId,setChannelId]=useState(''),[businessDate,setBusinessDate]=useState(new Date().toISOString().slice(0,10));
  const [reason,setReason]=useState(''),[message,setMessage]=useState(''),[verdict,setVerdict]=useState(''),[evidence,setEvidence]=useState({confirmationIds:[],snapshotIds:[]});
  const fileInput=useRef(null),requestVersion=useRef(0),endOfMessages=useRef(null);
  const active=chats.find(c=>c.chatId===selectedChat),selected=cases.find(c=>c.caseId===selectedCase),ended=Boolean(active?.endedAt);
  const selectedRun=selected?.runId??active?.runId;
  const selectedAgentChat=selectedCase??selectedChat;
  const visibleMessages=(agent?.messages??[]).map(visibleMessage).filter(Boolean);
  const chatDataEntry=generatedCatalog.find(item=>cases.some(legacyCase=>legacyCase.title===item.chatTitle));
  const dataCaseActive=view==='discussion'&&selected?.title===chatDataEntry?.chatTitle;
  const currentDataPath=caseDataPath(generatedSelection.chatId,generatedSelection.caseId);
  const requestNew=(path,options)=>requestNewPath(currentDataPath+path,options);
  const refreshGeneratedCatalog=useCallback(async()=>{
    const catalog=await requestNewPath('/data/catalog');
    setGeneratedCatalog(catalog.items??[]);
    if(!generatedSelection.caseId&&catalog.items?.length)setGeneratedSelection({chatId:catalog.items[0].chatId,caseId:catalog.items[0].caseId});
    return catalog.items??[];
  },[generatedSelection.caseId]);

  const refreshCatalog=useCallback(async()=>{
    const [global,legacy]=await Promise.all([request('/v2/chats'),request('/chats')]);
    setChats(global.chats??[]);setChannels(legacy.channels??[]);
    setSelectedChat(current=>current&&global.chats.some(c=>c.chatId===current)?current:global.chats[0]?.chatId??null);
  },[]);
  const refreshDetail=useCallback(async({silent=false}={})=>{
    if(!selectedChat)return;
    const version=++requestVersion.current;
    if(!silent)setLoading(true);
    try{
      const [caseList,flow,batchList]=await Promise.all([
        request(`/v2/chats/${selectedChat}/cases`),request(`/v2/chats/${selectedChat}/progress`),request(`/v2/chats/${selectedChat}/batches`)]);
      if(version!==requestVersion.current)return;
      setCases(caseList.cases??[]);setProgress(flow);setBatches(batchList.batches??[]);
      if(selectedCase&&!caseList.cases.some(c=>c.caseId===selectedCase)){setSelectedCase(null);setCaseState(null);}
      if(selectedCase&&caseList.cases.some(c=>c.caseId===selectedCase)){
        const detail=await request(`/v2/cases/${selectedCase}`);
        if(version===requestVersion.current)setCaseState(detail);
      }else setCaseState(null);
      if(view==='discussion'&&selectedRun){
        try{
          const history=await request(`/chats/${selectedAgentChat}/runs/${selectedRun}/agent`);
          if(version===requestVersion.current)setAgent(history);
        }catch(error){if(version===requestVersion.current)setAgent(error.status===404?null:{error:error.message});}
      }
    }catch(error){if(version===requestVersion.current)setNotice(error.message);}
    finally{if(version===requestVersion.current)setLoading(false);}
  },[selectedChat,selectedCase,selectedRun,selectedAgentChat,view]);
  useEffect(()=>{request('/auth/me').then(data=>setUser(data.user)).catch(()=>setUser(null));},[]);
  useEffect(()=>{if(user)refreshGeneratedCatalog().catch(error=>setNotice(error.message));},[user,refreshGeneratedCatalog]);
  useEffect(()=>{if(user)refreshCatalog().catch(error=>setNotice(error.message));},[user,refreshCatalog]);
  useEffect(()=>{if(!generatedSelection.caseId||view!=='newdata'&&!dataCaseActive)return;
    let alive=true;
    Promise.all([requestNew('/data'),requestNew('/data/review')]).then(([data,history])=>{
      if(alive){setNewData(data);setReviewTurns(history.turns??[]);}
    }).catch(error=>{if(alive)setNotice(error.message);});
    return()=>{alive=false;};
  },[view,dataCaseActive,generatedSelection.chatId,generatedSelection.caseId]);
  useEffect(()=>{if(!user)return;refreshDetail();const interval=setInterval(()=>{if(document.visibilityState==='visible')refreshDetail({silent:true});},5000);return()=>clearInterval(interval);},[user,refreshDetail]);
  useEffect(()=>{endOfMessages.current?.scrollIntoView({block:'end'});},[agent?.messages?.length,selectedCase]);
  const act=async(fn)=>{setBusy(true);setNotice('');try{await fn();setDialog(null);setReason('');await refreshCatalog();await refreshDetail();}catch(error){setNotice(error.message);}finally{setBusy(false);}};
  const createChat=()=>act(async()=>{const created=await request('/v2/chats',{method:'POST',body:{title,channelId,businessDate}});setSelectedChat(created.chatPublicId);setSelectedCase(null);setView('discussion');setTitle('');});
  const createCase=()=>act(async()=>{const created=await request(`/v2/chats/${selectedChat}/cases`,{method:'POST',body:{title}});setSelectedCase(created.caseId);setView('discussion');setTitle('');});
  const finishChat=()=>act(()=>request(`/v2/chats/${selectedChat}/end`,{method:'POST',body:{reason}}));
  const retryCase=()=>act(()=>request(`/v2/cases/${selectedCase}/retry`,{method:'POST',body:{reason}}));
  const decide=()=>act(()=>request(`/v2/cases/${selectedCase}/verdict`,{method:'POST',body:{verdict,reason,evidence}}));
  const openBatchPreview=async()=>{
    setBusy(true);setNotice('');
    try{
      const details=await Promise.all(cases.map(item=>request(`/v2/cases/${item.caseId}`)));
      setPreviewCases(cases.map((item,index)=>({...item,detail:details[index]})));
      setShowBatchPreview(true);
    }catch(error){setNotice(error.message);}finally{setBusy(false);}
  };
  const send=async(event)=>{event.preventDefault();const content=message.trim();if(!content||busy||ended||!agent)return;
    await act(()=>request(`/chats/${selectedAgentChat}/runs/${selectedRun}/agent/messages`,
      {method:'POST',body:{requestId:crypto.randomUUID(),content}}));setMessage('');};
  const upload=async(file)=>{if(!file||!selectedChat||ended)return;
    if(!/\.zip$/i.test(file.name)){setNotice('请选择 ZIP 格式的 TA 回传包');return;}
    const reader=new FileReader();reader.onload=()=>act(()=>request('/v2/returns',
      {method:'POST',body:{archive:{name:file.name,base64:String(reader.result).split(',')[1]}}}));
    reader.onerror=()=>setNotice('读取文件失败');reader.readAsDataURL(file);
  };
  const openDataPlatform=async()=>{setPlatformBusy(true);setNotice('');try{
    const items=(await refreshGeneratedCatalog()).filter(item=>item.generatedAt);
    const data=await Promise.all(items.map(async item=>({item,
      data:await requestNewPath(caseDataPath(item.chatId,item.caseId)+'/data')})));
    setPlatformRows(data);setPlatformChat('all');setShowDataPlatform(true);
  }catch(error){setNotice(error.message);}finally{setPlatformBusy(false);}};
  const platformData=useMemo(()=>{
    const items=platformRows.filter(({item})=>platformChat==='all'||item.chatId===platformChat);
    return {revision:0,status:'VALIDATED',
      customers:items.flatMap(({data})=>data.customers??[]),
      accounts:items.flatMap(({data})=>data.accounts??[]),
      funds:items.flatMap(({data})=>data.funds??[]),
      holdings:items.flatMap(({data})=>data.holdings??[])};
  },[platformRows,platformChat]);
  const saveNewData=async edit=>{
    const data=await requestNew('/data',{method:'PATCH',body:edit});setNewData(data);
  };
  const sendDataReview=async userInput=>{setReviewBusy(true);setNotice('');try{
    const result=await requestNew('/data/review',{method:'POST',body:{revision:newData.revision,userInput}});
    setNewData(result.data);const history=await requestNew('/data/review');setReviewTurns(history.turns??[]);
    return true;
  }catch(error){setNotice(error.message);return false;}finally{setReviewBusy(false);}};
  const confirmNewData=async()=>{setReviewBusy(true);setNotice('');try{
    const data=await requestNew('/data/confirm',{method:'POST',body:{revision:newData.revision}});
    setNewData(data);
  }catch(error){setNotice(error.message);}finally{setReviewBusy(false);}};
  const retryNewData=async()=>{setReviewBusy(true);setNotice('');try{
    const plan=await requestNew('/plan');
    const data=await requestNew('/data/execute',{method:'POST',body:{versionNumber:plan.versionNumber}});
    setNewData(data);await refreshGeneratedCatalog();
  }catch(error){setNotice(error.message);}finally{setReviewBusy(false);}};
  const pendingRetry=caseState?.retries?.some(item=>item.targetSopVersion==null);
  const suggestion=caseState?.assessment?.verdict;
  const canRetry=!ended&&['FAIL','REVIEW'].includes(suggestion)&&caseState?.sop?.status==='APPROVED'
    &&!pendingRetry&&!caseState?.assessment?.actions?.some(a=>['WAITING_RETURN','WAITING_05'].includes(a.status))
    &&!(caseState?.humanDecision?.current&&caseState.humanDecision.finalVerdict==='PASS');
  const canDecide=!ended&&['PASS','FAIL'].includes(suggestion)&&!caseState?.humanDecision?.current;
  const openVerdict=()=>{setVerdict(suggestion);setReason('');setEvidence({confirmationIds:[],snapshotIds:[]});setDialog('verdict');};
  const toggleEvidence=(kind,id)=>setEvidence(current=>({...current,[kind]:current[kind].includes(id)?current[kind].filter(x=>x!==id):[...current[kind],id]}));
  if(user===undefined)return <div className="wf-loading">正在检查登录状态…</div>;
  if(!user)return <Login theme={theme} onToggleTheme={toggleTheme} onDone={()=>request('/auth/me').then(data=>setUser(data.user))}/>;
  return <div className="wf" data-theme={theme}>
    <aside className="wf-sidebar">
      <div className="wf-sidebar-head"><div className="wf-mark">GF</div><strong>工作空间</strong><button className="wf-icon" title={theme==='dark'?'切换到白色主题':'切换到深色主题'} aria-label={theme==='dark'?'切换到白色主题':'切换到深色主题'} onClick={toggleTheme}>{theme==='dark'?<Sun size={17}/>:<Moon size={17}/>}</button><button className="wf-icon" title="退出登录" aria-label="退出登录" onClick={()=>act(async()=>{await request('/auth/logout',{method:'POST',body:{}});setUser(null);})}><LogOut size={17}/></button></div>
      <div className="wf-sidebar-title"><span>Chat</span><button className="wf-icon" aria-label="新建 Chat" title="新建 Chat" disabled={chats.some(c=>!c.endedAt)} onClick={()=>{setTitle('');setChannelId(channels[0]?.id??'');setDialog('chat');}}><Plus size={17}/></button></div>
      <div className="wf-chat-list">{chats.length?chats.map(chat=><div key={chat.chatId}>
        <div className={`wf-chat-row ${selectedChat===chat.chatId&&selectedCase==null&&view==='discussion'?'selected':''}`}>
          <button type="button" className="wf-icon" aria-label={collapsed[chat.chatId]?'展开 Case':'收起 Case'} onClick={()=>setCollapsed(x=>({...x,[chat.chatId]:!x[chat.chatId]}))}>{collapsed[chat.chatId]?<ChevronRight size={15}/>:<ChevronDown size={15}/>}</button>
          <button type="button" className="wf-row-label" onClick={()=>{setSelectedChat(chat.chatId);setSelectedCase(null);setView('discussion');}}>{collapsed[chat.chatId]?<FolderClosed size={16}/>:<FolderOpen size={16}/>}<span>{chat.title}</span></button>
          <span className={`wf-dot ${chat.endedAt?'done':'live'}`} title={chat.endedAt?'已结束':'进行中'}/>
        </div>{!collapsed[chat.chatId]&&selectedChat===chat.chatId&&<>
          {cases.map(item=><button type="button" key={item.caseId}
            className={`wf-case-row ${selectedCase===item.caseId&&view==='discussion'?'selected':''}`} onClick={()=>{
              if(item.title===chatDataEntry?.chatTitle)setGeneratedSelection({chatId:chatDataEntry.chatId,caseId:chatDataEntry.caseId});
              setSelectedCase(item.caseId);setView('discussion');}}>
            <MessageSquare size={14}/><span>{item.title}</span><small>{item.sopStatus==='APPROVED'?`SOP ${item.sopVersion}`:'待确认'}</small></button>)}
          {chatDataEntry&&<button type="button" className={`wf-case-row wf-data-row ${view==='newdata'?'selected':''}`}
            onClick={()=>{setGeneratedSelection({chatId:chatDataEntry.chatId,caseId:chatDataEntry.caseId});
              setNewData(null);setSelectedCase(null);setView('newdata');}}>
            <Table2 size={14}/><span>模拟数据表</span><small>{chatDataEntry.generatedAt?'已有数据':'待生成'}</small></button>}
        </>}
      </div>):<p className="wf-side-empty">还没有 Chat。选择右侧新建开始。</p>}
      </div>
      <div className="wf-sidebar-bottom"><button disabled={platformBusy} onClick={openDataPlatform}><Database size={17}/>{platformBusy?'读取中…':'数据平台'}</button>
        <span>{user.name||user.email}</span></div>
    </aside>
    <main className="wf-main">
      <header className="wf-toolbar"><div className="wf-crumb">{active?.title??'Chat'}{view==='newdata'&&<><ChevronRight size={14}/><strong>模拟数据表</strong></>}{view!=='newdata'&&selected&&<><ChevronRight size={14}/><strong>{selected.title}</strong></>}</div>
        {view!=='newdata'&&<div className="wf-toolbar-actions"><span className={`wf-status ${stateTone(progress?.phase)}`}>{ended?'已结束':phaseName[progress?.phase]??'进行中'}</span>
          <button className="wf-icon" title="刷新" aria-label="刷新" onClick={()=>{refreshCatalog();refreshDetail();}}><RefreshCw size={16}/></button>
          {!ended&&selectedChat&&<button className="wf-secondary" onClick={()=>fileInput.current?.click()}><UploadCloud size={15}/>上传回传</button>}
          {!ended&&selectedChat&&<button className="wf-secondary" onClick={()=>{setTitle('');setDialog('case');}}><Plus size={15}/>新建 Case</button>}
          {!ended&&selectedChat&&<button className="wf-secondary" onClick={()=>{setReason('');setDialog('end');}}>结束 Chat</button>}
        </div>}</header>
      {notice&&<div className="wf-notice" role="alert"><span>{notice}</span><button className="wf-icon" aria-label="关闭提示" onClick={()=>setNotice('')}><X size={15}/></button></div>}
      {view==='newdata'?<WorkflowDatabaseBrowser data={newData}/>:!selectedChat?<section className="wf-empty"><h1>开始一个 Chat</h1><p>一个工作空间同一时间只推进一个 Chat。创建后可在其下添加多个 Case。</p><button className="wf-primary" onClick={()=>{setTitle('');setChannelId(channels[0]?.id??'');setDialog('chat');}}>新建 Chat</button></section>:
      <div className="wf-content">
        <div className="wf-discussion">{theme==='light'&&<div className="wf-content-heading"><div><small>{selected?'CASE 讨论':'CHAT 讨论'}</small><h1>{selected?.title??active?.title??'正在读取 Chat'}</h1><p>{dataCaseActive?'核对当前 Case 的模拟数据。':selected?'讨论 SOP、核对证据并记录人工结论。':'共享数据和批次由此 Chat 管理；每个 Case 单独讨论。'}</p></div><span>{active?.endedAt?`结束于 ${date(active.endedAt)}`:`创建于 ${date(active?.createdAt)}`}</span></div>}
          {dataCaseActive?<WorkflowDataReview data={newData} turns={reviewTurns} busy={reviewBusy}
            onOpen={()=>setShowNewDataEditor(true)} onEdit={()=>setShowNewDataEditor(true)}
            onConfirm={confirmNewData} onSend={sendDataReview} onRetry={retryNewData}
            filePanel={newData?.reviewStatus==='CONFIRMED'&&<WorkflowApplicationFiles
              key={`${generatedSelection.chatId}:${generatedSelection.caseId}`}
              data={newData} chatId={generatedSelection.chatId} caseId={generatedSelection.caseId}
              request={requestNewPath}/>}/> : <>
          <div className="wf-message-scroll">{agent?.error?<p className="wf-error">{agent.error}</p>:visibleMessages.length?visibleMessages.map(({item,role,content})=><ConversationMessage key={item.id} item={item} role={role} content={content}/>):<div className="wf-message-empty"><MessageSquare size={24}/><strong>还没有讨论</strong><p>{ended?'此 Chat 已结束，可查看保留的记录。':agent?'从下面输入你的想法。':'助手暂不可用，仍可查看当前进度。'}</p></div>}
          {agent?.events?.filter(e=>e.status==='ERROR').map(event=><p className="wf-event-error" key={event.public_id}>回复未完成：{event.error_message||'请稍后重试'} · {date(event.created_at)}</p>)}<div ref={endOfMessages}/></div>
          {!ended&&<form className="wf-composer" onSubmit={send} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();upload(event.dataTransfer.files[0]);}}>
            <textarea value={message} disabled={!agent} onChange={event=>setMessage(event.target.value)} placeholder={agent?'描述当前 Case 的判断，或讨论下一步…':'Agent 当前未启用'} rows={2} aria-label="发送给 Agent 的消息" onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();event.currentTarget.form.requestSubmit();}}}/>
            <div><button type="button" className="wf-attach" onClick={()=>fileInput.current?.click()} title="上传 TA 回传 ZIP"><UploadCloud size={16}/>上传回传</button><span>Enter 发送 · Shift+Enter 换行</span><button type="submit" className="wf-send" disabled={!agent||!message.trim()||busy} aria-label="发送消息">{theme==='dark'?<ArrowUp size={17}/>:<Send size={17}/>}</button></div>
          </form>}</>}
        </div>
        <aside className="wf-inspector"><div className="wf-inspector-head"><Activity size={17}/><strong>{selected?'Case 流程':'Chat 流程'}</strong>{loading&&<span>刷新中</span>}</div>
          {selected&&caseState?<>
            <div className="wf-section"><div className="wf-section-title"><strong>测试方案</strong><span className={`wf-status ${stateTone(caseState.sop?.status)}`}>{caseState.sop?`第 ${caseState.sop.version} 版 · ${sopStatusName[caseState.sop.status]??caseState.sop.status}`:'尚未提出'}</span></div>
              {caseState.sop&&<p>提出于 {date(caseState.sop.createdAt)}{caseState.sop.approvedAt&&` · 确认于 ${date(caseState.sop.approvedAt)}`}</p>}
              {caseState.sop?.status==='PROPOSED'&&!ended&&<button className="wf-secondary" disabled={busy} onClick={()=>act(()=>request(`/v2/cases/${selectedCase}/sop/${caseState.sop.version}/approve`,{method:'POST',body:{}}))}>确认这版方案</button>}
              {caseState.sop&&<button className="wf-secondary" disabled={busy} onClick={openBatchPreview}>查看数据表</button>}
            </div>
            <div className="wf-section"><div className="wf-section-title"><strong>后续步骤</strong><span>{caseState.assessment?.verdict&&actionName[caseState.assessment.verdict]||'等待方案确认'}</span></div>
              {(caseState.sop?.value?.actions??[]).map(action=>{const actual=caseState.assessment?.actions?.find(a=>a.actionId===action.id);
                const issued=caseState.actions?.find(a=>a.action_key===action.id&&Number(a.sop_version)===Number(caseState.sop.version));
                return <div className="wf-step" key={action.id}><span className={`wf-step-marker ${stateTone(actual?.status)}`}/><div><strong>{action.fileType} · {action.id}</strong><span>{actual?`${actionName[actual.status]??actual.status}`:'待生成申请'}{issued&&` · ${date(issued.batch_created_at)}`}</span><small>{action.fileType==='01'?'等待 02 开户确认':'等待 04 交易确认'}{action.evidence05?'及 05 份额证据':''}</small></div></div>;})}
              <div className="wf-step"><span className={`wf-step-marker ${stateTone(caseState.assessment?.verdict)}`}/><div><strong>AI 判断</strong><span>{actionName[caseState.assessment?.verdict]??'等待证据'}</span></div></div>
              <div className="wf-step"><span className={`wf-step-marker ${stateTone(caseState.humanDecision?.finalVerdict)}`}/><div><strong>人工复核</strong><span>{caseState.humanDecision?.current?`${actionName[caseState.humanDecision.finalVerdict]} · ${date(caseState.humanDecision.decidedAt)}`:'尚未确认'}</span></div></div>
            </div>
            {caseState.retries?.length>0&&<div className="wf-section"><strong>重试历史</strong>{caseState.retries.map((item,index)=><div className="wf-retry" key={index}><strong>第 {item.sourceSopVersion} 版 → {item.targetSopVersion?`第 ${item.targetSopVersion} 版`:'等待新版 SOP'}</strong><span>{date(item.requestedAt)}</span><p>{item.humanReason}</p><small>上一轮 AI：{actionName[item.aiAssessment?.verdict]??item.aiAssessment?.verdict}</small></div>)}</div>}
            {!ended&&<div className="wf-section wf-actions">{canRetry&&<button className="wf-secondary" onClick={()=>{setReason('');setDialog('retry');}}><RotateCcw size={15}/>重试 SOP</button>}{pendingRetry&&<p className="wf-callout">人工已发起重试，等待新版 SOP。</p>}{canDecide&&<button className="wf-primary" onClick={openVerdict}>人工复核</button>}</div>}
          </>:<><div className="wf-section"><strong>总体进度</strong><p>{phaseName[progress?.phase]??'正在读取'}</p><p>{cases.length} 个 Case · {batches.length} 个批次</p>
            <button className="wf-secondary" disabled={busy||!cases.length} onClick={openBatchPreview}>查看数据表</button>
            {!ended&&progress?.phase==='READY_TO_GENERATE'&&<button className="wf-primary" disabled={busy} onClick={()=>act(()=>request(`/v2/chats/${selectedChat}/batches/generate`,{method:'POST',body:{}}))}>生成本轮 01 / 03</button>}</div>
            <div className="wf-section"><div className="wf-section-title"><strong>文件批次</strong><FileArchive size={16}/></div>{batches.length?batches.map(batch=><div className="wf-batch" key={batch.batchId}><strong>第 {batch.iteration} 轮 · {date(batch.createdAt)}</strong>{batch.packages.map(pkg=><div key={pkg.packageId}><a href={`/api/v2/batches/${batch.batchId}/packages/${pkg.packageId}/download`}><ArrowDownToLine size={14}/>下载文件包</a><small>{pkg.deliveryStatus??'待交付'}</small>{!ended&&pkg.deliveryStatus!=='DELIVERED'&&<button className="wf-plain" onClick={()=>{setReason('');setDialog({type:'deliver',batchId:batch.batchId,packageId:pkg.packageId});}}>确认交付</button>}</div>)}</div>):<p>尚无批次。</p>}</div>
          </>}
        </aside>
      </div>}
    </main>
    {dialog==='chat'&&<Dialog title="新建 Chat" onClose={()=>setDialog(null)}><form onSubmit={event=>{event.preventDefault();createChat();}}><label>Chat 名称<input autoFocus required maxLength={160} value={title} onChange={event=>setTitle(event.target.value)}/></label><label>交换通道<select required value={channelId} onChange={event=>setChannelId(event.target.value)}><option value="">选择通道</option>{channels.map(c=><option key={c.id} value={c.id}>{c.ta_code} → {c.distributor_code}</option>)}</select></label><label>业务日期<input type="date" required value={businessDate} onChange={event=>setBusinessDate(event.target.value)}/></label><button className="wf-primary" disabled={busy||!channels.length}>创建 Chat</button></form></Dialog>}
    {dialog==='case'&&<Dialog title="新建 Case" onClose={()=>setDialog(null)}><form onSubmit={event=>{event.preventDefault();createCase();}}><label>Case 名称<input autoFocus required maxLength={160} value={title} onChange={event=>setTitle(event.target.value)}/></label><button className="wf-primary" disabled={busy}>添加到当前 Chat</button></form></Dialog>}
    {dialog==='retry'&&<Dialog title="发起 SOP 重试" onClose={()=>setDialog(null)}><form onSubmit={event=>{event.preventDefault();retryCase();}}><p>保留旧 SOP、申请和回传。Agent 将读取上一轮判断并讨论新版 SOP。</p><label>重试原因<textarea autoFocus required maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)}/></label><button className="wf-primary" disabled={busy||!reason.trim()}>发起重试</button></form></Dialog>}
    {dialog==='end'&&<Dialog title="人工结束 Chat" onClose={()=>setDialog(null)}><form onSubmit={event=>{event.preventDefault();finishChat();}}><p>服务端会检查所有 Case 的当前结论、待回传和待重试事项。结束后只能查看历史。</p><label>结束原因<textarea autoFocus required maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)}/></label><button className="wf-primary" disabled={busy||!reason.trim()}>检查并结束</button></form></Dialog>}
    {dialog==='verdict'&&<Dialog title="人工复核 Case" onClose={()=>setDialog(null)}><form onSubmit={event=>{event.preventDefault();decide();}}><p>AI 建议：{actionName[suggestion]??suggestion}</p><label>最终结论<select value={verdict} onChange={event=>setVerdict(event.target.value)}><option value="PASS">通过</option><option value="FAIL">失败</option></select></label><label>原因<textarea value={reason} onChange={event=>setReason(event.target.value)} maxLength={2000} placeholder={verdict==='FAIL'?'失败处置原因必填':'如需说明，请填写'}/></label>
      {verdict!==suggestion&&<fieldset><legend>引用当前 Case 证据</legend>{Object.entries(caseState?.availableEvidence??{}).flatMap(([kind,ids])=>ids.map(id=><label className="wf-check" key={`${kind}-${id}`}><input type="checkbox" checked={evidence[kind].includes(id)} onChange={()=>toggleEvidence(kind,id)}/>{kind==='confirmationIds'?'确认':'份额快照'} #{id}</label>))}</fieldset>}
      <button className="wf-primary" disabled={busy||(verdict==='FAIL'&&!reason.trim())||(verdict!==suggestion&&(!reason.trim()||!Object.values(evidence).some(ids=>ids.length)))}>保存人工结论</button></form></Dialog>}
    {dialog?.type==='deliver'&&<Dialog title="确认文件交付" onClose={()=>setDialog(null)}><form onSubmit={event=>{event.preventDefault();act(()=>request(`/v2/batches/${dialog.batchId}/packages/${dialog.packageId}/deliver`,{method:'POST',body:{evidence:reason}}));}}><label>交付凭证<textarea autoFocus required value={reason} onChange={event=>setReason(event.target.value)}/></label><button className="wf-primary" disabled={busy||!reason.trim()}>确认交付</button></form></Dialog>}
    <input ref={fileInput} type="file" accept=".zip,application/zip" hidden onChange={event=>{upload(event.target.files[0]);event.target.value='';}}/>
    {showBatchPreview&&<BatchDataPreview cases={previewCases} onClose={()=>setShowBatchPreview(false)}/>}
    {showNewDataEditor&&newData?.status==='VALIDATED'&&<WorkflowDataEditor data={newData}
      readOnly={newData.reviewStatus==='CONFIRMED'} onClose={()=>setShowNewDataEditor(false)}
      onSave={saveNewData}/>}
    {showDataPlatform&&<WorkflowDatabaseBrowser data={platformData} overlay
      scopeControl={<select aria-label="浏览 Chat" value={platformChat} onChange={event=>setPlatformChat(event.target.value)}>
        <option value="all">全部 Chat</option>
        {[...new Map(platformRows.map(({item})=>[item.chatId,item.chatTitle])).entries()].map(([chatId,chatTitle])=>
          <option key={chatId} value={chatId}>{chatTitle}</option>)}
      </select>} onClose={()=>setShowDataPlatform(false)}/>}
  </div>;
}
