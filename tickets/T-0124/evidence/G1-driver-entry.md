# G1 组测试审计（帧驱动 / 入口 / 场景 / 控制面，24 文件）

**审计员**：只读测试审计（不改 `analysis/` `tickets/` `docs-new/` `app/` `src/` `scripts/`）
**审计对象**：`app/amayui-emulator/test/` 下 G1 组 24 个 `.test.ts`
**未能执行的检查**：本会话禁止跑 `npm test` / `verify` / `shot`，故所有"耗时"结论引自
`tickets/T-0115` 的实测基线（单文件计时），强度结论由**逐条读断言体 + 反例推演**得出，
不依赖覆盖率数字或注释质量。真语料存在于本机（`install/` 下 `SYS4INI.BIN` / `SCJUMP.BIN` /
`SAVE.BIN` / `CONFIG1.BIN` 均在），故本机 `t.skip` 分支基本不触发。

## 0. 价值判定口径（本次采用）

价值 = **实现改坏时它会不会红，且红的理由正确**。据此把每条断言归到四类 oracle：

- `独立`：真语料 / 引擎 raw 行号 / 外部常量 / 手算期望值 / 篡改输入 —— 改坏必红且理由正确。
- `自造`：期望值由被测代码或同源 helper 算出 —— 通常只在"内部不自洽"时红。
- `镜像`：断言实现自己的表 / 常量 / 映射 —— 改名就红、改语义不红。
- `无`：断言不指向任何行为（类型、存在性凑数、把输入原样读回来）。

---

## 1. 24 文件完整判据表

| # | 文件 | 类别 | oracle | 强度 | cost | Verdict |
|---|---|---|---|---|---|---|
| 1 | `frame-loop.test.ts` | core | 独立（raw 20887-20895 手算帧数） | 强 | 合成；无 skip；不慢 | **keep** |
| 2 | `frame-digest.test.ts` | core | 独立（负控帧号 5）+ 自造（往返/哈希） | 中（1 例强） | 合成；不慢 | **keep** |
| 3 | `frame-hold-cover.test.ts` | core+ratchet | 独立（真机日志那一笔 256×128）+ 镜像（0.9 常数） | 中-强 | 合成 + 源码扫描；不慢 | **keep** |
| 4 | `stage-loop.test.ts` | core | 独立（`install/SAVE.BIN` + `src/SAVE.txt`） | 强 | 真语料（小 BIN，快）；1× `t.skip` | **keep** |
| 5 | `boot.test.ts` | tool | 独立（真 BIN）+ 镜像（545 计数、0x2F6 native） | 中 | 真语料（轻）；无 skip | **upgrade** |
| 6 | `run-cli-loop.test.ts` | tool | 独立（子进程 stdout 字面串）+ 镜像（`PRODUCT_FRAME_POLICY` 比对） | 中-强 | 子进程 spawn（秒级）；无 skip | **keep** |
| 7 | `scenario.test.ts` | tool | 独立（手写期望） | 中 | 合成；不慢 | **merge** → `scenario-replay.test.ts` |
| 8 | `scenario-replay.test.ts` | tool | 独立（篡改第 5 帧 ip ⇒ 指名首帧） | 强 | 合成；不慢 | **keep** |
| 9 | `route-dispatch.test.ts` | core | 独立（raw 9847-9955 / 20175-20292 手算 label） | 强 | 合成；不慢 | **keep** |
| 10 | `abort.test.ts` | core | 独立（引擎语义），但只测"抛"不测"停" | 弱-中 | 合成；不慢 | **merge** → `op-02-exit-minus11.test.ts` |
| 11 | `exit-script.test.ts` | core | 独立（真 BIN 重载根脚本） | 中-强 | 真语料（轻）；无 skip | **keep**（test1 去重） |
| 12 | `title-exit.test.ts` | core | 独立（真语料 + 脚本数据算出的坐标） | 强 | 真语料 **2×200k 步**；无 skip | **keep**（私有帧循环待升级） |
| 13 | `t0102-chapter-chain.test.ts` | core+ratchet | 独立（真 `SCJUMP.BIN` 分支 ip + `src/*.txt`） | 强 | 真语料（极小，30 步）；2× `t.skip` | **keep** |
| 14 | `control-telemetry.test.ts` | tool | 独立（手写 `seen` 集合做并集判据） | 中 | 合成；不慢 | **keep** |
| 15 | `control-error-banner.test.ts` | tool | 独立（纯函数优先级）+ 棘轮 | 中 | 源码扫描；不慢 | **keep**（test2 应删） |
| 16 | `no-boot-preload.test.ts` | ratchet | 独立（源码模式：清单必须消失） | 中 | 扫描全 `src/*.ts`；不慢 | **keep-ratchet** |
| 17 | `headless-needs-render.test.ts` | ratchet+core | 独立（`READ_ONLY` 白名单棘轮） | 中-强 | 合成 + 扫描 `scene/ops.ts` | **keep-ratchet** |
| 18 | `wait-gate-timer.test.ts` | core | 独立（raw 12762-12786 逐行 + 边界手算 + 真 `SN0000.txt` 锚点） | **强（本组样板）** | 合成 + 文本；不慢 | **keep** |
| 19 | `skip-unknown.test.ts` | core | 独立（重试契约：抛错前不得改状态） | 中-强 | 合成；不慢 | **keep** |
| 20 | `menu.test.ts` | core | 独立（引擎 `sub_433A40` 语义） | 中 | 合成；不慢 | **merge** → `option-font-speed-menu.test.ts:126` |
| 21 | `scene-report.test.ts` | tool | 混合（`>0` 存在性 + 自造等式） | 中 | 真语料 **4×120k 步**；无 skip | **upgrade** |
| 22 | `config1-chain.test.ts` | core | 独立（真语料 + 脚本常量）+ 1 处自证 | 强-中 | 真语料 **≈9 条全链路**，48.8 s | **keep**（T-0115 首要对象） |
| 23 | `game-start-chain.test.ts` | core+ratchet | 独立（真语料 + raw + 脚本常量） | 强 | 真语料 **3 条全链路**，14.4 s | **keep** |
| 24 | `keyboard-scenario-menu.test.ts` | core | 独立（真 TITLE 落点 GAMESTART） | 中-强 | 真语料 **2 条链路**，24.5 s；1× `t.skip` | **keep**（test2 弱） |

### 逐文件理由 + 证据

**1. `frame-loop.test.ts` — keep（core / 强）**
共享驱动的档位契约，11 例全部用合成脚本把 `stopReason` / 帧数 / 步数的**手算期望**钉死。
- 独立 oracle 实例：`frame-loop.test.ts:172-202` 对同一脚本分别用 `anim:'clear'` 与 `'ignore'`，
  期望"3 步 / 2 完整帧"与"3 步 / 3 完整帧"——两档差异来自"清门要花掉一帧"这一引擎次序，
  不是实现回读。反例：把 `'clear'` 改成"清位且同帧继续派发"，`r.frames` 从 2 变 1 立即红。
