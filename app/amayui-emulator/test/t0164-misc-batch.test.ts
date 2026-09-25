/** @tier T0 @kind core @subsystem ops */

/**
 * **`T-0164`**：「跨模块其余指令」批（`gfx-misc` / `arithmetic` / `resource-usage` / `gfx-cg` /
 * `advState` / `pixiBackend` / `pixi/textureCache`）的 P2/P3 缺口守卫。
 *
 * ★**T0**：本文件只吃**合成指令 + 合成配置**（`harness.mkEngine` + 内存里的 `EngineConfig`），
 * 不读 `install/` 任何真游戏资源 ⇒ 干净 clone 上跑得起来。
 *
 * 本轮**读体**（`engine/天结_unpacked.exe_utf8.c`，只读）落地的口径：
 *
 * | op | 体 | 本票做什么 |
 * |---|---|---|
 * | `0x20F` | `sub_4237B0` raw 31605-31670 | op2 建/复用影片槽对象（`Engine[94672+slot]`）；op3 先按位解码（`sub_4054D0`）再映射成音源 BOOL（`sub_405460`）；末尾 `_this[699204] \|= 0x2000` 与 `_this[675972] = 1` |
 * | `0x23D` | `sub_41A300` raw 25320-25347 | 「释放 slot 42..999」：析构 `_this[94714+k]`（= `+378688`）的 CMovieToTexture 对象 + 逐槽 `sub_49E980(Scene, i)` 解绑槽→imgid 记录并析构槽对象 |
 * | `0x19D` | `sub_42D8E0` raw 38267-38285 | 缺键时 `GetConfig` 返回的是**注册表内建默认**（`set:SaveVersion1 = 1`），不是 0 |
 * | `0x60` | `sub_42CA50` raw 37715-37740 | 随机数是 **CRT `rand()`**（进程级 LCG 流）⇒ 可复现；`dword_55D54C = rand()` 在**任意分支之前**推进；**只有恰好 0 才抛**（`if (!v2)`），且抛出前先写一次 `op1 = 0` |
 * | `0x2D4` | `sub_430BD0` raw 40162-40173 | `v4 = fmod(v5, v3)` 全文无分支 ⇒ `fmod(x, 0)` = **NaN**（不是静默 0） |
 * | `0x21D` | `sub_4AC0D0` raw 131146-131265 | 三张表（DrawItem 1032 / MeshEntry 1064 / 572B 节点 1096）**各自独立**：只命中绘图项时网格那一段整个不进，也不报「源不存在」 |
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/vm/engine.js';
import { StubNative } from '../src/vm/stubNative.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { cfgInt } from '../src/engineConfig.js';
import { registryDefault, CFG } from '../src/configRegistry.js';
import type { EngineConfig } from '../src/engineConfig.js';
import { dec, enc } from '../src/vm/bits.js';
import { reseedCrtRand } from '../src/vm/handlers/arithmetic.js';
import type { BinArg } from '../src/script/bin.js';
import { im, instr, loc, mkEngine } from './harness.js';

// ---------------------------------------------------------------------------
// 公共夹具
// ---------------------------------------------------------------------------

/** 记录型宿主：把 `playMovie` / `setLight` / `setRenderState` 的实参逐条记下来。 */
class RecNative extends StubNative {
  readonly movies: { id: number; slot: number; mode: number }[] = [];
  readonly lights: { idx: number; on: boolean }[] = [];
  readonly renderStates: { state: number; value: number }[] = [];
  /** 该槽有没有 CTexture 对象（引擎 `_this[4*slot + 365288]`，`0x20F` 的输入前提）。 */
  readonly texSlots = new Set<number>();
  constructor() {
    super(() => {});
  }
  override playMovie(id: number, slot: number, mode: number): void {
    this.movies.push({ id, slot, mode });
  }
  override setLight(idx: number, on: boolean): void {
    this.lights.push({ idx, on });
  }
  override setRenderState(state: number, value: number): void {
    this.renderStates.push({ state, value });
  }
  /** ★不加 `override`：`hasSlotTexture` 是 `NativeBridge` 的**可选**缝，`StubNative` 刻意不实现它。 */
  hasSlotTexture(slot: number): boolean {
    return this.texSlots.has(slot);
  }
}

/**
 * 引擎 + 一条合成指令的派发器（`tickets/T-0020`：**不自造 `mk()`/帧循环** ——
 * 引擎一律由 `test/harness.ts` 的 `mkEngine` 造，这里只补"取 handler + 建 ctx"这一步）。
 */
