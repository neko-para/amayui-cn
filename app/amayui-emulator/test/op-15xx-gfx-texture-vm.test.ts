/** @tier T0 @kind core @subsystem texture */

/**
 * **`T-0153` 的 VM 半边（纹理槽与表面）—— `src/vm/handlers/gfx-texture.ts` 的守卫**。
 *
 * 本票被拆成两半：`src/renderer/**` + `src/arch/**` 那 7 条由另一位 owner 交付
 * （`tickets/T-0153/changes-renderer.md`），本文件只钉**落在 VM handler 上的那几条**
 * （审计工作清单 `app/amayui-emulator/.tmp/p1-fix/p23-worklist2.md` §T-0153 里锚点在本文件范围的行）。
 *
 * 权威 = 引擎函数体（`engine/天结_unpacked.exe_utf8.c`，行号 = raw）。每条断言的依据都写在
 * 断言消息或上方注释里 —— 凡"引擎没有/不存在"都给出搜过的范围。
 *
 * ★两条最容易改错的常量（主 agent 已核实，**不许合并**）：
 *  - `dbl_51FB50 = 1000.0`（raw 4393）→ `0x245` 族：写端 raw 32673、读端（`0x23E`/`0x23F`）raw 40013/40028；
 *  - `dbl_5201F0 = 100.0`（raw 4430）→ `0x246` 族：raw 32696-32697。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StubNative } from '../src/vm/native.js';
import { Engine, Frame } from '../src/vm/engine.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS, NATIVE_OPS } from '../src/vm/ops.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { dec } from '../src/vm/bits.js';
import type { BinArg, BinInstruction } from '../src/script/bin.js';
import { im, instr, loc } from './harness.js';

/**
 * **录制型纹理宿主**：把 `0x23F`/`0x245`/`0x246` 真正下发的东西逐条记下来。
 *
 * 为什么必须自己录：这三条都是"读操作数 → 交给宿主缝"，断言只能落在**宿主收到什么**上；
 * `StubNative` 只打日志，拿不到结构化实参。
 * `slotNodeSize` 的默认值 `undefined` = "本宿主没有这张对象表"（`native.ts` 的可选缝语义）。
 */
class RecordingTexture extends StubNative {
  readonly float: [number, number][] = [];
  readonly param: [number, number][] = [];
  readonly bind: [number, number][] = [];
  nodeSize: ((slot: number) => { present: boolean; w: number; h: number } | undefined) | undefined;

  constructor() {
    super(() => {});
  }

  /** ★不加 `override`：`setTextureObjectFloat` / `setTextureObjectParam` 是 `NativeBridge` 的**可选**缝，
   * `StubNative` 刻意不实现它们（"宿主没实现该缝"这一态本身要能被测到）。 */
  setTextureObjectFloat(slot: number, value: number): void {
    this.float.push([slot, value]);
  }

  setTextureObjectParam(slot: number, value: number): void {
    this.param.push([slot, value]);
  }

  override bindTexture(imgid: number, slot: number): void {
    this.bind.push([imgid, slot]);
  }

  /**
   * ★**不加 `override`**：`slotNodeSize` 是 `NativeBridge` 的**可选**缝，`StubNative` 刻意不实现它
   *（"宿主没有这张对象表"这一态本身要能被测到 —— 见本文件最后一条 `0x23F` 守卫）。
   */
  slotNodeSize(slot: number): { present: boolean; w: number; h: number } | undefined {
    return this.nodeSize?.(slot);
  }
}

/** 驱动一条指令（`0x1F8`/`0x23F` 在 `OPS`，`0x1F9`/`0x1FA`/`0x245`/`0x246`/`0x249` 在 `NATIVE_OPS`）。 */
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

/** "槽对象已有尺寸"的假对象表：`0x23F` 的两条分支都用它驱动。 */
function nodeTable(sizes: Map<number, { w: number; h: number }>) {
  return (slot: number): { present: boolean; w: number; h: number } => {
    const s = sizes.get(slot);
    if (!s) return { present: false, w: 0, h: 0 };
    return { present: true, w: s.w, h: s.h };
  };
}

// ---------------------------------------------------------------------------
// ① `0x1F8` create-texture 的**槽记录**（`Scene + 5*slot + 466`）
// ---------------------------------------------------------------------------

