# Backend

本次实现合并并验证后，Case／Agent 后端以本仓库 `main` 为准；合并前选择本地运行版本仍核对实时Git和本机版本索引，未合并PR不等同已发布。包含case-agent、case-api、platform-store、platform-protocol；没有前端源码或构建产物。

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

迁移与协议含独立测试。代码目录与Frontend分开；Case业务使用case-api，登录等兼容入口仍使用legacy。

### 02 / 04 手动上传与纯解析

生成了当前 Case 的 01 文件后等待 02，生成 03 后等待 04。两条分型解析路径分别接收；新账户03仍需成功02绑定，已有可用TA账户直接03的Case无需再生成01。

- `GET /api/chats/:chatId/cases/:caseId/return-parsing`：列出生成文件对应的等待步骤及已保存解析结果。
- `POST /api/chats/:chatId/cases/:caseId/return-parsing/02` 或 `/04`：`{batchPublicId, files:[{fileName,base64}]}`。会话确定 workspace，服务端检查该 Case 确实在该批次生成了对应申请文件。写入需要同源 JSON 请求。
- 可直接上传同类型数据文件；附带 TA 原始 OFI 时，必须同时上传索引声明的全部数据文件，清单、机构、日期和版本须一致。此分型端点不接收混合02/04完整索引包；请使用下文[统一TA回传接收](../docs/统一TA回传接收.md)入口上传完整混合包，原始OFI及所有数据文件必须保留；未附索引时结果明确标记 `indexChecked:false`。
- 当前支持协议 21/22，每次最多 17 份文件、8 MiB、2000 条记录。解析保存全部字段、空值、协议小数位、文件头、来源行号、原始字节及 SHA-256；原始数据不交给模型。
- 错误结构、数字、编码、文件名、机构、版本、日期或类型会整次拒绝，不返回部分成功结果。失败不覆盖已保存结果；相同上传包重试返回 `duplicate:true`，不同内容追加独立解析记录。
- `PARSED` 仅表示文件解析完成；`applicationsMatched:false`、`businessApplied:false`。上传所在 Case 是操作上下文，不是回传记录的业务归属。此入口不匹配申请、不创建 TA 绑定、不改申请/批次/Case 业务状态、不自动生成后续 03，也不做 05 或最终判定。

四个实际 LangGraph 节点为 `wait_account_return`、`parse_account_return`、`wait_transaction_return`、`parse_transaction_return`：01/03 原始发文决定对应等待入口；手动上传事件分别进入 02/04 解析节点；解析成功后保存结果并结束本次调用；解析异常由 API 返回错误，等待入口仍可重试。等待依据持久化的生成文件重建，成功结果存储于 `case_return_parses` / `case_return_parse_files`；重启和页面刷新后可读取。这些业务小图通过SQL与API衔接；新增耐久协调器使用原生checkpoint/interrupt恢复阶段，详见下文。

此次 PR 只含后端，前端上传与查看入口仅用于本地验收。协议和接口测试覆盖有效文件、业务失败、空记录、中文、金额/份额/净值精度、索引分片、错误类型、损坏内容、幂等和权限范围；真实 TA 扩展格式仍需拿实际文件核对。

### TA 确认后才生效的销售数据

Case 的 `case_generated_*` 四张表是申请准备草稿和测试条件。确认草稿仅表示允许据此准备 01/03；它不建立正式账户、不增加正式持仓、不生成成功交易。`GET /data` 用 `purpose: APPLICATION_DRAFT`、`businessApplied: false` 标明用途。

正式销售查询为 `GET /api/sales-data`，只读取 `sales_confirmed_accounts`、`sales_confirmed_transactions`、`sales_confirmed_holdings`，并标记 `source: TA_CONFIRMED`。生成的模拟余额、模拟持有、净值和旧 TA 绑定均不会自动复制到正式表。此次不定义资金账户的现金会计；正式视图没有把模拟余额当现金余额。

当前应用范围明确为开户 `01/001 → 02/101` 和申购 `03/022 → 04/122`。其他业务码仍可作为协议测试申请/解析结果，但不能通过确认生效接口修改正式数据。赎回、冻结/解冻、销户的会计效果未实现。Case结果建议与人工确认、05账户余额快照同步已实现，见下文。

流程：

