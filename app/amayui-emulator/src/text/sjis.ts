/**
 * **Shift-JIS 字节语义的字符串切分** —— 引擎 `0x2C7`（`SBSubstr` / `sub_433FD0`）的纯实现。
 *
 * ## 为什么需要它（而不是 `String.prototype.slice`）
 * 引擎的字符串是 **SJIS 字节序列**，`0x2C7` 的 op3/op4 是**字节**起点与**字节**长度
 * （raw 42298 `v13 = strlen(串)`、42299 `if (v3 >= v13 || v4 <= 0)`），并且会处理
 * "切在全角文字中间"的两种情况（raw 42319-42359）：
 *
 * | 情况 | 引擎行为 | 引擎日志（raw 4458/4457） |
 * |---|---|---|
 * | 起点落在一个 2 字节字的**第二个字节**上 | `start++`、`len--`（丢掉首字节） | 「文字列が全角文字の途中から切り出されるため、先頭バイトを切り捨てました」 |
 * | **最后一个被包含的字节**是 2 字节字的**首字节** | `len--`（丢掉末字节） | 「切り出した文字列が全角文字の途中で終了するため、最終バイトを切り捨てました」 |
 *
 * 落在 JS 的 `slice` 上就会把"全角一个字"当成一个元素 ⇒ 与引擎的字节索引完全对不上
 * （TITLE 的版本号取自 `i2c7 (local-string 1) (local-string 0) 2 2` 这种**字节**区间，见 `src/TITLE.txt:583-592`）。
 *
 * ## 字节模型
 * 用 `sjisBytes()`（`text/layout.ts`）：ASCII 与半角片假名 1 字节、其余 2 字节。
 * 这与引擎的字节数一致（引擎也是"半角 1 / 全角 2"的等宽网格）。
 */
import { sjisByteLength, sjisBytes } from './layout.js';

/** 切分结果（`warning` = 引擎会写进调试日志的两种"切在全角中间"情形）。 */
export interface SjisSubstrResult {
  /** 切出来的子串（越界/长度为 0 时是空串，与引擎一致）。 */
  text: string;
  /** `lead` = 起点落在全角字中间（丢首字节）；`trail` = 终点落在全角字中间（丢末字节）。 */
  warning?: 'lead' | 'trail';
}

// ---------------------------------------------------------------------------
// ★引擎的**硬失败**路径（`tickets/T-0151` 的 `0x2c7` / `0x2c8` 三条 missing-branch）
// ---------------------------------------------------------------------------
// 引擎在这两处**不是**"静默给个空串/截断"，而是真的抛/终止。重写侧如果把它们并进静默路径，
// 症状是"引擎崩在那一行 / emulator 若无其事地继续跑"——脚本后续行为整段分叉，且**没有任何日志**。
// 两个失败各有各的类，别合并（一个是 C++ 异常、一个是 CRT 的 invalid parameter handler）。

/**
 * `0x2C7`（`SBSubstr`）的**负起点**：引擎必然抛 `std::out_of_range`。
 *
 * 引擎链（逐行读过）：
 * ```
 * sub_433FD0   raw 42299  if ( v3 >= v13 || v4 <= 0 )      // ★只挡这两种；`v3<0` 落到 else
 *              raw 42360  v12 = sub_429F60(v19, v16, v15, v14);   // v15 = v3（signed）
 * sub_429F60   raw 36151  sub_40C120(a2, _this, a3, a4);          // a3 形参是 unsigned int
 * sub_40C120   raw 16220  v6 = (unsigned int)a2[4];
 *              raw 16221  if ( v6 < a3 ) std___Xout_of_range(…);   // 负起点 → 巨大无符号数 ⇒ 必抛
 * ```
 */
export class SjisSubstrOutOfRangeError extends RangeError {
  /** 触发时的实参（诊断用；错误串里也带上它们与 raw 锚点）。 */
  readonly start: number;
  readonly len: number;
  readonly srcBytes: number;
  constructor(start: number, len: number, srcBytes: number) {
    super(
      `0x2c7 SBSubstr：起点为负（start=${start}、len=${len}、串长=${srcBytes} 字节）—— 引擎会走到 ` +
        'sub_429F60 → sub_40C120 的 `if (v6 < a3) std___Xout_of_range`（raw 16221，a3 是 unsigned）并**抛异常**，' +
        '不是写空串；emulator 同样必须失败（不许静默继续）。',
    );
    this.name = 'SjisSubstrOutOfRangeError';
    this.start = start;
    this.len = len;
    this.srcBytes = srcBytes;
  }
}

/** 引擎 `strcpy_s(Destination, 0x100u, op2)` 的缓冲上限（raw 42394 的 `char Destination[256]`）。 */
export const SJIS_SUBSTR_CHARS_BUFFER = 256;

