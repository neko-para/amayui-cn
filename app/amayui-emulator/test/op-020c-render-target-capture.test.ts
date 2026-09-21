/**
 * `0x20C` 帧刷新里的**渲染目标捕获** —— 存档缩略图那条链的捕获端（`tickets/T-0062`）。
 *
 * ## 这条链在引擎里是什么
 * 脚本（`src/$1$SC0330.txt:17584-17596` 的 `label_0003e24c`）：
 * `create-texture 2 500 2d0 2` → `i20d 2`（设渲染目标）→ `i20e`（清该 surface）→ **`i20c`（帧刷新）**
 * → `i20d -1`（切回）→ `create-texture e 140 b4 2` → `i032 2 e …`（缩放转送）→ `i1ae … e`（写 `.STH`）。
 * 引擎里 `i20d` 把渲染目标切到那个槽的 surface，`i20c`（`sub_4B4040`）就把**这一帧的场景**画进去。
 *
 * ## 本票修掉的两个错（都被下面的断言钉住）
 * ① **不捕获**：emulator 只把 `renderTargetSlot` 记进 `render4`（供混合门控用），从不把场景画进那个槽
 *    ⇒ `i032` 转送的是空画布 ⇒ `.STH` 全黑。
 * ② **捕获取错矩形**（第 2 次变更）：`extract.canvas` 默认按 target 的 **local bounds** 出图，而
 *    `stage`/`drawRoot` 的子节点可能落在视口之外 ⇒ 画布比屏幕大、内容整体错位，再被 `i032` 缩进
 *    320×180 就是"素材拼贴 + 各处缩放不一致"。必须显式给**屏幕矩形** + `resolution: 1`。
 *
 * ## 时序陷阱（为什么不能在 present 里补）
 * 外层渲染循环的 present 落在整批指令**之后**，那时脚本已经 `i20d -1` 切回去了 ⇒ 捕获只能在
 * `0x20C` 当场做。第 2 个测试（headless 侧）钉的就是这一条：`0x20C` 那一刻
 * `render4.renderTargetSlot` 必须**还是**脚本设的那个槽。
 *
 * 像素级内容（`.STH` 解出的 BMP 不是全黑、与当时画面一致）是 E4 目视判据，Node 里没有画布 ⇒
 * 这里只钉"什么时候捕、捕哪块矩形、往哪个槽写、失败不打断 VM"这四条可自动核对的骨架。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { PixiBackend } from '../src/renderer/pixiBackend.js';
import type { NativeBridge } from '../src/vm/native.js';
import type { BinInstruction, ScriptBinary } from '../src/script/bin.js';
import { im, instr } from './harness.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

interface Capture {
  slot: number;
  w: number;
  h: number;
}

/**
 * 造一个**半装配的 `PixiBackend`**：真实实例（`textures` 由构造器建好、`#markDirty` 是真的），
 * 只把三条与"合成"有关的东西换成假件 —— `app.screen`/`app.renderer.extract.canvas`/`present()`。
 *
 * 为什么可以这样：`create()` 需要 WebGL 上下文（Node 里没有），而本测试要核对的恰好是
 * `frameTick` 里**除合成本身之外**的那段接线（矩形、槽号、异常处理）。
 */
function mkBackend(screen: { width: number; height: number }, canvasOf?: (opts: Any) => Any) {
  const status = { scriptName: '', ip: 0, steps: 0, log: [] as string[], trace: [] as string[] };
  const b: Any = new (PixiBackend as unknown as new (s: unknown) => Any)(status);
  const extractCalls: Any[] = [];
  b.app = {
    screen,
    renderer: {
      extract: {
        canvas: (opts: Any) => {
          extractCalls.push(opts);
          return canvasOf ? canvasOf(opts) : { width: opts.frame.width, height: opts.frame.height };
        },
      },
    },
  };
  b.stage = { name: 'stage' };
  let presents = 0;
  b.present = () => {
    presents++;
  };
  const captures: Capture[] = [];
  b.textures = {
    captureCanvasIntoSlot: (slot: number, _src: unknown, w: number, h: number) => {
      captures.push({ slot, w, h });
      return true;
    },
  };
  return { b, status, extractCalls, captures, presents: () => presents };
}

