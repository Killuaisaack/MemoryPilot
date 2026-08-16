import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runRecall as runRecallV32 } from '../src/recall-v32.js';
import { runRecall as runRecallV34 } from '../src/recall-v34.js';

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
  }

  getItem(key) {
    return this.values.has(String(key)) ? this.values.get(String(key)) : null;
  }

  setItem(key, value) {
    this.values.set(String(key), String(value));
  }

  removeItem(key) {
    this.values.delete(String(key));
  }
}

const injectedSummary = '月光下的旧车站约定仍然有效，双方决定下次见面继续讨论旅行计划。';

const memories = [
  {
    id: 'anima-1',
    source: 'anima_summary',
    event: 'Anima 总结',
    summary: injectedSummary,
    priority: 'medium',
    primaryKeywords: ['月光'],
    timestamp: 1,
  },
  {
    id: 'manual-1',
    source: 'manual',
    event: '手动记忆',
    summary: injectedSummary,
    priority: 'medium',
    primaryKeywords: ['月光'],
    timestamp: 2,
  },
];

async function settleRecall(runRecall) {
  runRecall();
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

async function execute(runRecall, {
  animaDedupe = false,
  helper = undefined,
  turnCounter = 0,
  every = 1,
  stickyState = {},
} = {}) {
  const chatMetadata = {
    extensions: {
      MemoryPilot: {
        turnCounter,
        stickyState,
      },
    },
    variables: {},
  };
  const context = {
    chatId: 'recall-regression',
    name2: 'character',
    chat: [{ is_user: true, mes: '今晚在月光下谈谈旅行计划。' }],
    chatMetadata,
    extensionSettings: { MemoryPilot: {} },
    saveSettingsDebounced() {},
  };
  const scopeKey = 'recall-regression::character';
  const storage = new MemoryStorage({
    mp_active_chat: scopeKey,
    mp_memories: JSON.stringify(memories),
    mp_recall_settings: JSON.stringify({
      every,
      alpha: 0.72,
      stickyTurns: 5,
      contextWindow: 8,
      maxRecall: 6,
      animaDedupe,
    }),
  });

  globalThis.window = globalThis;
  globalThis.localStorage = storage;
  globalThis.SillyTavern = { getContext: () => context };
  globalThis.TavernHelper = helper;

  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) =>
    originalSetTimeout(callback, Math.min(Number(delay) || 0, 1), ...args);
  try {
    await settleRecall(runRecall);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  return {
    pin: chatMetadata.variables.mp_recall_pin || '',
    ctx: chatMetadata.variables.mp_recall_ctx || '',
    storedSticky: context.extensionSettings.MemoryPilot[scopeKey]?.stickyState || {},
  };
}

const activeHelper = {
  async getChatWorldbookName() {
    return 'chat-worldbook';
  },
  async getWorldbook() {
    return [{
      name: '[ANIMA_Chat_History_Container]',
      enabled: true,
      content: `本轮 Anima 已注入：${injectedSummary}`,
    }];
  },
};

for (const [version, runRecall] of [['v32', runRecallV32], ['v34', runRecallV34]]) {
  const disabled = await execute(runRecall, { animaDedupe: false, helper: activeHelper });
  assert.equal(
    disabled.ctx,
    `[手动记忆] ${injectedSummary}\n[Anima 总结] ${injectedSummary}`,
    `${version}: 关闭 Anima 去重时应保持原召回结果与顺序`,
  );

  const unavailable = await execute(runRecall, { animaDedupe: true });
  assert.equal(unavailable.ctx, disabled.ctx, `${version}: Anima 不可用时应完全回退到原召回行为`);
  assert.equal(unavailable.pin, disabled.pin, `${version}: Anima 不可用时常驻记忆不应变化`);

  const noWorldbook = await execute(runRecall, {
    animaDedupe: true,
    helper: {
      async getChatWorldbookName() {
        return '';
      },
      async getWorldbook() {
        throw new Error('不应读取世界书');
      },
    },
  });
  assert.equal(noWorldbook.ctx, disabled.ctx, `${version}: 聊天世界书缺失时不应影响召回`);
  assert.equal(noWorldbook.pin, disabled.pin, `${version}: 聊天世界书缺失时常驻记忆不应变化`);

  const originalWarn = console.warn;
  console.warn = () => {};
  const readFailed = await execute(runRecall, {
    animaDedupe: true,
    helper: {
      async getChatWorldbookName() {
        return 'chat-worldbook';
      },
      async getWorldbook() {
        throw new Error('模拟读取失败');
      },
    },
  });
  console.warn = originalWarn;
  assert.equal(readFailed.ctx, disabled.ctx, `${version}: Anima 读取失败时应完全回退到原召回行为`);
  assert.equal(readFailed.pin, disabled.pin, `${version}: Anima 读取失败时常驻记忆不应变化`);

  const deduped = await execute(runRecall, { animaDedupe: true, helper: activeHelper });
  assert.equal(
    deduped.ctx,
    `[手动记忆] ${injectedSummary}`,
    `${version}: 只能移除已由 Anima 注入的 anima_summary，不能移除相同文本的手动记忆`,
  );

  const stickyState = {
    'anima-1': { event: 'Anima 总结', summary: injectedSummary, turnsLeft: 3 },
    'manual-1': { event: '手动记忆', summary: injectedSummary, turnsLeft: 3 },
  };
  const stickyDisabled = await execute(runRecall, {
    animaDedupe: false,
    helper: activeHelper,
    turnCounter: 1,
    every: 3,
    stickyState,
  });
  assert.equal(
    stickyDisabled.ctx,
    `[Anima 总结] ${injectedSummary}\n[手动记忆] ${injectedSummary}`,
    `${version}: 关闭去重时 sticky 内容与原行为一致`,
  );
  assert.equal(stickyDisabled.storedSticky['anima-1'].turnsLeft, 2, `${version}: 原 sticky 衰减轮数应保持不变`);
  assert.equal(stickyDisabled.storedSticky['manual-1'].turnsLeft, 2, `${version}: 原 sticky 衰减轮数应保持不变`);

  const stickyDeduped = await execute(runRecall, {
    animaDedupe: true,
    helper: activeHelper,
    turnCounter: 1,
    every: 3,
    stickyState,
  });
  assert.equal(
    stickyDeduped.ctx,
    `[手动记忆] ${injectedSummary}`,
    `${version}: sticky 期内也只过滤重复 Anima 记忆`,
  );
  assert.equal(stickyDeduped.storedSticky['anima-1'], undefined, `${version}: 重复 Anima 不应继续保留 sticky`);
  assert.equal(stickyDeduped.storedSticky['manual-1'].turnsLeft, 2, `${version}: 非 Anima sticky 仍按原逻辑衰减`);
}

const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');
assert.doesNotMatch(indexSource, /MemoryPilotRecallInterceptor/, '不应保留生成前召回拦截器');
assert.match(indexSource, /MESSAGE_RECEIVED[\s\S]*?await runRecall\(\)/, '召回应继续由 MESSAGE_RECEIVED 触发');

for (const filename of ['recall-v32.js', 'recall-v34.js']) {
  const source = await readFile(new URL(`../src/${filename}`, import.meta.url), 'utf8');
  assert.match(source, /export async function runRecall\(\)/, `${filename}: 入口签名应保持原样`);
  assert.match(source, /turnCounter <= 1 \|\| turnCounter % RECALL_EVERY === 0/, `${filename}: 轮次公式应保持原样`);
  assert.match(source, /const recent = chat\.slice\(-CTX_MSGS\)/, `${filename}: 上下文范围应保持原样`);
  assert.match(source, /const currentFloorRange = recent\.length \? \[chat\.length - recent\.length \+ 1, chat\.length\] : null/, `${filename}: 楼层范围计算应保持原样`);
  assert.match(source, /floorRangeDistance\(memFloorRange, currentFloorRange\)/, `${filename}: 楼层距离计算应保持原样`);
  assert.match(source, /nextSticky\[m\.id\] = \{ event: m\.event, summary: m\.summary, turnsLeft: STICKY_TURNS \}/, `${filename}: sticky 保存结构应保持原样`);
}

console.log('recall regression tests passed');
