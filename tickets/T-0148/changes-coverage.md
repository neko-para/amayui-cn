# T-0148 · 审计遗留覆盖账（2026-09-25 主 agent 生成）

> 目的：把"审计遗留"从一句口号变成**可枚举、可关单**的清单。数据来源 =
> `docs-new/99-records/2026-09-impl-audit/raw/impl-audit-findings.json`（机器可读 finding 表）
> ＋ `analysis/opcode-gaps.json` ＋ `tickets/*/ticket.json`。生成脚本 `.tmp/settle/t0148-gen-coverage.mjs`（只读）。

## §0 三句话结论

1. 审计覆盖 **364/364** 个 opcode 与 **54/54** 条能力条目，共产出 **383 条 finding**（P0 1 / P1 48 / P2 140 / P3 194）；审计自评 verdicts：一致 210 / 有缺口 159 / 描述过期 27 / 有据豁免 22。
2. **仍挂在未完成票上的 finding 只有 4 条**（`T-0091` ×3、`T-0103` ×1 —— 都在"外部条件/用户点名最后做"那一档）；
   其余 379 条在 A–F 波里逐条处置完毕（代码修复 / 台账登记 / 前提被推翻）。
3. 真正还没裁决的是两类**结构性尾巴**：
   ① **80 个 opcode** 被审计点名但至今不在缺口台账里（需一次"登记 or 写明为什么不登记"的扫尾批）；
   ② **36 条 `tracked-open`/`unclassified` finding**（其中 8 条只是台账措辞过期，另 28 条是候选真缺口）。

## §1 审计自报总量（`stats` 关键字段）

```text
batchesCovered   opcode 43 / capability 7
opcodes          364/364      capEntries 54/54
findings         383（new 280 / known 103）
byTrack          opcode 279 / capability 104
bySeverity       {"P3":194,"P1":48,"P2":140,"P0":1}
byKind           {"missing-branch":74,"approximation":57,"missing-operand-io":37,"missing-consumer":49,"host-invented":13,"missing-behavior":70,"unclear":7,"stale-ledger":42,"overreach":33,"noop-claim-unjustified":1}
byClass          {"tracked-done":79,"new":139,"unclassified":25,"audited-2026-09":129,"tracked-open":11}
byClassSeverity  {"new":{"P1":18,"P3":73,"P2":47,"P0":1},"audited-2026-09":{"P3":78,"P2":48,"P1":3},"tracked-open":{"P3":2,"P2":4,"P1":5},"tracked-done":{"P3":31,"P2":31,"P1":17},"unclassified":{"P3":10,"P2":10,"P1":5}}
verdicts         {"有据豁免":22,"有缺口":159,"一致":210,"描述过期":27}
```
## §2 与票面的对账

- finding 总数 **383**；其中带 `ticketRefs` 的 **90** 条，无票 **293** 条。
- **仍挂在未完成票上的 finding：4 条** ⇒ T-0091×3 / T-0103×1
- 未完成票（14 张）：T-0019 T-0051 T-0067 T-0088 T-0091 T-0103 T-0107 T-0118 T-0122 T-0142 T-0146 T-0148 T-0169 T-0175

## §3 审计点名过、但不在缺口台账里的 opcode

审计点名 opcode **179** 个；不在 `opcode-gaps.json` 的 **80** 个：

```text
0x2 0x53 0x61 0x64 0x6f 0x73 0x7a 0x8f 0x91 0x92
0x94 0xa0 0xa2 0xa3 0xb8 0xc3 0xc4 0xc5 0xc6 0xc7
0xd9 0xfa 0x108 0x10d 0x131 0x141 0x14b 0x197 0x198 0x19c
0x19d 0x19f 0x1a0 0x1a5 0x1ac 0x1af 0x1b6 0x1b7 0x1bb 0x1bd
0x1ce 0x1d2 0x1fc 0x1fe 0x204 0x20a 0x212 0x21e 0x239 0x23d
0x245 0x248 0x259 0x25c 0x25d 0x260 0x2bd 0x2bf 0x2c0 0x2c7
0x2da 0x2dc 0x2e5 0x2eb 0x2f7 0x2fc 0x2fe 0x2ff 0x302 0x303
0x305 0x32f 0x340 0x346 0x34a 0x34c 0x34f 0x350 0x351 0x352
```

（判定规则建议：`implemented` / `corpus-unregistered` 两种**缺席是合规的**（前者代码已按体实现、后者语料 0 处）；
 其余情形要么补登记、要么在票里写明"为什么不登记"。逐条裁决需要一次专门的扫尾批。）

## §4 `tracked-open` + `unclassified` 的分诊表（36 条 ⇒ 下一波的输入）

