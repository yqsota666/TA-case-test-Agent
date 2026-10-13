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

// Read literal values only. Unsupported wording stays available in the full conditions.
const reviewFields=[
  ['销售商',/销售商\s*(\d+(?:[（(][^）)]+[）)])?)/u],
  ['基金',/(?:基金代码|基金)\s*(\d{6})(?!\d)/u],
  ['业务日期',/业务日期\s*[：:]?\s*(\d{8})(?!\d)/u],
  ['申请金额',/申请金额\s*[：:]?\s*(\d+(?:\.\d+)?\s*元)/u],
  ['份额类别',/份额类别\s*[：:]?\s*([A-Za-z0-9])(?![A-Za-z0-9])/u],
  ['模拟客户',/新模拟客户\s*[：:]?\s*([^，,；;。\s]+)/u],
  ['净值',/净值\s*[：:]?\s*(\d+(?:\.\d+)?)(?![\d.])/u],
  ['前收费',/前收费\s*[：:]?\s*(\d+(?:\.\d+)?%?)(?![\d.])/u],
];
export function historicalReviewFacts(setup='',preconditions=[]) {
  const clauses=setup.split(/[，,；;。\n]/).map(s=>s.trim()).filter(Boolean);
  const facts=[];
  for(const [label,pattern] of reviewFields){
    for(const clause of clauses){
      if(/不是|不使用|不采用|不得|未知|未明确|待确认|待定|留空|例如|比如|可能|或者/.test(clause))continue;
      const match=pattern.exec(clause);
      if(!match||facts.some(f=>f.label===label&&f.value===match[1]))continue;
      const value=match[1];
      const simulated=label==='模拟客户'||(['净值','前收费'].includes(label)&&preconditions.some(s=>s.includes('【模拟假设】')&&s.includes(value)&&s.includes(label)));
      facts.push({label,value,simulated});
    }
  }
  // Other case types may already use explicit, arbitrary field labels.
  for(const clause of clauses){
    const match=/^((?!在|同时)[\p{L}\p{N}_/（）() -]{1,16})[：:]\s*(.+)$/u.exec(clause);
    if(match&&!facts.some(f=>f.label===match[1]))facts.push({label:match[1],value:match[2],simulated:false});
  }
  return facts;
}

export function historicalPlanStatus(message,messages=[]) {
  const index=messages.findIndex(m=>m.id===message.id);
  return {failed:/执行结构尚未通过校验/.test(message.text||''),hasLaterPlan:index>=0&&messages.slice(index+1).some(m=>m.result===true)};
}
