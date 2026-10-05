import React, { Children, isValidElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Command } from 'cmdk';
import Fuse from 'fuse.js';
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, Copy, Database, Download, Eye, FileText, Landmark, Pencil, Play, Plus, RotateCcw, Search, UserPlus, X } from 'lucide-react';
import { TRANSACTION_BUSINESSES, TRANSACTION_FIELD_INPUTS } from '@fund-demo/protocol/src/businesses.js';
import './styles.css';
import './person-flow.css';
import './config-board.css';
import './global-search.css';
import { WorkflowApp } from './workflow-app.jsx';

const SALES = import.meta.env.VITE_SALES_API || '/sales-api';
const TA = import.meta.env.VITE_TA_API || '/ta-api';
const STATUS = { NOT_OPENED:'未开户',OPEN_PENDING:'待发送开户',OPEN_SENT:'开户已发送',OPENED:'已开户',OPEN_FAILED:'开户失败',CLOSED:'已销户',NORMAL:'正常',FROZEN:'已冻结',ACTIVE:'有效',REVOKED:'已撤销',LOST:'已挂失',PENDING:'待发送',SENT:'已发送',IMPORTED:'已导入',PROCESSED:'已处理',CONFIRMED:'已确认',CANCELED:'已撤单',FAILED:'失败',MATCHED:'对账一致',DIFFERENT:'存在差异',SYNCED:'已按TA同步',FILE_ERROR:'文件错误' };
const FILE_NAMES = {'01':'账户申请','02':'账户确认','03':'交易申请','04':'交易确认','05':'份额对账','07':'基金行情'};
const ACCOUNT_BUSINESSES={'001':'开户','002':'销户','003':'账户信息修改','004':'基金账户冻结','005':'基金账户解冻','006':'账户卡挂失','007':'账户卡解挂','008':'增加交易账户','009':'撤销交易账户'};
const money=v=>Number(v||0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const isCurrentHolding=holding=>Number(holding.volume||0)>0||Number(holding.frozen_volume||0)>0;
const formatDate=v=>v?.length===8?`${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6)}`:v;
const compactDate=v=>String(v||'').replaceAll('-','');
const batchDataFileName=batch=>`OFD_${batch.direction==='sales-to-ta'?'305_27':'27_305'}_${batch.business_date}_${batch.file_type}.TXT`;
const INDEX_KIND_BY_FILE_TYPE={'01':'OFI','02':'OFI','03':'OFI','04':'OFI','05':'OFI','07':'OFJ'};
const batchIndexFileName=batch=>`${INDEX_KIND_BY_FILE_TYPE[batch.file_type]||'OFI'}_${batch.direction==='sales-to-ta'?'305_27':'27_305'}_${batch.business_date}.TXT`;
const PAGE_PATHS={manual:'/',records:'/records',home:'/accounts',config:'/config'};
const pageFromPath=pathname=>Object.entries(PAGE_PATHS).find(([,path])=>path===(pathname!=='/'?pathname.replace(/\/$/,''):pathname))?.[0]||'manual';
const api=async(base,path,options={})=>{const response=await fetch(`${base}${path}`,{...options,cache:options.cache||'no-store',headers:{'Content-Type':'application/json',...options.headers},body:options.body?JSON.stringify(options.body):undefined});const data=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(data.error||`请求失败（${response.status}）`);error.status=response.status;throw error;}return data;};

function Dropdown({children,value,onChange,disabled,readOnly,'aria-label':ariaLabel}){
  const buttonRef=useRef(null),[open,setOpen]=useState(false),[position,setPosition]=useState(null);
  const options=Children.toArray(children).filter(isValidElement).map(option=>({value:String(option.props.value??option.props.children??''),label:option.props.children,disabled:Boolean(option.props.disabled)}));
  const selected=options.find(option=>option.value===String(value??''))||options[0];
  useEffect(()=>{
    if(!open)return;
    const place=()=>{const rect=buttonRef.current?.getBoundingClientRect();if(rect)setPosition({top:rect.bottom+6,left:rect.left,width:rect.width,maxHeight:Math.max(120,window.innerHeight-rect.bottom-18)});};
    const close=event=>{if(!buttonRef.current?.contains(event.target)&&!event.target.closest?.('.dropdown-menu'))setOpen(false);};
    place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);document.addEventListener('pointerdown',close);
    return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);document.removeEventListener('pointerdown',close);};
  },[open]);
  const choose=option=>{if(option.disabled)return;onChange?.({target:{value:option.value}});setOpen(false);buttonRef.current?.focus();};
  const onKeyDown=event=>{if(event.key==='Escape'){setOpen(false);return;}if(event.key==='Enter'||event.key===' '||event.key==='ArrowDown'){event.preventDefault();setOpen(true);}};
  return <><button ref={buttonRef} type="button" className={`dropdown-trigger${open?' open':''}`} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} disabled={disabled||readOnly} onClick={()=>setOpen(current=>!current)} onKeyDown={onKeyDown}><span>{selected?.label||'请选择'}</span><ChevronDown size={16}/></button>{open&&position&&createPortal(<div className="dropdown-menu" role="listbox" style={position}>{options.map(option=><button type="button" role="option" aria-selected={option.value===String(value??'')} className={option.value===String(value??'')?'selected':''} disabled={option.disabled} key={option.value} onClick={()=>choose(option)}>{option.value===String(value??'')&&<span className="dropdown-check">✓</span>}<span>{option.label}</span></button>)}</div>,document.body)}</>;
}

function Badge({status,children}){const success=['OPENED','CONFIRMED','MATCHED','PROCESSED','SYNCED','SENT'].includes(status);const danger=['FAILED','OPEN_FAILED','DIFFERENT','FILE_ERROR'].includes(status);return <span className={`badge ${danger?'danger':success?'success':'warning'}`}>{children||STATUS[status]||status||'—'}</span>}
function Button({children,onClick,disabled,tone='primary',icon:Icon}){return <button className={`button ${tone}`} onClick={onClick} disabled={disabled}>{Icon&&<Icon size={15}/>} <span>{children}</span></button>}
function Panel({title,subtitle,icon:Icon,children,action}){return <section className="panel"><header><div className="panel-title">{Icon&&<Icon size={18}/>}<div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div></div>{action}</header>{children}</section>}
function Empty({children}){return <div className="empty">{children}</div>}

function CommandSearchInput({value,onValueChange,placeholder,compact=false}){
  return <div className={`command-search-input${compact?' compact':''}`}><Search size={compact?15:18}/><Command.Input value={value} onValueChange={onValueChange} placeholder={placeholder} aria-label={placeholder}/>{value&&<button type="button" aria-label="清空搜索" onClick={()=>onValueChange('')}><X size={14}/></button>}</div>;
}

const SEARCH_GROUP_ORDER=['页面','客户','基金','账户申请','交易申请','持仓','文件批次'];
const searchGroupIcon=group=>group==='客户'?UserPlus:group==='基金'?Landmark:group==='文件批次'?FileText:group==='页面'?Search:Database;

function GlobalSearch({sales,ta,open,setOpen,onSelect}){
  const [query,setQuery]=useState('');
  const entries=useMemo(()=>{
    const customersById=new Map(sales.customers.map(customer=>[customer.id,customer]));
    const fundsByCode=new Map([...sales.funds,...ta.funds].map(fund=>[fund.fund_code,fund]));
    const pages=[
      {id:'page-manual',group:'页面',title:'数据工厂',subtitle:'创建开户、申购、赎回等业务',keywords:'业务 操作 申请',page:'manual'},
      {id:'page-records',group:'页面',title:'文件查询',subtitle:'查询 01 / 02 / 03 / 04 / 05 / 07 交换文件',keywords:'批次 OFD 文件 协议',page:'records'},
      {id:'page-accounts',group:'页面',title:'账户信息',subtitle:'查看客户资产与基金持仓',keywords:'客户 账户 持仓',page:'home'},
      {id:'page-config-customer',group:'页面',title:'客户列表',subtitle:'查看和维护销售系统客户主数据',keywords:'配置 列表 客户',page:'config',configView:'customer'},
      {id:'page-config-distributor',group:'页面',title:'销售机构',subtitle:'查看本地与外部销售机构主数据',keywords:'配置 销售机构 转托管',page:'config',configView:'distributor'},
      {id:'page-config-fund',group:'页面',title:'基金产品配置',subtitle:'维护 TA 基金产品主数据',keywords:'配置 基金',page:'config',configView:'fund'}
    ];
    const customers=sales.customers.map(customer=>({id:`customer-${customer.id}`,group:'客户',title:customer.name,subtitle:`身份证尾号 ${String(customer.certificate_no||'').slice(-4)} · ${STATUS[customer.open_status]||customer.open_status}`,keywords:[customer.certificate_no,customer.mobile,customer.email,customer.ta_account_id,customer.transaction_account_id].join(' '),page:'home',customerId:customer.id}));
    const funds=[...fundsByCode.values()].map(fund=>({id:`fund-${fund.fund_code}`,group:'基金',title:fund.fund_name||fund.fund_code,subtitle:`${fund.fund_code} · ${fund.fund_type_name||'未分类'}`,keywords:[fund.fund_code,fund.fund_name,fund.fund_type_name].join(' '),page:'config',configView:'fund'}));
    const applications=sales.accountApplications.map(application=>{const customer=customersById.get(application.customer_id);return {id:`account-app-${application.id}`,group:'账户申请',title:`${application.business_code} ${ACCOUNT_BUSINESSES[application.business_code]||'账户业务'}`,subtitle:`${customer?.name||'未知客户'} · ${application.app_no} · ${STATUS[application.status]||application.status}`,keywords:[application.app_no,application.business_code,application.transaction_account_id,customer?.name,customer?.certificate_no].join(' '),page:'manual',customerId:application.customer_id,businessDate:application.business_date};});
    const orders=sales.orders.map(order=>{const customer=customersById.get(order.customer_id),fund=fundsByCode.get(order.fund_code);return {id:`order-${order.id}`,group:'交易申请',title:`${order.business_code||'022'} ${TRANSACTION_BUSINESSES[order.business_code||'022']?.name||'基金交易'}`,subtitle:`${customer?.name||'未知客户'} · ${order.app_no} · ${fund?.fund_name||order.fund_code||'未指定基金'}`,keywords:[order.app_no,order.business_code,order.transaction_account_id,order.ta_account_id,order.fund_code,customer?.name,fund?.fund_name].join(' '),page:'manual',customerId:order.customer_id,businessDate:order.business_date};});
    const holdings=sales.holdings.filter(isCurrentHolding).map(holding=>{const customer=customersById.get(holding.customer_id),fund=fundsByCode.get(holding.fund_code);return {id:`holding-${holding.customer_id}-${holding.fund_code}`,group:'持仓',title:fund?.fund_name||holding.fund_code,subtitle:`${customer?.name||'未知客户'} · ${money(Number(holding.volume||0)+Number(holding.frozen_volume||0))} 份`,keywords:[holding.fund_code,holding.ta_account_id,customer?.name,customer?.certificate_no,fund?.fund_name].join(' '),page:'home',customerId:holding.customer_id};});
    const batches=[...sales.batches.map(batch=>({...batch,source:'销售系统'})),...ta.batches.map(batch=>({...batch,source:'TA 系统'}))].map(batch=>({id:`batch-${batch.source}-${batch.id}`,group:'文件批次',title:`${batch.file_type} ${FILE_NAMES[batch.file_type]||'交换文件'}`,subtitle:`${batch.source} · ${batch.batch_id} · ${formatDate(batch.business_date)}`,keywords:[batch.batch_id,batch.file_type,batch.direction,batch.business_date,batch.status].join(' '),page:'records'}));
    return [...pages,...customers,...funds,...applications,...orders,...holdings,...batches];
  },[sales,ta]);
  const fuse=useMemo(()=>new Fuse(entries,{includeScore:true,ignoreLocation:true,threshold:.32,keys:[{name:'title',weight:.45},{name:'subtitle',weight:.3},{name:'keywords',weight:.25}]}),[entries]);
  const results=useMemo(()=>{const term=query.trim();if(!term)return entries.filter(entry=>entry.group==='页面');if(/^[0-9A-Za-z_-]{2,}$/.test(term)){const needle=term.toLowerCase();return entries.filter(entry=>`${entry.title} ${entry.subtitle} ${entry.keywords}`.toLowerCase().includes(needle)).slice(0,24);}return fuse.search(term,{limit:24}).map(result=>result.item);},[entries,fuse,query]);
  const grouped=SEARCH_GROUP_ORDER.map(group=>[group,results.filter(result=>result.group===group)]).filter(([,items])=>items.length);
  useEffect(()=>{const toggle=event=>{if(event.key.toLowerCase()==='k'&&(event.metaKey||event.ctrlKey)){event.preventDefault();setOpen(current=>!current);}};document.addEventListener('keydown',toggle);return()=>document.removeEventListener('keydown',toggle);},[setOpen]);
  useEffect(()=>{if(!open)setQuery('');},[open]);
  return <Command.Dialog open={open} onOpenChange={setOpen} shouldFilter={false} label="全系统搜索" className="global-search-dialog" overlayClassName="global-search-overlay"><div className="global-search-heading"><CommandSearchInput value={query} onValueChange={setQuery} placeholder="搜索客户、基金、申请、持仓或文件批次"/><kbd>ESC</kbd></div><Command.List className="global-search-results">{grouped.map(([group,items])=><Command.Group heading={group} key={group}>{items.map(item=>{const Icon=searchGroupIcon(group);return <Command.Item key={item.id} value={item.id} onSelect={()=>onSelect(item)}><span className="global-result-icon"><Icon size={16}/></span><span className="global-result-copy"><strong>{item.title}</strong><small>{item.subtitle}</small></span><ChevronRight size={16}/></Command.Item>})}</Command.Group>)}{query&&results.length===0&&<Command.Empty>没有找到“{query}”相关数据</Command.Empty>}</Command.List><footer><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>↵</kbd> 打开</span><span>Ctrl/Cmd + K</span></footer></Command.Dialog>;
}

