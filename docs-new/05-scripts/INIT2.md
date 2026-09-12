# 脚本台账 · `INIT2`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `INIT2.BIN`（真源 `src/INIT2.txt`） |
| 状态 | 🟠 部分 |
| 是什么 | **本体数据表总装载**：依次 call-script 40 张本体 INIT 表（SCINIT/CTINIT/…/BTANINIT2），再把一大批脚本 id 灌进 globals（界面/场景脚本表），★最后用 `i143` 把**扩展包的 $n$AUTORUN 排进脚本请求队列** ⇒ 扩展包内容在本体表之后覆盖。 |
| 怎么进/出 | SYSTEM4.txt:124 `call-script 5261`（本体启动链：SYSTEM4 → INIT2 → 40 张 INIT → i143 → 场景设置）。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `66-105` | `call-script 51fc` | 40 张本体 INIT 表：`call-script 51fc..5223`（SCINIT…BTANINIT2），按调用顺序即装载顺序 |
| `138-143` | `mov (global-int 122724) 5244` | 脚本 id 表末尾（:139）之后紧跟 ★`:140` 的 `i143`（0x143）：引擎遍历扩展包表槽 1..255、对每个非零槽把 `slot<<24` 排进请求队列并派发 ⇒ 该包的 `$n$AUTORUN.BIN`（包内文件 #0）开始执行（`i143` 本身只有 4 个字符、不满足锚点长度闸门，故锚点取同一段的边界行） |
| `165-183` | `call-script 510a` | 场景/地图设置段（SETSTAGE/SETMAPTEX/SETHALLTEX/SETOBJ/DRAWMAP/RESETMAPAN/SETREIGNTEX/SETWEATHER），i143 之后才跑 |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `local 0 / 1 / 2 / 3` | i143 之后的表格修补循环（扫 0x3e8 项、比较 global adcd 与 14a8f1 两表） |
| `global 708xxx 区` | 脚本 id 表（`mov (global-int 7088xx) 52xx` 一片）：本体脚本入口地址表 |

## 不变量（拿它做回归断言）

- `i143` 必须排在 40 张本体 INIT（:66-:105）**之后** —— 扩展包的 $n$AUTORUN 会再跑一遍同名的 $n$ 版本表覆盖同一批 globals，顺序就是语义
- INIT2 由 `SYSTEM4.txt:124` 调用，是本体唯一的 INIT2 入口

## 坑（踩过一次，别再踩）

- 本体 40 张 INIT 与扩展包的 $n$ 版本是**同构覆盖**关系（`$1$AUTORUN.txt:6-44` 与 `:66-105` 一一对应），所以「哪些内容属于扩展包」不能靠脚本名判断，要看它跑在哪一轮
- `i143` 只在**本体 INIT2** 里出现一次（全语料仅此一处）；扩展包自己的 `$n$AUTORUN` 不再调 i143 ⇒ 没有递归激活

## 缺口

- emulator：`0x143` 仍是 no-op（src/vm/handlers/stubs.ts 的 op_engine_internal）⇒ 本行之后 5 个扩展包一个都不会激活

## 相关

- 引擎常态能力：`append-pack-discovery-and-activation`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x41A000`（见 `analysis/functions.json`）
- 函数结论：`0x414AC0`（见 `analysis/functions.json`）
- 函数结论：`0x455750`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/resource-loading.md`
- 主题文档：`docs-new/03-engine/opcode-table.md`

## 证据与备注

- 证据：src/INIT2.txt:66-183 实读（其它段未读）；调用点 src/SYSTEM4.txt:124；handler raw 25168-25191（sub_41A000）；实测：emulator 跑到 INIT2 但无任何 $n$ 脚本载入（.tmp/appendRun.log）
- 备注：只读了启动装载这条主线（:66-:183）；INIT2 的 :1-:65 与 :184-:187（尾部 exit）未逐行读。
