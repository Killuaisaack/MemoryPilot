const ANIMA_RAG_ENTRY_NAME = '[ANIMA_Chat_History_Container]';

const normalizeText = value => String(value ?? '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

function inactiveSession(reason = '') {
  const removedIds = new Set();
  return {
    active: false,
    reason,
    removedIds,
    isDuplicate: () => false,
    filter: list => Array.isArray(list) ? list : [],
  };
}

export async function createAnimaDedupeSession({ enabled = true, context, tavernHelper } = {}) {
  if (!enabled) return inactiveSession('disabled');

  const ctx = context || globalThis.SillyTavern?.getContext?.();
  const helper = tavernHelper || globalThis.TavernHelper;
  if (!ctx || !helper?.getWorldbook || !helper?.getChatWorldbookName) {
    return inactiveSession('anima_unavailable');
  }

  try {
    const worldbookName = String(await helper.getChatWorldbookName('current') || '').trim();
    if (!worldbookName) return inactiveSession('no_worldbook');

    const entries = await helper.getWorldbook(worldbookName);
    const container = (Array.isArray(entries) ? entries : []).find(entry =>
      entry?.name === ANIMA_RAG_ENTRY_NAME &&
      entry?.enabled !== false
    );
    const injectedText = normalizeText(container?.content);
    if (!injectedText) return inactiveSession('empty_anima_result');

    const removedIds = new Set();
    const isDuplicate = memory => {
      if (memory?.source !== 'anima_summary') return false;
      const summary = normalizeText(memory?.summary);
      if (summary.length < 12 || !injectedText.includes(summary)) return false;
      removedIds.add(String(memory?.id ?? memory?.animaSummaryId ?? summary));
      return true;
    };

    return {
      active: true,
      reason: '',
      removedIds,
      isDuplicate,
      filter: list => (Array.isArray(list) ? list : []).filter(memory => !isDuplicate(memory)),
    };
  } catch (error) {
    console.warn('[MP] Failed to read Anima recall result for deduplication:', error);
    return inactiveSession('read_failed');
  }
}
