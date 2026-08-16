const normalizeText = value => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const inactive = reason => ({ active: false, reason, removedIds: new Set(), isDuplicate: () => false, filter: list => Array.isArray(list) ? list : [] });
export async function createAnimaDedupeSession({ enabled = true, context } = {}) {
  if (!enabled) return inactive('disabled');
  const ctx = context || globalThis.SillyTavern?.getContext?.();
  const helper = globalThis.TavernHelper;
  if (!ctx || !helper?.getWorldbook || !helper?.getChatWorldbookName) return inactive('anima_unavailable');
  try {
    const name = String(await helper.getChatWorldbookName('current') || '').trim();
    if (!name) return inactive('no_worldbook');
    const entries = await helper.getWorldbook(name);
    const entry = (Array.isArray(entries) ? entries : []).find(item => item?.name === '[ANIMA_Chat_History_Container]' && item?.enabled !== false);
    const injected = normalizeText(entry?.content);
    if (!injected) return inactive('empty_anima_result');
    const removedIds = new Set();
    const isDuplicate = memory => {
      if (memory?.source !== 'anima_summary') return false;
      const summary = normalizeText(memory?.summary);
      if (summary.length < 12 || !injected.includes(summary)) return false;
      removedIds.add(String(memory?.id ?? memory?.animaSummaryId ?? summary));
      return true;
    };
    return { active: true, reason: '', removedIds, isDuplicate, filter: list => (Array.isArray(list) ? list : []).filter(memory => !isDuplicate(memory)) };
  } catch (error) {
    console.warn('[MP] Failed to read Anima recall result for deduplication:', error);
    return inactive('read_failed');
  }
}
