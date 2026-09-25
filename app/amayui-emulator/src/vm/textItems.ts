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

/**
 * 记录 flags **bit2**：**带正文串的「已画文本行」记录**（`tickets/T-0170`）。
 *
 * 写者是**渲染层的** `sub_45F090`（raw 74360-74400；调用点 raw 76446 / 79248 与 `sub_4691A0`
 * raw 81526 → 其调用者 `sub_46BE30` raw 83364 一族）：它把 `+44` 的 `std::string` **一起**写进记录
 * （`sub_40C210((int)v13, Src, strlen(Src))` raw 74395）——这与 `0x1D2` 的 `sub_45EFA0`
 * （raw 74352 传空串 `byte_51EA3C`）**结构相同、内容不同**，所以「有正文的行」必须用一个独立的位
 * 才能与 `0x1D2` 的标记记录区分开。
 *
 * `0x1D1` 的落点 `sub_4675A0` 读它两处：`(v39[40] & 4)` 决定走**逐字绘制**那条分支
 * （raw 80725-80752：把**连续**若干条 `flags&4` 记录的串 `memcpy` 拼成一整行再逐字画），
 * 而 `a4 & 4`（= op3 的 bit2）是"不要贴这一行"的抑制位（raw 80773 `v196`）。
 */
export const ITEM_ROW_TEXT = 0x4;

/**
 * 记录 flags **bit3**：**换行记录**（字符串为空）。
 *
 * 写者 `sub_4691D0`（raw 81530-81553）：`sub_4691A0(_this, win, a3 | 8, v6, 0, &unk_51F030)`
 * ——**空串**（`unk_51F030`）+ 位 `|8`；调用点 raw 82667 / 83094（排版/换行的收尾）。
 * `sub_4675A0` 读它做**行推进**：raw 80718-80724 `v208 = win+28; v209 += Font[1380] + sub_404EC0(Font)`。
 */
export const ITEM_ROW_LINE = 0x8;

/**
 * `0x1D1`/`0x82` 的 **op3（引擎形参 `a4`）位**。
 *
 * ★**别把 op3 的位与记录 `flags` 的位混起来**：引擎两边用的是同一批数值但语义完全不同 ——
 * `a4 & 1` = 允许穿过重排哨兵 / 记录 `flags & 1` = 组首；`a4 & 2` = 覆写颜色 / `flags & 2` = 重排哨兵；
 * `a4 & 4` = 抑制这一行的贴图 / `flags & 4` = 带正文串的行；`a4 & 8` = 允许贴语音图标 / `flags & 8` = 换行记录。
 * 四对纯属巧合，所以这里给 op3 单独命名。
 */
export const REPAINT_ALLOW_REFLOW = 0x1; // raw 80676
export const REPAINT_SET_COLORS = 0x2; // raw 80629-80634 / 81470-81473
export const REPAINT_SUPPRESS_ROW = 0x4; // raw 80773 `v196`
export const REPAINT_VOICE_ICONS = 0x8; // raw 80680
export const REPAINT_RUBY_RANGE = 0x30; // raw 80607（移除 `win+276/+280` 区间）
export const REPAINT_KEEP_SURFACE = 0x40; // raw 80591（不清旧表面 / 不移除 `win+104/+108`）

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
  /**
   * `+44`：**`std::string`（MSVC x86，24 B：buf@+44 / size@+60 / capacity@+64）**。
   *
   * ★`tickets/T-0170` 新增（旧模型只建了 `+20/+24/+28/+32/+40`）：引擎里**只有**
   * `sub_45F090` 那条路会写非空串（`ITEM_ROW_TEXT` 记录），`0x1D2`/`0xC4` 一族的记录恒空串。
   * `0x1D1` 的落点读它的三处：raw 80736-80739 / 80741-80745 / 81022-81036。
   */
  text?: string;
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

/** 记录在本轮切片里的分类（引擎 `sub_4675A0` 的 `if` 链 raw 80676-80725 的逐条落点）。 */
export type RecallRecordKind =
  /** `flags & 0x20000000`（`0x1D2` 标记）：**不画**，只跳过（raw 80711-80717）。 */
  | 'text-marker'
  /** `flags & 0x40000000`（语音项）：`op3 & 8` 时才贴图标（raw 80678-80699）。 */
  | 'voice'
  /** `flags & 4`：带正文串的行（raw 80725-81014）。 */
  | 'row-text'
  /** `flags & 8`：换行记录（raw 80718-80724）。 */
  | 'row-line'
  /** 其余（`flags & 4` 为 0、但有串）：走 raw 81016-81014 的"整串"分支。 */
  | 'row-other';

