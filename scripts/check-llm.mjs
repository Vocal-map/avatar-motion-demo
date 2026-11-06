import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig } from '../server/config.mjs';
import { requestPlan } from '../server/llm.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
try {
  const config = await loadConfig(root);
  console.log(`Checking ${config.providerHost} / ${config.model}`);
  const result = await requestPlan({ message: '请先挥手一次，再慢慢鞠躬两次，用一句话欢迎新朋友。', language: 'zh-CN' }, config);
  console.log(JSON.stringify(result, null, 2));
  console.log('Model connection and action validation passed.');
} catch (error) {
  console.error(`${error.code || 'CONFIG_ERROR'}: ${error.message}`);
  if (error.networkCode) console.error(`Network code: ${error.networkCode}`);
  process.exitCode = 1;
}
