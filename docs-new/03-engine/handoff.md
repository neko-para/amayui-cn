---
kind: session
state: live
updated: 2026-09-21
---

# 03-engine · 交接文档（可续跑）

> 用途：**新会话直接照此续跑**。本文只写**活的**东西：怎么交接、起手命令、纪律。
> - **现状与下一步** → `docs-new/00-overview/status.md`（**生成物**，从票据与四份台账派生；勿手改）。
> - **历史轮次 / 已完成成果** → `analysis/journal.jsonl`（一行一轮；`node scripts/journal.js --tail 3`）。
> - **本票/本能力的来龙去脉** → `tickets/<ID>/changes.md`。
> **唯一权威 = 引擎反编译** `engine/天结_unpacked.exe_utf8.c`。

**怎么交接（只需这一句）**：「读 `docs-new/03-engine/handoff.md`，按它继续推进；开工前先看 §1 的会话级前置」——
三层数据层（`analysis/*.json`）、台账、票据、文档**全在仓库里**，不需要另外搬。
**并发/多 agent 纪律也已经进仓库了**（三个技能各有一节「★多 agent 并行纪律」）；§1 只留「会话级」那两条。
★**给子代理（subagent）派活时**：它们**会**拿到同一份技能目录与 `skill` 工具（实测），照 §1-2 与技能里的三种 prompt 模板交代即可。

## 1. 起手命令（复制即用）

### 1.0 ★开工前置（**会话级，不在仓库里，必须口头交代或确认**）

1. **沙箱必须允许子进程管道**：本工程的 `npm run verify` 走 `node --test`，它会**为每个测试文件 spawn 子进程并捕获管道 stdio**。
   在受限沙箱下这会被拦成 `spawn EPERM`（表现为**每个测试文件都红**、错误栈是 `child_process.spawn`）——
   **那不是测试失败，是沙箱**。本会话实测：必须给到 `danger-full-access` 才能跑 `npm run verify`。
   ⇒ 新会话若一上来 `verify` 全红且错在 `spawn EPERM`，先解决权限，**不要**去改测试。
   （临时绕法：单文件直接用 `node --env-file=test/options.test.env --import tsx test/xxx.test.ts` 跑在进程内，不起子进程。）
2. **加载技能**：本仓库的技能是**按需加载**的（`.agents/skills/*`）。开工时在提示里点名它们，否则新会话不会读到纪律
   （★**子代理不点名也会拿到同一份目录**：目录注入挂在 `agent/pre-step`、对每个 agent 各发一次 —— 实测子代理报告里列出了全部 8 个技能并真的加载了其中几个；
   但**正文改动不触发重新注入** ⇒ 技能刚改过时要提醒它「重新 `skill` 一次」）：
   `amayui-engine-analysis`（三层数据层 + 缺口/能力台账）、`amayui-script-analysis`（脚本台账流程）、
   `amayui-ticket-ledger`（票据台账）、`amayui-script-translate` / `amayui-script-update`（翻译相关）、
   `batch-task-runner`（批量）、`amayui-ui-text-render`（UI 图片文字）、`amayui-mnemonic-rename`（助记符改名）。
3. **并发写纪律 → 已进仓库**：见三个技能的「★多 agent 并行纪律」节（单写者表 / 三种子代理 prompt 模板 / 锚点 ABI / validate 红分类 / 共享资源串行化）。
   工具侧已加固：**`--set-json`**（值里带 ASCII 逗号时不再被拆成数组）、**`--recount`**（直接改过 JSON 后修 `counts`）、
   **`--anchors-in <file>`**（改文件前查「谁锚在这」）；三工具写入已是**原子写**（tmp+rename），`--validate` 改为**比磁盘上的 `counts`**（此前比刚重算的副本 ⇒ 陈旧查不出来）。
   仍然成立的两条人肉纪律：**对既有共享文件只用 `edit` 定点替换、不用 `write` 整文件重写**；**`npm run shot` / `verify` 同一时刻只跑一个**
   （`shot` 会覆盖同一个 `.tmp/amayui-emulator.log`，而它是证据源）。
