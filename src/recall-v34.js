// MemoryPilot Recall Engine - auto-transformed from taskjs
// Storage: extensionSettings (NOT chatMetadata)
// Prompt injection: chatMetadata.variables only

export async function runRecall() {
(async () => {
  let MAX_RECALL = 6;
  const MK = 'mp_memories';
  const BK = 'mp_kw_blacklist';
  const CK = 'mp_text_clean_cfg';
  const RK = 'mp_recall_settings';
  const META_NS = 'MemoryPilot';

  const ctx = window.SillyTavern?.getContext?.();
  if (!ctx) return;
  const chat = ctx.chat || [];
  if (chat.length < 1) return;

  // Chat isolation: clear stale localStorage on chat switch
  const _cid = String(ctx.chatId ?? ctx.chatMetadata?.chat_file_name ?? '');
  if (_cid) {
    const _prev = localStorage.getItem('mp_active_chat');
    if (_prev !== _cid) {
      ['mp_memories','mp_recall_pin','mp_recall_ctx'].forEach(k => { try { localStorage.removeItem(k); } catch {} });
      try { localStorage.setItem('mp_active_chat', _cid); } catch {}
    }
  }

  const norm = (s) => String(s ?? '').toLowerCase().trim();
  const uniq = (arr) => Array.from(new Set((arr || []).filter(Boolean)));
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  const STOP_WORDS = new Set([
    '的','了','在','是','和','与','并','后','前','中','内','外','对','把','被','让','将','及',
    '后续','当前','相关','进行','继续','已经','开始','结束','然后','因为','所以','这个','那个',
    '一次','一个','一种','没有','不是','自己','我们','你们','他们','她们','如果','但是','而且',
    '以及','或者','一些','这种','那种','这样','那样','需要','可以','应该','不会','不是很'
  ]);

  const splitWords = (s) =>
    norm(s)
      .split(/[\s，。、！？；：·,.;:!?\-#()（）《》【】\[\]{}"'“”‘’\/\\|\n\r\t]+/)
      .map(x => x.trim())
      .filter(w => w.length >= 2);

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
    const words = splitWords(text)
      .filter(w => !STOP_WORDS.has(w))
      .slice(0, limit);
    const grams = toCJKGrams(text, 2, 3, limit * 4);
    return uniq([...words, ...grams]).slice(0, limit * 3);
  };

  const textKey = (s) =>
    norm(s)
      .replace(/\s+/g, '')
      .replace(/[，。、！？；：,.;:!?\-#()（）《》【】\[\]{}"'“”‘’\/\\|\n\r\t]/g, '');

  const memFingerprint = (mem) => [textKey(mem?.event || ''), textKey(mem?.summary || '')].join('||');

  

  const metaRoot = () => {
    try { return ctx.chatMetadata?.extensions?.[META_NS] || {}; } catch { return {}; }
  };

  // Storage: extensionSettings (server-synced, outside chat file)
  const _EXT_NAME = 'MemoryPilot';
  const _getStore = () => {
    const c = window.SillyTavern?.getContext?.();
    if (!c?.extensionSettings) return null;
    if (!c.extensionSettings[_EXT_NAME]) c.extensionSettings[_EXT_NAME] = {};
    const ck = String(c.chatId ?? c.chatMetadata?.chat_file_name ?? 'default');
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
  const applyCleaner = (input, cfg) => {
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
      try { text = text.replace(new RegExp(rule, 'gim'), ' '); } catch {}
    }
    return text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  };

  const DEF_RECALL_SETTINGS = { every: 1, alpha: 0.72, stickyTurns: 5, contextWindow: 8, maxRecall: 6 };
  const normalizeRecallSettings = (cfg) => {
    const src = cfg && typeof cfg === 'object' ? cfg : {};
    return {
      every: clamp(Math.round(Number(src.every) || DEF_RECALL_SETTINGS.every), 1, 50),
      alpha: clamp(Number.isFinite(Number(src.alpha)) ? Number(src.alpha) : DEF_RECALL_SETTINGS.alpha, 0, 0.95),
      stickyTurns: clamp(Math.round(Number(src.stickyTurns) ?? DEF_RECALL_SETTINGS.stickyTurns), 0, 20),
      contextWindow: clamp(Math.round(Number(src.contextWindow) || DEF_RECALL_SETTINGS.contextWindow), 3, 30),
      maxRecall: clamp(Math.round(Number(src.maxRecall) || DEF_RECALL_SETTINGS.maxRecall), 1, 20)
    };
  };

  const cleanerCfg = normalizeCleaner(await loadJson(CK, DEF_CLEANER));
  const recallCfg = normalizeRecallSettings(await loadJson(RK, DEF_RECALL_SETTINGS));
  MAX_RECALL = recallCfg.maxRecall || 6;
  const RECALL_EVERY = recallCfg.every;
  const CTX_MSGS = recallCfg.contextWindow || 8;
  const blacklist = new Set(((await loadJson(BK, [])) || []).map(norm).filter(Boolean));

  const escapeRegExp = (s) => String(s ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const isLatinWord = (s) => /^[a-z0-9_-]+$/i.test(String(s ?? '').trim());

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

  const cleanPrimaryKeywords = (mem) => {
    const kws = Array.isArray(mem?.primaryKeywords)
      ? mem.primaryKeywords
      : Array.isArray(mem?.keywords)
        ? mem.keywords
        : [];
    return uniq(kws.map(k => String(k ?? '').trim()).filter(Boolean).filter(k => !blacklist.has(norm(k))));
  };

  const cleanSecondaryKeywords = (mem) => {
    const kws = Array.isArray(mem?.secondaryKeywords) ? mem.secondaryKeywords : [];
    return uniq(kws.map(k => String(k ?? '').trim()).filter(Boolean).filter(k => !blacklist.has(norm(k))));
  };

  const matchKeywordGroup = (text, ctxSet, kws) => {
    const exactList = [];
    const weakList = [];

    for (const kw of kws || []) {
      if (!kw) continue;
      if (exactMatchKeyword(text, kw)) {
        exactList.push(kw);
        continue;
      }
      if (weakMatchKeyword(ctxSet, kw)) weakList.push(kw);
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

  const cleanTextTerms = (text, limit = 18) =>
    extractTerms(text, limit)
      .map(w => String(w ?? '').trim())
      .filter(Boolean)
      .filter(w => !blacklist.has(norm(w)))
      .filter(w => !STOP_WORDS.has(w))
      .slice(0, limit * 2);

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

  let memories = await loadJson(MK, []);
  if (!Array.isArray(memories) || !memories.length) {
    await saveText('mp_recall_pin', '');
    await saveText('mp_recall_ctx', '');
    return;
  }
  memories = dedupeByFingerprint(memories);

  const turnCounter = Math.max(0, Number(metaRoot().turnCounter || 0)) + 1;
  await syncMeta({ turnCounter, recallEvery: RECALL_EVERY });
  // Sticky state: 从 chatMetadata 读取
  const stickyRaw = metaRoot().stickyState || {};
  const STICKY_TURNS = recallCfg.stickyTurns ?? 5;

  // 首轮强制全量评估；后续按 RECALL_EVERY 节奏
  const isEvalTurn = turnCounter <= 1 || turnCounter % RECALL_EVERY === 0;

  if (!isEvalTurn) {
    // 非评估轮：pinned 每轮实时热更新（增删置顶即时生效），ctx 沿用 sticky
    const pinnedOnly = dedupeByFingerprint(memories.filter(m => m.priority === 'high'));
    const fmtPin = pinnedOnly.map(m => `[${m.event}] ${m.summary}`).join('\n');
    // 始终写入，即使为空——确保取消置顶时旧值被清掉
    await saveText('mp_recall_pin', fmtPin);

    const stickyMems = [];
    for (const [sid, st] of Object.entries(stickyRaw)) {
      if (st.turnsLeft > 0 && st.event && st.summary) {
        stickyMems.push(st);
      }
    }
    const fmtCtx = stickyMems.map(s => `[${s.event}] ${s.summary}`).join('\n');
    await saveText('mp_recall_ctx', fmtCtx);

    // 衰减 sticky
    const nextSticky = {};
    for (const [sid, st] of Object.entries(stickyRaw)) {
      if (st.turnsLeft > 1) {
        nextSticky[sid] = { ...st, turnsLeft: st.turnsLeft - 1 };
      }
    }
    await syncMeta({ stickyState: nextSticky });
    return;
  }

  const recent = chat.slice(-CTX_MSGS);
  const currentFloorRange = recent.length ? [chat.length - recent.length + 1, chat.length] : null;
  const recentTexts = recent.map(m => {
    const raw = m?.mes || '';
    return cleanerCfg.cleanForRecall ? applyCleaner(raw, cleanerCfg) : String(raw);
  }).filter(Boolean);

  const contextText = recentTexts.join(' ');
  const contextNorm = norm(contextText);
  const ctxWords = splitWords(contextText);
  const ctxTerms = extractTerms(contextText, 80);
  const ctxSet = new Set([...ctxWords.map(norm), ...ctxTerms.map(norm)].filter(Boolean).filter(w => !blacklist.has(w)));

  const pinned = [];

  // === Floor distance helpers (were missing) ===
  const resolveFloorRange = (mem) => {
    if (mem?.floorRange) return mem.floorRange;
    const m = String(mem?.summary || '').match(/\(#(\d+)(?:-(\d+))?\)/);
    if (m) return [+m[1], +(m[2] || m[1])];
    return null;
  };

  const floorRangeDistance = (a, b) => {
    if (!a || !b) return Infinity;
    const [a0, a1] = a;
    const [b0, b1] = b;
    if (a1 >= b0 && a0 <= b1) return 0;
    return a1 < b0 ? b0 - a1 : a0 - b1;
  };

  const calcDynamicAlpha = (baseAlpha, floorDist, ageNorm) => {
    if (!Number.isFinite(floorDist) || floorDist > 500) {
      return clamp(baseAlpha + ageNorm * 0.15, 0, 0.95);
    }
    const distFactor = clamp(floorDist / 200, 0, 1);
    return clamp(baseAlpha * (0.3 + 0.7 * distFactor), 0, 0.95);
  };

  const primary = [];
  const totalMem = memories.length;

  for (let idx = 0; idx < memories.length; idx++) {
    const mem = memories[idx];
    if (!mem) continue;
    if (mem.priority === 'high') { pinned.push(mem); continue; }

    const primaryKws = cleanPrimaryKeywords(mem);
    if (!primaryKws.length) continue;
    const secondaryKws = cleanSecondaryKeywords(mem);
    
    

    const primaryMatch = matchKeywordGroup(contextText, ctxSet, primaryKws);
    if (primaryMatch.hitCount <= 0) continue;
    if (primaryMatch.exactHitCount <= 0 && primaryMatch.weakHitCount < 2) continue;

    const secondaryMatch = secondaryKws.length
      ? matchKeywordGroup(contextText, ctxSet, secondaryKws)
      : { exact: [], weak: [], exactHitCount: 0, weakHitCount: 0, hitCount: 0 };

    // Secondary keywords: soft gate (miss = penalty, not skip)
    const secondaryMiss = secondaryKws.length > 0 && secondaryMatch.hitCount <= 0;

    const matchedKeywords = uniq([
      ...primaryMatch.exact,
      ...secondaryMatch.exact,
    ]);
    const weakMatchedKeywords = uniq([
      ...primaryMatch.weak,
      ...secondaryMatch.weak,
    ]).filter(k => !matchedKeywords.includes(k));
    const exactHitCount = primaryMatch.exactHitCount + secondaryMatch.exactHitCount;
    const weakHitCount = primaryMatch.weakHitCount + secondaryMatch.weakHitCount;

    const fp = memFingerprint(mem) || String(idx);
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
    
    
    
    
    
    // Probability gate removed: keyword match = trigger (deterministic)
    //  still calculated for debug/monitoring purposes
    

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
    

    primary.push({
      ...mem,
      _score: score,
      _reason: reasons.join('；'),
      _matchedKeywords: matchedKeywords,
      _debugScore: { keywordScore, pw, score, exactHitCount, weakHitCount, distanceAlpha, ageNorm }
    });
  }

  primary.sort((a, b) => b._score - a._score);

  // 分层选择：medium 优先填槽，low 保底至少 1 个槽位（总槽 ≥ 3 且有 low 命中时）
  const maxTriggered = MAX_RECALL;
  const lowCandidates = primary.filter(m => m.priority === 'low');
  const medCandidates = primary.filter(m => m.priority !== 'low');
  const lowReserved = (maxTriggered >= 3 && lowCandidates.length > 0) ? 1 : 0;
  const medCap = maxTriggered - lowReserved;

  const selected = [];
  const seenIds = new Set();
  const seenPrints = new Set();
  const alreadySeen = (mem) => {
    const fp = memFingerprint(mem);
    return seenIds.has(mem?.id) || (fp && seenPrints.has(fp));
  };
  const markSeen = (mem) => {
    if (mem?.id != null) seenIds.add(mem.id);
    const fp = memFingerprint(mem);
    if (fp) seenPrints.add(fp);
  };
  // Pass 1: medium/默认 优先，上限 medCap
  for (const mem of medCandidates) {
    if (selected.length >= medCap) break;
    if (alreadySeen(mem)) continue;
    selected.push(mem);
    markSeen(mem);
  }
  // Pass 2: low 填保底 + 剩余空位
  for (const mem of lowCandidates) {
    if (selected.length >= maxTriggered) break;
    if (alreadySeen(mem)) continue;
    selected.push(mem);
    markSeen(mem);
  }
  // Pass 3: 如果 low 没填满保底（没有匹配的 low），medium 回填
  for (const mem of medCandidates) {
    if (selected.length >= maxTriggered) break;
    if (alreadySeen(mem)) continue;
    selected.push(mem);
    markSeen(mem);
  }

  const finalPinned = dedupeByFingerprint(pinned);
  const finalSelected = dedupeByFingerprint(selected).slice(0, maxTriggered);

  // Sticky 机制：被召回的记忆写入 sticky，下次非评估轮也能注入
  const triggeredIds = new Set(finalSelected.map(m => m.id));
  const nextSticky = {};
  // 新触发的刷新 sticky
  for (const m of finalSelected) {
    nextSticky[m.id] = { event: m.event, summary: m.summary, turnsLeft: STICKY_TURNS };
  }
  // 未触发但还在 sticky 期的保持（衰减）
  for (const [sid, st] of Object.entries(stickyRaw)) {
    if (!triggeredIds.has(sid) && st.turnsLeft > 1) {
      nextSticky[sid] = { ...st, turnsLeft: st.turnsLeft - 1 };
    }
  }
  // 合并 sticky 记忆到输出（补位）
  const stickyExtra = [];
  for (const [sid, st] of Object.entries(nextSticky)) {
    if (!triggeredIds.has(sid) && st.turnsLeft > 0 && st.event && st.summary) {
      stickyExtra.push(st);
    }
  }
  const stickySlots = Math.max(0, maxTriggered - finalSelected.length);
  const finalWithSticky = [...finalSelected, ...stickyExtra.slice(0, stickySlots)];

  await syncMeta({ stickyState: nextSticky });

  const fmtPin = finalPinned.map(m => `[${m.event}] ${m.summary}`).join('\n');
  const fmtCtx = finalWithSticky.map(m => `[${m.event}] ${m.summary}`).join('\n');

  await saveText('mp_recall_pin', fmtPin);
  await saveText('mp_recall_ctx', fmtCtx);
})();
}
