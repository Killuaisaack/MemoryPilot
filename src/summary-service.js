// Shared floor-summary helpers used by the manual panel and automatic summarizer.

export const DEFAULT_SUMMARY_PROMPT = `分析以下对话，提取值得长期记忆的重要事件。

聚合原则：同一场景（同一时间段、同一地点、同一组人物的连续互动）合并为一条事件。但如果场景中有明确的话题转折或情感转折，可以拆成2-3条。20条对话通常提取3-6条事件。

每行输出一个 JSON：
{"event":"场景标题","primaryKeywords":["主关键词"],"secondaryKeywords":["辅助关键词"],"entityKeywords":["人物名"],"summary":"详细摘要","timeLabel":"时间标签","timeValue":1234,"floorRange":[起始楼层号,结束楼层号],"priority":"high/medium/low"}

规则：

event 格式为「地点·核心内容概括」，例如「D-12舱室·深夜送三明治与不问原因的开门」。

summary 是最重要的字段。要求：
- 长度 80-300 字，必须保留关键细节
- 保留具体台词的原词或近似原词（"你赢了""十六天我数过""以后只给你看"）
- 保留具体动作和身体语言（"额头抵进肩窝""耳廓发热""声音高半个音"）
- 保留具体物品和数字（"盐味橄榄油煎合成蛋白番茄三明治""22:30按下访问铃"）
- 保留因果链：谁说/做了什么 → 对方什么反应 → 导致什么变化
- 不要概括为"讨论了战争""表达了感情"，要写出具体说了什么、怎么表达的
- 可以用分号连接多个连续动作，不需要每个动作单独成句

primaryKeywords（主关键词，2-6个）：
- 必须是后续 RP 对话中会被原封不动写出来的词
- 优先：具体地名、物品名、活动名、独特称呼/代号、关键台词中的名词
- 例如：「D-12舱室」「三明治」「处分单」「陈胜吴广」「达喀尔」「银星勋章」
- 不要写：「关系突破」「信任危机」「情感表达」这类概括词

secondaryKeywords（辅助关键词，2-6个）：
- 必须是对话中真的会出现的具体词
- 优先：关键动作词、场景特征词、结果词
- 例如：「开门」「道歉」「深夜」「脊椎」「齿痕」「沉默」
- 不要和 primaryKeywords 重复，不要放人物名

entityKeywords：只写人物名/称呼，仅展示不参与召回。

timeLabel 必须输出；没有精确时刻写"当晚/第X天/第X-Y层"。
timeValue 用故事内时间，有时写"时×60+分"，没有写 null。
floorRange：该事件实际涵盖的起止楼层号 [start, end]，根据对话中的 #楼层号 标记确定。必须精确到该事件实际发生的楼层，不要使用整个输入范围。

priority：请严格控制常驻（high）的数量。只有跨聊天仍然成立、长期不变、绝不能忘的核心设定/硬性事实才使用 high；普通关键事件使用 medium，氛围、日常、一次性互动使用 low。一个总结批次中 high 尽量不超过 1 条，绝大多数内容应为 medium 或 low。不要因为事件重要、情绪强烈或摘要写得详细就标为 high。

只输出 JSON，每行一个，不要解释。

对话：
{{content}}`;

const RETRY_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const FETCH_TIMEOUT = 90000;

const normalizeOpenAIBase = value => String(value ?? '').trim().replace(/\/+$/,'').replace(/\/chat\/completions$/i,'');
const normalizeClaudeBase = value => String(value ?? '').trim().replace(/\/+$/,'').replace(/\/v1\/messages$/i,'');
const normalizeGeminiBase = value => String(value ?? '').trim().replace(/\/+$/,'').replace(/\/models\/.*$/i,'');

export function normalizePriority(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (
    normalized === 'high'
    || normalized.includes('常驻')
    || normalized.includes('核心')
    || normalized.includes('绝不能忘')
    || normalized.includes('永久')
  ) return 'high';
  if (
    normalized === 'low'
    || normalized.includes('次级')
    || normalized.includes('次要')
    || normalized.includes('日常')
    || normalized.includes('氛围')
  ) return 'low';
  if (
    normalized === 'medium'
    || normalized === 'main'
    || normalized.includes('主要')
    || normalized.includes('关键')
  ) return 'medium';
  return 'medium';
}

