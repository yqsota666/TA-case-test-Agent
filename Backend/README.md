# Backend

当前 Case／Agent 后端，来源 codex/ai-application-preparation 的4308b79f及本地申请准备修复（2026-10-05）。包含case-agent、case-api、platform-store、platform-protocol；没有前端源码或构建产物。

```sh
cd Backend
pnpm install --frozen-lockfile
pnpm test
pnpm db:migrate
pnpm start:case-api
```

Case API需进程环境 CASE_DB_HOST、CASE_DB_PORT、CASE_DB_USER、CASE_DB_PASSWORD、CASE_DB_NAME、CASE_PUBLIC_ORIGIN、CASE_API_PORT、SOPHNET_API_KEY。本机验收端口为3102，PUBLIC_ORIGIN为http://127.0.0.1:3102；MySQL转发端口3307，数据库ta_case_agent_local。密钥从钥匙串读取，只放入进程内存。真实模型为Sophnet DeepSeek-V4-Pro-0813。

## 兼容服务

legacy/只保留当前Frontend仍需要的聊天、登录、公共数据接口以及它们的运行依赖；不是另一份前端。单独安装：

```sh
cd legacy
pnpm install --ignore-workspace --frozen-lockfile
cd ..
pnpm start:legacy
```

兼容服务通过 PLATFORM_DB_HOST、PLATFORM_DB_PORT、PLATFORM_DB_USER、PLATFORM_DB_PASSWORD、PLATFORM_DB_NAME、PLATFORM_PORT=8084配置；本机验收设置AGENT_ENABLED=0，Agent动作交给新Case API。运行凭据不复制进仓库。

迁移与协议含独立测试。代码目录已与Frontend分开，业务API统一迁移仍是后续工作。

### 02 / 04 手动上传与纯解析

生成了当前 Case 的 01 文件后等待 02，生成 03 后等待 04。两条路径互相独立，已有可用 TA 账户而直接生成 03 的 Case 不需要先生成 01。

- `GET /api/chats/:chatId/cases/:caseId/return-parsing`：列出生成文件对应的等待步骤及已保存解析结果。
- `POST /api/chats/:chatId/cases/:caseId/return-parsing/02` 或 `/04`：`{batchPublicId, files:[{fileName,base64}]}`。会话确定 workspace，服务端检查该 Case 确实在该批次生成了对应申请文件。写入需要同源 JSON 请求。
- 可直接上传同类型数据文件；附带 TA 原始 OFI 时，必须同时上传索引声明的全部数据文件，清单、机构、日期和版本须一致。混合 02/04 的完整索引包暂不支持，须分别上传数据文件；未附索引时结果明确标记 `indexChecked:false`。
- 当前支持协议 21/22，每次最多 17 份文件、8 MiB、2000 条记录。解析保存全部字段、空值、协议小数位、文件头、来源行号、原始字节及 SHA-256；原始数据不交给模型。
- 错误结构、数字、编码、文件名、机构、版本、日期或类型会整次拒绝，不返回部分成功结果。失败不覆盖已保存结果；相同上传包重试返回 `duplicate:true`，不同内容追加独立解析记录。
- `PARSED` 仅表示文件解析完成；`applicationsMatched:false`、`businessApplied:false`。上传所在 Case 是操作上下文，不是回传记录的业务归属。此入口不匹配申请、不创建 TA 绑定、不改申请/批次/Case 业务状态、不自动生成后续 03，也不做 05 或最终判定。

四个实际 LangGraph 节点为 `wait_account_return`、`parse_account_return`、`wait_transaction_return`、`parse_transaction_return`：01/03 原始发文决定对应等待入口；手动上传事件分别进入 02/04 解析节点；解析成功后保存结果并结束本次调用；解析异常由 API 返回错误，等待入口仍可重试。等待依据持久化的生成文件重建，成功结果存储于 `case_return_parses` / `case_return_parse_files`；重启和页面刷新后可读取。当前使用数据库恢复及事件重新 invoke，未宣称已实现整个 TA 流程的 LangGraph checkpoint/interrupt 编排。

此次 PR 只含后端，前端上传与查看入口仅用于本地验收。协议和接口测试覆盖有效文件、业务失败、空记录、中文、金额/份额/净值精度、索引分片、错误类型、损坏内容、幂等和权限范围；真实 TA 扩展格式仍需拿实际文件核对。

### TA 确认后才生效的销售数据

