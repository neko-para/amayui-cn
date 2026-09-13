/**
 * **文本项记录表**（引擎 `Font+3364` 的 `std::vector<记录 72B>`，2026-09 读体落地）。
 *
 * ## 这张表是什么
 * 引擎在**每显示一条文本项**时往一个 72 字节/条的 vector 尾部 push 一条记录，
 * 之后脚本用 `0x1D3`/`0x1D4`/`0x2F3` **按游标扫描**这张表，把结果写回操作数。
 * 它是「**回想/历史（HISTORY）**」与「**语音重播（REPLAYVOICE）**」的数据源：
 * `src/HISTORY.txt` 用 `i1d3` 10 次、`src/REPLAYVOICE.txt` 用 `i1d3`/`i2f3`，
 * 而写入端 `i1d2` 在 941 个脚本里出现 **42760 次**（全语料最高频的原本未实现指令）。
 *
 * ## 引擎实证（raw 行号 = `engine/天结_unpacked.exe_utf8.c`）
 * - **容器**：`Font[841]`(begin) / `Font[842]`(end)，元素步长 **72 字节**（`sub_457960` raw 69340）。
 *   `Font` 基址 = `Engine+85296` ⇒ `Font[841]` = `Engine+88660`（`3364 + 85296`），与 `Font+3364` 一致。
 * - **记录布局**（`sub_45EFA0` raw 74323-74357 / `sub_45EEA0` raw 74286-74320）：
 *   | 偏移 | 含义 |
 *   |---|---|
 *   | `+0` | 所属窗（`Font[307]` = 默认窗；`0x1D2` 传 0 ⇒ 用它） |
 *   | `+20` | `sub_45EFA0` = 第 4 实参（`0x1D2` 的 **op2**）；`sub_45EEA0` = 第 3 实参（语音 id） |
 *   | `+24` | `sub_45EFA0` = 第 3 实参（`0x1D2` 的 **op1**，`0x1D3` 的匹配 key）；`sub_45EEA0` = 第 4 实参（0/1） |
 *   | `+28` | 仅 `sub_45EEA0` 写（第 6 实参；调用点是 `Engine[5053+ch]`） |
 *   | `+32` | 仅 `sub_45EEA0` 写（第 5 实参；`0x1D4`/`0x2F3` 的选择器） |
 *   | `+40` | flags：`0x20000000` = 文本项（`0x1D2`）、`0x40000000` = 语音项（`0xC4`/`0x1BD`/`0x2F4`）；**bit0 = 组首** |
 * - **三个 push 点**（都在 `if (!Engine[97055])` 门内，即 `i1bb 0` 期间不记账）：
 *   `0x1D2`→`sub_45EFA0`（文本项）/ `0xC4`·`0x1BD`→`sub_45EEA0`（语音，通道 0）/ `0x2F4`→`sub_45EEA0`（语音，指定通道）。
 * - **组首标记**：`Font[win+849]`；由 `sub_45EC60`（`0x71` 开的"新一段消息"，raw 74275）在 slot ≥ 0 时置 1，
 *   push 时消费掉并写进记录的 flags bit0 ⇒ **扫描到"下一条记录是组首"就停**（`sub_457960` raw 69356）。
 * - **查询语义**（`sub_457960` raw 69329-69364 / `sub_457A20` raw 69367-69406）：
 *   从 `start` 起扫到组尾，**保留最后一次匹配**（不提前 break，只在组首处停）；
 *   `start` 越界（`<0` 或 `>= count`）直接返回 0 且输出保持初值（`0` / `-1,-1,0`）。
 *
 * ## emulator 的取舍
 * 忠实建模容器/字段/扫描/组首；**不做**的是「文本项被真正画出来」（那是渲染层的事，
 * 本表只承载"账本"语义）。`0x1D3` 的 op3 在引擎里被调用方忽略（`sub_457960` 的第 3 参未用），
 * 这里照样忽略。
 */

/** 记录 flags：文本项（`0x1D2`）/ 语音项（`0xC4`/`0x1BD`/`0x2F4`）/ 组首。 */
export const ITEM_TEXT = 0x20000000;
export const ITEM_VOICE = 0x40000000;
export const ITEM_GROUP_START = 1;

/** 一条 72 字节记录（只建模被读写的字段）。 */
export interface TextItemRecord {
  /** `+0`：所属窗。 */
  win: number;
  /** `+20`：文本项 = `0x1D2` 的 op2；语音项 = 语音 id。 */
  v20: number;
  /** `+24`：文本项 = `0x1D2` 的 op1（查询 key）；语音项 = 0/1（循环位）。 */
  v24: number;
  /** `+28`：语音项的 `Engine[5053+ch]`。 */
  v28: number;
  /** `+32`：语音项的选择器（通道号；`0x1D4`/`0x2F3` 按它匹配）。 */
  sel32: number;
  /** `+40`：见 `ITEM_*`。 */
  flags: number;
}

