/**
 * MemoryPilot Storage Layer
 * 
 * Architecture:
 *   - extensionSettings.MemoryPilot[chatKey] = full memories (server-synced, NOT in chat jsonl)
 *   - chatMetadata.extensions.MemoryPilot = lightweight pointer only (version, chatKey, floor)
 *   - localStorage = runtime cache (fast access)
 *   - chatMetadata.variables = prompt injection only (mp_recall_pin, mp_recall_ctx)
 * 
 * This avoids:
 *   - LWB_SNAP capturing large mp_memories via setvar/getvar
 *   - chatMetadata bloating the chat jsonl
 *   - saveChat triggering on every recall cycle
 */

const META_NS = 'MemoryPilot';
const MODULE_NAME = 'MemoryPilot';

// Keys that go into extensionSettings (server-synced, separate from chat file)
const STORE_KEYS = {
  memories: 'memories',
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

function getCtx() {
  if (!_ctx) _ctx = SillyTavern?.getContext?.() || window.SillyTavern?.getContext?.();
  return _ctx;
}

function refreshCtx() {
  _ctx = SillyTavern?.getContext?.() || window.SillyTavern?.getContext?.();
  return _ctx;
}

function getChatKey() {
  if (_chatKey) return _chatKey;
  const ctx = getCtx();
  _chatKey = String(ctx?.chatId ?? ctx?.chatMetadata?.chat_file_name ?? 'default');
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
  if (typeof ctx?.saveSettingsDebounced === 'function') {
    clearTimeout(_settingsSaveTimer);
    _settingsSaveTimer = setTimeout(() => {
      try { ctx.saveSettingsDebounced(); } catch (e) { console.warn('[MP] settings save err', e); }
    }, _SETTINGS_DEBOUNCE);
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
  try {
    ctx.chatMetadata = ctx.chatMetadata || {};
    ctx.chatMetadata.variables = ctx.chatMetadata.variables || {};
    ctx.chatMetadata.variables[key] = String(value ?? '');
  } catch {}
  try { localStorage.setItem(key, String(value ?? '')); } catch {}
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

export async function loadMemories() {
  // 1. localStorage cache (fastest)
  try {
    const raw = localStorage.getItem('mp_memories_' + getChatKey());
    if (raw) return JSON.parse(raw);
  } catch {}

  // 2. extensionSettings (server-synced)
  try {
    const store = getChatStore();
    if (store?.memories?.length) {
      cacheMemories(store.memories);
      return store.memories;
    }
  } catch {}

  // 3. Legacy: chatMetadata (migration from old versions)
  try {
    const meta = getPointer();
    if (Array.isArray(meta?.mp_memories) && meta.mp_memories.length) {
      const mems = meta.mp_memories;
      console.log('[MP] Migrating memories from chatMetadata to extensionSettings');
      await saveMemories(mems);
      // Clean up legacy data from chatMetadata
      try {
        const ctx = getCtx();
        delete ctx.chatMetadata.extensions[META_NS].mp_memories;
      } catch {}
      return mems;
    }
  } catch {}

  // 4. Legacy: localStorage old key
  try {
    const raw = localStorage.getItem('mp_memories');
    if (raw) {
      const mems = JSON.parse(raw);
      if (Array.isArray(mems) && mems.length) {
        await saveMemories(mems);
        return mems;
      }
    }
  } catch {}

  return [];
}

function cacheMemories(mems) {
  try { localStorage.setItem('mp_memories_' + getChatKey(), JSON.stringify(mems)); } catch {}
}

export async function saveMemories(mems) {
  const arr = Array.isArray(mems) ? mems : [];
  cacheMemories(arr);

  // Write to extensionSettings (separate from chat file!)
  const store = getChatStore();
  if (store) {
    store.memories = arr;
    saveSettingsDebounced();
  }

  // Update lightweight pointer
  setPointer({
    version: 1,
    chatKey: getChatKey(),
    storeMode: 'extensionSettings',
  });

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
  try { localStorage.setItem('mp_cfg_' + configKey + '_' + getChatKey(), JSON.stringify(value)); } catch {}
  const store = getChatStore();
  if (store) {
    store[configKey] = value;
    saveSettingsDebounced();
  }
}

// ====== Migration: clean bloated chatMetadata from old versions ======

export async function migrateIfNeeded() {
  const ctx = getCtx();
  if (!ctx?.chatMetadata?.extensions?.[META_NS]) return;

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
}

// ====== Chat isolation ======

let _prevChatKey = null;
export function onChatChanged() {
  const newKey = getChatKey();
  if (_prevChatKey && _prevChatKey !== newKey) {
    // Clear runtime caches for old chat
    try { localStorage.removeItem('mp_memories_' + _prevChatKey); } catch {}
  }
  _prevChatKey = newKey;
  resetChatKey();
}

// ====== Sticky State (stored in extensionSettings, not chat metadata) ======

export function loadStickyState() {
  return loadConfig('stickyState', {});
}

export async function saveStickyState(state) {
  await saveConfig('stickyState', state);
}
