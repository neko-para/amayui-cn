# G7 组测试审计（音频 / 台账棘轮 / 文档模型 / 工具路径 / 调试器自测）

- 审计范围：`app/amayui-emulator/test/` 下 17 个文件，**57 个用例**（`debug-*` 三个文件共 **24** 例，任务里写的 23 与实际差 1）。
- 审计方式：**只读**静态逐条读断言体 + 数据层/真源交叉核对 + 少量离线计算（esbuild 转译、文件存在性、计数）。
- **没有**跑 `npm test` / `npm run verify` / `npm run shot`（纪律要求）⇒ 报告中"会不会红"的结论，凡未标注"实测"的，都是**静态推断 + 反例实验设计**，不是运行结果。
- 纪律遵守：仅写本文件；未改 `analysis/`、`tickets/`、`docs-new/`、`app/`、`src/`、`scripts/`。

---

## 0. 结论摘要

1. **本组 17 个文件没有一条是"纯无意义"的整文件**，但**有 6 条具体断言是无意义/近恒真的**，另有 **9 条是"意图正确、手段失效"**（守卫自认为钉住了漂移，实际钉不住）。最典型的两类：
   - **同义反复**：`music-table.test.ts:120`（对字面量做掩码运算）、`script-ledger.test.ts:236-238`（用 `entries` 构造的量去和 `entries` 比）。
   - **镜像实现/自我报告**：`audio-engine.test.ts:397-398`（断言实现自己的 cache 命中计数器）、`tool-paths.test.ts:110-113`（断言工具源码里的**一句帮助文案**）。
2. **★最重要的发现：T-0114 的教训在同一个文件里以新形式复发。** `debug-break.test.ts:186-200` 声称"面板不得再硬编码事件类型清单"，但它只查**带引号**的字面量；而活着的漂移恰恰是**不带引号**的：`control/control.ts:246-247` 的**用户可见帮助**至今写着 `global-write`（一个**非法**类型，`EVENT_KINDS` 里根本没有），且缺 `global-float-write` / `global-str-write`。守卫现在是绿的。
3. **`parseDebugCommand` 是零生产调用者的死代码**（全仓只有 `test/debug-break.test.ts` 在调；`src/renderer/app/session.ts:448` 直接用 `compileBreak`）。命令表被**手工复制了三份**：`src/vm/debugBreak.ts:514`（被测试）、`control/control.ts:266-298`（活、无测试）、`tools/debugsrv.cjs:262-300`（活、无测试）。⇒ `debug-break.test.ts:143-184` 的 10 个断言守的是**不发货的那份**。这正是 `test/harness.ts` 头部注释里记过的反模式（引擎为"只有测试走"的路径保留 API），也是 T-0114 `changes.md` 那条教训的下一形态：**上次复制的是"合法值清单"，这次复制的是"整张命令表"**。
4. **音频组的 30 个用例不是"测脚手"**（`FakeAudioHost` 是记录型 double，断言对象是 `AudioEngine` 的语义，期望值多为手算，另有 `docs-new/03-engine/sound-system.md` 的 raw 行号作依据）——**唯一的"脚手"在 `audio-node-host.test.ts:213-217`**：它**自建** `FrameHost`，把 `headlessFrameHost.ts:28` 那一跳抄了一遍，并加了一个生产 headless **根本不存在**的 `yield`（`src/frame/host.ts:25` 明说 headless「立即 resolve（或不实现）」）。删掉 `headlessFrameHost.ts:28` 全绿。
5. **三处台账守卫的"guard 存在性"检查是空心的**：`capability-ledger.test.ts:76-92` / `script-ledger.test.ts:158-181` / `ticket-ledger.test.ts:111-124` 只查**文件是否存在**。实测 `analysis/engine-capabilities.json` 139 条里 92 条有 guard，只落在 **54** 个不同文件上，其中 `test/adv-msgwin.test.ts` 一个文件给 **11 条**能力条目当守卫。把全部 guard 指向 `test/harness.ts` ⇒ 三处全绿。
6. **好消息（应当保留的强项）**：`script-ledger.test.ts:128-156` 的锚点棘轮（33 条 × 行区间内必须出现 anchor）、`ticket-ledger.test.ts:126-140` 的证据锚点棘轮（121 张票 / **785** 个 anchor 全部逐字校验）、`doc-model.test.ts:126-138`（生成物 == 生成器输出）、`debug-query.test.ts:105-134`（只读快照含门计时器）—— 这四条是"实现改坏必红且红的理由正确"的样板。

---

## 1. 逐文件表（17 行）

