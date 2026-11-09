// Own the utterance and discard late events from a cancelled or superseded voice.
export function createVoice({ synthesis = window.speechSynthesis,
  makeUtterance = text => new SpeechSynthesisUtterance(text),
  onStart = () => {}, onBoundary = () => {}, onPause = () => {}, onResume = () => {},
  onEnd = () => {}, onError = () => {} } = {}) {
  let generation = 0;
  let active = null;
  function cancel() {
    generation++;
    active = null;
    synthesis?.cancel();
    onEnd();
  }
  function speak(text, language) {
    cancel();
    if (!synthesis) return false;
    const id = generation;
    try {
      const utterance = makeUtterance(text);
      active = utterance;
      utterance.lang = language === 'auto' ? (/[\u3400-\u9fff]/u.test(text) ? 'zh-CN' : 'en-US') : language;
      const voices = synthesis.getVoices().filter(voice => voice.lang.toLowerCase().startsWith(utterance.lang.slice(0, 2)));
      utterance.voice = voices.find(voice => voice.localService) || voices[0] || null;
      utterance.rate = 1;
      const isCurrent = () => id === generation && active === utterance;
      utterance.onstart = () => { if (isCurrent()) onStart(text); };
      utterance.onboundary = event => { if (isCurrent()) onBoundary(event.charIndex); };
      utterance.onpause = () => { if (isCurrent()) onPause(); };
      utterance.onresume = () => { if (isCurrent()) onResume(); };
      function finish(error) {
        if (!isCurrent()) return;
        active = null;
        onEnd();
        if (error && !['canceled', 'interrupted'].includes(error)) onError(error);
      }
      utterance.onend = () => finish();
      utterance.onerror = event => finish(event.error || 'unknown');
      synthesis.speak(utterance);
      return true;
    } catch {
      if (id === generation) { active = null; onEnd(); onError('unavailable'); }
      return false;
    }
  }
  return { speak, cancel };
}
