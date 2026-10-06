# Case 全流程设计

## 当前有效入口与实现基线（2026-10-06）

本文是 Case／Agent 平台业务流程的主设计入口，以当前 `codex/backend-flow-integration` 后端代码为事实基线；PR20／21／22 为已合并基础，后续严格Plan、05、结果判断、统一回传、生命周期与耐久编排已在集成分支实现。发布和运行状态以实时Git及本机版本索引为准。一个 Workspace 下有父 Chat，**一个父 Chat 包含多个 Case**；各 Case 独立保存讨论、锁定 Plan、申请和结果。界面可以把父 Chat 显示为项目，把 Case 显示为独立场景对话；界面用语不改变后端父子关系。旧稿中“一个 Chat 就是一个 Case”、独立 Run 统管流程等说法不再作为当前架构。

本文区分当前实现、历史 PR 边界和仍未实现的扩展。历史PR介绍只记录当时职责；当前行为以本节、状态表、完整流程图及后面的实现章节为准。接口细节见 [Backend README](../Backend/README.md)，实际运行版本见本机 `PROJECT_VERSION_GUIDE.md`。前端只作本地联调，不纳入业务PR；本地实现、实际验收和远端合并是不同状态，不用旧验收端口或PID推断当前版本。

同名本机旧完整版已保留历史备份，其剩余有效需求收录于本文“剩余扩展边界”。其他产品调研、三步工作流和 UI 稿是历史设计或前端讨论，不覆盖这里的业务实现事实。每次业务行为或 Plan 格式改变，必须在同一改动中更新本主设计及受影响的接口文档，明确哪些目标仍未实现；不能只更新代码或 README。

## 架构与提交顺序

```mermaid
flowchart TB
  UI[使用者与前端：本地运行与联调] --> API[HTTP API 与权限]
  API --> CASE[父 Chat 与 Case 状态机]
  API --> EX[确定性文件交换]
  AGENT[LangGraph 业务小图与耐久等待协调器] --> CASE
  AGENT --> EX
  CASE --> RULE[Plan 结构和时序校验：已实现；结果建议与人工确认：本地实现]
  CASE --> DB[(持久化：状态、事件、证据)]
  EX --> DB
  RULE --> CONTRACT[TA 协议契约]
  EX --> CODEC[TA 文件编解码]
  CODEC --> CONTRACT
  EX <-->|人工交付与上传原件| TA[真实TA测试环境]
```

每个 PR 只加入图中的一层及其直接验收。协议定义先于编解码，编解码先于文件服务；确定性的 Case 业务先于 Agent 接入。图表示当前实现的分层关系，不代替发布与实际运行状态核对。

## 当前实现状态

| 层 | 状态 | 当前范围及限制 |
|---|---|---|
| TA 协议与编解码 | 已实现，基础PR已合并 | 2.1／2.2、GB18030、字段和交换方向；协议支持不等于全业务会计支持 |
| 身份、数据库与隔离 | 已实现 | Workspace → 父 Chat → 多个 Case；会话决定作用域 |
| 讨论、历史与 Plan | 已实现 | 服务端完整历史、首次/后续路由、提案与时序追问、同版本数据/预期双确认；新严格申请限定V2.2 |
| 草稿与 01／03 申请 | 已实现 | 四张草稿表与正式账本分开；固定申请字段，冻结快照；新账户03等待成功02 |
| 02／04 正式确认 | 已实现 | 上传解析与显式应用分开；只支持开户001/101、申购022/122的会计效果 |
| Plan 时序 | 已实现 | DATE/RELATIVE与DAG依赖、SENT/PARSED/CONFIRMED、多包与旧Plan补齐；不用时分秒排序 |
| 05 独立输入与同步 | 已实现 | 已有正式账户余额快照；明细/基金汇总只保存；可选05不阻挡必需流程 |
| 统一 02／04／05 接收 | 已实现 | 原始TXT＋可选完整OFI、整包验证和原子分发；单Case/通道/日期，歧义手动选路由；ZIP/目录递归未实现 |
| 结果建议与人工终判 | 已实现 | 新Plan直接消费确认断言，旧Plan模型解释；完整原包校验、不可变证据、最新版本人工PASS/FAIL |
| Chat 封存、关联后续和新测试 | 已实现 | 同Chat人工FAIL关联后续、正常/强制结束、新空白Chat；不清空正式数据 |
| 外部TA重置声明 | 已实现 | 用户确认已在外部完成重置，记录通道epoch并禁用旧绑定；不执行真实TA物理清空 |
| 耐久 LangGraph 协调器 | 已实现 | 九个原生interrupt等待点、MySQL checkpoint/pending writes、幂等恢复、跨实例锁；业务副作用仍由既有API执行 |
| Frontend | 仅本地集成 | 页面展示和操作上述API，后端PR不包含前端源码；验收结果另附实际测试证据 |

## 第一个 PR 的边界：TA 协议契约（历史PR职责）

第一个 PR 仅定义当前测试流程用到的文件字段、顺序、类型、字节宽度、数值精度、业务代码、必填元数据和交换方向。01、03 是销售侧发往 TA 的申请；02、04、05 是 TA 回传。显式选择交换流时，文件类型必须属于该交换流，避免生成错误的索引前缀。04 的正常确认使用 OFI，提前回报使用 OFF，索引类型由交换流决定。2.2 布局分别有 89、27、82、122、23 个字段；07 基金资料有 86 个字段。这里的“必填”是协议与业务元数据，不能代替后续发送端对具体申请的校验。

第一个 PR 不生成文件、不写数据库、不运行 Case 状态机，也不调用模型。第二个 PR 加入编解码与完整文件往返验证；它直接读取第一个 PR 的定义，避免在服务层另写一套字段清单。

## 第二个 PR：编解码与版本配置（历史PR职责）

本 PR 叠在协议定义 PR 之上，加入 2.1／2.2 文件结构、GB18030 字节处理、定长字段编解码、数据文件与索引文件的构造、解析与检查，以及按业务含义归一化返回记录。它仍然只是纯文件处理模块，不连接数据库，也不发送或接收网络请求。

