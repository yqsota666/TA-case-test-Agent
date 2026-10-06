# Case 耐久等待恢复编排

当前完整流程以[Case全流程设计](../../docs/Case全流程设计.md)和[Backend说明](../README.md)为准；本文件以下测试计数记录模块各次引入时的验证，最终整体验证见验收报告。

Case图包含 `reconcile_committed_business → 对应阶段等待节点 → reconcile_committed_business` 循环。前者读取认证范围内业务SQL，等待节点使用原生LangGraph `interrupt`；通知用 `Command({resume})` 恢复。MySQL保存LangGraph checkpoint、pending writes和事件响应，进程重启后继续原来的等待点。

等待阶段覆盖讨论、Plan数据确认、Plan预期确认、准备草稿、草稿确认、文件时序补充、文件交换、结果判断、人工确认结果、Case最终及Chat关闭。文件交换返回多个同时可以处理的step；01/03是否相依、独立05位于哪个时间点，始终由用户已确认Plan DAG与SQL SENT/PARSED/CONFIRMED事件决定。

GET `/api/chats/:chat/cases/:case/workflow` 认证后对账并返回 `{stage,waiting,revision,checkpointId,interrupted}`。POST同一路径 `/resume` 接收且仅接收 `{eventId:UUID,expectedStage:string}`：这是通知重新读取已提交SQL，不接受客户端提供业务事实，不代替文件上传、解析、应用和人工确认。前端先调用既有业务API，再通知恢复；漏通知可以由下次读取恢复。故障不会重复执行模型或正式数据修改。`expectedStage`记录发起通知时看到的阶段；若其他读取已推进checkpoint，仍按当前已提交事实返回最新阶段。同一`eventId`重放必须保留原`expectedStage`，更改内容仍返回事件冲突。

每个workspace/chat/case独立thread，服务端计算线程名；每次读和恢复重新鉴权。跨实例使用MySQL会话锁序列化，checkpoint和事件响应在同事务提交，同UUID重复恢复返回原响应；相同UUID不同内容拒绝。锁等待超时返回可重试409。GET对账只保存内部工作流状态，不修改关闭Chat的业务事实。checkpoint容量16MiB，超过明确拒绝，原状态事务回滚；未提供历史删除接口。

现有业务服务仍负责LLM及SQL副作用，本图是耐久协调器，不会主动点击用户确认，不会自动模拟TA文件，也不会把零五强行排列在线性链上。讨论的模型pending/retry机制仍由原服务维护。

实际图有九个独立interrupt等待节点：discussion、confirm_plan_data、confirm_expectations、prepare_data、confirm_draft、define_exchange_order、file_exchange、evaluate_result、confirm_result。每个等待点恢复后重新读取SQL事实，而非接受用户提交的“成功”。

02/04已实际应用且全部相关申请为CONFIRMED或FAILED时，该接收步骤完成；失败不满足后续要求CONFIRMED的成功依赖。05完成来自独立解析记录的applied_at，而非伪造TA成功事件。对同Case、当前计划且精确关联账户的已应用失败02，如果它使必需03/04无法执行，协调器将该业务阻断证据带入结果核对；人工PASS被拒绝，人工FAIL后可关联后续Case。未应用的失败仍等待，不相关或全部可选分支的失败不阻断其他必需步骤；可选03桥接到必需04仍纳入依赖闭包。证据关联不唯一、任一501哨兵提示查询超过500项或证据已变化时需要REVIEW，不能依据部分证据完成流程。不会放行03、伪造未来回传或修改正式数据。

验证：191常规测试通过，5个MySQL选测默认跳过；单独真实MySQL测试覆盖新库/复跑、图服务重建、同UUID双实例恢复、checkpoint与事件写入中途失败回滚、锁竞争超时和恢复、双确认→草稿→文件等待、跨workspace/chat隔离、过期会话、关闭后只读。使用可删除独立数据库，不写运行业务库。

阶段只由required步骤阻挡。必需步骤完成后，未上传的可选05不阻止结果评估；合法可操作的可选步骤单独返回optionalActions，未满足依赖不提供操作。DRAFT旧Plan始终回到讨论/重新提案；只有PENDING_CONFIRMATION进入两段确认。

结果确认阶段要求最新建议为PASS/FAIL，并在相同事务复用结果仓储重新收集当前完整证据：Plan版本、证据SHA必须一致，无pending/issues。旧证据、WAITING或REVIEW建议都返回EVALUATE_RESULT，不能以“有一条review”推断可确认。业务最终确认仍独立再次检查证据，防止读取之后发生变化。

补充验证：193常规测试通过；独立MySQL增加仅可选05未上传仍进入评估、当前PASS建议可确认、证据定义变化后退回评估、最新REVIEW不可确认。合成review元数据仅用于状态协调测试，不声称模型或业务判定验收。

通知eventId严格接收字符串UUID，存储统一小写；在当前workspace/chat/case内以大小写无关的锁读兼容历史大写。原通知expectedStage不可变，大小写重放不新增事件。若历史已存在多个大小写变体，明确返回WORKFLOW_EVENT_CONFLICT，不重写旧响应或猜测原通知。真实MySQL覆盖双实例混合大小写、历史大写重放、内容冲突及歧义拒绝；原封存拒绝和过期阶段对账行为保留。
