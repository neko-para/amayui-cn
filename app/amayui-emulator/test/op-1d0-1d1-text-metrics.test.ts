/**
 * **`0x1D0` / `0x1D1` 的判定棘轮**（2026-09 扩展路线 C：`tickets/T-0076`）。
 *
 * ## 为什么这个文件里没有"行为断言"
 * 这两条**故意没有实现**（`disposition: deferred`），所以没有可断言的运行时行为 —— 写了就是编。
 * 本文件守的是**判定本身**，防止三件已实测的事被改回去：
 *  ① **不许静默上桩**：两条都必须继续"未注册"（命中即 `NotImplementedOp` 硬报错）。
 *     若给它们登记 no-op，`0x1D0` 就会静默写回旧槽值 ⇒ 回想/CONFIG 画面走错分支（静默逻辑错误）；
 *  ② **标签不许退回**：台账与 `opcode-table.md` 里这两条的定性必须是「**回看页索引表·带步数读出**」与
 *     「**回看页重绘（GDI 文本页渲染器）**」，**不是**「GDI 文本度量族」—— 后者是错的
 *     （实测：`sub_459860` raw 70629-70724 零 GDI 调用）；
 *  ③ **前提不许被忘**：页表模型（引擎 `Font+3380`）与双游标（`Font+859/+860`）**目前都不存在** ——
 *     实现 `0x1D0` 的第一个动作必须是建它（清单见 `docs-new/03-engine/route-c-text-metrics-2026-09.md`）。
 *
 * ★**有人真的实现了 `0x1D0` 之后**：把 ①③ 两条改成真行为断言（push 页 → `op3=0/-1/-2` → 读回
 * `{窗口号, 起始记录下标}`、越界 `-1/-1`），并把台账 464 改成 `implemented`。**不要**只是删掉本文件。
 *
 * 权威 = `engine/天結_unpacked.exe_utf8.c`；本节所有 raw 行号都用定义头 grep 定位过。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import { TextItemTable } from '../src/vm/textItems.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', '..');

const GAPS = path.join(ROOT, 'analysis/opcode-gaps.json');
const TABLE = path.join(ROOT, 'docs-new/03-engine/opcode-table.md');
const DOC = path.join(ROOT, 'docs-new/03-engine/route-c-text-metrics-2026-09.md');

interface GapEntry {
  opcode: number;
  handler: string;
  argc: number;
  disposition: string;
  note: string;
}

function gapEntry(op: number): GapEntry {
  const entries = (JSON.parse(fs.readFileSync(GAPS, 'utf8')) as { entries: GapEntry[] }).entries;
  const e = entries.find((x) => x.opcode === op);
  assert.ok(e, `analysis/opcode-gaps.json 里必须有 0x${op.toString(16)}（缺了就成"静默缺口"）`);
  return e!;
}

function tableRow(hex: string): string {
  const line = fs
    .readFileSync(TABLE, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`| ${hex} |`));
  assert.ok(line, `docs-new/03-engine/opcode-table.md 里必须有 ${hex} 一行`);
  return line!;
}

test('★0x1D0/0x1D1 不许静默上桩：两条都必须"未注册"（命中即 NotImplementedOp 硬报错）', () => {
  for (const op of [0x1d0, 0x1d1]) {
    assert.ok(!OPS.has(op), `0x${op.toString(16)} 被登记进 OPS 了 —— 引擎事实是"没有等价模型"，上桩就是造假`);
    assert.ok(!NATIVE_OPS.has(op), `0x${op.toString(16)} 被登记进 NATIVE_OPS 了`);
    assert.ok(
      !ENGINE_INTERNAL_OPS.has(op),
      `0x${op.toString(16)} 被登记成 no-op —— 它是写回两个操作数的读端，no-op 会留下旧槽值（静默逻辑错误）`,
    );
    assert.equal(gapEntry(op).disposition, 'deferred', `0x${op.toString(16)} 台账处置应为 deferred`);
  }
});

test('★0x1D0/0x1D1 的定性不许退回「GDI 文本度量族」（附 argc 与 handler 事实）', () => {
  const a = gapEntry(0x1d0);
  assert.equal(a.handler, 'sub_42D440'); // 定义头 `//----- (0042D440)` → raw 38098
  assert.equal(a.argc, 3); // 只读 op3 一个入参，写 op1/op2
  assert.match(a.note, /回看页索引表/, '0x1D0 的定性必须是"回看页索引表·带步数读出"');
  assert.match(a.note, /sub_459860/, '必须点名被调函数（raw 70629-70724）');
  assert.match(a.note, /raw 70629-70724/, '必须给被调函数的 raw 行区间（零 GDI 的证据位置）');
  assert.match(a.note, /route-c-text-metrics-2026-09\.md/, '必须回链路线 C 说明文档');

  const b = gapEntry(0x1d1);
  assert.equal(b.handler, 'sub_420310'); // 定义头 `//----- (00420310)` → raw 29353
  assert.equal(b.argc, 5); // op1..op5
  assert.match(b.note, /回看页重绘/, '0x1D1 的定性必须是"回看页重绘"');
  assert.match(b.note, /sub_4675A0/, '必须点名落点函数（raw 80312-81522）');
  assert.match(b.note, /raw 80312-81522/, '必须给落点函数的 raw 行区间');
  assert.match(b.note, /route-c-text-metrics-2026-09\.md/, '必须回链路线 C 说明文档');
});

test('★opcode-table.md 两行同步（0x1D1 不许再是空白「仅映射」）', () => {
  const r0 = tableRow('0x1D0');
  assert.match(r0, /\| 3 \|/, '0x1D0 argc = 3');
  assert.match(r0, /sub_42D440/);
  assert.match(r0, /回看页索引表/);
  assert.match(r0, /deferred/, 'emulator 状态要在行里写明');
  assert.match(r0, /\*\*不是 GDI 度量\*\*/, '必须显式否掉旧标签');

  const r1 = tableRow('0x1D1');
  assert.match(r1, /\| 5 \|/, '0x1D1 argc = 5');
  assert.match(r1, /sub_420310/);
  assert.match(r1, /回看页重绘/);
  assert.match(r1, /deferred/);
  assert.ok(r1.length > 200, '0x1D1 行不许再是空白「仅映射」');
});

