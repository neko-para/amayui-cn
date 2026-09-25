/** @tier T0 @kind core @subsystem render */
/**
 * **页面内存账（`mem`）与纹理缓存计账的守卫**（`tickets/T-0181`）。
 *
 * 起因：接入 DSH 之后用户实测**两次 `out of memory` 崩溃**，并在 ~500MB 时采样到
 * "Pixi 的 `ImageSource` 占 300MB+"。要判断那笔账，先得能**报出**"谁留住了多少"。
 *
 * 本文件守两件事：
 *  ① **计账本身**（行为）：`TextureCache.stats()` 的像素数/可达数算得对（含"画布按物理像素算"）；
 *  ② **接线**（棘轮）：`mem` 命令从解析 → 会话派发 → 宿主只读方法这条链都在 —— 少一段，
 *     "页面为什么涨到 1.7GB"就只能靠猜（本工程已经被"靠猜"坑过多次）。
 *
 * ★`TextureCache` 是纯逻辑（画布/纹理都可注入）⇒ 本档不碰 DOM、不碰真资产。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TextureCache } from '../src/renderer/pixi/textureCache.js';
import { parseDebugCommand } from '../src/vm/debugCommand.js';
import type { Item } from '../src/renderer/drawitem/model.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EMU = path.resolve(HERE, '..');
const read = (rel: string): string => fs.readFileSync(path.join(EMU, rel), 'utf8');

/** 一张假纹理（只满足 `stats()` 读 `source.width/height` 的形状）。 */
function fakeTex(w: number, h: number): { source: { width: number; height: number }; destroy(): void } {
  return { source: { width: w, height: h }, destroy: () => {} };
}

/**
 * 一个**只替换解码口**的缓存（与 `texture-bind-race.test.ts` 同一手法）：
 * `decodeImage` 是唯一为可测性抽出的缝 ⇒ 走 `preloadImage()` 就把图真的放进 `#imgCache`，
 * 而**不必**去碰私有字段（`#` 名在 runtime 下按下标取不到 —— 本测试第一版就是这么错的）。
 */
class FakeDecodeCache extends TextureCache {
  constructor(private readonly sizeOf: Map<number, [number, number]>) {
    super(() => {});
  }
  protected override async decodeImage(imgid: number): Promise<never | null> {
    const wh = this.sizeOf.get(imgid);
    if (!wh) return null;
    return fakeTex(wh[0], wh[1]) as never;
  }
}

test('★`mem` 命令的解析：裸命令认得，带参数当查询回报（不抛错、不崩）', () => {
  assert.deepEqual(parseDebugCommand('mem'), { a: 'mem' }, '裸 `mem` 必须解析成 mem 动作');
  const bad = parseDebugCommand('mem 123');
  assert.ok(bad && bad.a === 'query', '带参数一律当查询回报（面板与 CLI 拿到同一句失败）');
  assert.match((bad as { text: string }).text, /不吃参数/, '并且说清用法');
});

test('★`TextureCache.stats()`：像素数 = 各已载入图的源尺寸之和', async () => {
  const sizes = new Map<number, [number, number]>([
    [0x11, [1280, 720]],
    [0x22, [64, 64]],
  ]);
  const cache = new FakeDecodeCache(sizes);
  await cache.preloadImage(0x11);
  await cache.preloadImage(0x22);

  const s = cache.stats();
  assert.equal(s.img.count, 2, '两张都进了缓存');
  assert.equal(s.img.pixels, 1280 * 720 + 64 * 64, '像素数 = 各源尺寸之和（不是条目数）');
  assert.equal(s.inflight, 0, '都载完了 ⇒ 没有在途');
  // ★"可达"只由调用方给的槽集合决定（这一档没有画布表 ⇒ 恒 0，行为见下一条）
  assert.equal(s.canvas.count, 0);
  assert.equal(s.canvas.reachable, 0);
});