/**
 * `0x2C8`（按字符取子串）的 **op2 超长**：引擎卡在 `strcpy_s` 的运行时约束违例上。
 *
 * `sub_434260` raw 42401 `strcpy_s(Destination, 0x100u, v3)` 对"会发生截断"（源串含结尾 0 超过
 * 0x100，即 `strlen(op2) > 255`）**调用 invalid parameter handler** —— MSVC 默认即终止/快速失败，
 * **不是**静默截成 255 字节。因此 op2 被钉死在 ≤255 字节，更长时根本到不了 raw 42404 的 `_mbstrlen`。
 */
export class SjisSubstrSourceTooLongError extends RangeError {
  readonly srcBytes: number;
  constructor(srcBytes: number) {
    super(
      `0x2c8：op2 的 Shift-JIS 字节长达 ${srcBytes} > ${SJIS_SUBSTR_CHARS_BUFFER - 1} —— 引擎 ` +
        '`strcpy_s(Destination, 0x100u, op2)`（raw 42401）会触发 invalid parameter handler（运行时约束违例，' +
        'MSVC 默认终止），该行根本走不到 `_mbstrlen`；emulator 同样必须失败。',
    );
    this.name = 'SjisSubstrSourceTooLongError';
    this.srcBytes = srcBytes;
  }
}

/**
 * 引擎 `0x2C8` 体里**有据地不复制**的行为（判据写在条目里；登记为缺口而不是猜一个等价物）。
 *
 * 守卫：`test/text-sjis-limits.test.ts` 断言这张表非空、锚点正确、且 `recheck` 写了重新评估条件。
 */
export const SJIS_SUBSTR_CHARS_NOT_COPIED: readonly { raw: string; what: string; why: string; recheck: string }[] = [
  {
    raw: '42420',
    what:
      '逐字节循环第一步的 `_mbbtype(*(v2 - 1), 0) == 1 && _mbbtype(*v2, 1) == 2`：`v2` 初值就是 `Destination`' +
      '（raw 42399 `v2 = (unsigned __int8 *)Destination;`）⇒ 第一次迭代读的是 **`Destination[-1]`**（栈上紧邻数组的未初始化字节）。',
    why:
      '该字节**未定义**（栈上是上一帧/上一调用的残留）⇒ 没有"确定行为"可照抄；emulator 若要复刻只能凭空编一个字节，' +
      '那就是猜。语义后果：当它恰好是 SJIS 前导字节（0x81-0x9F / 0xE0-0xFC）而 `*v2` 恰是合法续字节时，' +
      '引擎会把首字符判成"双字节字的后半字节"而少切一个字；emulator 永远把首字符当独立字符。',
    recheck:
      '当 ① 语料里出现 `i2c8`（当前 941 个 `src/*.txt` 里 **0 处**），或 ② E4 真机抓到 op2 首字符被吞/切点整体前移一格时，' +
      '回来重新评估：那时才有可复现的输入去定那个字节。',
  },
];

/** 把字符串摊成"每个字符占几个字节"的数组（配合前缀和做字节↔字符换算）。 */
function byteLayout(s: string): { chars: string[]; sizes: number[]; total: number } {
  const chars = [...s];
  const sizes = chars.map(sjisBytes);
  return { chars, sizes, total: sizes.reduce((a, b) => a + b, 0) };
}

/** 字节下标 `i` 是否落在某个 2 字节字的**首**字节上（= `i` 是一个全角字的起点）。 */
function isLeadAt(sizes: number[], i: number): boolean {
  let b = 0;
  for (const n of sizes) {
    if (b === i) return n === 2;
    b += n;
    if (b > i) return false; // 落在某字的第二个字节上（该字首字节在更前面）
  }
  return false;
}

/**
 * `0x2C7`：`op1 = substr(op2, op3, op4)`（**字节**起点 + **字节**长度；SJIS 全角修正）。
 *
 * @param src   源串（op2）
 * @param start 字节起点（op3）
 * @param len   字节长度（op4）
 * @throws {SjisSubstrOutOfRangeError} `start < 0 && len > 0`（引擎 `sub_40C120` 的 `std::out_of_range`）
 */
export function sjisSubstr(src: string, start: number, len: number): SjisSubstrResult {
  const { chars, sizes, total } = byteLayout(src);
  // ★引擎的判据顺序（raw 42299）是 `v3 >= v13 || v4 <= 0`：长度非正**先**成立 ⇒ 写空串。
  //   负起点单独处理：`v4 > 0` 时会一路走到 sub_40C120 的无符号比较上 ⇒ 必抛（见 SjisSubstrOutOfRangeError）。
  if (len <= 0) return { text: '' };
  if (start < 0) throw new SjisSubstrOutOfRangeError(start, len, total);
  if (start >= total) return { text: '' };

  let s = start;
  let n = len;
  let warning: SjisSubstrResult['warning'];
  // 起点修正：起点是某个全角字的第二个字节 ⇒ 丢掉首字节
  if (s > 0 && !isLeadAt(sizes, s) && isLeadAt(sizes, s - 1)) {
    s++;
    n--;
    warning = 'lead';
  }
  // 终点修正：最后一个被包含的字节是某个全角字的首字节 ⇒ 丢掉末字节
  if (n > 0 && isLeadAt(sizes, s + n - 1)) {
    n--;
    warning = 'trail';
  }
  if (n <= 0 || s >= total) return { text: '', ...(warning ? { warning } : {}) };

  // 字节窗口 [s, s+n) → 字符窗口（两端都已对齐到字符边界）
  const out: string[] = [];
  let b = 0;
  for (let i = 0; i < chars.length; i++) {
    const size = sizes[i]!;
    const from = b;
    const to = b + size;
    b = to;
    if (from >= s && to <= s + n) out.push(chars[i]!);
    if (b >= s + n) break;
  }
  return { text: out.join(''), ...(warning ? { warning } : {}) };
}

