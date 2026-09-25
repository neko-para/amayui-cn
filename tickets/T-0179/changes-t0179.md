# T-0179 变更记录 —— 缺口台账 `partial` 的 140 条 `missing[]` 找回 live 承接票

> 范围：只动 `analysis/opcode-gaps.json`（其生成物 `docs-new/03-engine/opcode-gaps.md` 已重生成）＋本票目录。
> 未动任何 `src/**`、其它台账、`docs-new` 叙述页、`CONTEXT.md`（后者由主 agent 收口时统一改）。

## §1 结构性发现（本票的由来）

`partial` 处置位（`tickets/T-0149`）要求每条 `missing[]` 带 `{what, ticket, raw}`，其中 `ticket` 的语义是**承接票**
（`scripts/build-opcode-gaps.mjs` 的注释与校验器都这么写：`tickets/<id>/ticket.json` 必须真实存在）。

2026-09-25 实测：**140/140 条 `missing[]` 的 `ticket` 全部指向已经 `done`/`dropped` 的票** ——
A–F 波逐簇收票时，票内「如实登记」的缺口被留在台账里，而**承接票随票关闭** ⇒ 这份登记账**没有 live owner**：
既不出现在看板的 doing/open 里，也不会被任何一轮的判绿口径盯住。

分布（前 12）：`T-0151`×28 / `T-0152`×17 / `T-0155`×12 / `T-0153`×11 / `T-0156`×9 / `T-0154`×8 /
`T-0162`×7 / `T-0164`×7 / `T-0163`×7 / `T-0159`×7 / `T-0158`×6 / `T-0170`×6。

★这不是「台账写错」，是**收票纪律的一个缺口**：单元把缺口如实登记后没有下家。

## §2 本票开场做的结构修复（已落盘，实测）

| 项 | 处置 | 实测 |
|---|---|---|
| 84 条 `partial` 条目的 140 条 `missing[].ticket` | 批量改指 **`T-0179`**（live） | `非 T-0179 的 missing = 0` |
| 原承接票（出处） | 逐条目追加一条 `journal[]`：「原承接票 = T-0151 / …」 | 84/84 条目已补 |
| `what` / `raw` / `disposition` | **一字未动** | `build-opcode-gaps.mjs --check` ✓；counts 不变（partial 84 / 缺口 140） |

命令（可复算）：
```
node .tmp/settle/gen-plan-t0179.mjs                 # 读现盘面生成计划（84 ops）
node .tmp/settle/ledger-set.mjs --plan .tmp/settle/plan-t0179.json --dry   # 0 problem
node .tmp/settle/ledger-set.mjs --plan .tmp/settle/plan-t0179.json         # 应用（213333 → 235923 字节）
node scripts/build-opcode-gaps.mjs && node scripts/build-opcode-gaps.mjs --check
cd app/amayui-emulator && node --import tsx --test test/opcode-gaps.test.ts
```

## §3 「0x… → 原承接票」对照表（84 条）

| opcode | missing 条数 | 原承接票 |
|---|---|---|
| 5 (0x5) | 1 | T-0156 |
| 9 (0x9) | 2 | T-0156 |
| 50 (0x32) | 1 | T-0155 |
| 96 (0x60) | 2 | T-0164 |
| 110 (0x6e) | 3 | T-0151 |
| 112 (0x70) | 3 | T-0151 |
| 113 (0x71) | 3 | T-0151 |
| 114 (0x72) | 3 | T-0151 |
| 117 (0x75) | 2 | T-0151 |
| 130 (0x82) | 4 | T-0151 |
| 140 (0x8c) | 2 | T-0156 |
| 147 (0x93) | 1 | T-0158 |
| 151 (0x97) | 1 | T-0158 |
| 180 (0xb4) | 1 | T-0152 |
| 181 (0xb5) | 1 | T-0152 |
| 186 (0xba) | 1 | T-0152 |
| 187 (0xbb) | 1 | T-0152 |
| 188 (0xbc) | 1 | T-0152 |
| 194 (0xc2) | 1 | T-0152 |
| 200 (0xc8) | 1 | T-0156 |
| 205 (0xcd) | 1 | T-0158 |
| 255 (0xff) | 1 | T-0158 |
| 256 (0x100) | 1 | T-0158 |
| 307 (0x133) | 1 | T-0156 |
| 308 (0x134) | 2 | T-0156 |
| 322 (0x142) | 2 | T-0161 |
| 327 (0x147) | 1 | T-0158 |
| 328 (0x148) | 1 | T-0161 |
| 332 (0x14c) | 4 | T-0163 |
| 333 (0x14d) | 2 | T-0163 |
| 402 (0x192) | 3 | T-0162 / T-0082 |
| 403 (0x193) | 3 | T-0162 / T-0082 |
| 406 (0x196) | 2 | T-0151 |
| 414 (0x19e) | 4 | T-0159 |
| 430 (0x1ae) | 3 | T-0159 |
| 431 (0x1af) | 1 | T-0175 |
| 432 (0x1b0) | 1 | T-0162 |
| 434 (0x1b2) | 3 | T-0162 / T-0082 |
| 442 (0x1ba) | 1 | T-0152 |
| 444 (0x1bc) | 1 | T-0152 |
| 457 (0x1c9) | 1 | T-0152 |
| 465 (0x1d1) | 6 | T-0170 |
| 502 (0x1f6) | 2 | T-0154 |
| 504 (0x1f8) | 2 | T-0153 |
| 505 (0x1f9) | 2 | T-0153 |
| 506 (0x1fa) | 1 | T-0153 |
| 514 (0x202) | 2 | T-0155 |
| 517 (0x205) | 2 | T-0151 |
| 520 (0x208) | 1 | T-0153 |
| 525 (0x20d) | 1 | T-0154 |
| 526 (0x20e) | 1 | T-0155 |
| 527 (0x20f) | 2 | T-0164 |
| 531 (0x213) | 1 | T-0151 |
| 541 (0x21d) | 1 | T-0164 |
| 553 (0x229) | 1 | T-0154 |
| 557 (0x22d) | 1 | T-0154 |
| 559 (0x22f) | 1 | T-0154 |
| 564 (0x234) | 1 | T-0155 |
| 575 (0x23f) | 1 | T-0153 |
| 580 (0x244) | 1 | T-0154 |
| 582 (0x246) | 2 | T-0153 / T-0163 |
| 585 (0x249) | 3 | T-0153 |
| 591 (0x24f) | 1 | T-0155 |
| 600 (0x258) | 1 | T-0155 |
| 602 (0x25a) | 1 | T-0161 |
| 603 (0x25b) | 1 | T-0161 |
| 702 (0x2be) | 3 | T-0151 |
| 712 (0x2c8) | 1 | T-0151 |
| 724 (0x2d4) | 1 | T-0164 |
| 745 (0x2e9) | 1 | T-0161 |
| 756 (0x2f4) | 1 | T-0152 |
| 757 (0x2f5) | 1 | T-0152 |
| 758 (0x2f6) | 4 | T-0152 / T-0164 |
| 760 (0x2f8) | 3 | T-0152 |
| 769 (0x301) | 1 | T-0151 |
| 800 (0x320) | 3 | T-0155 / T-0154 |
| 801 (0x321) | 1 | T-0155 |
| 807 (0x327) | 1 | T-0093 |
| 808 (0x328) | 1 | T-0093 |
| 809 (0x329) | 1 | T-0093 |
| 813 (0x32d) | 1 | T-0155 |
| 814 (0x32e) | 1 | T-0093 |
| 831 (0x33f) | 1 | T-0155 |
| 847 (0x34f) | 1 | T-0175 |

## §4 逐条裁决的作业面（140 条 ⇒ 每条三选一）

1. **实现** ⇒ 命名守卫 + 红→绿证据（先跑出红），然后删掉该条 `missing`。
2. **关掉** ⇒ 引当前代码行/raw 证明已落地或前提被取代 ⇒ 删该条 `missing`；整条 `missing[]` 清空时把 `disposition` 升 `implemented`。
3. **保留** ⇒ 写明「为什么不现在做 + 重开条件」，`raw` 保持单段、`ticket` 保持 `T-0179`（或另开 live 票）。

★★**开工前先用"三态过滤"给每条打标**（第 52–54 轮的结论；权威条目 = `docs-new/00-overview/lessons.md` 的「三态过滤」）：
① **可补的真缺口**（处理对象在 emulator 里存在，只差接线）⇒ 走第 1 条；
② **结构性不适用**（72B 记录向量 / GDI 表面 / D3D 设备状态 / 平坦地址等处理对象**在 emulator 里不存在**）⇒ 走第 3 条，
把 `what` 重写成「为什么不存在 + 重开条件」，**不要假实现**；★补充判据：**"补上"在当前语料/状态机下不产生可观测差异
（恒 0 的格、或没有读者的写 ⇒ 死写闸门会亮）也属于这一态**（例：`0x071` 的 `Engine[122496] = 0` —— 该格 = `MsgWinState.alt`，
读者在 `src/vm/msgwin.ts:781`、清零点 `:679/:884/:894`，但**没有任何置 1 的写点** ⇒ 今天补它零行为差异）；
③ **早已补上但没回台**（`what` 自述「已实现/已删/现按…」）⇒ 走第 2 条。
★已按三态处置的实例：② `0x82` 的 `op3 & 1`、`0x61`（无平坦地址）、`0x248`/`0x25c`（无对应渲染对象）；
③ `0x147`/`0x060`/`0x142`/`0x82`（`op3 & 0x40`）共 4 条已删。

建议作业顺序（按"改动面是否互斥"分批，避免同文件并行）：
- 先做 **`src/shader`/`renderer` 之外的 vm 层**：`0x61`/`0x192`/`0x193`/`0x1b2` 一类操作数-IO（★注意：`readStringOperand` 的 int/float/ptr 强制转换**已由 T-0162/T-0163 落地**，登记时请先复核）；
- 再做 **`renderer/**`**（场景/转场/绘制项族）；
- 最后 **`handlers/msgwin*`**（33 条里最大的一簇，与 `T-0019` 的拆分票冲突 ⇒ 必须与它串行）。

## §5 §8.3 零痕迹名单的收口（第 48 轮，2026-09-25）

作业面 = `tickets/T-0148/changes-coverage.md` §8.2/§8.3 的「六份真源零痕迹」项。本轮做**读体现状 →
落台账**，先清「其实早就修好了、只是没人登记」的那批（避免下一轮重复投入），再挑一条真缺口实现。

### §5.1 落台账：4 条「已按体实现、台账里根本没有条目」

