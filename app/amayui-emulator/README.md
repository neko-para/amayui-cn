# amayui-emulator

用 **TypeScript + Electron** 重写《天結いキャッスルマイスター》的 AGE 引擎 VM（解释器），把 `engine/天结_unpacked.exe_utf8.c` 的逻辑以干净的 TS 语义实现，替换原 Win32 调用为 H5 / IPC，从而获得**更好的可调试性、可观测性、可插件化，并实现跨平台**。

> 本目录是**该重写工程的根**：`docs/` 记录方案/背景/决策，`src/`（新建）放实现代码。

---

## 定位与现状

- **当前阶段**：**M0–M3 里程碑已达到**——解释器已能从 `SYSTEM4.BIN`（index 0）一路执行，经过全部数据表 INIT 脚本（AMINIT2 / WDINIT / ALINIT / EBINIT / ITINIT / SKINIT / CGINIT / BTANINIT2…），正确运行到 **`TITLE.BIN`（622 条指令）执行点**——这是 `docs/03` 的第一里程碑。`npm test` 12/12 通过（含 5 条指针模型测试），`tsc` 干净。TITLE 其后进入 Live2D/消息主循环（`setL2DMOC`、等待输入），M0 无界面 stub 使其停在消息循环，属预期。
- **第一里程碑**（对应 `docs/03` 的 M0–M3）：**在无任何界面层输入/输出的前提下，让解释器执行启动链，并正确运行到 `src/TITLE.txt`（游戏开始界面脚本）的执行点。**（✅ 已达成）
- **技术前提（用户已确认）**：JS 可安全操作 2^53 内的整数/double，除非引擎使用 int64——当前引擎为 x86 32 位，未见 int64，故可用 `number`（配合显式 32 位位运算）。

---

## 快速导航

| 文档 | 内容 |
|---|---|
| [`docs/01-background.md`](./docs/01-background.md) | 引擎是什么、逆向已解/未解、对重写的影响 |
| [`docs/02-architecture-decisions.md`](./docs/02-architecture-decisions.md) | 关键架构决策（ADR）：启动层级、对象模型、NativeBridge、未实现 opcode 硬报错、32 位语义、BIN 读取器、**函数级状态追踪（ADR-010）** |
| [`docs/03-development-plan.md`](./docs/03-development-plan.md) | 分阶段里程碑 M0–M5 + 完成定义（DoD）+ 依赖图 |
| [`docs/04-boot-chain-analysis.md`](./docs/04-boot-chain-analysis.md) | 启动链实证（SYSTEM4→…→TITLE）+ opcode 清点 + 分类方法 |
| [`docs/06-function-status-registry.md`](./docs/06-function-status-registry.md) | **函数级状态追踪注册表**（ADR-010：每个原函数重写状态 + 确认忽略的证据/复核） |
| [`docs/07-pointer-operand-model.md`](./docs/07-pointer-operand-model.md) | **指针操作数模型**（ADR-011）：`lea`/`lookup-array`/`memcpy` 的模拟隐患——指针=带标记引用，读解引用/写写穿，不当数值 |
| [`docs/08-render-backend.md`](./docs/08-render-backend.md) | **渲染后端选型**：Canvas 2D 起步 + WebGL2 预留；窗口/文件流/渲染壳已接到 Electron |
| [`docs/09-data-model-and-reading-logic.md`](./docs/09-data-model-and-reading-logic.md) | **数据模型与读取逻辑**：本体 SYS4INI + 5 个 APPEND.AAI 统一文件 id 空间合并；引擎读取函数链；初始化调用链；纹理 id→图像 id 映射机制；标题图像来源(LOGO.txt) |
| [`docs/10-texture-slot-to-agf-file.md`](./docs/10-texture-slot-to-agf-file.md) | **纹理 slot ↔ AGF 文件**：`set-texture <imgid> <slot>` 是唯一绑定，`[5*slot+466]=imgid`，imgid→resolveEntry→文件名；并与 draw-texture 的 tex 句柄区分 |
| [`docs/11-fadetimer-and-fade-opcodes.md`](./docs/11-fadetimer-and-fade-opcodes.md) | **淡入淡出实现**：FadeTimer 步进计时器结构 + fade opcode 家族 0x20–0x38（SetFade/SetLineFade/SetRandomFade） |
| [`docs/12-adv-text-rendering.md`](./docs/12-adv-text-rendering.md) | **ADV/消息窗文本渲染选型（ADR）**：引擎侧文本管线（每窗离屏表面 → 逐行显现 → 合成）、5 个候选方案的逐能力对比、结论「纯排版模型 + Pixi 内 canvas2D 光栅化」、分阶段落地与验收 |
| [`docs/13-audio-plan.md`](./docs/13-audio-plan.md) | **音频实现方案评估**：语料实测（1.54GB，全是 RIFF PCM16 + Ogg Vorbis、无 AOGG）、要建模的三层内容、指令→API 映射、是否需要新库（**不需要**）、分期工作量（4.5–7 人日）与「零新增依赖」结论 |

---

## 资源根：默认读 **`install/`（汉化版）**

emulator 跑的是**汉化版**游戏 ⇒ 资源根默认是仓库根的 **`install/`**（松散 `.BIN` 脚本 +
打过补丁的 `DATA*.ALF` / `APPEND0n.AAI` + `SYS4INI.BIN` 索引）。这一点由**唯一一处**解析：
`src/arch/resourceDir.ts`（`resolveResourceDir(repoRoot)`），Electron 主进程、Node 工具与测试全部走它
（早前散在 9 个地方、各写各的 `raw`，会出现"测试测原版、产品读汉化版"的漂移）。

```bash
# 对比原版（raw 是指向日文安装目录的 junction）
$env:AMAYUI_RESOURCE_DIR='raw'; npm run report -- --steps 200000
# Node 工具也支持命令行覆盖（等价）
npm run report -- --resources install --steps 200000      # 旧名 --raw 仍兼容
```

实测差异（`raw` vs `install` 同一 imgid 的位图 sha1）：`SO009A/SO009B`（设置界面素材，汉化）
不同，`SO010/SO004`（未汉化）相同 ⇒ 换根确实换了素材，而不是"看着像"。
随之而来的一条编码事实：汉化把简体字映射成 **cp932 可编码的日文写法占位**
（`scripts/lib/sjis-encode.js` + `res/subs_cn_jp.json`），渲染时由 **cnjp 字体**还原
（`res/fonts/Amayui-CN_cnjp.ttf`，见 `src/text/fontSet.ts`）。所以脚本层（解析 + 排版模型）
看到的是占位码位（如 `天俟`），**那不是乱码**，断言也按占位串写。

---

## 输入指令（鼠标/滚轮）

引擎把输入状态放在 `this + 258` 的输入管理器里，脚本用一族 opcode 读出来。emulator 用 `InputManager`
（`src/vm/input.ts`）重建这些可观测语义，渲染窗（`PixiBackend.#attachMouseInput`）负责注入：

| opcode | 引擎 handler | emulator | 语义 |
|---|---|---|---|
| `0x108` | `sub_42EDC0` | `[已实现]` | `read-mouse-button`：`op1 = 鼠标按钮值`（bit0=左/bit1=右）；渲染窗 `mousedown/mouseup` 注入 |
| `0x109` | `sub_42EE10` | `[已实现]` | `read-mouse-pos`：`op1=X, op2=Y`（虚拟 1280×720 坐标；出窗=-100000）；渲染窗 `mousemove/mouseleave` 注入 |
| `0x10D` | `sub_42EF50` | `[已实现]` | `read-mouse-wheel`：**读鼠标滚轮增量并清零**（一次性消费）→ `op1`；渲染窗 `wheel` 注入 |
| `0xCC` / `0xFB` | `sub_421980` / `sub_421B80` | `[已实现]` | 注册 mouse/joy 跳转目标（供 0xCD/0x100 派发） |

### 引擎配置（SYS4REG.INI）→ 引擎字段

引擎启动时读 `SYS4REG.INI`（`sub_4900F0` 定路径 / `sub_4963E0` 解析 / `sub_4957F0` 按 `"section:key"` 取值），
把值**灌进引擎字段**（raw 23649-23745），脚本再用 opcode 读这些字段。emulator 现按同样顺序做：

- **加载**：`src/engineConfig.ts` 的 `parseIni()` + `CONFIG_FIELD_BINDINGS` + `applyConfigToEngine()`；
  渲染窗 boot 时经 IPC `read-config-ini` 读**当前生效的那份** —— 系统存档目录 + overlay：
  先 `%LOCALAPPDATA%\Eushully\天結いキャッスルマイスター.overlay\SYS4REG.INI`，没有则读真游戏那份
  `…\天結いキャッスルマイスター\SYS4REG.INI`（见 `src/arch/systemPaths.ts` / `overlay.ts`，下文「设置界面那些开关存哪」）。
  写入 `Engine.engineValues`，并把解析结果存 `Engine.config`。
- **已绑定字段**（键 → `_this[K]`，**K 一律是 dword 下标**＝handler 里的同一空间）：
  `sound:Music`→174713（0xC0 读；⚠raw 的配置写入目标是下标 174810，待音频专项对齐）、
  `display:ScreenMode`→167990（0x2CE 读，布尔化）、`message:MessageSpeed`→**21668**（＝`Font+1376`；op 0x74 写、0x7F 读）、
  `message:MessageFade`→**80106**（＝`Font+235128`；op 0x2EE 写）、`message:RMouseEvent`→1384、
  `sound:Sound`→174810、`sound:SE`→20980、`sound:Voice`→21293。
- ★`message:MesWinAlpha` **不在绑定表里**：引擎从不把它灌进持久字段，只由 `0x131`（sub_42F7D0 直读配置）
  / `0x141`（sub_4228C0 直写配置，`op1>0x10` 报错）按名存取。历史误绑到 21668 曾与 MessageSpeed 互相覆盖。
- **相关 opcode**：`0xC0`(音乐字段)/`0x131`(直读 `message:MesWinAlpha`)/`0x141`(直写同名键)/`0x7F`(读 MessageSpeed)
  /`0x2CE`(显示模式) 已实现。
- **读配置回写操作数（整族）**：`test/config-read.ts` 的 `CFG_READ` 表 ——
  `0xC5`(sound:Volume0..4)、`0xC7`(sound:Music/SE/Voice/Movie，布尔化)、`0x1B8`(message:AutoMessageTime0/1)、
  `0x2CC`(AdvanceMesOnWheel)、**`0x2E6`(message:AutoMessagePitch0/1)**、`0x2EA`(AutoMessageOption)、
  `0x194`(字符串相等)；另加 **`0x2EB`**：`GetConfig("set:GameVersion")` → **字符串操作数**（TITLE 的版本号）。
- **写配置**：`0x141`/`0x1B5`/`0x1B9`/`0x2CD`/`0x2E7`/`0x2E8` … 全部经 `setConfigValue()` 写 `Engine.config`。
  ★**落盘**：`Engine.onConfigChanged` → `FileSource.saveConfig(整份 INI 文本)` ——
  Electron 走 IPC `save-config-ini`，headless `npm run run` 直调 `NodeFileSource.saveConfig`；
  两者都**只写 overlay** 的 `SYS4REG.INI`（真游戏那份一个字节都不动），且带防丢键棘轮（见下）。
  `--no-save-config` 可关回写。**测试/链路工具不注入该钩子** ⇒ 跑测试不会写任何玩家数据。
  序列化在 `engineConfig.formatIni()`（按 `sections`+`order` 还原，**只改一个值不会重排整个 INI**）。
