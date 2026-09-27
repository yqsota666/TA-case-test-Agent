# 基金业务测试数据工厂 V2 — Coding Plan

> 状态：实施中（第一阶段已落地）  
> 编写日期：2026-09-22  
> 项目目录：`/Users/apple/Documents/ChatGPT/gf/fund-sales-demo`  
> 协议基线：中央数据交换平台开放式基金业务数据交换协议 V2.2

## 0. 实施进度（2026-09-22）

第一阶段已完成：

- 新数据工厂三栏工作台、今日业务池、统一生成计划。
- 保留模拟客户、账户业务和交易业务入口。
- 保留独立字段编辑弹窗，修改值会随 T 日统一封批生效。
- 正常场景一键自动完成 T 日封批、TA 接收、T+1 处理、确认生成与销售回写。
- 新运行状态弹窗及运行中心。
- 01/03 共用 OFI 索引，02/04/05 共用 OFI 索引，07 使用 OFJ。
- 引入可扩展 Exchange Stream 注册表。
- 引入阿里云 OSS / 本地归档双模式存储，整批原始字节同步归档并提供签名下载接口。
- 新增“协议与配置 → 对象存储”状态页。

后续阶段重点：批次 ZIP、错误注入中心、更多协议文件类型、运行持久化与审计。

## 1. 改造目标

将当前以“逐步理解销售系统与 TA 交互”为目的的教学 Demo，改造成可供团队长期使用的基金业务测试数据工厂。

系统应当让使用者：

1. 保留并维护模拟客户、账户、交易账户、银行卡、余额、持仓等业务前置数据。
2. 按真实业务日准备开户、申购、赎回等多种业务记录。
3. 自动将同一业务日、同一发送方、同一接收方的数据按中登协议封批。
4. 在自动生成基础数据的同时，允许逐条、批量、字段级修改。
5. 生成正常数据、TA 业务失败数据、协议字段错误、文件结构错误和流程错误。
6. 自动执行 T、T+n 流程，但通过独立运行详情页展示状态流转、日志和产物。
7. 支持下载单个 TXT 或完整批次 ZIP。
8. 将生成的原始字节文件上传至阿里云 OSS，供上线环境保存和下载。
9. 后续新增文件类型、业务代码和非标准流程时，不需要重写整个工作台。

## 2. 已确认的产品决策

- 保留模拟客户能力；客户是业务记录生成的上游数据源。
- 保留独立字段编辑弹窗，但降低普通操作中的弹窗数量。
- 正常流程自动运行，人只负责数据准备、例外配置和必要的确认。
- TA 模拟器继续存在，但不再占用一级导航；其状态和数据进入运行详情的“高级调试”。
- 第一版直接接入阿里云 OSS，不先实现 Cloudflare R2。
- 保留现有酒红色品牌气质，但完全重做布局、字号、留白、层级和操作方式。
- 结构错误是真实联调中可能发生的接口/传输事故，必须支持生成和验证。
- 业务错误和结构错误严格分层：业务错误可以跑完 TA 链路；结构错误默认在接收校验处失败。

## 3. 协议与批次概念校正

### 3.1 四级模型

系统内部和 UI 必须统一使用以下术语，避免继续混用“文件”和“数量”。

| 层级 | 示例 | 定义 |
|---|---|---|
| 运行 Run | `RUN-20260920-018` | 用户发起的一次数据生产任务，可跨 T、T+1 |
| 交换批次 Package | T 日申请批次 | 同一方向、业务日、索引类别下的一组文件 |
| 物理文件 Artifact | `OFD_305_27_20260920_03.TXT` | 实际上传、下载和校验的 TXT |
| 业务记录 Record | 一条 `022` 申购 | 数据文件中的一条定长记录 |

UI 中不得再单独显示含义不明的“数量”，必须显示为：

```text
1 个批次 · 3 个数据文件 · 426 条业务记录
```

### 3.2 T 日销售向 TA 发送

典型结构：

```text
OFI_305_27_20260920.TXT
OFD_305_27_20260920_01.TXT
OFD_305_27_20260920_03.TXT
```

