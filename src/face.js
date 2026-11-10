import { validateMouthCues, sampleMouthCues } from './speech-timing.js';

// Shared, bounded face vocabulary. The model selects a preset, never bone transforms.
export const EXPRESSIONS = Object.freeze({
  neutral: { label: '自然', weights: {} },
  smile: { label: '微笑', weights: { smile: .85, cheek: .4, squint: .12 } },
  curious: { label: '疑惑', weights: { browRaise: .3, browKnit: .45, asymmetry: .5 } },
  surprised: { label: '惊讶', weights: { browRaise: .9, eyeWide: .65, jawOpen: .28, round: .3 } },
  sad: { label: '难过', weights: { frown: .65, browKnit: .45, innerRaise: .5 } },
});

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
export function neutralFace() {
  return { smile: 0, cheek: 0, squint: 0, browRaise: 0, browKnit: 0,
    asymmetry: 0, eyeWide: 0, jawOpen: 0, round: 0, wide: 0, lipBite: 0, frown: 0, innerRaise: 0 };
}

export function validateExpression(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'name') || !Object.hasOwn(value, 'intensity')
    || !Object.hasOwn(EXPRESSIONS, value.name) || typeof value.name !== 'string'
    || typeof value.intensity !== 'number' || !Number.isFinite(value.intensity) || value.intensity < 0 || value.intensity > 1) {
    throw new Error('表情必须包含有效的 name 和 0～1 之间的 intensity。');
  }
  return { name: value.name, intensity: value.intensity };
}

// This is deliberately a text-timed approximation, not phoneme recognition.
// Chinese glyphs do not encode pronunciation; alternate a few restrained shapes.
export function speechTimeline(text) {
  const segments = [];
  let time = 0, offset = 0;
  for (const char of String(text).slice(0, 1000)) {
    const pause = /[，。！？、；：,.!?;:\s]/u.test(char);
    const duration = pause ? (/\s/u.test(char) ? 55 : 240) : /[\u3400-\u9fff]/u.test(char) ? 180 : 80;
    const seed = char.codePointAt(0);
    const closed = /[bpm]/iu.test(char);
    const round = /[ouw]/iu.test(char) || (!/[a-z]/iu.test(char) && seed % 4 === 0);
    const wide = /[eiy]/iu.test(char) || (!/[a-z]/iu.test(char) && seed % 4 === 1);
    segments.push({ start: time, end: time + duration, offset,
      jawOpen: pause || closed ? 0 : round ? .34 : wide ? .25 : .48,
      round: !pause && round ? .65 : 0, wide: !pause && wide ? .6 : 0 });
    time += duration;
    offset += char.length;
  }
  return { segments, duration: time };
}

export class FaceController {
  constructor(clock = () => performance.now()) {
    this.clock = clock;
    this.current = neutralFace();
    this.expression = { name: 'neutral', intensity: .6 };
    this.expiresAt = Infinity;
    this.speech = null;
  }
  setExpression(value, durationMs = 0) {
    this.expression = validateExpression(value);
    this.expiresAt = durationMs > 0 ? this.clock() + durationMs : Infinity;
  }
  startSpeech(text, demo = false) {
    this.speech = { mode: 'estimated', timeline: speechTimeline(text), anchorTime: this.clock(), anchorOffset: 0, pausedAt: null, demo };
  }
  startTimedSpeech(cues, durationMs, readTimeMs) {
    const segments = validateMouthCues(cues, durationMs);
    if (typeof readTimeMs !== 'function') throw new Error('缺少音频播放时钟。');
    this.speech = { mode: 'word', segments, durationMs, readTimeMs, pausedAt: null, demo: false };
    if (this.expiresAt !== Infinity) this.expiresAt = Math.max(this.expiresAt, this.clock() + durationMs + 1500);
  }
  boundary(charIndex) {
    if (!this.speech || this.speech.mode === 'word' || !Number.isFinite(charIndex) || charIndex < 0) return;
    const segment = this.speech.timeline.segments.find(item => item.offset >= charIndex);
    if (segment) { this.speech.anchorOffset = segment.start; this.speech.anchorTime = this.clock(); }
  }
  pauseSpeech() { if (this.speech && this.speech.pausedAt === null) this.speech.pausedAt = this.clock(); }
  resumeSpeech() {
    if (this.speech && this.speech.pausedAt !== null) {
      if (this.speech.mode !== 'word') this.speech.anchorTime += this.clock() - this.speech.pausedAt;
      this.speech.pausedAt = null;
    }
  }
  stopSpeech() {
    this.speech = null;
    for (const key of ['jawOpen', 'round', 'wide', 'lipBite']) this.current[key] = 0;
  }
  reset() { this.stopSpeech(); this.setExpression({ name: 'neutral', intensity: .6 }); }
  update(dt, now = this.clock()) {
    if (now >= this.expiresAt) this.setExpression({ name: 'neutral', intensity: .6 });
    const target = neutralFace();
    for (const [key, weight] of Object.entries(EXPRESSIONS[this.expression.name].weights)) target[key] = weight * this.expression.intensity;
    if (this.speech?.mode === 'word') {
      Object.assign(target, this.speech.pausedAt === null ? sampleMouthCues(this.speech.segments, this.speech.readTimeMs()) : sampleMouthCues([], 0));
    } else if (this.speech) {
      const elapsed = now - this.speech.anchorTime + this.speech.anchorOffset;
      const segment = this.speech.timeline.segments.find(item => item.start <= elapsed && elapsed < item.end);
      // While speaking, lip articulation owns the opening, including punctuation pauses.
      target.jawOpen = 0;
      target.round = 0;
      if (this.speech.pausedAt === null && segment) {
        const phase = (elapsed - segment.start) / (segment.end - segment.start);
        const pulse = Math.sin(Math.PI * phase) ** .7;
        target.jawOpen = segment.jawOpen * pulse;
        target.round = segment.round * pulse;
        target.wide = segment.wide * pulse;
      }
      if (this.speech.demo && elapsed >= this.speech.timeline.duration) this.stopSpeech();
    }
    for (const key of Object.keys(target)) {
      const mouth = ['jawOpen', 'round', 'wide', 'lipBite'].includes(key);
      const immediateClose = this.speech?.mode === 'word' && mouth && target.jawOpen === 0;
      const alpha = immediateClose ? 1 : 1 - Math.exp(-clamp(dt, 0, .1) * (mouth ? 30 : 8));
      this.current[key] += (clamp(target[key]) - this.current[key]) * alpha;
    }
    return { ...this.current };
  }
}