1. 确认 Plan、准备并确认申请草稿；点击申请准备，生成 01。草稿确认不再自动启动申请准备，便于先选择已有正式账户。
2. 实际将文件发送至 TA 后，调用 `POST /api/chats/:chat/cases/:case/return-confirmation/delivery`，请求 `{batchPublicId}`。这里只记录用户对实际发送的声明，不声称系统代替用户完成了传输。批次须完整生成；同一物理批次内全部申请进入 `WAITING_RETURN`。
3. 在对应的 02/04 纯解析入口上传原始回传。解析仍仅保存原文件与解析字段，不写正式数据。
4. 调用 `POST /api/chats/:chat/cases/:case/return-confirmation/apply`，请求 `{parseId,recordIndexes}`。序号从 0 开始，按解析结果 files 顺序、每份文件 records 顺序展开。可逐条选择；未知申请、身份冲突、尚未发送、未支持/未完成业务或不完整成功回传均明确拒绝。一个请求内任何记录错误，整个请求回滚。
5. 成功 02 匹配已发送的当前 Case/批次开户申请，才建立正式账户和 TA 绑定。之后继续申请准备，03 可使用此 TA 账号。
6. 成功 04 匹配已发送的申购申请，才保存确认交易，并按 `ConfirmedVol` 增加正式持仓。金额和份额使用 TA 确认值，不使用申请金额或模拟持有。支持最终确认金额小于申请金额；非最终 `BusinessFinishFlag` 不生效。

TA 业务失败不是解析错误：有效匹配的非 `0000` 返回码把申请标为 `FAILED`、保存可追溯确认记录，但不建立账户/交易/持仓。原始失败文件仍保留。已显式应用、精确匹配当前Case/Plan与同一账户的失败若使必需后续步骤无法执行，结果节点给出TA依赖阻断证据及FAIL建议，允许人工FAIL后关联新Case；不把FAILED视作CONFIRMED、不发无法执行的03、不修改正式数据。纯解析失败仍等待显式应用，可选或无关分支失败不能封死其他必需分支。

`GET /api/chats/:chat/cases/:case/return-confirmation` 返回批次发送状态和已应用确认。`POST .../return-confirmation/account` 接收 `{accountPublicId}`，将同一 Workspace 内正式账户引用到尚未生成申请的 Case；后续准备只使用用户选择的正式账户，允许直接生成 03、等待 04，不要求该 Case 再生成 01。已有申请时禁止切换账户。

确认使用四个实际 LangGraph 节点：

| 节点 | 输入/触发事件 | 成功后的结果 | 失败/重试 |
| --- | --- | --- | --- |
| `verify_account_return` | 用户选择已解析的 02 记录，当前 Case 的已交付 01 快照 | 验证申请号、机构、业务码、身份和日期，生成开户确认或业务失败计划 | 核验错误不进入生效节点；保留解析结果，可重新上传/选择正确记录 |
| `apply_account_confirmation` | 已通过核验的计划 | 成功开户建立正式账户与绑定；业务失败仅将申请标失败 | SQL 错误整个事务回滚，重试原记录；相同申请/记录摘要幂等 |
| `verify_transaction_return` | 用户选择已解析的 04 记录，已交付 03 快照 | 验证账户、基金、份额类别、币种、日期和精确确认量 | 不支持业务、非最终确认、无效金额/份额不生效 |
| `apply_transaction_confirmation` | 已核验的申购确认计划和已有正式账户 | 按确认量写正式交易和持仓；业务失败仅将申请标失败 | SQL 错误回滚；重复记录不重复增加份额；不同确认不能覆盖旧结果 |

这些节点与上一阶段等待/解析节点通过持久化业务数据和 API 事件衔接。业务图本身仍是独立调用；耐久协调器根据批次、申请、解析包及确认表对账，以原生interrupt和MySQL checkpoint恢复等待。05 使用独立输入事件与节点，见下文。

迁移 012/013 新建正式数据与 Case 账户引用表，并兼容 V2.2 的 40 位证件字段。迁移不把旧测试数据追认为正式业务；历史 `CONFIRMED` 申请、旧绑定不会被自动提升，也没有提供无提示补账入口。验收使用新 Case，真实历史补账应单独核验来源。旧 `matchReturnRecord` 直接建绑定旁路返回 `CONFIRMATION_SERVICE_REQUIRED`。

