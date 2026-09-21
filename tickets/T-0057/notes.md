# T-0057 notes —— amayui-emulator 实现审计（全量发现清单）

> 范围：`app/amayui-emulator`（`src/vm/**`、`src/frame/**`、`src/renderer/**`、`src/arch/**`、`src/text/**`、
> `src/audio/**`、`src/live2d/**`、`src/script/**`、`src/tools/**`、`src/run.ts`、`src/report.ts`、
> `electron/**`、`control/**`、`tools/*.cjs`），以及必要处对照 `engine/天结_unpacked.exe_utf8.c`（raw）与
> `docs-new/03-engine/opcode-table.md`。
>
> 方法：五个只读审计分头通读（VM 核心 / opcode handler / 渲染宿主 / 入口与工具 / 支持子系统）+ 本会话的
> 机械扫描（裸字段下标统计、无 importer 模块、重复函数名、死写、`catch {}`、`process.argv` 解析点）。
> 每条给出 `path:line`、证据、问题、以及**应该怎么建模**。标 `SUSPECTED` 的是审计未坐实、需要复核的。
>
> 状态列：`本轮`= 在 T-0057 里实施（见 `changes.md`）；`后继`= 已定位但本轮不做（需要行为变更或跨子系统）。

---

## 0. 结论摘要（为什么这些问题值得单开一票）

不是零散缺陷，而是四类**同型病**，每一类都能在本仓找到 5+ 个实例：

| 类 | 病征 | 为什么危险 |
|---|---|---|
| **A 多处真源** | 同一个引擎事实存在 2~3 份（一个引擎格 + 一个强类型视图、一个字段 + 一个镜像 Map） | 靠人工同步，已发生静默漂移；哪一份是"事实"没有编译期答案 |
| **B 魔法下标/键混用** | `_this[K]`（dword）与 `_this+N`（字节）两套口径混用；配置键手打字符串 | 键写错**不报错**，只是恒读默认值/恒假；已实测出真 bug |
| **C 临时补丁** | "先让它跑通"的常量 0、floored 取模、猴补宿主、只在注释里说明的探针 | 缺失表现为"不报错、只表现不对"，正是三层台账要防的那类 |
| **D 重复实现** | 同一逻辑在 2~3 处各写一遍（boot 装配、LZSS、cfg 取值、宿主能力、裁剪几何） | 改一处漏一处；守卫只覆盖其中一条路径时永远不会红 |

---

## 1. 类 A：同一语义多处真源