function TopNav({page,setPage,configView,setConfigView,businessDate,onOpenSearch}){
  const [configOpen,setConfigOpen]=useState(false),configMenuRef=useRef(null);
  const items=[['manual','数据工厂'],['records','文件查询'],['home','账户信息']];
  const configItems=[['date','业务日期'],['customer','客户列表'],['distributor','销售机构'],['fund','基金产品']];
  useEffect(()=>{
    if(!configOpen)return;
    const close=event=>{if(!configMenuRef.current?.contains(event.target))setConfigOpen(false);};
    const closeOnEscape=event=>{if(event.key==='Escape')setConfigOpen(false);};
    document.addEventListener('pointerdown',close);
    document.addEventListener('keydown',closeOnEscape);
    return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',closeOnEscape);};
  },[configOpen]);
  const openConfig=view=>{setConfigView(view);setPage('config');setConfigOpen(false);};
  return <header className="topbar"><div className="brand"><div className="brand-icon">蚂</div><div><strong>基金数据工厂</strong><small>销售机构 × 广发基金 TA</small></div></div><nav>{items.map(([id,label])=><button key={id} className={page===id?'active':''} onClick={()=>{setConfigOpen(false);setPage(id);}}>{label}</button>)}<div className="nav-dropdown" ref={configMenuRef}><button className={page==='config'?'active':''} aria-haspopup="menu" aria-expanded={configOpen} onClick={()=>setConfigOpen(open=>!open)}>配置<ChevronDown size={15}/></button>{configOpen&&<div className="nav-dropdown-menu" role="menu">{configItems.map(([id,label])=><button key={id} role="menuitem" className={page==='config'&&configView===id?'selected':''} onClick={()=>openConfig(id)}><span>{label}</span>{page==='config'&&configView===id&&<CheckCircle2 size={15}/>}</button>)}</div>}</div></nav><div className="topbar-meta"><button className="global-search-trigger" onClick={onOpenSearch}><Search size={15}/><span>全局搜索</span><kbd>⌘K</kbd></button><span>业务日&nbsp;&nbsp;{formatDate(businessDate)}</span></div></header>;
}

function App(){
  const [sales,setSales]=useState(null),[ta,setTa]=useState(null),[page,setPage]=useState(()=>pageFromPath(window.location.pathname)),[busy,setBusy]=useState(''),[notice,setNotice]=useState(null),[filterDate,setFilterDate]=useState(''),[resetDate,setResetDate]=useState('2026-09-16');
  const [configView,setConfigView]=useState('date'),[runs,setRuns]=useState([]),[selectedRunId,setSelectedRunId]=useState(null);
  const [globalSearchOpen,setGlobalSearchOpen]=useState(false),[selectedCustomerId,setSelectedCustomerId]=useState('');
  const [customerForm,setCustomerForm]=useState({name:'',certificateNo:'',mobile:'',email:'',balance:100000,riskLevel:'3'});
  const [distributorForm,setDistributorForm]=useState({code:'',name:'',status:'ENABLED'});
  const [orderForm,setOrderForm]=useState({customerId:'',businessCode:'022',values:{FundCode:'',CodeOfTargetFund:'',ApplicationAmount:1000,ApplicationVol:100,LargeRedemptionFlag:'0',DefDividendMethod:'1',FrozenCause:'1',OriginalAppSheetNo:'',TargetDistributorCode:'',TargetTransactionAccountID:'',TargetRegionCode:''}});
  const [fundForm,setFundForm]=useState({code:'000001',name:'广发演示成长基金',status:'0',nav:1.25,minFirst:100,maxPurchase:1000000,feeRate:0.015,fundType:'01',fundTypeName:'混合型'});
  const [protocolEditor,setProtocolEditor]=useState(null),[accountEditor,setAccountEditor]=useState(null),[draftEdits,setDraftEdits]=useState({});
  const refreshInFlight=useRef(null),lastBusinessDate=useRef('');
  const navigatePage=useCallback(nextPage=>{
    const nextPath=PAGE_PATHS[nextPage];
    if(!nextPath)return;
    if(window.location.pathname!==nextPath){
      const url=new URL(window.location.href);
      url.pathname=nextPath;
      window.history.pushState({page:nextPage},'',url);
    }
    setPage(nextPage);
  },[]);
  const refresh=useCallback(async({fresh=false}={})=>{
    if(refreshInFlight.current){try{await refreshInFlight.current;}catch(error){if(!fresh)throw error;}if(!fresh)return;}
    const request=Promise.all([api(SALES,'/state'),api(TA,'/state'),api(SALES,'/automation/runs')]).then(([s,t,automationRuns])=>{
      setSales(s);setTa(t);setRuns(automationRuns);
      const nextBusinessDate=formatDate(s.simulation.business_date),previousBusinessDate=lastBusinessDate.current;
      setFilterDate(current=>!current||current===previousBusinessDate?nextBusinessDate:current);
      lastBusinessDate.current=nextBusinessDate;
      setOrderForm(v=>({...v,customerId:s.customers.some(c=>c.id===v.customerId)?v.customerId:(s.customers.find(c=>c.open_status==='OPENED')?.id||''),values:{...v.values,FundCode:s.funds.some(f=>f.fund_code===v.values?.FundCode)?v.values.FundCode:(s.funds.find(f=>f.fund_status==='0')?.fund_code||'')}}));
    });
    refreshInFlight.current=request;
    try{await request;}finally{if(refreshInFlight.current===request)refreshInFlight.current=null;}
  },[]);
  useEffect(()=>{
    const reportError=error=>setNotice({error:error.message});
    const refreshVisible=()=>{if(document.visibilityState==='visible')refresh().catch(()=>{});};
    refresh({fresh:true}).catch(reportError);
    const timer=window.setInterval(refreshVisible,1000);
    window.addEventListener('focus',refreshVisible);
    document.addEventListener('visibilitychange',refreshVisible);
    return()=>{window.clearInterval(timer);window.removeEventListener('focus',refreshVisible);document.removeEventListener('visibilitychange',refreshVisible);};
  },[refresh]);
  useEffect(()=>{
    const restorePage=()=>setPage(pageFromPath(window.location.pathname));
    window.addEventListener('popstate',restorePage);
    return()=>window.removeEventListener('popstate',restorePage);
  },[]);
  const run=async(label,action,onError)=>{setBusy(label);try{const result=await action();setNotice({ok:`${label}完成`,detail:result});await refresh({fresh:true});return result}catch(e){setNotice({error:e.message});onError?.(e);return false}finally{setBusy('')}};
  const openProtocolEditor=async(fileType,businessId,context={})=>{setBusy(`准备 ${fileType} 文件`);try{const preview=await api(SALES,`/batches/${fileType}/preview`),saved=draftEdits[fileType];if(saved){const byId=new Map(saved.map(item=>[item.businessId,item.values]));for(const item of preview.records)if(byId.has(item.businessId))item.values=structuredClone(byId.get(item.businessId));}const active=Math.max(0,preview.records.findIndex(item=>item.businessId===businessId));setProtocolEditor({preview,original:structuredClone(preview.records),active,mode:'draft',...context});}catch(e){setNotice({error:e.message})}finally{setBusy('')}};
  const createOrderAndEdit=async({customer,businessCode,values})=>{const business=TRANSACTION_BUSINESSES[businessCode],created=await run(`创建${business.name}申请`,()=>api(SALES,'/orders',{method:'POST',body:{customerId:customer.id,businessCode,values}}));if(!created)return;setNotice(null);await openProtocolEditor('03',created.id,{createdBusinessId:created.id,createdBusinessName:business.name});};
  const closeProtocolEditor=async()=>{const createdBusinessId=protocolEditor?.createdBusinessId;if(!createdBusinessId){setProtocolEditor(null);return;}setBusy('取消交易申请');try{await api(SALES,`/orders/${createdBusinessId}/draft`,{method:'DELETE'});setProtocolEditor(null);await refresh({fresh:true});}catch(error){setNotice({error:error.message})}finally{setBusy('')}};
  const openAccountEditor=customer=>setAccountEditor({customer,businessCode:'003',transactionAccountId:customer.transaction_account_id||'',profile:{address:customer.address||'',mobile:customer.mobile||'',email:customer.email||'',cert_valid_date:formatDate(customer.cert_valid_date)||'',bank_name:customer.bank_name||'',bank_no:customer.bank_no||'',bank_code:customer.bank_code||'',risk_level:customer.risk_level||'3'}});
  const businessDate=sales?.simulation?.business_date||'';
  const selectedDay=compactDate(filterDate),dayOrders=sales?.orders?.filter(x=>x.business_date===selectedDay)||[],dayAccountApplications=sales?.accountApplications?.filter(x=>x.business_date===selectedDay)||[];
  const advance=days=>run(`业务日期增加 ${days} 天`,async()=>{
    const result={businessDate:await Promise.all([api(SALES,'/time/advance',{method:'POST',body:{days}}),api(TA,'/time/advance',{method:'POST',body:{days}})])};
    const optional=async(key,action)=>{try{result[key]=await action()}catch(error){if(error.status!==409)throw error;}};
    await optional('taReceived01',()=>api(TA,'/inbox/01',{method:'POST'}));
    await optional('taReceived03',()=>api(TA,'/inbox/03',{method:'POST'}));
    await optional('taProcessed01',()=>api(TA,'/process/01',{method:'POST'}));
    await optional('taProcessed03',()=>api(TA,'/process/03',{method:'POST'}));
    await optional('confirmationBatch',()=>api(TA,'/batches/T1',{method:'POST'}));
    await optional('salesReceived02',()=>api(SALES,'/inbox/02',{method:'POST'}));
    await optional('salesReceived04',()=>api(SALES,'/inbox/04',{method:'POST'}));
    await optional('salesReceived05',()=>api(SALES,'/inbox/05',{method:'POST'}));
    return result;
  });
  const reset=()=>{if(!window.confirm('重置会清空客户、订单、持仓与全部交换批次，且无法撤销。确定继续吗？'))return;run('重置演示场景',()=>{const scenarioId=`RUN${Date.now()}`;return Promise.all([api(SALES,'/reset',{method:'POST',body:{scenarioId,businessDate:resetDate}}),api(TA,'/reset',{method:'POST',body:{scenarioId,businessDate:resetDate}})])})};
  const startAutoRun=async()=>{setBusy('启动自动运行');try{const created=await api(SALES,'/automation/runs',{method:'POST',body:{files:Object.entries(draftEdits).map(([fileType,records])=>({fileType,records}))}});setDraftEdits({});setRuns(current=>[created,...current.filter(item=>item.id!==created.id)]);setSelectedRunId(created.id);}catch(error){setNotice({error:error.message})}finally{setBusy('')}};
  const openSearchResult=item=>{
    if(item.customerId){setSelectedCustomerId(item.customerId);setOrderForm(current=>({...current,customerId:item.customerId}));}
    if(item.businessDate)setFilterDate(formatDate(item.businessDate));
    if(item.configView)setConfigView(item.configView);
    navigatePage(item.page);
    setGlobalSearchOpen(false);
  };
  if(!sales||!ta)return <div className="loading"><Database className="spin"/>正在连接销售系统与 TA 系统…</div>;
  return <div className="app-shell"><TopNav page={page} setPage={navigatePage} configView={configView} setConfigView={setConfigView} businessDate={businessDate} onOpenSearch={()=>setGlobalSearchOpen(true)}/><main>
    {page==='home'&&<HomePage sales={sales} selectedId={selectedCustomerId} setSelectedId={setSelectedCustomerId}/>}
    {page==='manual'&&<WorkbenchPage sales={sales} busy={busy} run={run} orderForm={orderForm} setOrderForm={setOrderForm} filterDate={filterDate} setFilterDate={setFilterDate} dayOrders={dayOrders} dayAccountApplications={dayAccountApplications} onAccountBusiness={openAccountEditor} onCreateOrder={createOrderAndEdit} onEditFile={openProtocolEditor} onRun={startAutoRun} draftEdits={draftEdits}/>}
    {page==='records'&&<TransactionRecordsPage sales={sales} ta={ta}/>}
    {page==='config'&&<ConfigSectionPage view={configView} sales={sales} ta={ta} busy={busy} run={run} customerForm={customerForm} setCustomerForm={setCustomerForm} distributorForm={distributorForm} setDistributorForm={setDistributorForm} fundForm={fundForm} setFundForm={setFundForm} businessDate={businessDate} advance={advance} resetDate={resetDate} setResetDate={setResetDate} reset={reset}/>}
  </main><GlobalSearch sales={sales} ta={ta} open={globalSearchOpen} setOpen={setGlobalSearchOpen} onSelect={openSearchResult}/>{accountEditor&&<AccountApplicationEditor state={accountEditor} setState={setAccountEditor} transactionAccounts={sales.transactionAccounts.filter(x=>x.customer_id===accountEditor.customer.id&&x.status==='ACTIVE')} busy={busy} onSubmit={body=>run(`${accountEditor.customer.name}发起 ${body.businessCode} ${ACCOUNT_BUSINESSES[body.businessCode]}`,()=>api(SALES,`/customers/${accountEditor.customer.id}/account-applications`,{method:'POST',body}).then(result=>{setAccountEditor(null);return result}))}/>} {protocolEditor&&<ProtocolSendEditor state={protocolEditor} setState={setProtocolEditor} busy={busy} onCancel={closeProtocolEditor} onSend={()=>{const fileType=protocolEditor.preview.fileType,records=protocolEditor.preview.records.map(x=>({businessId:x.businessId,values:x.values}));setDraftEdits(current=>({...current,[fileType]:records}));setProtocolEditor(null);setNotice({ok:protocolEditor.createdBusinessId?`${protocolEditor.createdBusinessName}已加入待处理业务`:`${fileType} 字段修改已保存`});}}/>} {selectedRunId&&runs.find(item=>item.id===selectedRunId)&&<RunStatusDialog run={runs.find(item=>item.id===selectedRunId)} onClose={()=>setSelectedRunId(null)}/>} {notice&&<div className={`toast ${notice.error?'error':''}`} onClick={()=>setNotice(null)}>{notice.error?<AlertTriangle/>:<CheckCircle2/>}<div><strong>{notice.error||notice.ok}</strong><small>点击关闭</small></div></div>}</div>;
}

