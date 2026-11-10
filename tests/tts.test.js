import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.mjs';
import { configFromEnv } from '../server/config.mjs';
import { ttsConfigFromEnv, publicTtsConfig, synthesizeSpeech, parseWords, readTtsStream, VOLC_TTS_ENDPOINT } from '../server/tts.mjs';
import { buildMouthCues } from '../server/mouth-cues.mjs';
import { validateMouthCues, sampleMouthCues } from '../src/speech-timing.js';
import { FaceController } from '../src/face.js';
import { createVolcVoice } from '../src/volc-voice.js';

const conf = () => ttsConfigFromEnv({ VOLC_TTS_APP_ID: 'test-app', VOLC_TTS_ACCESS_TOKEN: 'test-only-not-a-real-token' });
const word = (text, startTime, endTime) => ({ word: text, startTime, endTime });
const events = () => [{ code: 0, data: Buffer.alloc(32000).toString('base64') },
  { code: 0, sentence: { phonemes: [], text: '妈，发。', words: [word('妈，', .1, .4), word('发。', .6, .9)] } }, { code: 20000000 }];
const stream = (items = events(), splitBytes = 0) => {
  const bytes = new TextEncoder().encode(': keepalive\r\n' + items.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join(''));
  let position = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (position >= bytes.length) { controller.close(); return; }
    const end = Math.min(bytes.length, position + (splitBytes || bytes.length));
    controller.enqueue(bytes.slice(position, end)); position = end;
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
};
const synthesis = () => synthesizeSpeech({ text: '妈，发。' }, conf(), { fetchImpl: async () => stream() });

test('TTS uses the trial V3 resource, requests actual word timestamps, and never publishes credentials', async () => {
  const c = conf();
  const result = await synthesizeSpeech({ text: '妈，发。' }, c, { fetchImpl: async (url, init) => {
    assert.equal(url, VOLC_TTS_ENDPOINT);
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers['X-Api-Resource-Id'], 'seed-tts-1.0');
    assert.equal(init.headers['X-Api-App-Id'], c.appId);
    assert.equal(init.headers['X-Api-Access-Key'], c.accessToken);
    assert.equal(JSON.parse(init.body).req_params.audio_params.enable_timestamp, true);
    assert.equal(JSON.parse(init.body).req_params.speaker, 'zh_female_shuangkuaisisi_moon_bigtts');
    return stream(events(), 7);
  } });
  assert.equal(result.synchronization, 'word');
  assert.equal(result.articulation, 'estimated');
  assert.equal(result.phonemes, undefined);
  assert.deepEqual(result.words[0], { text: '妈，', startMs: 100, endMs: 400 });
  const wav = Buffer.from(result.audio.base64, 'base64');
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt32LE(40), 32000);
  assert.equal(wav.length, 32044);
  assert.equal(result.durationMs, 1000);
  assert.doesNotThrow(() => validateMouthCues(result.cues, result.durationMs));
  for (const object of [result, publicTtsConfig(c)]) {
    assert.ok(!JSON.stringify(object).includes(c.accessToken));
    assert.ok(!JSON.stringify(object).includes(c.appId));
  }
  assert.equal(ttsConfigFromEnv({}).configured, false);
  assert.equal(ttsConfigFromEnv({ VOLC_TTS_APP_ID: 'app', VOLC_TTS_ACCESS_TOKEN: 'bad\ntoken' }).configured, false);
});

test('truncated streams, late provider errors, malformed audio and missing timestamps fail without returning partial audio', async () => {
  for (const items of [events().slice(0, -1), [...events().slice(0, -1), { code: 55000000, message: 'test-only-not-a-real-token speaker mismatch' }],
    [{ code: 0, data: '???' }, { code: 20000000 }], [{ code: 20000000 }], [...events(), { code: 0, data: 'AAAA' }]]) {
    await assert.rejects(synthesizeSpeech({ text: '测试' }, conf(), { fetchImpl: async () => stream(items) }), error => error.code?.startsWith('TTS_') && !error.message.includes('test-only-not-a-real-token'));
  }
  await assert.rejects(synthesizeSpeech({ text: '测试' }, conf(), { fetchImpl: async () => stream([events()[0], { code: 20000000 }]) }), { code: 'TTS_NO_TIMESTAMPS' });
  await assert.rejects(readTtsStream(new Response('{}', { headers: { 'Content-Type': 'application/json' } })), { code: 'TTS_INVALID_OUTPUT' });
  for (const [status, code] of [[403, 'TTS_AUTH_FAILED'], [429, 'TTS_RATE_LIMIT'], [500, 'TTS_PROVIDER_ERROR']]) {
    await assert.rejects(synthesizeSpeech({ text: '测试' }, conf(), { fetchImpl: async () => new Response('token test-only-not-a-real-token', { status }) }), error => error.code === code && !error.message.includes('test-only-not-a-real-token'));
  }
});

test('timelines reject reversed, overlapping, missing and out-of-audio word times', () => {
  for (const words of [[word('你', .3, .2)], [word('你', -.1, .2)], [word('你', 0, 2)], [word('你', 0, .3), word('好', .2, .4)], [word('你', '0', .2)]]) {
    assert.throws(() => parseWords([{ words }], 1000), { code: 'TTS_INVALID_OUTPUT' });
  }
  assert.throws(() => validateMouthCues([{ shape: '__proto__', startMs: 0, endMs: 10 }], 100));
});

