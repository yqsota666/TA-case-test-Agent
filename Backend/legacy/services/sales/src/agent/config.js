import fs from 'node:fs';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export function readAgentConfig(filePath, overrides = process.env) {
  const values = {};
  const file = overrides.AGENT_ENV_FILE || filePath;
  if (file && fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = /^(SOPHNET_[A-Z_]+|AGENT_[A-Z_]+)=(.*)$/.exec(line.trim());
      if (m) values[m[1]] = m[2];
    }
  }
  const setting = name => overrides[name] ?? values[name];
  const apiKey = setting('SOPHNET_API_KEY');
  if (!apiKey) throw new Error('缺少 SOPHNET_API_KEY');
  const baseURL = setting('SOPHNET_BASE_URL') || 'https://api.sophnet.com/v1';
  const url = new URL(baseURL);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('模型地址必须使用 HTTPS');
  const timeoutMs = Number(setting('AGENT_MODEL_TIMEOUT_MS') || 90000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 180000) throw new Error('模型超时配置无效');
  return { apiKey, baseURL, modelId: setting('SOPHNET_MODEL') || 'DeepSeek-V4-Pro', timeoutMs,checkpointURL:setting('AGENT_CHECKPOINT_URL') };
}

export function createSophnetModel(config) {
  const provider = createOpenAICompatible({
    name: 'sophnet', baseURL: config.baseURL, apiKey: config.apiKey,
  });
  return provider.chatModel(config.modelId);
}

export function publicModelError(error) {
  const status = error.statusCode;
  if (status === 401 || status === 403) return { code: 'MODEL_AUTH', message: '模型接口鉴权失败，请核对服务端凭据' };
  if (status === 429) return { code: 'MODEL_RATE_LIMIT', message: '模型接口限流，事件已保留，可重试' };
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return { code: 'MODEL_TIMEOUT', message: '模型调用超时，事件已保留，可恢复' };
  return { code: error.code || 'MODEL_ERROR', message: 'Agent 处理未完成，已保存进度，请重试或检查服务端执行记录' };
}
