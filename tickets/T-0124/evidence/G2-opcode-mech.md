# G2 组只读测试审计（VM / 操作数 / opcode 机制 / 派发 / 死写棘轮）

审计对象：`app/amayui-emulator/test/` 下 25 个测试文件（4575 行）。
审计者：只读测试审计员（未改动除本文件以外的任何仓库文件；未跑 `npm test` / `verify` / `shot`）。
判据：**价值 = 实现改坏时它会不会红，且红的理由正确**。注释质量、覆盖率数字一律不作为证据。

---

## 0. 摘要（先看这段）

1. **25 个文件全部没有"整文件无价值"的**，但 §4 逐条列出 **22 条问题断言**，其中 **16 条命中『无意义』的五种定义**：
   **同义反复 4**（`op-2ed-and-bit-index:112`、`operand-plan:523`、`call-frame:81`、`op-d0-wallclock:94`）、
   **镜像实现 5**（`operand-plan:564`、`registry-tables:46`、`op-a4-a6:73`、`op-a2-a3:407`、`call-frame:80`）、
   **无独立 oracle 1**（`operand-plan:445/468` 的派生守卫）、
   **重复覆盖 6**（`op-0202:109`、`op-underun-fixups:194`↔`op-a2-a3:240`、`op-underun-fixups:122`↔`op-a2-a3:392`、
   `operand-missing-slot-zero:89`↔`op-12e-hover-hittest:215`、`op-1cb-2c8-2c9:204`↔`operand-missing-slot-zero:63`、
   `op-a4-a6:112/144`↔`wait-gate-timer`/`slot-save-resume`）；
   另有 **6 条「可疑」**（弱断言 3、测试-测试耦合 / 日志文本判据 3）。
   ⇒ 本组的主要问题不是"测了假件"，而是**同一条不变量被 6~9 个文件各断一遍 + 少量自证断言**。
2. ★高风险模式（任务书点名）**成立但有重要例外**：`opcode-*` / `operand-*` / `registry-tables` / `no-dead-writes`
   并**不是**都在镜像 `src/script/opcodes.ts`。真正的事实是：
   - `opcode-arity.test.ts`、`operand-plan.test.ts`（第 1/2 条）的对照物是**反编译体 `engine/天结_unpacked.exe_utf8.c` 里的 arity 槽**
     与 `analysis/opcodes.json` —— 这是**E1 独立 oracle**，不是镜像；
   - `opcode-json-sync.test.ts` 是**生成物副本同步棘轮**（两份 `opcodes.json` 逐字节比对）—— 是镜像性质，但确有其防漂移用途；
   - `registry-tables.test.ts` 是**三表不相交不变式**，不是表内容镜像；
   - `opcode-operands.test.ts` / `operand-plan.test.ts` 第 3 条是**真行为观测**（Proxy 记录 handler 实际碰了哪几格）。
   ⇒ 结论：**没有一条 opcode 测试在断言"`src/script/opcodes.ts` 的表 == `analysis/opcodes.json`"**（那种才是纯镜像）。
   但**它们也都不测 emulator 的行为**（除 `opcode-operands` / `operand-plan`），所以分类应记为 `ratchet` 而非 `core`，这点必须写清。
3. **最慢的文件是 `opcode-gaps.test.ts`**：4 个用例里 3 次调用 `buildGapReport()`，实测 **1133 ms / 次**（扫描 `src/*.txt` 941 脚本）
   ⇒ 该文件约 3.3 s。其余文件无 `t.skip`、无明显慢用例（`op-underun-fixups` 的 16.7 M 次枚举实测仅 **~17 ms**）。
4. **新增调试能力（事件断点）对本组的替代面比想象的窄**：`b event global-int-write` 只覆盖 **global int/float/str 写入 + slot-bind**
   （`src/vm/engine.ts:144-148` 的 `DebugEventKind`、`src/vm/debugBreak.ts:484-489` 的 `EVENT_KINDS`、
   `matchEvent` 事件参数映射在 `src/vm/debugBreak.ts:434-441`），**不覆盖** local 槽写入、也不覆盖本组大量断言的
   `engineValues`（引擎字段）写入。⇒ 本组真正能被"现场一条命令"替代的只有 `op-1cb-2c8-2c9.test.ts:107-113` 这类
   "某 opcode 往 global N 写"的探针型断言；**建议扩展 `DebugEventKind` 加 `engine-field-write` / `local-int-write`**，
   才能把 `op-a4-a6`/`op-a2-a3`/`op-02-exit-minus11` 里的"谁写了 Engine[N]"断言降级为探针（见 §6）。

---

## 1. 口径

- **E 分档**：本组几乎全是 **E2（合成指令单测）**；`opcode-arity` / `operand-plan`(1,2) / `op-0202`(4) 是 **E1（已读体/静态真源）**；
  `op-02-exit-minus11` 部分用到 **listing（`.lst`）**；`op-a2-a3` 有 E1 依据但断言是 E2；**本组无 E3（真语料场景级断言）、无 E4（真机对照）**。
  ★注意：`opcode-arity` / `opcode-gaps` 里出现的"语料"是**静态扫描 `src/*.txt` 的台账口径**，不是"跑真脚本的 E3"。
- **类别**：`core`（引擎语义/不变量）| `ratchet`（台账/注册表/同步，防漂移不测行为）| `tool` | `scaffold` | `unknown`。
  本组没有 `scaffold`（没有只测测试自造假件的文件；最接近的是 `no-dead-writes` 的第 2/3 条，但那是**用合成输入测工具本身**，
  有独立判据，属 `tool`）。
- **oracle**：`独立`（`engine/*.c` 行号 / `analysis/*.json` / 手算期望 / listing）| `自造`（期望由被测代码或同源表算出）| `镜像`（断言实现自己的常量）| `无`。
- **cost**：是否跑真语料 / 是否含 `t.skip` / 是否明显慢（实测见 §8）。

---

## 2. 25 文件总表

