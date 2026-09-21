/**
 * `T-0102` 守卫：**异步图像载入不得覆盖脚本后来画上去的槽表面**。
 *
 * ## 症状（用户实测，轮 8）
 * 「进入 `SC0000` 后 ADV 窗口背景是**白色**的，展开/收起侧边栏菜单似乎刷新了界面
 * 导致其正确变成了**半透明黑色**」——即"要的内容没上来，脚本**再跑一次**同一段才正确"。
 *
 * ## 机制（引擎同步 vs 重写侧异步）
 * 引擎的 `set-texture`(0x1F9) 是**同步**的（`sub_422CB0` 当场读 AGF + 解码，见 `waitIdle` 的说明），
 * 所以"绑定 → 脚本建面/填色"在引擎里永远不会被载入结果插队。重写侧走 `window.api.image()`
 * （IPC + 主进程解码）是**异步**的，于是存在这条竞态：
 *
 * ```
 * ① set-texture X 48        （X 未缓存 ⇒ 发起异步载入）
 * ② create-texture 48 + 0x20B 填色   ⇒ 屏上应当是②的表面
 * ③ ①的载入完成 ⇒ 旧代码无条件 slotTex.set(48, X) ⇒ 把②换掉
 * ```
 * 脚本那段的真实位置：`src/NOVEL.txt:44-55`（ADV 包装）与 `src/SC0000.txt:1036-1047`
 * （`create-texture 48 500 2d0 0` → `i20b 48 0 0 500 2d0 ff 808080` → `draw-texture 186a0 48 …`）。
 *
 * ## 本守卫锁的事
 * `TextureCache.bind` 的陈旧回写判据：**世代不变**（该槽没被 `create`/`release` 重建）
 * **且绑定未变**（没被改绑成别的 imgid）才允许落盘；否则只进 `#imgCache`（下次绑定即命中）。
 *
 * ★`decodeImage` 是**唯一**为可测性抽出的缝（Node 里没有 `ImageData`/`createImageBitmap`/DOM，
 *   而这条竞态必须在合成对象上**确定性复现**，不能靠真界面偶发观察）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Texture } from 'pixi.js';
import { TextureCache } from '../src/renderer/pixi/textureCache.js';

/** 假纹理：`TextureCache` 只把它当不透明对象存进 `slotTex`，不读任何字段。 */
interface FakeTex {
  name: string;
}

/** 可控的"载入闸门"：测试里唯一的时间来源（不用定时器，纯 Promise）。 */
function gate(): { promise: Promise<FakeTex | null>; open: (v: FakeTex | null) => void } {
  let open!: (v: FakeTex | null) => void;
  const promise = new Promise<FakeTex | null>((r) => {
    open = r;
  });
  return { promise, open };
}

/** 让 `bind` 里那条 `.then()` 微任务跑完（不依赖真实 I/O 时序）。 */
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

/** 覆写解码口的测试替身：按 imgid 取闸门，闸门不开就永远 pending（模拟"载入中"）。 */
class GatedCache extends TextureCache {
  readonly gates = new Map<number, ReturnType<typeof gate>>();

  protected override async decodeImage(imgid: number): Promise<Texture | null> {
    const g = this.gates.get(imgid);
    if (!g) throw new Error(`GatedCache：没有为 imgid 0x${imgid.toString(16)} 准备闸门`);
    return (await g.promise) as unknown as Texture | null;
  }

  /** 备好闸门并登记该 imgid 的假纹理名。 */
  prepare(imgid: number, name: string): ReturnType<typeof gate> {
    const g = gate();
    this.gates.set(imgid, g);
    void name;
    return g;
  }
}

test('T-0102 ①基线：无干扰时异步载入完成后照常落盘（守卫没有误杀正常路径）', async () => {
  const logs: string[] = [];
  const tc = new GatedCache((m) => logs.push(m));
  const g = tc.prepare(0x1234, 'scene-bg');
  const tex = { name: 'scene-bg' } as unknown as Texture;

  tc.bind(0x1234, 48);
  assert.equal(tc.slotTex.has(48), false, '载入未完成前槽里不该有东西');
  g.open(tex as unknown as FakeTex);
  await tick();

  assert.equal(tc.slotTex.get(48), tex, '没有干扰时载入结果必须落盘');
});

test('T-0102 ②★脚本随后 create-texture（程序化表面）⇒ 陈旧回写必须被丢弃', async () => {
  const logs: string[] = [];
  const tc = new GatedCache((m) => logs.push(m));
  const g = tc.prepare(0x1234, 'plate');
  const stale = { name: 'plate' } as unknown as Texture;

  tc.bind(0x1234, 48);
  // 脚本接着建自己的表面（`src/SC0000.txt:1043`）——引擎里这一定晚于同步载入 ⇒ 它必须赢
  tc.create(48, 1280, 720, 0);
  g.open(stale as unknown as FakeTex);
  await tick();

  assert.equal(
    tc.slotTex.has(48),
    false,
    '★`create-texture` 之后的陈旧载入回写不得占用该槽（否则屏上会显示旧的图/白底，直到脚本再跑一次）',
  );
  assert.ok(
    logs.some((l) => l.includes('回写丢弃')),
    `丢弃必须留痕（E4 靠它归因）：${JSON.stringify(logs)}`,
  );
});

test('T-0102 ③槽被 release-texture 释放 ⇒ 陈旧回写必须被丢弃', async () => {
  const tc = new GatedCache(() => {});
  const g = tc.prepare(0x22, 'x');
  tc.bind(0x22, 7);
  tc.release(7);
  g.open({ name: 'x' } as unknown as FakeTex);
  await tick();
  assert.equal(tc.slotTex.has(7), false, '已释放的槽不该被在途载入重新填上');
});

test('T-0102 ④槽改绑到别的 imgid ⇒ 旧图的回写必须丢弃，且不覆盖新图', async () => {
  const tc = new GatedCache(() => {});
  const ga = tc.prepare(0xaa, 'A');
  const gb = tc.prepare(0xbb, 'B');
  const ta = { name: 'A' } as unknown as Texture;
  const tb = { name: 'B' } as unknown as Texture;

  tc.bind(0xaa, 48);
  tc.bind(0xbb, 48); // 改绑
  gb.open(tb as unknown as FakeTex); // 新图先到
  await tick();
  assert.equal(tc.slotTex.get(48), tb, '新绑定必须落盘');

  ga.open(ta as unknown as FakeTex); // 旧图后到（乱序）
  await tick();
  assert.equal(tc.slotTex.get(48), tb, '★乱序到达的旧图不得覆盖新绑定');
});

test('T-0102 ⑤同一 imgid 重复 bind 到不同槽：两次回写互不干扰', async () => {
  const tc = new GatedCache(() => {});
  const g = tc.prepare(0x33, 'shared');
  const tex = { name: 'shared' } as unknown as Texture;

  tc.bind(0x33, 10);
  tc.bind(0x33, 11);
  g.open(tex as unknown as FakeTex);
  await tick();

  assert.equal(tc.slotTex.get(10), tex, '槽 10 的回写应成立（它没被重建/改绑）');
  assert.equal(tc.slotTex.get(11), tex, '槽 11 同样成立');
});
