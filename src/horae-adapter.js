const normalizeText = value => String(value ?? '').trim();

const normalizeList = value => Array.from(new Set(
  (Array.isArray(value) ? value : value == null ? [] : [value])
    .map(item => normalizeText(item))
    .filter(Boolean),
));

const normalizeChatId = value => normalizeText(value).replace(/\.jsonl?$/i, '');

const floorForMessage = value => {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 ? [index + 1, index + 1] : null;
};

const timeLabelFromMeta = meta => [
  normalizeText(meta?.timestamp?.story_date),
  normalizeText(meta?.timestamp?.story_time),
].filter(Boolean).join(' ');

const timestampFromMeta = meta => {
  const absolute = Date.parse(normalizeText(meta?.timestamp?.absolute));
  return Number.isFinite(absolute) ? absolute : null;
};

export function isLegacyHoraeSummaryMemory(memory) {
  return memory?.source === 'horae_memory'
    && (memory?.horaeKind === 'summary' || (memory?.horaeSummaryId && !memory?.horaeEventKey));
}

export function findLegacyHoraeCoverage(memories, item) {
  const floor = Number(item?.floorRange?.[0]);
  if (!Number.isInteger(floor)) return null;
  return (Array.isArray(memories) ? memories : []).find(memory => {
    if (!isLegacyHoraeSummaryMemory(memory) || !Array.isArray(memory.floorRange) || memory.floorRange.length < 2) return false;
    const left = Number(memory.floorRange[0]);
    const right = Number(memory.floorRange[1]);
    if (!Number.isInteger(left) || !Number.isInteger(right)) return false;
    return floor >= Math.min(left, right) && floor <= Math.max(left, right);
  }) || null;
}

export function buildHoraeDisplayTitle(summary, kind = 'event') {
  const clean = normalizeText(summary)
    .replace(/<!--[^]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[#>*\-\s]+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return kind === 'summary' ? 'Horae压缩摘要' : 'Horae时间线事件';
  const first = (clean.match(/^(.{1,90}?)(?:[。！？!?]|$)/)?.[1] || clean).trim();
  const limit = kind === 'summary' ? 34 : 30;
  return first.length > limit ? `${first.slice(0, limit)}…` : first;
}

export function parseHoraeCurrentTimeline({ chat, events, chatId = '', version = '' } = {}) {
  const sourceChat = Array.isArray(chat) ? chat : [];
  const sourceEvents = Array.isArray(events) ? events : [];
  const stableChat = normalizeChatId(chatId) || 'current';
  const result = [];
  const seen = new Set();

  for (const record of sourceEvents) {
    const event = record?.event;
    const summary = normalizeText(event?.summary);
    const messageIndex = Number(record?.messageIndex);
    const eventIndex = Number(record?.eventIndex);
    if (!summary || !Number.isInteger(messageIndex) || messageIndex < 0) continue;

    // Horae 的压缩是非破坏性的：原始事件依然保留，只是标记
    // _compressedBy 并在 Horae 时间线中隐藏。MemoryPilot 只增量导入这些
    // 原始事件，不读取也不跟随一级/二级压缩摘要。
    const isCompressionSummary = event?.isSummary || event?.level === '摘要' || !!event?._summaryId;
    if (isCompressionSummary) continue;

    const compressedBy = normalizeText(event?._compressedBy);
    const eventKey = Number.isInteger(eventIndex) && eventIndex >= 0 ? `${messageIndex}:${eventIndex}` : `${messageIndex}:0`;
    const explicitId = normalizeText(event?.id || event?._id);
    const horaeMemoryId = `${stableChat}::event::${explicitId || eventKey}`;
    if (seen.has(horaeMemoryId)) continue;
    seen.add(horaeMemoryId);

    const meta = sourceChat[messageIndex]?.horae_meta || {};
    result.push({
      horaeMemoryId,
      horaeKind: 'event',
      horaeEventKey: eventKey,
      horaeLevel: normalizeText(event?.level) || '一般',
      event: buildHoraeDisplayTitle(summary, 'event'),
      summary,
      primaryKeywords: normalizeList(meta?.scene?.location),
      entityKeywords: normalizeList(meta?.scene?.characters_present),
      floorRange: floorForMessage(messageIndex),
      timeLabel: timeLabelFromMeta(meta),
      timestamp: timestampFromMeta(meta) || Date.now(),
      horaeVersion: normalizeText(version),
      horaeCompressed: !!compressedBy,
      horaeCompressedBy: compressedBy,
    });
  }

  return result.sort((left, right) => {
    const leftFloor = left.floorRange?.[0] ?? Number.MAX_SAFE_INTEGER;
    const rightFloor = right.floorRange?.[0] ?? Number.MAX_SAFE_INTEGER;
    if (leftFloor !== rightFloor) return leftFloor - rightFloor;
    return String(left.horaeMemoryId).localeCompare(String(right.horaeMemoryId), 'zh-CN', { numeric: true });
  });
}

export async function loadCurrentHoraeMemories({ context, horaeApi } = {}) {
  const ctx = context || globalThis.SillyTavern?.getContext?.();
  const api = horaeApi || globalThis.Horae;
  const chatId = normalizeChatId(ctx?.chatId || ctx?.chatMetadata?.chat_file_name);
  if (!chatId) return { status: 'no_chat', version: '', enabled: false, items: [] };
  if (!api?.getChat || !api?.getEvents) return { status: 'horae_missing', version: '', enabled: false, items: [] };

  try {
    const chat = api.getChat();
    const events = api.getEvents(0, 'all');
    const enabled = typeof api.isEnabled === 'function' ? !!api.isEnabled() : true;
    const version = normalizeText(api.version);
    const items = parseHoraeCurrentTimeline({ chat, events, chatId, version });
    return {
      status: items.length ? (enabled ? 'ready' : 'ready_disabled') : (enabled ? 'empty' : 'empty_disabled'),
      version,
      enabled,
      items,
    };
  } catch (error) {
    return {
      status: 'error',
      version: normalizeText(api?.version),
      enabled: false,
      items: [],
      error: error?.message || String(error),
    };
  }
}
