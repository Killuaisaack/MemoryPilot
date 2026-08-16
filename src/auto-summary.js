import { loadConfig, saveConfig, loadMemories, saveMemories } from './storage.js';
import {
  DEFAULT_SUMMARY_PROMPT,
  normalizeCleaner,
  loadLegacyPanelValue,
  getAutoSummaryPrompt,
  buildFloorText,
  callConfiguredLLM,
  parseSummaryMemories,
  normalizePriority,
} from './summary-service.js';

export const AUTO_SUMMARY_DEFAULTS = Object.freeze({
  enabled: false,
  interval: 20,
  startFloor: 1,
  priorityMode: 'ai',
  priorityModeVersion: 2,
  fixedPriority: 'medium',
  hideSummarized: false,
  keepRecent: 6,
});

const STATE_DEFAULTS = Object.freeze({
  nextFloor: 1,
  completedThrough: 0,
  paused: false,
  running: false,
  lastStatus: '尚未开始自动总结。',
  lastError: '',
  lastRange: null,
  lastRunAt: 0,
});

let running = false;
let visibilityHandler = null;
let saveChatHandler = null;
let hookedContext = null;
let popupTimer = null;

const clampInt = (value, fallback, min, max) => Math.max(min, Math.min(max, Math.round(Number.isFinite(Number(value)) ? Number(value) : fallback)));

export function normalizeAutoSummaryConfig(value) {
  const src = value && typeof value === 'object' ? value : {};
  return {
    enabled: src.enabled === true,
    interval: clampInt(src.interval, 20, 2, 200),
    startFloor: clampInt(src.startFloor, 1, 1, 999999),
    // Before 4.0.0 the implicit default was fixed/medium. Treat that
    // unmarked legacy value as the new AI-assisted mode; once the user saves
    // the setting, an explicit fixed choice is kept.
    priorityMode: src.priorityModeVersion === 2 && src.priorityMode === 'fixed' ? 'fixed' : 'ai',
    priorityModeVersion: 2,
    fixedPriority: normalizePriority(src.fixedPriority),
    hideSummarized: src.hideSummarized === true,
    keepRecent: clampInt(src.keepRecent, 6, 0, 200),
  };
}

export function normalizeAutoSummaryState(value, config = loadAutoSummaryConfig()) {
  const src = value && typeof value === 'object' ? value : {};
  const storedStatus = String(src.lastStatus || STATE_DEFAULTS.lastStatus);
  return {
    nextFloor: clampInt(src.nextFloor, config.startFloor, 1, 999999),
    completedThrough: clampInt(src.completedThrough, Math.max(0, config.startFloor - 1), 0, 999999),
    paused: src.paused === true,
    running,
    lastStatus: !running && /^正在总结/.test(storedStatus) ? '上次自动总结被页面刷新或聊天切换中止，将在下一次 AI 回复后重试。' : storedStatus,
    lastError: String(src.lastError || ''),
    lastRange: Array.isArray(src.lastRange) && src.lastRange.length >= 2 ? [Number(src.lastRange[0]), Number(src.lastRange[1])] : null,
    lastRunAt: Number(src.lastRunAt) || 0,
  };
}

export function loadAutoSummaryConfig() {
  return normalizeAutoSummaryConfig(loadConfig('autoSummary', AUTO_SUMMARY_DEFAULTS));
}

export function loadAutoSummaryState() {
  const config = loadAutoSummaryConfig();
  return normalizeAutoSummaryState(loadConfig('autoSummaryState', { ...STATE_DEFAULTS, nextFloor: config.startFloor }), config);
}

export function loadAutoSummaryPrompt() {
  return getAutoSummaryPrompt();
}

export function getDefaultAutoSummaryPrompt() {
  return DEFAULT_SUMMARY_PROMPT;
}

export function saveAutoSummaryPrompt(value) {
  const prompt = String(value ?? '').trim();
  if (!prompt) throw new Error('自动总结 Prompt 不能为空');
  if (!prompt.includes('{{content}}')) throw new Error('Prompt 中需要保留 {{content}}，用于放入待总结的楼层内容');
  globalThis.MemoryPilot?.saveCustomPrompt?.('autoSummary', prompt);
  return prompt;
}

