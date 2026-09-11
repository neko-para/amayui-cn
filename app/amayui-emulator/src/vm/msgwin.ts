/**
 * **消息窗状态模型**（引擎 `Engine+0x534C` 文本对象 + `Engine+0x15144` 对象表 + ADV 状态字段）。
 *
 * ## 为什么单独建模
 * ADV/消息窗是**跨指令的持续状态**：`show-text` 写内容、`end-text-line` 断行、`wait-for-input`
 * 结束一页并挂起、玩家推进后脚本继续。引擎把这套状态摊在 `_this[1223xx]/[1415]/[9705x]` 与两个
 * 对象表里；emulator 若只把它当整数塞进 `engineValues`，就会出现"位被永久置住、sleep 被跳过、
 * 每帧空转 10000 条指令"这类**无声错误**（2026 实测：TITLE 空转 598000 步/秒）。
 *
 * ## 引擎实证（raw 行号见各字段注释）
 * - `0x6E show-text`(sub_41EB20) / `0x71 message-show`(sub_41ED80) / `0x72 wait-for-input`(sub_41EEF0)：
 *   三者共用同一套骨架 —— **置 `effect_flags |= 0x8000000`（ADV/逐字显示中）受
 *   `GetConfig("message:ReadTextSkip")` 门控**；emulator 无文本渲染 ⇒ 逐字显示视为**立即完成**，
 *   因此这里**不置 ADV**（这正是修掉"位永久置住"的关键）。
 * - `0x72` 在清掉 ADV 之后置 `effect_flags |= 0x80000000`（**等待推进门**）；主循环
 *   `v35 < 0` 分支每帧只调 `sub_411BC0` + `Sleep(2)`，**不派发脚本指令** ⇒ 脚本真正挂起。
 * - `0x71` 是**"开始一段新消息"**：先 `sub_45EC60` 清该窗的文本记录（`win+208` 120B/条向量截断为 0）
 *   与显现游标（`win+132 = 0`），再判 ADV。**不清空就会出现"上一屏文案残留并重新逐字显现"**
 *   —— 见 `MsgWindow.beginNewMessage` 的实证。
 * - 玩家推进由 `sub_411BC0` 经文本队列 `sub_403E70(Engine+21976)` 完成，清 `0x80000000` 并
 *   （必要时）重定位 `ip`。
 *
 * ## 建模范围（明确不做的部分）
 * 文本**布局与 GDI 渲染**（`sub_456430`/`sub_45D660`/`sub_45BE20`/`sub_465390`…）不在此建模：
 * 这里只保存"这段消息有哪些字、有没有注音、有没有显示完"，足够让状态机与控制流忠实。
 */

/**
 * 一段文本 + 其上的注音对（`display-furigana` 0x196）。
 *
 * ★`0x196` 的 op2（本文词）**本身也是一段文本**：引擎把它交给 `sub_46BE30` 的第 3 参
 * （= 要铺排的字符串），op3 作第 4 参（= 该段的注音）。真实剧本里它用来**把一句话从词中间切开**：
 *
 * ```text
 * show-text 0 "「リリィは小さいし、その歳でご主人様とはぐれちゃったら"
 * display-furigana 0 "寂" "さび"          ← 寂 是正文的一部分，上方注 さび
 * show-text 0 "しいよねー。ひとりになるのは…」"
 * ```
 * ⇒ 渲染结果是「…はぐれちゃったら**寂**しいよねー。…」（SC0330.txt:2501-2503 等 6341 处同型）。
 */
export interface MsgSegment {
  text: string;
  /** `[被注音的词, 注音]` —— 0x196 的 op2/op3。 */
  ruby: [string, string][];
  /** 是否已断行（`end-text-line` 0x6F）。 */
  lineEnded: boolean;
}

/** 一个文本槽（引擎 `Font + 1044 + 4*win` = `FontVWindow`；op1 为 0 时用默认窗）。 */
export interface MsgSlot {
  segments: MsgSegment[];
}

