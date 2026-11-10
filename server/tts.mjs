import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ApiError } from './llm.mjs';
import { parseEnv } from './config.mjs';
import { buildMouthCues } from './mouth-cues.mjs';

export const VOLC_TTS_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse';
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_DURATION_MS = 180000;
const invalidOutput = message => new ApiError(502, 'TTS_INVALID_OUTPUT', message);

export function ttsConfigFromEnv(env) {
  const config = { provider: 'volcengine', configured: false,
    appId: (env.VOLC_TTS_APP_ID || '').trim(), accessToken: (env.VOLC_TTS_ACCESS_TOKEN || '').trim(),
    resourceId: (env.VOLC_TTS_RESOURCE_ID || 'seed-tts-1.0').trim(),
    voiceType: (env.VOLC_TTS_VOICE_TYPE || 'zh_female_shuangkuaisisi_moon_bigtts').trim(),
    timeoutMs: Number(env.VOLC_TTS_TIMEOUT_MS || 60000), reason: '' };
  if (!config.appId || !config.accessToken) config.reason = '请在 .env 填写 VOLC_TTS_APP_ID 和 VOLC_TTS_ACCESS_TOKEN，核对资源和音色后重启服务。';
  else if (![config.appId, config.resourceId, config.voiceType].every(value => /^[A-Za-z0-9_.-]{1,128}$/.test(value))
    || /[\r\n]/.test(config.accessToken) || config.accessToken.length > 2048) config.reason = '火山语音配置格式无效，请检查 App ID、Token、资源和音色。';
  else if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1000 || config.timeoutMs > 120000) config.reason = 'VOLC_TTS_TIMEOUT_MS 必须为 1000～120000。';
  else config.configured = true;
  return config;
}

