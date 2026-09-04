# 06 · 函数级状态追踪注册表（Function Status Registry）

> **依据 ADR-010（强制约束）**：原引擎 `engine/engine.cpp` 里**每个函数/成员**在重写版中都必须有状态记录；「确认忽略」必须附证据 + 复核，证明确实应被忽略。
> 本表是**人类可读**载体；机器可读版为 `app/amayui-emulator/inventory/functions.json`（待 M0 建立，两者须一致）。
> 覆盖全集 = `docs/re/engine/10` / `11` 的成员清单（≈1239 个 `sub_*`）+ `docs/re/engine/06` 的 544 条 opcode→handler 映射。

---

## 1. 状态说明（同 ADR-010 §10.1）

| 状态 | 标识 | 含义 |
|---|---|---|
| 未处理 | `untouched` | 尚未研究/重写，无对应 TS 实现 |
| 已完全重写 | `rewritten` | 已用 TS 精确实现并验证 |
| 确认忽略 | `ignored` | 判定无需实现，**必须附证据 + 复核** |
| 研究中 | `studying` | 正在读 handler/归类，未定论（临时态，须尽快收敛） |

> ⚠️ **`ignored` 的硬门槛**：证明「该函数对 VM 态（全局/局部 int·float·string·ptr、帧、IP、cur）无读写」+「不在关键控制流上」，且**由人复核**。凡命中 ADR-010 §10.2「高危信号」者，不得标 `ignored`。

> **M0 进度（2026-xx）**：`loadScriptFrame_40ED40`、`interpreterMainLoop`、操作数读写原语、算术/比较/跳转/call-script/ret 等**已在 TS 侧实现**（`app/amayui-emulator/src/vm/`），对应 `sub_XXXX` 应逐条转 `rewritten`。解析器（`bin.ts`）已用 `src/*.txt` 交叉验证（SYSTEM4/TITLE/INIT2/LOGO 逐条一致）。**尚未标 `rewritten` 的条目** = 实现时尚未逐条对账，待 M1 完成后统一回填。

---

## 2. 首批记录（发动机核心 + 启动链相关，诚实反映当前状态）

> **说明**：当前项目尚未开始编码（M0 待做）。因此绝大多数条目为 `studying`（已读/在分析，但**尚未编译成 TS 实现**）或 `untouched`。**没有一条标 `rewritten`**（因为还没写）。
> 下列「子系统类」函数虽大概率可忽略，但**证据目前只是启发式**（age-shared 具名 + 调用计数特征），**尚未逐个读 handler 体确认**——故暂标 `studying`，待 M2 正式确认后转 `ignored`。**这正体现了 ADR-010 的严谨性：不凭感觉跳过。**