所有正式写入、申请状态、回传归属和绑定位于同一数据库事务。Workspace 来自认证会话，Case/Chat/批次/通道均在 SQL 中核对，每次应用都重新读取原字节，核验逐文件摘要与完整包摘要，并从原字节重建业务记录；保留原解析的文件顺序和记录序号。通道锁串行化共享账户/持仓更新；每份申请只允许一条最终确认，不同回传须进入另行定义的更正流程。

验证正式业务的 MySQL 集成测试（先运行 `db:migrate`）：

```sh
CASE_CONFIRMATION_MYSQL=1 pnpm test:store
```

测试读取正常 CASE_DB_* 环境配置，所有合成用户/Case/申请/确认和故障测试写入最终回滚，覆盖草稿不生效、未交付拒绝、开户后交易、实际确认量、业务失败、重复/冲突、同请求错误整批回滚、存储故障回滚、已有账户直接 03 与跨 Workspace/Case 隔离。

### Plan 文件时序与受控上传

Plan v2 增加必填 `exchangePlan`。`status: UNPLANNED` 时 `steps` 为空、`openQuestions` 给出时间/轮次问题；AI 的 `ask_exchange_timing` 节点询问用户，修改后重新提案。READY 的每个步骤包含 `stepId`、`roundId`、`direction`（SEND/RECEIVE）、`fileType`、`businessTime`（DATE/RELATIVE）、`required` 和 `dependsOn: [{stepId, condition}]`。01/03 是 SEND，02/04/05 是 RECEIVE；02/04 必须依赖同轮次01/03的 SENT。依赖为有向无环图，不强制全局02<04<05，不限制两轮；已有确认账户可直接03，05可独立或可选。

DATE 使用 YYYYMMDD：发送检查批次业务日期，接收检查文件头日期，不把文件头日期等同于所有记录的交易确认日期。模型提出的日期必须出现在用户消息中，只有助手建议的日期不能成为可执行计划；未知时点返回时序讨论。RELATIVE 保存用户明确说过的相对时点说明，实际顺序由 dependsOn 校验；本 PR 不提供交易日历、T+N 日期计算或时分秒定时调度。

提案时间证据使用保守的文本护栏：肯定证据必须指向对应文件、发送/接收方向角色或明确覆盖全部文件；显式文件编号优先，不能把02回报日期用于01，即使两者时间相同。标识符中的日期、举例/疑问/否定的时间不算确认；较新的同时间否定或同文件改期会使旧提案回到 UNPLANNED，未指定文件的“不使用T+1”仍取消共享该时间的旧证据。正常简短回答如“01 T日，02 T+1，03确认后当天，04 T+2”可作为证据。这不是通用语言语义判断，含混表达（如“没问题T+1”）可能继续追问，不能据此自动生效。

抽取文件编号前先排除日期、T±偏移、钟点、带单位时长及轮次数字，防止T+02被当成02文件。明确文件的自然语言改期（如“03改为周三”）、取消或待定会要求重新规划；同句“从T+1改为周三”中旧时间不作为变更后的证据，“03改为T+1”仍可确认新时间。

`validate_exchange_order` 是独立 LangGraph 节点，发送登记、受控02/04上传、正式确认生效都会执行它。依赖条件区分：SENT 是登记实际发送；PARSED 是格式正确且上传时序校验通过；CONFIRMED 是对应批次全部申请成功确认。解析不等于成功确认；业务失败不会满足 CONFIRMED。

014 的 `case_exchange_plan_events` 保存 SENT/CONFIRMED；新增015的 bindings 绑定认证 Workspace/Chat/Case、锁定 Plan 版本、步骤和批次，receipts 按每个回传包保存 PARSED。一个 RECEIVE 步骤可接收同批多包，成功确认按对应 Case/批次/申请类型聚合；相同包重试幂等，冲突确认不可覆盖正式账本。多 Case、混合01/03批次按每个成员计划检查后原子发送；任何成员检查失败都不会部分发送。delivery 可传 `exchangeSteps: [{casePublicId,fileType,stepId}]` 明确各成员步骤。

上传及 delivery/apply JSON 可增加可选 `exchangeStepId`，多个同类型轮次无法唯一推断时必须提供。错误顺序返回 HTTP409、`error: ORDER_VIOLATION`、说明缺少哪个依赖；文件格式正确的乱序包仍保存原件和解析结果，返回 `phase: ORDER_REJECTED` 与 `parseId`，不记录步骤完成、不生效。补齐前置条件后须显式重新上传同包，原件幂等；不偷偷自动恢复。错误日期、错误轮次或覆盖已有步骤另报对应错误。GET解析路径将历史包标为 `orderAccepted`，不把仅保存的包显示为已接收完成。

