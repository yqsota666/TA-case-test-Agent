# TA Case Test Agent · Frontend

当前 Agent 平台的 React 工作台，包含项目与 Case 导航、自然语言对话、方案审阅和手动编辑、两次确认、准备数据、申请文件、TA 回传、结果查看及数据/文件检索。页面使用真实 Case API，历史玻璃材质研究页不作为产品启动入口。

完整截图、操作流程、后端配置与能力边界见[项目 README](../README.md)。

## 安装与运行

使用 Node.js 24 和 pnpm 11.25.0。在仓库根目录运行：

```sh
pnpm --dir Frontend install --frozen-lockfile
FRONTEND_PORT=5199 CASE_API_TARGET=http://127.0.0.1:3106 \
  pnpm --dir Frontend exec vite --host 127.0.0.1 --port 5199 --strictPort
```

打开 [Agent 工作台](http://127.0.0.1:5199/)。先按项目 README 配置 MySQL、迁移和 Case API；登录与业务通道须来自当前运行环境，克隆源码不会复制本机验收会话或数据。端口被占用时选择空闲端口并调整环境变量。

`FRONTEND_PORT` 与实际 Vite 端口须一致，代理才能正确处理本地请求 Origin。`CASE_API_TARGET` 为 Case API 地址；`/live-api` 转发至后端 `/api`。当前 npm scripts 和 Vite 配置还保留历史默认端口，建议按上面的显式命令启动。

## 构建与界面检查

```sh
pnpm --dir Frontend build
```

单元测试入口位于 `src/*.test.js` 与 `test/*.test.js`，浏览器专项位于 `scripts/*.browser.mjs`。`test/*.html` 是合成组件验收入口，不会代替真实模型或数据库业务验收。浏览器脚本的目标端口和依赖按各脚本配置，勿对正在验收的 Case 随意运行写入测试。

当前四个外观为蓝色玻璃、灰白、暖灰、深灰侧栏；默认使用深灰侧栏。布局支持窄屏，方案/数据/文件详情按空间切换为侧边面板或全屏。截图示例见[截图目录](../docs/images/agent/README.md)。
