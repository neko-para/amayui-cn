# T-0191 · 过程文档（notes.md）

## 0. 本轮做了什么（2026-09-26，调研票，**不改任何代码**）

用户口径：「`amayui-remote-debug` 这个技能可以配合工具 `plugins/amayui-emulator`，但是似乎这个工具目前尚未支持
**查询/驱动 ops**，请调研情况」+「不要修改代码」，并指了 `tickets/T-0188` 作背景。

**结论：属实。** 插件侧的 agent tool `amayui_emulator` 只有 8 个动作，**没有 ops 的任何概念**（既不能列、也不能跑，
连 op 的判据都表达不出来）；ops 今天只能由 agent 用 shell 直接跑。本文件是这次调研的落点（§2~§5 是事实，§6 是待决策的方案对比）。

## 1. 口径对齐：本票的"ops"指什么

= `tickets/T-0188` 的三层结构里的**用例层**：`app/amayui-emulator/tools/ops/*.mjs`
（**不是** `app/amayui-emulator/src/vm/ops.ts` / `src/renderer/scene/ops.ts` 的 opcode）。

| 层 | 落点 | 现状 |
|---|---|---|
| 索引 | `ops/README.md` 的表格 | **唯一**真源，人读；没有机器可读清单（`load-slot.mjs --list` 列的是**实例**不是 ops） |
| 用例 | `ops/load-from-title.mjs`、`ops/load-from-adv.mjs`、`ops/_template.mjs` | 已实测 2 条 + 模板 + 待登记 4 条（battle / workshop / field / guild） |
| 原语 | `scripts/emu.mjs`（CLI 见 `emu.mjs:880-1031`） | 约 30 个导出：两帧点击 / 悬停 / 等条件 / 读态 / 起停 reset / 槽指纹 / 读日志 |

## 2. 两套驱动面（互不相识）

| | 工具面 `amayui_emulator` | 脚本面 `emu.mjs` + `ops/*` |
|---|---|---|
| 注册/动作面 | `plugins/amayui-emulator/lib/index.js:401-501`；动作枚举 `lib/tools.js:768-857`（default 的合法值串在 `:854`） | CLI `emu.mjs:916-1031` + `ops/*.mjs` 各自 `main` |
| 传输 | **直连实例端口**：`POST http://127.0.0.1:<port>/api/debug-query`（`lib/tools.js:163-201`） | **走插件每实例代理**：`http://127.0.0.1:3080/dsh-emulator/<id>/api/debug-query`（`emu.mjs:53`、`:185`，带瞬时故障重试 `:175`） |
| 动作/原语 | 8 个：`instances/start/stop/query/capture/input/profile/wait` | 见 §1 的"原语"行 |
| 知道对方吗 | **不知道**：插件目录 grep `ops` / `emu.mjs` 零命中；工具描述（`lib/index.js:403-414`）与 8 个动作都没提 | ops 就是它自己的用例层 |

两侧都落在同一条被调用的路由（`POST /api/debug-query`，命令表仍是 `src/vm/debugCommand.ts`），
但**没有共享任何"用例"层**。

## 3. 缺口逐条对账（op 需要的 vs 工具能给的）

