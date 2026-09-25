/**
 * **A5（消息面 / 面板表面）**：`0x91` / `0x92` / `0x93` / `0x94` / `0x97`。
 *
 * 这一族作用在**面板对象**上（引擎 `Engine+0x55D8`，即 `_this + 5494` 的 dword 下标，C++ 侧的
 * `CBunki`；该对象同时是点击热点/路由表的宿主，见 `../route.ts`）。它们**都不回写脚本操作数**，
 * 但改的是 emulator 里**有读者**的状态：`effect_flags` 的两个面板显示位、面板的游标/待填充/步长，
 * 以及**路由表本身**（`[258] = 条目数`）。
 *
 * ## 引擎实证（raw 行号 = `engine/天结_unpacked.exe_utf8.c`）
 * | opcode | handler | 语义 |
 * |---|---|---|
 * | `0x91` | `sub_420740` raw 29522-29543 | `[12956]` 非 0 ⇒ 清 `12956`/`12958`；否则 `effect_flags = (flags & 0xF77FFFFF) \| 0x800000` + `sub_404020(panelA, op1)`。**1 操作数** |
 * | `0x92` | `sub_4207D0` raw 29546-29568 | 同上，但**先** `[12961] = op2`（回退 label）、再 `sub_404020(panelA, op1)`。**2 操作数** |
 * | `0x93` | `sub_4191D0` raw 24589-24601 | `effect_flags &= ~0x800000` → `sub_403EF0(panelA)`（**整表清空**）→ toggle：`[12957] ? =0 : [12956]=1` |
 * | `0x94` | `sub_419230` raw 24604-24609 | `[12957] = 1`；`sub_404020(panelA, 10000)` |
 * | `0x97` | `sub_420910` raw 29596-29612 | **把输入掩码位 `op5` 绑到矩形相同的那个热点**（= `sub_403D10`）；**不是画矩形** |
 * | `0x95`/`0x96` | `sub_4204D0`/`sub_419260` | **panelB**（`Engine+0x32B0`）的同型两条；emulator 未建模 panelB（见下） |
 *
 * ## `sub_404020`（raw 10012-10030）＝ `showPanel`
 * ```
 * if (panel[7465]) { panel[960] = a2; panel[7464] = 1; }      // 已初始化：只记步长 + 待填充
 * else { panel[7465] = 1; GetCursorPos → ScreenToClient → sub_403C50(panel, x, y);
 *        panel[960] = a2; panel[7464] = 1; }                  // 首次：按**当前鼠标**重做一次命中测试
 * ```
 * ★**这是命中测试的第二个时机**（另一个是 WM_MOUSEMOVE，见 `Engine` 构造函数的订阅）；
 * 等待泵里没有命中测试。
 *
 * ## 语料用量（诚实记录）
 * - `i091`/`i092`/`i095`/`i096`/`i08d`/`i08e` 在 941 个脚本里**各 0 处** —— 面板 B / `0x800000`
 *   显示态通路是「引擎有、语料走不到」的死路（引擎里由 `0x91`/`0x92` 之外无写入端，
 *   见规格 §D.2）。emulator **不实现** panelB（`sub_409700` 与 `0x95`/`0x96`/`0x8D`/`0x8E`），
 *   缺口登记在 `analysis/engine-capabilities.json`。
 * - `i093` 有 334 处（SN0000 等 ADV 脚本的 UI 例程），`i094` 有 334 处，`i097` 有 6 处
 *   （`SN0000.txt:79-114` 的 ADV 键盘推进绑定）—— 这三条是**必须有**的。
 */
import type { OpHandler, StepCtx } from '../step.js';
import { operandsFor, type PlannedOperands } from '../operandPlan.js';
import { readIntOperand } from '../operand.js';
import { labelPos } from './shared.js';
import type { Engine } from '../engine.js';
import { ENGINE_FIELD } from '../engineFieldIds.js';
import type { OpTable } from './shared.js';

/**
 * 取本族的**操作数计划视图**（`tickets/T-0082` 批次：消息面板族（panel），5 条）；缺计划 = 编程错误。
 */
