/**
 * **文本项记录表族**（引擎 `Font+3364` 的 72B 记录 vector + `Font+3380` 的 8B 回看页 vector）
 * —— 写入端 `0x1D2` + 读取端 `0x1D3`/`0x1D4`/`0x2F3` + 记账开关 `0x1BB`（SetTB）
 * + **回看页导航读端 `0x1D0`** + **清两张表 `0x85`**（`T-0095`）。
 *
 * ## 为什么这一族必须成对实现（复评台账 A3/A7 的核心理由）
 * 引擎里「写入端」`0x1D2` 被登记成 no-op 已久，而「读取端」`0x1D3`/`0x1D4`/`0x2F3`
 * **压根没有 handler**（命中即 `NotImplementedOp`）。只做一半的后果分两种：
 *  - 只做写入端 ⇒ 表里没数据，`HISTORY`/`REPLAYVOICE` 读到空；
 *  - 只做读取端 ⇒ 表永远是空的，同样读到空。
 * 两者**同进同出**才有意义。语料规模：`i1d2` **42760 处 / 333 个脚本**（全语料最高频的未实现指令）、
 * `i1d3` 15 处 / 3 个脚本（HISTORY 10 / REPLAYVOICE 4 / CONFIG 1）、`i2f3` 2 处 / 2 个脚本、
 * `i1d4` 0 处。开关 `i1bb` 470 处 / 220 个脚本（`i1bb 0` … `i1bb 1` 成对包住"不要记账"的片段，
 * 如 `SC0000.txt:1554-1560` 的语音重播：`i1bb 0; i1cf 10001; play-voice 7c; i1bf; i1bb 1`）。
 *
 * ## 引擎实证（raw 行号 = `engine/天结_unpacked.exe_utf8.c`）
 * | opcode | handler | 语义 |
 * |---|---|---|
 * | `0x1BB` | `sub_420000` raw 29223-29242 | **SetTB**：`Engine[97055] = op1==1 ? 0 : (op1==0 ? 0x80000000 : 报错)`；非法值走 `sprintf("SetTBの引数が不正です．\r\n")` + `sub_4034D0`（抛 ShowMessage） |
 * | `0x1D2` | `sub_420380` raw 29374-29386 | **文本项 push**：**仅在 `Engine[97055] == 0` 时**执行 `sub_45EFA0(Font, 0, op1, op2)`（记录 `+24=op1`、`+20=op2`、flags `0x20000000`） |
 * | `0x1D3` | `sub_42D4A0` raw 38113-38128 | `sub_457960(Font, &v, op3, op4, op5)` ⇒ **写 op1 = 是否命中、op2 = `+20`**（op3 被调用方忽略；op4 = 起始下标、op5 = key） |
 * | `0x1D4` | `sub_42D510` raw 38131-38145 | `sub_457A20(Font, &a, &b, &c, op3, op4, 0)` ⇒ **写 op1 = `+20`、op2 = `+24`**（选择器恒 0；op3 忽略、op4 = 起始下标） |
 * | `0x2F3` | `sub_431A10` raw 40724-40741 | `sub_457A20(Font, &a, &b, &c, op4, op5, op6)` ⇒ **写 op1/op2/op3 = `+20`/`+24`/`+28`**（op4 忽略、op5 = 起始下标、op6 = 选择器） |
 * | `0x1D0` | `sub_42D440` raw 38098-38110 | **回看页索引表·带步数读出** ⇒ `sub_459860(Font, &op1, &op2, op3, 2)`：**写 op1 = 该页窗号、op2 = 该页在记录表里的起始下标**（失败 `-1/-1`；只读 op3） |
 * | `0x85` | `sub_418F50` raw 24471-24476 | **清两张表**（`sub_45EBE0` raw 74182-74194：72 B 记录表 + 8 B 回看页表 resize(0)）；不复位游标 |
 *
 * 「起始下标」越界时引擎直接返回 0 且**输出保持初值**（`0` 或 `-1/-1/0`）—— 这一点在
 * `TextItemTable.queryText/queryVoice` 里照抄。
 *
 * ## 未建模（明确记录）
 * 记录里 `+0`（窗）与 `+4..+16` 那批"文本项字形/位置"字段：引擎的 `sub_45F090` 另有一路写入
 * （`sub_45F090` raw 74360-，调用点 raw 76446/79248/81526 都在渲染层），emulator 不重放文本绘制，
 * 故只建模查询需要的 `+20/+24/+28/+32/+40`。
 */
