import React, {useState} from 'react';
import {Table2} from 'lucide-react';
import './workflow-data-review.css';

export function WorkflowDataReview({data,turns,busy,onOpen,onEdit,onConfirm,onSend,onRetry,filePanel}){
  const [input,setInput]=useState('');
  const ready=data?.status==='VALIDATED';
  const pending=ready&&data.reviewStatus==='PENDING_REVIEW';
  const confirmed=ready&&data.reviewStatus==='CONFIRMED';
  const send=async event=>{event.preventDefault();if(!input.trim()||busy)return;
    const sent=await onSend(input.trim());if(sent)setInput('');};
  return <div className="wdr">
    <button type="button" className="wdr-card" onClick={onOpen} disabled={!ready}>
      <Table2 size={19}/><span><strong>模拟数据表</strong><small>{ready?
        `客户 ${data.customers.length} · 账户 ${data.accounts.length} · 基金 ${data.funds.length} · 持有 ${data.holdings.length} · 第 ${data.revision} 版`:
        '正在准备数据'}</small></span><em>{confirmed?'已确认':pending?'待你核对':'待生成'}</em>
    </button>
    {ready&&<div className="wdr-actions"><button type="button" onClick={onOpen}>查看四张表</button>
      {pending&&<><button type="button" onClick={onEdit}>手动修改</button>
        <button type="button" className="wdr-confirm" disabled={busy} onClick={onConfirm}>确认这批数据</button></>}</div>}
    {data?.status==='NOT_STARTED'&&<button type="button" className="wdr-retry" disabled={busy} onClick={onRetry}>重试生成</button>}
    {ready&&<div className="wdr-turns"><p className="wdr-assistant">数据已生成。请看一下这批数据有什么问题；你可以告诉我怎么改，也可以打开表格自己修改。</p>
      {turns.map(turn=><div key={turn.number} className="wdr-turn"><p className="wdr-user">{turn.userInput}</p><p className="wdr-assistant">{turn.reply}</p></div>)}
    </div>}
    {pending&&<form className="wdr-form" onSubmit={send}><textarea aria-label="告诉 AI 如何修改数据" value={input}
      onChange={event=>setInput(event.target.value)} placeholder="告诉我这批数据哪里需要调整…" maxLength={4000}/>
      <button type="submit" disabled={busy||!input.trim()}>{busy?'处理中…':'发送修改意见'}</button></form>}
    {confirmed&&filePanel}
  </div>;
}
