# 脚本台账 · `CHARMEDIT`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `CHARMEDIT.BIN`（真源 `src/CHARMEDIT.txt`） |
| 状态 | 🟠 部分 |
| 是什么 | ADV 右侧菜单打开的编辑界面：一张 43 项（0x2b）的 3 行网格 + 底部「閉じる」；左键选中/拖动交换、光标键移动、右键关闭。 |
| 怎么进/出 | ADV 菜单里 `call-script 2d`（src/SC*.txt:215，例 SC0000 的 label_000010b4）⇒ 返回后 ADV 继续 `call label_00000320` 重画菜单；退出块自己 `call-script 46 DRAWCHARM` 再 exit。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `18-93` | `label_00000130` | 初始化：43 项命中盒（local 7d..125 的 4 元组 = x0/y0/x1/y1）、指针数组 19/4b、方向邻居表 145/149/14d、项数 20d=0x2b；末尾 `call label_00000f04` 注册回调 |
| `95-100` | `label_0000070c` | ★主循环：`get-input-type`（0xCD 派发到 mouse-callback 目标）→ 读 local 0x11（退出标志）⇒ 1 就跳 label_00004e14，否则 `sleep 1` 继续 |
| `217-234` | `label_00000f04` | 回调注册表：`joy-callback 0..c` 共 13 个槽 + `mouse-callback 10`；b(11)=1 表示「有键按住」 |
| `113-215` | `label_000007c4` | 读输入：`i2fc`（无触点则回落 read-mouse-pos/read-mouse-button）→ a(10) 锁存按下沿 → 左/右键分派；末端 e54 用 `i0ff`+`i100` 把可配置键/默认键交给 0x100 |
| `394-406` | `label_00001820` | ★关闭门：`jcc (local b)` —— b==0 才继续（b≠0 直接 ret）；随后 0x212==0 就跳过收尾，1884 置 b=1、local 0x11=1（退出） |
| `408-454` | `label_000018b0` | 按 hover 项分派确认：项 0 = `call-script 51c8 INITCHARM` + 重绘；项 1 = 清整张 charm 表 + save-int；项 2 = 置 local 0x11=1（界面底部的「閉じる」按钮） |
| `456-471` | `label_00001b28` | 左键按下落在某项上：记 215/21f/9、0x212=1、播 SE 51c9 → call 2214 重绘 |
| `473-553` | `label_00001c34` | 左键抬起时按 21f 执行：3..b 两项交换（写 global 13b0 + save-int）、2a = 清空该项 |
| `715-745` | `label_00002aec` | 静态界面：`create-mesh 1d4c0` + 7 个 draw-texture（底图/框/标题/滚动条）+ `call label_00002f1c` |
| `747-862` | `label_00002f1c` | 逐项绘制：local 210 从 1 起扫 9 个槽 + 3×10 网格（350+52*i / 31a+49*j 的格子几何） |
| `1129-1146` | `label_00004e14` | 退出块：`call-script 46 DRAWCHARM` + detach-texture + poll-input + exit |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `local a (10)` | 鼠标按下锁存（bit0 左 / bit1 右）；抬起时按它判断这是一次点击 |
| `local b (11)` | ★「有键按住」标志：`joy-callback c`（= SetKeyTotal 槽）清 0，`joy-callback 4`（Enter）与关闭收尾置 1；右键关闭门就看它 |
| `local 2` | 本次 `read-mouse-button` 的原值（bit0 左 / bit1 右），每次回调刷新 |
| `local 5 / 6 / 7` | `i12e` 的命中项 / 上次命中项 / 去抖 |
| `local 0x11 (17)` | 退出标志：主循环见到 1 就跳退出块 |
| `local 0x212 (530)` | 「已在某项上按下」标志（press 时置 1，release 时按它决定是否走动作）——注意**不是** local 212(0xd4) |
| `local 215 / 21f / 220` | 选中项 / 选中项的种类（0=目录 1=器物 2=魔物玉）/ 本次按下的种类 |
| `global 13b0 / 13b9` | charm 表（43 项）；由 INITCHARM 填充、交换时 save-int 持久化 |

## 不变量（拿它做回归断言）

- 项 2（閉じる）⇒ `label_00001ad8` 置 local 0x11=1 ⇒ 主循环 `jmp label_00004e14` 离开本脚本
- 右键关闭的必要条件：`local b == 0`，而 b 只由 `joy-callback c` 清 0 ⇒ 那条槽必须 = `Engine[517]`(SetKeyTotal)（真机 12）且 0x100 的空掩码分支已实现
- 回调注册在初始化末尾（0f04）：那之前（约 6k 指令步的界面绘制）发生的输入会压在 pending 里，直到主循环第一次 get-input-type

## 坑（踩过一次，别再踩）

- ★右键关闭（`label_00001820` 的 `jcc (local b)`）依赖 **0x100 在掩码为空时派发「默认键」处理器**：`joy-callback c` 槽 = `Engine[517]`(SetKeyTotal)，由 `src/SYSTEM4.txt:86` 的 `i0fe c` 置 12。emulator 曾把 0x100 的空掩码分支当成「无输入就落回」⇒ b 永远 1 ⇒ 右键被挡回（用户报「右键无反应，只能点閉じる」，tickets/T-0046）
- 脚本里的 `212` 是 **local 0x212**（=530），不是 local 212(0xd4)；两者都在用，读脚本时极易看错
- `local a`（鼠标锁存）与 `local b`（键盘/手柄「有键按住」）是两个独立标志，别混
- `mouse-callback 10` 的 10 是 **0xCD 的推进间隔 ms**（`sub_453A60`），不是「鼠标事件类型」

## 缺口

- charm 表（global 13b0 / 13b9）的字段语义与 INITCHARM 的填充规则未读
- 拖动/交换（1c34 的 3..b 三段索引运算）只读了形状，未逐条验算
- 绘制几何（2aec/2f1c/3aec）只读了轮廓，未与真机截图逐项对齐

## 相关

- 引擎常态能力：`key-dispatch-default-slot`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`adv-input-pump-perframe`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x419AF0`（见 `analysis/functions.json`）
- 函数结论：`0x421980`（见 `analysis/functions.json`）
- 函数结论：`0x421CA0`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/input-system.md`
- 主题文档：`docs-new/03-engine/opcode-table.md`
- 守卫测试：`app/amayui-emulator/test/input.test.ts`

## 证据与备注

- 证据：src/CHARMEDIT.txt:95-100（主循环）/ 113-215（读输入）/ 217-234（回调表）/ 394-406（关闭门）/ 408-454（确认分派）/ 1129-1146（退出块）；运行期断言见 test/input.test.ts 的「★CHARMEDIT：右键关闭」用例
- 备注：未读：INITCHARM 的表填充、拖动交换的完整语义、右侧细节框（2f1c 之后的 3630 子程序）的几何。
