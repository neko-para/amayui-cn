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
 * ## 报错口径与**已登记的三处有意差异**（2026-09-24，`tickets/T-0163` 的 AGERC 八条判据）
 * 引擎的错误串**原文**（raw 31079-31135 / 39810-39855，逐字）：
 *  - `0x14B` 失败：`sub_408050(_this+8, 1024, "%sを読み込み出来ません．\r\n\r\nERRORCODE = %d", 名, GetLastError())`
 *    （`%s` = `FileDB.name(op1)` 解析出的文件名、`%d` = `GetLastError()`）。
 *  - `0x14C` 取地址失败：`"%sのアドレス取得に失敗しました．\r\n\r\nERRORCODE = %d"`（raw 31111）；
 *    ★**模块未加载时引擎也走这一条** —— 它直接 `GetProcAddress(NULL, op2)`（raw 31106）失败即报此串。
 *  - `0x14C` 槽越界：`"%sの関数インデックスが不正です．0から99までを指定してください．\r\n…"`（raw 31128），
 *    其 `%s` 实参是 **op3**（`sub_41B640(_this, 3)`，raw 31120）—— 注意引擎的次序是
 *    **先 `GetProcAddress`（31106）再判 `slot > 0x63`（31117）**，且 `op3` **只在越界分支**被读一次。
 *  - `0x14D`：`v14 = …&_this[sub_41BF50(_this, 1) + 122519]` 之后**直接 `(*v14)(...)`**（raw 39839/39843）
 *    —— 槽未绑定（该项 = 0）或 op1 越界（0..99 之外）**就是跳 NULL / 跳到表外**（真机 = 访问违例）；
 *    `len <= 0` 时临时缓冲指针 `v3` **保持 0（NULL）** 并原样当第 2 实参传给导出（raw 39828-39843）。
 *
 * **有意差异（逐条：为什么 + 重新评估条件）**：
 *  1. `0x14B` 错误串用 **id** 代替 `%s` 文件名、**不伪造** `ERRORCODE` —— emulator 运行期没有**同步**的
 *     id→名字表（`FileSource` 是异步接口，handler 不能同步查名）。重新评估条件 = 给 `Engine` 加一个
 *     `sub_454FA0` 等价的同步解析器。
 *  2. `0x14D` 槽未绑定/越界 ⇒ **明确抛错**，而不是让宿主跳 NULL 崩溃（比引擎安全，属有意换法）。
 *  3. `0x14D` `len <= 0` ⇒ emulator 取 `buf[0] ?? 0` = `nameLenMax = 0`；引擎把 **NULL** 交给
 *     `_SetNameLenMax@20`，而该导出是 `dword_100A9000 = *a2` **无条件解引用**
 *     （`docs-new/03-engine/agerc-internals.md` §3）⇒ 真机是 UB/崩溃。`op3` 所指内存两侧都不动
 *     （引擎 raw 39844 的 `if (v2 > 0)` 回写门）。
 *  守卫：`test/agerc-module-error-paths.test.ts`（八条判据逐条可失败）。
 *
 * ## 内置导出表（21 个）
 * PE 导出表实读见 `docs-new/03-engine/agerc-internals.md` §1/§2。其中**脚本侧只会用到
 * `_SetNameLenMax@20`**（唯一调用点就是上面那条 `SAVE.txt`），另 17 个地图/地块/碰撞导出
 * 与 3 个 UI 导出**在《天結》里没有任何调用者**（exe 与 941 个脚本全 0 命中）。
 * emulator 因此只为 `_SetNameLenMax@20` 写行为实现，其余导出**名字可绑定**（`GetProcAddress` 在真机
 * 也确实成功）但**调用即抛**「未建模」的明确错误 —— 比静默返回 0 更安全（真到了那一步说明有新语料）。
 */
import type { OpHandler, StepCtx } from '../step.js';
import { operandsFor, type PlannedOperands } from '../operandPlan.js';
import { readIntOperand, readStringOperand, writeIntOperand } from '../operand.js';
import { refFromOperand } from '../operand.js';
import { readRef, refAt, writeRef, STRIDE_INT } from '../ref.js';
import type { OpTable } from './shared.js';

/**
 * 取本族的**操作数计划视图**（`tickets/T-0082` 收尾批：AGERC 宿主缝族（agerc），2 条）；缺计划 = 编程错误。
 */
function planFor(c: StepCtx): PlannedOperands {
  const p = operandsFor(c);
  if (!p) throw new Error(`0x${c.instr.opcode.toString(16)}：AGERC 宿主缝族（agerc）走操作数计划层，但没有声明计划`);
  return p;
}


