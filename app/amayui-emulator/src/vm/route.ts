/**
 * **点击热点 / 路由表**（引擎 `Engine+0x55D8` 起的对象，`_this + 5494`（dword 下标））。
 *
 * ## 为什么它决定「等待输入」能不能结束
 * ADV 的推进不是"读鼠标键就直接往下跑"，而是走这张表：
 *  1. 脚本用 `0x090`（sub_420640 → sub_403B30）**登记一个矩形热点 + 三个 label**；
 *     消息场景常见的就是 `i090 0 0 500 2d0 …` —— 覆盖全屏的"点任意处推进"。
 *  2. `0x72 wait-for-input` 置 `effect_flags` bit31 挂起脚本。
 *  3. 主循环 / 等待泵（`sub_411BC0`）每帧刷输入掩码，再按**喂给它的 label** 重定位脚本：
 *     - **点击/推进输入**（`aMessageAdvance`，raw 20262-20293）：`sub_404E00` = `[459+游标]`（labelC）；
 *     - **悬停（游标变化）**（raw 20324-20337）：`sub_403E70` 返回 labelA（进入）/ labelB（离开）。
 *
 * ## 表结构（引擎实证，`sub_403B30` raw 9740-9764）
 * 最多 **100** 项，每项：
 * ```
 * [259 + i] = a6   // labelA：**游标进入**该项时派发（`sub_403E70` 的 else 分支）
 * [359 + i] = a7   // labelB：**游标离开**该项时派发
 * [459 + i] = a8   // labelC：**点击/键命中**时派发（`sub_404E00` / `sub_403D70`）
 * [559 + 4i .. +3] = a2,a3,a4,a5   // 矩形 x0,y0,x1,y1（调用方已把 w/h 加成 x1/y1）
 * [7361 + i] = -1  // 输入掩码位（入队时未绑定；-1 表示不参与键命中）
 * [7461] = a9      // frame_arg
 * ```
 * `0x090` 的调用形态（真实脚本）：`i090 <x> <y> <w> <h> <labelA> <labelB> <labelC>`
 * —— `sub_420640` 把 w/h 加成 x1/y1 后传入。
 *
 * ## 本实现的范围与偏差（明确记录）
 * - 实现：入队（`0x090`）、按坐标命中测试设游标、**悬停"进入/离开"两段式派发**（`nextHoverLabel`）、
 *   按"推进输入 + 游标命中"取 label 并重定位 `ip`。
 * - 偏差①：点击走的是 **labelA**（`labelNext`）而不是引擎的 labelC（`sub_404E00`）。
 *   原因：引擎跳 label 时带**返回点**（`sub_4083B0`/`sub_405360(-3)`/`sub_4051A0`），
 *   而 ADV 页里的 labelC 多为 `ret` 结尾的 UI 子程序，没有返回点就语义不成立。
 *   语料实测：`i090 0 0 500 2d0 … ffffffff ffffffff <labelC>`（"点任意处推进"）的 labelA = −1
 *   ⇒ emulator 只清等待门、由脚本自己继续，页推进行为与真机一致（用户实测通过）。
 * - 偏差②：**未实现**引擎里 `[7466]/[959]` 之外的那些去重/键位绑定细节（`[7361+i]` 的写入方
 *   与 `sub_403500` 的坐标变换（视口缩放））。
 */

/** 一个热点项。 */
export interface RouteEntry {
  /** 命中矩形（引擎里 x1/y1 已含宽度）。 */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** `[259+i]`：**游标进入**该热点时派发的 label（`sub_403E70`）。 */
  labelNext: number;
  /** `[359+i]`：**游标离开**该热点时派发的 label。 */
  labelPrev: number;
  /** `[459+i]`：点击 / 键命中派发的 label（`sub_404E00` / `sub_403D70`）。 */
  labelKey: number;
  /** `[7461]`：入队时所在帧的 frame_arg。 */
  frameArg: number;
  /** `[7361+i]`：输入掩码位；-1 = 未绑定（不参与键命中）。 */
  keyBit: number;
}

/** 引擎上限：`sub_403B30` 的 `if (count >= 100) return 0;`。 */
export const ROUTE_MAX = 100;