/**
 * **一个消息窗的几何**（引擎 `FontVWindow` 的几何字段 —— 这些是**逐窗**的）。
 *
 * 字段与 raw 的对应（见 `docs-new/03-engine/adv-text-rendering.md`）：
 *  - `x/y` ← `win+12/+16`（op `0x70` 的 op4/op5、op `0x198`）
 *  - `w/h` ← `win+20/+24`（op `0x70` 的 op2/op3；同时是 `+36/+40` 的初值）
 *  - `originX/originY` ← `win+28/+32`（op `0x79`）
 *  - `wrapRight/wrapBottom` ← `win+36/+40`（op `0x70` 初值、op `0x1C1` 覆盖）
 *  - `align/alignWidth` ← `win+288/+292`（op `0x303`）
 *  - `background` ← `sub_43B070(dd, 表面, 色)`（op `0x70` 之后引擎用窗口底色填面）
 */
export interface WinGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  originX: number;
  originY: number;
  wrapRight: number;
  wrapBottom: number;
  align: 0 | 1 | 2;
  alignWidth: number;
  background: string | null;
  /**
   * 竖排源矩形修正（引擎 `Font+235112/+235116/+235120/+235124`，op `0x260`）。
   * 引擎在竖排时把**离屏表面的源矩形**按这四个值平移/放大（raw 71665-71671、71844-71851），
   * 目的是避免旋转字形的边缘被裁掉。重写侧直接光栅化字形、不经过源矩形，
   * 因此**只记录不消费**（见 ADR §7）；保留它是为了不把这条脚本意图静默丢掉。
   */
  vPad: { x: number; y: number; dw: number; dh: number };
}

/** 一个窗的逐字显现状态（引擎 `Engine[107704]` 游标 + `Engine[107650]` 节拍定时器）。 */
export interface RevealState {
  /** 已显示到的字形数（跨行累计）。 */
  shown: number;
  /** 本页总字形数。 */
  total: number;
  /** 是否还在推进。 */
  active: boolean;
  /** 下一次推进的墙钟毫秒（`active` 时有效）。 */
  nextAt: number;
}

/**
 * 引擎"一帧"的节拍下限（60Hz 基准）。
 *
 * ## 引擎的显现节拍（已核对，见 `docs-new/03-engine/adv-text-rendering.md` §3.3）
 *  - `sub_45BE20(Font, win)` = **推进一行**：它把 `win+132`（当前行号）**+1**（raw 72366-72368），
 *    用 `obj+44 + 24*行号` 的 24B **行矩形**做源矩形——D3D 路径给该行建一个 DrawItem
 *    （id = `行号 + win+104`，raw 72325），GDI 路径把该行从窗表面 blit 到表面 0（raw 72427）。
 *    ⇒ 24B 记录是**行**记录；120B 记录才是逐字（`sub_458A30`，raw 83776）。
 *  - 它由 `sub_409400` 的**窗口循环每帧每窗各调一次**（raw 13860）；尾部路径（raw 13956-13962）
 *    是 `Sleep(MessageSpeed)` 之后同样只调一次。定时器 `sub_453B60`（raw 66188）**只回答
 *    "这一帧该不该走"**（`period*steps - elapsed >= 0` ⇒ `-1` ⇒ 调用方整帧提前返回），
 *    **不返回"该补几步"**、也不补偿 ⇒ `MessageSpeed` 小于一帧时真正的上限就是帧率。
 *  ⇒ 引擎的 ADV 文本实质是**逐行贴出**（3 行的一页 ≈ 3 帧 ≈ 50ms，几乎瞬间出现）。
 *  - 真正的**逐字**显现是另一条路（raw 20887-20894）：`effect_flags & 0x40000000` 时每帧
 *    `sub_453AF0(Engine+430600)`（阻塞式、节拍正确）+ `sub_45A940(Font, win, 逐字下标, 0)`，
 *    节拍由 `0x73` 的 op10（`sub_453AD0(Engine+430600, ms)`）给，且总门 `win+88`（网格）必须开。
 *    脚本侧只有 `i073`（全库 27 处）会开它 ⇒ 普通 ADV 不走逐字。
 *
 * ## emulator 的取舍（**有意偏离**，不是等价复刻）
 * 宿主把整窗光栅化成一张画布、按"显示前 N 个字形"渲染，所以最接近引擎的映射是
 * **一次推进一个字**：既保留引擎"每帧只走一步 + `MessageSpeed` 节拍"的节奏，
 * 又让逐字过程可见（这正是本工程要的阅读体验；引擎的逐行贴出在重写侧会表现为"整页瞬间出现"）。
 *
 * ## 为什么必须把"一帧"写成时间下限
 * 会话循环里 `present()` 是同步调用（`pixiBackend.present` 不等 vsync），一帧之内可以空转
 * 很多轮 `serviceTextReveal`。若按"每次调用推一个字"，`MessageSpeed=5` 会在一帧内把整页显示完。
 *
 * ★历史错误：曾按"跨过的 tick 数一次补齐"（`ticks = floor((now-nextAt)/speed)+1`）——
 * 那让 `MessageSpeed=5` 变成约 **200 字/秒**（≈ 一帧显示完），正是 2026 反馈"文字出得太快"的根因。
 */
