/** 引擎状态：全局数组池 + 每脚本帧（40 个）。干净建模（ADR-003），不复刻字节大块。 */
import type { ScriptBinary } from '../script/bin.js';
import type { FileSource } from '../arch/fileSource.js';
import type { L2dInstance, L2dNode, Mtn } from '../live2d/runtime.js';
import type { NativeBridge } from './native.js';
import { InputManager } from './input.js';
import { MsgWindow } from './msgwin.js';
import { PANEL_BASE } from './handlers/panel.js';
import { RoutePanel } from './route.js';
import type { PanelField } from './route.js';
import { ITEM_REFLOW, TextItemTable } from './textItems.js';
import { StageLoop, runStageService } from './stageLoop.js';
import { TEXT_BASE_GATE } from './handlers/text-items.js';
import { cfgInt } from '../engineConfig.js';
import { CFG } from '../configRegistry.js';
import { emitWin, messageSpeedOf, styleOfWin, winStyle } from './handlers/msgwin.js';
import { ENGINE_FIELD, FIELD_CHAR_CURSOR, FIELD_WIN_REVEAL_GATE } from './engineFieldIds.js';
import { layoutWindow } from '../text/layout.js';
import type { Ref } from './ref.js';

/** waitFlags 中的 sleep(0xC8) 门旗标（与 0x400 动画等待门并存）。 */
export const SLEEP_GATE = 0x20000000;

/**
 * **通用 `Queue_int` 队族的槽数 = 10**（`tickets/T-0156`）—— 不是 11。
 *
 * 引擎三处都是"从 10 数到 1"的 `do/while`（`v15 = 10; … v8 = v15-- == 1;`，即**恰好 10 次**）：
 * `sub_40DF10` 的复位 raw 18081、`sub_40DF10` 的 `Stack_int` 支 raw 18111、构造函数 raw 22658。
 * ⇒ 「11 个槽」是把先比较后自减的 `--` 数成了 11 次（`tickets/T-0156` 的 wrong-constant 修正）。
 */
export const QUEUE_INT_SLOTS = 10;

/**
 * `effect_flags` 的 **bit31 = 等待推进门**（引擎主循环 `v35 < 0` 分支：`sub_411BC0` + `Sleep(2)`）。
 * 由 `0x72 wait-for-input` 置位；玩家推进时由每帧处理清除。**置位期间脚本完全不推进**。
 */
export const ADVANCE_GATE = 0x80000000;

/** `effect_flags` 的 **0x8000000 = 消息逐字显示中**（ADV 激活）。 */
export const ADV_ACTIVE = 0x8000000;

/**
 * `effect_flags` 的 **0x40000000 = 逐字显现模式**（引擎主循环 raw 20887-20895 的 `v25 & 0x40000000`）。
 *
 * 置位：`0x72 wait-for-input` 每次（raw 28551，同时把 `Engine[107704]` 游标清零）、`0x1CE op1≠0`（raw 29337）。
 * 清位：`0x1CE op1=0`（raw 29348）、点击推进（raw 20029，先 `sub_45A940(...,-2,0)` 收尾）、
 * `sub_411900`/`sub_409400` 的收尾分支。
 *
 * 引擎的每帧动作只在这位置位时才发生：`sub_453AF0(Engine+430600)`（节拍门，周期 = `0x73` op10）
 * ⇒ `sub_45A940(Font, 当前窗, Engine[107704], 0)`（贴出第 k 个字格）⇒ `k = (k+1) % Engine[107705]`。
 */
export const CHAR_REVEAL_ACTIVE = 0x40000000;

/**
 * `effect_flags` 的 **0x4000000 = 「重显示（回看）模式」**（引擎 `Engine[122452]` 的模式位）。
 *
 * 置位端：`0x199`（`sub_418FC0` raw 24510 的 `122452 = effect_flags | 0x6000000`）、等待泵的右键
 * 取消路由（raw 20369）、主循环 `0x4000000` 臂自己（raw 20870-20872，写的是 `| 0x2000000`）。
 * 清零端：`0x7C`（`sub_41AB80` raw 25811 `mode = 0`）与主循环 `0x4000000` 臂（raw 20866）。
 */
export const REDISPLAY_MODE = 0x4000000;

/**
 * **自动翻页计时器对象**（引擎 `Engine+430180` = `_this[107545]` 起 7 个 dword 的计时器块；
 * `t[2]` = 周期序号、`t[4]` = 停表、`t[5]` = 起点 `timeGetTime()`、`t[6]` = 周期 ms）。
 *
 * 谁写：`0x72` 尾段（raw 28585 `sub_453A60`）、`sub_4090F0`（raw 13726）、等待泵 `sub_411BC0`
 * （raw 20399 `sub_453BD0` / raw 20425 `sub_453A60`）。谁读：**只有** `sub_411BC0` raw 20430
 * 的 `sub_453AF0`（到期 ⇒ 自动翻页）⇒ 这就是 `Engine[97052]` 的消费端（见 `#serviceAutoMessage`）。
 */
const AUTO_MESSAGE_TIMER = 107545;

/** 引擎 `Engine[122501]`（= `Input`… 不，是设备）：语音 3 路里是否有正忙（`sub_404CB0`；emulator 恒 0，见 audio 侧缺口）。 */
const FIELD_VOICE_BUSY = 122501;

/**
 * **引擎 `Engine[97053]`**（= 字节 388212）：`sub_409400` 的「**上一次的贴完整页出口已经消费过这一页**」闩锁。
 *
 * 全库只有 5 处引用（`grep 97053|388212` 实测）：
 *  - **写 1** = `raw 13941`（逐字期间点击/滚轮 ⇒ `Engine[388212] = 1`，见 `serviceRevealAdvanceInput`）；
 *  - **读** = `raw 13917`（泵的 `else if` 支：清 `0x20000000` + 再自旋贴完当前窗，见 `serviceTextReveal`）；
 *  - **写 0** = `raw 28557`（`0x72 wait-for-input` `sub_41EEF0` 的共存消息段）、`raw 17973`（整体复位
 *    `sub_40DF10`）、`raw 22604`（构造 `sub_415640`）。
 *  ★**`0x6E show-text`（`sub_41EB20`）不清它**（`raw 28320-28386` 无此写点）—— 这一点是本格的关键：
 *  同一句里 `0x196 display-furigana` 续写（`raw 29093` 置 `0x20000000`）时它仍在 ⇒ 泵走这一支。
 *  emulator 的初值 0 由 `engineValues` 的稀疏语义天然成立（构造写 0 无需显式落），
 *  复位那一半落在 `handlers/control.ts` 的 `op_exit_script`（`sub_40DF10` 的等价物）。
 *
 * ★**导出理由**（`tickets/T-0169`）：`handlers/control.ts` 的复位点要用它，而 `engine-field-ids.test.ts`
 *  的棘轮禁止 `src/vm/**` 出现裸数字键。规范位置是 `engineFieldIds.ts`，但本单元的硬边界不含该文件
 *  ⇒ 常量暂住这里（**别人该接**：搬进 `engineFieldIds.ts` 的 `ENGINE_FIELD.revealInputConsumed`）。
 */
export const FIELD_REVEAL_INPUT_CONSUMED = 97053;

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

  /**
   * 清空全部局部池 —— 等价于引擎**载入脚本时"建局部池 + 填 `enc_zero`"**（`sub_40ED40`）。
   *
   * ★这是**每次脚本载入**都要做的事（见 `loadScriptIntoFrame` 的说明）：
   * 帧槽会被复用（退出脚本后被 `call-script` 再次调回来最典型），
   * 不清池就会把**上一次调用的局部量泄漏进新一次调用**。
   */
  clear(): void {
    this.int.clear();
    this.float.clear();
    this.str.clear();
    this.ptr.clear();
    this.floatPtr.clear();
    this.strPtr.clear();
  }
}

/** 每脚本帧（120 字节 / 0x78 的语义重建模），对应 ScriptContext。 */
export class Frame {
  script: ScriptBinary | null = null;
  /** 脚本文件名（如 'SYSTEM4.BIN'），供观测。 */
  name = '';
  /** 当前指令在 script.instructions[] 里的下标 */
  ip = 0;
  /**
   * **当前正在执行的那条指令的 dword 偏移**（= 引擎 `(ip - ip_base) >> 2`，`sub_4051E0` raw 10940）。
   *
   * 为什么需要它：引擎的返回点规则（`sub_405360(Engine, -3)`）是**纯 dword 算术**
   * ——「调用点的 dword 偏移 − 3」。emulator 的 `ip` 是**指令数组下标**（每条 +1，不随指令的
   * dword 长度变），所以在 dword 空间里换算时必须知道"调用点那条指令自己的 dword 起点"。
   *
   * 由 `stepOnce` 在调用 handler **之前**写入（那时 ip 还没推进）；`dispatchWithReturn` 用它。
   * 手搓 `makeCtx` 的测试路径没有写它 ⇒ 回退到"用 `ip` 反推"（见 `currentDwordOffset`）。
   */
  curDwordOffset = -1;
  locals = new LocalPools();
  /** 字符串表（脚本头部/装载时建立；M0 用 args.str 直接取，字段留空） */
  strTable: string[] = [];
  /** 返回链接：回到调用层帧下标（-1 表示无） */
  caller = -1;
  frameArg = 0;
  /**
   * **本指令的"操作数记数槽"**（引擎 `ScriptContext+0x74`，绝对字节 **0x5D8F4** = `_this[30*cur + 95805]`）。
   *
   * 值 = **`2*argc + 1`**（= 指令占几个 dword，含 opcode）；引擎主循环用**它**推进 ip：
   * `_this[30*cur+95782] += 4 * _this[30*cur+95805]`（raw 20165）⇒ 控制流指令把本槽写 **0**
   * （派发器不前进，由 handler 自己定 ip：`0x2` exit / `0x84` / `0xd5` 三条）。
   *
   * ★**命名遵数据层**（`analysis/fields.json`）：引擎里叫 `arity` 的是**另一个**字段
   * （`ScriptContext+0x60`，装载时清零、**没有读者**）；本槽的名字是 **`operand_count`**
   * —— 曾因帧基址误记 0x5D894 而把两者混为一谈，见该条 `meaning`。
   *
   * ★在 emulator 里的等价物是解析器的 dword 索引表（`BinInstruction.index`，装载时算好）⇒
   * 本字段**不参与推进**，它是"这条指令占几个 dword"的**引擎真源**：派发器写它、`StepTrace` 报它、
   * 守卫拿它与反编译体里解析出的 N 逐条对照（`tickets/T-0082`；`test/operand-plan.test.ts`）。
   */
  operandCount = 0;
  /** 每脚本数组容器（M0 不细究） */
  arrayContainer = new Map<number, number[]>();
  /** label 值(dword index) -> 指令数组下标 */
  labelMap = new Map<number, number>();
  /** 同脚本内 `call` 的返回地址栈（intra-script） */
  retStack: number[] = [];
  /**
   * **脚本身份 token**（引擎 `frames[cur][95796]`，dword 下标 95796 / 字节 383184）。
   *
   * 装载脚本时写入（引擎 `sub_40ED40` raw 18636 `frames[cur][95796] = a4`，`a4` = 打开该脚本用的
   * **统一文件 id**；同一处用它取脚本名）。初始值 -1（构造函数 raw 11174/18463）。
   *
   * 谁用它：
   *  - `0x090` 把它当 `panelA[7461]` 存进路由表（raw 29504 → 9762）＝「登记这张表的脚本」；
   *  - 三个守卫拿它与注册那一刻的值比对，不等就抛 `Depth が不正です`
   *    （`sub_4083B0` raw 13121 比 `[7461]`、`0xCD` raw 25861 比 `Engine[107674]`、
   *     `0x7C` raw 25799 比 `Engine[430712]`）；
   *  - 文本排版把它当"脚本深度"传给 `sub_48F000`/`sub_48EB30`。
   */
  scriptId = -1;
  /**
   * **本帧最后一次 `0x71`（message-show，"开始一段新消息"）的指令下标**（`tickets/T-0063`）。
   *
   * 用途单一：本工程槽读档时把落点选在**存档当时那句话**上（重放它 ⇒ 屏幕上立刻有文字），
   * 与引擎帧记录里的 `[259]`（`0x71` 表下标）同语义。`-1` = 本帧还没显示过消息。
   */
  lastMsgIp = -1;
}

/** 全局 variant 数组（索引为 VM 抽象索引，非进程地址）。用 Map 稀疏存储。 */
/** 调试语义事件的类型（见 `Engine.debugEvent` 的说明：**按池命名**）。 */
export type DebugEventKind =
  | 'global-int-write'
  | 'global-float-write'
  | 'global-str-write'
  | 'slot-bind'
  // ★`tickets/T-0127` 扩的两类：让"谁写了 Engine[N] / local N"也能被事件断点抓到
  //   （审计说：这两类此前只能靠静态读码或写专门的探针用例，因此"探针型断言"降不下去）。
  | 'engine-field-write'
  | 'local-int-write';

/**
 * `engineValues` 的承载类型：**写即发事件**的 Map（见 `Engine.engineValues` 的说明）。
 * `removed=1` 表示这是一次 `delete`（值按 0 报，条件里可用 `removed == 1` 区分）。
 */
