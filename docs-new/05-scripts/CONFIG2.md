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
| `1652-1687` | `label_00007178` | ★**逐行名色的来源**：按开关位 a9dd 从 `adcd[14acda]`（14acda = 当前行下标/选中项）取色写 f807b/f807c，再 `i076/i077/i078/i1a4` 应用（= 全局样式字段只有一套 ⇒ 谁最后写谁值） |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `local 193d` | 行下标（图元 handle = 0x1d4c0 + 家族偏移 + 193d） |
| `local 193f / 1940` | set-texture 的 imgid / 目标槽号 |
| `local 800 / be8` | i12f 的索引数组 / 次键数组 |
| `global 14b894` | i12f 的主键数组（全局，非本脚本局部） |
| `global 14acda` | 当前行下标（= i2ff/i2f5 的选中项；`label_00007178` 用它索引颜色表 adcd） |
| `global f807b / f807c / f8079 / f807a` | → i076 填充色 / i077 描边色 / i078 描边档位 / i1a4 描边偏移 的中转（按行设置） |
| `表 adcd[] / a9dd（位 1=描边色 位 2=填充色）` | 逐行颜色表 + 「该项是否启用自定义色」的开关位 |

## 不变量（拿它做回归断言）

- 与 CONFIG1 共用 handle 基址 0x1d4c0 ⇒ 图元家族必须按**子区间**辨别（3e8/5dc/514/898 等）
- ★每行的名色只影响**该行自己的直绘文本**（0x204 立即消费全局色），不得改变任何**已入队**的消息窗文本（作用域规则见 text-style-scope-queue-time）

## 坑（踩过一次，别再踩）

- i12f 的 n 在这里是 1000（全局大表），而 CONFIG1 是 15（当前分类的小表）——同一指令、两种规模
- 本页的 9 个角色位靠 set-texture 逐位绑定（槽 182..190），未绑定的位会退化成占位块
- ★角色名颜色溢出的根因（用户实测）：本页 1300/1349/1369/1511 行**逐行** `i076 (global-int f807b)`（值由 `label_00007178` 按 `adcd[14acda]` 算）——若渲染侧把「写全局色」当成「给所有窗换色」或每次重绘都实时读全局色，下方 ADV 样例窗（win 9，由 CONFIG/CONFIG2 在**入队时**画好）就会变成**最后一个可见角色名**的颜色 ⇒ 修复 = 入队时钉住样式（见 text-style-scope-queue-time / test/text-style-snapshot.test.ts）

## 缺口

- 未逐段读（layout 列出的就是读过的范围）
- 0x205 未实现；9 个 CV 名牌（CV000xB.AGF）在 emulator 里渲染成**黑色剪影**（疑似 AGF 调色板/通道解码问题）

## 相关

- 引擎常态能力：`script-frame-local-pool-lifecycle`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`gdi-direct-text-to-slot`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`text-style-scope-queue-time`（见 `docs-new/03-engine/engine-capabilities.md`）
- 引擎常态能力：`audio-module-topology-and-volume-routing`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x42F560`（见 `analysis/functions.json`）
- 函数结论：`0x423390`（见 `analysis/functions.json`）
- 函数结论：`0x422CB0`（见 `analysis/functions.json`）
- 函数结论：`0x46BE30`（见 `analysis/functions.json`）
- 函数结论：`0x459F40`（见 `analysis/functions.json`）
- 函数结论：`0x420B40`（见 `analysis/functions.json`）
- 函数结论：`0x420B00`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/opcode-table.md`
- 主题文档：`docs-new/03-engine/adv-text-rendering.md`
- 主题文档：`docs-new/03-engine/sound-system.md`
- 守卫测试：`app/amayui-emulator/test/text-style-snapshot.test.ts`

## 证据与备注

- 证据：src/CONFIG2.txt 的区间见 layout；运行期证据：`npm run shot`（默认就切到本页）的 .tmp/shot-2-tab4.png；样式作用域的 E3 断言见 test/text-style-snapshot.test.ts 的 previewProbe（win 9 恒为入队色 #ffffff，全局色末值 #b690ff）
- 备注：尚无自动化测试覆盖本页的**图元**布局；样式作用域已由 previewProbe 覆盖。E4 目视由 `npm run shot` 覆盖。 音频侧：全页 11 处 `i0b5`（:732-733 是成对的 `play-sound-effect 39a4 1` + `i0b5 1`；其余 `i0b5 2` 直接触发通道 2 上已装载的音效）＝ 0xB5 SE 通道起播（播一次）。
