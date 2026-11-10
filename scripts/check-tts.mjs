import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadTtsConfig, synthesizeSpeech } from '../server/tts.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const config = await loadTtsConfig(root);
try {
  const result = await synthesizeSpeech({ text: '你好，欢迎光临。很高兴见到你！' }, config);
  const output = path.join(root, 'artifacts', 'volc-tts-check.wav');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, Buffer.from(result.audio.base64, 'base64'));
  console.log(JSON.stringify({ success: true, synchronization: result.synchronization, articulation: result.articulation,
    durationMs: result.durationMs, words: result.words.length, mouthCues: result.cues.length, output }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ success: false, code: error.code || 'TTS_CHECK_FAILED', message: error.code ? error.message : '语音检查失败。' }));
  process.exitCode = 1;
}
