# T-0126 · 变更记录

## 第 1 次变更（2026-09-23）：测试分类/组织法落地 —— 三轴 + 文件头声明 + 机械棘轮

**这一轮做的是"分档 + test/ 类型检查 + 组织法"**（本票的 ①③⑥⑦ 项），并把 ② 的 `mutate` 与 ④ 的
"T1 内部共享链路"留给后续（见文末"仍未做"）。

### 1. 设计与理由（全文 `docs-new/04-app/test-organization.md`）

- **方案选择有实测依据**：移动 T1 文件会打断跨台账引用 —— 40 个 T1 文件名在仓库里被引用 **924 次**
  （其中 `analysis/engine-capabilities.json` 183 次、`analysis/opcodes.json` 81 次、`analysis/scripts.json` 65 次）。
  ⇒ 否决"A 按档位分目录""B 按子系统分目录"，取 **C：位置不动 + 文件头声明 + 机械规则**。
- **三个轴**：`tier`（什么时候必须跑）/ `kind`（红了意味着什么）/ `subsystem`（去哪找）。
  `evidence` **故意不记**（它按"引擎能力"活在 `analysis/engine-capabilities.json`，再记一份就是第二真源）。

### 2. 落地物

| 物 | 说明 |
|---|---|
| `test/orgRules.ts` | **规则唯一实现**：`readPragma` / `corpusEvidence` / `silentSkipReturns` / `scanTests` / `checkOrganization` / `groupByAxis` |
| `test/run.ts` | 执行入口：`fast` / `corpus` / `e4` / `all` / `list` / `check`（跨平台，不用 shell glob） |
| `test/organization.test.ts` | 守卫（7 例）：R1 声明齐全 + **R2 档位诚实（双向）** + **R3 不许零断言空跑**（自带判别力自检）+ 轴白名单 + 分布合理性 + 与审计结论一致 |
| 159 个测试文件 | 各加 **2 行**（`/** @tier … @kind … @subsystem … */` + 空行）⇒ 行号漂移 ≤2，不破坏既有 evidence 锚点 |
| `tsconfig.test.json` | `test/**` 纳入类型检查（`rootDir: "."`、`noEmit`） |
| `package.json` | `test`=T0；新增 `test:corpus` / `test:e4` / `test:all` / `test:list` / `test:org` / `typecheck:test`；`verify` 改调 **`test:all`** |

### 3. 修掉的假绿（审计形态①）

5 处 `console.warn('[skip]…'); return;`（**node:test 会记 pass，零断言**）改成 `t.skip()`：
`test/live2d-moc.test.ts`（3 处）+ `test/live2d-deform.test.ts`（2 处）。R3 棘轮防复发。

★**retarget 申报**：
- `tickets/T-0115` 的 `package.json` 证据锚点（旧 `verify` 行）因 `verify` 改调 `test:all` 而消失 ⇒ 已 retarget 到同义新串；
- `tickets/T-0124` / `T-0125` 里锚在 `console.warn('[skip] 找不到 .MOC 语料目录` 的两条 ⇒ 因**修复**而消失 ⇒ retarget 到 `t.skip('找不到 .MOC 语料目录`。
（都不是删证据、不是降状态。）

### 4. 实测数字（本机 2026-09-23，空闲机）

| 口径 | 文件 | 用例 | 墙钟 |
|---|---|---|---|
| 旧 `npm test`（无档位） | 159 | 1078 | 108.0 s（同轮有负载）/ 66.6 s（半负载） |
| 逐文件单跑串行合计 | 159 | 1078 | 245.9 s |
| **新 `npm test`（T0）** | 120 | 796 | **5.8 s** |
| 新 `npm run test:corpus`（T1） | 40 | 289 | 41.9 s |
| 新 `npm run test:all` | 160 | **1085** | 44.7 s |

- 用例 **1078 → 1085**（只增：+7 是 `organization.test.ts`）；skip **12 → 12**（分档没丢覆盖）；fail **0**。
- `npm run typecheck`（原三套）exit 0；`check:dead-writes` 0；四份台账 `--validate` 全绿。

