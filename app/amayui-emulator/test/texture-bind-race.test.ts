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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Texture } from 'pixi.js';
import { BARRIER_GIVEUP_MS, TextureCache } from '../src/renderer/pixi/textureCache.js';

/** 仓库根（源码棘轮用：本文件在 `app/amayui-emulator/test/`）。 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

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

/**
 * ★★`T-0102` 轮 9（白底的机制，见 `tickets/T-0102/changes.md` §「轮 9 白底」与
 * `tickets/T-0102/white-report` 那份只读取证的结论）：**迟到的纹理到货必须让下一帧重新合成**。
 *
 * 为什么：常规 `TextureCache` 此前**没有**到货通知（只有 L2D 纹理库有）⇒ 首次 `set-texture`
 * 那一帧 `slotTex` 还没有图，`draw-texture` 画的是 `presenter` 的**白占位块**
 * （`Texture.WHITE` + tint 被 `itemColor` 覆盖成 `Item.from` = 白）；等图像真的到了，
 * 因为没人置脏、而产品帧档是 `present: 'needsRender'`，**白帧就留在屏上** ——
 * 直到玩家做别的操作（开合侧边栏会重跑同一段 `set-texture`，那时命中 `#imgCache` ⇒ 同步 ⇒ 才对）。
 */
test('★T-0102 轮 9：迟到到货必须通知 onReady（宿主据此置脏 ⇒ 白占位块最多存活一帧）', async () => {
  let ready = 0;
  const tc = new GatedCache(
    () => {},
    () => {
      ready++;
    },
  );
  const g = tc.prepare(0x77, 'late-bg');
  const tex = { name: 'late-bg' } as unknown as Texture;

  tc.bind(0x77, 42);
  assert.equal(ready, 0, '载入还没完成时不该通知');
  g.open(tex as unknown as FakeTex);
  await tick();

  assert.equal(tc.slotTex.get(42), tex, '前提：纹理确实落盘了');
  assert.equal(ready, 1, '★到货必须通知一次（否则白帧不会被重新合成 ⇒ 用户实测的"刷新才对"）');
});

test('★T-0102 轮 9：回写被丢弃时**不**通知 onReady（该槽的可用性没有变化）', async () => {
  let ready = 0;
  const tc = new GatedCache(
    () => {},
    () => {
      ready++;
    },
  );
  const g = tc.prepare(0x78, 'stale');
  tc.bind(0x78, 43);
  tc.create(43, 16, 16, 0); // 脚本后来建了自己的表面 ⇒ 这次回写会被丢弃
  g.open({ name: 'stale' } as unknown as FakeTex);
  await tick();

  assert.equal(tc.slotTex.has(43), false, '前提：回写被丢弃');
  assert.equal(ready, 0, '丢弃 ≠ 到货 ⇒ 不得通知（否则会无谓地多合成一帧）');
});

/**
 * ★★`T-0102` 登记的 **H3**（本轮修）：**被丢弃的回写不得让该槽永久无纹理** —— 图已经在
 * `#imgCache` 里了，"下次绑定即命中"应当提前成"下次读取即命中"（`#healSlot`）。
 *
 * 症状形状：某个非程序化槽（没有 `create-texture` 的画布）在异步载入窗口里被改绑/丢弃过一次，
 * 此后 `resolve()`/`size()` 每帧回落占位块，只有脚本**再发一次同一条 `set-texture`**
 * （= 用户实测的"开合侧边栏才对"）才恢复。引擎不会有这一态：它的 `set-texture` 是同步的。
 */
