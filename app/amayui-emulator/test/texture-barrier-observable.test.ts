/** @tier T0 @kind core @subsystem texture */

/**
 * **纹理帧屏障②必须"可观测"**（`tickets/T-0175` 的 ⑦，出处 `tickets/T-0166` §4-③）。
 *
 * ## 为什么要有这条守卫
 *
 * `RendererSession.#awaitTextureBound` 在 `0x1F9`（`set-texture`）之后 `await native.texturesIdle()`——
 * 这是产品路径上唯一一处"VM 停下来等宿主把图载完"的屏障，而它**修前完全不可观测**：
 *  - `DebugQuery` 问不到（`slot` 只答宿主槽状态）；
 *  - trace 里没有逐次证据（`PixiBackend.#barriers` 只在**真的等到图**时才 +1）；
 *  - 唯一的守卫 `test/no-boot-preload.test.ts:98-105` 是**源文本匹配**（在 `pixiBackend.ts` 里找
 *    `texturesIdle` 与 `present(` 的先后）—— 它证明不了"派发一次 `0x1F9` ⇒ 屏障被 await 一次"。
 *
 * ## 判据（与 `tickets/T-0175` acceptance ⑦ 逐字对应）
 *
 * | # | 断言 |
 * |---|---|
 * | 1 | `0x1F9` 过门 ⇒ 缝被**调用恰好一次**、返回的 promise 被等待（`await` 真的发生） |
 * | 2 | `0x249` 同族也过门（`T-0102` 轮 9 的补充）；其余 opcode 不过门（不得"每次派发都等"） |
 * | 3 | 宿主**不实现**该缝 ⇒ 不抛、不 await、**行为与修前逐字相同**，但留一条可数的痕（可选缝语义） |
 * | 4 | 会话侧**真的接上了**这份判据（源码棘轮：`session.ts` 走 `observeTextureBarrier`，
 *     且不再自己内联写 opcode 集合） |
 *
 * ★4 是**源棘轮**（与 `no-boot-preload.test.ts` 同一手法，但盯的是"接线用了唯一那份判据"而不是
 * "某个字出现过几次"）；1–3 是**行为断言**，跑的是产品同一份 `observeTextureBarrier`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TEXTURE_BARRIER_OPS,
  observeTextureBarrier,
  shouldAwaitTextureBarrier,
} from '../src/renderer/app/textureBarrier.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SESSION = path.join(HERE, '..', 'src', 'renderer', 'app', 'session.ts');

test('★派发一次 0x1F9 ⇒ 屏障被 await（缝调 1 次、promise 被等）', async () => {
  let calls = 0;
  let released = false;
  const seam = (): Promise<void> => {
    calls++;
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        released = true;
        resolve();
      }, 0);
    });
  };
  const obs = observeTextureBarrier(0x1f9, 4, seam);
  assert.equal(obs.triggered, true, '0x1F9 必须过门');
  assert.equal(obs.hostSeam, true, '本次注入的是真缝');
  assert.equal(calls, 1, '★派发一次 ⇒ 缝恰好被调一次');
  assert.ok(obs.awaited, '必须把缝返回的 promise 交回调用方去 await（否则屏障是空话）');
  assert.equal(released, false, 'await 之前不该已经放行');
  await obs.awaited;
  assert.equal(released, true, 'await 之后才放行');
  assert.match(obs.trace ?? '', /^=== texture-barrier await 0x1f9 slot=4/, 'trace 行必须能认出"哪条 opcode、哪个槽"');
});

test('★同族门：0x249 也过（T-0102 轮 9），其余 opcode 一律不过（不得每步都等）', async () => {
  assert.deepEqual([...TEXTURE_BARRIER_OPS], [0x1f9, 0x249]);
  assert.equal(shouldAwaitTextureBarrier(0x249), true, '0x249（load-texture-by-id）与 0x1F9 同族');
  assert.equal(shouldAwaitTextureBarrier(0x1f9), true);
  // 语料里高频的邻居：0x1F8 create-texture / 0x1FB draw-texture / 0x249 之外的 0x24x
  for (const op of [0x1f8, 0x1fa, 0x1fb, 0x208, 0x24a, 0x0, 0x6e]) {
    assert.equal(shouldAwaitTextureBarrier(op), false, `0x${op.toString(16)} 不该过门（每步都 await 会拖死帧率）`);
  }
  // 行为面：不过门 ⇒ 连缝都不碰、没有 trace 行
  let calls = 0;
  const obs = observeTextureBarrier(0x1fb, 4, () => {
    calls++;
    return Promise.resolve();
  });
  assert.equal(obs.triggered, false);
  assert.equal(calls, 0, '不过门 ⇒ 缝一次都不许被调');
  assert.equal(obs.awaited, undefined);
  assert.equal(obs.trace, undefined, '不过门 ⇒ 不留 trace（否则日志被每步一条淹掉）');
});

test('★可选缝语义：宿主不实现 texturesIdle ⇒ 不抛、不 await、留一条可数的痕（行为与修前一致）', () => {
  const obs = observeTextureBarrier(0x1f9, 7, undefined);
  assert.equal(obs.triggered, true, '过了门（这件事发生过）');
  assert.equal(obs.hostSeam, false, '但宿主没有这条缝');
  assert.equal(obs.awaited, undefined, '★不许替宿主造一个空 await（那会把"没有屏障"伪装成"等过了"）');
  assert.match(obs.trace ?? '', /宿主不实现 texturesIdle/, '必须留痕：这是"本该等而没等"的唯一证据');
  assert.match(obs.note, /不 await、不抛/, '结论行要写明语义');
  // 修前的行为就是"if (texturesIdle) await ..." ⇒ 没缝时整条是 no-op：这里逐字对齐
  const before = 0;
  const after = observeTextureBarrier(0x1f9, 7, undefined).awaited === undefined ? before : 1;
  assert.equal(after, 0, '没缝 ⇒ 与修前逐字相同的 no-op');
});

test('★源棘轮：会话真的接上了这份判据（不再自己内联写 opcode 集合）', () => {
  const src = fs.readFileSync(SESSION, 'utf8');
  assert.match(src, /observeTextureBarrier\(/, 'session.ts 必须走 `observeTextureBarrier`（判据的唯一来源）');
  assert.match(
    src,
    /barrier:\s*\(\)\s*=>/,
    'DebugQuery 的 `barrier` 命令必须由会话注入（否则 `barrier` 查询在真机上报"未注入"）',
  );
  // 反向：修前那两行内联判断必须已经消失（否则"判据唯一来源"是假的 —— 两份会各自漂移）
  assert.doesNotMatch(
    src,
    /t\.opcode !== 0x1f9 && t\.opcode !== 0x249/,
    '★旧的内联 opcode 集合必须删掉：留着就是"判据两份"，改一处不会影响另一处',
  );
  // ★★2026-09-25（`T-0179` 第 70 轮）：**调用点的门**也必须走判据（修前是 `if (t.opcode === 0x1f9)`）。
  //   为什么单列一条：上面那条反向断言只覆盖"旧的 `!== && !==` 内联式"，看不见"把集合收窄回一条"这个
  //   更隐蔽的漂移 —— 实测它真的存在（`0x249` 在纯函数判据里、却被调用点滤掉），而语料里
  //   「`i249` → `i208` → `draw-texture`」的现场有 2 处（`src/BTL.txt:4174-4175`、`src/DRAWCHP.txt:56-59`）。
  assert.match(
    src,
    /shouldAwaitTextureBarrier\(t\.opcode\)/,
    '★调用点必须用 `shouldAwaitTextureBarrier(t.opcode)`，不许自己内联写 opcode 集合',
  );
  assert.doesNotMatch(
    src,
    /t\.opcode === 0x1f9\b/,
    '★调用点不得把判据收窄回单条 opcode（`0x249` 会被滤掉 ⇒ 那些槽的宽高停留在 0×0）',
  );
});
