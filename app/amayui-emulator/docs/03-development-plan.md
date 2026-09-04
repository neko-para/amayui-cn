# 03 · 开发计划与里程碑

> 目标严格对齐：**第一里程碑 = 无界面地让解释器执行启动链，并正确运行到 `TITLE` 脚本的执行点**（`src/TITLE.txt`）。
> 本计划按「先拿 VM 核心、再摊平未知」铺开；每个里程碑有明确的「完成定义（DoD）」。

---

## M0 · 代码骨架 + BIN 读取器（🔨 首先做）

**范围**：
- 建立 `app/amayui-emulator` 工程（`package.json`、`tsconfig.json`、`src/`、`docs/`；可先纯 Node 壳，暂不用 Electron）。
- 自实现 **SYS4450 v4 BIN 读取器**（见 ADR-007）：解析头、指令流、字符串表、label。
- 编写 1 个单元测试：读入 `raw-parts/DATA1/TITLE.BIN`（或 `raw/SYSTEM4.BIN`），断言「opcode 序列 / 字符串表 / label 数」与 `src/TITLE.txt` 反汇编**逐条一致**。
- **建立函数级状态注册骨架**（ADR-010）：生成 `inventory/functions.json`（全集 `untouched`），并同步 `docs/06-function-status-registry.md` 为可执行的表格式（首批已含发动机核心 + 启动链相关函数）。

**DoD**：
- `bin` 解析器能在测试里把一个 BIN 读成 `ScriptBinary`；
- 测试对比 `src/TITLE.txt` 的指令序列，逐条对得上（opcode/argc/参数类型与 raw）；**这是「读对了」的唯一硬证据**。

**✅ 已实现（2026-xx）**：
- 工程骨架 + `package.json`/`tsconfig.json`/`src/`（`npm run`/`npm test` 用 tsx）。
- **异步文件访问代理**：`src/arch/fileSource.ts`（`FileSource` 接口）+ `src/arch/nodeFileSource.ts`（Node 实现）—— 读取 SYS4INI 索引 + 松散/ALF 脚本。**所有文件访问都走该代理**，将来 renderer 侧换 `IpcFileSource` 即可（ADR-004）。
- **SYS4450 BIN 解析器**：`src/script/bin.ts`（头/指令/字符串/`copy-local-array` 数据数组/label），配套 `src/script/alf.ts`（SYS4INI/APPEND 索引）+ `src/script/lzss.ts`（LZSS 解压）。
- **opcode 表**：`src/opcodes.ts`（548 条，来自 age-shared.cpp）。
- **最小解释器**：`src/vm/`（engine/operand/ops/interpreter/native），可装载 index 0=SYSTEM4 并逐条执行，未实现 opcode 硬报错（ADR-005）。
- **测试**：`test/xval.test.ts`（解析 vs `src/*.txt` 逐条一致）、`test/boot.test.ts`（代理装载→解析→步进→未实现报错 + resolveIndex）。
- **数据源口径**：`raw/` 松散版优先（语文权威），否则 `raw-parts/<pkg>/`；`raw/SYSTEM4.BIN`(545 条) 与 `src/SYSTEM4.txt` 一致，而 ALF 版(544 条)少一条指令——**务必用松散版**。

**当前结果**：`npm run` 装载 SYSTEM4.BIN(545 条) → 执行 comment/dev_ukn → 首个未实现 opcode = `0x2F6` 处硬报错。这是 M1/M2 的起点。

---

## M1 进展（2026-xx）

- **文件策略已定（只依赖 `raw/`）**：`FileSource` = 松散优先（`raw/`），否则按 SYS4INI 索引给的 `(archive,offset,length)` 从 ALF 切片；`raw-parts` 仅预解压产物，不再作为直接来源。已用 `TITLE/INIT2/LOGO`（ALF 切片）与 `SYSTEM4`（松散）交叉验证。
- **Boot 路径推进**：SYSTEM4 初始化段已越过并进入 call-script 链（INITCONFIG→INITCONFIG0 在跑）。`call`/`ret`（同脚本子程序）与 `call-script`（跨脚本，异步装载）均已正确工作。
- **新增"插桩"机制**（ADR-005 增补）：对读体确认的引擎内部/子系统 opcode（`ENGINE_INTERNAL_OPS`，~24 个）记录并跳过，未分类仍硬报错。
- **已实现/分类**：VM 核心（算术/比较/mov/jmp/call/jcc/ret/call-script/comment/dev_ukn/exit 类）+ 子系统桩（play-*/draw-texture/bgm/voice/input 等）+ `engine-internal` 插桩（消息窗口/配置 setter/str 表）。
- **待办（M2）**：继续沿 call-script 链分类剩余 opcode（每个子脚本都有设置类 opcode）；细化 `string-lookup-set`(0x1a3)/0x1a2/0x1a9 的字符串表语义；实现 VM 核心数据 opcode（`copy-to-global`(0x6C)/`copy-local-array`(0x64)/`lookup-array`(0x61)）；当前链已推进到 INITCONFIG4。

