/**
 * **音乐表指令族**（`0x1D6` / `0x1D7` / `0x1D8`）—— 2026-09 读体落地（含 vtable 实证）。
 *
 * ## 作用对象
 * 三条都作用在 **`Engine[698900]`** 上。该地址 = `Music` 对象（`Engine+697816`，ctor `sub_489970`）
 * 的 `[271]` 槽 —— ctor 里 `operator new(0x540)` + `sub_48D970` ⇒ **PCM 对象**
 * （vtable `0x5291FC`；反编译注释 `// 5291FC: using_guessed_type_void__PCM___vftable_;`。
 * vtable 表数据在三份镜像（`raw/AGE.EXE__dumped.EXE` / `install/AGE_dump.exe` / `install/AGE_free.EXE`）
 * 上逐槽一致，dump 工具 `.tmp/vtableProbe2.mjs`）。
 *
 * ## PCM 的两张表（`MusicBase` 基类，ctor `sub_48A830`）
 * | 字段 | 表 | 语义 |
 * |---|---|---|
 * | `+1304`/`+1308` | 扁平表（`vector<int>`） | **曲号 − 2 → 统一文件 id**（`sub_48DB80` raw 108738） |
 * | `+1320`/`+1324` | 分组表（`vector<vector<int>>`） | 扩展包曲子：组内 **下标 1 起** 才是条目，下标 0 是占位槽 |
 *
 * 组访问器（全部 **1-based 组号**、**下标从 1 起**）：`sub_48A020` 组数（返回 `组数 + 1`）、
 * `sub_48A040` 组内条目数（返回 `长度 − 1`）、`sub_48A080` 取条目（`index < 1` 即 −1）、
 * `sub_48A280` 写条目。⇒ 组内第 0 槽是占位，`0x1D8` 的「找 0 槽」也从下标 1 起。
 *
 * ## 三条 handler（raw 38731-38771）
 * | opcode | handler | 引擎调用 | 语义 |
 * |---|---|---|---|
 * | `0x1D6` | `sub_42E7C0` | `sub_48A140(PCM, op2)` | 把 op2 **追加进扁平表**；`op1 = 元素个数 + 1` = **新曲号** |
 * | `0x1D7` | `sub_42E800` | vtable`+44` = `sub_48AA60`（raw 106866） | **确保组数 ≥ op2**（并把第 op2 组重置成只剩占位槽）；见下 |
 * | `0x1D8` | `sub_42E850` | vtable`+60` = `sub_48A1B0`（raw 106468） | 把 op3 **登记进第 op2 组**；返回 packed id 或槽下标 |
 *
 * `0x1D7`（`sub_48AA60`）三支：
 *  - `op2 < 0` ⇒ `op1 = -1`；
 *  - `组数 ≥ op2` ⇒ `(*(vtable+48))(this, op2)` = `sub_48A170`（把该组**截断/补足成恰好 1 个元素**，
 *    越界返回 −1 但**被丢弃**）⇒ `op1 = 0`；
 *  - `组数 < op2` ⇒ `sub_48A9B0` 扩容到 op2 组 → 每个**空组补一个 0 占位** → 再重置最后一组
 *    ⇒ `op1 = 新组数 − 1`。（函数里 `if (!a2) v2 = v6 + 1` 那一支是死代码：`op2 == 0` 必然走上面的 else。）
 *
 * `0x1D8`（`sub_48A1B0`）的返回值两条分支：
 *  - 组内元素 ≤ 1 ⇒ 追加 ⇒ `op1 = (组号 << 24) | (新长度 − 1)`；
 *  - 组内元素 > 1 ⇒ 从下标 **1** 起找**第一个 0 槽**填进去 ⇒ `op1 = 槽下标`；找不到 ⇒ 追加 ⇒ packed id。
 *
 * 两处返回值自洽：packed id 的低 24 位 `新长度 − 1` 正是刚追加元素的下标，而 `sub_48DB80`
 * 对包内曲号取的是 `组[(id >> 24) − 1][id & 0xFFFFFF]`（**直接下标，不再 −1**）。
 *
 * ## 为什么必须真实现（而不是 no-op）
 * ① 它们**写 op1**：脚本拿它 `mov (global …)`（`$3$AUTORUN.txt:68` = `i1d8 (global-int 70801e) 1 30003b2`）。
 *    写全局表本身就是副作用 —— 即使目前没人读这个全局，也不能让这次写入消失（否则"全局表的内容取决于
 *    哪条指令被当成 no-op"，任何后续读它的脚本都会拿到垃圾）。
 * ② 表本身是**活的**：`play-bgm` 的曲号解析（vtable`+8` = `sub_48DB80`）读的正是这两张表；扩展包靠
 *    `0x1D7` + `0x1D8` 把自己的曲子登记进来（组内值可以直接是 `包号<<24|包内编号` 的统一 id，
 *    由 `NodeFileSource.resolveEntry` 解析）。
 *
 * ## 表从哪来
 * 基础扁平表由宿主在启动时从 `SYS4INI` 尾部装载（`parseMusicTables` → `Engine.musicTable`）；
 * **分组表在引擎里初始为空**（ctor 清零，SYS4INI 只喂 `+1304`），完全由这两条指令在扩展包 `$n$AUTORUN`
 * 里按需建立 —— 所以 emulator 的 `groups` 也从 `[]` 起。
 */
