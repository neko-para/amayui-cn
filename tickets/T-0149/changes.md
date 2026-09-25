# T-0149 · changes —— 缺口台账增设可棘轮的 `partial` 处置位

> 结论：**绿**。`analysis/opcode-gaps.json` 新增一等处置位 `partial`（57 条首批 / 133 条 `missing[]`），
> 生成器渲染 §7「部分实现」（按承接票分组），守卫 `test/opcode-gaps.test.ts` 增两条棘轮用例并给出红→绿证据。
> 口径定义见 `notes.md` §1–§2（同文写入真源 `dispositions.partial` 与生成物 §7 头部）。

## 1. 改了什么

| 文件 | 改动 |
|---|---|
| `analysis/opcode-gaps.json` | `_doc` 补 `partial` 说明；`dispositions` 增 `partial`（含 schema 与棘轮说明）；**13 条** `implemented` 改判 `partial`（`note` 保留原文 + 追加改判行）；**44 条**新增 `partial` 条目（`source: "audit-partial"`）；条目 71 → 115 |
| `scripts/build-opcode-gaps.mjs` | `DISPOSITIONS` 增 `partial`；`partial` 的 schema 校验（`missing[]` 非空 + `what`/`ticket`/`raw` 三条规则 + 票号目录真实存在 + `partial` 必须已注册；**反向**：非 `partial` 带 `missing[]` 即 problem）；`report.partial`；渲染 **§7 部分实现**（按 `missing[].ticket` 分组，一条缺口一行）；§1 结论速览补 partial 行；头部纪律补「注册了没有 ≠ 做全了没有」 |
| `app/amayui-emulator/test/opcode-gaps.test.ts` | 新增两条用例：`★缺口台账 \`partial\` 棘轮：missing[] 必须齐备、票号真实存在、raw 合法` 与 `★缺口台账 \`partial\`：md §7 的每条 missing 都进了生成物`；`GapEntry` 接口补 `missing?` |
| `docs-new/03-engine/opcode-gaps.md` | 生成物重跑（新增 §7，317 行） |
| `tickets/T-0149/notes.md` / `changes.md` | 本票过程文档 |

**既有断言一条未删、一条未放宽**（该文件里 4 条旧用例逐字保留）。

## 2. 红→绿证据（先跑出红，再落地）

### 2.1 红 ①：假 `partial` 缺 `missing[]`

临时把 `analysis/opcode-gaps.json` 的 `0x228`（原 `implemented`）改成 `"partial"` 并删掉 `missing`：

```
✖ ★opcode 缺口台账：生成器校验通过（覆盖 + 处置纪律），且 md 是最新的
  AssertionError: opcode-gaps 校验失败：
    - 0x228：标为 partial 但 missing[] 为空/缺失（必须逐条写「还缺哪条分支/消费端」）
    - counts 已漂移（implemented: 声明 41 / 实际 40；partial: 声明 0 / 实际 1）
✖ ★缺口台账 `partial` 棘轮：missing[] 必须齐备、票号真实存在、raw 合法
  AssertionError: partial 棘轮失败：
    - 0x228：标为 partial 但 missing[] 为空/缺失
  ℹ tests 6 / pass 4 / fail 2
```

### 2.2 红 ②：`missing[]` 在，但票号 / raw / what 违规

给同一条 `0x228` 塞 `missing = [{what:'假的…',ticket:'T-9999',raw:'1234-5678-9'},{what:'',ticket:'t151',raw:12345}]`：

```
AssertionError: partial 棘轮失败：
  - 0x228：missing[0].ticket=T-9999 在 tickets/ 下不存在
  - 0x228：missing[0].raw 不匹配 ^\d+(-\d+)?$（"1234-5678-9"）
  - 0x228：missing[1].what 缺/太短
  - 0x228：missing[1].ticket 格式错（"t151"）
  - 0x228：missing[1].raw 不匹配 ^\d+(-\d+)?$（12345）
  ℹ fail 2
```

（第二组还顺带证明了「`raw` 必须是字符串」这条：数字 `12345` 也红。）

### 2.3 绿

还原假条目 → 落地首批 57 条 → 重跑生成器 → 守卫：

```
opcode 缺口台账：未实现 0 / unjustified no-op 0 / 有据 no-op 12 / 已实现 28 / deferred 18 / partial 57（缺口 133 条）
✓ 校验通过（覆盖 + 处置纪律）
✔ ★缺口台账 `partial` 棘轮：missing[] 必须齐备、票号真实存在、raw 合法
✔ ★缺口台账 `partial`：md §7 的每条 missing 都进了生成物
ℹ tests 6 / pass 6 / fail 0
```

## 3. 跑过的确切命令与结果（最终态）

