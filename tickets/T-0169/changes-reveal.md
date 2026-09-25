# `T-0169`（F 波单元）成果报告 —— 帧循环口径差 + 两张 `T-0175` 里落在 `src/vm/engine.ts` 的项

> 单元 = `T-0169`（判据②）+ `T-0175` ①（`scriptEngineFlag`）+ `T-0175` ⑬（`Engine[430712]` 的两条主循环写者）。
> 引擎真源 = `engine/天结_unpacked.exe_utf8.c`（`raw N` = 行号），**每条结论都回体读过**。
> 可改面 = `src/vm/engine.ts` / `src/frame/**` / `test/**`（`handlers/control.ts` 一处必要改动，理由见 §1-②）。

---

## §1 三件事的逐条结论（含 raw 锚点）

### §1-① `T-0169` 判据②：`textRevealing` 互斥分支**不拆**（+ 把 `sub_409400` 真缺的那一支补齐）

**结论：互斥是忠实的；原票的框架「逐字帧不跑等待泵」是归属错。** 三条主体依据（全部回体）：

| # | 事实 | raw 锚点 |
|---|---|---|
| 1 | 主循环尾部是 **if/else-if/else 链**，每轮只走一臂：`0x20000000`（逐字泵 `sub_409400`）→ `v35 >= 0` 的 `1`/`0x20`/`0x10000000`/`0x800000` 各臂 → `LABEL_215`（派发 1 条）→ `else`（`v35 < 0` = bit31 ⇒ `sub_411BC0` + `Sleep(2)`）⇒ **逐字位为 1 时等待泵那一臂到不了** | `raw 21176-21228`（`if ((v35 & 0x20000000) != 0)` / `else if (v35 >= 0)` / `else { sub_411BC0(_this); Sleep(2u); }`） |
| 2 | `0x20000000` **在整段显现期间一直是 1**：`sub_409400` 只在四条收尾路径上清它 —— ① `0x300` 闸门路径且无按节拍泵的窗（`v9 == 0`）；② 输入出口（点击/滚轮下/滚轮累加器 < 0）；③ 贴完当前窗；④ `Engine[388212]` 闩锁支 | `raw 13892` / `raw 13919`+`13940` / `raw 13964` / `raw 13917-13930` |
| 3 | 逐字帧里引擎做的事**只有**输入出口 + 推一个字（键命中/悬停/滚轮回看都在 `sub_411BC0` 里 ⇒ 逐字期间同样不处理） | `raw 13895-13966`（出口 `13935-13945`）；`sub_411BC0` 的 `20242`（键命中）/`20324`（悬停）/`20341`（回看） |

**三个 `service*` 的对口（这是判据②真正要判的事）**：

| emulator | 引擎对口 | 依据 |
|---|---|---|
| `serviceRevealAdvanceInput` + `serviceTextReveal` | **`sub_409400`**（主循环 `0x20000000` 臂，raw 13822-13968） | `raw 21178` 的调用点；`serviceRevealAdvanceInput` 逐条对 `raw 13931-13946`，`serviceWinReveal` 对 `raw 13835-13888` |
| `serviceAdv()` + 帧驱动 adv 分支的**恰好 1 条** `dispatch()` | **`sub_411900`**（`0x8000000` 臂，raw 20096-20202） | `raw 20161-20165`（`v7 = ip[0]` → handler → `ip += 4*arity`） |
| `serviceAdvanceWait()` | **`sub_411BC0`**（bit31 臂，raw 20206-20461） | `raw 21224-21226` |

⇒ **「同一轮里 20887 与 21226 都会跑到」这句话按体不成立**：20887（字格图标泵，门 `0x40000000`）与**显示态主泵 `sub_411900`（raw 21160）**同轮成立，但 `sub_411BC0`（21226）在**另一臂**上、`0x20000000` 为 0 时才跑。
★落点：结论写进 `src/frame/loop.ts` 的 `text-revealing` 分支注释（6 条：归属错 / 为什么互斥等价 / 为什么逐字位是闩锁 / 键命中与悬停不在这一臂 / **证伪法** / 「每轮一条」已覆盖）；台账片段见 §3。

