import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createApp } from '../server/app.mjs';
import { loadConfig } from '../server/config.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const config = await loadConfig(root);
const port = Number(process.env.PORT || 5173);
const server = createApp({ root, config, isDist: process.argv.includes('--dist') });
server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  console.log(`MILO is ready at http://127.0.0.1:${port}`);
  console.log(config.configured ? 'LLM configured. Select AI mode in the page to chat.' : `Local actions available. AI mode: ${config.reason}`);
});
process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
