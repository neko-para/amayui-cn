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
| 起/驱动调试实例（agent 自足） | 技能 **`amayui-remote-debug`**（`--attach-headless` + `debug-query` 的 move/click/wheel/key/capture/frame/global） |
| 文档模型（真源/生成物/沿革） | `docs-new/00-overview/authority.md` 附录 **A1–A6** |
| 证据等级 **E0–E4** | `docs-new/03-engine/engine-capabilities.md` 头部 + 台账 schema 的 `evidenceEnum` |
| 审计的原始结论 | `docs-new/99-records/2026-09-impl-audit/impl-audit-2026-09.md`（人读）+ `.../raw/impl-audit-findings.json`（机器可读 383 条） |
| 其它技能 | `amayui-mnemonic-rename` / `amayui-ui-text-render` / `amayui-script-translate` / `amayui-script-update` / `batch-task-runner` |

**长期用户要求（仍未撤销）**：**不要 `git add` 任何东西**（本会话同样全程未 `git add`）。

## 2. 工程一句话现状

TypeScript 重写的 AGE 引擎 + 引擎逆向工程（真源 = `engine/天结_unpacked.exe_utf8.c`，只读；「raw NNNNN」= 该文件行号）。
当前阶段：**审计遗留收尾**（2026-09 审计覆盖 364/364 opcode + 54/54 能力条目，产出 383 条 finding）。
判绿口径 = §6；未完成票 = §4；引擎侧硬结论 = §8。

## 3. 台账现状（快照 · 2026-09-25 F 波收口后实测）

```
票据 177 张：✅done 163  ⬜open 9  🔜doing 3  🚫dropped 2  ⛔blocked 0
  优先级 P0 8 / P1 68 / P2 63 / P3 38
  ★tickets.js --validate ✅ 177 张 / 0 条行号漂移警告（刷新工具 = `.agents/skills/amayui-ticket-ledger/scripts/fix-evidence-lines.js --any --write`；
  ★**全库 1003 条被锚证据已补全**：漂移 0 / 失效锚点 0 / 缺 `line` 0 —— 补了 39 条（26 张票；
  29 条唯一命中自动补 + 10 条**多命中**由 `--pick` 显式指定，含审计报告 §4.1 / §4.6 两份同句的指称区分），
  且逐票复核"除 `evidence[].line` 外语义差异 = 0 处"）
能力台账 144 条：已核验 79 / 已建模未核验 5 / 部分 30 / 缺失 6 / n/a 24
缺口台账 182 条：partial 80（**104 条 missing[]，承接票统一 = `T-0179`**）/ implemented 66 / deferred 22 / 有据 no-op 9 / unimplemented 5 / unjustified 0
第一层：functions.json 620 条 / fields.json 393 条（fields 按 scope 分组、组内 offset 升序）
脚本台账 37 条：已分析 10 / 部分 25 / 仅登记 2（src 分母 941）
死写基线 11 条（check:dead-writes 只许收缩；棘轮基线 test/harness-convergence.baseline.json 亦只许收缩）
六份真源的 evidence.line 漂移 = 0
```

★`partial` 是一等处置位（`missing[{what,ticket,raw}]`，`raw` 只能单段）；缺口数**上升是好消息** —— 它把原先藏在
`implemented`/`deferred` 里的"其实还缺东西"如实拆出来并挂票号。`unimplemented`（现 5 条）= 语料 0 处、命中即硬报错。
★**本节全部数字已于第 57 轮与六份真源机械核对（逐项一致）**：票数/状态由 `tickets/*/ticket.json` 现数、能力处置由
`analysis/engine-capabilities.json` 现数、缺口与 `missing` 由 `analysis/opcode-gaps.json` 现数、第一层两条直接取数组长度、
脚本台账取 `analysis/scripts.json` 长度、死写取 `app/amayui-emulator/dead-writes.baseline.json` 的 `known` 条数。

### 3.1 收尾任务的真实剩余面（第 69 轮，用户要求暂停时的快照）

- **可关单池只剩一个**：`T-0179` 的 **104 条 `missing`（80 个 opcode）**。其中"便宜的两类"已扫光 ——
  ③「早已修好没回台」的陈旧条目基本清完；剩下绝大多数是 **② 结构性不适用**（写判词 + 重开条件即交付）或 **① 需跨文件**
  （`src/vm/native.ts` / `src/renderer/**` / `src/vm/operand.ts` / 影片解码器）。
