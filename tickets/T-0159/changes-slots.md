# T-0159 · 存档槽链路修缺批（P2 7 / P3 7）—— 变更记录（子代理，独占本文件名）

> 写者：`T-0159` 的执行子代理（存档槽链路）。**本文件是超集**：除了本票的实现级改动，还带
> 「台账待应用」与「耦合/待他人」两节 —— `analysis/*.json` 正被 `T-0108` 重写，且
> `src/vm/native.ts` / `src/vm/nativeTap.ts` / `src/renderer/**` / `src/arch/nodeFileSource.ts`
> 都在别的并行执行者手里 ⇒ 那些改动**不由本子代理落地**，请主 agent 串行应用。
>
> 引擎真源：`engine/天结_unpacked.exe_utf8.c`（`raw NNNNN` = 该文件行号）。
> 判据：`app/amayui-emulator/.tmp/p1-fix/p23-worklist2.md` §T-0159（第 395-412 行，14 条）。

## 0. 结论摘要（14 条）

| # | sev | 对象 | kind | 状态 | 落点 |
|---|---|---|---|---|---|
| 1 | P2 | `0x19e` | missing-branch（覆盖确认框） | **修**（宿主缝 + 登记缺口） | `save-slot.ts` `saveSlotFromEngine` |
| 2 | P3 | `0x19e` | missing-branch（写失败错误串 + 码值） | **修**（码值 2→1 + 错误缝 + 登记） | 同上 |
| 3 | P3 | `0x19e` | approximation（`ALLOW_UNDERRUN` 措辞） | **机制已守卫；文案待应用** | `test/opcode-operands.test.ts`（非本子代理可写） ⇒ §3.2 |
| 4 | P2 | `0x19f` | approximation（返回码口径） | **修**（`{1,-1,0}`，删掉自造的 2） | `save-slot.ts` `loadSlotIntoEngine` |
| 5 | P3 | `0x19f` | approximation（空装载也 0） | **冻结 + 可观测性**（引擎同码，补日志断言） | 同上 |
| 6 | P3 | `0x1a0` | approximation（292 B 定长读口径） | **冻结**（恰好 292 ⇒ 0 / 291 ⇒ 2） | `saveSlot.ts` `parseSlotHeader` |
| 7 | P2 | `0x1ac` | host-invented（两次独立复制） | **handler 口径已对 + 守卫**；宿主实现待他人 | §4.2 |
| 8 | P2 | `0x1ae` | missing-branch（DrawMode=D3D 分支） | **显式声明 + 登记缺口**（不静默近似） | `save-slot.ts` `op_slot_thumb_write` |
| 9 | P3 | `0x1ae` | host-invented（自造 `AMYTH1` 块） | **按体删掉写侧**（op1=2 + 0 字节空文件） | 同上 |
| 10 | P2 | `0x1af` | approximation（码值 + 判据） | **修**（0 字节 ⇒ 2）+ 收窄判据 | `save-slot.ts` `op_slot_thumb_read` |
| 11 | P3 | `0x1af` | missing-consumer（`setSlotPixels` 静默忽略） | **只登记**（`src/renderer/**` 非本票可写） | §4.3 |
| 12 | P2 | `scene-teardown-on-load-point` | stale-ledger | **已由 `T-0166` 落库**（核对通过，无需再改） | `analysis/engine-capabilities.json` |
| 13 | P3 | `0x1a0` | missing-branch（版本串 vs 游戏名） | **订正 + 修**（判据对象可注入，引擎真判据 = +8 游戏名） | `saveSlot.ts` |
| 14 | P2 | `0x1ae` | missing-branch（槽没创建 ⇒ 2 + 空文件） | **修** | 同 #9 |

**P2 7 条**：#1 修（缝已落、宿主侧待他人）、#4 修、#7 口径已对（宿主实现待他人）、#8 显式声明 + 登记、
#10 修、#12 已由 T-0166 完成、#14 修 ⇒ **5 条落地 + 1 条已在他票完成 + 1 条部分（宿主实现待他人）**。
**P3 7 条**：#2 修、#3 机制已守卫（文案待应用）、#5 冻结、#6 冻结、#9 修、#11 登记、#13 修 ⇒ **5 条落地 + 2 条登记/待应用**。

守卫：**新建** `app/amayui-emulator/test/save-slot-engine-codes.test.ts`（15 条，`@tier T0 @kind core @subsystem save`）。
红→绿：开工前该文件 **10 红 / 5 绿**（日志 `.tmp/t0159/red-new-guard.txt`），改完 **15 绿**。
5 条"冻结型"守卫做了**变异证明**（逐条把对应实现改坏 ⇒ 该条立刻红，见 §5.3）。

---

## 1. P2 逐条

### 1.1 P2 `0x19e` missing-branch —— 覆盖确认框（`sub_42D980` raw 38301-38316）

- **现象**：引擎在覆盖一个"头不合法"的旧槽前会弹 `MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2`
  （`0x34`），玩家选「否」（`IDNO = 7`）⇒ `CloseHandle` + `sub_42B4B0(_this, 1, 1)` ⇒ **`op1 = 1` 且原文件一个字节不动**；
  emulator 无宿主对话框 ⇒ 恒按「玩家点了是」直接覆盖，「玩家拒绝覆盖」这条路径不存在。
