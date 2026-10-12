import { DRAFT_PREPARATION_POLICY } from './draft-preparation-policy.js';
import {withDiscussionSnapshot} from './discussion-context.js';

export const DISCUSSION_VOICE = `你是陪用户设计测试的主动测试同事。先抓住需求中的变化，提出具体操作或可修改的模拟条件，不把回复写成资料收集表。信息足够时不提问；确实有关键分歧时只问一个决定测试方向的问题，同时推进不依赖答案的部分。承接已给条件和最新纠正，不重复询问，也不循环索要。普通讨论给简短草稿建议，完整结构化方案由方案节点生成，不声称已经生成、确认、锁定、执行或同步。用户允许合成规则时直接采用并标明，不反复索要真实样例。
表达自然、直接、专业，避免客服套话、夸奖、拟人情绪和机械重复。不使用“想先确认／初步理解／还需明确／当前理解／建议先测／请你确认”这样的固定栏目。先直接回答这轮问题，再补充必要依据。简短问题用一至两句；解释问题按需要展开，不用固定字数限制，也不重新复述整段历史。多个情况需要对齐比较时可用精简Markdown表格，共同条件只写一次，列与行随用户实际内容变化。对比表和解释只使用用户给出的规则、输入和预期，不自行补充处理队列、状态机、拒绝原因或系统实现；材料未说明原因时直接说规则如此，不能把猜测写成依据；非对比需求用自然段或短列表。不要把所有回答强制套进固定栏目，短答不用标题；长答只在有助于阅读时使用小标题。重点少量加粗，编号只用于顺序。整理方案通过聊天触发，没有“整理为审阅方案”按钮；需要整理时引导用户直接说“帮我生成这个方案”，不能要求点击不存在的整理入口。数据与预期的确认按钮仍然保留。下一步只在能帮助用户继续操作时自然说明，不每轮添加固定“下一步：”尾句；用户只问解释时不要追加无关任务。信息已足够就承接处理，不强行追问；真正缺失的业务规则问最关键的一项。详细可执行方案仍由专门的方案节点生成，讨论中的建议不冒充已保存方案；状态以系统记录为依据。保留用户编辑和数据、预期两次按钮确认，聊天认可不代表已确认。销售商来自当前工作空间通道，可能有多个且随配置变化；不能固定代码、套用其他Case通道或仅凭基金名称判定销售商。未知TA账号不能模拟，账号和申请关联由系统处理，不要求用户提供占位编号。详细能力和协议限制不能通过合成假设绕过。
平台能力边界：构造新模拟账户默认需要01申请及02成功确认；构造基金份额或申购数据需要03申请及04确认，新账户01与03同包生成，02/04回传后才同步正式资源。草稿账户和持仓不是已获TA确认的正式资源；不要把仅测业务规则误解为取消这些构造步骤。真实已有正式资源可以复用，只读分析不强制重开户。05是份额/持仓回传，不是收益率或费用计算结果文件，按需要决定。方案阶段整理预期及后续证据要求；尚未执行的日志或业务输出留到执行后由用户提供给AI分析，不作为准备方案前的缺失信息。` + '\n' + DRAFT_PREPARATION_POLICY;
function invalidReply(reason) {
  throw Object.assign(new Error('讨论回复未通过校验'),{code:'MODEL_OUTPUT_FORMAT',validationReason:reason});
}
export function checkDiscussionReply(reply,{planAvailable=false,snapshot}={}) {
  if(typeof reply!=='string'||!reply.trim()) invalidReply('EMPTY');
  reply=reply.replace(/\r\n/g,'\n').replace(/[ \t]+(?=\n|$)/g,'').trim();
  if(reply.length>4000) invalidReply('LENGTH');
  if(/<\/?[A-Za-z][^>]*>/.test(reply)) invalidReply('UNSAFE_MARKUP');
  if(/(?:我|我们|本助手|本系统|系统|AI)\s*(?:已|已经|现已)[^。！？\n]{0,20}(?:生成|制定|锁定|执行|提交|启动|完成|定稿|锁好|生成好|执行完)/i.test(reply)) invalidReply('UNVERIFIED_ACTION');
  if(/(?:Plan|SOP|方案|测试)[^。！？\n]{0,6}(?:已|已经|现已)(?:生成|锁定|执行|完成|定稿)/i.test(reply) &&
     !(planAvailable && !/(?:已|已经|现已)(?:锁定|执行|完成|定稿)/.test(reply))) invalidReply('UNVERIFIED_ACTION');
  if(snapshot?.stage==='DISCUSSION' && snapshot.plan?.status==='DRAFT') {
    const sentences=reply.split(/[。！？\n]/);
    if(sentences.some(t=>/(?:下一步|请|需要|可以|先|再|直接|接下来)[^。\n]{0,40}(?:点击|点)[^。\n]{0,10}(?:确认预期|确认准备数据|生成文件|生成数据)/.test(t) && !/(不能|不要|不可|暂不|不应|不是)/.test(t)))invalidReply('STALE_STAGE_ACTION');
  }
  return reply;
}
export async function completeDiscussionReply(complete,request,context={}) {
  const contextual=withDiscussionSnapshot(request,context.snapshot);
  const evidenceHint='\n最后核对：用户只给允许或拒绝时，只陈述原有状态与允许/拒绝，不升级为已成功/失败，不解释队列、处理环节、原因或执行机制。材料未给原因时明确材料未说明原因；也不能根据状态名称推断是否终态等未提供的属性。对比表不增加重复含义的列。用户只要解释时，只回答区别，不额外报告阶段、确认状态或安排下一步。';
  const stageHint=context.snapshot?.plan?.status==='DRAFT'?' 当前保存的是草稿，下一步可按已有条件整理成审阅方案。用户只问下一步时，用一至两句说明当前可做的动作；条件已明确时不要求继续讨论，不重复整份条件，不展开审阅后的确认或执行动作。只有确实缺失关键业务规则时才说明问题；禁止提示点击确认预期或生成文件。':'';
  const offerHint=context.offerPlan?' 下一步已可建议整理现有讨论。自然说明可按已有条件生成审阅方案，用户可以说“帮我生成这个方案”等自然语言；不要把具体说法当固定口令，不要求用户再次逐项认可已给条件，不重复下一步提示。':'';
  const exchangeHint=context.snapshot?.exchange?.status==='NOT_REQUIRED'?' 当前方案明确不走TA文件链路；回复不得安排现在或未来生成、提交TA文件，不能说确认预期后生成文件，也不追加发文通道或销售商待选任务。':'';
  for(let attempt=0;attempt<2;attempt++) {
    try{
      if(attempt)await request.onReset?.();
      const reply=await complete({...contextual,system:contextual.system+evidenceHint+(context.planAvailable?'\n系统已核实当前Case存在方案；可以引用已有方案供用户查看，不代表本轮新建、确认或执行方案。':'')+stageHint+exchangeHint+offerHint+(attempt?'\n上一条回复未通过讨论校验。请简洁回答原问题，不声称本轮已执行任何操作；已有方案可称为待审阅方案。只返回给用户的答复。'+stageHint+exchangeHint:'')});
      return checkDiscussionReply(reply,context);
    }catch(error){
      if(!['MODEL_OUTPUT_FORMAT','MODEL_EMPTY_OUTPUT'].includes(error.code))throw error;
      console.warn(JSON.stringify({event:'discussion_reply_rejected',reason:error.validationReason||'EMPTY',attempt:attempt+1}));
      if(attempt===1)throw error;
    }
  }
}
