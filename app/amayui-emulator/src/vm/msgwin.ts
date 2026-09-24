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
 * （唯一的例外是入队时的**字体/颜色快照** `MsgSlot.fontStyle`：它不是渲染细节，而是
 * "谁最后写全局样式"这一**状态泄漏**的边界 —— 见 `FontStyleSnapshot`。）
 */
import type { FontStyleSnapshot } from '../text/layout.js';

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
  /**
   * **本页文本入队时的字体/颜色快照**（`null` = 还没有内容 ⇒ 用当前全局样式）。
   *
   * ★引擎在**排版时**就把字形连同颜色画进该窗的离屏表面，之后再改全局 `Font+1360/+1364`
   * 不会回溯；本模型是"每次光栅化时读样式" ⇒ 必须在这里把入队那一刻的样式钉住，
   * 否则 `CONFIG2` 逐行改色会把已排好的 ADV 样例窗一起染色（用户实测的"颜色溢出"）。
   * 详见 `FontStyleSnapshot` 的说明。
   */
  fontStyle: FontStyleSnapshot | null;
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
 *  - `background` ← ★**没有引擎来源**（见字段上的说明 + `tickets/T-0102` 的取证）
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
  /**
   * 窗底色（`#rrggbb`）。★**恒 `null`：全 `src/` 没有写入点**。
   *
   * ★2026-09 取证订正（`tickets/T-0102`，用 `.lst` 级复核）——本条原写「← `sub_43B070(dd, 表面, 色)`
   *   （op `0x70` 之后引擎用窗口底色填面）」，**被证伪**：
   *   ① `sub_43B070` = **`ddSetColor` / `SetColorKey`**（`.lst:97104` 起；错误串 `"関数：ddSetColor エラー"`
   *      + 尾调用 `mov eax,[ecx+74h]` = 表面 vtable+0x74，参 `8` = `DDCKEY_SRCBLT`）——**不是填面**；
   *      真正的填面是 `sub_43E260`（= `ddFillSurface`，`.lst:102245` 起）。
   *   ② 那两处填面调用（`0x70` 落点 `sub_45D660` raw 73175-73179、`0x71` raw 74260-74264）的颜色实参
   *      取自 `Scene+1540` 起 32B 缓存的第 6 个 dword（= `Scene+1560`），而 `sub_43B260`（raw 47212-47304）
   *      证明那是**像素格式的 R/G/B 掩码**（`0x00FF0000`/`0x0000FF00`/`0x000000FF`）⇒
   *      **引擎根本没有"窗自己的底色字段"**（那个实参是掩码，不是颜色）。
   *   ③ 用户看到的 ADV"半透明黑底"其实是**脚本往纹理槽画的**：
   *      `src/NOVEL.txt:44-55`（ADV 包装）与 `src/SC0000.txt:1036-1047`
   *      （`create-texture 48 500 2d0 0` → `i20b 48 0 0 500 2d0 ff 808080` → `draw-texture 186a0 48 …`）。
   * ⇒ 保留字段只为**不把这条历史建模静默丢掉**（`src/renderer/text/raster.ts` 的填面分支因此是死码）；
   *   真要修"窗底色没画"得去槽路径（`0x1F8`+`0x20B`+`draw-texture`），**不是**这里。
   */
  background: string | null;
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
  /**
   * **逐字节拍**（ms/字）= `max(message:MessageSpeed, 一帧)`。
   *
   * 一次推进**一个字**、**不补拍** —— 引擎那条路就是"推一个字 → `Sleep(MessageSpeed)`"
   * （GDI 路径 raw 13954）/ `sub_453B60` 定时器（D3D 路径 raw 13958），所以：
   *  - 整段时长 = **字数 × 节拍**（不是"行数 × 节拍"：`win+44` 的记录向量是**逐字** push 的，
   *    历史错误见 `docs-new/03-engine/adv-text-rendering.md` §3.3）；
   *  - 卡一帧（如首次加载字体）只少走一个字，**不会补出一批字** —— 用户实测的"几个字几个字一起出、
   *    看着像卡顿"正是"按显现预算追赶"造成的（2026-09）。
   */
  intervalMs: number;
}

