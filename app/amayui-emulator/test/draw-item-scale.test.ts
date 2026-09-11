/**
 * 回归测试：**`0x1FD`（立即缩放）与 DrawItem 世界矩阵的合成条件**。
 *
 * 症状（2026 实测）：「CONFIG1 右侧滚动条**只有上下两段**，中段不见了，但拖动功能正常」。
 *
 * 引擎事实（raw）：
 *  - `0x1FD`（`sub_422FD0` raw 31313）读 `op2/3/4` 后 **÷`dbl_5201F0`**，而
 *    `dbl_5201F0 = 100.0`（raw 4430）⇒ 脚本里 `64` = 100% = 1.0；
 *    再调 `sub_4AC5F0`（raw 131333）：`+0x68 = 1`（用世界矩阵）+ `D3DXMatrixScaling(元素+0x6C)`（缩放 **work** 矩阵）。
 *  - 脚本（`src/CONFIG1.txt:2934-2971`）的拇指是**三段式**：
 *      上盖 `27×23` → 中段 **`27×1`**（靠 `i1fd <obj> 64 <h·64> 64` 纵向放大）→ 下盖 `27×24`
 *    ⇒ 中段源高只有 1px：**`0x1FD` 不落到渲染就看不见**（不会报错）。
 *  - pivot（`0x217`）与描画位置**同处一个坐标空间**：`sub_49AA30` 的世界矩阵是
 *    `T(-pivot)·S·R·Tt·T(+pivot)`（raw 117428 / 117932），而四边形已建在描画位置上
 *    （`sub_4A2D50` 把 `&v26[9]` 交给纹理绘制）⇒ 等价于 Pixi 的 `pivot = pivot − pos`。
 *  - 世界矩阵**只在该项 `+0x68` 置位时才参与**（raw 123055 `if (Scene+46532) …`，
 *    而 `Scene+46532 ← DrawItem+0x68`，raw 133391）；`+0x68` 由变换类指令置位：
 *    `0x1FD`(131346) / `0x1FF`(131417) / `0x21E`(132009) / `0x21F`(132053) / `0x220`(132106)。
 *
 * 本测试锁四件事：`0x1FD` 的 ÷100 与"立即生效"、`0x21E` 的 ÷100 订正、
 * pivot 的坐标系换算、以及"没设过变换的项不被世界矩阵挪走"。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NativeBridge } from '../src/vm/native.js';
import { Engine } from '../src/vm/engine.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { enc } from '../src/vm/bits.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import {
  applyDrawScale,
  applyDrawTranslation,
  applyRotationAnim,
  applyScaleAnim,
  applyTranslationAnim,
  itemPivotLocal,
  itemScale,
  makeItem,
  type Item,
} from '../src/renderer/drawItem.js';
import { scConfigureDrawItem, scSetDrawColorAlpha } from '../src/renderer/sceneModel.js';
import type { BinInstruction, ScriptBinary } from '../src/script/bin.js';

const H = 0x3c;
const T_GLOBAL_INT = 0x3;
const T_IMM_INT = 0x0;

/** 造一条指令；args = [{type, raw}, …]（与 `test/ops-142-12f-306.test.ts` 同一套最小脚手架）。 */
function script(opcode: number, args: { type: number; raw: number }[]): ScriptBinary {
  const instr: BinInstruction = {
    opcode,
    name: `i${opcode.toString(16)}`,
    argc: args.length,
    args: args.map((a) => ({ type: a.type, raw: a.raw })),
    byteOffset: H,
    index: 0,
  };
  return {
    signature: 'SYS4450 ',
    isVer5: false,
    headerLen: H,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
    ],
    instructions: [instr],
    labelTargets: new Set<number>(),
    raw: new Uint8Array(H + 4 + 8 * args.length),
  };
}

/** 记录 native 调用的最小宿主。 */
function recorder(): { native: NativeBridge; calls: Map<string, unknown[][]> } {
  const calls = new Map<string, unknown[][]>();
  const note = (name: string) => (...a: unknown[]) => {
    const list = calls.get(name) ?? [];
    list.push(a);
    calls.set(name, list);
  };
  const native = {
    log: () => {},
    setScale: note('setScale'),
    setScaleAnim: note('setScaleAnim'),
  } as unknown as NativeBridge;
  return { native, calls };
}

const near = (a: number, e: number, msg: string) => assert.ok(Math.abs(a - e) < 1e-6, `${msg}: got ${a}, want ${e}`);

test('★0x1FD：op2/3/4 按 ÷100 换算（`dbl_5201F0 = 100.0`），并转发宿主', async () => {
  const { native, calls } = recorder();
  const e = new Engine(native);
  // 脚本原样：`i1fd <obj> 64 <h*64> 64`（CONFIG1.txt:2966；64 = 0x64 = 100）
  loadScriptIntoFrame(
    e.curScript(),
    script(0x1fd, [
      { type: T_GLOBAL_INT, raw: 0x100 },
      { type: T_IMM_INT, raw: 0x64 },
      { type: T_IMM_INT, raw: 20900 },
      { type: T_IMM_INT, raw: 0x64 },
    ]),
    'TEST.BIN',
  );
  e.globals.int.set(0x100, enc(e.key, 121911));
  const t = await stepOnce(e);
  assert.notEqual(t.handlerKind, 'unimplemented', '0x1FD 必须是已实现指令');
  assert.deepEqual(calls.get('setScale'), [[121911, 1, 209, 1]], '100→1.0、20900→209（÷100，不是 ÷256）');
});