| # | 文件 | 行 | 类别 | oracle | 强度 | cost | Verdict | 一句话理由（证据） |
|---|---|---|---|---|---|---|---|---|
| 1 | `opcode-arity.test.ts` | 139 | ratchet | **独立**（引擎体 arity 槽 + `analysis/opcodes.json`） | 强 | 读 5.2 MB 反编译 ×4（~0.2 s）；无 skip | **keep-ratchet** | 文档 `argc` ⟷ 体里 `_this[30*cur+95805]=N` 是 E1 独立真源，改坏解析口径或文档必红（`:44,:60-63`）；但它不测 emulator 实现，**不是 core** |
| 2 | `opcode-gaps.test.ts` | 134 | ratchet | 独立（941 脚本语料 + `analysis/opcode-gaps.json` + 生成物 md） | 强 | **最慢 ≈3.3 s**（`buildGapReport` 1133 ms ×3） | **keep-ratchet** | "语料用到而未注册 ⇒ 必须登记"的新增缺口棘轮（`:82-84`）+ md 逐字最新（`:55-59`）；`:106` 的 `note.length>=40` 是长度代理，弱但非零 |
| 3 | `opcode-json-sync.test.ts` | 50 | ratchet | 独立（权威=仓根真源） | 中 | 无 | **keep-ratchet** | 两处生成物逐字节比对（`:38-42`）+ `>500` 条防"两份都空"的假绿（`:47`）；只在手改副本时红 |
| 4 | `opcode-operands.test.ts` | 246 | **core** | 独立（doc `argc`，已由 #1 焊到引擎）+ 真行为观测 | 强 | 跑全部 **364 条已注册** handler（OPS 296 + NATIVE_OPS 55 + ENGINE_INTERNAL_OPS 13）；无 skip | **keep** | Proxy 观测 handler 真碰了哪几格，越界/漏读即红（`:227-234`）；29 条 `ALLOW_UNDERRUN` 白名单削弱但可控 |
| 5 | `operand-plan.test.ts` | 571 | core+ratchet | 独立（①②⑧）+ **自造**（④⑤ 期望由同族表推出） | 强 | 读 C 一次；无 skip | **keep + upgrade** | 第 3 条"计划 ⟷ 实现"是本组最强的行为守卫（`:329-435`，含 `deny/denyIo` 违规点名）；但 `:523-527` 是**同义反复**，棘轮提示串已失效（见 §4.5） |
| 6 | `operand-missing-slot-zero.test.ts` | 155 | core | 独立（key≠0 反例 + 引擎 raw 18773-18781） | 强（前 3）/ 中（后 2 条正则棘轮） | 无 | **keep（第 3 条 merge）** | "缺槽读 0" 的四条路 + `dec(KEY,0)≠0` 反例（`:63-71`）是真判据；`:89-107` 与 `op-12e-hover-hittest.test.ts:215-233` **重复覆盖** |
| 7 | `ptr.test.ts` | 167 | core | 独立（ADR-011 + 手算） | 强 | 无 | **keep** | lea/解引用/写穿/二维取址/memcpy/置零的语义逐条钉死（`:31-166`）；本地 `mk()` 变体（T-0020） |
| 8 | `call-frame.test.ts` | 96 | core | 独立（`sub_41C900` + fields 证据） | 中 | 无 | **keep + upgrade** | 帧往返 + 帧局部池生命周期（现场 bug 复现）是真的；但 `:80` 断言内部表示（`size===0`）、`:81` 是**同义反复**（`set(7,42)` 后 `get(7)===42`） |
| 9 | `registry-tables.test.ts` | 49 | ratchet | 独立（不相交不变式，非值镜像） | 强（①）/ 弱（②） | 无 | **keep-ratchet** | 三表两两不相交是真的静默掩盖缺陷（`:25-39`，注释里有 14 条实测重复）；②的 3 个抽查是镜像，可并入① |
| 10 | `no-dead-writes.test.ts` | 105 | ratchet + tool | 独立（②③ 合成夹具手写期望）/ 棘轮（①） | 强 | 静态扫 13 文件；无 skip | **keep-ratchet** | ①基线空 ⇒ 任何新增死写即红（`:28-33`）；②③证明检测器**有辨别力**（注释洗白反例 `:92-101`），不是只测脚手 |
| 11 | `op-underun-fixups.test.ts` | 399 | core | 独立（引擎 raw 行 + "形参未出现"死读判据） | 强 | 16.7 M 枚举实测 ~17 ms；无 skip | **keep + upgrade** | `0x2FC` 只写 op1（写日志 `:332`）、`0x1A0` 写序（`:366-370`）是终值看不出来的真判据；但 `whitelistKeys()` 读**另一个测试文件**的源码（`:61-68`），测试-测试耦合 |
| 12 | `op-02-exit-minus11.test.ts` | 226 | core | 独立（listing `0041A837-0041A895`）**但②部分依赖日志文本** | 强 | 无 | **keep + upgrade** | "无记录 0 不得抛 `ExitScript`"（`:100-106`）正是旧实现 bug；但 `:118-120,:151-152` 断的是 emulator 自己打的日志串，改名即红、真改坏却可能不红 |
| 13 | `op-0202-negative-fallback.test.ts` | 126 | core | 独立（引擎 raw 31381-31416 + 手算 ARGB） | 强 | 无 | **keep（第 3 条 drop）** | `-1/-1 ⇒ 当前色` 的根因守卫是真的（`:82-86`，旧实现给 `0xffffffff`）；`:109-115` 与 `op-203-draw-color-alpha.test.ts` 重复 |
| 14 | `op-141-135-bitops-unsigned.test.ts` | 191 | core | 独立（引擎 raw 30443-31017 + unsigned 语义） | 强 | 无 | **keep** | `-1` 按 unsigned 越界 ⇒ 不写配置/不写 op1/不抛（`:102-121,:141-152`）；改回有符号比较即红 |
| 15 | `op-191-fabs.test.ts` | 63 | core | 独立（`sub_42CEC0` raw 37896-37906 + 手算） | 中 | 无 | **keep（可并入算术族）** | 4 个值 + 注册表断言；很薄，但"此前零注册 ⇒ 命中即硬停"的回归锁是有效的 |
| 16 | `op-2ed-and-bit-index.test.ts` | 122 | core | 独立（引擎 raw 30443-30613 + 2EE→2ED 闭环） | 强（前 4 条）/ **无**（末条） | 无 | **keep + drop（末条）** | 位号 unsigned 口径 + `ShowMessageError` 消息原文（`:96`）是真判据；`:112-122` 的 argc 断言是**同义反复** |
| 17 | `op-23f-slot-size.test.ts` | 53 | core | 独立（`sub_4307B0` raw 40019-40031 + 手算 120×1000） | 强 | 无 | **keep** | 缺槽 −1 / 120000 / 释放后回 −1 的三态（`:36-52`），与 `0x1F8`/`0x1FA` 联动 |
| 18 | `op-327-32e-setweather-noop.test.ts` | 101 | core + ratchet | 独立（5 条 handler 地址 + `opcode-gaps.json`） | 强 | 无 | **keep** | "不再硬停且 ip 不变"（`:76-90`）是防止剧情整段走不完的回归锁；③是台账 disposition 棘轮 |
| 19 | `op-d0-wallclock.test.ts` | 98 | core | 独立（`sub_42E910` raw 38790-38797 + 注入时钟） | 中 | 无 | **keep + drop（`:94-97`）** | 值随注入时钟变化（`:82-88`）防"写死常量"；但 `:94-97` 是**同义反复**（第二个引擎从未跑 handler） |
| 20 | `op-string-len.test.ts` | 83 | core | 独立（SJIS 字节规则 + 引擎 raw 40063-40084/37974-37982） | 强 | 无 | **keep** | `0x2C5` 日文必须给 6 而非 3（`:65`）—— 这正是修前共用 handler 的 bug |
| 21 | `op-132-134-queue.test.ts` | 194 | core | 独立（引擎 raw 30647-30701/39359-39399 + FIFO 语义） | 强 | 无 | **keep** | 越界不改队列、`0x134` 两条写回只在 else（`:158-193`）、FIFO 顺序（`:134-148`） |
| 22 | `op-a2-a3.test.ts` | 412 | core（混少量 ratchet） | 独立（引擎 raw + 手算字段号） | 强 | 无 | **keep + merge** | `0x7B/0x199/0x7C` 重显示游标（含 dword 偏移订正）是真守卫；但 `0x1d3/0x1d4/0x2f3`、`0x249` 与 #11 重复，`:407-412` 是镜像 |
| 23 | `op-a4-a6.test.ts` | 243 | core | 独立（引擎 raw + spy 手写期望序列） | 强 | 无 | **keep + merge** | 11 条宿主缝的参数序列（`:216-228`）、0x256 区间平移（`:164-181`）真能红；`:73` 是常量镜像、`0x238` 与 `wait-gate-timer` 重复 |
| 24 | `op-a5.test.ts` | 253 | core | 独立（引擎 raw + 用户报障回归） | 强 | 无 | **keep** | `0xFB` 掩码位索引（`:145-152`）与鼠标左键别名（`:166-175`）是用户报障的直接回归锁；`0x93` 清路由表是**订正过的**真语义（`:62`） |
| 25 | `op-1cb-2c8-2c9.test.ts` | 299 | core | 独立（`sjisSubstrChars` 引擎不对称 raw 42435 + 2C7/2C8 对照） | 强 | 18 个用例；无 skip | **keep + merge** | `0x2C9` 负下标抛/非数组类型抛/写实补 0（`:195-281`）与 `0x2C7` vs `0x2C8` 对照（`:153-165`）是真判据；`:195-216` 与 #6 重复 |

