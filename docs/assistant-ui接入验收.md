# assistant-ui 本地接入验收

日期：2026-10-08。分支：`codex/assistant-ui`。仅本地实现，等待用户验收。

## 基线与回滚

工作树：`/Users/apple/.codex/worktrees/assistant-ui/gf`。
平台提交基线为 `bf71011a`，当前使用中的紧凑布局调整另存为 `2c3201ca`。原平台工作树及其未提交内容保持原状。
assistant-ui 接入作为随后单独的功能提交；回滚该功能提交即可返回 `2c3201ca` 界面基线。原5195入口继续保留，无需切换或清理根目录。

真实预览：`http://127.0.0.1:5197/?theme=liquid`，代理到现有API3104。
合成组件验收：`http://127.0.0.1:5198/test/assistant-ui.html?theme=liquid`。该测试入口拦截全部接口请求，不连接业务API；不进入生产构建入口。

## 可审阅设计与实现

将界面理解为内部测试人员的对话工作台，沿用用户已有的液态玻璃主页面；ENERGY 1 / RHYTHM 2 / MOTION 2。

- 颜色、材质、字体：继承已有主题，以保持主页面连续性；中文系统字体用于长业务文本阅读。
- 排版：用户消息保留气泡，回答保持全文排版，业务方案仍用现有卡片与弹窗，区分文字讨论和需要审阅的产物。
- 间距：沿用当前内容宽度与紧凑断点，避免组件包引入另一套页面布局。
- 新按钮：仅在向上阅读时显示“回到最新消息”，下箭头说明滚动方向；44像素触达面积便于操作。
- 动作：输入框交给assistant-ui处理自适应高度与键盘提交，保留发送箭头、可见焦点及既有反馈；不增加装饰性动画。
- 状态：模型等待使用真实后端请求状态，不生成逐字输出或虚构工具执行轨迹。

使用固定版本 `@assistant-ui/react 0.15.25`，通过 `useExternalStoreRuntime` 适配现有消息状态。实际渲染使用 `ThreadPrimitive`、`MessagePrimitive` 与 `ComposerPrimitive`。
后端协议、LangGraph编排及准备数据/预期结果两次点击确认不变。既有Markdown与复制逻辑继续使用，不引入另一个消息存储或云服务。

每个Case及新对话草稿使用独立runtime；无业务元数据的临时消息有安全兼容处理，空临时回答不显示复制按钮。
新增视图请求序号，旧Case请求或轮询返回不覆盖新Case页面；创建Case后失败也保留输入，成功后清空相应草稿。

## 验证证据

- 前端24项常规测试通过；生产构建通过。
- 真实页面经现有业务API完成一次Sophnet讨论请求，收到中文回答，刷新后保留两条消息；成功后输入框为空。调用前已验证钥匙串可读取，未打印或保存密钥。
- 真实验收Case：`31bb4946-c1de-4fd9-bf6c-b30efa0f7388`，Chat：`29a53356-9e45-4619-a1ea-def918233c8d`。只讨论组件验收，没有生成Plan、正式数据或TA文件。
- 合成页面验证2项/4项对比、编码/状态字段、长段落、超长不间断token、缺失业务规则及独立只读任务。
- Enter发送、Shift+Enter换行；一条输入只形成一条已提交用户消息，等待期间禁止重复发送。
- 模拟503失败后原输入仍可编辑，重试使用原输入；新建Case后失败仍保留完整输入。
- 两个Case的草稿分别保留；发送后立即切换，旧请求完成时保留当前Case标题与草稿；返回旧Case后可看到已完成回复。
- 长回答向上滚动后显示返回按钮，点击后scrollTop与底部位置相等；复制保留完整Markdown文本。
- 320像素与1280像素宽度没有页面横向溢出；长代码仅在代码块内部滚动。
- 发送按钮Tab焦点可见（2像素实线）；空输入禁止发送。输入法防误发送沿用组件内部composition状态与keyCode保护，本轮未用真实输入法独立实测。
- 既有12种主题切换后输入框可见且无页面横向溢出；液态玻璃及石墨黑已检查截图。
- 真实截图：工作树`.context/assistant-ui/real-discussion.jpg`。

## 既有问题与范围

`scripts/plan-document.test.mjs` 两项旧断言在原平台基线上同样不匹配：100个测试项的CSS类/摘要，以及旧依赖枚举文本。本文不将其算作通过；方案文档未修改。
构建显示入口约822KB（gzip约253KB），有Vite体积提示；本轮没有做额外拆包。
只验证真实模型讨论收发及组件行为，未重新执行完整TA业务验收。

