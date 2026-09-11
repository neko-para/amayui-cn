/** 引擎状态：全局数组池 + 每脚本帧（40 个）。干净建模（ADR-003），不复刻字节大块。 */
import type { ScriptBinary } from '../script/bin.js';
import type { FileSource } from '../arch/fileSource.js';
import type { NativeBridge } from './native.js';
import { InputManager } from './input.js';
import { MsgWindow } from './msgwin.js';
import { RouteTable } from './route.js';
import { cfgInt } from '../engineConfig.js';
import type { Ref } from './ref.js';

/** waitFlags 中的 sleep(0xC8) 门旗标（与 0x400 动画等待门并存）。 */
export const SLEEP_GATE = 0x20000000;

/**
 * `effect_flags` 的 **bit31 = 等待推进门**（引擎主循环 `v35 < 0` 分支：`sub_411BC0` + `Sleep(2)`）。
 * 由 `0x72 wait-for-input` 置位；玩家推进时由每帧处理清除。**置位期间脚本完全不推进**。
 */
export const ADVANCE_GATE = 0x80000000;

/** `effect_flags` 的 **0x8000000 = 消息逐字显示中**（ADV 激活）。 */
export const ADV_ACTIVE = 0x8000000;

/** 某脚本帧的局部变量池（按操作数类型分池）。用 Map 避免索引越界假设。 */
export class LocalPools {
  int = new Map<number, number>(); // 存 ENC 位模式
  float = new Map<number, number>();
  str = new Map<number, string>();
  /** 指针池存 Ref|0（0=空引用），见 ADR-011 / docs/07。 */
  ptr = new Map<number, Ref | 0>();
  floatPtr = new Map<number, Ref | 0>();
  /** 字符串引用池（引擎 `_this[30*cur+95794]`，type 14 local-string-ptr）。 */
  strPtr = new Map<number, Ref | 0>();
}

/** 每脚本帧（120 字节 / 0x78 的语义重建模），对应 ScriptContext。 */
export class Frame {
  script: ScriptBinary | null = null;
  /** 脚本文件名（如 'SYSTEM4.BIN'），供观测。 */
  name = '';
  /** 当前指令在 script.instructions[] 里的下标 */
  ip = 0;
  locals = new LocalPools();
  /** 字符串表（脚本头部/装载时建立；M0 用 args.str 直接取，字段留空） */
  strTable: string[] = [];
  /** 返回链接：回到调用层帧下标（-1 表示无） */
  caller = -1;
  frameArg = 0;
  /** 当前指令长度（dword 单位，含 opcode）。M0 预解析后逐条步进，此字段供观查 */
  arity = 0;
  /** 每脚本数组容器（M0 不细究） */
  arrayContainer = new Map<number, number[]>();
  /** label 值(dword index) -> 指令数组下标 */
  labelMap = new Map<number, number>();
  /** 同脚本内 `call` 的返回地址栈（intra-script） */
  retStack: number[] = [];
}

/** 全局 variant 数组（索引为 VM 抽象索引，非进程地址）。用 Map 稀疏存储。 */
export class GlobalArrays {
  int = new Map<number, number>();
  float = new Map<number, number>();
  str = new Map<number, string>();
  /** 指针池存 Ref|0（0=空引用），见 ADR-011 / docs/07。 */
  ptr = new Map<number, Ref | 0>();
  floatPtr = new Map<number, Ref | 0>();
  /** 字符串引用池（引擎 `_this[95754]`，type 8 global-string-ptr）。 */
  strPtr = new Map<number, Ref | 0>();
}

/** 引擎对象：解释器/Command 的 `this` 语义重建模。 */
export class Engine {
  /** DEC/ENC key（per-instance；M0 用固定值，运行时 key 为开放点） */
  key = 0;
  /** 当前帧深度（cur_script） */
  cur = 0;
  frames: Frame[] = [];
  globals = new GlobalArrays();
  native: NativeBridge;
  fileSource: FileSource | null = null;

  /** 输入状态（mouse/joy 位置、按钮、按下沿、回调跳转目标）。渲染器与 VM 共享同一实例。 */
  input: InputManager;

  // 控制流目标深度寄存器（-1/-10/-11 哨兵）
  callRet = -1;
  callLink = -1;
  callFlag = 0;

