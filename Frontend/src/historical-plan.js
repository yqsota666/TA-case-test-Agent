// Historical replies use the persisted displayPlanProposal labels, not case-specific keywords.
export function readHistoricalPlan(text='') {
  const proposal={objective:'',preconditions:[],scenarios:[],openQuestions:[]};
  const notes=[],schedule=[];
  let scenario=null,continuation=null;
  for(const line of text.split('\n').map(s=>s.trim()).filter(Boolean)){
    let match;
    if((match=/^测试目标[：:]\s*(.+)$/.exec(line))){proposal.objective=match[1];continuation=value=>proposal.objective+='\n'+value;}
    else if((match=/^准备条件\s*\d+[：:]\s*(.*)$/.exec(line))){proposal.preconditions.push(match[1]);continuation=value=>proposal.preconditions[proposal.preconditions.length-1]+='\n'+value;}
    else if((match=/^场景\s*\d+[：:]\s*(.*)$/.exec(line))){scenario={title:match[1],setup:'',action:'',expected:'',evidence:''};proposal.scenarios.push(scenario);continuation=value=>scenario.title+='\n'+value;}
    else if(scenario&&(match=/^(准备|动作|预期|证据)[：:]\s*(.*)$/.exec(line))){const key={准备:'setup',动作:'action',预期:'expected',证据:'evidence'}[match[1]];scenario[key]=match[2];continuation=value=>scenario[key]+='\n'+value;}
    else if((match=/^(?:待确认\s*\d+|时序待确认)[：:]\s*(.*)$/.exec(line))){proposal.openQuestions.push(match[1]);continuation=null;}
    else if((match=/^((?:准备提交|接收)[^：:]+)[：:]\s*(\d{8}(?:（可选）)?)$/.exec(line))){schedule.push({action:match[1],date:match[2]});continuation=null;}
    else if(line==='请审阅这份草稿。有修改可直接指出；准备数据与预期结果需要分别点击确认。'){continuation=null;}
    else if(continuation)continuation(line);
    else if(!proposal.objective)notes.push(line);
  }
  return proposal.objective&&proposal.scenarios.length&&proposal.scenarios.every(s=>s.setup&&s.action&&s.expected)?{proposal,notes,schedule}:null;
}