- **`[set]` 段与版本号**：引擎内建 `set:GameVersion = "1.00"`（raw 111627-111629 的 `a100`）；
  INI 里写了就覆盖它；若 `set:VerRegPos` 非空，真引擎还会用注册表 `DisplayVersion` 再覆盖一次
  （`sub_490010`，缺省 `"1.00.0000"`）。**emulator 不查注册表**（跨平台，且本机这份 `VerRegPos` 为空）
  ⇒ 版本号 = `ENGINE_BUILTIN_GAME_VERSION` 被 INI 覆盖；**真游戏 INI 里没有 `[set]` 节**（那节由引擎退出时写），
  所以实际取 `DEFAULT_GAME_VERSION = 1.07.0019`（= `raw/补丁/修正补丁/amayui_107.exe` 的 FileVersion）。
  TITLE 用它画 "Version X.YY.ZZZZ"：`0x2EB` 取值 → `0x2C7` 按**字节**切 1/2/4 段 → `0x2EC`(atoi) → `0x23B`(CG 数字条补零)。
  想改成别的版本号：在 overlay 的 `SYS4REG.INI` 里写 `[set] GameVersion=…`。
- 测试：`test/engine-config.test.ts`（解析 / 真实 INI 关键键 / 字段绑定 / 上述 opcode 取值与 0x141↔0x131 往返）、
  `test/config-version-substr.test.ts`（0x2E6↔0x2E7 闭环、`formatIni` 往返不重排、SJIS 子串、**E3：TITLE 版本号 = 1.07.0019**）。

### ★设置界面那些开关存哪：`SAVE.DAT`（不是 SYS4REG.INI）

`SYS4REG.INI` 只装**引擎级**配置（display/sound/message/system/set）。设置界面里的开关
（窗口显示 / 自动保存 / Live2D / ADV 特效 / 字体…）是**脚本自己**用两张字符串键表存的：

```text
INITCONFIG0..5   mov (global-int a9ce) 0  +  save-int (global-int a9ce)     ← 首次启动：默认值 + 登记
LOADCONFIG       load-int (global-int a9ce) …                               ← 之后每次启动：读回
CHECKCONFIG      i2de 字体名→下标（装不上 ⇒ 回退默认并重新 save-string）
SYSTEM4.txt:71   load-int (global-int 5)  ← 判据：SAVE.DAT 里有「已初始化」标志就走 LOADCONFIG，否则 INITCONFIG
```

### ★ADV 文字速度（`message:MessageSpeed`）= **每字毫秒**

设置界面「显示速度」滑条 → `CONFIG1.txt:2286` `i1b5 (100 - 滑条值)` → `0x1B5` 写
`Font+1376`（= `Engine[21668]`）**且**写配置 `message:MessageSpeed`；显现泵 `sub_409400` 每
`max(该值, 一帧)` ms 调一次 `sub_45BE20` 推**一个字**（`win+44` 的 24B 记录表是逐字 push 的，
见 `docs-new/03-engine/adv-text-rendering.md` §3.3.1）⇒ **整段耗时 = 字数 × 该值**。

- emulator 侧：`msgwin.ts` 的 `RevealState.budgetMs = 字形数 × max(speed, 一帧)`，
  `tickRevealWin` 按 `total / budgetMs` 连续推进（`carry` 保分数余量）⇒ 等价"一字一拍"；
  `0` ⇒ 立即全显（引擎同步排空分支）。
- ★2026-09 修：预算曾按**行数**算（把 24B 记录当成行记录）⇒ 整段快了"每行字数"倍（~14×），
  1..99ms/字 被压成 ~50..300ms/页 ⇒ 用户实测"文字出现的速度几乎没有变"。修后实测：
  42 字页 1ms ⇒ 0.7s（被帧率地板住）、25ms ⇒ 1.05s、50ms ⇒ 2.1s、99ms ⇒ 4.17s。
  守卫：`test/adv-msgwin.test.ts` 的速度定律 + `test/option-font-speed-menu.test.ts`。
- 脚本还会用 `i07f`(读) / `i074`(只写字段) 做"这一段立即显示"（`i074 0` … 还原），见 `0x74`/`0x1B5` 的差别。

引擎把这两张表（`Font+5452` str→int / `Font+5472` str→str）序列化进 `SAVE.DAT`
（写 `sub_40AAE0`→`sub_438320`→`sub_437480`；读 `sub_40AEE0`→`sub_438940`；关窗或存档槽保存时写）。
emulator 已把整条链路接通，**并且能读引擎格式的真存档**（`Crypt` + AGE `LZSS` + 双 CRC 全部逐字实现）：

| 能力 | 落点 |
|---|---|
| 表的读写（`0x1A2/0x1A3/0x1A9/0x1AA`） | `handlers/strings.ts`（写表时通知 `Engine.onSaveDataChanged`） |
| 容器/表结构/双 CRC | `src/vm/saveData.ts` + `src/vm/crc32.ts`（引擎两种 CRC 都实现） |
| 引擎格式解密的两个变换 | `saveData.cryptDecrypt`（`sub_436E90`）+ `src/vm/lzss.ts`（`sub_436A80`） |
| 启动装载（脚本之前） | `renderer/app/configBoot.ts` 的 `loadSaveData()` / `run.ts` 的同名段 |
| 玩家数据落在哪 | **overlay 层**：`src/arch/systemPaths.ts`（base/overlay 解析）+ `src/arch/overlay.ts`（读 overlay→base、写只写 overlay） |
| 写盘路径 | Electron IPC `read/write-save-data`；Node `NodeFileSource.writeSaveData`（两侧同一份 overlay 实现） |
| **不覆盖真存档** | 写永远只落 overlay ⇒ 真游戏目录（几十个存档槽 + 真配置）一个字节都不会被改 |
| 载荷表结构 | `saveData.parseTables(…, engineLayout)`：引擎的字符串记录区从 `strCount` 之后 **8** 字节起（中间 4 字节 = `trailerDwords` = 记录区字节数/4 + 1）；少跳 4 字节不报错，只会**静默丢掉最后一条记录**（真存档里恰是字体键 `bbf`），见 `docs-new/03-engine/save-data.md` §3 |

**overlay 目录布局**（`AMAYUI_SYSTEM_DIR` / `AMAYUI_OVERLAY_DIR` 可覆盖）：

```text
base    = %LOCALAPPDATA%\Eushully\天結いキャッスルマイスター\            ← 真游戏：SYS4REG.INI + SAVE\SAVE.DAT（只读）
overlay = %LOCALAPPDATA%\Eushully\天結いキャッスルマイスター.overlay\    ← 本工程：结构镜像（同级目录）
读：overlay\<rel> 有就用它，否则读 base\<rel>      写：只写 overlay\<rel>
```