- **★体证订正（工作清单那句话是错的）**：弹框**不是**"打不开**或**头不合法"，而是
  **"只读打开成功（= 文件存在）**且**头读不出 292 B 合法头"** —— 查询用的 `CreateFileA` 带
  `0x8000020`（含 `0x8000000` ⇒ 不存在即 `INVALID_HANDLE_VALUE`）⇒ **文件不存在时整段 `if` 都不进**
  （raw 38307），反而是"少弹一次框"。`sub_406650(hwnd, …, 0x34)`（raw 11758-11770）就是 `MessageBoxA`。
- **改了什么**（`src/vm/handlers/save-slot.ts`）：`saveSlotFromEngine` 里新增
  ① 先 `fs.readSaveSlot(slot)`；② 文件在且 `parseSlotHeader(existing).ok === false` 时调用
  **可选宿主缝** `SlotHostSeams.confirmSlotOverwrite(slot)`；③ 返回 `false` ⇒ 日志 + **`return 1`**（不写盘）。
  缝缺失 ⇒ 恒按「是」（缺口写进 `SLOT_GAPS`）。
- **守卫**：`test/save-slot-engine-codes.test.ts` ①「槽存在但头不合法 ⇒ 问宿主一次；答否 ⇒ op1 = 1 且原文件一个字节不变」
  ②「头合法 / 槽不存在 ⇒ 不问；宿主没有确认缝 ⇒ 恒按"点了是"覆盖」。
- **未做**：宿主缝**未进桥**（`NativeBridge` + `nativeTap.ts` 的 `BRIDGE_METHODS` + 两个真宿主都在 `T-0153`
  的所有权里）⇒ 两个真宿主都不实现它 ⇒ **当前行为仍是"恒按玩家点是"**。这就是本票必须如实登记的第一处
  缺口，见 §4.1。

### 1.2 P2 `0x19f` approximation —— 返回码口径（`sub_42DB10` raw 38346-38362 + `sub_410160`）

- **现象**：emulator 的码域是 `{1, 2, 0}`，而引擎是 `{1, -1, 0}` —— `2` 在本指令里**不存在**。
- **体证**：`sub_410160` 全函数只有两条出口 ——
  `return -1`（raw 19411-19412：**`a4 ∈ {2,3}` 且 `sub_438120` 读头失败**）与
  `LABEL_137: return 0`（raw 19930-19932；**连容器读 `sub_437980` 失败都只 `operator delete[]` 后继续走到它**）。
  而 `a4` 来自 **配置 `set:SaveVersion1`**（raw 38353-38357；缺省 1 ⇒ 连头都不读 ⇒ 直接 0）。
- **改了什么**：`loadSlotIntoEngine` 的 `if (!parsed.ok) return { code: 2 }` ⇒
  `const sv1 = saveVersion1Of(e); return { code: sv1 === 2 || sv1 === 3 ? -1 : 0 }`；
  `SlotLoadOutcome.code` 的文档改成引擎码域。新增 `saveVersion1Of()`（`cfgInt(e.config, CFG.setSaveVersion1,
  registryDefault(CFG.setSaveVersion1))`）。
- **守卫**：①「码域 {1,-1,0}：SaveVersion1=3 ⇒ -1；=1 ⇒ 0；打不开 ⇒ 1」②「loadSlotIntoEngine：坏头 + a4∈{2,3} ⇒ -1」。

### 1.3 P2 `0x1ac` host-invented —— 两次独立复制（`sub_42E0A0` raw 38498-38512）

- **现象（审计原文的方向已被 verify 订正）**：返回码**不**相反 —— 引擎 `v5 = !CopyFileA(...)` 取逻辑非 ⇒
  源缺失时 `.DAT` 那次返回 0 ⇒ `v5 = 1`，随后 `.STH` 那次同样失败被 raw 38510-38511 抬成 **2**。
  emulator handler 的映射（`r.sth ? (r.dat ? 0 : 1) : 2`）**与体完全一致**（含 `{false,true} ⇒ 1` 这一格）。
- **真正没建模的**：引擎的两次 `CopyFileA` 是**独立调用** ⇒ `.STH` 在 `.DAT` 失败时照样复制；而
  `src/arch/nodeFileSource.ts` 的 `copySaveSlot` 是 `if (d) await this.writeSaveSlot(to, d)` ⇒
  **只在 `.DAT` 存在时才写 `.STH`** ⇒ 「源槽只有 `.STH`」那一格会漏复制。
- **改了什么**：**handler 侧一行未改**（本来就对）；新增守卫把四格码值钉死（防回退），并把宿主实现那一处
  **登记**给 `T-0153`（§4.2）。旧断言（如果有）没有动。
- **守卫**：「★T-0159 0x1AC：.DAT/.STH 是两次独立调用 —— 只 .STH 成功 ⇒ 1；只 .DAT 成功 ⇒ 2；都失败 ⇒ 2」。

