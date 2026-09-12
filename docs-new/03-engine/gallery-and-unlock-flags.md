# 03-engine · 回想/鉴赏与「已使用文件」解锁标志

> 面向「回想（EU-ROOM）」这条界面链：四个按钮（CG 鑑賞 / シーン回想 / BGM 鑑賞 / 情報画面）上的
> `回収数`·`回収率`、以及 BGM 鑑賞列表里哪几首显示曲名 —— **全部**由引擎的
> **「已使用文件」表**（FileDB 内的一张按统一文件 id 索引的哈希表）决定。
> 本文是该子系统的主题件；opcode 逐条语义见 `opcode-table.md`，函数/字段证据见
> `analysis/functions.json` / `fields.json`，常态行为见第二层台账 `gallery-unlock-file-used-flags`。

---

## 1. 界面链（谁调谁）

| 脚本（统一 id） | 角色 | 入口 |
|---|---|---|
| `TITLE.BIN` | 标题菜单；**菜单项 2 = 回想** | `TITLE.txt:314 menu-dispatch (local-int 3f7)` → `menu-bind 2` 的分支 → `:365 call-script 526c` |
| `ROOM.BIN`（0x526c） | EU-ROOM：背景 + 四个按钮 + 每个按钮的收集数 | `play-bgm 29` → **`call-script 524c SETMEMOIR`** → 轮询输入 |
| `SETMEMOIR.BIN`（0x524c） | **无画面**：算 CG / 场景 / BGM 三套收集度 | 由 ROOM 调（`:68` 进界面、`:412` 从 HMODE 回来） |
| `CGMODE`（0x524d）/ `HMODE`（0x524e）/ `MMODE`（0x524f） | CG 鑑賞 / シーン回想 / **BGM 鑑賞** | ROOM 的按钮 1 / 2 / 3（`ROOM.txt:405/411/418`） |
| `MUINIT.BIN`（0x521e） | **BGM 元数据表**：文件 id / 曲号 / 曲名 三张 1-based 表 | 本体 `INIT2.txt:100` |

按钮序号（`ROOM.txt` 的 `local 106`）：**1 = CG 鑑賞、2 = シーン回想、3 = BGM 鑑賞**、4 = 情報画面。

---

## 2. 「已使用文件」表（本子系统的核心）

### 2.1 结构

`FileDB`（= `Engine+680092`，`sub_454A20` 构造）里每个「包」一张 **DWORD 数组**，
槽位就是统一文件 id（扩展包用低 24 位）：

| 表 | 地址 | 说明 |
|---|---|---|
| 本体 | `FileDB[263]`（字节 `+1052`） | 槽 `[id]` |
| 扩展包 n | `FileDB[3601+n]`（字节 `+14404+4n`） | 槽 `[id & 0xFFFFFF]`，n = `id >> 24` |
| 防篡改副本 | `FileDB[3342]` / `FileDB[3858+n]` | 槽值 = `sub_499650((u16)值, 密钥)`；密钥由构造函数 `srand(timeGetTime())` 抽两个随机素数（raw 67142-67164） |

### 2.2 写：只有「按 id 打开文件」会打点

`sub_4559C0`（按统一 id 打开文件；`FileDB` 的唯一取字节入口）在拿到文件句柄后调
**`sub_454960(FileDB, id)`**（raw 67832 / 67882 两处调用点）：

```
本体：  表[id] = 87912345*id − 1330597712          （低 16 位 ≡ 28569*id − 20304）
扩展包：表[id & 0xFFFFFF] = 同上（按包选表）
```

⇒ **语义 = 「这个文件曾经被打开过」**。另有一个写任意值的入口 `sub_404A70(FileDB, id, value)`
（raw 40445），只被 `$$SAVE.DAT` 的**装载**路径调用（`sub_40AAE0` raw 15218/15234/15276）。

### 2.3 读：`0x19D`（`sub_42D8E0` → `sub_4181F0`）

```
op1 ← (FileDB 表[id] 的低 16 位 == (28569*id − 20304)) ? 1 : 0
```

- 表指针为空（还没装载 `$$SAVE.DAT`）或哈希不符 ⇒ **0**（= 未收集），**不抛异常、不打日志**；
- 高字节 ≠ 0（扩展包资源）时另有一道门：`set:SaveVersion1 < 3`（或 `==3` 且 `set:SaveVersion2 < 10`）
  ⇒ 一律 0（旧存档不认扩展包资源，raw 38275-38281）。

### 2.4 持久化：`SAVE.DAT`（**不是** `RT.DAT`）

整张表随**同一个 `SAVE.DAT`** 一起存：payload 的**第一块**（int 块）就是它（写 `sub_40AAE0` raw 15034-15074
→ `sub_438320` 的 a7/a8；装载 `sub_40AEE0` raw 15202-15238）：

