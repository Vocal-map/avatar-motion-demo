import { readFile } from 'node:fs/promises';
import path from 'node:path';

export function parseEnv(source) {
  const output = {};
  for (const line of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    const quoted = value.match(/^(['"])(.*?)\1(?:\s+#.*)?$/);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, '').trim();
    output[match[1]] = value;
  }
  return output;
}

export async function loadConfig(root, environment = process.env) {
  let file = {};
  try { file = parseEnv(await readFile(path.join(root, '.env'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('无法读取 .env 配置文件。'); }
  return configFromEnv({ ...file, ...environment });
}

export function configFromEnv(env) {
  const base = (env.LLM_BASE_URL || 'https://api.deepseek.com').trim();
  const config = { configured: false, model: (env.LLM_MODEL || '').trim(), apiKey: (env.LLM_API_KEY || env.DEEPSEEK_API_KEY || '').trim(),
    responseFormat: env.LLM_RESPONSE_FORMAT || 'json_object', timeoutMs: Number(env.LLM_TIMEOUT_MS || 30000),
    maxTokens: Number(env.LLM_MAX_TOKENS || 2048), providerHost: '', endpoint: '', reason: '' };
  try {
    const url = new URL(base);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!(url.protocol === 'https:' || (url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash) throw new Error();
    const prefix = url.pathname.replace(/\/+$/, '');
    url.pathname = prefix.endsWith('/chat/completions') ? prefix : `${prefix}/chat/completions`;
    config.endpoint = url.href;
    config.providerHost = url.host;
    config.isDeepSeek = url.hostname === 'api.deepseek.com';
    if (!config.model && config.isDeepSeek) config.model = 'deepseek-flash';
    config.thinking = env.LLM_THINKING || 'disabled';
    config.tokenParameter = env.LLM_TOKEN_PARAMETER || (url.hostname === 'api.openai.com' ? 'max_completion_tokens' : 'max_tokens');
  } catch { config.reason = 'LLM_BASE_URL 无效：请填写 HTTPS 接口地址（本机服务可用 HTTP）。'; return config; }
  if (!config.model || !config.apiKey) config.reason = '请在项目 .env 中填写 LLM_MODEL 和 LLM_API_KEY，再重启服务。';
  else if (!['json_object', 'json_schema', 'none'].includes(config.responseFormat)) config.reason = 'LLM_RESPONSE_FORMAT 必须为 json_object、json_schema 或 none。';
  else if (!['max_tokens', 'max_completion_tokens'].includes(config.tokenParameter)) config.reason = 'LLM_TOKEN_PARAMETER 配置无效。';
  else if (!['enabled', 'disabled'].includes(config.thinking)) config.reason = 'LLM_THINKING 必须为 enabled 或 disabled。';
  else if (config.isDeepSeek && config.responseFormat === 'json_schema') config.reason = 'DeepSeek 请使用 LLM_RESPONSE_FORMAT=json_object。';
  else if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1000 || config.timeoutMs > 120000) config.reason = 'LLM_TIMEOUT_MS 必须为 1000～120000。';
  else if (!Number.isInteger(config.maxTokens) || config.maxTokens < 256 || config.maxTokens > 16384) config.reason = 'LLM_MAX_TOKENS 必须为 256～16384。';
  else config.configured = true;
  return config;
}

export function publicConfig(config) {
  return { configured: config.configured, model: config.model, providerHost: config.providerHost, reason: config.reason, timeoutMs: config.timeoutMs };
}