### 1.4 P2 `0x1ae` missing-branch —— `set:DrawMode == 1` 的 D3D 截图分支（raw 38537-38541）

- **现象**：引擎按 `Engine[166964]`（`set:DrawMode`）分两条路：`== 1` ⇒ `CloseHandle` 后
  `sub_4A5260(Engine+322832, FileName, op3)`（截图函数自己落盘 BMP）；否则 `sub_43BF20(Engine+1978, op3, hFile)`。
  emulator 只有一条 `getSlotPixels → encodeBmp` 的路 ⇒ D3D 模式下走的是引擎的**另一条**实现。
- **改了什么**：`op_slot_thumb_write` 读 `drawModeOf(e)`（`cfgInt(e.config, CFG.setDrawMode, 0)`，与
  `frame/loop.ts:139`/`handlers/msgwin.ts:1402` 同口径）⇒ `== 1` 时**显式记一行日志**声明"未建模该分支、
  按非 D3D 等价路继续"，然后照常走 GDI 路。缺口文本在 `SLOT_GAPS`。
- **守卫**：「★T-0159 0x1AE：set:DrawMode = 1 ⇒ 日志显式声明走了非 D3D 实现」。

### 1.5 P2 `0x1af` approximation —— 结果码 + 判据收窄（`sub_42E320` raw 38565-38593）

- **现象①（本轮修）**：读到 **0 字节**的 `.STH` 时 emulator 早退报 `op1 = 1`（"打不开"）；
  引擎在两条路上都是"**打开成功、读入失败**" ⇒ `op1 = 2`（非 D3D：`sub_40BF20` → `sub_43E9F0` →
  `sub_4036B0` 的 `ReadFile(...,0xE)` 必然失败 ⇒ `v7 = 0` ⇒ 2；D3D 同）。
- **现象②（登记）**：emulator 只认 BMP（`decodeBmp`）+ 自造长度前缀；引擎 D3D 路在 `BM` 魔数不符时还能按
  `+8 ∈ {1,2} 且 +12 == 0` 的**第二格式**（AGF/dd 系表面）解入（raw 119663-119676 / 49987-50010）⇒ 那条未建模。
- **改了什么**：`op_slot_thumb_read` 拆开"打不开"（`!bytes` ⇒ 1）与"读入失败"（`bytes.length === 0` ⇒ 2）；
  非 BMP 的兜底从"任意 4 字节长度前缀自洽"**收窄**为 `isLegacySlotThumb()`（前缀 + `AMYTH1\n` 魔数都对）。
- **守卫**：①「0 字节 .STH ⇒ 2；文件不存在 ⇒ 1」②「非 BMP 且不是旧版自造块 ⇒ 2；旧版 AMYTH1 块仍读得回（0）」。
  ★`test/save-thumb.test.ts`（**不在本票可写范围**）第 3 条用例要求"本工程旧格式仍算读到" ⇒ 收窄**不能**收掉它，
  这就是保留读侧容忍的原因。

### 1.6 P2 `scene-teardown-on-load-point` stale-ledger —— 已由 `T-0166` 落库

- **核对（本子代理实读 `analysis/engine-capabilities.json`）**：该条目 `emulator.note` 现在写的是
  「`(B)` 步的清容器是**行内**做的（raw 19799-19814 只碰 `Scene+1032`），不是靠 `sub_410160` 的被调 ⇒
  **不恢复** `clearDrawContainer`。（旧 note 末句「只留 handle、无消费者」与旧正解句都过期。见审计 §4.2 / T-0166。）」
  —— 与工作清单要的订正**完全一致**；`T-0166` 状态 = `done`（`doneWhy` 明确写了这 14 条的改写）。
- **实现侧核对**：`src/vm/handlers/save-slot.ts` 的 ②c 段（现第 316 行起）就是"只清绘制项、不动网格 +
  `native.restoreDrawItems`"，且守卫 `test/slot-load-screen.test.ts:22-23` 钉着"装载点不得调
  `clearDrawContainer`/`clearMeshSlots`"。
- **改了什么**：无（**不改回去**）。`analysis/*.json` 不在本子代理可写范围 ⇒ 无需 §3 动作。

### 1.7 P2 `0x1ae` missing-branch —— `op3` 槽没创建 ⇒ 2 + 空 `.STH`

- **现象**：emulator 在"取不到该槽像素"时写一段自造块 `AMYTH1\n{…}` 并报 `op1 = 0`；
  引擎在同一格**返回 2**，`.STH` 停在 **0 字节**（`CreateFileA` 在调用前已建好、两条写路都不写）。
- **改了什么**：见 §2.3（与 P3 `0x1ae` 同一处改动）：写 0 字节文件 + `op1 = 2`（写不进去 = `CreateFileA`
  失败 ⇒ 1，raw 38534-38535）。
- **守卫**：「★T-0159 0x1AE：op3 槽没有像素 ⇒ op1 = 2 且 .STH 是 0 字节空文件（不再写自造块 AMYTH1）」。
- **既有断言的最小 retarget**：`test/save-slot.test.ts` 的 `.STH` 往返段（原 272-281 行）此前依赖
  "无像素 ⇒ 自造块 ⇒ op1 = 0"这一**旧前提**；已按"给宿主一份该槽像素（真机 = `create-texture` 出的画布槽）"
  改写，并**加强**为"写出的 `.STH` 必须是 BMP"（`isBmp`）。旧前提不成立的理由与体证据写在该处注释里。

