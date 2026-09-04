# 02 · 架构决策（ADR）

> 记录关键取舍与理由。每条都有编号，便于后续对「为什么这样」形成共识，避免反复摇摆。
> 决策状态：✅ 已定 / 🔄 待定（需进一步调研后再定）。

---

## ADR-001 · 技术栈：TypeScript + Electron（✅ 已定）

**选择**：解释器核心用 TypeScript；壳用 Electron（主进程 + 渲染进程）。

**理由**：
- 原引擎是 Win32 x86。若想**跨平台**（macOS/Linux/Windows），只能「重实现」，不能「包原版 exe」。
- Electron 的**主/渲染进程隔离**正好映射到「文件/原生胶水」与「VM + H5 渲染/输入」。
- **插件**做成 JS 模块即插即用；**调试/观测**直接白嫖 devtools + 可插桩的 TS 运行时。
- 仓库已有 TS 基建（`app/amayui-toolkit` 是 Vite+React SPA；`scripts/` 大量 `.mjs`），Node 生态复用度高。

**代价/边界**：为跨平台，渲染/音频要重做（见 ADR-004）。第一里程碑「无界面」先不做渲染，规避这部分。

---

## ADR-002 · 启动层级：直接进入解释器，不做原生初始化（✅ 已定）

**选择**：模拟器**不从 WinMain/消息循环/设备初始化启动**，而是：

```
构造引擎态(Engine) → 装载首个脚本(SYSTEM4.BIN) 为 frame[0] → 进入解释器主循环
```

**理由**：
- 原生 WinMain 要做窗口/D3D 设备/字体/输入/声音管理器初始化（`engine.cpp` 约在 `4BA310..4BAxxx`），**这些正是「无界面」模式要绕开的**。
- 我们的目标是**跑字节码，跑到 TITLE 脚本执行点**，不是复现 Win32 生命周期。
- 这让第一里程碑聚焦在「解释器 + 子系统 stub」上。

**影响**：装载首个脚本的 id 来源（引擎如何决定 SYSTEM4 是第一个）仍需确认——这是起步前的一个小调研（见 `04`）。

---

## ADR-003 · 对象模型：干净重建模，不复刻字节大块（✅ 已定）

**选择**：把 `engine.hpp` 的 `struct Engine`/`ScriptContext` 转成**干净的 typed TS 对象**，只建模 opcode 真正触达的语义态；**不**复刻那个 `0xB0000` 字节巨块，也**不**保留 `char _reserved_*` 占位。

**理由**：
- `engine.hpp` 的大片区域是未知占位，per-byte 复刻既不可能也无意义。
- opcode 只触达「脚本帧、按类型分池的局部/全局变量、控制流寄存器、全局数组」这些**语义态**。建模这些即够。
- 干净建模**降低风险**（不需要先解出全部字段），代价是「必须知道每个 opcode 碰哪些字段」——这反哺回 opcode 语义研究，是互补而非冲突。

**落地（初稿）**：
```ts
type u32 = number;  // 语义上 32 位无符号；实际用 number + |0 / >>> 保持
type i32 = number;

// 全局/局部变量池按「操作数类型」分池（对应 arg type 0x9/0xA/0xB/0xC/0xD 局部；0x3/0x4/0x5/0x6/0x7 全局）
class ScriptContext {
  str_table!: StringTable;
  ip!: number;                 // 当前指令指针(字节偏移在脚本内)
  local_int!: Int32Array|u32[]; local_float!: Float32Array;
  local_string!: StringTable;  local_ptr!: u32[]; local_float_ptr!: u32[];
  caller!: number; frame_arg!: number; arity!: number; array_container!: unknown;
}

class Engine {
  global_int!: Int32Array;  global_float!: Float32Array;
  global_string!: StringTable; global_ptr!: u32[]; global_float_ptr!: u32[];
  cur_script!: number; call_ret!: number; call_link!: number; call_flag!: number;
  frames!: ScriptContext[];   // 40 个
  key!: u32;                  // DEC/ENC 用
  dispatch!: readonly ((e:Engine)=>void)[]; // opcode -> handler，<=0x400
}
```
（最终以能跑通第一里程碑为准，可微调。）

---