- **最大残留簇**：`0x1d1`×6、`0x82`×4、`0x192`×3、`0x193`×3、`0x1b2`×3。
- **单点最大杠杆已做完**：记录驱动链 P1a–P1c（已落地）+ **P2/P3 守卫与口径**（第 69 轮 O 波）；**P4 判②不接线**
  （唯一语料点 `CONFIG.BIN` 第 205 条执行时 `records=0`、目标窗 `segments=[]` ⇒ 零可观测差异；两条分叉已写成反向守卫）。
- **非 `T-0179` 的尾巴（小体量）**：`T-0148`（§5.2 剩余面）、`T-0091`（转场渲染 `[4]` 槽 + E4 路径）、`T-0019`（msgwin 拆分，与 `T-0179` 串行）、
  `T-0122`/`T-0142`（工具）、`T-0146`（3 条基线红的登记票）；主序列外：`T-0051`/`T-0067`/`T-0088`/`T-0118`（外部条件）与 `T-0103`（用户点名最后做）。
- **粗估**：按每波 2 个 subagent、每波关 5–15 条的经验，**再 6–10 波（≈5–8 轮）**可把"能做的"做完；其余长尾会以 ② 判词 + 重开条件形式长期挂着。
- **工具债（2026-09-25 工具评估轮已清，见 §7.17）**：原三处 ① `ledger-set.mjs` 不能给**在册条目追加** `missing`；
  ② 够不到**顶层 `counts`**（靠一次性的 `.tmp/settle/apply-counts-68.mjs` 手写第二份口径）；③ 已 **3 次**出现
  "subagent 实现了却漏删对应 `missing`"（第 52/64/69 轮）⇒ 现状：① 由 **`ledger.js`** 的 `add`（数组即 append）
  + `mutate.deleteRaw/rewriteRaw` 覆盖；② 由 **`gaps.js --recount`** 覆盖（**直接调用** `build-opcode-gaps.mjs`
  的 `tallyDispositions`，口径唯一，不再有第二份算法）；③ 已写进三个技能的 IMPLEMENTATION 派发模板验收项，
  并配 **`gaps.js --stale`** 机械兜底（把 `what` 自述「已实现/不适用」的 `missing[]` 列出来）。
  ★**残余的只有"人的自觉"那一半**：`--stale` 是**候选清单**（沿革话术如「已由第 N 轮…」也会命中），
  裁决仍要按三态过滤逐条做。
- **本轮新增/变更的工具**（全部在 `.agents/skills/*/scripts/`，带 `agent-workflow.test.ts` 守卫）：
  `ledger.js`（新：条目级手术 + 默认 dry-run + 写盘后回读复核）、`gaps.js`（加 `--missing/--stale/--recount/--root`）、
  `tickets.js`（加 `--edit-plan` 两阶段批量改单 + `done` 写盘前前置校验）、
  `fix-evidence-lines.js`（新：从 `.tmp/settle/fix-lines.mjs` 提升）、`report.js`（加 `--check-fields-order`）。
- **顺带修掉两处"没人守"的漂移**（`journal` 与 `fields` 排序）：
  `report.js --check-fields-order` 补上 fields 排序不变式（原先只有 `.tmp/settle/check-fields-order.mjs` 这个孤儿脚本）；
  沿革侧：`journal.js` 的 `--validate` **实测 exit 1**（两条真实条目用了未登记的 `kind: impl-status`，`round` 写成标签字符串
  —— 而它的文件头一直声称"守卫 `test/journal.test.ts` 走同一套规则"，**那个文件当时不存在**）；
  `status.md` 的"轮次"行因此渲染成乱序（`a - b` 对字符串是 NaN）。现修：`journal.js` 放宽 `round` 为「整数｜标签｜null」、
  补 `impl-status`，`build-status.mjs` 把编号与标签**分组**渲染，并新增真守卫 `app/amayui-emulator/test/journal.test.ts`。

## 4. 未完成票据（12 张 = doing 3 + open 9）