export function normalizeCleaner(cfg) {
  const defaults = {
    blockTags: ['think', 'details'],
    linePrefixes: ['affinity_change:', 'mood_change:', 'state_update:'],
    regexRules: ['^____+$'],
    cleanForRecall: true,
    cleanForBatch: true,
  };
  const src = cfg && typeof cfg === 'object' ? cfg : {};
  const list = (value, fallback) => Array.from(new Set(
    (Array.isArray(value) ? value : fallback).map(x => String(x ?? '').trim()).filter(Boolean),
  ));
  return {
    blockTags: list(src.blockTags, defaults.blockTags),
    linePrefixes: list(src.linePrefixes, defaults.linePrefixes),
    regexRules: list(src.regexRules, defaults.regexRules),
    cleanForRecall: src.cleanForRecall !== false,
    cleanForBatch: src.cleanForBatch !== false,
  };
}

export function applyCleaner(input, cfg) {
  let text = String(input ?? '');
  const conf = normalizeCleaner(cfg);
  for (const rawTag of conf.blockTags) {
    try {
      const re = new RegExp('<\\s*' + rawTag + '\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*' + rawTag + '\\s*>', 'gi');
      text = text.replace(re, ' ');
    } catch {}
  }
  if (conf.linePrefixes.length) {
    const prefixes = conf.linePrefixes.map(x => x.toLowerCase());
    text = text.split(/\r?\n/).filter(line => {
      const trimmed = String(line || '').trim().toLowerCase();
      return !trimmed || !prefixes.some(prefix => trimmed.startsWith(prefix));
    }).join('\n');
  }
  for (const rawRule of conf.regexRules) {
    try { text = text.replace(new RegExp(rawRule, 'gim'), ' '); } catch {}
  }
  return text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

export function extractAllJsonObjects(text) {
  const source = String(text ?? '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const out = [];
  try {
    const parsed = JSON.parse(source);
    if (Array.isArray(parsed)) return parsed.filter(x => x && typeof x === 'object');
    if (parsed && typeof parsed === 'object') return [parsed];
  } catch {}
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          const parsed = JSON.parse(source.slice(start, i + 1));
          if (parsed && typeof parsed === 'object') out.push(parsed);
        } catch {}
        start = -1;
      }
    }
  }
  return out;
}

function getCurrentStore(ctx) {
  if (!ctx?.extensionSettings) return null;
  const root = ctx.extensionSettings.MemoryPilot = ctx.extensionSettings.MemoryPilot || {};
  const charId = ctx.characterId;
  const charObj = Number.isInteger(charId) ? ctx.characters?.[charId] : null;
  const charScope = String(charObj?.avatar ?? charObj?.name ?? ctx.chatMetadata?.character_name ?? ctx.name2 ?? '');
  const key = `${String(ctx.chatId ?? ctx.chatMetadata?.chat_file_name ?? 'default')}::${charScope}`;
  return root[key] || null;
}

export function loadLegacyPanelValue(ctx, key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw != null && raw !== '') return JSON.parse(raw);
  } catch {}
  const store = getCurrentStore(ctx);
  if (store?.[key] != null) return store[key];
  return fallback;
}

export function getSummaryPrompt() {
  try {
    const custom = globalThis.MemoryPilot?.getCustomPrompt?.('analysis', '');
    if (custom) return String(custom).replace(/主要召回关键词|主召回关键词/g, '主关键词').replace(/门控关键词/g, '辅助关键词');
  } catch {}
  try {
    const local = localStorage.getItem('mp_prompt');
    if (local) return local.replace(/主要召回关键词|主召回关键词/g, '主关键词').replace(/门控关键词/g, '辅助关键词');
  } catch {}
  return DEFAULT_SUMMARY_PROMPT;
}

export function getAutoSummaryPrompt() {
  try {
    const custom = globalThis.MemoryPilot?.getCustomPrompt?.('autoSummary', '');
    if (custom) return String(custom).replace(/主要召回关键词|主召回关键词/g, '主关键词').replace(/门控关键词/g, '辅助关键词');
  } catch {}
  return DEFAULT_SUMMARY_PROMPT;
}

