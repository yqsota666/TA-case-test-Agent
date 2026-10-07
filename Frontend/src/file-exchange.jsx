import React,{useEffect,useRef,useState} from 'react';
import {Download,Upload,FileText,ChevronRight} from 'lucide-react';
import {requestCase,casePath} from './live-case-api.js';
import {exchangeReviewRows} from './exchange-review.js';
import './file-exchange.css';
import {HoldingsReturnPanel} from './holdings-return-panel.jsx';
import {plannedHoldingsSteps} from './holdings-review.js';
const stamp=value=>value?new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'';
export function FileExchangePanel({chatId,caseId,plan,draft,workflow,readOnly,onChanged}) {
  const path=casePath(chatId,caseId),chatPath=`/chats/${chatId}`;
  const mounted=useRef(true);
  const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [preview,setPreview]=useState(null),[selected,setSelected]=useState({}),[dragging,setDragging]=useState(''),[channelId,setChannelId]=useState('');
  const refresh=async()=>{
    const [preparation,returns,confirmation,channelResult]=await Promise.all([requestCase(path+'/application-preparation'),requestCase(path+'/return-parsing'),requestCase(path+'/return-confirmation'),requestCase('/exchange/channels')]);
    const records={};
    await Promise.all((preparation.files??[]).map(async file=>{records[file.fileName]=(await requestCase(`${chatPath}/files/${file.id}?view=records`)).records;}));
    if(mounted.current)setData({preparation,returns,confirmation,records,channels:channelResult.channels??[]});
  };
  useEffect(()=>{let active=true;mounted.current=true;setBusy(true);setError('');
    const load=async()=>{try {await refresh();}catch(e){if(active)setError(e.message);}finally{if(active)setBusy(false);}};
    load();return()=>{active=false;mounted.current=false;};
  },[path]);
  const perform=async action=>{
    setBusy(true);setError('');
    try {
      await action();await refresh();
      const workflow=await requestCase(path+'/workflow');
      await requestCase(path+'/workflow/resume',{eventId:crypto.randomUUID(),expectedStage:workflow.stage});
      if(mounted.current)await onChanged();
    }catch(e){setError(e.message);try{await refresh();}catch{/* Keep action failure visible. */}}
    finally{setBusy(false);}
  };
  const upload=async(chosen,step)=>{
    if(!chosen.length||busy||readOnly)return;
    await perform(async()=>{
      if(chosen.reduce((n,f)=>n+f.size,0)>8*1024*1024)throw new Error('文件总大小不能超过 8 MiB，请分次上传。');
      const files=await Promise.all(chosen.map(file=>new Promise((resolve,reject)=>{
        const reader=new FileReader();reader.onload=()=>resolve({fileName:file.name,base64:String(reader.result).split(',')[1]});
        reader.onerror=()=>reject(new Error('文件读取失败，请重新选择。'));reader.readAsDataURL(file);
      })));
      const result=await requestCase(`${path}/return-parsing/${step.expectedType}`,{batchPublicId:step.batchPublicId,files});
      setSelected({});
      if(result.phase==='ORDER_REJECTED')throw new Error('回传未通过流程顺序校验，请先确认对应申请已交给 TA，再重新上传。');
    });
  };
  const eligible=plan?.status==='LOCKED'&&draft?.reviewStatus==='CONFIRMED'&&!readOnly;
  const files=data?.preparation.files??[],steps=data?.returns.steps??[];
  const canGenerate=eligible&&(!files.length||workflow?.waiting?.some(action=>action?.action==='GENERATE_AND_DELIVER'));
  const ready=Boolean(data);
  const holdingsSteps=plannedHoldingsSteps(plan);
  const selectedChannel=channelId||data?.preparation.channelId||(data?.channels.length===1?String(data.channels[0].id):'');
  return <div className="cw-exchange-panel" aria-busy={busy}>
    <section><div className="cw-exchange-heading"><h3>申请文件</h3>{canGenerate&&<button type="button" className="cw-exchange-button" disabled={busy||!ready||!data?.channels.length} onClick={()=>perform(()=>requestCase(path+'/application-preparation',{revision:data?.preparation.revision,...(channelId?{channelId}:{})}))}>生成可用文件</button>}</div>
      {ready&&eligible&&!data.channels.length&&<p role="alert" className="cw-exchange-error">当前项目尚未配置 TA 交换通道，暂时无法生成申请文件。</p>}
      {ready&&data.channels.length>1&&<label className="cw-exchange-channel">交换通道<select value={channelId||data.preparation.channelId||''} disabled={busy||readOnly} onChange={event=>setChannelId(event.target.value)}><option value="">请选择</option>{data.channels.map(channel=><option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>}
      {data?.preparation.phase==='WAITING_CHAT'&&<p role="status" className="cw-exchange-muted">等待项目中的其他 Case 确认数据后，统一生成申请文件。</p>}
      {ready&&data.preparation.questions?.length>0&&data.channels.length>0&&<p role="alert" className="cw-exchange-error">{data.preparation.questions.join('；')}</p>}
      {!files.length&&<p className="cw-exchange-muted">{eligible?'尚未生成申请文件。':'确认方案与草稿后，可生成申请文件。'}</p>}
      {files.map(file=><div className="cw-exchange-file" key={file.id}>
        <FileText size={20}/><div><button type="button" className="cw-exchange-name" onClick={()=>setPreview(preview===file.fileName?null:file.fileName)}>{file.fileName}<ChevronRight size={14}/></button><small>{stamp(file.createdAt)}</small></div>
        <a className="cw-exchange-button" href={`/live-api${chatPath}/files/${file.id}`} download={file.fileName} aria-label={`下载 ${file.fileName}`}><Download size={15}/>下载</a>
      </div>)}
      {preview&&<div className="cw-exchange-table" tabIndex={0} aria-label="申请文件内容"><table><thead><tr><th>申请单号</th><th>交易账号</th><th>基金</th><th>申请金额</th></tr></thead><tbody>{(data?.records[preview]??[]).map((r,i)=><tr key={i}><td>{r.AppSheetSerialNo}</td><td>{r.TransactionAccountID}</td><td>{r.FundCode??'—'}</td><td>{r.ApplicationAmount??'—'}</td></tr>)}</tbody></table></div>}
    </section>
    <section><h3>TA 返回文件</h3>{!steps.length&&!holdingsSteps.length&&<div className="cw-exchange-drop is-disabled" aria-disabled="true"><Upload size={26} strokeWidth={1.4}/><strong>接收 TA 返回文件</strong><small>生成并交付申请文件后，可拖入或选择对应回传</small></div>}
      {steps.map(step=>{
        const delivered=['DELIVERED','RECEIVED'].includes(data.confirmation.batches.find(b=>b.batchPublicId===step.batchPublicId)?.status);
        const entry=step.parses.at(-1),requests=step.outboundFiles.flatMap(name=>data.records[name]??[]);
        const rows=exchangeReviewRows(entry?.result,requests,data.confirmation.confirmations??[],entry?.parseId);
        const selectedRows=rows.filter(row=>selected[entry?.parseId]?.includes(row.index)&&row.matched&&!row.applied);
        return <div className="cw-exchange-return" key={`${step.batchPublicId}-${step.expectedType}`}>
          <div className="cw-exchange-heading"><strong>{step.expectedType==='02'?'开户回传（02）':'申购回传（04）'}</strong><span className="cw-exchange-muted">{delivered?'已记录交付':'待交给 TA'}</span></div>
          <p className="cw-exchange-source">{step.outboundFiles.join('、')}</p>
          <div className="cw-exchange-actions">{!delivered&&<button type="button" className="cw-exchange-button" disabled={busy||readOnly} onClick={()=>perform(()=>requestCase(path+'/return-confirmation/delivery',{batchPublicId:step.batchPublicId}))}>确认已交给 TA</button>}
          </div>
          <label className={`cw-exchange-drop ${busy||readOnly||!delivered?'is-disabled':''} ${dragging===step.batchPublicId?'is-dragging':''}`}
            onDragOver={event=>{event.preventDefault();if(!busy&&!readOnly&&delivered)setDragging(step.batchPublicId);}}
            onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget))setDragging('');}}
            onDrop={event=>{event.preventDefault();setDragging('');if(delivered)upload(Array.from(event.dataTransfer.files??[]),step);}}>
            <Upload size={26} strokeWidth={1.4}/><strong>拖入 TA 返回文件，或点击选择</strong><small>{delivered?'TXT 文件，可附原始 OFI 索引':'将申请交给 TA 后，确认交付即可接收'}</small>
            <input type="file" accept=".txt,.TXT" multiple aria-label={`选择 ${step.expectedType} 返回文件`} disabled={busy||readOnly||!delivered} onChange={event=>{const chosen=Array.from(event.target.files??[]);event.target.value='';upload(chosen,step);}}/>
          </label>
          {entry&&<><div className="cw-exchange-table" tabIndex={0} aria-label="申请与回传对照"><table><thead><tr><th>选择</th><th>申请单号</th><th>申请金额</th><th>确认金额</th><th>确认份额</th><th>处理结果</th></tr></thead><tbody>{rows.map(row=><tr key={row.index}>
            <td><input type="checkbox" aria-label={`选择回传第${row.index+1}条`} disabled={busy||readOnly||!entry.orderAccepted||!row.matched||row.applied} checked={Boolean(selected[entry.parseId]?.includes(row.index))} onChange={event=>setSelected(s=>({...s,[entry.parseId]:event.target.checked?[...(s[entry.parseId]??[]),row.index]:(s[entry.parseId]??[]).filter(i=>i!==row.index)}))}/></td>
            <td>{row.record.AppSheetSerialNo}</td><td>{row.request?.ApplicationAmount??'—'}</td><td>{row.record.ConfirmedAmount??'—'}</td><td>{row.record.ConfirmedVol??'—'}</td><td>{!row.matched?'未匹配申请':row.applied?'已同步':row.record.ReturnCode==='0000'?'成功':`失败（${row.record.ReturnCode}）`}</td>
          </tr>)}</tbody></table></div>
          {!entry.orderAccepted&&<p role="alert">回传未通过流程顺序校验，请补齐前置步骤后重新上传。</p>}
          <div className="cw-exchange-actions"><button type="button" className="cw-primary-button" disabled={busy||readOnly||!entry.orderAccepted||!selectedRows.length} onClick={()=>perform(()=>requestCase(path+'/return-confirmation/apply',{parseId:entry.parseId,recordIndexes:selectedRows.map(r=>r.index)}))}>确认同步选中记录</button></div></>}
        </div>;
      })}
    </section>
    {holdingsSteps.length>0&&<HoldingsReturnPanel key={path} path={path} steps={holdingsSteps} locked={plan?.status==='LOCKED'} channelId={selectedChannel} readOnly={readOnly} onChanged={onChanged}/>}
    {busy&&<p role="status" className="cw-exchange-muted">正在处理…</p>}{error&&<p role="alert" className="cw-exchange-error">{error}</p>}
  </div>;
}
