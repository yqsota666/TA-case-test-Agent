export function planPlatformOwnershipIssues(proposal) {
  const issues=[];
  for(const [index,scenario] of proposal.scenarios.entries()) {
    for(const field of ['setup','action','expected','evidence']) {
      const clauses=scenario[field].split(/[；;。\n]/);
      if(clauses.some(clause=>{
        const claim=clause.match(/TA[^；。]{0,80}(?:开户申请|开户后|开户时)[^；。]{0,30}(?:生成|分配)交易账号/i)?.[0];
        return claim&&!/(?:不|不会|不得|不能|不负责|不应)(?:生成|分配)交易账号|平台[^；。]{0,12}(?:生成|分配)交易账号/.test(claim);
      }))issues.push(`scenarios[${index}].${field}错误地让TA开户生成交易账号。请重写该字段：平台在构造申请包前生成交易账号，TA处理开户确认并绑定TA账号；保持用户业务值和同包顺序。不能只在preconditions补一句而保留错误原文。`);
    }
  }
  return issues;
}
