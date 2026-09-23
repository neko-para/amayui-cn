# T-0124 · 测试用例价值盘点与方法论评估（2026-09-23）

> 本文是**本次全量测试审计的结论件**（唯一人可读落点）；7 份分组原始报告在 `evidence/G1..G7-*.md`，
> 主 agent 的独立复核记录在 `evidence/verification-log.md`，变异实测在 `evidence/mutation-campaign.md`，
> 逐文件成本在 `evidence/test-cost.tsv`。
>
> **范围**：`app/amayui-emulator/test/` 下 **159 个 `*.test.ts` / 1078 个用例**（`node:test`）。
> 另有 `app/amayui-toolkit` 的 5 文件 / 87 用例（`vitest`，独立子工程）—— 由子代理另审，结论见 `evidence/toolkit-vitest.md`。
> **不在范围**：`electron/`、`control/`（控制面板）、`tools/*.cjs` 本身没有测试；本次只记录"它们没有测试"这一事实。
>
> **判据（全篇统一）**：**价值 = 把被测实现改坏时它会不会红，且红的理由正确。**
> 注释质量、断言条数、覆盖率数字**都不算**价值证据。

---

## 0. 结论摘要

### 0.1 关于"哪些有用、哪些没用"

1. **159 个文件里没有一个"整文件无意义"** —— 7 个分组的一致结论是 `drop` 数 **0**：每个文件都至少守着一条真实不变量。
2. **无意义集中在断言级**，共确认 **6 类**、**>90 处**（逐条带反例实验，见 `evidence/G*.md` 的"无意义/可疑"节）：
   - ★**零断言假绿 5 处**（最严重）：`console.warn('[skip]…'); return;` 不调 `t.skip()` ⇒ node:test 记 **pass**，**一条断言都没跑**。
   - **恒真断言 ~10 处**：两侧同一表达式 / 纯字面量运算（`assert.equal(0x1000001 & 0xffffff, 1)`）。
   - **镜像实现 ~15 处**：断言被测代码自己的表/常量（"这个 opcode 在 OPS 表里"）。
   - **无独立 oracle ~5 处**：期望值由被测代码或同源 helper 算出（两边一起改错就绿）。
   - **错 oracle 1 处**：期望值与引擎 raw 相反，**会挡住正确修复**（`engine-config.test.ts:160`）。
   - **判据钉在错的地方 ~10 处**：断言源码文本/注释/日志文案，而不是行为（重构即假红、真坏可能不红）。
3. **重复覆盖是最大的一类"浪费"**：同一不变量在 2~9 个文件各断一遍（`adv-msgwin` 的路由组 vs `route-dispatch`、存档族 10 文件、注册表分类棘轮 8~9 处、逐字节拍 4 处）。**删掉它们不损失任何故障检出**（每处都有更强替身，报告里逐条给了替身位置）。
4. **但整体判据强度是够的**：12 处"引擎语义变异"实测里，**9 处被真守卫抓到**（少则 1 个文件，多则 61 个文件）—— 这说明"无用"的是**冗余的那一份**，不是"没人守"。
5. ★**但确实有 3 处"零覆盖"（改坏了全量 1078 例无一红）**，全部由变异实测发现（见 §5 与 `evidence/mutation-campaign.md` §2）：
   - **Z1 绘制项 z 序**：把 `presenter.ts:179` 的排序方向反转 ⇒ 无一红；
   - **Z2 快照的"可绘制项"**：把 `snapshot.ts` 的 `drawable` 恒置空 ⇒ 无一红（G1 推测的恒等式被证实）；
   - **Z3 控制面板的指令码前导零**（`control/control.ts:38-43` 的 `opHex()`）⇒ 无一红（`control/` 层零测试覆盖）。
   ★静态读码只推测出 Z2/Z3，**Z1 是变异独有发现**；这三处已分别派到 `T-0125`（Z1/Z2）与 `T-0127`（Z3）。

### 0.2 关于"要不要改测试方法"

**要改，但不是"删单测去用调试器"。** 三条具体调整：

| # | 调整 | 为什么（本次实测依据） |
|---|---|---|
| **A** | **分档**：默认档只跑"合成 + 棘轮"（目标 ≤20 s），真语料档 `test:corpus` 与真机档 `e4` 分开 | 单元件 `config1-chain.test.ts` 单跑 **59.2 s**（= 全量 `npm test` 的一半以上）；155 个其它文件基本都是纯合成、毫秒级 |
| **B** | **把调试器定位成"oracle 工厂"，再把它本身变成 automated E4 闸门** | `dbg:srv`（常驻守护）+ `click/clickn/clickimg/move` + `run/frame/slot/global` 查询 + 条件/事件断点 + `shot` ⇒ 过去"必须人坐在窗口前点"的 E4（`T-0051` 的 5 项、`T-0114` 未做的 E4、`T-0067` 的现场）**可以脚本化且可重复** |
| **C** | **加变异闸门**（`npm run mutate`）：维护一份"引擎语义破坏"清单，每条要求 ≥1 条测试红；**零红 = 覆盖空洞** | "无意义断言"没有任何静态办法可靠识别；本次 12 处变异就抓出一条过强的审计结论（见 `verification-log.md` §B2）。**反例实验制度化**是唯一机械手段 |

