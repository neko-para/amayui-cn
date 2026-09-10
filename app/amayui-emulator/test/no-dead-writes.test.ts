/**
 * **闸门 C 的回归测试**：死写 ratchet。
 *
 * 规则：`dead-writes.baseline.json` 里登记过的死写不算失败（它们是已记录的能力缺口），
 * **新增**死写则测试失败 —— 逼实现者二选一：给它接上消费者，或登记进基线并写清理由。
 *
 * 这条测试是针对一类**完全无报错**的缺陷设的闸：
 * "字段写进了模型、VM 也正常推进、日志一切正常，但渲染器从来不读它 ⇒ 效果就是不出现"。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findDeadWrites, formatReport, loadBaseline, ratchet } from '../src/tools/deadWrites.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');
const BASELINE = path.join(APP_ROOT, 'dead-writes.baseline.json');

test('死写 ratchet：不得新增「写了但没人读」的模型字段', () => {
  const report = findDeadWrites(APP_ROOT);
  const base = loadBaseline(BASELINE);

  assert.ok(report.alive.length + report.dead.length > 20, `应扫到足量字段（实际 ${report.alive.length + report.dead.length}）`);

  const { added } = ratchet(report, base);
  assert.deepEqual(
    added.map((d) => d.id),
    [],
    `新增死写字段（写了但没有消费者）——请接上消费者，或登记进 dead-writes.baseline.json 并说明理由：\n${formatReport(report, base)}`,
  );
});

test('死写检测自身有效：能识别出已知的 Item.blend（引擎 +0x30 混合模式无消费者）', () => {
  const report = findDeadWrites(APP_ROOT);
  const ids = report.dead.map((d) => d.id);
  assert.ok(ids.includes('Item.blend'), `Item.blend 应被判为死写（实际死写：${ids.join(' ') || '无'}）`);
  // 反向校验：确实被渲染消费的字段不能被误判
  assert.ok(!ids.includes('Item.wins'), 'it.wins 有消费者，不应误判');
  assert.ok(!ids.includes('Item.flags'), 'it.flags 有消费者，不应误判');
  assert.ok(!ids.includes('Item.fbHold'), 'it.fbHold 有消费者，不应误判');
});
