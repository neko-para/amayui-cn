# 脚本台账 · `SELFONT`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `SELFONT.BIN`（真源 `src/SELFONT.txt`） |
| 状态 | ✅ 已分析 |
| 是什么 | **字体选择器**：列出引擎可选字体表（`0x2DC` 取条数 + `0x2DD` 逐项取名），每页 9 项、按当前字体分页定位；选中后写回 `global-string`，确认时播 SE（`i0b5 1`）。 |
| 怎么进/出 | CONFIG1 字体行的「变更」按钮：`CONFIG1.txt:1049 call-script 51dd`（= SELFONT.BIN）。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `33-39` | `i2dc (local-int 410)` | 取可选字体数量 → local 410；`count == 0 ⇒ exit`（表空早退），否则播确认 SE（`i0b5 1`） |
| `41-47` | `i2de (local-int 418) (global-string d5d)` | 当前字体名（`global-string d5d`）→ 下标 418；`>= 9` 时按 9 分页（`41b -= 9`） |
| `74-86` | `div (local-int 413) (local-int 41b) (local-int 410)` | 滚动条：`413 = 41b / count`（★`count` 当除数 ⇒ 0x2DC 返回 0 会除零），再按 `2f` 分档 |
| `559-571` | `i2dd (global-string d5d) (local-int 418)` | 点击某行：由行号反推下标 → `i2dd` 取名字写进 `global-string d5d`（当前值）+ 播 SE |
| `636-651` | `i2dd (local-string 0) (local-int 41b)` | 列表逐行绘制：`i2dd` 取候选名 → `set-font` → `draw-string`（行高 0x1b，选中行另画高亮框） |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `local 410 / 411..41f` | 字体总数 / 分页与滚动条几何（413 每页步长、417 起始行、418 当前下标、41b/41c 行号） |
| `global-string d5d` | 当前选中的字体名（进列表时读、选中时写） |
| `local-int 5 / 195 / 1f9` | 三组行几何表（`copy-local-array` 初始化、`lookup-array` 取值） |

## 不变量（拿它做回归断言）

- 列表项数 = `0x2DC` 的返回值（= emulator 的 `ENGINE_FONT_LIST.length`）；每页 9 项（`:43/:49` 的 `9`，与 `:77` 的 `1ac/9` 步长对应）

## 坑（踩过一次，别再踩）

- `0x2DC`（条数）、`0x2DD`（第 i 项名字）、`0x2DE`（名字→下标）**必须同一张表** —— 三者不一致会让「选中后存下的名字」下次启动查不到，CHECKCONFIG 随即把它判为装不上并回退默认
- `:78` 拿 count 当除数：`0x2DC` 必须返回真实条数（引擎空表返回 -1，**绝不返回 0**）—— 返回 0 时选择器既不显示列表，又把滚动条几何算成 Infinity/NaN（用户实测「中间没有列表、滚动条中间段漂到左边」）

## 相关

- 引擎常态能力：`engine-config-registry-persistence`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`audio-module-topology-and-volume-routing`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x430DB0`（见 `analysis/functions.json`）
- 函数结论：`0x434720`（见 `analysis/functions.json`）
- 函数结论：`0x430DF0`（见 `analysis/functions.json`）
- 函数结论：`0x420B40`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/opcode-table.md`
- 主题文档：`docs-new/03-engine/adv-text-rendering.md`
- 主题文档：`docs-new/03-engine/sound-system.md`

## 证据与备注

- 证据：src/SELFONT.txt（全文 767 行）；CONFIG1.txt:1049 的 call-script 51dd；handler raw 40239-40249/42541-42575/40251-40261；E3 目视：修复后选择器列出 9 个候选面名并以绿框标出当前项（.tmp/fontpick4-1-fontpick.png）
- 备注：行几何表与绘制细节未逐条建模；本条聚焦「列表数据从哪来」——正是 0x2DC/0x2DD 缺口导致的那部分。 音频侧：本页「选中即播确认音」用的就是 0xB5（`i0b5 1` = 起播 SE 通道 1·播一次；装载是同一段的 `play-sound-effect`），见 sound-system.md §8。
