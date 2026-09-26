/**
 * **调试写面**（`tickets/T-0189`）：把"配置类"的脚本全局（含数组元素）在**运行期**改掉。
 *
 * 为什么需要它（用例）：ADV 侧栏（charm 表）的排布存在全局数组 `global 13b0[0..8]` 里，而
 * **默认布局里没有 SAVE/LOAD**（`src/INITCHARM.txt:6` = `[1 b c 2 3 4 5 6 7]`）、玩家排布又存在
 * SAVE.DAT 里 ⇒ "从侧栏进读档画面"这种操作脚本不该依赖玩家配置。派发是**点击时**读表
 * （`src/SN0000.txt:401`）⇒ 只要在点击前把表写死即可。
 *
 * ## 两条硬口径（与既有实现同源，**不要绕开**）
 * 1. ★**按 ENC 写**：脚本全局 int 池（`Engine.globals.int`）里存的是 `ENC(key, 值)`，读侧一律 `DEC`
 *    （`operand.ts` 的 `readIntOperand`）。只塞裸值 ⇒ 脚本读出来是垃圾。这条与
 *    `handlers/save-slot.ts` 的池装载（`pool[i] = ENC(key, pool[i])`）是同一条纪律。
 * 2. ★**只改运行期内存、不写回 `SAVE.DAT`**：写面**不**碰 `Engine.stringIndexTable`，也就不触发
 *    `onSaveDataChanged` 的落盘 ⇒ 玩家数据不被测试夹具污染（这是刻意的边界，别"顺手"补上持久化）。
 *
 * 数组在 emulator 里**就是一段连续的全局槽**（`handlers/memory.ts` 的 `lookup-array`：
 * `op1 = &op2[op3]`）⇒ `setArrayElement` = 写 `base + index`。
 */
import { dec, enc } from './bits.js';

/** 写面只需要引擎的这两样（便于单测用具名假引擎，不需要起整个 Engine）。 */
export interface WriteGlobalsEngineLike {
  /** 池加密键（`Engine.key`）。 */
  key: number;
  globals: {
    /** 脚本全局 int 池：**存的是 ENC 后的位模式**。 */
    int: Map<number, number>;
  };
}

export interface WriteResult {
  index: number;
  /** 写前的**解码值**（`undefined` = 该槽此前没写过 ⇒ 按 0 报）。 */
  prev: number;
  value: number;
}

/** 写一个脚本全局 int（按 ENC 写）。 */
export function setGlobalInt(e: WriteGlobalsEngineLike, index: number, value: number): WriteResult {
  if (!Number.isInteger(index) || index < 0) throw new Error(`setGlobalInt：下标必须是非负整数（收到 ${index}）`);
  const raw = e.globals.int.get(index);
  const prev = raw === undefined ? 0 : dec(e.key, raw);
  e.globals.int.set(index, enc(e.key, value | 0));
  return { index, prev, value: value | 0 };
}

/** 写一个**全局数组元素**（= `setGlobalInt(base + index)`；数组 = 连续全局槽）。 */
export function setGlobalIntArray(
  e: WriteGlobalsEngineLike,
  base: number,
  index: number,
  value: number,
): WriteResult {
  if (!Number.isInteger(index) || index < 0) throw new Error(`setGlobalIntArray：元素下标必须是非负整数（收到 ${index}）`);
  return setGlobalInt(e, base + index, value);
}

/**
 * 一次性把一张表写死（`values[i]` → `base + i`）。返回逐项结果，供调用方打日志/回执。
 * 用例侧就是用它把侧栏定死：`forceIntArray(e, 0x13b0, [0xd, 0xe, 1, 0xb, 0xc, 2, 3, 4, 5])`。
 */
export function forceIntArray(e: WriteGlobalsEngineLike, base: number, values: number[]): WriteResult[] {
  return values.map((v, i) => setGlobalIntArray(e, base, i, v));
}