**贯穿性的三个结构缺陷**（都便宜、都该先修）：

| # | 缺陷 | 依据 |
|---|---|---|
| D1 | **`test/` 不在 typecheck 里**：`tsconfig.json` 的 `exclude` 含 `test`，另两份 tsconfig 只 include `src`/`control`/`electron` | 17 个守卫文件不受类型检查；已有 1 处 `instr` 重声明**靠 esbuild 消除未用导入才没炸**（ESM 语义下是加载期 SyntaxError ⇒ 整个文件的用例静默消失） |
| D2 | **7~9 处 E4/E3 闸门盯不存在的目录**：判断写 `resolveSystemPaths(REPO).baseDir/SAVE`，而本机真存档只在 `overlayDir/SAVE` | 这些"真槽"用例**静默跳过**（`save-slot-chain` 2/2 全跳）；`engine-slot.test.ts:268` 是唯一两侧都看、唯一真在跑的 E4 |
| D3 | **调试命令表分裂成 3 份**，被测试守的那份**不发货** | `parseDebugCommand`（`src/vm/debugBreak.ts:514`）**零生产调用者**；生产走 `session.ts` 的 `compileBreak`，而面板 `control/control.ts:266-298` 与 CLI `tools/debugsrv.cjs:262-300` 各有自己的分流表。**后果已经发生**：面板用户可见帮助至今写着非法事件名 `global-write`（合法值见 `debugBreak.ts:485-490`），且浮点/字符串两池缺失 |

---

## 1. 事实基线

### 1.1 规模与成本（本机实测，2026-09-23）

| 项 | 数值 |
|---|---|
| 测试文件 | **159**（`app/amayui-emulator/test/*.test.ts`） |
| 用例 | **1078**（`tests 1078 / pass 1066 / fail 0 / skipped 12`） |
| `npm test` 全量墙钟 | **108.0 s**（另一次负载下测得 66.6 s ⇒ **成本随机器负载波动大，单文件数字更可靠**） |
| 逐文件单跑墙钟**串行合计** | **245.9 s**（`evidence/test-cost.tsv`，含 tsx 启动；并行跑才是 108 s） |
| `npm run verify` 另两段 | `typecheck` ×3 + `check:dead-writes`，各 1~3 s |
| 跳过 | **12 例**（真资产/真存档槽/平台条件）—— 其中 **9 例同因**：闸门盯 `baseDir` 而数据在 `overlay`（见 D2） |

**最贵的 12 个文件**（逐文件实测，全表见 `evidence/test-cost.tsv`）：

| 文件 | 用例 | 单跑墙钟 |
|---|---|---|
| `test/config1-chain.test.ts` | 13 | **59.2 s** |
| `test/keyboard-scenario-menu.test.ts` | 2 | **28.2 s** |
| `test/adv-name-color-chain.test.ts` | 3 | **21.9 s** |
| `test/scene-report.test.ts` | 4 | 15.4 s |
| `test/text-style-snapshot.test.ts` | 6 | 13.1 s |
| `test/mesh-vertex-quad.test.ts` | 7 | 9.7 s |
| `test/game-start-chain.test.ts` | 14 | 9.4 s |
| `test/live2d-enabled-flag.test.ts` | 1 | 7.8 s |
| `test/opcode-gaps.test.ts` | 4 | 4.2 s |
| `test/title-exit.test.ts` | 3 | 4.0 s |
| `test/save-data.test.ts` | 16 | 3.7 s |
| `test/config-version-substr.test.ts` | 12 | 3.5 s |

> ★这 12 个文件合计 **180 s = 串行总成本的 73%**，其余 147 个文件平均 **0.45 s**。
> ⇒ "分档"的收益几乎全部来自把它们移出默认档（`T-0126`），而不是"删测试"。
> ★`config1-chain.test.ts` 比 `T-0115` 记的 48.8 s 还高（59.2 s）⇒ **它一个人占掉整轮 verify 的一半**。

### 1.2 已有的闸门体系（本次审计前就存在）

| 闸门 | 内容 | 能否进 CI | 判据 |
|---|---|---|---|
| **G1** | `npm test`（159 文件 / 1078 例） | ✅ | 断言 |
| **G3** | `npm run record` + `npm run replay` ⇒ **逐帧 `FrameDigest.engine` 段相等** | ❌ 需 Electron | 两宿主（Electron / headless）**帧序一致** |
| **G4** | `npm run shot` + **8 条固定关键日志行** | ❌ 需 Electron + 人看 | 观感/关键路径 |
| 台账 `--validate` | `tickets` / `capabilities` / `scripts` 三份数据层自检 + 守卫测试 | ✅ | 锚点棘轮 |

