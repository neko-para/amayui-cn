# T-0111 判据① —— 8 条低/零语料行的处置 + `0x1D3` 锚点判定 + 运行时三表全量对账

> 轮次：判据①（唯一剩余判据）。产出**可机械应用的补丁** + 自证；**不改**台账/代码/测试/文档真源。
> 机器产物：`.tmp/t0111a/plan.json`（补丁）、`.tmp/t0111a/registry.json`（运行时三表快照）、
> `.tmp/t0111a/opcode-table.after.md`（按补丁渲染出的生成物）。本文件是过程文档，不是真源。

## 0. 口径与方法（先说清楚，后面所有数字都用它）

- **raw 行号**：`raw = engine/天结_unpacked.exe_utf8.c 的 1-based 文件行号 − 1`（体的第一行是
  `//----- (XXXXXXXX)` 那一行，也是 `scripts/build-opcode-gaps.mjs` 的 `handlerBodyLine` 的来源）。
  ⇒ `raw N` 与 `handlerBodyLine = N+1` 是同一件事的两种写法。
- **语料计数**：先复用真源生成器的 `scripts/build-opcode-gaps.mjs::scanCorpus`（它按
  `scripts/asm/opcodes.json` 的 `i<hex>`/`name`/`aliases` 三种写法统计 941 个 `src/*.txt`），
  再用 `^\s*i<hex>\b` 自写一遍交叉对照；两者对本案 100% 一致。
- **handler**：派发表项 `Engine + 675996 + 4*opcode`（构造期逐槽赋值从 raw 22722 的 `memset32` 之后开始），
  调用点 = raw 21215 的 `(*(void (__thiscall **)(int))(_this + 4 * v18 + 675996))(_this)`
  ⇒ handler 收的第一个参数就是引擎实例本身，操作数用 `sub_41BF50`（int）/`sub_41C300`（float）按 1-based index 读。
- **emulator 注册状态**：不在源码里 grep，而是从运行时三张表实读（`.tmp/t0111a/registry-dump.mts`
  → `registry.json`：`OPS` 299 / `NATIVE_OPS` 54 / `ENGINE_INTERNAL_OPS` 13，并集 366）。

## 1. 判据①(a)：8 条的逐条处置

| # | opcode | handler | argc | 实读体 raw | 语料 | 票面说 | 处置 | 缺口台账 |
|---|---|---|---|---|---|---|---|---|
| 1 | `0x105` | `sub_421E20` | 1 | 30503-30512 | **0 处 / 0 文件** | 0 处 ✓ | 补语义（`已核对`） | 新增 `unimplemented` |
| 2 | `0x2CA` | `sub_430990` | 1 | 40085-40097 | **0 处 / 0 文件** | 0 处 ✓ | 补语义 | 新增 `unimplemented` |
| 3 | `0x309` | `sub_432000` | 5 | 40956-41007 | **0 处 / 0 文件** | 0 处 ✓ | 补语义 | 新增 `unimplemented` |
| 4 | `0x339` | `sub_4277A0` | 7 | 34307-34327 | **0 处 / 0 文件** | 0 处 ✓ | 补语义 | 新增 `unimplemented` |
| 5 | `0x22E` | `sub_424290` | 6 | 32066-32084 | **0 处 / 0 文件** | 0 处 ✓ | 补语义 | 新增 `unimplemented` |
| 6 | `0x026` | `sub_41D6A0` | 4 | 27431-27463 | **1 处 / 1 文件**（`SC0000.txt:13127`） | 0 处 ✗ | 补语义（保留 `deferred`） | 在册，note 追加计数 |
| 7 | `0x144` | `sub_433AB0` | 2 | 42063-42152 | **1 处 / 1 文件**（`SAVE.txt:560`） | 0 处 ✗ | 同上 | 在册，note 追加计数 |
| 8 | `0x2FD` | `sub_431CF0` | 6 | 40828-40943 | **4 处 / 4 文件**（`ALLMAP`/`CGVIEWER`/`FIELD`/`REIGN`） | 0 处 ✗ | 同上 | 在册，note 追加计数 |

**为什么前 5 条不转 `deferred`**：`unimplemented` 与 `deferred` 在 emulator 里的**行为完全相同**
（三张表都不注册 ⇒ 命中即 `NotImplementedOp` 硬报错），但二者的**判据形状不同**：`deferred` 的语义是
"已评估、按当前范围**整个不做**（必须写扩展点）"，`unimplemented` 是"语料用到但没注册、按语料量排期"。
这 5 条语料 **0 处** ⇒ 不存在"按语料量排期"，也不该占用 `deferred` 的语义（那条语义意味着"评估过要建某个模型"）。
登记成 `unimplemented` 既让缺口台账覆盖它们（`stub-*` 系列守卫的"新增缺口即红"不会因为以后有人把语料改出来而漏），
又**保持了"命中即硬报错"**（不是静默跳过）。语义里的"扩展点"写在 note 里而不是 `missing[]` 里
（`missing[]` 只属于 `partial`，见 `test/opcode-gaps.test.ts` 的棘轮）。

