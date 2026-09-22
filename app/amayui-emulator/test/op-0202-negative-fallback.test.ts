/**
 * ★★`tickets/T-0102` 轮 21：**`0x202 set-draw-color` 的"负值 ⇒ 取当前色"回退**
 * （ADV 窗口白底的**真正根因**）。
 *
 * ## 症状 → 根因（都可复算）
 *
 * 真机 ADV 窗口是**半透明黑**，模拟器是**平的纯白**（截图见
 * `tickets/T-0102/evidence/e4-sc0000-g0001-paper-window.png`）。
 *
 * 窗口例程每帧发这一组（`src/SC0000.txt:32680-32685` / `src/SN0000.txt:3094-3098` 同型）：
 * ```
 * draw-texture 19640 11 0 0 43e 95 5d 22c            ; 窗（SO001 的框，93% 不透明纯白）
 * set-draw-color-alpha 19640 0 (global f807d) (global a9db)   ; 工作色 = α=f807d、RGB=a9db=0 ⇒ 半透明黑
 * …
 * set-draw-color 19640 0 800 -1 -1                   ; ★"淡入到**当前色**"
 * ```
 * 引擎 `sub_4231F0`（raw 31381-31416）逐字：
 * ```
 * if (α <= 255) { if (α < 0) α = (unsigned)sub_4ADD60(Scene, handle) >> 24; } else α = 255;
 * if (color < 0) color = sub_4ADD60(Scene, handle);          // 当前色（整份 ARGB）
 * ```
 * ⇒ `-1/-1` = "动画到当前色" = 刚设好的**半透明黑** ⇒ 窗口淡入成**黑**（真机）。
 * 模拟器此前直接把操作数按位拼：`(-1 & 0xff) << 24 | (-1 & 0xffffff)` = **0xFFFFFFFF（白不透明）**
 * ⇒ 窗口淡入成**白** ⇒ 用户看到的"白底"。
 *
 * ## 本测试钉什么
 *
 *  1. **行为**：`0x202` 的 `op4/op5 = -1` 必须回退成**该项的当前色**（不是 0xFFFFFFFF）；
 *     `op4 > 255` ⇒ 255；`0` 与正值照常。
 *  2. **对照**：`0x203` 的回退（同一对规则）保持不变。
 *  3. **引擎棘轮**：反编译里那两条回退还在（`sub_4231F0` 的两个 `sub_4ADD60`）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine, Frame } from '../src/vm/engine.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS, NATIVE_OPS } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/native.js';
import { im, instr } from './harness.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { scConfigureDrawItem, scSetDrawColorAlpha } from '../src/renderer/scene/ops.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

/** 一个**已建好**的绘制项（`flags & 1` —— `0x202` 有这道门）；工作色 = `from`。 */
function mkItem(handle: number, from: number): { e: Engine; native: HeadlessScene; f: Frame } {
  const native = new HeadlessScene({});
  const e = new Engine(native);
  scConfigureDrawItem(native.scene, {
    handle,
    layer: handle,
    srcX: 0,
    srcY: 0,
    srcW: 1086,
    srcH: 149,
    dstX: 93,
    dstY: 556,
    tex: 0x11,
  });
  const r = scSetDrawColorAlpha(native.scene, handle, from, 0);
  assert.equal(r, 'applied', '工作色必须真的落在已存在的项上');
  return { e, native, f: new Frame() };
}

function run(handle: number, argv: number[]): { e: Engine; native: HeadlessScene; f: Frame } {
  const ctx = mkItem(handle, 0xa0000000); // 当前色 = 半透明黑（= 脚本 f807d=0xa0 / a9db=0）
  const h = OPS.get(0x202) ?? NATIVE_OPS.get(0x202);
  assert.ok(h, '0x202 应有 handler');
  h!(makeCtx(ctx.e, ctx.f, instr(0x202, argv.map((v) => im(v))), ctx.native, () => {}));
  return ctx;
}