★**关键事实**：G3/G4 是"大范围、真环境"的判据，但**都不在 `npm run verify` 里**（文档明说"Electron 无法在 CI 里跑"）。
⇒ 1000+ 单测实际承担了相当一部分"大范围"的职责，而它们**做不到**（合成指令给不出真实上下文）——
这正是"无意义断言"与"错判据点"孳生的土壤。

---

## 2. "无意义"的六种精确形态（含与"未 await"的区分）

⭐**本报告最重要的方法论产出**：三类"看起来都是假绿"的病**机制完全不同**，处置优先级也不同。

| 形态 | 机制 | 会不会红 | 本次确认处数 | 处置 |
|---|---|---|---|---|
| **① 零断言空跑** | 回调里 `console.warn('[skip]…'); return;`，不调 `t.skip()`（回调甚至不接 `t`） | **永不红**（node:test 记 pass） | **5**（`live2d-moc:62/183/188`、`live2d-deform:246/288`） | **最高优先**：改 `t.skip()`。这是"谎报绿灯" |
| **② 恒真断言** | 断言两侧同一表达式；或纯字面量运算（不引用被测对象） | **永不红** | ~10（`op-2ed:112-122`、`operand-plan:523-527`、`op-d0:94-97`、`op-205:75`、`music-table:120`、`script-ledger:238` …） | 删，或换成手算常量/行为断言 |
| **③ 未 await 的异步断言** | `assert.rejects(...)` 没有 `await`/`return` | **可能红，但归因错**：报"测试结束后产生了异步活动"、失败挂在**文件**上 | **1**（`overlay.test.ts:121`，实测见下） | 补 `await`（1 行）。**不要**当成"假绿" |
| **④ 镜像实现** | 断言被测代码自己的表/常量（`OPS.has(op)`、`长度为 21`） | 只在"改一处不改另一处"时红 | ~15 | 合并成一张数据表；或删（多数已有行为守卫）。**不要**当 core 记账 |
| **⑤ 无独立 oracle** | 期望值由被测代码或**同源 helper** 算出（`expected = sameHelper(x)`） | 两边同时改错就绿 | ~5 | 补一条"引擎侧对照"（raw 行号 / 手算常量 / 真语料） |
| **⑥ 判据钉错地方** | 断言**源码文本 / 注释 / 日志文案 / 台账 prose**，而不是行为 | 重构即假红；真改坏可能不红 | ~10 | 换成行为断言（公开缝：`presenter.itemSprite`、`headlessScene.advanceModel`、`runFrameLoop`）；或下沉到 `--validate` |

★**`overlay.test.ts:121` 的实测订正**（避免把它当"永不红"的代表）：

```
注入：删掉 src/arch/overlay.ts:146 的 same-dir 拒绝  ⇒  npx tsx --test test/overlay.test.ts
结果：ℹ tests 14 / pass 12 / fail 1
      ℹ Error: Test "overlay 与 base 指同一目录 ⇒ 拒绝写…" generated asynchronous activity
        after the test ended. This activity created the error "AssertionError: … /拒绝写/"
```

⇒ 在这个文件里（后面还有真异步用例把事件循环撑住）**回归会被抓到**，只是**报告形态与归因都不对**。
**结论**：它是"脆弱"，不是"空洞"。**凡拿"未 await"论证"永远绿"的，必须实跑**（本审计的 7 份子报告里共两条被实测订正（本条的 "永不红" 与 `call-frame.test.ts:81` 的 "同义反复"），
见 `verification-log.md` §B）。

### 2.1 已确证的无意义断言（主 agent 亲自复核过的，逐条带反例实验）

> 这些是**我亲自读码或实跑确认**的；分组报告里另有约 80 处同类项（每条也带反例实验，见 `evidence/G*.md` 的"无意义/可疑"节）。

