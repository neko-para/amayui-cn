/** @tier T0 @kind core @subsystem ops */

/**
 * **A6（AGERC 模块接口）+ A4（图元/网格/纹理/渲染状态）的回归测试**（2026-09）。
 *
 * A6 = `0x14B` `0x14C` `0x14D`：模型化 AGERC（不加载原生库），只接受 `AGERC.DLL`（文件 id `0x5250`）；
 *      导出表按 PE 实读的 21 个名字建，其中只有 `_SetNameLenMax@20` 有行为实现。
 * A4 = 13 条：`0x238`/`0x258` 建模（写引擎状态），其余 11 条走宿主缝（渲染侧）。
 *
 * 台账见 `docs-new/99-records/2026-09-audit/stub-reaudit-2026-09.md` §5；逐条引擎实证见各 handler 的注释。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, Frame } from '../src/vm/engine.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import { AGERC_FILE_ID, AGERC_EXPORTS } from '../src/vm/handlers/agerc.js';
import { StubNative } from '../src/vm/native.js';
import { dec, enc } from '../src/vm/bits.js';
import type { BinArg, BinInstruction } from '../src/script/bin.js';
import type { NativeBridge } from '../src/vm/native.js';
import { im, instr, str } from './harness.js';
import { newSceneState } from '../src/renderer/scene/state.js';
import { scEnsureItem, scSetSlotParams } from '../src/renderer/scene/ops.js';

/** 立即数 float：`raw` 必须是 **IEEE 位模式**（`readFloatOperand` 走 `floatBits(raw)`）。 */
const fm = (v: number): BinArg =>
  ({ type: 1, raw: new Uint32Array(new Float32Array([v]).buffer)[0]! }) as unknown as BinArg;
/** 本帧 int 槽（type 0x9）—— 可作写目标，也可当 `i14d` 的「数组」操作数（引擎 `sub_42AEA0` 取址）。 */
const loc = (slot: number): BinArg => ({ type: 0x9, raw: slot }) as unknown as BinArg;


function mk(native: NativeBridge = new StubNative(() => {})) {
  const e = new Engine(native);
  const f = new Frame();
  const run = (op: number, args: BinArg[] = []): void => {
    const h = OPS.get(op) ?? NATIVE_OPS.get(op);
    assert.ok(h, `0x${op.toString(16)} 应已实现`);
    h!(makeCtx(e, f, instr(op, args), native, () => {}));
  };
  return { e, f, run };
}

const A4 = [0x1fc, 0x1fe, 0x207, 0x20e, 0x224, 0x229, 0x238, 0x242, 0x256, 0x258, 0x321, 0x32a, 0x32d];
const A6 = [0x14b, 0x14c, 0x14d];

// ★2026-09-23：`A6`/`A4` 的注册表棘轮已并入 `test/registry-classification.test.ts`（`tickets/T-0129`）。

// ---------------------------------------------------------------------------
// A6：AGERC 模块接口
// ---------------------------------------------------------------------------

test('A6 主线：i14b 5250 → set-agerc-export → call-agerc-export（SAVE.txt:6-9 的整条链）', () => {
  const { e, f, run } = mk();
  // 1) 加载模块（唯一合法 id）
  run(0x14b, [im(AGERC_FILE_ID)]);
  assert.equal(e.agerc.loaded, true);
  // 2) 绑定导出到槽 1
  run(0x14c, [im(1), { type: 2, raw: 0, str: '_SetNameLenMax@20' } as unknown as BinArg]);
  assert.equal(e.agerc.exports.get(1), '_SetNameLenMax@20');
  // 3) 调用：`mov (local-int 21bc) 12` ⇒ 数组首元素 = enc(12)；op4 = 1（长度）
  f.locals.int.set(0x21bc, enc(e.key, 12));
  f.locals.int.set(0x0c, 0); // op2 = 返回值目标
  run(0x14d, [im(1), loc(0x0c), loc(0x21bc), im(1), loc(0x21bc), im(0)]);
  assert.equal(e.agerc.nameLenMax, 12, 'AGERC 侧 dword_100A9000 = DEC 后的首元素（默认 18）');
  assert.equal(dec(e.key, f.locals.int.get(0x21bc) ?? 0), 12, 'op3 的数组被 ENC 回写（值不变）');
  assert.equal(dec(e.key, f.locals.int.get(0x0c) ?? 0), 0, 'op2 ← 被调函数返回值（_SetNameLenMax 返回 0）');
  // 导出名集合与 PE 实读一致（21 个）
  assert.equal(AGERC_EXPORTS.length, 21);
});

