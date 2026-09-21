---
kind: record
state: consumed
superseded_by: analysis/opcode-gaps.json
---
# 天結いキャッスルマイスター — opcode 审计报告（2026-09）

**审计范围**：本作 dispatch 表全部 1024 格中被抽查的 574 个 opcode（分片 op-1..op-10，合计 checked = 574），逐条比对三方：引擎反编译 `engine/天结_unpacked.exe_utf8.c`（唯一权威）、文档 `docs-new/03-engine/opcode-table.md` + 生成的 `scripts/asm/opcodes.json`、实现 `app/amayui-emulator/src`；语料用量统计自 `src/*.txt`。

**方法一句话**：先按字节基址 675996 + 4*op 从构造函数独立复算 handler 归属，再用 read 逐条读 handler 体、用 grep 复核字段读写点、用 emulator 三张注册表（OPS / NATIVE_OPS / ENGINE_INTERNAL_OPS）与语料计数交叉验证；每条 finding 再经一轮对抗性复核（.tmp/audit2/op-1..10-verify.json），verdict=refuted 一律剔除。

**落库产物**：机器可读清单 `.tmp/audit-final-opcodes.json`（严格 JSON），本报告为对应的人读版。

---

## 结论速览

### 统计

| severity | 条数 |
| --- | --- |
| P0（emulator 可见表现） | 2 |
| P1（引擎语义错） | 8 |
| P2（边界缺口） | 28 |
| P3（文档记账） | 57 |
| 合计保留 | **95** |

| kind | P0 | P1 | P2 | P3 | 合计 |
| --- | --- | --- | --- | --- | --- |
| contradiction | 0 | 0 | 6 | 11 | 17 |
| cross-source-mismatch | 0 | 0 | 2 | 9 | 11 |
| gap-as-noop | 2 | 8 | 9 | 5 | 24 |
| host-invented | 0 | 0 | 4 | 3 | 7 |
| name-inference | 0 | 0 | 0 | 1 | 1 |
| no-evidence | 0 | 0 | 0 | 4 | 4 |
| overreach | 0 | 0 | 4 | 21 | 25 |
| unclear | 0 | 0 | 3 | 3 | 6 |
| 合计 | 2 | 8 | 28 | 57 | 95 |

复核通过率：输入 122 条 finding，`verdict=refuted` 9 条（7.4%）被剔除，其余 113 条经复核后合并去重为 95 条；复核对 10 条给出 `correctedKind`/`correctedSeverity` 修正，已按修正值入账。

### 最严重（P0/P1）摘要

1. **P0 `op-2-01`** — 0x2E9（`i2e9`，语料 480 处 / 330 脚本）在 emulator 三张表里都没有；体写 `_this[122464]`（时间基准字段，7 个读点）⇒ 命中即抛 `NotImplementedOp`，ADV 主流程直接停。
2. **P0 `op-4-01`** — 0x228（`i228`，语料 1097 处）是会回写 op1/op3/op4/op5 的 getter，emulator 未实现 ⇒ 紧随其后的 `eq`/`jcc` 读陈旧值，分支走错。
3. **P1 `op-7-0x20b-doc-semantics-but-unimplemented`** — 0x20B 文档标「已核对」但 emulator 三表全无该条，语料 204 处 / 187 文件，命中即 `NotImplementedOp`；同类未注册缺口（0x235 = 158 处、0x028 = 32 处、0x132/0x133、0x0C1/0x2CF/0x32E、0x7C = 668 处）一并归入。
4. **P1 `op-3-002`** — 0x243（`i243`，341 行 / 338 文件）、0x233、0x23A（回写 op1）、0x337 四条 emulator 无注册且无缺口登记 ⇒ 命中即整轮硬停（`run.ts` / `renderer/app/session.ts` 均终止）。
5. **P1 `op-3-003`** — 0x307 是 0x306 getter 的唯一写入端（`SetConfig("system:EffectSkipOnClick")`），emulator 只登记了 getter ⇒ 脚本设过的值读不回来；语料含开机写入 `INITREGINPUT.txt:6`。
6. **P1 `op-2-02`/`op-2-03`/`op-2-04`/`op-4-04`/`op-1/0x191-fabs-missing`** — 0x23F（回写 op1）、0x1D1（GDI 文本绘制）、0x32C（3D 天气 6 浮点）、0x025（STAGERAID 4 处）、0x191（`op1=|op2|`，13 处）五条均为「引擎有体、emulator 零注册」⇒ 命中即停或按桩跳过留下陈旧操作数。

---

## P0 逐条

### op-2-01 — 0x2E9 未实现，ADV 时间基准字段永不写入

**声明**：0x2E9（745，sub_426620）在 `opcode-table.md:487` 只标「仅映射」、语义列空；emulator 三张注册表都没有它，语料 480 处 / 330 个脚本使用 `i2e9`。

**实际**：handler 体 raw 33580-33587 真实写引擎字段：`result = sub_41BF50(_this, 1); _this[122464] = result;`（= 字节 489856），且该字段有 7 个读取点（raw 20392、20420、28569、28579、13714、13720 用它做时间基准，复位路径 raw 17987 清 0）⇒ 不是「只写不读」的观测等价 no-op。emulator 全库搜不到 `0x2e9` / `745` / `122464`，命中即 `interpreter.ts:166` 抛 `NotImplementedOp`。

**证据**：`engine/天结_unpacked.exe_utf8.c:33580-33587`（体）、`:23182`（注册 678976 = 675996+4*745）、`:17987`、`:20392`、`:20420`、`:28569`、`:28579`、`:13714`、`:13720`；`app/amayui-emulator/src/vm/interpreter.ts:162-166`；`app/amayui-emulator/src/frame/loop.ts:218-222`；`src/$1$SC0330.txt:18203-18205`；语料 `^\s*i2e9\b` = 480 行 / 330 文件。

**建议处置**：补 `[0x2e9, op_store_field_122464]`（读 op1 写 `ENGINE_FIELD.msgTimeBase = 122464`）；该字段被 6 处当时间基准读，不能按 no-op 桩处理。

### op-4-01 — 0x228 getter 未实现，脚本分支读到陈旧操作数

**声明**：0x228（552，sub_430650）在 emulator 无实现，但它是会回写操作数的 getter，语料 1097 处且每次都被脚本立即分支读取。

**实际**：handler 体 raw 39973-39988：`v2 = readInt(2); if (!sub_4AA060(Scene, v2, &v6, &v5, &v4)) return writeInt(1, 1); else { writeFloat(3, v6); writeFloat(4, v5); writeFloat(5, v4); return writeInt(1, 0); }` ⇒ op1 = 成功标志、op3/op4/op5 = 三个 float。语料 `i228` = 1097 处，`src/SC0500.txt:1359` 紧接着 `eq (local-int 0) (global-int 1396) 0` 读的正是 op1 槽。emulator 全树 grep `0x228` = 0 命中 ⇒ 命中即 `NotImplementedOp`（`renderer/app/session.ts:466-485` 停在原地等人工桩跳），op1/op3/4/5 保持旧值。

**证据**：`engine/天结_unpacked.exe_utf8.c:39973-39988`；`docs-new/03-engine/opcode-table.md:384`；`src/SC0500.txt:1358-1360`；语料 `^\s*i228\b` = 1097；`app/amayui-emulator/src/vm/interpreter.ts:166`；`app/amayui-emulator/src/renderer/app/session.ts:466-485`。

**建议处置**：按体实现 0x228：op1 = (`sub_4AA060` 失败 ? 1 : 0)，成功时 op3/4/5 = 三个 float（场景查询；缺省全 0）。

---

## P1 逐条

### op-7-0x20b-doc-semantics-but-unimplemented — 一批「已核对/仅映射」opcode 在 emulator 里零注册，命中即硬停

**声明**：0x20B 被 `opcode-table.md:355` 标为「已核对」并给出细节语义，但 emulator 三张 OpTable 都没有它；同类未注册缺口：0x235（158 处 / 52 文件）、0x028（32 处 / 15 文件）、0x132/0x133（5/10 处）、0x0C1/0x2CF/0x32E（各 1 处）、0x7C `local-ret`（668 处 / 334 文件）。

**实际**：`handlers/*.ts` 里 332 个 `[<数字>,` 表项键中无 523（0x20B）、无 565、40、306、307、193、719、814、124；全仓 grep `0x20b` 只有 `tools/opInventory.ts:67` 的展示表 ⇒ `interpreter.ts:162-166` 抛 `NotImplementedOp`（renderer 会话是停下等桩，不是静默跳过）。语料 i20b = 204 处 / 187 文件（DRAWMINIMAP 14、INFOFA 4、`$1$SC0330`/SC0820/SC1820…）。另 doc 括注「op4=op2+宽」与体不符：raw 31581-31584 是 `v9 = op2 + op4`、`v10 = op3 + op5` ⇒ op4/op5 是宽/高。0x7C 缺口已在 `docs-new/03-engine/flow-control.md:427` 披露。

**证据**：`app/amayui-emulator/src/vm/handlers/index.ts:44-84`；`app/amayui-emulator/src/vm/interpreter.ts:61-68,162-166`；`app/amayui-emulator/src/renderer/app/session.ts:224,467-469`；`engine/天结_unpacked.exe_utf8.c:31569-31592`、`:32203-32219`（0x235）、`:27500-27514`（0x028）、`:30647-30699`（0x132/0x133）、`:24831-24842`/`:33477-33491`/`:34057-34091`、`:25778-25824`（0x7C）；`docs-new/03-engine/opcode-table.md:355,397,61,230,231,176,461,535`；语料 i20b=204/187、i235=158/52、i028=32/15、i132=5、i133=10、i0c1=i2cf=i32e=1、local-ret=668/334。

**建议处置**：按体实现 0x20B（矩形 fill + op6 钳 255 + 颜色 op7）并订正 op4/op5 括注；其余按语料量级排期补实现或显式登记缺口票（0x7C 已披露，只需按 raw 25779-25824 实现）。

### op-3-002 — 0x243/0x233/0x23A/0x337 无注册也无登记，命中即整轮硬停

**声明**：索引里这四条是「仅映射 / 已核对」但 emulator 一条都没登记，而 handler 体会回写脚本操作数（对 VM 可观测）。

**实际**：0x23A 体 raw 39990-40001 回写 op1（`v2 = _this[read(2) + 91322]; if (v2) return sub_42B4B0(_this, 1, *(v2+1068) != 0); else return sub_42B4B0(_this, 1, 0);`）；0x233 体 raw 32166-32182 读 op3/4/5 三个 float 后 `sub_4AD7B0`（图元尺寸动画）；0x243 体 raw 26016-26031 是状态门/复位；0x337 体 raw 34271-34285 为 4 参。语料 i243 = 341 行 / 338 文件、i233 = 5、i23a = 1（`src/BTL.txt:3460`）、i337 = 0。命中后 `run.ts:72-75`（CLI 路径）与 `renderer/app/session.ts:466-479`（GUI 路径）都返回 `stop` 并报致命错误。

