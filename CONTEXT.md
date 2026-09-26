# CONTEXT —— 工程现状快照（《天結いキャッスルマイスター》emulator）

> **本文件的定位**：只记 **状态 / 判绿口径 / 环境事实 / 可复用结论**。
> 进度与经过**不在这里**：逐条处置看 `tickets/<ID>/changes-*.md`，票面状态看 `tickets/README.md`，历史看 git。
> schema、纪律、命令清单**不在这里重述** —— 见 §1 的落点。凡推断都写明"候选/未证"；凡结论都带可复算的落点（文件:行 / 命令）。

## 1. 该读哪里（本文件不重述这些）

| 你要做什么 | 读它（权威在你/技能那边） |
|---|---|
| 开票 / 改票 / 收尾 | 技能 **`amayui-ticket-ledger`**（存储模型、状态流转、收尾三连、并行纪律） |
| 读引擎 / 落三层数据层 | 技能 **`amayui-engine-analysis`**（第一层 functions/fields、第二层 capabilities、第三层 scripts） |
| 分析 `src/*.txt` 脚本 | 技能 **`amayui-script-analysis`**（先读文档 → 读脚本 → 落 `analysis/scripts.json` → `build-scripts.mjs` → `docs-new/05-scripts/`） |
| 改台账**条目**（结构化/多条一起改） | `ledger.js --plan`（计划文件驱动、默认 dry-run；见 §7.17）——不要手改 JSON、不要"整段 old 串替换" |
| 看某条指令**还缺什么**（缺口全文/明细） | `gaps.js --show <opcode>` / `--missing <opcode>` / `--stale`（体检）/ `--recount`（口径唯一） |
| 起/驱动调试实例（agent 自足） | DSH 工具 **`amayui_emulator`**（`action=instances/start/stop/query/capture/input/profile/wait`）+ **`action=ops/op/op-create`** 查/跑/建操作脚本；脚本真源 `app/amayui-emulator/tools/{emu.mjs,ops/*.mjs}`。环境/权限（沙箱挡管道、跑 TS 用 hook 不用 tsx）见 **`AGENTS.md`** |
| 文档模型（真源/生成物/沿革） | `docs-new/00-overview/authority.md` 附录 **A1–A6** |
| 证据等级 **E0–E4** | `docs-new/03-engine/engine-capabilities.md` 头部 + 台账 schema 的 `evidenceEnum` |
| 审计的原始结论 | `docs-new/99-records/2026-09-impl-audit/impl-audit-2026-09.md`（人读）+ `.../raw/impl-audit-findings.json`（机器可读 383 条） |
| 其它技能 | `amayui-mnemonic-rename` / `amayui-ui-text-render` / `amayui-script-translate` / `amayui-script-update` / `batch-task-runner` |

**长期用户要求（仍未撤销）**：**不要 `git add` 任何东西**（本会话同样全程未 `git add`）。

## 2. 工程一句话现状

TypeScript 重写的 AGE 引擎 + 引擎逆向工程（真源 = `engine/天结_unpacked.exe_utf8.c`，只读；「raw NNNNN」= 该文件行号）。
当前阶段：**审计遗留收尾**（2026-09 审计覆盖 364/364 opcode + 54/54 能力条目，产出 383 条 finding）。
★**第 70 轮"清理剩余内容"收口后**：`T-0179` 的 `missing` 裁决做完（**95/95 带重开条件**）、`T-0148` §5.2 的 `still-present` 半边裁完、
**3 条 `verify` 基线红清零**（`T-0146` 关单）⇒ `npm run verify` **exit 0**。
判绿口径 = §6；未完成票 = §4；引擎侧硬结论 = §8。

## 3. 台账现状（快照 · 2026-09-25 第 70 轮"清理剩余内容"收口后实测）

