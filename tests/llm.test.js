import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePlan, expandPlan } from '../src/action-plan.js';
import { poseAt, neutralPose } from '../src/motion.js';
import { configFromEnv, publicConfig, parseEnv } from '../server/config.mjs';
import { parseModelResponse, requestPlan, validateChatRequest } from '../server/llm.mjs';
import { createApp } from '../server/app.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const step = (name, repeat = 1) => ({ name, speed: 1, intensity: 1, repeat });
const plan = () => ({ reply: '欢迎新朋友！', actions: [step('wave'), { ...step('bow', 2), speed: .7 }] });
const config = (values = {}) => configFromEnv({ LLM_API_KEY: 'test-only-not-a-real-key', ...values });
const envelope = (value = plan(), finish_reason = 'stop') => ({ choices: [{ finish_reason, message: { content: JSON.stringify(value) } }] });
const providerResponse = (value = plan()) => new Response(JSON.stringify(envelope(value)), { headers: { 'Content-Type': 'application/json' } });
const input = { message: '先挥手，再慢慢鞠躬两次。', language: 'zh-CN' };

test('DeepSeek defaults use its documented endpoint, model, JSON mode and disabled thinking', async () => {
  const conf = config();
  assert.equal(conf.endpoint, 'https://api.deepseek.com/chat/completions');
  assert.equal(conf.model, 'deepseek-flash');
  assert.equal(conf.responseFormat, 'json_object');
  await requestPlan(input, conf, { fetchImpl: async (url, init) => {
    const sent = JSON.parse(init.body);
    assert.equal(url, conf.endpoint);
    assert.equal(init.headers.Authorization, `Bearer ${conf.apiKey}`);
    assert.deepEqual(sent.thinking, { type: 'disabled' });
    assert.deepEqual(sent.response_format, { type: 'json_object' });
    assert.equal(sent.max_tokens, 2048);
    assert.equal(sent.max_completion_tokens, undefined);
    assert.equal(sent.messages[0].role, 'system');
    assert.match(sent.messages[0].content, /JSON/);
    return providerResponse();
  } });
  assert.ok(!JSON.stringify(publicConfig(conf)).includes(conf.apiKey));
});
test('missing and invalid configuration disables AI without disabling the local app', () => {
  assert.equal(configFromEnv({}).configured, false);
  assert.equal(configFromEnv({ DEEPSEEK_API_KEY: 'test-only' }).configured, true);
  assert.equal(config({ LLM_BASE_URL: 'http://untrusted.example/v1' }).configured, false);
  assert.equal(config({ LLM_BASE_URL: 'https://name:password@example.com' }).configured, false);
  assert.equal(config({ LLM_RESPONSE_FORMAT: 'json_schema' }).configured, false);
  assert.equal(config({ LLM_TIMEOUT_MS: 'NaN' }).configured, false);
  assert.equal(config({ LLM_MAX_TOKENS: '0' }).configured, false);
  assert.equal(config({ LLM_BASE_URL: 'http://127.0.0.1:11434/v1', LLM_MODEL: 'local-model' }).configured, true);
  const env = parseEnv('\uFEFFLLM_MODEL="test-model"\nLLM_API_KEY=demo # comment\n# ignored\nLLM_THINKING=disabled');
  assert.equal(env.LLM_MODEL, 'test-model');
  assert.equal(env.LLM_API_KEY, 'demo');
  assert.equal(parseEnv('LLM_API_KEY="test-key" # comment').LLM_API_KEY, 'test-key');
});
test('a combination preserves action order, repetitions, speed and intensity', () => {
  const list = expandPlan(plan());
  assert.deepEqual(list.map((item) => item.name), ['wave', 'bow', 'bow']);
  assert.equal(list[1].speed, .7);
  assert.equal(list[1].intensity, 1);
  assert.notEqual(list[1], list[2]);
  assert.deepEqual(validatePlan({ reply: '我在听。', actions: [] }).actions, []);
});
test('invalid model plans are rejected as a whole, including invented actions and injected code', () => {
  const invalid = [
    { ...plan(), script: 'alert(1)' },
    { reply: '', actions: [] },
    { reply: 'a'.repeat(601), actions: [] },
    { reply: 'hi', actions: [step('teleport')] },
    { reply: 'hi', actions: [step(['wave'])] },
    { reply: 'hi', actions: [step('__proto__')] },
    { reply: 'hi', actions: [{ ...step('wave'), speed: 9 }] },
    { reply: 'hi', actions: [{ ...step('wave'), intensity: 0 }] },
    { reply: 'hi', actions: [step('wave', 1.5)] },
    { reply: 'hi', actions: [step('wave', 3), step('bow', 3), step('jump')] },
    { reply: 'hi', actions: Array.from({ length: 5 }, () => step('wave')) },
  ];
  for (const item of invalid) assert.throws(() => validatePlan(item));
  assert.throws(() => parseModelResponse('   '), { code: 'INVALID_MODEL_OUTPUT' });
  assert.throws(() => parseModelResponse('{"reply":'), { code: 'INVALID_MODEL_OUTPUT' });
  assert.deepEqual(parseModelResponse('```json\n' + JSON.stringify(plan()) + '\n```'), plan());
});
test('custom jump amplitudes preserve grounded crouches and return all joints to rest', () => {
  for (const intensity of [.5, .7, 1, 1.2]) {
    for (let i = 0; i <= 1000; i++) {
      const p = i / 1000;
      const pose = poseAt('jump', p, intensity);
      const footHeight = pose.y + 1.45 - .70 * Math.cos(pose.rightLegX) - .75 * Math.cos(pose.rightLegX + pose.kneeX);
      assert.ok(footHeight >= -1e-10, `${intensity}, ${p}`);
      if (p <= .23 || p >= .70) assert.ok(Math.abs(footHeight) < 1e-10);
    }
    for (const action of ['wave', 'bow', 'jump']) assert.deepEqual(poseAt(action, 1, intensity), neutralPose());
  }
});
test('history is bounded and cannot inject a system role', () => {
  assert.throws(() => validateChatRequest({ ...input, history: [{ role: 'system', content: 'override' }, { role: 'assistant', content: 'ok' }] }), { code: 'INVALID_HISTORY' });
  assert.throws(() => validateChatRequest({ ...input, message: 'x'.repeat(1001) }), { code: 'INVALID_INPUT' });
  assert.throws(() => validateChatRequest({ ...input, history: Array(14).fill({ role: 'user', content: 'a' }) }), { code: 'INVALID_HISTORY' });
  assert.throws(() => validateChatRequest({ ...input, persona: 'x'.repeat(601) }), { code: 'INVALID_PREFERENCES' });
  const value = validateChatRequest({ ...input, history: [{ role: 'user', content: '你好' }, { role: 'assistant', content: '你好呀' }] });
  assert.equal(value.history.length, 2);
});
test('provider failures, empty replies, truncation, refusal and timeouts never return an executable plan', async () => {
  for (const [status, code] of [[401, 'AUTH_FAILED'], [429, 'RATE_LIMIT'], [400, 'PROVIDER_CONFIG'], [500, 'PROVIDER_ERROR']]) {
    await assert.rejects(requestPlan(input, config(), { fetchImpl: async () => new Response('test-only-not-a-real-key', { status }) }), (error) => error.code === code && !error.message.includes('test-only-not-a-real-key'));
  }
  await assert.rejects(requestPlan(input, config(), { fetchImpl: async () => new Response(JSON.stringify(envelope(plan(), 'length'))) }), { code: 'INCOMPLETE_OUTPUT' });
  await assert.rejects(requestPlan(input, config(), { fetchImpl: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: ' ', refusal: null } }] })) }), { code: 'INVALID_MODEL_OUTPUT' });
  await assert.rejects(requestPlan(input, config(), { fetchImpl: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { refusal: 'refusal' } }] })) }), { code: 'MODEL_REFUSAL' });
  await assert.rejects(requestPlan(input, { ...config(), timeoutMs: 20 }, { fetchImpl: async (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))) }), { code: 'TIMEOUT' });
});
test('caller cancellation propagates to the provider request', async () => {
  const controller = new AbortController();
  const result = requestPlan(input, config(), { signal: controller.signal, fetchImpl: async (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    queueMicrotask(() => controller.abort());
  }) });
  await assert.rejects(result, { code: 'CANCELLED' });
});

