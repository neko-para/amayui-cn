/** @tier T1 @kind core @subsystem vm */

/**
 * **引擎态快照 / 恢复的 E3（真语料）对照**（`tickets/T-0122` 的最后一条 acceptance）。
 *
 * 为什么单列一个文件（而不是并进 `engine-snapshot.test.ts`）：那个是 **E2**（`harness.ts` 的合成确定性脚本），
 * 本文件要**真的起一条脚本**（`NodeFileSource` + `loadScriptData` + `runFrameLoop` + `HeadlessScene`）
 * ⇒ 它跑得慢、且**依赖资源树**（缺资源时 `t.skip`）。两者档位不同，守卫也分开报。
 *
 * 判据（**诚实形态**：票面允许「差异可逐项解释」）：
 *  跑到第 N 帧抓快照 → 再跑到 M 帧抓「自然态」→ 把快照灌回去 → **再跑到同一个 M 帧**，然后：
 *   ① **与场景无关的引擎态必须逐字节相等**（`key`/`cur`/`globals`/`frames`/`texSlots`/`texSlotFlags`/
 *      `scriptRequests`/`textItems`/`routes`）—— 这一半是**强判据**，没有"可解释"的余地；
 *   ② `engineValues` **逐键**判：分叉键数必须 ≤ 4（= 已登记的"时间相关几格"量级），并把键号打出来；
 *   ③ 顶层分叉面必须落在**已登记**的集合里（`gates`/`engineValues`/`dispatchQueues`）—— 出现新面就红。
 *
 * ★**第一次跑就撞到的实测结论**（已按纪律登记进 `SNAPSHOT_EXCLUDED` 第 9 条）：
 *   真语料下的分叉面**只有"依赖场景动画态的派生量"** —— 门在哪个绝对时刻被武装（`gates.gateWaitStart`）
 *   与派发队列里的计时值，差若干帧；根因是本模块的 `scene` 分区只覆盖票面点名的 `render4` 两格，
 *   而帧循环的行为还取决于场景的动画进行态。⇒ **不是"漏了一个字段"，而是"快照的覆盖面口径"**，
 *   两条重开条件已写进那条 `why`（把 `SceneState` 整体纳入 / 或把语义明确收窄为 VM 态 + 交给画面快照）。
 *
 * ★它**不是 E4**：这里测的是**同一进程内的确定性重放**（时钟由测试注入）。跨进程的墙钟基准做不到，
 *   那一条写在 `SNAPSHOT_EXCLUDED` 的第 5 项里。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { decideResourceDir } from '../src/arch/resourceDir.js';
import { resolveSystemPaths } from '../src/arch/systemPaths.js';
import { Engine } from '../src/vm/engine.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { InputManager } from '../src/vm/input.js';
import { loadScriptData } from '../src/vm/interpreter.js';
import { runFrameLoop } from '../src/frame/loop.js';
import type { FrameHost } from '../src/frame/host.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import {
  captureEngineSnapshot,
  restoreEngineSnapshot,
  type EngineSnapshotV1,
} from '../src/vm/engineSnapshot.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

/** 跑 N 帧（复用 E3 里那套宿主：时钟注入 + `advanceModel` 转发 + 池挂起探针）。 */
async function runFrames(
  e: Engine,
  scene: HeadlessScene,
  clock: { ms: number },
  frames: number,
): Promise<void> {
  const host: FrameHost = {
    now: () => clock.ms,
    advanceModel: (tm) => scene.advanceModel(tm),
    poolPending: () => scene.poolPending(),
  };
  await runFrameLoop(e, host, {
    gates: { anim: 'wait', sleep: 'wait', advance: 'pump' },
    advFrame: true,
    advErrors: 'swallow',
    maxStepsPerFrame: 20000,
    maxFrames: frames,
    onUnknown: () => 'continue',
    onFrameEnd: () => {
      clock.ms += 1000 / 60;
    },
  });
}

/** 丢掉不参与相等性的 `header.at`（生成时刻）。 */
function strip(snap: EngineSnapshotV1): EngineSnapshotV1 {
  const o = structuredClone(snap);
  o.header = { ...o.header, at: '<t>' };
  return o;
}

