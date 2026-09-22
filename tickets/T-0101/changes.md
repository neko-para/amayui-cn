# T-0101 · 过程文档（changes.md）

## 2026-09-22

轮 12（收尾）：D5 收敛 + D6 删除。

**D5（默认窗双真源）**：引擎侧那一格 = `Font+1228` = `Font[307]`，解析规则 raw 73148-73152、
**初值 1**（raw 78899 `*(_DWORD *)(_this + 1228) = 1;`）、写点 `0x80`（raw 28786-28796）。
⇒ `handlers/text-items.ts` 的 `defaultWin(e)` 改读 `e.msgwin.defaultWin`（唯一真源）；
`handlers/msgwin.ts` 的 `0x80` 删掉镜像写 `engineValues[21631]`（删后它就是死写）；
`vm/engineFieldIds.ts` 的 `defaultWindow` 注释改成"只留字段 id 文档、存放处在 `msgwin.defaultWin`"。

**D6（死字段）**：`MsgWindow.textSlotArg` 与两处初始化删除（删前核过：零读取、`advState` 按名快照不含它）。

**守卫 +1 文件（3 条）**：`app/amayui-emulator/test/msgwin-default-window.test.ts` —— 
①任何 `i080` 之前页/记录 `win` 相同且 = 1；②`i080 3` 后两处同时变 3；③源码棘轮（读侧不许读 `engineValues`、
代码里不许再有 `textSlotArg`）。变异证明：退回 `?? 0` ⇒ 3 条全红。

**既有断言订正 3 处**（跟着唯一真源走，不是放宽）：`test/adv-msgwin.test.ts:838`（改设 `msgwin.defaultWin`）、
`test/engine-config.test.ts:313`（改断言 `msgwin.defaultWin`）+ 同文件 `0x80` 行描述、
`src/tools/config1Chain.ts` 的 `pane` 观测点（改读 `msgwin.defaultWin`，连带删掉不再用的 `FIELD_MSG_DEFAULT_WIN` import）、
`test/op-a2-a3.test.ts:242` 注释。

**判据**：`npm run verify` 全绿（1020 tests / 1019 pass / 1 skipped / 0 fail + typecheck ×3 + dead-writes 0）；
四份台账 `--validate` 绿。
