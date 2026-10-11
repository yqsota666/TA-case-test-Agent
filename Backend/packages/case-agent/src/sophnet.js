import {setTimeout as delay} from 'node:timers/promises';
import OpenAI from 'openai';

export function createSophnetCompletion({
  apiKey = process.env.SOPHNET_API_KEY,
  baseURL = 'https://www.sophnet.com/api/open-apis/v1',
  model = 'DeepSeek-V4-Pro-0813',
  client, govern, maxTokens: defaultMaxTokens,
} = {}) {
  if (!client && !apiKey) throw new Error('SOPHNET_API_KEY is required');
  const sdk = client ?? new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout: 90000 });
  return async ({ system, user, messages, reasoningEffort, thinkingMode, maxTokens, onDelta, signal, tools, toolChoice }) => {
    if ((user === undefined) === (messages === undefined)) {
      throw new TypeError('provide either user or messages');
    }
    if(reasoningEffort!==undefined && !['low','high','max'].includes(reasoningEffort))throw new TypeError('invalid reasoningEffort');
    if(thinkingMode!==undefined && !['enabled','disabled'].includes(thinkingMode))throw new TypeError('invalid thinkingMode');
    if(tools && onDelta)throw new TypeError('tool decisions cannot stream text');
    const outputLimit=maxTokens??defaultMaxTokens;
    if(outputLimit!==undefined && (!Number.isSafeInteger(outputLimit)||outputLimit<1))throw new TypeError('invalid maxTokens');
    const limitedTokens=defaultMaxTokens===undefined?outputLimit:Math.min(outputLimit,defaultMaxTokens);
    const providerMessages=[{role:'system',content:system},...(messages??[{role:'user',content:user}])];
    const invoke=async()=>{
    let response;
    try {response = await sdk.chat.completions.create({
      ...(thinkingMode===undefined?{}:{thinking:{type:thinkingMode}}),
      ...(reasoningEffort===undefined?{}:{reasoning_effort:reasoningEffort}),
      model,
      ...(tools?{tools,tool_choice:toolChoice??'auto'}:{}),
      ...(limitedTokens===undefined?{}:{max_tokens:limitedTokens}),
      messages:providerMessages,
      ...(onDelta?{stream:true,stream_options:{include_usage:true}}:{}),
    },signal?{signal}:undefined);
    if(onDelta){
      let content='',usage;
      for await(const chunk of response){
        signal?.throwIfAborted();
        if(chunk.usage)usage=chunk.usage;
        const delta=chunk.choices?.[0]?.delta?.content;
        if(typeof delta==='string' && delta){content+=delta;await onDelta(delta);}
      }
      response={choices:[{message:{content}}],usage};
    }
    } catch (error) {
      if(signal?.aborted)throw Object.assign(new Error('回复已中断，请重试原输入'),{code:'MODEL_CANCELLED',status:499});
      let code,status,message;
      if(error.name==='APIConnectionTimeoutError'||error.code==='ETIMEDOUT'||[408,504].includes(error.status)){
        code='MODEL_TIMEOUT';status=504;message='模型响应超时，请重试同一待完成回合';
      }else if(error.name==='APIConnectionError'||['ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN'].includes(error.code)||error.status===429||error.status>=500){
        code='MODEL_UNAVAILABLE';status=503;message='模型服务暂时不可用，请稍后重试同一待完成回合';
      }else if(Number.isInteger(error.status)&&error.status>=400&&error.status<500){
        code='MODEL_PROVIDER_REJECTED';status=502;message='模型服务拒绝请求，请检查服务配置后重试';
      }else{
        code='MODEL_UNAVAILABLE';status=503;message='模型服务响应异常，请重试同一待完成回合';
      }
      throw Object.assign(new Error(message),{code,status,...(error.status===429?{retryable:true}:{})});
    }
    return response;
    };
    const governedMessages=tools?[...providerMessages,{role:'system',content:JSON.stringify(tools)}]:providerMessages;
    let response;
    for(let attempt=0;attempt<2;attempt++){
      try{response=govern?await govern({model,messages:governedMessages,maxTokens:limitedTokens,invoke}):await invoke();break;}
      catch(error){
        if(attempt || !error.retryable || signal?.aborted)throw error;
        try{await delay(1500,undefined,{signal});}
        catch{throw Object.assign(new Error('回复已中断，请重试原输入'),{code:'MODEL_CANCELLED',status:499});}
      }
    }
    if(tools)return response.choices?.[0]?.message;
    const content = response.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      const error = new Error('模型没有返回文本');
      error.code = 'MODEL_EMPTY_OUTPUT';
      throw error;
    }
    return content;
  };
}
