---
kind: generated
state: live
home: analysis/scripts.json
generated_by: scripts/build-scripts.mjs
---

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
| `119-128` | `i0b5 2` | 悬停项变化（`3f5 != 3f6`）⇒ 落在有效项内就 `i0b5 2`：**悬停音固定在 SE 通道 2**。★本脚本从不装载通道 2 —— 通道 2 的绑定由其调用者 `TITLE.txt:28 play-sound-effect 39a3 2`（统一 id 14755 = SE005.WAV）留下 |
| `360-364` | `play-sound-effect 39a4 1` | 右键/ESC 取消回调 `label_000014f0`：`39a4`(统一 id 14756 = SE003.WAV) 装到**通道 1** 后 `i0b5 1` 起播，再写 `3f4 = 2`（戻る） |
| `1306-1308` | `play-sound-effect 51e3 1` | ★★「ゲーム開始」**唯一**的音效：`51e3` = 统一文件 id **20963 = SE009.WAV**（598060B / 44100Hz 立体声 PCM16 / ≈3.39s，实测见 `.tmp/probe-se-ids.mts`），装到通道 1 后 `i0b5 1` 起播；点击分派本身（`:371-375`）**不发 SE** |
| `84-91` | `get-input-type` | 主循环：`get-input-type`（`0xCD` → 跳 `mouse-callback 32 label_00000664` 的点击处理）后按 `local 3f4` 分派：**1 = ゲーム開始** ⇒ `label_000050b8`、**2 = 戻る/取消** ⇒ `label_000053c0` |
| `360-385` | `mov (local-int 3f4) 1` | ★点击派发：左键落点 `local 3f7 == 0` ⇒ `local 3f4 = 1`（ゲーム開始）；`3f7 == 1` 或右键 ⇒ `3f4 = 2`（戻る） |
| `1327-1348` | `call-script 51e4` | ★ゲーム開始 分支 `label_000050b8`：全屏淡出幕布（`set-vertex-color`/`i24e`）→ `wait` → `poll-input` → `call-script 51e4`(INITGAME) → `call-script 51e5`(SETFATE) → `global 0 = 1` → `exit` |
| `1350-1359` | `detach-texture 3e8 3e8` | 戻る 分支 `label_000053c0`：清场 + 释放纹理 c0/c1 → `exit`（不动 `global 0` ⇒ 保持 0 = 取消） |
| `157-190` | `joy-callback 0 label_00000c58` | ★输入派发表：`i0ff`+`i100`（`157-165`）+ `joy-callback 0..c`（`176-188`）+ `mouse-callback 32 label_00000664`（`189`）。`joy-callback` 的 op1 是**输入掩码位本身**（引擎 `sub_421B80` raw 30417 存 `[33*cur+107725+op1]`、`sub_419AF0` raw 25042 查 `[33*cur+107725+掩码位]` —— 同索引、**无 ±4**）：掩码位 4 = **鼠标左键**（`sub_477150`；手柄才是 `4+i`），所以左键派发的是 `joy-callback 4`（`label_00001338`：被 `3fb != 0` 挡回，无副作用），而**不是** `joy-callback 0`（`label_00000c58` = **行确认**：`3ff = 1` → `3f7 = 3f8` → `call label_000049d0` 重画按钮高亮） |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `local-int 3f7 / 3f5 / 3f6` | 按钮悬停下标（新/当前/上次） |
| `local-int 3f4` | ★退出原因：1 = ゲーム開始、2 = 戻る（主循环在 `:86-89` 读它） |
| `local-int 3f2` | 按钮去抖位（bit0 左键已按、bit1 右键已按） |
| `local-int 5/195/1f9` | `i12e` 的 size 盒 / baseX / baseY 三张表 |
| `global 0` | ★返回值（`exit` 前写 1 = 开始游戏）；TITLE 在 `:320` 读它 |
| `SE 通道 1 / 通道 2 的绑定` | ★本脚本只往**通道 1** 装载音效（`play-sound-effect` 的 op1 = 统一文件 id）：`2e`=46=SE004.WAV（配置行 5..8 的切换，`:413`/`:438`）、`39a4`=14756=SE003.WAV（右键/ESC 取消，`:361`）、`39a5`=14757=SE001.WAV（戻る/初期化/行点击，`:381/390/401/418/443`）、`51e3`=20963=SE009.WAV（ゲーム開始，`:1307`）。**通道 2 只有 `i0b5 2`（悬停音）没有对应装载** ⇒ 它的 `39a3`=14755=SE005.WAV 由 `TITLE.txt:19`(通道 1)/`:28`(通道 2) 留下 |