/**
 * **每窗「逐行贴出」闸门**（引擎 `Engine[122466+win]` / `Engine[122476+win]` / `Engine[122486+win]`）。
 *
 * 引擎侧（`sub_409400` 的**第一个**窗口循环，raw 13838-13888；开店 = op `0x300` = `sub_426990`）：
 * ```c
 * v3 = Engine + 489864 + 4*win;                 // 该窗的闸门槽（win+局部位移）
 * if (*v3) Engine[489860] = 1;                  // 有窗在贴出 ⇒ 主循环跳过其它每帧服务
 * if ((*v3 & 1) == 0) { if (!(*v3 & 0x10000)) skip;
 *     while (!sub_45BE20(Font, win));           // 收尾：余下的行一次排空
 *     *v3 = 0; v3[10] = 0; v3[20] = 0; }        // 清闸门/延时/完成时刻
 * else {
 *     *v3 |= 0x10000;                           // 标记"已被泵接管"
 *     if (MessageSpeed) {
 *         if (sub_453B60(Engine+430572) < 0) return;   // 节拍未到 ⇒ 本帧整帧返回
 *         if (sub_45BE20(Font, win)) {                 // 返回真 = 全部贴完
 *             if (!v3[20]) v3[20] = timeGetTime();     // 记完成时刻
 *             else if (now - v3[20] >= v3[10]) {       // 到点 ⇒ 清绘制项（画面上的字消失）
 *                 v3[20] = 0;
 *                 sub_404F80(Font, win);               // ★win+132 = 0 ⇒ 下一帧从第一行重新贴出
 *             } } }
 *     else do result = sub_45BE20(Font, win); while (!result);   // MessageSpeed==0 ⇒ 一次排空
 * }
 * ```
 * ★`sub_404F80` 只清绘制项并把 `win+132` 归零，**闸门位仍为 1** ⇒ 下一帧又从第一行贴出
 * ⇒ **整段文本"逐行贴出 → 停留 op3 ms → 消失 → 再来一遍"，无限循环**。
 * `CONFIG.txt:171 i300 9 1 3e8`（设置界面的消息显示预览）就是靠它做成循环演示的。
 */
export interface WinRevealGate {
  /** `Engine[122466+win]` bit0：逐行贴出闸门（`0x300` op2 写）。 */
  enabled: boolean;
  /** `Engine[122466+win]` bit16：本窗已被泵接管（引擎 `*v3 |= 0x10000`）。 */
  pumping: boolean;
  /** `Engine[122476+win]`：贴完后的延时清场 ms（`0x300` op3 写；0 = 立刻清）。 */
  autoHideMs: number;
  /** `Engine[122486+win]`：贴完时刻（timeGetTime；`null` = 尚未记）。 */
  doneAt: number | null;
}

/**
 * **一个字格块**（引擎 `0x73` → `sub_456430` 写进窗对象的 `win+60..99`，40 字节）。
 *
 * 引擎侧（`sub_41F250` raw 28618-28630 + `sub_456430` raw 68282-68306）：
 * `i073 <win> <op2> <op3> <op4> <op5> <op6> <op7> <op8> <op9> <ms>` 把
 * `[op4, op5, op6, op7+op5, op8+op6, op2, op3, 1, op9, op9]` 拷进 `win+60`，
 * 并 `sub_453AD0(Engine+430600, ms)` 设逐字节拍 —— 于是：
 *  - `win+88 = 1` = **逐字总门**（`sub_45A940` 开头 `if (!win+88) return`）；
 *  - `win+92 = win+96 = op9` = 字格数/列数（引擎主循环用它当循环模数）；
 *  - 字格尺寸 = `(op7, op8)`、格原点 = `(op5, op6)`、目标偏移 = `(op2, op3)`。
 */
