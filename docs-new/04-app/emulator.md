# 04-app · amayui-emulator

用 **TypeScript + Electron + PixiJS** 重写《天結いキャッスルマイスター》的 AGE 引擎（脚本 VM + 场景合成 + 文本 + 音频），把 `engine/天结_unpacked.exe_utf8.c` 的逻辑以干净 TS 语义实现，替换原 Win32 调用为 H5/IPC，获得**可调试性、可观测性、可插件化与跨平台**。

> **本文件是 `amayui-emulator` 的架构总览**（分层/真源/闸门/缺口）。逐条 opcode 语义、字段偏移、脚本台账**不在**这里：
> 见 `../03-engine/`（真源是 `analysis/*.json`）与 `../../app/amayui-emulator/README.md`（实现细节与事故复盘）。
> ★历史提示：本文 2026-09 之前的内容已严重过期（当时写的是"M0–M3、`npm test` 12/12、停在消息循环、菜单派发表未解"），
> 现按代码实况重写。**凡本文与代码/台账冲突，以代码与 `analysis/*.json` 为准。**

## 1. 现状（2026-09 实测）

| 项 | 值 | 校验方式 |
|---|---|---|
| 测试 | **476 条** node:test | `npm test` |
| 类型 | 3 个 tsconfig 全干净 | `npm run typecheck` |
| 死写棘轮 | 基线 2 条（`Item.blend` / `MeshObj.blend`） | `npm run check:dead-writes` |
| 一条命令全绿 | `npm run verify` = typecheck + test + dead-writes | — |
| **帧驱动** | **唯一一份**：`src/frame/loop.ts`（`runFrameLoop`）—— Electron（`renderer/app/session.ts`）与全部 headless 入口都经它跑；宿主差异只能经 `FramePolicy`/`FrameHost` 显式表达 | `test/frame-loop.test.ts` |
| **两宿主等价** | `FrameDigest`（`src/frame/digest.ts`）：同 Scenario 两宿主产出同一 `engine` 段；**G3** = Electron 录、headless 复现（`npm run record` + `npm run replay`） | `test/frame-digest.test.ts`、`test/scenario-replay.test.ts` |
| opcode 实现表 | `OPS` **230** / `NATIVE_OPS` **50** / `ENGINE_INTERNAL_OPS` **14**（三张表**两两不交**，`test/registry-tables.test.ts` 守） | 代码 |
| 台账 | functions **460** 条 / capabilities **108** 条（已核验 27、部分 24、缺失 25、n/a 25、已建模未核验 7）/ scripts **23** 条 | `analysis/*.json` + 工具 `--summary` |

**链路覆盖**（`npm run op:inventory -- --path start`）：`SYSTEM4 → … → TITLE →（Game Start）→ GAMESTART →（ゲーム開始）→ INITGAME/SETFATE/… → SC0000 → SN0000 首文案`，
该路径**零未实现 opcode**；`npm run shot -- --gamestart` 产出实机对照截图（`.tmp/gs*-*.png`）。
**未实现 opcode 一律硬报错**（`NotImplementedOp`），不允许静默 no-op —— 这是本工程的第一原则。

## 2. 技术前提

- 引擎为 x86 32 位、未见 int64；JS `number` + 显式 32 位位运算（`|0`/`>>>0`/手写 ROL/ROR）可安全表达（ADR-006）。
- 引擎的全局 int 池存的是 `ENC(key, v)`、读时 `DEC(key, ·)`（key 每进程随机）⇒ 重写侧必须在**同一条读写路径**上做 ENC/DEC，不能"原样读"（见 §3.2）。

## 3. 架构

### 3.1 分层与依赖方向

