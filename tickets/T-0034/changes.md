# T-0034 · 过程文档（changes.md）

## 2026-09-14

## 第 1 次变更（2026-09）：取值断言改用夹具 INI；真 INI 只做「结构 + 自洽」

### 现象（本轮 verify 的两条红，与代码无关）

```
✖ 真实 SYS4REG.INI（真游戏 base 那侧）：解析出关键键 ⇒ AssertionError: 50 !== 5（message:MessageSpeed）
✖ applyConfigToEngine：按绑定写入引擎字段      ⇒ AssertionError: 50 !== 5
```
两条都断言**真游戏玩家数据** `%LOCALAPPDATA%\Eushully\<game>\SYS4REG.INI` 的具体取值。
实测该文件在 2026-09-15 0:02:57 被改写（`MessageSpeed` 5→50、`Music` 2→…、字体/其它键同批），
而我们的代码一行未改（`git log` 与 `git diff --name-only` 都不含 `engineConfig` / `arch`）⇒ 测试随开发机状态变红。

### 改了什么（只动测试文件）

| 位置 | 改动 |
|---|---|
| `test/engine-config.test.ts` 头部 | `FALLBACK_INI` → **`FIXTURE_INI`**（确定性夹具）：数值刻意与真游戏默认值**不同**（`Music=3`、`MessageSpeed=7`、`MesWinAlpha=6`、`Voice=2`、`RMouseEvent=1`）⇒ 任何"不小心读了真 INI"的路径会当场断言失败，而不是碰巧通过 |
| 原「真实 SYS4REG.INI…解析出关键键」 | 拆成两条：① **夹具 INI** 的取值断言（确定性）；② **真 INI 的结构 + 自洽**断言（下条） |
| 新增「真实 SYS4REG.INI：结构 + 「配置→字段」自洽」 | 只断言稳定事实：四节俱在、引擎总会写的 8 个键存在且可解析、**每个绑定键在 INI 里 ⇒ 灌进引擎字段的值必须 = 读出来的同一个值（经 map 变换）**、`MessageSpeed` 必须落在 21668（且 21668 不得绑给 MesWinAlpha）。**不出现任何具体数值**；没有真 INI 时 `skip` |
| `applyConfigToEngine` 那条 | 改读夹具（`Music=3` / `MessageSpeed=7` / `Voice=2`），并保留"MesWinAlpha 不得顶掉 MessageSpeed"的分离断言（夹具让两者 7 vs 6，误绑立刻显形） |
| `0xC0 / 0x131 / 0x2CE` 那条 | 改读夹具（`Music=3`、`MesWinAlpha=6`，复位值同步成 6）；`设置界面 opcode` 那条的 `parseIni(iniText())` → 夹具 |

### 判据（三种环境都绿）

| 场景 | 修前 | 修后 |
|---|---|---|
| 真 INI 现值（`MessageSpeed=50`，即本轮实测状态） | ✖ 红（50 !== 5） | **✔ 7/7 绿** |
| base 被改成 `MessageSpeed=999` / `Music=7`（`AMAYUI_SYSTEM_DIR` 指向临时目录） | ✖ 红 | **✔ 7/7 绿**（自洽断言只要求"写进去的 = 读出来的"） |
| base 不存在（同上，指向空目录） | ✖（旧实现回退到内置副本，取值断言仍在） | **✔ 6 绿 + 1 skip**（真 INI 那条自报 skip） |

### 守卫（就是这两条测试本身 + 新夹具）

- `app/amayui-emulator/test/engine-config.test.ts`（7 条：夹具取值 / 真 INI 自洽 / 绑定写入 / 配置类 opcode 覆盖 …）
- 全套：`npm run verify` 全绿（502 → 见 changes 末尾实测）。

## 2026-09-14

### 收尾实测（2026-09）

\
pm run verify\ **503/503 全绿**（修前 502 里 2 红）+ 无新增死写；三份台账守卫 16/16。
