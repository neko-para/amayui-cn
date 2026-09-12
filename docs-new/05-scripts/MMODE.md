# 脚本台账 · `MMODE`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `MMODE.BIN`（真源 `src/MMODE.txt`） |
| 状态 | 🟠 部分 |
| 是什么 | **BGM 鑑賞界面**（回想第三个按钮）：三列 × 13 行的曲目列表（已收集显示曲名、未收集显示 `UNKNOWN`）+ 底部播放控制（上一首/暂停/下一首/停止）+ `回収率`/`回収数`。 |
| 怎么进/出 | ROOM.txt:418 `call-script 524f`；本体 `exit` 回 ROOM。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `62-77` | `add (local-int 263) 5 (global-int 122730)` | 初始化：`local263 = 5 + 122730`（列表行数）、**`i0b8`（0xB8 停 BGM，停掉 ROOM 那首）**、四次绘制子程序调用、`call label_00002204`（画列表）、`i21d 0 7d0`（0x21D 复制过渡幕布 → 0x7d0） |
| `440-500` | `lookup-array (local-ptr 1) (global-int 122731) (local-int 280)` | ★列出行：行号 → `122731[行]`（SETMEMOIR 写的已收集下标）→ `1226c0[下标]`（曲号）/ 曲名串；未收集（下标 0）画 `UNKNOWN` |
| `501-560` | `lookup-array (local-ptr 2) (global-int 122731) (local-int 283)` | 选中/试听：换曲时先 `i0b8` 停当前曲，再 `play-bgm`/`i0b7` 起播所选项；鼠标回调里做光标移动与滚动 |
| `640-700` | `i23b 848 1 (global-int 12272f) 2e2 2a6 2 0` | 底部统计：`i23b` 画 `回収数 12272f`、`回収数 122730`、`回収率 12272e`（三处数字位图） |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `local 263` | 列表行数（= 5 + 122730） |
| `local 280` | 当前画到第几行 |
| `local 283 / 284` | 滚动/光标相关 |
| `global 1226c0[i] / 3629[i]` | 第 i 首的曲号 / 曲名（MUINIT 填） |

## 不变量（拿它做回归断言）

- 列表的行数据全部来自 `122731`（SETMEMOIR 产出）⇒ 没有 SETMEMOIR 的结果就整片 UNKNOWN/空白

## 坑（踩过一次，别再踩）

- ★列表**不做**"只列已收集"的过滤：它画满 `122730`（=36）行，用 `122731[行]` 是否为 0 决定显示曲名还是 `UNKNOWN`
- 进界面第一件事就是 `i0b8`（停 BGM）—— 不实现它会听到 ROOM 的 BGM 与试听曲叠在一起

## 缺口

- 底部播放控制按钮（上一首/暂停/下一首/停止）的交互细节只读到 440-700 区间。

## 相关

- 引擎常态能力：`gallery-unlock-file-used-flags`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`audio-module-topology-and-volume-routing`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x419720`（见 `analysis/functions.json`）
- 函数结论：`0x423C60`（见 `analysis/functions.json`）
- 函数结论：`0x42D8E0`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/gallery-and-unlock-flags.md`
- 主题文档：`docs-new/03-engine/sound-system.md`
- 守卫测试：`app/amayui-emulator/test/gallery-bgm-list.test.ts`

## 证据与备注

- 证据：src/MMODE.txt 的区间见 layout；运行期出图 `.tmp/gallery-5-bgm-list.png`（回収率 5% / 回収数 2/36 曲，两条已收集显示曲名）
- 备注：与 CGMODE/HMODE 同构（列表 + 统计 + 播放控制）。未读：绘制子程序 label_00001fac/2760/2ac4/2f5c 与 label_00002204 的内部实现。