| opcode | 审计 | 实测现状 | 台账 |
|---|---|---|---|
| `0x91` | P2 `missing-consumer`（`effect_flags \|= 0x800000` 无消费者） | `T-0158` 已实现：`sub_4098E0` 的每轮泵落 `servicePanelDisplayState()`（左键 labelC+清整表 / 回退 label / 悬停 enter-leave 三出口），显示分支写长度槽 0 ⇒ `c.jump(-1)` 停在本条 | 新增 `implemented`（`ticket: T-0158`），守卫 `test/panel-display-state.test.ts` 6 例 |
| `0x92` | P2 `missing-branch`（长度槽 5 → 0）+ P2 `missing-consumer`（`fallbackLabel` 死写） | 同上；`RoutePanel.fallbackLabel` 现为 `servicePanelDisplayState()` 的真读者（引擎 raw 14084-14090） | 新增 `implemented`（`T-0158`） |
| `0x23d` | P2 `missing-consumer`（释放 slot 42..999 整条能力缺失） | `T-0164` 已实现：宿主缝 `releaseMovieSlots()` 两个宿主都真析构 42..999 并解绑槽→imgid，VM 侧恰好下一次调用（语料 203 处/197 文件） | 新增 `implemented`（`T-0164`），守卫 `test/t0164-misc-batch.test.ts` 3 例 |
| `0x94` | P2 `missing-branch`（WM_MOUSEMOVE 的命中测试门）+ P3 `approximation`（首次命中测试被 `if (hasCursor)` 门住） | ① `T-0158` 已修；② **本轮实现**（见 §5.2） | 新增 `implemented`（`T-0179`），两条守卫见 §5.2 |

### §5.2 实现：`0x94` ② 的命中测试门（引擎 raw 140827）

- 体：`if ( _this[12958] || _this[12957] ) sub_403C50(Engine+5494, x, y);` —— 面板对象基址 `Engine+5494`
  （dword）⇒ `12958 = 5494 + 7464`（`fillPending`）、`12957 = 5494 + 7463`（`shown`）。
- 改：`src/vm/engine.ts` 的 `onCursorMove` 接线按同一道门放行（关闭期不重算游标）；`src/vm/input.ts`
  的过时注释订正（旧注写成 `panelA[7463] || panelA[7462]`，第二格差 2）；`src/vm/route.ts` 的
  `#fillPending` 注释补上读者（审计原话：修前只写不读）。
- 红→绿：`test/panel-cursor-move-gate.test.ts`（4 例）—— 摘掉门 ⇒ **2/4（2 红）**，恢复 ⇒ **4/4**。
- ★审计对 ② 的可观测性备注（要判真伪需「关闭期移动过 **且** `[7465]` 仍为 1」的时序 ⇒ 触发窗口窄）
  不改变体里这道门的存在；本轮按体实现，不按"是否容易观测"取舍。
- ★★**门的左半不是恒假项**（读体反证）：审计同一批里另有一条自述说「`12958` 全反编译无置 1 点 ⇒
  `|| _this[12958]` 是恒假项」—— 那是按 `_this[12958]` **直查**漏掉的：`sub_404020(int _this, …)`
  收的是**面板指针**、体内一律用**字节**偏移，`*(_DWORD *)(_this + 29856) = 1`（raw 10019/10028）
  ⇒ `29856/4 = 7464` ⇒ 落回 `Engine[5494+7464] = Engine[12958]`；同函数 raw 10016 的门
  `*(_DWORD *)(_this + 29860)` = `[7465]`（`hitDone`）、raw 10018/10027 的 `_this + 3840` = `[960]`
  也都对得上 ⇒ 面板每次显示都置 `[7464] = 1`。

### §5.3 裁决为「保留（不假实现）」：`0x61`

体（raw 37742-37750）经 `sub_418CC0(_this, 1, tag, 值, -1, -1)` **按操作数自身 tag** 写：指针族写指针池、
直接型（int/float/string）写同类型的直接槽 —— 引擎**不要求 op1 是指针型**；emulator 的 `setRefOperand`
只认 6 种指针型、直接型抛。emulator 的操作数模型里 `Ref` 是结构化引用（无平坦地址数值）⇒ 引擎那条语义
**无法逐位复现**，故不假实现：落 `partial` + 1 条 `missing`（写明分叉、结构性理由与两条重开条件），并订正
`test/opcode-operands.test.ts` 的 `EXPECTED_THROW` 里那句把"需要指针型"当引擎依据的旧理由（同族
`0x63`/`0x12c`/`0x2c9` 一并改注）。

## §6 §8.3 收口第 2 批（第 49 轮，2026-09-25）

同一作业面继续：本轮裁决 **10 条**（§8.3 待裁 16 → 6）。

### §6.1 实现：`0xA3` 的派发目标也走两级解析（本轮唯一的真缺口）

体（`sub_429830` raw 35742-35758）：`v2 = sub_41B640(_this,1)`（键）→ `sub_428E00(_this+107679, v2)`（查表）→
命中 ⇒ `ip = ip_base + 4*(*v3)`、未命中 ⇒ `ip = ip_base + 4*readInt(2)` —— **两条都不校验目标**，末了把长度槽写 0。

- 修前：emulator 在这里 `c.log` 一句 + `return`（控制流落回顺序执行）—— 与 `0x8C`/`0x8F`/`0xA0` 的批量
  修复口径不一致，且"脚本与其菜单表不同源"这件事只在日志里。
- 改：`src/vm/handlers/menu.ts` 的 `op_menu_dispatch` 改用 `branchTarget`（`labelMap` → `script.dwordToInstr`），
  只有**两级都查不到**（目标越出脚本）才抛 `branchTargetError`。
- 红→绿：`test/menu-dispatch-target.test.ts`（3 例）—— 摘掉回落 ⇒ **2/3 红**，恢复 ⇒ 3/3。
- 连带订正两处**钉住旧行为**的断言（都改成新口径，并在注释里引 raw）：
  `test/menu.test.ts:50-59`（原断 `_nextIp === null`）、`test/menu-string-key.test.ts:81-88`（原断"只记一条日志"）。

### §6.2 落台账：9 条「A–F 波已修好、只是没人回台」

| opcode | 处置 | 依据（本轮读体复核） |
|---|---|---|
| `0x239` | `implemented` | flipbook 的门是 **`flags & 1`**（`scSetFlipbook`，`src/renderer/scene/ops.ts`），不是审计说的 `created` 近似；守卫 `test/anim-window-done.test.ts` |
| `0x2c0` | `implemented` | 审计 P1「op2 是 pan」已被 `T-0152` 读体**推翻**：op2 的 **bit0 是循环位**，pan 走 `0x2F8`（落 `voicePanBase + ch`）；守卫 `test/audio-engine.test.ts` |
| `0x2c7` | `implemented` | `sjisSubstr` 对 `start < 0` 抛 `SjisSubstrOutOfRangeError`（= 引擎 `sub_40C120` 的 `std::out_of_range`），非负越界仍写空串；守卫 `test/text-sjis-limits.test.ts` |
| `0x2f7` | `implemented` | `op_voice_flag` 真的落 `engineValues[voiceChannelStateBase + ch] = 1` 再发宿主意图；守卫 `test/audio-opcodes.test.ts` / `test/t0152-audio-p2.test.ts` |
| `0x2ff` | `implemented` | `[21318+ch] = 1` + `[21321+ch] = op2`（原值直写、不钳位）已落盘；守卫 `test/audio-opcodes.test.ts` / `test/audio-engine.test.ts` |
| `0x350` | `implemented` | `resetMotionQueue`：门 = 模型非空（`sub_478500` raw 92653-92664 的 `if (*(_DWORD*)_this)`），清字节 20/21-22；★动作记录的循环位**不在**清点里；守卫 `test/live2d-t0160.test.ts` |
| `0x352` | `implemented` | `l2dSetPending`：门 = 槽里有模型（不再 `ensureSlot` 凭空建槽，修掉了审计 row 98）；守卫 `test/live2d-t0160.test.ts` |
| `0x34a` | `implemented` | `l2dNodeBaseOffset` 调 `markSceneDirty`（raw 134138 的 `_this[11627] = 1`，且**不置** `+76`）；守卫 `test/l2d-node-compose.test.ts` |
| `0xa2` | `partial` + 1 `missing` | 字符串族键已按体实现（`keyOf` 走 `readStringOperand`，守卫 `test/menu-string-key.test.ts`）；残留 = 数值族键的**全角化**口径（引擎经 `sub_41A6C0` raw 25539-25593），统一留给 `operand.ts` 的 owner / `T-0165` |

台账位移：opcode-gaps **164 → 174** 条（implemented 46 → 54 / partial 85 → 87 / missing 139 → 141）。

### §6.3 下一批（§8.3 剩余 6 条）

`0x248`（全局 blit 分块除数无消费者）、`0x259`（`texSlotFlags` 无读者，引擎侧随存档持久化）、
`0x25c`（`block224` 写完即弃）、`0x2bf`（越界 SE 通道缺引擎的错误串）、`0x32f`（灯光开关整条能力）、
`0x340`（渲染状态 `Scene[13948]` + 设备重放）。这 6 条都是**真缺消费端/宿主缝**，需要动 renderer/宿主，
按"一个文件同一时刻只归一个执行者"逐个来。

## §7 §8.3 收口完毕（第 50 轮，2026-09-25）

最后 6 条：**3 条 `partial` + 3 条 `deferred`**（台账 174 → **180** 条：implemented 54 / deferred 22 / partial 90 / missing 144）。

### §7.1 `partial` + `missing`（写侧在、消费端真的缺）

| opcode | 缺什么 | 为什么不现在做 · 重开条件 |
|---|---|---|
| `0x248` | **分块 blit 消费端**：引擎按全局 `dword_55052C` 把源矩形切成 ceil 除法的 N×M 格逐格搬运（raw 45886-45899）；emulator 只有单次缩放 blit | 复刻要按格循环 + 定采样口径，视觉收益未证实 · E4 实测出现"改 `i248` 后画面有差异" |
| `0x259` | 每槽两位的**存档快照持久化 + 装载重建**：raw 17474 随快照写下、raw 19875-19878 按 `flag_a==1` 决定重建槽 | 要给"纹理槽标志"在 emulator 侧找真实表再接入存档/装载，而存档子系统被 `T-0146` 的基线红占着 · 存档排期 / 现场出现"读档后该重建没重建" |
| `0x25c` | `o.block224`（13 dword 文本块头）的**排版/绘制消费端**（raw 68358-68370） | emulator 的排版是另一套模型，先要定"块矩形"对应哪个量；且与 `T-0019` 的 msgwin 拆分票同文件冲突 · 语料出现 `i25c`，或 `T-0019` 拆分完成 |

