// Explicit browser QA fixture. Never reads .env or calls a real provider.
// Start with: node tests/ui-fixture.mjs; open http://127.0.0.1:5180
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { configFromEnv } from '../server/config.mjs';
import { ttsConfigFromEnv } from '../server/tts.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const server = createApp({
  root,
  config: configFromEnv({ LLM_API_KEY: 'test-only', LLM_MODEL: 'UI 联调测试（模拟）' }),
  ttsConfig: ttsConfigFromEnv({ VOLC_TTS_APP_ID: 'test-only', VOLC_TTS_ACCESS_TOKEN: 'test-only' }),
  ttsFetchImpl: async (_, { body }) => {
    const text = JSON.parse(body).req_params.text;
    // A quiet 12-second tone gives enough time to inspect pause/resume manually.
    const pcm = Buffer.alloc(12 * 32000);
    for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(100 * Math.sin(2 * Math.PI * 220 * i / 16000)), i * 2);
    const chars = Array.from(text).filter(char => /[\p{L}\p{N}]/u.test(char));
    const interval = 11 / chars.length;
    const words = chars.map((word, index) => ({ word, startTime: .1 + interval * index, endTime: .1 + interval * index + interval * .8 }));
    const events = [{ code: 0, data: pcm.toString('base64') }, { code: 0, sentence: { text, phonemes: [], words } }, { code: 20000000 }];
    return new Response(events.map(value => `data: ${JSON.stringify(value)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
  },
  fetchImpl: async (_, { body, signal }) => {
    await new Promise((resolve, reject) => {
      const onAbort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, 1200);
      if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
    });
    const request = JSON.parse(body);
    const onlyChat = request.messages.at(-1).content.includes('只聊天');
    const plan = { reply: onlyChat ? '【模拟测试回复】我在听，今天有什么想分享的？' : '【模拟测试回复】欢迎新朋友！我先挥手，再慢慢鞠躬两次。',
      expression: { name: onlyChat ? 'curious' : 'smile', intensity: .65 }, actions: onlyChat ? [] : [
      { name: 'wave', speed: 1.2, intensity: .8, repeat: 1 },
      { name: 'bow', speed: .8, intensity: 1.1, repeat: 2 },
    ] };
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(plan) } }] }), { headers: { 'Content-Type': 'application/json' } });
  },
});
server.listen(5180, '127.0.0.1', () => console.log('UI test fixture (mock responses): http://127.0.0.1:5180'));
process.on('SIGINT', () => server.close(() => process.exit(0)));