2.2 协议字段以本地原件 [中央数据交换平台开放式基金业务数据交换协议 V2.2（2026-03-20）](./protocol/中央数据交换平台开放式基金业务数据交换协议V2.2-20260320.doc) 为核对依据；提取文本与读取器配置只用于辅助定位和交叉检查。

验收以真实字节长度、文件头尾、字段数和顺序、数据与索引往返、错误文件拒绝为准。文件头按 GB18030 编码后的字节数补齐，数值头字段以及 A／N 记录字段在解析时校验，损坏文件整份拒绝。2.1 文件保留原始字节，避免强行转为 2.2 时丢失旧版专有字段；旧式 2.2 版本号对所有已支持的文件类型（包括扩展类型 X1）规范化，原记录保留。下一层的数据库与文件服务才能把这些字节和 Case 证据安全地保存与关联。

## 第三个 PR：身份、Workspace、父 Chat 与 Case 持久化（历史PR职责）

本 PR 建立用户、会话、Workspace、父 Chat、Case、SOP 版本和 Chat／Case 状态事件表。一个用户拥有一个 Workspace；父 Chat 属于 Workspace，Case 属于父 Chat。后续 Case 可以引用同一父 Chat 内的来源 Case，并限制一个来源 Case 只产生一个直接后续 Case。强制结束的原因、结束时间与状态必须同时满足数据库约束。状态事件在创建 Chat／Case 时与主记录同事务写入；后续状态跳转规则在状态机 PR 实现。

访问入口通过会话解析服务端 Workspace，再限定 Chat 和 Case 查询；客户端不能传入 Workspace ID。这里没有用户可见或业务归属上的 `Run`。本 PR 不创建申请、发文批次或回传，也不提供 HTTP 登录页面；后者在 API 层接入此访问入口。

数据库迁移只面向独立的 `ta_case_agent` 库。每张表建表前先写入步骤记录，MySQL DDL 中断后可按步骤继续；已完成迁移保存源文件 SHA-256，修改旧迁移会被拒绝。运行时须提供 `CASE_DB_NAME`、`CASE_DB_USER`、`CASE_DB_PASSWORD`，并执行 `npm run db:migrate`。该数据库账号需要在部署迁移时拥有建表权限；普通请求使用单独的受限账号由后续服务层接入。

## 第四个 PR：申请、批次与回传归属（历史PR职责）

本 PR 在父 Chat／Case 基础上增加交换通道、申请快照、发文批次、批次申请、原始文件和逐条回传。申请绑定已锁定的 Case SOP 版本，校验业务必填字段和交易日期，保存当时完整的协议记录及编码字节的摘要；全 Chat 的 Case 均有锁定 SOP 后，才能把同一通道、业务日的就绪申请纳入一个批次。纳入后申请状态变为 `BATCHED`，不能再次归批。批次只属于父 Chat，不属于单个 Case。生成文件、点击“已交付给 TA”及其状态跳转留给后续确定性文件服务。

TA 上传的完整原始文件按 Workspace 和交换通道保存。它可以包含多个 Chat 的记录，因此不能先按当前打开的 Case 裁剪。文件头、文件名、版本、机构和类型须与通道一致，结构错误的文件整份拒绝；同一通道重复上传同一字节不重复生成回传记录，即使改了文件名也一样。同名不同内容拒绝。02／04 回传只有与已交付申请的申请号、相应确认业务代码、类型、机构、交易日期及账户／基金关键字段核对一致，才会关联到该申请及其 Case；已有 TA 账号的 01 申请在匹配 02 时还须核对 TA 账号。这是 PR7 的历史归属设计；当前 PR21 已关闭直接匹配建绑定的旧入口。只有独立核验并显式应用成功02，才建立正式账户和可追溯的交易账号与TA账号绑定；后续 03 和已有 TA 账号的 01 申请在入库前必须使用该 Workspace、通道下已确认的绑定。05 与不匹配的记录保留为未归属证据，后续再对账。归属不等于业务判定，SOP 判定和人工结论仍属于后面的状态机层。

## Agent 第一个对话节点：讨论测试意图（历史PR职责）

第一个 LangGraph 节点接收使用者的需求描述，先询问使用者想验证什么，并给出 AI 的初步理解及最关键的待确认信息。回复使用 `first-node-format-v4`：三行简短中文纯文本，依次以“想先确认：”“初步理解：”“还需明确：”开头；第一行以中文或英文问号结尾，后两行不限定句末标点；不显示 Markdown 标题、列表或加粗。提示词明确本轮不输出 SOP、测试步骤或测试数据，格式校验会拒绝这些显式段落标签；自然语言语义仍需由使用者审阅，不能仅靠格式校验保证。提示词只规定节点职责和输出格式，不写入某个样例的业务规则或测试方法。节点输出后等待使用者回答；模型原文通过格式检查后原样返回，不由程序改写测试判断。当前只提交可独立调用的图节点与 Sophnet 模型适配，不接入 Chat 事件、数据库或前端。多轮讨论、方案收口、用户确认及锁定 SOP 属于后续节点，不能把这个首次回复当成最终 Plan。

## Agent 后续讨论节点：修订测试方法（历史PR职责）

使用者回答后，LangGraph 将先前完整的用户与 AI 对话连同新回答交给后续讨论节点。AI 根据最新回答修正理解，提出一项可讨论的测试方法和需要观察的结果，并追问下一步待确认事项。输出继续使用简短三行纯文本：“当前理解：”“建议先测：”“请你确认：”，不把讨论中的建议标为最终 Plan；第三行接受中文或英文问号及其后的简短解释。`followup-discussion-v3` 明确禁止声称助手或系统已经生成、锁定或执行方案，格式校验拦截显式完成声明，同时保留对使用者既往操作的描述；自然语言语义仍需由使用者审阅。提示词只规定节点职责和输出格式，不预设某个样例应采用的边界值、日期算法或其他测试方法。使用者再次补充时，图可以再次进入这个节点，不限制为仅讨论一轮。当前由调用方传入和保存完整对话；正式接入时必须从服务端该 Case 的事件记录读取，不能信任客户端自报的历史。Chat 事件持久化、方案收口、提案及用户确认仍属于后续 PR。

