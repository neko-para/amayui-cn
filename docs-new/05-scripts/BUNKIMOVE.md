---
kind: generated
state: live
home: analysis/scripts.json
generated_by: scripts/build-scripts.mjs
---

# 脚本台账 · `BUNKIMOVE`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `BUNKIMOVE.BIN`（真源 `src/BUNKIMOVE.txt`） |
| 状态 | 🟠 部分 |
| 是什么 | 武器画面的「移动」演出子脚本（`BUNKI` 的演出段）：把一组立绘/图元在**两套句柄基址之间批量搬运/交换**，再逐项设色淡出，最后 `poll-input; wait; exit` 交回。 |
| 怎么进/出 | 由 `src/BUNKI.txt:136/822` 的 `call-script 51c1` 调起（SBUNKI 的对应脚本是 `$?$SBUNKIMOVE`）；本脚本自己 `exit`（演出型子脚本，不是常驻界面）。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `43-77` | `i214 (local-int 8) (local-int 9)` | ★搬运循环：`local 2 = 0x1adb0`（基址）→ 对每个下标 i（上限 `global f8c50`）把 **10 个**源句柄 `local 2 + 0x64*k`（k=0..9，步长 0x64=100）与目标句柄 `0x1adb0 + 0x6a4 + k`（连续 10 个）用 `i214` **两两互换**；随后 `jmp label_00000b94` |
| `344-347` | `poll-input` | 收尾：`poll-input; wait; exit`（演出型子脚本的标准退出：清输入 → 让一帧 → 退出交回调用方） |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `local 2` | 源句柄基址（0x1adb0；某分支里 +1） |
| `local 8 / local 9` | `i214` 的两个 handle（源 = `local 2 + 0x64*k`；目标 = `0x1adb0 + 0x6a4 + k`） |
| `global f8c50 / f8c51` | 循环上限 / 特殊下标（`local 0 == f8c51` 时跳另一分支 `label_000005e0`） |
| `句柄族 0x1adb0+…` | 本演出用的图元：连续段 `+0x6a4..0x6ad` 与按 100 步长排开的另一组 |

## 不变量（拿它做回归断言）

- 搬运是 `i214`（**交换**）而不是复制 ⇒ 跑完一轮后两套句柄的内容对调（回程再跑一次就能还原）
- 循环上限来自 `global f8c50`（调用方在进本脚本前设好）

## 坑（踩过一次，别再踩）

- ★`i214` 是**交换**（整条 740 字节记录互换、键不动）：所以这一段的语义是「把两组图元对调」，不是「搬过去」；成对使用才能还原（tickets/T-0049）
- `local 8/9` 是**句柄**而不是索引：源侧按 0x64 步长（100）散开、目标侧连续（+0x6a4+k）

## 缺口

- 只读了搬运循环（43-77）与收尾（344-347）；中间的分支（label_000005e0 / label_00002140 的淡出、`set-draw-color` 的 `local 4` 取值）未读

## 相关

- 函数结论：`0x423AE0`（见 `analysis/functions.json`）
- 函数结论：`0x4ABEF0`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/rendering.md`
- 守卫测试：`app/amayui-emulator/test/op-214-swap-items.test.ts`

## 证据与备注

- 证据：src/BUNKIMOVE.txt:43-77（10×`i214` 搬运循环）/ 344-347（poll-input; wait; exit）；引擎侧见 analysis/functions.json 的 0x423AE0 / 0x4ABEF0
- 备注：未读：`label_000005e0` 与 `label_00002140` 两条分支（淡出/设色）、以及调用方 BUNKI 传进来的状态。