test('★0x20C：renderTargetSlot ≥ 0 ⇒ 当场合成一次、按**屏幕矩形**捕获进该槽（T-0062 的两处修正）', () => {
  const { b, extractCalls, captures, presents } = mkBackend({ width: 1280, height: 720 });
  b.scene.render4.renderTargetSlot = 2; // 脚本的 `i20d 2`

  b.frameTick();

  assert.equal(presents(), 1, '★必须先合成一次（渲染循环那次 present 在整批指令之后，来不及）');
  assert.equal(extractCalls.length, 1, '恰好抓一次帧');
  const opts = extractCalls[0];
  assert.equal(opts.target, b.stage, '抓的是整张舞台（不是某个子节点）');
  assert.deepEqual(
    { x: opts.frame.x, y: opts.frame.y, w: opts.frame.width, h: opts.frame.height },
    { x: 0, y: 0, w: 1280, h: 720 },
    '★必须是**屏幕矩形** —— 默认的 local bounds 会把屏外子节点也算进来（缩略图"素材拼贴"的根因）',
  );
  assert.equal(opts.resolution, 1, '逻辑尺寸整帧；槽画布自己按 DPR 承担缩放');
  assert.deepEqual(captures, [{ slot: 2, w: 1280, h: 720 }], '★写进脚本设的那个槽（op1=2）');
});

test('0x20C：renderTargetSlot < 0（未设渲染目标）⇒ 不合成、不抓帧、不写槽', () => {
  const { b, extractCalls, captures, presents } = mkBackend({ width: 1280, height: 720 });
  assert.equal(b.scene.render4.renderTargetSlot, -1, '默认就是"没设渲染目标"');

  b.frameTick();

  assert.equal(extractCalls.length, 0);
  assert.equal(captures.length, 0, '没设渲染目标 ⇒ 引擎那条链也不会往任何槽写');
  assert.equal(presents(), 0, '常规帧的合成由渲染循环负责，不在 0x20C 里多合成一次');
});

test('0x20C：合成抛异常 ⇒ 只记日志、不打断 VM（宿主能力缺失时行为与以前一致）', () => {
  const { b, status } = mkBackend({ width: 1280, height: 720 }, () => {
    throw new Error('webgl lost');
  });
  b.scene.render4.renderTargetSlot = 2;

  assert.doesNotThrow(() => b.frameTick(), '★捕获失败不得把异常抛回指令派发');
  assert.ok(
    status.trace.some((l: string) => l.includes('[render-target]') && l.includes('webgl lost')),
    `失败必须留一条日志（实得：${JSON.stringify(status.trace)}）`,
  );
});

test('0x20C：宿主忽略 frame、画布宽高比与屏幕不符 ⇒ 记一条日志（防静默回到"拼贴"）', () => {
  const { b, status, captures } = mkBackend({ width: 1280, height: 720 }, () => ({ width: 2048, height: 2048 }));
  b.scene.render4.renderTargetSlot = 2;

  b.frameTick();

  assert.ok(
    status.trace.some((l: string) => l.includes('宽高比不符')),
    `宽高比不符必须留痕（实得：${JSON.stringify(status.trace)}）`,
  );
  assert.deepEqual(captures.map((c) => c.slot), [2], '仍然写槽 —— 有日志可查，但不放弃这一帧');
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
    signature: 'SYS4450 ',
    isVer5: false,
    headerLen: 0x3c,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [
      { length: 0, offset: 0 },
      { length: 1, offset: 0 },
      { length: 1, offset: 0 },
    ],
    instructions,
    labelTargets: new Set(),
    dwordToInstr,
    raw: new Uint8Array(0),
  };
}

test('★时序陷阱：0x20C 那一刻 renderTargetSlot 必须**还是**脚本设的槽（不能等渲染循环的 present）', async () => {
  const native = new HeadlessScene();
  // 在宿主最外层观测"引擎调 frameTick 时场景是什么样"——正是捕获端要读的那一刻
  const slotAtFrameTick: number[] = [];
  const orig = native.frameTick.bind(native);
  native.frameTick = (): void => {
    slotAtFrameTick.push(native.scene.render4.renderTargetSlot);
    orig();
  };

  const e = new Engine(native as unknown as NativeBridge, new InputManager());
  loadScriptIntoFrame(
    e.curScript(),
    mkScript([
      // 与语料同形的四步：建表面 → 设渲染目标 → 清该表面 → 帧刷新（捕获点）
      instr(0x1f8, [im(2), im(0x500), im(0x2d0), im(2)]), // create-texture 2 500 2d0 2
      instr(0x20d, [im(2)]), // i20d 2
      instr(0x20e, []), // i20e
      instr(0x20c, []), // i20c ← 捕获必须发生在这里
      instr(0x20d, [im(-1)]), // i20d -1（切回；此后就是渲染循环的 present 了）
    ]),
    'FAKE.BIN',
  );

  for (let i = 0; i < 5; i++) await stepOnce(e); // 恰好 5 条指令（跑第 6 步就越界了）

  assert.deepEqual(
    slotAtFrameTick,
    [2],
    '★0x20C 当场必须看见 renderTargetSlot=2；若捕获挪到 present（那时已 i20d -1）就永远是空画布',
  );
  assert.equal(native.scene.render4.renderTargetSlot, -1, '脚本随后切回了后台缓冲（这正是"必须在 0x20C 捕获"的理由）');
});
