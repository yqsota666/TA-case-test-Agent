import {tool} from 'ai';
import {z} from 'zod';
import {createAgentStore,parse} from '../agent/store.js';
import {createGlobalCaseService} from './service.js';
import {metadata} from '../platform/workflow-service.js';

const id=z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const decimal=z.string().regex(/^\d{1,14}(?:\.\d{1,2})?$/);
const fieldMap=z.record(z.string(),z.string());
const action=z.object({id,fileType:z.enum(['01','03']),businessCode:z.string().regex(/^\d{3}$/),
  businessDate:z.iso.date(),tradingAccountId:z.string().regex(/^\d{1,20}$/).optional(),
  applicationAmount:decimal.optional(),applicationVolume:decimal.optional(),testMode:z.enum(['NORMAL','NEGATIVE']).optional(),
  fields:fieldMap,dependsOn:z.array(z.object({caseId:z.uuid().optional(),actionId:id})),
  expected:z.object({outcome:z.enum(['SUCCESS','FAILURE']),returnCodes:z.array(z.string().length(4)),fields:fieldMap}),
  successVisibleAs:z.string().max(500),
  evidence05:z.object({fundCode:z.string().regex(/^\d{6}$/),shareClass:z.string().length(1),totalVolume:decimal}).optional(),
});
const sop=z.object({objective:z.string().min(1).max(1200),dataNeeds:z.array(z.string().min(1).max(300)),actions:z.array(action).min(1).max(80)});
const contracts={
  read_case_and_shared_data:[z.object({}), '读取当前 Case 的 SOP、历次重试的 AI 与人工判断、申请和回传证据，并读取共享数据平台。讨论现有数据、重试或执行写入前先调用；首次只澄清需求时可不调用。'],
  search_shared_data:[z.object({kind:z.enum(['customers','accounts','funds','targets']),search:z.string().max(100).default(''),
    after:z.string().regex(/^\d{1,20}$/).default('0')}), '分页搜索完整的全局客户、账户、基金或目标份额。'],
  read_protocol_rules:[z.object({fileType:z.enum(['01','03']).optional(),businessCode:z.string().regex(/^\d{3}$/).optional()}),
    '读取中登 2.2 的 01/03 字段及业务必填规则。设计 SOP 前调用。'],
  propose_case_sop:[z.object({sop}),
    '提交 Case SOP 提案。重试时必须先读上一轮 AI 判定、人工原因和真实证据，制定新的完整计划；用户必须自己确认。'],
  create_shared_customers:[z.object({investorName:z.string().min(1).max(180),count:z.number().int().min(1).max(100).optional(),
    simulatedBalance:decimal.optional(),investorType:z.enum(['0','1']).optional(),profile:fieldMap.optional()}),
    '在全局数据平台创建客户及交易账户。先确认 SOP 需要的数据；创建后所有 Case 都可引用。'],
  create_shared_fund:[z.object({fundCode:z.string().regex(/^\d{6}$/),fundName:z.string().min(1).max(200),
    shareClass:z.string().length(1),nav:z.string().optional()}), '在全局数据平台配置基金。'],
  create_shared_account:[z.object({customerPublicId:z.uuid(),branchCode:z.string().max(9).optional(),
    transactionAccountNo:z.string().max(17).optional()}), '为已有的全局客户添加交易账户。'],
  create_shared_target:[z.object({tradingAccountId:z.string().regex(/^\d{1,20}$/),fundCode:z.string().regex(/^\d{6}$/),
    shareClass:z.string().length(1),targetVolume:decimal}), '为全局账户记录预期份额目标。目标份额不等于 TA 确认持仓。'],
  update_shared_data:[z.object({kind:z.enum(['customers','accounts','funds','targets']),recordId:z.string().regex(/^\d{1,20}$/),
    changes:z.record(z.string(),z.unknown())}), '按用户要求修改全局数据。已被确认 SOP 引用的数据会受保护。'],
  delete_shared_data:[z.object({kind:z.enum(['customers','accounts','funds','targets']),recordId:z.string().regex(/^\d{1,20}$/)}),
    '仅在用户明确要求删除且未被确认 SOP 引用时删除全局数据。'],
};
export const globalCaseToolDefinitions=Object.fromEntries(Object.entries(contracts).map(([name,[inputSchema,description]])=>
  [name,tool({inputSchema,description})]));

