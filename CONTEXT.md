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
  ★tickets.js --validate ✅ 177 张 / 0 条行号漂移警告（刷新工具 = .tmp/settle/fix-lines.mjs --any）
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
- **工具债（三处，下一波先补）**：① `ledger-set.mjs` 不能给**在册条目追加** `missing`（只能 `set.missing` 搬运，易漏抄）；
  ② 它够不到**顶层 `counts`**（需另写刷新脚本，已有 `.tmp/settle/apply-counts-68.mjs`）；③ 已 **3 次**出现"subagent 实现了却漏删对应 `missing`"
  （第 52/64/69 轮），主 agent 每次手工补删 ⇒ **应把"实现即删条目"写进派发模板的验收项**。

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
实测（2026-09-25 T-0179 第 69 轮，P 波 `0x100` 近似删除 + O 波记录驱动链 P2/P3 守卫与口径）: tests 1669 / pass 1664 / fail 3 / skipped 2  ⇒ exit 1
★3 条 fail 逐条都是既有基线（票 T-0146），不是新红：
   · engine-slot   ★E4：本机真槽全部解出…（SAVE70/71 storedDwords）
   · save-slot     E4：真存档槽的头 → 0x1A0 的六个 u16…（真槽 format 0 !== 3）
   · scene-report  场景执行报告：可绘制项(24) 必须多于缺纹理项(26)
⇒ 判绿 = "不新增红"；这 3 条不要去修（它们是历史数据/占位项口径，T-0146 已登记）
其它判据: 四份台账 --validate（tickets / capabilities / scripts / opcode-gaps）
          五份生成物 --check（opcode-table / opcode-gaps / doc-index / status / tickets）
          死写 check:dead-writes（基线 11，只许收缩）
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
| 已知坑 | 渲染进程**没有** `process.env`（`renderer/**` 里读它会把窗口打白）；`tools/shot.cjs --load` 会回写槽、载入列表记住上次光标（用 `--row`）；**本资源树没有 `CALLBACK_TEXT.BIN`**（见 §8.1）；`app/amayui-inspector/**` 读的是**真进程**的引擎地址，与 emulator 侧字段增删无关 ⇒ **不要跟着删** |

## 8. 可复用结论与坑（不在任何技能里的）