```
┌─ electron/（主进程）───────────────────────────────────────────────┐
│  main.ts：窗口（内容区 1280×720）+ 脚本/图像/音频 IPC + 归档解析     │
│  （唯一能碰 Node fs 的地方；AGF/ALF 解码在这里做，结果以 RGBA/字节流下发）
└──────────────▲───────────────────────────────────────────────────┘
               │ IPC（IpcFileSource / image / audio-stream / log-line）
┌──────────────┴─ renderer 进程 ────────────────────────────────────┐
│                                                                   │
│  renderer/                     vm/                                │
│  ┌───────────────────────┐    ┌─────────────────────────────┐     │
│  │ scene/state.ts        │    │ interpreter.ts 单步派发      │     │
│  │  SceneState（唯一场景 │◄───┤ ops.ts OPS/NATIVE/INTERNAL   │     │
│  │  模型：drawItems/     │    │ handlers/*.ts 按族分文件     │     │
│  │  meshes/msgWins/...） │    │ engine.ts 引擎态（字段即事实）│     │
│  ├───────────────────────┤    │ msgwin.ts 消息窗/文本模型    │     │
│  │ scene/ops.ts（sc* 语义│    │ operand.ts/ref.ts 操作数+引用│     │
│  │  层，**两个宿主共用**）│    │ native.ts 宿主桥接口         │     │
│  ├───────────┬───────────┤    └──────────────┬──────────────┘     │
│  │headless   │pixi       │                   │ NativeBridge（可选方法）│
│  │Scene.ts   │Backend.ts │◄──────────────────┘                    │
│  │（Node 报告│+pixi/*    │                                        │
│  │ /测试）   │（WebGL）  │        text/（layout+raster+fontSet）  │
│  └───────────┴───────────┘        audio/（intent → WebAudio）     │
└───────────────────────────────────────────────────────────────────┘
```

**依赖铁律**（评审时按它判违规）：

1. `vm/` **不依赖** `renderer/`、`audio/`、DOM：它只认 `NativeBridge` 接口（`native.ts`），实现由宿主注入。
2. `renderer/scene/*` 是**两个宿主的唯一共享语义层**：`headlessScene.ts`（Node）与 `pixiBackend.ts`（WebGL）都只做"接线"，
   语义一律落到 `scene/ops.ts` 的 `sc*` 函数 —— 否则会出现"报告说 3 行、画面画 2 行"的漂移。
3. `text/`（排版/光栅化）与 `audio/`（意图 → WebAudio）不反向依赖 `vm/`；`vm/` 只通过桥与 `msgWinSync`/音频 intent 交互。
4. `electron/` 只做 OS 能力；**任何**引擎语义都不允许只活在主进程里。
5. ★`frame/` 是 **L1 帧驱动**（`tickets/T-0004`）：它**只认接口**（`host.ts` 的 `FrameHost`）与 `vm/*`，
   不得 import pixi/DOM/electron；"引擎每帧做什么"只有这一份。宿主能力（合成/门判据/音频泵/digest 输入）
   只在 L2（`pixiBackend.ts` / `headlessScene.ts`）实现；**宿主的渲染策略不得改变共享模型状态**
   （反例：pixi 的"帧保持"曾用过期时钟调 `calcDiffuse` ⇒ 给共享模型的动画窗锁了个早一帧的起点，G3 抓到）。
6. ★`frame/` 里也**不许**再长出第二份帧序：任何入口的差异只能经 `FrameLoopOptions`（门/批/时钟/错误策略）
   与 `FrameHost`（宿主能力面）显式表达 —— 这条是 `T-0001`..`T-0005` 全部工作的收敛点。

### 3.2 关键机制（每条都有源码依据，细节见 `../03-engine/`）

- **单步派发**：`interpreter.stepOnce` 读一条指令 → 查 `OPS → NATIVE_OPS → ENGINE_INTERNAL_OPS` → 未命中抛 `NotImplementedOp`。
  操作数读取集中在 `operand.ts`（`readIntOperand` 对 int 槽过 DEC；`readFloatOperand` 的立即数是 IEEE 位模式）；
  引用（指针/数组/lea）集中在 `ref.ts`（`Ref={scope,kind,index,stride}`，读解引用、写写穿）。
- **字段即事实**：引擎字段写进 `Engine.engineValues`（稀疏 `Map<number,number>`，键 = `_this[K]` 的 K）；
  有结构的那部分再建强类型视图（`Engine.msgwin` / `routes` / `textItems` / `agerc` / `texSlotFlags` …）。
  两者的关系是"字段是真源、视图是投影"，不允许只有视图没有字段。