export function resetAutoSummaryPrompt() {
  globalThis.MemoryPilot?.resetCustomPrompt?.('autoSummary');
  return DEFAULT_SUMMARY_PROMPT;
}

function closeAutoSummaryPopup() {
  if (popupTimer) {
    clearTimeout(popupTimer);
    popupTimer = null;
  }
  try { globalThis.document?.getElementById('memorypilot-auto-summary-popup')?.remove(); } catch {}
}

function showAutoSummaryPopup(kind, title, message, autoClose = 0) {
  const doc = globalThis.document;
  if (!doc?.body) return;
  closeAutoSummaryPopup();
  let dark = true;
  try { dark = globalThis.MemoryPilot?.getSettings?.()?.panelTheme !== 'light'; } catch {}
  const colors = dark
    ? { bg: '#292a2f', border: 'rgba(196,181,253,.42)', text: '#eeeeF2', muted: '#b8b5c2', accent: '#c4b5fd' }
    : { bg: '#ffffff', border: '#d8cce4', text: '#3f3547', muted: '#6f6577', accent: '#745b91' };
  const icon = kind === 'running' ? '✦' : kind === 'success' ? '✓' : kind === 'error' ? '!' : 'i';
  const popup = doc.createElement('div');
  popup.id = 'memorypilot-auto-summary-popup';
  popup.setAttribute('role', 'status');
  popup.setAttribute('aria-live', 'polite');
  Object.assign(popup.style, {
    position: 'fixed',
    right: '18px',
    bottom: '18px',
    zIndex: '2147483000',
    width: 'min(360px, calc(100vw - 36px))',
    boxSizing: 'border-box',
    padding: '13px 42px 13px 14px',
    borderRadius: '12px',
    border: `1px solid ${colors.border}`,
    background: colors.bg,
    color: colors.text,
    boxShadow: dark ? '0 14px 38px rgba(0,0,0,.5)' : '0 14px 38px rgba(62,48,73,.2)',
    fontFamily: 'inherit',
  });
  const heading = doc.createElement('div');
  heading.textContent = `${icon} ${title}`;
  Object.assign(heading.style, { fontSize: '13px', fontWeight: '700', color: colors.accent, marginBottom: '5px' });
  const body = doc.createElement('div');
  body.textContent = String(message || '');
  Object.assign(body.style, { fontSize: '12px', lineHeight: '1.55', color: colors.muted, whiteSpace: 'pre-line' });
  const close = doc.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', '关闭提示');
  Object.assign(close.style, {
    position: 'absolute',
    top: '7px',
    right: '9px',
    width: '28px',
    height: '28px',
    padding: '0',
    border: '0',
    borderRadius: '7px',
    background: 'transparent',
    color: colors.muted,
    fontSize: '20px',
    cursor: 'pointer',
  });
  close.onclick = closeAutoSummaryPopup;
  popup.append(heading, body, close);
  doc.body.appendChild(popup);
  if (autoClose > 0) popupTimer = setTimeout(closeAutoSummaryPopup, autoClose);
}

function notifyState(state) {
  try { globalThis.dispatchEvent(new CustomEvent('memorypilot:auto-summary-state', { detail: state })); } catch {}
}

async function persistState(patch) {
  const current = loadAutoSummaryState();
  const next = normalizeAutoSummaryState({ ...current, ...patch }, loadAutoSummaryConfig());
  next.running = running;
  await saveConfig('autoSummaryState', next);
  notifyState(next);
  return next;
}

export async function saveAutoSummaryConfig(value) {
  const previous = loadAutoSummaryConfig();
  const next = normalizeAutoSummaryConfig({ ...(value || {}), priorityModeVersion: 2 });
  await saveConfig('autoSummary', next);
  if (previous.startFloor !== next.startFloor) {
    await persistState({
      nextFloor: next.startFloor,
      completedThrough: Math.max(0, next.startFloor - 1),
      paused: false,
      lastError: '',
      lastRange: null,
      lastStatus: `已从第 ${next.startFloor} 楼重新开始计算。`,
    });
  }
  await syncAutoHiddenMessages();
  return next;
}