| 函数（原引擎） | 语义名 | 状态 | 证据 / 备注 |
|---|---|---|---|
| `sub_412290` | `interpreterMainLoop` | `studying` | 主循环结构已确认（`docs/re/engine/03`）；属 VM 核心，M1 必实现，转 `rewritten`。 |
| `sub_41BF50` | `readIntOperand` | `studying` | 读 int 原语，含 DEC；已解（`docs/re/engine/05`）；M1 必实现。 |
| `sub_41C300` | `readFloatOperand` | `studying` | 读 float 原语；已解；M1 必实现。 |
| `sub_42B4B0` | `writeIntOperand` | `studying` | 写 int 原语，含 ENC（=DEC 逆）；已解；M1 必实现。 |
| `sub_42BA00` | `writeFloatOperand` | `studying` | 写 float 原语；已解；M1 必实现。 |
| `sub_40ED40` | `loadScriptFrame` | `studying` | 装载脚本帧；结构已知（`docs/re/engine/08`），但首脚本 id 来源待确认（见 `04`）。 |
| `sub_415640` | `commandConstructor` | `studying` | 构造器（初始化 dispatch 表）；结构已解，转 `rewritten` 牵涉 BIN 装载与 dispatch 注入。 |
| `sub_41C6A0` | `op_call_script_41C6A0` | `studying` | `call-script`(0x3) handler；M1 必实现。 |
| `sub_41A820` | `scriptReturn` | `studying` | `ret`/return 路径；M1 必实现。 |
| `sub_41A9B0` | `op_ret_41A9B0` | `studying` | 0x5 `ret`；M1 必实现。 |
| `sub_42C5E0/42C620/42C660/42C6A0/42C6E0` | `op_add/sub/mul/div/mod` | `studying` | 算术簇；已解（`docs/re/engine/03`）；M1 必实现。 |
| `sub_42C720/42C750/42C790/42C7D0/42C820` | `op_mov/and/or/sar/shl` | `studying` | 位/赋值簇；M1 必实现。 |
| `sub_42C870..42CA00` | `op_eq/ne/lt/lte/gr/gre` | `studying` | 比较簇；M1 必实现。 |
| `sub_4203D0/420560/4209B0` | `op_jmp/op_call/op_jcc` | `studying` | 控制流；M1 必实现。 |
| `sub_433660` | `op_set_string_433660` | `studying` | `set-string`，VM 核心（写字符串），M1/M2 实现。 |
| `sub_42CB00/42CBE0/42CE70` | `op_lookup_array/copy_local_array/copy_to_global` | `studying` | 数据/数组操作（**高危信号**，必实现，勿忽略）。 |
| `sub_42D150` | `op_memcpy_42D150` | `studying` | `memcpy`；数据操作，必实现。 |
| `sub_42DF40` | `op_string_lookup_set_42DF40` | `studying` | `string-lookup-set`；数据操作，必实现。 |
| `sub_42F8B0/42F920/42FB40` | `op_bit_set/bit_reset/check_bit` | `studying` | 位操作，VM 核心，M2 实现。 |

### 子系统类（大概率 `ignored`，但**证据仍是启发式，待 M2 读 handler 体确认**）

| 函数（原引擎） | 语义名 | 状态 | 备注（**尚非定论**） |
|---|---|---|---|
| `sub_420B00` | `play-sound-effect` | `studying` | age-shared 具名「play sound effect」→ 子系统；待读体确认其对 VM 态无影响。 |
| `sub_420CC0` | `play-bgm` | `studying` | 同上。 |
| `sub_420F70` | `play-voice` | `studying` | 同上。 |
| `sub_422C20/422CB0/422E70` | `create/set/draw-texture` | `studying` | D3D 贴图子系统；待读体确认。 |
| `sub_433290` | `set-font` | `studying` | 字体子系统；待读体确认。 |
| `sub_41ACD0` | `get-input-type` | `studying` | 输入子系统；无界面 stub 返回固定值；待读体确认。 |
| `sub_421980/421B80` | `mouse_callback/joy_callback` | `studying` | 回调注册子系统；待读体确认。 |
| `sub_4218D0` | `sleep` | `studying` | 可 stub（无界面直接返回/或最小延时）；待读体看是否改 VM 态。 |
| `sub_41A000` | `dispatchScriptRequests` | `studying` | opcode 0x143 批量派发；**涉及控制流，非纯子系统**，需小心（`docs/re/engine/08` §3.4），可能从 `ignored` 划回 VM 核心。 |

> ✅ **本条注册表的意义**：以上「待读体确认」的子系统函数，在 M2 会**逐条读 handler 体**，确认「未写 VM 态」后**升级为 `ignored` 并填写证据**；若发现写了 VM 态，则**划回 VM 核心**。这就是 ADR-010 的落地——不凭感觉跳过。

---

## 2.1 WinMain 启动流程相关函数（已分析，追加）

> **结论**：WinMain = 原生启动引导（窗口类注册 + Engine 构造 + 脚本归档装载 + 子系统初始化 + 建窗 + 装载首脚本 + 进入主循环）。**模拟器按 ADR-002 走「解释器层启动」，跳过整个原生 WinMain，但其中 4 个功能点与 VM 态/脚本装载强相关，需在 TS 侧重建。**

