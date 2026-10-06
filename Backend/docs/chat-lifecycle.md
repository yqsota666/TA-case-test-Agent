# Chat 封存与关联复测

父 Chat 含多个 Case。人工最终 FAIL 的 Case 保持只读，通过同一父 Chat 下的关联后续 Case 继续讨论；`predecessor_case_id` 指向原 Case，一个来源只能有一个直接后续。后续初始为 DISCUSSING，Plan、草稿和发文不自动复制或确认。来源 Plan 与原始证据仍按原 Case 查询，后续讨论读取同父Chat原FAIL的Plan、人工失败原因、建议和历史证据摘要，作为只读数据传给模型，摘要截断会明确标记；用户修改后重新确认新 Plan。失败后续还可以继续创建下一后续，形成可追溯链。

正常结束要求全部 Case 的状态与人工最终结论一致，且每个 FAIL 都有后续，链末端全部 PASS。保留链中真实 FAIL，不把它们改成 PASS。强制结束必须填写原因，即使未完成也可封存，Case 状态不改。Chat 状态、时间、原因和事件在同事务内写入。所有现有 Case 写仓储均锁定 Chat/Case 后验证 ACTIVE；关闭与正在提交的写操作串行化，模型在关闭前开始但关闭后才提交也不能落库。封存后仍可读取 Plan、讨论、文件与结果，完全相同关闭请求幂等，模式/原因冲突拒绝。

显式 NEW_RUN 仅对已经封存的 Chat 创建新的空白 Chat，不复制 Case，不删除正式账户、交易、持仓、原文件、旧 Plan、历史或结果。必须提交 `confirmPreserveFormalData:true`。它不是 TA 全系统物理清空，也不代表 TA 账号已失效。

## API

所有入口以 HttpOnly 登录会话确定 Workspace。写请求须可信 Origin、JSON 及精确字段。

- GET/POST `/api/chats`：列出当前 Workspace 最近200个 Chat；POST `{title}`。
- GET/POST `/api/chats/:chat/cases`：查询或创建 Case；POST `{title}`。
- GET `/api/chats/:chat/lifecycle`：Chat、所有 Case 状态/人工结论/来源关系、正常结束资格、事件及复测/轮次关联。
- POST `.../lifecycle/close`：`{mode:"NORMAL"}` 或 `{mode:"FORCE",reason}`。
- POST `.../lifecycle/retest`：`{requestId,casePublicId,reason}`，同父 Chat 创建关联 Case。
- POST `.../lifecycle/new-run`：`{requestId,reason,confirmPreserveFormalData:true}`，创建新的空白 Chat。

requestId 为 UUID，按 Workspace/来源 Chat 唯一。相同重试返回既有目标，改变操作、来源 Case 或原因拒绝。请求与创建关联在同事务写入；Chat 行锁与来源后续唯一约束防止重复后续。

迁移020只新增审计关联表，无历史数据更新或清空。MySQL测试覆盖迁移复跑、封存前提、真实状态保留、原有写路径冻结、同父多Case复测、幂等冲突、跨Workspace隔离和全回滚。TA全系统重置另行实现明确的人工已重置事件，不由这个接口冒充。

普通新增Case在Chat已建立发文批次后拒绝，避免新未锁Case卡住已经启动的批次。需要新的独立业务另开Chat；人工失败关联后续仍可在原父Chat下创建，重新确认新Plan之后才发文。

封存之后的HTTP讨论、Plan提案、数据生成/AI修改及申请准备先调用鉴权状态门槛，已存在pending回合的重试也在模型调用前拒绝。历史GET继续开放；封存前已经启动的外部模型请求无法撤回，最终仓储事务仍拒绝它的迟到结果。
