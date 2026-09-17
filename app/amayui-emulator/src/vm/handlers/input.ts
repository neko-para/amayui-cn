/**
 * 鼠标/键盘/手柄输入子系统 opcode（语义见 `docs/re/engine/` 输入系统篇 + src/vm/input.ts）。
 *
 * 两套 bit 位**不可混用**（见 input.ts 顶部注释）：
 *  - `readButtons()`（0x108）用 bit0=左 / bit1=右；
 *  - `flushPending()`/`flushHeld()` 生成的输入掩码用 bit4=鼠标左 / bit5=鼠标右 / bit(4+i)=手柄 i
 *    （两把刷子的取舍见 `src/vm/input.ts` 的 flushPending/flushHeld 注释与 `tickets/T-0027`）。
 */
import type { OpHandler } from '../step.js';
import { readIntOperand, writeIntOperand, operandArg, refFromOperand } from '../operand.js';
import { readRef, refAt } from '../ref.js';
import { labelPos } from './shared.js';
import { ENGINE_FIELD } from '../engineFieldIds.js';
import type { OpTable } from './shared.js';

// ---- 鼠标/输入子系统 opcodes（已读 handler 体；语义见 ../docs-new/03-engine/input-system.md）----

/** `read-mouse-button` (0x108, sub_42EDC0)：`op1 = 鼠标按钮值`。bit0=左、bit1=右（sub_477220 约定）。 */
const op_read_mouse_button: OpHandler = (c) => {
  const b = c.e.input.readButtons();
  writeIntOperand(c.e, c.frame, c.instr, 1, b);
};

/** `read-mouse-pos` (0x109, sub_42EE10)：`op1=X, op2=Y`（虚拟坐标；未初始化/出窗 = -100000）。 */
const op_read_mouse_pos: OpHandler = (c) => {
  writeIntOperand(c.e, c.frame, c.instr, 1, c.e.input.readX());
  writeIntOperand(c.e, c.frame, c.instr, 2, c.e.input.readY());
};

/**
 * `read-mouse-wheel` (0x10D, sub_42EF50)：**读鼠标滚轮增量（一次性消费）** → `op1`。
 * 引擎体（raw 39114-39122，本工程分析见 analysis/functions.json 的 op_read_mouse_wheel_42EF50）：
 *   `_this[30*cur+95805]=3;  v2 = _this[1949];  _this[1949] = 0;  writeIntOperand(1, v2);`
 * 即：取 `mouse_wheel_residual`(0x1E74) → **立即清零** → 写 op1。
 * 值语义：自上次读取以来 WM_MOUSEWHEEL 的增量累计（引擎单位：一格 ±120，**上滚正/下滚负**）。
 * 脚本用法（40+ 菜单/列表）：进入时 `read-mouse-wheel` 丢弃残量，主循环反复 `read-mouse-wheel` + `jcc (local) <翻页label>`
 *   → 非 0 即翻页；`gr (local 403) 0` 区分上/下滚（src/$3$AGENCY.txt:258/283/548）。
 * ⚠️与消息泵耦合：引擎的 ADV 推进分支（raw 13938）读同一累加器且**仅 <0（下滚）**才推进文本；
 *   脚本先 read-mouse-wheel 取走 ⇒ 累加器归零 ⇒ 泵侧不再推进（"脚本优先接管滚轮"）。
 *   emulator 的 0xCD get-input-type 走的是「时间节流/ADV 激活」而非滚轮值（见 input.getInputType 注释），
 *   故此处不做泵侧联动；若日后要让滚轮推进 ADV 文本，应在那里按 `<0` 消费。
 */
const op_read_mouse_wheel: OpHandler = (c) => {
  writeIntOperand(c.e, c.frame, c.instr, 1, c.e.input.consumeWheelDelta());
};