**引擎侧硬事实**
1. **`CALLBACK_TEXT.BIN` 这个名字**：引擎硬编码常量（raw 4344 的 `aCallbackTextBi`，`.lst` = `.data:0051F1F8`），5 处 `sub_411560(Engine, 该常量)`（raw 20044/20065/20351/28852/28905）。**本树没有该文件**：索引 **25080** 条（`SYS4INI.BIN` 21109 + 5 个扩展包 `APPEND0{1..5}.AAI` 3971）里 0 命中 ⇒ `sub_455000` 返回 −1 ⇒ `sub_40FC90` 体首早退 ⇒ 该跳是 **no-op（真机同）**。别再去资源里找它，也别为它建模 `sub_411590`（`0x100000` 自旋输入泵）。
2. **滚轮**：引擎**没有**「滚轮 ⇒ HISTORY」内链。`HISTORY.BIN` 全语料唯一入口 = **`call-script 31`**；ADV 用 `0x97` 把位号绑到离屏热点（`src/SN0000.txt:94-114`，位 8 → `label_00002f84` → `call-script 31`）。默认位号 3 ⇒ 上滚 = 派发 ← 键 = 打开侧边栏并把光标定位到第一个按钮。键命中（`sub_403D70`，调用点 raw 20242）**发生在回看块（raw 20341-20363）之前** ⇒ 即使把位号配成 8，"滚轮⇒回看游标"在产品路径上仍不可达。
3. **`0x1D1` 不是"回想页渲染器"**，而是 `0x82` 的**孪生**（「GDI 重画窗 op1 的第 op2 条 72B 文本项记录」；`sub_4675A0` raw 80524-80532 与 `sub_466000` raw 79319+ 逐句同形；语料唯一静态调用点 `src/HISTORY.txt:1314`，运行时会反复命中）。
4. **`jcc` 的签名**是 `jcc <cond> <真支> <假支>`，`-1` = 该支**落下句** ⇒ `src/TITLE.txt:527` 的 `jcc (global-int a9d0) ffffffff label_00002058` = **`a9d0 == 0`（默认）走 Live2D**、`!= 0` 走静态贴图回落。
5. **`sleep`(`0xC8`) 有两种语义**：`n >= 10` 进"帧节流计时器"支（`sub_4218D0` raw 30304）；`n < 10` 走 raw 30311 的 `Sleep(n)`（同一次派发内的进程级硬阻塞）。语料 385 处、其中 `n < 10` **50 处**。
6. **Live2D 装载的失败语义**（`sub_478640`/`sub_4A19F0`/`sub_4A1970`）：`0x34E` 在**实例槽里没有模型**时会抛（`sub_4A19F0` 原样返回 `sub_478640` 的结果）；`0x345` **只在"文件取不到"时抛**（`sub_4A1970` 把 `sub_478370` 的返回值丢了）⇒ 同族四条里只有它这么窄。**单脚本跑 TITLE 必须先补 `SETL2DMOC` 的前置**（`i341 4f9e 0` + 三条 `i345`，即位 `src/TITLE.txt:533-554` 的效果）。
7. **`0x5D888`/`0x5D88C`** 是**派发现场保存格**（`sub_40FB60` 存 raw 18978/18982、`sub_41A820` 的 `caller == -10` 分支读回 raw 25663-25666），**不是**"控制流目标深度寄存器"；emulator 用 `Engine.dispatchSavedCur/dispatchSavedFlags` 建模。
8. **`Engine[92340]` ≡ `Scene+46528`**（Scene = Engine+322832）：0x24E 写整格（raw 32965），另有整格清零 raw 12782 / 130430；bit0 = 主循环 `0x400` 放行块的附加条件（语料 `i24e 10001` **413/422** ⇒ 近全部语料被挡）、bit1 = 单帧推进复位块旁路、bit2 = `+720 bit0` 豁免判据、bit16 = `sub_407E20` 门。**两个位互为反相，引用时必须一起引**。
9. **`Engine[51848]`** = **虚拟显示器 A 的鼠标游标**（`Engine+21976+4*7468`，界 = `_this[23008]`），不是"选择/列表框游标"。
10. **反编译器每个函数前有一行原型声明**（如 raw 410 的 `sub_41A0E0` 原型 vs raw 25215 的定义）⇒ 用 `indexOf('void __thiscall sub_X')` 切函数体会切到"从原型到文件尾"；请按 `//----- (地址) -----` 头切。★同类陷阱：**面板对象（`Engine+5494`）的方法收的是「面板指针」、体内一律用字节偏移** —— `*(_DWORD *)(_this + 29856) = 1` 就是 `Engine[12958]`（`5494 + 29856/4`）；按 `_this[12958]` 直查会误判「没有任何写点」（`sub_404020` raw 10016-10028 是反例）。

