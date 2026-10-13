# AI 回复 SSE 流式接入

基于已验证的 `codex/compact-test-plan` / `0aa55732`，在独立分支 `codex/streaming-case-replies` 实现。参考 [assistant-ui LangChain 模板](https://github.com/assistant-ui/assistant-ui/tree/main/templates/langchain) 的增量消息更新方式和 [Agent Chat UI](https://github.com/langchain-ai/agent-chat-ui) 的流生命周期；现有服务使用自有持久化、权限和 LangGraph 工作流，采用与其边界一致的 SSE 适配，未直接引入 LangGraph Server SDK。

## 链路

Sophnet SDK `stream: true` → discussion graph 文本 delta → POST `/discussion` SSE → fetch ReadableStream → 当前 assistant-ui 外部消息 runtime。每次 delta 追加在同一回复，刷新后读取完整持久化回合。只展示正文，模型内部推理不转发。

`Accept: text/event-stream` 启用流式模式；未指定时原 JSON 行为保留。事件为 `status`、`delta`（`text`）、`result`、`error`。`result` 只在输出校验及保存完成后发送；连接关闭、终止或缺少最终事件都不能当成成功。心跳间隔 15 秒，响应声明禁止缓存与代理缓冲。中文 UTF-8、跨块边界、CRLF 和多行 data 均由解析器处理。

整理方案采用 `status` 和最终 `result`；内部 JSON 不直接当成聊天正文展示，仍通过方案契约校验并保留准备数据、预期结果两次点击确认。SSE 不缩短业务审核和模型思考过程，因此首段到达时间仍取决于审核、服务和模型。

## 失败与取消

切换 Case、开启新对话及卸载页面会取消当前流，服务端连接关闭会传递 AbortSignal 到模型。发送输入保留既有重试和待完成回合恢复逻辑，部分文本明确提示中断，不能冒充已保存结果。账户归属在请求和每个事件检查。配额仍在完整模型流结束后按最后 usage 结算；流失败沿用不确定调用账本，避免把部分成功误记为免费调用。业务准入、租约和协议校验保留。

## 验证

后端 agent/API/store/协议与前端测试共 418 项：401 通过，17 个依赖显式 MySQL 开关的专项跳过。新增测试覆盖增量正文、最终配额 usage、流中失败、保存前 delta 到达、SSE 错误终止、中文跨字节解析、缺失最终事件。前端生产构建通过，保留既有大 bundle 提示。

真实 Sophnet `DeepSeek-V4-Pro-0813` SDK 调用首段 1874ms、完成 3536ms、57 个增量，拼接一致；实际 API 链（含业务审核与思考）首段 31892ms、保存完成 35657ms、195 个增量，保存正文与 result 一致。这些为本次样本数据，不保证每次延迟。密钥仅从钥匙串读取后进入进程内存。

## 本地预览与回退

预览 Frontend 5204 → API 3111，使用既有本地隔离数据库 `ta_case_agent_chain`。合成验收仅新增 SSE 流式验收项目和普通订单讨论；未点击业务确认或生成 TA 文件。当前 5199/3106 验收入口保持原运行来源，流式候选供本地审阅。启动入口 `.context/streaming/start-preview.py`；本地数据库配置仅存在忽略目录中的 0600 文件，模型密钥不写文件。停止预览只需结束脚本记录的两个进程。回退代码可分别撤销前端和后端提交，旧客户端仍可请求 JSON。