export const REVEAL_FRAME_MS = 1000 / 60;

/** 一次显现推进的节拍（引擎 = 一帧一次推进，且间隔不短于 `message:MessageSpeed`）。 */
export function revealInterval(speedMs: number): number {
  return Math.max(speedMs, REVEAL_FRAME_MS);
}

/** 一个消息窗的几何初值（引擎 `FontVWindow` 构造 + `sub_465390` 的初值）。 */
export function defaultWinGeom(): WinGeom {
  return {
    x: 0,
    y: 0,
    w: 800,
    h: 720,
    originX: 0,
    originY: 0,
    wrapRight: 800,
    wrapBottom: 720,
    align: 0,
    alignWidth: 0,
    background: null,
    vPad: { x: 0, y: 0, dw: 0, dh: 0 },
  };
}

/**
 * **全局字体/描边样式**（引擎 `Font` 对象上的字段 —— 这些是**全局**的，不随窗分）。
 *
 * ★颜色/描边/字号写在这里的**同时**也写进 `engineValues` 的引擎字段下标
 * （21664/21665/21667/21669/21670/21671/80101…），保持"字段即事实"的既有口径；
 * 本结构只是给渲染用的强类型视图。
 */
export interface FontStyle {
  /** 主字号 px（引擎 `Font+201684` ← op `0x75`；下标 71745）。 */
  mainSize: number;
  /** 注音字号 px（引擎 `Font+218584` ← op `0x197`；下标 75970）。 */
  rubySize: number;
  /** 主面名（引擎 `Font+1260` ← op `0x1A5`）。 */
  mainFace: string;
  /** 注音面名（引擎 `Font+1320` ← op `0x2FE`）。 */
  rubyFace: string;
  /** 主字重（引擎 `Font+218516` ← op `0x2BD`）。 */
  mainBold: boolean;
  /** 注音字重（引擎 `Font+218588` ← op `0x2BE`）。 */
  rubyBold: boolean;
  /**
   * 竖排（引擎 `Font+235108` bit0 ← op `0x261`；下标 80101）。**全局**：
   * `i261 1` 全工程 878 处，与 `i261 0`（170 处）配对切换。
   */
  vertical: boolean;
}

export function defaultFontStyle(): FontStyle {
  return {
    mainSize: 30,
    rubySize: 10,
    mainFace: 'Amayui CN',
    rubyFace: 'ＭＳ ゴシック',
    mainBold: false,
    rubyBold: false,
    vertical: false,
  };
}

/**
 * 消息窗对象（引擎 `Engine[21585 + idx]`，字节基址 0x15144）。
 * 字段名用引擎字节偏移，语义尚未逐个定性（见 analysis/fields.json 的 `msgwin_objects`）。
 */
export interface MsgObject {
  /** `+100`：0x212 写（op2）。 */
  f100: number;
  /** `+104` / `+108`：0x213 写的图元区间。 */
  f104: number;
  f108: number;
  /** `+276` / `+280`：0x25D 写的第二组图元区间。 */
  f276: number;
  f280: number;
  /** `+132`：布局重算时清零（sub_404F80）。 */
  f132: number;
}

