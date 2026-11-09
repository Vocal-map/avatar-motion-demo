import { ACTIONS, parseCommand } from './commands.js';
import { ActionQueue, idlePose, poseAt, blendPose } from './motion.js';
import { expandPlan } from './action-plan.js';
import { createChat } from './chat.js';
import { EXPRESSIONS, FaceController } from './face.js';

const $ = (selector) => document.querySelector(selector);
const form = $('#command-form');
const input = $('#command-input');
const feedback = $('#feedback');
const face = new FaceController();
for (const [name, expression] of Object.entries(EXPRESSIONS)) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.expression = name;
  button.textContent = expression.label;
  button.setAttribute('aria-pressed', String(name === 'neutral'));
  button.disabled = true;
  $('#expression-buttons').append(button);
}
const expressionButtons = [...document.querySelectorAll('[data-expression]')];
let lastFaceStatus = '';
for (const [name, action] of Object.entries(ACTIONS)) {
  if (['wave', 'bow', 'jump'].includes(name)) continue;
  const button = document.createElement('button');
  button.type = 'button';
  button.disabled = true;
  button.dataset.command = action.label;
  button.textContent = action.label;
  $('.quick-actions').insertBefore(button, $('.enter-hint'));
}
const quickButtons = [...document.querySelectorAll('[data-command]')];
const speech = $('#speech');
const queue = new ActionQueue(6);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let scene;
let ready = false;
let active = null;
let elapsed = 0;
let lastFrame = null;
let animationFrame = null;
let idleTime = 2;
let transitionFrom = idlePose(2);
let currentPose = transitionFrom;
let idleTransition = 1;
let chat;

function setFeedback(message, type = '') {
  feedback.textContent = message;
  feedback.className = `feedback${type ? ` is-${type}` : ''}`;
}
function setSpeech(message, isActive = false) {
  const preview = message.length > 54 ? `${message.slice(0, 54)}…` : message;
  speech.replaceChildren(document.createTextNode(preview));
  const star = document.createElement('span');
  star.textContent = '✦';
  speech.append(star);
  speech.classList.toggle('is-active', isActive);
}
function enableControls(enabled) {
  const blocked = !enabled || !!chat?.isBusy();
  input.disabled = blocked;
  $('#send-button').disabled = blocked;
  quickButtons.forEach((button) => { button.disabled = blocked; });
  $('#reset-camera').disabled = !enabled;
  $('#face-view').disabled = !enabled;
  for (const element of [...expressionButtons, $('#expression-intensity'), $('#mouth-demo'), $('#voice-demo')]) element.disabled = blocked;
}
function startAction(action) {
  active = action;
  elapsed = 0;
  transitionFrom = { ...currentPose };
  const info = ACTIONS[action.name];
  $('#motion-status').textContent = info.status;
  $('#motion-time').textContent = info.code;
  $('#motion-dot').classList.add('is-active');
  quickButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.command === info.label));
  if (action.source !== 'ai') {
    setSpeech(info.speech, true);
    setFeedback(`收到「${info.label}」，${info.status}。${queue.length ? `后面还有 ${queue.length} 个动作。` : ''}`, 'success');
  } else speech.classList.add('is-active');
}
function finishAction() {
  const completed = ACTIONS[active.name].label;
  const isAi = active.source === 'ai';
  active = null;
  const next = queue.next();
  if (next) { startAction(next); return; }
  idleTransition = 0;
  transitionFrom = { ...currentPose };
  $('#motion-status').textContent = '待机中';
  $('#motion-time').textContent = 'IDLE';
  $('#motion-dot').classList.remove('is-active');
  quickButtons.forEach((button) => button.classList.remove('is-active'));
  speech.classList.remove('is-active');
  if (!isAi) setSpeech('还有什么想和我一起做的？');
  setFeedback(isAi ? '这组动作完成啦，还想聊些什么？' : `「${completed}」完成啦，再给我一个小指令吧。`, 'success');
}
function stopMotion() {
  active = null;
  queue.clear();
  transitionFrom = { ...currentPose };
  idleTransition = 0;
  $('#motion-status').textContent = ready ? '待机中' : '正在准备';
  $('#motion-time').textContent = 'IDLE';
  $('#motion-dot').classList.remove('is-active');
  speech.classList.remove('is-active');
  quickButtons.forEach((button) => button.classList.remove('is-active'));
}
function playPlan(plan) {
  const actions = expandPlan(plan);
  stopMotion();
  face.setExpression(plan.expression || { name: 'neutral', intensity: .6 }, Math.max(8000, plan.reply.length * 210 + 3000));
  const first = actions.shift();
  actions.forEach((action) => queue.add(action));
  if (first) startAction(first);
}
function submitCommand(command) {
  if (!ready || chat?.isBusy()) return;
  const result = parseCommand(command);
  if (result.error) { setFeedback(result.error, 'error'); return; }
  if (active) {
    if (queue.length >= 3 || !queue.add({ name: result.action, speed: 1, intensity: 1, source: 'local' })) {
      setFeedback('MILO 正在努力跟上！已有 3 个动作等待中，请稍等一下。', 'error');
      return;
    }
    setFeedback(`「${ACTIONS[result.action].label}」已排队，第 ${queue.length} 个等待执行。`, 'success');
  } else startAction({ name: result.action, speed: 1, intensity: 1, source: 'local' });
  input.value = '';
}
form.addEventListener('submit', (event) => { event.preventDefault(); if (!chat.handleSubmit(input.value)) submitCommand(input.value); });
// Chinese IME confirmation must not accidentally submit the incomplete text.
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) event.preventDefault();
});
quickButtons.forEach((button) => button.addEventListener('click', () => { chat.beforeDirectAction(); submitCommand(button.dataset.command); }));
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || $('#about-dialog').open || $('#settings-dialog').open || chat.isBusy()) return;
  if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  const command = { 1: '打招呼', 2: '欢迎光临', 3: '跳跃' }[event.key];
  if (command) { event.preventDefault(); chat.beforeDirectAction(); submitCommand(command); }
});
function setFaceView(enabled) {
  if (!scene || !ready) return;
  scene.setFaceView(enabled);
  $('#scene').classList.toggle('is-face-view', enabled);
  $('#face-view').setAttribute('aria-pressed', String(enabled));
  $('#face-view').textContent = enabled ? '返回全身' : '面部特写';
}
expressionButtons.forEach(button => button.addEventListener('click', () => {
  chat.beforeDirectAction();
  face.setExpression({ name: button.dataset.expression, intensity: Number($('#expression-intensity').value) });
  setFaceView(true);
}));
$('#expression-intensity').addEventListener('input', event => {
  face.setExpression({ name: face.expression.name, intensity: Number(event.target.value) });
});
$('#mouth-demo').addEventListener('click', () => {
  const expression = { ...face.expression };
  chat.beforeDirectAction();
  face.setExpression(expression);
  face.startSpeech('你好，欢迎光临。很高兴见到你！', true);
  setFaceView(true);
});
$('#voice-demo').addEventListener('click', () => { face.stopSpeech(); chat.speakPreview(); setFaceView(true); });
$('#face-view').addEventListener('click', () => setFaceView($('#face-view').getAttribute('aria-pressed') !== 'true'));
$('#reset-camera').addEventListener('click', () => { if (scene && ready) { setFaceView(false); setFeedback('视角已回到 MILO 的正面。'); } });
$('#retry').addEventListener('click', () => location.reload());
$('#model-info').addEventListener('click', () => $('#about-dialog').showModal());
$('#close-about').addEventListener('click', () => $('#about-dialog').close());
$('#about-dialog').addEventListener('click', (event) => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) event.currentTarget.close(); } });