**「按体补齐」实际做掉的一支（真缺口，已被台账登记过）**：`sub_409400` 的 **`Engine[388212]` 闩锁支**
（写 `raw 13941` `Engine[388212] = 1`，读 `raw 13917-13930`：清 `0x20000000` + **一次贴完当前窗**，`DrawMode==1` 时另置强制冻结/清等待计时器）。
- 登记出处：`analysis/engine-capabilities.json` 的 `frame-render-gate-mainloop` note ③ 就写着「真缺的是 `sub_409400`（raw 13823 起）第二落点 `raw 13923-13929`（`Engine[388212]` 支）……重开条件：`src/frame/loop.ts` 与 `src/vm/engine.ts` 的所有者释放后」——**本单元正是那两个文件的所有者**。
- 触发场景 = 「点一下贴完整页 → 同一句里 `0x196 display-furigana` 续写」：`0x196` 的续写支置 `0x20000000`（`raw 29093`）却**不**清 `97053`（`0x6E`/`0x72` 的 `raw 28557` 才清）⇒ 下一帧泵走闩锁支。
- 体里 `result = 0`（`raw 13925`）那半条**没有消费者**（`raw 21178` 丢弃 `sub_409400` 的返回值）⇒ 如实不落（见 §6-⑥）。

### §1-② `T-0175` ①：`scriptEngineFlag` 初值/复位值 = 1（已建模）+ 注释键名过期（已改）+ 三态机极性（**审计 overreach，按体不成立**）

1. **构造初值 = 1**：`raw 22591` `*(_DWORD *)(_this + 699248) = 1;`（构造 `sub_415640`）⇒ `Engine` 的 `engineValues` 初值表加 `[ENGINE_FIELD.scriptEngineFlag, 1]`（`src/vm/engine.ts`）。
2. **复位值 = 1**：`raw 17961`（整体复位 `sub_40DF10`）同形 ⇒ 落点 = `handlers/control.ts` 的 `op_exit_script`（`sub_40DF10` 的 emulator 等价物，`logoEnabled`/`loadInProgress`/`storedCur` 三格也写在那里）。**改 `control.ts` 的理由**（本单元硬边界要求写明）：`sub_40DF10` 在 emulator 里**只有这一处**落点，`src/vm/engine.ts` 里没有"整体复位"方法，另造一个只被测试调用的复位口就是"为测试保留产品不走的路径"（`T-0014` 已否掉过一次）。
3. **唯一写者 `0x142`**（`raw 31026`）与**唯一读者** `sub_4765C0`（`raw 91057-91061`，工程内零调用）：写侧已建模（`handlers/engine-fields.ts`），读者如实登记（不编 opcode）。
4. **`engine.ts:793` 附近的过期注释键名**：旧注释写 `GetConfig("set:CancelMessageKey")` ⇒ 已按体改成 `set:CancelMesSkipOnClick`（键名常量 `raw 4346` `aSetCancelmessk[25]`；门 `raw 20115`；该串在 raw 里 0 次）。
5. **三态机极性（`raw 20119-20126`）**：审计 finding 说 emulator 的极性错 —— **按体不成立**：`raw 20117-20141` 的三支（按下 ⇒ `1→2` 且**消费掩码 bit4**；松开且 stage==2 ⇒ `2→0` + `sub_4053C0` + 清 ADV + `Engine[1415]=0` + `Engine[97050]=0` + `SetConfig("message:ReadTextSkip", 0)`；其余 ⇒ `1`）与 emulator 逐支同形，「`0→1` 发生在该位为 **0** 的那一帧」正是既有实现。**真缺的三件**（本票补齐，`raw` 逐条）：
   - `raw 20120` `*v2 &= ~0x10u`：按下那一帧把 bit4 从**掩码格**里拿掉（emulator 落 `input.inputMask`）；
   - `raw 20127` `sub_4053C0(_this)` = `eatAllInput()`（此前只有"清 ADV + 复位跳读镜像"）；
   - `raw 20133-20136`：`GetConfig(...) == 2` ⇒ **整帧 `return`** —— 3 槽交付（`raw 20144-20160`）与那条指令（`raw 20161-20165`）都不做 ⇒ 新增 `Engine.advFrameAborted` + 帧驱动据此跳过本帧那一条（这是「显示态每轮恰好 1 条」在体里**唯一**的例外）。
6. **3 槽交付（判据②的 ③）**：`raw 20144-20160` 的 `sub_4BB840` 循环在 emulator 的等价物是**宿主侧**的 `AudioEngine.voiceDefer` + `tick(nowMs, advActive)` 冲刷（`T-0151` 的登记结论）⇒ 不在 `engine.ts` 重复建模（不编第二条交付路径）。

### §1-③ `T-0175` ⑬：`Engine[430712]`（= `_this[107678]`）的三条写者，逐条处置