/**
 * ADV/消息窗状态。
 *
 * 字段名后的 `[K]` 是引擎 DWORD 下标（`_this[K]`），便于与 `analysis/fields.json` 对照。
 */
export class MsgWindow {
  // ---- ADV 状态字段（引擎 reset `sub_40DF10` 会整块清 0，见 docs-new/03-engine/engine-reset-mainloop.md）----

  /** `[122455]`（0x7795C）：本页文本**正在显示中**。仅「逐字显示」路径会置 1。 */
  showing = 0;
  /** `[122496]`（0x77980）：另一显示态标记（与 122455 一起参与 `wait-for-input` 的判定）。 */
  alt = 0;
  /** `[122497]`（0x77984）：bit0 = 注音/内嵌模式，bit16 = 已登记（0x6E 写）。 */
  flags = 0;
  /** `[122368]`（0x77800）：**跳读态**（0x88 写、0x100/`sub_411900` 消费）。 */
  skipping = 0;
  /** `[122370]`（0x77808）：「取消消息键」三态机 0/1/2（由每帧 ADV 路径驱动）。 */
  cancelStage = 0;
  /** `[122371]`（0x7780C）：最近一次的槽号/参数。 */
  lastArg = 0;
  /** `[1415]`（0x161C）：跳读中镜像（与 `[97050]` 同值写入）。 */
  skipMirror = 0;
  /** `[97050]`（0x5EC28）：跳读/自动模式镜像；非 0 时 `wait-for-input` 保留显示态。 */
  skipMode = 0;
  /** `[97051]`（0x5EC2C）：ADV 进入标记（0x19C 置 1、0x19B 清 0）。 */
  advEnter = 0;
  /** `[124331]`（0x1E5B4）：仅 0x19C 读取的保持条件（语义未定）。 */
  hold = 0;
  /** `[97055]`（0x5EC3C）：文本槽号参数（0x6E/0x6F/0x71 传给文本对象）。 */
  textSlotArg = 0;

  // ---- 运行期配置覆盖 ----

  /**
   * `message:ReadTextSkip` 的**运行期覆盖**（0x1CA = `SetConfig` 写入；`null` = 用启动配置）。
   * ★引擎在 `sub_411900` 收掉消息时会把它写回 0，所以它不是常量。
   */
  readTextSkip: number | null = null;

  // ---- 内容 ----

  /** 文本槽（key = 槽号）。 */
  readonly slots = new Map<number, MsgSlot>();
  /** 消息窗对象表（key = 索引 = `Engine[21585 + idx]` 的 idx）。 */
  readonly objects = new Map<number, MsgObject>();

  /** 已结束（`wait-for-input`）的消息页数 —— 诊断用。 */
  pages = 0;

  // ---- 逐字显现（引擎 `sub_409400` 按 `message:MessageSpeed` 推进 + `sub_45BE20` 一步）----

  /** 每窗的显现状态（`null`/缺失 = 该窗无正在进行的显现）。 */
  readonly reveal = new Map<number, RevealState>();

  /**
   * 开始逐字显现（引擎 `0x72`/`0x71` 在 `sub_409400` 里启动，`0x1CE` 也能启动）。
   *
   * `speedMs <= 0` ⇒ **立即显示完**（引擎：`if (!Engine[21668])` 走同步排空 `sub_46CBF0`）。
   * 首个字形也要等**一个节拍**（引擎 `sub_453A60` 把 `steps` 置 1 ⇒ 第一次检查就等满 `period`）。
   */
  beginReveal(win: number, total: number, nowMs: number, speedMs: number): RevealState {
    const st: RevealState =
      speedMs <= 0
        ? { shown: total, total, active: false, nextAt: 0 }
        : { shown: 0, total, active: total > 0, nextAt: nowMs + revealInterval(speedMs) };
    this.reveal.set(win, st);
    return st;
  }

  /** 立即显示完（跳过/点击/`0x1CE` 收尾）。 */
  finishReveal(win: number): void {
    const st = this.reveal.get(win);
    if (st) {
      st.shown = st.total;
      st.active = false;
    }
  }

