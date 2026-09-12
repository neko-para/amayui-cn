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

`src/*.txt` 共 **941** 个，其中**已登记 6** 个（不是"已全部读过"，是"读过并落库"）：

| 状态 | 条数 | 含义 |
|---|---|---|
| `analyzed` | 2 | 结构 + 关键路径都读过并落库（未读到的部分写在 notes） |
| `partial` | 4 | 只读了用到的部分（layout 里逐条列出的就是读过的范围） |
| `stub` | 0 | 只登记『它是谁 / 谁调它』，正文未读 |
| **合计** | **6** | 分母 941（`node .agents/skills/amayui-engine-analysis/scripts/scripts.js --coverage` 列出未登记项） |

> **不要求凑数登记**：没读过的脚本不要建条目（宁可空着）；读了一部分就写 `partial`，
> 并在 `layout` 里只列**真正读过的行区间** —— 守卫会核对每个锚点确实出现在它声明的区间内。

## 索引

| id | 脚本 | 是什么（摘要） | 段 | 槽 | 状态 | 守卫 |
|---|---|---|---|---|---|---|
| [`CONFIG`](./CONFIG.md) | `CONFIG.BIN` | 「OPTION（设置）」的常驻父脚本：左侧分类切换（按当前分类 call-script CONFIG1 / CONFIG2）、消息显示预览（0x300 逐行… | 6 | 4 | ✅ 已分析 | `test/config1-chain.test.ts` `test/text-style-snapshot.test.ts` |
| [`CONFIG1`](./CONFIG1.md) | `CONFIG1.BIN` | 设置界面的**分类页主体**（本地化后的「系统设定」等页）：左侧分类列表 + 中部设置行（背景带 / 数值贴片 / 帮助图标 / 按 kind 的控件族）+… | 11 | 11 | ✅ 已分析 | `test/config1-chain.test.ts` `test/draw-string.test.ts` `test/draw-item-scale.test.ts` `test/text-style-snapshot.test.ts` |
| [`CONFIG2`](./CONFIG2.md) | `CONFIG2.BIN` | 设置界面的**「角色设定」页**（左侧第 5 个分类）：9 个角色位（CV 名牌 + 説明文字）+ 詳細変更/on/OFF/▶ 控件 + 左侧分类 + 滚动… | 7 | 7 | 🟠 部分 | `test/text-style-snapshot.test.ts` |
| [`SC0330`](./SC0330.md) | `$1$SC0330.BIN` | 剧情脚本（本篇章节）：大量角色立绘的变换/表情/位置调整 + 文本推进。 | 1 | 3 | 🟠 部分 | — |
| [`SN0000`](./SN0000.md) | `SN0000.BIN` | 序章脚本（含引擎『字格逐字显现』的真实用例）。 | 2 | 1 | 🟠 部分 | `test/char-reveal.test.ts` |
| [`SYSTEM4`](./SYSTEM4.md) | `SYSTEM4.BIN` | 引擎最先执行的脚本（统一文件 id 0）：初始化引擎字段/消息窗，再逐级 call-script 数据表 INIT 脚本，最后进 LOGO/TITLE。 | 3 | 1 | 🟠 部分 | — |

## 怎么用（流程）

分析某个 `src/*.txt` 时的动作顺序（详见 `amayui-engine-analysis` 技能 §3.2）：

1. `scripts.js --id <ID>` 先看有没有现成条目；没有就 `--add` 一个 `partial` 骨架（`role`/`entry` 先写一句话）；
2. 读脚本时**顺手记** `layout`（行区间 + 锚点 + 职责）与 `slots`（槽号 + 含义）——锚点用脚本里真实存在的字符串（label / opcode 行）；
3. 引擎层面的结论照旧进第一/第二层，并在 `links` 里回链（`capabilities` 填 id、`functions` 填 addr）；
4. `node scripts/build-scripts.mjs` 重生成 md ⇒ `scripts.js --validate` ⇒ `npx tsx --test test/script-ledger.test.ts`；
5. 反汇编重排（翻译/reflow）后行号会变 ⇒ 守卫会红，按失败信息更新 `lines`（这是**刻意**的棘轮）。
