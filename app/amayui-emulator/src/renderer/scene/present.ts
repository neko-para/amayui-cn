/**
 * **场景「呈现态」快照 / 还原**（`tickets/T-0063`）—— 读档后画面为什么必须靠它。
 *
 * 引擎的存档里有一份**绘制/槽记录**（`_this[81174]`/`[86174]` 两张 1000×2 组 5 dword 表，共 20000 字节，
 * 见 `sub_410160` raw 19744-19790 与读档时按它逐条 `sub_4559C0` + `sub_4A3800` 重装图像的循环
 * raw 19843-19910）⇒ **读档把画面重放出来**。
 *
 * 为什么 emulator 必须有等价物：ADV 场景的背景/立绘是**一次性**画出来的（`NOVEL.BIN` 在指令 43 处
 * `draw-texture` 画背景，而它的存档落点是指令 124 —— 续跑**从入口跑到 21 的 `i0ae` 就跳过去了**；
 * `SN0000.BIN` 的入口到主循环之间一处 `draw-texture` 都没有）⇒ 只还原帧栈/池的话，读档后
 * **画面上什么都没有**，而 GUI 的留帧机制会继续显示上一屏（2026-09 用户实测：读档后"回到标题界面"）。
 *
 * 这里给出与宿主无关的**深拷贝式**快照：模型里这些表都是纯数据（数字/字符串/数组）。
 * `drawItems` 的键是 handle ⇒ 续跑脚本若重画同一个 handle 会**覆盖**而不是叠加，所以
 * "先还原快照、再让脚本继续跑"是安全的。
 */
import type { Item, MeshObj } from '../drawItem.js';
import type { TextFrame } from '../../text/layout.js';
import type { SceneState } from './state.js';

/** 呈现态快照（JSON 可序列化；存档状态块直接放它）。 */
export interface PresentSnapshot {
  drawItems: [number, Item][];
  meshes: [number, MeshObj][];
  msgWins: [number, TextFrame][];
  msgRanges: [number, { base: number; count: number }[]][];
  slotText: [number, { x: number; y: number; text: string; fill: string }[]][];
  slotModes: [number, number][];
}

/** 取快照（深拷贝；不改模型）。 */
export function scSnapshotPresent(s: SceneState): PresentSnapshot {
  return structuredClone({
    drawItems: [...s.drawItems.entries()],
    meshes: [...s.meshes.entries()],
    msgWins: [...s.msgWins.entries()],
    msgRanges: [...s.msgRanges.entries()],
    slotText: [...s.slotText.entries()],
    slotModes: [...s.render4.slotModes.entries()],
  }) satisfies PresentSnapshot;
}

/**
 * 还原快照：**先清后装**（与引擎"读档时那份记录就是画面的全部来源"一致），并把每个窗的
 * `msgRev` 递增 ⇒ 宿主会重新光栅化文本。
 */
export function scRestorePresent(s: SceneState, snap: PresentSnapshot): { drawItems: number; meshes: number; msgWins: number } {
  s.drawItems = new Map(structuredClone(snap.drawItems));
  s.meshes = new Map(structuredClone(snap.meshes));
  s.msgWins = new Map(structuredClone(snap.msgWins));
  s.msgRanges = new Map(structuredClone(snap.msgRanges));
  s.slotText = new Map(structuredClone(snap.slotText));
  s.render4.slotModes = new Map(structuredClone(snap.slotModes));
  for (const win of s.msgWins.keys()) s.msgRev.set(win, (s.msgRev.get(win) ?? 0) + 1);
  s.dirty = true;
  return { drawItems: s.drawItems.size, meshes: s.meshes.size, msgWins: s.msgWins.size };
}

/** 快照是否为空（读档时用来跳过"空快照"的还原，避免把续跑脚本刚画的东西清掉）。 */
export function scPresentIsEmpty(snap: PresentSnapshot | undefined): boolean {
  return !snap || (snap.drawItems.length === 0 && snap.meshes.length === 0 && snap.msgWins.length === 0 && snap.slotText.length === 0);
}