- `frame-loop.test.ts:236-241` 期望 `bitAtFrameEnd === [1,1,1,0]`（池挂起位滞后一遍绘制），
  是 T-0024 的引擎次序判据；`frame-loop.test.ts:329-333` 期望音频 tick 的**逐项顺序串**。
- 唯一弱点：`frame-loop.test.ts:274-300`（服务开关）只断言"关掉的不调用 / 开着的调用 N 次"，
  属契约级，无独立真值，但它是 C3/C4 漂移的唯一守卫（`run-cli-loop.test.ts:184-189` 依赖它）。

**2. `frame-digest.test.ts` — keep（core / 中，1 例强）**
- 强例：`frame-digest.test.ts:149-184`——把动画窗的 `delay` 从 0 改成 `2*FRAME_MS`，
  期望"**恰好第 5 帧**起不同，且 diff 指名 `items[0]`"。`firstDiff === 5` 是**手算的引擎语义**
  （第 3 帧末配窗 ⇒ 第 4 帧锁存起点 ⇒ 第 5 帧才可辨），改坏 `+0x34` 锁存语义即红。这是全组
  最好的"负向控制"之一。
- 弱项（`自造`）：`frame-digest.test.ts:193-200` 是 `digestToLine → digestFromLine` 的自身往返 +
  用 `hashEngine` 复算自己的哈希；`frame-digest.test.ts:124-129` 是"同代码跑两次相等"（时序自洽，
  抓非确定性可以，抓语义错误不行）。两者不应被当成"G1 已证明"。
- `frame-digest.test.ts:188` `fnv1a32(canonicalize({v:1/3})) === fnv1a32(canonicalize({v:0.3333333333333333}))`
  与 `:190` 空串偏移基准 `'811c9dc5'` 是真外部常量，保留。

**3. `frame-hold-cover.test.ts` — keep（core+ratchet / 中-强）**
- 独立 oracle：`frame-hold-cover.test.ts:55-59` 的 **256×128=假**直接来自真机日志
  `.tmp/amayui-emulator.log` 里 `0x73 -> SC0000.BIN` 那一笔；这是"旧实现被它解除留帧"的复现。
- 棘轮：`frame-hold-cover.test.ts:87-106` 对 `pixiBackend.ts` 做源码检查，禁 `#releaseFrameHold('draw-texture')`
  （`:92`）并要求 `#releaseFrameHoldIfCovers` + `HOLD_MAX_FRAMES = 60`（`:106`）。回归形态唯一，
  够硬。
- 镜像（有意为之）：`frame-hold-cover.test.ts:52` `FRAME_HOLD_COVER_RATIO === 0.9` 与
  `:62-63` 的 1152/1151 边界都是从该常数反推。这是"口径棘轮"而非行为判据，别把它当覆盖率证据。
- `frame-hold-cover.test.ts:70-85`（判据不得改 flipbook 窗状态）是 T-0004 的实账，保留。

**4. `stage-loop.test.ts` — keep（core / 强）**
- E3：`stage-loop.test.ts:279-340` 直接 `parseScriptBytes(install/SAVE.BIN)`，断言
  `localInt(e,0x210) === 31`（`:334`，"32 条目 − 1"）、`lastFrameStart >= 481`、`r.frames >= 25`。
  期望值来自 `src/SAVE.txt:1643-1648` 的时间表（`i0d4 10 1e …`），**独立于实现**；
  且 `r.frames >= 25` 挡的是"塌成一帧"这个具体错法。
- `stage-loop.test.ts:342-349` 是 `src/SAVE.txt` 的形态棘轮；`:351-353`（三条在 OPS 里）是注册表
  棘轮 —— 后者与 `registry-tables.test.ts` / `game-start-chain.test.ts:85-106` 同族，属轻微重复。
- 弱点：`stage-loop.test.ts:148-174` 的状态模型断言（`entries[29].t === 480` 等）与实现同一份累加
  逻辑，属自造；但 `:156` "跨 `i0d4` 继续累计"是引擎语义的关键差异点（`480 → 481`），有判别力。

**5. `boot.test.ts` — upgrade（tool / 中）**
- 价值在**管线**：`boot.test.ts:22-35` 证明 `NodeFileSource → parse → stepOnce` 能跑通前 3 条并给出
  正确助记符 `comment` / `dev_ukn`；`boot.test.ts:40-47` 的 `resolveIndex`（0 → `SYSTEM4.BIN`、
  0x5264 → `TITLE.BIN`）是索引解析的唯一守卫。
- 问题断言：
  - `boot.test.ts:26` `instructions.length === 545`：真语料外部常量，但它是**构建产物**的计数
    ⇒ 任何一次合法翻译/汇编（`src/SYSTEM4.txt` 改一行）都会假红。反例：在 SYSTEM4.txt 里插一条
    `comment` 重新 assemble，本断言红，而管线毫无故障。
  - `boot.test.ts:34-35` `0x2F6 → handlerKind 'native'`：与 `audio-opcodes.test.ts:268`（真的执行 0x2F6）、
    `registry-tables.test.ts`（表非空 + 抽查）重复分类结论。
- **改法（可执行）**：把 `:26` 换成"BIN ⟷ 源码同源"判据——按 `src/SYSTEM4.txt` 里实际参与汇编的
  指令行数（与 `scripts/asm` 同口径）断言 `instructions.length`，这样译文更新不再假红，而"汇编器
  丢指令"会红；`:34-35` 删掉，改断言"前 3 条的助记符序列 + 第 3 条的 `argc`"（结构，不是表）。

**6. `run-cli-loop.test.ts` — keep（tool / 中-强）**
- 强项：`run-cli-loop.test.ts:125-140` 用子进程真跑 `tsx src/run.ts`，断言 stdout 出现
  `共执行 1 条指令`（`:139`）。这条是"直执行守卫写错则 CLI 变空操作"的**唯一**机械判据
  （注释在 `:117-124` 已说明单测覆盖不到 `main()`）。
- 棘轮：`run-cli-loop.test.ts:218-236` 把 CLI 门档与 `PRODUCT_FRAME_POLICY` 对比，只允许
  `anim`/`advance` 两处宿主缺口不同；`:231` 的 `{...opt.gates!, anim:'wait', advance:'pump'}` 是
  **函数式**的：产品策略改了它跟着改（不是把常量抄一遍），这点比多数镜像断言好。
- **应删**：`run-cli-loop.test.ts:103-115`（见 §2-②）。
- 代价：spawn 一个 tsx 进程（含 `--import tsx` 编译），是本组唯一的进程级测试；`timeout 60_000`。

**7. `scenario.test.ts` — merge（tool / 中）**
`Scenario` 的三条契约（到点一次 / 条件成立 / 顺序）都是真语义，`scenario.test.ts:23-24`
（同一帧 apply 两次只执行一次 + `sc.log` 内容）和 `:47`（前一步没执行则后一步不越过）有判别力。
但被测单元 `src/frame/scenario.ts` 的另一半（`runScenario` / `ScenarioScheduler` /
`parseScenarioSpec` / `applyScenarioEvent`）在 `scenario-replay.test.ts` + `keyboard-scenario-menu.test.ts:123`
里。**去重对象**：把它并成 `scenario-replay.test.ts` 的"Scenario 契约"段（用例数与判据不变）。