/** 切片里的第三条记录（诊断/守卫用；**不含**任何页/滚动/高亮概念）。 */
export interface RecallRecord {
  /** 在 `records` 里的下标。 */
  index: number;
  /** `+40`。 */
  flags: number;
  kind: RecallRecordKind;
  /** `+44`（`row-text`/`row-other` 才有意义）。 */
  text?: string;
}

/** 语音图标项（引擎 `sub_4BB840((int)v167, 通道, 记录+20, +24, +28)` raw 80693）。 */
export interface RecallVoiceIcon {
  /** 记录 `+20`（引擎当通道号用；`v40 = *((_DWORD *)v39 + 8)` raw 80682 —— **+32**）。 */
  channel: number;
  x: number;
  y: number;
  z: number;
  /** 引擎 raw 80683 的 `sub_404CB0(语音) && v212[channel] > 0` ⇒ 走 `sub_409E10` 分支（不贴图标）。 */
  suppressed: boolean;
}

/**
 * `0x1D1`（`sub_420310` → `sub_4675A0` raw 80313-81522）那一圈记录循环的结果。
 *
 * ★**它不是"页面模型"**：引擎体里**没有**滚动位置、没有选中页高亮、没有页索引
 * （那三件事由 `src/HISTORY.txt` 自己做：`i1d0`/`i1d3` 取页与记录、`draw-texture` 画框与高亮，
 * 见 `HISTORY.txt:1128-1314`；`0x1D1` 只被它调 **1 次**）。本结构就是 raw 80664-81014
 * 那一圈 `for (i = op2; …)` 的**忠实切片结果**。
 */
export interface RecallRepaint {
  /** 重画目标窗（引擎 `a2`；op1 经 `resolveWin` 解析后）。 */
  win: number;
  /** `0x1D1` 的 op2（起始记录下标）。 */
  start: number;
  /** 半开区间右端：引擎 `v197` 停下的位置。 */
  end: number;
  /** 停止原因（raw 80708 / 80705 / 81011 三条出口；`range` = 越界门 raw 80529 拦下，一条都没切）。 */
  stop: 'eof' | 'reflow' | 'group-start' | 'range';
  /** 逐条分类结果（含被跳过的标记记录）。 */
  records: RecallRecord[];
  /** 按引擎 `memcpy` 规则拼好的**正文行**（连续 `flags&4` 记录拼成一行，raw 80731-80752）。 */
  lines: string[];
  /** 语音图标项（`op3 & 8` 为 0 时这里恒空 —— 引擎那一段整个被跳过）。 */
  voiceIcons: RecallVoiceIcon[];
  /** 每通道已贴计数（引擎 `v212[10]`，raw 80655/80696）。 */
  channelSeen: number[];
  /** 该窗走专用路径（窗对象 `+112 == 1` ⇒ `sub_4634B0`，raw 80531-80532）。 */
  dedicatedPath: boolean;
}

