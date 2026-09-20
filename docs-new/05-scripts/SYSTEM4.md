# 脚本台账 · `SYSTEM4`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `SYSTEM4.BIN`（真源 `src/SYSTEM4.txt`） |
| 状态 | 🟠 部分 |
| 是什么 | 引擎最先执行的脚本（统一文件 id 0）：初始化引擎字段/消息窗，再逐级 call-script 数据表 INIT 脚本，最后进 LOGO/TITLE。 |
| 怎么进/出 | 启动时由引擎直接装载 index 0（`loadScriptData`）；本脚本自己再 call-script 其它脚本。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `28-42` | `i071 8` | 启动即逐个 i071 1..8（清/开 8 个消息窗） |
| `40-44` | `i073 1 37a 6e c 0 0 23 23 a 64` | 窗 1 的字格设置（0x73 的 10 个操作数：格尺寸/格数/节拍 0x64=100ms）——引擎『逐字显现』的入口 |
| `71-84` | `load-int (global-int 5)` | ★配置装载分支：`load-int (global 5)` 读 SAVE.DAT 里的「已初始化」标志 —— 有 ⇒ 73 行 `call-script 5258 LOADCONFIG`（load-int/load-string 把用户设置读回 global）+ 74 行 LOADCHARM；没有 ⇒ 78 行 `call-script 51dc INITCONFIG`（写默认值 + save-int/save-string 登记）+ 79 行 INITCHARM + 80/81 行 `mov (global 5) 1` + `save-int (global 5)`；两条路径都汇到 84 行 `call-script 51db CHECKCONFIG`（校验字体名，装不上就回退默认并重新 save-string） |
| `86-86` | `i0fe c` | ★全工程唯一一处 SetKeyTotal（`0xFE`）：`i0fe c` ⇒ `Engine[517] = 12`。它就是 `0x100` 在**掩码为空**时派发的「默认键」槽下标（菜单脚本登记的 13 个 `joy-callback 0..c` 的最后一个）——见 tickets/T-0046 与 docs-new/03-engine/input-system.md §7c |
| `120-130` | `i075 1e` | 全局主字号 30（0x75） |
| `141-150` | `label_00000b00` | ★读档续跑的**落点入口**（label_00000b00）：i0ae（0xAE）在读档流程里把本帧 ip 重算到存档位置并切到存档帧 —— 若没有它，下面两行会把玩家送回 LOGO/TITLE（call-script 5262 LOGO / 5263 INIT / 5264 TITLE）。load-show-logo 读 Engine[96983]（exit-script 置 0 ⇒ 回标题后跳过 LOGO） |
| `476-480` | `label_00001ec8` | 子程序「把三路语音的 pan 复位到中央」：`i2f8 0 0` / `i2f8 1 0` / `i2f8 2 0` + ret（0x2F8 的 op2 全库恒为 0 = 中央）；由 `:11` 与 `:320` 调用（启动早期与某状态切换时把语音声道摆正） |
| `444-448` | `call-script 5268  // NOVEL` | mode 分发器（`label_00001cb0`）：`global 0 == 6` ⇒ NOVEL。★真槽 79 的**帧 0 记录 callIdx=15** 正指这条 `call-script`（`0xAE` 按它走栈，见 capabilities 的 save-slot-chain） |
| `182-229` | `draw-texture 186a0 48 0 0 500 2d0 0 0` | ★场景装配块（`label_00000d70`）：先 `eq (global 3f90) 0` + `jcc label_000013e0` ⇒ **3f90==0 时整块跳过**（detach 19258、槽 0x48 背景、`draw-texture 186a0`、`i1f6`、`i23d`、`create-mesh 19258`）；`4fd9 != 0` 时才走 `i1f6` 那一支 |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `win 1..8` | 启动阶段批量清场的消息窗 |
| `global 5` | 「已初始化」标志（save-int 持久化在 SAVE.DAT；= SYSTEM4 的两条分支判据） |
| `Engine 517 (SetKeyTotal)` | 86 行 `i0fe c` 写 12：默认键槽下标（0x100 空掩码分支用它查 joy-callback 表） |

## 不变量（拿它做回归断言）

- 有 SAVE.DAT 且表里有 `global 5 = 1` ⇒ 必走 LOADCONFIG；否则必走 INITCONFIG（两者互斥，见 test/save-data.test.ts 的真语料断言）

## 坑（踩过一次，别再踩）

- 全库只有 27 处 `i073`（SYSTEM4.txt:41、NOVEL.txt:11/265、SN0000 各页）⇒ 只有序章/NOVEL/SYSTEM4 走引擎的『字格逐字』路径
- ★顺序是「先 LOADCONFIG 再 INITCONFIG 分支」而不是都跑：INITCONFIG 会把选项**写回默认值**，跑错分支的后果是「玩家设置每次启动都被重置」且不报错
- SAVE.DAT 必须在脚本之前装载（引擎 WinMain raw 142107）：装载晚了，第 71 行的 load-int 读到 0 ⇒ 白白走 INITCONFIG
- ★`i1f6` 与 `draw-texture 186a0` 都在 `3f90`/`4fd9` 两个门之后，而 `3f90` 全语料恒 0、本机真槽 `4fd9` 也是 0 ⇒ **读档时不能指望 SYSTEM4 清画面或画背景**（清画面是 `sub_410160` 行内做的：`capabilities` 的 `save-load-drawitem-clear-and-restore`）

## 缺口

- 音频族（0x2F8/0xB5 等）在 emulator 里是空操作 ⇒ 本脚本的「三路语音 pan 复位」子程序无实际效果

## 相关

- 引擎常态能力：`msgwin-char-reveal-grid`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`adv-perframe-dispatch`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`save-data-tables-persistence`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`engine-config-registry-persistence`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`audio-module-topology-and-volume-routing`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x41F250`（见 `analysis/functions.json`）
- 函数结论：`0x45A940`（见 `analysis/functions.json`）
- 函数结论：`0x40AEE0`（见 `analysis/functions.json`）
- 函数结论：`0x40AAE0`（见 `analysis/functions.json`）
- 函数结论：`0x434F60`（见 `analysis/functions.json`）
- 函数结论：`0x434FE0`（见 `analysis/functions.json`）
- 函数结论：`0x42DF40`（见 `analysis/functions.json`）
- 函数结论：`0x433A70`（见 `analysis/functions.json`）
- 函数结论：`0x4268D0`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/adv-text-rendering.md`
- 主题文档：`docs-new/03-engine/sound-system.md`
- 守卫测试：`app/amayui-emulator/test/save-data.test.ts`

## 证据与备注

- 证据：src/SYSTEM4.txt:40-44 / 71-90 / 120-130；0x73 语义见台账 msgwin-char-reveal-grid；配置装载分支的 E3 断言见 test/save-data.test.ts；语音静音子程序见 src/SYSTEM4.txt:476-480（0x2F8 语义见 sound-system.md §4）
- 备注：只登记了启动段与字格入口；初始化字段/INIT 调用链未逐段读。