**8. `scenario-replay.test.ts` — keep（tool / 强）**
负控足够硬：`scenario-replay.test.ts:160-166` 篡改第 5 帧的 `ip`，期望 `firstDiffFrame === 5`
且 diff 里出现 `ip:`；`:183-189` 篡改头部策略使回放少跑帧 ⇒ 必须 `ok === false`。
两处的"坏输入"都由测试自己造，**与被测实现无关** ⇒ 改坏回放比对必红且理由正确。
小瑕疵：`scenario-replay.test.ts:200` `assert.equal(canonicalize(spec.events), '[]')` 用实现自己的
canonicalize 断言空数组（应直接 `deepEqual(spec.events, [])`）。

**9. `route-dispatch.test.ts` — keep（core / 强）**
本组最强的合成守卫。每个判据都注明了 raw 行号，期望值是**手算的 label 选择**：
`route-dispatch.test.ts:142`（点击 ⇒ `ip = 6` = labelC 而非 labelA 的 4）、
`:145-147`（返回点 = 门指令 dword 偏移 17、`routes.cursor = -1`、`enterPending = 0`）、
`:186-192`（悬停 label 的 `ret` 回门指令且**重跑门不得再记一页**，T-0016 用户实测）、
`:249` 与 `:281-284`（跨脚本派发必须抛 `Depth が不正です`）。
这些是"实现改错方向必然红"的判据（例如把 labelC 换成 labelA，`:149` 的 `notEqual(f.ip,4)` 同时红）。
弱点：`route-dispatch.test.ts:293-314` 的悬停门控用"把 `set:wheelkeyup` 配成掩码位 4 + `pressMouse(0)`"
来**代理**滚轮键（注释自认 emulator 没有键盘注入源）。它仍能抓住"门控逻辑被删/极性写反"
（`:308` 期望 `false`），但抓不住"滚轮键位映射写错"。建议把该代理标为已知缺口（T-0052 键盘注入落地后换真键）。

**10. `abort.test.ts` — merge（core / 弱-中）**
- 断言体全文只有一条：`abort.test.ts:16` `assert.throws(() => OPS.get(0x1)!(ctx), ExitScript)`。
- **它不测自己头部声称的东西**：`abort.test.ts:1` 写"渲染窗捕获后关闭主窗口，headless 捕获后停执行"，
  但文件里没有任何断言覆盖这个传播。**反例实验**：把 `src/renderer/app/session.ts` 里捕获
  `ExitScript` 的分支删掉（或让 `src/frame/loop.ts:244` 的 `if (err instanceof ExitScript) return 'exit'`
  改成继续抛）——本文件**依然全绿**，因为 `stage-loop.test.ts:249/261/270` 才是唯一覆盖
  "0x1 → 驱动 stopReason 'exit'"的地方。
- 去重对象：`op-02-exit-minus11.test.ts`（同族"控制转移 vs 程序退出"，它已经导入 `ExitScript` 并在
  `:222` 断言 `thrown instanceof ExitScript`，`:105` 断言"不得是 ExitScript"）。合并后补一条
  `runFrameLoop` 的 `stopReason === 'exit'` 断言，比现在的 17 行单断言更有价值。

**11. `exit-script.test.ts` — keep（core / 中-强）**
- 真价值：`exit-script.test.ts:75-81` —— 合成脚本只含一条 `0x9`，执行后断言
  `curScript().name === 'SYSTEM4.BIN'`（真资源根重载 INDEX0）、`ip === 0`、`cur === 0`、
  `callRet === -1`、`96983 === 0`。这是"GAMEOVER 回标题"机制的完整状态矩阵，独立于实现。
- 去重：`exit-script.test.ts:31-49`（`0x130` 读 `_this[96983]`）的核心两条已被
  `engine-field-store.test.ts:156`（`readBack(0x130, 96983, 7) === 7`）覆盖，
  `:41` 的"默认 1"被 `emulator-options.test.ts:56` 覆盖。`exit-script.test.ts:44/48` 的
  "set→读回"是自造（arrange 就是 assert 的一半），建议只留 `:46-48` 的一行并注明出处。
- `exit-script.test.ts:86-110`（组合）与 test2 部分重复，但它跑在**真重载后的 SYSTEM4 帧**上，
  保留（成本极低）。

**12. `title-exit.test.ts` — keep（core / 强，两处待升级）**
- 强项：这是"用户点了 TITLE 退出、窗口关不掉"的端到端复现。`:100` 期望命中第 **4** 项（退出）
  ——坐标 `(1180,630)` 与"第 4 项"来自 `i12e` 命中区扫描（脚本数据），设计文档
  `gameStartChain.ts` 头部把同一套 baseX/baseY 算法写清楚了；`:101/:107` 期望 `EXIT`。
  快速点击 vs 正常点击的对照（`:90` 那 400 步差异）正是 `pressLatch` 的回归判据。
- 弱点 1（**T-0020 已登记**）：`:31-73` 是**测试自造的帧循环**——`FRAME_OPS = {0x1f4,0x20c,0x23c}`
  （`:32`）+ `rt.clock += 16`（`:66`）+ `sleep n` 单独 `+=1`（`:69`）。它**不经过**
  `src/frame/loop.ts`、`PRODUCT_FRAME_POLICY`、`headlessFrameHost`。反例：把产品驱动的
  `services.charGrid`/`gates.sleep` 改成不同档位——本文件**不红**（它用自己的循环），
  只有 `run-cli-loop.test.ts` 的棘轮会红。**改法**：换成
  `runFrameLoop(e, headlessFrameHost(scene, ()=>clock), reportLoopOptions(...))`
  （`scenario-replay.test.ts:31-47` 已有现成写法）。
- 弱点 2：`:110-121` 的 `InputManager` 保持位测试与 TITLE 无关，是 `input.test.ts` 的题
  （`pressLatch` 全仓仅此一处覆盖，迁移时不要丢）。

**13. `t0102-chapter-chain.test.ts` — keep（core+ratchet / 强）**
本组"判据密度/成本"比最高：真 `install/SCJUMP.BIN` 只跑 30 步，`src/*.txt` 只做文本扫描。
- 行为组有**预先登记的判别力**：`t0102-chapter-chain.test.ts:93-97` 断言
  `firstWriteIp === 42` 且 `g(0x3f3c) === 1`；`:110-111` 断言另一组是 `35` / `0`。注释
  `:96` 明说"若 jcc 极性读反会落在 35"⇒ 这是把"哪一种读法"变成可判定的两个数值，
  反例实验已在文件里写好。
- 源棘轮组：`:114-131`（跑的是 `src/SCJUMP.txt`（>18000 行）而不是 `$1$SCJUMP.txt`（<1000 行），
  且两文件的门变量分别是 `13d7`/`1dd7`）、`:133-155`（`global 0` 是 SYSTEM4 的模式分派键）、
  `:157-180`（`mov (global-int 0) 6` 全语料仅 `SC0000.txt:1292` 一处且属 G0000 段）。
  都是**独立真源**（脚本正文），且成本接近 0。