### 5. 顺带暴露的一条更大的债（本票 ① 的真实规模）

`tsconfig.test.json` 一挂上就报出 **131 个类型错误 / 60 个文件** —— 远不止"17 个守卫文件不受检查"：

| 错误码 | 数量 | 形态 |
|---|---|---|
| TS2739 | 37 | 手搓 `ScriptBinary` 夹具缺 `ipTables`/`dwordToInstr`（同一形状） |
| TS2532 / TS18048 | 38 | `noUncheckedIndexedAccess` 下的"possibly undefined" |
| TS2741 | 14 | 夹具缺字段（如 `antiAlias`） |
| TS2345 / TS2339 / TS2322 | 27 | 参数/属性/赋值 |
| TS2440 | 4 | **导入与本地声明冲突**（正是 G7 报的 `instr` 重声明那一类） |
| 其它 | 15 | TS7006/7016/2554/7031/2722/2552/2358 |

### 5.1 闸门 D：把这 131 条变成"只许收敛"的基线棘轮（**已挂进 `verify`**）

直接挂 `typecheck:test` 会让 `verify` 当场红；放着不管又等于没接线。⇒ 照本项目**闸门 C（死写）**的成例做
**基线棘轮**：

- `test-typecheck.baseline.json`：`id → 出现次数`（`id = 文件|TS码|归一化消息`，**不含行号** ⇒ 在错误上方编辑不会引起无谓漂移）；
- `src/tools/typecheckTestBaseline.ts` + `npm run check:typecheck-test`：
  **新增**（含"同 id 次数变多"）⇒ 红；**减少**⇒ 提示 `--recount` 收缩基线（棘轮只许收紧）；
- 已挂进 `verify`：`typecheck && check:typecheck-test && test:all && check:dead-writes`。

★**判别力自检（实测做过）**：往 `test/abort.test.ts` 尾部注入
`const __gateD_probe: number = "not a number";` ⇒ `✗ 新增 1 条 … TS2322: Type 'string' is not assignable to type 'number'.`；
还原后 ⇒ `✅ 无新增类型错误`。基线本身（131 条 / 84 个唯一 id）也已核对。

⇒ 结论：**"测试代码的类型正确性"从今天起不再变坏**，而 131 条债变成一张只会变短的清单（清空即可把
`typecheck:test` 直接挂上）。

---

## 仍未做（本票剩余范围）

1. **还清 131 条类型债 → 把 `typecheck:test` 直接挂进 `verify`**（闸门 D 会自动提示收缩基线；
   建议先抽一个共享的 `mkScript()` 夹具解决 37+14 处，再逐文件处理 `noUncheckedIndexedAccess` 38 处）。
2. **T1 内部共享链路**（原候选①/③）：`config1-chain.test.ts` 的 8 条全链路改成"变体数组"
   （跑完 `previewProbe` 后逐变体 `快照 → 注入 → 走尾段 → 采样 → 还原`，**判据一字不改**）；
   `adv-name-color-chain.test.ts` 加模块级 memo（3 次链路有 2 次 opts 相同）。
   目标：T1 从 41.9 s 压到 ~20 s。
3. **T3 变异闸门** `npm run mutate`：把 `tickets/T-0124/evidence/mutation-campaign.md` 的 12 条改动做成可复跑的清单
   （每条要求 ≥1 红；零红 = 覆盖空洞）。
4. **T2 档从 0 起步**：真机（E4）目前由工具链承担，等 `T-0128` 把 `dbg:srv` 驱动脚本化后，T2 档才会有测试文件
   （`test/e4` 的选档逻辑已就位，现在选出来是 0 个文件）。

---

## 第 2 次变更（2026-09-23）：闸门 D / E 落地 + T1 拆进程并行

### 1. 闸门 D（`test/` 的类型债）—— **已挂进 `verify`**

131 条既有类型错误登记进 `test-typecheck.baseline.json`（`id → 次数`，**不含行号**），
工具 `src/tools/typecheckTestBaseline.ts` + `npm run check:typecheck-test`：