历史 Plan 缺 exchangePlan 仍可读取、原件保留，GET 明示 UNPLANNED。通过 `POST /api/chats/:chat/cases/:case/exchange-plan/confirm` 显式补充 `{baseVersionNumber,exchangePlan,mappings:[{stepId,batchPublicId,parseIds}]}`，生成不可变的新锁定版本；业务目标/场景、旧申请与草稿引用均保留，不解锁重建 Case。映射必须属于当前 Case/批次/文件类型，仅真实发送、解析和全部成功确认能继承完成状态，记录操作者及映射。已完整计划不能重复补充；模型和上传不猜测或改写顺序。

PR22时05只支持Plan描述。本地新增05独立上传、解析和显式账户余额同步入口，见下文。现有协议/确认前置条件仍独立强制，用户确认的测试顺序不能允许未确认账户先产生正式交易。
受控解析先短事务读取目标，释放数据库连接后做协议解析，再锁定 Case 重新核验目标并保存原件/时序状态。写路径计划、绑定、回执与幂等查询使用当前锁定读，避免等待锁之前的 RR 快照遗漏刚提交的发送或重复包。


## 05 独立回传与正式持仓同步（本地实现）

- GET /api/chats/:chatId/cases/:caseId/holdings-return：已锁定Plan中的05步骤和本Case解析/应用历史。
- POST 同路径 /parse：{channelId, files:[{fileName,base64}], exchangeStepId?}。不依赖发文批次；校验Workspace/通道、GB18030原始字节、V2.1/2.2文件头和字段、可选原始OFI完整清单、已锁定Plan时序；原件持久化，登记PARSED，不修改持仓。
- POST 同路径 /apply：{parseId, exchangeStepId?}。用户显式确认，重新核验原文件和当前Plan，整包原子应用。只对已有正式账户、匹配网点的DetailFlag=0账户余额生效；DetailFlag=1/A保留并返回DETAIL_ONLY/FUND_SUMMARY_ONLY，不创建账户、交易或Case结论。

TotalVolOfDistributorInTA是余额，WholeFlag=0增量传输也按该账户基金余额覆盖；不是增加份额。重复余额键、旧日期、同日不同快照、未知账户均拒绝整包。空包或未出现持仓不清零其他记录。05基准加基准日期之后已确认申购，后到且日期不晚于基准的04仍记录交易，但不重复增加持仓。04晚于基准时增加总余额，可用/冻结置空以免展示过期数值。两种应用共用通道行锁。

05业务节点：wait_holdings_return → parse_holdings_return；verify_holdings_return → sync_holdings_snapshot。耐久协调器按已确认DAG恢复阶段，05可独立或可选，未上传的可选05不阻挡结果评估。销售查询包含availableVolume、frozenVolume、snapshotDate、snapshotTotal、snapshotParseId；原字段可通过05解析历史查看。05本身不决定Case结论。

迁移016新增05解析/原文件/独立Plan收件表及持仓基准列。常规测试外，CASE_CONFIRMATION_MYSQL=1的确认业务测试覆盖05独立同步、重放、错误回滚、旧日/同日冲突、同日后到04不重复计入、零余额与未出现基金不清零。

## Case结果建议与人工确认（本地实现）

三个接口均使用当前Workspace的会话Cookie；写入校验Origin及JSON精确字段。

- GET `/api/chats/:chatId/cases/:caseId/result-review`：最近判断及其证据快照、建议、人工结论。
- POST 同路径 `/evaluate`，请求 `{}`：自动收集当前锁定Plan、申请确认、受控05状态、引用正式账户与持仓、原件摘要。LangGraph收集→解释预期→精确比较并说明→等待人工确认。模型调用事务之外，保存前重新核验证据未变；并发同Case返回409，每进程最多两个Case并行模型判断，超额429。
- POST 同路径 `/confirm`，请求 `{reviewId,verdict:"PASS"或"FAIL",reason}`：人工核对完整断言后确认最新版本。WAITING/REVIEW返回409 RESULT_NOT_READY；证据变化409 CASE_RESULT_CHANGED；旧版本409 REVIEW_SUPERSEDED；其他结论覆盖409 VERDICT_CONFLICT。401会话无效，404非本Workspace/Chat的Case或不存在记录，400输入无效，403Origin无效。

