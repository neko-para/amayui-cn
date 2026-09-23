/** @tier T0 @kind core @subsystem texture */

/**
 * `i032`（`0x32`）—— **槽 → 槽的缩放转送**（引擎名 **StretchTexture**；`tickets/T-0050`）。
 *
 * 引擎：`sub_41E2D0`（raw 27955-28008）读 10 个操作数（op1=源槽、op2=目标槽、op3..6=源矩形 x/y/w/h、
 * op7..10=目标矩形），化开成两个 `[x1,y1,x2,y2]`，按 `set:DrawMode`（`Engine[166964]`）分两条路；
 * D3D 那条 = `sub_4A87A0`（raw 127933-128129）：**两个矩形各自按所在 surface 的边界夹取、
 * 一侧被夹时另一侧按比例跟随**，再缩放转送（`sub_4A7990` + `sub_4A42C0`，raw 128125-128127）。
 * 源/目标 surface 不存在 ⇒ 打「コピー元/コピー先テクスチャが作成されていません． TEXTURE=%d」。
 *
 * ★语料 337 处，形态完全一致：`i032 2 e 0 0 500 2d0 0 0 140 b4`（全屏槽 2 → 320×180 的槽 0xe）——
 * 上下文是 `create-texture 2 1280×720` → `i20d 2`（渲染目标）→ `i20e` → 还原 → `create-texture e 320×180`
 * → **本指令** → `i1ae … e`（写 `.STH`）⇒ **存档缩略图的"缩屏"这一步**（`src/SC5450.txt:3009-3021` 等）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { loadScriptIntoFrame, OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { clampScaledBlit } from '../src/renderer/scene/ops.js';
import type { NativeBridge } from '../src/vm/native.js';
import type { BinInstruction, ScriptBinary } from '../src/script/bin.js';
import { im, instr, scriptDerived } from './harness.js';

type R4 = [number, number, number, number];

test('★0x32 的矩形夹取（引擎 sub_4A87A0 raw 128005-128097）：不越界时原样；越界时两侧按比例跟随', () => {
  const bounds: R4 = [0, 0, 1280, 720];
  const small: R4 = [0, 0, 320, 180];

  // ① 真实语料形态：全屏 → 320×180，两侧都刚好落在 surface 内 ⇒ 不动
  assert.deepEqual(clampScaledBlit(bounds, small, [0, 0, 1280, 720], [0, 0, 320, 180]), {
    src: [0, 0, 1280, 720],
    dst: [0, 0, 320, 180],
  });

  // ② 目标矩形越出目标 surface 左边 ⇒ 目标被夹到 0，源码按比例（1280/320 = 4）右移
  assert.deepEqual(clampScaledBlit(bounds, small, [0, 0, 1280, 720], [-40, 0, 280, 180]), {
    src: [160, 0, 1280, 720],
    dst: [0, 0, 280, 180],
  });

  // ③ 目标矩形越出右下 ⇒ 目标被夹到 (320,180)，源码按比例左/上移
  //   （位移量按引擎的 `(int)` 截断：x 方向 kx = 1280/360 ⇒ 320−400 = −80 ⇒ −284.44 → −284）
  assert.deepEqual(clampScaledBlit(bounds, small, [0, 0, 1280, 720], [40, 20, 400, 220]), {
    src: [0, 0, 996, 576],
    dst: [40, 20, 320, 180],
  });

  // ④ 源码越出源 surface（目标不动、源码被夹）—— 目标是"目标 surface 边界按比例跟随时"的反向
  assert.deepEqual(clampScaledBlit(bounds, small, [-128, 0, 1152, 720], [-32, 0, 288, 180]), {
    src: [0, 0, 1152, 720],
    dst: [0, 0, 288, 180],
  });

  // ⑤ 退化输入（引擎会除零得 inf/nan）⇒ 显式判掉
  assert.equal(clampScaledBlit(bounds, small, [0, 0, 0, 720], [0, 0, 320, 180]), null);
  assert.equal(clampScaledBlit(bounds, small, [0, 0, 1280, 720], [0, 0, 0, 180]), null);
});

/** 最小脚本映像（`index` 按 dword 步长排）。 */
function mkScript(instructions: BinInstruction[]): ScriptBinary {
  let d = 0;
  for (const ins of instructions) {
    (ins as { index: number }).index = d;
    d += 1 + 2 * ins.argc;
  }
  const dwordToInstr: number[] = [];
  for (let i = 0; i < instructions.length; i++) {
    const n = 1 + 2 * instructions[i]!.argc;
    for (let k = 0; k < n; k++) dwordToInstr[instructions[i]!.index + k] = i;
  }
  return {
    ...scriptDerived(),
    signature: 'SYS4450 ',
    isVer5: false,
    headerLen: 0x3c,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [
      { length: 0, offset: 0 },
      { length: 0, offset: 0 },
      { length: 0, offset: 0 },
    ],
    instructions,
    labelTargets: new Set(),
    dwordToInstr,
    raw: new Uint8Array(0),
  };
}

test('★0x32 端到端：真实语料那条 i032 被识别为"槽2 → 槽0xe 的 (0,0,1280,720)→(0,0,320,180) 转送"（真实现）', async () => {
  const native = new HeadlessScene();
  const e = new Engine(native as unknown as NativeBridge, new InputManager());
  loadScriptIntoFrame(
    e.curScript(),
    mkScript([
      // 与语料逐字一致：i032 2 e 0 0 500 2d0 0 0 140 b4
      instr(0x32, [im(2), im(0xe), im(0), im(0), im(0x500), im(0x2d0), im(0), im(0), im(0x140), im(0xb4)]),
    ]),
    'FAKE.BIN',
  );
  assert.ok(OPS.has(0x32), '0x32 必须在已实现表里（此前不在任何表 ⇒ 命中即 NotImplementedOp 硬报错）');
  assert.ok(!ENGINE_INTERNAL_OPS.has(0x32), '★不得是 engine-internal 的 no-op 桩');

  const t = await stepOnce(e);
  assert.equal(t.handlerKind, 'implemented', '★0x32 走真实现');
  assert.deepEqual(native.scene.render4.blits, [
    { srcSlot: 2, dstSlot: 14, srcRect: [0, 0, 1280, 720], dstRect: [0, 0, 320, 180] },
  ]);
  assert.equal(native.scene.dirty, true, '转送 ⇒ 标脏（present 要重画）');
});