Case 的 `case_generated_*` 四张表是申请准备草稿和测试条件。确认草稿仅表示允许据此准备 01/03；它不建立正式账户、不增加正式持仓、不生成成功交易。`GET /data` 用 `purpose: APPLICATION_DRAFT`、`businessApplied: false` 标明用途。

正式销售查询为 `GET /api/sales-data`，只读取 `sales_confirmed_accounts`、`sales_confirmed_transactions`、`sales_confirmed_holdings`，并标记 `source: TA_CONFIRMED`。生成的模拟余额、模拟持有、净值和旧 TA 绑定均不会自动复制到正式表。此次不定义资金账户的现金会计；正式视图没有把模拟余额当现金余额。

当前应用范围明确为开户 `01/001 → 02/101` 和申购 `03/022 → 04/122`。其他业务码仍可作为协议测试申请/解析结果，但不能通过确认生效接口修改正式数据。赎回、冻结/解冻、销户、05 快照同步及 Case 成败判定需另行实现，不推断它们的会计含义。

流程：

1. 确认 Plan、准备并确认申请草稿；点击申请准备，生成 01。草稿确认不再自动启动申请准备，便于先选择已有正式账户。
2. 实际将文件发送至 TA 后，调用 `POST /api/chats/:chat/cases/:case/return-confirmation/delivery`，请求 `{batchPublicId}`。这里只记录用户对实际发送的声明，不声称系统代替用户完成了传输。批次须完整生成；同一物理批次内全部申请进入 `WAITING_RETURN`。
3. 在对应的 02/04 纯解析入口上传原始回传。解析仍仅保存原文件与解析字段，不写正式数据。
4. 调用 `POST /api/chats/:chat/cases/:case/return-confirmation/apply`，请求 `{parseId,recordIndexes}`。序号从 0 开始，按解析结果 files 顺序、每份文件 records 顺序展开。可逐条选择；未知申请、身份冲突、尚未发送、未支持/未完成业务或不完整成功回传均明确拒绝。一个请求内任何记录错误，整个请求回滚。
5. 成功 02 匹配已发送的当前 Case/批次开户申请，才建立正式账户和 TA 绑定。之后继续申请准备，03 可使用此 TA 账号。
6. 成功 04 匹配已发送的申购申请，才保存确认交易，并按 `ConfirmedVol` 增加正式持仓。金额和份额使用 TA 确认值，不使用申请金额或模拟持有。支持最终确认金额小于申请金额；非最终 `BusinessFinishFlag` 不生效。

TA 业务失败不是解析错误：有效匹配的非 `0000` 返回码把申请标为 `FAILED`、保存可追溯确认记录，但不建立账户/交易/持仓。原始失败文件仍保留。

`GET /api/chats/:chat/cases/:case/return-confirmation` 返回批次发送状态和已应用确认。`POST .../return-confirmation/account` 接收 `{accountPublicId}`，将同一 Workspace 内正式账户引用到尚未生成申请的 Case；后续准备只使用用户选择的正式账户，允许直接生成 03、等待 04，不要求该 Case 再生成 01。已有申请时禁止切换账户。

确认使用四个实际 LangGraph 节点：

| 节点 | 输入/触发事件 | 成功后的结果 | 失败/重试 |
| --- | --- | --- | --- |
| `verify_account_return` | 用户选择已解析的 02 记录，当前 Case 的已交付 01 快照 | 验证申请号、机构、业务码、身份和日期，生成开户确认或业务失败计划 | 核验错误不进入生效节点；保留解析结果，可重新上传/选择正确记录 |
| `apply_account_confirmation` | 已通过核验的计划 | 成功开户建立正式账户与绑定；业务失败仅将申请标失败 | SQL 错误整个事务回滚，重试原记录；相同申请/记录摘要幂等 |
| `verify_transaction_return` | 用户选择已解析的 04 记录，已交付 03 快照 | 验证账户、基金、份额类别、币种、日期和精确确认量 | 不支持业务、非最终确认、无效金额/份额不生效 |
| `apply_transaction_confirmation` | 已核验的申购确认计划和已有正式账户 | 按确认量写正式交易和持仓；业务失败仅将申请标失败 | SQL 错误回滚；重复记录不重复增加份额；不同确认不能覆盖旧结果 |

这些节点与上一阶段等待/解析节点通过持久化业务数据和 API 事件衔接。图本身没有宣称具备 LangGraph 原生 checkpoint/interrupt；服务重启后的等待状态来自批次、申请、解析包及确认表。未来 05 属于独立输入事件与节点。