### §7.2 `deferred` + `why`（消费者只存在于 emulator 没有的子系统）

| opcode | 依据（读体） | why 的要点 |
|---|---|---|
| `0x2bf` | `sub_4B5170` raw 137725 `if (a2 < 10) {…写延迟字段…} else { sprintf_s(…aSetdelaySound); sub_4034C0; return 0; }`；`sub_4034C0` raw 9427 = `sub_497620` 的 **WriteFile 日志汇**（错误串 raw 5197） | 引擎越界支**不改状态、不弹玩家可见消息**，只写日志；宿主 `#seChannel` 已按**同一条界 0..9** 记日志 ⇒ 只剩文案差异。语料越界 0 处可达 |
| `0x32f` | `sub_49A150` raw 116741-116748 两行：`Scene[13677+idx] = 0`（enabled 位，读者是设备重放 raw 122110-122122）+ 设备 `LightEnable(idx, FALSE)` | 该位的唯一读者是 D3D 重放 ⇒ 写字段面只会造出"写了没人读"的假象（与同族先例的判据一致）；`setLight?.()` 是 `nativeTap.ts` 里有 why 的已登记不实现缝，`0x32E` 的开灯走同一缝 ⇒ 意图不丢。重开 = 出现 3D 灯光模型 |
| `0x340` | `sub_49A2D0` raw 116869-116876：`Scene[13948] = op1` + `SetRenderState(22, op1)`，重放只在设备重建路径（raw 122124） | 语料 **0 处**（`i340` 全库无命中），且 emulator 没有设备丢失/重建路径 ⇒ 写状态槽 = 假字段。重开 = 语料出现 `i340` 或渲染侧要按引擎状态号做等价映射 |

### §7.3 §8.3 总账（21 条零痕迹项的最终处置）

- `implemented` **12**：`0x91` `0x92` `0x94` `0x23d` `0x239` `0x2c0` `0x2c7` `0x2f7` `0x2ff` `0x350` `0x352` `0x34a`
  （全部是"A–F 波已修好、只是没人回台"——主要修复票 `T-0158`/`T-0160`/`T-0151`/`T-0152`/`T-0164`）；
- `partial` + `missing` **6**：`0x61` `0xa2` `0xa3` `0x248` `0x259` `0x25c`；
- `deferred` + `why` **3**：`0x2bf` `0x32f` `0x340`。
- ⇒ **真的只缺两条**：第 49 轮的 `0xa3`（已实现）与……没有第二条；其余全是"已实现但没登记"或"消费者在 emulator 里不存在"。
- 作业面收敛：`T-0148` 只剩 ② §4/§5 的 23 条 `still-present`；`T-0179` 名下 **144 条 `missing`** 待逐条裁决。

## §8 §5.2 `still-present` 裁决批（第 51 轮，2026-09-25）

§8.3 关掉后作业面转到 §5.2 机械化复核表的 `still-present` 半边（23 条）。本轮裁决 3 条，台账 180 → **181** 条
（partial 90 → 92 / implemented 54 → 53 / missing 144 → **146**）：

| §5.2 项 | 处置 | 落点 |
|---|---|---|
| `0x108` P3 `host-invented` | **保留补丁 ⇒ `partial` + 1 `missing`**（★**推翻审计的结论方向**） | 审计只看了 `sub_477220`（raw 91626-91642：确实**没有**保持位，每次从零重算 `GetAsyncKeyState`）就判"emulator 自造保持位"。但 `pressLatch` 是**有据且必需**的保真性补丁：宿主把 down/up 作为**批量事件**投进 VM ⇒ 摘掉它，`test/title-exit.test.ts` 的「快速点击（down+up 落在同一次轮询之间）」用例立刻红（那是用户实测"点退出没反应"的回归）。真机的保证 = 消息循环 + ~60Hz 轮询 + 「挂起位 → 消费刷」管道，而 emulator 只把该管道建在**掩码路径**（`flushPending`/`flushHeld`）上。`missing[]` 写清披露口径 + 两条重开条件（① 给 `0x108` 也建挂起位模型 ② 宿主不批量投递输入） |
| `0x223` P2 `missing-behavior`（语料 **178** 处） | **`implemented` → `partial` + 1 `missing`**（★订正台账自相矛盾） | 该条 note 末尾早就写着"★部分：惰性建纹理与渲染侧消费端仍未建模（记在本票）"+"★T-0149：处置 = partial … 逐条见 `missing[]`"，**但字段面还是 `implemented` 且 `missing[]` 为空** —— 机械检查只校验"`partial` 必须带 `missing`"，不校验 note 的自述 ⇒ 这类"描述过期"只能靠人读。读体（`sub_4ADDB0` raw 132591-132625）确认缺的是写记录**前**的惰性建层/渲染目标重绑（per-slot 层表 `Scene[槽号+10614]` → `sub_4A2C10`）。依赖 `T-0091` 的渲染层家族 |
| `0x25a` P3 `missing-consumer` | **无需新登记** | 早已由 `T-0161` 登记为 `partial` + 1 `missing`（正是那两条媒体下发门）⇒ §5.2 表里的"现已在缺口台账"是对的 |

★方法论收获（值得下一批复用）：**§5.2 的 `quote-still-there` 只说明"审计当时引的代码还在"，不说明"缺口还在"**——本轮 3 条里
1 条是"审计方向错（补丁其实有据）"、1 条是"台账已自相矛盾（note 说 partial、字段说 implemented）"、1 条是"早就登记过"。
⇒ 这一批的裁决成本几乎全在**读体现状**，不在改代码。

## §9 `missing[]` 的"陈旧条目"清理批（第 52 轮，2026-09-25）

延续 §8 的方法论收获，本轮把 `missing[]` 里的**"关单说明"**（`what` 自己就写着"已实现/已删/现按…走"）逐条复核后删掉。
台账 181 条不变，但 `missing` **146 → 143**（partial 92 → 91 / implemented 53 → 54）：

| opcode | 删掉的 `missing` 条 | 复核证据（当前工作树） |
|---|---|---|
| `0x147` | raw `39676`（唯一一条 ⇒ `missing[]` 清空，处置升 `implemented`） | 该条 `what` 自述「emulator 自造的 `n > MAX_POINTS ⇒ throw` **已删**；现按 `ENGINE_POINT_ALLOC_MAX` 上界走 else 支（不抛）并记日志」—— 代码里 `src/vm/handlers/region-hittest.ts:173`（`ENGINE_POINT_ALLOC_MAX = 0x0fffffff`）与 `:356`（上界支）都在，与体（raw 39676 的 `operator new[](8*n)` 是唯一边界）同形。守卫 `test/op-147-2f2-region-hittest.test.ts` |
| `0x060` | raw `37725-37736` | 该条自述「**已实现（T-0164）**…emulator 同形（`(r % mod) \| 0` + 仅 `mod === 0` 抛）」—— 代码里 `src/vm/handlers/arithmetic.ts:211`（`if (mod === 0)` 抛）与 `:217`（`p.setInt(1, (r % mod) \| 0)`）与体（raw 37727 的 `if (!v2)`、负模数照走有符号取模）一致。**剩 1 条仍开**：模数为 0 时引擎在抛之前先写一次 `op1 = 0`，emulator 直接抛 |
| `0x142` | raw `17961` | 构造/复位初值 1 **已由 `T-0175`/`T-0169` 落地**：`src/vm/engine.ts:373` 的初值表含 `[ENGINE_FIELD.scriptEngineFlag, 1]`、`src/vm/handlers/control.ts:581`（`op_exit_script` = 整体复位 `sub_40DF10` 的等价物）置 1。守卫 `test/t0175-engine-flag-and-rewind.test.ts`（文件头逐字引 raw 22591/17961）。**剩 1 条仍开**：唯一读者是导出查询 `sub_4765C0`（emulator 无这一层 ⇒ 不编消费者） |

★两条判据（下一批沿用）：① `missing[].what` 若以「已实现/已删/现按…」开头 ⇒ 它是**关单说明**，必须复核后删（否则 T-0179 的池子会永远虚高）；
② 删完 `missing[]` 为空的条目必须把处置升 `implemented`（`test/opcode-gaps.test.ts` 的棘轮会拦"带 missing 的 implemented"）。

### §9.1 本轮顺带补的一个**真守卫**（第 52 轮，唯一动代码的一处）

`0x060`（random）的最后一条 `missing` 是「模数为 0 时引擎先写 `op1 = 0` 再抛」—— 复核发现**行为早已按体落地**
（`src/vm/handlers/arithmetic.ts` 的 `op_random`：`if (mod === 0) { p.setInt(1, 0); throw … }`，注释里就引着 raw 37729），
但**全仓没有任何守卫**（`engine-field-store.test.ts:180` 只断了"会抛"）⇒ 本轮补：

- 新增 `test/op-060-random-mod-zero.test.ts`（T0/core/vm，2 例）：
  ① 目标槽先经 **`writeIntOperand`** 垫 1234（★不能用 `globals.int.set`：全局 int 池是 **ENC** 的，直写会被 `decIntSlot` 读成垃圾）
  ⇒ 抛之后必须读回 **0**；② 负模数**照算**且结果落 `[0,2]`，钉住「唯一的门 = 恰好 0」（raw 37727）。
- 红→绿：把 `p.setInt(1, 0)` 注释掉 ⇒ ① 红（读回 `1234`，断言 `expected: 0`），恢复 ⇒ **2/2**。
- 台账：`0x060` 的 `missing[]` 清空 ⇒ 处置升 `implemented`（`missing` 143 → **142**，`implemented` 54 → **55**）。

## §10 陈旧 `missing` 清理（第 53 轮，2026-09-25）

沿用 §9 的判据继续扫：本轮删 **1** 条（`missing` 142 → **141**）。

| opcode | 删掉的 `missing` 条 | 复核证据（当前工作树） |
|---|---|---|
| `0x82` | raw `79687-79688`（`op3 & 0x40` 把起始记录下标后移 `win+132`；原条目说"bit6 完全未建模"） | **已落地**：`src/vm/handlers/msgwin.ts` 的 `op_gdi_repaint_window` 在 raw 79684-79688 的注释下写着 `emitWin(e, win, (mode & REPAINT_KEEP_SURFACE) !== 0 ? o.f104 + o.f132 : o.f104)`，而 `REPAINT_KEEP_SURFACE` = **bit6**（同函数上方那段：`op3 & 0x40` 为 0 ⇒ 移除 `win+104/+108`）。★越界门仍按体只看 `op2`（raw 79499-79505）—— 引擎的 `+132` 平移到 gate **之后**（raw 79687），emulator 同序 ⇒ 与体一致。守卫文件 `test/op-0104-gdi-repaint.test.ts`；**bit6 的 emit 起点尚无独立断言**（记为可选加固，不影响本次关单） |

