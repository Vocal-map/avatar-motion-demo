import test from 'node:test';
import assert from 'node:assert/strict';
import { FaceController, EXPRESSIONS, neutralFace, speechTimeline } from '../src/face.js';
import { PLAN_SCHEMA, validatePlan, expandPlan } from '../src/action-plan.js';
import { parseModelResponse, systemPrompt } from '../server/llm.mjs';
import { createVoice } from '../src/voice.js';

test('expression protocol stays bounded and old action replies still work', () => {
  const original = { reply: '你好', actions: [] };
  assert.deepEqual(validatePlan(original), original);
  assert.deepEqual(PLAN_SCHEMA.properties.expression.properties.name.enum, Object.keys(EXPRESSIONS));
  for (const name of Object.keys(EXPRESSIONS)) {
    const plan = { ...original, expression: { name, intensity: .7 } };
    assert.deepEqual(parseModelResponse(JSON.stringify(plan)), plan);
    assert.deepEqual(expandPlan(plan), []);
    assert.ok(systemPrompt({ language: 'zh-CN' }).includes(`${name}（`));
  }
  for (const expression of [null, [], 'smile', { name: '__proto__', intensity: .5 },
    { name: 'smile', intensity: 1.01 }, { name: 'smile', intensity: -.1 }, { name: 'smile', intensity: '1' },
    { name: 'smile', intensity: NaN }, { name: 'smile', intensity: Infinity },
    { name: 'smile', intensity: .5, script: 'run()' }, { name: 'smile' }]) {
    assert.throws(() => validatePlan({ ...original, expression }));
  }
});

function rig() {
  let time = 0;
  const face = new FaceController(() => time);
  const advance = ms => {
    let pose = face.update(0, time);
    for (let t = 0; t < ms; t += 10) { time += 10; pose = face.update(.01, time); }
    return pose;
  };
  return { face, advance };
}

test('expressions fade in and reset without an abrupt pose jump', () => {
  const { face, advance } = rig();
  face.setExpression({ name: 'smile', intensity: 1 }, 1000);
  const early = advance(20), held = advance(600);
  assert.ok(early.smile > 0 && early.smile < held.smile);
  assert.ok(held.smile > .8);
  const released = advance(1000);
  assert.equal(face.expression.name, 'neutral');
  assert.ok(released.smile < .01);
});

test('punctuation closes the lips and demo playback ends without a speech engine', () => {
  const { face, advance } = rig();
  face.startSpeech('啊。', true);
  assert.ok(advance(100).jawOpen > .15);
  assert.ok(advance(300).jawOpen < .01);
  advance(50);
  assert.equal(face.speech, null);
  assert.ok(advance(300).jawOpen < .001);
});

test('pause, boundary resync, cancellation and a new speech do not leave the mouth open', () => {
  const { face, advance } = rig();
  face.startSpeech('你好世界，欢迎光临。');
  advance(100);
  face.pauseSpeech();
  assert.ok(advance(500).jawOpen < .001);
  face.resumeSpeech();
  face.boundary(2);
  assert.ok(advance(90).jawOpen > .1);
  face.stopSpeech();
  assert.ok(advance(400).jawOpen < .001);
  face.startSpeech('呀');
  assert.ok(advance(90).jawOpen > .1);
  face.reset();
  const reset = advance(1200);
  for (const value of Object.values(reset)) assert.ok(Math.abs(value) < .001);
});

test('all expression and speech combinations remain finite and within weights 0–1', () => {
  for (const name of Object.keys(EXPRESSIONS)) {
    const { face, advance } = rig();
    face.setExpression({ name, intensity: 1 });
    face.startSpeech('你好，MILO! Welcome. 嗯……', true);
    for (let i = 0; i < 300; i++) {
      for (const value of Object.values(advance(10))) assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
    }
  }
  const timeline = speechTimeline('好😀啊');
  assert.deepEqual(timeline.segments.map(segment => segment.offset), [0, 1, 3]);
  assert.equal(Object.keys(neutralFace()).length, Object.keys(new FaceController().update(0)).length);
});

test('voice events from an old cancelled utterance cannot animate a newer reply', () => {
  const utterances = [], calls = [];
  const synthesis = { cancel() {}, getVoices: () => [], speak: utterance => utterances.push(utterance) };
  const voice = createVoice({ synthesis, makeUtterance: text => ({ text }),
    onStart: text => calls.push(['start', text]), onEnd: () => calls.push(['end']),
    onBoundary: index => calls.push(['boundary', index]), onError: error => calls.push(['error', error]) });
  voice.speak('第一句', 'zh-CN');
  const old = utterances[0];
  voice.speak('第二句', 'zh-CN');
  const current = utterances[1];
  const count = calls.length;
  old.onstart(); old.onboundary({ charIndex: 2 }); old.onend(); old.onerror({ error: 'failed' });
  assert.equal(calls.length, count);
  current.onstart(); current.onboundary({ charIndex: 1 });
  assert.deepEqual(calls.slice(-2), [['start', '第二句'], ['boundary', 1]]);
  voice.cancel();
  const cancelled = calls.length;
  current.onstart(); current.onend();
  assert.equal(calls.length, cancelled);
});

test('voice failures and pauses produce callbacks that let the face close', () => {
  const utterances = [], calls = [];
  const voice = createVoice({ synthesis: { cancel() {}, getVoices: () => [], speak: utterance => utterances.push(utterance) },
    makeUtterance: text => ({ text }), onPause: () => calls.push('pause'), onResume: () => calls.push('resume'),
    onEnd: () => calls.push('end'), onError: error => calls.push(error) });
  voice.speak('测试', 'auto');
  assert.equal(utterances[0].lang, 'zh-CN');
  utterances[0].onpause(); utterances[0].onresume(); utterances[0].onerror({ error: 'network' });
  assert.deepEqual(calls.slice(-4), ['pause', 'resume', 'end', 'network']);
});
