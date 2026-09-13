/**
 * **AGERC 模块接口族**：`0x14B`（加载模块）/ `0x14C`（绑定导出到槽）/ `0x14D`（调用槽）。
 *
 * ## 为什么不加载原生库也能"实现"
 * 这三条看着像"运行时加载任意 Win32 DLL"，但**实际不可能加载任意库**（2026-09 定论）：
 *  - 脚本侧**全语料唯一调用点**：`src/SAVE.txt:7 i14b 5250`，而 `0x5250` = 21072 = **`AGERC.DLL`**；
 *  - 引擎本体也用硬编码字面量 `LoadLibraryA("AGERC.DLL")` 加载同一个 DLL（`sub_48E730`）。
 * ⇒ 这里把"模块 + 100 槽导出表"模型化：**只接受 AGERC.DLL**，其余 id 按引擎同文报错。
 *
 * ## 引擎实证（raw 行号 = `engine/天结_unpacked.exe_utf8.c`）
 * | opcode | handler | 语义 |
 * |---|---|---|
 * | `0x14B` | `sub_4229D0` raw 31056-31088 | 若 `Engine+490072` 已有句柄 ⇒ `FreeLibrary` 并清 0；`id = op1` → `FileDB.name(id)` → `LoadLibraryA(名)` → 存回 `Engine+490072`；失败 ⇒ ShowMessage「`%sを読み込み出来ません．ERRORCODE = %d`」 |
 * | `0x14C` | `sub_422AB0` raw 31091-31135 | `name = op2`（**字符串**操作数）→ `GetProcAddress(模块, name)`（失败 ⇒ 「`%sのアドレス取得に失敗しました．`」）→ `slot = op1`，`slot > 99` ⇒ 「`%sの関数インデックスが不正です．0から99までを指定してください．`」→ `Engine[4*slot + 490076] = proc` |
 * | `0x14D` | `sub_430170` raw 39810-39855 | `len = op4`；把 op3 的数组**逐元素 DEC** 到临时缓冲 → `ret = (*槽表[op1])(Engine[96981], buf, len, op5 数组, op6)` → 把缓冲 **ENC 回写** op3 → **写 op2 = ret** |
 *
 * 关键细节（照抄引擎）：
 *  - DEC/ENC = `dec(key,x)=ror32(key^rol32(x,11),25)` / `enc(key,a)=rol32(key^ror32(a,7),21)`（`src/vm/bits.ts`）；
 *  - **op5 的数组原样传入、不 DEC**（引擎直接 `sub_42AEA0(this, 5)` 取指针）；
 *  - 实参首项 `Engine[96981]`（byte 387924）= 引擎的消息窗 HWND（`_SetNameLenMax` 忽略它）。
 *
 * ## 内置导出表（21 个）
 * PE 导出表实读见 `docs-new/03-engine/agerc-internals.md` §1/§2。其中**脚本侧只会用到
 * `_SetNameLenMax@20`**（唯一调用点就是上面那条 `SAVE.txt`），另 17 个地图/地块/碰撞导出
 * 与 3 个 UI 导出**在《天結》里没有任何调用者**（exe 与 941 个脚本全 0 命中）。
 * emulator 因此只为 `_SetNameLenMax@20` 写行为实现，其余导出**名字可绑定**（`GetProcAddress` 在真机
 * 也确实成功）但**调用即抛**「未建模」的明确错误 —— 比静默返回 0 更安全（真到了那一步说明有新语料）。
 */
import type { OpHandler } from '../step.js';
import { readIntOperand, readStringOperand, writeIntOperand } from '../operand.js';
import { refFromOperand } from '../operand.js';
import { readRef, refAt, writeRef, STRIDE_INT } from '../ref.js';
import type { OpTable } from './shared.js';

/** 语料里唯一会被加载的模块：文件 id `0x5250` = 21072（`src/SAVE.txt:7 i14b 5250`）。 */
export const AGERC_FILE_ID = 0x5250;
export const AGERC_MODULE_NAME = 'AGERC.DLL';

/** 引擎里消息窗 HWND 的字段下标（`Engine[96981]` = byte 387924；`0x14D` 的实参首项）。 */
export const ENGINE_MSG_HWND_FIELD = 96981;

/** AGERC.DLL 的 21 个导出（PE 导出表实读，`docs-new/03-engine/agerc-internals.md` §2）。 */
export const AGERC_EXPORTS: readonly string[] = [
  // 3 个 UI（引擎 WinMain 解析；脚本不用）
  '_GetInstance@0', '_ShowDialog@12', '_OperateMenu@16',
  // 脚本侧唯一用到的一个（存档名/注释长度上限）
  '_SetNameLenMax@20',
  // 17 个地图 / 地块 / 碰撞（本作不可达）
  '_FindClash@20', '_GetEv@20', '_GetLand@20', '_InitRect@20', '_SetChParams@20',
  '_SetMapEvPN@20', '_SetMapEvPX@20', '_SetMapEvPY@20',
  '_SetMapLandIdx@20', '_SetMapLandPN@20', '_SetMapLandPX@20', '_SetMapLandPY@20',
  '_SetMapParams@20',
  '_SetMapWallCr@20', '_SetMapWallPN@20', '_SetMapWallPX@20', '_SetMapWallPY@20',
];