- `01` 汇集当日账户类申请；记录通过 `BusinessCode` 区分 001–009 等业务。
- `03` 汇集当日交易类申请；记录通过 `BusinessCode` 区分 020、022、024、029 等业务。
- OFI 是索引 TXT，内容列出本批次包含的物理数据文件名；它不嵌入数据文件内容。
- 没有对应记录的文件类型默认不生成；“空批必发”等规则由交换流配置决定。

### 3.3 T+n TA 向销售返回

典型确认批次：

```text
OFI_27_305_20260921.TXT
OFD_27_305_20260921_02.TXT
OFD_27_305_20260921_04.TXT
OFD_27_305_20260921_05.TXT
```

基金行情属于另一交换流：

```text
OFJ_27_305_20260921.TXT
OFD_27_305_20260921_07.TXT
```

### 3.4 当前实现需要纠正的协议问题

当前 `INDEX_KIND_BY_TYPES` 将 `02/04/05` 映射为 OFJ、将 `07` 映射为 OFI，与本地 V2.2 协议不一致。

改造后索引类型不能只由单个 `fileType` 推导，而应由“交换流 Exchange Stream”决定，例如：

```js
salesApplication: {
  direction: 'sales-to-ta',
  indexKind: 'OFI',
  fileTypes: ['01', '03', '13', '23', 'R1'],
  emptyIndexRequired: true
}

taConfirmation: {
  direction: 'ta-to-sales',
  indexKind: 'OFI',
  fileTypes: ['02', '04', '05', '06', '09', '12', '24', '26', 'R2']
}

taMarketData: {
  direction: 'ta-to-sales',
  indexKind: 'OFJ',
  fileTypes: ['07', '08', '21']
}
```

### 3.5 数据文件分片

协议支持同一文件类型分成多个物理文件：

```text
OFD_305_27_20260920_03_001.TXT
OFD_305_27_20260920_03_002.TXT
```

数据工厂需要提供以下配置：

- 不分片。
- 按最大记录数分片。
- 按最大文件字节数分片。
- 为异常测试强制产生错误或不连续的分片序号。

所有实际文件名必须写入同一个索引文件。

## 4. 新的信息架构

一级导航调整为：

1. **数据工厂**：准备客户和当日业务、字段编辑、批次预览、开始生成。
2. **运行中心**：查看自动化任务、步骤状态、错误、日志、TA 调试数据。
3. **文件仓库**：查看本地/OSS 产物、校验状态、单文件和整批下载。
4. **客户与资产**：保留模拟客户、账户、资金、持仓和历史活动。
5. **协议与配置**：协议版本、机构、产品、日期规则、错误模板、OSS 配置状态。

“广发基金 TA（模拟）”不再作为一级菜单。原 TA 操作和数据查询迁入：

```text
运行详情 → 高级调试 → TA 数据 / 强制返回码 / 原始处理日志
```

## 5. 核心 UI 方案

### 5.1 视觉原则

目标是“大气、简洁、专业、有 AI 工具感”，不做传统后台系统的密集表格堆叠。

- 保留酒红色作为品牌主色，但主色只用于关键动作、当前状态和少量大色块。
- 页面背景继续采用暖灰/米白，内容卡片使用白色。
- 全局正文基准字号提升至 15–16px。
- 页面主标题 32–36px，模块标题 20–24px。
- 控件高度以 44–48px 为主，主按钮 48–52px。
- 桌面内容最大宽度约 1440px，增加左右留白。
- 卡片减少描边，使用留白、浅色分区和轻阴影形成层级。
- 表格仅用于真正需要横向比较的文件/记录数据。
- 普通用户看到业务语言；英文协议字段名作为辅助信息展示。
- 参考 Linear 的克制层级、Stripe Dashboard 的信息组织和现代 AI 工作台的自然语言入口，但保留基金业务系统应有的可信与审慎。

建议设计令牌：

