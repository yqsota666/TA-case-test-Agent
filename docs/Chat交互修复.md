# Chat 交互修复（2026-10-12）

基线 `codex/platform-latest` / aa4a96ff；功能分支 `codex/chat-interaction-fixes`，工作树 `/Users/apple/.codex/worktrees/fixed-workspace-scroll/gf`，本地5199。保持既有材质、布局、双确认及后端能力边界，无后端变更。

- 导航成功后统一提交URL和快照，失败禁用输入并提供所选目标重试；首次加载失败清除旧缓存业务上下文，使用独立首屏重试。
- 草稿与方案确认只更新对应页面请求；文件交换、生命周期、结果核对的异步刷新同样检查页面身份。
- 运行状态按Case及请求登记，旧请求完成不会取消其他Case运行状态或清空其草稿。
- 依真实waiting决定能否聊天，不支持讨论的执行阶段给当前步骤提示；不可执行的动作不提供无效重试。
- 窄屏详情约束键盘焦点，保留summary可达、内嵌dialog行为及关闭后的焦点恢复。锁定方案摘要明确已确认。

验证：47项常规前端测试通过；六尺寸滚动、原输入失败恢复、草稿切换保留、DATA/EXPECTATIONS双确认、文件交换入口回归通过；最终生产构建通过，仍有既有500kB chunk提示。新增长期脚本 `Frontend/scripts/chat-interaction.browser.mjs`，子agent独立运行8组专项（首屏/导航失败重试、确认成功/失败竞态、跨Case并发及旧finally、文件交换旧刷新、执行阶段禁发、手机焦点）全部通过。所有写请求仅合成fixture截获，没有真实Case写入或模型调用。

本地senior-staff-engineer skill独立复审补出的summary不可达、文件交换旧刷新、首屏旧缓存问题已修复，最终无剩余阻断或Important发现。详细审查/截图 `.context/chat-full-review`、`.context/chat-interaction/FIX-REVIEW.md`；生命周期/结果核对同类保护做代码审查，未穷尽所有真实写链路、会话失效/多标签/模型/麦克风/TA端到端。

提交按工作台状态、详情键盘、专项回归分别保存，可独立回滚。未push或创建PR。当前版本供本地验收。
