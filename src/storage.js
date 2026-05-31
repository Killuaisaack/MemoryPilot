/**
 * MemoryPilot Storage Layer
 *
 * Architecture:
 *   - extensionSettings.MemoryPilot[chatKey] = full memories (server-synced, NOT in chat jsonl)
 *   - chatMetadata.extensions.MemoryPilot = lightweight pointer only (version, chatKey, floor)
 *   - localStorage = runtime cache (fast access, change-detected writes)
 *   - chatMetadata.variables = prompt injection only (mp_recall_pin, mp_recall_ctx)
 *
 * This avoids:
 *   - LWB_SNAP capturing large mp_memories via setvar/getvar
 *   - chatMetadata bloating the chat jsonl
 *   - saveChat triggering on every recall cycle
 *
 * v2.1: + StorageLogger (monitoring), change detection (减少无效写入),
 *       migration idempotency (不再重复弹通知), beforeunload flush (防丢失)
 */

const META_NS = 'MemoryPilot';
const MODULE_NAME = 'MemoryPilot';

// Keys that go into extensionSettings (server-synced, separate from chat file)
const STORE_KEYS = {
  memories: 'memories',
  memoriesJournal: 'memoriesJournal',
  apiConfig: 'apiConfig',
  blacklist: 'blacklist',
  recallSettings: 'recallSettings',
  cleanerConfig: 'cleanerConfig',
  mergePrompt: 'mergePrompt',
  kwPrompt: 'kwPrompt',
};

// Lightweight keys for chatMetadata pointer
const POINTER_KEYS = ['version', 'chatKey', 'lastProcessedFloor', 'lastRecallTurn', 'storeMode'];

let _ctx = null;
let _chatKey = null;
let _settingsSaveTimer = null;
const _SETTINGS_DEBOUNCE = 8000;


// ====== Storage Logger (监控日志) ======

const LOG_KEY = 'mp_storage_log';
const MAX_LOG_ENTRIES = 500;
const LOG_CLEANUP_INTERVAL = 3600000; // 1 hour
const LOG_MAX_AGE = 7 * 24 * 3600000; // 7 days
const MEMORY_CACHE_PREFIX = 'mp_memories_';
const MEMORY_JOURNAL_PREFIX = 'mp_memories_journal_';
const MEMORY_BACKUP_SUFFIX = '.bak';
const MAX_MEMORY_SNAPSHOTS = 5;

let _logBuffer = [];
let _logTimer = null;
let _logCleanupTimer = null;

function logOp(action, key, detail = '') {
  const entry = {
    ts: Date.now(),
    action,
    key,
    detail: String(detail).slice(0, 200),
    chat: getChatKey().slice(0, 40),
  };
  _logBuffer.push(entry);
  if (!_logTimer) {
    _logTimer = setTimeout(flushLog, 2000);
  }
  // 错误和迁移类操作同步输出到 console
  if (action === 'error' || action === 'migrate') {
    console.log(`[MP:${action}] ${key} ${detail}`);
  }
}

function flushLog() {
  _logTimer = null;
  if (!_logBuffer.length) return;
  try {
    let existing = [];
    try {
      const raw = localStorage.getItem(LOG_KEY);
      if (raw) existing = JSON.parse(raw);
    } catch {}
    const merged = [...existing, ..._logBuffer].slice(-MAX_LOG_ENTRIES);
    localStorage.setItem(LOG_KEY, JSON.stringify(merged));
    _logBuffer = [];
  } catch (e) { /* silent */ }
}