| 位置 | 形态 | 反例实验（改什么，它还会绿吗） |
|---|---|---|
| `test/live2d-moc.test.ts:62/183/188`、`test/live2d-deform.test.ts:246/288` | ①零断言 | 缺资产时 `console.warn` 后裸 `return` ⇒ node:test 记 **pass**，**一条断言都没跑**。全仓 `t.skip(` 有 31 处，只有这 5 处是裸 return |
| `test/op-2ed-and-bit-index.test.ts:112-122` | ②恒真 | `instr()` 的定义就是 `argc: args.length`（`test/harness.ts:33`）⇒ 换任意 opcode/任意参数个数仍绿 |
| `test/operand-plan.test.ts:523-527` | ②恒真 | `:514-522` 的 `if/else if/else` 保证四桶之和 ≡ `checked.length` ⇒ 永远相等 |
| `test/op-d0-wallclock.test.ts:94-97` | ②恒真 | 第二个 `Engine` 从未跑 `0xD0`，只是 `enc`→`dec` 往返 ⇒ 把 `0xD0` 改成写三个槽仍绿 |
| `test/op-205-blank-extent.test.ts:75` | ②恒真 | 两侧同一表达式；★**实测 Node 24 的 `assert.equal(NaN,NaN)` 不抛** ⇒ 注释声称的"防 NaN"也做不到 |
| `test/music-table.test.ts:120` | ②恒真 | `0x1000001 & 0xffffff === 1` 是纯算术，不引用被测对象 |
| `test/save-data.test.ts:94` | ②恒真 | `crc32MsbFirst(v) === msb` 同进程同函数自证。★变异 M13 实测：该断言**确实没红**，但 **3 个别的文件**抓到了 ⇒ 它是**冗余**而非唯一守卫 |
| `test/call-frame.test.ts:81` | 弱（**订正**：不是恒真） | 它断的是"**重载脚本不得清全局池**"（arrange 在 `:76`、动作在 `:79`）；弱点在"结构上几乎不可证伪"，不是"无意义"。见 `verification-log.md` §B1 |
| `test/overlay.test.ts:121` | ③未 await（**订正**） | 实测会 `fail 1`，但报的是"测试结束后产生了异步活动"、挂在**文件**上 ⇒ **脆弱/误归因**，不是"永不红"。见 §2 与 `verification-log.md` §B2 |
| `test/engine-config.test.ts:160` | ⑤错 oracle | 期望 `get(21293)===2`，而引擎 raw 23695 是 `= v37 != 0`（存 0/1）⇒ **它挡着正确修复**（补 `map` 后该用例应当红） |
| `test/missing-texture-skips-item.test.ts:64-85` | ⑥钉错地方 | 断言 `#placeholder(it: Item)` 签名 / 日志文案 / **注释里含 `raw 122952`** ⇒ 重构即假红、真复活占位块可能不红 |
| `test/scene-report.test.ts:43-45` | ⑤无独立 oracle ⇒ **实测零覆盖** | 三条断言与 `snapshot.ts:419` 的恒等式同增同减。★变异 M12 实测：把 `drawable` 恒置空 ⇒ **全量 1078 例无一红** |
| `src/renderer/pixi/presenter.ts:179` 排序方向 | **实测零覆盖** | ★变异 M7 实测：反转 z 序 ⇒ **无一红**（本处静态审计**没发现**，是变异独有发现） |
| `control/control.ts:38-43` 的 `opHex()` | **实测零覆盖** | ★变异 M16 实测：去掉 `padStart(3,'0')` ⇒ **无一红**（`control/` 层零测试覆盖） |
| `test/capability-ledger.test.ts:74-93` 等三处台账守卫 | ④镜像（仅 `existsSync`） | 139 条能力 / 92 条 guard / 只用 54 个文件；全指向 `test/harness.ts` 也全绿 |

### 2.2 完整清单的入口

| 组 | 无意义/可疑条目 | 重复覆盖矩阵 | 文件 |
|---|---|---|---|
| G1 帧驱动/入口 | 12 条 | 有 | `evidence/G1-driver-entry.md` |
| G2 VM/opcode 机制 | 22 条 | 有 | `evidence/G2-opcode-mech.md` |
| G3 ADV/文本 | 19 条 | 有 | `evidence/G3-adv-text.md` |
| G4 渲染/绘制 | 9 节（含子项） | 有 | `evidence/G4-render-draw.md` |
| G5 纹理/Live2D | 19 条 | 有 | `evidence/G5-texture-l2d.md` |
| G6 存档/配置 | 8 条 | 有（含存档族合并方案） | `evidence/G6-save-config.md` |
| G7 音频/台账/工具 | 15 条 | 有 | `evidence/G7-audio-ledger-tooling.md` |
| toolkit（vitest） | 7 条 | 有 | `evidence/toolkit-vitest.md` |

---

## 3. 各分组判定汇总

| 组 | 文件 | 用例 | 分布 | 报告 |
|---|---|---|---|---|
| G1 帧驱动/入口/场景/控制面 | 24 | ~230 | keep 17 / keep-ratchet 2 / merge 3 / upgrade 2 / **drop 0** | `evidence/G1-driver-entry.md` |
| G2 VM/操作数/opcode 机制/派发 | 25 | ~260 | keep 18（含 4 处 upgrade）/ keep-ratchet 5 / **drop 0** | `evidence/G2-opcode-mech.md` |
| G3 ADV/消息窗/文本管线 | 24 | ~190 | keep 22 / keep-ratchet 2 / merge 2 / **drop 0** | `evidence/G3-adv-text.md` |
| G4 渲染/绘制项/图元/转场/命中 | 25 | ~200 | core 19 / ratchet 5 / tool 1 / **drop 0** | `evidence/G4-render-draw.md` |
| G5 纹理/转场语料/Live2D/字段/槽 | 22 | ~130 | keep 9 / keep-ratchet 3 / merge 2 / upgrade 8 / **drop 0** | `evidence/G5-texture-l2d.md` |
| G6 存档/槽位/配置/输入/宿主/数据表 | 22 | 160 | keep 12 / keep-ratchet 9 / merge 1 + 8 处 upgrade / **drop 0** | `evidence/G6-save-config.md` |
| G7 音频/台账棘轮/文档模型/工具/调试器自测 | 17 | 57 | keep 8 / keep-ratchet 5 / upgrade 4 / **drop 0** | `evidence/G7-audio-ledger-tooling.md` |