```css
--brand-900: #5e0f0b;
--brand-700: #8f1d16;
--brand-600: #ad2a20;
--brand-050: #fff4f2;
--surface: #ffffff;
--canvas: #f6f3ef;
--text-strong: #211d1c;
--text: #4f4946;
--text-muted: #817975;
--success: #247a55;
--warning: #a66b16;
--danger: #b42318;
--radius-card: 18px;
--radius-control: 12px;
```

### 5.2 数据工厂首页

页面分成“今日业务池”和“生成计划”两部分，不再把所有过程按钮摆出来。

```text
┌─────────────────────────────────────────────────────────────────┐
│ 数据工厂                                      业务日 2026-09-20 │
│ 准备今天的业务，系统会按中登协议自动封批                         │
├───────────────────────────────────────┬─────────────────────────┤
│ 今日业务池                            │ 本次生成计划            │
│ [＋添加业务] [批量生成] [导入]        │                        │
│                                       │ 账户申请  26 条         │
│ 001 开户  李雨桐          待封批  >   │ 交易申请 400 条         │
│ 022 申购  王浩然 ¥10,000  已修改  >   │ 错误记录  18 条         │
│ 024 赎回  陈思琪 200份     正常    >   │                        │
│                                       │ 输出：OFI / 01 / 03     │
│ [筛选] [全选] [批量编辑字段]          │ [预览批次]              │
│                                       │ [生成并运行]            │
└───────────────────────────────────────┴─────────────────────────┘
```

页面只保留一个主要动作“生成并运行”。封批、发送、TA 接收、日期推进和确认文件生成由编排器完成。

### 5.3 添加业务弹窗

独立弹窗继续保留，用于控制业务数据：

1. 选择一个或多个模拟客户。
2. 选择业务类型。
3. 填写业务核心字段。
4. 设置生成条数与简单变化规则。
5. 加入“今日业务池”，暂不立即封批。

弹窗首屏只显示业务人员理解的核心字段；“全部协议字段”进入记录编辑器。

### 5.4 记录字段编辑器

原协议编辑弹窗保留并升级，包含四个页签：

1. **业务字段**：基金、金额、份额、原申请等核心字段。
2. **全部协议字段**：完整字段表，支持必填、条件必填、选填筛选。
3. **错误注入**：业务错误、字段错误、文件错误关联设置。
4. **原始记录**：GB18030 编码前文本、字节位置、定长预览。

字段来源需要清晰标识：

- `客户数据`
- `业务输入`
- `系统生成`
- `规则计算`
- `人工覆盖`
- `错误注入`

系统字段默认锁定，但可显式“解锁修改”。每次覆盖保存原值、现值和修改人。

### 5.5 批次预览

封批前展示完整树形结构：

```text
T 日申请批次 · 305 → 27
├── OFI_305_27_20260920.TXT
├── 01 账户申请 · 26 条
│   ├── 001 开户 · 20 条
│   ├── 003 资料修改 · 4 条
│   └── 004 冻结 · 2 条
└── 03 交易申请 · 400 条
    ├── 022 申购 · 260 条
    ├── 024 赎回 · 100 条
    └── 029 分红方式 · 40 条
```

支持：

- 打开任意记录进行字段编辑。
- 批量覆盖选中记录的字段。
- 将记录移出本次封批并保留在待处理池。
- 预览物理文件名、字段数、记录数和估算字节数。
- 选择分片规则。
- 生成前协议校验。

### 5.6 运行详情

运行详情使用独立全屏页或右侧宽抽屉，不使用连续弹窗：

```text
准备数据 → T 日封批 → TA 接收 → T+n 处理 → 确认封批 → OSS 上传
```

每一步状态：

- `waiting`
- `running`
- `succeeded`
- `failed`
- `skipped`
- `stopped_by_design`

结构错误批次被 TA 拒绝时，应显示为“预期失败”，不把整个测试运行误判为系统故障。

### 5.7 文件仓库

默认按运行/业务日展示，而不是平铺所有文件：

```text
RUN-20260920-018
T 日申请批次        3 个 TXT    协议校验通过
T+1 确认批次        4 个 TXT    含 18 条业务失败
```

展开后支持：

