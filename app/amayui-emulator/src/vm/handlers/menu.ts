/**
 * 菜单派发（引擎 `_this+107679` 的字符串哈希表）。
 *
 * TITLE 用**菜单项序号**（-1/0/1/2/3/4）为键，故 0xA2/0xA3 取 op1 的 DEC 值再字符串化
 * （不能用 `readStringOperand`：它对 local-int 会返回局部下标，是既有 bug）。
 *
 * ★**这三条是纯 VM 状态，不需要宿主**：表就是 `Engine.menuMap`，查表跳转（0xA3）也在本文件里完成。
 * 旧实现在这里还 `c.native.menuReset?.()/menuBind?.()` 通知宿主一句 —— 而宿主（PixiBackend）本就没有
 * 对应子系统、方法恒缺失 ⇒ 被 `withNativeTap`（闸门 A）记成"意图被丢弃"，控制面板于是显示
 * 「menuBind/menuReset 没有实现」的**假缺口**（2026-09 用户实测）。宿主确实无事可做：
 * 菜单项由脚本自己画（`set-font`/`draw-string`），宿主只认文本/绘制指令。
 */
import type { OpHandler, StepCtx } from '../step.js';
import { operandsFor, type PlannedOperands } from '../operandPlan.js';
import { readIntOperand, readStringOperand } from '../operand.js';
import { labelPos } from './shared.js';
import type { OpTable } from './shared.js';

/**
 * 取本族的**操作数计划视图**（`tickets/T-0082` 收尾批：菜单派发族（menu），3 条）；缺计划 = 编程错误。
 */
function planFor(c: StepCtx): PlannedOperands {
  const p = operandsFor(c);
  if (!p) throw new Error(`0x${c.instr.opcode.toString(16)}：菜单派发族（menu）走操作数计划层，但没有声明计划`);
  return p;
}

/**
 * **取 `0xA2`/`0xA3` 的 op1 当"键"** —— 引擎用的是**取字符串原语** `sub_41B640(_this, 1)`
 * （raw 26249-26360），**不是**取整数原语 `sub_41BF50`：
 * ```
 * 0xA2 raw 42915   v2 = sub_41B640(_this, 1);   // 键
 * 0xA3 raw 35749   v2 = sub_41B640(_this, 1);   // 键
 * ```
 * `sub_41B640` 对**字符串族**操作数直接返回池里的原串（case 2 = 立即字面量池、case 5/11 = 全局/局部
 * 字符串槽、case 8/14 = 字符串指针所指），只对**数值族**做 `_itoa_s`/`%lf` 强转
 * （逐 case 对照表见 `src/vm/operand.ts` 的 `readStringOperand`）。
 *
 * ★修前（审计 P3 `0xa2`/`0xa3` 的 `missing-operand-io`）用的是 `String(plan.int(1) ?? 0)`：
 * 数值族下**恰好等价**（`plan.int` = `readIntOperand`，与 `_itoa_s(DEC(值))` 同串），但字符串族会走
 * `readIntOperand` 的 `atoi`/空串退路 ⇒ **键变成内容错误的十进制串**（`"menu.b"` ⇒ `0`）⇒
 * 用字符串键登记的项**永远查不中**、`0xA3` 必然落到回退 label。这里改走 `readStringOperand` 取原串。
 *
 * ★**数值族的键保持半角十进制**（= 修前口径，也是 `test/menu.test.ts`/`test/option-font-speed-menu.test.ts`
 *   钉住的口径）：引擎那侧数值族经 `sub_41A6C0` 会**全角化**（`０`/`－１`），emulator 的
 *   `readStringOperand` 也已接上全角化（`T-0165` 的在飞改动，`src/vm/operand.ts` 的 `toFullWidthNumber`）
 *   —— 但登记与派发**两侧同源**，所以"半角 vs 全角"在语料内**不可观测**（本机 941 个脚本里
 *   `menu-bind` 87 处 / `menu-dispatch` 8 处的键**全是数值族**：立即数 / `local-int` / `global-int` /
 *   `local-ptr`，**一处字符串族都没有**）。采用全角化会让 `test/menu.test.ts:36-39`（直接以 ASCII
 *   `'0'`/`'-1'` 检查 `menuMap`）变红，而那个文件不在本票可写集 ⇒ 这里**只**修字符串族（审计点名的
 *   那半边），全角化统一留给 `operand.ts` 的 owner 连带 retarget 既有断言（见 changes-c158.md §4）。
 */
