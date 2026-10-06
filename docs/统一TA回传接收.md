# 统一 TA 回传接收

本实现对应 Backend 的 `platform-store/src/ta-receipts.js`。一次上传同通道、同日期、同协议版本的 02、04、05 原始 TXT，以及可选的原始完整 OFI。按文件头识别类型，不调用模型猜测。旧入口继续支持。

## API

`GET /api/chats/:chatId/cases/:caseId/ta-receipts`

返回 `{returns, holdings, supportedTypes, formats, businessApplied:false}`。returns 为既有 02/04 接收目标，steps 内含 expectedType、batchPublicId、channelId、channel、parses；holdings 为既有 05 的 Plan 步骤和解析记录。

`POST /api/chats/:chatId/cases/:caseId/ta-receipts/parse`

```json
{
  "channelId": "2",
  "files": [{"fileName": "原始文件名.TXT", "base64": "标准Base64内容"}],
  "routes": [
    {"fileType": "02", "batchPublicId": "批次UUID", "exchangeStepId": "receive02"},
    {"fileType": "04", "batchPublicId": "批次UUID", "exchangeStepId": "receive04"},
    {"fileType": "05", "exchangeStepId": "receive05"}
  ]
}
```

routes 可省略，每种类型最多一个。02/04 目标唯一时自动选择；多个目标必须选批次，绝不猜测最新批次。多个 05 轮次仍须明确 exchangeStepId。未出现的路由、错误参数和未知文件类型拒绝。

成功返回 `{phase:"PARSED",sha256,indexChecked,packageFiles,results,businessApplied:false}`。results 每项含 fileType、parseId、duplicate、phase。02/04 的解析对象为 result；05 为 parsed。正式销售数据仍通过 return-confirmation/apply 或 holdings-return/apply 显式同步。

## 原始包与事务

先验证全部原文件的 GB18030 字节、头尾、字段、记录数、机构、版本、日期，以及 OFI 完整清单。任何结构错，整包拒绝。不会截取、重写或伪造索引。没有 OFI 的合法 TXT 可以解析，indexChecked 为 false。

每个类型保存完整原包字节和摘要，结果仅投影对应类型。所有类型写入及 Plan 顺序校验共用事务；后面的类型失败会回滚前面的解析和事件。重复上传、改变文件排列会复用原摘要和解析记录。上限为 17 文件、总原始字节 8 MiB、整包 2000 记录。

apply 重新读取原文件并验证完整包；02/04 从字节重新解析业务记录，不信任 JSON 内的记录。保留原解析文件次序，使用户选择的记录序号一致。05 也重新验证完整混包 OFI。缺失或损坏原文件拒绝同步。

PARSED 不等于 CONFIRMED。解析 02 不会自动建立账号，不能解锁依赖成功确认的 03。批次可以包含多个 Case 的记录，所选 Case 的 apply 必须匹配本 Case 的申请号，不能修改其他 Case。跨 Case 可上传完整原包，但各 Case 独立校验和确认。

## 验证与边界

常规测试覆盖混类型完整 OFI、缺分片、错误类型、损坏其他类型、原字节保留、旧入口拒绝混包、HTTP 鉴权和 Origin。独立新 MySQL 库集成覆盖混包、解析不改正式账本、后段顺序错整事务回滚、重复幂等、所有原字节保存、原字节篡改拒绝、各类型显式 apply。使用合成数据并回滚，测试库最终删除。

不支持 ZIP 解压和目录递归。每次仅一个 Case、一个通道、一个日期，每种类型仅一个目标轮次；多日期、通道、同类型多轮次须按 TA 原始完整包分别接收，不允许偷取 OFI 子集。正式同步仍只支持既有开户、申购和 05 账户余额规则，没有扩展其他业务会计处理。