export interface CharGrid {
  /** `win+80` ← `0x73` op2（目标 x 偏移）。 */
  textX: number;
  /** `win+84` ← op3（目标 y 偏移）。 */
  textY: number;
  /** `win+60` ← op4（单元 blit 的**源表面**号）。 */
  srcSurface: number;
  /** `win+64` ← op5（字格原点 x）。 */
  originX: number;
  /** `win+68` ← op6（字格原点 y）。 */
  originY: number;
  /** `win+72-win+64` ← op7（字格宽）。 */
  cellW: number;
  /** `win+76-win+68` ← op8（字格高）。 */
  cellH: number;
  /** `win+92` = `win+96` ← op9（字格数；引擎主循环的模数）。 */
  cells: number;
  /** `win+88` = 1（逐字总门；为假时 `sub_45A940` 直接返回）。 */
  gate: boolean;
  /** `0x73` op10 → `sub_453AD0(Engine+430600)`：一格一字的节拍 ms（0 ⇒ 1，raw 66142）。 */
  tickMs: number;
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
 * ## emulator 的取舍（**步长偏离，时长对齐**）
 * 宿主把整窗光栅化成一张画布、按"显示前 N 个字形"渲染：引擎一步 = **一行**，重写侧一步 =
 * **一个字**（逐字可见）。为了**不让总时长变慢**，普通消息路径用「预算」推进
 * （`RevealState.budgetMs = 行数 × max(message:MessageSpeed, 一帧)`）：整段耗时与引擎一致，
 * 一帧内能走几个字就走几个字（速率 = `total / budgetMs`，`carry` 保存分数余量）。
 *
 * 于是速度旋钮的语义与引擎一致：**`MessageSpeed` = 每行的毫秒数，越大越慢、0 = 立即全显**。
 *
 * ## 为什么"一帧"是节拍下限
 * 会话循环里 `present()` 是同步调用（`pixiBackend.present` 不等 vsync），一帧之内可以空转
 * 很多轮 `serviceTextReveal`。引擎的节拍门 `sub_453B60` 同样把下限压在一帧（`Sleep` 之后仍
 * 每帧只走一步）⇒ 每行的耗时 = `max(MessageSpeed, 一帧)` ⇒ 整段 = `行数 × max(...)`。
 *
 * ★历史错误（两个方向都踩过，别再改回去）：
 *  1. 曾按"跨过的 tick 数一次补齐"、且把 `MessageSpeed` 当**每字**间隔
 *     （`ticks = floor((now-nextAt)/speed)+1`，5ms/字 ≈ 200 字/秒）⇒ 文字**出得太快**；
 *  2. 改成"一帧只推一个字"后，单位从"行"变成了"字"却没补回时长 ⇒ 同一 `MessageSpeed` 下
 *     整段耗时变成引擎的"每行字数"倍（19 字一行 ⇒ 慢约 19 倍），2026-09 实测反馈"变慢了"。
 *  正确的模型 = 上面第 2 条的单位 + 第 1 条的时长：**步长是一个字，时长等于行数 × 节拍**。
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
  /**
   * **竖排 blit 矩形内边距**（引擎 `Font+235112/+235116/+235120/+235124` ← op `0x260` 的四个操作数）。
   *
   * ★**这是 Font 级（全局）字段，不是逐窗字段**（审计 §4.1 P3 `0x260` 的"写入归属错"）：
   * 写入端 `sub_426080`（raw 33310-33328）逐字是
   * `_this[80102] = op1; _this[80103] = op2; _this[80104] = op3; _this[80105] = op4;`
   * 而 `_this` 是 **Font 对象**（`Font+235112 = 235112/4 = 58778` … 四个连续 dword，基址 `Engine+85296`）。
   * ⇒ 与 `vertical` 同源、同一层；改默认窗（op `0x80`）**不会**把它换到别的窗名下。
   * （旧实现写进 `geom(defaultWin).vPad`：一旦 `i080 N` 换默认窗，这四个值就"归"到旧窗上、
   *   新默认窗读到 0 —— 这次按体订正。）
   *
   * ★**消费端（重写侧）**: 引擎只在**绘制**时读它（`grep 235112` 的读点全在 `sub_45A940` 一族），
   * 做的是"把离屏表面的 blit 矩形左/上边各外移 (x,y)、右/下边各外扩 (dw,dh)，同时把源点
   * 按同一量除以表面缩放 (218592, 218596)"。**内容的落点不变** —— 目标位移与源位移严格同步：
   * 目标像素 `p` 采样的表面坐标 = `(S − x/s) + (p − (L − x))/s = S + (p − L)/s`，与 x 无关
   * （`s` 由 raw 78765/78767 初始化为 1.0）⇒ 这四个值**只改变被复制的矩形范围**（防旋转字形边缘被裁）。
   * 重写侧直接光栅化字形、没有"源矩形复制"这一步，也没有逐字裁切 ⇒ **没有可消费的等价物**
   * （详见 `handlers/msgwin.ts` 的 `op_vertical_rect_pad`）。保留字段只为不把这条脚本意图静默丢掉。
   */
  vPad: { x: number; y: number; dw: number; dh: number };
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
    vPad: { x: 0, y: 0, dw: 0, dh: 0 },
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
  /** `+224` 起 13 个 dword：`0x25C` 写的**文本块参数**（`sub_456510`）。 */
  block224: number[];
  /** `+256` / `+260` / `+272`：`0x25E` 写的颜色三件（最后一个已按 ARGB 组装）。 */
  f256: number;
  f260: number;
  f272: number;
  /** `+264` / `+268`：`0x25F` 写的颜色对（268 已按 ARGB 组装）。 */
  f264: number;
  f268: number;
  /**
   * `[48]` 指针前的两个 dword：`0x7A`（`sub_45A910`）写的**文本块原点 (x, y)**。
   *
   * 引擎消费点 = `sub_45A940` 的贴字格 `x = win+80 + buf[-20] + win+12`（raw 71352-71359）；
   * 默认值由排版例程写成 `obj[28]/[32]`（= `0x79` 的文字起点，raw 82684-82685）。
   */
  pre48a: number;
  pre48b: number;
  /** `0x7A` 是否调用过（未调用 ⇒ 排版原点回退到 `0x79` 的 `win+28/+32`）。 */
  pre48Set: boolean;
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
  /**
   * `[97055]`（0x5EC3C）：**文本项记账开关**（引擎侧同一个字段也被 `0x71` 当第 3 参用）。
   *
   * - **记账门**（2026-09 读体确证）：`0` = 正常记账；`0x80000000` = 暂停记账。
   *   写入端只有 `0x1BB`（SetTB，`sub_420000` raw 29230/29240）；`i1bb 0` … `i1bb 1` 成对包住
   *   "不要记账"的片段（如 `SC0000.txt:1554-1560` 的语音重播）。
   *   读取端：`0x1D2`/`0xC4`/`0x1BD`/`0x2F4` 的 `if (!Engine[97055]) { push 记录 }`
   *   （见 `handlers/text-items.ts`）、`0x71` 的 `a3 >= 0` 门（raw 74267）与主循环
   *   `*(int*)(this+388220) < 0`（raw 20319）。
   * - ★**只有一份真源**：`ENGINE_FIELD.textBaseGate`（= `engineValues` 的 97055 格）。
   *   `T-0095` 之前这里还有一个 `textSlotArg` 字段当"第二个副本"：它全库只被初始化
   *   （构造默认值 + `reset()`）、**从未被赋值**，于是旧实现 `if (m.textSlotArg >= 0)` 恒真：
   *   `i1bb 0` 期间 `0x71` 照样记回看页（`T-0095` 订正的既有缺陷）。
   *   `T-0101` 的 D6 已把该字段**整条删除**（删前核过：无任何读取者，`advState` 的按名快照也不含它）
   *   —— 当年"保留仅为兼容按名快照"的顾虑经核实不成立。
   */

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
   * 每窗的**文本内容版本号**：任何改写该窗文本的操作 +1
   * （`appendText` / `addRuby` / `endLine` / `beginNewMessage`）。
   *
   * 用途 = `0x72` 的"这一页是否已经武装过显现"判据（见 `revealArmed`）。
   */
  readonly #contentRev = new Map<number, number>();
  /** 每窗**最后一次武装显现时**的内容版本号（`undefined` = 从未武装）。 */
  readonly #armedRev = new Map<number, number>();
  /** 每窗**最后一次记页时**的内容版本号（同一页重跑门指令不重复计数，见 `finishPage`）。 */
  readonly #pageDoneRev = new Map<number, number>();

