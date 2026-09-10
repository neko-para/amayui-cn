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
 *  - 两套 bit 位置不同，请勿混用（readButtons 用 bit0/1；flush 生成的 mask 用 bit4/5）。
 *
 * 渲染器（PixiBackend）经 setCursor/pressMouse/releaseMouse/pressJoy 写入本对象；
 * VM 指令经 readX/readY/readButtons/flush/hasPending 读取、经 mouseSlot/mouseJump/joyJump 设跳转目标。
 */
export class InputManager {
  // --- 鼠标位置（虚拟坐标）---
  /** 虚拟 X；未初始化/出窗为 -100000 */
  x = -100000;
  /** 虚拟 Y；未初始化/出窗为 -100000 */
  y = -100000;
  /** 光标是否有效（true 才返回真实坐标，否则 -100000） */
  hasCursor = false;

  /** 鼠标按钮（bit0=左、bit1=右）。0x108 读此值。 */
  buttons = 0;

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

  // --- 按下沿（自上次消费以来新按下）---
  /** 鼠标按钮按下沿（bit0=左、bit1=右）。get-input-type(0xCD)/0x100 依此派发。 */
  mouseEdge = 0;
  /** 手把按钮按下沿（0..31 序号）。 */
  joyEdge: number[] = [];
  /** 键盘键位按下沿（bitmask，键位 0..6）。本任务仅登记，不驱动跳转。 */
  keyEdge = 0;

  /** 光标位置是否"变化过"（自上次消费以来 mousemove）。get-input-type 依此派发（hover 用）。 */
  mouseMoved = false;

  // --- 回调跳转目标（raw label dword 值；-1=未注册；0xFFFFFFFF=无目标）---
  /** mouse_callback(0xCC) 的 op1（slot）。 */
  mouseSlot = -1;
  /** mouse_callback(0xCC) 的 op2（跳转 label 值）。 */
  mouseJump = -1;
  /** joy_callback(0xFB)：btn(0..31) -> 跳转 label 值。 */
  joyJump = new Array<number>(32).fill(-1);

  // --- 输入位掩码（poll-input/0x100 读；由 flush() 生成）---
  inputMask = 0;

  // --- get-input-type(0xCD) 节流态（引擎 _this[429808]/[429812]）---
  /** 上次推进时刻（ms）。0xCD 据此判节流。 */
  lastAdvance = 0;
  /** 节流间隔（ms；引擎 `_this[429812]`）。**核实：该字段全工程只在 0xCD(raw 25842) 读、从无写入 → bss 初值 0**，
   *  故引擎 `_this[429812] <= (now-lastAdvance)` 恒真 → **get-input-type 实际不节流（每次调用都推进）**。
   *  emulator 旧值 200 会引入 ~200ms 输入迟滞，与引擎不一致 → 置 0。 */
  advanceThrottle = 0;
  /** 触点标识（0x2FC 的 op5，引擎触摸项 dwID）。为 1 表示"有触点"。 */
  touchId = 0;

  // ---------- 渲染器入口 ----------

  /** 更新光标位置（虚拟坐标）。valid=false 表示出窗/未初始化。位置变化即置 mouseMoved（供 hover 派发）。 */
  setCursor(x: number, y: number, valid = true): void {
    if (valid) {
      x |= 0;
      y |= 0;
      if (x !== this.x || y !== this.y) this.mouseMoved = true;
      this.x = x;
      this.y = y;
      this.hasCursor = true;
      this.touchId = 1; // 触点存在（0x2FC op5）
    } else {
      this.x = -100000;
      this.y = -100000;
      this.hasCursor = false;
      this.touchId = 0;
    }
  }

  /** 鼠标按钮按下。bit：0=左、1=右。记录按钮态 + 按下沿。 */
  pressMouse(bit: 0 | 1): void {
    this.buttons |= 1 << bit;
    this.mouseEdge |= 1 << bit;
  }

  /** 鼠标按钮松开。bit：0=左、1=右。只清按钮态（边沿一旦被消费就无影响）。 */
  releaseMouse(bit: 0 | 1): void {
    this.buttons &= ~(1 << bit);
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

  // ---------- VM 读取（0x108 / 0x109）----------

  readX(): number {
    return this.hasCursor ? this.x : -100000;
  }

  readY(): number {
    return this.hasCursor ? this.y : -100000;
  }

  readButtons(): number {
    return this.buttons;
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

  // ---------- 掩码 / 边沿 ----------

  /** 是否有待消费的输入活动（鼠标按下/移动、手把按下）。 */
  hasPending(): boolean {
    return this.mouseEdge !== 0 || this.joyEdge.length > 0 || this.mouseMoved;
  }

  /**
   * sub_478090 式 flush：把"当前按住 + 新按下沿"并入 inputMask，返回掩码。
   * 约定：鼠标左=bit4、右=bit5；手把按钮 i=bit(4+i)。不清除边沿（边沿由 consumeEdges/dispatch 消费）。
   */
  flush(): number {
    let m = 0;
    if ((this.buttons & 1) !== 0 || (this.mouseEdge & 1) !== 0) m |= 1 << 4; // 左
    if ((this.buttons & 2) !== 0 || (this.mouseEdge & 2) !== 0) m |= 1 << 5; // 右
    for (const i of this.joyEdge) {
      if (i < 0 || i >= 32) continue;
      m |= 1 << (4 + i);
    }
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

  /** 取首个"已注册跳转目标"的手把按钮对应 raw label（无 => null）。不消费边沿。 */
  pickJoyTarget(): number | null {
    for (const idx of this.joyEdge) {
      const t = this.joyJump[idx];
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
   * 引擎 `_this[429812]`(throttle) 从未写入 = 0 → 条件恒真 → **始终推进**；advActive(0x8000000) 只是 OR 兜底（实际恒真）。
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