/**
 * `0x2E5`（`sub_4310D0` raw 40342-40350）：**读水平滚轮增量（一次性消费）→ op1**。
 *
 * 引擎体逐字：
 * ```
 * _this[30 * _this[95776] + 95805] = 3;   // 指令码
 * v2 = _this[1950];                       // byte 7800 = 水平滚轮累加器
 * _this[1950] = 0;                        // ★读后清零
 * return sub_42B4B0(_this, 1, v2);        // 写 op1
 * ```
 * 累加侧 = WndProc 的 `case 0x20E`（WM_MOUSEHWHEEL，raw 141585-141611）：**只有**在
 * `(Engine+699204 & 0x90100000) == 0`（= 没把横滚当按键用；否则走 `set:HWheelKeyUp/Down` 派发）
 * 时才 `*(_DWORD *)(dword_55E1BC + 7800) += SHIWORD(wParam)`（一格 ±120）。
 *
 * ★与 `0x10D`（竖直滚轮，`Engine[1949]` / byte 7796）是**两个独立累加器**：真脚本 `src/SAVE.txt:204-205`
 * 在同一次轮询里先 `read-mouse-wheel (local 14)`（竖直）再 `i2e5 (local 15)`（水平），
 * 随后 `jcc (local 15) label_00001f7c` 按横滚切换页 —— **跳过它会让整页横向翻页失效**（旧状态是"未实现"）。
 * 语料：`i2e5` 只出现在 `src/SAVE.txt:205/304`（存档/读档列表的横滚翻页）。
 */
const op_read_mouse_hwheel: OpHandler = (c) => {
  writeIntOperand(c.e, c.frame, c.instr, 1, c.e.input.consumeHWheelDelta());
};

/**
 * `mouse-callback` (0xCC, sub_421980)：注册鼠标跳转目标。op2=label。
 *
 * 引擎（raw 30317-30325）：
 * ```
 * Engine[107664] = read(2);                       // label
 * Engine[107674] = frames[cur][95796];            // ★注册时的脚本身份 token
 * sub_453A60(Engine+107447, read(1));             // 节流对象（op1 = 槽）
 * ```
 * `Engine[107674]` 是 `0xCD`（`sub_41ACD0` raw 25861）跳转前的**脚本身份守卫**要比对的那一格。
 *
 * ★**op1（"槽"）就是 `0xCD` 的节流间隔**（`tickets/T-0047`）：`sub_453A60(this, a2)` 写
 * `this[6] = a2 ? a2 : 1`（raw 66101-66113），而 `Engine+107447` 的 `[6]` = 字节 `429812`
 * —— 那正是 `0xCD` 读的 `_this[429812]`（raw 25842）。故"旧注：该字段全工程无写入 ⇒ 恒不节流"
 * 是**错的**：注册 `mouse-callback 10`（**十六进制** = 0x10；TITLE/CHARMEDIT/SAVE/CONFIG1 等 29 个脚本）后
 * `get-input-type` 的推进间隔是 **16ms**（≈一帧），而 GAMESTART/ROOM/MMODE/FIELD 等 22 个登记 `32` = 0x32 ⇒ **50ms**
 * （`advActive` = `0x8000000` 的 OR 短路只让 ADV 路径旁路节流）。
 */
const op_mouse_callback: OpHandler = (c) => {
  const slot = readIntOperand(c.e, c.frame, c.instr, 1);
  const target = operandArg(c.instr, 2).raw; // label 值（与 jmp/call 同尺度）
  c.e.input.mouseSlot = slot;
  c.e.input.mouseJump = target;
  c.e.input.mouseJumpOwner = c.frame.scriptId; // = Engine[107674]
  // `sub_453A60` 的 `this[6] = a2 ? a2 : 1`：槽 0 ⇒ 间隔 1ms（不是 0）；这就是 0xCD 的推进间隔。
  c.e.input.advanceThrottle = slot > 0 ? slot : 1;
};

