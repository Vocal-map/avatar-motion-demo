export const ACTIONS = Object.freeze({
  wave: { label: '打招呼', status: '正在挥手', duration: 2.8, code: 'WAVE', speech: '嗨！很高兴见到你。' },
  bow: { label: '欢迎光临', status: '正在鞠躬', duration: 2.7, code: 'BOW', speech: '欢迎光临，请多关照！' },
  jump: { label: '跳跃', status: '正在跳跃', duration: 1.8, code: 'JUMP', speech: '好耶，一起跳起来！' },
  nod: { label: '点头', status: '正在点头', duration: 2, code: 'NOD', speech: '嗯嗯，我明白啦。' },
  shake: { label: '摇头', status: '正在摇头', duration: 2.2, code: 'SHAKE', speech: '唔，让我换个思路。' },
  shrug: { label: '耸肩', status: '正在耸肩', duration: 2.4, code: 'SHRUG', speech: '这个嘛，我也有点好奇。' },
  cheer: { label: '欢呼', status: '正在欢呼', duration: 2.8, code: 'CHEER', speech: '太棒了，为你欢呼！' },
  dance: { label: '跳舞', status: '正在跳舞', duration: 4, code: 'DANCE', speech: '跟着我的节奏摇摆吧！' },
  stretch: { label: '伸懒腰', status: '正在伸懒腰', duration: 3.5, code: 'STRETCH', speech: '舒展一下，精神满满。' },
  think: { label: '思考', status: '正在思考', duration: 3, code: 'THINK', speech: '让我认真想一想……' },
  salute: { label: '敬礼', status: '正在敬礼', duration: 2.5, code: 'SALUTE', speech: '收到，向你致敬！' },
});

const aliases = [
  ['wave', /打招呼|挥(?:一挥)?手|你好|嗨|\b(?:hello|hi|wave)\b/iu],
  ['bow', /欢迎光临|鞠躬|欢迎|\b(?:welcome|bow)\b/iu],
  ['jump', /跳跃|跳一(?:下|跳)|跳起来|蹦|\bjump\b/iu],
  ['nod', /点头|\bnod\b/iu],
  ['shake', /摇头|\bshake\b/iu],
  ['shrug', /耸肩|摊手|\bshrug\b/iu],
  ['cheer', /欢呼|庆祝|\bcheer\b/iu],
  ['dance', /跳舞|摇摆|\bdance\b/iu],
  ['stretch', /伸懒腰|伸展|舒展|\bstretch\b/iu],
  ['think', /思考|想一想|\bthink\b/iu],
  ['salute', /敬礼|致敬|\bsalute\b/iu],
];

// Multiple distinct intents are rejected instead of silently choosing one.
export function parseCommand(input) {
  const text = String(input ?? '').normalize('NFKC').trim();
  if (!text) return { error: '先写一句话吧，比如「打招呼」。' };
  if (/(?:不要|别|不用|停止|取消|不能|不想|不许)|\b(?:don[’']?t|do not|stop|cancel)\b/iu.test(text)) {
    return { error: '收到，这次不执行动作。想互动时，可以从下方动作库选择。' };
  }
  const found = aliases.filter(([, pattern]) => pattern.test(text)).map(([action]) => action);
  if (found.length > 1) return { error: '本地模式一次做一个动作吧；切换 AI 对话可以编排组合动作。' };
  if (!found.length) return { error: '试试「点头」「跳舞」「敬礼」，或从下方动作库选择吧。' };
  return { action: found[0] };
}
