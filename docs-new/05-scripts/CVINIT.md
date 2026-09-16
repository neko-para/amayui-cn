# 脚本台账 · `CVINIT`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `CVINIT.BIN`（真源 `src/CVINIT.txt`） |
| 状态 | 🟠 部分 |
| 是什么 | 逐角色「配音/配色/名字」表的初始化：把游戏内建的默认值写进 `14a8f1 + n` 等一组并行全局表，并写角色名串。 |
| 怎么进/出 | 由 `INIT2`（`src/INIT2.txt:93 call-script 5217 // CVINIT`）调用；`INIT2` 又由 `SYSTEM4:124` 调用 ⇒ **每次启动**都会重建这张默认表。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `6-14` | `mov (global-int 14a8f1) ffffff` | 第 0 条 =「ナレーション\|旁白」：`14a8f1+0 = ffffff`（默认配色）、`14b894+0 = 3e8`、串 `1116a` = 角色名（含汉化）、`14bc7c+0`/`14c064+0`/`14c065+0` 为其它逐角色字段 |
| `26-32` | `mov (global-int 14a8f4) ffffff` | 下一条角色（「一般女性/普通女性」）：同构的 6 行一组（配色 / 数值 / 两条名字串 / 两个字段） |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `global 14a8f1 + n` | 第 n 个角色的**默认配色**（进 `adcd` 的来源；多数 ffffff，26 条彩色） |
| `global 14b894 + n` | 逐角色数值字段（本票只确认它存在，语义未读） |
| `global 14bc7c / 14c064 / 14c065 + n` | 逐角色其它字段（未读） |
| `string 1116a + …` | 角色名字串（含汉化译文） |

## 不变量（拿它做回归断言）

- 每个角色占连续 6 行（mov 配色 / mov 数值 / set-string ×2 / mov ×2）
- 配色默认表与真机 SAVE.DAT 解出的 `adcd` 非白条目值一致（ffe100/84b1ff/dcdcc6/71d8ff/d3c3/4dbf67/2c9bdd/d15e4b…）

## 坑（踩过一次，别再踩）

- ★这张表是**默认值**，不是玩家数据：`INITCONFIG4` 只在首次运行（`SYSTEM4.txt:71` 的键 5 == 0）或玩家点「初始化」时把它拷进 `adcd`

## 缺口

- 257 行里其余字段（14b894/14bc7c/14c064/14c065 的语义、语音 id 关联）未读

## 相关

- 主题文档：`docs-new/03-engine/adv-text-rendering.md`
- 主题文档：`docs-new/03-engine/save-data.md`

## 证据与备注

- 证据：src/CVINIT.txt:6-40（本轮抽读）；配色表值与真机 SAVE.DAT 解表结果逐条对照见 docs-new/03-engine/adv-text-rendering.md §10.2b
- 备注：本轮为回答「没有 SAVE.DAT 时默认值从哪来」而读（T-0035 第 10 轮）。