/**
 * 0xFB (`joy_callback`, `sub_421B80` raw 30400-30419)：注册**按键跳转目标**。
 *
 * 引擎：`Engine[33*cur + 107725 + op1] = op2`（raw 30417；越界抛 `set:keyjump`）。
 * **op1 就是「输入掩码位」本身**（不是按钮序号）—— 这一点由配对读端钉死：`0x100` 的
 * `sub_419AF0`（raw 25029-25037/25042）扫掩码里最低的置位 `v6`，再查 `Engine[32*cur + 107725 + cur + v6]`
 * = `Engine[33*cur + 107725 + v6]`（同一张表、同一个索引），**中间没有任何 ±4 偏移**。
 *
 * ★2026-09 修（用户报 #1「切界面后按钮停在 hover 态」）：旧实现把 op1 当**按钮序号**存到
 * `4 + op1`，于是**鼠标左键（掩码位 4）被派发到 `joy-callback 0`** 的 handler。
 * 后果（实测）：TITLE/GAMESTART 的 `joy-callback 0` 是**行确认**处理器（`label_00000c58`
 * → `3f7 = 3f8` → `call label_000049d0`），它会把**按钮高亮贴图**（GAMESTART 的 handle `0x44c`）
 * 画到 index 0 上 ⇒ 每次点击进入一个界面，那个界面的第 0 个按钮就变成"选中/hover"外观
 * （`.tmp/amayui-emulator.log` 里能看到 `detachTexture h=0x44c` + `configureDrawItem h=0x44c (523,75,…)`
 * 而**整个 GAMESTART 期间 `0x12E` 只跑过一次**、且那次 x/y=(811,605) 在按钮框内 —— 即高亮不是命中测试画的）。
 * 引擎里鼠标左键 = 掩码位 4 ⇒ 派发的是脚本的 `joy-callback 4`（GAMESTART 的 `label_00001338`，
 * 一进去就被 `3fb != 0` 挡回，无副作用）。
 *
 * 掩码位布局（与 `InputManager.flushPending()`/`flushHeld()` 一致，见 `src/vm/input.ts` 的文件头）：
 * `0..6` = 可配置键、`4/5` = 鼠标左/右、`4+i` = 手柄按钮 i ⇒ 鼠标左键与"手柄按钮 0"**天然别名**（引擎亦然）。
 */
const op_joy_callback: OpHandler = (c) => {
  const maskBit = readIntOperand(c.e, c.frame, c.instr, 1);
  if (maskBit < 0 || maskBit >= 32) throw new Error(`joy_callback: 掩码位 ${maskBit} 越界 [0,32)`);
  const target = operandArg(c.instr, 2).raw;
  c.e.input.joyJump[maskBit] = target; // 索引 = 掩码位 = op1（引擎 raw 30417）
};

/** 0xFF (u00415A10, sub_419A90)：重置掩码并重刷当前按住态（键盘+鼠标），重置扫描游标。 */
const op_input_reset: OpHandler = (c) => {
  // 引擎（raw 24992-25006）：`_this[174802]=0; sub_4780D0(...)` ⇒ **实时刷**（含按住态）
  c.e.input.flushHeld();
};

