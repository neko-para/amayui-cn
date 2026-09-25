---
kind: generated
state: live
home: analysis/scripts.json
generated_by: scripts/build-scripts.mjs
---

# 脚本台账 · `SETL2DMOC`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `SETL2DMOC.BIN`（真源 `src/SETL2DMOC.txt`） |
| 状态 | ⚪ 仅登记 |
| 是什么 | **Live2D 模型装载分发表**（统一文件 id `0x522d`）：按 `global f8c46`（模型文件 id）逐支比较，命中即 `i341 <MOC id> (global f8c47)` 把模型装进 `f8c47` 指定的实例槽，再跟若干条 `i345 <纹理 id> <槽> <模型内纹理号>` 绑它的贴图，最后 `jmp` 到收尾段。 |
| 怎么进/出 | **不是被直接常驻 call 的脚本**，而是「间接 call-script 表」的成员：`src/INIT2.txt:115` 把 `global 708ab6` 写成 `0x522d`，TITLE/BTL/INFOEN 再预设 `f8c46`/`f8c47` 并逐个 `call-script` 那张表（TITLE 见 `src/TITLE.txt:533-554`）。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `6-11` | `eq (local-int 0) (global-int f8c46) 4c8e` | `f8c46 = 0x4c8e` ⇒ `i341 4c8e <槽>` + `i345 4f9a/4f9b`（模型内纹理 0/1），再 `jmp label_00007544` 收尾 |
| `13-19` | `eq (local-int 0) (global-int f8c46) 395f` | `f8c46 = 0x395f` ⇒ 同形状（纹理 `4f9c`/`4f9d`） |
| `21-28` | `eq (local-int 0) (global-int f8c46) 4f9e` | ★**TITLE 走的那一支**：`f8c46 = 0x4f9e`（TITLE.MOC）⇒ `i341 4f9e <槽>` + `i345 4f9f/4fa0/4fa1`（模型内纹理 0/1/2） |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `f8c46` | **输入**：要装的模型文件 id（调用方在 call 之前写好；TITLE 写 `0x4f9e`） |
| `f8c47` | **输入**：目标 Live2D 实例槽号（TITLE 写 `0`） |

## 不变量（拿它做回归断言）

- 每支形状一致：1 条 `i341` + N 条 `i345` + `jmp` 收尾 ⇒ 「模型 + 它的贴图」在脚本层面是一个整体（不会只装模型不装图）

## 坑（踩过一次，别再踩）

- **本体在扩展包里**：不挂 append pack（或没跑 `INIT2`）的环境里 `call-script 0x522d` 会响亮报「拡張ファイル情報ファイル 72 は読み込まれていません．」——真链路靠 boot 链挂包解决（实测：单脚本跑 TITLE 时 `708ab6` 未被写 ⇒ 那张表整轮被跳过）

## 缺口

- 238 个 `i341` 分支只读了前 4 支（含 TITLE 支）；`jmp label_00007544` 的收尾段与 `$n$SETL2DMOC` 变体的覆盖范围未读

## 相关

- 主题文档：`docs-new/03-engine/live2d.md`
- 守卫测试：`app/amayui-emulator/test/live2d-enabled-flag.test.ts`
- 守卫测试：`app/amayui-emulator/test/input.test.ts`

## 证据与备注

- 证据：src/SETL2DMOC.txt:6-28（前 4 支逐行读）；调用链 src/INIT2.txt:115 + src/TITLE.txt:533-554；守卫 test/live2d-enabled-flag.test.ts 在真链路上证实 `a9d0 = 0` ⇒ `l2dSlots` 有 `0:0x4f9e`
- 备注：只登记「谁调它 / 它做什么 / TITLE 那支」，其余 234 支未读（stub）。