export class RouteTable {
  readonly entries: RouteEntry[] = [];
  /**
   * 命中游标（引擎 `[7468]`）：由坐标命中测试写入，`-1` = 未命中。
   */
  cursor = -1;
  /**
   * 上一次已派发过"进入"的热点下标（引擎 `[959]`）。
   *
   * 引擎在"游标变化"时用它与当前游标比较，决定这次该发**离开**（旧项）还是**进入**（新项）。
   */
  hoverLatch = -1;
  /**
   * 上一帧刚发过"离开"⇒ **本帧补发"进入"**（引擎 `[7466]`）。
   *
   * 为什么需要两段式：`sub_403E70`（raw 9918-9955）一次调用只返回**一个** label，
   * 而"从 A 移到 B"要发两个（先 A 的 labelB，再 B 的 labelA）⇒ 引擎把 A 的离开先发出去、
   * 置 `[7466]=1`，下一帧（`[959]` 已是 B）再发 B 的进入。
   */
  pendingEnter = 0;

  get count(): number {
    return this.entries.length;
  }

  /**
   * `0x090`（sub_403B30）：登记一项。矩形按**宽高**给（与脚本一致），内部存 x1/y1。
   * 返回 `false` = 表满（引擎同样返回 0，调用方据此抛 ShowMessage）。
   */
  push(x: number, y: number, w: number, h: number, labelNext: number, labelPrev: number, labelKey: number, frameArg: number): boolean {
    if (this.entries.length >= ROUTE_MAX) return false;
    this.entries.push({ x0: x, y0: y, x1: x + w, y1: y + h, labelNext, labelPrev, labelKey, frameArg, keyBit: -1 });
    // 引擎入队后把游标清 -1（`sub_420640` 写 `[7468] = -1`）
    this.cursor = -1;
    return true;
  }

  /**
   * `sub_403C50`（raw 9787-9823）：**按坐标命中测试** —— 逐项判 `x0 <= px <= x1 && y0 <= py <= y1`，
   * 命中则把游标设为该项下标（**取第一个命中项**），否则 `-1`。
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
   * `sub_403E70`（raw 9918-9955）：按**游标变化**返回本帧该派发的悬停 label（−1 = 无）。
   *
   * 语义（逐行对齐源码）：
   *  - `pendingEnter`（`[7466]`）已置 ⇒ 本帧发 `[959]` 那项的 **labelA（进入）**，并清该标志；
   *  - 否则取 `hoverLatch`（`[959]`）与当前游标比较：
   *    - 相同 ⇒ 什么都不发；
   *    - 不同 ⇒ 先更新 `[959]`；**旧项有效** ⇒ 置 `pendingEnter` 并返回旧项的 **labelB（离开）**；
   *      旧项无效而新项有效 ⇒ 直接返回新项的 **labelA（进入）**。
   *
   * ★这就是 SN0000 右侧侧边栏"悬停展开/离开收起"的驱动：`SN0000.txt:63/74` 登记的热点
   * （文本区 / 侧边栏条）labelA = `label_00000c74`（展开），`SN0000.txt:66` 那块全屏热点
   * labelA = `label_00000e78`（收起）。emulator 此前**完全不派发悬停** ⇒ 侧边栏停在初始布局
   * （看起来"无条件展开"，用户 2026-09 实测）。
   */
  nextHoverLabel(): number {
    const v1 = this.cursor;
    if (this.pendingEnter) {
      const v2 = this.hoverLatch;
      this.pendingEnter = 0;
      if (v2 !== -1) return this.entries[v2]?.labelNext ?? -1;
    } else {
      const v4 = this.hoverLatch;
      if (v1 === v4) {
        this.pendingEnter = 0;
      } else {
        this.hoverLatch = v1;
        if (v4 !== -1) {
          this.pendingEnter = 1;
          return this.entries[v4]?.labelPrev ?? -1;
        }
        if (v1 !== -1) return this.entries[v1]?.labelNext ?? -1;
      }
    }
    return -1;
  }

  /**
   * `sub_403D70`（raw 9847-9862）：按**输入掩码**找第一个"已绑定键且该键被按下"的项，返回其 labelC。
   * 未绑定的项（`keyBit < 0`）按引擎一样跳过。
   */
  pickByKey(mask: number): number {
    for (const e of this.entries) {
      if (e.keyBit >= 0 && (mask & (1 << e.keyBit)) !== 0) return e.labelKey;
    }
    return -1;
  }

  /** 当前命中项（游标有效时）。 */
  current(): RouteEntry | null {
    return this.cursor >= 0 ? (this.entries[this.cursor] ?? null) : null;
  }

  /** 全量 teardown 时的复位。 */
  reset(): void {
    this.entries.length = 0;
    this.cursor = -1;
    this.hoverLatch = -1;
    this.pendingEnter = 0;
  }
}