function planFor(c: StepCtx): PlannedOperands {
  const p = operandsFor(c);
  if (!p) throw new Error(`0x${c.instr.opcode.toString(16)}：消息面板族（panel）走操作数计划层，但没有声明计划`);
  return p;
}


/** 面板对象在 `_this` 里的基址（dword 下标）：`Engine+0x55D8` = `_this + 5494`。 */
export const PANEL_BASE = 5494;

/** 面板对象字段 → 引擎 dword 下标（`obj[k]` ⇒ `_this[PANEL_BASE + k]`）。 */
const F = (k: number): number => PANEL_BASE + k;

/**
 * `sub_404020`（raw 10012-10030）：**面板显示时的初始化** —— 首次按当前鼠标重做一次命中测试，
 * 然后把「步长」与「待填充」写进面板字段（`[960]`/`[7464]`），两者都落在 `RoutePanel` 上
 * （**同一份状态**，见 `vm/route.ts` 的 `PanelFieldSink`）。
 */
function showPanel(e: Engine, step: number): void {
  const panel = e.routes;
  if (panel.hitDone === 0) {
    panel.hitDone = 1;
    // 引擎 raw 10023-10026：**无条件** `GetCursorPos` + `ScreenToClient` + `sub_403C50(panel, x, y)`
    // （鼠标在窗口外也取全局坐标；命中失败就写 `[7468] = -1`）。
    // ★修前是 `if (e.input?.hasCursor) …`（审计 P3 `0x94` ×2：`approximation` + `missing-behavior`）
    //   ⇒ 无光标（鼠标出窗 / 未初始化 / headless 无输入事件）时**跳过**这次命中测试，而 `hitDone`
    //   仍被置 1 ⇒ 此后永不重做、`cursor` 停在旧值。**引擎没有这条门**。
    //   无光标时 `readX()/readY()` 返回 -100000 ⇒ `hitTest` 必然落 -1（与引擎「出窗 ⇒ 游标 -1」一致）。
    panel.hitTest(e.input.readX(), e.input.readY());
  }
  panel.pageStep = step;
  panel.fillPending = 1;
}

/**
 * **`sub_4098E0`（raw 14055-14105）＝ 面板显示态（`effect_flags & 0x800000`）的每轮泵**。
 *
 * 它**不是** `0x91`/`0x92` 的 handler 的一部分，而是主循环里与"派发一条指令"**平级**的一支：
 * ```
 * raw 21176-21208  主循环每轮：if (bit31) 等待泵; else if (0x10000000) sub_409700;
 *                             else if (v35 & 0x800000) sub_4098E0;   // ★★ 优先于指令派发
 *                             else { 派发一条指令; ip += 4*step; }
 * ```
 * `0x91`/`0x92` 的显示分支把长度槽写成 0（raw 29540/29565）⇒ `ip += 4*0` ⇒ **ip 停在本条**，
 * 于是之后每一轮都落进 `sub_4098E0`，直到它**自己**改写 ip 并清掉 `0x800000`：
 * ```
 * raw 14064  sub_478090(Input, &mask)                 // 消费刷：只吃「新按下事件」
 * raw 14065  sub_403DD0(panel, &mask)                 // ★方向键/翻页键移动游标 —— 见下方缺口
 * raw 14066  v6 = sub_403E70(panel)                   // 游标变化的悬停两段式（enter/leave）
 * raw 14068  if (v6 == -1) {
 * raw 14070      if (mask & 0x10) {                   // 左键挂起位
 * raw 14072          mask = 0;
 * raw 14073          r = sub_404120(panel)            // ★取游标项 labelC **并把整表清空**
 * raw 14074          if (r != -1) { ip = base + 4*r; 清 0x800000; }   // ★不压返回点、无 sub_4083B0
 * raw 14082      } else {
 * raw 14084          v5 = _this[12961]                // ★`0x92` 写的**回退 label**（`RoutePanel.fallbackLabel`）
 * raw 14085          if (v5 != -1) { sub_4083B0; sub_405360(_this, 0); ip = base + 4*v5; 清 0x800000; }
 * raw 14096  } else { sub_4083B0; retstack[depth++] = (ip-ip_base)>>2; ip = base + 4*v6; 清 0x800000; }
 * ```
 * 三条出口都**清 `0x800000`**；三条都不成立（无点击、无回退 label、无悬停变化）⇒ 标志仍在、
 * ip 不动 ⇒ **脚本挂起**（=「显示消息面并等玩家点击」）。
 *
 * ## emulator 的落点（为什么泵写在这里而不是帧循环）
 * `src/frame/loop.ts` / `src/vm/engine.ts` 的分支表里**没有** `0x800000` 这一支（那是"等待推进"
 * bit31 的位置）。本函数因此被 `0x91`/`0x92` 的 handler **在"显示态重入"时**调用：由于
 * `0x91`/`0x92` 显示分支走 `c.jump(-1)`（ip 停在本条），帧循环的常规批会**反复**重新进入同一条
 * 指令 ⇒ 每次重入都跑一轮本泵，直到它派发并把控制流移走。这与引擎主循环"每轮一次 `sub_4098E0`"
 * 同构（引擎那侧也是 `Sleep(0)`+`PeekMessage` 的自旋，不是一帧一次）。
 *
 * ## 未建模的两处（登记，不编消费者）
 * ① `sub_403DD0`（raw 9865-9917）：方向键/翻页键按掩码位移动 `[7468]`（用 `[960]` 步长）+ 置 `[7466]`
 *    —— emulator 的 `RoutePanel` 没有"按方向键移动游标"这条支，故此步不调用。
 * ② 悬停分支的返回点是引擎直接 push 的（没有 `sub_405360`），emulator 用 `frame.curDwordOffset`
 *    （= 本指令的 dword 偏移，由 `stepOnce` 在派发前写好）⇒ 与引擎 `(ip-ip_base)>>2` 同值。
 *
 * @returns `true` = 已改写 ip（控制流移走，`0x800000` 已清）；`false` = 仍挂起（什么都不做）。
 */