| # | 文件 | 例数 | 类别 | oracle | 强度 | cost（真语料/skip/慢） | Verdict | 一句话理由 + 证据 |
|---|---|---|---|---|---|---|---|---|
| 1 | `audio-bgm-naming.test.ts` | 4 | core | 独立（真资源 + `src/MUINIT.txt`） | 强（3/4）；首条镜像（弱） | 真资源（只读文件+索引）；快 | **keep** | `:39-51` 用真文件把"曲号 31 → `BGM031.OGG`、而统一 id 31 → `BGM041.OGG`"钉死（`assert.equal(wrong?.name,'BGM041.OGG')`）——这是真值来源，任何"按 id 解释曲号"的回归必红；`:32-37` 的 `bgmFileName(3)==='BGM003.OGG'` 是镜像实现格式串，单独价值低。 |
| 2 | `audio-engine.test.ts` | 30 | core | 独立（手算算术 + raw 行号）/部分自造（延迟起算口径） | 强（约 24 例）；弱 2 例（`:401-410`、`:397-398`） | 无真语料（FakeAudioHost）；快 | **keep + upgrade** | `:279-305` 的"流式 `setPaused` vs 缓冲 `offsetSec=12.5` 续播"、`:365-377` 的"主×总线=0.25"都是独立判据；`test('缓存超预算会淘汰（LRU…）')` 标题承诺 LRU，断言只查 `bytes<=3000+4096` 与 `clips<4`（`:408-409`）⇒ 见 §3-1。 |
| 3 | `audio-node-host.test.ts` | 10 | core（3 条）+ scaffold（帧泵 2 条） | 独立（1 节容器头手算）/自造（3 节的 FrameHost） | 中强 | 无真语料；快 | **upgrade** | `:95-111` 的 WAV/OGG 时长是从容器规范手算的独立判据（0.5s / 3s）；但 `:206-262` 的两条"★帧泵"用的是**测试自建** `FrameHost`（`:213-217`），复制了 `src/renderer/headlessFrameHost.ts:28` 的一跳并加了一个生产没有的 `yield` ⇒ 生产接线零覆盖。 |
| 4 | `audio-opcodes.test.ts` | 11 | core | 独立（操作数顺序/含义对齐 `sound-system.md` §7 raw 行号 + 手算） | 强 | 无真语料；快 | **keep** | `:111-151` 的 `Music[259]`/`[260]`/`[261]` 三槽（`i0b7 0` 重播当前曲、`0xc3` 只登记、`0xc1` 翻转而不是置位）是最易错也最值钱的一批；`:298-307` 的注册表棘轮与其他 37 个测试文件同形（见 §4）。噪音：`:153-155` 的 `mini()` 与 `mk()` 完全相同。 |
| 5 | `audio-silent-option.test.ts` | 7 | tool + core | 独立（手算布尔映射/优先级） | 强（⑤⑥）；`:83-91` 弱 | 真资源无；快 | **keep** | `:133-175` 用"`createContext` 一被调用就 throw"证明静音**真的**不建 `AudioContext`（`ctxMade===0`），`:177-197` 是它的反面（非静音会建、切静音会 `close`）——正反两面都有，设计好；`:199-204` 把"测试默认静音"从口头约定变成可执行棘轮。 |
| 6 | `music-table.test.ts` | 10 | core | 独立（手算下标/返回值 + 真 `SYS4INI.BIN`，部分同源） | 强 | 真语料 `install/SYS4INI.BIN`（存在，`:160` 的 `{skip:!hasCorpus}` 实际不跳）；快 | **keep** | `:123-133` 的"组内 >1 ⇒ 从下标 1 起填空槽"与 `:145-158` 的 `groups[(id>>24)−1][id & 0xFFFFFF]`（下标直接取、不再 −1）是两条真判断；`:120` 是纯字面量运算的同义反复（见 §3-2）。 |
| 7 | `gallery-bgm-list.test.ts` | 9 | core（含 E3/E4） | 独立（真语料 + 真机存档） | 强（E3 `:223-279`）/弱（E4 `:190-215`） | **真语料 2×200k 步（本组最慢）+ 真机存档**；`t.skip` 无，改成静默 `return` | **upgrade** | `:274-277` 把 `SETMEMOIR` 的解锁表/收集率钉到具体槽（36 / ≥1 / `122731+1==2` / `12272e==2`）——"修好前恒 0 ⇒ 列表空白"的强回归锁；但 `:193-196` 在**本机**（base 目录不存在，实测只有 `.overlay`）直接 `return`，强断言全不跑。 |
| 8 | `doc-model.test.ts` | 8 | ratchet | 独立（真源数据 + 生成器） | 强 | 103 份 md + journal 全读；中等 | **keep-ratchet** | `:126-138` 用**生成器本人**（`renderIndex` / `renderOpcodeTable`）当判据算期望再与磁盘 md 比 ⇒ "忘跑生成器"必红；`:49/:71/:88/:114` 的样本量下限（`>=90/>=30/>=10/>=20`）防"扫描返回空⇒全绿"的真空，是正确写法。 |
| 9 | `audit-report-completeness.test.ts` | 3 | ratchet（文档/流程） | 独立（文件内容） | **弱** | 只读 4 个 md + 3 个 json；快 | **keep-ratchet（建议 upgrade）** | 断言是**关键词在场**（`'方法'/'覆盖'/'统计'/'误报'`，`:32-49`）与**硬编码常量**（`:67-71` 的 `opcodes:[95,9,0]…`）⇒ 它**不读报告里的数字**，文件头声称的"计数与报告一致"（`:12`）**并未被实现**；`:55` 钉死散文 `'执行状态见 §6'`，与 `:11` 自称"不钉措辞"直接矛盾。 |
| 10 | `tool-paths.test.ts` | 7 | tool | 独立（手算路径 + 真源码） | 中（①-④强，④有漏洞，⑤弱） | 只读文本；快 | **keep + upgrade** | `:44-89` 的"仓库根基准 / 越界抛 `ToolPathError` / 命中规则要报告"是票面事故（EPERM 弹窗）的真回归锁；`:115-120` 的 `isInside` 边界（前缀相似不是子目录）是好断言；`:110-113` 与 `:98` 是两处手段问题（见 §3-5、§3-6）。 |
| 11 | `debug-break.test.ts` | 11 | core（纯函数）+ ratchet（源码文本） | 独立（文档化语法/口径手算） | 强（`:41-141`、`:202-219`）；**失效**（`:143-200`） | 无真语料；快 | **upgrade** | `:202-219` 是 T-0114 第 8 次变更的真缺陷守卫（校验下沉到面板/CLI 共同收口点 `compileBreak`），强；但 `:143-184` 测**零调用者**的 `parseDebugCommand`，`:186-200` 的"不得硬编码事件类型"用了查带引号字面量的手段 ⇒ 见 §5。 |
| 12 | `debug-event-break.test.ts` | 6 | core（VM 写路径）+ ratchet | 独立（池路由/位模式手算） | 强（`:38-103`）；中（`:105-115`） | 无真语料；快 | **keep** | `:59-63` 断言 float 事件的 `val` = `1069547520`（1.5 的**位模式**，不是被 `|0` 截断的 1）——这是"用错口径就静默失配"的经典坑，值钱；`:77-95` 覆盖 `0x1F9` 与 `0x249` **两条**绑定路径。源码棘轮只钉文本形状，且**漏了 step 断点的 `onBeforeStep` 接线**（§5）。 |
| 13 | `debug-query.test.ts` | 7 | core | 独立（手算 `enc/dec` + 状态快照） | **强** | 无真语料；快 | **keep** | `:112-133` 的快照把 `gateWaitStart`/`gateWaitMs`/`engineValues` 全纳入并**突变证明**（`:127` 先造"计时器在途"），这是"只读"这件事唯一可靠的判据（`gatePending()` 会写状态，首版守卫漏过）；`:30-37` 的"解码值 6 vs raw 0x18000"锁住 T-0102 真踩过的坑。 |
| 14 | `capability-gap.test.ts` | 6 | core | 独立（`significantOperands` 口径文档化 + 手算） | 中 | 无真语料；快 | **keep + upgrade** | 名字叫 "capability-gap"，但**与 `capability-ledger.test.ts` 零重叠**——它测的是 `StepTrace.gap`（`interpreter.ts` 的 `significantOperands`）；`:52-84` 用 `0x324` 当"被忽略的 no-op"样本，而 `0x324` 现在是 `ENGINE_INTERNAL_OPS` 的桩（`src/vm/handlers/stubs.ts:212`）⇒ 哪天 Effect3D 真做出来，这两例会**因进展而红**（文件自己记了 `0x346/0x349` 已踩过一次，`:54-55`）。 |
| 15 | `capability-ledger.test.ts` | 6 | ratchet | 独立（`analysis/engine-capabilities.json`） | 中 | 只读 JSON/md（最大 60 KB）；快 | **keep-ratchet（建议 merge+upgrade）** | `:69-73` 的 `counts` 自洽 + `:109-113` md 统计行一致，使"删条目"**真的**会红（改 counts ⇒ md 统计行不匹配）；`:116-127` 的"体检报告"唯一断言是 `counts['modeled-verified']>=1`（近恒真）；`:133-140` 的 note 泄漏守卫实测 **42 条样本里 16 条真空**（§3-3）。 |
| 16 | `ticket-ledger.test.ts` | 6 | ratchet | 独立（`tickets/**` 文件 + 锚点） | **强** | 121 票 / 785 anchor 全读；中等 | **keep-ratchet** | `:126-140` 的锚点棘轮是**本组覆盖最广的一条**（785 个 anchor 逐字 `includes`，代码删/改名必红）；`:67-94` 的 schema（acceptance 非空、`dropped` 必写 `droppedWhy`）是"没有判据的单不算单"的可执行版；`:96-109` 防 history 字段噪音回归（515 条里 262 条曾是噪音）。 |
| 17 | `script-ledger.test.ts` | 6 | ratchet | 独立（`src/*.txt` 行区间 + `functions.json`/`engine-capabilities.json`） | **强** | 33 条 × 读 `src/*.txt` + 33 份 md；中等 | **keep-ratchet** | `:128-156` 的锚点棘轮（anchor 必须出现在自己声明的 `lines` 区间内）会在**反汇编 reflow 后必红**，逼人刷行号——这正是它存在的理由；`:158-181` 的 `links` 不悬空（capabilities id / functions addr）是真交叉校验；`:233-251` 是近恒真（§3-4）。 |