import type { OpHandler, StepCtx } from '../step.js';
import { operandsFor, type PlannedOperands } from '../operandPlan.js';
import { readIntOperand, writeIntOperand } from '../operand.js';
import { ITEM_REFLOW, ITEM_TEXT } from '../textItems.js';
import type { Engine } from '../engine.js';
import { ENGINE_FIELD } from '../engineFieldIds.js';
import type { OpTable } from './shared.js';

/**
 * 取本族的**操作数计划视图**（`tickets/T-0082` 批次：文本项族（text-items），7 条）；缺计划 = 编程错误。
 */
function planFor(c: StepCtx): PlannedOperands {
  const p = operandsFor(c);
  if (!p) throw new Error(`0x${c.instr.opcode.toString(16)}：文本项族（text-items）走操作数计划层，但没有声明计划`);
  return p;
}


/** `Engine[97055]`（`0` = 记账、`0x80000000` = 暂停记账）。★唯一真源 = `ENGINE_FIELD.textBaseGate`。 */
export const TEXT_BASE_GATE = ENGINE_FIELD.textBaseGate;

/**
 * 默认窗（引擎 `Font+1228` = `Font[307]`）。★**唯一真源 = `MsgWindow.defaultWin`**（`tickets/T-0101` 的 D5 收敛）。
 *
 * 引擎侧三处实证：
 *  - **初值 1**：`Font` 初始化段 raw **78899** `*(_DWORD *)(_this + 1228) = 1;`（`Font` 基址 = `Engine + 21324`）；
 *  - **解析规则**：raw **73148-73152** `if (!a2) a2 = *(_DWORD *)(_this + 1228);`（`0x1D2`/`0x70`/`0x71` 族共用）；
 *  - **写点**：`0x80` set-default-window（`sub_41F690` raw 28786-28796）。
 *
 * ★**修前是双真源**（本函数的 `?? 0` vs `msgwin.defaultWin = 1`）：任何 `i080` 之后两者一致，
 * 但在 `i080` **之前**同一条 `i071 0` 压的回看页 `win = 1`、而 `i1d2` 压的记录 `win = 0`
 * —— 今天没有按窗过滤的读端所以不可观测，但一旦有就会静默错配。
 */
export function defaultWin(e: Engine): number {
  return e.msgwin.defaultWin;
}

/** `i1bb 0` 期间（`Engine[97055] != 0`）不记账 —— 三个 push 点共用。 */
function textRecordingEnabled(e: Engine): boolean {
  return (e.engineValues.get(TEXT_BASE_GATE) ?? 0) === 0;
}

/**
 * `0xC4`/`0x1BD`/`0x2F4` 的语音记录 push（`sub_45EEA0`），供音频子系统在播语音时调用。
 * `0xC4`/`0x1BD` 的实参是 `(id, loop, sel=0, Engine[5053])`；`0x2F4` 是 `(id, 0, sel=通道, Engine[5053+通道])`。
 */
export function pushVoiceRecord(e: Engine, id: number, loop: number, sel: number): void {
  if (!textRecordingEnabled(e)) return;
  e.textItems.pushVoice(defaultWin(e), id, loop, sel, e.engineValues.get(ENGINE_FIELD.voiceSelBase + sel) ?? 0);
}

/** `0x1BB`（`sub_420000` raw 29223-29242）：**SetTB** —— 文本项记账开关。 */
const op_set_text_base: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const v = (plan.int(1) ?? 0);
  if (v === 1) {
    e.engineValues.set(TEXT_BASE_GATE, 0);
    return;
  }
  if (v === 0) {
    e.engineValues.set(TEXT_BASE_GATE, 0x80000000 | 0);
    return;
  }
  // 引擎：sprintf(1024, "SetTBの引数が不正です．\r\n") → sub_4034D0（抛 ShowMessage 异常）
  throw new Error(`SetTBの引数が不正です．(i1bb ${v}：引擎只接受 0/1)`);
};

/** `0x1D2`（`sub_420380`）：文本项 push（受 `Engine[97055]` 门控）。 */
const op_text_item_push: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  if (!textRecordingEnabled(e)) return;
  const key = (plan.int(1) ?? 0); // → 记录 +24
  const value = (plan.int(2) ?? 0); // → 记录 +20
  e.textItems.pushText(defaultWin(e), key, value);
};

/** `0x1D3`（`sub_42D4A0`）：文本项查询 → 写 op1（命中）/ op2（`+20`）。 */
const op_text_item_query: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  // 引擎实参顺序：sub_457960(Font, &out, op3, op4, op5) —— op3 未用、op4 起始下标、op5 key
  const start = (plan.int(4) ?? 0);
  const key = (plan.int(5) ?? 0);
  const r = e.textItems.queryText(start, key);
  plan.setInt(1, r.found ? 1 : 0);
  plan.setInt(2, r.v20);
};