test('A6：只接受 AGERC.DLL —— 其它 id / 名字 / 槽号按引擎同文报错', () => {
  const { run } = mk();
  assert.throws(() => run(0x14b, [im(0x1234)]), /読み込み出来ません/, '非 AGERC 的 id ⇒ 抛引擎同文的加载失败');
  // 未加载就绑定 ⇒ 报错
  const { run: run2 } = mk();
  assert.throws(() => run2(0x14c, [im(0), { type: 2, raw: 0, str: '_SetNameLenMax@20' } as unknown as BinArg]), /模块未加载|アドレス取得/);
  // 加载后：未知导出名 / 槽越界
  const { run: run3 } = mk();
  run3(0x14b, [im(AGERC_FILE_ID)]);
  assert.throws(
    () => run3(0x14c, [im(0), { type: 2, raw: 0, str: 'NotAnExport' } as unknown as BinArg]),
    /アドレス取得に失敗しました/,
  );
  assert.throws(
    () => run3(0x14c, [im(100), { type: 2, raw: 0, str: '_SetNameLenMax@20' } as unknown as BinArg]),
    /0から99まで/,
  );
});

test('A6：重复加载 = 重载（清空已绑定的槽）；未绑定槽 / 未建模导出调用即抛', () => {
  const { e, run } = mk();
  run(0x14b, [im(AGERC_FILE_ID)]);
  run(0x14c, [im(3), { type: 2, raw: 0, str: '_SetNameLenMax@20' } as unknown as BinArg]);
  assert.equal(e.agerc.exports.get(3), '_SetNameLenMax@20');
  run(0x14b, [im(AGERC_FILE_ID)]); // 重载
  assert.equal(e.agerc.exports.size, 0, '引擎：已有句柄 ⇒ FreeLibrary + 清 0（槽表随之作废）');
  assert.throws(() => run(0x14d, [im(3), loc(0), loc(1), im(1), loc(1), im(0)]), /未绑定导出/);
  // 可绑定但本作不可达的导出（地图/碰撞）⇒ 调用即抛明确错误，不静默成功
  run(0x14c, [im(2), { type: 2, raw: 0, str: '_FindClash@20' } as unknown as BinArg]);
  assert.throws(() => run(0x14d, [im(2), loc(0), loc(1), im(0), loc(1), im(0)]), /未建模/);
});

// ---------------------------------------------------------------------------
// A4：建模的两条
// ---------------------------------------------------------------------------

test('A4 0x238：写 Engine[92338]=0 / [92339]=op1', () => {
  const { e, run } = mk();
  e.engineValues.set(92338, 0xdead);
  run(0x238, [im(0x2d0)]);
  assert.equal(e.engineValues.get(92338), 0);
  assert.equal(e.engineValues.get(92339), 0x2d0);
});

/**
 * ★`0x243`（`sub_41B180` raw 26016-26031，argc 0）—— **复位 `0x400` 等待门的计时器**（审计 P1 `op-3-002` 缺口，
 * 语料 341 处 / 338 个脚本独立使用）。与 `0x238`（装）成对：`i238 N` + `wait` 等 N ms，`i243` 清掉它。
 * 门控：`Engine[92340] & 2` 置位时引擎整段跳过（`0x24E` 写那个字段）。
 */