**14. `control-telemetry.test.ts` — keep（tool / 中）**
- 独立判据：`:65-76` —— 手写 `seen = [0x346,0x349,0x213,0x70,0x143,0x2f6]`，断言三表并集等于它。
  这条是"信息不丢"的机械判据，且它对应的真实缺陷有据（头注 `:5-7`：21 条"真·忽略"里 16 条
  同时出现在缺口栏）。
- 分类规则本身（`:41-44`）是实现的规则复述 + `count === 2` 的累计检查（`自造`），
  但互斥断言 `:43`（`gaps.find(o => ignored.includes(o)) === undefined`）是关系型判据，保留。
- 与 `capability-gap.test.ts`（解释器层怎么产生 gap）分层，非重复。

**15. `control-error-banner.test.ts` — keep（tool / 中）**
- 强项是**源码棘轮** `:49-62`：`/this\.#errorText = emsg;[\s\S]{0,200}?this\.notifyStatus\(emsg\);/`
  （`:54`）与 `/error: controlErrorText\(errorOverride, this\.#errorText, paused\)/`（`:59`）。
  这两条覆盖的是"忘了接线"这类纯函数测不到的故障，且没有替代物。
- 纯函数优先级 `:29-34` 独立、便宜，保留。
- **应删/合并**：`:36-47`（见 §2-①）。

**16. `no-boot-preload.test.ts` — keep-ratchet（ratchet / 中）**
"删除型棘轮"：断言一段**不该存在**的代码（`:56` `PRELOAD_IMAGES`、`:77-79` 主动调用
`preloadImage`）。它抓的是"有人把启动期预载清单加回来"这个唯一回归形态，别无他法。
- 弱点（诚实边界）：`:58-60` 的清单形态正则只认 `0x5xxx` 十六进制三元组；`:74` 是一个**空 if 块**
  （`if (...) { /* 只有"调用"才算 */ }` 什么也不做），说明该断言的可读性与覆盖面都有水分。
- ③④ 与行为测试重复（见 §3 矩阵）：`:84-103` 是 `texture-frame-barrier.test.ts:37-61` 的正则版；
  `:106-113` 是 `texture-bind-race.test.ts:164` 的正则版。建议 ③④ 降级为注释/删，避免"两处都改"
  的维护面。

**17. `headless-needs-render.test.ts` — keep-ratchet（ratchet+core / 中-强）**
- 棘轮是全组少见的**结构型**判据：`:88-115` 按 `export function` 切片，要求"不置脏的 sc* 恰好等于
  白名单 `READ_ONLY`"（`:98-107`，含每条的 raw/票号），并断言 `setsDirty.length > 30`、含
  `scAdvance`/`scMsgWinSync`。新增变更型 op 忘置脏 ⇒ 变红（后果确实是"画面少合成一帧"，很难目视）。
  反例实验：在 `scene/ops.ts` 里加一个 `scFoo()` 直接改 `s.xxx` 而不置脏 ⇒ `readOnly` 多出
  `scFoo`，`:108` 的 `deepEqual` 红并提示加白名单。
- 行为部分（`:31-82`）与 `anim-window-done.test.ts:137-146`（`sceneNeedsRender = 脏 || 动画`）
  覆盖同一不变量的两个入口 ⇒ 见 §3 矩阵第 8 条；不需删，但要意识到"两处都绿"不代表双重保护。

**18. `wait-gate-timer.test.ts` — keep（core / 强；本组样板）**
- 逐行对齐引擎 `sub_407E20`（头注 `:8-17` 抄了 raw 12762-12786 的伪码），并把**边界**做成判据：
  `:73` `serviceWaitGate(1100) === false`（"恰好 `start+dur` 仍未到点，因为体里是 `>` 不是 `>=`"）、
  `:74` `1101 === true`。这两个数值只有读了体才写得出来 ⇒ 实现把 `>` 改成 `>=` 必红且理由正确。
- 场景级对照实验同样硬：`:151-166`（`i242 h 1` 排除慢推 ⇒ 门在 100 ms 放行，且
  `scAnimationsPending(...) === true` 证明慢推**仍在跑**）vs `:168-174`（不写 `i242` ⇒ 门被钉住
  `stopReason === 'cap'`、`e.scenePending === true`）。这是一对真实的因果对照，不是"存在性"断言。
- `:176-185` 把结论锚回 `src/SN0000.txt` 的真源（`:184` 的正则要求 `i220 … 13880` 紧跟 `i242 … 1`）。
- T-0091 G1 的 freeze 豁免（`:240-280`，`+720` bit0 豁免冻结）与驱动级转发（`:282-320`）
  覆盖了"漏转发任一环就全红"的接线，是设计文档 §5.3 的体订正。
唯一可挑的：`:194-238` 与 `:240-280` 大量断言 `work/flags/animStart` 这些**模型字段**，
属半自造；但期望值来自 raw 117831/117835/117837，属"读体得来"，可接受。

**19. `skip-unknown.test.ts` — keep（core / 中-强）**
契约判据："查表/抛 `NotImplementedOp` 阶段不得修改任何 VM 状态"（`:65-66`：`ip === 0`、
`locals.int.size === 0`），因此控制面可以**对同一条指令重试**（`:69-73`）。
反例：在 `interpreter.stepOnce` 里把 `ip++` 提到查表之前 ⇒ `:65` 红，且原因正确
（正是"控制窗点跳过会跳错指令"这个故障）。`:91-109` 的多条逐跳与 `:82-88`（用户桩不得遮蔽静态表）
是同一契约的边界。`scriptOf` 是测试自造输入（不是假件行为），不属"测脚手"。

**20. `menu.test.ts` — merge（core / 中）**
- 0xA1/0xA2/0xA3 的"登记 → 命中跳转 → 未命中回退 → 复位"主干与
  `option-font-speed-menu.test.ts:126-150` **重复**（那边同样断言 `hit._nextIp === 1`、
  `miss._nextIp === 0`、`e.menuMap.size === 0`、复位后走回退）。去重对象明确。
- 但有两条**那边没有**的判据，合并时必须保留：
  - `menu.test.ts:35-36` 负 key：`e.menuMap.get('-1') === 0x452` —— 引擎 `sub_41B640` 读的是
    **字符串**，`-1` 若被写成无符号（`4294967295`）则 TITLE 的初始未选中态派发不到；
  - `menu.test.ts:49-51` 未命中且回退 label **不在 labelMap** ⇒ `_nextIp === null`（不跳）。
- 建议：并入 `option-font-speed-menu.test.ts`（同属"选项/菜单"族），删掉重复主干。

**21. `scene-report.test.ts` — upgrade（tool / 中）**
- 唯一强判据是 T-0010 的驱动口径（`:92-179`）：用 `reportLoopOptions()` 的**真配置**驱动合成脚本，
  断言 `a.clock >= 500` 且 `SLEEP_GATE` 被清（`:127-129`）、`0x400` 计时器被等满（`:135-136`）、
  以及"阈值不许混用"的那两条数值（`:175` `frames === 0`、`:178` `frames === 100`）。这些是手算期望，
  且 `notStuck` 把"漏记帧 ⇒ 挂死"这个形态显式化（`:119-121`）。