/**
 * **`0x2C8`（`sub_434260`, raw 42379-42457）：按「字符」取子串** —— `0x2C7` 的字符版兄弟。
 *
 * 引擎逐句（`Destination` = op2 的 256 字节拷贝）：
 * ```
 * v11 = _mbstrlen(op2);              // ★字符数（多字节感知），不是字节数
 * v9  = readInt(op3);                // 起始「字符」下标
 * v5  = v9 + readInt(op4);           // 结束位置 = 起始 + 长度（同为字符数）
 * v8 = v5; v10 = v5;                 // ★v8 保留**钳制前**的结束位置，v10 用钳制后的
 * if (v5 <= 0 || v5 > v11) { v5 = v11; v10 = v11; }
 * 逐字节走（_mbbtype 判 SJIS 双字节）：
 *   双字节字：v12 < v9 ⇒ 跳过 2 字节；否则拷 2 字节        ← ★不看 v8（只受循环上界 v10 限）
 *   单字节字：v12 < v9 || v12 >= v8 ⇒ 跳过 1 字节；否则拷 1 字节
 * ⇒ 结果写回 op1 字符串（sub_433310(this,1,…)，与 set-string 同一个写入原语）
 * ```
 * ★两条分支的边界条件**不一样**（双字节只看起点、单字节还看 `v8`）——这是引擎里的**真实不对称**，
 *  只有在 `op3+op4 <= 0`（长度为 0/负）时才有可观测差异：此时单字节**全部丢弃**、
 *  而双字节字（`v12 >= v9` 的部分）**仍然被保留**。本实现按读到的代码逐条复刻，不做"顺手修正"。
 *
 * ★**缓冲上限（`tickets/T-0151` 补齐）**：引擎先把 op2 拷进 256 字节栈缓冲
 *  （`char Destination[256]` raw 42394、`strcpy_s(Destination, 0x100u, op2)` raw 42401），
 *  源串含结尾 0 超过 0x100（即 `strlen(op2) > 255`）⇒ **运行时约束违例**（invalid parameter handler，
 *  MSVC 默认终止），**不是**静默截成 255 字节 ⇒ 本实现抛 `SjisSubstrSourceTooLongError`。
 *
 * ★**逐字节循环第一步的缓冲下界外读**（raw 42420 的 `_mbbtype(*(v2 - 1), 0)`）**不复制**：
 *  值未定义，没有确定行为可照抄 —— 判据与重新评估条件见 `SJIS_SUBSTR_CHARS_NOT_COPIED`。
 *
 * @param src   源串（op2）
 * @param start 起始**字符**下标（op3）
 * @param len   长度（**字符**数，op4）
 * @throws {SjisSubstrSourceTooLongError} `src` 的 Shift-JIS 字节长 > 255（引擎 `strcpy_s` 约束违例）
 */
export function sjisSubstrChars(src: string, start: number, len: number): string {
  // ★引擎在 raw 42401 先把 op2 拷进 256 字节栈缓冲（`char Destination[256]`，raw 42394），
  //   长度超限 ⇒ strcpy_s 约束违例（硬失败）。这一步在 raw 42403-42408 的 `_mbstrlen`/读 op3/op4 **之前**，
  //   所以"超长 + 越界请求"同样硬失败，emulator 不许先按长度 0 走空串。
  const srcBytes = sjisByteLength(src);
  if (srcBytes > SJIS_SUBSTR_CHARS_BUFFER - 1) throw new SjisSubstrSourceTooLongError(srcBytes);
  const chars = [...src];
  const total = chars.length; // = 引擎 _mbstrlen（SJIS 字符数；JS 码点与之同构）
  const endRaw = start + len; // 引擎的 v8：钳制**前**的结束位置
  const end = endRaw <= 0 || endRaw > total ? total : endRaw; // 引擎的 v10：钳制**后**
  const out: string[] = [];
  for (let i = 0; i < end; i++) {
    const ch = chars[i]!;
    if (sjisBytes(ch) === 2) {
      if (i >= start) out.push(ch); // 双字节：只看起点（引擎不查 v8）
    } else if (i >= start && i < endRaw) {
      out.push(ch); // 单字节：起点与 **钳制前** 的结束位置都要满足
    }
  }
  return out.join('');
}
