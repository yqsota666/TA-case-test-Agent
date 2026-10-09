import React,{useEffect,useMemo,useState} from 'react';
import {Search,X} from './ui-icons.jsx';
import {requestCase} from './live-case-api.js';
import {CatalogGrid} from './catalog-grid.jsx';
import {recordColumns} from './catalog-model.js';
import {DistributorEditor} from './distributor-editor.jsx';
import {deliveryFormatSummary} from './distributor-format.js';
import './global-catalog.css';
const tables=[['customers','客户'],['accounts','账户'],['funds','基金'],['holdings','持仓'],['applications','申请记录'],['distributors','销售商']];
const labels={READY:'待生成',BATCHED:'已合批',GENERATED:'已生成',DELIVERED:'已发送',WAITING_RETURN:'等待回传',CONFIRMED:'已确认',FAILED:'失败',CANCELED:'已取消'};
export function catalogCell(key,value){if(key==='delivery_profile')return deliveryFormatSummary(value);if(value===null||value===undefined||value==='')return '—';if(key==='status')return labels[value]??'待处理';if(['investor_type','IndividualOrInstitution'].includes(key))return String(value)==='1'?'个人':String(value)==='0'?'机构':String(value);if(key==='created_at'&&Number.isFinite(Date.parse(value)))return new Date(value).toLocaleString('zh-CN',{hour12:false});if(typeof value==='object')return JSON.stringify(value);return String(value);}
export function GlobalDataCatalog({onOpenCase}) {
 const [editor,setEditor]=useState(null);
 const [table,setTable]=useState(tables.some(([key])=>key===new URLSearchParams(location.search).get('dataTable'))?new URLSearchParams(location.search).get('dataTable'):'customers'),[search,setSearch]=useState(''),[q,setQ]=useState(''),[offset,setOffset]=useState(0),[tick,setTick]=useState(0),[state,setState]=useState({loading:true,data:null,error:''});
 useEffect(()=>{const timer=setTimeout(()=>{setQ(search.trim());setOffset(0);},250);return()=>clearTimeout(timer);},[search]);
 useEffect(()=>{let active=true;setState(s=>({...s,loading:true,error:''}));requestCase(`/data/tables/${table}?source=draft&q=${encodeURIComponent(q)}&offset=${offset}&limit=100`).then(data=>{if(active)setState(previous=>({loading:false,data:{...data,columns:data.columns?.length?data.columns:previous.data?.columns},error:''}));}).catch(error=>{if(active)setState(previous=>({...previous,loading:false,error:error.message}));});return()=>{active=false;};},[table,q,offset,tick]);
 const data=state.data,columns=useMemo(()=>recordColumns(data?.columns),[data?.columns]);
 const title=tables.find(([key])=>key===table)?.[1]||'客户';
 return <section className="gc-page" aria-label="数据"><div className="gc-controls"><nav className="gc-tabs" aria-label="数据表">{tables.map(([key,label])=><button key={key} aria-current={table===key?'page':undefined} onClick={()=>{if(key===table)return;setTable(key);setOffset(0);setSearch('');setQ('');setState({loading:true,data:null,error:''});const url=new URL(location.href);url.searchParams.set('dataTable',key);history.replaceState(null,'',url);}}>{label}</button>)}</nav><label className="gc-search"><Search size={16}/><input aria-label={`搜索${title}`} placeholder={`搜索${title}`} value={search} maxLength={200} onChange={e=>setSearch(e.target.value)}/>{search&&<button aria-label="清除搜索" onClick={()=>setSearch('')}><X size={14}/></button>}</label></div>
 {table==='distributors'&&<div className="gc-config-controls"><button type="button" onClick={()=>setEditor({row:null})}>新增销售商</button></div>}
 <CatalogGrid columns={columns} rows={data?.rows||[]} total={data?.total||0} offset={offset} onOffset={setOffset} loading={state.loading} error={state.error} onRetry={()=>setTick(t=>t+1)} search={q} onClear={()=>setSearch('')} format={catalogCell} actions={row=>table==='distributors'?<button onClick={()=>setEditor({row})}>编辑</button>:onOpenCase&&row.chatId&&row.caseId?<button onClick={()=>onOpenCase(row.chatId,row.caseId)}>查看 Case</button>:null}/>
 {editor&&<DistributorEditor row={editor.row} onClose={()=>setEditor(null)} onSaved={()=>{setEditor(null);setSearch('');setQ('');setOffset(0);setTick(t=>t+1);}}/>}</section>;
}