---

## 2. 分类细则

### 2.1 (a) 台账棘轮 7 文件：防的是哪种漂移？能不能红？有没有恒真项？

| 文件 | 具体断言 | 防的漂移 | 能红吗 | 恒真/空心项 |
|---|---|---|---|---|
| `capability-ledger` | `:50-74` schema + counts 自洽 | 手改 JSON 加了条目却忘更新 `counts`；status/evidence 写出枚举 | 能（`counts.${k}` 与 `by(k)` 实算比） | `:52` 的 `entries.length>=40` 相对实际 **139** 只是"扫描没坏"的下限，不是内容守卫 |
| | `:76-92` guard 指向的测试文件存在 | "声称有守卫"变成空话 | 只对**删文件/改路径**能红 | **空心**：只查 `existsSync`。实测 92 条 guard / 54 个文件，`adv-msgwin.test.ts` 一家给 11 条当守卫；全部指向 `harness.ts` 也全绿 |
| | `:94-101` `n/a-known` 必须写 `why:` | 用 n/a 掩盖缺口 | 能 | — |
| | `:103-114` md 的 id 集合 + 统计行 + 总条数 | 忘跑 `build-capabilities.mjs` | 能（含 `**${entries.length}**`） | md 有**多余** id 时不查（单向） |
| | `:116-127` 体检报告 | —— | 仅 `modeled-verified>=1` | **近恒真**：139 条里只要有 1 条已核验就绿 |
| | `:133-140` note 全文不得漏进 md | 生成物混入沿革 | 只有"摘要 >300 字"才红 | **部分真空**：实测 42 条样本 16 条的探针被 `summarize()` 的前缀剥离弄成永不匹配（§3-3） |
| `script-ledger` | `:84-126` schema + counts | 同 capability-ledger | 能 | 同上下限写法（`>=4` vs 实际 33） |
| | `:128-156` **锚点棘轮** | 凭印象编造结构；`src/*.txt` reflow 后行号漂移 | **能，且是本组最有价值的红** | — |
| | `:158-181` guards 存在 + links 不悬空 | 声称有守卫 / links 指向不存在的 id、addr | 对悬空能红；对"守卫是否真的测它"**空心** | 同上 |
| | `:183-195` file 存在 + 不重复登记 | 一个脚本两条 | 能 | `:194` 的分母下限（`>=`）是弱形式 |
| | `:197-231` md 同步（分母/统计/每页含锚点与槽与守卫） | 忘跑 `build-scripts.mjs` | 能（文本级，很强） | — |
| | `:233-251` 缺口可见 | —— | `unregistered.length === total - entries.length` | **同义反复**：`registered` 由 `entries` 构造，两边约掉；另外两条是 `>=1` / `some(...)`。见 §3-4 |
| `ticket-ledger` | `:67-94` schema | 野文件夹、枚举外、无 acceptance、dropped 无理由 | 能 | `:84` 的 `HISTORY_KINDS` 声明在循环体内（写法怪但有效） |
| | `:96-109` history 不得是字段噪音 | 回归到"每次 `--edit` 追加一条" | 能（`total>=200` 下限 + 正则） | — |
| | `:111-124` done 必须带守卫 | 空口声称做完 | 对**删守卫文件**能红 | **空心**：只查 `existsSync`；`t.doneWhy` 不在 `Ticket` 接口里（见 §3-9） |
| | `:126-140` **证据锚点棘轮** | 代码删/改名后票里的证据变成谎言 | **能，785 个 anchor 全查**（本组最强） | `line` 漂移只警告不红（刻意） |
| | `:142-163` blockedBy/links 不悬空、不成环 | 依赖图腐化 | 能（DFS 检出环） | — |
| | `:165-172` 看板与真源同步 | 忘跑 `build-tickets.mjs` | 能 | — |
| `doc-model` | `:41-50` 每份 md 有合法 kind/state | front-matter 腐化 | 能 | `docs.length>=90`（实际 103）为下限 |
| | `:52-66` state≠live ⇒ superseded_by 且路径存在 | 结论"悬空" | 能 | — |
| | `:68-79` generated ⇒ home + generated_by 文件存在 | 生成物没标真源 | 能（对删生成器/改路径） | — |
| | `:81-92` kind=record ⇔ `99-records/` 且 state=consumed | 历史区与 kind 不一致 | 能 | — |
| | `:94-109` journal 正文不得出现在 generated md | 沿革漏进生成物（160 字探针、两侧都做空白归一） | 能（探针 >=120 字才比，口径合理） | — |
| | `:111-124` `03-engine` narrative 不得出现「订正/旧句/历史判据」 | A4①：读者分不清哪句是现行结论 | 能（但会误伤正常的"订正"用词——刻意的） | — |
| | `:126-138` index.md / opcode-table.md == 生成器输出 | 忘跑 `build-doc-index.mjs` / `build-opcode-table.mjs` | **能**（确定性最强的棘轮） | 下限 `>=500` / `>=20` |
| `capability-gap` | 见 §1 第 14 行 | —— | —— | **与 capability-ledger 无重叠**（它测 `StepTrace.gap` 行为） |
| `audit-report-completeness` | `:39-51` 三份报告含方法/覆盖/统计/误报 + 复核分布 | 审计交付物不自包含 | 只对**删文件/删关键词**能红 | **关键词在场 ≠ 内容完整**；`:53-64` 钉死散文引用句（自相矛盾） |
| | `:66-90` 三份 `audit-final-*.json` 已归档且计数 == 报告口径 | 数据清单只住在 `.tmp/`（gitignored） | 只与**硬编码字面量**比；改 md 里的数字**不会红** | 见 §3-7 |
| `tool-paths` | `:44-89` 基准统一 / 越界抛错 / 命中规则报告 / 不存在给候选 | 同命令两种基准 + 加载期弹窗 | **能**（真 `tools/paths.cjs`） | — |
| | `:91-108` 源码棘轮：两个跑手都用 `paths.cjs` 且 `preflight` 在 `require(main)` 之前 | 顺序反过来又变成 Electron 弹窗 | 能，但有**假阴性**（`includes('preflight(')` 被注释骗，§3-6） | — |
| | `:110-113` `shot.cjs` 必须有 `--name 只是文件名` 文案 | —— | **是文案断言**（§3-5） | 删掉校验只留注释也绿 |
| | `:115-120` `isInside` 边界 | 用 `startsWith` 判前缀相似 | 能 | — |

