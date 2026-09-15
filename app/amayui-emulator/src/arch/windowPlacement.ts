/**
 * **贴边开窗的纯几何**（由 `electron/windows.ts` 调用；`tickets/T-0040`）。
 *
 * 为什么需要：跑 E4 截图 / 录制（`npm run shot` / `npm run record`）时，主窗口每次都弹到屏幕
 * **正中**并抢焦点，反复打断手头的事。测试期把窗口摆到**屏幕下缘**（只留标题栏可见）即可安静跑完。
 *
 * ★本模块**不碰任何 Electron API**（只做矩形运算）⇒ 可以在 Node 里单测
 * （`test/window-edge.test.ts`），Electron 侧只负责把 `workArea` 递进来。
 */

/** 贴哪条边。 */
export type WindowEdge = 'bottom' | 'top' | 'left' | 'right';

/** 一个矩形（与 Electron 的 `Rectangle` 同形，但不依赖它的类型）。 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 贴边时**至少保留可见**的像素（标题栏高度量级）。
 * 太小会连标题栏都看不见（没法拖动/关闭），太大就不算"贴边"了。
 */
export const TITLEBAR_PX = 32;

/**
 * 算窗口左上角坐标：把窗口按 `edge` 摆到 `workArea` 边缘，**只留 `TITLEBAR_PX` 可见**，
 * 另一个方向居中。`workArea` 应传 Electron 的 `display.workArea`（已排除任务栏/Dock）。
 */
export function computeEdgePosition(
  workArea: Rect,
  size: { width: number; height: number },
  edge: WindowEdge,
): { x: number; y: number } {
  // 另一方向的居中（用 workArea 而非整屏 ⇒ 任务栏区域不算）
  const cx = workArea.x + Math.round((workArea.width - size.width) / 2);
  const cy = workArea.y + Math.round((workArea.height - size.height) / 2);
  const keep = Math.min(TITLEBAR_PX, size.height);
  switch (edge) {
    case 'bottom':
      return { x: cx, y: workArea.y + workArea.height - keep };
    case 'top':
      return { x: cx, y: workArea.y + keep - size.height };
    case 'left':
      return { x: workArea.x + keep - size.width, y: cy };
    case 'right':
      return { x: workArea.x + workArea.width - keep, y: cy };
  }
}

/**
 * 从环境变量 `AMAYUI_WINDOW_EDGE` 解析档位（大小写无关）：
 *  - 空 / `0` / `off` / `center` ⇒ `null` = **不贴边**（保持原来的"居中弹出"）；
 *  - `1` / `on` / `yes` / `bottom` ⇒ `'bottom'`（默认档：只留标题栏在最下缘）；
 *  - `top` / `left` / `right` ⇒ 对应的边；
 *  - 其它非空值 ⇒ 按 `'bottom'`（测试脚本写 `AMAYUI_WINDOW_EDGE=1` 就够）。
 */
export function edgeFromEnv(env: { AMAYUI_WINDOW_EDGE?: string | undefined }): WindowEdge | null {
  const v = (env.AMAYUI_WINDOW_EDGE ?? '').trim().toLowerCase();
  if (v === '' || v === '0' || v === 'off' || v === 'center' || v === 'false') return null;
  if (v === 'top' || v === 'left' || v === 'right') return v;
  return 'bottom';
}