/**
 * 0x100 (`i100`，`sub_419AF0` raw 25012-25066)：**按键跳读派发** —— 扫掩码里**最低**的置位 `b`，
 * 查 `Engine[33*cur + 107725 + b]`（由 `0xFB joy-callback` 登记）⇒ 命中则 `ip = base + 4*该值`。
 *
 * ★2026-09 订正（规格 §E10）：索引是**掩码位 `b` 本身**（`result[32*v8 + 107725 + v8 + v6]`，
 * v6 = 掩码位），**不是** `b - 4`；也**没有**"b∈{4,5} 就改用 mouseJump"的规则
 * （那是 emulator 自造的旁路）。掩码位语义（raw 91521-91524 与 25042）：`0..6` = 可配置键
 * （`sub_4770A0` 经 `_this[1176+VK]`）、`4/5` = 鼠标左/右（`sub_477150`）、`4+i` = 手柄按钮 i。
 *
 * ★扫描游标（`Engine[cur+122287]`）：emulator 用"消费边沿"近似"每个位只派发一次"
 * （`consumeEdges()`），因为刷子不保持 `Engine[699208]` 的持久掩码。
 *
 * ★★**掩码为空时派发"默认键"**（`tickets/T-0046`）★★ —— 引擎 raw 25050-25062 的 `else` 分支
 * **不是"无输入就落回"**：它取 `v4 = _this[517]`（= `SetKeyTotal`，见 0xFE）当**下标**，
 * 查同一张 `Engine[33*cur+107725+v4]` 表，命中就跳 —— 即"**没有任何键按下时跑「默认键」处理器**"。
 * 语料证据：`src/SYSTEM4.txt:86` 的 `i0fe c`（全工程唯一一处 SetKeyTotal）⇒ 默认键槽 = **12**；
 * 而菜单/界面脚本一律登记 `joy-callback 0..c`（13 个）—— 第 13 个（下标 12、不是任何物理键）
 * 就是默认键槽。例：`CHARMEDIT` 的 `joy-callback c → label_000016f0`（清"有键按住"标志 `local b`），
 * 鼠标右键关闭界面（`label_00001820` 的 `jcc (local b)`）**依赖它**；漏掉这条 ⇒ 右键永远无反应。
 * 同理扫描上界是 `[517]`（raw 25029-25037：`v6 = _this[cur+122287]`、`v7 = _this[517]`、`while (++v6 < v7)`）——
 * 下标 ≥ SetKeyTotal 的槽**不参与**掩码扫描（它们只能作为默认键被取到）。
 */
const op_input_dispatch: OpHandler = (c) => {
  // 引擎 `sub_419AF0`（0x100，raw 25009）**不调用刷子**，直接读 ADV 分支（`sub_411900` raw 20111）用
  //   `sub_4780D0` 填好的 `_this[174802]` ⇒ 掩码含**按住态**。故这里用实时刷。
  const e = c.e;
  const mask = e.input.flushHeld();
  // SetKeyTotal（0xFE 写 `Engine[517]`；引擎默认值 7 = Input 构造 `sub_477DD0` raw 92385 的 `_this[259]=7`）
  const keyTotal = e.engineValues.get(ENGINE_FIELD.setKeyTotal) ?? 7;
  let b: number;
  if (mask === 0) {
    b = keyTotal; // ★默认键槽（raw 25054 `v4 = result[517]`）
  } else {
    b = 0;
    while (b < keyTotal && ((mask >> b) & 1) === 0) b++;
    if (b >= keyTotal) return; // 只有 ≥ SetKeyTotal 的位被按下 ⇒ 引擎同样不派发
  }
  const t = e.input.joyJump[b] ?? -1; // ★索引 = 掩码位本身（不是 b-4）
  if (t === -1 || t === 0xffffffff) return;
  const p = labelPos(c.frame, t);
  if (p !== null) {
    e.input.consumeEdges();
    // ★压返回点（引擎两条分支都压 `((ip-ip_base)>>2)+1`，raw 25039-25040 / 25052）：
    //   handler 末尾的 `ret` 靠它回到**本指令之后** —— 不压就会"落进 handler 的下一句"。
    c.frame.retStack.push((c.frame.script?.instructions[c.frame.ip]?.index ?? 0) + 1);
    c.jump(p);
  }
};

/** 0x101 (poll-input, sub_419CC0)：刷掩码后复位（清待处理输入）。 */
const op_poll_input: OpHandler = (c) => {
  // 引擎 raw 25068-25074：`sub_478090(...)` 后 `*v2 = 0` ⇒ **消费刷**（挂起事件，不含按住态）
  c.e.input.flushPending();
  c.e.input.consumeEdges();
};

