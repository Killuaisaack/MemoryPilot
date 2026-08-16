const SNAPSHOT_PREFIX = 'mp_recall_snapshot_';
const runtimeSnapshots = new Map();

function getScopeKey(ctx = window.SillyTavern?.getContext?.()) {
  if (!ctx) return 'default';
  const charId = ctx?.characterId;
  const charObj = Number.isInteger(charId) ? ctx?.characters?.[charId] : null;
  const charScope = String(charObj?.avatar ?? charObj?.name ?? ctx?.chatMetadata?.character_name ?? ctx?.name2 ?? '');
  const chatScope = String(ctx.chatId ?? ctx.chatMetadata?.chat_file_name ?? 'default');
  return `${chatScope}::${charScope}`;
}

export function loadRecallSnapshot() {
  try {
    const scopeKey = getScopeKey();
    if (runtimeSnapshots.has(scopeKey)) return runtimeSnapshots.get(scopeKey);
    const raw = localStorage.getItem(SNAPSHOT_PREFIX + scopeKey);
    if (!raw) return null;
    const snapshot = JSON.parse(raw);
    if (!snapshot || typeof snapshot !== 'object') return null;
    runtimeSnapshots.set(scopeKey, snapshot);
    return snapshot;
  } catch {
    return null;
  }
}

export function saveRecallSnapshot(snapshot) {
  try {
    const scopeKey = getScopeKey();
    const saved = {
      ...snapshot,
      savedAt: Date.now(),
    };
    runtimeSnapshots.set(scopeKey, saved);
    localStorage.setItem(SNAPSHOT_PREFIX + scopeKey, JSON.stringify(saved));
  } catch (error) {
    console.warn('[MP] Failed to save recall monitor snapshot:', error);
  }
}

export function clearRecallSnapshot() {
  try {
    const scopeKey = getScopeKey();
    runtimeSnapshots.delete(scopeKey);
    localStorage.removeItem(SNAPSHOT_PREFIX + scopeKey);
  } catch {}
}