| kind | 条数 | opcode | 摘要 |
|---|---|---|---|
| `approximation` | P3 | 0x2eb | 取值口径近似：引擎是「内建 `1.00` → INI `[set] GameVersion` 覆盖 → `set:VerRegPos` 非空时用注册表 `DisplayVersion` 覆盖」三层，emulator 是「 |
| `approximation` | P3 | 0xa0 | emulator 要求真/假分支目标命中 labelMap（否则抛 `jcc: unknown true/false label`）；引擎对两个目标都不校验、直接以 `base + 4*目标` 写 ip。 |
| `approximation` | P3 | — | 引擎对**所有**层都把完整 Scene 世界矩阵乘进项 work 矩阵（133403-133407 门为真的支），只有层号 ∈[20,30) 走 `else` 的 decompose→『压成 2D』重建（133411- |
| `approximation` | P2 | — | 引擎的置脏无条件（只看 `46512|46516` 非零），emulator 的等价物是「freeze 且存在可冻结项」才置脏：freeze 置位但场景里没有可冻结窗时 emulator 不置脏。 |
| `approximation` | P2 | — | 引擎的『显示完了吗』由 sub_48F000 查脚本分段表得出（miss/越界返回 0），emulator 用 `readTextSkipOf(e) !== 0 ? 1 : 0` 伪造返回值，再用 serviceAdv  |
| `missing-consumer` | P3 | 0x248 | 引擎全局 `dword_55052C`（默认 256，blit 分块/格宽除数）在 emulator 里没有消费者：写进 `engineValues[-248]` 后无人读 ⇒ 脚本改这个值不会让 emulator 的任 |
| `missing-consumer` | P3 | 0x32f | 灯光开关整条能力缺失：引擎写 `Scene[4*op1+54708] = 0`（灯光 enabled 位，设备重建时被读来回放 SetLight/LightEnable，raw 122112-122118）并下发设备 L |
| `missing-consumer` | P3 | 0x340 | 渲染状态整条能力缺失：引擎把 op1 存进 `Scene[13948]` 并在设备重建时重放（raw 122124），emulator 既不写这个状态槽也没有宿主实现（gfx-misc.ts:98 的 `setRende |
| `missing-consumer` | P3 | 0x245 | emulator 唯一的落点是 `native.setTextureObjectFloat`，而 PixiBackend / HeadlessScene / StubNative 都没有实现它（native.ts 只声明 |
| `missing-consumer` | P3 | 0x246 | 宿主三实现都没有 `setTextureObjectParam`（native.ts 只声明为可选缝）⇒ 引擎里真实的 vtable+56 调用在 emulator 消失；且该缝被 0x1F9/0x249 复用来传**颜 |
| `missing-consumer` | P2 | 0x1ba | 四条分支末尾（以及 `0xBB`/`0xBC`）都会调 `sub_406DF0(Engine, 类别, a2)` 把该类声音的开关下发给正在播放的影片播放器音轨；emulator 的 `switchMovieEnable |
| `missing-consumer` | P3 | 0x25a | `sub_4A5470(Scene, id)` 的两条媒体下发分支（模式变化门 raw 33198-33199、非 display:ScreenMode 门 raw 33200-33201）在 emulator 完全没有 |
| `missing-consumer` | P1 | — | message:AutoMessageTime{0,1} / AutoMessagePitch{0,1} / AutoMessageOption 有写入端（0x1B9/0x2E7/0x2E8）但没有任何消费者；引擎的消费 |
| `missing-operand-io` | P3 | 0x61 | 引擎体对 op1 是“按操作数自身 tag 写”的 —— op1 为直接型（int/float/string）时它把地址写进同类型的**直接槽**、为指针型时写指针池条目；emulator 的 `setRefOperan |
| `missing-operand-io` | P2 | 0x192 | 第 2 格操作数的**强制转换能力**缺失：引擎 `sub_42A420` 对 int 族 tag 走 `_itoa_s(值, …, 10)`（取槽里的**值**转十进制串）、float 族走 `%lf`、指针族解引用后 |
| `missing-operand-io` | P1 | 0x193 | 第 2/3 格操作数的**指针解引用与整数/浮点转串**能力缺失：引擎 `sub_42A420` 对 `local-ptr`/`global-ptr` 族取**所指处的值**再转换（int ⇒ `_itoa_s` 十进制 |
| `missing-operand-io` | P2 | 0x1b2 | 第 1 格的**整数转串**能力缺失：引擎 `sub_41B9B0(_this, 1)` 按 tag 分派并对 int 族走 `_itoa_s(值, …, 10)`（把槽里的**值**转十进制串）再追加进文本缓冲；emu |
| `missing-operand-io` | P3 | 0x308 | `_this[1954] = op1`（三条出边都写，含失败路径）在 emulator 里没有对应格；该字段全反编译只写不读 ⇒ 对 VM 不可观测，属登记性缺口（与 0x2fa 的 Engine[1951] 同类）。 |
| `missing-behavior` | P2 | 0x223 | 缺「写入转场记录前的惰性建层/渲染目标重绑」：引擎 `sub_4ADDB0` 在写记录前先看 `_this[op2 槽号 + 10614]`——为 0 时用 `sub_4A2C10(Scene, 槽号, 本帧目标[260 |
| `missing-behavior` | P2 | 0x308 | 0x308 的宿主副作用完全没有实现：既不 `LoadLibraryA`+`GetProcAddress` 调注册/注销触摸的导出，也不按门 `op1 || (GetConfig("system:limitTouch") |
| `missing-behavior` | P1 | — | `0x1F5` 计到 0 时的帧驱动出队（`if (!dispatch_in_progress) sub_40FB60(_this)`）未接线：emulator 的 op_frame_countdown 只清停靠锁，队列 |
| `missing-behavior` | P1 | — | 每帧的效果推进 `sub_453540`（按墙钟、上限 100 次、对三路效果对象各推进一次）在 emulator 完全没有：PixiBackend 每帧 present 不推进任何效果子系统。 |
| `missing-behavior` | P2 | — | 0x72 尾段的 AutoMessage 自动放行分支（_this[97052] 非 0 时按 message:AutoMessage* 起 sub_453A60(_this + 107545, v10) 计时器）在 e |
| `missing-behavior` | P1 | — | 鼠标右键的『取消/跳读』通路（raw 20365-20374：Engine[489488] 的 label 偏移 + 清 ADV 掩码 0x6000000 + 改写帧 ip）与 20341-20360 的逐字中滚轮上键整 |
| `missing-behavior` | P2 | — | 0x20F（及 32245/32528/32600/32877 四个同型点）对 Engine+4*i+378688 的 CMovieToTexture 槽做惰性创建并绑到 CTexture 槽；emulator 该表/对 |
| `host-invented` | P3 | 0x108 | `readButtons()` 把 `pressLatch`（mousedown 时置位、**首次读取才清**）或进返回值 —— 引擎的 `sub_477220` 每次都从清零的局部量重算、**没有任何保持位**；若一次 |
| `host-invented` | P1 | 0x205 | x 前进量被写回脚本操作数 op2：引擎把 op2 读进局部 `v8`、只更新 `&v8`（栈地址），从不回写操作数；emulator 的 `plan.setInt(2, nx)` 把 `x + 前进量` 写回脚本槽 ⇒ |
| `stale-ledger` | P2 | 0x327 | `stubs.ts` 同一文件内自相矛盾：第 213-215 行的块注释仍写「同族的 `0x327`…与 `0x328`…**目前根本没注册** ⇒ 命中即 `NotImplementedOp`。**故意不上桩**」，而 |
| `stale-ledger` | P2 | — | emulator.status=`partial` 与同一条目的 note 首句『emulator 完全未建模』互相矛盾：代码里 `46668` 只出现在一条注释（stubs.ts:107，说明 0x326 自带该门槛） |
| `stale-ledger` | P2 | — | note『已实现，但无专门测试』与仓库不符：0x322/0x323 的『缺失即建项（flags=0，不画）』既有专门测试（test/mesh-vertex-quad.test.ts 是 0x320/0x322/0x323 |
| `stale-ledger` | P2 | — | `emulator.guard` 写『（无）』，但 test/op-327-32e-setweather-noop.test.ts 就是这条『0x327/0x328/0x329/0x32C/0x32E 已登记为 engi |
| `stale-ledger` | P1 | — | 台账 `absent`/E0「冻结豁免位随 46512 一起未建模」为假：`Scene+46528` bit2 的判据已建模进冻结路径（`entryParam & 1` 豁免）且有守卫。 |
| `stale-ledger` | P1 | — | 台账称引擎脚本派发队列「未建模、0x143 是 no-op」，实际 `scriptRequests` + `dispatchNextRequest` + `op_dispatch_script_requests` 已逐条 |
| `stale-ledger` | P1 | — | 台账把文本排版记成 `absent`/`E0`/无守卫，实际 emulator 已实现等宽网格 + 边界硬断 + 注音配对 + 对齐并有 7 条守卫断言 —— 后续审计会重复去“补”已存在的实现。 |
| `stale-ledger` | P2 | — | guard 与 note 的行号锚点指向别的东西：note 的 `msgwin.ts:1146-1189` 是窗对象 range/`0x25D`/`pre48` 一族，`test/text-layout.test.ts: |
| `stale-ledger` | P1 | — | 台账 lazy-movie-dll 声明 status=absent/E0/no-guard，但 0x14B（sub_4229D0，含 FreeLibrary 先释放再 LoadLibraryA 的重载语义）与 0x14 |

★其中 **`stale-ledger` 9 条 = 台账措辞过期（不需要代码，只需订正台账/守卫锚点）**；
  其余 **27 条是候选真缺口**（需要逐条读体核实后实现或如实登记）。

## §5 复核结果（2026-09-25）：**8 条 `stale-ledger` 已全部由 A–F 波解决**（逐条证据，2026-09-25 复核实测）

| # | 审计说（台账与代码不一致） | 现状（实测） | 证据 |
|---|---|---|---|
| 1 | `stubs.ts` 第 213-215 行注释写「0x327/0x328 目前根本没注册 ⇒ 命中即 NotImplementedOp」 | **已改**：旧话已删，现第 298 行明写「它没有机械消费者，已删；照它撤表会让整段 SETWEATHER 剧情重新硬停（`call-script 47`）」 | `grep 根本没注册\|故意不上桩` 在 `src/vm/handlers/stubs.ts` 只命中该说明句 |
| 2 | 某条 `status=partial` 与 note 首句「emulator 完全未建模」矛盾 ⇒ 应为 `absent` | **已改**：`lazy-3d-effect-202-snow` / `-203` 现为 `n/a-known`（有据 no-op） | `capabilities.js --validate` ✅ 144 条；本轮另把两条的悬空 note（"why: 同上"）自足化 |
| 3 | 0x322/0x323「已实现但无专门测试」 | **已改**：`lazy-mesh-map-node` = `modeled-verified`，guard = `test/blend-mode.test.ts#0x322 的 op2 必须落进 MeshObj.blend` | 台账实测 |
| 4 | 某条 `guard` 写「（无）」但 `test/op-327-32e-setweather-noop.test.ts` 存在 | **已改**：`scene-3d-weather-effects-rain-snow-leaf` 的 guard = `test/scene-3d-weather.test.ts`，且该 noop 守卫也在册 | 台账实测 |
| 5 | `Scene+46528` bit2「冻结豁免位未建模」（absent/E0）为假 | **已改**：`scene-flag-46528-bits` = `modeled-verified` / E2，guard = `test/wait-gate-timer.test.ts`，note 还补了唯一写者 0x24E(raw 32965) | 台账实测 |
| 6 | 脚本派发队列「未建模、0x143 是 no-op」为假 | **已改**：`script-queue-dispatch` = `modeled-verified`，guard = `test/op-1f5-dequeue.test.ts`；另有 `script-request-queue-drain-dispatch`（partial，带具体 missing） | 台账实测 |
| 7 | 文本排版记成 absent/E0/无守卫为假 | **已改**：`text-layout-wrap-ruby` = `modeled-verified`，guard = `test/text-layout.test.ts` | 台账实测 |
| 8 | 某条 guard/note 的行号锚点指向别的东西（`msgwin.ts:1146-1189` / `test/text-layout.test.ts:248-264`） | **已改**：`text-font-rebuild-cascade` 的 note 已换成**标识符锚点**（`op_set_main_size(0x75)` 等 7 条 + `operandPlan.ts:401` + `MSGWIN_OPS` + `config1-chain.test.ts:93-94`）；旧行号只留在 `journal[]`（沿革） | 台账实测（note 内文案自述由 `T-0151` 换锚） |

⇒ **§4 的 36 条分诊表里，`stale-ledger` 一类已清空**；剩下的 28 条候选真缺口见 §5.2 的机械化复核表（`still-present` = 复现点可能还在）。
### §5.2 机械化复核表（判据：拿每条 finding 自带的 `emulator.file` + `emulator.quote` 去当前工作树里找）

复核方法：拿每条 finding 自带的 `emulator.file` + `emulator.quote`，在当前工作树里找"审计当时看到的那段代码"。
`still-present` = 复现点可能还在（候选仍开）；`quote-gone` = 代码已改（待人工确认是否已修）。

汇总：quote-gone 13 / still-present 23

| 严重度 | kind | opcode | 复核 | emulator.file | 摘要 |
|---|---|---|---|---|---|
| P3 | `missing-consumer` | 0x248 | `still-present` | `src/vm/handlers/gfx-misc.ts` | 引擎全局 `dword_55052C`（默认 256，blit 分块/格宽除数）在 emulator 里没有消费者：写进 `engineValues[-248]` 后无人读 ⇒ 脚本改这个值不会让 e |
| P3 | `missing-consumer` | 0x32f | `still-present` | `src/vm/handlers/gfx-misc.ts` | 灯光开关整条能力缺失：引擎写 `Scene[4*op1+54708] = 0`（灯光 enabled 位，设备重建时被读来回放 SetLight/LightEnable，raw 122112-1221 |
| P3 | `missing-consumer` | 0x340 | `still-present` | `src/vm/handlers/gfx-misc.ts` | 渲染状态整条能力缺失：引擎把 op1 存进 `Scene[13948]` 并在设备重建时重放（raw 122124），emulator 既不写这个状态槽也没有宿主实现（gfx-misc.ts:98 的 |
| P3 | `missing-consumer` | 0x245 | `still-present` | `src/vm/native.ts` | emulator 唯一的落点是 `native.setTextureObjectFloat`，而 PixiBackend / HeadlessScene / StubNative 都没有实现它（nat |
| P3 | `missing-consumer` | 0x246 | `still-present` | `src/vm/native.ts` | 宿主三实现都没有 `setTextureObjectParam`（native.ts 只声明为可选缝）⇒ 引擎里真实的 vtable+56 调用在 emulator 消失；且该缝被 0x1F9/0x2 |
| P3 | `missing-operand-io` | 0x61 | `still-present` | `src/vm/operand.ts` | 引擎体对 op1 是“按操作数自身 tag 写”的 —— op1 为直接型（int/float/string）时它把地址写进同类型的**直接槽**、为指针型时写指针池条目；emulator 的 `se |
| P2 | `missing-operand-io` | 0x192 | `still-present` | `src/vm/operand.ts` | 第 2 格操作数的**强制转换能力**缺失：引擎 `sub_42A420` 对 int 族 tag 走 `_itoa_s(值, …, 10)`（取槽里的**值**转十进制串）、float 族走 `%l |
| P1 | `missing-operand-io` | 0x193 | `still-present` | `src/vm/handlers/strings.ts` | 第 2/3 格操作数的**指针解引用与整数/浮点转串**能力缺失：引擎 `sub_42A420` 对 `local-ptr`/`global-ptr` 族取**所指处的值**再转换（int ⇒ `_i |
| P2 | `missing-operand-io` | 0x1b2 | `still-present` | `src/vm/operand.ts` | 第 1 格的**整数转串**能力缺失：引擎 `sub_41B9B0(_this, 1)` 按 tag 分派并对 int 族走 `_itoa_s(值, …, 10)`（把槽里的**值**转十进制串）再追 |
| P3 | `approximation` | 0xa0 | `still-present` | `src/vm/handlers/control.ts` | emulator 要求真/假分支目标命中 labelMap（否则抛 `jcc: unknown true/false label`）；引擎对两个目标都不校验、直接以 `base + 4*目标` 写 i |
| P3 | `missing-consumer` | 0x25a | `still-present` | `src/vm/handlers/engine-fields.ts` | `sub_4A5470(Scene, id)` 的两条媒体下发分支（模式变化门 raw 33198-33199、非 display:ScreenMode 门 raw 33200-33201）在 emu |
| P2 | `missing-behavior` | 0x223 | `still-present` | `src/renderer/scene/ops.ts` | 缺「写入转场记录前的惰性建层/渲染目标重绑」：引擎 `sub_4ADDB0` 在写记录前先看 `_this[op2 槽号 + 10614]`——为 0 时用 `sub_4A2C10(Scene, 槽号 |
| P3 | `host-invented` | 0x108 | `still-present` | `src/vm/input.ts` | `readButtons()` 把 `pressLatch`（mousedown 时置位、**首次读取才清**）或进返回值 —— 引擎的 `sub_477220` 每次都从清零的局部量重算、**没有任 |
| P3 | `approximation` | — | `still-present` | `src/renderer/scene/state.ts` | 引擎对**所有**层都把完整 Scene 世界矩阵乘进项 work 矩阵（133403-133407 门为真的支），只有层号 ∈[20,30) 走 `else` 的 decompose→『压成 2D』 |
| P2 | `stale-ledger` | — | `still-present` | `test/mesh-vertex-quad.test.ts` | note『已实现，但无专门测试』与仓库不符：0x322/0x323 的『缺失即建项（flags=0，不画）』既有专门测试（test/mesh-vertex-quad.test.ts 是 0x320/0 |
| P2 | `stale-ledger` | — | `still-present` | `test/op-327-32e-setweather-noop.test.ts` | `emulator.guard` 写『（无）』，但 test/op-327-32e-setweather-noop.test.ts 就是这条『0x327/0x328/0x329/0x32C/0x32E |
| P1 | `stale-ledger` | — | `still-present` | `src/renderer/scene/ops.ts` | 台账 `absent`/E0「冻结豁免位随 46512 一起未建模」为假：`Scene+46528` bit2 的判据已建模进冻结路径（`entryParam & 1` 豁免）且有守卫。 |
| P2 | `approximation` | — | `still-present` | `src/renderer/scene/ops.ts` | 引擎的置脏无条件（只看 `46512|46516` 非零），emulator 的等价物是「freeze 且存在可冻结项」才置脏：freeze 置位但场景里没有可冻结窗时 emulator 不置脏。 |
| P2 | `missing-behavior` | — | `still-present` | `src/vm/handlers/msgwin.ts` | 0x72 尾段的 AutoMessage 自动放行分支（_this[97052] 非 0 时按 message:AutoMessage* 起 sub_453A60(_this + 107545, v1 |
| P1 | `missing-consumer` | — | `still-present` | `src/vm/handlers/msgwin.ts` | message:AutoMessageTime{0,1} / AutoMessagePitch{0,1} / AutoMessageOption 有写入端（0x1B9/0x2E7/0x2E8）但没有任 |
| P1 | `stale-ledger` | — | `still-present` | `src/text/layout.ts` | 台账把文本排版记成 `absent`/`E0`/无守卫，实际 emulator 已实现等宽网格 + 边界硬断 + 注音配对 + 对齐并有 7 条守卫断言 —— 后续审计会重复去“补”已存在的实现。 |
| P2 | `stale-ledger` | — | `still-present` | `src/vm/handlers/msgwin.ts` | guard 与 note 的行号锚点指向别的东西：note 的 `msgwin.ts:1146-1189` 是窗对象 range/`0x25D`/`pre48` 一族，`test/text-layou |
| P2 | `missing-behavior` | — | `still-present` | `src/renderer/pixiBackend.ts` | 0x20F（及 32245/32528/32600/32877 四个同型点）对 Engine+4*i+378688 的 CMovieToTexture 槽做惰性创建并绑到 CTexture 槽；emu |
| P3 | `approximation` | 0x2eb | `quote-gone` | `src/vm/handlers/config-read.ts` | 取值口径近似：引擎是「内建 `1.00` → INI `[set] GameVersion` 覆盖 → `set:VerRegPos` 非空时用注册表 `DisplayVersion` 覆盖」三层，e |
| P2 | `missing-consumer` | 0x1ba | `quote-gone` | `src/vm/handlers/audio.ts` | 四条分支末尾（以及 `0xBB`/`0xBC`）都会调 `sub_406DF0(Engine, 类别, a2)` 把该类声音的开关下发给正在播放的影片播放器音轨；emulator 的 `switchM |
| P1 | `host-invented` | 0x205 | `quote-gone` | `src/vm/handlers/msgwin.ts` | x 前进量被写回脚本操作数 op2：引擎把 op2 读进局部 `v8`、只更新 `&v8`（栈地址），从不回写操作数；emulator 的 `plan.setInt(2, nx)` 把 `x + 前进 |
| P2 | `missing-behavior` | 0x308 | `quote-gone` | `src/vm/handlers/stubs.ts` | 0x308 的宿主副作用完全没有实现：既不 `LoadLibraryA`+`GetProcAddress` 调注册/注销触摸的导出，也不按门 `op1 || (GetConfig("system:li |
| P3 | `missing-operand-io` | 0x308 | `quote-gone` | `src/vm/handlers/stubs.ts` | `_this[1954] = op1`（三条出边都写，含失败路径）在 emulator 里没有对应格；该字段全反编译只写不读 ⇒ 对 VM 不可观测，属登记性缺口（与 0x2fa 的 Engine[1 |
| P2 | `stale-ledger` | 0x327 | `quote-gone` | `app/amayui-emulator/src/vm/handlers/stubs.ts` | `stubs.ts` 同一文件内自相矛盾：第 213-215 行的块注释仍写「同族的 `0x327`…与 `0x328`…**目前根本没注册** ⇒ 命中即 `NotImplementedOp`。** |
| P2 | `stale-ledger` | — | `quote-gone` | `src/vm/handlers/stubs.ts` | emulator.status=`partial` 与同一条目的 note 首句『emulator 完全未建模』互相矛盾：代码里 `46668` 只出现在一条注释（stubs.ts:107，说明 0x |
| P1 | `stale-ledger` | — | `quote-gone` | `src/vm/handlers/control.ts` | 台账称引擎脚本派发队列「未建模、0x143 是 no-op」，实际 `scriptRequests` + `dispatchNextRequest` + `op_dispatch_script_req |
| P1 | `missing-behavior` | — | `quote-gone` | `src/vm/handlers/frame.ts` | `0x1F5` 计到 0 时的帧驱动出队（`if (!dispatch_in_progress) sub_40FB60(_this)`）未接线：emulator 的 op_frame_countdow |
| P1 | `missing-behavior` | — | `quote-gone` | `src/vm/handlers/stubs.ts` | 每帧的效果推进 `sub_453540`（按墙钟、上限 100 次、对三路效果对象各推进一次）在 emulator 完全没有：PixiBackend 每帧 present 不推进任何效果子系统。 |
| P2 | `approximation` | — | `quote-gone` | `src/vm/handlers/msgwin.ts` | 引擎的『显示完了吗』由 sub_48F000 查脚本分段表得出（miss/越界返回 0），emulator 用 `readTextSkipOf(e) !== 0 ? 1 : 0` 伪造返回值，再用 s |
| P1 | `missing-behavior` | — | `quote-gone` | `src/vm/engine.ts` | 鼠标右键的『取消/跳读』通路（raw 20365-20374：Engine[489488] 的 label 偏移 + 清 ADV 掩码 0x6000000 + 改写帧 ip）与 20341-20360 |
| P1 | `stale-ledger` | — | `quote-gone` | `src/vm/handlers/agerc.ts` | 台账 lazy-movie-dll 声明 status=absent/E0/no-guard，但 0x14B（sub_4229D0，含 FreeLibrary 先释放再 LoadLibraryA 的重 |

## §6 已登记缺口的「live 承接票」缺口（2026-09-25 实测 ⇒ 已由 `T-0179` 承接）

`analysis/opcode-gaps.json` 的 `partial` 处置位要求每条 `missing[]` 带**承接票**（`tickets/` 下必须真实存在）。
实测：**140/140 条 `missing[]` 的 `ticket` 全部指向已经 `done`/`dropped` 的票**（`T-0151`×28 / `T-0152`×17 /
`T-0155`×12 / `T-0153`×11 / `T-0156`×9 / `T-0154`×8 / `T-0162`×7 / `T-0164`×7 / `T-0163`×7 / `T-0159`×7 /
`T-0158`×6 / `T-0170`×6 …）⇒ A–F 波逐簇收票后，这份登记账**失去了 live owner**：既不在看板的 doing/open 里，
也不受任何一轮判绿口径约束。

**处置（结构性，已完成）**：开 `T-0179`（P2）作为这 140 条的 live 承接票 —— 84 条 `partial` 条目的
`missing[].ticket` 批量改指 `T-0179`，**原承接票逐条目写进 `journal[]`**（出处不丢，对照表见
`tickets/T-0179/changes-t0179.md` §3）；`what`/`raw`/`disposition` 一字未动，counts 不变
（partial 84 / 缺口 140）。⇒ **`T-0148` 的剩余面**因此收敛为：① 80 个未登记 opcode 的裁决批；
② `T-0179` 里 140 条 missing 的逐条裁决（实现/关掉/保留）；③ 三张 doing 票（`T-0148`/`T-0091`/`T-0067`）。

## §7 已裁决清单（`T-0179` 逐条关单的进度，倒序追加）

| 日期 | §5.2 里的项 | 处置 | 落点 |
|---|---|---|---|
| 2026-09-25 | `0xa0`（approximation：emulator 自造硬错误） | **实现**：`op_jcc` 改**两级解析**（`labelMap` → 未命中回落 `script.dwordToInstr`；只有目标越出脚本才抛，作为宿主侧护栏）—— 与引擎 raw 29635 的 `ip = ip_base + 4*目标`（**不校验**）一致 | `src/vm/handlers/control.ts` 的 `op_jcc`/`resolveBranch`；守卫 `test/op-a0-8c-8f-branch-targets.test.ts`（3 例）；台账新增 `0x0a0 = implemented`；红→绿 = 摘掉回落 ⇒ 2/3（1 红：非标签合法偏移那条），恢复 ⇒ 3/3 |
| 2026-09-25 | `0x8c`（jmp，missing-operand-io）＋ 同族的 `0x8f`（call，审计未点名） | **实现**：与 `0xa0` 同一处口径 —— `shared.ts` 新增 `branchTarget(frame, raw)`（`labelMap` → 未命中回落 `script.dwordToInstr`）与 `branchTargetError`，`jmp`/`call`/`jcc` 三条共用；只有目标越出脚本才抛（引擎 raw 29397/29469/29635 都不校验） | `src/vm/handlers/shared.ts` ＋ `handlers/control.ts`（`op_jmp`/`op_call`/`op_jcc`）；守卫 `test/op-a0-8c-8f-branch-targets.test.ts`（**5 例**，含"call 的返回栈压的是 dword 偏移 3"）；台账：`0x8c` 删掉 raw 29395-29399 那条 missing（保留 call-frame 深度门那条）＋ 新登记 `0x8f = implemented`；红→绿 = 摘掉回落 ⇒ **2/5（3 红）**，恢复 ⇒ **5/5**；控制流族回归 49/49 |

★同批**复核后确认「已修」、无需动代码**的 §5.2 项（记下来避免下一轮重复投入）：
`0x192` / `0x193` / `0x1b2`（操作数 int/float/ptr → 串的强制转换：`readStringOperand` 已按 tag 分派做 `_itoa_s` 十进制 / `%lf` / 指针解引用，由 `T-0162`/`T-0163` 落地）。
## §8 §3 那 80 个 opcode 的机械化裁决（对当前运行时三张表 + 语料用量，2026-09-25）

判据：审计点名过、但不在 `analysis/opcode-gaps.json` 的 opcode；对 `OPS`（真实现）/ `NATIVE_OPS`（宿主缝实现）/ `ENGINE_INTERNAL_OPS`（有据 no-op）三张表逐个查表，并数 `src/*.txt` 里 `i<hex>` 的行数。

汇总：`registered-implemented` 64 / `registered-native` 12（合计 76）

| opcode | 裁决 | 语料 | 审计 | 审计说 |
|---|---|---|---|---|
| 0x1d2 | `registered-implemented` | 42760 | P3/`missing-consumer` | 一条记录只报这一个结构缺口：引擎 72 B 记录里 `+4/+8/+12/+16`（写入端 `sub_45EFA0` raw 74348 `memset(&v7[1], 0, 16)` 清零、重排路径 `sub_45F090` raw 74382-74389 填 `a4[0..3]`）与 `+44` |
| 0x2bd | `registered-implemented` | 1048 | P2/`missing-behavior` | 漏掉同步写的第二个字重格：引擎在 op1≠0 时把 `_this[75953]`（Font+218516）与 `_this[21636]`（Font+1248，主字体 LOGFONTA 模板 `Font+0x15200` 的 lfWeight）**同时**写 700（假时同写 0）；emulator |
| 0x20a | `registered-implemented` | 1011 | P3/`missing-branch` | 重贴门的取值来源：引擎是 `_this[124350] ? _this[95779] : _this[174801]`（脚本派发中时改读派发前保存的 effect_flags），emulator 只读 `effectFlags`（= `_this[174801]`）⇒ 当 `Engine[12435 |
| 0x197 | `registered-implemented` | 878 | P2/`missing-consumer` | `sub_418680` 把新字号写进 **10 个字体对象**的 `+200`（字号）与 `+204`（`_this[327]`）并逐个生效；emulator 只有一个全局标量 `MsgWindow.font.rubySize`，没有这 10 个对象的对应物 ⇒ 任何「按字体对象取注音字号」的路径 |
| 0x260 | `registered-implemented` | 878 | P1/`missing-consumer` | `vPad` 无消费者：引擎在竖排绘制时用 (+235112,+235120) 平移目标点、用 (+235116,+235124) 扩源矩形（`sub_45A940` 一族），emulator 只把 4 个值存进 `g.vPad` 就再无读者 ⇒ 竖排文本的这层修正完全丢失。 |
| 0x2fe | `registered-implemented` | 875 | P2/`missing-branch` | 引擎对不在可选字体表（且不等于 `"AGE Extend"`）的注音面名会打印警告串「警告：[%s]は選択可能フォントの一覧に含まれていません。」；emulator 无条件接受任意面名、既不警告也不回退，于是「装不到的注音字体名」与「装得到的」表现完全相同（都静默走 FACE_MAP），排查字体问题 |
| 0x1ce | `registered-implemented` | 857 | P3/`approximation` | 零分支的收尾目标窗：引擎把 `_this[122371]` **原样**交给 `sub_45A940`，而被调体内是 `_this[a2 + 261]`（无 `if (!a2) a2 = Font[307]` 这条默认窗回退，见 sub_4563D0/sub_456400/sub_45AD30 都有 |
| 0x19c | `registered-implemented` | 524 | P3/`approximation` | 引擎 `0x19C` 在置 ADV 位的同一块里顺手清 `0x20000000`（= `sub_453A60` 逐字计时器「正在跑」标志，「进入 ADV 就把在跑的计时器作废」）；emulator 的 `op_adv_enter` 只做 `setAdv` + `m.skipping = 1`，没有对 |
| 0x7a | `registered-implemented` | 520 | P3/`approximation` | 引擎的 `buf[-20]` 是**文本项缓冲头里的活游标**：排版例程每次写新记录时用 `*(_DWORD *)(v5[12] - 20) = v5[7]` 把它复位成对象自带的 `obj[28]`（0x79 的文字起点）；emulator 的 `o.pre48Set/pre48a/pre48b` |
| 0x259 | `registered-implemented` | 517 | P3/`missing-consumer` | `Engine.texSlotFlags` 无消费者：handler 在 gfx-misc.ts:87 清它，但全仓没有读点（渲染、装配、快照、读档都不含它）；引擎侧这对标志位却会随存档快照持久化（raw 17474）并在装载路径按 flag_a==1 决定重建槽（raw 19877）⇒ emula |
| 0x1bb | `registered-implemented` | 470 | P3/`missing-branch` | 非法实参（既非 0 也非 1）的处理与体不同：体把 `SetTBの引数が不正です． ` 格式化进 `_this+8` 缓冲后交 `sub_4034D0` 走日志/消息汇（sub_4976A0 → sub_497620 → sub_438CC0 的 WriteFile），**不写字段、也不改控制流** |
| 0x1a0 | `registered-implemented` | 339 | P3/`approximation` | 读侧字节口径：引擎只 `ReadFile(hFile, Buffer, 0x124u, &NumberOfBytesRead, 0)` 读 **292 字节**（且要求 `NumberOfBytesRead == 292` 才算成功）；emulator 的 `fs.readSaveSlot` 把整份 |
| 0x1b6 | `registered-implemented` | 337 | P1/`missing-consumer` | 引擎有一条**「消费即清零」**的帧循环：消息泵入口 `sub_4090F0` 一进来 `if (a1[97052]) { a1[97052] = 0; return; }`（`sub_476080` raw 90961-90965 同形，改为按 `set:CoexistMesSkip` 决定 `9 |
| 0x1b7 | `registered-implemented` | 336 | P1/`missing-consumer` | `0x1b7` 写进 97052 的值在引擎里**有到期机制**（消息泵入口 `sub_4090F0` raw 13699-13703：`if (a1[97052]) { a1[97052] = 0; return; }`；`sub_476080` raw 90961-90965 另按 `set:C |
| 0x94 | `registered-implemented` | 334 | P2/`missing-branch` | 引擎的鼠标移动命中测试被 `if ( _this[12958] || _this[12957] )` 门控（12958 = 面板 `[7464]` 待填充、12957 = `[7463]` 已显示，两者都由 0x94/0x91/0x92 置位、由 0x93 的 `sub_403EF0([7464]= |
| 0x303 | `registered-implemented` | 252 | P3/`approximation` | 引擎把 op2 **原样**写进消息窗对象的 `+288`，emulator 先把它归一成 `mode === 1 ? 1 : mode === 2 ? 2 : 0` 再存进 `align`：op2 取 1/2 之外的非 0 值时引擎会留下原值，emulator 存 0。 |
| 0x23d | `registered-implemented` | 203 | P2/`missing-consumer` | 『释放 slot 42..999』整条能力缺失：引擎既析构影片对象（`_this+4*slot+378688`）又经 `sub_49E980` 解绑 Scene 的槽→imgid 记录并把槽对象析构，emulator 的宿主缝未实现 ⇒ 这些槽的绑定与纹理全部留存，后续引用它们的绘制项仍会贴出旧图。 |
| 0xd9 | `registered-implemented` | 183 | P2/`missing-branch` | 引擎 `if ( _this[124350] )` 的门在 emulator 读的是 `engineValues.get(ENGINE_FIELD.dispatchInProgress)`，而键 124350 全仓**无写点**（派发中状态由 `Engine.dispatching: boolean |
| 0x305 | `registered-implemented` | 137 | P1/`missing-branch` | 缺总门分支：引擎仅在 `(Engine[489988] & 0x10001) == 65537`（bit0 由 `0x304` 置、bit16 由 `0x6E` 在 bit0 已置时补写）时才取回行游标并 `while (!sub_45BE20(...))` 把余下行贴出；emulator 无条件  |
| 0x2da | `registered-implemented` | 112 | P3/`approximation` | 门的符号口径与体不同但结论等价：体是 `unsigned int v2` 与 `0xA` 比较（负数按 2^32 巨值 ⇒ 越界），emulator 写 `n < 0 || n > 0xa`（显式把负数判越界）。两者对 `n = -1` 都返回、都不写记录 ⇒ 本轮**未发现**行为差异，登记为口径 |
| 0x21e | `registered-implemented` | 56 | P3/`stale-ledger` | 派发表里 `0x21E` 的行内注释仍写「sx/sy/sz ÷256」，与同文件 handler 实现（÷100）和引擎除数 `dbl_5201F0 = 100.0` 都不符——该注释只存在于 `GFX_ITEM_OPS` 表，handler 的 docstring（gfx-item.ts:148） |
| 0x2fc | `registered-implemented` | 44 | P3/`missing-consumer` | 无触点路径上引擎仍有副作用：`sub_477980` 遍历完缓冲且没有任何合法项时把触摸项计数 `_this[1694]` 清零（raw 92162-92163），即缓冲里的项全是手写笔项或缺 0x10 位时被丢弃并清计数；emulator 没有触摸缓冲，这条清空无从复现（也没有消费端读该计数）。 |
| 0x73 | `registered-implemented` | 27 | P2/`approximation` | `sub_456430` 写进窗对象的 40 字节里，`win+36` 是 **op2**（`v13[5] = a3`）、`win+40` 是 **op3**（`v13[6] = a4`），而 emulator 存的是 `srcSurface ← op4` / `textY ← op3` / `te |
| 0x239 | `registered-implemented` | 18 | P3/`missing-branch` | 引擎的门是读**已存在元素**的 `flags` bit0（`if ((*(_BYTE *)result & 1) != 0)`）—— 一个 `flags = 0` 的既有项（例：早前 `set-draw-color-alpha`/`set-draw-pos` 建过但从未 `draw-texture |
| 0x2e5 | `registered-implemented` | 15 | P3/`approximation` | 水平滚轮累加侧漏了引擎的 `(Engine+699204 & 0x90100000) != 0` 门：真机在该门成立时把 `WM_MOUSEHWHEEL` 当作 `set:HWheelKeyUp/Down` 配置键派发、**不写** `Engine[7800]`；emulator 无条件累加 ⇒ ` |
| 0x19d | `registered-implemented` | 8 | P2/`missing-branch` | 配置缺键（`set:SaveVersion1` 不存在）时的缺省不是引擎内建默认：emulator 用 `cfgInt(..., 0)` ⇒ v1=0 必进 `v1<3` 提前返回；引擎的注册表在缺键时返回内建默认 `set:SaveVersion1 = 1`（仍 <3，故在本机 INI 上结论同） |
| 0x1fe | `registered-implemented` | 7 | P2/`missing-consumer` | `0x1FE` 的四个值在引擎里是「旋转轴 (op2,op3,op4) + 角度(度, op5)」，会组成 `D3DXMatrixRotationAxis` 写进该绘制项的变换块并置 `+104 = 1`；emulator 只把 `[a,b,c,d]` 记进 `render4.primTransfo |
| 0x32f | `registered-implemented` | 6 | P3/`missing-consumer` | 灯光开关整条能力缺失：引擎写 `Scene[4*op1+54708] = 0`（灯光 enabled 位，设备重建时被读来回放 SetLight/LightEnable，raw 122112-122118）并下发设备 LightEnable；emulator 既不写这个标志位也没有宿主实现（gfx- |
| 0x352 | `registered-implemented` | 4 | P2/`missing-branch` | sub_478540/sub_478560 都以 `if (*(_DWORD*)_this)` 为门：实例（Live2D 槽）不存在时 0x352 是彻底的 no-op；emulator 用 ensureSlot 建出空槽并写入 pending 值 ⇒ 引擎里不存在的槽在 emulator 里被创建 |
| 0x2c7 | `registered-implemented` | 3 | P3/`missing-branch` | 负起点的错误路径缺失：引擎只把 `v3 >= v13 || v4 <= 0` 判成空串（`v3` 是 signed），`v3 < 0` 且 `v4 > 0` 时会继续执行到 `sub_40C120`，那里的 `if ( v6 < a3 )` 是**无符号**比较 ⇒ 必然抛 `std::out_of |
| 0x1ac | `registered-implemented` | 2 | P2/`host-invented` | 「源槽不存在」时 emulator 报 op1 = 1（失败），引擎报 **0**（成功）：引擎的 `v5 = !CopyFileA(...)` 只看 `CopyFileA` 的返回值，而 `CopyFileA` 返回非 0 的场合包含「源不存在」⇒ 引擎把「从空槽复制」判成成功（并且这次调用已经把 |
| 0x198 | `registered-implemented` | 2 | P3/`missing-branch` | 引擎 `sub_456400` 在 `_this[v4 + 261] == 0`（该窗对象不存在 / 窗号未被创建）时**一格都不写、静默跳过**；emulator 的 `MsgWindow.geom()` 是惰性建窗（`if (!g) { g = defaultWinGeom(); this.wi |
| 0x212 | `registered-implemented` | 2 | P3/`missing-branch` | 引擎 `if ( v4 )` 的空表项门在 emulator 被换成「必要时新建对象」：op1 指向未创建的对象槽时，引擎什么都不做，emulator 会凭空建一个对象并把 +100 写进去（该伪造对象此后还会被 0x213/0x25d 的同族写与 `itemRangesOf` 读到）。 |
| 0xc5 | `registered-implemented` | 1 | P3/`missing-branch` | 越界 selector（≥5 或负）时引擎把 `GetVolumeの引数が不正です．` 连同 `(%s：%d行目)` 文件/行头经 `sub_4034D0`→`sub_4976A0`→`sub_497620` 报给宿主；emulator 直接在 `if (key === undefined) ret |
| 0xc7 | `registered-implemented` | 1 | P1/`missing-branch` | 引擎 `sound:Music` 支写的是 `(v2 >= 0)`（只有负值算关），SE/Voice/Movie 才是 `!= 0`；emulator 用同一个 `bool: true` 把四条都按「非 0 ⇒ 1」处理 ⇒ selector=1 时取值口径相反：`sound:Music == 0` |
| 0x2eb | `registered-implemented` | 1 | P2/`missing-branch` | 键存在但值为**空串**时引擎侧有「内建缺省 1.00 还在不在」这一层语义，而 emulator 的 `cfgStr` 对空串直接返回 `''`（`v === undefined ? fallback : String(v)`）⇒ op1 写成空串，TITLE 的第一段为空、`atoi("")`  |
| 0x248 | `registered-implemented` | 1 | P3/`missing-consumer` | 引擎全局 `dword_55052C`（默认 256，blit 分块/格宽除数）在 emulator 里没有消费者：写进 `engineValues[-248]` 后无人读 ⇒ 脚本改这个值不会让 emulator 的任何绘制/换算随之改变（真机的 blit 分块口径会变）。 |
| 0x14b | `registered-implemented` | 1 | P2/`missing-behavior` | 引擎在**第二次 i14b（重载）时必先 FreeLibrary 并把句柄槽清 0，之后 LoadLibraryA 失败也照样把失败结果（NULL）存回该槽** ⇒ 第二次加载失败后模块句柄是 NULL 且旧库已卸载；emulator 的 `if (e.agerc.loaded)` 守卫却在 id  |
| 0x25d | `registered-implemented` | 1 | P3/`missing-branch` | 与 0x212/0x213 同一处缺口：对象表项为空时引擎不写 +276/+280，emulator 会新建对象写入，并让该区间进入 `itemRanges`（第二组 DrawItem 区间）。 |
| 0x2dc | `registered-implemented` | 1 | P3/`approximation` | 引擎的字体表是被枚举填充的运行时表（`EnumFontFamiliesExA` 写入 `Font+201664`），未枚举时 `v1` 为 0 ⇒ 返回 **-1**；emulator 用编译期常量 `ENGINE_FONT_LIST`（9 项，恒非空）⇒ **永远不可能返回 -1**，即引擎「字体 |
| 0x340 | `registered-implemented` | 0 | P3/`missing-consumer` | 渲染状态整条能力缺失：引擎把 op1 存进 `Scene[13948]` 并在设备重建时重放（raw 122124），emulator 既不写这个状态槽也没有宿主实现（gfx-misc.ts:98 的 `setRenderState?.()` 落在空处）⇒ 脚本设过的渲染状态 #22 在 emula |
| 0x245 | `registered-implemented` | 0 | P2/`missing-branch` | 引擎有 `if ( _this[result + 94672] )` 门：该槽没有对象时**不读 op2、不做任何事**（返回值就是 op1）；emulator 无条件读 op2 并调用宿主缝 —— 对没有对象的槽也产生一次调用（在 DropRecorder 里留下丢弃记录）。 |
| 0x61 | `registered-implemented` | 0 | P3/`missing-operand-io` | 引擎体对 op1 是“按操作数自身 tag 写”的 —— op1 为直接型（int/float/string）时它把地址写进同类型的**直接槽**、为指针型时写指针池条目；emulator 的 `setRefOperand` 只接受 6 种指针型，遇到直接型 op1 直接抛错 ⇒ 若脚本给 int  |
| 0x64 | `registered-implemented` | 0 | P0/`missing-operand-io` | 字面数组的每一项在引擎体里被显式加密一次（`ROL4(key ^ ROR4(池原始值,7),21)`）后存**裸位模式**；emulator 把池原始值交给 `writeRef`，int 槽又被 `ENC` 一次 ⇒ 存进去的是“池原始值的 ENC”，任何 int 解引用读回都变成 `DEC(原始值 |
| 0xa2 | `registered-implemented` | 0 | P3/`missing-operand-io` | op1 的**字符串型键**没被建模：引擎的键读法 `sub_41B640(_this, 1)` 对字符串族操作数直接返回池里的字符串（case 5/11 返回 `_this[95748]`/`[95791]` 槽、case 8/14 返回字符串指针所指、case 2 走立即串池）并原样当键；emu |
| 0xa3 | `registered-implemented` | 0 | P3/`missing-operand-io` | op1 的**字符串型键**未建模：引擎 `sub_41B640(_this, 1)` 对字符串族操作数返回池里的原串当键，emulator 的操作数计划把 op1 声明为 `int` ⇒ `plan.int(1)` 对字符串型走 `atoi`/空串退路，键与引擎不同 ⇒ 用字符串键登记过的项永远查 |
| 0x91 | `registered-implemented` | 0 | P2/`missing-consumer` | `effect_flags |= 0x800000`（消息面显示态）在 emulator 里没有消费者：引擎侧该位的唯一读取端 `sub_4098E0`（raw 14055-14105）未实现——它按 `[174801] & 0x800000` 门控，左键走 `sub_404120`（取游标项 la |
| 0x92 | `registered-implemented` | 0 | P2/`missing-branch` | 显示分支末尾写长度槽 0（raw 29565，5 → 0）⇒ raw 20165 `ip += 4*0` 使 ip 停在本条（显示后挂起等 sub_4098E0 派发）；emulator 的 handler 正常返回、`interpreter.stepOnce` 默认 `curFrame.ip += |
| 0x53 | `registered-implemented` | 0 | P3/`unclear` | `op2 = INT_MIN(-2147483648)` 且 `op3 = -1` 时，引擎的 `v3 / v2` 编译成 x86 `idiv` ⇒ 商 +2147483648 溢出，CPU 抛整数溢出例外（真机异常/崩溃）；emulator 的 `Math.trunc(-2147483648 /  |
| 0x19f | `registered-implemented` | 0 | P2/`approximation` | 返回码口径偏离：引擎这条指令的 op1 只有两个来源 —— 打不开 ⇒ 常量 1，或 `sub_410160` 的返回值（该函数主出口恒 `return 0`）⇒ 成功装载一律 0；emulator 在「宿主读到的槽字节解析不出头/容器」时写 **2**，在引擎里对应的是「打开成功但 292 B 头 |
| 0x2 | `registered-implemented` | 0 | P3/`missing-behavior` | `v2 >= 0` 支缺「目标帧没装载脚本就逐级下退、退到 <0 抛退出」这条链：引擎对 `caller` 指向空帧不会直接切过去，emulator 直接 `cur = caller`，随后 stepOnce 会在空帧上抛错。 |
| 0x1fc | `registered-implemented` | 0 | P3/`missing-consumer` | `0x1FC` 的语义是"把该 DrawItem 的变换字段清零/复位到单位"（`+104 = 0` 关掉用矩阵那条路，三组矩阵格复位），emulator 只把 handle 记进 `render4.primReset` 并删掉 `render4.primTransform` 里的记录 —— 既没写 |
| 0x108 | `registered-implemented` | 0 | P3/`host-invented` | `readButtons()` 把 `pressLatch`（mousedown 时置位、**首次读取才清**）或进返回值 —— 引擎的 `sub_477220` 每次都从清零的局部量重算、**没有任何保持位**；若一次 down+up 全落在两次 0x108 之间，引擎两次都读到 0，emulat |
| 0x10d | `registered-implemented` | 0 | P3/`approximation` | 滚轮累加侧漏了引擎的「滚轮当按键」门：引擎在 `(Engine+699204 & 0x90100000) != 0` 时**不累加** `Engine[7796]`（改派发 `set:WheelKeyUp/Down` 掩码位），emulator 的 `addWheel()` 无条件累加 ⇒ 配置把滚 |
| 0x346 | `registered-implemented` | 0 | P2/`approximation` | `0x346` 复位后 emulator 把旋转写成 axis=[0,0,1]/deg=0，而引擎**不碰**轴 `+464/+468/+472` 与角 `+488`，缺省值是轴 (0,0,0)、角 -1（`sub_49CA10` raw 118434 写 `*(_DWORD *)(v2 - 420 |
| 0x34a | `registered-implemented` | 0 | P2/`missing-behavior` | 0x34a 改基础平移偏移后引擎会置 Scene+46508 脏位（`_this[11627] = 1`），emulator 的 l2dNodeBaseOffset 只改 baseOffset、不置 matrixDirty 也不通知宿主置脏 ⇒ 该指令单独发生时不保证重算/重画。 |
| 0x34c | `registered-implemented` | 0 | P3/`host-invented` | emulator 在 op6 缺失时把轴 z 分量当 1（`p.float(6) ?? 1`），引擎体对 op6 是无条件读（无任何默认）；若真缺 op6，引擎读到的是 0/未定义位模式而非 1 ⇒ 旋转轴不同。 |
| 0x350 | `registered-implemented` | 0 | P2/`missing-behavior` | 引擎 0x350 除复位队列外还清实例的 `+21/+22`（本帧已装载标志）与 `+20`（播放/循环位）；emulator 只把 `inst.current` 置 null，动作装载标志与播放位状态没有被清（子槽+动作记录上的循环位也没清）。 |
| 0x351 | `registered-implemented` | 0 | P2/`missing-branch` | 引擎把 op3 钳到 [0,255] 后再 /255（负数 ⇒ 用 0，>255 ⇒ 用 255，且钳位值会覆盖除法用的局部量）；emulator 无钳位，直接把原值 /255 ⇒ 越界实参会得到范围外的参数值。 |
| 0x6f | `registered-implemented` | 0 | P3/`missing-behavior` | `sub_46AF90` 在非注音支把**当前 24B 文本记录的笔位**推进到下一行（`*(v5[12]-20) = v5[7]`、`*(v5[12]-16) += v7`、`++*(v5[12]-4)`、`++v5[71]`），emulator 的 `endLine` 只置段标志而**不写任何笔 |
| 0xfa | `registered-implemented` | 0 | P1/`missing-consumer` | `0xFA` 在「非跳读」时会把 `Engine[122505 + 3*i]` 的 **3 个待播语音槽**逐个交给 `sub_4BB840(Engine+21032, i, 触发的字符串 id, 音量/延迟参数, 该槽另两格)` 消费并清槽（`*v4 = 0`）；emulator 的 `op_po |
| 0x1a5 | `registered-implemented` | 0 | P3/`missing-branch` | 引擎 `sub_4328F0` 的第一件事是**面名合法性检查**：`sub_428990`（在「可选字体一览」`Font+50416` 的 32 B/条表里按名字查）返回 < 0 且面名不是 `AgeExtend` ⇒ 打印 `警告：[%s]は選択可能フォントの一覧に含まれていません。`；emul |
| 0x204 | `registered-implemented` | 0 | P3/`approximation` | 直绘路径的空白字前进量：引擎在 `set:BlankExtentMode == 1` 且 `Font+201680 <= 1` 时对全角空格 `0x8140`/半角空格 `0x20` 调 `sub_404EE0` 逐字 GDI 量宽，emulator 的 `drawStringGlyphs` 一律用 |
| 0x25c | `registered-implemented` | 0 | P3/`missing-consumer` | `block224` 写完即弃：emulator 里没有任何排版/渲染代码读它（引擎那 13 dword 是文本项缓冲头，被绘制路径消费）。 |
| 0x2f7 | `registered-native` | 28122 | P3/`missing-operand-io` | 0x2F7 写 `Engine[21315+ch] = 1` 这一格在 emulator 不落地（只写宿主 `v.flag`）；0x1BC 清同族三格、0x2F7 置位这一半缺失，engineValues 里该槽永远看不到 0x2F7 的效果。 |
| 0x2ff | `registered-native` | 14124 | P2/`missing-operand-io` | 0x2FF 的两个引擎字段写（`Engine[21318+ch] = 1` 的「有因子值」位、`Engine[21321+ch] = op2` 的原始因子）emulator 全缺 ⇒ 同族的 0x302（读这两位决定是否把因子写进设备）与 0x2F4 一族（按 0x10000 位翻转）在 emula |
| 0xb8 | `registered-native` | 77 | P2/`missing-behavior` | `0xB8` 在 emulator 里只落成宿主的纯停播（`bgmStop()` → `#stopBgm()`），但引擎体**不碰**任何 BGM 模式/开关字段；若宿主的 `#bgm.mode` 被置 0，后续 `0xB7`/`0xBF` 起播会被 `bgmPlay` 的 `this.#bgm.m |
| 0x2bf | `registered-native` | 30 | P3/`missing-branch` | 引擎的越界分支会**报错**（`aSetdelaySound` 错误串 + `sub_4034C0`），emulator 的越界只在宿主 `#seChannel` 里记一条日志、不发任何意图；两边都不武装，但「引擎会弹错误」这一可观测串在 emulator 侧丢失。 |
| 0xc3 | `registered-native` | 28 | P3/`stale-ledger` | 实现注释与操作数计划的证据串把这条写成「`Music[259] = op1`」（附 `Engine[174713] = op1` 作为另一个动作），而体里**只有** `_this[174713] = result` 一条写；两处口径并存会被后人读成「引擎还写了 `Music[259]` 之外的字段 |
| 0xc6 | `registered-native` | 5 | P3/`approximation` | emulator 把 op2（音量值）**钳位后**写进配置（`AudioEngine.setVolume` 的 `clampVolume(value)`），而引擎 `sub_4071D0`/`sub_489B80`/`sub_4B68A0` 是**原值直用**：`sound:Volume0..4` |
| 0x302 | `registered-native` | 2 | P3/`missing-operand-io` | 0x302 的 `Engine[21318+ch] = 0x10000` 与 `Engine[21321+ch] = op2` 两处字段写在 emulator 全缺 ⇒ 与 0x2FF 一样，`[21321+ch]` 这个「本通道的因子」在 VM 字段面永远是 0，engineValues 无法复核 |
| 0xc4 | `registered-native` | 0 | P1/`missing-behavior` | 体开头对 `_this[21315]`/`_this[21318]` 的翻转（0x10000 已置 ⇒ 清 0；否则有 bit0 ⇒ 置 0x10000）没做：宿主侧 `voice-flag`/`voice-factor-prepare` 是**只增不减**的状态（`audioEngine.ts`  |
| 0x1bd | `registered-native` | 0 | P3/`missing-behavior` | 引擎在本 handler 里维护通道 0 的**状态位**（`_this[21315]` 条件清 0、`_this[21318]` 置 0 或 `| 0x10000`），emulator 的 `op_play_voice` 完全不写这两个字段（只有 `0x1BC`/`0x2F7`/`0x2FF`/` |
| 0x2c0 | `registered-native` | 0 | P1/`missing-operand-io` | 0x2C0/0x2F5 的 **op2 = 附带值** 在引擎里是**要消费的 pan**（起播时 `sub_4BB840` 的第 5 实参 = `Voice[5053+ch]`，而 `Voice[5053+ch]` 就是排入时写下的 op2）；emulator 的 handler 把它当 `aux |
| 0x131 | `registered-native` | 0 | P3/`missing-behavior` | 配置键 `message:MesWinAlpha` 缺失时（SYS4REG.INI 无 `[message]` 段、或根本没读到 INI ⇒ `e.config` 为空），0x131 用 `cfgInt(cfg, CFG.messageMesWinAlpha, 0)` 的回退 0 写给 op1；引擎 |
| 0x141 | `registered-native` | 0 | P3/`missing-behavior` | 越界（op1 无符号 > 0x10）时引擎会 `sub_408050(Engine+8, 1024, "GetMesWinAの引数が不正です．\r\n")` 再 `sub_4034D0` 把该串当消息派发（= 玩家可见的错误提示），emulator 只 `c.log(...)` 写宿主日志、**不产 |

★读法：`registered-*` 三类**不需要缺口登记**（实现/no-op 已在运行时表里，审计那条 finding 的"未登记"是台账覆盖口径问题，不是能力缺失）；
只有 `unregistered` 那一类要人过目 —— 它们要么该补实现，要么该按 `unimplemented`（语料 0 处、命中即硬报错）登记进缺口台账。

### §8.1 结论：§3 那批**没有"未注册 opcode"缺口**，但有**归属口径**问题

- **76/76 都在运行时三张表里**（`registered-implemented` 64 / `registered-native` 12；**0 个 `unregistered`**）
  ⇒ 「审计点名却不在缺口台账」**不是能力缺失**，而是台账覆盖口径：这些 opcode 的实现/no-op 已经落在 `OPS`/`NATIVE_OPS` 里，
  审计的 finding 讲的是**实现内部的缺分支/缺消费端**，与"opcode 没注册"是两回事。
- 原 80 个里的另外 **4 个**已由 `T-0179` 补进缺口台账（`0xa0` implemented、`0x8f` implemented、`0x8c` 部分关闭、`0x84` 早有条目）。
- ★但下面这批**要单独盯**：不在缺口台账、又有**实质性** finding（`missing-consumer/behavior/branch/operand-io`）的 opcode 共 **58 个**；
  其中 **37 个**在能力台账里有痕迹（handler/mnemonic/hex 至少出现一处），**21 个在六份真源里零痕迹**（见 §8.2）。
  ★口径提醒：**"零痕迹"是台账层面的可查性结论**，不等于"没人处置过" —— 它们的处置可能只写在某张票的 `changes-*.md`/`notes.md` 或代码注释里，
  而票面文档**不被任何机械检查覆盖** ⇒ 下一轮应对这 21 条做一次"读体现状 → 落台账（登记/关掉）"的收口。

---
### §8.2 ★★六份真源里**零痕迹**的 finding（opcode 不在缺口台账，且 handler/mnemonic/hex 都没出现在能力台账里）

条数：**21**（对照：同样不在缺口台账、但能力台账里提到过其 handler/mnemonic 的有 37 个 ⇒ 那些至少第二层有痕迹）

| opcode | 最严重 | 审计说 |
|---|---|---|
| 0x61 | P3/`missing-operand-io` | 引擎体对 op1 是“按操作数自身 tag 写”的 —— op1 为直接型（int/float/string）时它把地址写进同类型的**直接槽**、为指针型时写指针池条目；emulator 的 `setRefOperand` 只接受 6 种指针型，遇到直接型 op1 直接抛错 ⇒ 若脚本给 int 目标，引擎静默写入而 |
| 0x91 | P2/`missing-consumer` | `effect_flags |= 0x800000`（消息面显示态）在 emulator 里没有消费者：引擎侧该位的唯一读取端 `sub_4098E0`（raw 14055-14105）未实现——它按 `[174801] & 0x800000` 门控，左键走 `sub_404120`（取游标项 labelC **并把整 |
| 0x92 | P2/`missing-branch` | 显示分支末尾写长度槽 0（raw 29565，5 → 0）⇒ raw 20165 `ip += 4*0` 使 ip 停在本条（显示后挂起等 sub_4098E0 派发）；emulator 的 handler 正常返回、`interpreter.stepOnce` 默认 `curFrame.ip += 1` ⇒ 直接跑下 |
| 0xa2 | P3/`missing-operand-io` | op1 的**字符串型键**没被建模：引擎的键读法 `sub_41B640(_this, 1)` 对字符串族操作数直接返回池里的字符串（case 5/11 返回 `_this[95748]`/`[95791]` 槽、case 8/14 返回字符串指针所指、case 2 走立即串池）并原样当键；emulator 的操作数 |
| 0xa3 | P3/`missing-operand-io` | op1 的**字符串型键**未建模：引擎 `sub_41B640(_this, 1)` 对字符串族操作数返回池里的原串当键，emulator 的操作数计划把 op1 声明为 `int` ⇒ `plan.int(1)` 对字符串型走 `atoi`/空串退路，键与引擎不同 ⇒ 用字符串键登记过的项永远查不中；浮点型键更直接 |
| 0x239 | P3/`missing-branch` | 引擎的门是读**已存在元素**的 `flags` bit0（`if ((*(_BYTE *)result & 1) != 0)`）—— 一个 `flags = 0` 的既有项（例：早前 `set-draw-color-alpha`/`set-draw-pos` 建过但从未 `draw-texture`）同样会被跳过；e |
| 0x23d | P2/`missing-consumer` | 『释放 slot 42..999』整条能力缺失：引擎既析构影片对象（`_this+4*slot+378688`）又经 `sub_49E980` 解绑 Scene 的槽→imgid 记录并把槽对象析构，emulator 的宿主缝未实现 ⇒ 这些槽的绑定与纹理全部留存，后续引用它们的绘制项仍会贴出旧图。 |
| 0x245 | P2/`missing-branch` | 引擎有 `if ( _this[result + 94672] )` 门：该槽没有对象时**不读 op2、不做任何事**（返回值就是 op1）；emulator 无条件读 op2 并调用宿主缝 —— 对没有对象的槽也产生一次调用（在 DropRecorder 里留下丢弃记录）。 |
| 0x248 | P3/`missing-consumer` | 引擎全局 `dword_55052C`（默认 256，blit 分块/格宽除数）在 emulator 里没有消费者：写进 `engineValues[-248]` 后无人读 ⇒ 脚本改这个值不会让 emulator 的任何绘制/换算随之改变（真机的 blit 分块口径会变）。 |
| 0x259 | P3/`missing-consumer` | `Engine.texSlotFlags` 无消费者：handler 在 gfx-misc.ts:87 清它，但全仓没有读点（渲染、装配、快照、读档都不含它）；引擎侧这对标志位却会随存档快照持久化（raw 17474）并在装载路径按 flag_a==1 决定重建槽（raw 19877）⇒ emulator 里这次复位是 |
| 0x25c | P3/`missing-consumer` | `block224` 写完即弃：emulator 里没有任何排版/渲染代码读它（引擎那 13 dword 是文本项缓冲头，被绘制路径消费）。 |
| 0x2bf | P3/`missing-branch` | 引擎的越界分支会**报错**（`aSetdelaySound` 错误串 + `sub_4034C0`），emulator 的越界只在宿主 `#seChannel` 里记一条日志、不发任何意图；两边都不武装，但「引擎会弹错误」这一可观测串在 emulator 侧丢失。 |
| 0x2c0 | P1/`missing-operand-io` | 0x2C0/0x2F5 的 **op2 = 附带值** 在引擎里是**要消费的 pan**（起播时 `sub_4BB840` 的第 5 实参 = `Voice[5053+ch]`，而 `Voice[5053+ch]` 就是排入时写下的 op2）；emulator 的 handler 把它当 `aux` 传下去，宿主 ` |
| 0x2c7 | P3/`missing-branch` | 负起点的错误路径缺失：引擎只把 `v3 >= v13 || v4 <= 0` 判成空串（`v3` 是 signed），`v3 < 0` 且 `v4 > 0` 时会继续执行到 `sub_40C120`，那里的 `if ( v6 < a3 )` 是**无符号**比较 ⇒ 必然抛 `std::out_of_range`（引擎 |
| 0x2f7 | P3/`missing-operand-io` | 0x2F7 写 `Engine[21315+ch] = 1` 这一格在 emulator 不落地（只写宿主 `v.flag`）；0x1BC 清同族三格、0x2F7 置位这一半缺失，engineValues 里该槽永远看不到 0x2F7 的效果。 |
| 0x2ff | P2/`missing-operand-io` | 0x2FF 的两个引擎字段写（`Engine[21318+ch] = 1` 的「有因子值」位、`Engine[21321+ch] = op2` 的原始因子）emulator 全缺 ⇒ 同族的 0x302（读这两位决定是否把因子写进设备）与 0x2F4 一族（按 0x10000 位翻转）在 emulator 里都失去「预 |
| 0x32f | P3/`missing-consumer` | 灯光开关整条能力缺失：引擎写 `Scene[4*op1+54708] = 0`（灯光 enabled 位，设备重建时被读来回放 SetLight/LightEnable，raw 122112-122118）并下发设备 LightEnable；emulator 既不写这个标志位也没有宿主实现（gfx-misc.ts:32 |
| 0x340 | P3/`missing-consumer` | 渲染状态整条能力缺失：引擎把 op1 存进 `Scene[13948]` 并在设备重建时重放（raw 122124），emulator 既不写这个状态槽也没有宿主实现（gfx-misc.ts:98 的 `setRenderState?.()` 落在空处）⇒ 脚本设过的渲染状态 #22 在 emulator 完全不可见。 |
| 0x34a | P2/`missing-behavior` | 0x34a 改基础平移偏移后引擎会置 Scene+46508 脏位（`_this[11627] = 1`），emulator 的 l2dNodeBaseOffset 只改 baseOffset、不置 matrixDirty 也不通知宿主置脏 ⇒ 该指令单独发生时不保证重算/重画。 |
| 0x350 | P2/`missing-behavior` | 引擎 0x350 除复位队列外还清实例的 `+21/+22`（本帧已装载标志）与 `+20`（播放/循环位）；emulator 只把 `inst.current` 置 null，动作装载标志与播放位状态没有被清（子槽+动作记录上的循环位也没清）。 |
| 0x352 | P2/`missing-branch` | sub_478540/sub_478560 都以 `if (*(_DWORD*)_this)` 为门：实例（Live2D 槽）不存在时 0x352 是彻底的 no-op；emulator 用 ensureSlot 建出空槽并写入 pending 值 ⇒ 引擎里不存在的槽在 emulator 里被创建。 |
### §8.3 那 21 条的逐条现状（`T-0179` 的"读体现状 → 落台账"作业面）

判据：取该 opcode 的**最严重实质性 finding**，把它的 `emulator.file` + `emulator.quote` 拿去当前工作树里找：
`quote-still-there` = 审计当时看到的那段代码还在（复现点大概率还在）；`quote-gone` = 代码已改（多半已修）。

| opcode | 审计 | handler | 引文现状 | 审计文件 | 审计说 | 本轮处置 |
|---|---|---|---|---|---|---|
| 0x61 | P3/`missing-operand-io` | `sub_42CB00` | `quote-still-there` | `src/vm/operand.ts` | 引擎体对 op1 是“按操作数自身 tag 写”的 —— op1 为直接型（int/float/string）时它把地址写进同类型的**直接槽**、为指针型时写指针池条目；emulator 的 `setRefOperand` 只接受 6 种 | 读体裁决：引擎按 tag 分派写「同类型直接槽」，emulator 无平坦地址可表达 ⇒ **不假实现**，台账落 `partial` + 1 条 `missing`（分叉 + 重开条件）；`opcode-operands.test.ts` 的 `EXPECTED_THROW` 理由已按体改写 |
| 0x82 | P2/`missing-branch` | `sub_41F720` | `quote-still-there` | `src/vm/handlers/msgwin.ts` | `op3 & 0x40`（bit6）会把起始记录下标整体后移窗的 `+132`（行游标）：引擎 `if ( (a4 & 0x40) != 0 ) v155 = *(_DWORD *)(v44 + 132) + v45;`；emulator  | （现已在缺口台账） |
| 0x91 | P2/`missing-consumer` | `sub_420740` | `quote-still-there` | `src/vm/handlers/panel.ts` | `effect_flags |= 0x800000`（消息面显示态）在 emulator 里没有消费者：引擎侧该位的唯一读取端 `sub_4098E0`（raw 14055-14105）未实现——它按 `[174801] & 0x80000 | 已按体实现 ⇒ 台账落 `implemented`（`T-0158` 修，本轮复核：`test/panel-display-state.test.ts` 6 例） |
| 0x92 | P2/`missing-branch` | `sub_4207D0` | `quote-still-there` | `src/vm/interpreter.ts` | 显示分支末尾写长度槽 0（raw 29565，5 → 0）⇒ raw 20165 `ip += 4*0` 使 ip 停在本条（显示后挂起等 sub_4098E0 派发）；emulator 的 handler 正常返回、`interprete | 已按体实现 ⇒ 台账落 `implemented`（`T-0158` 修：长度槽 5→0 + `fallbackLabel` 真读者） |
| 0xa2 | P3/`missing-operand-io` | `sub_434F10` | `quote-gone` | `src/vm/handlers/menu.ts` | op1 的**字符串型键**没被建模：引擎的键读法 `sub_41B640(_this, 1)` 对字符串族操作数直接返回池里的字符串（case 5/11 返回 `_this[95748]`/`[95791]` 槽、case 8/14 返回 | 字符串族键已按体实现（`keyOf` 走 `readStringOperand`，守卫 `test/menu-string-key.test.ts`）⇒ 台账落 `partial` + 1 条 `missing`（只剩**数值族键的全角化口径**，统一留给 `operand.ts` 的 owner / `T-0165`） |
| 0xa3 | P3/`missing-operand-io` | `sub_429830` | `quote-gone` | `src/vm/handlers/menu.ts` | op1 的**字符串型键**未建模：引擎 `sub_41B640(_this, 1)` 对字符串族操作数返回池里的原串当键，emulator 的操作数计划把 op1 声明为 `int` ⇒ `plan.int(1)` 对字符串型走 `ato | **本轮实现**：派发目标改两级解析（`branchTarget` = `labelMap` → `dwordToInstr`），只有两级都查不到才抛（引擎 raw 35752/35754 无条件野跳）；守卫 `test/menu-dispatch-target.test.ts`（3 例，摘掉回落 ⇒ 2/3 红）。台账落 `partial` + 1 条 `missing`（数值族键全角化口径，同 `0xa2`） |
| 0xae | P2/`missing-branch` | `sub_4192F0` | `quote-gone` | `src/vm/handlers/frame.ts` | 引擎在 sv1=1 分支里要求第二次 GetConfig 的结果**恰为 20**（`if (v3 != 1)` 之外的 `if (result == 20)`），并使用 `263*cur` 步长的槽组（`130199`/`130198`、 | （现已在缺口台账） |
| 0xb4 | P2/`missing-branch` | `sub_420B00` | `quote-still-there` | `src/audio/audioEngine.ts` | 引擎的 SE 通道上限是 **0..14**（`if ( a2 > 0xE )` 才报错误串），emulator 的宿主只建 10 条 SE 通道（`SE_CHANNELS = 10`），通道 10..14 的 `se-load`/`se- | （现已在缺口台账） |
| 0xb5 | P2/`missing-branch` | `sub_420B40` | `quote-still-there` | `src/audio/audioEngine.ts` | 同 0xB4：引擎 `sub_4B6020` 的通道值域判定是 `a2 > 0xE`（0..14 全合法），emulator 宿主只有 10 条 SE 通道 ⇒ 0xB5/0xBA 对通道 10..14 静默丢弃（引擎此时会正常起播）。 | （现已在缺口台账） |
| 0xbc | P1/`missing-branch` | `sub_420DC0` | `quote-gone` | `src/vm/handlers/audio.ts` | 缺 `sub_408CF0` 的「无需改动 ⇒ 整条早退」分支（raw 13523-13541 的 `if (a2) {...} else if (v3 >= 0) {...}` 结构）：引擎在 `a2 != 0 && sound:Musi | （现已在缺口台账） |
| 0xc2 | P2/`missing-branch` | `sub_420E00` | `quote-gone` | `src/vm/handlers/audio.ts` | 非 ADV 路径里 `effect_flags & 0x200` 置位时的 `set:TransferMusicVolume` 分支（`sub_418580`：1 = 按淡变进度把当前音量插值到目标、2 = 直接跳到目标）完全未建模，节流值 | （现已在缺口台账） |
| 0x10c | P2/`missing-consumer` | `sub_4220B0` | `quote-gone` | `src/vm/input.ts` | 引擎侧消费者（每帧 `sub_4770A0` 用 `Input[1176+VK]` 当位号并进掩码）在 emulator 里被替换成**冻结常量** `DEFAULT_VK_TO_BIT` + `pressKey`：脚本无法经 0x10c  | （现已在缺口台账） |
| 0x142 | P3/`missing-consumer` | `sub_422930` | `quote-still-there` | `src/vm/handlers/engine-fields.ts` | 引擎把 `_this[174812]` 导出成查询口 `sub_4765C0(){ return _this[699248] != 0; }`（脚本/宿主可读回该开关），emulator 的 `ENGINE_FIELD.scriptEngi | （现已在缺口台账） |
| 0x193 | P1/`missing-operand-io` | `sub_433710` | `quote-still-there` | `src/vm/handlers/strings.ts` | 第 2/3 格操作数的**指针解引用与整数/浮点转串**能力缺失：引擎 `sub_42A420` 对 `local-ptr`/`global-ptr` 族取**所指处的值**再转换（int ⇒ `_itoa_s` 十进制、float ⇒ ` | （现已在缺口台账） |
| 0x1b2 | P2/`missing-operand-io` | `sub_42A9B0` | `quote-still-there` | `src/vm/operand.ts` | 第 1 格的**整数转串**能力缺失：引擎 `sub_41B9B0(_this, 1)` 按 tag 分派并对 int 族走 `_itoa_s(值, …, 10)`（把槽里的**值**转十进制串）再追加进文本缓冲；emulator 的 `r | （现已在缺口台账） |
| 0x1ba | P2/`missing-consumer` | `sub_421200` | `quote-gone` | `src/vm/handlers/audio.ts` | 四条分支末尾（以及 `0xBB`/`0xBC`）都会调 `sub_406DF0(Engine, 类别, a2)` 把该类声音的开关下发给正在播放的影片播放器音轨；emulator 的 `switchMovieEnable` 只写配置 + 打 | （现已在缺口台账） |
| 0x1fa | P2/`missing-operand-io` | `sub_422E00` | `quote-gone` | `src/vm/handlers/gfx-texture.ts` | 引擎 release-texture 经 sub_49E980 把槽→imgid 记录写成 **−1**（`Scene[5*slot+466] = -1`，0x216 读的就是这一格）；emulator 的 op_release_textu | （现已在缺口台账） |
| 0x201 | P2/`missing-behavior` | `sub_4302B0` | `quote-still-there` | `src/vm/handlers/engine-fields.ts` | 0x201 读的 `_this[166964]`（DrawMode）在 emulator 里无写入者：配置 `set:DrawMode` 未绑到该字段、引擎中唯一的脚本写入端 0x200（`sub_423170`）未实现 ⇒ 无论 INI  | （现已在缺口台账） |
| 0x20b | P3/`missing-branch` | `sub_423690` | `quote-gone` | `src/renderer/pixi/textureCache.ts` | sub_4A4C70 会先把矩形夹到表面记录 `v7[263..266]` 的边界（左/上取 max、右/下取 min），夹完为空（`*v5 >= v5[2]` / `v5[1] >= v5[3]`）就直接返回不画；emulator 把 x | （现已在缺口台账） |
| 0x20f | P2/`missing-operand-io` | `sub_4237B0` | `quote-gone` | `src/vm/handlers/gfx-misc.ts` | 引擎在每条 play-movie 上建/复用影片对象、解槽纹理并把 `_this[699204] |= 0x2000`（影片播放位）与 `_this[675972] = 1`（影片刷新位）置起；emulator 只转发给一个「只打日志」的宿 | （现已在缺口台账） |
| 0x21d | P2/`missing-branch` | `sub_423C60` | `quote-still-there` | `src/renderer/pixiBackend.ts` | CopyScene 的网格顶点缓冲失败两条错误路径未建模：引擎在「源网格命中」后还有顶点缓冲创建失败与加锁失败两个 `return 0` 分支（各自打一条独立错误串），emulator 的 `copyScene` 只有布尔 `copied` | （现已在缺口台账） |
| 0x239 | P3/`missing-branch` | `sub_424900` | `quote-still-there` | `src/renderer/scene/ops.ts` | 引擎的门是读**已存在元素**的 `flags` bit0（`if ((*(_BYTE *)result & 1) != 0)`）—— 一个 `flags = 0` 的既有项（例：早前 `set-draw-color-alpha`/`set | 已按体实现 ⇒ `implemented`：门是 `flags & 1`（`scSetFlipbook`，`src/renderer/scene/ops.ts`），不是审计说的 `created` 近似；守卫 `test/anim-window-done.test.ts` |
| 0x23d | P2/`missing-consumer` | `sub_41A300` | `quote-still-there` | `src/vm/handlers/gfx-misc.ts` | 『释放 slot 42..999』整条能力缺失：引擎既析构影片对象（`_this+4*slot+378688`）又经 `sub_49E980` 解绑 Scene 的槽→imgid 记录并把槽对象析构，emulator 的宿主缝未实现 ⇒ 这 | 已按体实现 ⇒ 台账落 `implemented`（`T-0164`：两个宿主真析构 + VM 下发缝，`test/t0164-misc-batch.test.ts` 3 例） |
| 0x23f | P2/`missing-consumer` | `sub_4307B0` | `quote-gone` | `src/renderer/pixiBackend.ts` | 引擎 0x23F 读的对象由 0x236（sub_4246B0）与 0x20F play-movie（sub_4237B0）惰性创建（`Engine[slot + 94672]`，raw 32245-32252 / 31627-31638） | （现已在缺口台账） |
| 0x245 | P2/`missing-branch` | `sub_4251E0` | `quote-still-there` | `src/vm/handlers/gfx-texture.ts` | 引擎有 `if ( _this[result + 94672] )` 门：该槽没有对象时**不读 op2、不做任何事**（返回值就是 op1）；emulator 无条件读 op2 并调用宿主缝 —— 对没有对象的槽也产生一次调用（在 Dro | （现已在缺口台账） |
| 0x246 | P2/`missing-branch` | `sub_425250` | `quote-still-there` | `src/vm/handlers/gfx-texture.ts` | 引擎有两道门：`if ( _this[result + 94672] )`（该槽没有对象 ⇒ 不读 op2、不调用）与 `if ( *(_DWORD *)(v4 + 1084) == dword_52839C )`（对象类型标记不符 ⇒ 不 | （现已在缺口台账） |
| 0x248 | P3/`missing-consumer` | `sub_4252E0` | `quote-still-there` | `src/vm/handlers/gfx-misc.ts` | 引擎全局 `dword_55052C`（默认 256，blit 分块/格宽除数）在 emulator 里没有消费者：写进 `engineValues[-248]` 后无人读 ⇒ 脚本改这个值不会让 emulator 的任何绘制/换算随之改变 | 写侧在（`engineValues[-248]`）**消费端仍缺** ⇒ 台账落 `partial` + 1 条 `missing`（分块 blit：引擎 raw 45886-45899 按该全局切格逐格搬运；emulator 走单次缩放 blit）。语料 1 处（`SYSTEM4.txt:112` 的 `i248 80`） |
| 0x249 | P2/`missing-consumer` | `sub_425310` | `quote-gone` | `src/vm/handlers/gfx-texture.ts` | op3（颜色）在引擎里被真正消费（进表面对象 vtable+28 的装载调用 raw 119762-119766，并写 `Scene[5*slot+467]`）；emulator 交给 `native.setTextureObjectPar | （现已在缺口台账） |
| 0x259 | P3/`missing-consumer` | `sub_41A3A0` | `quote-still-there` | `src/vm/handlers/gfx-misc.ts` | `Engine.texSlotFlags` 无消费者：handler 在 gfx-misc.ts:87 清它，但全仓没有读点（渲染、装配、快照、读档都不含它）；引擎侧这对标志位却会随存档快照持久化（raw 17474）并在装载路径按 fla | 清标志的写侧在，**读者仍缺** ⇒ 台账落 `partial` + 1 条 `missing`（每槽两位的**存档快照持久化 + 装载重建**：raw 17474 / 19875-19878）。语料 517 处、当前无可见症状 |
| 0x25c | P3/`missing-consumer` | `sub_425E70` | `quote-still-there` | `src/vm/handlers/msgwin.ts` | `block224` 写完即弃：emulator 里没有任何排版/渲染代码读它（引擎那 13 dword 是文本项缓冲头，被绘制路径消费）。 | `o.block224` 已按体记录（13 dword），**排版/绘制消费端仍缺** ⇒ 台账落 `partial` + 1 条 `missing`（引擎那 13 dword 是文本项缓冲头）。语料 **0 处** |
| 0x2bf | P3/`missing-branch` | `sub_4262C0` | `quote-still-there` | `src/audio/audioEngine.ts` | 引擎的越界分支会**报错**（`aSetdelaySound` 错误串 + `sub_4034C0`），emulator 的越界只在宿主 `#seChannel` 里记一条日志、不发任何意图；两边都不武装，但「引擎会弹错误」这一可观测串在  | 读体裁决为 **`deferred`**：引擎越界支只把 `aSetdelaySound` 串送进**日志汇**（`sub_4B5170` raw 137725-137739 → `sub_4034C0` raw 9427 = `sub_497620` 的 WriteFile 日志），不改状态、不弹玩家可见消息；宿主 `#seChannel` 已按同界（0..9）记日志 ⇒ 只剩文案差异（`why` 里写了重开条件） |
| 0x2c0 | P1/`missing-operand-io` | `sub_426310` | `quote-gone` | `src/audio/audioEngine.ts` | 0x2C0/0x2F5 的 **op2 = 附带值** 在引擎里是**要消费的 pan**（起播时 `sub_4BB840` 的第 5 实参 = `Voice[5053+ch]`，而 `Voice[5053+ch]` 就是排入时写下的 op | 已有据推翻 ⇒ `implemented`（`T-0152`）：op2 的 **bit0 是循环位**、pan 走 `0x2F8`，不是同一格；守卫 `test/audio-engine.test.ts` |
| 0x2c7 | P3/`missing-branch` | `sub_433FD0` | `quote-gone` | `src/text/sjis.ts` | 负起点的错误路径缺失：引擎只把 `v3 >= v13 || v4 <= 0` 判成空串（`v3` 是 signed），`v3 < 0` 且 `v4 > 0` 时会继续执行到 `sub_40C120`，那里的 `if ( v6 < a3 )` | 已按体实现 ⇒ `implemented`（`T-0151`）：`start < 0 && len > 0` 抛 `SjisSubstrOutOfRangeError`（引擎 `std::out_of_range`），非负越界仍写空串；守卫 `test/text-sjis-limits.test.ts` |
| 0x2c8 | P3/`missing-branch` | `sub_434260` | `quote-still-there` | `src/text/sjis.ts` | op2 的 **255 字节截断**这一支缺失：引擎先 `strcpy_s(Destination, 0x100u, v3)` 把 op2 拷进 256 字节栈缓冲（含结尾 0），随后的 `_mbstrlen(v4)` 与逐字节循环都只看* | （现已在缺口台账） |
| 0x2e9 | P2/`missing-consumer` | `sub_426620` | `quote-still-there` | `src/vm/handlers/engine-fields.ts` | `_this[122464]`（ADV 自动翻页行基准）在 emulator 里只被写、无任何读者：引擎按「(当前窗行数 − 1 − 基准) × message:AutoMessageSpeed + message:AutoMessageM | （现已在缺口台账） |
| 0x2f5 | P1/`missing-operand-io` | `sub_4267D0` | `quote-still-there` | `src/vm/handlers/audio.ts` | 0x2F5 的 **op2** 是引擎起播时消费的 pan（`sub_4BB840` 第 5 实参 = `Voice[5053+op4]` = 排入时写的 op2），emulator 传成 `aux` 后被宿主 `voiceQueue` 丢 | （现已在缺口台账） |
| 0x2f6 | P3/`missing-operand-io` | `sub_426820` | `quote-gone` | `src/vm/handlers/audio.ts` | 0x2F6 的引擎字段回写全缺：`Engine[21315+ch]=0`、`[21318+ch]=0`、`[122505+ch]=0`、`[122508+ch]=0` 与 `[122501] = 三路语音是否有正忙的` 在 emulator | （现已在缺口台账） |
| 0x2f7 | P3/`missing-operand-io` | `sub_426890` | `quote-gone` | `src/vm/handlers/audio.ts` | 0x2F7 写 `Engine[21315+ch] = 1` 这一格在 emulator 不落地（只写宿主 `v.flag`）；0x1BC 清同族三格、0x2F7 置位这一半缺失，engineValues 里该槽永远看不到 0x2F7 的效 | 已按体实现 ⇒ `implemented`（`T-0152`）：真的落 `engineValues[21315+ch] = 1` 再发宿主意图；守卫 `test/audio-opcodes.test.ts` / `test/t0152-audio-p2.test.ts` |
| 0x2f8 | P3/`missing-branch` | `sub_4268D0` | `quote-gone` | `src/audio/audioEngine.ts` | 引擎的通道上界是「设备通道号 < 15」（即语音通道 ch ≤ 2 之外还覆盖 3..14 的直通通道），emulator 的 `#voiceChannel` 只认 0..2 ⇒ ch=3..14 时引擎会写 `Sound[ch+375]` | （现已在缺口台账） |
| 0x2ff | P2/`missing-operand-io` | `sub_426940` | `quote-gone` | `src/vm/handlers/audio.ts` | 0x2FF 的两个引擎字段写（`Engine[21318+ch] = 1` 的「有因子值」位、`Engine[21321+ch] = op2` 的原始因子）emulator 全缺 ⇒ 同族的 0x302（读这两位决定是否把因子写进设备）与  | 已按体实现 ⇒ `implemented`（`T-0152`）：`[21318+ch] = 1` + `[21321+ch] = op2`（原值直写）已落盘；守卫 `test/audio-opcodes.test.ts` / `test/audio-engine.test.ts` |
| 0x308 | P2/`missing-behavior` | `sub_426B20` | `quote-gone` | `src/vm/handlers/stubs.ts` | 0x308 的宿主副作用完全没有实现：既不 `LoadLibraryA`+`GetProcAddress` 调注册/注销触摸的导出，也不按门 `op1 || (GetConfig("system:limitTouch") & 1)` 选择注 | （现已在缺口台账） |
| 0x30a | P3/`missing-branch` | `sub_426B60` | `quote-still-there` | `src/vm/handlers/stubs.ts` | `op1 > 0x1F || op2 > 7`（unsigned）时引擎抛 `SetGesKeyの引数が不正です．` 且**不写表**；emulator 的 no-op 静默接受任意实参（包括 op2 < 0 / op2 > 7 这种引擎会 | （现已在缺口台账） |
| 0x32c | P3/`missing-branch` | `sub_426FC0` | `quote-gone` | `app/amayui-emulator/src/vm/handlers/stubs.ts` | 体是**二段式**：视图矩阵初始化 + `D3DXMatrixLookAtLH` + 设备 vtable+176(SetTransform) **无条件**执行；只有「把视图/投影/世界三矩阵转发给 Effect3D 管理器」那一段被 `i | （现已在缺口台账） |
| 0x32e | P3/`missing-branch` | `sub_427110` | `quote-gone` | `app/amayui-emulator/src/vm/handlers/stubs.ts` | op9（α）是**钳位饱和**而非报错：`if ( v2 > 255 ) v2 = 255;` 之后才拼 ARGB —— 即 α>255 静默降到 255（与 0x32D 的 α<0 回退、>255 钳位是同族三态）；no-op 后钳位行为 | （现已在缺口台账） |
| 0x32f | P3/`missing-consumer` | `sub_4272B0` | `quote-still-there` | `src/vm/handlers/gfx-misc.ts` | 灯光开关整条能力缺失：引擎写 `Scene[4*op1+54708] = 0`（灯光 enabled 位，设备重建时被读来回放 SetLight/LightEnable，raw 122112-122118）并下发设备 LightEnable | 读体裁决为 **`deferred`**：`sub_49A150`（raw 116741-116748）的两行只有「写 `Scene[13677+idx]=0` 的 enabled 位」+「设备 `LightEnable(FALSE)`」，而该位/设备的唯一读者是 D3D 重放（raw 122110-122122）⇒ 写字段面只会造成"写了没人读"的假象；`setLight?.()` 是 `nativeTap.ts` 清单里**有 why 的已登记不实现缝**（`0x32E` 的开灯也走同一缝） |
| 0x33f | P2/`missing-operand-io` | `sub_427A90` | `quote-gone` | `src/vm/handlers/gfx-state.ts` | op2（α）与 op3（颜色）两格引擎都读并写进 `Scene+1264`，emulator 只读 op1、op2/op3 完全没读（`plan` 里也没声明），两格的下发能力整体缺失。 | （现已在缺口台账） |
| 0x340 | P3/`missing-consumer` | `sub_427B60` | `quote-still-there` | `src/vm/handlers/gfx-misc.ts` | 渲染状态整条能力缺失：引擎把 op1 存进 `Scene[13948]` 并在设备重建时重放（raw 122124），emulator 既不写这个状态槽也没有宿主实现（gfx-misc.ts:98 的 `setRenderState?.() | 读体裁决为 **`deferred`**：`sub_49A2D0`（raw 116869-116876）写 `Scene[13948]` + `SetRenderState(22, op1)`，重放只在**设备重建**路径（raw 122124）而 emulator 没有该路径；语料 **0 处**（`i340` 全库无命中） |
| 0x34a | P2/`missing-behavior` | `sub_427FB0` | `quote-still-there` | `src/live2d/runtime.ts` | 0x34a 改基础平移偏移后引擎会置 Scene+46508 脏位（`_this[11627] = 1`），emulator 的 l2dNodeBaseOffset 只改 baseOffset、不置 matrixDirty 也不通知宿主置脏 | 已按体实现 ⇒ `implemented`：`l2dNodeBaseOffset` 调 `markSceneDirty`（raw 134138 的 `_this[11627] = 1`，且不置 `+76`）；守卫 `test/l2d-node-compose.test.ts` |
| 0x34f | P2/`missing-behavior` | `sub_428400` | `quote-gone` | `src/live2d/runtime.ts` | 引擎把 op2（或负值时查到的纹理色记录）当打包字节解码成三个 0..1 的乘色分量并逐部件下发（sub_478590 → sub_4BD150）；emulator 只把原始 int 存进 `textures` 表的 -1 号键，既不解码也 | （现已在缺口台账） |
| 0x350 | P2/`missing-behavior` | `sub_4282E0` | `quote-gone` | `src/live2d/mtn.ts` | 引擎 0x350 除复位队列外还清实例的 `+21/+22`（本帧已装载标志）与 `+20`（播放/循环位）；emulator 只把 `inst.current` 置 null，动作装载标志与播放位状态没有被清（子槽+动作记录上的循环位也没 | 已按体实现 ⇒ `implemented`（`T-0160`）：`resetMotionQueue` 门 = 模型非空，清字节 20/21-22（动作记录的循环位**不清**）；守卫 `test/live2d-t0160.test.ts` |
| 0x352 | P2/`missing-branch` | `sub_4283B0` | `quote-gone` | `src/live2d/runtime.ts` | sub_478540/sub_478560 都以 `if (*(_DWORD*)_this)` 为门：实例（Live2D 槽）不存在时 0x352 是彻底的 no-op；emulator 用 ensureSlot 建出空槽并写入 pendi | 已按体实现 ⇒ `implemented`（`T-0160`）：`l2dSetPending` 门 = 槽里有模型（不再 `ensureSlot` 凭空建槽）；守卫 `test/live2d-t0160.test.ts` |

★读法：quote-still-there 那一批是下一轮的作业面；quote-gone 的多半已被 A–F 波顺手修掉（读代码确认后按「关掉」处理）。

★**§8.3 表外补充（2026-09-25 / `T-0179` 第 48 轮）**：`0x94` 不在 §8.2 的 21 条零痕迹名单里（它在 §8 的
`registered-implemented` 表内），但它的第二条 finding 是真缺口，本轮已实现并按体落台账：

- ① `sub_404020` 的首次命中测试**无条件**（无光标也做 ⇒ 游标落 -1）：`T-0158` 已修，守卫
  `test/panel-display-state.test.ts` 的「`0x94` 无条件命中测试」一例。
- ② WM_MOUSEMOVE 的命中测试**有门**：引擎 raw 140827 `if ( _this[12958] || _this[12957] )`，面板基址
  `Engine+5494`（dword）⇒ `12958 = 5494 + 7464`（`fillPending`）、`12957 = 5494 + 7463`（`shown`）。
  修前 `Engine` 构造里的 `onCursorMove` 无条件 `routes.hitTest(x, y)` ⇒ 关闭期（两格皆 0）一移鼠标就
  重算游标。**本轮实现**：钩子按同一道门放行（`src/vm/engine.ts`），并订正 `src/vm/input.ts` 的过时注释
  （旧注把门写成 `panelA[7463] || panelA[7462]` —— 第二格差 2，`12958 - 5494 = 7464` 不是 `[7462]`）；
  `fillPending` 因此拿到它在本仓的第一个读者（审计原话：只写不读的死写）。守卫
  `test/panel-cursor-move-gate.test.ts`（4 例；摘掉门 ⇒ **2/4**，恢复 ⇒ 4/4）。台账：新增
  `0x94 = implemented`（条目 note 同时记两条 finding 与审计对 ② 的可观测性备注）。
- ★★**门的左半不是恒假项**（读体反证 ⇒ `impl-audit` 行 218 的相反自述作废）：`sub_404020(int _this, …)`
  收的是**面板指针**、体内一律用**字节**偏移 —— `*(_DWORD *)(_this + 29856) = 1`（raw 10019/10028）
  ⇒ `29856/4 = 7464` ⇒ `Engine[5494+7464] = Engine[12958]`；同函数 raw 10016 的门
  `*(_DWORD *)(_this + 29860)` = `[7465]`（`hitDone`）、raw 10018/10027 的 `_this + 3840` = `[960]`
  也都对得上 ⇒ 面板每次显示都把 `[7464]` 置 1。

★**第 49 轮补充（2026-09-25 / `T-0179`）**：§8.3 的 16 条待裁项里，本轮读完体/代码后裁决 **10 条**（上表的
`0x239`/`0x2c0`/`0x2c7`/`0x2f7`/`0x2ff`/`0x350`/`0x352`/`0x34a` 落 `implemented`，`0xa2`/`0xa3` 落 `partial`），
其中只有 `0xa3` 那条**真的还缺**（派发目标的静默回落）⇒ 本轮实现；其余 9 条都是「A–F 波已修好、只是没人回台」。
剩余 **6 条**仍是 §8.3 的作业面：`0x248`（全局 blit 除数无消费者）、`0x259`（`texSlotFlags` 无读者）、
`0x25c`（`block224` 写完即弃）、`0x2bf`（越界 SE 通道缺引擎错误串）、`0x32f`（灯光开关）、`0x340`（渲染状态）。

★★**§8.3 收口完毕（2026-09-25 / `T-0179` 第 50 轮）**：§8.2 的 21 条零痕迹项**全部读完体并落台账**：

- `implemented` **12 条**：`0x91` `0x92` `0x94` `0x23d` `0x239` `0x2c0` `0x2c7` `0x2f7` `0x2ff` `0x350` `0x352` `0x34a`
  （都是「A–F 波已修好、只是没人回台」；`T-0158`/`T-0160`/`T-0151`/`T-0152`/`T-0164` 是主要修复票）；
- `partial` + `missing` **6 条**：`0x61`（无平坦地址可表达）、`0xa2`/`0xa3`（数值族键的全角化口径）、
  `0x248`（分块 blit 消费端）、`0x259`（标志位的存档持久化/装载重建）、`0x25c`（`block224` 的排版消费端）；
- `deferred` **3 条**：`0x2bf`（引擎只记日志）、`0x32f`（灯光 enabled 位/设备重放）、`0x340`（设备渲染状态 + 语料 0 处）。

★**本轮真的只缺两条真缺口**：第 49 轮的 `0xa3` 派发目标（已实现）与其余 15 条的"回台登记"。⇒ §8.3 这条尾巴关闭；
`T-0148` 的剩余面收敛为 ② §4/§5 的 23 条 `still-present` 与 ③ `T-0179` 名下 144 条 `missing` 的逐条裁决。

---

## §5.3 §5.2 `still-present` 的裁决批（第 51 轮，2026-09-25 / `T-0179`）

§8.3 关掉之后作业面转到 §5.2 那张机械化复核表的 `still-present` 半边。本轮裁决 3 条：

| §5.2 项 | 裁决 | 依据（读体 + 读当前代码） |
|---|---|---|
| `0x108`（P3 `host-invented`） | **保留补丁，落 `partial` + 1 `missing`** | ★**推翻了审计的结论方向**：`sub_477220`（raw 91626-91642）确实**没有**保持位（每次都从调用方清零的局部量重算 `GetAsyncKeyState(1)`/`(2)`），但 emulator 的 `pressLatch` 是**有据且必需**的保真性补丁 —— 宿主把 down/up 作为**批量事件**投进 VM（一次 VM 批可达上万条指令），摘掉它会让「down+up 落在同一次轮询之间」的快速点击**整次丢失**（`test/title-exit.test.ts` 的快速点击 E3 用例正是用户实测的回归）。真机的保证来自消息循环 + 高频轮询；其「挂起位 → 消费刷」等价物 emulator 只建在**掩码路径**（`flushPending`/`flushHeld`）上，没给 `0x108` 这条直读路径建。`missing[]` 写清披露口径与两条重开条件 |
| `0x223`（P2 `missing-behavior`，语料 **178 处**） | **改判 `partial` + 1 `missing`** | ★**台账自相矛盾的订正**：该条 note 末尾早就写着「★部分：惰性建纹理与渲染侧消费端仍未建模（记在本票）」+「★T-0149：本条的处置 = partial … 逐条见 `missing[]`」，但字段面仍是 `disposition = implemented`、`missing[]` 为空（机械检查只校验"partial 必须带 missing"，不校验 note 的自述 ⇒ 正是审计抱怨的"描述过期"那一类）。读体（`sub_4ADDB0` raw 132591-132625）确认：写记录**前**要先按 per-slot 渲染层表 `Scene[槽号+10614]` 现建/重绑一层（`sub_4A2C10`），emulator 的 `scTransitionSet` 只写记录 ⇒ 从未被画过的槽做交叉淡化时**缺一层离屏层**。依赖 `T-0091` 的渲染层家族 |
| `0x25a`（P3 `missing-consumer`） | 无需新登记 | 该条**早已**在缺口台账里（`T-0161` 登记，`partial` + 1 `missing` 正是那两条媒体下发门）⇒ §5.2 表里那句"现已在缺口台账"是对的，本轮复核后确认不必动 |

⇒ `T-0179` 的 `missing` 数：144 → **146**（`0x108` + `0x223` 各 1 条）；缺口台账 **181** 条（partial 92 / implemented 53 / deferred 22）。

---

## §5.4 §5.2 `still-present` 半边的收口（第 70 轮，2026-09-25 / `T-0179`）

§5.2 那张表共 36 条（`still-present` 23 + `quote-gone` 13）。**`still-present` 半边本轮裁决完毕**：
3 条已在 §5.3 裁定（`0x108` / `0x223` / `0x25a`）+ 10 条带 opcode 的由 `T-0179` 的缺口台账逐条承接（`0x248`/`0x32f`/`0x340`/`0x245`/`0x246`/`0x61`/`0x192`/`0x193`/`0x1b2`/`0xa0`）+ **opcode 栏为 `—` 的 10 条本轮逐条裁决**。

### §5.4.1 opcode 栏为 `—` 的 10 条：7 条可关 + 2 条改台账后可关 + 1 条转 `opcode-gaps`

★**方法论（本轮最值钱的一句）**：§5.2 的 `quote-still-there` 只说明"**审计当时引的代码还在**"，
**不说明"缺口还在"** —— 这 10 条里 **9 条是"审计快照过期"**（代码与台账早已被 §5.3 之后的
`T-0154`/`T-0163`/`T-0164`/`T-0166`/`T-0167` 改到位），只有 1 条需要动台账。

| # | kind | file | 裁决 | 落点 |
|---|---|---|---|---|
| 1 | `approximation` | `src/renderer/scene/state.ts` | **③ 可关** | 能力条 `scene-layer-xform-compose-20-29` 明写"只建模 [20,30) 支、非该区间未实现"；装置登记在 `opcode-gaps` 的 `0x22a`/`0x22c`/`0x22d`/`0x22f`（`missing`，承接 `T-0179`） |
| 2 | `stale-ledger` | `test/mesh-vertex-quad.test.ts` | **③ 可关** | `lazy-mesh-map-node` = `modeled-verified`/`E2`，`guard` 已非空且指向真实用例（`test/blend-mode.test.ts#0x322 的 op2 必须落进 MeshObj.blend`）；note 已逐字复述并订正审计 |
| 3 | `stale-ledger` | `test/op-327-32e-setweather-noop.test.ts` | **③ 可关** | `scene-3d-weather-effects-rain-snow-leaf`：`guard` 已非"（无）"；`src/vm/handlers/stubs.ts` 的"根本没注册"陈旧注释**已删**且与 `ENGINE_INTERNAL_OPS` 注册一致 |
| 4 | `stale-ledger` | `src/renderer/scene/ops.ts` | **③ 可关** | `scene-flag-46528-bits` = `modeled-verified`/`E2` + guard；`trigger` 的极性已更正（bit2 置位 = 忽略冻结） |
| 5 | `approximation` | `src/renderer/scene/ops.ts` | **③ 可关**（代码 + **审计建议的守卫用例**都已存在） | `bullet-dirty-from-freeze-or-pending`：`ops.ts` 的 freeze 分支**第一句就无条件 `s.dirty = true`**（逐字引 raw 136718-136719）；守卫 `test/scene-t0154-scene-state.test.ts:188`（"场景里没有可冻结窗时也要置脏"）就是审计要的那条 |
| 6 | `missing-behavior` | `src/vm/handlers/msgwin.ts` | **③ 可关** | 由**新条目** `msgwin-coexist-auto-message`（`partial`/`E2`，守卫 `test/adv-msgwin.test.ts` 4+1 例）整体承接 `0x72` 尾段的自动放行分支 |
| 7 | `missing-consumer` | `src/vm/handlers/msgwin.ts` | **② 改台账后可关** | `msgwin-config-gates`：5 个键全有读者；note 里"见 `T-0166`"那半句**本轮补成结论** |
| 8 | `stale-ledger` | `src/text/layout.ts` | **② 改台账后可关** | `text-layout-wrap-ruby`：**删掉 vestigial 顶层 `note`（数组）** + 例数 `13 → 实测 18` |
| 9 | `stale-ledger` | `src/vm/handlers/msgwin.ts` | **③ 可关** | `text-font-rebuild-cascade` 已换标识符锚 + `#用例名锚` 棘轮；note 里的行号漂移**本轮改为不写行号** |
| 10 | `missing-behavior` | `src/renderer/pixiBackend.ts` | **② 改台账后可关** | **`lazy-movie-texture-slot` 描述过期**：`absent`/`E1`/无守卫 ⇒ `partial`/`E2` + 守卫；真缺口与 `opcode-gaps` 的 `0x20f`（2 条 `missing`）/`0x23f` 完全重合 |

### §5.4.2 本轮的 4 处能力台账落地（`analysis/engine-capabilities.json`）

| 能力条目 | 改动 |
|---|---|
| `lazy-movie-texture-slot` | `absent`/`E1`/`guard: ""` ⇒ **`partial`/`E2` + `guard: test/t0164-misc-batch.test.ts#★P3 0x20F：该槽纹理表为空 ⇒ 抛错`**；note 重写（`T-0164` 已把"对象表惰性创建 + 复用 + `0x23D` 清表 + `0x23F` 判据"做进两个宿主；旧 note 的"本票文件范围外 / 没有可绑的对象"**已被推翻**）；`engine.fns` 补 `sub_4237B0`(0x20F)/`sub_4246B0`(0x236)/`sub_488DC0`(装载)/`sub_489230`(起播)/`sub_41A300`(0x23D)，`reads` 补 `Engine+365288`（CTexture 槽表） |
| `text-layout-wrap-ruby` | 删 vestigial 顶层 `note`（数组 → 消失；沿革早已在 `journal` 记"本次合并成整串"）；`emulator.note` 例数 `13 → 实测 18` |
| `msgwin-config-gates` | 把 `set:ReDrawTextOnKey`/`set:WheelKeyUp|Down` 那半句从"见 `T-0166`"补成结论（内建默认 1/3/1 ⇒ 分支可走到、emulator 已实现滚轮推进与悬停重绘门） |
| `scene-flag-46528-bits` / `scene-3d-weather-effects-rain-snow-leaf` / `bullet-dirty-from-freeze-or-pending` | 三处**裸文件守卫加真实用例锚**（把"文件存在"升级成"**字面用例名**存在"的棘轮） |

### §5.4.3 顺带清掉的杂键（`capabilities.js --validate` 看不见的那一类）

- `scene-freeze-flag`：删顶层 vestigial `capability`（= `name` + 括号补充）与 `evidence`（= `emulator.evidence` 的重复）。
- `live2d-mesh-batches`：删顶层 vestigial `evidence: "E4"` —— 它与权威字段 `emulator.evidence: "E3"` **互相矛盾**，
  且 note 里那句"E4 已做"的依据是 `.tmp/l2dfix-0-title.png` / `.tmp/t0042d-0-title.png`，而 `.tmp/` 是 gitignore 的临时区
  （纪律：**证据不许指 `.tmp/`**）⇒ 不构成持久 E4 凭据，故不改 `emulator.evidence`，只把沿革落 `journal`。
- ⇒ **教训**：`--validate` 只查 `emulator.note` 的**类型与语义**，**顶层杂键一律漏检** —— 这类数据损坏只能靠盘点。

### §5.4.4 剩余面

`T-0148` 的剩余面收敛为：① §5.2 的 `quote-gone` 半边（13 条；其中 8 条 `stale-ledger` 已由 A–F 波解决，其余按 §5.1 记录）；
② 与 `T-0179` 串行的 msgwin 族（`T-0019` 拆分票）；③ 三张 doing 票（`T-0148`/`T-0091`/`T-0067`）。

---

## §5.5 §5.2 的 `quote-gone` 半边收口（第 70 轮 goal round 3，2026-09-25）

13 条全部裁完：**① 真缺口 ×1**（#12，已实现 + 守卫 + 红→绿 `1/4 → 4/4`）· **② 结构性不适用 ×4** · **③ 早已补上没回台 ×8**。
★其中 **#9 / #10 推翻了审计原文本身**（#9 的「队列恰剩 1 项」是审计记错成 `0x1F5`、实际属 `0x7C`；#10 的「每帧效果推进完全没有」与代码不符 ——
`scWeatherAdvance` 就是 `sub_453540`，由 `renderer/scene/commit.ts:90-92` 每帧经两宿主 `advanceModel` 调）。全文见 `quote-gone-adjudication.md`。

**#12 摘要（本轮唯一的代码单元）**：右键「取消/跳读」的**通路早已在位**，但 `engine.ts` 的 `#cancelRoute()` 读错了格 ——
修前读 `input.mouseJump`（= `0xCC` 的 `107664`，读者是 `0xCD`），而体 raw 20367 读 `489488 + 4*cur` = **`rewindMainBase + cur`**（写者 `0x7B`）。
语料 **`i0cc` 0 处 / `i07b` 1097 处（334 文件）** ⇒ 修前**真脚本上右键取消永不触发**。改一行 + 新增分水岭负例。

**顺带**：本轮把体检脚本从 `.tmp/` 提升为常驻工具 **`.agents/skills/amayui-engine-analysis/scripts/check-ledger-refs.js`**
（台账正文里 `文件:行` 引用的**只读**体检；这一格此前**没有任何棘轮保护**），带 `test/agent-workflow.test.ts` 守卫，并写进两个技能的工具体表。
它第一次跑就抓到两处真问题：`0x142` 的行号引用漂移 + `engineFieldIds.ts` 里一句与代码相反的陈旧注释（都已订正）。

★**重复项（建议 owner 直接标 `closed(dup)`）**：§5.2 的 `still-present` 里有 4 行与 §5.1 的「已改」同源 ——
`src/renderer/scene/ops.ts`（`46528` bit2）、`src/vm/handlers/msgwin.ts`（排版锚点）、`test/mesh-vertex-quad.test.ts`、`test/op-327-32e-setweather-noop.test.ts`。


## 2026-09-25

第 70 轮：§5.2 的 still-present 半边（23 条）裁决完毕（§5.4）。
★收口实测：`cd app/amayui-emulator && npm run verify` **exit 0**（tests 1678 / pass 1676 / fail 0 / skipped 2）；
四份台账 `--validate` 全绿；五份生成物 `--check` 全绿；`fix-evidence-lines --any --check` 漂移 0 / 失效锚点 0。