const EXPORT_SET: ReadonlySet<string> = new Set(AGERC_EXPORTS);

/** `0x14B`（sub_4229D0 raw 31056-31088）：加载（或重载）AGERC 模块。 */
const op_agerc_load: OpHandler = (c) => {
  const e = c.e;
  if (e.agerc.loaded) {
    // 引擎：已有句柄 ⇒ FreeLibrary 并清 0（重载语义）
    e.agerc.loaded = false;
    e.agerc.exports.clear();
  }
  const id = readIntOperand(e, c.frame, c.instr, 1);
  if (id !== AGERC_FILE_ID) {
    // 引擎：FileDB.name(id) → LoadLibraryA(名)；除 AGERC.DLL 外一律失败。
    // ★缺口：emulator 运行期没有 id→名字表（FileSource 是异步接口，handler 不能同步查名）
    //   ⇒ 报错里给出 id；真机上这里会是「<解析出的文件名>を読み込み出来ません．ERRORCODE = 126」。
    throw new Error(
      `0x14B: id=0x${(id >>> 0).toString(16)} を読み込み出来ません．（本作唯一可加载的模块是 ` +
        `${AGERC_MODULE_NAME}，id=0x${AGERC_FILE_ID.toString(16)}；引擎此处抛 ShowMessage）`,
    );
  }
  e.agerc.loaded = true;
};

/** `0x14C`（sub_422AB0 raw 31091-31135）：把导出绑到槽 0..99。 */
const op_agerc_bind_export: OpHandler = (c) => {
  const e = c.e;
  const name = readStringOperand(e, c.frame, c.instr, 2);
  if (!e.agerc.loaded) {
    throw new Error(`0x14C: 模块未加载 ⇒ 无法取 "${name}" 的地址（引擎此处抛 ShowMessage）`);
  }
  if (!EXPORT_SET.has(name)) {
    throw new Error(`0x14C: "${name}"のアドレス取得に失敗しました．（AGERC.DLL 没有这个导出）`);
  }
  const slot = readIntOperand(e, c.frame, c.instr, 1);
  if (slot < 0 || slot > 99) {
    throw new Error(`0x14C: "${name}"の関数インデックスが不正です．0から99までを指定してください．（槽 ${slot}）`);
  }
  e.agerc.exports.set(slot, name);
};

/** `0x14D`（sub_430170 raw 39810-39855）：调用槽；op3 的数组 DEC 传入、ENC 回写；`op2 ← 返回值`。 */
const op_agerc_call_export: OpHandler = (c) => {
  const e = c.e;
  const slot = readIntOperand(e, c.frame, c.instr, 1);
  const len = readIntOperand(e, c.frame, c.instr, 4);
  const name = e.agerc.exports.get(slot);
  if (!name) {
    throw new Error(`0x14D: 槽 ${slot} 未绑定导出（引擎此处会跳到空函数指针）`);
  }
  // 把 op3 的数组按引擎语义"解密成普通值"——emulator 的 `readRef` 已经过 DEC（见 `vm/ref.ts`），
  // 因此这里拿到的就是 `sub_430170` 里那个 DEC 后的临时缓冲。
  const buf: number[] = [];
  if (len > 0) {
    const arr = refFromOperand(e, c.frame, c.instr, 3);
    for (let i = 0; i < len; i++) buf.push(readRef(e, c.frame, refAt(arr, i * STRIDE_INT)));
  }
  // 内置导出实现（只有 _SetNameLenMax@20 有行为）；返回值恒 0（引擎里该导出 `return 0`）
  if (name === '_SetNameLenMax@20') {
    // 引擎 AGERC 侧：`dword_100A9000 = *a2`（= DEC 后的第一个元素）；a1/a3/a4/a5 都不读。
    e.agerc.nameLenMax = buf[0] ?? 0;
  } else {
    throw new Error(
      `0x14D: 导出 "${name}" 未建模（本作不可达；AGERC 的地图/地块/碰撞与 UI 导出在《天結》里没有调用点）`,
    );
  }
  if (len > 0) {
    // ENC 回写：`writeRef` 已经过 ENC（与引擎 `__ROL4__(key ^ __ROR4__(buf[i], 7), 21)` 同式）。
    const arr = refFromOperand(e, c.frame, c.instr, 3);
    for (let i = 0; i < len; i++) writeRef(e, c.frame, refAt(arr, i * STRIDE_INT), buf[i]!);
  }
  // 引擎：op2 ← 被调函数返回值（op5 的数组原样传入，我们的内置实现不读它）
  writeIntOperand(e, c.frame, c.instr, 2, 0);
};

/** AGERC 模块接口族（真实现；模型化，不加载任何原生库）。 */
export const AGERC_OPS: OpTable = [
  [0x14b, op_agerc_load],
  [0x14c, op_agerc_bind_export],
  [0x14d, op_agerc_call_export],
];
