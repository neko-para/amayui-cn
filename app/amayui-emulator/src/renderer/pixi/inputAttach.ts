/**
 * 鼠标/滚轮 → `InputManager` 的 DOM 事件桥。
 *
 * 挂在 `window` 上（而不是 canvas 上），用 `canvas.getBoundingClientRect()` 求局部坐标——
 * 比监听 canvas 更稳，避免"canvas 层事件不触发 / 坐标偏移"的常见坑。
 *
 * 坐标换算：DOM 客户区像素 → **虚拟 1280×720** 坐标（引擎的输入坐标系）。
 */
import type { InputManager } from '../../vm/input.js';
import { VIEW_H, VIEW_W } from '../viewport.js';

/** 位移/滚轮的诊断日志节流间隔（ms）——避免 mousemove 刷屏。 */
const MOVE_LOG_MS = 300;
const WHEEL_LOG_MS = 200;

export function attachMouseInput(
  canvas: HTMLCanvasElement,
  input: InputManager | undefined,
  trace: (line: string) => void,
): void {
  if (!input) return;

  const toVirtual = (clientX: number, clientY: number): [number, number] => {
    const r = canvas.getBoundingClientRect();
    const cw = r.width || VIEW_W;
    const ch = r.height || VIEW_H;
    return [Math.round(((clientX - r.left) / cw) * VIEW_W), Math.round(((clientY - r.top) / ch) * VIEW_H)];
  };

  let lastMouseLog = 0;
  const logMove = (label: string, x: number, y: number): void => {
    const now = performance.now();
    if (now - lastMouseLog > MOVE_LOG_MS) {
      lastMouseLog = now;
      trace(`[input] ${label} (${x},${y}) hasCursor=${input.hasCursor ? 1 : 0}`);
    }
  };

  window.addEventListener('mousemove', (e) => {
    const [x, y] = toVirtual(e.clientX, e.clientY);
    input.setCursor(x, y, true);
    // ★按住态按宿主真值重同步（`e.buttons` = 当前按下的键）：引擎每帧 `GetAsyncKeyState` 轮询真值，
    //   永远不会因为丢一条消息就卡在"按住"；DOM 事件流却可能丢 mouseup（指针移出窗口后松开 /
    //   窗口失焦 / Electron 不来事件）⇒ 这里用浏览器保证的真值把它拉回去（`tickets/T-0027`）。
    input.syncButtons(e.buttons);
    logMove('move', x, y);
  });

  window.addEventListener('mouseleave', () => {
    input.setCursor(-100000, -100000, false);
    trace('[input] leave');
  });

  // 失焦/隐藏：浏览器此后可能不再派发 mouseup ⇒ 先释放按钮态（回到窗口后由 mousemove 的
  // `e.buttons` 真值重建，见 `InputManager.syncButtons`）。
  window.addEventListener('blur', () => {
    input.releaseAllMouse();
    trace('[input] blur -> release');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) input.releaseAllMouse();
  });

  window.addEventListener('mousedown', (e) => {
    const [x, y] = toVirtual(e.clientX, e.clientY);
    input.setCursor(x, y, true);
    if (e.button === 0) input.pressMouse(0); // 左
    else if (e.button === 2) input.pressMouse(1); // 右
    input.syncButtons(e.buttons); // 与真值对齐（多键同按时不漏不错）
    trace(`[input] down btn=${e.button} (${x},${y})`);
  });

  window.addEventListener('mouseup', (e) => {
    // ★用 `e.buttons` 重同步（而不是只清被松开的那一个 bit）：一次丢失的 up 之后，
    //   任意一次事件都会把状态拉回真值 —— 这正是引擎"每帧轮询"的等价物（`tickets/T-0027`）。
    input.syncButtons(e.buttons);
    trace(`[input] up btn=${e.button}`);
  });

  // 滚轮：喂给 InputManager.wheelDelta（0x10D 读并清零）。
  // 方向/单位对齐引擎 WM_MOUSEWHEEL 的 `+= (short)HIWORD(wParam)`：**每格 ±120、上滚正**；
  // 而 DOM WheelEvent.deltaY 在"下滚"时为正 → 取负。
  let lastWheelLog = 0;
  window.addEventListener(
    'wheel',
    (e) => {
      const [x, y] = toVirtual(e.clientX, e.clientY);
      input.setCursor(x, y, true);
      const d = -e.deltaY;
      input.addWheel(d);
      const now = performance.now();
      if (now - lastWheelLog > WHEEL_LOG_MS) {
        lastWheelLog = now;
        trace(`[input] wheel raw=${e.deltaY} -> ${d} sum=${input.wheelDelta} (${x},${y})`);
      }
    },
    { passive: true },
  );

  // 右键需阻止默认菜单，否则点击无法作为游戏输入
  window.addEventListener('contextmenu', (e) => e.preventDefault());
}
