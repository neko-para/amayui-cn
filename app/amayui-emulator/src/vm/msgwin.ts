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
 * - 玩家推进由 `sub_411BC0` 经文本队列 `sub_403E70(Engine+21976)` 完成，清 `0x80000000` 并
 *   （必要时）重定位 `ip`。
 *
 * ## 建模范围（明确不做的部分）
 * 文本**布局与 GDI 渲染**（`sub_456430`/`sub_45D660`/`sub_45BE20`/`sub_465390`…）不在此建模：
 * 这里只保存"这段消息有哪些字、有没有注音、有没有显示完"，足够让状态机与控制流忠实。
 */

/** 一段文本 + 其上的注音对（`display-furigana` 0x196）。 */
export interface MsgSegment {
  text: string;
  /** `[被注音的词, 注音]` —— 0x196 的 op2/op3。 */
  ruby: [string, string][];
  /** 是否已断行（`end-text-line` 0x6F）。 */
  lineEnded: boolean;
}

/** 一个文本槽（引擎 `Engine[op1 + 261]` 指向的槽对象；op1 通常是 0）。 */
export interface MsgSlot {
  segments: MsgSegment[];
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

  /** 取（必要时新建）文本槽。 */
  slot(i: number): MsgSlot {
    let s = this.slots.get(i);
    if (!s) {
      s = { segments: [] };
      this.slots.set(i, s);
    }
    return s;
  }

  /** `show-text`：向槽尾追加一段文本。 */
  appendText(i: number, text: string): void {
    const s = this.slot(i);
    const last = s.segments[s.segments.length - 1];
    // 引擎把同一行的多段 show-text 拼成一行（`end-text-line` 才断行），这里照做。
    if (last && !last.lineEnded) {
      last.text += text;
      return;
    }
    s.segments.push({ text, ruby: [], lineEnded: false });
  }

  /** `display-furigana`：把 (词, 注音) 挂到当前行。 */
  addRuby(i: number, base: string, ruby: string): void {
    const s = this.slot(i);
    let last = s.segments[s.segments.length - 1];
    if (!last || last.lineEnded) {
      last = { text: '', ruby: [], lineEnded: false };
      s.segments.push(last);
    }
    last.ruby.push([base, ruby]);
  }

  /** `end-text-line`：结束当前行。 */
  endLine(i: number): void {
    const s = this.slot(i);
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
    return this.slot(i)
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
  }
}
