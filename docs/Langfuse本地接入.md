# Langfuse 本地接入

本项在最新 Case 平台基础上增加服务端观测，不改变业务阶段、人工确认、C 端界面或 token 账本语义。默认关闭，通过 `CASE_OBSERVABILITY_ENABLED=1` 开启。

## 当前范围

- HTTP 操作根 trace，关联 Chat / Case；每次恢复是独立请求。普通 GET/HEAD 查询成功且没有图或模型执行时不导出；失败查询、图/模型执行及非查询操作完整保留。并发请求的过滤状态独立，响应中的 `X-Trace-Id` 不代表该请求必然上传。
- 现有 LangGraph 图调用使用每次调用独立的回调，绑定请求上下文，避免并发串链。
- 模型 generation 记录模型、用途、attempt、账本消费记录、经过认证的 workspace / user 引用与实际 token；错误或不合法 usage 保留 UNCERTAIN。
- GraphInterrupt 是正常等待，不标记成失败。
- 不采集聊天正文、图片、图状态、TA 文件原文、Cookie 或模型密钥；错误只导出受限失败码。现成看板用于内部管理员，不提供客户直连权限。

本项尚不包含 C 端 Faro、浏览器性能/回放、基础设施指标、业务管理权限页面或全套告警。技术 traces 不替代业务确认与审计记录。

## SDK 配置

在后端进程环境设置 `CASE_OBSERVABILITY_ENABLED`、`LANGFUSE_BASE_URL`、`LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`。启用时需要完整配置。启动 API 时初始化 OpenTelemetry；停机时关闭导出器。导出超时 2 秒，异步批量上报；看板不可用不改变模型/业务调用结果。导出失败时观测可能丢失，不能声称已入库。

凭证放环境变量或本机忽略文件，不提交仓库。Sophnet 密钥仍只从钥匙串进入进程内存。安装后端依赖使用 `pnpm install --frozen-lockfile`；protobufjs 构建脚本显式禁止，现有运行与测试验证不需要其构建脚本。

## 当前云端与历史本机部署

当前使用 Langfuse Cloud 欧洲区 `https://cloud.langfuse.com`；本地 Docker 容器、专属卷和镜像已移除。Keys 保存在本机忽略的 runtime 配置。云端新组织使用 `/api/public/v2/observations` 加有界时间范围查询，旧 traces 查询 API 不可用。本机上传使用已有代理。下面保留首次本地部署记录，不作为当前启动入口。

### 历史本机部署与验收入口

独立接入工作树：`/Users/apple/.codex/worktrees/langfuse-observability/gf`，分支 `codex/langfuse-observability`。本机部署配置、启动与验收证据在忽略目录 `.context/langfuse/`。

看板预计入口 `http://localhost:3000`，项目 ID `ta-case-agent`。生成的本地管理员凭证仅保存在权限 0600 的 `local-access.txt`。Compose 独立项目名 `ta-agent-langfuse`，仅看板 3000 和媒体端口 9090 绑定 127.0.0.1；数据库仅容器内部可访问。服务端遥测关闭，不配置 Langfuse 的 AI 功能或外部模型密钥。

启动/停止：

```sh
docker compose -f .context/langfuse/compose.json up -d
docker compose -f .context/langfuse/compose.json stop
```

停止保留数据卷；不要通过 `down -v` 清除观测记录。首次下载容器与健康检查完成后才能称看板已启动。Compose 适用于本机验证，不具备生产高可用与备份。

隔离 API 3105 使用 `.context/langfuse/start-api.py`，只停止属于该工作树的对应进程。合成验收使用独立账号 / Chat / Case，不点击业务确认，不构造正式数据或执行 TA 交换。

## 验证与回滚

观测专项验证默认关闭、内容过滤、并发 trace 隔离、节点/模型同 trace、真实错误对象保持、人工 interrupt/resume 及导出失败时业务继续。后端全量检查日志在 `.context/langfuse/tests.log`，实际 Sophnet 与看板入库证据另记，不能用合成 provider 或跳过的 MySQL 测试冒充真实验收。

关闭开关即可禁用追踪；代码变更作为独立功能提交可撤销。看板容器和数据卷独立于业务 MySQL，停看板不修改 Case 数据。

上游依据：[Docker Compose 部署](https://langfuse.com/self-hosting/deployment/docker-compose)、[JS/TS SDK](https://langfuse.com/guides/cookbook/js_langfuse_sdk)、[LangGraph 回调](https://langfuse.com/integrations/frameworks/langchain)、[数据遮罩](https://langfuse.com/docs/observability/features/masking)。部署与 SDK 具体版本以本机最终锁定记录为准。