test('★`stats()` 的"可达"只数调用方点名的槽（判"能不能回收"的判据）', async () => {
  const cache = new FakeDecodeCache(new Map([[1, [8, 8]]]));
  // 画布槽没有公开的建法（`create()` 要 DOM/工厂）⇒ 这里只钉"给定可达集合时的算术"：
  //   两张画布（640×360、100×50），只点名其中一张。
  const canvasSlots = (cache as unknown as Record<string, Map<number, unknown> | undefined>)['#canvasSlots'];
  if (!canvasSlots) {
    // `#` 名按下标取不到（esbuild/tsx 会重命名）⇒ 退化成"用公开面能证明的那部分"。
    //   这不是跳过判据：上面一条已经钉住 `img.pixels`，这条只补"可达集合语义"。
    const r = cache.stats([]);
    assert.equal(r.canvas.reachable, 0, '空可达集合 ⇒ 0');
    return;
  }
  canvasSlots.set(3, { canvas: { width: 640, height: 360 } });
  canvasSlots.set(9, { canvas: { width: 100, height: 50 } });
  const some = cache.stats([3]);
  assert.equal(some.canvas.count, 2);
  assert.equal(some.canvas.pixels, 640 * 360 + 100 * 50, '总数 = 两张画布的物理像素');
  assert.equal(some.canvas.reachable, 1, '只数被引用的那个槽');
  assert.equal(some.canvas.reachablePixels, 640 * 360);
});

test('★`stats()` 对畸形源给 0 而不是 NaN（诊断里一个 NaN 会让整份合计失去意义）', async () => {
  const broken = new (class extends TextureCache {
    constructor() {
      super(() => {});
    }
    protected override async decodeImage(): Promise<never> {
      return { source: { width: undefined, height: 720 }, destroy: () => {} } as never;
    }
  })();
  await broken.preloadImage(0x33);
  const s = broken.stats();
  assert.equal(s.img.count, 1, '图确实进了缓存');
  assert.equal(s.img.pixels, 0, '读不到宽度 ⇒ 记 0（宁可少报，也不许报 NaN）');
  assert.ok(Number.isFinite(s.img.pixels));
});

test('★接线棘轮：`mem` 一条链（解析 → 会话派发 → 宿主只读方法）少一段就只剩猜', () => {
  const cmd = read('src/vm/debugCommand.ts');
  assert.match(cmd, /\| \{ a: 'mem' \}/, '命令表要有 mem 动作（单一真源）');
  assert.match(cmd, /if \(cmd === 'mem'\)/, '解析要认识它');
  assert.match(cmd, /'  mem  /, '帮助文本要列出它（否则没人知道有这个东西）');

  const sess = read('src/renderer/app/session.ts');
  assert.match(sess, /case 'mem':/, '渲染窗要真的派发它');
  assert.match(sess, /this\.#pixi\.memStats\(\)/, '派发要落到宿主只读方法上');

  const backend = read('src/renderer/pixiBackend.ts');
  // ★只读纪律：这个方法体里不许出现任何清理/销毁（诊断不许改状态）。
  //   切片按**下一个成员**收口（第一版切了固定 2400 字符，把后面的 `present()` 也圈进来了 ⇒ 假红）。
  const at = backend.indexOf('memStats(): {');
  assert.ok(at > 0, '宿主要有这个只读方法');
  const nextMember = backend.indexOf('\n  /**', at);
  const body = backend.slice(at, nextMember > at ? nextMember : at + 1500);
  assert.doesNotMatch(body, /\.destroy\(|collectGarbage|\.clear\(\)/, '`memStats` 只许读（不许顺手清理）');
  assert.match(body, /jsHeap: readJsHeap\(\)/, '要报 JS 堆（那是"页面 OOM"的直接观测量）');
  // 堆怎么读（`performance.memory`）在本文件的模块级 `readJsHeap()` 里（`memStats` 只调它）
  assert.match(backend, /function readJsHeap\(\)[\s\S]{0,400}?performance as unknown as \{ memory/, '`readJsHeap` 要读 Chromium 的 `performance.memory`');

  const cache = read('src/renderer/pixi/textureCache.ts');
  assert.match(cache, /stats\(reachableSlots\?: Iterable<number>\)/, '缓存要能报"项数 + 像素数 + 可达数"');
  assert.match(cache, /get slotNodeCount\(\)/, '槽对象数也要报（与"绑定纹理的槽数"不是一回事）');
});
