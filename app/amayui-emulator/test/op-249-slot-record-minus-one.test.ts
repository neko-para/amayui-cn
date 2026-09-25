/** @tier T0 @kind core @subsystem render */

/**
 * **`0x249` 的槽记录语义 = 写 −1（不是 imgid）** —— `T-0179` 第二波 E 的唯一 ① 实现。
 *
 * 引擎体：`0x249`（`sub_425310` raw 32716-32768）与 `0x1F9`（`sub_422CB0` raw 31191-31243）
 * **只差一个实参** —— `sub_4A3800(Scene, imgid, hFile, slot, color, a6)` 在 `0x249` raw **32757**
 * 传 **1**、在 `0x1F9` raw **31232** 传 **0**；callee（`sub_4A3800` raw 123369-123389）逐字：
 * ```c
 * if ( sub_49E9D0(_this, hFile, a4, a5, a6) )
 * {
 *   v7 = &_this[5 * a4];
 *   if ( a6 ) v7[466] = -1;      // ★0x249：槽记录 = −1（不是 imgid！）
 *   else      v7[466] = a2;      //   0x1F9：槽记录 = imgid
 *   v7[467] = a5;                //   颜色（装载期色键，另一条缺口）
 *   _this[5 * a4 + 470] = 0;     //   槽状态清 0（该格全库无读者）
 *   return 1;
 * }
 * ```
 *
 * 那一格的**读者**是 `0x216`（`sub_430380` raw 39891-39899 的 `Engine[5 * v2 + 81174]`；
 * `80708 + 466 = 81174` = Scene 基址 `Engine + 322832` 的 dword 视图）—— 它把这一格当
 * 「槽绑定的 imgid」用。`sub_499BC0`（raw 116333-116352）建 Scene 时把 1000 格的 imgid
 * **全写成 −1** ⇒ **−1 就是「该格没有 imgid」的正式值**（不是未初始化）。
 * ★同一个值也是 `0x216` 的**缺省值**：从未被任何绑定指令碰过的槽，引擎答 −1、emulator 原先答 0
 * ⇒ 3 处用例覆盖（本文件第 1 条钉「绑定之后」、第 3 条钉「`0x249`/`0x1F9` 两支」、第 4 条钉「缺省」）。
 *
 * ★**「槽记录」与「宿主的图像绑定」是两张不同的表**：记录写 −1 之后图像**仍在该槽上**
 * （表面表 `Scene + 4*slot + 42456` 是另一张，`0x208`/`0x1FB` 读那张）⇒ 本条的修法**只**动
 * `Engine.texSlots` 这一格，`native.bindTexture(imgid, slot)` 照旧把 imgid 交给宿主。
 * 这也是它能**纯 VM 侧**修掉的原因：`bindTexture` 不需要多一位「记录策略」
 * （`tickets/T-0153/changes-texvm.md` §4 的 C2 曾按此申请跨半边签名变更）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Frame, Engine } from '../src/vm/engine.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS, NATIVE_OPS } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/native.js';
import { dec } from '../src/vm/bits.js';
import type { BinArg, BinInstruction } from '../src/script/bin.js';
import { im, instr, loc } from './harness.js';

/** 录制型宿主：`bindTexture` 与颜色缝收到的实参逐条记下来（`StubNative` 只打日志）。 */
class RecordingTexture extends StubNative {
  readonly bind: [number, number][] = [];
  readonly color: [number, number][] = [];

  constructor() {
    super(() => {});
  }

  override bindTexture(imgid: number, slot: number): void {
    this.bind.push([imgid, slot]);
  }

  /** ★不加 `override`：颜色缝是 `NativeBridge` 的**可选**缝，`StubNative` 刻意不实现它。 */
  setTextureObjectColor(slot: number, argb: number): void {
    this.color.push([slot, argb]);
  }
}

/** 驱动一条指令（`0x1F9` 在 `NATIVE_OPS`、`0x216` 在 `OPS`、`0x249` 在 `NATIVE_OPS`）。 */
function runTextureOp(e: Engine, f: Frame, native: StubNative) {
  return (op: number, args: BinArg[] = []): void => {
    const h = OPS.get(op) ?? NATIVE_OPS.get(op);
    assert.ok(h, `opcode 0x${op.toString(16)} 未注册`);
    h!(makeCtx(e, f, instr(op, args) as unknown as BinInstruction, native, () => {}));
  };
}

/** 读一个**本地 int 槽**（type 0x9 才可写；`dec` 去混淆，`| 0` 让引擎的 −1 就是 −1）。 */
function readLocal(e: Engine, f: Frame, slot: number): number {
  return dec(e.key, f.locals.int.get(slot) ?? 0) | 0;
}

const IMGID = 0x5158;