/** 0xCD (get-input-type, sub_41ACD0)：消息/ADV"点击推进"门。
 * 引擎：`if (now - lastAdvance >= throttle || adv_active)` 才推进（throttle=_this[429812]，adv_active=effect_flags&0x8000000）。
 * ★**throttle 真机不是 0**：它就是**最后一次 `mouse-callback`（0xCC）的 op1**（`sub_453A60` 把
 *  `Engine[107447+6]` = 字节 429812 写成 `op1 ? op1 : 1`，raw 66101-66113）；TITLE/CHARMEDIT 等
 *  都登记 `mouse-callback 10`（= 0x10）⇒ 真机推进间隔 **16ms**（登记 `32` 的脚本是 50ms）。旧注"全工程无写入 ⇒ 恒不节流"是错的；
 *  ⚠emulator 仍按 0（不节流）跑 = **已知偏差**，见 `tickets/T-0047`（改它要同步改 headless 时钟模型）。
 * 推进即：压返回地址 + CALL 注册的 mouseJump 目标（handler 的 ret 回到循环）。**不读/不消费鼠标移动或按下沿**；
 * 未注册目标(==-1/0xFFFFFFFF) → 原地不跳。emulator 旧实现"有鼠标移动/按下才触发"为错。 */
const op_get_input_type: OpHandler = (c) => {
  const input = c.e.input;
  const target = input.getInputType(c.e.nowMs, c.e.advActive);
  if (target === null) return; // 未到节流/未激活/未注册 → 不推进（也不动鼠标/手把边沿）
  // ★脚本身份守卫（引擎 raw 25861：`if (frames[cur][95796] != Engine[107674]) 抛 "Depth が不正です"`）：
  //   注册回调的脚本与当前帧不同 ⇒ **必须抛**，否则过期 label 会在当前脚本里静默命中无关指令。
  c.e.guardScriptIdentity(input.mouseJumpOwner);
  const p = labelPos(c.frame, target);
  if (p === null) return;
  // 压返回点：引擎 `sub_41ACD0` raw 25845-25849 压 `((ip-ip_base)>>2) + 1`（**dword 偏移**）。
  c.frame.retStack.push((c.frame.script?.instructions[c.frame.ip]?.index ?? 0) + 1);
  c.jump(p);
};

/**
 * 0x2FC (sub_431BA0)：读**触摸/手势触点** + 虚拟坐标。
 * 引擎：sub_477980(_this+258,&Point,&a3,&a4) 从**触摸/手势缓冲**取触点（非 GetCursorPos）→ 有触点写 op1=1、op2=虚屏X、op3=虚屏Y、
 *   op4=触点旗标(v9[4]=dwFlags)、op5=触点项[3](v9[3]=dwID)；**无触点写 op1=0**，handler 随即落回 read-mouse-pos/read-mouse-button 读**光标**。
 * emulator：只建模【鼠标光标】，**没有触摸/手势触点缓冲**；故**恒 op1=0（无触点）**——坐标/按钮由 label_0000047c 里的 read-mouse-pos/read-mouse-button
 * （读光标位置/按钮）提供，从而不误把光标当"触点按下"（引擎桌面鼠标下 0x2FC 返回 0）。 */
const op_get_mouse_state: OpHandler = (c) => {
  const im = c.e.input;
  im.touchId = 0; // 无触点（dwID=0）
  // 无触点：仅写 op1=0。坐标/按钮由后续 read-mouse-pos(光标X/Y) + read-mouse-button(按钮) 提供（TITLE label_0000047c 的 no-touch 分支）。
  // 注意：不要把「光标存在」当「触点存在」——那会误置 local 3f2=1(左键恒按下)，破坏 hover 高亮/回退。
  writeIntOperand(c.e, c.frame, c.instr, 1, 0);
  writeIntOperand(c.e, c.frame, c.instr, 2, im.readX());
  writeIntOperand(c.e, c.frame, c.instr, 3, im.readY());
  writeIntOperand(c.e, c.frame, c.instr, 4, 0); // 无触点旗标
  writeIntOperand(c.e, c.frame, c.instr, 5, 0); // 无触点 dwID
};