## ADR-004 · 子系统接口抽象：NativeBridge，先 stub（✅ 已定）

**选择**：把所有「引擎子里调用的子系统/系统调用」抽象成一个 `NativeBridge` 接口；**第一里程碑全部实现为「记录 + 返回默认值」的 stub**，逐步换真。

**理由**：
- 引擎是一半 VM + 一半子系统。子系统（渲染/音频/输入/字体/文件/存档）在无界面阶段**不可验证也无必要**。
- 用接口隔离后，后续可以**无缝切到 H5/Electron 真实现**（canvas/WebAudio/IPC），不影响 VM 核心代码。
- 关键：**stub 必须「大声」**——凡路径上遇到的、未实现的子系统调用，要**打印可识别的警告**，而不是静默吞掉。

```ts
interface NativeBridge {
  playSound?(id:u32, vol:u32): void;
  playBgm?(id:u32): void;
  playVoice?(id:u32): void;
  drawTexture?(...args): void;   // 无界面：仅记录
  setFont?(...args): void;
  setText?(...args): void;
  getInputType?(): u32;          // 无界面：返回默认(如 0/无输入)
  sleep?(ms:u32): void;
  // ... 按需扩充
}
```

---

## ADR-005 · 未实现 opcode：硬报错，绝不静默（✅ 已定，M1 增补"分类插桩"分支）

**选择**：解释器遇到「尚未实现/尚未分类的 opcode」时**抛异常/终止并报出 opcode 值 + 当前脚本 + 行/偏移**，不做任何「猜一个默认行为」的兜底。

**理由**：
- 解释器语义与**真实字段**强耦合。一个 opcode 猜错，会变成「看似正常但数据错位」的深水区 bug，极难排查。
- 硬报错把「未知面」转成**一张可勾选的清单**（哪些 opcode 已被实现、哪些在路径上缺失），让进度可见、可控。

**M1 增补（"插桩"分支，区别于静默）**：对**已逐条读 handler 体确认**为「引擎内部/子系统」的 opcode —— 不读/写 VM 可见状态（全局数组、脚本帧、IP、cur）、不影响控制流 —— 归类为 **`engine-internal`**，由 `ENGINE_INTERNAL_OPS` **记录并跳过**（插桩，显式打日志），**不是**静默吞掉。这是 ADR-010 管辖下、有证据支撑的**显式放行**，与「未分类就硬报错」规则并存：

| 类别 | 判定 | 行为 |
|---|---|---|
| `implemented` | VM 核心，已精确实现 | 执行 |
| `native` | 子系统（渲染/音频/输入/字体） | NativeBridge 桩（记录） |
| `engine-internal` | 引擎内部状态/消息窗口/配置 setter（读体确认） | 插桩：记录并跳过 |
| `unimplemented` | 未分类/未读体 | **硬报错**（NotImplementedOp） |

> 判定 `engine-internal` 必须**读 handler 体**（ADR-010）。当前已在 boot 路径分类 ~24 个（见 `docs/06 §2.2`）；`string-lookup-set`(0x1a3)/0x1a2/0x1a9 这类字符串表操作暂列插桩，M1 需细化。
> **里程碑：M0–M3 已达**——解释器一路从 SYSTEM4 执行到 `TITLE.BIN`（经全部数据表 INIT 脚本），未再触发"未实现 opcode 硬报错"；`npm test` 12/12 通过、`tsc` 干净。期间实现/分类了 ~70 个 opcode（VM 核心：lea/lookup-array(-2d)/memcpy/copy-local-array/copy-to-global/set-array-to/random/bit-*/float-*/strlen/atoi/预装帧；engine-internal/native：消息窗/配置/图形 L2D/纹理/子系统等），并修复 bin.ts 的 copy-local-array 越界与 op_jcc 的 `0xFFFFFFFF` 真分支误判。

---

## ADR-006 · 整数/浮点语义：显式 32 位运算（✅ 已定）

**选择**：所有位模式运算用受控的 32 位语义；TS `number` (double) 只在**安全整数域**（|x| ≤ 2^53）直接用。