**小结**：7 个棘轮文件里，**真正"改坏必红"的是 `script-ledger` 的锚点棘轮、`ticket-ledger` 的锚点棘轮、`doc-model` 的生成物一致性、`tool-paths` 的路径基准**；**空心/近恒真的是**：三处 guard/tests 存在性检查、两处"体检报告"、`script-ledger:236-238`、`audit-report-completeness` 的全部内容级断言。

### 2.2 (b) 音频 7 文件

- **`audio-engine.test.ts` 的 30 例不是"测脚手"**。判据：
  1. 断言对象是 `AudioEngine` **发出的动作**（`host.loads` / `host.plays` / `gainHistory` / `offsetSec`），不是假宿主的内部状态；假宿主（`test/fakeAudioHost.ts`）只是记录器。
  2. 期望值大多是**手算**（`5000/10000=0.5`、`0.5×0.5=0.25`、`±10000→±1`、`offsetSec=12.5`），不是从被测代码读出来的。
  3. 唯一"自造"的部分是**延迟起算口径**：`:118-129` 与 `:188-197` 的 `tick(1000)` 不响 / `tick(1200)` 响，只有在接受"`armedAtMs` 在**第一次 tick** 才被置位"（`src/audio/audioEngine.ts:635`/`:648` 的惰性 arm）之后才能手算。这条口径本身值得用 raw（`sub_4B5230` / `sub_4BBA40`）再核一次：若引擎在 opcode 处就起算，emulator 的"flame 一帧不吃延迟"会**少一帧**，而这三条断言**恰好把错的一方钉住**。→ 列为"待核口径"，不是"无意义"。
- **`audio-node-host.test.ts` 才是本组唯一真"测脚手"的地方**（见 §1 第 3 行 + §5）。
- **`music-table.test.ts` 有两处需要区分**：`:61-67` 注册表棘轮（低价值重复）+ `:120` 同义反复；但 `:69-158` 的表写入/返回下标算术、`:160-176` 的真语料链是**强且独立**的。`tables.base.length===59` / `base[29]===23` 的期望值来自**同一个解析器**的一次运行（同源），但被 `audio-bgm-naming.test.ts:53-76` 的 MUINIT 两表自洽**从另一侧交叉确认**，可以接受。
- **`audio-silent-option.test.ts` 的 ⑤/⑤反面/⑥ 三条是"开关只影响怎么跑、不影响语义"这条硬要求的正确写法**（用"工厂抛错"证明"没被调用"是强手段）。

### 2.3 (c) 调试器 3 文件：24 例的接口/接线划分

| 用例 | 类型 | 判断 |
|---|---|---|
| `debug-query:30,39,47`（dec 口径 / 未写过=0 / 批量+hex） | 接口（纯函数，判据 `bits.ts` 的 enc/dec） | **留** |
| `debug-query:57`（frame 折叠空槽 / `all`） | 接口（但期望值含 `活帧 2`、`[3]` 这类**输出文本**） | 留（偏脆） |
| `debug-query:96`（未知命令给用法） | 接口（CLI 契约：`dbg.cjs` 靠 `ok` 判退出码） | **留** |
| `debug-query:105`（只读、含门计时器、突变证明） | 接口 + 真行为 | **留（本组最有价值的一条）** |
| `debug-query:136`（不 eval 源码棘轮） | ratchet（便宜） | 留 |
| `debug-break:41,55,62,75,89`（数字口径 / 解码值 / 缺项 / 运算符 / 解析报错） | 接口（纯函数） | **留** |
| `debug-break:95,109`（step / event 命中 + where 不匹配不命中） | 接口（纯函数） | **留** |
| `debug-break:137`（不 eval） | ratchet（便宜） | 留 |
| `debug-break:202`（`compileBreak` 校验 EVENT_KINDS） | 接口（**真缺陷守卫**，收口点选对） | **留** |
| `debug-break:143`（`parseDebugCommand` 全表 10 个断言） | 接线（**守的是死代码**） | **改**（§5-1） |
| `debug-break:186`（面板不得硬编码事件类型清单） | 接线（手段失效，现状假绿） | **改**（§5-2） |
| `debug-event-break:38,51,66`（三个池各发自己的事件 + val 口径） | 行为（VM 写路径真调用） | **留** |
| `debug-event-break:77`（`0x1F9`/`0x249` 两条绑定路径） | 行为 | **留** |
| `debug-event-break:97`（无钩子零副作用） | 行为 | 留 |
| `debug-event-break:105`（loop/session 源码棘轮） | 接线（**只钉文本形状**，且漏 `onBeforeStep`） | **改**（§5-3） |

---

## 3. 无意义 / 可疑清单（`file:line` + 反例实验）

### 3-1 `audio-engine.test.ts:401-410` —— 标题承诺 LRU，断言只查上界（**标题≠断言**）
```ts
test('缓存超预算会淘汰（LRU 保留最近用过的）', …)
  assert.ok(eng.debug().cache.bytes <= 3000 + 4096, …)
  assert.ok(eng.debug().cache.clips < 4, '超预算后不会把全部保留');
```
**反例**：把 `#evict` 换成 FIFO，或改成"随机淘汰一条"、甚至"淘汰后立刻重新 decode 回来（只保住上界）"——两个断言**照样绿**，`debug().cache.bytes` 与 `clips` 不区分淘汰策略。
**改法**：断言**具体哪条被淘汰**（`id=1` 不在 `cache`、`id=4` 在；或断言下次 `seLoad(1)` 会再次 `decode(1)`）。

### 3-2 `music-table.test.ts:120` —— 对字面量做掩码运算（**同义反复**）
```ts
assert.equal(0x1000001 & 0xffffff, 1, '低 24 位 = 刚追加元素的下标（与 sub_48DB80 的直接下标自洽）');
```
**反例**：把 `src/vm/handlers/music-table.ts` 全改坏（例如 op1 写成 `(组号<<8)|…`）——这条断言**仍然绿**，因为它不碰被测物，只是把两个常量算了一遍。上一行 `:119` 已经独立钉住了 `gv(e,0x70801e)===0x1000001`。
**改法**：删掉这一行；要钉"低 24 位是下标"就断言 `resolveBgmResource(e, gv(e,0x70801e))` 能取到刚登记的资源（`:175` 已经这么做了）。

### 3-3 `capability-ledger.test.ts:133-140` —— note 泄漏守卫：**16/42 样本真空 + 上界只到 300 字**
```ts
const big = L.entries.filter((e) => norm(e.emulator.note).length > 500);
assert.ok(big.length >= 10, …);
const leaked = big.filter((e) => md.includes(norm(e.emulator.note).slice(0, 300))).map((e) => e.id);
```
**实测（离线算的）**：42 条 note >500 字；其中 **16 条**的首 300 字含 `summarize()` 会先剥掉的「订正/日期」前缀（`scripts/build-capabilities.mjs:57` 的 `strip()`），所以探针**永远不可能**出现在 md 里 ⇒ 对它们**恒绿**。剩下 26 条也只能钉住"摘要短于 300 字"，钉不住注释与票面声称的 **≤200 字**。
**反例**：把 `summarize(note, n=200)` 改成 `n=250` → 26 条仍绿（探针 300 字 > 摘要 250 字）；改成 `n=300` 才红。⇒ 现在的判据是"<300"，不是"≤200"。
**改法**：探针用 `strip(norm(note)).slice(0, n+20)`，并把 `n` 从生成器导出（或断言 `md` 里该条摘要长度 ≤ 210）。

