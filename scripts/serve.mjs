import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createApp } from '../server/app.mjs';
import { loadConfig } from '../server/config.mjs';
import { loadTtsConfig } from '../server/tts.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const config = await loadConfig(root);
const ttsConfig = await loadTtsConfig(root);
const port = Number(process.env.PORT || 5173);
const server = createApp({ root, config, ttsConfig, isDist: process.argv.includes('--dist') });
server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  console.log(`MILO is ready at http://127.0.0.1:${port}`);
  console.log(config.configured ? 'LLM configured. Select AI mode in the page to chat.' : `Local actions available. AI mode: ${config.reason}`);
  console.log(ttsConfig.configured ? 'Volcengine TTS 1.0 configured. Word timestamps with estimated mouth shapes; connection verified on synthesis.' : `Volcengine TTS: ${ttsConfig.reason}`);
});
process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