function startLogCleanup() {
  if (_logCleanupTimer) return;
  _logCleanupTimer = setInterval(() => {
    try {
      const raw = localStorage.getItem(LOG_KEY);
      if (!raw) return;
      let entries;
      try { entries = JSON.parse(raw); } catch { return; }
      if (!Array.isArray(entries)) return;
      // 按数量裁剪
      if (entries.length > MAX_LOG_ENTRIES) {
        entries = entries.slice(-MAX_LOG_ENTRIES);
      }
      // 按时间裁剪（7天以上删除）
      const cutoff = Date.now() - LOG_MAX_AGE;
      const fresh = entries.filter(e => e && e.ts > cutoff);
      if (fresh.length !== entries.length) {
        entries = fresh;
      }
      localStorage.setItem(LOG_KEY, JSON.stringify(entries));
    } catch {}
  }, LOG_CLEANUP_INTERVAL);
}

export function getStorageLogs(limit = 50) {
  // Flush pending buffer first
  flushLog();
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return [];
    return entries.slice(-limit);
  } catch { return []; }
}

export function clearStorageLogs() {
  try { localStorage.removeItem(LOG_KEY); } catch {}
  _logBuffer = [];
}


// ====== Migration tracking (防止重复迁移/弹通知) ======

const MIGRATED_KEY = 'mp_migrated_chats';

function isChatMigrated() {
  try {
    const raw = localStorage.getItem(MIGRATED_KEY);
    if (!raw) return false;
    const set = JSON.parse(raw);
    return Array.isArray(set) && set.includes(getChatKey());
  } catch { return false; }
}

function markChatMigrated() {
  try {
    const raw = localStorage.getItem(MIGRATED_KEY);
    const set = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
    if (!set.includes(getChatKey())) {
      set.push(getChatKey());
      localStorage.setItem(MIGRATED_KEY, JSON.stringify(set.slice(-100)));
    }
  } catch {}
}


// ====== Utilities ======