★本轮是"小而实"的一轮：`0x82` 之后，该条 `missing` 从 4 → 3（剩下 `+112 == 1` 专用路径、`sub_4ABB60` 的宿主侧释放/重登记、`op3 & 1` 的记录级过滤 —— 三条都确认真缺）。
下一轮建议直接**实现**其中一条（`op3 & 1` 的记录级过滤最小：引擎 raw 79699-79700 的 `if ((v49 & 2) != 0 && (a4 & 1) == 0) goto LABEL_188;` ⇒ 记录自带 bit1 且 op3 未置 bit0 时跳过该条记录），带命名守卫 + 红→绿。

## §11 「实现 `0x82` 的记录级过滤」被读代码否掉（第 54 轮，2026-09-25）

第 53 轮 §10 把「实现 `op3 & 1` 的记录级过滤」列为本轮起点。**读代码后判定它在当前模型下无处施加**，故本轮**不改代码**，只把该条 `missing.what` 重写成「结构性不适用 + 为什么 + 重开条件」（`missing` 数不变：**141**）。

- 体（raw 79693-79700）：GDI 重画循环逐条走 **72B 记录向量**（`Font+3364`）——
  `v49 = *(record + 40)`（flags）；`if ((v49 & 2) != 0 && (a4 & 1) == 0) goto LABEL_188;`（`a4` = op3）
  ⇒ 记录**自带 bit1** 且 `op3` **未置 bit0** 时**跳过该条记录**。
- emulator：`op_gdi_repaint_window`（`src/vm/handlers/msgwin.ts`）**不遍历记录向量** —— 它只把该窗的
  **排版快照**重发布一次（`emitWin` → `native.msgWinSync(w, {style, segments, revealed, itemRanges, cell, blankExtent})`）；
  渲染侧也看不到记录向量（实测 `src/renderer/**` 对 `textItems` **0 引用**；记录向量只在 VM 侧被
  `advState`/`config1Chain` 搬运与探针使用）⇒ **没有"记录级"的位置可过滤**。
- ⇒ 要在 emulator 生效，必须先让重画/排版变成**记录驱动**（把 72B 记录向量接进渲染）；否则只能在快照层
  「假装过滤」，那是编语义。**重开条件**已写进 `missing[].what`。
- ★方法论（第三次出现同一形状，值得固化）：**`missing[].what` 里"某条分支未建模"不总是"可以补的分支"**——
  相当一部分是「引擎那条分支的处理对象（记录向量 / GDI 表面 / 设备状态）在 emulator 里根本不存在」，
  即**结构性不适用**。裁决时要区分三态：① 可补的真缺口；② 结构性不适用（写清为什么 + 重开条件）；
  ③ 早已补上但没回台（§9 的"关单说明"）。

## §12 机械扫描 §9 判据：**类型③ 的池子已见底**（第 56 轮，2026-09-25）

把 §9 的判据做成机械扫描（`missing[].what` 前 60 字含「已实现 / 已删 / 现按 / 已落地 / 不再 / 已改」）：全表 141 条**只命中 2 条**。

| opcode | 结论 |
|---|---|
| `0x244`（raw 132428-132501） | **混合条目 ⇒ 收窄（不删）**：两半已落地（绘制项 `+52`；`Scene+1100` → `Engine.l2dNodes` 的 `node+24`，即 `L2dNode.wins.startedAtMs = 0` + `latched = false`，raw 132478），**真正未落地的是 `Scene+1084`（572 B-A 记录表）**（与 `0x1f6` 同一条缺口）⇒ `what` 重写成只陈述这一半，保留有意偏差说明（引擎这段不置脏、emulator 置脏）与重开条件 |
| `0x19e`（raw 38317-38322） | **不删**：`what` 前半的「已改为抛」只是上下文，**残余缺口（写侧失败时的结果码）仍然开** |

⇒ 结论：**类型③ 池子见底**（第 52/53 轮删 4 条，本轮全表再扫只剩 1 条"混合"需收窄）。
剩余 141 条按 §4/§11 的三态过滤，只可能是 **① 可补的真缺口** 或 **② 结构性不适用**；
下一轮起重心放 ①，优先选「处理对象在 emulator 里确实存在、只差接线」的项。

## §13 `CONTEXT.md` §3 计数与六份真源的机械核对（第 57 轮，2026-09-25）

把 `CONTEXT.md` §3 的每个数字与真源**现数**逐项比对（脚本只读，不写盘），**全部一致**：

| §3 项 | 真源现数 | 结果 |
|---|---|---|
| 票据 177（done 163 / open 9 / doing 3 / dropped 2 / blocked 0） | `tickets/*/ticket.json` 逐张统计 | ✓ |
| 能力台账 144（已核验 79 / 已建模未核验 5 / 部分 30 / 缺失 6 / n/a 24） | `analysis/engine-capabilities.json` 的 `emulator.status` 分布 | ✓ |
| 缺口台账 181（partial 90 / implemented 55 / deferred 22 / 有据 no-op 9 / unimplemented 5）＋ `missing` **141** | `analysis/opcode-gaps.json` | ✓ |
| 第一层 620 / 393 | `analysis/functions.json` / `analysis/fields.json`（**顶层数组**，直接取 `length`） | ✓ |
| 脚本台账 37 | `analysis/scripts.json` | ✓ |
| 死写基线 11 | `app/amayui-emulator/dead-writes.baseline.json` 的 `known`（+ `check:dead-writes` 报"无新增"） | ✓ |

★为什么值得做：`CONTEXT.md` 是**下一个会话的权威状态快照**，它的数字一旦漂移，后续排期就会按错的前提走
（本会话已两次因"台账/审计描述过期"白跑：`0x223` 的 note 说 partial 而字段说 implemented、§8.3 的 16 条里 15 条其实已修）。
⇒ 建议把这条核对固化为每 N 轮的例行检查（脚本形态见本轮的一次性命令：读六份真源 → 打表比对）。

## §14 补 `0x82` bit6 起点的**独立守卫**（第 58 轮，2026-09-25 —— 本轮是代码单元）

第 53 轮删掉 `0x82` 的那条 `missing`（`op3 & 0x40` ⇒ 起点 `win+104 + win+132`）时留了一句「该条 bit6 的 emit 起点尚无独立断言」；本轮把它补上：

- 新增 `test/op-82-emit-start-offset.test.ts`（T0/core/ops，2 例）—— 载荷第二参是 `MsgWinInput`，起点在 **`input.style.itemId`**（= `styleOfWin` 的 `itemId` 实参，`src/vm/msgwin.ts:288-290`），由 `src/text/textLayer.ts` 决定层序。
- 三处断言：① `op3` 不带 bit6 ⇒ **`win+104` 先被清 0**（raw 79634-79653）故发布起点 `0`；② 带 bit6 ⇒ `win+104 + win+132` = **107**；③ `win+132 = 0` 的退化情形仍为 `win+104`。
- **红→绿**：把 `msgwin.ts` 的 `o.f104 + o.f132 : o.f104` 改成 `o.f104 : o.f104` ⇒ ② 红（`actual [100] / expected [107]`）；恢复 ⇒ **2/2**。
- ★两个探针收获（已写进条目 `journal`）：**载荷起点在 `input.style.itemId`**（不是 `input.itemId`）；**`op3` 不带 bit6 时 `win+104` 会被先清 0**，所以「起点 = win+104」只在 bit6 置位时才可见 —— 既有守卫 `op-0104-gdi-repaint.test.ts` ⑤ 只数**调用次数**、不看载荷，因此这一路此前没有任何回归闸。
- 台账：`missing` 数不变（141）；`0x82` 条目加 1 条 `journal`（`field: guard`）记录该守卫与红→绿证据。

### §14.1 第 59 轮：把同一守卫扩到**孪生兄弟 `0x1D1`**（同一处表达式有两份）

`grep 'emitWin(e, win,'` 只有两处、**表达式逐字相同**：`src/vm/handlers/msgwin.ts:1208`（`0x82`
`op_gdi_repaint_window`）与 `:1305`（`0x1D1` `op_recall_page_repaint`，`sub_4675A0` = `sub_466000` 的孪生兄弟）
⇒ `test/op-82-emit-start-offset.test.ts` 改成对 `[0x82, 0x1D1]` **参数化**（共 4 例：每条的 bit6 起点 + `win+132 = 0`
退化情形）。红→绿：**同时**把两处 `o.f104 + o.f132 : o.f104` 降级成 `o.f104 : o.f104`（脚本先断言锚点数 = **2**，
避免只改一处）⇒ **2 fail / 4**（两条 bit6 断言各红一条），恢复 ⇒ **4/4**。

★意义：`0x1D1` 是 `T-0170`（回想页渲染入口）刚落地的入口，此前它自己的起点分支同样只有"重发布/次数"类断言；
现在两条孪生路径都被"载荷里的 `style.itemId`"钉住。

## §15 并行 subagent 裁决批（第 60–62 轮）：A = msgwin/text、B = audio+agerc+save-slot

两个 subagent 各自读体裁决，**只交 `ledger-set.mjs` 计划**（A 在授权下自行落库并重生成了 `opcode-gaps.md`；B 只交计划、由主 agent 落库）；
代码改动严格分族（A 只碰 `msgwin.ts` 与 `op-3-004-*` 测试、B 只碰 `audioEngine.ts` 与 `audio-engine.test.ts`），互不重叠。

