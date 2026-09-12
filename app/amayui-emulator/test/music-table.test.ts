/**
 * **音乐表指令族**（`0x1D6` / `0x1D7` / `0x1D8`）回归（`src/vm/handlers/music-table.ts`）。
 *
 * 锁三件事（证据行号见 `analysis/functions.json` 的 `0x42E7C0`/`0x42E800`/`0x42E850` 与
 * `docs-new/03-engine/opcode-table.md`，vtable 槽位见 `.tmp/vtableProbe2.mjs` 对 `0x5291FC` 的 dump）：
 *  1. **返回值（= 写 op1）逐支对齐**：`0x1D6` 给新曲号、`0x1D7` 给 `新组数−1`/`0`/`−1`、
 *     `0x1D8` 给 `(组号<<24)|(新长度−1)` 或洞下标；
 *  2. **表本身被改**（这是副作用，不是纯读）：即使 op1 落在**无人读取**的全局槽（`$3$AUTORUN.txt:68`
 *     → `global 70801e`）也照样写入，且组表内容与引擎一致（组内下标 0 = 占位槽）；
 *  3. **曲号解析**（`resolveBgmResource` = 引擎 `sub_48DB80`）：扁平表 `base[曲号 − 2]`、
 *     包内曲号 `groups[(id>>24)−1][id & 0xFFFFFF]`（**直接下标**）。
 *
 * 为什么值得单独测：这三条此前被登记成 no-op（"写进没人读的 global 所以不影响可观察状态"）——
 * 一旦按 no-op 处理，"全局表内容取决于哪条指令被当成 no-op"，且**扩展包登记进来的曲子永远查不到**
 * （`resolveBgmResource` 拿不到值 ⇒ 只能退回文件名兜底）。操作数顺序/下标差 1 都不报错，只静音错曲。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine, Frame } from '../src/vm/engine.js';
import { StubNative } from '../src/vm/native.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import { resolveBgmResource } from '../src/vm/handlers/music-table.js';
import { dec, i32 } from '../src/vm/bits.js';
import { parseSys4MusicTables } from '../src/script/alf.js';
import { resolveResourceDir } from '../src/arch/resourceDir.js';
import type { BinArg, BinInstruction } from '../src/script/bin.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const RES = resolveResourceDir(ROOT);
const hasCorpus = fs.existsSync(path.join(RES, 'SYS4INI.BIN'));

/** `global-int N`（脚本里的 `(global-int …)`）。 */
const G = (n: number): BinArg => ({ type: 3, raw: n }) as unknown as BinArg;
/** 立即整数。 */
const I = (v: number): BinArg => ({ type: 0, raw: v }) as unknown as BinArg;

/** 读一个全局 int 槽（还原 DEC）。 */
function gv(e: Engine, n: number): number {
  return i32(dec(e.key, e.globals.int.get(n) ?? 0));
}

function mk(): { e: Engine; step: (op: number, args?: BinArg[]) => void } {
  const e = new Engine(new StubNative(() => {}));
  const f = new Frame();
  const step = (op: number, args: BinArg[] = []): void => {
    const instr = {
      opcode: op, name: `i${op.toString(16)}`, argc: args.length, args, byteOffset: 0, index: 0,
    } as unknown as BinInstruction;
    const h = OPS.get(op);
    assert.ok(h, `0x${op.toString(16)} 应在 OPS（音乐表真实现）里`);
    h!(makeCtx(e, f, instr, new StubNative(() => {}), () => {}));
  };
  return { e, step };
}

test('注册表棘轮：0x1D6/0x1D7/0x1D8 在 OPS，且不再是 engine-internal no-op', () => {
  for (const op of [0x1d6, 0x1d7, 0x1d8]) {
    assert.ok(OPS.has(op), `0x${op.toString(16)} 应在 OPS`);
    assert.ok(!ENGINE_INTERNAL_OPS.has(op), `0x${op.toString(16)} 不应再是 engine-internal no-op`);
    assert.ok(!NATIVE_OPS.has(op), `0x${op.toString(16)} 不应在 NATIVE_OPS（纯 VM 状态）`);
  }
});

test('0x1D6：追加进扁平表，op1 = 新曲号（= 元素个数 + 1）', () => {
  const { e, step } = mk();
  e.musicTable.base = [7, 8]; // 已有 2 条 ⇒ 曲号 2、3
  step(0x1d6, [G(100), I(0x2a)]);
  assert.equal(gv(e, 100), 4, '返回 元素个数(3) + 1 = 4 = 刚追加那条的曲号');
  assert.deepEqual(e.musicTable.base, [7, 8, 0x2a]);
  step(0x1d6, [G(100), I(0x2b)]);
  assert.equal(gv(e, 100), 5);
});

test('0x1D7：空组表 ⇒ 建到 op2 组，每组一个占位 0，op1 = 新组数 − 1', () => {
  const { e, step } = mk();
  step(0x1d7, [G(1396), I(1)]); // $3$AUTORUN.txt:67
  assert.deepEqual(e.musicTable.groups, [[0]]);
  assert.equal(gv(e, 1396), 0, '新组数 1 ⇒ op1 = 0');

  const b = mk();
  b.step(0x1d7, [G(1), I(3)]);
  assert.deepEqual(b.e.musicTable.groups, [[0], [0], [0]], '缺的组补占位 0');
  assert.equal(gv(b.e, 1), 2);
});