  /** 引擎配置字段（稀疏 _this 索引，fidelity 到 engine.cpp）。默认值与引擎构造函数一致：
   *  构造函数/初始化（engine.cpp 22404，字节偏移 387932 = _this[96983]）把 96983 置 1；另一处重置（34632）清 0。
   *  SYSTEM4 的 `u00415F40`(0x130) 读 96983 决定是否播放 LOGO 开场。构造函数默认=1 → LOGO 显示（真实游戏行为）。
   *  ★**启动时由 SYS4REG.INI 填充**：见 `src/engineConfig.ts` 的 `CONFIG_FIELD_BINDINGS`（如 174713←sound:Music、
   *    167990←display:ScreenMode、21668←message:MesWinAlpha），renderer 在 boot 前调用 applyConfigToEngine。 */
  engineValues = new Map<number, number>([[96983, 1]]);

  /** 启动加载的 SYS4REG.INI 解析结果（未加载时 null）。供 opcode 直接读键（如 0x131 读 `message:MesWinAlpha`）。 */
  config: import('../engineConfig.js').EngineConfig | null = null;

  /**
   * **纹理槽表**：`槽号 → imgid`（由 `set-texture`(0x1F9) 建立，`release-texture`(0x1FA) 清除）。
   * `draw-texture`(0x1FB) 的 op1 是这个槽号，渲染器据此把槽解析成实际图像资源。
   */
  texSlots = new Map<number, number>();

  /**
   * **CG 数字条记录表**（引擎 `Engine+388332+28*cgno`，11 条 × 28 字节）。
   * `0x2DA` 登记（op2..op8 = 7 个 dword），`0x23B` 消费：用 CG 图当数字字模画数值。
   * 字段序：`[0]` 纹理槽 / `[1]` x0 / `[2]` y0 / `[3]` 单字宽 / `[4]` 字高 / `[5]` 字内空隙 / `[6]` 字距。
   */
  cgDigits = new Map<number, number[]>();

  /** 引擎 `_this[174801]` effect_flags 位掩码：
   *  0x400 = 动画等待门（0x21C wait）、0x20000000 = sleep(0xC8) 门、0x8000000 = ADV/消息激活。
   *  `waitFlags` 是它的旧别名；`advActive` 是 0x8000000 位的推导（见下方 getter）。 */
  effectFlags = 0;

  /** 菜单派发表（引擎 `_this+107679` 的字符串哈希表，0xA2 登记 key→label、0xA3 查表跳转）。key=菜单项序号字符串，value=目标 label(指令 index)。 */
  menuMap = new Map<string, number>();

  /** 引擎 `_this+5452` 字符串→整型哈希表（0x1A2 登记 key→value；0x1A3 查表写回 op1）。key = "\x03"+hex8(索引)。 */
  stringIndexTable = new Map<string, number>();

  /** 引擎 `_this+5472` 字符串→字符串哈希表（0x1A9 save-string 登记 key→str；0x1AA load-string 查表写回 op1）。key = "\x05"+hex8(字符串索引)。 */
  stringTable = new Map<string, string>();

  /** 引擎 `_this[97058]` 全局时间阈值槽（byte 388232）。0x149 写 / 0x148 读（get/set 对）。
   *  引擎里被 sub_4B9240 当作「光标贴顶/Alt→弹系统对话框」的去抖时长；emulator **暂无对应逻辑使用该值**，
   *  仅为实现 0x148/0x149 的读写接口而建模（见 analysis/functions.json sub_42FEC0/sub_4229A0）。 */
  globalSlot97058 = 0;

  /** ADV/消息状态机字段（稀疏 `_this[K]`：1415 / 97050 / 97051 / 122368 / 122370 / 122455 / 122496 / 124331）。 */
  advFields = new Map<number, number>();

  /**
   * **消息窗状态模型**（文本槽 + 消息窗对象表 + ADV/等待字段）。
   * 见 `./msgwin.ts` 顶部注释：ADV 是跨指令的持续状态，必须整体建模，不能散在 engineValues 里。
   */
  msgwin = new MsgWindow();