## Agent Plan 提案节点：供使用者审阅（历史PR职责）

经过至少两轮完整的用户与 AI 讨论后，调用方可以根据使用者明确的提案请求进入 Plan 提案节点。模型按固定 JSON 结构给出测试目标、前提、测试场景、动作、可观察预期、证据和待确认事项；代码校验结构并以纯文本小标题展示。提示词只规定这些通用字段及“不能编造事实、不能自行确认或执行”的边界，不写入某个测试样例。提案状态为待用户审阅，用户提出修改后可继续讨论并重新提案；这一 PR 不锁定 SOP、不写数据库、不启动数据构建。正式确认与持久化属于后续节点。

## Agent 确认与锁定节点：用户审阅 Plan（历史PR职责）

三份模型提示词（首次询问、后续讨论、Plan 提案）只约束各节点职责和输出结构，不包含当前浮动管理费样例的业务规则、日期或预期结论。Plan 提案仍由 Agent 结构校验；服务端将其存为指定 Workspace／Chat／Case 下的待确认 SOP 版本。用户修改提案并重新提交时，旧待确认版本降为草稿，新提案取得递增版本号。

用户对审阅的版本显式选择“确认”或“修改”。修改只返回讨论，不锁定 SOP；确认节点是确定性 LangGraph 节点，不再请求模型作判断。服务端在同一事务中核实会话与 Workspace 归属、Chat 未结束、Case 正在待确认、所确认的是最新版本且待确认事项已清空，再将 SOP 与 Case 状态锁定，并写入带用户身份的状态事件。确认旧版本或重复确认会被拒绝。新增迁移把 SOP 状态字段扩为 24 字符，以实际容纳 `PENDING_CONFIRMATION`。该独立节点在当时不启动数据构建；后续本地严格Plan流程改为准备数据、预期结果分别确认，第二次确认与初版草稿生成串接，仍保留锁定Plan和写草稿各自的事务边界。草稿确认不再自动启动申请准备，详见下文。

## Case 讨论记录：服务端持有完整历史（历史PR职责）

每一轮用户输入先作为 `PENDING` Case 讨论记录写入数据库，再调用模型；模型回复通过格式校验后才补全同一轮记录为 `COMPLETE`，附带提示词版本和发起用户。读取与写入都先用登录会话确定 Workspace，再限定父 Chat 与 Case；关闭的 Chat、锁定的 SOP 不能继续讨论。模型失败时用户输入仍在服务端，可用相同输入重试，或显式放弃该轮；未完成回合不送入下一轮模型，也不允许新 Plan 抢先形成。服务层每轮从数据库读取已完成的完整历史，以轮次号防止过期结果覆盖新回复。

待审阅 Plan 后若用户继续讨论，登记用户输入的同一事务就把旧待确认版本降为草稿、Case 返回讨论状态并记录事件；旧 Plan 无法在模型生成期间被确认。用户必须重新生成和确认提案。PR #12 接通首次与后续讨论的服务端历史，不把客户端传来的 `priorTurns` 作为可信历史。数据构建仍在 SOP 锁定之后。

## Plan 提案回合：回复与版本一起保存（历史PR职责）

使用者要求生成 Plan 时，服务端先登记 `PROPOSE_PLAN` 回合，再从同一 Case 读取至少两轮已完成的讨论交给 LangGraph。模型生成结构化提案并通过通用格式校验后，服务端在同一数据库事务中保存该轮 AI 展示文本、新的待确认 SOP 版本、来源回合号和 Case 状态事件。提案版本可以追溯到具体的用户请求和模型回复；事务失败时这些完成动作不会只成功一部分。模型失败时回合保持待完成，相同输入和相同回合类型可重试，也可显式取消；讨论请求不能借同一段文字接管提案回合。数据库完成入口再次检查回合类型、至少两轮完整讨论、登录归属及 Chat／Case 状态。这个 PR 沿用已有的通用提示词和展示格式，不加入测试样例的业务内容。HTTP API 与 UI 接入留给后续层。

## 当前流程与状态门槛

一个父 Chat 包含多个 Case；每个 Case 与使用者讨论测试目标和可观察标准，形成 SOP 草案。用户确认并锁定 SOP 后，服务按当前父 Chat 的所有 Case 汇总本批 01/03。新账户先发送 01，成功收到 02 和真实 TA 账户后，依赖它的 03 才进入后续批次。系统接收完整 02/04/05 文件，按记录关联到原申请和 Case，依据锁定 SOP 判定 PASS、FAIL、WAITING 或 REVIEW。系统／AI 给出建议，人逐 Case 确认最终结论。

人工确认 Case 测试失败后，在同一个父 Chat 下创建关联的后续 Case。后续 Case 引用原 Case 的 SOP、证据、建议结论和人工失败原因，从讨论新方案开始；用户确认新 SOP 前不自动重发申请。原 Case 保留只读的失败记录。预期中的 TA 业务失败若使测试通过，不创建后续 Case。重复处理同一次人工失败不能创建多个相同后续 Case。

人工可以填写原因**强制结束整个 Chat**，这是独立兜底出口：即使还有失败或未完成的后续 Case，也停止后续发文与 Agent 动作，保存各 Case 当时的真实状态，不把失败或未完成改写为通过。正常结束仍须完成当前后续 Case。关联后续、正常结束和强制结束已通过生命周期API实现；正常结束要求所有Case人工最终结论与状态一致、每条FAIL链的末端为PASS。`Run` 不作为用户可见的产品概念。

NEW_RUN在封存后显式创建新空白Chat，保留旧Case与正式账本。真实TA重置由人工在外部完成，再通过独立通道事件声明；平台不执行物理重置。

## 数据生成与人工核对节点

准备数据只写四张 `case_generated_*` 草稿表，不建立正式账户、交易或持仓。新严格Plan在提案时先生成准备数据定义与固定申请内容，用户先确认DATA，再确认EXPECTATIONS；第二次确认锁定Plan后写草稿，失败可对已锁定版本幂等重试，不重新请求模型推导。草稿仍须用户明确确认当前版本才可准备申请。

