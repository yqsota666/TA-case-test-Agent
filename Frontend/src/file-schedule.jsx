import React from 'react';
import {exchangeStepLabel,exchangeStepTime,planText} from './plan-language.js';

export function FileSchedule({exchangePlan,ordered=false}) {
  if(!exchangePlan?.steps?.length)return null;
  const steps=exchangePlan.steps,groups=[];
  for(const step of steps){
    const key=ordered&&step.direction==='SEND'&&step.businessTime?.kind==='DATE'?`${step.roundId}:${step.businessTime.value}`:step.stepId;
    let group=groups.find(g=>g.key===key);
    if(!group){group={key,steps:[]};groups.push(group);}
    group.steps.push(step);
  }
  const condition={SENT:'提交后',PARSED:'解析后',CONFIRMED:'确认成功后'};
  return <section className="cw-task-file-schedule"><h3>提交与回传</h3><ol>{groups.map(group=>{
    const first=group.steps[0],packageSteps=group.steps.length>1;
    return <li key={group.key}><strong>{exchangeStepTime(first)||'日期待明确'} · {packageSteps?`一次提交申请包（${[...new Set(group.steps.map(s=>s.fileType))].join('＋')}）`:exchangeStepLabel(first)}</strong>
      {packageSteps&&<p>01与03放入同一个ZIP，OFI索引列明处理顺序。</p>}
      {group.steps.map(step=><React.Fragment key={step.stepId}>{step.required===false&&<p>{exchangeStepLabel(step)}：可选</p>}{step.dependsOn?.length>0&&<p>{step.dependsOn.map(dep=>{const parent=steps.find(s=>s.stepId===dep.stepId);return parent?`${exchangeStepLabel(parent)}（${exchangeStepTime(parent)||'日期待明确'}）${condition[dep.condition]||planText(dep.condition)}`:'前置文件安排待明确';}).join('；')}</p>}</React.Fragment>)}
    </li>;
  })}</ol></section>;
}