| # | 位置 | 证据 | 正确建模 | 状态 |
|---|---|---|---|---|
| A1 | `renderer/pixiBackend.ts:174`（`sceneDirty`）vs `renderer/scene/state.ts:20`（`SceneState.dirty`） | `sc*` 全都会置 `scene.dirty`，**Pixi 一次都不读**（全文件只有私有 `sceneDirty`，由 ~25 个方法手工 `#markDirty()`）；`state.ts` 注释自认"pixi 有自己的 sceneDirty，本轮不动" | 单一真源 = `SceneState.dirty`；宿主只实现 `consumeDirty()`（pixi 在 present 末、headless 在 snapshot），删 `sceneDirty`/`#markDirty` | 后继 |
| A2 | `renderer/pixiBackend.ts:543` `drawCgNumber` 等 7 个方法 | 建了可绘制项（`scDrawCgNumber` 置 bit0）却**不标脏**（`commitGraphics`/`clearTransitions`/`setDrawModeBlock`/`setDrawEntryParam`/`setMeshEntryAttr`/`set3DColor` 同） | 随 A1 统一：脏位只能由共享层置，宿主不得手工标记 | 后继 |
| A3 | `renderer/pixi/presenter.ts:136` `advanceWindows` | 共享层 `scAdvance`（由驱动 `advanceModel` 调用）**已经**推进过；presenter 再跑一遍 ⇒ 渲染路径二次执行模型状态机（会锁存 `animStart`、窗末 `work←target`） | 求值器只做纯读：把 `winPhase` 的锁存移出求值路径，或提供只读 `phaseAt()`；删 presenter 的推进 | 后继 |
| A4 | `renderer/headlessScene.ts:590` / `headlessFrameHost.ts:16-23` | 共享脏位只在 `host.present?.()` 里被消费（`loop.ts:366`），而 headless 宿主**没有 present** ⇒ 一旦变脏 `needsRender()` 永为真（与 T-0008 修掉的 pixi `waitFlags` 镜像同型） | 把"消费"显式化（`FrameHost.consumeDirty?()`），或 headless 提供 `present = 出快照`；`needsRender` 不承担消费语义 | 后继 |
| A5 | `vm/handlers/gfx-state.ts:50-53`（`e.gateWaitStart/gateWaitMs` + `engineValues[92338/92339]`） | 同一等待计时器存两处；到期时只清前者、不回写 engineValues ⇒ `engineValues[92339]` 是只写不读的死镜像（文档还谎称报告读 `Engine[92339]`） | 二选一：搬进 `engineValues` 并让 `gatePending` 读写它，或删镜像并改注释 | 后继 |
| A6 | `vm/handlers/msgwin.ts:1223`（`engineValues[122466+win]` + `MsgWindow.gates`） | 窗显现闸门双真身；`Engine[122486+win]`（完成时刻）只在清窗时被写 0，真值在 `gates.doneAt` ⇒ `FIELD_WIN_REVEAL_DONE` 是死键 | `MsgWindow.gates` 做成引擎格的强类型投影（getter/setter 直读写 `engineValues`），或反向委托；`doneAt` 落回 `122486` | 后继 |
| A7 | `vm/handlers/msgwin.ts:1031`（`engineValues.set(21631, win)` + `msgwin.defaultWin`） | `resolveWin()` 读 `msgwin.defaultWin`，而 `defaultWin(e)`（语音/文本项记账）读 `engineValues[21631]` ⇒ **两处现在就可能给出不同窗号**（`test/adv-msgwin.test.ts:838` 只写 engineValues 就断言记录进窗 8） | 单一真身 = `engineValues[FIELD_MSG_DEFAULT_WIN]`，`MsgWindow.defaultWin` 改委托 | 本轮 R2（命名 + 单一入口）；视图合并后继 |
| A8 | `vm/handlers/msgwin.ts:1144/1152/1174/1182` vs `vm/msgwin.ts:264-282` | 字体样式在 `engineValues` 与 `msgwin.font` 两处存，**覆盖面不同**：字号/字重成对写，面名只写 `msgwin.font`，竖排只写 `engineValues[80101]`，`msgwin.font.vertical` 永不更新（回退分支是死码） | 把 `FontStyle` 定义成纯投影（getter 读 engineValues，字体面解析在读取侧做），或全部只写 `msgwin.font` 并由 getter 派生 | 后继 |
| A9 | `vm/route.ts:157-171` | `RoutePanel` 既写相对格又写绝对格（同一格两遍）；`#shown/#closePending/...` 5 个本地镜像在生产路径只写不读；`engineValues[258]` 只在 reset 写 0，与 `entries.length` 不一致 | 构造强制注入 sink（测试注入 `Map`），删本地镜像；`[258]` 由 `entries.length` 投影 | 后继 |
| A10 | `vm/engine.ts:146-149`（`callRet/callLink/callFlag`） | `callRet` 与 `Frame.caller` 同义且无读者；`callLink/callFlag` 从无写入者；`Frame.arity` 零引用 | 删三格，"当前调用层"唯一收敛到 `Frame.caller`；需要观测就做只读 getter | 后继 |
| A11 | `vm/handlers/frame.ts:112-118` vs `engine.ts`/`control.ts` | `REWIND_MAIN_BASE/REWIND_ALT_BASE` 是本地同名常量，另一处（engine）又有 `TEXT_BASE_GATE` 等；同一字段空间分散在 `engineValues`/`advFields`/`Engine.globalSlot97058`/专用对象 | 统一到 R2 的 `ENGINE_FIELD` 表 + 有类型视图；删负键（见 C11） | 本轮 R2（表）；存储合并后继 |
| A12 | `src/frame/scenario.ts:249` vs `renderer/app/session.ts:44` | 产品批上限 10000 复制到 frame 层（注释自认"避免循环依赖"）⇒ 录制/回放批上限可能不同（T-0002 记录过帧边界错位） | `PRODUCT_FRAME_POLICY` 移到 `src/frame/productPolicy.ts`，session/scenario/renderer 共用 | 后继 |
| A13 | `renderer/pixi/presenter.ts:265` vs `renderer/scene/snapshot.ts:230` | L2D 摆放尺寸两个来源（`this.viewW/H` vs 固定 `VIEW_W/H`），只在恰好都用默认值时 digest 可比 | 显示尺寸入共享模型（`SceneState.display`）或删 `create()` 的尺寸参数 | 后继 |
| A14 | `renderer/headlessScene.ts:114-118` vs `renderer/pixi/textureCache.ts:69-77` | 纹理槽表（slot→imgid/程序化/逻辑尺寸/mode）两宿主各一份；共享层只拿到 mode | `SceneState.slots` 做唯一表，宿主只提供"取 Texture/画布 + 像素操作" | 后继 |
| A15 | `renderer/scene/state.ts:42` `msgRanges` | 是 `msgWinSync` 输入的**陈旧副本**：清窗时不清、后续 sync 不带 `itemRanges` 也不覆盖 ⇒ 之后任意 `detachTexture` 命中旧区间会清掉**新**文本 | 区间随内容原子化（放进 `TextFrame.ranges`），`scMsgWinClear` 一并删 | 后继 |
| A16 | `vm/msgwin.ts:352-355`（`skipMirror` vs `skipMode`） | 同一概念两份镜像，写入端同时写、清除端同时清，读端分裂（`engine.ts:591` 读 mirror、`msgwin.ts:371` 读 mode） | 确认引擎里是否真是派生关系后合并成一份 | SUSPECTED |
| A17 | `renderer/app/session.ts:305-330` | 手搓 observer 合并，只把 12 个事件里的 5 个转发给附加观察者（`mergeObservers` 就在旁边） | 改用 `mergeObservers(mine, dynamicExtra)` | 后继 |

