# 明确确认真实 TA 已重置

此功能记录“操作者已经在外部 TA 完成重置”的事实，平台不会调用或冒充真实 TA 清空。与 NEW_RUN（空白新 Chat）分开，后者不会让账户失效。

- GET `/api/exchange/channels/:channelId/ta-reset` 返回当前 epoch、所有原因/时间与账户截止ID。
- POST `.../ta-reset/confirm`：`{requestId,reason,confirmation:"TA_RESET_CONFIRMED"}`。可信 Origin、登录 Workspace、精确 JSON 字段和显式确认必需。

确认前必须先封存当前 Workspace 全部 Chat，避免跨Case共享正式账户仍在交易。事务先锁所有 Chat，再锁该通道，检查幂等请求并记录递增 epoch 和此时正式账户最大ID。相同请求返回旧事件；改变原因拒绝。锁序与业务写路径一致；封存期间迟到的模型结果仍不能提交。

原有正式账户、交易、持仓、TA绑定和原始证据全部保留，按当前epoch截止ID将旧账户绑定视为失效。销售查询返回 `taBindingActive`，原证据仍可查询；新Case不能选旧账户，申请准备不能复用旧引用，03及非开户01的仓储申请校验会拒绝旧绑定，04落账与05同步也检查失效。新01/02重新开户生成新的销售交易账号/正式账户ID，可继续使用。不会修改旧账户的原确认身份；旧账号再次开户不支持覆盖，须新账号，符合现有正式账户唯一约束。

迁移022只新增审计表，不改写或删除历史数据。此事件是用户明确声明，平台不能证明外部 TA 真实清空，响应持续标明 `physicalResetPerformedByPlatform:false`。仅当前两个支持的业务（开户与申购）有账务效果，其他业务仍拒绝。

真实MySQL测试覆盖活动Chat阻断、封存后事件、幂等/冲突、跨Workspace隔离、旧账户失效、新账户有效以及历史交易/持仓逐项不变。

重置等待Chat/通道锁之后，对重复请求、最新epoch及正式账户cutoff使用当前锁定读，避免REPEATABLE READ的鉴权旧快照漏掉并发提交。独立真实双连接测试让鉴权完成后等待Chat锁，再提交重置事件；相同requestId返回duplicate，下一请求使用新epoch。测试使用合成记录并清理，新数据库迁移/复跑及原有确认链同时通过。