```
票据 178 张：✅done 168  ⬜open 5  🔜doing 3  🚫dropped 2  ⛔blocked 0
  优先级 P0 8 / P1 68 / P2 63 / P3 38
  ★tickets.js --validate ✅ 177 张 / 0 条行号漂移警告（刷新工具 = `.agents/skills/amayui-ticket-ledger/scripts/fix-evidence-lines.js --any --write`；
  ★全库 1003 条被锚证据保持全额：漂移 0 / 失效锚点 0 / 缺 `line` 0）
能力台账 144 条：已核验 79 / 已建模未核验 5 / 部分 31 / 缺失 5 / n/a 24（证据 E0 6 / E1 28 / E2 59 / E3 46 / E4 5）
缺口台账 182 条：partial 72（**95 条 missing[]，承接票统一 = `T-0179`**）/ implemented 74 / deferred 22 / 有据 no-op 9 / unimplemented 5 / unjustified 0
第一层：functions.json 620 条 / fields.json 393 条（fields 按 scope 分组、组内 offset 升序）
脚本台账 37 条：已分析 10 / 部分 25 / 仅登记 2（src 分母 941）
死写基线 11 条（check:dead-writes 只许收缩；棘轮基线 test/harness-convergence.baseline.json 亦只许收缩）
六份真源的 evidence.line 漂移 = 0
```

★`partial` 是一等处置位（`missing[{what,ticket,raw}]`，`raw` 只能单段）；缺口数**上升是好消息** —— 它把原先藏在
`implemented`/`deferred` 里的"其实还缺东西"如实拆出来并挂票号。`unimplemented`（现 5 条）= 语料 0 处、命中即硬报错。
★**第 70 轮的位移（本轮实测）**：`missing` **104 → 95**、`implemented` **66 → 74**、`partial` **80 → 72**；
累计（`T-0179` 生命周期内）`missing` **140 → 95**。★**95/95 条存量 `missing` 全部带「重开条件」（机械核过 0 条缺）** ⇒
`T-0179` 的 acceptance ②（"逐条三态、不许留空"）已满足。
★**为什么 `T-0179` 仍留在 `doing`**：95/95 条 `missing[].ticket` 仍指向它 ⇒ 置 `done` 会原样重建本票 §1 要修的
"登记账失去 live owner"那个结构问题。取舍的两种做法与理由见 `tickets/T-0179/changes-round70.md` §22.4（**若要关单，改一行状态即可**）。
★**本节全部数字于第 70 轮与六份真源机械核对（逐项一致）**：票数/状态由 `tickets/*/ticket.json` 现数、能力处置由
`analysis/engine-capabilities.json` 现数、缺口与 `missing` 由 `analysis/opcode-gaps.json` 现数、第一层两条直接取数组长度、
脚本台账取 `analysis/scripts.json` 长度、死写取 `app/amayui-emulator/dead-writes.baseline.json` 的 `known` 条数。

### 3.1 收尾任务的真实剩余面（第 70 轮收口后）

- **`T-0179` 的裁决工作已收口**：存量 95 条 `missing` **全部**是 ② 结构性不适用（"写判词 + 重开条件即交付"）；
  本轮删掉 9 条（`0x213`/`0x24f`/`0x223`/`0x61`/`0x8c`/`0x2f5`/`0xcd`/`0x75`(字号 5 格)/`0x208`）、重写 23 条判词、
  实现 **1** 条（`0x208`：`session.ts` 的纹理屏障门收窄回单条 opcode ⇒ `0x249` 等不到屏障；语料 2 处 `i249 → i208 → draw-texture`）。
  ★**下一批若要继续减账**，只剩三类：**① 需跨文件**（`src/vm/native.ts` / `src/renderer/**` / `src/vm/operand.ts` / 影片解码器）、
  **② 等外部条件**（E4 采样 / 宿主子系统）、**③ 已判"永不"**（结构性不适用、重开条件写了"永不"）。
- **`T-0148` §5.2 的 `still-present` 半边（23 条）已裁决完毕**：3 条在 §5.3、10 条带 opcode 的由 `T-0179` 承接、
  **10 条 `—` 项本轮逐条裁决**（7 条可关 / 2 条改台账后可关 / 1 条转 `opcode-gaps`）。详见 `tickets/T-0148/changes-coverage.md` §5.4。
  ★方法论：§5.2 的 `quote-still-there` 只说明"**审计当时引的代码还在**"，**不说明"缺口还在"** —— 那 10 条里 9 条是过期快照。
