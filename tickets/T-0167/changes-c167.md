# T-0167 · 能力台账缺口（P2 批次）实施记录 —— `changes-c167.md`

> 范围：审计报告 `docs-new/99-records/2026-09-impl-audit/impl-audit-2026-09.md` 里**属于本票的 P2 六条**
> （工作清单 `app/amayui-emulator/.tmp/p1-fix/p23-worklist2.md` 的 `## T-0167（P2 6 / P3 0）` 节，
> 即 §4.2 #35 / #39 / #44 / #65 与 §4.5 补漏 #16 / #17）。
> P1 批次（15 条）已在同期 `changes.md` 收口，本文件只记本批次。
>
> ★**判绿口径**：`test:all` / `verify` 有 **3 条已知基线红**（票 `T-0146`）⇒ 本批以「**不新增红**」判绿。
> ★**每条动手前回体读一遍**（本轮实测：六条里有 **4 条**报告前提与体/代码不符，逐条记在 §1 与 §6）。

---

## §1 逐条处置表

| # | 报告出处 | capability / kind | 处置 | 引擎锚点（本轮回体核过的） | emulator 落点 / 守卫 |
|---|---|---|---|---|---|
| 1 | §4.2 **#35** | `audio-device-init` / `missing-behavior` | **① 实现 + 命名守卫** | `sub_406CE0` raw **12028-12036**（`sub_4B5CF0 != 1` ⇒ `MessageBoxA` + `_this[174801] &= ~0x1000000` + 可选写回 `sound:Sound = 0` + `_this[5010] = 1`）；失败串 raw **138463**（`sub_4B5CF0` 内） | `src/renderer/audio/webAudioHost.ts` 的**设备创建失败档**；守卫 `test/t0167-audio-device-fail.test.ts`（3 例） |
| 2 | §4.2 **#65** | `scene-render-freeze-46676` / `missing-consumer` | **① 固化 + 命名守卫**（前提被 P1 轮取代，本轮把装配收成单点并钉死） | 判据 raw **123117-123121**；`Scene+46676` 只读（105 读 / 0 写） | 新 `src/renderer/scene/blendEnv.ts` 的 `blendEnvForScene(scene)`（`presenter.ts` 两处调用）；守卫 `test/t0167-blend-env-frozen.test.ts`（2 例） |
| 3 | §4.2 **#39** | `lazy-572b-node-map` / `missing-behavior` | **② 保持 `partial` + 写清 why 与重开条件**（写端在 `src/vm/handlers/**`，本单元禁改） | 写端 = `sub_4AD9A0` 一族成片 `sub_4AAEC0(_this + 270, …)`（raw **132359-133316**）；消费端 = `sub_4B4040`（raw **136741** 起）的 `sub_4535F0(Scene+50704) + sub_4AF560 + sub_4AAEC0(Scene+1080)`（raw **136924-136930**） | 台账 `lazy-572b-node-map` 的 `emulator.note`（why + 重开条件）；现存台账守卫不变 |
| 4 | §4.2 **#44** | `lazy-movie-texture-slot` / `missing-behavior` | **② 保持 `absent`（E0→E1）+ 写清 why 与重开条件**（`0x20F` handler 在 `src/vm/handlers/gfx-misc.ts`；对象表是 VM 侧 `Engine`） | 槽空 ⇒ `operator new(0x480)` + `sub_489040` 存回 `_this[4*v2+378688]`、装载失败抛 `asc_51F560`（raw **31627-31643**）；CTexture 表空 ⇒ 抛 `asc_520248`（raw **31645-31649**） | 台账 `lazy-movie-texture-slot` 的 `emulator.note`（why + 重开条件）；不建假播放器 |
| 5 | §4.5 补漏 **#16** | `cap:frame-render-gate-mainloop` / `missing-branch` | **③ 前提部分被推翻 + ② 剩余缺口登记**（字段**已**建模；真缺的是第二个落点） | 字段写者 = `0x24E` / `sub_4258C0` raw **32965**；读点 raw **13910 / 13923 / 21114 / 26023 / 26090**；真缺口 = `sub_409400`（raw **13823** 起）raw **13923-13929** 的 `result = 0` | 台账 `frame-render-gate-mainloop` 的 `emulator.note`；守卫 `test/t0167-frame-loop-gaps.test.ts`（2 例，含缺口棘轮） |
| 6 | §4.5 补漏 **#17** | `cap:frame-render-gate-mainloop` / `missing-branch` | **③ 前提部分被推翻 + ② 缺口登记**（`429752` 只挡 20838 起） | `429752` 门 = raw **20838**（阶梯/等待段，`sub_453B60(Engine+430096)`）；**不在**门内的 raw **20816-20837**（`effect_flags & 0x200` 的装载端 + `sub_453A60(Engine+430012, 10)` / `sub_489D10(Engine+697816, 10000, 1)`） | 台账同上；`test/t0167-frame-loop-gaps.test.ts` 的缺口锚点断言 |