**证据**：`engine/天结_unpacked.exe_utf8.c:39990-40001`、`:32166-32182`、`:26016-26031`、`:34271-34285`；构造表 `:23090`/`:23097`/`:23106`/`:23239`；`src/BTL.txt:3460`、`src/SC0000.txt:16195`、`src/SC0010.txt:34541`、`src/SC0500.txt:8875`/`:19414`；`app/amayui-emulator/src/vm/handlers/index.ts:44-83`（四条全无）。

**建议处置**：至少把 0x23A（回写 op1）与 0x233 补成真实现；0x243 的状态门要么建模、要么在 `stubs.ts` 里带 raw 依据登记为 engine-internal。

### op-3-003 — 0x307 是 0x306 getter 的唯一写入端，写入端整条缺失

**声明**：0x307（sub_426AE0）status 为「仅映射」，emulator 没有它；但它读写的正是 emulator 已经建模的配置键。

**实际**：0x307 体 raw 33794-33805：`(*(Engine[174405]+12))(Engine + 174405, "system:EffectSkipOnClick", v3)` = `SetConfig("system:EffectSkipOnClick")`，正好是 emulator 已实现的 0x306 `op_get_effect_skip`（`engine-fields.ts:334` → `:162-165`，注释写「纯配置 getter」）的唯一写入端 ⇒ 脚本设过的值读不回来。语料 `i307` 3 处：`src/CONFIG1.txt:2130`、`:2145`、`src/INITREGINPUT.txt:6 i307 1`。

**证据**：`engine/天结_unpacked.exe_utf8.c:33794-33805`、`:4349`（`char aSystemEffectsk[25] = "system:EffectSkipOnClick";`）、`:40953`；构造表 `:23212`；`app/amayui-emulator/src/vm/handlers/engine-fields.ts:334`、`:162-165`；`app/amayui-emulator/src/configRegistry.ts:86`；emulator 全库无 `0x307`。

**建议处置**：0x307 按 raw 33794 直写配置注册表（与 0x306 成对，写同一个 `CFG.systemEffectSkipOnClick` 键）；顺带核对 0x306 的 `cfgInt(...,1)` 回退值与 `configRegistry.ts:86` 的 `def: 0` 不一致。

### op-2-02 — 0x23F 会回写 op1，未实现时脚本读到旧值

**声明**：0x23F（575）在 `opcode-table.md:407` 只标「仅映射」；emulator 未注册；语料 3 处 `i23f`；docs/tickets 里都查不到这条。

**实际**：handler 体 raw 40019-40030 是会回写 op1 的 getter：`v2 = _this[read(2) + 94672]; if (!v2) return sub_42B4B0(_this, 1, -1); v3 = sub_4080B0(v2) * dbl_51FB50; return sub_42B4B0(_this, 1, (int)v3);`。语料把 op1 当输出用：`src/FIELD.txt:13720 i23f (local-int 80e8) 2a` → `:13721 i238 (local-int 80e8)` 消费该值；`src/BTL.txt:3843 i23f (local-ptr 0) (local-int b)` → `:3846` 起用 `(local-ptr 0)`。

**证据**：`engine/天结_unpacked.exe_utf8.c:40019-40030`、`:23102`（678296 = 675996+4*575）；`docs-new/03-engine/opcode-table.md:407`；`src/BTL.txt:3836-3847`、`src/FIELD.txt:13712-13761`；emulator 三表无 `0x23f`。

**建议处置**：实现该 getter（需要 `_this[+94672]` 对象表与 `sub_4080B0` 的量纲），或至少登记带语料锚点的缺口单。

### op-2-03 — 0x1D1 是 HISTORY 回看的数据源，未实现会让整段回看无内容

**声明**：0x1D1（465）仅映射；emulator 未注册；语料 1 处 `src/HISTORY.txt:1314`。

**实际**：handler 体 raw 29354-29371 读 5 个操作数（argc=5，raw 29364）后 `sub_4675A0((int)(_this + 21324), v2, v4, v5, v6, v7, v8)`，其中 v8 = `_this + 21032`；`_this + 21324` 是 Font 基址，`sub_4675A0` 体（raw 80313 起）确有 `SelectObject`/`CurrentObject` 等 GDI 文本绘制动作 ⇒ 属文本/字体绘制族，不是可安全跳过的内部态。

**证据**：`engine/天结_unpacked.exe_utf8.c:29354-29371`、`:22873`（677856 = 675996+4*465）、`:80313-80319`、`:80372`；`src/HISTORY.txt:1314 i1d1 (local-int 4a9) (local-int 94) 40 0 0`；emulator 全库无 `0x1d1`。

**建议处置**：按 text-items / msgwin 同族实现（HISTORY 是回看页数据源），或在 tickets 里登记并让闸门 A 显式报缺口。

### op-2-04 — 0x32C 是 3D 天气 6 浮点下发，同族已登记而它漏登记

**声明**：0x32C（812）仅映射；emulator 未注册；语料 4 处，全在 `src/SETWEATHER.txt`。

**实际**：handler 体 raw 34013-34030 读 6 个 float（argc=6，raw 34022）后 `sub_499CE0(Scene, a2, a3, _this, v5..v10)` —— 3D 效果/天气族参数下发。emulator 的 `stubs.ts:104-108` 已把同族 0x326 / 0x325 登记为 engine-internal（注释写「3D 天气/粒子效果管理器」），唯独 0x32C 全库无注册 ⇒ SETWEATHER 脚本命中即 `NotImplementedOp`。

**证据**：`engine/天结_unpacked.exe_utf8.c:34013-34030`、`:23228`（679244 = 675996+4*812）；`src/SETWEATHER.txt:18,27,69,74`；`app/amayui-emulator/src/vm/handlers/stubs.ts:104-108`。

**建议处置**：按 0x325/0x326 的方式登记（建模，或至少 engine-internal + 闸门 A 留痕），并补语料锚点。

### op-4-04 — 0x025 在 STAGERAID 路径上硬停

**声明**：0x025（37，sub_41D590）在 emulator 没有任何注册，但语料有 4 处使用。

**实际**：语料 `i025 1 2 28` 4 处：`src/STAGERAID.txt:677`/`:723`/`:883`/`:939`。handler 体 raw 27393-27430 读 op1/op2/op3：若 `effect_flags & 0x8000000` 则 `sub_441060(Engine+1978, op2, 0)`；否则置 `effect_flags |= 8`、按 op3 设节拍（`op3<=64 ? op3 : op3/16` → `sub_453A60`）、`sub_441410(...)`，并刷输入（`sub_478090` + `sub_477220`，命中则 `_this[1948] = 1`）。emulator 全树 grep `0x25` 仅注释命中 ⇒ 命中即 `NotImplementedOp`。

**证据**：`engine/天结_unpacked.exe_utf8.c:27393-27430`；`docs-new/03-engine/opcode-table.md:58`；`src/STAGERAID.txt:677,723,883,939`；`app/amayui-emulator/src/vm/handlers/stage.ts:79-81`（只有 0xd3/0xd4/0xd5）。

**建议处置**：登记 0x25 为真实现或至少 no-op 桩，避免 STAGERAID 路径硬停。

### op-1/0x191-fabs-missing — 0x191（op1 = |op2|）整条缺失

**声明**：0x191 在索引/文档里是「仅映射」、emulator 注册点为空。

**实际**：handler 体 raw 37896-37906 = `95805 = 5`（argc=2）、`v3 = sub_41C300(_this, 2)`（浮点读）、`v4 = fabs(v3)`、`return sub_42BA00(_this, 1, v4)`（浮点写，签名见 raw 37132）⇒ op1 = |op2|，纯 VM 可见计算。emulator 三张表都没有 `0x191`，而语料有 13 处 `i191`（BTL 2 / CGVIEWER 2 / FIELD 2 / INFOPL 1 / SELACT 5 / SELFORT 1）⇒ 命中即 `NotImplementedOp`，或在用户桩策略下被 no-op 跳过 ⇒ op1 保留旧值。

**证据**：`engine/天结_unpacked.exe_utf8.c:22802`（677600 = 675996+4*0x191）、`:37896-37906`、`:37131-37132`；语料 i191 = 13；`app/amayui-emulator/src` 全树无 `0x191` / `401`。

**建议处置**：在 `arithmetic.ts` 注册 `[0x191, (c) => writeFloatOperand(c.e, c.frame, c.instr, 1, Math.abs(readFloatOperand(c.e, c.frame, c.instr, 2)))]`。

---

## P2 逐条

### op-6-01 — 0x34B 的操作数类型被整体错读（delay 当缩放百分数、三个 float 丢弃）

**声明**：op 843（0x34B，handler=sub_428030，emulator `live2d.ts:191` `op_l2d_node_scale_win`）被文档/索引描述成「缩放目标矩阵（百分数 /100）+ 窗1 delay/dur = +32/+52」。（op6-02 为同一处重复条目，已并入。）

**实际**：handler 体是整数/浮点混排：op1=key、op2/op3 = int（delay/dur）、op4/op5/op6 = float 缩放量（`sub_41C300(_this,4..6)/dbl_5201F0`，÷100）→ `sub_4B0030(Scene, key, op2, op3, sx, sy, sz)`；消费者把 op2 写元素 `+32`、op3 写 `+52`，三个 float 用 `D3DXMatrixScaling` 写目标缩放矩阵并置 pending `+76=1`/`Scene[11629]=1`。emulator 按 `(key, percent=op2, delay=op3, dur=op4)` 解析，把 op2（delay）当成缩放百分数，**完全不读** op4/op5/op6。语料 `i34b` = 0 处 ⇒ 当前不可见。

**证据**：`engine/天结_unpacked.exe_utf8.c:34643-34650`（逐字）、`:4430`（`dbl_5201F0 = 100.0`）、`:134143`/`:134163`/`:134165`/`:134168`/`:134172`；`docs-new/03-engine/opcode-table.md:564`；`app/amayui-emulator/src/vm/handlers/live2d.ts:125-129`（全文件 28 处 `optInt`、0 处 `readFloatOperand`）；`app/amayui-emulator/src/live2d/runtime.ts:199-201`；语料 i34b = 0。

**建议处置**：0x34B 读成 `key=op1(int), delay=op2(int), dur=op3(int), sx/sy/sz=readFloatOperand(op4/5/6)/100`；`l2dNodeScaleWin` 签名改为 `(key, sx, sy, sz, delay, dur)`；同一族 0x347/0x348 一并重排。

### op-2-05 — 0x1F9 set-texture 丢掉第 3 操作数（颜色）

**声明**：文档与引擎表都是 argc=3、op3=color，但 emulator 的 `op_set_texture` 完全不读 op3。

**实际**：引擎体 raw 31222-31232 读 op3 并做变换 `v7 = (op3 & 0xFFFFFF) | 0xFF000000`（负值 ⇒ 0），再 `sub_4A3800(Scene, imgid, hFile, slot, v7, 0)`；该色落进槽记录（raw 123368-123381 `sub_49E9D0(..., a5, a6)`、`v7[467] = a5`）。emulator `gfx-texture.ts:125-134` 只读操作数 1/2，`native.ts:287` 的 `bindTexture?(imgid, slot)` 也只有两参 ⇒ op3 及变换整体丢失；`vm/engineSlot.ts:127-128` 的 `param` 字段运行时没有生产者。语料 1096 处 `set-texture` 全部带第 3 个操作数。