- **`T-0148` §5.2 的 `quote-gone` 半边（13 条）也已裁完（goal round 3）**：**① 真缺口 ×1**（右键取消路由**读错格** ——
  修前读 `input.mouseJump`（`0xCC`），体 raw 20367 读的是 `rewindMainBase + cur`（`0x7B` 写）；语料 `i0cc` **0 处** /
  `i07b` **1097 处**⇒ 修前真脚本上右键取消永不触发。已一行修复 + 守卫，**红→绿 `1/4 → 4/4`**）·
  **② 结构性不适用 ×4** · **③ 早已补上没回台 ×8**。★其中 **2 条推翻了审计原文本身**（`0x1F5` 的「队列恰剩 1 项」是审计记错成它、
  实际属 `0x7C`；「每帧效果推进完全没有」与代码不符 —— `scWeatherAdvance` 就是 `sub_453540`，由 `commit.ts:90-92` 每帧经两宿主 `advanceModel` 调）。
  全文见 `tickets/T-0148/quote-gone-adjudication.md`；★§5.2 表里还有 4 行与 §5.1 的「已改」**重复**，可直接标 `closed(dup)`。
- ★**顺带补上一个结构性盲区**：**台账正文里的 `文件:行` 引用此前没有任何棘轮保护**（三个校验器只查字段类型/枚举/守卫）。
  已把体检脚本提升为常驻工具 **`.agents/skills/amayui-engine-analysis/scripts/check-ledger-refs.js`**（只读，带 `agent-workflow` 守卫，
  已写进两个技能的工具体表）；它第一次跑就抓到 2 处真问题（`0x142` 的行号引用 + `engineFieldIds.ts` 里一句与代码相反的陈旧注释）。
- **3 条 `verify` 基线红已清零**（`T-0146` 关单）：真槽 SAVE70/71 判据改成"**按字节判作者**"（引擎槽逐个必须解出 +
  本工程 `format=0` 槽按正向判据跳过 + 第三种作者一律失败）；`scene-report` 的 26 个占位项改成引擎 `sub_4AD0C0`
  raw 131957-131980「先 ensure 后门控」的忠实行为（删假不变量 + 5 条更强判据）；`host-registry` 的 idle 用例 timeout 改成常量派生。
- **非 `T-0179` 的尾巴**：`T-0019`（msgwin 拆分，与 `T-0179` 的 msgwin 族串行）、`T-0142`（Electron 调试通道，与用户实例冲突）、
  主序列外：`T-0051`/`T-0067`/`T-0088`/`T-0118`（外部条件）与 `T-0103`（用户点名最后做）。
  ★`T-0091` 已于第 70 轮**关单**（剩余四项全部收口）。
- **`T-0122`（引擎态快照/恢复）已 ✅关单**（goal round 4–6）：核心（自描述 JSON + 版本头 + **9 条** `SNAPSHOT_EXCLUDED` + 逐条告警）
  + **8 条 E2 守卫**（含"恢复后跑 600 步与自然态逐字节相等"）+ **1 条 E3 真语料守卫**（`test/engine-snapshot-e3.test.ts`）
  + **帧边界门**（`#atFrameBoundary` / 帧末放行 / 超时响亮失败；红→绿 7/8→8/8）+ `dbg.cjs save/load`。
  ★**E3 实测逼出的一条真结论**（已按纪律登记）：真语料下的分叉面**只有「依赖场景动画态的派生量」**（门被武装的绝对时刻、
  派发队列计时值）——**不是漏字段**，而是"快照的覆盖面口径"：`scene` 分区只覆盖票面点名的 `render4` 两格。
  ⇒ `SNAPSHOT_EXCLUDED` 第 9 条 + 两条重开条件（把 `SceneState` 整体纳入 / 或语义收窄为"VM 态"并交给画面快照一起存回）。
  ★**它补的口子**是"排查时没有『把某一刻的引擎态存下来、之后反复回到这一刻』的手段"（此前只能顺着帧往前看或加断点重跑）。