/** `repaintRange` 的输入（= `0x1D1` 的实参与两处窗对象判定）。 */
export interface RecallRepaintOpts {
  /** 解析后的窗号（引擎 `a2`；也是 `win+112` 专用路径判定与重画目标）。 */
  win: number;
  /** `op3`（引擎 `a4`，char）。 */
  mode: number;
  /** 该窗 `+112 == 1` ⇒ 引擎改走 `sub_4634B0`（专用 GDI 变体，raw 77500-78716）。 */
  dedicatedPath: boolean;
  /**
   * `sub_404CB0(语音对象)`：**有语音通道占线**（raw 80683）。
   *
   * emulator **恒传 `false`** —— 语音对象的 3 通道占用没有对外查询缝（登记在 `missing[]`）。
   * 传 `true` 时引擎会走"该通道已贴过就不贴"的另一支（raw 80685 `sub_409E10`）。
   */
  voiceBusy: boolean;
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
   * `sub_45F090`（raw 74360-74400）：**已画文本行** push（`tickets/T-0170`）。
   *
   * 引擎调用形态 `sub_45F090(_this, win, flags, rect4, a5, a6, Src)`：
   * `v12[0] = win`（+0）、`v12[1..4] = a4[0..3]`（+4..+16）、`v12[5] = Font[340]`（+20 填充色）、
   * `v12[6] = Font[341]`（+24 描边色）、`v12[7] = Font[342]`（+28）、`v12[8] = a6`（+32）、
   * `v12[9] = a5`（+36）、`v12[10] = a3`（+40 flags，`_this[win+849]` 时 `|= 1` 组首）、
   * 以及 `sub_40C210(&v13, Src, strlen(Src))` 建出的 `+44` 串。
   *
   * ★**记账门在调用方、不在本函数**（`T-0151` 订正）：`sub_45F090` 体里确实没有 `Engine[97055]`
   * 的引用，但它的**唯一**文本入队调用点 `sub_46BE30` 有 —— `if ( a5 >= 0 ) sub_4691A0(…)`
   * （raw **83941-83942**，`a5` = `0x6E`/`0x196` 传进去的 `Engine[97055]`）⇒ `i1bb 0` 期间
   * **不 push 本记录**。换行记录的那条路同理（`sub_4691D0` raw **81549** 的 `if ( a3 >= 0 )`）。
   * emulator 的对应门 = `handlers/msgwin.ts` 的 `recordGateOpen()`。
   *
   * ★emulator 只在"文本入队"那一刻 push（`0x6E`/`0x196`），粒度 = **一次 `sub_46BE30` 调用**
   *   （= 一段文本），与引擎的逐段绘制一致；整行由 `repaintRange` 按引擎的 `memcpy` 规则拼回。
   */
  pushRenderedRow(win: number, text: string, fill: number, outline: number): void {
    this.records.push({
      win,
      v20: fill, // +20 ← Font[340]
      v24: outline, // +24 ← Font[341]
      v28: 0,
      sel32: 0,
      flags: ITEM_ROW_TEXT | (this.takeGroupStart(win) ? ITEM_GROUP_START : 0),
      text,
    });
  }

  /**
   * `sub_4691D0`（raw 81530-81553）：**换行记录** push —— `sub_4691A0(_this, win, a3 | 8, v6, 0, &unk_51F030)`，
   * 即 `flags |= 8` 且串为**空**（`unk_51F030`）。`sub_4675A0` 用它推进行（raw 80718-80724）。
   */
  pushLineFeed(win: number): void {
    this.records.push({
      win,
      v20: 0,
      v24: 0,
      v28: 0,
      sel32: 0,
      flags: ITEM_ROW_LINE | (this.takeGroupStart(win) ? ITEM_GROUP_START : 0),
      text: '',
    });
  }