## 不变量（拿它做回归断言）

- 三个按钮中心 = (0x2cb+96, 0x240+29) / (0x3a3+96, …) / (0x44d+96, …) = (811,605) / (1027,605) / (1197,605)
- 选了「ゲーム開始」⇒ 退出前必然先 `call-script INITGAME` 与 `call-script SETFATE`，再写 `global 0 = 1`
- 「ゲーム開始」的点击路径（`label_00001528` 的 `3f7 == 0` 分支 `:371-375`）**自身不发任何 SE**：该次点击唯一的音效是 `:1307-1308` 的 `play-sound-effect 51e3 1` + `i0b5 1`（id 20963 = SE009.WAV、SE 通道 1）

## 坑（踩过一次，别再踩）

- ★`local 3f4` 是**同帧内**由鼠标回调写的（`0xCD` 跳到 `label_00000664` 后再 `ret` 回主循环），所以点击处理与主循环判断共享同一个帧局部池 —— 帧局部池若在鼠标回调里被清，`3f4` 就丢了
- 左键命中判定用 `local 3f7`（悬停项），而悬停只在**鼠标位置变化**时重算（`label_00000724` 的 `ne 3ef/3ed`）⇒ 光标不动时点击依然有效（用的是上次悬停值）
- ★悬停音（`:128` 的 `i0b5 2`）在**通道 2** 上，而本脚本**从不装载**通道 2 ⇒ 若不经 TITLE 直接进 GAMESTART（或换个调用者），`i0b5 2` 只会重播通道 2 上残留的那个音效（正常路径下 = `TITLE.txt:28` 的 SE005）—— 这不是「漏实现」，是 SE 通道跨脚本常驻（引擎 SE 模块装在 `Engine+82876`，与脚本生命周期无关）
- `joy-callback`(0xFB) 的 op1 是**掩码位**、不是按钮序号：鼠标左键 = 掩码位 4（手柄按钮 i 才是 `4+i`）⇒ 左键与"手柄按钮 0"**别名**。emulator 曾按 `4 + op1` 存表 ⇒ 鼠标左键被派发到 `joy-callback 0`（本脚本的行确认 `label_00000c58`）⇒ **每次点击进入这个界面，第 0 个按钮就被画成高亮贴图**（handle `0x44c`；正常态是 `3e8/3e9/3ea`），用户看到的"按钮停在 hover 态"（2026-09 #1）。判据：`0x44c` 的出现**早于**本脚本唯一一次 `0x12E`。

## 缺口

- 配置项本身（难度/引继/周回 6 行）的读写路径未逐段读；「初期化」按钮的效果未读

## 相关

- 引擎常态能力：`scene-pending-flag-0x400-gate`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x42F230`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/scene-start-flow.md`
- 主题文档：`docs-new/03-engine/sound-system.md`
- 主题文档：`docs-new/03-engine/input-system.md`
- 主题文档：`docs-new/03-engine/flow-control.md`
- 守卫测试：`app/amayui-emulator/test/game-start-chain.test.ts`

## 证据与备注

- 证据：src/GAMESTART.txt:32-40/64-68/84-91/110-118/119-128/360-385/1306-1308/1327-1359；`play-sound-effect` 的 op1 = 统一文件 id（`2e`=46=SE004.WAV、`39a4`=14756=SE003.WAV、`39a5`=14757=SE001.WAV、`51e3`=20963=SE009.WAV）由 `.tmp/sys4ini-files.json` 与只读探针 `.tmp/probe-se-ids.mts`（`readById` → 名字/字节数/RIFF 头）实测；运行期断言见 test/game-start-chain.test.ts 的 titleHover/gameStartHover/gameStartResult/reachedInitGame
- 备注：三个按钮的分派与「ゲーム開始」整条退出路径已读；配置界面每一行控件（`i12e` 之外的设置项）未读。2026-09 追加：三个按钮 + 5 行配置项各自的音效口径（通道 1/2 与统一文件 id 对照）已读并落 `slots`/`gotchas`。★已知宿主侧缺陷（**不在本脚本**）：emulator 的 `AudioEngine.seLoad` 异步装载与 `sePlay` 同步起播错序 ⇒ `:1307-1308` 实际播出的是通道 1 上残留的 SE002（id 50），而不是 SE009（id 20963）；证据与最小修复见 `.tmp/se-51e3-analysis.md`，登记见 `docs-new/04-app/emulator-refactor-plan.md` §10。
