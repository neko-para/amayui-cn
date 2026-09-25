/** @tier T1 @kind core @subsystem l2d */

/**
 * **Live2D 装载 → 绑定 → 入队 → 出画链**（T-0054 的 E3 守卫；headless，**不依赖 WebGL**）。
 *
 * ## 用真实语料
 * 走 `NodeFileSource` 从**资源根**（`raw/` 或 `install/`，含 `SYS4INI.BIN` + `*.ALF`）按统一文件 id
 * 直读 —— 也就是 TITLE 脚本真正走的那条路：
 *
 * | TITLE 的指令 | 统一 id | 实测解析到的文件 |
 * |---|---|---|
 * | `i341 4f9e 0`（装 MOC） | `0x4f9e` | `TITLE.MOC`（112582 B） |
 * | `i345 4f9f 0 0`（装纹理） | `0x4f9f` | `TITLE00.PNG`（2.4 MB） |
 * | `i34e 5274 0 0 1`（装 MTN） | `0x5274` | `TITLE.MTN`（286959 B） |
 * | `i344 14 0`（建节点） | — | 572B 立绘节点：key=14、slot=0 |
 *
 * ## 断言什么
 * 1. `.MOC` 解析出的模型被装进**实例槽 0**，参数/部件表按模型缺省初始化；
 * 2. `0x352` 预置 + `0x34E` **装载即入队**：动作真的在队里，且 `VISIBLE:` 立即生效；
 * 3. `0x344` 建出的节点**指向槽 0**，`l2dNodeDrawable` 为真（这是"出画门控"的唯一判据）；
 * 4. **推进绑在节点绘制上**（`live2d-node-draw-advance`）：`l2dAdvance` 推进后参数变化，
 *    而**不调用** `l2dAdvance` 时参数不变（引擎没有独立逐帧 tick）；
 * 5. 用 `evaluateModel` 把该模型求值成顶点 ⇒ 与 572B 节点的 node transform 复合后**有限、有界**；
 * 6. `0x342` 销毁槽后**节点变回不可画**（槽空 ⇒ 整块不出画，引擎 raw 134320）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { OPS, NATIVE_OPS } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/stubNative.js';
import { makeCtx } from '../src/vm/step.js';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import {
  l2dAdvance,
  l2dCreateNode,
  l2dDestroySlot,
  l2dNodeDrawable,
  l2dStartMotion,
  l2dSetPending,
  l2dBindTexture,
} from '../src/live2d/runtime.js';
import { loadModelIntoSlot, startMotionOnSlot, type Live2dAssetSource } from '../src/live2d/assetLoader.js';
import { evaluateModel, flattenDrawOrder, newParamState } from '../src/live2d/deform.js';
import { newSceneState } from '../src/renderer/scene/state.js';
import { scL2dSlotProbe, sceneNeedsRender } from '../src/renderer/scene/ops.js';
import type { BinInstruction } from '../src/script/bin.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

/** 找一个含 `SYS4INI.BIN` 的资源根（`raw/` 优先，其次 `install/`）。 */
function findResourceRoot(): string | null {
  for (const cand of ['raw', 'install']) {
    const dir = path.join(ROOT, cand);
    if (fs.existsSync(path.join(dir, 'SYS4INI.BIN'))) return dir;
  }
  return null;
}

/** TITLE 用到的统一文件 id（实测解析见文件头表）。 */
const ID_TITLE_MOC = 0x4f9e;
const ID_TITLE_TEX = 0x4f9f;
const ID_TITLE_MTN = 0x5274;

/** NodeFileSource.readById → Live2dAssetSource。 */
function assetSourceOf(src: NodeFileSource): Live2dAssetSource {
  return { loadById: (id) => src.readById(id) };
}

function mkEngine(native = new StubNative(() => {})): Engine {
  const e = new Engine(native, new InputManager());
  return e;
}

