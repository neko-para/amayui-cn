---
kind: generated
state: live
home: analysis/scripts.json
generated_by: scripts/build-scripts.mjs
---

# 脚本台账 · `SCJUMP`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `$1$SCJUMP.BIN`（真源 `src/$1$SCJUMP.txt`） |
| 状态 | 🟠 部分 |
| 是什么 | 章节跳转分派器：读目标章号 `global 3f3d`，按值跳到对应章节的处理段（本文件是包 1 / 序章那一支） |
| 怎么进/出 | 由 `ALLMAP.BIN` 的跳转表循环 `call-script (local-ptr 0)` 调起（`src/ALLMAP.txt:23/58/95/174/219`）；表基址 `global 708996` 由 `INIT2` 登记为 0x5224（`src/INIT2.txt:106`）⇒ 逐脚本入口在 `$1$SCJUMP`。`src/SYSTEM4.txt:429` 只在开机预载时 call 一次 ALLMAP |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `6-36` | `eq (local-int 1) (global-int 3f3d) 1` | 入口分派：一串 `eq local1, global 3f3d, N` + `jcc` 把目标章号路由到各章处理段（3f3d=1 ⇒ label_00000390） |
| `38-53` | `label_00000390` | ★序章/第 1 章这一支：先用 `1dd7`/`3318`/`1521`/`2f3c` 算出 local5/local7，再用 `gr local1, global f8080, a` 做第二道门；两道都「落下句」才执行 `mov (global-int 0) 1` + `mov (global-int 3f3c) 14a` + `mov (global-int f8080) a` |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `global 3f3d` | 目标章号（分派键）；ALLMAP 在章节点把它设为 1（`src/ALLMAP.txt:37`） |
| `global 0` | ★窗口模式选择子：`== 6` ⇒ ADV 窗口走 draw-texture 白纸窗；`!= 6` ⇒ 走 create-mesh 半透明黑幕（窗口例程见 `src/SN0000.txt:3075-3099` / `src/SC0000.txt:32662-32686`） |
| `global f8080 (=1015936)` | ★章节点第二道门的闸值：本支条件 `f8080 <= 10` 才放行；放行后立刻被写成 `a`(=10) 作再入锁（同型支写 `0`） |
| `global 3f3c` | 被写成本章的章节号（如 `14a`），供 SC0000 的章节分派器 `label_000047c4` 使用 |
| `global 1dd7 / 3318 / 1521 / 2f3c` | 第 1 章门的前置条件（`1dd7` 与 `3318` 都要 == 1，`1521` 与 `2f3c` 都要 != 1） |

## 不变量（拿它做回归断言）

- `mov (global-int 0) 1` 只在 `local7 == 0` 且 `f8080 <= 10` 时执行；执行后 `f8080` 必被写成 10（再入锁）
- 本文件是**纯分派 + 门控写**：没有 draw/纹理操作，画面变化只能来自它写下的全局量

## 坑（踩过一次，别再踩）

- ★`global f8080` 的写点只有 `SETADVFLAG`（写 `7fffffff`=INT_MAX）与 `SCJUMP*`（写 `a`/`0`）。门是 `f8080 > 10` ⇒ **SETADVFLAG 的 INT_MAX 会让门「真 ⇒ 跳走」、从而跳过 `mov global 0 1`**；而闸值被降到 10（或 0）时才轮到该写执行。两者语义相反，读日志时极易看反
- ★`global f8080 = 1015936` **在保存池之外**（两份真槽池长 1015792）⇒ 它不随存档持久化，是「进程内裸量」；读档/装配点若清掉它，`gr f8080, 10` 会读到 0 ⇒ 门放行 ⇒ `global 0` 被改成 1 ⇒ ADV 窗口由半透明黑幕变白纸窗（`tickets/T-0102`）
- 本文件有 1044 个 label / 18153 行，是「一个脚本装全部章」的巨型分派（各章支结构同型，改一处要防同型支漏改）

## 缺口

- 只精读了 3f3d=1 那一支（行 6-53）；其余各章支（行 56 起，同型）未逐支读
- `ALLMAP` 的跳转表循环（`src/ALLMAP.txt:14-59`）只读了入口与 `call label_000065cc` 这两处，未读完

## 相关

- 主题文档：`docs-new/03-engine/scene-start-flow.md`
- 守卫测试：`app/amayui-emulator/test/clear-slot-records-keeps-bindings.test.ts`

## 证据与备注

- 证据：src/$1$SCJUMP.txt:6-36（分派）、38-53（3f3d=1 支的门与写）；BIN 索引实解（`parseScriptBytes`）：idx39 `gr local1, global 1015936, 0xa` / idx40 `jcc` / idx41 `mov global 0, 1` / idx42 `mov global f8080, 0xa`；运行期取证见 tickets/T-0102/evidence/clear-slot-records-root-cause.md §10
- 备注：未读：其余各章支（同型结构）、以及 `label_00003c8c` 之后的主体。本条的 `slots`/`gotchas` 是 2026-09-22 白底定位（T-0102）的副产品