严格Plan的业务数据和申请字段已随双确认冻结，核对卡片可读，不提供AI或手动绕过冻结；需要改动业务应创建新Case并重新讨论。旧已锁定Plan保留历史草稿编辑兼容路径，编辑后仍须确认最新版本，不能把旧逻辑当作新严格Plan的流程。确认草稿不自动启动申请准备。多Case的批次门槛仍由申请仓储核验；前端只本地联调。

## 01／03 申请文件节点（2026-10-05）

已确认四张表是客户、交易账户和基金的来源，不能直接充当完整的 TA 申请：01 还要求证件类型与证件号，03 还要求具体业务代码、申请金额或份额等。用户确认草稿后可先选择已有正式账户；用户显式点击申请准备，节点才读取当前 Case 的锁定 Plan、四张表、通道和成功 02 绑定，新严格Plan直接读取已确认contract的固定申请；旧锁定Plan保留由模型提取意图的兼容路径。公共提示词说明引用、协议和信息缺失规则，具体业务来自当前 Plan；支持的业务与字段长度由协议目录提供。证件、金额、份额、费率、日期和时间缺失时，在聊天中询问用户，不从余额或净值推算。服务端填充申请号、账户、客户、网点、基金和 TA 绑定，模型不能覆盖这些系统字段。

01开户申请可按已确认的草稿账户逐条准备；草稿账户不等于TA已确认正式账户。03 申请必须引用同一 Workspace、通道下由成功且已匹配的 02 回传建立的 TA 账号绑定；没有绑定时不能入库。父 Chat 的所有 Case 均锁定 Plan 且确认数据后，就绪申请才能组成发文批次。批次从冻结的申请快照编码出 GB18030 的 01／03 原始文件，保存文件名、字节、摘要与记录数；重复生成同一批次返回已存文件，页面可按字段预览和下载。状态依次为申请 `READY → BATCHED → GENERATED`、批次 `DRAFT → GENERATED`。

本节点只生成和保存申请文件，不宣称已交付 TA，也不把模拟账户视作 TA 账号。人工交付登记、02／04解析和确认生效入口已在PR21加入；当前申请生成仍未提供完整OFI索引交付能力，05独立入口已在本地实现（见05同步约定）。回传若自带原始OFI，按当前解析支持范围核验。03 意图缺少成功 02 绑定时保留待执行，当前可生成的 01 文件先保存；绑定到达后点击继续生成可生成 03。已经入库的申请意图冻结，补充对话只能完善未入库的内容。每个 Case 的补充历史和意图持久化并检查版本；申请号由 Case、通道和稳定意图键确定，重试复用原申请和文件。

```mermaid
flowchart TD
  A[用户确认草稿四张表] --> S[可选：引用已有正式账户]
  S -->|用户点击申请准备| B[读取严格Plan固定申请；旧Plan才由模型提取]
  B --> C{业务信息齐全吗}
  C -->|缺少| D[聊天提问并保存当前意图]
  D --> E[用户补充信息]
  E --> B
  C -->|齐全| F[系统填充表引用与申请号]
  F --> G{03 是否已有成功 02 绑定}
  G -->|缺少| H[保留 03 待执行，先生成可用 01]
  H --> I[成功02核验并应用后点击继续生成]
  I --> B
  G -->|已具备或当前是 01| J[协议校验、归批、编码保存]
  J --> K[聊天文件卡片：预览与下载]
```

申请准备状态独立于四张表确认状态：`NOT_STARTED → PREPARING → NEEDS_INPUT / WAITING_TA / WAITING_CHAT / GENERATED / NO_APPLICATION`。模型或文件生成失败不会撤销已经确认的数据；页面显示错误并提供继续生成。保存版本冲突时要求刷新。尚在 `PREPARING` 的中断任务只能先恢复原意图，不能在部分申请入库时改写内容。四张数据表和公共数据展示在此阶段仍保持已确认的内容。

严格Plan的“继续生成”读取固定申请与最新02绑定，不改变金额等业务字段；旧Plan兼容路径会重新读取Plan和数据、由模型补回遗漏意图。仅 PREPARING 中断恢复复用已保存意图。未选通道时提交的补充信息先持久化，选择通道后交给模型，成功处理后清除。历史保留最近至多 20 轮且至多 64KB，通过 turnsOmitted 记录省略轮数；总状态仍受 240KB 限制，已冻结意图与文件不因历史裁剪而删除。

当文件生成因 FILE_SEQUENCE_EXHAUSTED 失败时，申请准备进入 WAITING_OPERATION，保存错误及冻结意图，先由通道维护人员处理当日文件编号容量，再重试原批次；不得通过补充对话改写已入库申请或静默换日期。其余异常仍按 PREPARING 中断恢复处理。


## 当前回传和正式数据流程（PR21，已实现）

生成的 `case_generated_*` 是申请草稿和测试条件，确认草稿只表示允许准备申请。正式查询 `GET /api/sales-data` 读取独立的 `sales_confirmed_accounts`、`sales_confirmed_transactions`、`sales_confirmed_holdings`；模拟余额和持有不能自动复制进去。

1. 准备并生成01／03；用户实际交付给TA后，调用 `POST .../return-confirmation/delivery` 登记交付，申请进入等待回传。
2. 用户通过统一 `POST .../ta-receipts/parse` 上传02/04/05原始TXT＋完整OFI，或继续使用各单类型入口。整包验证后按类型保存全部原始字节与摘要，**解析本身不更新正式数据**。不得从OFI声明中裁剪子集；多Case可重复接收同一完整原包，各Case的正式应用仍核验自己的申请。统一混包任一结构/时序错误整事务拒绝，旧单类型02/04乱序包则保留ORDER_REJECTED原件。
3. 用户调用 `POST .../return-confirmation/apply`，提供 `parseId` 和 `recordIndexes`。后端核验本次申请号、机构、日期、业务码以及账户/基金等关键字段；上传时所处Case只是操作上下文，不能替代业务归属验证。
4. 成功开户 `01/001 → 02/101` 才建立正式账户与TA绑定；成功申购 `03/022 → 04/122` 按实际确认金额和 `ConfirmedVol` 保存交易；没有05基准时增加持仓，有基准时仅增加基准日期之后的交易，避免重复计入。有效匹配的TA业务失败保留返回码、原因并标记申请FAILED，不修改正式账户/持仓。尚未最终完成的确认、错误归属或不支持业务不生效。
5. 重复确认幂等；不同确认不能覆盖旧结果；单个应用请求有错误则整个事务回滚。既有正式账户可由 `POST .../return-confirmation/account` 引用到尚未生成申请的Case，直接准备03而不重复开户。

