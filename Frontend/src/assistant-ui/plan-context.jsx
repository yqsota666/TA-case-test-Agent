import React,{useState} from 'react';
import {ReasoningRoot,ReasoningTrigger,ReasoningContent,ReasoningText} from './reasoning.jsx';
import {Sources} from './sources.jsx';
export function PlanContext({plan}) {
  const [open,setOpen]=useState(false);
  const sources=plan.scenarios.filter(item=>item.evidence).map(item=>({title:item.title||'核对依据',snippet:item.evidence}));
  const notes=[...plan.preconditions,...plan.openQuestions];
  return <div className="aui-plan-context">
    {!!notes.length&&<ReasoningRoot defaultOpen={false}><ReasoningTrigger/><ReasoningContent><ReasoningText><ul>{notes.map((note,i)=><li key={i}>{note}</li>)}</ul></ReasoningText></ReasoningContent></ReasoningRoot>}
    {!!sources.length&&<Sources sources={sources} open={open} onOpenChange={setOpen} locale="zh-CN"/>}
  </div>;
}
