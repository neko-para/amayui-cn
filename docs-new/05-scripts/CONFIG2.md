# 脚本台账 · `CONFIG2`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `CONFIG2.BIN`（真源 `src/CONFIG2.txt`） |
| 状态 | 🟠 部分 |
| 是什么 | 设置界面的**「角色设定」页**（左侧第 5 个分类）：9 个角色位（CV 名牌 + 説明文字）+ 詳細変更/on/OFF/▶ 控件 + 左侧分类 + 滚动条。 |
| 怎么进/出 | CONFIG.BIN 在 `12721e != 4` 时 call-script 51cb；与 CONFIG1 同样是『退出后由父脚本重新调起』，共用全局 `12721e`/`12721f` 与同一套 handle 基址 0x1d4c0。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `1040-1050` | `i12f (local-int 800) (global-int 14b894) (local-int be8) 3e8` | 可见项表排序：A=800（索引）/ B=全局 14b894（主键）/ C=be8（次键），n=0x3e8=1000（规模比 CONFIG1 的 15 大得多） |
| `1210-1300` | `add (local-int 193d) 1d4c0 3e8` | 行图元族（与 CONFIG1 同一基址）：0x3e8 行背景带 / 0x5dc·0x514 数值控件 / 0x528·0x5f0 第二组控件 |
| `1240-1250` | `set-texture (local-ptr 1) (local-int 193f) (local-int 1940)` | 角色位贴片绑定：运行期 = 槽 182..190 ← CV0004B..CV0012B.AGF（256×40，共 9 位） |
| `1320-1330` | `draw-string c4 6 (local-int 7fe)` | 行文本直绘进槽 196（x=6、行距 40）——运行期日志形如 drawString slot=196 (6,6) "喚醒了女神的鍛梁師" |
| `1500-1512` | `draw-string c5 a a "ＣＶ："` | 槽 197（create-texture 948×90）上的 CV 说明区：三行文本 |
| `1460-1470` | `add (local-int 193d) 1d4c0 898` | 详情面板图元族 0x898（本页特有） |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `local 193d` | 行下标（图元 handle = 0x1d4c0 + 家族偏移 + 193d） |
| `local 193f / 1940` | set-texture 的 imgid / 目标槽号 |
| `local 800 / be8` | i12f 的索引数组 / 次键数组 |
| `global 14b894` | i12f 的主键数组（全局，非本脚本局部） |

## 不变量（拿它做回归断言）

- 与 CONFIG1 共用 handle 基址 0x1d4c0 ⇒ 图元家族必须按**子区间**辨别（3e8/5dc/514/898 等）

## 坑（踩过一次，别再踩）

- i12f 的 n 在这里是 1000（全局大表），而 CONFIG1 是 15（当前分类的小表）——同一指令、两种规模
- 本页的 9 个角色位靠 set-texture 逐位绑定（槽 182..190），未绑定的位会退化成占位块

## 缺口

- 未逐段读（layout 列出的就是读过的范围）
- 0x205 未实现；9 个 CV 名牌（CV000xB.AGF）在 emulator 里渲染成**黑色剪影**（疑似 AGF 调色板/通道解码问题）

## 相关

- 引擎常态能力：`script-frame-local-pool-lifecycle`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`gdi-direct-text-to-slot`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x42F560`（见 `analysis/functions.json`）
- 函数结论：`0x423390`（见 `analysis/functions.json`）
- 函数结论：`0x422CB0`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/opcode-table.md`

## 证据与备注

- 证据：src/CONFIG2.txt 的区间见 layout；运行期证据：`npm run shot`（默认就切到本页）的 .tmp/shot-2-tab4.png
- 备注：尚无自动化测试覆盖本页；E4 目视由 `npm run shot` 覆盖。
