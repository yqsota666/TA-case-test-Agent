import {AsyncLocalStorage} from 'node:async_hooks';
import {createSophnetCompletion} from '../../case-agent/src/sophnet.js';

const fail=(code,status,message)=>Object.assign(new Error(message),{code,status});
export function estimateModelInput(messages) {
  let tokens=0;
  for(const message of messages) {
    tokens+=16;
    const content=message.content;
    if(typeof content==='string')tokens+=Buffer.byteLength(content,'utf8');
    else if(Array.isArray(content))for(const part of content){
      if(part.type==='text' && typeof part.text==='string')tokens+=Buffer.byteLength(part.text,'utf8');
      else if(part.type==='image_url')tokens+=131072;
      else throw fail('MODEL_INPUT_INVALID',400,'模型输入格式无效');
    }
    else throw fail('MODEL_INPUT_INVALID',400,'模型输入格式无效');
  }
  return tokens;
}

export function createModelRuntime({repository,maxCalls=8,maxInput=600000,maxOutput=8192,completionFactory=createSophnetCompletion}) {
  for(const value of [maxCalls,maxInput,maxOutput])if(!Number.isSafeInteger(value)||value<1)throw new TypeError('invalid model runtime limit');
  const context=new AsyncLocalStorage();
  const govern=async({model,messages,maxTokens,invoke})=>{
    const scope=context.getStore();
    if(!scope?.token)throw fail('MODEL_SCOPE_REQUIRED',401,'模型请求缺少登录上下文');
    if(++scope.calls>maxCalls)throw fail('MODEL_RUN_LIMIT',429,'本次 AI 处理已达到调用上限，请缩小任务后重试');
    const input=estimateModelInput(messages);
    if(input>maxInput)throw fail('MODEL_INPUT_TOO_LARGE',413,'模型上下文过长，请缩小材料或新建 Case');
    const reserved=await repository.reserve(scope.token,{model,purpose:scope.purpose,reservedTokens:input+maxTokens});
    let response;
    try {response=await invoke();}
    catch(error){await repository.settle(reserved.id,null);throw error;}
    await repository.settle(reserved.id,response.usage);
    return response;
  };
  return {
    run:(scope,action)=>context.run({...scope,calls:0},action),
    completion:options=>completionFactory({...options,govern,maxTokens:maxOutput}),
  };
}
