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
 * ## 回看页索引表 + 双游标（`T-0095`，2026-09 读体落地）
 * 引擎里**同一张表**还有第二条用途：**回想/回看页导航**。三个成员：
 * | 引擎字段 | Font 偏移 | 语义 | 写者（raw 行号） |
 * |---|---|---|---|
 * | `Font[845..847]` | `+3380/+3384/+3388` | **回看页索引表**，8 B/条 = `{窗号@+0, 起始记录下标@+4}` | `0x70` raw **73186**、`0x71` raw **74271**、读档 raw 74494 |
 * | `Font[859]` | `+3436` | `baseCursor` = push 时刻的末项下标（"LIVE 页"） | raw **73189** / **74273** |
 * | `Font[860]` | `+3440` | `cursor` = 当前读游标（`0x1D0` 用它做相对步数的起点） | raw **73190** / **74274**；移动见 `sub_459770` raw 70574-70627 |
 * 每次 push 都写这三者（`cursor = baseCursor = pages.length - 1`），**读端从不改游标**
 * （`sub_459860` raw 70650 只把 `Font[860]` 拷进局部变量 `v5`）。
 *
 * ## emulator 的取舍
 * 忠实建模容器/字段/扫描/组首；**不做**的是「文本项被真正画出来」（那是渲染层的事，
 * 本表只承载"账本"语义）。`0x1D3` 的 op3 在引擎里被调用方忽略（`sub_457960` 的第 3 形参 `a3`
 * 在 raw 69328-69364 全函数体里一次都没出现 ⇒ 调用方 raw 38124 那次 `sub_41BF50(_this, 3)`
 * 是**声明的死读**），这里照样忽略 —— 不补"只读不用"的裸读（那是把死读搬进 emulator）。
 *
 * 页表的**持久化**（引擎 `SaveTextBuf.dat`：写 `sub_457CE0` raw 69504-69664 首 dword = 页条数、
 * 随后 8 B/条；读 `sub_45F1B0` raw 74403- 先清两表再逐条 push，raw 74490-74494）在 emulator 侧
 * 由 `../advState.ts` 的快照承担（`backlog` 字段）。
 */

/** 记录 flags：文本项（`0x1D2`）/ 语音项（`0xC4`/`0x1BD`/`0x2F4`）/ 组首。 */
export const ITEM_TEXT = 0x20000000;
export const ITEM_VOICE = 0x40000000;
export const ITEM_GROUP_START = 1;
/**
 * 记录 flags **bit1**：`0x1D0` 的过滤掩码（`sub_42D440` raw 38107 的末参**字面量常量 `2`**，
 * 不是操作数 —— 所以它不是"脚本可配"的门，读端与两条写端都不检查任何配置开关）。
 *
 * 写者是渲染层的 `sub_46CC60`（raw 84018-84083：`sub_46CBF0(_this, a2, v14, 0, 2)` raw 84047
 * → `sub_46BE30` → `sub_4691A0` → `sub_45F090`，即「**重排/重贴已有行**」那条路径）。
 * emulator 不重放文本绘制 ⇒ 该位在正常运行时**恒 0**、过滤器落空；这条路径照抄引擎，
 * 语义由 `test/op-1d0-page-index.test.ts` 直接置位记录 flags 来验证（不假装有语料覆盖）。
 */
export const ITEM_REFLOW = 0x2;

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

/** 回看页索引表的一条（引擎 `Font+3380`，8 B/条）。 */
export interface BacklogPage {
  /** `+0`：窗号（**已解析**过的窗号：`0x70`/`0x71` 的 `0` ⇒ 默认窗，raw 73148-73152 / 74221-74225）。 */
  win: number;
  /** `+4`：该页起点在 72 B 记录表里的下标 = **push 时刻的 `records.length`**（raw 73183 / 74269）。 */
  start: number;
}

/** `0x1D0` 的读出结果（`sub_459860`）。 */
export interface BacklogPageAt {
  /** 页窗口号；任何失败路径都是 `-1`（`sub_459860` raw 70648-70649 的初值）。 */
  win: number;
  /** 记录表起始下标；失败 = `-1`。 */
  start: number;
  /**
   * `sub_459860` 的**返回值**（0/1）。
   * ★照抄引擎的怪癖：`LABEL_22`（raw 70710-70716）在"表空 / 下标越界"时**写 `-1/-1` 却返回 1**，
   * 而负步数（raw 70673）与正步数（raw 70686/70690/70692）的失败路径返回 **0**。
   * 调用方 `sub_42D440` 忽略它（raw 38107 不检查返回值），所以它只对 `sub_459770` 那类消费者有意义。
   */
  ret: number;
}

export class TextItemTable {
  /** 记录向量（引擎 `Font[841]..[842]`）。 */
  readonly records: TextItemRecord[] = [];

  /** 回看页索引向量（引擎 `Font[845]..[847]`，`Font+3380`）。 */
  readonly pages: BacklogPage[] = [];

  /** 当前读游标（引擎 `Font[860]`，`Font+3440`）。 */
  cursor = 0;