test('pinyin creates closed bilabials and lip-bite estimates inside real word bounds; pauses remain closed', () => {
  const words = parseWords([events()[1].sentence], 1000), cues = buildMouthCues(words);
  assert.equal(cues[0].shape, 'closed');
  assert.ok(cues.some(c => c.shape === 'aa'));
  assert.ok(cues.some(c => c.shape === 'fv'));
  validateMouthCues(cues, 1000);
  for (const time of [0, 50, 500, 950, 1000]) assert.equal(sampleMouthCues(cues, time).jawOpen, 0);
  assert.equal(sampleMouthCues(cues, 120).jawOpen, 0);
  assert.ok(sampleMouthCues(cues, 300).jawOpen > .5);
});

test('face follows audio currentTime across wall-clock changes, pause, resume, silence and stop', () => {
  let wallClock = 0, audioTime = 300;
  const face = new FaceController(() => wallClock);
  face.startTimedSpeech(buildMouthCues(parseWords([events()[1].sentence], 1000)), 1000, () => audioTime);
  for (let i = 0; i < 30; i++) face.update(.05);
  const open = face.update(.05).jawOpen;
  wallClock = 60000;
  assert.ok(Math.abs(face.update(.05).jawOpen - open) < .00001);
  face.pauseSpeech(); assert.equal(face.update(.01).jawOpen, 0);
  face.resumeSpeech(); assert.ok(face.update(.05).jawOpen > 0);
  audioTime = 500; assert.equal(face.update(.01).jawOpen, 0);
  audioTime = 800; assert.ok(face.update(.05).jawOpen > 0);
  face.stopSpeech(); assert.equal(face.current.jawOpen, 0);
});

test('TTS input is bounded and cancellation/timeout propagate to the provider', async () => {
  for (const input of [{ text: 'x'.repeat(601) }, { text: '' }, { text: '。' }, { text: 'hi', voice: 'override' }]) await assert.rejects(synthesizeSpeech(input, conf()), { code: 'TTS_INVALID_INPUT' });
  const hanging = (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  await assert.rejects(synthesizeSpeech({ text: '你好' }, { ...conf(), timeoutMs: 15 }, { fetchImpl: hanging }), { code: 'TTS_TIMEOUT' });
  const abort = new AbortController();
  const pending = synthesizeSpeech({ text: '你好' }, conf(), { signal: abort.signal, fetchImpl: hanging });
  abort.abort(); await assert.rejects(pending, { code: 'CANCELLED' });
});

test('timeout also cancels a stalled SSE response body after HTTP headers arrived', async () => {
  let cancelled = false;
  await assert.rejects(synthesizeSpeech({ text: '你好' }, { ...conf(), timeoutMs: 15 }, {
    fetchImpl: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'text/event-stream' } }),
  }), { code: 'TTS_TIMEOUT' });
  assert.equal(cancelled, true);
});

class FakeAudio {
  currentTime = 0;
  blocked = false;
  plays = 0;
  async play() { this.plays++; if (this.blocked) throw new DOMException('user gesture required', 'NotAllowedError'); this.onplaying?.(); }
  pause() { this.onpause?.(); }
  removeAttribute() {}
  load() {}
}

test('cloud player retries autoplay without re-synthesis and closes on pause/end/cancel', async () => {
  const result = await synthesis(), audio = new FakeAudio(), states = [], revoked = [];
  let calls = 0, clock, ended = 0, paused = 0, resumed = 0;
  audio.blocked = true;
  const player = createVolcVoice({ fetchImpl: async () => { calls++; return Response.json(result); }, makeAudio: () => audio,
    makeUrl: () => 'blob:test', revokeUrl: url => revoked.push(url), onStatus: status => states.push(status),
    onStart: (_, __, readTime) => { clock = readTime; }, onEnd: () => ended++, onPause: () => paused++, onResume: () => resumed++ });
  assert.equal(await player.speak('妈发'), false);
  assert.equal(states.at(-1), 'blocked');
  audio.blocked = false; assert.equal(await player.resume(), true);
  audio.currentTime = .3; assert.equal(clock(), 300);
  player.pause(); assert.equal(states.at(-1), 'paused'); assert.equal(paused, 1);
  await player.resume(); assert.equal(resumed, 1);
  assert.equal(calls, 1);
  audio.onended(); assert.equal(states.at(-1), 'idle'); assert.deepEqual(revoked, ['blob:test']);
  assert.ok(ended >= 2);
  assert.equal(audio.onplaying, null);
});

test('a cancelled late response never creates audio or restarts the mouth', async () => {
  const result = await synthesis();
  let resolve, created = 0, errors = 0;
  const player = createVolcVoice({ fetchImpl: () => new Promise(r => { resolve = r; }), makeAudio: () => { created++; return new FakeAudio(); }, onError: () => errors++ });
  const pending = player.speak('你好'); player.cancel(); resolve(Response.json(result));
  assert.equal(await pending, false); assert.equal(created, 0); assert.equal(errors, 0);
});

test('TTS HTTP route is same-origin, hides credentials, and operates independently of LLM config', async t => {
  let release;
  const c = conf();
  const server = createApp({ root: process.cwd(), config: configFromEnv({}), ttsConfig: c,
    ttsFetchImpl: () => new Promise(resolve => { release = () => resolve(stream()); }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (origin = url) => fetch(url + '/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ text: '妈发' }) });
  const published = await (await fetch(url + '/api/config')).text();
  assert.ok(!published.includes(c.accessToken)); assert.ok(!published.includes(c.appId));
  assert.equal((await post('https://another.example')).status, 403);
  const first = post();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await post()).status, 429);
  release(); assert.equal((await first).status, 200);
});