| op 需要的东西 | 工具面 | 脚本面（落点） |
|---|---|---|
| 列出一共有哪些 op | ✗ 无 | `ops/README.md` 表格（人读） |
| 执行一条 op（含参数 `--slot/--expect`） | ✗ 无 | `node …/ops/<name>.mjs` |
| 两帧点击（`move→press→停≥2帧→release`） | △ 只能 `press`/`release` 两次调用手工拼；`click` 是"合成悬停 + 单次三连"（`lib/tools.js:335-343`） | `emu.tap()`（`emu.mjs:511`） |
| 等 `cur = 某 BIN` | ✓ `wait.until.bin` | `emu.waitBin()`（`emu.mjs:542`） |
| 等"可驱动"（有渲染页且帧循环在跑） | ✗ 无（`instances` 只给 live/心跳） | `emu.waitTicking()` / `diagnose()`（`emu.mjs:259`、`:225`） |
| 等虚拟机不忙（往返 < 600ms） | ✗ 无 | `emu.waitIdle()`（`emu.mjs:450`） |
| 等侧栏路由项数就绪（折叠 2~3 → 展开 ≥10） | ✗ 无 | `emu.waitSidebarReady()` / `routeCount()`（`emu.mjs:484`、`:432`） |
| 读实例日志（判据 `[slot-load]`） | ✗ 无（`start` 只把日志写到 `.tmp/emudbg/<id>.log`，没有读回的动作） | `emu.readLog()` / `logCursor()` / `waitLog()`（`emu.mjs:553-576`） |
| 槽指纹对账（判据④） | ✗ 无 | `emu.slotFingerprint()`（`emu.mjs:848`） |
| 模式全局 `f7ff0`、`13b0` 等 | ✓ `query ["global …"]` / `wait.until.global` | `setGlobal/globalsOf/…` |
| 引擎态 probe | ✗ 无 | `emu.probeOf()`（`emu.mjs:314`） |
| 起停 / reset 回干净 TITLE | ✓ `start`/`stop`；△ 没有"reset 并等回 TITLE" | `emu.resetInstance()`（`emu.mjs:795`，含 pid 真死判据 + 时钟新鲜度断言） |

⇒ 两个 op 的**判据**（日志 + 槽指纹 + `f7ff0` + 路由项数 + 往返门）在工具面上**一条都表达不了**；
用工具手工复现一个 op 就等于**重新读界面猜坐标** —— 正是 `tickets/T-0188` 与 `lessons.md` #29 明令禁止的做法。

## 4. 为什么会长成这样（是两轮各自收口，不是单点遗漏）

* 工具侧三条硬设计（`lib/tools.js:11-27`）：① 复用既有 HTTP 路由、**不解析任何仿真命令**；② PNG 只落盘不回模型；
  ③ 往返毫秒是证据。并且明确写了「等待是**调用方**的诉求，不是引擎的能力」⇒ 只做只读探针
  （`lib/tools.js:672-679` 的注释）。
* ops 侧边界（`T-0188` acceptance 第 6 条、`lessons.md:124-125`）：**原语与用例分层**、**这一层不模拟设备**、
  用例只许放 `ops/`（`SKILL.md:261` 坑 14）。
* 两轮（工具 = `T-0180/T-0181` 那一轮；脚本 = `T-0188/T-0189` 那一轮）**从未对齐接口面**，
  也**没有任何票**要求"工具要能查/跑 ops"。

## 5. 账本事实：工具面至今没有属主票（本票一并认领）

工具面代码注释引的是 `tickets/T-0181`（`lib/tools.js:1`、`lib/index.js:373`），
而 **`T-0181` 是 OOM/纹理泄漏票**（`mem` 命令那条，见 `tickets/T-0181/ticket.json`），**不覆盖 agent tool**。
全库 grep `amayui_emulator` / "agent tool" 也找不到属主票 ⇒ 本票即工具面的认领票。

## 6. 方案对比（**2026-09-26 已定：选 A**；落地见 §9。本票验收第 1 条要求"先落纸再动手"）

| 方案 | 做法 | 收益 | 代价 |
|---|---|---|---|
| **A** | 工具加 `action=ops`（列）+ `action=op`（跑，spawn 技能侧 `ops/<name>.mjs`，透传 `--instance/--slot/--expect`） | 单一真源（ops 脚本仍是唯一实现）、一次工具调用、坐标不再重猜 | 插件 → `.agents/skills/` 路径耦合；ops 现在只有人读 `console.log`，需补机器可读结果行；**不能用 pipe 抓 stdout**（见 §7 环境事实 2）；副作用（`load-from-adv` 改运行期侧栏表）要在回执里标注 |
| **B** | 工具只加只读查询（解析 `ops/README.md` 出清单）+ 补齐缺的可组合原语（两帧点击 / 日志 / probe / waitIdle 等） | 边界干净、无跨目录 spawn | 坐标表与选槽原语仍在 `emu.mjs` ⇒ 手工驱动依旧易错；且形成"两处真源"（`lib/tools.js:13-15` 把这条列为最贵的债） |
| **C** | 通用 `action=script <path> [args]` | 面最薄 | 等于把 shell 塞进工具，风险最大，不建议 |
| **D** | 都不改，只把"工具面不含 ops"写进 `SKILL.md` §3.2 / 插件 README | 最省 | 缺口仍在，下个 agent 还会照旧撞 |

