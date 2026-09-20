/**
 * **场景「呈现态」快照 / 还原**（`tickets/T-0063`）—— 本工程槽（`format = 0`）读档后画面为什么必须靠它。
 *
 * ★2026-09 以体订正（`tickets/T-0083`）：引擎的存档里其实有**两样**与画面有关的东西，别混成一样：
 *  ① **1000 条 20 B 的纹理槽记录表**（`Scene+0x…`；`_this[81174]` 主 / `[86174]` 影，20000 B，
 *     `sub_410160` raw 19744-19790）—— 读档按它把图重新解码进纹理槽（`sub_4559C0` + `sub_4A3800`，
 *     raw 19866-19910）。这一半 emulator 早已建模（`handlers/save-slot.ts` 的 ②b），换的是**槽里装的图**。
 *  ② **绘制项清单**（`{u32 740, u32 count, (u32 handle + 740 B 记录) × count}`，raw 19806-19832）——
 *     读档**先清空 `Scene+1032`（绘制项 map）**再逐条插回 ⇒ 换的是**画面上有哪些项**。
 *     2026-09 才接上（`vm/engineDrawItem.ts` + `native.restoreDrawItems` ⇒ `scRestoreDrawItems`）。
 *
 * 为什么 emulator 仍需要本模块的"整屏呈现态快照"：**本工程自己的槽**（`format = 0`，带状态块）
 * 装的是 emulator 口径的 `drawItems`/`meshes`/`msgWins`，不是引擎那 740 B 记录；而 ADV 场景的背景/立绘
 * 是**一次性**画出来的，续跑落点又落在 `i0ae` **之后** ⇒ 只还原帧栈/池的话画面上什么都没有
 * （`SN0000.BIN`：`i0ae` = 指令 737、存档落点 = 指令 794 ⇒ **738..793 被跳过**，而那一带正是它
 * 场景起始的背景设置 —— 指令 756/757/758 的 `mov (global-int f801d) 0` / `mov (global-int f8006) b37` /
 * `call label_0000e24c`，见 `src/SN0000.txt:1025-1027`）。引擎真槽靠 ② 那份清单把画面补回来；
 * 本工程槽没有那份清单 ⇒ 靠这里的快照。没有它，GUI 的留帧机制会继续显示上一屏
 * （2026-09 用户实测：读档后"回到标题界面"）。
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
