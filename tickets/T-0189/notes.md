# T-0189 · 过程文档（notes.md）

## 0. 结论（研究 + 落地）

**用户要的开关可行，且不必动玩家数据。** 侧栏（"charm 表"）的每格动作 = 脚本全局数组
`global 13b0[0..8]`，**派发在点击时才读表**（`src/SN0000.txt:401`）⇒ 只要在点击前把表写死即可。
全文见 `evidence/sidebar-charm-table-findings.md`。

采用 **H2**：`debug-query` 加写面 `set-global` / `set-array`，用例侧在点击前把表定死。

## 1. 本轮改了什么

| 层 | 文件 | 改动 |
|---|---|---|
| 引擎/VM（纯函数） | `app/amayui-emulator/src/vm/debugWrite.ts`（新增） | `setGlobalInt` / `setGlobalIntArray` / `forceIntArray`：**按 ENC 写**脚本全局 int 池；**不碰** `stringIndexTable`/`onSaveDataChanged`（不写回 SAVE.DAT） |
| 命令解析 | `src/vm/debugCommand.ts` | 新增 `{a:'set-global'}` / `{a:'set-array'}` + `parseNumToken`（`0x…`/含 a-f = 十六进制，纯数字 = 十进制）+ 帮助文本两行；非法输入按既有口径"当查询回报" |
| 渲染窗执行 | `src/renderer/app/session.ts` | 两个 case → 调 `debugWrite`，回执打 `global 0x.. ← 值（原 值）` + ★只改运行期内存 |
| 用例（ops） | `.agents/skills/amayui-remote-debug/scripts/ops/load-from-adv.mjs` | **开跑前自动** `forceSidebarLayout` 写死 `[0xd 0xe 1 0xb 0xc 2 3 4 5]` → 读回校验 → 点固定第 1 格（LOAD）；校验失败/`--keep-sidebar` 时退回候选扫描；模式安全断言（`f7ff0 == 1`）保留 |
| 核心驱动 | `.../scripts/emu.mjs` | 新增 `SIDEBAR`（表基址/槽数/动作 id/固定排布）、`setGlobal`/`setArray`/`forceSidebarLayout`/`readSidebarLayout`；CLI 加 `set-global` / `set-array` / `sidebar [--show]`；修 `parseArgv` 的"收尾裸开关记成 undefined"与"未知实例把读值解成 NaN"两处 |
| 文档 | `ops/README.md` / `amayui-remote-debug` SKILL §3.2 | **副作用（★必读）列**：`load-from-adv` 会改侧栏配置（运行期，不写回 SAVE.DAT）；写原语与 `--keep-sidebar` 都写明 |
| 第二层台账 | `analysis/engine-capabilities.json` 的 `adv-advance-route-table` | note 补：侧栏排布来源 = charm 表 `global 13b0`（默认在 INITCHARM、玩家改动在 CHARMEDIT）+ 测试期覆盖方式；已重生成 `docs-new/03-engine/engine-capabilities.md` |
| 守卫 | `app/amayui-emulator/test/debug-write.test.ts`（新增） | 9 例：ENC 往返（池里不是裸值）/ 前值取解码值 / 数组 = base+index / 整表写入 / **源码棘轮：写面不许触碰持久化面**（剥注释后正则）/ 非法下标抛错 / 解析三种数字口径 / 非法输入带用法 |

## 2. 验证矩阵（如实）

| 判据 | 状态 |
|---|---|
| 判据①实现写面（`set-global`/`set-array`） | ✅ 已实现（解析 + 执行 + 帮助 + CLI + ops 封装） |
| 判据②不动玩家数据 | ✅ 写面只写 `Engine.globals.int`；单测里有**源码棘轮**卡住 `stringIndexTable`/`onSaveDataChanged`/`saveData` |
| 判据③尊重引擎口径（ENC / 数组 = 连续槽） | ✅ 单测 4 例（含"池里不是裸值、DEC 回来等于原值"） |
| 判据④端到端（默认布局下也能从侧栏读档） | ⚠ **未跑**（写面落地后没有可用实例：验证途中实例损坏、用户中止；本机 `--attach-headless` 起一个死一个，需面板页当渲染页） |
| 判据⑤守卫：纯函数单测 + 一条 E3 | 🟡 单测 ✅（9/9）；**E3 未做**（"覆盖后 SN0000 的侧栏派发按新表分派"需要驱动到点击路径） |
| 判据⑥文档（capability note + ops README） | ✅ |

