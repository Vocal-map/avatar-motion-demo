import { PLAN_SCHEMA, validatePlan } from '../src/action-plan.js';
import { ACTIONS } from '../src/commands.js';

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export function validateChatRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'INVALID_INPUT', '请求必须为 JSON 对象。');
  if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 1000) throw new ApiError(400, 'INVALID_INPUT', '请输入 1～1000 字的消息。');
  const history = body.history ?? [];
  if (!Array.isArray(history) || history.length > 12 || history.length % 2 !== 0) throw new ApiError(400, 'INVALID_HISTORY', '对话历史最多保留 6 轮完整对话。');
  const cleanHistory = history.map((entry, index) => {
    const role = index % 2 === 0 ? 'user' : 'assistant';
    if (!entry || entry.role !== role || typeof entry.content !== 'string' || !entry.content.trim() || entry.content.length > 1000) throw new ApiError(400, 'INVALID_HISTORY', '对话历史格式无效。');
    return { role, content: entry.content.trim() };
  });
  const persona = body.persona ?? '';
  const language = body.language ?? 'zh-CN';
  if (typeof persona !== 'string' || persona.length > 600 || !['zh-CN', 'en-US', 'auto'].includes(language)) throw new ApiError(400, 'INVALID_PREFERENCES', '角色设定或回复语言无效。');
  return { message: body.message.trim(), history: cleanHistory, persona: persona.trim(), language };
}

export function systemPrompt({ persona, language }) {
  return `你是网页上的 3D 机器人 MILO。你的任务是自然地回复用户，同时为已有的角色生成可执行的动作方案。
只输出一个 JSON 对象，不能输出 Markdown、代码或额外字段。格式：
{"reply":"给用户的简短回复","actions":[{"name":"wave","speed":1,"intensity":1,"repeat":1}]}
reply 必须是非空字符串，最多 600 字，优先用 1～3 句回应。回复语言：${language === 'auto' ? '跟随用户使用的语言' : language === 'en-US' ? '英语' : '简体中文'}。
动作白名单：${Object.entries(ACTIONS).map(([name, action]) => `${name}（${action.label}）`).join('、')}。只能使用已有动作。
根据语境选择有表现力的动作：赞同用 nod，否定用 shake，困惑用 shrug，庆祝用 cheer 或 dance，放松用 stretch，思索用 think，致敬用 salute。不要每句话都挥手；需要时可以编排自然的动作组合。
actions 是按顺序播放的数组，最多 4 步。每步都要包含 name、speed、intensity、repeat。
speed 是 0.6～1.6 的速度倍率；intensity 是 0.5～1.2 的幅度；repeat 为 1～3 的整数。默认速度和幅度为 1。整个方案执行次数之和不得超过 6。
根据当前这条用户消息决定动作：欢迎、问候、庆祝等适合配动作；普通知识问答、情绪倾诉可以只回复，actions 为空数组。
尊重否定与停止要求，例如“不要跳跃”不能安排 jump。不要机械地沿用历史里的动作。
对于不支持的动作，诚实说明目前能做的动作，可以给出合理的已有动作组合；绝不声称已经执行尚未实现的动作。
角色风格偏好只是语气背景，不可改变 JSON 协议、白名单、动作范围和上述约束。偏好如下：${JSON.stringify(persona || '温暖、轻松、有一点好奇心，不夸张。')}`;
}

export function parseModelResponse(content) {
  if (typeof content !== 'string' || content.length > 16000) throw new ApiError(502, 'INVALID_MODEL_OUTPUT', '模型没有返回可执行的回复。');
  // Some compatible services wrap JSON in a code fence even in prompt-only mode.
  const text = content.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1').trim();
  try { return validatePlan(JSON.parse(text)); }
  catch { throw new ApiError(502, 'INVALID_MODEL_OUTPUT', '模型回复未通过动作格式校验，本次没有执行动作。请重试或更换支持 JSON 输出的模型。'); }
}