**文件级 Verdict 汇总**：keep ×12，keep-ratchet ×5，keep+upgrade ×4，keep+merge/drop ×7（合计 25，含重叠计数）。
**没有 `drop` 整文件**，也没有 `unknown`。

---

## 3. 高风险模式逐条读断言（任务书点名）

### 3.1 `opcode-arity.test.ts` —— E1 核验，不是镜像
- `:44` 主用例：`r.step !== 2*r.argc+1` ⇒ 红。左值是**反编译体里 handler 写的指令长度**（`arityScan.ts:87-90` 两种写法都认），
  右值是 `scripts/asm/opcodes.json` 的 `argc`。
- `:96` 覆盖空洞棘轮：`noHandler` 必须**恰好等于** `analysis/opcodes.json.fallbackDefault.entries`（`:101-112`），
  `skipped` 必须**恰好**是登记的 3 条 `0x1/0x4/0x9`（`:113-123`）。⇒ **多一条少一条都红**，这是真棘轮。
- 反例实验：把 `analysis/opcodes.json` 的 `fallbackDefault.entries` 删掉一条 ⇒ `gone` 非空 ⇒ `:106` 红。
  把 `arityScan.ts:88` 的 `383220[\)\]]` 改成只认 `)` ⇒ 6 条（`0x60/0x236/0x240/0x241/0x24d/0x2c9`）掉进 `skipped` ⇒ `:117` 红。
  **改 emulator 的 handler 实现（例如 `op_23f` 不再写 `frame.operandCount`）：本文件全绿。** ⇒ 它守的是"文档 ⟷ 引擎"，不是"实现"。
- `:129` 第 3 条是几何自检（`N===0` 或奇数）+ 覆盖率计数（`rows.length>250`、`argc>0` 者 >150）。计数断言是弱的，
  但"奇数"这条能抓到解析口径退化。保留。

### 3.2 `opcode-gaps.test.ts` —— 缺口棘轮
- `:51` 断言生成器 `problems` 为空 + `:55-59` md 逐字等于渲染结果。md 比对是**生成物棘轮**（手改 md 即红），
  防的是"改真源忘重跑 `node scripts/build-opcode-gaps.mjs`"。
- `:62-85` 用**运行时三张表**再核一遍台账：`implemented` 必须在注册表且不在 no-op 表（`:69-72`），
  `unimplemented` 必须不在注册表（`:73-75`），no-op 表每条必须在台账里（`:78-80`），
  `report.missing` 非空直接 `assert.fail`（`:82-84`）。**这是"新增缺口无法静默"的核心**，有真值。
- `:87-113` 把审计 P0/P1 的 13 个 opcode 钉在册 + 4 条"体内有真实效果的 no-op"必须在册 + note 长度 ≥40 + unjustified 必须带票。
  ★`note.length>=40` 是**长度代理**（40 字的垃圾也能过），能防"note 被清空"，不能防"note 写错"。反例：把
  `0x244` 的 note 换成 `'x'.repeat(41)` ⇒ 本用例仍绿。判为**弱断言但非零价值**，建议改成"必须含 raw 行号正则 + 票号"。
- `:124-133` 反回归：`note` 全文不许漏进 md（`norm(note).slice(0,240)` 不许出现在 md 里），且 `big.length>=20` 保证样本量。
  这是**生成物体积**的守卫，能红（把 `summarize()` 换回全文即红），且自带辨别力下限。保留。
- cost 警告：`:50,:63,:88` 三次 `buildGapReport(ROOT)`，实测 **1133 ms/次**。建议把 report 提到 `before()` 里缓存一次。

### 3.3 `opcode-json-sync.test.ts` —— 生成物副本同步
- `:36-42` `Buffer.compare(a,b)===0`：两份 `opcodes.json`（仓根真源 + 包内副本）逐字节相同。
  ★这是**镜像性质**：两份都由 `node scripts/asm/build-opcodes.js` 一次写出，所以"不一致"只可能来自**手改其中一份**。
  反例实验：把包内副本里某个 `argc` 从 3 改成 4 ⇒ 红 ✓。但**把生成器改坏、让两份都写空数组** ⇒ 本用例**仍绿**，
  靠 `:47` 的 `list.length>500` 兜住 ⇒ 这两条合起来才是完整判据，缺一不可（文件头注释 `:17` 自己写了这点，属实）。
- 结论：`keep-ratchet`。它不测 emulator 行为，但成本近 0，删了会丢"手改生成物"这条闸。

### 3.4 `opcode-operands.test.ts` —— 真行为观测（本组最像 core 的一条）
- `:198` 主用例造**满 `argc`** 的合成指令跑真 handler，用 Proxy（`:158-163`）记录 `args[i]` 被取过哪几格：
  越界（`>argc`）⇒ `:243` 红；1..argc 有格子没被碰 ⇒ `:244` 红（除非在 `ALLOW_UNDERRUN`，**29 条**）。
- 反例实验：把 `handlers/gfx-texture.ts` 的 `0x1F9` 改回"只读 op1/op2" ⇒ `missing=[3]` ⇒ 红 ✓。
  把 `0x2C9` 改成读 `args[3]`（argc 3）⇒ `overrun` ⇒ 红 ✓。把 `0x71` 的某个 `readIntOperand` 删掉 ⇒ 红 ✓。
- 判据的可信度依赖 `argc` 的真值 —— 它来自 `scripts/asm/opcodes.json`，而那张表与引擎 arity 槽的关系由 #1 焊死。
  ⇒ **独立 oracle**（不是自造）。
- 弱点（如实标注）：① `ALLOW_UNDERRUN` 29 条里既有"真 bug 待修"也有"有据豁免"，混在一张表里虽然注释分了类，但**机械上无法区分**；
  ② `EXPECTED_THROW` 17 条会**吞掉**这些 opcode 的任何抛错（`:219,:237`），若某条 handler 退化成"总是抛"，本用例不会红；
  ③ 合成指令（全 int 槽）对"需要真实上下文才能读满"的指令只能靠白名单（`:63-65` 自己声明了）。
- `:245` `checked>250` 是覆盖率下限，防止扫描口径坏掉。合理。

### 3.5 `operand-plan.test.ts` —— 计划层守卫（本组最强 + 一处同义反复）
- `:286-303` 计划表自洽：`plan.argc ⟷ scripts/asm/opcodes.json`（**独立**）、`kinds/io.length === argc`（自洽，防手工表写错行）、
  `evidence` 非空、`kinds` 取值合法。★`kinds.length===argc` 两边都来自同一个声明对象 ⇒ 是**自洽检查**不是独立 oracle，
  但对一张 347 行**手写**表来说，"写错一行"是真实风险 ⇒ 算棘轮，不算无意义。
- `:305-327` **模型 ⟷ 体**：`operandCountSlotValue(op,argc)` 逐条等于反编译体写的 N，且"体写 0"的集合必须**恰好**等于
  `ZERO_LENGTH_OPS`（`:317-321`）。这是**独立 oracle**（引擎体），强。反例：把 `ZERO_LENGTH_OPS` 里的 `0x2` 删掉 ⇒ 红 ✓。
