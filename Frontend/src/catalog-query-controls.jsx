import React,{useEffect,useId,useState} from 'react';
import {Search,X,ChevronDown} from './ui-icons.jsx';
import {requestCase} from './live-case-api.js';
import {catalogParams,catalogStorageKey,emptyFilters,initialCatalogQuery,readCatalogState,removeCatalogScope,validCatalogFilters,writeCatalogState} from './catalog-query-state.js';
import {CatalogDialog} from './catalog-dialog.jsx';
import {CatalogFacetOptions} from './catalog-facet-options.jsx';

function QuerySelect({children,...props}) {
  return <span className="gc-select"><select {...props}>{children}</select>{!props.multiple&&<ChevronDown size={14}/>}</span>;
}

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
    return <QuerySelect aria-label={`${field.label}的值`} multiple={multi} value={multi?(Array.isArray(rule.value)?rule.value:[]):rule.value||''} onChange={event=>onChange(multi?Array.from(event.target.selectedOptions,o=>o.value):event.target.value)}>
      {!multi&&<option value="">请选择</option>}{field.options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
    </QuerySelect>;
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
  return <fieldset className="gc-query-group"><legend>{depth?'条件分组':'筛选条件'}</legend><label className="gc-group-match"><span>匹配方式</span><QuerySelect aria-label={`第${depth+1}层匹配方式`} value={group.combinator} onChange={e=>onChange({...group,combinator:e.target.value})}><option value="and">全部满足</option><option value="or">任一满足</option></QuerySelect></label>
    {group.rules.map((rule,index)=><div className="gc-query-rule" key={index}>{rule.rules?<GroupEditor group={rule} fields={fields} onChange={value=>replace(index,value)} model={model} depth={depth+1}/>:<>
      <QuerySelect aria-label="筛选字段" value={rule.field} onChange={e=>{const f=fields.find(f=>f.key===e.target.value);replace(index,{field:f.key,operator:f.operators[0],value:''});}}>{hiddenFields.has(rule.field)&&<option value={rule.field}>{rule.field==='caseId'?'关联 Case':rule.field==='batchId'?'关联批次':'关联项目'}</option>}{selectable.map(f=><option key={f.key} value={f.key}>{f.label}</option>)}</QuerySelect>
      {fields.find(f=>f.key===rule.field)?(()=>{const f=fields.find(f=>f.key===rule.field);return <><QuerySelect aria-label={`${f.label}的条件`} value={rule.operator} onChange={e=>replace(index,{...rule,operator:e.target.value,value:['between','in','notIn'].includes(e.target.value)?[]:''})}>{f.operators.map(op=><option key={op} value={op}>{names[op]}</option>)}</QuerySelect><ValueEditor field={f} rule={rule} model={model} onChange={value=>replace(index,{...rule,value})}/></>;})():<span role="alert">字段已不可用，请移除此条件</span>}
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

function fieldRule(filters,key) {
  const matches=filters.combinator==='and'?filters.rules.filter(rule=>rule.field===key):[];
  return matches.length===1&&['eq','in','between','gte','lte'].includes(matches[0].operator)?matches[0]:undefined;
}
function replaceField(filters,key,rule) {
  const root=filters.combinator==='and'?filters:{combinator:'and',rules:[filters]};
  const previous=fieldRule(filters,key);
  return {...root,rules:[...root.rules.filter(item=>item!==previous),...(rule?[rule]:[])]};
}
function FacetEditor({field,model,onClose}) {
  const existing=fieldRule(model.query.filters,field.key);
  const [selected,setSelected]=useState(existing?Array.isArray(existing.value)?existing.value:[existing.value]:[]);
  const [range,setRange]=useState(existing?.operator==='between'?existing.value:existing?.operator==='gte'?[existing.value,'']:existing?.operator==='lte'?['',existing.value]:existing?.operator==='eq'?[existing.value,existing.value]:['','']);
  const [options,setOptions]=useState(field.options||[]),[loading,setLoading]=useState(!field.options),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const isDate=['date','datetime'].includes(field.type);
  useEffect(()=>{
    if(isDate||field.options)return;
    let active=true;setLoading(true);setError('');
    requestCatalog(model.path,{...model.query,filters:replaceField(model.query.filters,field.key,null)},0,field.key)
      .then(result=>{if(active)setOptions(result.options||[]);})
      .catch(error=>{if(active)setError(error.message);})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[retry]);
  const submit=event=>{
    event.preventDefault();let rule;
    if(isDate){if(range[0]&&range[1]&&range[0]>range[1]){setError('开始日期不能晚于结束日期。');return;}if(range.some(Boolean))rule={field:field.key,operator:range.every(Boolean)?'between':range[0]?'gte':'lte',value:range.every(Boolean)?range:range[0]||range[1]};}
    else if(selected.length)rule={field:field.key,operator:selected.length===1?'eq':'in',value:selected.length===1?selected[0]:selected};
    model.apply({...model.query,filters:replaceField(model.query.filters,field.key,rule)});onClose();
  };
  const merged=[...options,...selected.filter(value=>!options.some(option=>option.value===value)).map(value=>({value,label:value}))];
  return <CatalogDialog title={`筛选${field.label}`} onClose={onClose}><form onSubmit={submit}>
    <div className="gc-dialog-body">
      {isDate?<div className="gc-date-fields">{['开始日期','结束日期'].map((label,index)=><label key={label}>{label}<input aria-label={label} type="date" value={range[index]} onChange={event=>{setRange(range.map((v,i)=>i===index?event.target.value:v));setError('');}}/></label>)}</div>:
        loading?<p role="status">读取候选项…</p>:<CatalogFacetOptions label={field.label} options={merged} value={selected} onChange={setSelected}/>}
      {error&&<p role="alert">{error} {!isDate&&<button type="button" onClick={()=>setRetry(v=>v+1)}>重试</button>}</p>}
      {!isDate&&!loading&&<p className="gc-dialog-hint">可选择多项；候选显示最多50项，其他值可通过高级筛选输入。</p>}
    </div><footer><button type="button" onClick={()=>{setSelected([]);setRange(['','']);}}>重置选择</button><span/><button type="button" onClick={onClose}>取消</button><button type="submit" className="gc-primary" disabled={!isDate&&loading}>应用筛选</button></footer>
  </form></CatalogDialog>;
}
const quickKeys={
  files:['fileType','direction','channelName','businessDate','project'],
  applications:['status','business_date','fund_code','channel_name','project'],
  customers:['project','caseTitle','channel_name','investor_type'],
  accounts:['project','caseTitle','channel_name','branch_code'],
  funds:['fund_code','share_class','project','caseTitle'],
  holdings:['fund_code','share_class','snapshot_date','project'],
  distributors:['ta_environment','protocol_version','ta_code'],
};
function SortEditor({model,fields,onClose}) {
  const [sort,setSort]=useState(model.query.sort);
  const selectable=fields.filter(f=>!f.collection&&!hiddenFields.has(f.key));
  return <CatalogDialog title="排序" onClose={onClose}><form onSubmit={event=>{event.preventDefault();model.apply({...model.query,sort});onClose();}}><div className="gc-dialog-body gc-sort-list">
    {!sort.length&&<p className="gc-dialog-hint">当前使用默认顺序。</p>}
    {sort.map((item,index)=><div key={index}><span>{index+1}</span><QuerySelect aria-label={`排序字段${index+1}`} value={item.field} onChange={event=>setSort(sort.map((v,i)=>i===index?{...v,field:event.target.value}:v))}>{selectable.map(f=><option key={f.key} value={f.key}>{f.label}</option>)}</QuerySelect><QuerySelect aria-label={`排序方向${index+1}`} value={item.direction} onChange={event=>setSort(sort.map((v,i)=>i===index?{...v,direction:event.target.value}:v))}><option value="asc">升序</option><option value="desc">降序</option></QuerySelect><button type="button" aria-label={`移除排序${index+1}`} onClick={()=>setSort(sort.filter((_,i)=>i!==index))}><X size={14}/></button></div>)}
    <button type="button" disabled={!selectable.length||sort.length>=3} onClick={()=>setSort([...sort,{field:selectable.find(f=>!sort.some(item=>item.field===f.key))?.key||selectable[0].key,direction:'asc'}])}>＋添加排序</button>
  </div><footer><button type="button" onClick={()=>setSort([])}>重置排序</button><span/><button type="button" onClick={onClose}>取消</button><button className="gc-primary" type="submit">应用排序</button></footer></form></CatalogDialog>;
}
export function CatalogQueryControls({model,placeholder,sourceControl}) {
  const {query,state,search,setSearch,apply,clear}=model;
  const fields=state.data?.source&&state.data.source!==query.source?[]:state.data?.queryFields||[];
  const [panel,setPanel]=useState(null),[draft,setDraft]=useState(query.filters),[notice,setNotice]=useState(''),[name,setName]=useState('');
  const savedKey=catalogStorageKey(model.resource)+':saved';
  const [saved,setSaved]=useState(()=>{const items=readCatalogState(localStorage,savedKey,{items:[]}).items;return Array.isArray(items)?items.filter(item=>item?.id&&typeof item.name==='string'&&typeof item.query?.q==='string'&&validCatalogFilters(item.query.filters)&&Array.isArray(item.query.sort)).slice(-20):[];});
  const persist=items=>{if(writeCatalogState(localStorage,savedKey,{items})){setSaved(items);return true;}setNotice('浏览器无法保存查询，请检查存储设置。');return false;};
  const advanced=()=>{setDraft(query.filters);setPanel('advanced');};
  const quick=(quickKeys[model.resource.split(':').pop()]||[]).map(key=>fields.find(field=>field.key===key)).filter(Boolean);
  const active=query.q||query.filters.rules.length>0||query.sort.length>0;
  return <div className="gc-query-controls">
    <div className="gc-query-toolbar">{sourceControl&&<div className="gc-source-control">{sourceControl}<ChevronDown size={14}/></div>}
      <label className="gc-search"><Search size={17}/><input aria-label="快捷搜索" placeholder={placeholder} maxLength={200} value={search} onChange={event=>setSearch(event.target.value)}/>{search&&<button aria-label="清除关键词" onClick={()=>setSearch('')}><X size={14}/></button>}</label>
      <div className="gc-toolbar-actions"><button onClick={()=>setPanel('sort')}>排序{query.sort.length>0&&<b>{query.sort.length}</b>}</button><button onClick={()=>{setNotice('');setPanel('saved');}}>常用查询 <ChevronDown size={14}/></button></div>
    </div>
    <div className="gc-business-filters" aria-label="常用业务筛选"><span className="gc-filter-label">筛选</span>{quick.map(field=>{
      const rule=fieldRule(query.filters,field.key),value=rule?Array.isArray(rule.value)?rule.value.map(v=>field.options?.find(o=>o.value===v)?.label||v).join('、'):field.options?.find(o=>o.value===rule.value)?.label||rule.value:'';
      return <button className={`gc-business-filter${rule?' is-selected':''}`} key={field.key} onClick={()=>setPanel(field)} title={value?`${field.label}：${value}`:field.label}><span>{field.label}</span>{value&&<strong>{value}</strong>}<ChevronDown size={14}/></button>;
    })}<button className="gc-more-filters" onClick={advanced} disabled={!fields.length}>＋ 更多筛选</button></div>
    {active&&<div className="gc-applied-row"><span className="gc-filter-label">已应用</span><div className="gc-filter-chips" aria-label="已应用条件">
      {query.q&&<span className="gc-condition-chip"><span>关键词：{query.q}</span><button aria-label="移除关键词" onClick={()=>apply({...query,q:''})}><X size={12}/></button></span>}
      {query.filters.rules.length>1&&query.filters.combinator==='or'&&<span className="gc-filter-relation">任一满足</span>}
      {query.filters.rules.map((rule,index)=><span className="gc-condition-chip" key={index}><button title={describe(rule,fields)} aria-label={`编辑${describe(rule,fields)}`} onClick={advanced}>{describe(rule,fields)}</button><button aria-label={`移除${describe(rule,fields)}`} onClick={()=>apply({...query,filters:{...query.filters,rules:query.filters.rules.filter((_,i)=>i!==index)}})}><X size={12}/></button></span>)}
      {query.sort.map((item,index)=><span className="gc-condition-chip" key={`sort${index}`}><button onClick={()=>setPanel('sort')}>{fields.find(f=>f.key===item.field)?.label||item.field}：{item.direction==='asc'?'升序':'降序'}</button><button aria-label={`移除排序${index+1}`} onClick={()=>apply({...query,sort:query.sort.filter((_,i)=>i!==index)})}><X size={12}/></button></span>)}
    </div><button className="gc-clear-filters" onClick={clear}>清空条件</button></div>}
    {panel&&typeof panel==='object'&&<FacetEditor key={panel.key} field={panel} model={model} onClose={()=>setPanel(null)}/>}
    {panel==='advanced'&&<CatalogDialog title="高级筛选" wide onClose={()=>setPanel(null)}><form onSubmit={event=>{event.preventDefault();apply({...query,filters:draft});setPanel(null);}}><div className="gc-dialog-body"><p className="gc-dialog-hint">编辑后点击“应用条件”更新结果。</p><GroupEditor group={draft} fields={fields} onChange={setDraft} model={model}/></div><footer><button type="button" onClick={()=>setDraft(emptyFilters())}>重置条件</button><span/><button type="button" onClick={()=>setPanel(null)}>取消</button><button className="gc-primary" type="submit" disabled={state.loading||!fields.length}>应用条件</button></footer></form></CatalogDialog>}
    {panel==='sort'&&<SortEditor model={model} fields={fields} onClose={()=>setPanel(null)}/>}
    {panel==='saved'&&<CatalogDialog title="常用查询" onClose={()=>setPanel(null)}><div className="gc-dialog-body"><p className="gc-dialog-hint">保存在此浏览器，供当前账户使用。</p><div className="gc-saved-list">{saved.map(item=><div key={item.id}><button onClick={()=>{apply(item.query);setPanel(null);}}>{item.name}</button><button aria-label={`删除查询${item.name}`} onClick={()=>persist(saved.filter(v=>v.id!==item.id))}><X size={14}/></button></div>)}{!saved.length&&<p className="gc-dialog-hint">还没有保存的查询。</p>}</div><form className="gc-save-query" onSubmit={event=>{event.preventDefault();const title=name.trim();if(!title)return;if(saved.length>=20&&!saved.some(v=>v.name===title)){setNotice('最多保存20个查询，请先删除不再需要的查询。');return;}const next={...query,q:search.trim()};if(persist([...saved.filter(v=>v.name!==title),{id:crypto.randomUUID(),name:title,query:next}])){apply(next);setName('');setNotice('当前查询已保存。');}}}><label>保存当前查询<input aria-label="查询名称" maxLength={40} placeholder="查询名称" value={name} onChange={event=>setName(event.target.value)} required/></label><button className="gc-primary" type="submit">保存查询</button></form>{notice&&<p role="status" className="gc-query-notice">{notice}</p>}</div><footer><span/><button onClick={()=>setPanel(null)}>完成</button></footer></CatalogDialog>}
  </div>;
}
