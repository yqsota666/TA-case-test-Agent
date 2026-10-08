import OpenAI from 'openai';

export function createSophnetCompletion({
  apiKey = process.env.SOPHNET_API_KEY,
  baseURL = 'https://www.sophnet.com/api/open-apis/v1',
  model = 'DeepSeek-V4-Pro-0813',
  client, govern, maxTokens: defaultMaxTokens,
} = {}) {
  if (!client && !apiKey) throw new Error('SOPHNET_API_KEY is required');
  const sdk = client ?? new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout: 90000 });
  return async ({ system, user, messages, reasoningEffort, thinkingMode, maxTokens }) => {
    if ((user === undefined) === (messages === undefined)) {
      throw new TypeError('provide either user or messages');
    }
    if(reasoningEffort!==undefined && !['low','high','max'].includes(reasoningEffort))throw new TypeError('invalid reasoningEffort');
    if(thinkingMode!==undefined && !['enabled','disabled'].includes(thinkingMode))throw new TypeError('invalid thinkingMode');
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
      ...(limitedTokens===undefined?{}:{max_tokens:limitedTokens}),
      messages:providerMessages,
    });
    } catch (error) {
      let code,status,message;
      if(error.name==='APIConnectionTimeoutError'||error.code==='ETIMEDOUT'||[408,504].includes(error.status)){
        code='MODEL_TIMEOUT';status=504;message='模型响应超时，请重试同一待完成回合';
      }else if(error.name==='APIConnectionError'||['ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN'].includes(error.code)||error.status===429||error.status>=500){
        code='MODEL_UNAVAILABLE';status=503;message='模型服务暂时不可用，请稍后重试同一待完成回合';
      }else if(Number.isInteger(error.status)&&error.status>=400&&error.status<500){
        code='MODEL_PROVIDER_REJECTED';status=502;message='模型服务拒绝请求，请检查服务配置后重试';
      }else throw error;
      throw Object.assign(new Error(message),{code,status});
    }
    return response;
    };
    const response=govern?await govern({model,messages:providerMessages,maxTokens:limitedTokens,invoke}):await invoke();
    const content = response.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      const error = new Error('模型没有返回文本');
      error.code = 'MODEL_EMPTY_OUTPUT';
      throw error;
    }
    return content;
  };
}