- `:329-435` **计划 ⟷ 实现**：对 347 条已迁移 handler 跑两遍（seed 0/1，`:401`）观测 touched 并集，要求
  ① 计划声明为 `r`/`rw` 的位必须被碰（`:429-431`）；② 不许越界（`:430`）；③ 计划层的 `deny`/`denyIo`/"没有声明计划"违规
  **不许吞**（`:414-421`）。★这是本组**唯一**能抓住"声明 r 却在写"这类方向错误的机械判据。
  反例实验：`declarePlan(0x261,…)` 注释掉 ⇒ `:453` 红（T-0082 evidence 里已实证过一次）。
- `:445-461` / `:468-489` 派生守卫：期望的 `argc`/方向**从 `ENGINE_FIELD_STORE` / `CFG_READ` 表推出**，再与 `planOf()` 比。
  ⇒ oracle 是**自造**（两边都是 emulator 内部真源），价值是"加了 spec 忘了声明计划"当场红，属棘轮。
- ★`:504-536` **含一处同义反复**：`:514-522` 的 if/else 链保证每个 `e` 恰好落进 `covered/A/B/C` 之一，
  于是 `:523` 的 `covered + A.length + B.length + C.length === checked.length` **恒真**（arrange 即 assert）。
  有价值的只有 `:528 covered>=347`、`:529 C.length<=3` 和 `:533` 的 console 台账。
- ★两处**失效的提示串**（不是 bug，但会误导）：`:288` 写 `棘轮：≥319` 而判据是 `>=347`；`:531` 的报错文案写
  `${C.length} > 250` 而阈值是 `3`。⇒ 建议一并订正（§7 第 2 件）。
- `:538-570` 运行期：dispatch 写 `frame.operandCount`、trace 报同值、`exit` 为 0。`:562` 是本用例的真判据（21），
  `:564` `assert.equal(t1.operandCount, operandCountSlotValue(0x32,10))` 在 `:562` 之后是**冗余**（同义反复的弱形态）。

### 3.6 `operand-missing-slot-zero.test.ts` —— 缺槽口径
- `:58-72` 四条读路（local-int / global-int / local int 数组 / global int 数组）+ `readRef` 两条，全部断言缺槽 = 0，
  并给出**反面对照** `dec(KEY,0)≠0`（`:71`）⇒ 这是"为什么不能沿用旧缺省"的独立判据。
- `:74-87` 反面：写过真值的槽照旧读回（含显式写 0，`:85`）⇒ 防"一律返 0"的过度修正。
  反例实验：把 `ref.ts:68` 的 `decIntSlot` 改回 `return raw ?? 0`（或 `i32(dec(key, raw ?? 0))`）⇒ `:63-68` 全红 ✓。
- `:89-107` 0x12E 端到端 —— ★与 `test/op-12e-hover-hittest.test.ts:215-233` **重复覆盖同一不变量的同一场景**
  （都是"margin 只登记基址、不写值 ⇒ 读 0 ⇒ 命中记录 0"，都用 key=0x12345678，都用 `local 1..4`）。见 §5。
- `:113-126` / `:128-155` 是**源码文本棘轮**：断言 `operand.ts` 里 `decIntSlot(` 出现**恰好 4 次**、
  `ref.ts` 的 int 分支走 `decIntSlot`、`hasRefValue(` 只许出现在 `memory.ts`（+ `region-hittest.ts` 白名单别名）。
  ⇒ 能红（重新引入第二套读口径即红），但**按计数**断言的脆性高：给某条路径加一个注释里的 `decIntSlot(` 也会红；
  且它守的是"实现形状"而非行为。**保留（棘轮）**，但建议把"计数 4"换成"导出的唯一门面 + 行为测试覆盖 4 条路"。

### 3.7 `registry-tables.test.ts` —— 三表不相交
- `:25-39` 三对 `Map` 交集必须为空。这是**真不变式**：解释器按 `OPS → NATIVE_OPS → ENGINE_INTERNAL_OPS` 查，
  同码重复登记不报错、只让先命中的静默生效（文件头 `:3-12` 列了 14 条实测历史）。反例：把 `0x303` 同时加进
  `MSGWIN_OPS` 与 `ENGINE_INTERNAL_OPS` ⇒ 红 ✓。
- `:41-48` 三个 size 下限 + `0x71/0x1f6` 在 `OPS`、`0x1111` 三表都不在。★后两条是**表内容镜像**（断言"表里有这个"），
  只有 `0x1111` 那条有真含义（防"通配/模糊注册"）。⇒ 判 `弱`，可并入①或删。

### 3.8 `no-dead-writes.test.ts` —— 死写棘轮 + 工具自检
- `:22-34` 对真实模型跑 `findDeadWrites(APP_ROOT)`，与**空基线**（`dead-writes.baseline.json` 的 `known: []`）比，
  新增死写 ⇒ 红。★注意 `:26` 的 `alive+dead > 20` 只是"扫到了东西"的下限，不是判据。
  反例实验：在 `src/renderer/drawitem/model.ts` 的 `Item` 里加一个 `foo: number` 并在某个 handler 里写它、全仓没人读 ⇒
  `:29-33` 红 ✓（这就是它的用途）。反过来，把 `DEFAULT_SCAN` 里某个消费者文件删掉 ⇒ 已消费字段被误报为死写 ⇒ 红（假阳性，
  但开发者会被逼去看，属可接受的摩擦）。
- `:36-58` / `:68-104` 用 `mkdtemp` **合成夹具**测检测器：① 只写不读必须被报（`:53`）、有消费者不许误判（`:54`）；
  ② 注释/字符串里的字段名不算读（`:90` 断言 `reads===1`），并把唯一真读也改成注释 ⇒ 必须回到死写（`:98-101`）。
  ⇒ oracle 是**独立**的（期望由夹具定义手写），能红（把 `stripCommentsAndStrings` 去掉 ⇒ `:90` 红）。
  ★这两条不是"测脚手"：它们证明工具**有辨别力**，而不是复述工具的实现。
- 弱点：`deadWrites` 是**静态正则**分类（模型文件 `interface` 字段 + 出现次数），`DEFAULT_SCAN` 是硬编码 13 个文件；
  文件头 `:19-27` 自己披露了局限（动态键访问的消费者识别不到）。⇒ 棘轮语义正确：**只防新增**，不作"这个字段一定没人用"的证明。

---

## 4. 「无意义 / 可疑」清单（带 `file:line` + 反例实验思路）

> 定义回顾：①同义反复（arrange 即 assert）②镜像实现 ③无独立 oracle ④重复覆盖 ⑤测脚手。