test('Live2D E3：真实 TITLE 资产装进实例槽 0（`.MOC` 解析 + 纹理 + 动作）', async (t) => {
  const root = findResourceRoot();
  if (!root) {
    t.skip('找不到含 SYS4INI.BIN 的资源根（raw/ 或 install/）—— 本机未装原始资源');
    return;
  }
  const src = new NodeFileSource({ resourceDir: root });
  const e = mkEngine();
  e.fileSource = src;

  // ── ① 装 .MOC（引擎 0x341 / sub_4A1860）──
  const model = await loadModelIntoSlot(assetSourceOf(src), e, ID_TITLE_MOC, 0, () => {});
  assert.ok(model, `${root} 应能按 id 0x4f9e 读出并解析 TITLE.MOC`);
  assert.equal(model.stats.version, 10, 'TITLE.MOC 应是 v10');
  assert.ok(model.parts.length > 0, 'TITLE.MOC 应有部件');
  assert.ok(model.params.length > 0, 'TITLE.MOC 应有参数');
  assert.equal(model.canvasWidth > 0 && model.canvasHeight > 0, true, '画布尺寸应为正');

  const inst = e.l2dSlots.get(0);
  assert.ok(inst?.model, '实例槽 0 应有模型');
  assert.equal(inst.modelId, ID_TITLE_MOC);
  // 参数按模型缺省初始化（`defaultValue`）
  for (const p of model.params) {
    if (!p.id) continue;
    assert.equal(inst.params.get(p.id.name), p.defaultValue, `参数 ${p.id.name} 应初始化为 defaultValue`);
  }
  // 部件显隐按模型初始 visible 位
  for (const part of model.parts) {
    if (!part.id) continue;
    assert.equal(inst.partVisible.get(part.id.name), part.visible, `部件 ${part.id.name} 显隐应取模型初始位`);
  }

  // ── ② 装纹理（0x345：模型内纹理号 → 文件 id）──
  l2dBindTexture(e, 0, ID_TITLE_TEX, 0);
  assert.equal(inst.textures.get(0), ID_TITLE_TEX, '纹理号 0 应指向 0x4f9f（TITLE00.PNG）');

  // ── ③ 装动作 + 入队（0x34E；引擎"装载即入队"）──
  const motion = await startMotionOnSlot(assetSourceOf(src), e, ID_TITLE_MTN, 0, 0, true, () => {});
  assert.ok(motion, '应能按 id 0x5274 读出并解析 TITLE.MTN');
  assert.ok(motion.fps > 0, '.MTN 应解析出 $fps');
  assert.ok(motion.curves.length > 0, '.MTN 应有参数曲线');
  assert.ok(motion.durationMs > 0, '.MTN 应有非零时长');
  assert.ok(inst.current, '装载即入队 ⇒ 当前动作应已在播');
  assert.equal(inst.current.loop, true, 'op4=1 ⇒ 循环位应为真');
  // ★`T-0160` 最小 retarget：动作槽的载体从 `motions: Map<槽, Mtn>` 变成**动作记录**
  //   `records: Map<槽, L2dMotionRecord>`（= 引擎实例 `+4`/`+8` 指向的那个动作对象，见 `mtn.ts`）——
  //   旧前提"槽里存的就是 `Mtn` 本身"不再成立。断言强度不变：仍然是"槽 0 持有**这个**动作对象"。
  assert.equal(inst.records.get(0)?.motion, motion, '动作槽 0 的动作记录应持有该动作');

  // ── ④ 推进绑在节点绘制上（引擎没有独立 tick）──
  const before = new Map(inst.params);
  const noAdvance = l2dAdvance(e, 1000, []);
  assert.equal(noAdvance.size, 0, '没有节点要画 ⇒ 不推进任何槽（推进由节点绘制驱动）');
  const advanced = l2dAdvance(e, 500, [14]); // 节点 14 还不存在时也应安全
  assert.equal(advanced.size, 0, '节点不存在 ⇒ 不推进');

  // ── ⑤ 建 572B 立绘节点（0x344：key=14、slot=0）──
  const node = l2dCreateNode(e, 14, 0);
  assert.equal(node.key, 14);
  assert.equal(node.slot, 0, '★record[1] = L2D 实例槽号');
  assert.equal((node.flags & 1) !== 0, true, 'record[0] bit0 = 存在');
  assert.equal(l2dNodeDrawable(e, node), true, '槽 0 有模型 ⇒ 节点可画');
  l2dAdvance(e, 500, [14]);
  assert.notDeepEqual([...inst.params], [...before], '推进后参数应变化（动作在动）');

  // ── ⑥ 求值成顶点（变形链）──
  const state = newParamState(model);
  for (const [k, v] of inst.params) state.set(k, v);
  const frame = evaluateModel(model, state);
  const flat = flattenDrawOrder(frame);
  assert.ok(flat.length > 0, 'TITLE.MOC 应求值出可画网格');
  for (const { dd } of flat) {
    assert.ok(dd.points.every(Number.isFinite), `${dd.id} 顶点应有限`);
    assert.ok(dd.uvs.length === dd.points.length, `${dd.id} UV 数应与顶点数一致`);
  }

  // ── ⑥b ★E3（`tickets/T-0054` M3 的 `live2d-slot-probe`）：**真语料的槽非空 ⇒ 合成判据为真** ──
  //   引擎 raw 16025 的最后一个 `||` 就是 `sub_4A1AF0`（体 raw 121777-121790：10 槽任一非空 ⇒ 1）
  //   ⇒ 真 TITLE 立绘装在槽 0 期间，`needsRender` 必须恒为真（与"窗还在跑"无关）。
  const sc = newSceneState();
  sc.l2dHost = e;
  assert.equal(scL2dSlotProbe(sc), true, '★真 TITLE 模型在槽里 ⇒ 探针为真（引擎 raw 121784-121789 的 `!*i` 循环）');
  assert.equal(
    sceneNeedsRender(sc, 10_000, false),
    true,
    '★槽非空 ⇒ 合成判据为真（真语料 E3：不是只有"窗在跑"才合成）',
  );

  // ── ⑦ 销毁槽 ⇒ 节点变回不可画（引擎 raw 134320 的门控）；探针也随之转假 ──
  assert.equal(l2dDestroySlot(e, 0), true);
  assert.equal(l2dNodeDrawable(e, e.l2dNodes.get(14)!), false, '槽空 ⇒ 节点整块不出画');
  assert.equal(scL2dSlotProbe(sc), false, '槽被销毁 ⇒ 探针为假（合成可以停）');

  await src.dispose?.();
});

