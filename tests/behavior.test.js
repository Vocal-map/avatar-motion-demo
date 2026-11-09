import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, parseCommand } from '../src/commands.js';
import { ActionQueue, idlePose, neutralPose, poseAt, blendPose } from '../src/motion.js';
import { validatePlan } from '../src/action-plan.js';
import { systemPrompt } from '../server/llm.mjs';

test('every registered action is reachable locally and by the model, and visibly animates', () => {
  const prompt = systemPrompt({ language: 'zh-CN' });
  for (const [name, action] of Object.entries(ACTIONS)) {
    assert.equal(parseCommand(action.label).action, name);
    assert.ok(prompt.includes(`${name}（`));
    validatePlan({ reply: '好！', actions: [{ name, speed: 1, intensity: 1, repeat: 1 }] });
    for (const intensity of [.5, 1, 1.2]) {
      assert.notDeepEqual(poseAt(name, .4, intensity), neutralPose(), name);
      assert.deepEqual(poseAt(name, 1, intensity), neutralPose());
      let previous = poseAt(name, 0, intensity);
      for (let i = 1; i <= 1000; i++) {
        const pose = poseAt(name, i / 1000, intensity);
        for (const key of Object.keys(pose)) {
          assert.ok(Number.isFinite(pose[key]), `${name}: ${key}`);
          assert.ok(Math.abs(pose[key] - previous[key]) < .08, `${name}: discontinuity in ${key}`);
        }
        previous = pose;
      }
    }
  }
});

test('the three requested phrases map to their distinct actions', () => {
  assert.equal(parseCommand('打招呼').action, 'wave');
  assert.equal(parseCommand('欢迎光临').action, 'bow');
  assert.equal(parseCommand('跳跃').action, 'jump');
});
test('natural phrases, whitespace, and full-width English work', () => {
  assert.equal(parseCommand('  请你和我打招呼！ ').action, 'wave');
  assert.equal(parseCommand('请鞠躬欢迎客人').action, 'bow');
  assert.equal(parseCommand('开心地跳起来吧').action, 'jump');
  assert.equal(parseCommand('ＨＥＬＬＯ').action, 'wave');
  assert.equal(parseCommand('welcome').action, 'bow');
});
test('empty, unknown, negated, and ambiguous commands never trigger an action', () => {
  for (const input of ['', '   ', '唱首歌', 'this', '不要跳跃', "don't jump", '先打招呼再跳跃', '<script>alert(1)</script>']) {
    const result = parseCommand(input);
    assert.ok(result.error, input);
    assert.equal(result.action, undefined, input);
  }
});
test('actions return every joint to rest and stay finite throughout playback', () => {
  for (const action of Object.keys(ACTIONS)) {
    assert.deepEqual(poseAt(action, 0), neutralPose());
    assert.deepEqual(poseAt(action, 1), neutralPose());
    assert.deepEqual(poseAt(action, 2), neutralPose());
    for (let i = 0; i <= 1000; i++) {
      const pose = poseAt(action, i / 1000);
      for (const value of Object.values(pose)) assert.ok(Number.isFinite(value));
      assert.ok(pose.eyeScale >= .1 && pose.eyeScale <= 1);
    }
  }
});
test('each action visibly performs the intended movement', () => {
  assert.ok(poseAt('wave', .4).rightArmZ < -2, 'hand lifts above shoulder');
  assert.ok(Math.abs(poseAt('wave', .3).rightElbowZ - poseAt('wave', .35).rightElbowZ) > .2, 'forearm waves');
  assert.ok(poseAt('bow', .5).bodyX > .7, 'torso bends from waist');
  assert.ok(poseAt('bow', .5).headX > .1, 'head also bows');
  assert.ok(poseAt('jump', .465).y > .85, 'body visibly leaves the platform');
  assert.ok(poseAt('jump', .11).y < -.1, 'anticipation crouch before takeoff');
});
test('jump keeps feet on the platform during crouching and above it in flight', () => {
  for (let i = 0; i <= 1000; i++) {
    const p = i / 1000;
    const pose = poseAt('jump', p);
    const footHeight = pose.y + 1.45 - .70 * Math.cos(pose.rightLegX) - .75 * Math.cos(pose.rightLegX + pose.kneeX);
    assert.ok(footHeight >= -1e-10, `foot below platform at ${p}`);
    if (p <= .23 || p >= .70) assert.ok(Math.abs(footHeight) < 1e-10, `foot floats during crouch at ${p}`);
  }
});
test('poses remain continuous at jump takeoff and landing', () => {
  for (const boundary of [.23, .70]) {
    const a = poseAt('jump', boundary - .00001);
    const b = poseAt('jump', boundary + .00001);
    for (const key of Object.keys(a)) assert.ok(Math.abs(a[key] - b[key]) < .001, key);
  }
});
test('rapid commands are bounded and execute in order, including repeats', () => {
  const queue = new ActionQueue(3);
  assert.equal(queue.add('wave'), true);
  assert.equal(queue.add('jump'), true);
  assert.equal(queue.add('jump'), true);
  assert.equal(queue.add('bow'), false);
  assert.equal(queue.length, 3);
  assert.deepEqual([queue.next(), queue.next(), queue.next(), queue.next()], ['wave', 'jump', 'jump', null]);
  queue.add('bow');
  queue.clear();
  assert.equal(queue.length, 0);
});
test('pose transitions have exact endpoints and reduced motion removes idle movement', () => {
  const from = poseAt('wave', .4);
  const to = neutralPose();
  assert.deepEqual(blendPose(from, to, 0), from);
  for (const key of Object.keys(to)) assert.ok(Math.abs(blendPose(from, to, 1)[key] - to[key]) < 1e-12);
  assert.deepEqual(idlePose(3, true), neutralPose());
});