function AccountApplicationEditor({state,setState,transactionAccounts,busy,onSubmit}){
  const {customer,businessCode,profile}=state;
  const update=(name,value)=>setState(s=>({...s,profile:{...s.profile,[name]:value}}));
  const setBusinessCode=value=>setState(s=>({...s,businessCode:value,transactionAccountId:value==='008'?'':(transactionAccounts[0]?.transaction_account_id||s.transactionAccountId)}));
  const fields=[['address','联系地址','text'],['mobile','手机号码','tel'],['email','电子邮箱','email'],['cert_valid_date','证件有效日期','date'],['bank_name','银行账户户名','text'],['bank_no','银行账户号码','text'],['bank_code','开户行代码','text']];
  const originalValue=name=>name==='cert_valid_date'?formatDate(customer[name]):customer[name];
  const changed=fields.some(([name])=>String(profile[name]||'')!==String(originalValue(name)||''))||String(profile.risk_level||'')!==String(customer.risk_level||'');
  const needsAccount=['006','007','009'].includes(businessCode),isProfile=businessCode==='003',isAdd=businessCode==='008';
  const valid=!isProfile||changed;
  const submit=()=>onSubmit({businessCode,transactionAccountId:state.transactionAccountId,profile:isProfile?{...profile,cert_valid_date:compactDate(profile.cert_valid_date)}:undefined});
  return <div className="protocol-editor-layer"><section className="account-change-editor" role="dialog" aria-modal="true"><header><div><small>01 文件 · 002-009 通用账户申请</small><h2>{customer.name} · {businessCode} {ACCOUNT_BUSINESSES[businessCode]}</h2></div><button onClick={()=>setState(null)} aria-label="关闭"><X/></button></header><main><div className="account-business-picker"><label>业务操作<Dropdown value={businessCode} onChange={e=>setBusinessCode(e.target.value)}>{Object.entries(ACCOUNT_BUSINESSES).filter(([code])=>code!=='001').map(([code,label])=><option key={code} value={code}>{code} · {label}</option>)}</Dropdown></label>{needsAccount&&<label>目标交易账户<Dropdown value={state.transactionAccountId} onChange={e=>setState(s=>({...s,transactionAccountId:e.target.value}))}>{transactionAccounts.map(item=><option key={item.transaction_account_id} value={item.transaction_account_id}>{item.transaction_account_id} · {STATUS[item.card_status]||item.card_status}{item.is_primary?' · 主账户':''}</option>)}</Dropdown></label>}{isAdd&&<label>新交易账号<input maxLength="17" value={state.transactionAccountId} onChange={e=>setState(s=>({...s,transactionAccountId:e.target.value.replace(/\D/g,'')}))} placeholder="留空由系统自动生成"/></label>}</div>{isProfile?<div className="account-change-grid">{fields.map(([name,label,type])=><label key={name}><span>{label}</span><input type={type} value={profile[name]} onChange={e=>update(name,e.target.value)}/></label>)}<label><span>客户风险等级</span><Dropdown value={profile.risk_level} onChange={e=>update('risk_level',e.target.value)}>{['1','2','3','4','5'].map(value=><option key={value} value={value}>{value} 级</option>)}</Dropdown></label></div>:<div className="account-business-summary"><strong>{businessCode} {ACCOUNT_BUSINESSES[businessCode]}</strong><p>提交后进入 01 待发送队列，经 TA 接收、处理并返回 02 确认。</p></div>}</main><footer><div>{valid?<span className="editor-ok"><CheckCircle2 size={16}/>申请信息已就绪</span>:<span className="editor-error">请至少修改一个资料字段</span>}</div><button className="button secondary" onClick={()=>setState(null)}>取消</button><button className="button primary" disabled={!!busy||!valid||(needsAccount&&!state.transactionAccountId)} onClick={submit}>提交 {businessCode} 申请</button></footer></section></div>;
}