test('★0x249：槽记录写 −1（`sub_4A3800` 的 a6 = 1 那一支，raw 123377 / 32757）；0x1F9 才写 imgid', () => {
  const native = new RecordingTexture();
  const e = new Engine(native);
  const f = new Frame();
  const step = runTextureOp(e, f, native);

  step(0x249, [im(IMGID), im(0x52), im(0)]);
  assert.equal(
    e.texSlots.get(0x52),
    -1,
    '★引擎 `sub_4A3800` raw 123377：`if ( a6 ) v7[466] = -1;` —— 0x249 raw 32757 传的正是 a6 = 1' +
      '（0x1F9 raw 31232 传 0）⇒ 该槽的 imgid 记录被写成 −1，不是 imgid',
  );

  step(0x1f9, [im(IMGID), im(0x53)]);
  assert.equal(e.texSlots.get(0x53), IMGID, '前提：0x1F9 走 `else` 支 ⇒ 记录 = imgid（raw 123379）');
});

test('★0x249：记录写 −1 **不**影响宿主绑定 —— 图像仍在该槽上（表面表是另一张）', () => {
  const native = new RecordingTexture();
  const e = new Engine(native);
  const f = new Frame();
  const step = runTextureOp(e, f, native);

  step(0x249, [im(IMGID), im(0x52), im(0)]);
  assert.deepEqual(
    native.bind,
    [[IMGID, 0x52]],
    '★记录格与「槽上的图像」是两张表：`bindTexture` 必须照旧收到 imgid（否则该槽画不出东西）',
  );
  assert.equal(e.texSlots.get(0x52), -1, '记录格 −1 与宿主绑定并存');
});

test('★0x249 → 0x216：读到的 imgid 是 −1；0x1F9 → 0x216：读到 imgid（读者 raw 39891-39899）', () => {
  const native = new RecordingTexture();
  const e = new Engine(native);
  const f = new Frame();
  const step = runTextureOp(e, f, native);
  const out = 0x10;

  step(0x249, [im(IMGID), im(0x52), im(0)]);
  step(0x216, [loc(out), im(0x52)]);
  assert.equal(
    readLocal(e, f, out),
    -1,
    '★`0x216`（`Engine[5 * v2 + 81174]`）读的就是这一格 ⇒ 0x249 之后它答 −1（引擎同码，' +
      '`sub_499BC0` raw 116345-116352 把 1000 格的 imgid 初始化成 −1 也是同一个值）',
  );

  step(0x1f9, [im(IMGID), im(0x53)]);
  step(0x216, [loc(out), im(0x53)]);
  assert.equal(readLocal(e, f, out), IMGID, '0x1F9 之后 `0x216` 答 imgid（同一格、另一支）');
});

test('★0x216 的缺省值 = −1：从未绑定的槽答 −1（`sub_499BC0` raw 116348 的 1000 格初始化）', () => {
  const native = new RecordingTexture();
  const e = new Engine(native);
  const f = new Frame();
  const step = runTextureOp(e, f, native);
  const out = 0x11;

  assert.equal(e.texSlots.get(0x60), undefined, '前提：该槽从未被任何一条绑定指令碰过');
  step(0x216, [loc(out), im(0x60)]);
  assert.equal(
    readLocal(e, f, out),
    -1,
    '★引擎 `sub_499BC0`（raw 116333-116352）把 1000 格 imgid 逐格写成 −1（raw 116348）' +
      '并把同一份表 `memcpy` 到 `_this + 5466`（raw 116353）⇒ 未绑定槽的正式值是 −1；' +
      '`0x1FA`（raw 119594）/`0x249`（raw 123377）/`0x1F8`（raw 122847）也都往这一格写 −1',
  );

  step(0x1f9, [im(IMGID), im(0x60)]);
  step(0x216, [loc(out), im(0x60)]);
  assert.equal(readLocal(e, f, out), IMGID, '绑定之后同一格答 imgid（`0x1F9` 写、`0x216` 读）');
});

test('★0x249 与 0x1F9 的唯一差别是 `sub_4A3800` 的第 6 参：颜色一格两支都写（raw 123380）', () => {
  const native = new RecordingTexture();
  const e = new Engine(native);
  const f = new Frame();
  const step = runTextureOp(e, f, native);

  step(0x249, [im(IMGID), im(0x52), im(0x00ff00)]);
  step(0x1f9, [im(IMGID), im(0x53), im(0x00ff00)]);
  assert.deepEqual(
    native.color,
    [
      [0x52, 0xff00ff00 | 0],
      [0x53, 0xff00ff00 | 0],
    ],
    '★`v7[467] = a5;`（raw 123380）不在 a6 的分支里 ⇒ 两支的颜色载荷逐字相同（拆缝后的颜色缝）',
  );
});