## 2. 类 B：魔法下标 / dword-vs-byte / 裸键

| # | 位置 | 证据 | 正确建模 | 状态 |
|---|---|---|---|---|
| B1 | `vm/handlers/frame.ts:43-47` | `engineValues.get(429756)` / `set(429752, 0)` 把**字节偏移**当 dword 键；raw `sub_41A0E0` 是 `*(_DWORD*)(_this+429756)` = dword **107439**，与 `sub_41A090` 的 `_this[107439]/[107438]` 同一格。实测：`i1f4` 累加 107439、`i1f5` 减的是幽灵键 ⇒ 停靠锁永不释放、引擎时钟字段冻在第一帧 | 用 dword 下标 `107439/107438`；并统一命名（R2） | **本轮 R3** |
| B2 | `vm/engineFieldIds.ts:12` + 68 处 `engineValues.get/set(<数字>)` | 命名表只落 8 个常量、其中 4 个零引用；裸数字键散布 frame(22)/msgwin(16)/engine-fields(16)/audio(12)/… | 升格为 `ENGINE_FIELD` 常量表（语义 + 写者/读者），全量替换；守卫防新增 | **本轮 R2** |
| B3 | `configRegistry.ts:23` + `vm/engine.ts:594/1091` + `vm/handlers/audio.ts:136` | 权威键表存在却无人校验：`set:keepmusicvoice`（raw 0 次，真键 `set:KeepMusicVolume` raw 4411、判据 `== 1`）、`set:cancelmessagekey`（真键 `set:CancelMesSkipOnClick` raw 4346、比较 `== 2`）、`set:controldisibiecursor`（真键 `set:ControlDisibleCursor` raw 4348）⇒ 三条配置分支恒走默认值 | `CFG` 键常量由键表生成，`cfgInt/cfgStr` 只收常量；静态守卫扫字面量 ⊆ 键表 ∪ 动态白名单 | **本轮 R1** |
| B4 | `vm/handlers/engine-fields.ts:107,398,...` 表行注释 | 注册表行注释与实现/文档相反（`0x21E` 写"÷256"实现是 /100；`0x8B` 写"第三色"实为行间距；`0x23D/0x32B` 保留已被否定的"停靠标志"） | 表行只留 `{opcode, handler}` 数据，语义理由留在 handler doc；加"doc 里的 sub_xxxx == canonical handler"守卫 | 本轮 R2（部分）；守卫后继 |
| B5 | `src/opcodes.ts:19` | canonical `scripts/asm/opcodes.json` 的 `handler`/`status` 被丢弃 ⇒ 注释里的 `sub_xxxx` 全靠人工誊写、无机器校验 | `OpcodeDef` 增 `handler/status`；`test/opcode-registry.test.ts` 对账三表 ⊆ 表 + doc sub_xxxx | 后继 |
| B6 | `vm/handlers/arithmetic.ts:25` | `op_mod = ((l%r)+r)%r` 是 floored modulo，与注释/`opcode-table.md:81` 的 C 截断语义相反（`-5 % 3` 应为 -2，实现给 1）；`div/mod` 除零静默、`random` 却抛 | `op_mod = l % r`；三条共享 `intDiv/intMod` 集中声明除零策略 | **本轮 R4**（取模）；除零策略本轮标注 |
| B7 | `vm/engine.ts:21-42` | `effect_flags` 位词表一半有名一半裸字面量（`0x400`/`0x100000`/`0x800000`、输入掩码 `0x10/0x20/0x50/0x40`） | 集中导出 `WAIT_GATE_ANIM`/`READ_TEXT_SKIP_ACTIVE`/`PANEL_SHOWN`/`MASK_MOUSE_*` 等 | 本轮 R2 附带（在 R2 表里同时给位常量）；全量后继 |
| B8 | `renderer/pixi/appSetup.ts:31` vs `textureCache.ts:83` vs `textLayer.ts:70` | DPR 三处三口径（stage 不封顶、纹理/文本封顶 2）⇒ 3× 屏上直绘/文本被放大 1.5×（"糊/像粗体"类观感） | 单点 `viewport.ts` 的 `renderScale()`，三处都调；上限策略一处说明 | 后继 |
| B9 | `vm/handlers/gfx-misc.ts:44` | `engineValues.set(-248, v)` 负键表达"非 _this 全局"，**全仓无 get(-248)**（死写；闸门 C 只扫 renderer 模型，扫不到） | 删负键机制；专用全局槽做成有类型视图；扩展死写扫描到 engineValues | 后继 |
| B10 | `renderer/pixiBackend.ts:101` | `CELL_LAYER = 10_000_000`（字格图标层序）与其它层序常量分散 | 层序入共享模型/单一常量模块（见 D13 的 `layerOfFrame` 同理） | 后继 |
| B11 | `src/tools/deadWrites.ts:300`、`run.ts:254`、`report.ts:439` | 三套"是否直接执行"判定（`.endsWith('deadWrites')` vs 路径相等） | 单一 `isDirectRun(metaUrl)` helper | 后继 |
| B12 | `renderer/pixiBackend.ts:1083-1097` | `installD3DBlendModes` 通过 `as unknown as` 猴补 Pixi 私有 `blendModesMap`，失败即静默回落（`'none'`→Pixi 内置 = 画黑，注释自己写了会整屏黑） | 收进 `PixiBlendRegistry` 适配器；注册失败要可观测（抛/记 status） | 后继 |