const FIXED_RECORD_FIELDS=new Set(['DistributorCode','BusinessCode','BranchCode','IndividualOrInstitution','CurrencyType','TAAccountID']);
function ProtocolSendEditor({state,setState,busy,onCancel,onSend}){
  const {preview,active}=state,record=preview.records[active];
  const update=(name,value)=>setState(s=>{const next=structuredClone(s);next.preview.records[next.active].values[name]=value;return next});
  const restore=()=>setState(s=>{const next=structuredClone(s);next.preview.records[next.active].values=structuredClone(next.original[next.active].values);return next});
  const ruleFor=(item,field)=>item.requirements?.[field.name]||field.requirement;
  const missing=preview.records.flatMap((item,index)=>preview.fields.filter(f=>ruleFor(item,f).level==='required'&&!String(item.values[f.name]??'').trim()).map(f=>({index,name:f.name})));
  const missingFor=index=>missing.filter(item=>item.index===index).length,isCreating=Boolean(state.createdBusinessId);
  const requiredFields=preview.fields.filter(field=>ruleFor(record,field).level==='required');
  const optionalNames=preview.fileType==='03'?(TRANSACTION_BUSINESSES[record.values.BusinessCode]?.optional03||[]):[];
  const optionalFields=optionalNames.map(name=>preview.fields.find(field=>field.name===name)).filter(Boolean);
  const renderField=(field,optional=false)=>{const fixed=FIXED_RECORD_FIELDS.has(field.name),rule=optional?{level:'optional',label:'选填'}:ruleFor(record,field);return <label key={field.name} className={fixed?'fixed':''}><span><strong>{FIELD_LABELS[field.name]||field.name}</strong><code>{field.name} · {field.type}({field.length}{field.scale?`,${field.scale}`:''})</code></span><em className={rule.level}>{rule.label}</em><input value={record.values[field.name]??''} readOnly={fixed} onChange={e=>update(field.name,e.target.value)}/>{fixed&&<small>业务固定字段，只读</small>}</label>};
  return <div className="protocol-editor-layer"><section className="protocol-editor" role="dialog" aria-modal="true"><header><div><h2>{isCreating?`确认${state.createdBusinessName}数据`:'检查和调整协议字段'}</h2></div><button disabled={!!busy} onClick={onCancel} aria-label="关闭"><X/></button></header><div className="protocol-editor-header">{Object.entries(preview.header).map(([key,value])=><span key={key}>{({marker:'文件标识',version:'协议版本',creator:'发送方',receiver:'接收方',date:'业务日期',sender:'发送系统',recipient:'接收系统',fieldCount:'字段数'})[key]}<strong>{value}</strong></span>)}</div><div className="protocol-editor-body"><aside>{preview.records.map((item,index)=><button key={item.businessId} className={index===active?'active':''} onClick={()=>setState(s=>({...s,active:index}))}><span>{index+1}</span><div><strong>{item.label}</strong><small>{missingFor(index)?`${missingFor(index)} 个必填项缺失`:item.values.AppSheetSerialNo}</small></div></button>)}</aside><main><div className="editor-fields-heading"><span>{record.values.BusinessCode} {TRANSACTION_BUSINESSES[record.values.BusinessCode]?.name||''}</span><button onClick={restore} aria-label="恢复本条默认值"><RotateCcw size={18}/></button></div><section className="editor-field-section"><h3>必填字段 <small>{requiredFields.length}</small></h3><div className="editor-fields">{requiredFields.map(field=>renderField(field))}</div></section>{preview.fileType==='03'&&<section className="editor-field-section"><h3>选填字段 <small>{optionalFields.length}</small></h3>{optionalFields.length?<div className="editor-fields">{optionalFields.map(field=>renderField(field,true))}</div>:<p className="editor-no-optional">中登协议未为该操作单列选填字段。</p>}</section>}</main></div><footer><div>{missing.length?<span className="editor-error">全部记录还有 {missing.length} 个必填字段未填写</span>:<span className="editor-ok"><CheckCircle2 size={16}/>{isCreating?'字段校验通过，可以加入待处理业务':'字段校验通过，等待统一封批'}</span>}</div><button className="button secondary" disabled={!!busy} onClick={onCancel}>{busy?'取消中…':'取消'}</button><button className="button primary" disabled={!!busy||missing.length>0} onClick={onSend}>{isCreating?'确认并加入待处理业务':'保存字段修改'}</button></footer></section></div>;
}

function HomePage({sales,selectedId,setSelectedId}){
  const [searchInput,setSearchInput]=useState(''),[query,setQuery]=useState('');
  const customer=sales.customers.find(c=>c.id===selectedId)||sales.customers[0];
  const needle=query.trim().toLowerCase();
  const visibleCustomers=sales.customers.filter(item=>!needle||[item.name,item.certificate_no,item.mobile,item.email].some(value=>String(value||'').toLowerCase().includes(needle)));
  const inputNeedle=searchInput.trim().toLowerCase();
  const customerStartsWith=(item,value)=>[item.name,item.certificate_no,String(item.certificate_no||'').slice(-4),item.mobile,item.email].some(field=>String(field||'').toLowerCase().startsWith(value));
  const searchSuggestions=inputNeedle?sales.customers.filter(item=>customerStartsWith(item,inputNeedle)).map(item=>({key:item.id,value:item.name,primary:item.name,secondary:`证件尾号 ${String(item.certificate_no||'').slice(-4)}`})):[];
  const currentHoldings=sales.holdings.filter(isCurrentHolding);
  const holdings=customer?currentHoldings.filter(h=>h.customer_id===customer.id):[];
  const customerMarket=holdings.reduce((sum,h)=>sum+(Number(h.volume||0)+Number(h.frozen_volume||0))*Number(sales.funds.find(f=>f.fund_code===h.fund_code)?.nav||0),0);
  return <div className="asset-layout"><Command className="customer-list-card customer-command" shouldFilter={false}><ConfigurationSearch className="customer-data-search" query={searchInput} setQuery={setSearchInput} onSearch={setQuery} searchSuggestions={searchSuggestions} searchPlaceholder=""/><Command.List className="customer-list">{visibleCustomers.map(c=><Command.Item key={c.id} value={c.id} className={c.id===customer?.id?'active':''} onSelect={()=>setSelectedId(c.id)}><div className="avatar">{c.name.slice(0,1)}</div><div className="customer-name"><strong>{c.name}</strong></div><Badge status={c.open_status}/></Command.Item>)}{query&&visibleCustomers.length===0&&<Command.Empty className="customer-search-empty">没有符合条件的客户</Command.Empty>}</Command.List></Command>
    <section className="customer-detail">{customer?<><div className="customer-hero"><div><div className="hero-name"><h2>{customer.name}</h2><Badge status={customer.open_status}/></div><p>个人投资者 · 中国居民身份证 {customer.certificate_no.slice(0,4)}********{customer.certificate_no.slice(-4)}</p></div><div className="hero-metrics"><span>总资产<strong>¥ {money(Number(customer.balance)+customerMarket)}</strong></span><span>可用余额<strong>¥ {money(Number(customer.balance)-Number(customer.frozen_balance))}</strong></span><span>冻结资金<strong>¥ {money(customer.frozen_balance)}</strong></span></div></div><div className="holdings-card"><div className="card-heading"><h2>基金持仓明细</h2></div><div className="holdings-head"><span>基金</span><span>持有份额</span><span>最新净值</span><span>市值</span><span>对账状态</span></div>{holdings.length?holdings.map(h=>{const f=sales.funds.find(x=>x.fund_code===h.fund_code),totalVolume=Number(h.volume||0)+Number(h.frozen_volume||0);return <div className="holding-row" key={h.fund_code}><div><strong>{f?.fund_name||h.fund_code}</strong><small>{h.fund_code}</small></div><span>{money(totalVolume)} 份</span><span>{Number(f?.nav||0).toFixed(4)}</span><span>¥ {money(totalVolume*Number(f?.nav||0))}</span><Badge status={h.recon_status}/></div>}):<Empty>该客户暂无基金持仓。</Empty>}</div></>:<Empty>还没有客户，请在配置管理中新增。</Empty>}</section></div>;
}

function TransactionApplicationForm({sales,customer,form,setForm,busy,run,onCreateOrder}){
  if(customer&&customer.open_status!=='OPENED'){
    const statusCopy={
      NOT_OPENED:['尚未发起开户','请先点击上方“发起开户申请”。'],
      OPEN_PENDING:['开户申请已提交','下一步：点击“销售封批并发送 T 日 01/03”。'],
      OPEN_SENT:['开户申请已发送','下一步：TA 接收 01；到 T+1 处理并返回 02。'],
      OPEN_FAILED:['开户失败','可重新发起开户申请。'],
      CLOSED:['基金账户已销户','当前客户不能提交基金交易申请。']
    };
    const [title,detail]=statusCopy[customer.open_status]||['当前不可交易','请先完成基金账户开户流程。'];
    return <section className="transaction-application-form"><div className="balance-hint"><strong>{title}</strong><small>{detail}</small></div>{customer.open_status==='OPEN_FAILED'&&<Button disabled={!!busy} onClick={()=>run(`${customer.name}重新发起开户`,()=>api(SALES,`/customers/${customer.id}/open`,{method:'POST'}))}>重新发起开户申请</Button>}{['OPEN_PENDING','OPEN_SENT'].includes(customer.open_status)&&<Button tone="secondary" disabled>{customer.open_status==='OPEN_PENDING'?'开户申请待封批':'开户申请等待 T+1 确认'}</Button>}</section>;
  }
  const business=TRANSACTION_BUSINESSES[form.businessCode],values=form.values||{};
  const setValue=(name,value)=>setForm(current=>({...current,values:{...current.values,[name]:value}}));
  const holdings=customer?sales.holdings.filter(item=>item.customer_id===customer.id):[];
  const holdingFunds=new Set(holdings.map(item=>item.fund_code));
  const fundOptions=form.businessCode==='020'?sales.funds.filter(item=>item.fund_status==='1'):['024','026','029','031','032','036'].includes(form.businessCode)?sales.funds.filter(item=>holdingFunds.has(item.fund_code)):form.businessCode==='022'?sales.funds.filter(item=>item.fund_status==='0'):sales.funds;
  const selectedFundCode=fundOptions.some(item=>item.fund_code===values.FundCode)?values.FundCode:(fundOptions[0]?.fund_code||'');
  const targetFundOptions=sales.funds.filter(item=>item.fund_code!==selectedFundCode&&item.fund_status==='0');
  const selectedTargetFundCode=targetFundOptions.some(item=>item.fund_code===values.CodeOfTargetFund)?values.CodeOfTargetFund:(targetFundOptions[0]?.fund_code||'');
  const distributorOptions=(sales.distributors||[]).filter(item=>item.status==='ENABLED'&&!Number(item.is_local));
  const selectedDistributorCode=distributorOptions.some(item=>item.distributor_code===values.TargetDistributorCode)?values.TargetDistributorCode:(distributorOptions[0]?.distributor_code||'');
  const cancelable=sales.orders.filter(item=>item.customer_id===customer?.id&&item.status==='SENT'&&item.business_code!=='052');
  const renderInput=name=>{const meta=TRANSACTION_FIELD_INPUTS[name];if(meta.type==='fund')return <Dropdown disabled={!fundOptions.length} value={selectedFundCode} onChange={event=>setValue(name,event.target.value)}>{fundOptions.length?fundOptions.map(fund=><option key={fund.fund_code} value={fund.fund_code}>{fund.fund_code} · {fund.fund_name}</option>):<option value="" disabled>{form.businessCode==='020'?'暂无可认购基金':'暂无可用基金'}</option>}</Dropdown>;if(meta.type==='targetFund')return <Dropdown disabled={!targetFundOptions.length} value={selectedTargetFundCode} onChange={event=>setValue(name,event.target.value)}>{targetFundOptions.length?targetFundOptions.map(fund=><option key={fund.fund_code} value={fund.fund_code}>{fund.fund_code} · {fund.fund_name}</option>):<option value="" disabled>暂无可转换的目标基金</option>}</Dropdown>;if(meta.type==='distributor')return <Dropdown disabled={!distributorOptions.length} value={selectedDistributorCode} onChange={event=>setValue(name,event.target.value)}>{distributorOptions.length?distributorOptions.map(item=><option key={item.distributor_code} value={item.distributor_code}>{item.distributor_name}（{item.distributor_code}）</option>):<option value="" disabled>暂无外部销售机构</option>}</Dropdown>;if(meta.type==='order')return <Dropdown value={values[name]||''} onChange={event=>setValue(name,event.target.value)}><option value="">请选择原申请</option>{cancelable.map(item=><option key={item.app_no} value={item.app_no}>{item.app_no} · {item.business_code} {TRANSACTION_BUSINESSES[item.business_code]?.name}</option>)}</Dropdown>;if(meta.type==='select')return <Dropdown value={values[name]||meta.options[0][0]} onChange={event=>setValue(name,event.target.value)}>{meta.options.map(([value,label])=><option key={value} value={value}>{label}（{value}）</option>)}</Dropdown>;return <input type={meta.type} min={meta.min} step={meta.step} maxLength={meta.maxLength} value={values[name]??''} onChange={event=>setValue(name,meta.numeric?event.target.value.replace(/\D/g,''):event.target.value)}/>};
  const effectiveValues={...values,FundCode:selectedFundCode,CodeOfTargetFund:selectedTargetFundCode,TargetDistributorCode:selectedDistributorCode};
  const complete=!!customer&&business.inputs.every(name=>String(effectiveValues[name]??'').trim()!==''&&(!['ApplicationAmount','ApplicationVol'].includes(name)||Number(effectiveValues[name])>0));
  const submit=()=>onCreateOrder({customer,businessCode:form.businessCode,values:effectiveValues});
  return <section className="transaction-application-form"><label>交易申请<Dropdown value={form.businessCode} onChange={event=>setForm(current=>({...current,businessCode:event.target.value}))}>{Object.entries(TRANSACTION_BUSINESSES).map(([code,item])=><option key={code} value={code}>{item.name}</option>)}</Dropdown></label><div className="transaction-required-fields">{business.inputs.map(name=><label key={name}>{TRANSACTION_FIELD_INPUTS[name].label}{renderInput(name)}</label>)}</div><Button disabled={!!busy||!complete} onClick={submit}>检查协议字段</Button></section>;
}