| 票 | 状态 | 现状 |
|---|---|---|
| `T-0148` 全指令核对主票 | doing | 剩余面已收敛成**三张可枚举清单**（全在 `tickets/T-0148/changes-coverage.md`）：① §3/§8 = 80 个"审计点名但不在缺口台账"的 opcode **已机械化裁决完毕**（76/76 都在运行时表里 ⇒ 不是能力缺失；0 个 `unregistered`），其中 **58** 个带实质性 finding、**21** 个零痕迹项由 §8.2/§8.3 **已全部收口**（implemented 12 / partial+missing 6 / deferred+why 3 ⇒ 真正缺的只有第 49 轮已实现的 `0xa3` 派发目标）；② §4/§5 = 36 条分诊表与机械化复核（8 条 `stale-ledger` 已全解决；**23 条 `still-present`** 里 §5.3 已裁决 3 条 —— `0x108` 保留补丁落 `partial`、`0x223` 由 `implemented` 改判 `partial`、`0x25a` 早已登记 ⇒ **剩 20 条**）；③ §6 = `missing` 的 live 承接票缺口（已由 `T-0179` 承接）+ §7 已裁决清单 |
| `T-0179` 缺口台账 `missing` 的承接与逐条裁决（开场 140 → 现 104） | open | ★**2026-09-25 新开**：实测 **140/140** 条 `missing[].ticket` 原先全部指向已 `done` 的票 ⇒ 登记账没有 live owner。开场已把 84 条 `partial` 的 `missing[].ticket` 批量改指本票（原票号进 `journal[]`，对照表见 `changes-t0179.md` §3）。**逐条裁决**（实现 / 关掉 / 保留并写重开条件）：已裁决批次 = `0xa0`、`0x8c`+`0x8f`、`0x245`+`0x246`、§8.3 两批共 15 条（第 49/50 轮）；族序 = vm 操作数-IO → renderer → msgwin（与 `T-0019` 串行） |
| `T-0091` 转场渲染剩 4 项 | doing | 只剩 `[4]` 非 create-texture 槽 + E4 可达路径 |
| `T-0067` 存档页闪一帧 | doing | 阻塞：需要一次干净窗口/用户 trace（`shot` 与用户实例共用 log/overlay） |
| `T-0019` 拆 msgwin 两个大文件 | open | 分节边界见 `docs-new/04-app/emulator-refactor-plan.md` §1。★一次尝试已在半成品状态被停止并回滚（产出归档 `.tmp/t0019-split-wip/`），并因此新增两条硬要求（barrel 先补齐再搬、每次落盘先 typecheck）——见票内 notes；`T-0175` 的 ② 淡入色窗接线也交接给了它。★`T-0179` 里 msgwin 族的缺口必须与它**串行** |
| `T-0122` / `T-0142` | open | 工具类：内存快照/恢复；Electron 调试通道收敛（后者与用户实例冲突） |
| `T-0088` / `T-0118` / `T-0051` | open | 需外部条件：真人点选 AGERC / Intel Mac 跑 x86_64 slice / E4 真机核验 5 项 |
| `T-0103` | open | 章节切换演出不一致 —— ★用户明确"最后再处理" |
| `T-0146` | open | 它就是 3 条基线红本身的登记票（见 §6），**不得重复立项** |

## 5. 后续计划

1. **主序列**：P2 优先、逐票逐簇；一个文件同一时刻只归一个执行者（跨文件改动先串行化）。
2. **每单元交付定义**：命名守卫 + **红→绿证据**（先跑出红）+ 三层台账同步（引擎层 → `functions/fields/capabilities`；脚本层 → `scripts.json` → 生成物）+ 票据收尾三连（`build-tickets` / `--validate` / `ticket-ledger.test.ts`）。
3. **锚点是 ABI**：代码改名/搬家导致 `evidence.anchor` 消失 ⇒ 只改指不删，改完跑 `tickets.js --validate`。
4. **下一波候选**（按"文件是否空闲"挑，别一次占同一文件）：`T-0179` 的 143 条 `missing` 逐条裁决（**当前最大的可关单池**；第 52 轮已证明其中有一批是「`what` 自述已实现」的陈旧条目，先清理再实现）、`T-0148` 的 80-opcode 裁决批、`T-0148` §5 的 20 条 `still-present`（§5.3 已裁 3 条）、`T-0019`、`T-0091`。
5. **不进主序列**：`T-0067`/`T-0088`/`T-0118`/`T-0051`（外部条件）与 `T-0103`（用户点名最后做）。

