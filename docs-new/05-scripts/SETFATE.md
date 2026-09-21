---
kind: generated
state: live
home: analysis/scripts.json
generated_by: scripts/build-scripts.mjs
---

# 脚本台账 · `SETFATE`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `SETFATE.BIN`（真源 `src/SETFATE.txt`） |
| 状态 | 🟠 部分 |
| 是什么 | 「ゲーム開始」时对全角色（最多 1000 项）初始化「运命/缘分」标志表。 |
| 怎么进/出 | GAMESTART 的 `label_000050b8` 在 INITGAME 之后 `call-script 51e5` 进入；跑完 `exit`。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `12-17` | `i195 (local-int 7d4) (local-string-ptr 0) ""` | ★1000 次循环：取角色名表 `global-string 368c[i]` → `i195 out name ""` ⇒ out = (名字 != "")；空名条目直接跳到下一次迭代 |
| `18-36` | `lookup-array (local-ptr 0) (global-int def7c) (local-int 0)` | 对**非空名**的角色按 `def7c[i] & 6 / & 7` 分三路调 `label_290` / `label_5c4` / `label_920`（三张表 122bce / 123786 / 125aae / 126666 / 12433e / 124ef6 与 13d7 比对后置 `def7c[i]` 的位） |
| `197-203` | `bit-set (local-ptr 1) 2` | 第三路的收尾：条件满足时置 `def7c[i]` 的 bit2 |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `local-int 7d4` | 循环下标 i；**同时是 `i195` 的输出槽**（每轮被覆写） |
| `global def7c` | 运命标志表（按角色下标，位 0/1/2） |
| `global 368c` | 角色名表（`global-string`） |
| `global 13d7` | 用于比对的角色/职业表 |

## 不变量（拿它做回归断言）

- 循环上限 1000（`lt i 0x3e8`）；名字为空的条目必须被跳过（`i195` ⇒ 7d4 = 0 ⇒ `jcc 7d4 ffffffff next`）

## 坑（踩过一次，别再踩）

- ★`i195`（字符串不等）**必须实现**：它回写 `local 7d4`，而下一行 `jcc (local 7d4) ffffffff label_00000278` 就是靠它判「空名跳过」。当 no-op 跳过时 `7d4` 还留着上一行 `lt (local-int 7d4) (local-int 0) 3e8` 的 **1**（永远"非空"）⇒ 空名条目也会被处理（对它们跑三张 lookup-array-2d 并置位）
- 三条子路径里的 `jcc (local-ptr 1) ffffffff label` 是「指针为空 ⇒ 跳到下一次迭代」，不是「非空才跳」

## 相关

- 函数结论：`0x42D010`（见 `analysis/functions.json`）
- 函数结论：`0x401540`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/scene-start-flow.md`
- 守卫测试：`app/amayui-emulator/test/game-start-chain.test.ts`

## 证据与备注

- 证据：src/SETFATE.txt:12-36/197-203；`0x195` 的语义与危险见 test/game-start-chain.test.ts 的「0x195 string-ne」用例
- 备注：三条子路径（label_290/5c4/920）内部的表语义未逐条读 —— 只确证了「空名必须跳过」这条控制流不变量。