### 3-4 `script-ledger.test.ts:233-251` —— 同义反复 + `>=1` 下限
```ts
const registered = new Set(L.entries.map((e) => e.file.replace(/^src[\\/]/, '')));
const unregistered = srcFiles().filter((f) => !registered.has(f));
assert.equal(unregistered.length, total - L.entries.length);   // ← :238 恒真
assert.ok(L.entries.length >= 1, …);                            // ← :240
assert.ok(L.entries.some((e) => e.status === 'analyzed'), …);    // ← :247
```
**反例**：把 `srcFiles()` 改成 `return []` ⇒ `total=0`、`unregistered=0` ⇒ `0===0` **绿**；把 33 条 entries 删到 1 条 ⇒ `:240` 仍绿（`counts`+md 同步那一侧才会红）。`:247` 是"项目进度 ≥1"的下限，不是漂移判据。
**改法**：删掉 `:238`；把"已分析 > 部分 > 仅登记"的**比例**与上一次实测值一起写进票面证据（或在 md 里钉一个数字），别在测试里留恒真式。

### 3-5 `tool-paths.test.ts:110-113` —— 断言的是**一句帮助文案**（镜像）
```ts
assert.match(src, /--name 只是文件名/, 'shot.cjs 必须有这条前置校验（写死文案，守卫按它钉）');
```
**反例**：删掉 `shot.cjs` 里真正的 `--name` 校验代码、只把那句话留成**注释** ⇒ 仍绿；把文案改成"名字不能含 `/`"而校验还在 ⇒ **红**（行为没坏）。断言钉的是措辞，不是前置校验存在。
**改法**：把该校验抽成可调用函数（如 `paths.assertName(raw)`）并断言"含分隔符的 name 抛 `ToolPathError`"；最差也要断言到**代码行**（`lines.some(l => !/^\s*\/\//.test(l) && /--name 只是文件名/.test(l))`）。

### 3-6 `tool-paths.test.ts:98` —— `includes('preflight(')` 会被注释骗（**假阴性**）
```ts
const pre = lines.findIndex((l) => l.includes('preflight('));
const main = lines.findIndex((l) => /^\s*(const .*=\s*)?require\(['"]\.\.\/dist\/electron\/main\.cjs['"]\)/.test(l));
```
文件自己在 `:96-97` 记了"文件头注释里也提到过 require(main)，用 `indexOf` 会被注释骗"——**但只给 `require` 用了行首正则，`preflight(` 仍是裸 `includes`**。
**反例**：在 `require(main)` 之前加一行注释 `// preflight( 真正的调用在下面`，把真调用挪到 `require(main)` 之后 ⇒ `pre < main` 仍成立 ⇒ **绿**，而事故形态（加载期弹窗）回来了。
**改法**：对 `preflight(` 用同样的行首语句正则（`/^\s*preflight\s*\(/`），并顺带断言它出现在第一个 `require('electron')` 之后、`require(main)` 之前。

### 3-7 `audit-report-completeness.test.ts:66-90` —— "与报告一致"**没有实现**；`:55` 钉死散文
```ts
const want = { opcodes: [95, 9, 0], capabilities: [84, 9, 6], docs: [67, 13, 2] };
… j.kept?.length … === kept
```
`want` 是**抄进测试的字面量**，测试从不读 `audit-2026-09-*.md` 里的数字（`:39-51` 只查关键词在场）。
**反例**：把 `docs-new/99-records/2026-09-audit/audit-2026-09-capabilities.md` 的 `| **合计** | … | **84** |` 改成 `**999**` ⇒ 三个用例**全绿**。
另：`:55` `assert.ok(src.includes('执行状态见 §6'))` 钉死一句散文，与文件头 `:11` 自称"只钉节存在 + 关键词，不钉措辞"**直接矛盾**；改写成"§6 见执行状态"就红。
**改法**：从 md 里解析统计表（或让报告在题注里给出机器可读的一行），把 `want` 换成"从 md 解析出的数字 == JSON 计数"；`:55` 改成"§5 中出现了对 `## 6.` 的引用"的结构化断言（正则 `/##\s*6\./` + `/§6|§ 6/`），而不是钉整句。

### 3-8 `gallery-bgm-list.test.ts:190-215` —— E4 用**静默 `return`**，本机强断言不跑
```ts
const merged = await src.readSaveFlags();
if (!merged) { await src.dispose?.(); return; }        // :193-196  静默跳过
…
if (basePath && fs.existsSync(basePath)) { … }          // :199-213  强断言在里层
```
**实测**：本机 `base` 目录不存在（`.tmp/appdata/Eushully/` 下只有 `天結いキャッスルマイスター.overlay/`）⇒ `:200` 分支不进入；只剩 `:197 merged.length>0`（来自 overlay）会跑。而 `:208` 的 `hit.length >= 1` 是**主动放宽**（注释自己写"实测 31/36"，理由是不想让玩家继续玩之后变红）。
**反例**：把真机存档里的使用表改成空（或把解码器改坏成只解出头）⇒ `merged.length` 仍 >0、`hit.length` 可能仍 ≥1 ⇒ 绿。
**改法**：`test('…', { skip: !hasBase }, …)`（与 `music-table.test.ts:160` 的 `{ skip: !hasCorpus }` 同口径，让跳过在报告里**可见**）；期望值改成"≥ 上次实测"或从票据证据 JSON 读，而不是"≥1"。

### 3-9 `ticket-ledger.test.ts:115` + `tsconfig.json` —— `test/` **不在 typecheck 范围**，接口谎言无人发现
```ts
const doneWhy = (t.doneWhy ?? '').trim();   // Ticket 接口（:30-46）里没有 doneWhy
```
`app/amayui-emulator/tsconfig.json` 的 `include` 只有 `src/**`，且**显式 `"exclude": [..., "test"]`** ⇒ `npm run typecheck` 永远看不到 `test/`。所以本组 17 个文件（以及全部测试）都**不受类型检查**：`doneWhy` 这种拼错/漏声明不会被发现。
**反例**：`npx tsc -p` 带 `test/` 立刻报 TS2339；不加就永远不报。
**改法**：新增 `tsconfig.test.json`（extends 主配置，`include: ["test/**/*.ts", "src/**/*.ts"]`，`noEmit`）并挂进 `npm run typecheck`。成本极低，收益覆盖全仓 164 个测试文件。

