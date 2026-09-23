/**
 * 输入状态管理器（emulator 侧重建模引擎输入管理器 sub_477DD0 / _this+258 的可观测语义）。
 *
 * 职责：
 *  - 保存鼠标**位置**（虚拟 1280×720 坐标，0x109 读）、鼠标**按钮**（bit0=左/bit1=右，0x108 读）、
 *    鼠标**滚轮增量**（引擎单位：上滚正/下滚负、一格 ±120；0x10D 读并清零）。
 *  - 记录"自上次消费以来**新按下**"的边沿（mouse/joy），供 get-input-type(0xCD)/0x100 派发跳转。
 *  - 保存 mouse_callback(0xCC)/joy_callback(0xFB) 注册的**跳转目标**（raw label dword 值）。
 *  - 维护输入**位掩码**（poll-input(0x101)/0x100 读）：鼠标→bit4/5、手把→bit(4+i)、键盘→bit0..6（本任务只登记）。
 *
 * 位约定（与引擎一致，见 docs-new/03-engine/input-system.md）：
 *  - 鼠标按钮值读取（0x108 走 sub_477220）：**bit0=左、bit1=右**（随 SM_SWAPBUTTON 互换，emulator 不模拟互换）。
 *  - 输入掩码帧循环约定（sub_477150 / sub_477280）：鼠标左=**bit4**、右=**bit5**；手把按钮 i=**bit(4+i)**。
 *  - 两套 bit 位置不同，请勿混用（readButtons 用 bit0/1；两把刷子 flushPending/flushHeld 生成的 mask 用 bit4/5）。
 *
 * 渲染器（PixiBackend）经 setCursor/pressMouse/releaseMouse/pressJoy 写入本对象；
 * VM 指令经 readX/readY/readButtons/flushPending/flushHeld/hasPending 读取、经 mouseSlot/mouseJump/joyJump 设跳转目标。
 */
/**
 * **可序列化的输入状态快照**（`InputManager.snapshot()`/`restore()`；`tickets/T-0005`）。
 * 字段全是"外部写入"的那些：光标/按钮/滚轮/边沿/待命中测试标记。
 */
export interface InputSnapshot {
  x: number;
  y: number;
  hasCursor: boolean;
  buttons: number;
  pressLatch: number;
  wheelDelta: number;
  /** 水平滚轮累加器（`0x2E5` 读它并清零；引擎 `_this[1950]`）。 */
  hwheelDelta: number;
  mouseEdge: number;
  joyEdge: number[];
  keyEdge: number;
  /** 键盘按住态（虚拟位 0..6；`tickets/T-0052`）。 */
  keysHeld: number;
  mouseMoved: boolean;
  hitTestPending: boolean;
  lastAdvance: number;
  touchId: number;
  inputMask: number;
}

/**
 * **宿主焦点模式**（`tickets/T-0134` 的 WS-1 冻结接口）—— 宿主/调试器对「焦点」这件事的唯一开关。
 *
 * 引擎里**没有**"窗口是否激活"这个态（`GetForegroundWindow` 全份反编译只出现一次，且不是输入轮询的门）⇒
 * 焦点在本工程里只是一条**输入生命周期的控制**：DOM blur/visibilitychange 会兜底释放按住态
 * （`tickets/T-0027`），而 `'on'`/`'off'` 让调试器显式接管这件事。
 *
 *  - `'auto'`：跟随真实 DOM 事件（现状；默认）。
 *  - `'on'`  ：视为窗口激活 —— `inputAttach` 的焦点处理器忽略宿主噪声（DSH 抢焦点 / iframe 失焦 / offscreen 无焦点）。
 *  - `'off'` ：视为窗口失焦 —— `setHostFocus` **立刻**释放全部按住态，且之后持续忽略 DOM 焦点事件。
 */
export type HostFocus = 'auto' | 'on' | 'off';