- 于是**不需要任何"另存一份"的后缀 hack**（旧实现写 `<SAVE.DAT>.amayui`）：
  继承玩家设置与"绝不写坏真存档"由目录布局本身保证；删掉 `.overlay\` 即彻底复原。
- 于是 emulator 启动时读到的是**真游戏那份** `SYS4REG.INI`（display/sound/message/system 53 个键）
  与真存档（5409 int / 245 string）⇒ 日志里会写清命中哪一侧：
  `[main] config ini -> …\天結いキャッスルマイスター\SYS4REG.INI (base, 953 bytes)`、
  `[save] …（base）… ⇒ 走 LOADCONFIG 分支`。之后任何改动都写进 overlay。
- ⚠若换过解码器/版本后发现设置不对，把 `….overlay\` 整个删掉再启动，重新从真游戏继承一次。
- 守卫：`test/save-data.test.ts`（两种格式往返 + Crypt/LZSS/CRC 单元 + **E3 真语料两条分支** + **E4 真存档解码**）
  与 `test/overlay.test.ts`（读回落、写只写 overlay、base 字节不变、路径守卫、目录解析）。
  完整格式与实证见 `docs-new/03-engine/save-data.md`；**看某个存档里到底存了什么**：
  `npm run save:dump`（默认取系统存档目录的 `SAVE\SAVE.DAT`，按 overlay → base 命中并打印是哪一侧；
  也可 `npm run save:dump -- <文件>` 指定某个存档槽）。
- ★`SYS4REG.INI` 回写带**防丢键棘轮**：新文本的键数少于**当前生效的那份**（overlay 优先，否则真游戏那份）时
  拒绝落盘（防止"配置未装载就写回"把整份 INI 抹成两行）。

### 设置界面相关 opcode 的实现状态

| opcode | 作用 | 状态 |
|---|---|---|
| `0x2DC` | **可选字体数量 → op1**（`Font+201664` 的 32B/条向量长度；空表 ⇒ **-1**） | ✅ `op_font_list_count`（`ENGINE_FONT_LIST`） |
| `0x2DD` | **字体表第 op2 项的名字 → op1 字符串**（越界 ⇒ 空串） | ✅ `op_font_list_name` |
| `0x2DE` | 字体名 → 下标（查不到 -1；CHECKCONFIG 靠符号判断"还装着吗"） | ✅ `op_font_name_to_index` |
| `0x1B5` | 设 `message:MessageSpeed`（每字毫秒）+ 落盘 | ✅（滑条走它，见上节） |
| `0x74` / `0x7F` | 只写字段 / 读字段（"这段立即显示"的成对用法） | ✅ |
| `0xA1`/`0xA2`/`0xA3` | 菜单表复位 / 登记 key→label / 查表跳转 | ✅ 纯 VM 状态（`Engine.menuMap`），**不经宿主** |

★**字体选择器（`$1$SELFONT.txt`）**：`:34 i2dc` 取数量 → `:35 count==0 ⇒ exit` → 每页 9 项
（`:43/:49` 的 `9`）用 `:78 div … count` 算滚动条；`:567/:644 i2dd` 逐行取候选名 →
`set-font` → `draw-string`。**`0x2DC` 返回 0 会让选择器直接退出、并在 `:78` 处除零**
（滚动条几何变成 Infinity/NaN ⇒ 用户看到的"滚动条中间段漂到左边、中间没有列表"）。
三条指令共用 `ENGINE_FONT_LIST`（含汉化面名 `Amayui CN`），守卫 `test/option-font-speed-menu.test.ts`。

★**菜单指令的"假缺口"**：`menuBind`/`menuReset` 曾是 `NativeBridge` 上的宿主方法，而宿主（PixiBackend）
没有任何菜单子系统 ⇒ 每次 `0xA1/0xA2` 都被闸门 A 记成"意图被丢弃"，控制面板显示"没有实现"。
现已在 `menu.ts` 里就地完成（表 = `Engine.menuMap`），宿主方法与其 `WHY` 文案一并删除。

### 默认插桩：消息窗/消息渲染 与 声音子系统

> **2025 再分类**：早期为"跑到 TITLE"把 **49 条** opcode 统一塞进 `ENGINE_INTERNAL_OPS` 当 no-op。
> 现已逐条读 handler 体重新分类（`ENGINE_INTERNAL_OPS` 内按子系统分组、每条带一行依据注释）：
>
> - **升级为真实现（15 条）**：handler 体是"读操作数 → 写引擎字段"，字段可建模 ⇒ 走 `OPS` 的
>   `ENGINE_FIELD_STORE` 规格表（`0x76`/`0x77` 字节重排、`0x78`、`0x8B`、`0x1A4`、`0x252`、`0x261`、`0x2EE`、
>   `0x2DB`、`0x21B`、`0x24E`、`0x10F`）+ 专用 handler（`0xFE` SetKeyTotal、`0x107`/`0x10B` 按键表）；
>   并补上配套 getter **`0x247`**（`op1 = (_this[166965]!=0)`，与 `0x21B` 成对，可往返验证）。
> - **留在真·忽略（32 条）**：handler 体只是调**宿主没有的子系统**（`_this+80708` 绘制容器、`_this+21324`
>   文本子系统、声音设备、计时器）或写无人读取的字段 ⇒ 无 VM 可见副作用、emulator 无输出。
>   按子系统分组：渲染/图形/纹理（`0x32F`/`0x248`/`0x352`/`0x344`/`0x23B`/`0x25B`/`0x1F6`…）、
>   消息窗/文本/字体（`0x70`/`0x73`/`0x75`/`0x79`/`0x74`/`0x7A`/`0x7B`/`0x197`/`0x1BB`/`0x1C1`…）、
>   输入（`0x10C`/`0x30A`）、字符串/配置（`0x2C8`/`0x2C9`/`0x2DD`）、数据/版本/脚本控制（`0xAE`）。**声音族 22 条已于 2026-09 全部转真实现**（`handlers/audio.ts` + `src/audio/audioEngine.ts` + Web Audio 宿主：SE/语音/BGM/音量/pan/延迟/ADV 语音寄存，见 `docs/13-audio-plan.md`）。
>   （`0x2C7` SBSubstr 与 `0x2EB` GetConfig(`set:GameVersion`) 2026-09 已**转真实现**：它们会回写操作数，
>   当 no-op 时 TITLE 的版本号永远是占位值 `0.00.0000` —— 见 `handlers/strings.ts` / `handlers/config-read.ts`。
>   **`0x143`（`i143`）也已转真实现**：它派发扩展包的 `$n$AUTORUN`（见 `handlers/control.ts` 的
>   `op_dispatch_script_requests`）—— 当 no-op 时 5 个扩展包一个都不会激活。
>   **`0x1D6`/`0x1D7`/`0x1D8`（音乐表族）同样已转真实现**（`handlers/music-table.ts` 的 `MUSIC_TABLE_OPS`）：
>   它们作用在 `Engine[698900]` = `Music[271]` = **PCM 播放器**的两张曲号表（`+1304` 扁平表 = 曲号 − 2 → 文件 id；
>   `+1320` 分组表 = 扩展包曲子），并且**都会回写 op1**。当初按 no-op 的理由是"结果写进没人读的 `global 70801e`"
>   —— 但**写全局表本身就是副作用**，而且这张表就是 `play-bgm` 的曲号解析（`sub_48DB80`）读的表。
>   守卫 `test/music-table.test.ts` + `test/append-packs.test.ts` 的 E3 段。）
>
> 校验：49 条**全部已登记**（无一条落到 `unimplemented`），三张表内**无重复键**；测试见
> `test/engine-field-store.test.ts`。

设置界面（CONFIG2/CONFIG1）实测涉及的一批 opcode，按「读 handler 体」判定为**只写引擎内部字段、无操作数回写、无控制流**，
已进 `ENGINE_INTERNAL_OPS`（默认插桩，**不再需要用户逐条点「作为桩函数跳过」**）：

| opcode | handler | 归入 | 依据（handler 体） |
|---|---|---|---|
### 渲染模型（引擎侧实证结论 → emulator 建模）

> 2025 由 6 个并行分析员逐个子系统读 `engine/天结_unpacked.exe_utf8.c` 得出（报告在 `.tmp/re-*.md`）。
> **结论已逐条独立复核**（派发表反查 + 脚本三方互证），并纠正多处旧口径。

**1. 绘制容器 = `Scene` 类**（不是裸 map）：`_this[80708]`（`_this` 是 `_DWORD*` ⇒ **字节 322832**）内嵌一个
`Scene` 对象（vtable `Scene___vftable_`，ctor `sub_4AAF90`），内含 **5 个并排的 MSVC `std::map<uint32_t,T>`**：
`+1032` 图元表（740B = **DrawItem**）、`+1048` 转场表（96B）、`+1064` 网格表（60B = **MeshEntry**）、
`+1080`/`+1096` 精灵/就地结构（572B）。
**节点 key = 图元 id，同时就是层序**（越小越先画）；**元素内部不存 layer**。
`Scene+1860` = 渲染器（+1040 = `IDirect3DDevice9*`、+1100/1104 = 屏幕宽高）；`Scene+42456` = **1000 槽 `CTexture*` 表**；
`Scene+55812` = **10 槽 Live2D 模型对象**。

**2. `draw-texture`(0x1FB) 的操作数语义（旧实现写反 —— "背景消失"的直接原因之一）**：

```
op1 = 图元 handle（= Scene map key = 层序）                              ← 旧实现当成"纹理槽" ❌
op2 = 纹理槽号（存 DrawItem+4；渲染时 Scene+4*slot+42456 取 CTexture*）  ← 旧实现当成"layer" ❌
op3/4 = 源 x/y；op5/6 = 源 w/h；op7/8 = 目标 x/y
```

`present()` 又用 `it.layer` 查纹理槽表 → 两错叠加 ⇒ **几乎所有图元取不到纹理，退化成占位色块**。
两处已修（`op_draw_texture` 与 `PixiBackend.resolveItemTexture`；回归测试 `test/texture-slot-resolve.test.ts`）。

**3. 同族指令的更正后语义**：

| opcode | handler | 实证语义 |
|---|---|---|
| `0x1F6` | sub_41A130 | 清空**全部 4 张表**（唯一整体清场）+ 复位脏标志 → `native.clearDrawContainer` |
| `0x1F7` | sub_422BC0 | `op1`=**key(层序)**、`op2`=count：erase 该 key 区间（不碰 +1048 表） |
| `0x217` | sub_423B20 | 写 DrawItem`+24/+28/+32` = **旋转/缩放中心 pivot**（绘制期 `T(-pivot)→动画矩阵→T(+pivot)`，**不改位置**） |
| `0x219` | sub_423BA0 | 写 DrawItem`+36/+40/+44` = **描画位置 (x,y,z)**（原被误记为 0x21E） |
| `0x21E` | sub_423CA0 | **缩放动画窗**：`op2`=delay、`op3`=dur、`op4/5/6`=sx/sy/sz（**÷256**）→ DrawItem`+0x3C/+0x50/+0xAC` |
| `0x21F` | sub_423D40 | **旋转动画窗**：`op2`=delay、`op3`=dur、`op4/5/6`=轴、`op7`=角（度）→ `+0x40/+0x54/+0x12C/+0x1F8..0x208` |
| `0x220` | sub_423DE0 | **平移动画窗**：`op2`=delay、`op3`=dur、`op4/5/6`=位移（**不除 256**）→ `+0x44/+0x58/+0x1AC` |
| `0x239` | sub_424900 | **flipbook 动画窗**：`op2`=delay、`op3`=dur、`op4`=帧数、`op5`=列数、`op6`=标志 → `+0x48/+0x5C/+0x238/+0x23C/+0x234`（改**源矩形**） |
| `0x32F` | sub_4272B0 | **D3D 灯光开关** `LightEnable(idx,FALSE)`（idx=0..9；**不是**网格/图元清除） |
| `0x342` | sub_427C70 | **销毁 Live2D 实例槽**（`Scene+55812` 10 槽；析构+delete+置 0） |
| `0x352` | sub_4283B0 | **Live2D 槽参数**：按 op2 置**待纹理 ID**(+24/+28) 或**待动作 ID**(+25/+32) |
| `0x344` | sub_427CB0 | 在 1096 表建记录、置 bit0；`记录[1]` 索引 L2D 层 |
| `0x23D` | sub_41A300 | **销毁 movie/纹理槽 42..999**（958 次；会让引用这些槽的图元不再绘制） |
| `0x259` | sub_41A3A0 | 只清 1000×2 组 5-DWORD 记录表的 +8/+12（**不 delete**；旧文档当"纹理槽释放"是错的） |
| `0x32B` | sub_41A4A0 | 清 **D3DX 网格层级槽表**（`Scene+50708` 区 1000 槽，逐项 delete） |
| `0x321` | sub_426BD0 | **3D 网格元素属性写 setter**（`sub_4AE280`，`elem[op2+7]=op3`；**不是**颜色动画求值器） |
| `0x326` | sub_426E10 | 3D 特效雪花：惰性建共享 `ID3DXEffect`（资源 202）下发参数；**不做 RGBA 运算** |
| `0x1F4`/`0x1F5` | sub_41A090 / sub_41A0E0 | **停靠(dock)锁**：标志 `_this[107438]`(字节 429752) + **深度 LockDepth** `_this[107439]`(429756)；`0x1F4` 深度++（首次采样时钟）、`0x1F5` 深度--归零则解锁并派发脚本队列。**都不阻塞、无 Sleep**；脚本里 66510 处 `i1f4` = 每帧轮询点 |
| `0x20C` | sub_41A1A0 | 每帧刷时钟 + `sub_4B4040(Scene)`（命令/动效泵：Clear→BeginScene→四路归并按 key 绘制→EndScene→Present） |

**4. DrawItem 数据模型 + 5 个动画窗（2025 实现，见 `src/renderer/drawItem.ts`）**：

DrawItem = `Scene+1032` 的 map 值，**740 字节**；元素内偏移 = f32 下标 × 4：

| 偏移 | 字段 | 写入者 |
|---|---|---|
| `+0` | flags：bit0 已创建 / bit1 动画启用 / bit2 额外渲染分支 | `draw-texture` / 各窗 setter |
| `+4` | **纹理槽号**（`draw-texture` 的 op2） | `0x1FB` |
| `+8/+0xC/+0x10/+0x14` | **源矩形 left/top/right/bottom**（脚本给 x,y,w,h；handler 先 `SetRect(x, y, x+w, y+h)`；⇒ 元素内源宽 = `+0x10 − +8`） | `0x1FB` |
| `+0x18/+0x1C/+0x20` | pivot | `0x217` |
| `+0x24/+0x28/+0x2C` | 描画位置 | `0x219` |
| `+0x30` | 混合模式 | `0x203` |
| `+0x34` | **动画起点（全项共享一个）**；任一 setter 写 0 ⇒ 驱动首帧锁存 `Scene+46500` | 5 个窗 setter |
| `+0x38/+0x4C` | 窗0（颜色/α）delay / dur | `0x202` |
| `+0x3C/+0x50` | 窗1（缩放）delay / dur | `0x21E` |
| `+0x40/+0x54` | 窗2（旋转）delay / dur | `0x21F` |
| `+0x44/+0x58` | 窗3（平移）delay / dur | `0x220` |
| `+0x48/+0x5C` | 窗4（flipbook）delay / dur | `0x239` |
| `+0x60/+0x64` | 颜色 FROM（工作色）/ TO | `0x203` / `0x202` |
| `+0x6C / +0xAC` | 缩放矩阵 work / target（`D3DXMatrixScaling`） | `0x21E` |
| `+0xEC / +0x12C` | 旋转矩阵 work / target（`D3DXMatrixRotationAxis`；轴/角在 `+0x1EC..0x208`） | `0x21F` |
| `+0x16C / +0x1AC` | 平移矩阵 work / target（`D3DXMatrixTranslation`） | `0x220` |
| `+0x234/+0x238/+0x23C` | flipbook 标志（bit0=保持末帧）/ 总帧数 / 每行列数 | `0x239` |

**窗语义（引擎 raw 证据）**：
- **起点共享**：5 个 setter 全部写 `+0x34 = 0`（raw 131970/132002/132047/132099/132134），驱动首帧
  `if (!a2[13]) a2[13] = *(float*)(Scene+46500)` 锁存（raw 117437-117438）⇒ 起点是**全项一个**，不是每窗一个。
- **相位**：`clock < start+delay` 保持 work；窗内 `t = (clock − start − delay) / dur`（线性、无 clamp）；
  `clock ≥ start+delay+dur` ⇒ **一次性收尾** `work ← target`（缩放 raw 117496、旋转 117550、平移 117646、flipbook 117831）。
- **`dur = 0` 但"配置过"** 与 **"从未配置"** 必须区分：前者当帧即收尾（实机改 COUNT=1 → 瞬现）。
- **`delay`/`dur` 单位 = 毫秒**（直接与 `timeGetTime()` 时钟比较）。
- **flipbook 改的是源矩形、不是 UV**：`frame = frames·t`、`col = frame % cols`、`row = frame / cols`，
  源矩形偏移 `(col·srcW, row·srcH)`（raw 117797-117804）；窗末 `flags & 1` ⇒ 停在 `frames−1` 帧，否则复位。
- **颜色窗的逐帧求值器（2026 复核确证：存在）**——上一轮 `.tmp/re-color-transform.md` §2.3 的"找不到求值器"结论**是错的**，
  原因是把代码归属搞错了。实证链条：

  ```
  sub_4AEEA0（DrawItem 渲染器，raw 133326-133450）
    133363  qmemcpy(v26, 元素, 740)                        // 元素 → 局部副本
    133375  v6 = v26[24]                                   // +0x60 = FROM（工作色）
    133389  sub_49AA30(_this, v26, Scene+46536, &v25, v22) // ★ 传"颜色变量的地址"
              └─ 117374  v117 = a4                          // a4 即 &v25
              └─ 117437  if (!a2[13]) a2[13] = clock        // 首帧锁存共享起点
              └─ 117461-117479  we/left 整数 lerp → 写回 *v117
              └─ 117449-117457  窗末：a2[24] ← a2[25](TO)、a2[25] = NaN、delay/dur 清 0
              └─ 117844  置 pending Scene+46516（动画在跑时）
    133443  sub_4A2D50(..., v25)                           // ★ 求值结果作 diffuse 交纹理绘制
    133447  qmemcpy(元素, v26, 0x2E4)                      // ★ 局部副本**整体写回元素**
  ```

  ⇒ ① 求值器在 **`sub_49AA30`** 里（raw 117434-117483），调用点就是 DrawItem 渲染器，**不是**"元素3/`sub_4A230`"；
  ② `a4` 是"指向调用方颜色变量的指针"，插值结果**只写调用方局部、不回写 `+0x60`** ⇒ 窗内每帧都从同一对 `FROM/TO` 重算；
  ③ `sub_49AA30` 的局部副本**会写回元素**（raw 133447，740 字节）⇒ "窗末冻结 / delay·dur 清 0 / flipbook 源矩形结果"都持久化。

- **插值公式是整数截断，不是四舍五入**（raw 117466-117479）：
  `we = clock − start − delay`、`left = start + dur − (clock − delay) = dur − we`、
  `ch = (left·from_ch + we·to_ch) / dur`（整数除法，通道序 B/G/R/A）。
  例：`from=0x00, to=0xFF, dur=2, we=1` ⇒ **127**（四舍五入会得 128）。
  ★与 **mesh（元素2）** 的 `CalcDiffuse`（`sub_4A2050` raw 122287-122294）**不是同一条公式**：
  后者是浮点式 `ch = (int)(state1·t + state0·(1−t))` + "四通道全 255 ⇒ 直接拷基础色"快路。
  emulator 两处分别实现为 `lerpArgbWindow` / `lerpArgbFloat`。

> **回归测试**：`test/draw-item-anim-window.test.ts`（10 例）锁死上面每条（共享起点 / delay 保持 work /
> 窗内插值 / 窗末收尾 / `dur=0` 区分 / flipbook 帧→源矩形 / 保持末帧 vs 复位 / pivot≠描画位置）。
> 纯模型在 `src/renderer/drawItem.ts`，**不依赖 Pixi/DOM**，因此可被 Node 测试直接驱动。

> **数据层同步**：`analysis/functions.json` 已写入 `sub_4AD170`/`sub_4AD250`/`sub_4AD3C0`/`sub_4AD4A0`
> （4 个窗 setter）、`sub_4ACE50`（draw-texture 建项）、`sub_49AA30`（逐帧驱动）、`sub_4AEEA0`（改判 ANALYZED）；
> `analysis/fields.json` 的 DrawItem `0x34`/`0x38`/`0x4C` 已转 `confirmed`。
> ✅ 窗 delay/dur 的其余偏移（`0x3C/0x40/0x44/0x48/0x50/0x54/0x58/0x5C`）与 `ScriptContext` 同偏移，
> 但 `scripts/report.js` 的字段唯一键已改为 **`scope + offset`**（定位键可写 `DrawItem/0x3C`，裸 `0x3C` 命中多条时会报错并列出候选），
> 因此不同 scope 的同偏移字段可以并存入库 —— `Font`（65 条）/ `FontVWindow`（38 条）就是这样补进去的。

### 渲染/图形/帧循环 一族（2025 实现）

早期这批也统一当 no-op。逐条读 handler 体后（raw 25194-25430、34117-34780、32705、31807 等）：

| opcode | handler | 实现 | 依据 |
|---|---|---|---|
| `0x1F4` | sub_41A090 | **真实现** | 帧计时：`_this[107438]` 已置→`++_this[107439]`；否则置 1 并刷 `_this[92333]/[92334]` 时钟。**脚本的"帧循环"就是反复调它**（全工程 66510 处）——它不等待，只记时间/计帧 |
| `0x1F5` | sub_41A0E0 | **真实现** | 帧倒计：`_this[429756]` 递减到 0 → 清停靠标志 `_this[429752]=0`（随后的脚本队列派发 `sub_40FB60` 未建模 → no-op） |
| `0x20C` | sub_41A1A0 | **真实现** | 每帧刷时钟 + `sub_4B4040(_this+80708)` 帧刷新 → `native.frameTick()`（emulator 渲染循环自行 present） |
| `0x23D` / `0x32B` | sub_41A300 / sub_41A4A0 | **真实现** | 设置"停靠/挂起"标志 `_this[122497]=1`（与 `_this[429752]` 同族） |
| `0x248` | sub_4252E0 | **真实现** | `dword_55052C = op1`（渲染配置全局槽） |
| `0x219` | sub_423BA0 | **真实现** | 绘制项**描画位置**：3 个 float → `sub_4ACEE0(_this+80708, handle, f2,f3,f4)` → DrawItem`+36/+40/+44` → `native.setDrawPos` |
| `0x21E` | sub_423CA0 | **真实现** | 缩放动画窗（窗1）：`sub_4AD170` 写 `+0x3C`/`+0x50`/目标矩阵 `+0xAC` → `native.setScaleAnim` |
| `0x21F` | sub_423D40 | **真实现** | 旋转动画窗（窗2）：`sub_4AD250` 写 `+0x40`/`+0x54`/轴角/目标矩阵 `+0x12C` → `native.setRotationAnim` |
| `0x220` | sub_423DE0 | **真实现** | 平移动画窗（窗3）：`sub_4AD3C0` 写 `+0x44`/`+0x58`/目标矩阵 `+0x1AC` → `native.setTranslationAnim` |
| `0x239` | sub_424900 | **真实现** | flipbook 动画窗（窗4）：`sub_4AD4A0` 写 `+0x48`/`+0x5C`/帧数/列数/标志 → `native.setFlipbook` |
| `0x32F` | sub_4272B0 | **真实现** | **D3D 灯光开关** `LightEnable(op1, FALSE)`（idx 0..9）→ `native.setLight`。★旧注"网格项清除"是**误** |
| `0x342` | sub_427C70 | **真实现** | 释放图形资源槽：`sub_4A1A60`（`operator delete` 该槽对象并置 0）→ `native.releaseTexture` |
| `0x344` | sub_427CB0 | **真实现** | 纹理槽变换：`sub_4AFBF0(_this+80708, op1, op2)`（`_this+274` map 项 `\|=1`、`[+4]=op2`）→ `native.setTextureTransform` |
| `0x352` | sub_4283B0 | **真实现** | 图形子系统：`sub_4A1AC0(_this+80708, op1,op2,op3)` → `native.gfxSubsystem` |
| `0x1F6` | sub_41A130 | **真实现** | **整批释放绘制项/网格** `sub_4AB7A0(_this+80708)` → `native.clearDrawContainer()`（清 `drawItems`+`meshes`，**保留纹理槽**）。★这是引擎里**唯一合法的整批清场**，与"换脚本就清"无关 |
| `0x1FF` | sub_4230F0 | **真实现** | **DrawItem 像素平移**：`sub_4AC750(Scene, id, x,y,z)` 置 `+0x68=1`（用世界矩阵）+ `D3DXMatrixTranslation(+0x16C)` 写平移 **work** 矩阵，**立即生效无窗** → `native.setDrawTranslation`。★平移用**像素**、0x1FD 缩放用**百分数** |
| `0x208` | sub_4302E0 | **真实现** | **纹理尺寸 getter（会写回脚本操作数！）**：`sub_49ED60(Scene, 槽, &w, &h)` 读 `CTexture+1040/+1044` → **写回 op2/op3**。漏实现会让脚本拿到未初始化宽高 ⇒ **脚本层逻辑错误**（不只是画面问题）→ `native.getTextureSize` |
| `0x23B` | sub_424970 | **真实现** | **按 CG 数字条画数值**：先 `sub_4ABB60` 删 DrawItem+MeshEntry 的 `[op1, op1+op6)`，再按记录逐位 `sub_4ACE50` 建 DrawItem（三种对齐 / 补零 / id=个位自右向左）→ `native.drawCgNumber` |
| `0x23C` | sub_41A2C0 | **真实现** | **帧毫秒时钟**（名字像空操作，实为 `timeGetTime`）：`_this[92334]=_this[92333]; _this[92333]=now` ⇒ 0x20C 的"只刷时钟不渲染"版 |
| `0x2DA` | sub_426420 | **真实现** | **CG 数字条记录登记**：`op2..op8`（7 个 int）→ `Engine+388332+28*op1`（28 字节记录）。★文档旧写"8 字段"是把手写 op1 也算进去了 |
| `0x25B` | sub_425E20 | **真实现** | 消息态图像：`_this[92381]=op1`（模式 `92379` 由同族 0x25A 置 1=影片/2=图像）；不做图像解码（消息窗自绘） |
| `0x346`–`0x34E` | sub_427DD0…sub_428200 | 真·忽略 | **`Scene+1096` 的 572 字节「变换 / Live2D 立绘节点」族**：元素 `+4` 指向 Live2D 槽（`Scene+4*slot+55812`），消费方 `sub_4B0360` **只有该槽真有模型时才出画** ⇒ 无模型时天然无输出；0x34E 读文件失败会抛异常，emulator 走 no-op（不抛）。**不是 DrawItem** |
| `0x321` `0x325` `0x326` `0x207` | — | 真·忽略 | MeshEntry 属性块、消息对象字段、3D 雪花 `ID3DXEffect`（自带 `Scene+46668>=1` 门槛）、纹理槽 StretchRect 拷贝 —— **emulator 无对应模型**（分类依据见 `docs-new/03-engine/opcode-table.md` 对应行） |
| `0x340` | sub_427B60 | **真实现** | 渲染状态下发：写 `Scene+13948`（默认 3）+ 设备 vtable+228 发 `(22, op1)` → `native.setRenderState` |
| `0x34E` | sub_428200 | `native` 桩 | Live2D motion 加载（同族 0x346–0x34D 是 `engine-internal` no-op）；引擎读文件失败会抛异常，emulator 明确走**不抛**的桩 |

> **口径更正（2026 复核）**：`Scene+46516` 不是"**颜色**动画 pending"，而是**通用**的「仍有动画 / 目标变换插值待处理」
> （0x34B/0x34C/0x34D 的目标矩阵 setter 也置它，raw 134174/134231/134271；渲染路径 raw 136840 以它作"还需继续演算"判据）。
> emulator 里对应的是 `PixiBackend.needsRender()` / `sceneAnimationsDone()`（用各窗相位判断），语义一致但更细。

**实测命中**（跑 20 万步）：

```
[SYSTEM4 启动链] 渲染族命中：0x20c×2505 0x32f×5 0x23b×3 0x25b×1 0x248×1 0x352×1 0x1f6×1 0x344×1 0x2da×1
[TITLE]         渲染族命中：0x20c 若干 + 0x23b×3（CG 数字条画数值，id=0x6f/0x70/0x72）
[CONFIG2]       渲染族命中：0x20c×5115
[CONFIG1]       渲染族命中：0x20c×4379
```

> **端到端回归**：`test/draw-item-slot-coverage.test.ts` 跑到 TITLE 后统计——绘制项 12 个、已绑定纹理槽 7 个、
> **槽解析覆盖率 100%**（12/12）。这条测试正是为"op1/op2 写反 → 背景消失只剩色块"那类**静默**故障设的闸。

⇒ 设置界面路线上**只有 `0x20C`（每帧刷新）**会执行，**没有任何"清场"类渲染指令**——这进一步排除了
"某条渲染指令把背景清掉"的可能（背景消失只能来自渲染器自身的清空逻辑，见 `pixiBackend` 的说明）。


| 档 | 含义 | opcode | 说明 |
|---|---|---|---|
| **已实现**（`OPS`） | 按引擎语义完整实现 | `0x7F` `0x80` `0x300` `0x301`（消息窗字段读写）、`0xC0`/`0x131`（配置 getter）、`0x2CE`（显示模式）、`0x306`（`system:EffectSkipOnClick`）、`0x217`（对象变换→native）、`0x12F`（三数组排序）、`0x142`（写 `_this[174812]` 引擎开关） | 只是**不产出可渲染/可听输出**（消息窗不渲染、无声音子系统），语义本身是完整的 |
| **真·忽略**（`ENGINE_INTERNAL_OPS`） | 纯 no-op 插桩 | `op_engine_internal` 的 80+ 条（如 `0x20C`/`0x23D`/`0x196`/`0xC5`） | 引擎内部状态写入，emulator 无观测点 |

实测：从 `CONFIG2.BIN` 路线跑 20 万步，**需要人工桩跳过的 opcode = 0 种**。

> **曾经的第三档已删除**：早期把 `engine-internal` 分成「纯 no-op」与「已专门处理（`INTERNAL_WITH_HANDLER`，
> `StepTrace.noop=false`）」两档。该档是**结构性空**的 —— 只要 handler 真的写了操作数或引擎字段，
> 它就该在 `OPS` 里（`0x12F`/`0x142` 正是如此被误放，现已归位）；剩下的只有"什么都不做"。
> 因此那一档连同 `StepTrace.noop` 标志、控制窗里恒空的「已插桩·语义已实现」栏一起删除。
> **日志/控制窗口径**：`handlerKind` 三选一 —— `implemented` / `native` / `engine-internal`，
> 后者全部是纯 no-op；`OPS` 里的条目不出现在任何"忽略"栏。
| `0x100` / `0x101` / `0xCD` / `0x2FC` | … | `[已实现]` | 输入掩码/派发/推进门/触摸（无触摸恒 0） |

**`0x10D`（滚轮）要点**（分析见 `analysis/functions.json` 的 `op_read_mouse_wheel_42EF50`）：

- 引擎体：`v2 = _this[1949]`（累加器 byte **0x1E74**）→ **立即清零** → `writeIntOperand(op1, v2)`。
- 累加器只在 `WM_MOUSEWHEEL` 里 `+= (short)HIWORD(wParam)` 增长 ⇒ 单位 = 原始滚轮单位（**一格 ±120**）。
- **方向：上滚为正、下滚为负**（脚本实证 `src/$3$AGENCY.txt:548` `gr (local 403) 0` → 上滚翻上页）。
- 渲染窗 `wheel` 事件按 `-e.deltaY` 换算后 `input.addWheel()`（DOM 的 deltaY 下滚为正，与引擎相反）。
- **不随 `consumeEdges()` 擦除**：它是"读时消费"而非"按帧擦除"，否则轮询期间未读就丢
  （引擎里只有 `0x10D` 与消息泵的 ADV 推进分支会清它）。
- 脚本用法（40+ 菜单/列表）：进入时 `read-mouse-wheel` 丢弃残量 → 主循环 `read-mouse-wheel (local 403)` + `jcc (local 403) <翻页label>`。
- 测试：`test/wheel.test.ts`（读后清零 / 累加 / 负方向 / 不被 consumeEdges 清）。

---

## 缺口可见性：三闸门 + 场景执行报告（2026 新增）

### 为什么要这一套

模仿/复刻这个引擎有两层**性质完全不同**的工作：

| 层 | 内容 | 可否枚举 | 缺失时的表现 |
|---|---|---|---|
| **指令面** | 每条 opcode + 它对 VM/引擎状态的变更 | **可以**：逐条读 handler、能追调用链 | 抛 `NotImplementedOp`（看得见） |
| **常态能力面** | 引擎自己的逐帧流程与各子系统的持续行为（动画驱动器、转场、门控标志、惰性创建、资源生命周期…） | **不能靠 opcode 枚举** | **无报错，只是画面不对** |

第二层的发现路径只有"症状 → 研究"（例如版权页文字不淡入 → 才发现缺了逐帧插值）。因此这里的目标不是
"多实现几条"，而是**让缺失一定留下痕迹**：把隐性能力变成可数、可 diff、可定位的东西。

### 保真等级（取代含糊的"已实现"）

原先的"真实现"只说明**代码存在**，不说明**行为对**（实测有 11 个被调用的 native 方法宿主根本没实现，
而对应 opcode 全标着"真实现"）。统一改用证据等级：

| 级 | 含义 |
|---|---|
| **E0** | 未读体 / 未知 |
| **E1** | 已读体（静态结论 + raw 行号） |
| **E2** | 有**合成指令**单测（断言状态变更） |
| **E3** | 有**真实脚本的场景级**断言（快照 / 不变量） |
| **E4** | 与真机对照（截图或内部状态 dump） |

### 闸门 A：`?.` 不再静默（意图被丢弃）

`NativeBridge` 的方法几乎都是可选的，`c.native.setLight?.(...)` 在宿主未实现时会**静默变成空操作**。
现在渲染器用 `withNativeTap(pixi, recorder)` 包一层：未实现的调用被记成事件
（方法名 / 次数 / 最近实参 / **归因 opcode** / "缺了它会怎样"），控制窗单开一栏。
实现：`src/vm/nativeTap.ts`；测试 `test/native-tap.test.ts`。

### 闸门 B：能力缺口（被忽略但收到实参）

"被跳过"的指令里混着两类完全不同的东西：**本场景空转**（`i32f 0`）与**脚本真的想做点什么而我没做**
（`i213 1 19a28 1f4`）。`StepTrace.gap` 只对后者置位——判据是"该指令被当作 no-op 跳过、且操作数非平凡"
（立即数/池值 |v|>1，或任何指针/字符串/数组操作数）。控制窗单开一栏，带样例操作数。
实现：`interpreter.ts` 的 `formatOperands` / `significantOperands`；测试 `test/capability-gap.test.ts`。

### 闸门 C：死写检测（写了但没人读）

另一类**完全无报错**的缺陷："字段写进模型、VM 正常推进、日志一切正常，但渲染器从不读它 ⇒ 效果不出现"。
`npm run check:dead-writes` 扫出"有写无读"的模型字段；`dead-writes.baseline.json` 登记已知项与其理由，
`test/no-dead-writes.test.ts` 做 **ratchet**：**新增**死写直接失败。
实测抓到的第一条就是真缺口：`Item.blend`（引擎 `DrawItem+0x30` = `0x203` 的 op2 混合模式）**没有消费者**。

> 注意：静态版刻意**排除诊断读取**（`scSnapshot`/`snapshotToText`/`debug*`），否则"报告里读了一下"
> 会让字段看起来是活的。局限也写明在文件头：它只用于**防新增**，不构成"一定没人用"的证明。

### 场景执行报告（`npm run report`）

在 Node 里跑一段真实脚本，产出「这场景到底发生了什么」：

```bash
npm run report -- --steps 200000 --name title
#   → .tmp/title.jsonl  每条执行到的指令一行 JSON（--ops 1fb,202 可收窄白名单）
#   → .tmp/title.json   per-op 计数 / 能力缺口 / 丢弃的意图 / 纹理槽表 / CG 记录 / 引擎字段 / 最终快照
#   → .tmp/title.txt    人可读的模型快照（快照回归里真正被 diff 的东西）
npm run report -- --steps 200000 --ops 1fb,202,203,208,23b   # 只看渲染族
```

关键设计：**确定性时钟** —— 每遇到一个"帧指令"（`0x1F4`/`0x20C`/`0x23C`）就把虚拟时钟推进固定毫秒并驱动一次
场景窗，因此同一条脚本跑两次的报告**逐字节一致**（`test/scene-report.test.ts` 已锁死这条性质），可以进仓库做 diff。

宿主是 `HeadlessScene`（无 Pixi/Electron），它与真实渲染后端**共用同一份语义**（见下），所以报告里的模型状态
就是渲染器看到的状态。测试 `test/scene-report.test.ts`。

### 链路指令盘点（`npm run op:inventory`）

`report.ts` 只看**单个脚本**；要回答「**从启动到某个界面，这条路上哪些指令没完全实现**」，
得跟着真实链路（`SYSTEM4 → … → TITLE → 点 CONFIG → CONFIG1`）逐条记：

```bash
npm run op:inventory
# 表 1：执行到的 opcode → handler 来源（implemented/native/engine-internal）+ 次数 + 脚本 + 实参样例
#       （`native` **不等于**"没实现"：0x1FB draw-texture 是真实现，0x204 draw-string 是纯记录桩）
# 表 2：宿主未实现 ⇒ 调用被丢弃（闸门 A：NativeBridge 方法被调但宿主没有）
# 表 3：图像渲染 / 文字输出相关、且未完全实现的指令（按 opcode-table 家族归类 + 一句话定性）
```

实现要点：`runConfig1Chain({ onStep, recordDrops })` —— 盘点回调与 `withNativeTap` 都**默认关**，
所以既有测试/工具不为盘点付代价（数十万条指令的链路，多一次回调就是实打实的开销）。

2026 用它查出的典型缺口：`0x1FD` 被登记成"已实现"、实际只把参数转发给宿主而渲染端只记一行日志
（CONFIG1 滚动条拇指的中段就是这么丢的）；`0x204 draw-string` 的 9 次调用**整体丢弃**（CONFIG1 右侧说明条画不出来）。

### 纹理的销毁时机：**别在舞台还引用它的时候销毁**（2026 黑屏事故）

Pixi 的 ticker 每帧自己 `app.render()`，而 `present()` 只在 **VM 跑完一批指令之后**才重建舞台。
于是 `create-texture`/`release-texture` 里**当场** `texture.destroy(true)` 时，舞台上仍挂着上一帧引用它的
Sprite ⇒ 紧接着的一次 ticker 渲染去画已销毁的纹理 ⇒ **WebGL 批次损坏、此后画不出任何东西**：
现象是「切到某页后整屏只剩背景色，VM 照跑、日志空白」（异常在 ticker 回调里，不在我们的调用栈上）。

修法：同尺寸 `create-texture` **复用画布**（清空 + `source.update()`）；换尺寸/`release-texture` 的旧纹理
进 `DestroyQueue`，由 `present()` **之后**的 `collectGarbage()` 统一销毁。
另外渲染进程现在会把 `window.onerror`/`unhandledrejection` 写进日志（`[renderer-error]`）。
守卫：`test/texture-lifecycle.test.ts` + E4 目视回归 `npm run shot`。

### 自动截图（`npm run shot`）—— E4 目视回归

模型对 ≠ 画面对。这条工具用**主进程合成鼠标事件**跑一遍真实链路（TITLE → CONFIG → 左侧各分类），
再用 `capturePage()` 截图，并在"几乎全黑"时给显眼提示 —— 上面那次黑屏就是它抓到的：

```bash
npm run shot                    # 默认：CONFIG1 → 角色设定 → 回第 1 页
npm run shot -- --tabs 5,3,4    # 指定要点哪些左侧分类（0..5）
# 产物：.tmp/shot-*.png ；时序一律"等日志出现装载标记"，不睡固定秒数（机器忙时会误判成全黑）
npm run boot:time               # 只量"启动 → 到 TITLE 用了多久"（分辨「慢」与「卡住」）
```

> ★**截图工具必须关掉 Chromium 的后台节流**（`tools/shot.cjs` 顶部三行 `app.commandLine.appendSwitch`）：
> 主进程是脚本自己、窗口不在前台时，`requestAnimationFrame` 会被降到极低频 ⇒ 渲染循环几乎不推进 ⇒
> **启动链永远到不了 TITLE、截出来的全是黑图**（2026-09 实测：60s 内 VM 时钟只走到 1.8s，停在
> LOGO 的 `0x400` 动画等待门）。这与"渲染崩了"的症状一模一样，但其实是工具环境问题 ——
> `disable-renderer-backgrounding` / `disable-backgrounding-occluded-windows` / `disable-background-timer-throttling` 三条即可。

### 帧局部池：**一次载入 = 一次新调用**（`loadScriptIntoFrame` 会清池）

引擎 `sub_40ED40` 载入脚本时**重建局部池**（`local_int` 填 `enc_zero`），所以帧槽被复用
（脚本 `exit` 之后又被调用方 `call-script` 调回来最典型）时看不见上一次的局部量；**全局池不清**
（跨脚本状态，如"上次选的分类"）。emulator 侧落点是 `Frame.locals.clear()`（见 `handlers/control.ts` 长注释）。

漏掉它的症状（2026 实测）：「设置界面第一页滚到底 → 切左侧分类」时 `CONFIG1` 重入，
滚动起点 `local5620=6` 从上一页漏过来、而新一页最大起点只有 3
⇒ 拇指顶 `106+(428−拇指高)·5620/5624 = 320`，**滚动条溢出轨道**。
守卫：`test/call-frame.test.ts`（载入即重建 / 固定帧反复调用保留）+ `test/config1-chain.test.ts`
的滚动探针（`npm run report` 风格的 E3：滚到底→切分类→再切回，四步的 `0 ≤ start ≤ maxStart` 与拇指都在轨道内）。

### 共享场景模型（消除"两份语义"）

`src/renderer/sceneModel.ts` 持有全部"纯数据"变更（建/删项、5 个窗、"缺失即建项"、bit0 门控、CG 数字条几何、
区间删除），`PixiBackend` 与 `HeadlessScene` 都只做副作用（画到 Pixi / 记进快照）。
**这是为了消灭"报告说对、画面不对"这类最难查的漂移** —— 之前 glue 内联在 `PixiBackend` 里，
一旦要写无渲染版就必然产生第二份语义。

#### 顺带修正的两个真 bug（本工具第一次跑就查出来的）

1. **`setter` 对不存在的项是"缺失即建项"，不是丢弃**：引擎所有 DrawItem setter 都先调 `sub_4AAA50`
   （找不到 key 就用 `sub_49A300` 建一个**全 0**元素再插入 map,`raw 130028-130046`），而构造器把 `flags`
   清 0（`raw 116899`）。于是：
   - `0x203`（无门控）**建项 + 写 FROM**；`0x202`/`0x21E`/`0x21F`/`0x220`/`0x239` 有 `flags & 1` 门控 ⇒ **只建项**；
   - 这解释了"**先设色后画**"为何能成立（色写在 flags=0 的空项上，之后 `draw-texture` 只补 bit0 与纹理）；
   - 修正前 emulator 直接丢弃这类写入 —— 一条 TITLE 路线实测有 **31+31 次**被丢掉。
2. **渲染必须过 bit0 门**：引擎渲染器 `sub_4AEEA0` 以 `(*elem & 1) != 0` 为绘制门（`raw 133361`），
   所以"缺失即建项"建出的空项**不出画**。emulator 早前漏了这个门。
3. 附带：`0x1FB` 的 `sub_4ACE50` 会**覆盖**描画位置（写 `+36/+40/+44`），因此早前"把 0x219 的值暂存、
   建项时套用"的 `posOverride` 机制与引擎不符，已移除（顺序由脚本决定）。

### ★文本样式的**作用域**：入队时钉住，全局改动不回溯（2026-09 用户实测缺陷）

症状：设置界面的**角色设定**页里角色名有多色，但**下方 ADV 样例窗的字被染成了最后一个可见角色名的颜色**。

引擎事实（`docs-new/03-engine/adv-text-rendering.md` §3.5，台账 `text-style-scope-queue-time`）：
字体/颜色/描边/竖排这些"当前样式"只有**一套**字段（`Font+1360/+1364/+1372/…`），而它们是在
**排版入队那一刻**被消费的 —— `0x6E show-text` → `sub_46BE30` 把字形**连同当时的颜色**画进该窗的离屏表面；
`0x76` 那一路的收尾 `sub_459F40` **只重建 GDI 字体对象/字宽，一行字形都不重画**。

于是模型的正确做法是：
- 入队（`0x6E`/`0x196`）时把样式钉进 `MsgSlot.fontStyle`（`FontStyleSnapshot`）；
  `styleOfWin` 对**几何**读实时窗字段、对**字体/颜色/描边/竖排**读快照；
- 全局样式指令**不得** `emitAllWins`（旧行为 = 缺陷根因：`CONFIG2` 逐行 `i076 <该行名色>` 会把 win 9 一起改色）；
- `0x204 draw-string`（CONFIG1/CONFIG2 的行文本）相反：**立即**消费全局样式，改设置立刻生效。

守卫：`test/text-style-snapshot.test.ts`（单测 + E3 真实语料探针 `runConfig1Chain({previewProbe:true})`：
切到角色设定页后 win 9 的颜色恒为入队色 `#ffffff`，而全局色已走过 `#67bf4d → #b690ff`）。

