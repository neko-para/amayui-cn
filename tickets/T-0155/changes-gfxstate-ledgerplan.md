# T-0155 · 台账落地计划（`changes-gfxstate.md` §3 → `analysis/*.json`）

> 由 scribe 子 agent 抄写；真源 = `engine/天结_unpacked.exe_utf8.c`（raw = 1-based 行号）。
> 计划文件：`.tmp/scribe-b/plan.json`（§3.A + §3.B 主体，**已应用**）+ `.tmp/scribe-b/plan-delta.json`（收尾修正，**待应用**）。
> 生成器：`.tmp/scribe-b/gen-plan.mjs`。

## 1. §3.A `analysis/engine-capabilities.json` · `gfx-prim-mesh-and-render-state`（已应用）

| 动作 | 现值 | 新值 |
|---|---|---|
| `reads` 替换第 5 行 | `Engine[92338]/[92339]（画布尺寸对）` | `Engine[92338]/[92339]（0x238 装载 / 0x243 复位的**等待计时器**起点+时长；读者 sub_407E20 raw 12762-12786 与主循环 raw 21109 —— 不是「画布尺寸对」）` |
| `reads` 新增一行 | — | `Engine[92340]（0x24E 写、0x243 读 bit1 做门；raw 32965 / 26016-26031）` |
| `reads` 替换第 7 行 | `Scene+1872/+21872 的两张纹理槽标志镜像表` | `Scene+1872/+1876 与其镜像 Scene+21872/+21876（0x258 写的四格；★镜像表在 emulator 侧缺失）` |
| `engine.raw` | `31303-31345` | `25277-34448` |
| `emulator.note` 追加 | — | `0x258` 镜像表缺 + 四格只写不读（回链 T-0154）；`0x32d` 轴向按体；`0x20e` 双 Clear 与 `0x24f` 工作纹理检查**仍未建模**（各带票 T-0155） |

体证：`sub_4248C0`(0x238) raw 32309-32310 写 `Engine[92338] = 0` / `[92339] = op1`；`sub_407E20`
raw 12768-12783 用 `11630/11631`（= Scene 基址 `80708` 换算后的同一对格）判 `now > start + ms` 并清零；
主循环 raw 21111 每帧调它；`sub_4258C0`(0x24E) raw 32965 是 `Engine[92340]` **全文件唯一写点**；
`sub_41B180`(0x243) raw 26023 读 `(*(_BYTE*)(_this + 369360) & 2) == 0`（369360 = 92340*4，bit1）；
`sub_425D20`(0x258) raw 33163-33183 写 `result[468]/[5468]`、`result[469]/[5469]`，全文件只有写、没有读。

## 2. §3.B `analysis/opcode-gaps.json`（已应用）

| 目标 | 现盘状态 | 计划里的动作 |
|---|---|---|
| `0x32`(50) | 原先**不在册** → 现 `partial` + 1 条 `missing`（`27984-28000`，GDI 支） | `appendEntries`（新建整条：`note` 写明 handler 已达语料级可用、语料 337 处、守卫 `test/op-032-stretch-texture.test.ts`） |
| `0x20e`(526) | 同上 → `partial` + `25280-25286`（门成立时双 Clear，两格无置位点） | 同上（语料 786 处 / 342 脚本） |
| `0x24f`(591) | **已在册且已等价登记**（承接票同为 T-0155、raw `133744-133782`） | **改写**既有那一条（不 append 重复行）：补 `ensureWorkingTexture(slot,w,h,renderTargetId)` 缝 + 宿主侧槽对象表 + 「记录那一半不受影响（两支都汇到 `LABEL_8`）」；raw 收紧到 `133743-133783` |
| `0x258`(600) | 原先不在册 → `partial` + `33163-33183`（镜像表无对应物 + 四格只写不读） | `appendEntries`（语料 **11356 处 / 334 脚本**，本批用量最大） |
| `0x33f`(831) | 原先不在册 → `partial` + `34446`（`Scene+1264` 效果常量通路缺消费端） | `appendEntries`（语料 1 处 `src/SETWEATHER.txt:80`） |
| `0x321`(801) | 现为 `partial`（**不是报告写的 `implemented`**），`missing[1]` 已经就是「引擎无范围校验」 | `note` 追加范围口径句（raw 33848-33849 / 132803-132805）。★与既有 `missing[1]` 内容重叠，已在报告里披露 |

4 条新建条目的 `disposition` 都取 `partial`（四条的 handler 都**已注册**且达语料级可用 ⇒ 符合
`build-opcode-gaps.mjs` 对 `partial` 的前提：`registered.has(op)`），`missing[]` 各 1 条、`ticket` = `T-0155`。

## 3. §3.C `analysis/fields.json`（**故意没做**）

报告标「可选，若 `T-0108` owner 认为值得」，且 `fields.json` 归 `T-0108`；派单也未点名
⇒ 未转写。需要时可按同一模板再产一个计划文件（`Engine/0x5A2A8`、`0x5A2AC`、`0x5A2B0` 的 `meaning` 各追加一句）。

## 4. 收尾修正（`plan-delta.json`，待应用）

与 T-0153 共用同一个 delta 文件；本票相关的只有 `0x246` 的 `note` 计数（那是 T-0153 的条目）。

## 5. 应用后的验证口径

```bash
cd app/amayui-emulator
node --import tsx --test test/opcode-gaps.test.ts        # partial 棘轮 + md 最新性
node --import tsx --test test/capability-ledger.test.ts  # 能力台账 schema + guard 有效性
# ★能力台账 md 必须重跑（reads/engine.raw/fns 会被渲染）：
node scripts/build-capabilities.mjs
```