| # | 类型 | 位置 | 断言原文（节选） | 反例实验：把 X 改成 Y，还会绿吗？ |
|---|---|---|---|---|
| 1 | **①同义反复** | `test/op-2ed-and-bit-index.test.ts:112-122` | `assert.equal(instr(op, args).argc, args.length, ...)`；`instr` 来自 `test/harness.ts:33`，其定义就是 `argc: args.length` | 把这条测试里的 `cases` 换成任意 opcode/任意参数个数，**永远绿**。唯一能让它红的方法是改 `harness.ts` 的 `instr` —— 那时它会红，但红的是"harness 变了"而不是"四条指令的 argc 不对"。⇒ **删掉该 test**（`0x2ED/0x2EE/0x107/0x10B/0xFE` 的 argc 已由 `opcode-arity.test.ts:44` 与 `operand-plan.test.ts:295` 覆盖） |
| 2 | **①同义反复** | `test/operand-plan.test.ts:523-527` | `assert.equal(covered + A.length + B.length + C.length, checked.length, '分区必须覆盖全部已核对行')` | `:514-522` 的 if/else 保证每个 `e` 恰好 +1。把 `analysis/opcodes.json` 的任意一条 `status` 改成 `已核对X` ⇒ 该条进入循环 ⇒ 四个桶之和仍然 ≡ `checked.length` ⇒ **永远绿**。⇒ 删该断言，保留 `:528/:529` 两条棘轮 |
| 3 | **①同义反复** | `test/call-frame.test.ts:76,81` | `e.globals.int.set(7, 42);` … `assert.equal(e.globals.int.get(7), 42)` | 中间那段 `loadScriptIntoFrame(f0, …B.BIN)` 与两条 load 都跟这个断言无关（`:79-80` 才断言池重建）。把 `:79-80` 删掉，`:81` 仍绿；把 `0x55` 的 handler 改坏，`:81` 仍绿。⇒ 删。★另外 `:80` 的 `f0.locals.int.size === 0` 断言的是**内部表示**（稀疏 Map 为空），而引擎语义是"局部池被填 `enc_zero`"——若有人改成"预填 enc(0)"，行为等价却会红。建议改断"重新载入后读 local7 == 0"（行为） |
| 4 | **①同义反复** | `test/op-d0-wallclock.test.ts:94-97` | `e.curScript().locals.int.set(0x51, enc(e.key, 0x9999)); assert.equal(dec(e.key, …get(0x51) ?? 0)|0, 0x9999)` | 这个**新造的引擎从未跑过 `0xD0`**，只是 `enc`→`dec` 往返。把 `0xD0` 的 handler 整个改成写 3 个槽，本条仍绿。⇒ 删掉后半段；若要真守"只碰 op1"，应照 `op-underun-fixups.test.ts:273-283` 的 `WriteLog` 写法记录写入集合 |
| 5 | **②镜像实现 / ④重复** | `test/op-a2-a3.test.ts:407-412` | `assert.ok(OPS.get(0x1d2)); assert.equal(ENGINE_FIELD_OPS.some(([op]) => op === 0x25a), true, …)` | 断言的是"表里有这两条"。`0x1d2`/`0x25a` 的行为已在同文件 `:240`/`:184` 被真跑过 —— 把这两条 handler 的实现改坏，`:407-412` 仍绿（只要还注册着）。注释自认这是"侧面确认 index.ts 接线"。⇒ 删；接线问题由 `registry-tables` + 各行为用例覆盖 |
| 6 | **④重复覆盖** | `test/op-0202-negative-fallback.test.ts:109-115` | `0x203` 的 `-1/-1 ⇒ FROM = 当前色` | `test/op-203-draw-color-alpha.test.ts` 有 9 条专门用例，含 `:76`「α 与 color 都 < 0 ⇒ 整份当前色」与 `:89` 端到端。把 `0x203` 的回退拆掉 ⇒ 两个文件都红，**红的理由完全相同**。⇒ 删本条，或降级为一句"由 op-203 文件覆盖"的注释（`0x202` 自己的 4 条必须留） |
| 7 | **③无独立 oracle** | `test/operand-plan.test.ts:445-461,468-489` | `fieldStorePlanOps()` / `cfgReadPlanOps()` 推出的每条必须有计划 | 期望值来自 `handlers/engine-fields.ts`、`handlers/config-read.ts` 的表；被断言的是 `handlers/../operandPlan.ts` 的表。两边都是 emulator 内部真源，**没有引擎侧对照**。把 `ENGINE_FIELD_STORE` 与 `operandPlan` **同时**改错（例如都写成 argc=2）⇒ 本用例绿。⇒ 不是"无意义"（它抓"只改一边"），但应标注为**棘轮**而非 core；建议给这两族各补一条"argc ⟷ 引擎 arity 槽"的对照（#1/#5 已覆盖，可交叉引用） |
| 8 | **②镜像实现** | `test/operand-plan.test.ts:564` | `assert.equal(t1.operandCount, operandCountSlotValue(0x32, 10))` | 上一行 `:562` 已经断言 `=== 21`（手算）。把 `operandCountSlotValue` 改成别的实现，`:562` 会先红；本条只在两处**同时**改错时才有增量。⇒ 冗余，删。另 `:445` 的 `rows.length>=14`、`:470` `rows.length>=10` 是表规模镜像（防表被删空），保留但标注弱 |
| 9 | **②镜像实现** | `test/registry-tables.test.ts:46-48` | `OPS.has(0x71)`、`OPS.has(0x1f6)` | 断言"表里有这个"。把 `0x71` 的实现换成空函数 ⇒ 本用例绿。⇒ 建议删这两条，保留 `0x1111` 三表皆无（那条防的是"通配注册"，有真含义） |
| 10 | **②镜像实现 / 弱** | `test/op-a4-a6.test.ts:73` | `assert.equal(AGERC_EXPORTS.length, 21)` | 硬编码 21 对 `handlers/agerc.ts` 的常量。把一个导出名改掉（长度不变）⇒ 绿；把导出表删到 20 条 ⇒ 红。⇒ 价值仅"防表缩水"，保留但标弱；若想真守，应对 `AGERC_EXPORTS` 的名字集合做**逐名**快照（现在没有） |
| 11 | **弱断言 / 长度代理** | `test/opcode-gaps.test.ts:105-107` | `(e.note ?? '').length >= 40` | note 改成 `'x'.repeat(41)` ⇒ 绿。⇒ 建议换成"必须含 raw 行号 + 票号"的正则（同文件 `op-underun-fixups.test.ts:262-264` 已有可抄的写法） |
| 12 | **弱断言** | `test/opcode-arity.test.ts:138` | `rows.filter(r=>r.argc>0).length > 150` | 覆盖率下限，不是判据。防"解析口径只认出 argc=0"的假绿 —— 有微小价值，保留但不应计入强度 |
| 13 | **弱断言 / 泛化负断言** | `test/op-a5.test.ts:242-252`、`test/op-a4-a6.test.ts:231-242` | "N 条都不写脚本操作数"：给每条 op 传 5~8 个 global int，断言 op1/op2 不变 | 断言的是**终值**。把某个 handler 改成"先写 op1=7 再写回原值"（或写到别的槽）⇒ 仍绿。而且传的参数个数大于这些指令的真实 `argc`（合成越界指令）。⇒ 改为 `WriteLog` 式**写入集合**断言（沿 `op-underun-fixups.test.ts:273-283`），或直接删（同一不变量已由 `operand-plan` 的 `io=['r']` 声明 + `opcode-operands` 的 touched 观测覆盖） |
| 14 | **④重复覆盖** | `test/op-underun-fixups.test.ts:194-204,206-251` ↔ `test/op-a2-a3.test.ts:240-314` | `0x1d3`/`0x1d4`/`0x2f3` 的命中/未命中输出 | 两处都断言 `0x1d3 ⇒ [1,100,0]`、`0x1d4 ⇒ [0x7001,0,0]`。把 handler 改坏 ⇒ 两个文件都红，理由相同。⇒ 保留 `op-underun-fixups` 的"死读格不得被碰"（独有）+ `op-a2-a3` 的"组首停止/语音字段映射"（独有），**互相删掉重合的输出值断言** |
| 15 | **④重复覆盖** | `test/op-underun-fixups.test.ts:122-188` ↔ `test/op-a2-a3.test.ts:392-404` | `0x249` 的 `0xff00ff00` 归一化 | `op-underun-fixups` 已把 24 位**全枚举**并与引擎公式比对（`:175-187`），`op-a2-a3` 只断言一个值 ⇒ 完全被蕴含。⇒ 删 `op-a2-a3:401` 的那一行，或在该文件注明"归一化由 op-underun-fixups 覆盖" |
| 16 | **④重复覆盖** | `test/operand-missing-slot-zero.test.ts:89-107` ↔ `test/op-12e-hover-hittest.test.ts:215-233` | 0x12E margin 未写 ⇒ 读 0 | 两者都用 key=0x12345678、都用未写的 `local 1..4`、都断言命中记录 0。⇒ 保留 `op-12e` 的（场景更完整，含"真写了 margin 行为不变"的对照），G2 文件删掉该条，只留四路读 + 两条源码棘轮 |
| 17 | **④重复覆盖** | `test/op-1cb-2c8-2c9.test.ts:195-216` ↔ `test/operand-missing-slot-zero.test.ts:58-72` | `key≠0` 时缺槽读 0 | G2 内部两处断言同一口径。⇒ `op-1cb-2c8-2c9` 该条只保留 `0x2C9` **扩容写实**（`frame.locals.int.has()` 为真，`:213`）这一独有部分，缺槽读 0 的断言（`:204-208`）删掉 |
| 18 | **④重复覆盖（弱）** | `test/op-a4-a6.test.ts:112-118` `0x238` ↔ `test/wait-gate-timer.test.ts:64-86`；`test/op-a4-a6.test.ts:144-154` `0x258` ↔ `test/slot-save-resume.test.ts:269-278` | `Engine[92338]=0/[92339]=op1`；`texSlotFlags` bit0/bit1 | 后者是完整守卫（门行为、清表联动），前者只断两个字段值。⇒ 可删前者（或降级为一行冒烟） |
| 19 | **②镜像实现（可接受）** | `test/op-d0-wallclock.test.ts:70-74`、`test/op-191-fabs.test.ts:57-58`、`test/op-132-134-queue.test.ts:88-92`、`test/op-1cb-2c8-2c9.test.ts:61-67`、`test/op-a2-a3.test.ts:63-73`、`test/op-a4-a6.test.ts:45-51`、`test/op-a5.test.ts:39-44` | `assert.ok(OPS.has(op))` + `assert.ok(!ENGINE_INTERNAL_OPS.has(op))` | 全是表成员镜像。**单独看很弱**，但它们防的是本工程真实发生过的一类事故："把 opcode 从 stub 升级成真实现时忘了删旧桩"（`registry-tables.test.ts:3-12` 列了 14 条历史）。⇒ 建议**合并成一张数据表**（§7 第 2 件），而不是删掉 |
| 20 | **测试-测试耦合（可疑）** | `test/op-underun-fixups.test.ts:61-68` | `whitelistKeys()` 用正则解析 `test/opcode-operands.test.ts` 源码里的 `ALLOW_UNDERRUN` | 把 `opcode-operands.test.ts` 里的 `const ALLOW_UNDERRUN: Record<string,string> = {` 改成 `satisfies Record<string,string>` ⇒ `:64` `assert.ok(block)` 红 —— **红的原因与被测行为无关**。⇒ 改为把白名单抽成共享模块（`test/underunAllowlist.ts`）双向 import |
| 21 | **脆弱正则（可疑）** | `test/operand-missing-slot-zero.test.ts:117-121` | `(operand.match(/decIntSlot\(/g) ?? []).length === 4` | 在 `operand.ts` 里加一句注释 `// 都走 decIntSlot(` ⇒ 计数变 5 ⇒ 红。⇒ 改成"导出唯一门面 + 4 条路的行为用例"，别数出现次数 |
| 22 | **判据依赖日志文本（可疑）** | `test/op-02-exit-minus11.test.ts:118-120,151-152` | `assert.match(joined, /sub_40F750\(sv1=1, sv2=0\)/)`、`/两支都不进 ⇒ 直接 return（不动作）/` | 断言的是 emulator 自己打的日志串。**改日志文案（行为不变）⇒ 红**；反过来，若某分支的行为被改坏但日志仍在最前面打 ⇒ **绿**（`op-02` 里 `:100-106`/`:175-179` 的可观测断言才是主力）。⇒ 把分支判据换成可观测效果（装了哪张脚本 / 写了哪些字段 / `callRet`），日志只作补充 |

