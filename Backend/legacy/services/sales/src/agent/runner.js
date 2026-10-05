import {generateText} from 'ai';
import {createAgentTools} from './tools.js';
import {workerAuthenticator} from './store.js';
import {CASE_AGENT_PROMPT} from './prompt.js';
import {publicModelError} from './config.js';
import {pendingCalls} from './context.js';
import {runThreadId} from './component-graph.js';
import {createConversationGraph} from './conversation-graph.js';
import {createGlobalCaseAgentTools,GLOBAL_CASE_AGENT_PROMPT} from '../global-case/agent-tools.js';
import {createGlobalChatAgentTools,GLOBAL_CHAT_AGENT_PROMPT} from '../global-case/chat-agent-tools.js';
export {pendingCalls} from './context.js';

const MAX_MODEL_REQUESTS=16;
export function createAgentRunner(options){return new CaseAgentRunner(options);}
class CaseAgentRunner {
  constructor({transaction,leases,model,modelId,timeoutMs=90000,generate=generateText,checkpointer}) {
    Object.assign(this,{transaction,leases,model,modelId,timeoutMs,generate,checkpointer,failures:[]});
  }
  async run(event) {
    const started=Date.now(),controller=new AbortController();
    const heartbeat=setInterval(()=>this.leases.renew(event).catch(error=>controller.abort(error)),30000);
    let metrics={engine:'langgraph',model:this.modelId,requests:0,inputTokens:0,outputTokens:0,tools:[]};
    try{
      if(!this.checkpointer)throw Object.assign(new Error('Persistent checkpointer required'),{code:'CHECKPOINT_CONFIG'});
      const {caseScope,chatScope}=await this.transaction(async db=>{
        const [[caseScope]]=await db.execute(`SELECT g.channel_id,c.public_id AS parent_chat_public_id FROM global_cases g
          JOIN test_chats c ON c.workspace_id=g.workspace_id AND c.id=g.parent_chat_id
          WHERE g.workspace_id=? AND g.chat_id=? AND g.run_id=?`,
          [event.workspace_id,event.chat_id,event.run_id]);
        if(caseScope)return {caseScope,chatScope:null};
        const [[chatScope]]=await db.execute(`SELECT channel_id FROM global_case_ledgers
          WHERE workspace_id=? AND chat_id=? AND run_id=?`,
          [event.workspace_id,event.chat_id,event.run_id]);
        return {caseScope:null,chatScope};
      });
      const authenticate=workerAuthenticator({userId:event.actor_user_id,workspaceId:event.workspace_id});
      const ids={chatPublicId:event.chatPublicId,runPublicId:event.runPublicId};
      const tools=caseScope?createGlobalCaseAgentTools({transaction:this.transaction,authenticate,token:'worker',ids,
        channelId:caseScope.channel_id,chatId:caseScope.parent_chat_public_id,
        caseId:event.chatPublicId,leaseToken:event.leaseToken,allowChanges:event.source==='USER'}):
        chatScope?createGlobalChatAgentTools({transaction:this.transaction,authenticate,token:'worker',ids,
          chatId:event.chatPublicId,leaseToken:event.leaseToken,allowChanges:event.source==='USER'}):
        createAgentTools({transaction:this.transaction,authenticate,ids,leaseToken:event.leaseToken,eventId:event.id,
          allowPlanChanges:event.source==='USER',checkpointer:this.checkpointer,threadId:runThreadId(event)});
      const askModel=(messages,options)=>this.askModel(messages,{tools,controller,metrics,
        systemPrompt:caseScope?GLOBAL_CASE_AGENT_PROMPT:chatScope?GLOBAL_CHAT_AGENT_PROMPT:CASE_AGENT_PROMPT,...options});
      const graph=createConversationGraph({event,tools,leases:this.leases,checkpointer:this.checkpointer,metrics:()=>metrics,
        ensureInput:()=>this.ensureInput(event),executeCalls:calls=>this.executeCalls(event,calls,tools,metrics),askModel,
        modelNode:()=>this.modelNode(event,metrics,askModel),globalCase:!!(caseScope||chatScope)});
      const config={configurable:{thread_id:runThreadId(event)+':event:'+event.id},recursionLimit:100,durability:'sync',signal:controller.signal};
      const snapshot=await graph.getState(config);
      if(snapshot.values?.metrics)metrics=snapshot.values.metrics;
      if(!snapshot.values?.completed)await graph.invoke(snapshot.next?.length?null:{metrics},config);
      metrics.latencyMs=Date.now()-started;
      await this.leases.finish(event,null,metrics);
      return {eventId:event.public_id,status:'DONE',metrics};
    }catch(error){
      const publicError=publicModelError(error);metrics.latencyMs=Date.now()-started;
      if(error.code!=='LEASE_LOST'&&controller.signal.reason?.code!=='LEASE_LOST')await this.leases.finish(event,publicError,metrics);
      return {eventId:event.public_id,status:'ERROR',error:publicError,metrics};
    }finally{clearInterval(heartbeat);}
  }
  async modelNode(event,metrics,askModel) {
    const history=await this.leases.history(event),unpaired=pendingCalls(history);
    if(unpaired.length)return {calls:unpaired};
    const last=history.at(-1);
    if(last?.role==='assistant')return {terminal:{text:last.content},calls:[]};
    if(metrics.requests>=MAX_MODEL_REQUESTS)throw Object.assign(new Error('Agent request budget exceeded'),{code:'AGENT_BUDGET'});
    const result=await askModel(await this.leases.history(event,{forModel:true}));
    await this.leases.append(event,result.response.messages);
    return {calls:result.toolCalls,terminal:result.toolCalls.length?null:{text:result.text},metrics:{...metrics}};
  }
  async ensureInput(event) {
    const hasInput=await this.transaction(async db=>{
      const [[row]]=await db.execute('SELECT COUNT(*) AS n FROM agent_messages WHERE workspace_id=? AND chat_id=? AND run_id=? AND event_id=?',
        [event.workspace_id,event.chat_id,event.run_id,event.id]);return Number(row.n)>0;
    });
    if(hasInput)return;
    const content=event.source==='USER'||event.source==='RESUME'?event.payload_json.content:
      `系统事件：${event.source==='RETURN'?'已接收并解析TA回传':'操作人员已确认交付'}，文件包ID=${event.payload_json.packageId}。请读取本run真实状态，继续已有计划。`;
    await this.leases.append(event,[{role:'user',content}]);
  }
  async askModel(messages,{tools,controller,metrics,systemPrompt=CASE_AGENT_PROMPT,final=false}) {
    const now=Date.now();
    while(this.failures.length&&this.failures[0]<now-60000)this.failures.shift();
    if(this.failures.length>=5)throw Object.assign(new Error('Model circuit open'),{code:'MODEL_UNAVAILABLE'});
    metrics.requests++;
    try{
      const result=await this.generate({model:this.model,system:systemPrompt,messages,tools:tools.definitions,
        toolChoice:final?'none':'auto',maxOutputTokens:8192,maxRetries:2,
        abortSignal:AbortSignal.any([controller.signal,AbortSignal.timeout(this.timeoutMs)]),
        providerOptions:{sophnet:{enable_thinking:false,parallel_tool_calls:false}}});
      metrics.inputTokens+=result.usage.inputTokens??0;metrics.outputTokens+=result.usage.outputTokens??0;
      return result;
    }catch(error){this.failures.push(Date.now());throw error;}
  }
  async executeCalls(event,calls,tools,metrics) {
    let terminal;
    const history=await this.leases.history(event),prior=new Map();
    for(const message of history)if(message.role==='tool')for(const result of message.content)prior.set(result.toolCallId,result.output.value);
    for(const call of calls){
      let result=prior.get(call.toolCallId);
      if(!result){
        metrics.tools.push(call.toolName);
        result=terminal?{ok:false,code:'TURN_STOPPED',message:'本轮已暂停或归档，该调用未执行'}:await tools.dispatch(call);
        await this.leases.append(event,[{role:'tool',content:[{type:'tool-result',toolName:call.toolName,toolCallId:call.toolCallId,output:{type:'json',value:result}}]}]);
      }
      if(result.stop||result.archived)terminal=result;
    }
    return {terminal};
  }
}