- **本轮顺带修掉一个"数据损坏级"的工具 bug**：`ledger.js` 的 `unset`/`set` 用 `indexOf('"key"')` 找**第一次出现**、
  会**穿透嵌套** —— 对 `text-layout-wrap-ruby` 的裸键 `note` 会删掉 `emulator.note`（被工具自己的"写盘后回读复核"拦下）。
  已改为按「容器 + 局部深度 1」定位（`findDirectKey`），`unset` 因此也支持点路径。
  ★并清了能力台账的**顶层杂键**（`capabilities.js --validate` 只查 `emulator.note`，顶层杂键一律漏检）：
  `note`(数组，逗号切碎事故残留)、`capability`/`evidence`(重复且 `live2d-mesh-batches` 的 `evidence:"E4"` 与权威 `E3` **矛盾**) 全删、沿革落 `journal`。

## 4. 未完成票据（8 张 = doing 3 + open 5）

★**性能这一维现在有工具了**（`T-0180` 落地）：调试命令 `profile`（帧看门狗默认开 + `profile on` 按 opcode 计时 +
`report` 归因），入口在 `src/vm/profile.ts`。★它的**第一条战果**：存档页 80→90 一帧 1552ms → 308ms
（`0x204`/`0x205` 直绘每遍新建画布 + `getImageData` 走 GPU 同步回读 ⇒ 复用图层 + `willReadFrequently`）。
★仍未收口：那一步剩下的 308~654ms **不在 opcode 里**（一帧 50 步、每条 0ms 却工作 654ms ⇒ 在帧循环的宿主阶段
`advanceModel`/`present`/纹理上传），另有一个 10000 步/4.5s 的独立帧。
★**同一张票还收了两条传输层优化**（`changes.md` §8/§9）：`0x1A0` 只读槽头（那帧 `0x1a0`×120 **4758→1278ms**）；
① 读取路径去掉 `number[]` 中间层（`Array.from` 3.7MB = 131ms/+89.7MB ⇒ `Uint8Array` 直传两条腿）；
② `capture` 的 PNG 改由**宿主直接落盘**（回执体 2,389,044 字符 → **237 字符**，`debug-query` 里不再有 base64）。