旧 `matchReturnRecord` 一律返回 `CONFIRMATION_SERVICE_REQUIRED`；不可恢复直接匹配建绑定的旁路。历史测试数据与旧绑定不会自动提升为正式数据。当前没有定义资金现金会计，也没有实现赎回、冻结/解冻、销户等其他业务的会计效果；05账户余额快照同步已在本地实现。

实际LangGraph节点包含：等待/解析 `wait_account_return`、`parse_account_return`、`wait_transaction_return`、`parse_transaction_return`；核验/应用 `verify_account_return`、`apply_account_confirmation`、`verify_transaction_return`、`apply_transaction_confirmation`；时序 `validate_exchange_order`；本地新增05 `wait_holdings_return`、`parse_holdings_return`、`verify_holdings_return`、`sync_holdings_snapshot`。协议字节解析和数据库更新由确定性服务执行，不由AI猜测错位字段或编造成功。

## Plan v2 文件时序与当前格式（PR22，已实现）

Plan固定字段为 `objective`、`preconditions`、`scenarios`、`openQuestions`、`exchangePlan`。每个scenario包含 `title`、`setup`、`action`、`expected`、`evidence`。展示顺序为测试目标、准备条件、各场景的准备/动作/预期/证据、待确认问题、文件步骤/时序问题，最后请用户审阅。

`exchangePlan` 必须包含 `status`、`steps`、`openQuestions`。UNPLANNED必须没有steps且有待确认问题；READY必须有steps且没有时序待确认问题。每个step的固定字段：

| 字段 | 当前含义 |
|---|---|
| stepId / roundId | 唯一步骤标识与对应申请轮次标识 |
| direction / fileType | SEND只能01/03；RECEIVE只能02/04/05 |
| businessTime | `{kind: DATE或RELATIVE, value: YYYYMMDD或用户确认的相对时点}` |
| required | 是否阻挡阶段与结果评估；未上传的可选05不阻挡，已确认预期仍必须有匹配证据 |
| dependsOn | `[{stepId, condition: SENT或PARSED或CONFIRMED}]`，无环依赖 |

02／04必须依赖同轮次01／03的SENT。模型提示要求新开户的03依赖02的CONFIRMED；正式账户前置核验仍独立强制，不能由Plan绕过。已有账户可直接03；05可以独立或可选，不强制02<04<05，不限制只有两轮。

模型提出的时间必须有用户肯定且指向对应文件的对话证据；举例、疑问、否定或较新改期不能沿用旧时间。未知时序进入真实LangGraph `ask_exchange_timing` 节点追问，重新提案；只有READY且待确认问题清空才允许锁定。DATE核对批次业务日或文件头日期，RELATIVE保存已确认描述；实际顺序依赖dependsOn，不按时间戳排序，不提供T+N日历计算或定时调度。

`validate_exchange_order` 在发送、受控02／04／05上传、确认生效时执行。SENT表示用户登记实际发送；PARSED表示格式正确且时序通过；CONFIRMED表示对应Case/批次/申请类型全部成功确认，TA业务失败不满足它。一个接收step可接收同批多个包，重复包幂等，多Case混合01／03批次发送前核验全部成员，任何失败都不部分发送。

02／04乱序格式正确包保留原件及解析结果，返回HTTP409 `ORDER_VIOLATION`、`ORDER_REJECTED`和parseId，不记录步骤完成、不生效；补齐依赖后必须显式重传。05乱序上传返回明确异常且不登记接收或修改正式数据，用户补齐前置后重新上传。多个同类型轮次无法唯一确定时需 `exchangeStepId`。历史锁定Plan缺时序时通过 `POST .../exchange-plan/confirm` 显式提交baseVersionNumber、exchangePlan、mappings，生成不可变的新锁定版本，保持旧目标/场景/申请/草稿引用，并审计映射；不偷偷猜测或重写旧计划。

**旧Plan格式的限制：** 历史expected和evidence为非空单行文字，旧已锁定Case继续使用原文提取断言并人工核对完整性。新提案增加下面的严格contract；不静默为旧Plan补确认或推导未知预期。

## Plan 严格数据定义与结果预期

