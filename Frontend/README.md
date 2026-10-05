# Frontend

当前 Case／Agent 本地验收前端，来源 gf-local-frontend（2026-10-05）。与 Backend 分开安装和构建。

```sh
cd Frontend
pnpm install --frozen-lockfile
pnpm dev
# 构建
pnpm build
```

本地地址 http://127.0.0.1:5188/workflow。`/new-api` 代理到 Backend Case API 3102，`/api` 代理到 Backend 的 legacy 兼容服务8084。验收桥接可通过进程环境 CASE_TEST_SESSION 提供新后端会话，不写入源文件。

根地址和/workflow均进入Case工作流，历史销售／模拟TA Demo入口不包含在此应用中。前端无需导入 Backend 源文件；node_modules 在本目录独立安装。

旧前端流程标签仍由兼容服务提供，与新后端状态尚未完全统一。本次只完成目录分离，没有宣称所有旧API已经迁移。