  /** 该窗当前的内容版本号。 */
  contentRevOf(win: number): number {
    return this.#contentRev.get(win) ?? 0;
  }

  /**
   * **该窗这一页的文本是否已经武装过显现**（内容没变过 ⇒ 已武装）。
   *
   * ★为什么必须有这一格（`tickets/T-0016`，用户实测）：等待推进泵里派发的**悬停 label 带返回点**
   * （引擎 `sub_405360(Engine, -3)`）⇒ label 体的 `ret` **正好回到门指令重跑**（`0x72`）。
   * 引擎的 `0x72` 尾段（raw 28539-28555）只做三件事：查字格数、置等待门、武装 ▼（bit30 + `[107704]=0`）
   * —— **根本不碰文字游标**（`win+132` 由 `sub_45BE20` 泵推进、由 `0x71`/`sub_45EC60` 复位）。
   * 而本模型把"启动显现"放在 `0x72` 里 ⇒ 若不加这道门，**每次悬停都会把整页文字从头重放**
   * （实测：ADV 页右侧侧边栏悬停 ⇒ 文字重放、页不推进）。
   */
  revealArmed(win: number): boolean {
    return this.#armedRev.get(win) === this.contentRevOf(win);
  }

  /** 记下"这一页的显现已武装"（`0x72` 调用；跳读/立即显示完也算武装过）。 */
  markRevealArmed(win: number): void {
    this.#armedRev.set(win, this.contentRevOf(win));
  }

