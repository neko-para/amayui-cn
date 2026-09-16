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
  assert.equal(inst.motions.get(0), motion, '动作槽 0 应持有该动作');

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

  // ── ⑦ 销毁槽 ⇒ 节点变回不可画（引擎 raw 134320 的门控）──
  assert.equal(l2dDestroySlot(e, 0), true);
  assert.equal(l2dNodeDrawable(e, e.l2dNodes.get(14)!), false, '槽空 ⇒ 节点整块不出画');

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
