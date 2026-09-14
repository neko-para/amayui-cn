# T-0030 · 过程文档（changes.md）

## 2026-09-14

# 变更记录（T-0030）

## 第 1 次变更（2026-09）：把 SAVE.DAT 的装载/回写与 SYS4REG.INI 解耦

### 改了什么

| 文件 | 改动 |
|---|---|
| `app/amayui-emulator/src/renderer/app/configBoot.ts` | `loadEngineConfig` 拆成两行顺序调用：`await loadConfigIni(e, trace)` + `await attachSaveDataPersistence(e, trace)`。原函数体拆为 **`loadConfigIni`**（只管 `SYS4REG.INI` → `e.config` + 引擎字段 + 配置回写；缺 INI 只 trace，不再 `return` 掉后半段）与 **`attachSaveDataPersistence`**（`loadSaveData` + `e.onSaveDataChanged` 接线；**无条件执行**，`io.write` 可注入 ⇒ 可单测）。同时消掉了另一条同型隐患：INI 读取**抛错**时走的 `catch` 也不再连坐 SAVE.DAT |
| `app/amayui-emulator/test/save-data.test.ts` | +1 例守卫（stub `window.api`：`readConfigIni → null`、`writeSaveData` 收字节；断言表被装载、`onSaveDataChanged` 已挂、触发一次写盘） |

**刻意不做**（记录在案）：`onConfigChanged`（`SYS4REG.INI` 回写）仍只在**已有 INI** 时接线 —— 本票只要求"不得连坐"。
首次运行若想连 INI 也自动生成，是另一条独立决策（涉及 `formatIni` 的键集与主进程的防丢键棘轮），不在本条范围。

### 判据（先红后绿）

`test/save-data.test.ts` 的新例：把 `loadEngineConfig` 临时改回"无 INI 就 `return`"⇒ **红**；恢复 ⇒ **绿**。
全量 `npm test`：491 例，失败项与改动前**逐条相同**（既存 7 个：Windows 路径/配置类）。

### E4（Electron 产品路径，jp 资源，两次运行）

清空 overlay 后连跑两次 `ELECTRON_DISABLE_SANDBOX=1 npm run shot -- --gamestart --name savefixN`（日志存 `evidence/`）：

| | 首次运行 | 重启（第二次） |
|---|---|---|
| 装载 | `[save] 无 SAVE.DAT（首次启动：脚本将走 INITCONFIG 默认值分支）` | `[save] AmayuiEmulator（format=0，3042 个 int / 5 个 string，已使用文件 70 个）⇒ 脚本将走 LOADCONFIG 分支` |
| 落盘 | `[main] save data <- …/天結いキャッスルマイスター.overlay/SAVE/SAVE.DAT (84188 bytes)`（随后 84400/84464/84576/84640…132652 递增） | `[main] save data -> …(overlay, 133576 bytes)` |
| 脚本分支 | `0x51dc -> INITCONFIG.BIN` + `0x51c8 -> INITCHARM.BIN`（首次，符合预期） | `0x5258 -> LOADCONFIG.BIN` + `0x51c3 -> LOADCHARM.BIN`（**不再** INITCONFIG/INITCHARM） |
| 文件 | overlay 里出现 `SAVE/SAVE.DAT` | 同一份被读回（`overlay` 侧） |

⇒ 玩家数据（设置开关、饰品/侧栏编辑经 `CHARMEDIT`→`save-int`、鉴赏标志）现在**首次运行就落盘、重启即恢复**。

### 仍未做 / 待人工确认

- **UI 层复核**：进 ADV 侧栏「設定変更」（= `CHARMEDIT`）改一项 → 退出 → 重启 → 该项保留。日志链路已证（LOADCHARM 会执行 `load-int` 读回 `global-int 13b0` 数组），但"画面上的值确实保住"请用户跑一次确认。
- 存档槽 `SAVEnn.DAT` / `RT.DAT`（`0x1A0` 读档）= `T-0018`，与本条无关。

## 2026-09-14


## 附：对 T-0030"刻意不做"那段的范围纠正（2026-09）

原文写的"首次运行若想连 INI 也自动生成，是另一条独立决策…不在本条范围"**措辞过于轻描淡写**，用户追问后复核，事实是：

- 设置走两个独立载体，但**每一行设置只走其中一个**（2026-09 订正，见 T-0031 notes）：`save-int`/`save-string`（29+5，颜色/字体名/部分开关）→ SAVE.DAT；配置族 `i2cd`/`i2e8`/`i1b5`/`i2e7`/`i1b9`（9，**消息速度/自动翻页/滚轮推进**）→ 配置注册表（INI），**没有** SAVE.DAT 副本。
- 启动时 `LOADCONFIG.txt:6-33` 只把 **SAVE.DAT 的脚本全局量**读回（槽集合与 CONFIG1 的 save-int 一一对应，已比对）；**没有任何脚本把值推回引擎字段** ⇒ 引擎字段层（`message:MessageSpeed`/`MessageFade`/`display:ScreenMode`/`sound:*`/`message:RMouseEvent`）+ `boot.ts:76` 的 `audioBootIntents` 的**唯一**启动来源就是 INI。
- 无 INI 时 `setConfigValue` 会按需造空注册表并调 `e.onConfigChanged`，但该钩子未接线 ⇒ 改动只活在内存里，重启回默认。

⇒ 所以"自动生成 INI"**不是**为本票（用户报的侧栏编辑/设置开关）所必需（那一半在 SAVE.DAT，已修并 E4 验证），但它**是**一个真实的、用户可感知的缺口（音量/消息速度这类引擎字段层跨会话丢失）。已拆成 **T-0031** 跟踪，并把"为什么需要单独定内容策略"（脚本侧没有配置键集来源 ⇒ 首次只能写部分键集 + 主进程防丢键棘轮）写进那张票的 why。

### 引擎侧的存储事实（2026-09 再订正，影响 T-0031 的方案）

按 raw 复核：引擎**不写 SYS4REG.INI**（`aSys4regIni` 只在 `sub_4900F0` 做路径/存在性检查）；它的持久化导出端是 `sub_490590`
（**固定顺序全量枚举** 53 次 `GetConfig` → 写 **HKCU 注册表**），键表/默认/顺序由构造 `sub_491880` 写死（104 int + 17 string）。
INI 是**只读输入**（`sub_492CB0` 解析 → 叠盖默认）。⇒ 我们"写回 INI"是跨平台替代，形态应对齐引擎：**固定顺序 + 全量**（T-0031 验收已按此改）。