import type { OpHandler, StepCtx } from '../step.js';
import { readIntOperand, writeIntOperand } from '../operand.js';
import type { AudioResource } from '../../audio/audioEngine.js';
import type { OpTable } from './shared.js';

/** 组内第 0 槽是**占位槽**：引擎所有访问器都从下标 1 起算（`sub_48A040` 返回 `len−1`、`sub_48A080` 拒 `index<1`）。 */
const PLACEHOLDER = 0;

/**
 * 组表按需增长到 `target` 组、**空组补一个占位 0**。
 *
 * 引擎 `sub_48AA60`：`sub_48A9B0(groups, v2)` 扩容后逐个 `if (*v8 == v8[1]) sub_40C780(v8, &v10);`（v10 = 0）。
 */
function growGroups(g: number[][], target: number): void {
  while (g.length < target) g.push([]);
  for (const arr of g) if (arr.length === 0) arr.push(PLACEHOLDER);
}

/** 组截断/补足成**恰好 1 个元素**（引擎 `sub_48A170` → `sub_40C880(组, 1)`：多了截断保留第 0 个、少了补 0）。 */
function truncateGroupTo1(arr: number[]): void {
  if (arr.length === 0) arr.push(PLACEHOLDER);
  else arr.length = 1;
}

/**
 * `0x1D6`：把 op2 追加进**扁平表**（曲号表）。
 *
 * 引擎 `sub_48A140`：`sub_478DB0(&this[326], &a2)`（追加）→ `return ((end − begin) >> 2) + 1`；
 * 扁平表下标 = 曲号 − 2，所以返回值恰好是**刚追加那条的曲号**。
 * 扩展包用它在基础曲号表后面接自己的文件 id。
 */
const op_music_append_flat: OpHandler = (c) => {
  const value = readIntOperand(c.e, c.frame, c.instr, 2);
  c.e.musicTable.base.push(value);
  writeIntOperand(c.e, c.frame, c.instr, 1, c.e.musicTable.base.length + 1);
};

/**
 * `0x1D7`：确保组表至少有 op2 组，并把第 op2 组重置成只剩占位槽。
 * 见文件头：`op2 < 0` ⇒ −1；已有该组 ⇒ 0；需要新建 ⇒ `新组数 − 1`。
 */
