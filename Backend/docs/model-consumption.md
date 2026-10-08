# 模型总消耗额度

所有 HTTP 请求中的模型调用共享登录上下文与调用计数。审核、图片识别、讨论、Plan/结构化转换、方案审阅、旧版数据/申请生成、结果分析及显式重试都经过同一个运行层。无需模型的历史查看、取消和确认操作不受 AI 额度耗尽影响。未经服务端登录上下文的模型调用直接拒绝。

调用前用 UTF-8 字节上界估算文本输入，每张图片预留 131072 token，再加最大输出额度；在短事务中同时锁定全局、用户与工作空间日额度，预留成功才发送模型请求。图片预算是保守配置估计，不是供应商承诺的精确计费上界。返回后记录模型、用途、输入/输出和完整 usage；实际消耗若高于预留仍全额入账，后续调用受剩余额度限制。SDK 自动重试禁用，现有显式重试各自计费。

额度日按 Asia/Shanghai 的日历日计算。预算状态存于 MySQL，多进程共用；固定互斥桶避免跨零点并发限制竞争。并发租约180秒，供应商请求超时90秒。进程崩溃的预留不自动退款；超时、无 usage 或不合法 usage 标记 UNCERTAIN，按预留额保守扣除。管理员核实供应商消耗后才能处理未知账目。SETTLED/UNCERTAIN 重复结算幂等；账本不保存会话令牌、模型输入或输出。

默认配置（均为正整数）：

| 环境变量 | 默认值 | 作用 |
|---|---:|---|
| MODEL_USER_DAILY_TOKENS | 500000 | 用户每日总 token |
| MODEL_WORKSPACE_DAILY_TOKENS | 2000000 | 工作空间每日总 token |
| MODEL_GLOBAL_DAILY_TOKENS | 10000000 | 所有账户每日总 token，限制新账号绕过 |
| MODEL_USER_CONCURRENT | 2 | 用户同时进行的模型调用 |
| MODEL_WORKSPACE_CONCURRENT | 4 | 工作空间同时调用 |
| MODEL_GLOBAL_CONCURRENT | 8 | 全局同时调用 |
| MODEL_USER_CALLS_PER_MINUTE | 30 | 用户短时限流 |
| MODEL_GLOBAL_CALLS_PER_MINUTE | 120 | 全局短时限流 |
| MODEL_RUN_MAX_CALLS | 8 | 一个 HTTP 操作内全部调用及重试上限 |
| MODEL_MAX_INPUT_TOKENS | 600000 | 单次保守输入估计上限 |
| MODEL_MAX_OUTPUT_TOKENS | 8192 | 供应商 max_tokens 上限 |

这是输入与输出 token 的累计控制，不冒充人民币费用账单；缓存和推理细节保留在 usage_json 供核算。默认值是初始保护配置，需要按实际业务负载调节。多图片或较大上下文可能因预留额度不足而被拒绝，即使实际处理可能更便宜。

回滚：先撤销本功能代码，027表可以保留；业务准入 PR 可独立保留。保留未知消耗记录，不通过删表或新建 Case 重置额度。独立 MySQL 验收入口 CASE_BUDGET_MYSQL=1，需使用新迁移已完成的合成验收库，禁止生产库压测。
