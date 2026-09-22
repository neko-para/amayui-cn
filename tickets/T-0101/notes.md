# T-0101 · 过程文档（notes.md）

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

来源 = T-0095 的「新发现（规格未提）」两条（D5/D6）。★本轮只登记不修（用户口径：T-0099/T-0100 那批只登记；这两条同属顺手捡到的遗留）。

## 2026-09-22 · 轮 12：D5 收敛 + D6 删除（**本票可以结了**）

### 1. D5：默认窗的引擎侧唯一真源（先确证，再改）

| 事实 | 出处 |
|---|---|
| 那一格是 `Font+1228` = `Font[307]` | raw **73148-73152** `if ( !a2 ) { a2 = *(_DWORD *)(_this + 1228); … }`（`0x1D2`/`0x70`/`0x71` 族共用的解析规则） |
| **初值 = 1** | raw **78899** `*(_DWORD *)(_this + 1228) = 1;`（`Font` 初始化段） |
| 写点 | `0x80` set-default-window（`sub_41F690` raw 28786-28796） |

⇒ 引擎侧只有**一格**。emulator 侧此前是**两处**：`MsgWindow.defaultWin`（初值 1，`resolveWin(0)` 用）
与 `engineValues[21631]`（稀疏表里**没有**这一格 ⇒ `?? 0`），`0x80` 同时写两处
⇒ **任何 `i080` 之前**：`i071 0` 压的回看页 `win = 1`、`i1d2` 压的记录 `win = 0`。
今天没有按窗过滤的读端（不可观测），但这是"同一语义多处真源"的典型（`T-0057` 治理的那一类）。

**改法**（取票面首选）：读侧 `handlers/text-items.ts` 的 `defaultWin(e)` 改读 `e.msgwin.defaultWin`；
`0x80` 的那行镜像写 `engineValues[21631]` **删除**（否则它就是"写了没人读"的死写）；
`ENGINE_FIELD.defaultWindow` 常量保留为"引擎字段 id"的文档（注释写明存放处已移到 `msgwin.defaultWin`）。

### 2. D6：`MsgWindow.textSlotArg` 整条删除（先核调用方，再删）

删前核对：全仓只有两处**初始化**（构造默认值 + `reset()`）、零赋值、零读取；
`advState` 的按名快照（`AdvStateJson`）**不含**它（`grep textSlotArg src/vm/advState.ts` 0 命中）
⇒ 当年"保留仅为兼容按名快照"的顾虑**经核实不成立**。已删除该字段与两处初始化，
并在原地留一条历史说明（讲清它是 T-0095 订正过的"第二个副本"以及为什么删）。

### 3. 守卫（`app/amayui-emulator/test/msgwin-default-window.test.ts`，3 条）

1. **任何 `i080` 之前**：`i071 0` + `i1d2` ⇒ 回看页 `win` == 记录 `win` == **1**（= 引擎初值，不是 0）；
   并直接断言 `rec.win === page.win`（D5 的核心不变量）。
2. `i080 3` 之后两处**同时**变 3（单一真源，不会只动一边）。
3. **源码棘轮**：`defaultWin` 不许再出现 `ENGINE_FIELD.defaultWindow`、必须读 `e.msgwin.defaultWin`；
   全 `src/` 的**代码**里不许再有 `textSlotArg`（注释里的历史说明不算 —— 先剥注释再查）。

★**辨别力已机械证明**：把 `defaultWin` 退回 `engineValues.get(...) ?? 0` ⇒ 该文件 **3 条全红**
（点名"记录的 win —— 修前这里是 0，与页不一致"）；还原后 3/3 绿。

### 4. 既有守卫的期望值订正（**不是**放宽，是跟着唯一真源走）

改完 D5 后有 3 处既有断言/观测点仍在读旧存放处，逐条订正（都写明了理由）：

| 位置 | 原来 | 现在 |
|---|---|---|
| `test/adv-msgwin.test.ts:838` | `e.engineValues.set(21631, 8)` 当默认窗 | `e.msgwin.defaultWin = 8`（注释点明双真源时代的写法） |
| `test/engine-config.test.ts:313` | 断言 `engineValues.get(21631) === 9` | 断言 `e.msgwin.defaultWin === 9`（并订正同文件 `0x80` 那一行的描述） |
| `src/tools/config1Chain.ts` 的 `pane` 观测点 | `engineValues.get(FIELD_MSG_DEFAULT_WIN)`（订正后会恒 `undefined`） | `e.msgwin.defaultWin`（连带删掉不再使用的 import） |
| `test/op-a2-a3.test.ts:242` 注释 | "同时写 Engine[21631] 与 msgwin.defaultWin" | 只写唯一真源 |

### 5. 判据

- `npx tsx --test test/msgwin-default-window.test.ts` ⇒ 3/3 绿（含变异证明）。
- 相关旧守卫同批绿：`adv-msgwin` / `op-1d0-page-index` / `engine-config` / `op-a2-a3` / `config1-chain`。
- 全量 `npm run verify` 绿（见 `changes.md`）；四份台账 `--validate` 绿。