**共同的高价值结论**（值得单独记住）：

- **台账棘轮（`doc-model` / `capability-ledger` / `script-ledger` / `ticket-ledger` / `no-dead-writes` / `registry-tables`）是真实且有牙齿的**：
  `ticket-ledger` 覆盖 121 票 / 785 个锚点；`script-ledger` 在 `src/*.txt` reflow 后**必然变红**（锚点棘轮）。
  这是"文档/数据层不漂移"的机械保障，**不要动**。
- **`text-style-snapshot.test.ts` 不是"存快照比对自己"**：它逐字复刻 raw 79666 的位表达式独立求值、用真机 `SAVE.DAT` 调色板做外部常量表、
  再逐值比对 —— 是**独立 oracle 的模范**。
- **`font-bold-face.test.ts` 的 oracle 完全在 emulator 之外**（解析真实 TTF 的 `name`/`OS/2`/`head`/`glyf`）—— 另一种模范。
- **`op-1d0-page-index.test.ts` 是"诚实披露"的模范**：它显式说明"没有前奏时 `-1/-1` 是**合理**的"（用真 `CONFIG.BIN` 证明），
  而不是把合成前奏伪装成真语料。
- **`engine-field-ids` / `engine-field-store` / `engine-draw-item-decode` 不是"抄 `fields.json` 再自核"的镜像**：
  它们锚在 raw 行号上（子代理逐条复核了 15 个偏移全部命中 raw）。
  ★**推论**：任何"改成从 `fields.json` 派生"的升级会**先制造假红**（`fields.json` 至少有 2 条 offset 与 raw 矛盾，见 §7 待办）。

### 3.1 另一个子工程：`app/amayui-toolkit`（vitest / 5 文件 / 87 例）

结论件见 `evidence/toolkit-vitest.md`。要点：

- **没有三类假绿**：5 个文件里 `console.|it.skip|it.todo|async|await|only` 零命中，87 个 `it` 每个至少 1 条 `expect`。
- **但同样有同义反复**：`dataset.test.ts:394-399`（`e.addr === addrHex(e.kind,e.id)`，而构造时就写的同一表达式）、
  `useStore.test.ts:65`（`pos` 单调不减，无法构造失败输入）、`search.test.ts:56-63`（同一纯函数调两次 `toEqual`）。
- **有假覆盖**：`search.test.ts:65-70` 的 `idExact` 传的是实体 id（只走 `byId`）⇒ `search.ts` 的 **`byAddr` 分支全测试集永不命中**；把 `byAddr` 改成 `false` 全绿。
- ★**这 87 例不在任何闸门里**：`.github/workflows/deploy-pages.yml` 只跑 `npm run build`，**从不 `npm test`**（已核对 workflow 文件）。
- ★**它依赖未入 git 的衍生物**：`app/amayui-toolkit/.gitignore:2` 忽略 `public/`，`git ls-files app/amayui-toolkit/public` = **0**；
  `package.json` 无 `pretest` ⇒ 全新 clone 上直接 `npm test` 时，读 `metadata.json` 的 3 个文件会在 `beforeAll` 抛 ENOENT。
  ⇒ 这 87 例更像是"**跑过就算成功**"的本地脚本，而不是可复现的回归资产。

---

## 4. 方法论评估：Electron 调试能力改变了什么

### 4.1 现在真正可用的能力（已读源码核对，`T-0114` 第 1/2 步）

```
npm run dbg:srv                                   # adb 式常驻守护进程（TCP 127.0.0.1:39427，默认静音）
node tools/dbg.cjs --ping                         # → pong / game=true
# 只读查询（纯函数、白名单、不 eval）：
node tools/dbg.cjs global 0 [count]               # 解码值 + 原始编码值
node tools/dbg.cjs local 1 | frame [idx|all] | flocal <f> <i> | slot 0x11 | run
# 断点：
node tools/dbg.cjs 'b global 0x11 == 5260'                    # 条件断点（每条指令前求值）
node tools/dbg.cjs 'b event global-int-write idx == 3318'     # 事件断点（改状态那一刻停）
node tools/dbg.cjs 'b event slot-bind slot == 0x11 && imgid == 0x5260'
node tools/dbg.cjs bl / c / d 1
# ★远程驱动输入（主进程 sendInputEvent，不需要人坐在窗口前）：
node tools/dbg.cjs click <x> <y> | clickn <x> <y> <次> <间隔> | clickimg <x> <y> | move <x> <y>
node tools/dbg.cjs shot <名字>                    # 远程截图 → .tmp/dbg-<名字>.png
```