| 命令 | 结果 |
|---|---|
| `node scripts/build-opcode-gaps.mjs` | ✅ partial 57（缺口 133）/ 校验通过 |
| `node scripts/build-opcode-gaps.mjs --check` | ✅ `md 是最新的` + 校验通过，exit 0 |
| `node .agents/skills/amayui-engine-analysis/scripts/gaps.js` | ✅ 115 条 / 174.7 KB；`partial 57 / implemented 28 / deferred 18 / engine-internal 12` |
| `cd app/amayui-emulator && node --import tsx --test test/opcode-gaps.test.ts` | ✅ tests 6 / pass 6 / fail 0 |
| `… --test test/opcode-gaps.test.ts test/op-327-32e-setweather-noop.test.ts test/op-22a-22f-scene-xform.test.ts` | ✅ tests 19 / pass 19 / fail 0（含两条**钉死 disposition 的既有守卫**） |
| `… --test test/op-1d0-1d1-text-metrics.test.ts test/registry-classification.test.ts test/operand-plan.test.ts test/capability-gap.test.ts test/game-start-chain.test.ts test/skip-unknown.test.ts test/control-telemetry.test.ts test/audio-opcodes.test.ts test/gallery-bgm-list.test.ts` | ✅ 55/55 绿 |
| `… --test test/doc-model.test.ts` | ✅ 8/8 绿（★`docs-new/00-overview/index.md` **没有被重写** —— 本票只改既有生成物 `03-engine/opcode-gaps.md` 的内容，没有新增/删除文档） |
| `cd app/amayui-emulator && node --import tsx --test test/host-registry.test.ts` | ✅ 14/14（并发跑全量时它曾红一次 = 抢端口的 flake，单跑绿） |
| `node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --validate` | ✅（见 §5） |
| `npm run typecheck:test` | ✖ **1 条红，不是本票的**：`src/tools/deadWrites.ts(369,45): error TS2554` —— 该文件是并行票 `T-0150` 正在改的 `src/tools/**`（`git status` 里 `M`，mtime 2026/9/25 00:32） |
| `npm run test`（快速档） | ✖ 2 条红，都不是本票的：① `no-dead-writes.test.ts` 在 `src/tools/deadWrites.ts:552` 抛 `TypeError`（同上，T-0150 半成品）；② `host-registry.test.ts` 抢端口的 flake（单跑 14/14 绿） |

## 4. 首批内容（口径与来源）

- **改判 13 条**（原 `implemented` → `partial`）：`0x82 0x7c 0x133 0x134 0x147 0x1ba 0x20b 0x223 0x234 0x23f 0x244 0x24f 0x2e9`
  —— 正是"一旦写 `implemented` 就再没人回来核对"的那一类；`note` **只追加不改写**。
- **新增 44 条**：这些 opcode 早已注册进 `OPS`/`NATIVE_OPS`，此前台账里**一条记录都没有**。
- **来源**：审计 `impl-audit-2026-09.md` §4.1 的逐条 finding（`what` 取首句、`raw` 取 `engine.lines`）
  + `p23-worklist2.md` 的票号归属 + `engine-capabilities.json` 的 `status: partial` 残余（只读）
  + `dispositions.json` 的 `residual`（`0xcd` / `0x2f5`）。逐条明细与来源分布见 `notes.md` §3。
- **票号分布**：T-0151(11) T-0153(8) T-0152(6) T-0154(6) T-0156(6) T-0155(5) T-0158(5) T-0159(2) T-0160(2) T-0161(2) T-0163(2) T-0164(2)。
- **★没有为了凑数把已修好的改成 partial**：`0x193`/`0x1b2`/`0xc7`/`0xbc`/`0xc4`/`0x10c`/`0x1b6`/`0x1b7`/`0x305`/`0x1f5`/`0xfa` 等
  在实施轮已 `fixed` 且**无 residual** ⇒ 一律保持原样（其中 `0x193`/`0x1b2` 一族的根因票 `T-0162`/`T-0165` 另有归属）。
  唯一从实施轮 residual 迁入的是 `0xcd`（推进门槽镜像只做了一半）与 `0x2f5`（ADV 位已置时的写槽语义）。

## 5. 未做项 / 受阻项（**具体到文件:行**）

1. **`0x22d` / `0x22f` 的近似缺口没能迁入** —— `app/amayui-emulator/test/op-22a-22f-scene-xform.test.ts:224`
   钉死 `0x22a/0x22c/0x22d/0x22f` 必须是 `implemented`。该文件不在 T-0149 的文件范围内，**不能放宽既有断言** ⇒ 未迁。
   *需要主 agent 做*：把该断言放宽为 `implemented | partial` 后，再把 `p23-worklist2.md` 里 `0x22d`/`0x22f` 的
   「跨种类混用时只有一个 kind 生效（raw 117927-117931）」迁成 `missing[]`。
