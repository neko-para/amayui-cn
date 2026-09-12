# 脚本台账（`src/*.txt` 逐个记）

> 由 `analysis/scripts.json` 生成：`node scripts/build-scripts.mjs`。**勿手改。**

这一层回答的是：**游戏自己的脚本长什么样、怎么跑通**（界面流程 / 演出 / 消息 / 配置读写）。
三层数据层分工：

| 层 | 文件 | 回答 |
|---|---|---|
| 一 | `analysis/functions.json` + `fields.json` | 某个 `sub_XXXXXX` / 偏移**是什么** |
| 二 | `analysis/engine-capabilities.json` | 引擎有哪些**持续行为**（枚举 opcode 看不出来） |
| 三 | `analysis/scripts.json`（本层） | **这个脚本**是什么、内部结构、关键槽、不变量、坑与缺口 |

## 覆盖率

`src/*.txt` 共 **941** 个，其中**已登记 20** 个（不是"已全部读过"，是"读过并落库"）：

| 状态 | 条数 | 含义 |
|---|---|---|
| `analyzed` | 9 | 结构 + 关键路径都读过并落库（未读到的部分写在 notes） |
| `partial` | 11 | 只读了用到的部分（layout 里逐条列出的就是读过的范围） |
| `stub` | 0 | 只登记『它是谁 / 谁调它』，正文未读 |
| **合计** | **20** | 分母 941（`node .agents/skills/amayui-engine-analysis/scripts/scripts.js --coverage` 列出未登记项） |

> **不要求凑数登记**：没读过的脚本不要建条目（宁可空着）；读了一部分就写 `partial`，
> 并在 `layout` 里只列**真正读过的行区间** —— 守卫会核对每个锚点确实出现在它声明的区间内。

## 索引