test('★T-0102 根因：`0x202` 的 `-1/-1` 必须回退成**当前色**（引擎 raw 31395-31411），不是白', () => {
  const handle = 0x19640;
  const { native } = run(handle, [handle, 0, 800, -1, -1]);
  const it = native.scene.drawItems.get(handle);
  assert.ok(it, '项应还在');
  assert.equal(
    it!.to >>> 0,
    0xa0000000,
    '★`-1/-1` ⇒ TO = 当前色 0xa0000000（半透明黑）；旧实现给 0xffffffff（白）⇒ 窗口淡入成白',
  );
  assert.equal(it!.blend, 0, 'delay/dur 之外的两个操作数原样透传（本例 op2=0）');
});

test('★T-0102：`0x202` 的 α 正向/越界仍按引擎 clamp（>255⇒255；0 与正值照常）', () => {
  const h = OPS.get(0x202) ?? NATIVE_OPS.get(0x202);
  const cases: Array<[number[], number]> = [
    [[0x100, 0, 100, 0x40, 0x112233], 0x40112233], // 常规：α 与 RGB 直接用
    [[0x100, 0, 100, 300, 0x112233], 0xff112233], // α > 255 ⇒ 255
    [[0x100, 0, 100, 0, 0x112233], 0x00112233], // α = 0 照常（"回退"只在 < 0 时）
    [[0x100, 0, 100, -1, 0x112233], 0xa0112233], // 只回退 α
    // ★只回退"色"时取的是当前色的**低 24 位**（引擎 `(u8)v3 | …BYTE2(v3)…`）——
    //   当前色 0xa0000000 的 RGB 恰好是 0（半透明**黑**）⇒ 结果 = α(0x40) + 黑
    [[0x100, 0, 100, 0x40, -1], 0x40000000],
  ];
  for (const [argv, expect] of cases) {
    const ctx = mkItem(0x100, 0xa0000000);
    h!(makeCtx(ctx.e, ctx.f, instr(0x202, argv.map((v) => im(v))), ctx.native, () => {}));
    const it = ctx.native.scene.drawItems.get(0x100)!;
    assert.equal(it.to >>> 0, expect >>> 0, `0x202 ${JSON.stringify(argv)} ⇒ ${expect.toString(16)}`);
  }
});

test('★T-0102：`0x203` 的回退（同一对规则）不受本次改动影响', () => {
  const h = OPS.get(0x203) ?? NATIVE_OPS.get(0x203);
  assert.ok(h, '0x203 应有 handler');
  const ctx = mkItem(0x100, 0xa0000000);
  h!(makeCtx(ctx.e, ctx.f, instr(0x203, [im(0x100), im(0), im(-1), im(-1)]), ctx.native, () => {}));
  assert.equal(ctx.native.scene.drawItems.get(0x100)!.from >>> 0, 0xa0000000, '`-1/-1` ⇒ FROM = 当前色');
});

test('★T-0102 引擎棘轮：`sub_4231F0` 里那两条"负值 ⇒ 当前色"回退还在', () => {
  const c = fs.readFileSync(path.join(ROOT, 'engine', '天结_unpacked.exe_utf8.c'), 'utf8');
  const at = c.indexOf('//----- (004231F0)');
  assert.ok(at > 0, '应能找到 `0x202` 的 handler `sub_4231F0`');
  const body = c.slice(at, c.indexOf('//----- (004232C0)', at));
  const calls = body.match(/sub_4ADD60\(/g) ?? [];
  assert.equal(calls.length, 2, `★α 与颜色各一条回退（各一次 sub_4ADD60）；实际 ${calls.length} 次`);
  assert.ok(/if \( v2 < 0 \)/.test(body), 'α < 0 ⇒ 取当前色的 α');
  assert.ok(/if \( v3 < 0 \)/.test(body), '颜色 < 0 ⇒ 取当前色');
});