另有：`record` / `replay`（G3 逐帧 digest）、`scenario`、`shot`、`report`、`op:inventory`、`diag:text`、`save:dump`。

### 4.2 它**不能**替代什么（三条硬理由，都有源码依据）

1. **查询面只到 VM 的池**：`debugQuery` 支持 `global/local/frame/flocal/slot/run`（`src/vm/debugQuery.ts:95-224`），
   **查不到场景/宿主侧**（`scene.drawItems` / `mesh` / `slotImgid` / `l2dNodes` / `loadHold`），
   而 G6 一半断言、G4 大量断言恰好在那。
2. **事件面只有 4 种**：`DebugEventKind` = `global-int-write` / `global-float-write` / `global-str-write` / `slot-bind`
   （`src/vm/engine.ts:144-148`），**不覆盖 local 槽写入、不覆盖 `engineValues`（引擎字段）写入**。
3. **它是"现场"不是"回归"**：需要 Electron 窗口、要跑到那个点（冷启动到 ADV 类路径要几分钟），
   且**单会话做不了**跨实例判据（"两个干净 Engine 交叉验证"/"A-B 画面一致"）。⇒ **天生进不了 CI**。

★另有两处**工具自身**的限制/缺陷（本次审计新发现，值得单列）：
- `dbg slot <n>` 只读 **VM 台账** `engine.texSlots`，**宿主侧 `TextureCache` 状态不可观测**（`debugQuery.ts:207-219` 自认）；
- **命令表三分裂 + `parseDebugCommand` 死代码 + 面板帮助文本非法**（见 D3）——**新能力本身没有被测试守住**。

### 4.3 它**应该**怎么用：oracle 工厂 + automated E4 闸门

**原则**：调试器回答"**现在**是什么"，测试回答"**永远**必须是什么"。
正确工作流是 **① 用 `dbg` 在现场取证一次 ⇒ ② 把期望值冻进断言**，而不是"把调试器当测试"。

| 用法 | 具体做法 | 替换掉什么 |
|---|---|---|
| **oracle 工厂** | 遇到"这个值应该是多少"时，用 `b event` + `global/slot/frame` 在真运行里读一次，然后把它写成**常量断言**（E3/E2） | 现在靠"读脚本猜期望值"的那批（G1 的 `pivotRel` 读数、G3 的 `advReturn` 4 组） |
| **automated E4** | 起 `dbg:srv` ⇒ `click/clickn/clickimg` 走 TITLE→Load Data→点槽→确认 ⇒ 查询断言 ⇒ `shot` ⇒ 脚本自己打 `E4 OK/FAIL` | `T-0051` 的 5 项人工 E4；`T-0114` 未做的 E4；`T-0067`/`T-0102` 的现场复现 |
| **判据用不变量，不用金图像** | "槽 17 的 imgid 仍是 0x5260"、"第 N 帧 `gates.waitFlags` 的位数"、"截图里白块占比 < ε"、".STH 非全黑且 320×180" | 脆弱的像素比对（`debugsrv.cjs:44-49` 自陈坐标常数跨机失配） |
| **打通已有但没接的 E4 通道** | `src/frame/digest.ts:107` 的 `scSnapshot(scene, nowMs)` **没传第三个参数 `l2d`**（`snapshot.ts:369` 的签名有），`DigestEngine` 也没有 l2d 字段 ⇒ **已跑通的 record/replay 对 Live2D 一字节未比**；补两行即可把 3 条 L2D 用例抬到 E4 | L2D 现在只能靠静态截图（"证明不了动作在动"） |

### 4.4 建议的档位设计（可落地）

| 档 | 命令 | 内容 | 目标 | 何时跑 |
|---|---|---|---|---|
| **T0 默认** | `npm test` | 合成指令 E2 + 纯函数 + 台账棘轮 + 工具自检 | **≤20 s** | 每次改动 |
| **T1 语料** | `npm run test:corpus` | 27 个 import 真 BIN/资源根的用例；**每文件内模块级共享一次链路**；E4 闸门改"base+overlay 两侧都看" | ≤60 s | pre-commit、改 `src/vm`/`src/renderer` 时 |
| **T2 真机** | `npm run e4` | `dbg:srv` 驱动的脚本化 E4（不变量断言 + `shot`） | 分钟级 | 改 `electron/`/`src/frame/`/`src/renderer/`、发版前 |
| **T3 变异** | `npm run mutate` | 一份"引擎语义破坏"清单（12~20 条），每条要求 **≥1 红**；**零红 = 覆盖空洞 ⇒ 开票** | 分钟级 | 每轮清理/重构后、新增一批断言后 |