- 下载单个原始 TXT。
- 下载完整批次 ZIP。
- 查看索引与数据文件的对应关系。
- 查看 SHA-256、字节数、编码、生成时间和 OSS 状态。
- 查看正常/错误标签与错误注入说明。
- 复制短期下载链接。

## 6. 目标代码结构

### 6.1 前端拆分

当前 `web/src/main.jsx` 承载过多状态和页面，需要拆分：

```text
web/src/
├── app/
│   ├── App.jsx
│   ├── routes.jsx
│   └── api.js
├── components/
│   ├── AppShell/
│   ├── DataTable/
│   ├── FieldEditor/
│   ├── StatusTimeline/
│   └── FileTree/
├── features/
│   ├── data-factory/
│   │   ├── DataFactoryPage.jsx
│   │   ├── BusinessPool.jsx
│   │   ├── AddBusinessDialog.jsx
│   │   ├── RecordEditorDialog.jsx
│   │   ├── BatchPreviewDrawer.jsx
│   │   └── BulkFieldEditor.jsx
│   ├── runs/
│   ├── artifacts/
│   ├── customers/
│   └── settings/
├── styles/
│   ├── tokens.css
│   ├── reset.css
│   └── utilities.css
└── main.jsx
```

不要求本阶段引入大型 UI 框架；优先复用 React、Lucide 和现有 CSS，但建立统一设计令牌和组件规范。

### 6.2 后端服务边界

建议在现有 monorepo 中新增编排与产物服务，不强制拆成独立容器：

```text
packages/
├── protocol/        协议字段、编码、解析、验证
├── scenarios/       业务定义与流程定义
├── error-engine/    业务/字段/文件/流程错误注入
├── artifacts/       文件清单、ZIP、校验和
├── storage/         本地与阿里云 OSS 适配器
└── transport/       TA 交换传输，本地/SFTP

services/sales/src/
├── routes/
├── domain/
├── orchestration/
└── repositories/
```

OSS 是产物仓库，不取代销售与 TA 间的 SFTP 交换语义。两者职责不同：

- `transport`：模拟真实机构间交换与接收。
- `storage`：保存、下载、归档测试产物。

## 7. 协议注册表改造

### 7.1 Schema Registry

将字段定义从单一静态对象升级为带版本和 profile 的注册表：

```js
registry.getFileSchema({
  protocol: 'OFD',
  version: '22',
  profile: 'FUND',
  fileType: '03'
})
```

支持：

- V2.1、V2.2。
- 基金和后续兼容协议 profile。
- 当前字段与历史字段兼容。
- 从 `OFD_22.ini` 导入/校验定义的脚本。
- 字段中文名、英文名、类型、字节长度、小数位、必填规则、业务条件。

### 7.2 Business Registry

业务定义至少包含：

```js
{
  code: '022',
  name: '申购',
  applicationFileType: '03',
  confirmationCode: '122',
  confirmationFileType: '04',
  inputs: [],
  requirements: {},
  prerequisites: [],
  taHandler: 'purchase',
  supportedErrors: []
}
```

账户类和交易类业务统一注册，不再分别硬编码在前端、销售服务和 TA 服务。

### 7.3 Exchange Stream Registry

新增交换流定义，解决 OFI/OFJ 与文件类型的正确组合、方向和空批规则。

### 7.4 Scenario Registry

一个场景可以有不同流程，不能假设全部都是固定 T/T+1：

```yaml
id: purchase-standard
name: 普通申购
steps:
  - id: prepare
    at: T
    action: prepare_records
  - id: send_application
    at: T
    action: seal_exchange_stream
    stream: salesApplication
  - id: receive_application
    at: T
    action: ta_receive
  - id: settle
    at: T+1
    action: ta_process
  - id: send_confirmation
    at: T+1
    action: seal_exchange_stream
    stream: taConfirmation
```

执行器支持条件步骤、跳过、重试、预期失败和相对业务日。

## 8. 数据准备与人工覆盖

### 8.1 Draft Record

用户添加业务后先创建草稿记录，不立即写入正式订单/申请状态：