/**
 * 0x12E (u0041E940, sub_42F230)：鼠标悬停命中（point-in-rect），**几何完全来自脚本数据**。
 * 引擎：op2=margin 数组、op3=x、op4=y、op5=size 盒数组（每项 4 值 dx0/dx1/dy0/dy1）、op6=base X 数组、op7=base Y 数组、op8=count。
 * 逐项判定：`dx0 <= (x - baseX[i]) <= dx1 && dy0 <= (y - baseY[i]) <= dy1` → 命中项 i（写回 op1），否则 -1。
 * 实例（TITLE `u0041E940(local3f5)(local1)(local3f0)(local3f1)(localcd)(local5)(local69)(local0)`）：
 *   baseX=local5[i]、baseY=local69[i]、size=local cd/d1/d5/d9/dd（每项 [0,0x9c,0,0x9c]）、count=local0=5。
 * 说明：不在此模拟/写死任何按钮坐标；命中矩形完全由脚本的数据数组决定。
 */
const op_hover_hittest: OpHandler = (c) => {
  const x = readIntOperand(c.e, c.frame, c.instr, 3);
  const y = readIntOperand(c.e, c.frame, c.instr, 4);
  const count = readIntOperand(c.e, c.frame, c.instr, 8);
  const sizeRef = refFromOperand(c.e, c.frame, c.instr, 5); // size 盒数组
  const bxRef = refFromOperand(c.e, c.frame, c.instr, 6); // base X 数组
  const byRef = refFromOperand(c.e, c.frame, c.instr, 7); // base Y 数组
  let idx = -1;
  for (let i = 0; i < count; i++) {
    const r = i * 4;
    const dx0 = readRef(c.e, c.frame, refAt(sizeRef, r + 0));
    const dx1 = readRef(c.e, c.frame, refAt(sizeRef, r + 1));
    const dy0 = readRef(c.e, c.frame, refAt(sizeRef, r + 2));
    const dy1 = readRef(c.e, c.frame, refAt(sizeRef, r + 3));
    const bx = readRef(c.e, c.frame, refAt(bxRef, i));
    const by = readRef(c.e, c.frame, refAt(byRef, i));
    const px = x - bx;
    const py = y - by;
    if (px >= dx0 && px <= dx1 && py >= dy0 && py <= dy1) {
      idx = i;
      break;
    }
  }
  writeIntOperand(c.e, c.frame, c.instr, 1, idx);
};

