# 项目版本与工作树索引

## 5199 模拟个人姓名与销售商级网点硬规则（2026-10-10，本地待验收）

独立功能树`/Users/apple/.codex/worktrees/ta-customer-channel-rules/gf`、分支`codex/ta-customer-channel-rules`，从实时核实的platform-integration/33ea7d08建立。44966298实现模拟个人正常三字姓名、01/03网点等于实际所选销售商并保留前导零、X1/X3继承一致字段及最终申请入库校验；不覆写历史已确认数据或文件。姓名在方案审阅前构造，人工编辑不合规值明确拒绝；网点由通道填写，不沿用AI添加的001后缀。当前测试环境规则与中登通用协议分开记录。

代码已本机合入统一入口`codex/platform-integration`（集成efc9a8ef），Frontend5199/PID23319、API3106/PID23318仍从统一树运行，数据库ta_case_agent_chain不变。HTTP5199为200、API未登录401正常。后端444通过、0失败、21项MySQL专项按开关跳过；真实Sophnet DeepSeek-V4-Pro-0813个人草稿姓名陈思远，227/305/926/005四种通道实际生成并解包ZIP验证01/03/X1销售商和网点一致、OFI顺序与新账户原申请引用保留。未导入外部TA，不代表TA导入验收成功；本轮不改OFG策略。功能树.context/customer-policy保存合成样例与测试证据，说明docs/模拟个人姓名与销售商网点规则.md。无push/PR。

## 当前统一平台集成入口（2026-10-09，本地已验证，待用户验收）

按用户“后端更新都合并到一个分支，否则看不到”的要求，最新 Case／Agent 平台统一使用 `codex/platform-integration`，工作树 `/Users/apple/.codex/worktrees/platform-integration/gf`，验收 http://127.0.0.1:5199/?theme=liquid 。Frontend5199/PID81833 与 API3106/PID81832 均从此树运行，数据库继续 `ta_case_agent_chain`。本条覆盖下方分散的5199前后端入口、5204流式候选及5197“唯一最新”的旧基线说法；5197/3104和5204/3111暂留原进程作历史核对，不作为后续最新开发入口。操作前重新核对Git/lsof。

从 streaming-case-replies/cbd3acfd 的完整平台创建独立树，abc2fa04合入discussion-validation-fix/7c76ebc6，42434161合入remove-pending-retry/ae5a5c31，01bf51ac增加已保存方案上下文与流式持久化组合回归。已包含01/03整包/OFI ZIP、通用操作链、默认行情、业务准入及错误恢复、当前精简方案页、Langfuse与Grafana指标；git cherry核实指标与过滤的等价提交已存在，另补齐Grafana看板文档和TA协议操作链规范。fetch后origin/main仍eaef5498，无独有Backend提交需再引入。独立视觉/聊天沙盒不混入产品，原各分支及未提交改动保留；没有push/PR。

后端418项：401通过、0失败、17个MySQL专项按显式开关跳过；前端29通过及构建通过，原bundle提示保留。真实Sophnet DeepSeek-V4-Pro-0813合成普通订单讨论107增量与最终回复一致，仅内存演练未保存Case。浏览器现有Case历史与方案读取成功、缺失项如实保留；未点击业务确认、修改方案、生成或导入TA文件。HTTP5199为200、API与/live-api无登录401。密钥先核对钥匙串可读取，仅注入进程内存。

本机启动 `python3 /Users/apple/.codex/worktrees/platform-integration/gf/.context/integration/restart-preview.py`，先验证5199/3106已有进程归属再重启；依赖沿用已验证冻结依赖链接。说明 `docs/平台统一集成验收.md`，证据`.context/integration`。后续新功能从此统一分支建独立codex功能分支，本机验证后收拢回此入口供用户验收；不得只改另一棵树却以旧页面验收。原数据库不需回滚。


## SSE 流式回复候选（2026-10-09，本地已验证，待用户验收）

用户要求借鉴 assistant-ui LangGraph 模板流式接线。独立树 `/Users/apple/.codex/worktrees/streaming-case-replies/gf`、分支 `codex/streaming-case-replies`，从已核实的 compact-test-plan/0aa55732 起步。57ff9978接入Sophnet真实正文delta与POST SSE，完成校验和持久化后才发result；5563ab63接现有assistant-ui runtime逐段显示及断流恢复，cbd3acfd保存说明。整理方案仍校验后展示完整结果，双确认保留。没有替换主页面材质、安装新依赖或改写已有方案。

候选预览 http://127.0.0.1:5204/?theme=liquid ，Frontend PID79420 → API3111/PID79425，数据库仍为ta_case_agent_chain；5199/3106及5197/3104未切换。启动本树.context/streaming/start-preview.py（--stop仅停本树记录进程）；模型密钥仅钥匙串读取到进程内存。本地依赖冻结安装，前端沿用prompt-kit-refined依赖链接。

全套418测试中401通过、17个MySQL专项按显式开关跳过，构建通过（既有大包提示）。实际DeepSeek-V4-Pro-0813 SDK 57增量拼接一致；实际API含审核/思考首段31892ms、195增量、最终保存正文一致。新增SSE流式验收项目与合成普通订单讨论，未点击确认或生成文件。说明docs/AI回复SSE流式接入.md，证据.context/streaming。所有提交只在本地，无push/PR；本候选暂不覆盖下方5199现行入口。

## 5199 移除处理中重试按钮（2026-10-09，本地待验收）

用户截图要求去掉“重试原请求”。独立树 `/Users/apple/.codex/worktrees/remove-pending-retry/gf`、分支 `codex/remove-pending-retry`，基于当前已核实前端0aa55732，提交ae5a5c31，仅删除pending状态的额外按钮渲染。保留回复进度和真实失败时的重试原输入。构建及diff检查通过，既有bundle提示保留；Chrome当前Case页面已加载且无该按钮。未发起新讨论或真实模型测试。

实时确认此前Frontend5199来自discussion-validation-fix树（前端无改动），现已切本树PID80238，仍代理原3106，后端未切换。前端依赖链接沿用prompt-kit-refined。回滚可从discussion-validation-fix树按相同5199/3106启动参数重启。该条覆盖5199旧前端入口，其他开发树的未提交改动保留。无push/PR。


## 5199 普通讨论校验修复（2026-10-09，本地待验收）

独立树 `/Users/apple/.codex/worktrees/discussion-validation-fix/gf`、分支 `codex/discussion-validation-fix`，基于0aa55732。普通短答及Markdown标题/列表不因外观格式拒绝；同Case持久化方案可引用为已生成，未核实的执行/提交声明仍拒绝。讨论校验与空内容自动重答一次，失败只记录分类与次数，不记录正文，HTTP区分格式/空回复/方案结构错误。纠正提示词旧03等待02描述；协议校验和双确认不变。

当前Frontend5199 PID79957与API3106 PID80197均本树、仍使用ta_case_agent_chain。原运行目录实际加载了其他未提交流式试验内容，故本次统一前后端到此已核实基线，试验树未修改。启动本树.context/discussion-fix/start-frontend.py和restart-api.py；后者保留运行环境、密钥仅钥匙串至进程内存。Sophnet DeepSeek-V4-Pro-0813真实六轮上下文调用成功，UI原问题“下一步是什么？”已重试并保存完整回复；未点击业务确认、未生成文件。后端397通过、17项MySQL专项默认跳过。证据.context/discussion-fix/recovered.png、live.log、tests.log；说明docs/讨论回复校验修复.md，无push/PR。本条覆盖此前5199/3106启动入口。


## 5199 测试方案精简（2026-10-09，本地已验证，待用户验收）

用户继续要求只保留一个测试方案页面：取消页签，准备数据和执行与文件安排改为页内折叠，准备确认按钮随数据展开。重复诊断合并为具体提示，保留真实缺失项和后端阻断。27项前端测试、构建及当前Case浏览器折叠/确认位置检查通过，截图.context/compact-plan/single-plan.png；未点击确认或改写保存方案。此段覆盖下方两页签现行展示描述。

按用户批准的设计，独立树 `/Users/apple/.codex/worktrees/compact-test-plan/gf`、分支 `codex/compact-test-plan`，基于当前后端88cefa8a，保留品牌对齐对应提交9fe66e4c/ad70d622。9cfc70ab合并四页签为“测试方案｜任务单”，准备数据可展开编辑，文件安排并入任务单；6b0c749a集中共同条件、差异表对齐，单项方案保留独立条件/操作/预期，长预期折叠，原文和核对依据可展开。两提交可分别回滚，双确认保留，未改写已保存方案或调用模型。

Frontend5199现本树PID76996、仍代理原API3106/contextual-admission树PID74984和ta_case_agent_chain，原5197/3104不变。本树.context/compact-plan/start-frontend.py为本机启动入口，前端依赖链接沿用既有prompt-kit-refined，不改依赖清单/锁文件；回退在agent-brand-alignment树重启5199即可，后端不切。临时5203合成检查结束后停止。

27项前端测试、构建通过，既有bundle提示保留。浏览器验证2/4种情况、不同字段、长预期、缺失信息、单项非对比Case、无需文件、合成编辑成功及失败保留输入；390px内容宽390无页面横向溢出。当前用户Case只读查看差异表和准备数据确认入口；旧整包Case只读核对01/03 ZIP一次提交、02/04日期与前置。未点击业务确认、未生成或回传文件。说明docs/测试方案精简.md，真实截图.context/compact-plan/real-plan.png、package-tasks.png。无push/PR。本条覆盖5199旧前端启动入口；既有缺失业务条件仍保留，不代表可执行或结果已验证。


## 5199 整理方案失败恢复（2026-10-09，本机已验证）

延续contextual-admission同一功能分支，提交88cefa8a。原Case两次INTERNAL_ERROR的账本均为Flash审核调用UNCERTAIN、未创建方案回合；未留原始异常，具体上游类型不能追溯。Sophnet SDK请求边界未分类异常原样抛出，现转换503 MODEL_UNAVAILABLE，审核层返回可读ADMISSION_UNAVAILABLE并释放租约；无绕过、无自动确认。新增异常回归通过，完整后端392通过/0失败、17个MySQL专项默认跳过。

同一原输入和真实对话调用Sophnet完整提案链成功，Plan1、讨论修订6保存；浏览器已刷新并打开测试方案，0/1/2天合成用例可审阅，未点击准备数据或预期确认。截图.context/contextual-admission/plan-recovered.png。API3106现PID74984，仍本树和ta_case_agent_chain；Frontend5199仍品牌对齐树，不变。下条原PID及仅修订2的信息由本条覆盖。无push/PR；模型服务本身仍可能暂时失败，不宣称已消除上游故障。


## 5199 业务准入上下文修复（2026-10-09，本机已验证，待用户验收）

用户要求修复“你可以推荐吗？帮我生成一版”被误判业务无关。独立树 `/Users/apple/.codex/worktrees/contextual-admission/gf`、分支 `codex/contextual-admission`，基于已验证完整包候选41dc9a8c，提交146893f8。审核读取最初需求和最近六个完整用户/AI回合，允许承接当前讨论的推荐、缺失条件梳理、假设和草稿请求，也允许调整目标；不锁死原需求。business-admission-context-v2避免复用旧拒绝缓存。严格解析、租约、权限隔离、协议校验及双确认不变，无新增依赖或迁移。

实时核对：API3106已切此树Backend/PID72859、数据库ta_case_agent_chain；Frontend5199仍下方agent-brand-alignment树/PID72267，代理3106，本修复没有修改前端。原5197/3104不变。重启使用本树.context/contextual-admission/restart-api.py，钥匙串密钥仅传进程内存；不要用旧候选API脚本覆盖修复。Backend依据原冻结pnpm-lock独立安装本机依赖，清理仅限本树失效链接，未改依赖清单/锁文件或其他树。

后端391通过/0失败，17个MySQL opt-in默认跳过；实际MySQL准入专项1通过。Sophnet DeepSeek-V4-Pro-0813和实际审核Flash-0731各9个请求，18次全通过，覆盖推荐、缺失条件、目标调整、新Case、非对比Case及无关/绕过请求。用户原Case http://localhost:5199/?theme=liquid&chatId=52a5b7ce-93b6-4817-9c43-7483bb4266bb&caseId=b56acb44-3244-46f2-8730-3b46c4e10804 中原话实际重试成功，AI返回建议，讨论修订2完整保存、无待处理回合；没有点击双确认或生成TA文件。截图.context/contextual-admission/recommendation-allowed.png，说明docs/业务准入上下文修复.md。无push/PR。本条仅更新5199候选后端运行入口，下方原完整包实现及前端品牌对齐保留。


