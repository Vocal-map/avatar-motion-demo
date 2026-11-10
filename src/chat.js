import { validatePlan, describePlan } from './action-plan.js';
import { createVoice } from './voice.js';
import { createVolcVoice } from './volc-voice.js';

const $ = (selector) => document.querySelector(selector);
const SETTINGS_KEY = 'milo-chat-preferences-v1';
const DEFAULTS = { persona: '', language: 'zh-CN' };
function readPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    return { persona: typeof saved?.persona === 'string' ? saved.persona.slice(0, 600) : '', language: ['zh-CN', 'en-US', 'auto'].includes(saved?.language) ? saved.language : 'zh-CN' };
  } catch { return { ...DEFAULTS }; }
}

export function createChat({ playPlan, stopMotion, setFeedback, setSpeech, refreshControls, isReady, face }) {
  let preferences = readPreferences();
  let mode = 'local';
  let config = null;
  let busy = false;
  let history = [];
  let generation = 0;
  let request = null;
  const log = $('#chat-log');
  let voiceStatus = 'idle';
  const voice = createVoice({
    onStart: text => face.startSpeech(text), onBoundary: index => face.boundary(index),
    onPause: () => face.pauseSpeech(), onResume: () => face.resumeSpeech(), onEnd: () => face.stopSpeech(),
    onError: () => setFeedback('浏览器暂时无法朗读，文字、表情与动作仍可使用。', 'error'),
  });
  const cloudVoice = createVolcVoice({
    timeoutMs: () => config?.tts?.timeoutMs || 60000,
    onStart: (cues, duration, clock) => face.startTimedSpeech(cues, duration, clock),
    onPause: () => face.pauseSpeech(), onResume: () => face.resumeSpeech(),
    onEnd: () => { face.stopSpeech(); $('#tts-progress').textContent = ''; },
    onStatus: value => {
      voiceStatus = value;
      updateVoiceControls();
    },
    onTime: (time, duration) => { $('#tts-progress').textContent = `${(time / 1000).toFixed(1)} / ${(duration / 1000).toFixed(1)} 秒`; },
    onError: message => setFeedback(message, 'error'),
  });
  function canSpeak() {
    return $('#voice-provider').value === 'browser' ? 'speechSynthesis' in window : !!config?.tts?.configured;
  }
  function updateVoiceControls() {
    const cloud = $('#voice-provider').value === 'volcengine';
    const labels = { loading: '火山语音生成中…', playing: '火山语音 · 字词同步', paused: '语音已暂停', blocked: '请点击播放语音', error: '语音未完成，可重新朗读' };
    $('#tts-status').textContent = cloud
      ? labels[voiceStatus] || (config?.tts?.configured ? '火山语音已配置 · 字词同步' : '火山语音未配置')
      : '浏览器朗读 · 文字节奏估算';
    $('#tts-status').title = cloud ? config?.tts?.reason || '按真实字词时间戳对齐音频，字内嘴型由拼音估算；首次合成时验证连接。' : '浏览器提供语音，嘴型根据文字节奏估算。';
    $('#tts-playback').hidden = !cloud || !['playing', 'paused', 'blocked'].includes(voiceStatus);
    $('#tts-playback').textContent = voiceStatus === 'playing' ? '暂停语音' : voiceStatus === 'blocked' ? '播放语音' : '继续语音';
    $('#voice-toggle').disabled = !canSpeak();
    refreshControls();
  }

  function setBusy(value) {
    busy = value;
    $('#send-button span').textContent = value ? '思考中…' : mode === 'ai' ? '发送消息' : '发送指令';
    $('#conversation').setAttribute('aria-busy', String(value));
    refreshControls();
  }
  function appendMessage(role, text) {
    $('#chat-empty')?.remove();
    const row = document.createElement('div');
    row.className = `chat-message ${role}`;
    const label = document.createElement('strong');
    label.textContent = role === 'user' ? '你' : 'MILO';
    const content = document.createElement('p');
    content.textContent = text;
    row.append(label, content);
    log.append(row);
    while (log.children.length > 24) log.firstElementChild.remove();
    log.scrollTop = log.scrollHeight;
    return content;
  }
  function cancelRequest(message = '本次请求已取消。') {
    generation++;
    if (request) {
      request.controller.abort();
      request.output.textContent = message;
      request.output.parentElement.classList.remove('is-pending');
      request.output.parentElement.classList.add('is-note');
      request = null;
    }
    setBusy(false);
  }
  function cancelVoice() { voice.cancel(); cloudVoice.cancel(); }
  function stop(message = '已停止当前回复和动作。') {
    cancelRequest();
    cancelVoice();
    stopMotion();
    face.reset();
    $('#action-plan').hidden = true;
    setSpeech('我在这里，等你下一句话。');
    setFeedback(message);
  }
  function speak(text, language) {
    if (!$('#voice-toggle').checked) return;
    if (!canSpeak()) { setFeedback(config?.tts?.reason || '所选语音服务暂不可用，请检查配置。', 'error'); return; }
    if ($('#voice-provider').value === 'volcengine') void cloudVoice.speak(text);
    else voice.speak(text, language);
  }
  function setMode(next) {
    if (next === 'ai' && !config?.configured) return;
    stop('');
    mode = next;
    $('#mode-local').setAttribute('aria-pressed', String(mode === 'local'));
    $('#mode-ai').setAttribute('aria-pressed', String(mode === 'ai'));
    $('#conversation').hidden = mode !== 'ai';
    $('#ai-privacy').hidden = mode !== 'ai';
    $('#command-input').placeholder = mode === 'ai' ? '聊点什么，或说「先挥手，再慢慢鞠躬两次」…' : '输入「打招呼」「欢迎光临」或「跳跃」…';
    $('#send-button span').textContent = mode === 'ai' ? '发送消息' : '发送指令';
    setFeedback(mode === 'ai' ? 'AI 会结合对话生成回复和动作；下方按钮可直接执行本地动作。' : '本地动作即时执行，无需调用模型服务。');
  }

  async function send(message) {
    if (busy || !isReady()) return;
    const text = message.trim();
    if (!text) { setFeedback('先写一句想对 MILO 说的话吧。', 'error'); return; }
    if (text.length > 1000) { setFeedback('每次最多发送 1000 字。', 'error'); return; }
    if (!config?.configured) { setFeedback('请先配置 DeepSeek，再重启本地服务。', 'error'); return; }
    stopMotion();
    cancelVoice();
    face.reset();
    $('#action-plan').hidden = true;
    const turnPreferences = { ...preferences };
    const id = ++generation;
    const controller = new AbortController();
    appendMessage('user', text);
    const output = appendMessage('assistant', '让我想一想…');
    output.parentElement.classList.add('is-pending');
    request = { id, controller, output };
    setBusy(true);
    setSpeech('让我想一想…');
    setFeedback('MILO 正在组织回复、表情和动作，可以点击「停止」取消。');
    $('#command-input').value = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.min(125000, (config.timeoutMs || 30000) + 5000));
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, history, ...turnPreferences }), signal: controller.signal });
      let data;
      try { data = await response.json(); }
      catch { throw new Error('本地 AI 服务未返回有效数据，请检查终端并重启服务。'); }
      if (!response.ok) throw new Error(data.error?.message || '模型调用失败，请稍后重试。');
      if (id !== generation || !isReady()) return;
      const plan = validatePlan(data);
      output.textContent = plan.reply;
      output.parentElement.classList.remove('is-pending');
      history = [...history, { role: 'user', content: text }, { role: 'assistant', content: plan.reply }].slice(-12);
      $('#action-plan').textContent = describePlan(plan);
      $('#action-plan').hidden = false;
      setSpeech(plan.reply);
      playPlan(plan);
      speak(plan.reply, turnPreferences.language);
      setFeedback(plan.actions.length ? '已收到回复，正在依次执行动作。' : 'MILO 回复了你，这次没有安排动作。', 'success');
      log.scrollTop = log.scrollHeight;
    } catch (error) {
      if (id !== generation) return;
      const message = timedOut ? '等待回复超时，请重试。' : error.name === 'AbortError' ? '请求已取消。' : error.message;
      output.textContent = message;
      output.parentElement.classList.remove('is-pending');
      output.parentElement.classList.add('is-note');
      if (!$('#command-input').value) $('#command-input').value = text;
      setSpeech('这次没连接上，再试一次吧。');
      setFeedback(message, 'error');
    } finally {
      clearTimeout(timer);
      if (id === generation) { request = null; setBusy(false); }
    }
  }

  $('#mode-local').addEventListener('click', () => setMode('local'));
  $('#mode-ai').addEventListener('click', () => setMode('ai'));
  $('#stop-action').addEventListener('click', () => stop());
  $('#clear-chat').addEventListener('click', () => {
    stop('对话已清空，下次从新话题开始。');
    history = [];
    log.replaceChildren();
    const empty = document.createElement('p');
    empty.id = 'chat-empty'; empty.className = 'chat-empty';
    empty.textContent = '开始一个新话题吧，MILO 在听。';
    log.append(empty);
  });
  $('#voice-toggle').disabled = true;
  $('#voice-provider').addEventListener('change', () => { cancelVoice(); updateVoiceControls(); });
  $('#tts-playback').addEventListener('click', () => {
    if (voiceStatus === 'playing') cloudVoice.pause();
    else void cloudVoice.resume();
  });
  $('#voice-toggle').addEventListener('change', () => {
    if (!$('#voice-toggle').checked) cancelVoice();
  });
  $('#chat-settings').addEventListener('click', () => {
    $('#persona-input').value = preferences.persona;
    $('#reply-language').value = preferences.language;
    $('#settings-dialog').showModal();
  });
  $('#close-settings').addEventListener('click', () => $('#settings-dialog').close());
  $('#settings-form').addEventListener('submit', (event) => {
    event.preventDefault();
    preferences = { persona: $('#persona-input').value.trim(), language: $('#reply-language').value };
    let persisted = true;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(preferences)); } catch { persisted = false; }
    $('#settings-dialog').close();
    setFeedback(persisted ? '角色设定已保存，下次 AI 对话生效。' : '角色设定已应用；当前浏览器无法持久保存，刷新后将重置。', 'success');
  });

  async function loadServiceStatus() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch('/api/config', { signal: controller.signal });
      if (!response.ok) throw new Error();
      config = await response.json();
      $('#mode-ai').disabled = !config.configured;
      $('#ai-status').textContent = config.configured ? `AI 已配置 · ${config.model}` : 'DeepSeek 未配置 · 本地动作可用';
      $('#ai-status').title = config.configured ? `服务：${config.providerHost}。配置已读取，首次发送时验证连接。` : config.reason;
      if (!config.configured) setFeedback(config.reason || 'AI 模式需要配置 DeepSeek API Key；本地动作可直接使用。');
    } catch {
      $('#ai-status').textContent = 'AI 服务未连接 · 本地动作可用';
      $('#ai-status').title = '请通过 node scripts/serve.mjs 启动带 AI 接口的本地服务。';
    } finally { clearTimeout(timer); updateVoiceControls(); }
  }
  loadServiceStatus();
  window.addEventListener('pagehide', () => { cancelRequest(); cancelVoice(); });
  return {
    isBusy: () => busy,
    canSpeak,
    speakPreview: () => {
      if (!isReady() || busy) return;
      if (!canSpeak()) { setFeedback(config?.tts?.reason || '所选语音服务暂不可用。', 'error'); return; }
      cancelVoice();
      $('#voice-toggle').checked = true;
      speak('你好，欢迎光临。很高兴见到你！', 'zh-CN');
    },
    handleSubmit: (message) => { if (mode !== 'ai') return false; void send(message); return true; },
    beforeDirectAction: () => { cancelVoice(); face.reset(); if (mode === 'ai') { cancelRequest(); stopMotion(); $('#action-plan').hidden = true; } },
    cancel: () => { cancelRequest(); cancelVoice(); face.reset(); },
  };
}