function RunStatusDialog({run,onClose}){
  const complete=run.status!=='running';
  return <div className="run-layer"><section className="run-dialog" role="dialog" aria-modal="true"><header><div><span className={`run-kicker ${run.status}`}>{run.status==='running'?'执行中':run.status==='succeeded'?'已完成':'失败'}</span><h2>{formatDate(run.business_date)} · T+1</h2></div>{complete&&<button onClick={onClose} aria-label="关闭"><X/></button>}</header><div className="run-progress">{run.steps.map((step,index)=><div className={`run-step ${step.status}`} key={step.id}><span>{step.status==='succeeded'?<CheckCircle2/>:step.status==='failed'?<AlertTriangle/>:<b>{index+1}</b>}</span><div><strong>{step.label}</strong><small>{step.status==='waiting'?'等待':step.status==='running'?'执行中':step.status==='succeeded'?'完成':String(step.detail||'失败')}</small></div></div>)}</div>{complete&&<footer><span/><button className="button primary" onClick={onClose}>关闭</button></footer>}</section></div>;
}

function WorkbenchPage({sales,busy,run,orderForm,setOrderForm,filterDate,setFilterDate,dayOrders,dayAccountApplications,onAccountBusiness,onCreateOrder,onEditFile,onRun,draftEdits}){
  const customer=sales.customers.find(item=>item.id===orderForm.customerId);
  const activeAccountApplication=customer?sales.accountApplications.find(item=>item.customer_id===customer.id&&['PENDING','SENT'].includes(item.status)):null;
  const pendingAccounts=dayAccountApplications.filter(item=>item.status==='PENDING');
  const pendingOrders=dayOrders.filter(item=>item.status==='PENDING');
  const accountPool=pendingAccounts.map(item=>({id:item.id,fileType:'01',businessId:item.id,code:item.business_code,name:ACCOUNT_BUSINESSES[item.business_code]||'账户业务',customer:sales.customers.find(c=>c.id===item.customer_id),detail:item.app_no,status:draftEdits['01']?'已调整字段':'待封批'}));
  const transactionPool=pendingOrders.map(item=>({id:item.id,fileType:'03',businessId:item.id,code:item.business_code||'022',name:TRANSACTION_BUSINESSES[item.business_code||'022']?.name||'交易',customer:sales.customers.find(c=>c.id===item.customer_id),detail:Number(item.amount)>0?`¥ ${money(item.amount)}`:`${money(item.application_vol)} 份`,status:draftEdits['03']?'已调整字段':'待封批'}));
  const poolGroups=[
    {id:'account',label:'账户业务',description:'开户与账户变更',items:accountPool},
    {id:'transaction',label:'交易业务',description:'申购、赎回及其他基金交易',items:transactionPool}
  ].filter(group=>group.items.length);
  const pool=[...accountPool,...transactionPool];
  return <div className="factory-page">
    <section className="factory-compose">
      <div className="factory-section-heading"><div><span className="eyebrow">BUSINESS INPUT</span><h2>今日业务</h2></div></div>
      <div className="factory-form-grid"><label>客户<Dropdown value={orderForm.customerId} onChange={event=>setOrderForm(current=>({...current,customerId:event.target.value}))}>{sales.customers.map(item=><option key={item.id} value={item.id}>{item.name}{item.open_status==='NOT_OPENED'?'（未开户）':''}</option>)}</Dropdown></label></div>
      {customer?.open_status==='NOT_OPENED'&&<button className="factory-secondary-action" disabled={!!busy} onClick={()=>run(`${customer.name}发起开户`,()=>api(SALES,`/customers/${customer.id}/open`,{method:'POST'}))}><span><strong>开户</strong></span></button>}
      {customer?.open_status==='OPENED'&&<button className="factory-secondary-action" disabled={!!busy||!!activeAccountApplication} onClick={()=>onAccountBusiness(customer)}><span><strong>{activeAccountApplication?'账户业务待处理':'账户管理'}</strong></span></button>}
      <TransactionApplicationForm sales={sales} customer={customer} form={orderForm} setForm={setOrderForm} busy={busy} run={run} onCreateOrder={onCreateOrder}/>
    </section>
    <section className="business-pool">
      <div className="factory-section-heading"><div><span className="eyebrow">TODAY'S POOL</span><h2>待处理业务</h2></div><div className="pool-heading-actions"><label className="pool-date"><CalendarDays size={16}/><input aria-label="业务日期" type="date" value={filterDate} onChange={event=>setFilterDate(event.target.value)}/></label></div></div>
      {pool.length?<><div className="pool-list">{poolGroups.map(group=><section className="pool-group" key={group.id}><header><div><strong>{group.label}</strong><small>{group.description}</small></div><span>{group.items.length} 笔</span></header>{group.items.map(item=><button key={`${item.fileType}-${item.id}`} onClick={()=>onEditFile(item.fileType,item.businessId)}><span className={`file-pill file-${item.fileType}`}><FileText size={22}/></span><div><strong>{item.customer?.name||'未知客户'} · {item.name}</strong><small>{item.detail} · {item.status} · {item.code}</small></div><ChevronRight size={20}/></button>)}</section>)}</div><div className="pool-runbar pool-runbar-action-only"><button disabled={!!busy} onClick={onRun}><Play size={17} fill="currentColor"/>启动运行</button></div></>:<div className="factory-empty"><div><Plus/></div><strong>今天还没有待处理业务</strong><p>从左侧选择模拟客户并添加开户、申购或赎回等业务。</p></div>}
    </section>
  </div>;
}

const FIELD_LABELS={Address:'联系地址',AppSheetSerialNo:'申请单编号',CertificateType:'证件类型',CertificateNo:'证件号码',InvestorName:'投资者姓名',TransactionDate:'交易申请日期',TransactionCfmDate:'交易确认日期',TransactionTime:'交易时间',IndividualOrInstitution:'个人/机构标志',PostCode:'邮政编码',TransactionAccountID:'销售交易账号',DistributorCode:'销售机构代码',BusinessCode:'业务代码',InvestorsBirthday:'投资者生日',DepositAcct:'银行账号',RegionCode:'地区代码',EmailAddress:'电子邮箱',VocationCode:'职业代码',AnnualIncome:'年收入',MobileTelNo:'手机号码',BranchCode:'网点代码',Sex:'性别',TradingMethod:'交易方式',MultiAcctFlag:'多账户标志',AcctNameOfInvestorInClearingAgency:'银行账户户名',AcctNoOfInvestorInClearingAgency:'银行账户号码',ClearingAgency:'结算机构',Nationality:'国籍',CertValidDate:'证件有效期',ClientRiskRate:'客户风险等级',AcceptMethod:'受理方式',IPAddress:'IP地址',ReturnCode:'返回代码',TAAccountID:'TA基金账号',TASerialNO:'TA流水号',FromTAFlag:'TA发起标志',ErrorDetail:'错误说明',FundCode:'基金代码',ApplicationAmount:'申请金额',DiscountRateOfCommission:'手续费折扣率',CurrencyType:'币种',ShareClass:'份额类别',ChargeType:'收费方式',ConfirmedVol:'确认份额',ConfirmedAmount:'确认金额',BusinessFinishFlag:'业务完成标志',DownLoaddate:'下发日期',Charge:'手续费',AgencyFee:'销售服务费',NAV:'基金单位净值',RateFee:'费率',TransferFee:'过户费',TotalTransFee:'交易总费用',FeeCalculator:'费用计算标志',ShareRegisterDate:'份额登记日期',FundVolBalance:'基金份额余额'};
const CODE_LABELS={BusinessCode:{...Object.fromEntries(Object.entries(ACCOUNT_BUSINESSES).flatMap(([code,label])=>[[code,`${label}申请`],[String(100+Number(code)).padStart(3,'0'),`${label}确认`]])),'022':'申购申请','122':'申购确认'},ReturnCode:{'0000':'成功','0013':'账户已存在','0100':'证件号码错误','0101':'证件号码重复','0108':'证件类型非法','0139':'申请单编号非法','0201':'基金代码非法','0205':'申请金额非法','0228':'基金停止申购','0241':'基金账户状态不正常','0316':'基金账户不存在','0317':'账户状态不允许','0318':'交易账户不存在','0319':'交易账户已存在','0320':'最后交易账户不能撤销','0321':'存在份额不能销户','0363':'账户信息未改动','9999':'人工模拟失败'},CertificateType:{'0':'中国居民身份证'},IndividualOrInstitution:{'1':'个人','0':'机构'},CurrencyType:{'156':'人民币'},Sex:{'1':'男','0':'女'},MultiAcctFlag:{'0':'否','1':'是'},FromTAFlag:{'0':'否','1':'是'},BusinessFinishFlag:{'1':'已完成','0':'未完成'},ShareClass:{'0':'默认份额类别'},ChargeType:{'0':'前端收费','1':'后端收费'}};
Object.assign(FIELD_LABELS,{ApplicationVol:'申请基金份额',LargeRedemptionFlag:'巨额赎回处理标志',OriginalAppSheetNo:'原申请单编号',OriginalSerialNo:'TA原确认流水号',TargetDistributorCode:'对方销售机构代码',TargetBranchCode:'对方网点号',TargetTransactionAccountID:'目标交易账号',TargetRegionCode:'变更后的地区编号',CodeOfTargetFund:'目标基金代码',CfmVolOfTargetFund:'目标基金确认份额',TargetNAV:'目标基金净值',TargetShareType:'目标基金份额类别',BackenloadDiscount:'补差费折扣率',ChangeFee:'转换费',RecuperateFee:'补差费',DefDividendMethod:'默认分红方式',FrozenCause:'冻结原因'});
Object.assign(FIELD_LABELS,{OriginalSubsDate:'原申购日期',ValidPeriod:'交易申请有效天数',RedemptionDateInAdvance:'预约赎回日期',DateOfPeriodicSubs:'定期定额申购日期',TermOfPeriodicSubs:'定期定额申购期限',FutureBuyDate:'指定申购日期',DividendRatio:'红利比例',Specification:'摘要 / 说明',OriginalCfmDate:'TA原确认日期',DetailFlag:'明细标志',OriginalAppDate:'原申请日期',FreezingDeadline:'冻结截止日期',VarietyCodeOfPeriodicSubs:'定时定额品种代码',SerialNoOfPeriodicSubs:'定时定额申购序号',TakeIncomeFlag:'带走收益标志',LargeBuyFlag:'巨额购买处理标志',SpecifyRateFee:'指定费率',SpecifyFee:'指定费用'});
for(const [code,item] of Object.entries(TRANSACTION_BUSINESSES)){CODE_LABELS.BusinessCode[code]=`${item.name}申请`;if(item.confirmationCode)CODE_LABELS.BusinessCode[item.confirmationCode]=`${item.name}确认`;}
const protocolValue=(name,value)=>{if(value===null||value===undefined||value==='')return '空值';if(CODE_LABELS[name]?.[value])return CODE_LABELS[name][value];if(/Date$|Birthday$|DownLoaddate/.test(name)&&/^\d{8}$/.test(value))return formatDate(value);if(name==='TransactionTime'&&/^\d{6}$/.test(value))return `${value.slice(0,2)}:${value.slice(2,4)}:${value.slice(4)}`;if(['ApplicationAmount','ConfirmedAmount','Charge','AgencyFee','TransferFee','TotalTransFee'].includes(name))return `人民币 ${money(value)} 元`;if(['ConfirmedVol','FundVolBalance'].includes(name))return `${money(value)} 份`;if(name==='NAV')return `净值 ${Number(value).toFixed(4)}`;return String(value)};