★**T1 不许降判据**：分档只改变"什么时候跑"，**不改变期望值**。任何"把 E3 断言降成 E1/E2 充数"的做法都是本票明确禁止的
（沿用 `T-0115` acceptance 的同一句纪律）。
★**T0 的 20 s 目标**靠"把最贵的 4 个文件移出默认档" + "文件内共享链路"达成，不靠删断言。
实测依据：`config1-chain` 单文件 **59.2 s** 里的 8 条全链路只差尾部注入（`src/tools/config1Chain.ts:740-790`），
可改成"跑完 `previewProbe` 后逐变体 `快照 → 注入 → 走尾段 → 采样 → 还原`"，**判据一字不改**；
`adv-name-color-chain` 的 3 次 `runConfig1Chain` 里有 2 次 opts 完全相同 ⇒ 加模块级 memo（照 `config1-chain.test.ts:27-28` 的 `cached ??=`）即可 21.9 s → ≈13.6 s。

---

## 5. 变异实测（客观证据）

**方法**：逐个把**一处引擎语义**改坏（只改一处、可精确还原），跑**全量** 1078 个用例，
记录红了多少、**哪些文件**红。**零红 = 覆盖空洞**。逐条结果见 `evidence/mutation-campaign.md`。

| 变异 | 目标语义 | 真 fail | 抓到它的文件 | 判定 |
|---|---|---|---|---|
| `bits.ts` 去混淆旋转 11→12 | int 池读写（最广） | **204** | **61 个文件** | 全仓级守卫 ✅ |
| `msgwin.ts` 取色少翻字节序 | T-0102 判据 4 | 5 | text-style-snapshot ×4、adv-name-color-chain ×1 | 3 处（含 E3）✅ |
| `textureCache.ts` 清槽连 `#slotImgid` 一起清 | T-0102 白底根因 | 1 | clear-slot-records-keeps-bindings | **单点** ✅ |
| `layout.ts` 丢掉行间距 | T-0038 行距 | 2 | text-layout | **单点** ✅ |
| `engine.ts` 等待泵改用手持态刷子 | T-0027 | 2 | adv-msgwin ×2 | **单点** ✅ |
| `input.ts` 键盘按下沿少并 bit | 键盘掩码 | 1 | keyboard-mask | **单点** ✅ |
| **`presenter.ts` 排序方向反转** | **z 序** | **0** | —— | ★★**零覆盖 Z1** |
| `deform.ts` 网格行列互换 | Live2D 几何 | 1 | live2d-deform | **单点** ✅ |
| `audioEngine.ts` BGM 文件名 +1 | 曲号→文件名 | 6 | audio-engine ×3、audio-bgm-naming ×2、audio-node-host ×1 | 3 文件 ✅ |
| **`snapshot.ts` drawable 恒空** | 快照计数 | **0** | —— | ★★**零覆盖 Z2** |
| `crc32.ts` 查表移位 25→24 | CRC32(MSB) | 3 | engine-slot、gallery-bgm-list、keyboard-scenario-menu | 3 文件 ✅ |
| **`control/control.ts` opHex 去前导零** | 面板防混读 | **0** | —— | ★★**零覆盖 Z3** |

> 表里"真 fail"已扣掉一个**恒定伪影**：变异跑之前我新建了 7 张票但没重跑 `build-tickets.mjs`，
> 于是 `ticket-ledger.test.ts` 的"看板与真源同步"**在变异开始前就已经红着**，每条变异都 +1。
> 这个伪影已剔除，理由与原始 TAP 见 `evidence/mutation-campaign.md` §0。（事后已重建看板，`ticket-ledger` 6/6 绿。）

**实测结论**：

- **正面**：套件整体接线正常 —— 一处广域语义改坏能让 **204 条**用例红、**61 个文件**抓到；不是"集体永绿"。
- **冗余度**：多数语义是**单点守卫**（只有 1 个文件能发现），且只有 4 处变异被 ≥3 个文件抓到。
  ⇒ 与"删掉重复覆盖不损失检出"**不矛盾**：能删的是**同一不变量的第 2、3 份**，不是"每个不变量只有一份"这件事本身。
- **空洞**：3 处零覆盖（Z1/Z2/Z3），**其中 Z1 是静态读码没发现的**；另有 2 条静态审计结论被变异**修正**（见 `evidence/verification-log.md` §B）。
- **成本**：12 条 × ~1.5 min ≈ **20 min**，完全离线（不需要 Electron、不需要人）⇒ 适合作为"清理/重构之后"的常规档（`T-0126` 的 `npm run mutate`）。

---

## 6. 建议的后续动作（已开票）

