/** @tier T0 @kind ratchet @subsystem frame */

/**
 * **帧捕获缝（`FrameHost.capture`）守卫** —— `tickets/T-0134` WS-2（设计来源 `tickets/T-0133` §B.4.4）。
 *
 * 锁四件事：
 *  1. **桥的唯一调用点 `capturePng` 的三态语义**：无 `capture` ⇒ `null`（"没能力"，调用方降级）；
 *     有 ⇒ 原样返回字节；`capture()` 自己抛 ⇒ **原样往外抛**（"有能力但这次失败"必须可区分）。
 *  2. **源码棘轮**：Pixi 侧的 `captureFrame` 必须**复用**既有的私有 `#captureStageCanvas()` 且
 *     `#captureStageCanvas` 不许消失（T-0133 的 evidence 锚在它上面）。
 *  3. **headless 宿主不许长出 `capture`**：没有像素是 headless 的定义，不是缺口。
 *  4. **类型面**：实现了 `capture` 的宿主对象仍满足 `FrameHost`（可选成员 ⇒ 零破坏、零 VM 语义变更）。
 *
 * ★为什么 2 只能做源码棘轮：`PixiBackend` 依赖 WebGL/DOM（Node 里建不起来），
 *   而"抓帧"的像素正确性本来就只能在 Electron 里验（本工程的既有做法，见 `transition-render-wiring.test.ts`
 *   与 `draw-string.test.ts`）。本文件不碰 WebGL/DOM/Electron。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { capturePng, type FrameHost } from '../src/frame/host.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EMU = path.dirname(HERE); // app/amayui-emulator
const read = (rel: string): string => fs.readFileSync(path.join(EMU, rel), 'utf8');

/** 取一个类方法的源码区间（从签名到下一个 2 空格缩进的收尾 `}`）。 */
function methodBody(src: string, signature: string): string {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `找不到方法签名 \`${signature}\`（守卫结构变了？）`);
  const end = src.indexOf('\n  }\n', start);
  assert.ok(end > start, `找不到 \`${signature}\` 的方法结束（守卫结构变了？）`);
  return src.slice(start, end + 4);
}

// ---------------------------------------------------------------------------
// (a) 桥的唯一调用点：三态语义
// ---------------------------------------------------------------------------

test('★capturePng：有 capture ⇒ 原样返回那些字节（不拷贝、不重编码）', async () => {
  // 一段以 PNG magic 开头的字节（内容本身不重要，重点是"原样"）。
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const host: FrameHost = { now: () => 0, capture: async () => bytes };
  const got = await capturePng(host);
  assert.equal(got, bytes, '★必须是同一个对象（"原样返回"，不许在中途拷贝/换实现）');
  assert.deepEqual(got, bytes);
  assert.equal(got!.byteLength, 12);
});

test('★capturePng：宿主没有 capture ⇒ 返回 null 且不抛（headless = 没有像素）', async () => {
  // 最小宿主：只有 `now`（`capture` 是可选成员 ⇒ 这个字面量本身也是 (d) 的类型面证据）。
  const minimal: FrameHost = { now: () => 0 };
  assert.equal(await capturePng(minimal), null);

  // 有别的可选能力、但没有 `capture` 的宿主同样降级（不是"整个宿主不存在"才 null）。
  const noCapture: FrameHost = {
    now: () => 123,
    yield: async () => {},
    needsRender: () => false,
    poolPending: () => false,
  };
  assert.equal(await capturePng(noCapture), null);
  await assert.doesNotReject(() => capturePng(minimal), '★"没有能力"是常态，不许抛');
});