## 3. 类 C：临时补丁 / 静默错值

| # | 位置 | 证据 | 正确建模 | 状态 |
|---|---|---|---|---|
| C1 | `vm/handlers/engine-fields.ts:44` | 0x106/0x201 挂在 `NATIVE_OPS`（= "已实现"）却 `v = 0` 伪造；canonical 明写 `Engine[550]` / `Engine[166964]`（raw 39043/39862） | 与 `ENGINE_FIELD_STORE` 对称的 `ENGINE_FIELD_GET` 表；无依据的 getter 一律抛 `NotImplementedOp`，不写 0 | **本轮 R4** |
| C2 | `vm/handlers/stubs.ts:22-47` | `stubSubsystem` 的 7 个 case 全死（0xB4/0xBF/0xC4/0x1FB/0x1F9/0xCD/0xC8 都已转真实现），唯一活的 0x308 落到 default 且不读 op1（文档说读 op1、写 `_this[1954]`） | 删 switch；0x308 变显式数据行（读 op1 建模 1954，或登记缺口并抛） | **本轮 R5**（删死分支） |
| C3 | `vm/handlers/save-slot.ts:301` | 无画布时**发明** `AMYTH1\n{json}` 自描述缩略图块并在读侧兼容自己的格式；两处 `catch { return 2; }` 吞 I/O 错 | 按引擎写空 BMP 或明确返回"打不开"+登记缺口；`catch (err)` 记录原因；`readU32` 复用 `saveSlot` 导出 | 后继（涉及存档兼容，需一次性迁移决策） |
| C4 | `audio/audioEngine.ts:463-471` | BGM 文件名取不到时"退回按统一 id 再试一次"——同文件 `:66-67` 刚把这条解释记为"标题 BGM 放错"的根因 | 删该分支，失败即静音 + 一条日志；曲号→文件 id 的唯一解析点固定在 `musicTables` | 后继（会暴露真实缺口，需重录守卫期望） |
| C5 | `tools/gameStartChain.ts:284-293` | 运行时猴补宿主 `scene.setVertexColor/setVertexColorAlpha`，只为抓"脚本写入那一刻"的 mesh 色（窗末烘焙后读不到） | `MeshObj` 增 `writtenState0/writtenState1`（由 `scSetVertexColor*` 写，不参与烘焙），快照直接读；删劫持 | 后继（会动 digest 字段） |
| C6 | `vm/engine.ts:1164` `forceAdvance` | headless 专用放行**不压返回点**，以"某条 E3 现象"为依据与引擎 `sub_405360(_this,0)` 分叉 ⇒ headless 与产品两条控制流 | 复用 `dispatchWithReturn(label, 0)`；差异在宿主侧表达 | 后继（需先证实 E3 可复现） |
| C7 | `vm/handlers/msgwin.ts:144` | `antiAlias: true` 硬编码覆盖配置门与字段 21662（字段被写、消费者否决） | 由配置/字段驱动，或明确登记为"刻意偏差 + 理由 + E4 依据" | 后继（T-0035/T-0042 有背景） |
| C8 | `vm/handlers/msgwin.ts:1196` `g.vPad` / `:718` `advEnter` / `:622` `charModeArg` | 建模了但无人读（`0x260` 的引擎语义是**全局** `Font+235112..235124`，却挂到"写入时刻 defaultWin"的 geom 上，窗口切换即归属错） | 改为全局字段并接消费，或明确"不建模"+登记台账；扩展死写扫描到模型字段 | 后继 |
| C9 | `src/script/bin.ts:172-176` | 注释承诺"记警告"，代码无告警通道；表外 opcode 一律 `argc=0` ⇒ 操作数被当指令继续解析、整条流错位而不报错 | `parseScriptBytes` 返回 `problems[]` 或抛 `UnknownOpcodeError`；未知 opcode 不猜 argc | 后继（需先确认 opcodes.json 无缺口） |
| C10 | `src/script/bin.ts:124` | v5 分支把表全填 0 却返回"成功"的 ScriptBinary（`dataArrayEnd = headerLen` ⇒ 一条指令都不解析）；5 个字段零读点 | v5 显式抛 `UnsupportedScriptVersion`；删无人读字段 | 后继 |
| C11 | `vm/interpreter.ts:112-145` | `formatOperands`/`significantOperands` 的 `catch` 注释各自成立（诊断不抛），但这是"取不到值就当平凡"的静默降噪 | 保持（判据已在注释里），但把"解码失败"计一个可见计数 | 不改（记录） |
| C12 | `renderer/scene/ops.ts:124-130` | `detachTexture` 用"区间相交 ⇒ 整窗清空"的粗近似（引擎只删区间内的行 DrawItem）⇒ 部分区间被删时真机只少几行、这里整窗抹掉，且未标注近似 | 模型保存每行的 itemId，按 id 落在 `[handle,hi)` 逐行移除 | 后继 |
| C13 | `renderer/pixiBackend.ts:99/684-715/819/923-927` | 撤幕"留帧"启发式（`HOLD_MAX_FRAMES=60` + 满屏 mesh 猜测 + alpha 判据）完全落在 Pixi 宿主，headless 无对应物 | 把"backbuffer 不清屏 ⇒ 保留上一帧"建模为共享策略，或让 Pixi 保留上一张合成结果而非跳过 present | 后继 |
| C14 | `renderer/scene/blend.ts:142-192` | 实验开关 `leakStateAcrossEntries`（产品从不开启）为已被证否的"状态泄漏"读法保留整套状态机与测试分支；三处注释与实现相反 | 删选项（或移到 test fixture），修正注释 | 后继 |
| C15 | `src/emulatorOptions.ts:119-126` vs `:148-229` | normalize 与 parse 各自实现同一套校验（`isResourceVersion`、非空 path）⇒ 新增选项要改 4 处 | 一份 spec 表驱动 parse+normalize | 后继 |
| C16 | `src/report.ts:211` | `ReportOptions.maxStepsPerFrame`（4096）与驱动同名项（写死 1）是两个量级；CLI 从不设置外层 | 改名 `reportBoundarySteps` 或在 CLI 暴露 | 后继 |
| C17 | `vm/handlers/frame.ts:41` | 0x1F5 计到 0 时引擎还调 `sub_40FB60` 派发队列；emulator 只清停靠标志（注释自认未接线） | 接上 `dispatchNextRequest`（与 `0x143` 已建模的队列同一处） | 本轮 R3 顺带注释订正；接线后继 |