| id | 脚本 | 是什么（摘要） | 段 | 槽 | 状态 | 守卫 |
|---|---|---|---|---|---|---|
| [`AUTORUN1`](./AUTORUN1.md) | `$1$AUTORUN.BIN` | **扩展包 1 的激活入口**（包内文件 #0 = 统一 id 0x1000000）：先按包内副本重跑整套数据表（`$1$SCINIT`…`$1$BTANI… | 3 | 2 | 🟠 部分 | `test/append-packs.test.ts` |
| [`AUTORUN3`](./AUTORUN3.md) | `$3$AUTORUN.BIN` | **扩展包 3 的激活入口**（包内文件 #0 = 统一 id 0x3000000）：与包 1/2/4/5 同构 —— 先按包内副本重跑整套数据表（`$3$… | 4 | 4 | 🟠 部分 | `test/music-table.test.ts` `test/append-packs.test.ts` |
| [`CHECKCONFIG`](./CHECKCONFIG.md) | `CHECKCONFIG.BIN` | **设置的自检与修复**：校验 5 个字体面名是否还装得上（`0x2DE` 字体名→下标），装不上就回退默认并重新 `save-string`；末尾按 a9… | 7 | 3 | ✅ 已分析 | `test/save-data.test.ts` |
| [`CONFIG`](./CONFIG.md) | `CONFIG.BIN` | 「OPTION（设置）」的常驻父脚本：左侧分类切换（按当前分类 call-script CONFIG1 / CONFIG2）、消息显示预览（0x300 逐行… | 6 | 4 | ✅ 已分析 | `test/config1-chain.test.ts` `test/text-style-snapshot.test.ts` |
| [`CONFIG1`](./CONFIG1.md) | `CONFIG1.BIN` | 设置界面的**分类页主体**（本地化后的「系统设定」等页）：左侧分类列表 + 中部设置行（背景带 / 数值贴片 / 帮助图标 / 按 kind 的控件族）+… | 12 | 12 | ✅ 已分析 | `test/config1-chain.test.ts` `test/draw-string.test.ts` `test/draw-item-scale.test.ts` `test/text-style-snapshot.test.ts` |
| [`CONFIG2`](./CONFIG2.md) | `CONFIG2.BIN` | 设置界面的**「角色设定」页**（左侧第 5 个分类）：9 个角色位（CV 名牌 + 説明文字）+ 詳細変更/on/OFF/▶ 控件 + 左侧分类 + 滚动… | 7 | 7 | 🟠 部分 | `test/text-style-snapshot.test.ts` |
| [`INIT2`](./INIT2.md) | `INIT2.BIN` | **本体数据表总装载**：依次 call-script 40 张本体 INIT 表（SCINIT/CTINIT/…/BTANINIT2），再把一大批脚本 i… | 3 | 2 | 🟠 部分 | — |
| [`INITCONFIG`](./INITCONFIG.md) | `INITCONFIG.BIN` | 「配置默认值」的分发脚本：按顺序调用 INITCONFIG0..5（系统/游戏/ADV/声音/角色色/操作 六页各一份）。 | 1 | 1 | ✅ 已分析 | `test/save-data.test.ts` |
| [`INITCONFIG0`](./INITCONFIG0.md) | `INITCONFIG0.BIN` | 「系统设定」页的**默认值 + 登记**：把 a9cb..a9d5（窗口显示/自动保存/光标自动移动/覆盖存档备注/Live2D 等）与字体名串 bbb..… | 2 | 2 | ✅ 已分析 | `test/save-data.test.ts` |
| [`LOADCONFIG`](./LOADCONFIG.md) | `LOADCONFIG.BIN` | **把 SAVE.DAT 里的用户设置读回全局**：29 个 `load-int (global …)` / `load-string (global-st… | 5 | 2 | ✅ 已分析 | `test/save-data.test.ts` |
| [`MMODE`](./MMODE.md) | `MMODE.BIN` | **BGM 鑑賞界面**（回想第三个按钮）：三列 × 13 行的曲目列表（已收集显示曲名、未收集显示 `UNKNOWN`）+ 底部播放控制（上一首/暂停/下… | 4 | 4 | 🟠 部分 | `test/gallery-bgm-list.test.ts` |
| [`MUINIT`](./MUINIT.md) | `MUINIT.BIN` | **BGM 曲目元数据表**（无画面）：填三张 1-based 表 —— `12265c[1..36]` = 统一文件 id、`1226c0[1..36]`… | 1 | 3 | ✅ 已分析 | `test/gallery-bgm-list.test.ts` |
| [`ROOM`](./ROOM.md) | `ROOM.BIN` | **回想（EU-ROOM）菜单**：一张背景 + 四个按钮（CG鑑賞 / シーン回想 / BGM鑑賞 / 情報画面），每个按钮旁显示 `回収数` 与 `回収… | 5 | 4 | 🟠 部分 | `test/gallery-bgm-list.test.ts` |
| [`SC0330`](./SC0330.md) | `$1$SC0330.BIN` | 剧情脚本（本篇章节）：大量角色立绘的变换/表情/位置调整 + 文本推进。 | 1 | 3 | 🟠 部分 | — |
| [`SELFONT`](./SELFONT.md) | `SELFONT.BIN` | **字体选择器**：列出引擎可选字体表（`0x2DC` 取条数 + `0x2DD` 逐项取名），每页 9 项、按当前字体分页定位；选中后写回 `global… | 5 | 3 | ✅ 已分析 | — |
| [`SETMEMOIR`](./SETMEMOIR.md) | `SETMEMOIR.BIN` | **回想界面的收集度计算表**（无画面）：用 `0x19D` 逐条查询 CG 表 / 场景表 / BGM 表的"是否已收集"，写出收集数、收集率与已收集下标… | 4 | 5 | ✅ 已分析 | `test/gallery-bgm-list.test.ts` |
| [`SN0000`](./SN0000.md) | `SN0000.BIN` | 序章脚本（含引擎『字格逐字显现』的真实用例）。 | 2 | 1 | 🟠 部分 | `test/char-reveal.test.ts` |
| [`SP2563`](./SP2563.md) | `SP2563.BIN` | 剧情 ADV 脚本（本体 SP*.txt 之一，17000+ 行）：立绘/文本推进 + 音频惯用法（音效「先装载后起播」、语音通道复位后静音）。 | 2 | 2 | 🟠 部分 | — |
| [`SYSTEM4`](./SYSTEM4.md) | `SYSTEM4.BIN` | 引擎最先执行的脚本（统一文件 id 0）：初始化引擎字段/消息窗，再逐级 call-script 数据表 INIT 脚本，最后进 LOGO/TITLE。 | 5 | 2 | 🟠 部分 | `test/save-data.test.ts` |
| [`TITLE`](./TITLE.md) | `TITLE.BIN` | 标题画面：背景/Logo/菜单（Game Start／Load Data／Eushly-chan Room／Option／Quit）+ 菜单悬停与点击派发 … | 3 | 5 | 🟠 部分 | `test/config-version-substr.test.ts` `test/title-exit.test.ts` |

## 怎么用（流程）

分析某个 `src/*.txt` 时的动作顺序（详见 `amayui-engine-analysis` 技能 §3.2）：

1. `scripts.js --id <ID>` 先看有没有现成条目；没有就 `--add` 一个 `partial` 骨架（`role`/`entry` 先写一句话）；
2. 读脚本时**顺手记** `layout`（行区间 + 锚点 + 职责）与 `slots`（槽号 + 含义）——锚点用脚本里真实存在的字符串（label / opcode 行）；
3. 引擎层面的结论照旧进第一/第二层，并在 `links` 里回链（`capabilities` 填 id、`functions` 填 addr）；
4. `node scripts/build-scripts.mjs` 重生成 md ⇒ `scripts.js --validate` ⇒ `npx tsx --test test/script-ledger.test.ts`；
5. 反汇编重排（翻译/reflow）后行号会变 ⇒ 守卫会红，按失败信息更新 `lines`（这是**刻意**的棘轮）。
