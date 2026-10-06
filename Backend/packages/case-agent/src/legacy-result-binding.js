import {validDate} from '../../platform-protocol/src/exchange-plan.js';
import {numericQuoteBindingSpans,hasLiteralExpectation} from '../../platform-protocol/src/numeric-expectations.js';
const labels={status:'最终状态|申请状态|确认状态|状态|status',returnCode:'TA返回代码|返回代码|返回码|结果代码|结果码|错误代码|错误码|returnCode',transactionAccountId:'交易账户号|交易账号|交易账户|销售账号|账号|transactionAccountId',taAccountId:'TA账户号|TA账号|TA账户|TA号|taAccountId',fundCode:'基金代码|基金编码|基金|fundCode',shareClass:'份额类别|份额分类|shareClass',branchCode:'网点编号|网点代码|网点|branchCode',snapshotDate:'确认日期|快照日期|业务日期|快照日|日期|snapshotDate',channelId:'通道编号|通道号|通道|channelId'};
const marker=new RegExp(Object.values(labels).join('|'),'gi');
const connector='(?:\\s|[=:：,，]|均为|应为|应该为|应当为|为|是|等于)*';
export function legacyExpectationBindings(expected){
 const text=String(expected),matches=[...text.matchAll(marker)],bindings=[];let residual=text;
 for(let i=0;i<matches.length;i++){
  const m=matches[i],field=Object.keys(labels).find(k=>new RegExp(`^(?:${labels[k]})$`,'i').test(m[0]));
  const tail=text.slice(m.index+m[0].length,matches[i+1]?.index),parsed=tail.match(new RegExp('^'+connector+'([A-Za-z0-9_-]+|成功|失败)(?![A-Za-z0-9_.+-])'));
  const value=field==='status' && ['成功','失败'].includes(parsed?.[1])?(parsed[1]==='成功'?'CONFIRMED':'FAILED'):parsed?.[1];
  if(!value || /[?？]|吗|是否|还是|或|\bor\b|[\/|]/i.test(tail.split(/[，,。；;、\n]/)[0]) || /不|未|没有|非|\bnot\b/i.test(text.slice(0,m.index).split(/[，,。；;、\n]/).at(-1)))continue;
  if(field==='status' && !['CONFIRMED','FAILED','READY','BATCHED','GENERATED','DELIVERED','WAITING_RETURN','CANCELED'].includes(value))continue;
  if(['transactionAccountId','channelId','returnCode','fundCode','snapshotDate','branchCode'].includes(field) && !/^\d+$/.test(value))continue;
  if(field==='snapshotDate' && !validDate(value))continue;
  const raw=m[0]+parsed[0];
  bindings.push({field,value});residual=residual.replace(raw,'');
 }
 // Business outcome shorthand is recognized only as a positive, unqualified clause.
 for(const m of text.matchAll(/(?:开户|申购|申请|确认)(成功|失败)/g)){
  const clause=text.slice(0,m.index).split(/[，,。；;、\n]/).at(-1)+text.slice(m.index).split(/[，,。；;、\n]/)[0];
  if(/[?？]|吗|是否|不|未|没有|非|还是|或/.test(clause))continue;
  bindings.push({field:'status',value:m[1]==='成功'?'CONFIRMED':'FAILED',...(m[0].startsWith('申购')?{fileType:'03'}:m[0].startsWith('开户')?{fileType:'01'}:{})});residual=residual.replace(m[0],'');
 }
 for(const b of numericQuoteBindingSpans(text))residual=residual.replace(text.slice(b.start,b.end),'');
 for(const b of bindings.filter(b=>b.field==='status'))residual=residual.replace(new RegExp('^[\\s，,。；;、：:]*'+b.value+'(?=$|[\\s，,。；;、：:])'),'');
 residual=residual.replace(/场景\d+|申请|开户|申购|最终|正式|均|应|结果|账户/g,'').replace(/[\s，,。；;、：:()（）]/g,'');
 return {bindings,recognized:!residual.length};
}
export function legacyBindingIssues(snapshot,checks,scenarioIndex){
 const expected=snapshot.plan.scenarios[scenarioIndex].expected,{bindings,recognized}=legacyExpectationBindings(expected),issues=[];
 if(!recognized)issues.push(`场景${scenarioIndex+1}的自然语言预期不能完整确定，请澄清`);
 const covered=checks.filter(c=>c.scenarioIndex===scenarioIndex);
 const selected=[...new Map(covered.map(c=>{const e=snapshot.evidence.find(e=>e.id===c.evidenceId);return [e?.id,e];})).values()].filter(Boolean);
 if(selected.length>1){
  for(const field of ['transactionAccountId','channelId']){
   const values=selected.map(e=>field==='channelId'?e.source.channelId:e.values[field]);
   if(values.some(v=>v===null || v===undefined || v==='') || new Set(values.map(String)).size!==1)issues.push(`场景${scenarioIndex+1}的跨来源${field}不能证明一致`);
  }
  const fundEvidence=selected.filter(e=>e.source.kind==='CURRENT_FORMAL_HOLDING' || e.source.kind==='HOLDING' || (e.source.kind==='APPLICATION_CONFIRMATION' && e.source.fileType==='03'));
  for(const field of ['fundCode','shareClass'])if(fundEvidence.length>1){
   const values=fundEvidence.map(e=>e.values[field]);
   if(values.some(v=>v===null || v===undefined || v==='') || new Set(values.map(String)).size!==1)issues.push(`场景${scenarioIndex+1}的跨来源${field}不能证明一致`);
  }
 }

 for(const c of covered){
  const source=snapshot.evidence.find(e=>e.id===c.evidenceId);
  const candidates=snapshot.evidence.filter(e=>e.source.kind===source?.source.kind && Object.hasOwn(e.values,c.field) &&
   (!bindings.some(b=>b.fileType) || e.source.kind!=='APPLICATION_CONFIRMATION' || e.source.fileType===source.source.fileType) && bindings.every(b=>{
   if(!['transactionAccountId','fundCode','shareClass','snapshotDate','channelId'].includes(b.field))return true;
   const value=b.field==='channelId'?e.source.channelId:b.field==='snapshotDate'?(e.values.snapshotDate??e.source.businessDate):e.values[b.field];return String(value??'')===b.value;
  }));
  if(candidates.length!==1)issues.push(`场景${scenarioIndex+1}的${c.field}来源不能唯一确定`);
 }
 for(const b of bindings){
  if(['transactionAccountId','fundCode','shareClass','snapshotDate','channelId'].includes(b.field)){
   if(!covered.length || covered.some(c=>{const e=snapshot.evidence.find(e=>e.id===c.evidenceId);const value=b.field==='channelId'?e?.source.channelId:b.field==='snapshotDate'?(e?.values.snapshotDate??e?.source.businessDate):e?.values[b.field];return String(value??'')!==b.value;}))issues.push(`场景${scenarioIndex+1}的${b.field}证据归属不符或无法证明`);
  }else if(!covered.some(c=>c.field===b.field && c.operator==='eq' && c.expectedValue===b.value && (!b.fileType || snapshot.evidence.find(e=>e.id===c.evidenceId)?.source.fileType===b.fileType)))issues.push(`场景${scenarioIndex+1}的${b.field}明确预期尚未核验`);
 }
 return issues;
}
export function legacyLiteralMatches(value,quote,field){
 return hasLiteralExpectation(value,quote,field) || legacyExpectationBindings(quote).bindings.some(b=>b.field===field && b.value===value);
}