/**
 * **默认 VK → 虚拟掩码位**（引擎 Input 构造 raw 92394-92400；`tickets/T-0052`）。
 *
 * 引擎那 7 条赋值（`_this[_this[<字段>] + 1176] = <位>`）与 `sub_476AA0` 的默认 VK
 * （raw 91344-91415）合起来就是这张表：
 *
 * | 虚拟位 | VK | 键 |
 * |---|---|---|
 * | 0 | 38 | ↑ |
 * | 1 | 39 | → |
 * | 2 | 40 | ↓ |
 * | 3 | 37 | ← |
 * | 4 | 13 | Enter |
 * | 5 | 32 | Space |
 * | 6 | 8 | BackSpace |
 *
 * 其余 VK **未映射**（引擎那格是 0/-1 语义 ⇒ `mask |= 1 << 0` 会污染 ↑ 位；所以这里**返回 undefined**、
 * 不并入掩码）。`0x107`/`0x10B`/`0x10C` 那族"按键绑定"指令可以改写这张表 ⇒ 登记为缺口（见票据）。
 */
export const DEFAULT_VK_TO_BIT: ReadonlyMap<number, number> = new Map<number, number>([
  [38, 0],
  [39, 1],
  [40, 2],
  [37, 3],
  [13, 4],
  [32, 5],
  [8, 6],
]);

export class InputManager {
  /** 虚拟 X；未初始化/出窗为 -100000 */
  x = -100000;
  /** 虚拟 Y；未初始化/出窗为 -100000 */
  y = -100000;
  /** 光标是否有效（true 才返回真实坐标，否则 -100000） */
  hasCursor = false;

  /** 鼠标按钮（bit0=左、bit1=右）。0x108 读此值。 */
  buttons = 0;

  /**
   * **按下"至少被读一次"的保持位**（bit0=左、bit1=右）。
   *
   * 为什么需要：脚本的点击检测是**轮询式**的（TITLE `label_0000047c`：先看按住置 `3fb` 标记，
   * 再在松开后派发菜单）。引擎按 60fps 轮询真实 Windows 按钮态，一次几十毫秒的点击必然跨若干帧。
   * 但 emulator 的一轮 VM 批可以一次跑上万条指令，**浏览器的 down+up 可能落在同一次轮询之间**：
   * 于是"按住"从未被观察到 ⇒ `3fb` 不置位 ⇒ 菜单永不派发（表现为"点了没反应"）。
   *
   * 本字段把"按下"保持到**被读到一次为止**（读时消费，与滚轮的 `consumeWheelDelta` 同思路），
   * 从而让快速点击等价于"引擎在某一帧看到按下" —— 这是保真性措施，不是新语义。
   */
  private pressLatch = 0;

  /**
   * **鼠标滚轮增量累加器**（对位引擎 `_this[1949]` / byte 0x1E74，见 analysis/fields.json 的
   * `Engine 0x1E74 mouse_wheel_residual`）。0x10D 读它并**立即清零**（一次性消费）。
   *
   * 单位与方向（与引擎 WM_MOUSEWHEEL 的 `+= (short)HIWORD(wParam)` 对齐）：**一格 = ±120**（WHEEL_DELTA），
   * **上滚为正、下滚为负**（脚本实证：src/$3$AGENCY.txt:548 `gr (local 2b4a) (local 403) 0` → 正=上滚翻上页）。
   * 渲染器经 `addWheel()` 注入；**不用 consumeEdges() 清**——它是"读时消费"而非"按帧擦除"，
   * 否则轮询期间未读就丢（引擎里只有 0x10D 与消息泵的 ADV 分支会清零）。
   */
  wheelDelta = 0;

  /**
   * **水平滚轮增量累加器**（对位引擎 `_this[1950]` / byte 7800）。
   *
   * 引擎侧：WM_MOUSEHWHEEL(`0x20E`) 且**不在**「横滚当按键」模式（`Engine+699204 & 0x90100000 == 0`，raw 141588）
   * 时 `+= (short)HIWORD(wParam)`（raw 141610）；`0x2E5`（`sub_4310D0` raw 40342-40350）读它并**立即清零**。
   * 与竖直滚轮（`wheelDelta` = `_this[1949]`）是**两个独立的累加器**：真实脚本 `src/SAVE.txt:204-205`
   * 先 `read-mouse-wheel (local 14)` 再 `i2e5 (local 15)`，两者互不影响。
   * 单位与方向：一格 = ±120（`WHEEL_DELTA`），**右滚为正 / 左滚为负**（DOM `deltaX` 同向，不再取反）。
   */
  hwheelDelta = 0;

