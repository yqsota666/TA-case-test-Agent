# 答辩 UI 玻璃材质比较

本轮分支：`codex/glass-ui-studies`。独立工作树：`/Users/apple/.codex/worktrees/glass-ui-studies/gf`。基线为六主题研究 `9cf1fb79`，新增 Liquid 液态玻璃、Prism 棱镜玻璃、Opal 欧泊玻璃、Glacier 冰晶玻璃。

四套方案保留现有布局、组件边界、间距、字号、字重、行高、业务字段、文字与交互；字体族沿用 Aurora 的 `"SF Pro Text",-apple-system,"PingFang SC",sans-serif`。原5191和六主题5192预览保留不变；5192仍位于 `/Users/apple/.codex/worktrees/defense-ui-studies/gf`、分支 `codex/defense-ui-studies`，包含 Obsidian、Porcelain、Folio、Jade、Aurora、Copper。新方案尚未选为正式产品设计；用户偏好 Aurora 家族不等同于选定新的身份。

## 安装与启动

需要兼容 Vite 7 的 Node.js 与 pnpm。依赖以本目录 `package.json` 为准（React、React DOM、Vite、React 插件、Lucide、React Markdown、remark-gfm、TypeScript）。正常安装和启动：

```sh
cd /Users/apple/.codex/worktrees/glass-ui-studies/gf/Frontend
pnpm install
pnpm exec vite --host 127.0.0.1 --port 5193 --strictPort
```

构建使用 `pnpm build`。本机本轮实际使用 Codex 自带 Node 及已有缓存依赖，运行命令为：

```sh
cd /Users/apple/.codex/worktrees/glass-ui-studies/gf
/Users/apple/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node Frontend/node_modules/vite/bin/vite.js Frontend --host 127.0.0.1 --port 5193 --strictPort
```

相应构建命令为：

```sh
/Users/apple/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node Frontend/node_modules/vite/bin/vite.js build Frontend
```

本机 `Frontend/node_modules` 是指向 `/Users/apple/.codex/worktrees/feihong-light-color/gf/Frontend/node_modules` 的忽略链接；新环境应先正常安装依赖，自带运行时和链接路径不是通用前提。

## 预览

[四材质对比页](http://127.0.0.1:5193/glass-studies.html) 使用实际截图。产品页入口：

- [Liquid](http://127.0.0.1:5193/?theme=liquid)
- [Prism](http://127.0.0.1:5193/?theme=prism)
- [Opal](http://127.0.0.1:5193/?theme=opal)
- [Glacier](http://127.0.0.1:5193/?theme=glacier)

数据页保留 `theme` 参数，使用 `draftTable=customers|accounts|funds|holdings` 四条独立路由，每页一张只读表。例如 `http://127.0.0.1:5193/?theme=liquid&draftTable=customers`。各主题共用同一工作台状态；切换外观不刷新页面，不重置草稿和阅读位置。左下角用户名右侧的调色板按钮提供十款外观选择，主题偏好单独保存在本机；显式 `theme` 链接优先于保存的偏好。旧示例存储只读迁移，不删除。原六主题对比页仍为 [5192/studies.html](http://127.0.0.1:5192/studies.html)。

## 材质与范围

Liquid 使用透明冷色层、清晰边缘、底部内反射、侧栏24px模糊/125%饱和度和输入框18px模糊；源码有不支持 backdrop-filter 时的实色渐变回退。Prism 使用光谱边缘与18px侧栏模糊。Liquid/Prism 的输入框边缘随细指针移动更新，由不可见 React effect 以 requestAnimationFrame 合并，具有减少动态效果与指针能力门控、重置和清理；不支持遮罩合成时共享CSS隐藏该边缘覆盖层，保留基础材质。Opal 为静态暖珍珠扩散，Glacier 为静态冷银蓝切面。没有持续移动背景，也不模糊或扭曲文字和表格。

这些效果是受 Apple Liquid Glass 和 Microsoft Acrylic 启发的 CSS 光学模拟，不是原生 Apple Liquid Glass 的物理折射。四主题变量与源码 SHA-256 记录在根目录 `DESIGN.md`、`.impeccable/design.json`；原六主题记录保留。

本分支读取 `public/defense-acceptance.json`，内容来自前一轮真实模型与数据库验收的冻结历史快照。它不代表当前最新 Case/Agent 后端集成。本分支没有API代理，不推进LangGraph、不生成申请、不调用模型。新对话可以输入草稿；发送会提示流程暂停。

## 本地复核证据与限制

独立复核结果为 **SHIP，仅供5193本地四方向比较**，检查全部38张桌面1280×720/移动390×844截图，无需材质修复。源码和历史基线核对显示 `case-workbench.jsx` 与 `case-workbench.css` 字节不变；五个桌面DOM样本几何与排版一致，不是全部响应式元素证明。四条数据路由审计均为一张表，无桌面横向溢出；截图直接覆盖基金表，其余三表由路由审计支撑。窄屏表格沿用原版换行。

每主题八组声明文字/材质的渐变端点与透明度合成估算，最低值 Liquid 4.90:1、Prism 4.88:1、Opal 4.90:1、Glacier 4.76:1，不是完整渲染像素采样或WCAG认证。指针自定义变量和遮罩输出有运行证据；动态流畅度未用视频评估，回退未强制做视觉测试。跨浏览器、完整键盘/加载/错误状态、生产采用及最新业务后端验收不在这次结论中。

截图、几何/表格/对比度审计、指针记录、单次完成范围检测器记录和独立复核保存于被忽略的 `.context/glass-ui/`；复核范围以 `.context/glass-ui/REVIEW.md` 为准。历史六主题证据仍在 `.context/defense-ui/`。

## 研究来源

已实际克隆并阅读：

- [Impeccable](https://github.com/pbakaus/impeccable) — `cf3d2fa`
- [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) — `477bcb2`
- [Anthropic Skills](https://github.com/anthropics/skills) — `683bc88`
- [Apple — Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/)
- [Microsoft — Acrylic](https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic)

本机研究路径：`/Users/apple/Documents/ChatGPT/gf/tmp/defense-ui-research`。来源与实现记录见 `.context/glass-ui/WORKLOG.md`。
