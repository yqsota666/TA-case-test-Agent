import {ApprovalCard} from './assistant-ui/approval-card.jsx';
import React from 'react';
import {PlanComparison} from './plan-comparison.jsx';
import {normalizePlan} from './plan-document.jsx';
import './expectation-review.css';
export function ExpectationReview({plan,busy,error,onConfirm,onSaveContent}) {
  const content=normalizePlan(plan.proposal);
  return <>
    <div className="cw-expect-body" role="region" aria-label="预期结果审阅" tabIndex={0}>
      <PlanComparison plan={content} editable={plan.status==='PENDING_CONFIRMATION'&&!busy} onSaveContent={onSaveContent}/>
      {content.openQuestions.length>0&&<section className="cw-expect-questions"><h3>需要补充</h3><ul>{content.openQuestions.map((question,index)=><li key={index}>{question}</li>)}</ul></section>}
    </div>
    <footer className="cw-plan-confirm-footer">{error&&<p role="alert">{error}</p>}<ApprovalCard state={busy?'running':'request'} title="预期结果" subtitle="核对各情况的预期结果后确认" statusLabel="确认中…" allowOnceLabel="确认预期结果" disabled={busy||content.openQuestions.length>0} onAllowOnce={onConfirm}/></footer>
  </>;
}