## 6. 验证基线与"什么算绿"

```
判据（项目自带）:  cd app/amayui-emulator && npm run verify
                   = npm run typecheck && typecheck:test && test:all && check:dead-writes
实测（2026-09-25 **工具评估轮** + **票据证据行号补全轮**：新增 `ledger.js` / `fix-evidence-lines.js` / `journal.test.ts`
      + `gaps.js`/`tickets.js`/`report.js`/`journal.js`/`build-status.mjs` 扩能与修补 + 6 条工具守卫）: tests 1678 / pass 1673 / fail 3 / skipped 2  ⇒ exit 1
  （同一轮里 typecheck / typecheck:test 均 exit 0；五份生成物 `--check` 全绿；`check:dead-writes`「★ 无新增死写」；
    四份台账 `--validate` 全绿；★因为 `test:all` 有 3 条基线红，`&&` 链会**跳过** `check:dead-writes` ⇒ 要单独跑一次）
★3 条 fail 逐条都是既有基线（票 T-0146），不是新红：
   · engine-slot   ★E4：本机真槽全部解出…（SAVE70/71 storedDwords）
   · save-slot     E4：真存档槽的头 → 0x1A0 的六个 u16…（真槽 format 0 !== 3）
   · scene-report  场景执行报告：可绘制项(24) 必须多于缺纹理项(26)
⇒ 判绿 = "不新增红"；这 3 条不要去修（它们是历史数据/占位项口径，T-0146 已登记）
其它判据: 四份台账 --validate（tickets / capabilities / scripts / opcode-gaps）
          五份生成物 --check（opcode-table / opcode-gaps / doc-index / status / tickets）
          死写 check:dead-writes（基线 11，只许收缩）
          工具守卫 test/agent-workflow.test.ts（三个台账 CLI + 新工具 ledger.js/gaps.js --recount/--stale/
          tickets.js --edit-plan/fix-evidence-lines.js + 三个 SKILL.md 共享协议节同源）
          + test/journal.test.ts（沿革结构与票号回链；`--root` 沙箱；`round` 三种形态 + 非法值必须响亮失败）
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
| 起调试实例（agent 自足、静音） | `cd app/amayui-emulator && AMAYUI_AUDIO_ENABLED=0 node --import tsx src/web/host.ts --instance <id> --port 0 --attach-headless --idle-sec 0` |
| 驱动 | `POST http://127.0.0.1:3080/dsh-emulator/<id>/api/debug-query`，body `{"args":["frame"｜"capture"｜"click x y"｜"wheel 120"｜"key 13"｜"global <下标>"]}` |
| 验证过的坐标 | TITLE 的 Game Start `(1180,372)`；GAMESTART 的 ゲーム開始 `(811,605)`（虚拟 1280×720） |
| 键/滚轮行为 | 默认 `set:WheelKeyUp=3`（= ←）/ `WheelKeyDown=1`（= →）/ 横滚 −1；ADV 里**上滚 = 按一下 ← ⇒ 打开侧边栏**（引擎行为）；右键在侧栏已开且本帧注册过 `mouseJump` 时走取消路由 |
| Web 产物 | 改 `src/vm/**`、`src/renderer/**` 后必须 `npm run build:electron`（重建 `dist/web/renderer.js`）并**刷新页面**才生效 |
| 日志 / 临时产物 | `.tmp/amayui-emulator.log`、`.tmp/instances/<id>/…`；**`shot`/`record`/用户实例共用 log+overlay** ⇒ 同时只跑一个 |
| 工具链 | `node_modules/.bin` 已修复（2026-09-25）⇒ `npm run typecheck/typecheck:test/test/test:all/verify/check:dead-writes` 全可用 |
| 已知坑 | 渲染进程**没有** `process.env`（`renderer/**` 里读它会把窗口打白）；`tools/shot.cjs --load` 会回写槽、载入列表记住上次光标（用 `--row`）；**本资源树没有 `CALLBACK_TEXT.BIN`**（见 `docs-new/03-engine/input-system.md` 的 CALLBACK_TEXT 条）；`app/amayui-inspector/**` 读的是**真进程**的引擎地址，与 emulator 侧字段增删无关 ⇒ **不要跟着删** |