### 3-10 `gallery-bgm-list.test.ts:37 + :45` —— 同一模块作用域二次声明 `instr`（**靠转译器侥幸不炸**）
```ts
37: import { im, instr, str } from './harness.js';
45: const instr = (op: number, args: BinArg[]): BinInstruction => (…)
```
ESM 里"导入绑定 + 同作用域 `const` 重声明"是 **SyntaxError**（我用 Node 24 最小复现确认：`SyntaxError: Identifier 'instr' has already been declared`）。这里之所以能跑，是因为 tsx 走 esbuild，而 esbuild 的 TS 转译**把未使用的导入消除掉了**——我用 `npx esbuild test/gallery-bgm-list.test.ts` 实测：产物里**没有**该 import，只剩本地 `const instr`。
**反例**：Node 原生 type stripping / `tsc` / 把 `test/` 加进 typecheck ⇒ **立刻红**。同类：`audio-opcodes.test.ts:22` 导入了 `str` 但全文未用（只有第 22 行出现）。
**改法**：删掉这两个导入（`im` 仍被用，只删 `instr`/`str`）。

### 3-11 `capability-gap.test.ts:52-84` —— 拿"还没实现的 opcode"当桩（**进展即红**）
```ts
loadScriptIntoFrame(e.curScript(), script(0x324, [{ type: T_IMM, raw: 0x1f4 }]), 'TEST.BIN');
assert.equal(t.handlerKind, 'engine-internal');
```
`0x324` 现在是 `src/vm/handlers/stubs.ts:212` 的 `op_engine_internal`（Effect3D 销毁）。文件自己在 `:54-55` 记了"原先用的 `0x346/0x349` 已是 Live2D 真实现 ⇒ 必须挑一条仍然是 engine-internal 的"。
**反例**：把 Effect3D 做成真实现（这是个已登记的缺口）⇒ 这两例**红**，但这是进展不是回归。
**改法**：用测试内的**显式桩**（`e.unknownOpStubs.set(0x9999, 1)`，`:108-116` 的 user-stub 用例已经这么写了），或挑一个永远不会实现的哨兵 opcode。

### 3-12 `audio-engine.test.ts:397-398` —— `debug()` 计数器是**实现的自我报告**（镜像）
```ts
assert.equal(eng.debug().cache.hits, 1, '缓存命中计数');
assert.equal(eng.debug().cache.misses, 1);
```
这两条与同一个用例里 `:393` / `:396` 的 `host.decodes.filter(id=>id===162).length === 1`（**独立判据**）表达同一件事，价值边际为 0；若把 `hits` 的语义改成"每次 `#ensureClip` 都 +1"，它们照样绿。
**改法**：删掉；或把"缓存命中/未命中"改成可观察行为（`decode` 调用次数、`load` 调用次数）。同类镜像项：`:312`（`debug().bgm!.name` —— 同一事实已由 `:311` 的 `host.loads` 独立断言）。**保留** `debug()` 里那些**只有内部才知道**的量（如 `:171` 的 `deferred === 162`，它正是被测语义本身）。

### 3-13 `audio-opcodes.test.ts:153-155` —— `mini()` 与 `mk()` 逐字相同（纯噪音）
```ts
function mini(): { e: Engine; … } { return mk(); }
```
`:84` 调 `mini()`，其余全部调 `mk()`。没有任何语义差别，只增加一层"这里是不是有特殊构造"的错觉。删。

### 3-14 `debug-break.test.ts:143-184` 与 `:186-200` —— 见 §5（本组的核心问题）。

### 3-15 重复的注册表棘轮（低价值重复）
`music-table.test.ts:61-67` / `audio-opcodes.test.ts:298-307` / `gallery-bgm-list.test.ts:81-89` 是同一形状（"这批 opcode 在 X 表、不在 Y/Z 表"）。全仓**38 个**测试文件里都有 `ENGINE_INTERNAL_OPS` 的存在性断言。
**反例**：把 `0x1d6` 从 `OPS` 挪到 `ENGINE_INTERNAL_OPS` ⇒ 三处都会红（有价值），但**三处的红是同一句话**；而真正的分类契约（两两不相交）已由 `test/registry-tables.test.ts` 集中守卫。
**改法**：合并进 `registry-tables.test.ts`，table-driven 一行 `[opcode, 期望表]`；各家族文件只留"操作数语义"用例。

---

## 4. 重复覆盖矩阵

| 不变量 | 出现处 | 重复度 | 去重对象 / 建议 |
|---|---|---|---|
| 曲号 → `BGM%03d.OGG` | `audio-bgm-naming.test.ts:32-37,91`；`audio-engine.test.ts:307-314,418`；`audio-node-host.test.ts:141-145`；`music-table.test.ts:160-176` | 中（4 处） | 保留 `audio-bgm-naming`（**真文件**是唯一独立判据）+ `music-table`（表自洽）；`audio-engine:307` 只留"BGM 用 `{name}` 资源"这一点；`audio-node-host:141-145` 可并入 |
| ADV 位下语音寄存/冲刷 | `audio-engine.test.ts:165-177`（引擎级）；`audio-opcodes.test.ts:241-254`（handler 分叉）；`audio-node-host.test.ts:280-296`（**手工造 intent**） | 高（3 处） | 删 `audio-node-host:280-296`：它直接 `scene.audio?.({kind:'voice-defer'})`，把 intent 当输入 ⇒ arrange 即 assert 的一半，且不覆盖 handler 路径 |
| 注册表分类棘轮 | `music-table:61`；`audio-opcodes:298`；`gallery-bgm-list:81`（+另 35 个文件同形） | 高（38 处） | 合并进 `test/registry-tables.test.ts`（已存在，管"两两不相交"），做成 table-driven |
| `RecordingNative`（记录音频意图的宿主） | `audio-opcodes.test.ts:37-50`；`gallery-bgm-list.test.ts:49-62` | **逐字重复** | 抽到共享件（注意 harness 的教训：只放与语义无关的构造） |
| `im`/`instr`/`gv` 构造器 | `test/harness.ts:23-45` vs `audio-node-host:178-183`、`gallery-bgm-list:43-46`、`music-table:38-40`、`capability-gap:26-50`、`debug-event-break:35-36` | 高 | 新增用例优先用 harness；不必强行统一既有（`tickets/T-0020` 已记） |
| WAV 合成件 | `audio-node-host.test.ts:44-60` vs `audio-silent-option.test.ts:44-65` | 高（两份 `u32`+RIFF 拼装） | 抽 `test/audioFixtures.ts` |
| 选项解析/合并 | `audio-silent-option.test.ts:69-81,83-91` vs `emulator-options.test.ts:60-95,282` | 中 | 删 `audio-silent-option:83-91` 的 `normalize`/`merge` 断言（通用机制已有）；保留 `audio.enabled` 这一**新键**的默认值断言 |
| 台账 schema 规则 | `capability-ledger:50-74` vs `.agents/skills/amayui-engine-analysis/scripts/capabilities.js:199+`；`script-ledger:84-126` vs `scripts.js` 的 `validate()`；`ticket-ledger:67-94` vs `tickets.js --validate` | **规则双实现** | 两处都要维护 ⇒ 抽成共享规则模块由"工具 `--validate`"与"`npm test` 守卫"共同 import（现在只能靠人同步，`capabilities.js:201` 的注释已经暴露过一次不同步：数组型 `note` 一路校验通过直到测试才炸） |
| "生成物与数据层同步" | `capability-ledger:103-114`；`script-ledger:197-231`；`doc-model:126-138` | 句式同、产物不同 | 无真重复；可共享 `assertGenerated(mdPath, render())` 帮助函数 |
| "沿革不进生成物" | `doc-model:94-124`（journal / 订正）；`capability-ledger:133-140`（note 全文） | 同纪律、不同载体 | 保留；注意 `capability-ledger` 那份的正确性低于 `doc-model`（§3-3） |
| "体检报告"式近恒真 | `capability-ledger:116-127`；`script-ledger:233-251` | 高（同一反模式） | 都改成"把阈值/清单钉进票面证据"，或整条删掉（信息已被 counts+md 覆盖） |
| 测试基础设施元守卫 | `audio-silent-option:199-204`（env 文件 + `--env-file`）vs `emulator-options.test.ts:169`（测试环境钉空配置）、`:185`（example 文件 + gitignore） | 中 | 合成一条 `test-env` 守卫 |
| 与**本组之外**的重复 | `debug-query/break` 的求值器口径 vs `operand-plan.test.ts` / `engineSlotFixtures.ts`；`music-table` vs `engine-config.test.ts`（`SYS4INI` 解析）；`audio-opcodes` vs `opcode-operands.test.ts`（操作数顺序） | 低-中 | 只在"真源改了要改几处"这个意义上关注；`analysis/opcodes.json` 派生的表已有 `doc-model:132-138` 兜底 |