**不是无意义但容易误判的两条（如实澄清）**：
- `test/opcode-json-sync.test.ts:45-50`：看着像"条数自证"，但它是**防两份都空**的假绿闸（`:17` 注释自述），属必要配套。
- `test/no-dead-writes.test.ts:36-104`：看着像"测脚手"，但它用**合成夹具**验证检测器的辨别力（正向 + 反向 + 注释免疫），
  有独立判据，是**工具测试**的正确形态。

---

## 5. 重复覆盖矩阵

### 5.1 G2 内部

| 不变量 | 出现处（G2） | 去重建议 |
|---|---|---|
| 某 opcode ∈ `OPS`/`NATIVE_OPS` ∧ ∉ `ENGINE_INTERNAL_OPS` | `op-a2-a3:63`、`op-a4-a6:45`、`op-a5:39`、`op-1cb-2c8-2c9:61`、`op-191:57`、`op-d0:70`、`op-132-134:88`、`op-327:70`（8 处，另加 `registry-tables:41` 的抽查） | 合并为一张 `{op, class, ticket}` 数据表 + 一条断言（**保留**语义：升级实现忘删旧桩） |
| handler 碰的操作数 = 1..argc 且不越界 | `opcode-operands:198-245`（全部已注册，doc argc）、`operand-plan:329-435`（347 条，计划 io） | 保留两条（口径不同：doc argc vs 计划 io/方向），但把 `operand-plan` 的 `MIGRATED` 与 `opcode-operands` 的 `ALLOW_UNDERRUN` 交叉引用，避免两处各自维护 |
| 缺槽读 0（key≠0） | `operand-missing-slot-zero:58-72`、`op-1cb-2c8-2c9:195-216`、`op-a2-a3`（无）、`operand-plan`（无） | 见 §4 第 17 条：G2 内保留前者，后者只留 0x2C9 写实部分 |
| 0x12E margin 未写 ⇒ 读 0 | `operand-missing-slot-zero:89-107`、`op-12e-hover-hittest:215-233` | 保留非 G2 那条（场景更全），删 G2 那条 |
| `0x1d3/0x1d4/0x2f3` 命中/未命中输出 | `op-underun-fixups:194-251`、`op-a2-a3:240-314`、`op-1d0-page-index:350-364`（非 G2，⑪） | 三处保留"各自独有"的部分：死读格不碰（#11）、组首/语音字段（#22）、0x1d0→0x1d3 真语料形状（非 G2）；**删掉重合的输出值断言** |
| `0x249` 颜色归一化 | `op-underun-fixups:122-188`（24 位全枚举）、`op-a2-a3:392-404` | 删后者 |
| "取组内最后一次匹配（不提前 break）" | `op-a2-a3:259-261`、`op-1d0-page-index:357`（⑪） | 保留一处（建议留非 G2 的真实语料形状那条） |
| `0x100` 派发语义 | `op-a5:122-177`（掩码位索引 + 鼠标别名）、`keyboard-mask:75-115`（键盘位 + 返回点不对称）、`input:217`（默认键分支） | **不重复**，三条互补，保留 |
| `0x238` 计时器 / `0x258` 槽标志 | `op-a4-a6:112-118/144-154`、`wait-gate-timer`（非 G2）、`slot-save-resume:269-278`（非 G2） | 删 `op-a4-a6` 的两条字段级重复 |
| 写入"有读者的引擎字段"的写序 | `op-underun-fixups:307-338`（0x2FC）、`:340-399`（0x1A0） | 本组独有，保留（**这是终值断言抓不到的错**，T-0082 已实证三次变异） |
| "不写脚本操作数"泛化负断言 | `op-a5:242-252`、`op-a4-a6:231-242` | 两处同形，建议合并成一条共享 helper 或直接删（已被计划层 `io` 覆盖） |

### 5.2 与全仓其它测试