function showError(message) {
  ready = false;
  chat?.cancel();
  enableControls(false);
  queue.clear();
  active = null;
  cancelAnimationFrame(animationFrame);
  animationFrame = null;
  $('#scene-loading').hidden = true;
  $('#scene-error').hidden = false;
  $('#error-description').textContent = message;
  $('#connection-status').lastChild.textContent = ' 暂未连接';
  setFeedback('模型未就绪，暂时不能执行动作。', 'error');
}

function frame(timestamp) {
  if (!ready) return;
  const dt = lastFrame === null ? 0 : Math.min((timestamp - lastFrame) / 1000, .05);
  lastFrame = timestamp;
  idleTime += dt;
  if (active) {
    elapsed += dt;
    const duration = ACTIONS[active.name].duration / active.speed;
    const pose = poseAt(active.name, elapsed / duration, active.intensity);
    currentPose = blendPose(transitionFrom, pose, elapsed / .15);
    if (elapsed >= duration) finishAction();
  } else {
    idleTransition += dt / .35;
    currentPose = blendPose(transitionFrom, idlePose(idleTime, reducedMotion.matches), idleTransition);
  }
  const facePose = face.update(dt);
  const status = `${EXPRESSIONS[face.expression.name].label} · ${face.speech ? face.speech.demo ? '无声嘴型演示' : face.speech.pausedAt !== null ? '朗读暂停' : '朗读中（估算嘴型）' : '未朗读'}`;
  if (status !== lastFaceStatus) {
    $('#face-status').textContent = status;
    expressionButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.expression === face.expression.name)));
    lastFaceStatus = status;
  }
  const strength = `${Math.round(face.expression.intensity * 100)}%`;
  if ($('#expression-strength').textContent !== strength) {
    $('#expression-strength').textContent = strength;
    $('#expression-intensity').value = face.expression.intensity;
  }
  scene.render(currentPose, facePose);
  animationFrame = requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', () => {
  lastFrame = null;
  if (document.hidden) { cancelAnimationFrame(animationFrame); animationFrame = null; }
  else if (ready && animationFrame === null) animationFrame = requestAnimationFrame(frame);
});
window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  cancelAnimationFrame(animationFrame);
  scene?.dispose();
});

async function init() {
  enableControls(false);
  let timeout;
  try {
    const { createScene } = await Promise.race([
      import('./scene.js'),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('LOAD_TIMEOUT')), 18000); }),
    ]);
    clearTimeout(timeout);
    scene = await createScene($('#canvas-container'), () => showError('3D 渲染连接已中断，请重新加载页面后再试。'));
    scene.render(currentPose);
    $('#scene-loading').hidden = true;
    $('#connection-status').lastChild.textContent = ' 已就绪';
    $('#motion-status').textContent = '待机中';
    ready = true;
    enableControls(true);
    animationFrame = requestAnimationFrame(frame);
  } catch (error) {
    clearTimeout(timeout);
    console.error('MILO initialization failed:', error);
    const isNetwork = /GLB_|TimeoutError/.test(error.message + error.name) || error.message === 'LOAD_TIMEOUT' || /fetch|import|network|module/i.test(error.message);
    showError(isNetwork ? '3D 模型或引擎加载失败，请确认服务已重启、GLB 文件存在且能访问 cdn.jsdelivr.net，然后重新加载。' : '浏览器无法启动 3D 渲染。请使用支持 WebGL 2 的现代浏览器，并开启硬件加速后重试。');
  }
}
chat = createChat({ playPlan, stopMotion, setFeedback, setSpeech, face, refreshControls: () => enableControls(ready), isReady: () => ready });
init();
