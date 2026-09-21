/**
 * **headless 宿主 → `FrameHost`**（把 `HeadlessScene` 接成帧宿主）。
 *
 * 为什么单独一个文件：两份 chain、`run.ts`、报告、Scenario 跑手、回放跑手都要"同一个 headless 宿主"。
 * 以前每处各接一遍（`advanceModel`/`poolPending`/`needsRender` 各写一行）⇒ 一处漏接就是一处漂移
 * （`T-0002` 的"chains 从不推进动画窗"就是这么来的）。现在只有这一份。
 *
 * ★它**不**提供 `present`：headless 的"合成"是出快照/被观察（`snapshot()` 清脏），不是画像素。
 * 因此驱动在 `present: 'needsRender'` 下只会调 `advanceModel`，不会调 `present`。
 */
import type { FrameHost } from '../frame/host.js';
import type { HeadlessScene } from './headlessScene.js';

/** 用一个（由调用方推进的）时钟把 headless 场景接成帧宿主。 */
export function headlessFrameHost(scene: HeadlessScene, now: () => number): FrameHost {
  const host: FrameHost = {
    now,
    // ★`opts` 必须转发（`tickets/T-0091` 的 G1）：`opts.freeze` = 引擎 `Scene+46512`，
    //   漏掉这一跳冻结就永远到不了窗模型（旧代码在这里丢掉第二参）。
    advanceModel: (t, opts) => scene.advanceModel(t, opts),
    poolPending: () => scene.poolPending(),
    needsRender: () => scene.needsRender(),
    digestState: () => scene.digestState(),
    digestHostCounters: () => scene.digestHostCounters(),
  };
  // 条件能力：只有构造时给了 `audioHost` 才转（与 `HeadlessScene.audio` 的存在性一致，
  // 否则闸门 A 记不到"宿主没有音频能力"这件事）。
  if (scene.audio) host.audio = (intent) => scene.audio!(intent);
  return host;
}