```text
DRAFT → READY → SEALED → SENT → IMPORTED → PROCESSED → CONFIRMED
```

草稿保存：

- 业务类型和所属客户。
- 标准生成值。
- 字段覆盖值。
- 字段来源。
- 绑定的错误规则。
- 是否进入下一次封批。

### 8.2 单条编辑

- 支持编辑所有协议字段。
- 修改后实时进行“正确文件模式”校验。
- 若选择“故意错误”，允许保存不符合标准的值，但必须显示错误标签。
- 始终保留原始值，支持恢复字段和恢复整条记录。

### 8.3 批量编辑

支持：

- 设置固定值。
- 从候选值随机选择。
- 数字范围随机。
- 按序号递增。
- 按比例应用。
- 只覆盖空值。
- 只覆盖满足条件的记录。

批量操作必须先展示预计影响记录数和字段差异摘要。

## 9. 错误数据引擎

### 9.1 业务错误

文件结构完全合法，由 TA 处理后返回非 `0000` 返回码。

示例：

- 重复开户。
- 身份证或账户校验失败。
- 余额不足。
- 账户冻结。
- 基金状态不允许交易。
- 申购金额低于下限或超过上限。
- 赎回份额超过持仓。
- 原申请不存在。

业务错误既支持由业务状态自然触发，也支持显式指定 TA 返回码。强制返回码必须在运行记录中标记，避免被误认为自然计算结果。

### 9.2 字段错误

字段层错误仍保持整体文件尽可能可读取，例如：

- 必填字段空。
- 枚举值非法。
- 业务代码与字段组合不匹配。
- 日期格式或日期关系非法。
- 金额/份额精度非法。
- 机构代码、基金代码或账户不存在。

### 9.3 文件结构错误

在标准编码完成后对字节产物执行 mutation：

- 删除或替换文件头尾标识。
- 修改字段数、字段名或字段顺序。
- 修改声明记录数。
- 截断某条定长记录。
- 插入多余字节。
- 将 CRLF 改为 LF。
- 使用 UTF-8 代替 GB18030。
- 索引漏列、多列或拼错文件名。
- 创建人、接收人、日期、版本不一致。
- 分片序号缺失、重复或不连续。

文件 mutation 只能作用于生成产物，不能污染业务数据库中的标准字段值。

### 9.4 流程错误

- 重复投递同一批次。
- T 日直接处理必须 T+1 的申请。
- 确认先于申请。
- 确认引用不存在的申请。
- 使用错误业务日。
- 缺少依赖批次。

### 9.5 错误模板结构

```json
{
  "id": "index-missing-data-file",
  "layer": "file",
  "target": "index",
  "label": "索引未声明 03 文件",
  "mutation": "remove_index_entry",
  "parameters": { "fileType": "03" },
  "expectedOutcome": "TA_FILE_REJECTED"
}
```

## 10. 数据模型调整

建议在销售 MySQL 增加以下表；TA Oracle 继续保存 TA 业务状态。

### 10.1 `runs`

- `id`
- `run_no`
- `scenario_id`
- `protocol_version`
- `base_business_date`
- `status`
- `expected_outcome`
- `created_by`
- `created_at`
- `started_at`
- `finished_at`
- `config_json`

### 10.2 `run_steps`

- `id`
- `run_id`
- `step_key`
- `step_type`
- `relative_day`
- `status`
- `attempt`
- `input_json`
- `output_json`
- `error_code`
- `error_detail`
- `started_at`
- `finished_at`

### 10.3 `draft_records`

- `id`
- `business_date`
- `customer_id`
- `business_code`
- `file_type`
- `status`
- `base_values_json`
- `overrides_json`
- `field_sources_json`
- `error_rules_json`
- `created_at`
- `updated_at`

### 10.4 `exchange_packages`

- `id`
- `run_id`
- `package_no`
- `exchange_stream`
- `direction`
- `business_date`
- `creator_code`
- `receiver_code`
- `index_kind`
- `status`
- `record_count`
- `data_file_count`
- `relative_path`
- `created_at`

### 10.5 `artifacts`