---

## 2. P3 逐条

### 2.1 P3 `0x19e` missing-branch —— 写失败：错误串 + `op1 = 1`

- **现象**：引擎写侧 `CreateFileA` 失败时先 `sub_40A4C0(_this, hwnd, aE, 5)`（`aE` = 「セーブデータの保存に
  失敗しました。…」raw 4331）**再** `op1 = 1`（raw 38318-38322）；emulator 既没有可注入的错误提示缝，
  `catch { return 2 }` 的码值还与引擎不同（引擎两种写失败都是 1）。
- **改了什么**：`catch` 分支 ⇒ **`return 1`**；并调用可选缝 `SlotHostSeams.slotWriteFailed(slot, message)`
  （message 带引擎文案语义）+ 一条日志。
- **守卫**：「★T-0159 0x19E：写失败 ⇒ op1 = 1（引擎 raw 38317-38322）且宿主错误串缝收到通知」。
- **未做**：缝未进桥（§4.1）⇒ 真宿主当前只在日志里留一行，玩家看不到提示。

### 2.2 P3 `0x19e` approximation —— `ALLOW_UNDERRUN` 措辞（**待应用**）

- **现象**：`test/opcode-operands.test.ts` 的 8 条豁免理由写的是"合成指令里没有 fileSource/slot 数据 ⇒
  提前返回"，而实测机制是「op2..op3 **已读**；缺的是写侧输出格 `op1` —— 合成指令注入的宿主写调用**永不结算**，
  handler 挂在 await 上」。
- **本子代理做了什么**：**加了一条守卫把机制钉住**（新建文件的最后一条：「存档槽族 8 条：宿主没有槽能力时
  也必须**先读** op2/op3（先读后判）」，用 `trackArgs` 证明 8 条的 op2（3 参的还有 op3）都被碰）。
  **文案本身**在 `test/opcode-operands.test.ts` —— 不在本票可写范围 ⇒ 替换文本见 §3.2，由主 agent 应用
  （`op-underun-fixups.test.ts:195` 只要求 `0x1d3/0x1d4/0x2f3/0x33f` 留在表里，**不动** save-slot 这 8 条）。

### 2.3 P3 `0x1ae` host-invented —— 自造 `AMYTH1` 块（写侧删除）

- **改了什么**：`op_slot_thumb_write` 删掉 `buildSlotThumb(new TextEncoder().encode('AMYTH1…'))` 那条兜底 ⇒
  **写 0 字节文件 + `op1 = 2`**（见 §1.7）。`buildSlotThumb()`（写侧构造器）**一并删除**（删前全仓确认零引用：
  src/测试/工具都没有调用者，留一个没人调的构造器只会让人以为还能写这种块）；读侧改成新的
  `isLegacySlotThumb()`（`src/save/saveSlot.ts`，判据 = 4 字节长度前缀 + `AMYTH1\n` 魔数都对）。
- **如实登记**：自造格式**不再是写侧产物**；读侧仍容忍玩家机器上已有的旧块（收窄到"前缀 + 魔数"），
  这一格写在 `SLOT_GAPS`（`0x1AE/0x1AF` 那条）。

### 2.4 P3 `0x1af` missing-consumer —— `setSlotPixels` 静默忽略（**只登记**）

- **现象**：`op1 = 0` 报"成功"但目标纹理槽不存在时，宿主 `TextureCache.setSlotPixels` 直接 log 后 return
  （`src/renderer/pixi/textureCache.ts:747-750`）⇒ 引擎在同情形下 `sub_40BF20`/`sub_49E9D0` 已经失败并让
  `op1 = 2`，emulator 却报成功而无图像落地。
- **本子代理做了什么**：**不动** `src/renderer/**`（另一个 agent 正在用）⇒ 整条写进 §4.3 待他人。
  守卫与修法（宿主回调返回布尔 ⇒ 决定 `op1`）一并写在那一节。

### 2.5 P3 `0x1a0` approximation —— 292 B 定长读口径（冻结）

- **体证**：`sub_438120`（raw 45115）`ReadFile(hFile, Buffer, 0x124, &n, 0) && n == 292`；宿主读的是**整文件**、
  `parseSlotHeader` 只要求 `length >= 292` ⇒ 「恰好 292」两边都成功、「< 292」两边都失败（返回码一致，
  差异只是"宿主多读了后面那段"）。
- **改了什么**：代码无需改（口径本来就对）；新增**冻结**守卫（恰好 292 ⇒ `op1 = 0` 且 `op3..op9` 照常；
  291 ⇒ `op1 = 2`），并做变异证明（把 `SAVE_HEADER_BYTES` 判据改宽 ⇒ 该条立刻红）。
- `SLOT_GAPS` 里补了"定长读 vs 整文件读"这层口径差（供将来做流式读时对齐）。

