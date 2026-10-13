# Grafana Cloud 后端指标

2026-10-08 已接入并验证 Grafana Cloud Free。功能基于 3470dca0，独立分支 codex/grafana-cloud-metrics；当前 API 3104 已从本工作树运行，前端 5197 保持原入口。代码默认关闭，本机忽略配置已启用。合成 OTLP 上传成功，云端看板已显示当前 local-api 的请求、耗时和内存数据；没有进行真实模型调用或修改 Case 数据。

[打开 Agent 后端监控](https://tallminivan1333.grafana.net/d/ta-case-backend)。看板限定 job=ta-case-api、instance=local-api，不混入连接测试及隔离端口数据。没有发生某类错误时，对应面板可能显示 No data，不能据此判断采集故障。

## 采集范围

- HTTP 请求在响应 finish 时统计次数、状态类别、耗时；close 且未 finish 计入中断。包括普通成功 GET/HEAD，与 Langfuse 成功查询过滤独立。OPTIONS 也计入，应按 method 筛选业务统计。
- 事务公共入口记录连接获取耗时、提交/失败和获取连接/回滚错误。不采集 SQL、参数或错误原文；业务校验导致的事务回滚也属于 failed，不能全部视为数据库故障。Durable workflow 直接使用连接池，尚未覆盖其内部事务或慢 SQL。
- Node 进程 RSS、堆内存、累计 CPU 时间、运行时间；这些不是整台主机、MySQL 容器或 Docker 磁盘指标。本批没有磁盘/容器资源采集或独立数据库健康探测。
- 接口失败按有限类别聚合。HTTP 200 内的业务结果、模型格式错误的内部重试和人工等待时长，尚不能靠这些指标完整判断；模型和节点详情继续在 Langfuse 查看。
- 指标上传成功/失败次数及最后成功时间。网络断开时云端看不到本机新产生的失败，需另配“指标缺失”告警；不保存离线队列。

标签只含固定方法、允许的归一化路由、状态类别、固定失败类别与事务阶段。不含用户/工作空间/Case ID、Cookie、正文、文件或密钥。直方图使用有限桶及序列上限，超过上限会合并到 OTel overflow，不代表全部维度仍完整。

## 云端连接

1. 注册 https://grafana.com/auth/sign-up/create-user ，确认使用 Free 套餐，建立 Cloud stack。
2. Cloud Portal → stack → OpenTelemetry → Configure，获取 OTLP Endpoint 和 Authorization。只需要 metrics:write 权限。不要给前端或提交到 Git。
3. 本机忽略文件 `.context/grafana/runtime.json`（0600）填写：

```json
{
  "CASE_METRICS_ENABLED": "1",
  "CASE_METRICS_ENDPOINT": "https://<实际网关>.grafana.net/otlp/v1/metrics",
  "CASE_METRICS_AUTHORIZATION": "Basic <云端生成的值>",
  "CASE_METRICS_ENVIRONMENT": "local",
  "CASE_METRICS_INSTANCE": "local-api"
}
```

若复制的是 OTEL_EXPORTER_OTLP_ENDPOINT 基地址，需要补 `/v1/metrics`；Authorization 使用 headers 中的 authorization 值。使用专属 CASE_METRICS_* 变量，避免把现有 Langfuse 追踪端点改成 Grafana。通过启动进程的环境注入配置；server 不自动读取该 JSON。

当前 stack 为 tallminivan1333，OTLP 网关位于 prod-us-east-3（美国东部），与 Langfuse 欧洲区独立。专用访问策略 ta-case-backend-metrics 仅授权当前 stack 的 metrics:write；Token ta-case-api-local 有效期 90 天，到期前需更新本机配置。当前套餐页面确认为 Cloud Free，14 天为额外试用额度；免费额度与保留期限以云端套餐页面为准。

本机启动脚本 `.context/grafana/start-api.py` 读取同树的 Grafana/Langfuse 忽略配置，将凭证注入进程环境；Sophnet 密钥仅从钥匙串读入内存。重启当前 API：

```sh
python3 .context/grafana/start-api.py 3104
```

SDK 每 60 秒上传累计指标，超时 2 秒，读者等待上限 3 秒。无需本地 Grafana/Prometheus/Alloy Docker。当前是开发环境直接上传方案；生产环境官方建议 Collector/Alloy 提高传输可靠性。

https://grafana.com/docs/grafana-cloud/send-data/otlp/send-data-otlp/

## 看板与验收

Grafana → Dashboards → New → Import → 上传 `docs/grafana-backend-dashboard.json`，选择 Cloud Prometheus 数据源。看板提供请求数、5xx 比例、P95、处理中请求、内存、连接等待、事务结果、失败类别和上传结果。指标名按默认 OTLP→Prometheus 单位/类型后缀转换编写，导入后需实际查询校验；若 Cloud stack 改了转换规则，需调整查询名。

已完成：364 后端测试通过，15 个 MySQL 专项默认跳过；真实本地 OTLP HTTP 批次、上传失败不影响业务、有限标签和事务错误语义通过。云端合成上传 exportCode=0，隔离 API 3105 验收后已停止；当前 3104 未登录查询返回 401，前端 5197 返回 200，云端显示 local-api 指标。Langfuse 查询过滤沿用 3470dca0 已验证逻辑；本轮没有执行真实模型或外部 TA 文件测试。

建议随后在云端手工配置连续指标缺失、5xx 异常增长、连接失败、回滚失败告警。告警阈值须结合实际流量，当前没有创建云端告警或通知联系人。云端监控不自动验证 TA 业务正确性。

## 回滚

CASE_METRICS_ENABLED=0 并重启，即停止采集与上传；Langfuse 保持原配置。功能无数据库迁移、无需删除业务数据。独立分支可整体撤回。
