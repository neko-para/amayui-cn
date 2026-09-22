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
    // 引擎：GetCursorPos + ScreenToClient + sub_403C50（emu 的光标已是虚拟坐标）
    if (e.input?.hasCursor) panel.hitTest(e.input.readX(), e.input.readY());
  }
  panel.pageStep = step;
  panel.fillPending = 1;
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
 * `sub_404120`（**取游标项的 labelC 并把整表清空**）、否则走 `[7467]` 回退 label。
 * 语料 0 处（引擎里除 `0x91`/`0x92` 外没有别的写入端）⇒ emulator 只实现「置位 + showPanel」，
 * 显示态派发通路（`sub_4098E0`）**未实现**，登记为缺口。
 */
const op_panel_show: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const p = e.routes;
  if (p.closePending !== 0) {
    p.closePending = 0;
    e.engineValues.set(ENGINE_FIELD.panelResetFlag, 0);
    return;
  }
  e.effectFlags = (e.effectFlags & 0xf77fffff) | 0x800000;
  showPanel(e, (plan.int(1) ?? 0));
};

/**
 * `0x92 <step> <fallbackLabel>`（`sub_4207D0` raw 29546-29568）：同 `0x91`，但**先**写回退 label
 * `[7467] = op2`（等待泵的 `sub_4098E0` 读它：没有 enter/leave 也没有点击时派发该 label）。
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
  e.effectFlags = (e.effectFlags & 0xf77fffff) | 0x800000;
  p.fallbackLabel = (plan.int(2) ?? 0); // `[7467]`
  showPanel(e, (plan.int(1) ?? 0));
};

/** A5 的面板表面族（真实现）。 */
export const PANEL_OPS: OpTable = [
  [0x91, op_panel_show],
  [0x92, op_panel_show_fallback],
  [0x93, op_message_surface_off],
  [0x94, op_message_surface_fill],
  [0x97, op_message_surface_rect],
];