| 写者 | 位置（raw） | 用的游标 | 本单元处置 |
|---|---|---|---|
| ① `sub_409700` 的**右键**臂 | `raw 13997-14008` | **主** `122372+cur` | **不做（如实登记）**：这一臂在 `effect_flags & 0x10000000` 的主循环支里（`raw 21200-21203`），而 `0x10000000` 的**唯二置位端是 `0x8E`/`0x95`**（`raw 29442` `sub_4204D0` / `raw 29585` `sub_420870`，都是 panelB 通路）—— 语料 `i08e`/`i095` **各 0 处**，`handlers/panel.ts` 已登记「emulator 不建模 panelB（`sub_409700` 与 `0x95`/`0x96`/`0x8D`/`0x8E`）」⇒ 该臂在语料上**不可达**，实现它等于加一段没有触发路径的死代码（重开条件 = panelB 被建模时） |
| ② `sub_411BC0`（等待泵）的右键取消路由 | `raw 20365-20374` | **主** `489488+4*cur` ≡ `122372+cur` | **已落**（`Engine.#cancelRoute`，`T-0167`）；★取值来源的口径差见 §4-①（本票不擅改） |
| ③ 主循环 `0x4000000` 臂 | `raw 20859-20881` | **备用** `489648+4*cur` ≡ `122412+cur` | **本票落**：新增 `Engine.serviceRedisplayExit()` + `src/frame/loop.ts` 帧首调用（引擎里这一臂在字格泵 `raw 20887` **之前**、不受 ADV/等待位门控） |

③ 的逐句落点：`raw 20860`（门 `0x4000000`）→ `raw 20862`（**消费刷** `sub_478090`）→ `raw 20863`（有输入）→ `raw 20865`（掩码格清 0）→ `raw 20866`（清模式位）→ `raw 20868`（备用游标 `!= -1`）→ `raw 20870-20872`（`redisplayMode = flags | 0x2000000`）→ `raw 20873`（`effect_flags = 0`）→ `raw 20874`（`redisplayReturn = sub_4051E0(...) = (ip - ip_base) >> 2`，**不是** `0x199` 那条的 `+1`）→ `raw 20876`（`redisplayScriptId = frame[95796]`）→ `raw 20877`（`ip = ip_base + 4*备用游标`）。
★`raw 20878`（`frame[95805] = 0`）在 emulator 侧**没有对应物**（每条 handler 自己写自己的 arity）⇒ 如实登记，不编写点。

---

## §2 红→绿数字

### 2.1 两个新守卫文件的定点回退（脚本 `.tmp/t0169/redgreen.mjs`，8 条互相独立；每条 = 改一处 → 跑两个文件 → **逐字节还原**）

| 定点回退（改什么） | raw | 修前（红） | 修后（绿） |
|---|---|---|---|
| M1 删 `serviceRevealAdvanceInput` 的闩锁写点 | 13941 | `t0169` **tests=4 pass=3 fail=1**（闩锁支那条） | 4/4 |
| M2 让闩锁读支恒假 | 13917-13930 | `t0169` **4/3 fail=1**（同上） | 4/4 |
| M3 删 `engineValues` 的 `scriptEngineFlag` 初值 | 22591 | `t0175` **tests=5 pass=4 fail=1**（① 初值那条） | 5/5 |
| M4 删 `control.ts` 的开关复位 | 17961 | `t0175` **5/4 fail=1**（① 复位那条） | 5/5 |
| M4b 删 `control.ts` 的闩锁复位 | 17973 | `t0175` **5/4 fail=1**（① 复位那条） | 5/5 |
| M5 删 `advFrameAborted = true`（`== 2` 早退标记） | 20136 | `t0169` **4/3 fail=1**（三态机那条） | 4/4 |
| M6 让驱动恒不跳过（`if (true)`） | 20136→20165 | `t0169` **4/3 fail=1**（同上） | 4/4 |
| M7 删帧首 `e.serviceRedisplayExit()` | 20859-20881 | `t0175` **5/4 fail=1**（⑬ 帧驱动接线那条） | 5/5 |

- 还原校验：三个源文件**逐字节相同**（脚本自带的 `originals` 比对 + 行尾检查）⇒ 八条都是"定点回退，不是整体重写"。
- 单跑命令：`node --import tsx --test test/t0169-frame-reveal-pump.test.ts`（4 例）/ `… test/t0175-engine-flag-and-rewind.test.ts`（5 例）。
- **绿**：修后 `t0169` **4/4**、`t0175` **5/5**（合计 9/9）。
- ★本轮**唯一**一处既有断言的 retarget（按纪律：前提被取代 ⇒ 最小 retarget + 加强 + 写清因果与 raw）：
  `test/ops-142-12f-306.test.ts:58` 原断言 `engineValues.get(174812) === undefined`「默认不占位（引擎构造/复位置 1 由 op 语义给出）」——
  它钉住的正是 `T-0175` ① 要关掉的**未建模缺口**；改成 `=== 1` + 写明 raw 22591/17961 与"retarget 后这条**变强**（钉值而不是钉键不存在）"。
  retarget 后：`ops-142-12f-306` + `engine-fields-t0161` + `engine-config` = **19/19 绿**。

### 2.2 全量档（`test:all` = T0+T1）