- **场景模型**：`SceneState`（drawItems / meshes / msgWins / texSlots / render4 诊断袋）是**持久**的；
  指令只**配置对象**，`present()` 每帧按模型合成（引擎式"配置 + 每帧合成"，与指令流解耦）。
- **动画两套、正交**：DrawItem 用整数式 diffuse-alpha 窗（5 个窗共享起点）；Mesh 用浮点 `CalcDiffuse`
  （元素 2 自己锁存起点）。混用会让"背景先、文字后"的观感消失（见 `copyright-effect.md`）。
- **文本**：排版在 `text/layout.ts`（等宽网格、边界硬断、注音配对、**恒横向**、对齐=行中心/右缘、逐字游标），
  光栅化在 `renderer/text/raster.ts`（自绘，不用 `pixi.Text`），层序 = `20+win`；
  逐字两种节拍：普通消息 = "一步一字、时长 = 字数 × max(MessageSpeed, 一帧)"，**字格页**（`0x73`）= "一步一格、时长 = cells × op10"。
  ★**"这一帧能看见几个字"只有一处判决**：`MsgWindow.revealedOf`（所有发布者都走 `emitWin` → 它）。
  两条例外（未武装/未推进 ⇒ **0 字**而不是"全部"）：`0x300` 逐行泵、`0x73` 字格门 —— 引擎的字格页在 `0x72` 武装前**一个字都不贴**（`sub_45A940` 只在 `effect_flags & 0x40000000` 分支里被调用），
  而语料里 `i073` 与文本的顺序不固定（`SN0000.txt:1081` 页首 / `:1240` 页末）⇒ 判决写在各 op 里就会出现"一条判 0、下一条判全部"的裂缝（2026-09 用户实测"文字在逐字出现前完整出现"）。
- **宿主桥的"可选方法"语义**：`NativeBridge` 的方法全是可选的；**调用方一律 `?.`，闸门 A 记录"意图被丢弃"**
  （`nativeTap.ts` 的方法白名单 + 编译期穷尽检查）。
- **三闸门**（缺口可见性，`README.md` §488+ 有完整表）：A = 桥方法被调但宿主没实现；B = 能力台账缺口；
  C = 死写（模型字段写了没人读，基线 `dead-writes.baseline.json`）。**新增缺口必须登记**，不许静默。

### 3.3 权威源与生成物（**不要手改生成物**）

| 类别 | 真源 | 生成物 / 校验 |
|---|---|---|
| 函数/字段 | `analysis/functions.json`、`analysis/fields.json` | `report.js` 查询；`--validate` 自检 |
| 引擎常态能力 | `analysis/engine-capabilities.json` | `docs-new/03-engine/engine-capabilities.md`（`node scripts/build-capabilities.mjs`） |
| 脚本台账 | `analysis/scripts.json` | `docs-new/05-scripts/*.md`（`node scripts/build-scripts.mjs`） |
| opcode 助记符 | `docs-new/03-engine/opcode-table.md` | `scripts/asm/opcodes.json`（`build-opcodes.js`）、`src/vm/ops.ts`、`src/*.txt` |
| 引擎行为 | `engine/天结_unpacked.exe_utf8.c`（raw 行号基准） | — |
| **工作票据** | `tickets/<ID>/ticket.json`（+ 同目录任意多份手写过程文档） | `tickets/README.md`（`node scripts/build-tickets.mjs`）＋ `test/ticket-ledger.test.ts` |

工具（`.agents/skills/amayui-engine-analysis/scripts/`）：`report.js` / `capabilities.js` / `scripts.js`；
写入走工具（自动重算 counts），改完必须重跑 `build-capabilities.mjs`，否则 `test/capability-*.test.ts` 会红。

## 4. 目录结构（实况）

