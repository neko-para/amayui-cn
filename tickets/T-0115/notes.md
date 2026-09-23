# T-0115 · verify 太慢 —— 进展与决策记录

## 2026-09-23：候选②（分档）已落地，判据与执行入口见 `docs-new/04-app/test-organization.md`

**做了什么**（由「测试分类/组织」这轮工作一并交付）：

- `npm test` 从"跑全部"改为**只跑 T0 默认档**（120 个文件，纯合成/纯函数/棘轮）；
- 新增 `npm run test:corpus`（40 个文件，需未入库的真游戏资源）、`npm run test:all`（全部）；
- `npm run verify` 的判据**不变**：改调 `test:all`（即仍是全量口径），只是把"日常迭代"与"提交前"分开；
- 档位不是手写清单：由每个测试文件首行的 `/** @tier … */` 声明 + `test/orgRules.ts` 的机械规则决定，
  并有守卫 `test/orgRules.ts` / `test/organization.test.ts` 复核（含"T0 不得依赖未入库资源"）。

**实测数字**（本机，2026-09-23）：

| 口径 | 结果 |
|---|---|
| 旧 `npm test`（全量 159 文件） | 108.0 s（另一次负载下 66.6 s） |
| 逐文件单跑串行合计 | 245.9 s（`tickets/T-0124/evidence/test-cost.tsv`） |
| 最贵的 12 个文件 | 合计 180 s = 串行总成本的 **73%**，全部落在 T1 |
| 新 `npm test`（T0，120 文件） | 见 `tickets/T-0124/evidence/`（本轮实测） |
| 新 `npm run test:corpus`（T1，40 文件） | 同上 |

**仍未做**（候选①与③，留给 T-0126）：

- **候选① 共享 fixture**：`config1-chain.test.ts` 内部 8 条全链路只差尾部注入，可改成"变体数组"
  （跑完 `previewProbe` 后逐变体 `快照 → 注入 → 走尾段 → 采样 → 还原`），**判据一字不改**；
  `adv-name-color-chain.test.ts` 的 3 次 `runConfig1Chain` 有 2 次 opts 完全相同 ⇒ 加模块级 memo。
- **候选③ 减少重复链路**：`scene-report` / `text-style-snapshot` / `mesh-vertex-quad` 各自重跑真链路，
  与 `config1-chain` 的启动段重叠。

**retarget 申报**：本票 evidence 里锚在 `package.json` 的那条锚点，因 `verify` 行改为
`npm run typecheck && npm run test:all && npm run check:dead-writes` 而**旧串消失** ⇒ 已按纪律
retarget 到同义新串（不是删证据、不是降状态）。

## 2026-09-23（续）：候选①／③ 落地 —— T1 成本 41.9 s → 22.2 s

分档只解决了"日常别跑慢档"，**没有**解决"慢档本身为什么慢"。这一步解决后者：

| 改动 | 手段 | 实测 |
|---|---|---|
| `config1-chain.test.ts`（9 次 CONFIG1 全链路串在一个进程里） | **拆成 5 个文件** ⇒ node:test 按文件分进程并行。CPU 总工作量一字不变（还是 9 次 boot），墙钟从"九次相加"变成"最慢那一组" | **59.2 s → 15.2 s** |
| `adv-name-color-chain.test.ts`（3 次链路，其中 2 次 opts 完全相同） | **按键 memo**（`JSON.stringify(opts)` 当键；失败即逐出，避免把偶发失败永久缓存） | **21.9 s → 7.9 s** |
| T1 档整体 | 上述两项 | **41.9 s → 22.2 s** |
| `npm run verify` 全流程 | 上述 + 闸门 D | **51.4 s → 31.3 s** |

★**判据一字未改**（只搬位置 / 只加缓存，不改任何期望值）—— 这是 T-0115 acceptance 里"不得降低判据"的直接兑现。

★**想再往下压的唯一路径**：把 9 次链路收敛成"共享一次 boot + 逐变体重放尾段" —— 但那需要
**引擎态快照/回灌**，也就是 `T-0122`（调试器第 3 步）的能力，当前不存在。⇒ 本票剩下的空间**依赖 T-0122**。