- 应升级的三处：
  - `:45` `c.drawItems === c.drawableItems + c.placeholderItems` —— **恒等式**：
    `src/renderer/scene/snapshot.ts:419` 就是 `placeholderItems: drawItems.length - drawable.length`。
    反例实验：把 `snapshot.ts:417` 的 `drawable` 改成**恒空数组** ⇒ `drawableItems = 0`，
    `:43/:44`（`>0` / `>=0`）与 `:45` **全部照旧为绿**，而"可绘制项"这个量已经坏了。
  - `:49-56` `report.droppedIntents.length > 0` / `report.gaps.length > 0` —— 语料存在性断言。
    随实现收敛，缺口会归零 ⇒ 到那天**因为修好了而红**。改法：用一条**已知是缺口**的合成指令
    （例如把某个仍在 `ENGINE_INTERNAL_OPS` 的 opcode 喂进 report 路径）断言清单**内容**，
    或直接以 `capability-ledger` / `opcode-gaps` 台账为 oracle。
  - `:77` `deepEqual(report.meta.opFilter, ['0x1fb','0x202'])` 是把 `:72` 的入参原样读回（`无` oracle）。
- 代价：`:29` 的 `steps: 120_000` 在 `:32` / `:63` / `:64` / `:72` 跑了 **4 次**，其中 `:62-69`
  为了"确定性"跑两次。若改成"一次运行 + 与仓库内 golden 快照 diff"，既省一半又得到真 oracle
  （现在是"自己跟自己比"）。

**22. `config1-chain.test.ts` — keep（core / 强-中），T-0115 头号对象**
真价值（都是独立 oracle，来自真语料与脚本常量）：
- `:121-131` 文本层序 = `0x2c114`（`CONFIG.txt:39` 的 `i213 9 2c114 1f4`）且 `coveredBy === []`
  —— "文字被整屏 UI 盖住"那条静默缺陷的回归闸；
- `:141-161` `0x300` 闸门的**循环**证据（`revealed` 序列出现"整段 → 0 → 又 >0"）；
- `:175-194` 滚动条三段首尾相接（`:187-191` 用 `dstY + srcH*scaleY` 接缝，是"中段没被撑开"的
  结构判据，比像素值稳）；
- `:270-288` 每行描述符（`0x12F` 双重 DEC/ENC 回归）—— `row.value.srcY >= 0` 是"该行读成 0"的
  可判定形式；
- `:302-317` `0x12F` 排序与**独立复算**比较（`:310` 重新用 `b+c` 稳定排序算出期望 `a`）——
  这是本文件 oracle 最干净的一条；
- `:335-359` 切分类后滚动位置重置（`:343` `start <= maxStart`、`:346` 拇指落在轨道内）。
- 1 处自证：`:449` `s.restyleByI082!.liveFill === s.after.fill`，注释自己承认"**同一来源，互为印证**"
  —— 两侧都是 `e.engineValues.get(21664)` 经同一个 `bgrToRgb` helper 得到。改法：直接断言脚本常量
  （像 `:514` 那样 `=== '#ffffff'`），或断言"载荷色 == 重派生后 `adcd[c14acda]` 推出的颜色"。
- 代价（T-0115 基线 48.8 s）：`chain()` 只缓存 1 次（`:28`），但另有 **8 次**全链路：
  `:214`（fontPicker）、`:336`（scroll）、`:377`、`:404`、`:433`、`:452`、`:463`、`:494`（advReturn 的 5 个变体）。
  见 §5 建议 1。

**23. `game-start-chain.test.ts` — keep（core+ratchet / 强）**
- E3 判据都是独立值：`:326` TITLE 命中第 0 项、`:330` `gameStartResult === 1`、`:333-337`
  进入 SN0000 且 `firstTextIp === 901`（与 `SN0000.txt:1225` 对应）且整页文本含首句、
  `:345` 路径上**零未实现 opcode**。
- 对照实验（`:390-404`）：把等待门换成修前的 `advance:'force'` 旁路 ⇒ 悬停整条通路消失
  （`cursorTrail` 恒 `[-1]`）—— 这是"headless 与 Electron 分叉"的因果证据，不是自证。
- 判据⑥（`:418-436`）用**脚本 id + SE id** 两个独立量排除"SN0000 抢先发声"（`0x51e3` 必须来自
  `GAMESTART.BIN`，且之前不得有 SN0000 的 `0x32`）。
- 泛化棘轮（`:452-470`）锁"序章没有发言人"这一**取样点存在性**（`3f37` 设置点只在对话脚本），
  避免后人用旁白样本去判"角色名颜色"—— 属于很值钱的一条方法论守卫。
- 弱点：`:108-121` 的"不写操作数"棘轮只喂 `op1..op4` 且只查 `0x300/0x301` 两格（覆盖面窄，
  但对 A5 那 7 条够用）；`:85-106` 的 25 条清单与 `registry-tables.test.ts` 同族（轻微重复）。
- 代价：`:324` / `:391` / `:419` 三次全链路（14.4 s）。

**24. `keyboard-scenario-menu.test.ts` — keep（core / 中-强）**
- 强项是**真实落点 + 对照**：`:106-111` 断言"`↓` + `Enter` ⇒ 进 `GAMESTART.BIN`"，
  `:112-115` 断言 TITLE 期间的 `local 3f7` 被移动键改过（`new Set(sels).size > 1`），
  `:117-120` 对照组"只按 Enter ⇒ 不得离开 TITLE"。这三条一起把"Enter 是全局热键"这个错误解释排除。
- 脆弱点：`:105` 的 `firstNonTitle` 是一张**手写 INIT 脚本黑名单**（`LOGO.BIN`/`CDINIT2.BIN`/…）
  加 `startsWith('$')`。启动链一旦多一个 INIT 脚本，`:106` 会假红（不是行为坏了）。
  改法：改成"跳过所有已知 INIT 集合并取第一个非 INIT"的**集合常量**（放在 `src/tools/scenarioBoot.ts`
  旁边共享），或直接断言 `scripts` 里出现 `GAMESTART.BIN` 的**位置关系**而不是"第一个非 TITLE"。
- `:99-101` 的 skip 谓词查的是 `raw`/`install` 目录里的 `SYS4INI.BIN`，而实际启动走
  `resolveResourceDir`（env/`install` 默认）⇒ 谓词与真实资源解析**不同源**（本机会同时成立，
  但换 `AMAYUI_RESOURCE_DIR` 就会错判）。
- `:123-139`（`applyScenarioEvent` 的 keydown→pressKey / keyup→releaseKey）**是测脚手架**：
  它造一个 `fake` 输入对象并断言 fake 记下了调用。它抓得住"spec 的事件名→方法映射被改"
  这一种回归，但 `fake` 的行为完全由测试规定 ⇒ 应把它降为 `scenario` 单测的一小节，别计入 E3 证据。