## 4. 类 D：重复实现

| # | 位置 | 证据 | 正确建模 | 状态 |
|---|---|---|---|---|
| D1 | `src/tools/scenarioBoot.ts:63` 已建好，但 `config1Chain.ts:296`/`gameStartChain.ts:230`/`report.ts:212`/`run.ts:103`/`boot.ts:45` 各自装配 | 6 份"读 INI/选项/存档/音乐表 → 建 Engine/宿主 → loadScriptData"，子步骤**已漂移**（两份 chain 不装 SAVE.DAT ⇒ E3 永远跑 INITCONFIG 支；report 不读 INI；只有 boot/scenarioBoot 做全套） | `bootHeadless` 成唯一装配入口（显式开关 `system/saveData/audio/...`），各入口删自带装配；`boot.ts` 只留渲染独有部分 | 后继（最大杠杆，但会移动 E3 起点） |
| D2 | `renderer/app/session.ts:552-561` | 暂停态手写每帧服务序列（serviceWinReveal/serviceCharGrid/audio tick/advanceModel/present），文件头却写"不许在这里重新长出帧序" | 驱动加 `paused`/`gates:'hold'` 档，用同一份 `runFrameLoop` 跑服务帧 | 后继 |
| D3 | `config1Chain.ts:424` vs `gameStartChain.ts:742`（第三份在 `test/save-slot-chain.test.ts:143`） | 两份"虚拟时钟 + FrameHost + runFrameLoop"适配器已漂移（后者多 `gates` 与 `initialScript`）⇒ config1 的 ADV 分支脚本切换漏报 | `frame/` 提供 `createFixedClockHarness(...)`，内部维护 `initialScript` | 后继 |
| D4 | `src/renderer/headlessFrameHost.ts:3` | 声称"只有这一份"，实际 4 个入口各自内联 `const host: FrameHost = {...}`，只有 scenarioBoot 用它 | 全部改调 `headlessFrameHost(scene, () => clock)` | 后继 |
| D5 | `src/script/lzss.ts:78` vs `src/vm/lzss.ts:22`（工具链第三份 `scripts/alf/lzss.mjs`） | 同一 Okumura LZSS 两份拷贝；`script` 版还留 `(dat as any).state = 0` 残留与零引用 `N/F/THRESHOLD` | 收敛成一份（建议 `src/script/lzss.ts`），删 vm 版与残留；工具链复用同一算法 | **本轮 R5** |
| D6 | `src/arch/nodeFileSource.ts:97-112` vs `electron/ipc/files.ts:46-58` | "防丢键棘轮"两处各写一遍（IPC 侧本可直接调 `fileSource.saveConfig`） | 单一实现留在 `NodeFileSource.saveConfig`，IPC 只转发；拒绝原因可上报 | 后继 |
| D7 | `vm/handlers/audio.ts:149-155` vs `resource-usage.ts:45-49` vs `engineConfig.ts:64-70` | 三套 INI 取值语义不同（`"0x10"`→16 / 回落 / 特判 `"0"`） | 只保留 `engineConfig` 的 `cfgInt/cfgStr/cfgBool/cfgEquals`，handler 一律 import | **本轮 R4** |
| D8 | `src/arch/overlay.ts:94-101` vs `:119-126` | `read()`/`readSync()` 两份已经漂移（一个有 miss 日志、一个没有），且都把 `EACCES/EIO` 当"不存在" | 抽 `readFirstAvailable()`；只吞 `ENOENT`；失败原因可诊断 | 后继 |
| D9 | `src/script/alf.ts:84-92` vs `:189-195` | TOC 布局算两遍（`parseMusicTables` 重走一遍游标） | `parseSys4Toc` 返回 `endOffset`，音乐表从它起读 | 后继 |
| D10 | `src/script/alf.ts:152-164` vs `src/arch/nodeFileSource.ts:306-316` | 同一条"文件 id → 条目"判据两遍，失败语义相反（null vs throw），测试各覆盖一条 | 判据下沉成纯函数，类版只负责把 `missingPack` 翻成异常 | 后继 |
| D11 | `vm/saveData.ts:123-131` vs `:417-425`（+ `saveSlot.ts:75`） | 同义 ANSI 读函数三份；"本工程格式/引擎格式"两套解析器（写侧恒写 `trailerDwords`、读侧"够长就吃"、文档说不写） | 一个 `parseTables(data, {engineLayout, format})` + 复用 `util/bytes.decodeAnsi` | 后继 |
| D12 | `src/vm/saveData.ts:562-572` | 头块两个 CRC 读出后 `void` 掉（看起来校验了其实没有） | 真校验或删变量 + 写明理由 | 后继 |
| D13 | `tools/config1Chain.ts:351` vs `tools/diagText.ts:24-25` vs `renderer/pixi/textLayer.ts:32` | 消息窗层序回退式 `20+win` 三份；唯一导出实现被 pixi 绑定，Node 工具无法 import | `TEXT_LAYER_BASE/layerOfFrame` 移到纯模块，textLayer 反向 import，工具删本地公式 | 后继 |
| D14 | `src/tools/config1Chain.ts:709` vs `:737` | 两个滚动条三段几何函数逐字重复（后者只是把 base/offs 写死） | 删 `collectScrollThumb`，改调 `collectThumbAt(...)` | 后继 |
| D15 | `src/tools/live2dMoc.ts:49` vs `live2dStruct.ts:19` | `walk()` 逐字重复；两者无 npm script；`Bad.trace` 只是 message 的复制 | 合并 `live2dProbe.ts` + npm script；接真 trace 或删字段 | 后继（R5 只删探针里的残留错误？） |
| D16 | `src/frame/host.ts:48` `texturesIdle` | 声明 + wrapHostClock 转发，但**驱动从不调用**；真相在 `session` 的 present 里 | 删接口成员（注释写明"屏障归 present"）或在驱动真 await | 后继 |
| D17 | `src/script/lzss.ts:17-19` `N/F/THRESHOLD`、`live2d/deform.ts:71/169`、`moc.ts:598`、`text/fontSet.ts:132/141/144`、`arch/systemPaths.ts:65` | 零引用导出/常量簇（`SAVE_SUBDIR` 与 `SLOT_DIR`/`SAVE_DAT_REL` 三份 'SAVE'） | 删零引用导出；目录常量收敛到 `vm/saveSlot.ts` 的 `SLOT_DIR` | **本轮 R5**（保守清单） |
| D18 | `src/tools/t0042c-colors.ts` | T-0042 的一次性探针留在 `src/`（无 import、无 script），会被 tsc 编进 dist | 删除（需要复算就落成测试断言或 `.tmp/`） | **本轮 R5** |
| D19 | `src/renderer/pixiBackend.ts:182/878` `#l2dDrawnKeys` | 只写不读（注释声称"绘制侧据此只画这些节点"，实际 presenter 另算） | 删字段；要诊断就交给 log/digest | 后继 |
| D20 | `src/tools/gameStartChain.ts:299/439-440/533-538` | `clock`/`harness` 死变量 + `void` 假装使用；`pumpFrames` 算完丢弃 | 删死变量；`pumpFrames` 真接进 result 或删赋值 | 后继 |
| D21 | `src/vm/handlers/engine-fields.ts:121/143/95/290` | `0x107` spec 是死码（该 opcode 注册的是专用 handler）；`field < 0` 分支唯一读者是它；`after` 钩子无人用；`ENGINE_FIELD_STORE` 键与 `ENGINE_FIELD_OPS` 行逐条重复 | 删死 spec/分支/钩子；OPS 由 STORE 的键生成 | 本轮 R2（表结构合一）；死码删除本轮 |
| D22 | `vm/handlers/engine-fields.ts:20-27` vs `strings.ts:113` 段头 | 0x148/0x149 的说明挂在 `strings.ts` 的悬空注释下，实现在 `engine-fields.ts` | 说明搬回实现处；删悬空注释/段头 | 本轮 R2（注释整理） |