```
app/amayui-emulator/
├─ electron/            main.ts（窗口+IPC+归档）/ preload.ts（contextBridge）
├─ src/
│  ├─ vm/               interpreter.ts / ops.ts（三张表）/ engine.ts / msgwin.ts / operand.ts / ref.ts
│  │  └─ handlers/      control·memory·gfx-item·gfx-texture·gfx-state·gfx-cg·gfx-misc·msgwin·text-items·
│  │                    audio·frame·engine-fields·panel·agerc·stubs…
│  ├─ frame/            ★唯一帧驱动：loop.ts（runFrameLoop）/ host.ts（FrameHost）/ observer.ts /
│  │                    digest.ts（逐帧对外表现）/ scenario.ts（一份 Scenario 两宿主共用）/
│  │                    trace.ts（G3 录制-回放：TraceRecorder / runReplay）
│  ├─ renderer/         sceneModel.ts → scene/{state,ops,snapshot}.ts（共享语义）
│  │                    headlessScene.ts（Node 宿主）/ pixiBackend.ts（WebGL 宿主）/ headlessFrameHost.ts
│  │                    drawitem/（Item/Mesh 模型+窗+求值+setter）/ pixi/（presenter/textLayer/textureCache）
│  │                    text/raster.ts / audio/ / viewport.ts
│  ├─ text/             layout.ts（排版）/ raster 无关的纯函数 / fontSet.ts（面名→字体）
│  ├─ audio/            audioEngine.ts（intent 队列 + 墙钟推进）
│  ├─ arch/             fileSource / nodeFileSource / ipcFileSource / overlay / agf / alf / systemPaths
│  ├─ script/           bin.ts / alf / lzss / opcodes.ts
│  └─ tools/            report / opInventory / diagText / gameStartChain / config1Chain / deadWrites / saveDump
│                       scenarioBoot.ts（headless 启动装配）/ scenarioRun.ts（跑 Scenario）/ replay.ts（G3 回放）
├─ test/                476 条（含棘轮：registry-tables / game-start-chain / no-dead-writes / capability-* /
│                       script-ledger / frame-loop / frame-digest / scenario-replay / native-tap 宿主能力面）
├─ tools/               shot.cjs（G4 截图）/ record.cjs（G3 录制）/ boottime.cjs / scenarios/*.json
├─ build-electron.mjs（esbuild 打包）/ package.json / tsconfig{,.control,.electron}.json
└─ README.md            实现细节与事故复盘（**与本文互补，不重复**）
```

## 5. 关键 ADR（架构决策）

| ADR | 决策 | 现状 |
|---|---|---|
| 006 | 32 位语义显式化（`|0`/`>>>0`/手写 ROL/ROR） | ✅ |
| 009 | 派发表可替换 = 插件点 | 后置（当前是 `Map`） |
| 010 | 函数级状态追踪（每个原函数：已重写/已确认忽略 + 证据） | ✅ 并入三层台账 |
| 011 | 指针 = 带标记引用 `Ref`；读解引用、写写穿 | ✅ `ref.ts` |
| — | **两个宿主共用 `scene/ops.ts`**（消除"两份语义"） | ✅ |
| — | **未实现 opcode 硬报错**；未实现能力必须登记台账 | ✅ |
| — | **不要手改生成物**（台账 → md/JSON） | ✅ 有测试守 |

## 6. 渲染（Electron + PixiJS）

- 视口 1280×720；窗口 `useContentSize:true` + `setContentSize(1280,720)`；`autoDensity + devicePixelRatio`（CSS 1280×720、底层按 DPR 高清）。CSP 含 `unsafe-eval`（Pixi v8）+ `img-src`/`blob:`。
- **合成顺序 = 三路归并**（2026-09 订正）：draw-item 键 = `layer`、文本窗键 = `layerOfFrame`（`style.itemId > 0 ? itemId : 20+win`）、mesh 键 = `handle`，同键序 item→text→mesh —— 与引擎 `sub_4B06D0` 的"按 sort-key 归并两表"同构。
  ★旧文写的是"meshes 叠在其上"，那只是 LOGO 那一页的巧合：SN0000 的实际层序是 背景 `101000` → 淡入幕 `0x19258`(=`102488`) → 暗幕 `0x19640`(=`104000`) → 立绘 `104501+` → 文本 `105000`，把 mesh 一律压到最上就会整屏黑。
  `flags & 1` 是两条绘制门（DrawItem 由 `0x1FB` 置、Mesh 由 `0x320` 建几何置）——**空项不画**。