test('★0x243：清 0x400 等待门计时器（gateWaitStart/Ms + engineValues 第二视图），且受 Engine[92340] bit1 门控', () => {
  const { e, run } = mk();
  // 门控关闭（bit1 = 0）⇒ 清
  run(0x238, [im(0x2d0)]); // 先装 720ms
  e.gateWaitStart = 0x1234;
  run(0x243, []);
  assert.equal(e.gateWaitStart, 0, '起点清零');
  assert.equal(e.gateWaitMs, 0, '时长清零');
  assert.equal(e.engineValues.get(92338), 0, '第二视图同步（与 0x238 同口径）');
  assert.equal(e.engineValues.get(92339), 0);
  // 门控打开（bit1 = 1）⇒ 整段跳过（引擎同）
  run(0x238, [im(0x2d0)]);
  e.gateWaitStart = 0x1234;
  e.engineValues.set(92340, 2);
  run(0x243, []);
  assert.equal(e.gateWaitStart, 0x1234, 'bit1 置位 ⇒ 不清起点');
  assert.equal(e.gateWaitMs, 0x2d0, 'bit1 置位 ⇒ 不清时长');
});

test('A4 0x258：纹理槽标志对（bit0/bit1，两张镜像表同值 ⇒ 一个值表示）', () => {
  const { e, run } = mk();
  run(0x258, [im(5), im(3)]);
  assert.equal(e.texSlotFlags.get(5), 3, 'bit0|bit1');
  run(0x258, [im(5), im(0)]);
  assert.equal(e.texSlotFlags.get(5), 0, '再写 0 ⇒ 两位都清（引擎两条 else 分支）');
  run(0x258, [im(5), im(1)]);
  assert.equal(e.texSlotFlags.get(5), 1);
  run(0x258, [im(999), im(0xff)]);
  assert.equal(e.texSlotFlags.get(999), 3, '只取低两位（引擎只判 bit0/bit1）');
});

/**
 * ★★`0x256` 必须**真的移动图元**（`tickets/T-0028`）★★
 *
 * 引擎 `sub_4ACD10`：`op1`=起始 handle、`op2`=**count**（区间 `[op1, op1+op2)`），对区间内**已存在**的
 * 绘制项写 `+0x68=1` + 平移 work 矩阵（立即）。`DRAWCHARM.txt:182-186` 在 `global 1399 == 1`（收起）
 * 时用 `i256 0x19835 15 6e 0 0` 把侧边栏 21 个槽推到屏右外 —— 只记录不生效 ⇒ 每次重绘都画回基准位
 * `x=0x49c`（看起来"被 hover 展开"）。
 */
test('★A4 0x256：对 [handle, handle+count) 内已存在的项做立即平移（含区间外不动 / 不补建 / 记录仍保留）', () => {
  const s = newSceneState();
  for (const h of [0x19835, 0x19836, 0x19837, 0x19850]) scEnsureItem(s, h);
  const o = scSetSlotParams(s, 0x19835, 3, 0x6e, 0, 0);
  assert.equal(o, 'applied');
  for (const h of [0x19835, 0x19836, 0x19837]) {
    const it = s.drawItems.get(h)!;
    assert.deepEqual(
      { work: it.transWork.x, target: it.transTarget.x, useWorld: it.useWorld },
      { work: 0x6e, target: 0x6e, useWorld: true },
      `0x${h.toString(16)} 应被平移 +0x6e（work 与 target 都写：无窗时求值走 target）`,
    );
  }
  assert.equal(s.drawItems.get(0x19850)!.transWork.x, 0, '区间外的项不得被动');
  assert.equal(s.drawItems.has(0x19834), false, '区间内不存在的 handle 不补建（引擎按容器区间遍历）');
  assert.deepEqual(s.render4.slotParams.get(0x19835), [3, 0x6e, 0, 0], 'A4 族的记录仍保留（报告/digest 用）');
  assert.equal(s.dirty, true);
});

// ---------------------------------------------------------------------------
// A4：11 条宿主缝（用 spy 断言参数形状）
// ---------------------------------------------------------------------------