---

## 5. 「调试能力自身」：接口守卫 vs 接线验证（★ T-0114 的教训有没有重演）

**结论：重演了，而且形态更严重。**

### 5-1 `parseDebugCommand` 是零生产调用者的死代码，测试守的是不发货的那份
- 全仓引用（`grep -rn parseDebugCommand`，排除 `dist/`）：`src/vm/debugBreak.ts:514`（定义）、`test/debug-break.test.ts`（10 个断言）、`tools/debugsrv.cjs:55/191/262`（**注释**）、`control/control.ts:233`（**注释**）。
- 活路径有两条，各自**手工复制**了同一张命令表，且**都没有测试**：
  - `control/control.ts:266-298`（面板：`?`/`c`/`bl`/`d`/`b`/`b event`/其它当查询）；
  - `tools/debugsrv.cjs:262-300`（CLI：`isCommand` 白名单 + `b event` 前缀分流）。
- 这正是 `test/harness.ts:78-83` 记过的反模式（"引擎为一个产品不走的路保留了 API，只剩测试在调"）——只不过这次是**模块级函数**而不是 `Engine` 方法，所以更容易被漏掉。

### 5-2 `debug-break.test.ts:186-200` 的守卫**当前就是假绿**，而且漂移就在用户眼前
```ts
const panel = fs.readFileSync('…/control/control.ts', 'utf8');
for (const kind of ['global-int-write','global-float-write','global-str-write','slot-bind','global-write'])
  assert.ok(!panel.includes(`'${kind}'`), …);      // ← 只查**带引号**的字面量
assert.ok(/where:\s*\(rest\[1\]/.test(panel), '面板应把事件类型透传给渲染窗');
```
- 实测 `control/control.ts:246-247`：
  ```
  '                      类型：global-write / slot-bind',
  '                      例：b event global-write idx == 0',
  ```
  **不带引号** ⇒ 守卫看不见。而 `global-write` 根本不在 `EVENT_KINDS`（`src/vm/debugBreak.ts:485-490` 只有 `global-int-write`/`global-float-write`/`global-str-write`/`slot-bind`）⇒ **面板至今在教用户打一个会被拒的类型**，并且完全没提 float/str 两池。
- 反例（现状即证据）：把 `:246-247` 改成合法清单，测试**不会**由红变绿，因为它本来就没红；把 `:246` 里的 `global-write` 改成 `global-int-write`（**修好行为**），测试**也不会**察觉。
- 第二半 `where: (rest\[1\]` 是对**源码形状**的断言：把面板重构成 `const kind = rest[1] ?? ''; …where: kind`（行为完全等价）⇒ **红**。断言的是写法，不是"没有复制合法值清单"。

### 5-3 接线守卫整体是"源码文本棘轮"，且**漏了最有价值的一环**
- `debug-event-break.test.ts:105-115`：`/onAfterStepEvent\?\.\(/`、`indexOf('await stepOnce(e)') < indexOf('onAfterStepEvent?.(')`、`/this\.#e\.debugEvent = /`、`/onAfterStepEvent:/`。这些只能证明"字符串还在、顺序还对"。
- **漏项**：条件断点的闸门是 `session.ts:354` 的 `onBeforeStep: (frame, instr) => this.#beforeStep(frame, instr)` → `session.ts:393-407` 的 `#beforeStep`（调 `matchInstruction`）。全仓 `grep onBeforeStep test/` **零命中**（只有 `run-cli-loop.test.ts` 里同名的**另一个**选项）⇒ **step 断点的接线没有任何守卫**（源码或行为都没有）。
- **可行的行为替代**（不需要 Electron，`loop.ts:130/260` 已有钩子）：
  ```ts
  // 合成脚本 + runFrameLoop(passes 一个 onBeforeStep / onAfterStepEvent)，断言
  // ① 回调被调用；② 顺序 = beforeStep → stepOnce → afterStepEvent；③ 抛/停语义正确
  ```
  这比 `indexOf` 顺序断言强得多，且能覆盖"钩子根本没被传进去"这类真回归。

### 5-4 能替代/增强这些测试的新调试能力
- `npm run dbg:srv` + `node tools/dbg.cjs` 已能把"面板 DOM 路径"之外的一切走通（T-0114 的 E4 实测在票据里有），**但它自己就是被审计的对象**，不能当判据 ⇒ 测试侧应当只把"命令解析 + 会话接线"变成可 headless 的行为断言，把"真界面点了没反应"留给 E4（票据负责）。
- `npm run record` / `replay`（`src/tools/replay.ts`）与 `npm run shot` 可以给"事件断点在真链路上命中"提供**回放级**的判据（读一段录制的输入 → 跑 headless → 断言断点命中序列），这是目前 24 例里完全缺失的一层（现在是纯函数 + 源码 grep 两极）。
- T-0122（内存快照/恢复，**未开工**）的验收 ⑥ 明确要求"**与 T-0114 的守护进程同一套通道（不另起一套命令解析）**"——按现状（已 3 套），T-0122 一开工就会变成 **4 套**，并会自然继承 §5-2 的假绿守卫。**T-0122 开工前应先做 §6-1。**

---

## 6. 本组最该改的 3 件事

