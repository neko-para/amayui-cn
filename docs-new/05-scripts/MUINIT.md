# 脚本台账 · `MUINIT`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `MUINIT.BIN`（真源 `src/MUINIT.txt`） |
| 状态 | ✅ 已分析 |
| 是什么 | **BGM 曲目元数据表**（无画面）：填三张 1-based 表 —— `12265c[1..36]` = 统一文件 id、`1226c0[1..36]` = 曲号、`3629[1..36]` = 曲名串。 |
| 怎么进/出 | 本体 `INIT2.txt:100 call-script 521e`（各扩展包另有 `$n$MUINIT`）。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `6-114` | `mov (global-int 12265d) 147` | ★逐条三连：`12265d+i = 文件 id`、`1226c1+i = 曲号`、`3629+i = 曲名`（如 `(0x147, 2, 『infinite knots Game size』)`、`(0x17, 0x1f, 『現に輝いて』)` = 标题曲 BGM031.OGG） |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `global 12265c[i]` | 第 i 首的统一文件 id（= 收集判定 `0x19D` 的键） |
| `global 1226c0[i]` | 第 i 首的曲号（`play-bgm` 的操作数） |
| `global-string 3629[i]` | 第 i 首的曲名（鉴赏界面显示） |

## 不变量（拿它做回归断言）

- 三张表同序：`FileDB[12265c[i]].名字 == BGM<1226c0[i]>.OGG`（36 条里 33 条严格成立，例外是 OP/ED 影片：曲号 2/0x33/0x34 → OP.BIN/ED.BIN/ED2.BIN）
- id 0x17 ↔ 曲号 0x1f（= BGM031.OGG，标题曲）—— 与 SYS4INI 尾部曲号表 `base[0x1d] = 0x17` 一致

## 坑（踩过一次，别再踩）

- 表是 **1-based**（首条写 `12265d`，读作 `12265c[1]`）；`12265c[0]`/`1226c0[0]` 恒 0 ⇒ SETMEMOIR 用 `jcc (local-ptr 0)` 跳过空条目得 36 条

## 缺口

- 表尾两首 `(0x29f1, 0x33)`/`(0xae3, 0x34)` 是 OP/ED 影片曲（不是 BGM 文件），鉴赏列表里照常列出。

## 相关

- 引擎常态能力：`gallery-unlock-file-used-flags`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`music-number-table-lifecycle`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x48DB80`（见 `analysis/functions.json`）
- 函数结论：`0x42D8E0`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/gallery-and-unlock-flags.md`
- 主题文档：`docs-new/03-engine/sound-system.md`
- 守卫测试：`app/amayui-emulator/test/gallery-bgm-list.test.ts`

## 证据与备注

- 证据：src/MUINIT.txt 全文 114 行实读；E3 断言 122730 = 36（= 非空条目数）
- 备注：扩展包各自的 `$n$MUINIT`（`$1$MUINIT`/`$3$MUINIT`…）填的是自己那几首，未逐行读。
