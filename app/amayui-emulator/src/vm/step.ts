/** 单步上下文：传递给每个 opcode handler，让 handler 既能读写引擎态，也能主动跳转下一 ip。 */
import type { Engine, Frame } from './engine.js';
import type { BinInstruction } from '../script/bin.js';
import type { NativeBridge } from './native.js';

export type OpHandler = (c: StepCtx) => void | Promise<void>;

export interface StepCtx {
  e: Engine;
  frame: Frame;
  instr: BinInstruction;
  native: NativeBridge;
  log(msg: string): void;
  /** 把下一指令 ip 设为 index；不调用则默认 frame.ip+1。传 -1 表示"控制流已转移，不再自动推进"。 */
  jump(index: number): void;
  _nextIp: number | null;
}

export function makeCtx(
  e: Engine,
  frame: Frame,
  instr: BinInstruction,
  native: NativeBridge,
  log: (m: string) => void,
): StepCtx {
  return {
    e,
    frame,
    instr,
    native,
    log,
    jump(index: number) {
      this._nextIp = index;
    },
    _nextIp: null,
  };
}
