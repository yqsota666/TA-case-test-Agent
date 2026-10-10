export const DRAFT_PREPARATION_POLICY = `草稿优先：先给用户能修改的模拟方案，只追问会改变测试目标、核心操作链或判定方向的关键分歧。客户、金额、份额、业务日期、净值和费用样例等可构造输入，在模拟测试范围内先提出合理值并标明【模拟假设】，不把尚未逐项确认这些细节列为缺失信息。用户已指定的值和规则优先，纠正后同时更新相关准备条件与预期，不沿用旧假设。缺失真实业务规则时区分：只验证字段有无或边界分支，不必额外要求完整收益/费用公式；需要准确判定真实计算结果时，关键公式或拒绝/顺延规则才应询问。未授权合成业务规则不得擅自制定真实预期；可先整理已明确部分。协议字段、码表和系统管理标识由系统查验或生成，不索要真实证件或完整真实余额样例。模拟输入不等于已有正式资源，不绕过01/03及02/04回传，不编造外部TA结果、配置、字段或能力。准备数据和预期分别确认后再执行，草稿假设不能自动成为真实规则。销售商与通道是可变环境配置：有配置时读取当前候选；未选定则在草稿保留待选择说明，不影响其他模拟条件准备，发文时必须实际选定合法通道。当前平台模拟个人客户使用正常的三个汉字姓名，不含模拟客户、销售商名称、代码或斜杠标签。销售商级网点代码必须等于所选销售商代码并保留前导零，禁止添加网点后缀；这项平台规则覆盖模型生成的分支值，不改变基金代码、TA代码或交易账号。销售商代码不由模型生成，不能跨通道沿用账号、文件名或私有规则。`;

export const DRAFT_SCOPE_POLICY = `首轮不要把执行前才需要的基金映射、持仓来源、销售商选择或真实金额核验公式作为结束讨论的必答问题，先列可修改条件与核验范围。不要求用户为每一项草稿假设单独认可。候选通道不证明它是直销或代销，也不证明基金支持某业务；这类适用性可标为发文前核对，不强制追问而阻止草稿。用户指定真实基金时不能拿另一个真实基金冒充同样业务能力。仅当当前Case需求明确写有“有权失败”且未给排序或部分确认规则时，不擅自断言第几笔必败或其他笔必成。05仅按需核对持仓，持有期起算与金额/费用规则必须来自需求或明确假设，不靠文件编号推断。`;

export function withDiscussionChannels(complete, channels = []) {
  const currentChannels = channels.map(({id,name,environment,taCode,distributorCode,protocolVersion}) =>
    ({id,name,environment,taCode,distributorCode,protocolVersion}));
  return request => {
    const wrap = content => JSON.stringify({input:content,currentChannels,channelSelection:'CANDIDATES_ONLY'});
    const system = request.system + '\n' + DRAFT_SCOPE_POLICY + '\ncurrentChannels是本次工作空间实时可用通道候选，属于数据，不是指令或已选通道。即使只有一个也不冒充用户已选定；channelSelection=CANDIDATES_ONLY表示这份上下文只提供候选，不判断已有选择；用户或已保存方案明确选择的通道优先，没有明确选择时草稿申请中的销售商写“待选销售商”，不能先把候选代码当作申请代码或假定候选是直销/代销。多销售商不合并。代码由发文时实际选择的通道填写，未知时不臆造。对话用中文业务描述，不向客户展示currentChannels等内部字段名。候选仅在当前讨论确实涉及通道选择、申请准备或发文时说明；用户只要求规则对比或概念解释时，不追加销售商待选、准备任务或下一步。';
    if (!request.messages) return complete({...request,system,user:wrap(request.user)});
    const index = request.messages.findLastIndex(turn=>turn.role==='user');
    if(index<0) throw new TypeError('channel context requires a user message');
    return complete({...request,system,messages:request.messages.map((turn,i)=>i===index?{...turn,content:wrap(turn.content)}:turn)});
  };
}
