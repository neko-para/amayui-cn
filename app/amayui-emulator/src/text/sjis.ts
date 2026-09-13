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
import { sjisBytes } from './layout.js';

/** 切分结果（`warning` = 引擎会写进调试日志的两种"切在全角中间"情形）。 */
export interface SjisSubstrResult {
  /** 切出来的子串（越界/长度为 0 时是空串，与引擎一致）。 */
  text: string;
  /** `lead` = 起点落在全角字中间（丢首字节）；`trail` = 终点落在全角字中间（丢末字节）。 */
  warning?: 'lead' | 'trail';
}

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
 */
export function sjisSubstr(src: string, start: number, len: number): SjisSubstrResult {
  const { chars, sizes, total } = byteLayout(src);
  if (start >= total || start < 0 || len <= 0) return { text: '' }; // 引擎：直接写空串（raw 42299-42316）

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
 * @param src   源串（op2）
 * @param start 起始**字符**下标（op3）
 * @param len   长度（**字符**数，op4）
 */
export function sjisSubstrChars(src: string, start: number, len: number): string {
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