### ★程序化纹理槽的直绘文本：画布必须按 DPR 光栅化（2026-09 用户实测「非 ADV 窗口的字整体像粗体」）

症状：非 ADV 窗口（设置界面的设置行/值、存档列表、HUD…）的文字看起来**整体比消息窗文本粗一档**，
而脚本给这些文本的字重其实是 **400**（探针实测：`CONFIG1` 的 13 次 `0x204 draw-string` 全是 `weight=400`、
`mode=1 dx=0 dy=0`）—— 也就是说**不是**加粗，是**糊**。

根因：两条文本路径的**光栅化分辨率不一致**（同一块 Pixi 舞台 = logical 1280×720 @ `resolution=DPR`）：
- 消息窗（`rasterFrame`）：建 `ceil(逻辑×DPR)` 的画布 + `CanvasSource({resolution: res})` ⇒ 清晰；
- `0x204 draw-string`（直绘进 `0x1F8 create-texture` 的表面）：画布按**逻辑尺寸**建、`resolution` 默认 1
  ⇒ 纹理被**放大 DPR 倍**显示 ⇒ 笔画边缘糊开、观感变粗。

实测（`npm run shot`，DPR=1.25，取「窗口显示」四字的白游程均值）：**4.12px → 3.37px**
（同一字体 25px 由 PIL/FreeType 直接渲染 = 3.19px；`628×360` 的槽现在建 **785×450** 画布）。
日志两条路径现在都带 `@1.25x` 标记（`createTexture … @1.25x` / `drawString … @1.25x w=400`）。