**证据**：`engine/天结_unpacked.exe_utf8.c:31222-31232`、`:123368-123381`；`app/amayui-emulator/src/vm/handlers/gfx-texture.ts:125-134`；`app/amayui-emulator/src/vm/native.ts:287`；`app/amayui-emulator/src/vm/engineSlot.ts:127-128,352,359`；语料 `^\s*set-texture\b` = 1096。

**建议处置**：读 op3 并按引擎口径变换后交给宿主（`native.bindTexture(imgid, slot, color)`），至少把变换后的值写进槽模型。

### op-2-10 — 0x02 exit 的 -11 分支被 emulator 当成「整个程序退出」

**声明**：emulator 在 `caller === -11 && !saveResume?.pendingRecord0` 时抛 `ExitScript`；引擎的 -11 分支从不退出。

**实际**：引擎 sub_41A820 的 -11 分支（raw 25645-25660）：`_this[95777] = -1` → 读配置 `set:SaveVersion1` 并写回 → `sub_40F750(_this, v5, "set:SaveVersion2")` → `return`。`sub_40F750`（raw 18877-18951）按 a2 分派：a2==2 装载记录脚本并恢复 ip/返回栈，a2==3 同族，a2==1 且 a3∉{10,20} 时什么都不做 —— 三条路径都不做程序退出。emulator `control.ts:122` 只在 `pendingRecord0` 为真时走装载分支，`:147-149` 否则抛 `ExitScript`；引擎对该配置的读改写（raw 25651-25658）在 emulator 无对应实现。-11 由存档/读档装载路径写入（raw 19577、19695）⇒ 可达。

**证据**：`engine/天结_unpacked.exe_utf8.c:25645-25660`、`:18877-18951`、`:19577`、`:19695`；`app/amayui-emulator/src/vm/handlers/control.ts:110-150`。

**建议处置**：把 -11 的兜底改成「按 sub_40F750 语义：无记录 ⇒ 不动作」，并补 `set:SaveVersion1/2` 的读改写。

> ★**订正（轮 7 / `tickets/T-0092` 落地复核）—— 本条已落地；且「写回」一句是误读**：
> `app/amayui-emulator/src/vm/handlers/control.ts` 的 `op_exit` 已按 **listing** 实现 `-11` 支：`engineValues[95777] = -1`（= `ENGINE_FIELD.callRet`）→ 两次 `GetConfig` 取 `set:SaveVersion1/2`（`readSaveVersionPair`，接口 = 既有 `cfgInt` + `registryDefault`）→ 按 `sub_40F750` 的分派表（`sub40F750Branch`）得 `record`/`partial`/`none`；**无记录 0 时什么都不做、绝不抛 `ExitScript`**（旧的 `else` 兜底已删），既有 `pendingRecord0` 装载路径一字未动。守卫 `app/amayui-emulator/test/op-02-exit-minus11.test.ts`（5 条）。
> ★★上面 `**实际**` 段的「读配置 `set:SaveVersion1` 并**写回**」**不成立** —— 权威是 listing `.lst:0041A85A`-`0041A88B`（`.c:25651-25658` 是 Hex-Rays **误渲染**：把两次 `[vtable+4]` 调用串成「get(key, 默认值)」，并把 `sub_40F750` 的第 3 实参显示成字符串常量）：
> `push SV2str; [95777] = -1; call getter → R2; push R2; push SV1str; call getter → R1; push R1; call sub_40F750(this, R1, R2)`。
> 两处 getter 都是 vtable 槽 **+4** = `sub_4904D0`（`.lst:241306`，`retn 4` ⇒ **单参** GetConfig，**只有读**）；写侧是槽 **+12** = `sub_492AB0` —— **本支一次都没调** ⇒ **没有写回**。`0041A877` 那个「多出来的 push」是跨过中间那次 call、留给 `sub_40F750` 的 **a3**（`arg_0 = [ebp+8]` / `arg_4 = [ebp+0Ch]`，`.lst:27067-27070`）。旁证：同型「提前 push 后面才用的实参」写法在 `0x42D5F4`（`.lst:73654-73670`）也出现，`.c:38169-38170` 同样把版本号渲染成字符串常量。⇒ 票据验收②按其允许的「或写明为什么不需要 —— 必须给体依据」落地。
> ★**补充**：`-11` 的写入点全库只有 2 处（`.c:19577` = `LABEL_136`、`.c:19695` = `a4==2` 行内副本），但触发组有 4 类：`(a4=1, a5=10 且 a6≠0)`、`(a4=1, a5=20 且 a6≠0)`、`(a4=2, *)`、`(a4=3, *)` —— `a4==3`（本机真槽格式）在 `.c:19916-19927` `goto LABEL_136`，**共用写点①**；`(a4=1, a5=0)` 走 `.c:19441 goto LABEL_137`（根本不调 `sub_40F750`）；四种情况回调打不开时都退化成**当场直接** `sub_40F750(a4, a5)`（`.c:19474/19567/19700/19921`）—— 这是 emulator `save-slot.ts:371-382` 回退分支的引擎依据。

### op-1/0x100-push-return-point — 0x100 真按键分支的返回点被多加了 1

**声明**：文档 0x100 语义「两条分支都先压返回点 `((ip-ip_base)>>2)+1`」；emulator 规格注释同 claim，并据此无条件压 `index+1`。

**实际**：引擎只有「掩码 == 0」的 else 分支压 `((ip-ip_base)>>2)+1`（raw 25052）；「掩码 != 0」分支压 `(ip-ip_base)>>2`（raw 25039-25040，无 +1）。主循环是「先按 frame 取 opcode 调 handler、之后才 `ip += 4*length`」（raw 20161-20165）⇒ handler 执行期 ip 仍指当前指令，else/if 两支压的分别是「下一条」与「0x100 自身」；`ret`（raw 25713-25716 `ip = ip_base + 4*v2`）把该值当指令下标用。emulator `input.ts:176` 无条件压 `index + 1` ⇒ 一次通过 0x100 最多派发一个按键，且派发后不会回到 0x100。

**证据**：`engine/天结_unpacked.exe_utf8.c:25038-25052`、`:25064`、`:20161-20165`、`:25703-25727`；`app/amayui-emulator/src/vm/handlers/input.ts:174-177`；`src/script/bin.ts:31-32,63-69`；`docs-new/03-engine/opcode-table.md:208`、`docs-new/03-engine/input-system.md:214`。

**建议处置**：把「掩码 != 0」分支压入的返回点改成当前指令的 dword 下标本身（不 +1），并在注释里写明两条分支的不对称。

> ★**订正（轮 7 复核）—— 本条已落地，勿再当待办**：`app/amayui-emulator/src/vm/handlers/input.ts` 现在**已按两条分支不对称实现** —— `pushReturn(plusOne)`（现 `:163-167`）在**掩码分支**用 `pushReturn(false)`（压本指令、`ret` 回到 0x100 继续扫下一个键，现 `:186`）、**默认键分支**用 `pushReturn(true)`（压下一条，现 `:196`）；扫描游标也已建模（`ENGINE_FIELD.keyScanCursor` = `Engine[cur+122287]`，写入 `b+1`，现 `:181`）。落地经过见 `tickets/T-0077/notes.md` §「B4 第三条」。
> 本条正文的 `**实际**` 段与 `证据` 里的 `input.ts:174-177` 是**审计当时的旧状态**（该段行号已漂），保留仅作历史；判据以代码为准。★**残留的近似（已登记，不是本条的缺口）**：引擎的扫描游标复位在帧泵 `sub_4780D0`（每帧重建掩码）里，emulator 没有对应钩子，改用「掩码变了 ⇒ 新一轮扫描」近似（`input.ts:172-177` 注释）。

### op-7-0x305-flags-not-cleared — 0x305 未清 Engine[122497]，之后 show-text 一直走注音分支

**声明**：`op_text_block_end`（0x305，`msgwin.ts:694-703`）不写 `m.flags`（= `Engine[122497]`）。

**实际**：handler 体在每一条出口路径都清 0：raw 26083（LABEL_12）、26095、26099 都是 `*(_DWORD *)(_this + 489988) = 0;`（0x304 的写入端是 raw 25392 `_this[122497] = 1`）。emulator 侧 `m.flags` 全仓只有两处写：`msgwin.ts:680`（0x304 置 1）与 `vm/msgwin.ts:786`（只在 `reset()` 里；调用它的是 exit-script 0x9 `control.ts:379` 与读档路径 `save-slot.ts:60/261/362`，`i19b` 不碰）⇒ 一次 0x304/0x305 之后该位滞留到下次 exit/读档，`msgwin.ts:389` 的 `m.flags & 1` 恒真，0x6E 永远走注音分支。语料 i304 = i305 = 137 处。可观测性被稀释：空注音在 `text/layout.ts:488` 不产生字形，故画面暂不变，属字段语义缺口。

**证据**：`engine/天結_unpacked.exe_utf8.c:26083`/`:26095`/`:26099`、`:25392`；`app/amayui-emulator/src/vm/handlers/msgwin.ts:389,680,694-703`；`app/amayui-emulator/src/vm/msgwin.ts:345,786`；`control.ts:379`；`save-slot.ts:60,261,362`；`text/layout.ts:488`；语料 i304=i305=137。

**建议处置**：在 `op_text_block_end` 里补 `m.flags = 0`（对齐 raw 26083/26095/26099），或至少清 bit0。

### op8-F8 — 0x25B 的两个字段是纯死写，异常来自被调函数

**声明**：文档 `opcode-table.md:435`（0x25B）称「失败抛 `Command_ShowMessage_Exception`「画像ファイル %s の読み込みに失敗しました」（影响控制流）」，并把 op1 的用途标为 `[推测]`。

**实际**：handler `sub_425E20` 体（raw 33211-33221）只有 `_this[92379] = 2; _this[92381] = op1; if (!_this[167990]) sub_408440(_this, op1);` —— 不检查返回值、体内无异常对象；异常在 `sub_408440` 内部（raw 13147-13155）。全文件 `92381` 只有 raw 33214 一处写入、0 处读取，`92379` 只有 `11128`/`33196`/`33213` 三处写入、0 处读取 ⇒ 两个字段是纯死写。emulator 只写 `ENGINE_FIELD.msgMediaImageId`（`engineFieldIds.ts:147`，无消费方；仅 `test/op-a2-a3.test.ts:134/137` 断言读取），不建模加载与异常。

**证据**：`engine/天結_unpacked.exe_utf8.c:33211-33221`、`:13147-13155`；`92381` 全文件命中 = 1 处（33214）、`92379` = 3 处（均写无读）；`app/amayui-emulator/src/vm/handlers/engine-fields.ts:118`；`app/amayui-emulator/src/vm/engineFieldIds.ts:147`；`app/amayui-emulator/test/op-a2-a3.test.ts:134,137`。

