# 脚本台账 · `GAMESTART`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `GAMESTART.BIN`（真源 `src/GAMESTART.txt`） |
| 状态 | 🟠 部分 |
| 是什么 | 「Game Start」之后的新游戏配置界面（基本设定/引继设定/周回プレイ设定）+ 三个按钮：**ゲーム開始 / 戻る / 初期化**。 |
| 怎么进/出 | TITLE 菜单第 0 项 `call-script 526b` 进入；`exit` 返回 TITLE，并把结果写进 `global 0`（1 = 已选择开始游戏 ⇒ TITLE 继续进 INITGAME）。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `32-40` | `i070 9 1ec 5c 0 0` | 初始化 9 号窗几何（w=0x1ec,h=0x5c）与文字起点，并给整屏淡入幕布 `i213 9 (0x1d4c0+0x9c4) 0x1f4`（把 handle 0x1e484 的图元复制到 0x1e484+0x9c4） |
| `64-68` | `copy-local-array (local-int 195) [2cb 3a3 44d]` | ★三个按钮的几何：size 盒 `5`=[0,0xc1,0,0x3b]（193×59）、baseX `195`=[0x2cb,0x3a3,0x44d]、baseY `1f9`=[0x240,0x240,0x240] |
| `110-118` | `i12e (local-int 3f5) (local-int 1) (local-int 3ed) (local-int 3ee) (local-int 5) (local-int 195) (local-int 1f9) (local-int 0)` | 鼠标悬停命中（`0x12E`）⇒ `local 3f5`/`3f7` = 按钮下标（−1 = 无） |
| `84-91` | `get-input-type` | 主循环：`get-input-type`（`0xCD` → 跳 `mouse-callback 32 label_00000664` 的点击处理）后按 `local 3f4` 分派：**1 = ゲーム開始** ⇒ `label_000050b8`、**2 = 戻る/取消** ⇒ `label_000053c0` |
| `360-385` | `mov (local-int 3f4) 1` | ★点击派发：左键落点 `local 3f7 == 0` ⇒ `local 3f4 = 1`（ゲーム開始）；`3f7 == 1` 或右键 ⇒ `3f4 = 2`（戻る） |
| `1327-1348` | `call-script 51e4` | ★ゲーム開始 分支 `label_000050b8`：全屏淡出幕布（`set-vertex-color`/`i24e`）→ `wait` → `poll-input` → `call-script 51e4`(INITGAME) → `call-script 51e5`(SETFATE) → `global 0 = 1` → `exit` |
| `1350-1359` | `detach-texture 3e8 3e8` | 戻る 分支 `label_000053c0`：清场 + 释放纹理 c0/c1 → `exit`（不动 `global 0` ⇒ 保持 0 = 取消） |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `local-int 3f7 / 3f5 / 3f6` | 按钮悬停下标（新/当前/上次） |
| `local-int 3f4` | ★退出原因：1 = ゲーム開始、2 = 戻る（主循环在 `:86-89` 读它） |
| `local-int 3f2` | 按钮去抖位（bit0 左键已按、bit1 右键已按） |
| `local-int 5/195/1f9` | `i12e` 的 size 盒 / baseX / baseY 三张表 |
| `global 0` | ★返回值（`exit` 前写 1 = 开始游戏）；TITLE 在 `:320` 读它 |

## 不变量（拿它做回归断言）

- 三个按钮中心 = (0x2cb+96, 0x240+29) / (0x3a3+96, …) / (0x44d+96, …) = (811,605) / (1027,605) / (1197,605)
- 选了「ゲーム開始」⇒ 退出前必然先 `call-script INITGAME` 与 `call-script SETFATE`，再写 `global 0 = 1`

## 坑（踩过一次，别再踩）

- ★`local 3f4` 是**同帧内**由鼠标回调写的（`0xCD` 跳到 `label_00000664` 后再 `ret` 回主循环），所以点击处理与主循环判断共享同一个帧局部池 —— 帧局部池若在鼠标回调里被清，`3f4` 就丢了
- 左键命中判定用 `local 3f7`（悬停项），而悬停只在**鼠标位置变化**时重算（`label_00000724` 的 `ne 3ef/3ed`）⇒ 光标不动时点击依然有效（用的是上次悬停值）

## 缺口

- 配置项本身（难度/引继/周回 6 行）的读写路径未逐段读；「初期化」按钮的效果未读

## 相关

- 引擎常态能力：`scene-pending-flag-0x400-gate`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x42F230`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/scene-start-flow.md`
- 守卫测试：`app/amayui-emulator/test/game-start-chain.test.ts`

## 证据与备注

- 证据：src/GAMESTART.txt:32-40/64-68/84-91/110-118/360-385/1327-1359；运行期断言见 test/game-start-chain.test.ts 的 titleHover/gameStartHover/gameStartResult/reachedInitGame
- 备注：三个按钮的分派与「ゲーム開始」整条退出路径已读；配置界面每一行控件（`i12e` 之外的设置项）未读。