- `npm run typecheck`（tsconfig / control / electron）→ **exit 0**；
  `npm run typecheck:test` → 期间有 2 条红（`save-slot-chain`/`save-slot-thumb` 的 `setSlotPixels` 桩，**T-0175 的 native 路在飞**），
  收口前该单元改完后已消失。
- **全量快照（2026-09-25 10:03:23，`.tmp/t0169/testall4.log`，234+ 个 T0|T1 文件）**：
  `tests 1604 / pass 1597 / fail 5 / skipped 2`，5 条红逐条归因：
  | # | 红 | 归因 |
  |---|---|---|
  | 1 | `★E4：本机真槽全部解出，且每帧记录的落点 opcode 与语义自洽` | **`T-0146` 基线**（`engine-slot` 真槽 `storedDwords`） |
  | 2 | `E4：真存档槽的头 → 0x1A0 的六个 u16 …` | **`T-0146` 基线**（`save-slot` 真槽 `format`） |
  | 3 | `场景执行报告：… 三张缺口清单` | **`T-0146` 基线**（可绘制项 24 ≤ 缺纹理项 26） |
  | 4 | `默认档有实质覆盖：T0 必须占多数…` | **别人的**：`test/t0107-l2d-asset-id-table.test.ts` 声明 `@tier T2` 而机械判据看不出 Electron 依赖（`organization.test.ts:89`） |
  | 5 | `★文档模型：每份 docs-new md 都有合法的 kind / state` | **别人的**：`docs-new/02-data/character-l2d-tables.md` 的 `kind: reference` 非法（`docs-new/**` 不在本单元可改面） |
  ⇒ **本单元新增红 = 0**（我那 1 条 `ops-142` 已 retarget 消掉）。
- `npm run check:dead-writes` → **★无新增死写**（基线 11 保持；两个新字段 `advFrameAborted`/`FIELD_REVEAL_INPUT_CONSUMED` 都有真读者）。
- `npm run verify` → 跑到 `test:all` 后非 0 退出（原因 = 上表 5 条里的非基线两项 + 3 条基线），与判绿口径「不新增红」一致。
- 邻域守卫 10 文件 94 例：其中 `adv-msgwin` / `adv-reveal-under-throttle` / `op-0100-reveal-current-window` / `frame-loop` /
  `frame-render-gate` / `adv-right-click-cancel-route` / `harness-convergence` / `organization` / `no-dead-writes` 全绿；
  唯一的邻域红 = `op-a2-a3.test.ts#0x249/0x245/0x246`（T-0175 的 native 路"拆缝"在飞，见 §4-④）。

### 2.3 等价跑法（绕开另一个单元的坏分类头）

`node .tmp/t0169/run-all.mjs`（= 用 `test/orgRules.scanTests` 挑 T0|T1，排除分类头解析失败的文件，其余与 `all` 同口径）——
数字见报告正文 §2；原始日志 `.tmp/t0169/testall2.log`、定点回退明细 `.tmp/t0169/redgreen.json`。

---

## §3 台账待应用（**主 agent 落库**；本单元不直接改 `analysis/**`）

### 3.1 `analysis/engine-capabilities.json`

**(a) `text-reveal-pump-409400`** — `emulator.note` 追加（现在时口径，不改既有句子）：

- `note`（追加）：「★2026-09（`T-0169`）：`sub_409400` 的**第二条落点**已补齐 —— `raw 13917-13930` 的 `else if (Engine[388212])` 支（清 `0x20000000` + 一次贴完当前窗、`set:DrawMode==1` 时另置强制冻结/清等待计时器）。闩锁写点 = `raw 13941`（逐字期间的左键/滚轮下/滚轮累加器 < 0 出口），清零点 = `0x6E`/`0x72` 的 `raw 28557`；触发场景 = 点击贴完后同一句里 `0x196 display-furigana` 续写（`raw 29093` 置 `0x20000000`、**不**清 `97053`）。体里 `raw 13925` 的 `result = 0` 无消费者（`raw 21178` 丢弃返回值）⇒ 不落。」
- `guard`（追加第二条）：`test/t0169-frame-reveal-pump.test.ts#★sub_409400 的 Engine[388212] 闩锁支`
- `journal`（append）：`{at:"2026-09-25（T-0169）", field:"emulator.note", what:"沿革（不进渲染字段）：原 note 的『缺口：逐字淡入色窗未接』保留；本次补的是 raw 13917-13930 闩锁支（`frame-render-gate-mainloop` note ③ 登记过的那一条）。"}`

**(b) `adv-perframe-dispatch`** — `emulator.note` 追加：