### 2.6 P3 `0x1a0` missing-branch —— 版本串 vs 游戏名（订正 + 可注入判据）

- **★体证订正（工作清单那句"引擎拿 `_this+698912` 与文件头 **+4 的 4 字节**比版本串"是错的）**：
  - `sub_438120` raw 45123 是 `strcmp((const char *)&Buffer[2], a4)`，`Buffer` 是 **`int[]`** ⇒
    `&Buffer[2]` = **字节 +8**；`a4` = `_this+698912` = **`set:GameName`**（raw 23745
    `GetString(a1+697620, aSetGamename, a1+698912)`；`aSetGamename` = `"set:GameName"` raw 4242）。
    第一层的 `analysis/fields.json` 也早已这么记（`SaveHeader/0x8 = save_game_name`，evidence `raw 45123`）。
  - ⇒ 引擎**从不比较头 +4**；emulator 从 `T-0018` 起比的那个 `460B` 是**本工程更严的额外判据**。
- **改了什么**（`src/save/saveSlot.ts`）：
  - `parseSlotHeader(bytes, criteria)` 新增**判据对象** `SlotHeaderCriteria { magic?, acceptLegacyMagic?, engineVersion?, gameName? }`：
    ① `gameName` = 引擎真判据（给定就 `strcmp` `+8`，不符 ⇒ code 2）；
    ② `engineVersion` = 本工程额外判据（文档里明确标注"引擎不比它"）；
    ③ `magic`/`acceptLegacyMagic` = 本 exe 的魔数（引擎按 `strncmp(Str1, Engine+698904, 2)` 二选一，
    真槽 47 个全 `S4SD`）⇒ 默认仍容忍 `S3SD`（历史容忍），`acceptLegacyMagic: false` 可收紧。
  - `parseSlotFile(bytes, criteria)` 透传判据。
  - **生产注入点未接**：`set:GameName` 不在 `configRegistry.ts` 的权威键表里，而
    `test/config-keys.test.ts`（`T-0057` R1）会把 `src/**` 里手打的配置键字面量判红 ⇒ 本子代理**没有**在 src 里
    读这个键（这也是本轮唯一一次自查捕获到的回归：第一版实现读了它，`test:all` 立刻报
    `save\saveSlot.ts: set:GameName` ⇒ 已改为"判据实现 + 待应用登记"）。
- **守卫**：①「头判据：引擎比的是 +8 的游戏名，+4 是本工程的额外判据」②「魔数：……S3SD 容忍可关」。

### 2.7 P3 `0x19f` approximation —— 帧记录一条都装不上（冻结 + 可观测性）

- **体证**：引擎此处**也是 0**（a4 既不是 1/2/3 时 `sub_410160` 从 raw 19430 起是空循环，仍走主出口 0）⇒
  返回码一致，差别只是"emulator 少一层可观测性"。
- **改了什么**：不加新码值（**不许**用 `op1` 判装载完整性）；新增守卫断言 `op1 = 0` **且**日志里有
  "一个都没装上"（该日志本来就有，守卫第一次把它变成判据）。
- **守卫**：「★T-0159 0x19F：帧记录一条都装不上 ⇒ op1 = 0（与引擎同码），但日志必须说"未恢复任何帧"」。

---

## 3. 台账待应用（主 agent 串行落地）

### 3.1 `analysis/engine-capabilities.json`

- `scene-teardown-on-load-point`：**无需动作**（`T-0166` 已按工作清单的口径改写，本子代理已核对，见 §1.6）。

### 3.2 `app/amayui-emulator/test/opcode-operands.test.ts` —— 8 条豁免文案（**替换**，键不动）

把 **第 77-84 行**的 8 条值改成下面这段实测口径（键 `'0x19e'`…`'0x1af'` 保持原样、顺序不动）：

```ts
  // ★`T-0159` 订正措辞（实测口径，见 `test/save-slot-engine-codes.test.ts` 的最后一条）：
  //   这 8 条不是"没读操作数"，而是"**已读 op2/op3**、缺的是写侧输出格 op1" —— 合成指令注入的宿主
  //   fileSource 是 `new Proxy({}, { get: () => () => new Promise(() => {}) })`（本文件下方 runOne 夹具），
  //   写调用**永不结算** ⇒ handler 挂在 `await fs.write*…()` 上，`plan.setInt(1, …)` 执行不到。
  //   引擎侧同序：先 `sub_41BF50(_this, 2)` 取槽号再建文件名（raw 38303/38383/38530）。
  '0x19e': 'op2 已读（save-slot 族：先取槽号再建文件名，raw 38303）；缺的是写侧输出格 op1 —— 合成指令注入的宿主写调用永不结算（见本文件 runOne 夹具）',
  '0x19f': '同 0x19e（短读档）：op2 已读；缺 op1（写侧永挂）',
  '0x1a0': '同 0x19e（读槽头）：op2 已读；缺 op1（写侧永挂）',
  '0x1a1': '同 0x19e（读档）：op2 已读；op1 本就 unused（引擎不调 sub_42B4B0）',
  '0x1ab': '同 0x19e（删槽）：op2 已读；缺 op1（写侧永挂）',
  '0x1ac': '同 0x19e（复制槽）：op2/op3 已读（raw 38500/38502）；缺 op1（写侧永挂）',
  '0x1ae': '同 0x19e（写 .STH）：op2/op3 已读（raw 38530/38540）；缺 op1（写侧永挂）',
  '0x1af': '同 0x19e（读 .STH）：op2/op3 已读（raw 38567/38575）；缺 op1（写侧永挂）',
```