```text
块 A（本体）：[key1 ^ 0x87912345][key2][槽值 × N]     槽下标 = 统一文件 id；非 0 = 该文件被打开过
块 B（扩展包，仅 3.10+）：payload 尾部 [256 项每包文件数][u32 长度][块B][终止 0]
```

- 布局判定：引擎按配置里的 `set:SaveVersion1/2` 决定有没有那 2 dword 头，而同一组版本号也决定头的
  `format ≥ 3` ⇒ 读侧用 `format ≥ 3` 判别（本机真存档 = `format=3` ✓ 实测相符）。
- **`RT.DAT` 不是进度的载体**：它是"续玩"文件（`sub_48EB60`，对象 `Engine+320428` = ADV 文本状态），
  与鉴赏无关（见 `save-data.md` §4）。
- 真机实测（2026-09）：`SAVE\SAVE.DAT`（161,584 B，format=3）⇒ `intCount = 21111`
  （= 本体 21109 文件 + 2 头）、**已使用文件 11106 个** ⇒ 回想界面 `CG 797/1269、シーン 14/23、BGM 31/36`。

---

## 3. `SETMEMOIR` 算出来的三套表

`SETMEMOIR.BIN`（157 行）用 `0x19D` 逐条提问，把结果写进三套全局表：

| 套 | 源表 | 结果 | 收集数 / 收集率 |
|---|---|---|---|
| CG | `107a0c[i][0]`（i = 1..3000，stride 3） | `10e3af[页][槽] = i`（未收集 = `-1`） | `10e3ad` / `10e3ac` |
| 场景 | `122271[组][槽]`（28 组 × 8） | `12251c[组][槽] = 1` | `12251a` / `122519` |
| **BGM** | `12265c[i]`（i = 1..64，**统一文件 id**，MUINIT 填） | **`122731[i']` = 已收集下标**（1-based） | `12272f` / `12272e`（= `12272f*64/122730`） |

- `122730` = 非空条目数（本作 BGM = **36**），`122731[0]` 恒 0（写从下标 1 起）；
- 判据方向：`jcc (local-int 1) ffffffff label_…`（`i19d` 的结果为 0 时跳走）⇒ **只有"已收集"才写表**；
- ROOM 的四个按钮把 `10e3ac/10e3ad`、`122519/12251a`、`12272e/12272f` 直接当数字画出来。

`MUINIT.BIN` 的三张 1-based 表（本作 36 条 + 表尾两条 OP/ED 影片曲）：

| 下标 | `12265c[i]`（文件 id） | `1226c0[i]`（曲号） | `3629[i]`（曲名） |
|---|---|---|---|
| 1 | 0x147 | 2 | 『infinite knots Game size』（OP 影片） |
| 2 | **0x17** | **0x1f** | 『現に輝いて』（= `BGM031.OGG`，标题曲） |
| … | … | … | …（33/36 条满足 `FileDB[id].名字 == BGM<曲号>.OGG`） |

---

## 4. `MMODE`（BGM 鑑賞）怎么画

1. `local263 = 5 + 122730`（列表行数 = 41 → 三列 × 13 行的布局）；
2. **第一件事 `i0b8`**（`0xB8` = 停 BGM，停下 ROOM 那首）；
3. 逐行 `122731[行]` → 若为 0 ⇒ 画 `UNKNOWN`，否则 `1226c0[下标]`/`3629[下标]` 取曲号与曲名；
4. 底部 `i23b` 画 `回収数 12272f` / `回収数 122730` / `回収率 12272e`；
5. `i21d 0 7d0`（`0x21D` CopyScene）把预置的全屏过渡幕布（handle 0）复制成 `0x7d0`，随后用
   `set-draw-color 7d0 …` 只改那一份做淡入淡出。换曲试听时同样先 `i0b8` 再起播。

> ⇒ 列表**不做**"只列已收集"的过滤：它画满 36 行，用 `122731[行]` 区分曲名 / `UNKNOWN`。

---

## 5. 这条链上被跳过的四条指令（2026-09 用户实测：BGM 列表空白）

