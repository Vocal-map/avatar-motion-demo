import { pinyin } from 'pinyin-pro';
import { shapeForSound } from '../src/speech-timing.js';

// These subdivisions are estimates, never provider phoneme timestamps.
export function buildMouthCues(words) {
  const cues = [];
  for (const word of words) {
    const units = pinyin(word.text, { type: 'all', toneType: 'none' }).filter(unit => /[\p{L}\p{N}]/u.test(unit.origin));
    if (!units.length) continue;
    const duration = (word.endMs - word.startMs) / units.length;
    units.forEach((unit, index) => {
      const start = word.startMs + duration * index, end = word.startMs + duration * (index + 1);
      const add = (shape, from, to) => { if (to > from) cues.push({ shape, startMs: from, endMs: to }); };
      if (unit.isZh) {
        const opening = unit.initial ? duration * .2 : 0;
        if (opening) add(shapeForSound(unit.initial), start, start + opening);
        add(shapeForSound(unit.finalBody || unit.final || unit.pinyin), start + opening, end);
      } else {
        const letters = Array.from(unit.origin).filter(char => /[\p{L}\p{N}]/u.test(char));
        letters.forEach((char, part) => add(shapeForSound(char), start + duration * part / letters.length, start + duration * (part + 1) / letters.length));
      }
    });
  }
  return cues;
}