**为什么后 3 条保留 `deferred` 而不是改成 `unimplemented`**：它们在册的处置是 `T-0076` 的
"已评估、按当前重写范围不做"（分别缺 DDraw/2D 特效宿主缝、运行时外部服务表、输入层点击队列），
这是**有据的"不做"**，不是"没排期"；本轮只按票面要求把**语料计数**与**"为什么不影响"**补进 note。

## 2. 判据①(b)：`0x1D3` 的 handler 锚点

**结论：`sub_42D4A0` 是 handler，`sub_457960` 是被调体 —— 现盘真源已经是对的，本轮无需改动。**

- 派发槽实读：`raw 22875`（file 22875）`*(_DWORD *)(_this + 677864) = sub_42D4A0;`
  （`675996 + 4*467 = 677864`）⇒ **handler = `sub_42D4A0`**。
- 体：`sub_42D4A0` raw **38111-38127** = 置步长槽 → `sub_41BF50(_this, 5/4/3)` 读 op5/op4/op3 →
  `v3 = sub_457960(_this + 21324, &v7, v2, v5, v6)` → `sub_42B4B0(_this, 1, v3 != 0)`、`sub_42B4B0(_this, 2, v7)`。
- 被调体：`sub_457960` raw **69327-69363** = 72B 记录表扫描（`flags & 0x20000000 && +24 == a5` 取 `+20`，
  遇组首停）；**形参 `a3` 在全函数体里一次都没出现**（= op3 读而不用）。
- 现盘 `analysis/opcodes.json` 的 `0x1D3`：`status=已核对`、`handler=sub_42D4A0`、
  `semantics` 已写明 `sub_457960` 是"被调体/真身" ⇒ **handler 字段不需要改**（`T-0111` 票面
  "表 `sub_42D4A0` vs 真源 `sub_457960`"的表述把两侧写反了，实际表与真源都记 `sub_42D4A0`）。
- 该条**不在** `analysis/opcode-gaps.json` 里 ⇒ 无需一并改。本轮给它的 journal 沿革由票面回链即可，未动字段。

## 3. 判据①(c)：全量对账

**现盘 `analysis/opcodes.json` 共 544 条，其中 `status == "仅映射"` 168 条。**
逐条与运行时三张表（并集 366）对账后：

- **文档仍 `仅映射` 但运行时已注册：1 条 —— `0x222`（dec 546，在 `OPS`）**。这是唯一的"文档过期"行。
- 其余 167 条都是**真的没注册**（命中即硬报错），不属"文档过期"。
- 168 条里语义非空的有 8 条（`0x89`/`0x8D`/`0x95`/`0x96`/`0x144`/`0x14A`/`0x221`/`0x2C2`）——
  它们的状态位与内容不一致，但**不属本轮范围**（见 §5"故意没做"）。
- 全表语义为空的 160 条，status 全是 `仅映射`。

`0x222` 的处置：`status` 仅映射 → **已核对** + 语义（raw 31923-31933 → 真身 `sub_4B4460` raw 136968-137285；
语料 10 处 / 10 文件；emulator 侧早就是 `OPS` 的 `op_scene_commit_range`，缺口台账 disposition = `implemented`，票 `T-0167`）。

### 3.1 顺带核到的一处"边缘不一致"

`0x222` 的 `opcode-gaps.json` 条目 `docStatus` 仍是 `仅映射` —— 那是**生成器实时从
`analysis/opcodes.json` 读的**（`build-opcode-gaps.mjs:221`），重跑生成器后会自动变成 `已核对`，
不需要单独改。

## 4. 补丁与自证

**计划文件**：`.tmp/t0111a/plan.json`，共 **17 处改写**：

| 文件 | 条数 | 内容 |
|---|---|---|
| `analysis/opcodes.json` | **9** | 9 条（8 条 + `0x222`）`status` → `已核对`、`semantics` 替换、每条 2 条 `journal[]` append |
| `analysis/opcode-gaps.json`（改） | **3** | 0x026/0x144/0x2FD：`note` 末尾追加"语料计数 + 为什么不影响"，`journal[]` append 1 条 |
| `analysis/opcode-gaps.json`（追加） | **5** | 0x105/0x2CA/0x309/0x339/0x22E：新条目 `disposition: unimplemented`（语料各 0 处） |

**自证 1（工具 dry-run，确切命令与输出）**：