test('★capturePng：capture() 自己抛 ⇒ 原样往外抛（不吞、不换成 null）', async () => {
  const boom = new Error('抓帧器炸了');
  const host: FrameHost = {
    now: () => 0,
    capture: async () => {
      throw boom;
    },
  };
  await assert.rejects(
    () => capturePng(host),
    (err: unknown) => {
      assert.equal(err, boom, '★必须是同一个错误对象（吞掉/包装都会让"截图偶尔变空"更难查）');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// (b) 源码棘轮：Pixi 侧复用私有抓帧，不另开路径
// ---------------------------------------------------------------------------

test('★源码棘轮：`captureFrame` 复用私有 `#captureStageCanvas()`（旧私有方法一个字都不许动）', () => {
  const src = read('src/renderer/pixiBackend.ts');
  assert.ok(src.includes('#captureStageCanvas'), '★`#captureStageCanvas` 不许改名/删除（T-0133 的 evidence 锚）');
  assert.ok(src.includes('captureFrame'), '`captureFrame` 必须存在（`FrameHost.capture` 的实现）');
  assert.ok(
    /async captureFrame\(\): Promise<Uint8Array> \{/.test(src),
    '★签名必须逐字为 `async captureFrame(): Promise<Uint8Array>`（冻结接口）',
  );
  const body = methodBody(src, 'async captureFrame(): Promise<Uint8Array> {');
  assert.ok(
    body.includes('this.#captureStageCanvas()'),
    '★`captureFrame` 的函数体必须调 `this.#captureStageCanvas()`（复用同一条 extract.canvas，不许另开抓帧路径）',
  );
  assert.ok(
    /toBlob\([\s\S]*?'image\/png'[\s\S]*?\)/.test(body),
    "★必须 PNG 编码（`canvas.toBlob(…, 'image/png')`）—— 帧捕获的线上格式是 PNG 字节",
  );
  assert.ok(
    /new Uint8Array\(await blob\.arrayBuffer\(\)\)/.test(body),
    '★必须把 blob 转成 `Uint8Array`（`FrameHost.capture` 的返回类型）',
  );
  assert.ok(
    /throw new Error\(/.test(body),
    '★失败必须抛带上下文的 Error（`#captureStageCanvas()` 给 null / `toBlob` 给 null），不许静默返回空图',
  );
  // 私有实现仍在（不是被"提成公开"顶替掉）：签名逐字。
  assert.ok(
    /#captureStageCanvas\(\): HTMLCanvasElement \| null \{/.test(src),
    '★私有抓帧必须仍是 `#captureStageCanvas(): HTMLCanvasElement | null`（公开方法只是它的薄包装）',
  );
});

// ---------------------------------------------------------------------------
// (c) headless 宿主不许长出 capture
// ---------------------------------------------------------------------------

test('★headless 宿主源码不含 `capture`（没有像素是它的定义，不是缺口）', () => {
  const src = read('src/renderer/headlessFrameHost.ts');
  assert.equal(
    src.includes('capture'),
    false,
    '★`headlessFrameHost.ts` 一旦出现 `capture` 就说明有人"顺手补上了" —— headless 没有像素，' +
      '`capturePng` 必须靠 `null` 降级（`tickets/T-0134` WS-2 / `T-0133` §B.4.4）',
  );
});

// ---------------------------------------------------------------------------
// (d) 类型面：可选成员 ⇒ 零破坏
// ---------------------------------------------------------------------------

test('★类型面：实现 capture 的宿主满足 FrameHost；不实现的也满足（可选成员 ⇒ 零破坏）', async () => {
  // 带 capture 的实现方（Pixi 侧的形状）：类型由编译器检查，这里只让它在运行期也走一遍。
  const withCapture: FrameHost = {
    now: () => 0,
    capture: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  };
  // ★不实现 capture 的既有实现方（headless 侧的形状）必须仍然合法 —— 这条字面量的**能编译**就是判据。
  const withoutCapture: FrameHost = {
    now: () => 0,
    advanceModel: () => {},
    poolPending: () => false,
    needsRender: () => false,
  };
  // 类型面：`capture` 的返回类型必须是 `Promise<Uint8Array>`（不是 `Promise<ArrayBuffer>` 之类）。
  const pending: Promise<Uint8Array> = withCapture.capture!();
  assert.equal((await pending).byteLength, 4);
  assert.equal(await capturePng(withoutCapture), null);
});