| G2 文件:行 | 重复对象 | 说明 |
|---|---|---|
| `operand-missing-slot-zero:89-107` | `op-12e-hover-hittest.test.ts:215-233` | 同一场景同一断言（见上） |
| `op-0202-negative-fallback:109-115` | `op-203-draw-color-alpha.test.ts:66-105` | `0x203` 回退规则，后者 9 条完整 |
| `op-a2-a3:392-404` | `op-underun-fixups:122-188` + `debug-event-break.test.ts:77-95`（非 G2，slot-bind 事件） | 见上；`debug-event-break` 那条是不同不变量（事件发射），不算重复 |
| `op-a2-a3:240-314` | `op-1d0-page-index.test.ts:350-364`（⑪ 真实语料形状） | 部分重合 |
| `op-2ed-and-bit-index:44-53` | `op-2ee-message-fade.test.ts:90-108` | `0x2EE` 写侧；G2 那条是 2EE→2ED 读回闭环（增量：读侧注册），**保留但需在注释里点明增量** |
| `op-1cb-2c8-2c9:153-165` | `config-version-substr.test.ts:170`（`0x2C7` 越界切空串） | 部分重合（G2 那条断 2C7/2C8 语义差，非 G2 那条断越界） |
| `op-141-135:102-121` | `config-version-substr.test.ts:215`（用 `0x141` 当"配置写通知"载体） | 不同不变量，不算重复 |
| `op-a4-a6:112-118` | `wait-gate-timer.test.ts:64-86`、`scene-report`（`0x238` 出现） | 字段级重复 |
| `op-1cb-2c8-2c9:195-216` | `operand-missing-slot-zero`（G2 内） | 见上 |
| `op-a2-a3` 各条 | `adv-msgwin` / `char-reveal` / `op-1d0-page-index`（`0x71/0x80/0x1bb/0x1d2` 等被大量共用） | 这些都是**场景级**测试用它们当载体，不是不变量重复；**不计入去重** |

### 5.3 结构债（影响本组可维护性）
- **17 处各自造的 `mk()` 变体**（`tickets/T-0020`）：本组里 `ptr:13`、`call-frame:14`、`opcode-operands:130`、
  `op-underun-fixups:44`、`operand-plan:342`、`op-132-134:53`、`op-a2-a3:37`、`op-a4-a6:31`、`op-a5:26`、
  `op-1cb-2c8-2c9:42`、`op-141-135:74`、`op-string-len:27`、`op-d0:38`、`op-191:20`、`op-327:43`、`op-0202:50`、
  `op-23f:18` 各自造引擎/脚本/指令。**唯一用公共 `mkEngine` 的是 `op-2ed-and-bit-index:31`**。
  ⇒ 后果不是啰嗦，而是**同一批断言在不同文件里跑的是不同形状的指令**（`harness.ts:5-9` 自己写了这一点）。
  建议：把"按计划类型造实参 + Proxy 观测 touched"抽成 `test/operandHarness.ts`，
  `opcode-operands` / `operand-plan` / `op-underun-fixups` 三处已有**逐字重复的实现**（三份 Proxy 代码）。

---

## 6. 新增调试能力：探针型 vs 守卫型

### 6.1 `dbg` 现状（只读核对，未运行）
- `tools/dbg.cjs`（114 行）→ `tools/debugsrv.cjs`（TCP 127.0.0.1:39427）；条件断点 `b global 0x11 == 5260`、
  事件断点 `b event global-int-write idx == 3318`。
- 事件种类**只有 4 种**：`global-int-write` / `global-float-write` / `global-str-write` / `slot-bind`
  （`src/vm/engine.ts:144-148`（`DebugEventKind`）、`src/vm/debugBreak.ts:484-489`（`EVENT_KINDS`）、
  `matchEvent` 参数映射在 `:434-441`）。
  ⇒ **`engineValues`（引擎字段 `Engine[N]`）的写入、local/帧内槽的写入，目前都没有事件。**

### 6.2 对本组的具体影响

| 本组断言形态 | 例子 | 事件断点能否替代 | 建议 |
|---|---|---|---|
| "某 opcode 往 **global int N** 写" | `op-1cb-2c8-2c9:107-113`（`i1cb (global-int 139d)`）；`operand-missing-slot-zero:64`（global-int 读） | ✔ `b event global-int-write idx == 0x139d` 可**现场**回答"谁在什么脚本/什么 ip 写了它、写了什么"。★但只能观测 global 池，且需要真会话跑到那里 | **降级为"守接口"**：保留一行"该 opcode 已注册 + 计划声明写目标"的棘轮，把"值确实落到 global"交给 `dbg` 现场查 + 真语料 E3 |
| "某 opcode 写 **Engine[92338]/[95777]/[122452]/[107678]**" | `op-a4-a6:112-118`、`op-02:109-110`、`op-a2-a3:95-110`、`op-a5:207-213` | ✘ 事件种类里**没有** engine-field 写 | **扩展 `DebugEventKind` 加 `engine-field-write`（`idx`/`val`）**并在写点 `emitDebugEvent`。⚠可行性前提：`engineValues` 目前**没有统一写门面**（`src/vm/engine.ts:450-451` 的 `panelField` 只是其中一条，全仓还有多处直接 `engineValues.set`）⇒ 要先立门面（或至少覆盖 `panelField` + handlers 的写点）。落地后 `b event engine-field-write idx == 92338` 一条命令即可回答"谁装了等待门"，这些"字段值断言"可只留 1 条冒烟 |
| "写 **local** 槽 / 帧内槽" | `op-underun-fixups:307-338`（0x2FC 只写 op1）、`:340-399`（0x1A0 写序）、`op-132-134:120-148`（0x134 的 op2/op3 出参） | ✘ 无 local 事件（条件断点只能"执行前看状态"，看不到"谁写的"） | 建议加 `local-int-write`（`frame`/`idx`/`val`）事件；**但写序类断言（0x1A0/0x2FC）即使有了事件也应留回归**，因为它是 E2 里唯一能抓"写序提前"的形态 |
| "纹理槽绑定" | `op-underun-fixups:106-116`、`op-a2-a3:392-394` | ✔ 已有 `slot-bind`（`debug-event-break.test.ts:77-95` 已测） | 现场排查用 `b event slot-bind imgid == 0x5250`；E2 断言保留（成本近 0） |
| "这条路径走过哪些 opcode / 缺口几个" | `opcode-gaps:112`（`corpusKinds>200`） | ✘ 但 `npm run op:inventory` 直接给真实链路的 opcode 表 | 二者口径不同（全语料 vs 单路径），**都要留**；`op:inventory` 是排查入口，台账是棘轮 |

### 6.3 结论（回答任务书的★问题）
`b event global-int-write idx == N` **确实**能把"某个 global 被谁写"从"读脚本 → 写 E3 用例"变成**现场一条命令**，
因此**探针型**断言（为定位"是谁写的"而存在的 E3/E2）可以降级为"守接口"。
但**在本组 25 个文件里，这种形态只有 2~3 处**（`op-1cb` 的 global 变体、`operand-missing-slot-zero` 的 global 读对照）；
本组绝大多数断言是**守卫型**（语义/口径/写序/不变量），事件断点**不能**替代：
- 它观测不到 local 槽与 engine 字段（占本组断言的大头）；
- 它需要真会话跑到那个点（本组用合成指令正是为了**不**依赖会话）；
- 它回答"是谁写的"，不回答"写错了会怎样"。
⇒ **建议投资方向**：给 `DebugEventKind` 补 `engine-field-write` + `local-int-write`，
这样 §4 里第 18 条那类"字段值断言"（`op-a4-a6` 的 `Engine[92338]`）可以压缩，把省下的预算投到 E3（真语料场景）而不是继续加 E2。

---

## 7. 本组最该改的 3 件事

