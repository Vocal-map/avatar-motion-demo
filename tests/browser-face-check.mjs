// Local headless QA: fake model responses and fake speech events, no real provider calls.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { configFromEnv } from '../server/config.mjs';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const artifact = path.join(root, 'artifacts');
const profile = path.join(root, '.sites-local', 'face-qa-profile');
await mkdir(profile, { recursive: true });
const server = createApp({ root, config: configFromEnv({ LLM_API_KEY: 'test-only', LLM_MODEL: '表情联调（模拟）' }),
  fetchImpl: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
    reply: '【模拟回复】欢迎光临，很高兴认识你！', expression: { name: 'smile', intensity: .7 }, actions: [],
  }) } }] })) });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let child, ws, sequence = 0, sessionId;
const pending = new Map(), errors = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--user-data-dir=${profile}`, 'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Chrome startup timeout: ' + output.slice(-500))), 15000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.stderr.on('data', chunk => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
  ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.id) {
      const item = pending.get(data.id);
      if (item) { pending.delete(data.id); clearTimeout(item.timer); data.error ? item.reject(new Error(JSON.stringify(data.error))) : item.resolve(data.result); }
    }
    if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text);
  });
  function call(method, params = {}, session = sessionId) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 25000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
    });
  }
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' }, null);
  ({ sessionId } = await call('Target.attachToTarget', { targetId, flatten: true }, null));
  await call('Page.enable'); await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false });
  // Fake engine only for deterministic lifecycle checks, never for claims about audio quality.
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    let qaVoice = null;
    Object.defineProperty(window, 'speechSynthesis', { value: {
      getVoices: () => [],
      cancel() { const old=qaVoice; qaVoice=null; if(old) setTimeout(()=>old.onerror?.({error:'canceled'}),0); },
      speak(utterance) { qaVoice=utterance; setTimeout(()=>{if(qaVoice===utterance) utterance.onstart?.();},20); }
    }});
  ` });
  async function evaluate(expression) {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async function waitFor(expression, label, timeout = 24000) {
    const start = Date.now();
    while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await sleep(100); }
    throw new Error('UI timeout: ' + label + ' / ' + await evaluate(`document.querySelector('#error-description')?.textContent`));
  }
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  async function screenshot(name) {
    const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path.join(artifact, name), Buffer.from(result.data, 'base64'));
  }
  await call('Page.navigate', { url });
  await waitFor(`document.querySelector('[data-expression="smile"]')?.disabled === false`, 'model ready');
  await click('[data-expression="neutral"]'); await sleep(600); await screenshot('face-neutral.png');
  await click('[data-expression="smile"]'); await sleep(650); await screenshot('face-smile.png');
  await click('[data-expression="surprised"]'); await sleep(650); await screenshot('face-surprised.png');
  await click('[data-expression="sad"]'); await sleep(650); await screenshot('face-sad.png');
  await click('[data-expression="smile"]'); await click('#mouth-demo'); await sleep(250); await screenshot('face-mouth-demo.png');
  if (!(await evaluate(`document.querySelector('#face-status').textContent.includes('无声嘴型演示')`))) throw new Error('Demo not active');
  await click('#stop-action');
  await waitFor(`document.querySelector('#face-status').textContent === '自然 · 未朗读'`, 'stopped face');
  await click('#mode-ai');
  await evaluate(`document.querySelector('#command-input').value='请微笑，只聊天';document.querySelector('#command-form').requestSubmit()`);
  await waitFor(`document.querySelector('#chat-log').textContent.includes('【模拟回复】') && document.querySelector('#face-status').textContent.includes('微笑')`, 'AI expression applied');
  await evaluate(`document.querySelector('#voice-provider').value='browser';document.querySelector('#voice-provider').dispatchEvent(new Event('change'))`);
  await click('#voice-demo');
  await waitFor(`document.querySelector('#face-status').textContent.includes('朗读中')`, 'voice start');
  await click('#stop-action');
  await waitFor(`document.querySelector('#face-status').textContent === '自然 · 未朗读'`, 'voice cancelled');
  await click('[data-expression="smile"]'); await sleep(550); await screenshot('milo-face-preview.png');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  const width = await evaluate(`({width:innerWidth,scroll:document.documentElement.scrollWidth})`);
  if (width.scroll > width.width) throw new Error('Mobile horizontal overflow: ' + JSON.stringify(width));
  await screenshot('face-mobile.png');
  // Optionally save the deliverable against the actual local service, without
  // sending a chat request. All preceding interaction checks use the fixture.
  if (process.env.MILO_PREVIEW_URL) {
    await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1250, deviceScaleFactor: 1, mobile: false });
    await call('Page.navigate', { url: process.env.MILO_PREVIEW_URL });
    await waitFor(`document.querySelector('[data-expression="smile"]')?.disabled === false`, 'preview service ready');
    await click('[data-expression="smile"]'); await sleep(650); await screenshot('milo-face-preview.png');
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Headless QA passed: GLB face poses, demo lips, AI expression, speech start/cancel, mobile layout. Speech engine and AI were mocked.');
} finally {
  if (ws?.readyState === 1) ws.close();
  child?.kill();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

