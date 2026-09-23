/** @tier T0 @kind ratchet @subsystem texture */

/**
 * `T-0102` 守卫：**`0x259` 之后，槽号→图像 的索引必须还在**（`ADV 窗口白底` 的根因锁）。
 *
 * ## 症状（用户实测 + 现场日志直证）
 * 进入 `SC0000` 后 ADV 窗口本体是**平铺的 `#E3E3E3`**（= 1×1 `Texture.WHITE` 拉成 1086×149 再吃
 * `0x203` 给的 ≈0xa0 alpha 的结果）。现场日志（`.tmp/amayui-emulator.log`）：
 * ```
 * bindTexture imgid=0x5260 slot=17
 *   bind slot 17 <- imgid 0x5260      ← 读档装载点把窗口图装回槽 17
 * clearSlotRecords：丢掉 8 条 槽→imgid 记录   ← ★绑定被抹
 * ...
 * [present] items={… 104000:a160 …}    ← 窗口项在画，但槽 17 已无绑定
 * ```
 * 此后整个日志**再没有任何 `bindTexture … slot=17`**，而 `slotTex 自愈` **0 条**
 * —— 因为 `#healSlot` 同样依赖 `#slotImgid` ⇒ `resolve()` 与自愈**两条路一起断**。
 *
 * ## 引擎口径（`sub_41A3A0` raw 25357-25374，逐位复核）
 * `0x259` 的循环只写记录表的 `+8`/`+12` 两格（`Scene/0x750`/`0x754` = `0x258` 按 op2 的
 * bit0/bit1 写的那两位 ⇒ **它是 `0x258` 的整表复位器**）；
 * **imgid（`Scene/0x748`，`0x1F9` 写）与槽对象（`Scene+4*slot+42456`）都不动**。
 * 对照 `0x1F9` 写 `Scene+466/467/470`、`0x258` 写 `Scene+468/469` —— 三条指令互不重合。
 *
 * ## 本守卫锁的三件事（每条都有判别力）
 *  1. `bind(imgid, s)` ⇒ `clearSlotRecords()` ⇒ **`resolve({tex:s})` 仍须给出纹理**（白底根因）；
 *  2. `clearSlotRecords()` 后 **`imgidOf(s)` 仍是原 imgid**（索引不被抹）；
 *  3. `clearSlotRecords()` 后 **`size(s)` 仍给出真尺寸**（`0x208` 的 getter 依赖于同一索引）。
 *
 * ★`decodeImage` 是唯一为可测性抽出的缝（Node 里没有 `ImageData`/`createImageBitmap`/DOM）——
 *   与 `test/texture-bind-race.test.ts` 同一手法。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Texture } from 'pixi.js';
import { TextureCache } from '../src/renderer/pixi/textureCache.js';

/** 假纹理：`TextureCache` 只把它当不透明对象用（`size()` 读 `source.width/height`）。 */
function fakeTex(w: number, h: number): Texture {
  return { name: `fake-${w}x${h}`, source: { width: w, height: h } } as unknown as Texture;
}

/** 覆写解码口：imgid → 预置的假纹理（同步可用，避免定时器/真 I/O）。 */
class FakeCache extends TextureCache {
  constructor(private readonly imgs: Map<number, Texture>) {
    super(() => {});
  }
  protected override async decodeImage(imgid: number): Promise<Texture | null> {
    return this.imgs.get(imgid) ?? null;
  }
}

/** 建一个"已经绑定并载入完成"的 cache（`bind` 命中 `#imgCache` ⇒ 同步落 `slotTex`）。 */
async function boundCache(slot: number, imgid: number, w: number, h: number): Promise<FakeCache> {
  const c = new FakeCache(new Map([[imgid, fakeTex(w, h)]]));
  c.bind(imgid, slot);
  await new Promise((r) => setImmediate(r)); // 若走了异步分支，让 `.then()` 微任务跑完
  return c;
}

const WIN_SLOT = 17; // `src/SYSTEM4.txt:123` 的 `set-texture 5260 11`（槽 = 0x11 = 17）
const WIN_IMGID = 0x5260; // `SO001.AGF`（1280×1792），ADV 窗口图集

