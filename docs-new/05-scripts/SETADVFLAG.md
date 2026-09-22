---
kind: generated
state: live
home: analysis/scripts.json
generated_by: scripts/build-scripts.mjs
---

# 脚本台账 · `SETADVFLAG`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `SETADVFLAG.BIN`（真源 `src/SETADVFLAG.txt`） |
| 状态 | 🟠 部分 |
| 是什么 | 把 `global f8080` 抬成 INT_MAX（`7fffffff`）的短脚本，并顺带重建两张 1000 长的数组（按 `3f3d` 选 `a1ea/f8469` 或 `a5d2/f8851`） |
| 怎么进/出 | `src/ALLMAP.txt:44`（以及 :159/:204 两支）的 `call label_000065cc`；运行期在「章节点处理链」上、紧随 ALLMAP 置完 `3f3d` 之后执行 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `14-19` | `lookup-array (local-ptr 0) (global-int 708976) (local-int 0)` | 前 20 项循环：按 `global 708976` 的表逐项取指针并 `call-script`（与 ALLMAP 同型的跳转表） |
| `24-30` | `mov (global-int f8080) 7fffffff` | ★把 `f8080` 抬到 INT_MAX（= 让 `SCJUMP` 的 `gr f8080, 10` 必定放行）；随后 `76f0 = 0`，并按 `3f3d == c` / `== d` 选一组 `set-array-to`（1000 项） |
| `36-41` | `set-array-to (global-int a5d2) (local-int 1) 3e8` | `3f3d == d` 支：清 `a5d2`/`f8851`（1000 项）后 `exit`；上一支 `3f3d == c`（行 28-31）清 `a1ea`/`f8469`。两支都不命中则落到行 41 的 `exit` |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `global f8080` | ★本文件唯一的写点：抬到 `INT_MAX` —— 它是 ADV 章节跳转的「闸值」，`SCJUMP` 用它做第二道门（`gr f8080, 10`） |
| `global 3f3d` | 章号（只读；用来选清哪一组数组） |
| `global 708976` | 本文件自己的跳转表基址（前 20 项逐个 call-script） |

## 不变量（拿它做回归断言）

- `mov (global-int f8080) 7fffffff` 在本文件里**无条件**执行（行 24，不在任何 jcc 之后）

## 坑（踩过一次，别再踩）

- ★本文件把 `f8080` 抬到 INT_MAX ⇒ **`SCJUMP` 的第二道门（`gr f8080, 10`）必然放行**。所以 `mov (global-int 0) 1` 会不会执行，完全由 `SCJUMP` 的第一道门（要 `1dd7 && 3318 && !1521 && !2f3c` 才跳走）决定；两者语义相反，极易看反（`tickets/T-0102` §12）
- `f8080 = 1015936` **在保存池之外**（池长 1015792）⇒ 它不随存档持久化，是进程内裸量

## 缺口

- `global 708976` 那张跳转表的内容未核（前 20 项是谁）；`a1ea/f8469`、`a5d2/f8851` 四张 1000 长数组的消费者未查

## 相关

- 主题文档：`docs-new/03-engine/scene-start-flow.md`

## 证据与备注

- 证据：src/SETADVFLAG.txt:14-41（全文 41 行，除注释外已通读）；运行期见 tickets/T-0102/evidence/clear-slot-records-root-cause.md §10（日志里 `[call-script] 0x512f -> SETADVFLAG.BIN` 紧随 ALLMAP）
- 备注：本脚本很短（41 行），已通读；未核的是它引用的表与数组。本条是 2026-09-22 白底定位（T-0102）的副产品