修法（`src/renderer/pixi/textureCache.ts`）：`create()` 用 `canvasPixelSize(w,h,res)`（与 `rasterFrame` 同为 `ceil`）、
`CanvasSource` 带 `resolution: res`、`drawString()` 先 `ctx.setTransform(res,…)`、画布复用判定加 `res` 比较。
`cropSprite` 的 frame 本来就是**逻辑**坐标（Pixi 按 `source.resolution` 折回逻辑尺寸）⇒ 无需改动。
守卫：`test/draw-string.test.ts` 的 `canvasPixelSize` 口径断言（含「与消息窗 615×115 同公式」一条）。

### ★加粗策略：`i2bd/i2be`（`Font+218516`）→ **真 Bold 面**（2026-09 已落地，选 A）

引擎：`0x2BD`（`sub_426200` raw 33384-33402）把 `Font+218516`/`+1248` 写成 **700/0** 并 `sub_459F40` 重建 GDI 字体；
`Font+1248` 初值 **0**（= Regular，`sub_465390` raw 78854）。全语料 `i2bd 1` **904 处**、`i2bd 0` **144 处**
（`CONFIG.txt:158/209`、`CONFIG1.txt:2901/3030/3059`、`CONFIG2.txt` 5 处、`$n$SC*/SG*` 大量）。

