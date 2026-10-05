# Case 后端数据库

数据库固定为 `sales_platform_v2`，MySQL 8.4 / InnoDB / utf8mb4。此目录来自已建立的新平台，001–006 SQL 保持原始字节及迁移校验和；后续变更必须新增迁移。

本分支只包含后端底座。迁移范围、Agent 缺口及看板讨论见仓库根目录 `docs/Case-Agent后端底座与讨论.md`。

## 隔离边界

- workspace 属于有效登录用户；chat 是 case；run 是一次执行。
- 运行业务表保存 workspace/chat/run，组合外键限制跨 case/run 的客户、账户、申请、确认、持仓和协议间接引用。
- 读取范围由会话认证及服务端解析决定，客户端不能覆盖 owner 或 scope。MySQL 没有原生行级安全，读取依赖这些访问入口。
- 测试证件、交易账号和申请号在实际 TA 的命名空间内限制重复，防止共享 TA 把不同 case 合为同一账户。这不等于隔离远端 TA 的全局基金参数或业务日。
- 物理回传包可以包含多个 case 的记录。按申请号/账户识别原归属，未知或冲突记录保留在 workspace 隔离区；当前打开的 chat 不决定归属。
- 共享包的原始字节不能经单 case 下载入口泄露其他 case；当前下载会核对文件包及记录归属。
- 目标份额和 TA 确认持仓分开；05 保存快照并对账，不自动覆盖实际持仓。原始文件字节与业务效果同事务保存。
- 确认与持仓效果分别幂等；运行数据库用户只有新库 DML 权限，不具有旧库读取或 DDL 权限。

## 六个既有迁移

| 迁移 | 用途 |
|---|---|
| 001 | 身份、通道、case/run、工作流、模拟数据、申请、确认、持仓和交换基础 |
| 002 | 原申请、原确认和目标账户的显式协议引用 |
| 003 | 原始文件字节 |
| 004 | TA 通道/业务日的汇总编号分配 |
| 005 | 可选资料库及导入 run 的独立快照 |
| 006 | 兼容已有模拟账号的初始化标记 |

资料库可作为显式导入来源；新 case 没有强制导入前置条件。模拟账号标记不代表真实 TA 业务数据。

## 使用已有库

兼容服务要求已有完整的 `sales_platform_v2` 数据库。本次目录拆分保留SQL用于核对历史结构，未提供旧Docker初始化或旧测试脚本，不要执行已移除的 `db:platform:init/status` 命令。

在仓库根目录配置 `PLATFORM_DB_HOST`、`PLATFORM_DB_PORT`、`PLATFORM_DB_USER`、`PLATFORM_DB_PASSWORD`、`PLATFORM_DB_NAME=sales_platform_v2` 后执行：

```sh
cd Backend/legacy
pnpm install --ignore-workspace --frozen-lockfile
PLATFORM_PORT=8084 AGENT_ENABLED=0 pnpm start
```

`PLATFORM_ENV_FILE` 可指向本机已有配置；无需将凭据复制进仓库。新Case API使用独立的 `ta_case_agent_local` 库，其迁移入口为 Backend 的 `pnpm db:migrate`，不能用于初始化兼容库。首次部署兼容库须按既有部署流程配置完整schema，不能只应用此目录历史001–006就认定已包含全部后续结构。

## 本次分支验证（2026-09-29）

- 6 个迁移文件校验和与已应用库一致，没有执行 DDL。
- 67 项鉴权、数据库隔离、资料导入、手动动作、文件往返及双连接并发测试通过。
- 新协议包 13 项，原 demo 协议和存储回归 13 项，合计 26 项通过。
- 核对数据库全部 37 张表：测试前后记录数一致。
- 主流程测试事务回滚；并发测试仅按明确的临时账户/workspace ID 清理。

Agent 调度、跨 case 的统一筛选 API、测试预期判定和完整归档 API 尚未实现；实际内网 TA 联调尚未完成。
