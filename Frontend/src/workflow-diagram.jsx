import React from 'react';
import {Play, MessagesSquare, ListChecks, ClipboardCheck, Database, BadgeCheck, GitBranch, ArrowLeftRight, ScanSearch, CheckCheck, Flag, Archive} from 'lucide-react';
import {diagramStates} from './workflow-diagram-model.js';
import './workflow-diagram.css';
const icons=[Play,MessagesSquare,ListChecks,ClipboardCheck,Database,BadgeCheck,GitBranch,ArrowLeftRight,ScanSearch,CheckCheck,Flag,Archive];
const positions=Array.from({length:12},(_,i)=>({x:130+(Math.floor(i/4)%2?3-i%4:i%4)*240,y:94+Math.floor(i/4)*184}));
const labels={done:'已通过',current:'当前节点',pending:'未执行',blocked:'受阻',partial:'部分完成',unknown:'未核实',skipped:'不涉及'};
export function WorkflowDiagram(props) {
  if(props.loading)return <div className="cw-flow-feedback" role="status">正在读取流程…</div>;
  if(props.error)return <div className="cw-flow-feedback" role="alert"><p>{props.error}</p><button type="button" onClick={props.onRetry}>重新加载</button></div>;
  const nodes=diagramStates(props);
  const current=nodes.find(n=>n.status==='current');
  return <section className="cw-flow" aria-label="真实 Case 工作流">
    <div className="cw-flow-summary"><span className="cw-flow-live-dot"/>{current?.label || '状态暂不可用'}<span>{!current?'请刷新重试':['CASE_FINAL','CHAT_CLOSED'].includes(current.id)?'已结束':props.workflow?.interrupted?'等待操作':'执行中'}</span></div>
    <div className="cw-flow-canvas" tabIndex={0} aria-label="流程图，可横向滚动">
      <svg viewBox="0 0 980 550" role="img" aria-labelledby="cw-flow-title cw-flow-desc">
        <title id="cw-flow-title">Case 完整流程图</title>
        <desc id="cw-flow-desc">{nodes.map(n=>`${n.label}：${labels[n.status]}`).join('；')}。实线表示已通过路径，虚线表示后续或未核实路径。</desc>
        {nodes.slice(1).map((node,i)=>{
          const a=positions[i], b=positions[i+1];
          const solid=nodes[i].status==='done' && ['done','current'].includes(node.status);
          const horizontal=a.y===b.y, direction=Math.sign(b.x-a.x);
          const side=a.x>490?1:-1, outside=a.x+side*100;
          const d=horizontal?`M ${a.x+direction*34} ${a.y} L ${b.x-direction*34} ${b.y}`:`M ${a.x+side*34} ${a.y} C ${outside} ${a.y}, ${outside} ${b.y}, ${b.x+side*34} ${b.y}`;
          const tip=horizontal?`${b.x-direction*43},${b.y-4} ${b.x-direction*37},${b.y} ${b.x-direction*43},${b.y+4}`:`${b.x+side*43},${b.y-4} ${b.x+side*37},${b.y} ${b.x+side*43},${b.y+4}`;
          return <g key={node.id} className={`cw-flow-edge ${solid?'is-done':''}`}><path d={d}/><polyline points={tip}/></g>;
        })}
        {nodes.map((node,i)=>{const {x,y}=positions[i],Icon=icons[i];return <g key={node.id} className={`cw-flow-node is-${node.status}`}>
          {node.status==='current'&&<circle className="cw-flow-halo" cx={x} cy={y} r={38}/>}
          <circle className="cw-flow-circle" cx={x} cy={y} r={28}/>
          <Icon x={x-10} y={y-10} width={20} height={20} strokeWidth={1.6}/>
          <text className="cw-flow-label" x={x} y={y+56} textAnchor="middle">{node.label}</text>
          <text className="cw-flow-status" x={x} y={y+78} textAnchor="middle">{i===10&&['PASS','FAIL'].includes(props.caseStatus)?(props.caseStatus==='PASS'?'通过':'未通过'):labels[node.status]}</text>
        </g>;})}
      </svg>
    </div>
    <div className="cw-flow-legend"><span><i className="is-done"/>已通过</span><span><i/>后续路径</span><span><b/>当前节点</span></div>
  </section>;
}