test('★0x259 之后槽 17 仍解析出纹理（ADV 窗口白底的根因锁）', async () => {
  const c = await boundCache(WIN_SLOT, WIN_IMGID, 1280, 1792);
  assert.ok(c.resolve({ tex: WIN_SLOT } as never).tex, '前置：绑定后应能解析出纹理');

  c.clearSlotRecords();

  const after = c.resolve({ tex: WIN_SLOT } as never);
  assert.ok(
    after.tex,
    '★0x259 不得让槽 17 失去纹理 —— 引擎只清记录表的 +8/+12，imgid 与槽对象都不动；' +
      '清掉索引 ⇒ `resolve` 与 `#healSlot` 同时失效 ⇒ 回落 1×1 白占位块（用户实测的白底）',
  );
});

test('★0x259 之后槽→imgid 索引仍是原值（不清 `#slotImgid`）', async () => {
  const c = await boundCache(WIN_SLOT, WIN_IMGID, 1280, 1792);
  assert.equal(c.imgidOf(WIN_SLOT), WIN_IMGID, '前置：绑定登记在');

  c.clearSlotRecords();

  assert.equal(c.imgidOf(WIN_SLOT), WIN_IMGID, '★0x259 后 imgid 登记必须保留（引擎不清 Scene/0x748）');
  assert.equal(c.imgidOf(4), undefined, '未绑定过的槽仍是 undefined（没有凭空造登记）');
});

test('★0x259 之后 `0x208` 尺寸 getter 仍给出真尺寸', async () => {
  const c = await boundCache(WIN_SLOT, WIN_IMGID, 1280, 1792);

  c.clearSlotRecords();

  assert.deepEqual(
    c.size(WIN_SLOT),
    { w: 1280, h: 1792 },
    '★尺寸查询走同一索引；丢了它脚本会按 0×0 走错分支且不会回头再看（0x1F9 之后固定 idiom 是 i208）',
  );
});

test('★一致性：`slotTex` 尚未落盘时，0x259 之后仍能按 imgid 补齐（该槽不会再被绑定第二次）', async () => {
  // 生产形状（现场日志逐行核对）：窗口槽 **开机绑一次就再也不绑第二次**
  //   `.tmp/amayui-emulator.log`：`bindTexture imgid=0x5260 slot=17` 只在开机那一次出现，
  //   此后 5 次 `clearSlotRecords` 之间**没有任何** `bindTexture … slot=17`
  //   ⇒ 只要 `slotTex[17]` 曾经缺席，之后只能靠 `#healSlot` 按 `#slotImgid` 补 —— 没有第二次绑定来救。
  //
  // ★诚实说明判别力：`resolve()` 与 `size()` 在自愈时会**顺手把 `slotTex` 落盘**，
  //   所以"清完再读一次"的用例读不到差别；本文件里**真正具判别力的只有上一条**
  //   （"槽→imgid 索引仍是原值"）。本条锁的是**后果的一致性**：索引在 ⇒ 该槽无论如何都补得回来。
  let open!: (v: Texture | null) => void;
  const gated = new Promise<Texture | null>((r) => {
    open = r;
  });
  class LateCache extends TextureCache {
    protected override async decodeImage(): Promise<Texture | null> {
      return gated;
    }
  }
  const c = new LateCache(() => {});
  c.bind(WIN_IMGID, WIN_SLOT);
  assert.equal(c.slotTex.has(WIN_SLOT), false, '前置：图未到 ⇒ slotTex 确实还没有');
  assert.equal(c.resolve({ tex: WIN_SLOT } as never).tex, undefined, '前置：此时解析不出纹理');

  open(fakeTex(1280, 1792)); // 图到货（进 `#imgCache`）
  await new Promise((r) => setImmediate(r));
  assert.equal(c.slotTex.has(WIN_SLOT), true, '到货后 `bind` 的回写已把 slotTex 落盘（本形状的自然收尾）');

  c.clearSlotRecords(); // ← 若这里清掉 `#slotImgid`，该槽就**永久**没人能救回来了

  // 用 `size()` 读：坏分支返回 0×0 是硬判据（`0x208` 之后脚本按 0×0 走错分支且不回头）。
  assert.deepEqual(
    c.size(WIN_SLOT),
    { w: 1280, h: 1792 },
    '★0x259 之后该槽仍须可解析/可查尺寸；索引被清 ⇒ 永久 1×1 白占位块（用户实测的白底）',
  );
});