---

## 2. "无意义 / 可疑"清单（逐条带反例实验）

> 判定只用五条定义：① 同义反复 ② 镜像实现 ③ 无独立 oracle ④ 重复覆盖 ⑤ 测脚手。

**① `control-error-banner.test.ts:36-47` —— 同义反复（①）+ 与 `:29-34` 重复（④）**
```ts
const report = (override?: string) => controlErrorText(override, sticky, null);   // :40
assert.equal(report(err), err, '出错当次上报');                                   // :42
sticky = err; // = `#onError` 里的 `this.#errorText = emsg`                        // :43  ← arrange 由测试自己完成
assert.equal(report(), err, '★收尾那次不带 override 的上报必须仍然显示同一个错误'); // :44
```
`sticky = err` 是**测试自己**模拟接线，所以 `:44` 只验证了"`controlErrorText(x, x, null) === x`"，
而这正是 `:32`（`controlErrorText(undefined, '上次', null) === '上次'`）已经断言的。
- **反例实验**：把 `src/renderer/app/session.ts` 的 `#onError` 里 `this.#errorText = emsg;` 删掉
  ⇒ `:44` **仍然绿**（测试自己赋的 `sticky`）；只有 `:52-56` 的正则棘轮会红。
- **结论**：`:36-47` 删掉，故障检出能力不变（纯函数由 `:29-34` 覆盖、接线由 `:49-62` 覆盖）。

**② `run-cli-loop.test.ts:103-115` —— 无 oracle（④）+ 未测自称的事**
```ts
assert.equal(typeof opt, 'object');                 // :113
assert.equal(typeof opt.onStep, 'function');        // :114
```
`runLoopOptions` 声明返回 `FrameLoopOptions`，断言其类型是 TS 层面的事实。文件头 `:11-13` 声称
"本文件第一件事就是能 import 进来本身"——但 import 在 `:19` 就发生了，**任何断言之前**；
若 `src/run.ts` 改回无条件 `main()`，效果是"import 时跑一遍 CLI"，而不是 `:113` 变红。
- **反例实验**：把 `runLoopOptions` 改成 `return { onStep: () => {} } as unknown as FrameLoopOptions;`
  ⇒ `:113/:114` 照旧绿；`:218-236`（棘轮）与 `:146-164`（C1）才红。
- **结论**：删 `:103-115`；"直执行守卫"由 `:125-140` 的子进程断言独占。

**③ `scene-report.test.ts:45` —— 镜像/恒等式（②）**
`assert.equal(c.drawItems, c.drawableItems + c.placeholderItems)`，而
`src/renderer/scene/snapshot.ts:419` 就是 `placeholderItems: drawItems.length - drawable.length`。
- **反例实验**：把 `snapshot.ts:417` 的 `drawable` 改成恒 `[]`（或恒等于全体）⇒ `:45` 恒真、
  `:43`（`>0`）与 `:44`（`>=0`）仍真 ⇒ 三行全绿，而"可绘制项"这个量已失去意义。
- **结论**：`:45` 换成有区分度的断言（例如"至少一项 `flags&1` 为 0 的占位项 + 至少一项可绘制项"，
  并且两者在已知合成场景下计数固定）。

**④ `scene-report.test.ts:77` —— 把入参读回（③）**
```ts
const { report, jsonl } = await runSceneReport({ ...OPTS, ops: [0x1fb, 0x202] });  // :72
assert.deepEqual(report.meta.opFilter, ['0x1fb', '0x202']);                        // :77
```
- **反例实验**：把 `--ops` 解析结果改存到另一个字段（行为不变）⇒ 本行红；把白名单同时用于收敛
  `opCounts` ⇒ `:76` 红（这才是要守的）。⇒ `:77` 不指向行为。

**⑤ `scene-report.test.ts:49-56` —— 语料存在性（③，且是定时炸弹）**
`droppedIntents.length > 0` / `gaps.length > 0` 断言"当前语料下还有缺口"。
- **反例实验**：给某条仍在 `ENGINE_INTERNAL_OPS` 的 opcode 补上真实现 ⇒ 这两行**因为修好了而红**。
- **结论**：改成断言**清单内容**（用一条受控的缺口指令）或直接以 `opcode-gaps.test.ts` 的台账为 oracle。

**⑥ `boot.test.ts:26` —— 构建产物计数（②/③）**
`instructions.length === 545`：合法改译文 + assemble 即假红；而"漏汇编一条指令"这种真故障
会以同样方式变红，两者不可区分。→ 改成源码 ⟷ BIN 同源判据（见 §1-5）。

**⑦ `exit-script.test.ts:41-44` —— set→读回（③/自造）**
`e.engineValues.set(96983,0)`（`:46`）后断言 `0x130` 输出 0（`:48`），arrange 与 assert 是同一状态。
- **反例实验**：把 `0x130` 的实现改成 `local2 = 1`（常量）⇒ `:48` 红（有齿），但把它改成
  "读 `_this[96983]` 后再 `^1`"（语义错但为 0 与 1 的映射仍有一段对）⇒ `:44` 红、`:48` 绿 ⇒
  一半判据失效。真正需要的是"默认 1 + 置 0 后为 0 + 两处来源一致"三格全对（现在分散在
  `emulator-options.test.ts:56` / `engine-field-store.test.ts:156`）。

**⑧ `config1-chain.test.ts:449` —— 自证（③）**
`assert.equal(s.restyleByI082!.liveFill, s.after.fill, '载荷色 == 那一刻的实时全局色（同一来源，互为印证）')`
—— 两侧同源（同字段 + 同 `bgrToRgb`）。该断言在真实路径用例 `:514` 已有独立版本
（`=== '#ffffff'`，脚本 `adcd[0]` 的真值）。→ 删 `:449`，或改成与 `adcd[c14acda]` 的推导比较。

**⑨ `scenario-replay.test.ts:200` —— 用实现的 canonicalize 断言空数组（③，轻微）**
`assert.equal(canonicalize(spec.events), '[]')` → 应写 `assert.deepEqual(spec.events, [])`。

**⑩ `keyboard-scenario-menu.test.ts:123-139` —— 测脚手（⑤）**
用 `fake` 输入对象断言 `calls === ['keydown:38','keyup:38']`。它守的是 spec→方法的映射，
但断言对象是测试自造的假件；作为 E3 文件里的第二条用例会误导"这条也是真语料证据"。
→ 移入 `scenario` 单测，或明确标注"接线单测"。

**⑪ `menu.test.ts:18-57` —— 重复覆盖（④）**
主干与 `option-font-speed-menu.test.ts:126-150` 同判据。→ 合并（保留 `:35-36` 的负 key、
`:49-51` 的"回退 label 无映射"两条）。

**⑫ `abort.test.ts:12-17` —— 单断言 + 不测自称的传播（④/③）**
见 §1-10。→ 并入 `op-02-exit-minus11.test.ts` 并补 `runFrameLoop` 的 `stopReason === 'exit'`。

