import React,{useEffect,useState} from 'react';
import {Search,X,Download} from './ui-icons.jsx';
import {requestCase} from './live-case-api.js';
import {CatalogGrid} from './catalog-grid.jsx';
import './global-catalog.css';
const downloadUrl=file=>'/live-api/files/catalog/download?'+new URLSearchParams({kind:file.kind,id:file.locator,fileName:file.fileName});
const columns=[{key:'fileName',label:'文件名称',width:310},{key:'fileType',label:'文件类型',width:100},{key:'direction',label:'方向',width:120},{key:'project',label:'项目',width:170},{key:'caseTitle',label:'Case',width:170},{key:'channelName',label:'通道',width:150},{key:'byteLength',label:'文件大小',width:120,numeric:true},{key:'createdAt',label:'时间',width:200}];
const format=(key,value)=>value===null||value===undefined||value===''?'—':key==='createdAt'?new Date(value).toLocaleString('zh-CN',{hour12:false}):key==='direction'?value==='OUTBOUND'?'申请文件':'TA回传':key==='byteLength'?`${Number(value).toLocaleString()} 字节`:String(value);
export function GlobalFileCatalog({onOpenCase}) {
 const [search,setSearch]=useState(''),[q,setQ]=useState(''),[offset,setOffset]=useState(0),[tick,setTick]=useState(0),[state,setState]=useState({loading:true,data:null,error:''});
 useEffect(()=>{const t=setTimeout(()=>{setQ(search.trim());setOffset(0);},250);return()=>clearTimeout(t);},[search]);
 useEffect(()=>{let active=true;setState(s=>({...s,loading:true,error:''}));requestCase(`/files/catalog?q=${encodeURIComponent(q)}&offset=${offset}&limit=100`).then(data=>{if(active)setState({loading:false,data,error:''});}).catch(error=>{if(active)setState(previous=>({...previous,loading:false,error:error.message}));});return()=>{active=false;};},[q,offset,tick]);
 const data=state.data;
 return <section className="gc-page" aria-label="文件"><div className="gc-controls"><label className="gc-search"><Search size={16}/><input aria-label="搜索文件" placeholder="搜索文件名、项目或 Case" maxLength={200} value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button aria-label="清除搜索" onClick={()=>setSearch('')}><X size={14}/></button>}</label></div><CatalogGrid columns={columns} rows={data?.files||[]} total={data?.total||0} offset={offset} onOffset={setOffset} loading={state.loading} error={state.error} onRetry={()=>setTick(t=>t+1)} search={q} onClear={()=>setSearch('')} format={format} actions={file=><><a href={downloadUrl(file)} download={file.fileName} aria-label={`下载 ${file.fileName}`}><Download size={16}/>下载</a>{onOpenCase&&file.caseId&&<button onClick={()=>onOpenCase(file.chatId,file.caseId)}>查看 Case</button>}</>}/></section>;
}