/** 语料里唯一会被加载的模块：文件 id `0x5250` = 21072（`src/SAVE.txt:7 i14b 5250`）。 */
export const AGERC_FILE_ID = 0x5250;
const AGERC_MODULE_NAME = 'AGERC.DLL';


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
  const plan = planFor(c);
  const e = c.e;
  if (e.agerc.loaded) {
    // 引擎（raw 31068-31076）：已有句柄 ⇒ `FreeLibrary(句柄)` + `*(Engine+490072) = 0`；
    // 随后 `LoadLibraryA` 的结果（**含失败时的 NULL**）无条件写回该槽，**然后**才报 ShowMessage
    // ⇒ "第二次加载失败"之后句柄槽是 NULL、旧库已卸（`exports` 随之作废）。
    // ★T-0163 的 P2 判据：emulator 这里**同向**（先清 loaded/exports 再处理失败）⇒ 重载失败后
    //   0x14C 必须报「地址取得失败」，不许再绑到旧导出（守卫 test/agerc-module-error-paths.test.ts 第①条）。
    e.agerc.loaded = false;
    e.agerc.exports.clear();
  }
  const id = (plan.int(1) ?? 0);
  if (id !== AGERC_FILE_ID) {
    // 引擎（raw 31079-31082）：`FileDB.name(id)` → `LoadLibraryA(名)`；除 AGERC.DLL 外一律失败，
    // 错误串 = `"%sを読み込み出来ません．\r\n\r\nERRORCODE = %d"`（%s = 解析出的文件名、
    // %d = GetLastError()）。★已登记差异：emulator 运行期没有**同步**的 id→名字表（`FileSource`
    // 是异步接口，handler 不能同步查名）⇒ `%s` 以 id 代替、`ERRORCODE` 不伪造；
    // 重新评估条件 = 给 Engine 加 `sub_454FA0` 等价的同步解析器（见文件头「有意差异」①）。
    throw new Error(
      `0x14B: id=0x${(id >>> 0).toString(16)} を読み込み出来ません．（本作唯一可加载的模块是 ` +
        `${AGERC_MODULE_NAME}，id=0x${AGERC_FILE_ID.toString(16)}；引擎此处抛 ShowMessage）`,
    );
  }
  e.agerc.loaded = true;
};

/** `0x14C`（sub_422AB0 raw 31091-31135）：把导出绑到槽 0..99。 */
const op_agerc_bind_export: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  // ★**按引擎顺序先读满操作数**（引擎在每个 handler 体开头 `sub_41BF50` ×N）：op1（作者槽号）的用途
  //   在后面，但读取必须发生在任何校验/抛错之前 —— 否则"合成指令 + 模块未加载"时 op1 永远读不到，
  //   「计划 ⟷ 实现」会如实点名（本轮正是这样被抓出来的）。
  const slot = plan.int(1) ?? 0;
  const name = plan.str(2) ?? '';
  if (!e.agerc.loaded) {
    // ★T-0163 的 P3 判据（`0x14C` P3 missing-behavior）：引擎在句柄槽为 0 时**不另起文案** ——
    // 它直接 `GetProcAddress(NULL, op2)`（raw 31106）失败，走 raw **31111** 的
    // 「`%sのアドレス取得に失敗しました．\r\n\r\nERRORCODE = %d`」（`GetLastError()` 真机为
    // 126 = ERROR_MOD_NOT_FOUND）⇒ 这里改用引擎同文（`ERRORCODE` 实参**不伪造**，见文件头差异①）。
    throw new Error(
      `0x14C: "${name}"のアドレス取得に失敗しました．（模块未加载 ⇒ 引擎对 NULL 句柄调 ` +
        `GetProcAddress，raw 31106/31111；ERRORCODE = %d 的真机值未复现）`,
    );
  }
  if (!EXPORT_SET.has(name)) {
    // 引擎 raw 31111（同一条串）：`GetProcAddress(模块, op2)` 返回 0 ⇒ 地址取得失败。
    throw new Error(`0x14C: "${name}"のアドレス取得に失敗しました．（AGERC.DLL 没有这个导出）`);
  }
  if (slot < 0 || slot > 99) {
    // 引擎 raw 31117-31128：`if (result > 0x63)` ⇒ 该错误串的 `%s` 实参是 **op3**
    // （`sub_41B640(_this, 3)`，raw 31120），**且只在越界分支读 op3**（合法槽路径一格都不碰；
    // 计划 argc=2 ⇒ 语料那条 2 格调用与引擎一致）。★操作数读取是**分支相关**的：
    // 有第 3 格就用它当 `%s`（与体一致），缺第 3 格才回退到导出名（引擎此处读的是栈上残留）。
    const op3 = c.instr.args.length >= 3 ? readStringOperand(e, c.frame, c.instr, 3) : undefined;
    throw new Error(
      `0x14C: "${op3 ?? name}"の関数インデックスが不正です．0から99までを指定してください．（槽 ${slot}）`,
    );
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
    // ★有意差异②（T-0163 的 P2 `approximation`）：引擎**对槽表函数指针零校验** ——
    // `v14 = …&_this[sub_41BF50(_this, 1) + 122519]` 之后直接 `(*v14)(...)`（raw 39839/39843）⇒
    // 槽未绑定（该项 = 0）或 op1 越界（0..99 之外）就是**跳 NULL / 跳到表外**（真机访问违例）。
    // emulator 换成明确抛错（比崩溃安全）；重新评估条件 = 真机上补到"引擎确实会崩"的实机证据。
    throw new Error(`0x14D: 槽 ${slot} 未绑定导出（引擎此处会跳到空函数指针）`);
  }
  // 把 op3 的数组按引擎语义"解密成普通值"——emulator 的 `readRef` 已经过 DEC（见 `vm/ref.ts`），
  // 因此这里拿到的就是 `sub_430170` 里那个 DEC 后的临时缓冲。
  // ★有意差异③（T-0163 的 P3 `unclear` + P3 `approximation`）：`len <= 0` 时引擎把临时缓冲指针
  // **保持 0（NULL）**（raw 39828 `v3 = 0`，只有 `if (v2 > 0)` 才 `new[]`）并把它当第 2 实参传给导出；
  // 而 `_SetNameLenMax@20` 是 `dword_100A9000 = *a2` **无条件解引用**（`agerc-internals.md` §3）
  // ⇒ 真机是 UB/崩溃，emulator 取 `buf[0] ?? 0` = 0（下面 nameLenMax 分支）。两侧都不动 op3 所指内存。
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
