import React, {useEffect,useRef,useState} from 'react';
import {ArrowDown,ArrowUp,Plus,Search,X} from 'lucide-react';
import './workflow-data-editor.css';

const clone=value=>structuredClone(value);
const emptyChanges=()=>({customers:[],accounts:[],funds:[],holdings:[]});
const id=value=>value==null?null:String(value);
const money=value=>/^\d{1,14}\.\d{2}$/.test(value);
const decimal8=value=>/^\d{1,8}\.\d{8}$/.test(value);
const volume=value=>/^\d{1,10}\.\d{8}$/.test(value);
const scope=row=>`${row.workspace_id}:${row.chat_id}:${row.case_id}`;
const columns={
  customers:[['id','客户 ID'],['public_id','公开 ID'],['workspace_id','工作空间 ID'],
    ['chat_id','Chat ID'],['case_id','Case ID'],['name','客户名称'],
    ['investor_type','客户类型'],['simulated_balance','模拟余额']],
  accounts:[['id','账户 ID'],['workspace_id','工作空间 ID'],['chat_id','Chat ID'],
    ['case_id','Case ID'],['customer_id','客户 ID'],['account_no','交易账号'],
    ['branch_code','分支代码']],
  funds:[['id','基金 ID'],['workspace_id','工作空间 ID'],['chat_id','Chat ID'],
    ['case_id','Case ID'],['fund_code','基金代码'],['fund_name','基金名称'],
    ['share_class','份额类别'],['nav','单位净值']],
  holdings:[['id','持有 ID'],['workspace_id','工作空间 ID'],['chat_id','Chat ID'],
    ['case_id','Case ID'],['account_id','账户 ID'],['fund_code','基金代码'],
    ['share_class','份额类别'],['total_volume','模拟持有份额']],
};