function priorityLabel(priority) {
  return priority === 'high' ? '常驻' : priority === 'low' ? '次级触发' : '主要触发';
}

function memoryFingerprint(memory) {
  const clean = value => String(value || '').toLowerCase().replace(/\s+/g, '').replace(/[，。、！？；：,.;:!?\-#()（）《》【】\[\]{}"'“”‘’\/\\|\n\r\t]/g, '');
  return [clean(memory?.event), clean(memory?.summary), clean(memory?.source)].join('||');
}

function mergeMemories(existing, additions) {
  const out = Array.isArray(existing) ? [...existing] : [];
  for (const memory of additions) {
    const idIndex = out.findIndex(item => String(item?.id || '') === String(memory.id || ''));
    const fingerprint = memoryFingerprint(memory);
    const fpIndex = fingerprint ? out.findIndex(item => memoryFingerprint(item) === fingerprint) : -1;
    const index = idIndex >= 0 ? idIndex : fpIndex;
    if (index >= 0) out[index] = { ...out[index], ...memory };
    else out.push(memory);
  }
  return out;
}

function currentCleaner(ctx) {
  return normalizeCleaner(loadLegacyPanelValue(ctx, 'mp_text_clean_cfg', {}));
}

function contextIdentity(ctx) {
  const charId = ctx?.characterId;
  const charObj = Number.isInteger(charId) ? ctx?.characters?.[charId] : null;
  const charScope = String(charObj?.avatar ?? charObj?.name ?? ctx?.chatMetadata?.character_name ?? ctx?.name2 ?? '');
  return `${String(ctx?.chatId ?? ctx?.chatMetadata?.chat_file_name ?? 'default')}::${charScope}`;
}

function contiguousRanges(indices) {
  if (!indices.length) return [];
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let end = start;
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] === end + 1) end = sorted[i];
    else { ranges.push([start, end]); start = end = sorted[i]; }
  }
  ranges.push([start, end]);
  return ranges;
}

export async function syncAutoHiddenMessages() {
  const ctx = globalThis.SillyTavern?.getContext?.();
  if (!ctx?.chat || !visibilityHandler) return;
  const config = loadAutoSummaryConfig();
  const state = loadAutoSummaryState();
  const chat = ctx.chat;

  if (!config.enabled || !config.hideSummarized) {
    const marked = [];
    chat.forEach((message, index) => {
      if (message?.extra?.memoryPilotAutoHidden) marked.push(index);
    });
    for (const [start, end] of contiguousRanges(marked)) {
      await visibilityHandler(start, end, true);
    }
    for (const index of marked) {
      if (chat[index]?.extra) delete chat[index].extra.memoryPilotAutoHidden;
    }
    if (marked.length) await saveChatHandler?.();
    return;
  }

  const lastEligibleIndex = Math.min(state.completedThrough - 1, chat.length - config.keepRecent - 1);
  const firstEligibleIndex = Math.max(0, config.startFloor - 1);
  const target = new Set();
  for (let index = firstEligibleIndex; index <= lastEligibleIndex; index += 1) target.add(index);

  const release = [];
  chat.forEach((message, index) => {
    if (!message?.extra?.memoryPilotAutoHidden || target.has(index)) return;
    release.push(index);
  });
  for (const [start, end] of contiguousRanges(release)) await visibilityHandler(start, end, true);
  const releasedMarkers = [];
  chat.forEach((message, index) => {
    if (!message?.extra?.memoryPilotAutoHidden || target.has(index)) return;
    delete message.extra.memoryPilotAutoHidden;
    releasedMarkers.push(index);
  });
  if (releasedMarkers.length) await saveChatHandler?.();

  const shouldHide = [];
  for (const index of target) {
    const message = chat[index];
    if (!message) continue;
    message.extra = message.extra || {};
    message.extra.memoryPilotAutoHidden = true;
    shouldHide.push(index);
  }
  for (const [start, end] of contiguousRanges(shouldHide)) await visibilityHandler(start, end, false);
}