  /** push 时刻的末项下标（引擎 `Font[859]`，`Font+3436`）；`moveCursor(0, …)` 的复位目标。 */
  baseCursor = 0;

  /** 每窗的「下一条 push 是组首」标记（引擎 `Font[win+849]`，由 `0x71` 置）。 */
  private readonly groupStart = new Map<number, boolean>();

  /** `sub_45EC60`（`0x71` 新一段消息）：置该窗的组首标记，由下一条 push 消费。 */
  markGroupStart(win: number): void {
    this.groupStart.set(win, true);
  }

  /**
   * 回看页 push（`sub_45D240(Font+3380, pair)` raw 72987-73011；调用点 `0x70` raw 73186 /
   * `0x71` raw 74271 / 读档 raw 74494）：`{窗号, 起始记录下标}`，并把双游标都指向新末项。
   *
   * ★`start = records.length` **就是 push 时刻的记录条数**（raw 73183/73184 `v15` 之后 `v17[1] = v15`），
   * 不是"该窗的记录条数" —— 记录表是**全窗共用**的一张。
   */
  pushPage(win: number): void {
    this.pages.push({ win, start: this.records.length });
    const last = this.pages.length - 1;
    this.baseCursor = last; // raw 73189 / 74273（`Font[859]`）
    this.cursor = last; // raw 73190 / 74274（`Font[860]`）
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

  /**
   * `sub_459860`（raw 70629-70724）：**带符号相对步数**读回看页 —— `0x1D0` 的落点。
   *
   * 语义（`step` = `0x1D0` 的 op3，`mask` = 掩码，`0x1D0` 恒传常量 `2`）：
   *  - `step == 0` ⇒ 直接落 `LABEL_22`，输出**当前游标所指的那一页**；
   *  - `step > 0` ⇒ 向"新"走 `step` **格**；`step < 0` ⇒ 向"旧"走 `-step` 格。
   *  「格」的计数（raw 70666 / 70694）：候选页的 `start` 必须在记录表内、且
   *  `(mask & records[start].flags) == 0`、且与**上一条被计数的页**指向不同记录（去重）⇒ 才算一格。
   *
   * **不改游标**（`Font[860]` 只在 raw 70650 被拷进局部 `v5`）⇒ 反复调用 `pageAt` 幂等。
   *
   * 失败路径（都写 `-1/-1`）：表空/下标越界（raw 70712）、后退到 `v5 <= 0`（raw 70659）、
   * `v6 == 0`（raw 70657 的 `while(v6)`）、`start >= 记录条数`（raw 70664/70692）、
   * 前进越过末页（raw 70686）、前进撞上**末条目的 start**（raw 70689，即"LIVE 页"哨兵）。
   *
   * ★raw 70657 的 `while (v6)` 把**记录下标 0 当"空/结束"哨兵**：记录 0 是合法下标（表里确实有），
   * 所以后退到 `pages[i].start === 0` 时会**提前退出**并返回 `-1/-1`，而不是返回第 0 页。
   * 意图未求证（design.md §9 不确定项 3）⇒ 照抄，不"修正"。
   */
  pageAt(step: number, mask: number): BacklogPageAt {
    const out: BacklogPageAt = { win: -1, start: -1, ret: 0 };
    let v5 = this.cursor;
    const recCount = this.records.length;
    /** `*(Font[845] + 8*i + 4)`：页 `i` 的起始记录下标。 */
    const pageStart = (i: number): number => this.pages[i]?.start ?? 0;

    if (step < 0) {
      let v20 = -step;
      let v6 = pageStart(v5);
      for (;;) {
        // ---- LABEL_3（raw 70655-70656）----
        const v18 = v6;
        let counted = false;
        while (v6 !== 0) {
          if (v5 <= 0) return out; // raw 70659 → break → raw 70673 return 0
          v6 = pageStart(v5 - 1); // raw 70661：**先用旧 v5 取址**（= `8*v5 - 4`）
          --v5; // raw 70663 ⇒ 该条即第 v5 页
          if (v6 >= recCount) return out; // raw 70664
          if ((mask & this.recordFlags(v6)) === 0 && v6 !== v18) {
            // raw 70666：掩码门 + 去重 ⇒ 计一格
            counted = true;
            break;
          }
        }
        if (!counted) return out; // raw 70657 的 `while(v6)` 为假（v6 == 0）⇒ raw 70673 return 0
        if (--v20 > 0) continue; // raw 70668 ⇒ goto LABEL_3
        return this.pageResult(v5, out); // raw 70670 ⇒ goto LABEL_22
      }
    }

    if (step > 0) {
      let remain = step; // 引擎就地 `--a4`（raw 70700）
      let v12 = this.pages.length;
      let v19 = pageStart(v5); // raw 70681：去重基准 = **初始**页的 start
      for (;;) {
        ++v5; // raw 70684
        if (v5 >= v12) return out; // raw 70686：越过末页
        const v15 = pageStart(v5); // raw 70688（`v11 += 2` = 下一条的 second）
        if (v15 === this.lastPageStart()) return out; // raw 70689：撞上"末条目的 start"（LIVE 页）
        if (v15 >= recCount) return out; // raw 70692
        if ((mask & this.recordFlags(v15)) !== 0 || v15 === v19) {
          v12 = this.pages.length; // raw 70696：掩码命中/重复 ⇒ 不计格，继续找
        } else {
          if (--remain <= 0) break; // raw 70700：计满 ⇒ 取该页
          v12 = this.pages.length; // raw 70704
          v19 = pageStart(v5); // raw 70706：换去重基准
        }
      }
    }

    return this.pageResult(v5, out); // ---- LABEL_22（raw 70710-70722）----
  }

  /**
   * `sub_459770`（raw 70574-70627）：**按相对方向移动游标** `Font[860]`（`0x1D0` 不走这条，
   * 它由 `0x84` 与渲染/UI 路径使用：调用点 raw 14018/14025、20040-20055、20347-20355、28847-28923）。
   *
   * `dir == 0` ⇒ `cursor = baseCursor` 并返回 1（raw 70624-70625，"回到 LIVE 页"）；
   * `dir > 0`/`dir < 0` ⇒ 跳过掩码命中页与**与出发页同 `start`** 的页，走满一格返回 1；
   * 走到头（含撞上末条目哨兵）返回 0，且 `dir > 0` 时把游标**回退到末项**（raw 70603）。
   */
  moveCursor(dir: number, mask: number): number {
    if (dir === 0) {
      this.cursor = this.baseCursor; // raw 70624-70625
      return 1;
    }
    // 防御：引擎在空表/越界时读裸内存（`*(Font[846]-4)`、`records[start]`）⇒ 这里给等价的"失败"。
    if (this.pages.length === 0) return 0;
    const last = this.lastPageStart();
    const from = this.pages[this.cursor]?.start ?? 0; // raw 70589：去重基准 = 出发页
    if (dir > 0) {
      for (;;) {
        const v10 = ++this.cursor; // raw 70594
        if (v10 >= this.pages.length) {
          this.cursor = v10 - 1; // raw 70603：游标回退到末项
          return 0;
        }
        const v11 = this.pages[v10]!.start; // raw 70597
        if (v11 === last) return 0; // raw 70598-70599：LIVE 页哨兵
        if ((mask & this.recordFlags(v11)) === 0 && v11 !== from) return 1; // raw 70600-70601
      }
    }
    for (;;) {
      const v6 = this.cursor; // raw 70609
      if (!(this.pages[v6]?.start ?? 0) || v6 <= 0) break; // raw 70610（同 raw 70657 的 0 哨兵）
      const v8 = v6 - 1; // raw 70613
      this.cursor = v8; // raw 70614
      const v9 = this.pages[v8]!.start; // raw 70615
      if ((mask & this.recordFlags(v9)) === 0 && v9 !== from) return 1; // raw 70616-70617
    }
    return 0; // raw 70620
  }

  /**
   * `0x85` = `sub_418F50` → `sub_45EBE0`（raw 74182-74194）：**清空两张表**
   * （72 B 记录表 `Font[841..842]` resize(0) + 8 B 页表 `Font[845..846]` resize(0)）。
   *
   * ★与 `reset()` 的差别（照抄引擎的**不对称**，别"顺手补全"）：`sub_45EBE0` **不碰**
   * `Font[859]`/`Font[860]` 这两个游标，也**不碰** `Font[849+win]` 组首标记。
   * 因为页表已空，`pageAt` 随后的"表空"分支（raw 70712）必然写 `-1/-1` ⇒ 残留游标不可观测。
   */
  clearBacklog(): void {
    this.records.length = 0; // raw 74188-74189（`sub_45DA10` 逐个析构 + `sub_45E730(_,0)`）
    this.pages.length = 0; // raw 74190-74193（`_this[846] = _this[845]` + `sub_45D1B0(_,0)`）
  }

  /** `+40`：记录 flags（越界读给 0 —— 引擎此时读裸内存）。 */
  private recordFlags(i: number): number {
    return this.records[i]?.flags ?? 0;
  }

  /** `*(Font[846] - 4)` = 页表**末条目**的起始下标（"LIVE 页"哨兵）。 */
  private lastPageStart(): number {
    return this.pages.length ? this.pages[this.pages.length - 1]!.start : 0;
  }

  /** ---- LABEL_22（raw 70711-70722）：表空/越界 ⇒ 写 `-1/-1` 但**返回 1**。 ---- */
  private pageResult(idx: number, out: BacklogPageAt): BacklogPageAt {
    const n = this.pages.length;
    if (n <= 0 || n <= idx) {
      out.win = -1;
      out.start = -1;
      out.ret = 1;
      return out;
    }
    const p = this.pages[idx]!;
    out.win = p.win;
    out.start = p.start;
    out.ret = 1;
    return out;
  }

  private inRange(start: number): boolean {
    return start >= 0 && start < this.records.length;
  }

  /** 全量 teardown（`0x9 exit-script`）——含页表与双游标。 */
  reset(): void {
    this.clearBacklog();
    this.groupStart.clear();
    this.cursor = 0;
    this.baseCursor = 0;
  }
}