- **Mesh = 真实顶点四边形**：几何取自 `0x320` 的 x/y/z 浮点数组（屏幕像素），颜色 = 逐顶点基础色 × `CalcDiffuse` 插值态色。
  轴对齐四边形走 `Graphics.rect()`；★**不要用 `poly()` 一次喂 4 个条带序顶点**（Pixi v8 按顺序连点 ⇒ 自交成蝴蝶结 ⇒ 全屏大 X）。
  ★**可见色 = 顶点缓冲里那份**：`calcDiffuse` 在"无动画窗"时返回 **`state0`**（不是 `state1`）—— `0x322` 写完 state0 立刻以比例 0 刷 VB、`0x323` 只置窗与 state1 不碰 VB；返回 state1 会让"设色 → 开窗"之间透明一帧（SN0000 进场时背景闪一下）。
- **没有整屏 Clear**：引擎 present 不无条件清 backbuffer（`ClearTarget` 被恒 0 的守卫挡住）⇒ 撤满屏幕布后留帧（`pixiBackend.#holdFrameAfterCurtainDrop`）。
  ★**解除判据 = "新内容真的可见"**（`#releaseFrameHoldIfVisible`，读 **`state0` 的 alpha > 0**）：引擎里"建几何（`0x320`）"与"设色（`0x322`）"是两条指令，建项即解除会呈现一帧透明幕。上限 `HOLD_MAX_FRAMES=60`（≈1 秒），`0x1F6 clearDrawContainer` **续期**而不是解除。
  ★2026-09（`tickets/T-0004` 的 G3 实测）**判据不许调 `calcDiffuse`**：那个函数会给共享模型的动画窗**锁存起点**，而帧内宿主的 `clockMs` 还是上一帧的值 ⇒ Electron 的 `anim.start` 会比 headless 早一帧（插值色差 1/255，看起来像浮点噪声）。帧保持是**渲染策略**，不得改变引擎状态。
- 纹理：`set-texture` 在引擎里是**同步**读文件+解码；重写侧走异步 IPC ⇒ `0x1F9` 之后立刻 `await texturesIdle()`（`texture-frame-barrier`）。
  ★**绝不能在舞台还引用纹理时销毁它**（会把 WebGL 批次写坏 ⇒ 整屏只剩背景色且不再恢复，`README.md` §581）。
- `image(id)` IPC → `resolveEntry` → AGF 字节 → `decodeAgfRgba` → RGBA。无头/沙箱环境跑 Electron 需 `--no-sandbox`。

## 7. 命令

```bash
npm run verify         # ★提交前必跑：3×tsc + 476 测试 + 死写棘轮
npm test               # node:test
npm run run            # 无界面跑（tsx src/run.ts）
npm run report         # 场景执行报告（.tmp/<name>.{jsonl,json,txt}，txt 是人可读快照）
npm run op:inventory -- --path start   # 链路 opcode 盘点（含"路径上未实现"清单）
npm run diag:text      # 文本可见性诊断（为什么画面上没有字）
npm run shot -- --gamestart [--name X] # **G4** E4 自动截图（先 build:electron；★时序等日志标记，不睡固定秒数）
npm run scenario -- --scenario tools/scenarios/gamestart.json [--out X.jsonl]  # headless 跑一份 Scenario
npm run record -- --scenario tools/scenarios/gamestart.json --out X.jsonl.gz   # **G3 录制端**（Electron，真输入）
npm run replay -- X.jsonl.gz           # **G3** 把录下来的时钟+输入在 headless 复现，逐帧比 digest
npm run electron:dev   # build + 启动渲染壳
npm run save:dump      # SAVE.DAT 解析
```

### 7.1 ★闸门清单：改哪些文件必须跑 G3 / G4