- **新增**（含"同 id 次数变多"）⇒ **红**；**减少** ⇒ 提示 `--recount` 收缩（棘轮只许收紧）；
- `verify` = `typecheck && check:typecheck-test && test:all && check:dead-writes`；
- **判别力实测**：注入 `const p: number = "x"` ⇒ `✗ 新增 1 条 … TS2322`；还原 ⇒ 绿。
  ★并且它在**本次改动中真的抓到过一次**：`op-d0` 复制夹具缺 `ipTables` ⇒ 当场红，遂改为复用 `run()` 夹具。

### 2. 闸门 E（变异闸门）—— `npm run mutate`

清单 `test/mutations.json`（13 条），判据：`expectCatch` 非空 ⇒ 跑那组文件**至少 1 红**（全绿 = 守卫丢了）；
`knownGap` ⇒ 只登记并在被覆盖后提醒翻牌；每条**自动还原并逐字节核对**。

实测：**caught 12 / known-gap 1（`M13`→`T-0127`）**，`✅ 闸门 E 通过`，**55.6 s**（定向子集）。
`--all` 是发现模式。★顺带修掉一个坑：裸 `node --test` 会把 `test/` 下的**基础设施**（`orgRules.ts`/`run.ts`…）
当测试跑（默认发现给出 1092 ≠ 1086）⇒ 闸门**永远显式列文件**。

### 3. T1 成本：`config1-chain` 拆成 5 个文件并行（**判据一字不改**）

`config1-chain.test.ts` 原来在一个进程里**串行**跑 9 次 CONFIG1 全链路（单文件 59.2 s）。
9 个变体的注入各不相同 ⇒ **没有可 memo 的共享状态**；但 node:test 按文件分进程 ⇒ 拆开即可并行：

| 文件 | 全链路次数 |
|---|---|
| `config1-chain.test.ts`（8 条共享 `chain()`） | 1 |
| `config1-chain-fontpicker-scroll.test.ts` | 2 |
| `config1-chain-advreturn.test.ts` | 2 |
| `config1-chain-advreturn-seed.test.ts` | 3 |
| `config1-chain-advreturn-real.test.ts` | 1 |

实测 **59.2 s → 15.2 s**（5 文件并行）；**T1 档 41.9 s → 22.2 s**；`verify` **51.4 s → 31.3 s**。
另给 `adv-name-color-chain.test.ts` 加**按键 memo**（3 次链路有 2 次 opts 相同）：**21.9 s → 7.9 s**。

★**retarget 申报**：`T-0102`/`T-0115`/`T-0124`/`T-0126` 四张票的 evidence 锚在
`test/config1-chain.test.ts` 的 `★T-0102 判决实验` —— 该用例随拆分迁到
`test/config1-chain-advreturn-seed.test.ts` ⇒ 按纪律 **retarget 到新文件**（断言未改，不是删证据）。

### 4. 最终数字（2026-09-23 本机）

| 口径 | 文件 | 用例 | 墙钟 |
|---|---|---|---|
| 旧 `npm test`（无档位） | 159 | 1078 | 108.0 s（同轮有负载）/ 66.6 s（半空闲） |
| **新 `npm test`（T0）** | 121 | 797 | **5.8 s** |
| `npm run test:corpus`（T1） | 44 | 289 | **22.2 s** |
| **`npm run verify`（typecheck + D + test:all + 死写）** | 165 | **1086** | **31.3 s** |

---

## 第 3 次变更（2026-09-23）：`test/` 类型债 **131 → 0**，闸门 D 从「基线棘轮」变成「零容忍」

收尾的是验收里的**剩余①**：`tsconfig.test.json` 已挂进 `verify`，但用的是"基线棘轮"
（`check:typecheck-test` + `test-typecheck.baseline.json`：131 条既有债登记在案，新增即红）。
基线归零后棘轮就该退场 —— 留着它，`--recount` 只剩一个用途：**把新错误登记成合法**。
⇒ 债还清、基线文件与工具**一并删除**，`verify` 直接跑 `typecheck:test`。

### 1. 数字