| 票 | 内容 | 优先级 |
|---|---|---|
| `T-0125` | 清理无判别力断言：5 处假绿（改 `t.skip()`）+ ~10 处恒真 + 1 处**错 oracle**（`engine-config.test.ts:160`）+ 判据钉错地方的那批；**每条带反例实验** | P1 |
| `T-0126` | 方法论落地：`T0/T1/T2/T3` 四档 + `tsconfig.test.json` 挂进 typecheck（D1）+ 逐文件共享链路（`T-0115` 的收敛） | P1 |
| `T-0127` | 调试能力自身：命令表单源化（D3，消灭 3 份拷贝与面板非法帮助）+ `DebugEventKind` 扩 `engine-field-write`/`local-int-write` + `debugQuery` 加宿主侧槽表/`l2d` | P1 |
| `T-0128` | E4 闸门统一到"base+overlay 两侧都看"（D2，9 处静默跳过）+ `src/frame/digest.ts` 把 l2d 接进 replay | P1 |
| `T-0129` | 重复覆盖去重（`adv-msgwin` 路由组 → `route-dispatch`、存档族 10→7、`option-font-speed-menu` 拆分、注册表棘轮合并成一张表） | P2 |
| `T-0131` | `app/amayui-toolkit` 的 87 个 vitest 用例：接进闸门 + 消 `metadata.json` 未入 git 依赖 + 修 3 处恒真/假覆盖 | P2 |
| `T-0130` | 台账 `guards` 加**内容锚点**（`test/x.test.ts#用例名`）：现在只查文件存在，139 条能力 / 92 条 guard / 仅 54 个文件，`adv-msgwin` 一家给 11 条当守卫 | P2 |

## 7. 本次顺带发现（不属本票范围，但别丢）

1. ★**`analysis/fields.json` 两条 offset 与 raw 矛盾**（子代理只读发现，主 agent 未复核）：
   `frame_tick_lock 0x68F70(=429936)` vs 其 `meaning`/raw 的 **429752**(=107438×4)；`frame_count 0x68F74` vs **429756**；
   raw 里 `grep -c 429936` = **0**。⇒ 建议单独开票（**在修它之前，不要**把 `engine-field-*` 测试改成"从 `fields.json` 派生"）。
2. `analysis/engine-capabilities.json` 的自报证据等级有 3 处与守卫不符：`texture-bind-async-stale-writeback` 自报 **E3** 但守卫是纯合成（应为 E2）；
   `live2d-enabled-config-flag` 的 guard 为空而 `live2d-enabled-flag.test.ts` 实际守着它（孤儿）；`live2d-mesh-batches` 顶层有个 validator 不读的 `"evidence":"E4"` 死数据。
3. **`gallery-bgm-list.test.ts:190-215` 用裸 `return` 静默跳过**（同 §2 形态①，但该处是真语料闸门）——与 `music-table.test.ts:160` 的 `{skip:!hasCorpus}` 写法不一致。
4. `config-version-substr.test.ts:62-68` 的自造 `effectiveIniText()` **与产品同名但语义不同**（只读 base 的 `SYS4REG.INI`，产品是 overlay 优先）。
5. `slot-load-l2d-reset.test.ts:19-27` 留着一段**已失效的历史注释**（T-0089 后环已消）。

---

## 8. 后续：分类/组织法已落地（2026-09-23，见 `T-0126` 第 1 次变更）

本审计给出的"要改测试方法"三条（分档 / 调试器定位 / 变异闸门）里，**分档已经落地成一套组织法**，
不再是一次性的清理，而是**会自己红的分类**：

- **设计全文**：`docs-new/04-app/test-organization.md`
- **规则唯一实现**：`test/orgRules.ts`（执行端 `test/run.ts` 与守卫 `test/organization.test.ts` 共用）
- **分类写在每个测试文件的首行**：`/** @tier T? @kind ? @subsystem ? */`（159 个文件各加 2 行，行号漂移 ≤2）
- **三条硬规则**：R1 声明齐全 / **R2 档位诚实（双向机械判据）** / **R3 不许零断言空跑**（审计形态① 的防复发棘轮）

| 口径 | 用例 | 墙钟 |
|---|---|---|
| 旧 `npm test`（无档位） | 1078 | 108.0 s |
| **新 `npm test`（T0 日常档）** | 796（120 文件） | **5.8 s** |
| `npm run test:corpus`（T1 真资产档） | 289（40 文件） | 41.9 s |
| `npm run test:all`（= 旧口径，`verify` 用它） | **1085** | 44.7 s |

★**"不移动文件"这个决定本身是本审计 §0.2 那条纪律的延伸**：实测移动 40 个 T1 文件会打断 **924 处**
跨台账/文档引用（183 处在 `analysis/engine-capabilities.json` 这类机器真源里）。分类必须**可机械校验**，
而机械校验不依赖目录位置 ⇒ 用文件头声明 + 规则，而不是搬家。

★本轮同时把审计形态①（5 处零断言假绿）**修掉**并上了棘轮；顺带用 `tsconfig.test.json` 量出
D1 的真实规模：**131 个类型错误 / 60 个文件**（不是"17 个守卫文件不受检查"那么轻）——已作为 `T-0126` 的剩余验收。
