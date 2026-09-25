/** @tier T0 @kind core @subsystem texture */

/**
 * **`T-0153`（renderer 子集）**：纹理槽/表面缺口里落在 `src/renderer/**` 的那几条。
 *
 * 每条都锚在**引擎函数体**上（`engine/天结_unpacked.exe_utf8.c` 的行号 = raw），不锚报告/台账：
 *
 * | # | 对象 | 引擎体 | 本文件锁的行为 |
 * |---|---|---|---|
 * | ① | `0x1F8` mode==3 | `sub_4A2C10` raw 122837-122893（`a5 == 3` ⇒ `operator new(0x460)` + `sub_43A5C0` = DividedTexture；否则 `0x450` + `sub_48AB20`）、`sub_43A5C0` raw 46561-46571、`sub_43A740` raw 46674-46790 | mode 3 ⇒ 分成 grid 子纹理（末行/末列按余数截断）、其余 mode ⇒ Normal |
 * | ② | `0x208` | `sub_49ED60` raw 119773-119798（**同步**读 `+1040/+1044`） | 已知近似：同批 bind+查询只能 0×0（登记在案，见下方该用例的说明） |
 * | ③ | `0x20B` | `sub_4A4C70` raw 124608-124634（先夹到 `v7[263..266]`，空则 `return 1` 不画） | 夹取 + 空矩形早退 |
 * | ④ | `0x23F` | `sub_4307B0` raw 40019-40030（`Engine[op2+94672]` 有对象才答尺寸，无 ⇒ −1）、`sub_4080B0` raw 12960-12979 | 有对象的槽可查尺寸（对象由 `0x20F`/`0x236` 惰性建） |
 * | ⑤ | `0x1FA` | `sub_49E980` raw 119586-119603（`Scene[5*slot+466] = -1` + 析构 CTexture）、`sub_49ED60` raw 119786-119795 | 释放把宿主侧尺寸缓存**一起撤** ⇒ 0x208 必答 0×0（两个宿主） |
 *
 * ★`0x1F8` 的 `*(_DWORD *)(_this + 20 * a2 + 1864) = -1` / `+4*(5*a2+470) = 1`（raw 122847-122848）
 *   与「先销毁 `Engine[slot+94672]` 的旧对象」在 VM 侧 handler，见 `tickets/T-0153/changes-renderer.md`
 *   的跨域接线节（不在本文件）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Texture } from 'pixi.js';

import { TextureCache } from '../src/renderer/pixi/textureCache.js';
import { DEFAULT_TILE_SIZE, clampFillRect, dividedTiles } from '../src/renderer/slotSurface.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { PixiBackend } from '../src/renderer/pixiBackend.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/** 仓库根（源码棘轮用：本文件在 `app/amayui-emulator/test/`）。 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 可控尺寸的假纹理（`TextureCache` 只读 `source.width/height`；Node 里没有真 Pixi 纹理）。 */
const sizedTex = (w: number, h: number): Texture => ({ source: { width: w, height: h } }) as unknown as Texture;

/**
 * **可控解码口**：`decodeImage` 是 `TextureCache` 唯一为可测性抽出的缝
 * （Node 里没有 `ImageData`/`createImageBitmap`/DOM，见 `texture-bind-race.test.ts` 的文件头）。
 */
class GatedCache extends TextureCache {
  #open: (() => void) | null = null;

  protected override async decodeImage(): Promise<Texture | null> {
    await new Promise<void>((r) => {
      this.#open = r;
    });
    return sizedTex(40, 24);
  }

  /** 放行在途载入。 */
  open(): void {
    this.#open?.();
  }
}

// ---------------------------------------------------------------------------
// ① `0x1F8`：mode == 3 ⇒ DividedTexture（另一个类 + 子纹理 vector）
// ---------------------------------------------------------------------------

test('★0x1F8 mode==3 ⇒ DividedTexture：分块表按 ceil(w/格子)×ceil(h/格子)，末行/末列按余数截断', () => {
  const tc = new TextureCache(() => {});
  tc.create(7, 600, 300, 3);
  assert.equal(tc.surfaceClassOf(7), 'divided', '★mode 3 ⇒ 另一个类（raw 122855-122861：`operator new(0x460)` + sub_43A5C0）');
  const tiles = tc.dividedTilesOf(7);
  assert.equal(tiles.length, 3 * 2, 'ceil(600/256)=3 列 × ceil(300/256)=2 行（raw 46675-46677）');
  assert.deepEqual(tiles[0], { x: 0, y: 0, w: 256, h: 256 }, '行主序、首块是满格');
  assert.deepEqual(tiles[2], { x: 512, y: 0, w: 88, h: 256 }, '★末列 = 余数 600-512=88（raw 46777-46778）');
  assert.deepEqual(tiles[5], { x: 512, y: 256, w: 88, h: 44 }, '★末行末列同时截断（raw 46779-46783）');

  for (const mode of [0, 1, 2]) {
    tc.create(8, 600, 300, mode);
    assert.equal(tc.surfaceClassOf(8), 'normal', `mode ${mode} ⇒ NormalTexture（0x450 + sub_48AB20，raw 122866-122871）`);
    assert.deepEqual(tc.dividedTilesOf(8), [], 'Normal 类没有子纹理 vector（`_this[276..278]` 只在 sub_43A5C0 里清零）');
  }
  assert.equal(tc.surfaceClassOf(9), undefined, '没 create 过的槽 ⇒ 没有类（与引擎"表项为 0"同口径）');
});

