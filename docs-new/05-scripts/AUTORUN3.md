# 脚本台账 · `AUTORUN3`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `$3$AUTORUN.BIN`（真源 `src/$3$AUTORUN.txt`） |
| 状态 | 🟠 部分 |
| 是什么 | **扩展包 3 的激活入口**（包内文件 #0 = 统一 id 0x3000000）：与包 1/2/4/5 同构 —— 先按包内副本重跑整套数据表（`$3$SCINIT`…`$3$BTANINIT2`，39 张）、再把包 3 自己的脚本 id 表灌进 globals，最后 `bit-set (global-int 7087f5) 3` 置「包 3 已安装」。★**唯一一处调用音乐表指令**（`i1d7`/`i1d8`）。 |
| 怎么进/出 | ★**没有任何脚本 call 它**（全语料 `call-script` 的立即数最大只到本体 id）——唯一入口是引擎的 `i143`（0x143）派发 `slot<<24`：本体 `INIT2.txt:140` 执行 i143 时，已装载的包各被排一个 `slot<<24` 请求，slot=3 ⇒ 0x3000000 = 本脚本（emulator 由此把帧 37 装成 `$n$AUTORUN.BIN`）。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `6-44` | `call-script 3000375` | 包内数据表按与本体 INIT2 相同的顺序重跑一遍（`$3$SCINIT`…`$3$BTANINIT2`，共 39 条）⇒ 覆盖本体 INIT2 装好的那批 globals |
| `45-66` | `mov (global-int 708999) 300039c` | 把包 3 的脚本 id 表灌进 globals（0x300039c..0x30003b1，含 `122507` = 0x30003b1 这类引擎侧槽） |
| `67-68` | `i1d7 (global-int 1396) 1` | ★**音乐表登记**：`i1d7`（第一层 `0x42E800` → `sub_48AA60`）先建「组 1」（PCM 分组表初始为空 ⇒ 建出 `[占位 0]`、返回 0 写进 scratch global 1396）；`i1d8`（`0x42E850` → `sub_48A1B0`）再把包 3 的音乐文件 id `30003b2` 记进组 1，返回 `(1<<24)\|1 = 0x1000001` 写进 global 70801e |
| `69-70` | `bit-set (global-int 7087f5) 3` | ★置「已安装扩展包」掩码第 3 位（global 7087f5），然后 exit —— 存档界面 `SAVE.txt:885-888` 拿这个掩码与存档记录的安装状态比对 |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `global 7087f5` | 扩展包安装位掩码（bit n = 第 n 包装了）；各 `$n$AUTORUN` 各置自己那位 |
| `global 70801e` | ★`i1d8` 的返回值（packed 曲号 `0x1000001` = 组 1 的第 1 首）；**全语料无任何读取方**，但写入本身就是必须的副作用 |
| `global 1396` | `i1d7` 的返回值（0 = 新组数 − 1）；这是被 `i140`/`i228`/`i19e` 反复覆写的 scratch 槽 |
| `global 122507` | 引擎侧槽（= 0x30003b1，与其它 `$n$` 包的同类槽成组） |

## 不变量（拿它做回归断言）

- `i1d7 <组号> 1` 必须早于 `i1d8 <组号> …` —— 组不存在时 `i1d8` 返回 −1（引擎 `sub_48A1B0` 的组越界分支）
- 本脚本执行完必须满足：`global 7087f5` 的第 3 位 = 1，且 PCM 分组表 = `[[0, 0x30003b2]]`

## 坑（踩过一次，别再踩）

- ★`i1d8` 的结果落进**无人读取**的 global 70801e —— 曾据此把 `0x1D6/0x1D7/0x1D8` 全判成 no-op。**错**：写全局表本身就是副作用，而且这一步真正改建的是 PCM 的分组表（`play-bgm` 的曲号解析 `sub_48DB80` 会读它）
- 包内曲号不是统一文件 id：`i1d8` 记进去的 `30003b2` 是**文件 id**（高字节 0x3 = 包 3），而它返回的 `0x1000001` 是**曲号句柄**（组 1 的下一首），两者用途不同
- 包 3 与包 1/2/4/5 的 AUTORUN 同构，唯一差异就是这三行音乐表调用（其余包没有）

## 缺口

- 只登记了 1 首包内曲（`30003b2`）；包内 OP/ED 影片曲不走这张表。
- emulator 侧：`i1d7`/`i1d8` 已实现（`MUSIC_TABLE_OPS`），真实派发链的产物有断言（`test/append-packs.test.ts` 的 E3 段、`test/music-table.test.ts`）；但与真机的曲号表 dump 对照（E4）缺。

## 相关

- 引擎常态能力：`append-pack-discovery-and-activation`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`music-number-table-lifecycle`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x42E800`（见 `analysis/functions.json`）
- 函数结论：`0x42E850`（见 `analysis/functions.json`）
- 函数结论：`0x48A1B0`（见 `analysis/functions.json`）
- 函数结论：`0x48AA60`（见 `analysis/functions.json`）
- 函数结论：`0x48DB80`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/sound-system.md`
- 主题文档：`docs-new/03-engine/opcode-table.md`
- 守卫测试：`app/amayui-emulator/test/music-table.test.ts`
- 守卫测试：`app/amayui-emulator/test/append-packs.test.ts`

## 证据与备注

- 证据：src/$3$AUTORUN.txt 全文 70 行实读（音乐表在 67-68、掩码在 69）；派发路径 raw 25168-25191（i143 → queueScript(slot<<24)）；调用方 src/INIT2.txt:140；运行期断言 test/append-packs.test.ts（`groups = [[0, 0x30003b2]]`、`global 70801e = 0x1000001`）
- 备注：结构与 AUTORUN1 完全同构（39 张 `$3$` 表 + id 表 + 掩码）；那 39 张 `$3$` 表本身未逐行读（与本体同名表同构）。★本条目存在的理由：全语料只有这里用 `i1d7`/`i1d8`，是「音乐表指令族」唯一的真实用例。