## antislop交付检查（本轮新增/修改的对话区域）

- Hard Gate PASS：320像素无溢出；新控件可操作、有空/等待/错误状态与键盘焦点；真实讨论已收发并构建，无新虚假内容、指标、身份、导航或声明。新文案不含破折号。
- Purpose Gate PASS：颜色、字体、布局、间距继承已有方向；新下箭头只承担回到底部动作；没有新增玻璃层、背景装饰、徽章、插画或循环动效，理由已逐项记录。
- Liveliness PASS：已明确1/2/2档位；当前回答为阅读焦点，气泡/全文/业务产物的不同结构对应不同用途，留白沿用工作台结构，主题强调色用于操作，身份延续原主题。
- Craftsmanship & Quality Locks PASS：真实请求、合成失败、跨Case草稿及异步隔离均已检查；12种主题无输入框布局回归；未添加宣传、伪造业务执行或新页面模板，所有本轮主要设计选择有明确理由。


## 聊天视觉套装（2026-10-08）

用户确认试用 Thread＋Markdown＋消息操作栏＋Composer。继续 `codex/assistant-ui`，在 `93abfe7d` 上新增一个可单独撤销的视觉提交。

`Frontend/src/assistant-ui/chat-kit.jsx` 与CSS根据官方开源 Thread/MarkdownText 元素裁剪、适配：JSX与普通CSS替代Tailwind，继承当前液态玻璃及其他主题变量；Thread保留原Case视口/滚动位置和业务插槽。实际使用MarkdownTextPrimitive与MessagePrimitive.Parts、ActionBarPrimitive.Root/Copy、ComposerPrimitive.Root/Input/Send。源码版本和完整MIT许可在同目录NOTICE.md。

变化：圆角用户气泡、AI正文留白和分级标题、横向滚动表格/代码、代码标题及独立复制、回复复制栏、页脚时间/耗时、统一圆角Composer与圆形发送按钮。旧MessageBody只在历史方案弹窗继续使用。复制失败就地反馈；旧消息操作栏在桌面悬浮/键盘焦点时显示，最后一条常显；窄屏均可访问。剪贴板事件局部处理以保留真实失败提示。

能力边界：仅文本消息，不新增附件、语音、停止/重新生成/反馈功能，不模拟流式回复。现有业务卡片、DATA和EXPECTATIONS确认逻辑保留。没有新增模型调用或确认任何业务内容；真实服务只读取已有对话。

验证：24前端常规测试通过，生产构建通过（主JS约844kB、gzip260kB，原有大包警告仍在）。隔离合成页检查2/4行表格、不同字段、长说明、非对比/缺失信息、原HTML不执行、长代码内滚动；1280与320页面无横向溢出。Shift+Enter换行、Enter仅提交一次、等待禁用、成功清空、503保留原输入和重试、跨Case草稿隔离通过。回答和代码复制及反馈通过；发送按钮Tab焦点2px可见。真实已有对话渲染无console error。输入法没有新增独立实测。旧方案文档脚本的两项基线失败不计入通过。

截图：`.context/assistant-ui/chat-kit-live.png`。5197原入口即时更新；原5195不变。回滚最新视觉提交可回到仅primitive集成的93abfe7d。仍只在本地验收，不push、不创建PR。


## Integrated platform entry (2026-10-08)

The current platform branch is codex/assistant-ui at /Users/apple/.codex/worktrees/assistant-ui/gf. Frontend5197 and API3104 now run from this same checkout. Merge97df3f59 incorporates platform-completion through d69f0a48, including business admission, images, cumulative token budgets, trusted demo exemptions, account progress bars and the final-Case lifecycle entry. Existing assistant-ui runtime, chat kit and asynchronous Case isolation are retained. Image-only sending uses the assistant-ui composer; reading attachments temporarily disables sending.

Validation: backend355 passed with15 opt-in database tests skipped; frontend23 passed and build succeeded. Actual HTTP account/quota authorization checks passed. Browser5197 shows the quota bar and image attachment entry. No new provider calls were made in this integration; prior real-model and MySQL evidence remains in the risk acceptance records. Existing local sessions, Cases and consumption history are preserved.

5195 is a historical fallback preview, not the development entry. PR40/41 remain separate unmerged draft PRs; this local merge is not a merge into remote main.
