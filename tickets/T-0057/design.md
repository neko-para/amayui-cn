# T-0057 design —— 正确的建模/抽象（本轮实施部分）

> 目标：把 `notes.md` 里的四类同型病（多处真源 / 魔法下标 / 临时补丁 / 重复实现）在**能被守卫机械拦住**
> 的地方先收敛掉。原则与本仓既有纪律一致：**一处语义一处实现**、**缺失必须留痕（不静默）**、
> **注释里的 sub_xxxx / 键名 / 下标必须来自可校验的来源**。

## 1. 配置键：从"手打字符串"到"注册表常量 + 静态守卫"

**现状问题**：`configRegistry.ts` 有一张 115 条的权威键表，但它只服务 `formatIni`/默认值；读取侧
（`cfgInt/cfgBool`）接受任意字符串。结果三个键拼错且**永不被发现**（拼错的键只是恒读默认值）：

| 代码里的键 | raw 里是否存在 | raw 真键 | 判据 |
|---|---|---|---|
| `set:keepmusicvoice` | 0 次 | `set:KeepMusicVolume`（raw 4411） | `sub_420CC0` raw 29769，`== 1` |
| `set:cancelmessagekey` | 0 次 | `set:CancelMesSkipOnClick`（raw 4346） | raw 20133，`== 2` |
| `set:controldisibiecursor` | 0 次 | `set:ControlDisibleCursor`（raw 4348） | raw 20246/20335，布尔 |

**建模**：
1. `configRegistry.ts` 额外导出一个**键名常量对象** `CFG`（由既有键表派生/对齐，命名用 `section:key` 的语义部分），
   读取侧只允许 `cfgInt(cfg, CFG.xxx)`。
2. 语义判定也要单一：新增 `cfgEquals(cfg, key, n)`（引擎大量使用 `== 1` / `== 2` 而不是"非 0"）。
3. 新增 `test/config-keys.test.ts`：
   - 扫 `src/**/*.ts` 里所有 `'section:key'` 形态的字面量，必须命中键表 ∪ **显式动态白名单**
     （`sound:Volume%d`、`debug:DebugOutFlag%d` 这类 `sprintf` 生成的键）；
   - 断言 `CFG.*` 的每个值都在键表里；
   - 断言三个幽灵键不再出现。
   ⇒ 以后新增键拼错会被测试立刻抓住，而不是"恒读默认值"。

## 2. 引擎字段：从"裸 dword 下标"到 `ENGINE_FIELD` 常量表

**现状问题**：`engineValues` 的键是 `_this[K]`（dword 下标）的裸数字。实测 68 处内联；命名表只落 8 个常量、
其中 4 个零引用；并且**下标空间（dword）与字节偏移空间在同一个仓库里混用**，直接导致 §3 的真 bug。

**建模**：
1. `src/vm/engineFieldIds.ts` 升格为 `ENGINE_FIELD`（`as const` 冻结对象，带分组与逐条注释：
   语义 / 写入端 / 读取端 / raw 或 opcode-table 依据）。旧的 8 个 `FIELD_*` 导出保留为别名（兼容既有 import）。
2. `src/vm/**` 内所有 `engineValues.get/set(<数字>)` 替换为 `ENGINE_FIELD.*`；带偏移的基址
   （如 `win + 122466`）也以基址常量 + 偏移表达。
3. **口径纪律写进文件头**：`engineValues` 的键恒为 dword 下标；raw 里的 `*(_DWORD*)(_this + N)` 必须先
   `N/4` 再当键（这正是 §3 的 bug）。需要字节偏移的字段在表里注明两个数。
4. 新增 `test/engine-field-ids.test.ts`：断言关键常量的取值（与 raw/opcode-table 锚点一致），
   并加一条 ratchet——`src/vm/**` 里出现新的 `engineValues.get/set(<数字>)` 即失败（存量清零后基线为 0）。

## 3. `0x1F5`：字节偏移被当成 dword 键（真 bug）