export const GLOBAL_CASE_AGENT_PROMPT=`你是基金 TA 交换测试 Case 的协作 Agent。一个 Chat 包含多个 Case；每个 Case 有独立讨论和 SOP，同一 Chat 的 Case 共享数据与 TA 状态。\n
按两步讨论，不要在首次收到需求时直接给完整测试方案：
第一步，先用一两句话复述你对变更点的理解，问使用人“你原本打算怎么测、最担心哪种结果？”，再根据需求提出最多两个真正影响测试设计的问题。首次回复控制在 180 个汉字以内，不列长清单、表格或完整 SOP；即使用户说“请规划”，也先听他的想法。仅澄清需求时不必调用工具。
第二步，收到使用人的反馈后，先给出可讨论的简短测试方法：目标、最多三个有区分力的场景及各自预期、需要的真实证据，以及仍未确定的口径。通常不超过 400 个汉字。如果使用人表示没有测试想法，你要根据需求独立提出初版方法，不把设计用例的任务交还给使用人。未知的业务规则或证据要明确标为“待确认”，先给方法再最多追问两个关键问题；这些未知项阻止正式 SOP 或执行，但不阻止方法草案。不要猜测未知口径的答案。用户可继续修改方法；不要把讨论稿当成已确认 SOP。

只有方法和可观察的成功/失败标准经过讨论且足够具体，才形成逻辑 SOP。设计 SOP 前读取当前 Case 与协议规则；可先提交尚未绑定账户的数据需求提案，随后读取或创建共享数据并更新提案。每个动作必须列出业务类型、依赖和回传断言。需要 05 的动作必须事先声明。\n
不要自行确认 SOP；用户在界面确认后锁定。不要自行生成 01/03；由用户点击“生成本轮文件”，系统合并所有 Case 的当前动作。01 开户需要成功 02 建立 TA 账号后，正常 03 才能发。不要假造 TA 回传，也不要把预期份额视为已确认持仓。回传导入后读取系统判定，说明依据与下一步。
若人工已请求重试，先读取 Case 的 retries、旧 SOP、旧申请及共享数据，结合上一轮 AI 判断与人工原因重新讨论完整 SOP。旧申请与回传是事实，不要改写或重发；新 SOP 可以按真实账户状态决定是否需要新的 01，再按 02→03→04 依赖推进。`;

export function createGlobalCaseAgentTools({transaction,authenticate,token,ids,chatId,channelId,caseId,leaseToken,allowChanges=true}){
  const store=createAgentStore({transaction,authenticate});
  const service=createGlobalCaseService({transaction,authenticate});
  const details=(input)=>{
    const rule=input.fileType?metadata.requirements[input.fileType]:null;
    return input.fileType?{fields:metadata.fields[input.fileType],required:[...(rule.required??[]),...(rule.requiredByBusiness?.[input.businessCode]??[])],
      business:input.fileType==='01'?metadata.accountBusinesses[input.businessCode]:metadata.businesses[input.businessCode]}:
      {accountBusinesses:metadata.accountBusinesses,transactionBusinesses:Object.fromEntries(Object.entries(metadata.businesses).map(([code,b])=>[code,b.name]))};
  };
  async function dispatch(call){
    try{
      const contract=contracts[call.toolName];
      if(!contract)return {ok:false,code:'TOOL_NOT_FOUND',message:'工具不存在'};
      const input=parse(contract[0],call.input);
      if(call.toolName==='read_protocol_rules')return details(input);
      if(call.toolName==='read_case_and_shared_data')return {case:await service.caseState(token,caseId),data:await service.data(token,chatId)};
      if(call.toolName==='search_shared_data')return service.listData(token,chatId,input.kind,{after:input.after,search:input.search,limit:'100'});
      if(!allowChanges)return {ok:false,code:'USER_INPUT_REQUIRED',message:'回传事件不能修改 SOP 或共享数据'};
      return await store.perform(token,ids,{toolName:call.toolName,actionKey:`global:${call.toolCallId}`,input,leaseToken},async ctx=>{
        const local=createGlobalCaseService({transaction:fn=>fn(ctx.db),authenticate});
        if(call.toolName==='propose_case_sop')return local.proposeSop(token,caseId,input.sop);
        if(call.toolName==='create_shared_customers')return local.createData(token,chatId,'customers',input);
        if(call.toolName==='create_shared_fund')return local.createData(token,chatId,'funds',input);
        if(call.toolName==='create_shared_account')return local.createData(token,chatId,'accounts',input);
        if(call.toolName==='create_shared_target')return local.createData(token,chatId,'targets',input);
        if(call.toolName==='update_shared_data')return local.updateData(token,chatId,input.kind,input.recordId,input.changes);
        return local.deleteData(token,chatId,input.kind,input.recordId);
      });
    }catch(error){
      if(error.code==='LEASE_LOST')throw error;
      if(error.status>=400&&error.status<500)return {ok:false,code:error.code,message:error.message};
      throw error;
    }
  }
  return {definitions:globalCaseToolDefinitions,dispatch};
}
