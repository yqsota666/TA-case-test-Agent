import React from 'react';
import {PlanComparison,ExpectedText} from './plan-comparison.jsx';
import {MessageBody,formatDuration} from './message-body.jsx';
import {ChevronRight} from './ui-icons.jsx';
import {readHistoricalPlan,historicalReviewFacts,historicalPlanStatus} from './historical-plan.js';
import {planText} from './plan-language.js';
import './historical-plan.css';

function Fold({title,children}) {return <details className="cw-review-common"><summary>{title}<ChevronRight size={15}/></summary>{children}</details>;}
function Facts({items}) {return <dl className="cw-history-facts">{items.map((item,i)=><div key={i}><dt>{item.label}</dt><dd>{item.label==='业务日期'?item.value.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):item.value}</dd></div>)}</dl>;}
function SingleReview({proposal}) {
  const item=proposal.scenarios[0],facts=historicalReviewFacts(item.setup,proposal.preconditions);
  const conditions=facts.filter(f=>!f.simulated),simulated=facts.filter(f=>f.simulated);
  const clauses=item.action.split(/[；;\n]/).map(s=>s.trim()).filter(Boolean);
  const actionSummary=clauses.length>2?[clauses[0],clauses.at(-1)]:clauses;
  return <>
    <section className="cw-history-section"><h3>核对条件</h3>{conditions.length?<Facts items={conditions}/>:<p>{item.setup}</p>}
      <Fold title="完整条件与模拟说明"><p>{item.setup}</p>{proposal.preconditions.length>0&&<ul>{proposal.preconditions.map((s,i)=><li key={i}>{s}</li>)}</ul>}</Fold>
    </section>
    {simulated.length>0&&<section className="cw-history-section"><h3>模拟取值</h3><Facts items={simulated}/></section>}
    <section className="cw-history-section"><h3>打算怎么测试</h3><ol className="cw-history-actions">{actionSummary.map((clause,i)=><li key={i}>{clause}</li>)}</ol>{clauses.length>2&&<Fold title="完整操作说明"><p>{item.action}</p></Fold>}</section>
    <section className="cw-history-section"><h3>预期结果</h3><ExpectedText text={planText(item.expected)}/>{item.evidence&&<Fold title="核对依据"><p>{item.evidence}</p></Fold>}</section>
  </>;
}
export function HistoricalPlan({message,messages=[],currentPlan,onOpenCurrent,onResume}) {
  const parsed=readHistoricalPlan(message.text),status=historicalPlanStatus(message,messages);
  const date=new Date(message.createdAt),duration=formatDuration(message.durationMs);
  return <div className="cw-history-plan">
    <div className="cw-history-meta">{Number.isFinite(date.getTime())&&<time dateTime={date.toISOString()}>{date.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})}</time>}{duration&&<span>用时 {duration}</span>}</div>
    <div className="cw-history-status"><p>{status.failed?'这份历史方案未通过校验。':message.draft?'这份历史方案当时尚未准备完成。':'这是一份历史方案。'}{status.hasLaterPlan&&currentPlan?'后续已整理新的方案。':'仅供回看。'}</p>
      {status.hasLaterPlan&&currentPlan?<button type="button" onClick={onOpenCurrent}>查看当前方案<ChevronRight size={15}/></button>:message.draft&&<button type="button" onClick={onResume}>回到对话继续修改<ChevronRight size={15}/></button>}
    </div>
    {parsed&&!status.failed&&parsed.notes.map((note,i)=><p className="cw-history-note" key={i}>{note}</p>)}
    {parsed?<>
      <h2 className="cw-history-objective">{parsed.proposal.scenarios.length===1?parsed.proposal.scenarios[0].title||parsed.proposal.objective:parsed.proposal.objective}</h2>
      {parsed.proposal.scenarios.length===1?<SingleReview proposal={parsed.proposal}/>:<PlanComparison plan={parsed.proposal} editable={false}/>}
      {parsed.proposal.openQuestions.length>0&&<section className="cw-history-questions"><h3>当时尚未明确</h3><ul>{parsed.proposal.openQuestions.map((q,i)=><li key={i}>{q}</li>)}</ul></section>}
      {parsed.schedule.length>0&&<Fold title="文件安排"><dl className="cw-history-dates">{parsed.schedule.map((item,i)=><div key={i}><dt>{item.action}</dt><dd>{item.date.replace(/^(\d{4})(\d{2})(\d{2})/,'$1-$2-$3')}</dd></div>)}</dl></Fold>}
      <div className="cw-history-source"><Fold title="完整原回复"><MessageBody message={message} text={message.text}/></Fold></div>
    </>:<div className="cw-history-source cw-history-fallback"><MessageBody message={message} text={message.text}/></div>}
  </div>;
}