  // --- 按下沿（自上次消费以来新按下）---
  /** 鼠标按钮按下沿（bit0=左、bit1=右）。get-input-type(0xCD)/0x100 依此派发。 */
  mouseEdge = 0;
  /** 手把按钮按下沿（0..31 序号）。 */
  joyEdge: number[] = [];
  /**
   * 键盘键位**按下沿**（bitmask，虚拟位 0..6）—— `tickets/T-0052` 起它**真的进掩码**了
   * （修前注释写"本任务仅登记，不驱动跳转"：那时 `flushPending`/`flushHeld` 都不并它
   * ⇒ 脚本里 `joy-callback 0..4` 永远不触发、`0x100` 扫不到键盘位）。
   *
   * 引擎依据：`sub_4770A0`（raw 91551-91570）遍历 VK，`GetAsyncKeyState(vk) & 0xFF00` 命中就
   * `mask |= 1 << _this[1176+vk]`；而 `_this[1176+VK]` 由 Input 构造填成 0..6
   * （raw 92394-92400，见 `DEFAULT_VK_TO_BIT`）。
   */
  keyEdge = 0;

  /** 键盘**按住态**（虚拟位 0..6 的并集；引擎那侧由 `GetAsyncKeyState` 每帧轮询真值）。 */
  keysHeld = 0;

  /**
   * **键盘按下**（宿主 keydown → 这里）：置按下沿 + 按住态（`tickets/T-0052`）。
   *
   * @returns 是否命中映射表（未映射的 VK ⇒ `false` 且**不动任何位** —— 引擎那格没映射时
   *   `1 << 0` 会污染 ↑ 位，所以这里必须显式忽略而不是"当成位 0"）
   */
  pressKey(vk: number): boolean {
    const bit = DEFAULT_VK_TO_BIT.get(vk);
    if (bit === undefined) return false;
    this.keyEdge |= 1 << bit;
    this.keysHeld |= 1 << bit;
    return true;
  }

  /** **键盘松开**（宿主 keyup）：只清按住态（按下沿由 `consumeEdges()` 清）。 */
  releaseKey(vk: number): void {
    const bit = DEFAULT_VK_TO_BIT.get(vk);
    if (bit === undefined) return;
    this.keysHeld &= ~(1 << bit);
  }

  /** 释放全部键盘按住态（失焦/隐藏时用，与 `releaseAllMouse` 同因）。 */
  releaseAllKeys(): void {
    this.keysHeld = 0;
  }

  /** 光标位置是否"变化过"（自上次消费以来 mousemove）。get-input-type 依此派发（hover 用）。 */
  mouseMoved = false;

  /**
   * **待做的命中测试**（引擎 `sub_4B8D50` raw 140825-140836 的 WM_MOUSEMOVE）。
   *
   * 与 `mouseMoved` 的区别：`mouseMoved` 表示"自 `consumeEdges()` 以来动过"（供诊断/`hasPending`），
   * 而这一格表示**游标还没按最新位置重算过** ⇒ 等待泵（`serviceAdvanceWait`）看到它才调
   * `routes.hitTest` 并**消费**它。
   *
   * ★为什么需要它：`mouseMoved` 只在点击/键命中时被 `consumeEdges()` 清掉，等待态下会一直为真
   * ⇒ 泵会**每帧**重做命中测试（= 引擎里没有的"每帧重算"，正是规格 §E2 的那条偏差）。
   */
  hitTestPending = false;

  /**
   * **光标移动钩子**（引擎 `sub_4B8D50` raw 140825-140836，WM_MOUSEMOVE 的处理体）：
   * `if (panelA[7463] || panelA[7462]) sub_403C50(Engine+5494, x, y);`
   * `if (panelB[7464]) sub_403C50(Engine+12976, x, y);`
   *
   * ★这是**命中测试的唯一时机之一**（另一个是面板首次显示 `sub_404020`）；等待泵里没有命中测试。
   * `Engine` 在构造函数里把它接到 `routes.hitTest`（emu 侧没有 panelB，只做 panelA）。
   */
  onCursorMove?: (x: number, y: number) => void;