**理由 / 前提（用户已确认）**：JS 能安全操作 2^53 内的整数；**除非引擎用 int64，否则安全**。目前引擎是 x86 32 位，未见到 int64 运算；`0xFFFFFFFF` 之类的 32 位哨兵需要小心（见下）。

**实现约定**：
- 位运算（ROL/ROR/XOR/SHL/SHR）：一律经 `|0` / `>>>` / `Math.imul` 后手写，**绝不裸用 `<<`/`>>`**。
- `0xFFFFFFFF`（jscc 的「不跳」哨兵、ptr 判空）用 `0xFFFFFFFF` 常量并始终 `>>>0` 得无符号位模式，避免被当作 `-1`。
- 有符号比较（`lt/gr/gre/lte`）明确 i32；无符号语义（`0x8003/0x8009` 数组批量、地址）用 `>>>0`。
- `DEC(x) = ror32( key ^ rol32(x,11), 25 )`；`ENC(a) = rol32( key ^ ror32(a,7), 21 )`。
- 提供调试断言：`DEC(ENC(x)) === x` 在测试里跑。

---

## ADR-007 · 脚本装载：自实现 SYS4450 BIN 读取器（✅ 已定）

**选择**：不依赖现有 C++ `age-asm` 工具，**用 TS 直接解析 `.BIN` 字节**（SYS4450 v4 头 + 指令流 + 字符串表）。

**理由**：
- `age-asm.exe` 是 Windows 可执行、且是「反汇编→文本」路径；我们**需要的是字节码→内存**直接喂给解释器。
- 格式已明确（`docs/re/engine/00`）：头 = `SYS4450 ` 魔数 + 6 个 u32 局部变量数 + 0x1C + 三张表（length/offset）；指令 = opcode u32 + argc 个 (type,raw) 各 8 字节；字符串在数据表尾部，`0xFF` 异或 + SJIS(CP932)，`0xFF` 结尾。

**产出**：一个 `ScriptBinary` 解析器，输出：
```
{ signature, localVars, instructions: Instruction[], strings: StringTable, labels }
Instruction = { opcode:u32, args: Arg[] }
Arg = { type:u32, raw:u32 }
```
并支持把 `label_XXXXXX` 映射到指令偏移，用于 jump/分支。

---

## ADR-008 · 目标脚本集合：以在用的松散/归档 BIN 为准（🔄 待定）

**选择倾向**：与 `docs/re/engine/00` §1 一致——游戏直读松散 `.BIN`（`raw-parts/`/`raw/`），语料以松散版为准。具体**首个脚本与入口链收敛口径**待 `04` 定。

**待确认**：
- `call-script <index>` 的 index 解析来源（SYS4INI 文件表 / APPEND `0xnn000000+pos`）在本工程用哪个口径。
- 首个脚本（SYSTEM4）的 id 如何得到、从哪里装载。

---

## ADR-009 · 插件机制：运行时挂载的 handler 覆盖层（🔄 待定，后置）

**倾向**：VM 的分发表 `dispatch[]` 是天然插件点——插件可**替换某个 opcode 的 handler**（如汉化需要观察/改写特定指令），类似 hook。

**现状**：尚无需要，第一里程碑先不做，但**把 `dispatch[]` 留成可注入的数组**即可。

---

---

## ADR-010 · 函数级状态追踪（强制约束）✅ 已定（最高优先级约束）

> **本约束是「重写保真度/可审计性」的硬性要求，正常流程下不可绕过。**
> 目的：让「原引擎每个函数在重写版中的状态」**可追踪、可审计**，杜绝两类事故——① 改了引擎行为却不知道自己改了；② 把**本该实现**的逻辑当成「可忽略」偷偷跳过。

**要求（每个原始函数都必须被追踪）**：原引擎（`engine/engine.cpp` 里的每个函数/成员）在我们的重写版本中，**必须有一条记录**，记明其状态；且对「确认忽略」的内容，必须记录**证据 + 复核结论**，证明它「确实应该被忽略」，而不是主观想当然。

### 10.1 状态枚举（每函数四选一，用英文标识便于机器处理）