async function performRange(startFloor, endFloor, reason = 'auto', expectedChat = '') {
  const ctx = globalThis.SillyTavern?.getContext?.();
  if (!ctx?.chat) throw new Error('当前没有可用的聊天');
  const config = loadAutoSummaryConfig();
  const cleaner = currentCleaner(ctx);
  const content = buildFloorText(ctx, startFloor, endFloor, cleaner);
  if (!content.trim()) throw new Error(`第 ${startFloor}-${endFloor} 楼没有可总结的聊天内容`);
  const prompt = getAutoSummaryPrompt().replace('{{content}}', content);
  const raw = await callConfiguredLLM(ctx, prompt);
  if (expectedChat && contextIdentity(globalThis.SillyTavern?.getContext?.()) !== expectedChat) {
    throw Object.assign(new Error('聊天已切换，本次自动总结结果未写入'), { code: 'MP_CHAT_CHANGED' });
  }
  const additions = parseSummaryMemories(raw, {
    startFloor,
    endFloor,
    source: 'auto_batch',
    priorityMode: config.priorityMode,
    fixedPriority: config.fixedPriority,
  });
  if (!additions.length) throw new Error('AI 返回了内容，但没有提取到有效的记忆 JSON');
  const memories = mergeMemories(await loadMemories(), additions);
  await saveMemories(memories);
  const counts = additions.reduce((acc, memory) => {
    const label = priorityLabel(memory.priority);
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
  const countText = Object.entries(counts).map(([label, count]) => `${count} 条${label}`).join('、');
  const status = `${reason === 'retry' ? '重试成功' : '自动总结完成'}：已总结 #${startFloor}-${endFloor}，新增 ${countText}记忆。`;
  await persistState({
    nextFloor: endFloor + 1,
    completedThrough: endFloor,
    paused: false,
    lastError: '',
    lastRange: [startFloor, endFloor],
    lastRunAt: Date.now(),
    lastStatus: status,
  });
  try {
    await syncAutoHiddenMessages();
  } catch (error) {
    const disabled = { ...loadAutoSummaryConfig(), hideSummarized: false };
    await saveConfig('autoSummary', disabled);
    await persistState({ lastStatus: `${status} 旧楼层隐藏失败，已自动关闭：${error?.message || error}` });
    console.warn('[MP] Auto-hide disabled after failure:', error);
  }
  return additions;
}

export async function runAutoSummary({ forceRetry = false } = {}) {
  if (running) return { skipped: 'running' };
  const ctx = globalThis.SillyTavern?.getContext?.();
  if (!ctx?.chat) return { skipped: 'no-chat' };
  const runChat = contextIdentity(ctx);
  const config = loadAutoSummaryConfig();
  const state = loadAutoSummaryState();
  if (!config.enabled && !forceRetry) {
    try { await syncAutoHiddenMessages(); } catch (error) { console.warn('[MP] Auto-hide restore failed:', error); }
    return { skipped: 'disabled' };
  }
  // A failed range remains pending. New floors are appended to that pending
  // range and retried automatically at the next interval; manual retry still
  // works immediately from the same start floor.
  if (state.paused && !forceRetry && !state.lastError) return { skipped: 'paused' };
  const startFloor = state.nextFloor || config.startFloor;
  const failedRange = Array.isArray(state.lastRange) && state.lastError ? state.lastRange : null;
  const minimumEnd = startFloor + config.interval - 1;
  const endFloor = failedRange && !forceRetry
    ? Math.max(minimumEnd, startFloor + config.interval * 2 - 1)
    : minimumEnd;
  if (ctx.chat.length < endFloor) {
    try { await syncAutoHiddenMessages(); } catch (error) { console.warn('[MP] Auto-hide sync failed:', error); }
    return { skipped: 'not-due', nextRange: [startFloor, endFloor] };
  }

  running = true;
  await persistState({ running: true, lastStatus: `正在总结 #${startFloor}-${endFloor}…`, lastError: '' });
  showAutoSummaryPopup('running', '正在自动总结', `正在整理第 ${startFloor}-${endFloor} 楼，请稍候。`);
  try {
    const memories = await performRange(startFloor, endFloor, forceRetry ? 'retry' : 'auto', runChat);
    showAutoSummaryPopup('success', '自动总结完成', loadAutoSummaryState().lastStatus, 3200);
    return { ok: true, memories, range: [startFloor, endFloor] };
  } catch (error) {
    if (error?.code === 'MP_CHAT_CHANGED' || contextIdentity(globalThis.SillyTavern?.getContext?.()) !== runChat) {
      console.info('[MP] Auto summary discarded because the active chat changed.');
      showAutoSummaryPopup('info', '本次总结已停止', '聊天已经切换，本次结果没有写入；之后会从原楼层继续。', 4500);
      return { skipped: 'chat-changed', range: [startFloor, endFloor] };
    }
    const message = error?.message || String(error);
    await persistState({
      paused: true,
      running: false,
      lastError: message,
      lastRange: [startFloor, endFloor],
      lastRunAt: Date.now(),
      lastStatus: `自动总结待重试：#${startFloor}-${endFloor} 失败，将在下一周期叠加后重试。${message}`,
    });
    console.error('[MP] Automatic floor summary failed:', error);
    showAutoSummaryPopup('error', '自动总结失败', `第 ${startFloor}-${endFloor} 楼已保留，达到下一周期后会连同新楼层一起重试。${message ? `\n${message}` : ''}`);
    try { globalThis.toastr?.error?.('自动楼层总结失败，已保留待总结楼层；下一周期会叠加后重试。'); } catch {}
    return { ok: false, error, range: [startFloor, endFloor] };
  } finally {
    running = false;
    if (contextIdentity(globalThis.SillyTavern?.getContext?.()) === runChat) await persistState({ running: false });
  }
}

export async function retryAutoSummary() {
  return runAutoSummary({ forceRetry: true });
}

export async function handleAutoSummaryChatDeleted(deletedFloor) {
  const floor = Number(deletedFloor);
  if (!Number.isFinite(floor) || floor < 1) return loadAutoSummaryState();
  const config = loadAutoSummaryConfig();
  const state = loadAutoSummaryState();
  if (state.completedThrough < floor && state.nextFloor < floor) return state;
  const rewoundThrough = Math.max(config.startFloor - 1, floor - 1);
  return persistState({
    nextFloor: Math.max(config.startFloor, floor),
    completedThrough: rewoundThrough,
    paused: false,
    lastError: '',
    lastRange: null,
    lastStatus: `已因删除第 ${floor} 楼回退自动总结进度，后续楼层会重新累计。`,
  });
}

export function initializeAutoSummary(options = {}) {
  visibilityHandler = typeof options.setMessageVisibility === 'function' ? options.setMessageVisibility : null;
  saveChatHandler = typeof options.saveChat === 'function' ? options.saveChat : null;
  const ctx = globalThis.SillyTavern?.getContext?.();
  if (!ctx?.eventSource || hookedContext === ctx) return;
  hookedContext = ctx;
  ctx.eventSource.on(ctx.eventTypes.MESSAGE_RECEIVED, () => {
    setTimeout(async () => {
      const current = globalThis.SillyTavern?.getContext?.();
      const last = current?.chat?.[current.chat.length - 1];
      if (!last || last.is_user || last.is_system) return;
      await runAutoSummary();
    }, 350);
  });
  ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, () => {
    setTimeout(() => syncAutoHiddenMessages().catch(error => console.warn('[MP] Auto-hide sync failed:', error)), 600);
  });
  setTimeout(() => syncAutoHiddenMessages().catch(error => console.warn('[MP] Auto-hide startup sync failed:', error)), 800);
}