未定项（决策时必须回答）：① 坐标表/选槽原语**归谁持有**；② ops 的结果契约（人读 log → JSON 行）谁定；
③ 路径耦合是否可接受（`.agents/skills/` 不在插件包内）；④ 副作用用例的默认开关。

## 7. 两条环境事实（实测，影响 A 的实现方式）

1. **现在就有可驱动的活实例**：`node app/amayui-emulator/tools/emu.mjs status`
   → `● t0187 port=57335 pid=4296 viewers=1 bin=TITLE.BIN frames=3980 gate=sleep  可驱动`；
   工具的 `action=instances` 也列出同一条（另有 33 条过期记录）⇒ 两个面看到的是同一批实例，ops 路径随时可跑。
2. ★**本会话 shell（DSH 文件沙箱 workspace-write）里管道式子进程 stdio 被拒**（详见 `T-0192`）：
   `spawn(process.execPath, […])` 用默认 `stdio:'pipe'` 直接 **EPERM**（`spawnSync` 回 `error.code=EPERM`；
   Promise 形态 `REJECTED EPERM`）。
   ⇒ 若选方案 A：**不要用 pipe 抓 op 的 stdout**（用临时文件 fd / `stdio:'inherit'` + 落盘再读）——
   插件现有 spawn 都是文件 fd（`lib/tools.js:463-469`）或 `stdio:'ignore'`（`:587`），没踩这个坑。

## 8. 本次只读核过的落点

`plugins/amayui-emulator/lib/tools.js`、`plugins/amayui-emulator/lib/index.js`、
`plugins/amayui-emulator/README.md`（「agent tool」整节）、当时的 `SKILL.md` §3.2、
当时的 `scripts/{emu.mjs,ops/*,load-slot.mjs}`（**现已搬到 `app/amayui-emulator/tools/`**）、
`tickets/T-0188/ticket.json` + `notes.md`、`tickets/T-0181/ticket.json`、
`docs-new/00-overview/lessons.md`。

## 9. 决策与落地（2026-09-26，方案 A）

**决策（= 本票验收第 1 条要求的"先落纸"）**：选 **A**。

1. **真源唯一**：坐标 / 判据 / 副作用只在 `ops/*.mjs` + `ops/README.md`；工具只"读 + 转发"，**不复制坐标表**
   （B 会把原语分叉成两处真源，正是本插件文件头列为最贵的债的那条）。
2. **路径归属**：把 ops 资产从技能目录**搬到 `app/amayui-emulator/tools/`** —— 插件不必跨 `.agents/` 取脚本，
   而它们仍是"工程脚本"（纯 node、脱离 DSH 也能跑）。
3. **参数不进工具**：`args` 原样透传给各 op 自己的 CLI（否则"每个 op 有哪些参数"会多出第二份真源）；
   工具只挡一条：`args` 里再给 `--instance`。
4. **创建只给骨架**：开屏手势 / 机器可读判据 / 特有坑这三样**只能实测得出**，工具不猜，只把清单摆出来。

**落地点**：

| 面 | 落点 |
|---|---|
| 查询 | `lib/tools.js` 的 `listOps` + `action=ops`（目录 + 文件头自述 + `ops/README.md` 主表 / 待登记 / 幽灵） |
| 执行 | `doOp` + `action=op`（`--instance` 注入、`args` 透传、日志 = **文件 fd**、超时收进程树、回日志尾部） |
| 创建 | `doOpCreate` + `action=op-create`（模板 + 占位替换 + 拒绝覆盖 + 4 条待办） |
| 资产 | `app/amayui-emulator/tools/{emu.mjs,load-slot.mjs,ops/*}`（原技能目录只剩 `SKILL.md`） |
| 守卫 | `plugins/amayui-emulator/tool-smoke.mjs`（假 root + 假实例 + 真 spawn；22/22 绿） |
| 文档 | `ops/README.md`（含手驱动坐标表）、插件 README（动作表 11 项 + 取舍整节 + 已知限制 8）、`SKILL.md`（→ 入口索引）、新增 **`AGENTS.md`**、`CONTEXT.md`/`lessons.md` 换指、16 个文件的旧路径机械换指（`ledger.js --plan` 的 patches） |

