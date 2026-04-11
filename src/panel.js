// MemoryPilot Management Panel - auto-transformed
// Storage: extensionSettings (NOT chatMetadata)

export async function openPanel() {
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
  const gid = () => 'mp_'+Math.random().toString(36).slice(2,10);
  const norm = s => String(s??'').toLowerCase().trim();
  const normalizeOpenAIBase = s => String(s ?? '').trim().replace(/\/+$/,'').replace(/\/chat\/completions$/i,'');
  const normalizeClaudeBase = s => String(s ?? '').trim().replace(/\/+$/,'').replace(/\/v1\/messages$/i,'');
  const normalizeGeminiBase = s => String(s ?? '').trim().replace(/\/+$/,'').replace(/\/models\/.*$/i,'');

  if ($(P)){$(P).remove();$(S)?.remove();return;}
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
    try { localStorage.setItem(MK, JSON.stringify(memories)); } catch {}
    // Store in extensionSettings (NOT in chat metadata!)
    const store = _getStore();
    if (store) { store[MK] = memories; _saveDebounced(); }
  };
  const loadApi = ()=>{try{return JSON.parse(localStorage.getItem(AK))||{};}catch{}return{};};
  const saveApi = async (cfg)=>{ await pushJson(AK, cfg || {}); };
  const loadBlacklist = ()=>{try{const r=localStorage.getItem(BK);const a=r?JSON.parse(r):[];return Array.isArray(a)?a:[];}catch{}return[];};
  const saveBlacklist = async arr => { await pushJson(BK, Array.isArray(arr)?arr:[]); };

  // Event Groups (must be defined early — used by renderList, simulateRecall, etc.)
  const GK = 'mp_event_groups';
  const loadGroups = () => { try { const store = _getStore(); if (store && store[GK]) return store[GK]; } catch {} return {}; };
  const saveGroups = async (groups) => { const store = _getStore(); if (store) { store[GK] = groups; _saveDebounced(); } };
  const getMemGroups = (memId) => {
    const groups = loadGroups();
    return Object.keys(groups).filter(g => (groups[g]||[]).includes(memId));
  };

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

  const DEF_RECALL_SETTINGS = { every: 1, alpha: 0.72, stickyTurns: 5, contextWindow: 8, maxRecall: 6, groupRecall: true };
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
      groupRecall: src.groupRecall !== false
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
    [textKey(m?.event || ''), textKey(m?.summary || ''), textKey((m?.source || '') + '|' + (m?.xbEventId || ''))].join('||');

  const dedupeMemories = (list) => {
    const out = [];
    const seenId = new Set();
    const seenXb = new Set();
    const seenFp = new Set();

    for (const item of Array.isArray(list) ? list : []) {
      if (!item) continue;
      const id = String(item.id ?? '');
      const xb = item.xbEventId ? `xb:${String(item.xbEventId)}` : '';
      const fp = memFingerprint(item);

      if (id && seenId.has(id)) continue;
      if (xb && seenXb.has(xb)) continue;
      if (fp && seenFp.has(fp)) continue;

      if (id) seenId.add(id);
      if (xb) seenXb.add(xb);
      if (fp) seenFp.add(fp);
      out.push(item);
    }
    return out;
  };

  const upsertMemory = (list, nextMem) => {
    const arr = Array.isArray(list) ? [...list] : [];
    const nextXbId = nextMem?.xbEventId ? String(nextMem.xbEventId) : '';
    const nextId = nextMem?.id ? String(nextMem.id) : '';

    let idx = -1;
    if (nextXbId) idx = arr.findIndex(x => String(x?.xbEventId || '') === nextXbId);
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
{"event":"场景标题","primaryKeywords":["主召回关键词"],"secondaryKeywords":["门控关键词"],"entityKeywords":["人物名"],"summary":"详细摘要","timeLabel":"时间标签","timeValue":1234,"floorRange":[起始楼层号,结束楼层号],"priority":"high/medium/low"}

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

primaryKeywords（2-6个）：
- 必须是后续 RP 对话中会被原封不动写出来的词
- 优先：具体地名、物品名、活动名、独特称呼/代号、关键台词中的名词
- 例如：「D-12舱室」「三明治」「处分单」「陈胜吴广」「达喀尔」「银星勋章」
- 不要写：「关系突破」「信任危机」「情感表达」这类概括词

secondaryKeywords（2-6个）：
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
    try{const g=window.MemoryPilot?.getCustomPrompt?.('analysis');if(g)return g;}catch{}
    try{const r=localStorage.getItem(PK);if(r){if(/\"keywords\"\s*:/.test(r)&&!/primaryKeywords/.test(r))return DEF_PROMPT;return r;}}catch{}
    return DEF_PROMPT;
  };
  const savePrompt=async(p)=>{
    try{window.MemoryPilot?.saveCustomPrompt?.('analysis',p);}catch{}
    await pushText(PK,p);
  };

  const DEF_MERGE_PROMPT = `你需要将以下多条记忆合并为一条完整的记忆。

要求：
1. event 格式为「地点·核心内容概括」，综合所有事件的核心。
2. summary 长度 100-300 字，必须保留所有事件中的关键细节（具体台词、动作、物品、数字）不要遗漏任何重要信息。必须保留关键细节，对剧情有推动作用的关键具体动作和身体语言进行高度浓缩
- 总结前因后果的同时保留因果链：谁说/做了什么 → 对方什么反应 → 导致什么变化
- 不要概括为"讨论了战争""表达了感情"，要写出具体说了什么、怎么表达的
- 可以用分号连接多个连续动作，不需要每个动作单独成句；使用第三人称。
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
{"primaryKeywords":["主召回关键词"],"secondaryKeywords":["门控关键词"],"entityKeywords":["人物名"]}

规则：
1. primaryKeywords 是主召回关键词：必须是后续对话中会被直接写出来的原词，例如具体地名（"图书馆""天台"）、具体物品名（"银星勋章"）、具体活动名（"击剑比赛"）、人物间的独特称呼或代号；不要写概括性标签，不要放人物名；控制在 2-6 个。
2. secondaryKeywords 是门控关键词：用于限制语境，必须是对话中真的会出现的具体词，例如动作词（"道歉""逃跑"）、场景词（"雨天""教室"）、结果词（"受伤""和解"）；不要写抽象归纳，不要和 primaryKeywords 重复；不要放人物名；控制在 2-6 个。
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
    try{const g=window.MemoryPilot?.getCustomPrompt?.('kwRebuild');if(g)return g;}catch{}
    try{const r=localStorage.getItem(KPK);if(r){if(!/primaryKeywords/.test(r)||!/secondaryKeywords/.test(r))return DEF_KW_PROMPT;return r;}}catch{}
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
    return loadMergePrompt().replace('{{memories}}', memText).replace('{{context}}', context || '（未关联原文）');
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
    $('mp_bctx').innerHTML=`<div style="position:sticky;top:0;z-index:2;background:inherit;padding:8px 0 6px;border-bottom:1px solid rgba(255,255,255,0.06)"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><div><button class="btn" id="mp_bctx_back" style="padding:5px 14px;font-size:12px">← 返回搜索结果</button></div><div class="ht">焦点 #${h(String(focus))} ｜ 已勾选：${h(pt)}</div></div></div><div id="_csa">`+ls.map(l=>_ctxH(l)).join('')+'</div>';
    $('mp_bctx_back')?.addEventListener('click',showSearchView);
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
  const _bindCk=()=>{$('mp_bctx')?.querySelectorAll('._ck').forEach(el=>{if(el._b)return;el._b=true;el.onchange=()=>{const n=Number(el.getAttribute('data-floor'));if(!Number.isFinite(n))return;if(el.checked)searchPicked.add(n);else searchPicked.delete(n);$('mp_bk_status').textContent=`已勾选 ${searchPicked.size} 层用于批量分析。`;};});};

  // 扩展版 getContextSlice: 直接给起止索引
  

  
  
  

  

  

  // Range slider 不再需要，但保留兼容
  const renderSearchContext = (focusFloor = null) => {
    if (focusFloor) showContextView(focusFloor);
  };

  const renderSearchResults = (results) => {
    lastSearchResults = Array.isArray(results) ? results : [];
    if (!lastSearchResults.length) { $('mp_bkr').innerHTML = '<div class="ht">未找到</div>'; $('mp_bk_status').textContent = ''; return; }
    showSearchView();
    const nums = lastSearchResults.map(r => r.floor + 1);
    $('mp_bkr').innerHTML = `<div class="ht" style="margin-bottom:5px">找到 ${lastSearchResults.length} 层 <button class="btn" style="padding:2px 6px;font-size:10px" onclick="document.getElementById('mp_bf').value='${nums.join(',')}';"> 全部填入楼层框</button></div>` + lastSearchResults.map((r,ri) => { const floor=r.floor+1; const checked=searchPicked.has(floor); const fullText=String(chat[r.floor]?.mes||'').replace(/</g,'&lt;').replace(/>/g,'&gt;'); const short=h(r.preview); return `<div class="sr"><div style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" class="mp_bpick" data-floor="${floor}" ${checked?'checked':''}><div style="flex:1"><div><span class="sf">#${floor}</span> <span class="sp">[${h(r.speaker)}] 匹配:${r.matchedKw.map(k=>'<mark>'+h(k)+'</mark>').join(' ')}</span> <button class="btn" style="padding:2px 6px;font-size:10px" data-view="${floor}">上下文</button> <button class="btn _sr_toggle" style="padding:2px 6px;font-size:10px" data-ri="${ri}">展开</button></div><div class="stx _sr_short" id="sr_s${ri}">${short}</div><div class="stx _sr_full" id="sr_f${ri}" style="display:none;white-space:pre-wrap">${fullText}</div></div></div></div>`; }).join('');
    $('mp_bkr').querySelectorAll('._sr_toggle').forEach(el=>{el.onclick=()=>{const ri=el.getAttribute('data-ri');const s=$('sr_s'+ri);const f=$('sr_f'+ri);if(f.style.display==='none'){f.style.display='';s.style.display='none';el.textContent='收起';}else{f.style.display='none';s.style.display='';el.textContent='展开';}};});
    $('mp_bk_status').textContent = `已勾选 ${searchPicked.size} 层用于批量分析。`;
    $('mp_bkr').querySelectorAll('.mp_bpick').forEach(el=>{el.onchange=()=>{const n=Number(el.getAttribute('data-floor'));if(!Number.isFinite(n))return;if(el.checked)searchPicked.add(n);else searchPicked.delete(n);$('mp_bk_status').textContent=`已勾选 ${searchPicked.size} 层用于批量分析。`;};});
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
        pinned.push({...mem,_reason:'置顶'});
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
        if (secondaryMatch.exact.length) reasons.push('门控关键词硬命中: ' + secondaryMatch.exact.join(', '));
        if (secondaryMatch.weak.length) reasons.push('门控关键词弱匹配: ' + secondaryMatch.weak.join(', '));
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
    // Group recall simulation
    if (recallCfgLocal.groupRecall !== false) {
      const grps = loadGroups();
      const selSet = new Set(selected.map(m=>m.id));
      const pinSet = new Set(pinned.map(m=>m.id));
      const activeGrps = new Set();
      for (const [gn, members] of Object.entries(grps)) {
        if ((members||[]).some(mid => selSet.has(mid) || pinSet.has(mid))) activeGrps.add(gn);
      }
      const grpCand = [];
      for (const gn of activeGrps) {
        for (const mid of (grps[gn]||[])) {
          if (selSet.has(mid) || pinSet.has(mid)) continue;
          const mem = memories.find(m => m.id === mid);
          if (!mem || alreadySeen(mem)) continue;
          const scored = primary.find(p => p.id === mid);
          grpCand.push({ ...mem, _score: scored?scored._score:0.01, _reason: '事件组['+gn+']补位' });
          markSeen(mem);
        }
      }
      grpCand.sort((a,b)=>b._score-a._score);
      const grpSlots = Math.max(0, maxTriggered - selected.length);
      if (grpSlots > 0) selected.push(...grpCand.slice(0, grpSlots));
    }
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
  memories = await pullJson(MK, []);
  memories = dedupeMemories(memories);
  try { localStorage.setItem(MK, JSON.stringify(memories)); } catch {}

  await pullJson(BK, loadBlacklist());
  await pullJson(AK, loadApi());
  const syncedPrompt = await pullText(PK, loadPrompt());
  if (syncedPrompt) { try { localStorage.setItem(PK, syncedPrompt); } catch {} }
  let editId=null;
  let _listScrollY=0;
  let _editUndo=null;
  const xbEvents=loadXb();

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
    #${P}{position:fixed;top:0;left:0;right:0;bottom:0;z-index:10001;display:flex;align-items:center;justify-content:center;padding:max(10px, env(safe-area-inset-top)) 10px max(10px, env(safe-area-inset-bottom)) 10px;box-sizing:border-box;font-family:-apple-system,sans-serif;isolation:isolate}
    #${P} .mask{position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.55);backdrop-filter:blur(5px)}
    #${P} .card{position:relative;width:100%;max-width:960px;max-height:calc(100dvh - max(20px, env(safe-area-inset-top) + env(safe-area-inset-bottom)));background:#222327;border-radius:14px;border:1px solid rgba(255,255,255,0.08);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 16px 50px rgba(0,0,0,0.5)}
    #${P} .hd{padding:11px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0}
    #${P} .hd h3{margin:0;color:#fff;font-size:16px}
    #${P} .cls{background:none;border:none;color:#888;font-size:22px;cursor:pointer;width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:50%}
    #${P} .cls:hover{background:rgba(255,255,255,0.1);color:#fff}
    #${P} .tabs{display:flex;gap:4px;padding:7px 12px;background:rgba(0,0,0,0.25);flex-wrap:wrap;flex-shrink:0}
    #${P} .ftab{padding:6px 11px;border-radius:7px;border:1px solid rgba(255,255,255,0.08);background:transparent;color:#aaa;cursor:pointer;font-size:11px;white-space:nowrap}
    #${P} .ftab:hover{background:rgba(255,255,255,0.05);color:#fff}
    #${P} .ftab.on{background:rgba(124,107,240,0.15);color:#7c6bf0;border-color:rgba(124,107,240,0.4)}
    #${P} .tab{padding:6px 11px;border-radius:7px;border:1px solid rgba(255,255,255,0.08);background:transparent;color:#aaa;cursor:pointer;font-size:11px;white-space:nowrap}
    #${P} .tab:hover{background:rgba(255,255,255,0.05);color:#fff}
    #${P} .tab.on{background:rgba(124,107,240,0.15);color:#7c6bf0;border-color:rgba(124,107,240,0.4)}
    #${P} .bd{flex:1;overflow-y:auto;padding:12px 16px;min-height:0;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
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
    #${P} .mp-top-btn{position:absolute;bottom:16px;right:16px;z-index:5;width:36px;height:36px;border-radius:50%;background:rgba(124,107,240,0.85);border:none;color:#fff;font-size:16px;cursor:pointer;display:none;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:opacity 0.2s}
    #${P} .mp-top-btn:hover{background:rgba(124,107,240,1)}
    #${P} .mp-top-btn.vis{display:flex}
    @media(max-width:760px){
      #${P}{padding:max(6px, env(safe-area-inset-top)) 6px max(6px, env(safe-area-inset-bottom)) 6px}
      #${P} .card{max-width:100%;max-height:calc(100dvh - max(12px, env(safe-area-inset-top) + env(safe-area-inset-bottom)));border-radius:10px}
      #${P} .hd{padding:9px 12px}
      #${P} .tabs{padding:6px 8px;gap:4px}
      #${P} .tab{padding:5px 8px;font-size:10px}
      #${P} .bd{padding:10px 12px}
      #${P} .sts{gap:6px}
      #${P} .st b{font-size:18px}
      #${P} .mh{align-items:flex-start}
      #${P} .fr{flex-direction:column;align-items:stretch}
      #${P} .fr input,#${P} .fr select{width:100%;min-width:0}
      #${P} .ma{flex-direction:column}
      #${P} .ma .btn{width:100%;text-align:center}
    }
    @media(max-width:480px){
      #${P}{padding:max(env(safe-area-inset-top),6px) 0 max(env(safe-area-inset-bottom),6px) 0}
      #${P} .card{border-radius:8px;max-height:calc(100dvh - max(12px, env(safe-area-inset-top) + env(safe-area-inset-bottom)));margin:auto 4px}
      #${P} .hd{padding:8px 10px}
      #${P} .tabs{padding:5px 6px}
      #${P} .bd{padding:8px 10px}
      #${P} .tab{flex:1 1 calc(50% - 4px);text-align:center}
      #${P} .mh{flex-direction:column}
      #${P} .bp{align-self:flex-start}
    }
  `;
  document.head.appendChild(st);

  // ===== DOM =====
  const root=document.createElement('div');root.id=P;
  root.innerHTML=`
    <div class="mask"></div>
    <div class="card">
      <div class="hd"><h3>Memory Pilot</h3><button class="cls" id="mp_cls">&times;</button></div>
      <div class="tabs">
        <button class="tab on" data-t="list">记忆列表</button>
        <button class="tab" data-t="add">编辑</button>
        <button class="tab" data-t="xb">XB事件 <span class="badge">${xbEvents.length}</span></button>
        <button class="tab" data-t="batch">分析</button>
                <button class="tab" data-t="cfg">过滤</button>
      </div>
      <div class="bd">
        <div class="pg on" id="mp_pg_list">
          <div class="sts">
            <div class="st"><b id="mp_n1">0</b><small>总计</small></div>
            <div class="st"><b id="mp_n2">0</b><small>置顶</small></div>
            <div class="st"><b id="mp_n4">0</b><small>低</small></div>
            <div class="st"><b id="mp_n3">0</b><small>XB</small></div>
          </div>
          <div class="fr" style="margin-bottom:8px">
            <button class="btn" id="mp_sel_xb">全选XB</button>
            <button class="btn" id="mp_sel_xbnr">选择未重构XB</button>
            <button class="btn" id="mp_sel_none">清空选择</button>
            <button class="btn bp1" id="mp_rebuild_sel">批量重构关键词</button>
            <button class="btn" id="mp_grp_create" style="background:rgba(251,191,36,0.15);border-color:rgba(251,191,36,0.3);color:#fbbf24">建组</button>
            <button class="btn" id="mp_grp_addto" style="background:rgba(251,191,36,0.1);border-color:rgba(251,191,36,0.2);color:#fbbf24">加入已有组</button>
            <button class="btn" id="mp_grp_manage" style="background:rgba(251,191,36,0.06);border-color:rgba(251,191,36,0.15);color:#d4a017">管理事件组</button>
          </div>
          <div class="ht" id="mp_sel_info" style="margin-bottom:6px">已选 0 条记忆</div><div style="display:flex;gap:5px;margin-bottom:8px;flex-wrap:wrap"><button class="btn bp1" id="mp_merge_sel">合并选中事件</button><select id="mp_merge_kw_mode" style="padding:5px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);color:#ddd;font-size:11px"><option value="default">关键词：默认合并</option><option value="ai">关键词：AI重构</option></select><label style="display:flex;align-items:center;gap:4px;color:#aaa;font-size:11px;white-space:nowrap"><input type="checkbox" id="mp_merge_ctx" checked>关联原文</label></div><div class="opline" id="mp_merge_status"></div><details class="det" style="margin-bottom:8px"><summary>事件合并 Prompt（可编辑，共用分析 API）</summary><textarea id="mp_mpr" style="width:100%;min-height:120px;margin-top:6px">${h(loadMergePrompt())}</textarea><div style="display:flex;gap:5px;margin-top:5px"><button class="btn" id="mp_mps">保存</button><button class="btn bd1" id="mp_mpd">恢复默认</button></div><div class="ht" style="margin-top:6px">合并选中记忆时使用。{{memories}} 替换为记忆信息，{{context}} 替换为楼层原文。</div></details><div class="opline" id="mp_kw_status"></div>
          <details class="det" style="margin-bottom:8px">
            <summary>关键词重构 Prompt（可编辑，共用分析 API）</summary>
            <textarea id="mp_kpr" style="width:100%;min-height:120px;margin-top:6px">${h(loadKwPrompt())}</textarea>
            <div style="display:flex;gap:5px;margin-top:5px">
              <button class="btn" id="mp_kps">保存</button>
              <button class="btn bd1" id="mp_kpd">恢复默认</button>
            </div>
            <div class="ht" style="margin-top:6px">对记忆列表中勾选的所有条目生效；调用与“分析”页相同的 API 配置。</div>
          </details>
          <div class="fr" style="margin-bottom:8px;gap:4px">
            <button class="ftab on" data-mf="all" id="mp_f_all">全部</button>
            <button class="ftab" data-mf="high" id="mp_f_high">置顶</button>
            <button class="ftab" data-mf="medium" id="mp_f_med">普通</button>
            <button class="ftab" data-mf="low" id="mp_f_low">低</button>
            <button class="ftab" data-mf="xb_norecon" id="mp_f_xbnr">未重构XB</button>
            <input id="mp_f_search" placeholder="搜索事件名/摘要…" style="flex:1;min-width:80px;padding:5px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.3);color:#eee;font-size:11px">
            <select id="mp_f_sort" style="padding:5px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.3);color:#eee;font-size:10px"><option value="default">默认排序</option><option value="time_asc">时间↑</option><option value="time_desc">时间↓</option><option value="floor_asc">楼层↑</option><option value="floor_desc">楼层↓</option></select>
          </div>
          <div id="mp_list"></div>
        </div>
        <div class="pg" id="mp_pg_add">
          <div class="fg"><label>事件名</label><input id="mp_fe"></div>
          <div class="fg"><label>主关键词（逗号分隔，参与召回）</label><input id="mp_fpk" placeholder="事件名,地点,物品,核心动作"></div>
          <div class="fg"><label>门控关键词（逗号分隔，参与门控）</label><input id="mp_fsk" placeholder="冲突点,结果,态度,补充场景词"></div>
          <div class="fg"><label>人物关键词（逗号分隔，仅展示不召回）</label><input id="mp_fek" placeholder="人物名"></div>
          <div class="fg"><label>时间标签</label><input id="mp_ft" placeholder="例如：UC0087/07/10 10:57 / 当晚 / 第120-138层"></div>
          <div class="fg"><label>时间值（分钟，可空）</label><input id="mp_ftv" placeholder="例如 657"></div>
          <div class="fg"><label>楼层范围（例如 120-138，可空）</label><input id="mp_ffr" placeholder="120-138"></div>
          <div class="fg"><label>自定义 α（可空，0~0.95）</label><input id="mp_fa" type="number" min="0" max="0.95" step="0.01" placeholder="为空则使用全局默认 0.72"></div>
          <div class="fg"><label>所属事件组</label>
            <div id="mp_fgrp_tags" style="display:flex;flex-wrap:wrap;gap:4px;min-height:22px"></div>
            <div class="ht">在「记忆列表」中勾选多条记忆 → 点「建组」来管理事件组</div>
          </div>
          <div class="fg"><label>摘要</label><textarea id="mp_fs"></textarea></div>
          <div class="fg"><label>优先级</label><select id="mp_fp"><option value="high">置顶（每轮注入）</option><option value="medium" selected>普通（关键词触发）</option><option value="low">低（保底槽位）</option></select></div>
          <div class="ht" style="margin-bottom:10px">participants / entityKeywords 不参与 recall；timeValue 请使用 RP 故事内时间，不要写现实消息时间戳</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn" id="mp_fundo" style="flex:1;padding:9px;font-size:13px">撤回修改</button><button class="btn bd1" id="mp_fcancel" style="flex:1;padding:9px;font-size:13px">取消</button><button class="btn bp1" id="mp_sv" style="flex:1;padding:9px;font-size:13px">保存</button></div>
        </div>
        <div class="pg" id="mp_pg_xb">
          <div id="mp_xst"></div>
          <div class="fr">
            <input id="mp_xs" placeholder="搜索事件名/摘要/人物…">
            <select id="mp_xty"><option value="">类型</option><option>相遇</option><option>冲突</option><option>揭示</option><option>抉择</option><option>羁绊</option><option>转变</option><option>收束</option><option>日常</option></select>
            <select id="mp_xwt"><option value="">权重</option><option>核心</option><option>主线</option><option>转折</option><option>点睛</option><option>氛围</option></select>
            <span class="ht" id="mp_xcount"></span>

          </div>
          <div id="mp_xl" style="scroll-behavior:smooth"></div>
        </div>
        <div class="pg" id="mp_pg_batch">
          <div class="fg">
            <label>选择楼层 <span class="ht">(共${chat.length}层)</span></label>
            <input id="mp_bf" placeholder="最近20 或 5-30, 45-60" value="最近20">
          </div>
          <div class="fg">
            <label>关键词搜索楼层（空格分隔多词）</label>
            <div style="display:flex;gap:5px">
              <input id="mp_bk" placeholder="如: 击剑 银星" style="flex:1">
              <button class="btn" id="mp_bkb">搜索</button>
              <button class="btn" id="mp_bkc">清空</button>
            </div>
          </div>
          <div id="mp_search_view"><div id="mp_bkr"></div><div class="opline" id="mp_bk_status"></div><div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0"><button class="btn" id="mp_bk_fill_sel">填入勾选楼层</button><button class="btn" id="mp_bk_fill_rng">按连续区间填入</button><button class="btn" id="mp_bk_pick_all">全选结果</button><button class="btn bd1" id="mp_bk_pick_none">清空勾选</button></div><div class="fg" style="margin-top:8px"><label>上下文半径 <span id="mp_bctxr_val" class="ht">±6层</span></label><input id="mp_bctxr" type="range" min="1" max="30" value="6" style="width:100%"></div></div><div id="mp_context_view" style="display:none"><div id="mp_bctx" class="ctxbox" style="max-height:56dvh;min-height:260px;overflow:auto;overscroll-behavior:contain;resize:vertical"><div class="tiny">点击搜索结果中的“查看上下文”或勾选结果后，可在这里查看附近上下文并批量选楼层。</div></div>
</div>
          <details class="det">
            <summary>总结 Prompt（可编辑，支持多版本）</summary>
            <div style="display:flex;gap:5px;margin:6px 0;align-items:center;flex-wrap:wrap">
              <select id="mp_bpr_slot" style="padding:5px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);color:#ddd;font-size:11px"><option value="0">默认版本</option></select>
              <button class="btn" id="mp_bpr_newslot" style="font-size:10px;padding:3px 8px">新建版本</button>
              <button class="btn bd1" id="mp_bpr_delslot" style="font-size:10px;padding:3px 8px">删除当前版本</button>
            </div>
            <textarea id="mp_bpr" style="width:100%;min-height:120px">${h(loadPrompt())}</textarea>
            <div style="display:flex;gap:5px;margin-top:5px">
              <button class="btn" id="mp_bps">保存</button>
              <button class="btn bd1" id="mp_bpd">恢复默认</button>
            </div>
          </details>
          <button class="btn bp1" id="mp_brun" style="width:100%;padding:9px;font-size:13px;margin-top:9px">开始分析</button>
          <div id="mp_br" style="margin-top:9px"></div>
          <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06)">
            <div class="fg"><label style="font-size:12px;color:#fbbf24;font-weight:600">🔄 自动总结进度</label></div>
            <div id="mp_auto_progress" class="ht" style="margin-bottom:6px">加载中…</div>
            <div id="mp_auto_history"></div>
          </div>
        </div>
        <div class="pg" id="mp_pg_cfg">
          <div class="fg"><label>召回周期（回合）</label><input id="mp_revery" type="number" min="1" max="50" value="${h(String(loadRecallCfg().every))}"></div>
          <div class="fg" style="margin-top:12px"><label>距离衰减系数 α（0~0.95）</label><input id="mp_ralpha" type="number" min="0" max="0.95" step="0.01" value="${h(String(loadRecallCfg().alpha))}"></div>
          <div class="fg" style="margin-top:12px"><label>最大召回条数（Top N）</label><input id="mp_rmaxn" type="number" min="1" max="20" value="${h(String(loadRecallCfg().maxRecall||6))}"></div>
          <div class="fg" style="margin-top:12px"><label>上下文窗口（匹配最近 N 条）</label><input id="mp_rctxwin" type="number" min="3" max="30" value="${h(String(loadRecallCfg().contextWindow||8))}"></div>
          <div class="fg" style="margin-top:12px"><label>粘性保持（命中后维持 N 轮）</label><input id="mp_rsticky" type="number" min="0" max="20" value="${h(String(loadRecallCfg().stickyTurns??5))}"></div>
          <div style="margin-top:14px;padding:10px 12px;background:rgba(251,191,36,0.06);border:1px solid rgba(251,191,36,0.15);border-radius:8px;margin-bottom:10px">
            <label style="display:flex;align-items:center;gap:8px;color:#fbbf24;font-size:12px;font-weight:500;cursor:pointer">
              <input type="checkbox" id="mp_rgrp" ${loadRecallCfg().groupRecall!==false?'checked':''} style="width:16px;height:16px">
              📎 事件组连带召回
            </label>
            <div class="ht" style="margin-top:4px;color:#a3a3a3">开启后，当某条记忆被关键词召回时，同组的其他记忆会按评分排序填充剩余槽位。<br>在「记忆列表」中勾选多条记忆 → 点「建组」来创建事件组。</div>
          </div>
          <div class="ht" style="margin-bottom:10px">正式召回与正式写入都按每 N 回合执行；匹配窗口参考最近 N 回合原文。规则为：主关键词至少命中 1 个才入候选；若配置了门控关键词，则还必须至少命中 1 个门控关键词；通过后再进入距离衰减概率。这里的 α 是默认基准，单条记忆可在编辑页自定义覆盖。</div>
          <button class="btn bp1" id="mp_rssv" style="width:100%;padding:9px;font-size:13px;margin-bottom:14px">保存召回设置</button>
          <div class="fg"><label>关键词黑名单（逗号或换行分隔）</label><textarea id="mp_bl" style="min-height:100px">${h(loadBlacklist().join('\n'))}</textarea></div>
          <div class="ht" style="margin-bottom:10px">黑名单只作用于 keywords，不影响 entityKeywords 展示。适合放人物名、常见称呼、容易误触发的泛词。</div>
          <button class="btn bp1" id="mp_blsv" style="width:100%;padding:9px;font-size:13px">保存关键词黑名单</button>
          <div class="fg" style="margin-top:14px"><label>块级筛除标签（每行一个，不区分大小写）</label><textarea id="mp_ctags" style="min-height:90px">${h(loadCleaner().blockTags.join('\n'))}</textarea></div>
          <div class="ht" style="margin-bottom:8px">会整段删除 &lt;tag&gt;...&lt;/tag&gt;，适合 think、details、meta、ooc 这类结构层内容。</div>
          <div class="fg"><label>行级筛除前缀（每行一个）</label><textarea id="mp_cprefix" style="min-height:80px">${h(loadCleaner().linePrefixes.join('\n'))}</textarea></div>
          <div class="ht" style="margin-bottom:8px">适合 affinity_change:、state_update: 这种单行元信息。</div>
          <div class="fg"><label>正则筛除规则（每行一个）</label><textarea id="mp_cregex" style="min-height:80px">${h(loadCleaner().regexRules.join('\n'))}</textarea></div>
          <div class="ht" style="margin-bottom:10px">用于删掉分隔线或特殊占位符，例如 ^____+$ 。</div>
          <div class="fg">
            <label>作用范围</label>
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:6px">
              <label style="display:flex;align-items:center;gap:6px;color:#ccc"><input type="checkbox" id="mp_c_recall" ${loadCleaner().cleanForRecall ? 'checked' : ''}>召回匹配前清洗</label>
              <label style="display:flex;align-items:center;gap:6px;color:#ccc"><input type="checkbox" id="mp_c_batch" ${loadCleaner().cleanForBatch ? 'checked' : ''}>批量分析前清洗</label>
            </div>
          </div>
          <button class="btn bp1" id="mp_clsv" style="width:100%;padding:9px;font-size:13px">保存文本清洗规则</button>
          <div style="margin-top:18px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.08)">
            <div class="fg"><label style="font-size:13px;color:#fff;font-weight:600">旧版数据自检 / 清理</label></div>
            <div class="ht" id="mp_cleanup_summary" style="margin-bottom:8px">正在检测当前聊天中的旧版 MP / LWB 快照痕迹…</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn" id="mp_cleanup_refresh" style="flex:1;padding:9px;font-size:13px">刷新检测</button>
              <button class="btn" id="mp_cleanup_mp" style="flex:1;padding:9px;font-size:13px">清理旧 MP 痕迹</button>
              <button class="btn bd1" id="mp_cleanup_lwb" style="flex:1;padding:9px;font-size:13px">清理 LWB 快照中的 MP 痕迹</button>
            </div>
            <div class="ht" id="mp_cleanup_status" style="margin-top:6px"></div>
          </div>
          <div style="margin-top:18px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.08)">
            <div class="fg"><label style="font-size:13px;color:#fff;font-weight:600">记忆数据 导出 / 导入</label></div>
            <div class="ht" style="margin-bottom:10px">导出包含：全部记忆、召回设置、关键词黑名单、文本清洗规则、API 配置、Prompt 模板。可在不同酒馆环境间迁移。</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn bp1" id="mp_export" style="flex:1;padding:9px;font-size:13px">导出 MP 数据</button>
              <button class="btn" id="mp_import" style="flex:1;padding:9px;font-size:13px">导入 MP 数据</button>
              <input type="file" id="mp_import_file" accept=".json" style="display:none">
            </div>
            <div class="ht" id="mp_io_status" style="margin-top:6px"></div>
          </div>
        </div>
      </div>
      <button class="mp-top-btn" id="mp_gotop" title="回到顶部" style="bottom:58px">↑</button>
      <button class="mp-top-btn" id="mp_gobot" title="到底部">↓</button>
    </div>
  `;
  document.body.appendChild(root);

  // Floating top/bottom buttons
  const _bd = root.querySelector('.bd');
  const _topBtn = $('mp_gotop');
  const _botBtn = $('mp_gobot');
  if (_bd && _topBtn && _botBtn) {
    const _updateFloatBtns = () => {
      const atTop = _bd.scrollTop < 80;
      const atBot = _bd.scrollTop + _bd.clientHeight >= _bd.scrollHeight - 80;
      _topBtn.classList.toggle('vis', !atTop);
      _botBtn.classList.toggle('vis', !atBot);
    };
    _bd.addEventListener('scroll', _updateFloatBtns);
    setTimeout(_updateFloatBtns, 200);
    _topBtn.onclick = () => { _bd.scrollTop = 0; };
    _botBtn.onclick = () => { _bd.scrollTop = _bd.scrollHeight; };
  }

  let selectedIds = new Set();
  let searchPicked = new Set();
  let lastSearchResults = [];
  let kwAbort = null;
  let kwRunning = false;
  let kwRunningId = null;

  let _listFilter = 'all';
  let _listSearch = '';
  let _listSort = 'default'; // 'default' | 'time_asc' | 'time_desc' | 'floor_asc' | 'floor_desc'
  const renderList=()=>{
    memories = dedupeMemories(loadMem());
    $('mp_n1').textContent=memories.length;
    $('mp_n2').textContent=memories.filter(m=>m.priority==='high').length;
    $('mp_n4').textContent=memories.filter(m=>m.priority==='low').length;
    $('mp_n3').textContent=memories.filter(m=>m.source==='xb_event').length;
    const c=$('mp_list');
    if(!memories.length){c.innerHTML='<div class="emp">暂无记忆</div>';return;}
    let filtered = memories;
    if (_listFilter === 'high') filtered = memories.filter(m => m.priority === 'high');
    else if (_listFilter === 'medium') filtered = memories.filter(m => m.priority === 'medium' || (!m.priority));
    else if (_listFilter === 'low') filtered = memories.filter(m => m.priority === 'low');
    else if (_listFilter === 'xb_norecon') filtered = memories.filter(m => m.source === 'xb_event' && m.keywordSource !== 'xb_llm');
    if (_listSearch) {
      const q = _listSearch.toLowerCase();
      filtered = filtered.filter(m => (m.event||'').toLowerCase().includes(q) || (m.summary||'').toLowerCase().includes(q) || (m.primaryKeywords||[]).join(' ').toLowerCase().includes(q));
    }
    if(!filtered.length){c.innerHTML='<div class="emp">无匹配记忆（共 '+memories.length+' 条）</div>';return;}
    // Build group membership map for display
    const _grpData = loadGroups();
    // Sort
    if (_listSort !== 'default') {
      filtered = [...filtered];
      const getTimeVal = m => Number.isFinite(Number(m.timeValue)) ? Number(m.timeValue) : (parseTimeValue(m.timeLabel) ?? Infinity);
      const getFloorVal = m => Array.isArray(m.floorRange) ? m.floorRange[0] : Infinity;
      if (_listSort === 'time_asc') filtered.sort((a,b) => getTimeVal(a) - getTimeVal(b));
      else if (_listSort === 'time_desc') filtered.sort((a,b) => getTimeVal(b) - getTimeVal(a));
      else if (_listSort === 'floor_asc') filtered.sort((a,b) => getFloorVal(a) - getFloorVal(b));
      else if (_listSort === 'floor_desc') filtered.sort((a,b) => getFloorVal(b) - getFloorVal(a));
    }
    c.innerHTML=filtered.map(m=>{
      const pin=m.priority==='high'?'[置顶] ':'';
      const src=m.source==='xb_event'?'<span class="kw kx">XB</span>':(m.source==='batch'?'<span class="kw kx">BATCH</span>':(m.source==='merged'?'<span class="kw kx">MERGED</span>':''));
      const pc=m.priority==='high'?'bph':m.priority==='medium'?'bpm':'bpl';
      const pl=m.priority==='high'?'置顶':m.priority==='medium'?'普通':'低';
      const floorText = formatFloorSegments(m);
      const time = (m.timeLabel || floorText) ? `<div class="ht">${h(m.timeLabel || '')}${floorText ? ' | ' + floorText : ''}</div>` : '';
      const pkw = (m.primaryKeywords || m.keywords || []).map(k=>'<span class="kw">'+h(k)+'</span>').join('');
      const skw = (m.secondaryKeywords || []).map(k=>'<span class="kw kx">'+h(k)+'</span>').join('');
      const ent = (m.entityKeywords||[]).map(k=>'<span class="kw ke">'+h(k)+'</span>').join('');
      const canRebuild = true;
      const pick = `<label class="ht" style="display:flex;align-items:center;gap:6px"><input type="checkbox" class="mp_pick" data-id="${h(m.id)}" ${selectedIds.has(m.id)?'checked':''}>选择</label>`;
      const rebuildBtn = `<button class="btn bp1" onclick="window._mpKR('${m.id}')">${kwRunning && kwRunningId===m.id ? '中止重构' : '优化关键词'}</button>`;
      const memGrps = Object.keys(_grpData).filter(g => (_grpData[g]||[]).includes(m.id));
      const grpBadge = memGrps.length ? memGrps.map(g => '<span class="kw" style="background:rgba(251,191,36,0.15);color:#fbbf24">📎'+h(g)+'</span>').join('') : '';
      return `<div class="mi" id="mp_mem_${h(m.id)}"><div class="mh"><span class="me" style="cursor:pointer" onclick="window._mpLocate('${h(m.id)}')" title="点击定位">${pin}${h(m.event)}</span><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${pick}<span class="bp ${pc}">${pl}</span></div></div>${time}<div class="ms">${h(m.summary)}</div><div class="kr">${src}${grpBadge}${pkw}${skw}${ent}</div><div class="ma">${rebuildBtn}<button class="btn" onclick="window._mpE('${m.id}')">编辑</button><button class="btn bd1" onclick="window._mpD('${m.id}')">删除</button></div></div>`;
    }).join('');
    $('mp_sel_info').textContent = `已选 ${selectedIds.size} 条记忆`;
    c.querySelectorAll('.mp_pick').forEach(el=>{
      el.onchange = () => {
        const id = el.getAttribute('data-id');
        if (!id) return;
        if (el.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        $('mp_sel_info').textContent = `已选 ${selectedIds.size} 条记忆`;
      };
    });
  };

  const renderXb=()=>{
    const st=$('mp_xst');
    if(!xbEvents.length){
      let w='未知';try{const cm=ctx.chatMetadata;if(!cm)w='chatMetadata空';else if(!cm.extensions)w='extensions无';else if(!cm.extensions.LittleWhiteBox)w='LWB数据无';else w='events空';}catch(e){w=e.message;}
      st.innerHTML=`<div class="ht" style="color:#fbbf24">${w}</div>`;
      $('mp_xl').innerHTML='<div class="emp">请先在LittleWhiteBox生成总结</div>';return;
    }
    st.innerHTML=`<div class="ht" style="color:#4ade80">${xbEvents.length} 个事件</div>`;
    const fl=($('mp_xs')?.value||'').toLowerCase(),tf=$('mp_xty')?.value||'',wf=$('mp_xwt')?.value||'';
    const filtered=xbEvents.filter(e=>{if(tf&&e.type!==tf)return false;if(wf&&e.weight!==wf)return false;if(fl&&![e.title,e.summary,...(e.participants||[])].join(' ').toLowerCase().includes(fl))return false;return true;});
    if(!filtered.length){$('mp_xl').innerHTML='<div class="emp">无匹配</div>';return;}
    const done=new Set(memories.filter(m=>m.xbEventId).map(m=>String(m.xbEventId)));
    $('mp_xl').innerHTML=filtered.map(e=>{
      const d=done.has(String(e.id));
      const fr=deriveFloorRangeFromXB(e);
      const frLabel=Array.isArray(fr)?` | #${fr[0]}-${fr[1]}`:'';
      return `<div class="xi" id="mp_xb_${h(e.id)}"><div class="mh"><span class="xt" style="cursor:pointer;text-decoration:underline dotted rgba(196,181,253,0.4)" onclick="window._mpXLocate('${h(e.id)}')" title="点击定位到全量列表中的位置">${h(e.title)}</span><span class="ht">${h(e.type||'')} ${h(e.weight||'')}</span></div><div class="ht">${h(e.timeLabel||'')} | ${h(e.id)}${h(frLabel)}</div><div class="ms">${h(e.summary)}</div><div class="xp">${(e.participants||[]).map(p=>h(p)).join(', ')||'—'}</div><div class="ma">${d?`<span class="ht" style="margin-right:6px">已导入</span><button class="btn bp1" onclick="window._mpXI('${h(e.id)}','high')">改为置顶</button><button class="btn bp1" onclick="window._mpXI('${h(e.id)}','medium')">改为普通</button><button class="btn" onclick="window._mpXI('${h(e.id)}','low')">改为低</button><button class="btn bd1" onclick="window._mpD_xb('${h(e.id)}')">移除</button>`:`<button class="btn bp1" onclick="window._mpXI('${h(e.id)}','high')">置顶导入</button><button class="btn bp1" onclick="window._mpXI('${h(e.id)}','medium')">普通导入</button><button class="btn" onclick="window._mpXI('${h(e.id)}','low')">低导入</button>`}</div></div>`;
    }).join('');
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
      keywordSource: 'xb_llm',
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
      return `<div class="rc"><div class="me">${isPinned ? '[置顶] ' : ''}${h(m.event || '(无事件名)')}${delBtn}</div><div class="ms">${h(m.summary || '')}</div>${showReason && m._reason ? `<div class="rl">${h(m._reason)}</div>` : ''}</div>`;
    };
    let html = `<div class="ht" style="margin-bottom:6px;color:${tone}">${h(title)}</div>`;
    if (pinned.length) {
      html += '<div class="ht" style="margin-bottom:6px;color:#f87171">置顶记忆</div>';
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

  renderList();renderXb();

  // ===== Event Group Management =====
  // GK, loadGroups, saveGroups, getMemGroups defined above (line ~203)

  const _grpState = { names: [] };
  const _grpRenderTags = () => {
    const container = $('mp_fgrp_tags'); if (!container) return;
    container.innerHTML = _grpState.names.map(g =>
      `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(251,191,36,0.15);color:#fbbf24;padding:2px 8px;border-radius:4px;font-size:11px">${h(g)}<span style="cursor:pointer;color:#f87171;font-weight:bold" data-rmgrp="${h(g)}">&times;</span></span>`
    ).join('');
    container.querySelectorAll('[data-rmgrp]').forEach(el => {
      el.onclick = () => { _grpState.names = _grpState.names.filter(x => x !== el.getAttribute('data-rmgrp')); _grpRenderTags(); };
    });
  };
  const _grpSetNames = (names) => { _grpState.names = [...new Set((names||[]).filter(Boolean))]; _grpRenderTags(); };
  const _grpAddName = (name) => { const n = (name||'').trim(); if (!n || _grpState.names.includes(n)) return; _grpState.names.push(n); _grpRenderTags(); };

  // Group create/addto buttons (on list page)
  $('mp_grp_create')?.addEventListener('click', async () => {
    const ids = [...selectedIds];
    if (ids.length < 2) { toastr?.warning?.('请至少选择 2 条记忆来建组'); return; }
    const groups = loadGroups();
    const gid_grp = 'G' + Math.random().toString(36).slice(2,8).toUpperCase();
    const name = prompt('事件组名称（可选，留空自动生成）：', gid_grp);
    if (name === null) return;
    const gn = (name || '').trim() || gid_grp;
    if (groups[gn]) { toastr?.warning?.('组名已存在：' + gn); return; }
    groups[gn] = ids;
    await saveGroups(groups);
    selectedIds = new Set();
    renderList();
    toastr?.success?.('已创建事件组「' + gn + '」，包含 ' + ids.length + ' 条记忆');
  });
  $('mp_grp_addto')?.addEventListener('click', async () => {
    const ids = [...selectedIds];
    if (!ids.length) { toastr?.warning?.('请先勾选记忆'); return; }
    const groups = loadGroups();
    const names = Object.keys(groups);
    if (!names.length) { toastr?.warning?.('暂无事件组，请先建组'); return; }
    const choice = prompt('输入要加入的事件组名称：\n\n已有组：' + names.map(g => g + '(' + groups[g].length + ')').join(', '));
    if (!choice || !choice.trim()) return;
    const gn = choice.trim();
    if (!groups[gn]) { groups[gn] = []; }
    let added = 0;
    for (const id of ids) { if (!groups[gn].includes(id)) { groups[gn].push(id); added++; } }
    await saveGroups(groups);
    selectedIds = new Set();
    renderList();
    toastr?.success?.('已将 ' + added + ' 条记忆加入事件组「' + gn + '」');
  });

  // Event group management overlay
  $('mp_grp_manage')?.addEventListener('click', () => {
    const groups = loadGroups();
    const gnames = Object.keys(groups);
    const listEl = $('mp_list');
    if (!listEl) return;
    const oldContent = listEl.innerHTML;
    const renderGrpPage = () => {
      const grps = loadGroups();
      const gns = Object.keys(grps);
      let html = '<div style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center"><b style="color:#fbbf24;font-size:13px">📎 事件组管理</b><button class="btn" id="mp_grp_back">← 返回记忆列表</button></div>';
      if (!gns.length) {
        html += '<div class="emp">暂无事件组。在记忆列表中勾选多条记忆，点「建组」创建。</div>';
      } else {
        for (const gn of gns) {
          const mids = grps[gn] || [];
          const mems = mids.map(id => memories.find(m => m.id === id)).filter(Boolean);
          html += '<div class="mi" style="border-color:rgba(251,191,36,0.2)">';
          html += '<div class="mh"><span class="me" style="color:#fbbf24">📎 ' + h(gn) + '</span><span class="ht">' + mems.length + ' 条记忆</span></div>';
          html += '<div style="margin:6px 0">';
          for (const m of mems) {
            html += '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.03)">';
            html += '<span class="ms" style="flex:1;margin:0">' + h(m.event || m.id) + '</span>';
            html += '<button class="btn bd1 _grm_rm" data-gn="' + h(gn) + '" data-mid="' + h(m.id) + '" style="padding:2px 8px;font-size:10px">移出</button>';
            html += '</div>';
          }
          html += '</div>';
          html += '<div class="ma"><button class="btn bd1 _grm_del" data-gn="' + h(gn) + '" style="font-size:11px">删除整组</button><button class="btn _grm_ren" data-gn="' + h(gn) + '" style="font-size:11px">重命名</button></div>';
          html += '</div>';
        }
      }
      listEl.innerHTML = html;
      // Bind
      $('mp_grp_back')?.addEventListener('click', () => { renderList(); });
      listEl.querySelectorAll('._grm_rm').forEach(el => {
        el.onclick = async () => {
          const gn = el.getAttribute('data-gn'), mid = el.getAttribute('data-mid');
          const grps = loadGroups();
          if (grps[gn]) { grps[gn] = grps[gn].filter(x => x !== mid); if (!grps[gn].length) delete grps[gn]; }
          await saveGroups(grps);
          renderGrpPage();
          toastr?.success?.('已移出');
        };
      });
      listEl.querySelectorAll('._grm_del').forEach(el => {
        el.onclick = async () => {
          const gn = el.getAttribute('data-gn');
          if (!confirm('删除事件组「' + gn + '」？（不会删除记忆本身）')) return;
          const grps = loadGroups();
          delete grps[gn];
          await saveGroups(grps);
          renderGrpPage();
          toastr?.success?.('已删除');
        };
      });
      listEl.querySelectorAll('._grm_ren').forEach(el => {
        el.onclick = async () => {
          const oldName = el.getAttribute('data-gn');
          const newName = prompt('新组名：', oldName);
          if (!newName || !newName.trim() || newName.trim() === oldName) return;
          const grps = loadGroups();
          if (grps[newName.trim()]) { toastr?.warning?.('组名已存在'); return; }
          grps[newName.trim()] = grps[oldName];
          delete grps[oldName];
          await saveGroups(grps);
          renderGrpPage();
          toastr?.success?.('已重命名');
        };
      });
    };
    renderGrpPage();
  });
  // Filter listeners
  root.querySelectorAll('[data-mf]').forEach(btn => {
    btn.onclick = () => {
      root.querySelectorAll('.ftab').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      _listFilter = btn.getAttribute('data-mf');
      renderList();
    };
  });
  $('mp_f_search').oninput = () => { _listSearch = $('mp_f_search').value.trim(); renderList(); };
  $('mp_f_sort').onchange = () => { _listSort = $('mp_f_sort').value; renderList(); };

  const close=()=>{
    if(_abort || kwRunning){
      const panel=$(P);
      if(panel) panel.style.display='none';
      toastr?.info?.('操作仍在后台运行，完成后可重新打开面板查看结果');
      return;
    }
    $(P)?.remove();$(S)?.remove();
  };
  $('mp_cls').onclick=close;
  root.querySelector('.mask').onclick=close;

  root.querySelectorAll('.tab').forEach(t=>{t.onclick=()=>{
    root.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));
    root.querySelectorAll('.pg').forEach(x=>x.classList.remove('on'));
    t.classList.add('on');$('mp_pg_'+t.dataset.t)?.classList.add('on');
    if(t.dataset.t==='add'&&!editId){$('mp_fe').value='';$('mp_fpk').value='';$('mp_fsk').value='';$('mp_fek').value='';$('mp_ft').value='';$('mp_ftv').value='';$('mp_ffr').value='';$('mp_fs').value='';$('mp_fp').value='medium';}
  };});

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
      const currentId = editId || gid();
      if(editId){
        const old = memories.find(m=>m.id===editId);
        const next = { ...(old || {}), ...patch, id: editId };
        memories = upsertMemory(memories, next);
        editId=null;
      } else {
        memories = upsertMemory(memories, {id:currentId,...patch,source:'manual',timestamp:Date.now()});
      }
      // Sync event groups
      const groups = loadGroups();
      // Remove this memory from groups it's no longer in
      for (const gn of Object.keys(groups)) {
        const idx = (groups[gn]||[]).indexOf(currentId);
        if (idx >= 0 && !_grpState.names.includes(gn)) { groups[gn].splice(idx, 1); if (!groups[gn].length) delete groups[gn]; }
      }
      // Add this memory to its groups
      for (const gn of _grpState.names) {
        if (!groups[gn]) groups[gn] = [];
        if (!groups[gn].includes(currentId)) groups[gn].push(currentId);
      }
      await saveGroups(groups);
      await saveMem(memories);
      renderList();
      renderXb();
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
    _editUndo={event:m.event||'',primaryKeywords:(m.primaryKeywords||m.keywords||[]).join(', '),secondaryKeywords:(m.secondaryKeywords||[]).join(', '),entityKeywords:(m.entityKeywords||[]).join(', '),timeLabel:m.timeLabel||'',timeValue:Number.isFinite(Number(m.timeValue))?String(m.timeValue):'',floorRange:Array.isArray(m.floorRange)?`${m.floorRange[0]}-${m.floorRange[1]}`:'',alpha:Number.isFinite(Number(m.alpha))?String(m.alpha):'',groupNames:getMemGroups(m.id),summary:m.summary||'',priority:m.priority||'medium'};
    $('mp_fe').value=m.event||'';
    $('mp_fpk').value=(m.primaryKeywords||m.keywords||[]).join(', ');
    $('mp_fsk').value=(m.secondaryKeywords||[]).join(', ');
    $('mp_fek').value=(m.entityKeywords||[]).join(', ');
    $('mp_ft').value=m.timeLabel||'';
    $('mp_ftv').value=Number.isFinite(Number(m.timeValue))?String(m.timeValue):'';
    $('mp_ffr').value=Array.isArray(m.floorRange)?`${m.floorRange[0]}-${m.floorRange[1]}`:'';
    $('mp_fa').value=Number.isFinite(Number(m.alpha))?String(m.alpha):'';
    _grpSetNames(getMemGroups(m.id));
    $('mp_fs').value=m.summary||'';
    $('mp_fp').value=m.priority||'medium';
    root.querySelector('.tab[data-t="add"]').click();
  };
  window._mpD=async id=>{
    if(!confirm('删除？'))return;
    await withLock('delete_'+id, async () => {
      memories=memories.filter(m=>m.id!==id);
      selectedIds.delete(id);
      await saveMem(memories);
      renderList();
      renderXb();
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
    _grpSetNames([]);
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
    _grpSetNames(_editUndo.groupNames || []);
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

  $('mp_xs').oninput=()=>{renderXb();const items=$('mp_xl')?.querySelectorAll('.xi');$('mp_xcount').textContent=items?.length?items.length+'条':'';};
  $('mp_xty').onchange=renderXb;$('mp_xwt').onchange=renderXb;


  // XB locate: clear search, show full list, scroll to target event
  window._mpXLocate=(eid)=>{
    $('mp_xs').value='';$('mp_xty').value='';$('mp_xwt').value='';
    renderXb();
    setTimeout(()=>{
      const el=$('mp_xb_'+eid);
      if(el){
        const bd=root.querySelector('.bd');
        if(bd){const br=bd.getBoundingClientRect();const er=el.getBoundingClientRect();bd.scrollTop+=er.top-br.top-80;}
        el.style.outline='2px solid #7c6bf0';el.style.transition='outline 0.3s';
        setTimeout(()=>{el.style.outline='';},2000);
      }
    },50);
  };

  // Memory list locate: clear filters, scroll to target memory
  window._mpLocate=(mid)=>{
    _listFilter='all';_listSearch='';_listSort='default';
    root.querySelectorAll('.ftab').forEach(b=>b.classList.remove('on'));
    root.querySelector('[data-mf="all"]')?.classList.add('on');
    if($('mp_f_search'))$('mp_f_search').value='';
    if($('mp_f_sort'))$('mp_f_sort').value='default';
    renderList();
    setTimeout(()=>{
      const el=$('mp_mem_'+mid);
      if(el){
        const bd=root.querySelector('.bd');
        if(bd){const br=bd.getBoundingClientRect();const er=el.getBoundingClientRect();bd.scrollTop+=er.top-br.top-80;}
        el.style.outline='2px solid #7c6bf0';el.style.transition='outline 0.3s';
        setTimeout(()=>{el.style.outline='';},2000);
      }
    },50);
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
    if(!kw){$('mp_bkr').innerHTML='';$('mp_bk_status').textContent='';renderSearchContext(null);return;}
    const results=searchFloors(kw);
    renderSearchResults(results);
  };
  $('mp_bkc').onclick=()=>{
    $('mp_bk').value='';
    $('mp_bkr').innerHTML='';
    $('mp_bk_status').textContent='';
    searchPicked = new Set();
    lastSearchResults = [];
    renderSearchContext(null);
  };
  $('mp_bk_fill_sel').onclick=()=>{
    const nums=[...searchPicked].map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
    if(!nums.length){toastr?.warning?.('请先勾选搜索结果或上下文楼层');return;}
    $('mp_bf').value = nums.join(', ');
    $('mp_bk_status').textContent = `已填入 ${nums.length} 层。`;
  };
  $('mp_bk_fill_rng').onclick=()=>{
    const nums=[...searchPicked].map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
    if(!nums.length){toastr?.warning?.('请先勾选搜索结果或上下文楼层');return;}
    $('mp_bf').value = compressNums(nums);
    $('mp_bk_status').textContent = `已按连续区间填入 ${nums.length} 层。`;
  };
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

  $('mp_merge_sel').onclick=async()=>{
    if(kwRunning && kwRunningId === '__merge__' && kwAbort){
      kwAbort.abort();
      $('mp_merge_status').textContent = '正在中止合并...';
      return;
    }
    if(kwRunning){toastr?.warning?.('有操作正在进行');return;}
    const ids = [...selectedIds];
    if(ids.length < 2){toastr?.warning?.('请至少选择 2 条记忆进行合并');return;}
    const mems = ids.map(id => memories.find(m => m.id === id)).filter(Boolean);
    if(mems.length < 2){toastr?.warning?.('有效记忆不足 2 条');return;}
    const priorities = new Set(mems.map(m => m.priority || 'medium'));
    if(priorities.size > 1){toastr?.warning?.('只能合并同优先级的记忆（当前选择了: ' + [...priorities].join(', ') + '）');return;}
    const prio = [...priorities][0];
    const kwMode = $('mp_merge_kw_mode')?.value || 'default';
    const hasFloor = mems.some(m => Array.isArray(m.floorRange) && m.floorRange.length >= 2);
    if(!hasFloor){ if(!confirm('选中的记忆都没有楼层范围信息，合并时将无法参考原文。是否继续？')) return; }
    const useCtx = !!$('mp_merge_ctx')?.checked;
    if(!confirm('将合并 ' + mems.length + ' 条 [' + prio + '] 记忆为 1 条。\n关键词模式：' + (kwMode === 'ai' ? 'AI重构' : '默认合并') + '\n关联原文：' + (useCtx ? '是' : '否') + '\n继续？')) return;
    kwAbort = new AbortController();
    kwRunning = true;
    kwRunningId = '__merge__';
    $('mp_merge_status').textContent = '正在合并...';
    $('mp_merge_sel').textContent = '中止合并';
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
        $('mp_merge_status').textContent = '正在AI重构关键词...';
        const kwRaw = await callLLM(kwPrompt, kwAbort.signal);
        const kwObj = extractFirstJsonObject(kwRaw);
        kws = kwObj ? { primaryKeywords: uniq((kwObj.primaryKeywords || []).map(k => String(k||'').trim()).filter(Boolean)).slice(0,8), secondaryKeywords: uniq((kwObj.secondaryKeywords || []).map(k => String(k||'').trim()).filter(Boolean)).slice(0,8), entityKeywords: uniq((kwObj.entityKeywords || obj.entityKeywords || []).map(k => String(k||'').trim()).filter(Boolean)).slice(0,8) } : mergeKeywordsDefault(mems);
      } else { kws = mergeKeywordsDefault(mems); }
      const merged = { id: gid(), event: obj.event, summary: obj.summary, timeLabel: obj.timeLabel || mems[0].timeLabel || '', timeValue: Number.isFinite(Number(obj.timeValue)) ? Number(obj.timeValue) : (mems[0].timeValue || null), floorRange: (Array.isArray(obj.floorRange) && obj.floorRange.length >= 2) ? obj.floorRange : mergeFloorRange(mems), floorSegments: collectFloorSegments(mems), priority: prio, ...kws, source: 'merged', mergedFrom: ids, timestamp: Date.now() };
      kwRunning = false; kwRunningId = null; kwAbort = null;
      $('mp_merge_sel').textContent = '合并选中事件';
      { const _p=$(P); if(_p && _p.style.display==='none') { _p.style.display=''; toastr?.success?.('合并分析完成，请确认预览结果'); } }
      const pkwH = (merged.primaryKeywords||[]).map(k=>'<span class="kw">'+h(k)+'</span>').join('');
      const skwH = (merged.secondaryKeywords||[]).map(k=>'<span class="kw kx">'+h(k)+'</span>').join('');
      const ekwH = (merged.entityKeywords||[]).map(k=>'<span class="kw ke">'+h(k)+'</span>').join('');
      const frH = formatFloorSegments(merged);
      $('mp_merge_status').innerHTML = '<div class="mi" style="border-color:rgba(124,107,240,0.4)"><div class="mh"><span class="me">'+h(merged.event)+'</span><span class="bp bpm">'+h(prio)+'</span></div>'+(merged.timeLabel?'<div class="ht">'+h(merged.timeLabel)+(frH?' | '+frH:'')+'</div>':'')+'<div class="ms">'+h(merged.summary)+'</div><div class="kr">'+pkwH+skwH+ekwH+'</div><div class="ma" style="margin-top:8px"><button class="btn bp1" id="mp_merge_confirm">确认合并</button><button class="btn" id="mp_merge_edit">编辑后确认</button><button class="btn bd1" id="mp_merge_cancel">放弃</button></div></div>';
      await savePendingOp('merge', { status:'done', message: merged.event, results: [merged] });
      window._mpMergePreview = { merged: merged, sourceIds: ids };
      const confirmBtn = document.getElementById('mp_merge_confirm');
      const editBtn = document.getElementById('mp_merge_edit');
      const cancelBtn = document.getElementById('mp_merge_cancel');
      // "编辑后确认": load merged data into edit form
      if (editBtn) {
        editBtn.addEventListener('click', function() {
          const preview = window._mpMergePreview;
          if (!preview) { toastr?.warning?.('预览数据丢失'); return; }
          window._mpMergePendingEdit = preview;
          const m = preview.merged;
          editId = m.id;
          $('mp_fe').value = m.event || '';
          $('mp_fpk').value = (m.primaryKeywords||[]).join(', ');
          $('mp_fsk').value = (m.secondaryKeywords||[]).join(', ');
          $('mp_fek').value = (m.entityKeywords||[]).join(', ');
          $('mp_ft').value = m.timeLabel || '';
          $('mp_ftv').value = Number.isFinite(Number(m.timeValue)) ? String(m.timeValue) : '';
          $('mp_ffr').value = Array.isArray(m.floorRange) ? m.floorRange[0]+'-'+m.floorRange[1] : '';
          $('mp_fa').value = '';
          $('mp_fs').value = m.summary || '';
          $('mp_fp').value = m.priority || 'medium';
          root.querySelector('.tab[data-t="add"]').click();
          toastr?.info?.('已加载到编辑表单，修改后点「保存」完成合并');
        });
      }
      if(confirmBtn) {
        confirmBtn.addEventListener('click', async function onConfirm() {
          confirmBtn.removeEventListener('click', onConfirm);
          confirmBtn.disabled = true; confirmBtn.textContent = '正在写入...';
          try {
            const preview = window._mpMergePreview;
            if (!preview) { toastr?.warning?.('预览数据丢失'); return; }
            const editedMerged = { ...preview.merged };
            window._mpMergeUndo = { deletedMems: preview.sourceIds.map(id => memories.find(m => m.id === id)).filter(Boolean), mergedId: editedMerged.id };
            for (const id of preview.sourceIds) { memories = memories.filter(m => m.id !== id); }
            memories = upsertMemory(memories, editedMerged);
            await saveMem(memories); selectedIds = new Set(); renderList(); renderXb();
            $('mp_merge_status').innerHTML = '<div class="ht" style="color:#4ade80">合并完成：'+h(preview.merged.event)+' <button class="btn bd1" id="mp_merge_undo" style="margin-left:8px;padding:2px 8px;font-size:11px">撤回合并</button></div>';
            const undoBtn = document.getElementById('mp_merge_undo');
            if(undoBtn) { undoBtn.addEventListener('click', async function onUndo() {
              undoBtn.removeEventListener('click', onUndo);
              const undo = window._mpMergeUndo;
              if (!undo) { toastr?.warning?.('没有可撤回的合并'); return; }
              undoBtn.disabled = true; undoBtn.textContent = '正在撤回...';
              try { memories = memories.filter(m => m.id !== undo.mergedId); for (const m of undo.deletedMems) { memories = upsertMemory(memories, m); } await saveMem(memories); selectedIds = new Set(); window._mpMergeUndo = null; window._mpMergePreview = null; renderList(); renderXb(); $('mp_merge_status').textContent = '合并已撤回，原记忆已恢复。'; toastr?.success?.('合并已撤回'); }
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
      kwRunning = false; kwRunningId = null; kwAbort = null; $('mp_merge_sel').textContent = '合并选中事件';
    }
  };

  $('mp_kps').onclick=async()=>{await saveKwPrompt($('mp_kpr').value);toastr?.success?.('XB关键词重构 Prompt 已保存');};
  $('mp_kpd').onclick=async()=>{$('mp_kpr').value=DEF_KW_PROMPT;await saveKwPrompt(DEF_KW_PROMPT);toastr?.success?.('已恢复默认');};

  $('mp_sel_xb').onclick=()=>{
    selectedIds = new Set(memories.filter(m=>m.source==='xb_event').map(m=>m.id));
    renderList();
  };
  $('mp_sel_xbnr').onclick=()=>{
    selectedIds = new Set(memories.filter(m=>m.source==='xb_event'&&m.keywordSource!=='xb_llm').map(m=>m.id));
    renderList();
    toastr?.success?.(`已选 ${selectedIds.size} 条未重构XB记忆`);
  };
  $('mp_sel_none').onclick=()=>{
    selectedIds = new Set();
    searchPicked = new Set();
    lastSearchResults = [];
    renderList();
  };

  window._mpKR=async(id)=>{
    const mem = memories.find(x=>x.id===id);
    if(!mem) return;
    // v3.5: 所有记忆都支持关键词重构
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
    const ids = [...selectedIds].filter(id => memories.some(m => m.id===id));
    if(!ids.length){toastr?.warning?.('请先勾选需要重构的记忆');return;}
    if(!confirm(`将使用当前 Prompt 和分析 API，批量重构 ${ids.length} 条记忆关键词，继续吗？`)) return;
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
        const mem = memories.find(x=>x.id===id);
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
      { const _p=$(P); if(_p && _p.style.display==='none') { _p.style.display=''; } }
    }
  };

  // Prompt slot management
  const _promptSlots = {
    analysis: (() => { try { const s = window.MemoryPilot?.getSettings?.(); return s?.promptSlots?.analysis || []; } catch { return []; } })()
  };
  const _renderPromptSlots = (sel, slots) => {
    sel.innerHTML = '<option value="0">默认版本</option>' + slots.map((s,i) => '<option value="'+(i+1)+'">'+(s.name||'版本'+(i+1))+'</option>').join('');
  };
  _renderPromptSlots($('mp_bpr_slot'), _promptSlots.analysis);
  $('mp_bpr_slot').onchange = () => {
    const idx = Number($('mp_bpr_slot').value);
    if (idx === 0) { $('mp_bpr').value = loadPrompt(); }
    else { const slot = _promptSlots.analysis[idx-1]; if (slot) $('mp_bpr').value = slot.content || ''; }
  };
  $('mp_bpr_newslot').onclick = () => {
    const name = prompt('版本名称（可选）：', '版本' + (_promptSlots.analysis.length + 1));
    if (name == null) return;
    _promptSlots.analysis.push({ name: name || '版本' + (_promptSlots.analysis.length + 1), content: $('mp_bpr').value });
    try { const s = window.MemoryPilot?.getSettings?.(); if (s) { s.promptSlots = s.promptSlots || {}; s.promptSlots.analysis = _promptSlots.analysis; window.MemoryPilot?.saveSettings?.(); } } catch {}
    _renderPromptSlots($('mp_bpr_slot'), _promptSlots.analysis);
    $('mp_bpr_slot').value = String(_promptSlots.analysis.length);
    toastr?.success?.('已新建 Prompt 版本');
  };
  $('mp_bpr_delslot').onclick = () => {
    const idx = Number($('mp_bpr_slot').value);
    if (idx === 0) { toastr?.warning?.('默认版本不能删除'); return; }
    if (!confirm('删除此 Prompt 版本？')) return;
    _promptSlots.analysis.splice(idx-1, 1);
    try { const s = window.MemoryPilot?.getSettings?.(); if (s) { s.promptSlots = s.promptSlots || {}; s.promptSlots.analysis = _promptSlots.analysis; window.MemoryPilot?.saveSettings?.(); } } catch {}
    _renderPromptSlots($('mp_bpr_slot'), _promptSlots.analysis);
    $('mp_bpr_slot').value = '0';
    $('mp_bpr').value = loadPrompt();
    toastr?.success?.('已删除');
  };
  $('mp_bps').onclick=async()=>{
    const idx = Number($('mp_bpr_slot')?.value || 0);
    if (idx > 0 && _promptSlots.analysis[idx-1]) {
      _promptSlots.analysis[idx-1].content = $('mp_bpr').value;
      try { const s = window.MemoryPilot?.getSettings?.(); if (s) { s.promptSlots = s.promptSlots || {}; s.promptSlots.analysis = _promptSlots.analysis; window.MemoryPilot?.saveSettings?.(); } } catch {}
      toastr?.success?.('Prompt 版本已保存');
    } else {
      await savePrompt($('mp_bpr').value);toastr?.success?.('Prompt已保存');
    }
  };
  $('mp_bpd').onclick=async()=>{$('mp_bpr').value=DEF_PROMPT;await savePrompt(DEF_PROMPT);toastr?.success?.('已恢复默认');};

  $('mp_rssv').onclick=async()=>{
    await saveRecallCfg({every:Math.max(1,Math.round(Number($('mp_revery').value)||1)),alpha:Math.max(0,Math.min(0.95,(($('mp_ralpha').value?.trim?.()==='')?0.72:Number($('mp_ralpha').value)))),maxRecall:Math.max(1,Math.min(20,Number($('mp_rmaxn')?.value)||6)),contextWindow:Math.max(3,Math.min(30,Number($('mp_rctxwin')?.value)||8)),stickyTurns:Math.max(0,Math.min(20,Number($('mp_rsticky')?.value)??5)),groupRecall:!!$('mp_rgrp')?.checked});
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
        eventGroups: loadGroups(),
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
      if (data.summaryPrompt) { await savePrompt(data.summaryPrompt); counts.push('分析Prompt'); }
      if (data.kwRebuildPrompt) { await saveKwPrompt(data.kwRebuildPrompt); counts.push('重构Prompt'); }
      if (data.mergePrompt) { await saveMergePrompt(data.mergePrompt); counts.push('合并Prompt'); }
      if (data.eventGroups && typeof data.eventGroups === 'object') { await saveGroups(data.eventGroups); counts.push('事件组'); }
      renderList(); renderXb();
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
    setCleanupStatus('检测完成：' + (report?.summary || '未发现痕迹'));
  };

  $('mp_cleanup_mp').onclick = async () => {
    try {
      const res = await window.MemoryPilot?.cleanupLegacyArtifacts?.({
        removeMpMetadata: true,
        removeMpVariables: true,
        removeLegacyLocalStorage: true,
        removeLwbMpTraces: false,
      });
      renderCleanupSummary();
      const msg = `已清理旧 MP 痕迹：metadata=${res?.removedMpMetadata ? '1' : '0'}，变量=${res?.removedMpVariables?.length || 0}，localStorage=${res?.removedLocalStorage?.length || 0}`;
      setCleanupStatus(msg, true);
      toastr?.success?.('已清理当前聊天中的旧 MP 痕迹');
    } catch (e) {
      setCleanupStatus('清理失败：' + (e?.message || e), false);
      toastr?.error?.('清理失败');
    }
  };

  $('mp_cleanup_lwb').onclick = async () => {
    try {
      const res = await window.MemoryPilot?.cleanupLegacyArtifacts?.({
        removeMpMetadata: false,
        removeMpVariables: false,
        removeLegacyLocalStorage: false,
        removeLwbMpTraces: true,
      });
      renderCleanupSummary();
      const msg = `已清理 LWB 快照中的 MP 痕迹：vars=${res?.removedLwbSnapVars || 0}，空快照条目=${res?.prunedLwbSnapEntries || 0}`;
      setCleanupStatus(msg, true);
      toastr?.success?.('已清理 LWB 快照中的 MP 痕迹');
    } catch (e) {
      setCleanupStatus('清理失败：' + (e?.message || e), false);
      toastr?.error?.('清理失败');
    }
  };

  let _abort=null;

  // 批量分析结果渲染（复用于实时和恢复场景）
  const renderBatchResults = (nms) => {
    window._mpBM = dedupeMemories(nms);
    $('mp_br').innerHTML=window._mpBM.map(m=>`<div class="mi"><div class="mh"><span class="me">${h(m.event)}</span><span class="bp ${m.priority==='high'?'bph':m.priority==='medium'?'bpm':'bpl'}">${h(m.priority||'medium')}</span></div><div class="ht">${h(m.timeLabel||'')}${Array.isArray(m.floorRange)?' | #'+h(m.floorRange[0])+'-'+h(m.floorRange[1]):''}</div><div class="ms">${h(m.summary)}</div><div class="kr">${((m.primaryKeywords||m.keywords||[])).map(k=>'<span class="kw">'+h(k)+'</span>').join('')}${(m.secondaryKeywords||[]).map(k=>'<span class="kw kx">'+h(k)+'</span>').join('')}${(m.entityKeywords||[]).map(k=>'<span class="kw ke">'+h(k)+'</span>').join('')}</div><div class="ma"><button class="btn bp1" onclick="window._mpBA('${m.id}','high')">置顶</button><button class="btn bp1" onclick="window._mpBA('${m.id}','medium')">普通</button><button class="btn" onclick="window._mpBA('${m.id}','low')">低</button></div></div>`).join('');
    window._mpBA=async(id,prio)=>{
      await withLock('batch_add_'+id, async () => {
        const m=window._mpBM.find(x=>x.id===id);if(!m)return;
        const next = {...m, priority: prio};
        memories = upsertMemory(memories, next);
        await saveMem(memories);
        renderList();
        renderXb();
        toastr?.success?.('已添加');
      });
    };
  };


  const fmtCleanupSummary = (report) => {
    if (!report) return '未检测到数据';
    return report.summary || '未发现旧版 MP / LWB 快照痕迹';
  };

  const renderCleanupSummary = () => {
    const report = window.MemoryPilot?.detectLegacyArtifacts?.();
    const el = $('mp_cleanup_summary');
    if (!el) return report;
    el.textContent = fmtCleanupSummary(report);
    el.style.color = (report && (report.hasLegacyMpMetadata || report.hasLegacyMpVars || report.lwbSnapHasMpTraces)) ? '#fbbf24' : '#9ca3af';
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
    const bannerId = renderPendingBanner(batchPage, 'batch', '批量分析');
    if (bannerId) {
      const ops = checkStaleOps(loadPendingOps());
      const op = ops.batch;
      if (op && (op.status === 'done' || op.status === 'timeout') && (op.resultCount > 0 || (Array.isArray(op.results) && op.results.length))) {
        document.getElementById(bannerId + '_view')?.addEventListener('click', () => {
          const results = loadPendingResults('batch') || op.results || [];
          if (results.length) renderBatchResults(results);
          else toastr?.warning?.('结果数据已过期（页面曾刷新），请重新分析');
        });
      }
    }
    // Auto-summarize results banner
    const autoId = renderPendingBanner(batchPage, 'auto', '自动总结');
    if (autoId) {
      const ops = checkStaleOps(loadPendingOps());
      const op = ops.auto;
      if (op && op.status === 'done' && (op.resultCount > 0)) {
        document.getElementById(autoId + '_view')?.addEventListener('click', () => {
          const results = loadPendingResults('auto') || [];
          if (results.length) renderBatchResults(results);
          else toastr?.warning?.('结果数据已过期，请重新分析');
        });
      }
    }
    // 重构操作
    const listPage = $('mp_pg_list');
    if (listPage) {
      const rbId = renderPendingBanner(listPage, 'rebuild', '批量重构关键词');
      const mgId = renderPendingBanner(listPage, 'merge', '合并事件');
    }
  };
  // 面板打开时立即检查
  try { restorePendingBatch(); } catch {}
  try { renderCleanupSummary(); } catch {}
  // Auto-summarize progress
  try {
    const store = _getStore();
    const progEl = $('mp_auto_progress');
    const histEl = $('mp_auto_history');
    if (store && progEl) {
      const lastFloor = store._lastAutoSummarizeFloor || 0;
      const totalFloors = chat.length;
      const interval = window.MemoryPilot?.getSettings?.()?.autoSummarizeEvery || 20;
      const enabled = window.MemoryPilot?.getSettings?.()?.autoSummarize;
      const unsummarized = totalFloors - lastFloor;
      const nextAt = lastFloor + interval;
      if (!enabled) {
        progEl.innerHTML = '<span style="color:#777">自动总结已关闭（在扩展面板开启）</span>';
      } else {
        progEl.innerHTML = '已总结到 <b style="color:#fff">#' + lastFloor + '</b> / 共 ' + totalFloors + ' 层 · 未总结 <b style="color:#fbbf24">' + unsummarized + '</b> 层 · 下次触发于 #' + nextAt +
          '<div style="display:flex;gap:5px;align-items:center;margin-top:6px">' +
          '<input id="mp_auto_setfloor" type="number" min="0" max="' + totalFloors + '" value="' + lastFloor + '" style="width:80px;padding:4px 6px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.3);color:#eee;font-size:12px">' +
          '<button class="btn" id="mp_auto_setfloor_btn" style="font-size:11px;padding:4px 10px">设为起始楼层</button>' +
          '<button class="btn" id="mp_auto_setfloor_cur" style="font-size:11px;padding:4px 10px">跳到当前（#' + totalFloors + '）</button>' +
          '</div>' +
          '<div style="display:flex;gap:5px;align-items:center;margin-top:4px">' +
          (unsummarized > 0 ? '<button class="btn bp1" id="mp_auto_runnow" style="font-size:11px;padding:4px 10px">立即总结未处理的 ' + unsummarized + ' 层</button>' : '') +
          (window._mpAutoSummarizeRunning ? '<button class="btn bd1" id="mp_auto_abort" style="font-size:11px;padding:4px 10px">中止当前总结</button><span class="ht" style="color:#fbbf24">⏳ 总结中…</span>' : '') +
          '</div>';
        $('mp_auto_setfloor_btn')?.addEventListener('click', async () => {
          const v = Number($('mp_auto_setfloor')?.value);
          if (!Number.isFinite(v) || v < 0) { toastr?.warning?.('请输入有效楼层号'); return; }
          store._lastAutoSummarizeFloor = Math.min(v, totalFloors);
          _saveDebounced();
          toastr?.success?.('自动总结起始楼层已设为 #' + store._lastAutoSummarizeFloor);
          // Re-render
          $('mp_auto_progress').innerHTML = '已更新，下次打开面板刷新显示';
        });
        $('mp_auto_setfloor_cur')?.addEventListener('click', async () => {
          store._lastAutoSummarizeFloor = totalFloors;
          _saveDebounced();
          toastr?.success?.('已跳过全部历史，从当前楼层 #' + totalFloors + ' 开始');
          $('mp_auto_progress').innerHTML = '已更新，下次打开面板刷新显示';
        });
        $('mp_auto_abort')?.addEventListener('click', () => {
          if (window._mpAutoSummarizeAbort) { window._mpAutoSummarizeAbort.abort(); toastr?.info?.('正在中止…'); }
        });
        $('mp_auto_runnow')?.addEventListener('click', () => {
          // Temporarily set marker back so next message triggers
          store._lastAutoSummarizeFloor = Math.max(0, totalFloors - (interval + 1));
          _saveDebounced();
          toastr?.success?.('已重置标记，下一条消息将触发自动总结 #' + (store._lastAutoSummarizeFloor + 1) + '-' + totalFloors + '+');
          $('mp_auto_progress').innerHTML = '已设置，发送下一条消息时触发总结';
        });
      }
      // History
      const history = store._autoSummarizeHistory || [];
      if (history.length && histEl) {
        const statusLabels = { done: '✅', running: '⏳', error: '❌', error_no_api: '⚠️ API未配', empty: '⚪ 无结果', aborted: '⏹ 已中止', timeout: '⏰ 超时' };
        // Auto-fix stale running entries (>3 min old)
        const now = Date.now();
        for (const h_item of history) {
          if (h_item.status === 'running' && now - (h_item.time || 0) > 180000) h_item.status = 'timeout';
        }
        histEl.innerHTML = '<div class="ht" style="margin-bottom:4px">总结历史（最近）：</div>' + history.slice(-10).reverse().map(h_item => {
          const st = statusLabels[h_item.status] || h_item.status;
          const t = h_item.time ? new Date(h_item.time).toLocaleString() : '';
          return '<div style="font-size:10px;color:#888;padding:1px 0">' + st + ' #' + (h_item.from||'?') + '-' + (h_item.to||'?') + (h_item.count ? ' (' + h_item.count + '条)' : '') + ' ' + t + '</div>';
        }).join('');
      }
    }
  } catch (e) { console.warn('[MP] auto progress render err', e); }

  $('mp_brun').onclick=async()=>{
    if(_abort){_abort.abort();_abort=null;$('mp_brun').textContent='开始分析';try{await savePendingOp('batch',{status:'error',error:'手动停止'});}catch{}return;}
    const indices=parseFloors($('mp_bf').value,chat.length);
    if(!indices.length){toastr?.warning?.('未选中楼层');return;}
    _abort=new AbortController();
    $('mp_brun').textContent='停止';
    $('mp_br').innerHTML='<div class="ht">分析 '+indices.length+' 层...</div>';
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
      if(runBtn) runBtn.textContent='开始分析';
      const panel=$(P);
      if(panel && panel.style.display==='none') {
        panel.style.display='';
        toastr?.success?.('分析已完成');
      }
    }
  };
})();
}
