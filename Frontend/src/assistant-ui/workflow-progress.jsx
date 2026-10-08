import React,{useState} from 'react';
import {ToolCall} from './tool-call.jsx';
import {AgentStatus} from './agent-status.jsx';
import {Timeline} from './timeline.jsx';
import {diagramStates} from '../workflow-diagram-model.js';
const labels={done:'已完成',current:'当前',pending:'未进行',unknown:'待核实',skipped:'无需执行',partial:'部分完成',blocked:'需处理'};
export function WorkflowProgress({workflow,caseStatus,plan,data,loading,running,error,activeAction}) {
  const [open,setOpen]=useState(false);
  const nodes=diagramStates({workflow,caseStatus,plan,data});
  const current=nodes.find(node=>node.status==='current');
  if(!workflow&&!loading&&!running&&!error)return null;
  const label=loading?'连接讨论服务…':error?'当前操作失败':running?(activeAction==='PROPOSE_PLAN'?'正在整理方案…':'正在回复…'):(workflow?.stage==='CONFIRM_PLAN_DATA'?'等待你确认准备数据':workflow?.stage==='CONFIRM_EXPECTATIONS'?'等待你确认预期结果':current?.label)||'等待更新流程';
  return <ToolCall className="aui-progress" query="查看过程" label={<AgentStatus state={error?'failed':'waiting'} label={label} trailing={null}/>} activeLabel={<AgentStatus state="working" label={label} trailing={null}/>} running={loading||running} open={open} onOpenChange={setOpen}>
    <Timeline events={nodes.map(node=>({id:node.id,when:node.status==='current'?'now':node.status==='done'?'past':'future',time:labels[node.status],title:node.label}))} visibleCount={nodes.length}/>
  </ToolCall>;
}
