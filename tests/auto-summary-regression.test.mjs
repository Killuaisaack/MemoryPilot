import assert from 'node:assert/strict';
import { normalizePriority, parseSummaryMemories } from '../src/summary-service.js';

const expected = new Map([
  ['HIGH', 'high'],
  ['常驻', 'high'],
  ['核心设定', 'high'],
  ['Low', 'low'],
  ['次级触发', 'low'],
  ['日常氛围', 'low'],
  ['medium', 'medium'],
  ['主要触发', 'medium'],
]);

for (const [input, output] of expected) {
  assert.equal(normalizePriority(input), output, `${input} 应识别为 ${output}`);
}

const aiResult = parseSummaryMemories([
  JSON.stringify({ event: '核心设定', summary: 'a', priority: '常驻' }),
  JSON.stringify({ event: '日常片段', summary: 'b', priority: '次级触发' }),
  JSON.stringify({ event: '关键事件', summary: 'c', priority: '主要触发' }),
].join('\n'), { startFloor: 1, endFloor: 20, priorityMode: 'ai' });

assert.deepEqual(aiResult.map(item => item.priority), ['high', 'low', 'medium']);

const fixedResult = parseSummaryMemories(
  JSON.stringify({ event: '任意事件', summary: 'a', priority: '常驻' }),
  { startFloor: 1, endFloor: 20, priorityMode: 'fixed', fixedPriority: 'low' },
);
assert.equal(fixedResult[0].priority, 'low', '统一指定类型仍应覆盖 AI 建议');

const cappedHighResult = parseSummaryMemories([
  JSON.stringify({ event: '核心1', summary: 'a', priority: 'high' }),
  JSON.stringify({ event: '核心2', summary: 'b', priority: 'high' }),
  JSON.stringify({ event: '核心3', summary: 'c', priority: 'high' }),
  JSON.stringify({ event: '事件4', summary: 'd', priority: 'medium' }),
  JSON.stringify({ event: '事件5', summary: 'e', priority: 'low' }),
].join('\n'), { startFloor: 1, endFloor: 20, source: 'auto_batch', priorityMode: 'ai' });
assert.equal(cappedHighResult.filter(item => item.priority === 'high').length, 1, '自动总结的常驻记忆应尽量少');
assert.equal(cappedHighResult[1].priority, 'medium', '超出常驻配额的内容应回落为主要触发');

console.log('auto-summary regression tests passed');
