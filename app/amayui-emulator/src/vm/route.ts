/**
 * **点击热点 / 路由表**（引擎 `Engine+0x55D8` 起的对象，`_this + 5494`（dword 下标）＝
 * C++ 侧的 `CBunki` 面板对象；raw 行号 = `engine/天结_unpacked.exe_utf8.c`）。
 *
 * ## 一句话
 * 引擎里「鼠标/键 → label」不是一条链，而是**5 条出口共用一个面板对象**：`0x090` 登记矩形 +
 * 三个 label，运行时由三条出口取用：
 *  - **按下键位命中** `sub_403D70`（raw 9847-9862）→ 取 `[459+i]`（**labelC**）；
 *  - **游标进入/离开** `sub_403E70`（raw 9918-9955）→ 分别取 `[259+i]`（labelA）/ `[359+i]`（labelB），
 *    且**一次调用只返回一个**（A→B 要跨两帧，靠 `[7466]` 补发）；
 *  - **读当前游标项的 labelC** `sub_404E00`（raw 10667-10676，无副作用）/
 *    **提交并清表** `sub_404120`（raw 10052-10062）。
 *
 * ## 表结构（`sub_403B30` raw 9740-9764）——最多 100 项
 * ```
 * [258]        = 条目数（★就是它，置 0 = 清表；`sub_403EF0` raw 9963）
 * [259 + i]    = labelA：游标**进入**该项（`sub_403E70` 的 else 分支）
 * [359 + i]    = labelB：游标**离开**该项
 * [459 + i]    = labelC：**点击 / 键命中**（`sub_403D70` 9862、`sub_404E00` 10675、主循环 20182）
 * [559 + 4i..] = 矩形 x0,y0,x1,y1（步长 4 dword = 16 字节；`0x090` 的调用方已把 w/h 加成 x1/y1）
 * [7361 + i]   = 该热点绑定的**输入掩码位**（入队时置 -1；`0x97` → `sub_403D10` 写入）
 * [7461]       = **登记这张表时的脚本身份 token**（= 当时 `frames[cur][95796]`；raw 9762）
 * [7465]       = 「已做过命中测试」标记（9763/10023）
 * [7466]       = 「上一帧刚发过离开 ⇒ 本帧补发进入」
 * [7467]       = 回退 label（只有 `0x92` 写；语料 0 处）
 * [7468]       = **游标**（命中项下标，-1 = 无；9810/9822）
 * [959]        = 已派发过「进入」的项（9927/9941/9964）
 * [960]        = 步长（`0x94` 写 10000；`sub_403DD0` 的方向键翻页用）
 * ```
 *
 * ## 命中测试什么时候做（★不是每帧）
 * `sub_403C50`（raw 9787-9824）**只有三个调用点**：`sub_404020`（10026，面板首次显示）、
 * `sub_4040A0`（10043，面板 B）、`sub_4B8D50`（140828/140830，**WM_MOUSEMOVE**）。
 * 等待泵（`sub_411BC0`）与主循环（`sub_411900`）里**没有**命中测试 ⇒
 * 游标只在「鼠标移动 / 面板刚显示」时更新。本实现把 `hitTest` 同样限制在这两种时机
 * （宿主在 `InputManager` 的光标变化回调里调 → 见 `Engine` 构造函数的订阅）。
 *
 * ## 命中取**第一个**（9815 的下标升序循环，第一个满足即停）
 * ⇒ 先登记的全屏热点会遮蔽后来者；引擎靠「每个状态只登记一套热点 + `i093` 清表」避开
 * （`SN0000.txt:125` 的 `i093` 就是清表）。
 *
 * ## 坐标
 * `sub_403C50` 先把客户区坐标经 `sub_403500` 换算成虚拟坐标（`sub_404E20` 装填的变换参数）。
 * 在客户区就是 1280×720 时该变换**恒等**（`scale = (size+2*offset)/clientSize` = 1、偏移 0）
 * ⇒ 直接用虚拟 1280×720 比较是等价的。非该分辨率/多显示器下未验证（见规格 §G3）。
 */