  // --- 回调跳转目标（raw label dword 值；-1=未注册；0xFFFFFFFF=无目标）---
  /** mouse_callback(0xCC) 的 op1（slot）。 */
  mouseSlot = -1;
  /** mouse_callback(0xCC) 的 op2（跳转 label 值）。 */
  mouseJump = -1;
  /**
   * **注册 `mouseJump` 时的脚本身份**（引擎 `Engine[107674]`，`0xCC` raw 30323 写
   * `frames[cur][95796]`）。`0xCD`（`sub_41ACD0` raw 25861）跳转前拿它与当前帧比：
   * 不等就抛 `Depth が不正です` —— **不许跨脚本派发回调 label**。
   */
  mouseJumpOwner = -1;
  /**
   * joy_callback(0xFB)：**输入掩码位**（= op1，**不偏移**；引擎 `[33*cur+107725+op1]`，raw 30417）→ 跳转 label 值。
   * ★2026-09 修：曾按 `4 + op1` 存 ⇒ 鼠标左键（掩码位 4）错派发到 `joy-callback 0`。
   */
  joyJump = new Array<number>(32).fill(-1);

  // --- 输入位掩码（poll-input/0x100 读；由两把刷子生成，见 flushPending/flushHeld）---
  inputMask = 0;

  // --- get-input-type(0xCD) 节流态（引擎 _this[429808]/[429812]）---
  /** 上次推进时刻（ms）。0xCD 据此判节流。 */
  lastAdvance = 0;
  /** 节流间隔（ms；引擎 `_this[429812]` = `Engine+107447` 计时对象的 `[6]`）。
   * ★引擎语义 = **最后一次 `mouse-callback`(0xCC) 的 op1**：`sub_453A60(obj, op1)` 写
   *   `obj[6] = op1 ? op1 : 1`（raw 66101-66113）；TITLE/CHARMEDIT 等 **29 个脚本**登记 `mouse-callback 10`（**操作数是十六进制** = 0x10）
   *   ⇒ 真机间隔 **16ms**（≈一帧），另有 **22 个**（GAMESTART/ROOM/MMODE/FIELD…）登记 `32` = 0x32 ⇒ **50ms**。旧注"全工程无写入 ⇒ 恒不节流"漏了 `sub_453A60`。
   * ⚠**emulator 现状 = 恒 0（不节流）**：这是**已知偏差**（`tickets/T-0047`）——headless 测试
   *   用冻结时钟驱动，改它必须同时改它们的时钟模型，故与本单的 0x100 修复分开做。 */
  advanceThrottle = 0;
  /** 触点标识（0x2FC 的 op5，引擎触摸项 dwID）。为 1 表示"有触点"。 */
  touchId = 0;

  // ---------- 渲染器入口 ----------

  /**
   * **宿主焦点模式**（`tickets/T-0134`）：`'auto'` = 跟随真实 DOM 事件（`inputAttach` 的
   * blur/visibilitychange 仍会兜底释放）；`'on'`/`'off'` = 调试器显式接管 —— `inputAttach` 的
   * 焦点处理器在这些模式下**忽略宿主噪声**（DSH 抢焦点 / iframe 失焦 / offscreen 无焦点）。
   *
   * ★**故意不进 `InputSnapshot`**：`hostFocus` 是**宿主/调试器状态**，不是 VM 输入状态 ——
   *   它不参与任何 opcode 读取（0x108/0x109/0x10D/0xCD… 都看不到它），也不影响任何输入的可观测值。
   *   把它记进快照会让"同一份输入状态的两次快照"因宿主模式不同而不相等，从而污染
   *   `--record`/`--replay` 的逐帧比对（录制时的焦点模式不是回放要复现的**输入**）。
   *   需要跨进程/跨会话重建它时，走调试命令 `focus <mode>`，而不是输入快照。
   */
  hostFocus: HostFocus = 'auto';