test('0x1D7：已有该组 ⇒ 重置成只剩占位槽并返回 0；op2=0 / 负值 各自的分支', () => {
  const { e, step } = mk();
  e.musicTable.groups = [[0, 11, 22]];
  step(0x1d7, [G(1), I(1)]);
  assert.deepEqual(e.musicTable.groups, [[0]], '已有组被截断（保留下标 0 的占位）');
  assert.equal(gv(e, 1), 0);

  step(0x1d7, [G(1), I(0)]); // 组数 ≥ 0 ⇒ else 分支，子调用越界返回 −1 但被丢弃
  assert.deepEqual(e.musicTable.groups, [[0]]);
  assert.equal(gv(e, 1), 0);

  step(0x1d7, [G(1), I(-2)]);
  assert.equal(gv(e, 1), -1, 'op2 < 0 ⇒ −1');
});

test('0x1D7：扩容保留已有组的内容，只重置最后一组（引擎循环只填空组）', () => {
  const { e, step } = mk();
  e.musicTable.groups = [[0, 11, 22]];
  step(0x1d7, [G(1), I(3)]);
  assert.deepEqual(e.musicTable.groups, [[0, 11, 22], [0], [0]]);
  assert.equal(gv(e, 1), 2);
});

test('0x1D8：组内 ≤1 个元素 ⇒ 追加，op1 = (组号 << 24) | (新长度 − 1)', () => {
  const { e, step } = mk();
  e.musicTable.groups = [[0]];
  step(0x1d8, [G(0x70801e), I(1), I(0x30003b2)]); // $3$AUTORUN.txt:68
  assert.deepEqual(e.musicTable.groups, [[0, 0x30003b2]]);
  assert.equal(gv(e, 0x70801e), 0x1000001, '★写进无人读取的 global 也必须有值（副作用）');
  assert.equal(0x1000001 & 0xffffff, 1, '低 24 位 = 刚追加元素的下标（与 sub_48DB80 的直接下标自洽）');
});

test('0x1D8：组内 >1 ⇒ 从下标 1 起填第一个 0 槽，op1 = 槽下标；无洞 ⇒ 追加', () => {
  const { e, step } = mk();
  e.musicTable.groups = [[0, 5, 0, 7]];
  step(0x1d8, [G(1), I(1), I(9)]);
  assert.deepEqual(e.musicTable.groups, [[0, 5, 9, 7]]);
  assert.equal(gv(e, 1), 2, '洞在下标 2（下标 0 是占位，永不填）');

  step(0x1d8, [G(1), I(1), I(10)]);
  assert.deepEqual(e.musicTable.groups, [[0, 5, 9, 7, 10]]);
  assert.equal(gv(e, 1), (1 << 24) | 4);
});

test('0x1D8：组越界（<1 或 > 组数）⇒ op1 = −1，且不改表', () => {
  const { e, step } = mk();
  e.musicTable.groups = [[0]];
  step(0x1d8, [G(1), I(2), I(5)]);
  assert.equal(gv(e, 1), -1);
  step(0x1d8, [G(1), I(0), I(5)]);
  assert.equal(gv(e, 1), -1);
  assert.deepEqual(e.musicTable.groups, [[0]]);
});

test('resolveBgmResource：扁平表 = base[曲号 − 2]；包内曲号 = groups[(id>>24)−1][id & 0xFFFFFF]', () => {
  const { e } = mk();
  e.musicTable.base = [0, 0, 0, 23]; // 曲号 5 → base[3] = 23
  assert.deepEqual(resolveBgmResource(e, 5), { id: 23 });
  assert.equal(resolveBgmResource(e, 2), undefined, '占位 0 不产出资源');
  assert.equal(resolveBgmResource(e, 99), undefined, '越界不产出资源');
  assert.equal(resolveBgmResource(e, 1), undefined, '曲号 < 2 ⇒ 负下标');

  e.musicTable.groups = [[0, 0x30003b2]];
  assert.deepEqual(resolveBgmResource(e, 0x1000001), { id: 0x30003b2 }, '★下标直接取，不再 −1');
  assert.equal(resolveBgmResource(e, 0x1000000), undefined, '下标 0 = 占位槽，引擎也拒（v4−1 < 0）');
  assert.equal(resolveBgmResource(e, 0x1000002), undefined, '越界');
  assert.equal(resolveBgmResource(e, 0x2000001), undefined, '组不存在');
});

test('★真实语料：SYS4INI 的曲号表 + $3$AUTORUN 的登记链（i1d7 ⇒ i1d8 ⇒ 曲号可解析）', { skip: !hasCorpus }, () => {
  const tables = parseSys4MusicTables(new Uint8Array(fs.readFileSync(path.join(RES, 'SYS4INI.BIN'))));
  assert.equal(tables.base.length, 59, '实测 SYS4INI 尾部 PCM 扁平表 59 条');
  assert.equal(tables.base[29], 23, '曲号 0x1f(31) → 文件 id 23 = BGM031.OGG（标题曲）');
  assert.equal(tables.base[16], 15, '曲号 0x12(18) → 文件 id 15 = BGM018.OGG');

  const { e, step } = mk();
  e.musicTable = { other: tables.other, base: tables.base, groups: [] };
  assert.deepEqual(resolveBgmResource(e, 0x1f), { id: 23 });

  // $3$AUTORUN.txt:67-68 逐条演练
  step(0x1d7, [G(1396), I(1)]);
  assert.equal(gv(e, 1396), 0);
  step(0x1d8, [G(0x70801e), I(1), I(0x30003b2)]);
  assert.equal(gv(e, 0x70801e), 0x1000001);
  assert.deepEqual(resolveBgmResource(e, 0x1000001), { id: 0x30003b2 }, '扩展包曲号走组表 → 包 3 的文件 id');
});