| 函数（原引擎） | 语义名 | 状态 | 证据 / 备注 |
|---|---|---|---|
| `WinMain`（`engine.cpp` 140341） | `winMain` | `ignored`（有证据） | **原生引导入口，模拟器整体绕过**（ADR-002）。但其中「建 Engine（140446 `commandConstructor_415640`，分配 0xAABC8）」「装载 SYS4INI.BIN/SYS3INI.BIN（140488 `sub_414AC0`）」「装载首脚本（142341 `sub_40ED40`）」「进入主循环（140789 `interpreterMainLoop_412290`）」由 TS 侧重建。**evidence**：主机启动 + Win32 窗口/COM/线程/命令行为，对解释器运行不必要；VM 相关四步单独处理。 |
| `sub_4B92F0` | （窗口过程 WndProc） | `studying` | `RegisterClassExA` 里设的窗口过程（140431）；纯 Win32，模拟器绕过，待确认未写 VM 态。 |
| `sub_414AC0`（`engine.cpp` 21799） | `loadScriptArchive` | `studying` | **装载 `SYS4INI.BIN`/`SYS3INI.BIN` 归档**，是 `call-script <index>` → 文件 的索引来源；模拟器需重建（TS），属 VM 前置依赖。 |
| `sub_4084E0`（`engine.cpp` 13084） | （子系统/数据路径初始化） | `studying` | WinMain 在建窗前调用（140625），返回 < -1 即错误。析其体（13084 起）：读 `_this+174728` 字符串、读配置 `v1[174405]`、`(config->vtable+8)(config, aSetCdlabel)` → 疑似 **CD/dataload 路径设置**，**非全局数组分配器**。待确认未影响 VM 全局数组基址。 |
| `sub_4BA310` | （CreateWindow/建窗） | `studying` | WinMain 140648 调用建窗并返回 `HWND`（`hWnd = v29`）；纯 Win32，模拟器绕过。 |
| `loadScriptFrame_40ED40`（`engine.cpp` 18467） | `loadScriptFrame` | `rewritten`（设计已定，待编码） | **核心**：`(engine, a2, hwnd, scriptIndex)`，**`a2` 未使用**，`a4`=脚本索引，归档对象在 `engine+680092`（由 `sub_414AC0` 装载）。首帧 `a4=0`=`SYSTEM4.BIN`（已确认）。TS 侧实现：解析索引→读 BIN→初始化 frame。**evidence**：`a2` 在 18467–18890 无引用；`names[0]=SYSTEM4.BIN` 复算确认。 |

> ⚠️ **WinMain 后段**（140783 前）还调了：`sub_417800`、`(config->vtable+4)(config, aSetClickonup)`、`LoadLibraryA(kernel32/comctl32)`+`SetThreadErrorMode(3)`、`sub_496AB0`、`(config->vtable+20)(config, aSetIsreggist)` → 均为原生/配置类，模拟器不需要。**首脚本 `v52` 来源**是关键开放点，决定 TS 侧「构造引擎态后首次 `loadScriptFrame` 传什么」。`sub_4084E0` 是否写全局数组也待定，决定 TS「构造全局数组」是否要与之一致。

---

## 2.2 Boot 路径 opcode 分类（M1，逐一读 handler 体确认）

> 状态：**`ignored`（有证据）** —— 已读 `engine.cpp` 中对应 handler 体，确认这些 opcode **只做引擎内部状态/消息窗口/配置 setter 或调用子系统对象方法**，不读/写 VM 可见状态（全局数组、脚本帧、IP、cur），不影响控制流 → 模拟器「记录并跳过」（`ENGINE_INTERNAL_OPS`）。**`string-lookup-set`(0x1a3) 等字符串表操作列为 `studying`**（写内部 str 表，需 M1 细化）。