function engineWithOps(native: StubNative = new RecNative()): {
  e: Engine;
  f: ReturnType<Engine['curScript']>;
  run: (op: number, args: BinArg[]) => void;
} {
  const e = mkEngine([], 'T0164.BIN', native);
  const f = e.curScript();
  return {
    e,
    f,
    run: (op, args) => {
      const h = OPS.get(op) ?? NATIVE_OPS.get(op) ?? ENGINE_INTERNAL_OPS.get(op);
      assert.ok(h, `0x${op.toString(16)} 应已注册`);
      h!(makeCtx(e, f, instr(op, args), native, () => {}));
    },
  };
}

/** 造一个只带指定键的 `EngineConfig`（`cfgInt` 只读 `values`）。 */
function cfgOf(pairs: [string, string][]): EngineConfig {
  return { values: new Map(pairs.map(([k, v]) => [k.toLowerCase(), v])) } as unknown as EngineConfig;
}

// ---------------------------------------------------------------------------
// P2 `0x20F` play-movie：op2 槽对象 + effect_flags bit0x2000 + `[168993] = 1`
// ---------------------------------------------------------------------------

/** `_this[675972]` = `675972/4` = **168993**（raw 31668 的写点、raw 20660 的读点）。 */
const ENGINE_FIELD_MOVIE_PLAYING = 168993;

test('★P2 0x20F：play-movie 置 `effect_flags |= 0x2000` 且写 `_this[675972] = 1`（raw 31667-31668）', () => {
  const n = new RecNative();
  const { e, run } = engineWithOps(n);
  e.effectFlags = 0x1234; // 别的位必须保住（`|=` 不是赋值）
  // 该槽的 CTexture 对象先存在（raw 31645 的门 `if (!_this[4*v2 + 365288]) throw`）
  n.texSlots.add(5);
  run(0x20f, [im(0x2a), im(5), im(0x10000)]);
  assert.equal(e.effectFlags & 0x2000, 0x2000, '★raw 31667：`_this[699204] |= 0x2000`（= emulator 的 effectFlags）');
  assert.equal(e.effectFlags & 0x1234, 0x1234, '是 `|=`：其余位一个不动');
  assert.equal(e.engineValues.get(ENGINE_FIELD_MOVIE_PLAYING), 1, '★raw 31668：`_this[675972] = 1`（帧循环 raw 20660 的门）');
  // ★第 3 实参是 `sub_405460` 的 **BOOL**（raw 31656-31658 写进 `obj+1144`），**不是** op3 原值
  assert.deepEqual(n.movies, [{ id: 0x2a, slot: 5, mode: 0 }], '★raw 31656：宿主拿到的是「音源可用」BOOL（0x10000 ⇒ 模式 0 ⇒ 恒 0）');
  // 反过来：把 `set:DependMovieSound` 置成 1 ⇒ 模式 1 ⇒ `sound:Music >= 0` ⇒ BOOL 1
  //（证明第 3 实参确实来自解码后的门，而不是原值或常数）
  e.config = cfgOf([['set:DependMovieSound', '1']]);
  run(0x20f, [im(0x2a), im(5), im(0)]);
  assert.equal(n.movies[1]?.mode, 1, '★raw 11090：模式 1 的判据是 `sound:Music >= 0`（缺键 0 ⇒ 1）');
});

