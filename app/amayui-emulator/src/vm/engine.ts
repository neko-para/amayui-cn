/** 引擎状态：全局数组池 + 每脚本帧（40 个）。干净建模（ADR-003），不复刻字节大块。 */
import type { ScriptBinary } from '../script/bin.js';
import type { FileSource } from '../arch/fileSource.js';
import type { NativeBridge } from './native.js';
import { InputManager } from './input.js';
import type { Ref } from './ref.js';

/** waitFlags 中的 sleep(0xC8) 门旗标（与 0x400 动画等待门并存）。 */
export const SLEEP_GATE = 0x20000000;

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

  // 引擎配置字段（稀疏 _this 索引，fidelity 到 engine.cpp）。默认值与引擎构造函数一致：
  // 构造函数/初始化（engine.cpp 22404，字节偏移 387932 = _this[96983]）把 96983 置 1；另一处重置（34632）清 0。
  // SYSTEM4 的 `u00415F40`(0x130) 读 96983 决定是否播放 LOGO 开场。构造函数默认=1 → LOGO 显示（真实游戏行为）。
  engineValues = new Map<number, number>([[96983, 1]]);

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
    return (this.effectFlags & 0x8000000) !== 0;
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
}