function mergeSignals(userSignal) {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT);
  if (!userSignal) return timeout;
  const ctrl = new AbortController();
  const abort = () => ctrl.abort(userSignal.reason || timeout.reason || 'aborted');
  if (userSignal.aborted) ctrl.abort(userSignal.reason);
  else {
    userSignal.addEventListener('abort', abort, { once: true });
    timeout.addEventListener('abort', abort, { once: true });
  }
  return ctrl.signal;
}

async function callOnce(prompt, signal, api, provider, model, key, base) {
  if (provider === 'claude') {
    const res = await fetch((base || 'https://api.anthropic.com') + '/v1/messages', {
      method: 'POST', signal,
      headers: { 'x-api-key': key, 'anthropic-version': api.anthropicVersion || '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(Object.entries({
        model,
        max_tokens: Number.isFinite(Number(api.maxTokens)) ? Number(api.maxTokens) : undefined,
        temperature: api.temperature === '' || api.temperature == null ? undefined : Number(api.temperature),
        top_p: api.topP === '' || api.topP == null ? undefined : Number(api.topP),
        top_k: api.topK === '' || api.topK == null ? undefined : Number(api.topK),
        messages: [{ role: 'user', content: prompt }],
      }).filter(([, value]) => value !== undefined))),
    });
    if (!res.ok) throw Object.assign(new Error('Claude ' + res.status + ': ' + (await res.text()).slice(0, 500)), { status: res.status });
    const data = await res.json();
    return (data.content || []).filter(x => x?.type === 'text').map(x => x.text || '').join('\n');
  }
  if (provider === 'gemini') {
    const res = await fetch((base || 'https://generativelanguage.googleapis.com/v1beta') + '/models/' + encodeURIComponent(model) + ':generateContent', {
      method: 'POST', signal,
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: Object.fromEntries(Object.entries({
          temperature: api.temperature === '' || api.temperature == null ? undefined : Number(api.temperature),
          topP: api.topP === '' || api.topP == null ? undefined : Number(api.topP),
          topK: api.topK === '' || api.topK == null ? undefined : Number(api.topK),
          maxOutputTokens: Number.isFinite(Number(api.maxTokens)) ? Number(api.maxTokens) : undefined,
        }).filter(([, value]) => value !== undefined)),
      }),
    });
    if (!res.ok) throw Object.assign(new Error('Gemini ' + res.status + ': ' + (await res.text()).slice(0, 500)), { status: res.status });
    const data = await res.json();
    return (data.candidates || []).flatMap(x => x?.content?.parts || []).map(x => x?.text || '').join('\n');
  }
  const res = await fetch((base || '').replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST', signal,
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.fromEntries(Object.entries({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: api.temperature === '' || api.temperature == null ? undefined : Number(api.temperature),
      top_p: api.topP === '' || api.topP == null ? undefined : Number(api.topP),
      presence_penalty: api.presencePenalty === '' || api.presencePenalty == null ? undefined : Number(api.presencePenalty),
      frequency_penalty: api.frequencyPenalty === '' || api.frequencyPenalty == null ? undefined : Number(api.frequencyPenalty),
      max_tokens: Number.isFinite(Number(api.maxTokens)) ? Number(api.maxTokens) : undefined,
    }).filter(([, value]) => value !== undefined))),
  });
  if (!res.ok) throw Object.assign(new Error('OpenAI兼容 ' + res.status + ': ' + (await res.text()).slice(0, 500)), { status: res.status });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

