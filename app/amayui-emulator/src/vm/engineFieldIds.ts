/**
 * **引擎字段注册表**（`Engine.engineValues` 的键 = 引擎 `_this[K]` 的 **DWORD 下标** K）。
 *
 * ## 为什么必须有这张表（T-0057 R2）
 * `engineValues` 的键是裸数字时有两个后果，且都**不报错**：
 *  1. 无法 grep 语义（同一字段在十个 handler 里各写一遍字面量）；
 *  2. **下标空间会混**：引擎反编译里同时存在 `_this[K]`（dword 下标）与 `*(_DWORD *)(_this + N)`
 *     （**字节**偏移）。两者相差 4 倍，误用后只是"读写了一个不存在的字段"。
 *     实测事故：`0x1F5` 用字节 `429756/429752` 当键，与 `0x1F4` 的 dword `107439/107438` 不是同一格
 *     ⇒ 帧计数只增不减、停靠锁永不释放、时钟字段冻在第一帧（详见 T-0057 的 R3）。
 *
 * ## 硬纪律
 * - **键恒为 dword 下标**。raw 里读到的 `*(_DWORD *)(_this + N)` 必须先 `N / 4`；
 *   表里对这类字段同时写出两个数（注释里），便于与反编译对照。
 * - 新增字段**必须**先进本表（带语义 + 写者/读者 + 依据），handler 里**不得**再出现裸数字键
 *   （守卫 `test/engine-field-ids.test.ts` 会拦）。
 * - 语义只写"能引到依据"的部分：`opcode-table.md` 行、raw 行号、或**本仓 handler 里已逐行核对过的注释**。
 *   不猜。
 *
 * 数据层对照：`analysis/fields.json`（字节偏移视角）。本表是同一批字段在**实现侧**的可 grep 名字。
 */

