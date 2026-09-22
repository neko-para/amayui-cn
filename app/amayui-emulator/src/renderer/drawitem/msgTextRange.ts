/**
 * **消息窗正文行的 DrawItem 区间**（引擎 `FontVWindow+104/+108` 与 `+276/+280`，由 `0x213`/`0x25D` 登记）。
 *
 * ## 为什么渲染侧要单独判它（`tickets/T-0102`，2026-09 用户实测"ADV 窗口背景是白色"）
 *
 * 引擎里**屏幕上的字就是 Scene 的 DrawItem**（正文行 id = 行号 + `win+104`；`SYSTEM4.txt:58/69` 给
 * win1/win8 登记 `i213 1|8 19a28 1f4` = `[105000,105500)`）—— 也就是说，那一批 id **不是图元**，
 * 而是 GDI 把字排进窗表面之后按 id 贴出来的"行"。
 *
 * emulator 的文本另有载体（`textLayer` + `SceneState.msgWins`，见 `scene/state.ts`），所以同一批 id 上的
 * DrawItem **不能再当图元画**：它们没有纹理槽（`textures.resolve` 给 `imgid === undefined`），
 * 画出来就是 `presenter.#placeholder` 的**纯白矩形**。E4 日志里的形状正是这样：
 *
 * ```text
 * [call-script] 0x5258 -> LOADCONFIG.BIN (41 instr)
 * [present] item h=0x19a28 layer=105000 未绑定纹理槽 → 占位块   ← ×28（12+ 行）
 * ```
 *
 * ⇒ 判据：**handle 落在某窗登记的正文区间内、且该项没有绑定纹理槽** ⇒ 交给文本层画，渲染侧跳过。
 */
export function inMsgTextRange(
  ranges: Iterable<{ base: number; count: number }[]>,
  handle: number,
): boolean {
  for (const spans of ranges) {
    for (const r of spans) {
      if (r.count > 0 && handle >= r.base && handle < r.base + r.count) return true;
    }
  }
  return false;
}