export async function loadTtsConfig(root, environment = process.env) {
  let file = {};
  try { file = parseEnv(await readFile(path.join(root, '.env'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('无法读取 .env 语音配置。'); }
  return ttsConfigFromEnv({ ...file, ...environment });
}

export function publicTtsConfig(config) {
  return { provider: 'volcengine', configured: config.configured, voiceType: config.voiceType,
    resourceId: config.resourceId, reason: config.reason, timeoutMs: config.timeoutMs,
    synchronization: 'word', articulation: 'estimated' };
}

export function encodePcmWav(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function parseWords(sentences, durationMs) {
  const words = [];
  let previousEnd = 0;
  for (const sentence of sentences) {
    if (!Array.isArray(sentence?.words)) throw invalidOutput('语音时间戳缺少字词信息。');
    for (const item of sentence.words) {
      const startMs = item?.startTime * 1000, endMs = item?.endTime * 1000;
      if (typeof item?.word !== 'string' || !item.word.trim() || item.word.length > 600
        || typeof item.startTime !== 'number' || typeof item.endTime !== 'number'
        || !Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs
        || startMs < previousEnd - .5 || endMs > durationMs + 120 || startMs >= durationMs) throw invalidOutput('字词时间线与音频不匹配。');
      const start = Math.max(startMs, previousEnd), end = Math.min(endMs, durationMs);
      if (start >= end) throw invalidOutput('字词时间线包含重叠或空区间。');
      words.push({ text: item.word, startMs: start, endMs: end });
      previousEnd = end;
      if (words.length > 4096) throw invalidOutput('字词时间线过长。');
    }
  }
  if (!words.length) throw new ApiError(502, 'TTS_NO_TIMESTAMPS', '当前音色未返回字词时间戳，请使用支持时间戳的语音合成 1.0 音色。');
  return words;
}

function providerError(code, message = '', status = 200) {
  // Classify provider messages without echoing raw messages or credentials.
  if (/not granted|permission|unauthorized|authentication/i.test(message) || [401, 403].includes(status)) return new ApiError(502, 'TTS_AUTH_FAILED', '火山语音鉴权或资源授权失败，请核对 App ID、Access Token、资源 ID 与音色版本。');
  if (status === 429 || /quota|concurrency|limit exceeded/i.test(message)) return new ApiError(429, 'TTS_RATE_LIMIT', '火山语音额度不足或并发超限，请稍后再试。');
  if (code === 55000000 || /mismatch|speaker/i.test(message)) return new ApiError(502, 'TTS_PROVIDER_CONFIG', '火山语音资源与音色不匹配，请核对 VOLC_TTS_RESOURCE_ID 和 VOLC_TTS_VOICE_TYPE。');
  return new ApiError(502, 'TTS_PROVIDER_ERROR', '火山语音合成失败，请检查服务配置或稍后重试。');
}

// SSE boundaries and UTF-8 code points can cross arbitrary network chunks.
export async function readTtsStream(response, signal) {
  if (!response.ok) { await response.body?.cancel(); throw providerError(null, '', response.status); }
  if (!(response.headers.get('content-type') || '').includes('text/event-stream')) { await response.body?.cancel(); throw invalidOutput('语音服务没有返回 SSE 数据。'); }
  const reader = response.body?.getReader();
  if (!reader) throw invalidOutput('语音服务未返回数据。');
  const onAbort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', onAbort, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const audio = [], sentences = [];
  let buffer = '', dataLines = [], bytes = 0, audioBytes = 0, finished = false;
  const event = () => {
    if (!dataLines.length) return;
    let value;
    try { value = JSON.parse(dataLines.join('\n')); } catch { throw invalidOutput('语音服务返回了无效事件。'); }
    dataLines = [];
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isInteger(value.code) || finished) throw invalidOutput('语音事件顺序或格式无效。');
    if (value.code === 20000000) { finished = true; return; }
    if (value.code !== 0) throw providerError(value.code, String(value.message || ''));
    if (value.data != null) {
      if (typeof value.data !== 'string' || !value.data || value.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)) throw invalidOutput('语音服务返回了无效音频。');
      const pcm = Buffer.from(value.data, 'base64');
      audioBytes += pcm.length;
      if (audioBytes > MAX_AUDIO_BYTES || audioBytes / 32 > MAX_DURATION_MS) throw invalidOutput('语音超过长度限制，请缩短文本。');
      audio.push(pcm);
    }
    if (value.sentence != null) {
      sentences.push(value.sentence);
      if (sentences.length > 1024) throw invalidOutput('语音字幕事件过多。');
    }
  };
  const line = value => {
    if (!value) event();
    else if (value.startsWith('data:')) dataLines.push(value.slice(5).replace(/^ /, ''));
  };
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 14 * 1024 * 1024) throw invalidOutput('语音服务返回的数据过大。');
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, index).replace(/\r$/, '')); buffer = buffer.slice(index + 1); }
    }
    signal?.throwIfAborted();
    buffer += decoder.decode();
    if (buffer) line(buffer.replace(/\r$/, ''));
    event();
    if (!finished || !audioBytes || audioBytes % 2) throw invalidOutput('语音流未完整结束，音频已丢弃，请重试。');
    return { pcm: Buffer.concat(audio), sentences, durationMs: audioBytes / 32 };
  } finally { signal?.removeEventListener('abort', onAbort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function synthesizeSpeech(body, config, { fetchImpl = fetch, signal } = {}) {
  if (!config.configured) throw new ApiError(503, 'TTS_NOT_CONFIGURED', config.reason);
  if (!body || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 600
    || Object.keys(body).length !== 1 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(body.text)) throw new ApiError(400, 'TTS_INVALID_INPUT', '语音文本必须为 1～600 字，只能包含 text 字段。');
  const text = body.text.trim();
  if (!/[\p{L}\p{N}]/u.test(text)) throw new ApiError(400, 'TTS_INVALID_INPUT', '请输入包含文字的语音内容。');
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal?.aborted) onAbort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeoutMs);
  try {
    controller.signal.throwIfAborted();
    const response = await fetchImpl(VOLC_TTS_ENDPOINT, { method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-Api-App-Id': config.appId, 'X-Api-Access-Key': config.accessToken,
        'X-Api-Resource-Id': config.resourceId, 'X-Api-Request-Id': randomUUID() },
      body: JSON.stringify({ user: { uid: 'milo-local-demo' }, req_params: { text, speaker: config.voiceType,
        audio_params: { format: 'pcm', sample_rate: 16000, enable_timestamp: true } } }),
    });
    const { pcm, sentences, durationMs } = await readTtsStream(response, controller.signal);
    controller.signal.throwIfAborted();
    const words = parseWords(sentences, durationMs);
    const cues = buildMouthCues(words);
    console.log('[火山 TTS] 合成完成:', JSON.stringify({ resourceId: config.resourceId, voiceType: config.voiceType, durationMs: Math.round(durationMs), words: words.length, synchronization: 'word', articulation: 'estimated' }));
    return { provider: 'volcengine', synchronization: 'word', articulation: 'estimated', voiceType: config.voiceType,
      audio: { mimeType: 'audio/wav', base64: encodePcmWav(pcm).toString('base64') }, durationMs, words, cues };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timedOut) throw new ApiError(504, 'TTS_TIMEOUT', '火山语音合成超时，请稍后重试。');
    if (controller.signal.aborted) throw new ApiError(499, 'CANCELLED', '语音合成已取消。');
    throw new ApiError(502, 'TTS_NETWORK_ERROR', '无法读取火山语音服务，请检查服务端网络。');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
}
