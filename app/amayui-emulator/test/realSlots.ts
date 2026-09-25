/**
 * **真游戏槽/缩略图的定位（唯一实现）** —— `tickets/T-0128`。
 *
 * ## 为什么要有它
 *
 * 本机的存档槽一度**只在 `overlay` 一侧**，而 7~9 处 "E4" 闸门把路径写成
 * `resolveSystemPaths(REPO).baseDir/SAVE` ⇒ 这些本该是最硬一档的用例**在开发机上静默跳过**
 * （`save-slot-chain` 2/2 全跳）。`engine-slot.test.ts` 的 E4b 是当时**唯一**两侧都看的写法
 * —— 本模块就是把它抽出来、给所有站点共用。
 * ★2026-09-25 实测：本机现在**两侧都有**（`base` 56 个真游戏槽 + `overlay` 一份镜像并多出
 * emulator 自己写的 `SAVE70/71`）—— 两侧都看这条口径不变，但"base 不存在"已不成立。
 *
 * ## 契约
 *
 * - 目录顺序 **base → overlay**（同名以 base 优先，与 `NodeFileSource` 的读取优先级一致）；
 * - 返回值按 `name` 升序，确定性（同一台机器给同一序列）；
 * - 目录不存在或读不了 ⇒ 当"没有"，**不抛**（调用方据此 `t.skip`）。
 *
 * ## ★这些槽有**两种作者**（`tickets/T-0146`）—— 用 `classifyRealSlot` 分类，别只看文件名
 *
 * overlay 是**本工程唯一的写目标**（`src/arch/systemPaths.ts` 的口径）⇒ 这个目录里会混进
 * **emulator 自己写出来的槽**与**真游戏写出来的槽**。本机实测（2026-09-25）：
 *
 * | 作者 | 判据（可复核的字节事实） | 本机数量 |
 * |---|---|---|
 * | 真游戏 | 头 `+284`（`set:SaveVersion1`）∈ **1..3** | 56（`base` 的 `SAVE00..SAVE99` 子集） |
 * | 本工程 emulator | 头 `+284` = **0**（`SAVE_FORMAT_PLAIN`）+ payload 尾块带 `AMYS1\n`（`SLOT_STATE_MAGIC`） | 2（`overlay` 的 `SAVE70/71`） |
 *
 * 为什么要分类：真游戏槽的状态主体是引擎私有布局（`src/vm/engineSlot.ts`），而本工程槽是
 * "明文容器 + 我们自己的 JSON 尾块"（`saveSlot.ts` 的 `format = 0` 就是为"**互不误读**"设计的）
 * ⇒ 拿引擎容器口径去解本工程槽**必然失败**（实测 `SAVE70.DAT: storedDwords=2069342 超出文件`
 * —— 那一格在本工程槽里是 payload 长度，不是 dword 计数）。**来源已查清**：`SAVE70/71` 不是
 * "较新版本游戏写出的槽"，而是 T-0061/T-0062/T-0063 那几轮**用户实测存档**时 emulator 自己写进
 * overlay 的档（`tickets/T-0061/notes.md`：「进第一个 ADV 场景 → 存档 → 槽文件写出成功（SAVE70.DAT）」、
 * 「overlay 里那份 …`format=0`（本工程槽）」）。⇒ 它们是**测试数据**，不是待解析的引擎格式。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveSystemPaths } from '../src/arch/systemPaths.js';
import { SAVE_FORMAT_PLAIN } from '../src/save/saveData.js';
import { parseSlotFile, parseSlotHeader } from '../src/save/saveSlot.js';

export interface RealFile {
  /** 文件名（如 `SAVE79.DAT`）。 */
  name: string;
  /** 所在目录（绝对路径）。 */
  dir: string;
  /** 绝对路径。 */
  path: string;
}

/** 真槽的搜索目录：**base 与 overlay 两侧都看**（顺序即优先级）。 */
export function realSlotDirs(repoRoot: string): string[] {
  const system = resolveSystemPaths(repoRoot);
  return [path.join(system.baseDir, 'SAVE'), path.join(system.overlayDir, 'SAVE')];
}

