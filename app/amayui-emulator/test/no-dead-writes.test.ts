/** @tier T0 @kind ratchet @subsystem ledger */

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
import * as fs from 'node:fs';
import * as os from 'node:os';
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

test('死写检测自身有效：合成模型里"只写不读"的字段必须被报出来', () => {
  // ★2026-09（`tickets/T-0017`）：这条原来断言"真实模型里的 `Item.blend` 应被判为死写" ——
  //   `T-0017` 给它接上消费者（场景混合状态机）之后基线清空，那条断言自然失效。
  //   改成**合成输入**：检测能力不该依赖"真实模型里恰好还有一个死写字段"。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dead-writes-'));
  try {
    fs.mkdirSync(path.join(dir, 'src', 'renderer', 'drawitem'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'src', 'renderer', 'drawitem', 'model.ts'),
      'export interface Item {\n  onlyWritten: number;\n  consumed: number;\n}\n',
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'renderer', 'consumer.ts'),
      'export const x = { onlyWritten: 1, consumed: 2 };\nexport const y = x.consumed;\n',
    );
    const report = findDeadWrites(dir, ['src/renderer/drawitem/model.ts', 'src/renderer/consumer.ts']);
    const ids = report.dead.map((d) => d.id);
    assert.ok(ids.includes('Item.onlyWritten'), `只写不读的字段应被判为死写（实际死写：${ids.join(' ') || '无'}）`);
    assert.ok(!ids.includes('Item.consumed'), '有消费者的字段不能被误判');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * ★**注释/字符串里的字段名不算"读"**（`tickets/T-0039`）。
 *
 * 复现的现场：在 `src/renderer/drawitem/model.ts` 的文档注释里写一句「见 MeshObj.blend」，
 * `npm run check:dead-writes` 立刻把两个**已登记的能力缺口**报成"已修"（dead → alive）——
 * 报告与 `fixed` 列表一起失真，而"没有反向断言"的字段从此可以被一句注释静默洗白。
 * 修法：`stripCommentsAndStrings` 在统计前剥掉 `//`/块注释（含文档注释）与字符串字面量内容。
 */
test('死写检测对注释/字符串免疫：注释里提到字段名，不改变读数', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dead-writes-comment-'));
  try {
    fs.mkdirSync(path.join(dir, 'src', 'renderer', 'drawitem'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'src', 'renderer', 'drawitem', 'model.ts'),
      'export interface Item {\n  onlyWritten: number;\n}\n',
    );
    fs.writeFileSync(
      path.join(dir, 'src', 'renderer', 'consumer.ts'),
      [
        'export const x = { onlyWritten: 1 };',
        '/** 说明：这里**不**消费 {@link Item.onlyWritten}（文档注释） */',
        '// 行注释里提到 x.onlyWritten 也不算读',
        "export const msg = 'log: x.onlyWritten 未消费';",
        "export const url = 'http://example.com/x.onlyWritten';",
        'export const y = x.onlyWritten; // ← 唯一真读（下面断言靠它做对照）',
      ].join('\n'),
    );
    const report = findDeadWrites(dir, ['src/renderer/drawitem/model.ts', 'src/renderer/consumer.ts']);
    const entry = [...report.alive, ...report.dead].find((d) => d.id === 'Item.onlyWritten');
    assert.ok(entry, '字段应被扫到');
    assert.equal(entry!.reads, 1, `只有代码里的那一次访问算读（注释/字符串都不算），实际 ${entry!.reads}`);

    // 反面：把**唯一**那次真读也改成注释 ⇒ 必须回到"死写"
    fs.writeFileSync(
      path.join(dir, 'src', 'renderer', 'consumer.ts'),
      ['export const x = { onlyWritten: 1 };', '// x.onlyWritten 只出现在注释里'].join('\n'),
    );
    const report2 = findDeadWrites(dir, ['src/renderer/drawitem/model.ts', 'src/renderer/consumer.ts']);
    assert.ok(
      report2.dead.map((d) => d.id).includes('Item.onlyWritten'),
      `注释不算读 ⇒ 该字段必须是死写（实际死写：${report2.dead.map((d) => d.id).join(' ') || '无'}）`,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