### 控制流语义（exit/ret/exit-script/call —— 2026-xx 研究定论，已修正）

读 `engine/天结_unpacked.exe_utf8.c` 的 handler（`sub_*`）确认，三者**语义不同**，早期模型曾混淆：

| opcode | name | handler | 语义（已确认） |
|---|---|---|---|
| 0x8F | call | `sub_420560`(29452) | **同脚本子程序调用**：把下一指令 dword 索引推入**每帧返回栈**（`this+256*cur+97193`，计数器 `this+cur+97153`；`(+3)` 跳过本条 3 dword），再跳 label；operand==-1(0xFFFFFFFF) 则弹回不跳 |
| 0x5 | ret | `sub_41A9B0`(25704) | **同脚本子程序返回**：弹返回栈跳回；**栈空则 no-op（落到下一指令）** |
| 0x2 | exit | `sub_41A820`(25629) | **跨脚本返回调用层**：`cur = frame.caller`（frame+383180）；含 `-10`(续跑 call_link)/`-11`(save-version) 哨兵路径；**顶层无调用层（caller<0 且非哨兵）才程序退出**（抛 `Exit_Exception`） |
| 0x9 | exit-script | `sub_428A60`(35171) | **全量 teardown**：清空全部 40 帧（`sub_40EA00` 逐帧）+ 重置全局数组 + 发窗口消息 → 回到干净初始态（上层回到根/菜单） |

> **修正**：早期把 `exit`(0x2) 当"程序退出"是错的 —— 它其实是子脚本的正常返回（INITCONFIG0 等以 `exit` 结束并回调用层）。已按此修正 ops；`ret`(0x5) 只做同脚本返回、空栈 no-op。这使 SYSTEM4→INITCONFIG0→2→3→4 链正确推进，当前停在 INITCONFIG4 的 `copy-to-global`(0x6C)（VM 核心，待实现）。

---

## M1 控制流实现状态

- `call`/`ret`（同脚本子程序）：✅ 每帧返回栈（`Frame.retStack`），`ret` 空栈 no-op。
- `call-script`(0x3)/`exit`(0x2)（跨脚本）：✅ `cur` 深度 + `frame.caller`；`exit` 回调用层。
- `exit-script`(0x9)：✅ 清栈+重置全局，抛 `ScriptReset` 信号（run 识别为"重置到根"）。
- 待实现（VM 核心）：`copy-to-global`(0x6C)、`copy-local-array`(0x64)（数据数组）、`lookup-array`(0x61) 等。

**为什么先做它**：后面所有里程碑都依赖「把 BIN 读成解释器能吃的结构」。先用已有反汇编文本做黄金对照，快速建立可信度（`docs/re/engine/00` 已确认 `age-asm -x` 可逐字节 equal，我们的解析器应达到同样目标）。

---

## M1 · VM 核心解释器（高频语义指令）—— 核心

**范围**（只做「VM 核心」，不碰子系统）：
- 构造 `Engine` 态：全局数组、40 帧、`key`、`dispatch[]`（先内置少量 opcode handler，把 `dispatch[]` 留成可注入）。
- 实现**读写原语**：`readIntOperand` / `readFloatOperand` / `writeIntOperand` / `writeFloatOperand`（含 `DEC`/`ENC`、按 type 分支、全局/局部池寻址）。
- 实现**控制流**：`op_mov`(0x55)、`op_add/sub/mul/div/mod`(0x50-0x54)、`op_and/or/sar/shl`(0x56-0x59)、`op_eq/ne/lt/lte/gr/gre`(0x5A-0x5F)、`op_jmp`(0x8C)、`op_call`(0x8F)、`op_jcc`(0xA0)、`op_ret`(0x5)、`op_call_script`(0x3)、`op_exit/exit_script`。
- `op_call_script`：push 帧 → `cur+1` → 装载新脚本帧（读 BIN、分配字符串表、填局部池）→ 续跑；`op_ret`：`cur = call_ret` 回退出层。
- **子系统调用一律走 `NativeBridge` stub**（记录 + 返回默认）。

**DoD**：
- 能**单脚本**执行 `TITLE.BIN` 的**纯 VM 部分**（不含子系统/UI 依赖的跳级），或至少能跑一条没子系统耦合的小段并打印每帧状态；
- 能正确跨帧：`call-script` → 装载 → `return` 回到调用层，IP/局部变量正确。

> ⚠️ 这一步是「跑通 **no-UI** 到 TITLE」的**前提但不是终点**：真正能跑到 TITLE 还取决于 M2 的 opcode 分类。

---

## M2 · 启动链 opcode 清点与分类（主战场）

