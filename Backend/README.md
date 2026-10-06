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
