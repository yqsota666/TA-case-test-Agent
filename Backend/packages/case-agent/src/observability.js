import {NodeSDK} from '@opentelemetry/sdk-node';
import {context} from '@opentelemetry/api';
import {LangfuseSpanProcessor} from '@langfuse/otel';
import {CallbackHandler} from '@langfuse/langchain';
import {startActiveObservation,propagateAttributes} from '@langfuse/tracing';

let sdk;
let processor;
const enabled=()=>Boolean(sdk);
export const safeErrorCode=error=>/^[A-Z][A-Z0-9_]{1,63}$/.test(error?.code??'')?error.code:'OPERATION_FAILED';

// Graph state contains customer data, images and credentials in some service contexts.
class MetadataOnlyCallback extends CallbackHandler {
  constructor(){super();this.requestContext=context.active();}
  handleChainStart(chain,_inputs,id,parent,tags,_metadata,type,name) {
    return context.with(this.requestContext,()=>super.handleChainStart(chain,{},id,parent,tags,{},type,name));
  }
  handleChainEnd(_outputs,id,parent){return super.handleChainEnd({},id,parent);}
  handleChainError(error,id,parent){
    if(error?.name==='GraphInterrupt')return super.handleChainEnd({},id,parent);
    return super.handleChainError(new Error(safeErrorCode(error)),id,parent);
  }
}

const metadataKeys=new Set(['route','method','chat_id','case_id','consumption_id','workspace_id','user_id','purpose','attempt','usage_status','http_status','langgraph_node','langgraph_step']);
export function maskObservationData({data}) {
  let value=data;
  if(typeof value==='string')try{value=JSON.parse(value);}catch{return '[content not collected]';}
  if(!value || typeof value!=='object' || Array.isArray(value))return '[content not collected]';
  const result=Object.fromEntries(Object.entries(value).filter(([key,v])=>metadataKeys.has(key)&&['string','number'].includes(typeof v)));
  return typeof data==='string'?JSON.stringify(result):result;
}

export function initializeObservability(env=process.env,{exporter}={}) {
  if(sdk || env.CASE_OBSERVABILITY_ENABLED!=='1')return;
  if(!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY || !env.LANGFUSE_BASE_URL)
    throw new Error('Langfuse enabled but configuration is incomplete');
  processor=new LangfuseSpanProcessor({publicKey:env.LANGFUSE_PUBLIC_KEY,secretKey:env.LANGFUSE_SECRET_KEY,
    baseUrl:env.LANGFUSE_BASE_URL,environment:env.LANGFUSE_TRACING_ENVIRONMENT||'local',
    mediaUploadEnabled:false,timeout:2,flushInterval:1,
    mask:maskObservationData,...(exporter?{exporter}:{})});
  sdk=new NodeSDK({spanProcessors:[processor]});
  sdk.start();
}

export function observeGraph(graph) {
  if(!enabled())return graph;
  return new Proxy(graph,{get(target,key){
    if(['invoke','stream','streamEvents'].includes(key))return (input,config={})=>{
      const callback=new MetadataOnlyCallback();
      const configured=target.withConfig({callbacks:[callback]});
      return configured[key](input,config);
    };
    const value=Reflect.get(target,key,target);
    return typeof value==='function'?value.bind(target):value;
  }});
}

export function requestObservationContext(request) {
  const path=new URL(request.url,'http://localhost').pathname;
  const ids=path.match(/\/chats\/([0-9a-f-]{36})(?:\/cases\/([0-9a-f-]{36}))?/i);
  const known=new Set('api auth me login logout register demo password avatar account model-usage chats cases discussion cancel plan data content confirm execute review application-preparation applications ta-bindings batches generate files catalog download exchange channels ta-reset return-confirmation delivery apply workflow resume result-review evaluate business-output ta-receipts parse holdings-return return-parsing 02 04 sales-data tables lifecycle close retest new-run customers accounts funds holdings'.split(' '));
  const route=path.split('/').map(part=>!part||known.has(part)?part:':id').join('/');
  return {name:`${request.method} ${route}`,metadata:{route,method:request.method,
    ...(ids?{chat_id:ids[1],...(ids[2]?{case_id:ids[2]}:{})}:{})},sessionId:ids?.[2]};
}

export function observeRequest(request,response,action) {
  if(!enabled())return action();
  const info=requestObservationContext(request);
  const result=propagateAttributes({sessionId:info.sessionId,metadata:info.metadata},()=>
    startActiveObservation(info.name,async span=>{
      response.setHeader('X-Trace-Id',span.otelSpan.spanContext().traceId);
      try {return {value:await action()};}
      catch(error){span.update({level:'ERROR',statusMessage:safeErrorCode(error)});return {error};}
      finally {span.update({metadata:{...info.metadata,http_status:response.statusCode},
        ...(response.statusCode>=400?{level:response.statusCode>=500?'ERROR':'WARNING',
          statusMessage:response.observationError||`HTTP_${response.statusCode}`}:{})});}
    }));
  return result.then(unwrap);
}

function unwrap(result){if('error' in result)throw result.error;return result.value;}

export function observeModel(metadata,action) {
  if(!enabled())return action({update:()=>{}});
  const result=startActiveObservation('model.call',async span=>{
    span.update({model:metadata.model,metadata});
    try{return {value:await action(span)};}
    catch(error){span.update({level:'ERROR',statusMessage:safeErrorCode(error)});return {error};}
  },{asType:'generation'});
  return result.then(unwrap);
}

export async function flushObservability(){await processor?.forceFlush();}
export async function shutdownObservability(){await sdk?.shutdown();}