| 票 | 状态 | 现状 |
|---|---|---|
| `T-0148` 全指令核对主票 | doing | 剩余面 = ① §5.2 的 **`quote-gone` 半边**（13 条，其中 8 条 `stale-ledger` 已由 A–F 波解决；其余按 §5.1 记录）；② 与 `T-0019` 串行的 msgwin 族；③ 三张 doing 票。★§3/§8 的 80 个"审计点名但不在缺口台账"的 opcode **已机械化裁决完毕**（76/76 在运行时表里；0 个 `unregistered`）；★§5.2 的 **`still-present` 半边（23 条）已于第 70 轮裁决完毕**（3 条 §5.3 + 10 条带 opcode 的由 `T-0179` 承接 + 10 条 `—` 项逐条裁决），全文见 `tickets/T-0148/changes-coverage.md` §5.4 |
| `T-0179` 缺口台账 `missing` 的逐条裁决（开场 140 → 现 **95**） | doing | ★**第 70 轮收口**：**95/95 条存量 `missing` 全部带「重开条件」**（机械核过 0 条缺）⇒ acceptance ② 已满足。本轮删 9 条 / 重写 23 条 / 实现 1 条（`0x208`）。★**仍留 `doing`**：95/95 条 `missing[].ticket` 仍指向本票 ⇒ 置 `done` 会原样重建本票 §1 要修的"登记账失去 live owner"问题（取舍见 `changes-round70.md` §22.4；要关单改一行状态即可）。剩余存量按性质分三类：**① 需跨文件**（`src/vm/native.ts` / `src/renderer/**` / `src/vm/operand.ts` / 影片解码器）、**② 等外部条件**（E4 采样 / 宿主子系统）、**③ 已判"永不"**（结构性不适用） |
| `T-0067` 存档页闪一帧 | doing | 阻塞：需要一次干净窗口/用户 trace（`shot` 与用户实例共用 log/overlay） |
| `T-0019` 拆 msgwin 两个大文件 | open | 分节边界见 `docs-new/04-app/emulator-refactor-plan.md` §1。★一次尝试已在半成品状态被停止并回滚（产出归档 `.tmp/t0019-split-wip/`），并因此新增两条硬要求（barrel 先补齐再搬、每次落盘先 typecheck）——见票内 notes；`T-0175` 的 ② 淡入色窗接线也交接给了它。★`T-0179` 里 msgwin 族的缺口必须与它**串行** |
| `T-0122` 内存快照/恢复 | ✅done | ★**第 70 轮 goal round 4–6 收口**：`src/vm/engineSnapshot.ts`（自描述 JSON + 版本头 + `SNAPSHOT_EXCLUDED` **9 条**带 `why` + `restore` 逐条告警）、**8 条 E2 守卫** + **1 条 E3 真语料守卫**（`test/engine-snapshot-e3.test.ts`）、**帧边界门**（超时响亮失败；红→绿 7/8→8/8）、`dbg.cjs save/load`。★E3 实测逼出一条真结论并按纪律登记：分叉面**只有"依赖场景动画态的派生量"**（不是漏字段）⇒ `SNAPSHOT_EXCLUDED` 第 9 条 + 两条重开条件。见 `tickets/T-0122/changes.md` |
| `T-0142` Electron 调试通道收敛 | ✅done | ★**第 71 轮收口（用户现场实测 + 目视）**：② `shot` 统一到 `FrameHost.capture`（B′，恒 1280×720；旧的整窗 `capturePage()` 降级为**显式** `screencap`）、③ 命令与管线**一一对应**（命名分裂消掉）、④ 端到端以用户真机实测为准（VM 通道回执 `已注入 3 个输入事件（cursor, press, release）` = 经 `applyScenarioEvent`；目视确认两条管线产物）、⑦ `clickimg` 口径改成**内容区 CSS 像素**（DOM 恒等 / VM 按 `getContentSize()` 折算）⇒ `capturePage()` 与点击坐标**解耦**、`imgToSendLive` 已删。★如实披露：④ 的「逐步截图 + `[main]` 日志逐条留档」与 ② 的「同帧 A/B」未单独产出，用户判定不必再补。另新增：守护进程**代码新鲜度**自述（`--ping`/`hello` 报启动时刻+磁盘 mtime；旧代码会被客户端点破）—— 起因是"改了 `tools/*.cjs` 却没重启"被误读成代码写错 |
| `T-0088` / `T-0118` / `T-0051` | open | 需外部条件：真人点选 AGERC / Intel Mac 跑 x86_64 slice / E4 真机核验 5 项 |
| `T-0103` | open | 章节切换演出不一致 —— ★用户明确"最后再处理" |

★**第 70 轮关掉的**：`T-0146`（3 条 `verify` 基线红）⇒ `npm run verify` 现 **exit 0**、基线红 **0** 条（见 §6）；
`T-0091`（转场渲染剩余四项）⇒ ② 判据 `transitionTargetKind` + 守卫落地（红→绿 7/8→8/8）、
④ 可达路径复现（读档 78 → 点 4 次 → `cat=0` 交叉淡化）并把 9 张截图归档 `tickets/T-0091/evidence/`、
①③⑤⑥ 复核确认已有实现。★如实披露：④ 那组截图是"路径可达"的**可视证据**，
**不是**像素级真机对照 ⇒ 能力条目 `clock-read-transition-window` 的 `evidence` 保持 **E3** 不变。

★**第 71 轮关掉的**：`T-0142`（Electron 调试通道收敛）—— 见上表；它的收口依据是**用户真机实测**
（VM 通道输入注入的回执证据）+ 用户目视两条截图管线的产物，而不是我跑出来的端到端脚本；
★因此它同时**如实披露**了两项未单独产出的取样（逐步截图 / 同帧 A/B），用户判定不必再补。
（本轮还顺带落地：`shot` → `FrameHost.capture`、`clickimg` → 内容区口径、守护进程代码新鲜度自述。）

## 5. 后续计划