### 1.1 第 1 条（`audio-device-init`）的具体改法

- 引擎事实：设备建不起来时**不崩**——打串（raw 138463）→ 弹窗 → 清 `effect_flags` bit24 → 玩家点 OK 时写回
  `sound:Sound = 0` → `Engine[5010] = 1`；**此后一切通道调用早退**（静默降级）。
- 修前 emulator：`#ensureCtx()` 直接 `new AudioContext()` / `createContext()`，**不接异常**
  ⇒ 设备不可用时异常从 `play()`/`decode()` 抛进 `AudioEngine` 与帧循环（引擎里不存在的硬失败）。
- 本轮落地（`webAudioHost.ts`）：失败档（`#deviceFailed` / `#deviceError`，`get deviceFailed()` 与 `info()` 可查）
  + 留引擎同文失败串 + `play`/`decode`/`streamUrl`/`playStream` 一律早退（`play` 回 `SilentPlayback` 记账句柄
  ⇒ 引擎侧通道状态机不断）+ 失败档**粘住**（不再重试建设备）。
- 仍缺三件（**都在本单元文件范围外**，写进台账 why）：`MessageBoxA`（无宿主对话框缝）、
  `effect_flags` bit24 的清位（写点在 `src/vm/engine.ts`）、`sound:Sound = 0` 写回（配置层）。

### 1.2 第 2 条（`scene-render-freeze-46676`）的具体改法

- 审计原判：`blend.ts` 的 `sceneFrozen` 只有「声明 + 一个纯函数里的判据 + 一条手搓 `BlendEnv` 的单测」，
  生产侧从不置位 ⇒ 判据恒走 `!undefined` 那一支。P1 轮已把 `presenter.ts` 两处填上 `scene.frozen`。
- 本轮把它**收成单一装配点**：新 `src/renderer/scene/blendEnv.ts` 导出 `blendEnvForScene(scene)`
  （三个字段**全部**来自共享模型），`present()` 与 `renderItemSubset()` 都调它、都不再手写 `BlendEnv`。
- 守卫钉两件事：①`sceneFrozen` 随 `scSetSceneFrozen` 变（并断言判据的可观测后果与反面）；
  ② `presenter.ts` 里不再出现手写的 `sceneFrozen:` / `renderTargetSlot:`，且 `blendEnvForScene(scene)` ≥ 2 处。

---

## §2 红→绿数字（每条守卫都给「先红后绿」）

| 守卫 | 红（怎么造的） | 数字 | 绿 |
|---|---|---|---|
| `test/t0167-audio-device-fail.test.ts` | 直接跑（修前 `#ensureCtx` 不接异常） | **0/3**（3 fail：①`play` 抛出 `no audio device`；②③ `info().deviceFailed` 为 `undefined`） | **3/3** |
| `test/t0167-blend-env-frozen.test.ts` | 临时把 `blendEnvForScene` 里的 `sceneFrozen: scene.frozen` 去掉（= 审计描述的修前状态） | **1/2**（①红：`undefined ≠ true`） | **2/2** |
| `test/t0167-frame-loop-gaps.test.ts` | 临时把 `0x24E` 的 store 目标从 `msgField92340` 换成 `frameCount`（探针后已还原，`git diff --stat` 该文件为空） | **1/2**（①红：`0 !== 500` —— bit1 门失效） | **2/2** |

