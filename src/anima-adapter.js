const normalizeText = value => String(value ?? '').trim();

const normalizeList = value => Array.from(new Set(
  (Array.isArray(value) ? value : value == null ? [] : [value])
    .map(item => normalizeText(item))
    .filter(Boolean),
));

const escapeRegExp = value => String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const sameChat = (left, right) => {
  const clean = value => normalizeText(value).replace(/\.jsonl?$/i, '');
  return !!clean(left) && clean(left) === clean(right);
};

export function extractAnimaSliceContent(content, uniqueId) {
  const raw = normalizeText(content);
  const id = normalizeText(uniqueId);
  if (!raw || !id) return '';
  const match = raw.match(new RegExp(`<${escapeRegExp(id)}>\\s*([\\s\\S]*?)\\s*<\\/${escapeRegExp(id)}>`, 'i'));
  return normalizeText(match?.[1]);
}

export function buildAnimaDisplayTitle(content, uniqueId) {
  const clean = normalizeText(content)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[#>*\-\s]+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return `Anima总结 #${normalizeText(uniqueId) || '?'}`;
  const first = (clean.match(/^(.{1,80}?)(?:[。！？!?]|$)/)?.[1] || clean).trim();
  if (!first) return `Anima总结 #${normalizeText(uniqueId) || '?'}`;
  return first.length > 32 ? `${first.slice(0, 32)}…` : first;
}

export function parseAnimaWorldbookEntries(entries, chatId) {
  const result = [];
  const seen = new Set();

  for (const entry of Array.isArray(entries) ? entries : []) {
    const extra = entry?.extra && typeof entry.extra === 'object' ? entry.extra : {};
    if (extra.createdBy !== 'anima_summary') continue;

    const histories = Array.isArray(extra.history) && extra.history.length ? extra.history : [extra];
    for (const history of histories) {
      const sourceFile = normalizeText(history?.source_file || extra.source_file || '');
      if (sourceFile && chatId && !sameChat(sourceFile, chatId)) continue;

      const uniqueId = normalizeText(history?.unique_id ?? history?.index ?? extra.unique_id ?? extra.index);
      if (!uniqueId) continue;

      let content = extractAnimaSliceContent(entry?.content, uniqueId);
      if (!content && histories.length === 1) content = normalizeText(entry?.content);
      if (!content) continue;

      const stableSource = sourceFile || normalizeText(chatId) || 'legacy';
      const animaSummaryId = `${stableSource}::${uniqueId}`;
      if (seen.has(animaSummaryId)) continue;
      seen.add(animaSummaryId);

      const start = Number(history?.range_start ?? extra.range_start);
      const end = Number(history?.range_end ?? extra.range_end);
      const floorRange = Number.isFinite(start) && Number.isFinite(end)
        ? [Math.min(start, end) + 1, Math.max(start, end) + 1]
        : null;
      const batchId = history?.batch_id ?? history?.index ?? extra.batch_id ?? extra.index ?? null;
      const sliceId = history?.slice_id ?? extra.slice_id ?? null;
      const tags = normalizeList(history?.tags ?? extra.tags);

      result.push({
        animaSummaryId,
        uniqueId,
        batchId,
        sliceId,
        sourceFile: stableSource,
        event: buildAnimaDisplayTitle(content, uniqueId),
        summary: content,
        tags,
        floorRange,
        timestamp: Number(history?.last_modified ?? extra.last_modified ?? extra.narrative_time) || Date.now(),
        worldbookEntryUid: entry?.uid ?? null,
        worldbookEntryName: normalizeText(entry?.name),
      });
    }
  }

  return result.sort((a, b) => {
    const aBatch = Number(a.batchId);
    const bBatch = Number(b.batchId);
    if (Number.isFinite(aBatch) && Number.isFinite(bBatch) && aBatch !== bBatch) return aBatch - bBatch;
    const aSlice = Number(a.sliceId);
    const bSlice = Number(b.sliceId);
    if (Number.isFinite(aSlice) && Number.isFinite(bSlice) && aSlice !== bSlice) return aSlice - bSlice;
    return String(a.uniqueId).localeCompare(String(b.uniqueId), 'zh-CN', { numeric: true });
  });
}

export async function loadCurrentAnimaSummaries({ context, tavernHelper } = {}) {
  const ctx = context || globalThis.SillyTavern?.getContext?.();
  const helper = tavernHelper || globalThis.TavernHelper;
  const chatId = normalizeText(ctx?.chatId || ctx?.chatMetadata?.chat_file_name);
  if (!chatId) return { status: 'no_chat', worldbookName: '', items: [] };
  if (!helper?.getWorldbook) return { status: 'helper_missing', worldbookName: '', items: [] };

  try {
    let worldbookName = normalizeText(await helper.getChatWorldbookName?.('current'));
    if (!worldbookName && typeof helper.getWorldbookNames === 'function') {
      const expected = chatId.replace(/\.jsonl?$/i, '');
      const names = await helper.getWorldbookNames();
      if (Array.isArray(names) && names.includes(expected)) worldbookName = expected;
    }
    if (!worldbookName) return { status: 'no_worldbook', worldbookName: '', items: [] };

    const entries = await helper.getWorldbook(worldbookName);
    const items = parseAnimaWorldbookEntries(entries, chatId);
    return {
      status: items.length ? 'ready' : 'empty',
      worldbookName,
      items,
    };
  } catch (error) {
    return {
      status: 'error',
      worldbookName: '',
      items: [],
      error: error?.message || String(error),
    };
  }
}