  /** 更新光标位置（虚拟坐标）。valid=false 表示出窗/未初始化。位置变化即置 mouseMoved（供 hover 派发）。
   *  ★位置**变化**时还会回调 `onCursorMove`（= 引擎 WM_MOUSEMOVE 里的 `sub_403C50` 命中测试）。 */
  setCursor(x: number, y: number, valid = true): void {
    if (valid) {
      x |= 0;
      y |= 0;
      const moved = x !== this.x || y !== this.y;
      if (moved) {
        this.mouseMoved = true;
        this.hitTestPending = true; // 等待泵消费它时做一次 sub_403C50
      }
      this.x = x;
      this.y = y;
      this.hasCursor = true;
      this.touchId = 1; // 触点存在（0x2FC op5）
      if (moved) this.onCursorMove?.(x, y);
    } else {
      this.x = -100000;
      this.y = -100000;
      this.hasCursor = false;
      this.touchId = 0;
    }
  }

  /** 鼠标按钮按下。bit：0=左、1=右。记录按钮态 + 按下沿 + "至少被读一次"保持位。 */
  pressMouse(bit: 0 | 1): void {
    this.buttons |= 1 << bit;
    this.mouseEdge |= 1 << bit;
    this.pressLatch |= 1 << bit;
  }

  /** 鼠标按钮松开。bit：0=左、1=右。只清按钮态（边沿一旦被消费就无影响）。 */
  releaseMouse(bit: 0 | 1): void {
    this.buttons &= ~(1 << bit);
  }

  /**
   * **按宿主真值重同步按住态**（`mask` = DOM `MouseEvent.buttons` 位：1=左、2=右、4=中）。
   *
   * 引擎的等价物 = 每帧 `GetAsyncKeyState` 轮询真值（第二层 `frame-pump-input-refresh`，
   * `sub_4770A0`/`sub_477150`）—— 引擎**永远不会**因为丢一条消息就卡住按住态。
   * emulator 的 `buttons` 只由 mousedown/mouseup 事件对维护，而浏览器在
   * 「指针移出窗口后松开 / 窗口失焦 / 事件不成对」时**可能不派发 mouseup**
   * ⇒ 按住态永久为 1（`releaseMouse` 是唯一清除路径）。这里借任何一次鼠标事件携带的
   * `e.buttons`（浏览器保证是**当前真值**）把它拉回去 —— 这就是"每帧轮询"的 DOM 等价物。
   */
  syncButtons(mask: number): void {
    this.buttons = ((mask & 1) !== 0 ? 1 : 0) | ((mask & 2) !== 0 ? 2 : 0);
  }

  /** 释放全部鼠标键（窗口失焦/隐藏的兜底；之后任何一次 `syncButtons` 都会按真值重建）。 */
  releaseAllMouse(): void {
    this.buttons = 0;
  }

  /**
   * **设置宿主焦点模式**（`tickets/T-0134`；调试命令 `focus <mode>` 的落点）。
   *
   * `'off'` = 调试器宣布"窗口失焦"：**立刻**执行与 DOM blur 路径（`inputAttach.handleHostBlur`）
   * **完全相同**的释放 —— `releaseAllMouse()` + `releaseAllKeys()`（`tickets/T-0027` 的兜底），
   * 之后由 `inputAttach` 的门忽略后续 DOM 焦点事件 ⇒ 释放只发生这一次、由调试器决定何时发生，
   * 而不再被宿主噪声随机触发。
   */
  setHostFocus(mode: HostFocus): void {
    this.hostFocus = mode;
    if (mode === 'off') {
      this.releaseAllMouse();
      this.releaseAllKeys();
    }
  }

  /** 手把按钮按下（0..31）。记录按下沿。 */
  pressJoy(idx: number): void {
    if (idx < 0 || idx >= 32) return;
    this.joyEdge.push(idx);
  }

  /**
   * 注入鼠标滚轮增量（渲染器 wheel 事件调用）。
   * 约定：`delta` 用**引擎单位与方向**（上滚正 / 下滚负，一格 ±120）；DOM 的 `WheelEvent.deltaY` 是反的，
   * 渲染器侧做 `-e.deltaY` 换算后再传进来。
   */
  addWheel(delta: number): void {
    // |0 截断为 32 位（引擎累加器是 int32；正常滚一格 120，不会溢出）
    this.wheelDelta = (this.wheelDelta + (delta | 0)) | 0;
  }