/** 一个热点项（引擎里是 5 个并行数组的同一下标）。 */
export interface RouteEntry {
  /** `[559+4i]`（x0）。 */
  x0: number;
  /** `[560+4i]`（y0）。 */
  y0: number;
  /** `[561+4i]`（x1 = x + w）。 */
  x1: number;
  /** `[562+4i]`（y1 = y + h）。 */
  y1: number;
  /** `[259+i]`：**游标进入**该热点时派发（`sub_403E70` 的 else 分支 9950）。 */
  labelEnter: number;
  /** `[359+i]`：**游标离开**该热点时派发（9945）。 */
  labelLeave: number;
  /** `[459+i]`：**点击 / 键命中**时派发（`sub_403D70` 9862 / `sub_404E00` 10675）。 */
  labelClick: number;
  /** `[7361+i]`：输入掩码位；-1 = 未绑定（不参与键命中）。 */
  keyBit: number;
}

/**
 * 面板对象需要的 `Engine._this` 稀疏字段读写（`engineValues`）。
 *
 * 为什么把耦合收敛到这一个函数：**[7464]/[7465]/[960]/[7462]/[7463]** 这几格是**有读者的引擎字段**
 * （脚本侧 `0x94` 的两次调用要看 `[7465]`；等待泵被 `[7463]` 门控），所以它们必须与 `RoutePanel`
 * 的字段是**同一份状态**，不能各存一份（规格 §F.2 的 `panel.ts` 第 ③ 条）。
 *
 * 签名刻意做成**无类型耦合的纯函数**：`get(k)` / `set(k, v)`，
 * `Engine.panelField` 一行即可实现（见 `engine.ts`）。
 */
export type PanelField = (k: number, v?: number) => number | undefined;

/** 引擎上限：`sub_403B30` 的 `if (count >= 100) return 0;`（9748-9749）。 */
import { ENGINE_FIELD } from './engineFieldIds.js';

export const ROUTE_MAX = 100;

/** 面板对象在 `_this` 里的基址（dword 下标）：`Engine+0x55D8` = `_this + 5494`。 */
const PANEL_BASE = 5494;

/**
 * 面板对象**之外**的两个引擎槽（与 `panelA` 的对应关系是 raw 实证）：
 * - `[7463]`（= `Engine[12957]`）：面板已显示（`0x94` 置 1、`0x93` toggle 清 0）；
 * - `[7462]`（= `Engine[12956]`）：关闭已发生（`0x93` 的 toggle 端、`0x91`/`0x92` 的清零点）。
 *
 * ★为什么单独列出来：它们是 `sub_4191D0`/`sub_419230` 直接读写的**引擎字段**
 * （raw 24596-24599、24607），不是从 `panelA` 基址算出来的 —— 但只要它们是「同一份状态」，
 * 写一处就必须对另一处可见（否则 `0x93` 与泵的门控会各看各的）。
 */
const ENGINE_SHOWN = ENGINE_FIELD.panelShown;
const ENGINE_CLOSE_PENDING = ENGINE_FIELD.panelClosePending;

/**
 * 点击热点面板（引擎 `Engine+0x55D8` 的 CBunki 对象）。
 *
 * 字段名与引擎下标的对应见类注释；命名统一为「事件语义」（`cursor`/`hover`/`enterPending`…），
 * 引擎下标写在各 getter/setter 的注释里，便于对着 raw 核对。
 */
export class RoutePanel {
  readonly entries: RouteEntry[] = [];
  /** `[7468]`：命中游标（-1 = 未命中）。由 `hitTest` 写。 */
  cursor = -1;
  /** `[959]`：已派发过「进入」的项（`sub_403E70` 的两段式状态的另一半）。 */
  hover = -1;
  /** `[7466]`：上一帧刚发过「离开」⇒ 本帧补发「进入」。 */
  enterPending = 0;
  /** `[7461]`：**登记这张表时的脚本身份 token**（= 那一刻 `frames[cur][95796]`）。 */
  ownerScriptId = -1;

