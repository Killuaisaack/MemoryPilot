// MemoryPilot Recall Monitor - auto-transformed

export async function openMonitor() {
(async () => {
  const PANEL='mp_recall_monitor_panel', STYLE='mp_recall_monitor_style';
  let MAX_RECALL = 6;
  const MK = 'mp_memories';
  const BK = 'mp_kw_blacklist';
  const CK = 'mp_text_clean_cfg';
  const RK = 'mp_recall_settings';
  const META_NS = 'MemoryPilot';

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

  // Chat isolation
  const _cid = __mpScopeKey;
  if (_cid) {
    const _prev = localStorage.getItem('mp_active_chat');
    if (_prev !== _cid) {
      ['mp_memories','mp_recall_pin','mp_recall_ctx'].forEach(k => { try { localStorage.removeItem(k); } catch {} });
      try { localStorage.setItem('mp_active_chat', _cid); } catch {}
    }
  }
  const $ = id => document.getElementById(id);
  const h = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const norm = (s) => String(s ?? '').toLowerCase().trim();
  const uniq = (arr) => Array.from(new Set((arr || []).filter(Boolean)));
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  if ($(PANEL)) { $(PANEL).remove(); $(STYLE)?.remove(); return; }
  try { document.getElementById('mp_main_panel')?.remove(); document.getElementById('mp_main_style')?.remove(); } catch {}
  try { document.getElementById('mp_api_panel')?.remove(); document.getElementById('mp_api_style')?.remove(); } catch {}

  const STOP_WORDS = new Set([
    '的','了','在','是','和','与','并','后','前','中','内','外','对','把','被','让','将','及',
    '后续','当前','相关','进行','继续','已经','开始','结束','然后','因为','所以','这个','那个',
    '一次','一个','一种','没有','不是','自己','我们','你们','他们','她们','如果','但是','而且',
    '以及','或者','一些','这种','那种','这样','那样','需要','可以','应该','不会','不是很'
  ]);

  const splitWords = (s) => norm(s).split(/[\s，。、！？；：·,.;:!?\-#()（）《》【】\[\]{}"'“”‘’\/\\|\n\r\t]+/).map(x => x.trim()).filter(w => w.length >= 2);
  const toCJKGrams = (text, minN = 2, maxN = 3, limit = 120) => {
    const s = norm(text).replace(/[\s，。、！？；：·,.;:!?\-#()（）《》【】\[\]{}"'“”‘’\/\\|\n\r\t]+/g, '');
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
    const words = splitWords(text).filter(w => !STOP_WORDS.has(w)).slice(0, limit);
    const grams = toCJKGrams(text, 2, 3, limit * 4);
    return uniq([...words, ...grams]).slice(0, limit * 3);
  };
  const textKey = (s) => norm(s).replace(/\s+/g, '').replace(/[，。、！？；：,.;:!?\-#()（）《》【】\[\]{}"'“”‘’\/\\|\n\r\t]/g, '');
  const memFingerprint = (mem) => [textKey(mem?.event || ''), textKey(mem?.summary || '')].join('||');
  
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
  const loadJson = async (key, fallback) => {
    // 1. localStorage cache
    try {
      const raw = localStorage.getItem(key);
      if (raw && raw.trim()) return JSON.parse(raw);
    } catch {}
    // 2. extensionSettings (server-synced)
    try {
      const store = _getStore();
      if (store && store[key] != null) {
        try { localStorage.setItem(key, JSON.stringify(store[key])); } catch {}
        return store[key];
      }
    } catch {}
    // 3. Legacy chatMetadata
    try {
      const meta = metaRoot();
      if (meta && meta[key] != null) {
        try { localStorage.setItem(key, JSON.stringify(meta[key])); } catch {}
        return meta[key];
      }
    } catch {}
    return fallback;
  };
  const saveText = async (key, value) => {
    const text = String(value ?? '');
    try { localStorage.setItem(key, text); } catch {}
    // Write directly to chatMetadata.variables for {{getvar::}} macro access
    try {
      ctx.chatMetadata = ctx.chatMetadata || {};
      ctx.chatMetadata.variables = ctx.chatMetadata.variables || {};
      ctx.chatMetadata.variables[key] = text;
    } catch {}
  };
  const DEF_CLEANER = { blockTags:['think','details'], linePrefixes:['affinity_change:','mood_change:','state_update:'], regexRules:['^____+$'], cleanForRecall:true, cleanForBatch:true };
  const normalizeCleaner = (cfg) => {
    const src = cfg && typeof cfg === 'object' ? cfg : {};
    const normList = (arr) => Array.from(new Set((Array.isArray(arr) ? arr : []).map(x => String(x ?? '').trim()).filter(Boolean)));
    return { blockTags:normList(src.blockTags || DEF_CLEANER.blockTags), linePrefixes:normList(src.linePrefixes || DEF_CLEANER.linePrefixes), regexRules:normList(src.regexRules || DEF_CLEANER.regexRules), cleanForRecall:src.cleanForRecall !== false, cleanForBatch:src.cleanForBatch !== false };
  };
  const applyCleaner = (input, cfg) => {
    let text = String(input ?? '');
    const conf = normalizeCleaner(cfg);
    for (const rawTag of conf.blockTags) {
      const tag = String(rawTag || '').trim();
      if (!tag) continue;
      try { text = text.replace(new RegExp('<\\s*' + tag + '\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*' + tag + '\\s*>', 'gi'), ' '); } catch {}
    }
    if (conf.linePrefixes.length) {
      const prefixes = conf.linePrefixes.map(x => String(x || '').trim().toLowerCase()).filter(Boolean);
      text = text.split(/\r?\n/).filter(line => {
        const t = String(line || '').trim().toLowerCase();
        if (!t) return true;
        return !prefixes.some(p => t.startsWith(p));
      }).join('\n');
    }
    for (const rawRule of conf.regexRules) {
      const rule = String(rawRule || '').trim();
      if (!rule) continue;
      try { text = text.replace(new RegExp(rule, 'gim'), ' '); } catch {}
    }
    return text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  };
  const DEF_RECALL_SETTINGS = { every: 1, alpha: 0.72, stickyTurns: 5, contextWindow: 8, maxRecall: 6 };
  const normalizeRecallSettings = (cfg) => {
    const src = cfg && typeof cfg === 'object' ? cfg : {};
    const rawAlpha = Number(src.alpha);
    return {
      every: clamp(Math.round(Number(src.every) || DEF_RECALL_SETTINGS.every), 1, 50),
      alpha: clamp(Number.isFinite(rawAlpha) ? rawAlpha : DEF_RECALL_SETTINGS.alpha, 0, 0.95),
      stickyTurns: clamp(Math.round(Number(src.stickyTurns) || DEF_RECALL_SETTINGS.stickyTurns), 0, 20),
      contextWindow: clamp(Math.round(Number(src.contextWindow) || DEF_RECALL_SETTINGS.contextWindow || 8), 1, 50),
      maxRecall: clamp(Math.round(Number(src.maxRecall) || DEF_RECALL_SETTINGS.maxRecall), 1, 20)
    };
  };
  const cleanTextTerms = (text, limit = 18, blacklist = new Set()) => extractTerms(text, limit).map(w => String(w ?? '').trim()).filter(Boolean).filter(w => !blacklist.has(norm(w))).filter(w => !STOP_WORDS.has(w)).slice(0, limit * 2);
  const overlapRatio = (terms, ctxSet) => {
    if (!terms?.length) return 0;
    let hit = 0;
    for (const t of terms) {
      const nt = norm(t);
      if (!nt) continue;
      if (ctxSet.has(nt)) { hit++; continue; }
      let matched = false;
      for (const w of ctxSet) {
        if (!w) continue;
        if (w === nt) { matched = true; break; }
        if (nt.length >= 3 && w.length >= 3 && (w.includes(nt) || nt.includes(w))) { matched = true; break; }
      }
      if (matched) hit++;
    }
    return hit / terms.length;
  };
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
  const parseStored = (text) => String(text || '').split(/\n+/).map(s => s.trim()).filter(Boolean).map(line => {
    const m = line.match(/^\[(.*?)\]\s*(.*)$/);
    return m ? { event: m[1], summary: m[2] } : { event: line, summary: '' };
  });

  const cleanerCfg = normalizeCleaner(DEF_CLEANER);
  let recallCfg = normalizeRecallSettings(DEF_RECALL_SETTINGS);
  let CTX_MSGS = recallCfg.contextWindow || 8;
  let blacklist = new Set();
  let latest = null;
  let _configLoaded = false;

  const simulateRecall = async () => {
    let memories = await loadJson(MK, []);
    if (!Array.isArray(memories) || !memories.length) return { contextText:'', pinned:[], triggered:[], pin:'', ctx:'', due:true };
    memories = dedupeByFingerprint(memories);

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
    const resolveFloorRange = (mem) => {
      if (Array.isArray(mem?.floorRange) && mem.floorRange.length >= 2) {
        const a = Number(mem.floorRange[0]), b = Number(mem.floorRange[1]);
        if (Number.isFinite(a) && Number.isFinite(b)) return [Math.min(a,b), Math.max(a,b)];
      }
      return parseFloorRangeFromText(mem?.summary) || parseFloorRangeFromText(mem?.event) || parseFloorRangeFromText(mem?.timeLabel) || null;
    };
    const floorRangeDistance = (a, b) => {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) return Infinity;
      const [a1, a2] = a.map(Number), [b1, b2] = b.map(Number);
      if ([a1,a2,b1,b2].some(Number.isNaN)) return Infinity;
      if (a2 < b1) return b1 - a2;
      if (b2 < a1) return a1 - b2;
      return 0;
    };
    const calcDynamicAlpha = (baseAlpha, floorDist, ageNorm) => {
      if (!Number.isFinite(floorDist) || floorDist > 500) {
        return clamp(baseAlpha + ageNorm * 0.15, 0, 0.95);
      }
      const distFactor = clamp(floorDist / 200, 0, 1);
      return clamp(baseAlpha * (0.3 + 0.7 * distFactor), 0, 0.95);
    };
    const escapeRegExp = (x) => String(x ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const isLatinWord = (x) => /^[a-z0-9_-]+$/i.test(String(x ?? '').trim());
    const exactMatchKeyword = (text, kw) => {
      const src = norm(text);
      const key = norm(kw);
      if (!src || !key) return false;
      if (isLatinWord(key)) {
        const re = new RegExp(`(?:^|\\W)${escapeRegExp(key)}(?:$|\\W)`, 'i');
        return re.test(src);
      }
      return src.includes(key);
    };
    const weakMatchKeyword = (ctxSet, kw) => {
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
    const matchKeywordGroup = (text, ctxSet, kws) => {
      const exactList = [];
      const weakList = [];
      for (const kw of kws || []) {
        if (!kw) continue;
        if (exactMatchKeyword(text, kw)) { exactList.push(kw); continue; }
        if (weakMatchKeyword(ctxSet, kw)) weakList.push(kw);
      }
      const exact = uniq(exactList);
      const weak = uniq(weakList).filter(k => !exact.includes(k));
      return { exact, weak, exactHitCount: exact.length, weakHitCount: weak.length, hitCount: exact.length + weak.length };
    };
    const cleanPrimaryKeywords = (mem) => {
      const kws = Array.isArray(mem?.primaryKeywords) ? mem.primaryKeywords : Array.isArray(mem?.keywords) ? mem.keywords : [];
      return uniq(kws.map(k => String(k ?? '').trim()).filter(Boolean).filter(k => !blacklist.has(norm(k))));
    };
    const cleanSecondaryKeywords = (mem) => {
      const kws = Array.isArray(mem?.secondaryKeywords) ? mem.secondaryKeywords : [];
      return uniq(kws.map(k => String(k ?? '').trim()).filter(Boolean).filter(k => !blacklist.has(norm(k))));
    };

    const nextTurn = Math.max(0, Number(metaRoot().turnCounter || 0)) + 1;
    const due = nextTurn % recallCfg.every === 0;
    const recent = chat.slice(-CTX_MSGS);
    const currentFloorRange = recent.length ? [chat.length - recent.length + 1, chat.length] : null;
    const recentTexts = recent.map(m => {
      const raw = m?.mes || '';
      return cleanerCfg.cleanForRecall ? applyCleaner(raw, cleanerCfg) : String(raw);
    }).filter(Boolean);
    const contextText = recentTexts.join('\n\n----\n\n');
    const flatContext = recentTexts.join(' ');
    if (!due) {
      const pinnedOnly = dedupeByFingerprint(memories.filter(m => m.priority === 'high'));
      const stickyRaw = metaRoot().stickyState || {};
      const stickyMems = [];
      try { for (const [sid, st] of Object.entries(stickyRaw)) { if (st && st.turnsLeft > 0 && st.event && st.summary) stickyMems.push(st); } } catch {}
      return { contextText, pinned: pinnedOnly.map(m=>({...m,_reason:'置顶'})), triggered: stickyMems.map(s=>({...s,_reason:'粘性保持'})), pin: pinnedOnly.map(m=>`[${m.event}] ${m.summary}`).join('\n'), ctx: stickyMems.map(s=>`[${s.event}] ${s.summary}`).join('\n'), due:false };
    }
    const ctxWords = splitWords(flatContext);
    const ctxTerms = extractTerms(flatContext, 80);
    const ctxSet = new Set([...ctxWords.map(norm), ...ctxTerms.map(norm)].filter(Boolean).filter(w => !blacklist.has(w)));
    const pinned = [];
    const primary = [];
    const totalMem = memories.length;

    for (let idx = 0; idx < memories.length; idx++) {
      const mem = memories[idx];
      if (!mem) continue;
      if (mem.priority === 'high') { pinned.push(mem); continue; }
      const primaryKws = cleanPrimaryKeywords(mem);
      if (!primaryKws.length) continue;
      const secondaryKws = cleanSecondaryKeywords(mem);
      
      
      const primaryMatch = matchKeywordGroup(flatContext, ctxSet, primaryKws);
      if (primaryMatch.hitCount <= 0) continue;
      if (primaryMatch.exactHitCount <= 0 && primaryMatch.weakHitCount < 2) continue;
      const secondaryMatch = secondaryKws.length ? matchKeywordGroup(flatContext, ctxSet, secondaryKws) : { exact: [], weak: [], exactHitCount: 0, weakHitCount: 0, hitCount: 0 };
      const secondaryMiss = secondaryKws.length > 0 && secondaryMatch.hitCount <= 0;
      const matchedKeywords = uniq([...primaryMatch.exact, ...secondaryMatch.exact]);
      const weakMatchedKeywords = uniq([...primaryMatch.weak, ...secondaryMatch.weak]).filter(k => !matchedKeywords.includes(k));
      const exactHitCount = primaryMatch.exactHitCount + secondaryMatch.exactHitCount;
      const weakHitCount = primaryMatch.weakHitCount + secondaryMatch.weakHitCount;
      const fp = memFingerprint(mem) || String(idx);
      const turnCounter = Math.max(1, Number(metaRoot().turnCounter || 1));
      const memTs = mem?.timestamp || 0;
      let ageNorm = 0.5;
      if (memTs > 0) {
        let minTs = Infinity, maxTs = -Infinity;
        for (const mm of memories) { if (mm?.timestamp) { if (mm.timestamp < minTs) minTs = mm.timestamp; if (mm.timestamp > maxTs) maxTs = mm.timestamp; } }
        ageNorm = (minTs < maxTs) ? clamp(1 - (memTs - minTs) / (maxTs - minTs), 0, 1) : 0;
      }
      const memFloorRange = resolveFloorRange(mem);
      const floorDist = floorRangeDistance(memFloorRange, currentFloorRange);
      const alphaBase = Number.isFinite(Number(mem?.alpha)) ? clamp(Number(mem.alpha), 0, 0.95) : recallCfg.alpha;
      const distanceAlpha = calcDynamicAlpha(alphaBase, floorDist, ageNorm);
      const freshness = 1 - distanceAlpha;
      
      
      
      
      
      
      
      const totalGateKeywords = primaryKws.length + secondaryKws.length;
      const keywordScore = totalGateKeywords ? Math.min(1, (exactHitCount + weakHitCount * 0.6) / totalGateKeywords) : 0;
      
      
      const isLow = mem.priority === 'low';
      const pw = isLow ? 0.15 : (mem.priority === 'medium' ? 0.5 : 0.3);
      const secondaryMul = secondaryMiss ? 0.4 : 1.0;
      const score = Math.max(0.01, (keywordScore * 0.65 + pw * 0.10 + freshness * 0.15) * secondaryMul);
      const reasons = [];
      if (isLow) reasons.push('低优先级');
      if (primaryMatch.exact.length) reasons.push(`主关键词硬命中 ${primaryMatch.exactHitCount}: ${primaryMatch.exact.join(', ')}`);
      if (primaryMatch.weak.length) reasons.push(`主关键词弱匹配 ${primaryMatch.weakHitCount}: ${primaryMatch.weak.join(', ')}`);
      if (secondaryKws.length) {
        if (secondaryMatch.exact.length) reasons.push(`门控关键词硬命中 ${secondaryMatch.exactHitCount}: ${secondaryMatch.exact.join(', ')}`);
        if (secondaryMatch.weak.length) reasons.push(`门控关键词弱匹配 ${secondaryMatch.weakHitCount}: ${secondaryMatch.weak.join(', ')}`);
      }
      reasons.push(Number.isFinite(floorDist) ? `楼层距离 ${floorDist} → α=${distanceAlpha.toFixed(2)}（基准 ${alphaBase.toFixed(2)}）` : `索引衰减 α=${distanceAlpha.toFixed(2)}（基准 ${alphaBase.toFixed(2)}）`);
      
      primary.push({ ...mem, _score: score, _reason: reasons.join('；') });
    }

    primary.sort((a,b)=>b._score-a._score);
    // 分层选择：与 Task 0 一致 — medium 优先填槽，low 保底至少 1 槽（总槽≥3 时）
    MAX_RECALL = recallCfg.maxRecall || 6;
    const maxTriggered = MAX_RECALL;
    const lowCandidates = primary.filter(m => m.priority === 'low');
    const medCandidates = primary.filter(m => m.priority !== 'low');
    const lowReserved = (maxTriggered >= 3 && lowCandidates.length > 0) ? 1 : 0;
    const medCap = maxTriggered - lowReserved;
    const selected = [];
    const seen = new Set();
    const tryPush = (mem) => {
      const fp = memFingerprint(mem);
      if (fp && seen.has(fp)) return;
      if (fp) seen.add(fp);
      selected.push(mem);
    };
    // Pass 1: medium/默认 优先
    for (const mem of medCandidates) { if (selected.length >= medCap) break; tryPush(mem); }
    // Pass 2: low 填保底 + 剩余空位
    for (const mem of lowCandidates) { if (selected.length >= maxTriggered) break; tryPush(mem); }
    // Pass 3: medium 回填
    for (const mem of medCandidates) { if (selected.length >= maxTriggered) break; tryPush(mem); }
    const finalPinned = dedupeByFingerprint(pinned);
    const finalSelected = dedupeByFingerprint(selected).slice(0, maxTriggered);
    return {
      contextText,
      pinned: finalPinned,
      triggered: finalSelected,
      pin: finalPinned.map(m => `[${m.event}] ${m.summary}`).join('\n'),
      ctx: finalSelected.map(m => `[${m.event}] ${m.summary}`).join('\n'),
      due:true
    };
  };

const renderCardList = (items, tone, showReason, opts = {}) => {
    if (!items.length) return '<div class="mpr_empty">（空）</div>';
    const editable = !!opts.editable;
    const group = opts.group || '';
    return items.map((m, i) => `
      <div class="mpr_item">
        <div class="mpr_item_top">
          <div class="mpr_event" style="color:${tone}">${h(m.event || '(无事件名)')}</div>
          ${editable ? `<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="mpr_del" data-group="${group}" data-index="${i}">删除这条</button></div>` : ''}
        </div>
        <div class="mpr_summary">${h(m.summary || '')}</div>
        ${showReason && m._reason ? `<div class="mpr_reason">${h(m._reason)}</div>` : ''}
      </div>
    `).join('');
  };

  const css = document.createElement('style');
  css.id = STYLE;
  css.textContent = `
    #${PANEL}{position:fixed;inset:0;z-index:10020;display:flex;align-items:flex-start;justify-content:center;padding:max(12px,env(safe-area-inset-top)) 12px 12px;box-sizing:border-box}
    #${PANEL} .mask{position:absolute;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(2px)}
    #${PANEL} .card{position:relative;width:min(1180px,100%);max-height:calc(100dvh - 24px);overflow:auto;background:#1f2329;border:1px solid rgba(255,255,255,.08);border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.35);color:#eef2ff}
    #${PANEL} .hd{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:18px 18px 10px;border-bottom:1px solid rgba(255,255,255,.08)}
    #${PANEL} .ttl{font-size:18px;font-weight:700}
    #${PANEL} .sub{font-size:12px;opacity:.75;line-height:1.6;margin-top:4px}
    #${PANEL} .actions{display:flex;gap:8px;flex-wrap:wrap}
    #${PANEL} .btn{background:#2b3442;border:1px solid rgba(255,255,255,.08);color:#fff;padding:8px 12px;border-radius:10px;cursor:pointer}
    #${PANEL} .btn:hover{filter:brightness(1.08)}
    #${PANEL} .btn[disabled]{opacity:.55;cursor:not-allowed}
    #${PANEL} .btn.danger{background:#552930}
    #${PANEL} .bd{padding:16px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
    #${PANEL} .box{background:#171b21;border:1px solid rgba(255,255,255,.08);border-radius:14px;display:flex;flex-direction:column;min-height:360px}
    #${PANEL} .boxhd{padding:14px 14px 10px;border-bottom:1px solid rgba(255,255,255,.08)}
    #${PANEL} .boxt{font-size:15px;font-weight:700}
    #${PANEL} .boxs{font-size:12px;opacity:.72;line-height:1.55;margin-top:5px}
    #${PANEL} .boxbd{padding:14px;overflow:auto;white-space:pre-wrap;word-break:break-word}
    #${PANEL} .mpr_item{background:#202633;border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:12px;margin-bottom:10px}
    #${PANEL} .mpr_item_top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
    #${PANEL} .mpr_event{font-weight:700}
    #${PANEL} .mpr_summary{font-size:13px;line-height:1.7;opacity:.95;margin-top:8px}
    #${PANEL} .mpr_reason{font-size:12px;line-height:1.6;color:#a5b4fc;margin-top:8px}
    #${PANEL} .mpr_del{background:#4b2f37;border:1px solid rgba(255,255,255,.08);color:#fff;padding:6px 9px;border-radius:8px;cursor:pointer;flex:0 0 auto}
    #${PANEL} .mpr_empty{opacity:.6}
    #${PANEL} .status{padding:0 16px 16px;font-size:12px;opacity:.82}
    @media(max-width:980px){
      #${PANEL} .bd{grid-template-columns:1fr}
      #${PANEL} .card{overflow:auto;-webkit-overflow-scrolling:touch}
    }
    @media(max-width:600px){
      #${PANEL}{padding:6px}
      #${PANEL} .card{border-radius:12px}
      #${PANEL} .hd{flex-direction:column;padding:12px 12px 8px}
      #${PANEL} .sub{display:none}
      #${PANEL} .actions{width:100%}
      #${PANEL} .actions .btn{flex:1;text-align:center}
    }
    #${PANEL} .boxbd::-webkit-scrollbar{width:6px}
    #${PANEL} .boxbd::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:3px}
    #${PANEL} .boxbd{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.15) transparent}
    #${PANEL} .card::-webkit-scrollbar{width:6px}
    #${PANEL} .card::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:3px}
    #${PANEL} .card{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.12) transparent}
  `;
  document.head.appendChild(css);

  const root = document.createElement('div');
  root.id = PANEL;
  root.innerHTML = `
    <div class="mask"></div>
    <div class="card">
      <div class="hd">
        <div>
          <div class="ttl">召回监控</div>
          <div class="sub">正式召回与正式写入都按每 ${h(String(recallCfg.every))} 回合执行；匹配窗口参考最近 ${h(String(CTX_MSGS))} 回合原文。规则为：主关键词至少命中 1 个；若配置了门控关键词，还需至少命中 1 个门控关键词；通过后再进入距离衰减概率。默认 α=${h(recallCfg.alpha.toFixed(2))}，单条记忆可自定义覆盖。</div>
        </div>
        <div class="actions">
          <button class="btn" id="mpr_refresh">刷新模拟</button>
          <button class="btn" id="mpr_rewrite">重写缓存</button>
          <button class="btn danger" id="mpr_clear">清空写入</button>
          <button class="btn" id="mpr_close">关闭</button>
        </div>
      </div>
      <div class="bd">
        <section class="box"><div class="boxhd"><div class="boxt">① 当前上下文</div><div class="boxs">最近 ${CTX_MSGS} 层，按召回清洗规则处理后参与匹配</div></div><div class="boxbd" id="mpr_context"></div></section>
        <section class="box"><div class="boxhd"><div class="boxt">② 本轮正式召回预测</div><div class="boxs">规则与正式任务一致。可单条删除后，再点“重写缓存”。</div></div><div class="boxbd" id="mpr_pred"></div></section>
        <section class="box"><div class="boxhd"><div class="boxt">③ 缓存中的最近一次正式写入</div><div class="boxs">当前 mp_recall_pin / mp_recall_ctx 的真实存量</div></div><div class="boxbd" id="mpr_actual"></div></section>
      </div>
      <div class="status" id="mpr_status"></div>
    </div>`;
  document.body.appendChild(root);

  const getActual = async () => {
    let pin = '';
    let ctxText = '';
    // 优先从 chatMetadata 读取（和 task0 写入一致）
    try {
      const meta = metaRoot();
      if (meta && meta['mp_recall_pin']) pin = String(meta['mp_recall_pin']);
      if (meta && meta['mp_recall_ctx']) ctxText = String(meta['mp_recall_ctx']);
    } catch {}
    // 回退到 localStorage
    if (!pin) try { pin = localStorage.getItem('mp_recall_pin') || ''; } catch {}
    if (!ctxText) try { ctxText = localStorage.getItem('mp_recall_ctx') || ''; } catch {}
    return { pin, ctx: ctxText, pinned: parseStored(pin), triggered: parseStored(ctxText) };
  };

  const setBusy = (flag, text = '') => {
    ['mpr_refresh','mpr_rewrite','mpr_clear'].forEach(id => {
      const el = $(id);
      if (el) el.disabled = !!flag;
    });
    if (text) $('mpr_status').textContent = text;
  };

  const removeMemoryById = async (id) => {
    const key = 'mp_memories';
    let list = [];
    try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch {}
    if (!Array.isArray(list)) list = [];
    list = list.filter(m => String(m?.id || '') !== String(id || ''));
    localStorage.setItem(key, JSON.stringify(list));
    // Update extensionSettings
    try {
      const store = _getStore();
      if (store) { store['mp_memories'] = list; _saveDebounced(); }
    } catch {}
  };

  const bindPredictActions = () => {};

  const updateView = async () => {
    latest = await simulateRecall();
    const actual = await getActual();
    $('mpr_context').textContent = latest.contextText || '（空）';
    $('mpr_pred').innerHTML = (latest.due === false ? '<div class="mpr_empty">本回合不是正式召回节点；这里展示的是按正式规则推演出的下一次候选。下方 actual 仍是缓存里的最近一次真实写入。</div>' : '') + renderCardList(latest.pinned, '#fbbf24', true, { editable: true, group: 'pinned' }) + renderCardList(latest.triggered, '#93c5fd', true, { editable: true, group: 'triggered' });
    $('mpr_actual').innerHTML = renderCardList(actual.pinned, '#fbbf24', false) + renderCardList(actual.triggered, '#93c5fd', false);
    const same = String(latest.pin || '') === String(actual.pin || '') && String(latest.ctx || '') === String(actual.ctx || '');
    
    // Sticky 状态显示
    const stickyRaw = metaRoot().stickyState || {};
    const stickyEntries = Object.entries(stickyRaw);
    if (stickyEntries.length) {
      const stickyHtml = '<div style="margin-top:12px"><div class="boxt">④ 粘性状态</div>' +
        stickyEntries.map(([id, s]) => `<div class="mpr_reason">· ${h(s.event || id)} — 剩 ${s.turnsLeft} 轮</div>`).join('') +
        '</div>';
      if (!$('mpr_sticky')) { $('mpr_actual').parentElement?.insertAdjacentHTML('afterend', '<div id="mpr_sticky"></div>'); }
      $('mpr_sticky').innerHTML = stickyHtml;
    } else {
      const sc = $('mpr_sticky'); if (sc) sc.innerHTML = '';
    }
$('mpr_status').textContent = latest.due === false ? (same ? '本回合不是正式召回节点；actual 保持上次真实写入，预测区展示下一次候选。' : '本回合不是正式召回节点；预测区展示下一次候选，actual 仍是上次真实写入。') : (same ? '当前预测与缓存一致。' : '当前预测与缓存不一致；可用“重写缓存”立即覆盖。');
    root.querySelectorAll('.mpr_del').forEach(btn => {
      btn.onclick = async () => {
        const group = btn.getAttribute('data-group');
        const index = Number(btn.getAttribute('data-index'));
        if (!latest) return;
        const targetList = group === 'pinned' ? latest.pinned : latest.triggered;
        const removed = targetList[index];
        targetList.splice(index, 1);
        latest.pin = latest.pinned.map(m => `[${m.event}] ${m.summary}`).join('\n');
        latest.ctx = latest.triggered.map(m => `[${m.event}] ${m.summary}`).join('\n');
        if (removed && removed.id) { await removeMemoryById(removed.id); }
        $('mpr_pred').innerHTML = (latest.due === false ? '<div class="mpr_empty">本回合不是正式召回节点；这里展示的是按正式规则推演出的下一次候选。下方 actual 仍是缓存里的最近一次真实写入。</div>' : '') + renderCardList(latest.pinned, '#fbbf24', true, { editable: true, group: 'pinned' }) + renderCardList(latest.triggered, '#93c5fd', true, { editable: true, group: 'triggered' });
        $('mpr_status').textContent = '已从预测结果中删除 1 条；点“重写缓存”即可落库。';
        root.querySelectorAll('.mpr_del').forEach(b => b.onclick = btn.onclick);
      };
    });
  };

  $('mpr_close').onclick = () => { root.remove(); css.remove(); };
  $('mpr_refresh').onclick = async () => {
    setBusy(true, '正在刷新模拟...');
    try { await updateView(); toastr?.success?.('模拟刷新完成'); } finally { setBusy(false); }
  };
  $('mpr_rewrite').onclick = async () => {
    setBusy(true, '正在重写缓存...');
    try {
      if (!latest) latest = await simulateRecall();
      await saveText('mp_recall_pin', latest.pin || '');
      await saveText('mp_recall_ctx', latest.ctx || '');
      await updateView();
      $('mpr_status').textContent = '缓存已按当前预测结果重写。';
      toastr?.success?.('缓存已重写');
    } finally { setBusy(false); }
  };
  $('mpr_clear').onclick = async () => {
    setBusy(true, '正在清空缓存...');
    try {
      await saveText('mp_recall_pin', '');
      await saveText('mp_recall_ctx', '');
      await updateView();
      $('mpr_status').textContent = '缓存已清空。';
      toastr?.success?.('缓存已清空');
    } finally { setBusy(false); }
  };

  // Show loading state immediately, then load config async
  $('mpr_status').textContent = '正在加载配置…';
  setBusy(true);
  try {
    const _cc = normalizeCleaner(await loadJson(CK, DEF_CLEANER));
    Object.assign(cleanerCfg, _cc);
    recallCfg = normalizeRecallSettings(await loadJson(RK, DEF_RECALL_SETTINGS));
    CTX_MSGS = recallCfg.contextWindow || 8;
    blacklist = new Set(((await loadJson(BK, [])) || []).map(norm).filter(Boolean));
    _configLoaded = true;
    // Update sub text now that config is loaded
    const subEl = root.querySelector('.sub');
    if (subEl) subEl.textContent = `正式召回与正式写入都按每 ${recallCfg.every} 回合执行；匹配窗口参考最近 ${CTX_MSGS} 回合原文。规则为：主关键词至少命中 1 个；若配置了门控关键词，还需至少命中 1 个门控关键词；通过后再进入距离衰减概率。默认 α=${recallCfg.alpha.toFixed(2)}，单条记忆可自定义覆盖。`;
  } catch (e) {
    console.warn('[MP Monitor] config load failed, using defaults', e);
    _configLoaded = true;
  }
  try { await updateView(); } catch (e) { console.warn('[MP Monitor] initial render failed', e); }
  setBusy(false);

  // 自动刷新：每次 chat 更新后自动刷新（监听 DOM 变化）
  let _autoRefreshTimer = null;
  const scheduleRefresh = () => {
    if (_autoRefreshTimer) clearTimeout(_autoRefreshTimer);
    _autoRefreshTimer = setTimeout(async () => {
      if (!$(PANEL)) return; // 面板已关闭
      try { await updateView(); } catch {}
    }, 1500); // 延迟1.5秒，等 task0 写入完成
  };
  
  // 监听 chat 容器的变化（新消息添加时触发）
  const chatContainer = document.getElementById('chat');
  if (chatContainer) {
    const observer = new MutationObserver(scheduleRefresh);
    observer.observe(chatContainer, { childList: true, subtree: false });
    // 面板关闭时断开
    const checkPanel = setInterval(() => {
      if (!$(PANEL)) { observer.disconnect(); clearInterval(checkPanel); }
    }, 3000);
  }
})();
}
