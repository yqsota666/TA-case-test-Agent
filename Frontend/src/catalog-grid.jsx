import React,{useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,X} from './ui-icons.jsx';

export function CatalogGrid({columns,rows,total=0,offset,onOffset,loading,error,onRetry,search,onClear,format=(_,v)=>v??'—',actions}) {
 const [selected,setSelected]=useState(null),dialog=useRef(null),opener=useRef(null);
 useEffect(()=>{if(selected&&!dialog.current.open)dialog.current.showModal();},[selected]);
 useEffect(()=>{setSelected(null);},[columns]);
 function close(){dialog.current?.close();setSelected(null);opener.current?.focus();}
 return <><div className="gc-table-scroll" tabIndex={0} role="region" aria-label="记录表，可横向和纵向滚动" aria-busy={loading}>
 <table><colgroup>{columns.map(c=><col key={c.key} style={{width:c.width||150}}/>)}<col style={{width:actions?190:90}}/></colgroup><thead><tr>{columns.map((c,i)=><th key={c.key} className={i===0?'gc-frozen':''} scope="col">{c.label}</th>)}<th className="gc-actions" scope="col">操作</th></tr></thead>
 <tbody>{!error&&rows.map((row,i)=><tr key={i}>{columns.map((c,j)=><td key={c.key} className={`${j===0?'gc-frozen ':''}${c.numeric?'gc-number':''}`} title={String(row[c.key]??'')}><span>{format(c.key,row[c.key])}</span></td>)}<td className="gc-actions"><div>{actions?.(row)}<button onClick={e=>{opener.current=e.currentTarget;setSelected(row);}}>详情</button></div></td></tr>)}</tbody></table>
 {(error||!rows.length)&&<div className="gc-grid-feedback" role={error?'alert':'status'}>{error|| (loading?'正在读取…':search?'未找到匹配记录':'暂无记录')}{error?<button onClick={onRetry}>重试</button>:search&&!loading?<button onClick={onClear}>清除搜索</button>:null}</div>}
 {loading&&rows.length>0&&<div className="gc-loading" role="status">正在读取…</div>}
 </div><footer className="gc-pagination"><span>{total?`${offset+1}–${Math.min(offset+rows.length,total)} / ${total} 条`:'0 条'}</span>{total>100&&<><button aria-label="上一页" disabled={loading||offset===0} onClick={()=>onOffset(Math.max(0,offset-100))}><ChevronLeft size={16}/></button><button aria-label="下一页" disabled={loading||offset+rows.length>=total} onClick={()=>onOffset(offset+100)}><ChevronRight size={16}/></button></>}</footer>
 <dialog className="gc-detail" ref={dialog} aria-labelledby="gc-detail-title" onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target===dialog.current)close();}}><header><h2 id="gc-detail-title">记录详情</h2><button aria-label="关闭详情" onClick={close}><X size={18}/></button></header><dl>{selected&&columns.map(c=><div key={c.key}><dt>{c.label}</dt><dd>{format(c.key,selected[c.key])}</dd></div>)}</dl></dialog></>;
}