## 3. 剩下的事（本票未关）

1. **判据④**：有可用渲染页时跑一遍 `ops/load-from-adv.mjs`（**默认玩家配置**、或不带 `--keep-sidebar`），
   把真跑日志（含 `set-array` 回执 + 读回校验 + `f7ff0 == 1` + `[slot-load]`）归档进 `evidence/`。
2. **判据⑤的 E3**：真脚本层断言"覆盖 charm 表后，SN0000 的侧栏派发走到 `0xe`/`0xd` 分支"
   （需要在既有 E3 夹具上驱动到点击路径；比单测重，但不做的话"表真的被派发读到"只有静态依据）。
3. 可选：把固定排布做成**用例参数**（`--sidebar-layout d,e,1,...`），供"故意测默认布局"的场景使用。

## 4. 2026-09-26 的端到端尝试记录（`evidence/e2e-load-from-adv.log`）

实例 `sb189`（新 stage 的 77/78/79 + 玩家 `SAVE.DAT`）。结果分两半：

**✅ 已经验到的**

| 事实 | 证据 |
|---|---|
| `emu.mjs sidebar --show` 能读出真实排布，且**默认布局确实没有 SAVE/LOAD** | 日志里 `global 0x13b0[0..8] = 0x1 0xb 0xc 0x2 0x3 0x4 0x5 0x6 0x7`（= `INITCHARM.txt:6` 的默认表）—— 与用户口径"全默认没有这两个按钮"一致 |
| 候选扫描**机制可用**：逐格点、非存档画面就右键取消再试下一格，最后**响亮失败**而不是乱点 | 日志：第 0/2/4/7/8 格分别进了 `FELLOW` / `TITLE` / `GAMESTART` / `HISTORY` / `HIDEWIN`，其余留在 `SC0000`，9 格扫完报"侧栏里没有 SAVE/LOAD" |
| `emu.mjs reset` 的失败诊断准确（区分"没页面"与"页面在但帧循环停摆"） | `reset 起完实例但没有可驱动的渲染页：…页面在（viewers=1）但帧循环停摆…` |
| 从 TITLE 读档这条链在本实例上**可以走通**（本轮实际载入了 077，帧链落到 `SC0000.BIN`） | 日志 `[slot-load] 真槽装载…savedCur=1、帧记录 2 条` + `cur=1 [1] SC0000.BIN ←cur` |

**⚠ 没跑完的原因（两条，都不是"写面本身坏了"）**

1. ★**渲染页跑的是构建产物**：新加的 `set-array` 在页面里还不存在（回执 `未知查询：set-array`）
   ⇒ 必须先 `npm run build:electron` 再重启实例。这条与 `lessons.md` #26 / remote-debug SKILL §5 坑 12 同源，
   但**新命令的语境**要单独记：**改了 `src/vm/debugCommand.ts` 也算"渲染侧"**（页面里跑的是 bundle）。
2. 重建 + reset 之后，本机环境又回到"**页面在但帧循环停摆**"（面板页被节流 / 旧 VM 残留）
   ⇒ `waitTicking` 挡住（这是设计如此：宁可不跑，也不在停摆的页面上假装点了）。
   **补跑条件**：把该实例的面板页调回前台（保持可见）后再执行
   `emu.mjs reset --instance <id>` → `ops/load-from-title.mjs --slot 79 --expect SN0000.BIN` → `ops/load-from-adv.mjs --slot 78`。

**顺带修掉的两条 flake（本轮实测逼出来的）**

- **选行要可核对**：`global 138e` = **页内行号（0 基）**（实例上点 y=678 ⇒ `138e=7` ⇒ 对话框问的是槽 077）。
  `pickSlotInSaveScreen` 现在选行后**核对 `138e`**，不对就重试最多 3 次；核对不过**直接报错**（因为 LOAD 会去问别的槽，最坏覆盖存档）。
- **确认「是」要点得到**：对话框出现有延迟，只点一次会撞上"点空 ⇒ 45s 超时"（本轮就是这么失败的）
  ⇒ 改成最多点 3 次、每次等 5s 看 `[slot-load]`（点空是 no-op，不危险；危险的是选错行，已由上面那条挡住）。