| | 裁决条数 | ① 实现 | ② 结构性不适用 | ③ 删条目 |
|---|---|---|---|---|
| **A**（`0x070`/`0x071`/`0x072`/`0x082`/`0x196`/`0x1d1`/`0x0a2`/`0x0a3`） | 22 | **1**：`0x196` raw 29104-29110（bit16 只在 `sub_46BE30` 返回非 0 = 本行有内容时才置） | 13（专用 GDI 渲染器 ×3、D3D/GDI 表面重建 ×2、宿主 DrawItem 释放、`op3 & 1` 记录级过滤、栏带四边形、逐字光栅化、`win+132/136` 记账=死写、自动换行第三 push 点、语音图标宿主缝） | 8（`0x70` 几何三对槽、`0x71`×3、`0x72`×3） |
| **B**（`0x0b4`/`0x0b5`/`0x0ba`/`0x0bb`/`0x0bc`/`0x0c2`/`0x0c8`/`0x0c4`/`0x1bc`/`0x1c9`/`0x14b`/`0x14c`/`0x14d`/`0x19e`/`0x19f`/`0x1a0`/`0x1ae`/`0x1af`） | 23 | **2**：`0xb5`/`0xba`「值域内但通道无缓冲 ⇒ 报 `dsPlay(%d)` 并拒绝起播」（`sub_4B6020` raw 138605-138612；用同步写的 `loadedId` 区分"从未装载"与"装载在途"） | 13（`0xb4`、`0xbb`/`0xbc`、`0xc2`、`0x1bc`、`0x1c9`、`0x14d`×2、`0x19e`×2、`0x1ae`、`0x1af`） | 8（`0x14c`×4 ⇒ 清空升 `implemented`；`0x19e`×2；`0x1ae`×2） |

**代码单元与红→绿**（两处都带命名守卫）：

- A：`src/vm/handlers/msgwin.ts`（`op_show_text` 与 `op_display_furigana` 各加"本行有内容"门）+ `test/op-3-004-furigana-outer-gate.test.ts`（+2 命名守卫）；两处门同时降级 ⇒ **10 tests / 8 pass / 2 fail**，恢复 ⇒ **10/10**。
- B：`src/audio/audioEngine.ts`（`sePlay` 的"从未装载 ⇒ 拒播"分支）+ `test/audio-engine.test.ts`（命名守卫「0xB5/0xBA：通道从未装载 ⇒ 拒绝起播并报 `dsPlay`」）；摘掉修复 ⇒ **32 pass / 1 fail（33 例）**，恢复 ⇒ **33/33**。

**主 agent 的合并动作与冲突裁决**：

1. **重复 `raw` 合并**（数据卫生）：实测 5 个条目同一条目内 `raw` 重复（`0x2be`/`0x2f6`/`0x1f9`/`0x249`/`0x19e`）——`mutate.deleteRaw` 按 raw 删**全部**同 raw 项 ⇒ 将来"关一条"会误删多条。我先合并了不在 A/B 范围内的 4 个（`what` 逐字拼接，`missing` 141 → 136）；`0x19e` 留给 B 的批次（B 落库后**全表已无重复 raw**）。
2. **落库顺序**：主 agent `merge` 后串行落 B 的计划（A 已自行落库）⇒ 终态 `missing` **118**、`implemented` **60**、`partial` **85**（entries 181 不变；`missing` 由 141 净减 23）。
3. **两份裁决在 `0x1d1` raw 80683 上冲突**：A 判 ②「需跨文件」，B 判「最小修法 = 调用点改读 `FIELD_VOICE_BUSY`，一行」。主 agent 读代码后订正：B 指的那一行**确实存在**（`msgwin.ts:1303` 的 `voiceBusy: false`），但**接上它零可观测差异** —— `textItems.ts:448` 的 `suppressed` 只进 `page.voiceIcons`，而该数组**无消费者**（只有 `page.lines` 经 `setPageText` 发布）⇒ 缺的是**语音图标绘制层**，故仍判 ②，`what` 写成「输入侧一行可达 + 真正缺消费者 + 两件事一起做」的两条重开条件。
4. 路径口径订正（记下来免得下次再找错文件）：真实路径是 `src/save/saveSlot.ts`、`src/save/saveData.ts`、`src/vm/handlers/save-slot.ts`（**没有** `src/vm/saveSlot.ts` / `src/vm/saveData.ts`）。

**判绿（合并后）**：`typecheck` + `typecheck:test` 干净；全套 `test/run.ts all` ⇒ **tests 1634 / pass 1629 / fail 3 / skipped 2**（3 条 = `T-0146` 基线，未动）；`test/opcode-gaps.test.ts` 6/6；四份 `--validate` + 五份生成物 `--check` + `check:dead-writes`（无新增）+ `fix-lines`（0 漂移）全绿。

## §16 第二波并行裁决（第 63 轮）：C = renderer/scene/3D/绘制项、D = vm 核心/操作数/控制流/字段/存档

两族代码面互斥（C：`src/renderer/**`+`src/live2d/**`+`gfx-*`；D：`src/vm/**` 核心与 `control/memory/arithmetic/engine-fields/input/shared`+`src/save/**`）。台账终态：**missing 118 → 111**（`partial` 85 → 83、`implemented` 60 → 62；entries 181 不变）。

| | 处置 | ① 实现 | ② 结构性不适用（重写 `what`） | ③ 删陈旧 |
|---|---|---|---|---|
| **C** | 11 条 / 7 opcode | `0x202`（颜色窗 `dur > 0` 门）、`0x320`（`makeMesh` 两格态色初值 `0xFFFFFFFF`） | `0x22d`/`0x22f`、`0x234`、`0x34f`、`0x229`、`0x320`(另一条) | `0x202`、`0x32d`、`0x320` |
| **D** | 15 条 / 11 opcode | `0x93` 系的游标移动子步（`RoutePanel.moveCursorByKey` + `InputManager.consumeKeyBits`，方法级） | 8 条（`0x2d4`、`0x61`、`0x97`、`0x100`、`0x5`、`0x259`、`0x1d1`、`0xff`） | 4 条（`0x2f6`×2、`0x2f8`、`0x147` 那格） |

**代码单元与守卫**：

- C：`src/renderer/drawitem/animWindow.ts`（`winPhase`：`W_COLOR && dur <= 0 ⇒ none`）+ 守卫 `test/op-202-color-window-dur-gate.test.ts`（摘掉 ⇒ 1 fail/2 → 2/2）；`src/renderer/drawitem/model.ts`（`makeMesh` 初值）+ 守卫 `test/scene-320-mesh-initial-state.test.ts`（改回 0 ⇒ 2 fail/2 → 4/4）。
- D：`src/vm/route.ts`（`moveCursorByKey(mask)`，逐位照体 + `[960] != 0` 只门控翻页两支）、`src/vm/input.ts`（`consumeKeyBits`）、`src/vm/handlers/arithmetic.ts`（`cFmod` 保留为定义式）；守卫 `test/op-2d4-fmod-and-panel-cursor-key.test.ts` **5/5**。

**★两处主动撤回（D 实测后自我推翻，值得记下来当范例）**：

1. `0x147`/`0x93` 的「游标移动子步」原计划**接进显示态泵**（`handlers/panel.ts`），实测后撤回：`sub_403DD0` 的**唯一**调用点 `sub_4098E0`（raw 14065）的三条出口（点击 / 回退 label / 悬停）**没有一条读按键掩码**，键命中 `sub_403D70` 只在等待泵 `sub_411BC0`（raw 20242）⇒ 接上去**零可观测差异 = 假实现**，按三态过滤归②；最终只留方法 + 方法级守卫，`panel.ts` 只剩注释。
2. `0x2d4` 原条目称「emulator 用 `l % r`、引擎是 `fmod` ⇒ 负被除数分叉」——D 逐例实测后判定**该例子算错了**：`fmod(l,r) = l − r·trunc(l/r)` 且 `trunc` 是奇函数 ⇒ 与 JS `%` **逐值相等**（含 `fmod(x,0)` 两侧同为 NaN），**不存在分叉输入** ⇒ `what` 重写成「为什么不存在分叉 + 重开条件」，守卫改为钉「与 `%` 逐值相等 + 定义式两条性质」。

**主 agent 的合并动作与流程修正**：

1. **计数对账**（我此前观测到 missing 比预期多减 2）：D 澄清它**已自行落库 5 次**（`plan-D.json` + `plan-D2..D5.json`），净 −2（删 4 加 2）⇒ 118 −2(D) −5(C) = **111** ✓，不是重复扣。因 `ledger-set.mjs` 每次读当前文件，D 的写入在我的 C 落库中被完整保留。
2. **我自己的红**：第 62 轮那次 `0x1d1` 改写里用了「订正」，随生成物进 `docs-new/03-engine/opcode-gaps.md:188`，被 `test/doc-model.test.ts` 的 A4① 判红（我当时只跑了 `opcode-gaps.test.ts`，没重跑全套 ⇒ 逃过一劫）。本轮已把该 `what` 重写成「只陈述仍未落地的部分 + 重开条件」、沿革移入 `journal[]` ⇒ `doc-model` **10/10**；并复扫全表：**渲染字段（`note`/`why`/`missing[].what`）含「订正/旧句/历史判据」= 0**。
3. **重复 `raw` 复扫 = 0**（A/B/C/D 四批之后全表无重复 raw）。
4. ★流程订正（下一波沿用）：给 subagent 的指令里必须写明**「只交 plan，不要落库」并按此验收**（本轮 D 自行落库虽未造成损失，但会让"计划 vs 现盘"对不上）；主 agent 落库前先记录一次 `missing` 总数快照，便于事后对账。

## §17 第三波并行裁决（第 64 轮）：E = renderer/纹理槽/宿主缝、F = msgwin/operand/audio 遗留

两族按边界互斥（E 拿到 `src/vm/native.ts` 写权；F 拿到 `msgwin.ts`/`operand*.ts`/`audio*` 写权，双方都被禁改对方的文件）。**本轮两族都严格"只交 plan、未落库"**（E、F 各自核了 `opcode-gaps.json` 的 SHA256 未变）⇒ §16 的流程订正生效，主 agent 串行落库零冲突。终态：**missing 111 → 107**（`partial` 83 → 82、`implemented` 62 → 63；entries 181 不变）。

| | 处置 | ① 实现 | ② 结构性不适用（重写 `what`/`journal`） | ③ 删陈旧 |
|---|---|---|---|---|
| **E** | 11 条 / 8 opcode | `0x249` raw 123375-123380（`sub_4A3800` 第 6 参 a6=1 ⇒ `v7[466] = -1`；`op_load_texture_by_id` 写 `texSlots = -1`） | 8 条（`0x1f6`×2、`0x1f8`=槽状态格 470 全库 5 写 0 读 ⇒ 死写、`0x1f9`+`0x249` 收窄到装载期色键、`0x23f`、`0x20d`、`0x21d`） | `0x1f8` raw 31171-31188、`0x1fa` raw 31245-31269（后者 `missing` 清空 ⇒ 升 `implemented`） |
| **F** | 13 条 / 5 opcode | `0x2F8`（**两处**：读序 `op1 = pan / op2 = 通道` 反了 + 设备层值域门 `a2 < 15` 而非 `#voiceChannel` 的 0..2） | 12 条：`0x82`×3、`0x1D1`×6（含 raw 81220-81224 **收窄重写**：`f132` 有读者无写者、`win+136` 无读者）、`0x196`、`0xFF`（**机械核出 `sub_419D20` = opcode 0x11F**，扫全库 495 个 `install/*.BIN` ⇒ 命中 0 处 ⇒ 运行时不可达） | 0 |

