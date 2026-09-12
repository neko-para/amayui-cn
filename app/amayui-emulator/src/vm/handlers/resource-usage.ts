/**
 * **「已使用文件」查询族**（`0x19D`）—— 2026-09 读体落地。
 *
 * ## 引擎实证
 * `0x19D` = `sub_42D8E0`（raw 38267-38285，2 操作数）：
 *
 * ```c
 * _this[帧状态槽] = 5;
 * if ((op2 & 0xFF000000) != 0) {                       // 扩展包资源（高字节 = 包号）
 *   v2 = GetConfig("set:SaveVersion1"); v3 = GetConfig("set:SaveVersion2");
 *   if (v2 < 3 || (v2 == 3 && v3 < 10)) return 写op1(0);   // 旧存档：扩展包资源一律算"未使用"
 * }
 * v6 = sub_4181F0(FileDB, op2);                        // ★查询
 * return 写op1(v6);
 * ```
 *
 * `sub_4181F0(FileDB, id)`（raw 23838-23856）读的是 **`FileDB` 的「已使用文件」哈希表**：
 *  - 本体资源：`FileDB[263]`（字节 `+1052`）这张 `DWORD[文件数]` 的槽 `[id]`；
 *  - 扩展包资源：`FileDB[(id>>24) + 3601]`（字节 `+14404 + 4*包号`）的槽 `[id & 0xFFFFFF]`；
 *  - 判据：`(uint16)槽值 == (uint16)(28569*id - 20304)` —— 表里存的是**该 id 的确定性哈希**
 *    （写入端 `sub_454960` 写 `87912345*x - 1330597712`，其低 16 位正是上式）。
 *
 * ## 谁写这张表
 * **只有 `sub_4559C0`（按统一 id 打开文件）** 会写（raw 67832/67882 两处调用点，分别对应
 * 本体分支与扩展包分支）⇒ 语义 =「**这个文件曾经被打开过**」。
 * 于是 emulator 的等价物就是 `Engine.usedFileIds`：在按统一 id 取资源的路径上打点
 * （`0x1F9` set-texture 载图、`play-bgm` 的曲号解析、脚本装载）。
 *
 * ## 为什么它决定「回想 → BGM 鉴赏」的曲目列表
 * `SETMEMOIR.BIN`（每次进回想都跑）用 `0x19D` 逐条问 `12265c[i]`（BGM 的统一文件 id，`MUINIT.BIN` 填，
 * 共 36 条非空）⇒ 把解锁曲目的下标写进 `122731`、数量写 `12272f`、百分比写 `12272e`；
 * `MMODE.BIN`（BGM 鉴赏界面）只画这些下标。**跳过 0x19D ⇒ 0 条解锁 ⇒ 列表空白**
 * （实测：36 条曲目、已解锁 0、百分比 0）。
 *
 * ## 已知缺口
 * 引擎把整张表持久化在 **`$$SAVE.DAT`**（装载 `sub_40AAE0` raw 14983+、写回 `sub_404A70`，
 * 文件头带随机密钥校验：`sub_404B20` 写 `key ^ 0x87912345`）；emulator 目前只做**会话内**
 * 打点（不读 `$$SAVE.DAT`）⇒ 全新会话的鉴赏进度从零开始累积（与真机"新档"一致，但不会继承玩家的旧档）。
 */
import type { OpHandler, StepCtx } from '../step.js';
import { readIntOperand, writeIntOperand } from '../operand.js';
import type { OpTable } from './shared.js';

/** 读配置里的整数（键统一小写，与 `parseIni` 口径一致）。 */
function cfgInt(c: StepCtx, key: string): number {
  const v = c.e.config?.values.get(key);
  if (v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n | 0 : 0;
}

/**
 * `0x19D`：`op1 ← 统一文件 id op2 是否已被打开过`（0/1）。
 * 扩展包资源（高字节 ≠ 0）在 `set:SaveVersion1 < 3`（或 `== 3` 且 `SaveVersion2 < 10`）时恒 0
 * （引擎的"旧存档不认扩展包资源"门，raw 38275-38281）。
 */
const op_file_used_query: OpHandler = (c) => {
  const id = readIntOperand(c.e, c.frame, c.instr, 2);
  if ((id & 0xff000000) !== 0) {
    const v1 = cfgInt(c, 'set:saveversion1');
    const v2 = cfgInt(c, 'set:saveversion2');
    if (v1 < 3 || (v1 === 3 && v2 < 10)) {
      writeIntOperand(c.e, c.frame, c.instr, 1, 0);
      return;
    }
  }
  writeIntOperand(c.e, c.frame, c.instr, 1, c.e.isFileUsed(id) ? 1 : 0);
};

/** 「已使用文件」查询族（纯 VM 状态，不经 NativeBridge）。 */
export const RESOURCE_USAGE_OPS: OpTable = [
  [0x19d, op_file_used_query],
];