**建议处置**：文档补上「异常来自 `sub_408440`（raw 13155），本 handler 不检查返回值」与「92379/92381 全量只写不读（观测等价 no-op）」；emulator 若继续建模这两个字段，按 `check:dead-writes` 口径记为死写。

### op7-0x7c-local-ret-unimplemented — 0x7C local-ret 未实现（缺口已披露，668 处触达）

**声明**：0x7C `local-ret`（124，sub_41AB80，argc=0）状态「已核对」、语义完整，但索引 emulator 为空。

**实际**：不在 emulator 任何 OpTable（grep `0x7c` 仅两处注释：`vm/engine.ts:115`、`test/adv-msgwin.test.ts:495`）⇒ 命中即 `NotImplementedOp`。语料 668 处 / 334 个脚本（每个 `$1$SCxxxx` 各 2 处），是本分片覆盖面里最大的一处实现缺口，但已由 `docs-new/03-engine/flow-control.md:427` 明写「仍未实现：local-ret(0x7C)、0xAE」⇒ 属登记备查而非隐瞒。文档语义与体一致（raw 25779-25824 逐条核对通过：`489808 & 0x2000000` 门 / 帧[95796]==430712 / `ip = 帧起始 + 4*489812` / 清 489808·81776·81768·51848·51840 / 387940 时 `sub_40FB60`）。

**证据**：`scripts/asm/opcodes.json:746-752`；`engine/天结_unpacked.exe_utf8.c:25778-25824`；`app/amayui-emulator/src/vm/engine.ts:115`；`test/adv-msgwin.test.ts:495`；`docs-new/03-engine/flow-control.md:427`；语料 local-ret = 668/334。

**建议处置**：无文档侧动作；实现时按 raw 25779-25824。

### op-9-op805-325-noop-but-writes-effect-manager-fields — 0x325 注册为 no-op，但写的两格是效果销毁判据

**声明**：0x325 在 emulator 是 no-op（`stubs.ts:108`，emuNoop=true）；`engine-capabilities.md:584` 同口径把它列为「纯 no-op」。

**实际**：handler 体 raw 33931-33937：`v2 = read(2); result = read(1); v4 = _this[93384]; *(v4+1244) = v2; *(v4+1240) = result;`。这两个字段有读取点：`sub_4535F0` 读作效果销毁阈值（raw 65890 `a2 >= *(int*)(_this+1240)`、65897 `a2 >= *(int*)(_this+1244)`），未到阈值就不销毁效果并置 `+1248` 状态位。语料真的用：`src/SETWEATHER.txt:19`（`i325 0 18e70`）、`:38`、`:79`。

**证据**：`engine/天結_unpacked.exe_utf8.c:33924-33938`、`:65842-65897`、`:65366-65393`；`app/amayui-emulator/src/vm/handlers/stubs.ts:104-108`、`:149-152`；`src/SETWEATHER.txt:19,38,79`；`.tmp/opcode-index.json` op=805（emuNoop=true, bodyLine=33924）。

**建议处置**：给 0x325 真实现（op1/op2 落到模型化的效果管理器槽），或在 ENGINE_INTERNAL_OPS 注释里明确「已知会写 +0x4D8/+0x4DC 且这两格被销毁判据读」。

### op-9-op840-348-is-rotation-not-scale — 0x348 是轴角旋转，被文档与 emulator 一致地当成缩放

**声明**：op 840（0x348）被文档与 emulator 一致当作「节点缩放 + 一个额外汇总参数」（`docs-new/03-engine/live2d.md:73`；`live2d.ts:104-108` 只取 op1=key、op2=percent；`live2d.ts:187-188` 把 0x348 映射到同一 handler；`runtime.ts:174-180` 把 percent/100 写进 `node.scale`）。（op840-348-emulator-drops-three-floats 为同一处，已并入。）

**实际**：handler 体是轴角旋转 setter：raw 34592-34598 `sub_427EA0` 把 op2/op3/op4 读成 float（旋转轴向量，`sub_41C300(2/3/4)`）、op5 读成 float（角度，`sub_41C300(5)`），调 `sub_4AFE90`；真身 raw 134058-134099 写轴 `+464/+468/+472`、角 `+488`、`(v7+76)=1`，末行 `j_D3DXMatrixRotationAxis(v14+208, ...)`（角单位 = `dbl_526C98/dbl_5263F0` = π/180，raw 4713/4637）。对照 0x347 = `sub_427E10`（raw 34567-34579）才是缩放（÷100 → `j_D3DXMatrixScaling(+80)`）。操作数计数 `95805 = 11`（5 操作数）自证。语料 i348 / i347 各 0 处 ⇒ 休眠错。

**证据**：`engine/天結_unpacked.exe_utf8.c:34583-34599`、`:134058-134099`、`:4713`、`:4637`、`:4430`、`:34567-34579`、`:134035-134053`；`app/amayui-emulator/src/vm/handlers/live2d.ts:103-108,187-188`；`app/amayui-emulator/src/live2d/runtime.ts:174-180`；`docs-new/03-engine/live2d.md:73`；语料 i348/i347 = 0。

**建议处置**：把 0x348 单独注册（op1=key、op2/3/4=轴 float、op5=角 float，落 node 的 rotation，与 0x34C 同形），不要复用 `op_l2d_node_scale`；`live2d.md:73` 同步改为「节点旋转（轴+角）」。

### op-10-001 — 0x2E7 对 idx≥2 自造回退到 Pitch0

**声明**：文档「op1==1 ⇒ SetConfig(message:AutoMessagePitch1, op2)、0 ⇒ …Pitch0，其它值报错」；emulator 把任意「非 1」的 idx 静默映射成 Pitch0。

**实际**：引擎只承认 0/1：`if (read(1)) { if (read(1)==1) SetConfig(Pitch1) else { sprintf_s(..., aGetautomespi); sub_4034D0(...) } } else SetConfig(Pitch0)`（raw 33542-33562）⇒ idx≥2 走报错分支且不写任何配置键。emulator `msgwin.ts:1123-1124` 的 `idx === 1 ? 1 : 0` 把 idx=2..N 静默写成 `message:automessagepitch0`。语料 i2e7 只有 idx 0/1（4 处）。

**证据**：`engine/天結_unpacked.exe_utf8.c:33542-33562`（`:33545` `== 1`、`:33553` `sprintf_s(...,aGetautomespi)`、`:33561` `aMessageAutomes_2`）、`:4310`/`:4313`/`:4435`；`docs-new/03-engine/opcode-table.md:485`；`app/amayui-emulator/src/vm/handlers/msgwin.ts:1121-1125`。

**建议处置**：按引擎两段式：idx===0 写 …pitch0、idx===1 写 …pitch1，其余 idx 抛 `GetAutoMesPiの引数が不正です．`（不得回退到 pitch0）。

### op-10-002 — 0x6E 在 ADV 模式下多置等待门，逐段多等 MessageSpeed ms

**声明**：emulator `msgwin.ts:406-414` 在 `advanceReveal` 后只要 `speed > 0` 就置 `SLEEP_GATE`（注释自称照抄引擎「节流」分支）。

**实际**：引擎的节流分支带 ADV 位前置条件：`if (!_this[21668] || (_this[174801] & 0x8000000) != 0) { sub_46CBF0(...) }`（raw 28361）—— 满足即同步排空，只有 else 才 `_this[174801] |= 0x20000000`（raw 28380）+ `sub_453A60(_this+107643, _this[21668])`（raw 28382）。`sub_46CBF0` 真身（raw 83999-84009）确无 Sleep/计时器。emulator 刚 `setAdv(e)` 后仍无条件置门，且 `frame/loop.ts:272` 的 sleep 门排在 `:293` 的 adv 分支之前 ⇒ 跳读/自动模式下每段文本多等 MessageSpeed ms。

**证据**：`engine/天結_unpacked.exe_utf8.c:28361`/`:28368`/`:28380`/`:28382`、`:83999-84009`、`:66101-66111`、`:23736-23738`、`:4277`；`app/amayui-emulator/src/vm/handlers/msgwin.ts:406-414`；`app/amayui-emulator/src/vm/engine.ts:22,31,560-565`；`app/amayui-emulator/src/frame/loop.ts:272,293`。

**建议处置**：把 SLEEP_GATE 与计时器放进 `!advActive(e)` 分支（与 raw 28361 同构）；ADV 位已置时只做同步排空。

### op-10-003 — 0x2FC 无触点路径多写了 op2..op5

**声明**：文档/引擎：无触点时只写 op1=0；emulator 除 op1=0 外还写 op2=X、op3=Y、op4=0、op5=0。

**实际**：引擎 `if (!sub_477980(...)) return sub_42B4B0((int)_this, 1, 0);`（raw 40798-40799）—— 无触点路径只写 op1 后早退，op2..op5 保持不动；有触点路径（raw 40821-40825）才写 op2..op5 且经 `sub_498350`/`sub_403500` 变换。emulator `input.ts:221-225` 在（恒）无触点路径仍写 5 个槽，与它自己 `:219` 的注释直接矛盾。语料 44 处 i2fc 全部紧跟 `read-mouse-pos` 覆写 op2/op3（`TITLE:73/79`、`AIM:116/122`、`MES:377/383`、`SAVE:242/248`、`ORGANIZE:119/125`）⇒ 现有语料下不可观测，仅 `STATUS:231` 的 op4/op5 槽为 write-only。

**证据**：`engine/天結_unpacked.exe_utf8.c:40798-40799`、`:40802`、`:40818`、`:40821-40825`；`docs-new/03-engine/opcode-table.md:506`；`app/amayui-emulator/src/vm/handlers/input.ts:216-226`；`src/TITLE.txt:73,79`、`src/AIM.txt:116,122`、`src/SAVE.txt:242,248`、`src/STATUS.txt:231`。

**建议处置**：无触点路径只写 op1=0 并返回（op2..op5 保持不动）；坐标继续由 0x109 / read-mouse-pos 提供。

### op-4-02 — 0x10C 注册为 no-op，但它写的是引擎每帧扫描的按键表

**声明**：0x10C（268，SetKeyMulti）被注册成无条件 no-op（`stubs.ts:173`），但它写入的表正是引擎每帧输入扫描读的那张「VK→输入掩码位」表。

**实际**：handler 体 raw 30617-30633：`v2 = readInt(2); result = readInt(1); if (result > 0x1F) throw aSetkeymulti; _this[_this[v2 + 1690] + 1434] = result;`；Input 子对象在 Engine+1032 字节（raw 22461），构造时 `memset(_this+1176, 255, 0x400)`、`memset(_this+1432, 0, 0x400)`（raw 92379-92382）；读取端 raw 91550-91569 每帧按该表置位掩码，随后由 0x100 派发。唯一要收窄的是可见性：emulator 根本没有键盘输入模型（InputManager 只有鼠标/手把通道、`keyEdge` 只有写点无写入者、DOM 桥 `inputAttach.ts` 无 keydown/keyup）⇒ 键掩码 bit0..6 永远不可能被置位，今天观测等价（`stubs.ts:172` 注释已如实登记）。语料 i10c = 11 处，全在 `src/SYSTEM4.txt:87-97`。

