# 脚本台账 · `INITCONFIG0`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `INITCONFIG0.BIN`（真源 `src/INITCONFIG0.txt`） |
| 状态 | ✅ 已分析 |
| 是什么 | 「系统设定」页的**默认值 + 登记**：把 a9cb..a9d5（窗口显示/自动保存/光标自动移动/覆盖存档备注/Live2D 等）与字体名串 bbb..bbf 写成默认值，并逐个 `save-int`/`save-string` 登记进 SAVE.DAT 的表。 |
| 怎么进/出 | 由 INITCONFIG（51dc）在首次启动或「初始化本页」时 call-script（SYSTEM4.txt:78 / CONFIG1.txt:940）。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `1-17` | `save-int (global-int a9ce)` | 6 个开关的默认值：a9ce=0、a9cd=1、a9d5=0、a9d0=0、a9cb=3、a9cc=0x1f；每个都紧跟一次 save-int 登记（这就是"设置存哪"的答案） |
| `18-27` | `save-string (global-string bbb)` | 5 个字体面默认值：bbb/bbf=メイリオ、bbc/bbe=ＭＳ ゴシック、bbd=游ゴシック，各自 save-string 登记 |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `global a9cb..a9d5` | 系统/游戏页的开关（具体语义由 CONFIG1 的取值表 1281c0 与处理分支决定） |
| `global-string bbb / bbc / bbd / bbe / bbf` | 消息窗主字体/注音字体/参数字体/… 的面名（CHECKCONFIG 会校验它们是否装得上 |

## 不变量（拿它做回归断言）

- 每一处 `mov (global …) 默认` 后面必跟一次 `save-int`/`save-string`（否则该设置不会进 SAVE.DAT，下次启动就丢）

## 坑（踩过一次，别再踩）

- ★这些默认值就是"玩家没改过"时 SAVE.DAT 里的内容；对照真存档可以判断哪些项被玩家改过（例：本机 b1b6=2 就不是默认值 0）
- 字体面名会被 CHECKCONFIG 二次校验：装不上就回退并重新 save-string

## 相关

- 引擎常态能力：`save-data-tables-persistence`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x434F60`（见 `analysis/functions.json`）
- 函数结论：`0x434FE0`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/save-data.md`
- 守卫测试：`app/amayui-emulator/test/save-data.test.ts`

## 证据与备注

- 证据：src/INITCONFIG0.txt（全文 28 行）；与真存档对照见 test/save-data.test.ts 的 E4（global 5/a9ce/a9cd/a9d5/a9d0/a9cb/a9cc）
- 备注：INITCONFIG1..5 同构（各自页面）；INITCONFIG4 额外用 fill-zero/set-array-to 铺 0x3e8 条数组并逐条 save-int。
