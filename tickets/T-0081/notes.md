# T-0081 · 过程文档（notes.md）

## 2026-09-19

目标轮 13（用户要求继续后第 2 轮）：**修复一处工具链自伤** —— 前几轮我用 PowerShell 的 `Set-Content` 改 `state.ts` / `pixiBackend.ts` 时，双引号里的反引号被 PowerShell 当转义符吞掉，导致①两个文件各出现 1 个 NUL 字节、②注释里 `\

## 2026-09-19

2026-09-19 并行处置者补记两处台账工具缺口（未改生成器，留给出票人）：① `analysis/opcode-gaps.json` 的 `counts.byDisposition` **长期失同步**：本次核实时文件里写的是 implemented 9 / deferred 1 / unimplemented 50 / engine-internal 5 / unjustified 4，而 entries 实算是 23 / 28 / 9 / 8 / 1（已按实算写回）。它现在**没有任何守卫读**（`build-opcode-gaps.mjs` 只读 entries）⇒ 建议让 `build-opcode-gaps.mjs` 像 `capabilities.js` 那样自动重算，否则它只是一颗哑弹。② ★**渲染缺口**：`renderGapMd` 只渲染 unimplemented / unjustified / engine-internal / implemented 四节，**`deferred` 条目在 `docs-new/03-engine/opcode-gaps.md` 里完全不出现**（现例：0x327 Rain / 0x328 Leaf）⇒ 与「不静默跳过」的初衷相悖，建议补一节「已评估、按当前范围不实现（deferred）」。

## 2026-09-19

工具缺陷处置（2026-09，轮 47+ 收口；原记录见本文件上文「renderGapMd 无 deferred 节 / counts 无工具维护」）：

三条**全部已修**，且每条都用「注入漂移」反证过棘轮真的会红：

1. **`counts` 改为工具维护**：`scripts/build-opcode-gaps.mjs` 现在重算 `counts` 并**回填**真源 `analysis/opcode-gaps.json`（定点正则替换 `"counts": { … }` 那一块，其余字节原样保留，避免翻新格式与并发丢更新）；只读模式（守卫测试走这条）把漂移报成 problem。反证：手工把 `counts.implemented` 30 → 29 ⇒ `--check` exit 1、`test/opcode-gaps.test.ts` 1 fail；还原后全绿。
2. **`--check` 真的会失败**：此前它只打印 `✗ md 不是最新的` 却仍 `exit 0` ⇒ `npm run gaps:check` 是假"通过"。现在「md 陈旧」与「counts 漂移」都进 `problems` ⇒ exit 1。反证：给 md 追加一个空行 ⇒ `--check` exit 1；重生成后 exit 0。
3. **md 新增 §6「已评估、按当前范围不实现（deferred）」**：此前 31 条 deferred 在生成物里完全不可见（只活在 JSON），与「任何不实现都必须有一条可查」的纪律不符。编号排在最后以免打乱 §2–§5 的既有引用（审计报告引用过 §5）。

另修一条**相邻**的工具陷阱（同类：CLI 校验比守卫测试松）：`capabilities.js --set emulator.note=a, b` 会把值按 ASCII 逗号拆成**数组**，而旧 `validate` 只查语义（只有 n/a-known 才读 note）⇒ 数组型 note 一路"校验通过"，直到 `test/capability-ledger.test.ts` 才炸。现在 `validate` 先做类型检查（`emulator.note` 必须是字符串，并提示 `--set` 的逗号陷阱）。反证：注入 `emulator.note=a, b` ⇒ `--validate` 报「必须是字符串（当前 数组）」exit 1。

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

命名与落点沿用既有三层数据层纪律：真源进 `analysis/`，md 是渲染物（勿手改），守卫进 `app/amayui-emulator/test/`，CLI/生成脚本与 `scripts/build-capabilities.mjs` 同风格。★本票是 B0，先于任何「补指令」工作：否则补完一批又会出现新的静默 no-op。