回归与工具链（本批全部实测）：

| 命令 | 结果 |
|---|---|
| `node --import tsx test/run.ts fast`（含本批 3 个新守卫） | **1232 例 / 1231 过 / 0 红 / 1 skip**，exit 0 |
| `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` | exit 0 |
| `node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit` | exit 0 |
| `node --import tsx src/tools/deadWrites.ts`（`check:dead-writes`） | 基线 13 / 当前 13，★**无新增死写** |
| `test/audio-silent-option` + `audio-engine` + `blend-mode` + `scene-freeze-46676-gate` + 本批 3 守卫 | **59/59** |
| `test/capability-ledger` | **6/6** |
| `test/doc-model` | **10/10** |
| `test/ticket-ledger` | **11/11** |
| `test/organization` + `registry-classification` | 绿（★过程中一度被**别人的在改文件** `test/t0157-frame-loop.test.ts` 的 `@tier T1` 拖红，该文件随后被其 owner 修正 ⇒ 最新一轮绿） |
| `node .agents/skills/amayui-engine-analysis/scripts/capabilities.js --root . --validate` | `[ok] 143 条` |
| `node scripts/build-capabilities.mjs` | `[ok] engine-capabilities.md ← 143 条` |
| `node scripts/build-doc-index.mjs` | `[ok] index.md ← 110 份文档` |
| `test:all`（全量） | 见 §2.1 |

### 2.1 `test:all` 全量（本轮实测，原始日志 `.tmp/t0167-test-all.log`）

- 红集合 = **3 条既有基线**（票 `T-0146`，逐条同名）：`engine-slot`（SAVE70/71 `storedDwords` 超出文件）、
  `save-slot`（真槽 `format`：`0 !== 3`）、`scene-report`（可绘制项 24 ≤ 缺纹理项 26）⇒ **本批新增红 = 0**。
- 数字：**228 文件（T0+T1）/ tests 1575 / pass 1570 / fail 3 / skipped 2**。
  对照 `CONTEXT.md` §6 记的改动前基线（222 文件 / 1544 例 / 3 红）：例数增量里**本批贡献 3 个文件 7 例**
  （3 + 2 + 2），其余是同期其它单元在飞的文件（`T-0157` 等）。

---

## §3 台账改动清单（`analysis/engine-capabilities.json`，6 条）

| id | 改了什么 |
|---|---|
| `audio-device-init` | `emulator.guard` → `test/t0167-audio-device-fail.test.ts#设备创建失败`；`emulator.note` 重写（设备失败档 + 仍缺三件 + 重开条件）；`journal` +1（修前「异常抛进帧循环」的沿革） |
| `scene-render-freeze-46676` | `emulator.guard` → `test/t0167-blend-env-frozen.test.ts#BlendEnv.sceneFrozen`；`emulator.note` 改写（装配单点 `blendEnvForScene` + 两个守卫分工）；`journal` +1（#65 原判的事件） |
| `lazy-572b-node-map` | `emulator.note` 改写：`Scene+1080`（= `_this + 270`）的**写端/消费端 raw** + why（不建半张表）+ 重开条件；`journal` +1 |
| `lazy-movie-texture-slot` | `emulator.evidence` `E0 → E1`；`emulator.note` 重写（体核实的两条抛错分支 + why + 重开条件）；`journal` +1。`status` 保持 `absent` |
| `frame-render-gate-mainloop` | `emulator.note` 追加 §4.5 #16/#17 两条 `missing-branch` 的**核实结论**（字段已建模、`0x24E` 是写者、`429752` 门界）与重开条件；`journal` +1。`status` 保持 `partial` |
| `scene-flag-46528-bits` | `emulator.note` 追加同一 dword 的**唯一写者 `0x24E`（raw 32965）**与全部读点、语料取值 `10000` 的位分解；`journal` +1（原注释「无置位点」失效的沿革落 journal） |

