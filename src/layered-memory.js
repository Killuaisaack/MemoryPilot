/**
 * MemoryPilot v4.0.0 — Layered Memory System
 *
 * Permanent memory layers (always injected, not keyword-gated):
 *   1. identity   — 人物身份、特征、关系 (WHO)
 *   2. scene      — 特殊场景物理细节 (WHERE)
 *   3. dynamics   — 事件发展、情感变化、关系转折 (WHAT/HOW)
 *
 * Conditional injection (injected only when mentioned in context):
 *   - NPC relations — 提到某 NPC 时注入该 NPC 的关系信息
 *   - Scene details — 提到某场景时注入该场景的物理细节
 *
 * Always-on structures:
 *   - timeline    — 按天/日期排列的故事大纲（常驻注入）
 *   - todos       — 待办事项/约定/伏笔（短期常驻，完成后删除）
 *   - AI Recall   — 可选 Embedding + AI 回忆叙事
 *
 * Storage: extensionSettings.MemoryPilot[chatKey].*
 * Injection: chatMetadata.variables.mp_layered_ctx
 */

const MODULE_NAME = 'MemoryPilot';
const LAYERED_KEY = 'layeredMemory';
const TIMELINE_KEY = 'timeline';
const TODOS_KEY = 'todos';

// ====== Layer Definitions ======

export const LAYER_DEFS = {
  identity: {
    key: 'identity', label: '人物锚点', icon: '👤',
    desc: '人物身份、性格特征、外貌、关系网络',
    color: '#60a5fa', permanent: true,
  },
  scene: {
    key: 'scene', label: '场景锚点', icon: '🏠',
    desc: '重要场景的物理细节、空间布局、环境特征',
    color: '#34d399', permanent: true,
  },
  dynamics: {
    key: 'dynamics', label: '动态锚点', icon: '⚡',
    desc: '事件发展、人物情感变化、关系转折',
    color: '#fbbf24', permanent: true,
  },
};

export const LAYER_KEYS = Object.keys(LAYER_DEFS);

// ====== Helpers ======

function getCtx() { return window.SillyTavern?.getContext?.(); }

function getChatKey() {
  const ctx = getCtx();
  const charId = ctx?.characterId;
  const charObj = Number.isInteger(charId) ? ctx?.characters?.[charId] : null;
  const charScope = String(charObj?.avatar ?? charObj?.name ?? ctx?.chatMetadata?.character_name ?? ctx?.name2 ?? '');
  return `${String(ctx?.chatId ?? ctx?.chatMetadata?.chat_file_name ?? 'default')}::${charScope}`;
}

function getChatStore() {
  const ctx = getCtx();
  if (!ctx?.extensionSettings) return null;
  if (!ctx.extensionSettings[MODULE_NAME]) ctx.extensionSettings[MODULE_NAME] = {};
  const ck = getChatKey();
  if (!ctx.extensionSettings[MODULE_NAME][ck]) ctx.extensionSettings[MODULE_NAME][ck] = {};
  return ctx.extensionSettings[MODULE_NAME][ck];
}

let _saveTimer = null;
function saveDebounced() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { try { getCtx()?.saveSettingsDebounced?.(); } catch {} }, 5000);
}