test('A4 宿主缝：11 条转发到 NativeBridge 的参数与引擎一致', () => {
  const calls: Array<[string, ...number[]]> = [];
  const native = new StubNative(() => {});
  const spy = native as unknown as Record<string, (...a: unknown[]) => void>;
  spy.resetPrimTransform = (h) => calls.push(['resetPrim', h as number]);
  spy.setPrimTransform4 = (h, a, b, c, d) => calls.push(['prim4', h as number, a as number, b as number, c as number, d as number]);
  spy.blitSlotToSlot = (s, d, sr, dr) => calls.push(['blit', s as number, d as number, ...(sr as number[]), ...(dr as number[])]);
  spy.commitGraphics = () => calls.push(['commit']);
  spy.clearTransitions = () => calls.push(['clearTrans']);
  spy.setDrawModeBlock = (a, b, x, y, z) => calls.push(['mode', a as number, b as number, x as number, y as number, z as number]);
  spy.setDrawEntryParam = (entry, v) => calls.push(['entryParam', entry as number, v as number]);
  spy.setSlotParams = (s, a, x, y, z) => calls.push(['slotParams', s as number, a as number, x as number, y as number, z as number]);
  spy.setMeshEntryAttr = (m, i, v) => calls.push(['meshAttr', m as number, i as number, v as number]);
  spy.release3DSlot = (s) => calls.push(['rel3d', s as number]);
  spy.set3DColor = (r, g, b, a) => calls.push(['color3d', r as number, g as number, b as number, a as number]);

  const { run } = mk(native);
  run(0x1fc, [im(0x1234)]);
  run(0x1fe, [im(0x1234), fm(1), fm(2), fm(3), fm(4)]);
  run(0x207, [im(10), im(20), im(1), im(2), im(30), im(40), im(100), im(200)]);
  run(0x20e);
  run(0x224);
  run(0x229, [im(7), im(8), fm(0.5), fm(1.5), fm(2.5)]);
  run(0x242, [im(9), im(0x2d0)]);
  run(0x256, [im(11), im(3), fm(1), fm(2), fm(3)]);
  run(0x321, [im(12), im(5), im(0x77)]);
  run(0x32a, [im(13)]);
  run(0x32d, [im(255), im(0x0000ff)]);

  assert.deepEqual(calls, [
    ['resetPrim', 0x1234],
    ['prim4', 0x1234, 1, 2, 3, 4],
    ['blit', 10, 20, 1, 2, 31, 42, 100, 200, 130, 240],
    ['commit'],
    ['clearTrans'],
    ['mode', 7, 8, 0.5, 1.5, 2.5],
    ['entryParam', 9, 0x2d0],
    ['slotParams', 11, 3, 1, 2, 3],
    ['meshAttr', 12, 5, 0x77],
    ['rel3d', 13],
    // ★2026-09（`tickets/T-0155`）订正：`i32d 255 ff` 的 `op2 = 0x0000FF` 是**蓝**（引擎 raw 34048-34051：
    //   `(u8)op2` = 最低字节 → `a4`（蓝），`BYTE2(op2)` → `a2`（红））⇒ 正确值是 (0,0,1,1)。
    //   旧断言写的 `(1,0,0,1)` 是"最低字节当红"这个**修前缺陷**的镜像（体证见
    //   `sub_499DF0` raw 116637 的 `R|((G|((B|(A<<8))<<8))<<8)` 逐位交叉核对）。
    ['color3d', 0, 0, 1, 1],
  ]);
});

test('A4：11 条宿主缝都不写脚本操作数（与"视觉/死写类"的判据一致）', () => {
  const { e, run } = mk();
  const before = { a: 0x1234, b: 0x5678 };
  e.globals.int.set(0x300, enc(e.key, before.a));
  e.globals.int.set(0x301, enc(e.key, before.b));
  const g = (slot: number): BinArg => ({ type: 3, raw: slot }) as unknown as BinArg;
  for (const op of A4) {
    // 备足 8 个全局 int（`0x207` 的 argc 最大 = 8；多给的参数对别的 handler 无害）
    run(op, [g(0x300), g(0x301), g(0x302), g(0x303), g(0x304), g(0x305), g(0x306), g(0x307)]);
    assert.equal(dec(e.key, e.globals.int.get(0x300) ?? 0), before.a, `0x${op.toString(16)} 不应写 op1`);
    assert.equal(dec(e.key, e.globals.int.get(0x301) ?? 0), before.b, `0x${op.toString(16)} 不应写 op2`);
  }
});