test('Live2D：0x341/0x344/0x345/0x34E 在真语料上走完整 VM 派发（handler 接线）', async (t) => {
  const root = findResourceRoot();
  if (!root) {
    t.skip('找不到含 SYS4INI.BIN 的资源根 —— 跳过');
    return;
  }
  const src = new NodeFileSource({ resourceDir: root });
  const logs: string[] = [];
  const scene = new StubNative((m) => logs.push(m));
  const e = mkEngine(scene);
  e.fileSource = src;

  /** 造一条指令并派发（走真实 handler 表）。 */
  const dispatch = async (op: number, args: { type: number; raw: number }[]): Promise<void> => {
    const instr = {
      opcode: op,
      name: `i${op.toString(16)}`,
      argc: args.length,
      args,
      byteOffset: 0,
      index: 0,
    } as unknown as BinInstruction;
    const handler = OPS.get(op) ?? NATIVE_OPS.get(op);
    assert.ok(handler, `0x${op.toString(16)} 应有 handler（不该落到未实现）`);
    await handler(makeCtx(e, e.curScript(), instr, scene, (m) => logs.push(m)));
  };
  // ★操作数类型 0 = **立即数**（type 3 = 全局 int 池下标，会把 raw 当池下标解引用）
  const imm = (n: number): { type: number; raw: number } => ({ type: 0, raw: n });

  // TITLE.txt:533-534 / 590：mov f8c46 = 4f9e（MOC id）、mov f8c47 = 0（槽）；随后 i341 + i344
  await dispatch(0x341, [imm(ID_TITLE_MOC), imm(0)]);
  await dispatch(0x345, [imm(ID_TITLE_TEX), imm(0), imm(0)]);
  await dispatch(0x352, [imm(0), imm(0), imm(0)]); // i352 0 0 0：预置"待绑纹理号 0"
  await dispatch(0x34e, [imm(ID_TITLE_MTN), imm(0), imm(0), imm(1)]); // i34e 5274 0 0 1
  await dispatch(0x344, [imm(0x14), imm(0)]); // i344 14 0

  const inst = e.l2dSlots.get(0);
  assert.ok(inst?.model, '0x341 后实例槽 0 应有模型（handler 走 async 文件读取）');
  assert.equal(inst.textures.get(0), ID_TITLE_TEX, '0x345 后纹理号 0 应已绑');
  assert.equal(inst.current?.motion.name, 'TITLE.MTN', '0x34E 后当前动作应是 TITLE.MTN');
  assert.equal(inst.pendingTextureNo, null, '0x352 预置的纹理号应被 0x34E 消费掉');
  const node = e.l2dNodes.get(0x14);
  assert.ok(node, '0x344 应建出 key=14 的节点');
  assert.equal(node.slot, 0);
  assert.equal(l2dNodeDrawable(e, node), true, '节点应可画（槽 0 有模型）');

  await src.dispose?.();
});