function servicePanelDisplayState(c: StepCtx): boolean {
  const e = c.e;
  const mask = e.input.flushPending(); // raw 14064：消费刷（不含按住态）
  const panel = e.routes;
  const label = panel.nextHoverLabel(); // raw 14066：sub_403E70
  const clearState = (): void => {
    e.effectFlags &= ~0x800000; // raw 14079 / 14091 / 14102
  };
  const jumpTo = (target: number, pushReturn: boolean): boolean => {
    const p = labelPos(c.frame, target);
    if (p === null) {
      // 引擎 raw 14078/14090/14101 都是**无条件** `ip = ip_base + 4*目标`；目标不是指令边界时
      // 是野跳（真机崩/跑飞）。emulator 的 ip 是**指令下标**、无处野跳 ⇒ 什么都不做并登记
      // （与 `Engine.#cancelRoute`（engine.ts:1329-1334）同一口径）。
      c.log(`0x91/0x92 显示态派发：label 0x${(target >>> 0).toString(16)} 不在本帧 labelMap（引擎此处是野跳）`);
      return false;
    }
    if (pushReturn) c.frame.retStack.push(c.frame.curDwordOffset); // = `(ip-ip_base)>>2`
    c.jump(p);
    clearState();
    return true;
  };
  if (label === -1) {
    if ((mask & 0x10) !== 0) {
      // raw 14070-14080：左键 ⇒ 提交游标项 labelC 并**清空整表**（sub_404120）；不压返回点。
      const click = panel.commitClickAndReset();
      if (click === -1) return false;
      return jumpTo(click, false);
    }
    // raw 14082-14093：无 enter/leave 也无点击 ⇒ 派发 `0x92` 的**回退 label**（`[12961]`）。
    const fb = panel.fallbackLabel;
    if (fb === -1 || fb === 0xffffffff) return false;
    e.guardScriptIdentity(panel.ownerScriptId); // raw 14087：sub_4083B0
    return jumpTo(fb, true); // raw 14089-14090：sub_405360(_this, 0)
  }
  // raw 14095-14103：悬停（enter/leave）⇒ 压返回点后派发。
  e.guardScriptIdentity(panel.ownerScriptId); // raw 14097：sub_4083B0
  return jumpTo(label, true);
}