**证据**：`engine/天結_unpacked.exe_utf8.c:30617-30633`、`:22461`、`:92379-92382`、`:91550-91569`；`docs-new/03-engine/opcode-table.md:220`；`src/SYSTEM4.txt:87-97`；`app/amayui-emulator/src/vm/handlers/stubs.ts:172-173`；`app/amayui-emulator/src/vm/input.ts:301-311,323-333,337-342`；`app/amayui-emulator/src/renderer/pixi/inputAttach.ts:1-109`；`app/amayui-emulator/src/vm/handlers/input.ts:160-178`。

**建议处置**：若将来补键盘事件源，需同步建模按键表（key index → `Input[1432+key]` → 位号），并去掉 `op_engine_internal` 的无条件 no-op 定性。

### op-3-004 — 0x196 漏注外层门，且 effect_flags/节拍半边未实现

**声明**：文档/索引 0x196 display-furigana 写「分三路：① MessageSpeed == 0 或 ADV 位已置 ⇒ sub_46CBF0；② 否则 sub_46BE30 …；③ Engine[489988] & 1 置位时纯 sub_46BE30」。

**实际**：handler 体的外层门是 `v7 = (*(_BYTE *)(_this + 489988) & 1) == 0;`（raw 29071，该 byte 偏移 = 下标 122497 = 0x304 写的文本块标志）；MessageSpeed（`_this[86672]`）是里层条件（raw 29075）。文档原文三路并列、第③路自带门，故真实缺陷只是①②未注外层门。emulator 侧 `op_display_furigana`（`msgwin.ts:564-574`）只做 captureFontStyle/addRuby/emitWin，全仓 effect_flags 写入点中无任何一处设 0x20000000（0x196 用）或 0x10000，也不起节拍定时器（raw 29093/29108）。

> ★**订正（轮 6，`tickets/T-0077`/`T-0094`）**：本文写的「语料 i196 = 0」**只对助记符字面量 `i196` 成立**；该指令在本作里几乎只用**名字形式 `display-furigana`** 出现 —— `src/*.txt` 里共 **6341 处**（例：`src/CONFIG.txt:174`）⇒ ①②路的 `effect_flags |= 0x20000000` + `sub_453A60` 节拍**是真实可观测的节奏缺口**（每处注音比引擎少等一拍 MessageSpeed），不是「反正不可观测」。轮 6 已接**外层门**与第③路（`flags |= 0x10000`、`lastArg = op1`）；**第①②路的节流半边已于轮 7（`T-0094`）落地** —— `msgwin.ts` 的 `op_display_furigana` 在 `MessageSpeed != 0 && !advActive` 时装 `effect_flags |= SLEEP_GATE(0x20000000)` + `sleepUntil = now + max(1, MessageSpeed)`，**复用的是 `0x6E`（raw 28380/28382）同一个 `SLEEP_GATE`/`sleepUntil` 机制，未新造平行机制**。
> 三具被调函数的体已查实：`sub_46BE30`（raw **83363-83995**）只排版、返回值 = 「本行有内容吗」（raw 83493-83497 空串 ⇒ 0）；`sub_46CBF0`（raw **83998-84010**）= 它 + `sub_45BE20` **行泵自旋**（"同步排空"排的就是行泵；**体内无 Sleep、无计时器**）；`sub_453A60(Engine+430572, ms)`（raw **66100-66112**）= 周期为 **ms** 的节拍计时器对象（`[2]`=tick、`[5]`=起算、`[6]`=周期，`a2?:1`），到期判定 `sub_453B60`（raw 66188-66212）未到点返回 -1。
> `0x20000000` 的读者 = 主循环 raw **21176**，清位点 = `sub_409400` 内 raw **13892/13919/13940/13964**（每条都在 `sub_453B60 >= 0` 之后）。
> ★**实测可观测**（不是"看起来应该会变"）：真产物 `install/CONFIG1.BIN` 的那段 `0x71 → 0x196 → 0x6E`（下标 2131）在帧循环里，`MessageSpeed=40` ⇒ 注音之后那条等 **66.7ms/处**、整段 1267ms；`MessageSpeed=0` ⇒ **0ms / 0 帧**。守卫 = `app/amayui-emulator/test/op-3-004-furigana-outer-gate.test.ts` 的第 87 条（正向棘轮：装门且 `sleepUntil == now+SPEED`）与第 248 条（节拍代价随 MessageSpeed 的量化断言）。

**证据**：`engine/天結_unpacked.exe_utf8.c:29071`（489988/4 = 122497）、`:29075-29081`、`:29088-29095`、`:29104-29109`；`docs-new/03-engine/opcode-table.md:264`；`app/amayui-emulator/src/vm/handlers/msgwin.ts:564-574`、对照 `:410-414` 与 `engine.ts:22`；★语料计数**已订正**（见上）：助记符 `i196` = 0，但名字形式 `display-furigana` = **6341 处**。

**建议处置**：文档把第①②路补上外层门 `Engine[122497] & 1`、MessageSpeed 归入里层；emulator 若暂不建模节拍，至少在注释里写明 effect_flags 0x20000000/0x10000 与 `sub_453A60` 节拍未实现。

### op-4-05 — 0x22D/0x234/0x329 三条未注册，命中即硬停

**声明**：0x22D（557）、0x234（564）、0x329（809）都不在 emulator 注册表里，而语料各有 5 / 4 / 1 处使用。

**实际**：0x22D 体 raw 32048-32064 读 op1/op2(int) + op3/4/5(float 且先 ÷100) → `sub_49A870`（语料 `src/FIELD.txt:2277`/`:2998`/`:3023`、`$5$SC0370`×2）；0x234 体 raw 32185-32201 读 3 个 float（不除）→ `sub_4AD850`（`src/SC0000.txt:16096`/`:16192`、SC1620×2）；0x329 体 raw 33966-34000 装载 mesh（`sub_4559C0`/`sub_455560`/`sub_4A0640`），失败抛「メッシュファイル %s の読み込みに失敗しました」（`src/SETWEATHER.txt:56`）。三者 grep 在 emulator src 全树只命中 `+0x234` 类结构体注释 ⇒ 命中即 `NotImplementedOp`。

**证据**：`engine/天結_unpacked.exe_utf8.c:32048-32064`、`:32185-32201`、`:33966-34000`；`src/FIELD.txt:2277,2998,3023`、`src/$5$SC0370.txt`×2、`src/SC0000.txt:16096,16192`、`src/SC1620.txt`×2、`src/SETWEATHER.txt:56`。

**建议处置**：至少登记为 no-op 桩（避免硬停）；0x22D/0x234 可按 0x21E/0x220 的 native 动画窗缝实现。

### op-4-06 — 0x203 丢掉 clamp 与「<0 回退取当前色」，并自造 `alpha & 0xff` 组装

**声明**：emulator 的 `op_set_draw_color_alpha` 用自己发明的 `(alpha & 0xff)` 组装 alpha，丢掉引擎的 clamp 与「<0 回退取当前色」两条分支。

**实际**：代码 `gfx-item.ts:334-341`：`const argb = ((alpha & 0xff) << 24) | (color & 0xffffff); c.native.setDrawColorAlpha?.(handle, argb, blend);`，注释 `:335`/`:338` 却自称「op3=alpha(clamp/回退)、op4=color(回退)」。引擎体 raw 31419-31451：`v2<=255` 且 `v2<0` ⇒ `v2 = sub_4ADD60(Scene, op1) >> 24`；`v2>255 ⇒ 255`；`v3<0 ⇒ v3 = sub_4ADD60(Scene, op1)`。⇒ op3≥256 时 emulator 给 α=0（引擎 255）；op3/op4<0 时丢回退。语料 7637 处 `set-draw-color-alpha`，静态实参 alpha>255 / alpha<0 / color<0 均 0 处 ⇒ 潜在边界错。

**证据**：`engine/天結_unpacked.exe_utf8.c:31419-31451`；`app/amayui-emulator/src/vm/handlers/gfx-item.ts:334-341`；语料 `^\s*set-draw-color-alpha\b` = 7637 + 实参扫描 0 处越界。

**建议处置**：补 `if (alpha > 255) alpha = 255;` 与 `<0 ⇒ 取当前色/当前 α`（需 native 提供当前色 getter，对应 `sub_4ADD60`）。

### op-6-05 — 0x1A8 被当 nop，实际会写当前帧步长槽；「唯一空实现」挂错了 0xAF

**声明**：0x1A8 dev_ukn 文档/JSON 写「nop（dev 未知指令，通常空实现）」（`opcode-table.md:282`），emulator 也实现为空函数（`control.ts:336`/`:420`）。

**实际**：handler 体 raw 24775-24783 真实写引擎状态：`result = _this[95776]; _this[30 * result + 95805] = 1; return result;` —— 把当前帧的指令步长槽置 1，而该槽是活的（主循环 raw 20165 是它在全文件唯一的读取点）。本条恰好置成与 0 操作数指令相同的值，故当前不产生分叉；但依据本身错，且 `stubs.ts:189` 把「唯一一条体内什么都不做的指令」挂在 0xAF 上——0xAF 真实登记为 `sub_419690`（raw 22898，= 675996 + 4*175），体与 0x1A8 完全相同。

**证据**：`engine/天結_unpacked.exe_utf8.c:24775-24783`、`:20165`、`:22898`；`docs-new/03-engine/opcode-table.md:158,282`；`app/amayui-emulator/src/vm/handlers/stubs.ts:188-196`；`app/amayui-emulator/src/vm/handlers/control.ts:336,420`；`app/amayui-emulator/src/vm/interpreter.ts:185`。

**建议处置**：把语义改为「写当前帧步长槽 `95805 = 1`（对 ip 推进与 0 操作数等价，无外部可观测差异）」；删掉 stubs.ts 里对 0xAF 的错误断言。

### op-6-09 — 0x20A 有两条效果，索引只写「仅映射」，emulator 把两次调用并成一次

**声明**：索引只写「仅映射」（无已知语义），但 handler 体内有两条具体效果。

**实际**：体 raw 31553-31565 是：`sub_45AD30(_this+21324, op1)`（重排该窗文本）→ `v3 = _this[124350] ? _this[95779] : _this[174801]` → 若 `(v3 & 0x40000000)` 再 `sub_45A940(_this+21324, op1, _this[107704], 0)`（用当前逐字游标重贴）。emulator `msgwin.ts:656-670` 只调 `emitWin`（重发布 segments + 当前 revealed 游标），既没有「重排」的显式对应物，也没有第二条的对应物，把引擎两次调用合并成一次。

**证据**：`engine/天結_unpacked.exe_utf8.c:31553-31565`、`107704` 命中行 = `:28552`/`:29338`/`:31562`；`app/amayui-emulator/src/vm/handlers/msgwin.ts:656-670`；`docs-new/03-engine/opcode-table.md` 与 `.tmp/opcode-index.json` op 522 均「仅映射」、semantics 空。

**建议处置**：把 0x20A 升为已核对并写清两条效果；emulator 要么显式调一次 `layoutWindow` 重排，要么在注释里写明「emit 的宿主通道必定重排，故与 `sub_45AD30` 等价」。

### op-6-10 — 0x32 两条支路的表层裁剪/错误串未建模