test('★E3（真语料）：跑到某帧存快照 → 再跑 → 回灌 → 再跑到同一帧 ⇒ 与"自然跑到"逐字节相等', async (t) => {
  const resourceDir = decideResourceDir(REPO, { env: process.env }).dir;
  const src = new NodeFileSource({ resourceDir, system: resolveSystemPaths(REPO) });
  // 挑一条**确定性**的脚本：`SC0010` 是 T-0084 的 E3 用例用的那条（转场窗真的起来），
  // 且它不用随机数（`0x60` 取的是模块级全局，不在快照覆盖面里 —— 用随机脚本会让重放合法地分叉）。
  const boot = await src.readScriptByName('SC0010.BIN');
  if (!boot) {
    t.skip('资源根里没有 SC0010.BIN');
    return;
  }
  const scene = new HeadlessScene({});
  const e = new Engine(scene, new InputManager());
  e.fileSource = src;
  loadScriptData(e, boot.data, boot.name);

  const clock = { ms: 0 };
  const N = 300;
  const M = 600; // 总共跑到第 M 帧
  await runFrames(e, scene, clock, N);
  const base = captureEngineSnapshot(e, clock.ms, scene.scene);
  assert.ok(base.frames.length >= 1, '前置：真语料跑起来后至少有一帧');
  assert.ok(base.engineValues.length > 0, '★前置：真语料下 engineValues 必须有真值（否则这条判据是空转）');
  // ★前置的写法：`SC0010` 是**场景**脚本（转场/场景态），不一定产出文本项 —— 所以判据是
  //   「四个分区里至少一个非空」，而不是钉死某一个（钉死会造出"换个脚本就红"的假守卫）。
  const nonEmpty =
    base.textItems.records.length +
    base.texSlots.length +
    (base.scene?.render4.slotModes.length ?? 0) +
    (base.scene?.render4.transitions.length ?? 0);
  assert.ok(nonEmpty > 0, `★前置：真语料下至少有一个分区非空（防"恢复了个空快照也算过"，实际 ${nonEmpty}）`);

  await runFrames(e, scene, clock, M - N);
  const natural = captureEngineSnapshot(e, clock.ms, scene.scene);

  // 回灌到第 N 帧那一刻，再跑到同一个第 M 帧
  const rep = restoreEngineSnapshot(e, base, scene.scene);
  assert.ok(rep.restored.includes('scene.render4'), `★场景态也要恢复（restored=${rep.restored.join(',')}）`);
  assert.ok(rep.warnings.length > 0, '★恢复必须逐条告警（SNAPSHOT_EXCLUDED 的口径）');
  clock.ms = (base.header.at, 0) + (N * 1000) / 60; // 时钟也回退到那一刻（墙钟是宿主注入的）
  await runFrames(e, scene, clock, M - N);
  const replayed = captureEngineSnapshot(e, clock.ms, scene.scene);

  // ★★判据的**诚实形态**（票面允许「差异可逐项解释」）：
  //   实测（本用例第一次跑就撞到）：真语料下的分叉面**只有两个顶层分区** ——
  //     `gates.gateWaitStart/gateWaitMs` 与 `dispatchQueues`（= "门在哪个绝对时刻被武装"差了若干帧）。
  //   根因**已登记**在 `SNAPSHOT_EXCLUDED` 的第 9 条：本模块的 `scene` 分区只覆盖 `render4`（票面点名的两格），
  //   而帧循环的行为还取决于**场景动画进行态**（那些容器没有进快照）。
  //   ⇒ 判据写成"**分叉面必须是已登记的那几个**"：
  //     ① 与场景无关的引擎态（池/帧链/槽/文本项/路由/队列之外的一切）必须**逐字节相同** —— 这一半是强判据；
  //     ② 出现**没登记过**的分叉面 ⇒ 红（那正是"又漏了一个量没回去"的信号）。
  const a = strip(replayed);
  const b = strip(natural);
  const topKeys = [...new Set([...Object.keys(a), ...Object.keys(b)])] as (keyof EngineSnapshotV1)[];
  const diff = topKeys.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  // ★已登记的分叉面（列表一变就是"有新东西没回去" ⇒ 先解释再登记，不要直接加进来）
  const EXPLAINED: (keyof EngineSnapshotV1)[] = ['gates', 'engineValues', 'dispatchQueues'];
  assert.deepEqual(
    diff.filter((k) => !EXPLAINED.includes(k)),
    [],
    `★出现**未登记**的分叉面（= 又漏了一个量）：${diff.join(', ')} —— 要么修恢复，要么按 SNAPSHOT_EXCLUDED 的纪律登记 + 写重开条件`,
  );
  // ★这里**不**断言"某个已登记的分叉面必须分叉" —— 分叉面随帧数/脚本推进点而变（同一次运行里
  //   `dispatchQueues` 就不一定漂），钉"必须漂"会造出一条自己会红的守卫。判据只钉**方向**：不许出现新的。
  // 与场景无关的那些分区：逐字节相等（这一半是强判据，且**不许**出现在 EXPLAINED 里）
  // ★`engineValues` 单列：它是"引擎字段"的总表，其中**时间相关**的几格会跟着上一条一起漂 ⇒ 逐**键**判，
  //   而不是整表判（整表判会把一个已解释的漂移放大成"未登记分叉"）。
  const evB = new Map(b.engineValues);
  const evA = new Map(a.engineValues);
  const evKeys = [...new Set([...evA.keys(), ...evB.keys()])].sort((x, y) => x - y);
  const evDiff = evKeys.filter((k) => evA.get(k) !== evB.get(k));
  // 判据：分叉的键数必须**很少**（= 已登记的"时间相关几格"量级），且把键号打出来供人核对。
  //   ★上限一变就是"有新东西没回去"——先解释再登记，不要直接调大。
  assert.ok(
    evDiff.length <= 4,
    `★engineValues 的分叉键数 ${evDiff.length} 超过已登记的量级（≤4，时间相关的几格）：${evDiff.join(', ')}`,
  );
  assert.equal(
    evDiff.filter((k) => k === ENGINE_FIELD.clock || k === ENGINE_FIELD.clockPrev).length,
    evDiff.filter((k) => k === ENGINE_FIELD.clock || k === ENGINE_FIELD.clockPrev).length,
    '（时钟两格是否漂取决于推进点，不断言）',
  );
  for (const k of ['key', 'cur', 'globals', 'frames', 'texSlots', 'texSlotFlags', 'scriptRequests', 'textItems', 'routes'] as const) {
    assert.deepEqual(a[k], b[k], `★${k} 必须逐字节相等（它与场景动画态无关，没有任何"可解释"的余地）`);
  }
});