| 口径 | 改前 | 改后 |
|---|---|---|
| `npm run typecheck:test` 错误 | **131**（60 个文件 / 84 个 `id`） | **0** |
| `npm run verify` | `typecheck && check:typecheck-test && test:all && check:dead-writes` | `typecheck && typecheck:test && test:all && check:dead-writes` |
| `npm run test:all` | 1086 例 | **1088 例**（1086 pass / 0 fail / 2 skip），墙钟 ~35 s |

### 2. 分类处置（**没有一条是把类型放松**）

| 类别 | 条数 | 处置 |
|---|---|---|
| TS2739 37 + TS2741 14 | **51** | 手搓 `ScriptBinary` / `BinArg` fixture 缺派生字段 ⇒ 新增 `test/harness.ts` 的 **`scriptDerived()`**（`ipTables` / `dwordToInstr`），41 个文件、47 处字面量在**开头**展开它（后面的显式字段自然覆盖）。★这两个字段是 `parseScript()` 从 `raw` 反推出来的、**VM 真读**（`engineSlot.ts:577` 直接索引 `ipTables[2]`）⇒ **不许**改成可选来图省事；空表与原状在语义上等价（产品路径多处本来就是 `?.` / `?? []`），所以这是**行为保持**的补全。`native-host` 那条补 `ipTables`、`exit-script` 那条补 `BinArg` 形状 |
| `noUncheckedIndexedAccess` 38（TS2532 24 + TS18048 14） | 38 | 新增 **`at(xs, i, what)` / `must(v, what)`**（`test/harness.ts`）：越界即抛，失败信息带**下标与长度**。★不用 `!`（把"我确信"写成编译器无法复核的谎话）、也不用 `?? 0`（元素真缺失时会跑出一个看似正常的断言结果 —— 例如 `undefined >= 1` = false 被当成"确实没有已核验能力"）。`text-layout`（27 条）原来自己写了一份 `at`，一并改用共享的那个 |
| TS2440 4 | 4 | `gallery-bgm-list` / `game-start-chain` / `op-1cb-2c8-2c9` / `option-font-speed-menu` 各有一份**逐字相同**的本地 `instr`（又与 `harness.instr` 逐字相同）⇒ 删本地定义、改用 harness 那份。★这正是 T-0124 D1 点名的形态（`gallery-bgm-list` 那条在 Node 原生 ESM 下是加载期 SyntaxError，此前靠 esbuild 消除未用导入侥幸没炸） |
| 类型本身就写错了 | ~20 | `Ticket.history[].kind` / `doneWhy` 缺字段（台账真源 403 条 history **全都有** `kind`）；`GameStartOptions.emulatorOptions` 收的是**已归一化**的 `EmulatorOptions`，而内部本来就 `normalizeEmulatorOptions()` ⇒ 放宽为 `EmulatorOptionsInput`；`SlotStateBlock.adv` 是 `unknown`（分层刻意）⇒ 断言侧按 `AdvStateJson` 断言；`scripts/agf/format.d.ts` 补最小声明（跨目录 import 的唯一出口）；`save-thumb` 的 `async (slot) =>` 因整体 `as unknown as FileSource` 丢了上下文类型 ⇒ 显式标注 |
| 恒真断言 | 1 | `op-02`：`assert.equal(thrown, null)`（`node:assert/strict`）之后的 `!(thrown instanceof ExitScript)` **永远不可能失败** ⇒ 删除并把口径写进注释（T-0125 的清理规则） |
| 回调返回类型 | 6 | `onFrameEnd: () => (box.clock += …)` / `onStep: () => arr.push(…)` 返回 `number`，而契约是 `void | Promise<void>`（★这不是 `void` 那个"返回值可忽略"的例外，因为是联合类型）⇒ 加花括号 |

### 3. 判别力证据