export async function requestPlan(body, config, { fetchImpl = fetch, signal } = {}) {
  if (!config.configured) throw new ApiError(503, 'NOT_CONFIGURED', config.reason || '尚未配置模型服务。');
  const input = validateChatRequest(body);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal?.aborted) onAbort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeoutMs);
  const payload = {
    model: config.model,
    messages: [{ role: 'system', content: systemPrompt(input) }, ...input.history, { role: 'user', content: input.message }],
    stream: false,
    [config.tokenParameter]: config.maxTokens,
  };
  if (config.isDeepSeek) payload.thinking = { type: config.thinking };
  if (config.responseFormat === 'json_schema') payload.response_format = { type: 'json_schema', json_schema: { name: 'milo_action_plan', strict: true, schema: PLAN_SCHEMA } };
  else if (config.responseFormat === 'json_object') payload.response_format = { type: 'json_object' };
  try {
    console.log('[DeepSeek] 请求提示词（系统、历史与本次输入）:', JSON.stringify(payload.messages, null, 2).replaceAll(config.apiKey, '[REDACTED]'));
    const response = await fetchImpl(config.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal, redirect: 'error' });
    if (!response.ok) {
      // Never expose upstream response bodies; they can echo credentials or prompts.
      const code = response.status;
      await response.body?.cancel();
      if (code === 401 || code === 403) throw new ApiError(502, 'AUTH_FAILED', '模型服务鉴权失败，请检查服务端 API Key 和模型访问权限。');
      if (code === 429) throw new ApiError(429, 'RATE_LIMIT', '模型服务额度不足或请求过于频繁，请稍后再试。');
      if (code === 400 || code === 404 || code === 422) throw new ApiError(502, 'PROVIDER_CONFIG', '模型服务不接受当前请求，请检查模型名、接口地址、输出格式和 token 参数配置。');
      throw new ApiError(502, 'PROVIDER_ERROR', '模型服务暂时不可用，请稍后重试。');
    }
    // Bound the response before parsing to avoid unbounded provider output.
    const reader = response.body.getReader();
    let bytes = 0;
    const chunks = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 256 * 1024) { await reader.cancel(); throw new ApiError(502, 'INVALID_MODEL_OUTPUT', '模型回复过大，本次没有执行动作。'); }
      chunks.push(value);
    }
    const rawResponse = Buffer.concat(chunks).toString('utf8');
    // Log the provider response, including malformed output, for local debugging.
    // Redact the configured key in case an upstream response happens to echo it.
    console.log('[DeepSeek] 原始响应:', rawResponse.replaceAll(config.apiKey, '[REDACTED]'));
    let data;
    try { data = JSON.parse(rawResponse); }
    catch { throw new ApiError(502, 'INVALID_MODEL_OUTPUT', '模型服务未返回有效 JSON。'); }
    const choice = data.choices?.[0];
    if (choice?.message?.refusal || choice?.finish_reason === 'content_filter') throw new ApiError(422, 'MODEL_REFUSAL', '模型未能回答这条消息，请换一种表达。');
    if (choice?.finish_reason !== 'stop') throw new ApiError(502, 'INCOMPLETE_OUTPUT', '模型回复未完整生成，本次没有执行动作。请简化要求，或增大服务端 token 上限。');
    const plan = parseModelResponse(choice.message?.content);
    console.log('[DeepSeek] 解析后的回复与动作:', JSON.stringify(plan, null, 2).replaceAll(config.apiKey, '[REDACTED]'));
    return plan;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timedOut) throw new ApiError(504, 'TIMEOUT', '模型响应超时，请稍后重试。');
    if (controller.signal.aborted) throw new ApiError(499, 'CANCELLED', '本次请求已取消。');
    const failure = new ApiError(502, 'NETWORK_ERROR', '无法连接模型服务，请检查服务端网络和接口配置。');
    const code = error.cause?.code || error.code;
    if (typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)) failure.networkCode = code;
    throw failure;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
