# T-0193 · 变更记录

> 本票从 `T-0187` ③ 拆出（用户 2026-09-27：「将目前的错误 reset 情况记录成新 ticket」）。
> 同症状的**坐标系那一半**（`cellFrameOf` 的 mode 1 漏窗框原点 + 删无依据的满屏启发式）留在 `T-0187`，
> 守卫 `test/msgcell-follow-text-frame.test.ts`；两半的分界见 `tickets/T-0187/recheck.md` §5.12。

## 1. 症状

用户实测（在 ADV 里）：**SC0000 的 ▼ 画到了屏幕右上角**（预期 = 下方 ADV 窗的右下角）。
复现链：TITLE 读 77（SC0000，正常）→ 游戏内读 78（序章 SN0000）→ 再游戏内读 77 ⇒ ▼ 位置不对。

## 2. 根因（两半，缺一不成立）

| 半边 | 事实 | 证据 |
|---|---|---|
| (a) 坐标系 | `0x73` 的 mode 1 分支在 emulator 里**漏了窗框原点** `win+12/+16`，把「笔位」（窗内表面坐标）当屏幕坐标 ⇒ `(890+155, 110+61) = (1045,171)` = 右上角 | raw 71352/71354（`v8 = v6[20] + *(v6[12]-20) + v6[3]`）、71373/71375（mode 0） |
| (b) 场景态复位（本票） | `Font+1392`（= `Engine[21672]` = `followTextMode`）是**场景态**，emulator 只有 `i1b1` 一个写点；读档 / `exit-script` 没有把它带回引擎初值 ⇒ 序章的 `NOVEL.txt:8 i1b1 1` 跨过读档边界 | raw 18077 + 18025→78951（整体复位 `sub_40DF10`）；`sub_410160`（装载）不写它 |

修掉 (a) 之后、复位仍缺 (b) ⇒ mode 1 + 笔位 ⇒ `(890+155+190, 110+61+557) = (1235,728)`（y=728 超出 720 ⇒ ▼ 整块屏外）。

## 3. 写点普查（`Font+1392`，四种写法全查 + 装载函数的全部批量写）

| 写点 | 位置 | 何时跑 |
|---|---|---|
| `0x1B1`（`sub_41FEA0`） | raw 29161 | 脚本 `i1b1`：全语料只有 `NOVEL.txt:8 =1`、`:266 =0` |
| Font 构造 `sub_464FD0` | raw 78766 | 只构造一次 |
| 整体复位 `sub_40DF10` | raw 18077（直接清 `Engine+86688`）+ 18025 调 `sub_465390` ⇒ raw 78951 | engine 构造（22721）与 `exit-script`（`0x9` = `sub_428A60`，35270） |

`sub_410160`（读档）**不写它**；`exit-script` 语料 **339 处**（`SC69xx` 章末 / `GAMEOVER.txt:265` / `GAMECLEAR`…）⇒ 缺口在正常流程里可达。

## 4. 修法

- 新增 `Engine.resetFontSceneState()`（`src/vm/engine.ts`）：按 raw 复位值写
  `colorFill = 0xFFFFFF`（raw 78891）/ `colorOutline = 0`（78892）/ `outlineMode = 1`（78894）/ `followTextMode = 0`（78951 + 18077）；
- 调用点 = **三处装载点**（`restoreEngineSlot` 真槽续跑、本工程状态块续跑、续不上时的 `transferToRootAfterLoad`）
  + `op_exit_script`（`0x9`，raw-proven 的整体复位）。
- 复位之后由**重跑的脚本入口**按场景重新设定：序章链 `NOVEL.txt:8 i1b1 1` ⇒ 跟随笔位；章节链 `SYSTEM4 > SC0000` 不设 ⇒ 固定位。

## 5. 实测（实例 `t0187f`，新产物；`[cell]` 行取自 `.tmp/instances/t0187f/log/amayui-emulator.log`）

| 状态 | 修前 | 修后 |
|---|---|---|
| TITLE 读 77（冷） | `(1080,667)` | `(1080,667)` ✓ |
| 游戏内读 78（序章） | `(730,364)` | `(730,364)` ✓ |
| **再游戏内读 77** | **`(1235,728)`（屏外）** | **`(1080,667)`** ✓ |

★用户 2026-09-27 目视确认位置正确。

## 6. 守卫

- `test/exit-script.test.ts`：「★exit-script(0x9)：Font 的**场景态**回引擎初值（填充白 / 描边 0 / 档位 1 / `Font+1392`=0）」；
- `test/slot-load-resume.test.ts`：读档用例里新增三条断言（读档必须把 `Font+1392` 归 0 / 填充回白 / 档位回 1）；
- 跑过的相关文件：`slot-load-resume 5/5`、`exit-script 4/4`、`slot-load-screen 3/3`、`slot-load-transfer 3/3`、`save-slot 10/10`、`engine-slot 9/9`、`char-reveal 20/20`、`adv-msgwin 37/37`、`text-layout 18/18`；`tsc`（含 `tsconfig.test.json`）干净。

## 7. 口径披露 / 未做项

1. **复位值**有 raw 锚点；**复位点**放在读档的控制转移 / 续跑入口是**推断**（raw 的 `sub_410160` 不调 `sub_40DF10`），
   依据 = 用户口径「引擎不会出现这种明显的 bug，加载存档总是可以正确恢复表现」+ 该处已有的同口径面板/文本复位。
2. 真机只读确认（可选）：78→77 那一刻 `Engine+0x152A0`（`Font+1392`）应为 **0**、序章档应为 **1**；
   采样器 `.tmp/t0187-recheck/watch-engine.ps1` 已含 `follow=+0x152A0` 列。未做。
3. `Font+1368`（`_this[21666]`）在 emulator 里没有建模，故复位只写已建模且被读的四个字段（避免"写死后无读者"的字段）。