> ★注意：**不要**为了改这段文案去动 `test/op-underun-fixups.test.ts` 的
> 「`0x1d3/0x1d4/0x2f3/0x33f` 必须留在表里」那条 —— 与本批无关。

### 3.3 `src/configRegistry.ts` —— 把游戏名键加成权威键（两步，之后再回填调用点）

1. `CONFIG_REGISTRY_KEYS` 里加一条 `{ key: 'set:GameName', kind: 'string', def: '' }`
   （引擎侧 evidence：raw 4242 `aSetGamename[13] = "set:GameName"`、raw 23745 写 `Engine+698912`、
   raw 45123 `strcmp(文件头 +8, 那一格)`）。
2. `CFG` 里加 `setGameName: 'set:GameName'`，然后在**本票已留好的注入点**接上：
   - `src/vm/handlers/save-slot.ts`：`parseSlotHeader(existing)` / `parseSlotFile(bytes)` / `parseSlotHeader(bytes)`
     三处传 `{ gameName }`（`gameName = cfgStr(e.config, CFG.setGameName, '')`，空串则传 `{}`）；
     `buildSlotFile({ …, title: gameName })` 让**我们写的槽**也带上同一个名字（否则一旦启用判据，
     本工程自己写的槽会被自己的判据拒绝）。
   - 那段"当前没有生产注入点"的注释块（`save-slot.ts` 的 `SLOT_NO_GAME_NAME_SOURCE` 说明处）可删。
   - 守卫已就位：`test/save-slot-engine-codes.test.ts` 的「头判据」条（`parseSlotHeader(bytes, { gameName })`）。

### 3.4 票据 evidence 行号刷新（**我改了被锚定的文件**，字符串全部保留，只有行号漂移）

`node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --validate` 在我改完后对下面这些条目报
`⚠ evidence 行号已漂移`（**只 ⚠、不红**；锚点字面串都还在）。新行号（`save-slot.ts` 现 1000 行）：

| 票 | 锚点字面串 | 旧 line | **新 line** |
|---|---|---|---|
| T-0018 | `SAVE_SLOT_OPS` | 847 | **989** |
| T-0036 | `op_slot_thumb_read` | 814 | **952** |
| T-0056 | `async function transferToRootAfterLoad(e: Engine): Promise<void> {` | 67 | **131** |
| T-0061 | `按 0x1AD 记录的帧退栈` | 593 | **690** |
| T-0061 | `控制转移` | 42 | **106** |
| T-0063 | `与引擎同一条续跑路` | 480 | **558** |
| T-0064 | `replaySavedBgm` | 136 | **200** |
| T-0065 | `sv1/sv2` | 406 | **477** |
| T-0070 | `export function applySlotPresentation` | 111 | **175** |
| T-0071 | `重建存档里的图像槽` | 350 | **421** |
| T-0071 | `只覆盖池内下标，不得清掉池外下标` | 198 | **269** |
| T-0072 | `引擎在这一步之后还会把帧 0 交给` | 410 | **481** |
| T-0072/T-0074 | `②c ★**装载点不整批清绘制项**` | 245 | **316** |
| T-0090/T-0144 | `清掉上一个执行链的 L2D 运行态` | 331 | **402** |
| T-0061 | `index?: number;`（`src/save/saveSlot.ts`） | 166 | **229** |

### 3.5 `analysis/opcode-gaps.json` 的 save-slot note（可选）

若那六份文件里有 0x1AC/0x1AE/0x1AF 的 `note` 复述"自造块 `AMYTH1` 能往返"或"0x1AC 返回码相反"，
按本文件 §1.3/§1.7/§2.3 的口径订正。**本子代理没有读写 `analysis/*.json`**（`T-0108` 正在重写它们）。

---

## 4. 耦合 / 待他人（**不在本票可写范围**，逐条给出 exact patch 建议）

### 4.1 `src/vm/native.ts` + `src/vm/nativeTap.ts` + 两个宿主 —— 两个宿主缝进桥（`T-0153`）

本票已在 `save-slot.ts` 声明并**使用了**两个可选缝（结构化类型，不需要先改 `native.ts` 就能被测试注入）：

```ts
export interface SlotHostSeams {
  confirmSlotOverwrite?(slot: number): boolean;          // false = 玩家点了「否」⇒ op1 = 1、原文件不动
  slotWriteFailed?(slot: number, message: string): void; // = sub_40A4C0(..., aE, 5)
}
```

要做的事（缺任何一步，两个真宿主就**永远**提供不了它，本票的两条缺口就一直开着）：
1. `NativeBridge` 里加这两个可选方法（带上 `save-slot.ts` 的 raw 依据注释）；
2. `nativeTap.ts` 的 `BRIDGE_METHODS` 里加 `'confirmSlotOverwrite'`、`'slotWriteFailed'`
   （否则 `test/native-tap.test.ts` 的"非桥方法集合"那条会红，且闸门 A 记不到缺口）；