### 第 1 件：清掉 4 处同义反复 + 5 处镜像/重复（删代码，不减故障检出能力）
按 §4 的 1/2/3/4/5/6/9/16/17 条执行：
1. 删 `test/op-2ed-and-bit-index.test.ts:112-122`（argc 自证；harness 定义即 `argc: args.length`）。
2. 删 `test/operand-plan.test.ts:523-527` 的恒真分区等式**并**修正两处失效提示串：`:288` 的 `棘轮：≥319` → `≥347`，
   `:531` 的 `${C.length} > 250` → `> 3`。
3. 删 `test/call-frame.test.ts:81`（`set(7,42)`→`get(7)===42`），把 `:80` 的 `locals.int.size===0`（内部表示）
   换成行为断言"重新载入后读 local7 === 0"。
4. 删 `test/op-d0-wallclock.test.ts:94-97`；若要真守"只碰 op1"，用 `op-underun-fixups.test.ts:273-283` 的 `WriteLog` 写法重写。
5. 删 `test/op-a2-a3.test.ts:407-412`（镜像 + 重复）；删 `test/op-0202-negative-fallback.test.ts:109-115`（0x203 由专文件覆盖）；
   删 `test/operand-missing-slot-zero.test.ts:89-107`（0x12E 由 `op-12e-hover-hittest.test.ts:215-233` 覆盖）；
   删 `test/op-1cb-2c8-2c9.test.ts:195-210`（保留 `:211-215` 的"扩容写实"独有部分）；具体为：删掉
   `:204-208`（缺槽读 0，与 `operand-missing-slot-zero.test.ts:63-68` 同义），保留 `:209-215`
   （尤其 `:213` 的 `frame.locals.int.has(BASE+k) === true` —— "扩容把槽写实、不只是读时当 0"是本文件独有判据）。
预期效果：删掉 ~70 行**永不红或红错理由**的断言，**不损失**任何故障检出（每条被删断言都有同源或更强的替身，表格里已给替身位置）。

### 第 2 件：把 8~9 处 per-opcode「注册表棘轮」合并成一张数据表；把跨文件白名单抽成模块
- 现状：`op-a2-a3:63`、`op-a4-a6:45`、`op-a5:39`、`op-1cb-2c8-2c9:61`、`op-191:57`、`op-d0:70`、`op-132-134:88`、`op-327:70`
  + `registry-tables:41-48` 的抽查，各自复述同一个不变式（8~9 份），改一处分类要改 9 个文件。
  ⇒ 新建 `test/registryClass.test.ts`：一张 `[op, expectClass, ticket]` 表 + 一条断言，各票文件只保留自己的**行为**用例。
- 现状：`op-underun-fixups.test.ts:61-68` 用正则**解析另一个测试文件的源码**取 `ALLOW_UNDERRUN`（改一行声明语法即误红）。
  ⇒ 把 `ALLOW_UNDERRUN` / `EXPECTED_THROW` 抽到 `test/operandAllowlist.ts`，两个文件共同 import。
- 现状：`operand-missing-slot-zero.test.ts:117-121` 用"`decIntSlot(` 出现 4 次"守唯一读口径。
  ⇒ 改为在 `ref.ts` 导出唯一门面并在行为用例里覆盖 4 条路（`operand.ts` 不再直接出现 `dec`）。
- 现状：三份逐字重复的 Proxy touched 实现（`opcode-operands:158-163`、`operand-plan:365-371`、`op-underun-fixups:48-53`）
  ⇒ 抽 `test/operandHarness.ts`（也顺带缓解 `tickets/T-0020` 的 17 处 `mk()` 变体债）。

### 第 3 件：把判据从"日志文本 / 终值"升级为"可观测效果 / 写入集合"，并用新调试能力减少 E2 面积
1. `test/op-02-exit-minus11.test.ts:118-120,151-152`：分支判据目前匹配 emulator 自己的日志串（改文案误红、真改坏可能不红）。
   ⇒ 改成可观测效果：装/未装脚本（`e.curScript().name`，`:175` 已有）、`engineValues.callRet`、`saveResume.pendingRecord0`
   是否被消费；日志只作 `console.log` 输出。
2. `test/op-a5.test.ts:242-252` + `test/op-a4-a6.test.ts:231-242`（"不写脚本操作数"终值断言）
   ⇒ 用 `WriteLog`（`op-underun-fixups.test.ts:273-283`）断"写入集合为空"，才能抓"写了又写回"。
3. `test/no-dead-writes.test.ts:36-104` 已是正确的工具测试形态，**照它给"每个断言都要有能红的反例"立规范**：
   把 §4 表格里的"反例实验"直接写成注释块（现在只有 T-0082 的 4 条棘轮有这种习惯，见 `operand-plan.test.ts` 的
   `fieldStorePlanOps` evidence）—— 这是把"无意义断言"挡在门外的**唯一机械办法**。
4. 用 §6.2 的 `dbg` 扩展（`engine-field-write` / `local-int-write`）把"谁写了 Engine[N]"降级为探针；
   省下的精力投 **E3（真语料场景断言）** —— 本组 25 个文件里 **E3 = 0**，而 §4 的多数弱点（合成指令给不出真实上下文、
   `EXPECTED_THROW` 17 条吞异常、`ALLOW_UNDERRUN` 29 条含"缺消费端"才是真正暴露面）恰恰只能靠真语料补。

---

## 8. 附录：实测数据与未做项

**实测**（只跑了度量用的一次性脚本，未跑 `npm test`/`verify`/`shot`）：
- `engine/天结_unpacked.exe_utf8.c` = 5,239,745 B / 184,091 行；`readFileSync + split('\n')` × 8 = **198 ms**（~25 ms/次）。
- `scripts/build-opcode-gaps.mjs#buildGapReport`：**1133 ms / 916 ms**（两次），`entries=71`、`corpusKinds=338`、`missing=0`。
  ⇒ `test/opcode-gaps.test.ts` 调用 3 次 ≈ **3.3 s**，是本组最慢文件（建议缓存到 `before()`）。
- `op-underun-fixups.test.ts:175` 的 24 位全枚举（16,777,216 次）：**~17 ms**（不慢，注释里的顾虑不成立）。
- `ALLOW_UNDERRUN` 键数 = **29**；`EXPECTED_THROW` = **17**；`MIGRATED` = **347**（与 `operand-plan:288` 的 347 一致）。
- 已注册 opcode = **364**（`OPS` 296 + `NATIVE_OPS` 55 + `ENGINE_INTERNAL_OPS` 13）⇒ `opcode-operands` 逐个真跑的就是这 364 条；
  三表两两不相交，故 296+55+13 = 364 无重复计数。
- 全仓 `test/*.test.ts` = **159** 个文件；本组 25 个 = 15.7%。
- G2 组内 `t.skip` / `test.skip` = **0**。

**未做**：
- 未运行 `npm test`（纪律），因此「强度」列是基于**读断言体 + 反例推演**的判定，不是变异测试的实测结果。
  凡标 `强` 的，报告中都给了具体的"改成 Y 会不会红"的推演依据（§3/§4）。
- 未运行 `dbg` / `record` / `replay` / `op:inventory`（会抢 CPU / Electron 窗口）；§6 的结论基于源码只读核对
  （`src/vm/engine.ts:144-148`、`src/vm/debugBreak.ts:434-441,484-489`、`tools/dbg.cjs`）。
- 未核对 `analysis/opcodes.json` 的 `status` 分布是否真的等于 375 = 347+13+12+3（需要跑 `operand-plan.test.ts:504-536`
  「计划覆盖账」那个用例，属 `npm test` 范围）。报告中"棘轮 347/375"均按 `tickets/T-0082/ticket.json` 与测试文件里的字面值引用。
