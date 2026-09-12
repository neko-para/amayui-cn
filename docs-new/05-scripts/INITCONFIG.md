# 脚本台账 · `INITCONFIG`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `INITCONFIG.BIN`（真源 `src/INITCONFIG.txt`） |
| 状态 | ✅ 已分析 |
| 是什么 | 「配置默认值」的分发脚本：按顺序调用 INITCONFIG0..5（系统/游戏/ADV/声音/角色色/操作 六页各一份）。 |
| 怎么进/出 | SYSTEM4 首次启动分支 `call-script 51dc`（SYSTEM4.txt:78）；CONFIG1/CONFIG2 的「初始化本页」也调它（CONFIG1.txt:940、CONFIG2.txt:855）。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `5-12` | `call-script 51d3  // INITCONFIG0` | 依次 call-script INITCONFIG0(51d3)/1(51d4)/2(51d5)/3(51d7)/4(51df)/5(51d9)，各自写该页默认值并 save-int 登记 |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `call-script 51d3..51d9/51df` | 六页默认值脚本的脚本 id（与 src/INITCONFIG*.txt 对应） |

## 不变量（拿它做回归断言）

- 本脚本**只写默认值**：调用它 = 该页设置回到初始状态（所以只能出现在「首次启动」或玩家点「初始化」时）

## 坑（踩过一次，别再踩）

- 它是 SET 而不是 LOAD —— 与 LOADCONFIG 混用会把玩家设置清掉

## 相关

- 引擎常态能力：`save-data-tables-persistence`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x434F60`（见 `analysis/functions.json`）
- 函数结论：`0x434FE0`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/save-data.md`
- 守卫测试：`app/amayui-emulator/test/save-data.test.ts`

## 证据与备注

- 证据：src/INITCONFIG.txt（全文 12 行）；分支判据见 src/SYSTEM4.txt:71-81；E3 见 test/save-data.test.ts
- 备注：六页默认值脚本各自的内容见 INITCONFIG0 条目与 src/INITCONFIG1..5.txt。
