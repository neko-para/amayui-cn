# T-0139 · 过程文档（notes.md）

## 技能退役（2026-09-26）

**决定**：删除 `.agents/skills/amayui-remote-debug/`（用户口径；评估见 `tickets/T-0191/notes.md` §10）。

**为什么可以删**（删前逐项核过）：

1. **资产已搬空**：`emu.mjs` + `ops/*` + `load-slot.mjs` 早在同一天搬到 `app/amayui-emulator/tools/`（`T-0191`），
   技能目录里只剩 `SKILL.md`；而它已被**去重成入口索引**（命令表 → `src/vm/debugCommand.ts`；ops → `tools/ops/README.md`；
   坐标 → 同一份 README 的「手驱动坐标表」；环境/权限 → `AGENTS.md`）。
2. **引用面已核**：`CONTEXT.md` §1 那一行改成"工具 `amayui_emulator` + `AGENTS.md`"；`analysis/engine-capabilities.json`、
   `docs-new/**`、其余技能都没有再指向技能目录（16 个文件里的旧脚本路径已机械换指到 `app/amayui-emulator/tools/`）。
3. **唯一必须先做的事**（本文件落地时一并做了）：本票的守卫规格原为
   `.agents/skills/amayui-remote-debug/SKILL.md#amayui-remote-debug` ⇒ 删目录会让 `ticket-ledger` 守卫红。
   已 retarget 到 **`plugins/amayui-emulator/README.md#agent tool：\`amayui_emulator\``**（驱动手册的唯一落点）。

**退役后的入口**（"怎么把一个实例驱动起来"）：

| 要什么 | 去哪 |
|---|---|
| 工具动作与参数 | 工具 `amayui_emulator` 描述（11 个动作）+ `plugins/amayui-emulator/README.md`「agent tool」节 |
| 调试命令表 | `app/amayui-emulator/src/vm/debugCommand.ts`（工具回执 / 面板帮助同源） |
| 操作脚本（ops） | `app/amayui-emulator/tools/ops/` + 索引 `ops/README.md`（工具 `action=ops` / `op` / `op-create`） |
| 环境与权限 | `AGENTS.md`（沙箱挡管道的红名单 + hook+node 跑 TS） |

**副作用/风险**：技能目录少了一条**按名字可检索**的入口（工具描述与 `AGENTS.md` 本来就在上下文里）；
若日后想恢复，`git` 里有本目录的全部历史（本会话未做 `git add`）。