/** 引擎字段表：名字 → dword 下标。字段语义见下方分组注释。 */
export const ENGINE_FIELD = {
  // -------------------------------------------------------------------------
  // 帧循环 / 时钟（`src/vm/handlers/frame.ts`）
  // -------------------------------------------------------------------------
  /** 上一帧时钟（`_this[92334]`，byte 369336）：`clockPrev ← clock` 后写新值。0x1F4/0x20C/0x23C 维护。 */
  clockPrev: 92334,
  /** 动画时钟 ms（`_this[92333]`，byte 369332；= `fields.json` 的 Engine `clock` 0x5A2B4）。 */
  clock: 92333,
  /**
   * **帧计时停靠锁**（`_this[107438]` = **byte 429752**）：0x1F4 首次置 1，0x1F5 计到 0 时清 0；
   * 置位期间 0x1F4 **不刷新时钟**，主循环的绘制段也被它挡住（raw 20755/20838/20896）。
   */
  frameTickLock: 107438,
  /** **帧计数**（`_this[107439]` = **byte 429756**）：0x1F4 累加、0x1F5 递减（raw 25200-25234）。 */
  frameCount: 107439,

  // -------------------------------------------------------------------------
  // 「重显示（回退）游标」（`0x7B` 写 / `0x199` 读；frame.ts）
  // -------------------------------------------------------------------------
  /** 主回退点基址（`+cur`）：值 = 指令的 **dword 偏移**（不是数组下标）。 */
  rewindMainBase: 122372,
  /** 备用回退点基址（`+cur`）。 */
  rewindAltBase: 122412,
  /** 「正在重画」模式字（位 `0x4000000`：已有主回退 / `0x2000000`：用备用；raw 14001-14166）。 */
  redisplayMode: 122452,
  /** 重画完成后要跳回的**下一条指令的 dword 偏移**。 */
  redisplayReturn: 122453,
  /**
   * **进入重显示那一刻的帧脚本身份**（`_this[107678]` = 字节 430712；`0x199` 写、`0x7C` 读）。
   *
   * `0x7C`（`sub_41AB80` raw 25799）拿它与当前帧的脚本 id 比：
   * 不等就抛「Depth が不正です %s != %s」（两个名字由文件 id 反查）⇒ 这是**重显示调用的深度校验**。
   */
  redisplayScriptId: 107678,
  /** 输入状态位掩码（`_this[174802]`，byte 699208；`0x199` 开头清零，回答"这一轮消费了哪些输入态"）。 */
  inputStateMask: 174802,
  /**
   * **每帧的按键扫描游标**（`_this[cur + 122287]`；`0x100` 读写、`0xFF` 复位）。
   *
   * `0x100`（`sub_419AF0` raw 25029-25037）从本游标开始扫掩码里**最低**的置位 `b`，
   * 派发后写 `b + 1`；下一次进入 `0x100`（由它自己压的返回点）就继续往后扫
   * ⇒ **一次 `0x100` 的执行可以派发多个按键**（`ret` 回到 `0x100` 再扫）。
   * `b >= SetKeyTotal`（`Engine[517]`）时引擎直接返回、不派发。
   */
  keyScanCursor: 122287,

  // -------------------------------------------------------------------------
  // 读档 / 脚本派发（frame.ts、engine-fields.ts、save-slot.ts、engine.ts）
  // -------------------------------------------------------------------------
  /** 跨脚本返回目标（`_this[95777]`；`fields.json` 的 `call_ret`）。 */
  callRet: 95777,
  /** **正在读档**门（`_this[95780]`）：`0xAE` 的门控；读档装载置 1、收尾清 0。 */
  loadInProgress: 95780,
  /** 读档版本分支的收尾标志（`_this[97054]`，版本 2 的 `0xAE` 置 1）。 */
  loadDoneFlag: 97054,
  /** **脚本派发中**标志（`_this[124350]`，byte 497400）：置位时 `queueScript` 只入队不立即派发。 */
  dispatchInProgress: 124350,
  /** 派发前保存的 `effect_flags`（`_this[95779]`，byte 0x5D88C；`0xD9` 清同位）。 */
  dispatchSavedFlags: 95779,
  /** `0x1AD` 存的"当前帧深度"（`_this[166963]`；存档序列化用，语料 1100 处）。 */
  storedCur: 166963,

  // -------------------------------------------------------------------------
  // 启动/全局标志（engine-fields.ts、engine.ts、control.ts）
  // -------------------------------------------------------------------------
  /** LOGO/版权页开关（`_this[96983]`）：构造置 1，`exit-script` 置 0；`0x130` 读。 */
  logoEnabled: 96983,
  /**
   * **音乐运行态·当前曲 id**（`_this[174713]` = `Music[259]`，Music 模块内联在 `Engine+174454`）：
   * `0xC0` 读 / `0xC3` 写；`0xB7`/`0xB9`/`0xBF` 起播时由 `sub_489F80`/`sub_489C20` 写；`0xB8` 由
   * `sub_489B50` 清 0。★**不是**配置 `sound:Music`（那个在字节 699240 = 下标 174810）。
   * 存档把这一格写进镜像 `[2]`（raw 17469-17471）、读档装回（raw 19911），随后 `CALLBACK_LOAD.BIN:20`
   * 的 `i0b7 0`（0 = 重播当前曲）把它放起来 —— 见 `handlers/save-slot.ts` 的 `replaySavedBgm`。
   */
  musicField: 174713,
  /** **音乐运行态·循环位**（`_this[174715]` = `Music[261]`）：`sub_489F80`/`sub_489C20` 的第一个动作。 */
  musicLoopField: 174715,
  /**
   * **音乐运行态·暂停位**（`_this[174714]` = `Music[260]`）：`0xC1`（`sub_419770` raw 24837-24841）翻转它，
   * 并把**新值**经当前音源对象 `Music[269 + Music[258]]` 的 vtable+12（MusicBase 抽象槽 3 = `SetPause`：
   * `engine/…lst` 的 `MusicBase::vftable` 0x528B7C 起 10 个纯虚槽，`CD`/`MIDI`/`PCM`/`NoMusic` 各有实现）下发。
   *
   * 清 0 的写者（**只有 `0xC1` 会置 1**）：`sub_489B50`（`0xB8` 停播，raw 106186）、`sub_489F80`
   * （`0xB7`/`0xB9` 起播，raw 106365）、`sub_489C20`（`0xBF` 起播，raw 106240）。
   * ★**没有脚本读它**（`0xC0` 读的是 `Music[259]` 当前曲 id）—— 它是「宿主可听」的暂停闩锁，
   * 消费者 = `handlers/audio.ts` 的 `0xC1` → `{kind:'bgm-pause'}` → `renderer/audio/webAudioHost.ts`。
   */
  musicPaused: 174714,
  /** 显示模式（`_this[167990]`）：`display:ScreenMode` 填充；`0x2CE` 布尔化读。 */
  screenMode: 167990,
  /** 脚本可读写的引擎运行开关（`_this[174812]`）：`0x142` 写；构造/复位默认 1。 */
  scriptEngineFlag: 174812,
  /** 引擎通用布尔寄存器（`_this[166965]`）：`0x21B` 写 / `0x247` 读。 */
  engineBool: 166965,
  /**
   * **DrawMode**（`_this[166964]` = byte 667856）：`== 1` ⇒ D3D 路径（`0x32` 的 StretchTexture、
   * `0x1AE`/`0x1AF` 的 `.STH` 截图分支都按它分岔）。`0x201` 读回；writer 未在反编译里显形（疑似配置绑定）。
   */
  drawMode: 166964,
  /**
   * `0x106` 读的字段（`_this[550]`，raw 39043 `sub_42B4B0((int)_this, 1, _this[550])` 是**唯一**引用）。
   * 写入端未在反编译里显形 ⇒ 当前恒 0；但**必须按字段读**（不能像旧实现那样伪造常量 0），
   * 否则一旦定位到 writer，getter 不会跟着变。
   */
  engineField550: 550,

  // -------------------------------------------------------------------------
  // 消息窗 / 文本（handlers/msgwin.ts、handlers/text-items.ts、msgwin.ts）
  // -------------------------------------------------------------------------
  /** `message:MessageSpeed`（`_this[21668]` = `Font+1376`）：逐字节拍 ms。 */
  messageSpeed: 21668,
  /** 默认消息窗索引（`_this[21631]`，初值 1）：`win` 参数为 0 时取它。 */
  defaultWindow: 21631,
  /** 主字体模板（`_this[21632]` = `Font+1236` 的 lfWidth 邻位）：数字直绘的格宽回退来源。 */
  logfontMain: 21632,
  /** 填充色（`_this[21664]`；`0x76` 写，BGR→RGB）。 */
  colorFill: 21664,
  /** 描边/阴影色（`_this[21665]`；`0x77` 写）。 */
  colorOutline: 21665,
  /** 描边档位（`_this[21667]`；`0x78` 写）。 */
  outlineMode: 21667,
  /** **行间距**（`_this[21669]` = `Font+1380`；`0x8B` 写；换行步进 = 字号 + 本字段）。 */
  lineSpacing: 21669,
  /** 描边偏移 dx/dy（`_this[21670]/[21671]`；`0x1A4` 的 op2/op1）。 */
  outlineDx: 21670,
  outlineDy: 21671,
  /**
   * **字格图标目标分支**（`_this[21672]` = `Font+1392`；`0x1B1` 写）：
   * `== 1` ⇒ 跟随最后一条字记录的笔位（NOVEL 分支），否则用 `(op2+窗框x, op3+窗框y)`（ADV）。
   * ★`analysis/fields.json` 把同一偏移记作「第五色」，与本仓 `sub_45A940` raw 71349 的读法冲突
   * （见 T-0057 notes 的 SUSPECTED）。
   */
  followTextMode: 21672,
  /** 抗锯齿开关（`_this[21662]`）：配置/`0x2EE` 一族写入。 */
  aaEnabled: 21662,
  /** 竖排标志（`_this[80101]` = `Font+235108` bit0；`0x261` 写）。 */
  verticalText: 80101,
  /** `message:MessageFade` ms（`_this[80106]` = `Font+235128`；`0x2EE` 写）。 */
  messageFade: 80106,
  /** 消息系统配置（`_this[92323]`；`0x252` 写）。 */
  msgSystemConfig: 92323,
  /** `0x24E` 写的字段（`_this[92340]`）：语义未定位（写入端/读取端都只有这一条）。 */
  msgField92340: 92340,
  /** `0x10F` 写的字段（`_this[122369]`）：语义未定位。 */
  frameField122369: 122369,
  /** 消息态显示模式（`_this[92379]`）：1 = 影片（`0x25A`）、2 = 图像（`0x25B`）。 */
  mediaMode: 92379,
  /** 消息态影片 id（`_this[92380]`；`0x25A` 写）。 */
  mediaId: 92380,
  /** 消息态图像 id（`_this[92381]`；`0x25B` 写）。 */
  msgMediaImageId: 92381,
  /** 字体度量模式 0/1/2（`_this[71744]`；`0x2DB` 写）。 */
  fontMetricsMode: 71744,
  /** 主字号 px（`_this[71745]`；`0x75` 写）。 */
  fontSize: 71745,
  /** 注音字号（`_this[75970]`；`0x197` 写）。 */
  rubySize: 75970,
  /** 主字重（`_this[75953]`；`0x2BD` 写 700/0，走真 Bold 面）。 */
  fontWeight: 75953,
  /** 注音字重镜像（`_this[75971]`；`0x2BE` 写）。 */
  rubyWeight: 75971,
  /** 逐字/字格游标（`_this[107704]`；`0x72` 清零、帧循环 `(k+1) % 模数`）。 */
  charCursor: 107704,
  /** 逐字/字格循环模数（`_this[107705]` = `0x73` 的 op9）。 */
  charModulus: 107705,
  /** `0x1CE` 的显现开关记账（`_this[107706]`）。 */
  charModeArg: 107706,
  /**
   * **ADV 自动翻页的「行基准」**（`_this[122464]` = 字节 489856；`0x2E9`（`sub_426620` raw 33584-33586）写）。
   *
   * 引擎读点（raw 28569 / 28579 / 20420 / 13714 / 13720；复位 raw 17987 清 0）：
   * `v = (当前窗文本行数 − 1 − 本字段) * message:AutoMessageSpeed + message:AutoMessageMinTime`，
   * 再 `if (v <= 100) v = 100` 交给 `sub_453A60`/`sub_453BD0` 计时 —— 即"从第几行起算自动翻页时长"。
   * ⇒ **不是只写不读的死字段**（审计 `docs-new/03-engine/audit-2026-09-opcodes.md` 的 P0 `op-2-01`）。
   *
   * ★emulator 现状：自动翻页的**消费端尚未实现**（全库无 `message:AutoMessage*` 消费点）⇒ 本字段写入后
   *   暂时无人读；`tickets/T-0076` 把「自动翻页」记为缺口。值本身必须照写，否则将来接上消费端时基线会漂。
   */
  autoMessageBaseline: 122464,
  /** 每窗「逐行贴出」闸门基址（`+win`）：bit0 闸门、bit16 已被泵接管（`0x300` 写）。 */
  winRevealGateBase: 122466,
  /** 每窗贴完后延时清场 ms 基址（`+win`；`0x300` op3 写）。 */
  winRevealDelayBase: 122476,
  /** 每窗贴完时刻基址（`+win`）：泵记、用于延时判定。 */
  winRevealDoneBase: 122486,
  /** **文本项记账门**（`_this[97055]`）：`0x1BB` 写；非 0 时 `0x1D2` 等不记账。 */
  textBaseGate: 97055,

  // -------------------------------------------------------------------------
  // 跳读（快进）态（engine-fields.ts 的 0x1CF/0x1BF；audio.ts 的 play-bgm 读）
  // -------------------------------------------------------------------------
  /** 跳读态字段（`_this[122504]`；`0x1CF` 写、`0x1BF` 读位）。 */
  skipReadState: 122504,
  /** 「已进入跳读」标志（`_this[122503]`；`0x1BF` 置 1；唯一读者是 `play-bgm` 的 BGM 让路判据）。 */
  skipReadActive: 122503,

  // -------------------------------------------------------------------------
  // 门计时器（gfx-state.ts 的 0x238；engine.ts 的 serviceWaitGate）
  // -------------------------------------------------------------------------
  /** `0x400` 等待计时器起点（`_this[92338]` = `Scene+46520`）：0 = 未起步。 */
  waitTimerStart: 92338,
  /** `0x400` 等待计时器时长 ms（`_this[92339]` = `Scene+46524`）：0 = 没装。 */
  waitTimerMs: 92339,

  // -------------------------------------------------------------------------
  // 秒计时器（engine-fields.ts 的 0xAD；对象 = `_this+5191`）
  // -------------------------------------------------------------------------
  /** 上一秒 ← 当前秒（`_this[5450]`）。 */
  timerSecondsPrev: 5450,
  /** 当前秒（`_this[5451]`）。 */
  timerSeconds: 5451,
  /** `timeGetTime()/1000` 的定点近似结果（`_this[5449]`）。 */
  timerMsDiv1000: 5449,

  // -------------------------------------------------------------------------
  // 输入键表（engine-fields.ts 的 0xFE/0x107/0x10B；input.ts 的默认键槽）
  // -------------------------------------------------------------------------
  /** SetKeyTotal（`_this[517]`）：可配置键总数；同时是 `0x100` 空掩码时派发默认键的槽下标。 */
  setKeyTotal: 517,
  /** `0x107`（SetKey）的字段基址：`_this[op1 + keyTableBase] = op2`。 */
  keyTableBase: 551,
  /** `0x10B`（另一张键表）的字段基址：`_this[op2 + keyTable2Base] = op1`。 */
  keyTable2Base: 1383,

  // -------------------------------------------------------------------------
  // 音频（handlers/audio.ts、handlers/text-items.ts）
  // -------------------------------------------------------------------------
  /** 每通道语音"选择值"基址（`_this[5053 + ch]`；0x2F4 一族用）。 */
  voiceSelBase: 5053,
  /** 语音通道状态位基址（`_this[21315..21317]`；`0x2F7` 写、`0x1BC` 清）。 */
  voiceChannelStateBase: 21315,
  /** 语音通道音量因子基址（`_this[21318..21320]`；`0x2FF`/`0x302`）。 */
  voiceChannelFactorBase: 21318,
  /** 寄存语音槽单格（`_this[122501]`；`0xC4` 的 ADV 分支一族）。 */
  voiceRegSingle: 122501,
  /** 寄存语音槽基址（`_this[122505..122507]`；`0xC4` 写 id）。 */
  voiceRegBase: 122505,
  /** 寄存语音槽（第二组，`_this[122508..122510]`；`0xC4` 写标志）。 */
  voiceRegFlagBase: 122508,
  /** `0x1C9` 音频设备初始化字段（`_this[18656]` = op2）：设备/驱动层在重写侧无对应物。 */
  audioDeviceField0: 18656,
  /** `0x1C9` 音频设备初始化字段（`_this[18660]` = op3）。 */
  audioDeviceField1: 18660,

  // -------------------------------------------------------------------------
  // 面板（handlers/panel.ts、route.ts）
  // -------------------------------------------------------------------------
  /** 面板「已显示」标志（`_this[12957]`）：`0x94` 置 1、`0x93` toggle 清 0（route.ts 的 `ENGINE_SHOWN`）。 */
  panelShown: 12957,
  /** 面板「关闭已发生」标志（`_this[12956]` = route.ts 的 `ENGINE_CLOSE_PENDING`）。 */
  panelClosePending: 12956,
  /** 面板复位标志（`_this[12958]`；`0x91` 清）。 */
  panelResetFlag: 12958,
} as const;