test('★0x1F8：分块边长 = 引擎 `dword_55052C`（默认 256，`0x248` 可改；raw 5663 / 46675）', () => {
  assert.equal(DEFAULT_TILE_SIZE, 256, '`int dword_55052C = 256;`（raw 5663）');
  const tc = new TextureCache(() => {});
  tc.create(7, 500, 500, 3);
  assert.equal(tc.dividedTilesOf(7).length, 2 * 2, '默认 256 ⇒ ceil(500/256)=2');
  tc.tileSize = 128; // `0x248`（sub_4252E0 raw 32705）写的就是这一格
  tc.create(8, 500, 500, 3);
  assert.equal(tc.dividedTilesOf(8).length, 4 * 4, '★格子边长是可变的（0x248 的 op1）；不是硬编码 256');
});

test('★0x1F8：换类/释放 ⇒ 旧类的分块表随之撤（sub_43A630 的 dtor 释 vector，raw 46573-46598）', () => {
  const tc = new TextureCache(() => {});
  tc.create(7, 600, 300, 3);
  assert.equal(tc.dividedTilesOf(7).length, 6);
  tc.create(7, 600, 300, 0); // 同一槽重建成 Normal
  assert.equal(tc.surfaceClassOf(7), 'normal');
  assert.deepEqual(tc.dividedTilesOf(7), [], '重建 ⇒ 旧 DividedTexture 的子纹理表不得残留');
  tc.create(7, 600, 300, 3);
  tc.release(7);
  assert.equal(tc.surfaceClassOf(7), undefined, '释放（dtor）⇒ 类信息一并消失');
  assert.deepEqual(tc.dividedTilesOf(7), []);
});

test('★0x1F8：`dividedTiles` 纯函数边界（0/负尺寸、恰好整除、tile 非法值）', () => {
  assert.deepEqual(dividedTiles(0, 10), [], '宽 0 ⇒ 没有子纹理（引擎 `v35 = 0` ⇒ 循环不进）');
  assert.deepEqual(dividedTiles(10, 0), [], '高 0 ⇒ 同上');
  assert.deepEqual(dividedTiles(-5, 10), [], '负尺寸按空处理（不抛、不造负宽块）');
  assert.deepEqual(dividedTiles(256, 256), [{ x: 0, y: 0, w: 256, h: 256 }], '恰好一格');
  assert.deepEqual(dividedTiles(257, 256)[1], { x: 256, y: 0, w: 1, h: 256 }, '多 1 px ⇒ 第二格宽 1');
  assert.deepEqual(dividedTiles(300, 300, 0), [], 'tile ≤ 0 ⇒ 空（引擎除零会崩；宿主不跟着崩）');
});

// ---------------------------------------------------------------------------
// ② `0x208`：已登记近似（同批 bind+查询取不到真值）
// ---------------------------------------------------------------------------

/**
 * ★这条**不是**"行为正确"的守卫，而是**把登记在案的近似钉住**（`T-0153` 的 `0x208` 条目：
 * 结论 = 登记，不是修）：引擎的 `set-texture` 是**同步**读+解码（`sub_422CB0` raw 31192-31243
 * → `sub_4559C0`），同一批指令里 `0x208` 立刻能读到真宽高（`sub_49ED60` raw 119786-119795）；
 * 本工程走 IPC 异步 ⇒ **同一批**里的查询只能拿到 0×0。
 *
 * 为什么现在不能修（**扩展点**，给 owner 用）：`.bind()` 的返回值 `void`（`NativeBridge.bindTexture`），
 * 而 VM 的 `op_set_texture` 不 `await` 它 ⇒ 渲染侧**无法**在 `0x208` 之前把载入变成同步等待。
 * 两条可行路线（都要动 `src/vm/**`，不在本轮范围）：
 *  ① 把 `bindTexture` 改成可 `await`（`Promise<void>`）并在 `op_set_texture` 里 `await` —— 语义 = 引擎的同步装载；
 *  ② 主进程提供**同步**的 `imgid → {w,h}` 缝（`.c` 侧已有同步实现：`NodeFileSource.readHeaderSync`
 *     + `agfSizeOf`，见 `src/arch/agfSize.ts`；缺的是 preload 的 `sendSync` 通道）。
 * 重新评估条件：**出现"同批 bind 后立刻 0x208"的真语料用法**，或上面任一条缝落地。
 */