**做法**：给 `Amayui CN` 补一面**真 Bold**（`res/fonts/Amayui-CN_cnjp-Bold.ttf`，SarasaGothicSC-Bold
基底 + 同款 cnjp 替换 + name/OS2 定制，步骤与实测数据见 `docs/font-build.md` **§8.7**），
`fontSet.ts` 的 `Amayui CN` 登记 `{400: 常规面, 700: Bold 面}` ⇒ `fontFaceFor(…, 700)` 用 Bold 文件并按
**700** 注册，浏览器**不再合成**加粗。旧方案（只有 Regular ⇒ 让浏览器合成）与它写在注释里的
WenQuanYi 时代理由都已作废；`fontFileList()` 也改成"只列真面"（旧实现用 `files[w] ?? files[400]`
把同一份 Regular 同时说成 400/700，与 `fontFaceFor` 口径矛盾）。

证据（`npm run shot`，DPR=1.25）：
- 日志两张面都加载真文件、**没有**合成提示：`[font] Amayui CN#700 ← Amayui-CN_cnjp-Bold.ttf（23416KB）` +
  `[font] Amayui CN#400 ← Amayui-CN_cnjp.ttf（23568KB）`；
- `CONFIG1` 页 ADV 样例窗（探针实测 `weight=700`）白游程中位/均值 = **5.0 / 6.96**，
  与 PIL 用真 Bold 面在 37px（= 30 CSS px × 1.25）下的 **4.0 / 6.61** 同一档；
  而 30px Regular 只有 **2.0 / 3.19** ⇒ 确实是"真粗体"而不是回到常规字重；