**⑬ `frame-hold-cover.test.ts:52` 与 `frame-digest.test.ts:186-191` 的"镜像但有意"**
这两处是**有意为之的口径棘轮**（改常数即红并提示复核），不算无意义，但**不能当行为证据**。
区别对待：保留，但在报告/台账里标为 ratchet。

---

## 3. 重复覆盖矩阵（本组内部 / 与全仓其它测试）

| # | 不变量 | G1 内位置 | 全仓其它位置 | 去重对象 / 处置 |
|---|---|---|---|---|
| 1 | "G1 确定性：同脚本跑两次 digest 相同" | `frame-digest.test.ts:124-129` | `scenario-replay.test.ts:61-81`（`ca.hashes() === cb.hashes()`） | 保留 `frame-digest`（原语层）；`scenario-replay` 只留"时钟按 `stepMs`、帧号连续"两条 |
| 2 | `sleep` 门：`nowMs >= sleepUntil` 才放行 | `frame-loop.test.ts:245-272` | `run-cli-loop.test.ts:159-163`、`scene-report.test.ts:123-129`、`op-10-002-adv-sleep-order.test.ts:82`、`adv-reveal-under-throttle.test.ts:82`、`input.test.ts:193-199` | 分层（驱动档 / CLI 配置 / report 配置 / ADV 优先级）⇒ **不删**，但 `run-cli-loop` 的 C1 与 `scene-report` 的①其实在验同一件事，可合并到 `frame-loop` 的档位测试 + 各自的"配置是否正确"棘轮；`input.test.ts:193-199` 只断言"`0xC8` 置位"然后**手工**清位（`:198`），是弱版（真判据在 `frame-loop`/`wait-gate-timer`），可删该两行 |
| 3 | `0x400` 门：位清/等计时器/池挂起 | `frame-loop.test.ts:172-242` | `wait-gate-timer.test.ts:64-99`、`scene-report.test.ts:131-143` | 分层保留；`wait-gate-timer` 是 `serviceWaitGate` 的真值源（`input.test.ts` **不**覆盖 0x400，勿误记） |
| 4 | 场景"该不该合成"= 脏 或 有动画 | `headless-needs-render.test.ts:31-71` | `anim-window-done.test.ts:137-146`（`sceneNeedsRender`）、`sc-transition-window.test.ts` | 入口不同（`HeadlessScene.needsRender` vs 纯函数）⇒ 保留，但知晓非双重保护 |
| 5 | 纹理帧屏障 / `bind` 未命中即装载 | `no-boot-preload.test.ts:84-103`、`:106-113`（正则） | `texture-frame-barrier.test.ts:37-61`（行为）、`texture-bind-race.test.ts:164`（`onReady`） | **删/降级 G1 这两段**，行为测试已是更强 oracle |
| 6 | `0xA1/0xA2/0xA3` 菜单派发 | `menu.test.ts:18-57` | `option-font-speed-menu.test.ts:126-150` | merge（保留负 key + 回退无映射两条） |
| 7 | `_this[96983]` 默认值 / `0x130` 读它 | `exit-script.test.ts:41-48` | `emulator-options.test.ts:52-57`、`engine-field-store.test.ts:155-156` | 去重 `exit-script` test1 的前两条断言 |
| 8 | `0x2F6` 的族分类（native） | `boot.test.ts:32-35` | `audio-opcodes.test.ts:268-301`、`registry-tables.test.ts:41-50` | 去重 |
| 9 | `InputManager` 按钮保持位 | `title-exit.test.ts:110-121` | `input.test.ts:44-49`、`:76-89`（边沿/两把刷子） | `pressLatch` 消费语义独有 ⇒ 迁入 `input.test.ts` |
| 10 | 真 TITLE 链路（真语料 + 输入） | `title-exit.test.ts:79-108`、`keyboard-scenario-menu.test.ts:45-121` | `input.test.ts:106-215`、`game-start-chain.ts` 链 | 断言不同、**代价三份** ⇒ 至少共享一份 boot/推进优化（T-0115 建议） |
| 11 | 0x1 = 程序退出 | `abort.test.ts:16` | `stage-loop.test.ts:249/261/270`（`stopReason === 'exit'`）、`op-02-exit-minus11.test.ts:222` | merge |
| 12 | "25 条/16 条已转真实现"类注册表棘轮 | `game-start-chain.test.ts:85-121` | `registry-tables.test.ts`、`op-a2-a3.test.ts:63-73`、`capability-ledger.test.ts` | 保留（各自的 opcode 清单是"该链路/该批次"的账），但注意它们是**同类判据的三份拷贝** |
| 13 | 脚本全局 `3f37` 的设置点分布 | `game-start-chain.test.ts:452-470` | `t0102-chapter-chain.test.ts:157-180`（`global 0` 的 `6`） | 同族（脚本数据棘轮），判据不同 ⇒ 保留 |
| 14 | `global 0` 模式分派 | `t0102-chapter-chain.test.ts:133-155` | `game-start-chain.test.ts:330`（`gameStartResult === 1`） | 分层：前者是脚本真源，后者是运行时结果 |

---

## 4. 可被新调试能力替代的用例（探针型 vs 守卫型）

**总原则**：`dbg:srv` 是**现场观测**，不能替代回归守卫；能替代的只有"为了看一眼某个值/某条链而
把观测结果写死成断言"的用例——这类用例的期望值是**当时的现场读数**，换个资源/翻译就假红，
而它抓不到任何回归。

| 用例 | 类型 | 判断 |
|---|---|---|
| `config1-chain.test.ts:376-520`（advReturn 的 4 组） | **探针型（应瘦身）** | `recordAtI082/republish/fill/liveFill/snapshot` 全是现场读数。真守的只有一条：**分支表**（`g0`/`1397`/`3f37` → 是否走 `:262` 假分支、`i082` 是否重画）。建议保留 `:493-520`（真路径组合，唯一抓过 bug 的那组）作为守卫，其余三组降为 `dbg:srv` 现场查询脚本（`b event global-int-write idx == 3318` 之类）或改成**合成 E2**：直接装载 `CONFIG.BIN`、在 `i076` 之后设全局、单步到 `i082`，把 48 s 的全链路换成毫秒级。 |
| `config1-chain.test.ts:213-257`（fontPicker 漂移） | 半探针 | `:224`（`pivotRelX === popupOrigin.x`）是现场读数；`:250-256`（渲染左边缘 == `dstX`）是**真守卫**（组合变换的法）。保留后者，前者作为前置条件。 |
| `config1-chain.test.ts:335-359`（滚动条溢出） | **守卫型** | `start ∈ [0,maxStart]`、拇指落在轨道内是**不变量**，与具体资源无关。保留。 |
| `t0102-chapter-chain.test.ts:84-112` | **守卫型** | 两个数值（42/35）是把"jcc 极性"变成可判定的分支指纹，不是"看一眼"。保留（而且便宜）。 |
| `game-start-chain.test.ts:323-384`、`:390-404`、`:418-436` | **守卫型** | 断言的是"到达哪条脚本 / 谁发的 SE / 有没有文字重放"，都是行为不变量；`advance:'force'` 的对照是因果实验。保留。 |
| `keyboard-scenario-menu.test.ts:98-121` | **守卫型**（落点 + 对照） | "`↓`+Enter → GAMESTART / 只 Enter → 仍在 TITLE" 是行为判据；但黑名单式 `firstNonTitle` 该换。 |
| `scene-report.test.ts:31-60`、`:62-69` | **探针型（应瘦身）** | `>0` / `>100` / `>10` 类断言只证明"工具还产出东西"；真正的守卫是"清单内容"与"确定性"。建议只保留 1 次运行 + golden 快照 diff。 |
| `boot.test.ts:17-38` | 半探针 | "前 3 条是 comment/dev_ukn/0x2F6"是管线守卫（保留）；`545` 是现场读数（删）。 |
| `wait-gate-timer.test.ts`、`frame-loop.test.ts`、`route-dispatch.test.ts`、`skip-unknown.test.ts` | **守卫型** | 判据来自 raw 边界与契约，`dbg:srv` 无法替代。 |
| `control-telemetry.test.ts` / `control-error-banner.test.ts` | **守卫型**（控制面是宿主层，不进真机 VM） | 调试器看不到"控制窗三张表是否互斥"。保留。 |