test('★0x1F8：create-texture 把该槽的 imgid 记录擦成 −1（`Scene[5*slot+466]`，不是留着旧 imgid）', () => {
  const native = new RecordingTexture();
  const e = new Engine(native);
  const f = new Frame();
  const step = runTextureOp(e, f, native);

  // 前提：该槽正绑着一张图（`0x1F9` 写记录 = op1）
  step(0x1f9, [im(0x5250), im(42)]);
  assert.equal(e.texSlots.get(42), 0x5250, '前提：`0x1F9` 已把记录写成 imgid');

  step(0x1f8, [im(42), im(0x78), im(0x78), im(0)]);

  assert.equal(
    e.texSlots.get(42),
    -1,
    '★引擎 `sub_4A2C10` raw 122847：`*(_DWORD *)(_this + 20 * a2 + 1864) = -1`（`Scene[5*slot+466]`）' +
      ' —— 建新表面时该槽的 imgid 记录被擦掉；留着旧 imgid 会让 `0x215` 反查出已不存在的绑定',
  );
});

test('★0x1F8：create-texture 擦完记录之后 `0x23F` 不算"有对象"（引擎先析构 `Engine[slot+94672]`，raw 31173-31183）', () => {
  const native = new RecordingTexture();
  const sizes = new Map<number, { w: number; h: number }>([[42, { w: 120, h: 120 }]]);
  native.nodeSize = nodeTable(sizes);
  const e = new Engine(native);
  const f = new Frame();
  const step = runTextureOp(e, f, native);

  const out = 0x10;
  step(0x23f, [loc(out), im(42)]);
  assert.equal(readLocal(e, f, out), 120000, '前提：对象在 ⇒ `create-texture` 那一份尺寸仍可查（FIELD.txt:13718-13721 的 120×120）');

  // `0x1F8` 在 VM 侧不撤宿主的对象表（`slotNodeSize` 归宿主；见下方"耦合"注释），
  // 但它擦记录这一半必须成立 —— 这里钉的是"记录被擦"与"对象表仍可查"并存，两者是**两张表**。
  step(0x1f8, [im(42), im(0x78), im(0x78), im(0)]);
  assert.equal(e.texSlots.get(42), -1, '槽记录被擦（raw 122847）');
  step(0x23f, [loc(out), im(42)]);
  assert.equal(readLocal(e, f, out), 120000, '★对象表是另一张表（`Engine+4*slot+378688`）⇒ 不受槽记录影响');
});

// ---------------------------------------------------------------------------
// ② `0x1FA` release-texture：外层门 + 记录写 −1
// ---------------------------------------------------------------------------

test("★0x1FA：外层门 `if (!_this[a2+11676])` 不成立 ⇒ 记录与表面都不动（raw 119591-119601）", () => {
  const native = new RecordingTexture();
  const e = new Engine(native);
  const f = new Frame();
  const step = runTextureOp(e, f, native);

  step(0x1f9, [im(0x5250), im(13)]);
  assert.equal(e.texSlots.get(13), 0x5250, '前提：槽 13 已绑定');

  // 门开（默认 0）⇒ 清理发生
  step(0x1fa, [im(13)]);
  assert.equal(e.texSlots.get(13), -1, '门开 ⇒ `_this[5*a2+466] = -1`（raw 119594）');

  // 门关（`_this[a2 + 11676]` 非 0）⇒ 整个清理块被跳过，记录保持原样
  e.engineValues.set(ENGINE_FIELD.surfaceReleaseGate + 7, 1);
  step(0x1f9, [im(0x6111), im(7)]);
  step(0x1fa, [im(7)]);
  assert.equal(
    e.texSlots.get(7),
    0x6111,
    '★门关时引擎**不写** `−1`（raw 119591 的 `if (!_this[a2 + 11676])` 把记录与表面销毁两件事一起罩住）',
  );
});

test('★0x1FA：记录槽位是「槽号 + 11676」= ENGINE_FIELD.surfaceReleaseGate（字节 46704）', () => {
  assert.equal(
    ENGINE_FIELD.surfaceReleaseGate,
    11676,
    'raw 119591 的下标就是 11676（`_this[a2 + 11676]`，按槽号索引的那张 1000 槽门表）',
  );
  assert.equal(ENGINE_FIELD.surfaceReleaseGate * 4, 46704, '字节偏移 46704；`engineValues` 的键恒为 dword 下标');
});

// ---------------------------------------------------------------------------
// ③ `0x23F`：取值来源 = 对象表，不是 0x1F8 记的表面尺寸
// ---------------------------------------------------------------------------