**声明**：文档给出「按 `set:DrawMode` 分两路 + 两矩形按所在 surface 边界夹取、一侧被夹时另一侧按比例跟随 + surface 缺失时打错误串返回 0」。

**实际**：handler 体只有分路（raw 27982-28006）：`v3 = (_this[667856] == 0)`；`==0` ⇒ 走 `vtable+64`（源/目标槽 + 4 个化开后的矩形角点），`!=0` ⇒ `sub_4A87A0(Scene, op1, op2, &src4, &dst4)`；夹取/跟随/错误串都不在 handler 体内（属 `sub_4A87A0` raw 127933-128129 或更下层）。emulator `gfx-state.ts:117-130` 只读 10 个操作数并直接下发 `blitSlotToSlot`，不读 `Engine[166964]`（读 166964 的是另一条 0x30B，raw 39862）。⇒ 两条支路的表层裁剪未建模属实，但「文档缺口」这一层不成立（`opcode-table.md:70` 已把夹取/跟随/错误串归给 `sub_4A87A0` 并引了行号）。

**证据**：`engine/天結_unpacked.exe_utf8.c:27982`、`:27989-28000`、`:28006`、`:39862`；`docs-new/03-engine/opcode-table.md:70`；`app/amayui-emulator/src/vm/handlers/gfx-state.ts:99-130`。

**建议处置**：在索引/emulator 注释里把两条支路标注为「各自表层裁剪未建模」，或在宿主缝补一次「按槽尺寸夹取 + 等比跟随」。

### op-6-07 — 0xBC 的机制在另一函数，索引未引其行号；Engine[174712] 无任何引用

**声明**：索引给出具体行为「把 `sound:Music` 的值 ±3 写回 → `sub_489B50` 停（清 `Music[259]`）→ 装回 → `sub_489F80` 重播该曲，并把 `Engine[174712]` 记为新模式值」。

**实际**：handler 体只有 4 行（raw 29792-29802）：`95805 = 3; result = read(1); if (result <= 2) return sub_408CF0(_this, result - 1); return result;` —— 索引描述的全部机制位于 `sub_408CF0`（raw 13514-13543：`v3 = vtable[+4](..., aSoundMusic)` → `v4 = v3 ± 3` → `vtable[+12](..., aSoundMusic, v4)` → `sub_489B50` → `_this[174713] = v6` → `_this[174712] = v4` → `sub_489F80`），而索引只引了 handler 体行号 29792-29802。`Engine[174712]` 在 `app/amayui-emulator/src` 下零引用。

**证据**：`engine/天結_unpacked.exe_utf8.c:29792-29802`、`:13514-13543`；`app/amayui-emulator/src` 内 174712 命中 0。

**建议处置**：索引/文档的 raw 引用补成「handler raw 29792-29802 + sub_408CF0 raw 13515-13543」；若要建模 `Engine[174712]`，先在 `engineFieldIds.ts` 登记该字段并写明读者。

### op-7-0x235-unimplemented-158-uses — 0x235 未注册且无缺口登记（锚点需订正）

**声明**：`opcode-table.md:397` / 索引：0x235（565，sub_424630，argc=5）状态「仅映射」、语义列为空、emulator 无注册。

**实际**：handler 体 raw 32203-32219（`32212` arity=11 ⇒ argc=5），emulator 全树 grep 无 `0x235` ⇒ 命中即 `NotImplementedOp`；语料 **158 处 / 52 文件**（SC0010×16、SC3000/SC2500/SC0040/SC2060 各 7、`$1$SC0330`×4、SC0000×3、MOVERUIN、REIGN…）。原 finding 的 evidence/code/fix 把锚点写成 raw 32067，那是 **0x22E（op 558）/ sub_424290** 的体；`finding` 自己的 actual 文本反而写对了「raw 32203 起」。

**证据**：`engine/天結_unpacked.exe_utf8.c:32067-32068`（sub_424290）、`:32203-32219`（sub_424630）；`docs-new/03-engine/opcode-table.md:397`；`app/amayui-emulator/src/vm/handlers/index.ts:44-84`（332 个表项键无 565）；语料 i235 = 158/52 文件。

**建议处置**：读 `sub_424630`（raw 32203-32219）定性 → 决定实现或登记缺口；在 opcode-table 该行补 emulator 状态。

### op-8-F3 — 0x12E 的「16*(op1+1) 起遍历」对参与比较的平面不成立

**声明**：文档 `opcode-table.md:226`（0x12E 悬停命中）称「先用 `sub_42AEA0` 取 op2/op5/op6/op7 的操作数地址、`sub_41BF50` 取 op1/op3/op4/op8 的值并缓存进全局 `dword_55D5xx`；再从 `base + 16*(op1+1)` 起遍历矩形表」。

**实际**：raw 39199-39252 逐行：`dword_55D588 = sub_42AEA0(_this, 7) + 4*op1 + 4`（raw 39217）、`dword_55D58C = sub_42AEA0(_this, 6) + 4*op1 + 4`（raw 39215）、`dword_55D57C = dword_55D590 + 16*op8`（39222）、`dword_55D568 = dword_55D590 + 16*(op1+1)`（39230）；后续比较用 `dword_55D588 += 4` / `dword_55D58C += 4`（39245-39246）按 4 字节步进。⇒ 真正参与比较的 x/y 平面基址是 `sub_42AEA0(6|7) + 4*op1 + 4`，`16*(op1+1)` 只对 16 字节记录游标成立。

**证据**：`engine/天結_unpacked.exe_utf8.c:39214-39217`、`:39222`、`:39230`、`:39242`、`:39245-39247`、`:36757`（`sub_42AEA0` 定义 = 操作数地址）；`docs-new/03-engine/opcode-table.md:226`。

**建议处置**：改为「size 盒数组基址 = `sub_42AEA0(7) + 4*op1 + 4`；遍历上界 = 基址 `+16*count`；每步 4 字节；首项下标 = op1+1」。

### op-8-F4 — 0x12E 的两道表边界门与首项偏移 emulator 全部缺失

**声明**：emulator `op_hover_hittest`（`input.ts:236-260`）按 `for (i = 0; i < count; i++)` 遍历全部 count 个矩形，命中即 break。

**实际**：引擎进入循环前有一道表边界门：`if (dword_55D568 >= (unsigned)dword_55D57C) return sub_42B4B0(_this, 1, -1);`（raw 39231-39232），循环内每步之后还有第二道（raw 39248-39249），且首项是 op1+1 而不是 0（raw 39230）。emulator 完全没有这两道门，恒把 count 个条目扫完、也从不消费 op1。语料 47 处 i12e（CONFIG1/TITLE/GAMESTART/FIELD 等），op1 多数为 1 ⇒ 跳过前缀的语义分歧真实存在。★原 finding 的 fix「box 下标 = i*4、start = op1+1」与体不符：按 4 字节步进线性化后，命中记录 op1+i 的盒与 x/y 下标 i−1 配对（两平面相差一个元素）。

**证据**：`engine/天結_unpacked.exe_utf8.c:39230-39232`、`:39247-39249`、`:39251`、`:39214-39217`+`:39245-39246`；`app/amayui-emulator/src/vm/handlers/input.ts:236-260`；语料 `^i12e` = 47 处（`CONFIG1.txt:137`/`:740`、`TITLE.txt:100`、`GAMESTART.txt:115`、`FIELD.txt:1381`）。

**建议处置**：按引擎加两道边界门与首项 op1+1，并注意盒平面与 x/y 平面相差一个元素。

### op-10-010 — 0x251 未注册，命中即停在正常渲染路径上

**声明**：0x251（593，sub_425A10，12 实参 → `sub_4AFA30`）在 emulator 三张注册表里一处也没有，而语料大量使用它；同类未注册缺口：0x1B3（sub_40C660 追加 CRLF）、0x231（25 处）、0x22C（6 处）、0x36（5 处）。

**实际**：0x251 体 raw 33041-33054（`95805 = 25` ⇒ argc=12、读 op1..op12 → `sub_4AFA30`）；emulator 全树 grep `0x251` = 0 命中 ⇒ `interpreter.ts:166` 抛 `NotImplementedOp`（不是静默 no-op；`resolveHandler` 只查三张静态 Map + 用户桩，无 range 兜底）。语料 44 处 / 21 文件，含 `src/SC0000.txt:1356` 的正常渲染路径（1338 create-texture / 1340 draw-texture / 1356 i251，紧接 jcc 分支）。0x1B3 体 raw 36560-36565 为 `sub_40C660(_this + 124336, asc_51EE84 = "\r\n", 2)`，doc:293 标「已核对」而 emulator 无 `0x1b3`，两处调用（`SYSTEM4.txt:466` 其后 abort、`FIELD.txt:9911`「不正処理発生」）属错误分支。

**证据**：`engine/天結_unpacked.exe_utf8.c:33041-33054`、`:36560-36565`、`:4319-4320`；`docs-new/03-engine/opcode-table.md:425,293,74,388,393`；`app/amayui-emulator/src/vm/interpreter.ts:61-68,166`；`app/amayui-emulator/src/vm/handlers/index.ts:44-81`；emulator 全树对 0x251/0x1b3/0x231/0x22c/0x36 = 0 命中；语料 i251=44、i1b3=2、i231=25、i22c=6、i036=5。

**建议处置**：至少把 0x1B3（追加 `"\r\n"` 到文本缓冲）补成真实现，并把其余按「命中即停」登记进缺口台账（含可执行路径与语料量级）。

### op-1/0x232-drawitem-color-missing — 0x232 DrawItem 颜色/alpha 写入整条缺失

**声明**：0x232 在索引/文档里是「仅映射」、emulator 注册点为空。

**实际**：handler 体 raw 32131-32164 是 DrawItem 颜色/透明度写入：读 op1=handle、op2、op3、op4 —— `v2>255 ⇒ 255`、`v2<0 ⇒ sub_4ADD60(Scene, op1) >> 24`、`v3<0 ⇒ sub_4ADD60(Scene, op1)`，再 `sub_4AD730(Scene, op1, op2, packed ARGB)`；被调方 `sub_4AD730`（raw 132241-132257）取/建 DrawItem、`*v |= 4`、`+544 = delay`、`+576 = ARGB`、置脏 `_this[11627] = 1` ⇒ 场景可见属性。emulator 无任何注册，语料有 8 处 i232（FIELD 1 / SC0100 1 / SC0620 2 / SC1620 1 / SC2210 1 / SC3000 2）。

**证据**：`engine/天結_unpacked.exe_utf8.c:23089`（678244 = 675996+4*0x232）、`:32131-32164`、`:132241-132257`；`docs-new/03-engine/opcode-table.md:394`；语料 i232 = 8；emulator 全 src 无 `0x232`/`562`。

**建议处置**：补 0x232（读 op1..op4 → 渲染侧 DrawItem 颜色/alpha 写入，含负值按 `sub_4ADD60` 取回当前值的分支），或至少登记为已知缺口而不是硬报错。

### op3-008 — 0x305 索引行张冠李戴（同一 handler 记在 op=305 与 op=131 两处）