迁移017保存Plan版本、证据摘要与完整快照、建议、人工最终结论/说明/确认人/时间。AI建议不会改变销售数据或Case最终状态；最终确认才把Case状态设为PASS/FAIL。重复同一最终确认幂等。旧锁定Plan的自由文本预期由模型解释为原文引用和字面值断言；引用不可信、证据不足、模型格式无效等为REVIEW，缺少必需回传或应用为WAITING。后端精确比较数量金额，不信任模型给出的PASS。新严格Plan直接消费已确认contract的固定断言，不重新由模型推导；自然语言完整语义仍需人工核对。正式持仓是本次收集时引用账户的当前读数，证据明确标注来源，不能当作原TA文件的某行值。


### Plan严格结构与双确认

新提案展示contract（V2.2准备数据、固定01/001与03/022申请字段、业务假设、结构化结果断言）。POST Case `/plan/confirm`必须提交 `{versionNumber,section:"DATA"}` 再 `{versionNumber,section:"EXPECTATIONS"}`，第二次确认才锁定并写草稿。GET Plan返回对应版本confirmations。执行重试使用保存数据；新严格Plan的草稿/申请业务字段冻结，修改需新Case；旧已锁定Plan保留兼容，旧待确认Plan需重新提案。

错误包括PLAN_DATA_CONFIRMATION_REQUIRED、PLAN_CONTRACT_REQUIRED、PLAN_DATA_MISMATCH、PLAN_DATA_FROZEN、PLAN_PROTOCOL_UNSUPPORTED。数值断言必须在对应预期原文中有精确字面依据，禁止由申请金额/初始条件猜未明确要求的可用或冻结余额；目标不明先澄清。结果核对消费已确认断言，证据缺失/多义要求核查；最终结论仍需人工确认。迁移018新增两处人工确认审计表。本地Frontend展示与测试，不纳入后端PR。


严格Plan的金额/份额断言必须在该场景的expectedQuote原文中有同值数字，以BigInt的八位小数精度比较（100与100.00等价）。没有数字的初始条件不能推出最终可用/冻结余额；模型补充的无依据数值断言会阻止Plan确认，历史无效contract结果只能REVIEW。初始条件只列业务假设，用户明确要求但未提供数值的结果列missing待澄清；不能从实际结果反填期望。
数字引用按完整十进制token提取，不能把1,000或1e3拆成1/0/3，字母标识中的数字不充当结果数值；Unicode负号保留负数含义。千位分隔与科学计数的结果须改成明确普通十进制再确认。词法相等并不证明数字属于哪个业务字段，字段/语义仍须用户审阅固定预期；系统不声称完成自由文本语义证明。

## 统一原始02/04/05回传

GET Case `/ta-receipts` 返回 `{returns,holdings,supportedTypes,formats,businessApplied:false}`，02/04目标含batchPublicId、expectedType、channelId；05提供独立Plan步骤。POST `/ta-receipts/parse` 接收 `{channelId,files:[{fileName,base64}],routes?:[{fileType,batchPublicId?,exchangeStepId?}]}`。每种类型最多一个目标，歧义必须指定批次/步骤。仅支持同通道/同日期/同协议的原始TXT及可选完整OFI，ZIP明确拒绝。

先验证全部原件及完整索引，再按02/04/05类型分发；每类保存完整原包，不伪造子索引。任一结构或Plan时序错误整事务回滚。成功返回results数组，项含fileType/parseId/duplicate/phase，02/04解析对象为result，05为parsed；只解析，不同步正式数据。正式apply仍需用户显式调用，并匹配当前Case自己的申请号。完整包可含其他Case记录，但不得裁剪索引或替其他Case自动落库。见 [完整契约](../docs/统一TA回传接收.md)。

## Chat生命周期、关联后续与新测试

父Chat含多个Case，人工FAIL后通过同Chat关联后续继续讨论，原Case保持只读，来源Plan/证据/失败原因提供给后续模型。普通新增Case在已建发文批次后拒绝，FAIL关联后续例外；后续必须重新讨论、双确认和生成。正常结束要求全部人工确认、每条FAIL链末端PASS；FORCE须理由，保留未完成/FAIL真实状态。NEW_RUN在封存后创建空白新Chat，必须明确保留正式数据，不删除历史。详见 [接口与规则](docs/chat-lifecycle.md)。

