/** @tier T0 @kind ratchet @subsystem text */

/**
 * **`0x1D0` / `0x1D1` 的判定棘轮**（2026-09 扩展路线 C：`tickets/T-0076`）。
 *
 * ## 2026-09 `T-0095` / `T-0170` 之后的现状
 * `0x1D0` **已实现**（真行为断言搬到新文件 `test/op-1d0-page-index.test.ts`：push 页 →
 * `op3 = 0/-1/-2` → 读回 `{窗号, 起始记录下标}`、越界 `-1/-1`、清表 …）。
 * `0x1D1` **也已实现**（`T-0170`：它是 `0x82` 的孪生兄弟「重画窗 op1 的第 op2 条起的记录」，
 * 逐分支按体实现，缺口写在 `analysis/opcode-gaps.json` 该条的 `note` 里）；
 * 它的真行为断言在新文件 `test/recall-page-0x1d1.test.ts`（13 例，含 E3）。
 * 本文件**不再**守 0x1D0 的"未注册"，改守三件不会漂移的事：
 *  ① **`0x1D1` 必须落在 `OPS`（真实现），不得被 `NATIVE_OPS`/`ENGINE_INTERNAL_OPS` 掩盖** ——
 *     它是回看画面的正文重画入口（`sub_4675A0` raw 80312-81522）；登记成 no-op 会让回想画面
 *     **静默不刷新**（比硬报错更糟），宿主缝也接不住它（它不是渲染/音频/输入意图）。
 *     ★**台账处置值的结算**（`analysis/opcode-gaps.json` 的 465 → `implemented`/`partial`）
 *     刻意**不由本文件单独钉死**：它归 `T-0149`（缺口台账加 `partial` 处置位）的结算步 ——
 *     这里只要求"别是 `deferred`"（与同文件对 `0x1D0` 的口径一致）。
 *  ② **两条的标签不许退回「GDI 文本度量族」**：`0x1D0` =「**回看页索引表·带步数读出**」（零 GDI：
 *     `sub_459860` raw 70629-70724）、`0x1D1` =「**回看页重绘**」；
 *  ③ **模型前提不许被删**：回看页表（`Font+3380`）与双游标（`Font+859/+860`）现在**已经建了**
 *     （`src/vm/textItems.ts` 的 `pages`/`cursor`/`baseCursor`）⇒ 这里反过来钉住"不许删回去"。
 *
 * ★**`0x1D1` 的语义纠正留痕**（`T-0170`）：路线 C 当初写「照抄只能得到语义不等价的近似」——
 * 那只对**逐字 GDI 光栅化**成立；**记录切片/越界门/颜色覆写与恢复/记录分流**是纯 VM 语义，
 * 已按体实现（`TextItemTable.repaintRange` + `handlers/msgwin.ts` 的 `op_recall_page_repaint`）。
 * 仍然做不到的（登记在 `missing[]`）：专用路径 `sub_4634B0` 的第二套渲染器、窗对象 `+112`、
 * `win[56]/[70]` 栏带四边形循环、`sub_404CB0(语音)` 的占线查询、逐字 GDI 度量本身。
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
const DOC = path.join(ROOT, 'docs-new/99-records/2026-09-route-c/route-c-text-metrics-2026-09.md');

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

test('★0x1D1 必须落在 OPS（真实现），不得被桩/no-op 掩盖（`T-0170` 按体实现后）', () => {
  const op = 0x1d1;
  assert.ok(OPS.has(op), `0x${op.toString(16)} 必须是真实现 —— 回看画面唯一的正文重画入口`);
  assert.ok(!NATIVE_OPS.has(op), `0x${op.toString(16)} 被登记进 NATIVE_OPS 了（它不是宿主缝）`);
  assert.ok(
    !ENGINE_INTERNAL_OPS.has(op),
    `0x${op.toString(16)} 被登记成 no-op —— no-op 会让回想画面静默不刷新`,
  );
  assert.ok(
    ['implemented', 'partial'].includes(gapEntry(op).disposition),
    `0x${op.toString(16)} 台账处置必须已结算（implemented/partial），不得停在 deferred`,
  );
});

test('★0x1D0 已实现：必须落在 OPS（真实现），且不得同时出现在另两张表', () => {
  assert.ok(OPS.has(0x1d0), '0x1D0 必须注册在 OPS（真实现）—— 行为断言见 test/op-1d0-page-index.test.ts');
  assert.ok(!NATIVE_OPS.has(0x1d0), '0x1D0 是纯 VM 状态，不得落宿主缝');
  assert.ok(!ENGINE_INTERNAL_OPS.has(0x1d0), '0x1D0 写回两个操作数，绝不能被 no-op 掩盖');
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
  // ★emulator 状态列（deferred → implemented）由主 agent 结算时改 ===> 这里**不钉死**它，
  //   只要求它明确写着某个状态、而不是留空。
  assert.match(r0, /deferred|implemented/, 'emulator 状态要在行里写明');
  assert.match(r0, /\*\*不是 GDI 度量\*\*/, '必须显式否掉旧标签');

  const r1 = tableRow('0x1D1');
  assert.match(r1, /\| 5 \|/, '0x1D1 argc = 5');
  assert.match(r1, /sub_420310/);
  assert.match(r1, /回看页重绘/);
  // ★emulator 状态列（deferred → implemented/partial）由台账 owner 结算时改 ===> 这里**不钉死**它，
  //   只要求它明确写着某个状态、而不是留空（与上面 `0x1D0` 行同口径）。
  assert.match(r1, /deferred|implemented|partial/, 'emulator 状态要在行里写明');
  assert.ok(r1.length > 200, '0x1D1 行不许再是空白「仅映射」');
});

test('★模型守卫：回看页表模型/双游标已在 TextItemTable 里建好（T-0095，不许删回去）', () => {
  const t = new TextItemTable();
  const keys = new Set(Object.keys(t));
  assert.ok(keys.has('records'), '记录表（Font+3364）—— 这是 0x1D0 的 op2 所指的那张表');
  for (const k of ['pages', 'cursor', 'baseCursor']) {
    assert.ok(keys.has(k), `TextItemTable 缺 \`${k}\`（引擎 Font+3380 / Font+859 / Font+860）`);
  }
  assert.equal(t.pages.length, 0, '新建的页表必须是空的');
  assert.equal(t.cursor, 0, '游标初值 0');
  assert.equal(t.baseCursor, 0, 'baseCursor 初值 0');
  // push 一条：`start` = 当时的记录条数（全窗共用的那张表），双游标都指向新末项
  t.pushPage(3);
  assert.deepEqual(t.pages, [{ win: 3, start: 0 }], 'push 形状 = {窗号, records.length}（raw 73184-73185）');
  assert.equal(t.cursor, 0);
  assert.equal(t.baseCursor, 0);

  // 说明文档必须在，且带着关键 raw 锚点（下一个 agent 的开工依据）
  const doc = fs.readFileSync(DOC, 'utf8');
  for (const anchor of ['sub_42D440', 'sub_459860', 'sub_420310', 'sub_4675A0', '84047', '10716']) {
    assert.ok(doc.includes(anchor), `route-c 文档里缺锚点 ${anchor}`);
  }
  assert.ok(doc.includes('Font+3380'), 'route-c 文档必须写清回看页表（Font+3380）');
  assert.ok(doc.includes('Font+859'), 'route-c 文档必须写清双游标（Font+859/+860）');
});