- 「★2026-09（`T-0169`）：对口关系按体写清 —— 本条的 `sub_411900` 在 emulator 侧 = `Engine.serviceAdv()` + **帧驱动 adv 分支的恰好 1 条 `dispatch()`**（`raw 20161-20165`）；`serviceRevealAdvanceInput`/`serviceTextReveal` 是 **`sub_409400`**（`raw 21176-21181` 的 `0x20000000` 臂）的对口，`serviceAdvanceWait` 是 **`sub_411BC0`**（`raw 21224-21226`）的对口。『每轮恰好 1 条』的唯一例外 = `set:CancelMesSkipOnClick == 2` 的整帧早退（`raw 20133-20136`，`Engine.advFrameAborted`）。」
- `guard`（追加）：`test/t0169-frame-reveal-pump.test.ts#★判据②的分支对口` / `#★sub_411900 取消消息键三态机`
- `journal`（append）：`{at:"2026-09-25（T-0169）", field:"emulator.note", what:"沿革：原 note 只说『已实现 serviceAdv + adv 分支』；本次补上三条 pump 与三个引擎函数的一一对应，并落掉 raw 20133-20136 的整帧早退。"}`

**(c) `msgwin-cancel-key-state`** — `emulator.note` 追加 + `status` 由 `partial` 不变：

- 「★2026-09（`T-0169`）：三态机**极性按体复核 = 与 emulator 逐支同形**（审计 `T-0161` §5 row 14 的 `overreach` 不成立）；真缺的三件已补齐：`raw 20120` 的 `*v2 &= ~0x10`（落 `input.inputMask`）、`raw 20127` 的 `sub_4053C0`（= `eatAllInput()`）、`raw 20133-20136` 的 `GetConfig(...) == 2` **整帧早退**（`Engine.advFrameAborted` + 帧驱动跳过那一条指令）。`raw` 范围由 `20096-20160` 收窄为 `20115-20143`（三态机本体）。」
- `guard`（追加）：`test/t0169-frame-reveal-pump.test.ts#★sub_411900 取消消息键三态机`
- `journal`（append）：`{at:"2026-09-25（T-0169）", field:"emulator.note", what:"沿革：T-0161 把『极性要改 engine.ts』挂到 T-0175；本单元回体后确认极性本来就对，改的是另外三件（位消费/eatAllInput/==2 早退）。"}`

**(d) `text-redisplay-rewind`** — `engine.raw` 追加 + `emulator.note` 追加：

- `engine.raw`：`"28724-28733"` → `"28724-28733,13997-14008,20365-20374,20859-20881"`（四条写者/一条主循环臂的区间；★`trigger` 里那句「主循环 `sub_409700` 的 `effect_flags & 0x20` 分支是另一条消费路径」应改成「`sub_409700` 的**输入掩码 `& 0x20`（右键）**分支」——见 §6-①）
- `emulator.note`（追加）：「★2026-09（`T-0169`）：`raw 20859-20881` 的主循环 `0x4000000` 臂（用**备用**游标 `122412+cur`）已落地 = `Engine.serviceRedisplayExit()` + `src/frame/loop.ts` 帧首调用；`raw 13997-14008`（`sub_409700`，用**主**游标）**不做**：其门 `0x10000000` 的唯二置位端是 `0x8E`/`0x95`（panelB，语料 0 处，见 `handlers/panel.ts` 的登记）。三处写的都是同一批格（`122452`/`122453`/`107678`）⇒ `0x7C` 对三条路天然成立。」
- `guard`（追加）：`test/t0175-engine-flag-and-rewind.test.ts#★⑬ 主循环 0x4000000 臂` / `#★⑬ 三条负对照` / `#★⑬ 帧驱动接线`

### 3.2 `analysis/opcode-gaps.json`（主 agent 说要销/改写 `0x7c` 的 `missing[2]`）

- opcode **124（`0x7c`）** 的 `missing` 两条里：
  - **`raw 20870-20877`（主循环 `0x4000000` 臂）⇒ 删除**（本单元已实现 + 守卫，见 §1-③）。
  - **`raw 13997-14008`（`sub_409700` 的右键臂）⇒ 改写成「引擎侧不可达（门 `0x10000000` 的两个置位端 `0x8E`/`0x95` 是 panelB 通路、语料各 0 处 ⇒ 连引擎自己的主循环臂都进不去）；emulator 侧归 `panel-b-display-state` 的已登记缺口」**（不建议继续挂在 `0x7c` 的 `missing[]` 上，否则"缺口"与"引擎死路"混在一起，违反 `T-0149` 的 `partial` 口径）。
- `missing[]` 计数：`0x7c` 由 2 条 → **0 条**（若两条都按上面处置，则 disposition 可由 `partial` 升 `implemented`；请主 agent 按 `T-0149` 的口径裁决 —— 我倾向**升 `implemented`**，因为剩下的那一条是引擎死路、不是 emulator 的近似）。