test('★T-0102 H3：改绑后丢弃的旧回写 ⇒ 该槽靠"当前绑定 + 图已在缓存"自愈（不必等第二次 set-texture）', async () => {
  const logs: string[] = [];
  const tc = new GatedCache((m) => logs.push(m));
  const ga = tc.prepare(0xaa, 'A');
  const gb = tc.prepare(0xbb, 'B');
  const tb = { name: 'B' } as unknown as Texture;

  tc.bind(0xaa, 48); // 发起了 A 的载入
  tc.bind(0xbb, 48); // 改绑到 B ⇒ A 的回写会被丢弃
  gb.open(tb as unknown as FakeTex);
  await tick();
  assert.equal(tc.slotTex.get(48), tb, 'B 先到：照常落盘');

  ga.open({ name: 'A' } as unknown as FakeTex); // A 后到、被丢弃（不进该槽）
  await tick();
  assert.equal(tc.slotTex.get(48), tb, '★旧图不得覆盖新绑定');

  // 构造"绑定已知但槽里没纹理"这一态：把槽的纹理抹掉（模拟被丢弃/释放后没有自愈点的情形），
  // 再从读侧访问一次 —— 当前绑定是 0xbb，而它的图已经在 #imgCache 里 ⇒ 应当**当帧**自愈。
  // ★探针用 `slotTex.has` 而**不能**用 `size()`：`size()` 自己就会走自愈（这正是本守卫要测的行为）。
  tc.slotTex.delete(48);
  assert.equal(tc.slotTex.has(48), false, '前提：读侧确实处于"没有纹理"态（否则这条守卫测不到 H3）');
  const healed = tc.resolve({ tex: 48 } as never);
  assert.equal(healed.tex, tb, '★resolve 必须自愈（否则每帧画占位块，直到脚本再发一次 set-texture）');
  assert.ok(
    logs.some((l) => l.includes('slotTex 自愈')),
    `自愈必须留痕（E4 归因用）：${JSON.stringify(logs.slice(-4))}`,
  );
  assert.equal(tc.slotTex.get(48), tb, '自愈之后 size() 也能拿到真实纹理（它走同一条 #healSlot）');
});

test('★T-0102 H3 反面：自愈只能用**当前绑定**那张图 —— 旧图在缓存里也不许拿来顶', async () => {
  const tc = new GatedCache(() => {});
  const ga = tc.prepare(0xaa, 'A');
  const gb = tc.prepare(0xbb, 'B');
  const ta = { name: 'A' } as unknown as Texture;

  tc.bind(0xaa, 49);
  tc.bind(0xbb, 49); // 改绑到 B（B 的载入还没回来）
  ga.open(ta as unknown as FakeTex); // A 先到且被丢弃
  await tick();
  assert.equal(tc.slotTex.has(49), false, '前提：A 的回写被丢弃');

  const r = tc.resolve({ tex: 49 } as never);
  assert.equal(r.tex, undefined, '★当前绑定是 B 且 B 还没到位 ⇒ 不许拿缓存里的旧图 A 自愈');
  assert.equal(tc.slotTex.has(49), false, '槽必须保持空（宁可画占位块，也不能画错的那张图）');
  void gb;
});

/**
 * ★说明（反面守卫的**边界**）：`#healSlot` 的第一条排除是"该槽有 `create-texture` 的程序化表面"，
 * 但 Node 里没有 DOM ⇒ `TextureCache.create()` **不会**建画布槽（`typeof document === 'undefined'`）
 * ⇒ 那条排除在单测里**不可达**。它有两条别的保障：
 *  ① 真宿主（Electron）里 `create()` 一定建画布，`#canvasSlots.has(slot)` 为真；
 *  ② `tickets/T-0102` 的 E4 路径（设置界面的 `create-texture 196` + `draw-string`）是它的现场判据。
 * 这里把边界写出来，免得后人以为"没测到 = 不存在"。
 */
test('T-0102 H3：无 DOM 时 create() 不建画布槽（记录边界，防止把不可达当成已验证）', () => {
  const tc = new GatedCache(() => {});
  tc.create(51, 64, 32, 0);
  assert.equal(tc.slotTex.has(51), false, 'Node 里 create() 没有画布 ⇒ 该槽仍是"无纹理"态（真宿主会建）');
});

/**
 * ★★`T-0102` 登记的 **H2**（本轮修 —— 白底四个洞里的最后一个）：
 * **帧屏障的 500 ms 默认上限是"静默截断"，必须换成安全兜底**。
 *
 * 为什么这不是"少画一帧"的小事：屏障后面紧跟的可能不是画一笔，而是 `0x208`
 * （`sub_4302E0` 读纹理尺寸并**写回操作数**）这类 getter —— 在载入完成前放行，脚本就按
 * `0×0` 走**与引擎不同**的分支，而且**不会回头再看**（唯一自愈是脚本再跑一次同一段 =
 * 用户实测的"开合侧边栏才对"）。引擎的 `set-texture` 是同步的，压根没有"超时"这一说。
 *
 * 本守卫钉三件事：①无参默认**不是**小上限；②显式小上限截断时必须**点名在途 imgid**
 * （E4 归因）；③图到货后无参屏障照常结束（没有把"等"写成"永远等"的死锁）。
 */
