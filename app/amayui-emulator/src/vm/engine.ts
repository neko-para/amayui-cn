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
import { TextItemTable } from './textItems.js';
import { StageLoop, runStageService } from './stageLoop.js';
import { TEXT_BASE_GATE } from './handlers/text-items.js';
import { cfgInt } from '../engineConfig.js';
import { CFG } from '../configRegistry.js';
import { emitWin, messageSpeedOf, winStyle } from './handlers/msgwin.js';
import { FIELD_CHAR_CURSOR, FIELD_WIN_REVEAL_GATE } from './engineFieldIds.js';
import { layoutWindow } from '../text/layout.js';
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
  /** 当前指令长度（dword 单位，含 opcode）。M0 预解析后逐条步进，此字段供观查 */
  arity = 0;
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
  callRet = -1;
  callLink = -1;
  callFlag = 0;

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
  dispatchQueues: number[][] = Array.from({ length: 11 }, () => [] as number[]);

  /** 引擎配置字段（稀疏 _this 索引，fidelity 到 engine.cpp）。默认值与引擎构造函数一致：
   *  构造函数/初始化（engine.cpp 22404，字节偏移 387932 = _this[96983]）把 96983 置 1；另一处重置（34632）清 0。
   *  SYSTEM4 的 `u00415F40`(0x130) 读 96983 决定是否播放 LOGO 开场。构造函数默认=1 → LOGO 显示（真实游戏行为）。
   *  ★**启动时由 SYS4REG.INI 填充**：见 `src/engineConfig.ts` 的 `CONFIG_FIELD_BINDINGS`（如 174713←sound:Music、
   *    167990←display:ScreenMode、21668←message:MessageSpeed、80106←message:MessageFade），
   *    renderer 在 boot 前调用 applyConfigToEngine。`field` 一律是 dword 下标（= handler 的 `_this[K]` 空间）。 */
  engineValues = new Map<number, number>([
    [96983, 1],
    // 517 = SetKeyTotal（0xFE）：Input 构造函数 `sub_477DD0`（raw 92385）写 `_this[259] = 7`
    // （Input 对象 = `Engine + 258` ⇒ Input[259] = Engine[517]）。它同时是 **0x100 在掩码为空时的
    // "默认键"槽下标**（`tickets/T-0046`）——开机后 `SYSTEM4.txt:86` 的 `i0fe c` 会把它改成 12。
    [517, 7],
  ]);

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
   * 详见 `src/vm/saveData.ts` 与 `analysis/engine-capabilities.json` 的 `save-data-tables-persistence`。
   */
  onSaveDataChanged?: () => void;

  /** 导出两张持久化表（宿主写 `SAVE.DAT` 用）。 */
  saveDataTables(): import('./saveData.js').SaveDataTables {
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
  applySaveDataTables(t: import('./saveData.js').SaveDataTables): void {
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
   * **emulator 侧的按键扫描近似**（`0x100` 用）：上一次派发时的输入掩码。
   *
   * 引擎的扫描游标（`Engine[cur+122287]`）由**帧泵** `sub_4780D0` 每帧复位；emulator 没有那个钩子，
   * 于是用「掩码变了 ⇒ 新一轮扫描」近似（同一掩码状态下仍按引擎语义连续派发多个键）。
   * ★这是 emulator 记账，不是引擎字段（引擎里没有这一格）。
   */
  keyScanLastMask = 0;

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
   * ★未建模：raw 12793 的 `(Scene+46528) & 2` 门 —— 该格无置位点（见 `gatePending` 的说明）。
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
    for (let i = 0; i < 40; i++) this.frames.push(new Frame());
    // ★引擎 `sub_4B8D50`（raw 140825-140836，WM_MOUSEMOVE）：只在**鼠标移动**时做命中测试。
    //   等待泵 / 主循环里**没有** `sub_403C50` ⇒ 不能每帧重算（否则"表重登记后立刻重新命中"
    //   会让悬停反复触发，见规格 §E2）。
    this.input.onCursorMove = (x, y) => {
      this.routes.hitTest(x, y);
    };
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
    // ★ADV 分支用**实时刷**（引擎 sub_411900 raw 20111 的 `sub_4780D0`）：含鼠标左右键的**按住态**
    //   （set:CancelMessageKey 三态机就靠它判「已松开」）。**不要**换成 flushPending（T-0027）。
    const mask = im.flushHeld();
    const skipBit = m.skipMirror !== 0;

    // 取消消息键三态机（引擎门控：GetConfig("set:CancelMessageKey")）
    if (this.config && cfgInt(this.config, CFG.setCancelMesSkipOnClick, 0) !== 0) {
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
   * ② 推进输入 (mask & 0x10) 或 滚轮键：                    // 20262-20267
   *    clear bit31 (20276)
   *    if (mask & 0x10 && panel.shown && 0 <= cursor < count)   // 20284-20288（鼠标左键）
   *        guard(owner); dispatch(labelC of cursor, -3); cursor = -1; enterPending = 0   // 20289-20292
   *    else messageAdvanceInWindow()                       // sub_48E870/sub_48EB30 (20296-20305)：★不动 ip
   * ③ 悬停（两段式 enter/leave）：                          // 20315-20339
   *    gated ⇒ r = panel.nextHoverLabel() (sub_403E70, 20324)
   *    r != -1 ⇒ guard(owner); dispatch(r, -3); clear bit31 (20327-20334)
   *              if (!Conf(set:ControlDisibleCursor)) finishCharReveal()   // 20335-20336
   * ```
   *
   * ★**与旧实现的差别**（旧实现已删）：
   *  - 点击走 **labelC**（`sub_404E00` / 主循环 20182），**不是** labelA——旧实现取 `labelNext` 是错的；
   *  - 悬停 label **带返回点**（`-3`）当子程序跑，`ret` 回到门指令重跑 ⇒ 不需要"跑完还原 ip"；
   *  - **泵里不做命中测试**（`sub_403C50` 只在鼠标移动/面板首次显示时调）；
   *  - 没有热点时 = **在消息窗内推进文本**（不动 ip），不是"放行脚本自己跑"。
   *
   * @returns `true` = 本帧处理过一次输入（派发了 label 或推进了页内文本）。
   */
  serviceAdvanceWait(): boolean {
    if (!this.awaitingAdvance) return false;
    const im = this.input;
    const panel = this.routes;
    // ★★必须是**消费刷**（引擎 raw 20238 的 `sub_478090`）：只吃「新按下事件」。
    //   若用 `flushHeld()`（含按住态），按住左键期间本泵会**每帧**满足 `advancePressed` ⇒
    //   每帧翻一页（用户实测：单击一次快进多页、按住就一直推进）。见 `tickets/T-0027`。
    const mask = im.flushPending();
    if (!panel.shown) return false;

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
      return true;
    }

    // ② 推进输入：`(mask & 0x50) != 0`（鼠标左/右）或滚轮键位命中（受 set:WheelKeyDown +
    //    message:AdvanceMesOnWheel 位 0 门控）。**没有推进输入时继续看 ③ 悬停**。
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
      return true;
    }

    // ③ 悬停（两段式 enter/leave；raw 20315-20339）。
    //    ★与规格 §D.1 的字面描述相反：`set:ReDrawTextOnKey == 1` 是**跳过**悬停的条件之一
    //    （汇编 0x411DBF-0x411DEB：`cmp eax,1 / jnz 悬停分支`），且只在"滚轮键按下 + `97055>=0`"时才生效
    //    ⇒ 随包 INI 缺该键（= 0）时悬停**是生效的**（见 `hoverDispatchAllowed` 的注释）。
    if (!this.hoverDispatchAllowed()) return false;
    const hoverLabel = panel.nextHoverLabel(); // sub_403E70 (20324)
    if (hoverLabel === -1) return false;
    this.guardScriptIdentity(panel.ownerScriptId); // sub_4083B0 (20327)
    this.dispatchWithReturn(hoverLabel, -3); // sub_405360(-3) + ip = label (20328-20332)
    // 观测：`[7466]` 已置 ⇒ 这一条是"离开"（`sub_403E70` 的 9944），否则是"进入"（9949）
    this.lastDispatch = { label: hoverLabel, kind: panel.enterPending !== 0 ? 'hover-leave' : 'hover-enter' };
    this.awaitingAdvance = false; // effect_flags &= ~0x80000000 (20334)
    if (this.controlDisableCursor() === 0) this.finishCharReveal(); // sub_4051A0 (20335-20336)
    return true;
  }

  /**
   * **悬停/点击的收尾**（引擎 `sub_4051A0` raw 10923-10935）：
   * `if (effect_flags & 0x40000000) { if (!(flags & 0x100000)) sub_45A940(Font, 当前窗, -2, 0); 清 bit30 }`
   * ＝ **把在飞的逐字显现立刻收尾（整段贴出）并清 bit30**。
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
   * (mask & 0x20) != 0          → 跳过整个悬停/推进段（右键走 20365 的"取消/跳读"通路）
   * 或 (mask & 滚轮键位) != 0 且 Engine[388220] >= 0 且 Conf(set:ReDrawTextOnKey) == 1 → 跳过
   * ```
   * 其余情况**都走悬停派发**（`sub_403E70`，20324）。
   *
   * ★消费点只有两处、都是**同一对调用**（`if (!hoverDispatchAllowed()) …; routes.nextHoverLabel()`）：
   * 产品路径 = `serviceAdvanceWait()`（本文件 `:994-995`）；测试 = `test/harness.ts` 的
   * `pickHoverLabel(e)` 门面。修前引擎上还挂着一个 `pickHoverLabel()` 方法（只被测试调用），
   * `tickets/T-0014` 把它删掉了 —— 引擎不该为测试保留产品路径不走的方法。
   */
  hoverDispatchAllowed(): boolean {
    // `(mask & 0x20)` = 鼠标**右**键（`sub_477150` 的 bit5）⇒ 右击时整段悬停/推进被跳过。
    if ((this.input.flushPending() & 0x20) !== 0) return false;
    const cfg = this.config;
    const wheelUp = cfg ? cfgInt(cfg, CFG.setWheelKeyUp, 0) : 0;
    const wheelDown = cfg ? cfgInt(cfg, CFG.setWheelKeyDown, 0) : 0;
    const wheelBits = (1 << (wheelUp & 31)) | (1 << (wheelDown & 31));
    if ((this.input.flushPending() & wheelBits) === 0) return true; // 滚轮键没按 ⇒ 悬停
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

