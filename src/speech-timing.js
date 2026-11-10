export const MOUTH_SHAPES = Object.freeze({
  rest: { jawOpen: 0, round: 0, wide: 0, lipBite: 0 },
  closed: { jawOpen: 0, round: 0, wide: 0, lipBite: 0 },
  aa: { jawOpen: .65, round: 0, wide: .18, lipBite: 0 },
  ee: { jawOpen: .24, round: 0, wide: .65, lipBite: 0 },
  oh: { jawOpen: .44, round: .7, wide: 0, lipBite: 0 },
  oo: { jawOpen: .18, round: .9, wide: 0, lipBite: 0 },
  fv: { jawOpen: .10, round: 0, wide: .18, lipBite: .8 },
  consonant: { jawOpen: .18, round: .08, wide: .15, lipBite: 0 },
});

export function shapeForSound(sound) {
  const token = String(sound).toLowerCase();
  if (/^[bpm]$/u.test(token)) return 'closed';
  if (token === 'f') return 'fv';
  if (/^[uüv]/u.test(token)) return 'oo';
  if (/^[oɔ]/u.test(token)) return 'oh';
  if (/^a/u.test(token)) return 'aa';
  if (/^[ei]/u.test(token)) return 'ee';
  return 'consonant';
}

export function validateMouthCues(cues, durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 180000
    || !Array.isArray(cues) || !cues.length || cues.length > 4096) throw new Error('语音缺少有效的嘴型时间线。');
  let previousEnd = 0;
  return cues.map(item => {
    if (!item || typeof item.shape !== 'string' || !Object.hasOwn(MOUTH_SHAPES, item.shape)
      || !Number.isFinite(item.startMs) || !Number.isFinite(item.endMs)
      || item.startMs < previousEnd || item.endMs <= item.startMs || item.endMs > durationMs + .01) throw new Error('嘴型时间线格式无效或超出音频范围。');
    previousEnd = item.endMs;
    return { shape: item.shape, startMs: item.startMs, endMs: item.endMs };
  });
}

// Real provider word boundaries; estimated shapes and subdivisions inside words.
// Silence stays closed and the audio playback clock owns timing.
export function sampleMouthCues(segments, timeMs) {
  const neutral = MOUTH_SHAPES.rest;
  if (!Number.isFinite(timeMs)) return { ...neutral };
  const index = segments.findIndex(item => item.startMs <= timeMs && timeMs < item.endMs);
  if (index < 0) return { ...neutral };
  const segment = segments[index], target = MOUTH_SHAPES[segment.shape];
  if (['rest', 'closed'].includes(segment.shape)) return { ...target };
  const edge = Math.min(25, (segment.endMs - segment.startMs) * .25);
  const previous = segments[index - 1];
  const from = previous && segment.startMs - previous.endMs < 1 ? MOUTH_SHAPES[previous.shape] : neutral;
  const alpha = Math.max(0, Math.min(1, (timeMs - segment.startMs) / edge));
  return Object.fromEntries(Object.keys(neutral).map(key => [key, from[key] + (target[key] - from[key]) * alpha]));
}