**工程侧坑**
11. **新建测试文件首行必须是分类头** `/** @tier T? @kind ? @subsystem ? */`，且**档位要与机械可见的资产依赖一致**（声明 `T1` 就必须 import `NodeFileSource`/`resolveResourceDir` 一类，否则 R2 判红；本会话踩过三次）。`@kind` 的合法值只有 **core / ratchet / tool** —— 写成别的（如 `regression`）会让 pragma 解析成 `null`，`test/run.ts` 直接抛 `TypeError: Cannot read properties of null (reading 'tier')`，**整档测试都跑不了**。**不许**新建自造 `mk()`/`mkEngine()`/`makeCtx()` 变体（用 `test/harness.ts` 的工厂），**不许**改 `test/harness-convergence.baseline.json`（只许收缩）。
12. **大文件拆分/重构的操作纪律**（`T-0019` 一次失败尝试换来的）：① 先把**原文件留 barrel** 并把 re-export 补齐，再搬实现，**每次落盘立刻 `npm run typecheck`**（不要把树留在坏态 —— 半成品的语法错会让**所有** `node --import tsx` 停摆，阻塞同波所有单元）；② 被切开的 JSDoc 块要在两端各自补回 `/**` 与 `*/`（本次真实发生：同一段注释被切在 `handlers/` 与 `vm/` 两个文件里）；③ 声明归属按 barrel 的 import 走（本次 `defaultWinGeom` 被留在错的文件里）。
13. **esbuild（tsx 的转译器）不接受 JSDoc 里相邻的加粗数字**：`raw **18978**/**18982**` 报 `Unexpected "**"` 且行列号指向**下一行**（极易误判成代码错）⇒ 相邻强调之间留空格。
14. **写台账文本别用 ASCII 双引号**（用「」）—— JSON 串会被提前闭合；`ledger-set.mjs` 的"写盘前 `JSON.parse`"能拦住，但白跑一趟。
15. **文件行尾**：一律 LF；**绝不**用 `Set-Content`/`Out-File` 写源文件。台账写盘只用 `.tmp/settle/ledger-set.mjs`（两阶段、`match` 恰好命中 1 条、`add` 不幂等 ⇒ 计划只能应用一次）；`analysis/scripts.json` 用技能里的 `scripts.js`。
16. **改台账必须按条目边界定位**（先按 `opcode`/`id`/`addr`/`offset` 精确 `match`），**永远不要用"下一条匹配"**（本会话误翻过处置位）。
17. 可复用工具（`.tmp/settle/`）：`ledger-set.mjs`（按键路径改写 + `mutate` 按 `raw` 删改 `missing[]` + `appendEntries`）、`apply.mjs`（整串替换）、`fix-lines.mjs --any`（刷票据 `evidence.line`）、`close-wave.mjs`（自检式收票）、`check-fields-order.mjs`（fields 按 scope 组内升序）、`tickets-edit.mjs`（免 shell 转义调用 `tickets.js --edit --set-json`）。
18. ★★**裁决 `missing[]`（`T-0179` 的 141 条）必用"三态过滤"**（第 52–54 轮踩出来的，三次都命中不同态）：
   ① **可补的真缺口** —— 引擎那条分支的处理对象在 emulator 里**存在**（字段/表/宿主缝/发布载荷），只差接线；
   ② **结构性不适用** —— 处理对象根本不存在（72B 文本记录向量、GDI 离屏表面、D3D 设备状态/重建、平坦地址）⇒ 把 `what` 重写成「为什么 + 重开条件」，**不要假实现**（例：`0x82` 的 `op3 & 1` 记录级过滤 —— 实测 `src/renderer/**` 对 `textItems` 0 引用）；
   ③ **早已补上但没回台** —— `what` 自述「已实现/已删/现按…」⇒ 复核代码/守卫后**删条目**（第 52/53 轮删掉 `0x147`/`0x060`/`0x142`/`0x82` 共 4 条）。
   ★补充判据：**若"补上"在当前语料/状态机下不产生任何可观测差异**（写的是恒 0 的格、或没有读者的写 ⇒ 死写闸门会亮），
   那它属于②而不是①。实例：`0x071` 的 `Engine[122496] = 0` 三出口 —— 该格在 emulator 里是 `MsgWinState.alt`
   （读者 `src/vm/msgwin.ts:781`、清零点 `:679/:884/:894`），但**从来没有被置 1 的写点** ⇒ 在 `0x71` 里补三次清零
   今天不产生任何行为差异（属"登记性缺口"，等真正会置 1 的那条路径建模后一并接）。