- 目视：`.tmp/bold-real-sample2.png`（干净的 Sarasa Bold，不再是糊开的合成粗体）。

守卫：`test/font-bold-face.test.ts`（族名配对 `Amayui CN`+`Bold`、`usWeightClass=700`/`fsSelection.BOLD`、
932 码页声明、全字库外接框面积 +4.8% 证明不是"改名版 Regular"）+
`test/text-layout.test.ts`（700 走 Bold 文件；**不许把同一文件同时登记成 400 与 700**）。

### 症状驱动的定位流程

```
① 记症状：哪个脚本/label、哪一帧、截图
② 取该场景的执行报告：npm run report -- --steps N [--ops …]
     → 这场景跑了哪些 op、各多少次、带什么实参、最终模型长什么样
③ 对可疑字段问两句： 「谁写它」（②已回答） / 「引擎里谁读它」（grep raw）
     引擎有读者、emulator 没消费者 ⇒ 缺口定位完成（Item.blend 就是这样抓到的）
④ 读引擎代码 → 实现 → 加守卫（E2 合成单测 + E3 场景断言）→ 更新台账 + 快照
⑤ 快照 diff 归档：任何语义变化都必须在 diff 里被解释
```

### 进度度量（不是"实现了 N 条"）

| 指标 | 方向 |
|---|---|
| 指令面：达到 E2 / E3 的 opcode 数（分母见 `scripts/asm/opcodes.json`） | ↑ |
| 常态能力面：`analysis/engine-capabilities.json` 里 `modeled-verified` / 总数 | ↑ |
| **静默缺口**：未实现 native 调用种数＋非平凡 no-op 命中种数＋死写字段数 | **↓** |
| 快照：入口场景数 × 稳定性（连续跑 diff 为空） | ↑ |

### 事故复盘：一次"卡顿 + 关不掉窗口"（2026）

**症状**：emulator 卡顿严重；TITLE 点击「退出」后像卡死；**连窗口都关不掉**。

**排查**（顺序即"先量化、再猜"）：

| 步骤 | 手段 | 结果 |
|---|---|---|
| ① 指令是不是慢？ | 无头跑真实脚本测吞吐 | **30–62 万步/秒** ⇒ 指令执行**不是**瓶颈 |
| ② 谁在拖？ | 看落盘产物 | `.tmp/scene-trace.jsonl` = **109 MB**（约 21.7 万行） |
| ③ 为什么这么大？ | 读代码 | 上一版"场景执行报告"**默认对每条指令发一次 IPC**，主进程再 `fs.appendFileSync` **同步**写一次 ⇒ 主进程被同步写盘打满，**窗口关闭（主进程动作）也做不了**；渲染窗的 `log-line` IPC 也排不上队（19KB 日志里只剩 8 条 input-state） |
| ④ 输入坏了吗？ | 无头复现点击（`HeadlessScene` + `InputManager`） | **没坏**：5 个菜单项在"按住→抬起"后各自正确派发；键 4 = 退出 → `QUIT.BIN` → EXIT |

**真正的两个成因**

1. **IPC 洪泛**（我引入的回归）：逐条写 JSONL + 主进程同步写盘。
   已修：JSONL **默认关闭**（只在控制窗显式设置 opcode 白名单时才记）+ **分批发送**（≤200 行/次）；
   主进程的异步日志/轨迹改用 `WriteStream`（非阻塞），只有关窗前的 `log-line-sync` 保留同步。
2. **输入竞态**：TITLE 的菜单派发要求 VM **在"按住"期间轮询到一次**（脚本用 `3fb` bit0 做 debounce），
   再在"抬起"后派发。一轮 VM 批可达上万条指令，浏览器的**一次快速点击（down+up）可能整段落在两次轮询之间**
   ⇒ 脚本从未看到按下 ⇒ 菜单永不派发（"点了没反应"）。
   IPC 洪泛恰好把循环拖慢，使**每一次**点击都变成"太快"。
   已修：`InputManager.pressLatch`（按下保持到**被读到一次**为止，读时消费；与滚轮 `consumeWheelDelta` 同思路）
   —— 这是保真性措施（引擎 60fps 轮询真实按钮态，几十毫秒的点击必跨若干帧），不是新语义。

**回归守卫**：`test/title-exit.test.ts`（正常点击 + **快速点击**都必须走到 `QUIT.BIN` → EXIT；外加 pressLatch 单测）。

**下次怎么一眼判断"慢还是坏"**：控制窗新增「性能」行 —— `指令/秒`（正常 30–60 万）+ `门`（`0x400`/`sleep`/`paused`）
+ **门持续时长**（>3s 会变橙：**卡住**，不是慢）+ `JSONL 行数`（猛涨即说明 trace 命中过多）。
另加「**强制关闭（主进程）**」按钮：只在主进程执行、不依赖渲染窗，卡住时一定能收场。

### 能力台账（第二层的清单）

`analysis/engine-capabilities.json`（数据层）+ `docs-new/03-engine/engine-capabilities.md`（人可读，由
`node scripts/build-capabilities.mjs` 从数据层生成）。条目来自**四组机械枚举**——它们把"隐性"变成有限清单：

| 枚举口径 | 得到什么 |
|---|---|
| **帧入口** | 每帧必然执行、但不属于任何 opcode 的东西（帧提交链、转场收尾、脚本队列派发…） |
| **时钟读者** | 每个读 `Scene+46500` 的地方 = 一个逐帧驱动器（5 窗 / mesh 颜色窗 / 转场窗…） |
| **门与标志读者** | 每个被每帧读的开关字节（脏 46508 / 冻结 46512 / pending 46516 / 无渲染 167990…）+ 谁清它 |
| **惰性创建** | `if (!slot) 建` 形态的子系统对象（effect / 纹理槽 / mesh 槽 / L2D 槽 / 字体…）与释放点 |

**当前体检（95 条）**：已核验 **17** / 已建模未核验 **7** / 部分 **20** / 缺失 **26** / n/a **25**
（n/a 必须写明 why，由 `test/capability-ledger.test.ts` 强制）。**需要关注 53 条** —— 这就是
"看起来都实现了、效果却有 bug"的量化答案。其中与 2D 表现直接相关的高风险缺口举例：

- `transition-table-flush` / `clock-read-transition-window`：**转场表未建模** ⇒ wipe/淡入淡出过场不显示；
- `scene-freeze-flag`(46512) / `scene-flag-46528-bits`：**动画强制冻结未建模** ⇒ 该冻的时候还在播；
- `vertex-buffer-lock-scale`：**mesh 顶点几何未建模** ⇒ mesh 只能画成整屏色块；
- `lazy-gdi-font-set`：**消息窗文本渲染未建模** ⇒ 文字不显示；
- ~~`script-queue-dispatch`：**脚本派发队列未建模** ⇒ 依赖"延迟派发"的流程不会发生（`0x143` 是 no-op）；~~
  **已转真实现（E3）**：`append-pack-discovery-and-activation` —— `0x143`（`i143`）现在按 `FileDB.packs` 槽序
  派发每个已装载扩展包的 `$n$AUTORUN.BIN`（帧 37 + `-10` 哨兵链），见 `test/append-packs.test.ts`
  （真实语料跑完 5 包的派发链 ⇒ `global 7087f5` 第 1..5 位置起；标题画面左下角 6 个 INSTALL 徽章即该掩码的可见效果）；
- `scene-norender-mode`：**语义冲突待复核** —— 我们把 `display:ScreenMode` 绑到了 `167990`，
  而引擎里它是「无渲染/隐藏窗口模式」；
- `lazy-572b-node-map` / `render-merge-two-pass-reorder`：**572B 节点表未建模** ⇒ 四路归并只有两路。

> 台账的 `guard` 字段指向真实测试文件（测试会校验文件存在），所以"声称已核验"不能空口说。

### 脚本台账（第三层的清单）—— 「这个界面脚本长什么样」别再重读一遍

`analysis/scripts.json`（数据层）+ `docs-new/05-scripts/`（人可读，由 `node scripts/build-scripts.mjs` 从数据层生成）。
每个**被分析过的** `src/*.txt` 一条：`role`/`entry`（是什么、谁 call 它）+ `layout`（读过的行区间 + 锚点 + 职责）
+ `slots`（关键槽/局部量）+ `invariants`/`gotchas`/`gaps` + `links`（回链第二层能力 id、第一层函数 addr、主题文档）+ `guards`。

为什么单列一层：设置界面的「可见项表是 36df/179f/273f 三数组、靠 `i12f` 排序、切分类 = 退出后重入、
**帧局部池必须在装载时重建**」既不是函数语义、也不是引擎常态行为，以前只活在代码注释里 ⇒
同一个界面被反复重读了几千行反汇编（见 `docs-new/05-scripts/CONFIG1.md` 的坑）。

```bash
node .agents/skills/amayui-engine-analysis/scripts/scripts.js --index       # 读过哪些脚本（状态/段数/槽数）
node .agents/skills/amayui-engine-analysis/scripts/scripts.js --id CONFIG1   # 精查某个脚本的结构与坑
node .agents/skills/amayui-engine-analysis/scripts/scripts.js --coverage     # 还没登记的 src/*.txt（提醒，不是 KPI）
node scripts/build-scripts.mjs                                               # 重生成 docs-new/05-scripts/（勿手改 md）
```

★**锚点棘轮**：每条 `layout` 的 `anchor` 必须**真的出现在它声明的行区间内**（`test/script-ledger.test.ts` 逐条核对真源）。
好处有两面：一是"凭印象编造结构"过不了关；二是 `src/*.txt` 一旦翻译 reflow 重排行号，守卫**必然变红**，
逼人刷新行区间 —— 结论不会悄悄失真。覆盖率**不要求凑数登记**（当前 6 / 941，没读过的宁可空着）。

---

## 控制窗（ControlWindow）

一个独立小窗（`control/`，与主窗口同 preload），用于在不重启的前提下操纵正在跑的 VM：