- `id`
- `package_id`
- `artifact_kind`：`index` / `data` / `archive` / `manifest`
- `file_type`
- `file_name`
- `sequence_no`
- `record_count`
- `byte_size`
- `encoding`
- `sha256`
- `validation_status`
- `validation_report_json`
- `local_path`
- `oss_object_key`
- `storage_status`
- `created_at`

### 10.6 `record_overrides`（可选独立表）

若 JSON 审计不足，再将人工覆盖拆表记录字段级变更历史。

## 11. API 设计

### 11.1 数据工厂

```text
GET    /api/factory/pool?businessDate=
POST   /api/factory/records
POST   /api/factory/records/bulk
GET    /api/factory/records/:id
PATCH  /api/factory/records/:id
POST   /api/factory/records/:id/reset
POST   /api/factory/preview-package
POST   /api/factory/runs
```

### 11.2 运行中心

```text
GET    /api/runs
GET    /api/runs/:id
GET    /api/runs/:id/steps
POST   /api/runs/:id/retry
POST   /api/runs/:id/continue
POST   /api/runs/:id/cancel
```

`continue` 用于结构错误被预期拒绝后，用户选择强制执行后续实验步骤，不表示绕过解析器安全校验。

### 11.3 文件仓库

```text
GET    /api/packages
GET    /api/packages/:id
GET    /api/artifacts/:id/inspect
GET    /api/artifacts/:id/download
GET    /api/packages/:id/download.zip
POST   /api/artifacts/:id/presign
```

### 11.4 TA 调试

原 TA API 收口为内部编排调用；前端只通过运行详情访问必要的只读数据和明确的测试操作。

## 12. 阿里云 OSS 方案

### 12.1 接入方式

新增 `@fund-demo/storage` package，使用官方 `ali-oss` Node.js SDK。

```text
STORAGE_MODE=local|oss
OSS_REGION=
OSS_BUCKET=
OSS_ENDPOINT=
OSS_ACCESS_KEY_ID=
OSS_ACCESS_KEY_SECRET=
OSS_STS_ROLE_ARN=
OSS_PREFIX=fund-data-factory
OSS_SIGNED_URL_TTL=600
```

本地开发默认 `local`；部署环境使用 `oss`。

生产环境优先使用 RAM 角色或 STS 临时凭证，避免长期 AccessKey 写入镜像、前端或仓库。

### 12.2 Object Key

```text
{prefix}/{environment}/{yyyy}/{mm}/{dd}/{runNo}/{direction}/{packageNo}/{fileName}
```

示例：

```text
fund-data-factory/prod/2026/09/20/RUN-018/sales-to-ta/PKG-001/OFD_305_27_20260920_03.TXT
```

### 12.3 上传原则

- 保存编码完成且经过 mutation 后的原始 `Buffer`，禁止转成字符串再上传。
- 上传后保存 ETag、SHA-256、字节数和 OSS Object Key。
- 单文件上传失败不将整个运行错误地标为业务失败，应进入产物上传重试。
- ZIP 使用原始文件字节创建，文件名和目录不得改变协议文件名。
- 存储桶设为私有。
- 下载通过后端鉴权后返回短期签名 URL，或由后端代理流式下载。
- CORS 只允许正式站点域名。
- 配置生命周期，例如开发环境 30 天、测试环境 90 天；重要基准数据可单独标记保留。

### 12.4 安全边界

- 默认只允许生成格式真实但身份虚构的数据。
- 页面持续显示“模拟数据”环境标记。
- 身份证、银行卡、手机号等字段在列表中脱敏；编辑弹窗按权限显示。
- 不允许公共读 Bucket。
- 记录下载审计：用户、时间、运行、批次、文件。
- AccessKey 和 STS 凭证不得进入前端或数据库业务表。

## 13. 编排器设计

### 13.1 执行模式

- `AUTO`：正常流程自动执行到完成。
- `PAUSE_AT_T_PLUS_N`：到业务日边界暂停，供用户检查后继续。
- `GENERATE_ONLY`：只生成文件和上传 OSS，不写入模拟 TA。
- `FAULT_TEST`：按预期失败规则运行并记录实际结果。