3. `renderer/pixiBackend.ts` 与 `renderer/headlessScene.ts` 各实现一份（headless 可以
   `confirmSlotOverwrite: () => true` + `slotWriteFailed: (s, m) => this.note(...)`）。
   ★两个宿主是"差异只允许一个方向"的表（`DECLARED_HOST_DIVERGENCE`）⇒ 两处都要有，否则那条会红。

### 4.2 `src/arch/nodeFileSource.ts` —— `copySaveSlot` 要"两次独立复制"（P2 `0x1ac` 的真缺口）

```ts
// 现在（src/arch/nodeFileSource.ts 的 copySaveSlot，约 199-205 行）：
const d = await this.readSaveSlot(from);
const t = await this.readSlotThumb(from);
if (d) await this.writeSaveSlot(to, d);          // ← 只在 .DAT 存在时才写 .STH（错）
return { dat: d !== null, sth: t !== null };
// 体（sub_42E0A0 raw 38505/38510）：两次独立的 CopyFileA ⇒ .STH 那次与 .DAT 无关
const d = await this.readSaveSlot(from);
if (d) await this.writeSaveSlot(to, d);
const t = await this.readSlotThumb(from);        // ← 独立读、独立写
if (t) await this.writeSlotThumb(to, t);
return { dat: d !== null, sth: t !== null };
```

影响面：只有"源槽只有 `.STH`、没有 `.DAT`"这一格（正常槽两份都在）⇒ 语料 2 处不可见，但真机不丢这份。
handler 侧**无需改**（映射已与体一致；本轮已加守卫钉死四格码值）。

### 4.3 `src/renderer/pixi/textureCache.ts` —— `setSlotPixels` 静默忽略（P3 `0x1af` missing-consumer）

`TextureCache.setSlotPixels`（约 747-750 行）在 `#canvasSlots` 没有该槽时 `log` 后 return；而 `0x1AF` 的
handler 在 `c.native.setSlotPixels?.(…)` 之后**无条件** `op1 = 0`。引擎在同情形下 `sub_40BF20`/`sub_49E9D0`
已经失败 ⇒ `op1 = 2`。
建议修法（任选其一，都需要先动 `native.ts` 的签名 ⇒ 与 §4.1 同一批）：
- `setSlotPixels` 返回 `boolean`（是否真的落地），handler 据此写 `op1`；或
- `0x1AF` 先问 `getTextureSize(texSlot)`/槽存在性（`0x208` 面）再决定——但那是**另一条**判据，
  与引擎的"解入失败"不完全同源。
在修好之前，这一格的行为是"报成功但画面空"，**已登记**（本条即登记）。

### 4.4 `0x1AE` / `0x1AF` 的 D3D 分支与第二格式（登记，未建模）

- `0x1AE`：`set:DrawMode == 1` 的 `sub_4A5260(Engine+322832, FileName, op3)` 截图（raw 38537-38541）；
- `0x1AF`：D3D 路 `sub_49E9D0` 在 `BM` 不符时按 `+8 ∈ {1,2} && +12 == 0` 解入第二格式（raw 119663-119676；
  非 D3D 的 `sub_43E9F0` 同一判据 raw 49987-50010）。
两条都写在 `SLOT_GAPS`（本票已写）。本机 `set:DrawMode = 0` ⇒ 当前不可见。

### 4.5 ★已修但需下游知道的一件事：`0x1AE` 的产物形状变了

写侧不再产出非 BMP 块 ⇒ **`0x1AF` 读那些旧块的容忍是唯一的兼容面**；
`src/tools/saveDump.ts` 之类的工具若假定 `.STH` 一定是 BMP，遇到历史槽要按 `isLegacySlotThumb()` 判。

---

## 5. 自检（命令 + 结果）

### 5.1 收尾命令

| 命令 | 结果 |
|---|---|
| `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`（+control/electron） | **exit 0** |
| `node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit` | **exit 0** |
| `node --import tsx --test test/save-slot-engine-codes.test.ts` | **15 / 15 pass** |
| `node --import tsx --test test/save-slot.test.ts test/save-thumb.test.ts test/save-delete-slots.test.ts test/slot-*.test.ts test/operand-plan.test.ts test/opcode-operands.test.ts test/op-underun-fixups.test.ts test/config-keys.test.ts` | 只有既有基线红（`SAVE70.DAT 的 format`） |
| `node --import tsx src/tools/deadWrites.ts`（= `npm run check:dead-writes`） | **exit 0、★无新增死写** |
| `node --import tsx test/run.ts check`（= `npm run test:org`） | **0 条问题**（203 文件分类一致） |
| `node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --validate` | **exit 0**（70 条 ⚠；其中 16 条=本文件 §3.4 的行漂移，**锚点字面串全部保留**） |
| `node --import tsx test/run.ts all` | 见 §5.4 |

### 5.2 红 → 绿