export function WorkflowDataEditor({data,onClose,onSave,readOnly=false,title,scopeControl}){
  const [tab,setTab]=useState('customers');
  const [draft,setDraft]=useState(()=>clone(data));
  const [query,setQuery]=useState('');
  const [sort,setSort]=useState({field:'id',direction:'asc'});
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  const closeButton=useRef(null);
  const dirty=!readOnly&&JSON.stringify(draft)!==JSON.stringify(data);
  useEffect(()=>{setDraft(clone(data));setQuery('');},[data]);
  useEffect(()=>{const prior=document.activeElement,overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';closeButton.current?.focus();
    return()=>{document.body.style.overflow=overflow;prior?.focus?.();};},[]);
  useEffect(()=>{
    const escape=event=>{if(event.key==='Escape'&&!saving){if(!dirty||window.confirm('放弃尚未保存的修改？'))onClose();}};
    window.addEventListener('keydown',escape);
    return()=>window.removeEventListener('keydown',escape);
  },[dirty,saving,onClose]);
  const close=()=>{if(!dirty||window.confirm('放弃尚未保存的修改？'))onClose();};
  const change=(kind,index,key,value)=>setDraft(current=>({
    ...current,[kind]:current[kind].map((row,i)=>i===index?{...row,[key]:value}:row),
  }));
  const add=()=>setDraft(current=>({
    ...current,[tab]:[...current[tab],tab==='customers'?{
      id:null,name:'',investor_type:'1',simulated_balance:'0.00',branch_code:'001',
    }:tab==='accounts'?{id:null,customer_id:id(current.customers[0]?.id)||'',branch_code:'001'}
      :tab==='funds'?{id:null,fund_code:'',fund_name:'',share_class:'A',nav:'1.00000000'}:{
      id:null,account_id:id(current.accounts[0]?.id)||'',
      fund_code:current.funds[0]?.fund_code||'',share_class:current.funds[0]?.share_class||'A',
      total_volume:'0.00000000',
    }],
  }));
  const allRows=draft[tab].map((row,rowIndex)=>({...row,rowIndex}));
  const visibleRows=allRows.filter(row=>!query||JSON.stringify(row).toLowerCase().includes(query.toLowerCase()))
    .sort((a,b)=>{const comparison=String(a[sort.field]??'').localeCompare(String(b[sort.field]??''),'zh-CN',{numeric:true});
      return sort.direction==='asc'?comparison:-comparison;});
  const input=(kind,index,key,value,options={})=><input aria-label={options.label} value={value??''}
    readOnly={options.readOnly} onChange={event=>change(kind,index,key,event.target.value)}/>;
  const save=async()=>{
    const changes=emptyChanges();
    for(const [index,row] of draft.customers.entries()){
      if(!row.name.trim()||!money(String(row.simulated_balance))){setError('客户名称或模拟余额格式有误；余额须保留两位小数。');setTab('customers');return;}
      if(row.id===null){
        if(!/^\d{1,9}$/.test(row.branch_code)){setError('新客户的分支代码须为数字。');setTab('customers');return;}
        changes.customers.push({id:null,name:row.name.trim(),investorType:row.investor_type,
          simulatedBalance:String(row.simulated_balance),branchCode:row.branch_code});
      }else if(JSON.stringify(row)!==JSON.stringify(data.customers[index])){
        changes.customers.push({id:id(row.id),name:row.name.trim(),investorType:row.investor_type,
          simulatedBalance:String(row.simulated_balance)});
      }
    }
    for(const [index,row] of draft.accounts.entries())if(JSON.stringify(row)!==JSON.stringify(data.accounts[index])){
      if(!/^\d{1,9}$/.test(row.branch_code)||!row.customer_id){
        setError('账户须选择已有客户，分支代码须为数字。');setTab('accounts');return;
      }
      changes.accounts.push({id:id(row.id),customerId:id(row.customer_id),branchCode:row.branch_code});
    }
    for(const [index,row] of draft.funds.entries()){
      if(!/^\d{6}$/.test(row.fund_code)||!row.fund_name.trim()||!decimal8(String(row.nav))){
        setError('基金代码须为六位数字，名称不能为空，净值须保留八位小数。');setTab('funds');return;
      }
      if(row.id===null||JSON.stringify(row)!==JSON.stringify(data.funds[index]))changes.funds.push({
        id:id(row.id),fundCode:row.fund_code,fundName:row.fund_name.trim(),
        shareClass:row.share_class,nav:String(row.nav),
      });
    }
    for(const [index,row] of draft.holdings.entries()){
      if(!volume(String(row.total_volume))){setError('模拟持有份额须保留八位小数。');setTab('holdings');return;}
      if(row.id===null||JSON.stringify(row)!==JSON.stringify(data.holdings[index]))changes.holdings.push({
        id:id(row.id),accountId:id(row.account_id),fundCode:row.fund_code,
        shareClass:row.share_class,totalVolume:String(row.total_volume),
      });
    }
    if(!Object.values(changes).some(rows=>rows.length)){onClose();return;}
    setSaving(true);setError('');
    try{await onSave({revision:data.revision,changes});onClose();}
    catch(cause){setError(cause.message);}finally{setSaving(false);}
  };
  const fundKey=fund=>`${fund.fund_code}:${fund.share_class}`;
  const cell=(row,field)=>{
    if(readOnly)return String(row[field]??'');
    if(tab==='customers'){
      if(['name','simulated_balance'].includes(field))return input('customers',row.rowIndex,field,row[field],{label:field});
      if(field==='investor_type')return <select aria-label={field} value={row[field]}
        onChange={event=>change('customers',row.rowIndex,field,event.target.value)}>
        <option value="1">1 · 个人</option><option value="0">0 · 机构</option></select>;
    }
    if(tab==='accounts'&&row.id===null&&field==='customer_id')return <select aria-label={field}
      value={id(row.customer_id)} onChange={event=>change('accounts',row.rowIndex,field,event.target.value)}>
      {draft.customers.filter(customer=>customer.id!==null).map(customer=><option key={customer.id}
        value={id(customer.id)}>{customer.id} · {customer.name}</option>)}
    </select>;
    if(tab==='accounts'&&field==='branch_code')
      return input('accounts',row.rowIndex,field,row[field],{label:field});
    if(tab==='funds'&&(['fund_name','nav'].includes(field)||row.id===null&&['fund_code','share_class'].includes(field)))
      return input('funds',row.rowIndex,field,row[field],{label:field});
    if(tab==='holdings'){
      if(field==='total_volume')return input('holdings',row.rowIndex,field,row[field],{label:field});
      if(row.id===null&&field==='account_id')return <select aria-label={field} value={id(row.account_id)}
        onChange={event=>change('holdings',row.rowIndex,field,event.target.value)}>
        {draft.accounts.map(account=><option key={account.id} value={id(account.id)}>{account.id} · {account.account_no}</option>)}
      </select>;
      if(row.id===null&&field==='fund_code')return <select aria-label={field} value={fundKey(row)}
        onChange={event=>{const [fund_code,share_class]=event.target.value.split(':');
          setDraft(current=>({...current,holdings:current.holdings.map((item,i)=>i===row.rowIndex?
            {...item,fund_code,share_class}:item)}));}}>
        {draft.funds.map(fund=><option key={fundKey(fund)} value={fundKey(fund)}>{fund.fund_code} · {fund.fund_name}</option>)}
      </select>;
    }
    return String(row[field]??(field==='account_no'&&row.id===null?'保存后生成':''));
  };
  return <div className="wde-backdrop">
    <section className="wde-dialog" role="dialog" aria-modal="true" aria-labelledby="wde-title">
      <header className="wde-head"><div><small>{readOnly?'跨 Chat 数据浏览':'当前 Chat · 模拟数据'}</small>
        <h2 id="wde-title">{title??(readOnly?'数据平台':'数据表')}</h2></div>
        <div className="wde-head-actions">{scopeControl}<span className="wde-mode">{readOnly?'只读':'可编辑'}</span>
          <button ref={closeButton} className="wde-close" aria-label="关闭数据表" onClick={close}><X size={19}/></button></div></header>
      <div className="wde-body"><nav className="wde-tabs" aria-label="数据表">
        {[['customers','客户',draft.customers.length],['accounts','交易账户',draft.accounts.length],
          ['funds','基金',draft.funds.length],
          ['holdings','模拟持有',draft.holdings.length]].map(([key,label,count])=><button key={key}
          aria-current={tab===key?'page':undefined} className={tab===key?'active':''}
          onClick={()=>{setTab(key);setError('');setQuery('');setSort({field:'id',direction:'asc'});}}><span>{label}</span><small>{count}</small></button>)}
      </nav><div className="wde-main"><div className="wde-toolbar"><div><strong>{tab==='customers'?'case_generated_customers':tab==='accounts'?'case_generated_accounts':tab==='funds'?'case_generated_funds':'case_generated_holdings'}</strong>
        <p>{tab==='holdings'?'模拟份额，不代表 TA 已确认持仓。':readOnly?'按列查看数据库记录。':'单元格可修改；灰色编号由系统维护。'}</p></div>
        <div className="wde-tools"><label className="wde-search"><Search size={15}/><input aria-label="搜索当前表" placeholder="搜索当前表"
          value={query} onChange={event=>setQuery(event.target.value)}/></label>
          {!readOnly&&<button className="wde-add" onClick={add}><Plus size={15}/>新增记录</button>}</div></div>
        <div className="wde-scroll"><table><thead><tr><th className="wde-row-number">行</th>
          {columns[tab].map(([field,label])=><th key={field} aria-sort={sort.field===field?(sort.direction==='asc'?'ascending':'descending'):'none'}>
            <button onClick={()=>setSort(current=>({field,direction:current.field===field&&current.direction==='asc'?'desc':'asc'}))}>
              <code>{field}</code><small>{label}</small>{sort.field===field&&(sort.direction==='asc'?<ArrowUp size={12}/>:<ArrowDown size={12}/>)}</button></th>)}</tr></thead>
          <tbody>{visibleRows.map((row,index)=><tr key={`${scope(row)}:${row.id??'new'}:${row.account_id??''}:${index}`}>
            <td className="wde-row-number">{index+1}</td>{columns[tab].map(([field])=><td key={field}
              className={['id','public_id','workspace_id','chat_id','case_id','account_id'].includes(field)?'wde-key':''}>
              {cell(row,field)}</td>)}</tr>)}</tbody></table>
          {!visibleRows.length&&<div className="wde-empty">{query?'没有匹配的记录。':tab==='holdings'?'当前没有模拟持有记录。':'当前没有记录。'}</div>}</div>
      </div></div><footer className="wde-foot"><span>{visibleRows.length} 行 · {columns[tab].length} 列{dirty?' · 有未保存修改':''}</span>
        {error&&<p role="alert">{error}</p>}
        {!readOnly&&<><button className="wde-cancel" onClick={close} disabled={saving}>取消</button>
          <button className="wf-primary" onClick={save} disabled={saving||!dirty}>{saving?'保存中…':'保存修改'}</button></>}</footer>
    </section></div>;
}