/**
 * `0x10A`（`i10a`，`sub_421EA0` raw 30530-30598）：**把光标移到虚拟屏坐标 (op1 = X, op2 = Y)**。
 *
 * 引擎体（raw 30546-30597）：
 * ```
 * Point.x = readIntOperand(1); Point.y = readIntOperand(2);   // 虚拟屏坐标（与 0x109 读出的同一空间）
 * sub_498350(显示对象, &v14, &v13);                            // 取显示对象位置偏移
 * if (!Engine[167990]) {                                      // = display:ScreenMode（窗口模式才做映射）
 *     ... 按 699168/699172 的虚拟分辨率与实际尺寸算 X/Y 缩放 ...
 *     if (GetConfig(...VirtualFullScreenType)==2) { ...透视缩放... } else { Point += 偏移; }
 * }
 * ClientToScreen(hwnd, &Point);                               // 客户区 → 屏幕
 * return SetCursorPos(Point.x, Point.y);                      // ★移动系统光标
 * ```
 * ⇒ 它是 `0x109 read-mouse-pos` 的**逆**（0x109 客户区→虚拟，本指令虚拟→客户区→屏幕）。
 *
 * ★语料 1678 处，四种用途（都**不是**"存档"）：
 *  ① **ADV 侧边栏钉住/放出**（1470 处）：`i10a 4c4 (global-int 13a0)` / `i10a 479 (global-int 13a0)`
 *     —— x = 0x4c4 = 1220（栏内）或 0x479 = 1145（栏外），y = `global 13a0` = 上一行 `read-mouse-pos`
 *     刚读到的**当前光标 Y**。侧栏出现/收起时把光标钉进/钉出侧栏，避免 hover 状态机在边界抖动
 *     （`src/SC5450.txt:713-793` 的 `f7ffb` 状态机；SN0000 等 330+ 个剧情脚本同型）。
 *  ② **光标位置记忆**：`SBUNKI.txt:129-139` / `BUNKI.txt:149-159` —— 配置位（`global a9cd` bit0）开着就
 *     `i10a (local 92)(local 93)` 恢复上次位置，否则 `read-mouse-pos` 读真实位置。
 *  ③ **拖动越界回夹**：`ALLMAP.txt:531/558/583/610` 把拖出地图区的光标 `i10a (local 0)(local 1)` 按回去。
 *  ④ **对话框居中**：`SELSTAGE.txt:42` 的 `i10a 388 d3`（= (904, 211) 硬编码位置）。
 *
 * ★emulator 映射：浏览器**不能**移动真实系统光标 ⇒ 等价物是把**引擎侧光标**设为 (x, y)
 * （`InputManager.setCursor`）。可见后果与引擎一致：之后 `0x109` 读回 (x,y)，hover/`0x12E` 用新位置
 * （`setCursor` 触发 `onCursorMove` = 引擎 WM_MOUSEMOVE 里的 `sub_403C50` 命中测试 —— 而引擎的
 * `SetCursorPos` 正是靠 WM_MOUSEMOVE 让脚本看见这次移动）；位置没变则不重算（引擎同样不会产生移动消息）。
 * 真机那层虚拟→屏幕缩放只在 `display:VirtualFullScreenType == 2` 时生效（随包 INI 无此键 ⇒ 1:1）。
 * ⚠**宿主缺口**（单独一票 `tickets/T-0053`）：真实光标停在原地，玩家一动鼠标就会被 `mousemove` 覆盖回真实位置 ——
 * 浏览器/Electron 没有移动真实系统光标的 API（引擎的 `SetCursorPos` 那半件做不到），不是语义偏差：
 * 引擎侧坐标/hover 仍然生效（脚本逻辑正确），缺的是"玩家看见光标跳过去"。
 */
const op_set_mouse_pos: OpHandler = (c) => {
  const x = readIntOperand(c.e, c.frame, c.instr, 1);
  const y = readIntOperand(c.e, c.frame, c.instr, 2);
  c.e.input.setCursor(x, y, true);
};

/** 鼠标/键盘/手柄输入（真实现：读操作数 / 注册跳转目标 / 派发）。 */
export const INPUT_OPS: OpTable = [
  [0x108, op_read_mouse_button], // read-mouse-button：读鼠标按钮值 → op1
  [0x109, op_read_mouse_pos], // read-mouse-pos：读鼠标位置 → op1=X, op2=Y
  [0x10a, op_set_mouse_pos], // i10a：把光标移到虚拟坐标 (op1, op2)（0x109 的逆；ADV 侧边栏钉光标用）
  [0x10d, op_read_mouse_wheel], // read-mouse-wheel：读鼠标滚轮增量（一次性消费）→ op1
  [0x2e5, op_read_mouse_hwheel], // 读水平滚轮增量（一次性消费）→ op1（存档/读档列表的横滚翻页）
  [0xcc, op_mouse_callback],
  [0xfb, op_joy_callback],
  [0xff, op_input_reset],
  [0x100, op_input_dispatch],
  [0x101, op_poll_input],
  [0x2fc, op_get_mouse_state],
  [0xcd, op_get_input_type],
  [0x12e, op_hover_hittest], // u0041E940 悬停命中（mouse hover highlight）
];