function byteLen(value) {
  try { return new Blob([typeof value === "string" ? value : JSON.stringify(value)]).size; } catch {
    try { return JSON.stringify(value).length * 2; } catch { return 0; }
  }
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function formatBytes(n) {
  const num = Number(n) || 0;
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / 1024 / 1024).toFixed(2)} MB`;
}

function resolveSillyTavernContext() {
  const st = globalThis.SillyTavern || globalThis.window?.SillyTavern;
  return st?.getContext?.() || null;
}

function getCtx() {
  if (!_ctx) _ctx = resolveSillyTavernContext();
  return _ctx;
}

function refreshCtx() {
  _ctx = resolveSillyTavernContext();
  return _ctx;
}

function getChatKey() {
  if (_chatKey) return _chatKey;
  const ctx = getCtx();
  const charId = ctx?.characterId;
  const charObj = Number.isInteger(charId) ? ctx?.characters?.[charId] : null;
  const charScope = String(
    charObj?.avatar ??
    charObj?.name ??
    ctx?.chatMetadata?.character_name ??
    ctx?.name2 ??
    ''
  );
  const baseChat = String(ctx?.chatId ?? ctx?.chatMetadata?.chat_file_name ?? 'default');
  _chatKey = `${baseChat}::${charScope}`;
  return _chatKey;
}

export function resetChatKey() {
  _chatKey = null;
  _ctx = null;
}

// ====== Extension Settings Store (server-synced, NOT in chat file) ======

function getStore() {
  const ctx = getCtx();
  if (!ctx?.extensionSettings) return null;
  if (!ctx.extensionSettings[MODULE_NAME]) {
    ctx.extensionSettings[MODULE_NAME] = {};
  }
  return ctx.extensionSettings[MODULE_NAME];
}

function getChatStore() {
  const store = getStore();
  if (!store) return null;
  const key = getChatKey();
  if (!store[key]) store[key] = {};
  return store[key];
}

function saveSettingsDebounced() {
  const ctx = getCtx();
  if (typeof ctx?.saveSettingsDebounced !== 'function') return;
  clearTimeout(_settingsSaveTimer);
  _settingsSaveTimer = setTimeout(() => {
    try { ctx.saveSettingsDebounced(); } catch (e) { console.warn('[MP] settings save err', e); }
  }, _SETTINGS_DEBOUNCE);
}

function flushSettingsNow() {
  clearTimeout(_settingsSaveTimer);
  const ctx = getCtx();
  try {
    if (typeof ctx?.saveSettings === 'function') ctx.saveSettings();
    else if (typeof ctx?.saveSettingsDebounced?.flush === 'function') ctx.saveSettingsDebounced.flush();
    else if (typeof ctx?.saveSettingsDebounced === 'function') ctx.saveSettingsDebounced();
  } catch {}
}

export function flushStorageNow() {
  flushLog();
  flushSettingsNow();
}

function memoryCacheKey() {
  return MEMORY_CACHE_PREFIX + getChatKey();
}

function memoryJournalKey() {
  return MEMORY_JOURNAL_PREFIX + getChatKey();
}

function readJsonArrayFromLocalStorage(key, label) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { found: false, value: null };
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { found: true, value: parsed };
    logOp('error', label, 'not an array');
    return { found: true, value: null };
  } catch (e) {
    logOp('error', label, `parse failed: ${e?.message || e}`);
    return { found: true, value: null };
  }
}

function writeLocalStorageWithBackup(key, jsonStr, label) {
  try {
    const old = localStorage.getItem(key);
    if (old && old !== jsonStr) {
      try { localStorage.setItem(key + MEMORY_BACKUP_SUFFIX, old); } catch {}
    }
    localStorage.setItem(key, jsonStr);
    return true;
  } catch (e) {
    logOp('error', label, `localStorage write failed: ${e?.message || e}`);
    return false;
  }
}

// ====== Chat Metadata Pointer (lightweight, lives in chat file) ======

function getPointer() {
  const ctx = getCtx();
  try {
    return ctx?.chatMetadata?.extensions?.[META_NS] || {};
  } catch { return {}; }
}

function setPointer(patch) {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    ctx.chatMetadata = ctx.chatMetadata || {};
    ctx.chatMetadata.extensions = ctx.chatMetadata.extensions || {};
    const ns = ctx.chatMetadata.extensions[META_NS] = ctx.chatMetadata.extensions[META_NS] || {};
    for (const [k, v] of Object.entries(patch || {})) {
      if (POINTER_KEYS.includes(k)) ns[k] = v;
    }
    // DON'T call saveMetadata here - let ST's own debounce handle it
  } catch (e) { console.warn('[MP] setPointer err', e); }
}

// ====== Prompt Variable Injection (write to chatMetadata.variables only) ======

export function injectVar(key, value) {
  const ctx = getCtx();
  const strVal = String(value ?? '');

  // 变更检测：如果值相同则跳过
  try {
    if (ctx?.chatMetadata?.variables?.[key] === strVal) {
      // 值不变，但仍确保 localStorage 同步（可能被清除过）
      try {
        if (localStorage.getItem(key) !== strVal) {
          localStorage.setItem(key, strVal);
        }
      } catch {}
      return;
    }
  } catch {}

  try {
    ctx.chatMetadata = ctx.chatMetadata || {};
    ctx.chatMetadata.variables = ctx.chatMetadata.variables || {};
    ctx.chatMetadata.variables[key] = strVal;
  } catch {}
  try { localStorage.setItem(key, strVal); } catch {}
  logOp('inject', key, `len=${strVal.length}`);
}

export function readVar(key) {
  const ctx = getCtx();
  try {
    const v = ctx?.chatMetadata?.variables?.[key];
    if (v != null) return String(v);
  } catch {}
  try {
    const v = localStorage.getItem(key);
    if (v != null) return v;
  } catch {}
  return '';
}

// ====== Memory CRUD ======

// 缓存最后写入的 memories 签名，用于变更检测
let _lastMemoriesSignature = null;

function stringifyMemories(mems) {
  try { return JSON.stringify(Array.isArray(mems) ? mems : []); } catch { return '[]'; }
}

function getMemoriesSignature(mems) {
  if (!Array.isArray(mems)) return null;
  // 使用数量和首尾 id/summary 的快速哈希，避免完整 JSON.stringify
  const json = stringifyMemories(mems);
  return `${mems.length}|${json.length}|${hashString(json)}`;
}

function normalizeMemorySnapshots(value) {
  return Array.isArray(value)
    ? value.filter(s => s && Array.isArray(s.memories) && s.memories.length)
    : [];
}

function readLocalMemorySnapshots() {
  try {
    const raw = localStorage.getItem(memoryJournalKey());
    return raw ? normalizeMemorySnapshots(JSON.parse(raw)) : [];
  } catch (e) {
    logOp('error', 'memoriesJournal', `parse failed: ${e?.message || e}`);
    return [];
  }
}

function readStoreMemorySnapshots() {
  try {
    return normalizeMemorySnapshots(getChatStore()?.memoriesJournal);
  } catch { return []; }
}

function mergeMemorySnapshots(...groups) {
  const out = [];
  const seen = new Set();
  for (const snap of groups.flat()) {
    const sig = snap.signature || getMemoriesSignature(snap.memories);
    if (!sig || seen.has(sig)) continue;
    seen.add(sig);
    out.push({ ...snap, signature: sig });
  }
  return out
    .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0))
    .slice(0, MAX_MEMORY_SNAPSHOTS);
}

function getMemorySnapshots() {
  return mergeMemorySnapshots(readLocalMemorySnapshots(), readStoreMemorySnapshots());
}

function persistMemorySnapshots(snapshots) {
  const normalized = normalizeMemorySnapshots(snapshots).slice(0, MAX_MEMORY_SNAPSHOTS);
  const json = JSON.stringify(normalized);
  writeLocalStorageWithBackup(memoryJournalKey(), json, 'memoriesJournal');
  try {
    const store = getChatStore();
    if (store) {
      store.memoriesJournal = normalized;
      saveSettingsDebounced();
    }
  } catch (e) {
    logOp('error', 'memoriesJournal', `store write failed: ${e?.message || e}`);
  }
}

function snapshotMemories(mems, reason = 'save') {
  if (!Array.isArray(mems) || !mems.length) return;
  const signature = getMemoriesSignature(mems);
  const existing = getMemorySnapshots();
  if (existing[0]?.signature === signature) return;
  const snap = {
    ts: Date.now(),
    reason,
    count: mems.length,
    signature,
    memories: mems,
  };
  persistMemorySnapshots(mergeMemorySnapshots([snap], existing));
  logOp('snapshot', 'memories', `${reason}: ${mems.length} items`);
}

function latestMemorySnapshot() {
  return getMemorySnapshots()[0] || null;
}

export function getMemoryRecoverySnapshots(limit = MAX_MEMORY_SNAPSHOTS) {
  return getMemorySnapshots().slice(0, Math.max(1, Number(limit) || MAX_MEMORY_SNAPSHOTS));
}

export async function restoreMemoriesFromSnapshot(index = 0) {
  const snap = getMemorySnapshots()[Math.max(0, Number(index) || 0)];
  if (!snap) return [];
  logOp('recover', 'memories', `manual snapshot: ${snap.count || snap.memories.length} items`);
  _lastMemoriesSignature = null;
  return saveMemories(snap.memories);
}

export async function loadMemories() {
  const cache = readJsonArrayFromLocalStorage(memoryCacheKey(), 'memoriesCache');
  if (Array.isArray(cache.value) && cache.value.length) {
    logOp('load', 'memories', `from cache: ${cache.value.length} items`);
    snapshotMemories(cache.value, 'load-cache');
    return cache.value;
  }

  // 2. extensionSettings (server-synced)
  try {
    const store = getChatStore();
    const stored = Array.isArray(store?.memories) && store.memories.length
      ? store.memories
      : (Array.isArray(store?.mp_memories) && store.mp_memories.length ? store.mp_memories : null);
    if (stored) {
      cacheMemories(stored);
      snapshotMemories(stored, 'load-store');
      logOp('load', 'memories', `from extSettings: ${stored.length} items`);
      return stored;
    }
  } catch {}

  if (Array.isArray(cache.value)) {
    logOp('load', 'memories', `from empty cache: ${cache.value.length} items`);
    return cache.value;
  }

  // 3. Legacy: chatMetadata (migration from old versions)
  try {
    const meta = getPointer();
    if (Array.isArray(meta?.mp_memories) && meta.mp_memories.length) {
      const mems = meta.mp_memories;
      console.log('[MP] Migrating memories from chatMetadata to extensionSettings');
      logOp('migrate', 'memories', `from chatMetadata: ${mems.length} items`);
      await saveMemories(mems);
      // Clean up legacy data from chatMetadata
      try {
        const ctx = getCtx();
        delete ctx.chatMetadata.extensions[META_NS].mp_memories;
      } catch {}
      return mems;
    }
  } catch {}

  const legacy = readJsonArrayFromLocalStorage('mp_memories', 'legacyMemories');
  if (Array.isArray(legacy.value) && legacy.value.length) {
    logOp('migrate', 'memories', `from legacy localStorage: ${legacy.value.length} items`);
    await saveMemories(legacy.value);
    return legacy.value;
  }

  const backup = readJsonArrayFromLocalStorage(memoryCacheKey() + MEMORY_BACKUP_SUFFIX, 'memoriesBackup');
  if (Array.isArray(backup.value) && backup.value.length) {
    logOp('recover', 'memories', `from cache backup: ${backup.value.length} items`);
    _lastMemoriesSignature = null;
    await saveMemories(backup.value);
    return backup.value;
  }

  if (!cache.found && !legacy.found) {
    const snap = latestMemorySnapshot();
    if (snap?.memories?.length) {
      logOp('recover', 'memories', `from snapshot: ${snap.memories.length} items`);
      _lastMemoriesSignature = null;
      await saveMemories(snap.memories);
      return snap.memories;
    }
  }

  logOp('load', 'memories', 'empty');
  return [];
}

function cacheMemories(mems, jsonStr = null) {
  const text = jsonStr || stringifyMemories(mems);
  writeLocalStorageWithBackup(memoryCacheKey(), text, 'memoriesCache');
  writeLocalStorageWithBackup('mp_memories', text, 'legacyMemoriesCache');
}

export async function saveMemories(mems) {
  const arr = Array.isArray(mems) ? mems : [];
  const jsonStr = stringifyMemories(arr);

  // 变更检测：签名相同则跳过 extensionSettings 写入
  const sig = getMemoriesSignature(arr);
  if (sig === _lastMemoriesSignature && sig !== null) {
    cacheMemories(arr, jsonStr);
    // 仅更新 localStorage 缓存（可能被外部清除）
    cacheMemories(arr);
    return arr;
  }
  _lastMemoriesSignature = sig;

  cacheMemories(arr, jsonStr);
  snapshotMemories(arr, 'save');

  // Write to extensionSettings (separate from chat file!)
  const store = getChatStore();
  if (store) {
    store.memories = arr;
    store.mp_memories = arr;
    saveSettingsDebounced();
  }

  // Update lightweight pointer (只在真正变更时写)
  setPointer({
    version: 1,
    chatKey: getChatKey(),
    storeMode: 'extensionSettings',
  });

  logOp('save', 'memories', `${arr.length} items`);
  return arr;
}

// ====== Config CRUD (api, blacklist, recall settings, etc.) ======

export function loadConfig(configKey, fallback) {
  // localStorage first
  try {
    const raw = localStorage.getItem('mp_cfg_' + configKey + '_' + getChatKey());
    if (raw) return JSON.parse(raw);
  } catch {}
  // extensionSettings
  try {
    const store = getChatStore();
    if (store?.[configKey] != null) return store[configKey];
  } catch {}
  // Legacy chatMetadata
  try {
    const meta = getPointer();
    if (meta?.[configKey] != null) return meta[configKey];
  } catch {}
  return fallback;
}

export async function saveConfig(configKey, value) {
  const jsonStr = JSON.stringify(value);

  // 变更检测
  try {
    const existing = localStorage.getItem('mp_cfg_' + configKey + '_' + getChatKey());
    if (existing === jsonStr) {
      // Already in localStorage, ensure extensionSettings is synced
      const store = getChatStore();
      if (store && JSON.stringify(store[configKey]) !== jsonStr) {
        store[configKey] = value;
        saveSettingsDebounced();
      }
      return;
    }
  } catch {}

  try { localStorage.setItem('mp_cfg_' + configKey + '_' + getChatKey(), jsonStr); } catch {}
  const store = getChatStore();
  if (store) {
    store[configKey] = value;
    saveSettingsDebounced();
  }
  logOp('save', configKey, `size=${jsonStr.length}`);
}

// ====== Migration: clean bloated chatMetadata from old versions ======

export async function migrateIfNeeded() {
  // 幂等性：已迁移过的聊天跳过
  if (isChatMigrated()) return;

  const ctx = getCtx();
  if (!ctx?.chatMetadata?.extensions?.[META_NS]) {
    // 没有旧数据，也标记为已迁移以避免重复检查
    markChatMigrated();
    return;
  }

  const ns = ctx.chatMetadata.extensions[META_NS];
  let cleaned = false;

  // Remove ephemeral keys that old MP versions stored in metadata
  const ephemeralKeys = [
    'stickyState', 'turnCounter', 'recallEvery',
    'mp_recall_pin', 'mp_recall_ctx', 'mp_pending_ops',
    'mp_kw_blacklist', 'mp_text_clean_cfg', 'mp_recall_settings',
    'mp_api_config',
  ];
  for (const k of ephemeralKeys) {
    if (ns[k] != null) { delete ns[k]; cleaned = true; }
  }

  // Migrate memories to extensionSettings if they're still in metadata
  if (Array.isArray(ns.mp_memories) && ns.mp_memories.length) {
    console.log(`[MP] Migrating ${ns.mp_memories.length} memories from chatMetadata`);
    logOp('migrate', 'chatMetadata→extSettings', `${ns.mp_memories.length} memories`);
    await saveMemories(ns.mp_memories);
    delete ns.mp_memories;
    cleaned = true;
  }

  // Clean chatMetadata.variables of mp_ keys
  if (ctx.chatMetadata?.variables) {
    for (const k of Object.keys(ctx.chatMetadata.variables)) {
      if (k.startsWith('mp_') && k !== 'mp_recall_pin' && k !== 'mp_recall_ctx') {
        delete ctx.chatMetadata.variables[k];
        cleaned = true;
      }
    }
  }

  if (cleaned) {
    console.log('[MP] Migration: cleaned bloated chatMetadata');
    // Keep only pointer keys
    const pointer = {};
    for (const k of POINTER_KEYS) {
      if (ns[k] != null) pointer[k] = ns[k];
    }
    pointer.storeMode = 'extensionSettings';
    pointer.chatKey = getChatKey();
    ctx.chatMetadata.extensions[META_NS] = pointer;

    try {
      if (typeof ctx.saveMetadata === 'function') await ctx.saveMetadata();
      else if (typeof ctx.saveChatMetadata === 'function') await ctx.saveChatMetadata();
    } catch (e) { console.warn('[MP] migration save err', e); }
  }

  // 标记已迁移，下次不再重复
  markChatMigrated();
  logOp('migrate', 'done', cleaned ? 'cleaned' : 'no-legacy');
}

// ====== Chat isolation ======

let _prevChatKey = null;
export function onChatChanged() {
  resetChatKey();
  const newKey = getChatKey();
  if (_prevChatKey && _prevChatKey !== newKey) {
    try { localStorage.removeItem('mp_memories_' + _prevChatKey); } catch {}
  }
  _prevChatKey = newKey;
  // 重置迁移标记（不同聊天可能需要迁移）
  // 但实际迁移检查在 migrateIfNeeded 内部做
}

// ====== Sticky State (stored in extensionSettings, not chat metadata) ======

export function loadStickyState() {
  return loadConfig('stickyState', {});
}

export async function saveStickyState(state) {
  await saveConfig('stickyState', state);
}


// ====== Legacy artifact detection / cleanup ======

export function detectLegacyArtifacts() {
  const ctx = getCtx();
  const report = {
    hasLegacyMpMetadata: false,
    hasLegacyMpVars: false,
    lwbSnapHasMpTraces: false,
    lwbSnapEntryCount: 0,
    lwbSnapMpTraceCount: 0,
    lwbSnapSize: 0,
    mpMetadataSize: 0,
    mpVarCount: 0,
    mpVarSize: 0,
    keys: [],
    summary: '',
  };

  try {
    const ns = ctx?.chatMetadata?.extensions?.[META_NS];
    if (ns && Object.keys(ns).length) {
      report.hasLegacyMpMetadata = true;
      report.mpMetadataSize = byteLen(ns);
      report.keys.push('chat_metadata.extensions.MemoryPilot');
    }
  } catch {}

  try {
    const vars = ctx?.chatMetadata?.variables || {};
    const mpKeys = Object.keys(vars).filter(k => String(k).startsWith('mp_'));
    if (mpKeys.length) {
      report.hasLegacyMpVars = true;
      report.mpVarCount = mpKeys.length;
      report.mpVarSize = byteLen(Object.fromEntries(mpKeys.map(k => [k, vars[k]])));
      report.keys.push(`chat_metadata.variables(mp_* x${mpKeys.length})`);
    }
  } catch {}

  try {
    const snap = ctx?.chatMetadata?.LWB_SNAP;
    if (snap && typeof snap === 'object') {
      report.lwbSnapEntryCount = Object.keys(snap).length;
      report.lwbSnapSize = byteLen(snap);
      for (const entry of Object.values(snap)) {
        const vars = entry?.vars;
        if (!vars || typeof vars !== 'object') continue;
        const mpKeys = Object.keys(vars).filter(k => String(k).startsWith('mp_'));
        if (mpKeys.length) {
          report.lwbSnapHasMpTraces = true;
          report.lwbSnapMpTraceCount += mpKeys.length;
        }
      }
      if (report.lwbSnapHasMpTraces) {
        report.keys.push(`chat_metadata.LWB_SNAP(mp_* traces x${report.lwbSnapMpTraceCount})`);
      }
    }
  } catch {}

  const parts = [];
  if (report.hasLegacyMpMetadata) parts.push(`MP元数据 ${formatBytes(report.mpMetadataSize)}`);
  if (report.hasLegacyMpVars) parts.push(`MP变量 ${report.mpVarCount}项 / ${formatBytes(report.mpVarSize)}`);
  if (report.lwbSnapHasMpTraces) parts.push(`LWB快照中的MP痕迹 ${report.lwbSnapMpTraceCount}项 / ${formatBytes(report.lwbSnapSize)}`);
  report.summary = parts.length ? parts.join('；') : '未发现旧版 MP / LWB 快照痕迹';
  return report;
}

export async function cleanupLegacyArtifacts(options = {}) {
  const ctx = getCtx();
  const opts = {
    removeMpMetadata: options.removeMpMetadata !== false,
    removeMpVariables: options.removeMpVariables !== false,
    removeLwbMpTraces: options.removeLwbMpTraces === true,
    pruneEmptyLwbEntries: options.pruneEmptyLwbEntries !== false,
    removeLegacyLocalStorage: options.removeLegacyLocalStorage !== false,
  };
  const result = {
    removedMpMetadata: false,
    removedMpVariables: [],
    removedLwbSnapVars: 0,
    prunedLwbSnapEntries: 0,
    removedLocalStorage: [],
    changed: false,
  };

  if (!ctx) return result;
  ctx.chatMetadata = ctx.chatMetadata || {};

  try {
    if (opts.removeMpMetadata && ctx.chatMetadata?.extensions?.[META_NS]) {
      delete ctx.chatMetadata.extensions[META_NS];
      result.removedMpMetadata = true;
      result.changed = true;
    }
  } catch {}

  try {
    if (opts.removeMpVariables && ctx.chatMetadata?.variables) {
      for (const k of Object.keys(ctx.chatMetadata.variables)) {
        if (String(k).startsWith('mp_')) {
          delete ctx.chatMetadata.variables[k];
          result.removedMpVariables.push(k);
          result.changed = true;
        }
      }
      if (!Object.keys(ctx.chatMetadata.variables).length) delete ctx.chatMetadata.variables;
    }
  } catch {}

  try {
    if (opts.removeLwbMpTraces && ctx.chatMetadata?.LWB_SNAP && typeof ctx.chatMetadata.LWB_SNAP === 'object') {
      for (const snapKey of Object.keys(ctx.chatMetadata.LWB_SNAP)) {
        const entry = ctx.chatMetadata.LWB_SNAP[snapKey];
        if (entry?.vars && typeof entry.vars === 'object') {
          for (const key of Object.keys(entry.vars)) {
            if (String(key).startsWith('mp_')) {
              delete entry.vars[key];
              result.removedLwbSnapVars += 1;
              result.changed = true;
            }
          }
          if (!Object.keys(entry.vars).length) delete entry.vars;
        }
        const rulesEmpty = !entry?.rules || (typeof entry.rules === 'object' && !Object.keys(entry.rules).length);
        const varsEmpty = !entry?.vars || (typeof entry.vars === 'object' && !Object.keys(entry.vars).length);
        if (opts.pruneEmptyLwbEntries && rulesEmpty && varsEmpty) {
          delete ctx.chatMetadata.LWB_SNAP[snapKey];
          result.prunedLwbSnapEntries += 1;
          result.changed = true;
        }
      }
      if (!Object.keys(ctx.chatMetadata.LWB_SNAP).length) delete ctx.chatMetadata.LWB_SNAP;
    }
  } catch {}

  if (opts.removeLegacyLocalStorage) {
    const legacyKeys = [
      'mp_memories','mp_recall_pin','mp_recall_ctx','mp_api_config','mp_prompt','mp_kw_rebuild_prompt',
      'mp_kw_blacklist','mp_text_clean_cfg','mp_recall_settings','mp_pending_ops'
    ];
    for (const k of legacyKeys) {
      try {
        if (localStorage.getItem(k) != null) {
          localStorage.removeItem(k);
          result.removedLocalStorage.push(k);
        }
      } catch {}
    }
  }

  // Rebuild minimal pointer after cleanup
  try {
    setPointer({ version: 1, chatKey: getChatKey(), storeMode: 'extensionSettings' });
  } catch {}

  if (result.changed) {
    try {
      if (typeof ctx.saveMetadata === 'function') await ctx.saveMetadata();
      else if (typeof ctx.saveChatMetadata === 'function') await ctx.saveChatMetadata();
      else if (typeof ctx.saveChat === 'function') await ctx.saveChat();
    } catch (e) { console.warn('[MP] cleanup save err', e); }
  }

  logOp('cleanup', 'legacyArtifacts', `changed=${result.changed}`);
  return result;
}


// ====== Startup / Lifecycle ======

// 启动日志定时清理
startLogCleanup();

// beforeunload: 强制刷入待保存数据，防止关闭时丢失
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    flushLog();
    flushSettingsNow();
  });

  // 页面隐藏时也尝试刷入（移动端切换应用、锁屏）
  window.addEventListener('pagehide', () => {
    flushLog();
    flushSettingsNow();
  });
}

// 定期刷日志（每30秒），防止长时间不触发 flush 导致积压
setInterval(() => {
  if (_logBuffer.length > 0) flushLog();
}, 30000);

console.log('[MP] Storage layer v2.1 loaded (logger, change-detection, migration-idempotency, beforeunload-flush)');
