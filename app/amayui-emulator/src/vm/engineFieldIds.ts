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
   * 还是 `sub_40FB60` 的**入口停靠闸**（raw 18966 `if (!_this[429752])`）：置位时脚本队列不派发。
   * ★0x1F5 只在**本格原值为 1** 时才清它（raw 25224-25227）；原值为 0 时连"写 0"都不发生。
   */
  frameTickLock: 107438,
  /**
   * **帧计数 / 锁深度**（`_this[107439]` = **byte 429756**）：0x1F4 累加、0x1F5 递减（raw 25200-25234）。
   * `<= 0` 是 0x1F5 解锁路径的第一道门（raw 25221-25222）。
   */
  frameCount: 107439,

  // -------------------------------------------------------------------------
  // 「重显示（回退）游标」（`0x7B` 写 / `0x199` 读；frame.ts）
  // -------------------------------------------------------------------------
  /** 主回退点基址（`+cur`）：值 = 指令的 **dword 偏移**（不是数组下标）。 */
  rewindMainBase: 122372,
  /** 备用回退点基址（`+cur`）。 */
  rewindAltBase: 122412,
  /**
   * **「正在重画」模式字**（`_this[122452]` = 字节 489808；位 `0x4000000`：已有主回退 / `0x2000000`：用备用；raw 14001-14166）。
   *
   * ★2026-09（`tickets/T-0167` 的 §4.2 #1）：这一格**不只有 `0x199` 会写** —— 引擎 ADV 泵
   * `sub_411BC0` 的右键「取消/跳读」路由（raw 20369）写的是**同一形状** `_this[489808] = effect_flags | 0x6000000`
   * （与 raw 20872-20876 的 `0x4000000` 分支逐字同形），读者仍是 `0x7C`（`handlers/frame.ts`）。
   * ⇒ 这一族三格（本格 / `redisplayReturn` / `redisplayScriptId`）**同时服务重显示与右键取消两条机制**。
   */
  redisplayMode: 122452,
  /** 重画完成后要跳回的**下一条指令的 dword 偏移**（★右键取消路径**有意不写**：见 `#cancelRoute` 的登记）。 */
  redisplayReturn: 122453,
  /**
   * **文本回卷方向**（`_this[122454]` = 字节 489816；`0x2C0`…`0xFA` 一族的近邻格）。
   *
   * 写者 = ADV 泵的滚轮回看分支（`src/vm/engine.ts` 的 `#textRewindWheel`，raw 20348 `= -1` /
   * raw 20357 `= +1` / raw 20360 `= 0`）；读者 = `#serviceAutoMessage`（raw 20378-20383：
   * 非 0 ⇒ 停自动翻页计时器）⇒ 不是死写。
   */
  textRewind: 122454,
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
  /**
   * **脚本派发中**标志（`_this[124350]`，byte 497400）：置位时 `queueScript` 只入队不立即派发。
   *
   * 读者：`0xD9`（`handlers/engine-fields.ts`，raw 24946）、`sub_40FC90`（raw 19024）、
   * **`0x1F5` 的派发门**（raw 25226 `v2 = (497400 == 0)`，→ `handlers/frame.ts`）、raw 31556。
   * 写者（`handlers/control.ts` 的 `setDispatching`，本票 T-0157 前**一个都没有** ⇒ 死键）：raw 18149
   * 构造清 0 / 18980 `sub_40FB60` 装载置 1 / 25176+25187 `0x143` 入队循环 / 25667 `exit` 的 -10 收尾。
   */
  dispatchInProgress: 124350,
  /**
   * 派发前保存的 `effect_flags`（`_this[95779]`，byte 0x5D88C；`0xD9` 清同位）。
   *
   * ★**这一格在 emulator 有两份表示**（`tickets/T-0161` 读体后登记）：
   *  - **活槽** = `Engine.dispatchSavedFlags`（`vm/engine.ts`）：`control.ts:382` 存、`:373` 取回
   *    （`exit` 的 -10 收尾把 `effect_flags` 还原成它）—— 唯一的真存取点；
   *  - **本常量** = `engineValues[95779]`：只有 `0xD9`（`handlers/engine-fields.ts`）读写，
   *    `test/op-a5.test.ts:176-189` 用**裸数字 95779** 手工种值把它钉住了。
   *  ⇒ `0xD9` 现在**两份都清**（否则"派发中"那一支只清了没人读的那一份）。
   *  理想形态（需改 `control.ts` + 重定向 `op-a5.test.ts`，不在本票可写路径内）：活槽改读
   *  `engineValues[95779]`，本常量成为**唯一存储**，`Engine.dispatchSavedFlags` 撤掉。
   */
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
  /**
   * 脚本可读写的引擎运行开关（`_this[174812]` = 字节 699248）：`0x142`（`sub_422930` raw 31020-31027）写。
   *
   * ★构造/复位默认 **1**（审计 `0x142 missing-behavior`，`tickets/T-0161`）：引擎构造 `sub_415640`
   * raw 22591 与整体复位 `sub_40DF10` raw 17961 都是 `*(_DWORD *)(_this + 699248) = 1;`。
   * **emulator 未建模**（`Engine` 构造与复位在 `vm/engine.ts`，不在本票可写路径内）⇒ 在 `i142 1`
   * （`src/CONFIG.txt:354`）之前读到的会是 0。
   *
   * ★该格全库只有 4 处引用：写（raw 31026）、构造/复位（raw 22591/17961）、以及**导出给脚本的
   * 布尔查询** `sub_4765C0(){ return *(_DWORD *)(dword_55E1BC + 699248) != 0; }`（raw 91057-91061，
   * 工程内零调用）⇒ 没有 opcode 形式的读者，emulator **不编消费者**（审计 `0x142 missing-consumer`）。
   */
  scriptEngineFlag: 174812,
  /** 引擎通用布尔寄存器（`_this[166965]`）：`0x21B` 写 / `0x247` 读。 */
  engineBool: 166965,
  /**
   * **DrawMode**（`_this[166964]` = byte 667856）：`== 1` ⇒ D3D 路径（`0x32` 的 StretchTexture、
   * `0x1AE`/`0x1AF` 的 `.STH` 截图分支都按它分岔）。`0x201`（`sub_4302B0` raw 39859-39863）读回。
   *
   * ★写者订正（`tickets/T-0161`，审计 `0x201 missing-behavior`）：旧注释写"writer 未在反编译里显形"
   * 是错的 —— 引擎有 4~5 个写点：构造 raw 23572-23574（`*(a1 + 667856) = GetConfig(aSetDrawmode)`）、
   * 主循环/复位后 raw 35271-35273（同形、无条件）、清零点 raw 17979、脚本端 `0x200`/`sub_423170`
   * raw 31372（带 `set:CreateObject` 位门，不满足时报 `aComsetdrawmode` 且不写）。
   * emulator 侧的**生产者** = `engineConfig.ts` 的 `CONFIG_FIELD_BINDINGS` 里 `set:DrawMode` 那条
   * （本票补上）；另有 `engine.ts` 的 wait-gate 直接读配置（口径不统一，见该处注释）。
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
  /**
   * 默认消息窗索引（引擎 `_this[21631]` = `Font+1228`；`win` 参数为 0 时取它）。
   * 初值 1（raw 78899 `*(_DWORD *)(_this + 1228) = 1;`），解析规则 raw 73148-73152。
   *
   * ★**这一格的建模在 `MsgWindow.defaultWin`（唯一真源，`tickets/T-0101` 的 D5）** ——
   * 本常量只保留"引擎字段 id"供 raw 对照；不要再把它当第二个存储（历史上 `0x80` 同时写两处，
   * 导致 `i080` 之前两处初值不同：`msgwin.defaultWin = 1` vs `engineValues[21631] ?? 0`）。
   */
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
  /**
   * 消息态显示模式（`_this[92379]`）：1 = 影片（`0x25A`，raw 33193）、2 = 图像（`0x25B`，raw 33211）。
   *
   * ★`0x25B` 的 `= 2` 曾经**漏写**（审计 `0x25b missing-operand-io`，`tickets/T-0161`）⇒ 模式位停在 0；
   * 现由 `handlers/engine-fields.ts` 的 `FieldStoreSpec.constWrites` 补齐（与 `0x25A` 对称）。
   * ★这一格在 emulator 目前**没有消费者**：引擎的 `sub_4A5470(Scene, id)` 下发（raw 33198-33201 两条门）
   * 属宿主媒体子系统（与 `0x25A` 同一缺口），登记在 `tickets/T-0161/changes-c161.md`。
   */
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
  /**
   * **主字体 LOGFONTA 模板的 lfWeight**（`_this[21636]` = `Font+1248` = 模板基址 `Font+1232` + 16）。
   *
   * `0x2BD`（`sub_426200` raw 33393-33399）在真/假支里**与 `fontWeight` 同时**写 700 / 0；
   * 模板基址 `Font+0x15200`（raw 24064 的 `Font+1232` 就是它的 `lfHeight`）⇒ 这一格是"下一次
   * 建 HFONT 用的字重"。重写侧没有 GDI 句柄层（见 `text/fontSet.ts` 的 `GDI_FACE_REBUILD_NOT_MODELED`）
   * ⇒ 值照写、按 `analysis` 口径可核对（审计 `0x2bd`/`0x2be` 点名的"第二个字重格"）。
   */
  logfontMainWeight: 21636,
  /**
   * **注音 LOGFONTA 模板的 lfWeight**（`_this[21651]` = `Font+1308` = 模板基址 `Font+1292` + 16）。
   *
   * ★审计工作清单把它写成 `_this[21327]`：那是**错的**（`21327 * 4 = 85308` 与 `Font+1308` 无关）；
   * 体里写的是 `*(_DWORD *)(v1 + 1308)`（raw 33414/33419，`v1` = `_this + 21324` = Font 基址）
   * ⇒ Engine 下标 = `(21324*4 + 1308) / 4 = 21651`。
   */
  logfontRubyWeight: 21651,
  /**
   * **主字号的竖排模板 `lfHeight`**（`_this[46817]` = `Font+101972`）：`0x75`（raw 24065）
   * 与 `0x1A5`（raw 41399）都写 `-字号`，与横排的 `logfontMain`（`Font+1232`）成对。
   */
  mainLfHeightVertical: 46817,
  /** 主字号派生态（`_this[21633]` = `Font+1236` = 模板基址 +4）：`0x75` 写 `字号 / -2`（raw 24068）。 */
  mainGlyphHalf: 21633,
  /** 同上竖排版（`_this[46818]` = `Font+101976`；raw 24069）。 */
  mainGlyphHalfVertical: 46818,
  /**
   * **注音字号的 4 格派生态**（`0x197` raw 24109-24112 / `0x2FE` raw 41623-41627 —— 同一批格）：
   * `rubyLfHeight` = `Font+1292` = `-注音字号`、`rubyGlyphHalf` = `Font+1296` = `注音字号 / -2`；
   * `*Vertical` 是竖排模板（`Font+102032` / `Font+102036`）。
   * ★C 的整数除法**向零截断**（15 / -2 = -7）⇒ 重写侧必须 `Math.trunc`，不许 `Math.floor`。
   */
  rubyLfHeight: 21647,
  rubyGlyphHalf: 21648,
  rubyLfHeightVertical: 46832,
  rubyGlyphHalfVertical: 46833,
  /** 逐字/字格游标（`_this[107704]`；`0x72` 清零、帧循环 `(k+1) % 模数`）。 */
  charCursor: 107704,
  /** 逐字/字格循环模数（`_this[107705]` = `0x73` 的 op9）。 */
  charModulus: 107705,
  /** `0x1CE` 的显现开关记账（`_this[107706]`）。 */
  charModeArg: 107706,
  /**
   * **ADV 自动翻页的「行基准」**（`_this[122464]` = 字节 489856；`0x2E9`（`sub_426620` raw 33584-33586）写）。
   *
   * 引擎的**两个**消费点（两处公式不同，`tickets/T-0161` 读体后订正）：
   *  ① `handlers/msgwin.ts` 的 `armCoexistAutoMessage`（raw 28556-28586）与 `vm/engine.ts` 的
   *     `#autoMessageInterval`（raw 20384-20399 / 28568-28581）：
   *     `ms = (该窗文本行数 − 1 − 本字段) × message:AutoMessagePitch{0,1} + message:AutoMessageTime{0,1}`，
   *     再 `if (ms <= 100) ms = 100` 交 `sub_453A60`/`sub_453BD0`；
   *  ② raw 20416-20426（等待泵 `sub_411BC0` 的另一支）：`if ((message:AutoMessageOption & 1) == 0) {`
   *     `if (!_this[490004])`（下标 122501）`{ v20 = sub_407F20(Font, _this[489484]) - _this[489856]; …`
   *     `sub_453A60(…) } return; }` —— **不减 1**（`行数 − 本字段`），且被 `122501`（语音忙碌）门控。
   *  复位：raw 17987 清 0。
   *
   * ★**键名订正**：这两处用的是 `message:AutoMessagePitch0/1` + `message:AutoMessageTime0/1`
   *   （引擎字符串见 raw 4309-4313），外加开关键 `message:AutoMessageOption`。**没有**
   *   `message:AutoMessageSpeed` / `message:AutoMessageMinTime` 这两个键 —— 旧注释把它们当键名，
   *   会误导后续按不存在的键去接消费端。
   *
   * ★emulator 现状：① **已实现**（`tickets/T-0151` 落地 ⇒ 本字段不再是"只写不读"）；② 仍未实现
   *   （`122501` 在 emulator 是已知缺口、恒 0 ⇒ 那一支不可达，见 `vm/engine.ts` 的 `#serviceAutoMessage`）。
   *   守卫：`test/engine-fields-t0161.test.ts` 的"生产读者棘轮"（读者被删即红）。
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
  // 纹理槽族（handlers/gfx-texture.ts；`tickets/T-0153` 的 VM 半边）
  // -------------------------------------------------------------------------
  /**
   * **按槽号的「表面释放门」基址**（`_this[slot + 11676]` = 字节 `4*slot + 46704`）。
   *
   * 引擎读点只有一处：`sub_49E980`（`0x1FA` release-texture 的内核，raw **119591**）——
   * `if ( !_this[a2 + 11676] ) { _this[5*a2 + 466] = -1; 析构并置 0 _this[a2 + 10614]; }`
   * ⇒ 这门把"擦槽记录"与"销毁 CTexture 表面"**两件事一起**罩住（门关 ⇒ 两件都不做）。
   * 批量清理路径（raw 19381 / 35310：`for (i = 0; i < 1000; ++i) sub_49E980(...)`）也走同一道门。
   *
   * ★**写者未在反编译里显形**（全库搜 `+ 11676` 只有 raw 119591 这一个读点；
   * 该门表在构造里被清零 —— 与 `dword_55052C` 那类"脚本可配但写点偏移不同"的字段不同，这里连
   * 写点都没有）⇒ emulator **默认 0**（= 门常开，与修前行为逐字节相同），需要复现"门关"时由
   * 测试/宿主经 `engineValues` 注入。**不许**把它当"不存在"而省掉门（省掉就静默丢了引擎的一个分支）。
   */
  surfaceReleaseGate: 11676,

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
  /**
   * 语音通道音量因子**值**基址（`_this[21321..21323]`）。
   * 引擎：`0x2FF`（`sub_426940` raw 33728-33740）写 `[21318+ch]=1` + `[21321+ch]=op2`（预备）；
   * `0x302`（`sub_426A30` raw 33767-33777）写 `[21318+ch]=0x10000` + `[21321+ch]=op2` 后下发。
   */
  voiceChannelFactorValueBase: 21321,
  /**
   * 语音开关运行态（`_this[21293]` = 字节 85172）。
   * 引擎：`sub_408E20`（`0x1BA op1=3` 的语音支）写 1/0；`0xC4`/`0x1BD` 末尾读它决定是否置
   * `voiceRegSingle`（raw 29910-29911 `if ( _this[21293] ) _this[122501] = 1;`）。
   */
  voiceEnabledField: 21293,
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
  /**
   * `0x1C9` 的 **op1 = 音频驱动 id**：引擎 `sub_4B8490(Engine+7912, id, 数据, 大小)` 把它写进
   * **驱动对象**的 `_this[2179]`（raw 140301；装载失败写 −1，raw 140306）。换算到**引擎 dword 下标** =
   * `(7912 + 4*2179) / 4` = **4157**（模块基址 `Engine+7912`）。重写侧没有驱动层 ⇒ 本工程把这一格
   * 记进引擎字段表（审计 P3 `0x1c9 missing-consumer`，票 `T-0152`）。
   */
  audioDeviceDriverId: 4157,
  /**
   * 语音通道 **pan** 的设备格基址（`设备[375 + ch]`，byte 1548 + 4·ch）。
   *
   * 引擎：`0x2F8`（`sub_4268D0`）把钳制后的 op2 经 `sub_4B6940(设备, ch, pan)` 写进这一格，
   * 之后 `sub_4BBAB0`（排队起播）读 `设备[387+ch]`（= 375 + 12 + ch，语音设备通道是 12..14）
   * 把它当下发 pan。⇒ 本工程把这一格落进 `engineValues`
   * （票 `T-0152` 的 P3 `0x2f8 missing-operand-io`）。
   */
  voicePanBase: 375,

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
