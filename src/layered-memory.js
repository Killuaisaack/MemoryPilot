/**
 * MemoryPilot v3.6.0 — Layered Memory System
 * 
 * Three memory layers (永久存储, injected every turn):
 *   1. identity   — 人物身份、特征、关系 (WHO)
 *   2. scene      — 特殊场景物理细节 (WHERE)
 *   3. dynamics   — 事件发展、人物情感、关系变化 (WHAT/HOW)
 * 
 * Storage: extensionSettings.MemoryPilot[chatKey].layeredMemory
 * Decoupled from existing mp_memories (regular recall memories).
 * Injected via chatMetadata.variables.mp_layered_ctx for {{getvar::mp_layered_ctx}}
 */

const MODULE_NAME = 'MemoryPilot';
const LAYERED_KEY = 'layeredMemory';

// ====== Layer Definitions ======

export const LAYER_DEFS = {
  identity: {
    key: 'identity',
    label: '人物锚点',
    icon: '👤',
    desc: '人物身份、性格特征、外貌、关系网络',
    color: '#60a5fa',    // blue
    permanent: true,
  },
  scene: {
    key: 'scene',
    label: '场景锚点',
    icon: '🏠',
    desc: '重要场景的物理细节、空间布局、环境特征',
    color: '#34d399',    // green
    permanent: true,
  },
  dynamics: {
    key: 'dynamics',
    label: '动态锚点',
    icon: '⚡',
    desc: '事件发展、人物情感变化、关系转折',
    color: '#fbbf24',    // amber
    permanent: true,
  },
};

export const LAYER_KEYS = Object.keys(LAYER_DEFS);

// ====== Helpers ======

function getCtx() {
  return window.SillyTavern?.getContext?.();
}

function getChatKey() {
  const ctx = getCtx();
  const charId = ctx?.characterId;
  const charObj = Number.isInteger(charId) ? ctx?.characters?.[charId] : null;
  const charScope = String(
    charObj?.avatar ?? charObj?.name ??
    ctx?.chatMetadata?.character_name ?? ctx?.name2 ?? ''
  );
  const baseChat = String(ctx?.chatId ?? ctx?.chatMetadata?.chat_file_name ?? 'default');
  return `${baseChat}::${charScope}`;
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
  _saveTimer = setTimeout(() => {
    try { getCtx()?.saveSettingsDebounced?.(); } catch {}
  }, 5000);
}