function gid() { return 'la_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

// ====== Layered Memory CRUD ======

export function loadLayered() {
  const store = getChatStore();
  const raw = store?.[LAYERED_KEY];
  const result = {};
  for (const k of LAYER_KEYS) result[k] = Array.isArray(raw?.[k]) ? raw[k] : [];
  return result;
}

export function saveLayered(data) {
  const store = getChatStore();
  if (!store) return;
  const clean = {};
  for (const k of LAYER_KEYS) clean[k] = Array.isArray(data?.[k]) ? data[k] : [];
  store[LAYERED_KEY] = clean;
  saveDebounced();
}

export function addLayeredEntry(layer, entry) {
  if (!LAYER_DEFS[layer]) return null;
  const data = loadLayered();
  const item = {
    id: gid(), layer,
    label: entry.label || '',
    content: entry.content || '',
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    sourceFloors: entry.sourceFloors || null,
    dateLabel: entry.dateLabel || '',
    role: entry.role || '',           // major/minor/npc (for identity layer)
    aliases: Array.isArray(entry.aliases) ? entry.aliases : [], // character aliases
    createdAt: Date.now(), updatedAt: Date.now(),
    pinned: entry.pinned !== false,
  };
  data[layer].push(item);
  saveLayered(data);
  return item;
}

export function updateLayeredEntry(layer, id, patch) {
  const data = loadLayered();
  const list = data[layer]; if (!list) return false;
  const idx = list.findIndex(x => x.id === id); if (idx < 0) return false;
  for (const k of ['label', 'content', 'tags', 'sourceFloors', 'dateLabel', 'pinned']) {
    if (patch[k] !== undefined) list[idx][k] = patch[k];
  }
  list[idx].updatedAt = Date.now();
  saveLayered(data);
  return true;
}

export function deleteLayeredEntry(layer, id) {
  const data = loadLayered();
  const list = data[layer]; if (!list) return false;
  const idx = list.findIndex(x => x.id === id); if (idx < 0) return false;
  list.splice(idx, 1);
  saveLayered(data);
  return true;
}

// ====== Timeline CRUD ======

export function loadTimeline() {
  const store = getChatStore();
  return Array.isArray(store?.[TIMELINE_KEY]) ? store[TIMELINE_KEY] : [];
}

export function saveTimeline(entries) {
  const store = getChatStore();
  if (!store) return;
  store[TIMELINE_KEY] = Array.isArray(entries) ? entries : [];
  saveDebounced();
}

export function addTimelineEntry(entry) {
  const tl = loadTimeline();
  const item = {
    id: gid(),
    dateLabel: entry.dateLabel || '',
    summary: entry.summary || '',
    floorRange: entry.floorRange || null,
    importance: entry.importance || 'normal', // normal | key | turning
    createdAt: Date.now(),
  };
  tl.push(item);
  // Sort by dateLabel (lexicographic for structured dates) then by createdAt
  tl.sort((a, b) => (a.dateLabel || '').localeCompare(b.dateLabel || '') || a.createdAt - b.createdAt);
  saveTimeline(tl);
  return item;
}

export function updateTimelineEntry(id, patch) {
  const tl = loadTimeline();
  const idx = tl.findIndex(x => x.id === id); if (idx < 0) return false;
  for (const k of ['dateLabel', 'summary', 'floorRange', 'importance']) {
    if (patch[k] !== undefined) tl[idx][k] = patch[k];
  }
  saveTimeline(tl);
  return true;
}

export function deleteTimelineEntry(id) {
  const tl = loadTimeline();
  const idx = tl.findIndex(x => x.id === id); if (idx < 0) return false;
  tl.splice(idx, 1);
  saveTimeline(tl);
  return true;
}

// ====== Todos (待办事项/约定/伏笔) CRUD ======
// Short-term always-injected items. Completed ones get removed.
// Prevents "promise amnesia" when old floors are summarized + hidden.

export function loadTodos() {
  const store = getChatStore();
  return Array.isArray(store?.[TODOS_KEY]) ? store[TODOS_KEY] : [];
}

export function saveTodos(items) {
  const store = getChatStore();
  if (!store) return;
  store[TODOS_KEY] = Array.isArray(items) ? items : [];
  saveDebounced();
}

export function addTodo(entry) {
  const todos = loadTodos();
  const item = {
    id: gid(),
    content: entry.content || '',
    dateLabel: entry.dateLabel || '',   // when it should happen ("D7下午3点")
    source: entry.source || 'manual',  // manual | auto
    createdAt: Date.now(),
    done: false,
  };
  todos.push(item);
  saveTodos(todos);
  return item;
}

export function completeTodo(id) {
  const todos = loadTodos();
  const idx = todos.findIndex(x => x.id === id); if (idx < 0) return false;
  todos.splice(idx, 1); // remove completely — done todos don't need to stay
  saveTodos(todos);
  return true;
}

export function deleteTodo(id) { return completeTodo(id); } // alias

export function updateTodo(id, patch) {
  const todos = loadTodos();
  const idx = todos.findIndex(x => x.id === id); if (idx < 0) return false;
  for (const k of ['content', 'dateLabel', 'done']) {
    if (patch[k] !== undefined) todos[idx][k] = patch[k];
  }
  saveTodos(todos);
  return true;
}

// ====== Relative Time Calculation ======
// Inspired by Horae: convert absolute dateLabels to relative expressions

export function computeRelativeTime(dateLabel, currentDateLabel) {
  if (!dateLabel || !currentDateLabel) return '';
  // Try to parse "D{n}" format (Day number)
  const dayMatch = dateLabel.match(/^D(\d+)$/i);
  const curMatch = currentDateLabel.match(/^D(\d+)$/i);
  if (dayMatch && curMatch) {
    const diff = parseInt(curMatch[1]) - parseInt(dayMatch[1]);
    if (diff === 0) return '今天';
    if (diff === 1) return '昨天';
    if (diff === 2) return '前天';
    if (diff > 2 && diff <= 7) return diff + '天前';
    if (diff > 7 && diff <= 14) return '上周';
    if (diff > 14) return Math.floor(diff / 7) + '周前';
    return '';
  }
  // Try YYYY/MM/DD or YYYYMMDD
  const parseDate = (s) => {
    const m1 = s.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
    if (m1) return new Date(+m1[1], +m1[2] - 1, +m1[3]);
    const m2 = s.match(/(\d{4})(\d{2})(\d{2})/);
    if (m2) return new Date(+m2[1], +m2[2] - 1, +m2[3]);
    return null;
  };
  const d1 = parseDate(dateLabel), d2 = parseDate(currentDateLabel);
  if (d1 && d2) {
    const diff = Math.floor((d2 - d1) / 86400000);
    if (diff === 0) return '今天';
    if (diff === 1) return '昨天';
    if (diff === 2) return '前天';
    if (diff > 2 && diff <= 7) return diff + '天前';
    if (diff > 7 && diff <= 30) return Math.floor(diff / 7) + '周前';
    if (diff > 30) return Math.floor(diff / 30) + '个月前';
  }
  return '';
}

// ====== Injection ======

/**
 * Build full layered injection text.
 * - Timeline: always injected
 * - Todos: always injected (short-term reminders)
 * - Identity (NPC): conditionally injected — only NPCs mentioned in recent context
 * - Scene: conditionally injected — only scenes mentioned in recent context
 * - Dynamics: always injected (relationship changes are always relevant)
 *
 * @param {string} [contextText] - recent conversation text for conditional matching
 */
export function buildLayeredInjection(contextText) {
  const data = loadLayered();
  const timeline = loadTimeline();
  const todos = loadTodos();
  const sections = [];
  const ctxNorm = (contextText || '').toLowerCase();

  // Timeline (always present)
  if (timeline.length) {
    const tl = timeline.map(e => {
      const imp = e.importance === 'turning' ? '★' : e.importance === 'key' ? '●' : '·';
      return `${imp} ${e.dateLabel || '?'}: ${e.summary}`;
    });
    sections.push(`<故事时间线>\n${tl.join('\n')}\n</故事时间线>`);
  }

  // Todos (always present — these are short-term must-remember items)
  const activeTodos = todos.filter(t => !t.done);
  if (activeTodos.length) {
    const todoLines = activeTodos.map(t => {
      return t.dateLabel ? `· ${t.content}（${t.dateLabel}）` : `· ${t.content}`;
    });
    sections.push(`<待办事项与约定>\n${todoLines.join('\n')}\n</待办事项与约定>`);
  }

  // Identity (conditional: only inject NPCs mentioned in context)
  const identityItems = (data.identity || []).filter(x => x.pinned !== false);
  if (identityItems.length) {
    let matched;
    if (ctxNorm) {
      matched = identityItems.filter(item => {
        const labelNorm = (item.label || '').toLowerCase();
        const aliases = (item.aliases || []).map(a => a.toLowerCase());
        return ctxNorm.includes(labelNorm) || aliases.some(a => ctxNorm.includes(a));
      });
    } else {
      matched = identityItems; // no context → inject all (first turn, etc.)
    }
    if (matched.length) {
      const lines = matched.map(item => {
        let line = `[${item.label}]`;
        if (item.role) line += `(${item.role})`;
        if (item.aliases?.length) line += `(别名:${item.aliases.join('/')})`;
        line += ` ${item.content}`;
        return line;
      });
      sections.push(`<人物锚点>\n${lines.join('\n')}\n</人物锚点>`);
    }
  }

  // Scene (conditional: only inject scenes mentioned in context)
  const sceneItems = (data.scene || []).filter(x => x.pinned !== false);
  if (sceneItems.length) {
    let matched;
    if (ctxNorm) {
      matched = sceneItems.filter(item => {
        const labelNorm = (item.label || '').toLowerCase();
        // Also check tags for location name variants
        const tagNorms = (item.tags || []).map(t => t.toLowerCase());
        return ctxNorm.includes(labelNorm) || tagNorms.some(t => ctxNorm.includes(t));
      });
    } else {
      matched = sceneItems;
    }
    if (matched.length) {
      const lines = matched.map(item => {
        let line = `[${item.label}]`;
        if (item.dateLabel) line += `(${item.dateLabel})`;
        line += ` ${item.content}`;
        return line;
      });
      sections.push(`<场景锚点>\n${lines.join('\n')}\n</场景锚点>`);
    }
  }

  // Dynamics (always injected — relationship changes are always relevant context)
  const dynamicsItems = (data.dynamics || []).filter(x => x.pinned !== false);
  if (dynamicsItems.length) {
    const lines = dynamicsItems.map(item => {
      let line = `[${item.label}]`;
      if (item.dateLabel) line += `(${item.dateLabel})`;
      line += ` ${item.content}`;
      return line;
    });
    sections.push(`<动态锚点>\n${lines.join('\n')}\n</动态锚点>`);
  }

  return sections.join('\n\n');
}

/**
 * Build AI recall context — a text block of ALL anchors for the AI recall agent to read.
 * The agent then selectively writes a narrative based on current conversation.
 */
export function buildRecallAgentContext() {
  const data = loadLayered();
  const timeline = loadTimeline();
  const parts = [];

  if (timeline.length) {
    parts.push('【时间线】\n' + timeline.map(e => `${e.dateLabel}: ${e.summary}`).join('\n'));
  }
  for (const k of LAYER_KEYS) {
    const items = (data[k] || []).filter(x => x.pinned !== false);
    if (!items.length) continue;
    const def = LAYER_DEFS[k];
    parts.push(`【${def.label}】\n` + items.map(i => `[${i.label}]${i.dateLabel ? '(' + i.dateLabel + ')' : ''} ${i.content}`).join('\n'));
  }
  return parts.join('\n\n');
}

/**
 * Inject layered memories into chatMetadata.variables.
 * Reads recent chat messages for conditional NPC/scene matching.
 */
export function injectLayered() {
  const ctx = getCtx();
  // Build context text from recent messages for conditional injection
  const chat = ctx?.chat || [];
  const recent = chat.slice(-8);
  const contextText = recent.map(m => String(m?.mes || '')).join(' ');

  const text = buildLayeredInjection(contextText);
  try {
    ctx.chatMetadata = ctx.chatMetadata || {};
    ctx.chatMetadata.variables = ctx.chatMetadata.variables || {};
    ctx.chatMetadata.variables['mp_layered_ctx'] = text;
  } catch {}
  try { localStorage.setItem('mp_layered_ctx', text); } catch {}
  return text;
}

/**
 * Inject AI-generated recall narrative.
 * Called after AI recall agent returns its output.
 */
export function injectRecallNarrative(narrative) {
  const ctx = getCtx();
  try {
    ctx.chatMetadata = ctx.chatMetadata || {};
    ctx.chatMetadata.variables = ctx.chatMetadata.variables || {};
    ctx.chatMetadata.variables['mp_recall_narrative'] = narrative || '';
  } catch {}
  try { localStorage.setItem('mp_recall_narrative', narrative || ''); } catch {}
}

// ====== Statistics ======

export function getLayeredStats() {
  const data = loadLayered();
  const tl = loadTimeline();
  const todos = loadTodos();
  const stats = { total: 0, timeline: tl.length, todos: todos.filter(t => !t.done).length };
  for (const k of LAYER_KEYS) { stats[k] = (data[k] || []).length; stats.total += stats[k]; }
  stats.total += tl.length + stats.todos;
  return stats;
}

// ====== Embedding Vector Recall ======
// Inspired by MMPEA: embedding-based semantic retrieval, not keyword matching.
// Flow: query → embedding → cosine similarity vs stored vectors → top-N candidates → AI narrative

const VECTORS_KEY = 'embeddingVectors';

/** Load stored embedding vectors: { id: Float32Array-as-array } */
export function loadVectors() {
  const store = getChatStore();
  return store?.[VECTORS_KEY] || {};
}

export function saveVectors(vectors) {
  const store = getChatStore();
  if (!store) return;
  store[VECTORS_KEY] = vectors || {};
  saveDebounced();
}

/** Cosine similarity between two arrays */
function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Call the /v1/embeddings endpoint (OpenAI compatible).
 * Uses the same API config as MP, but hitting the embeddings path.
 */
export async function getEmbedding(text, apiConfig) {
  const api = apiConfig || {};
  const key = api.key || '';
  const model = api.embeddingModel || 'text-embedding-3-small';
  const rawBase = api.url || '';
  if (!key) throw new Error('API key not configured');
  // Build base URL — strip /chat/completions or /v1/messages, add /v1/embeddings
  let base = String(rawBase).trim().replace(/\/+$/, '');
  base = base.replace(/\/chat\/completions$/i, '').replace(/\/v1\/messages$/i, '');
  if (!base.endsWith('/v1')) base += '/v1';
  const url = base + '/embeddings';

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: text }),
  });
  if (!res.ok) {
    const e = await res.text().catch(() => '');
    throw new Error('Embedding API ' + res.status + ': ' + e.slice(0, 300));
  }
  const d = await res.json();
  return d?.data?.[0]?.embedding || null;
}