生成物：`docs-new/03-engine/engine-capabilities.md`（143 条，`--validate` 绿、`doc-model` 10/10）、
`docs-new/00-overview/index.md`、`tickets/README.md` 均已重生成。计数未变（`modeled-verified 79 / partial 30 / absent 6 / n-a 24`）。

---

## §4 别人该接（本轮**没做**的，都带重开条件）

1. **`src/vm/engine.ts`（现属 `T-0173`）**：`serviceRevealAdvanceInput` 那条 `DrawMode == 1 ⇒ skipWaitGate()`
   要按体补齐两处 ——
   ① 读 `ENGINE_FIELD.msgField92340`（`Scene+46528`）的 **bit1**（体 raw 13910 / 13923 都是
   `DrawMode == 1 && (369360 & 2) == 0`；语料 `i24e 10001` = `0x2711` 共 **422** 处、bit1 = 0 ⇒ 真机会走到）；
   ② 第二个落点（`Engine[388212]` 支，raw 13923-13929）多出的 **`result = 0`**（「这一帧不算画面推进」）目前没有对应物。
   → 补齐时同步改 `test/t0167-frame-loop-gaps.test.ts` 的缺口棘轮与台账 `frame-render-gate-mainloop`。
2. **`src/frame/loop.ts`（本单元禁改）**：raw **20816-20837** 的 `effect_flags & 0x200` 双计时器
   （装载端 `sub_453A60(Engine+430012, 10)` / `sub_489D10(Engine+697816, 10000, 1)`、刷新端 `sub_453B60`）
   与 raw **20838-20858** 的阶梯/等待段（`sub_453B60(Engine+430096)` + `0x800`/`0x1000` 位）都还没进帧驱动；
   ★注意 **429752 只挡后者**（报告把前者也算进去了）。
3. **`src/vm/handlers/**` + `renderer/pixiBackend.ts`（影片子系统）**：`0x20F` 的 CMovieToTexture 对象表
   （`Engine+4*i+378688`）、槽绑定与 `0x23D` 的整段释放（42..999）—— 需要单独立票（现在是 `absent`，
   台账已写 why 与重开条件）。
4. **`0x240`–`0x24D` 族的精灵/特效节点语义**（572B-A / `Scene+1080`）：把这族读通后才能在
   `scene/state.ts` 建容器、`presenter.ts` 接归并（并把 `render4.entryParams` 迁进去）。
5. **宿主对话框缝**：`MessageBoxA` 类失败提示（`audio-device-init` 的 (a)）在 emulator 无落点；
   要接的话得先有可注入的宿主提示接口（同 `T-0088` 的 AGERC 对话框困境）。
6. **`test/wait-gate-timer.test.ts:247` 与 `src/renderer/scene/ops.ts:909` 的措辞**：两处都写着
   「`46528` 本 exe 无写者/恒 0」—— 与 raw **32965**（`0x24E`）不符。本单元**无权改这两个文件**，
   台账已按体写清（`scene-flag-46528-bits` 的 note）；谁拥有它们请顺手改口径（结论不变：语料 `0x2711` 的 bit1/bit2 恰好都是 0）。

---

## §5 改动文件清单