## 外部TA重置声明

GET `/api/exchange/channels/:channel/ta-reset` 读取通道epoch和历史；POST `/confirm` 接收 `{requestId,reason,confirmation:"TA_RESET_CONFIRMED"}`。操作者须先在外部完成TA重置、封存Workspace全部Chat，再显式声明。平台仅记录epoch/截止账号ID并禁用旧绑定，保留历史账户/交易/持仓/原件。新01/02可重新开户，旧账号不得覆盖；NEW_RUN不使账号失效。平台不执行物理重置，始终返回physicalResetPerformedByPlatform:false。详见 [TA重置](docs/ta-reset.md)。

## 原生LangGraph耐久等待

GET Case `/workflow` 对账并返回stage/waiting/revision/checkpointId/interrupted；POST `/workflow/resume` 只接受 `{eventId:UUID,expectedStage}` 通知。现有业务API先执行模型/SQL，协调器重新读取事实，不接受客户端声称成功，也不主动点击确认或生成TA回传。

`reconcile_committed_business` 路由至九个真实interrupt节点：discussion、confirm_plan_data、confirm_expectations、prepare_data、confirm_draft、define_exchange_order、file_exchange、evaluate_result、confirm_result。每次恢复回到对账。MySQL持久化checkpoint/pending writes/幂等事件，服务重启可继续；跨实例锁串行化，失败同事务回滚，容量16MiB上限明确拒绝。CASE_FINAL只表示当前Case已终判，Chat其他Case继续；CHAT_CLOSED只读。

仅必需步骤阻挡阶段，可操作的独立可选05通过optionalActions返回。最新PASS/FAIL建议还须Plan版本和当前证据SHA一致、无pending/issues，才显示结果确认；旧建议或REVIEW回到评估。结果收集校验整个原包摘要，缺文件、只剩索引和原字节损坏均要求REVIEW，不给通过建议。详见 [耐久编排](docs/durable-workflow.md)；包含历史路由/讨论循环、双确认、所有文件分支和生命周期的完整图位于 [主设计](../docs/Case全流程设计.md)。

迁移018为Plan双确认，020为生命周期关联，021为checkpoint，022为外部TA重置；统一回传复用原表，无019空迁移。剩余范围为ZIP/目录递归、跨通道多轮自动路由、交易日历/秒级调度、未支持业务账务、关系表达式/完整语义证明、真实TA网络及物理重置。不得把协议目录或最低结构校验视为这些能力已实现。

模型调用失败保留待完成回合，重试同一输入：超时返回MODEL_TIMEOUT/504，连接、限流或服务临时故障返回MODEL_UNAVAILABLE/503；上游拒绝请求返回MODEL_PROVIDER_REJECTED/502供检查服务配置。模型空回复、三行格式或Plan格式未通过返回明确502错误码；不回传provider原始错误消息、headers或凭据。错误提示不把失败调用当作已完成讨论/Plan。

准备数据定义只描述初始模拟草稿，不能把02/04/05同步后的最终预期余额倒填成初始持仓。沿用已有正式账户的独立05 Case允许客户/账户/持仓三个数组为空，仅保留所需基金元数据；正式账户由后续引用选择。05能同步总/可用/冻结份额，草稿schema未包含后两字段不应成为missing，最终结果由结构化断言核验。已用保存的合成独立05 Plan进行真实Sophnet两次调用验证：三空、一个基金、零申请、三个固定余额预期、两处missing为空；纯生成校验，未修改原Plan或正式数据，原UNPLANNED时序继续等待明确日期确认。

最终本地复测与真实Sophnet/UI证据见 [全流程验收](docs/full-flow-acceptance-2026-10-06.md)。发布终审另修复等锁后的RR旧快照：草稿revision/确认、父Chat发文门槛、终判封存及轮次幂等、TA reset epoch/cutoff、05较晚04确认量均使用当前锁定读；参见 [写事务审查](docs/repeatable-read-write-audit-2026-10-06.md)。最新完整发布候选255项常规通过、10个opt-in跳过；独立随机临时库10项真实MySQL组合测试全部通过（0跳过），包括05/04双连接竞争及前修负控；最终main仍需按实际合并头复测。真实TA网络与物理重置仍未接入。
