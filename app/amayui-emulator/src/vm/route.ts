/**
 * **点击热点 / 路由表**（引擎 `Engine+0x55D8` 起的对象，`_this + 5494`（dword 下标））。
 *
 * ## 为什么它决定「等待输入」能不能结束
 * ADV 的推进不是"读鼠标键就直接往下跑"，而是走这张表：
 *  1. 脚本用 `0x090`（sub_420640 → sub_403B30）**登记一个矩形热点 + 三个 label**；
 *     消息场景常见的就是 `i090 0 0 500 2d0 …` —— 覆盖全屏的"点任意处推进"。
 *  2. `0x72 wait-for-input` 置 `effect_flags` bit31 挂起脚本。
 *  3. 主循环每帧 `sub_411BC0`：刷输入掩码 → `sub_403C50` 按鼠标坐标做命中测试把**游标**设到命中项
 *     → `sub_403C50/sub_403D70/sub_403E70` 取出该项的 label → `ip = label` 并**清 bit31** ⇒ 脚本继续。
 *
 * ## 表结构（引擎实证，`sub_403B30` raw 9740-9764）
 * 最多 **100** 项，每项：
 * ```
 * [259 + i] = a6   // label A：sub_403E70 的"下一页"目标
 * [359 + i] = a7   // label B：sub_403E70 的"上一页 / 另一路"目标
 * [459 + i] = a8   // label C：sub_403D70 的"键命中"目标
 * [559 + 4i .. +3] = a2,a3,a4,a5   // 矩形 x0,y0,x1,y1（调用方已把 w/h 加成 x1/y1）
 * [7361 + i] = -1  // 输入掩码位（入队时未绑定；-1 表示不参与键命中）
 * [7461] = a9      // frame_arg
 * ```
 * `0x090` 的调用形态（真实脚本）：`i090 <x> <y> <w> <h> <labelA> <labelB> <labelC>`
 * —— `sub_420640` 把 w/h 加成 x1/y1 后传入。
 *
 * ## 本实现的范围与偏差（明确记录）
 * - 实现：入队（`0x090`）、按坐标命中测试设游标、按"推进输入 + 游标命中"取 label 并重定位 `ip`。
 * - **未实现**引擎里 `[7466]/[959]` 的"游标去重锁存"（防止同一次命中重复推进）：emulator 改为要求
 *   **本帧存在推进输入**（鼠标按下沿 / 滚轮 / 手柄）才推进 —— 否则"鼠标停在屏幕上就自动翻页"。
 * - 未实现键位绑定（`[7361+i]` 的写入方）与 `sub_403500` 的坐标变换（视口缩放）。
 */

/** 一个热点项。 */
export interface RouteEntry {
  /** 命中矩形（引擎里 x1/y1 已含宽度）。 */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** `[259+i]`：`sub_403E70` 的"下一页"目标 label。 */
  labelNext: number;
  /** `[359+i]`：`sub_403E70` 的"另一路"目标 label。 */
  labelPrev: number;
  /** `[459+i]`：`sub_403D70`（键命中）的目标 label。 */
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
   * 命中则把游标设为该项下标，否则 `-1`（引擎：`[7468] = i` / `= -1`）。
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
  }
}