### ① 让"命令表"只有一份，并把帮助文本纳入守卫（消灭 §5-1/§5-2 的复发面）
- **动作 A**：`control/control.ts:266-298` 与 `tools/debugsrv.cjs:262-300` 改为调用 `src/vm/debugBreak.ts` 的 `parseDebugCommand`（三者同构：`b`/`b event`/`bl`/`d`/`c`/其它当查询），失败时把 `{a:'query', text:'…'}` 原样回显。若跨编译单元不能直接 import，则把**纯解析部分**下沉到一个两边都能引的小模块（`debugCommand.ts`，无 `Engine` 依赖）。
- **动作 B**：把 `debug-break.test.ts:186-200` 换成**内容级**守卫：
  - `assert.ok(!/global-(int|float|str)-write|global-write|slot-bind/.test(panel))`（**不带引号**也查）——现在这条会立刻红，把 `control.ts:246-247` 的漂移逼出来；
  - 面板的帮助必须来自唯一真源：断言 `control.ts` 里不出现任何事件类型字面量，而应展示渲染窗回的消息（或直接 `import` `DEBUG_COMMAND_HELP`）。
- **动作 C**：给 `parseDebugCommand` 加一条"必须有生产调用者"的棘轮（`debug-break.test.ts` 里 grep `src|control|tools` 至少两处调用）——这条能防"守卫测死代码"再次发生。
- **为什么优先**：它是 T-0114 `changes.md` 那条教训的**同一根因**（跨编译单元复制合法值清单），而 T-0122 的验收 ⑥ 会把它放大。

### ② 把"接线"从源码文本升级为 headless 行为断言（并补上漏掉的一环）
- **动作 A**：`audio-node-host.test.ts:206-262` 的 `FrameHost` 改用生产件：
  ```ts
  const host = headlessFrameHost(scene, () => box.clock);   // src/renderer/headlessFrameHost.ts:15
  ```
  删掉只属于测试的 `yield: () => scene.audioEngine!.idle()`（`src/frame/host.ts:25` 明说 headless 不实现 `yield`），并**实测**删掉它断言是否仍成立（若仍成立 ⇒ 它本来就只是装饰，留着会误导"生产每帧等装载"）。这样删 `headlessFrameHost.ts:28` 才会红——今天不会。
- **动作 B**：`debug-event-break.test.ts:105-115` 的两条 `indexOf` 改成行为断言：用 `runFrameLoop(e, host, { onBeforeStep, onAfterStepEvent })`（`src/frame/loop.ts:239/260`）跑 2 帧合成脚本，断言回调被调用**且顺序正确**；同时补上 `onBeforeStep`（`session.ts:354`）+ `#beforeStep`（`session.ts:393-407`，`matchInstruction` 的调用点）的守卫——**今天这一环完全没人守**。
- **动作 C**：顺手把 `debug-break.test.ts:143-184` 里针对**死路径**的部分删掉（随 ① 一起；若 ① 已把它变成活路径则保留）。

### ③ 让"guard / tests 指向的文件"带上**内容锚点**（三处台账一起改）
- **现状**：`capability-ledger.test.ts:76-92`、`script-ledger.test.ts:158-181`、`ticket-ledger.test.ts:111-124` 都只 `existsSync`。实测：139 条能力里 92 条有 guard、只落在 54 个文件，`test/adv-msgwin.test.ts` 一家给 **11 条**当守卫；`tickets` 里 248 条 `tests[]` 同理。
- **动作**：把 guard 写成 `test/xxx.test.ts#<用例名片段>`（或新增字段 `guardAnchor`），守卫断 `readFileSync(file).includes(anchor)`；缺失锚点按警告起步。迁移可以脚本化：对现有 92 条 guard，把文件里**第一个** `test('…')` 的名字片段回填，人工校一遍。
- **顺带**：同一处把三份台账的 schema 规则与 `scripts/*.js --validate` 的重复实现抽成共享模块（§4 倒数第 6 行），否则每次加字段都要改两遍——这正是 `capabilities.js:201` 注释里记过的"数组型 note 一路校验通过"事故的温床。
- **为什么值**：这是三处台账**唯一**的"声称有守卫=空话"通道，也是把 `audit-report-completeness` 那类"关键词在场"式守卫升级为内容级校验的通用手法。

**第四（成本最低、建议插队）**：给 `test/` 加一个 `tsconfig.test.json` 并挂进 `npm run typecheck`（§3-9）。今天 `ticket-ledger.test.ts:115` 的 `t.doneWhy`、`gallery-bgm-list.test.ts:37/45` 的 `instr` 重声明都**不受任何检查**；一旦有人把测试挪到 Node 原生 TS 运行，后者是**加载期 SyntaxError**（全文件用例静默消失）。

---

## 7. 方法与限制

**读过的东西**：17 个测试文件全文（含每个 `test()` 的断言体）；`test/harness.ts`、`test/fakeAudioHost.ts`、`test/options.test.env`；`src/vm/debugQuery.ts`、`src/vm/debugBreak.ts`、`src/audio/audioEngine.ts`（`tick`/`voiceQueue`/`bgmFadeTo`/`FADE_STEPS`）、`src/renderer/headlessFrameHost.ts`、`src/frame/host.ts`、`src/frame/loop.ts`、`src/renderer/app/session.ts`（断点钩子）、`control/control.ts`、`tools/debugsrv.cjs`、`src/emulatorOptions.ts`、`src/vm/handlers/stubs.ts`、`src/vm/handlers/music-table.ts` 相关处；`scripts/build-capabilities.mjs`、`scripts/build-doc-index.mjs` 相关的生成逻辑；`.agents/skills/amayui-engine-analysis/scripts/{capabilities,scripts}.js` 的 `validate()`；`tickets/T-0114/{ticket.json,changes.md}`、`tickets/T-0122/ticket.json`；`tsconfig.json`。

**做过的离线计算（可复现）**：
1. `npx esbuild test/gallery-bgm-list.test.ts --outfile=…` ⇒ 产物无 `instr` 导入（证明重声明靠 import 消除侥幸通过）；Node 24 最小复现证明 ESM 重声明是 SyntaxError。
2. 逐文件 `grep -c '^test('` ⇒ 用例数表；`debug-*` 合计 24（任务书写 23）。
3. `analysis/engine-capabilities.json`：139 条 / 92 条有 guard / 54 个不同文件 / `adv-msgwin.test.ts` 被引 11 次；`analysis/scripts.json`：33 条 / 35 个 guard / 18 个文件；`tickets`：121 张票 / 248 个 `tests[]` / 785 个 evidence 全部带 anchor。
4. note 泄漏守卫真空率：42 条 >500 字样本中 16 条的探针被 `strip()` 前缀剥离变成永不匹配。
5. `docs-new` 103 份 md、其中 39 份 `kind: generated`。
6. 存在性：`install/SYS4INI.BIN` 存在（`music-table` 的 `{skip:!hasCorpus}` 实际不跳）；`.tmp/appdata/Eushully/` 下**只有** `.overlay` ⇒ `gallery-bgm-list` 的 E4 强断言本机不跑。

**没做 / 不能做**：未运行任何测试（纪律）；"会不会红"是静态推断 + 反例设计，个别条目（如 §3-1 的 LRU 反例、②-A 的 `yield` 必要性）建议实际跑一次确认；`audio-engine` 的延迟起算口径（§2.2）需要对 `sub_4B5230` / `sub_4BBA40` 的 raw 再核一次——本次未读那两处反编译正文。