**代码单元与红→绿**：

- E：`src/vm/handlers/gfx-texture.ts`（`op_load_texture_by_id`：`texSlots.set(slot, imgid)` → `(slot, -1)`）；新增守卫 `test/op-249-slot-record-minus-one.test.ts`（「★0x249：槽记录写 −1…」「★0x249 → 0x216：读到的 imgid 是 −1…」）⇒ 红 **4 tests / 1 pass / 3 fail** → 绿 **4/4**；另 retarget `test/op-a2-a3.test.ts:397`、`test/op-underun-fixups.test.ts:136`（0x5250 → -1，锚点未删、理由写原地）。
- F：`src/vm/handlers/audio.ts`（`op_voice_pan` 读序 + 设备层值域门 + 钳制值进 emit）、`src/audio/audioEngine.ts`（`voicePan` 改吃设备通道号）、`src/vm/operandPlan.ts`（说明）；守卫「★P2 0x2f8：操作数读序 = `op1 pan / op2 通道`」「★P2 0x2f8：设备通道域 0..14」⇒ 红 **25 / 24 pass / 1 fail** → 绿 **25/25**。
- 主 agent 补收尾：F 实现了 `0x2F8` 却**漏交接台账**（其 plan 只含 5 个 op，没有 0x2f8）⇒ 我按实现证据删掉 `0x2f8` raw 139063-139089（missing 108 → **107**），该条目另一条 `missing`（raw 33638-33648，ADV 寄存分支）仍开。★这一条值得记：**"实现类"交接必须包含"删除对应 `missing` 条目"**，否则台账会留下已实现却仍挂着的条目。

**★E 顺带发现、尚未登记的新缺口（下一波开条目）**：`0x216`（`op_get_slot_imgid`）的缺省值是 `?? 0`，而引擎 `sub_499BC0`（raw 116333-116352）把 1000 格 imgid **全初始化成 −1** ⇒ 未绑定槽引擎答 **−1**、emulator 答 **0**（`src/vm/handlers/gfx-item.ts` 里「bss 0」的注释是错的）。需要 `gfx-item.ts` 写权 ⇒ 留给下一波。

**★E 推翻的一条旧推论**（避免下一波重复投入）：原文说「`0x249` 需要给宿主缝加"记录策略"参数（跨 renderer 半边）」——**不成立**：记录格是 VM 状态（`texSlots`），宿主那份是表面绑定，两者不是一回事 ⇒ `changes-texvm.md` §4 的 C2 不必执行（已记入 `0x249` 的 `journal`）。

## §18 第四波并行裁决（第 65 轮）：G = 记录驱动重画族、H = 纹理槽/绘制项/渲染对象族

两族文件面严格互斥（G：`textItems.ts`/`msgwin.ts`/`text/**`；H：`gfx-item.ts`/`gfx-texture.ts`/`gfx-state.ts`/`renderer/scene|drawitem`/`pixi/textureCache.ts`）。**两族都只交 plan、未落库** ⇒ 主 agent 串行落库。终态：**entries 182 / missing 108**（`partial` 83、`implemented` 63；`missing` 由 107 变 108 是 H **新登记** `0x216` 的 1 条）。

### §18.1 H 波：1 条 ① + 8 条 ②（含新登记 `0x216`）

- **① 实现**：`0x216`（`op_get_slot_imgid`）的缺省值 `?? 0` → **`?? -1`** —— 体证：`sub_499BC0` raw 116348 把 1000 格 imgid **逐格写 −1** ⇒ 未绑定槽引擎答 **−1**、emulator 原答 **0**；而 `i216` 后紧跟 `jcc`（`src/SN0000.txt:3129`/`:3698` 的 `ne … 0x18a9c`）⇒ 取值不同会走不同脚本分支。改动 `src/vm/handlers/gfx-item.ts`；守卫「★0x216 的缺省值 = −1」（`test/op-249-slot-record-minus-one.test.ts`）红 **4/5** → 绿 **5/5**，`test/game-start-chain.test.ts` 同步 retarget（14/14）。**台账**：本条原无条目 ⇒ 用 `appendEntries` 新登记 `0x216 = partial + 1 missing`（承接 `T-0179`）。
- **② 8 条**：`0x23f`（缺影片子对象输出尺寸；无解码器，宿主答表面尺寸是已披露近似）、`0x20d`（窗口原点在 headless/Pixi 恒 (0,0) ⇒ 加原点是恒等；比例会与 presenter 视口重复施加）、`0x21d`（两条 D3D 顶点缓冲失败路径无处理对象，网格是纯 JS `MeshObj.verts`）、`0x223`（per-slot 渲染层惰性建层/重绑；`SceneState` 无该表 ⇒ 归 `T-0091`）、`0x249` 与 `0x1f9`（收窄到**装载期色键**：`sub_48B090` 组键依赖 D3D 表面/源图位深，emulator 无；语料 op3 全动态、无一处能证明命中像素 ⇒ 补上是死写）、`0x1f6`（影片对象表逐帧老化，与 `0x23f` 是同一条链两端）。
- ★H 自审提示：它的 7 条 `mutate.rewriteRaw` 文本与 E 波（第 64 轮）判词**逐字相同/等价** ⇒ 主 agent **只落了 `appendEntries`**（新登记 `0x216`），避免对同一批条目做无谓改写。

### §18.2 G 波：10 条全判 ②，并把"记录驱动重画"拆成了可执行前置

族核心（`0x82` raw 79699-79700 的 `op3 & 1` 记录级过滤）被**实测否决**：① 过滤位 `ITEM_REFLOW` 全仓无生产者（真语料 24 样本恒 0）；② 把 `0x82` 接成记录驱动**零正差异**（记录切片行 vs `layoutWindow` 显示行 **23/24 逐字相同**）**且**有负差异面（`setPageText` 丢注音/清显现态；空切片 + op3 无 `0x40` ⇒ 照抄孪生会**清空整窗**，而唯一语料点 `src/CONFIG.txt:269` 的 op3 正是 **2**）⇒ 按 §8.18 补充判据属②。其余 9 条同判②（`win+112` 无字段无写者、`sub_4ABB60` 要改载荷契约、无 `win[56]/[70]` 栏带表、`page.voiceIcons` 零消费者、逐字 GDI 度量 vs 等宽网格粒度不同、`win+136` 无读者、换行回写需幂等）。

- **代码单元**：新增 `test/op-82-record-driven-boundary.test.ts`（T0/core/ops，3 例：★`0x82` 重画源 = 模型快照（记录切片不得参与）/★孪生对照 `0x1D1` 确实记录驱动/★空切片 + op3 无 `0x40` ⇒ 清空该窗）；红→绿：临时把 `op_gdi_repaint_window` 照搬孪生 ⇒ `run.ts fast` **1300/1298/1** → 还原 ⇒ **1300/1299/0**（`handlers/msgwin.ts` SHA 与改前逐字节相同）。另修正一处 JSDoc 事实错误（原句称「`sub_466000` 里没有这对恢复」与 raw 80239-80262 不符）。
- ★**"记录驱动重画"的可执行前置（顺序不可颠倒，下一波可直接照做）**：P0 常驻只读对照（记录切片行 vs 模型显示行，基线 **23/24**，做成棘轮）→ P1 记录表**行结构生产者**（`src/text/layout.ts` 行边界 → `pushLineFeed`，raw 81530-81553）→ P2 **幂等**回写（排版每个发布点都重算，naive 回写会重复 push）→ P3 跨窗 + 「整体替换 vs 追加」口径裁决 → P4 才轮到 `0x82` 接线（1 文件，需同批补注音/显现态守恒）→ P5 语音图标层（跨波次，需 `native.ts` + renderer）→ P6 `win+112` 专用 GDI 通路不建，等 E4。

### §18.3 本轮新发现、下一波开条目

1. **`0x82` 不恢复全局填充/描边色**：raw 80239-80262 是引擎的**恢复端**（逐格 guard），emulator 设色后**泄漏**到后续绘制（G 已给补丁形状 + 守卫设计，见 `report-G.md` §5.1）。
2. **`0x82` 不 `captureFontStyle`**（孪生 `0x1D1` 有，`handlers/msgwin.ts:1308`）⇒ 目标窗已有字体快照时，覆写色到不了载荷。
3. **`0x301` 候选 ③**（H 发现）：台账仍写「没有 0⇒默认窗映射」，而 `handlers/msgwin.ts:2196-2208` 的 `resolveWin(v)` 已实现（`T-0151` 落地）⇒ 复核后可删条目。
4. 两处**文档/任务书口径错**（已记，不改渲染字段）：F 波 journal 里 `MsgObject.dedicatedPath`/`vm/msgwin.ts:824` 实为 `f132: 0`（真实点是 `handlers/msgwin.ts:1279`）；`src/text/textLayer.ts` **不存在**（声明在 `src/text/layout.ts:141-150`、消费在 `src/renderer/pixi/textLayer.ts`）。

## §19 第五波并行裁决（第 66 轮）：I = 记录驱动重画链（P0/P1）、J = `0x82` 两个新缺口 + `0x301` 复核

两波文件面互斥（I：`src/text/**`+`textItems.ts`+`vm/msgwin.ts`；J：`handlers/msgwin.ts`+3 个测试），且**都只交 plan、未落库**（各自核了真源 SHA `CDFEDEDA…B0E623` 未变）。落库后终态：**entries 182 / implemented 64 / partial 82 / missing 108**（净不变：J 给 `0x82` 加了 1 条新 `missing`、同时删掉 `0x301` 的 1 条）。

### §19.1 J 波：两个 `0x82` 缺口**都已实现**（本轮唯一的两个代码单元）+ `0x301` 判③