### 3.3 `analysis/functions.json` / `analysis/fields.json`

- `fields.json`：`scriptEngineFlag`（`0x5EC9C`？ = 字节 699248）如有条目 ⇒ `meaning`/`evidence` 追加「构造初值 = 1（`raw 22591`）与整体复位值 = 1（`raw 17961`）**已在 emulator 建模**（`src/vm/engine.ts` 的 `engineValues` 初值表 + `handlers/control.ts` 的 `op_exit_script`）」。★我**没有**核对该文件里这条的现有 id/键名（未读体），请主 agent 按 id 落。
- `fields.json`：**建议新增** `Engine[97053]`（字节 388212，逐字泵的"贴完整页已消费"闩锁）：writer `raw 13941`、readers `raw 13917`、clear `raw 28557`（`0x72`）+ `raw 17973`（整体复位）+ `raw 22604`（构造）、emulator 落点 = `src/vm/engine.ts` 的 **`FIELD_REVEAL_INPUT_CONSUMED`（已 export）**。
  ★**并请顺手把它迁进 `engineFieldIds.ts`**（`ENGINE_FIELD.revealInputConsumed`）：本单元的可改面不含该文件，而 `engine-field-ids.test.ts` 的棘轮禁止 `src/vm/**` 出现裸数字键 ⇒ 现在常量暂住在 `engine.ts`（`handlers/control.ts` 从那里 import）。迁移后要同步改 `control.ts` 的 import 与 `engine.ts` 的用法（各一行），判据 = `engine-field-ids.test.ts` + `t0175` 守卫仍绿。
- `fields.json`：**建议新增** `Engine[122452]/[122453]/[107678]` 的第三条写者（主循环 `0x4000000` 臂）——若这三格已有条目，请在 `evidence`/`notes` 里补 `raw 20859-20881` 与「用**备用**游标 `122412+cur`」这一句。
- `functions.json`：`sub_409400` 条目（如已存在）追加「`raw 13917-13930` 的 `Engine[388212]` 支」；`sub_409700` 条目追加「它的唯一入路 = `0x10000000`（`0x8E`/`0x95` 置位，panelB）⇒ 语料不可达」。

---

## §4 别人该接（文件 + 改什么 + 判据 + raw 锚点）

1. **`#cancelRoute` 的取值来源是**错格**（`src/vm/engine.ts` 已改的只有注释，行为未动；`test/adv-right-click-cancel-route.test.ts` 的 8 例按现口径钉着 ⇒ 归 `T-0167`/`T-0168`）**
   - 体：`raw 20367` 读 `_this + 4*v6 + 489488` ⇒ 绝对下标 **`122372 + cur`** = `rewindMainBase[cur]`（`0x7B` 的 **op1**，`raw 28729` 写）；而 `0xCC`（`mouse-callback`）写的是 `_this[107664]`（`raw 30322`），读者是 `0xCD`（`raw 25851` `v4 = *(_DWORD *)(_this + 430656)`）。**emulator 现在用 `input.mouseJump`（= `107664`）代替 `rewindMainBase[cur]`**。
   - 后果：只跑 `i0cc` 不跑 `i07b` 时，引擎这里读到 `-1` ⇒ **直接 `return` 什么都不做**；emulator 却会把 `0xCC` 的目标派发出去。
   - 改法与判据：`#cancelRoute` 改为读 `engineValues.get(ENGINE_FIELD.rewindMainBase + this.cur) ?? -1`；`adv-right-click-cancel-route.test.ts` 的两条正例改成「先 `i07b` 写主游标」或手工种 `engineValues`（**禁止**只把 `registerMouseCallback` 换成 `0x7B` 而不补"未注册 ⇒ ip 不动"的负例）；判据 = 新增一条「只 `i0cc` 不 `i07b` ⇒ ip/flags/三格全不动」。
   - raw 锚点：`20365-20374`（读端）/ `28724-28733`（`0x7B` 写端）/ `30317-30326` + `25851`（`0xCC`/`0xCD` 那一格）。
2. **`src/vm/msgwin.ts:801`（`FIELD_COEXIST_AUX = 97053`）的过期字段注释**：那里写着「引擎 `Engine[97053]`：与共存消息同段的记账格（`raw 28557` 只写 0）」（`:743` 同口径「该格全库只写不读，照写」）——**按体不成立**：`raw 13917` 是它的读者（逐字泵的闩锁支），`raw 13941` 是它的置 1 写者，`raw 17973`/`22604` 是复位/构造清 0。改：注释改成与 `src/vm/engine.ts` 的 `FIELD_REVEAL_INPUT_CONSUMED` 同口径（并回链本文件 §3.3）。
   ★文件归属：`src/vm/msgwin.ts` 属 `T-0019`（`T-0019` 的半成品拆分曾被主 agent 回滚，所以这段文字当时短暂出现在 `src/vm/msgwin-reveal.ts`；**现在在 `src/vm/msgwin.ts`**）。判据 = 注释串 + 本票的两条闩锁守卫。