function gid() {
  return 'la_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// ====== CRUD ======

/**
 * Load all layered memories for current chat
 * Returns: { identity: [...], scene: [...], dynamics: [...] }
 */
export function loadLayered() {
  const store = getChatStore();
  const raw = store?.[LAYERED_KEY];
  const result = {};
  for (const k of LAYER_KEYS) {
    result[k] = Array.isArray(raw?.[k]) ? raw[k] : [];
  }
  return result;
}

/**
 * Save all layered memories
 */
export function saveLayered(data) {
  const store = getChatStore();
  if (!store) return;
  const clean = {};
  for (const k of LAYER_KEYS) {
    clean[k] = Array.isArray(data?.[k]) ? data[k] : [];
  }
  store[LAYERED_KEY] = clean;
  saveDebounced();
}

/**
 * Add a layered memory entry
 */
export function addLayeredEntry(layer, entry) {
  if (!LAYER_DEFS[layer]) return null;
  const data = loadLayered();
  const item = {
    id: gid(),
    layer,
    label: entry.label || '',
    content: entry.content || '',
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    sourceFloors: entry.sourceFloors || null,
    dateLabel: entry.dateLabel || '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pinned: entry.pinned !== false,   // layered memories default pinned
  };
  data[layer].push(item);
  saveLayered(data);
  return item;
}

/**
 * Update a layered memory entry
 */
export function updateLayeredEntry(layer, id, patch) {
  const data = loadLayered();
  const list = data[layer];
  if (!list) return false;
  const idx = list.findIndex(x => x.id === id);
  if (idx < 0) return false;
  const updatable = ['label', 'content', 'tags', 'sourceFloors', 'dateLabel', 'pinned'];
  for (const k of updatable) {
    if (patch[k] !== undefined) list[idx][k] = patch[k];
  }
  list[idx].updatedAt = Date.now();
  saveLayered(data);
  return true;
}

/**
 * Delete a layered memory entry
 */
export function deleteLayeredEntry(layer, id) {
  const data = loadLayered();
  const list = data[layer];
  if (!list) return false;
  const idx = list.findIndex(x => x.id === id);
  if (idx < 0) return false;
  list.splice(idx, 1);
  saveLayered(data);
  return true;
}

/**
 * Reorder entries within a layer
 */
export function reorderLayeredEntries(layer, orderedIds) {
  const data = loadLayered();
  const list = data[layer];
  if (!list) return;
  const map = new Map(list.map(x => [x.id, x]));
  const reordered = [];
  for (const id of orderedIds) {
    if (map.has(id)) { reordered.push(map.get(id)); map.delete(id); }
  }
  // Append any remaining items not in orderedIds
  for (const item of map.values()) reordered.push(item);
  data[layer] = reordered;
  saveLayered(data);
}

// ====== Injection (for recall) ======

/**
 * Build the layered memory injection text.
 * This is called every recall cycle and injected into mp_layered_ctx.
 */
export function buildLayeredInjection() {
  const data = loadLayered();
  const sections = [];

  for (const k of LAYER_KEYS) {
    const def = LAYER_DEFS[k];
    const items = (data[k] || []).filter(x => x.pinned !== false);
    if (!items.length) continue;

    const lines = items.map(item => {
      let line = `[${item.label}]`;
      if (item.dateLabel) line += `(${item.dateLabel})`;
      line += ` ${item.content}`;
      return line;
    });

    sections.push(`<${def.label}>\n${lines.join('\n')}\n</${def.label}>`);
  }

  return sections.join('\n\n');
}

/**
 * Inject layered memories into chatMetadata.variables
 * Called from recall engine or on message received
 */
export function injectLayered() {
  const text = buildLayeredInjection();
  const ctx = getCtx();
  try {
    ctx.chatMetadata = ctx.chatMetadata || {};
    ctx.chatMetadata.variables = ctx.chatMetadata.variables || {};
    ctx.chatMetadata.variables['mp_layered_ctx'] = text;
  } catch {}
  try { localStorage.setItem('mp_layered_ctx', text); } catch {}
  return text;
}

// ====== Statistics ======

export function getLayeredStats() {
  const data = loadLayered();
  const stats = { total: 0 };
  for (const k of LAYER_KEYS) {
    stats[k] = (data[k] || []).length;
    stats.total += stats[k];
  }
  return stats;
}

// ====== Prompts for AI Extraction ======

export const EXTRACT_LAYERED_PROMPT = `分析以下对话/记忆数据，提取需要永久记住的分层记忆锚点。

分三层提取：

1. identity（人物锚点）：人物的身份、外貌、性格特征、关系网络、独特习惯、称呼。
   - label: 人物名或关系描述
   - content: 该人物的关键特征描述（外貌、性格、身份、与主角关系等）
   - tags: 相关标签词

2. scene（场景锚点）：重要场景的物理细节、空间布局、环境特征、氛围。
   - label: 场景名称
   - content: 场景的物理描述（布局、物品、光线、气味等具体细节）
   - tags: 相关标签词

3. dynamics（动态锚点）：重要的关系发展、情感转变、事件转折点。
   - label: 事件/变化名称
   - content: 具体发生了什么，谁对谁的态度如何变化，结果是什么
   - dateLabel: 故事内时间标签（如"UC0087/07/10"、"第三天晚上"、"第120-138层"）。注意：请使用故事中明确提到的日期/时间，不要写"昨天""今天"这种相对时间。如果故事中有具体日期就写具体日期；没有就写"第X天"或楼层范围。
   - tags: 相关标签词

输出格式（每行一个 JSON，不要解释）：
{"layer":"identity/scene/dynamics","label":"标签名","content":"详细描述","dateLabel":"时间标签或空","tags":["标签1","标签2"]}

关键要求：
- content 必须具体，不要概括。保留原词、原动作、原细节。
- identity 类型的 dateLabel 通常为空（人物特征是持久的）
- scene 类型的 dateLabel 可空（场景通常是稳定的），除非场景发生了变化
- dynamics 类型的 dateLabel 必须填写，使用故事内绝对时间或楼层范围，不要写"昨天""刚才"
- 同一人物如果特征发生了重大变化，写两条 identity（标注变化前后）
- 如果输入是现有记忆列表而非原文，请从记忆摘要中提取锚点

输入数据：
{{content}}`;

export const EXTRACT_FROM_MEMORIES_PROMPT = `你将看到一组已有的记忆条目（每条包含事件名、摘要、时间标签等信息）。
请从中提取需要永久记住的分层记忆锚点。

分三层提取：

1. identity（人物锚点）：从记忆中归纳出人物的身份、外貌、性格特征、关系。
   - 合并多条记忆中关于同一人物的信息
   - label: 人物名
   - content: 综合描述（性格、外貌、身份、关系等）

2. scene（场景锚点）：从记忆中提取出反复出现或重要的场景。
   - label: 场景名称
   - content: 场景物理细节

3. dynamics（动态锚点）：提取关键的关系转折点、情感变化。
   - label: 事件/变化名称
   - content: 具体发生了什么，结果是什么
   - dateLabel: 使用记忆中已有的时间标签（timeLabel），原样保留，不要转换成"昨天""今天"

输出格式（每行一个 JSON，不要解释）：
{"layer":"identity/scene/dynamics","label":"标签名","content":"详细描述","dateLabel":"时间标签或空","tags":["标签1","标签2"]}

注意：从多条记忆中归纳同一人物/场景时，合并信息而非重复。

以下是记忆条目：
{{content}}`;