  /**
   * **点击热点 / 路由表**（引擎 `Engine+0x55D8`）。
   * `0x090` 登记热点（矩形 + 三个 label），`wait-for-input` 挂起后由它决定"玩家点了哪里 → 跳到哪个 label"。
   * 见 `./route.ts` 顶部注释。
   */
  routes = new RouteTable();

  /**
   * **用户登记的「未知指令桩函数」**：opcode -> 桩句柄（当前恒为 no-op，无返回值；句柄留着以便将来区分/替换）。
   * 语义 = 运行时热插拔的 ENGINE_INTERNAL_OPS（见 interpreter.stepOnce 的查找顺序）：
   *  - 解释器遇到「四处（OPS/NATIVE_OPS/ENGINE_INTERNAL_OPS/本表）都查不到」的 opcode 会抛 NotImplementedOp 并停下；
   *  - 控制窗点「作为桩函数跳过」→ 调用方 `unknownOpStubs.set(opcode, fn)` → **从同一条指令重试**即被当作桩放行；
   *  - 只影响本 Engine 实例，不改写 ops.ts 的静态表（可反复重启、可逐条增量跳过）。
   * 见控制窗 control.ts + renderer.ts 的暂停/恢复流程。
   */
  unknownOpStubs = new Map<number, number>();

  /**
   * **当前正在执行的 opcode**（由 `stepOnce` 在调用 handler 前写入）。
   * 用途：让不持有指令上下文的层（如 `NativeTap` 闸门 A）把"意图被丢弃"归因到具体指令。
   * 0 = 不在指令上下文中。
   */
  currentOpcode = 0;

  /** sleep(0xC8) 放行截止(ms)。waitFlags & SLEEP_GATE 期间渲染帧循环每帧 present，到 nowMs>=sleepUntil 才放行（对齐引擎帧让步）。 */
  sleepUntil = 0;

  /** 墙钟毫秒（= 引擎 timeGetTime()）；由渲染帧循环(renderer)或测试注入。0xCD(get-input-type) 节流用。 */
  nowMs = 0;

  /** effect_flags 的旧别名（读写都落到 effectFlags）。 */
  get waitFlags(): number {
    return this.effectFlags;
  }
  set waitFlags(v: number) {
    this.effectFlags = v;
  }

  /** ADV/消息激活态（= 引擎 effect_flags 的 0x8000000 位）。0xCD 在此位置位时可无条件推进。 */
  get advActive(): boolean {
    return (this.effectFlags & ADV_ACTIVE) !== 0;
  }

  /**
   * **等待推进门**（`effect_flags` bit31）：`wait-for-input` 已结束一页，脚本挂起等玩家推进。
   * 引擎主循环在此状态下**每帧只做 `sub_411BC0` + `Sleep(2)`，不派发任何脚本指令**。
   */
  get awaitingAdvance(): boolean {
    return (this.effectFlags & ADVANCE_GATE) !== 0;
  }
  set awaitingAdvance(v: boolean) {
    if (v) this.effectFlags |= ADVANCE_GATE;
    else this.effectFlags &= ~ADVANCE_GATE;
  }

  constructor(native: NativeBridge, input?: InputManager) {
    this.native = native;
    this.input = input ?? new InputManager();
    // 共享给 native（渲染器经 native.input 写鼠标事件）
    native.input = this.input;
    for (let i = 0; i < 40; i++) this.frames.push(new Frame());
  }

  curScript(): Frame {
    return this.frames[this.cur]!;
  }

  // ---------------------------------------------------------------------------
  // 帧循环服务（引擎主循环在 effect_flags 各分支里做的事；由宿主每帧调用）
  // ---------------------------------------------------------------------------