test('★P3 0x20F：op3 先按位解码（`sub_4054D0`）再映射成音源 BOOL（`sub_405460`）', () => {
  const n = new RecNative();
  const { e, run } = engineWithOps(n);
  n.texSlots.add(5); // 该槽有 CTexture 对象（raw 31645 的门）
  // 0x10000 ⇒ 模式 0（`sub_405460` 对 case 0 走 default ⇒ 恒 0，**不查配置**）
  run(0x20f, [im(0x2a), im(5), im(0x10000)]);
  assert.equal(n.movies[0]?.mode, 0, '★raw 11109：`a2 & 0x10000` ⇒ 模式 0 ⇒ BOOL 0（raw 11100 的 default）');
  // 0x20000 ⇒ 模式 1 ⇒ `sound:Music >= 0`（raw 11090 的 `>= 0`，**不是** `!= 0`）
  run(0x20f, [im(0x2a), im(5), im(0x20000)]);
  assert.equal(n.movies[1]?.mode, 1, '模式 1 未配 `sound:Music` ⇒ `GetConfig` 缺键 = 0 ⇒ 0 >= 0 ⇒ 1');
  // 0x40000 ⇒ 模式 2 ⇒ `sound:SE != 0`（raw 11092/11103）
  run(0x20f, [im(0x2a), im(5), im(0x40000)]);
  assert.equal(n.movies[2]?.mode, 0, '模式 2 未配 `sound:SE` ⇒ `!= 0` 为假 ⇒ 0（★与模式 1 的 `>= 0` 不是同一判据）');
  // 0x80000 ⇒ 模式 3 ⇒ `sound:Voice != 0`（raw 11095/11103）
  run(0x20f, [im(0x2a), im(5), im(0x80000)]);
  assert.equal(n.movies[3]?.mode, 0, '模式 3 未配 `sound:Voice` ⇒ 0');
  // 四位都不置 ⇒ 按 `set:DependMovieSound` 选（raw 11117）
  e.config = cfgOf([['set:DependMovieSound', '2']]);
  run(0x20f, [im(0x2a), im(5), im(0)]);
  assert.equal(n.movies[4]?.mode, 0, '★raw 11117/11092：`set:DependMovieSound = 2` ⇒ 模式 2 ⇒ `sound:SE != 0`；缺键 0 ⇒ 0');
  e.config = cfgOf([
    ['set:DependMovieSound', '2'],
    ['sound:SE', '1'],
  ]);
  run(0x20f, [im(0x2a), im(5), im(0)]);
  assert.equal(n.movies[5]?.mode, 1, '★把 `sound:SE` 置 1 ⇒ 同一模式 2 下 BOOL = 1（证明走的是配置门）');
});

test('★P3 0x20F：该槽纹理表为空 ⇒ 抛错（raw 31645-31650，`テクスチャが確保されていません`）', () => {
  const n = new RecNative();
  const { e, run } = engineWithOps(n);
  assert.equal(n.hasSlotTexture(6), false, '前提：该槽没有 CTexture 对象');
  assert.throws(() => run(0x20f, [im(0x2a), im(6), im(0)]), /テクスチャが確保されていません/);
  assert.equal(n.movies.length, 0, '抛出 ⇒ 到不了 `sub_489230` 之后的起播段');
  assert.equal(e.effectFlags & 0x2000, 0, '抛出 ⇒ 到不了 raw 31667 的置位');
});

// ---------------------------------------------------------------------------
// P2 `0x23D`：释放 slot 42..999（对象表 + 槽→imgid 记录）
// ---------------------------------------------------------------------------

test('★P2 0x23D：宿主真析构 42..999 的影片槽对象并解绑槽→imgid 记录', () => {
  const s = new HeadlessScene({});
  // 41 在区间外（引擎循环 `v1 = 42; do { … } while (v1 < 1000)`）
  // ★先全部 `playMovie` 再 `bindTexture`：`0x1F9` bindTexture 自己会销毁该槽的对象
  //   （raw 31211-31221）⇒ 顺序反了就没有对象可析构。
  for (const slot of [41, 42, 500, 999]) s.playMovie(0x2a, slot, 0);
  assert.ok(s.slotNodes.has(999), '前提：区间内的槽确实有影片对象');
  for (const slot of [41, 42, 500, 999]) s.bindTexture(0x100 + slot, slot);
  assert.equal(s.slotImgid.get(42), 0x100 + 42, '前提：区间内的槽确实有绑定');
  s.releaseMovieSlots();
  assert.equal(s.slotNodes.has(42), false, '★raw 25333-25341：区间内的影片对象被析构（表项置 0）');
  assert.equal(s.slotNodes.has(500), false);
  assert.equal(s.slotNodes.has(999), false);
  assert.equal(s.slotImgid.has(42), false, '★raw 25342 的 `sub_49E980(Scene, i)` ⇒ 槽→imgid 记录写 −1（撤记录）');
  assert.equal(s.slotImgid.get(41), 0x100 + 41, '★循环从 42 起 ⇒ 槽 41 的绑定必须留下');
});

test('★P3 0x23D：41 与 1000 都不在区间内（引擎 `v1 = 42; while (v1 < 1000)`）', () => {
  const s = new HeadlessScene({});
  s.playMovie(0x2a, 41, 0);
  s.playMovie(0x2a, 1000, 0);
  s.releaseMovieSlots();
  assert.equal(s.slotNodes.has(41), true);
  assert.equal(s.slotNodes.has(1000), true);
});

test('★P2 0x23D：VM 侧把「释放 slot 42..999」下发给宿主缝（不再是零调用的死意图）', () => {
  let calls = 0;
  class CountNative extends StubNative {
    constructor() {
      super(() => {});
    }
    override releaseMovieSlots(): void {
      calls++;
    }
  }
  const n = new CountNative();
  const { run } = engineWithOps(n);
  run(0x23d, []); // argc 0（引擎 `_this[30*cur+95805] = 1`）
  assert.equal(calls, 1, '★0x23D 必须恰好下发一次释放意图（修前宿主缝两个宿主都没实现 ⇒ 只落 DropRecorder）');
});