2026-10-06用户授权实施。新提案先运行LangGraph `define_plan_data → define_plan_expectations → validate_plan_applications`，然后将最终展示文字和完整结构同事务保存。确认阶段是 `confirm_plan_data` 与 `confirm_plan_expectations` 两个确定性节点，依次等待显式API事件。业务节点仍在各自小图执行，由新增原生checkpoint/interrupt耐久协调器观察已提交状态并恢复等待；协调器不自行执行模型或确认。准备数据节点显式使用reasoning_effort=low，结构化预期映射节点使用thinking.type=disabled，模型仍为Sophnet DeepSeek-V4-Pro-0813；其他调用保持原默认配置。参数依据[DeepSeek官方思考模式文档](https://api-docs.deepseek.com/guides/thinking_mode/)，Sophnet兼容性以实际验收结果为准。

保留objective、preconditions、scenarios、openQuestions、exchangePlan，新增contract：

- version为1；protocolVersion明确为22。当前严格申请预校验与执行限定V2.2，旧流程和已有协议版本能力不因此自动扩大。
- dataSpecification包含customers、accounts、funds、holdings、missing：沿用草稿字段与索引规则；新增账户由系统分配交易账号，不能假装已经成功开户。正式状态仍只在TA回传成功且用户确认应用后改变。
- applications逐项固定key、SEND stepId、businessCode、accountIndex或已有transactionAccountId、fundIndex与协议fields；当前固定开户001和申购022。金额、基金、证件及申请时间在确认前展示；日期来自明确DATE步骤。相对发文日期、关键字段缺失或不支持的业务必须先澄清。新账户03必须依赖该账户01对应的02成功CONFIRMED，已有正式账户允许直接03。
- assumptions明确业务假设。净值、费用、舍入、初始状态或确认规则不明确时不得从申请金额猜TA确认结果，列入missing。
- expectations包含scenarioIndex、expectedQuote、source、selector、field、operator、expectedValue。数值expectedValue必须在同项expectedQuote中有精确的数值字面依据，不能只因值出现在准备数据或申请金额中就作为预期；引用还须对应原场景expected。未明确要求的可用/冻结余额不能凭申请金额、净值或初始条件推导，缺目标须澄清，不仅依赖人工最后发现。source限申请确认、正式账户、当前正式持仓；selector精确指定新准备账户索引或已有交易账号，可指定通道；持仓必须指定基金与类别，申请确认必须指定文件类型与业务日期。operator支持eq/gte/lte；非数值仅eq。每个场景至少有一项断言，仍需人工检查语义是否完整覆盖，代码不宣称能证明自然语言完整性。
- missing是预期或申请中的待澄清条件。准备数据缺条件不能确认DATA；全部待澄清项、文件时序和场景问题清空后才能确认EXPECTATIONS。

`POST .../plan/confirm`请求必须为 `{versionNumber,section:"DATA"或"EXPECTATIONS"}`。DATA同事务核验最新版并保存actor/时间，保持SOP_PENDING且不写草稿。EXPECTATIONS要求同版本已有DATA确认，再保存第二次确认并锁定。`case_plan_section_confirmations`以Workspace/Chat/Case/版本/section为主键，重复DATA幂等；新版不继承旧版确认，旧版确认保留审计。GET Plan返回本版本confirmations。

锁定后草稿执行与重试直接使用保存的dataSpecification，不再调用模型推导；数据库拒绝不一致定义。申请准备也使用保存的applications，系统仅填充确定的账号、申请号、TA绑定与通道，不重新选择金额/基金。草稿与申请业务内容冻结；未锁定时通过继续讨论生成新版本并重新确认，已锁定后业务修改须新建Case，原申请与历史证据保留。旧待确认Plan无contract时不能新锁定，需要重新提案；旧已锁定Plan按原流程继续。

结果图对新contract逐项查找唯一匹配证据，用精确十进制定量比较，不调用模型重解释已确认值。必需步骤未完成为WAITING，证据缺失或不唯一为REVIEW，差异为FAIL，全部断言一致为PASS建议；最终仍须人工确认。历史自由文本Plan保留上一版模型提取逻辑。本次没有实施任意关系表达式、跨字段公式或TA账号未知时的“非空且相等”运算；这些预期需澄清成当前支持的可核验字段或另票扩展。

## 剩余扩展边界

已讨论的主流程节点、同Chat人工失败后续、封存、外部TA重置声明与耐久等待协调已实现。仍未实现的范围单独列出，不再把已有05、结果判断或checkpoint写成未来目标：

- ZIP安全解压、目录递归、单次跨通道/日期/多个轮次接收和自动跨Case业务归属；当前统一入口支持一个Case操作上下文的完整原包，保留其他Case记录但不替它们自动应用。
- 任意预期关系表达式、跨字段公式、共享账户变化的因果证明及完整自然语言语义覆盖；当前支持明确字段与eq/gte/lte断言，人工确认完整性。
- 真实TA网络投递/自动接收及外部系统物理重置；当前下载、交付登记和上传为人工动作，重置事件只记录人工声明。
- T+N交易日历、精确小时秒数调度、真实资金现金会计、赎回/冻结/解冻/销户等账务效果；协议字段支持不代表这些业务已生效。
- checkpoint历史清理/压缩与超过容量后的运营处理；当前16MiB上限明确拒绝，保留业务事实和可重试错误，不提供无审计历史删除。

这些是明确保留的后续扩展，不能把它们当作本轮已讨论流程尚未完成，亦不能宣称已有最低结构校验等于完整业务证明。历史视觉与产品调研稿仅供回顾，本文为业务权威入口。

## 05 回传同步实现约定

05同步PR只补齐数据同步，02／04保留确认后生效机制。后续结果判断和Plan严格格式补丁在各自独立本地提交中实现，详见对应章节。05 独立上传，不需要伪造 01／03 批次；按已锁定 exchangePlan 的 RECEIVE/05 步骤、业务日期和依赖校验，解析成功登记 PARSED。原文件和每条记录保留；用户点击同步后整包核验并原子落库。LangGraph 路径为等待持仓回传 → 解析持仓回传，以及核验持仓回传 → 同步持仓快照，失败明确返回并回滚。

依据中登 V2.2 表73，DetailFlag=0 是账户余额；WholeFlag=0 的增量传输不表示份额差量，该行总份数仍为余额。DetailFlag=1 明细、A 基金汇总只保存并明确不应用，不覆盖账户余额。只更新上传包明确列出的已正式确认账户、基金、收费方式；缺失账户不凭05创建，不删除或清零未出现的持仓。记录必须完整、机构及账户网点匹配、日期有效、数量非负且可用与冻结不超出总份数。重复账户余额键拒绝整包。

05 按确认日期保存持仓基准和原始来源；余额为基准加已确认的基准日期之后交易。旧于已同步基准的05拒绝，同日不同余额拒绝并要求单独更正，同日相同快照幂等。04 同日或早于05基准仅记录交易，不再增加已涵盖份额；晚于基准增加余额并清除不再代表当前值的可用／冻结展示值。采用相同通道锁串行化04与05，避免重复计入及并发覆盖。05解析／同步不是 Case PASS／FAIL。

## Case结果建议与人工确认

该结果判断PR最初只读取已同步数据并给出建议，不修改销售数据。后续本地Plan补丁已扩展为直接消费已确认contract，详见上文。LangGraph为 collect_case_results → compare_case_expectations → explain_case_result → wait_case_result_confirmation。收集当前锁定Plan、当前Case申请/TA确认、05接收/同步状态，以及该Case引用的正式账户和当前持仓；不把整个Workspace数据交给模型。证据带稳定id、原始申请/解析来源，并保存不可变快照与摘要。

模型将scenario.expected原文解释为带原文引用、证据id、字段、比较运算符和预期字面值的断言。后端验证引用与值来源，再精确比较数值；模型不直接决定PASS/FAIL。每个场景必须有可核验断言，无法完整覆盖或语义模糊必须REVIEW。必需步骤、已生成申请或必需05同步未完成为WAITING；未接收的可选05不阻挡，但预期要求的证据缺失仍为REVIEW；有具体差异是FAIL；全部断言一致仅为PASS建议，人工仍须核对断言是否完整覆盖自然语言预期。旧自由文本Plan无法自动证明完整语义；新严格contract固定断言和值，仍需人工核对是否覆盖业务意图。

建议持久化，不自动改变Case状态。人工确认需reviewId、PASS/FAIL和核对说明；只能确认最新且证据未变的版本，WAITING/REVIEW不可封存。模型调用在事务之外；保存和最终确认重新读取并核对证据摘要，确认持锁读取以避免并发销售数据变化。最终结论和确认人/时间/说明持久化，Case进入PASS/FAIL，重复同一确认幂等且不能覆盖。

## 完整流程图：讨论循环、文件DAG、结果与生命周期

下图是实际业务小图、API和耐久协调器的完整组合视图。菱形为代码条件路由，普通中文业务框包含相应API/SQL动作，不把它们冒充额外的LangGraph addNode。协调器九个等待节点单独列在图后：它读取已经提交的业务事实，业务成功后前端通知resume；重启或漏通知可由GET恢复，不会重复执行模型、发文或正式落库。

```mermaid
flowchart TD
  ENTRY[会话认证：Workspace / 父Chat / 当前Case] --> HISTORY[读取服务端完整历史、pending及来源FAIL上下文]
  HISTORY --> ROUTE{按请求类型与历史选择路径}
  ROUTE -->|首次讨论| FIRST[ask_testing_intent：询问测试目标]
  ROUTE -->|已有完整历史| REFINE[refine_test_approach：修订方法]
  FIRST --> USER[等待用户回答]
  REFINE --> USER
  USER -->|补充或修改| HISTORY
  USER -->|明确请求Plan，至少两轮完整讨论| PROPOSE[propose_plan：目标 / 条件 / 场景 / 文件时序]
  ROUTE -->|明确PROPOSE_PLAN且历史满足门槛| PROPOSE
  PROPOSE --> TIMING{时序有用户确认的证据吗}
  TIMING -->|没有| ASK[ask_exchange_timing：询问日期、轮次与依赖]
  ASK --> USER
  TIMING -->|有| DEFINE[define_plan_data → define_plan_expectations → validate_plan_applications]
  DEFINE --> SAVED[同事务保存回复与待审阅Plan版本]
  SAVED --> DATA_CONFIRM[用户确认准备数据：confirm_plan_data]
  SAVED -->|修改| HISTORY
  DATA_CONFIRM --> EXPECT_CONFIRM[用户确认预期：confirm_plan_expectations]
  EXPECT_CONFIRM -->|修改，旧确认不继承| HISTORY
  EXPECT_CONFIRM --> LOCKED[锁定当前版本与固定数据/申请/断言]
  LOCKED --> DRAFT[按已保存定义写草稿；失败重试不重新推导]
  DRAFT --> REVIEW_DRAFT[用户核对并确认草稿；严格Plan只读]
  REVIEW_DRAFT --> ORDER{锁定Plan有可执行时序吗}
  ORDER -->|旧Plan缺时序| SUPPLEMENT[显式补充时序与映射，保存新锁定版本]
  SUPPLEMENT --> FILES
  ORDER -->|已具备| FILES[按用户确认DAG列出可操作步骤]
  FILES -->|新开户01| SEND01[准备固定申请、编码下载01、人工交付登记SENT]
  SEND01 --> UP02[上传02：独立入口或完整混包入口]
  UP02 --> PARSE02[parse_account_return + validate_exchange_order]
  PARSE02 --> APPLY02[显式应用：verify_account_return → apply_account_confirmation]
  APPLY02 --> ACCOUNT{本次02成功确认吗}
  ACCOUNT -->|是| FORMAL_ACCOUNT[正式账户与TA绑定生效，记录CONFIRMED]
  FORMAL_ACCOUNT --> SEND03
  ACCOUNT -->|TA业务失败| FAILED_APP[申请FAILED，保留返回码；不改正式数据]
  FILES -->|已有有效正式账户03；或02依赖已满足| SEND03[准备固定申请、编码下载03、人工交付登记SENT]
  SEND03 --> UP04[上传04：独立入口或完整混包入口]
  UP04 --> PARSE04[parse_transaction_return + validate_exchange_order]
  PARSE04 --> APPLY04[显式应用：verify_transaction_return → apply_transaction_confirmation]
  APPLY04 --> TRADE{本次04成功确认吗}
  TRADE -->|是| FORMAL_TRADE[正式交易与持仓按确认量生效；防止与05重复计量]
  TRADE -->|TA业务失败| FAILED_APP
  FILES -->|独立或可选05，依赖由Plan决定| UP05[上传05；wait_holdings_return → parse_holdings_return]
  UP05 --> APPLY05[显式应用：verify_holdings_return → sync_holdings_snapshot]
  APPLY05 --> SNAPSHOT[正式账户余额基准；明细和基金汇总仅留存]
  FORMAL_TRADE --> FILES
  FORMAL_ACCOUNT --> FILES
  SNAPSHOT --> FILES
  FAILED_APP --> FILES
  FILES -->|必需步骤及申请已终结，可选05未传不阻挡| COLLECT[collect_case_results：当前Plan、本Case证据、完整原包摘要]
  COLLECT --> COMPARE[compare_case_expectations：严格Plan固定断言；旧Plan模型解释]
  COMPARE --> EXPLAIN[explain_case_result：精确比较与理由]
  EXPLAIN --> READY{建议是什么}
  READY -->|WAITING：缺必需回传或应用| FILES
  READY -->|REVIEW：证据缺失或不清楚| CHECK[补齐证据或人工澄清；不临时改锁定预期]
  CHECK --> COLLECT
  READY -->|PASS或FAIL建议| HUMAN[wait_case_result_confirmation：人工核对最新证据并终判]
  HUMAN -->|证据或版本变化| COLLECT
  HUMAN -->|最终PASS| FINAL_PASS[Case只读PASS]
  HUMAN -->|最终FAIL| FINAL_FAIL[Case只读FAIL；保留原因与证据]
  FINAL_FAIL --> RETEST[显式创建同父Chat关联后续Case；请求幂等]
  RETEST --> HISTORY
  FINAL_PASS --> CHAT_CHECK{全部人工确认且每条FAIL链末端PASS吗}
  CHAT_CHECK -->|未完成| OTHER[继续父Chat其他Case]
  OTHER --> ENTRY
  CHAT_CHECK -->|完成，用户正常结束| CLOSED[封存父Chat，保留各Case真实状态]
  ACTIVE[任意ACTIVE阶段：用户可填写原因强制结束] --> FORCE[FORCE封存，不把未完成或FAIL改为PASS]
  FORCE --> CLOSED
  CLOSED -->|显式NEW_RUN，保留正式数据| NEW_CHAT[创建空白新Chat，不复制旧Case]
  NEW_CHAT --> ENTRY
  CLOSED --> RESET_CHECK{Workspace全部Chat已封存且外部TA已重置吗}
  RESET_CHECK -->|人工明确声明| RESET[记录通道epoch/截止账号ID；旧绑定失效，历史不删除]
  RESET --> NEW_CHAT
  SQL[(已提交业务状态 / 原件 / 事件 / 证据)] -.-> RECONCILE[reconcile_committed_business：耐久图对账]
  RECONCILE --> WAIT[按当前阶段进入原生interrupt等待节点]
  WAIT -->|业务API先完成；resume通知或GET再对账| RECONCILE
  RECONCILE -.-> HISTORY
  RECONCILE -.-> FILES
  RECONCILE -.-> HUMAN
```

格式、归属、顺序、绑定、身份和不支持业务等错误不进入正式生效节点；业务事务回滚并返回明确错误，用户修正后重试。失败的02/04是申请终态，可以参加预期判断，但不满足依赖里的成功CONFIRMED；若后续必需步骤只接受成功而已失败，当前Plan无法继续，不能由协调器伪造成功，需人工处理或新Case重规划。

## 耐久编排与等待节点

`case-agent/src/durable-workflow.js` 中，`reconcile_committed_business` 读取认证范围内SQL事实，再路由到九个真实interrupt等待节点：

| 等待节点 | 唤醒前需要的业务动作 | 继续依据 |
|---|---|---|
| discussion | 首次/后续讨论，或重新提案 | 服务端历史与最新Plan，不使用客户端伪造历史 |
| confirm_plan_data | 当前版本DATA确认，或返回讨论 | 当前版本确认记录 |
| confirm_expectations | 同版本EXPECTATIONS确认，或返回讨论 | Plan锁定事实 |
| prepare_data | 写入或重试固定草稿 | case_data_executions |
| confirm_draft | 人工确认当前草稿 | case_data_confirmations |
| define_exchange_order | 历史Plan显式补齐时序 | 锁定exchangePlan与映射 |
| file_exchange | 用户生成/交付，上传/解析，显式应用 | Plan DAG及SENT/PARSED/CONFIRMED/APPLIED事实 |
| evaluate_result | 执行结果建议 | 最新建议与完整证据快照 |
| confirm_result | 人工确认最新PASS/FAIL建议 | 当前证据SHA、Plan版本、无pending/issues |

每次等待恢复回到对账节点。`CASE_FINAL` 与 `CHAT_CLOSED` 是协调器终止位置，Case只读不代表同Chat其他Case已完成。未上传的可选05通过optionalActions提示，不能把它强制接在04后；旧建议、REVIEW或WAITING均回到评估，不能仅因存在review记录跳入人工确认。

GET `/api/chats/:chat/cases/:case/workflow` 返回阶段、等待动作、revision、checkpointId与interrupted。POST `/resume` 只接收 `{eventId,expectedStage}`，是重新对账通知，不接受“TA成功”或“数据已同步”等客户端事实。MySQL保存checkpoint、pending writes和事件响应，同事务提交；每Case的服务端thread隔离，跨实例会话锁串行化，同UUID相同请求幂等、改变内容拒绝。业务API仍负责真实SQL与模型调用，此协调器不会自行点击确认、模拟TA或重复业务副作用。容量超过16MiB明确拒绝，关闭后的读不会改写业务状态。

## 生命周期与外部TA重置

GET `/api/chats/:chat/lifecycle` 汇总全部Case、最终人工结论、关联链、结束资格与事件。`/close` 支持NORMAL或带原因FORCE；`/retest` 用UUID请求创建同Chat的人工FAIL后续；`/new-run` 在封存后明确确认保留正式数据，创建空白新Chat。普通新增Case在Chat已建立发文批次后拒绝；人工FAIL关联后续仍允许，但必须重新讨论和确认，不能自动复制锁定Plan或重发。后续模型读取来源FAIL的Plan、证据摘要、建议和人工原因，超限裁剪明示，来源始终只读。

`/api/exchange/channels/:channel/ta-reset/confirm` 只记录用户明确确认已在外部真实TA完成重置。要求当前Workspace全部Chat先封存，按通道递增epoch并记录当时正式账户截止ID；旧账户/绑定被视为失效，禁止新选择、03复用及04/05同步。全部历史账户、交易、持仓、绑定、文件和结果保留；新01/02重新开户须新销售交易账号。平台响应明示 `physicalResetPerformedByPlatform:false`，不能宣称已经替用户物理清空TA。

迁移020保存生命周期请求与关联，021保存耐久等待，022保存外部TA重置审计；不清空旧数据。详细契约见 [Chat生命周期](../Backend/docs/chat-lifecycle.md)、[耐久编排](../Backend/docs/durable-workflow.md)、[TA重置声明](../Backend/docs/ta-reset.md) 及 [统一回传](./统一TA回传接收.md)。