**声明**：0x305（GetMesWinAlpha）在索引/文档里写「handler=sub_42F7D0（raw .c 39350-39356）」，暗示体是「读 op1..」，而语义句写「按名直读配置注册表，不读任何 Engine 字段」。

**实际**：体 raw 39350-39357 根本不读任何操作数（0 个 `sub_41BF50`，只有 `sub_42B4B0(_this, 1, v2)` 写 op1）；语义句正确、emulator 实现也一致（`engine-fields.ts:46-62` 直读配置键，`configRegistry.ts:47` `message:MesWinAlpha` def=8）。真正的问题是索引局部 opcode 编号漂移：`.tmp/opcode-index.json` 里 op=305 的 handler=`sub_42F7D0`、`handlerCtorLine=22998`，而 raw 22998 = 677216 = 675996 + 4*0x131 ⇒ 同一 handler 在索引里同时出现在 op=305 与 op=131；`scripts/asm/opcodes.json` 的 opcode=305 同样写 `sub_42F7D0`；`docs-new/03-engine/opcode-table.md:515` 的 0x305 正主是 `sub_41B1C0`（其体 raw 26034-26045 读 `(_this+489988)&0x10001`，1 个输入操作数）。

**证据**：`engine/天結_unpacked.exe_utf8.c:39350-39357`、`:22998`、`:26033-26045`；`.tmp/opcode-index.json` op=305 与 op=131；`scripts/asm/opcodes.json` opcode=305；`docs-new/03-engine/opcode-table.md:515`；`app/amayui-emulator/src/vm/handlers/engine-fields.ts:46-62,328`；`app/amayui-emulator/src/configRegistry.ts:47`。

**建议处置**：把该行措辞改成「0 输入操作数、1 输出操作数」；并修索引的局部编号漂移（0x305/0x306/0x307 的 handler 实为 0x131/0x132/0x133）。

### op-5-001 — 0x308 桩不读 op1、不写 1954，与 doc 的「已核对」并存

**声明**：0x308（`i308`）在 `docs-new/03-engine/opcode-table.md:518` 标『已核对』，emulator 以 `op_stub_unhandled` 记录后放行（`stubs.ts:219`）。

**实际**：handler 体 `sub_426B20`（raw 33808-33815，体首 raw 33812 另写 arity 槽 = 3）读 op1 后 `sub_407B20(dword_55E1BC, _this[96981], v2)`；`sub_407B20`（raw 12580-12618）的副作用全部落在宿主/全局（`LoadLibraryA`/`GetProcAddress`/导出调用/`FreeLibrary`/`dword_55C39C`/`dword_55C398`），唯一结构化写 `_this[1954] = a3` 全文件只有 raw 12605/12610/12615 三处写、0 处读 ⇒ 观测等价死写成立。语料规模：`i308` = 31279 行 / 345 个脚本（`i308 1` = 30753、`i308 0` = 526），与 ADV 进出成对（`src/$1$SC0330.txt:1133-1145`）。doc:518 的描述与体逐项吻合，失实的只是 `stubs.ts:5` 的通判。

**证据**：`engine/天結_unpacked.exe_utf8.c:33808-33815`、`:12580-12618`；grep `_this[1954]` = 12605/12610/12615 仅写无读；`app/amayui-emulator/src/vm/handlers/stubs.ts:5,27-28,219`、`:191-196`（0xAF 的 arity 槽豁免口径）；`app/amayui-emulator/src/vm/handlers/index.ts:44-83`；`interpreter.ts:61-67`；语料 31279/345。

**建议处置**：把 31279/345 的语料量级与「本桩确实不读 op1、不写 1954」写进 `stubs.ts:219` 的注记（该注记已存在，补量级即可）；doc:518 不必降级。

### op9-op137-index-emulator-points-at-png-signature-byte — 索引把 PNG 魔数 0x50 当成了 op 137 的 emulator 实现

**声明**：`.tmp/opcode-index.json` 给 op 137 的 emulator 列是 `app/amayui-emulator/src/tools/slotThumbPng.ts:54`、handler 名 `0x50`。

**实际**：该处是 PNG 魔数常量 `Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])` —— `0x50` 是签名里的 'P' 字节，不是 opcode；op 137 的十进制是 0x89，正好被镜像扫到。真实情况：op 137 = 0x89（raw 22838 `*(_DWORD *)(_this + 676544) = sub_41FB00;`，676544 = 675996 + 4*137），handler `sub_41FB00`（raw 28980-28994，读 op3/op2/op4-字符串/op1）在 emulator 根本没有实现（不在 OPS/NATIVE_OPS，`slotThumbPng` 也与 VM 无关）。

**证据**：`.tmp/opcode-index.json` op=137；`app/amayui-emulator/src/tools/slotThumbPng.ts:53-54`；`engine/天結_unpacked.exe_utf8.c:22838`、`:28980-28994`；emulator grep `0x89|0x137|0x41FB00` 仅 `slotThumbPng.ts:54`。

**建议处置**：索引生成器对 emulator 列加「只认 OPS/NATIVE_OPS 注册点或指令助记符」的白名单，去掉这条假映射。

---

## P3 汇总表

| id | kind | 一句话 | 证据锚点 |
| --- | --- | --- | --- |
| op-2-06 | host-invented | 0x1A0 写序与引擎相反（op1 先于 op3..op9） | raw 38381-38403；save-slot.ts:551-559 |
| op-2-07 | overreach | 0x197 的重建函数名写成 sub_459F40，实为 sub_45A6E0 | raw 29117-29124；24153；33401 vs 33421 |
| op-2-08 | cross-source-mismatch | 0x2F8 文档仍写「emulator 空操作」，实为 op_voice_pan | audio.ts:340-346,450；doc:502 |
| op-2-09 | contradiction | 0x2F8「>14 报 dsSetPan」应为 dsSetVolume 串 | raw 139083-139087；5214 |
| op-2-11 | overreach | 0x1D3 的 raw 锚点 38096-38113 指向别的函数 | raw 38112-38128；38091-38110 |
| op-2-12 | unclear | 0x6F 的 Engine[97055] 门未建模，门与显示换行是否同路未证 | raw 28388-28398；82726-82729；msgwin.ts:418-423 |
| op-3-001 | gap-as-noop | 0x105 有真实读点但从无语料调用（i105 = 0；i261 是 0x261） | raw 30505-30513；25132；语料 i105=0 |
| op-3-007 | overreach | 0x259「每项写 +8/+12」应为条目内 0/4/8/12 四个 dword | raw 25357-25376 |
| op3-009 | no-evidence | 索引把「归属作品」列当 handler 名（0x860/0x904/0x923、0x35F/0x38F、780/864/912、0x353/0x361/0x391） | doc:577,579-611；raw 22722；index-opcodes.mjs:35-47 |
| op-5-003 | gap-as-noop | 台账把 0x134/0x144/0x147/0x2FD/0x026 的语料处数错记为 0（实测 5/1/1/4/1） | raw 39359-39398、27432-27464；emulator 对 5 条 0 命中 |
| op-4-03 | overreach | 0x10C 错误串非原文「SetKeyMultiの引数が不正です．」 | raw 4420；30628-30630 |
| op-4-07 | cross-source-mismatch | 0x34A 的 op2..op4 是 float，emulator 用整数读 | raw 34617-34631；live2d.ts:118-122 |
| op-4-09 | no-evidence | 0x137 标「已核对」却无 raw 锚点（内容正确） | doc:235；raw 30703-30730；12622-12631 |
| op-4-10 | contradiction | 0x71 的三个 flag 实为门控条件，非无条件效果 | raw 28418-28462；doc:110 |
| op-4-11 | cross-source-mismatch | ~~0x2EE 还写 SetConfig(message:MessageFade)，emulator 未写~~ **★轮 7 已修（`tickets/T-0097`）**：`handlers/engine-fields.ts` 新增 `op_set_message_fade` = 字段 + `setConfigValue(message:MessageFade)` 双写（守卫 `test/op-2ee-message-fade.test.ts`）。★另订正：opcode-table 原写「以 `"message"`+op1 派发」也是错的 —— 键名是常量 `"message:MessageFade"`（raw 4380）、值 = op1（同一操作数重读） | raw 33590-33603；4380 |
| op-4-12 | host-invented | 0x20F 只保留 op1，丢弃 slot(op2)/模式(op3) | raw 31626/31636/31654；gfx-misc.ts:65-69 |
| op-4-13 | cross-source-mismatch | docs「已核对」333 行 vs opcodes.json 124 条；0x309/0x339 argc 缺口 | doc:235,504,359,546；build-opcodes.js:38-47,93-110；raw 40979/34319 |
| op-5-005 | gap-as-noop | 0x244 注册为 no-op，体确清 Scene 绘制项动画窗 | raw 25349-25354；132364-132504；stubs.ts:84 |
| op-5-006 | overreach | 0x14B 错误串漏了 `\r\n\r\n` | raw 31082；doc:255 |
| op-5-007 | overreach | 0x2C7「第二字节」表述未反映翻转型前导字节判据 | raw 42319-42337；42341-42359 |
| op-5-008 | cross-source-mismatch | 0x52 短语义行被 rawCited 机械判成 false | index-opcodes.mjs:86；raw 37548-37558 |
| op-5-009 | overreach | 0x1D8 语义句在公式后中断 | doc:330；raw 106467-106506 |
| op6-03 | overreach | 0x323 的 op2/op3 被标成 delay/count，体里只是透传实参 | raw 33918-33921；132834-132843 |
| op6-06 | contradiction | 0x1BD 的 Engine[21315] 清 0 条件被索引截断掉 `\|\|(v&1)` | raw 30031-30043；doc:303 正确 |
| op7-0x305-wrong-raw-anchor | no-evidence | 0x305/0x304 的 emulator 注释 raw 锚点指向别的函数 | msgwin.ts:673,687；raw 26034 / 25385 |
| op7-0x30a-noop-vs-body | contradiction | 0x30A 登记为 no-op，体读 2 操作数、写 1969、可抛异常 | raw 33825-33835；stubs.ts:174 |
| op7-0x53-div-zero-throw-invented | unclear | 0x53 体内无除零检查，「引擎抛除零异常」是推断 | raw 37560-37570；arithmetic.ts:33 |
| op7-0x135-bitset-signed-guard | contradiction | 0x135 有符号比较，引擎是 unsigned ⇒ 负值分支相反 | raw 39402-39421；arithmetic.ts:80 |
| op7-0x21e-stale-div256-comment | cross-source-mismatch | 0x21E 表项注释残留「÷256」，应为 ÷100 | gfx-item.ts:398；raw 4430 |
| op7-0x92-step0-not-modeled | contradiction | 0x92 else 分支置 95805=0（停在原指令），文档/emulator 未记 | raw 29546-29568；20165 |
| op7-0x353-0x361-0x391-phantom-handler-names | no-evidence | 索引把「归属作品」列当 handler 名（本引擎无该出处） | doc:575-610；raw 22722；索引 op=851 |
| op8-F1 | contradiction | 0x1D2「不回写」与体首 arity 槽写入冲突 | raw 29379；20165；doc:324 |
| op8-F2 | overreach | 0x54「除零抛异常」是推断（x86 idiv #DE） | raw 37572-37582；arithmetic.ts:36-41 |
| op8-F5 | overreach | 0x213 读取顺序是 op3→op2，文档写反（数值等价） | raw 31765-31775 |
| op8-F6 | overreach | create-texture 的 `pool[13964+slot]` 未就地定义（等价于 `_this[94672+slot]`） | raw 31171-31189；doc:336 |
| op8-F7 | overreach | 0x1AE 的 BMP/172854 常量属黑盒观测（格式有 0x1AF 旁证） | raw 38516-38550；doc:288,289 |
| op8-F9 | contradiction | 0x2F6 文档仍写「空操作」，实为 op_voice_reset | audio.ts:330-332,448；doc:500 |
| op8-F12 | overreach | 0x1B9 体无 1500/2500 常量（那是语料初值） | raw 29192-29220；doc:299 |
| op9-op200-sleep-direct-path-not-modeled | overreach | sleep 的 n<10 裸 Sleep 路未建模（语料有 51 处） | raw 30287-30314；frame.ts:107-113 |
| op9-op265-doc-attributes-fields-to-this | name-inference | dword_55E1BC 的分辨率字段被写成 `_this[...]` | raw 39095-39096；39111 |
| op9-op170-doc-createfile-constants-wrong | overreach | CreateFileA 漏 FILE_FLAG_SEQUENTIAL_SCAN，失败路写法错 | raw 38148-38173；264 |
| op9-op500-index-emulator-maps-frameTick-onto-dock-lock | unclear | 0x1F4/0x20C 的语义标签三处口径不一（0x20C 确在 OPS） | raw 25193-25212；frame.ts:345,347 |
| op9-op255-input-reset-second-half-unmodeled | overreach | 0x1FF 的帧槽复制 `[cur+122327]=Engine[517]` 未建模 | raw 24997-25009；input.ts:126-130 |
| op9-op415-doc-overstates-modeling | overreach | 0x19F 的 full:false 与 a6=0 的近似关系未写清 | raw 38334-38363；saveSlot.ts:310-352 |
| op-10-004 | host-invented | 0x1CE 对全部 reveal 窗收尾，引擎只对 Engine[122371] | raw 29343-29349；msgwin.ts:647-653 |
| op-10-005 | overreach | 0x326 纹理槽是 op2 不是 op4 | raw 33949-33953；23919/23942-23943 |
| op-10-006 | contradiction | 0x205 同行内 bit16 语义自相矛盾；bit4/bit5 未写 | raw 12314-12315；12250/12256；doc:349 |
| op-10-007 | cross-source-mismatch | 文档行内未转义 `\|` 与索引 split('\|') 双重截断语义 | doc:84,107,349；index-opcodes.mjs:37 |
| op-10-008 | cross-source-mismatch | 0xAF/0x304 的文档行仍「仅映射」，与实现/语料脱节 | raw 24775-24783；25385-25400；msgwin.ts:672-684 |
| op-1/0x1C9-engine-field-offset-4x | overreach | audioDeviceField 的 18656/18660 是字节偏移，应为 4664/4665 | raw 29291；29300-29309；engineFieldIds.ts:225 |
| op-1/0xBF-config-key-name | overreach | 配置键 set:KeepMusicVoice 不存在，实为 set:KeepMusicVolume | raw 29769-29778；4411；doc:174,305 |
| op-1/0x60-random-divzero-comment | overreach | 0x60 的 op2==0 抛的是 ShowMessage，不是除零 | raw 37721-37737；4439；arithmetic.ts:99 |
| op-1/0x141-unsigned-compare | contradiction | 0x141 上界比较是无符号，emulator 有符号 ⇒ 负值行为相反 | raw 31005-31017；engine-fields.ts:193 |
| op-1/0x34F-negative-color-branch | contradiction | 0x34F 的 op2<0 取回当前纹理色未实现，负值被当颜色存 | raw 34793-34822；live2d/runtime.ts:147 |
| op-1/0x2CA-argc-blank | cross-source-mismatch | 0x2CA 的 argc 留空（体长 3 ⇒ argc=1）且体是写 op1 | raw 40086-40099；doc:456 |
| op-1/0x324-noop-frees-effect-objects | gap-as-noop | 0x324 注册为 no-op，体确析构三对象 + 清 [312]（已入账） | raw 25402-25407；65366-65393；doc:525 |
| op-8-F10 | gap-as-noop | 0x327 未注册（已显式登记），语料 1 处命中即停 | raw 33956-33964；stubs.ts:150-152 |