## 5. 类 E：死码 / 假注释 / 分层

| # | 位置 | 证据 | 正确建模 | 状态 |
|---|---|---|---|---|
| E1 | `vm/handlers/control.ts:319` `ScriptReset` | `grep "new ScriptReset" src/` = 0：`op_exit_script` 改 `c.jump(0)`，该信号永不抛；`frame/loop.ts:218` 与 4 个测试仍在捕获 | 删除类、再导出与 reset 分支（或把"exit-script 是控制转移"写进 `ExitScript` 注释） | **本轮 R5** |
| E2 | `src/frame/host.ts:7`、`observer.ts:13`、`loop.ts:156` | 注释引用不存在的 `frameLoop.ts`、`mkObserverHooks`、`mkObserverNest`（驱动是**直接双调用**） | 改成事实描述 | **本轮 R7** |
| E3 | `renderer/renderer.ts:12-16`、`loop.ts:31/78/134`、`configBoot.ts:128` | 5 处注释描述已被后续 ticket 改掉的旧行为（B4 未完成 / run.ts 关着 charGrid / session 自己发音频 tick / loadEngineConfig 会提前 return / "四张"遥测表） | 逐条订正 | **本轮 R7** |
| E4 | `src/vm/handlers/strings.ts:113`、`save-slot.ts:373`、`msgwin.ts:319`、`gfx-state.ts:135-137`、`script/bin.ts:243` | 悬空注释/段头；防摇树的自我再导出；`winStyle` 别名（注释自认待删）；`const e = c.e; void e;` | 删悬空注释；收敛导出面 | **本轮 R5**（保守：只删明确的悬空注释/void） |
| E5 | `renderer/pixiBackend.ts:108-123/231-238/921` | 构造期 `null as unknown as Application`/`presenter!`；`present(nowMs?, waitFlags=0)` 的 waitFlags 只用来打一行日志；`#clockInjected` 分支实际不可达 | stage 依赖注入、删 `!`；`present()` 无参；诊断走既有 log 通道 | 后继 |
| E6 | `renderer/scene/ops.ts:15` | 共享场景层 `import { assertFlags } from '../../vm/native.js'`（**值**导入），与 snapshot 自述的"vm → renderer，不反向"矛盾 | 把 flag 校验挪进 `scene` 自己的契约模块，或明确记录该依赖 | 后继（与 T-0021 去重后决定） |
| E7 | `renderer/scene/ops.ts:702-722` | `scSetSlotParams` 在 `applied===0` 时返回 `'created-gated'` 但**没建任何项** ⇒ headless 的 `ensure.createdGated` 计数与缺口事件语义失真 | 返回一个诚实的 outcome（`'gated'`），或真的建项 | 后继 |
| E8 | `renderer/headlessScene.ts:233/305-315` | `createTexture` 每次都记"未生成位图"（该语义 headless 其实已建模）⇒ 缺口清单被正常操作稀释；`#takeTexSize` 槽匹配失败时取队首（把**别的槽**尺寸喂给脚本） | 缝隙分流：区分"宿主能力缺口"与"headless 正常操作"；尺寸答案按槽匹配并显式记 miss | 后继 |
| E9 | `src/vm/saveSlot.ts:122`、`decodeSlotState` 的 `catch { return null }` | 引擎版本串硬比 `460B`，别版本一律 `code 2`；catch 把"状态块损坏"当"没有状态块" | 版本判据与错误分类显式化 | 后继 |
| E10 | `renderer/scene/state.ts:76-114` `render4` | 15 个子字段只 3 个被渲染消费；`entryParams` 复制同一次 op 的入参；是 dead-write ratchet 的盲区（只扫顶层字段） | 拆 `SceneState`（被消费的状态）+ `SceneTrace`（报告事件流），删影子位置 | 后继 |
| E11 | `src/arch/fileSource.ts:35-105` | 20+ 方法的上帝接口，全部可选 + `?.()` 静默降级 ⇒ 无法区分"宿主不支持"与"文件不存在" | 拆成 `ResourceSource`/`PlayerDataStore`/`ScriptSource` 三个窄接口，构造期报一次缺能力 | 后继（大） |
| E12 | `src/vm/saveData.ts:47-51` | `format = 0` = "本工程明文格式"塞进引擎从不会写 0 的字段；遇到 format 0 的引擎存档会被误解析 | 显式 layout 判别标记，不复用引擎字段 | 后继 |
| E13 | `tools/shot.cjs:55-72` vs `tools/config1Chain.ts:47` vs `gameStartChain.ts:65/70` | 点击坐标在 .cjs 里复制一份（无法 import TS）；`getContentSize()[0]===1280` 猜窗口 | 坐标常量单一来源（生成 JSON 或 shared 模块） | 后继 |
| E14 | `src/frame/digest.ts:107` + `scene/snapshot.ts:311` | digest 路径 `buildFrameDigest → scSnapshot → calcDiffuse` **会推进并改写共享模型** ⇒ `--record` 开着时模型时间线可能与不录制时不同 | snapshot 只读（提供只读求值），窗末收尾只发生在 `scAdvance` | SUSPECTED（高价值，需先复现） |
| E15 | `src/frame/digest.ts:181 vs :202` | `diffEngineDigest` 比较 `nowMs`，而 `engineDigestEqual` 完全不看 nowMs ⇒ "帧时钟不同"可能被判相等 | 两个判据的口径对齐 | SUSPECTED |
| E16 | `src/text/layout.ts:470-493` | `pairRuby` 用 `line.text.indexOf(base)` 配对，同一行同词出现两次会挂到第一处 | 按入队顺序配对（引擎 push 顺序） | SUSPECTED |
| E17 | `src/arch/nodeFileSource.ts:287-296` | `#readArchiveSlice` 不循环短读（`fh.read` 短读即静默截断） | 循环到读完或报错 | SUSPECTED |
| E18 | `src/live2d/render.ts:129-131` | `l2dNodeTransform` 恒单位阵 ⇒ 0x347–0x34D 的变换是只写状态 | 真消费 `scale/translate/wins`，或删字段并登记缺口（T-0054 内） | 后继（归 T-0054） |
| E19 | `src/live2d/mtn.ts:60` vs `render.ts:44` | `LAYOUT` 解析了从不消费，且两处对缺省值说法矛盾（`x:0,y:0` vs "X=1024/Y=512"） | 二选一：接进摆放，或删解析；两处口径合一 | 后继（归 T-0054） |
| E20 | `src/live2d/render.ts:95/105/175`、`mtn.ts:233-243`、`runtime.ts:116-120` | `mulColor`/`cullNone`/`pendingMotionNo` 算了没人用（`pendingMotionNo` 的"消费"是立即清空） | 接进 presenter/snapshot，或删字段 + 登记缺口 | 后继（归 T-0054） |

