# T-0108 · 报告（一句话结论 + 命令与数字 + 未做项）

## 一句话

**181 处**（`grep 订正` 口径 168 处）数据层沿革话术**全部**判定完毕：**286 条结论级沿革原文逐字落各实体
`journal[]`**（217 个实体）、15 处纯措辞删除、3 类非沿革各给保留理由；六份真源 `journal[]` 之外 **0 处**，
四份生成物里 `订正` 行数 **49 / 8 / 1 / 8 → 0 / 0 / 0 / 0**，`doc-model.test.ts` 的 I9 已扩到生成物
（注入一行即红、还原后 sha256 逐字节一致）。

## 确切命令与结果（红 → 绿）

```bash
# ① 红：改前（本票动手前实测）
grep -c 订正 analysis/opcodes.json analysis/engine-capabilities.json analysis/opcode-gaps.json \
              analysis/functions.json analysis/fields.json analysis/scripts.json
  → 53 / 48 / 31 / 24 / 4 / 8（= 168）；字段级（journal 外）= 181
grep -c 订正 docs-new/03-engine/{opcode-table,engine-capabilities,opcode-gaps}.md
  → 49 / 8 / 1

# ② 统计脚本（本票口径：journal[] 之外的沿革话术处数）
node .tmp/t0108/stats.mjs
  → 每个文件 0，TOTAL(journal 外) = 0（journal 内 = 191 条命中 / 286 条记录）

# ③ 绿：四个生成器 + 四份 --validate
node scripts/build-opcode-table.mjs && node scripts/build-capabilities.mjs \
  && node scripts/build-opcode-gaps.mjs && node scripts/build-scripts.mjs
node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --validate          # ✅ 172 张
node .agents/skills/amayui-engine-analysis/scripts/capabilities.js --root . --validate   # ✅ 141 条
node .agents/skills/amayui-engine-analysis/scripts/scripts.js --root . --validate        # ✅ 35 条
node scripts/build-opcode-gaps.mjs --check                                      # ✓ 最新（缺口 143 / partial 64）
grep -c 订正 docs-new/03-engine/*.md   → 全 0（含手写）；docs-new/05-scripts/*.md → 全 0

# ④ 守卫（含辨别力证明）
cd app/amayui-emulator
npx tsx --test test/doc-model.test.ts test/opcode-gaps.test.ts test/capability-ledger.test.ts \
  test/script-ledger.test.ts test/op-1d0-1d1-text-metrics.test.ts test/op-22a-22f-scene-xform.test.ts \
  test/op-327-32e-setweather-noop.test.ts test/ticket-ledger.test.ts test/operand-plan.test.ts
  → tests 49 / pass 49 / fail 0
```

## 改了哪些文件

真源（本票独占）：`analysis/opcodes.json`、`analysis/engine-capabilities.json`、`analysis/opcode-gaps.json`、
`analysis/functions.json`、`analysis/fields.json`、`analysis/scripts.json`
生成物（重跑，勿手改）：`docs-new/03-engine/{opcode-table,engine-capabilities,opcode-gaps}.md`、
`docs-new/05-scripts/*.md`
守卫：`app/amayui-emulator/test/doc-model.test.ts`（I9 扩面）
过程文档：`tickets/T-0108/changes.md`、`tickets/T-0108/notes.md`（本文件）
工具（`.tmp/`，gitignore）：`stats.mjs` / `patch.mjs` / `plan-*.json` / `residue*.mjs` / `fix-gaipan.mjs`

`git diff --stat`（★注：这 6 份真源在**本会话开始时已经是 modified**（T-0149/T-0151/T-0153/T-0170 的未提交改动），
所以下面的数字是**上界**；本票自己的改动 = 301 处字段级改写 + 286 条 `journal[]`）：

```
analysis/engine-capabilities.json          |  836 +++++++++--
analysis/fields.json                       |   11 +-
analysis/functions.json                    |  288 +++-
analysis/opcode-gaps.json                  | 2101 ++++++++++++++++++++++++++--
analysis/opcodes.json                      |  754 +++++++++-
analysis/scripts.json                      |  212 ++-
app/amayui-emulator/test/doc-model.test.ts |  243 +++-
docs-new/03-engine/engine-capabilities.md  |   59 +-
docs-new/03-engine/opcode-gaps.md          |  269 +++-
docs-new/03-engine/opcode-table.md         |  152 +-
10 files changed, 4431 insertions(+), 494 deletions(-)
```

无 `Set-Content`（全程 `write`/`edit` 工具 + Node `fs.writeFileSync`），六个真源 `crlf=0` 未变。

## 未做 / 需主 agent 代办

1. **★25 条票据的 `evidence[].line` 行号提示漂移**（`engine-capabilities.json` 16 / `opcodes.json` 4 /
   `opcode-gaps.json` 3 / `functions.json` 2）：本票给实体追加 `journal[]` 后行号整体下移；**anchor 字符串仍在**、
   `tickets.js --validate` 仍绿（全库 **77** 条 ⚠ 中的 25 条；其余 52 条指 `app/amayui-emulator/src/**`，
   来自别的 agent 的在改改动）。**本票不许改别人的票** ⇒ 请各 owner
   `tickets.js --edit <ID> --set-json 'evidence=[…]'` 刷新 `line`。
2. `docs-new/04-app/*.md`（5 份）与 `00-overview/{lessons,status}.md` 仍含「订正」；`99-records/**` 属历史区
   （A4 允许）。本票判据只点了 `03-engine/*.md` + 数据层 ⇒ 04-app 那批**未动**，是否清请 owner 决定。
3. `engine-capabilities.json` 部分长 note 仍是"现状 + 沿革"混排的句子顺序（沿革段已删/移，句界未重排）——
   整段重写属新的排版工作，不在本票判据内。
4. **未发现任何"沿革里藏着被推翻的结论"或"现行事实其实是错的"**：全部 286 条移走的都是"旧结论/旧锚点/旧口径"，
   现行事实在抽查的 16 条里逐条核对仍在（见 `changes.md` §4）。

## 2026-09-24

主 agent 裁决（收尾第 2 项）：docs-new/04-app/*.md 五份与 00-overview/{lessons,status}.md 里的 12 处「订正」保留、不清。理由：① 它们是手写叙述／设计文档，不是 renderer 生成物 ⇒ 不在 I9「沿革不进叙述文档」的射程内（本票判据只点 03-engine 与生成物与数据层）；② 逐条读过后 12 处都是现在时语义（如 emulator-frame-loop-design.md:93 的「✅ 已订正（T-0015）」、emulator-copyright-effect.md:164 的「★2026-09 订正：不再是…而是…」）或流程词（如 emulator-refactor-plan.md:211 的任务项「文档订正」、live2d-support-assessment.md:138 的验收项），删掉反而丢信息；③ 第 4 项（长 note 句序重排）属新排版工作，不做 —— 沿革段已删／移，句界未重排不影响正确性。⇒ 本票剩余 4 项全部有处置。