1. **主序列**：P2 优先、逐票逐簇；一个文件同一时刻只归一个执行者（跨文件改动先串行化）。
2. **每单元交付定义**：命名守卫 + **红→绿证据**（先跑出红）+ 三层台账同步（引擎层 → `functions/fields/capabilities`；脚本层 → `scripts.json` → 生成物）+ 票据收尾三连（`build-tickets` / `--validate` / `ticket-ledger.test.ts`）。
3. **锚点是 ABI**：代码改名/搬家导致 `evidence.anchor` 消失 ⇒ 只改指不删，改完跑 `tickets.js --validate`。
4. **下一波候选**（按"文件是否空闲"挑，别一次占同一文件）：`T-0179` 剩余 **95 条**（**全部已带重开条件**；能继续减账的只剩
   **① 需跨文件** 与 **② 等外部条件** 两类 —— `0x1d1`×6 / `0x82`×4 / `0x192`×3 / `0x193`×3 / `0x1b2`×3 等大簇都已判 ② 且写明前置）、
   `T-0148` §5.2 的 `quote-gone` 半边 13 条、`T-0019`；`T-0146` 与 `T-0091` 均已关单。
5. **不进主序列**：`T-0067`/`T-0088`/`T-0118`/`T-0051`（外部条件）与 `T-0103`（用户点名最后做）。
6. **多 agent 并行的三条硬纪律（第 70 轮复用有效）**：① 子代理**默认只读**（结论回报告，台账由主 agent 单一写者串行落库）；
   ② **每个 opcode 只出一个 `ledger.js` op**（同一字段被两个 op 先后改时，第一个 op 的"回读预期"是整字段比对 ⇒ 会假红）；
   ③ 注释里**不要复述被判禁的字面串**（`doc-model.test.ts` 的 A4① 扫的是源文本，实测被自己的注释绊红过一次）。

## 6. 验证基线与"什么算绿"