const STRING_FAMILY_OPERAND_TYPES: ReadonlySet<number> = new Set([0x2, 0x5, 0x8, 0xb, 0xe]);
function keyOf(c: StepCtx): string {
  const a = c.instr.args[0];
  if (a && STRING_FAMILY_OPERAND_TYPES.has(a.type)) {
    return readStringOperand(c.e, c.frame, c.instr, 1);
  }
  return String(planFor(c).int(1) ?? 0);
}

/** 0xA1 (sub_433A40)：菜单派发表复位。`sub_415530(_this+107679, 0xFFF)` 清空菜单字符串哈希表(容量 0xFFF)。 */
const op_menu_reset: OpHandler = (c) => {
  const plan = planFor(c);
  c.e.menuMap.clear();
};

/** 0xA2 (sub_434F10 raw 42908-42917)：登记菜单项 key→label。读 op1(键，**字符串族取串**)+op2(值=目标 label)
 *  → `sub_434D00(_this+107679, key, &value)` 插入哈希表。TITLE 用菜单项序号(-1/0/1/2/3/4)为键
 *  （数值族 ⇒ `readStringOperand` 给出与引擎 `_itoa_s(DEC(值))` 同形的十进制串）。 */
const op_menu_bind: OpHandler = (c) => {
  const plan = planFor(c);
  const key = keyOf(c);
  const value = (plan.int(2) ?? 0);
  c.e.menuMap.set(key, value);
};

/**
 * 0xA3 (sub_429830 raw 35742-35758)：按 key 查表派发。
 * ```
 * raw 35748  _this[30*cur + 95805] = 5;              // 长度槽 5（argc 2）…
 * raw 35749  v2 = sub_41B640(_this, 1);              // 键（字符串族取原串）
 * raw 35750  v3 = sub_428E00(_this + 107679, v2);    // 哈希查表
 * raw 35752  命中 ⇒ ip = ip_base + 4*(*v3);          // ★**不校验目标合法性**
 * raw 35754  未命中 ⇒ ip = ip_base + 4*sub_41BF50(_this, 2);   // 回退 label（同样不校验）
 * raw 35756  _this[30*cur + 95805] = 0;              // ⇒ 派发器不再前进（ip 由本条定死）
 * ```
 *
 * ★**"目标不在 labelMap ⇒ 不跳"这条分支是 emulator 自加的**（审计 P3 `0xa3` `missing-branch`）：
 * 引擎命中/未命中都**无条件** `ip = ip_base + 4*目标`。但引擎那一步在目标不是指令边界时是**野跳**
 * （真机跑到指令中间/映像外），而 emulator 的 ip 是**指令下标**、没有"地址"可野跳 ⇒
 * 保留"什么都不做"（与 `Engine.#cancelRoute` 的 `engine.ts:1329-1334` 同一口径的**已登记偏差**），
 * 并补一条 `c.log` 让这件事**不再静默**。重开条件：若将来要把"脚本与其菜单表不一致"当硬错误，
 * 这里应改成抛错（那需要先确认真机表现）。
 */
const op_menu_dispatch: OpHandler = (c) => {
  const plan = planFor(c);
  const key = keyOf(c);
  const fallback = (plan.int(2) ?? 0);
  const hit = c.e.menuMap.get(key);
  const target = hit ?? fallback;
  const p = labelPos(c.frame, target);
  if (p === null) {
    c.log(
      `0xA3 菜单派发：${hit === undefined ? '未命中 ⇒ 回退 label' : '命中表值'} ` +
        `0x${(target >>> 0).toString(16)} 不在本帧 labelMap（引擎 raw 35752/35754 是**无条件** ` +
        `ip = ip_base + 4*目标 ⇒ 野跳；emulator 的 ip 是下标、无处野跳 ⇒ 什么都不做）`,
    );
    return;
  }
  c.jump(p);
};

/** 菜单派发（0xA1 复位 / 0xA2 登记 key→label / 0xA3 查表跳转）。 */
export const MENU_OPS: OpTable = [
  [0xa1, op_menu_reset],
  [0xa2, op_menu_bind],
  [0xa3, op_menu_dispatch],
];