**未列入上表、但审计给出的低置信/小瑕疵**（记录备查，不单列）：
`src/report.ts` 的 `--ops` 与 `control/control.ts` 的 opcode 白名单是两份解析器（`"6e 1fb"` 在 report 里整串变 NaN 被静默丢弃）；
`src/frame/trace.ts:184` 的 `+8` 魔法余量；`session.ts:44` `MAX_STEPS=100_000_000` 与驱动 cap 语义重叠；
`session.ts:539` 同一句日志双通道；`src/tools/saveDump.ts:5` 用法注释写 `node xx.ts`；
`boot.ts:70` 对旧 preload 的 `?.` 兼容残留；`control/control.ts:137` 恒真条件；
`electron/windows.ts:37/59-71` 与 `windowPlacement.ts:26` 的 TITLEBAR/1280/720 重复；
`electron/preload.ts:87-91` 用 env 在 preload 载入期决定 API 值；`src/tools/scenarioBoot.ts:111` 函数内动态 import；
REPO_ROOT 派生 13 处、3 种基准（建议单一 `src/arch/repoRoot.ts`）。

---

## 6. 本轮实施 vs 后继

**本轮实施**（acceptance R1–R7，逐条证据见 `changes.md`）：
- R1 配置键单一真源 + 3 个幽灵键修正 + 静态守卫（类 B3 / D7 的一半）
- R2 引擎字段 `ENGINE_FIELD` 表 + 68 处裸字面量清零 + 死 spec/分支清理（类 B2/B4/D21/D22）
- R3 `0x1F5` 字节/dword 混用修正（类 B1）
- R4 `0x106/0x201` 读真字段、`op_mod` C 语义、cfg 取值统一（类 C1/B6/D7）
- R5 删临时物与死码：`t0042c-colors.ts`、LZSS 双份合一、`ScriptReset`、stubs 死 switch、零引用导出/悬空注释（类 D5/D17/D18/E1/E4/D20 的一部分）
- R6 `ticket-ledger.test.ts` 预红修复 ⇒ `npm run verify` 全绿
- R7 文档同步（`emulator-refactor-plan.md` §9、`emulator.md`、opcode-table 订正）

**后继（已定位、本轮不做）**：A1–A5、A8–A17；B5/B8–B12；C2（0x308 语义）/C3–C16；D1–D4、D6、D8–D16、D19；E5–E20。
其中**最高杠杆**是 D1（6 份 boot 装配收敛，顺带吃掉 D4/D13 的一半）与 A1–A4（脏位/present 单一真源）。

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

本票是一次跨层审计的落点：结论与逐条 proposed model 见 notes.md（全部发现，含未在本轮实施的后继项），设计决策见 design.md，实施记录见 changes.md。