1. **`0x82` 的颜色恢复端缺失**（raw 80239-80262）⇒ **实现**。体证据链完整：进门存色 raw 79509-79525；记录循环 raw 79738-79759 **逐条改全局色**（带 `&& !v158`，`v158 = a4 & 2`）；收尾逐格 guard 恢复（另有两条 +1368/+1372 不带 `|| v158`，raw 80246/80251）；孪生 `0x1D1` 早有这对恢复（raw 81470-81473）⇒ 修前 `0x82` 的设色会**泄漏**到后续绘制。
2. **`0x82` 不 `captureFontStyle`** ⇒ **真缺口，已实现**（不是"有意近似"）：`styleOfWin`（`handlers/msgwin.ts:251`）= `slot.fontStyle ?? globalFontSnapshot` ⇒ 已有快照时覆写色到不了载荷；且 `test/config1-chain-advreturn-real.test.ts:72` 实测要求「`i082` 用重派生后的**实时白**重画」。★落地形状是两处踩坑后的定稿：**不能**直接 `captureFontStyle`（会顺带重钉排版量）、也不能把临时快照留到发布后（`config1Chain.restyleByI082` 在 `msgWinSync` 回调里读 `slot.fontStyle`，`:73` 要求 `snapshot === false`）⇒ 新增 `emitWinWithColorOverride` + `winPayload`：先算好本次载荷样式、**不动** `slot.fontStyle`、再发回调。
3. **`0x301` = ③ 陈旧条目**：`op_msgwin_slot_clear` 已用 `resolveWin(v)`（raw 10748-10749）+ `objectAt(w)`（raw 10750），守卫 `test/t0151-msgwin-vm.test.ts:210` ⇒ **删该 `missing` + `disposition` 升 `implemented`**。
4. **代码与红→绿**：`src/vm/handlers/msgwin.ts`（进门存 `savedFill/savedOutline`、收尾 `if (overrideColors)` 写回/删除；新增 `applyOverrideColor`/`winPayload`/`emitWinWithColorOverride`；订正两处 JSDoc）+ `t0151-msgwin-vm.test.ts`（+2 例）、`op-0104-gdi-repaint.test.ts`（②/③ 改为「发布点上=覆写色 + 收尾恢复」）、`recall-page-0x1d1.test.ts`（⑤/⑤b 的「与 `0x82` 的分叉」文案**已不成立** ⇒ 改为「孪生两条同一条不变量」，并删掉随之无用的 `bgr` 辅助）。逐守卫隔离：摘恢复端 **2 fail / 22 pass**、摘「覆写色进本次载荷」**1 fail / 23 pass** ⇒ 绿 **24/24**。
5. **台账登记方式**（记下来供后续波次用）：`0x82` **已在册** ⇒ `appendEntries` 被去重键挡住（报「有 1 条 opcode 已存在」）⇒ J 改用 `set.missing`（既有 3 条逐字搬运 + 追加 1 条 raw `80239-80262`）+ `add.journal`；`0x301` 用 `unset.missing` + `set.disposition`。★**待补工具**：`ledger-set.mjs` 目前没有「给在册条目追加一条 `missing`」的算子（`mutate.deleteRaw/rewriteRaw` 只改不增）。

### §19.2 I 波：P0 交付、P1 **正确地没有硬做**

- **P0（交付）**：新增守卫 `test/record-driven-lines.test.ts`（corpus 档 3/3 绿）——合成侧：`defaultWinStyle()`（800 宽/30 字号）+ 60 全角字一次 `pushRenderedRow` ⇒ 模型 `layoutWindow` = **3 行 `[26,26,8]`（60 字）**，而记录侧 = **1 行**、`flags & 8` 换行记录 **0 条** ⇒ **字全、行结构缺**（引擎 raw 83094 的自动换行 push 点无生产者）；显式断行两侧逐字一致。真语料（序章连续 24 条消息）**23/24 逐字相同**、`ITEM_REFLOW` 合计 **0**、唯一差异 = 切窗形态（按窗过滤后记录侧为空）⇒ **独立复算与 G 波吻合、无新缺口形态**。
- **P1 未落地（并给出严格理由）**：引擎换行记录是**逐显示行** push（raw 83094 / 82667），而 emulator 的记录**粒度 = 一次 `i06e`** ⇒ 只加 `pushLineFeed` 调用点会造出「一行正文 + 一条换行」的错配，污染 `0x1d0`/`0x1d3` 读的**持久账本**；要正确就得把正文记录按排版行拆开 = **改页表半开区间 = 新语义**；且排版在发布点重算、窗几何可变，而引擎换行在入队时定死 ⇒ **幂等回写无锚点**。守卫的 ① 已预置为 P1 的红→绿落点（接上后 `lines` 1→3、`feeds` 0→2）。
- **台账**：`plan-I.json` 单 op —— `0x1d1` raw `81530-81553` 的 `what` **尾部追加 1163 字**（两条实测 + 三条阻塞）+ 1 条 journal（三态维持 ②）。
- ★**下一波的唯一入口**（要点）：先裁决「**记录粒度是否改为逐显示行**」（含 `0x1d0`/`0x1d3`/`0x1d4` 的兼容口径 + 一条「页起点 == 该页首条正文记录下标」的守卫），才谈 P2 幂等键 → P3 跨窗「整体替换 vs 追加」口径（`src/CONFIG.txt:269` 的 op3=2 不带 `0x40`）→ P4 `0x82` 记录级接线（须同批补注音/显现态守恒）。

### §19.3 本轮流程经验

- **验证必须串行跑全套**：J 实测「并行跑多个 `test:all` 会把 `config1-chain-*` 真语料链路拖到 90 s+ 而超时」⇒ 主 agent 只在所有 subagent settle 之后跑一次全套。
- **`appendEntries` 只适用于"新 opcode"**；给在册条目**追加** `missing` 目前只能靠 `set.missing` 搬运（易漏抄）⇒ 记入待补工具清单。
- **超清单改动要复核**：J 改的 `test/recall-page-0x1d1.test.ts` 不在其显式清单内，但它是因为「`0x82` 恢复端落地」使原文案（"与 `0x82` 的分叉"）**前提被取代** ⇒ 属 §4 第 2 条的正当路径；主 agent 已用 `git diff --stat` + 逐行复核（33 行改动：文案 2 处 + 删 1 个无用辅助）。

## §20 第六波并行裁决（第 67 轮）：K = 记录粒度裁决 + 页起点守卫、L = 影片子系统 + renderer 剩余

两波文件面互斥（K：`src/text/**`+`textItems.ts`+`msgwin.ts`+`handlers/msgwin.ts`；L：`src/renderer/**`+`gfx-item|texture|misc|state.ts`），**都只交 plan、未落库**（各自核了真源 SHA `C1F0C7C2…96B0CD` 未变）。落库后终态：**entries 182 / implemented 64 / partial 82 / missing 108**（两波都只改判词/note/journal，不增删条目）。

### §20.1 K 波：粒度**不改为逐显示行**（②），但交付了一条真守卫

**裁决依据三条**（都读体 + 实测）：

1. 引擎的自动换行在 `repaintRange` 里**不产生新行** —— 连续 `flags & 4` 记录被 `memcpy` 拼成一行（raw 80731-80752），切行只由 `flags & 8` 触发 ⇒ **拆记录本身不改任何已发布的行**；有收益的只是「在排版断点补换行记录」。
2. 真语料补断点**零正差异**（24 样本 23/24 逐字相同、`ITEM_REFLOW` 合计 0）。
3. 断点必须在**入队那一刻**定死（`sub_46AF90` raw 82684-82687 在那一刻累加 `win[12]-20/-16`、`++win[136]`、`++win[71]`），而 emulator 的窗几何在发布点可被 `i070`/`i1c1` 改写**且不入** `FontStyleSnapshot`（`layout.ts:175-187`）⇒ 复刻要先造「入队时刻几何快照」= 新语义。

★**体证更正 I/G 波的一处口径**：`flags & 8` 的唯一常态生产者是 `sub_46AF90`（唯一 push raw 83094；被 `sub_46BE30` 以两种语义调用：字符循环内换行 raw 83705 + 循环收尾 raw 84015）；而 `i06f end-text-line` 走的 `sub_4691D0`，其 push 带门 `v5[28] == 1`（专用 GDI 路径）⇒ **引擎常态下 `i06f` 不 push 记录**，emulator 的 `pushLineFeed` 是近似。★另：波 I/G 把目标写成「记录行数 == 排版行数」是**错目标** —— 引擎每条显示行带一条**尾随** `row-line`。

**交付的真代码单元**：`TextItemTable.pageIndexGaps()`（`src/vm/textItems.ts`）—— 页起点不变量的守卫。★口径是**按窗 + 按页区间**（页 i 的 `start` 到下一页 `start` 之间，本窗第一条记录必须落在 `start` 上且带 `ITEM_GROUP_START`；外加页起点单调不减），**不是**「起点记录属于本窗」—— 后者在真语料上出 **27 条假违规**（记录表全窗共用、`0x70` 也 push 页：51 页里 27 条同 `start`、27 条空页）。红→绿：错误口径 **27 违规** → 正确口径真语料 **0/24 采样**；`record-driven-lines.test.ts` **5/5**（新增 2 例 + 2 反例必须报违规）；`fast` **1302/1301/0**；`corpus` 357/353/3（= 既有基线）；`all` **1659/1654/3**。
**波及读者清单**（结论：接口面**不需要**改）：`0x1d0` `pageAt`（越界/掩码门读 `records[start].flags`）、`0x1d1`/`0x82` 的 `repaintRange`（lines 载荷）、`0x1d3`/`0x1d4`/`0x2f3`（只匹配文本项/语音项）、回看页表 `advState`（records 先装、pages 后装 ⇒ 顺序安全）、`moveCursor`（只读 `pages[].start`，产品消费者 `engine.ts:1653`）。

★**P1–P4 可执行前置（顺序不可颠倒，下一波照做）**：

| 步 | 做什么 | 落点 | 验收/守卫 |
|---|---|---|---|
| **P1a** | `FontStyleSnapshot` 补**窗几何**（originX/Y、wrapRight/wrapBottom、w/h、x/y） | `src/text/layout.ts` + `handlers/msgwin.ts` | 「`i06e` → `i070`（改几何）后该页切片行不变」 |
| **P1b** | `layoutWindow` 暴露「段→行边界」 | `src/text/layout.ts` | 「两段各溢出一次 ⇒ 段1断点 = 其显示行数−1」 |
| **P1c** | 在 `i06e`/`i196` **入队点**按边界拆 rows（N 行 ⇒ N 条 `flags&4` + N−1 条 `flags&8`，顺序照 `sub_46AF90`「先推进后画」） | `handlers/msgwin.ts` | `record-driven-lines.test.ts` 第①例**先红**（今天断言 `lines.length===1`/`feeds===0`），改判据为 `lines` 逐字等于 model |
| **P2** | 幂等（靠 P1a 快照 + 入队点一次性 push，**不靠水位**） | 同上 | 同一页发布 3 次 ⇒ 记录条数不变 |
| **P3** | 跨窗「整体替换 vs 追加」口径 + 守卫（唯一语料 `src/CONFIG.txt:269` 的 `op3=2` 不带 `0x40` ⇒ 照抄孪生会先清空再重画） | `handlers/msgwin.ts` | 口径守卫 |
| **P4** | `0x82` 记录驱动接线（1 文件）+ **注音/显现态守恒**（`setPageText` 写 `ruby:[]`、`reveal.delete`） | `handlers/msgwin.ts` | `op-82-record-driven-boundary.test.ts` 第1条改向 + P0 差异数不增 |