## Prompt Kit 精致聊天试验（2026-10-09，本地待验收）

独立树 `/Users/apple/.codex/worktrees/prompt-kit-refined/gf`，分支 `codex/prompt-kit-refined`，基于已验证平台及指标b85e0abb；beab668d保存官方组件/依赖，b98358df保存页面及模型接线。预览 http://127.0.0.1:5202/prompt-kit.html ，隔离文字沙盒API3110。暖白/深色阅读面、细边框与低饱和绿色，官方Message/Markdown/CodeBlock、PromptInput、ChatContainer、Steps与TextShimmer通过组合定制排版；源码仅导入适配。默认合成示例支持2/4情况、可变字段、长中文/代码及非对比/缺失信息，全部明确标记，不执行Case业务。真实Sophnet DeepSeek-V4-Pro-0813流式中文、三列表格、JSON高亮及代码复制已验收；仅页面内存保存、刷新清空，图片粘贴明确拒绝。构建及7个前端测试通过；390px无整页溢出、折叠/复制/停止/重新生成、失败保留输入/重试与浅深色检查通过。官方Shiki大包提示保留。启动Frontend/scripts/start-prompt-kit-preview.py，说明docs/Prompt-Kit精致聊天试验.md，证据.context/prompt-kit；密钥仅钥匙串到进程内存。本轮未切换其他试验或产品服务；无push/PR。本项不替换最新平台基线。

## 5199 机器人标签图标与登录标题对齐（2026-10-09，本地待验收）

用户截图指定5199。独立树 `/Users/apple/.codex/worktrees/agent-brand-alignment/gf`、分支 `codex/agent-brand-alignment`，基于当前5199完整候选41dc9a8c。393160ec将浏览器标签图标设为现有机器人PNG，76d96fec将登录/注册页机器人与TA Test Agent横向居中对齐；两项可单独回滚。Frontend5199已切到此树PID72267，代理仍3106，后端未重启。构建通过（保留既有大包提示），真实Chrome无登录会话检查1440px/390px对齐中心差0、无横向溢出、图片正常，注册/登录切换与密码显隐通过，图标HTTP200；截图在本树.context/brand-alignment。没有模型调用、push或PR。原simple-case-export源码保留；本项不替换5197平台方向。

## AI Elements 原生组件试验（2026-10-08，本地待验收）

独立工作树 `/Users/apple/.codex/worktrees/ai-elements-native/gf`，分支 `codex/ai-elements-native`，基于已验证平台及指标b85e0abb；61a71ac0保存官方组件/依赖，3cfeac25保存试验入口和接线。预览 http://127.0.0.1:5201/elements.html ，文字聊天沙盒API3109。默认展示官方Task/Plan/Tool/Artifact/Canvas及节点动画，演示状态明确标记为合成，不执行Case业务；“真实聊天”已实际验证Sophnet DeepSeek-V4-Pro-0813流式中文、表格及代码回复。默认shadcn样式，官方源码只适配导入路径；对话页面内存保存、刷新清空，附件明确拒绝。构建和7个前端测试通过，方案/工具折叠、拖动/缩放、浅深色、390px下可变情况/字段、长文本、非对比和失败保留检查通过；保留官方语法高亮大包提示。启动Frontend/scripts/start-elements-preview.py，说明docs/AI-Elements原生试验.md，截图及结果.context/ai-elements。密钥仅钥匙串到进程内存。原5200/3108、5197/3104与5199/3106未切换；无push/PR。本项为视觉及聊天试验，不替换最新平台基线。

## assistant-ui 原生聊天试验（2026-10-08，本地待验收）

独立工作树 `/Users/apple/.codex/worktrees/assistant-ui-native/gf`，分支 `codex/assistant-ui-native`，基于已验证平台及指标b85e0abb。预览 http://127.0.0.1:5200/native.html ，文字聊天沙盒API3108；官方Thread/ThreadList及默认样式，仅源码导入路径适配，保留原生英文控件与浅深色。真实Sophnet DeepSeek-V4-Pro-0813文字回复已在浏览器验证表格与代码渲染，密钥仅钥匙串到进程内存。对话在页面内存中，刷新清空；附件模型明确拒绝；不接业务工具、Case写入与双确认。完整平台入口及既有5197/3104、5199/3106服务未切换。构建及4个前端测试通过，390px合成2/4情况、不同字段、长文本、缺失/非对比及失败提示检查通过。说明docs/assistant-ui原生试验.md，启动Frontend/scripts/start-native-preview.py；无push/PR。本项仅视觉试验，不替换最新平台基线。

## 01/03一次全量申请包（2026-10-08，本机已跑通，待用户验收）

本条覆盖下方5199/3106候选的旧启动信息与新账户必须先收02再生成03的说法。按用户纠正，01与全部03一次准备、同一批次生成，OFI按01后03列出，ZIP一次提交；02/04用于提交后的真实确认。独立树 `/Users/apple/.codex/worktrees/simple-case-export/gf`，分支 `codex/simple-case-export`，基于默认基金行情7d19c23d；81b5e599启用指定隔离本地数据库模拟登录，be3c1df3接入v4整包契约、LangGraph准备/顺序校验、协议原申请引用和ZIP接口，41dc9a8c接入任务单顺序及ZIP下载。未push/PR。

当前API3106由本树Backend运行PID52956，Frontend5199由本树Frontend运行PID47738，仍隔离ta_case_agent_chain；原5197/3104不变。启动脚本 `.context/simple-case-export/restart-api.py`读取钥匙串模型密钥仅传进程内存，CASE_LOCAL_DEMO_DATABASE明确指定ta_case_agent_chain，其他库及远程地址不自动开放模拟登录。新契约允许同包新账户03的TAAccountID为空，必须由系统派生OriginalAppDate/OriginalAppSheetNo精确引用该账户01，后台事务复核；绝不伪造未来TA编号或正式资源。v1/v2/v3历史分轮语义保留。

实际模拟账户空项目演练：http://localhost:5199/?theme=liquid&chatId=3894a81f-1163-415b-bf88-589236a4e0d6&caseId=3b73f31a-9199-491a-86ac-ed5b893e4b8d 。Sophnet DeepSeek-V4-Pro-0813真实讨论与提案最终保存Plan版本2、契约v4，无missing；UI实际分别确认准备数据和预期，再确认草稿、一次生成并下载。当前两个申请GENERATED、一个batch，ZIP含OFI_306_27_20261008.TXT及01_001/03_001，各一条；索引顺序、原申请关联、CRC和成员原始字节/SHA256已核对。下载 `/Users/apple/Downloads/306_27_20261008_applications.zip`，无02/04合成回传、无外部TA交付，本Case正式账户/持仓/绑定均为0；不能当作TA业务成功或Case PASS。

模型早期失败及旧占位账号/误写确认的提案未当通过；最终提案已纠正。修复模型格式/步骤诊断、原申请引用及HHMMSS时序误判，常规后端389通过/17个MySQL opt-in默认跳过；另真实MySQL新整包+旧分轮两专项串行通过，事务回滚，覆盖多账户/可变动作、串账户引用拒绝、租户原件隔离与幂等。前端23通过、构建通过，既有bundle大小提示保留。证据和截图在本树.context/simple-case-export；说明docs/一次提交申请包设计.md。回到旧整体平台使用原5197/3104及原库，不用旧后端打开新v4已锁定Case。

## 默认基金行情配置（2026-10-08，本地待验收）

用户要求按两张TA行情截图配置默认值，文件链路既有能力不重做。独立树 `/Users/apple/.codex/worktrees/default-fund-market/gf`，分支 `codex/default-fund-market`，基于操作链候选5bcdb902，含最新后端指标090c2a21（本分支97b9443c），功能提交7d19c23d。默认配置 `Backend/config/default-fund-market.json` 保存005107、270007、270008、270048完整截图行情，270007昨日净值1.1000，其余1.0000；空复核员、七日可变现资产、未提供协议份额类别保留null。截图日期20260817/20260818是可覆盖测试默认日期，不代表当前交易日。

讨论/方案/准备数据模型读取独立默认上下文，Case和已保存Plan明确条件优先，默认基金不强制生成全部申请，基金规模不当客户持仓。结果核验不注入默认值；无既有方案改写、数据库迁移、TA外部操作或双确认点击。完整后端381通过/16个MySQL专项默认跳过，真实Sophnet四基金及空值/净值日期覆盖检查通过。首次依赖链接缺指标包导致回归失败，修正后重跑通过。

当前Frontend5199仍操作链树，API3106已切本默认配置树PID44092，仍隔离ta_case_agent_chain。HTTP5199为200，API与前端代理未登录401正常；原5197/3104不变。后续不要用原操作链启动脚本覆盖默认配置；新脚本 `.context/default-fund-market/restart-api.py` 只重启核实属于两候选树的API3106，钥匙串模型密钥仅注入进程内存。回滚用原操作链树restart-api.py恢复3106。说明 `docs/默认基金行情配置.md`，真实配置核对结果 `.context/default-fund-market/model-result.json`。未push/PR。

## Agent / LangGraph 中登操作链规范（2026-10-08，文档待验收）

用户明确TA业务操作链必须基于中登文件协议，后续据此审查后端合理性。独立工作树 `/Users/apple/.codex/worktrees/ta-chain-protocol-spec/gf`，分支 `codex/ta-chain-protocol-spec`，基于已核实完整平台3470dca0。规范入口为该树 `Backend/docs/agent-langgraph-protocol-chain.md`，已由 `docs/Case全流程设计.md` 与 `Backend/docs/durable-workflow.md` 链接。明确文件/业务码/字段映射、逐条成功依赖、日期口径、合批与链数、新旧版本对比、协议外前提和后端审查表；账户级再投资不得冒充标准029，02与04间隔不得冒充持有期。仅文档修改及链接/差异检查，没有修改或测试运行中的后端/模型，没有替换当前平台或待验收操作链候选，无push/PR。

## Grafana Cloud 后端指标（2026-10-08，云端已启用）

独立树 `/Users/apple/.codex/worktrees/grafana-cloud-metrics/gf`，分支 `codex/grafana-cloud-metrics`，基于最新完整平台3470dca0；功能090c2a21、看板24089c5d、云端验收文档及实例过滤b85e0abb。364后端测试通过，15个MySQL专项默认跳过。用户本人注册后，明确批准专用访问策略/Token创建保存；已核对套餐Cloud Free，14天为额外试用额度。当前stack tallminivan1333，网关prod-us-east-3美国东部；仅当前stack的metrics:write，Token有效期90天，凭证在同树.context/grafana/runtime.json（0600、忽略），不输出密钥。

真实OTLP合成上传exportCode=0；隔离API3105验证后已停止。当前API3104已从此功能树Backend运行PID40817，Frontend5197仍assistant-ui、HTTP200；未登录/api/auth/me401正常。云端看板 https://tallminivan1333.grafana.net/d/ta-case-backend 已实际显示local-api请求/P95/内存/处理中请求，每60秒上传，看板筛选job=ta-case-api、instance=local-api排除测试实例。普通成功查询仅汇总统计，保留3470dca0的Langfuse过滤。现有Langfuse配置已复制到同树.context/langfuse/runtime.json（0600、忽略），启动脚本.context/grafana/start-api.py 3104读取两份本机配置及钥匙串模型密钥，仅注入进程，不调用模型。请不要用旧Langfuse树脚本覆盖当前运行服务；后端后续基线包含本树新增指标代码，操作链候选仍独立待验收。

无新增Docker服务、数据库迁移、业务数据修改、真实模型调用、双确认推进、push或PR。云端证据.context/grafana/cloud-check-result.json，说明docs/Grafana-Cloud后端接入.md。尚未采集主机磁盘、容器、慢SQL、durableWorkflow内部事务或HTTP200业务正确性；没有设置告警/通知联系人。CASE_METRICS_ENABLED=0并重启可停指标，或旧langfuse-query-filter树可回滚API。

## 通用账户业务操作链（2026-10-08，本地待验收）