  /**
   * 按时间推进所有窗的显现游标。返回**本帧有变化的窗**（宿主据此重画）。
   *
   * ★**一次调用最多推进一个字**（引擎一帧只调一次 `sub_45BE20` ⇒ 一帧只走一步；引擎那一步是
   * "一行"，这里刻意改成"一个字"以便逐字可见 —— 推导与取舍见 `REVEAL_FRAME_MS`），
   * 且**不跨节拍补齐**。`speedMs <= 0` 时才一次性显示完（引擎的同步排空分支 `sub_46CBF0`）。
   */
  tickReveal(nowMs: number, speedMs: number): number[] {
    const dirty: number[] = [];
    const interval = revealInterval(speedMs);
    for (const [win, st] of this.reveal) {
      if (!st.active) continue;
      if (speedMs <= 0) {
        st.shown = st.total;
        st.active = false;
        dirty.push(win);
        continue;
      }
      if (nowMs < st.nextAt) continue;
      st.shown += 1; // 引擎 `sub_45BE20`：游标 v17 → v19 = v17 + 1
      st.nextAt = nowMs + interval;
      if (st.shown >= st.total) {
        st.shown = st.total;
        st.active = false;
      }
      dirty.push(win);
    }
    return dirty;
  }

  /** 该窗是否还在逐字显现中。 */
  isRevealing(win?: number): boolean {
    if (win !== undefined) return this.reveal.get(win)?.active === true;
    for (const st of this.reveal.values()) if (st.active) return true;
    return false;
  }

  /** 该窗当前应画出的字形数（无显现状态 ⇒ -1 = 全部）。 */
  revealedOf(win: number): number {
    const st = this.reveal.get(win);
    return st ? st.shown : -1;
  }

  // ---- 文本渲染状态（引擎 `Font` + 10 个 `FontVWindow`）----

  /**
   * 默认窗口索引（引擎 `Font+1228` = `Font[307]`，初值 1；op `0x80` 写）。
   * ★`0x6E`/`0x6F`/`0x196`/`0x71`/`0x72` 的 op1 为 **0** 时一律指它 ——
   * CONFIG.txt 先 `i080 9` 再转 CONFIG1，所以 CONFIG1 里的 `show-text 0` 实际写的是**窗 9**。
   */
  defaultWin = 1;

  /** 全局字体/描边样式（引擎 `Font` 上的一组字段）。 */
  font: FontStyle = defaultFontStyle();

  /** 每窗几何（引擎 `FontVWindow`）。 */
  readonly wins = new Map<number, WinGeom>();

  /** 取（必要时新建）某窗几何。 */
  geom(win: number): WinGeom {
    let g = this.wins.get(win);
    if (!g) {
      g = defaultWinGeom();
      this.wins.set(win, g);
    }
    return g;
  }

  /** 把 op1 解析成真实窗口索引（0 ⇒ `defaultWin`；引擎 `if (!a2) a2 = Font[307]`）。 */
  resolveWin(i: number): number {
    return i === 0 ? this.defaultWin : i;
  }

  /** 取（必要时新建）文本槽。 */
  slot(i: number): MsgSlot {
    let s = this.slots.get(i);
    if (!s) {
      s = { segments: [] };
      this.slots.set(i, s);
    }
    return s;
  }