**范围**：对启动链（`SYSTEM4` 前 150 行 + `TITLE` 全量，见 `04-boot-chain-analysis.md`）**用到的每个 opcode**，逐个判定三类之一：
1. **VM 核心**（影响控制流/状态，必须精确实现）——如 mov/add/jcc/call-script/set-string/lookup-array/copy-local-array 等已具名的，以及**某些行为属 VM 的 `uXXXX`**。
2. **子系统/UI 副作用**（对 VM 状态无影响，记日志后放行）——如窗口创建、贴图绘制、字体、声音、回调注册等。
3. **无法判定 / 关键路径**——单独深挖其 handler 体，最终归入 1 或 2。

**产出**：一张**启动链 opcode 清单表**（`docs/05-opcode-inventory.md`），每行：指令名 → opcode 值 → 分类 → 所属脚本 → 说明。这是「未知逻辑」从抽象担忧变成可勾选清单的地方。

**配套（ADR-010）**：每个被判定为「子系统/可忽略」的 opcode 的 handler 函数，其「读 handler 体确认未写 VM 态」的结果要落到 `docs/06-function-status-registry.md` 的 `ignored` 行（附 evidence + reviewed）；凡命中「高危信号」者划回 VM 核心。**本步结束不得滞留 `studying`。**

**DoD**：启动链里每个出现过的 opcode 都有明确分类；「VM 核心」类的在 M1 已实现或在本步补齐；且**每一项 `ignored` 都有读体证据 + 复核签名**。

---

## M3 · 无界面跑到 TITLE（第一里程碑成功定义）

**范围**：
- 从「构造 Engine 态 → 装载 SYSTEM4.BIN 为 frame[0] → 进入主循环」开始逐条执行。
- 遇到 `call-script 5264 // TITLE`（`SYSTEM4` 第 150 行）时，装载 `TITLE.BIN` 作为新帧并开始执行其指令。
- 期间所有子系统调用走 stub；**任何未实现/未分类 opcode 硬报错**（ADR-005），报出 opcode/脚本/偏移，便于继续。

**DoD（多选项，从易到难）**：
- **D1（可达性）**：解释器执行到「装载 TITLE.BIN 并成功进入它的第一条指令」——即 `call-script 5264` 后 cur 帧已切到 TITLE，**无一 opcode 硬报错**。
- **D2（TITLE 内推进）**：在 TITLE 内能执行其**前若干条纯 VM 指令**（如 `copy-local-array`/`mov`/`play-sound-effect`(stub)/`call label`），并推进 IP 到第一个 UI 强依赖点为止。
- **D3（完整落到 TITLE 主循环）**：TITLE 主循环（`label_0000039c` 的 `get-input-type`/`eq`/`jcc` 轮询）能运转（因无输入，`get-input-type` stub 返回固定值），至少跑满若干轮不崩。

> 我们先把 D1/D2 作为「到 TITLE」的首个可信达成，D3 作为无界面下的极限。

---

## M4 · 差分验证（Oracle，可选但强烈建议）

**范围**：在能跑原版引擎的 Windows 机器上（或远程 runner），用 `amayui-inspector` 抓取「执行某脚本片段」前后的引擎态（`this`/全局表/帧栈），与我们的 TS VM 对比。

**DoD**：对至少 2-3 个小确定性脚本，TS 态与原版态**逐值一致**（尤其 DEC/ENC 后的全局 int、局部变量、cur 层）。

**价值**：这是对「opcode 语义保真」最硬的验证。若暂无条件跑 Windows，则退化为「用已确认的静态事实（dispatch 表/offset/公式）做单测」。

---

## M5 · 子系统真实现（后置，看目标）

**可选项**，取决于是否要「可玩」：
- 渲染：`draw-texture`/`create-texture`/`set-texture` → H5 canvas/WebGL。
- 音频：`play-sound-effect`/`play-bgm`/`play-voice` → Web Audio。
- 输入：`get-input-type`/`joy_callback`/`mouse_callback` → DOM 事件。
- 字体：`set-font`/`set-string` 渲染 → canvas 文本。
- 文件/存档：主进程 IPC。

**若只是「调试/观测/汉化验证」，M3 的 stub 够用；M5 做成可后置的里程碑。**

---

## 里程碑依赖图

```
M0（BIN 读取器） ──▶ M1（VM 核心解释器） ──▶ M3（无界面跑到 TITLE） ✅ 第一里程碑
                     │
                     └──▶ M2（启动链 opcode 清点/分类）▲──────（M3 依赖）
                                                        │
                            M4（差分验证，可选） ◀──────┘
                            M5（子系统真实现，后置）
```

## 当前进行到

（实施者按进度更新此节，每完成一项打勾。）
- [x] M0 代码骨架 + BIN 读取器 —— **已完成**（见 M0 节）
- [ ] M1 VM 核心解释器
- [ ] M2 启动链 opcode 清点/分类
- [ ] M3 无界面跑到 TITLE（第一里程碑）
- [ ] M4 差分验证
- [ ] M5 子系统真实现