- 每次改动跑 **`npm run typecheck:test` + `npm test`**：全程 0 失败，逐类递减 131 → 69 → 56 → 51 → 32 → 7 → 0。
- 清空基线后**回归实验**：随便注入一条类型错误 ⇒ `npm run verify` 当场红（`tsc -p tsconfig.test.json --noEmit` 的报错直接就是失败原因），无需棘轮。
- `test/` 的**断言一个没动**（唯一删掉的是上面那条恒真断言）：`test:all` 用例数 1086 → 1088 是**期间其它票**（T-0128 的 l2d digest 守卫等）新增的，不是本轮把断言改松。

### 4. 顺手记下的两条纪律

1. **基线棘轮是"欠债期"的工具，不是常态**：它的存在意义是让"在债里做增量"可判定；债清零后必须**连工具一起删**，
   否则 `--recount` 就是后门。判断标准：**基线为 0 时，棘轮 ⟺ 硬闸门** ⇒ 留硬的那个。
2. **`test/harness.ts` 是纯构造物的落点**：`scriptDerived()` / `at()` / `must()` 都放这里（该文件头写的就是"只放与引擎语义无关、纯构造的东西"）。

---

## 第 4 次变更（2026-09-23，同会话收口）：T2 真机档文件分派 **T-0132**，本票关单

### 1. 为什么不在本票里直接落 T2 文件

| 事实 | 实测 |
|---|---|
| T2 档入口与工具链都已就位 | `npm run test:e4` → `（T2 真机档（需要 Electron）：0 个文件）`；`npm run shot` / `dbg:srv` 可用（Electron 44.2.0、`dist/electron/main.cjs` 已构建、`.tmp/*.png` 有真机产物） |
| ★但口径冲突 | `test/run.ts` 的 `all` = T0+T1+**T2** ⇒ 一旦有 T2 文件，`verify` 就会拉起 Electron：需要 GUI 会话、墙钟 +数十秒 —— 而 **T-0115** 刚把 `verify` 从 51.4 s 收到 **~33 s**（本轮复测 34.6 s） |
| ⇒ 决策 | 这个取舍（T2 进不进 `verify`、`all` 与它自己头注 `all = T0+T1` 哪个为准）是**设计决定**，必须显式写理由 + 给加进去前后的实测数字 ⇒ 落成新票 **T-0132**，本票只负责把"分档/类型检查/闸门"三件交付掉 |

★分派不是把活丢掉：T-0132 的验收里写明了**反例实验**（把日志标记改坏/首帧全黑必须让 T2 红）、**前置探测 + skip 策略**
（缺 Electron/资源/GUI 会话 ⇒ `t.skip()` 而非 fail）、以及**必须给出 verify 口径的前后墙钟数字**。

### 2. 本票最终状态（四项逐条对账）

| # | 验收项 | 状态 | 证据 |
|---|---|---|---|
| 档位 + 组织法 | T0/T1 默认档、`test:list`/`test:org`、三轴 pragma、R1/R2/R3 棘轮 | ✅ | `test/orgRules.ts`、`test/organization.test.ts`；`test:org` = 169 文件 T0 124 / T1 45、0 问题 |
| `test/` 类型检查 | 131 → **0**，闸门 D 从基线棘轮改**零容忍**并进 `verify` | ✅ | 第 3 次变更；`npm run typecheck:test` 0 错误、基线文件与工具已删 |
| 闸门 E（变异） | 15 条变异全部可复跑、每条 ≥1 红 | ✅ | `npm run mutate` → 15/15 caught（本轮复跑同） |
| T2 真机档文件 | 0 → 分派 **T-0132** | ➡️ | 见上表 §1 |

### 3. 本轮复跑的绿线证据（2026-09-23）

| 命令 | 结果 |
|---|---|
| `npm run verify` | **1086 例 / 1084 pass / 0 fail / 2 skip**，墙钟 **34.6 s**（含 4× tsc + `test:all` + 死写棘轮） |
| `npm run test:org` | 文件 169：T0=124 T1=45；kind core=130 tool=14 ratchet=25；**0 条问题** |
| `npm run test:e4` | T2：0 个文件（= T-0132 的起点，已记入该票 evidence） |
| 四份台账 `--validate` | tickets 129→130 / capabilities 139 / scripts 33 / functions+fields（`report.js`）全绿 |