---

## P3 逐条（说明）

P3 共 57 条，全部已在上表逐条列出证据锚点；其中根因需要展开的条目已在 P2 小节之后、P3 汇总表之前以 `### <id> — <一句话>` 的四段式给出（与 P0/P1 同格式），其余条目在上表中一行一条、可独立复核。

---

## 待查（证据不足）

本批 10 个分片的对抗性复核共给出 122 条 verdict，其中 **refuted 9 条、confirmed / partial 113 条，`unclear` = 0 条**，因此「verdict=unclear ⇒ 待查」这一截面为 **空**。下列 6 条是 kind = `unclear` 的 finding（复核后仍成立，但结论本身留有待证前提），仍保留在 `kept` 中并计入统计，此处集中列出供后续定向核查：

| id | severity | 待证的关键前提 |
| --- | --- | --- |
| op-2-12 | P3 | emulator 的 `MsgWindow.endLine` 与引擎 `sub_4691A0` 的记录封行是否同一条通路（若同路，照搬 97055 门会错误压掉显示换行） |
| op-6-07 | P2 | 索引所述 0xBC 机制在 `sub_408CF0`（raw 13514-13543）里，emulator 是否应建模 `Engine[174712]`（当前全仓零引用） |
| op-6-10 | P2 | `sub_4A87A0` 的夹取是否被 emulator 的宿主缝（Pixi drawImage）等价覆盖；`Engine[166964]` 不参与分路是否可接受 |
| op7-0x53-div-zero-throw-invented | P3 | 引擎侧整数除零的可观察响应（SEH 弹窗？崩溃？）在反编译里无证据 |
| op8-F8 | P2 | 0x25B 的加载/异常通路是否需要建模（当前两个字段纯死写） |
| op9-op500-index-emulator-maps-frameTick-onto-dock-lock | P3 | 0x1F4 与 0x20C 的语义标签如何在 index / stubs.ts / opcode-table 三处统一 |

---

## 已排除的误报

复核 verdict = `refuted`，共 9 条，一律剔除（未计入保留数）：

| id | 排除原因（一句） |
| --- | --- |
| op3-005 | 文档 0x346 的括注与体一致；+28/+48 那套字段表是 0x346–0x352 七行共用的布局总表，finding 离开上下文截了一句 |
| op3-006 | `op_window_geometry` 只在 op=112 注册（op=450 的 emulator 字段为空数组），跨源矛盾是把 op=112 的行挂到了 op=450 上 |
| op-4-08 | `_this[92340]` 是 dword 下标 = 字节 369360，该字节有 5 处读取（raw 13910/13923/21114/26023/26090）⇒「无人读」前提源自尺度错误 |
| op6-04 | raw 27142 就是 `v11 = sub_41BF50(_this, 8);`，argc=8 有体依据；该 finding 的修复建议会写坏表 |
| op6-08 | 读取端 raw 24516/24525 本身带 `4*` 换算，emulator 亦按 `4*游标` 换算 ⇒ 不构成语义冲突 |
| op6-13 | raw 39850 / 39836 与 `bits.ts:15-21` 的 enc/dec 逐位等价（异或可交换），key 亦同源（ref.ts:78/102） |
| op325-offsets-swapped-and-module-mislabeled | raw 33932-33936 与 IDA 清单 lst:61794-61822 同时钉死 op1→+0x4D8、op2→+0x4DC，文档与 emulator 都对，被写反的是 finding 自己 |
| op598-operand-read-order | `sub_4ACD10` 原型（raw 2467）证明文档形参对应正确；读序 5→4→3→2→1 与 1→2→3→4→5 取值完全相同（取值器无副作用） |
| op200-doc-field-index-wrong | 被指控的 `(Engine+107440)[6]` 文本不存在；`_this[6]=n` 恰是 `sub_453A60` 自身行为（raw 66110） |

---

## 方法与覆盖

**复核链路**：两轮。第一轮（.tmp/audit/op-1..op-10.json）逐条读 handler 体并对照三方，共 122 条 finding；第二轮对抗性复核（.tmp/audit2/op-1..op-10-verify.json）对每条独立重读 raw、重算 dispatch 表锚点、重数语料、重查 emulator 注册表，给出 verdict（confirmed / partial / refuted / unclear）与修正值。

**关键核验手段**（每条 finding 均可按下列方式独立复核）：

1. **dispatch 表锚点**：按题设字节基址 675996 + 4*op 反算 `*(_DWORD *)(_this + N) = sub_XXXX`，两轮均逐条复算；复核中确认 0x305/0x306/0x307 一带有索引局部编号漂移（见 op3-008）。
2. **体首步长自证 argc**：体首 `_this[30*cur + 95805] = N` 中 N = 1 + 2*argc，用于独立判定 argc（发现 0x2CA 空列、0x309 → 5、0x339 → 7）。
3. **尺度纪律**：`_this[K]`（dword 下标）与 `*(_DWORD *)(_this + K)`（字节）严格区分 —— 本轮 1 条 refuted（op-4-08）与 1 条 P3（op-1/0x1C9）都由这一区分决定。
4. **字段读写点计数**：`grep \bN\b` 与 `grep "_this\[N\]|_this + 4\*N"` 双向，判「只写不读 / 有读点」。
5. **emulator 侧**：抽 `handlers/*.ts` 全部 `[<数字>,` 表项作为注册集合（332 个键），并用 `interpreter.ts:61-68` 的 `resolveHandler`（只查三张 Map + 用户桩、无按名或 range 兜底）确认「命中即 `NotImplementedOp`」。
6. **语料计数**：`^\s*iXXX\b` / `^\s*<mnemonic>\b` 逐文件统计 src/*.txt（941 文件，含 `$1$`/`$3$`/`$5$` 前缀）；注意助记符是 `i` + opcode 十六进制（`scripts/rename-unmnemonic-opcodes.js:71`），本轮因此纠正了 op-3-001 的 `i261` 误读。

**覆盖统计**：分片 checked 合计 = 54+55+59+54+48+59+64+63+61+57 = **574** 个 opcode；输出 kept = 95、dropped = 9、unclear = 0；P0 = 2、P1 = 8、P2 = 28、P3 = 57。复核通过率：113/122 = 92.6%（refuted 9 条 = 7.4%）。

**已知的覆盖缺口**（两轮均未能核到、需后续材料）：各分片 notes 中列出的「仅映射且 semantics 为空」条目（无任何文档断言，只做了锚点存在性核对与语料计数）；索引中 handler 为别的作品名的行（无可审计内容）；以及 op-9 notes 中记明的 `sub_42AEA0` 全帧分支、exe 反汇编层面的 `idiv` 确认两处。