test('★前提守卫：回看页表模型/双游标在 emulator 里还不存在（实现 0x1D0 前必须先建）', () => {
  const t = new TextItemTable();
  const keys = new Set(Object.keys(t));
  assert.ok(keys.has('records'), '记录表（Font+3364）已建 —— 这是 0x1D0 的 op2 所指的那张表');
  // 引擎的页表（Font+3380）、双游标（Font+859/+860）在这里没有对应物；有人加了就必须改本断言为真行为断言
  for (const k of ['pages', 'pageTable', 'cursor', 'baseCursor']) {
    assert.ok(!keys.has(k), `TextItemTable 出现了 \`${k}\` —— 说明有人开始建回看页模型了：请把本文件 ①③ 改成真行为断言`);
  }
  // 记录表里也不会有掩码 bit1（`0x1D0` 末参 2 的过滤位）：渲染层的记录 push 未建模
  assert.equal(t.records.length, 0, '新建的 TextItemTable 必须是空表');

  // 说明文档必须在，且带着关键 raw 锚点（下一个 agent 的开工依据）
  const doc = fs.readFileSync(DOC, 'utf8');
  for (const anchor of ['sub_42D440', 'sub_459860', 'sub_420310', 'sub_4675A0', '84047', '10716']) {
    assert.ok(doc.includes(anchor), `route-c 文档里缺锚点 ${anchor}`);
  }
  assert.ok(doc.includes('Font+3380'), 'route-c 文档必须写清要建的页表（Font+3380）');
  assert.ok(doc.includes('Font+859'), 'route-c 文档必须写清要建的双游标（Font+859/+860）');
});
