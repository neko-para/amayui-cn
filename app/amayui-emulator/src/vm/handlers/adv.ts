/**
 * ADV / 消息激活态：引擎 `effect_flags` 的 `0x8000000` 位（见 opcode-table.md 0x071/0x088/0x19B/0x19C）。
 *
 * `advActive`（= 该位）是 0xCD get-input-type 的"无条件推进"门，也是 0xC8 sleep 的跳过条件。
 * 其余字段落在 `Engine.advFields` 稀疏表里（1415 / 97050 / 97051 / 122368 / 122370 / 122455 / 122496 / 124331）。
 */
import type { OpHandler } from '../step.js';
import { readIntOperand } from '../operand.js';
import type { Engine } from '../engine.js';
import type { OpTable } from './shared.js';

// ---- ADV/消息激活态（引擎 effect_flags 的 0x8000000 位；见 opcode-table.md 0x071/0x088/0x19B/0x19C）----
const ADV_FLAG = 0x8000000;
const setAdv = (e: Engine) => void (e.effectFlags |= ADV_FLAG);
const clearAdv = (e: Engine) => void (e.effectFlags &= ~ADV_FLAG);
const advField = (e: Engine, k: number): number => e.advFields.get(k) ?? 0;

/** 0x071 (sub_41ED80) 显示消息/推进文本：进入消息态 → 置 ADV 激活。引擎在"渲染成功"时才置位；emulator 无界面渲染，简化为"显示即 ADV 激活"。 */
const op_message_show: OpHandler = (c) => {
  readIntOperand(c.e, c.frame, c.instr, 1); // 消息文本/索引（emulator 不渲染）
  setAdv(c.e);
  c.e.advFields.set(122455, 1);
  c.e.advFields.set(122496, 0);
};

/** 0x088 (sub_41FAB0) 消息显示/跳读模式：写 `_this[1415]`+全局 `_this[97050]`；非零设 122368，零清 ADV 激活。 */
const op_message_mode: OpHandler = (c) => {
  const v = readIntOperand(c.e, c.frame, c.instr, 1);
  c.e.advFields.set(1415, v);
  c.e.advFields.set(97050, v);
  if (v !== 0) c.e.advFields.set(122368, 1);
  else clearAdv(c.e);
};

/** 0x19C (sub_419120) 进入消息/ADV：按 97050 / 122455 / 124331 条件置/清 ADV 激活。 */
const op_adv_enter: OpHandler = (c) => {
  c.e.advFields.set(97051, 1);
  c.e.advFields.set(122370, 0);
  if (advField(c.e, 97050) !== 0) {
    c.e.advFields.set(1415, 1);
  } else if (advField(c.e, 122455) === 0) {
    if (advField(c.e, 124331) === 0) {
      c.e.advFields.set(1415, 0);
      clearAdv(c.e);
    }
    return;
  }
  setAdv(c.e);
  c.e.advFields.set(122368, 1);
};

/** 0x19B (sub_4190E0) 退出消息/ADV：清 ADV 激活并复位字段。 */
const op_adv_exit: OpHandler = (c) => {
  clearAdv(c.e);
  c.e.advFields.set(1415, 0);
  c.e.advFields.set(97051, 0);
  c.e.advFields.set(122370, 0);
};

/** ADV/消息激活态（置/清 effect_flags 0x8000000）。 */
export const ADV_OPS: OpTable = [
  [0x19c, op_adv_enter],
  [0x19b, op_adv_exit],
  [0x071, op_message_show],
  [0x088, op_message_mode],
];