用户要求每项新需求新建分支，并在前端看到任务单。独立工作树 `/Users/apple/.codex/worktrees/account-operation-chain/gf`，分支 `codex/account-operation-chain`；基于ed2f6f50并包含最新查询过滤3470dca0（本分支cherry-pick为bd9b0945）。功能提交91db4b49（赎回账本）、63530a03（计划与调度）、89623ecd（协议遗漏修复）、8fc2c4a6（前端任务单）。根AGENTS.md及本分支已记录每个新需求读取git-workflow-and-versioning、核对索引、新建codex功能分支/独立树、本机验收后再考虑发布；无自动push/PR。

本项仅作为待验收候选，没有替换下方已验证产品基线。独立Frontend5199/API3106，隔离复制数据库ta_case_agent_chain；原5197、3104及原数据库未切换。实际页面 http://localhost:5199/?theme=liquid&chatId=c2b68852-c1b0-45af-b1b8-b3f6ba3da8d4&caseId=acbdb174-809f-4fbc-b6ba-ef9d8a543a2f ，内置浏览器已登录合成验收账户并打开“测试方案→任务单”。任务按逐笔依赖规划和校验，保留双确认；正式同步支持开户、申购、最终赎回，其他01/03业务明确显示限制。旧v1/v2兼容。

后端372通过/16个MySQL opt-in默认跳过；独立MySQL三专项串行通过，新增05净额回归通过；前端31通过及构建通过。旧方案脚本两项基线失败和大包警告仍存在。真实Sophnet DeepSeek-V4-Pro-0813生成两账户六任务、六逐笔预期及六文件阶段，最终协议构造缺失为空；UI保存后HTTP复验仍PENDING_CONFIRMATION、confirmations为空，未点击双确认、未交付外部TA文件。早期格式/引用/合成证件遗漏失败保留，未算通过。验收与回滚见该树docs/账户业务操作链接入验收.md，截图.context/operation-chain/real-task-list.png，启动脚本.context/operation-chain/restart-api.py（钥匙串密钥仅进程内存）。迁移029允许024；有赎回历史时不能缩回约束或删除交易历史。

## Langfuse 普通查询过滤（2026-10-08，当前本地验收）

用户明确要求普通查询成功不上传、失败保留诊断、Agent执行/模型/关键操作完整追踪。已在最新已核实ed2f6f50基础上创建独立树 `/Users/apple/.codex/worktrees/langfuse-query-filter/gf`、分支codex/langfuse-query-filter，提交3470dca0；原assistant-ui与原接入分支未修改。当前API3104从此新树Backend运行PID27958；Frontend5197仍assistant-ui相同前端基线，页面未改。后续后端开发基线使用此功能树包含最新完整平台代码；回滚可从assistant-ui旧树启动3104。不要用旧树自动重启脚本覆盖新功能。

过滤在span结束时执行：GET/HEAD且HTTP<400、无异常、未调用graph.invoke/stream/streamEvents或模型时丢弃根span；4xx/5xx/抛错保留受限错误码；执行图、模型及非查询操作保留完整根和子链路。AsyncLocalStorage隔离并发执行标记，无新增依赖。X-Trace-Id不保证追踪实际导出。359后端测试通过、15个MySQL opt-in默认跳过。EU合成云端验收成功：普通GET成功0条、失败1条、POST1条、GET内模型2条；3105隔离API401追踪1条，非真实模型调用。证据在新树.context/langfuse/filter-check-result.json、filter-check.log；当前3104验收另存live-filter-check-result.json。不采集正文/TA原文，模型/账户账本不变，未push/PR。独立3105验收结束后停止。

## Langfuse 服务端追踪接入（2026-10-08，磁盘已清理）

本地Langfuse 6个容器、5个专属数据卷、6个镜像标签及631MiB images.tar备份已删除；Docker当前仅业务MySQL运行，59G盘使用24G、可用33G（42%）。

2026-10-08 EU云端迁移已验证：云端项目cmuz6tbgh0057ad0jlixkyyn6，SDK合成trace de269983c441bd6cb951b546fcfc5903上传/Observations API v2查询成功（2节点、0真实模型调用）；当前assistant-ui/API3104已读取EU runtime，重启PID24548。实际GET /api/chats未登录401及trace3b1a20a160c80914846aa1bf09deb9da已在EU查询到；Frontend5197 HTTP200、MySQL46个Case保留。Cloud新组织legacy traces API返回410，验收已使用/api/public/v2/observations及有界时间范围。Keys保存在独立树.context/langfuse/cloud-runtime.json与最新树.context/langfuse/runtime.json（0600、忽略），不输出到日志/聊天；HTTPS_PROXY/HTTP_PROXY=本机已有127.0.0.1:7890，NO_PROXY含localhost/127.0.0.1、NODE_USE_ENV_PROXY=1。用户已授权验证后删除本地Langfuse Docker依赖，执行结果在.context/langfuse/cloud-docker-removal.log；不得把下方本地看板/等待Keys记录作为当前运行状态。保留业务MySQL与blue-sim-demo，无PR/push。


云端迁移最新状态：用户已选EU并本人登录，内置浏览器显示项目cmuz6tbgh0057ad0jlixkyyn6/traces；CUA按URL与tab id两次连接均30秒超时，Chrome仍未登录。已准备并请求用户在本机独立树.context/langfuse/cloud-runtime.json（0600、忽略）填入云端Public/Secret Key，当前为占位值，不可执行上传验收。cloud-check.mjs语法检查通过；3104仍未切换，本地Langfuse依赖未删除。不要重复要求用户登录内置浏览器，不要将Keys发到聊天。

2026-10-08 用户要求迁移免费云端，云端验证成功后删除本地Langfuse Docker依赖。已测EU/US health HTTP200，JP18秒超时；Chrome已显示EU登录页，尚待用户本人登录/注册（页面登录即同意条款）。Node直连EU超时，使用本机已有HTTP系统代理127.0.0.1:7890及HTTPS_PROXY/NODE_USE_ENV_PROXY后health200。独立树.context/langfuse/cloud-check.mjs已准备合成追踪上传/查询验证，未运行（尚无云端项目/API Keys）；没有切换3104、没有删除本地Langfuse。仅云端上传与查询实测成功、最新API验证成功后再删除本地专属容器/卷/镜像，保留MySQL与blue-sim-demo。

清理后Langfuse隔离Compose已启动：2026-10-08实测http://127.0.0.1:3000/api/public/health返回HTTP200、status OK、version4.54.0；Postgres/Redis/ClickHouse/MinIO健康，Web/Worker运行。API3104尚未重启、埋点开关仍关闭；未验证追踪入库或新增真实模型调用。管理员本地凭证仍独立树.context/langfuse/local-access.txt（0600）。

2026-10-08 用户授权清理不需要的Docker资源。已删除27个旧/其他项目容器、9个旧/其他项目数据卷（含旧fund-sales-demo Oracle 16.76GB）、历史镜像及全部构建缓存。保留当前Agent MySQL完整卷、blue-sim-demo全部容器/镜像/数据卷、旧TA小体积artifact/sftp卷以及Langfuse依赖。清理后Docker盘59G/26G，可用31G、使用率45%，无需扩容/Colima重启；当前Agent MySQL SELECT及46个Case查询正常。清理清单在独立接入树.context/langfuse/cleanup-20261008/。不影响本机源码、工作树、绑定目录文件。随后从备份恢复Langfuse镜像并启动隔离Compose，健康状态以实测为准。本条覆盖下方磁盘满及等待扩容记录。


2026-10-08 用户明确要求关闭所有当前Agent无关Docker服务。已停止Web Lab 2个、AIMaster 5个、旧PostgreSQL检查点1个，共8个；仅保留fund-sales-demo-mysql-1/3307。后续即使扩容重启也只恢复当前Agent所需MySQL，不恢复这8个已按用户要求关闭的服务。本条覆盖下方“恢复此前运行的容器”要求。未删除容器、镜像或数据卷，停止后Docker盘仍59G/59G、可用0；实际MySQL SELECT 1成功，5197 HTTP200、3104未登录HTTP401。Langfuse仍未启动。

最新平台 assistant-ui 已合入独立功能 ed2f6f50（原接入分支 codex/langfuse-observability/d43733b8）。HTTP、LangGraph 图、模型调用、实际 usage 与消费账本引用已接入；正文/图片/TA原文不采集。后端358通过/15个MySQL专项默认跳过，含并发上下文、人工interrupt/resume、导出失败不中断业务。最新API3104仍原PID3037，本轮没有重启启用；本地runtime开关为0。Frontend5197保持原样；未push/PR。

本轮Langfuse v4镜像已下载并尝试本地Compose启动，Colima数据盘60GB实际100%满，Postgres报No space left on device，看板未成功启动且未做真实模型验收。新增Langfuse容器与隔离API3105已停止，不重启其他服务。仅本轮镜像备份到独立接入树.context/langfuse/images.tar（约631MiB）后移除其标签，未清理用户镜像/数据卷。等待用户允许Docker盘扩到80GB及短暂Colima重启；必须恢复此前运行的容器并复验现有平台。

本地部署配置、管理员凭证、SDK runtime及启动/验收脚本均在独立树 `/Users/apple/.codex/worktrees/langfuse-observability/gf/.context/langfuse/`，敏感文件0600且忽略，模型密钥没有写入。最新树.context/integrated-platform/restart.py已预留读取观测runtime，当前关闭。恢复镜像用docker load -i独立树的images.tar，再启动Compose，健康/入库确认前不能称看板可用。文档docs/Langfuse本地接入.md；回滚ed2f6f50或关闭开关，本地观测卷保留。


## assistant-ui 成套组件本地验收（2026-10-08）

最新入口仍为 codex/assistant-ui 工作树、Frontend5197/API3104。已接入右侧方案区及两次确认、成果卡、项目内Case列表、图片附件、独立引用与可展开的真实流程；方案说明与核对依据仅显示现有内容。编辑已发送消息、重新生成、回答分支不加入。27前端测试和构建通过；2/4情况、长说明、非对比、失败保留、双确认及390px iframe窄屏检查完成。真实已有回复只读检查；本轮未新增模型调用、未对真实Case点击确认、未上传PR。功能提交f5bcb025/ed6949b9/6eea5f0c/be12271b，逆序回滚恢复789b31b3。可视合成验收页5198/test/assistant-ui.html?theme=liquid&mode=plan，截图.context/assistant-ui/visual-suite.png，详情docs/assistant-ui接入验收.md。合成状态不代表真实业务执行。

## 当前唯一最新平台：5197／assistant-ui（2026-10-08，已收拢）

后续最新Case／Agent开发、启动与验收统一使用分支 `codex/assistant-ui`，工作树 `/Users/apple/.codex/worktrees/assistant-ui/gf`。Frontend5197/PID95970与API3104/PID3037均从该工作树运行，操作前查实时Git/lsof。原5195不再作为最新开发入口，保留历史回退用途；下方5195条目为先前阶段记录。不得再把新功能只合入platform-completion后以5195验收。

合流提交97df3f59合入platform-completion截至d69f0a48全部改动，后续修复暂停图片读取时发送。包含assistant-ui底层与视觉套装、Flash文字/图片业务准入、总token额度、账户额度进度条、演示无限额度及项目封存入口时机修复。前后端代码已统一，不再让5197前端连接另一个工作树的后端代码。服务端DB与会话仍原本地ta_case_agent_local，旧Case和预算账本保留。

后端355通过/15个MySQL专项默认跳过，前端23通过及构建通过；本轮真实HTTP权限/额度接口复验通过，5197浏览器确认演示无限进度条及图片入口。没有新增真实模型调用。启动脚本在该树.context/integrated-platform/restart.py，只读钥匙串到内存；原PR40/41仍未合并，本地集成不代表main已发布。运行与截图记录见docs/assistant-ui接入验收.md及.context/integrated-platform/。

## 5195 账户额度展示与演示无限额度（2026-10-08，本地待验收）

用户要求改为进度条：最新本地ff55c9f9（独立分支341fe001）隐藏所有token数字和调用明细，剩余条依据服务端真实额度；演示显示无限额度而非百分比。普通账户保留北京时间零点恢复说明；预留和待核实消耗仅显示状态。5195构建与浏览器实际显示已验证，截图account-progress.png。