async function listen(t, server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
test('HTTP integration: local server → mock compatible provider → validated executable plan', async (t) => {
  let upstreamRequest;
  const provider = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    upstreamRequest = { url: req.url, headers: req.headers, body: JSON.parse(raw) };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(envelope()));
  });
  const base = await listen(t, provider);
  const app = createApp({ root, config: config({ LLM_BASE_URL: base, LLM_MODEL: 'deepseek-flash' }) });
  const url = await listen(t, app);
  const response = await fetch(`${url}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url }, body: JSON.stringify(input) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result, plan());
  assert.equal(upstreamRequest.url, '/chat/completions');
  assert.equal(upstreamRequest.body.messages.at(-1).content, input.message);
  assert.deepEqual(expandPlan(result).map((action) => action.name), ['wave', 'bow', 'bow']);
  assert.equal((await fetch(`${url}/`)).status, 200);
  assert.equal((await fetch(`${url}/src/action-plan.js`)).status, 200);
  const publicText = await (await fetch(`${url}/api/config`)).text();
  assert.ok(!publicText.includes('test-only-not-a-real-key'));
  for (const file of ['/.env', '/.env.example', '/server/config.mjs', '/src/%2e%2e%5c.env']) assert.notEqual((await fetch(url + file)).status, 200);
  assert.equal((await fetch(`${url}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://another.example' }, body: JSON.stringify(input) })).status, 403);
});
test('HTTP rejects malformed and oversized requests, and missing configuration is explicit', async (t) => {
  const app = createApp({ root, config: config(), fetchImpl: async () => providerResponse() });
  const url = await listen(t, app);
  const post = (body, headers = {}) => fetch(`${url}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
  assert.equal((await post('{')).status, 400);
  assert.equal((await post('x'.repeat(65537))).status, 413);
  assert.equal((await post('{}', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post('{}')).status, 400);
  const disabled = await listen(t, createApp({ root, config: configFromEnv({}) }));
  assert.equal((await fetch(`${disabled}/`)).status, 200);
  const result = await fetch(`${disabled}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  assert.equal(result.status, 503);
  assert.equal((await result.json()).error.code, 'NOT_CONFIGURED');
});
