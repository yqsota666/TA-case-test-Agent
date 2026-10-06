import OpenAI from 'openai';

export function createSophnetCompletion({
  apiKey = process.env.SOPHNET_API_KEY,
  baseURL = 'https://www.sophnet.com/api/open-apis/v1',
  model = 'DeepSeek-V4-Pro-0813',
  client,
} = {}) {
  if (!client && !apiKey) throw new Error('SOPHNET_API_KEY is required');
  const sdk = client ?? new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout: 90000 });
  return async ({ system, user, messages, reasoningEffort, thinkingMode }) => {
    if ((user === undefined) === (messages === undefined)) {
      throw new TypeError('provide either user or messages');
    }
    if(reasoningEffort!==undefined && !['low','high','max'].includes(reasoningEffort))throw new TypeError('invalid reasoningEffort');
    if(thinkingMode!==undefined && !['enabled','disabled'].includes(thinkingMode))throw new TypeError('invalid thinkingMode');
    const response = await sdk.chat.completions.create({
      ...(thinkingMode===undefined?{}:{thinking:{type:thinkingMode}}),
      ...(reasoningEffort===undefined?{}:{reasoning_effort:reasoningEffort}),
      model,
      messages: [{ role: 'system', content: system },
        ...(messages ?? [{ role: 'user', content: user }])],
    });
    const content = response.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      const error = new Error('模型没有返回文本');
      error.code = 'MODEL_EMPTY_OUTPUT';
      throw error;
    }
    return content;
  };
}