| opcode | 名称 | handler (engine.cpp) | 分类 | 证据 |
|---|---|---|---|---|
| 0x2F6 | 2F6 | `sub_426820`(33219) | ignored | 读 op1 → `_this[v2+21315/…]` 清零 + `sub_404CB0`，按索引初始化引擎内部槽 |
| 0x2F8 | 2F8 | `sub_4268D0`(33245) | ignored | 读 op1/op2 → `sub_4B6940(v2+12,v4)`，子系统对象方法 |
| 0x149 | u0041FCE0 | `sub_4229A0`(30687) | ignored | `_this[97058]=op1`，config setter |
| 0x88 | u0041B290 | `sub_41FAB0`(28686) | ignored | `_this[1415]/[97050]` + flag |
| 0x21b | u004213E0 | `sub_423C20`(31433) | ignored | `_this[166965]=(op1!=0)` |
| 0x1ca | u0041B9B0 | `sub_420240`(29019) | ignored | config set-message-read-texture |
| 0x252 | u00423000 | `sub_425AB0`(32631) | ignored | `_this[92323]=op1` |
| 0x324 | u0043AA60 | `sub_41A470`(25205) | ignored | `sub_453530(_this[93384])`，arity 1 |
| 0x32f | u0043AB11 | `sub_4272B0`(33637) | ignored | `sub_49A150(_this+80708,op1)` |
| 0x70 | u0041A750 | `sub_41ED20`(28141) | ignored | 消息系统 `sub_45D660(_this+21324,…)` |
| 0x71 | u0041A7B0 | `sub_41ED80`(28158) | ignored | 消息系统 + 缓冲拷贝 |
| 0x73 | u0041AB30 | `sub_41F250`(28338) | ignored | 消息系统 |
| 0x78 | u0041AD00 | `sub_41F450`(28417) | ignored | `_this[21667]=op1`; `sub_459F40()` |
| 0x79 | u0041AD30 | `sub_41F490`(28427) | ignored | 消息系统 `sub_4563A0(_this+21324,…)` |
| 0x1c1 | u0041B820 | `sub_420070`(28953) | ignored | 消息系统 `sub_4563D0(_this+21324,…)` |
| 0x212 | u00421090 | `sub_423A30`(31357) | ignored | 消息部件 `_this[result+21585]+100` |
| 0x213 | u004210D0 | `sub_423A80`(31372) | ignored | 消息部件 `_this[result+21585]+104/108` |
| 0x25d | u00423123 | `sub_425EF0`(32811) | ignored | 消息部件 `_this[result+21585]+276/280` |
| 0x2db | u004235C0 | `sub_426500`(33073) | ignored | `_this[71744]=op1`; `sub_459F40()` |
| 0x303 | 303 | `sub_426A90`(33314) | ignored | 消息系统 `sub_456600(_this+21324,…)` |
| 0x1a2 | u00428010 | `sub_434F60`(42215) | ignored | 写内部字符串查找表 `_this+5452` |
| 0x1a9 | u00428090 | `sub_434FE0`(42229) | ignored | 写内部字符串查找表 `_this+5472` |
| 0x1a3 | string-lookup-set | `sub_42DF40`(raw 38443) | **studying** | 读 op1 → 查 `_this+5452` str 表 → 写回 op1；M1 细化 |
| 0x6e/0x6f/0x72… | show-text/end-text-line/wait-for-input | — | native | 子系统（在 `NATIVE_OPS` 桩） |

---

## 3. 如何填充 / 更新本注册表

1. **全集来源**：`docs/re/engine/member_functions.detected.txt`（公开的成员清单）+ `docs/re/engine/06` 的 opcode→handler 表。用脚本生成 `inventory/functions.json` 初始骨架（全 `untouched`）。
2. **新增一行**：写 函数标识（`sub_XXXX`）+ 语义名（若有）+ 状态 + 证据/备注。
3. **更新状态**：
   - 转 `rewritten`：附「TS 实现文件:函数 + 验证方式」。
   - 转 `ignored`：附「evidence（读体结论）+ reviewed（谁/何时）+ risk（若错的后果）」。
4. **校验**：M2 结束、或每次里程碑完成时，跑脚本检查「启动链上出现的函数是否已收敛到 `rewritten`/`ignored`」，并报告仍滞留 `studying`/`untouched` 的条目。

**禁止**：绕过本注册表直接「口头决定跳过 X」。