★另留一条：`0x6F` 的 `pushLineFeed` 与 P1 的断点生产者**会重叠**，动手前先裁决"谁取代谁"。

### §20.2 L 波：影片子系统整体判 **不做（②）**，并修正 `0x236` 的口径错

- **判据不是「解码器贵」**：引擎侧确实是一整条链（`0x20F`/`0x236` 惰性建 CMovieToTexture `0x480` → `sub_488DC0` 装载 → `sub_489230` 起播 → 主循环 `sub_4080B0 <= sub_408130` 判结束并析构 → `0x23F`/`0x23E` 读尺寸/时长）。但真 `play-movie` 只有 **5 处**（`LOGO:52`/`OP:12`/`ED:13`/`ED2:13`/`HMODE:1082`），其中 **4 处紧跟 `detach-texture`/`release-texture`/`exit`、无一处读结束事件或尺寸**；`0x23F` 的 3 处配的是 `0x236`，而 **`0x236` 根本没注册** ⇒ 那 3 处也到不了 ⇒ **「补上能改变哪条判定」答案 = 今天一条都没有**。
- **★`0x236` 的 note 口径错**（已用 `set.note` 修正）：原写成「网格对象族」，实际对象大小 `0x480` + 构造函数 `sub_489040` 与 `0x20F` **同一套影片对象**，两处抛错串是 `asc_51F560`（ムービー…）/`asc_520248`（…テクスチャ…）；mesh 的错串在 raw 33994 的 `sub_408050`（`メッシュファイル…`）。
- **重开条件（含 E4 采样项）**：E4-1 = 在 `LOGO.txt:52`/`OP.txt:12` 的 `play-movie` 后「仍在播时」读 `i23f` 记引擎答值、播完后再读一次记是否变 0 或 −1；E4-2 = 采样证明 `Engine[675972]` 播完后真被清 0 且 `set:DependMovieSound` 跟随门有可观测后果；E4-3 = 验证清单出现 require 影片像素项。**若做，S1–S5 分步**（S1 `slotSurface.ts` 的 `SlotNode` 加输出尺寸/时长 + 两宿主同步；S2 结束事件与老化接 `0x1F6`/`Engine[675972]`；S3 注册 `0x236`；S4 解码/像素路径；S5 `0x23F`/`0x23E` 换真值）。★不许只做 S1 的一半（只补尺寸不补时长）。
- **L 波新登记的一条判词**：`0x20F`（raw 20660-20694）生产端已有（`op_play_movie` 写 `Engine[675972]=1`），缺的是引擎 raw 20681/16973 的**清零端**，而唯一语义读者（跟音门）无消费端 ⇒ 恒定 1 今天不可观测（`what` 已按此重写）。
- L 波还有 3 条"空手/不动"：`0x2bd` 台账**无条目**（无从裁决）、`0x258` 判词与代码一致（有意不动）、`0x23d` 已 `implemented`、`0x23e` 无在册 `missing`。

## §21 第七波并行裁决（第 68 轮）：M = 记录驱动链 **P1a→P1c 全部落地**、N = 杂项族清扫

两波文件面互斥（M：`src/text/**`+`textItems.ts`+`vm/msgwin.ts`+`handlers/msgwin.ts`；N：`handlers/{audio,arithmetic,engine-fields,control,memory,strings,stubs,region-hittest}.ts`+`src/vm/{input,route,operand,operandPlan,ref,bits,interpreter,step}.ts`+`src/save/**`），**都只交 plan、未落库**（各自核了真源 SHA `A7A6E6FE…AC9A527` 未变）。落库后终态：**entries 182 / implemented 65 / partial 81 / missing 108 → 105**。

### §21.1 M 波：§20.1 的 P1a → P1b → P1c **三步全部落地，无阻塞**（本轮唯一的代码单元）

| 步 | 状态 | 落点 | 守卫 | 关键实测 |
|---|---|---|---|---|
| **P1a** | ✅ | `src/text/layout.ts`（`FontStyleSnapshot.geometry` / `MsgGeometrySnapshot`）+ `handlers/msgwin.ts`（`liveGeometry`、`captureFontStyle`、`styleOfWin` 优先取快照） | 「`i06e` → `i070`（窗宽 800→400）后该页切片行不变」 | 记录表 5 条**逐字不变**、切片 `[26,26,8]` 不变、快照 `wrapRight=800` / 窗字段 `400` / 载荷 `800` |
| **P1b** | ✅ | `src/text/layout.ts`：`TextFrame.rows: TextRow[]`（与 `lines` 逐项对齐）+ 纯函数 `rowFeedBoundaries`；为让 segment 下标不错位，`wrap()` 从段循环收尾**移进段内**并清掉 `flush()` 的尾随空行（等价性：既有 77 例 layout/msgwin 测试全绿） | 「两段各溢出一次 ⇒ 段 1 断点 = 其显示行数 − 1」 | 4 段用例：`rows=[0.0,1.0,2.0,2.1,3.0]`、`lines=[1,6,26,26,1]`、断点**恰好 `[2]`** |
| **P1c** | ✅ | `handlers/msgwin.ts`（`recordRenderedRow` 一条显示行一条记录 + 断点 `pushLayoutLineFeed`，顺序照 `sub_46AF90`「先推进后画」）+ `vm/msgwin.ts`（`MsgSegment.recordedChars` 增量游标；**不加它会重记前一次的行** —— 实测真语料相同数掉到 **19/24**） | `record-driven-lines.test.ts` 第①例**先红后绿** | 一次 `i06e` 给 60 字 ⇒ 记录表 **3 正文 + 2 换行**（修前 1 + 0）；`repaintRange` 切片 = `["26 字","26 字","8 字"]` = 模型 |
| 顺带 | ✅ | `op_end_text_line` 同边界**去重** | —— | 解决 §20.1 留的「`0x6F` 的 `pushLineFeed` 与 P1 断点**谁取代谁**」 |

- **红→绿证据**：旧判据 `lines.length===1`/`feeds===0` 在 P1c 落地后当场变 **3/2** ⇒ 红；改判据为「`lines` 逐字等于 model」⇒ 绿。`fast` **1302/1301/0**、`corpus` 361/357/3（= 既有基线）。
- ★**当前语料零可观测差异**（诚实披露）：真语料 24 样本未过滤/按窗过滤均 **23/24**、`ITEM_REFLOW` 0、51 段全为**单**显示行 ⇒ 新增换行记录 **0 条**。这一步的价值是**结构对齐**（为 P2–P4 开路），不是立刻改画面。
- **台账**：`0x1d1` raw `81530-81553` 判 ①（`what` 尾部追加 1930 字：三步落点 + 实测 + 对外语义检查）+ `set.note` 逐字搬运 + journal 1 条。
- **P2/P3/P4 未开始**：P2 的判据（同一页发布 3 次 ⇒ 记录数不变）**今天已成立** ⇒ 下一波第一件事 = **给它补守卫**（不需要新语义）；P3 要先写死 `src/CONFIG.txt:269` 的 `op3=2` 替换/追加口径；P4 才动 `0x82` 接线 + 注音/显现态守恒。

### §21.2 N 波：17 条杂项清扫（3 删 + 1 升位 + 13 收窄）

- **③ 陈旧删除**：`0x2be` raw `33411-33420`（「漏第二个字重格」与工作树**相反**：`op_set_ruby_bold` 同写 `rubyWeight 75971` + `logfontRubyWeight 21651`，守卫 `t0151-msgwin-vm.test.ts`）、`0x6e` raw `28339-28343`（门关支接线错已修：`advanceReveal` 门关只清 0，`skipMode` 分流在门开支）、`0x2f8` raw `33638-33648`（ADV 寄存分支在 VM 字段面已落地）⇒ **该条 `missing[]` 清空、处置升 `implemented`**。
- **② 收窄/前提变更 13 条**：`0x2be` `71212`（GDI 面重建门，零差异）、`0x2f6` `33676-33693`（VM 四格已落地，缺宿主设备通道 15..26）、`0x6e` ×2、`0x133`/`0x134` ×3（**引擎错误串走宿主消息层，emulator 的 `c.log` 经 `NativeBridge.log` 等价**；空队写未初始化局部不可照抄）、`0x97`、`0x5`、`0x9` ×2（`Stack_int` 族语料 `i137=1`/`i138=0` ⇒ 建模只会造**无生产者的死写**）、`0x2c8`、`0x32e`、**`0x2e9`（★前提变更）**：`Engine[122501]` = `voiceRegSingle` 现由 `op_play_voice`/`op_voice_reset` 写入、`#serviceAutoMessage` 读取 ⇒ 不再恒 0；真缺的是「忙那一支」的三条队列同步回读 + 重臂。
- **无代码改动**（20 个点名 opcode 里没有 ①真缺口）⇒ 无红→绿；N 用「模拟应用 + 模拟生成 md」离线核对了 `opcode-gaps` 棘轮（0 problem）与 `doc-model` 禁词（0 命中）。
- ★**工具发现**：`ledger-set.mjs` 够不到**顶层 `counts`** 字段 ⇒ N 另给了 `plan-68-counts.json` + `apply-counts-68.mjs`（主 agent 已按其结果刷 counts：`implemented 64→65 / partial 82→81`）。**待补工具**：把 counts 刷新并入 `ledger-set.mjs`（或让 `build-opcode-gaps.mjs` 顺带回填）。
- **N 的需跨文件遗留 2 条**：`0x100`（要改 `handlers/input.ts` + `test/op-a5.test.ts:161/169` 两处断言）、`0x5`（等待泵补 `push`，跨文件）。**未处理**：`0x1b0`/`0x148`/`0x32c`/`0x30a`/`0x1d2`（复核后判词无需改）；`0x2be` 新发现的帧状态槽 `95805=3`（按 `0x30a`/`0x2fa` 口径不建议登记）。
