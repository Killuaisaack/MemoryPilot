// MemoryPilot Management Panel - auto-transformed
// Storage: extensionSettings (NOT chatMetadata)

import { loadMemories, saveMemories } from './storage.js';
import { loadCurrentAnimaSummaries } from './anima-adapter.js';
import { findLegacyHoraeCoverage, isLegacyHoraeSummaryMemory, loadCurrentHoraeMemories } from './horae-adapter.js';

export async function openPanel(initialTab = 'list', initialCfg = 'recall') {
(async () => {

  const dedupeByFingerprint = (list) => {
    const out = [];
    const seen = new Set();
    for (const item of list || []) {
      const fp = memFingerprint(item);
      if (fp && seen.has(fp)) continue;
      if (fp) seen.add(fp);
      out.push(item);
    }
    return out;
  };
  const P='mp_main_panel', S='mp_main_style', MK='mp_memories', AK='mp_api_config', PK='mp_prompt', KPK='mp_kw_rebuild_prompt', BK='mp_kw_blacklist', CK='mp_text_clean_cfg', RK='mp_recall_settings';
  const RECALL_INJECT_PROMPT = `## 持续生效的核心记忆
{{getvar::mp_recall_pin}}

这些内容属于长期稳定记忆，回复时应始终保持一致。

## 当前话题触发的相关记忆
{{getvar::mp_recall_ctx}}

这些内容只在与当前话题相关时自然参考，不要逐条复述，不要直接照抄原句。`;
  const ctx = window.SillyTavern?.getContext?.();
  if (!ctx) return;
  const chat = ctx.chat || [];
  const __mpScopeKey = (() => {
    const charId = ctx?.characterId;
    const charObj = Number.isInteger(charId) ? ctx?.characters?.[charId] : null;
    const charScope = String(charObj?.avatar ?? charObj?.name ?? ctx?.chatMetadata?.character_name ?? ctx?.name2 ?? '');
    const baseChat = String(ctx.chatId ?? ctx.chatMetadata?.chat_file_name ?? '');
    return `${baseChat}::${charScope}`;
  })();

  // Chat isolation: clear stale localStorage on chat switch
  const _cid = __mpScopeKey;
  if (_cid) {
    const _prev = localStorage.getItem('mp_active_chat');
    if (_prev !== _cid) {
      ['mp_memories','mp_recall_pin','mp_recall_ctx'].forEach(k => { try { localStorage.removeItem(k); } catch {} });
      try { localStorage.setItem('mp_active_chat', _cid); } catch {}
    }
  }
  const $ = id => document.getElementById(id);
  const h = s => String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const migratePromptTerms = p => String(p ?? '')
    .replace(/主要召回关键词/g, '主关键词')
    .replace(/主召回关键词/g, '主关键词')
    .replace(/门控关键词/g, '辅助关键词');
  const gid = () => 'mp_'+Math.random().toString(36).slice(2,10);
  const norm = s => String(s??'').toLowerCase().trim();
  const normalizeOpenAIBase = s => String(s ?? '').trim().replace(/\/+$/,'').replace(/\/chat\/completions$/i,'');
  const normalizeClaudeBase = s => String(s ?? '').trim().replace(/\/+$/,'').replace(/\/v1\/messages$/i,'');
  const normalizeGeminiBase = s => String(s ?? '').trim().replace(/\/+$/,'').replace(/\/models\/.*$/i,'');

  if ($(P)){
    if(window._mpAnimaSummaryListener) document.removeEventListener('anima_summary_written',window._mpAnimaSummaryListener);
    $(P).remove();$(S)?.remove();return;
  }
  try { document.getElementById('mp_api_panel')?.remove(); document.getElementById('mp_api_style')?.remove(); } catch {}
  try { document.getElementById('mp_recall_monitor_panel')?.remove(); document.getElementById('mp_recall_monitor_style')?.remove(); } catch {}

  // ===== Data =====
  const META_NS='MemoryPilot';
  const esc = s => String(s ?? '').replace(/\\/g,'\\\\').replace(/"/g,'\\\"');
  const metaRoot = () => { try { return ctx.chatMetadata?.extensions?.[META_NS] || {}; } catch { return {}; } };
  // Storage: extensionSettings (server-synced, outside chat file)
  const _EXT_NAME = 'MemoryPilot';
  const _getStore = () => {
    const c = window.SillyTavern?.getContext?.();
    if (!c?.extensionSettings) return null;
    if (!c.extensionSettings[_EXT_NAME]) c.extensionSettings[_EXT_NAME] = {};
    const charId = c?.characterId;
    const charObj = Number.isInteger(charId) ? c?.characters?.[charId] : null;
    const charScope = String(charObj?.avatar ?? charObj?.name ?? c?.chatMetadata?.character_name ?? c?.name2 ?? '');
    const ck = `${String(c.chatId ?? c.chatMetadata?.chat_file_name ?? 'default')}::${charScope}`;
    if (!c.extensionSettings[_EXT_NAME][ck]) c.extensionSettings[_EXT_NAME][ck] = {};
    return c.extensionSettings[_EXT_NAME][ck];
  };
  const _getGlobalStore = () => {
    const c = window.SillyTavern?.getContext?.();
    if (!c?.extensionSettings) return {};
    if (!c.extensionSettings[_EXT_NAME]) c.extensionSettings[_EXT_NAME] = {};
    if (!c.extensionSettings[_EXT_NAME]._global) c.extensionSettings[_EXT_NAME]._global = {};
    return c.extensionSettings[_EXT_NAME]._global;
  };
  let _saveTimer = null;
  const _saveDebounced = () => {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      try { window.SillyTavern?.getContext?.()?.saveSettingsDebounced?.(); } catch {}
    }, 10000);
  };
  const syncMeta = async (patch, immediate) => {
    // Only save sticky state to extensionSettings, skip ephemeral stuff
    if (!patch) return;
    const dominated = ['turnCounter','recallEvery','mp_recall_pin','mp_recall_ctx','mp_pending_ops'];
    const dominated_set = new Set(dominated);
    const dominated_only = Object.keys(patch).every(k => dominated_set.has(k));
    if (dominated_only) return; // skip ephemeral-only patches
    const store = _getStore();
    if (!store) return;
    for (const [k, v] of Object.entries(patch)) {
      if (dominated_set.has(k)) continue;
      if (k === 'mp_memories' && Array.isArray(v)) continue; // memories stored separately
      store[k] = v;
    }
    _saveDebounced();
  };
  const pullJson = async (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      if (raw && raw.trim()) return JSON.parse(raw);
    } catch {}
    try {
      const store = _getStore();
      if (store && store[key] != null) {
        try { localStorage.setItem(key, JSON.stringify(store[key])); } catch {}
        return store[key];
      }
    } catch {}
    try {
      const meta = metaRoot();
      if (meta && meta[key] != null) {
        try { localStorage.setItem(key, JSON.stringify(meta[key])); } catch {}
        return meta[key];
      }
    } catch {}
    return fallback;
  };
  const pushJson = async (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
    // Store in extensionSettings (server-synced, NOT in chat file)
    const store = _getStore();
    if (store) { store[key] = value; _saveDebounced(); }
  };
  const pullText = async (key, fallback='') => {
    try {
      const v = ctx?.chatMetadata?.variables?.[key];
      if (v != null && String(v).trim()) return String(v);
    } catch {}
    try {
      const raw = localStorage.getItem(key);
      if (raw != null && raw.trim()) return raw;
    } catch {}
    return fallback;
  };
  const pushText = async (key, value) => {
    const text = String(value ?? '');
    try { localStorage.setItem(key, text); } catch {}
    try {
      ctx.chatMetadata = ctx.chatMetadata || {};
      ctx.chatMetadata.variables = ctx.chatMetadata.variables || {};
      ctx.chatMetadata.variables[key] = text;
    } catch {}
  };
  const loadMem = () => {
    if (Array.isArray(memories)) return memories;
    try{
      const r=localStorage.getItem(MK);
      if(r) return JSON.parse(r);
    }catch{}
    try{
      const store = _getStore();
      if(store && Array.isArray(store[MK]) && store[MK].length){
        try { localStorage.setItem(MK, JSON.stringify(store[MK])); } catch {}
        return store[MK];
      }
    }catch{}
    // Legacy: chatMetadata
    try{
      const meta = metaRoot();
      if(meta && Array.isArray(meta[MK]) && meta[MK].length){
        try { localStorage.setItem(MK, JSON.stringify(meta[MK])); } catch {}
        return meta[MK];
      }
    }catch{}
    return [];
  };

  // ===== Migration: clean old chatMetadata bloat =====
  try {
    const ns = ctx.chatMetadata?.extensions?.['MemoryPilot'];
    if (ns) {
      let cleaned = false;
      for (const k of ['stickyState','turnCounter','recallEvery','mp_recall_pin','mp_recall_ctx','mp_pending_ops']) {
        if (ns[k] != null) { delete ns[k]; cleaned = true; }
      }
      if (Array.isArray(ns.mp_memories) && ns.mp_memories.length) {
        console.log('[MP] Migrating memories from chatMetadata to extensionSettings');
        const store = _getStore();
        if (store) { store.mp_memories = ns.mp_memories; _saveDebounced(); }
        delete ns.mp_memories;
        cleaned = true;
      }
      if (ctx.chatMetadata?.variables) {
        for (const k of Object.keys(ctx.chatMetadata.variables)) {
          if (k.startsWith('mp_') && k !== 'mp_recall_pin' && k !== 'mp_recall_ctx') {
            delete ctx.chatMetadata.variables[k]; cleaned = true;
          }
        }
      }
      if (cleaned) {
        console.log('[MP] Migration: cleaned bloated chatMetadata');
        try { if (typeof ctx.saveMetadata === 'function') ctx.saveMetadata(); } catch {}
      }
    }
  } catch (e) { console.warn('[MP] migration error', e); }

  const saveMem = async(arr)=>{
    memories = dedupeMemories(Array.isArray(arr) ? arr : []);
    await saveMemories(memories);
  };
  const loadApi = ()=>{try{return JSON.parse(localStorage.getItem(AK))||{};}catch{}return{};};
  const saveApi = async (cfg)=>{ await pushJson(AK, cfg || {}); };
  const loadBlacklist = ()=>{try{const r=localStorage.getItem(BK);const a=r?JSON.parse(r):[];return Array.isArray(a)?a:[];}catch{}return[];};
  const saveBlacklist = async arr => { await pushJson(BK, Array.isArray(arr)?arr:[]); };

  const DEF_CLEANER = {
    blockTags: ['think','details'],
    linePrefixes: ['affinity_change:','mood_change:','state_update:'],
    regexRules: ['^____+$'],
    cleanForRecall: true,
    cleanForBatch: true
  };
  const normalizeCleaner = (cfg) => {
    const src = cfg && typeof cfg === 'object' ? cfg : {};
    const normList = (arr) => Array.from(new Set((Array.isArray(arr) ? arr : []).map(x => String(x ?? '').trim()).filter(Boolean)));
    return {
      blockTags: normList(src.blockTags || DEF_CLEANER.blockTags),
      linePrefixes: normList(src.linePrefixes || DEF_CLEANER.linePrefixes),
      regexRules: normList(src.regexRules || DEF_CLEANER.regexRules),
      cleanForRecall: src.cleanForRecall !== false,
      cleanForBatch: src.cleanForBatch !== false
    };
  };
  let cleanerCfg = normalizeCleaner(await pullJson(CK, DEF_CLEANER));
  const loadCleaner = () => normalizeCleaner(cleanerCfg);
  const saveCleaner = async (cfg) => {
    cleanerCfg = normalizeCleaner(cfg);
    await pushJson(CK, cleanerCfg);
  };

  const DEF_RECALL_SETTINGS = { every: 1, alpha: 0.72, stickyTurns: 5, contextWindow: 8, maxRecall: 6, animaDedupe: true, xiaobaixDedupe: true };
  const normalizeRecallSettings = (cfg) => {
    const src = cfg && typeof cfg === 'object' ? cfg : {};
    const num = (v, d) => Number.isFinite(Number(v)) ? Number(v) : d;
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    return {
      every: clamp(Math.round(num(src.every, DEF_RECALL_SETTINGS.every)), 1, 50),
      alpha: clamp(num(src.alpha, DEF_RECALL_SETTINGS.alpha), 0, 0.95),
      stickyTurns: clamp(Math.round(num(src.stickyTurns, DEF_RECALL_SETTINGS.stickyTurns)), 0, 20),
      contextWindow: clamp(Math.round(num(src.contextWindow, DEF_RECALL_SETTINGS.contextWindow)), 3, 30),
      maxRecall: clamp(Math.round(num(src.maxRecall, DEF_RECALL_SETTINGS.maxRecall)), 1, 20),
      animaDedupe: src.animaDedupe !== false,
      xiaobaixDedupe: src.xiaobaixDedupe !== false
    };
  };
  let recallCfg = normalizeRecallSettings(await pullJson(RK, DEF_RECALL_SETTINGS));
  const loadRecallCfg = () => normalizeRecallSettings(recallCfg);
  const saveRecallCfg = async (cfg) => {
    recallCfg = normalizeRecallSettings(cfg);
    await pushJson(RK, recallCfg);
    await syncMeta({ recallEvery: recallCfg.every });
  };
  const applyCleaner = (input, cfg = cleanerCfg) => {
    let text = String(input ?? '');
    const conf = normalizeCleaner(cfg);

    for (const rawTag of conf.blockTags) {
      const tag = String(rawTag || '').trim();
      if (!tag) continue;
      try {
        const re = new RegExp('<\\s*' + tag + '\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*' + tag + '\\s*>', 'gi');
        text = text.replace(re, ' ');
      } catch {}
    }

    if (conf.linePrefixes.length) {
      const prefixes = conf.linePrefixes.map(x => String(x || '').trim().toLowerCase()).filter(Boolean);
      text = text
        .split(/\r?\n/)
        .filter(line => {
          const t = String(line || '').trim().toLowerCase();
          if (!t) return true;
          return !prefixes.some(p => t.startsWith(p));
        })
        .join('\n');
    }

    for (const rawRule of conf.regexRules) {
      const rule = String(rawRule || '').trim();
      if (!rule) continue;
      try {
        text = text.replace(new RegExp(rule, 'gim'), ' ');
      } catch {}
    }

    return text
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  };
  const STOP_WORDS = new Set(['的','了','在','是','和','与','并','后','前','中','内','外','对','把','被','让','将','及','后续','当前','相关','进行','继续','已经','开始','结束','然后','因为','所以','这个','那个','一次','一个','一种','没有','不是','自己','我们','你们','他们','她们']);
  const uniq = arr => Array.from(new Set((arr || []).filter(Boolean)));

  const textKey = (s) =>
    norm(s)
      .replace(/\s+/g, '')
      .replace(/[，。、！？；：,.;:!?\-#()（）《》【】\[\]{}"'“”‘’\/\\|\n\r\t]/g, '');

  const memFingerprint = (m) =>
    [textKey(m?.event || ''), textKey(m?.summary || ''), textKey((m?.source || '') + '|' + (m?.xbEventId || '') + '|' + (m?.animaSummaryId || '') + '|' + (m?.horaeMemoryId || ''))].join('||');

  const dedupeMemories = (list) => {
    const out = [];
    const seenId = new Set();
    const seenXb = new Set();
    const seenAnima = new Set();
    const seenHorae = new Set();
    const seenFp = new Set();

    for (const item of Array.isArray(list) ? list : []) {
      if (!item) continue;
      const id = String(item.id ?? '');
      const xb = item.xbEventId ? `xb:${String(item.xbEventId)}` : '';
      const anima = item.animaSummaryId ? `anima:${String(item.animaSummaryId)}` : '';
      const horae = item.horaeMemoryId ? `horae:${String(item.horaeMemoryId)}` : '';
      const fp = memFingerprint(item);

      if (id && seenId.has(id)) continue;
      if (xb && seenXb.has(xb)) continue;
      if (anima && seenAnima.has(anima)) continue;
      if (horae && seenHorae.has(horae)) continue;
      if (fp && seenFp.has(fp)) continue;

      if (id) seenId.add(id);
      if (xb) seenXb.add(xb);
      if (anima) seenAnima.add(anima);
      if (horae) seenHorae.add(horae);
      if (fp) seenFp.add(fp);
      out.push(item);
    }
    return out;
  };

  const upsertMemory = (list, nextMem) => {
    const arr = Array.isArray(list) ? [...list] : [];
    const nextXbId = nextMem?.xbEventId ? String(nextMem.xbEventId) : '';
    const nextAnimaId = nextMem?.animaSummaryId ? String(nextMem.animaSummaryId) : '';
    const nextHoraeId = nextMem?.horaeMemoryId ? String(nextMem.horaeMemoryId) : '';
    const nextId = nextMem?.id ? String(nextMem.id) : '';

    let idx = -1;
    if (nextXbId) idx = arr.findIndex(x => String(x?.xbEventId || '') === nextXbId);
    if (idx < 0 && nextAnimaId) idx = arr.findIndex(x => String(x?.animaSummaryId || '') === nextAnimaId);
    if (idx < 0 && nextHoraeId) idx = arr.findIndex(x => String(x?.horaeMemoryId || '') === nextHoraeId);
    if (idx < 0 && nextId) idx = arr.findIndex(x => String(x?.id || '') === nextId);
    if (idx < 0) {
      const fp = memFingerprint(nextMem);
      if (fp) idx = arr.findIndex(x => memFingerprint(x) === fp);
    }

    if (idx >= 0) arr[idx] = { ...arr[idx], ...nextMem };
    else arr.push(nextMem);

    return dedupeMemories(arr);
  };

  const parseTimeValue = (label='') => {
    const s = String(label||'').trim();
    if(!s) return null;
    const m = s.match(/(\d{1,2})[:：](\d{2})/);
    if(m) return Number(m[1]) * 60 + Number(m[2]);
    if(/清晨|凌晨/.test(s)) return 5*60;
    if(/早晨|早上/.test(s)) return 8*60;
    if(/上午/.test(s)) return 10*60;
    if(/中午/.test(s)) return 12*60;
    if(/下午/.test(s)) return 15*60;
    if(/傍晚|黄昏/.test(s)) return 18*60;
    if(/晚上|夜晚|深夜/.test(s)) return 21*60;
    return null;
  };

  const parseFloorRangeFromText = (text) => {
    const s = String(text || '');
    let m = s.match(/[（(\[]?\s*[＃#]\s*(\d+)\s*[-—–~～到至]\s*[＃#]?\s*(\d+)\s*[）)\]]?/);
    if (m) {
      const a = Number(m[1]), b = Number(m[2]);
      if (Number.isFinite(a) && Number.isFinite(b)) return [Math.min(a, b), Math.max(a, b)];
    }
    m = s.match(/(?:第)?\s*(\d+)\s*[-—–~～到至]\s*(\d+)\s*层/);
    if (m) {
      const a = Number(m[1]), b = Number(m[2]);
      if (Number.isFinite(a) && Number.isFinite(b)) return [Math.min(a, b), Math.max(a, b)];
    }
    m = s.match(/[（(\[]?\s*[＃#]\s*(\d+)\s*[）)\]]?/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n)) return [n, n];
    }
    return null;
  };

  const deriveFloorRangeFromXB = e => {
    const candidates = [
      e?.floorRange,
      [e?.startFloor, e?.endFloor],
      [e?.floorStart, e?.floorEnd],
      [e?.start_floor, e?.end_floor],
      [e?.floor, e?.floor],
      [e?.index, e?.index]
    ];
    for(const item of candidates){
      if(Array.isArray(item) && item.length >= 2){
        const a = Number(item[0]), b = Number(item[1]);
        if(Number.isFinite(a) && Number.isFinite(b)) return [Math.min(a,b), Math.max(a,b)];
      }
    }
    return (
      parseFloorRangeFromText(e?.summary) ||
      parseFloorRangeFromText(e?.content) ||
      parseFloorRangeFromText(e?.description) ||
      parseFloorRangeFromText(e?.text) ||
      parseFloorRangeFromText(e?.rawSummary) ||
      parseFloorRangeFromText(e?.title) ||
      parseFloorRangeFromText(e?.timeLabel) ||
      parseFloorRangeFromText([e?.timeLabel, e?.summary, e?.content, e?.description].filter(Boolean).join(' ')) ||
      null
    );
  };

  const floorRangeDistance = (a, b) => {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) return Infinity;
    const [a1, a2] = a.map(Number), [b1, b2] = b.map(Number);
    if ([a1,a2,b1,b2].some(Number.isNaN)) return Infinity;
    if (a2 < b1) return b1 - a2;
    if (b2 < a1) return a1 - b2;
    return 0;
  };
  const timeDistance = (a, b) => {
    const x = Number(a), y = Number(b);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return Infinity;
    return Math.abs(x - y);
  };
  const isLinked = (a, b) => {
    const fd = floorRangeDistance(a.floorRange, b.floorRange);
    const td = timeDistance(a.timeValue, b.timeValue);
    if (fd <= 2) return true;
    if (fd <= 8 && td <= 90) return true;
    if (fd <= 12 && td <= 30) return true;
    return false;
  };
  const cleanKeywords = mem => {
    const blacklist = new Set(loadBlacklist().map(norm));
    return (mem.keywords || []).map(k=>String(k??'').trim()).filter(Boolean).filter(k=>!blacklist.has(norm(k)));
  };

  const DEF_PROMPT = `分析以下对话，提取值得长期记忆的重要事件。

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
floorRange：该事件实际涵盖的起止楼层号 [start, end]，根据对话中的 #楼层号 标记确定。必须精确到该事件实际发生的楼层，不要使用整个输入范围。\n\npriority：核心设定/绝不能忘=high，关键事件=medium，氛围/日常=low。

只输出 JSON，每行一个，不要解释。

对话：
{{content}}`;
  const loadPrompt=()=>{
    try{const g=window.MemoryPilot?.getCustomPrompt?.('analysis');if(g)return migratePromptTerms(g);}catch{}
    try{const r=localStorage.getItem(PK);if(r){if(/\"keywords\"\s*:/.test(r)&&!/primaryKeywords/.test(r))return DEF_PROMPT;return migratePromptTerms(r);}}catch{}
    return DEF_PROMPT;
  };
  const savePrompt=async(p)=>{
    try{window.MemoryPilot?.saveCustomPrompt?.('analysis',p);}catch{}
    await pushText(PK,p);
  };

  const DEF_MERGE_PROMPT = `你需要将以下多条记忆合并为一条完整的记忆。

要求：
1. event 格式为「地点·核心内容概括」，综合所有事件的核心。
2. summary 长度 120-500 字，必须保留所有事件中的关键细节（具体台词、动作、物品、数字），按时间顺序组织，不要遗漏任何重要信息。
3. timeLabel 取最早到最晚的时间跨度。
4. timeValue 取最早事件的 timeValue，没有写 null。
5. floorRange 取所有事件中最小起始楼层和最大结束楼层。
6. priority 保持与输入相同（所有输入事件优先级一致）。

输出格式（只输出一个 JSON，不要解释）：
{"event":"合并后的场景标题","summary":"合并后的详细摘要","timeLabel":"时间跨度","timeValue":null,"floorRange":[起始,结束],"priority":"同输入"}

以下是要合并的记忆：
{{memories}}

以下是相关楼层的原文（供参考，确保摘要准确）：
{{context}}`;

  const DEF_KW_PROMPT = `请根据以下记忆条目，为记忆召回系统重构关键词分层。只输出一个 JSON：
{"primaryKeywords":["主关键词"],"secondaryKeywords":["辅助关键词"],"entityKeywords":["人物名"]}

规则：
1. primaryKeywords 是主关键词：必须是后续对话中会被直接写出来的原词，例如具体地名（"图书馆""天台"）、具体物品名（"银星勋章"）、具体活动名（"击剑比赛"）、人物间的独特称呼或代号；不要写概括性标签，不要放人物名；控制在 2-6 个。
2. secondaryKeywords 是辅助关键词：用于辅助判断聊天语境，必须是对话中真的会出现的具体词，例如动作词（"道歉""逃跑"）、场景词（"雨天""教室"）、结果词（"受伤""和解"）；不要写抽象归纳，不要和 primaryKeywords 重复；不要放人物名；控制在 2-6 个。
3. entityKeywords 只写人物名或角色称呼，用于展示，不参与召回。
4. 不要输出泛词，例如“对话”“事情”“关系”“交流”“发生”；如果信息不足，宁可少写，不要臆造。
5. 只输出 JSON，不要解释。

记忆信息：
事件名：{{event}}
摘要：{{summary}}
人物：{{entities}}
时间：{{timeLabel}}
楼层：{{floorRange}}`;
  const loadKwPrompt=()=>{
    try{const g=window.MemoryPilot?.getCustomPrompt?.('kwRebuild');if(g)return migratePromptTerms(g);}catch{}
    try{const r=localStorage.getItem(KPK);if(r){if(!/primaryKeywords/.test(r)||!/secondaryKeywords/.test(r))return DEF_KW_PROMPT;return migratePromptTerms(r);}}catch{}
    return DEF_KW_PROMPT;
  };
  const saveKwPrompt=async(p)=>{
    try{window.MemoryPilot?.saveCustomPrompt?.('kwRebuild',p);}catch{}
    await pushText(KPK,p);
  };

  const MPK='mp_merge_prompt';
  const loadMergePrompt=()=>{
    try{const g=window.MemoryPilot?.getCustomPrompt?.('merge');if(g)return g;}catch{}
    try{const r=localStorage.getItem(MPK);if(r)return r;}catch{}
    return DEF_MERGE_PROMPT;
  };
  const saveMergePrompt=async(p)=>{
    try{window.MemoryPilot?.saveCustomPrompt?.('merge',p);}catch{}
    await pushText(MPK,p);
  };

  const collectFloorSegments = (mems) => {
    const segs = [];
    for (const m of mems) {
      if (Array.isArray(m.floorSegments)) {
        for (const s of m.floorSegments) {
          if (Array.isArray(s) && s.length >= 2) segs.push([Number(s[0]), Number(s[1])]);
        }
      } else if (Array.isArray(m.floorRange) && m.floorRange.length >= 2) {
        segs.push([Number(m.floorRange[0]), Number(m.floorRange[1])]);
      }
    }
    if (!segs.length) return null;
    segs.sort((a, b) => a[0] - b[0]);
    const merged = [segs[0]];
    for (let i = 1; i < segs.length; i++) {
      const last = merged[merged.length - 1];
      if (segs[i][0] <= last[1] + 1) { last[1] = Math.max(last[1], segs[i][1]); }
      else { merged.push(segs[i]); }
    }
    return merged;
  };

  const formatFloorSegments = (mem) => {
    const segs = Array.isArray(mem.floorSegments) ? mem.floorSegments : null;
    if (segs && segs.length > 1) return segs.map(s => '#' + s[0] + '-' + s[1]).join(', ');
    if (Array.isArray(mem.floorRange) && mem.floorRange.length >= 2) return '#' + mem.floorRange[0] + '-' + mem.floorRange[1];
    return '';
  };

  const getMergeContext = (mems) => {
    const segs = collectFloorSegments(mems);
    if (!segs || !segs.length) return '';
    const cleaner = loadCleaner();
    const lines = [];
    const seen = new Set();
    for (const [startF, endF] of segs) {
      for (let i = Math.max(0, startF - 1); i <= Math.min(chat.length - 1, endF - 1); i++) {
        if (seen.has(i)) continue;
        seen.add(i);
        const m = chat[i];
        if (!m) continue;
        const body = cleaner.cleanForBatch ? applyCleaner(m.mes || '', cleaner) : String(m.mes || '');
        if (!body.trim()) continue;
        const sp = m.is_user ? (ctx.name1 || 'User') : (m.name || ctx.name2 || 'Char');
        lines.push('#' + (i + 1) + '[' + sp + ']' + body);
      }
    }
    lines.sort((a, b) => { const na = Number((a.match(/^#(\d+)/) || [])[1] || 0); const nb = Number((b.match(/^#(\d+)/) || [])[1] || 0); return na - nb; });
    return lines.join('\n');
  };

  const buildMergePayload = (mems, includeContext = true) => {
    const memText = mems.map((m, i) => {
      const fr = Array.isArray(m.floorRange) ? '#' + m.floorRange[0] + '-#' + m.floorRange[1] : '未知';
      return '事件' + (i + 1) + '：\n事件名：' + (m.event || '') + '\n摘要：' + (m.summary || '') + '\n时间：' + (m.timeLabel || '') + '\n楼层：' + fr + '\n优先级：' + (m.priority || 'medium');
    }).join('\n\n');
    const context = includeContext ? getMergeContext(mems) : '';
    return loadMergePrompt().replace('{{memories}}', memText).replace('{{context}}', context || '（未参考原文）');
  };

  const mergeKeywordsDefault = (mems) => {
    const pk = [], sk = [], ek = [];
    for (const m of mems) { pk.push(...(m.primaryKeywords || m.keywords || [])); sk.push(...(m.secondaryKeywords || [])); ek.push(...(m.entityKeywords || [])); }
    return { primaryKeywords: uniq(pk.map(k => String(k||'').trim()).filter(Boolean)).slice(0,8), secondaryKeywords: uniq(sk.map(k => String(k||'').trim()).filter(Boolean)).slice(0,8), entityKeywords: uniq(ek.map(k => String(k||'').trim()).filter(Boolean)).slice(0,8) };
  };

  const mergeFloorRange = (mems) => {
    let minF = Infinity, maxF = -Infinity;
    for (const m of mems) { if (Array.isArray(m.floorRange) && m.floorRange.length >= 2) { minF = Math.min(minF, Number(m.floorRange[0])); maxF = Math.max(maxF, Number(m.floorRange[1])); } }
    return Number.isFinite(minF) && Number.isFinite(maxF) ? [minF, maxF] : null;
  };

  const loadXb=()=>{try{return ctx.chatMetadata?.extensions?.LittleWhiteBox?.storySummary?.json?.events||[];}catch{}return[];};

  const parseFloors=(input,len)=>{const r=new Set();for(const p of input.split(/[,，]/)){const t=p.trim();if(!t)continue;const rm=t.match(/^(\d+)\s*[-~～到]\s*(\d+)$/);if(rm){for(let i=Math.max(0,+rm[1]-1);i<=Math.min(+rm[2]-1,len-1);i++)r.add(i);}else if(/^最近(\d+)$/.test(t)){const n=+t.match(/最近(\d+)/)[1];for(let i=Math.max(0,len-n);i<len;i++)r.add(i);}else if(/^\d+$/.test(t)){const i=+t-1;if(i>=0&&i<len)r.add(i);}}return[...r].sort((a,b)=>a-b);};

  const searchFloors=(input)=>{
    if(!input.trim())return[];
    const keywords=input.trim().split(/\s+/).map(k=>k.toLowerCase()).filter(k=>k.length>=1);
    const results=[];
    chat.forEach((m,i)=>{
      const sourceText = loadCleaner().cleanForBatch ? applyCleaner(m.mes || '', loadCleaner()) : String(m.mes || '');
      const text=sourceText.toLowerCase();
      const matched=keywords.filter(k=>text.includes(k));
      if(matched.length>0){
        const sp=m.is_user?(ctx.name1||'User'):(m.name||ctx.name2||'Char');
        results.push({floor:i,speaker:sp,preview:sourceText.slice(0,120),matchCount:matched.length,matchedKw:matched});
      }
    });
    results.sort((a,b)=>b.matchCount-a.matchCount);
    return results;
  };


  const compressNums = (nums) => {
    const arr = uniq((nums || []).map(x => Number(x)).filter(Number.isFinite)).sort((a,b)=>a-b);
    if (!arr.length) return '';
    const out = [];
    let start = arr[0], prev = arr[0];
    for (let i = 1; i < arr.length; i++) {
      const n = arr[i];
      if (n === prev + 1) { prev = n; continue; }
      out.push(start === prev ? String(start) : `${start}-${prev}`);
      start = prev = n;
    }
    out.push(start === prev ? String(start) : `${start}-${prev}`);
    return out.join(', ');
  };

  const updateSearchStatus = (suffix = '') => {
    const el = $('mp_bk_status');
    if (!el) return;
    const found = lastSearchResults.length ? `找到 ${lastSearchResults.length} 层` : '尚无搜索结果';
    el.textContent = `${found} · 已选择 ${searchPicked.size} 层${suffix ? ` · ${suffix}` : ''}`;
  };

  const applyPickedFloors = () => {
    const nums = [...searchPicked].map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
    if (!nums.length) { toastr?.warning?.('请先勾选需要总结的楼层'); return; }
    $('mp_bf').value = compressNums(nums);
    updateSearchStatus(`已填入 ${nums.length} 层`);
    toastr?.success?.(`已将 ${nums.length} 层填入总结范围`);
  };

  const getContextSlice = (centerFloor, radius = 2) => {
    const out = [];
    const start = Math.max(0, centerFloor - radius);
    const end = Math.min(chat.length - 1, centerFloor + radius);
    for (let i = start; i <= end; i++) {
      const m = chat[i];
      if (!m) continue;
      const speaker = m.is_user ? (ctx.name1 || 'User') : (m.name || ctx.name2 || 'Char');
      const raw = String(m.mes || '');
      const text = applyCleaner(raw, loadCleaner());
      out.push({ floor: i + 1, speaker, text });
    }
    return out;
  };

  let ctxFocus = null;

  const showSearchView = () => {
    const sv = $('mp_search_view');
    const cv = $('mp_context_view');
    if (sv) sv.style.display = '';
    if (cv) cv.style.display = 'none';
  };

  const showContextView = (floor) => {
    ctxFocus = floor;
    const sv = $('mp_search_view');
    const cv = $('mp_context_view');
    if (sv) sv.style.display = 'none';
    if (cv) cv.style.display = '';
    renderContextContent();
  };

  const renderContextContent = () => {
    const focus=ctxFocus; if(!focus){showSearchView();return;}
    const picked=[...searchPicked].map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
    const pt=picked.length?compressNums(picked):'未勾选';
    const mx=chat.length;
    _ctxT=Math.max(0,focus-1-8); _ctxB=Math.min(mx-1,focus-1+8);
    const ls=_ctxS(_ctxT,_ctxB);
    $('mp_bctx').innerHTML=`<div style="position:sticky;top:0;z-index:2;background:#f8f6fb;padding:8px 0 7px;border-bottom:1px solid #ddd7e5"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><button class="btn" id="mp_bctx_back" style="padding:5px 12px;font-size:12px">← 返回搜索结果</button><button class="btn bp1" id="mp_bctx_apply" style="padding:5px 12px;font-size:12px">使用已选楼层</button></div><div class="ht" style="margin-top:6px">焦点 #${h(String(focus))} ｜ 已选择：<span id="mp_bctx_picked">${h(pt)}</span><br>先显示前后各 8 层；上下滑动可继续加载更多。</div></div><div id="_csa">`+ls.map(l=>_ctxH(l)).join('')+'</div>';
    $('mp_bctx_back')?.addEventListener('click',showSearchView);
    $('mp_bctx_apply')?.addEventListener('click',applyPickedFloors);
    _bindCk();
    setTimeout(()=>{const e=$('mp_bctx')?.querySelector('.hit');if(e)e.scrollIntoView({block:'center',behavior:'instant'});},30);
    _ctxBusy=false;$('mp_bctx')?.removeEventListener('scroll',_onScr);$('mp_bctx')?.addEventListener('scroll',_onScr);
  };
  const _ctxS=(s,e)=>{const o=[];for(let i=s;i<=e;i++){const m=chat[i];if(!m)continue;o.push({floor:i+1,speaker:m.is_user?(ctx.name1||'User'):(m.name||ctx.name2||'Char'),text:applyCleaner(String(m.mes||''),loadCleaner())});}return o;};
  const _ctxH=(l)=>{const ck=searchPicked.has(l.floor);return`<label class="ctxline ${l.floor===ctxFocus?'hit':''}" style="display:block"><div style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" class="_ck" data-floor="${l.floor}" ${ck?'checked':''}><div style="flex:1"><div class="tiny">#${l.floor} [${h(l.speaker)}]</div><div>${h(l.text).replace(/\n/g,'<br>')}</div></div></div></label>`;};
  let _ctxT=0,_ctxB=0,_ctxBusy=false;
  const _onScr=()=>{if(_ctxBusy)return;const el=$('mp_bctx');if(!el)return;const mx=chat.length,ch=6;
    if(el.scrollTop<60&&_ctxT>0){_ctxBusy=true;const ot=_ctxT;_ctxT=Math.max(0,_ctxT-ch);const nl=_ctxS(_ctxT,ot-1);if(nl.length){const a=$('_csa');if(a){const oh=a.scrollHeight;a.insertAdjacentHTML('afterbegin',nl.map(_ctxH).join(''));el.scrollTop+=a.scrollHeight-oh;_bindCk();}}setTimeout(()=>{_ctxBusy=false;},100);}
    if(el.scrollTop+el.clientHeight>el.scrollHeight-60&&_ctxB<mx-1){_ctxBusy=true;const ob=_ctxB;_ctxB=Math.min(mx-1,_ctxB+ch);const nl=_ctxS(ob+1,_ctxB);if(nl.length){const a=$('_csa');if(a){a.insertAdjacentHTML('beforeend',nl.map(_ctxH).join(''));_bindCk();}}setTimeout(()=>{_ctxBusy=false;},100);}
  };
  const _bindCk=()=>{$('mp_bctx')?.querySelectorAll('._ck').forEach(el=>{if(el._b)return;el._b=true;el.onchange=()=>{const n=Number(el.getAttribute('data-floor'));if(!Number.isFinite(n))return;if(el.checked)searchPicked.add(n);else searchPicked.delete(n);const picked=$('mp_bctx_picked');if(picked)picked.textContent=searchPicked.size?compressNums([...searchPicked]):'未选择';updateSearchStatus();};});};

  // 扩展版 getContextSlice: 直接给起止索引
  

  
  
  

  

  

  // 搜索结果可进入附近楼层视图继续选择。
  const renderSearchContext = (focusFloor = null) => {
    if (focusFloor) showContextView(focusFloor);
  };

  const renderSearchResults = (results) => {
    lastSearchResults = Array.isArray(results) ? results : [];
    if (!lastSearchResults.length) { $('mp_bkr').innerHTML = '<div class="ht">未找到匹配楼层</div>'; updateSearchStatus(); return; }
    showSearchView();
    $('mp_bkr').innerHTML = lastSearchResults.map((r,ri) => { const floor=r.floor+1; const checked=searchPicked.has(floor); const fullText=String(chat[r.floor]?.mes||'').replace(/</g,'&lt;').replace(/>/g,'&gt;'); const short=h(r.preview); return `<div class="sr"><div style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" class="mp_bpick" data-floor="${floor}" ${checked?'checked':''} aria-label="选择第 ${floor} 层"><div style="flex:1"><div><span class="sf">#${floor}</span> <span class="sp">[${h(r.speaker)}] 匹配:${r.matchedKw.map(k=>'<mark>'+h(k)+'</mark>').join(' ')}</span> <button class="btn" style="padding:2px 6px;font-size:10px" data-view="${floor}">查看前后楼层</button> <button class="btn _sr_toggle" style="padding:2px 6px;font-size:10px" data-ri="${ri}">展开</button></div><div class="stx _sr_short" id="sr_s${ri}">${short}</div><div class="stx _sr_full" id="sr_f${ri}" style="display:none;white-space:pre-wrap">${fullText}</div></div></div></div>`; }).join('');
    $('mp_bkr').querySelectorAll('._sr_toggle').forEach(el=>{el.onclick=()=>{const ri=el.getAttribute('data-ri');const s=$('sr_s'+ri);const f=$('sr_f'+ri);if(f.style.display==='none'){f.style.display='';s.style.display='none';el.textContent='收起';}else{f.style.display='none';s.style.display='';el.textContent='展开';}};});
    updateSearchStatus();
    $('mp_bkr').querySelectorAll('.mp_bpick').forEach(el=>{el.onchange=()=>{const n=Number(el.getAttribute('data-floor'));if(!Number.isFinite(n))return;if(el.checked)searchPicked.add(n);else searchPicked.delete(n);updateSearchStatus();};});
    $('mp_bkr').querySelectorAll('[data-view]').forEach(el=>{el.onclick=()=>showContextView(Number(el.getAttribute('data-view')));});
  };



  const simulateRecall=()=>{
    const list = dedupeMemories(loadMem());
    if(!list.length)return{pinned:[],triggered:[],contextText:''};

    const cleaner = loadCleaner();
    const blacklist = new Set((loadBlacklist() || []).map(norm).filter(Boolean));
    const recallCfgLocal = loadRecallCfg();
    const nextTurn = Math.max(0, Number(metaRoot().turnCounter || 0)) + 1;
    const due = nextTurn % recallCfgLocal.every === 0;

    const splitWords = (text) =>
      String(text || '')
        .toLowerCase()
        .trim()
        .split(/[\s，。、！？；：·\-#()（）《》【】\[\]{}"'“”‘’\/\\|\n\r\t]+/)
        .map(w => String(w || '').trim())
        .filter(Boolean)
        .filter(w => w.length >= 2);

    const toCJKGrams = (text, minN = 2, maxN = 3, limit = 120) => {
      const s = String(text || '')
        .toLowerCase()
        .trim()
        .replace(/[\s，。、！？；：·,.;:!?\-#()（）《》【】\[\]{}"'“”‘’\/\\|\n\r\t]+/g, '');
      const out = [];
      if (!s) return out;
      for (let n = minN; n <= maxN; n++) {
        if (s.length < n) continue;
        for (let i = 0; i <= s.length - n; i++) {
          const g = s.slice(i, i + n);
          if (!g || STOP_WORDS.has(g)) continue;
          out.push(g);
          if (out.length >= limit) return uniq(out);
        }
      }
      return uniq(out);
    };

    const extractTerms = (text, limit = 30) => {
      const words = splitWords(text)
        .filter(w => !STOP_WORDS.has(w))
        .slice(0, limit);
      const grams = toCJKGrams(text, 2, 3, limit * 4);
      return uniq([...words, ...grams]).slice(0, limit * 3);
    };

    const cleanTextTerms = (text, limit = 18) =>
      extractTerms(text, limit)
        .map(w => String(w ?? '').trim())
        .filter(Boolean)
        .filter(w => !blacklist.has(norm(w)))
        .slice(0, limit * 3);

    const overlapRatio = (terms, ctxSet) => {
      if(!terms?.length) return 0;
      let hit = 0;
      for (const t of terms) {
        const nt = norm(t);
        if (!nt) continue;
        if (ctxSet.has(nt)) {
          hit++;
          continue;
        }
        let matched = false;
        for (const w of ctxSet) {
          if (!w) continue;
          if (w === nt || w.includes(nt) || nt.includes(w)) {
            matched = true;
            break;
          }
        }
        if (matched) hit++;
      }
      return hit / Math.max(1, terms.length);
    };

    const cleanPrimaryKeywordsLocal = mem => {
      const kws = Array.isArray(mem?.primaryKeywords)
        ? mem.primaryKeywords
        : Array.isArray(mem?.keywords)
          ? mem.keywords
          : [];
      return uniq(
        kws.map(k => String(k ?? '').trim())
          .filter(Boolean)
          .filter(k => !blacklist.has(norm(k)))
      );
    };

    const cleanSecondaryKeywordsLocal = mem => {
      const kws = Array.isArray(mem?.secondaryKeywords) ? mem.secondaryKeywords : [];
      return uniq(
        kws.map(k => String(k ?? '').trim())
          .filter(Boolean)
          .filter(k => !blacklist.has(norm(k)))
      );
    };

    const escapeRegExp = (s) => String(s ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const isLatinWord = (s) => /^[a-z0-9_-]+$/i.test(String(s ?? '').trim());

    const exactMatchKeywordLocal = (text, kw) => {
      const src = norm(text);
      const key = norm(kw);
      if (!src || !key) return false;

      if (isLatinWord(key)) {
        const re = new RegExp(`(?:^|\\W)${escapeRegExp(key)}(?:$|\\W)`, 'i');
        return re.test(src);
      }

      return src.includes(key);
    };

    const weakMatchKeywordLocal = (ctxSet, kw) => {
      const key = norm(kw);
      if (!key) return false;
      for (const w of ctxSet) {
        if (!w) continue;
        if (w === key) return true;
        const shorter = key.length <= w.length ? key : w;
        const longer = key.length <= w.length ? w : key;
        if (shorter.length >= 2 && longer.length >= 3 && longer.includes(shorter)) return true;
      }
      return false;
    };

    const matchKeywordGroupLocal = (text, ctxSet, kws) => {
      const exactList = [];
      const weakList = [];

      for (const kw of kws || []) {
        if (!kw) continue;
        if (exactMatchKeywordLocal(text, kw)) {
          exactList.push(kw);
          continue;
        }
        if (weakMatchKeywordLocal(ctxSet, kw)) {
          weakList.push(kw);
        }
      }

      const exact = uniq(exactList);
      const weak = uniq(weakList).filter(k => !exact.includes(k));

      return {
        exact,
        weak,
        exactHitCount: exact.length,
        weakHitCount: weak.length,
        hitCount: exact.length + weak.length,
      };
    };

    const recent=chat.slice(-(recallCfgLocal.contextWindow || 8));
    const recentTexts=recent.map(m=>{
      const raw = m?.mes || '';
      return cleaner.cleanForRecall ? applyCleaner(raw, cleaner) : String(raw);
    }).filter(Boolean);
    const contextText=recentTexts.join(' ');
    const ctxWords=splitWords(contextText);
    const ctxTerms=extractTerms(contextText, 60);
    const ctxSet=new Set([...ctxWords.map(norm), ...ctxTerms.map(norm)].filter(Boolean).filter(w=>!blacklist.has(w)));

    const pinned=[];
    if (!due) return { pinned:[], triggered:[], contextText, due:false, nextTurn, every:recallCfgLocal.every };

    const primary=[];

    for(const mem of list){
      if(!mem) continue;
      if(mem.priority==='high'){
        pinned.push({...mem,_reason:'常驻记忆'});
        continue;
      }

      const primaryKws = cleanPrimaryKeywordsLocal(mem);
      const secondaryKws = cleanSecondaryKeywordsLocal(mem);
      if (!primaryKws.length) continue;
      
      

      const primaryMatch = matchKeywordGroupLocal(contextText, ctxSet, primaryKws);
      if (primaryMatch.hitCount <= 0) continue;
      if (primaryMatch.exactHitCount <= 0 && primaryMatch.weakHitCount < 2) continue;

      const secondaryMatch = secondaryKws.length
        ? matchKeywordGroupLocal(contextText, ctxSet, secondaryKws)
        : { exact: [], weak: [], exactHitCount: 0, weakHitCount: 0, hitCount: 0 };

      const secondaryMiss = secondaryKws.length > 0 && secondaryMatch.hitCount <= 0;

      const kwExactHits = primaryMatch.exactHitCount + secondaryMatch.exactHitCount;
      const kwFuzzyHits = primaryMatch.weakHitCount + secondaryMatch.weakHitCount;

      const totalGateKeywords = primaryKws.length + secondaryKws.length;
      const keywordScore = totalGateKeywords ? Math.min(1, (kwExactHits + kwFuzzyHits * 0.6) / totalGateKeywords) : 0;
      const eventPhrase = norm(mem.event || '');
      const eventPhraseHit = eventPhrase && eventPhrase.length >= 4 && norm(contextText).includes(eventPhrase) ? 1 : 0;
      
      
      const isLow = mem.priority === 'low';
      const pw = isLow ? 0.15 : (mem.priority === 'medium' ? 0.5 : 0.3);
      const secondaryMul = secondaryMiss ? 0.4 : 1.0;
      const score = Math.max(0.01, (keywordScore * 0.65 + pw * 0.10 + 0.15) * secondaryMul);

      const matchedKeywords = uniq([...primaryMatch.exact, ...primaryMatch.weak, ...secondaryMatch.exact, ...secondaryMatch.weak]);
      if (!matchedKeywords.length) continue;

      const reasons = [];
      if (primaryMatch.exact.length) reasons.push('主关键词硬命中: ' + primaryMatch.exact.join(', '));
      if (primaryMatch.weak.length) reasons.push('主关键词弱匹配: ' + primaryMatch.weak.join(', '));
      if (secondaryKws.length) {
        if (secondaryMatch.exact.length) reasons.push('辅助关键词硬命中: ' + secondaryMatch.exact.join(', '));
        if (secondaryMatch.weak.length) reasons.push('辅助关键词弱匹配: ' + secondaryMatch.weak.join(', '));
      }

      primary.push({
        ...mem,
        _score: score,
        _reason: reasons.join('；') || '关键词命中',
        _matchedKeywords: matchedKeywords,
      });
    }

    primary.sort((a,b)=>b._score-a._score);
    const maxTriggered=recallCfgLocal.maxRecall||6;
    const lowCandidates = primary.filter(m => m.priority === 'low');
    const medCandidates = primary.filter(m => m.priority !== 'low');
    const lowReserved = (maxTriggered >= 3 && lowCandidates.length > 0) ? 1 : 0;
    const medCap = maxTriggered - lowReserved;

    const selected=[];
    const seenIds=new Set();
    const seenPrints=new Set();

    const alreadySeen = (mem) => {
      const fp = memFingerprint(mem);
      return seenIds.has(mem?.id) || (fp && seenPrints.has(fp));
    };
    const markSeen = (mem) => {
      if (mem?.id != null) seenIds.add(mem.id);
      const fp = memFingerprint(mem);
      if (fp) seenPrints.add(fp);
    };

    for(const mem of medCandidates){
      if(selected.length>=medCap) break;
      if(alreadySeen(mem)) continue;
      selected.push(mem);
      markSeen(mem);
    }
    for(const mem of lowCandidates){
      if(selected.length>=maxTriggered) break;
      if(alreadySeen(mem)) continue;
      selected.push(mem);
      markSeen(mem);
    }
    for(const mem of medCandidates){
      if(selected.length>=maxTriggered) break;
      if(alreadySeen(mem)) continue;
      selected.push(mem);
      markSeen(mem);
    }

    selected.sort((a,b)=>b._score-a._score);
    return { pinned: dedupeByFingerprint(pinned), triggered: dedupeByFingerprint(selected).slice(0, maxTriggered), contextText };
  };

  // === LLM 调用：带自动重试、超时、合并 abort ===
  const RETRY_CODES = new Set([429, 500, 502, 503, 504]);
  const MAX_RETRIES = 3;
  const FETCH_TIMEOUT = 90000; // 90秒

  const mergeSignals = (userSignal) => {
    const timeout = AbortSignal.timeout(FETCH_TIMEOUT);
    if (!userSignal) return timeout;
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort(userSignal.reason || timeout.reason || 'aborted');
    if (userSignal.aborted) { ctrl.abort(userSignal.reason); return ctrl.signal; }
    if (timeout.aborted) { ctrl.abort('timeout'); return ctrl.signal; }
    userSignal.addEventListener('abort', onAbort, { once: true });
    timeout.addEventListener('abort', onAbort, { once: true });
    return ctrl.signal;
  };

  const callLLMOnce = async (prompt, signal, api, provider, model, key, base) => {
    if (provider === 'claude') {
      const url = (base || 'https://api.anthropic.com') + '/v1/messages';
      const res = await fetch(url, {
        method: 'POST', signal,
        headers: {
          'x-api-key': key,
          'anthropic-version': api.anthropicVersion || '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify(Object.fromEntries(Object.entries({
          model,
          max_tokens: Number.isFinite(Number(api.maxTokens)) ? Number(api.maxTokens) : undefined,
          temperature: api.temperature === '' || api.temperature == null ? undefined : Number(api.temperature),
          top_p: api.topP === '' || api.topP == null ? undefined : Number(api.topP),
          top_k: api.topK === '' || api.topK == null ? undefined : Number(api.topK),
          messages: [{ role: 'user', content: prompt }]
        }).filter(([, v]) => v !== undefined)))
      });
      if (!res.ok) {
        const e = await res.text().catch(() => '');
        throw Object.assign(new Error('Claude ' + res.status + ': ' + e.slice(0, 500)), { status: res.status });
      }
      const d = await res.json();
      return (d.content || []).filter(x => x?.type === 'text').map(x => x.text || '').join('\n');
    }

    if (provider === 'gemini') {
      const gemBase = base || 'https://generativelanguage.googleapis.com/v1beta';
      const url = gemBase + '/models/' + encodeURIComponent(model) + ':generateContent';
      const res = await fetch(url, {
        method: 'POST', signal,
        headers: {
          'x-goog-api-key': key,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: Object.fromEntries(Object.entries({
            temperature: api.temperature === '' || api.temperature == null ? undefined : Number(api.temperature),
            topP: api.topP === '' || api.topP == null ? undefined : Number(api.topP),
            topK: api.topK === '' || api.topK == null ? undefined : Number(api.topK),
            maxOutputTokens: Number.isFinite(Number(api.maxTokens)) ? Number(api.maxTokens) : undefined
          }).filter(([, v]) => v !== undefined))
        })
      });
      if (!res.ok) {
        const e = await res.text().catch(() => '');
        throw Object.assign(new Error('Gemini ' + res.status + ': ' + e.slice(0, 500)), { status: res.status });
      }
      const d = await res.json();
      return (d.candidates || []).flatMap(c => c?.content?.parts || []).map(p => p?.text || '').join('\n');
    }

    // OpenAI 兼容
    const url = (base || '').replace(/\/+$/, '') + '/chat/completions';
    const res = await fetch(url, {
      method: 'POST', signal,
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(Object.entries({ model, messages: [{ role: 'user', content: prompt }], temperature: api.temperature === '' || api.temperature == null ? undefined : Number(api.temperature), top_p: api.topP === '' || api.topP == null ? undefined : Number(api.topP), presence_penalty: api.presencePenalty === '' || api.presencePenalty == null ? undefined : Number(api.presencePenalty), frequency_penalty: api.frequencyPenalty === '' || api.frequencyPenalty == null ? undefined : Number(api.frequencyPenalty), max_tokens: Number.isFinite(Number(api.maxTokens)) ? Number(api.maxTokens) : undefined }).filter(([, v]) => v !== undefined)))
    });
    if (!res.ok) {
      const e = await res.text().catch(() => '');
      throw Object.assign(new Error('OpenAI兼容 ' + res.status + ': ' + e.slice(0, 500)), { status: res.status });
    }
    const d = await res.json();
    return d.choices?.[0]?.message?.content || '';
  };

  const callLLM = async (prompt, signal) => {
    const api = await pullJson(AK, loadApi());
    try { localStorage.setItem(AK, JSON.stringify(api)); } catch {}
    const provider = api.provider || 'openai';
    const model = api.model || '';
    const key = api.key || '';
    const rawBase = api.url || '';
    const base = provider === 'claude' ? normalizeClaudeBase(rawBase) : provider === 'gemini' ? normalizeGeminiBase(rawBase) : normalizeOpenAIBase(rawBase);
    if (!key || !model) throw new Error('请先在 API配置 中设置 Provider / Key / Model');

    let lastErr = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // 用户已手动 abort → 立即退出，不重试
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        const merged = mergeSignals(signal);
        return await callLLMOnce(prompt, merged, api, provider, model, key, base);
      } catch (err) {
        lastErr = err;
        // 用户手动 abort → 不重试
        if (err?.name === 'AbortError' && signal?.aborted) throw err;
        // 超时 → 算作可重试
        if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
          lastErr = new Error('请求超时（' + (FETCH_TIMEOUT / 1000) + '秒）');
        }
        // 4xx（非429）→ 配置问题，不重试
        const st = err?.status;
        if (st && st >= 400 && st < 500 && st !== 429) throw err;
        // 可重试的错误码或超时 → 等待后重试
        if (attempt < MAX_RETRIES - 1) {
          const delay = Math.min(2000 * Math.pow(2, attempt), 16000);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    throw lastErr || new Error('API 调用失败');
  };

  let memories=[];
  try {
    memories = dedupeMemories(await loadMemories());
  } catch {
    memories = dedupeMemories(await pullJson(MK, []));
  }

  await pullJson(BK, loadBlacklist());
  await pullJson(AK, loadApi());
  const syncedPrompt = await pullText(PK, loadPrompt());
  if (syncedPrompt) { try { localStorage.setItem(PK, syncedPrompt); } catch {} }
  let editId=null;
  let _listScrollY=0;
  let _editUndo=null;
  const xbEvents=loadXb();
  let animaState = await loadCurrentAnimaSummaries({ context: ctx });
  let animaSummaries = Array.isArray(animaState?.items) ? animaState.items : [];
  let horaeState = await loadCurrentHoraeMemories({ context: ctx });
  let horaeMemories = Array.isArray(horaeState?.items) ? horaeState.items : [];

  const isRebuildableMemory = (memory) => memory?.source === 'xb_event' || memory?.source === 'anima_summary' || memory?.source === 'horae_memory';

  const opLocks = new Set();
  const withLock = async (key, fn) => {
    if (opLocks.has(key)) return false;
    opLocks.add(key);
    try {
      await fn();
      return true;
    } finally {
      opLocks.delete(key);
    }
  };

  // === 操作状态持久化 ===
  const PEND_KEY = 'mp_pending_ops';
  const loadPendingOps = () => {
    try { const m = metaRoot(); if (m && m[PEND_KEY]) return m[PEND_KEY]; } catch {}
    try { const r = localStorage.getItem(PEND_KEY); if (r) return JSON.parse(r); } catch {}
    return {};
  };
  const savePendingOp = async (opType, data) => {
    const all = loadPendingOps();
    const slim = { ...data, updatedAt: Date.now() };
    if (Array.isArray(slim.results) && slim.results.length > 0) {
      all[opType] = { ...slim, resultCount: slim.results.length };
      try { localStorage.setItem(PEND_KEY + '_results_' + opType, JSON.stringify(slim.results)); } catch {}
    } else {
      all[opType] = slim;
    }
    try { localStorage.setItem(PEND_KEY, JSON.stringify(all)); } catch {}
  };
  const loadPendingResults = (opType) => {
    try { const r = localStorage.getItem(PEND_KEY + '_results_' + opType); return r ? JSON.parse(r) : null; } catch { return null; }
  };
  const clearPendingOp = async (opType) => {
    const all = loadPendingOps();
    delete all[opType];
    try { localStorage.setItem(PEND_KEY, JSON.stringify(all)); } catch {}
    try { localStorage.removeItem(PEND_KEY + '_results_' + opType); } catch {}
  };
  const STALE_TIMEOUT = 5 * 60 * 1000; // 5 分钟判定为超时
  const checkStaleOps = (ops) => {
    const now = Date.now();
    const result = {};
    for (const [k, v] of Object.entries(ops || {})) {
      if (v.status === 'running' && now - (v.updatedAt || 0) > STALE_TIMEOUT) {
        result[k] = { ...v, status: 'timeout' };
      } else {
        result[k] = v;
      }
    }
    return result;
  };
  const fmtTimeAgo = (ts) => {
    const d = Date.now() - (ts || 0);
    if (d < 60000) return '刚刚';
    if (d < 3600000) return Math.floor(d / 60000) + '分钟前';
    if (d < 86400000) return Math.floor(d / 3600000) + '小时前';
    return Math.floor(d / 86400000) + '天前';
  };
  const renderPendingBanner = (container, opType, label) => {
    const ops = checkStaleOps(loadPendingOps());
    const op = ops[opType];
    const bannerId = 'mp_banner_' + opType;
    const old = document.getElementById(bannerId);
    if (old) old.remove();
    if (!op || op.status === 'dismissed') return;
    const colors = { done: 'rgba(74,222,128,0.12)', error: 'rgba(248,113,113,0.12)', timeout: 'rgba(251,191,36,0.12)', running: 'rgba(124,107,240,0.12)' };
    const icons = { done: '🟢', error: '🔴', timeout: '🟡', running: '🔵' };
    const statusText = { done: '已完成', error: '失败', timeout: '超时（页面曾关闭）', running: '进行中' };
    const bg = colors[op.status] || colors.running;
    const icon = icons[op.status] || '🔵';
    const stxt = statusText[op.status] || op.status;
    const time = op.updatedAt ? '（' + fmtTimeAgo(op.updatedAt) + '）' : '';
    const msg = op.message || '';
    const hasResults = op.status === 'done' && (op.resultCount > 0 || (Array.isArray(op.results) && op.results.length > 0));
    const countText = hasResults ? (op.resultCount || op.results?.length || 0) + '条结果' : '';
    const errText = op.status === 'error' ? '<div style="margin-top:4px;font-size:11px;color:#f87171;word-break:break-all">' + h(op.error || '') + '</div>' : '';
    const banner = document.createElement('div');
    banner.id = bannerId;
    banner.style.cssText = 'background:' + bg + ';border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 12px;margin-bottom:8px';
    banner.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><div><span>' + icon + '</span> <b>' + h(label) + '</b> ' + h(stxt) + h(time) + (countText ? ' · ' + h(countText) : '') + (msg ? ' · ' + h(msg) : '') + '</div><div style="display:flex;gap:5px">' + (hasResults ? '<button class="btn bp1" id="' + bannerId + '_view">查看结果</button>' : '') + '<button class="btn" id="' + bannerId + '_dismiss">清除</button></div></div>' + errText;
    if (container.firstChild) container.insertBefore(banner, container.firstChild);
    else container.appendChild(banner);
    document.getElementById(bannerId + '_dismiss')?.addEventListener('click', async () => { await clearPendingOp(opType); banner.remove(); });
    return bannerId;
  };

  // ===== Style =====
  const st=document.createElement('style');st.id=S;
  st.textContent=`
    #${P}{position:fixed;inset:0;z-index:10001;display:flex;align-items:flex-start;justify-content:center;padding:max(10px, env(safe-area-inset-top)) 10px max(10px, env(safe-area-inset-bottom)) 10px;box-sizing:border-box;font-family:-apple-system,sans-serif}
    #${P} .mask{position:absolute;inset:0;background:rgba(0,0,0,0.55);backdrop-filter:blur(5px)}
    #${P} .card{position:relative;width:100%;max-width:960px;max-height:calc(100dvh - max(20px, env(safe-area-inset-top) + env(safe-area-inset-bottom)));background:#222327;border-radius:14px;border:1px solid rgba(255,255,255,0.08);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 16px 50px rgba(0,0,0,0.5)}
    #${P} .hd{padding:11px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0}
    #${P} .hd h3{margin:0;color:#fff;font-size:16px}
    #${P} .hdactions{display:flex;align-items:center;gap:4px}
    #${P} .helpbtn{background:none;border:none;color:#888;font-size:17px;cursor:pointer;width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:50%}
    #${P} .helpbtn:hover{background:rgba(255,255,255,0.1);color:#fff}
    #${P} .cls{background:none;border:none;color:#888;font-size:22px;cursor:pointer;width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:50%}
    #${P} .cls:hover{background:rgba(255,255,255,0.1);color:#fff}
    #${P} .tabs{display:flex;gap:4px;padding:7px 12px;background:rgba(0,0,0,0.25);flex-wrap:wrap;flex-shrink:0}
    #${P} .ftab{padding:6px 11px;border-radius:7px;border:1px solid rgba(255,255,255,0.08);background:transparent;color:#aaa;cursor:pointer;font-size:11px;white-space:nowrap}
    #${P} .ftab:hover{background:rgba(255,255,255,0.05);color:#fff}
    #${P} .ftab.on{background:rgba(124,107,240,0.15);color:#7c6bf0;border-color:rgba(124,107,240,0.4)}
    #${P} .tab{padding:6px 11px;border-radius:7px;border:1px solid rgba(255,255,255,0.08);background:transparent;color:#aaa;cursor:pointer;font-size:11px;white-space:nowrap}
    #${P} .tab:hover{background:rgba(255,255,255,0.05);color:#fff}
    #${P} .tab.on{background:rgba(124,107,240,0.15);color:#7c6bf0;border-color:rgba(124,107,240,0.4)}
    #${P} .bd{flex:1;overflow-y:auto;padding:12px 16px calc(96px + env(safe-area-inset-bottom, 0px));min-height:0;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;scroll-padding-bottom:calc(96px + env(safe-area-inset-bottom, 0px))}
    #${P} .pg{display:none} #${P} .pg.on{display:block}
    #${P} .sts{display:flex;gap:8px;margin-bottom:12px}
    #${P} .st{flex:1;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 6px;text-align:center}
    #${P} .st b{display:block;font-size:20px;color:#fff} #${P} .st small{font-size:9px;color:#666}
    #${P} .mi{background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 12px;margin-bottom:7px}
    #${P} .mi:hover{border-color:rgba(255,255,255,0.2)}
    #${P} .mh{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:3px}
    #${P} .me{font-weight:600;color:#fff;font-size:13px;word-break:break-word}
    #${P} .ms{color:#ccc;font-size:12px;line-height:1.45;margin-bottom:4px;word-break:break-word}
    #${P} .bp{padding:2px 7px;border-radius:4px;font-size:10px;font-weight:600;white-space:nowrap;flex-shrink:0}
    #${P} .bph{background:rgba(248,113,113,0.15);color:#f87171}
    #${P} .bpm{background:rgba(251,191,36,0.15);color:#fbbf24}
    #${P} .bpl{background:rgba(74,222,128,0.15);color:#4ade80}
    #${P} .kr{display:flex;flex-wrap:wrap;gap:3px}
    #${P} .kw{background:rgba(124,107,240,0.15);color:#a5b4fc;padding:2px 6px;border-radius:4px;font-size:10px}
    #${P} .kx{background:rgba(139,92,246,0.2);color:#c4b5fd}
    #${P} .ke{background:rgba(59,130,246,0.18);color:#93c5fd}
    #${P} .ma{display:flex;gap:5px;margin-top:7px;flex-wrap:wrap}
    #${P} .btn{padding:5px 11px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#ddd;font-size:11px;cursor:pointer;white-space:nowrap}
    #${P} .btn:hover{background:rgba(255,255,255,0.1);color:#fff}
    #${P} .btn:disabled{opacity:0.35;cursor:default}
    #${P} .xi .btn[aria-current="true"]{opacity:1;cursor:default}
    #${P} .bp1{background:rgba(124,107,240,0.2);border-color:rgba(124,107,240,0.4);color:#a5b4fc}
    #${P} .bp1:hover{background:rgba(124,107,240,0.3)}
    #${P} .bd1{border-color:rgba(248,113,113,0.3);color:#f87171}
    #${P} .bd1:hover{background:rgba(248,113,113,0.15)}
    #${P} .fg{margin-bottom:10px}
    #${P} .fg label{display:block;color:#aaa;font-size:11px;margin-bottom:2px}
    #${P} .fg input,#${P} .fg textarea,#${P} .fg select{width:100%;padding:8px;border-radius:7px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.3);color:#eee;font-size:13px;box-sizing:border-box;font-family:inherit}
    #${P} .fg textarea{min-height:55px;resize:vertical}
    #${P} .fg input:focus,#${P} .fg textarea:focus,#${P} .fg select:focus{outline:none;border-color:rgba(124,107,240,0.5)}
    #${P} .emp{text-align:center;padding:20px;color:#555;font-size:13px}
    #${P} .ht{font-size:10px;color:#777;margin-top:2px}
    #${P} .xi{background:rgba(124,107,240,0.04);border:1px solid rgba(124,107,240,0.12);border-radius:10px;padding:9px 11px;margin-bottom:7px}
    #${P} .xi:hover{border-color:rgba(124,107,240,0.35)}
    #${P} .xt{font-weight:600;color:#c4b5fd;font-size:13px;word-break:break-word}
    #${P} .xp{font-size:10px;color:#7c6bf0;margin-top:3px}
    #${P} .fr{display:flex;gap:5px;margin-bottom:9px;flex-wrap:wrap;align-items:center}
    #${P} .fr input{flex:1;min-width:100px}
    #${P} .fr select{width:auto;min-width:60px;flex-shrink:0}
    #${P} .det{border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:8px 11px;margin-top:8px}
    #${P} .det summary{cursor:pointer;color:#aaa;font-size:12px}
    #${P} .badge{background:rgba(124,107,240,0.15);color:#7c6bf0;padding:1px 5px;border-radius:7px;font-size:10px;margin-left:3px}
    #${P} .sr{background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:7px 10px;margin-bottom:5px;font-size:11px;color:#bbb}
    #${P} .sr .sf{color:#7c6bf0;font-weight:600}
    #${P} .sr .sp{color:#888;font-size:10px}
    #${P} .sr .stx{color:#aaa;margin-top:2px;font-size:11px;line-height:1.4}
    #${P} .sr mark{background:rgba(251,191,36,0.3);color:#fbbf24;border-radius:2px;padding:0 1px}
    #${P} .rc{background:rgba(124,107,240,0.06);border:1px solid rgba(124,107,240,0.15);border-radius:8px;padding:8px 10px;margin-bottom:6px}
    #${P} .rc .rl{color:#888;font-size:10px}
    #${P} .mi.hit{border-color:rgba(124,107,240,0.75);box-shadow:0 0 0 1px rgba(124,107,240,0.35)}
    #${P} .undo{display:none;background:rgba(251,191,36,0.12);border:1px solid rgba(251,191,36,0.28);border-radius:8px;padding:8px 10px;margin:8px 0;color:#fbbf24;font-size:12px}
    #${P} .floatnav{position:absolute;right:14px;bottom:calc(14px + env(safe-area-inset-bottom, 0px));z-index:5;display:flex;flex-direction:column;gap:6px}
    #${P} .floatnav .btn{width:42px;height:34px;padding:0;font-size:14px;background:rgba(20,20,24,0.92);box-shadow:0 8px 20px rgba(0,0,0,0.35)}
    #${P} .guide{position:absolute;inset:0;z-index:7;display:none;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
    #${P} .guide.on{display:flex}
    #${P} .guidebox{position:relative;z-index:1;width:min(560px,100%);max-height:min(76dvh,620px);overflow:auto;background:#24252a;border:1px solid rgba(255,255,255,0.12);border-radius:12px;box-shadow:0 20px 70px rgba(0,0,0,0.55);padding:16px}
    #${P} .guidebox h4{margin:0 0 10px;color:#fff;font-size:15px}
    #${P} .guideintro{margin:0 0 10px;color:#777;font-size:11px;line-height:1.6}
    #${P} .guidesteps{display:grid;gap:8px}
    #${P} .guidestep{padding:10px 11px;border:1px solid rgba(255,255,255,.1);border-radius:9px;background:rgba(255,255,255,.025)}
    #${P} .guidestephead{display:flex;align-items:center;gap:7px;flex-wrap:wrap;color:#fff;font-size:12px}
    #${P} .guidestep p{margin:5px 0 0;color:#bbb;font-size:11px;line-height:1.6}
    #${P} .guidetag{padding:2px 6px;border-radius:5px;background:rgba(124,107,240,.18);color:#c4b5fd;font-size:9px}
    #${P} .guideinject{margin-top:7px}
    #${P} .guideinject summary{cursor:pointer;color:#a5b4fc;font-size:11px}
    #${P} .guideinject ul{margin:7px 0;padding-left:18px;color:#bbb;font-size:11px;line-height:1.6}
    #${P} .guideprompt{display:block;width:100%;height:190px;box-sizing:border-box;padding:9px;margin-top:7px;resize:vertical;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:rgba(0,0,0,.25);color:#eee;font-family:inherit;font-size:11px;line-height:1.55}
    #${P} .guidebranches{display:grid;gap:6px;margin-top:7px}
    #${P} .guidebranch{padding:8px;border:1px solid rgba(255,255,255,.08);border-radius:7px;color:#bbb;font-size:11px;line-height:1.55}
    #${P} .guidebranch b{color:#ddd}
    #${P} .guidenote{padding:9px 10px;border-radius:8px;background:rgba(124,107,240,.08);color:#aaa;font-size:11px;line-height:1.6}
    #${P} .guidebox .gbar{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px}
    #${P} .me.jump{cursor:pointer;color:#c4b5fd}
    #${P} .me.jump:hover{text-decoration:underline;color:#fff}
    #${P} .guidebox .stepgo{margin-left:6px;padding:2px 7px;font-size:10px}
    @media(max-width:760px){
      #${P}{padding:max(6px, env(safe-area-inset-top)) 6px max(6px, env(safe-area-inset-bottom)) 6px}
      #${P} .card{max-width:100%;max-height:calc(100dvh - max(12px, env(safe-area-inset-top) + env(safe-area-inset-bottom)));border-radius:10px}
      #${P} .hd{padding:9px 12px}
      #${P} .tabs{padding:6px 8px;gap:4px}
      #${P} .tab{padding:5px 8px;font-size:10px}
      #${P} .bd{padding:10px 12px calc(110px + env(safe-area-inset-bottom, 0px));scroll-padding-bottom:calc(110px + env(safe-area-inset-bottom, 0px))}
      #${P} .sts{gap:6px}
      #${P} .st b{font-size:18px}
      #${P} .mh{align-items:flex-start}
      #${P} .fr{flex-direction:column;align-items:stretch}
      #${P} .fr input,#${P} .fr select{width:100%;min-width:0}
      #${P} .ma{flex-direction:column}
      #${P} .ma .btn{width:100%;text-align:center}
    }
    @media(max-width:480px){
      #${P}{padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom) 0}
      #${P} .card{border-radius:0;max-height:100dvh;border-left:none;border-right:none}
      #${P} .hd{padding:8px 10px}
      #${P} .tabs{padding:5px 6px}
      #${P} .bd{padding:8px 10px calc(120px + env(safe-area-inset-bottom, 0px));scroll-padding-bottom:calc(120px + env(safe-area-inset-bottom, 0px))}
      #${P} .tab{flex:1 1 calc(50% - 4px);text-align:center}
      #${P} .mh{flex-direction:column}
      #${P} .bp{align-self:flex-start}
      #${P} .batchactions .btn{flex:1 1 calc(50% - 4px)}
      #${P} .mergesetup{padding:11px}
      #${P} .mergebar{align-items:stretch}
      #${P} .kwmode{width:100%}
      #${P} .kwmodebtn{flex:1}
    }
    /* ===== MemoryPilot Day — warm white + mist purple ===== */
    #${P}{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#352f3c}
    #${P} .mask{background:rgba(55,48,63,.22);backdrop-filter:blur(3px)}
    #${P} .card{background:#f8f6fb;border-color:#ddd7e5;box-shadow:0 18px 54px rgba(63,51,76,.18)}
    #${P} .hd{background:#fff;border-color:#e8e3ed;padding:13px 18px}
    #${P} .hd h3{color:#302a37;font-size:18px;letter-spacing:.01em}
    #${P} .cls{color:#756d7e}
    #${P} .cls:hover{background:#f0ecf5;color:#3f3748}
    #${P} .helpbtn{color:#756d7e}
    #${P} .helpbtn:hover{background:#f0ecf5;color:#3f3748}
    #${P} .hubnav{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:8px 12px;background:#fff;border-bottom:1px solid #e8e3ed}
    #${P} .hubtab{min-height:38px;border:1px solid #ded8e6;border-radius:10px;background:#faf9fb;color:#625a6b;font-size:12px;font-weight:600;cursor:pointer}
    #${P} .hubtab:hover{background:#f1edf6;border-color:#c9bfd8}
    #${P} .hubtab.on{background:#ebe5f4;border-color:#b7a8cb;color:#675181;box-shadow:inset 0 0 0 1px rgba(126,102,155,.08)}
    #${P} .tabs{flex-wrap:nowrap;overflow-x:auto;padding:8px 12px;background:#f4f1f7;border-bottom:1px solid #e3dfe8;scrollbar-width:none}
    #${P} .tabs::-webkit-scrollbar{display:none}
    #${P} .tab,#${P} .ftab{background:#fff;border-color:#ddd7e5;color:#665e6f;padding:7px 12px}
    #${P} .tab:hover,#${P} .ftab:hover{background:#f0ebf5;color:#4f405f}
    #${P} .tab.on,#${P} .ftab.on{background:#e9e1f2;color:#694f85;border-color:#b9a7cd}
    #${P} .bd{background:#f8f6fb;padding-top:14px}
    #${P} .st,#${P} .mi,#${P} .xi,#${P} .sr,#${P} .rc,#${P} .det{background:#fff;border-color:#e1dce7;box-shadow:0 2px 8px rgba(66,54,78,.035)}
    #${P} .mi:hover,#${P} .xi:hover{border-color:#bdaeCA}
    #${P} .st b,#${P} .me,#${P} .guidebox h4{color:#312a38}
    #${P} .st small,#${P} .ht,#${P} .sr .sp,#${P} .rc .rl{color:#7a7283}
    #${P} .ms,#${P} .sr,#${P} .sr .stx,#${P} .det summary{color:#514a59}
    #${P} .xt,#${P} .me.jump{color:#6d5488}
    #${P} .me.jump:hover{color:#4e3966}
    #${P} .kw{background:#eee7f6;color:#694f85}
    #${P} .kx{background:#f0e8f6;color:#75518c}
    #${P} .ke{background:#e7eef9;color:#42648c}
    #${P} .bph{background:#fbe9ea;color:#a84450}
    #${P} .bpm{background:#fff2d8;color:#8c6419}
    #${P} .bpl{background:#e7f4ea;color:#3f7450}
    #${P} .bpi{background:#eeebf1;color:#69616f}
    #${P} .btn{background:#fff;border-color:#d8d2df;color:#504858;box-shadow:none}
    #${P} .btn:hover{background:#f0ecf4;color:#3e3547}
    #${P} .bp1{background:#e9e1f2;border-color:#b9a7cd;color:#674f80}
    #${P} .bp1:hover{background:#ded2eb;color:#533b6d}
    #${P} .bd1{background:#fff7f7;border-color:#e7b9bd;color:#a7464f}
    #${P} .bd1:hover{background:#f9e4e6;color:#923a43}
    #${P} .fg label,#${P} label{color:#5d5565!important}
    #${P} .fg input,#${P} .fg textarea,#${P} .fg select,#${P} #mp_merge_kw_mode,#${P} #mp_f_search{background:#fff!important;color:#342e3a!important;border-color:#d9d3e0!important;box-shadow:none!important}
    #${P} .fg input:focus,#${P} .fg textarea:focus,#${P} .fg select:focus,#${P} #mp_f_search:focus{border-color:#9e88b8!important;box-shadow:0 0 0 3px rgba(126,102,155,.12)!important}
    #${P} input[type="checkbox"]{-webkit-appearance:none!important;appearance:none!important;display:grid!important;place-content:center;width:18px!important;min-width:18px!important;height:18px!important;flex:0 0 18px;padding:0!important;margin:0!important;border:2px solid #a99ab8!important;border-radius:4px!important;background:#fff!important;box-shadow:none!important;opacity:1!important;color-scheme:light;cursor:pointer}
    #${P} input[type="checkbox"]:checked{border-color:#80679b!important;background:#80679b!important}
    #${P} input[type="checkbox"]:checked::after{content:"✓";color:#fff;font-size:13px;font-weight:800;line-height:1}
    #${P} input[type="checkbox"]:focus-visible{outline:3px solid rgba(126,102,155,.2);outline-offset:2px}
    #${P} .mp-check{display:flex;align-items:center;gap:8px;min-height:30px;color:#5d5565!important;cursor:pointer;user-select:none}
    #${P} .searchtools{position:sticky;top:0;z-index:4;margin:0 0 10px;padding:9px;background:#f8f6fb;border:1px solid #ddd7e5;border-radius:10px;box-shadow:0 5px 14px rgba(66,54,78,.08)}
    #${P} .searchtools .opline{margin:0 0 7px;color:#625a6b}
    #${P} .searchactions{display:flex;gap:6px;flex-wrap:wrap}
    #${P} .searchactions .btn{flex:1 1 auto}
    #${P} .memoryhelp{margin:0 0 12px}
    #${P} .memoryfilter{margin:0 0 12px;background:#fff;border:1px solid #d9d1e2;border-radius:11px;box-shadow:0 2px 8px rgba(66,54,78,.035);overflow:hidden}
    #${P} .memoryhelp>summary{padding:5px 3px;cursor:pointer;color:#624c78;font-size:12px;font-weight:700;list-style:none}
    #${P} .memoryfilter>summary{padding:11px 13px;cursor:pointer;color:#624c78;font-size:12px;font-weight:700;list-style:none}
    #${P} .memoryhelp>summary::-webkit-details-marker,#${P} .memoryfilter>summary::-webkit-details-marker{display:none}
    #${P} .memoryhelp>summary::before,#${P} .memoryfilter>summary::before{content:"▸";display:inline-block;margin-right:6px;color:#80679b;transition:transform .15s ease}
    #${P} .memoryhelp[open]>summary::before,#${P} .memoryfilter[open]>summary::before{transform:rotate(90deg)}
    #${P} .memoryhelpbody{margin-top:7px;padding:11px 13px;background:#fff;border:1px solid #d9d1e2;border-radius:11px;box-shadow:0 2px 8px rgba(66,54,78,.035);color:#554c5e;font-size:11px;line-height:1.65}
    #${P} .memoryfilterbody{padding:0 13px 12px;border-top:1px solid #ece7f0;color:#554c5e;font-size:11px;line-height:1.65}
    #${P} .memoryhelpbody h5{margin:10px 0 3px;color:#4b3b59;font-size:11px}
    #${P} .memoryhelpbody h5:first-child{margin-top:0}
    #${P} .memoryhelpbody ol,#${P} .memoryhelpbody ul{margin:3px 0;padding-left:20px}
    #${P} .memoryhelpbody p{margin:5px 0}
    #${P} .memoryhelpsection{padding:2px 0 7px}
    #${P} .memoryhelpsection+.memoryhelpsection{margin-top:12px;padding-top:13px;border-top:1px solid #e4ddea}
    #${P} .memoryhelpsection h5{display:flex;align-items:center;gap:8px;margin:0 0 9px;padding:7px 9px;border-radius:8px;background:#f1ebf6;color:#4f3d61;font-size:12px}
    #${P} .memoryhelpnum{display:grid;place-items:center;width:21px;height:21px;flex:0 0 21px;border-radius:50%;background:#80679b;color:#fff;font-size:11px;font-weight:700}
    #${P} .memoryhelpsection p{padding-left:9px;margin:7px 0 9px}
    #${P} .memoryhelpsection p>b{display:inline-block;margin-bottom:2px;color:#4b3b59}
    #${P} .filterchoices{display:grid;grid-template-columns:1fr;gap:6px;margin-top:8px}
    #${P} .filterchoices .btn{width:100%}
    #${P} .filtersearch{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:6px;margin-top:10px}
    #${P} .filtersearch input{width:100%;padding:7px 9px;border-radius:7px;border:1px solid #d9d3e0;background:#fff;color:#342e3a;font-size:11px;box-sizing:border-box}
    #${P} .filtersearch .btn{min-width:74px}
    #${P} .mp-pick-wrap{display:none}
    #${P}.multi-select-on .mp-pick-wrap{display:flex}
    #${P} .batchactions{display:grid;grid-template-columns:1fr;gap:6px;margin-top:9px}
    #${P} .batchactions .btn{width:100%}
    #${P} .sourceactions{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 9px}
    #${P} .sourceactions .btn{flex:1 1 150px}
    #${P} .sourcestatus{margin:0 0 9px;padding:9px 10px;border:1px solid #ddd7e5;border-radius:9px;background:#faf9fb;color:#625a6b;font-size:11px;line-height:1.55}
    #${P} .mergesetup{display:none;margin-bottom:9px;padding:12px 13px;background:#fff;border:1px solid #cdbfda;border-radius:11px;box-shadow:0 3px 10px rgba(66,54,78,.05)}
    #${P} .mergesetup.on{display:block}
    #${P} .mergesetuptitle{font-size:12px;font-weight:700;color:#544061;margin-bottom:8px}
    #${P} .mergebar{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:7px}
    #${P} .kwmode{display:flex;border:1px solid #cbbdd9;border-radius:8px;overflow:hidden;background:#fff}
    #${P} .kwmodebtn{padding:6px 10px;border:0;border-right:1px solid #ddd3e6;background:#fff;color:#665e6f;font-size:11px;cursor:pointer}
    #${P} .kwmodebtn:last-child{border-right:0}
    #${P} .kwmodebtn.on{background:#e9e1f2;color:#634b7c;font-weight:700}
    #${P} .mergeactions{display:flex;gap:6px;margin-top:9px;flex-wrap:wrap}
    #${P} .mergeactions .btn{flex:1}
    #${P} .advancedprompts{margin:0 0 9px}
    #${P} .advancedprompts>summary{font-size:12px;font-weight:700;color:#624c78}
    #${P} .promptcard{margin-top:10px;padding:3px 0 0;background:transparent;border:0;border-radius:0}
    #${P} .promptcard+.promptcard{margin-top:16px;padding-top:16px;border-top:1px solid #e2dce8}
    #${P} .prompttitle{margin:0 0 7px;font-size:12px;font-weight:700;color:#43384d}
    #${P} .prompteditor{display:block;width:100%;height:220px;padding:10px 11px;box-sizing:border-box;resize:vertical;overflow:auto;background:#fff!important;color:#342e3a!important;border:1px solid #cfc5d8!important;border-radius:9px;font-family:inherit;font-size:11px;line-height:1.65;box-shadow:inset 0 1px 2px rgba(61,49,72,.04)!important}
    #${P} .prompteditor:focus{outline:0;border-color:#9e88b8!important;box-shadow:0 0 0 3px rgba(126,102,155,.12)!important}
    #${P} .promptbuttons{display:flex;gap:6px;margin-top:7px}
    #${P} .promptnote{margin-top:7px;color:#756d7d;font-size:11px;line-height:1.65}
    #${P} .st{cursor:pointer;font-family:inherit}
    #${P} .st.on{background:#e9e1f2;border-color:#b9a7cd;box-shadow:inset 0 0 0 1px rgba(126,102,155,.08)}
    #${P} .st.on b,#${P} .st.on small{color:#654d7f}
    #${P} .sr ._sr_full{height:220px;overflow-y:auto;overscroll-behavior:contain;margin-top:7px!important;padding:9px 10px;background:#f8f6fb;border:1px solid #ddd7e5;border-radius:8px;box-sizing:border-box;scrollbar-width:thin;scrollbar-color:#c9bfd2 transparent}
    #${P} .sr ._sr_full::-webkit-scrollbar{width:6px}
    #${P} .sr ._sr_full::-webkit-scrollbar-thumb{background:#c9bfd2;border-radius:4px}
    #${P} .emp{color:#827a89}
    #${P} .badge{background:#e8e0f1;color:#654d7f}
    #${P} .undo{background:#fff4dc;border-color:#e8cd93;color:#805d1d}
    #${P} .cfgsubnav{display:flex;gap:6px;overflow-x:auto;margin:0 0 14px;padding-bottom:2px;scrollbar-width:none}
    #${P} .cfgsubnav::-webkit-scrollbar{display:none}
    #${P} .cfgsubtab{flex:0 0 auto;padding:7px 12px;border:1px solid #ddd7e5;border-radius:8px;background:#fff;color:#665e6f;font-size:11px;cursor:pointer}
    #${P} .cfgsubtab.on{background:#e9e1f2;color:#694f85;border-color:#b9a7cd}
    #${P} .cfgsection{display:none}
    #${P} .cfgsection.on{display:block}
    #${P} .cfgcard{background:#fff;border:1px solid #e1dce7;border-radius:12px;padding:13px;margin-bottom:12px}
    #${P} .cfgtitle{font-size:13px;font-weight:700;color:#413847;margin-bottom:10px}
    #${P} .cleaneditor{display:block;width:100%;padding:10px 11px!important;box-sizing:border-box;resize:vertical;background:#fff!important;color:#342e3a!important;border:1px solid #cfc5d8!important;border-radius:9px!important;font-family:inherit;font-size:12px!important;line-height:1.55;box-shadow:inset 0 1px 2px rgba(61,49,72,.04)!important}
    #${P} .cleaneditor:focus{outline:0;border-color:#9e88b8!important;box-shadow:0 0 0 3px rgba(126,102,155,.12)!important}
    #${P} .cleanupresult{padding:10px 11px;margin:8px 0;border:1px solid #ddd7e5;border-radius:9px;background:#faf9fb;color:#625a6b;font-size:11px;line-height:1.55}
    #${P} .autosummary{margin:0 0 14px;padding:13px;background:#fff;border:1px solid #d9d1e2;border-radius:12px;box-shadow:0 2px 8px rgba(66,54,78,.035)}
    #${P} .autosummaryhead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:7px}
    #${P} .autosummarytitle{font-size:13px;font-weight:700;color:#413847}
    #${P} .autosummarygrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}
    #${P} .autosummary .fg input,#${P} .autosummary .fg select,#${P} .cfgcard .fg input:not([type="checkbox"]),#${P} .cfgcard .fg select{display:block;width:100%!important;min-height:40px!important;margin-top:5px!important;padding:8px 10px!important;box-sizing:border-box!important;border:1px solid #d9d3e0!important;border-radius:9px!important;background:#fff!important;color:#342e3a!important;font:inherit!important;line-height:1.35!important;box-shadow:none!important;opacity:1!important}
    #${P} .autosummary .fg select,#${P} .cfgcard .fg select{-webkit-appearance:auto!important;appearance:auto!important}
    #${P} .autosummary .fg input:focus,#${P} .autosummary .fg select:focus,#${P} .cfgcard .fg input:not([type="checkbox"]):focus,#${P} .cfgcard .fg select:focus{outline:0!important;border-color:#9e88b8!important;box-shadow:0 0 0 3px rgba(126,102,155,.12)!important}
    #${P} .autosummarystatus{margin-top:11px;padding:10px 11px;border:1px solid #ddd7e5;border-radius:9px;background:#faf9fb;color:#625a6b;font-size:11px;line-height:1.6}
    #${P} .autosummarystatus.err{border-color:#e7b9bd;background:#fff7f7;color:#a7464f}
    #${P} .autosummaryactions{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
    #${P} .autosummaryactions .btn{flex:1}
    #${P} .automanualtitle{margin:4px 0 11px;padding-top:2px;font-size:13px;font-weight:700;color:#413847}
    #${P} .batchresultactions{margin:0 0 9px;padding:9px;background:#f8f6fb;border:1px solid #ddd7e5;border-radius:10px}
    #${P} .batchresultactions .btn{width:100%}
    @media(max-width:560px){#${P} .autosummarygrid{grid-template-columns:1fr}}
    #${P} .floatnav .btn{background:#fff;color:#574d60;border-color:#d8d1df;box-shadow:0 8px 22px rgba(67,55,79,.15)}
    #${P} .guidebox{background:#fff;border-color:#ddd6e4;box-shadow:0 20px 65px rgba(54,45,64,.2)}
    #${P} .guideintro{color:#756d7d}
    #${P} .guidestep{background:#faf9fb;border-color:#e2dce8}
    #${P} .guidestephead{color:#403647}
    #${P} .guidestep p,#${P} .guideinject ul,#${P} .guidebranch{color:#625a6b}
    #${P} .guidetag{background:#e9e1f2;color:#674f80}
    #${P} .guideinject summary{color:#694f85}
    #${P} .guideprompt{background:#fff;color:#342e3a;border-color:#cfc5d8}
    #${P} .guidebranch{background:#fff;border-color:#e1dce7}
    #${P} .guidebranch b{color:#4b3b59}
    #${P} .guidenote{background:#f1ebf6;color:#625a6b}
    #${P} [style*="color:#fff"],#${P} [style*="color: #fff"],#${P} [style*="color:#ccc"]{color:#3c3544!important}
    #${P} .sr mark{background:#fff0bf;color:#765714}
    #${P} .mi.hit{border-color:#9e84ba;box-shadow:0 0 0 2px rgba(126,102,155,.16)}
    @media(max-width:600px){
      #${P} .hubnav{padding:7px 8px;gap:5px}
      #${P} .hubtab{min-height:36px;font-size:11px}
      #${P} .tabs{padding:7px 8px}
      #${P} .tab{flex:0 0 auto!important;font-size:11px;padding:7px 11px}
      #${P} .ma{flex-direction:row}
      #${P} .ma .btn{width:auto;flex:1 1 auto}
    }
  `;
  document.head.appendChild(st);

  // ===== DOM =====
  const root=document.createElement('div');root.id=P;
  root.innerHTML=`
    <div class="mask"></div>
    <div class="card">
      <div class="hd"><h3>MemoryPilot</h3><div class="hdactions"><button class="helpbtn" id="mp_help" aria-label="打开新手指引" title="新手指引">?</button><button class="cls" id="mp_cls" aria-label="关闭">&times;</button></div></div>
      <nav class="hubnav" aria-label="MemoryPilot 主导航">
        <button class="hubtab on" data-hub="memory">记忆管理</button>
        <button class="hubtab" data-hub="monitor">召回监控</button>
        <button class="hubtab" data-hub="settings">设置</button>
      </nav>
      <div class="tabs">
        <button class="tab on" data-t="list">记忆列表</button>
        <button class="tab" data-t="batch">楼层总结</button>
        <button class="tab" data-t="xb">小白X总结 <span class="badge">${xbEvents.length}</span></button>
        <button class="tab" data-t="anima">Anima总结 <span class="badge" id="mp_anima_tab_count">${animaSummaries.length}</span></button>
        <button class="tab" data-t="horae">Horae记忆 <span class="badge" id="mp_horae_tab_count">${horaeMemories.length}</span></button>
        <button class="tab" data-t="add">手动添加 / 编辑</button>
      </div>
      <div class="bd">
        <div class="pg on" id="mp_pg_list">
          <details class="memoryhelp">
            <summary>记忆列表使用说明</summary>
            <div class="memoryhelpbody">
              <section class="memoryhelpsection">
                <h5><span class="memoryhelpnum">1</span><span>记忆来源（五选一）</span></h5>
                <p><b>手动添加</b><br>进入“手动添加 / 编辑”填写记忆。</p>
                <p><b>楼层总结</b><br>选择聊天楼层，由 AI 总结为候选记忆。</p>
                <p><b>小白X总结</b><br>先在“小白X总结”页导入；然后回到记忆列表，选择“未重构小白X总结”，执行“批量重构关键词”。</p>
                <p><b>Anima总结</b><br>先在“Anima总结”页导入；然后回到记忆列表，选择“未重构Anima总结”，执行“批量重构关键词”。</p>
                <p><b>Horae记忆</b><br>在“Horae记忆”页导入尚未入库的原始时间线事件；Horae 后续压缩不会改动已经导入的记忆。然后回到记忆列表，选择“未重构Horae记忆”，执行“批量重构关键词”。</p>
              </section>
              <section class="memoryhelpsection">
                <h5><span class="memoryhelpnum">2</span><span>召回类型</span></h5>
                <p><b>常驻</b><br>不需要命中关键词，会持续注入记忆，类似世界书蓝灯。</p>
                <p><b>主要触发</b><br>命中主关键词后参与召回，类似世界书绿灯。</p>
                <p><b>次级触发</b><br>命中主关键词后参与召回，类似世界书绿灯，但优先级低于主要触发。</p>
                <p><b>示例</b><br>本次命中 3 条常驻、5 条主要触发和 3 条次级触发。如果设置为“最多召回 5 条”，最终会注入 3 条常驻（不占名额）、4 条主要触发（优先）和 1 条次级触发（保留一个位置），共 8 条记忆。</p>
              </section>
              <section class="memoryhelpsection">
                <h5><span class="memoryhelpnum">3</span><span>合并选中记忆</span></h5>
                <p><b>概念解释</b><br>把选中的多条相关记忆合并成一条新记忆。合并前可以选择“汇总原关键词”或“重新生成关键词”。</p>
                <p><b>合并时参考原文</b><br>把选中的记忆及其对应楼层原文一起发送给 AI，避免合并时遗漏原文细节。</p>
              </section>
            </div>
          </details>
          <div class="sts">
            <button class="st on" type="button" data-mf="all"><b id="mp_n1">0</b><small>全部</small></button>
            <button class="st" type="button" data-mf="high"><b id="mp_n2">0</b><small>常驻</small></button>
            <button class="st" type="button" data-mf="medium"><b id="mp_nmed">0</b><small>主要触发</small></button>
            <button class="st" type="button" data-mf="low"><b id="mp_n4">0</b><small>次级触发</small></button>
          </div>
          <details class="memoryfilter">
            <summary>记忆筛选与批量操作：<span id="mp_filter_label">全部记忆</span> · <span id="mp_filter_selected">已选 0 条</span></summary>
            <div class="memoryfilterbody">
              <div class="filtersearch"><input id="mp_f_search" placeholder="搜索事件名/摘要…"><button class="btn" id="mp_multi_toggle" type="button" aria-pressed="false">多选</button><button class="btn" id="mp_sel_none" type="button">清空选择</button></div>
              <div class="filterchoices">
                <button class="btn" type="button" id="mp_select_all">选择全部记忆 <span class="badge" id="mp_nallpick">0</span></button>
                <button class="btn" type="button" id="mp_select_xball">选择全部小白X总结 <span class="badge" id="mp_n3">0</span></button>
                <button class="btn" type="button" id="mp_select_xbnr">选择未重构小白X总结 <span class="badge" id="mp_nxbnr">0</span></button>
                <button class="btn" type="button" id="mp_select_animaall">选择全部Anima总结 <span class="badge" id="mp_nanima">0</span></button>
                <button class="btn" type="button" id="mp_select_animanr">选择未重构Anima总结 <span class="badge" id="mp_nanimanr">0</span></button>
                <button class="btn" type="button" id="mp_select_horaeall">选择全部Horae记忆 <span class="badge" id="mp_nhorae">0</span></button>
                <button class="btn" type="button" id="mp_select_horaenr">选择未重构Horae记忆 <span class="badge" id="mp_nhoraenr">0</span></button>
              </div>
              <div class="batchactions" id="mp_batch_actions">
                <button class="btn bp1" id="mp_rebuild_sel">批量重构关键词</button>
                <button class="btn bp1" id="mp_merge_open">合并选中记忆</button>
                <button class="btn bd1" id="mp_del_sel">删除选中记忆</button>
              </div>
            </div>
          </details>
          <div class="undo" id="mp_undo_bar"></div>
          <div class="mergesetup" id="mp_merge_setup">
            <div class="mergesetuptitle">合并设置</div>
            <div class="mergebar">
              <input type="hidden" id="mp_merge_kw_mode" value="default">
              <span class="ht">合并记忆时，关键词如何处理？</span>
              <div class="kwmode" role="radiogroup" aria-label="合并记忆时的关键词处理方式">
                <button type="button" class="kwmodebtn on" data-merge-kw-mode="default" aria-pressed="true">汇总原关键词</button>
                <button type="button" class="kwmodebtn" data-merge-kw-mode="ai" aria-pressed="false">AI 重新生成关键词</button>
              </div>
              <label class="mp-check"><input type="checkbox" id="mp_merge_ctx" checked>合并时参考原文</label>
            </div>
            <div class="mergeactions"><button class="btn bd1" id="mp_merge_setup_cancel">取消</button><button class="btn bp1" id="mp_merge_run">开始合并</button></div>
          </div>
          <div class="opline" id="mp_merge_status"></div>
          <div class="opline" id="mp_kw_status"></div>
          <details class="det advancedprompts">
            <summary>自定义 Prompt</summary>
            <div class="promptcard">
              <div class="prompttitle">合并记忆 Prompt</div>
              <textarea class="prompteditor" id="mp_mpr">${h(loadMergePrompt())}</textarea>
              <div class="promptbuttons"><button class="btn" id="mp_mps">保存</button><button class="btn bd1" id="mp_mpd">恢复默认</button></div>
              <div class="promptnote">用于合并选中的记忆。{{memories}} 和 {{context}} 是占位符：执行时，插件会将 {{memories}} 替换为选中的记忆信息；开启“合并时参考原文”后，会将 {{context}} 替换为对应楼层原文。</div>
            </div>
            <div class="promptcard">
              <div class="prompttitle">重构关键词 Prompt</div>
              <textarea class="prompteditor" id="mp_kpr">${h(loadKwPrompt())}</textarea>
              <div class="promptbuttons"><button class="btn" id="mp_kps">保存</button><button class="btn bd1" id="mp_kpd">恢复默认</button></div>
              <div class="promptnote">用于单条或批量重构小白X总结、Anima总结和Horae记忆的关键词，以及合并记忆时选择“AI 重新生成关键词”。{{event}}、{{summary}}、{{entities}}、{{timeLabel}} 和 {{floorRange}} 均为占位符，执行时会自动替换为当前记忆的信息。选择“汇总原关键词”时不会使用这段 Prompt。</div>
            </div>
          </details>
          <div id="mp_list"></div>
        </div>
        <div class="pg" id="mp_pg_add">
          <div class="fg"><label>事件名</label><input id="mp_fe"></div>
          <div class="fg"><label>主关键词（逗号分隔，参与召回）</label><input id="mp_fpk" placeholder="事件名,地点,物品,核心动作"></div>
          <div class="fg"><label>辅助关键词（逗号分隔，辅助判断语境）</label><input id="mp_fsk" placeholder="动作,场景,结果,补充语境词"></div>
          <div class="fg"><label>人物关键词（逗号分隔，仅展示不召回）</label><input id="mp_fek" placeholder="人物名"></div>
          <div class="fg"><label>时间标签</label><input id="mp_ft" placeholder="例如：UC0087/07/10 10:57 / 当晚 / 第120-138层"></div>
          <div class="fg"><label>时间值（分钟，可空）</label><input id="mp_ftv" placeholder="例如 657"></div>
          <div class="fg"><label>楼层范围（例如 120-138，可空）</label><input id="mp_ffr" placeholder="120-138"></div>
          <div class="fg"><label>自定义 α（可空，0~0.95）</label><input id="mp_fa" type="number" min="0" max="0.95" step="0.01" placeholder="为空则使用全局默认 0.72"></div>
          <div class="fg"><label>摘要</label><textarea id="mp_fs"></textarea></div>
          <div class="fg"><label>召回类型</label><select id="mp_fp"><option value="high">常驻（不需要命中关键词）</option><option value="medium" selected>主要触发（命中后优先参与）</option><option value="low">次级触发（命中后低优先参与）</option></select></div>
          <div class="ht" style="margin-bottom:10px">人物关键词仅用于显示，不参与记忆召回。时间值是从当天 00:00 起累计的故事内分钟数，计算方式为“小时 × 60＋分钟”。例如 21:25＝21 × 60＋25＝1285。时间值当前不参与记忆召回，不确定时可以留空。</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn" id="mp_fundo" style="flex:1;padding:9px;font-size:13px">撤回修改</button><button class="btn bd1" id="mp_fcancel" style="flex:1;padding:9px;font-size:13px">取消</button><button class="btn bp1" id="mp_sv" style="flex:1;padding:9px;font-size:13px">保存</button></div>
        </div>
        <div class="pg" id="mp_pg_xb">
          <div id="mp_xst"></div>
          <div class="fr">
            <input id="mp_xs" placeholder="搜索...">
            <select id="mp_xty" aria-label="小白X类型"><option value="">小白X类型</option><option>相遇</option><option>冲突</option><option>揭示</option><option>抉择</option><option>羁绊</option><option>转变</option><option>收束</option><option>日常</option></select>
            <select id="mp_xwt" aria-label="小白X权重"><option value="">小白X权重</option><option>核心</option><option>主线</option><option>转折</option><option>点睛</option><option>氛围</option></select>
            <select id="mp_xmp" aria-label="MemoryPilot 状态"><option value="">MemoryPilot 状态</option><option value="unimported">未导入</option><option value="high">常驻</option><option value="medium">主要触发</option><option value="low">次级触发</option></select>
          </div>
          <div id="mp_xl"></div>
        </div>
        <div class="pg" id="mp_pg_anima">
          <div class="sourcestatus" id="mp_ast"></div>
          <div class="fr">
            <input id="mp_as" placeholder="搜索总结/标签…">
            <select id="mp_amp" aria-label="MemoryPilot 状态"><option value="">全部状态</option><option value="unimported">未导入</option><option value="high">常驻</option><option value="medium">主要触发</option><option value="low">次级触发</option></select>
          </div>
          <div class="sourceactions"><button class="btn bp1" id="mp_anima_import_all">导入全部未导入总结</button><button class="btn" id="mp_anima_refresh">重新读取</button></div>
          <div id="mp_al"></div>
        </div>
        <div class="pg" id="mp_pg_horae">
          <div class="sourcestatus" id="mp_hst"></div>
          <div class="fr">
            <input id="mp_hs" placeholder="搜索记忆/地点/人物…">
            <select id="mp_hkind" aria-label="Horae事件状态"><option value="">全部原始事件</option><option value="active">尚未压缩</option><option value="compressed">已被Horae压缩</option></select>
            <select id="mp_hmp" aria-label="MemoryPilot 状态"><option value="">全部状态</option><option value="unimported">未导入</option><option value="high">常驻</option><option value="medium">主要触发</option><option value="low">次级触发</option></select>
          </div>
          <div class="sourceactions"><button class="btn bp1" id="mp_horae_import_all">导入全部未导入事件</button><button class="btn" id="mp_horae_refresh">重新读取</button></div>
          <div class="ht" style="margin:0 0 10px">这里只读取 Horae 的原始时间线事件，包括已被压缩隐藏的事件；不会导入压缩摘要，也不会因 Horae 后续压缩而更新或移除 MP 中已有的记忆。旧版已经同步的压缩摘要会继续保留，其楼层不会重复导入。</div>
          <div id="mp_hl"></div>
        </div>
        <div class="pg" id="mp_pg_batch">
          <section class="autosummary">
            <div class="autosummaryhead"><div class="autosummarytitle">自动楼层总结</div><label class="mp-check"><input type="checkbox" id="mp_auto_enabled">启用</label></div>
            <div class="ht">AI 每次回复完成后检查一次；达到设定楼层数时，只按顺序总结下一段，不会连续追赶多段。</div>
            <div class="autosummarygrid">
              <div class="fg"><label>自动总结间隔（楼层）</label><input id="mp_auto_interval" type="number" min="2" max="200" value="20"></div>
              <div class="fg"><label>开始总结楼层</label><input id="mp_auto_start" type="number" min="1" value="1"></div>
              <div class="fg"><label>总结后的记忆如何导入</label><select id="mp_auto_priority_mode"><option value="fixed">按指定类型导入</option><option value="ai">按 AI 建议导入</option></select></div>
              <div class="fg" id="mp_auto_fixed_wrap"><label>指定导入类型</label><select id="mp_auto_fixed"><option value="high">常驻</option><option value="medium">主要触发</option><option value="low">次级触发</option></select></div>
            </div>
            <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:2px"><label class="mp-check"><input type="checkbox" id="mp_auto_hide">总结成功后隐藏旧楼层</label></div>
            <div class="fg" id="mp_auto_keep_wrap" style="margin-top:9px"><label>始终保留最后 N 楼不隐藏</label><input id="mp_auto_keep" type="number" min="0" max="200" value="6"></div>
            <div class="ht">“隐藏”只会把已成功自动总结的旧楼层排除在 AI 上下文之外，不删除聊天原文。关闭后会恢复由 MemoryPilot 隐藏的楼层。</div>
            <div class="autosummarystatus" id="mp_auto_status"></div>
            <div class="autosummaryactions"><button class="btn bp1" id="mp_auto_save">保存自动总结设置</button><button class="btn" id="mp_auto_retry" style="display:none">重试失败区间</button></div>
          </section>
          <div class="automanualtitle">手动楼层总结</div>
          <div class="fg">
            <label>选择楼层 <span class="ht">(共${chat.length}层)</span></label>
            <input id="mp_bf" placeholder="最近20 或 5-30, 45-60" value="最近20">
            <div class="ht" style="margin-top:5px">支持三种写法：最近20、10-30、5；可组合使用，用逗号分隔。</div>
          </div>
          <div class="fg">
            <label>按关键词查找楼层（可选，空格分隔多词）</label>
            <div style="display:flex;gap:5px">
              <input id="mp_bk" placeholder="如: 击剑 银星" style="flex:1">
              <button class="btn" id="mp_bkb">搜索</button>
              <button class="btn" id="mp_bkc">清空</button>
            </div>
          </div>
          <div id="mp_search_view">
            <div class="searchtools">
              <div class="opline" id="mp_bk_status">搜索后可勾选需要总结的楼层</div>
              <div class="searchactions"><button class="btn bp1" id="mp_bk_apply">使用已选楼层</button><button class="btn" id="mp_bk_pick_all">全选结果</button><button class="btn bd1" id="mp_bk_pick_none">清空选择</button></div>
            </div>
            <div id="mp_bkr"></div>
          </div><div id="mp_context_view" style="display:none"><div id="mp_bctx" class="ctxbox" style="max-height:56dvh;min-height:260px;overflow:auto;overscroll-behavior:contain;resize:vertical"><div class="tiny">点击搜索结果中的“查看前后楼层”，可以查看并选择该楼层前后的聊天内容。</div></div>
</div>
          <details class="det">
            <summary>总结 Prompt（可编辑）</summary>
            <textarea id="mp_bpr" style="width:100%;min-height:120px;margin-top:6px">${h(loadPrompt())}</textarea>
            <div style="display:flex;gap:5px;margin-top:5px">
              <button class="btn" id="mp_bps">保存</button>
              <button class="btn bd1" id="mp_bpd">恢复默认</button>
            </div>
          </details>
          <button class="btn bp1" id="mp_brun" style="width:100%;padding:9px;font-size:13px;margin-top:9px">开始总结</button>
          <div id="mp_br" style="margin-top:9px"></div>
        </div>
        <div class="pg" id="mp_pg_cfg">
          <nav class="cfgsubnav" aria-label="设置分类">
            <button class="cfgsubtab" data-cfg-action="api">API 配置</button>
            <button class="cfgsubtab on" data-cfg-target="recall">召回设置</button>
            <button class="cfgsubtab" data-cfg-target="filter">文本过滤</button>
            <button class="cfgsubtab" data-cfg-target="data">数据管理</button>
          </nav>
          <section class="cfgsection on" data-cfg-section="recall">
          <div class="cfgcard">
          <div class="cfgtitle">召回设置</div>
          <div class="fg"><label>召回周期（回合）</label><input id="mp_revery" type="number" min="1" max="50" value="${h(String(loadRecallCfg().every))}"></div>
          <div class="fg" style="margin-top:12px"><label>距离衰减系数 α（0~0.95）</label><input id="mp_ralpha" type="number" min="0" max="0.95" step="0.01" value="${h(String(loadRecallCfg().alpha))}"></div>
          <div class="fg" style="margin-top:12px"><label>最大触发召回数（不含常驻）</label><input id="mp_rmaxn" type="number" min="1" max="20" value="${h(String(loadRecallCfg().maxRecall||6))}"></div>
          <div class="fg" style="margin-top:12px"><label>上下文窗口（匹配最近 N 条）</label><input id="mp_rctxwin" type="number" min="3" max="30" value="${h(String(loadRecallCfg().contextWindow||8))}"></div>
          <div class="fg" style="margin-top:12px"><label>粘性保持（命中后维持 N 轮）</label><input id="mp_rsticky" type="number" min="0" max="20" value="${h(String(loadRecallCfg().stickyTurns??5))}"></div>
          <div class="fg" style="margin-top:14px">
            <label class="mp-check"><input type="checkbox" id="mp_anima_dedupe" ${loadRecallCfg().animaDedupe ? 'checked' : ''}>与 Anima 召回结果去重</label>
            <div class="ht" style="margin-top:7px">同一条 Anima 总结已由 Anima 本轮召回时，MemoryPilot 不再重复注入；其他来源的记忆不受影响。</div>
            <label class="mp-check" style="margin-top:10px"><input type="checkbox" id="mp_xiaobaix_dedupe" ${loadRecallCfg().xiaobaixDedupe ? 'checked' : ''}>与小白 X 召回结果去重</label>
            <div class="ht" style="margin-top:7px">仅移除本轮已由小白 X 注入的 xb_event；手动记忆、Anima、Horae、楼层总结不受影响。小白 X 读取失败时自动回退原召回。</div>
          </div>
          <div class="ht" style="margin-bottom:10px">正式召回按每 N 回合执行；插件在最近 N 条聊天中匹配已有记忆关键词，不调用 AI。常驻记忆不占最大触发召回数；主要触发和次级触发需命中主关键词，辅助关键词用于提高语境匹配度，未命中时会降低排序但不会直接淘汰。若同时命中多条，插件会根据关键词匹配程度、楼层距离和召回类型进行排序。</div>
          <button class="btn bp1" id="mp_rssv" style="width:100%;padding:9px;font-size:13px;margin-bottom:14px">保存召回设置</button>
          </div>
          </section>
          <section class="cfgsection" data-cfg-section="filter">
          <div class="cfgcard">
          <div class="cfgtitle">关键词与文本过滤</div>
          <div class="fg"><label>关键词黑名单</label><textarea class="cleaneditor" id="mp_bl" style="min-height:100px">${h(loadBlacklist().join('\n'))}</textarea></div>
          <div class="ht" style="margin-bottom:10px">这些词不会参与召回匹配。使用逗号或换行分隔；加入黑名单不会影响人物关键词的显示。</div>
          <button class="btn bp1" id="mp_blsv" style="width:100%;padding:9px;font-size:13px">保存关键词黑名单</button>
          <div class="cfgtitle" style="margin-top:18px">文本清洗</div>
          <div class="ht" style="margin-bottom:12px">插件在匹配记忆关键词或总结楼层前，会按照下方规则删除不需要参与处理的内容。文本清洗只影响插件读取到的文本，不会修改聊天原文。</div>
          <div class="fg"><label>删除指定标签及其内容</label><div class="ht" style="margin:4px 0 7px">删除指定标签及标签内部的全部内容。每行填写一个标签名称，例如 think、details、meta。</div><textarea class="cleaneditor" id="mp_ctags" style="min-height:90px">${h(loadCleaner().blockTags.join('\n'))}</textarea></div>
          <div class="fg"><label>删除指定开头的整行</label><div class="ht" style="margin:4px 0 7px">如果一行文字以这里填写的内容开头，就删除整行。每行填写一种开头，例如 affinity_change:。</div><textarea class="cleaneditor" id="mp_cprefix" style="min-height:80px">${h(loadCleaner().linePrefixes.join('\n'))}</textarea></div>
          <div class="fg"><label>用正则删除内容（高级）</label><div class="ht" style="margin:4px 0 7px">每行填写一条正则表达式，不需要添加两侧的 /，也不需要填写 g。例如删除 HTML 注释可填写 &lt;!--[\s\S]*?--&gt;。</div><textarea class="cleaneditor" id="mp_cregex" style="min-height:80px">${h(loadCleaner().regexRules.join('\n'))}</textarea></div>
          <div class="fg">
            <label>作用范围</label>
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:6px">
              <label class="mp-check"><input type="checkbox" id="mp_c_recall" ${loadCleaner().cleanForRecall ? 'checked' : ''}>召回匹配前清洗</label>
              <label class="mp-check"><input type="checkbox" id="mp_c_batch" ${loadCleaner().cleanForBatch ? 'checked' : ''}>楼层总结前清洗</label>
            </div>
          </div>
          <button class="btn bp1" id="mp_clsv" style="width:100%;padding:9px;font-size:13px">保存文本清洗规则</button>
          </div>
          </section>
          <section class="cfgsection" data-cfg-section="data">
          <div class="cfgcard">
          <div class="cfgtitle">旧版数据清理</div>
          <div>
            <div class="fg"><label style="font-size:13px;color:#fff;font-weight:600">旧版数据检测与清理</label></div>
            <div class="ht" style="margin-bottom:9px">这里只用于处理旧版 MemoryPilot 留在聊天文件里的重复数据，不是日常维护功能。</div>
            <div class="cleanupresult" id="mp_cleanup_summary">正在检测当前聊天中的旧版 MP / 小白X（LWB）快照残留…</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn" id="mp_cleanup_refresh" style="flex:1;padding:9px;font-size:13px">重新检测</button>
              <button class="btn" id="mp_cleanup_mp" style="flex:1;padding:9px;font-size:13px">清理旧版聊天残留</button>
              <button class="btn bd1" id="mp_cleanup_lwb" style="flex:1;padding:9px;font-size:13px">清理小白X快照里的旧 MP 副本</button>
            </div>
            <div class="ht" style="margin-top:9px;line-height:1.65">只有检测到对应的旧版残留时，清理按钮才会启用。清理不会删除记忆列表或小白X总结；执行前仍建议先在下方导出一次 MP 数据。</div>
            <div class="ht" id="mp_cleanup_status" style="margin-top:6px"></div>
          </div>
          </div>
          <div class="cfgcard">
          <div class="cfgtitle">导入与导出</div>
          <div>
            <div class="fg"><label style="font-size:13px;color:#fff;font-weight:600">记忆数据 导出 / 导入</label></div>
            <div class="ht" style="margin-bottom:10px">导出包含：全部记忆、召回设置、自动总结设置、关键词黑名单、文本清洗规则、API 配置、Prompt 模板。自动总结的当前进度不会迁移。</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn bp1" id="mp_export" style="flex:1;padding:9px;font-size:13px">导出 MP 数据</button>
              <button class="btn" id="mp_import" style="flex:1;padding:9px;font-size:13px">导入 MP 数据</button>
              <input type="file" id="mp_import_file" accept=".json" style="display:none">
            </div>
            <div class="ht" id="mp_io_status" style="margin-top:6px"></div>
          </div>
          </div>
          </section>
        </div>
      </div>
      <div class="floatnav">
        <button class="btn" id="mp_float_top" title="回到顶部">↑</button>
        <button class="btn" id="mp_float_bottom" title="到底部">↓</button>
      </div>
      <div class="guide" id="mp_guide">
        <div class="mask" id="mp_guide_mask"></div>
        <div class="guidebox">
          <h4>Memory Pilot 新手指引</h4>
          <div class="guideintro">第一次使用时，请按顺序完成下面的设置。</div>
          <div class="guidesteps">
            <section class="guidestep">
              <div class="guidestephead"><b>1. 在当前聊天使用的预设中新建记忆注入条目</b><span class="guidetag">必做</span></div>
              <p>该条目用于让 AI 读取 MemoryPilot 召回的记忆。更换预设后，记得在新预设中也新建这个条目。</p>
              <details class="guideinject">
                <summary>查看新建方法</summary>
                <p>在当前预设中新建一个条目。条目在预设列表中的排列位置随意，内容设置如下：</p>
                <ul><li>身份：系统</li><li>位置：聊天中</li><li>深度：4</li><li>顺序：100</li><li>深度与顺序可以根据自己的预设调整。</li></ul>
                <textarea class="guideprompt" id="mp_inject_prompt" readonly>${h(RECALL_INJECT_PROMPT)}</textarea>
                <button class="btn bp1" id="mp_copy_inject" type="button" style="margin-top:7px">复制 Prompt</button>
              </details>
            </section>
            <section class="guidestep">
              <div class="guidestephead"><b>2. 配置总结 API</b></div>
              <p>小白X、Anima、Horae 关键词重构、楼层总结和合并记忆会使用这里配置的 API。完全手动填写记忆和关键词时可以跳过。</p>
              <button class="btn stepgo" data-guide-action="api">前往 API 设置</button>
            </section>
            <section class="guidestep">
              <div class="guidestephead"><b>3. 创建第一批记忆（五选一）</b></div>
              <div class="guidebranches">
                <div class="guidebranch"><b>小白X总结</b><br>点击一种导入方式，将小白X总结加入记忆列表。三种导入方式的区别，可以在“记忆列表使用说明”的“召回类型”中查看。导入后回到记忆列表，选择“未重构小白X总结”，执行“批量重构关键词”。<br><button class="btn stepgo" data-guide-tab="xb">前往小白X总结</button></div>
                <div class="guidebranch"><b>Anima总结</b><br>从当前聊天绑定的世界书读取 Anima 总结并加入记忆列表。导入后回到记忆列表，选择“未重构Anima总结”，执行“批量重构关键词”。<br><button class="btn stepgo" data-guide-tab="anima">前往 Anima总结</button></div>
                <div class="guidebranch"><b>Horae记忆</b><br>读取 Horae 的原始时间线事件，并只导入尚未加入记忆列表的部分。Horae 后续压缩不会改动已导入记忆。导入后回到记忆列表，选择“未重构Horae记忆”，执行“批量重构关键词”。<br><button class="btn stepgo" data-guide-tab="horae">前往 Horae记忆</button></div>
                <div class="guidebranch"><b>楼层总结</b><br>可以手动选择聊天楼层生成候选记忆，也可以在页面中开启按楼层间隔自动总结。<br><button class="btn stepgo" data-guide-tab="batch">前往楼层总结</button></div>
                <div class="guidebranch"><b>手动新建（不建议新手使用）</b><br>需要自行填写事件名、摘要、主关键词和召回类型。<br><button class="btn stepgo" data-guide-tab="add">手动新建记忆</button></div>
              </div>
            </section>
            <section class="guidestep">
              <div class="guidestephead"><b>4. 确认记忆已经可以使用</b></div>
              <p>前往记忆列表，确认至少存在一条记忆，并且已经设置召回类型和主关键词；外部插件导入的记忆不再显示“未重构”。</p>
              <button class="btn stepgo" data-guide-tab="list">检查记忆列表</button>
            </section>
            <div class="guidenote"><b>暂时没有记忆内容也很正常。</b><br>如果刚开始一段新聊天，没有小白X总结可以导入、也没有足够的楼层可以总结，先继续聊天，积累一些内容后再回来使用即可。</div>
          </div>
          <div class="gbar">
            <button class="btn bp1" id="mp_guide_ok">关闭</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  root.querySelector('[data-hub="monitor"]')?.addEventListener('click', () => window.MemoryPilot?.openMonitor?.());
  root.querySelector('[data-hub="settings"]')?.addEventListener('click', () => window.MemoryPilot?.openApiConfig?.());
  const activateCfgSection = (section) => {
    const next = ['recall', 'filter', 'data'].includes(section) ? section : 'recall';
    root.querySelectorAll('[data-cfg-target]').forEach(btn => btn.classList.toggle('on', btn.getAttribute('data-cfg-target') === next));
    root.querySelectorAll('[data-cfg-section]').forEach(el => el.classList.toggle('on', el.getAttribute('data-cfg-section') === next));
    root.querySelector('.bd')?.scrollTo({ top: 0, behavior: 'smooth' });
  };
  root.querySelectorAll('[data-cfg-target]').forEach(btn => btn.addEventListener('click', () => activateCfgSection(btn.getAttribute('data-cfg-target'))));
  root.querySelector('[data-cfg-action="api"]')?.addEventListener('click', () => window.MemoryPilot?.openApiConfig?.());
  activateCfgSection(initialCfg);

  let selectedIds = new Set();
  let searchPicked = new Set();
  let lastSearchResults = [];
  let kwAbort = null;
  let kwRunning = false;
  let kwRunningId = null;
  let lastDeleted = null;
  let searchCursor = -1;
  let multiSelectMode = false;

  let _listFilter = 'all';
  let _listSearch = '';
  const updateSelectionUI = (prefix = '') => {
    if ($('mp_filter_selected')) $('mp_filter_selected').textContent = `已选 ${selectedIds.size} 条`;
    if (!selectedIds.size) $('mp_merge_setup')?.classList.remove('on');
  };
  const setMultiSelectMode = (enabled) => {
    multiSelectMode = !!enabled;
    root.classList.toggle('multi-select-on', multiSelectMode);
    const btn = $('mp_multi_toggle');
    if (btn) {
      btn.textContent = multiSelectMode ? '退出多选' : '多选';
      btn.classList.toggle('bp1', multiSelectMode);
      btn.setAttribute('aria-pressed', multiSelectMode ? 'true' : 'false');
    }
  };
  const memoryId = memory => String(memory?.id ?? '');
  const selectMemoryBatch = (predicate, successMessage, emptyMessage) => {
    selectedIds = new Set(memories.filter(predicate).map(memoryId).filter(Boolean));
    if (selectedIds.size) setMultiSelectMode(true);
    renderList();
    updateSelectionUI();
    if (selectedIds.size) toastr?.success?.(successMessage(selectedIds.size));
    else toastr?.warning?.(emptyMessage);
  };
  const getVisibleMemories = () => {
    let filtered = memories;
    if (_listFilter === 'high') filtered = memories.filter(m => m.priority === 'high');
    else if (_listFilter === 'medium') filtered = memories.filter(m => m.priority === 'medium' || (!m.priority));
    else if (_listFilter === 'low') filtered = memories.filter(m => m.priority === 'low');
    if (_listSearch) {
      const q = _listSearch.toLowerCase();
      filtered = filtered.filter(m =>
        (m.event || '').toLowerCase().includes(q) ||
        (m.summary || '').toLowerCase().includes(q) ||
        (m.primaryKeywords || m.keywords || []).join(' ').toLowerCase().includes(q) ||
        (m.secondaryKeywords || []).join(' ').toLowerCase().includes(q) ||
        (m.entityKeywords || []).join(' ').toLowerCase().includes(q)
      );
    }
    return filtered;
  };
  const scrollToListItem = (id) => {
    const safeId = globalThis.CSS?.escape ? globalThis.CSS.escape(String(id)) : String(id).replace(/"/g, '\\"');
    const el = root.querySelector(`.mi[data-mid="${safeId}"]`);
    if (!el) return;
    root.querySelectorAll('.mi.hit').forEach(x => x.classList.remove('hit'));
    el.classList.add('hit');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const jumpSearch = (dir) => {
    const items = getVisibleMemories();
    if (!_listSearch || !items.length) { toastr?.warning?.('没有可跳转的搜索结果'); return; }
    searchCursor = (searchCursor + dir + items.length) % items.length;
    scrollToListItem(items[searchCursor]?.id);
    updateSelectionUI(`搜索结果 ${searchCursor + 1}/${items.length}`);
  };
  const makeDeleteSnapshot = (predicate) => memories
    .map((memory, index) => ({ memory, index }))
    .filter(entry => predicate(entry.memory));
  const showDeleteUndo = (entries) => {
    if (!entries?.length) return;
    lastDeleted = { entries, ts: Date.now() };
    const bar = $('mp_undo_bar');
    if (!bar) return;
    bar.style.display = 'block';
    bar.innerHTML = `已删除 ${entries.length} 条记忆 <button class="btn bp1" id="mp_undo_delete" style="margin-left:8px">撤回</button>`;
    $('mp_undo_delete').onclick = async () => {
      if (!lastDeleted?.entries?.length) return;
      let restored = [...memories];
      const entries = [...lastDeleted.entries].sort((a, b) => a.index - b.index);
      for (const { memory, index } of entries) {
        restored = restored.filter(m => m.id !== memory.id);
        restored.splice(Math.max(0, Math.min(index, restored.length)), 0, memory);
      }
      memories = dedupeMemories(restored);
      await saveMem(memories);
      lastDeleted = null;
      bar.style.display = 'none';
      renderList();
      renderXb();
      renderAnima();
      renderHorae();
      toastr?.success?.('已撤回删除');
    };
  };
  const activateTab = (tab) => {
    const settingsMode = tab === 'cfg';
    const tabs = root.querySelector('.tabs');
    if (tabs) tabs.style.display = settingsMode ? 'none' : 'flex';
    root.querySelector('[data-hub="memory"]')?.classList.toggle('on', !settingsMode);
    root.querySelector('[data-hub="settings"]')?.classList.toggle('on', settingsMode);
    root.querySelector('[data-hub="monitor"]')?.classList.remove('on');
    root.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));
    root.querySelectorAll('.pg').forEach(x=>x.classList.remove('on'));
    root.querySelector(`.tab[data-t="${tab}"]`)?.classList.add('on');
    $('mp_pg_'+tab)?.classList.add('on');
    if(tab==='add'&&!editId){$('mp_fe').value='';$('mp_fpk').value='';$('mp_fsk').value='';$('mp_fek').value='';$('mp_ft').value='';$('mp_ftv').value='';$('mp_ffr').value='';$('mp_fs').value='';$('mp_fp').value='medium';}
  };
  const renderList=()=>{
    memories = dedupeMemories(loadMem());
    $('mp_n1').textContent=memories.length;
    $('mp_nallpick').textContent=memories.length;
    $('mp_n2').textContent=memories.filter(m=>m.priority==='high').length;
    $('mp_nmed').textContent=memories.filter(m=>m.priority==='medium'||!m.priority).length;
    $('mp_n4').textContent=memories.filter(m=>m.priority==='low').length;
    $('mp_n3').textContent=memories.filter(m=>m.source==='xb_event').length;
    $('mp_nxbnr').textContent=memories.filter(m=>m.source==='xb_event'&&m.keywordSource!=='xb_llm').length;
    $('mp_nanima').textContent=memories.filter(m=>m.source==='anima_summary').length;
    $('mp_nanimanr').textContent=memories.filter(m=>m.source==='anima_summary'&&m.keywordSource!=='anima_llm').length;
    $('mp_nhorae').textContent=memories.filter(m=>m.source==='horae_memory').length;
    $('mp_nhoraenr').textContent=memories.filter(m=>m.source==='horae_memory'&&m.keywordSource!=='horae_llm').length;
    updateSelectionUI();
    const c=$('mp_list');
    if(!memories.length){c.innerHTML='<div class="emp">暂无记忆</div>';return;}
    let filtered = getVisibleMemories();
    if (searchCursor >= filtered.length) searchCursor = filtered.length ? filtered.length - 1 : -1;
    if(!filtered.length){c.innerHTML='<div class="emp">无匹配记忆（共 '+memories.length+' 条）</div>';return;}
    c.innerHTML=filtered.map(m=>{
      const priority=m.priority||'medium';
      const pin=priority==='high'?'[常驻] ':'';
      const src=m.source==='xb_event'?'<span class="kw kx">小白X总结</span>':(m.source==='anima_summary'?'<span class="kw kx">Anima总结</span>':(m.source==='horae_memory'?'<span class="kw kx">Horae记忆</span>':((m.source==='batch'||m.source==='auto_batch')?'<span class="kw kx">楼层总结</span>':(m.source==='merged'?'<span class="kw kx">合并</span>':''))));
      const pc=priority==='high'?'bph':priority==='medium'?'bpm':'bpl';
      const pl=priority==='high'?'常驻':priority==='medium'?'主要触发':'次级触发';
      const floorText = formatFloorSegments(m);
      const time = (m.timeLabel || floorText) ? `<div class="ht">${h(m.timeLabel || '')}${floorText ? ' | ' + floorText : ''}</div>` : '';
      const pkw = (m.primaryKeywords || m.keywords || []).map(k=>'<span class="kw">'+h(k)+'</span>').join('');
      const skw = (m.secondaryKeywords || []).map(k=>'<span class="kw kx">'+h(k)+'</span>').join('');
      const ent = (m.entityKeywords||[]).map(k=>'<span class="kw ke">'+h(k)+'</span>').join('');
      const canRebuild = isRebuildableMemory(m);
      const pick = `<label class="ht mp-pick-wrap" title="选择此记忆"><input type="checkbox" class="mp_pick" aria-label="选择此记忆" data-id="${h(m.id)}" ${selectedIds.has(memoryId(m))?'checked':''}></label>`;
      const rebuildBtn = canRebuild ? `<button class="btn bp1" onclick="window._mpKR('${m.id}')">${kwRunning && kwRunningId===m.id ? '中止重构' : '优化关键词'}</button>` : '';
      return `<div class="mi" data-mid="${h(m.id)}"><div class="mh"><span class="me jump" title="跳转到完整列表中的位置" onclick="window._mpJump('${m.id}')">${pin}${h(m.event)}</span><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${pick}<span class="bp ${pc}">${pl}</span></div></div>${time}<div class="ms">${h(m.summary)}</div><div class="kr">${src}${pkw}${skw}${ent}</div><div class="ma">${rebuildBtn}<button class="btn" onclick="window._mpE('${m.id}')">编辑</button><button class="btn bd1" onclick="window._mpD('${m.id}')">删除</button></div></div>`;
    }).join('');
    updateSelectionUI();
    c.querySelectorAll('.mp_pick').forEach(el=>{
      el.onchange = () => {
        const id = el.getAttribute('data-id');
        if (!id) return;
        if (el.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        updateSelectionUI();
      };
    });
  };

  const renderXb=()=>{
    const st=$('mp_xst');
    if(!xbEvents.length){
      let w='未知';try{const cm=ctx.chatMetadata;if(!cm)w='聊天元数据为空';else if(!cm.extensions)w='扩展数据为空';else if(!cm.extensions.LittleWhiteBox)w='未检测到小白X数据';else w='小白X总结为空';}catch(e){w=e.message;}
      st.innerHTML=`<div class="ht" style="color:#fbbf24">${w}</div>`;
      $('mp_xl').innerHTML='<div class="emp">请先使用小白X生成事件总结</div>';return;
    }
    st.innerHTML=`<div class="ht" style="color:#4ade80">${xbEvents.length} 个事件</div>`;
    const imported=new Map(memories.filter(m=>m.xbEventId).map(m=>[String(m.xbEventId),m]));
    const fl=($('mp_xs')?.value||'').toLowerCase(),tf=$('mp_xty')?.value||'',wf=$('mp_xwt')?.value||'',mf=$('mp_xmp')?.value||'';
    const filtered=xbEvents.filter(e=>{
      if(tf&&e.type!==tf)return false;
      if(wf&&e.weight!==wf)return false;
      const importedMemory=imported.get(String(e.id));
      if(mf==='unimported'&&importedMemory)return false;
      if((mf==='high'||mf==='medium'||mf==='low')&&(!importedMemory||(importedMemory.priority||'medium')!==mf))return false;
      if(fl&&![e.title,e.summary,...(e.participants||[])].join(' ').toLowerCase().includes(fl))return false;
      return true;
    });
    if(!filtered.length){$('mp_xl').innerHTML='<div class="emp">无匹配</div>';return;}
    $('mp_xl').innerHTML=filtered.map(e=>{
      const importedMemory=imported.get(String(e.id));
      const d=!!importedMemory;
      const currentPriority=importedMemory?.priority||'medium';
      const priorityButton=(value,label)=>`<button class="btn ${currentPriority===value?'bp1':''}" ${currentPriority===value?'disabled aria-current="true"':''} onclick="window._mpXI('${h(e.id)}','${value}')">${currentPriority===value?'当前：':''}${label}</button>`;
      const fr=deriveFloorRangeFromXB(e);
      const frLabel=Array.isArray(fr)?` | #${fr[0]}-${fr[1]}`:'';
      return `<div class="xi"><div class="mh"><span class="xt">${h(e.title)}</span><span class="ht">${h(e.type||'')} ${h(e.weight||'')}</span></div><div class="ht">${h(e.timeLabel||'')} | ${h(e.id)}${h(frLabel)}</div><div class="ms">${h(e.summary)}</div><div class="xp">${(e.participants||[]).map(p=>h(p)).join(', ')||'—'}</div><div class="ma">${d?`<span class="bp bpi">已导入</span>${priorityButton('high','常驻')}${priorityButton('medium','主要触发')}${priorityButton('low','次级触发')}<button class="btn bd1" onclick="window._mpD_xb('${h(e.id)}')">移除</button>`:`<button class="btn" onclick="window._mpXI('${h(e.id)}','high')">常驻导入</button><button class="btn bp1" onclick="window._mpXI('${h(e.id)}','medium')">主要触发导入</button><button class="btn" onclick="window._mpXI('${h(e.id)}','low')">次级触发导入</button>`}</div></div>`;
    }).join('');
  };

  const animaStatusText = () => {
    if (animaState?.status === 'no_chat') return '当前没有打开聊天，暂时无法读取 Anima 总结。';
    if (animaState?.status === 'helper_missing') return '未检测到 TavernHelper，暂时无法读取 Anima 世界书。';
    if (animaState?.status === 'no_worldbook') return '当前聊天没有绑定世界书，未找到 Anima 总结。';
    if (animaState?.status === 'error') return `读取 Anima 总结失败：${animaState?.error || '未知错误'}`;
    if (animaState?.status === 'empty') return `当前世界书${animaState?.worldbookName ? `「${animaState.worldbookName}」` : ''}中暂无 Anima 总结。`;
    return `当前世界书：${animaState?.worldbookName || '未知'} · 共 ${animaSummaries.length} 条 Anima 总结`;
  };

  const animaToMemory = (item, priority = 'medium') => ({
    id: gid(),
    event: item.event || `Anima总结 #${item.uniqueId || '?'}`,
    primaryKeywords: uniq(item.tags || []),
    secondaryKeywords: [],
    entityKeywords: [],
    summary: item.summary || '',
    timeLabel: '',
    timeValue: null,
    floorRange: Array.isArray(item.floorRange) ? item.floorRange : null,
    priority,
    source: 'anima_summary',
    animaSummaryId: item.animaSummaryId,
    animaUniqueId: item.uniqueId,
    animaWorldbook: animaState?.worldbookName || '',
    timestamp: item.timestamp || Date.now(),
    keywordSource: 'anima_auto'
  });

  const renderAnima = () => {
    const status = $('mp_ast');
    const list = $('mp_al');
    const tabCount = $('mp_anima_tab_count');
    if (!status || !list) return;
    if (tabCount) tabCount.textContent = String(animaSummaries.length);
    status.textContent = animaStatusText();

    const imported = new Map(memories.filter(m => m.animaSummaryId).map(m => [String(m.animaSummaryId), m]));
    const pending = animaSummaries.filter(item => !imported.has(String(item.animaSummaryId)));
    const importAll = $('mp_anima_import_all');
    if (importAll) {
      importAll.textContent = pending.length ? `导入全部未导入总结（${pending.length}）` : '已全部导入';
      importAll.disabled = !pending.length;
    }

    const query = ($('mp_as')?.value || '').trim().toLowerCase();
    const mode = $('mp_amp')?.value || '';
    const filtered = animaSummaries.filter(item => {
      const memory = imported.get(String(item.animaSummaryId));
      if (mode === 'unimported' && memory) return false;
      if ((mode === 'high' || mode === 'medium' || mode === 'low') && (!memory || (memory.priority || 'medium') !== mode)) return false;
      if (query && ![item.event, item.summary, ...(item.tags || [])].join(' ').toLowerCase().includes(query)) return false;
      return true;
    });

    if (!animaSummaries.length) {
      list.innerHTML = '<div class="emp">暂无可导入的 Anima 总结</div>';
      return;
    }
    if (!filtered.length) {
      list.innerHTML = '<div class="emp">无匹配总结</div>';
      return;
    }

    list.innerHTML = filtered.map(item => {
      const memory = imported.get(String(item.animaSummaryId));
      const itemIndex = animaSummaries.indexOf(item);
      const currentPriority = memory?.priority || 'medium';
      const range = Array.isArray(item.floorRange) ? `#${item.floorRange[0]}-${item.floorRange[1]}` : '楼层未知';
      const priorityButton = (value, label) => `<button class="btn ${memory && currentPriority === value ? 'bp1' : (!memory && value === 'medium' ? 'bp1' : '')}" ${memory && currentPriority === value ? 'disabled aria-current="true"' : ''} onclick="window._mpAI(${itemIndex},'${value}')">${memory && currentPriority === value ? '当前：' : ''}${label}${memory ? '' : '导入'}</button>`;
      const tags = (item.tags || []).map(tag => `<span class="kw">${h(tag)}</span>`).join('');
      return `<div class="xi"><div class="mh"><span class="xt">${h(item.event)}</span><span class="ht">Anima #${h(item.uniqueId)}</span></div><div class="ht">${h(range)}</div><div class="ms">${h(item.summary)}</div><div class="kr">${tags}</div><div class="ma">${memory ? '<span class="bp bpi">已导入</span>' : ''}${priorityButton('high','常驻')}${priorityButton('medium','主要触发')}${priorityButton('low','次级触发')}${memory ? `<button class="btn bd1" onclick="window._mpD_anima(${itemIndex})">移除</button>` : ''}</div></div>`;
    }).join('');
  };

  const refreshAnima = async () => {
    animaState = await loadCurrentAnimaSummaries({ context: ctx });
    animaSummaries = Array.isArray(animaState?.items) ? animaState.items : [];
    renderAnima();
  };

  const horaeStatusText = () => {
    const compressedCount = horaeMemories.filter(item => item.horaeCompressed).length;
    const legacySummaryCount = memories.filter(isLegacyHoraeSummaryMemory).length;
    if (horaeState?.status === 'no_chat') return '当前没有打开聊天，暂时无法读取 Horae 记忆。';
    if (horaeState?.status === 'horae_missing') return '未检测到 Horae 公开接口。请确认已安装并启用 Horae 1.15.1 或更高版本。';
    if (horaeState?.status === 'error') return `读取 Horae 记忆失败：${horaeState?.error || '未知错误'}`;
    if (horaeState?.status === 'empty' || horaeState?.status === 'empty_disabled') return `Horae${horaeState?.version ? ` ${horaeState.version}` : ''} 当前没有可读取的原始时间线事件。`;
    const disabled = horaeState?.enabled === false ? ' · Horae 当前关闭，但仍可读取已保存数据' : '';
    const legacy = legacySummaryCount ? ` · MP 保留 ${legacySummaryCount} 条旧版压缩摘要` : '';
    return `Horae${horaeState?.version ? ` ${horaeState.version}` : ''} · ${horaeMemories.length} 条原始事件 · 其中 ${compressedCount} 条已被 Horae 压缩隐藏${legacy}${disabled}`;
  };

  const horaeToMemory = (item, priority = 'medium') => ({
    id: gid(),
    event: item.event || 'Horae时间线事件',
    primaryKeywords: uniq(item.primaryKeywords || []),
    secondaryKeywords: [],
    entityKeywords: uniq(item.entityKeywords || []),
    summary: item.summary || '',
    timeLabel: item.timeLabel || '',
    timeValue: parseTimeValue(item.timeLabel || ''),
    floorRange: Array.isArray(item.floorRange) ? item.floorRange : null,
    priority,
    source: 'horae_memory',
    horaeMemoryId: item.horaeMemoryId,
    horaeKind: item.horaeKind,
    horaeSummaryId: item.horaeSummaryId || '',
    horaeEventKey: item.horaeEventKey || '',
    horaeLevel: item.horaeLevel || '',
    horaeVersion: item.horaeVersion || horaeState?.version || '',
    horaeCompressedAtImport: !!item.horaeCompressed,
    timestamp: item.timestamp || Date.now(),
    keywordSource: 'horae_auto'
  });

  const legacyHoraeCoverageFor = item => findLegacyHoraeCoverage(memories, item);

  const horaeImportState = (item, imported = null) => {
    const exactMap = imported || new Map(memories.filter(memory => memory.horaeMemoryId).map(memory => [String(memory.horaeMemoryId), memory]));
    const exact = exactMap.get(String(item?.horaeMemoryId || '')) || null;
    const coveredBy = exact ? null : legacyHoraeCoverageFor(item);
    return { exact, coveredBy, memory: exact || coveredBy };
  };

  const renderHorae = () => {
    const status = $('mp_hst');
    const list = $('mp_hl');
    const tabCount = $('mp_horae_tab_count');
    if (!status || !list) return;
    if (tabCount) tabCount.textContent = String(horaeMemories.length);
    status.textContent = horaeStatusText();

    const imported = new Map(memories.filter(m => m.horaeMemoryId).map(m => [String(m.horaeMemoryId), m]));
    const query = ($('mp_hs')?.value || '').trim().toLowerCase();
    const kind = $('mp_hkind')?.value || '';
    const mode = $('mp_hmp')?.value || '';
    const filtered = horaeMemories.filter(item => {
      const { memory } = horaeImportState(item, imported);
      if (kind === 'active' && item.horaeCompressed) return false;
      if (kind === 'compressed' && !item.horaeCompressed) return false;
      if (mode === 'unimported' && memory) return false;
      if ((mode === 'high' || mode === 'medium' || mode === 'low') && (!memory || (memory.priority || 'medium') !== mode)) return false;
      if (query && ![item.event, item.summary, item.timeLabel, ...(item.primaryKeywords || []), ...(item.entityKeywords || [])].join(' ').toLowerCase().includes(query)) return false;
      return true;
    });

    if (!horaeMemories.length) {
      list.innerHTML = '<div class="emp">暂无可读取的 Horae 原始事件</div>';
      return;
    }
    if (!filtered.length) {
      list.innerHTML = '<div class="emp">无匹配记忆</div>';
      return;
    }

    list.innerHTML = filtered.map(item => {
      const { exact: memory, coveredBy } = horaeImportState(item, imported);
      const itemIndex = horaeMemories.indexOf(item);
      const currentPriority = memory?.priority || 'medium';
      const range = Array.isArray(item.floorRange) ? `#${item.floorRange[0]}-${item.floorRange[1]}` : '楼层未知';
      const kindLabel = item.horaeCompressed ? '原始事件 · 已被Horae压缩' : '原始事件 · 尚未压缩';
      const priorityButton = (value, label) => `<button class="btn ${memory && currentPriority === value ? 'bp1' : (!memory && value === 'medium' ? 'bp1' : '')}" ${memory && currentPriority === value ? 'disabled aria-current="true"' : ''} onclick="window._mpHI(${itemIndex},'${value}')">${memory && currentPriority === value ? '当前：' : ''}${label}${memory ? '' : '导入'}</button>`;
      const primary = (item.primaryKeywords || []).map(tag => `<span class="kw">${h(tag)}</span>`).join('');
      const entities = (item.entityKeywords || []).map(tag => `<span class="kw ke">${h(tag)}</span>`).join('');
      const actions = coveredBy
        ? '<span class="bp bpi">旧版压缩摘要已覆盖</span>'
        : `${memory ? '<span class="bp bpi">已导入</span>' : ''}${priorityButton('high','常驻')}${priorityButton('medium','主要触发')}${priorityButton('low','次级触发')}${memory ? `<button class="btn bd1" onclick="window._mpD_horae(${itemIndex})">移除</button>` : ''}`;
      return `<div class="xi"><div class="mh"><span class="xt">${h(item.event)}</span><span class="ht">${h(kindLabel)} · ${h(item.horaeLevel || '')}</span></div><div class="ht">${h(item.timeLabel || '')}${item.timeLabel ? ' · ' : ''}${h(range)}</div><div class="ms">${h(item.summary)}</div><div class="kr">${primary}${entities}</div><div class="ma">${actions}</div></div>`;
    }).join('');
  };

  const refreshHorae = async () => {
    horaeState = await loadCurrentHoraeMemories({ context: ctx });
    horaeMemories = Array.isArray(horaeState?.items) ? horaeState.items : [];
    renderHorae();
  };

  const stripMarkdownFences = (text) => {
    const s = String(text || '').trim();
    // Strip ```json ... ``` or ``` ... ```
    const m = s.match(/^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```$/);
    if (m) return m[1].trim();
    // Strip leading ``` if no closing (partial)
    return s.replace(/^```(?:json|JSON)?\s*\n?/, '').replace(/\n?\s*```$/, '').trim();
  };

  const extractFirstJsonObject = (text) => {
    const raw = String(text || '').trim();
    const src = stripMarkdownFences(raw);
    // 1. Try full text
    try { const o = JSON.parse(src); if (o && typeof o === 'object' && !Array.isArray(o)) return o; } catch {}
    // 2. Try each line
    const lines = src.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    for (const line of lines) {
      try { const o = JSON.parse(line); if (o && typeof o === 'object' && !Array.isArray(o)) return o; } catch {}
    }
    // 3. Greedy brace match
    const greedy = src.match(/\{[\s\S]*\}/);
    if (greedy) {
      try { const o = JSON.parse(greedy[0]); if (o && typeof o === 'object' && !Array.isArray(o)) return o; } catch {}
    }
    // 4. Try to find first complete { ... } by brace counting
    let depth = 0, start = -1;
    for (let i = 0; i < src.length; i++) {
      if (src[i] === '{') { if (depth === 0) start = i; depth++; }
      else if (src[i] === '}') { depth--; if (depth === 0 && start >= 0) {
        try { const o = JSON.parse(src.slice(start, i + 1)); if (o && typeof o === 'object' && !Array.isArray(o)) return o; } catch {}
        start = -1;
      }}
    }
    return null;
  };

  const extractAllJsonObjects = (text) => {
    const raw = String(text || '').trim();
    const src = stripMarkdownFences(raw);
    const results = [];
    const lines = src.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    for (const line of lines) {
      try { const o = JSON.parse(line); if (o && typeof o === 'object' && !Array.isArray(o)) results.push(o); } catch {}
    }
    if (results.length) return results;
    // Fallback: brace counting for concatenated JSON
    let depth = 0, start = -1;
    for (let i = 0; i < src.length; i++) {
      if (src[i] === '{') { if (depth === 0) start = i; depth++; }
      else if (src[i] === '}') { depth--; if (depth === 0 && start >= 0) {
        try { const o = JSON.parse(src.slice(start, i + 1)); if (o && typeof o === 'object' && !Array.isArray(o)) results.push(o); } catch {}
        start = -1;
      }}
    }
    return results;
  };

  const buildKwPromptPayload = (mem) => {
    const floorRange = Array.isArray(mem?.floorRange) ? `#${mem.floorRange[0]}-#${mem.floorRange[1]}` : '未知';
    return loadKwPrompt()
      .replace('{{event}}', String(mem?.event || ''))
      .replace('{{summary}}', String(mem?.summary || ''))
      .replace('{{entities}}', (Array.isArray(mem?.entityKeywords) ? mem.entityKeywords : []).join(', '))
      .replace('{{timeLabel}}', String(mem?.timeLabel || ''))
      .replace('{{floorRange}}', floorRange);
  };

  const applyKeywordRebuild = async (mem, signal) => {
    const prompt = buildKwPromptPayload(mem);
    const raw = await callLLM(prompt, signal);
    const obj = extractFirstJsonObject(raw);
    if (!obj) throw new Error('关键词重构未返回有效 JSON');
    const normArr = (arr, limit = 8, blacklistAware = false) => {
      const src = Array.isArray(arr) ? arr : [];
      const blacklist = blacklistAware ? new Set(loadBlacklist().map(norm)) : null;
      return uniq(src.map(x => String(x ?? '').trim()).filter(Boolean).filter(x => !blacklist || !blacklist.has(norm(x)))).slice(0, limit);
    };
    return {
      ...mem,
      primaryKeywords: normArr(obj.primaryKeywords, 6, true),
      secondaryKeywords: normArr(obj.secondaryKeywords, 6, true),
      entityKeywords: normArr(obj.entityKeywords && obj.entityKeywords.length ? obj.entityKeywords : mem.entityKeywords, 8, false),
      keywordSource: mem?.source === 'anima_summary' ? 'anima_llm' : (mem?.source === 'horae_memory' ? 'horae_llm' : 'xb_llm'),
      updatedAt: Date.now()
    };
  };

  const parseRecallText = (text) =>
    String(text || '')
      .split(/\r?\n/)
      .map(s => String(s || '').trim())
      .filter(Boolean)
      .map(line => {
        const m = line.match(/^\[(.*?)\]\s*(.*)$/);
        return m ? { event: m[1] || '', summary: m[2] || '' } : { event: '', summary: line };
      });

  const formatRecallPayload = (r) => {
    const pinned = Array.isArray(r?.pinned) ? r.pinned : [];
    const triggered = Array.isArray(r?.triggered) ? r.triggered : [];
    const pin = pinned.map(m => `[${m.event || ''}] ${m.summary || ''}`).join('\n');
    const ctx = triggered.map(m => `[${m.event || ''}] ${m.summary || ''}`).join('\n');
    return { pin, ctx, pinned: parseRecallText(pin), triggered: parseRecallText(ctx) };
  };

  const readRecallCache = async () => {
    const pin = await pullText('mp_recall_pin', '');
    const ctx = await pullText('mp_recall_ctx', '');
    return { pin, ctx, pinned: parseRecallText(pin), triggered: parseRecallText(ctx) };
  };

  const writeRecallCache = async (r) => {
    const payload = formatRecallPayload(r);
    await saveText('mp_recall_pin', payload.pin);
    await saveText('mp_recall_ctx', payload.ctx);
    return payload;
  };

  const renderRecallSection = (title, tone, payload, opts = {}) => {
    const pinned = Array.isArray(payload?.pinned) ? payload.pinned : [];
    const triggered = Array.isArray(payload?.triggered) ? payload.triggered : [];
    const rawPin = payload?.pin || '';
    const rawCtx = payload?.ctx || '';
    const showReason = !!opts.showReason;
    const allowDelete = !!opts.allowDelete;
    const renderItem = (m, isPinned = false) => {
      const delBtn = allowDelete && m?.id ? `<button class="btn bd1" style="margin-left:8px;padding:2px 8px;font-size:11px" onclick="window._mpD('${m.id}')">删除该记忆</button>` : '';
      return `<div class="rc"><div class="me">${isPinned ? '[常驻] ' : ''}${h(m.event || '(无事件名)')}${delBtn}</div><div class="ms">${h(m.summary || '')}</div>${showReason && m._reason ? `<div class="rl">${h(m._reason)}</div>` : ''}</div>`;
    };
    let html = `<div class="ht" style="margin-bottom:6px;color:${tone}">${h(title)}</div>`;
    if (pinned.length) {
      html += '<div class="ht" style="margin-bottom:6px;color:#f87171">常驻记忆</div>';
      html += pinned.map(m => renderItem(m, true)).join('');
    }
    if (triggered.length) {
      html += '<div class="ht" style="margin:8px 0 6px;color:#fbbf24">触发记忆</div>';
      html += triggered.map(m => renderItem(m, false)).join('');
    }
    html += `<div class="rc"><div class="me">mp_recall_pin</div><div class="ms" style="white-space:pre-wrap">${h(rawPin || '(空)')}</div></div>`;
    html += `<div class="rc"><div class="me">mp_recall_ctx</div><div class="ms" style="white-space:pre-wrap">${h(rawCtx || '(空)')}</div></div>`;
    return html;
  };

  const renderRecall = async (opts = {}) => {
    const c = $('mp_rc_result');
    const tip = $('mp_rc_tip');
    const simulated = simulateRecall();
    const predicted = {
      ...formatRecallPayload(simulated),
      pinned: simulated.pinned || [],
      triggered: simulated.triggered || [],
    };
    const actual = opts.sync ? await writeRecallCache(simulated) : await readRecallCache();
    let html = '';

    html += renderRecallSection(predicted.due === false ? '当前回合不会执行正式召回（仅展示上下文）' : '当前这一次将注入的内容（即时模拟）', '#60a5fa', predicted, { showReason: true, allowDelete: true });
    html += renderRecallSection(opts.sync ? '已按当前结果重写缓存（actual）' : '缓存中的实际注入内容（actual）', '#34d399', actual, { showReason: false });

    if (predicted.due === false) {
      html = '<div class="emp">当前回合不执行正式召回；需等到每 N 回合节点才会正式召回与写入缓存。</div>' + html;
    } else if (!predicted.pinned.length && !predicted.triggered.length && !actual.pinned.length && !actual.triggered.length && !predicted.pin && !predicted.ctx && !actual.pin && !actual.ctx) {
      html = '<div class="emp">当前上下文无匹配召回</div>';
    }

    c.innerHTML = html;
    if (tip) {
      tip.textContent = opts.sync
        ? '已用当前召回结果重算并写入 mp_recall_pin / mp_recall_ctx。'
        : '上半部分是当前这一次将注入的内容；下半部分是缓存中最近一次实际写入的内容。';
    }
  };

  renderList();renderXb();renderAnima();renderHorae();

  const loadAutoCfg = () => window.MemoryPilot?.loadAutoSummaryConfig?.() || { enabled:false, interval:20, startFloor:1, priorityMode:'fixed', fixedPriority:'medium', hideSummarized:false, keepRecent:6 };
  const loadAutoState = () => window.MemoryPilot?.loadAutoSummaryState?.() || { nextFloor:1, completedThrough:0, paused:false, running:false, lastStatus:'尚未开始自动总结。', lastError:'' };
  const syncAutoConditionalFields = () => {
    if ($('mp_auto_fixed_wrap')) $('mp_auto_fixed_wrap').style.display = $('mp_auto_priority_mode')?.value === 'ai' ? 'none' : '';
    if ($('mp_auto_keep_wrap')) $('mp_auto_keep_wrap').style.display = $('mp_auto_hide')?.checked ? '' : 'none';
  };
  const renderAutoSummaryControls = (fill = false) => {
    const cfg = loadAutoCfg();
    const state = loadAutoState();
    if (fill) {
      $('mp_auto_enabled').checked = !!cfg.enabled;
      $('mp_auto_interval').value = String(cfg.interval || 20);
      $('mp_auto_start').value = String(cfg.startFloor || 1);
      $('mp_auto_priority_mode').value = cfg.priorityMode === 'ai' ? 'ai' : 'fixed';
      $('mp_auto_fixed').value = cfg.fixedPriority || 'medium';
      $('mp_auto_hide').checked = !!cfg.hideSummarized;
      $('mp_auto_keep').value = String(cfg.keepRecent ?? 6);
    }
    syncAutoConditionalFields();
    const nextStart = Number(state.nextFloor || cfg.startFloor || 1);
    const nextEnd = nextStart + Number(cfg.interval || 20) - 1;
    const missing = Math.max(0, nextEnd - chat.length);
    const nextText = missing
      ? `下一段：#${nextStart}-${nextEnd}（还差 ${missing} 楼）`
      : `下一段：#${nextStart}-${nextEnd}（将在下一次 AI 回复后执行）`;
    const status = $('mp_auto_status');
    if (status) {
      status.classList.toggle('err', !!state.paused);
      const prefix = !cfg.enabled ? '自动总结当前关闭。' : (state.running ? '自动总结正在运行。' : String(state.lastStatus || '尚未开始自动总结。'));
      status.textContent = `${prefix} ${nextText}`;
    }
    if ($('mp_auto_retry')) $('mp_auto_retry').style.display = state.paused ? '' : 'none';
    if ($('mp_auto_retry')) $('mp_auto_retry').disabled = !!state.running;
    if ($('mp_auto_save')) $('mp_auto_save').disabled = !!state.running;
  };
  renderAutoSummaryControls(true);
  $('mp_auto_priority_mode').onchange = syncAutoConditionalFields;
  $('mp_auto_hide').onchange = syncAutoConditionalFields;
  $('mp_auto_save').onclick = async () => {
    const previous = loadAutoCfg();
    const startFloor = Math.max(1, Math.round(Number($('mp_auto_start').value) || 1));
    if (startFloor !== previous.startFloor && loadAutoState().completedThrough >= previous.startFloor) {
      if (!confirm(`将开始总结楼层改为第 ${startFloor} 楼，会重置自动总结进度。继续吗？`)) return;
    }
    $('mp_auto_save').disabled = true;
    try {
      await window.MemoryPilot?.saveAutoSummaryConfig?.({
        enabled: !!$('mp_auto_enabled').checked,
        interval: Math.max(2, Math.min(200, Math.round(Number($('mp_auto_interval').value) || 20))),
        startFloor,
        priorityMode: $('mp_auto_priority_mode').value === 'ai' ? 'ai' : 'fixed',
        fixedPriority: $('mp_auto_fixed').value || 'medium',
        hideSummarized: !!$('mp_auto_hide').checked,
        keepRecent: Math.max(0, Math.min(200, Math.round(Number($('mp_auto_keep').value) || 0))),
      });
      renderAutoSummaryControls(true);
      toastr?.success?.('自动总结设置已保存');
    } catch (error) {
      toastr?.error?.('保存失败：' + (error?.message || error));
    } finally {
      $('mp_auto_save').disabled = false;
    }
  };
  $('mp_auto_retry').onclick = async () => {
    $('mp_auto_retry').disabled = true;
    renderAutoSummaryControls(false);
    try { await window.MemoryPilot?.retryAutoSummary?.(); }
    finally { renderAutoSummaryControls(true); }
  };
  if (window._mpAutoStateListener) window.removeEventListener('memorypilot:auto-summary-state', window._mpAutoStateListener);
  window._mpAutoStateListener = async () => {
    try { memories = dedupeMemories(await loadMemories()); renderList(); }
    catch {}
    renderAutoSummaryControls(false);
  };
  window.addEventListener('memorypilot:auto-summary-state', window._mpAutoStateListener);

  // Filter listeners
  const filterLabels = {
    all: '全部记忆',
    high: '常驻',
    medium: '主要触发',
    low: '次级触发',
  };
  root.querySelectorAll('[data-mf]').forEach(btn => {
    btn.onclick = () => {
      root.querySelectorAll('.ftab,.st').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      _listFilter = btn.getAttribute('data-mf');
      $('mp_filter_label').textContent = filterLabels[_listFilter] || '全部记忆';
      renderList();
    };
  });
  root.querySelectorAll('[data-merge-kw-mode]').forEach(btn => {
    btn.onclick = () => {
      const mode = btn.getAttribute('data-merge-kw-mode') || 'default';
      $('mp_merge_kw_mode').value = mode;
      root.querySelectorAll('[data-merge-kw-mode]').forEach(item => {
        const active = item === btn;
        item.classList.toggle('on', active);
        item.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    };
  });
  $('mp_f_search').oninput = () => { _listSearch = $('mp_f_search').value.trim(); searchCursor = -1; renderList(); };
  $('mp_multi_toggle').onclick = () => setMultiSelectMode(!multiSelectMode);
  $('mp_select_all').onclick = () => selectMemoryBatch(
    () => true,
    count => `已选择全部 ${count} 条记忆`,
    '当前没有可选择的记忆'
  );
  $('mp_select_xball').onclick = () => {
    selectMemoryBatch(
      m => m.source === 'xb_event',
      count => `已选择全部 ${count} 条小白X总结`,
      '当前没有小白X总结'
    );
  };
  $('mp_select_xbnr').onclick = () => {
    selectMemoryBatch(
      m => m.source === 'xb_event' && m.keywordSource !== 'xb_llm',
      count => `已选择 ${count} 条未重构小白X总结`,
      '当前没有未重构的小白X总结'
    );
  };
  $('mp_select_animaall').onclick = () => {
    selectMemoryBatch(
      m => m.source === 'anima_summary',
      count => `已选择全部 ${count} 条 Anima 总结`,
      '当前没有 Anima 总结'
    );
  };
  $('mp_select_animanr').onclick = () => {
    selectMemoryBatch(
      m => m.source === 'anima_summary' && m.keywordSource !== 'anima_llm',
      count => `已选择 ${count} 条未重构 Anima 总结`,
      '当前没有未重构的 Anima 总结'
    );
  };
  $('mp_select_horaeall').onclick = () => {
    selectMemoryBatch(
      m => m.source === 'horae_memory',
      count => `已选择全部 ${count} 条 Horae 记忆`,
      '当前没有 Horae 记忆'
    );
  };
  $('mp_select_horaenr').onclick = () => {
    selectMemoryBatch(
      m => m.source === 'horae_memory' && m.keywordSource !== 'horae_llm',
      count => `已选择 ${count} 条未重构 Horae 记忆`,
      '当前没有未重构的 Horae 记忆'
    );
  };
  window._mpJump = (id) => {
    _listSearch = '';
    _listFilter = 'all';
    searchCursor = -1;
    if ($('mp_f_search')) $('mp_f_search').value = '';
    root.querySelectorAll('.ftab,.st').forEach(b => b.classList.remove('on'));
    root.querySelector('[data-mf="all"]')?.classList.add('on');
    if ($('mp_filter_label')) $('mp_filter_label').textContent = '全部记忆';
    activateTab('list');
    renderList();
    requestAnimationFrame(() => scrollToListItem(id));
  };
  $('mp_float_top').onclick = () => root.querySelector('.bd')?.scrollTo({ top: 0, behavior: 'smooth' });
  $('mp_float_bottom').onclick = () => {
    const bd = root.querySelector('.bd');
    if (bd) bd.scrollTo({ top: bd.scrollHeight, behavior: 'smooth' });
  };

  const close=()=>{
    if(_abort || kwRunning){
      const panel=$(P);
      if(panel) panel.style.display='none';
      toastr?.info?.('操作仍在后台运行，完成后可重新打开面板查看结果');
      return;
    }
    if(window._mpAnimaSummaryListener) document.removeEventListener('anima_summary_written',window._mpAnimaSummaryListener);
    $(P)?.remove();$(S)?.remove();
  };
  $('mp_cls').onclick=close;
  root.querySelector('.mask').onclick=close;
  const markGuideSeen = () => {
    try { localStorage.setItem('mp_onboarding_seen_v1', '1'); } catch {}
    try { const g = _getGlobalStore(); g.onboardingSeenV1 = true; _saveDebounced(); } catch {}
  };
  const showGuide = (auto = false) => {
    const g = $('mp_guide');
    if (!g) return;
    g.classList.add('on');
    if (auto) markGuideSeen();
  };
  const hideGuide = () => $('mp_guide')?.classList.remove('on');
  $('mp_help').onclick = () => showGuide(false);
  $('mp_guide_ok').onclick = () => { markGuideSeen(); hideGuide(); };
  $('mp_guide_mask').onclick = () => { markGuideSeen(); hideGuide(); };
  $('mp_copy_inject').onclick = async () => {
    try {
      await navigator.clipboard.writeText(RECALL_INJECT_PROMPT);
      toastr?.success?.('记忆注入 Prompt 已复制');
    } catch {
      const input = $('mp_inject_prompt');
      input?.focus();
      input?.select();
      try { document.execCommand('copy'); toastr?.success?.('记忆注入 Prompt 已复制'); }
      catch { toastr?.warning?.('复制失败，请长按文本框手动复制'); }
    }
  };
  root.querySelectorAll('[data-guide-tab]').forEach(btn => {
    btn.onclick = () => {
      markGuideSeen();
      hideGuide();
      activateTab(btn.getAttribute('data-guide-tab'));
      root.querySelector('.bd')?.scrollTo({ top: 0, behavior: 'smooth' });
    };
  });
  root.querySelectorAll('[data-guide-action]').forEach(btn => {
    btn.onclick = () => {
      markGuideSeen();
      hideGuide();
      const action = btn.getAttribute('data-guide-action');
      if (action === 'api') window.MemoryPilot?.openApiConfig?.();
      if (action === 'monitor') window.MemoryPilot?.openMonitor?.();
    };
  });
  root.querySelectorAll('.tab').forEach(t=>{t.onclick=()=>{
    activateTab(t.dataset.t);
  };});
  if (['list', 'add', 'xb', 'anima', 'horae', 'batch', 'cfg'].includes(initialTab)) activateTab(initialTab);

  $('mp_sv').onclick=async()=>{
    const ev=$('mp_fe').value.trim();
    const pkw=$('mp_fpk').value.split(/[,，]/).map(k=>k.trim()).filter(Boolean);
    const skw=$('mp_fsk').value.split(/[,，]/).map(k=>k.trim()).filter(Boolean);
    const ekw=$('mp_fek').value.split(/[,，]/).map(k=>k.trim()).filter(Boolean);
    const tl=$('mp_ft').value.trim();
    const tvRaw=$('mp_ftv').value.trim();
    const frRaw=$('mp_ffr').value.trim();
    const sm=$('mp_fs').value.trim();
    const pr=$('mp_fp').value;
    const alphaRaw=$('mp_fa').value.trim();
    let fr=null;
    const m=frRaw.match(/^(\d+)\s*[-~～到]\s*(\d+)$/);
    if(m) fr=[Math.min(+m[1],+m[2]),Math.max(+m[1],+m[2])];
    const tv=tvRaw===''?null:Number(tvRaw);
    if(!ev||!sm){toastr?.warning?.('填写事件名和摘要');return;}

    await withLock('save_form', async () => {
      const alphaVal = alphaRaw === '' ? null : Number(alphaRaw);
      const patch={event:ev,primaryKeywords:pkw,secondaryKeywords:skw,entityKeywords:ekw,summary:sm,priority:pr,timeLabel:tl,timeValue:Number.isFinite(tv)?tv:null,floorRange:fr,alpha:Number.isFinite(alphaVal)?Math.max(0,Math.min(0.95,alphaVal)):null};
      if(editId){
        const old = memories.find(m=>m.id===editId);
        const next = { ...(old || {}), ...patch, id: editId };
        memories = upsertMemory(memories, next);
        editId=null;
      } else {
        memories = upsertMemory(memories, {id:gid(),...patch,source:'manual',timestamp:Date.now()});
      }
      await saveMem(memories);
      renderList();
      renderXb();
      renderAnima();
      renderHorae();
      clearForm(false);
      root.querySelector('.tab[data-t="list"]').click();
      requestAnimationFrame(() => {
        const bd = root.querySelector('.bd');
        if (bd) bd.scrollTop = _listScrollY;
      });
      toastr?.success?.('已保存');
    });
  };

  window._mpE=id=>{
    const m=memories.find(x=>x.id===id);if(!m)return;
    _listScrollY=root.querySelector('.bd')?.scrollTop||0;
    editId=id;
    _editUndo={event:m.event||'',primaryKeywords:(m.primaryKeywords||m.keywords||[]).join(', '),secondaryKeywords:(m.secondaryKeywords||[]).join(', '),entityKeywords:(m.entityKeywords||[]).join(', '),timeLabel:m.timeLabel||'',timeValue:Number.isFinite(Number(m.timeValue))?String(m.timeValue):'',floorRange:Array.isArray(m.floorRange)?`${m.floorRange[0]}-${m.floorRange[1]}`:'',alpha:Number.isFinite(Number(m.alpha))?String(m.alpha):'',summary:m.summary||'',priority:m.priority||'medium'};
    $('mp_fe').value=m.event||'';
    $('mp_fpk').value=(m.primaryKeywords||m.keywords||[]).join(', ');
    $('mp_fsk').value=(m.secondaryKeywords||[]).join(', ');
    $('mp_fek').value=(m.entityKeywords||[]).join(', ');
    $('mp_ft').value=m.timeLabel||'';
    $('mp_ftv').value=Number.isFinite(Number(m.timeValue))?String(m.timeValue):'';
    $('mp_ffr').value=Array.isArray(m.floorRange)?`${m.floorRange[0]}-${m.floorRange[1]}`:'';
    $('mp_fa').value=Number.isFinite(Number(m.alpha))?String(m.alpha):'';
    $('mp_fs').value=m.summary||'';
    $('mp_fp').value=m.priority||'medium';
    root.querySelector('.tab[data-t="add"]').click();
  };
  window._mpD=async id=>{
    if(!confirm('删除？'))return;
    await withLock('delete_'+id, async () => {
      const removed = makeDeleteSnapshot(m=>m.id===id);
      memories=memories.filter(m=>m.id!==id);
      selectedIds.delete(id);
      await saveMem(memories);
      renderList();
      renderXb();
      renderAnima();
      renderHorae();
      showDeleteUndo(removed);
      toastr?.success?.('已删除');
    });
  };
  window._mpD_xb=async(eid)=>{
    if(!confirm('从记忆库移除此事件？'))return;
    await withLock('xb_del_'+eid, async () => {
      memories=memories.filter(m=>String(m.xbEventId||'')!==String(eid));
      await saveMem(memories);
      renderList();
      renderXb();
      toastr?.success?.('已移除');
    });
  };

  const clearForm = (keepTab = true) => {
    editId = null;
    $('mp_fe').value='';
    $('mp_fpk').value='';
    $('mp_fsk').value='';
    $('mp_fek').value='';
    $('mp_ft').value='';
    $('mp_ftv').value='';
    $('mp_ffr').value='';
    $('mp_fa').value='';
    $('mp_fs').value='';
    $('mp_fp').value='medium';
    if (keepTab) root.querySelector('.tab[data-t="add"]').click();
  };

  $('mp_fundo').onclick=()=>{
    if (!_editUndo) { toastr?.warning?.('没有可撤回的修改'); return; }
    $('mp_fe').value=_editUndo.event;
    $('mp_fpk').value=_editUndo.primaryKeywords;
    $('mp_fsk').value=_editUndo.secondaryKeywords;
    $('mp_fek').value=_editUndo.entityKeywords;
    $('mp_ft').value=_editUndo.timeLabel;
    $('mp_ftv').value=_editUndo.timeValue;
    $('mp_ffr').value=_editUndo.floorRange;
    $('mp_fa').value=_editUndo.alpha;
    $('mp_fs').value=_editUndo.summary;
    $('mp_fp').value=_editUndo.priority;
    toastr?.success?.('已撤回到编辑前状态');
  };
  $('mp_fcancel').onclick=()=>{
    clearForm(false);
    _editUndo=null;
    root.querySelector('.tab[data-t="list"]').click();
    requestAnimationFrame(() => {
      const bd = root.querySelector('.bd');
      if (bd) bd.scrollTop = _listScrollY;
    });
  };

  $('mp_xs').oninput=renderXb;$('mp_xty').onchange=renderXb;$('mp_xwt').onchange=renderXb;$('mp_xmp').onchange=renderXb;
  $('mp_as').oninput=renderAnima;
  $('mp_amp').onchange=renderAnima;
  $('mp_anima_refresh').onclick=async()=>{
    $('mp_anima_refresh').disabled=true;
    $('mp_anima_refresh').textContent='读取中…';
    try { await refreshAnima(); }
    finally { $('mp_anima_refresh').disabled=false; $('mp_anima_refresh').textContent='重新读取'; }
  };

  window._mpAI=async(itemIndex,prio)=>{
    const item=animaSummaries[Number(itemIndex)];
    if(!item)return;
    const animaSummaryId=item.animaSummaryId;
    await withLock('anima_import_'+animaSummaryId,async()=>{
      const existing=memories.find(m=>String(m.animaSummaryId||'')===String(animaSummaryId));
      const nextMem=existing?{...existing,priority:prio,updatedAt:Date.now()}:animaToMemory(item,prio);
      memories=upsertMemory(memories,nextMem);
      await saveMem(memories);
      renderList();renderAnima();
      toastr?.success?.(existing?'已更新召回类型':'已导入 Anima 总结');
    });
  };

  window._mpD_anima=async(itemIndex)=>{
    const item=animaSummaries[Number(itemIndex)];
    if(!item)return;
    const animaSummaryId=item.animaSummaryId;
    if(!confirm('从 MemoryPilot 记忆列表移除此 Anima 总结？\n\n不会删除 Anima 世界书中的原始总结。'))return;
    await withLock('anima_del_'+animaSummaryId,async()=>{
      memories=memories.filter(m=>String(m.animaSummaryId||'')!==String(animaSummaryId));
      await saveMem(memories);
      renderList();renderAnima();
      toastr?.success?.('已从记忆列表移除');
    });
  };

  $('mp_anima_import_all').onclick=async()=>{
    const imported=new Set(memories.filter(m=>m.animaSummaryId).map(m=>String(m.animaSummaryId)));
    const pending=animaSummaries.filter(item=>!imported.has(String(item.animaSummaryId)));
    if(!pending.length){toastr?.info?.('没有未导入的 Anima 总结');return;}
    if(!confirm(`将 ${pending.length} 条 Anima 总结按“主要触发”导入 MemoryPilot，继续吗？`))return;
    await withLock('anima_import_all',async()=>{
      for(const item of pending) memories=upsertMemory(memories,animaToMemory(item,'medium'));
      await saveMem(memories);
      renderList();renderAnima();
      toastr?.success?.(`已导入 ${pending.length} 条 Anima 总结`);
    });
  };

  if(window._mpAnimaSummaryListener) document.removeEventListener('anima_summary_written',window._mpAnimaSummaryListener);
  window._mpAnimaSummaryListener=()=>{ if(document.getElementById(P)) refreshAnima(); };
  document.addEventListener('anima_summary_written',window._mpAnimaSummaryListener);

  $('mp_hs').oninput=renderHorae;
  $('mp_hkind').onchange=renderHorae;
  $('mp_hmp').onchange=renderHorae;
  $('mp_horae_refresh').onclick=async()=>{
    $('mp_horae_refresh').disabled=true;
    $('mp_horae_refresh').textContent='读取中…';
    try { await refreshHorae(); }
    finally { $('mp_horae_refresh').disabled=false; $('mp_horae_refresh').textContent='重新读取'; }
  };

  window._mpHI=async(itemIndex,prio)=>{
    const item=horaeMemories[Number(itemIndex)];
    if(!item)return;
    const horaeMemoryId=item.horaeMemoryId;
    await withLock('horae_import_'+horaeMemoryId,async()=>{
      const existing=memories.find(m=>String(m.horaeMemoryId||'')===String(horaeMemoryId));
      const coveredBy=existing?null:legacyHoraeCoverageFor(item);
      if(coveredBy){
        toastr?.info?.('该楼层已由旧版 Horae 压缩摘要覆盖，不会重复导入');
        return;
      }
      // 已导入的条目只修改召回类型；重新读取 Horae 不会回写正文、
      // 时间或楼层，避免外部重新分析改动 MemoryPilot 库存。
      const nextMem=existing?{
        ...existing,
        priority:prio,
        updatedAt:Date.now()
      }:horaeToMemory(item,prio);
      memories=upsertMemory(memories,nextMem);
      await saveMem(memories);
      renderList();renderHorae();
      toastr?.success?.(existing?'已更新召回类型':'已导入 Horae 记忆');
    });
  };

  window._mpD_horae=async(itemIndex)=>{
    const item=horaeMemories[Number(itemIndex)];
    if(!item)return;
    const horaeMemoryId=item.horaeMemoryId;
    if(!confirm('从 MemoryPilot 记忆列表移除此 Horae 记忆？\n\n不会删除 Horae 中的原始数据。'))return;
    await withLock('horae_del_'+horaeMemoryId,async()=>{
      memories=memories.filter(m=>String(m.horaeMemoryId||'')!==String(horaeMemoryId));
      await saveMem(memories);
      renderList();renderHorae();
      toastr?.success?.('已从记忆列表移除');
    });
  };

  $('mp_horae_import_all').onclick=async()=>{
    const imported=new Map(memories.filter(memory=>memory.horaeMemoryId).map(memory=>[String(memory.horaeMemoryId),memory]));
    const pending=horaeMemories.filter(item=>{
      const state=horaeImportState(item,imported);
      return !state.exact&&!state.coveredBy;
    });
    if(!pending.length){toastr?.info?.('当前没有未导入的 Horae 原始事件');return;}
    await withLock('horae_import_all',async()=>{
      for(const item of pending) memories=upsertMemory(memories,horaeToMemory(item,'medium'));
      await saveMem(memories);
      renderList();renderHorae();
      toastr?.success?.(`已导入 ${pending.length} 条 Horae 原始事件`);
    });
  };

  window._mpXI=async(eid,prio)=>{
    const e=xbEvents.find(x=>String(x.id)===String(eid));if(!e)return;
    await withLock('xb_import_'+eid, async () => {
      const timeLabel = e.timeLabel || '';
      const floorRange = deriveFloorRangeFromXB(e);
      const tags = Array.isArray(e.tags) ? e.tags : [];
      const primaryKeywords = [e.type||'', ...tags].filter(Boolean);
      const secondaryKeywords = [e.weight||''].filter(Boolean);
      const entityKeywords = [...(e.participants||[])].filter(Boolean);
      const summary = timeLabel ? `${timeLabel}，${e.summary}` : e.summary;
      const nextMem = {
        id:gid(),
        event:e.title,
        primaryKeywords,
        secondaryKeywords,
        entityKeywords,
        summary,
        timeLabel,
        timeValue: parseTimeValue(timeLabel),
        floorRange,
        priority:prio,
        source:'xb_event',
        xbEventId:e.id,
        timestamp:Date.now(),
        keywordSource:'xb_auto'
      };
      memories = upsertMemory(memories, nextMem);
      await saveMem(memories);
      renderList();
      renderXb();
      toastr?.success?.('已导入');
    });
  };

  $('mp_bkb').onclick=()=>{
    const kw=$('mp_bk').value.trim();
    if(!kw){$('mp_bkr').innerHTML='';lastSearchResults=[];updateSearchStatus();renderSearchContext(null);return;}
    const results=searchFloors(kw);
    renderSearchResults(results);
  };
  $('mp_bkc').onclick=()=>{
    $('mp_bk').value='';
    $('mp_bkr').innerHTML='';
    searchPicked = new Set();
    lastSearchResults = [];
    updateSearchStatus();
    renderSearchContext(null);
  };
  $('mp_bk_apply').onclick=applyPickedFloors;
  $('mp_bk_pick_all').onclick=()=>{
    searchPicked = new Set(lastSearchResults.map(r => r.floor + 1));
    renderSearchResults(lastSearchResults);
  };
  $('mp_bk_pick_none').onclick=()=>{
    searchPicked = new Set();
    renderSearchResults(lastSearchResults);
  };

  $('mp_mps').onclick=async()=>{await saveMergePrompt($('mp_mpr').value);toastr?.success?.('合并 Prompt 已保存');};
  $('mp_mpd').onclick=async()=>{$('mp_mpr').value=DEF_MERGE_PROMPT;await saveMergePrompt(DEF_MERGE_PROMPT);toastr?.success?.('已恢复默认');};

  $('mp_merge_open').onclick=()=>{
    if(kwRunning){toastr?.warning?.('有操作正在进行');return;}
    if(selectedIds.size < 2){toastr?.warning?.('请至少选择 2 条记忆进行合并');return;}
    $('mp_merge_setup')?.classList.add('on');
    $('mp_merge_status').textContent = `已选择 ${selectedIds.size} 条记忆。请确认它们属于同一事件或同一段连续情节，再设置合并方式。`;
  };
  $('mp_merge_setup_cancel').onclick=()=>{
    if(kwRunning && kwRunningId === '__merge__'){toastr?.warning?.('合并正在进行，请先中止');return;}
    $('mp_merge_setup')?.classList.remove('on');
    $('mp_merge_status').textContent = '';
  };

  $('mp_merge_run').onclick=async()=>{
    if(kwRunning && kwRunningId === '__merge__' && kwAbort){
      kwAbort.abort();
      $('mp_merge_status').textContent = '正在中止合并...';
      return;
    }
    if(kwRunning){toastr?.warning?.('有操作正在进行');return;}
    const ids = [...selectedIds];
    if(ids.length < 2){toastr?.warning?.('请至少选择 2 条记忆进行合并');return;}
    const mems = ids.map(id => memories.find(m => memoryId(m) === id)).filter(Boolean);
    if(mems.length < 2){toastr?.warning?.('有效记忆不足 2 条');return;}
    const priorities = new Set(mems.map(m => m.priority || 'medium'));
    if(priorities.size > 1){
      const labels = [...priorities].map(p => p === 'high' ? '常驻' : p === 'low' ? '次级触发' : '主要触发');
      toastr?.warning?.('只能合并同优先级的记忆（当前选择了：' + labels.join('、') + '）');return;
    }
    const prio = [...priorities][0];
    const kwMode = $('mp_merge_kw_mode')?.value || 'default';
    const hasFloor = mems.some(m => Array.isArray(m.floorRange) && m.floorRange.length >= 2);
    if(!hasFloor){ if(!confirm('选中的记忆都没有楼层范围信息，合并时将无法参考原文。是否继续？')) return; }
    const useCtx = !!$('mp_merge_ctx')?.checked;
    const prioLabel = prio === 'high' ? '常驻' : prio === 'low' ? '次级触发' : '主要触发';
    const prioClass = prio === 'high' ? 'bph' : prio === 'low' ? 'bpl' : 'bpm';
    if(!confirm('将合并 ' + mems.length + ' 条 [' + prioLabel + '] 记忆为 1 条。\n请确认它们属于同一事件或同一段连续情节；系统不会自动拆分多个事件。\n关键词模式：' + (kwMode === 'ai' ? 'AI 重新生成' : '汇总原关键词') + '\n合并时参考原文：' + (useCtx ? '是' : '否') + '\n继续？')) return;
    kwAbort = new AbortController();
    kwRunning = true;
    kwRunningId = '__merge__';
    $('mp_merge_status').textContent = '正在合并...';
    $('mp_merge_run').textContent = '中止合并';
    await savePendingOp('merge', { status:'running', message: mems.length + '条记忆' });
    try {
      const includeCtx = !!$('mp_merge_ctx')?.checked;
      const prompt = buildMergePayload(mems, includeCtx);
      const raw = await callLLM(prompt, kwAbort.signal);
      const obj = extractFirstJsonObject(raw);
      if(!obj || !obj.event || !obj.summary) throw new Error('合并结果无效');
      let kws;
      if(kwMode === 'ai'){
        const kwPrompt = loadKwPrompt().replace('{{event}}', obj.event || '').replace('{{summary}}', obj.summary || '').replace('{{entities}}', (obj.entityKeywords || mems.flatMap(m => m.entityKeywords || [])).join(', ')).replace('{{timeLabel}}', obj.timeLabel || '').replace('{{floorRange}}', Array.isArray(obj.floorRange) ? '#' + obj.floorRange[0] + '-#' + obj.floorRange[1] : '未知');
        $('mp_merge_status').textContent = '正在由 AI 重新生成关键词...';
        const kwRaw = await callLLM(kwPrompt, kwAbort.signal);
        const kwObj = extractFirstJsonObject(kwRaw);
        kws = kwObj ? { primaryKeywords: uniq((kwObj.primaryKeywords || []).map(k => String(k||'').trim()).filter(Boolean)).slice(0,8), secondaryKeywords: uniq((kwObj.secondaryKeywords || []).map(k => String(k||'').trim()).filter(Boolean)).slice(0,8), entityKeywords: uniq((kwObj.entityKeywords || obj.entityKeywords || []).map(k => String(k||'').trim()).filter(Boolean)).slice(0,8) } : mergeKeywordsDefault(mems);
      } else { kws = mergeKeywordsDefault(mems); }
      const merged = { id: gid(), event: obj.event, summary: obj.summary, timeLabel: obj.timeLabel || mems[0].timeLabel || '', timeValue: Number.isFinite(Number(obj.timeValue)) ? Number(obj.timeValue) : (mems[0].timeValue || null), floorRange: (Array.isArray(obj.floorRange) && obj.floorRange.length >= 2) ? obj.floorRange : mergeFloorRange(mems), floorSegments: collectFloorSegments(mems), priority: prio, ...kws, source: 'merged', mergedFrom: ids, timestamp: Date.now() };
      kwRunning = false; kwRunningId = null; kwAbort = null;
      $('mp_merge_run').textContent = '开始合并';
      { const _p=$(P); if(_p && _p.style.display==='none') { _p.style.display=''; toastr?.success?.('合并处理完成，请确认预览结果'); } }
      const pkwH = (merged.primaryKeywords||[]).map(k=>'<span class="kw">'+h(k)+'</span>').join('');
      const skwH = (merged.secondaryKeywords||[]).map(k=>'<span class="kw kx">'+h(k)+'</span>').join('');
      const ekwH = (merged.entityKeywords||[]).map(k=>'<span class="kw ke">'+h(k)+'</span>').join('');
      const frH = formatFloorSegments(merged);
      $('mp_merge_status').innerHTML = '<div class="mi" style="border-color:rgba(124,107,240,0.4)"><div class="mh"><span class="me">[预览] '+h(merged.event)+'</span><span class="bp '+prioClass+'">'+h(prioLabel)+'</span></div>'+(merged.timeLabel?'<div class="ht">'+h(merged.timeLabel)+(frH?' | '+frH:'')+'</div>':'')+'<div class="ms">'+h(merged.summary)+'</div><div class="kr">'+pkwH+skwH+ekwH+'</div><div class="ma" style="margin-top:8px"><button class="btn bp1" id="mp_merge_confirm">确认合并（删除原记忆）</button><button class="btn bd1" id="mp_merge_cancel">放弃</button></div></div>';
      await savePendingOp('merge', { status:'done', message: merged.event, results: [merged] });
      window._mpMergePreview = { merged: merged, sourceIds: ids };
      const confirmBtn = document.getElementById('mp_merge_confirm');
      const cancelBtn = document.getElementById('mp_merge_cancel');
      if(confirmBtn) {
        confirmBtn.addEventListener('click', async function onConfirm() {
          confirmBtn.removeEventListener('click', onConfirm);
          confirmBtn.disabled = true; confirmBtn.textContent = '正在写入...';
          try {
            const preview = window._mpMergePreview;
            if (!preview) { toastr?.warning?.('预览数据丢失'); return; }
            window._mpMergeUndo = { deletedMems: preview.sourceIds.map(id => memories.find(m => memoryId(m) === id)).filter(Boolean), mergedId: preview.merged.id };
            for (const id of preview.sourceIds) { memories = memories.filter(m => memoryId(m) !== id); }
            memories = upsertMemory(memories, preview.merged);
            await saveMem(memories); selectedIds = new Set(); renderList(); renderXb(); renderAnima(); renderHorae();
            $('mp_merge_status').innerHTML = '<div class="ht" style="color:#4ade80">合并完成：'+h(preview.merged.event)+' <button class="btn bd1" id="mp_merge_undo" style="margin-left:8px;padding:2px 8px;font-size:11px">撤回合并</button></div>';
            const undoBtn = document.getElementById('mp_merge_undo');
            if(undoBtn) { undoBtn.addEventListener('click', async function onUndo() {
              undoBtn.removeEventListener('click', onUndo);
              const undo = window._mpMergeUndo;
              if (!undo) { toastr?.warning?.('没有可撤回的合并'); return; }
              undoBtn.disabled = true; undoBtn.textContent = '正在撤回...';
              try { memories = memories.filter(m => m.id !== undo.mergedId); for (const m of undo.deletedMems) { memories = upsertMemory(memories, m); } await saveMem(memories); selectedIds = new Set(); window._mpMergeUndo = null; window._mpMergePreview = null; renderList(); renderXb(); renderAnima(); renderHorae(); $('mp_merge_status').textContent = '合并已撤回，原记忆已恢复。'; toastr?.success?.('合并已撤回'); }
              catch(ue) { toastr?.error?.('撤回失败：'+(ue?.message||ue)); undoBtn.disabled = false; undoBtn.textContent = '撤回合并'; }
            }); }
            window._mpMergePreview = null; toastr?.success?.('已合并 '+preview.sourceIds.length+' 条记忆');
          } catch(ce) { toastr?.error?.('写入失败：'+(ce?.message||ce)); confirmBtn.disabled = false; confirmBtn.textContent = '确认合并（删除原记忆）'; }
        });
      }
      if(cancelBtn) { cancelBtn.addEventListener('click', function onCancel() { cancelBtn.removeEventListener('click', onCancel); window._mpMergePreview = null; $('mp_merge_status').textContent = '已放弃合并。'; toastr?.info?.('已放弃'); }); }
    } catch(e) {
      if(e?.name === 'AbortError'){ $('mp_merge_status').textContent = '合并已中止'; toastr?.warning?.('已中止'); await savePendingOp('merge',{status:'error',error:'手动中止'}); }
      else { $('mp_merge_status').textContent = '合并失败：'+(e?.message||e); toastr?.error?.('合并失败：'+(e?.message||e)); await savePendingOp('merge',{status:'error',error:e?.message||String(e)}); }
      kwRunning = false; kwRunningId = null; kwAbort = null; $('mp_merge_run').textContent = '开始合并';
    }
  };

  $('mp_kps').onclick=async()=>{await saveKwPrompt($('mp_kpr').value);toastr?.success?.('重构关键词 Prompt 已保存');};
  $('mp_kpd').onclick=async()=>{$('mp_kpr').value=DEF_KW_PROMPT;await saveKwPrompt(DEF_KW_PROMPT);toastr?.success?.('已恢复默认');};

  $('mp_sel_none').onclick=()=>{
    selectedIds = new Set();
    renderList();
  };
  $('mp_del_sel').onclick=async()=>{
    const ids = [...selectedIds].filter(id => memories.some(m => memoryId(m) === id));
    if (!ids.length) { toastr?.warning?.('请先选择要删除的记忆'); return; }
    if (!confirm(`删除选中的 ${ids.length} 条记忆？`)) return;
    await withLock('delete_selected', async () => {
      const doomed = new Set(ids);
      const removed = makeDeleteSnapshot(m => doomed.has(memoryId(m)));
      memories = memories.filter(m => !doomed.has(memoryId(m)));
      selectedIds = new Set();
      await saveMem(memories);
      renderList();
      renderXb();
      renderAnima();
      renderHorae();
      showDeleteUndo(removed);
      toastr?.success?.(`已删除 ${ids.length} 条记忆`);
    });
  };

  window._mpKR=async(id)=>{
    const mem = memories.find(x=>x.id===id);
    if(!mem) return;
    if(!isRebuildableMemory(mem)){toastr?.warning?.('仅支持小白X总结、Anima总结或Horae记忆');return;}
    if(kwRunning && kwRunningId===id && kwAbort){
      kwAbort.abort();
      $('mp_kw_status').textContent = `正在中止：${mem.event}`;
      renderList();
      return;
    }
    if(kwRunning){toastr?.warning?.('已有关键词重构正在进行');return;}
    kwAbort = new AbortController();
    kwRunning = true;
    kwRunningId = id;
    renderList();
    $('mp_kw_status').textContent = `正在重构：${mem.event}`;
    try{
      await withLock('kw_rebuild_'+id, async () => {
        const next = await applyKeywordRebuild(mem, kwAbort.signal);
        memories = upsertMemory(memories, next);
        await saveMem(memories);
        renderList();
        renderXb();
        renderAnima();
        renderHorae();
      });
      $('mp_kw_status').textContent = `已完成：${mem.event}`;
      toastr?.success?.('关键词已重构');
      { const _p=$(P); if(_p && _p.style.display==='none') { _p.style.display=''; } }
    }catch(e){
      if(e?.name==='AbortError'){
        $('mp_kw_status').textContent = '单条关键词重构已中止。';
        toastr?.warning?.('已中止');
      }else{
        $('mp_kw_status').textContent = '关键词重构失败：' + (e?.message || e);
        toastr?.error?.('关键词重构失败：' + (e?.message || e));
      }
    }finally{
      kwRunning = false;
      kwRunningId = null;
      kwAbort = null;
      renderList();
    }
  };

  $('mp_rebuild_sel').onclick=async()=>{
    if(kwRunning && kwAbort){
      kwAbort.abort();
      $('mp_kw_status').textContent = '正在中止批量重构...';
      return;
    }
    const ids = [...selectedIds].filter(id => memories.some(m => memoryId(m)===id && isRebuildableMemory(m)));
    if(!ids.length){toastr?.warning?.('请先选择小白X总结、Anima总结或Horae记忆');return;}
    if(!confirm(`将使用当前 Prompt 和总结 API，批量重构 ${ids.length} 条外部总结的关键词，继续吗？`)) return;
    kwAbort = new AbortController();
    kwRunning = true;
    kwRunningId = '__batch__';
    $('mp_rebuild_sel').textContent = '中止批量重构';
    let ok = 0, fail = 0;
    await savePendingOp('rebuild', { status:'running', message: '0/' + ids.length });
    try{
      for (let idx = 0; idx < ids.length; idx++) {
        if (kwAbort.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const id = ids[idx];
        const mem = memories.find(x=>memoryId(x)===id);
        if(!mem) continue;
        $('mp_kw_status').textContent = `批量重构中 ${idx+1}/${ids.length}：${mem.event}`;
        if (idx % 3 === 0) { try { await savePendingOp('rebuild', { status:'running', message: (idx+1) + '/' + ids.length }); } catch {} }
        try{
          const next = await applyKeywordRebuild(mem, kwAbort.signal);
          memories = upsertMemory(memories, next);
          await saveMem(memories);
          selectedIds.delete(id);
          ok++;
          renderList();
        }catch(e){
          if(e?.name==='AbortError') throw e;
          fail++;
        }
      }
      $('mp_kw_status').textContent = `批量重构完成：成功 ${ok} 条，失败 ${fail} 条`;
      toastr?.success?.(`批量重构完成：成功 ${ok} 条，失败 ${fail} 条`);
      await savePendingOp('rebuild', { status:'done', message: '成功 ' + ok + ' 条，失败 ' + fail + ' 条' });
      { const _p=$(P); if(_p && _p.style.display==='none') { _p.style.display=''; } }
    }catch(e){
      if(e?.name==='AbortError'){
        await saveMem(memories);
        $('mp_kw_status').textContent = `批量重构已中止：成功 ${ok} 条，失败 ${fail} 条`;
        toastr?.warning?.('批量重构已中止');
        await savePendingOp('rebuild', { status:'error', error: '手动中止（成功 ' + ok + '，失败 ' + fail + '）' });
      }else{
        $('mp_kw_status').textContent = '批量重构失败：' + (e?.message || e);
        toastr?.error?.('批量重构失败：' + (e?.message || e));
        await savePendingOp('rebuild', { status:'error', error: e?.message || String(e) });
      }
    }finally{
      kwRunning = false;
      kwRunningId = null;
      kwAbort = null;
      $('mp_rebuild_sel').textContent = '批量重构关键词';
      renderList();
      renderXb();
      renderAnima();
      renderHorae();
      { const _p=$(P); if(_p && _p.style.display==='none') { _p.style.display=''; } }
    }
  };

  $('mp_bps').onclick=async()=>{await savePrompt($('mp_bpr').value);toastr?.success?.('Prompt已保存');};
  $('mp_bpd').onclick=async()=>{$('mp_bpr').value=DEF_PROMPT;await savePrompt(DEF_PROMPT);toastr?.success?.('已恢复默认');};

  $('mp_rssv').onclick=async()=>{
    await saveRecallCfg({every:Math.max(1,Math.round(Number($('mp_revery').value)||1)),alpha:Math.max(0,Math.min(0.95,(($('mp_ralpha').value?.trim?.()==='')?0.72:Number($('mp_ralpha').value)))),maxRecall:Math.max(1,Math.min(20,Number($('mp_rmaxn')?.value)||6)),contextWindow:Math.max(3,Math.min(30,Number($('mp_rctxwin')?.value)||8)),stickyTurns:Math.max(0,Math.min(20,Number($('mp_rsticky')?.value)??5)),animaDedupe:!!$('mp_anima_dedupe')?.checked,xiaobaixDedupe:!!$('mp_xiaobaix_dedupe')?.checked});
    toastr?.success?.('召回设置已保存');
  };

  $('mp_blsv').onclick=async()=>{
    const arr=$('mp_bl').value.split(/[\n,，]+/).map(s=>s.trim()).filter(Boolean);
    await saveBlacklist(arr);
    toastr?.success?.('黑名单已保存');
  };

  $('mp_clsv').onclick=async()=>{
    const cfg = {
      blockTags: $('mp_ctags').value.split(/\n/).map(s=>s.trim()).filter(Boolean),
      linePrefixes: $('mp_cprefix').value.split(/\n/).map(s=>s.trim()).filter(Boolean),
      regexRules: $('mp_cregex').value.split(/\n/).map(s=>s.trim()).filter(Boolean),
      cleanForRecall: !!$('mp_c_recall').checked,
      cleanForBatch: !!$('mp_c_batch').checked
    };
    await saveCleaner(cfg);
    toastr?.success?.('文本清洗规则已保存');
  };

  // === 导出 / 导入 ===
  $('mp_export').onclick = async () => {
    try {
      const exportData = {
        _format: 'MemoryPilot_Export',
        _version: 1,
        _exportedAt: new Date().toISOString(),
        memories: dedupeMemories(loadMem()),
        recallSettings: loadRecallCfg(),
        blacklist: loadBlacklist(),
        cleaner: loadCleaner(),
        apiConfig: loadApi(),
        summaryPrompt: loadPrompt(),
        kwRebuildPrompt: loadKwPrompt(),
        mergePrompt: loadMergePrompt(),
        autoSummary: loadAutoCfg(),
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'MemoryPilot_' + new Date().toISOString().slice(0,10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      $('mp_io_status').textContent = '导出成功：' + exportData.memories.length + ' 条记忆';
      $('mp_io_status').style.color = '#4ade80';
      toastr?.success?.('已导出 ' + exportData.memories.length + ' 条记忆');
    } catch (e) {
      $('mp_io_status').textContent = '导出失败：' + (e?.message || e);
      $('mp_io_status').style.color = '#f87171';
      toastr?.error?.('导出失败');
    }
  };
  $('mp_import').onclick = () => { $('mp_import_file').click(); };
  $('mp_import_file').onchange = async (ev) => {
    const file = ev.target?.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data._format !== 'MemoryPilot_Export') throw new Error('不是 MemoryPilot 导出文件');
      const counts = [];
      if (Array.isArray(data.memories) && data.memories.length) {
        const mode = confirm('导入 ' + data.memories.length + ' 条记忆。\n\n点击「确定」= 合并（保留现有 + 导入新增）\n点击「取消」= 覆盖（清空现有，只保留导入）') ? 'merge' : 'replace';
        if (mode === 'merge') {
          let added = 0;
          for (const m of data.memories) { const before = memories.length; memories = upsertMemory(memories, m); if (memories.length > before) added++; }
          counts.push('记忆合并 +' + added + ' 条');
        } else {
          memories = dedupeMemories(data.memories);
          counts.push('记忆覆盖 ' + memories.length + ' 条');
        }
        await saveMem(memories);
      }
      if (data.recallSettings) { await saveRecallCfg(data.recallSettings); counts.push('召回设置'); }
      if (Array.isArray(data.blacklist)) { await saveBlacklist(data.blacklist); counts.push('黑名单'); }
      if (data.cleaner) { await saveCleaner(data.cleaner); counts.push('清洗规则'); }
      if (data.apiConfig && data.apiConfig.key) { await saveApi(data.apiConfig); counts.push('API配置'); }
      if (data.summaryPrompt) { await savePrompt(data.summaryPrompt); counts.push('总结 Prompt'); }
      if (data.kwRebuildPrompt) { await saveKwPrompt(data.kwRebuildPrompt); counts.push('重构Prompt'); }
      if (data.mergePrompt) { await saveMergePrompt(data.mergePrompt); counts.push('合并Prompt'); }
      if (data.autoSummary) { await window.MemoryPilot?.saveAutoSummaryConfig?.(data.autoSummary); counts.push('自动总结设置'); }
      renderList(); renderXb(); renderAnima(); renderHorae();
      $('mp_io_status').textContent = '导入成功：' + counts.join('、');
      $('mp_io_status').style.color = '#4ade80';
      toastr?.success?.('导入完成');
    } catch (e) {
      $('mp_io_status').textContent = '导入失败：' + (e?.message || e);
      $('mp_io_status').style.color = '#f87171';
      toastr?.error?.('导入失败：' + (e?.message || e));
    }
    ev.target.value = '';
  };


  $('mp_cleanup_refresh').onclick = () => {
    const report = renderCleanupSummary();
    setCleanupStatus(report?.hasChatLegacy || report?.hasLwbLegacy ? '检测完成：发现可清理的旧版数据。' : '检测完成：无需清理。');
  };

  const CURRENT_POINTER_KEYS = new Set(['version','chatKey','lastProcessedFloor','lastRecallTurn','storeMode']);
  const CURRENT_INJECT_VARS = new Set(['mp_recall_pin','mp_recall_ctx']);
  const inspectLegacyCleanup = () => {
    const raw = window.MemoryPilot?.detectLegacyArtifacts?.() || {};
    const ns = ctx?.chatMetadata?.extensions?.MemoryPilot || {};
    const metadataKeys = Object.keys(ns).filter(key => !CURRENT_POINTER_KEYS.has(key));
    const vars = ctx?.chatMetadata?.variables || {};
    const variableKeys = Object.keys(vars).filter(key => String(key).startsWith('mp_') && !CURRENT_INJECT_VARS.has(key));
    return {
      metadataKeys,
      variableKeys,
      lwbCount: Number(raw.lwbSnapMpTraceCount || 0),
      hasChatLegacy: metadataKeys.length > 0 || variableKeys.length > 0,
      hasLwbLegacy: !!raw.lwbSnapHasMpTraces,
    };
  };

  $('mp_cleanup_mp').onclick = async () => {
    const report = inspectLegacyCleanup();
    if (!report.hasChatLegacy) { toastr?.info?.('当前聊天没有需要清理的旧版数据'); return; }
    if (!confirm('清理旧版聊天残留？\n\n只会移除检测到的旧版元数据和废弃变量，不会删除记忆列表、当前召回内容或小白X总结。建议先导出 MP 数据备份。')) return;
    try {
      const ns = ctx?.chatMetadata?.extensions?.MemoryPilot;
      if (ns) report.metadataKeys.forEach(key => { delete ns[key]; });
      const vars = ctx?.chatMetadata?.variables;
      if (vars) report.variableKeys.forEach(key => { delete vars[key]; });
      try {
        if (typeof ctx.saveMetadata === 'function') await ctx.saveMetadata();
        else if (typeof ctx.saveChatMetadata === 'function') await ctx.saveChatMetadata();
        else if (typeof ctx.saveChat === 'function') await ctx.saveChat();
      } catch {}
      renderCleanupSummary();
      const msg = `旧版聊天残留已清理：元数据 ${report.metadataKeys.length} 项，变量 ${report.variableKeys.length} 项`;
      setCleanupStatus(msg, true);
      toastr?.success?.('旧版聊天残留已清理');
    } catch (e) {
      setCleanupStatus('清理失败：' + (e?.message || e), false);
      toastr?.error?.('清理失败');
    }
  };

  $('mp_cleanup_lwb').onclick = async () => {
    if (!confirm('清理小白X快照里的旧 MP 副本？\n\n只会移除小白X楼层快照中重复保存的 mp_* 变量，不会删除小白X总结或当前记忆列表。')) return;
    try {
      const res = await window.MemoryPilot?.cleanupLegacyArtifacts?.({
        removeMpMetadata: false,
        removeMpVariables: false,
        removeLegacyLocalStorage: false,
        removeLwbMpTraces: true,
      });
      renderCleanupSummary();
      const msg = `小白X快照旧 MP 副本已清理：变量 ${res?.removedLwbSnapVars || 0} 项，空快照 ${res?.prunedLwbSnapEntries || 0} 项`;
      setCleanupStatus(msg, true);
      toastr?.success?.('小白X快照旧 MP 副本已清理');
    } catch (e) {
      setCleanupStatus('清理失败：' + (e?.message || e), false);
      toastr?.error?.('清理失败');
    }
  };

  let _abort=null;

  // 楼层总结结果渲染（复用于实时和恢复场景）
  const renderBatchResults = (nms) => {
    window._mpBM = dedupeMemories(nms);
    const priorityLabel = value => value === 'high' ? '常驻' : value === 'low' ? '次级触发' : '主要触发';
    const priorityClass = value => value === 'high' ? 'bph' : value === 'low' ? 'bpl' : 'bpm';
    const normalizeSuggested = value => value === 'high' || value === 'low' ? value : 'medium';
    const pendingCount = window._mpBM.filter(m => !memories.some(item => String(item?.id || '') === String(m.id || ''))).length;
    const batchAction = pendingCount
      ? `<div class="batchresultactions"><button class="btn bp1" onclick="window._mpBAI()">一键按 AI 建议导入（${pendingCount} 条）</button></div>`
      : '';
    $('mp_br').innerHTML=batchAction+window._mpBM.map(m=>{
      const suggested = normalizeSuggested(m.aiSuggestedPriority || m.priority || 'medium');
      const imported = memories.find(item => String(item?.id || '') === String(m.id || ''));
      const current = imported?.priority || null;
      const button = (value, label) => {
        if (current) return `<button class="btn ${current===value?'bp1':''}" ${current===value?'disabled aria-current="true"':''} onclick="window._mpBA('${m.id}','${value}')">${current===value?'当前：':''}${label}</button>`;
        return `<button class="btn ${suggested===value?'bp1':''}" onclick="window._mpBA('${m.id}','${value}')">${label}导入</button>`;
      };
      return `<div class="mi"><div class="mh"><span class="me">${h(m.event)}</span><span class="bp ${priorityClass(suggested)}">AI 建议：${priorityLabel(suggested)}</span></div><div class="ht">${h(m.timeLabel||'')}${Array.isArray(m.floorRange)?' | #'+h(m.floorRange[0])+'-'+h(m.floorRange[1]):''}</div><div class="ms">${h(m.summary)}</div><div class="kr">${((m.primaryKeywords||m.keywords||[])).map(k=>'<span class="kw">'+h(k)+'</span>').join('')}${(m.secondaryKeywords||[]).map(k=>'<span class="kw kx">'+h(k)+'</span>').join('')}${(m.entityKeywords||[]).map(k=>'<span class="kw ke">'+h(k)+'</span>').join('')}</div><div class="ma">${current?'<span class="bp bpi">已导入</span>':''}${button('high','常驻')}${button('medium','主要触发')}${button('low','次级触发')}</div></div>`;
    }).join('');
    window._mpBA=async(id,prio)=>{
      await withLock('batch_add_'+id, async () => {
        const m=window._mpBM.find(x=>x.id===id);if(!m)return;
        const wasImported = memories.some(item => String(item?.id || '') === String(id));
        const next = {...m, aiSuggestedPriority:m.aiSuggestedPriority||m.priority||'medium', priority: prio};
        memories = upsertMemory(memories, next);
        await saveMem(memories);
        renderList();
        renderXb();
        renderBatchResults(window._mpBM);
        toastr?.success?.(wasImported?'记忆类型已保存':'已加入记忆列表');
      });
    };
    window._mpBAI=async()=>{
      await withLock('batch_add_all_ai', async () => {
        const pending = window._mpBM.filter(m => !memories.some(item => String(item?.id || '') === String(m.id || '')));
        if (!pending.length) return;
        for (const m of pending) {
          const suggested = normalizeSuggested(m.aiSuggestedPriority || m.priority || 'medium');
          memories = upsertMemory(memories, {...m, aiSuggestedPriority:suggested, priority:suggested});
        }
        await saveMem(memories);
        renderList();
        renderXb();
        renderBatchResults(window._mpBM);
        toastr?.success?.(`已按 AI 建议导入 ${pending.length} 条记忆`);
      });
    };
  };


  const renderCleanupSummary = () => {
    const report = inspectLegacyCleanup();
    const el = $('mp_cleanup_summary');
    if (!el) return report;
    const parts = [];
    if (report.hasChatLegacy) parts.push(`发现旧版聊天残留 ${report.metadataKeys.length + report.variableKeys.length} 项，可以清理。`);
    if (report.hasLwbLegacy) parts.push(`发现小白X快照里的旧 MP 副本 ${report.lwbCount} 项，可以清理。`);
    el.textContent = parts.length ? parts.join(' ') : '当前聊天没有需要清理的旧版数据。';
    el.style.color = parts.length ? '#9a6b16' : '#4f745a';
    if ($('mp_cleanup_mp')) $('mp_cleanup_mp').disabled = !report.hasChatLegacy;
    if ($('mp_cleanup_lwb')) $('mp_cleanup_lwb').disabled = !report.hasLwbLegacy;
    return report;
  };

  const setCleanupStatus = (text, ok = true) => {
    const el = $('mp_cleanup_status');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = ok ? '#4ade80' : '#f87171';
  };

  // 恢复上次的持久化结果
  const restorePendingBatch = () => {
    const batchPage = $('mp_pg_batch');
    if (!batchPage) return;
    const bannerId = renderPendingBanner(batchPage, 'batch', '楼层总结');
    if (bannerId) {
      const ops = checkStaleOps(loadPendingOps());
      const op = ops.batch;
      if (op && (op.status === 'done' || op.status === 'timeout') && (op.resultCount > 0 || (Array.isArray(op.results) && op.results.length))) {
        document.getElementById(bannerId + '_view')?.addEventListener('click', () => {
          const results = loadPendingResults('batch') || op.results || [];
          if (results.length) renderBatchResults(results);
          else toastr?.warning?.('结果数据已过期（页面曾刷新），请重新总结');
        });
      }
    }
    // 重构操作
    const listPage = $('mp_pg_list');
    if (listPage) {
      const rbId = renderPendingBanner(listPage, 'rebuild', '批量重构关键词');
      const mgId = renderPendingBanner(listPage, 'merge', '合并选中记忆');
    }
  };
  // 面板打开时立即检查
  try { restorePendingBatch(); } catch {}
  try { renderCleanupSummary(); } catch {}

  $('mp_brun').onclick=async()=>{
    if(_abort){_abort.abort();_abort=null;$('mp_brun').textContent='开始总结';try{await savePendingOp('batch',{status:'error',error:'手动停止'});}catch{}return;}
    const indices=parseFloors($('mp_bf').value,chat.length);
    if(!indices.length){toastr?.warning?.('未选中楼层');return;}
    _abort=new AbortController();
    $('mp_brun').textContent='停止';
    $('mp_br').innerHTML='<div class="ht">正在总结 '+indices.length+' 层...</div>';
    await savePendingOp('batch', { status:'running', message: indices.length + '层' });
    const uL=ctx.name1||'用户',cL=ctx.name2||'角色';
    const cleaner = loadCleaner();
    const text=indices.map(i=>{
      const m=chat[i];
      if(!m) return '';
      const body = cleaner.cleanForBatch ? applyCleaner(m.mes || '', cleaner) : String(m.mes || '');
      if(!body.trim()) return '';
      return `#${i+1}[${m.is_user?uL:(m.name||cL)}]${body}`;
    }).filter(Boolean).join('\n');
    const prompt=loadPrompt().replace('{{content}}',text);
    try{
      const result=await callLLM(prompt,_abort.signal);
      const parsed = extractAllJsonObjects(result);
      const nms=[];
      const floorRange = indices.length ? [indices[0]+1, indices[indices.length-1]+1] : null;
      const defaultTimeLabel = floorRange ? `第${floorRange[0]}-${floorRange[1]}层` : '';
      for(const o of parsed){
        try{
          if(o.event&&o.summary){
            nms.push({
              ...o,
              id:gid(),
              timestamp:Date.now(),
              primaryKeywords:Array.isArray(o.primaryKeywords)?o.primaryKeywords:(Array.isArray(o.keywords)?o.keywords:[]),
              secondaryKeywords:Array.isArray(o.secondaryKeywords)?o.secondaryKeywords:[],
              entityKeywords:Array.isArray(o.entityKeywords)?o.entityKeywords:[],
              source:'batch',
              floorRange: Array.isArray(o.floorRange)&&o.floorRange.length>=2 ? o.floorRange : floorRange,
              timeLabel: o.timeLabel || defaultTimeLabel,
              timeValue: Number.isFinite(Number(o.timeValue)) ? Number(o.timeValue) : null
            });
          }
        }catch{}
      }
      if(!nms.length){
        $('mp_br').innerHTML='<div class="ht" style="color:#f87171">未提取到记忆</div>';
        await savePendingOp('batch', { status:'error', error:'LLM 返回了内容但未提取到有效记忆 JSON' });
        return;
      }
      // 持久化结果
      await savePendingOp('batch', { status:'done', results: dedupeMemories(nms), message: nms.length + '条记忆' });
      renderBatchResults(nms);
    }catch(e){
      if(e.name==='AbortError'){
        $('mp_br').innerHTML='<div class="ht">已停止</div>';
      } else {
        $('mp_br').innerHTML=`<div class="ht" style="color:#f87171">失败: ${h(e.message)}</div><details class="det" style="margin-top:6px"><summary>完整错误</summary><pre style="font-size:11px;color:#f87171;white-space:pre-wrap;word-break:break-all">${h(e.message)}</pre></details>`;
        await savePendingOp('batch', { status:'error', error: e.message || String(e) });
      }
    }finally{
      _abort=null;
      const runBtn=$('mp_brun');
      if(runBtn) runBtn.textContent='开始总结';
      const panel=$(P);
      if(panel && panel.style.display==='none') {
        panel.style.display='';
        toastr?.success?.('楼层总结已完成');
      }
    }
  };
})();
}