test('★0x208 已知近似（T-0153 登记项）：同批 bind+查询 ⇒ 0×0；屏障后才是真值', async () => {
  const tc = new GatedCache(() => {});
  tc.bind(0x1d4c0, 0xc0);
  assert.deepEqual(
    tc.size(0xc0),
    { w: 0, h: 0 },
    '★载入未完成 ⇒ 0×0（引擎同一帧就是真值 —— 这是登记在案的近似，不是"已验证等价"）',
  );
  assert.equal(tc.pendingCount, 1, '查询顺手按需发起一次载入（唯一的自愈路径）');
  tc.size(0xc0);
  assert.equal(tc.pendingCount, 1, '重复查询不重复发起（`#inflight` 幂等）');
  tc.open();
  await tc.waitIdle();
  assert.deepEqual(tc.size(0xc0), { w: 40, h: 24 }, '到货/屏障之后才是真值（跨帧才等价于引擎的同步答案）');
});

// ---------------------------------------------------------------------------
// ③ `0x20B`：先把矩形夹到表面边界，夹空直接返回不画
// ---------------------------------------------------------------------------

test('★0x20B：矩形夹到表面记录 [0,0,w,h]（左上取 max、右下取 min），夹空则早退', () => {
  assert.deepEqual(clampFillRect(500, 720, -10, -20, 100, 200), { x: 0, y: 0, w: 90, h: 180 }, '左/上被夹到 0');
  assert.deepEqual(clampFillRect(500, 720, 480, 700, 100, 100), { x: 480, y: 700, w: 20, h: 20 }, '右/下被夹到表面边界');
  assert.deepEqual(clampFillRect(500, 720, 10, 10, 100, 100), { x: 10, y: 10, w: 100, h: 100 }, '完全在界内 ⇒ 原样');
  assert.equal(clampFillRect(500, 720, 500, 0, 10, 10), null, '★左 ≥ 右 ⇒ 空（raw 124631 `*v5 >= v5[2]` ⇒ return 1 不画）');
  assert.equal(clampFillRect(500, 720, 0, 720, 10, 10), null, '★上 ≥ 下 ⇒ 空（raw 124633 `v5[1] >= v5[3]`）');
  assert.equal(clampFillRect(500, 720, 10, 10, 0, 10), null, '宽 0 ⇒ 空');
  assert.equal(clampFillRect(500, 720, 10, 10, -5, 10), null, '负宽 ⇒ 空（引擎会把它当"左 > 右"）');
  assert.equal(clampFillRect(0, 720, 0, 0, 10, 10), null, '表面宽 0 ⇒ 永远夹空');
});

test('★0x20B（源码棘轮）：`fillSlotRect` 必须走 `clampFillRect`，不得把 x/y/w/h 原样交给 canvas', () => {
  const src = read('app/amayui-emulator/src/renderer/pixi/textureCache.ts');
  const body = /fillSlotRect\([\s\S]*?\n  \}/.exec(src);
  assert.ok(body, '找不到 `fillSlotRect` 的实现体（守卫结构变了？）');
  assert.ok(
    body[0].includes('clampFillRect'),
    '★`0x20B` 必须先按 `sub_4A4C70` 的口径夹取（否则超界填色会画出引擎不会画的那一块）',
  );
  assert.equal(
    /ctx\.fillRect\(\s*x\s*,\s*y\s*,\s*w\s*,\s*h\s*\)/.test(body[0]),
    false,
    '★不得再把脚本给的 x/y/w/h 原样交给 `ctx.fillRect`',
  );
});

// ---------------------------------------------------------------------------
// ④ `0x23F`：有对象的槽（0x20F/0x236 惰性建）要有尺寸可查
// ---------------------------------------------------------------------------