function DailyIndexDownloadButton({date,indexes,onOpen}){
  if(!indexes.length)return null;
  return <button type="button" className="date-index-download" aria-haspopup="dialog" onClick={()=>onOpen({date,indexes})}><Download size={15}/><span>下载索引文件</span></button>;
}

function DailyIndexDownloadDialog({date,indexes,onClose}){
  return <div className="daily-index-layer" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><section className="daily-index-dialog" role="dialog" aria-modal="true" aria-labelledby="daily-index-title"><header><div><small>{formatDate(date)}</small><h2 id="daily-index-title">下载当天索引文件</h2></div><button type="button" onClick={onClose} aria-label="关闭"><X size={19}/></button></header><div className="daily-index-list">{indexes.map(({item,name})=><a key={`${item.apiBase}-${name}`} href={`${item.apiBase}/batches/${item.id}/files/${encodeURIComponent(name)}`} download={name}><span className="daily-index-type">{name.startsWith('OFI_')?'OFI':'OFJ'}</span><span><strong>{name}</strong><small>{item.direction==='sales-to-ta'?'销售 → TA':'TA → 销售'}</small></span><Download size={17}/></a>)}</div></section></div>;
}

function TransactionRecordsPage({sales,ta}){
  const [dateRange,setDateRange]=useState({start:'',end:''});
  const [selectedBatch,setSelectedBatch]=useState(null);
  const [batchDetail,setBatchDetail]=useState(null);
  const [indexDialog,setIndexDialog]=useState(null);
  const outbound=[
    ...sales.batches.filter(item=>item.direction==='sales-to-ta').map(item=>({...item,system:'销售系统',apiBase:SALES})),
    ...ta.batches.filter(item=>item.direction==='ta-to-sales').map(item=>({...item,system:'TA系统',apiBase:TA}))
  ].sort((a,b)=>String(b.business_date).localeCompare(String(a.business_date))||String(b.created_at).localeCompare(String(a.created_at)));
  const availableDates=[...new Set(outbound.map(item=>item.business_date))].sort((a,b)=>b.localeCompare(a));
  const earliestDate=formatDate(availableDates.at(-1)||'');
  const latestDate=formatDate(availableDates[0]||'');
  const visible=outbound.filter(item=>(!dateRange.start||item.business_date>=compactDate(dateRange.start))&&(!dateRange.end||item.business_date<=compactDate(dateRange.end)));
  const groups=Object.entries(visible.reduce((result,item)=>{(result[item.business_date]??=[]).push(item);return result},{})).sort(([a],[b])=>b.localeCompare(a));
  const dailyIndexes=items=>[...new Map(items.map(item=>{const name=batchIndexFileName(item);return [`${item.apiBase}:${name}`,{item,name}]})).values()];
  const setRangeStart=start=>setDateRange(current=>({start,end:current.end&&start>current.end?start:current.end}));
  const setRangeEnd=end=>setDateRange(current=>({start:current.start&&end<current.start?end:current.start,end}));
  const openBatch=async(batch)=>{setSelectedBatch(batch);setBatchDetail({loading:true});try{setBatchDetail({loading:false,content:await api(batch.apiBase,`/batches/${batch.id}/content`)})}catch(error){setBatchDetail({loading:false,error:error.message})}};
  return <><section className="file-overview"><header><div className="date-range-filter"><CalendarDays size={17}/><input aria-label="开始日期" type="date" min={earliestDate} max={dateRange.end||latestDate} value={dateRange.start} onChange={event=>setRangeStart(event.target.value)}/><span>至</span><input aria-label="结束日期" type="date" min={dateRange.start||earliestDate} max={latestDate} value={dateRange.end} onChange={event=>setRangeEnd(event.target.value)}/>{(dateRange.start||dateRange.end)&&<button type="button" aria-label="清除日期范围" title="清除日期范围" onClick={()=>setDateRange({start:'',end:''})}><X size={15}/></button>}</div></header>{groups.length?<div className="file-date-groups">{groups.map(([date,items])=><section key={date}><header><div><CalendarDays size={17}/><strong>{formatDate(date)}</strong></div><div className="date-index-actions"><DailyIndexDownloadButton date={date} indexes={dailyIndexes(items)} onOpen={setIndexDialog}/></div></header><div className="file-list-head"><span>文件</span><span>类型</span><span>方向</span><span>批次</span><span>记录</span><span>状态</span></div>{items.map(item=><button className="file-list-row" key={`${item.system}-${item.id}`} onClick={()=>openBatch(item)}><span><b>{item.file_type}</b><strong>{batchDataFileName(item)}</strong></span><span className="file-business-type">{FILE_NAMES[item.file_type]||'交换文件'}</span><span>{item.direction==='sales-to-ta'?'销售 → TA':'TA → 销售'}</span><code>{item.batch_id}</code><span>{item.record_count}</span><Badge status={item.status}/></button>)}</section>)}</div>:<Empty>所选日期范围内没有文件。</Empty>}</section>{indexDialog&&<DailyIndexDownloadDialog {...indexDialog} onClose={()=>setIndexDialog(null)}/>} {selectedBatch&&<BatchProtocolDetailPage systemName={selectedBatch.system} batch={selectedBatch} detail={batchDetail} onClose={()=>{setSelectedBatch(null);setBatchDetail(null)}}/>}</>;
}

function ProtocolDocument({doc,copied,copy}){
  if(!doc||doc.missing)return <Empty>该协议文件尚未生成。完成对应的发送步骤后即可在这里查看。</Empty>;
  const {dataFile,indexFile,record}=doc;
  const fields=dataFile.fields.map(f=>({...f,value:record.values[f.name]}));
  return <div className="protocol-document"><div className="document-heading"><div><h3>{dataFile.name}</h3></div></div>
    <section className="protocol-section"><h4>文件头</h4><div className="header-grid"><span>文件标识<strong>{dataFile.header.marker}</strong></span><span>协议版本<strong>{dataFile.header.version}</strong></span><span>发送方<strong>{dataFile.header.creator}</strong></span><span>接收方<strong>{dataFile.header.receiver}</strong></span><span>业务日期<strong>{formatDate(dataFile.header.date)}</strong></span><span>字段数量<strong>{dataFile.header.fieldCount}</strong></span></div></section>
    <section className="protocol-section"><div className="section-title"><h4>本笔数据记录与中文翻译</h4><code>字节长度 {dataFile.fields.reduce((n,f)=>n+f.length,0)}</code></div><div className="field-table"><div className="field-head"><span>位置</span><span>协议字段</span><span>中文含义</span><span>原始值</span><span>翻译 / 解释</span></div>{fields.map(f=><div className="field-row" key={f.name}><span>{f.start}–{f.end}<small>{f.length} 字节</small></span><code>{f.name}</code><strong>{FIELD_LABELS[f.name]||f.name}</strong><code>{f.value??'〈空〉'}</code><span>{protocolValue(f.name,f.value)}</span></div>)}</div><div className="raw-record"><div><strong>固定长度记录原文</strong><button onClick={()=>copy('record2',record.raw)}><Copy size={14}/>{copied==='record2'?'已复制':'复制'}</button></div><pre>{record.raw}</pre></div></section>
    <section className="protocol-section compact"><h4>文件尾</h4><code>{dataFile.footer}</code></section>
    <details className="raw-file"><summary>查看完整数据文件（含文件头、字段清单、全部记录与文件尾）</summary><div><button className="copy-button" onClick={()=>copy('file',dataFile.rawText)}><Copy size={15}/>{copied==='file'?'已复制':'复制完整文件'}</button><pre>{dataFile.rawText}</pre></div></details>
    {indexFile&&<details className="raw-file"><summary>查看索引文件 {indexFile.name}</summary><div className="index-explain"><p>索引文件用于声明本批次包含哪些数据文件。接收方先读取索引，再按清单校验和读取数据文件。</p><div className="header-grid"><span>索引标识<strong>{indexFile.header.marker}</strong></span><span>协议版本<strong>{indexFile.header.version}</strong></span><span>文件数量<strong>{indexFile.fileCount}</strong></span><span>数据文件<strong>{indexFile.fileNames.join('、')}</strong></span></div><button className="copy-button" onClick={()=>copy('index',indexFile.rawText)}><Copy size={15}/>{copied==='index'?'已复制':'复制索引文件'}</button><pre>{indexFile.rawText}</pre></div></details>}
  </div>;
}