2. **SETWEATHER 族（`0x327`/`0x328`/`0x329`/`0x32e`）的缺口没能迁入** ——
   `app/amayui-emulator/test/op-327-32e-setweather-noop.test.ts:98` 钉死它们必须是 `engine-internal`。同上，未迁。
   *需要主 agent 做*：放宽为 `engine-internal | partial`，再迁入天气残余（能力台账 `scene-3d-weather-effects-rain-snow-leaf`：
   「三个效果对象体（D3D 顶点缓冲 + DrawPrimitive）未复刻 ⇒ 粒子几何为披露近似」，raw 126522-126570）。
3. **能力台账 `status: partial` 的 27 条里，只有 7 条有单一 opcode 落点**（`0x1c9`/`0x1f6`/`0x244`/`0x70`/`0x75`/`0x205`/`0x341`）。
   其余 20 条**未迁入**，原因是它们不是"某条 opcode 缺分支"而是**逐帧/子系统级**行为或**落点被钉死**：
   `frame-render-gate-mainloop` `scene-frame-commit` `scene-norender-mode` `clock-write-clock-freeze`
   `adv-flag-lifecycle` `adv-text-reveal-progress` `msgwin-text-object` `msgwin-object-table`
   `msgwin-cancel-key-state`（与引擎同步休眠、本就无缺口）`msgwin-text-method-opcodes` `adv-advance-route-table`
   `msgwin-line-fade-window` `msgwin-backlog-cursor` `gallery-unlock-file-used-flags`
   `texture-bind-synchronous-then-query` `scene-3d-weather-effects-rain-snow-leaf`（见第 2 条）
   `gfx-prim-mesh-and-render-state` `text-aa-config-gate` `drawitem-loop-anim-frame-drive`
   （其中 `lazy-572b-node-map` 已通过 `0x244` 迁入；`adv-*` 与 `msgwin-*` 的残余多已由同名 opcode 的 finding 覆盖）。
   ⇒ **建议**：给 `analysis/opcode-gaps.json` 增加一个 `capability` 字段（或 `missing[].cap`）把这类残余接回能力台账；
   本次不做（会改 schema 形状，超出本票判据）。
4. **`p23-worklist2.md` 的其余条目未迁入**（314 条 opcode 行里迁入 44 条 + 13 条改判）：
   留待各票修复时逐条补 —— 迁移成本是"逐条核 finding 的 `engine.lines`"，而各票动手时本来就要读那条 finding。
   本票的目标是把**可棘轮的处置位**建起来并示范首批，不是把 388 条一次灌完。
5. **`docs-new/00-overview/status.md` 已陈旧，且没带 `partial`** —— 它由 `scripts/build-status.mjs` 生成
   （`scripts/build-status.mjs:63` 的缺口行只列 未实现/unjustified/有据 no-op/已实现/deferred）。
   `node scripts/build-status.mjs --check` 现在 exit 1。
   ★**注意：它在我动手之前就已经陈旧** —— 文件里写「有据 no-op 13 · 已实现 39 · deferred 19」，
   而我改之前的实测是「12 / 41 / 18」（备份 `.tmp/t0149/opcode-gaps.backup.json` 的 `counts`）。
   *需要主 agent 做*：在 `scripts/build-status.mjs:63` 的模板里加 `partial`，再重跑生成 `status.md`（该文件不在我的范围内）。
6. **`docs-new/00-overview/lessons.md:14` 与 `CONTEXT.md:67`** 仍写旧的四值处置枚举与旧计数（都是手写文档、不在我的范围内）：
   `lessons.md` 的「`unimplemented`/`deferred`/`engine-internal`/`implemented`」建议补 `partial`；
   `CONTEXT.md` §3 的「缺口台账 71 条：implemented 41 / engine-internal 12 / deferred 18」应改为
   「115 条：partial 57 / implemented 28 / engine-internal 12 / deferred 18」。
7. **`scripts/build-status.mjs` 之外还有一处口径**：`docs-new/03-engine/scene-start-flow.md:105` 写「`ENGINE_INTERNAL_OPS` 现在只剩 9 条」——
   本票**没有**改运行时三张表（`ENGINE_INTERNAL_OPS` 仍是原样），所以这句不受本票影响，只是与台账的 12 条口径本来就不一致（既有问题，未动）。

## 6. 棘轮的用法（给后续各票）

- 修完一条 → 从该 opcode 的 `missing[]` 里**删掉那一条**；`missing[]` 空了 ⇒ `disposition` 改回 `implemented`（**不许**在还有 `missing[]` 时改 `implemented`：生成器会 problem）。
- 只想改票号/换票 ⇒ 直接改 `missing[].ticket`（必须是真实存在的票）。
- 复核某条全文：`node .agents/skills/amayui-engine-analysis/scripts/gaps.js --show 0x1c9`；
  只看 partial：`… --disposition partial`；按票看：`… --ticket T-0153`。
