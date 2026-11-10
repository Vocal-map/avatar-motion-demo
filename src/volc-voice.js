import { validateMouthCues } from './speech-timing.js';

export function createVolcVoice({ fetchImpl = fetch, makeAudio = () => new Audio(),
  makeUrl = blob => URL.createObjectURL(blob), revokeUrl = url => URL.revokeObjectURL(url),
  timeoutMs = () => 60000, onStart = () => {}, onPause = () => {}, onResume = () => {},
  onEnd = () => {}, onStatus = () => {}, onTime = () => {}, onError = () => {} } = {}) {
  let generation = 0, request = null, active = null, url = null, retry = null;
  function release() {
    if (active) {
      active.onplaying = active.onpause = active.onwaiting = active.onended = active.onerror = active.ontimeupdate = null;
      active.pause(); active.removeAttribute('src'); active.load(); active = null;
    }
    if (url) { revokeUrl(url); url = null; }
  }
  function cancel() {
    generation++;
    request?.abort(); request = null; retry = null;
    release();
    onEnd(); onStatus('idle');
  }
  async function speak(text) {
    cancel();
    const id = generation;
    const controller = new AbortController();
    request = controller;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.min(125000, timeoutMs() + 5000));
    onStatus('loading');
    try {
      const response = await fetchImpl('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }), signal: controller.signal });
      let data;
      try { data = await response.json(); } catch { throw new Error('本地语音服务未返回有效数据，请重启服务后重试。'); }
      if (id !== generation) return false;
      if (!response.ok) throw new Error(data?.error?.message || '火山语音合成失败。');
      if (data?.provider !== 'volcengine' || data?.synchronization !== 'word' || data?.articulation !== 'estimated' || data?.audio?.mimeType !== 'audio/wav'
        || typeof data.audio.base64 !== 'string' || !data.audio.base64.length || data.audio.base64.length > 12 * 1024 * 1024) throw new Error('语音服务没有返回有效的同步音频。');
      validateMouthCues(data.cues, data.durationMs);
      const binary = atob(data.audio.base64);
      url = makeUrl(new Blob([Uint8Array.from(binary, char => char.charCodeAt(0))], { type: 'audio/wav' }));
      const audio = makeAudio();
      active = audio;
      audio.preload = 'auto'; audio.src = url;
      let started = false;
      const isCurrent = () => id === generation && active === audio;
      audio.onplaying = () => {
        if (!isCurrent()) return;
        if (!started) { started = true; onStart(data.cues, data.durationMs, () => audio.currentTime * 1000); }
        else onResume();
        onStatus('playing');
      };
      audio.onpause = audio.onwaiting = () => { if (isCurrent() && started) { onPause(); onStatus('paused'); } };
      audio.ontimeupdate = () => { if (isCurrent()) onTime(audio.currentTime * 1000, data.durationMs); };
      audio.onended = () => { if (isCurrent()) { generation++; retry = null; release(); onEnd(); onStatus('idle'); } };
      audio.onerror = () => {
        if (!isCurrent()) return;
        generation++; retry = null; release(); onEnd(); onStatus('error'); onError('浏览器无法解码或播放火山语音。');
      };
      retry = async () => {
        if (!isCurrent()) return false;
        try { await audio.play(); return isCurrent(); }
        catch (error) {
          if (!isCurrent()) return false;
          if (error.name === 'NotAllowedError') { onStatus('blocked'); return false; }
          throw error;
        }
      };
      return await retry();
    } catch (error) {
      if (id !== generation) return false;
      retry = null; generation++; release(); onEnd(); onStatus('error');
      onError(timedOut ? '等待火山语音超时，请稍后重试。' : error.name === 'AbortError' ? '语音请求已取消。' : error.message || '无法连接本地语音服务。');
      return false;
    } finally {
      clearTimeout(timer);
      if (request === controller) request = null;
    }
  }
  async function resume() {
    if (!retry) return false;
    try { return await retry(); }
    catch { cancel(); onError('浏览器仍无法播放语音，请重新生成。'); return false; }
  }
  return { speak, cancel, resume, pause: () => active?.pause() };
}