function BatchProtocolDetailPage({systemName,batch,detail,onClose}){
  const [copied,setCopied]=useState('');
  const copy=async(key,text)=>{await navigator.clipboard.writeText(text||'');setCopied(key);setTimeout(()=>setCopied(''),1500)};
  const dataFile=detail?.content?.files?.find(f=>f.kind==='data'&&f.header?.fileType===batch?.file_type)||detail?.content?.files?.find(f=>f.kind==='data');
  const indexFile=detail?.content?.files?.find(f=>f.kind==='index');
  const records=dataFile?.records||[];
  const record=records[0];
  const doc=dataFile&&record?{type:batch.file_type,batch:{...batch,...(detail?.content?.batch||{}),system:systemName},dataFile,indexFile,record}:null;
  const downloadUrl=name=>`${batch.apiBase}/batches/${batch.id}/files/${encodeURIComponent(name)}`;
  return <div className="transaction-detail-page"><header className="detail-header"><div className="detail-header-inner"><div className="detail-heading"><h2>{batch.file_type} {FILE_NAMES[batch.file_type]||'交换文件'}</h2></div><div className="detail-actions">{dataFile&&<a className="download-button" href={downloadUrl(dataFile.name)} download={dataFile.name}><Download size={16}/><span>下载数据文件</span></a>}<Badge status={batch.status}/><button className="detail-close" onClick={onClose} aria-label="关闭详情" title="关闭详情"><X size={20}/></button></div></div></header>
    <main className="detail-content">{detail?.loading?<div className="detail-loading"><Database className="spin"/>正在读取实际交换文件…</div>:detail?.error?<Empty>读取协议文件失败：{detail.error}</Empty>:doc?<ProtocolDocument doc={doc} copied={copied} copy={copy}/>:<Empty>该批次没有可展示的数据文件。</Empty>}</main>
  </div>;
}

function ConfigurationSearch({className='',query,setQuery,onSearch,searchPlaceholder,searchSuggestions=[]}){
  const searchRef=useRef(null),[suggestionsOpen,setSuggestionsOpen]=useState(false),[activeSuggestion,setActiveSuggestion]=useState(-1);
  const visibleSuggestions=query.trim()&&suggestionsOpen?searchSuggestions.slice(0,8):[];
  useEffect(()=>{
    const close=event=>{if(!searchRef.current?.contains(event.target)){setSuggestionsOpen(false);setActiveSuggestion(-1);}};
    document.addEventListener('pointerdown',close);
    return()=>document.removeEventListener('pointerdown',close);
  },[]);
  useEffect(()=>setActiveSuggestion(-1),[query]);
  const submit=value=>{const next=value??query;setQuery(next);setSuggestionsOpen(false);setActiveSuggestion(-1);onSearch(next);};
  const onSearchKeyDown=event=>{
    if(event.key==='ArrowDown'&&visibleSuggestions.length){event.preventDefault();setActiveSuggestion(current=>(current+1)%visibleSuggestions.length);}
    else if(event.key==='ArrowUp'&&visibleSuggestions.length){event.preventDefault();setActiveSuggestion(current=>current<=0?visibleSuggestions.length-1:current-1);}
    else if(event.key==='Enter'&&activeSuggestion>=0){event.preventDefault();submit(visibleSuggestions[activeSuggestion].value);}
    else if(event.key==='Escape'){setSuggestionsOpen(false);setActiveSuggestion(-1);}
  };
  return <form ref={searchRef} className={`configuration-search ${className}`.trim()} onSubmit={event=>{event.preventDefault();submit();}}><div className="configuration-search-field"><Search size={16}/><input role="combobox" aria-label={searchPlaceholder||"搜索"} aria-autocomplete="list" aria-expanded={visibleSuggestions.length>0} value={query} onFocus={()=>setSuggestionsOpen(true)} onChange={e=>{setQuery(e.target.value);setSuggestionsOpen(true);}} onKeyDown={onSearchKeyDown} placeholder={searchPlaceholder}/>{visibleSuggestions.length>0&&<div className="configuration-search-suggestions" role="listbox">{visibleSuggestions.map((suggestion,index)=><button type="button" role="option" aria-selected={index===activeSuggestion} className={index===activeSuggestion?'active':''} key={suggestion.key||suggestion.value} onMouseDown={event=>event.preventDefault()} onMouseEnter={()=>setActiveSuggestion(index)} onClick={()=>submit(suggestion.value)}><Search size={14}/><span><strong>{suggestion.primary}</strong>{suggestion.secondary&&<small>{suggestion.secondary}</small>}</span></button>)}</div>}</div><button type="submit">搜索</button></form>;
}

function ConfigurationBoard({title,subtitle,icon:Icon,count,query,setQuery,onSearch,searchPlaceholder,searchSuggestions=[],onAdd,columns,children}){
  return <section className="configuration-board"><header><div className="configuration-heading"><span>{Icon&&<Icon size={20}/>}</span><div><h2>{title}</h2><p>{subtitle}</p></div></div>{onAdd&&<Button icon={Plus} onClick={onAdd}>新增记录</Button>}</header><div className="configuration-toolbar"><ConfigurationSearch query={query} setQuery={setQuery} onSearch={onSearch} searchPlaceholder={searchPlaceholder} searchSuggestions={searchSuggestions}/><span>共 {count} 条记录</span></div><div className="configuration-table"><div className="configuration-table-head" style={{gridTemplateColumns:columns.map(column=>column.width||'1fr').join(' ')}}>{columns.map(column=><span key={column.label}>{column.label}</span>)}</div>{children}</div></section>;
}

function ConfigurationRow({columns,children}){
  return <div className="configuration-row" style={{gridTemplateColumns:columns.map(column=>column.width||'1fr').join(' ')}}>{children}</div>;
}

function ConfigurationEditor({title,subtitle,busy,valid=true,onClose,onSave,children}){
  return <div className="configuration-modal-layer" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><section className="configuration-modal" role="dialog" aria-modal="true" aria-label={title}><header><div><small>{subtitle}</small><h2>{title}</h2></div><button onClick={onClose} aria-label="关闭"><X size={19}/></button></header><div className="configuration-modal-body">{children}</div><footer><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={!!busy||!valid} onClick={onSave}>{busy?'保存中…':'保存记录'}</button></footer></section></div>;
}

function CustomerHoldingsDialog({customer,sales,onClose}){
  const holdings=sales.holdings.filter(holding=>holding.customer_id===customer.id&&isCurrentHolding(holding));
  const rows=holdings.map(holding=>{
    const fund=sales.funds.find(item=>item.fund_code===holding.fund_code);
    const volume=Number(holding.volume||0)+Number(holding.frozen_volume||0);
    const nav=Number(fund?.nav||0);
    return {holding,fund,volume,nav,marketValue:volume*nav};
  });
  const marketValue=rows.reduce((total,row)=>total+row.marketValue,0);
  return <div className="configuration-modal-layer" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><section className="holdings-dialog" role="dialog" aria-modal="true" aria-label={`${customer.name}的基金持仓明细`}><header><div><small>{customer.name} · 证件尾号 {String(customer.certificate_no||'').slice(-4)}</small><h2>基金持仓明细</h2></div><div className="holdings-dialog-total"><span>持仓市值</span><strong>¥ {money(marketValue)}</strong></div><button onClick={onClose} aria-label="关闭"><X size={19}/></button></header><div className="holdings-dialog-body"><div className="holdings-dialog-head"><span>基金</span><span>持有份额</span><span>最新净值</span><span>市值</span><span>对账状态</span></div>{rows.length?rows.map(({holding,fund,volume,nav,marketValue:rowMarketValue})=><div className="holdings-dialog-row" key={holding.fund_code}><div><strong>{fund?.fund_name||holding.fund_code}</strong><small>{holding.fund_code}</small></div><span>{money(volume)} 份</span><span>{nav.toFixed(4)}</span><strong>¥ {money(rowMarketValue)}</strong><Badge status={holding.recon_status}/></div>):<Empty>该客户暂无基金持仓。</Empty>}</div></section></div>;
}