/**
 * Build vectors for all layered entries + dynamics that don't have vectors yet.
 * Returns { built: number, total: number, errors: string[] }
 */
export async function buildMissingVectors(apiConfig) {
  const data = loadLayered();
  const vectors = loadVectors();
  const errors = [];
  let built = 0, total = 0;

  const allItems = [];
  for (const k of LAYER_KEYS) {
    for (const item of (data[k] || [])) {
      allItems.push(item);
    }
  }
  // Also include timeline
  for (const e of loadTimeline()) {
    allItems.push({ id: e.id, label: e.dateLabel || '', content: e.summary || '' });
  }

  total = allItems.length;

  for (const item of allItems) {
    if (vectors[item.id]) continue; // already has vector
    const text = `${item.label || ''} ${item.content || ''}`.trim();
    if (!text) continue;
    try {
      const vec = await getEmbedding(text, apiConfig);
      if (vec) { vectors[item.id] = vec; built++; }
    } catch (e) {
      errors.push(`${item.label}: ${e.message}`);
      if (errors.length >= 3) break; // stop after too many errors
    }
    // Rate limit: small delay
    if (built > 0 && built % 5 === 0) await new Promise(r => setTimeout(r, 500));
  }

  saveVectors(vectors);
  return { built, total, errors };
}