raw `sub_41A090`（`0x1F4`）：`if (_this[107438]) ++_this[107439]; else { _this[107438]=1; 时钟刷新 }`
raw `sub_41A0E0`（`0x1F5`）：`v = *(_DWORD*)(_this + 429756); ... *(_DWORD*)(_this + 429752) = 0;`

`_this` 在后者是 `int`（字节寻址）⇒ `429756/4 = 107439`、`429752/4 = 107438`——**与 0x1F4 完全同一对字段**。
重写侧把 `429756/429752` 当 `engineValues` 的键，于是：

- `0x1F4` 累加 107439（帧计数），`0x1F5` 递减的是永不存在的 429756 ⇒ 计数只增不减；
- `0x1F5` 清的 429752 也不是停靠锁 107438 ⇒ 停靠锁永不释放 ⇒ 之后 `0x1F4` 不再刷新时钟字段。

实测（`.tmp/probe-frame.mts`，本会话）：两次 `i1f4` 后 `107439=1`、`92333` 停在第一次的值；`i1f5` 后
`107439` 仍是 1、`429756=undefined`。

**建模**：用 dword 下标常量 `ENGINE_FIELD.frameCount`(107439) / `frameTickLock`(107438)；
守卫断言 `i1f4`×2 ⇒ 107439=1、i1f5 ⇒ 107439=0 且 107438=0，随后 `i1f4` 重新刷新时钟。

## 4. 静默错值：能读真值就不许写伪造值

- `0x106` → `Engine[550]`（opcode-table.md:214；raw 39043 `sub_42B4B0((int)_this, 1, _this[550])`）
- `0x201` → `Engine[166964]`（opcode-table.md:345；raw 39862 同形）

**建模**：与 `ENGINE_FIELD_STORE` 对称的 `ENGINE_FIELD_GET`（opcode → 字段）表；handler 只查表回写。
**没有依据的 getter 一律抛 `NotImplementedOp`**（ADR-005 的第一原则），不再 `v = 0`。

`op_mod` 同理：注释与 `opcode-table.md:81` 都写 C 语义 ⇒ `l % r`（JS 的 `%` 本身就是 C 的截断剩余）。
除零策略集中一处声明（`div`/`mod` 与引擎一致地抛），不再"一个抛两个静默"。

## 5. 删临时物与死码（保守清单）

只删**零引用或有明确 raw/文档反证**的东西：`src/tools/t0042c-colors.ts`（T-0042 的一次性探针）、
`src/vm/lzss.ts`（与 `src/script/lzss.ts` 同算法，保留前者会永久漂移）、`ScriptReset`（`new` 0 处）、
`stubs.ts` 的死 switch 分支、`live2d/deform.ts`/`moc.ts`/`fontSet.ts`/`systemPaths.ts` 里已确认零引用的导出、
`gameStartChain.ts` 的 `void clock/harness`。**不删**被测试引用或语义未定的字段（如 `charModeArg`）。

## 6. 守卫与等价性

| 改动 | 等价性判据 |
|---|---|
| R1 配置键 | `npm test`（engine-config / config-read / audio-opcodes / adv-msgwin）+ 新 `test/config-keys.test.ts`；`npm run report` 快照 |
| R2 字段表 | `npm run typecheck` + `npm test`（engine-field-store / registry-tables / op-a2-a3 / char-reveal / adv-msgwin / config1-chain）+ 新 `test/engine-field-ids.test.ts` |
| R3 0x1F5 | 新守卫（合成指令：i1f4/i1f5 的三步断言）+ `npm test`（frame-loop / wait-gate-timer / title-exit） |
| R4 getter/mod | `test/engine-field-store.test.ts` 扩用例 + `test/xval.test.ts`；`npm run op:inventory -- --path start` 计数 |
| R5 删死码 | `npm run typecheck` + `npm test` 全绿（删之前 `grep` 证明零引用） |
| R6 台账红 | `cd app/amayui-emulator && npx tsx --test test/ticket-ledger.test.ts` |

**全局闸门**：`npm run verify`（3×tsc + 全部测试 + 死写棘轮）必须全绿。