  /** 内容变了 ⇒ 版本号 +1（下一次 `0x72` 才会重新武装显现）。 */
  #bumpContent(win: number): void {
    this.#contentRev.set(win, this.contentRevOf(win) + 1);
  }

  /**
   * 开始逐字显现。
   *
   * `speedMs <= 0` ⇒ **立即显示完**（引擎：`if (!Engine[21668])` 走同步排空 `sub_46CBF0`）。
   * 否则节拍 = `max(speedMs, 一帧)`、一次一个字、**不补拍**（见 `RevealState.intervalMs`）。
   *
   * @param opts.instant 强制立即显示完（点击推进/跳读收尾用，忽略 `speedMs`）。
   */
  beginReveal(
    win: number,
    total: number,
    nowMs: number,
    speedMs: number,
    opts: { instant?: boolean } = {},
  ): RevealState {
    const instant = opts.instant === true || speedMs <= 0;
    const interval = revealInterval(speedMs);
    const st: RevealState = instant
      ? { shown: total, total, active: false, nextAt: 0, intervalMs: interval }
      : { shown: 0, total, active: total > 0, nextAt: nowMs + interval, intervalMs: interval };
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
   * 一次一个字、节拍 = `max(message:MessageSpeed, 一帧)`、**不补拍**（见 `RevealState.intervalMs`）。
   *
   * ⚠**帧泵不许用这个"全窗"版**（`tickets/T-0100`）：引擎每帧只泵**当前窗**
   * （raw 13943-13945 的 `sub_45BE20(Font, Engine[122371])`），`0x300` 闸门窗由
   * `Engine.serviceWinReveal` 单独负责。用它会把上一屏残留的 `reveal` 条目也推进并发布回屏。
   * 自 `T-0100` 起**已无产品调用者**（保留为单窗版 `tickRevealWin` 的批量包装）。
   */
  tickReveal(nowMs: number, speedMs: number): number[] {
    const dirty: number[] = [];
    for (const win of this.reveal.keys()) {
      if (this.tickRevealWin(win, nowMs, speedMs)) dirty.push(win);
    }
    return dirty;
  }

  /**
   * 推进**单个**窗的显现游标（`tickReveal` 的单窗版；`0x300` 闸门泵也用它）。
   * 返回是否推进了（宿主据此重画该窗）。
   */
  tickRevealWin(win: number, nowMs: number, speedMs: number): boolean {
    const st = this.reveal.get(win);
    if (!st || !st.active) return false;
    if (nowMs < st.nextAt) return false;
    // 一次一个字；`speedMs` 变了（脚本 0x74 改速度）⇒ 按新节拍重排下一次
    const interval = revealInterval(speedMs);
    st.intervalMs = interval;
    st.shown = Math.min(st.total, st.shown + 1);
    st.nextAt = nowMs + interval;
    if (st.shown >= st.total) {
      st.shown = st.total;
      st.active = false;
    }
    return true;
  }

  /**
   * 该窗是否还在逐字显现中。
   *
   * ★**`0x300` 闸门路径上的窗不算**：那条路是"每窗逐行贴出 + 定时清场重来"的循环演示
   * （`sub_409400` 第一循环），引擎在同一帧里照常派发脚本指令（raw 21179 `goto LABEL_215`）
   * ⇒ 若把它算作"显现中"，CONFIG 屏会被挂起、设置界面失去响应。
   */
  isRevealing(win?: number): boolean {
    if (win !== undefined) return this.reveal.get(win)?.active === true && !this.isGatePumped(win);
    for (const [w, st] of this.reveal) if (st.active && !this.isGatePumped(w)) return true;
    return false;
  }

  /**
   * 该窗当前应画出的字形数（**无显现状态 ⇒ -1 = 全部**，但两条"泵送/贴格"路径例外，见下）。
   *
   * 这是"这一帧窗里能看见几个字"的**唯一判决点**：所有发布者（`0x6E/0x6F/0x71/0x73/0x7A`…）
   * 都走 `emitWin` → `revealedOf`，因此可见性规则只能写在这里，写到各 op 里就会出现
   * "一条 op 判 0、下一条 op 又判 -1"的裂缝（2026-09 实测的正是这种）。
   *
   * ★例外一：**`0x300` 闸门窗**（每窗逐行贴出）。可见性完全由泵的 `sub_45BE20` 决定
   * （`win+132` 从 0 开始，`i071` 刚清过场 ⇒ **一行都还没贴**）⇒ 未武装/未推进一律 **0**。
   * 否则 `show-text` 写完就"整段直接出现"，表现为「进设置时 ADV 文案先于背景出现」。
   *
   * ★例外二：**配了字格图标（▼）的窗**（`0x73` 写 `win+88 = 1`）。★2026-09 订正：`0x73` 是
   * **图标精灵表**（不是文字的单位，见 `CharGrid`）；这里用它当"该窗走的是 ADV 页、文字由泵逐步贴出"
   * 的判据 —— 引擎那条路是 `sub_45BE20` 一步一个字（`win+132` 游标从 0 开始），
   * 在 `0x72` 把游标清零并武装之前，屏上还没有本页的字。
   * 若这里返回 -1，则"文本入队 → `0x72` 武装"之间的那一帧会**整页先亮一次**，
   * 随后被逐字从头重播（2026-09 用户实测："文字会在逐字出现前完整出现"）。
   * ⚠️这是**近似**：引擎那侧的门来自泵（`sub_409400`），不是字格门 —— 别再扩大它的解释范围。
   */
  revealedOf(win: number): number {
    const st = this.reveal.get(win);
    if (st) return st.shown;
    return this.isGatePumped(win) || this.gridOf(win)?.gate === true ? 0 : -1;
  }

  // ---- 字格逐字显现（引擎 `0x73`/`sub_45A940`/主循环 raw 20887-20895）----

  /** 每窗的**字格图标帧号**（引擎 `Engine[107704]`；主循环每 `tickMs` `(k+1) % cells`）。 */
  cellK = 0;
  /** 下一格的时刻（ms；引擎 `Engine+430600` 计时器）。 */
  cellNextAt = 0;

  /** 每窗的字格块（引擎窗对象的 `win+60..99`；`0x73` 写、`sub_45A940` 读）。 */
  readonly grids = new Map<number, CharGrid>();

  /** 每窗「逐行贴出」闸门（引擎 `Engine[122466+win]` 区；`0x300` 写、`sub_409400` 消费）。 */
  readonly gates = new Map<number, WinRevealGate>();

  /** 取（必要时新建）某窗的闸门槽。 */
  gateOf(win: number): WinRevealGate {
    let g = this.gates.get(win);
    if (!g) {
      g = { enabled: false, pumping: false, autoHideMs: 0, doneAt: null };
      this.gates.set(win, g);
    }
    return g;
  }

  /** 该窗是否在 `0x300` 闸门路径上（引擎 `*v3 & 1`）。 */
  isGatePumped(win: number): boolean {
    return this.gates.get(win)?.enabled === true;
  }

  /**
   * 逐字显现模式（引擎 `effect_flags & 0x40000000`）。
   *
   * 引擎置位点：`0x1CE op1≠0`（raw 29337）与 **`0x72`**（raw 28551，每次 `wait-for-input` 都置，
   * 并把游标清零）；清位点：`0x1CE op1=0`（raw 29348）、点击推进（raw 20029）、
   * `sub_411900`/`sub_409400` 的收尾分支（raw 10933/13738/20089/20282）。
   */
  charMode = false;

  /** 引擎 `Engine[107706]`：`0x1CE` 的 op1 副本。 */
  charModeArg = 0;

  /** 引擎 `Engine[107704]`：下一个要贴出的字格下标。 */
  charCursor = 0;

  /** 引擎 `Engine[107705]`：循环模数（= `0x72` 查询回来的 `win+92`）。 */
  charTotal = 0;

  /** `0x304` 保存的「当前行游标」（引擎 `win+296 ← win+132`；`0x305` 取回）。 */
  readonly lineCursorSave = new Map<number, number>();

  /** `0x73`：写该窗字格块（引擎 `sub_456430`，raw 68282-68306）。 */
  setCharGrid(win: number, grid: CharGrid): void {
    this.grids.set(win, grid);
  }

  /** 取该窗字格（无 = 引擎 `win+88 == 0` ⇒ `sub_45A940` 什么也不做）。 */
  gridOf(win: number): CharGrid | undefined {
    return this.grids.get(win);
  }

  /**
   * 该窗**字格图标**（▼「点击继续」）的换格节拍（`0x73` op10）。**不是文字的节拍** ——
   * 文字走 `RevealState.intervalMs` = `max(message:MessageSpeed, 一帧)`。
   * 引擎 `sub_453AD0` 对 0 值取 1（raw 66142-66143）。
   */
  gridTickMs(win: number): number | undefined {
    const g = this.grids.get(win);
    if (!g) return undefined;
    return g.tickMs > 0 ? g.tickMs : 1;
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
      s = { segments: [], fontStyle: null };
      this.slots.set(i, s);
    }
    return s;
  }

  /**
   * **把当前全局字体/颜色钉进该窗的槽**（引擎：排版时字形连颜色一起画进离屏表面）。
   *
   * 调用点 = 一切"文本入队"的指令（`show-text` 0x6E / `display-furigana` 0x196 / 十六进制串 0x7D）。
   * 全局样式指令（`0x75/0x76/0x77/0x8B/0x197/0x1A5/0x2FE/0x2BD/0x2BE`）**不**碰它 ——
   * 它们只改"下一次排版用哪套样式"。
   */
  setFontStyle(i: number, snap: FontStyleSnapshot): void {
    this.slot(this.resolveWin(i)).fontStyle = snap;
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
    if (s) {
      s.segments.length = 0;
      // 引擎 `0x71` 同时清该窗离屏表面 ⇒ 已排版的字形（连同颜色）一起没了，
      // 下一段文本入队时再按**当时的**全局样式钉一次（`show-text` 会重设）。
      s.fontStyle = null;
    }
    this.#bumpContent(win); // 清场 = 内容变了 ⇒ 下一道 `0x72` 要重新武装显现
    // 引擎把显现游标 `win+132` 复位到 0；本模型里"没有状态"= 全部显示，
    // 内容已清空 ⇒ 删掉状态即可（下次 show-text 会重新决定）。
    this.reveal.delete(win);
  }

  /** `show-text`：向槽尾追加一段文本。`i` = op1（0 ⇒ 默认窗）。 */
  appendText(i: number, text: string): void {
    const s = this.slot(this.resolveWin(i));
    const last = s.segments[s.segments.length - 1];
    this.#bumpContent(this.resolveWin(i));
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
    this.#bumpContent(this.resolveWin(i));
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
    this.#bumpContent(this.resolveWin(i));
    const last = s.segments[s.segments.length - 1];
    if (last) last.lineEnded = true;
  }

  /** 取（必要时新建）消息窗对象。 */
  object(idx: number): MsgObject {
    let o = this.objects.get(idx);
    if (!o) {
      o = {
        f100: 0,
        f104: 0,
        f108: 0,
        f276: 0,
        f280: 0,
        f132: 0,
        block224: new Array<number>(13).fill(0),
        f256: 0,
        f260: 0,
        f272: 0,
        f264: 0,
        f268: 0,
        pre48a: 0,
        pre48b: 0,
        pre48Set: false,
      };
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

  /**
   * 一页结束（`wait-for-input`）：清显示态并计页数。
   *
   * ★**同一页只记一次**：门指令会被"悬停 label 的 `ret`"重跑（引擎 `sub_405360(-3)`），
   * 而 `pages` 是**页数**（诊断/`digest` 用），重跑不该把它加上去（`tickets/T-0016` 实测：
   * 悬停一次页面计数会 0→1→2）。判据 = 该窗内容版本号（见 `contentRevOf`）。
   */
  finishPage(win: number): void {
    this.showing = 0;
    this.alt = 0;
    if (this.#pageDoneRev.get(win) === this.contentRevOf(win)) return; // 这一页已经记过

    this.#pageDoneRev.set(win, this.contentRevOf(win));
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
    // 引擎复位把 `Engine[97055]` 清 0（raw 17962）⇒ 记账门回到"正常记账"
    // （`textSlotArg` 已于 `T-0101` 的 D6 删除；真源是 `engineValues[97055]`）
    this.slots.clear();
    this.objects.clear();
    this.wins.clear();
    this.font = defaultFontStyle();
    this.reveal.clear();
    // 字格 / 逐字模式（引擎 `sub_40DF10` 整块清 0 的那部分）
    this.grids.clear();
    this.gates.clear();
    this.lineCursorSave.clear();
    this.charMode = false;
    this.charModeArg = 0;
    this.charCursor = 0;
    this.charTotal = 0;
  }
}
