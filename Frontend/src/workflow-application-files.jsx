import React,{useEffect,useState} from 'react';
import {ArrowDownToLine,FileArchive,RefreshCw} from 'lucide-react';
import './workflow-application-files.css';

export function WorkflowApplicationFiles({data,chatId,caseId,request}){
  const [channels,setChannels]=useState([]),[state,setState]=useState(null);
  const [channelId,setChannelId]=useState(''),[input,setInput]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[preview,setPreview]=useState(null);
  const chatPath=`/chats/${chatId}`,casePath=`${chatPath}/cases/${caseId}`;
  const run=async(userInput)=>{
    setBusy(true);setError('');
    try{
      const result=await request(`${casePath}/application-preparation`,{method:'POST',body:{
        ...(state?{revision:state.revision}:{}),...(channelId?{channelId}:{}),
        ...(userInput?{userInput}:{}),
      }});
      setState(result);setChannelId(result.channelId??channelId);if(userInput)setInput('');
    }catch(e){setError(e.message);
      try{setState(await request(`${casePath}/application-preparation`));}catch{/* Keep the useful error. */}
    }finally{setBusy(false);}
  };
  useEffect(()=>{let active=true;
    setBusy(true);setError('');setState(null);setPreview(null);setInput('');
    Promise.all([request('/exchange/channels'),request(`${casePath}/application-preparation`)])
      .then(async([channelResult,current])=>{
        if(!active)return;
        setChannels(channelResult.channels??[]);
        setChannelId(current.channelId??(channelResult.channels?.length===1?channelResult.channels[0].id:''));
        if(current.phase==='NOT_STARTED'&&!data.applicationPreparation?.message){
          current=await request(`${casePath}/application-preparation`,{method:'POST',body:{revision:current.revision}});
        }
        if(active){setState(current);if(data.applicationPreparation?.message)setError(data.applicationPreparation.message);}
      }).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[chatId,caseId]);
  const showPreview=async file=>{setError('');try{
    setPreview(await request(`${chatPath}/files/${file.id}?view=records`));
  }catch(e){setError(e.message);}};
  const submit=event=>{event.preventDefault();if(input.trim()&&!busy)run(input.trim());};
  return <section className="waf" aria-label="申请文件">
    <div className="waf-heading"><FileArchive size={18}/><strong>申请文件</strong>
      <button type="button" disabled={busy} onClick={()=>run()} aria-label="继续生成申请文件"><RefreshCw size={15}/></button></div>
    {channels.length>1&&!state?.stagedKeys?.length&&<div className="waf-form"><label>交换通道
      <select value={channelId} disabled={busy} onChange={event=>setChannelId(event.target.value)}>
        <option value="">请选择</option>{channels.map(channel=><option key={channel.id} value={channel.id}>{channel.name}</option>)}
      </select></label></div>}
    {busy&&<p className="waf-help" role="status">正在按 Plan 准备申请内容…</p>}
    {(state?.turns??[]).filter(turn=>turn.userInput).map((turn,index)=><div className="wdr-turn" key={index}>
      <p className="wdr-user">{turn.userInput}</p><p className="wdr-assistant">{turn.reply}</p></div>)}
    {!busy&&state?.reply&&<p className="wdr-assistant">{state.reply}</p>}
    {!busy&&state?.questions?.length>0&&<ul className="waf-help">{state.questions.map((question,index)=><li key={index}>{question}</li>)}</ul>}
    {state?.phase==='WAITING_TA'&&<p className="waf-help">收到并匹配成功的 02 回传后，点击继续生成即可准备 03 文件。</p>}
    {state?.phase==='PREPARING'&&<p className="waf-help">上次生成尚未完成。点击继续生成可恢复。</p>}
    {(!state||['NOT_STARTED','PREPARING','WAITING_TA','WAITING_CHAT'].includes(state.phase))&&
      <div className="waf-actions"><button type="button" disabled={busy} onClick={()=>run()}>继续生成</button></div>}
    {state&&(state.phase==='NEEDS_INPUT'||(error&&state.phase!=='PREPARING'))&&<form className="wdr-form" onSubmit={submit}>
      <textarea aria-label="补充申请信息" value={input} disabled={busy} onChange={event=>setInput(event.target.value)}
        placeholder="告诉 AI 要补充的证件、金额、日期等信息…" maxLength={4000}/>
      <button type="submit" disabled={busy||!input.trim()}>发送补充信息</button>
      {channels.length>1&&!state.intents.length&&<button type="button" disabled={busy||!channelId} onClick={()=>run()}>使用这个通道</button>}
    </form>}
    {error&&<p role="alert" className="waf-error">{error}</p>}
    <div className="waf-list"><strong>已生成文件</strong>{state?.files?.length?state.files.map(file=><div className="waf-file" key={file.id}>
      <button type="button" onClick={()=>showPreview(file)}>{file.fileName}</button><span>{file.recordCount} 条</span>
      <a href={`/new-api${chatPath}/files/${file.id}`} download={file.fileName} aria-label={`下载 ${file.fileName}`}><ArrowDownToLine size={15}/></a>
    </div>):<p>尚无 01／03 文件。</p>}</div>
    {preview&&<div className="waf-preview"><div><strong>{preview.fileName}</strong><button type="button" onClick={()=>setPreview(null)}>关闭</button></div>
      <div className="waf-table"><table><thead><tr>{Object.keys(preview.records?.[0]??{}).map(key=><th key={key}>{key}</th>)}</tr></thead>
        <tbody>{(preview.records??[]).map((row,index)=><tr key={index}>{Object.keys(preview.records[0]).map(key=><td key={key}>{row[key]??''}</td>)}</tr>)}</tbody></table></div>
    </div>}
  </section>;
}