| opcode | 引擎 | 语义 | 跳过后的症状 |
|---|---|---|---|
| `0x19D` | `sub_42D8E0` → `sub_4181F0` | 「该统一文件 id 是否已被打开过」 | ★三套收集表全 0 ⇒ 四个按钮 `回収数 0`、BGM 列表**整片 UNKNOWN**（实测：36 条曲目、0 条收集、收集率 0） |
| `0x1BF` | `sub_419840` | 按 `Engine[122504]` 置**跳读态** `122503` | `play-bgm` 的"语音在播时暂停 BGM"分支与真机相反（快进时把 BGM 压下去） |
| `0x21D` | `sub_423C60` → `sub_4AC0D0` | `Scene::CopyScene`：复制绘图项（+网格） | 过渡幕布复制不出来 ⇒ 后续 `set-draw-color 0x1f4/0x7d0` 全落空、界面切换没有淡入淡出 |
| `0xB8` | `sub_419720` | **停 BGM**（清 `effect_flags` bit0x200 + 推进淡出 + `sub_489B50`） | 进 BGM 鑑賞 / 换曲试听时不停上一首 ⇒ 与 ROOM 的 BGM 叠在一起 |

---

## 6. emulator 现状

- **已实现**（2026-09，见 `app/amayui-emulator/docs/06-function-status-registry.md`）：
  - `Engine.usedFileIds`（键 = **完整统一 id**，天然分"包"）+ `markFileUsed()`；
    打点三处：`0x1F9` set-texture（载图 ⇒ CG/场景收集）、`play-bgm` 的曲号解析命中
    （⇒ BGM 收集，引擎在 `sub_48DB80` 里就打开了文件）、脚本装载（call-script / `i143`）；
  - `0x19D`（`handlers/resource-usage.ts`，含扩展包版本门）；`0x1BF`（`handlers/engine-fields.ts`）；
    `0xB8`（`handlers/audio.ts` → `{kind:"bgm-stop"}`）；`0x21D`（`handlers/gfx-item.ts` →
    `NativeBridge.copyScene` → `scene/ops.ts` 的 `scCopyItem`）；
  - **持久化**：`saveData.ts` 解 `SAVE.DAT` 开头那块（`SaveDataUsage`）并写回同块；
    启动时 `NodeFileSource.readSaveFlags()` / 主进程 `read-save-flags` 把 overlay 与 base **取并集**
    （进度是单调集合）⇒ 直接继承玩家真存档的鉴赏进度。
- **守卫**：`test/gallery-bgm-list.test.ts`
  - E3：真实语料启动到 TITLE（其间 `play-bgm 1f` 解锁标题曲）→ 直接调 `SETMEMOIR`（0x524c）⇒
    断言 `122730 = 36`、`12272f ≥ 1`、`122731[1] = 2`（= 下标 2 = 文件 id 0x17 = `BGM031.OGG`）、`12272e = 2`；
    并断言这条路径上**不得再有未知指令**（修好前是 `0x19D×1`）；
  - 单元：`0x19D` 的查询/版本门、`0x1BF` 的三支、`0xB8` 的意图、`0x21D` 的复制语义。
- **E4（真机 Electron）**：`npm run shot -- --gallery`（回想 → BGM 鑑賞）——
  `.tmp/gallery-save-4-room.png`（四按钮：**CG 797/1269、シーン 14/23、BGM 31/36 回収率 86%**）、
  `.tmp/gallery-save-5-bgm-list.png`（31 首显示曲名，5 条 `UNKNOWN`，底部 `回収率 86%`/`回収数 31/36 曲`）。
  ——这些数字**全部来自玩家真存档**（`%LOCALAPPDATA%\Eushully\天結いキャッスルマイスター\SAVE\SAVE.DAT` 的
  「已使用文件」块，11106 条），与用户在真机看到的进度一致。
- **缺口**：
  1. **扩展包 flag 块（块 B）未解**：它用"跨包线性下标 + 256 项每包文件数表"编码，本工程暂未实现
     （布局已记在 `save-data.md` §3.5）。基础版的 36 首 BGM / 1269 张 CG 全是本体 id ⇒ 本机实测不受影响。
  2. CG/场景两套收集表依赖 `107a0c`/`122271` 等源表（由 `CGINIT`/`EUINIT`/`$n$EUINIT` 等填），
     本工程只验证了 BGM 段（36 条）与 ROOM 的四个按钮数字。
  3. `0x21D` 只复制 DrawItem（+网格存在性）；引擎第二张 map 的顶点缓冲重建属 D3D 专用，不建模。
  4. **overlay 旧副本缺 flag 块**：2026-09 之前的 `encodeSaveData` 不写这块，于是本工程 overlay 里那份
     `SAVE.DAT` 会**遮住**真存档的进度（读侧 overlay → base）。现已：① 写侧带上标志；② 启动时
     `readSaveFlags()` 把 overlay 与 base **两侧取并集**（进度是单调集合）⇒ 老 overlay 也不会丢进度。
     `save-data.md` 里那句"删掉 `.overlay\` 再启动"仍是最后的兜底手段。
  5. 扩展包资源（统一 id 高字节 ≠ 0）的收集判定还要过 `set:SaveVersion1/2` 这道门（引擎 raw 38275-38281）。