3. **`0x10000000` 臂（`sub_409700`，raw 13970-14075）整体未建模**：它的两个置位端 `0x8E`（`raw 29442`）/`0x95`（`raw 29585`）都调 `sub_4040A0(panelB, …)` ⇒ panelB 建模前无法接线。重开条件 = 建 panelB（`Engine+0x32B0`）；届时这一臂的右键支（`raw 13997-14008`）与左键支（`raw 13985-13996`）要**一起**落（`T-0175` ⑬ 的第 1 条写者就此闭合）。
4. **`Engine[97053]` 的常量规范位置**：本单元把它放在 `src/vm/engine.ts` 并 `export`（`FIELD_REVEAL_INPUT_CONSUMED`），因为 `handlers/control.ts` 的复位点要用它、而 `engine-field-ids.test.ts` 的棘轮禁止 `src/vm/**` 出现裸数字键、且本单元的可改面**不含** `src/vm/engineFieldIds.ts`。规范做法 = 迁进 `engineFieldIds.ts` 的 `ENGINE_FIELD.revealInputConsumed`（`control.ts` 的 import 跟着改一行）。
5. **`tickets.js --validate` 的 15 条行号漂移（锚点全在，只是行号动了）**：其中 13 条落在 `src/vm/engine.ts`/`src/frame/loop.ts`（**本单元的插行造成**）、1 条 `src/vm/native.ts`、1 条 `src/renderer/pixi/textureCache.ts`（另一个单元）。工具判据已机械核过：**15/15 的锚串仍能在文件里找到**（脚本 `app/amayui-emulator/.tmp/t0169/check-drift.mjs`，输出见报告正文）⇒ 按纪律是"只改指不删"的安全情形，用 `.tmp/settle/fix-lines.mjs --any` 刷新即可（本单元不改别人的票面）。★其中 `serviceRevealAdvanceInput` 这条现在**先在 engine.ts:80 的注释里命中**（本单元新写的注释提到了它），**定义**在 `engine.ts:947` ⇒ 刷新时请把该条 line 指到定义行（或把 anchor 换成完整签名 `serviceRevealAdvanceInput(): boolean {`）。
6. **供对账：本单元改动之外的在飞红（都不是我的文件）**
   - `test/t0107-l2d-asset-id-table.test.ts`：`@tier T2` 无 Electron 依赖证据 ⇒ `organization.test.ts:89` 红（改 `T1` 或补机械证据）；
   - `docs-new/02-data/character-l2d-tables.md`：`kind: reference` 不在白名单 ⇒ `doc-model.test.ts` 红；
   - `op-a2-a3.test.ts#0x249/0x245/0x246` + `typecheck:test` 的 `save-slot-chain/thumb` 曾在同一时段红：与 `handlers/gfx-texture.ts` + `native.ts`/`nativeTap.ts` 的"拆缝"（`setTextureObjectParam` → `…Color`/`…SubParam`，`T-0175` ③）同源。

---

## §5 改动文件清单

| 文件 | 规模 | 内容 |
|---|---|---|
| `app/amayui-emulator/src/vm/engine.ts` | 文件级 `git diff --stat` = **+241 / −16**（含上一波未提交的 `T-0173` 删字段与 `T-0167`/`T-0168` 注释；**属于本单元的 ≈ +190 / −8**） | ①`scriptEngineFlag` 初值 = 1（`raw 22591`）②`serviceAdv` 的三态机补齐（`raw 20120`/`20127`/`20133-20136`）+ 注释键名/极性按体改写 ③`advFrameAborted` ④`export const FIELD_REVEAL_INPUT_CONSUMED`（97053）+ `serviceRevealAdvanceInput` 置闩锁（`raw 13941`）+ `serviceTextReveal` 的闩锁支（`raw 13917-13930`）⑤`REDISPLAY_MODE` 常量 + `serviceRedisplayExit()`（`raw 20859-20881`）⑥`#cancelRoute` 注释登记取值来源口径差 |
| `app/amayui-emulator/src/frame/loop.ts` | +60 / −6 | ①帧首 `e.serviceRedisplayExit()` ②adv 分支：`advFrameAborted` ⇒ 跳过本帧那一条 ③`text-revealing` 分支的 6 条判据②结论注释 |
| `app/amayui-emulator/src/vm/handlers/control.ts` | +19 / −1 | `op_exit_script`（= `sub_40DF10`）复位 `scriptEngineFlag = 1`（`raw 17961`）与逐字泵闩锁 = 0（`raw 17973`）+ 改动理由（`control.ts` 的边界例外说明） |
| `app/amayui-emulator/test/ops-142-12f-306.test.ts` | +11 / −1 | **唯一一处前提被取代的 retarget**：`:58` 的「默认不占位」⇒「必须是 1」（+ raw 22591/17961 与因果）；该文件其余断言一字未动 |
| `app/amayui-emulator/test/t0169-frame-reveal-pump.test.ts` | 新建（246 行） | 4 例：闩锁支 / 分支对口 / 三态机早退 / 泵名反谎报 |
| `app/amayui-emulator/test/t0175-engine-flag-and-rewind.test.ts` | 新建（188 行） | 5 例：初值 / 复位（含闩锁复位）/ `0x4000000` 臂 / 三条负对照 / 帧驱动接线 |
| `tickets/T-0169/ticket.json` | +21 / −3 | `tests[]` + `doneWhy` + evidence 行 448→459 + 两条 history + `status: done` |
| `tickets/T-0169/changes-reveal.md` | 本文件 | 报告 |
| `.tmp/t0169/*`（未入库） | — | `probe1.ts`（帧循环分支探针）/ `redgreen.mjs`（红→绿 8 条）/ `redgreen.json` / `run-all.mjs`（绕开别人坏分类头的等价全量）/ `check-drift.mjs`（15 条漂移逐条验锚）/ `testall*.log` / `patch-branch-test.mjs` |