  /**
   * 注入**水平**滚轮增量（渲染器 wheel 事件的 `deltaX`；见 `hwheelDelta` 的说明）。
   * 方向与 DOM 一致：右滚为正、左滚为负，一格 = ±120（引擎单位）。
   */
  addHWheel(delta: number): void {
    this.hwheelDelta = (this.hwheelDelta + (delta | 0)) | 0;
  }

  // ---------- VM 读取（0x108 / 0x109）----------

  readX(): number {
    return this.hasCursor ? this.x : -100000;
  }

  readY(): number {
    return this.hasCursor ? this.y : -100000;
  }

  /**
   * 读鼠标按钮（0x108 语义）。**含"按下至少被读一次"的保持位**（读时消费，见 `pressLatch`）：
   * 保证"down+up 落在同一次 VM 轮询之间"的快速点击不会被整次丢弃 ——
   * 脚本会先读到"按下"（置自己的 debounce 标记），下一次读再看到"已松开"（触发菜单）。
   */
  readButtons(): number {
    const v = this.buttons | this.pressLatch;
    this.pressLatch = 0;
    return v;
  }

  /**
   * **读并清零**滚轮增量（0x10D 语义 = 引擎 `v2 = _this[1949]; _this[1949] = 0;`）——一次性消费。
   * 返回值：自上次读取以来累计的滚轮增量（0=期间无滚轮；上滚正 / 下滚负，一格 ±120）。
   */
  consumeWheelDelta(): number {
    const v = this.wheelDelta;
    this.wheelDelta = 0;
    return v;
  }

  /**
   * **读并清零水平滚轮增量**（`0x2E5` 语义 = 引擎 `v2 = _this[1950]; _this[1950] = 0;`，raw 40347-40348）。
   * 返回值：自上次读取以来累计的水平滚轮增量（0 = 期间没有横滚；右滚正 / 左滚负，一格 ±120）。
   */
  consumeHWheelDelta(): number {
    const v = this.hwheelDelta;
    this.hwheelDelta = 0;
    return v;
  }

  // ---------- 掩码 / 边沿 ----------

  /** 是否有待消费的输入活动（鼠标按下/移动、手把按下）。 */
  hasPending(): boolean {
    return this.mouseEdge !== 0 || this.joyEdge.length > 0 || this.mouseMoved || this.keyEdge !== 0;
  }

  /**
   * ★★**引擎有「两把刷子」，emulator 必须分开**（`tickets/T-0027`）★★
   *
   * 两把刷子共用同一套位约定（鼠标左=bit4、右=bit5；手把按钮 i=bit(4+i)），但**生命周期完全不同**：
   *
   * | 刷子 | 引擎 | 语义 | 谁用 |
   * |---|---|---|---|
   * | 消费刷 | `sub_478090`(raw 92449) | 吸取**挂起事件**（键挂起 `_this[1159]`、手把按钮挂起 `_this[1158]`、按钮累加器 `_this[1710]`），**读后清零** | 等待推进泵 `sub_411BC0`(raw 20238)、`0x101`(sub_419CC0 raw 25069)、`0xFA` 后半(raw 24983)、`sub_4053C0`(eatAllInput) |
   * | 实时刷 | `sub_4780D0`(raw 92465) | `sub_4770A0`(键盘 `GetAsyncKeyState`) + `sub_477150`(**鼠标左右键实时按住态**) + `sub_4772E0` | ADV 分支 `sub_411900`(raw 20111)、`0x100`(sub_419AF0 raw 25009 不调刷子，直接读 ADV 分支 20111 用 0D0 填好的 `_this[174802]`)、`0xFF`(raw 25004)、`0xFA` 前半(raw 24963) |
   *
   * ★`sub_478090` 的调用链里**没有** `sub_477150` ⇒ **按住左键不会每帧重新置 bit4**：
   * 一次按下 = 一次推进（鼠标挂起位由 WndProc 的 WM_LBUTTONDOWN → `sub_4B8DC0` 写、`sub_477280`
   * 消费一次即清）。等待泵若用实时刷，按住期间会**每帧**满足 `advancePressed` ⇒ 每帧翻一页
   * （用户实测："单击一次快进非常多个文案、按住就一直在输入点击"）。
   *
   * **本方法 = 消费刷**：只并「自上次消费以来新发生的事件」（`mouseEdge` / `joyEdge`），
   * **不含 `buttons`（此刻仍按着的）**。读后仍由 `consumeEdges()` 清（引擎那侧是 `*a2` 掩码位被处理时清）。
   */
  flushPending(): number {
    let m = 0;
    if ((this.mouseEdge & 1) !== 0) m |= 1 << 4; // 左（挂起事件，非按住态）
    if ((this.mouseEdge & 2) !== 0) m |= 1 << 5; // 右
    for (const i of this.joyEdge) {
      if (i < 0 || i >= 32) continue;
      m |= 1 << (4 + i);
    }
    // ★键盘按下沿（虚拟位 0..6）：引擎的消费刷 `sub_478090` 吸的就是"键挂起"（`_this[1159]`）
    //   ⇒ 这里只并**按下沿**，不含按住态（按住态归 `flushHeld`）。`tickets/T-0052`。
    m |= this.keyEdge & 0x7f;
    this.inputMask = m;
    return m;
  }