  /**
   * **ADV 每帧服务**（引擎 `sub_411900` raw 20096-20233 的等价物）。
   *
   * 引擎在 `effect_flags & 0x8000000` 分支里每帧做四件事：
   *  1. 刷输入掩码（`sub_4780D0`/`sub_477280`），并在「跳读中」时合成掩码位 `0x40`；
   *  2. 跑「取消消息键」三态机（`122370`: 0→1→2，松开时清 ADV + 复位 `ReadTextSkip`）；
   *  3. **未显示完判定**：`!122455 && !122496 && !(mask & 0x40)` ⇒ 清 `0x8000000`；
   *  4. 之后**派发恰好 1 条**脚本指令（`_this[opcode+168999]`）—— 由调用方执行。
   *
   * 返回 `true` = 本帧应派发 1 条指令（等价于引擎该分支的行为）。
   */
  serviceAdv(): boolean {
    const im = this.input;
    const m = this.msgwin;
    const mask = im.flush();
    const skipBit = m.skipMirror !== 0;

    // 取消消息键三态机（引擎门控：GetConfig("set:CancelMessageKey")）
    if (this.config && cfgInt(this.config, 'set:cancelmessagekey', 0) !== 0) {
      const bit = 0x10; // 掩码 bit4 = 鼠标左键
      if ((mask & bit) !== 0) {
        const was1 = m.cancelStage === 1;
        if (was1) m.cancelStage = 2;
      } else if (m.cancelStage === 2) {
        m.cancelStage = 0;
        this.effectFlags &= ~ADV_ACTIVE;
        m.skipMirror = 0;
        m.skipMode = 0;
        m.readTextSkip = 0;
      } else {
        m.cancelStage = 1;
      }
    }

    // 「显示完」收尾：非跳读模式下逐字显示视为**一帧内完成**（emulator 无逐字渲染）。
    if (m.showing !== 0 && m.skipMode === 0) m.showing = 0;
    if (!m.showing && !m.alt && !skipBit) {
      this.effectFlags &= ~ADV_ACTIVE;
    }
    return (this.effectFlags & ADV_ACTIVE) !== 0;
  }

  /**
   * **等待推进门服务**（引擎 `sub_411BC0` raw 20206-20461 的等价物）。
   *
   * 引擎在 `effect_flags < 0`（bit31）时每帧只做：刷输入 → 命中测试/键命中 → 取该热点的 label →
   * `ip = label` 并**清 bit31** + `Sleep(2)`。**不派发脚本指令。**
   *
   * 返回 `true` = 本帧玩家推进了（并已重定位 `ip`）。
   */
  serviceAdvanceWait(): boolean {
    if (!this.awaitingAdvance) return false;
    const im = this.input;
    const mask = im.flush();
    const pressed = (im.mouseEdge & 0b11) !== 0 || im.joyEdge.length > 0 || im.wheelDelta !== 0;
    if (!pressed) return false;

    // 引擎路径：`sub_403D70(queue, mask)`（键命中）优先，其次 `sub_403E70(queue)`（游标命中）。
    let target = this.routes.pickByKey(mask);
    if (target === -1 && this.routes.count > 0) {
      // `sub_403C50`：按鼠标坐标设游标（引擎在鼠标事件路径里调它；这里每帧按当前位置重算）
      if (im.hasCursor) this.routes.hitTest(im.readX(), im.readY());
      const hit = this.routes.current();
      if (hit) target = hit.labelKey;
    }

    im.consumeEdges();
    im.consumeWheelDelta();
    this.awaitingAdvance = false;
    if (target !== -1 && target !== 0xffffffff) {
      // 引擎：`ip = str_table + 4 * label` —— 即跳到该 label
      this.jumpToLabel(target);
      return true;
    }
    // 表为空（无热点登记）时回退：仅解除等待门，由脚本自己决定后续（近似，见台账 adv-advance-route-table）
    return true;
  }

  /**
   * **headless 确定性放行**：无输入源时（`report.ts` / `run.ts`）把等待门当作"玩家立刻点了"，
   * 若已登记热点则跳到第一个热点的 labelC（与真实点击同一路径），否则只解除门。
   * 返回跳转到的 label（`null` = 未跳转）。**仅 headless 使用**；renderer 走 `serviceAdvanceWait()`。
   */
  forceAdvance(): number | null {
    if (!this.awaitingAdvance) return null;
    this.awaitingAdvance = false;
    const first = this.routes.entries[0];
    if (first && this.jumpToLabel(first.labelKey)) return first.labelKey;
    return null;
  }

  /** 把当前帧的 `ip` 重定位到某个 label 值（引擎 `ip = str_table + 4*label`）。 */
  jumpToLabel(label: number): boolean {
    const f = this.curScript();
    const p = f.labelMap.get(label);
    if (p === undefined) return false;
    f.ip = p;
    return true;
  }
}