  /**
   * **开始一段新消息**（引擎 `0x71` → `sub_45EC60` raw 74277-74281）：清空该窗的文本记录。
   *
   * 引擎侧证据（`docs-new/03-engine/adv-text-rendering.md` §3.2 第 1 条）：
   *  - `win+208` 的 **120B/条 文本记录向量**被 `sub_45E570(win+208, 0)` **截断为 0**
   *    （`sub_45D930` 先 erase 同区间；120B 元素尺寸见 raw 73896 `v4 / 120`）；
   *  - 显现游标 `win+132` 复位为 0（raw 74240 `v5[33] = 0`）、`win+284 = 1`、`win+296 = 0`；
   *  - 该窗的离屏表面同步清底（D3D：LockTexture + memset，raw 74248-74256）。
   *
   * 剧本用法印证（`src/$1$SC*.txt`）：**每个 ADV 页末**的
   * `i071 8` / `i071 2`+`i071 1` 模板（各 30227 处）就是"下一页开始前把窗清掉"；
   * `CONFIG.txt:171-172` 的 `i300 9 1 3e8` + `i071 9` 则是"清场后重画样例文案"。
   *
   * ★漏掉清空的症状（2026 实测 `.tmp/amayui-emulator.log`）：上一屏的文本留在槽里，
   *   下一次 `0x71` 把它当新消息**重新逐字显现** ⇒「退出设置后主界面又逐字冒出一行」
   *   「再进设置变成两行」（`[text] win=9 … 已显示=1` / `2 行 38 字`）。
   */
  beginNewMessage(win: number): void {
    const s = this.slots.get(win);
    if (s) s.segments.length = 0;
    // 引擎把显现游标 `win+132` 复位到 0；本模型里"没有状态"= 全部显示，
    // 内容已清空 ⇒ 删掉状态即可（下次 show-text 会重新决定）。
    this.reveal.delete(win);
  }

  /** `show-text`：向槽尾追加一段文本。`i` = op1（0 ⇒ 默认窗）。 */
  appendText(i: number, text: string): void {
    const s = this.slot(this.resolveWin(i));
    const last = s.segments[s.segments.length - 1];
    // 引擎把同一行的多段 show-text 拼成一行（`end-text-line` 才断行），这里照做。
    if (last && !last.lineEnded) {
      last.text += text;
      return;
    }
    s.segments.push({ text, ruby: [], lineEnded: false });
  }

  /**
   * `display-furigana`：把 (本文词, 注音) 挂到当前行。
   *
   * ★**本文词同时追加为文本**（引擎 `sub_46BE30(obj, part, op2, op3, flag)`：op2 是要铺排的串、
   * op3 是该串的注音）。漏掉这一步的症状就是"汉字部分丢失"——注音有、被注音的那个字没了。
   * `i` = op1（0 ⇒ 默认窗）。
   */
  addRuby(i: number, base: string, ruby: string): void {
    const s = this.slot(this.resolveWin(i));
    let last = s.segments[s.segments.length - 1];
    if (!last || last.lineEnded) {
      last = { text: '', ruby: [], lineEnded: false };
      s.segments.push(last);
    }
    last.text += base; // ★本文词也是文本
    last.ruby.push([base, ruby]);
  }

  /** `end-text-line`：结束当前行。`i` = op1（0 ⇒ 默认窗）。 */
  endLine(i: number): void {
    const s = this.slot(this.resolveWin(i));
    const last = s.segments[s.segments.length - 1];
    if (last) last.lineEnded = true;
  }

  /** 取（必要时新建）消息窗对象。 */
  object(idx: number): MsgObject {
    let o = this.objects.get(idx);
    if (!o) {
      o = { f100: 0, f104: 0, f108: 0, f276: 0, f280: 0, f132: 0 };
      this.objects.set(idx, o);
    }
    return o;
  }

  /** 当前页的纯文本（诊断/测试用）。 */
  textOf(i: number): string {
    return this.slot(this.resolveWin(i))
      .segments.map((s) => s.text)
      .join('\n');
  }

  /** 一页结束（`wait-for-input`）：清显示态并计页数。 */
  finishPage(): void {
    this.showing = 0;
    this.alt = 0;
    this.pages++;
  }

  /** 0x19B / 全量 teardown 时的复位（引擎 `sub_40DF10` 的语义子集）。 */
  reset(): void {
    this.showing = 0;
    this.alt = 0;
    this.flags = 0;
    this.skipping = 0;
    this.cancelStage = 0;
    this.lastArg = 0;
    this.skipMirror = 0;
    this.skipMode = 0;
    this.advEnter = 0;
    this.hold = 0;
    this.slots.clear();
    this.objects.clear();
    this.wins.clear();
    this.font = defaultFontStyle();
    this.reveal.clear();
  }
}
