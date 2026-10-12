import React from 'react';
import {PlanComparison} from './plan-comparison.jsx';
import {MessageBody,formatDuration} from './message-body.jsx';
import {ChevronRight} from './ui-icons.jsx';
import {readHistoricalPlan} from './historical-plan.js';
import './historical-plan.css';

export function HistoricalPlan({message}) {
  const parsed=readHistoricalPlan(message.text);
  if(!parsed)return <div className="cw-plan-document cw-history-fallback"><MessageBody message={message} text={message.text}/></div>;
  const date=new Date(message.createdAt),duration=formatDuration(message.durationMs);
  return <div className="cw-history-plan">
    <div className="cw-history-meta">{Number.isFinite(date.getTime())&&<time dateTime={date.toISOString()}>{date.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})}</time>}{duration&&<span>用时 {duration}</span>}</div>
    {parsed.notes.length>0&&<div className="cw-history-notes">{parsed.notes.map((note,i)=><p key={i}>{note}</p>)}</div>}
    <p className="cw-history-objective">{parsed.proposal.objective}</p>
    <PlanComparison plan={parsed.proposal} editable={false}/>
    {parsed.proposal.openQuestions.length>0&&<section className="cw-history-questions"><h3>待明确</h3><ul>{parsed.proposal.openQuestions.map((q,i)=><li key={i}>{q}</li>)}</ul></section>}
    {parsed.schedule.length>0&&<details className="cw-review-common cw-history-schedule"><summary>文件安排<ChevronRight size={15}/></summary><dl>{parsed.schedule.map((item,i)=><div key={i}><dt>{item.action}</dt><dd>{item.date.replace(/^(\d{4})(\d{2})(\d{2})/,'$1-$2-$3')}</dd></div>)}</dl></details>}
    <details className="cw-review-common cw-history-source"><summary>查看完整原回复<ChevronRight size={15}/></summary><MessageBody message={message} text={message.text}/></details>
  </div>;
}
