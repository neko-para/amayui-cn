# T-0152 · 音频子系统修复批 · 变更记录

> 上游逐条清单：`docs-new/99-records/2026-09-impl-audit/impl-audit-2026-09.md` §4.1（Track 1）。
> 本轮只动 `app/amayui-emulator/src/**` 与 `test/**`；**未**改 `analysis/`、`src/`、`docs-new/`。

## 第 1 次变更（P1 逐条修复，本次）

### ① `0xc7` `sound:Music` 的开关判据（P1，属 T-0161 但同批一起做）
- 引擎 `sub_42E670`（raw 38678-38714）**逐支口径不同**：`sound:Music` 判 `v >= 0`（**只有负值算关**），
  `SE`/`Voice`/`Movie` 判 `v != 0`。修前 emulator 用同一个 `bool` 统一按「非 0 ⇒ 1」，于是本机 overlay
  `SYS4REG.INI` 的 `Music=0` 下引擎写 1、emulator 写 0 ⇒ **设置界面的"音乐开/关"读反**。
- 落地：`handlers/config-read.ts` 的 `CfgReadSpec` 增 `boolMode`（逐选择器 `nonzero`/`nonneg`），`0xc7` 用它。
- 守卫：`test/config-read.test.ts` 新增「★0xC7：`sound:Music` 判据是 `v >= 0`…」（含 `Music=0 ⇒ 1`、
  `Music=-1 ⇒ 0`、`SE=-1 ⇒ 1` 的反向对照）。

### ② `0xbc`/`0x1ba` 音乐开关的「无需改动 ⇒ 整条早退」（P1）
- 引擎 `sub_408CF0`（raw 13523-13541）：`a2≠0 && v3≥0` 或 `a2==0 && v3<0` 时**什么都不做**（不写配置、
  不停播、不重播）。修前 emulator 照发 `bgm-mode` + `bgm-stop` ⇒ 点"已开"的开关会把 BGM 掐断一次。
- 落地：`handlers/audio.ts` 的 `switchMusicEnable` 改成"先算 `next`，为 `null` 直接 return"。
- ★**同时订正了一条写错的旧断言**：`test/audio-opcodes.test.ts` 的 `0x1BA op1=1` 用例原来断言
  `['bgm-mode','bgm-stop']` —— 它把"错行为"钉成了期望；现改为断言**零意图**，并补"已关再关也早退 /
  关→开 −2+3=1"。

### ③ `0x2c0`/`0x2f5` 排队语音的**循环位**（P1，`0x2f5` missing-behavior）
- 引擎：`sub_4BBA40`（raw 142562-142571）把 op2（"附带值"）写 `Voice[ch+277]`；到期起播
  `sub_4BBAB0`（raw 142661-142667）把它取 **bit0** 当第 4 实参交给 `sub_4BB840` → `sub_4B6020(设备, ch+12, 位)`
  → `sub_4B73E0`（播/循环）。同族旁证：SE 的排队指令 `0x2BF` 把 op2 直接叫**循环标志**。
- 修前 `AudioEngine.voiceQueue` 硬编码 `loop: false`。落地：`loop: (aux & 1) !== 0`。
- 守卫：`test/audio-engine.test.ts` 新增两条（`op2=3 ⇒ loop=true`、`op2=2 ⇒ loop=false`）。

### ④ ★**推翻**两条 P1：「op2 是 pan」（`0x2c0`/`0x2f5` 的 missing-operand-io）
- 审计（含复核）称 `sub_4BB840` 第 5 实参 = `Voice[5053+ch]` = 排队时写下的 op2 ⇒ "pan 被丢弃"。
- 本轮逐字复核**地址算式**后判定**不成立**：`sub_4BBAB0` 的第 5 实参地址
  `= (char*)v3 + 设备基址 + (488 − Voice 基址)`，其中 `(char*)v3 = Voice + 4·(265+ch)`
  ⇒ 化简 = `设备基址 + 1548 + 4·ch` = **`设备[387+ch]`**，即**该语音通道当前的 pan 槽**
  （由 `0x2F8` → `sub_4B6940(设备, ch, pan)` 写：`375 + 12 + ch`，语音通道号是 12..14）。
  ⇒ 引擎在第 5 实参上做的是"把**通道当前 pan** 再下发一次"，与排队时的 op2 无关；op2 只贡献 bit0（循环位）。
- 处置：**不实现 op2→pan**（避免造出假语义），并加守卫
  `test/audio-engine.test.ts`「★0x2F8 的 pan 与排队 op2 无关：排队起播沿用通道当前 pan」。
- ⇒ `T-0152` 的 acceptance 中这两条按"复核后判定为非缺口"结案，依据写在本文件与 `notes.md`。

### ⑤ `0xc4`/`0x1bd` 的语音槽二态翻转协议（P1）+ 该族的槽建模
- 引擎 `sub_420F70`（raw 29872-29889）：`[21315]`/`[21318]` 两格各做一次二态翻转
  （`0x10000` 已置 ⇒ 清 0；否则有 bit0 ⇒ `| 0x10000`）；末尾 raw 29910-29911 `if (Engine[21293]) Engine[122501] = 1`。
- 立项时该协议在重写侧**完全不存在**。为让它有真实输入，同一轮把该族的槽也补上：
  - `0x2F7` 写 `Engine[21315+ch] = 1`（`sub_426890` raw 33694-33703）
  - `0x2FF` 写 `[21318+ch] = 1`、`[21321+ch] = op2`（`sub_426940` raw 33728-33740）
  - `0x302` 写 `[21318+ch] = 0x10000`、`[21321+ch] = op2`（`sub_426A30` raw 33767-33777）
  - `0x2F6` 清四格 `[21315/21318/122505/122508 + ch]`（`sub_426820` raw 33685-33690）
  - `0x1BA op1=3`（语音开关）写 `Engine[21293] = on`（`sub_408E20` raw 13573-13599）
- 新增字段：`ENGINE_FIELD.voiceChannelFactorValueBase`(21321)、`ENGINE_FIELD.voiceEnabledField`(21293)。
- 守卫：`test/audio-opcodes.test.ts` 两条（槽写入 + 翻转协议 4 步 + `122501` 两面）。
- 仍未建模（登记在原报告 §4.2，不在本票范围）：`0x2F6` 末尾 `Engine[122501] = sub_404CB0(Voice)`
  （"3 路是否有正忙"是宿主状态查询，VM 无同步回读口）。