test('★T-0102 H2：屏障无参上限 = 安全兜底（不是 500 ms 静默截断），截断时点名在途 imgid', async () => {
  const logs: string[] = [];
  const tc = new GatedCache((m) => logs.push(m));
  const g = tc.prepare(0x5a5a, 'big-bg');
  tc.bind(0x5a5a, 64);
  assert.equal(tc.pendingCount, 1, '前提：确实有一张在途');

  // ①无参默认不许是"小上限"：给它 700 ms，必须还在等。
  //   ★为什么是 700：旧默认 500 ms —— 这个窗口必须**跨过**它，否则"静默截断"这一类回归不会被抓住
  //   （500 ms 只是量级，不是精确值：旧代码在这里会于 ~500 ms 返回 `done` ⇒ 断言红）。
  const p = tc.waitIdle();
  const raced = await Promise.race([
    p.then(() => 'done'),
    new Promise((r) => setTimeout(() => r('waiting'), 700)),
  ]);
  assert.equal(raced, 'waiting', '★无参 `waitIdle()` 不得用小程序上限（旧 500 ms 的静默截断正是白底/0×0 的来源）');
  assert.ok(
    BARRIER_GIVEUP_MS >= 10_000,
    `★安全兜底必须是"防真挂死"的量级（实得 ${BARRIER_GIVEUP_MS} ms；500 ms 那档已判定为缺陷）`,
  );

  // ②显式小上限 = 调用方自担后果：到点返回 + 点名在途 imgid（E4 要能直接看出卡在哪张图上）
  await tc.waitIdle(40);
  assert.equal(tc.pendingCount, 1, '显式小上限到点即返回（这条路径是"故意truncate"，不是默认行为）');
  assert.ok(
    logs.some((l) => l.includes('放弃等待') && l.includes('5a5a')),
    `★截断必须点名在途 imgid：${JSON.stringify(logs)}`,
  );

  // ③到货后无参屏障必须自己结束（防"改成无限等"引入挂死）
  g.open({ name: 'big-bg' } as unknown as FakeTex);
  await tick();
  await p;
  assert.equal(tc.pendingCount, 0, '到货之后屏障必须结束');
  assert.equal((tc.slotTex.get(64) as unknown as FakeTex).name, 'big-bg', '且纹理照常落盘');
});

/**
 * ★H2 的**源码棘轮**：两个纹理库的 `waitIdle` 都不许再把"默认上限"写成一个小的字面量，
 * 收敛路径（`pixiBackend.texturesIdle`）也不许传小上限 —— 否则这次的修会被下一次"顺手加个兜底"抹掉。
 */
test('★T-0102 H2（源码棘轮）：屏障默认值只能是共享常量，收敛路径不得传小上限', () => {
  const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  for (const rel of ['app/amayui-emulator/src/renderer/pixi/textureCache.ts', 'app/amayui-emulator/src/renderer/pixi/l2dTextures.ts']) {
    const src = read(rel);
    assert.equal(
      /waitIdle\([^)]*=\s*\d/.test(src),
      false,
      `★${rel}：\`waitIdle\` 不许再把数字字面量当默认上限（用 BARRIER_GIVEUP_MS）`,
    );
    assert.ok(src.includes('BARRIER_GIVEUP_MS'), `${rel} 必须用共享的安全兜底常量`);
  }
  const backend = read('app/amayui-emulator/src/renderer/pixiBackend.ts');
  const call = /texturesIdle\(\)[\s\S]{0,400}?waitIdle\(([^)]*)\)/.exec(backend);
  assert.ok(call, '找不到 `pixiBackend.texturesIdle()` 里的 `waitIdle(...)` 调用（守卫结构变了？）');
  assert.equal(
    /\d/.test(call[1]!),
    false,
    `★帧屏障（收敛路径）不得传数字上限（实得 \`waitIdle(${call[1]})\`）—— 传了就等于把 H2 又打开`,
  );
});