- 唯一失败日志：`.tmp/t0159/red-new-guard.txt`（**10 红 / 5 绿**，改实现前）。
- 改完后同一文件 **15 绿**（`pass 15 / fail 0`）。

### 5.3 变异证明（"冻结型"守卫必须能红 —— 逐条把实现改坏 → 该条立刻红 → 还原）

| # | 变异 | 变红的守卫 |
|---|---|---|
| M1 | `op_slot_thumb_read`：把 `if (!fs?.readSlotThumb)` 提前到读 op2/op3 之前 | 「存档槽族 8 条 …… 先读 op2/op3」 |
| M2 | 删掉 `0x19F` 空装载那条日志的可观测文案 | 「0x19F：帧记录一条都装不上 ⇒ op1 = 0 …… 日志必须说"未恢复任何帧"」 |
| M3 | `op_slot_copy` 换回旧映射 `r.dat ? (r.sth ? 0 : 2) : 1` | 「0x1AC：.DAT/.STH 是两次独立调用」 |
| M4 | `parseSlotHeader` 的 292 B 判据放宽 1 字节 | 「0x1A0：定长 292 B 口径」 |
| M5 | `0x19E` 覆盖确认去掉"头不合法"这一半条件 | 「0x19E：头合法 / 槽不存在 ⇒ 不问」 |

（变异脚本 `.tmp/t0159/mutate.mjs`；每次都是"备份 → 字面替换 → 跑 → 还原"，仓库里无残留。）

### 5.4 `npm run test:all` 归因

- **第一轮**（改实现后、未修 config-keys 回归前）：多出 1 条**本票造成的红**
  —— `test/config-keys.test.ts`「src 里的每个配置键字面量都必须在权威键表里」，offender =
  `save/saveSlot.ts: set:GameName`（第一版实现直接 `cfgStr` 读了那个未注册的键）。**已按 §2.6 改掉**
  （判据保留、生产注入点登记），`test/config-keys.test.ts` 复跑**绿**。
- **第二轮**（收尾）：结果见 `.tmp/t0159/test-all-2.txt`。红项里属于本票范围的**只有**三条既有基线红：
  `engine-slot` SAVE70/71 `storedDwords`、`save-slot` 真槽 `format`（`SAVE70.DAT`，
  `tickets/T-0146` 的既有红，本票**未**去动它）、`scene-report` 可绘制项 24 ≤ 26；
  其余红项全在别人正在改的 `src/**`（`text/**`、`msgwin`、`live2d`、`renderer`、`tools`）与
  host 注册表等面，均**不 import** 本票改动的 `save/saveSlot.ts` / `handlers/save-slot.ts`
  （逐文件 grep 过：`host-registry.test.ts` / `input.test.ts` / `l2d-node-transform-ops.test.ts` /
  `engine-slot.test.ts` / `scene-report.test.ts` 都不引用它们）。

### 5.5 ★收尾时工作树上的**并行噪声**（不是本票的红，列出来以免误判）

- `src/vm/handlers/config-read.ts` 在收尾中途**语法未闭合**（另一执行者正在写：`config-read.ts:218:70
  Expected ";" but found "cfgStr"`）⇒ 那段时间任何 `node --import tsx --test` 都会因模块图加载失败而全红。
  该文件随后修好，本票已**复跑**：`tsc -p tsconfig.json --noEmit` = **exit 0**、
  `node --import tsx --test test/save-slot-engine-codes.test.ts test/save-slot.test.ts test/save-thumb.test.ts
  test/save-delete-slots.test.ts test/slot-load-*.test.ts test/slot-save-resume.test.ts test/config-keys.test.ts
  test/operand-plan.test.ts test/opcode-operands.test.ts test/op-underun-fixups.test.ts test/engine-slot.test.ts`
  = 只有上面那两条既有基线红。`tsconfig.test.json` 现存的两处报错在**别人的**新文件里
  （`test/config-t0161.test.ts`、`test/engine-fields-t0161.test.ts` 的 `EngineConfig | null`），与本票无关。
- `test/harness-convergence.test.ts`（`T-0020` 棘轮）的红是**别人的新测试文件**引入的：
  `agerc-module-error-paths.test.ts` / `config-t0161.test.ts` / `engine-fields-t0161.test.ts`
  含 `mk()` 变体名且未进基线 —— 本票的新文件 `save-slot-engine-codes.test.ts` **不含**那四个名字
  （`grep -E 'function mk\(|const mk = |function mkEngine\(|function makeCtx\('` 零命中）。
- `npm run check:dead-writes` 在收尾复跑时报 `★ 新增死写：Engine.agerc`（另一票新增的字段）；
  本票**不新增任何模型字段**（改动只碰 `save/saveSlot.ts` 与 `handlers/save-slot.ts`），
  破坏前的同一命令输出是 `★ 无新增死写`。
- `buildSlotThumb()` 的删除发生在 `test:all` 第二轮**之后**：已按"全仓零引用"静态确认
  （`grep -r buildSlotThumb` 只命中定义处与审计文档），并已复跑 `tsc -p tsconfig.json --noEmit` = **exit 0**
  与上面的槽守卫整批（绿）⇒ 删除已复核。
