import React,{useEffect,useRef,useState} from 'react';
import {Upload} from 'lucide-react';
import {requestCase} from './live-case-api.js';
import {exchangeStepTime} from './plan-language.js';
import {holdingsParseForStep,holdingsReviewRows} from './holdings-review.js';
const quantity=value=>value==null?'—':value;
const date=value=>/^\d{8}$/.test(value??'')?`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6)}`:value;
export function HoldingsReturnPanel({path,steps,locked,channelId,readOnly,onChanged}) {
 const [data,setData]=useState(null),[holdings,setHoldings]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[dragging,setDragging]=useState('');
 const alive=useRef(true),pending=useRef(false);
 const refresh=async()=>{
  const [next,sales]=await Promise.all([requestCase(path+'/holdings-return'),requestCase('/sales-data')]);
  if(alive.current){setData(next);setHoldings(sales.holdings??[]);}
 };
 useEffect(()=>{alive.current=true;if(locked){setBusy(true);refresh().catch(e=>{if(alive.current)setError(e.message);}).finally(()=>{if(alive.current)setBusy(false);});}return()=>{alive.current=false;};},[path,locked]);
 const perform=async action=>{
  if(pending.current||readOnly||!locked)return;
  pending.current=true;setBusy(true);setError('');
  try {await action();await refresh();const workflow=await requestCase(path+'/workflow');await requestCase(path+'/workflow/resume',{eventId:crypto.randomUUID(),expectedStage:workflow.stage});if(alive.current)await onChanged();}
  catch(e){if(alive.current)setError(e.message);try{await refresh();}catch{/* Preserve upload or synchronization failure. */}}
  finally{pending.current=false;if(alive.current)setBusy(false);}
 };
 const upload=(files,step)=>perform(async()=>{
  if(!files.length)return;
  if(!channelId)throw new Error('请选择 TA 交换通道。');
  if(files.reduce((total,file)=>total+file.size,0)>8*1024*1024)throw new Error('文件总大小不能超过 8 MiB，请分次上传。');
  const content=await Promise.all(files.map(file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({fileName:file.name,base64:String(reader.result).split(',')[1]});reader.onerror=()=>reject(new Error('文件读取失败，请重新选择。'));reader.readAsDataURL(file);}))); 
  await requestCase(path+'/holdings-return/parse',{channelId,exchangeStepId:step.stepId,files:content});
 });
 return <div className="cw-holdings-return" aria-busy={busy}>{steps.map(step=>{
  const entry=holdingsParseForStep(data,step),rows=holdingsReviewRows(entry,holdings);
  const disabled=busy||readOnly||!locked||!data||!channelId;
  return <div className="cw-exchange-return" key={step.stepId}>
   <div className="cw-exchange-heading"><strong>持仓余额回传（05）</strong>{exchangeStepTime(step)&&<span className="cw-exchange-muted">{exchangeStepTime(step)}</span>}</div>
   <label className={`cw-exchange-drop ${disabled?'is-disabled':''} ${dragging===step.stepId?'is-dragging':''}`} onDragOver={event=>{event.preventDefault();if(!disabled)setDragging(step.stepId);}} onDragLeave={()=>setDragging('')} onDrop={event=>{event.preventDefault();setDragging('');if(!disabled)upload(Array.from(event.dataTransfer.files??[]),step);}}>
    <Upload size={26} strokeWidth={1.4}/><strong>拖入 05 文件，或点击选择</strong><small>{!locked?'确认方案后可接收':readOnly?'已结束，可查看解析结果':'TXT 文件，可附原始 OFI 索引'}</small>
    <input type="file" accept=".txt,.TXT" multiple aria-label="选择 05 持仓余额文件" disabled={disabled} onChange={event=>{const files=Array.from(event.target.files??[]);event.target.value='';if(files.length)upload(files,step);}}/>
   </label>
   {entry&&<><p className="cw-exchange-source">{(entry.parsed?.files??[]).map(file=>file.fileName).join('、')}</p>
    <div className="cw-exchange-table" tabIndex={0} aria-label="05 持仓余额解析与当前数据对照"><table><thead><tr><th>交易账户</th><th>基金</th><th>收费方式</th><th>确认日期</th><th>当前总份额</th><th>回传总份额</th><th>当前可用份额</th><th>回传可用份额</th><th>当前冻结份额</th><th>回传冻结份额</th><th>处理结果</th></tr></thead><tbody>{rows.map(row=><tr key={`${row.fileName}-${row.index}`}><td>{quantity(row.record.TransactionAccountID)}</td><td>{quantity(row.record.FundCode)}</td><td>{row.record.ShareClass==='0'?'前收费':row.record.ShareClass==='1'?'后收费':'—'}</td><td>{date(row.record.TransactionCfmDate)}</td><td>{quantity(row.current?.totalVolume)}</td><td>{quantity(row.record.TotalVolOfDistributorInTA)}</td><td>{quantity(row.current?.availableVolume)}</td><td>{quantity(row.record.AvailableVol)}</td><td>{quantity(row.current?.frozenVolume)}</td><td>{quantity(row.record.TotalFrozenVol)}</td><td>{row.label}</td></tr>)}</tbody></table></div>
    {!rows.length&&<p className="cw-exchange-muted">文件没有持仓记录。</p>}
    {!entry.applied&&<div className="cw-exchange-actions"><button type="button" className="cw-primary-button" disabled={busy||readOnly||!locked||!rows.some(row=>row.record.DetailFlag==='0')} onClick={()=>perform(()=>requestCase(path+'/holdings-return/apply',{parseId:entry.parseId,exchangeStepId:step.stepId}))}>确认同步持仓余额</button></div>}
   </>}
  </div>;
 })}{busy&&<p role="status" className="cw-exchange-muted">正在处理持仓文件…</p>}{error&&<p role="alert" className="cw-exchange-error">{error}</p>}</div>;
}