  /** `[7464]` 待填充标记（`0x94` 经 `sub_404020` 写；emulator 未建模填充的视觉语义，见规格 §G5）。 */
  #fillPending = 0;
  /** `[7465]` 是否已做过命中测试（`0x94`/`sub_404020` 读它决定"首次按鼠标重做命中测试"）。 */
  #hitDone = 0;
  /** `[960]` 步长（`0x94` 写 10000；`sub_403DD0` 用它做方向键/翻页键跳项）。 */
  #pageStep = 0;
  /**
   * `[7467]` 回退 label（**只有 `0x92` 写**，`sub_4098E0` 读；语料 0 处）。
   *
   * ★读者（`tickets/T-0158` 的 P2 `0x92` 修）：`handlers/panel.ts` 的 `servicePanelDisplayState()`
   * —— 它就是引擎 `sub_4098E0` raw 14084-14092 的那一支（`v5 = _this[12961]; if (v5 != -1) { … }`，
   * 即"面板显示态下既没有 enter/leave 也没有左键点击"时派发的 label）。
   * 修前 `fallbackLabel` 只有写点（panel.ts）与清零点（本文件 `reset()`）⇒ 是**只写不读的死写**。
   */
  fallbackLabel = -1;

  /** `[7463]`/`[7462]` 的本地回退（有 sink 时以 `engineValues` 为准，见 `#read`）。 */
  #shown = 0;
  #closePending = 0;

  constructor(private readonly field?: PanelField) {}

  get count(): number {
    return this.entries.length;
  }

