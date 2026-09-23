/** @tier T1 @kind core @subsystem l2d */

/**
 * `T-0054` 判据 #3 后半的守卫：**`global a9d0` 的两条支路都能跑通**（L2D / 静态贴图回落）。
 *
 * ## 口径（脚本侧，`docs-new/04-app/live2d-support-assessment.md` §2）
 * TITLE / BTL / INFOEN 在进 L2D 段之前判 `global a9d0`：**== 0 走 Live2D，!= 0 走静态贴图回落**
 * （TITLE 的回落 = `set-texture 5273 5`，即 740×700 的 `SO004A.AGF`）。`a9d0` 由 CONFIG1 写
 * （`src/CONFIG1.txt:1741-1742` 的 `sub (global-int a9d0) 1 (local-int 57bb)` + `save-int`）、
 * `INITCONFIG0` 默认 0；**引擎侧没有它的读点**（`grep a9d0` 在整个反编译产物 0 命中 ⇒ 它是纯脚本开关，
 * 引擎不需要"对应物"；emulator 只要如实执行两条支路各自的指令即可）。
 *
 * ## 为什么要在 `call-script TITLE` **那一步**置位（实测两次失败后才定下来的）
 * - 在 `bootHeadless` 之后、跑帧之前预设 `a9d0 = 1` **无效**：boot 链（`INITCONFIG0` 一脉）会把它写回 0
 *   （实测：跑完 325 帧到 TITLE 时 `global a9d0 = 0`）；
 * - 用帧级 `until: () => 脚本名 == TITLE` 也**晚了**：一帧可派发整批指令，`call-script TITLE` 与 TITLE
 *   自己的 L2D 段在同一批里跑完（实测：置 1 之后 `l2dSlots` 里已经有 `0:0x4f9e`）。
 * ⇒ 必须用**逐条**判据 `stopAfterStep`（帧循环的 per-instruction 钩子）停在"刚进 TITLE"，
 *   置位后再继续跑，TITLE 的 L2D 段才会按新值分叉。
 *
 * ## 判据
 * - `a9d0 = 0`：`l2dSlots` 有 `0:TITLE.MOC(0x4f9e)`，且**没有**槽 5 = 0x5273（回落图不出现）；
 * - `a9d0 = 1`：`l2dSlots` **空**（一条 L2D 装载都不执行），且**槽 5 = 0x5273**（静态回落支生效）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootHeadless } from '../src/tools/scenarioBoot.js';
import { runFrameLoop } from '../src/frame/loop.js';
import { dec, enc } from '../src/vm/bits.js';
import type { FrameHost } from '../src/frame/host.js';

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

const ID_TITLE_MOC = 0x4f9e;
const ID_TITLE_FALLBACK_TEX = 0x5273; // TITLE.txt:526-530 的回落支 `set-texture 5273 5`

/**
 * 跑到"刚 `call-script` 进 TITLE"，把 `a9d0` 置成 `flag`，再跑一段，返回可观察状态。
 * @param flag 0 = L2D 支（脚本原样），!= 0 = 静态贴图回落支
 */
async function runTitleBranch(flag: number): Promise<{ l2d: Array<[number, number]>; slot5: number | undefined; presetSurvived: boolean }> {
  const boot = await bootHeadless({ script: 0, audio: false, log: () => {} });
  const e = boot.e;
  // 先确认"预设无效"这条事实（boot 链会把它写回 0）
  e.globals.int.set(0xa9d0, enc(e.key, 1));
  let clock = 0;
  const host: FrameHost = {
    now: () => clock,
    advanceModel: (t) => boot.scene.advance(t),
    poolPending: () => boot.scene.poolPending(),
  };
  const opts = {
    gates: { anim: 'wait', sleep: 'wait', advance: 'force' } as const,
    advFrame: true,
    advErrors: 'swallow' as const,
    maxStepsPerFrame: 5000,
    onFrameEnd: () => {
      clock += 1000 / 60;
    },
  };
  const onTitle = (): boolean => e.curScript().name.startsWith('TITLE');
  await runFrameLoop(e, host, { ...opts, maxFrames: 1500, until: onTitle, stopAfterStep: onTitle });
  const presetSurvived = (dec(e.key, e.globals.int.get(0xa9d0) ?? 0) | 0) === 1;
  e.globals.int.set(0xa9d0, enc(e.key, flag));
  await runFrameLoop(e, host, { ...opts, maxFrames: 400 });
  const l2d = [...e.l2dSlots.entries()].map(([k, v]) => [k, v.modelId] as [number, number]);
  const slot5 = e.texSlots.get(5);
  await boot.src.dispose?.();
  return { l2d, slot5, presetSurvived };
}

test('★T-0054：`global a9d0` 两条支路都跑通 —— 0 ⇒ 装 TITLE.MOC；!= 0 ⇒ 不装 L2D、走静态贴图回落', async (t) => {
  if (!findResourceRoot()) {
    t.skip('找不到含 SYS4INI.BIN 的资源根 —— 跳过（真资产用例）');
    return;
  }
  const off = await runTitleBranch(0);
  assert.deepEqual(
    off.l2d,
    [[0, ID_TITLE_MOC]],
    'a9d0 = 0 ⇒ 必须走 L2D 支：槽 0 装 TITLE.MOC（0x4f9e）',
  );
  assert.notEqual(off.slot5, ID_TITLE_FALLBACK_TEX, 'a9d0 = 0 ⇒ 回落图 0x5273 不该被绑到槽 5');

  const on = await runTitleBranch(1);
  assert.deepEqual(on.l2d, [], 'a9d0 != 0 ⇒ 一条 L2D 装载都不执行（`l2dSlots` 必须空）');
  assert.equal(on.slot5, ID_TITLE_FALLBACK_TEX, 'a9d0 != 0 ⇒ 回落支 `set-texture 5273 5` 必须生效（槽 5 = 0x5273）');

  // ★"预设无效"这条事实也钉住：它解释了为什么守卫必须在 call-script TITLE 那一步置位
  assert.equal(
    on.presetSurvived,
    false,
    'boot 链会把 a9d0 写回 0（INITCONFIG0 一脉）⇒ 在 bootHeadless 之后预设 1 是无效的（本守卫的置位时机正因此）',
  );
});