/**
 * ★`T-0054` 判据 #4 的 **INFOEN 支路 E3**（`tickets/T-0054` 轮 14）：用**真资产**跑 INFOEN 那段装载序列。
 *
 * ## 为什么用这些 id（都是真脚本里的真 id，不是编的）
 * - `src/SETL2DMOC.txt:6-11` 是 id → 资产 的**脚本侧映射表**：`f8c46 == 0x4c8e` ⇒ `i341 4c8e` +
 *   `i345 4f9a <slot> 0` + `i345 4f9b <slot> 1`；
 * - `src/INFOEN.txt:1589-1596` 是角色资料页的 L2D 序列：`i352 0 0 0` → `i34e <mtn> 0 0 1` →
 *   `i344 <key> 0` → `i349 <key> <y> 0 0`（`key = 0x1d4c0 + 0x3e8 = 0x1d8a8`，`y = -0x140 = -320`）；
 * - 资产真身（`NodeFileSource.readById` 实测）：`0x4c8e → BM750A.MOC`、**`0x4c8f → BM750A.MTN`**、
 *   `0x4f9a → BM750A01.PNG`、`0x4f9b → BM750A02.PNG`。
 *
 * ## ★`T-0107` 已定位（这一格不再"开着"）
 * INFOEN 的两个 id 来自全局表（`lookup-array-2d (global-int 527d8c)` 取 MOC、`(global-int 528944)` 取 MTN）。
 * **写入方 = 游戏脚本自己**：`src/EBINIT.txt`（本体 235 处）+ `src/$1$EBINIT.txt`…`$5$EBINIT.txt`（扩展包 109 处）
 * 逐角色**字面写**「基址 + `3c`」那一格（`idx` = 1-based 角色号、行距 3 dword，覆盖 1..998；344 角色两表成对），
 * 例：`src/EBINIT.txt:115 mov (global-int 527d8f) 4087`（`BM001A.MOC`）/ `:116 mov (global-int 528947) 4088`（`BM001A.MTN`）。
 * ★**别用「表基址 token 被写没有」判断表有没有数据** —— 基址那格永远 0 写点（`T-0107` 正是踩了这条险些误判降级）。
 * 早前探针读到 0 的根因：它读的是**表基址本身**（角色 0 那格），而 INFOEN 角色页实际走到的 `idx = 0x13c7 = 5063`
 * **超出写入覆盖 1..998** ⇒ 表里恒 0 ⇒ 走静态贴图回落（**数据事实，非 emulator 缺陷**）。
 * ⇒ 本守卫跑的是"**id 已知**后的 INFOEN 序列 + SETL2DMOC 映射"；「角色 → id」这一档的可取范围见
 * `docs-new/02-data/character-l2d-tables.md` 与 `test/t0107-infoen-real-id.test.ts`（角色 1 能取到真 id 并真装进实例槽）。
 */