export async function callConfiguredLLM(ctx, prompt, signal) {
  const api = loadLegacyPanelValue(ctx, 'mp_api_config', {});
  const provider = api.provider || 'openai';
  const model = api.model || '';
  const key = api.key || '';
  const rawBase = api.url || '';
  const base = provider === 'claude' ? normalizeClaudeBase(rawBase) : provider === 'gemini' ? normalizeGeminiBase(rawBase) : normalizeOpenAIBase(rawBase);
  if (!key || !model) throw new Error('请先在 API 配置中设置 Provider、API Key 和模型');
  let lastError = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return await callOnce(prompt, mergeSignals(signal), api, provider, model, key, base);
    } catch (error) {
      lastError = error;
      if (error?.name === 'AbortError' && signal?.aborted) throw error;
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') lastError = new Error('请求超时（90 秒）');
      const status = error?.status;
      if (status && status >= 400 && status < 500 && status !== 429) throw error;
      if (status && !RETRY_CODES.has(status)) throw error;
      if (attempt < MAX_RETRIES - 1) await new Promise(resolve => setTimeout(resolve, Math.min(2000 * 2 ** attempt, 16000)));
    }
  }
  throw lastError || new Error('API 调用失败');
}

export function buildFloorText(ctx, startFloor, endFloor, cleaner) {
  const chat = ctx?.chat || [];
  const userName = ctx?.name1 || '用户';
  const charName = ctx?.name2 || '角色';
  const lines = [];
  for (let floor = startFloor; floor <= endFloor; floor += 1) {
    const message = chat[floor - 1];
    if (!message || (message.is_system && !message.extra?.memoryPilotAutoHidden)) continue;
    const raw = String(message.mes || '');
    const body = cleaner.cleanForBatch ? applyCleaner(raw, cleaner) : raw;
    if (!body.trim()) continue;
    lines.push(`#${floor}[${message.is_user ? userName : (message.name || charName)}]${body}`);
  }
  return lines.join('\n');
}

export function parseSummaryMemories(raw, options = {}) {
  const startFloor = Number(options.startFloor) || 1;
  const endFloor = Number(options.endFloor) || startFloor;
  const fixedPriority = normalizePriority(options.fixedPriority);
  const useAiPriority = options.priorityMode === 'ai';
  const source = options.source || 'batch';
  const now = Date.now();
  const parsed = extractAllJsonObjects(raw).filter(x => x?.event && x?.summary).map((item, index) => {
    const itemRange = Array.isArray(item.floorRange) && item.floorRange.length >= 2
      ? [Number(item.floorRange[0]), Number(item.floorRange[1])]
      : [startFloor, endFloor];
    const validRange = itemRange.every(Number.isFinite) ? [Math.max(startFloor, itemRange[0]), Math.min(endFloor, itemRange[1])] : [startFloor, endFloor];
    const keySeed = `${startFloor}-${endFloor}-${index}-${String(item.event).slice(0, 32)}`;
    let hash = 2166136261;
    for (let i = 0; i < keySeed.length; i += 1) { hash ^= keySeed.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return {
      ...item,
      id: `mp_auto_${startFloor}_${endFloor}_${(hash >>> 0).toString(36)}`,
      timestamp: now,
      primaryKeywords: Array.isArray(item.primaryKeywords) ? item.primaryKeywords : (Array.isArray(item.keywords) ? item.keywords : []),
      secondaryKeywords: Array.isArray(item.secondaryKeywords) ? item.secondaryKeywords : [],
      entityKeywords: Array.isArray(item.entityKeywords) ? item.entityKeywords : [],
      source,
      floorRange: validRange[0] <= validRange[1] ? validRange : [startFloor, endFloor],
      timeLabel: item.timeLabel || `第${startFloor}-${endFloor}层`,
      timeValue: item.timeValue !== null && item.timeValue !== '' && Number.isFinite(Number(item.timeValue)) ? Number(item.timeValue) : null,
      priority: useAiPriority ? normalizePriority(item.priority) : fixedPriority,
      aiSuggestedPriority: normalizePriority(item.priority),
    };
  });
  // Automatic batches should keep the always-on tier deliberately small.
  // This only affects AI-assisted auto summaries; manual summaries and the
  // explicit fixed-priority mode retain their requested priority unchanged.
  if (useAiPriority && source === 'auto_batch') {
    const highLimit = Math.max(1, Math.ceil(parsed.length * 0.15));
    let highCount = 0;
    for (const memory of parsed) {
      if (memory.priority !== 'high') continue;
      highCount += 1;
      if (highCount > highLimit) {
        memory.priority = 'medium';
        memory.aiSuggestedPriority = 'medium';
      }
    }
  }
  return parsed;
}