| 控件 | 作用 |
|---|---|
| **重启** | reload 主窗口渲染器 → 重跑完整 boot（清掉所有「已跳过」桩） |
| **启用指令日志** | 切渲染窗的逐条 trace（`traceAll`）：关=只记「已忽略/未知」，开=全量（节流 ≥100ms） |
| **定向 trace（opcode 白名单）** | 填 `1fb,202,203` 之类 → 渲染窗只把这些指令写成结构化 JSON 行到 `.tmp/scene-trace.jsonl`（空=全部）。这是"看某一族指令到底怎么被调用"的正确姿势（全量 trace 会刷屏） |
| **⏸ 遇到不认识的指令 → 作为桩函数跳过并继续** | 见下 |
| **★ 意图被丢弃（闸门 A）** | 宿主未实现的 native 调用（`?.` 静默 no-op）：方法名 ×次数 + 归因 opcode + "缺了它会怎样" |
| **★ 能力缺口（闸门 B）** | 被跳过、却收到**非平凡实参**的指令（= 脚本真想做事而我没做），行首标来源 `[忽略]`/`[已跳过]`，悬停看最近实参 |
| 已跳过 / 真·忽略 清单 | 控制窗把"被跳过"的指令分成**互斥的两栏**：**已跳过**= 用户点按钮登记的运行时桩（`user-stub`）；**真·忽略**= 纯 no-op 插桩（`op_engine_internal`）。★收到非平凡实参的那些会被**提升到「能力缺口」栏**，并从这两栏移除 —— 否则同一条指令会在面板上出现两次（实测 21 条"真·忽略"里有 16 条与"能力缺口"重复）。各栏每行都写成 **`0x0b5 i0b5 ×12`**（指令码 + 助记符），各带 **「复制全部」**。★**行首的 `0x…` 不能省**：缺名指令的助记符是 `i0b5` 这种"i + 三位十六进制"，2026-09 用户实测把它读成 `0x05B`（`ne`，其实已实现）而误以为"已实现指令被当成缺口" |

### 未知指令 → 桩跳过（可恢复的硬停）

原行为：`stepOnce` 遇到四处表（`OPS` / `NATIVE_OPS` / `ENGINE_INTERNAL_OPS` / 用户桩集）都查不到的 opcode 直接抛
`NotImplementedOp`，渲染循环 `break outer` **彻底停住**，只能改代码重启。

现行为（见 `src/vm/interpreter.ts` + `src/renderer/renderer.ts` + `control/control.ts`）：

1. `stepOnce` **查表/抛错阶段不修改任何 VM 状态**（不读操作数、不推进 `ip`）—— 这是恢复的前提。
2. 渲染窗捕获 `NotImplementedOp` → 记下暂停点 `pausedOp`（opcode/助记符/脚本/byteOffset/ip）→ 上报控制窗 →
   `break` 本批指令（**不再 break 外层**）：外层循环继续每帧 `present()` 与状态上报，VM 停住但与控制窗保持通信。
3. 控制窗显示「⏸ 遇到不认识的指令，已停住」块 + 按钮「作为桩函数跳过：0x… xxx」。
4. 点按钮 → `controlSkipOp(opcode)` → main 转发 `renderer-skip-op` → 渲染窗执行
   `e.unknownOpStubs.set(opcode, …)` 并清空 `pausedOp` → 下一批对**同一条指令**重试 `stepOnce`，
   此时 `resolveHandler` 兜底命中用户桩（`handlerKind='user-stub'`，纯 no-op，`ip` 正常 +1）→ **原地继续执行**。
5. 其余错误（非未知 opcode）仍走原硬停路径（上报 + 停止）。

> **语义代价（务必清楚）**：用户桩是**无副作用 no-op**，不读操作数、不写操作数、不做跳转。若被跳过的 opcode
> 原本会写 `op1` 或产生条件跳转，后续状态会与真引擎不符（`op1` 保留旧值、跳转不发生）——这是「先跑通链路」
> 的取舍，**不是实现**。已跳过的 opcode 会列在控制窗「已跳过指令」清单里，随时可回补精确语义。

用户桩登记在 `Engine.unknownOpStubs`（per-instance，不污染 `ops.ts` 静态表），因此已知 opcode 永不被遮蔽：
解析顺序恒为 静态实现 → native → engine-internal → **用户桩兜底**（测试见 `test/skip-unknown.test.ts`）。

---

## 一句话架构

```
[主进程]  资源 + 生命周期（electron/）：文件/归档/AGF 解码经 IPC；窗口与控制面
   ▲ IPC（契约见 src/renderer/ipcProtocol.ts）
[渲染进程] 解释器核心（纯 TS，src/vm/）
   - Engine / Frame / 按类型分池的全局·局部变量（ADR-003）
   - opcode 注册表三张：OPS(implemented) / NATIVE_OPS(native) / ENGINE_INTERNAL_OPS(engine-internal)
     · 实现按引擎子系统拆在 src/vm/handlers/*（ops.ts 只做再导出）
   - 读写原语 (readInt/Float, writeInt/Float, DEC/ENC)
   - NativeBridge 调用 → Pixi 渲染后端 / 无界面桩
```

- **文件访问全部走异步代理 `FileSource`**（`src/arch/fileSource.ts` 接口；宿主用 `NodeFileSource`，将来 renderer 换 `IpcFileSource`）。
- **插件点** = `dispatch[]` 可替换（ADR-009，后置）。
- **观测点** = 解释器步进 hook（每帧/每指令回调，供日志/调试/校验）。

## 目录结构

> **2026 重构**：原先若干"什么都往里塞"的大文件已按**引擎子系统**与**职责**拆开
> （`vm/ops.ts` 1723 行 → `vm/handlers/*`；`renderer.ts` 的 388 行 `main()` → `renderer/app/*`；
> `pixiBackend.ts` → `renderer/pixi/*`；`drawItem.ts`/`sceneModel.ts` → `renderer/drawitem|scene/*`）。
> 对外 import 路径保持不变（原文件退化为再导出 barrel），因此测试与调用点零改动。
> 拆分原则：**一个模块 = 一个引擎子系统或一个明确职责**，"某 opcode 归哪里"只有一处可查。

```
app/amayui-emulator/
├─ docs/            # 背景/ADR/计划/启动链分析/函数注册表/渲染后端
├─ control/         # 控制窗：control.ts(状态+IPC) / dom.ts(句柄表) / listView.ts(通用清单) / clipboard.ts
├─ electron/        # Electron 壳：main.ts(仅生命周期装配) / paths / logging / windows / ipc/{files,control} / preload
├─ src/
│  ├─ arch/         # FileSource 抽象 + Node 实现（异步文件代理）
│  ├─ renderer/     # 宿主与渲染
│  │  ├─ renderer.ts        # 入口（装配 → 注册控制指令 → 跑主循环）
│  │  ├─ app/               # boot / configBoot / session(门控主循环) / telemetry / traceLog / jsonlWriter
│  │  ├─ drawitem/          # 模型层：model / animWindow / colorMath / eval / setters / cgDigit
│  │  ├─ scene/             # 共享场景语义：state / ops(所有 sc*) / snapshot
│  │  ├─ pixi/              # Pixi 后端实现：appSetup / inputAttach / textureCache / presenter
│  │  ├─ pixiBackend.ts     # NativeBridge 实现（场景语义一律委托 scene/ops）
│  │  ├─ headlessScene.ts   # 无渲染宿主（报告/快照回归），与 Pixi 共用 scene/ops
│  │  ├─ ipcProtocol.ts     # 跨窗协议：window.api 声明 + ControlStatus DTO
│  │  ├─ renderStatus.ts / viewport.ts / ipcFileSource.ts / index.html
│  ├─ script/       # lzss / alf(索引) / bin(SYS4450 解析)
│  ├─ util/         # 字节读取
│  ├─ tools/        # 死写检测（闸门 C，ratchet）
│  ├─ opcodes.ts    # opcode→{name,argc}（由 scripts/asm/opcodes.json 派生）
│  ├─ engineConfig.ts / run.ts / report.ts
│  └─ vm/           # VM 核心
│     ├─ engine / interpreter / operand / ref / bits / step / input
│     ├─ native.ts（NativeBridge 契约） / stubNative.ts（无界面桩）
│     ├─ nativeTap.ts（闸门 A：意图被丢弃可数）
│     ├─ ops.ts     # **稳定入口**：再导出三张注册表
│     └─ handlers/  # 按子系统拆的 opcode 实现 + index.ts 拼装注册表
├─ test/            # 单元 + 管线级（xval / boot / scene-report / 死写 ratchet）
└─ package.json     # run / test / report / typecheck / verify / dev:electron
```

**构建产物分离**：`npm run build`（tsc，类型检查 + 声明）输出到 `dist/tsc/`；
`npm run build:electron`（esbuild，打包 IIFE/CJS）输出 `dist/renderer|control|electron`。
两者不再争抢同一个 `dist/renderer/renderer.js`（历史上 tsc 会把 IIFE 包覆盖成 ESM，页面直接白屏）。

## 权威事实来源（本工程其它目录）

- **新文档体系（权威）**：[`docs-new/`](../../../docs-new/README.md) —— 引擎主题 `03-engine/`、脚本台账 `05-scripts/`、
  汉化 `01-translation/`、数据 `02-data/`、app `04-app/`。旧的 `docs/`（含 `docs/re/engine/`）**已作废**，仅作历史参考。
- **三层数据层（唯一会增长的地方）**：`analysis/functions.json`+`fields.json`（函数/偏移是什么）、
  `analysis/engine-capabilities.json`（引擎常态行为）、`analysis/scripts.json`（脚本台账）；
  它们的 md 渲染物分别是 `docs-new/03-engine/engine-capabilities.md`、`docs-new/05-scripts/*`（**勿手改**）。
- `this` 对象模型：[`engine/engine.hpp`](../../../engine/engine.hpp)
- ~~重定型成员化视图（语义参考）~~：**已废弃**（原 `engine/engine.cpp`，`retarget.py` 生成；libclang/AST 改写已放弃，改用数据层 `analysis/*.json` + 原始基准 `engine/天结_unpacked.exe_utf8.c`）
- 脚本反汇编：[`src/*.txt`](../../../src/)；松散字节码 BIN：[`raw/`](../../../raw/)；ALF 提取：[`raw-parts/`](../../../raw-parts/)
- 历史（作废）：`docs/re/engine/` 15 篇、`docs/re/engine/06-opcode到handler映射表.md`（真源已迁至 `docs-new/03-engine/opcode-table.md`）

---

## 进度看板

（实施者在此勾选，`docs/03` 同源。每次完成一里程碑更新。）
- [x] M0 代码骨架 + BIN 读取器 —— 已完成：异步 FileSource 代理 + SYS4450 解析 + 最小解释器步进（解析 vs `src/*.txt` 逐条一致测试全绿）
- [ ] M1 VM 核心解释器 —— **进行中**：文件策略改为只依赖 `raw/`（松散优先，否则 ALF 切片）；SYSTEM4 初始化段已越过并进入 call-script 链；新增「引擎内部/子系统 → 插桩跳过」（~24 opcode 已读体归类）；输入簇已接真值（`0x108` 按钮 / `0x109` 位置 / `0x10D` 滚轮增量 等）
- [ ] M2 启动链 opcode 清点/分类
- [ ] M3 无界面跑到 TITLE（第一里程碑）
- [ ] M4 差分验证
- [ ] M5 子系统真实现
