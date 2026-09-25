# T-0150 变更记录

## 第 1 次变更（2026-09-25）：死写闸门扩面到 `Engine` / `SceneState`（含嵌套 `render4`）/ `SceneXform` / `TextFrame`

### 改了什么

| 文件 | 改动 |
|---|---|
| `app/amayui-emulator/src/tools/deadWrites.ts` | ① 新增 `SCOPES` 表（scope/type/file/kind/**path**/**indent**/**ignore**），字段清单按 scope 解析；`findDeadWrites(root, files?, scopes?)` 第三个参数可换 scope 表（测试夹具用）。② 成员解析器：`braceBlock`/`memberBlock`/`memberNames` —— 认 class（含多行类型注解、修饰符、构造函数参数属性）、认**嵌套对象类型**（`render4: {` 的 `{` 可在下一行）。③ 消费方识别：`typedNames`（类型注解线索）+ `receiverVerdict`（消费者/可证伪是别的类型/拿不准算读）+ `receiverBase`。④ 「写」口径补 **容器变更方法**（`set`/`add`/`push`/`clear`/`delete`/`reset`…）与 `++`/`--`。⑤ 嵌套 scope 的**带路径访问**（`render4.primReset`）直接算消费者。⑥ 基线扩成 `known` + `reason` + **`tickets`**，新增 `auditBaseline()` 判据；`main()` 在登记不合格时也 exit 1。⑦ `defaultScan(root)` = 显式清单 ∪ 全部 `src/**`（排除 `src/tools/`、`src/report.ts`、`dist/`、`node_modules/`、`.tmp/`）。 |
| `app/amayui-emulator/dead-writes.baseline.json` | `known` 从 0 → **14** 条；每条补 `reason`（为什么暂时是死写 + 唯一读者是谁）与 `tickets`（承接票号）。`_removed` 留档不动，另加 `_note_2026_09_25` 记录"本轮**未**进基线的两个字段及原因"。 |
| `app/amayui-emulator/test/no-dead-writes.test.ts` | 新增 4 条用例：① 覆盖面（Engine/SceneState/嵌套 render4/SceneXform/TextFrame 各至少扫到 N 个字段、扫描面 ≥100 文件）；② 容器变更方法算写（含反面：加 `.get()` 读者后必须回 alive）；③ 跨 scope 同名不洗白（含反面：无注解但被同 scope 别的字段用过 ⇒ 保守算消费者）；④ 基线登记规矩（`auditBaseline` 必须为空 + 反向自检"缺 reason/缺 tickets/理由太短"各报一条）。 |
| `app/amayui-emulator/README.md` | §「闸门 C」补：扫描面清单（`SCOPES`）、剔除诊断与测试的口径、盲区、**「怎么加基线（必须写 why + 票号）」**的 JSON 样例与判据。 |

**改动的性质**：`acceptance` 的两条都落在"覆盖面 + 语义保持"上 —— 既有断言一条没删、没放宽。
（`no-dead-writes.test.ts` 的三条既有用例逐条保留：ratchet、合成模型、注释/字符串免疫。）

### 判据（命令 + 实测结果）

```powershell
cd app/amayui-emulator

# ① 红→绿对照（临时在 src/vm/engine.ts 的 Engine 里加一处只有声明的字段，取证后删除）
npm run check:dead-writes      # 红：exit 1；当前死写 15 个；★ 新增死写（必须登记或修掉）：Engine.t0150TemporaryDeadWrite
node --import tsx --test test/no-dead-writes.test.ts   # 红：tests 7 / pass 6 / fail 1（死写 ratchet 那条）
# —— 撤销临时字段后 ——
npm run check:dead-writes      # 绿：exit 0；扫描 141 个文件 / 字段 154 个；基线 14 / 当前 14 / ★ 无新增死写
node --import tsx --test test/no-dead-writes.test.ts   # 绿：tests 7 / pass 7 / fail 0

# ② 收尾三连
npm run check:dead-writes      # exit 0（基线 14 / 当前 14 / 无新增）
npm run typecheck              # exit 0（tsc ×3）
npm run typecheck:test         # exit 0
node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --validate   # ✅ 170 张（44 条警告全部来自别的票/别的 agent 的文件）
```

红/绿两轮的原始输出留档在 `.tmp/t0150/{red-check.txt,red-test.txt,green-check.txt,green-test.txt}`（`.tmp/` 是临时区，**不作为证据**；命令与数字已抄进本节）。

### 与其它 agent 的关系（并行期实测）

- 扩面期间 `src/vm/**` 正被另一个 agent 改（`engine.ts` 字段在变）。本票的两次实测点：
  - 第一次：`Engine.recallRepaint`（对方刚加、当时只有 3 处写、0 读者）出现在死写列表里，**未登记基线**
    （它是对方在建的中间态，登记会立刻过期）；
  - 第二次：该字段已被对方移除，列表回到 14 条。
  ⇒ 本票的基线是**某个实测点**的快照；若对方后续又引入"写了没人读"的新字段，闸门会立刻红
  （这正是棘轮该有的行为），不会影响本票的判据。
- 本票**没有**改 `src/vm/**`（除红→绿取证时临时加/删的那两行，已撤销；`git diff` 里不留痕）。
