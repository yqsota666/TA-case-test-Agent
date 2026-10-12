# Chat 配色候选（独立预览）

基于实时最新平台 `266c510a`，分支 `codex/chat-palette-options`，工作树 `/Users/apple/Documents/ChatGPT/gf-worktrees/chat-palette-options`。5199不改动；候选端口5231代理既有3106，仅外观修改，无后端或业务数据写入。

比较页：http://127.0.0.1:5231/palette-comparison.html 。使用明确标注的相同合成聊天内容，一键切换 A灰白/蓝、B暖灰/青绿、C深灰侧栏。平台实际内容入口使用 `/?theme=liquid&palette=neutral`、`warm`、`contrast`，需在5231登录。

颜色通过查询参数显式启用，不写外观偏好。沿用玻璃输入框和布局；正文与辅助文字改为中性色，导航选中及操作保留强调色。参考 ui-ux-pro-max 中性阅读工作区及文字对比度建议。

构建通过，保留既有大包警告。Playwright三版1440×900/390×844无页面横向溢出、无JS运行错误，比较按钮切换通过。实际检查深灰侧栏截图文字及选中项清楚。证据 `.context/palette`。用户视觉验收尚未完成。整个候选提交可独立回滚，无push/PR。