| 文件 | 规模 | 说明 |
|---|---|---|
| `app/amayui-emulator/src/renderer/audio/webAudioHost.ts` | 修改（+77 / -4） | 设备创建失败档 + `info()` 两个新字段 + `get deviceFailed` + 四处调用点早退 |
| `app/amayui-emulator/src/renderer/scene/blendEnv.ts` | 新增（38 行） | `blendEnvForScene(scene)`：`BlendEnv` 的唯一装配点 |
| `app/amayui-emulator/src/renderer/pixi/presenter.ts` | 修改（-11/+3） | 两处手写 `BlendEnv` → `blendEnvForScene(scene)` + import |
| `app/amayui-emulator/test/t0167-audio-device-fail.test.ts` | 新增（119 行，3 例） | #35 的守卫（T0 / ratchet / audio） |
| `app/amayui-emulator/test/t0167-blend-env-frozen.test.ts` | 新增（75 行，2 例） | #65 的守卫（T0 / ratchet / render） |
| `app/amayui-emulator/test/t0167-frame-loop-gaps.test.ts` | 新增（77 行，2 例） | §4.5 #16/#17 的现场与缺口棘轮（T0 / ratchet / frame） |
| `analysis/engine-capabilities.json` | 修改（6 条，+133/-… diff 行） | 见 §3 |
| `docs-new/03-engine/engine-capabilities.md`、`docs-new/00-overview/index.md`、`tickets/README.md` | 重生成 | `build-capabilities.mjs` / `build-doc-index.mjs` / `build-tickets.mjs` |
| `tickets/T-0167/ticket.json`、`tickets/T-0167/changes-c167.md` | 新增/修改 | 本文件的 `tests[]` / `doneWhy` / `--note` |

未动（硬边界）：`src/vm/engine.ts`、`src/frame/**`、`src/vm/input.ts`、`src/vm/interpreter.ts`、
`src/vm/handlers/{frame,input,stubs,control,msgwin}.ts`、其它 `analysis/*.json`、`CONTEXT.md`、`tickets/T-0167/changes.md`。

---

## §6 附：与报告不符的核实清单（本批 6 条里占 4 条）

| 出处 | 报告说 | 体/代码里是 |
|---|---|---|
| §4.5 #16 | 「emulator 没有这个字段（全 src grep 369360/92340 零命中），raw 13923-13929 那条 `result = 0` 没有对应物」 | 字段**已建模**为 `ENGINE_FIELD.msgField92340`（raw 32965 的 `0x24E` 是写者；`0x243` 已读它的 bit1）；`DrawMode==1 ⇒ skipWaitGate()` 也已在 `src/vm/engine.ts`。真缺 = raw 13923-13929 的 `result = 0` 与那道 bit1 读 |
| §4.5 #17 | 「`_this[429752]` 挡住 raw 20831-20837 与 raw 20838-20858」 | 429752 的门在 raw **20838**（`if (!*(_DWORD*)(_this+429752))`）；raw 20831-20837（`& 0x200` 的刷新）与 20816-20830（装载端）**都不在门内** |
| §4.2 #65 | 「presenter.ts 组 `BlendEnv` 时只填 `renderTargetSlot/slotMode`，`sceneFrozen` 全仓 3 处命中」 | P1 轮已两处填上 `scene.frozen`（`presenter.ts` 的 `present()` 与 `renderItemSubset()`）；本轮收成 `blendEnvForScene` 单点并补守卫 |
| `src/vm/engine.ts:686`、`scene/ops.ts:909`、`test/wait-gate-timer.test.ts:247` | 「`Scene+46528` 该格无置位点 / 恒 0」 | 唯一置位点 = `0x24E`（`sub_4258C0` raw **32965** `_this[92340] = op1`）；语料 `i24e` **422** 处取值全 `10001`（`0x2711` ⇒ bit1/bit2 恰好为 0，所以旧结论的**结果**在语料上仍成立，**理由**不成立） |
| §4.2 #35 | 「emulator … 没有「设备创建失败」这一档」 | ✔ 成立（`#ensureCtx` 直接把异常抛出去）；本轮按体落地该档 |
| §4.2 #39 / #44 | 写端在 opcode 族 / 对象表 | ✔ 成立；本单元两个文件都禁改 ⇒ 如实登记（`partial` / `absent`） |
