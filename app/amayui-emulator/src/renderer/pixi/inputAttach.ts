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

  // 滚轮：喂给 InputManager.wheelDelta（0x10D 读并清零）与 hwheelDelta（0x2E5 读并清零）。
  // 方向/单位对齐引擎 WM_MOUSEWHEEL 的 `+= (short)HIWORD(wParam)`：**每格 ±120、上滚正**；
  // 而 DOM WheelEvent.deltaY 在"下滚"时为正 → 取负。
  // ★水平滚轮（WM_MOUSEHWHEEL = 0x20E，raw 141585-141611）是**另一个累加器**（`Engine[1950]`）：
  //   方向与 DOM `deltaX` 同向（右滚正），不取负；存档/读档列表（`src/SAVE.txt:204-205`）用它翻页。
  let lastWheelLog = 0;
  window.addEventListener(
    'wheel',
    (e) => {
      const [x, y] = toVirtual(e.clientX, e.clientY);
      input.setCursor(x, y, true);
      const d = -e.deltaY;
      input.addWheel(d);
      if (e.deltaX) input.addHWheel(e.deltaX);
      const now = performance.now();
      if (now - lastWheelLog > WHEEL_LOG_MS) {
        lastWheelLog = now;
        trace(
          `[input] wheel raw=${e.deltaY} -> ${d} sum=${input.wheelDelta}` +
            (e.deltaX ? ` | hraw=${e.deltaX} hsum=${input.hwheelDelta}` : '') +
            ` (${x},${y})`,
        );
      }
    },
    { passive: true },
  );

  // 右键需阻止默认菜单，否则点击无法作为游戏输入
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- 键盘（`tickets/T-0052`）----
  // 引擎的实时刷 `sub_4770A0`（raw 91551-91570）**每帧**遍历 VK 真值（`GetAsyncKeyState`）填掩码
  // ⇒ DOM 侧也要"按下沿 + 按住态"两半都有，不能只记边沿（按键按住时菜单要能连续移动）。
  // 键码口径：`KeyboardEvent.keyCode` 在浏览器里就是 **Windows VK**（↑=38 / →=39 / ↓=40 / ←=37 /
  // Enter=13 / Space=32 / BackSpace=8，正是引擎 Input 构造那 7 个默认键）；`key` 只作兜底
  // （某些布局/合成事件不给 keyCode）。未映射的键 `InputManager.pressKey` 直接忽略（不动任何位）。
  const KEY_FALLBACK: Record<string, number> = {
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    ArrowLeft: 37,
    Enter: 13,
    ' ': 32,
    Backspace: 8,
  };
  const vkOf = (e: KeyboardEvent): number => {
    const kc = (e as KeyboardEvent & { keyCode?: number }).keyCode ?? 0;
    return kc !== 0 ? kc : (KEY_FALLBACK[e.key] ?? 0);
  };
  window.addEventListener('keydown', (e) => {
    // 方向键/空格/退格在页面里会滚动或触发默认行为 ⇒ 命中映射表就拦掉
    if (input.pressKey(vkOf(e))) {
      e.preventDefault();
      trace(`[input] keydown vk=${vkOf(e)} held=0x${input.keysHeld.toString(16)}`);
    }
  });
  window.addEventListener('keyup', (e) => {
    input.releaseKey(vkOf(e));
  });
  // 失焦/隐藏：浏览器此后可能不再派发 keyup ⇒ 与鼠标同样先清按住态
  window.addEventListener('blur', () => input.releaseAllKeys());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) input.releaseAllKeys();
  });
}