// ---------------------------------------------------------------------------
// P2 `0x19D`：配置缺键 ⇒ 引擎内建默认（`set:SaveVersion1 = 1`）
// ---------------------------------------------------------------------------

test('★P2 0x19D：缺 `set:SaveVersion1` 键时缺省是引擎内建默认 1（不是 0）', () => {
  assert.equal(registryDefault(CFG.setSaveVersion1), 1, '前提：注册表里 `set:SaveVersion1` 的内建默认 = 1');
  const { e, run } = engineWithOps();
  e.config = cfgOf([]); // 整个 `[set]` 段都缺（真存档实测过这种 INI）
  // ★local int 槽是 **ENC 存**的（`operand.ts:549`）⇒ 读断言必须 `dec(e.key, raw)`
  const out = (id: number): number => {
    const f = e.curScript();
    f.locals.int.set(1, 0);
    run(0x19d, [loc(1), im(id)]);
    return dec(e.key, f.locals.int.get(1) ?? 0);
  };
  assert.equal(cfgInt(e.config, CFG.setSaveVersion1, 0), 0, '前提：`cfgInt(...,0)` 在缺键时给 0（= 引擎的默认**不是**它）');
  assert.equal(out(0x03000001), 0, '★v1 = 1 < 3 ⇒ 扩展包资源恒 0（但走的是**默认 1** 那条，不是 0 那条）');
  // 显式写成 2（旧档）：同样 < 3
  e.config = cfgOf([['set:SaveVersion1', '2']]);
  assert.equal(out(0x03000001), 0, 'v1 = 2 < 3 ⇒ 0');
  // 显式写成 3 且 v2 = 10：门开，走 `isFileUsed`
  e.config = cfgOf([
    ['set:SaveVersion1', '3'],
    ['set:SaveVersion2', '10'],
  ]);
  assert.equal(out(0x03000001), 0, '门开但该 id 未用过 ⇒ 0（这条不恒 0：下面插一条已用 id 即可看到 1）');
  e.markFileUsed(0x03000001);
  assert.equal(out(0x03000001), 1, '★门开且 id 已用过 ⇒ 1（证明上一行的 0 来自查询而不是恒 0）');
});

// ---------------------------------------------------------------------------
// P2 `0x60`：CRT `rand()` 进程级 LCG 流（可复现）
// ---------------------------------------------------------------------------

test('★P2 0x60：随机数走 CRT `rand()` LCG 流 ⇒ 同一存档跑两次逐值相同', () => {
  const seqOf = (): number[] => {
    reseedCrtRand(); // ★模拟"同一个进程刚启动"（引擎的 rand 流初值 = 1；读档不回卷随机流）
    const { e, run, f } = engineWithOps();
    const out: number[] = [];
    for (let i = 0; i < 4; i++) {
      f.locals.int.set(1, 0);
      run(0x60, [loc(1), im(100)]);
      out.push(dec(e.key, f.locals.int.get(1) ?? 0));
    }
    return out;
  };
  const a = seqOf();
  const b = seqOf();
  assert.deepEqual(a, b, '★两次全新引擎的随机流必须逐值相同（T-0005 的 G3 逐帧相等判据的前提）');
  assert.ok(
    a.every((v) => v >= 0 && v < 100),
    `取值域必须在 [0, mod)：${a.join(',')}`,
  );
  assert.notDeepEqual(a, [a[0], a[0], a[0], a[0]], 'LCG 流不该退化成同一个常数');
});

test('★P3 0x60：判据是「只有恰好 0 才抛」——负模数照走有符号取模（raw 37727 的唯一门）', () => {
  reseedCrtRand();
  const { e, run, f } = engineWithOps();
  assert.throws(() => run(0x60, [loc(1), im(0)]), /模数为 0/, '模 0 ⇒ 抛（raw 37727）');
  f.locals.int.set(1, 0);
  run(0x60, [loc(1), im(-7)]); // 负模数：引擎不抛，走 `dword_55D54C % -7`
  const v = dec(e.key, f.locals.int.get(1) ?? 0);
  assert.ok(Number.isInteger(v) && v >= 0, `rand() % -7 是 C 的有符号取模（被除数非负 ⇒ 结果非负）：得到 ${v}`);
});

