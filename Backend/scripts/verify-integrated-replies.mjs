import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createSophnetCompletion} from '../packages/case-agent/src/sophnet.js';
import * as candidate from '../packages/case-agent/src/discussion-reply.js';
import {withDiscussionChannels} from '../packages/case-agent/src/draft-preparation-policy.js';
import {discussionSnapshot} from '../packages/case-agent/src/discussion-context.js';

if(!process.env.SOPHNET_API_KEY)throw new Error('SOPHNET_API_KEY is required in process memory');
const complete=withDiscussionChannels(createSophnetCompletion({maxTokens:1800}),[]);
const initial={chatStatus:'ACTIVE',caseStatus:'DISCUSSING',plan:null,dataConfirmed:false,generated:false,draftConfirmed:false,
  proven:{result:{evaluated:false,confirmed:false,verdict:null}}};
const proposal={objective:'核对不同订单状态下的可撤销行为',preconditions:['同通道、同业务日期、同账户和金额，只改变订单状态'],scenarios:[
  {title:'待受理',setup:'订单状态为待受理',action:'请求撤销',expected:'允许撤销',evidence:'订单响应'},
  {title:'处理中',setup:'订单状态为处理中',action:'请求撤销',expected:'拒绝撤销',evidence:'订单响应'}],openQuestions:[],exchangePlan:{status:'NOT_REQUIRED',openQuestions:[]}};
const partial={...initial,caseStatus:'SOP_PENDING',dataConfirmed:true,plan:{status:'DRAFT',version:1,proposal}};
const exchangeProposal={...proposal,exchangePlan:{status:'READY',openQuestions:[],steps:[
  {stepId:'a',direction:'SEND',fileType:'01',required:true,businessTime:{kind:'DATE',value:'20261012'},dependsOn:[]},
  {stepId:'b',direction:'SEND',fileType:'03',required:true,businessTime:{kind:'DATE',value:'20261012'},dependsOn:[]},
  {stepId:'c',direction:'RECEIVE',fileType:'02',required:true,businessTime:{kind:'DATE',value:'20261013'},dependsOn:[{stepId:'a',condition:'SENT'}]},
  {stepId:'d',direction:'RECEIVE',fileType:'04',required:true,businessTime:{kind:'DATE',value:'20261013'},dependsOn:[{stepId:'b',condition:'SENT'}]}]}};
const exchange={...initial,caseStatus:'EXECUTING',dataConfirmed:true,generated:true,draftConfirmed:true,
  plan:{status:'LOCKED',version:1,proposal:exchangeProposal},order:{version:1,plan:exchangeProposal.exchangePlan,events:[]},
  fileArtifacts:[{fileType:'01',fileName:'synthetic-01.txt',businessDate:'20261012',status:'GENERATED',packaged:true},
    {fileType:'03',fileName:'synthetic-03.txt',businessDate:'20261012',status:'GENERATED',packaged:true}]};
const examples=[
  {id:'two',label:'两组条件对比',question:'合成演练：同一个账户、金额和日期，订单待受理时允许撤销，处理中时拒绝撤销。用一个小表对齐这两种情况，只解释差异，不生成方案。',facts:initial},
  {id:'four',label:'四组条件对比',question:'合成规则：待受理允许撤销；处理中、已成交、已撤销均拒绝。其他可控条件相同，请用表格对齐四种状态和预期，不增加额外业务规则。',facts:initial},
  {id:'long',label:'长文本与缺失信息',question:'以下是合成需求材料：'+('同通道、同业务日期、同账户与金额；这里只改变订单状态。'.repeat(22))+'已知待受理允许撤销、处理中拒绝；失败后的恢复规则未提供。只指出真正缺少的规则，不重新问账户、日期和金额，不自行填规则。',facts:initial},
  {id:'explain',label:'普通解释',question:'准备数据和预期结果有什么区别？简单解释就好，不需要给我安排下一步。',facts:initial},
  {id:'confirmation',label:'历史确认与当前草稿',question:'现在到哪一步？下一步该做什么？',facts:partial,history:[{role:'user',content:'准备数据我已点确认。'},{role:'assistant',content:'方案已经全部确认，可以生成文件了。'}]},
  {id:'package',label:'已生成包与实际交付',question:'文件现在到哪一步？已经提交TA了吗？下一步该做什么？',facts:exchange,history:[{role:'user',content:'ZIP已经生成，但我还没有交付给TA。'},{role:'assistant',content:'文件已提交，等回传就可以。'}]},
];
const selected=process.env.COMPARE_IDS?.split(',');
const previous=selected?JSON.parse(await readFile(new URL('../../.context/replies/results.json',import.meta.url),'utf8')):null;
const results=examples.map(e=>({id:e.id,label:e.label,question:e.question,history:e.history??[],snapshot:discussionSnapshot(e.facts),outputs:previous?.results.find(r=>r.id===e.id)?.outputs??{}}));
const record={baseline:'92e1f738',model:'DeepSeek-V4-Pro-0813',thinking:'disabled',synthetic:true,createdAt:new Date().toISOString(),results};
const dest=new URL('../../.context/replies/results.json',import.meta.url);
async function run(index,variant){
  const e=examples[index],row=results[index],implementation=candidate;
  const started=performance.now();let first,raw='',repairs=0;const attempts=[];
  try{
    const reply=await implementation.completeDiscussionReply(async request=>{const answer=await complete(request);attempts.push(answer);return answer;},{system:implementation.DISCUSSION_VOICE+'\n阅读完整对话，以用户最新纠正为准。承接上轮问题的答案，不重复索要已提供的信息。',
      messages:[...(e.history??[]),{role:'user',content:e.question}],thinkingMode:'disabled',onReset:()=>{raw='';repairs++;},onDelta:delta=>{first??=performance.now();raw+=delta;}},
      {planAvailable:Boolean(e.facts.plan),...(variant==='candidate'?{snapshot:row.snapshot}:{})});
    row.outputs[variant]={capturedAt:new Date().toISOString(),text:reply,totalMs:Math.round(performance.now()-started),firstMs:Math.round((first??performance.now())-started),streamMatches:raw.trim()===reply,repairs,
      hasTable:/\|[^\n]+\|\s*\n\s*\|?[ :|-]+\|/.test(reply),fixedNextStep:/下一步[：:]/.test(reply)};
  }catch(error){row.outputs[variant]={error:error.code??'ERROR',text:error.message};}
  row.outputs[variant].attempts=attempts;
  await writeFile(dest,JSON.stringify(record,null,2));
  console.log(`${row.id} ${variant}: ${row.outputs[variant].error??'OK'}`);
}
const tasks=results.flatMap((row,i)=>selected&&!selected.includes(row.id)?[]:['candidate'].map(v=>()=>run(i,v)));
let next=0;
await Promise.all([0,1].map(async()=>{while(next<tasks.length){const task=tasks[next++];await task();}}));
await mkdir(new URL('../../.context/replies/',import.meta.url),{recursive:true});
await writeFile(new URL('../../.context/replies/results.json',import.meta.url),JSON.stringify(record,null,2));
console.log('Integrated synthetic replies saved; no Case was created or changed.');
