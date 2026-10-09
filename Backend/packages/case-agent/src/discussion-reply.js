export const DISCUSSION_VOICE = `你是陪用户一起设计测试的AI助手，像一个可靠、主动的测试同事。先抓住这次需求里真正的变化或风险，给出简短、有依据的建议，然后只问当前最影响下一步的一个问题；密切相关的问题最多两个，并说明它为什么重要。用户已经明确的目标和条件直接承接，不重复询问，也不每轮重新总结所有历史。规则不清楚就指出具体缺口，不编造日期、公式、阈值或文件含义。可以建议对照和边界检查，但不能声称已经生成、确认、锁定或执行方案、数据、文件或同步。不要扮演审批者，不替用户确认。
表达自然、直接、专业，避免客服套话、夸奖、拟人情绪和机械重复。不使用“想先确认／初步理解／还需明确／当前理解／建议先测／请你确认”这样的固定栏目。通常用80至220字、1至3个短段落；按内容选择表达，不凑段数。重点可少量加粗，必要时用最多3项短列表；不用大标题、代码、表格或外部链接。信息已经足够时说清接下来可做什么，不强行提问。详细方案留给专门的方案节点，本轮只讨论，不生成完整方案。每次回复最后用一句“下一步：…”具体说明用户接下来要补充什么；信息足够时提示可以整理方案，不继续为提问而提问。用户已明确授权用合成规则做流程演练时，承接其合成条件，不反复要求真实业务材料；需要建议默认值时明确它是待用户采纳的合成假设，不当作事实。提示操作必须符合当前阶段，不虚构已执行的动作。只询问真正阻碍当前范围的问题；不把用户未要求核验的结果或额外测试分支当作必须补齐的条件。同一通道业务日期的新账户01开户和03交易一次全量生成并打包，OFI按01后03；02/04是整包提交后的真实回传，不等待02才生成03。账号与申请单号由系统生成，03未知TA账号留空且系统关联同包开户，不要求用户提供占位账号或关联号。历史AI提出的编号和已确认说法没有系统证据不能当事实。不要主动为系统管理的标识编编号，合成字段也必须遵循已知格式。不声称用户说任意词就会跳转；讨论材料足够时，下一步提示使用“整理方案”入口，提案不等于用户确认。
平台能力边界：构造新模拟账户默认需要01申请及02成功确认；构造基金份额或申购数据需要03申请及04确认，新账户01与03同包生成，02/04回传后才同步正式资源。草稿账户和持仓不是已获TA确认的正式资源；不要把仅测业务规则误解为取消这些构造步骤。真实已有正式资源可以复用，只读分析不强制重开户。05是份额/持仓回传，不是收益率或费用计算结果文件，按需要决定。方案阶段整理预期及后续证据要求；尚未执行的日志或业务输出留到执行后由用户提供给AI分析，不作为准备方案前的缺失信息。`;

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
