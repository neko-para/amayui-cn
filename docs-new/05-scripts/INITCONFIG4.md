# 脚本台账 · `INITCONFIG4`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `INITCONFIG4.BIN`（真源 `src/INITCONFIG4.txt`） |
| 状态 | ✅ 已分析 |
| 是什么 | 「角色配色」页的初始化：把三张 1000 条并行表按引擎内建默认值重建并写进 SAVE.DAT。 |
| 怎么进/出 | 由 `INITCONFIG`（全体初始化，`src/INITCONFIG.txt:10 call-script 51df`）与 `CONFIG2.txt:821`（角色设定页的初始化）调用；首次运行时由 `SYSTEM4.txt:78 call-script 51dc // INITCONFIG` 间接触发（门 = 键 5 == 0）。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `6-8` | `fill-zero (global-int 3b4e) 3e8` | `3b4e[0..999] = 0`；`a9e5[0..999] = 0x2710`（`set-array-to`） |
| `15-26` | `save-int (local-ptr 0)` | 1000 次循环：`save-int` 写 `3b4e[i]`、`a9e5[i]`；`adcd[i] = 14a8f1[i]`（其值为 0 时 `adcd[i] -= 1` 表「未设」），再 `save-int` |
| `20-24` | `lookup-array (local-ptr 0) (global-int 14a8f1) (local-int 0)` | 默认配色的来源表（`CVINIT` 写）——**这一条就是「没有 SAVE.DAT 也有默认值」的机制** |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `global 3b4e / a9e5 / adcd（各 1000 条）` | 角色配色页的三张并行表：标志位 / 数值 / 颜色 |
| `global 14a8f1（1000 条）` | 引擎内建默认配色（`CVINIT` 写） |
| `global 5` | 「已初始化」标志（`SYSTEM4.txt:71` 的门；本脚本不碰它，由 SYSTEM4 写） |

## 不变量（拿它做回归断言）

- `adcd[i]` 要么 = `14a8f1[i]`（>0），要么 = 原值 −1（≤0 ⇒ 消费方 `CONFIG1/CHECKCONFIG` 判 `<=0` 时**跳过**调色覆盖、保留 `ffffff`）
- 三张表各 1000 条、键 = `\x03` + hex8(global 地址)

## 坑（踩过一次，别再踩）

- ★这是**首次运行**默认值的唯一来源；`SAVE.DAT` 里那 1000 条 `adcd` 就是它 `save-int` 的结果（emulator overlay 实测齐全：1000/1000，26 条非白）

## 缺口

- `3b4e`/`a9e5` 在 UI 上的语义（哪一列是标志、哪一列是数值）未读

## 相关

- 主题文档：`docs-new/03-engine/adv-text-rendering.md`
- 主题文档：`docs-new/03-engine/save-data.md`

## 证据与备注

- 证据：src/INITCONFIG4.txt 全文（28 行）；对照 docs-new/03-engine/adv-text-rendering.md §10.2b 与 emulator overlay SAVE.DAT 解表
- 备注：本轮为回答「没有 SAVE.DAT 时默认值从哪来」而读（T-0035 第 10 轮）。
