import { ACTIONS } from './commands.js';

export const PLAN_LIMITS = Object.freeze({ steps: 4, executions: 6, reply: 600, speedMin: .6, speedMax: 1.6, intensityMin: .5, intensityMax: 1.2 });
export const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['reply', 'actions'],
  properties: {
    reply: { type: 'string', minLength: 1, maxLength: PLAN_LIMITS.reply },
    actions: { type: 'array', maxItems: PLAN_LIMITS.steps, items: {
      type: 'object', additionalProperties: false,
      required: ['name', 'speed', 'intensity', 'repeat'],
      properties: {
        name: { type: 'string', enum: Object.keys(ACTIONS) },
        speed: { type: 'number', minimum: PLAN_LIMITS.speedMin, maximum: PLAN_LIMITS.speedMax },
        intensity: { type: 'number', minimum: PLAN_LIMITS.intensityMin, maximum: PLAN_LIMITS.intensityMax },
        repeat: { type: 'integer', minimum: 1, maximum: 3 },
      },
    } },
  },
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function exactKeys(value, keys) {
  return isObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function inRange(value, min, max) { return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max; }

// Shared by server and browser. A malformed plan is rejected atomically.
export function validatePlan(plan) {
  if (!exactKeys(plan, ['reply', 'actions'])) throw new Error('回复必须只包含 reply 和 actions。');
  if (typeof plan.reply !== 'string' || !plan.reply.trim() || plan.reply.length > PLAN_LIMITS.reply) throw new Error('回复文字为空或超过 600 字。');
  if (!Array.isArray(plan.actions) || plan.actions.length > PLAN_LIMITS.steps) throw new Error('动作方案最多包含 4 步。');
  let executions = 0;
  const actions = plan.actions.map((action) => {
    if (!exactKeys(action, ['name', 'speed', 'intensity', 'repeat'])) throw new Error('动作字段不完整或包含不支持的字段。');
    if (typeof action.name !== 'string' || !Object.hasOwn(ACTIONS, action.name)) throw new Error('模型返回了尚未实现的动作。');
    if (!inRange(action.speed, PLAN_LIMITS.speedMin, PLAN_LIMITS.speedMax)) throw new Error('动作速度必须在 0.6～1.6 之间。');
    if (!inRange(action.intensity, PLAN_LIMITS.intensityMin, PLAN_LIMITS.intensityMax)) throw new Error('动作幅度必须在 0.5～1.2 之间。');
    if (!Number.isInteger(action.repeat) || action.repeat < 1 || action.repeat > 3) throw new Error('每步动作必须执行 1～3 次。');
    executions += action.repeat;
    return { name: action.name, speed: action.speed, intensity: action.intensity, repeat: action.repeat };
  });
  if (executions > PLAN_LIMITS.executions) throw new Error('一个方案最多执行 6 次动作。');
  return { reply: plan.reply.trim(), actions };
}

export function expandPlan(plan) {
  return validatePlan(plan).actions.flatMap((step) => Array.from({ length: step.repeat }, () => ({ name: step.name, speed: step.speed, intensity: step.intensity, source: 'ai' })));
}

export function describePlan(plan) {
  const { actions } = validatePlan(plan);
  return actions.length ? actions.map((step) => `${ACTIONS[step.name].label} ×${step.repeat} · 速度 ${step.speed} · 幅度 ${step.intensity}`).join(' → ') : '这次只聊天，不执行动作';
}