  /**
   * **`0x1D1` 的记录循环**（`sub_4675A0` raw 80664-81014 的忠实切片）。
   *
   * 循环骨架（逐句对着 raw 抄）：
   * ```c
   * v34 = (Font+3368 − Font+3364) / 72;          // 记录条数
   * for ( i = a3; ; i = v197 ) {
   *   v38 = 记录[i].flags;                        // raw 80672
   *   if ( (v38 & 2) != 0 && (a4 & 1) == 0 ) goto LABEL_204;      // raw 80676：停止
   *   if ( (v38 & 0x40000000) == 0 ) break;       // raw 80678：非语音 ⇒ 出循环走文本路径
   *   if ( (a4 & 8) != 0 ) { …贴图标…; ++v212[通道]; }             // raw 80680-80699
   *   if ( i >= v34 - 1 ) goto LABEL_203;         // raw 80701
   *   if ( (记录[i+1].flags & 1) != 0 ) goto LABEL_204;           // raw 80703/LABEL_202：停止
   * LABEL_203: if ( ++v197 >= v34 ) goto LABEL_204;
   * }
   * // 文本路径（raw 80711 起）：
   *   if ( (v38 & 0x20000000) != 0 ) { …若下一条是组首则停，否则 ++i 继续… }
   *   else { if ((v39[40] & 8) != 0) 行推进; if ((v39[40] & 4) != 0) 逐字画; else 整串画;
   *          …若下一条是组首则停，否则 ++i 继续… }
   * ```
   *
   * 三条**出口**（`stop`）：`eof`（`++i >= 条数`）、`reflow`（`flags&2` 且 `!(mode&1)`）、
   * `group-start`（下一条记录带组首位）。
   *
   * `lines` = 引擎 raw 80731-80752 那段 `memcpy(&v214[j-1], 串, strlen(串))` 的等价物：把
   * **连续**的 `flags&4` 记录的串接成一行；`flags&8` 记录是**行推进**（它自己不带正文，
   * 见 `ITEM_ROW_LINE`），照引擎在 `row-line` 处**结束当前行**。
   */
  repaintRange(start: number, opts: RecallRepaintOpts): RecallRepaint {
    const mode = opts.mode;
    const out: RecallRepaint = {
      win: opts.win,
      start,
      end: start,
      stop: 'eof',
      records: [],
      lines: [],
      voiceIcons: [],
      channelSeen: new Array<number>(10).fill(0),
      dedicatedPath: opts.dedicatedPath,
    };
    const n = this.records.length;
    /** 引擎的越界门是**调用方**的（raw 80529）—— 这里再兜一次，切片本身恒安全。 */
    if (start < 0 || start >= n) {
      out.stop = 'range';
      return out;
    }
    /** 当前正在拼的正文行（引擎的 `v214` 缓冲）。 */
    let line = '';
    let lineOpen = false;
    const flushLine = (): void => {
      if (lineOpen) out.lines.push(line);
      line = '';
      lineOpen = false;
    };
    for (let i = start; i < n; i++) {
      const r = this.records[i]!;
      const flags = r.flags;
      // raw 80676：重排记录是**切页哨兵**；只有 op3 bit0 才允许穿过它。★这一条**不消费**记录
      // （引擎是 `goto LABEL_204`，在 `for` 的 `i = v197` 自增**之前**）⇒ `end` 仍指向它。
      if ((flags & ITEM_REFLOW) !== 0 && (mode & REPAINT_ALLOW_REFLOW) === 0) {
        out.end = i;
        out.stop = 'reflow';
        return out;
      }
      out.end = i + 1;
      // raw 80711：`0x1D2` 的标记记录不画（它没有正文）。
      if ((flags & ITEM_TEXT) !== 0) {
        out.records.push({ index: i, flags, kind: 'text-marker' });
      } else if ((flags & ITEM_VOICE) !== 0) {
        const channel = r.sel32; // 引擎 `*((_DWORD *)v39 + 8)` = 记录 +32 = 本模型的 `sel32`
        out.records.push({ index: i, flags, kind: 'voice' });
        if ((mode & REPAINT_VOICE_ICONS) !== 0) {
          // raw 80680：整个图标分支只在 `a4 & 8` 下执行。
          const seen = out.channelSeen[channel] ?? 0;
          const suppressed = opts.voiceBusy && seen > 0; // raw 80683-80686
          out.voiceIcons.push({ channel, x: r.v20, y: r.v24, z: r.v28, suppressed });
          if (!suppressed) out.channelSeen[channel] = seen + 1; // raw 80696 `++v212[v40]`
        }
      } else if ((flags & ITEM_ROW_LINE) !== 0) {
        // raw 80718-80724：行推进（`v209 += Font[1380] + sub_404EC0(Font)`）—— 位置由排版承担，
        // 这里只承担"这一行到此为止"。引擎在这一支之后仍会走"整串"分支画一个**空串**（无可见效果）
        // ⇒ 照抄其后果 = 不产生任何行。
        out.records.push({ index: i, flags, kind: 'row-line' });
        flushLine();
      } else if ((flags & ITEM_ROW_TEXT) !== 0) {
        out.records.push({ index: i, flags, kind: 'row-text', text: r.text ?? '' });
        line += r.text ?? ''; // raw 80745 的 memcpy（连续若干条拼成一整行）
        lineOpen = true;
      } else {
        // raw 81016 起：`flags&4` 为 0 的"整串"分支 —— 它自己就是一整行。
        out.records.push({ index: i, flags, kind: 'row-other', text: r.text ?? '' });
        flushLine();
        out.lines.push(r.text ?? '');
      }
      // raw 80703 / 80715 / 81011-81013：**下一条**是组首 ⇒ 停（看的是下一条，不是当前这条）。
      const next = this.records[i + 1];
      if (next === undefined) {
        out.stop = 'eof'; // raw 80708 `if (++v197 >= v34) goto LABEL_204`
        break;
      }
      if ((next.flags & ITEM_GROUP_START) !== 0) {
        out.stop = 'group-start';
        break;
      }
    }
    flushLine();
    return out;
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