/**
 * `0x93`（sub_4191D0 raw 24589）：清消息面显示位 + `sub_403EF0`（**清空路由表**）+ toggle `12956/12957`。
 *
 * ★`[258]` **就是路由表的条目数**（命中测试 `sub_403C50` raw 9819 用的正是它）⇒ `[258] = 0`
 * = 清空整表。旧实现只复古 `cursor`、不真清 `entries`，于是 SN0000 的 UI 例程
 * （`label_00000c74` 先 `i093` 再 `call label_00000320` 重登记）每跑一次就**追加**一批热点
 * （实测 14→33→40），旧的全屏热点（`SN0000.txt:66`）继续遮蔽新登记的一切 ⇒ 派发到过期条目。
 */
const op_message_surface_off: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  e.effectFlags &= ~0x800000;
  e.routes.reset(); // = sub_403EF0（raw 9958-9971：`[258]=0`、`[959]=-1`、`[960]=0`、`[7464]=0`、`[7466]=0`、`[7467]=-1`、`[7468]=-1`）
  // toggle：引擎 `if (_this[12957]) _this[12957] = 0; else _this[12956] = 1;`
  // （`[12956]`/`[12957]` 是面板对象**之外**的引擎字段，由 `RoutePanel` 的 sink 代管，见 route.ts）
  if (e.routes.shown !== 0) e.routes.shown = 0;
  else e.routes.closePending = 1;
};

/** `0x94`（sub_419230 raw 24604）：置「面板已显示」+ `sub_404020(panelA, 10000)`。 */
const op_message_surface_fill: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  e.routes.shown = 1; // panelA[7463]（= Engine[12957] 的同一个事实，sink 只写这一处）
  showPanel(e, 10000);
};

/**
 * `0x97 <x> <y> <w> <h> <bit>`（`sub_420910` raw 29596-29612）：**把输入掩码位绑到某个热点**。
 *
 * ```
 * v3 = read(1); v14 = read(2);
 * v2 = read(3); v3 = read(1) + v2;        // x1 = x + w
 * v4 = read(4); v5 = read(2) + v4;        // y1 = y + h
 * sub_403D10(Engine+5494, {x, y, x1, y1}, read(5));   // → 矩形四字段全等的那一项 `[7361+i] = bit`
 * ```
 *
 * ★**这不是「面板填矩形」**（`docs-new/03-engine/opcode-table.md` 的旧行是错的）：`sub_403D10`
 * （raw 9827-9844）逐项比较矩形的四个字段，全等才写 `[7361+i] = op5` —— 那是**键位绑定表**，
 * 而 `[7361+i]` 的唯一读者是 `sub_403D70`（键命中 → labelC）。
 *
 * ★语料实证（`SN0000.txt:79-114`，334 个 ADV 脚本同型）：先
 * `i090 x y 1 1 ffffffff ffffffff <labelC>` 登记一个**屏幕外**（`y = 0-0x3e8 = -1000`）1×1 热点，
 * 紧接 `i097 x y 1 1 <n>` 把掩码位 `n ∈ {0,1,2,3,8,7}` 绑上去 ⇒ 这些条目**鼠标永远命中不到**
 * （在屏幕外），只能被 `sub_403D70` 的**掩码位**命中。⇒ **这就是 ADV「键盘推进」的入口**。
 */
const op_message_surface_rect: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const x = (plan.int(1) ?? 0);
  const y = (plan.int(2) ?? 0);
  const w = (plan.int(3) ?? 0);
  const h = (plan.int(4) ?? 0);
  const bit = (plan.int(5) ?? 0);
  e.routes.bindKeyBit(x, y, x + w, y + h, bit); // sub_403D10：无全等项时引擎同样静默
};