test('★T-0054：INFOEN 支路的 L2D 装载序列在真资产上跑通（BM750A.MOC/MTN + 两张 PNG）', async (t) => {
  const root = findResourceRoot();
  if (!root) {
    t.skip('找不到含 SYS4INI.BIN 的资源根 —— 跳过');
    return;
  }
  const src = new NodeFileSource({ resourceDir: root });
  const logs: string[] = [];
  const scene = new StubNative((m) => logs.push(m));
  const e = mkEngine(scene);
  e.fileSource = src;

  const dispatch = async (op: number, args: { type: number; raw: number }[]): Promise<void> => {
    const instr = {
      opcode: op,
      name: `i${op.toString(16)}`,
      argc: args.length,
      args,
      byteOffset: 0,
      index: 0,
    } as unknown as BinInstruction;
    const handler = OPS.get(op) ?? NATIVE_OPS.get(op);
    assert.ok(handler, `0x${op.toString(16)} 应有 handler（不该落到未实现）`);
    await handler(makeCtx(e, e.curScript(), instr, scene, (m) => logs.push(m)));
  };
  const imm = (n: number): { type: number; raw: number } => ({ type: 0, raw: n });

  const KEY = 0x1d8a8; // INFOEN.txt:1592-1593 算出来的节点 key（0x1d4c0 + 0x3e8）

  // ① SETL2DMOC 的 0x4c8e 分支（真脚本 id）
  await dispatch(0x341, [imm(0x4c8e), imm(0)]);
  await dispatch(0x345, [imm(0x4f9a), imm(0), imm(0)]);
  await dispatch(0x345, [imm(0x4f9b), imm(0), imm(1)]);
  // ② INFOEN.txt:1589-1596 的序列
  await dispatch(0x352, [imm(0), imm(0), imm(0)]);
  await dispatch(0x34e, [imm(0x4c8f), imm(0), imm(0), imm(1)]);
  await dispatch(0x344, [imm(KEY), imm(0)]);
  await dispatch(0x349, [imm(KEY), imm(-320), imm(0), imm(0)]);

  const inst = e.l2dSlots.get(0);
  assert.ok(inst?.model, '0x341 后实例槽 0 应有模型（BM750A.MOC）');
  assert.equal(inst.modelId, 0x4c8e, '模型 id 应是 SETL2DMOC 分支里的 0x4c8e');
  assert.equal(inst.textures.get(0), 0x4f9a, '纹理号 0 应绑 BM750A01.PNG');
  assert.equal(inst.textures.get(1), 0x4f9b, '纹理号 1 应绑 BM750A02.PNG');
  assert.equal(inst.pendingTextureNo, null, '0x352 预置的纹理号应被 0x34E 消费掉');
  assert.equal(inst.current?.motion.name, 'BM750A.MTN', '0x34E 后当前动作应是 BM750A.MTN');
  assert.equal(inst.current?.loop, true, 'INFOEN 那一笔 op4 = 1 ⇒ 循环');

  const node = e.l2dNodes.get(KEY);
  assert.ok(node, `0x344 应建出 key=0x${KEY.toString(16)} 的节点`);
  assert.equal(node.slot, 0, '节点头 0x34E 的槽号 = 0');
  assert.equal(l2dNodeDrawable(e, node), true, '槽里有模型 ⇒ 节点可画');
  assert.deepEqual(node.translate, [-320, 0, 0], '0x349 的立即平移（float 像素）应写到 record+336');

  await src.dispose?.();
});