export class EngineFieldMap extends Map<number, number> {
  #onWrite: ((idx: number, val: number, kind: 'set' | 'delete') => void) | null;
  constructor(onWrite: ((idx: number, val: number, kind: 'set' | 'delete') => void) | null, entries: [number, number][]) {
    // ★注意：**不能** `super(entries)` —— `Map` 的构造函数会逐条调 `this.set`，而那时私有字段
    //   `#onWrite` 还没装上（JS 私有字段在 `super()` 之后才初始化）⇒ TypeError。
    //   所以先装钩子，再用 `super.set` 填初值（`super.set` 不经过我们的重写 ⇒ 构造期不发事件）。
    super();
    this.#onWrite = onWrite;
    for (const [k, v] of entries) super.set(k, v);
  }
  override set(k: number, v: number): this {
    super.set(k, v);
    this.#onWrite?.(k, v, 'set');
    return this;
  }
  override delete(k: number): boolean {
    const had = super.delete(k);
    if (had) this.#onWrite?.(k, 0, 'delete');
    return had;
  }
}

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

  /**
   * **读档续跑记录**（`tickets/T-0059`）：装载**引擎格式**的真槽（`0x1A1`/`0x19F`）时由
   * `handlers/save-slot.ts` 写入，`0xAE`（`handlers/frame.ts`）逐帧消费，收尾清空。
   *
   * 为什么需要它：存档只记"哪一帧、哪张表的下标"（`frames[k][259]/[260]`），真正的 ip 要拿
   * **帧里那份脚本自己的**两张表（`0x71` 消息表 / `0x3` call-script 表）换算，而这张换算
   * 发生在**脚本侧的 `0xAE`**（`sub_4192F0`）里 —— 它按 `cur` 逐帧走栈（`sub_40F750(3)` 装载下一帧），
   * 直到 `cur == savedCur` 才清「正在读档」门。
   *
   * `null` = 没有进行中的续跑（此时 `0xAE` 与引擎一样**直接返回**，不改任何帧状态）。
   */
  saveResume: import('./engineSlot.js').EngineSlotResume | null = null;

  /**
   * **走栈期间要反复装回的画面**（`tickets/T-0069`）—— 读档装了画面快照之后挂上，`0xAE` 每个走栈步装回一次，
   * 收尾（`cur === savedCur`）那一刻松手。
   *
   * 为什么需要：续跑是"帧 0 从入口重跑"，一路上场景入口的初始化会重跑（`create-mesh` 重建遮罩、
   * `set-vertex-color-alpha` 重播淡入）⇒ 玩家看到"快照（带遮罩）→ 无遮罩 → 遮罩淡入"的二次播放。
   * 引擎不会：它的后备缓冲从不清，旧像素压着那些一次性绘制。emulator 的等价物就是这份 hold。
   * `null` = 没有 hold（真槽没有快照；或已读档完成）。
   */
  loadHold: import('./handlers/save-slot.js').SlotPresentation | null = null;
  /**
   * **文本累加缓冲**（引擎 `Engine+497344`）—— `0x1B2`（追加字符串）/`0x1B3`（追加 `"\r\n"`）/
   * `0x1B4`（取出整段并清空）三条指令共用的那个容器。
   *
   * 引擎依据：`sub_42A9B0`（raw 36550-36558，`sub_40C660(_this + 124336, 串, strlen)`）、
   * `sub_42AA00`（raw 36560-36565，追加 `asc_51EE84` = `"\r\n"`，raw 4320）、
   * `sub_428DB0`（raw 35322-35331，`sub_40B420(_this + 497344, 0, -1)` 取整段）。
   * ★`124336`（= 该容器的元素下标）在**全反编译里只出现于这三处** ⇒ 没有别的读者/写者；
   * 三条指令都不写操作数，所以本建模的观测面 = 日志（否则就是一处沉默的死写）。
   */
  textBuffer = '';
  /**
   * **程序化纹理槽的尺寸表**（emulator 记账，引擎没有这一格）：`0x1F8`（`create-texture`）建槽时记下
   * `w/h`，`0x1FA`（`release-texture`）删掉。用途 = **`0x23F`**（`sub_4307B0` raw 40019-40031）读
   * "槽 → 尺寸 ×1000、缺槽 ⇒ −1"。★引擎那条读的是节点对象上的 `sub_4080B0`（画布尺寸，vtable `+40`/`+68`），
   * 而本文语料里 `0x23F` 的 `op2` 是**刚 create 出来的槽**（`src/FIELD.txt:13718-13721`，120×120），
   * 故按"槽尺寸"建模；**宽/高归属在语料里不可分辨**（正方形），已在 `op_get_slot_size` 注释里披露。
   */
  texSizes = new Map<number, [number, number]>();
  globals = new GlobalArrays();
  native: NativeBridge;
  fileSource: FileSource | null = null;

  /** 输入状态（mouse/joy 位置、按钮、按下沿、回调跳转目标）。渲染器与 VM 共享同一实例。 */
  input: InputManager;

  // 控制流目标深度寄存器（-1/-10/-11 哨兵）
  // ★`tickets/T-0173`：这里原有 `callLink`(引擎 0x5D888=383112) / `callFlag`(0x5D88C=383116) 两格镜像，
  //   已删 —— 它们只有声明与本 class 的初始化、全仓 0 个生产读者（`callRet` 才是活的那一格）。
  //   ★引擎侧那两格**不是**死格：`sub_40FB60` 存（raw 18978/18982）、`sub_41A820` 的 `caller == -10`
  //   分支读回（raw 25663-25666）；只是 emulator 早已用 `dispatchSavedCur` / `dispatchSavedFlags`
  //   （见下方"脚本请求派发"一节）建模同一条通路 ⇒ 删掉的是重复表示，不是能力。守卫：
  //   `test/op-6-05-step-slot.test.ts` 的 `T-0173` 用例（含反向断言：活的那对不许删）。
  callRet = -1;

  // ---------------------------------------------------------------------------
  // 脚本请求派发（引擎：dispatch_queue@0x796DC / dispatch_in_progress@byte 497400 / 派发帧 37）
  // ---------------------------------------------------------------------------
  /**
   * **排队待派发的脚本 id**（引擎的 `dispatch_queue`，`Queue_int` @ byte 0x796DC）。
   *
   * 生产者：`0x143`（`i143`）把每个**已装载扩展包**的 `包号<<24` 压进来 —— 那就是该包的文件 #0 =
   * `$n$AUTORUN.BIN` 的统一 id（引擎 `sub_41A000` 的 `queueScript(slot<<24)`）。
   * 消费者：`dispatchNextRequest`（引擎 `sub_40FB60`），一次装载一条到帧 37。
   */
  scriptRequests: number[] = [];
  /** **派发中**标志（引擎 `_this[124350]` / byte 497400）：置位时 `queueScript` 只入队、不立即派发。 */
  dispatching = false;
  /** 派发保存的现场（引擎 byte 383112/383116 = 派发前的 `cur` 与 `effect_flags`）；队列排空后还原。 */
  dispatchSavedCur = -1;
  dispatchSavedFlags = 0;

  /**
   * **通用 `Queue_int` 队族**（引擎 `_this + 388252`(字节) 起的 **11** 个队列指针，即
   * `Engine[4*i + 388252]`，i=0..10；`0x132`/`0x133`/`0x134` 三条指令的容器）。
   *
   * 引擎证据：
   *  - **规模 11**：构造/复位两处都按 11 个槽遍历 —— 引擎 init raw 18080-18096（`v15 = 10; do{ 析构旧 + new(0x1C) + sub_407C50 }while(--v27)`）
   *    与 teardown raw 19204-19212（`v27 = 10; do{ 析构 + *v15++ = 0 }while(--v27)`）；
   *    引擎构造函数同样构造（raw 22655 可见 `*(_DWORD *)(_this + 388252) = 0;`）。
   *  - **队列对象**：`sub_407C50`（raw 12653-12663）= `vftable + buf = new[0x400]（256 int）+ cap[4]=256 + step[5]=256 + rd[2]=0 + wr[3]=0 + max[6]=0`；
   *    push = `sub_409E10`（raw 14280-14320 起：顺序数组 + 满时按 step 扩容 / 就地把 `rd` 起的内容左移压实 ⇒ **FIFO**）、
   *    pop 内联在 `0x134` 的 handler 体里（raw 39379-39396）。
   *  ⇒ emulator 以 `number[]` 的 `shift`/`push` 复刻同一 FIFO 语义；引擎的环形缓冲/扩容/压实是**实现细节**，
   *    脚本可观测的只有「长度 + 出队顺序 + 队空」。
   *
   * 默认值是 **11 个空队**（= 引擎构造后、尚未被 `0x132` 重建时的状态）。
   * ★披露的口径差：引擎在 teardown/exit-script（raw 19204）把 11 个槽置 **NULL** —— 此后若不先 `0x132`
   *   就 `0x133`，真引擎是空指针解引用（崩），重写侧则是往空队里 push（不崩）。脚本合法序列（先 `0x132`）
   *   行为完全一致；这条容错已在 `handlers/control.ts` 的 `op_queue_push` 注释与
   *   `analysis/opcode-gaps.json` 的 `0x133` note 里披露。
   */
  dispatchQueues: number[][] = Array.from({ length: QUEUE_INT_SLOTS }, () => [] as number[]);

  /** 引擎配置字段（稀疏 _this 索引，fidelity 到 engine.cpp）。默认值与引擎构造函数一致：
   *  构造函数/初始化（engine.cpp 22404，字节偏移 387932 = _this[96983]）把 96983 置 1；另一处重置（34632）清 0。
   *  SYSTEM4 的 `u00415F40`(0x130) 读 96983 决定是否播放 LOGO 开场。构造函数默认=1 → LOGO 显示（真实游戏行为）。
   *  ★**启动时由 SYS4REG.INI 填充**：见 `src/engineConfig.ts` 的 `CONFIG_FIELD_BINDINGS`（如 174713←sound:Music、
   *    167990←display:ScreenMode、21668←message:MessageSpeed、80106←message:MessageFade），
   *    renderer 在 boot 前调用 applyConfigToEngine。`field` 一律是 dword 下标（= handler 的 `_this[K]` 空间）。 */
  /**
   * ★**引擎字段（`_this[K]`）的写门面**（`tickets/T-0127`）：`engineValues` 用这个 Map 子类承载，
   * 每次 `set`/`delete` 都发一条 `engine-field-write` 事件。
   *
   * 为什么用"包一层 Map"而不是给每个写点加一句 `emitDebugEvent`：写点散落在 handler / 配置灌入 /
   * 读档恢复等**十几处**，逐处加等于把"谁负责发事件"变成纪律；包一层则**任何**写入路径都被覆盖
   * （含将来新增的），且 `Map` 的既有 API 一字不改（`size`/`get`/`entries` 都照旧）。
   */
  engineValues: EngineFieldMap = new EngineFieldMap(
    (idx, val, kind) => this.emitDebugEvent('engine-field-write', { idx, val, removed: kind === 'delete' ? 1 : 0 }),
    [
    [96983, 1],
    // 517 = SetKeyTotal（0xFE）：Input 构造函数 `sub_477DD0`（raw 92385）写 `_this[259] = 7`
    // （Input 对象 = `Engine + 258` ⇒ Input[259] = Engine[517]）。它同时是 **0x100 在掩码为空时的
    // "默认键"槽下标**（`tickets/T-0046`）——开机后 `SYSTEM4.txt:86` 的 `i0fe c` 会把它改成 12。
    [517, 7],
    // ★`scriptEngineFlag`（`_this[174812]` = 字节 699248）：**构造初值 = 1**。
    //   体证：构造 `sub_415640` raw 22591 `*(_DWORD *)(_this + 699248) = 1;`；整块复位 `sub_40DF10`
    //   raw 17961 同形（emulator 的复位落点见 `handlers/control.ts` 的 `op_exit_script`，本票 T-0169）。
    //   写者只有 `0x142`（`sub_422930` raw 31026），读者只有导出查询 `sub_4765C0`（raw 91057-91061，
    //   工程内零调用）⇒ 不种这一格时「`i142 1` 之前读到 0」与引擎相反（`tickets/T-0175` ① / `T-0161` §5）。
    [ENGINE_FIELD.scriptEngineFlag, 1],
  ]);

  /**
   * **Font 的「场景态」复位** —— 引擎整体复位 `sub_40DF10` 里属于 Font 的那两笔（`tickets/T-0187` ③）。
   *
   * 引擎证据（`engine/天结_unpacked.exe_utf8.c`）：
   *  - 整体复位 `sub_40DF10` **raw 18025** 调 `sub_465390(Font, …)`；该函数 **raw 78891-78894** 写
   *    `Font+1360 = 0xFFFFFF`（填充白）/ `+1364 = 0`（描边色）/ `+1368 = 0` / `+1372 = 1`（描边档位），
   *    **raw 78951** 写 `Font+1392 = 0`；
   *  - 同一函数 **raw 18077** 再直接写 `Engine+86688`（= `Font+1392` = 本工程 `followTextMode`）**= 0**。
   *  ⇒ 这四个字段（`colorFill`/`colorOutline`/`outlineMode`/`followTextMode`）在引擎里是**整体复位的一部分**，
   *    复位值就是它们的引擎初值（`0xFFFFFF` / `0` / `1` / `0`）—— 写的是 raw 的字面值，不是为某张截图调的参。
   *
   * 调用点（两处，都必须是「回到根帧重新进场景」这一类事件）：
   *  1. `exit-script`(`0x9` = `sub_428A60`) **就是**整体复位（raw 35270）⇒ `handlers/control.ts`；
   *  2. 读档的控制转移（`sub_410160` raw 19914-19918：两张面板复位 + `cur = 0` + 装载存档记录的脚本；
   *     emulator 的等价物 = `handlers/save-slot.ts` 的 `transferToRootAfterLoad`）。
   * 之后**重跑的脚本入口**会按场景重新设定（序章链 `src/NOVEL.txt:8 i1b1 1`；章节链 `SYSTEM4 > SC0000`
   * 不设 ⇒ 保持 0 = ADV 窗的固定位分支）。
   *
   * ★漏掉它的后果（`tickets/T-0187` ③ 的实测）：先读序章档、再读章节档 ⇒ `Font+1392` 留 1
   * ⇒ `0x73` 的 ▼ 按「跟随笔位」分支算到 `(1235,728)`（屏外）。
   */
  resetFontSceneState(): void {
    this.engineValues.set(ENGINE_FIELD.colorFill, 0xffffff);
    this.engineValues.set(ENGINE_FIELD.colorOutline, 0);
    this.engineValues.set(ENGINE_FIELD.outlineMode, 1);
    this.engineValues.set(ENGINE_FIELD.followTextMode, 0);
  }

  /**
   * **字体面名解析策略**：这套资源是纯日文（`jp`）还是 ShiftJIS 编码的中文（`cnjp`）。
   *
   * 由 `emulator.config.json` 的 `resources.version` 决定（`applyEmulatorOptionsToEngine` 写入），
   * `resolveFace` 按它选面名表（见 `src/text/fontSet.ts`）。默认 `cnjp` = 当前行为。
   * ★这里**不是**引擎字段（真引擎没有这个概念），所以不放 `engineValues`。
   */
  resourceVersion: import('../emulatorOptions.js').ResourceVersion = 'cnjp';

  /** 启动加载的 SYS4REG.INI 解析结果（未加载时 null）。供 opcode 直接读键（如 0x131 读 `message:MesWinAlpha`）。 */
  config: import('../engineConfig.js').EngineConfig | null = null;

  /**
   * **音乐表**（引擎 `Music[271]`（PCM 对象）的 `+1304` / `+1320` 两个 vector；2026-09 落地）。
   *
   * - `flat`：**曲号 − 2 → 统一文件 id**（`sub_48DB80` raw 108738 用它解析 `play-bgm` 的操作数）；
   *   启动时由宿主从 `SYS4INI` 尾部装载（`parseMusicTables`，与引擎 `sub_48A0D0` 同口径）；
   * - `groups`：**包内音乐表**（1-based 组号 → 文件 id 列表；`sub_48DB80` 的包分支用
   *   `组 = (id>>24)-1`、`下标 = id & 0xFFFFFF`（**直接取，不 −1**）；组内下标 0 是占位槽）。
   *
   * 谁改它：`0x1D6`（append 到 `flat`）、`0x1D7`（确保组数 ≥ op2 并把该组重置成只剩占位槽）、
   * `0x1D8`（往某组登记/填洞）。
   * 扩展包的 `$n$AUTORUN` 正是用后两条把自己的曲子登记进来的（`$3$AUTORUN.txt:67-68`）。
   */
  musicTable: import('../script/alf.js').MusicTables & { groups: number[][] } = { other: [], base: [], groups: [] };

  /**
   * **「已使用文件」标志集**（引擎 `FileDB` 的每包一张哈希表：`FileDB+1052`（本体）与
   * `FileDB+14404+4*包号`（扩展包）；2026-09 读体落地）。
   *
   * - **写**：引擎在 `sub_4559C0`（按统一 id 打开文件）里调 `sub_454960(FileDB, id)` 写入该 id 的
   *   确定性哈希 `87912345*id - 1330597712`（低 16 位 ≡ `28569*id - 20304`）⇒ **任何被打开过的文件
   *   都会留痕**（脚本、图像、音频都一样）。
   * - **读**：`sub_4181F0(FileDB, id)` 把该槽读回来与同一个哈希比对 ⇒ 0/1；指令 `0x19D` 就是它
   *   （`op1 ← 该 id 是否已被打开过`）。
   * - **为什么这决定「回想 → BGM 鉴赏」的曲目表**：`$3$SETMEMOIR`（每进一次回想都跑）用 `0x19D`
   *   逐条问 `12265c[i]`（BGM 的统一文件 id，由 `MUINIT.BIN` 填）⇒ 解锁的曲目下标写进 `122731`、
   *   数量写 `12272f`；`MMODE`（BGM 鉴赏）只画这些下标。**少实现 0x19D ⇒ 整个列表 0 条**（实测：
   *   36 条曲目、0 条解锁、百分比 0）。
   * - 引擎把这张表持久化在 `$$SAVE.DAT`（`sub_40AAE0` 装载 / `sub_404A70` 写回，带随机密钥校验头）——
   *   emulator 目前只做会话内（不读 `$$SAVE.DAT`，缺口写在文档里）。
   */
  usedFileIds = new Set<number>();

  /** 标记「统一文件 id 已被打开」（引擎 `sub_454960`；见 `usedFileIds`）。 */
  markFileUsed(id: number): void {
    if (id > 0) this.usedFileIds.add(id);
  }

  /** `0x19D` 的查询（引擎 `sub_4181F0`）：该统一文件 id 是否已被打开过。 */
  isFileUsed(id: number): boolean {
    return this.usedFileIds.has(id);
  }

  /**
   * **从 `SAVE.DAT` 恢复「已使用文件」标志**（引擎 `sub_40AEE0` raw 15202-15238 → `sub_404A70`）。
   *
   * 引擎在 `WinMain` 里装载 `SAVE.DAT` 时，把 payload 开头那块整块还原进 FileDB 的标志表 ⇒
   * **鉴赏/解锁进度是跨会话、跨存档的**（不是每个存档槽各自一份）。emulator 由宿主在装载存档后调用。
   */
  setUsedFileIds(ids: Iterable<number>): void {
    this.usedFileIds = new Set<number>();
    for (const id of ids) this.markFileUsed(id);
  }

  /**
   * **配置被脚本改写后的钩子**（宿主注入持久化；VM 只管"配置变了"这件事）。
   *
   * 引擎侧：`SetConfig` 类指令（`0x141`/`0x1B5`/`0x1B9`/`0x2CD`/`0x2E7`/`0x2E8`…）只改内存里的配置表，
   * 真正落盘是引擎在退出时写 `SYS4REG.INI`。emulator 由宿主决定何时/怎么写：
   *  - Electron：`renderer/app/configBoot.ts` → `window.api.saveConfigIni(格式化的 INI)` → 主进程写文件；
   *  - headless（`src/run.ts`）：直接写随工程的那份 `app/amayui-emulator/SYS4REG.INI`；
   *  - **测试/链路工具不注入** ⇒ 不会碰到仓库里的配置文件。
   */
  onConfigChanged?: (cfg: import('../engineConfig.js').EngineConfig) => void;

  /**
   * **脚本 `save-int`/`save-string`（`0x1A2`/`0x1A9`）写表后的钩子** ⇒ 宿主把两张表落盘成 `SAVE.DAT`。
   *
   * 为什么设置界面靠它：选项值不在 `SYS4REG.INI` 里，而是 `INITCONFIG*` 用 `save-int (global a9ce)` 登记、
   * `LOADCONFIG` 用 `load-int (global a9ce)` 读回；引擎把这两张表序列化进 `SAVE.DAT`
   * （`sub_40AAE0` → `sub_438320` → `sub_437480`；装载 `sub_40AEE0` → `sub_438940`）。
   * 详见 `src/save/saveData.ts` 与 `analysis/engine-capabilities.json` 的 `save-data-tables-persistence`。
   */
  onSaveDataChanged?: () => void;

  /** 导出两张持久化表（宿主写 `SAVE.DAT` 用）。 */
  saveDataTables(): import('../save/saveData.js').SaveDataTables {
    return { ints: new Map(this.stringIndexTable), strings: new Map(this.stringTable) };
  }

  /**
   * **游玩秒数**（引擎存档头 +280 的 i32；`tickets/T-0018`）。
   *
   * 引擎把它写进每个存档槽的头里（`0x1A0` 的 `op9` 读它、SAVE 屏显示"プレイ時間"）。
   * E4（本机 47 个真槽）：`SAVE00 = 15899`（2026-05-08）→ `SAVE48 = 148772`（2026-05-31）随存档时间单调递增；
   * 新开的档 `SAVE90 = 1055` ⇒ 它是**累计游玩时长**而不是单调时钟。
   * emulator：由帧驱动按帧增量累加（单帧超过 1 s 的部分不计 —— 调试暂停/长 sleep 不算游玩时间）。
   */
  playSeconds = 0;

  /**
   * 装入 `SAVE.DAT` 里读出的两张表（**覆盖**当前内容）。
   *
   * 装载时机 = 脚本跑之前（引擎在 WinMain 里 `sub_40AEE0`，见 raw 142107）：
   * `SYSTEM4.txt:71` 的 `load-int (global 5)`（"已初始化"标志）随即就能读到 1 ⇒ 走 LOADCONFIG 分支。
   */
  applySaveDataTables(t: import('../save/saveData.js').SaveDataTables): void {
    this.stringIndexTable = new Map(t.ints);
    this.stringTable = new Map(t.strings);
  }

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
   *  0x400 = 动画等待门（0x21C wait）、0x20000000 = sleep(0xC8) 门、0x8000000 = ADV/消息激活、
   *  **0x40 = 阶梯动画调度门（0xD5 `i0d5` 置位，由 `serviceStageLoop` = 引擎 `sub_408F10` 放行）**。
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
   * 见 `./route.ts` 顶部注释。`[258]/[7462]…[7468]/[959]/[960]` 这些**面板字段**的读写统一走
   * 下面的 `panelField`（落在 `engineValues`，对位引擎的 `_this[K]`）⇒ 路由表与 `engineValues`
   * 永远是同一份状态，不会各存一份。
   */
  routes: RoutePanel = new RoutePanel((k, v) => this.panelField(k, v));

  /**
   * **面板字段的读写**（统一入口）：`k` 是**绝对的 `_this` 下标**（`panelA[k - 5494]`
   * 或面板对象之外的那两格 `12956`/`12957`），`v === undefined` ⇒ 读、否则写。
   *
   * `engineValues` 是这些格的**唯一真身**；路由表（`RoutePanel`）与 `0x93`/`0x94`/`0x97`
   * 都经这里读写，避免同一状态存两处（规格 §F.2 的 `panel.ts` 第 ③ 条）。
   *
   * ★做成**箭头函数字段**（不是原型方法）：它会被当作回调传给 `RoutePanel`，
   * 必须与创建它的 Engine 实例绑定（原型方法会被调用方以别的 `this` 调）。
   */
  panelField = (k: number, v?: number): number | undefined => {
    if (v === undefined) return this.engineValues.get(k);
    this.engineValues.set(k, v);
    return undefined;
  };

  /**
   * **最近一次 label 派发的诊断记录**（引擎没有这个字段；纯观测用）。
   *
   * `kind`：`'key'` = 键命中（`sub_403D70`）/ `'click'` = 点击（`sub_404E00`）/
   * `'hover-enter'` / `'hover-leave'` = 悬停两段式（`sub_403E70`）/ `'headless'` = `forceAdvance`。
   * 宿主（renderer session）据此打 `[hover-label]` 诊断行 —— E2E 日志里能直接看到"悬停派发了哪条 label"。
   */
  lastDispatch: { label: number; kind: string } | null = null;

  /**
   * **文本项记录表**（引擎 `Font+3364` 的 72B 记录 vector）。
   *
   * 写入端 `0x1D2`（42760 处）与语音族 `0xC4`/`0x1BD`/`0x2F4`；读取端 `0x1D3`/`0x1D4`/`0x2F3`；
   * 记账开关 `0x1BB`（`i1bb 0` … `i1bb 1` 包住"不要记账"的片段，如语音重播）。
   * 它是「回想/历史（HISTORY）」与「语音重播（REPLAYVOICE）」的数据源，见 `./textItems.ts` 顶部注释。
   */
  textItems = new TextItemTable();

  /**
   * **纹理槽标志对**（引擎 `Scene + 1872 + 20*slot` 与 `Scene + 21872 + 20*slot` 两张镜像表：
   * `0x258` 按 op2 的 bit0/bit1 各写 1/0）。值 = `bit0 | bit1<<1`。
   * 读体：`sub_425D20` raw 33156-33185（`result[468]/[469]` 与 `result[5468]/[5469]` 两处同写）。
   */
  texSlotFlags = new Map<number, number>();

  /**
   * **AGERC 模块状态**（`0x14B`/`0x14C`/`0x14D` 的模型；**不加载任何原生库**）。
   *
   * - `loaded` = 引擎 `Engine+490072`（模块句柄；只可能是 `AGERC.DLL`，文件 id `0x5250`）；
   * - `exports` = `Engine[122519 + slot]`（槽 0..99 → 导出名）；
   * - `nameLenMax` = AGERC 内 `dword_100A9000`（`_SetNameLenMax@20` 写的"名字/注释最多几个全角字"，
   *   初值 18）；消费者是 AGERC 的注释输入对话框（在 DLL 里，emulator 未建模该 UI ⇒ 只记录）。
   */
  agerc: { loaded: boolean; exports: Map<number, string>; nameLenMax: number } = {
    loaded: false,
    exports: new Map<number, string>(),
    nameLenMax: 18,
  };

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

  /**
   * **语义事件调试钩子**（`tickets/T-0114` 第 2 步）：VM 在"改状态"的那一刻**同步**回调它。
   *
   * ★为什么钩子在 `Engine` 上、而不是让 VM 去 `await` 暂停：
   * `stepOnce` 是**同步**的（handler 里没有 await 点），而"停在事件上"需要 `await` 一个 Promise 门。
   * 所以分工是：**VM 只同步记录"刚刚发生了什么"**（调这个钩子），
   * **主循环在 `stepOnce` 之后 `await` 暂停**（见 `frame/loop.ts` 的 `onAfterStepEvent`）。
   * 这样"停在事件上"的语义成立，且不需要把整个 VM 改成异步。
   *
   * ★★**事件名按"池"显式命名，不写笼统的 `global-write`**：
   * `GlobalArrays` 是**按类型分池**的（`int`/`float`/`str` + `ptr`/`floatPtr`/`strPtr`），
   * "写全局"这四个字**不足以**说明写的是哪个池、值是什么类型 —— 条件里 `val == 1` 只在 int 池成立。
   * 所以：
   *   - `global-int-write`（`idx` = 池下标，`val` = **解码后的 int**；含数组型与指针穿写）；
   *   - `global-float-write`（`idx`，`val` = **float 的 int32 位模式**，要用 `f2i` 比整数常量）；
   *   - `global-str-write`（`idx`，`val` = 字符串**长度**，本条件语言无法比字符串，只用来停）；
   *   - `slot-bind`（`slot`、`imgid`；`imgid` 恒非负 —— 未绑定用 `undefined` 表示，不发事件）。
   *
   * 三个**引用池**（`ptr`/`floatPtr`/`strPtr`）发的是"引用变更"，语义与"值变更"不同，
   * **当前不发事件**（要停"谁重绑了引用"需要新事件类型 + 新参数，属后续）。
   */
  debugEvent: ((ev: { kind: DebugEventKind; values: Record<string, number> }) => void) | null = null;

  /** 供 VM 侧调用：有钩子就回调（无钩子时零开销 —— 只是一个 `if`）。 */
  emitDebugEvent(kind: DebugEventKind, values: Record<string, number>): void {
    this.debugEvent?.({ kind, values });
  }

  /** sleep(0xC8) 放行截止(ms)。waitFlags & SLEEP_GATE 期间渲染帧循环每帧 present，到 nowMs>=sleepUntil 才放行（对齐引擎帧让步）。 */
  sleepUntil = 0;

  // ---------------------------------------------------------------------------
  // `0x400` 等待门的真值（`tickets/T-0024`）：`sub_407E20` = 池挂起位 + `0x238` 装载的等待计时器
  // ---------------------------------------------------------------------------
  // 引擎里的四格（`_this` = 图形池/Scene 基址 322832，`_this[K]` 即字节 322832+4K）：
  //   `[11625]` = 现在（= Engine[92333] = timeGetTime）
  //   `[11628]` = 强制冻结/立即收尾（46512，`sub_407EA0` 置 1）
  //   `[11629]` = **池挂起位**（46516，"上一遍绘制时还有元素在动"）
  //   `[11630]`/`[11631]` = 等待计时器 起点/时长（46520/46524 = **Engine[92338]/[92339]**）

  /**
   * 等待计时器起点（`Scene+46520` = `Engine[92338]`）。0 = 未起步（`sub_407E20` raw 12775 会锁存当前时钟）。
   * 装载者 = `0x238`（`sub_4248C0` raw 32303-32312：`Engine[92338] = 0; Engine[92339] = op1`）。
   */
  gateWaitStart = 0;
  /** 等待计时器时长 ms（`Scene+46524` = `Engine[92339]`）。0 = 没装计时器 ⇒ 门只看池挂起位。 */
  gateWaitMs = 0;

  /**
   * **池挂起位**（`Scene+46516`）：引擎每遍绘制开头清零、绘制期"还有元素在动"时置 1
   * （raw 130427-130428 清零；raw 117843-117844 / 133528 / 134944 置位）。
   * ⇒ 语义是"**上一遍绘制**时还有没有东西在动"，由帧驱动在 `advanceModel` 之后锁存（见 `frame/loop.ts`）。
   */
  scenePending = false;

  /**
   * **强制冻结/立即收尾**（`Scene+46512`，`sub_407EA0` raw 12789-12801）：
   * 为 1 时所有动画窗立刻算结束（raw 134941 / 135806 / 136182），且等待计时器到期（raw 12776 `_this[11628] == 1`）。
   * 置位者：① 门被玩家输入跳过（主循环 raw 21135）；② ADV 分支每帧（raw 21161）。
   * 引擎每遍绘制开头清零（raw 130427）⇒ 驱动在锁存池挂起位之后清它。
   */
  sceneFreeze = false;

  /**
   * **`sub_407E20`（raw 12762-12786）**：图形池是否仍"挂着" ⇒ 返回 `true` = 门**不放行**。
   *
   * 逐行等价：
   * ```c
   * if (dur) { if (!start) start = now;                 // 起步（raw 12774-12775）
   *            if (now > start + dur || freeze) { start = 0; dur = 0; }  // 到期（raw 12776-12779）
   *            else return 1; }                          // ★未到点 ⇒ 一律"还在等"（raw 12785）
   * return pending;                                       // 池挂起位（raw 12783）
   * ```
   * ★未建模：raw 12781-12782 的 `_this[11632] & 0x10000`（`Scene+46528`）—— 该格每次绘制清零
   * （raw 130430）且语料/二进制里**没有任何置位点**（`tickets/T-0024` 的 notes §6）。
   */
  gatePending(nowMs: number): boolean {
    if (this.gateWaitMs !== 0) {
      if (this.gateWaitStart === 0) this.gateWaitStart = nowMs; // 起步：起点 ← 现在
      if (nowMs > this.gateWaitStart + this.gateWaitMs || this.sceneFreeze) {
        this.gateWaitStart = 0; // 到期：两格清零（下次不再生效）
        this.gateWaitMs = 0;
      } else {
        return true; // 计时器未到点 ⇒ 不放行
      }
    }
    return this.scenePending;
  }

  /**
   * **主循环 `0x400` 分支的门**（raw 21109-21152）：`true` = 放行（调用方清 `effect_flags & 0x400` 并继续派发）。
   *
   * 引擎：`if (sub_407E20(pool) || v95) { …玩家可跳过…; goto LABEL_186（本帧不派发） } else { effect_flags &= ~0x400; Sleep(0); }`
   * ★未建模的 `v95`：raw 20701 由 Live2D/角色槽的 `sub_4050E0` 置 1（那 1000 个槽 emulator 没有）⇒ 恒 0。
   */
  serviceWaitGate(nowMs: number): boolean {
    return !this.gatePending(nowMs);
  }

  /**
   * **跳过一个 `0x400` 等待门**（`sub_407EA0` raw 12789-12801）：置强制冻结 + 清等待计时器
   * ⇒ 下一遍绘制把所有窗算结束、池挂起位归零 ⇒ 门立刻放行。
   *
   * 调用点：① 玩家在门等待期间按了键/点了鼠标/滚轮（主循环 raw 21113-21135，门控 = `Config("System:EffectSkip…")`）；
   * ② ADV 分支每帧（raw 21161）。
   * ★未建模：raw 12793 的 `(Scene+46528) & 2` 门 —— 该格的**唯一写者是 `0x24E`**
   *   （`sub_4258C0` raw 32965，`T-0167` 读体核实），而语料里的实际取值 `i24e 10001`（= `0x2711`，422 处）
   *   **bit1 = 0** ⇒ 这道 bit1 门在本语料里永不通过（见 `gatePending` 的说明）。
   */
  skipWaitGate(): void {
    this.sceneFreeze = true;
    this.gateWaitStart = 0;
    this.gateWaitMs = 0;
  }

  /**
   * **阶梯动画调度器**（`0xD3`/`0xD4`/`0xD5` 的引擎侧状态；逐行 raw 锚点见 `./stageLoop.ts`）。
   *
   * 引擎里它是散在 `_this` 上的五格 + 一个 `std::vector`（`430668`/`430688`/`430692`/`430672..`），
   * 这里收成一个对象；消费者是下面的 `serviceStageLoop`。
   */
  stage = new StageLoop();

  /**
   * **阶梯动画调度服务**（引擎 `sub_408F10`，raw 13612-13684；主循环 raw 21154-21156 在
   * `effect_flags & 0x40` 时每遍调用它）。
   *
   * 到点 ⇒ 清 `0x40`、把当前帧 `ip` 指向时间表里的 label（并压返回点 = `i0d5` 自身）
   * ⇒ 本帧按常规派发那一段；未到点 ⇒ 返回 `false`，调用方**本帧什么都不派发**（门保持置位）。
   *
   * @param ignoreTime headless/tracer 档：不做时间判定（恒到点）—— 那些入口的时钟粒度可能与
   *                   `0xD4` 的 step 同量级，按真实时间会退化成"每帧一步"甚至不推进。
   */
  serviceStageLoop(nowMs: number, ignoreTime = false): boolean {
    return runStageService(this, nowMs, ignoreTime);
  }

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
    // ★★**滚轮当按键的模式判据**（引擎 WndProc raw 141520-141611 的等价物；`tickets/T-0167`）：
    //   引擎在 WM_MOUSEWHEEL 现场读 `Engine[699204] & 0x90100000` 决定"进掩码位"还是"进增量累加器"，
    //   并把 `1 << Conf(set:WheelKeyUp/Down)` 直接 `|=` 进输入掩码。这里把**同一个活值**的读取做成闭包
    //   （事件发生时求值，不是构造时缓存），四个键位来自 `set:WheelKeyUp/Down`/`HWheelKeyUp/Down`。
    //   ★没有这条，ADV 里所有"滚轮键位"判据（回看/推进/菜单）都恒假 —— 实测用户症状：
    //     "滚轮无法从 ADV 进入历史消息/回看界面"。
    this.input.wheelKeyPolicy = () => {
      const cfg = this.config;
      const bit = (key: string): number => (cfg ? cfgInt(cfg, key, -1) : -1);
      return {
        asKey: (this.effectFlags & 0x90100000) !== 0,
        up: bit(CFG.setWheelKeyUp),
        down: bit(CFG.setWheelKeyDown),
        hUp: bit(CFG.setHWheelKeyUp),
        hDown: bit(CFG.setHWheelKeyDown),
      };
    };
    for (let i = 0; i < 40; i++) this.frames.push(new Frame());
    // ★引擎 `sub_4B8D50`（raw 140825-140836，WM_MOUSEMOVE）：只在**鼠标移动**时做命中测试。
    //   等待泵 / 主循环里**没有** `sub_403C50` ⇒ 不能每帧重算（否则"表重登记后立刻重新命中"
    //   会让悬停反复触发，见规格 §E2）。
    //   ★★命中测试的**门**（raw 140827）：`if ( _this[12958] || _this[12957] )` —— 面板对象基址
    //   `Engine+5494`（dword）⇒ `12958` = panelA`[7464]`（`fillPending`）、`12957` = panelA`[7463]`
    //   （`shown`）。两者皆 0 = 面板关闭期（`i093` 之后、下一次显示之前）⇒ 引擎**不重算游标**。
    //   修前无条件命中测试 ⇒ 关闭期鼠标一移就把游标按新位置重算，`sub_403E70` 的悬停比较基准
    //   与引擎分叉（审计 `0x94` ② `missing-branch`，`tickets/T-0179`）。
    this.input.onCursorMove = (x, y) => {
      const p = this.routes;
      if (p.fillPending === 0 && p.shown === 0) return;
      p.hitTest(x, y);
    };
  }

  curScript(): Frame {
    return this.frames[this.cur]!;
  }

  // ---------------------------------------------------------------------------
  // 帧循环服务（引擎主循环在 effect_flags 各分支里做的事；由宿主每帧调用）
  // ---------------------------------------------------------------------------

  /**
   * **本帧被「取消消息键」早退吃掉**（引擎 `sub_411900` raw 20133-20136 的 `return`）。
   *
   * 只有 `GetConfig("set:CancelMesSkipOnClick") == 2` 时可达：那一帧引擎连 3 槽消息交付（raw 20144-20160）
   * 与「恰好 1 条指令」（raw 20161-20165）都**不做**。帧驱动（`src/frame/loop.ts` 的 adv 分支）据此
   * 跳过本帧那一条 —— 这是「显示态每轮恰好一条指令」在体里**唯一**的例外（`tickets/T-0169` 判据②）。
   * 每次 `serviceAdv()` 开头清零，所以它只对本帧有效。
   */
  advFrameAborted = false;

  /**
   * **ADV 每帧服务**（引擎 `sub_411900` raw 20096-20202 的等价物）。
   *
   * 引擎在 `effect_flags & 0x8000000` 分支里每帧做四件事（raw 行序）：
   *  1. 刷输入掩码：`sub_4780D0(Engine+258, Engine+174802)`（**实时刷**）→ `if (Engine[1415]) mask |= 0x40`
   *     → `sub_477280`（把掩码写回那一格）——raw 20110-20114；
   *  2. 跑「取消消息键」三态机（`Engine[122370]`: 0→1→2，**raw 20115-20143**，见下）；
   *  3. **3 槽消息交付**（raw 20144-20160：门 `!122455 && !122496 && !(mask & 0x40)` ⇒ 清 `0x8000000`
   *     并对 `122505+i`（3 槽）逐个 `sub_4BB840` 后清零）—— emulator 的等价物在**宿主**
   *     （`AudioEngine.voiceDefer` + `tick(nowMs, advActive)` 的 ADV 退出冲刷，见 `0xFA` 的说明）；
   *  4. 之后**派发恰好 1 条**脚本指令（`_this[opcode+168999]`，raw 20161-20165）—— 由调用方执行
   *     （`src/frame/loop.ts` 的 adv 分支，`advFrame: true`）。
   *
   * ## 取消消息键三态机（raw 20115-20143 逐字；极性按体，**不是**审计说的那样）
   * ```c
   * if ( GetConfig("set:CancelMesSkipOnClick") ) {                  // raw 20115（键名 raw 4346 `aSetCancelmessk[25]`）
   *   if ( (*v2 & 0x10) != 0 ) {                                   // 掩码 bit4 = 鼠标左（按下）
   *     v3 = _this[122370] == 1;
   *     *v2 &= ~0x10u;                                             // ★raw 20120：**消费掉这一位**
   *     if ( v3 ) _this[122370] = 2;                                // 1 ⇒ 2（只有 1 才升 2）
   *   } else if ( _this[122370] == 2 ) {                            // 松开且已到 2
   *     _this[122370] = 0;                                          // 2 ⇒ 0
   *     sub_4053C0(_this);                                          // ★raw 20127 = eatAllInput
   *     _this[174801] &= ~0x8000000u;                               // 清 ADV
   *     _this[1415] = 0;  _this[97050] = 0;                         // 跳读镜像 / ReadTextSkip 运行期镜像
   *     SetConfig("message:ReadTextSkip", 0);                       // raw 20132（串 = raw 4277 `aMessageReadtex`）
   *     if ( GetConfig("set:CancelMesSkipOnClick") == 2 ) {         // raw 20133
   *       sub_411560(_this, "CALLBACK_SETTING.BIN");                // raw 20135（本资源树无该文件 ⇒ 空转）
   *       return;                                                   // ★raw 20136：**整帧早退** —— 连 3 槽交付
   *     }                                                           //   与「那一条指令」都不做
   *   } else { _this[122370] = 1; }                                 // ★raw 20141：位为 0 的那一帧走 0 ⇒ 1
   * }
   * ```
   * ⇒ **极性**：`0→1` 发生在**该位为 0** 的那一帧（`else` 分支）、按下只驱动 `1→2`、`2→0` 那一帧才
   * 清 ADV 并复位 ReadTextSkip。`2026-09` 的审计 finding（`T-0161` §5 row 14 的 `overreach`）说这条
   * 极性在 emulator 里是错的 —— **按体不成立**（本实现的三个分支与 raw 20115-20143 逐个同形）；
   * 真缺的是 raw 20120 的位消费、raw 20127 的 `eatAllInput` 与 raw 20133-20136 的 `== 2` 早退，
   * 本票（`T-0169`）已补齐（见上面 `advFrameAborted` 与下面的实现）。
   *
   * 返回 `true` = 本帧应派发 1 条指令（等价于引擎该分支的行为）。
   */
  serviceAdv(): boolean {
    const im = this.input;
    const m = this.msgwin;
    this.advFrameAborted = false;
    // ★ADV 分支用**实时刷**（引擎 sub_411900 raw 20111 的 `sub_4780D0`）：含鼠标左右键的**按住态**
    //   （set:CancelMesSkipOnClick 三态机就靠它判「已松开」）。**不要**换成 flushPending（T-0027）。
    const mask = im.flushHeld();
    const skipBit = m.skipMirror !== 0;

    // 取消消息键三态机（引擎门控：GetConfig("set:CancelMesSkipOnClick")，raw 20115）
    if (this.config && cfgInt(this.config, CFG.setCancelMesSkipOnClick, 0) !== 0) {
      const bit = 0x10; // 掩码 bit4 = 鼠标左键
      if ((mask & bit) !== 0) {
        const was1 = m.cancelStage === 1;
        // ★raw 20120 `*v2 &= ~0x10u`：按下那一帧就把这一位从**掩码格**（= `input.inputMask`）里拿掉。
        im.inputMask = (im.inputMask & ~bit) | 0;
        if (was1) m.cancelStage = 2;
      } else if (m.cancelStage === 2) {
        m.cancelStage = 0;
        // ★raw 20127 `sub_4053C0(_this)` = 把这次输入整份吃掉（刷掩码 + 按钮保持位 + 掩码清 0）。
        this.eatAllInput();
        this.effectFlags &= ~ADV_ACTIVE;
        m.skipMirror = 0; // `Engine[1415] = 0`
        m.skipMode = 0;
        m.readTextSkip = 0; // `Engine[97050] = 0`（= SetConfig("message:ReadTextSkip", 0)，raw 20132）
        // ★raw 20133-20136：键值 **== 2** 时引擎整帧 `return` —— 3 槽交付（raw 20144-20160）与
        //   「恰好 1 条指令」（raw 20161-20165）**都不做**。emulator 用 `advFrameAborted` 把这件事
        //   交给帧驱动（`src/frame/loop.ts` 的 adv 分支据此跳过本帧的那一条）。
        if (cfgInt(this.config, CFG.setCancelMesSkipOnClick, 0) === 2) {
          this.advFrameAborted = true;
          return false;
        }
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
   * **逐字显现期间的「推进输入」出口**（引擎 `sub_409400` 的第二半，raw 13931-13946）——
   * 逐字还没显完时点击 ⇒ **立刻把整页贴完**（`do sub_45BE20(...) while (!done)` 自旋到完成），
   * 并且**不推进页面**（不清 bit31、不派发 label）。
   *
   * 逐行依据（`sub_409400` 走到"没有任何窗还挂着"之后的 else 分支）：
   * ```c
   * else {
   *   *v6 = 0; sub_478090(Engine+1032, Engine+699208);        // ★消费刷（只吃挂起事件）
   *   if ( (*(_BYTE *)v6 & 0x10) != 0                        // ★**左键**（掩码 bit4；不是等待泵的 0x50）
   *     || (Conf(message:AdvanceMesOnWheel) & 1) != 0
   *        && ((1 << Conf(set:WheelKeyDown)) & *v6) != 0
   *     || (v8 = Engine[7796], Engine[7796] = 0, v8 < 0) )   // 滚轮累加器读后清、<0 = 下滚
   *   { clear 0x20000000; Engine[388212] = 1; *v6 = 0;
   *     do result = sub_45BE20(Font, Engine[489484]); while (!result); }   // ★自旋到整页贴完
   *   else { Sleep(MessageSpeed) / 定时器; sub_45BE20(...); }
   * }
   * ```
   * ★三条与 emulator 有关的取舍：
   *  1. **只吃左键**（`0x10`）：右键在逐字期间什么都不做（等待泵才是 `0x50` = 左右都算）；
   *  2. **不动 bit30**：引擎这里用的是普通泵 `sub_45BE20`（不是 `sub_45A940(..., -2, 0)`）
   *     ⇒ ▼ 图标继续闪；所以这里**不**用 `finishCharReveal()`（那会清 bit30）；
   *  3. `Engine[388212] = 1` 与下一次调用的"顺带把等待门计时器清零 + 置强制冻结"（raw 13910-13915，
   *     条件 `Engine[667856] == 1` = `set:DrawMode`）⇒ emulator 用 `skipWaitGate()` 等价实现；
   *     随包 INI 里 `DrawMode=0`（实测），所以本机这条通常不触发。
   *
   * @returns `true` = 本次点击被"贴完整页"消费掉了（调用方本帧不要再当推进处理）。
   */
  serviceRevealAdvanceInput(): boolean {
    if (!this.msgwin.isRevealing()) return false;
    const im = this.input;
    const mask = im.flushPending(); // 引擎 sub_478090（消费刷）
    const wheelDown = im.consumeWheelDelta() < 0; // 引擎 Engine[7796] 读后清、<0 = 下滚
    const wheelCfg = this.config;
    const wheelKeyBit = wheelCfg ? cfgInt(wheelCfg, CFG.setWheelKeyDown, -1) : -1;
    const wheelKeyHit =
      wheelCfg !== null &&
      wheelKeyBit >= 0 &&
      wheelKeyBit < 32 &&
      (mask & (1 << wheelKeyBit)) !== 0 &&
      (cfgInt(wheelCfg, CFG.messageAdvanceMesOnWheel, 0) & 1) !== 0;
    if ((mask & 0x10) === 0 && !wheelKeyHit && !wheelDown) return false;

    // ★自旋到整页贴完（`do sub_45BE20 while (!done)` 的等价物）：**只贴当前窗**。
    //   引擎 raw 13943-13945：`do result = sub_45BE20(_this + 85296, *(_DWORD *)(_this + 489484)); while (!result);`
    //   （`489484/4 = 122371` = 当前窗，由 `0x6E`/`0x71`/`0x72` 写：raw 28365/28381/28545）
    //   ⇒ 引擎**只**把当前窗贴满，不碰别的窗。
    //   ★修前这里遍历 `msgwin.reveal` 的**所有**键逐个发布 ⇒ 上一屏残留的窗会被重新贴回屏
    //   （用户实测 `tickets/T-0100`：进 `SC0000` 后点一下 ⇒ 屏中央冒出序章 `SN0000` 的最后一页）。
    //   窗的 `reveal` 条目**允许**残留（引擎同样保留 `win+132` 游标，`exit` 边界也不 reset），
    //   但**不得被发布**。注意**不清 bit30**（▼ 继续闪），所以不走 `finishCharReveal()`。
    const cur = this.msgwin.resolveWin(this.msgwin.lastArg);
    this.msgwin.finishReveal(cur);
    this.#publishReveal(cur);
    // ★raw 13941 `Engine[388212] = 1`（= `_this[97053]`）：**跨帧闩锁** —— 「上一次的点击已经把这一页
    //   贴完了，但泵可能又被武装（`0x196` 在一句中间续写文本 ⇒ 置 `0x20000000`，而 `0x6E` **不**清这一格）
    //   ⇒ 下一次泵调用见它就走 raw 13917-13930 的 `else if (Engine[388212])` 支：清 `0x20000000` +
    //   **再自旋贴完当前窗**（不动 bit31、不动 bit30）。见下面 `serviceTextReveal` 的读取端。
    //   （清零点 = `0x72` 的 raw 28557、整体复位 raw 17973、构造 raw 22604 —— 见常量说明。）
    this.engineValues.set(FIELD_REVEAL_INPUT_CONSUMED, 1);
    im.consumeEdges(); // 引擎 `*v6 = 0`：这次点击不再留给等待泵（否则下一帧会顺带推进一页）
    // 引擎 raw 13910-13915：DrawMode == 1 时顺带把等待门计时器清零 + 置强制冻结
    // （`Scene+369360 & 2` 那一格全工程无置位点，恒为 0 ⇒ 条件只剩 DrawMode）。
    if (this.config && cfgInt(this.config, CFG.setDrawMode, 0) === 1) this.skipWaitGate();
    return true;
  }

  /**
   * **逐字显现服务**（引擎 `sub_409400` raw 13780-13970 的等价物）。
   *
   * 引擎：每帧对每个"正在显示"的窗调一次 `sub_45BE20(font, win)`（推进一步），
   * 在 GDI 路径下用 `Sleep(Engine+86672 = message:MessageSpeed)` 控制节拍。
   * 重写侧：`MsgWindow.tickReveal` 按毫秒推进游标，并把**有变化的窗**重新发布给宿主
   * （宿主只画前 N 个字形）。
   *
   * 返回 `true` = 仍有窗在显现中（调用方应把它当作"这一页还没显示完"）。
   */
  serviceTextReveal(nowMs: number): boolean {
    const speed = messageSpeedOf(this);
    // ★★**`Engine[388212]` 闩锁支**（引擎 `sub_409400` raw 13917-13930，`tickets/T-0169` 补齐；
    //   此前的登记见 `analysis/engine-capabilities.json` 的 `frame-render-gate-mainloop` note ③）：
    //   ```c
    //   else if ( *(_DWORD *)(_this + 388212) )        // 上一帧的"贴完整页"出口留下的闩锁
    //   { *(_DWORD *)(_this + 699204) &= ~0x20000000u; // 清"逐字泵在跑"位
    //     while ( !sub_45BE20(_this + 85296, *(_DWORD *)(_this + 489484)) ) ;   // ★再自旋贴完当前窗
    //     result = 1;
    //     if ( *(_DWORD *)(_this + 667856) == 1 && (*(_BYTE *)(_this + 369360) & 2) == 0 )
    //       { *(_DWORD *)(_this + 369344) = 1; result = 0;                       // = skipWaitGate()
    //         *(_DWORD *)(_this + 369352) = 0; *(_DWORD *)(_this + 369356) = 0; } }
    //   ```
    //   `result` 只被 raw 21178 的调用点**丢弃**（主循环不看返回值）⇒ 两支的差别在 emulator 侧不可观测，
    //   这里只落**会改状态的那两件**：清闩锁 + 一次把当前窗贴完（`finishReveal` 等价自旋）。
    //   ★次序：这一支在闸门窗循环（raw 13835-13888）**之后**、输入分支（raw 13931 起）**之前**
    //   ⇒ 与 `serviceWinReveal` 的相对次序由调用方保证（帧驱动先 `serviceWinReveal`）。
    if ((this.engineValues.get(FIELD_REVEAL_INPUT_CONSUMED) ?? 0) !== 0) {
      this.engineValues.set(FIELD_REVEAL_INPUT_CONSUMED, 0); // raw 13919 的前置：只走一次
      const w = this.msgwin.resolveWin(this.msgwin.lastArg);
      this.msgwin.finishReveal(w); // raw 13920 的 `while (!sub_45BE20(...))` 自旋
      this.#publishReveal(w);
      this.msgwin.showing = 0;
      // raw 13923：`set:DrawMode == 1`（且 `Scene+369360` bit1 == 0，该位全工程无置位点）⇒
      // 置强制冻结 + 清等待计时器（= `skipWaitGate`）；随包 INI `DrawMode=0` ⇒ 本机通常不触发。
      if (this.config && cfgInt(this.config, CFG.setDrawMode, 0) === 1) this.skipWaitGate();
      return this.msgwin.isRevealing();
    }
    // ★引擎每帧只泵**当前窗**（ADV 支：raw 13907/13920/13944/13962 都只把 `Engine[122371]` 交给
    //   `sub_45BE20`；`0x300` 闸门窗由 `serviceWinReveal` 那条支路单独负责，raw 13834-13888）
    //   ⇒ 只推进/发布当前窗。修前 `tickReveal` 会推进并发布**所有** `reveal` 条目（含上一屏残留）
    //   ⇒ 与 `tickets/T-0100` 同一类缺陷。
    const cur = this.msgwin.resolveWin(this.msgwin.lastArg);
    const dirty = this.msgwin.tickRevealWin(cur, nowMs, speed) ? [cur] : [];
    // ★★**这一行不能少**（轮 8 实测踩过）：推进了游标就必须把它发布给宿主，否则**逐字看不见**
    //   —— 游标在 VM 里照常走（`0x6E` 后约 `max(MessageSpeed, 一帧)`/字），但宿主只在
    //   `msgWinSync` 时才重绘 ⇒ 屏上一直停在第 0 个字，直到别的路径（点击/收尾）发布一次
    //   ⇒ 用户实测「必须等逐字完成后才直接展示出来」。E4 判据 = `[reveal] win=N 0/X` 之后
    //   直接跳 `X/X`、中间态一个都没有（`textLayer.ts:104` 只在 revealed 变化时打印）。
    for (const win of dirty) this.#publishReveal(win);
    if (dirty.length > 0) {
      this.msgwin.showing = this.msgwin.isRevealing() ? 1 : 0;
      // ★引擎每帧只做两件事（raw 20892-20893）：贴出第 k 个字格 → `Engine[107704] = (k+1) % Engine[107705]`。
      //   模数槽由 `0x72` 的 `-1` 查询写入（= 字格数 `win+92`）；字格未设时（=0）退化为单调递增。
      if (this.msgwin.charMode) {
        const t = this.msgwin.charTotal;
        this.msgwin.charCursor = t > 0 ? (this.msgwin.charCursor + 1) % t : this.msgwin.charCursor + 1;
        this.engineValues.set(FIELD_CHAR_CURSOR, this.msgwin.charCursor);
      }
    }
    const more = this.msgwin.isRevealing();
    // ★文字显现完了**不等于** ▼ 图标停：bit30（effect_flags & 0x40000000）由点击推进
    //   （raw 20028-20030）或 0x1CE 0（raw 29344-29348）清 —— 这里只收掉"文字在逐字"这个标志，
    //   否则玩家点击前的那段等待时间（正是 ▼ 该闪的时候）图标会被提前停掉。
    if (this.msgwin.charMode && !more) this.msgwin.charMode = false;
    return more;
  }

  /**
   * **字格图标动画服务**（引擎主循环 raw 20887-20895）：
   * `if (effect_flags & 0x40000000) { if (sub_453AF0(Engine+430600) >= 0) { sub_45A940(Font, 当前窗, k, 0);
   *  k = (k+1) % 模数; } }`
   *
   * ★`0x73` 的真相（2026-09 订正，见 `CharGrid` 的说明）：它配的是**一张图标精灵表的网格**
   * （ADV = `SO000.AGF`(0x5191) 10 帧 35×35 的 ▼ 装进槽 12；序章/NOVEL = `SO026.AGF`(0x5190)
   * 8 帧 56×56），**不是文字逐字的单位** —— 文字是 `sub_45BE20` 那个泵（见 `serviceTextReveal`）。
   * 本服务每 `tickMs` 换一格并重新发布该窗（宿主据此把第 k 格画到屏幕上）。
   * 返回 true = 本帧换了格。
   */
  serviceCharGrid(nowMs: number): boolean {
    if ((this.effectFlags & CHAR_REVEAL_ACTIVE) === 0) return false;
    const m = this.msgwin;
    const w = m.resolveWin(m.lastArg);
    const g = m.gridOf(w);
    if (!g || !g.gate || g.cells <= 0) return false;
    // ★图标要等**本页逐字显完**才出现（引擎：文字泵自旋 `sub_409400`，跑完才轮到主循环的图标分支
    //   raw 20887-20895）。判"**任何**窗还在显现"而不是只判当前窗：引擎的图标游标 `Engine[107704]`
    //   是**全局一份**；只判当前窗时，若 `lastArg` 解析到别的窗就会在文字还没显完时把 ▼ 画出来
    //   （2026-09 实测：`[reveal] 47/58` 时 ▼ 已在屏上）。
    if (m.isRevealing()) return false;
    const tick = g.tickMs > 0 ? g.tickMs : 1;
    if (m.cellNextAt === 0) {
      // 文字刚显完 ⇒ 从这里起算第一拍（引擎 `sub_453A90` 重启计时器，首格等满一个 period）
      m.cellNextAt = nowMs + tick;
      return false;
    }
    if (nowMs < m.cellNextAt) return false;
    // 引擎 raw 20892-20893：**先贴当前格 k、再 `k = (k+1) % 模数`**
    // ⇒ 第 1 格在 `t0 + tick` 出现（t0..t0+tick 之间屏上还是 `-1` 查询捕获的背景）。
    emitWin(this, w);
    m.cellK = (m.cellK + 1) % g.cells;
    m.cellNextAt = nowMs + tick;
    // `Engine[107704]` = 下一个格号（与引擎同步给脚本可读的字段一致）
    this.engineValues.set(FIELD_CHAR_CURSOR, m.cellK);
    return true;
  }

  /**
   * 把一个窗的显现进度发布给宿主（`MsgWinInput.revealed`）。
   *
   * ★载荷与 `handlers/msgwin.ts` 的 `emitWin` **逐字相同** ⇒ 直接复用，避免两处漂移
   * （历史：两处各写一遍，`resolveWin` 的有无都不同）。
   */
  #publishReveal(win: number): void {
    emitWin(this, win);
  }

  /**
   * **每窗「逐行贴出」闸门泵**（引擎 `sub_409400` 的第一个窗口循环，raw 13838-13888）。
   *
   * 这条不是"逐字"，而是**消息窗的循环演示**：`0x300 <win> <flags> <ms>` 把闸门位（bit0）与
   * 延时 `ms` 写进该窗槽后，引擎每帧：
   *  1. 从 `win+132`（当前行游标）贴出一行（节拍 = `message:MessageSpeed` 的计时器）；
   *  2. 全部贴完后记下完成时刻；
   *  3. 过 `ms` 毫秒后 `sub_404F80` 清绘制项并把 `win+132` 归零 —— **闸门位仍为 1**；
   *  4. 于是下一帧又从第一行贴出 ⇒ **贴出 → 停留 → 消失 → 再贴出，无限循环**。
   *
   * `CONFIG.txt:171 i300 9 1 3e8`（设置界面的消息显示预览）就是它：每 1 秒重演一遍。
   * ★与逐字模式不同，**脚本在同一帧照常推进**（raw 21179 `goto LABEL_215` 仍派发 1 条指令），
   * 所以 `isRevealing()` 把闸门窗排除在外（否则 CONFIG 屏会被挂起）。
   *
   * @returns 是否仍有闸门窗在贴出（= 引擎 `Engine[489860] == 1`）
   */
  serviceWinReveal(nowMs: number): boolean {
    const speed = messageSpeedOf(this);
    let active = false;
    for (const [win, g] of this.msgwin.gates) {
      if (!g.enabled) {
        // 关闸（`i300 win 0 0`）：把余下的行排空 + 清接管位/延时/完成时刻（raw 13845-13854）
        if (!g.pumping) continue;
        this.msgwin.finishReveal(win);
        g.pumping = false;
        g.autoHideMs = 0;
        g.doneAt = 0;
        // 引擎 `*v3 = 0`：连 bit16 一起清掉（字段即事实）
        this.engineValues.set(FIELD_WIN_REVEAL_GATE + win, 0);
        this.#publishReveal(win);
        continue;
      }
      active = true;
      g.pumping = true;
      // 引擎 `*v3 = result | 0x10000`：把"已被泵接管"写回字段（0x300 的 handler 会保留它）
      this.engineValues.set(FIELD_WIN_REVEAL_GATE + win, (this.engineValues.get(FIELD_WIN_REVEAL_GATE + win) ?? 0) | 0x10000);
      const laid = layoutWindow(win, {
        style: winStyle(this, win),
        segments: this.msgwin.slot(win).segments,
      });
      const total = laid.glyphCount;
      if (total <= 0) continue;
      if (speed <= 0) {
        // `MessageSpeed == 0` ⇒ 一次排空（raw 13878-13883）
        const st = this.msgwin.reveal.get(win);
        if (!st || st.shown < st.total) {
          this.msgwin.beginReveal(win, total, nowMs, 0);
          this.#publishReveal(win);
        }
        continue;
      }
      let st = this.msgwin.reveal.get(win);
      if (!st || st.total !== total) {
        // 首次（或文本变化）：引擎从 `win+132`（清场后为 0）开始逐行贴出。
        // 时长 = 行数 × max(MessageSpeed, 一帧)（引擎一步 = 一行 + Sleep(MessageSpeed)）。
        this.msgwin.beginReveal(win, total, nowMs, speed);
        this.#publishReveal(win);
        continue;
      }
      if (this.msgwin.tickRevealWin(win, nowMs, speed)) this.#publishReveal(win);
      if (st.active || st.shown < st.total) continue;
      // 全部贴完（引擎 `sub_45BE20` 返回真）
      if (g.doneAt === null) {
        g.doneAt = nowMs; // LABEL_16：记完成时刻
      } else if (nowMs - g.doneAt >= g.autoHideMs) {
        g.doneAt = null; // 引擎 `v3[20] = 0`
        this.native.msgWinClear?.(win); // `sub_404F80`：删绘制项（画面上的字消失）
        // ★`win+132 = 0` ⇒ 下一帧从头再贴一遍（循环演示的关键）
        this.msgwin.beginReveal(win, total, nowMs, speed);
        this.#publishReveal(win);
      }
    }
    return active;
  }

  /**
   * **主循环的 `0x4000000` 臂**（引擎 raw 20859-20881；`tickets/T-0175` ⑬ 的第 2 条主循环写者，
   * `tickets/T-0169` 落地）——「**重显示（回看）模式下玩家一有输入 ⇒ 退出重显示、回到备用游标**」。
   *
   * ```c
   * v25 = _this[174801];                                    // 20859
   * if ( (v25 & 0x4000000) == 0 ) break;                    // 20860：不在重显示模式 ⇒ 本臂不跑
   * sub_478090(_this + 1032, _this + 699208);               // 20862：★**消费刷**（吸挂起事件）
   * if ( *(_DWORD *)(_this + 699208) )                      // 20863：这一帧真的收到了输入
   * { *(_DWORD *)(_this + 699208) = 0;                      // 20865：掩码格清零
   *   _this[174801] &= ~0x4000000u;                         // 20866：退出重显示模式
   *   v26 = _this[95776];                                   // 20867：当前帧号
   *   if ( *(_DWORD *)(_this + 4 * v26 + 489648) != -1 )    // 20868：★**备用**回退游标（`122412+cur`，`0x7B` 的 op2）
   *   { v27 = _this[174801] | 0x2000000;                    // 20870
   *     _this[174801] = v27;  _this[489808] = v27;          // 20871-20872：模式字 = flags | 0x2000000
   *     _this[174801] = 0;                                  // 20873：清整个 effect_flags
   *     _this[489812] = sub_4051E0(_this, v26);             // 20874：= (ip − ip_base) >> 2 = **当前 dword 偏移**
   *     _this[430712] = frame[95796];                        // 20876：★脚本身份（与 0x199/右键取消同一格）
   *     frame[95782] = frame[95781] + 4 * alt;              // 20877：★ip 改写到备用游标
   *     frame[95805] = 0; } }                                // 20878：步长槽归零（本臂不改写 ip 之外的推进）
   * ```
   *
   * ## 与另两条「退出重显示」写者的分工（三格 = `redisplayMode` / `redisplayReturn` / `redisplayScriptId`）
   * | 写者 | 位置 | 游标 | emulator |
   * |---|---|---|---|
   * | raw 13997-14008 | `sub_409700`（主循环 `0x10000000` 臂） | **主**（`122372+cur`） | **未落**：`0x10000000` 的唯二置位端是 `0x8E`/`0x95`（panelB，语料 **0** 处）⇒ 该臂在语料上不可达，属已登记的 panelB 缺口（`handlers/panel.ts`） |
   * | raw 20365-20374 | `sub_411BC0`（等待泵右键） | **主**（`489488+4*cur` ≡ `122372+cur`） | `#cancelRoute()`（已落；★它的**取值来源**是 emulator 的 `input.mouseJump`，而体里读的是 `rewindMainBase[cur]` —— 口径差已写进 `tickets/T-0169/changes-reveal.md` 的「别人该接」） |
   * | raw 20859-20881 | 主循环 `0x4000000` 臂 | **备用**（`122412+cur`） | **本函数**（`T-0169` 落） |
   *
   * ★三处写的都是**同一批引擎格**，所以 `0x7C`（`local-ret`）对三条路天然成立（它只认
   * `mode & 0x2000000` + `redisplayScriptId` 的深度校验 + `redisplayReturn` 的落点）。
   * ★`frame[95805] = 0`（raw 20878）在 emulator 侧**没有对应物**：那格是「下一条指令的步长」，
   * 而 emulator 的每条 handler 自己写自己的 arity ⇒ 无事可做（如实登记，不编一个写点）。
   *
   * @returns `true` = 本帧消费了一次输入并退出了重显示模式（含"备用游标为 -1 / 表项不是指令边界"
   *          这两种只清门不改 ip 的情形 —— 引擎在 raw 20865-20866 就已经改了状态）；`false` = 本臂没跑。
   *          调用点 = `src/frame/loop.ts` 的帧首（引擎里这一臂在逐字/字格泵**之前**）。
   */
  serviceRedisplayExit(): boolean {
    if ((this.effectFlags & REDISPLAY_MODE) === 0) return false; // raw 20860
    const im = this.input;
    const mask = im.flushPending(); // raw 20862 `sub_478090`（消费刷：只吃挂起事件）
    im.consumeEdges(); // ★消费刷的语义（读后即清；引擎那一份由 sub_478090 吸走）
    if (mask === 0) return false; // raw 20863
    im.inputMask = 0; // raw 20865 `_this[699208] = 0`
    this.effectFlags = (this.effectFlags & ~REDISPLAY_MODE) | 0; // raw 20866
    const f = this.curScript();
    const alt = this.engineValues.get(ENGINE_FIELD.rewindAltBase + this.cur) ?? -1;
    if (alt === -1 || alt === 0xffffffff) return false; // raw 20868（★它**只**挡 ip 改写；门上一步已清）
    const saved = this.effectFlags;
    this.engineValues.set(ENGINE_FIELD.redisplayMode, (saved | 0x2000000) | 0); // raw 20870-20872
    this.effectFlags = 0; // raw 20873
    const atIp = f.script?.instructions[f.ip];
    const curIdx = f.curDwordOffset >= 0 ? f.curDwordOffset : (atIp?.index ?? 0);
    this.engineValues.set(ENGINE_FIELD.redisplayReturn, curIdx); // raw 20874（`sub_4051E0` = (ip-ip_base)>>2）
    this.engineValues.set(ENGINE_FIELD.redisplayScriptId, f.scriptId); // raw 20876（= `frame[95796]`）
    const target = f.script?.dwordToInstr?.[alt];
    if (target === undefined) {
      // ★已知口径差（与 `#cancelRoute` 同一口径）：引擎 raw 20877 是**无条件** `ip = ip_base + 4*alt`，
      //   表项不是指令边界时就野跳（真机跑飞）。emulator 的 ip 是指令下标、没有地址可野跳 ⇒
      //   只改上面三格与门，不动控制流，并把这件事记在 `lastDispatch` 里（不编一个目标）。
      this.lastDispatch = { label: alt, kind: 'redisplay-exit-miss' };
      return true;
    }
    f.ip = target; // raw 20877
    this.lastDispatch = { label: alt, kind: 'redisplay-exit' };
    return true;
  }

  /**
   * 逐字显现收尾：把该窗余下的字全部贴出并退出逐字模式。
   *
   * 引擎对应动作（raw 20025-20030 点击推进 / raw 29344-29349 `0x1CE 0`）：
   * `if (!(effect_flags & 0x100000)) sub_45A940(Font, 窗, -2, 0);` → `effect_flags &= ~0x40000000`
   * （`-2` 分支把整段文本一次性 blit 出去，见 `sub_45A940` raw 71435-71471）。
   */
  endCharReveal(): void {
    this.msgwin.charMode = false;
    const wasArmed = (this.effectFlags & CHAR_REVEAL_ACTIVE) !== 0;
    this.effectFlags &= ~CHAR_REVEAL_ACTIVE;
    // 停 ▼ 图标（引擎收尾 = sub_45A940(..., -2, 0)：整段贴出并清 bit30，图标不再换格）。
    // 重新发布一次 ⇒ 主机端从这一帧起不再带 cell（否则最后一格会一直留在画面上）。
    if (wasArmed) emitWin(this, this.msgwin.resolveWin(this.msgwin.lastArg));
  }

  /** 是否有窗还在逐字显现（引擎 `effect_flags & 0x40000000` 的等价判定）。 */
  get textRevealing(): boolean {
    return this.msgwin.isRevealing();
  }

  /**
   * **脚本身份守卫**（引擎 `sub_4083B0` raw 13112-13131）。
   *
   * ```
   * result = Engine[12955];                                  // = panelA[7461] = 注册那张表时的脚本身份
   * if (result != frames[cur][95796]) {                      // 与当前帧的脚本身份不同
   *     sprintf(buf, "Depth が不正です %s != %s", cur, owner);
   *     throw Command_ShowMessage;                           // ★不是静默跳过
   * }
   * ```
   * **所有 label 派发点都先调它**（等待泵 20245/20289/20327/20451、主循环 20179/20194、
   * `sub_4098E0` 14087/14097、`sub_411590` 20007）。一句话：**不许跨脚本派发 label**。
   *
   * 为什么必须有：路由表里的 label 是「在脚本 A 里登记时的 dword 偏移」，而 `labelPos` 是
   * **在当前脚本**的 labelMap 里按裸值查表 ⇒ 一个过期目标会在另一个脚本里**静默命中一条无关指令**。
   *
   * @param ownerScriptId 注册那一刻的脚本身份（路由表 = `routes.ownerScriptId`；
   *        `0xCD` = `input.mouseJumpOwner`）。-1 = 从未注册过（引擎初值），不比。
   */
  guardScriptIdentity(ownerScriptId: number): void {
    if (ownerScriptId === -1) return; // 未注册：调用点自己有 -1 的前置判断（引擎 raw 25852/20272）
    const cur = this.curScript().scriptId;
    if (ownerScriptId !== cur) {
      throw new Error(
        `Depth が不正です ${cur} != ${ownerScriptId}` +
          `（跨脚本派发 label：热点/回调注册于脚本 id ${ownerScriptId}，当前 ${cur} ${this.curScript().name}）`,
      );
    }
  }

  /**
   * **把 label 当"带返回点的子程序"派发**（引擎 `sub_405360` raw 11030-11041 + `ip = base + 4*label`）。
   *
   * 引擎：
   * ```
   * retstack[cur][depth] = a2 + ((ip - ip_base) >> 2);   // 存 **dword 偏移**
   * ++depth;
   * ```
   * 调用方给的 `a2` 是**字面 dword 偏移**，不是"退几条指令"：
   *  - 等待泵 / 主循环 / 悬停 / 交互回调：`a2 = -3`；
   *  - `sub_4098E0`（面板显示态 `0x800000`）：`a2 = 0`；
   *  - `0xCD`（get-input-type）：`a2 = +1`。
   *
   * ★`-3` 为什么正好回到门指令：设置等待门的是 `wait-for-input`(0x72)，它 **3 dword** 长
   * （`sub_41EEF0` raw 28484 `step = 3`）且执行完 `ip += 4*step` ⇒ 泵运行时
   * `(ip - ip_base) >> 2 - 3` = **那条门指令的起点**。于是 label 末尾的 `ret`
   * （`sub_41A9B0` raw 25704-25727）弹回门指令并**重跑它**：页已显示完 ⇒ 再挂起（页不推进）。
   *
   * emulator 的 `frame.ip` 是**指令数组下标**（每条指令 +1，不随 dword 长度变），所以要把
   * 「上一条指令的 dword 起点」换算过来：上一条起点 = `ip - 1 + (3 - dw_prev)`，
   * 再由 `a2` 调整。`dw_prev = 1 + 2*arity`。
   *
   * @returns 派发成功（label 在 labelMap 里）；
   *          label 是 -1/0xFFFFFFFF（引擎里表示"无目标"）时**不动 ip**、也不压返回点，返回 false。
   */
  dispatchWithReturn(label: number, offsetDwords: number): boolean {
    if (label === -1 || label === 0xffffffff) return false;
    const f = this.curScript();
    const p = f.labelMap.get(label);
    if (p === undefined) {
      throw new Error(
        `label 0x${(label >>> 0).toString(16)} 不在 ${f.name || '(frame ' + this.cur + ')'} 的 labelMap 里` +
          `（脚本 id ${f.scriptId}）—— 引擎里这是一次非法跳转`,
      );
    }
    // 返回点 = `(ip - ip_base) >> 2 + offsetDwords`，其中 `(ip-ip_base)>>2` 是**调用点之后**的
    //   dword 偏移（引擎里调用方已经 `ip += 4*step`；`sub_405360` raw 11035-11037 读的就是推进后的 ip）。
    //   于是 `offsetDwords = -3` 且调用点是 3 dword 长的 `wait-for-input` 时，返回点正好 = 门指令的
    //   dword 偏移（页已显示完 ⇒ `ret` 回去重跑门指令 ⇒ 再挂起）。
    //   下一条指令的 dword 偏移：优先取「当前 ip 那条指令」（正常路径 `stepOnce` 已把 ip 推进到调用点
    //   之后）；手搓 `makeCtx`（ip 没推进）时退回 `curDwordOffset` 那条 + 它的长度（`1 + 2*argc`）。
    const atIp = f.script?.instructions[f.ip];
    const curIdx = f.curDwordOffset >= 0 ? f.curDwordOffset : (atIp?.index ?? 0);
    const at = f.script?.dwordToInstr?.[curIdx];
    const cur = at !== undefined ? f.script!.instructions[at] : undefined;
    const nextDword = atIp ? atIp.index : cur ? curIdx + (1 + 2 * cur.argc) : curIdx + 3;
    f.retStack.push(nextDword + offsetDwords);
    f.ip = p;
    return true;
  }

  /**
   * **等待推进泵**（引擎 `sub_411BC0` raw 20206-20461 的等价物）——`effect_flags` bit31 置位时每帧跑。
   *
   * 逐帧顺序（**与 raw 的行序一致**）：
   * ```
   * mask = input.flushPending()                           // ★sub_478090 (20238)：**消费挂起事件**
   * if (!panel.shown) return false                         // Engine[51828] != 0 (20239)
   * ① 键命中：l = panel.pickByKey(mask)                    // sub_403D70 (20242) ★第一优先出口
   *    l != -1 ⇒ guard(owner)                               // sub_4083B0 (20245)
   *              if (!Conf(set:ControlDisibleCursor)) finishCharReveal()   // sub_4051A0 (20246-20247)
   *              eatAllInput()                             // sub_4053C0 (20248)
   *              clear bit31 (20250)
   *              dispatch(label, -3)                       // 压返回点 -3 → ip = labelC (20251-20258)
   *              cursor = -1; enterPending = 0             // LABEL_68 (20456-20457)
   * ② 推进输入 (mask & 0x50) 或 滚轮键：                    // 20262-20267
   *    clear bit31 (20276)
   *    if (mask & 0x10 && panel.shown && 0 <= cursor < count)   // 20284-20288（鼠标左键）
   *        guard(owner); dispatch(labelC of cursor, -3); cursor = -1; enterPending = 0   // 20289-20292
   *    else messageAdvanceInWindow()                       // sub_48E870/sub_48EB30 (20296-20305)：★不动 ip
   * ③ 输入丢弃门 / 文本回卷门：                            // 20315-20321
   *    右键 (mask & 0x20) 或 [滚轮键按下 && 97055 >= 0 && Conf(set:ReDrawTextOnKey) == 1]
   *        ⇒ 跳过悬停（前者继续走 ⑥ 的取消路由；后者直接 `*v2 = 0` → LABEL_44）
   * ④ 文本回卷（滚轮键，★要求 ADV 位 0x40000000）：        // 20341-20363
   *    conf(set:WheelKeyUp) 命中 ⇒ moveCursor(-1) + 489816 = -1    （20345-20348）
   *    else conf(set:WheelKeyDown) 命中 ⇒ moveCursor(+1) 真 ⇒ 489816 = +1（20355-20357）
   *    else 489816 = 0                                     // 20360
   *    命中 ⇒ effect_flags |= 0x100000、跑 CALLBACK_TEXT.BIN、`*v2 = 0`（20349-20352）
   * ⑤ 悬停（两段式 enter/leave）：                          // 20322-20339
   *    gated ⇒ r = panel.nextHoverLabel() (sub_403E70, 20324)
   *    r != -1 ⇒ guard(owner); dispatch(r, -3); clear bit31 (20327-20334)
   *              if (!Conf(set:ControlDisibleCursor)) finishCharReveal()   // 20335-20336
   * ⑥ 右键「取消 / 跳读」路由（★**直接 return，不落 LABEL_44**）：  // 20365-20368
   *    jump = Engine[489488 + 4*cur]                        // 本帧 0xCC 注册的 mouseJump label（dword 偏移）
   *    jump == -1 ⇒ **直接 return，什么都不做**
   *    否则 ⇒ 489808 = effect_flags | 0x6000000、effect_flags = 0、489812 = 帧指令条数、
   *            430712 = 本帧脚本身份、**ip = ip_base + 4*jump**
   * ```
   *
   * ★**与旧实现的差别**（旧实现已删）：
   *  - 点击走 **labelC**（`sub_404E00` / 主循环 20182），**不是** labelA——旧实现取 `labelNext` 是错的；
   *  - 悬停 label **带返回点**（`-3`）当子程序跑，`ret` 回到门指令重跑 ⇒ 不需要"跑完还原 ip"；
   *  - **泵里不做命中测试**（`sub_403C50` 只在鼠标移动/面板首次显示时调）；
   *  - 没有热点时 = **在消息窗内推进文本**（不动 ip），不是"放行脚本自己跑"；
   *  - ★2026-09（本简报）：**右键不是"什么都不做"** —— 本帧 `0xCC` 注册过 mouseJump 时要把
   *    帧 ip 改写到那个 label 并清整个 `effect_flags`（`#cancelRoute`）；**滚轮键**也不再只是
   *    "另一种推进"：它走 ④ 的文本回卷（`moveCursor`），而"推进"只认 `set:WheelKeyDown`。
   *
   * @returns `true` = 本帧处理过一次输入（派发了 label 或推进了页内文本）；
   *          右键取消路由**一律返回 `false`**（引擎 raw 20368/20374 不落 `LABEL_44` ⇒ 不算"推进"，
   *          也不跑自动翻页块；与既有断言 `test/adv-msgwin.test.ts:458` 的语义一致）。
   */
  serviceAdvanceWait(): boolean {
    if (!this.awaitingAdvance) return false;
    const im = this.input;
    const panel = this.routes;
    // ★★必须是**消费刷**（引擎 raw 20238 的 `sub_478090`）：只吃「新按下事件」。
    //   若用 `flushHeld()`（含按住态），按住左键期间本泵会**每帧**满足 `advancePressed` ⇒
    //   每帧翻一页（用户实测：单击一次快进多页、按住就一直推进）。见 `tickets/T-0027`。
    const mask = im.flushPending();
    if (!panel.shown) return this.#endWaitPump(mask, false);

    // ★命中测试**只在鼠标移动过时**重做（引擎 `sub_4B8D50` raw 140827-140830 在 WM_MOUSEMOVE 里调
    //   `sub_403C50`；等待泵里没有它）。`hitTestPending` = "游标还没按最新位置重算过" ⇒ 做完即消费
    //   （**不能**用 `mouseMoved`：那一格在等待态不会被 `consumeEdges()` 清掉 ⇒ 会退化成每帧重算）。
    if (im.hitTestPending && im.hasCursor) {
      panel.hitTest(im.readX(), im.readY());
      im.hitTestPending = false;
    }

    // ① 键命中（sub_403D70）—— **等待泵的第一优先出口**，ADV「键盘推进」走这条。
    const keyLabel = panel.pickByKey(mask);
    if (keyLabel !== -1) {
      this.guardScriptIdentity(panel.ownerScriptId); // sub_4083B0
      if (this.controlDisableCursor() === 0) this.finishCharReveal(); // sub_4051A0
      this.eatAllInput(); // sub_4053C0：刷掩码 + 按钮保持位 + 掩码清 0
      this.awaitingAdvance = false; // effect_flags &= ~0x80000000（20250）
      this.dispatchWithReturn(keyLabel, -3);
      this.lastDispatch = { label: keyLabel, kind: 'key' };
      panel.cursor = -1; // LABEL_68
      panel.enterPending = 0;
      return this.#endWaitPump(mask, true);
    }

    // ② 推进输入：`(mask & 0x50) != 0`（鼠标左/右）或 `set:WheelKeyDown` 键位命中（受
    //    message:AdvanceMesOnWheel 位 0 门控，且跳读中不推进）。★右键在 ③ 已经返回，到不了这里
    //    ⇒ 实际生效的是「鼠标左键」与「滚轮下键 + 配置位」两条（raw 20262-20267 的 `0x50` 里
    //    bit5 那条只对"面板未显示"的情况有意义，而面板未显示时上面已经 return）。
    if (this.advancePressed(mask)) {
      this.awaitingAdvance = false; // 20276
      // 20278-20282：收尾逐字显现（同 sub_4051A0）
      if ((this.effectFlags & CHAR_REVEAL_ACTIVE) !== 0) this.finishCharReveal();

      if ((mask & 0x10) !== 0 && panel.cursorValid()) {
        // 20284-20292：**鼠标左键 + 游标有效 ⇒ 派发当前游标项的 labelC**（sub_404E00）。
        this.guardScriptIdentity(panel.ownerScriptId);
        this.dispatchWithReturn(panel.currentLabelClick(), -3);
        this.lastDispatch = { label: panel.entries[panel.cursor]?.labelClick ?? -1, kind: 'click' };
        panel.cursor = -1;
        panel.enterPending = 0;
      } else {
        // 20296-20305：没有命中热点 ⇒ 在消息窗对象内部推进文本（`sub_48E870`/`sub_48EB30`），
        // **完全不动脚本 ip**。这就是「点空白处翻页」的真实机制。
        this.messageAdvanceInWindow();
      }
      im.consumeWheelDelta();
      im.consumeEdges(); // `*v2 &= ~0x10`（20312）+ 掩码整体弃用
      return this.#endWaitPump(mask, true);
    }

    // ③ 两条「本帧不再看悬停」的门（raw 20315-20321）。★**次序照 raw**：
    //    ① 右键（`mask & 0x20`）⇒ 一直走到 **⑥ 的取消 / 跳读路由**（raw 20365-20374）才收口；
    //    ② 滚轮键按下 + `Engine[388220]`（= `97055` 文本对象槽参数）>= 0 + `Conf(set:ReDrawTextOnKey) == 1`
    //       ⇒ 什么都不派发，`*v2 = 0` 后直接 `goto LABEL_44`。
    //    ★两条都**不**经过滚轮分支（raw 20341 在 20315 的 `else` 里），但①要落到 20365 那条。
    if ((mask & 0x20) !== 0) {
      // raw 20366 `*v2 = 0`（消费这次输入）→ raw 20367-20368（未注册则**直接 return**）→ 20369-20374。
      im.consumeEdges();
      this.#cancelRoute();
      // raw 20368/20374 **都不是 `goto LABEL_44`** ⇒ 不跑自动翻页块，也不算"处理过一次推进"。
      return false;
    }

    // ④ 文本回卷（滚轮键；引擎 raw 20341-20363，**整个块被 ADV 位 0x40000000 门控**）。
    if ((this.effectFlags & CHAR_REVEAL_ACTIVE) !== 0 && this.#textRewindWheel(mask)) {
      return this.#endWaitPump(mask, true);
    }
    if (this.#advInputDropped(mask)) {
      // ② 的那条：什么都不派发（raw 20362 `*v2 = 0` ⇒ LABEL_44）。
      return this.#endWaitPump(mask, false);
    }

    // ⑤ 悬停（两段式 enter/leave；raw 20322-20339）。
    if (!this.hoverDispatchAllowed(mask)) return this.#endWaitPump(mask, false);
    const hoverLabel = panel.nextHoverLabel(); // sub_403E70 (20324)
    if (hoverLabel === -1) return this.#endWaitPump(mask, false);
    this.guardScriptIdentity(panel.ownerScriptId); // sub_4083B0 (20327)
    this.dispatchWithReturn(hoverLabel, -3); // sub_405360(-3) + ip = label (20328-20332)
    // 观测：`[7466]` 已置 ⇒ 这一条是"离开"（`sub_403E70` 的 9944），否则是"进入"（9949）
    this.lastDispatch = { label: hoverLabel, kind: panel.enterPending !== 0 ? 'hover-leave' : 'hover-enter' };
    this.awaitingAdvance = false; // effect_flags &= ~0x80000000 (20334)
    if (this.controlDisableCursor() === 0) this.finishCharReveal(); // sub_4051A0 (20335-20336)
    return this.#endWaitPump(mask, true);
  }

  /**
   * **右键「取消 / 跳读」路由**（引擎 `sub_411BC0` raw 20365-20374，`tickets/T-0167` 的 §4.2 #1）。
   *
   * ```c
   * v6 = *(_DWORD *)(_this + 383104);                                 // 20365：当前帧号
   * *v2 = 0;                                                          // 20366：消费掉这次输入
   * if ( *(_DWORD *)(_this + 4 * v6 + 489488) == -1 ) return;         // 20367-20368：★本帧没注册 ⇒ 直接 return
   * *(_DWORD *)(_this + 489808) = *(_DWORD *)(_this + 699204) | 0x6000000;  // 20369
   * *(_DWORD *)(_this + 699204) = 0;                                  // 20370：清**整个** effect_flags
   * *(_DWORD *)(_this + 489812) = (…383128 − …383124) >> 2;           // 20371：本帧指令条数
   * *(_DWORD *)(_this + 430712) = *(_DWORD *)(_this + 120*v6 + 383184);      // 20372：本帧脚本身份
   * *(_DWORD *)(_this + 120*v6 + 383128) = …383124 + 4 * *(_DWORD *)(…489488);  // 20373-20374：改写帧 ip
   * ```
   *
   * ## 引擎里三格的下落（**emulator 的落点与缺口，逐格给**）
   * | 引擎格 | emulator | 状态 |
   * |---|---|---|
   * | `489808` = `_this[122452]` | `ENGINE_FIELD.redisplayMode`（122452） | **已接线**：读者 = `0x7C`（`handlers/frame.ts:265-280`，`mode & 0x2000000` 门 + `effect_flags = mode & 0xFDFFFFFF` + 清 0）—— 本改动照引擎写 `effect_flags \| 0x6000000`，于是那个读者对右键取消**天然成立**（写 0x6000000 是与 `0x199`（`handlers/frame.ts:224`）同一形状） |
   * | `489812` = `_this[122453]` | `ENGINE_FIELD.redisplayReturn`（122453） | ★**登记缺口**：读者现成（同一 `0x7C` 的 `jumpToDword`，`handlers/frame.ts:277-278`），但**写不出正确值**——它要求"回调脚本跑完那一刻 `(ip−ip_base)>>2`"，而 emulator **不装载/不跑 `CALLBACK_TEXT.BIN`**（那要 `sub_411560`→`sub_40FC90`→`sub_40FB60` 的按名装载+派发链，emulator 无"按名装载并把控制立刻交给它"的口，见 `#textRewindWheel` 的登记）。写标签下标或 `instructions.length` 只会把 ip 还原到**错的地方**（比不动更坏）⇒ 治本前**不写**；`redisplayMode` 已被写成 `0x6000000`（**不含** `0x2000000`）⇒ 真到了 `0x7C` 会照引擎 raw 25791-25796 抛 `END.HWL`（= "那条回调没跑"的可观测后果），而不是静默乱跳。 |
   * | `430712` = `_this[107678]` | `ENGINE_FIELD.redisplayScriptId`（107678） | **已接线**：读者 = `0x7C` raw 25799 的深度校验（`handlers/frame.ts:271-276`：`frame.scriptId` 必须等于它）；值与 `0x199`（`handlers/frame.ts:228`）写的是同一格、同一口径（`frame.scriptId`） |
   *
   * ★**为什么三格能复用 `0x7C`（`local-ret`）的那一套**：引擎体里**本来就是同一批格子**
   * （raw 20369 的 `489808/489812` 与 raw 20872-20874 的 `0x4000000` 分支**逐字相同**），
   * `0x7C` 的注释（`handlers/frame.ts:243`）也早已把 `489808`/`489812` 标成 `122452`/`122453`
   * ⇒ 复用同一个 `ENGINE_FIELD` 常量是**忠于引擎**，不是 emulator 自造的别名。
   *
   * ★**本路由不压返回点、也不装载脚本**：引擎直接改写 `ip`（不是 `sub_405360` 的调用形态）
   * ⇒ emulator 直接 `frame.ip = p`，与 `0x199`（`jumpToDword`）同一条"自行定 ip"的口径。
   * `stepOnce` 之后照常从新 ip 继续派发。
   *
   * ★**本路由的「表项」取值来源 = `rewindMainBase + cur`**（`tickets/T-0169` §4「别人该接」#1，
   * `T-0179` 第 70 轮 goal round 3 落地）：体 raw 20367 读的是 `_this + 4*v6 + 489488`
   * （`v6 = _this[383104]` = 本帧 `cur`）⇒ 绝对下标 **`122372 + cur`** = `ENGINE_FIELD.rewindMainBase`，
   * 写者是 **`0x7B`**（`sub_41F530` raw 28729 的 **op1**）。
   * ★`0xCC`（mouse-callback，raw 30322）写的是 `_this[107664]`（字节 430656）—— **另一格**，
   * 读者是 `0xCD`（raw 25851 `v4 = *(_DWORD *)(_this + 430656)`）⇒ 它**不喂本路由**。
   * 修前本函数取 `input.mouseJump`（= `0xCC` 的那一格），后果是**真脚本上右键取消永不触发**：
   * 语料 `i0cc` **0 处**、`i07b` **1097 处 / 334 文件**（`$1$SC03xx`/`SC08xx` 一族的 ADV 现场）。
   * 守卫 `test/adv-right-click-cancel-route.test.ts` 的「只注 i0cc ⇒ 不取消」负例即此口径。
   *
   * @returns `true` = 本帧有注册的回退游标且已被派发；`false` = 未注册（**什么都不变**）。
   */
  #cancelRoute(): boolean {
    // `Engine[489488 + 4*cur]` = `rewindMainBase + cur`（`0x7B` 的 op1 写；raw 20367 的 v6 = cur）。
    const jump = (this.engineValues.get(ENGINE_FIELD.rewindMainBase + this.cur) ?? -1) | 0;
    if (jump === -1 || jump === 0xffffffff) return false; // raw 20367-20368：★直接 return
    const f = this.curScript();
    const p = f.labelMap.get(jump);
    if (p === undefined) {
      // ★**已知口径差**：引擎这里是 `ip = ip_base + 4*表项`，表项不在映像里时会跑到**非法地址**
      //   （真机崩/野跳）。emulator 的 `ip` 是脚本映像的**下标**，没有"地址"可野跳 ⇒ 这里选择
      //   **什么都不做**（与"未注册"同路），并把这件事记下来而不是编一个目标。重开条件：若将来
      //   要把"脚本与其 mouseJump 表不一致"当硬错误，这里应改成抛错（那需要先确认真机的表现）。
      return false;
    }
    const saved = this.effectFlags | 0;
    this.effectFlags = 0; // raw 20370：清**整个** effect_flags
    this.engineValues.set(ENGINE_FIELD.redisplayMode, (saved | 0x6000000) | 0); // raw 20369
    this.engineValues.set(ENGINE_FIELD.redisplayScriptId, f.scriptId); // raw 20372（= `frame[95796]`）
    // raw 20371（`489812` 的指令条数）**有意不写** —— 理由见上面表格那一行。
    f.ip = p; // raw 20373-20374：ip = ip_base + 4 * 表项
    this.lastDispatch = { label: jump, kind: 'cancel-route' };
    return true;
  }

  /**
   * **本帧「不再看悬停」的滚轮门**（引擎 `sub_411BC0` raw 20315-20321 的 `else` 一侧）。
   *
   * ```c
   * if ( (*(_BYTE *)v2 & 0x20) == 0 )            // ★右键：**不**走下面那一对，走 20365 的取消路由
   * { v26 = 1 << Conf(set:WheelKeyUp);
   *   if ( ((v26 | (1 << Conf(set:WheelKeyDown))) & *v2) == 0
   *     || *(int *)(_this + 388220) < 0                       // = Engine[97055]（文本记账门）
   *     || Conf(set:ReDrawTextOnKey) != 1 )   ⇒ 悬停分支（20322-20339）
   *   else ⇒ `*v2 = 0; goto LABEL_44;`          // 20362-20363：本帧什么都不派发
   * }
   * ```
   *
   * ★**右键那一支不归本函数**：泵在调它**之前**就已经 `return`（走 `#cancelRoute`）。两者的效果
   * 完全不同（滚轮那条什么都不做；右键那条会改写帧 ip 并清整个 `effect_flags`）⇒ 不合并成一个
   * 谓词，否则右键的行为会被"什么都不做"吃掉。
   */
  #advInputDropped(mask: number): boolean {
    const cfg = this.config;
    const wheelUp = cfg ? cfgInt(cfg, CFG.setWheelKeyUp, 0) : 0;
    const wheelDown = cfg ? cfgInt(cfg, CFG.setWheelKeyDown, 0) : 0;
    // ★`& 31` 只是**文档化**：x86 的 `shl cl` 与 JS 的 `<<` 都取模 32（`i10c` 已把位号钳进 [0,31]，
    //   而默认位号是 3/1 ⇒ 这条差别在**当前语料上不可观测**；`T-0168` 复核结论 = 保持现状 + 写明）。
    const wheelBits = ((1 << (wheelUp & 31)) | (1 << (wheelDown & 31))) >>> 0;
    if ((mask & wheelBits) === 0) return false; // 滚轮键没按 ⇒ 不丢
    // `Engine[388220]` 有符号 < 0（= `i1bb 0` 写的 0x80000000）⇒ 不丢（照常悬停）
    if (((this.engineValues.get(TEXT_BASE_GATE) ?? 0) | 0) < 0) return false;
    if (!cfg) return false;
    return cfgInt(cfg, CFG.setReDrawTextOnKey, 0) === 1; // `== 1` ⇒ 丢
  }

  /**
   * **文本回卷（滚轮键）**（引擎 `sub_411BC0` raw 20341-20363，`tickets/T-0167` 的 §4.2 #14）——
   * `TextItemTable.moveCursor`（`src/vm/textItems.ts:320`，逐行复刻 `sub_459770`）的**唯一产品消费者**。
   *
   * ```c
   * if ( (*(_DWORD *)(_this + 699204) & 0x40000000) != 0 )    // 20341：★ADV 位（= CHAR_REVEAL_ACTIVE）
   * { v7 = Conf(set:WheelKeyUp);  v8 = (_DWORD *)(_this + 85296);
   *   if ( ((1 << v7) & *v2) != 0 )                           // 20345：上滚键位命中
   *   { sub_459770(v8, -1, 2);                                // 20347：游标**后退一行**
   *     *(_DWORD *)(_this + 489816) = -1;                     // 20348：回看方向 = -1
   * LABEL_21:
   *     *(_DWORD *)(_this + 699204) |= 0x100000u;             // 20350：置"跳读中"位
   *     sub_411560((_DWORD *)_this, aCallbackTextBi);          // 20351：跑 CALLBACK_TEXT.BIN
   *     *v2 = 0; goto LABEL_44; }                              // 20352：消费掉这次输入
   *   if ( sub_459770(v8, 1, 2) )                             // 20355：前进一行
   *   { *(_DWORD *)(_this + 489816) = 1; goto LABEL_21; }      // 20357-20358
   *   *(_DWORD *)(_this + 489816) = 0; }                       // 20360：无回看事件
   * *v2 = 0; goto LABEL_44;                                    // 20362
   * ```
   *
   * ## 逐字口径（三处容易写错，**照抄引擎**）
   * 1. **上滚键位没有单独判**：raw 20355 是 `if (sub_459770(v8, 1, 2))`，**没有** `1 << Conf(set:WheelKeyDown)`
   *    的前置 `& *v2`（对照 raw 20345 那一行是有的）。⇒ 只有"上滚键命中"才保证进这一块；下滚键命中时
   *    这里会**试着前进**，成功就当成"下滚回看"。这是反编译的 `v7` 复用（`v7` 只在 20343 被赋过值）
   *    —— 若真机其实是第二轴的别名，本文也照它跑（见下方"已知偏差"）。
   * 2. **方向**：`-1` = 后退/回看更早（上滚）、`+1` = 前进（下滚）—— 与 `set:WheelKeyUp = 3`（掩码 bit3）
   *    的默认配置不矛盾：滚轮**上**给"上滚键"，把页游标**往回**拨。
   * 3. **`0x100000`（跳读位）是"或"上去的**（20350 `|= 0x100000u`），不是赋值 —— 所以它会被
   *    `advancePressed`（raw 20265 `(699204 & 0x100000) == 0`）与 `serviceAdv` 的收尾分支读到。
   *
   * ## `489816`（`_this[122454]`）在 emulator 的落点
   * 它**不是新字段**：`ENGINE_FIELD` 家族里紧邻 `redisplayMode`(122452)/`redisplayReturn`(122453)，
   * 语义 = **文本回卷方向**（`0x84`/`0x199` 一族与本节会写它；`#serviceAutoMessage` 已经在读它：
   * 非 0 ⇒ 停自动翻页计时器，raw 20378-20383）。emulator 侧用 `engineValues` 的 `122454` 格承载
   * （`ENGINE_FIELD.textRewind`，已由父代理从本节私有常量提升为注册表常量，字节 489816），
   * **写者 = 本节**、**读者 = `#serviceAutoMessage`** ⇒ 不是死写。
   *
   * ## 已知缺口（明确登记）
   * - **`sub_411560(Engine, "CALLBACK_TEXT.BIN")` 未建模**：它 = `sub_455000`（按名取统一文件 id）+
   *   `sub_40FC90`（`sub_409E10` 入队 + `sub_40FB60` 立即派发）。emulator 的按名装载口只有
   *   `FileSource.readScriptByName`（现在**唯一**调用点是读档的 `CALLBACK_LOAD.BIN`，
   *   `handlers/save-slot.ts:379`），**没有**"装载回调脚本并立刻把控制交给它"的机制。
   *   ⇒ 本节只落**游标 + `489816` + `0x100000` + 消费输入**这四件事（引擎体里 `sub_459770` 前后、
   *   `LABEL_21` 里可独立观测的部分）；**`CALLBACK_TEXT.BIN` 那一跳不假装**。
   *   可观测后果：`sub_411560('CALLBACK_TEXT.BIN')` 那一跳在**本资源树是 no-op**（索引 25080 条里 0 命中 ——
   *   base 21109 + 5 个扩展包 3971，`T-0168` 加严实测；`sub_455000` raw 67400-67439 返回 -1 ⇒
   *   `sub_40FC90` raw 19019-19027 体首早退）⇒ **真机与 emulator 都不会弹「回想/回看」画面**；
   *   要让那个画面出现，只能靠**路由键把位号 8 派发给 `call-script 31 // HISTORY`**
   *   （`src/SN0000.txt:106`；默认位号 3 ⇒ 上滚 = 派发 ← 键 = 打开侧边栏，那是引擎行为、不是本节的缺口）。
   *   **重开条件** = 有了"按名装载 + 立即派发回调脚本"的口（即把 `sub_411560`/`sub_40FC90` 建模）时，
   *   在这里补 `#runNamedCallback('CALLBACK_TEXT.BIN')`。
   *
   * @returns `true` = 本帧被这次滚轮回看消费掉（调用方不要再走悬停）。
   */
  #textRewindWheel(mask: number): boolean {
    const cfg = this.config;
    const wheelUp = cfg ? cfgInt(cfg, CFG.setWheelKeyUp, 0) : 0;
    const t = this.textItems; // 引擎 `_this + 85296`（ADV 侧文本对象）的等价物 = emulator 唯一的记录表
    let dir = 0;
    let moved = false;
    if (wheelUp >= 0 && wheelUp < 32 && (mask & (1 << wheelUp)) !== 0) {
      // raw 20345-20348：上滚键位命中 ⇒ 后退一行，**不检查返回值**
      t.moveCursor(-1, ITEM_REFLOW);
      dir = -1;
      moved = true;
    } else if (t.moveCursor(1, ITEM_REFLOW) !== 0) {
      // raw 20355-20357：★这里**没有** `1 << Conf(set:WheelKeyDown)` 的前置判（见函数头第 1 条）
      dir = 1;
      moved = true;
    }
    if (!moved) {
      // raw 20360：两条都没走 ⇒ `489816 = 0`（"本帧没有回看事件"）且**不置** `0x100000`
      this.engineValues.set(ENGINE_FIELD.textRewind, 0);
      return false;
    }
    this.engineValues.set(ENGINE_FIELD.textRewind, dir); // raw 20348 / 20357
    this.effectFlags |= 0x100000; // raw 20350（`|=`：跳读位，不是赋值）
    // raw 20351 `sub_411560(_this, aCallbackTextBi)`：未建模，见函数头"已知缺口"
    // raw 20352 的 `*v2 = 0`：把这次输入从待处理里拿掉（emulator = 清按下沿；**按住态不清** ——
    // 引擎那格是 WndProc 挂起位，不是"物理键还按着"）。
    this.input.consumeEdges();
    return true;
  }

  /**
   * **等待泵的出口**（引擎 `sub_411BC0` 的 `LABEL_44`，raw 20375-20461）——
   * 三条输入分支（键/推进/悬停）**每一条**都 `goto LABEL_44`，所以自动翻页块在**每一帧的每一次
   * 泵调用**上都会跑（不是"只在没输入时跑"）。这里因此把五个出口统一收进本函数。
   */
  #endWaitPump(mask: number, handled: boolean): boolean {
    this.#serviceAutoMessage(mask);
    return handled;
  }

  /**
   * **自动翻页块**（引擎 `sub_411BC0` raw 20376-20461）＝ `Engine[97052]` 的真实消费端
   * （审计 §4.1 P1 `op-4`/`op-5`，`tickets/T-0151`）。
   *
   * ```c
   * LABEL_44:
   * if (!Engine[97052]) return;                      // ★整个块的**唯一门**（共存消息 / 自动翻页模式）
   * if (Engine[489816] == 122454 文本回卷态 != 0) sub_453BC0(timer);     // 停表（t[4] = 1）
   * else { ms = (该窗行数 − 1 − Engine[122464]) * Pitch1 + Time1; if (ms <= 100) ms = 100;
   *        sub_453BD0(timer, ms); }                   // 只在**已停表**时重臂（t[4]=0;t[2]=1;t[5]=now;t[6]=ms）
   * if (!Engine[122501] 语音忙碌) goto LABEL_63;
   * ...（语音忙碌支：sub_404D10/sub_404D50/sub_404CB0 三条查询，见下）...
   * LABEL_58: if ((AutoMessageOption & 1) == 0) { if (!122501) sub_453A60(timer, Pitch0·…+Time0); return; }
   * LABEL_63:
   * if (sub_453AF0(timer) >= 0) {                    // ★到期 ⇒ **自动翻页**
   *     effect_flags &= ~0x80000000;                 // 清等待门
   *     sub_4051A0(Engine);                          // 收尾逐字显现
   *     sub_48E870/sub_48EB30(…);                    // 页内推进（**不动脚本 ip**）
   *     if ((mask & 0x10) && Engine[51828] && 游标有效) { sub_4083B0; sub_405360(-3); 派发游标 labelC; }
   * }
   * ```
   * ⇒ **`i1b7 1` 的真实效果**：ADV 页在 `Pitch×行数 + Time` 毫秒后自己往下走（免点击）。
   * 语料里只有 `src/FELLOW.txt:1324`（调试菜单）置位 ⇒ 默认路径不可见，但这是这一格的**唯一**
   * 行为消费者，接上它之后 `0x1b6`/`0x1b7` 才不是"只写不读"。
   *
   * ★**未实现的一支（明确登记）**：`Engine[122501]`（语音 3 路是否有正忙）非 0 时的
   * `sub_404D10`/`sub_404D50`/`sub_404CB0` 三条**语音队列同步回读**在 emulator 里不存在
   * （见 `handlers/audio.ts` 的 `sub_426820` 注释：`Engine[122501]` 是已知缺口、恒 0）
   * ⇒ 那一支当前不可达；若将来把 122501 接上，必须同时补这三条查询，否则会走错支。
   * 计时器对象 = `Engine+430180`（= `_this[107545]`）：`sub_453A60`/`sub_453BD0`/`sub_453BC0`/
   * `sub_453AF0` 的 `t[2]=1`(周期序号)、`t[4]`(停表)、`t[5]=timeGetTime()`、`t[6]=周期 ms`。
   */
  #serviceAutoMessage(mask: number): void {
    /** `Engine[97052]`：共存消息 / 自动翻页模式（`0x1b6`/`0x1b7` 读写；见 `advFields`）。 */
    if ((this.advFields.get(97052) ?? 0) === 0) return; // raw 20376
    const T = AUTO_MESSAGE_TIMER;
    const t = (k: number): number => this.engineValues.get(T + k) ?? 0;
    // raw 20378-20383：文本回卷态（`Engine[489816]` = 122454）非 0 ⇒ 停表（`sub_453BC0`）
    if ((this.engineValues.get(ENGINE_FIELD.textRewind) ?? 0) !== 0) {
      if (t(4) === 0) this.engineValues.set(T + 4, 1);
    } else {
      // raw 20384-20399：按"该窗行数 − 1 − 行基准"的 Pitch1/Time1 算时长（下限 100）后重臂
      let ms = this.#autoMessageInterval(CFG.messageAutoMessagePitch1, CFG.messageAutoMessageTime1);
      if (ms <= 100) ms = 100;
      // `sub_453BD0`（raw 453BD0）：**只在已停表时**重臂（`if (t[4]) { t[4]=0; t[2]=1; t[5]=now; t[6]=ms }`）
      if (t(4) !== 0) this.#armAutoMessage(ms);
    }
    // raw 20401：语音不忙 ⇒ 直接做到期判定；忙 ⇒ 见函数头"未实现的一支"
    if ((this.engineValues.get(FIELD_VOICE_BUSY) ?? 0) !== 0) return;
    // raw 20430-20443：到期 ⇒ 清等待门 + 收尾逐字 + **页内推进**（与"点空白处翻页"同一条路）
    if (!this.#autoMessageExpired()) return;
    this.awaitingAdvance = false; // effect_flags &= ~0x80000000（20432）
    this.finishCharReveal(); // sub_4051A0（20433）
    this.messageAdvanceInWindow(); // sub_48E870/sub_48EB30（20434-20443）
    // raw 20444-20460：同一帧里还有左键按下且游标有效 ⇒ 把这次到期当"点了那个热点"
    if ((mask & 0x10) !== 0 && this.routes.shown && this.routes.cursorValid()) {
      this.guardScriptIdentity(this.routes.ownerScriptId);
      this.dispatchWithReturn(this.routes.currentLabelClick(), -3);
      this.lastDispatch = { label: this.routes.entries[this.routes.cursor]?.labelClick ?? -1, kind: 'click' };
      this.routes.cursor = -1;
      this.routes.enterPending = 0;
    }
  }

  /** 该窗"自动翻页时长" = `(行数 − 1 − Engine[122464]) × pitch + time`（raw 20389-20394 / 28568-28581）。 */
  #autoMessageInterval(pitchKey: string, timeKey: string): number {
    const conf = (k: string): number => (this.config ? cfgInt(this.config, k, 0) : 0);
    const w = this.msgwin.resolveWin(this.msgwin.lastArg);
    const lines = layoutWindow(w, { style: styleOfWin(this, w), segments: this.msgwin.slot(w).segments }).lines.length;
    return (lines - 1 - (this.engineValues.get(ENGINE_FIELD.autoMessageBaseline) ?? 0)) * conf(pitchKey) + conf(timeKey);
  }

  /** `sub_453A60`（raw 66101-66112）：`t[2]=1; t[5]=now; t[6]=ms||1` —— 无条件重臂。 */
  #armAutoMessage(ms: number): void {
    this.engineValues.set(AUTO_MESSAGE_TIMER + 2, 1);
    this.engineValues.set(AUTO_MESSAGE_TIMER + 4, 0);
    this.engineValues.set(AUTO_MESSAGE_TIMER + 5, this.nowMs | 0);
    this.engineValues.set(AUTO_MESSAGE_TIMER + 6, ms > 0 ? ms : 1);
  }

  /**
   * `sub_453AF0`（raw 66149-66186）的到期判定：停表（`t[4]`）或周期 ≤ 0 ⇒ 未到期；
   * 到期时把已过周期数写回 `t[2]`、余量写 `t[3]`（计时器**周期性重复**：下一次到期 = 起点 + 2×周期）。
   */
  #autoMessageExpired(): boolean {
    const T = AUTO_MESSAGE_TIMER;
    const t = (k: number): number => this.engineValues.get(T + k) ?? 0;
    if (t(4) !== 0) return false; // raw 66161-66162
    const period = t(6);
    if (period <= 0) return false; // raw 66198
    const count = t(2) !== 0 ? t(2) : 1;
    const elapsed = (this.nowMs | 0) - t(5);
    this.engineValues.set(T + 1, elapsed); // raw 66169
    const want = period * count;
    if (want - elapsed >= 5) return false; // raw 66170-66171：还早
    // raw 66172-66179：`0 < 剩余 < 5` 时引擎 `Sleep(剩余)` 忙等 ⇒ 这里直接当已到点（wall clock 同步）
    const used = Math.max(elapsed, want);
    this.engineValues.set(T + 3, used - want); // raw 66181
    const next = Math.floor(used / period) + 1;
    this.engineValues.set(T + 2, next); // raw 66184
    return Math.floor(used / period) - count >= 0; // raw 66183
  }

  /**
   * **悬停/点击的收尾**（引擎 `sub_4051A0` raw 10923-10935）：
   * `if (effect_flags & 0x40000000) { if (!(flags & 0x100000)) sub_45A940(Font, 当前窗, -2, 0); 清 bit30 }`
   * ＝ **把在飞的逐字显现立刻收尾（整段贴出）并清 bit30**。
   *
   * ★仍存疑（`tickets/T-0187` ①，**未决，不许照观察改**）：用户真机实测「悬停/打开/收起侧边栏
   * **完全不影响** ▼ 的动画」，而 raw 字面（10929-10933 只要 bit30 置位就清）⇒ 悬停会把 ▼ 的
   * loop 打断、门重跑再从头武装。冲突的两个候选解释（配置门 `set:ControlDisibleCursor` 的真机
   * 取值 / 悬停派发是否到达这一跳）与**判别实验**登记在 `analysis/engine-capabilities.json`
   * 的 `msgwin-char-reveal-grid` 与 `tickets/T-0187/notes.md`；探针结果出来之前，本函数**按 raw**。
   */
  finishCharReveal(): void {
    for (const win of this.msgwin.reveal.keys()) this.msgwin.finishReveal(win);
    this.endCharReveal();
    this.serviceTextReveal(this.nowMs);
  }

  /**
   * **吃掉本次输入**（引擎 `sub_4053C0` raw 11044-11058）：
   * `sub_478090(输入管理器, mask)`（刷掩码）→ `sub_477220` 把鼠标按钮值读进临时量，
   * 非 0 则 `输入管理器[1690] = 1` → **最后 `mask = 0`**。
   */
  eatAllInput(): void {
    this.input.flushPending(); // 引擎 sub_478090（sub_4053C0 调它刷一次挂起事件）
    this.input.consumeEdges();
    this.input.consumeWheelDelta();
  }

  /**
   * 「推进输入」判定（引擎 raw 20262-20267，逐字对齐）：
   * ```
   * (mask & 0x50) != 0                       // ★bit4 = 鼠标左、bit5 = 鼠标右（sub_477150 的映射）
   * || ( ((1 << Conf(set:WheelKeyDown)) & mask) != 0
   *      && (effect_flags & 0x100000) == 0   // 跳读中不按滚轮推进
   *      && (Conf(message:AdvanceMesOnWheel) & 1) != 0 )
   * ```
   * ★**掩码位 0x50 = 鼠标左/右**（`sub_477150`：`*a2 |= 1 << (LOBYTE(_this[SystemMetrics+1125]) + 4)`，
   * 左键时 `SystemMetrics(23)=0` ⇒ bit4；右键 `1 - v4` ⇒ bit5）。**不是"左+右键都算"**，
   * 而是"这一位本身代表鼠标键"。
   *
   * ★滚轮**不是**无条件推进输入：随包 INI 缺 `set:WheelKeyDown`（= bit0）与
   * `message:AdvanceMesOnWheel`（= 0）⇒ 滚轮推进这条路默认**不成立**（见
   * `docs-new/03-engine/message-config-gates.md`）。旧实现把 `wheelDelta != 0` 也算推进输入，与引擎不符。
   */
  advancePressed(mask: number): boolean {
    if ((mask & 0x50) !== 0) return true;
    const cfg = this.config;
    if (!cfg) return false;
    const wheelKey = cfgInt(cfg, CFG.setWheelKeyDown, 0);
    if (wheelKey < 0 || wheelKey >= 32) return false;
    if ((mask & (1 << wheelKey)) === 0) return false;
    if ((this.effectFlags & 0x100000) !== 0) return false; // 跳读中 ⇒ 不按滚轮推进
    return (cfgInt(cfg, CFG.messageAdvanceMesOnWheel, 0) & 1) !== 0;
  }

  /**
   * `Conf(set:ControlDisibleCursor)`（缺键 = 0）：
   * **非 0 ⇒ 派发 label 前不调 `sub_4051A0`**（「光标模式：不要自动收尾逐字显现」）。
   */
  controlDisableCursor(): number {
    return this.config ? cfgInt(this.config, CFG.setControlDisibleCursor, 0) : 0;
  }

  /**
   * **没有命中热点时的页内推进**（引擎 raw 20296-20305 的 `sub_48E870`/`sub_48EB30`）。
   *
   * 引擎在**消息窗对象内部**推进文本（把该窗的逐字显现收尾 / 推进到下一段），**不动脚本 ip**。
   * emulator 没有那套文本对象 ⇒ 等价物 = 「本页认为是显示完的」并把余下的字整段贴出：
   * 脚本仍停在 `wait-for-input`（门已清），下一帧照常往下跑。
   *
   * ★这与旧实现的"表空 ⇒ 清门让脚本自己跑"**语义不同**：旧实现把整页推进交回脚本，
   * 而引擎这里只是把这一窗的字贴完。
   */
  messageAdvanceInWindow(): void {
    if (this.msgwin.isRevealing()) this.finishCharReveal();
    this.msgwin.showing = 0;
  }

  /**
   * **悬停分支的门控**（引擎 `sub_411BC0` raw 20315-20339 的前半：`v9 = sub_403E70(routes)`）。
   *
   * ★**不在这里做命中测试**：游标由鼠标移动事件（`sub_4B8D50` → `InputManager.onCursorMove`
   * → `routes.hitTest`）或面板首次显示（`sub_404020`）更新。
   *
   * ★**总开关的正确极性**（raw 20318-20320，汇编 0x411DBF-0x411DEB 已逐条核对）：
   * ```
   * edx = (1<<Conf(set:WheelKeyUp)) | (1<<Conf(set:WheelKeyDown));
   * if ((mask & edx) == 0)  goto 悬停分支;        // 滚轮键没按 ⇒ 悬停
   * if (Engine[388220] < 0) goto 悬停分支;        // 文本对象槽参数为负（= 0x1BB 0 置的 0x80000000）⇒ 悬停
   * if (Conf(set:ReDrawTextOnKey) != 1) goto 悬停分支;
   * // ↓ 只有"滚轮键按下 && 97055>=0 && ReDrawTextOnKey==1"才**跳过**悬停
   * ```
   * ⇒ 随包 INI **缺** `set:ReDrawTextOnKey`（= 0）且 `i1bb 0` 期间（`97055 = 0x80000000 < 0`）时，
   * **悬停派发是生效的**（规格 §D.1 把它写反了，这里按汇编订正）。
   *
   * 整体条件（`sub_411BC0` 的 `if (~((mask & 0x20) == 0 && …))`，raw 20315-20321）：
   * ```
   * (mask & 滚轮键位) != 0 且 Engine[388220] >= 0 且 Conf(set:ReDrawTextOnKey) == 1 → 跳过悬停
   * ```
   * ★**右键（`mask & 0x20`）不在本函数里**：它走 20365 的「取消 / 跳读」通路（`#cancelRoute`），
   * 而泵在调本函数**之前**就已经 `return` 了（`#advInputDropped`）。理由：右键那一条会**改写帧 ip**
   * 并清整个 `effect_flags`，与"什么都不派发"完全不是一回事，混在一个谓词里会把它的行为弄丢。
   * （本函数以前把右键也判成"不许悬停"，那只是"不做悬停"这一半；现在那一半由 `#advInputDropped`
   * 承担，本函数的返回值语义收敛成"悬停这一支是否放行"。）
   *
   * 其余情况**都走悬停派发**（`sub_403E70`，20324）。
   *
   * @param mask 本帧的输入掩码（引擎 `*v2`，由泵算一次后**复用**）。缺省时自己 `flushPending()`
   *        —— 测试门面（`test/harness.ts` 的 `pickHoverLabel`）与 `test/route-dispatch.test.ts`
   *        就是这么调的。
   *
   * ★消费点只有两处、都是**同一对调用**（`if (!hoverDispatchAllowed(mask)) …; routes.nextHoverLabel()`）：
   * 产品路径 = `serviceAdvanceWait()`（本文件 `:1265-1266`）；测试 = `test/harness.ts` 的
   * `pickHoverLabel(e)` 门面。修前引擎上还挂着一个 `pickHoverLabel()` 方法（只被测试调用），
   * `tickets/T-0014` 把它删掉了 —— 引擎不该为测试保留产品路径不走的方法。
   */
  hoverDispatchAllowed(mask?: number): boolean {
    const m = mask ?? this.input.flushPending();
    const cfg = this.config;
    const wheelUp = cfg ? cfgInt(cfg, CFG.setWheelKeyUp, 0) : 0;
    const wheelDown = cfg ? cfgInt(cfg, CFG.setWheelKeyDown, 0) : 0;
    const wheelBits = (1 << (wheelUp & 31)) | (1 << (wheelDown & 31));
    if ((m & wheelBits) === 0) return true; // 滚轮键没按 ⇒ 悬停
    if (((this.engineValues.get(TEXT_BASE_GATE) ?? 0) | 0) < 0) return true; // `i1bb 0`（0x80000000，有符号为负）⇒ 悬停
    if (!cfg) return true;
    return cfgInt(cfg, CFG.setReDrawTextOnKey, 0) !== 1; // redraw==1 ⇒ **跳过**悬停
  }

  /**
   * **headless 确定性放行**：无输入源时（`report.ts` / `run.ts` / `tools/gameStartChain.ts`）
   * 把等待门当作"玩家立刻点了"，若已登记热点则**跳到第一个热点的 labelC**（与真实点击同一出口），
   * 否则只解除门。
   *
   * ★这条与 `serviceAdvanceWait`（renderer 的泵）刻意不同：**不压返回点**。
   * 依据 = 引擎的 `sub_411900`（ADV 跑动帧）在 `panelA[7463]` 且 `Engine[122368] == 0` 时也是
   * **直接 `ip = labelC`**（raw 20175-20184 的 `sub_405360(_this, 0)` 是"压当前偏移"——
   * 但 headless 宿主不驱动 `ret`/帧循环，压了反而改变走向）。实测：压返回点会让 SN0000 跳过
   * ADV 暗幕 `f807d` 的装配，`0x19640` 的 `set-vertex-color` 读到 0（见 `test/mesh-vertex-quad.test.ts` E3）。
   *
   * 返回跳转到的 label（`null` = 未跳转）。**仅 headless 使用**。
   */
  forceAdvance(): number | null {
    if (!this.awaitingAdvance) return null;
    if ((this.effectFlags & CHAR_REVEAL_ACTIVE) !== 0) this.finishCharReveal();
    const first = this.routes.entries[0];
    this.awaitingAdvance = false;
    if (first && this.jumpToLabel(first.labelClick)) {
      this.routes.cursor = -1;
      this.routes.enterPending = 0;
      this.lastDispatch = { label: first.labelClick, kind: 'headless' };
      return first.labelClick;
    }
    return null;
  }

  /** 把当前帧的 `ip` 重定位到某个 label 值（引擎 `ip = ip_base + 4*label`）—— **只服务 `jmp`/`call`**。 */
  jumpToLabel(label: number): boolean {
    const f = this.curScript();
    const p = f.labelMap.get(label);
    if (p === undefined) return false;
    f.ip = p;
    return true;
  }

  // ───────────────────────────── Live2D 运行态（`0x341`–`0x352`） ─────────────────────────────
  /**
   * **10 个 L2D 实例槽**（引擎 `Scene+55812` 起；键 = 槽号 0..9）。
   *
   * 为什么放在 `Engine` 而不是 `SceneState`：这两张表由 **VM 指令直接读写**（不经宿主缝），
   * 且"节点指向的槽有没有模型"本身就是**绘制判据**（引擎 raw 134320）—— 放在 VM 层就只有一份，
   * 两个宿主（Pixi / headless）读的是同一份；而 `SceneState` 是两个宿主各自持有的。
   */
  readonly l2dSlots: Map<number, L2dInstance> = new Map();
  /** **572B 立绘节点**（引擎 `Scene+1096`；键 = map key）。 */
  readonly l2dNodes: Map<number, L2dNode> = new Map();
  /** 已解析的 `.MTN` 缓存（按文件 id）。 */
  readonly l2dMotionCache: Map<number, Mtn> = new Map();
}