  /**
   * 读一个"同时是引擎格"的面板字段（参数 k 是**相对 `panelA` 基址**的下标）：
   * `field` 就是 `Engine.panelField`（读写 `engineValues` 里的 `_this[PANEL_BASE + k]`，
   * 它收的是**绝对**下标）；没有 `field` 时回退到本地字段（测试里 `new RoutePanel()` 的场景）。
   */
  #read(k: number, local: number): number {
    return this.field?.(PANEL_BASE + k) ?? local;
  }

  /** 写一个"同时是引擎格"的面板字段（参数 k 是**相对 `panelA` 基址**的下标）。 */
  #write(k: number, v: number): void {
    this.field?.(PANEL_BASE + k, v);
  }

  /** 写一个**绝对** `_this` 下标（面板对象之外那两格：`12956`/`12957`）。 */
  #writeAbs(k: number, v: number): void {
    this.field?.(k, v);
  }

  /** `[7463]`（= `Engine[12957]`）：面板已显示。 */
  get shown(): number {
    return this.field?.(ENGINE_SHOWN) ?? this.#shown;
  }
  set shown(v: number) {
    this.#shown = v;
    this.#writeAbs(ENGINE_SHOWN, v);
    this.#write(7463, v);
  }

  /** `[7462]`（= `Engine[12956]`）：关闭已发生。 */
  get closePending(): number {
    return this.field?.(ENGINE_CLOSE_PENDING) ?? this.#closePending;
  }
  set closePending(v: number) {
    this.#closePending = v;
    this.#writeAbs(ENGINE_CLOSE_PENDING, v);
    this.#write(7462, v);
  }

  /** `[7464]`（待填充标记）。 */
  get fillPending(): number {
    return this.#read(7464, this.#fillPending);
  }
  set fillPending(v: number) {
    this.#fillPending = v;
    this.#write(7464, v);
  }

  /** `[7465]`（是否已做过命中测试）。 */
  get hitDone(): number {
    return this.#read(7465, this.#hitDone);
  }
  set hitDone(v: number) {
    this.#hitDone = v;
    this.#write(7465, v);
  }

  /** `[960]`（步长）。 */
  get pageStep(): number {
    return this.#read(960, this.#pageStep);
  }
  set pageStep(v: number) {
    this.#pageStep = v;
    this.#write(960, v);
  }

  /**
   * `0x090`（`sub_403B30` raw 9740-9764）：登记一项。
   *
   * 矩形按**宽高**给（脚本口径），内部存 x1/y1；三个 label 分别落 `[259+i]/[359+i]/[459+i]`；
   * `keyBit` 置 -1（9759）；`[7465] = 0`（9763）；`[7461] = ownerScriptId`（9762）。
   * 返回 `false` = 表满（引擎同样返回 0，调用方据此抛 `Command_ShowMessage`）。
   *
   * ★调用方（`sub_420640` raw 29516-29517）随后还写 `[7468] = -1`、`[7466] = 0`。
   */
  push(x: number, y: number, w: number, h: number, labelEnter: number, labelLeave: number, labelClick: number, ownerScriptId: number): boolean {
    if (this.entries.length >= ROUTE_MAX) return false;
    this.entries.push({ x0: x, y0: y, x1: x + w, y1: y + h, labelEnter, labelLeave, labelClick, keyBit: -1 });
    this.ownerScriptId = ownerScriptId;
    this.hitDone = 0;
    this.cursor = -1;
    this.enterPending = 0;
    return true;
  }

  /**
   * `sub_403C50`（raw 9787-9824）：**按坐标命中测试** —— 逐项判 `x0 <= px <= x1 && y0 <= py <= y1`，
   * 命中则把游标设为该下标（**取第一个命中项**，9815 的下标升序循环），否则 -1（9810）。
   */
  hitTest(px: number, py: number): number {
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      if (e.x0 <= px && px <= e.x1 && e.y0 <= py && py <= e.y1) {
        this.cursor = i;
        return i;
      }
    }
    this.cursor = -1;
    return -1;
  }

  /**
   * `sub_403D10`（raw 9827-9844）：**把输入掩码位绑到矩形相同的那个热点**（键位绑定，不是绘制！）。
   *
   * 引擎逐项比较矩形的**四个字段全等**（`*(i-2) != *a2 || a2[2] != *i || *(i-1) != a2[1] || a2[3] != i[1]`），
   * 第一个全等的项写 `[7361+i] = a3`；**没有全等项则静默什么都不做**（没有 else 分支）。
   * 调用者唯一 = `0x97`（`sub_420910` raw 29596-29612），参数是 `{op1, op2, op1+op3, op2+op4}` + `op5`。
   *
   * @returns 绑到的项下标；-1 = 没有矩形全等的项（引擎同样静默）。
   */
  bindKeyBit(x0: number, y0: number, x1: number, y1: number, bit: number): number {
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      if (e.x0 === x0 && e.y0 === y0 && e.x1 === x1 && e.y1 === y1) {
        e.keyBit = bit;
        return i;
      }
    }
    return -1;
  }

  /**
   * `sub_403E70`（raw 9918-9955）：按**游标变化**返回本帧该派发的悬停 label（−1 = 无）。
   *
   * 逐行对齐源码：
   *  - `[7466]` 已置 ⇒ 本帧发 `[959]` 那项的 **labelA（进入）**，并清该标志；
   *  - 否则取 `[959]` 与当前游标比较：相同 ⇒ 什么都不发；不同 ⇒ 先更新 `[959]`，
   *    **旧项有效** ⇒ 置 `[7466]` 并返回旧项的 **labelB（离开）**；旧项无效而新项有效 ⇒ 直接发 labelA。
   *
   * ★这就是「每帧只取一个 label」的含义：从 A 移到 B 要发两条，跨两帧发完。
   * 引擎**不检查**返回的 label 是不是 -1/0xffffffff（语料把不可达热点的 labelA/B 写成 `ffffffff`，
   * 但那些矩形在屏幕外/被前面的全屏热点遮蔽 ⇒ 永远不会成为 enter/leave 的目标）。
   */
  nextHoverLabel(): number {
    const v1 = this.cursor;
    if (this.enterPending) {
      const v2 = this.hover;
      this.enterPending = 0;
      if (v2 !== -1) return this.entries[v2]?.labelEnter ?? -1;
    } else {
      const v4 = this.hover;
      if (v1 === v4) {
        this.enterPending = 0;
      } else {
        this.hover = v1;
        if (v4 !== -1) {
          this.enterPending = 1;
          return this.entries[v4]?.labelLeave ?? -1;
        }
        if (v1 !== -1) return this.entries[v1]?.labelEnter ?? -1;
      }
    }
    return -1;
  }

  /**
   * `sub_403D70`（raw 9847-9862）：按**输入掩码**找第一个「已绑定键且该键被按下」的项，返回其 labelC。
   * 未绑定的项（`keyBit < 0`）按引擎一样跳过（`*i < 0 || ((1 << *i) & *a2) == 0` 继续下一项）。
   *
   * ★这是等待泵的**第一优先出口**（raw 20242）——ADV「键盘推进」走的就是它。
   *
   * ★**位号没有值域检查，移位是模 32 的**（`tickets/T-0158` 的 P3 `0x97` `missing-branch` 的**复核**）：
   * 引擎 `sub_403D10`（**`0x97` 的落点**，raw 9827-9844）写 `_this[v4 + 7361] = a3` 时**没有**任何
   * `> 0x1F` 判定；`sub_403D70` 这里也是 `1 << *i` 直用。x86 的 `shl` 把移位量掩到 5 位
   * （`1 << 32` ⇒ 位 0），而 JS 的 `<<` **同样**把右操作数掩到 5 位 ⇒ 两者逐位一致。
   * ⇒ **不得**在这里加 emulator 自造的 `0x1F` 上限（那是 `0x10C` 的规矩，见
   * `handlers/input.ts` 的 `op_set_key_multi` 与 raw 30626-30631；`0x97` 体里没有）。
   */
  pickByKey(mask: number): number {
    for (const e of this.entries) {
      if (e.keyBit >= 0 && (mask & (1 << e.keyBit)) !== 0) return e.labelClick;
    }
    return -1;
  }

  /** `sub_404DE0`（raw 10658-10664）：游标是否有效（`0 <= [7468] < [258]`）。 */
  cursorValid(): boolean {
    return this.cursor >= 0 && this.entries.length > this.cursor;
  }

  /** `sub_404E00`（raw 10667-10676）：**读**当前游标项的 labelC（`[459+游标]`）；无副作用。 */
  currentLabelClick(): number {
    const v1 = this.cursor;
    if (v1 < 0 || this.entries.length <= v1) return -1;
    return this.entries[v1]!.labelClick;
  }

  /**
   * `sub_404120`（raw 10052-10062）：**提交**本次点击 —— 先取 `[459+游标]`，**再把整表清空**
   * （`sub_403EF0`）后返回该 label。
   *
   * 调用点 = `sub_4098E0`(14073) / `sub_409700`(13988)，即 `effect_flags & 0x800000` /
   * `0x10000000` 两条「面板显示态」路径：那里**左键点击 = 取游标项的 labelC 并清表**。
   */
  commitClickAndReset(): number {
    const v1 = this.cursor;
    if (v1 < 0 || this.entries.length <= v1) return -1;
    const label = this.entries[v1]!.labelClick;
    this.reset();
    return label;
  }

  /** 当前命中项（游标有效时）。 */
  current(): RouteEntry | null {
    return this.cursor >= 0 ? (this.entries[this.cursor] ?? null) : null;
  }

  /**
   * `sub_403EF0`（raw 9958-9971）：**整体复位**（绘制子系统/控件轨道的复位）。
   *
   * ```
   * [258] = 0     // ★★ 条目数置 0 = **清空整张路由表**（后续 0x090 从下标 0 覆写）
   * [959] = -1; [960] = 0; [7467] = -1; [7468] = -1; [7466] = 0; [7464] = 0;
   * ```
   * ★**不改 `[7461]`（注册脚本身份）** —— 但条目没了，所以对派发没有意义。
   */
  reset(): void {
    this.entries.length = 0;
    this.hover = -1;
    this.enterPending = 0;
    this.fallbackLabel = -1;
    this.cursor = -1;
    this.pageStep = 0;
    this.fillPending = 0;
    // 下面两步是**写回「对 raw 找字段」的引擎格**（emulator 用 `entries.length` / `hover` 作权威）：
    // 命中测试的条目数（`sub_403C50` raw 9819）与「已派发过进入的项」（`sub_403E70` raw 9927/9941）。
    this.#write(258, 0);
    this.#write(959, -1);
  }
}

/**
 * 旧名（`RouteTable`）保留为别名：既有的调用点/测试代码引用的是这个名字，
 * 而引擎里的实体是「面板对象」⇒ 新名 `RoutePanel` 更贴切（改名的动因见 route.ts 顶部注释）。
 */
export { RoutePanel as RouteTable };