当前平台树本地810ce0a3已接入账户页“AI使用额度”：每日额度、今日实际用量、预留、待核实、剩余、北京时间恢复时间及最近50次调用明细。API3104本轮重启PID891（查实时lsof）；Frontend5195不变。按用户确认仅累计token，不做人民币折算；不启用额度管理员，后续接监控看板。每账户可由服务端account_model_quotas覆盖额度，默认50万/日。

模拟账户由account_demo_users可信服务端标记，已核对本机保留身份后初始化；每日总量无限，仍记录消耗、受业务准入/并发/短时限流/单次限制。演示消耗使用独立预算桶，不占普通平台每日token总额。新演示标记只能由启用的demo入口创建，注册不能占保留邮箱；不根据前端名称自动升级。历史演示消耗留原账本，不做追溯退款。

独立回滚分支codex/account-model-billing在business-admission工作树，提交38484e5e与b34c4be3；未推送，本项未添加到现有PR40/41。后端355通过/15个数据库专项默认跳过，前端22通过及构建通过；新库迁移复跑及真实MySQL3个专项通过，含个别账户限额/降额不清零/隔离/演示超额度/未知用量。5195真实HTTP验证普通50万、演示无限且既有真实用量312、无会话401/陈旧账户409/不可修改405/伪造演示注册400。截图和JSON在工作树.context/risk-acceptance/account-quota.png、account-http-results.json。回滚按ccbff66c→810ce0a3撤销，保留028新表和账本；保留其他任务的界面样式提交。

## 5195 业务准入与总模型消耗额度（2026-10-08）

本地最新平台仍是 `/Users/apple/.codex/worktrees/platform-completion/gf`，Frontend5195/API3104；本轮已集成业务准入及额度功能，API重启PID96693（操作前查实时lsof）。保持现有UI材质及其他任务改动，5194/3103与其历史Case不修改。5194/5195共用 ta_case_agent_local，图片迁移复用已存在的024_discussion_images.sql名称；新建验收库迁移两次成功。