4. **环境要自己构造**（2026-09 系统变更后：本机**没有真游戏安装**）：读档链 E4 用的 079 存档不在默认
   overlay 里，样本在仓库 `cache/`（`SAVE79.DAT`/`SAVE79.STH`）⇒ **按 `cache/README.md` 复制到
   `<repo>/.tmp/appdata/Eushully/天結いキャッスルマイスター.overlay/SAVE/` 并把 mtime 拨回
   头里的存档时间**。★**不要**为了跑那几个 `SAVE00.*` 用例把 079 改名成 00、也不要自造
   `base/SYS4REG.INI`/`base/SAVE/SAVE.DAT` —— 实测那样做会让 `config-version-substr` 与
   `engine-config` 红在**与环境有关、与实现无关**的地方（细节与理由见 `cache/README.md`）。

```bash
# ① 基线（必须全绿）
cd app/amayui-emulator && npm run verify
# ② 台账现状（写模式会顺带回填 counts；--check 是 CI 口径）
cd ../.. && node scripts/build-opcode-gaps.mjs
node scripts/build-opcode-gaps.mjs --check
# ③ 定位任一引擎函数的体（★先 grep 定义头，别猜位置）
#    Select-String -Path engine\天结_unpacked.exe_utf8.c -Pattern '//----- \(0042E8A0\)'
# ④ 真实界面回归（E4）：读档链
cd app/amayui-emulator && npm run shot -- --load 79 --name mycase --page 870,900
#    → 产物 .tmp/mycase-*.png + 日志 .tmp/amayui-emulator.log；GUI 改动需 npm run build:electron（`npm run shot` 已含）
```

## 2. 纪律

> **纪律清单只有一份**：`docs-new/00-overview/lessons.md`（20 条，全部来自实测事故）。开工前读一遍。


## 3. 历史与状态在哪

| 想知道 | 去哪 |
|---|---|
| 现在什么状态、下一步做什么 | `docs-new/00-overview/status.md`（生成物） |
| 上一轮/上几轮做了什么、有哪些方法论教训 | `analysis/journal.jsonl`（`node scripts/journal.js --tail 5` / `--lessons`） |
| 某张票为什么这么设计、改过几轮 | `tickets/<ID>/notes.md` + `changes.md` |
| 某个 opcode/能力/脚本的结论 | `analysis/opcodes.json` / `engine-capabilities.json` / `scripts.json` |
| 某份一次性审计/规格 | `docs-new/99-records/`（`state: consumed`） |

## 4. 工具速查