const op_music_group_ensure: OpHandler = (c) => {
  const n = readIntOperand(c.e, c.frame, c.instr, 2);
  const g = c.e.musicTable.groups;
  if (n < 0) {
    writeIntOperand(c.e, c.frame, c.instr, 1, -1);
    return;
  }
  if (n <= g.length) {
    // 引擎 else 分支：`(*(vtable+48))(this, op2)`，其返回值（越界时 −1）被丢弃 ⇒ 本 op 恒返回 0
    if (n >= 1) truncateGroupTo1(g[n - 1]!);
    writeIntOperand(c.e, c.frame, c.instr, 1, 0);
    return;
  }
  growGroups(g, n);
  truncateGroupTo1(g[g.length - 1]!); // 引擎：扩容后 `(*(vtable+48))(this, v2)`，v2 == 新组数
  writeIntOperand(c.e, c.frame, c.instr, 1, g.length - 1);
};

/**
 * `0x1D8`：把 op3 登记进第 op2 组（**1-based**）；组越界返回 −1。
 * 见文件头：追加 ⇒ `(组号 << 24) | (新长度 − 1)`；填洞 ⇒ 槽下标（≥ 1）。
 */
const op_music_group_add: OpHandler = (c) => {
  const group = readIntOperand(c.e, c.frame, c.instr, 2);
  const value = readIntOperand(c.e, c.frame, c.instr, 3);
  const g = c.e.musicTable.groups;
  if (group < 1 || group > g.length) {
    writeIntOperand(c.e, c.frame, c.instr, 1, -1);
    return;
  }
  const arr = g[group - 1]!;
  if (arr.length > 1) {
    // 引擎：`v8 = *v6 + 4; while (*v8) { ++result; ... }` ⇒ 从下标 1 起找第一个 0 槽
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] === 0) {
        arr[i] = value;
        writeIntOperand(c.e, c.frame, c.instr, 1, i);
        return;
      }
    }
  }
  arr.push(value);
  writeIntOperand(c.e, c.frame, c.instr, 1, ((group << 24) | (arr.length - 1)) | 0);
};

/** 音乐表指令族（`OPS`：纯 VM 状态，不经 NativeBridge）。 */
export const MUSIC_TABLE_OPS: OpTable = [
  [0x1d6, op_music_append_flat],
  [0x1d7, op_music_group_ensure],
  [0x1d8, op_music_group_add],
];

/**
 * **曲号 → 音频资源**（`sub_48DB80` raw 108694 的等价物；`handlers/audio.ts` 的 BGM 分支用它）。
 *
 * - 高字节 ≠ 0（包内曲号）：组 = `(id >> 24) − 1`（0-based）、下标 = **`id & 0xFFFFFF` 直接用**
 *   （raw 108720-108724：`v6 = 4*v4; ... g[v4]`，只要求 `v4 ≥ 1` 且 `组长 > v4 − 1`）；
 * - 否则：扁平表 `base[曲号 − 2]`（raw 108738-108740）；
 * - 表缺失/越界/占位 0 ⇒ 返回 undefined（宿主退回按文件名 `BGM%03d.OGG` 兜底，见 `audioEngine`）。
 */
export function resolveBgmResource(e: StepCtx['e'], bgm: number): AudioResource | undefined {
  const t = e.musicTable;
  if (!t) return undefined;
  if ((bgm & 0xff000000) !== 0) {
    const group = ((bgm >>> 24) & 0xff) - 1;
    const index = bgm & 0xffffff; // ★ 引擎是直接下标（曾误写 index−1 ⇒ 取到占位槽 0 而静音）
    const g = t.groups[group];
    if (!g || index < 1 || index >= g.length) return undefined;
    const id = g[index];
    return typeof id === 'number' && id > 0 ? { id } : undefined;
  }
  const index = bgm - 2; // 引擎：扁平表索引 = 曲号 − 2
  const id = index >= 0 ? t.base[index] : 0;
  return typeof id === 'number' && id > 0 ? { id } : undefined;
}