test('★P3 0x60：模数为 0 ⇒ **先写一次 op1 = 0** 再抛（raw 37729 在 `_CxxThrowException` 之前）', () => {
  reseedCrtRand();
  const { e, run, f } = engineWithOps();
  f.locals.int.set(1, enc(e.key, 12345));
  assert.throws(() => run(0x60, [loc(1), im(0)]), /模数为 0/);
  assert.equal(dec(e.key, f.locals.int.get(1) ?? -1), 0, '★raw 37729：`sub_42B4B0(_this, 1, 0)` 先落一次可观测写');
});

test('★P3 0x60：`dword_55D54C = rand()` 在任何分支之前 ⇒ 连抛错那次也推进了流（raw 37724）', () => {
  const pullThrow = (): number[] => {
    reseedCrtRand();
    const { e, run, f } = engineWithOps();
    f.locals.int.set(1, 0);
    run(0x60, [loc(1), im(1000)]); // 第 1 次：正常
    const first = dec(e.key, f.locals.int.get(1) ?? 0);
    f.locals.int.set(1, 0);
    assert.throws(() => run(0x60, [loc(1), im(0)]), /模数为 0/); // 第 2 次：抛（但流已推进）
    f.locals.int.set(1, 0);
    run(0x60, [loc(1), im(1000)]); // 第 3 次
    return [first, dec(e.key, f.locals.int.get(1) ?? 0)];
  };
  const pullClean = (): number[] => {
    reseedCrtRand();
    const { e, run, f } = engineWithOps();
    f.locals.int.set(1, 0);
    run(0x60, [loc(1), im(1000)]);
    const first = dec(e.key, f.locals.int.get(1) ?? 0);
    f.locals.int.set(1, 0);
    run(0x60, [loc(1), im(1000)]); // 第 2 次：不抛，正常消费
    f.locals.int.set(1, 0);
    run(0x60, [loc(1), im(1000)]); // 第 3 次
    return [first, dec(e.key, f.locals.int.get(1) ?? 0)];
  };
  assert.deepEqual(
    pullThrow(),
    pullClean(),
    '★抛错那一次也推进了 LCG 流 ⇒ 两条路径的第 3 次取值必须相同（否则「先推进」这条没落地）',
  );
});

// ---------------------------------------------------------------------------
// P3 `0x2D4`：浮点取余的除零结果是 NaN（引擎 `fmod`，无分支）
// ---------------------------------------------------------------------------

test('★P3 0x2D4：`fmod(x, 0)` = NaN（引擎无分支、无错误串；不是静默 0）', () => {
  const { run, f } = engineWithOps();
  f.locals.float.set(1, 0);
  f.locals.float.set(2, 7.5);
  f.locals.float.set(3, 0);
  run(0x2d4, [{ type: 0xa, raw: 1 }, { type: 0xa, raw: 2 }, { type: 0xa, raw: 3 }] as unknown as BinArg[]);
  const v = f.locals.float.get(1);
  assert.ok(Number.isNaN(v), `★\`fmod(7.5, 0)\` 是 NaN，得到 ${v}`);
  // 非零除数照常
  f.locals.float.set(2, 7.5);
  f.locals.float.set(3, 2);
  run(0x2d4, [{ type: 0xa, raw: 1 }, { type: 0xa, raw: 2 }, { type: 0xa, raw: 3 }] as unknown as BinArg[]);
  assert.equal(f.locals.float.get(1), 1.5);
});

// ---------------------------------------------------------------------------
// P2 `0x21D`：CopyScene 的三张表各自独立
// ---------------------------------------------------------------------------

test('★P2 0x21D：源绘图项存在、源网格不存在 ⇒ 绘图项照拷、网格那一段整个不进（不报「源不存在」）', () => {
  const s = new HeadlessScene({});
  s.configureDrawItem({ handle: 0, layer: 0, tex: 7, srcX: 1, srcY: 2, srcW: 30, srcH: 40, dstX: 5, dstY: 6 });
  assert.equal(s.scene.meshes.has(0), false, '前提：源 handle 没有网格');
  const r = s.copyScene(0, 0x7d0);
  assert.equal(r, true, '★raw 131166-131170 与 raw 131249：只命中绘图项 ⇒ 不是「源不存在」');
  assert.ok(s.scene.drawItems.get(0x7d0), '绘图项被复制');
  assert.equal(s.scene.meshes.has(0x7d0), false, '★raw 131171-131172：网格那一段整块跳过');
});

test('★P2 0x21D：三张表全空才是「源不存在」（raw 131249）', () => {
  const s = new HeadlessScene({});
  assert.equal(s.copyScene(0xdead, 0xbeef), false);
});