```
判据（项目自带）:  cd app/amayui-emulator && npm run verify
                   = npm run typecheck && typecheck:test && test:all && check:dead-writes
实测（2026-09-25 **第 70 轮"清理剩余内容"收口**）: **npm run verify ⇒ exit 0**（`typecheck` / `typecheck:test` / `test:all` / `check:dead-writes` 全链通过）
★**基线红已清零**：原先常红 3 条（`engine-slot` / `save-slot` / `scene-report`）**已由 `T-0146` 按测试侧判据全部消除**
  —— 真槽改成「**按字节判作者**」（引擎槽逐个必须解出 + 本工程 `format=0` 槽按正向判据跳过 + 第三种作者一律失败）、
  `scene-report` 删掉 `drawable > placeholder` 这条**假不变量**换成 5 条更强判据（占位项必须是全 0 空项等）、
  `host-registry` 的 idle 用例 timeout 改为**常量派生**（消灭"整个用例被 node 掐断"这种不可诊断的失败形态）。
  ⇒ 判绿口径升级为 **`npm run verify` 必须 exit 0**（不再有"可忽略的基线红"）。
  ★★但注意 `&&` 链：一旦 `test:all` 非零，`check:dead-writes` 会被**跳过** —— 改动涉及字段读写时请**单独再跑一次**。
  ★★`test:all` 的**运行器需要能起子进程**（`node --test` 与 `tsx` 用**管道 stdio**）：**受限沙箱下会 EPERM**，
    表现为"整片用例 `status=null/-1`"的**伪红**（不是代码问题）⇒ 用 `danger-full-access` 跑，或改用逐文件 `stdio:'inherit'` 的等价口径。
     ★**环境/权限的完整清单与替代做法见 `AGENTS.md`**（沙箱挡管道的红名单 + "用 `scripts/ts-resolve-hook.mjs` + 纯 node 跑 TS，别默认上 tsx"）。
     本会话实测（2026-09-26）：`npx tsx …`（esbuild 服务）、`node --test …`（测试隔离子进程）、
     `plugins/amayui-emulator/smoke.mjs`（自持 pipe 起宿主）三者在 workspace-write 下都红；`tool-smoke.mjs` / `smoke-client.mjs` / `npx tsc` 绿。
其它判据: 四份台账 --validate（tickets / capabilities / scripts / opcode-gaps）
          五份生成物 --check（opcode-table / opcode-gaps / doc-index / status / tickets）
          死写 check:dead-writes（基线 11，只许收缩）
          工具守卫 test/agent-workflow.test.ts（三个台账 CLI + 新工具 ledger.js/gaps.js --recount/--stale/
          tickets.js --edit-plan/fix-evidence-lines.js + 三个 SKILL.md 共享协议节同源）
          + test/journal.test.ts（沿革结构与票号回链；`--root` 沙箱；`round` 三种形态 + 非法值必须响亮失败）
          + test/doc-model.test.ts 的 **A4①**（`03-engine/*.md` 与生成物里不得出现「订正/旧句/历史判据」
            —— ★**渲染字段（`note`/`missing[].what`）里的沿革必须落 `journal`**；实测被这条绊红过一次）
          ★`harness-convergence` 棘轮按**正则扫全文**（连注释也算）：测试里别出现 `function mk(`、
          `const mk = `、`function mkEngine(`、`function makeCtx(` 这四种写法（基线只许收缩，不许登记例外）
   ★capabilities 与 scripts 两个生成器**不支持 --check**（无参数即重生成、幂等）
   ★凡动了 docs-new/ 页面 ⇒ 补跑 node scripts/build-doc-index.mjs；凡台账计数变了 ⇒ 补跑 node scripts/build-status.mjs
备用入口（不依赖 node_modules/.bin）: node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
                                    node --import tsx test/run.ts all
```

## 7. 环境事实与操作要点（本机）

| 项 | 值 |
|---|---|
| 资源根 | `install/`（`emulator.config.json` 无 `resources.path` ⇒ 默认）；真机 base = `C:\Users\liaoh\AppData\Local\Eushully\天結いキャッスルマイスター\`（overlay 同名前缀 `.overlay\`） |
| 音频 | **默认静音**（`emulator.config.json` 的 `audio.enabled=false`；单次覆盖 `AMAYUI_AUDIO_ENABLED=1`） |
| 起调试实例（agent 自足、静音） | `cd app/amayui-emulator && AMAYUI_AUDIO_ENABLED=0 node --import tsx src/web/host.ts --instance <id> --port 0 --attach-headless --idle-sec 0`（也可用工具 `action=start`） |
| 查/跑/建**操作脚本（ops）** | 工具 `action=ops`（列用例/前置/判据/副作用/状态）、`action=op {name,args}`（执行 + 回日志尾部）、`action=op-create {name,purpose}`；真源 = `app/amayui-emulator/tools/ops/*.mjs` + 索引 `ops/README.md`，原语库 `tools/emu.mjs` |
| 驱动 | `POST http://127.0.0.1:3080/dsh-emulator/<id>/api/debug-query`，body `{"args":["frame"｜"capture"｜"click x y"｜"wheel 120"｜"key 13"｜"global <下标>"]}` |
| 验证过的坐标 | TITLE 的 Game Start `(1180,372)`；GAMESTART 的 ゲーム開始 `(811,605)`（虚拟 1280×720） |
| 键/滚轮行为 | 默认 `set:WheelKeyUp=3`（= ←）/ `WheelKeyDown=1`（= →）/ 横滚 −1；ADV 里**上滚 = 按一下 ← ⇒ 打开侧边栏**（引擎行为）；右键在侧栏已开且本帧注册过 `mouseJump` 时走取消路由 |
| Web 产物 | 改 `src/vm/**`、`src/renderer/**` 后必须 `npm run build:electron`（重建 `dist/web/renderer.js`）并**刷新页面**才生效 |
| 日志 / 临时产物 | `.tmp/amayui-emulator.log`、`.tmp/instances/<id>/…`；**`shot`/`record`/用户实例共用 log+overlay** ⇒ 同时只跑一个 |
| 工具链 | `node_modules/.bin` 已修复（2026-09-25）⇒ `npm run typecheck/typecheck:test/test/test:all/verify/check:dead-writes` 全可用 |
| 已知坑 | 渲染进程**没有** `process.env`（`renderer/**` 里读它会把窗口打白）；`tools/shot.cjs --load` 会回写槽、载入列表记住上次光标（用 `--row`）；**本资源树没有 `CALLBACK_TEXT.BIN`**（见 `docs-new/03-engine/input-system.md` 的 CALLBACK_TEXT 条）；`app/amayui-inspector/**` 读的是**真进程**的引擎地址，与 emulator 侧字段增删无关 ⇒ **不要跟着删** |