/** `0x1D4`（`sub_42D510`）：语音项查询（选择器恒 0）→ 写 op1（`+20`）/ op2（`+24`）。 */
const op_voice_item_query0: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  // sub_457A20(Font, &a, &b, &c, op3, op4, 0)
  const start = (plan.int(4) ?? 0);
  const r = e.textItems.queryVoice(start, 0);
  plan.setInt(1, r.v20);
  plan.setInt(2, r.v24);
};

/** `0x2F3`（`sub_431A10`）：语音项查询（带选择器）→ 写 op1/op2/op3 = `+20`/`+24`/`+28`。 */
const op_voice_item_query: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  // sub_457A20(Font, &a, &b, &c, op4, op5, op6)
  const start = (plan.int(5) ?? 0);
  const sel = (plan.int(6) ?? 0);
  const r = e.textItems.queryVoice(start, sel);
  plan.setInt(1, r.v20);
  plan.setInt(2, r.v24);
  plan.setInt(3, r.v28);
};

/**
 * `0x1D0`（`sub_42D440` raw 38098-38110）：**回看页索引表·带步数读出** → 写 op1/op2。
 *
 * 体原文（raw 38105-38109）：
 * ```c
 * _this[30 * _this[95776] + 95805] = 7;
 * v2 = sub_41BF50(_this, 3);                     // ★只读 op3 = 带符号相对步数
 * sub_459860(_this + 21324, &v5, &v4, v2, 2);    // Font = _this+21324(dword)；末参 2 = 常量掩码
 * sub_42B4B0((int)_this, 1, v5);                 // ★写 op1 = 该页窗号
 * return sub_42B4B0((int)_this, 2, v4);          // ★写 op2 = 该页起始记录下标
 * ```
 * ★**返回值被忽略**（不检查 `sub_459860` 的返回）⇒ 这里也不拿 `ret`。★**不改游标**。
 * 语料 5 处（`src/CONFIG.txt:22`、`HISTORY.txt:31/761/1130`、`REPLAYVOICE.txt:13`）
 * 全都是 `i1bb 0` 包住 + 步数**递减**（`sub …,1`）+ 把 op2 直接当 `i1d3` 的第 4 操作数。
 */
const op_backlog_page_at: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const step = (plan.int(3) ?? 0); // op3（raw 38106）
  const r = e.textItems.pageAt(step, ITEM_REFLOW); // 末参 2（raw 38107：字面量，非操作数）
  plan.setInt(1, r.win); // raw 38108
  plan.setInt(2, r.start); // raw 38109
};

/**
 * `0x85`（`sub_418F50` raw 24471-24476）→ `sub_45EBE0`（raw 74182-74194）：**清两张表**
 * （72 B 记录表 + 8 B 回看页表）。语料 1 处：`src/HMODE.txt:807`（每轮 H 模式重置）。
 *
 * ★`analysis/opcode-gaps.json` 对 `i85` 的旧理由（"清 GDI 文本对象的行/段容器"）**是错的**：
 * 清的就是本票的这两张 vector，纯 VM、零 GDI。★清表**不**复位游标/组首标记（见 `clearBacklog` 注释）。
 */
const op_text_tables_clear: OpHandler = (c) => {
  const plan = planFor(c);
  c.e.textItems.clearBacklog();
};

/** 文本项记录表族（真实现；表模型见 `../textItems.ts`）。 */
export const TEXT_ITEM_OPS: OpTable = [
  [0x85, op_text_tables_clear], // 清两张表（记录 + 回看页；`sub_418F50`）
  [0x1bb, op_set_text_base], // SetTB：记账开关（0=记账 / 0x80000000=暂停；非法值抛错）
  [0x1d0, op_backlog_page_at], // 回看页索引表·带步数读出 → op1（窗号）/ op2（记录起始下标）
  [0x1d2, op_text_item_push], // 文本项 push（42760 处）
  [0x1d3, op_text_item_query], // 文本项查询 → op1/op2
  [0x1d4, op_voice_item_query0], // 语音项查询（选择器 0）→ op1/op2
  [0x2f3, op_voice_item_query], // 语音项查询（带选择器）→ op1/op2/op3
];

/** 供 `tests` 与音频族引用：`ITEM_TEXT` 再导出（避免两处各写常量）。 */
export { ITEM_TEXT };