### 13.2 幂等性

- 每个运行和步骤都有稳定 ID。
- 封批操作以 `run + stream + businessDate + packageNo` 幂等。
- OSS Object Key 稳定；重复上传需校验 SHA-256。
- TA 接收以方向、相对路径、文件类型和文件哈希联合判重。
- 重试不得重复扣减余额、增加持仓或重复生成确认。

### 13.3 状态推送

第一版可使用短轮询获取运行状态；后续可切换 SSE。不要为了实时动画优先引入复杂 WebSocket 基础设施。

## 14. 实施阶段

### Phase 0：基线保护与协议校正

- [ ] 为现有流程补充端到端基线测试。
- [ ] 固化一套 01/03/02/04/05/07 golden files。
- [ ] 引入 Exchange Stream Registry。
- [ ] 修正 OFI/OFJ 映射。
- [ ] 增加多数据文件索引和同类型分片测试。
- [ ] 明确 V2.2 空批规则并建立测试。

验收：协议测试能够证明一个索引声明多个物理数据 TXT，07 与确认批次使用正确索引类别。

### Phase 1：前端视觉基础与应用骨架

- [ ] 建立 tokens、字体、间距、色彩和组件规范。
- [ ] 将 `main.jsx` 拆成路由和 feature 模块。
- [ ] 完成新 App Shell 与一级导航。
- [ ] 保留客户资产和协议详情能力，迁移到新布局。
- [ ] 完成响应式桌面和 1024px 布局。

验收：视觉密度明显降低，正文不小于 15px；旧功能无回归。

### Phase 2：模拟客户与业务草稿池

- [ ] 迁移现有模拟客户能力。
- [ ] 新建 `draft_records`。
- [ ] 实现添加业务弹窗。
- [ ] 实现今日业务池筛选、选择、排除和删除草稿。
- [ ] 现有订单/账户申请 API 迁移到草稿提交模型。

验收：可以给多个模拟客户添加混合的账户和交易业务，但不会立即生成 TXT。

### Phase 3：字段级编辑与批量覆盖

- [ ] 实现四页签记录编辑器。
- [ ] 展示字段来源和字节规则。
- [ ] 支持单字段解锁、覆盖和恢复。
- [ ] 支持批量字段编辑。
- [ ] 增加记录级校验结果。

验收：用户可以修改任意允许的协议字段，并看到最终定长记录预览。

### Phase 4：真实封批与批次预览

- [ ] 实现 Exchange Package Builder。
- [ ] 将同日 01 和 03 纳入同一销售申请批次。
- [ ] 将 02、04、05 纳入同一 TA 确认批次。
- [ ] 支持同类型文件分片。
- [ ] 实现批次树预览和物理文件统计。
- [ ] 为每个 artifact 计算 SHA-256。

验收：一个运行可输出协议正确的索引文件和多个数据 TXT，索引文件名清单完全匹配。

### Phase 5：错误引擎

- [ ] 实现业务错误规则。
- [ ] 实现字段错误规则。
- [ ] 实现编码后的文件 mutation pipeline。
- [ ] 实现流程错误步骤。
- [ ] 建立内置错误模板库。
- [ ] 支持错误分布和指定记录注入。

验收：每种错误都有可重复测试，且实际校验/TA 结果与 `expectedOutcome` 一致。

### Phase 6：自动流程与运行中心

- [ ] 新建 runs/run_steps。
- [ ] 实现场景定义与步骤执行器。
- [ ] 自动处理 T、T+n 日期。
- [ ] 实现运行时间线、日志和重试。
- [ ] 将 TA 页面迁入高级调试。
- [ ] 区分系统失败与预期测试失败。

验收：普通成功场景从“生成并运行”开始，无需逐步点击即可完成全部链路。

### Phase 7：OSS 与文件仓库

- [ ] 新增 `@fund-demo/storage`。
- [ ] 实现 LocalStorageAdapter 和 AliyunOssAdapter。
- [ ] 私有 Bucket 上传原始 TXT。
- [ ] 实现短期签名下载。
- [ ] 实现单文件下载和整批 ZIP。
- [ ] 增加上传重试、生命周期和下载审计。
- [ ] 完成文件仓库页面。