  /**
   * **实时刷**（`sub_4780D0`）：当前**按住态** + 新按下沿 + 手把按下沿。
   *
   * ★为什么仍带 `mouseEdge`：引擎的 0D0 用 `GetAsyncKeyState` 真值，而 emulator 的按钮态来自
   * DOM 事件对 —— 若 down+up 落在同一帧之间，只看 `buttons` 会把这次点击整次丢掉。
   * 带按下沿是**保真性补丁**（与 `pressLatch` 同思路），不是新语义。
   *
   * 谁用它：ADV 分支 `serviceAdv()`（含 `set:CancelMessageKey` 三态机）、`0x100` 派发、
   * `0xFF` 输入重置、`0xFA` 的「跳读中」0x40 判定。
   */
  flushHeld(): number {
    let m = 0;
    if ((this.buttons & 1) !== 0 || (this.mouseEdge & 1) !== 0) m |= 1 << 4; // 左
    if ((this.buttons & 2) !== 0 || (this.mouseEdge & 2) !== 0) m |= 1 << 5; // 右
    for (const i of this.joyEdge) {
      if (i < 0 || i >= 32) continue;
      m |= 1 << (4 + i);
    }
    // ★键盘：**按住态 + 按下沿**（与鼠标同一条"两把刷子"语义；`tickets/T-0052`）。
    //   引擎的实时刷用 `GetAsyncKeyState` 轮询真值 ⇒ 按住期间每帧都为真。
    m |= (this.keysHeld | this.keyEdge) & 0x7f;
    this.inputMask = m;
    return m;
  }

  /** 清除全部待消费的输入活动（poll-input / 已派发的输入）。
   *  保留当前按住态（buttons）与光标位置；仅清"新按下沿 + 移动标记"。 */
  consumeEdges(): void {
    this.mouseEdge = 0;
    this.joyEdge.length = 0;
    this.keyEdge = 0;
    this.mouseMoved = false;
  }

  /** 取鼠标派发目标 raw label（无按下沿或未注册 => null）。不消费边沿。 */
  pickMouseTarget(): number | null {
    if (this.mouseEdge === 0) return null;
    if (this.mouseJump === -1 || this.mouseJump === 0xffffffff) return null;
    return this.mouseJump;
  }

  // ---------- 录制 / 回放（`tickets/T-0005` 的 B5）----------