| 状态 | 标识 | 含义 | 对 VM 结果的影响 |
|---|---|---|---|
| 未处理 | `untouched` | 尚未研究/重写，原函数没有对应实现 | 未知；若在路径上会被 ADR-005 硬报错拦截 |
| 已完全重写 | `rewritten` | 已用 TS 精确实现其语义，且通过对照/测试 | 已确认 |
| 确认忽略 | `ignored` | 判定为「无需在重写版中实现」，并给出证据 | 已确认不影响目标（否则不得标 ignored） |
| 研究中 | `studying` | 正在读 handler/归类，尚未定论 | 待定（临时态，须尽快落入前三类） |

> 规则：**`ignored` 必须带「证据 + 复核」**；`studying` 是**临时态**，不能长期滞留；最终每函数收敛到「rewritten 或 ignored」。

### 10.2 `confirmed-ignored` 的硬性要求（关键）

标为 `ignored` 时，记录里**必须**包含：
1. **证据（evidence）**：为什么可以忽略。例如「其 handler 体只调 Win32 子系统（窗口/绘制/字体/音频/输入/文件/registry），对 VM 态（全局/局部 int·float·string·ptr、帧、IP、cur）无读写，已读 `engine.cpp` 中 `sub_XXXX` 体确认」；引用具体函数/行/文档佐证。
2. **复核（reviewed）**：谁/何时复核，以及复核结论。防止单方面「看着像 UI 就跳过」。
3. **风险自检（risk）**：若判断错误会怎样（例如某「UI」opcode 实际上还顺带写了全局状态），以及后续如何验证。

**已识别的高危信号（if 命中则不得轻易标 ignored）**：
- handler 体内有对 `_this[..]`（Engine 字段）的读/写、或有 `writeIntOperand` 序列；
- 它在 `call-script`/`jcc`/`ret` 的控制流路径上，且其副作用可能改变后续判断；
- 它是 `set-array-to`/`lookup-array`/`copy-*`/`memcpy`/`string-lookup-set` 这类**数据/状态操作**而非纯表现层。

### 10.3 追踪载体（两份，机器可读 + 人类可读）

- **人类可读**：[`docs/06-function-status-registry.md`](./06-function-status-registry.md)（表格：函数标识 → 状态 → 证据 → 复核 → 备注）。
- **机器可读**：`app/amayui-emulator/inventory/functions.json`（同一信息的结构化 JSON，供脚本生成清单/校验遗漏）。**尚未创建，随 M0 建立**。

**覆盖来源**：以 `docs/re/engine/10`/`11` 的成员清单（`member_functions.detected.txt` ≈1239 个 `sub_*` + `op_*` 语义名）+ `docs/re/engine/06` 的 544 条 opcode→handler 映射为全集，逐条建行。

### 10.4 何时更新

- **每重构一个函数**：置 `rewritten`（附：对应的 TS 实现位置 + 验证方式）。
- **每确定一个函数可忽略**：置 `ignored`（附证据/复核）。
- **每次跑第二里程碑（opcode 清点）**：把启动链上出现过的函数全部收敛到 `rewritten`/`ignored`（不留 `studying`）。
- **任何「本次讨论决定跳过 X」**：必须先写进 registry 再跳过，**不允许口头跳过**。

---

## ADR-011 · 指针操作数 = 带标记引用（Ref），读=解引用，绝不当数值（✅ 已定，评估结论）

> 触发：确认 `lea`/`lookup-array` 等「取地址」指令时发现的**核心模拟隐患**。完整分析见 [`07-pointer-operand-model.md`](./07-pointer-operand-model.md)。
> **进度：✅ 已实现（M0）**——`src/vm/ref.ts`（Ref + readRef/writeRef/refAt）、`operand.ts`（指针型=解引用/写穿 + setRefOperand/refFromOperand）、`ops.ts`（lea/lookup-array/lookup-array-2d/memcpy/copy-local-array/random）、`engine.ts`（指针池存 `Ref|0`）；新增 `test/ptr.test.ts`。启动链已从"遇指针 op 即停"推进到 `INITCONFIG4`，下一阻塞为未实现 op `0x6c copy-to-global`。

**结论**：指针型操作数（`local-ptr`/`global-ptr`/`*-string-ptr`/`*-float-ptr`）在重写版里必须是**带标记的引用对象（Ref）**，**不能**用 `number` 表示其"地址"；且**读指针操作数必须解引用（deref）取所指值，写必须写穿（write-through）**。地址**从不**作为数值进入算术/比较域。