function ConfigSectionPage({view,sales,ta,busy,run,customerForm,setCustomerForm,distributorForm,setDistributorForm,fundForm,setFundForm,businessDate,advance,resetDate,setResetDate,reset}){
  const [editor,setEditor]=useState(null),[holdingsCustomer,setHoldingsCustomer]=useState(null),[searchInput,setSearchInput]=useState(''),[query,setQuery]=useState('');
  useEffect(()=>{setEditor(null);setHoldingsCustomer(null);setSearchInput('');setQuery('')},[view]);
  const customerColumns=[{label:'客户',width:'1.15fr'},{label:'证件号码',width:'1.35fr'},{label:'联系方式',width:'1.2fr'},{label:'风险等级',width:'.65fr'},{label:'账户状态',width:'.8fr'},{label:'可用余额',width:'1fr'},{label:'持仓明细',width:'100px'},{label:'操作',width:'86px'}];
  const distributorColumns=[{label:'机构代码',width:'.8fr'},{label:'机构名称',width:'1.5fr'},{label:'机构类型',width:'1fr'},{label:'状态',width:'.8fr'},{label:'转托管记录',width:'1fr'},{label:'操作',width:'86px'}];
  const fundColumns=[{label:'基金代码',width:'.8fr'},{label:'基金名称',width:'1.7fr'},{label:'产品类型',width:'.9fr'},{label:'单位净值',width:'.8fr'},{label:'首次申购',width:'.9fr'},{label:'申购上限',width:'1fr'},{label:'状态',width:'.8fr'},{label:'操作',width:'86px'}];
  const newCustomer=()=>({name:'',certificateNo:'',mobile:'',email:'',balance:100000,riskLevel:'3'});
  const newDistributor=()=>({code:'',name:'',status:'ENABLED'});
  const newFund=()=>({code:'',name:'',status:'0',nav:1,minFirst:100,maxPurchase:1000000,feeRate:0.015,fundType:'01',fundTypeName:'混合型',minAdditional:100,dailyMax:2000000,accumulatedNav:1,totalVolume:0,fundSize:0,managerName:'广发基金管理有限公司'});
  const editCustomer=customer=>{setCustomerForm({name:customer.name||'',certificateNo:customer.certificate_no||'',mobile:customer.mobile||'',email:customer.email||'',balance:Number(customer.balance||0),riskLevel:customer.risk_level||'3'});setEditor({type:'customer',mode:'edit',id:customer.id});};
  const editDistributor=item=>{setDistributorForm({code:item.distributor_code||'',name:item.distributor_name||'',status:item.status||'ENABLED'});setEditor({type:'distributor',mode:'edit',code:item.distributor_code});};
  const editFund=fund=>{setFundForm({code:fund.fund_code||'',name:fund.fund_name||'',status:fund.fund_status||'0',nav:Number(fund.nav||0),minFirst:Number(fund.min_first||0),maxPurchase:Number(fund.max_purchase||0),feeRate:Number(fund.fee_rate||0),fundType:fund.fund_type||'01',fundTypeName:fund.fund_type_name||'',minAdditional:Number(fund.min_additional||0),dailyMax:Number(fund.daily_max||0),accumulatedNav:Number(fund.accumulated_nav||fund.nav||0),totalVolume:Number(fund.total_volume||0),fundSize:Number(fund.fund_size||0),managerName:fund.manager_name||'广发基金管理有限公司'});setEditor({type:'fund',mode:'edit',code:fund.fund_code});};
  const saveCustomer=async()=>{const editing=editor?.mode==='edit';const ok=await run(editing?'更新客户':'新增客户',()=>api(SALES,editing?`/customers/${editor.id}`:'/customers',{method:editing?'PUT':'POST',body:customerForm}));if(ok)setEditor(null);};
  const saveDistributor=async()=>{const editing=editor?.mode==='edit',code=editing?editor.code:distributorForm.code.trim().toUpperCase();const ok=await run(editing?'更新销售机构':'新增销售机构',()=>api(SALES,`/distributors/${code}`,{method:'PUT',body:{name:distributorForm.name,status:distributorForm.status,createOnly:!editing}}));if(ok)setEditor(null);};
  const saveFund=async()=>{const editing=editor?.mode==='edit';const ok=await run(editing?'更新基金配置':'新增基金',()=>api(TA,`/funds/${editing?editor.code:fundForm.code}`,{method:'PUT',body:{...fundForm,navDate:businessDate}}));if(ok)setEditor(null);};
  if(view==='date')return <Panel title="业务日期与场景" subtitle="统一控制两个系统的模拟时间和数据基线" icon={CalendarDays}><div className="date-config"><div><small>当前业务日期</small><strong>{formatDate(businessDate)}</strong><div><Button disabled={!!busy} onClick={()=>advance(1)}>推进到 T+1 并确认</Button></div></div><div className="reset-box"><label>重置后的起始日期<input type="date" value={resetDate} onChange={e=>setResetDate(e.target.value)}/></label><Button tone="danger" icon={RotateCcw} disabled={!!busy} onClick={reset}>重置整个场景</Button><small>清空客户、订单、持仓与批次，交换文件按新场景编号隔离。</small></div></div></Panel>;
  if(view==='customer'){
    const needle=query.trim().toLowerCase(),rows=sales.customers.filter(customer=>!needle||[customer.name,customer.certificate_no,customer.mobile,customer.email].some(value=>String(value||'').toLowerCase().includes(needle)));
    return <><ConfigurationBoard title="客户列表" subtitle="销售系统客户主数据" icon={UserPlus} count={rows.length} query={searchInput} setQuery={setSearchInput} onSearch={value=>setQuery(value)} searchPlaceholder="搜索姓名、证件、手机号或邮箱" onAdd={()=>{setCustomerForm(newCustomer());setEditor({type:'customer',mode:'create'});}} columns={customerColumns}>{rows.length?rows.map(customer=><ConfigurationRow key={customer.id} columns={customerColumns}><strong>{customer.name}</strong><code>{customer.certificate_no}</code><span className="configuration-contact"><b>{customer.mobile||'—'}</b><small>{customer.email||'未填写邮箱'}</small></span><span>R{customer.risk_level||'3'}</span><Badge status={customer.open_status}/><strong>¥ {money(customer.balance)}</strong><button className="row-holdings" onClick={()=>setHoldingsCustomer(customer)}><Eye size={14}/>查看</button><button className="row-edit" onClick={()=>editCustomer(customer)}><Pencil size={14}/>编辑</button></ConfigurationRow>):<Empty>没有符合筛选条件的客户记录。</Empty>}</ConfigurationBoard>{holdingsCustomer&&<CustomerHoldingsDialog customer={holdingsCustomer} sales={sales} onClose={()=>setHoldingsCustomer(null)}/>} {editor?.type==='customer'&&<ConfigurationEditor title={editor.mode==='edit'?'编辑客户':'新增客户'} subtitle={editor.mode==='edit'?'修改销售系统客户主数据':'创建一条新的客户主数据'} busy={busy} valid={!!customerForm.name&&!!customerForm.certificateNo} onClose={()=>setEditor(null)} onSave={saveCustomer}><div className="configuration-form"><label>姓名<input autoFocus value={customerForm.name} onChange={e=>setCustomerForm({...customerForm,name:e.target.value})}/></label><label>居民身份证号<input maxLength="18" value={customerForm.certificateNo} onChange={e=>setCustomerForm({...customerForm,certificateNo:e.target.value.toUpperCase()})}/></label><label>手机号<input value={customerForm.mobile} onChange={e=>setCustomerForm({...customerForm,mobile:e.target.value})}/></label><label>邮箱<input type="email" value={customerForm.email} onChange={e=>setCustomerForm({...customerForm,email:e.target.value})}/></label><label>可用余额<input type="number" min="0" step="0.01" value={customerForm.balance} onChange={e=>setCustomerForm({...customerForm,balance:e.target.value})}/></label><label>风险等级<Dropdown value={customerForm.riskLevel} onChange={e=>setCustomerForm({...customerForm,riskLevel:e.target.value})}>{['1','2','3','4','5'].map(level=><option key={level} value={level}>R{level}</option>)}</Dropdown></label></div></ConfigurationEditor>}</>;
  }
  if(view==='distributor'){
    const needle=query.trim().toLowerCase(),rows=(sales.distributors||[]).filter(item=>!needle||[item.distributor_code,item.distributor_name].some(value=>String(value||'').toLowerCase().includes(needle)));
    return <><ConfigurationBoard title="销售机构" subtitle="转托管可选机构主数据 · 外部机构不计入蚂蚁本地持仓" icon={Landmark} count={rows.length} query={searchInput} setQuery={setSearchInput} onSearch={value=>setQuery(value)} searchPlaceholder="搜索机构代码或名称" onAdd={()=>{setDistributorForm(newDistributor());setEditor({type:'distributor',mode:'create'});}} columns={distributorColumns}>{rows.length?rows.map(item=>{const transferCount=(sales.custodyTransfers||[]).filter(transfer=>transfer.target_distributor_code===item.distributor_code).length;return <ConfigurationRow key={item.distributor_code} columns={distributorColumns}><code>{item.distributor_code}</code><strong>{item.distributor_name}</strong><span>{Number(item.is_local)?'本地销售机构':'外部销售机构'}</span><Badge status={item.status==='ENABLED'?'PROCESSED':'FAILED'}>{item.status==='ENABLED'?'启用':'停用'}</Badge><span>{transferCount} 笔</span>{Number(item.is_local)?<span>系统内置</span>:<button className="row-edit" onClick={()=>editDistributor(item)}><Pencil size={14}/>编辑</button>}</ConfigurationRow>}):<Empty>没有符合筛选条件的销售机构。</Empty>}</ConfigurationBoard>{editor?.type==='distributor'&&<ConfigurationEditor title={editor.mode==='edit'?'编辑销售机构':'新增销售机构'} subtitle="销售与 TA 两端同步的转托管机构主数据" busy={busy} valid={/^[0-9A-Z]{1,9}$/.test(distributorForm.code.trim().toUpperCase())&&!!distributorForm.name.trim()} onClose={()=>setEditor(null)} onSave={saveDistributor}><div className="configuration-form"><label>机构代码<input autoFocus maxLength="9" disabled={editor.mode==='edit'} value={distributorForm.code} onChange={e=>setDistributorForm({...distributorForm,code:e.target.value.replace(/[^0-9a-z]/gi,'').toUpperCase()})}/></label><label>机构名称<input value={distributorForm.name} onChange={e=>setDistributorForm({...distributorForm,name:e.target.value})}/></label><label>状态<Dropdown value={distributorForm.status} onChange={e=>setDistributorForm({...distributorForm,status:e.target.value})}><option value="ENABLED">启用</option><option value="DISABLED">停用</option></Dropdown></label></div></ConfigurationEditor>}</>;
  }
  const needle=query.trim().toLowerCase(),inputNeedle=searchInput.trim().toLowerCase();
  const fundStartsWith=(fund,value)=>[fund.fund_code,fund.fund_name,fund.fund_type_name].some(field=>String(field||'').toLowerCase().startsWith(value));
  const rows=ta.funds.filter(fund=>!needle||fundStartsWith(fund,needle));
  const searchSuggestions=inputNeedle?ta.funds.filter(fund=>fundStartsWith(fund,inputNeedle)).map(fund=>({key:fund.fund_code,value:String(fund.fund_name||fund.fund_code),primary:fund.fund_name,secondary:`${fund.fund_code} · ${fund.fund_type_name||'未分类'}`})):[];
  const fundStatusLabel=status=>status==='0'?'正常申购':status==='1'?'募集认购':'暂停申购';
  return <><ConfigurationBoard title="基金产品数据" subtitle="TA 系统基金产品主数据 · 修改后需重新发送 07 文件" icon={Landmark} count={rows.length} query={searchInput} setQuery={setSearchInput} onSearch={value=>setQuery(value)} searchSuggestions={searchSuggestions} searchPlaceholder="搜索基金代码、名称或类型" onAdd={()=>{setFundForm(newFund());setEditor({type:'fund',mode:'create'});}} columns={fundColumns}>{rows.length?rows.map(fund=><ConfigurationRow key={fund.fund_code} columns={fundColumns}><code>{fund.fund_code}</code><strong>{fund.fund_name}</strong><span>{fund.fund_type_name||'—'}</span><strong>{Number(fund.nav||0).toFixed(4)}</strong><span>¥ {money(fund.min_first)}</span><span>¥ {money(fund.max_purchase)}</span><Badge status={['0','1'].includes(fund.fund_status)?'PROCESSED':'FAILED'}>{fundStatusLabel(fund.fund_status)}</Badge><button className="row-edit" onClick={()=>editFund(fund)}><Pencil size={14}/>编辑</button></ConfigurationRow>):<Empty>没有符合筛选条件的基金记录。</Empty>}</ConfigurationBoard>{editor?.type==='fund'&&<ConfigurationEditor title={editor.mode==='edit'?'编辑基金':'新增基金'} subtitle={editor.mode==='edit'?`基金代码 ${editor.code} · TA 主数据`:'创建一条新的 TA 基金主数据'} busy={busy} valid={!!fundForm.code&&!!fundForm.name} onClose={()=>setEditor(null)} onSave={saveFund}><div className="configuration-form"><label>基金代码<input autoFocus maxLength="6" disabled={editor.mode==='edit'} value={fundForm.code} onChange={e=>setFundForm({...fundForm,code:e.target.value.replace(/\D/g,'')})}/></label><label>基金名称<input value={fundForm.name} onChange={e=>setFundForm({...fundForm,name:e.target.value})}/></label><label>基金状态<Dropdown value={fundForm.status} onChange={e=>setFundForm({...fundForm,status:e.target.value})}><option value="0">正常申购</option><option value="1">募集认购</option><option value="5">暂停申购</option></Dropdown></label><label>产品类型<div className="configuration-inline-fields"><input maxLength="2" value={fundForm.fundType} onChange={e=>setFundForm({...fundForm,fundType:e.target.value})}/><input value={fundForm.fundTypeName} onChange={e=>setFundForm({...fundForm,fundTypeName:e.target.value})}/></div></label><label>单位净值<input type="number" min="0" step="0.0001" value={fundForm.nav} onChange={e=>setFundForm({...fundForm,nav:e.target.value})}/></label><label>申购费率<input type="number" min="0" step="0.001" value={fundForm.feeRate} onChange={e=>setFundForm({...fundForm,feeRate:e.target.value})}/></label><label>最低首次申购<input type="number" min="0" step="0.01" value={fundForm.minFirst} onChange={e=>setFundForm({...fundForm,minFirst:e.target.value})}/></label><label>单笔申购上限<input type="number" min="0" step="0.01" value={fundForm.maxPurchase} onChange={e=>setFundForm({...fundForm,maxPurchase:e.target.value})}/></label></div></ConfigurationEditor>}</>;
}

createRoot(document.getElementById('root')).render(window.location.pathname.startsWith('/workflow')?<WorkflowApp/>:<App/>);
