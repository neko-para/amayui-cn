# 脚本台账 · `AUTORUN1`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `$1$AUTORUN.BIN`（真源 `src/$1$AUTORUN.txt`） |
| 状态 | 🟠 部分 |
| 是什么 | **扩展包 1 的激活入口**（包内文件 #0 = 统一 id 0x1000000）：先按包内副本重跑整套数据表（`$1$SCINIT`…`$1$BTANINIT2`），再把它自己的脚本 id 表灌进 globals，最后 `bit-set (global-int 7087f5) 1` 置「包 1 已安装」。 |
| 怎么进/出 | ★**没有任何脚本 call 它**（全语料无 0x1xxxxxx..0x5xxxxxx 的 call-script 立即数）——唯一入口是引擎的 `i143`（0x143）派发 `slot<<24`：本体 INIT2.txt:140 执行 i143 时，装载过的包 slot 各被排一个 `slot<<24` 请求，slot=1 ⇒ 0x1000000 = 本脚本。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `6-44` | `call-script 1000174` | 包内数据表按与本体相同的顺序重跑一遍（$1$SCINIT…$1$BTANINIT2，共 39 条）⇒ 覆盖本体 INIT2 装好的那批 globals |
| `45-65` | `mov (global-int 708997) 100019b` | 把包内脚本 id 表灌进 globals（界面/场景入口，如 0x100019b..0x10001af） |
| `66-67` | `bit-set (global-int 7087f5) 1` | ★置「已安装扩展包」掩码第 1 位（global 7087f5），然后 exit —— 存档界面 SAVE.txt:885-888 就是拿这个掩码与存档里记录的安装状态比对 |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `global 7087f5` | 扩展包安装位掩码（bit n = 第 n 包装了）；由各 $n$AUTORUN 各置自己那位 |
| `global 7088xx / 10e39x / 708xxx` | 包 1 的脚本 id 表（0x100019b 起） |

## 不变量（拿它做回归断言）

- `$n$AUTORUN.BIN` 恒为包 n 的文件 #0 ⇒ id 恒为 `n << 24`（引擎派发的就是它）
- 本脚本执行完必须满足：`global 7087f5` 的第 1 位 = 1（装载成功的充分条件）

## 坑（踩过一次，别再踩）

- 它**不是**被 call-script 调用的：反汇编全语料中 `call-script` 的立即数最大只到本体 id，扩展包脚本一律靠 id 高字节分派 —— 所以「谁调用扩展包」这个问题在脚本侧无解，答案在引擎（i143）
- 包 1 与包 2..5 的 AUTORUN 同构（同一套 39 张表 + 自己的 id 表 + `bit-set 7087f5 n`），差异只在包号与具体条目

## 缺口

- emulator：0x143 未实现 ⇒ 本脚本永不执行（global 7087f5 恒 0、包内 INIT 表不装载）；扩展包的 id 分派本身已实现（readScript 支持 pack<<24|idx，上限 5）

## 相关

- 引擎常态能力：`append-pack-discovery-and-activation`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x41A000`（见 `analysis/functions.json`）
- 函数结论：`0x455750`（见 `analysis/functions.json`）
- 函数结论：`0x4559C0`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/resource-loading.md`

## 证据与备注

- 证据：src/$1$AUTORUN.txt 全文 67 行实读；派发路径 raw 25168-25191（i143 → queueScript(slot<<24)）；调用方 src/INIT2.txt:140；掩码比对 src/SAVE.txt:875-888
- 备注：包 2..5 的 AUTORUN 未逐行读（结构与包 1 同构，仅条目/包号不同）；$1$AUTORUN 调用的 39 张 $1$ 表本身未读。