test('★0x23F：没有对象 ⇒ −1（即使该槽刚 create-texture 过，raw 40025-40027）', () => {
  const native = new RecordingTexture();
  native.nodeSize = nodeTable(new Map()); // 对象表里什么都没有（0x236 未注册 ⇒ 由它建的对象永不出现）
  const e = new Engine(native);
  const f = new Frame();
  const step = runTextureOp(e, f, native);
  const out = 0x10;

  step(0x1f8, [im(42), im(0x78), im(0x78), im(0)]); // 建面：`Engine.texSizes` 记下 120×120
  step(0x23f, [loc(out), im(42)]);
  assert.equal(
    readLocal(e, f, out),
    -1,
    '★`v2 = _this[op2 + 94672]; if (!v2) return sub_42B4B0(_this, 1, -1);`（raw 40025-40027）' +
      ' —— 槽记录/表面尺寸**不能**顶替对象表',
  );
});

test('★0x23F：有对象 ⇒ `(int)(尺寸 × 1000)`（`dbl_51FB50` = 1000.0，raw 4393 / 40028-40029）', () => {
  const native = new RecordingTexture();
  const sizes = new Map<number, { w: number; h: number }>([[42, { w: 120, h: 120 }]]);
  native.nodeSize = nodeTable(sizes);
  const e = new Engine(native);
  const f = new Frame();
  const step = runTextureOp(e, f, native);
  const out = 0x10;

  // 不先 create-texture：尺寸**只**来自对象表（证明取值来源不是 `Engine.texSizes`）
  step(0x23f, [loc(out), im(42)]);
  assert.equal(readLocal(e, f, out), 120000, '★`v3 = sub_4080B0(v2) * dbl_51FB50`（raw 40028）；120 × 1000');

  // 有对象但尺寸不可得 ⇒ 0（`sub_4080B0` 未分派类型返回 `0.0`，raw 12967/12979）—— **不是** −1
  sizes.set(9, { w: 0, h: 0 });
  step(0x23f, [loc(out), im(9)]);
  assert.equal(readLocal(e, f, out), 0, '有对象 + 尺寸 0 ⇒ 0（raw 40028-40029 的 `(int)(0.0 * 1000.0)`）');
});

test('★0x23F：宿主没给对象表（缝缺）⇒ 按"没有对象"答 −1，不静默答 0', () => {
  const native = new RecordingTexture(); // `slotNodeSize` 返回 undefined = 本宿主没这张表
  const e = new Engine(native);
  const f = new Frame();
  const step = runTextureOp(e, f, native);
  const out = 0x10;

  step(0x1f8, [im(42), im(0x78), im(0x78), im(0)]);
  step(0x23f, [loc(out), im(42)]);
  assert.equal(
    readLocal(e, f, out),
    -1,
    '宿主不回答对象表 ⇒ 等价于"没有对象"（−1）；答 0 会被脚本读成"有对象、尺寸 0"（与引擎不同的分支）',
  );
});

// ---------------------------------------------------------------------------
// ④ 两个单位换算常量（**不许合并**）
// ---------------------------------------------------------------------------

test('★0x245：下发给宿主的是 `op2 / 1000`（`dbl_51FB50` = 1000.0，raw 4393 / 32673）', () => {
  const native = new RecordingTexture();
  const e = new Engine(native);
  const f = new Frame();
  const step = runTextureOp(e, f, native);

  step(0x245, [im(196), im(500)]);
  assert.deepEqual(
    native.float,
    [[196, 0.5]],
    '★`return sub_4081B0(_this[v3 + 94672], (double)v4 / dbl_51FB50);`（raw 32672-32673）⇒ 500/1000 = 0.5；' +
      '原值直传 = 单位差 1000 倍',
  );
});

test('★0x246：下发给宿主的是 `op2 / 100`（`dbl_5201F0` = 100.0，raw 4430 / 32696-32697）', () => {
  const native = new RecordingTexture();
  const e = new Engine(native);
  const f = new Frame();
  const step = runTextureOp(e, f, native);

  step(0x246, [im(196), im(250)]);
  assert.deepEqual(
    native.param,
    [[196, 2.5]],
    '★`(double)result / dbl_5201F0`（raw 32696-32697）⇒ 250/100 = 2.5；' +
      '★它与 `0x245` 的 ÷1000 **不是同一个常量**（raw 4393 vs 4430），不许合并',
  );
});

test('★两个缩放常量各自独立：同一个 op2 在 0x245/0x246 上得到不同的宿主值', () => {
  const native = new RecordingTexture();
  const e = new Engine(native);
  const f = new Frame();
  const step = runTextureOp(e, f, native);

  step(0x245, [im(7), im(1000)]);
  step(0x246, [im(7), im(1000)]);
  assert.deepEqual(native.float, [[7, 1]], '÷1000 ⇒ 1');
  assert.deepEqual(native.param, [[7, 10]], '÷100 ⇒ 10（若两族被合并成同一个常量，这里必红）');
});