```
$ node .tmp/settle/ledger-set.mjs --plan .tmp/t0111a/plan.json --dry
· analysis/opcodes.json: 266292 → 277091 字节
· analysis/opcode-gaps.json: 190384 → 195649 字节
（dry-run，未写盘）
exit=0
```

零报错、以"（dry-run，未写盘）"结尾。

**自证 2（模拟改写 + 棘轮自查，`.tmp/t0111a/simulate-apply.mjs`）**：在内存里复刻
`ledger-set.mjs` 的两阶段改写（含 `appendEntries`），然后对新文本逐项核：

```
== 模拟改写结果 ==
  analysis/opcodes.json: 266292 → 276911 字节
  analysis/opcode-gaps.json: 190384 → 195619 字节
  禁词命中（渲染字段）：0
== 新条目的语料计数（必须 0 处才配 unimplemented）==
  0x105: 0 处
  0x2ca: 0 处
  0x309: 0 处
  0x339: 0 处
  0x22e: 0 处
== 真源生成器 buildGapReport（在 .tmp 沙箱里跑新 gaps + 新 opcodes；src/engine/handlers 用 junction 指回真源）==
  条目 146；unimpl 5；deferred 19；partial 81；corpusKinds 338
  problems:
   - counts 已漂移（unimplemented: 声明 0 / 实际 5）⇒ 跑 node scripts/build-opcode-gaps.mjs
✅ 模拟自查通过（set/add/journal/missing/禁词 口径全部一致；生成器 problems 见上）。
```

★"`counts` 漂移"是**预期且必须由生成器回填**的（`build-opcode-gaps.mjs` 写模式会重算
`counts.byDisposition`），所以跑 `build-opcode-gaps.mjs` 是收尾必做项。

**自证 3（handler 与 raw 区间与实读一致，`.tmp/t0111a/verify-plan.mjs`）**：脚本从 `.c` 里现算
派发表项与体区间，逐条比对语义里写的 `handler=`／`raw A-B`：

```
0x026 dec=  38 handler=sub_41D6A0 slot=676148(raw 22753) 体raw=27431-27463 status→已核对 tables=未注册
0x105 dec= 261 handler=sub_421E20 slot=677040(raw 22981) 体raw=30503-30512 status→已核对 tables=未注册
0x144 dec= 324 handler=sub_433AB0 slot=677292(raw 23016) 体raw=42063-42152 status→已核对 tables=未注册
0x222 dec= 546 handler=sub_423EC0 slot=678180(raw 23072) 体raw=31923-31933 status→已核对 tables=OPS
0x22E dec= 558 handler=sub_424290 slot=678228(raw 23084) 体raw=32066-32084 status→已核对 tables=未注册
0x2CA dec= 714 handler=sub_430990 slot=678852(raw 23150) 体raw=40085-40097 status→已核对 tables=未注册
0x2FD dec= 765 handler=sub_431CF0 slot=679056(raw 23201) 体raw=40828-40943 status→已核对 tables=未注册
0x309 dec= 777 handler=sub_432000 slot=679104(raw 23213) 体raw=40956-41007 status→已核对 tables=未注册
0x339 dec= 825 handler=sub_4277A0 slot=679296(raw 23240) 体raw=34307-34327 status→已核对 tables=未注册
✅ 自证通过：每条 handler 与派发表一致、每条 raw 区间与体一致。
```

**自证 4（生成物一致性，`.tmp/t0111a/render-check.mjs`）**：按补丁后的 `opcodes.json` 渲染
`renderOpcodeTable()`，与现盘 `opcode-table.md` 逐行 diff = **恰好 9 行不同**（就是那 9 条），
其余 500+ 行逐字不变 ⇒ `doc-model.test.ts` 的"生成物必须最新"在重跑 build 后会绿。

## 5. 故意没做的 + 为什么

1. **没写 `analysis/opcode-gaps.json` 的 5 条新条目**（只给计划）：按任务纪律，`analysis/**` 由主线写盘。
2. **没跑任何生成器**（`build-opcode-table.mjs` / `scripts/asm/build-opcodes.js` / `build-opcode-gaps.mjs`）。
3. **没给这 8 条写 emulator 实现**：5 条语料 0 处（无从验证）；3 条要的宿主缝（DDraw 2D 特效、
   运行时外部服务表、输入层点击队列）都不存在，属 `T-0076` 的"按当前重写范围不做"。
4. **没把 167 条未注册的 `仅映射` 行转成 `unimplemented`**：它们是**语料 0 处**的行
   （`build-opcode-gaps.mjs` 只要求"语料用到就必须登记"），批量登记会凭空造出 160+ 条台账噪声，
   与本判据"逐条给出三选一处置并执行"的范围不符。★这是本票剩下的真正大块（见 §6 建议）。
