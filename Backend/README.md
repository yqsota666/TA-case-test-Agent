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