两个未合并draft PR：[#40 文字与图片业务准入](https://github.com/yqsota666/TA-case-test-Agent/pull/40)，分支codex/business-admission/7235f1e9，基于PR39；[#41 总token额度](https://github.com/yqsota666/TA-case-test-Agent/pull/41)，codex/model-consumption-budget/624f7b2e，基于PR40。发布工作树 `/Users/apple/.codex/worktrees/business-admission/gf`。不能把本地集成、draft PR当作main已发布。

审核真实调用 Sophnet DeepSeek-V4-Flash-0731；图片由qwen3-vl-plus解析后审核，业务模型仍DeepSeek-V4-Pro-0813。非业务/待澄清材料不进入正式讨论；未来目标与预期允许描述，完整阶段语义状态机仍未扩展。总额度涵盖审核、视觉、主模型、转换和重试；默认用户50万/工作空间200万/全局1000万token每日，按Asia/Shanghai日结，未知usage保守保留预留额。为token累计控制，不是人民币账单。

后端351通过、14个MySQL专项默认跳过；前端22通过及构建通过。独立真实MySQL准入与额度专项通过。5195真实HTTP/三类模型验收8次共9165token：无关文字与图片正式修订0、业务输入和图片修订2、跨账户404、仅合成验收用户额度耗尽429且无新模型调用。之前一次主模型输出格式失败保留真实失败；新Case完整复验通过。材料均为合成，没有外部TA操作。输出在发布树 `.context/risk-acceptance/验收输出.md`，不含密钥。回滚分别撤销PR41、PR40的功能提交，保留图片和消耗历史；不要清理根用户资产。

## assistant-ui 独立分支本地预览（2026-10-08）

聊天视觉套装已按用户指定在同一树继续完成，提交 `78663a9b`（基于 `93abfe7d`）。新增官方Thread/MarkdownText元素的JSX与普通CSS适配，使用实际MarkdownTextPrimitive、ActionBar和Composer；消息布局、正文分级、表格/代码块、回复/代码复制及Composer一起调整，液态玻璃和业务卡片/双确认保留。新增依赖 `@assistant-ui/react-markdown 0.14.19`，来源版本和MIT许可保留在Frontend/src/assistant-ui/NOTICE.md。

24常规前端测试、构建通过；隔离合成页桌面1280/窄屏320、2/4行和不同字段、长文本/代码、非对比/缺失信息、发送一次/Shift+Enter/禁用状态、复制、失败重试原输入、Case草稿隔离及键盘焦点已检查。没有新增真实模型调用；只读既有真实对话渲染，无console error。5197实时更新；截图为该树 `.context/assistant-ui/chat-kit-live.png`、`chat-kit-markdown.png`。回滚 `78663a9b` 返回上一轮仅底层集成；原5195保持独立。未push或新建PR。大包警告及旧方案脚本两项基线失败仍见验收文档。

用户指定采用 assistant-ui，并要求换分支实现以便回滚。独立工作树 `/Users/apple/.codex/worktrees/assistant-ui/gf`，分支 `codex/assistant-ui`，功能提交 `93abfe7d`。基于实时平台 `bf71011a`，当前未提交的紧凑布局样式另存为本地基线 `2c3201ca`；原平台工作树和根历史目录未切换、未清理。

真实预览 http://127.0.0.1:5197/?theme=liquid ，API继续代理3104；原5195继续保留。Frontend从新工作树运行，启动环境 `FRONTEND_PORT=5197 CASE_API_TARGET=http://127.0.0.1:3104`。合成组件页 http://127.0.0.1:5198/test/assistant-ui.html?theme=liquid 拦截全部接口，不连接业务服务，不属于生产入口。

已接入 `@assistant-ui/react 0.15.25` 的External Store、Thread/Message/Composer，保持主页面材质、侧栏、业务卡片和两次明确确认。24前端常规测试与构建通过；真实Sophnet讨论收发一次（无Plan/正式数据/TA文件生成），另验收长文本、不同对比数量/字段、只读任务、失败原输入、新Case失败、跨Case草稿及异步隔离、320窄屏和12主题。旧 `scripts/plan-document.test.mjs` 两项失败在原平台基线同样存在，未算作通过。输入法防误发送已核对组件源码，本轮没有真实输入法独立实测。

尚待用户本机验收，没有上传PR或push。回滚 `93abfe7d` 即恢复 `2c3201ca`；也可直接打开原5195。完整记录为新树 `docs/assistant-ui接入验收.md`，真实截图为 `.context/assistant-ui/real-discussion.jpg`。

## 平台五项补全本地验收与五份PR（2026-10-08）

最新补全运行在 `/Users/apple/.codex/worktrees/platform-completion/gf`，分支 `codex/platform-completion`，Frontend5195与API3104；原5194/3103、5188/3102及历史Case保留。独立验收入口 http://127.0.0.1:5195/?theme=liquid&page=files 。新运行端口配置在Frontend/vite.config.js，FRONTEND_PORT=5195、CASE_API_TARGET=http://127.0.0.1:3104；API启动所需本机配置与钥匙串读取脚本只保存在忽略的.context/platform-completion/start-isolated.py，禁止复制密钥到文件。

五份stack PR分别为35项目跨Case合批、36全局数据、37全局文件、38按Plan接05、39关联复测/封存。依次基于上一分支，不自动合并；PR35包含先前已本地验收而未发布的账户登录及当前UI/LangGraph基底。原首页/Plan样式保留，研究快照与静态预览只保留本地，不作为生产资源发布。

337常规后端通过，12 MySQL opt-in常规跳过；22前端通过，五个PR精确代码快照分别测试与构建通过。独立真实MySQL实走两Case共享01/03、02/04分配、逆序分片映射及第二Case失败整体回滚；真实HTTP/MySQL验证05解析不生效、明确同步幂等、跨账户拒绝与目录下载原字节一致。TA回传均为合成夹具，无外部TA、本轮没有新增模型调用。PR35线上前后端CI已通过；其余stack线上审查状态以GitHub为准，不能称已合并main。

资料与截图：工作树.context/platform-completion/WORKLOG.md、global-data.png、global-files.png、global-data-mobile.png、project-lifecycle.png、file-exchange.png；界面规格docs/平台补全界面规格.md。回滚按39→35逆序撤销各PR单个功能提交；PR35含基底，撤销它也撤销本轮首次发布的本地基底。不要切换或清理根历史游离工作目录。

更新日期：2026-10-06。本文件记录本地 Git 仓库 `gf` 的产品线和版本选择，防止后续从外观相近的旧版启动或继续开发。Git 工作树和分支会变化；操作前仍须运行 `git worktree list --porcelain`、`git status --short --branch` 核对实时状态。

## 最新本地5194联调与账户验收（2026-10-07 20:14，尚未发布）

已验证发布main仍为下节eaef5498。当前用户验收使用独立扩展：Frontend `/Users/apple/.codex/worktrees/message-ui-review/gf`，分支codex/message-ui-review，功能提交596f7b07，最新预览e13d9ffc，5194/PID94564；Backend `/Users/apple/.codex/worktrees/live-message-backend/gf`，codex/live-message-backend，本地17a97571，API3103/PID54861。操作前核对实时Git和lsof。3102/5188发布基线、5191—5193视觉历史保留，本轮没有PR/push。根仍历史游离且有用户资产，不切分支、清理或批量提交。

主Case7418b64e（Chatcb600dfb）保留锁定Plan v4与两项明确确认。实际前端已走完01→本地合成02同步→03→本地合成04同步→通用业务输出补充→真实Sophnet核对→明确人工通过；真实LangGraph CASE_FINAL，父项目ACTIVE。正式三账户各100份，available/frozen未知保留null。12协议与3业务预期核对一致；TA回传和业务输出明确为合成演练，不代表外部真实系统执行。

个人登录/注册/退出/密码设置已接服务端账户及独立工作空间，Vite固定会话移除；跨账户请求拒绝、浏览器草稿隔离、跨标签退出和陈旧异步响应已实测。原127.0.0.1演练身份保留，没有代用户设置密码。独立登录预览用http://localhost:5194/?theme=liquid 。

首页布局保留。八个官方Coding Agent产品研究形成三版独立卡片/弹窗预览：http://127.0.0.1:5194/dialog-studies.html?skin=paper 、skin=graphite、skin=pearl；不调用业务API、不替换正式主页。包含独立编辑子弹窗，保存仅预览内存。桌面/320断点、数量变化/非对比/长内容/空状态、键盘返回焦点已检查。最新Backend302项通过/11项MySQL opt-in默认跳过，业务结果真实MySQL专项单独通过；Frontend12项通过及构建成功。来源、截图、范围、回滚映射在message-ui-review树.context/two-hour-integration/README.md；UI原MD续写27.28—27.30。

## 最终 main 已发布并复验（2026-10-07 00:35）

PR23–34共12个后端PR全部已合并。最终main提交为 `eaef54988b88ee71d573f5187cce4470817828ab`，独立验证工作树 `/Users/apple/.codex/worktrees/case-platform-verified/gf` 为clean detached HEAD；后续开发以该已验证main为基线。不要把原集成候选当作已发布main。

最终main实际复测：257项常规通过、10个MySQL opt-in默认跳过；另10项独立真实MySQL全部通过（0跳过）、迁移016中断恢复/复跑通过、临时库删除；legacy兼容测试2项通过；根Frontend构建通过。模型已真实调用Sophnet DeepSeek-V4-Pro-0813，TA回传均为合成夹具，未连接真实TA或执行物理重置。

当前运行API3102从验证树Backend启动，PID89343；根Frontend5188本地运行，PID20842；legacy8084不变。根Backend已同步最终main，根Git仍历史游离49a8c13b并含用户资产，禁止切分支/清理/批量提交；Frontend未上传。主设计docs/Case全流程设计.md与完整图已同步。旧候选工作树保留参考，不作为当前启动入口。

启动/重启使用本地证据目录 `.context/full-flow-acceptance-2026-10-06/restart-verified-main.py`：先核对进程归属，钥匙串密钥仅传入内存，不打印或落文件。首次新环境仍按Backend README安装、迁移和配置；该本机脚本不是通用部署工具。

最终main页面刷新已验证01→02→03→04五项预期一致、人工PASS/Chat CLOSED；05关联复测保留原FAIL及新PASS、100/90/10；失败02只有01且正式0/0/0，关联新Case来源只读、无继承Plan/草稿/申请/终判。8份原件SHA、5份上传字节全一致。证据、发布清单、main测试日志及截图见 `.context/full-flow-acceptance-2026-10-06/README.md`。

完整成功页面：http://127.0.0.1:5188/?platform=case-agent&chatId=e84c68d2-4362-457c-8b0f-a8e30939dbaf&caseId=d51a8e8b-e85e-4a3a-9ab1-33cc12131ad5 。

### 以下集成与早先记录为历史，以上述最终main为准

## 当前唯一业务集成入口（2026-10-06 20:54，发布进行中）

当前 Case／Agent 最新完整本地版本为 `/Users/apple/.codex/worktrees/exchange-plan-order/gf`，分支 `codex/backend-flow-integration`，已提交头 `7a8e7a49`（操作前核对实时HEAD）。严格Plan准备数据/预期双确认、02/04/05原文解析及显式正式同步、证据对照与人工终判、Chat正常/强制封存、同Chat关联复测、外部TA重置声明、原生LangGraph MySQL checkpoint/interrupt恢复均已集成。主设计 `docs/Case全流程设计.md` 已按实际代码同步，九个interrupt等待节点与完整讨论/文件分支图可查看。单元250项通过、10个opt-in常规跳过；独立真实MySQL10项全部通过，覆盖迁移复跑/中断恢复/业务回滚/双连接竞争/封存并发。

本地运行：API3102从上述工作树Backend启动，当前PID85950；根Frontend5188仅本地接入，PID20842；legacy8084不变。根Backend为同步副本，根Git仍历史游离49a8c13b且含大量未提交资产，禁止直接切分支/清理/批量上传。后续后端开发以集成树为准，远端发布进度须查GitHub PR及origin/main，不能把本地完整代码或跳过的stack CI当作已合并。根Frontend所有新接入不会上传后端PR。

当前完整通过验收地址：http://127.0.0.1:5188/?platform=case-agent&chatId=e84c68d2-4362-457c-8b0f-a8e30939dbaf&caseId=d51a8e8b-e85e-4a3a-9ab1-33cc12131ad5 。真实Sophnet Plan的5个明确预期副本经UI双确认→草稿→01→02→03→04→建议PASS→最终PASS→正常Chat封存；02纯解析正式0/0/0，02应用后1/0/0，04纯解析仍1/0/0，04应用后1/1/1、100元100份。TA回传明确是合成测试夹具，未连接真实TA。真实Sophnet还验证原FAIL预期100/实际90可供同Chat后续讨论；新Case未继承Plan确认或产生正式数据。原真实模型Plan待用户审阅仍保留，不等同自动验收副本。

已上传后端链从PR23（05）/PR24（判断）/PR25（Plan补丁）开始，后续生命周期/重置/统一接收/耐久编排/文档正拆分发布；全部只含Backend和MD。用户在本轮明确授权多个agent自主完成审查、修复、整体复测，不逐个等用户人工验收。未实现范围：真实TA网络投递/物理重置、ZIP和跨通道任意整包自动路由、交易日历、未支持业务账务、自由文本完整语义证明。支持的正式会计效果仍是001/101开户与022/122申购及显式05余额快照。

启动/重启应由已核对进程归属的 `/tmp/gf-holdings-restart.py` 执行（钥匙串密钥只入进程内存），根Frontend在其目录使用本机缓存pnpm启动；不要从历史fund-sales-demo启动当前Case平台。首次新环境先按Backend README安装及迁移，不能假设本机脚本/PID通用。

关联05完整复测地址：http://127.0.0.1:5188/?platform=case-agent&chatId=a54f569c-935d-4392-b567-f4737039f3bd&caseId=3e382b6c-9f64-4e28-9b18-f16ce7cef0b1 。原05总90份对预期100最终FAIL保留；同Chat关联新Case经真实Sophnet完整生成v2 Plan，初始客户/账户/持仓均为空，仅基金元数据；双确认和草稿确认不改正式数据。纠正05纯解析仍90/80/10，显式同步后100/90/10，三个字段断言一致、人工PASS、Chat正常CLOSED。重启和刷新保留原FAIL及新PASS。最新字段数值/比较方向/完整非数值token护栏后，独立真实Sophnet2调用再次生成正确3断言、无missing、未写数据库。新一轮空Chat与强制封存也已UI验收，未执行Case保留DISCUSSING。六份原始文件摘要与四份上传字节验证通过。后端验收报告为集成树Backend/docs/full-flow-acceptance-2026-10-06.md。

最终普通中文真实Sophnet复测：用户仅给“开户成功、申购成功”，未指定技术状态枚举，三次真实调用生成2笔申请、5项断言，READY、无missing、无初始持仓，未持久化。最新本地集成233常规通过/8 opt-in跳过；另8个独立真实MySQL全部通过。后端已重启加载最新代码，发布后的main仍将按实际提交再次复核。

## 只保留的两个项目

| 项目 | 应使用的版本 | 本地位置 | 说明 |
| --- | --- | --- | --- |
| 深蓝色模拟销售＋模拟 TA Demo，带文件交换动画 | **保留：原始基线 `11200d4d`；已审查版本 `codex/blue-simulated-demo` 的 `31f1a91b`；独立仓库 `main` 的 `16cc14a`** | 原仓库工作树 `/Users/apple/Documents/ChatGPT/gf-worktrees/nebula-ui`；独立仓库 `/Users/apple/Documents/ChatGPT/fund-sales-ta-demo`，GitHub 私有仓库 `yqsota666/fund-sales-ta-demo` | 用户已根据[当时的深蓝封面](.context/design-reports/screenshots/first-impression.png)确认。`web/src/main.jsx` 的 `RunStatusDialog` 使用 ReactFlow 绘制销售与 TA 双系统及文件流，`web/src/run-flow.css` 定义动画。销售 Node/MySQL、模拟 TA Node/Oracle、SFTP 仍在。独立仓库只导出了此 Demo 的应用目录，重新建立 Git 历史，不包含酒红色基础版、Agent 平台或原仓库其他样例。后续发布改动应以独立仓库为准。 |
| 当前 Case／Agent 测试平台 | **唯一最新集成：`codex/backend-flow-integration`；远端发布PR23起，实时状态见顶部** | 远端源码核对：`/Users/apple/.codex/worktrees/exchange-plan-order/gf` 的 `origin/main`；本地运行：`/Users/apple/Documents/ChatGPT/gf/Frontend`、`/Users/apple/Documents/ChatGPT/gf/Backend` | 前后端目录已分离；后续PR仅Backend和MD。最新完整本地界面为5188的platform=case-agent，正式发布状态与本地验收区分。Backend/legacy 仍提供当前界面依赖的兼容 API；完整发布和验证记录见顶部“最新发布进度”。 |

## 2026-10-06早先记录（历史，已被上方集成入口覆盖）

Case结果判断已本地实现并接入：当前开发分支 codex/case-result-review，本地提交 bb3bfd2a，工作树 /Users/apple/.codex/worktrees/exchange-plan-order/gf，基线是本地05同步提交5cdc3e1e（codex/ta-holdings-return-sync），两个改动可分别审查，均未上传远端。新增LangGraph结果收集、预期对照、建议解释、等待人工确认，建议不修改销售数据或最终Case状态。人工确认核验最新版本和证据未变后保存最终PASS/FAIL；严格Plan格式补丁仍未实施。181常规测试通过、3个MySQL opt-in常规跳过；独立真实MySQL迁移/回滚/建议与人工确认通过，前端构建通过。已通过实际页面调用Sophnet DeepSeek-V4-Pro-0813：基金000005、总150、可用120、冻30四项一致；建议PASS，最终结论仍未确认，Case保持SOP_LOCKED。API3102当前PID52010从此工作树Backend运行，根Backend已同步，Frontend只在本地接入。当前验收页仍为下方holdings-sync地址，包含Case结果判断卡片。完整原生checkpoint/interrupt全流程编排、自由文本语义完整性证明、严格Plan字段补丁不在本次范围。

05同步开发已在本地接入：工作树 `/Users/apple/.codex/worktrees/exchange-plan-order/gf`，分支 `codex/ta-holdings-return-sync`，基线 origin/main `ec29a19d`。包含独立05上传/解析、Plan时序核验、显式账户余额同步及04防重复计量，未实现Case判断、未实施Plan严格格式补丁。Backend代码和MD为本地待验收变更，尚未上传PR；Frontend仅本地改动。API3102已改从此工作树Backend运行，PID50115；Frontend5188、legacy8084不变。根目录Backend同步本次及PR22涉及的源码，运行仍从上述工作树启动。真实MySQL新库/复跑/迁移中断恢复/业务回滚通过，177常规测试通过、3个MySQL opt-in跳过。合成05经实际页面上传/确认同步：基金000005总150、可用120、冻结30，原有990905持仓200不变。验收入口：http://127.0.0.1:5188/?acceptance=holdings-sync&chatId=69b02d9d-405b-486b-9b5f-579a5f1a4fc3&caseId=eb41c759-10ce-4706-8f43-c2edb562b9b8 。模型密钥可读取；本次协议节点不调用模型，不宣称真实TA或真实模型验收。下方PR21运行记录为历史，当前入口以本段和实时Git状态为准。

文档同步工作（本地，未上传）：用户要求以当前代码为准纠正 MD。`/Users/apple/.codex/worktrees/exchange-plan-order/gf` 此前切换至 `codex/docs-code-alignment`，现由 `codex/ta-holdings-return-sync` 承接，基于 `origin/main ec29a19d`，只修改主设计 MD；原功能分支 `codex/exchange-plan-order` 保留不变。根目录 `docs/Case全流程设计.md` 与该工作树主稿同步，明确 Workspace → 父 Chat → 多个 Case，并更新 PR21／22 流程与实际限制；另外四份历史产品稿标明当前主设计入口。原稿备份 `/tmp/gf-doc-alignment-backup/`。Plan 严格数据定义与结果预期补丁仍在讨论，未修改业务代码。

用户已授权审查修复后上传并合并。PR21 https://github.com/yqsota666/TA-case-test-Agent/pull/21 已合并，合并提交为 `a3e284aa5a422790762c0fa123f6deb99ff395e1`，PR 最终 HEAD 为 `6d516567ed9f914f14d218c2019d8f453a714165`。仅 Backend 改动，包含独立 02/04 解析和 TA 确认后正式数据生效；交叉审查及 CodeRabbit 意见已修复，前后端 CI 与 CodeRabbit success，全部线程已解决。153 常规测试、独立 MySQL 业务及真实并发测试、legacy 2 项测试通过。

PR22 https://github.com/yqsota666/TA-case-test-Agent/pull/22 已于北京时间 2026-10-06 16:24:25 合并到 main，最终 HEAD `65ade91ab6e2dd2a74dcecc4df8580965553c13c`，合并提交及当前远端 main 为 `ec29a19dc902e3b5873175365a3859aee6a24895`。工作树 `/Users/apple/.codex/worktrees/exchange-plan-order/gf`，分支 `codex/exchange-plan-order`，干净，origin/main 已 fetch 核对。172 常规测试通过、3 项 MySQL opt-in 在常规测试中跳过；此前独立 MySQL 多包、旧计划补齐、混批恢复及双连接并发测试通过。CodeRabbit 四项时间证据意见已修复，全部审查线程已解决，最终 review APPROVED、CodeRabbit success、前后端 CI success。仅 Backend 改动；05 仅规划表达，尚无上传解析同步。

本地页面仍为 PR21 验收：root Backend 已同步 PR21 最新生产修复，API3102 PID39945，Frontend5188、legacy8084 不变。Frontend 只保留本地改动，PR22 时序 UI 尚未接入。根目录历史游离检出及其他资产未上传或清理。审查记录 `/tmp/gf-premerge-review-record.md`。后续各节中“未上传”等描述是历史记录，以本节和实时 Git 状态为准。

## 版本演进与取舍

| 时间 | 提交或分支 | 发生的事 | 现在的取舍 |
| --- | --- | --- | --- |
| 2026-09-27 15:52 | `727c11d8`，原本地 `main` | 酒红色基础 Demo：模拟销售、模拟 TA、文件交换。 | **废弃。禁止启动、回退或作为新开发基线。** 本地 `main` 指针已删除；此提交仍是后续版本的 Git 祖先。 |
| 2026-09-27 16:01–22:19 | `a39f8daa` → `92d0d6c0` → `26a2232d` | 从酒红色基础 Demo 改成深蓝色 Nebula 界面并做两轮修复；销售和 TA 都有模拟服务。 | **不是用户指定的最终保留版**：`26a2232d` 只有步骤进度弹窗，尚无销售／TA 文件交换动画。原先把它选作保留版是误判。 |
| 2026-09-27 22:23 起 | `e0ea1af6`、`codex/workspace-real-ta-import`、`codex/business-protocol-docs` | 在蓝色 Demo 之后加入工作空间隔离、真实 TA 回传导入、业务协议文档。 | 中间演进；**不要当成第一版蓝色 Demo**。 |
| 2026-09-28 09:50 | `11200d4d` | 设计审查前存档。新增 `run-flow.css` 和 ReactFlow 文件交换动画；可见销售系统、TA 系统、申请与回报文件的流转。原有模拟销售和模拟 TA 服务仍在。 | **用户确认保留**；现为 `codex/blue-simulated-demo` 的起点。 |
| 2026-09-28 其后 | `49a8c13b` | 同一深蓝 Demo 的视觉审查与调整，文件交换动画还在。 | 比 `11200d4d` 晚，不作为“第一版”默认入口；当前仓库主目录游离检出在这里且混有大量未提交的新平台代码。 |
| 2026-09-28 起 | `codex/customer-context-workbench`、`codex/ta-reconstruction-v21` | 客户上下文、真实 TA 状态驱动和账户重建等后续方向。 | 中间演进，不用作指定的深蓝模拟 Demo。 |
| 2026-09-29–10-03 | `codex/case-agent-backend-base` → `codex/global-case-workflow` | Case 后端、LangGraph Agent、父 Chat 下的多个 Case、共享数据和 OpenHands 风格工作流 UI。 | **向 Agent 过渡的另一条产品线**，不能当成用户要保留的深蓝模拟销售／TA Demo；其最新版仍属当前 Case／Agent 项目，`global-case-workflow` 有未提交 UI 与文档变更。 |
| 2026-10-03 | `40b2dd49`，包含于 `codex/global-case-workflow` | 新增 `workflow-app.jsx`、`workflow-openhands.css`，将界面变成 Case／Agent 工作流。它与 `11200d4d` 的 Git 共同祖先是酒红色基础提交 `727c11d8`，并非在 Git 中直接继承 `11200d4d`。 | **不可误认作深蓝模拟 Demo 的新版。** 用户不希望保留这条“过渡 UI”作为独立旧项目；当前 Agent 项目是否继续使用其中功能，以最新集成结果为准。 |
| 2026-10-03–04 | `codex/ta-protocol-codec`、`codex/ta-case-persistence`、`origin/main` 到 `7776b1d6` | 按 PR 将 TA 协议、Case 持久化、交换批次与回传归属合入远端 `main`。该线主要是后端与协议包，不能凭分支名推断含有完整 UI。 | 当前项目的已合并基础；以实际 `origin/main` 最新提交和文件树为准。 |
| 2026-10-04 | Agent PR 链到 `codex/agent-persisted-plan-proposal`（盘点时 `b4e495f1`），另有审查工作树 | 首次讨论、持续讨论、Plan 提议和确认、讨论持久化的增量开发；PR 审查仍在进行。 | 当前项目的进行中工作；PR 合并和验证前不要删除正在使用的工作树，也不要认定 `b4e495f1` 永远是最新版。 |
| 2026-10-05 | `codex/blue-simulated-demo` 到 `31f1a91b`；独立仓库 `main` 到 `16cc14a` | 修复 Oracle 初始化误报、端口仅绑定本机；补齐测试和依赖安全升级；优化封面标识，验证 22 项单元测试与销售／TA 全链路；从 `fund-sales-demo/` 建立单独 GitHub 私有仓库，并记录与 Agent 平台并行运行的端口配置。 | **现在发布和优化深蓝模拟 Demo 应进入独立仓库 `fund-sales-ta-demo`。** 原仓库的蓝色分支仍可用于核对来源，不作为上传整个原仓库历史的入口。 |

## 当前工作树的处理边界

最初盘点时共有 13 个已登记工作树。2026-10-04 清理 4 个历史工作树；2026-10-05 实时核对为 10 个。数量会随其他任务实时变化。独立 Demo 仓库不属于原仓库的 Git 工作树。

| 工作树（路径尾部） | 盘点时分支／状态 | 处理原则 |
| --- | --- | --- |
| `/Users/apple/Documents/ChatGPT/gf` | 游离 `49a8c13b`；大量未提交及未跟踪内容 | 当前工作目录包含新平台未提交代码与文档。**先分离、核对这些内容，再清理旧检出；不可强制删除或直接切分支。** 不从此目录按旧版 README 启动。 |
| `gf-worktrees/nebula-ui` | `codex/blue-simulated-demo`，`31f1a91b`；干净 | **保留**：用户确认的深蓝动画版及发布前修复。目录旧名 `nebula-ui` 不代表原 `codex/nebula-glass-ui-reviewed` 分支。发布仓库见上表。 |
| `gf-worktrees/global-case-workflow` | `codex/global-case-workflow`；有未提交 UI／文档 | 当前 Case 工作流 UI 所在处；完成集成前保留。 |
| `gf-worktrees/case-agent-backend-base` | `codex/case-agent-backend-base`；有未提交内容 | 当前 Case 后端早期线；核对独有改动后再淘汰。 |
| `.codex/worktrees/ta-protocol-contract/gf` | `codex/agent-persisted-plan-proposal`；有未提交内容 | 当前 Agent 较新的持久化开发线；完成 PR 后再收拢。目录名已不代表当前分支。 |
| `.codex/worktrees/agent-pr-review/gf` | Agent PR 审查时会切换分支 | 其他任务正在使用；完成审查和合并前不可清理。 |
| `.codex/worktrees/agent-repo-no-ui/gf`、`.codex/worktrees/ta-codec-review-fix/gf`、`.codex/worktrees/review-policy/gf` | 旧 PR 的独立工作树 | 中间产物；确认没有任务使用后可清理工作树，不以它们启动当前项目。 |
| `gf-worktrees/business-docs`、`gf-worktrees/customer-context-workbench`、`gf-worktrees/workspace-import` | 早期中间分支；清理前干净 | **工作树与对应本地分支已移除**。远端分支或 Git 历史可能仍在，禁止作为两个保留项目的入口。 |
| `gf-worktrees/ta-reconstruction-v21` | 后期蓝色分支；清理前有未提交内容 | **工作树已按用户“其他全部废弃”要求强制移除，未提交内容已丢弃；本地分支已删除。** 已提交历史仍可能被其他引用保留。 |

### 已执行的本地清理

- 将 `gf-worktrees/nebula-ui` 从无动画的 `26a2232d` 切换为 `11200d4d`，创建保留分支 `codex/blue-simulated-demo`；该工作树保持干净。
- 移除 4 个上述历史工作树。
- 删除本地分支 `main`（原指向红色基础版 `727c11d8`）、`codex/nebula-glass-ui-reviewed`（无动画蓝色版）、`codex/pre-design-review`（与新保留分支同一提交）、`codex/nebula-glass-ui`，以及 `business-protocol-docs`、`customer-context-workbench`、`workspace-real-ta-import`、`workspace-real-ta-import-candidate`、`ta-reconstruction-v21` 的 `codex/` 本地分支。未删除远端分支，未重写 Git 历史。
- 由其他 Codex 任务管理的 `.codex/worktrees/*` 及仍有当前 Case／Agent 独有改动的工作树暂时保留，待其任务完成、改动集成后再收拢。
- 在仓库根目录新增 `AGENTS.md`，并在本机 `~/.codex/AGENTS.md` 增加仅针对这个 Git 仓库的入口规则：新 Codex 任务选分支、工作树或启动方式前先读本文件。已有任务可能须重新开始才会重新加载指令。
- 从 `fund-sales-demo/` 建立 `/Users/apple/Documents/ChatGPT/fund-sales-ta-demo`，只保留深蓝模拟应用并单独初始化 Git；已上传到 GitHub 私有仓库 `yqsota666/fund-sales-ta-demo`。该新仓库有自己的 `AGENTS.md`，要求先读其 `README.md`。

## 后续启动与清理规则

1. 要看或优化**深蓝色模拟销售＋模拟 TA 文件交换动画**，优先使用独立仓库 `/Users/apple/Documents/ChatGPT/fund-sales-ta-demo`；原始代码基线为 `11200d4d`，独立仓库当前 `main` 为 `16cc14a`。原仓库保留工作树 `/Users/apple/Documents/ChatGPT/gf-worktrees/nebula-ui` 可核对来源。`web/src/main.jsx` 有 `aria-label="销售系统与 TA 系统之间的文件交换动画"`。同时运行 Agent 平台时使用独立仓库 README 中的 `docker-compose.parallel.yml`，Demo 地址为 `http://127.0.0.1:15173`。不要使用旧的 `codex/nebula-glass-ui-reviewed`，该版没有动画。
2. 要看**当前 Case／Agent 项目**，先确认当前 PR 链是否已经合并、最新可运行 UI 与 Agent 是否已集成，再在此写下唯一的分支、提交、工作树与启动命令。2026-10-04 盘点时没有足够证据指定一个完整的“最新版”目录。
3. 删除工作树不等于删除 Git 历史。酒红色 `727c11d8` 仍是原仓库蓝色分支的祖先；新建的独立 Demo 仓库从应用文件重新初始化，历史里没有酒红色版本。原仓库的该提交仍可被 Git 历史引用，本文件将其列为禁止使用的历史提交。
4. 对带有未提交改动、正在运行进程或由其他 Codex 任务管理的工作树，先核对独有内容和任务状态，再清理。完成收拢后更新本文件中的工作树数量与最终入口。

## 2026-10-05 前后端目录收拢

当前 Case／Agent 本地代码按用户要求分为两个实体目录：`/Users/apple/Documents/ChatGPT/gf/Frontend` 与 `/Users/apple/Documents/ChatGPT/gf/Backend`。前端来源 gf-local-frontend；后端来源 codex/ai-application-preparation 的4308b79f及本地申请准备修复。Backend/legacy保留当前前端仍需的旧聊天/登录接口；这不代表全部业务API已迁移。详细安装、启动和来源见两目录README及FRONTEND_BACKEND_LAYOUT.md。原工作树和未提交改动暂时保留，不从根目录旧fund-sales-demo启动当前Case平台。此整理尚未提交或上传GitHub，不改变上文独立深蓝动画Demo入口。

拆分后验证：Frontend独立构建成功；Backend的127项测试全通过；8084、3102、5188服务分别从Backend/legacy、Backend、Frontend启动。演示登录和“PR20修复后验收”文件卡片读取成功，原01及350元03均可访问。

## PR20已提交（2026-10-05）

前后端拆分及申请准备修复已提交GitHub PR20：https://github.com/yqsota666/TA-case-test-Agent/pull/20 。分支 `codex/frontend-backend-split`，审查/上传工作树 `/Users/apple/.codex/worktrees/frontend-backend-split/gf`，HEAD `b75aebe9`，基线main `0f0b9821`。前端统一进入Case工作流，历史Demo入口已从Frontend去除；根Backend补齐seed脚本的mysql2依赖。根目录Frontend/Backend已同步相同源码，仍用于本地运行；根目录旧游离检出及其他未提交内容没有上传。两轮独立审查闭环完成，第二轮can-merge。PR未合并；远端CI状态须查PR页面实时结果。

PR20远端验证记录：GitHub Actions运行37334768156的frontend、backend两个job均success，检查HEAD b75aebe9。未合并。

## PR20已合并（2026-10-06）

用户明确要求合并后，PR20于北京时间2026-10-06 00:12:58成功合入远端main，合并提交 `b1dcfbcf762f7cac0c6947782d1dcc58707243f6`，PR最终HEAD `bb3de0625f095e3f44cfadf073ab8380b53380e1`。GitHub frontend、backend检查均success，CodeRabbit复核状态success。审查工作树已fetch并核对origin/main相同提交，工作树干净且保留 `codex/frontend-backend-split` 分支。

当前Case／Agent平台源码入口为该main提交中的 `Frontend/` 与 `Backend/`；根目录同名目录保留本地验收运行副本。Backend/legacy继续提供兼容接口。此前“尚未提交／未合并”的记录属于历史状态，以本节及顶部入口表为准。未切换或清理根目录历史游离检出，未上传其中其他未提交内容。

## 02 回传 API 本地待验收（2026-10-06）

后端分支 `codex/ta-account-return-api` 从已合并 main `b1dcfbcf` 开始；工作树为 `/Users/apple/.codex/worktrees/frontend-backend-split/gf`，本地提交 `fc1fa5bc63edd90bf82aaf71079857d83b2c09f6`，工作树干净。提交仅修改 Backend 下 7 个文件：交付确认、原始 OFI 及 02 导入、逐条申请匹配、TA 绑定及迁移、测试、文档。尚未 push 或创建 GitHub PR。

根目录 Backend 已同步本次运行源码；Frontend 只在本地接入验收。验收地址为 `http://127.0.0.1:5188/?acceptance=account-returns&chatId=47b4dfc8-d7d7-4232-a315-8facfebd9608&caseId=9f31dcbf-bb05-4b78-8ae8-ec691b83306b`。新 Case 为合成开户后申购 450 元：01 和 02/OFI 使用合成夹具，02 实际经界面上传并匹配；03 由真实 Sophnet DeepSeek-V4-Pro-0813 生成，TA_RETURN01 来自 02 绑定。界面再次继续生成成功，仍为 2 份申请和 2 份原始发文。136 项后端测试、前端构建、实际 MySQL 及原始下载摘要验证通过。先让用户查看本地结果，再上传纯后端 PR。


## 02／04 纯解析本地待验收（2026-10-06，当前运行入口）

用户将下一 PR 范围明确为“01 生成后手动上传 02、03 生成后手动上传 04，先单纯解析”。当前后端分支 `codex/ta-return-parsing` 从 main `b1dcfbcf` 开始，工作树 `/Users/apple/.codex/worktrees/frontend-backend-split/gf`，本地提交 `ba4e9276`，仅 Backend 下 14 个文件，未 push、未创建远端 PR。之前的本地 `codex/ta-account-return-api` / `fc1fa5bc` 保留供参考，不作为本次运行接收入口；其自动匹配/绑定 02 功能没有纳入本 PR。

当前 root Backend 已同步纯解析代码，Frontend 仅本地接入分开的 02／04 上传及原始字段查看；旧模拟 TA 展示组件已从当前页面移除。API 3102 / Frontend 5188 / legacy 8084 启动目录不变。验收地址仍为 `http://127.0.0.1:5188/?acceptance=account-returns&chatId=47b4dfc8-d7d7-4232-a315-8facfebd9608&caseId=9f31dcbf-bb05-4b78-8ae8-ec691b83306b`，标题改为“02／04 回传解析本地验收”。

本次新增四个 LangGraph 节点：等待开户回传、解析开户回传、等待交易回传、解析交易回传；等待从持久化生成文件恢复，上传事件重新 invoke 对应路径，成功结果和原文件持久化。不是已完成全 TA 流程的 checkpoint/interrupt 图。支持直接 03 等 04，不强制 01；此入口不匹配申请、不绑定账户、不修改业务状态、不做05和判定。

142 项后端测试、Frontend 构建、实际 MySQL 新库迁移和复跑、已用库升级、跨 Case/Workspace 隔离、重复解析、模拟原文件存储故障回滚通过。实际 UI 上传合成 OFI+02（2条）和04（1条），错类型明确拒绝、重复不新增、刷新和后端重启后结果保留。04金额450.00、份额450.00、净值1.00000000；三个原文件摘要通过核对。上传前后 applications、TA绑定、Case、批次、交换文件、已匹配回传数据完全一致。已有02绑定来自上一轮验收，本次没有创建新绑定。此次纯解析不调用模型，也尚未验证用户真实 TA 文件。验收报告 `/tmp/gf-return-parsing-acceptance-report.md`，截图 `/tmp/gf-return-parsing-acceptance.jpg`。

## TA 确认后销售数据生效，本地待验收（2026-10-06，当前运行入口）

当前修复分支 `codex/ta-confirmed-sales-data`，工作树 `/Users/apple/.codex/worktrees/frontend-backend-split/gf`，本地提交 `58f3c5dc`；基于保留的纯解析提交 `ba4e9276`。仅 Backend 提交，未 push、未创建远端 PR。根 Backend 已同步，根 Frontend 仅本地接入，3102／5188／8084 端口不变。

构造的 `case_generated_*` 仅为申请草稿/测试条件；销售正式查询改读独立确认账户、确认交易和持仓表。已发送 01 的有效成功 02 才建立正式账户/绑定；已发送 03 的有效成功 04 才按实际确认量建立交易/修改持仓。上传纯解析不生效，失败/不匹配/未发送/不支持/非最终确认不改正式数据，重复幂等，错误整事务回滚。当前明确支持开户 001/101、申购 022/122；不包含05或其他业务的会计效果。旧模拟数据及历史绑定不自动追认为正式数据。

新合成验收地址 `http://127.0.0.1:5188/?acceptance=account-returns&chatId=f610015a-3f4d-41f8-ba9f-050d1cb151c0&caseId=1f7c371f-8190-421f-b0b0-912e2410d430`。申请草稿故意包含888份；正式账户在02前为0，02成功后为1；04纯解析后正式交易/持仓仍为0，04成功应用后确认成交250元、持仓200份（申请450元），已通过实际UI上传/应用。申请与TA回传为明确合成夹具。Sophnet最小真实请求HTTP200有文本，但本轮完整申请准备UI调用失败INTERNAL_ERROR，未宣称完整模型生成通过。152项单元/API测试、独立真实MySQL回滚集成、新库/已有库迁移与复跑、前端构建通过。验收报告 `/tmp/gf-confirmed-sales-acceptance-report.md`，PR正文草稿 `/tmp/gf-confirmed-sales-pr.md`；先让用户查看本地结果再上传。

## 独立前端配色验收（2026-10-06）

仅视觉 Demo：frontend 工作树 /Users/apple/.codex/worktrees/frontend/gf 保留 5190 当前中性配色；新 codex/feihong-light-color 工作树 /Users/apple/.codex/worktrees/feihong-light-color/gf 于 5191 运行浅蓝／暖白配色试验。新工作树从 frontend 分支复制该页面当前未提交实现，再只调整颜色；未改布局、排版与交互，未集成新版后端。两者是同一 Case／Agent 产品的视觉比较，不是新增产品方向。不得用这两个 Demo 替代 5188 的业务验收入口。

5191 配色分支后续已获用户授权升级为完整视觉精修，不再局限于颜色；原 5190 不变。原配色源码备份于新工作树 .context/before-refinement，业务接入范围未扩大。

## 发布收尾进度（2026-10-06 20:35）

PR23–25已经分别合并为5d7e74ee/4c0defb4/022dc7eb，后者在required CodeRabbit真实完成、CI通过及所有线程解决后合并。PR26–31稳定最新链正在逐个接main；新PR32开发候选树为/Users/apple/.codex/worktrees/terminal-ta-failure/gf，负责已经应用的失败02阻断必需03时进入结果核对而非永久等待，不放行03、不改正式账户。main最终验证树/Users/apple/.codex/worktrees/case-platform-verified/gf已预安装缓存依赖，但尚未更新并验证最终main，不能作为当前运行入口。仍用上方集成树3102及根Frontend5188。新增合成失败验收Chat ea41173d-912a-4da1-ab31-7a4849ec1182、Case250d3b36-7a48-4bb2-a40d-4371b4753578已双确认Plan→01→失败02应用，账户94176913828162661正式0/0/0、只有01；当前正在用此Case复测32。


最新收尾（20:54）：PR32已创建，失败02阻断必需后续时进入结果核对；实际UI已拒绝人工PASS，保存FAIL并关联新Case，正式数据0/0/0且只有01。最新判断数值ID排序修复通过11次真实判断，旧9拒绝、最新11生效。8份原件SHA及5份上传字节全一致。PR26当前真实CodeRabbit检查进行中，其后27–32仍待依序满足仓库保护并合并；禁止把本地完成当作远端已完成。


补充真实模型关联讨论（21:03）：新失败02后续Case7e1b621f实际经UI调用Sophnet完成讨论，回复正确识别02返回0001开户失败、03/04未继续、无成功正式账户交易持仓，并询问是否定位失败或重规划。没有生成新Plan或确认/草稿/申请；来源review11只读。截图/tmp/gf-terminal-real-model-discussion.jpg。


最新32查询上限修复：任一失败证据或关联申请查询超过500项明确截断，需要REVIEW，不以部分映射推断PASS/FAIL；独立审查无阻断。246常规通过、9项独立真实MySQL全过，501联动在真实SQL返回后注入行数，不宣称实插501条TA确认；原普通/可选桥接真实失败路径也通过。PR26已合并main9892f9aa，27实审进行中，最终main树仍不作为运行入口。


本地验收截图与结构化证据已保存.context/full-flow-acceptance-2026-10-06/，不依赖/tmp长期保留。PR27测试锁清理顺序06cbdbfc已独立真实MySQL通过，源业务代码不变，集成HEADaaa90beb。


PR27重置请求UUID大小写幂等Major已修0cc68dca，本地b588a442。兼容历史大写键，重复只返回原事件，不多产生epoch，不覆盖历史；不同原因冲突拒绝。同UUID不同通道及Workspace独立。负控复现epoch2而非1，修后真实并发/历史兼容回归通过，独立审查无阻断；root整体246常规+9真实MySQL再次全过。发布仍以GitHub实际required状态为准。


PR33本地c2f56da9已修Chat新轮次/关联复测请求UUID大小写幂等，独立审查无阻断。root整体246常规/10skip及10独立真实MySQL全通过，运行庫两个既有合成链接大写请求重放返回duplicate和原目标、Chat/Case/link数量不变。最新日志及API证明在本地证据目录。工作流eventId同类幂等也正在29中补，不能把当前运行候选当最终main。


最新候选0547235b/API79782已含29工作流eventId大小写幂等和28混包05 hash范围修复，246常规+10真实MySQL再次全部通过。真实API同一通知大小写重放仅1事件/同checkpoint、改expectedStage409、非字符串400，Case仍DISCUSSING。PR27实际已merge main e8d2d9e，PR28 actual f1e5000f两CIgreen/required CodeRabbit PENDING，PR29/33也实审中。根/集成不是最终已发布main；最终main树仍待全链合并后复验及启动。


最终本地候选c1d1da57已含33历史UUID多目标保守409，单条历史正常兼容；独立审查通过。246常规/10skip与10独立真实MySQL再次全部通过，API80638加载最新候选。PR28已实际合并main36bee408，29新main基线d34d实审中；最终main仍待全链通过。


最新集成031ca7b6/API82036已含独立预期不足REVIEW与未唯一TA失败映射无ready必要动作→结果核对补丁，独立审查无阻断，248常规/10skip及10独立MySQL全通过。PR29/30实际main已合37315871，31–33需最新冲突解决与必需审查；完整图及本地证据已同步。

## 5194 流程图与无文件准备确认本地验收（2026-10-07）
仅继续5194真实模型消息UI联调：message-ui-review树codex/message-ui-review本地9e8550cd新增完整Case节点图弹窗，原有其他UI未提交变更保留未纳入。live-message-backend树codex/live-message-backend本地2dab9f6f允许NOT_REQUIRED方案的DATA确认，未放开缺失预期或尚未支持的无文件终判锁定。当前API3103 PID19314，Frontend5194 PID94564；3102最终main与5188保留不变。270常规通过/10 opt-in跳过，另1真实MySQL事务回滚测试通过，5前端图状态测试/构建通过。没有新模型调用、PR或push。原一年边界Case aa72ec0d仍CONFIRM_PLAN_DATA、v1无人工确认、数据NOT_STARTED；流程图不冒充已执行。证据message-ui-review树.context/live-integration/workflow-diagram-state.json及desktop/mobile截图。

5194预期审阅补充（同日）：frontend本地7a25d8ce接入真实DATA确认与预期结果卡片/详情弹窗。按用户“下一步来看”要求通过实际UI确认原Case aa72ec0d的Plan v1 DATA部分，当前已CONFIRM_EXPECTATIONS；仅DATA确认，草稿NOT_STARTED、Plan未锁定。系统构造问题仍阻止EXPECTATIONS确认，不能宣称全链路完成。真实状态与截图见message-ui-review树.context/live-integration/expectation-review-state.json、expectation-review-desktop.png。API3103/PID19314不变。


## 5194 通用方案审阅及真实模型编辑（2026-10-07，更新上节）
Frontend5194/PID94564继续在message-ui-review树codex/message-ui-review运行，本地新提交ba0b717a；已有logo、项目选择、其他主题改动保留未纳入。Backend3103/PID33513在live-message-backend树codex/live-message-backend运行本地48a21d99；3102与5188原运行入口保留。未push或上传PR。
当前Case aa72ec0d-8378-41ab-849d-22257b24461a真实模型审阅后为Plan v3 PENDING_CONFIRMATION / CONFIRM_PLAN_DATA，无当前版本确认，草稿NOT_STARTED。原v1 DATA确认是历史记录。新版本保留原准备数据，业务预期独立于TA字段绑定，旧系统能力误判已通过真实模型无文件审阅路径纠正。没有执行计算或全流程。
275常规通过、10可选跳过，独立真实MySQL双确认/回滚通过，前端构建与桌面/窄屏检查通过。证据分别位于message-ui-review树.context/plan-review与live-message-backend树.context/plan-review/live-state.json。可按前后端提交分别回滚；精确修改前前端源码另存.context/plan-review-before。


5194下一节点验收：用户要求先跳过方案视觉调整、继续流程。通过真实UI确认v3 DATA及EXPECTATIONS，服务按已锁定规格自动执行数据生成图，生成3客户/3账户/1基金/3持仓，每账户100份；当前CONFIRM_DRAFT，数据VALIDATED/PENDING_REVIEW、1执行记录、0草稿确认。未继续计算、文件交换或结果判定。前端dff00d33新增真实草稿卡片与四张独立数据页，修正旧followup数据入口空白，保留确认草稿按钮未点击；构建通过。证据message-ui-review树.context/draft-node/holdings.png及live-message-backend树.context/plan-review/draft-state.json。模型未新增调用，后端源码未改。

5194草稿确认下一步：用户要求下一步，实际UI提交data/confirm，数据库新增1草稿确认，数据记录未重复生成。真实工作流进入EVALUATE_RESULT，尚未调用result-review/evaluate或确认测试结果。该Case NOT_REQUIRED文件交换，两文件节点显示“不涉及”，不再冒充已执行；流程图6项测试及构建通过。实际截图message-ui-review树.context/draft-node/result-stage.png。


## 5194 模拟数据文件约束与保留历史重规划（2026-10-07）
当前Frontend5194/PID94564仍在message-ui-review树codex/message-ui-review，本地e0e29d5f；仅修复新建Case后残留draftTable参数，原有其他未提交UI保留。Backend3103/PID42831在live-message-backend树codex/live-message-backend，新增文件约束9f8ef61e及业务预期保留补丁a9885447（操作前仍核对实时Git）。3102已验证main与5188保持不变；没有PR/push。
旧Case aa72ec0d-8378-41ab-849d-22257b24461a的锁定Plan v3、两次确认与已生成草稿历史保留，没有伪造失败终判。新独立Chat cb600dfb-d999-4edb-9fbd-c5023057f607/Case 7418b64e-f7e0-4934-9d15-7e3beef8bf13通过实际UI调用真实Sophnet重新规划，当前Plan v2 PENDING_CONFIRMATION，0人工确认、无生成草稿。准备提案3客户/3账户/1基金/0初始持仓，6笔申请、12个文件步骤、12项协议预期、3项独立业务预期，missing/openQuestions均为空。每名客户01→02成功确认→03→04，05本轮不加。日期、基金、金额与费用规则是已授权演练合成条件，不代表真实TA结果。不同03日期可分批执行，当前未发任何文件。
模拟账户草稿不等于正式资源。通用Prompt与构造/确认/执行入口共享校验，漏01/03、回传、账户覆盖或对应02确认依赖时拒绝推进；既有真实正式资源及不构造数据的只读例外保留。真实模型重规划过程中发现日期混合轮次误拦、准备数值错引和过宽协议引文吞掉业务预期，已修复并实际重新审阅生成v2，未重写历史版本。285常规通过/10 opt-in跳过，另1真实MySQL事务回滚校验通过，Frontend构建通过。临时诊断代码已移除。
可审阅地址：http://127.0.0.1:5194/?theme=liquid&chatId=cb600dfb-d999-4edb-9fbd-c5023057f607&caseId=7418b64e-f7e0-4934-9d15-7e3beef8bf13 。证据live-message-backend树.context/exchange-policy/new-plan.json及README.md，实际截图message-ui-review树.context/exchange-policy/file-plan.png。下一步由用户审阅准备数据，不等同已经完成文件链路验收。


## 5194 单变量合批方案与中文文件安排（2026-10-07）
当前后端live-message-backend树codex/live-message-backend本地3dc98a97，API3103/PID45270；前端message-ui-review树codex/message-ui-review本地e7d85dec，5194/PID94564。原有未提交主题/Logo/UI改动保留不纳入，3102/5188不动；未PR/push。
通过真实UI调用Sophnet生成新Case7418b64e的Plan v4，PENDING_CONFIRMATION，0人工确认、无实际草稿生成/文件发送。文件安排四步01→02→03→04，3客户/3账户/1基金/0初始持仓，6笔申请，12项协议预期与3项业务预期，missing/openQuestions为空。每组三笔记录引用同一个发送步骤，新账户03等待02成功确认。旧Case aa72ec0d及v1–v3历史不覆盖。
本轮合成演练改为同取得日、不同核算日，形成364/365/366天，份额/金额/基金/NAV一致；不能假定TA支持任意历史日期的新申购。通用合批只合并同日期同依赖的兼容轮次，不硬编码样例。UI移除步骤ID和内部依赖枚举，用中文动作与日期。已授权模型提案首轮暴露否定合批语句误判日期取消，修复后v4实际通过。
288常规通过/10默认跳过，另独立真实MySQL事务回滚测试实际生成一个01含三条、一个03含三条，02/04三条应用后每人100份通过；Frontend构建通过。证据live-message-backend树.context/batch-plan/new-plan.json、tests.log、mysql.log、README.md；实际截图message-ui-review树.context/batch-plan/file-plan.png。该测试夹具不代表当前用户Case已发送文件。
审阅：http://127.0.0.1:5194/?theme=liquid&chatId=cb600dfb-d999-4edb-9fbd-c5023057f607&caseId=7418b64e-f7e0-4934-9d15-7e3beef8bf13


5194文件交换卡片补充：Frontend message-ui-review本地87dc11d1接入一张卡片＋下载/回传合并弹窗，后端3103/45270不改。01/03原始文件下载、明确交付记录、02/04上传解析对照、选中记录一次显式同步已接真实接口；生成按Plan锁定/草稿确认及workflow动作限制。当前Case7418b64e仍Plan v4待确认、无生成文件，未代用户推进确认。构建与回传匹配索引测试通过，当前真实空状态及Esc焦点检查通过；尚未在该Case实际下载/上传。可独立回滚87dc11d1，原有其他UI改动未纳入。证据message-ui-review树.context/file-exchange/dialog.png与integration.patch；05接收与全局文件页不在本轮接入范围。无PR/push。


## 5194 草稿确认与TA通道真实阻塞（2026-10-07）
按用户明确授权，通过真实UI确认Case7418b64e的Plan v4准备数据及预期结果，再确认实际生成草稿；Plan已LOCKED，草稿已确认。点击生成申请后真实返回NEEDS_INPUT：当前工作空间23没有TA交换通道（不是方案或业务规则缺失），未生成01/03，未下载、交付TA或上传伪造回传。不能套用其他工作空间通道。
Frontend message-ui-review/codex/message-ui-review本地9f00b9d1补虚线TA接收区（拖放/点选）、真实通道缺失提示及多通道选择，现有直接下载按钮保留。构建和回传匹配测试通过；截图.context/file-exchange/channel-blocker.png。Backend3103/45270源码不改，真实状态证据live-message-backend树.context/exchange-policy/channel-blocker.json。等待用户选择配置本地模拟TA或实际TA测试通道，03仍依赖对应02成功确认。可独立回滚9f00b9d1，其他未提交UI不纳入，无PR/push。


5194本地通道初始化修复（覆盖上节阻塞）：用户确认本地终登2.2早已定义，应复用现有能力。后端04d2987d新增只允许localhost/ta_case_agent_local的按Case本地通道初始化脚本，复用库中唯一LOCAL配置27/306/22，不硬编码案例或复制业务数据；重复运行无重复通道。工作空间23已建立channel9。实际UI生成并下载01 OFD_306_27_20251006_01_001.TXT，含三条开户申请，下载原始字节与数据库完全一致。Plan与草稿仍已确认，等待真实02回传后生成03；未代用户声明交付TA。截图message-ui-review树.context/file-exchange/generated-01.png，校验证据live-message-backend树.context/exchange-policy/generated-01-proof.json。API进程业务代码不变，不需重启；无模型调用/PR/push。


5194本地02→03实际联调：用户要求继续，读取已下载01原始文件，通过协议编码器构造三条成功的本地合成02（不是外部TA结果），按实际UI登记本地交付、虚线接收框选文件上传、LangGraph解析、勾选三条后显式同步；parse50三条CONFIRMED。随后实际UI生成单份03 OFD_306_27_20251008_03_001.TXT，含三条申购，下载文件与库中原始字节一致。03尚未登记交付，04未上传/同步，无实际持仓或最终业务结果。Frontend e7332ca3修正窄屏对照表撑宽弹窗、下载按钮被裁切，构建通过；Backend04d2987d业务代码不改，无模型调用/PR/push。证据live-message-backend .context/exchange-policy/02-confirmed-03-generated.json、local-ta-02.mjs及02原始TXT；截图message-ui-review .context/file-exchange/02-synced-03-generated.png。下一节点接收04。


## 5195 侧栏拖动与账户头像（2026-10-08，本地验收）
当前仍用platform-completion树/codex/platform-completion，侧栏宽度拖动本地2a981a2f，账户头像本地eddf1904；Frontend5195、Backend3104/PID88298。024_user_avatars迁移已应用，头像保存在当前登录账户；上传PNG/JPG/WebP≤5MB，浏览器居中裁为240px PNG，服务端校验并按会话用户写入。侧栏真实账户信息替代占位头像和浮动按钮重叠，窄屏账户入口在右上角。8账户测试及构建通过，实际UI/MySQL验证上传、刷新保留、移除、非法文件提示与390px无横向溢出；测试头像已移除，保留原默认头像。截图.context/avatar-upload.jpg、avatar-account-menu.jpg。未新增模型调用，未PR/push；可分别撤销两个UI功能提交，头像表保留不会影响旧版本。


5195账户页面修正（2026-10-08）：本地69ecb595将账户弹出菜单替换为独立page=account账户设置页，含头像、真实姓名/邮箱、内联密码设置和退出；支持刷新/浏览器返回，工作台保持挂载。实际上传/刷新保留/移除、密码表单展开取消、返回前后侧栏262px保留、390px无横向溢出及构建通过；未改变密码，测试头像已移除，无新增模型调用/PR/push。截图platform-completion树.context/account-settings-page.jpg。


5195窄窗口布局调整（2026-10-08）：本地3855a79e仅改前端响应式与侧栏宽度适配。481–900px保留紧凑双栏，480px及以下保留手机单栏；收紧侧栏、机器人和输入框，正常宽度样式保留。缩窄临时限制侧栏宽度，放大恢复此前偏好。实际560px拖动/双击复位、账户页返回、消息输入、数据/文件入口、1280px原尺寸、481px无横向溢出及390px手机菜单通过，构建通过。未发送聊天消息或新增模型调用，未PR/push；截图platform-completion树.context/compact-desktop-560.jpg，可独立撤销3855a79e。

5195用户范围纠正（2026-10-08）：用户明确不要改左边栏，撤回3855a79e中的侧栏样式、宽度逻辑、折叠断点及账户入口断点改动；这四个原有文件与3855a79e父提交完全一致。compact-workbench.css仅保留右侧内容区缩窄样式。850px实际侧栏252px及原有入口验证，构建通过；截图.context/sidebar-restored-850.jpg。此条覆盖上条481px双栏描述。无模型调用/PR/push。
