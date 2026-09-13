/**
 * **文本项记录表族**（引擎 `Font+3364` 的 72B 记录 vector）—— 写入端 `0x1D2` + 读取端 `0x1D3`/`0x1D4`/`0x2F3`
 * + 记账开关 `0x1BB`（SetTB）。
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
 *
 * 「起始下标」越界时引擎直接返回 0 且**输出保持初值**（`0` 或 `-1/-1/0`）—— 这一点在
 * `TextItemTable.queryText/queryVoice` 里照抄。
 *
 * ## 未建模（明确记录）
 * 记录里 `+0`（窗）与 `+4..+16` 那批"文本项字形/位置"字段：引擎的 `sub_45F090` 另有一路写入
 * （`sub_45F090` raw 74360-，调用点 raw 76446/79248/81526 都在渲染层），emulator 不重放文本绘制，
 * 故只建模查询需要的 `+20/+24/+28/+32/+40`。
 */
import type { OpHandler } from '../step.js';
import { readIntOperand, writeIntOperand } from '../operand.js';
import { ITEM_TEXT } from '../textItems.js';
import type { Engine } from '../engine.js';
import type { OpTable } from './shared.js';

/** `Engine[97055]`（`Font+3364` 之外的记账开关；`0` = 记账、`0x80000000` = 暂停记账）。 */
export const TEXT_BASE_GATE = 97055;

/** 默认窗（`Font[307]`；`0x80` set-default-window 写 `Engine[21631]`）。 */
export function defaultWin(e: Engine): number {
  return e.engineValues.get(21631) ?? 0;
}

/** `i1bb 0` 期间（`Engine[97055] != 0`）不记账 —— 三个 push 点共用。 */
export function textRecordingEnabled(e: Engine): boolean {
  return (e.engineValues.get(TEXT_BASE_GATE) ?? 0) === 0;
}

/**
 * `0xC4`/`0x1BD`/`0x2F4` 的语音记录 push（`sub_45EEA0`），供音频子系统在播语音时调用。
 * `0xC4`/`0x1BD` 的实参是 `(id, loop, sel=0, Engine[5053])`；`0x2F4` 是 `(id, 0, sel=通道, Engine[5053+通道])`。
 */
export function pushVoiceRecord(e: Engine, id: number, loop: number, sel: number): void {
  if (!textRecordingEnabled(e)) return;
  e.textItems.pushVoice(defaultWin(e), id, loop, sel, e.engineValues.get(5053 + sel) ?? 0);
}

/** `0x1BB`（`sub_420000` raw 29223-29242）：**SetTB** —— 文本项记账开关。 */
const op_set_text_base: OpHandler = (c) => {
  const e = c.e;
  const v = readIntOperand(e, c.frame, c.instr, 1);
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
  const e = c.e;
  if (!textRecordingEnabled(e)) return;
  const key = readIntOperand(e, c.frame, c.instr, 1); // → 记录 +24
  const value = readIntOperand(e, c.frame, c.instr, 2); // → 记录 +20
  e.textItems.pushText(defaultWin(e), key, value);
};

/** `0x1D3`（`sub_42D4A0`）：文本项查询 → 写 op1（命中）/ op2（`+20`）。 */
const op_text_item_query: OpHandler = (c) => {
  const e = c.e;
  // 引擎实参顺序：sub_457960(Font, &out, op3, op4, op5) —— op3 未用、op4 起始下标、op5 key
  const start = readIntOperand(e, c.frame, c.instr, 4);
  const key = readIntOperand(e, c.frame, c.instr, 5);
  const r = e.textItems.queryText(start, key);
  writeIntOperand(e, c.frame, c.instr, 1, r.found ? 1 : 0);
  writeIntOperand(e, c.frame, c.instr, 2, r.v20);
};

/** `0x1D4`（`sub_42D510`）：语音项查询（选择器恒 0）→ 写 op1（`+20`）/ op2（`+24`）。 */
const op_voice_item_query0: OpHandler = (c) => {
  const e = c.e;
  // sub_457A20(Font, &a, &b, &c, op3, op4, 0)
  const start = readIntOperand(e, c.frame, c.instr, 4);
  const r = e.textItems.queryVoice(start, 0);
  writeIntOperand(e, c.frame, c.instr, 1, r.v20);
  writeIntOperand(e, c.frame, c.instr, 2, r.v24);
};

/** `0x2F3`（`sub_431A10`）：语音项查询（带选择器）→ 写 op1/op2/op3 = `+20`/`+24`/`+28`。 */
const op_voice_item_query: OpHandler = (c) => {
  const e = c.e;
  // sub_457A20(Font, &a, &b, &c, op4, op5, op6)
  const start = readIntOperand(e, c.frame, c.instr, 5);
  const sel = readIntOperand(e, c.frame, c.instr, 6);
  const r = e.textItems.queryVoice(start, sel);
  writeIntOperand(e, c.frame, c.instr, 1, r.v20);
  writeIntOperand(e, c.frame, c.instr, 2, r.v24);
  writeIntOperand(e, c.frame, c.instr, 3, r.v28);
};

/** 文本项记录表族（真实现；表模型见 `../textItems.ts`）。 */
export const TEXT_ITEM_OPS: OpTable = [
  [0x1bb, op_set_text_base], // SetTB：记账开关（0=记账 / 0x80000000=暂停；非法值抛错）
  [0x1d2, op_text_item_push], // 文本项 push（42760 处）
  [0x1d3, op_text_item_query], // 文本项查询 → op1/op2
  [0x1d4, op_voice_item_query0], // 语音项查询（选择器 0）→ op1/op2
  [0x2f3, op_voice_item_query], // 语音项查询（带选择器）→ op1/op2/op3
];

/** 供 `tests` 与音频族引用：`ITEM_TEXT` 再导出（避免两处各写常量）。 */
export { ITEM_TEXT };
