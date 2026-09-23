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