**为什么要有这一张表**：Electron 无法在 CI 里跑（需要 GPU/窗口），所以"两宿主等价"只能靠**本地闸门**。
不写清"哪类改动触发哪个闸门"，就会出现"改了帧驱动却没跑 G3"这类**看起来全绿其实已经分叉**的状态。

| 你改了什么 | 必跑 | 判据 |
|---|---|---|
| `src/frame/*`（帧驱动/observer/digest/scenario/trace/host） | **G1**（`npm test`）+ **G3** + **G4** | G3 必须逐帧相等；G4 关键日志行不变 |
| `src/renderer/scene/*`（共享场景语义：`ops.ts`/`state.ts`/`snapshot.ts`） | **G1** + **G3** | 两个宿主都吃这一份 ⇒ 任何语义改动都会体现在 digest |
| `src/renderer/{headlessScene,pixiBackend,headlessFrameHost}.ts`（两个宿主的接线/宿主能力） | **G1** + **G3** + **G4** | 宿主侧副作用**不得**改变引擎状态（G3 就是这条的判据） |
| `src/renderer/app/session.ts`（产品的帧装配/观察者） | **G3** + **G4** | G3 顺带证明"产品的帧序 == headless 的帧序" |
| `src/vm/*`（VM/引擎态/opcode handler） | **G1** + **G3** | G3 会指出"从第几帧起、哪个字段不同" |
| `electron/*`（主进程/IPC/preload） | **G4**（起得来 + 关键行不变） | — |
| `src/audio/*`、`src/text/*`（宿主义务） | 对应单测即可 | 它们只影响 `FrameDigest.host` 段（不参与 G3 比较） |

- **G1 确定性**：`npm test`（同 Scenario 两次跑 ⇒ digest 逐字节相同）。
- **G3 回放等价**：`npm run record -- --scenario … --out X.gz && npm run replay -- X.gz`（**本地**；约 1 分钟）。
- **G4 观感**：`npm run shot -- --gamestart --name X` + 与上一份对照截图/关键行比对。
  ★**只有这几行是"关键行"**（逐条比对过，见 `tickets/T-0004/changes.md`）：`-> TITLE.BIN` / `-> GAMESTART.BIN` /
  `-> SN0000.BIN` / `gate 0x400 cleared|WAIT` / `=== text reveal done ===` / `=== ADV cleared … ===` /
  `[hover-label] …` / `=== advance-wait handled … ===`。
  **诊断量行**（`[present …]`/`[msgwin]`/`[reveal]`）随墙钟抖动：**同一份构建连跑两次**也会差 1–10 行
  （实测 67 vs 68 / 502 vs 511 / 329 vs 338），所以它们**不是**判据。

## 8. 外置选项 `emulator.config.json`（可选；测试/调试用运行开关）

- **它是什么**：仓库根的一个 JSON，**只影响"怎么跑"**，不改变引擎/脚本语义。
  **不是**游戏配置：绝不写回、不进存档（那是 `SYS4REG.INI`，见 `src/engineConfig.ts`）。
- **怎么开始用**：把入库的示例 `emulator.config.example.json` **复制**成 `emulator.config.json` 再改。
  ★`emulator.config.json` 是**本机私有**的（已 gitignore）——每个人的测试偏好不同，不该入库，
  也不该让"我改了它"变成"别人跑不过测试"（2026-09 由守卫误报发现并修正）。
- **路径**：默认 `<仓库根>/emulator.config.json`；可用环境变量 **`AMAYUI_EMULATOR_CONFIG`** 换成任意路径
  （绝对值，或相对仓库根）—— 例：`$env:AMAYUI_EMULATOR_CONFIG='.tmp/opt-skip-logo.json'`。
- **目前的全部选项**：

| 键 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `boot.showLogo` | boolean | `true` | `false` = **启动时预设 LOGO 显示标记**（`_this[96983] = 0`）⇒ cold boot **不进** `LOGO.txt`（版权页 + `LOGO.MPG`），`SYSTEM4` 直接落到 `INIT → TITLE` |