  /**
   * **输入状态快照**（可 JSON 序列化）—— `--record` 每帧取一份、`--replay` 每帧恢复一份。
   *
   * 为什么记**状态**而不是"事件流"：脚本对输入是**轮询式**读取（`0x101`/`0x108`/`0x109`/`0x10D`/`0xCD`），
   * 而 `flushPending()`/`readButtons()`/`consumeWheelDelta()` 都是**读时消费**（边沿、pressLatch、滚轮残量）。
   * 事件流要复现"哪一帧读到什么"必须精确重放消费顺序与批边界；**帧首状态**则天然对齐：
   * 回放只要每帧把头状态摆回去，这一帧的每次读取就与录制时逐次相同。
   *
   * ★**不包含**脚本自己注册的目标（`mouseSlot`/`mouseJump`/`mouseJumpOwner`/`joyJump`）：那些由
   * `0xCC`/`0xFB` 写，是**脚本状态的函数**，回放同一条脚本会自己写出来；记进来反而会掩盖"脚本走岔了"。
   */
  snapshot(): InputSnapshot {
    return {
      x: this.x,
      y: this.y,
      hasCursor: this.hasCursor,
      buttons: this.buttons,
      pressLatch: this.pressLatch,
      wheelDelta: this.wheelDelta,
      hwheelDelta: this.hwheelDelta,
      mouseEdge: this.mouseEdge,
      joyEdge: [...this.joyEdge],
      keyEdge: this.keyEdge,
      keysHeld: this.keysHeld,
      mouseMoved: this.mouseMoved,
      hitTestPending: this.hitTestPending,
      lastAdvance: this.lastAdvance,
      touchId: this.touchId,
      inputMask: this.inputMask,
    };
  }

  /**
   * 恢复一份快照。
   * ★**不触发** `onCursorMove`（那会做一次命中测试）：命中测试在引擎里只发生在 WM_MOUSEMOVE；
   * 回放时"该不该重算"由 `hitTestPending` 表达，交给等待泵消费（与录制时同一时机）。
   */
  restore(s: InputSnapshot): void {
    this.x = s.x;
    this.y = s.y;
    this.hasCursor = s.hasCursor;
    this.buttons = s.buttons;
    this.pressLatch = s.pressLatch;
    this.wheelDelta = s.wheelDelta;
    this.hwheelDelta = s.hwheelDelta;
    this.mouseEdge = s.mouseEdge;
    this.joyEdge = [...s.joyEdge];
    this.keyEdge = s.keyEdge;
    this.keysHeld = s.keysHeld ?? 0;
    this.mouseMoved = s.mouseMoved;
    this.hitTestPending = s.hitTestPending;
    this.lastAdvance = s.lastAdvance;
    this.touchId = s.touchId;
    this.inputMask = s.inputMask;
  }

  /** 取首个"已注册跳转目标"的手把按钮对应 raw label（无 => null）。不消费边沿。
   *  索引口径 = **输入掩码位**（`4 + 按钮序号`），与 `0xFB` 的写入端一致。 */
  pickJoyTarget(): number | null {
    for (const idx of this.joyEdge) {
      const t = this.joyJump[4 + idx];
      if (t !== undefined && t !== -1 && t !== 0xffffffff) return t;
    }
    return null;
  }

  /** 取最低非零位（-1=无）。用于派发扫描。 */
  lowestEdgeBit(): number {
    const mask = this.mouseEdge | this.joyEdge.reduce((a, i) => a | (1 << (4 + i)), 0);
    if (mask === 0) return -1;
    // 最低置位
    let b = 0;
    while (((mask >> b) & 1) === 0) b++;
    return b;
  }

  /**
   * get-input-type(0xCD) 的推进门（引擎 sub_41ACD0 语义）：
   * `if (now - lastAdvance >= advanceThrottle || advActive)` → 刷新 lastAdvance，返回注册的 mouseJump 目标；
   * 否则返回 null（不推进）。
   * 引擎 `_this[429812]`(throttle) = **最后一次 `mouse-callback` 的 op1**（见字段注释：真机随脚本 16ms / 50ms）；
   * emulator **当前恒 0** ⇒ 条件恒真（不节流）——已知偏差，见 `tickets/T-0047`。
   * advActive(0x8000000) 是 OR 兜底。
   * **不读取/不消费 mouse/joy 按下沿或 mouseMoved**——触发只由时间节流或 ADV 激活决定（与鼠标是否移动/按下无关）。
   * 未注册鼠标目标(==-1/0xFFFFFFFF) → 返回 null（引擎：弹返回栈、原地不跳）。
   */
  getInputType(now: number, advActive: boolean): number | null {
    if (now - this.lastAdvance >= this.advanceThrottle || advActive) {
      this.lastAdvance = now;
      const t = this.mouseJump;
      return (t === -1 || t === 0xffffffff) ? null : t;
    }
    return null;
  }
}
