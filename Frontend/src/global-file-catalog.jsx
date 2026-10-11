import React from 'react';
import {Download} from './ui-icons.jsx';
import {CatalogQueryControls,useCatalogQuery} from './catalog-query-controls.jsx';
import {CatalogGrid} from './catalog-grid.jsx';
import './global-catalog.css';
const downloadUrl=file=>'/live-api/files/catalog/download?'+new URLSearchParams({kind:file.kind,id:file.locator,fileName:file.fileName});
const columns=[{key:'fileName',label:'文件名称',width:310},{key:'fileType',label:'文件类型',width:100},{key:'direction',label:'方向',width:120},{key:'project',label:'项目',width:170},{key:'caseTitle',label:'Case',width:170},{key:'channelName',label:'通道',width:150},{key:'businessDate',label:'业务日期',width:140},{key:'byteLength',label:'文件大小',width:120,numeric:true},{key:'createdAt',label:'时间',width:200}];
const format=(key,value)=>value===null||value===undefined||value===''?'—':key==='businessDate'?String(value).slice(0,10):key==='createdAt'?new Date(value).toLocaleString('zh-CN',{hour12:false}):key==='direction'?value==='OUTBOUND'?'申请文件':'TA回传':key==='byteLength'?`${Number(value).toLocaleString()} 字节`:String(value);
export function GlobalFileCatalog({onOpenCase,onOpenData}) {
 const model=useCatalogQuery('files','/files/catalog'),{state,query,offset,setOffset}=model;
 const data=state.data;
 return <section className="gc-page" aria-label="文件"><CatalogQueryControls model={model} placeholder="搜索文件名、类型、销售商、项目或 Case"/>
 <CatalogGrid columns={columns} rows={data?.files||[]} total={data?.total||0} offset={offset} onOffset={setOffset} loading={state.loading} error={state.error} onRetry={model.retry} search={query.q||query.filters.rules.length>0} onClear={model.clear} format={format} actions={file=>{
  const ids=Array.isArray(file.caseIds)?file.caseIds:typeof file.caseIds==='string'?JSON.parse(file.caseIds):file.caseId?[file.caseId]:[];
  return <><a href={downloadUrl(file)} download={file.fileName} aria-label={`下载 ${file.fileName}`}><Download size={16}/>下载</a>{onOpenCase&&file.caseId&&<button onClick={()=>onOpenCase(file.chatId,file.caseId)}>查看 Case</button>}{onOpenData&&ids.length>0&&<button onClick={()=>onOpenData(file.chatId,[...new Set(ids)],file.batchId,file.direction==='OUTBOUND'?file.fileType:file.fileType==='02'?'01':file.fileType==='04'?'03':undefined)}>{file.batchId?'同批申请':'Case 申请'}</button>}</>;
 }}/></section>;
}
