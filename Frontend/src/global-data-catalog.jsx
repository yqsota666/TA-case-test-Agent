import React,{useMemo,useState} from 'react';
import {CatalogQueryControls,useCatalogQuery} from './catalog-query-controls.jsx';
import {CatalogGrid} from './catalog-grid.jsx';
import {recordColumns} from './catalog-model.js';
import {DistributorEditor} from './distributor-editor.jsx';
import {deliveryFormatSummary,protocolVersionLabel} from './distributor-format.js';
import './global-catalog.css';
const tables=[['customers','客户'],['accounts','账户'],['funds','基金'],['holdings','持仓'],['applications','申请记录'],['distributors','销售商']];
const labels={READY:'待生成',BATCHED:'已合批',GENERATED:'已生成',DELIVERED:'已发送',WAITING_RETURN:'等待回传',CONFIRMED:'已确认',FAILED:'失败',CANCELED:'已取消'};
export function catalogCell(key,value){if(key==='protocol_version')return protocolVersionLabel(value);if(key==='delivery_profile')return deliveryFormatSummary(value);if(value===null||value===undefined||value==='')return '—';if(key==='status')return labels[value]??'待处理';if(['investor_type','IndividualOrInstitution'].includes(key))return String(value)==='1'?'个人':String(value)==='0'?'机构':String(value);if(key==='created_at'&&Number.isFinite(Date.parse(value)))return new Date(value).toLocaleString('zh-CN',{hour12:false});if(typeof value==='object')return JSON.stringify(value);return String(value);}
export function GlobalDataCatalog({onOpenCase,onOpenFiles}) {
 const [table,setTable]=useState(()=>{const value=new URLSearchParams(location.search).get('dataTable');return tables.some(([key])=>key===value)?value:'customers';});
 return <section className="gc-page" aria-label="数据"><nav className="gc-tabs" aria-label="数据表">{tables.map(([key,label])=><button key={key} aria-current={table===key?'page':undefined} onClick={()=>{if(key===table)return;setTable(key);const url=new URL(location.href);url.searchParams.set('dataTable',key);history.replaceState(null,'',url);}}>{label}</button>)}</nav><DataTable key={table} table={table} onOpenCase={onOpenCase} onOpenFiles={onOpenFiles}/></section>;
}
function DataTable({table,onOpenCase,onOpenFiles}) {
 const [editor,setEditor]=useState(null);
 const model=useCatalogQuery(`data:${table}`,`/data/tables/${table}`),{state,query,offset,setOffset}=model;
 const data=state.data,columns=useMemo(()=>recordColumns(data?.columns),[data?.columns]);
 const title=tables.find(([key])=>key===table)?.[1];
 const sourceControl=['customers','accounts','holdings'].includes(table)?<select aria-label="数据来源" value={query.source} onChange={event=>model.apply({...query,source:event.target.value,q:'',filters:{combinator:'and',rules:[]},sort:[]})}><option value="draft">生成{title}</option><option value="formal">正式{title}（TA回传确认）</option></select>:null;
 return <>
 <CatalogQueryControls model={model} placeholder={table==='applications'?'搜索申请编号、账号、基金或项目':table==='distributors'?'搜索销售商名称、代码或环境':`搜索${title}字段、项目或 Case`} sourceControl={sourceControl}/>
 {table==='distributors'&&<div className="gc-config-controls"><button type="button" onClick={()=>setEditor({row:null})}>新增销售商</button></div>}
 <CatalogGrid columns={columns} rows={data?.rows||[]} total={data?.total||0} offset={offset} onOffset={setOffset} loading={state.loading} error={state.error} onRetry={model.retry} search={query.q||query.filters.rules.length>0} onClear={model.clear} format={catalogCell} actions={row=>table==='distributors'?<button onClick={()=>setEditor({row})}>编辑</button>:<>{onOpenCase&&row.chatId&&row.caseId&&<button onClick={()=>onOpenCase(row.chatId,row.caseId)}>查看 Case</button>}{onOpenFiles&&row.caseId&&<button onClick={()=>onOpenFiles(row.chatId,[row.caseId],row.batchId,row.file_type)}>关联文件</button>}</>}/>
 {editor&&<DistributorEditor row={editor.row} onClose={()=>setEditor(null)} onSaved={()=>{setEditor(null);model.retry();}}/>}</>;
}