**证据（读 handler 体，raw `.c`）**：
- 读（`sub_41BF50`，case 6/12）：`**(_DWORD **)(ptr_base + 4*idx)` —— **双重解引用**，读到的是**所指处**的值。
- 写（`sub_42B4B0`，case 6/12）：先取 ptr 槽存的地址 `A`，再 `*A = ENC(value)` —— **写穿**到所指处。
- 取址（`sub_42AEA0`，lea/lookup 底座）：对直接型返回 `base + stride*idx`；对指针型返回"所指处地址"（即**引用拷贝/别名**）。
- 目标恒为指针操作数：全工程 `lea` 173 条、`lookup-array` 14.4 万条，dest **全部是指针型**（`local-ptr/local-string-ptr/local-float-ptr`）；`global-ptr` 在本作出现 **0** 次。
- 指针在值语境被广泛使用且引擎**解引用**：如 `gr (local-int 0) (local-ptr 0) 0`、`jcc (local-ptr 1) …`、`lt (local-int 4f) (local-ptr 5) (local-ptr 4)` —— 这些都**比较/判断的是所指值**，不是地址。

**因此（风险重新定性）**：
- ❌ **不是**「BIN 会拿地址做算术」——因为引擎对指针操作数**一律解引用**，地址从不会以数值形式参与普通运算。
- ✅ **而是**「要实现正确的**引用/解引用模型**」：指针池不能存裸 `number`（在按类型分池、无线性内存的模型里，`base+4*idx` 无意义），必须存 **Ref**；`readIntOperand`/`writeIntOperand` 对指针型必须 deref/write-through。当前 `operand.ts` 对指针型**读返回裸值、写改指针槽**，是**错的**（会立刻破坏全工程 29.8 万处指针值语境）。

**实现要求**：
1. `type Ref = { scope:'global'|'local'; kind:'int'|'float'|'str'|'ptr'|'fptr'; index:number; stride:number }`；指针池存 `Ref | 0`（0=空引用）。
2. `readIntOperand(ptr)` → 跟随 Ref 到 `pool[index]`（int 族过 DEC）；`writeIntOperand(ptr)` → 写穿（int 族过 ENC）。
3. `lea`/`lookup-array`/`lookup-array-2d` 负责**构造 Ref**；`memcpy`/`copy-local-array` 按 **stride** 逐元素搬运（跨池/跨宽须校验，越界/类型不匹配硬报错）。
4. 需区分「**设置引用**」（lea/lookup 写 ptr 槽，写 Ref 对象）与「**写穿**」（普通 op 写指针所指处）——当前一个 `writeIntOperand` 混用了，必须拆开。
5. **ADR-010 联动**：`lookup-array`/`memcpy`/`copy-*` 属 ADR-010 §10.2 的高危信号（数据/状态操作），**不得**标 `engine-internal` 跳过，必须精确实现。

**保留的残余风险**：指针操作数被用作值时引擎**解引用**；若某处本意是「判空指针」却写成 `eq (ptr) 0`，引擎会解引用（空则崩）。模拟器必须**忠实复刻解引用语义**，不得把"指针 vs 数字"特判成地址比较。

---

## 决策速查表

| # | 决策 | 状态 |
|---|---|---|
| ADR-001 | TS + Electron | ✅ |
| ADR-002 | 解释器层启动，不做原生初始化 | ✅ |
| ADR-003 | 对象模型干净重建模 | ✅ |
| ADR-004 | NativeBridge 接口，先 stub | ✅ |
| ADR-005 | 未实现 opcode 硬报错 | ✅ |
| ADR-006 | 显式 32 位整数语义 | ✅ |
| ADR-007 | 自实现 SYS4450 BIN 读取器 | ✅ |
| ADR-008 | 目标脚本集合口径 | 🔄 |
| ADR-009 | 插件机制（后置） | 🔄 |
| ADR-010 | 函数级状态追踪（强制约束） | ✅ 最高优先级 |
| ADR-011 | 指针操作数 = 带标记引用（Ref），读解引用/写写穿，不当数值 | ✅ |