/**
 * Semantic recall: embed the query, find top-N most similar entries.
 * Returns array of { id, label, content, dateLabel, layer, score }
 */
export async function semanticRecall(queryText, apiConfig, topN = 5) {
  const queryVec = await getEmbedding(queryText, apiConfig);
  if (!queryVec) return [];

  const vectors = loadVectors();
  const data = loadLayered();
  const timeline = loadTimeline();

  // Build lookup: id → item info
  const lookup = new Map();
  for (const k of LAYER_KEYS) {
    for (const item of (data[k] || [])) {
      lookup.set(item.id, { ...item, layer: k });
    }
  }
  for (const e of timeline) {
    lookup.set(e.id, { id: e.id, label: e.dateLabel || '', content: e.summary || '', layer: 'timeline', dateLabel: e.dateLabel });
  }

  // Score all vectors
  const scored = [];
  for (const [id, vec] of Object.entries(vectors)) {
    const info = lookup.get(id);
    if (!info) continue;
    const score = cosineSim(queryVec, vec);
    scored.push({ ...info, score });
  }

  // Sort by similarity descending
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

/**
 * Get embedding recall config from API settings
 */
export function getEmbeddingConfig() {
  const store = getChatStore();
  const api = store?.mp_api_config || {};
  try { const r = localStorage.getItem('mp_api_config'); if (r) { const parsed = JSON.parse(r); return { ...parsed, ...api }; } } catch {}
  return api;
}

// ====== AI Recall Agent Prompt ======

export const AI_RECALL_PROMPT = `你是一个记忆召回代理。你将收到两样东西：
1. 与当前话题语义最相关的记忆条目（由 Embedding 向量检索筛选出的候选）
2. 当前对话的最近几条消息

你的任务：阅读这些候选记忆，判断哪些确实与当前话题相关，然后用第三人称写出一段简洁的「回忆叙事」。

要求：
- 只写与当前对话直接相关的回忆，丢弃不相关的候选
- 用叙事语气，像在回顾过去（"此前在D-12舱室，他们曾..."），不要用列表格式
- 如果涉及时间，使用相对时间表述（"三天前""上周"），不要写"昨天"除非确实是前一天
- 保留关键细节：具体台词、动作、物品名、数字
- 长度控制在 100-300 字
- 如果候选记忆都和当前话题无关，只输出"无相关回忆"四个字

候选记忆（由语义检索筛选）：
{{memory_context}}

当前对话（最近消息）：
{{recent_messages}}

请输出回忆叙事：`;

// ====== Extraction Prompts ======

export const EXTRACT_LAYERED_PROMPT = `分析以下对话，提取需要永久记住的分层记忆锚点。

分四类提取：

1. identity（人物锚点）：人物身份、外貌、性格特征、关系。
   - label: 人物名 / content: 综合特征描述 / tags: 标签词

2. scene（场景锚点）：重要场景的物理细节。
   - label: 场景名称 / content: 物理描述 / tags: 标签词

3. dynamics（动态锚点）：关键关系转折、情感变化。
   - label: 事件名称 / content: 具体发生了什么 / dateLabel: 故事内时间 / tags: 标签词

4. timeline（时间线条目）：按天/日期的故事大纲。
   - dateLabel: 故事内日期（如 D1, D5, UC0087/07/10）/ summary: 当天要事一句话 / importance: normal/key/turning

时间标签要求（重要！）：
- 使用故事中明确出现的日期/时间，如"UC0087/07/10"、"D3"、"第12天"
- 绝对不要写"昨天""今天""刚才"这种相对时间
- 如果故事中没有明确日期，用楼层范围"第X-Y层"代替

输出格式（每行一个 JSON）：
{"type":"anchor","layer":"identity/scene/dynamics","label":"名称","content":"详细描述","dateLabel":"","tags":["标签"]}
{"type":"timeline","dateLabel":"D1","summary":"一句话概括","importance":"normal/key/turning"}

输入数据：
{{content}}`;

export const EXTRACT_FROM_MEMORIES_PROMPT = `你将看到一组已有的记忆条目。请从中提取永久锚点和时间线。

提取规则：
1. identity: 合并多条记忆中同一人物的信息
2. scene: 提取反复出现或重要的场景
3. dynamics: 提取关键关系转折点
4. timeline: 从记忆的 timeLabel 构建按天/日期的故事大纲

时间标签要求：原样保留记忆中的时间标签，不要转换成相对时间。

输出格式（每行一个 JSON）：
{"type":"anchor","layer":"identity/scene/dynamics","label":"名称","content":"详细描述","dateLabel":"","tags":["标签"]}
{"type":"timeline","dateLabel":"D1","summary":"一句话概括","importance":"normal/key/turning"}

以下是记忆条目：
{{content}}`;