迁移 012/013 新建正式数据与 Case 账户引用表，并兼容 V2.2 的 40 位证件字段。迁移不把旧测试数据追认为正式业务；历史 `CONFIRMED` 申请、旧绑定不会被自动提升，也没有提供无提示补账入口。验收使用新 Case，真实历史补账应单独核验来源。旧 `matchReturnRecord` 直接建绑定旁路返回 `CONFIRMATION_SERVICE_REQUIRED`。

所有正式写入、申请状态、回传归属和绑定位于同一数据库事务。Workspace 来自认证会话，Case/Chat/批次/通道均在 SQL 中核对，原始回传字节摘要在首次应用前验证。通道锁串行化共享账户/持仓更新；每份申请只允许一条最终确认，不同回传须进入另行定义的更正流程。

验证正式业务的 MySQL 集成测试（先运行 `db:migrate`）：

```sh
CASE_CONFIRMATION_MYSQL=1 pnpm test:store
```

测试读取正常 CASE_DB_* 环境配置，所有合成用户/Case/申请/确认和故障测试写入最终回滚，覆盖草稿不生效、未交付拒绝、开户后交易、实际确认量、业务失败、重复/冲突、同请求错误整批回滚、存储故障回滚、已有账户直接 03 与跨 Workspace/Case 隔离。

### Plan 文件时序与受控上传

Plan v2 增加必填 `exchangePlan`。`status: UNPLANNED` 时 `steps` 为空、`openQuestions` 给出时间/轮次问题；AI 的 `ask_exchange_timing` 节点询问用户，修改后重新提案。READY 的每个步骤包含 `stepId`、`roundId`、`direction`（SEND/RECEIVE）、`fileType`、`businessTime`（DATE/RELATIVE）、`required` 和 `dependsOn: [{stepId, condition}]`。01/03 是 SEND，02/04/05 是 RECEIVE；02/04 必须依赖同轮次01/03的 SENT。依赖为有向无环图，不强制全局02<04<05，不限制两轮；已有确认账户可直接03，05可独立或可选。

DATE 使用 YYYYMMDD：发送检查批次业务日期，接收检查文件头日期，不把文件头日期等同于所有记录的交易确认日期。模型提出的日期必须出现在用户消息中，只有助手建议的日期不能成为可执行计划；未知时点返回时序讨论。RELATIVE 保存用户明确说过的相对时点说明，实际顺序由 dependsOn 校验；本 PR 不提供交易日历、T+N 日期计算或时分秒定时调度。

`validate_exchange_order` 是独立 LangGraph 节点，发送登记、受控02/04上传、正式确认生效都会执行它。依赖条件区分：SENT 是登记实际发送；PARSED 是格式正确且上传时序校验通过；CONFIRMED 是对应批次全部申请成功确认。解析不等于成功确认；业务失败不会满足 CONFIRMED。

事件保存到014迁移的 `case_exchange_plan_events`，绑定认证 Workspace/Chat/Case、锁定 Plan 版本、步骤与批次/回传包，上传不修改 Plan。一个步骤绑定一个完整上传包（可包含原始分片）；不同内容不能覆盖已接受包，更正需要另行定义步骤/Case。本 PR 按 Case 和单文件类型发送批次；多 Case 共享批次须先拆分。

上传及 delivery/apply JSON 可增加可选 `exchangeStepId`，多个同类型轮次无法唯一推断时必须提供。错误顺序返回 HTTP409、`error: ORDER_VIOLATION`、说明缺少哪个依赖；文件格式正确的乱序包仍保存原件和解析结果，返回 `phase: ORDER_REJECTED` 与 `parseId`，不记录步骤完成、不生效。补齐前置条件后须显式重新上传同包，原件幂等；不偷偷自动恢复。错误日期、错误轮次或覆盖已有步骤另报对应错误。GET解析路径将历史包标为 `orderAccepted`，不把仅保存的包显示为已接收完成。

历史 Plan 缺 exchangePlan 仍可读取、历史原件保留，GET 明示 UNPLANNED；不能猜测默认顺序或自动重写锁定版本。新锁定和继续正式生效会要求完整时序；已锁定历史 Case 当前需新建有明确时序的 Case 继续验收。本 PR 尚未提供历史锁定计划补充迁移工具。

05 在本 PR 只支持 Plan 描述与校验框架；没有05上传、协议解析或持仓同步入口。现有协议/确认前置条件仍独立强制，用户确认的测试顺序不能允许未确认账户先产生正式交易。
