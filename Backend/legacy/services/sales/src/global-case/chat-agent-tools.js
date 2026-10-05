import {tool} from 'ai';
import {z} from 'zod';
import {createAgentStore,parse} from '../agent/store.js';
import {createGlobalCaseService} from './service.js';

const contracts={
  read_chat:[z.object({}), '读取此 Chat 下的全部 Case、统一进度和共享数据。讨论下一步前先调用。'],
  create_case:[z.object({title:z.string().min(1).max(160),businessDate:z.iso.date().optional()}),
    '在当前 Chat 新建一个 Case。每个 Case 有自己的讨论及待用户确认的 SOP。'],
};
export const globalChatToolDefinitions=Object.fromEntries(Object.entries(contracts).map(([name,[inputSchema,description]])=>
  [name,tool({inputSchema,description})]));
export const GLOBAL_CHAT_AGENT_PROMPT=`你是基金 TA 交换测试 Chat 的协作 Agent。一个 Chat 可包含多个 Case；Case 分别讨论与确认 SOP，同一 Chat 共享数据、文件批次和 TA 回传。\n
先与用户明确需要哪些 Case，再使用工具创建。需要制定具体 SOP 时请用户进入对应 Case 讨论。所有 Case 确认 SOP 后，用户触发统一生成 01；02 成功后才能生成依赖开户的 03；04 后由系统给出建议，最后人工复核。不要假造回传，不要自行确认 SOP 或生成文件。`;

export function createGlobalChatAgentTools({transaction,authenticate,token,ids,chatId,leaseToken,allowChanges=true}){
  const store=createAgentStore({transaction,authenticate});
  const service=createGlobalCaseService({transaction,authenticate});
  async function dispatch(call){
    try{
      const contract=contracts[call.toolName];
      if(!contract)return {ok:false,code:'TOOL_NOT_FOUND',message:'工具不存在'};
      const input=parse(contract[0],call.input);
      if(call.toolName==='read_chat')return {
        cases:await service.listCases(token,chatId),progress:await service.progress(token,chatId),
        data:await service.data(token,chatId),
      };
      if(!allowChanges)return {ok:false,code:'USER_INPUT_REQUIRED',message:'系统事件不能创建 Case'};
      return store.perform(token,ids,{toolName:call.toolName,actionKey:`global-chat:${call.toolCallId}`,
        input,leaseToken},async ctx=>{
        const local=createGlobalCaseService({transaction:fn=>fn(ctx.db),authenticate});
        return local.createCase(token,chatId,input);
      });
    }catch(error){
      if(error.code==='LEASE_LOST')throw error;
      if(error.status>=400&&error.status<500)return {ok:false,code:error.code,message:error.message};
      throw error;
    }
  }
  return {definitions:globalChatToolDefinitions,dispatch};
}