| 目的 | 命令 / 路径 |
|---|---|
| 全量验证 | `cd app/amayui-emulator && npm run verify` |
| 单文件测试 | `node --env-file=test/options.test.env --import tsx --test test/xxx.test.ts`（在 `app/amayui-emulator` 下） |
| 注册表分两张 | `OPS`（VM 核心）与 `NATIVE_OPS`（子系统）；测试里取 handler 要 `OPS.get(op) ?? NATIVE_OPS.get(op)` |
| 缺口台账 | `node scripts/build-opcode-gaps.mjs`（写模式，回填 counts）/ `--check`（CI，漂移 exit 1）；真源 `analysis/opcode-gaps.json` |
| ★缺口**全文**（md 只给一句话） | `node .agents/skills/amayui-engine-analysis/scripts/gaps.js [--show 0x140｜--list｜--disposition deferred｜--ticket T-0093]` |
| ★opcode 映射真源 | `analysis/opcodes.json`（★2026-09 从 `opcode-table.md` 迁出）；重建 `node scripts/build-opcode-table.mjs` + `node scripts/asm/build-opcodes.js` |
| ★沿革（会话级） | `node scripts/journal.js [--tail 5｜--round 9｜--ticket T-0102｜--lessons｜--validate]`；真源 `analysis/journal.jsonl`（**永不渲染**） |
| ★文档索引 / 当前状态 | `node scripts/build-doc-index.mjs` → `00-overview/index.md`；`node scripts/build-status.mjs` → `00-overview/status.md`（都是生成物） |
| ★文档模型守卫 | `node --env-file=test/options.test.env --import tsx --test test/doc-model.test.ts`（front-matter 合法性 + 生成物一致性 + 沿革不进生成物） |
| 能力台账（第二层） | `node .agents/skills/amayui-engine-analysis/scripts/capabilities.js --root . [--validate|--attention|--id X]` + `node scripts/build-capabilities.mjs` |
| 脚本台账（第三层） | `.agents/skills/amayui-engine-analysis/scripts/scripts.js --root . [--validate|--coverage]` + `node scripts/build-scripts.mjs` |
| 开工前一页纸（脚本） | `node .agents/skills/amayui-script-analysis/scripts/brief.js <ID>` |
| 真机截图回归 | `npm run shot -- --load 79 --name X --page 870,900`；日志 `.tmp/amayui-emulator.log` |
| 引擎反编译 | `engine/天结_unpacked.exe_utf8.c`（**唯一权威**；函数头 `//----- (0040xxxx)`）；thunk 查 `…utf8.lst` |
| 票据 | `node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --root . --show T-00NN` / `--note` / `--set-status` / `--validate` |
| ★改文件前查锚点 | `tickets.js --anchors-in <file>`（谁锚在这）· `scripts.js --anchors-in <file>`（脚本 layout 锚点） |
| ★台账安全写 | `--set-json k='<json>'`（值含 ASCII 逗号时必须用它）· `--recount`（直接改过 JSON 后修 counts；`--validate` 现比磁盘） |
| ★多 agent / 子代理纪律 | 三个技能的「★多 agent 并行纪律」节（单写者表 + 三种 prompt 模板）；守卫 `test/agent-workflow.test.ts` |
| 两宿主对称 | 改宿主行为必须同时改 `headlessScene.ts`（测试/报告用）与 `pixiBackend.ts`（Electron GUI 用） |

## 5. 不要做的事

- 不手改生成物（`opcode-table.md` / `opcode-gaps.md` / `engine-capabilities.md` / `docs-new/05-scripts/*` / `tickets/README.md` / `scripts/asm/opcodes.json` / `00-overview/{index,status}.md`）——
  改真源后跑对应生成器；忘了会被 `test/doc-model.test.ts` / 各自的周守卫打回；
- **不在 `handoff`/`plan`/机制文档里复述轮次**：沿革只住 `tickets/*/changes.md` + `analysis/journal.jsonl` + 各实体 `journal[]`（见 `00-overview/authority.md` 附录 A4）；
- **不给 `docs-new` 的新 md 漏写 front-matter**（`kind`/`state`）：`test/doc-model.test.ts` 会红；
- 不为"看起来正常"新增启发式（尤其不要给 `#holdFrames` 打补丁）；
- 不把缺口塞进 `ENGINE_INTERNAL_OPS` 静默跳过（`gaps:check` 现在拦得住）；
- **不照抄筛体/规格文档的推断当结论**（先读体；本轮已实证 13 处错，含 2 处整条归口错）；
- 不改真实游戏数据（base `SAVE.DAT` / AGF 等只读；写入只落 `.overlay`）；
- 不在没有消费者的情况下往 `Item`/`MeshObj` 加字段，也不往"引擎没有的合成级"硬接；
- **不用「删证据 / 降 status / 删条目」来消 `--validate` 的红**（锚点漂移就 retarget、`counts` 陈旧就 `--recount` + rebuild，见 §4-17/19）；
- 不把「清容器不在被调函数里」当成「引擎没清」（结论只认函数体文本，见 §4-18）；
- 做 git 提交（只写文件）。