---

## §6 与报告/台账不符的新事实（**报告说 → 体里是（raw N）**）

1. **报告说**（`T-0157` §4 别人该接 #1 / `tickets/T-0157/changes-frame.md`）：「raw 13997-14008 的 **`effect_flags & 0x20`** 臂」——**体里是**：那是 `sub_409700` 内**输入掩码**的 `else if ((result & 0x20) != 0)`（`raw 13997`，`result = *v2` = `Engine[174802]` 输入掩码，`raw 13984`），臂的门在 `effect_flags & 0x10000000`（`raw 21200`）。`effect_flags & 0x20` 是**另一支**（主循环 `raw 21190` 的 `sub_453AF0(Engine+429900)` 计时器臂）。
2. **报告说**（`T-0157` 同上）：「`#cancelRoute` 已落」——**体里是**：路由形状对了，但**取值来源错格**（`489488+4*cur` ≡ `rewindMainBase[cur]` = `0x7B` 的 op1，`raw 20367`/`raw 28729`；emulator 用的是 `0xCC` 的 `107664`，`raw 30322`）⇒ 见 §4-①。
3. **报告说**（原 `T-0169` 标题/why）：「逐字显现帧不跑等待泵（引擎同一轮里 20887 与 21226 都会跑到）」——**体里是**：`raw 21176-21228` 是 if/else-if/else 链，`0x20000000`（逐字）为 1 时 `sub_411BC0`（21226）**到不了**；20887（字格图标泵）与 **`sub_411900`（21160）**同轮，不是与 21226 同轮。
4. **报告说**（`T-0161` §5 row 14 / `T-0175` ①）：「cancel-message 三态机的**极性**要改」——**体里是**：emulator 的三支与 `raw 20117-20141` 逐支同形，「`0→1` 发生在位为 0 的那一帧」本来就对；缺的是 `raw 20120` 的位消费、`raw 20127` 的 `sub_4053C0`、`raw 20133-20136` 的 `== 2` 早退（已补）。
5. **报告说**（`frame-render-gate-mainloop` note ③）：「`sub_409400` 第二落点 `raw 13923-13929` … 多出的 `result = 0`（『这一帧不算画面推进』）」——**体里是**：`result` 只被 `raw 21178` 的调用点**丢弃**（`sub_409400(_this);` 不看返回值）⇒ 那一格的差别**不可观测**；真正可观测的是「闩锁支会**一次贴完当前窗**」。
6. **报告说**（`src/vm/msgwin.ts:801` 的注释，同一段文字短暂出现在被回滚的 `msgwin-reveal.ts`）：「`Engine[97053]` … 该格全库只写不读」——**体里是**：`raw 13917` 就是它的读者（`else if (*(_DWORD *)(_this + 388212))`），`raw 13941` 写 1（`raw 17973`/`22604` 清 0）。
7. **报告说**（`docs-new/03-engine/adv-text-rendering.md` 与台账口径）：「逐字期间的输入出口只有左键」——**体里是**：`raw 13935-13938` 是**三条**（左键 `0x10` / `AdvanceMesOnWheel & 1` 且滚轮下键位 / 滚轮累加器 `Engine[7796] < 0` 读后清）—— emulator 的 `serviceRevealAdvanceInput` 已按三条实现（此条只作口径提醒，非新增缺口）。
