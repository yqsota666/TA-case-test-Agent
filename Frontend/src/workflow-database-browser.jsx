import React, {useMemo,useState} from 'react';
import {X} from 'lucide-react';
import './workflow-database-browser.css';

const tables=[
  ['customers','case_generated_customers',['id','public_id','workspace_id','chat_id','case_id','name','investor_type','simulated_balance']],
  ['accounts','case_generated_accounts',['id','workspace_id','chat_id','case_id','customer_id','account_no','branch_code']],
  ['funds','case_generated_funds',['id','workspace_id','chat_id','case_id','fund_code','fund_name','share_class','nav']],
  ['holdings','case_generated_holdings',['id','workspace_id','chat_id','case_id','account_id','fund_code','share_class','total_volume']],
];

export function WorkflowDatabaseBrowser({data,overlay=false,onClose,scopeControl}){
  const [selected,setSelected]=useState('customers');
  const [sort,setSort]=useState({field:'id',descending:false});
  const [query,setQuery]=useState('');
  const [,tableName,columns]=tables.find(([key])=>key===selected);
  const rows=useMemo(()=>{
    const matching=(data?.[selected]??[]).filter(row=>!query||columns.some(column=>
      String(row[column]??'').toLocaleLowerCase().includes(query.toLocaleLowerCase())));
    return matching.sort((a,b)=>{
      const result=String(a[sort.field]??'').localeCompare(String(b[sort.field]??''),'zh-CN',{numeric:true});
      return sort.descending?-result:result;
    });
  },[data,selected,query,sort,columns]);
  return <section className={`wdb ${overlay?'wdb-overlay':''}`} aria-label="数据库表">
    <nav className="wdb-tables" aria-label="选择数据表">{tables.map(([key,name])=><button type="button"
      key={key} className={selected===key?'active':''} aria-current={selected===key?'page':undefined}
      onClick={()=>{setSelected(key);setQuery('');setSort({field:'id',descending:false});}}>
      <span>{name}</span><small>{data?.[key]?.length??0}</small></button>)}</nav>
    <div className="wdb-main"><header className="wdb-toolbar"><strong>{tableName}</strong>
      <div className="wdb-actions">{scopeControl}<input aria-label="搜索当前表" placeholder="搜索当前表" value={query}
        onChange={event=>setQuery(event.target.value)}/>{onClose&&<button type="button" aria-label="关闭数据表" onClick={onClose}><X size={17}/></button>}</div>
    </header><div className="wdb-grid"><table><thead><tr><th className="wdb-index">#</th>{columns.map(column=><th key={column}
      aria-sort={sort.field===column?(sort.descending?'descending':'ascending'):'none'}><button type="button"
      onClick={()=>setSort(current=>({field:column,descending:current.field===column?!current.descending:false}))}>{column}{sort.field===column?(sort.descending?' ↓':' ↑'):''}</button></th>)}</tr></thead>
      <tbody>{rows.map((row,index)=><tr key={`${row.workspace_id}:${row.chat_id}:${row.case_id}:${row.id}:${index}`}>
        <td className="wdb-index">{index+1}</td>{columns.map(column=><td key={column} title={String(row[column]??'')}>{String(row[column]??'')}</td>)}</tr>)}</tbody>
    </table>{!rows.length&&<div className="wdb-empty">{query?'没有匹配的记录':'0 行'}</div>}</div>
    <footer className="wdb-status">{rows.length} 行 × {columns.length} 列</footer></div>
  </section>;
}