**一句话**：本组里"想看一眼"的只有 `config1-chain` 的 advReturn 探针族与 `scene-report` 的存在性读数；
其余守卫不能用调试器换掉。

---

## 5. 最该改的 3 件事

### 改 1：把 `config1-chain.test.ts` 的 8 次全链路收敛成 1 次前缀 + 变体批处理（T-0115，48.8 s → 目标 <10 s）
- 现状：`chain()` 缓存了 1 次基础运行（`config1-chain.test.ts:28`），但 **8 处**另起全链路：
  `:214`（fontPicker）、`:336`（scroll）、`:377` / `:404` / `:433` / `:452` / `:463` / `:494`（advReturn 5 变体）。
- 可行方案：`src/tools/config1Chain.ts:740-790` 显示 advReturn 的差异**只在尾部注入的 4 个全局**
  （`3f38/g0/1397/3f37`）+ `seedRecords`（文本项表）。把 `ChainOptions.advReturnProbe` 扩成
  `AdvReturnVariant[]`：跑完 `previewProbe` 后，对每个变体「快照 `e.globals`/`e.textItems` →
  注入 → 走一次"退出设置页→回 ADV"尾段 → 采样 → 还原」，即可用**一次** boot→CONFIG1 前缀
  覆盖全部变体。判据一字不改，只把"各跑一遍完整游戏"换成"各跑一遍尾段"。
- 兜底（若尾段不可重入）：至少给 `fontPickerProbe`/`scrollProbe`/`advReturnProbe` 各加模块级
  promise 缓存（`let cached = new Map<string, Promise<ChainResult>>()`），并把 `advReturnProbe`
  改成接受数组。**不做**"改成 E1/E2 充数"（T-0115 明令禁止）。

### 改 2：清掉 4 处不指向行为的断言 / 自证，并给 1 处补独立 oracle
逐条（都在 §2 有反例）：
1. 删 `control-error-banner.test.ts:36-47`（arrange 由测试自己完成；接线由 `:49-62` 守）。
2. 删 `run-cli-loop.test.ts:103-115`（`typeof === 'object'`；直执行守卫由 `:125-140` 守）。
3. 删 `scene-report.test.ts:45`（恒等式 `snapshot.ts:419`）与 `:77`（把入参读回），
   把 `:49-56` 的 `>0` 换成"受控缺口指令 + 清单内容"。
4. `config1-chain.test.ts:449` 换成独立 oracle（`=== '#ffffff'` 或由 `adcd[c14acda]` 推导），
   与 `:514` 同一口径。
5. 顺带：`abort.test.ts` 并入 `op-02-exit-minus11.test.ts`，并补一条
   `runFrameLoop(e, host).stopReason === 'exit'`（现在这条只被 `stage-loop.test.ts:249` 间接覆盖）。

### 改 3：把 G1 的两处"自造驱动/自造启动判据"接回共享层（T-0020），并让语料棘轮不随翻译假红
1. `title-exit.test.ts:31-73` 的私有帧循环（`FRAME_OPS` + `clock += 16`，T-0020 的证据行就是 `:66`）
   换成 `runFrameLoop` + `headlessFrameHost(scene, () => clock)` + `runLoopOptions/reportLoopOptions`
   （写法照 `scenario-replay.test.ts:31-47`）。收益：这条 E3 从此真正覆盖**产品帧语义**
   （`gates`/服务开关/advance 档），而不是只覆盖"脚本 + 我的循环"。
2. `keyboard-scenario-menu.test.ts:105` 的 INIT 黑名单换成共享的 INIT 集合常量 +
   "序列里出现 GAMESTART 的位置关系"判据；`:99` 的 skip 谓词改用 `resolveResourceDir`（与启动同源）。
3. `boot.test.ts:26` 的 `545` 换成"`src/SYSTEM4.txt` 参与汇编的指令数 ⟷ BIN 指令数"；
   `exit-script.test.ts:41-44` 的两条与 `emulator-options.test.ts:56` / `engine-field-store.test.ts:156`
   去重。收益：译文更新/实现收敛不再产生假红，真故障（汇编丢指令、字段接线断）仍红。

---

## 6. 附：本组的 `mk()` 变体与代价速查

**自造 harness（T-0020 的"17 处变体"在本组内的分布）**：
`frame-loop.test.ts:26 mk()`、`frame-digest.test.ts:37 mk()/70 mkHost()`、`wait-gate-timer.test.ts:43 mk()`、
`scenario-replay.test.ts:31 mk()`、`stage-loop.test.ts:44 mkScript()/106 stageScript()`、
`route-dispatch.test.ts:31 mkScript()/68 mkPanel()`、`skip-unknown.test.ts:19 scriptOf()`、
`game-start-chain.test.ts:52 instr()/55 mk()`、`exit-script.test.ts:25 instr()`、`menu.test.ts:12 instr()`。
只有 `scene-report.test.ts` / `run-cli-loop.test.ts` / `route-dispatch.test.ts` 用了 `harness.ts` 的
`im/instr/mkEngine`。**建议**：`instr`（4 处逐字重复）与"装着合成脚本的 Engine"（5 处）优先并入
`harness.ts`；`mkScript` 的 `dwordToInstr` 版本（`stage-loop`/`route-dispatch` 各一份）差异只在
步长口径，应收敛成一个带 `dwordToInstr` 参数化的共享版。

**重量级全链路运行次数（G1 合计 ≈ 20 次）**：
`config1-chain` ≈9、`scene-report` 4（×120k 步）、`game-start-chain` 3、`title-exit` 2（×200k 步）、
`keyboard-scenario-menu` 2。T-0115 列出的三慢文件（`config1-chain` 48.8 s、`keyboard-scenario-menu`
24.5 s、`game-start-chain` 14.4 s）全在本组，**G1 就是 `npm run verify` 的主要成本来源**。