**验证（实测）**：`tool-smoke.mjs` **22/22**；真 root 的 `action=ops` = **2 已登记 / 4 待登记 / 0 幽灵**；
`emu.mjs status` 与 `load-slot.mjs --list` 在**新路径**下照常；`smoke-client.mjs` 绿；
`smoke.mjs`（Host 半）在受限 shell 里仍红 —— 那是它自持 `pipe` 起宿主的**既有**问题（见 §7 事实 2 与 `AGENTS.md` §1.1），本票未改它。
★**真机端到端（2026-09-26，用户重启环境后、经工具面跑的）**：`action=ops` 列出 2 条已登记 + 4 条待登记；
`action=op {name:"load-from-title", args:["--slot","78","--expect","SN0000.BIN"]}` 打在 `t0187`（当时在 `TITLE.BIN` 且可驱动）上
⇒ **exit 0 / 11.2s**，判据全中（`cur = SAVE.BIN` → 日志 `[slot-load]` → **槽指纹 `savedCur=2`/帧记录 3 条 ✔ 一致** → 帧链到 `SN0000.BIN`），
日志归档 `tickets/T-0191/evidence/e2e-action-op-load78.log`；`action=op-create` 在真 root 生成骨架（占位替换干净、
新 op 立刻以 `indexed=false` 出现在清单里，产物已清理）。
★**顺带答掉 `T-0192` 的一条待核**：**插件宿主（DSH server）不受"管道式子进程"那条沙箱约束** ——
工具 spawn 的 op 内部又 `spawn(tsx src/tools/saveDump.ts)`（默认 pipe）并**成功**读回槽指纹；
而同一条 op 在 **agent shell** 里跑就会在判据④静默跳过（`AGENTS.md` §1.1 的红名单仍成立 —— 它只覆盖 agent shell 的后代）。
★**未做（如实登记）**：把 `tool-smoke.mjs` 纳入 `npm run verify` 的闸门（跨包 import + `typecheck:test` 口径需另行设计）。

## 10. 「技能能不能直接删掉？」（评估 + **已执行**）

**结论：能删，代价很小** —— 评估如下，★**并且已于 2026-09-26 按用户决定删掉**：

* 资产已搬空：技能目录当时只剩 `SKILL.md`，且它已被**去重成入口索引**（命令表 / ops 索引 / 坐标 / 权限**各自只指向唯一真源**）。
* 引用面已核：全仓只剩 `CONTEXT.md`（§1 那行已改成"工具 + `AGENTS.md`"）、`tickets/T-0139`（技能编制票）
  与 `T-0188/T-0189/T-0191` 的过程文档提到它；`analysis/*.json`、`docs-new/*` 已不再指向技能目录（路径全换指）。
* ★删之前必须做的一件事：`T-0139` 的守卫规格是
  `.agents/skills/amayui-remote-debug/SKILL.md#amayui-remote-debug` ⇒ 删目录会让它变红。

**执行记录（2026-09-26）**：

1. `Remove-Item -Recurse .agents/skills/amayui-remote-debug`（`SKILL.md` + 空的 `scripts/`）；`.agents/skills/` 现剩 **8** 个技能。
2. `T-0139`：守卫规格 retarget 到 **`plugins/amayui-emulator/README.md#agent tool：\`amayui_emulator\``**（驱动手册的唯一落点）；
   `acceptance[0]` 标注"原判据在交付时成立、退役后不适用"；`links.tickets` 增 `T-0191`；退役过程写进 `tickets/T-0139/notes.md`。
3. 退役后的四个入口：工具描述（动作）/ `debugCommand.ts`（命令表）/ `tools/ops/README.md`（用例 + 坐标）/ `AGENTS.md`（环境与权限）。
* 收益 = 少一份"第三处表"（技能一加载就把索引塞进上下文）；代价 = 少一条"按名字可检索"的入口（工具描述 + `AGENTS.md` 本来就在上下文里）。