- **为什么"预设标记"就是正确的跳过方式**：`load-show-logo`(0x130) 读 `_this[96983]`（`sub_42F7A0` raw 39346），
  `src/SYSTEM4.txt:144-146` 据此 `jcc`；置 0 的正是 LOGO 自己的 `exit`（`exit-script` `sub_428A60` raw 35207）
  与「GAMEOVER 回标题」走的路径 ⇒ 不是自造旁路。详见 `../03-engine/flow-control.md` §10。
- **实测收益**：TITLE 之后第一帧的 renderer 时钟 **6333ms → 922ms**（省 ≈5.4s；wall 41.5s → 37.0s，
  含 electron 构建），日志里 `-> LOGO.BIN` 消失而 GAMESTART/SN0000 照常到达。
- **刻意的近似**：真机播 LOGO 时 `SYSTEM4` 的 `ip0..143` 会跑两遍（LOGO 的 `exit` 重载根脚本再跑一遍），
  预设 0 时只跑一遍；这些指令是赋值/建表，实测链路完整（`test/emulator-options.test.ts` 断言仍到达
  SN0000 首文案 ip=901）。若某天发现"少跑一遍"有副作用，就在能力台账登记后改成"跑一遍再跳"。
- **不该被它影响的**：`npm test` —— 库入口一律 `opt.emulatorOptions ?? DEFAULT_EMULATOR_OPTIONS`，
  只有 CLI 入口（`run.ts` / `report.ts` / `opInventory.ts` / `diagText.ts` / Electron `boot.ts`）才读文件。
  守卫：`test/emulator-options.test.ts`「库入口不得 import node-only 读取模块」+ `test/game-start-chain.test.ts`
  断言默认仍经过 LOGO。**新增选项时**：同步更新本表 + `src/emulatorOptions.ts` 文件头的表 + 在
  `test/emulator-options.test.ts` 加一条（拼错的键必须报 problem，不许静默）。
- ★**测试一律跑在"空配置"上**（2026-09 用户要求）：`npm test` / `npm run verify` 用
  `node --env-file=test/options.test.env` 把 `AMAYUI_EMULATOR_CONFIG` 指向 `emulator.config.test.json`
  （= 全默认）⇒ **你本地把 `emulator.config.json` 改成 `showLogo:false` 不会影响任何测试**。
  守卫：`test/emulator-options.test.ts` 的「钉住」用例（它还会在日志里打印本机值 + "测试不受它影响"，
  例如 `[options] 本机 emulator.config.json → showLogo=false（测试固定用上面的空配置，不受它影响）`）。
  想跑"未钉住"的测试：`npm run test:unpinned`（只用来看"本机设置下的表现"，不作为闸门）。

## 9. 待办 / 已知缺口（详见能力台账，勿在本文件抄明细）

- **3D 侧**：A4b 天气/粒子族（`0x324`/`0x325`/`0x326` 为 no-op、`0x327`/`0x328` 未注册）与"每帧渲染状态重设"整体缺失。
- **材质/混合**：`Item.blend` / `MeshObj.blend`（引擎的混合模式选择子）未接到 Pixi `blendMode`（值已送达，渲染器未消费 ⇒ 留在死写基线）。
- **存档路径**：`0x1A0`（读档 `SAVE%2.2d.DAT` + `sub_438120`）未实现，是下一个大缺口。
- **几何近似**：mesh 逐顶点渐变色取三角形均值（语料里逐顶点色恒等，无实测差异）。
- **平台侧**：视频（TITLE.MTN）/ Live2D（SO004A）/ 角色立绘来源未定位；GDI 文本度量（`0x205`）走近似。
- 每条缺口都必须在 `analysis/engine-capabilities.json` 有对应条目（状态 + 症状 + 修法），否则视为未登记。

## 10. 权威事实来源

- 逆向结论：`../03-engine/`（`engine-capabilities.md` 是生成物）与 `analysis/*.json`（真源）；
  反编译源 `engine/天结_unpacked.exe_utf8.c` 是**唯一分析基准**（raw 行号一律指它）。
- 实现细节/事故复盘/闸门说明：`../../app/amayui-emulator/README.md`。
- 里程碑/进度记录只作内部留存，**不作新来源**。