/**
 * `0x91`（`sub_420740` raw 29522-29543）：**消息面显示态 ON**（`effect_flags |= 0x800000`）+
 * `sub_404020(panelA, op1)`；`[12956]`（关闭已发生）非 0 时只清 `12956`/`12958`（＝「已经关过了」）。
 *
 * ★`0x800000` 的**读取端**是 `sub_4098E0`（raw 14055-14105）：那里左键点击走
 * `sub_404120`（**取游标项的 labelC 并把整表清空**）、否则（无 enter/leave 也无点击）走 `[12961]`
 * 回退 label。语料 0 处（引擎里除 `0x91`/`0x92` 外没有别的写入端）。
 *
 * ★2026-09 修（`tickets/T-0158` 的 P2 ×3：`0x91` missing-consumer / `0x91`+`0x92` missing-branch /
 *   `0x92` missing-consumer）：修前本 handler 只"置位 + showPanel"就正常返回 ⇒ ① `0x800000`
 *   无人读（`sub_4098E0` 未实现）、② ip 直接被 `interpreter.stepOnce` 前进到下一条
 *   （「面板显示 = 脚本挂起」的语义丢失）、③ `RoutePanel.fallbackLabel`（= `[12961]`/`[7467]`）
 *   成为**死写**（只有写点没有读者）。现在：显示分支 `c.jump(-1)`（= 引擎长度槽写 0，
 *   raw 29540/29565 使 `ip += 4*0`）、显示态重入时跑 `servicePanelDisplayState`（= `sub_4098E0`，
 *   内含 `[12961]` 回退 label 的真实读者）⇒ 三条同时落地。
 */
const op_panel_show: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const p = e.routes;
  if (p.closePending !== 0) {
    p.closePending = 0;
    e.engineValues.set(ENGINE_FIELD.panelResetFlag, 0);
    return; // 引擎 raw 29529-29533：这一支**不写长度槽** ⇒ 槽保持 3 ⇒ ip 正常前进 3 dword
  }
  if ((e.effectFlags & 0x800000) !== 0) {
    // ★显示态重入（= 主循环 raw 21205 的 `sub_4098E0` 那一轮，**不再执行 0x91 体**）。
    if (servicePanelDisplayState(c)) return;
    c.frame.operandCount = 0; // 引擎长度槽 = 0（raw 29540）⇒ 本指令不前进
    c.jump(-1); // ip 停在本条（等下一次重入再跑一轮泵）
    return;
  }
  e.effectFlags = (e.effectFlags & 0xf77fffff) | 0x800000;
  showPanel(e, (plan.int(1) ?? 0));
  // ★raw 29539-29540：显示分支末尾把**本帧长度槽**写 0（函数入口刚写过 3 = raw 29528）
  //   ⇒ 派发器 raw 20165 `ip += 4*0` ⇒ **ip 停在本条**（阻塞等 `sub_4098E0` 派发）。
  c.frame.operandCount = 0;
  c.jump(-1);
};

/**
 * `0x92 <step> <fallbackLabel>`（`sub_4207D0` raw 29546-29568）：同 `0x91`，但**先**写回退 label
 * `[7467] = op2`（等待泵的 `sub_4098E0` 读它：没有 enter/leave 也没有点击时派发该 label）。
 *
 * ★raw 29551-29565：入口写长度槽 **5**，显示分支末尾写 **0** ⇒ 与 `0x91` 同样是"ip 停在本条"。
 */
const op_panel_show_fallback: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const p = e.routes;
  if (p.closePending !== 0) {
    p.closePending = 0;
    e.engineValues.set(ENGINE_FIELD.panelResetFlag, 0);
    return;
  }
  if ((e.effectFlags & 0x800000) !== 0) {
    if (servicePanelDisplayState(c)) return;
    c.frame.operandCount = 0;
    c.jump(-1);
    return;
  }
  e.effectFlags = (e.effectFlags & 0xf77fffff) | 0x800000;
  p.fallbackLabel = (plan.int(2) ?? 0); // `[7467]`（= `[12961]`）
  showPanel(e, (plan.int(1) ?? 0));
  c.frame.operandCount = 0; // raw 29565（入口是 5 = raw 29552）
  c.jump(-1);
};

/** A5 的面板表面族（真实现）。 */
export const PANEL_OPS: OpTable = [
  [0x91, op_panel_show],
  [0x92, op_panel_show_fallback],
  [0x93, op_message_surface_off],
  [0x94, op_message_surface_fill],
  [0x97, op_message_surface_rect],
];