test('★0x21E 订正：缩放窗同样按 ÷100（脚本的 64 就是 100%）', async () => {
  const { native, calls } = recorder();
  const e = new Engine(native);
  loadScriptIntoFrame(
    e.curScript(),
    script(0x21e, [
      { type: T_GLOBAL_INT, raw: 0x100 },
      { type: T_IMM_INT, raw: 0 },
      { type: T_IMM_INT, raw: 500 },
      { type: T_IMM_INT, raw: 0x64 },
      { type: T_IMM_INT, raw: 0x12c }, // 300 ⇒ 3.0
      { type: T_IMM_INT, raw: 0x64 },
    ]),
    'TEST.BIN',
  );
  e.globals.int.set(0x100, enc(e.key, 77));
  await stepOnce(e);
  assert.deepEqual(calls.get('setScaleAnim'), [[77, 0, 500, 1, 3, 1]], '0x64→1、0x12c→3（÷100）');
});

test('★0x1FD 立即生效：写 work + target + useWorld，无动画窗也立刻缩放', () => {
  const s = new HeadlessScene({});
  s.setScale(0x777, 1, 209, 1);
  const it = s.scene.drawItems.get(0x777);
  assert.ok(it, '0x1FD 走「缺失即建项」（引擎 sub_4AAA50）');
  assert.equal(it!.useWorld, true, '+0x68 = 1（用世界矩阵）');
  assert.deepEqual(it!.scaleWork, { x: 1, y: 209, z: 1 }, '+0x6C 缩放 work 矩阵');
  assert.deepEqual(it!.scaleTarget, { x: 1, y: 209, z: 1 }, '无窗求值读 target ⇒ 必须同步写，否则"立即"不成立');
  near(itemScale(it!, 0).y, 209, '求值结果 = 209（中段贴片被撑开）');
  assert.equal(it!.flags & 1, 0, '★建出来的空项 flags=0 ⇒ 仍不可绘制（bit0 只由 draw-texture 置）');
});

test('★pivot 与描画位置同坐标空间：Pixi 用 `pivot − pos`（绝对值直接用会把项挪走）', () => {
  const it = makeItem({ handle: 1, layer: 1, tex: 0, srcX: 0, srcY: 0, srcW: 27, srcH: 1, dstX: 1222, dstY: 129 });
  // 未设 pivot（构造默认 0,0）⇒ 相对量为 -pos（这类项必须靠 useWorld 门排除）
  assert.deepEqual(itemPivotLocal(it), { x: -1222, y: -129, z: 0 });
  // CONFIG1 实测：`i217 <obj> <dstX> <dstY> 0` ⇒ 相对量 (0,0) = 以左上角为基准拉伸
  it.pivotX = 1222;
  it.pivotY = 129;
  assert.deepEqual(itemPivotLocal(it), { x: 0, y: 0, z: 0 });
});

test('★世界矩阵门：只有变换类指令置 `+0x68`（useWorld）—— 上/下盖那种项不被挪动', () => {
  const base = (): Item => makeItem({ handle: 1, layer: 1, tex: 0, srcX: 0, srcY: 0, srcW: 27, srcH: 23, dstX: 1222, dstY: 106 });

  assert.equal(base().useWorld, false, 'draw-texture 建项：+0x68 未置');
  const a = base();
  applyDrawScale(a, 1, 209, 1);
  assert.equal(a.useWorld, true, '0x1FD → +0x68 = 1');
  const b = base();
  applyDrawTranslation(b, 1, 2, 0);
  assert.equal(b.useWorld, true, '0x1FF → +0x68 = 1');
  const c = base();
  applyScaleAnim(c, 0, 10, 2, 2, 1);
  assert.equal(c.useWorld, true, '0x21E → +0x68 = 1（raw 132009）');
  const d = base();
  applyRotationAnim(d, 0, 10, 0, 0, 1, 90);
  assert.equal(d.useWorld, true, '0x21F → +0x68 = 1（raw 132053）');
  const f = base();
  applyTranslationAnim(f, 0, 10, 1, 1, 0);
  assert.equal(f.useWorld, true, '0x220 → +0x68 = 1（raw 132106）');

  // 颜色（0x202/0x203）与 draw-texture 不置位：它们走纯 2D 路径
  const scene = new HeadlessScene({});
  scConfigureDrawItem(scene.scene, { handle: 3, layer: 3, tex: 0, srcX: 0, srcY: 0, srcW: 1, srcH: 1, dstX: 5, dstY: 6 });
  scSetDrawColorAlpha(scene.scene, 3, 0xffffffff, 0);
  const h = scene.scene.drawItems.get(3)!;
  assert.equal(h.useWorld, false, '0x202/0x203/0x1FB 都不置 useWorld');
});
