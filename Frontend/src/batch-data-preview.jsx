import React, {useState} from 'react';
import {Database, X} from 'lucide-react';
import './batch-data-preview.css';

function buildDraft(cases){
  const actions=cases.flatMap(item=>item.detail?.sop?.value?.actions??[]);
  const needs=cases.flatMap(item=>item.detail?.sop?.value?.dataNeeds??[]).join(' ');
  const fundKeys=[...new Set(actions.map(action=>{
    const code=action.fields?.FundCode??action.evidence05?.fundCode;
    const shareClass=action.fields?.ShareClass??action.evidence05?.shareClass??'A';
    return code?`${code}:${shareClass}`:null;
  }).filter(Boolean))];
  const funds=fundKeys.map((key,index)=>{
    const [code,shareClass]=key.split(':');
    return {code,shareClass,name:`测试基金${index+1}`,nav:'1.0000'};
  });
  const requiredVolume=Number(needs.match(/(?:持有)?份额\s*[≥>]\s*(\d+(?:\.\d+)?)/)?.[1]??0);
  const redemptionVolume=actions.filter(action=>action.businessCode==='024').reduce((sum,action)=>sum+Number(action.applicationVolume??0),0);
  const volume=Math.max(requiredVolume,redemptionVolume);
  const threshold=Number(needs.match(/(\d+(?:\.\d+)?)\s*%/)?.[1]??5);
  return {
    customer:{id:'C001',name:'测试客户001',investorType:'个人',certificateNo:'TEST0001',balance:'100000.00'},
    account:{id:'A001',number:'100000000001',branchCode:'305',status:'待开户'},
    funds,
    targets:funds.map((_,fundIndex)=>({fundIndex,volume:volume?volume.toFixed(2):'待填写',startDate:actions.find(action=>action.businessCode==='022')?.businessDate??'待填写'})),
    scenarios:/NAV|净值/i.test(needs)?funds.flatMap((_,fundIndex)=>[
      {fundIndex,name:'高收益',nav:(1+(threshold+1)/100).toFixed(4)},
      {fundIndex,name:'低收益',nav:(1+(threshold-1)/100).toFixed(4)},
    ]):[],
  };
}

function DataGrid({table,onSelectTable}){
  const linkedNames={customer:'客户',account:'交易账户',fund:'基金'};
  return <div className="bdp-table-scroll"><table aria-label={table.title}>
    <thead><tr><th className="bdp-row-number">#</th>{table.columns.map(column=><th key={column.key}>{column.label}</th>)}</tr></thead>
    <tbody>{table.rows.map((row,rowIndex)=><tr key={rowIndex}><th scope="row" className="bdp-row-number">{rowIndex+1}</th>{table.columns.map(column=><td key={column.key}>
      {column.linkTo?<button type="button" className="bdp-cell-link" onClick={()=>onSelectTable(column.linkTo)}
        aria-label={`${table.title} 第${rowIndex+1}行 ${column.label}，查看${linkedNames[column.linkTo]}`}>{String(row[column.key]??'')}</button>:
        <input aria-label={`${table.title} 第${rowIndex+1}行 ${column.label}`} value={String(row[column.key]??'')}
          onChange={event=>table.onChange(rowIndex,column.key,event.target.value)}/>}
    </td>)}</tr>)}</tbody>
  </table></div>;
}

export function BatchDataPreview({cases,onClose}){
  const [draft,setDraft]=useState(()=>buildDraft(cases));
  const [selectedTable,setSelectedTable]=useState('customer');
  const changeObject=(kind,key,value)=>setDraft(current=>({...current,[kind]:{...current[kind],[key]:value}}));
  const changeList=(kind,index,key,value)=>setDraft(current=>({...current,[kind]:current[kind].map((row,rowIndex)=>rowIndex===index?{...row,[key]:value}:row)}));
  const customer=draft.customer,account=draft.account;
  const funds=draft.funds.map(fund=>({...fund}));
  const targets=draft.targets.map(target=>({
    customerId:customer.id,accountId:account.id,fundCode:funds[target.fundIndex]?.code,
    shareClass:funds[target.fundIndex]?.shareClass,volume:target.volume,startDate:target.startDate,
  }));
  const scenarios=draft.scenarios.map(item=>({fundCode:funds[item.fundIndex]?.code,name:item.name,nav:item.nav}));
  const tables=[
    {key:'customer',title:'客户',columns:[
      {key:'id',label:'客户ID'},{key:'name',label:'客户名称'},{key:'investorType',label:'类型'},{key:'certificateNo',label:'证件号'},
    ],rows:[customer],onChange:(_,key,value)=>changeObject('customer',key,value)},
    {key:'capital',title:'资金',columns:[
      {key:'customerId',label:'客户ID',linkTo:'customer'},{key:'balance',label:'模拟余额'},
    ],rows:[{customerId:customer.id,balance:customer.balance}],onChange:(_,key,value)=>changeObject('customer',key,value)},
    {key:'account',title:'交易账户',columns:[
      {key:'id',label:'账户ID'},{key:'customerId',label:'客户ID',linkTo:'customer'},
      {key:'number',label:'交易账号'},{key:'branchCode',label:'网点'},{key:'status',label:'状态'},
    ],rows:[{...account,customerId:customer.id}],onChange:(_,key,value)=>changeObject('account',key,value)},
    {key:'fund',title:'基金',columns:[
      {key:'code',label:'基金代码'},{key:'shareClass',label:'份额类别'},
      {key:'name',label:'基金名称'},{key:'nav',label:'单位净值'},
    ],rows:funds,onChange:(index,key,value)=>changeList('funds',index,key,value)},
    {key:'target',title:'目标份额',columns:[
      {key:'customerId',label:'客户ID',linkTo:'customer'},{key:'accountId',label:'账户ID',linkTo:'account'},
      {key:'fundCode',label:'基金代码',linkTo:'fund'},{key:'shareClass',label:'类别',linkTo:'fund'},
      {key:'volume',label:'目标份额'},{key:'startDate',label:'计划起始日'},
    ],rows:targets,onChange:(index,key,value)=>changeList('targets',index,key,value)},
    ...(scenarios.length?[{key:'scenario',title:'净值情景',columns:[
      {key:'fundCode',label:'基金代码',linkTo:'fund'},{key:'name',label:'情景'},{key:'nav',label:'净值'},
    ],rows:scenarios,onChange:(index,key,value)=>changeList('scenarios',index,key,value)}]:[]),
  ];
  const active=tables.find(table=>table.key===selectedTable)??tables[0];
  return <div className="bdp-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="bdp-shell" role="dialog" aria-modal="true" aria-label="数据表">
      <header className="bdp-header"><h2>数据表</h2><span>已确认（本地测试）</span><button className="bdp-close" aria-label="关闭" onClick={onClose}><X size={19}/></button></header>
      <div className="bdp-body">
        <nav className="bdp-table-list" aria-label="数据表列表">
          {tables.map(table=><button type="button" key={table.key} aria-current={table.key===active.key?'page':undefined}
            className={table.key===active.key?'selected':''} onClick={()=>setSelectedTable(table.key)}>
            <Database size={15}/><span>{table.title}</span>
          </button>)}
        </nav>
        <div className="bdp-viewer">
          <div className="bdp-viewer-head"><strong>{active.title}</strong></div>
          <DataGrid table={active} onSelectTable={setSelectedTable}/>
        </div>
      </div>
    </section>
  </div>;
}