/** 在两侧目录里找匹配 `kind`（`DAT`/`STH`）的 `SAVE\d\d.<kind>`；按名字升序、同名去重（先命中者胜）。 */
export function findRealFiles(repoRoot: string, kind: 'DAT' | 'STH'): RealFile[] {
  const seen = new Set<string>();
  const out: RealFile[] = [];
  for (const dir of realSlotDirs(repoRoot)) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir).filter((f) => new RegExp(`^SAVE\\d\\d\\.${kind}$`).test(f)).sort();
    } catch {
      names = [];
    }
    for (const name of names) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ name, dir, path: path.join(dir, name) });
    }
  }
  return out;
}

/** 第一个真槽/缩略图；没有 ⇒ `null`（调用方 `t.skip`）。 */
export function firstRealFile(repoRoot: string, kind: 'DAT' | 'STH'): RealFile | null {
  return findRealFiles(repoRoot, kind)[0] ?? null;
}

/** `SAVE78.DAT` → `78`（槽号；`0x1A1` 的 op2 用它选槽）。 */
export function slotNumberOf(name: string): number {
  const m = /^SAVE(\d\d)\.(?:DAT|STH)$/.exec(name);
  if (!m) throw new Error(`不是槽文件名：${name}`);
  return Number(m[1]);
}

/** 读一份真文件的字节（调用方负责先 `firstRealFile`）。 */
export function readReal(file: RealFile): Uint8Array {
  return new Uint8Array(fs.readFileSync(file.path));
}

/**
 * **这个槽是谁写的**（`tickets/T-0146`；判据见本文件头注的表）。
 *
 * 三种结果里只有 `'unknown'` 是"看不懂"—— 调用方必须把它当**失败**（不是跳过）：跳过只允许
 * 用在"已用**正向**判据证明它属于另一类作者"的槽上，否则"跳过"就变成了掩盖真回归的暗门。
 */
export type RealSlotOrigin =
  | { kind: 'engine'; format: number; why: string }
  | { kind: 'ours'; format: 0; why: string }
  | { kind: 'unknown'; format: number | null; why: string };

/**
 * 按**字节内容**判作者。
 *
 * - `engine`：头 `+284` ∈ **1..3**（引擎的 `set:SaveVersion1` 域；真实机 56/56 都是 3，
 *   1/2 是引擎自己的旧布局 —— `saveSlot.ts` 的 `SLOT_GAPS` 记着"仍未解析"，但它们**确实是引擎槽**）。
 * - `ours`  ：`+284` = **0**（`SAVE_FORMAT_PLAIN`）**且** payload 尾块能被 `decodeSlotState` 解出
 *   （`AMYS1\n` + JSON，`frames`/`globals` 在场）⇒ 是本工程 emulator 写的槽。
 * - `unknown`：其余一切（`+284` 不在 0..3、头读不出、format=0 但没有本工程尾块）—— 第三种作者，
 *   两个 E4 用例都会把它报成失败。
 */
export function classifyRealSlot(bytes: Uint8Array): RealSlotOrigin {
  const h = parseSlotHeader(bytes);
  if (!h.ok) return { kind: 'unknown', format: null, why: `头读不出（${h.reason}）` };
  const f = h.header.format;
  if (f >= 1 && f <= 3) return { kind: 'engine', format: f, why: `+284(SaveVersion1)=${f} ∈ 引擎域 1..3` };
  if (f === SAVE_FORMAT_PLAIN) {
    const r = parseSlotFile(bytes);
    if (r.ok && r.data.state) {
      return { kind: 'ours', format: 0, why: `+284=0(SAVE_FORMAT_PLAIN) 且尾块解出本工程状态块（${r.data.state.frames.length} 帧）` };
    }
    return {
      kind: 'unknown',
      format: 0,
      why: `+284=0 但**没有**本工程状态尾块（AMYS1）：${r.ok ? 'state=null' : r.reason}`,
    };
  }
  return { kind: 'unknown', format: f, why: `+284=${f} 既不在引擎域 1..3、也不是本工程 0` };
}
