const normalizeText = value => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

const inactive = reason => ({
  active: false,
  reason,
  removedIds: new Set(),
  isDuplicate: () => false,
  filter: list => Array.isArray(list) ? list : [],
});

const asArray = value => Array.isArray(value) ? value : (value ? [value] : []);

function collectInjectedValues(ctx) {
  const ext = ctx?.chatMetadata?.extensions?.LittleWhiteBox;
  const story = ext?.storySummary;
  const sources = [
    globalThis.LittleWhiteBox,
    globalThis.littleWhiteBox,
    globalThis.Xiaobaix,
    globalThis.xiaobaix,
    ext?.lastRecall,
    ext?.recallResult,
    story?.lastRecall,
    story?.recallResult,
    story?.lastInjected,
    story?.lastInjectedEvents,
    story?.injectedEvents,
    story?.injectedText,
    story?.promptText,
    story?.json?.lastRecall,
    story?.json?.recallResult,
    story?.json?.lastInjected,
    story?.json?.lastInjectedEvents,
    story?.json?.injectedEvents,
    story?.json?.injectedText,
  ];
  const values = [];
  const visit = value => {
    if (!value) return;
    if (typeof value === 'string') {
      if (normalizeText(value)) values.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== 'object') return;
    for (const key of ['text', 'content', 'summary', 'event', 'title', 'label']) {
      if (typeof value[key] === 'string' && normalizeText(value[key])) values.push(value[key]);
    }
    for (const key of ['events', 'selectedEvents', 'l0Selected', 'items', 'memories']) {
      if (value[key]) asArray(value[key]).forEach(visit);
    }
  };
  sources.forEach(visit);
  return values;
}

export async function createXiaobaixDedupeSession({ enabled = true, context } = {}) {
  if (!enabled) return inactive('disabled');
  const ctx = context || globalThis.SillyTavern?.getContext?.();
  if (!ctx) return inactive('xiaobaix_unavailable');
  try {
    const injected = collectInjectedValues(ctx).map(normalizeText).filter(value => value.length >= 12);
    if (!injected.length) return inactive('no_runtime_recall');
    const removedIds = new Set();
    const isDuplicate = memory => {
      if (memory?.source !== 'xb_event') return false;
      const fields = [memory?.summary, memory?.event, memory?.title]
        .map(normalizeText)
        .filter(value => value.length >= 12);
      if (!fields.some(field => injected.some(text => text.includes(field) || field.includes(text)))) return false;
      removedIds.add(String(memory?.id ?? memory?.xbEventId ?? fields[0] ?? ''));
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
    console.warn('[MP] Failed to read 小白 X recall result for deduplication:', error);
    return inactive('read_failed');
  }
}