/** `0x1D3` 的查询结果（`sub_457960`）。 */
export interface TextItemQuery {
  /** 是否命中（引擎返回值 ≠ 0）。 */
  found: boolean;
  /** `+20`。未命中且 `start` 合法时保持 0。 */
  v20: number;
}

/** `0x1D4`/`0x2F3` 的查询结果（`sub_457A20`）。 */
export interface VoiceItemQuery {
  found: boolean;
  /** `+20`（未命中 = -1）。 */
  v20: number;
  /** `+24`（未命中 = -1）。 */
  v24: number;
  /** `+28`（未命中 = 0）。 */
  v28: number;
}

export class TextItemTable {
  /** 记录向量（引擎 `Font[841]..[842]`）。 */
  readonly records: TextItemRecord[] = [];

  /** 每窗的「下一条 push 是组首」标记（引擎 `Font[win+849]`，由 `0x71` 置）。 */
  private readonly groupStart = new Map<number, boolean>();

  /** `sub_45EC60`（`0x71` 新一段消息）：置该窗的组首标记，由下一条 push 消费。 */
  markGroupStart(win: number): void {
    this.groupStart.set(win, true);
  }

  /** push 时消费组首标记（引擎：`if (Font[w+849]) { flags |= 1; Font[w+849] = 0; }`）。 */
  private takeGroupStart(win: number): boolean {
    if (this.groupStart.get(win)) {
      this.groupStart.set(win, false);
      return true;
    }
    return false;
  }

  /**
   * `sub_45EFA0`（`0x1D2`）：**文本项** push。
   * 引擎调用形态 `sub_45EFA0(Font, 0, op1, op2)` ⇒ `+24 = op1`（查询 key）、`+20 = op2`。
   */
  pushText(win: number, key: number, value: number): void {
    this.records.push({
      win,
      v20: value,
      v24: key,
      v28: 0,
      sel32: 0,
      flags: ITEM_TEXT | (this.takeGroupStart(win) ? ITEM_GROUP_START : 0),
    });
  }

  /**
   * `sub_45EEA0`（`0xC4`/`0x1BD`/`0x2F4`）：**语音项** push。
   * 引擎调用形态 `sub_45EEA0(Font, 0, id, loop, sel32, Engine[5053+ch])`。
   */
  pushVoice(win: number, id: number, loop: number, sel32: number, v28: number): void {
    this.records.push({
      win,
      v20: id,
      v24: loop,
      v28,
      sel32,
      flags: ITEM_VOICE | (this.takeGroupStart(win) ? ITEM_GROUP_START : 0),
    });
  }

  /**
   * `sub_457960`（`0x1D3`）：从 `start` 起扫**文本项**、按 `+24 == key` 匹配，取 `+20`。
   *
   * ★两个容易写错的细节（照抄引擎）：①**不提前退出**——同组内后匹配的覆盖前面的（"最后一次命中"）；
   * ②停条件看的是**下一条记录**的组首位（`records[i+1].flags & 1`），不是当前这条。
   */
  queryText(start: number, key: number): TextItemQuery {
    const out: TextItemQuery = { found: false, v20: 0 };
    if (!this.inRange(start)) return out;
    for (let i = start; i < this.records.length; i++) {
      const r = this.records[i]!;
      if ((r.flags & ITEM_TEXT) !== 0 && r.v24 === key) {
        out.v20 = r.v20;
        out.found = true;
      }
      if (i < this.records.length - 1 && (this.records[i + 1]!.flags & ITEM_GROUP_START) !== 0) break;
    }
    return out;
  }

  /**
   * `sub_457A20`（`0x1D4` / `0x2F3`）：从 `start` 起扫**语音项**、按 `+32 == sel` 匹配，
   * 取 `+20`/`+24`/`+28`。初值 `-1/-1/0`（未命中即它们），同样是"组内最后一次命中"。
   */
  queryVoice(start: number, sel: number): VoiceItemQuery {
    const out: VoiceItemQuery = { found: false, v20: -1, v24: -1, v28: 0 };
    if (!this.inRange(start)) return out;
    for (let i = start; i < this.records.length; i++) {
      const r = this.records[i]!;
      if ((r.flags & ITEM_VOICE) !== 0 && r.sel32 === sel) {
        out.v20 = r.v20;
        out.v24 = r.v24;
        out.v28 = r.v28;
        out.found = true;
      }
      if (i < this.records.length - 1 && (this.records[i + 1]!.flags & ITEM_GROUP_START) !== 0) break;
    }
    return out;
  }

  private inRange(start: number): boolean {
    return start >= 0 && start < this.records.length;
  }

  /** 全量 teardown（`0x9 exit-script`）。 */
  reset(): void {
    this.records.length = 0;
    this.groupStart.clear();
  }
}