test('★0x23F：有对象的槽可查尺寸；无对象 ⇒ present=false（引擎写 −1）', () => {
  const tc = new TextureCache(() => {});
  assert.deepEqual(tc.slotNodeSize(7), { present: false, w: 0, h: 0 }, '没有对象 ⇒ 引擎 `v2 == 0` 写 op1 = −1（raw 40025-40027）');
  assert.equal(tc.noteSlotNode(7, 'movie', 0x1234, 0), true, '首次 ⇒ **新建**（引擎 `if (!_this[4*v2+378688])`，raw 31627/32245）');
  assert.equal(tc.noteSlotNode(7, 'movie', 0x1234, 0), false, '已存在 ⇒ 复用、不再 new（raw 31627 的门）');
  assert.deepEqual(
    tc.slotNodeSize(7),
    { present: true, w: 0, h: 0 },
    '有对象但拿不到尺寸 ⇒ 0（`sub_4080B0` 未分派到类 ⇒ 返回 0.0 ⇒ ×1000 = 0；**不是** −1）',
  );
  tc.create(7, 120, 120, 0);
  assert.deepEqual(
    tc.slotNodeSize(7),
    { present: true, w: 120, h: 120 },
    '★对象尺寸 = 该槽表面尺寸（`src/FIELD.txt:13718-13721`：`create-texture 2a 78 78 0` → `i236` → `i23f … 2a`）',
  );
  // ★两张表不许混：`0x208` 读表面表（`Scene + 4*slot + 42456`），`0x23F` 读对象表（`Engine + 4*slot + 378688`）
  tc.noteSlotNode(9, 'movie', 0x99, 0);
  assert.deepEqual(tc.size(9), { w: 0, h: 0 }, '没有 create-texture 表面 ⇒ `0x208` 仍是 0×0（与 `0x23F` 的 present=true 并存）');
  assert.deepEqual(tc.slotNodeSize(9), { present: true, w: 0, h: 0 }, '同槽 `0x23F` = 0（有对象、尺寸未知）');
});

test('★0x23F：`0x1F8`/`0x1F9`/`0x1FA` 都销毁该槽对象（raw 31211-31221 / 31245-31269 / 32245 一族）', () => {
  const h = new HeadlessScene({});
  const clears: [string, () => void][] = [
    ['0x1F8 create-texture', () => h.createTexture(4, 16, 16, 0)],
    ['0x1F9 set-texture', () => h.bindTexture(0x99, 4)],
    ['0x1FA release-texture', () => h.releaseTexture(4)],
  ];
  for (const [what, clear] of clears) {
    h.playMovie(0x1234, 4, 0);
    assert.equal(h.slotNodeSize(4).present, true, `前提：${what} 之前该槽有对象`);
    clear();
    assert.equal(h.slotNodeSize(4).present, false, `★${what} 必须把该槽对象置 0`);
  }
});

test('★0x23F：PixiBackend.playMovie 不再只是 pushLog —— 真的有 per-slot 对象状态', () => {
  const status = { scriptName: '', ip: 0, steps: 0, log: [] as string[], trace: [] as string[] };
  const b: Any = new (PixiBackend as unknown as new (s: unknown) => Any)(status);
  assert.deepEqual(b.slotNodeSize(7), { present: false, w: 0, h: 0 }, '前提：还没 play');
  b.playMovie(0x1234, 7, 0); // `0x20F`（sub_4237B0 raw 31605-31670）
  assert.equal(b.slotNodeSize(7).present, true, '★playMovie 必须建该槽的对象（旧实现只有一行日志）');
  assert.ok(
    status.trace.some((l) => l.includes('playMovie')),
    `日志仍然要有（E4 归因）：${JSON.stringify(status.trace.slice(-2))}`,
  );
  b.releaseTexture(7);
  assert.equal(b.slotNodeSize(7).present, false, '释放后对象消失（raw 31245-31269）');
});

// ---------------------------------------------------------------------------
// ⑤ `0x1FA`：释放把宿主侧尺寸缓存一起撤 ⇒ `0x208` 必答 0×0
// ---------------------------------------------------------------------------

test('★0x1FA：释放把 headless 的尺寸缓存一起撤（引擎销毁 CTexture ⇒ 0x208 答 0×0）', () => {
  const h = new HeadlessScene({});
  h.createTexture(196, 628, 360, 0);
  assert.deepEqual(h.getTextureSize(196), { w: 628, h: 360 }, '前提：表面尺寸可查');
  h.releaseTexture(196);
  assert.equal(h.slotSize.has(196), false, '★`slotSize` 必须一起撤（旧实现只删 slotImgid/proceduralSlots）');
  assert.deepEqual(h.getTextureSize(196), { w: 0, h: 0 }, '★释放后必答 0×0（`sub_49ED60` raw 119786-119795）');
});

test('★0x1FA：Pixi 侧同族 —— 释放必须撤掉槽→imgid 记录（否则 size() 会靠自愈答出旧尺寸）', async () => {
  const tc = new GatedCache(() => {});
  tc.bind(0x111, 5);
  tc.open();
  await tc.waitIdle();
  assert.deepEqual(tc.size(5), { w: 40, h: 24 }, '前提：载入完成后尺寸可查');
  tc.release(5);
  assert.equal(tc.imgidOf(5), undefined, '★`sub_49E980` raw 119594：`Scene[5*slot+466] = -1`（旧行为"保留绑定"与引擎相反）');
  assert.deepEqual(tc.size(5), { w: 0, h: 0 }, '★不得靠 `#healSlot` 用旧 imgid 自愈出旧尺寸');
});
