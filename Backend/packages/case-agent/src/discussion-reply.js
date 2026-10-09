import { DRAFT_PREPARATION_POLICY } from './draft-preparation-policy.js';

export const DISCUSSION_VOICE = `你是陪用户设计测试的主动测试同事。先抓住需求中的变化，提出具体操作或可修改的模拟条件，不把回复写成资料收集表。信息足够时不提问；确实有关键分歧时只问一个决定测试方向的问题，同时推进不依赖答案的部分。承接已给条件和最新纠正，不重复询问，也不循环索要。普通讨论给简短草稿建议，完整结构化方案由方案节点生成，不声称已经生成、确认、锁定、执行或同步。用户允许合成规则时直接采用并标明，不反复索要真实样例。
表达自然、直接，通常1至3个短段落，可少量加粗或短列表，不用固定栏目、客服套话或内部字段名。结尾说系统可继续准备什么或用户可修改什么，不要求每轮都补信息。保留用户编辑和数据、预期两次按钮确认，聊天认可不代表已确认。销售商来自当前工作空间通道，可能有多个且随配置变化；不能固定代码、套用其他Case通道或仅凭基金名称判定销售商。未知TA账号不能模拟，账号和申请关联由系统处理，不要求用户提供占位编号。详细能力和协议限制不能通过合成假设绕过。
平台能力边界：构造新模拟账户默认需要01申请及02成功确认；构造基金份额或申购数据需要03申请及04确认，新账户01与03同包生成，02/04回传后才同步正式资源。草稿账户和持仓不是已获TA确认的正式资源；不要把仅测业务规则误解为取消这些构造步骤。真实已有正式资源可以复用，只读分析不强制重开户。05是份额/持仓回传，不是收益率或费用计算结果文件，按需要决定。方案阶段整理预期及后续证据要求；尚未执行的日志或业务输出留到执行后由用户提供给AI分析，不作为准备方案前的缺失信息。` + '\n' + DRAFT_PREPARATION_POLICY;

function invalidReply(reason) {
  throw Object.assign(new Error('讨论回复未通过校验'),{code:'MODEL_OUTPUT_FORMAT',validationReason:reason});
}
export function checkDiscussionReply(reply,{planAvailable=false}={}) {
  if(typeof reply!=='string'||!reply.trim()) invalidReply('EMPTY');
  reply=reply.replace(/\r\n/g,'\n').replace(/[ \t]+(?=\n|$)/g,'').trim();
  if(reply.length>4000) invalidReply('LENGTH');
  if(/<\/?[A-Za-z][^>]*>/.test(reply)) invalidReply('UNSAFE_MARKUP');
  if(/(?:我|我们|本助手|本系统|系统|AI)\s*(?:已|已经|现已)[^。！？\n]{0,20}(?:生成|制定|锁定|执行|提交|启动|完成|定稿|锁好|生成好|执行完)/i.test(reply)) invalidReply('UNVERIFIED_ACTION');
  if(/(?:Plan|SOP|方案|测试)[^。！？\n]{0,6}(?:已|已经|现已)(?:生成|锁定|执行|完成|定稿)/i.test(reply) &&
     !(planAvailable && !/(?:已|已经|现已)(?:锁定|执行|完成|定稿)/.test(reply))) invalidReply('UNVERIFIED_ACTION');
  return reply;
}
export async function completeDiscussionReply(complete,request,context={}) {
  for(let attempt=0;attempt<2;attempt++) {
    try{
      const reply=await complete({...request,system:request.system+(context.planAvailable?'\n系统已核实当前Case存在方案；可以引用已有方案供用户查看，不代表本轮新建、确认或执行方案。':'')+(attempt?'\n上一条回复未通过讨论校验。请简洁回答原问题，不声称本轮已执行任何操作；已有方案可称为待审阅方案。只返回给用户的答复。':'')});
      return checkDiscussionReply(reply,context);
    }catch(error){
      if(!['MODEL_OUTPUT_FORMAT','MODEL_EMPTY_OUTPUT'].includes(error.code))throw error;
      console.warn(JSON.stringify({event:'discussion_reply_rejected',reason:error.validationReason||'EMPTY',attempt:attempt+1}));
      if(attempt===1)throw error;
    }
  }
}