// ---------------------------------------------------------------------------
// 兼容别名（T-0057 之前就存在的导出；新代码请直接用 `ENGINE_FIELD.*`）
// ---------------------------------------------------------------------------

/** @deprecated 用 `ENGINE_FIELD.messageSpeed`。 */
export const FIELD_MESSAGE_SPEED = ENGINE_FIELD.messageSpeed;
/** @deprecated 用 `ENGINE_FIELD.defaultWindow`。 */
export const FIELD_MSG_DEFAULT_WIN = ENGINE_FIELD.defaultWindow;
/** @deprecated 用 `ENGINE_FIELD.verticalText`。 */
export const FIELD_VERTICAL = ENGINE_FIELD.verticalText;
/** @deprecated 用 `ENGINE_FIELD.charCursor`。 */
export const FIELD_CHAR_CURSOR = ENGINE_FIELD.charCursor;
/** @deprecated 用 `ENGINE_FIELD.charModulus`。 */
export const FIELD_CHAR_MODULUS = ENGINE_FIELD.charModulus;
/** @deprecated 用 `ENGINE_FIELD.winRevealGateBase`。 */
export const FIELD_WIN_REVEAL_GATE = ENGINE_FIELD.winRevealGateBase;
/** @deprecated 用 `ENGINE_FIELD.winRevealDelayBase`。 */
export const FIELD_WIN_REVEAL_DELAY = ENGINE_FIELD.winRevealDelayBase;
/** @deprecated 用 `ENGINE_FIELD.winRevealDoneBase`。 */
export const FIELD_WIN_REVEAL_DONE = ENGINE_FIELD.winRevealDoneBase;