5. **没改 `0x1D3`**：读体证明现盘 handler 字段本来就对（§2）。
6. **没动 `operandPlan.ts`**：这 9 条里 8 条未注册（落 T-0082 覆盖账的 B 桶）、`0x222` 早有计划，
   故不会顶红 `operand-plan.test.ts` 的 `C ≤ 3` 棘轮。
7. **没改 `analysis/functions.json`**：`T-0111` 的判据与票面都只要求 opcode 表口径，
   `functions.json` 的 `purpose` 属另一条线（且 8 条里多条已有条目）。

## 6. 读体时发现的与票面不符之处（逐条给证据）

1. **票面 / `acceptance` 的"语料 0 处"对 3 条不成立**（最要紧的一条）：
   - `0x026`：`src/SC0000.txt:13127 i026 2 f 10 1` ⇒ **1 处 / 1 文件**；
   - `0x144`：`src/SAVE.txt:560 i144 (local-string 0) (local-string-ptr 0)` ⇒ **1 处 / 1 文件**；
   - `0x2FD`：`ALLMAP:361`、`CGVIEWER:94`、`FIELD:1286`、`REIGN:468` 的 `i2fd … 2` ⇒ **4 处 / 4 文件**。
   三种口径（`Select-String '^\s*i0?26\b'`、自写扫描、真源 `scanCorpus`）一致，且票面自己也记着
   "语料 4 处：ALLMAP/CGVIEWER/FIELD/REIGN"（`opcode-gaps.json` 的 `0x2FD` note）——**同一条事实在两处自相矛盾**。
   后果：这 3 条**不能**按"语料 0 处"处置（它们不是"排期"问题，而是"宿主缝不存在"问题）。
2. **票面把 `0x1D3` 的 handler/被调体写反了**：它写"表 `sub_42D4A0` vs 真源 `opcodes.json` 的 `sub_457960`"，
   实际两侧都记 `sub_42D4A0`，而 `sub_457960` 是语义里的**被调体**（证据见 §2）。
3. **读体发现 `0x2FD` 的 5 个操作数不是"5 个 float 坐标"**：`sub_42AEA0`（raw 36755-36960）是
   **按操作数类型取指针**，所以 op2..op5 是**输出缓冲指针**（`sub_41BF50` 只读 int 类型），
   只有坐标本身是 float。票面/旧描述里"float 坐标/类型/编号数组"的说法容易误导实现者。
4. **读体发现 `0x105` 的 argc 与体不匹配**：`argc=1`，体只读 1 个操作数（一致），但 `0x026` 的
   `argc=4` 与 arity 槽 `9 = 2*4+1` 一致 —— 两条都自洽，只是提醒 `0x105` 的"查询标志"语义
   完全依赖 `_this[122246]` 的写者（**全库只有读、无写者**），所以它的语义只能写到"读某个标志"为止。
5. **`0xDD` 的订正已被本轮独立复核确认**：派发槽 `675996+4*221 = 676880` 在整份 `.c` 里零赋值
   （我按 `_this + 676880)` 全库搜过，0 命中），`fallbackDefault.entries` 与语料 `^idd\b`（0 处）都不含它
   ⇒ 非本作指令，表行本就不该有（与 `T-0163` 的读体结论一致）。

## 7. 交给主线的收尾清单

1. 跑 `node .tmp/settle/ledger-set.mjs --plan .tmp/t0111a/plan.json`（**不带 `--dry`**）。
2. 跑 `node scripts/build-opcode-table.mjs`（9 行变化）。
3. 跑 `node scripts/asm/build-opcodes.js`（它会同时写 `scripts/asm/opcodes.json` 与
   `app/amayui-emulator/src/generated/opcodes.json` —— `opcode-json-sync.test.ts` 要求两份逐字节相同）。
4. 跑 `node scripts/build-opcode-gaps.mjs`（**必须**：回填 `counts.byDisposition`，
   不跑则 `opcode-gaps.test.ts` 会红在"counts 已漂移"）。
5. 复跑守卫：`test/doc-model.test.ts`、`test/opcode-gaps.test.ts`、`test/opcode-arity.test.ts`、
   `test/opcode-operands.test.ts`、`test/operand-plan.test.ts`（预期全绿）。

## 8. 顺带给下一轮的观察（不属本判据，未开票）

- `仅映射` 里还剩 **167 条**，其中 **160 条语义全空**；它们全是**语料 0 处**。
  即：`T-0111` 判据①做完后，"文档与运行时的口径不一致"已归零，剩下的是
  **"167 条本作不用的 age-shared 指令该不该逐条读体"** 这个更大的口径问题 ——
  更像一条新的 `analysis` 票（而不是继续挂在本票上）。
- 16 条 `仅映射` 但语义非空（`0x89/0x8D/0x95/0x96/0x144/0x14A/0x221/0x2C2` 等）是
  "状态位没跟上内容"的另一类不一致，可一并纳入那条新票。
