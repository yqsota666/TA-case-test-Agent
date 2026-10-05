# TA Case Test Agent

Case／Agent平台按两个独立应用维护：

- [Frontend](Frontend/README.md)：Case工作流界面、数据核对、申请文件预览与下载。
- [Backend](Backend/README.md)：Case API、Agent、存储、协议及迁移；legacy/提供当前界面仍需要的聊天和登录兼容接口。

使用Node.js 24和pnpm 11.25.0，在Frontend和Backend分别安装依赖。前端独立构建，后端独立运行测试；GitHub Actions对两部分分别验证。数据库、Sophnet模型密钥和验收会话通过运行环境配置，不随源码上传。

数据和Plan确认后准备01申请；03使用成功02回传绑定的TA账户。缺少申请资料时由用户补充，已入库意图保持冻结。普通继续会重读完整Plan和最新绑定；中断恢复复用已保存意图。

本地验收已走通模拟01→成功02匹配→350元03生成和原始文件下载。02为模拟夹具；申请恢复和信息补充使用真实Sophnet DeepSeek-V4-Pro-0813。文件交付、完整回传HTTP入口及旧界面状态统一尚未全部迁移。

历史设计和协议说明保留在docs/；其中旧fund-sales-demo路径是迁移前记录，当前代码入口为Frontend/和Backend/。