验收：线上运行的所有文件都能在 OSS 找到，并可从系统安全下载；本地开发不依赖 OSS 凭证。

### Phase 8：协议扩展能力

- [ ] 编写 `OFD_22.ini` 导入/比对工具。
- [ ] 将账户与交易业务迁入 Business Registry。
- [ ] 支持新增文件类型的注册流程。
- [ ] 支持不同场景的非固定步骤图。
- [ ] 为新增业务提供模板与开发文档。

验收：新增一个协议已有但系统尚未支持的业务时，主要工作集中在注册表、处理器和测试，不需要修改工作台布局。

## 15. 测试计划

### 15.1 协议单元测试

- GB18030 中文字节长度。
- 数值小数位和补零。
- CRLF。
- 文件头、字段名、记录数、文件尾。
- 多文件索引。
- 分片命名和索引声明。
- V2.1/V2.2 profile 兼容。

### 15.2 错误测试

每个错误模板至少验证：

1. 生成产物确实包含目标错误。
2. 校验器给出预期错误代码。
3. TA 接收结果符合预期。
4. 未被选中的记录或文件不受污染。

### 15.3 业务链路测试

- 同日多客户、多账户业务、多交易业务进入同一批次。
- 01/03 同批索引。
- 02/04/05 同批索引。
- 业务错误返回对应 TA ReturnCode。
- 重试不重复扣款或记份额。
- T、T+1、T+2 场景。

### 15.4 OSS 集成测试

- 上传后字节与本地 SHA-256 一致。
- GB18030 文件下载后不发生转码。
- 私有对象不能匿名读取。
- 签名 URL 到期失效。
- ZIP 内文件字节与单文件下载一致。
- 上传中断可重试且不产生错误完成状态。

### 15.5 UI 测试

- 业务池 1、100、1000 条记录时可用。
- 字段编辑、批量编辑、撤销覆盖。
- 错误标签与预期结果清晰。
- 运行中、成功、预期失败、系统失败状态。
- 1440px、1024px 和移动窄屏基础适配。

## 16. 数据迁移与兼容

- 保留现有客户、订单、持仓和历史批次数据。
- 新表采用增量 migration，不重置现有数据库卷。
- 旧批次读取时转换为新的 Package/Artifact 只读视图。
- 新批次全部使用修正后的 Exchange Stream 规则。
- 对历史上错误的 OFI/OFJ 命名不做静默改写，页面标记为 `legacy`。
- 旧 API 在前端迁移完成前保留兼容层，最后再清理。

## 17. 明确不在首期做的事项

- 不一次性实现全部 62 个业务场景。
- 不接真实生产客户数据。
- 不把模拟 TA 建设成生产级 TA。
- 不实现复杂组织权限体系；首期只预留用户和审计字段。
- 不引入 BPMN 等重型工作流引擎。
- 不用 AI 自动修改不可解释的协议字段；自然语言入口只生成可审阅的结构化计划。

## 18. 完成定义

V2 首个可交付版本必须同时满足：

1. 模拟客户能力完整保留。
2. 用户能为同一业务日准备混合账户和交易业务。
3. 任意记录可进入独立弹窗修改完整协议字段。
4. 01 和 03 能按同一销售申请批次生成；02、04、05 能按同一确认批次生成。
5. OFI/OFJ、文件名、索引清单和分片规则符合 V2.2。
6. 能生成并区分业务错误、字段错误、结构错误和流程错误。
7. 正常场景只需一次启动操作即可自动跑完整个 T+n 流程。
8. 运行详情能解释每一步发生了什么。
9. 单个 TXT 和批次 ZIP 均可下载。
10. 原始文件成功写入私有阿里云 OSS，下载不改变原始字节。
11. 新 UI 字体、留白和信息层级达到新的视觉规范，不再呈现密集按钮操作台。
12. 现有协议测试、业务 smoke test 和新增 OSS/错误测试全部通过。
