import React,{useEffect,useId,useState} from 'react';
import {Search,X} from './ui-icons.jsx';
import {requestCase} from './live-case-api.js';
import {catalogParams,catalogStorageKey,emptyFilters,initialCatalogQuery,readCatalogState,removeCatalogScope,validCatalogFilters,writeCatalogState} from './catalog-query-state.js';

const names={contains:'包含',eq:'等于',ne:'不等于',startsWith:'开头是',notContains:'不包含',in:'属于以下任一项',notIn:'排除以下各项',gt:'大于',gte:'大于或等于',lt:'小于',lte:'小于或等于',between:'介于',empty:'未填写',notEmpty:'已填写'};
const hiddenFields=new Set(['chatId','caseId','batchId']);
const requestCatalog=(path,query,offset=0,optionsField)=>requestCase(`${path}/search`,{...Object.fromEntries(catalogParams(query,offset)),...(optionsField?{optionsField}:{})});
export function useCatalogQuery(resource,path) {
  const [query,setQuery]=useState(()=>initialCatalogQuery(resource));
  const [search,setSearch]=useState(query.q),[offset,setOffset]=useState(0),[tick,setTick]=useState(0);
  const [state,setState]=useState({loading:true,data:null,error:''});
  useEffect(()=>{if(search.trim()===query.q)return;const timer=setTimeout(()=>{setQuery(v=>({...v,q:search.trim()}));setOffset(0);},250);return()=>clearTimeout(timer);},[search,query.q]);
  useEffect(()=>{writeCatalogState(sessionStorage,catalogStorageKey(resource),query);},[query,resource]);
  useEffect(()=>{
    let active=true;
    setState(v=>({...v,loading:true,error:'',data:v.data?.source&&v.data.source!==query.source?null:v.data}));
    requestCatalog(path,query,offset).then(data=>{if(active)setState({loading:false,data,error:''});}).catch(error=>{if(active)setState(v=>({...v,loading:false,error:error.message}));});
    return()=>{active=false;};
  },[path,query,offset,tick]);
  const apply=next=>{removeCatalogScope();setQuery(next);setSearch(next.q);setOffset(0);};
  const clear=()=>{removeCatalogScope();apply({...query,q:'',filters:emptyFilters(),sort:[]});};
  return {query,search,setSearch,offset,setOffset,state,path,resource,apply,clear,retry:()=>setTick(v=>v+1)};
}
function ValueEditor({field,rule,onChange,model}) {
  const id=useId(),[suggestions,setSuggestions]=useState([]),[suggestionError,setSuggestionError]=useState('');
  useEffect(()=>{setSuggestions([]);setSuggestionError('');},[field.key,model.query]);
  if(hiddenFields.has(field.key))return <span className="gc-query-value">已选关联范围</span>;
  if(['empty','notEmpty'].includes(rule.operator))return null;
  const multi=['in','notIn'].includes(rule.operator);
  if(field.options) {
    return <select aria-label={`${field.label}的值`} multiple={multi} value={multi?(Array.isArray(rule.value)?rule.value:[]):rule.value||''} onChange={event=>onChange(multi?Array.from(event.target.selectedOptions,o=>o.value):event.target.value)}>
      {!multi&&<option value="">请选择</option>}{field.options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
    </select>;
  }
  const loadSuggestions=async()=>{
    if(field.type!=='text'||field.collection||suggestions.length)return;
    try {const result=await requestCatalog(model.path,model.query,0,field.key);setSuggestions(result.options||[]);setSuggestionError('');}
    catch{setSuggestionError('候选项读取失败，可直接输入或重新聚焦重试。');}
  };
  if(rule.operator==='between')return <span className="gc-range">{[0,1].map(index=><input key={index} aria-label={`${field.label}${index?'终点':'起点'}`} type={['date','datetime'].includes(field.type)?'date':'text'} inputMode={field.type==='decimal'?'decimal':undefined} value={rule.value?.[index]||''} onChange={event=>{const next=Array.isArray(rule.value)?[...rule.value]:['',''];next[index]=event.target.value;onChange(next);}}/>)}<span>含起止日期／数值</span></span>;
  return <span className="gc-query-value"><input aria-label={`${field.label}的值`} type={!multi&&['date','datetime'].includes(field.type)?'date':'text'} inputMode={field.type==='decimal'?'decimal':undefined} maxLength={multi?2000:200} list={field.type==='text'&&!multi?id:undefined} placeholder={multi?'多个值用逗号分隔':field.type==='decimal'?'输入数值':'输入或选择'} value={Array.isArray(rule.value)?rule.value.join(','):rule.value||''} onFocus={loadSuggestions} onChange={event=>onChange(multi?event.target.value.split(/[,，]/):event.target.value)}/><datalist id={id}>{suggestions.map(option=><option key={option.value} value={option.value}>{option.count} 条</option>)}</datalist>{suggestionError&&<small role="status">{suggestionError}</small>}</span>;
}
function GroupEditor({group,fields,onChange,model,depth=0}) {
  const selectable=fields.filter(f=>!hiddenFields.has(f.key));
  const replace=(index,value)=>onChange({...group,rules:group.rules.map((rule,i)=>i===index?value:rule)});
  return <fieldset className="gc-query-group"><legend><select aria-label={`第${depth+1}层匹配方式`} value={group.combinator} onChange={e=>onChange({...group,combinator:e.target.value})}><option value="and">全部满足</option><option value="or">任一满足</option></select></legend>
    {group.rules.map((rule,index)=><div className="gc-query-rule" key={index}>{rule.rules?<GroupEditor group={rule} fields={fields} onChange={value=>replace(index,value)} model={model} depth={depth+1}/>:<>
      <select aria-label="筛选字段" value={rule.field} onChange={e=>{const f=fields.find(f=>f.key===e.target.value);replace(index,{field:f.key,operator:f.operators[0],value:''});}}>{hiddenFields.has(rule.field)&&<option value={rule.field}>{rule.field==='caseId'?'关联 Case':rule.field==='batchId'?'关联批次':'关联项目'}</option>}{selectable.map(f=><option key={f.key} value={f.key}>{f.label}</option>)}</select>
      {fields.find(f=>f.key===rule.field)?(()=>{const f=fields.find(f=>f.key===rule.field);return <><select aria-label={`${f.label}的条件`} value={rule.operator} onChange={e=>replace(index,{...rule,operator:e.target.value,value:['between','in','notIn'].includes(e.target.value)?[]:''})}>{f.operators.map(op=><option key={op} value={op}>{names[op]}</option>)}</select><ValueEditor field={f} rule={rule} model={model} onChange={value=>replace(index,{...rule,value})}/></>;})():<span role="alert">字段已不可用，请移除此条件</span>}
    </>}<button type="button" aria-label={rule.rules?'移除分组':'移除条件'} onClick={()=>onChange({...group,rules:group.rules.filter((_,i)=>i!==index)})}><X size={14}/></button></div>)}
    <div className="gc-query-add"><button type="button" disabled={!selectable.length||group.rules.length>=30} onClick={()=>onChange({...group,rules:[...group.rules,{field:selectable[0].key,operator:selectable[0].operators[0],value:''}]})}>＋添加条件</button>{depth<2&&<button type="button" onClick={()=>onChange({...group,rules:[...group.rules,emptyFilters()]})}>＋添加分组</button>}</div>
  </fieldset>;
}
function describe(rule,fields) {
  if(rule.rules)return `(${rule.rules.map(r=>describe(r,fields)).join(rule.combinator==='and'?' 且 ':' 或 ')})`;
  const f=fields.find(f=>f.key===rule.field);
  const label=f?.label||(rule.field==='caseId'?'关联 Case':rule.field==='chatId'?'关联项目':rule.field);
  const render=value=>f?.options?.find(o=>o.value===value)?.label||value;
  return `${label} ${names[rule.operator]||rule.operator} ${hiddenFields.has(rule.field)?'已选记录':Array.isArray(rule.value)?rule.value.map(render).join('、'):render(rule.value)||''}`;
}
function quickCondition(filters,rule) {
  return filters.combinator==='and'?{...filters,rules:[...filters.rules.filter(item=>item.rules||item.field!==rule.field),rule]}:{combinator:'and',rules:[filters,rule]};
}
function QuickFilter({field,model}) {
  const [options,setOptions]=useState(field.options||[]),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const load=async()=>{
    if(field.options){setOptions(field.options);return;}
    setLoading(true);setError('');
    const filters=model.query.filters.combinator==='and'?{...model.query.filters,rules:model.query.filters.rules.filter(rule=>rule.rules||rule.field!==field.key)}:model.query.filters;
    try{const value=await requestCatalog(model.path,{...model.query,filters},0,field.key);setOptions(value.options||[]);}catch(error){setError(error.message);}finally{setLoading(false);}
  };
  return <details className="gc-quick-filter" onToggle={event=>{if(event.currentTarget.open)load();}}><summary>{field.label}</summary><div>
    {loading?<span role="status">读取候选项…</span>:error?<><span role="alert">{error}</span><button onClick={load}>重试</button></>:options.length?<select aria-label={`快捷筛选${field.label}`} value="" onChange={event=>{if(!event.target.value)return;model.apply({...model.query,filters:quickCondition(model.query.filters,{field:field.key,operator:'eq',value:event.target.value})});event.target.closest('details').open=false;}}><option value="">选择{field.label}</option>{options.map(option=><option key={option.value} value={option.value}>{option.label||option.value}{option.count===undefined?'':`（${option.count}）`}</option>)}</select>:<span>当前条件下暂无候选项，可在高级筛选中输入。</span>}
  </div></details>;
}
export function CatalogQueryControls({model,placeholder,sourceControl}) {
  const {query,state,search,setSearch,apply,clear}=model,fields=state.data?.source&&state.data.source!==query.source?[]:state.data?.queryFields||[];
  const [open,setOpen]=useState(false),[draft,setDraft]=useState(query.filters),[sort,setSort]=useState(query.sort);
  const [saveOpen,setSaveOpen]=useState(false),[name,setName]=useState(''),[notice,setNotice]=useState('');
  const savedKey=catalogStorageKey(model.resource)+':saved';
  const [saved,setSaved]=useState(()=>{const items=readCatalogState(localStorage,savedKey,{items:[]}).items;return Array.isArray(items)?items.filter(item=>item?.id&&typeof item.name==='string'&&typeof item.query?.q==='string'&&validCatalogFilters(item.query.filters)&&Array.isArray(item.query.sort)).slice(-20):[];});
  useEffect(()=>{setDraft(query.filters);setSort(query.sort);},[query]);
  const persist=items=>{if(writeCatalogState(localStorage,savedKey,{items})){setSaved(items);setNotice('');return true;}setNotice('浏览器无法保存查询，请检查存储设置。');return false;};
  return <div className="gc-query-controls"><div className="gc-query-toolbar">
    {sourceControl}<label className="gc-search"><Search size={16}/><input aria-label="快捷搜索" placeholder={placeholder} maxLength={200} value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button aria-label="清除关键词" onClick={()=>setSearch('')}><X size={14}/></button>}</label>
    <button className="gc-filter-toggle" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>筛选与排序{query.filters.rules.length?`（${query.filters.rules.length}）`:''}</button>
    <button onClick={()=>setSaveOpen(v=>!v)}>保存查询</button>
    {saved.length>0&&<><select aria-label="常用查询" value="" onChange={event=>{const item=saved.find(item=>item.id===event.target.value);if(item){apply(item.query);setOpen(false);}}}><option value="">常用查询</option>{saved.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><details className="gc-saved-manager"><summary>管理</summary>{saved.map(item=><div key={item.id}><span>{item.name}</span><button aria-label={`删除查询${item.name}`} onClick={()=>persist(saved.filter(v=>v.id!==item.id))}>删除</button></div>)}</details></>}
    {(query.q||query.filters.rules.length>0||query.sort.length>0)&&<button onClick={clear}>清空条件</button>}
  </div>
  {saveOpen&&<form className="gc-save-query" onSubmit={e=>{e.preventDefault();const title=name.trim();if(!title)return;if(saved.length>=20&&!saved.some(v=>v.name===title)){setNotice('最多保存20个查询，请先删除不再需要的查询。');return;}const next={...query,q:search.trim()};const item={id:crypto.randomUUID(),name:title,query:next};if(persist([...saved.filter(v=>v.name!==title),item])){apply(next);setSaveOpen(false);setName('');setNotice('已保存到此浏览器的当前账户。');}}}><input aria-label="查询名称" maxLength={40} placeholder="输入常用查询名称" value={name} onChange={e=>setName(e.target.value)} required/><button type="submit">保存到此浏览器</button><button type="button" onClick={()=>setSaveOpen(false)}>取消</button></form>}
  {notice&&<p role="status" className="gc-query-notice">{notice}</p>}
  <div className="gc-quick-filters">{['project','caseTitle','channel_name','channelName','DistributorCode','distributorCode','investor_type','status','direction','fileType'].map(key=>fields.find(f=>f.key===key)).filter(Boolean).slice(0,5).map(field=><QuickFilter key={field.key} field={field} model={model}/>)}</div>
  {query.filters.rules.length>0&&<div className="gc-filter-chips" aria-label="已应用条件">{query.filters.rules.map((rule,index)=><button key={index} title={describe(rule,fields)} aria-label={`移除${describe(rule,fields)}`} onClick={()=>apply({...query,filters:{...query.filters,rules:query.filters.rules.filter((_,i)=>i!==index)}})}>{describe(rule,fields)}<X size={12}/></button>)}</div>}
  {query.sort.length>0&&<div className="gc-filter-chips" aria-label="已应用排序">{query.sort.map((item,index)=><button key={index} onClick={()=>apply({...query,sort:query.sort.filter((_,i)=>i!==index)})}>{fields.find(f=>f.key===item.field)?.label||item.field}：{item.direction==='asc'?'升序':'降序'}<X size={12}/></button>)}</div>}
  {open&&<form className="gc-query-panel" onSubmit={e=>{e.preventDefault();apply({...query,filters:draft,sort});setOpen(false);}}>
    <GroupEditor group={draft} fields={fields} onChange={setDraft} model={model}/>
    <div className="gc-query-sorts"><span>排序</span>{sort.map((item,index)=><div key={index}><select aria-label={`排序字段${index+1}`} value={item.field} onChange={e=>setSort(sort.map((v,i)=>i===index?{...v,field:e.target.value}:v))}>{fields.filter(f=>!f.collection&&!hiddenFields.has(f.key)).map(f=><option key={f.key} value={f.key}>{f.label}</option>)}</select><select aria-label={`排序方向${index+1}`} value={item.direction} onChange={e=>setSort(sort.map((v,i)=>i===index?{...v,direction:e.target.value}:v))}><option value="asc">升序</option><option value="desc">降序</option></select><button type="button" aria-label={`移除排序${index+1}`} onClick={()=>setSort(sort.filter((_,i)=>i!==index))}><X size={14}/></button></div>)}<button type="button" disabled={!fields.length||sort.length>=3} onClick={()=>setSort([...sort,{field:fields.find(f=>!hiddenFields.has(f.key)&&!f.collection).key,direction:'asc'}])}>＋添加排序</button></div>
    <footer><button type="button" onClick={()=>{setDraft(query.filters);setSort(query.sort);setOpen(false);}}>取消</button><button type="submit" disabled={state.loading||!fields.length}>应用条件</button></footer>
  </form>}
  </div>;
}
