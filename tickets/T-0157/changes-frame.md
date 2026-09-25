# T-0157 变更记录 —— 指令实现缺口修复批：帧循环 / 阶梯调度 / 队列派发（12 条：P1 1 / P2 4 / P3 7）

> **权威** = `engine/天结_unpacked.exe_utf8.c`（只读；本文件里 `raw NNNNN` = 该文件行号）与
> `docs-new/99-records/2026-09-impl-audit/impl-audit-2026-09.md`（报告）+ 它的机器可读原件
> `docs-new/99-records/2026-09-impl-audit/raw/verify-verdicts.json` 的 `frame-loop` 组
> （7 条 `refute` + 3 条 `recall`）。
> **可写面（本票，父票硬边界）**：`src/frame/**`、`src/vm/handlers/frame.ts`、`src/vm/interpreter.ts`
> 与我新建的 `test/*.test.ts`。⛔ 禁改：`src/vm/engine.ts` / `handlers/control.ts` / `handlers/{msgwin,control,input,gfx-*}.ts` /
> `src/vm/input.ts` / `src/renderer/**` / `analysis/**` / `tickets/**` / `CONTEXT.md`。

## 0. 一句话结论

**本批 12 条里没有一条需要本轮新写的行为代码** —— 每一条读体后都落到三种处置之一：
① 已被别的波次按体修好（`T-0156` 修 `0x7c`/`0xc8`/`0xae`；`T-0166`/`T-0167` 修
`frame-render-gate-mainloop`/`clock-write-clock-freeze`；`T-0170` 与 `T-0156` 修 `0x1f5` 的邻域）；
② 引擎里**没有写者**（`387940`）⇒ 如实登记、不许编消费者；③ 落点在**本票禁改文件**（`src/vm/engine.ts`
的两条主循环臂）⇒ 如实登记 + 写进「别人该接」。

因此本票的产出 = **一个 15 例的仓库级守卫文件**（`test/t0157-frame-loop.test.ts`，T0 / core / frame）+
**一份可机械复算的判别力证明**（`.tmp/t0157/mutate-red.mjs`：8 次定点回退，每次都必须让指定用例转红、
复原后回绿）+ 逐条处置表 + 台账待应用片段。
★这一批的**验收价值在"钉住 + 纠错"而不在"新写"**：读体过程中我订正了报告/台账的 **5 处**事实（见 §6）。

## 1. 逐条处置表（12 条 + 3 条顺带核对 = 15 行）

| # | sev | 对象 | kind | 出处（报告行） | 处置 | raw 锚点 | 守卫（用例名里的唯一子串） |
|---|---|---|---|---|---|---|---|
| 1 | **P1** | `0x1f5` | missing-branch | §4.1 #107 + §4.1 #6 | **复核后已修**（三层门齐备：① `frameCount<=0` ② `frameTickLock` 原值非 0 ③ `dispatchInProgress==0`；清位与派发同次进入；`dispatchNextRequest` = `sub_40FB60` 的唯一一份实现，入口停靠闸在 `control.ts`） | 25214-25236（体）/ 18966（闸）/ 497400 的 3 个写点 = 18149/18980/25667 | `P1 0x1f5：三层门` |
| 2 | P3 | `0x1f5` | missing-operand-io | §4.1 #181 | **前提被推翻**：报告说的"折叠成一个键"**不成立** —— `frameTickLock`(107438) 与 `frameCount`(107439) 是两个独立 `engineValues` 键、与体逐格对应；且"无条件清 429752"与同一段引文里的 `if` 自相矛盾（体是**有条件**清） | 25221-25227 | `P1 0x1f5：③ 派发中标志非 0`（钉极性 `== 0`） |
| 3 | P3 | `0x1f5` | missing-dispatch | §4.1 #182 | **复核后已修**（同上；`dispatchNextRequest` 现有 3 个调用点：`0x143` 尾 / `exit` 的 `-10` / `0x1F5`） | 18966-18975 + 25224-25229 | 同 #1 |
| 4 | **P2** | `0x7c` | missing-branch | §4.1 #108 | **复核后已修**（深度校验改成**无条件**，去掉 `want !== -1` 哨兵；`430712` 的初值/整块复位值都是 −1） | 25798-25807 / 18155 | `P2 0x7c：深度校验**无条件**` |
| 5 | P3 | `0x7c` | missing-operand-io | §4.1 #302 | **复核后已修（豁免收窄）+ 登记**：`81776/81768/51840` 无读者 ⇒ 不建模；**`51848` 有真读者**（raw 20005/20013/20286，`>=0 && < _this[23008]` 当索引）⇒ 记为"有读者但选择/列表框模型未建" | 25812-25815 / 20005/20013/20286 | `P2 0x7c：深度校验**无条件**`（体侧）；登记面见 §4 |
| 6 | P3 | `0x7c` | missing-consumer | §4.1 #303 | **如实登记**：`387940` 在全反编译**只有 3 处引用**（构造清零 raw 22605 + 0x7C 的读 raw 25816 与写 raw 25818）⇒ **无写者、门恒假** ⇒ emulator 侧不接线是**正确**的 | 25816-25822 | `P3 0x7c：387940 的列表收尾派发` |
| 7 | P3 | `0x7c` | missing-writer | §4.1 #304 | **部分前提被推翻 + 登记**：三处写者里**已经落了一处** —— raw 20365-20374 的右键取消路由 = `src/vm/engine.ts` 的 `#cancelRoute()`（写 `redisplayMode`/`redisplayScriptId`、`ip` 回退；`redisplayReturn` **有意不写**，见该文件的表格行）。**未落**：raw 13997-14008 的 `effect_flags & 0x20` 臂、raw 20870-20877 的 `0x4000000` 臂 | 13997-14008 / 20365-20374 / 20870-20877 | `P3 0x7c：`redisplayScriptId` 的三处写者` |
| 8 | **P2** | `0xc8` | approximation | §4.1 #127 | **部分修 + 架构性近似登记**（`T-0156`）：两支语义分开表达（`sleepPath()` 边界 9/10；`|= 1` 只在 n≥10；`Math.max(0,n)` 不再把 `Sleep(0)` 抬成 1ms）；`n<10` 的"进程级硬阻塞"在单线程宿主里只能表达成"让出一帧"（有实测反例：不装门 ⇒ TITLE 的 `sleep 1; jmp` 同帧内永不 yield、挂死） | 30301-30312 + 66101-66186 | `P2 0xc8：两支分离的边界` |
| 9 | **P2** | `0xc8` | missing-branch | §4.1 #128 | **已修（同 #8）** + ★**语料计数订正**：我实测 `sleep` 共 **385** 处（`1f4`=500ms **334** / `1` **38** / `0` **12** / `10` **1**），其中 **n<10 = 50 处**（38+12）—— 报告写的"51 处"**比实测多 1**；报告给的 334/38/12/1 四个桶与我逐字一致 | 30303-30312 | `P2 0xc8：语料计数棘轮` |
| 10 | **P2** | `0xae` | missing-branch | §4.1 #118 | **复核后已修**（`sv1==1 ⇒ sv2 必须 20`；且**不能**无条件施加到本工程槽 —— `format=0 ⇒ sv1=0 ∉ {1,2,3}` ⇒ 会让本工程槽续跑整体失效；最终三条规则见 `frame.ts` 注释） | 24663 / 24738 | `P2 0xae：sv1=1 时 sv2 必须 =20` |
| 11 | P3 | `0xae` | missing-operand-io | §4.1 #324 | **有意保留（等价实现）**：`resume.sv1/sv2`（容器头 +284/+288）优先于注册表 —— 那是**同一份槽自己声明的版本**（本工程槽 `format=0`/`aux=20`），既有守卫钉着该设计；体的 `sv1/sv2` 来源只有注册表两次调用 | 24660-24662 | 同 #10 |
| 12 | P3 | `0xae` | missing-operand-io | §4.1 #325 | **等价实现（字段未具名）**：`97153`（深度）/`256*cur+97193+i`（返回栈数组）由 `resolveSlotRetStack` + `frame.retStack` 承接（同为 dword 偏移、`+3` 语义） | 18942-18946 | 同 #10 |
| 13 | **P2** | cap:`frame-render-gate-mainloop` | missing-behavior | §4.2 #3 / §4.5 #55+#56 | **复核后已修**（`frameRenderGate()` 纯函数逐字复刻 raw 20740-20761；门在驱动里排在 `advanceModel`/`present` **之前**）+ ★**未做项登记**：`0x400` 动画等待门的放行块（raw 21109-21140）在引擎里还要求 **`Engine[92340]` 的 bit0 为 0**（raw 21114），emulator **没有这道门** | 20740-20765 / 21109-21140 | `P2 frame-render-gate：`frameRenderGate` 复刻`；`P2 frame-render-gate：驱动里门在`；`P2 frame-render-gate：`Engine[92340]` bit0` |
| 14 | **P2** | cap:`frame-render-gate-mainloop` | missing-behavior | §4.2 #2 / §4.5 #56 | **复核后已修 + 措辞订正**：帧提交段与电影段确实在**同一轮**里先后执行（20896-20917 是内层 `while` 的出口，**不跳过**帧提交）；真空缺 = 电影对象子系统整体未建模（`0x20F` 只到宿主缝 `native.playMovie`） | 20740-20765 / 20896-20917 / 20903 | `P2 frame-render-gate：帧提交段与电影段同轮先后`；`P2 frame-render-gate：驱动里门在` |
| 15 | **P2** | cap:`clock-write-clock-freeze` | missing-behavior | §4.2 #4 / §4.5 #57+#58 | **一半已修、一半如实登记 + ★措辞订正**：主循环帧时钟写已落地（门内 `clockPrev ← clock; clock ← nowMs`）；锁 `429752` 挡住的是 raw **20838-20858**（`0x1000`/`0x800` 阶梯段）**与** raw 20896 的电影段，**不是**工作清单写的 raw 20831-20837（`effect_flags & 0x200` 的 10ms/10000ms 双计时器刷新 —— 那段在锁门**之前**，锁碰不到它） | 20831-20837 / 20838-20858 / 20896 | `P2 clock-write-clock-freeze：停靠锁挡的是`；`P2 clock-write-clock-freeze：锁挡住的两段` |

> 顺带（不占票内条数）：`0x1f5` 的"队列恰剩 1 项"判据**属于 `0x7C`**（raw 25819-25821），
> `0x1F5` 体里没有任何队列长度判据 —— 已作为棘轮钉进 #1（`if5` 体切片里不得出现 `497380/497384`）。
> 另：报告 §4.1 #175 顺带点名的配置键名是 **`set:CoexistMesSkip`**（raw 4276 的
> `char aSetCoexistmess[19] = "set:CoexistMesSkip"`），不是 `CoexistMess` —— 已单独钉一条。

## 2. 红 → 绿数字（确切命令）

### 2.1 守卫本体（写完全绿）

```text
cd app/amayui-emulator
node --import tsx --test test/t0157-frame-loop.test.ts
  → ℹ tests 15 / ℹ pass 15 / ℹ fail 0

# 与本批相邻的守卫一起跑（确认没踩到别人）
node --import tsx --test test/t0157-frame-loop.test.ts test/organization.test.ts \
  test/harness-convergence.test.ts test/op-1f5-dequeue.test.ts \
  test/t0156-control-frame.test.ts test/frame-render-gate.test.ts
  → ℹ tests 59 / ℹ pass 59 / ℹ fail 0

# 仓库级棘轮（父 agent 点名要求）
node --import tsx --test test/organization.test.ts test/harness-convergence.test.ts
  → ℹ tests 10 / ℹ pass 10 / ℹ fail 0
     （首行 pragma：`/** @tier T0 @kind core @subsystem frame */` —— 本文件只用合成指令
      + `mkEngine`/`instr`，没有任何真资产依赖 ⇒ T0 是诚实档）

node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit   → exit 0
# 四套 typecheck（本机入口；`npm run` 走不了 node_modules/.bin，见 CONTEXT §7）
node node_modules/typescript/bin/tsc -p tsconfig{,.test,.control,.electron}.json --noEmit
  → 四个都 exit 0

# 票据收尾三连
node scripts/build-tickets.mjs
  → [ok] tickets/README.md ← 176 张票（doing 4 / blocked 0 / open 10 / done 160 / dropped 2）
node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --validate
  → ✅ 票据自检通过（176 张）★0 条行号漂移警告
node --import tsx --test test/ticket-ledger.test.ts
  → ℹ tests 6 / ℹ pass 6 / ℹ fail 0
```

### 2.2 判别力证明：`node .tmp/t0157/mutate-red.mjs`（**这是本票的红**）

本票的多数修复由别的波次落地 ⇒ 对**当前树**跑守卫只有绿。若就此交回，"绿"无法区分
"守卫真的盯着那条依据"与"断言恒真"。所以用**定点回退**（mutation）证明每一条：
每步只把一个片段换成**与体不符的形状**（= 修前的形状），跑同一个守卫文件，
**指定用例必须转红**；随后 `finally` 复原并再跑一次确认回绿。8 步实测：

```text
cd app/amayui-emulator && node .tmp/t0157/mutate-red.mjs
✔ 第 1 步红：fail=1 命中「★P1 0x1f5：三层门…」        （体里 ② 停靠标志这道门被删）
✔ 第 2 步红：fail=2 命中「★P1 0x1f5：③ 派发中标志非 0…」 （0x1f5 ③ 的 `== 0` → `!= 0`）
✔ 第 3 步红：fail=1 命中「★P2 0x7c：深度校验**无条件**…」 （深度校验被加上哨兵前置条件）
✔ 第 4 步红：fail=1 命中「P3 0x7c：387940 的列表收尾派发…」（`v6-v5==1` → `>= 0`）
✔ 第 5 步红：fail=1 命中「★P2 0xc8：两支分离的边界…」     （0xc8 边界 `>=10` → `>=9`）
✔ 第 6 步红：fail=1 命中「★P2 frame-render-gate：驱动里门在…」（门被挪到 advanceModel 之后）
✔ 第 7 步红：fail=2 命中「★P2 clock-write-clock-freeze：停靠锁挡的是…」（锁门内 0x1000 → 0x200）
✔ 第 8 步红：fail=1 命中「P2 frame-render-gate：`Engine[92340]` bit0…」（raw 21114 的 bit0 门被删）
每一步 ↳ 复原后 fail=0（绿）
★全部回退都被守卫抓到、且每次都复原回绿。
```

★**这个方法本身抓到了一次自己的判别力不足**：第 1 步最初**没红** —— 因为
`if ( *(_DWORD *)(_this + 429752) )` 这个串在体里出现 **2 次**（raw 20896 的内层出口与 raw 25224 的 ② 门），
我最初在**全文**上判"它在不在" ⇒ 删掉 ② 门之后那串仍在 ⇒ 断言放过了这个改动。
修法：把它限定在 `sub_41A0E0` 的**函数体切片**里判（并加"切片长度必须 < 2000"防"切到文件尾"）
—— 顺带记一个坑：这份反编译器在每个函数**定义之前**还输出一行**原型声明**
（raw 410 的 `void __thiscall sub_41A0E0(int _this);`），`indexOf('void __thiscall sub_41A0E0')`
会命中那一行、切出"从原型到文件尾"的整段（第一版就是这么错的）⇒ 现在按 `//----- (地址)` 头切片。

### 2.3 全量（`verify` 的替代口径，见 §5.3）

```text
cd app/amayui-emulator
node --import tsx test/run.ts all      → ▶ 228 个文件 / ℹ tests 1575 / pass 1570 / fail 3 / skipped 2
                                          ★3 条红逐条 = 已知基线（票 T-0146），**本票新增红 0**：
                                            · engine-slot「★E4：本机真槽全部解出…」（SAVE70/71 storedDwords）
                                            · save-slot「E4：真存档槽的头 → 0x1A0 的六个 u16…」（真槽 format）
                                            · scene-report「场景执行报告…」（可绘制项 24 ≤ 缺纹理项 26）
node --import tsx src/tools/deadWrites.ts  → ★ 无新增死写（exit 0；基线 13）
```

★与 `CONTEXT.md` §6 记的基线（**222 文件 / 1544 例**）差 **6 文件 / 31 例**：本票贡献 **+1 文件 / +15 例**
（全绿），其余 **+5 文件 / +16 例**是**并行单元**（`T-0167`/`T-0168`/`T-0173` 在同一工作区新建的
`t0167-*`/`t0168-*`/`l2d-*` 守卫）—— 它们与 `src/**` 的改动此刻是 `git status` 的 modified 状态
（不属于本票）。**本票的绿 = 上述 3 条红恰好是基线、第 4 条红一条都没有。**

## 3. 台账待应用（**由主 agent 落库；本票不碰 `analysis/**`**）

> 口径提醒（本工程已有的三条硬规矩）：`missing[]` 只有 `partial` 能有；被渲染字段
> （`name`/`note`/`trigger`/`whySilent`/`guard`/`evidence`）**只写现在时事实**，沿革进 `journal[]`；
> `engine.raw` 必须**单段** `^\d+(-\d+)?$`。

### 3.1 `analysis/engine-capabilities.json`

**(a) `frame-render-gate-mainloop`** —— 在现 note 末尾（`**重开条件**：…` 之前）追加两条**现在时**事实：

```jsonc
{
  "id": "frame-render-gate-mainloop",
  "emulator": {
    "note": "…（保留现文）…⑤ `0x400` 动画等待门的**放行块**（raw 21109-21140）另有一道 `Engine[92340]` 的 **bit0** 门（raw 21114：`GetConfig(\"system:EffectSkipOnClick\") && (*(_BYTE*)(_this+369360) & 1) == 0`）：bit0 置位时引擎**只** `break`（不做 `sub_407EA0` 清池计时器、不 `sub_4B4040` 重提交、不清 `effect_flags & 0x400`），emulator 在 `src/frame/loop.ts` 的 `anim` 支**无条件**清 `0x400` ⇒ 该门未建模。`Engine[92340]` 的写者 = `0x24E`（`sub_4258C0` raw 32959-32967，`_this[92340] = op1`）；语料 `i24e` **422** 处，其中 `10001`（bit0=1）**413** / `0` 3 / `1` 3 / `10003` 3 ⇒ **bit0 在近全部语料上为 1**，与另一条「bit1 = 0（所以真机不进 raw 13923 支）」**互为反相、不可混为一谈**。扩展点 = 在 `frame/loop.ts` 的 `anim` 支加该门 + 把 `system:EffectSkipOnClick` 的读点接上（`src/vm/engine.ts` 的 `serviceRevealAdvanceInput` 已引 raw 21113-21135 与同一配置键，是同一段的另一半）。"
  },
  "journal": [
    { "at": "2026-09-25", "field": "emulator.note", "what": "T-0157：补上 raw 21114 的 bit0 门与 `i24e` 语料分布（原 note 只写了 bit1 / raw 13923 那半）。" }
  ]
}
```

**(b) `clock-write-clock-freeze`** —— 把"锁挡住的两段"那半的措辞**逐条对齐体**（现 note 里
"raw 20896 的 `if (*(_DWORD *)(_this + 429752)) break;`（电影/等待段收尾）"这一句要写全）：

```jsonc
{
  "id": "clock-write-clock-freeze",
  "emulator": {
    "note": "…（保留现文前半）…锁 `Engine+107438` 在**主循环**里挡住的是两段：① raw 20838-20858 —— `if (!*(_DWORD *)(_this + 429752))` 之内的 `0x1000`/`0x800` 阶梯/等待块（`sub_453B60(Engine+430096)` 读计时器）；② raw 20896-20917 —— `if (*(_DWORD *)(_this + 429752)) break;` 之内是内层 `while` 的**出口**，之后才是电影对象生命周期段（`0x2000` 位）。它**不**挡 raw 20831-20837 的 `effect_flags & 0x200` 双计时器刷新（那段在锁门**之前**），也**不**挡帧提交段（挡后者的是 raw 20740 的 `DrawMode` 门）。两段在 emulator 的帧驱动里都不存在（效果计时器调度 / 电影段本身未建模）⇒ 锁对它们的作用无处可落。"
  },
  "journal": [
    { "at": "2026-09-25", "field": "emulator.note", "what": "T-0157：把锁挡住的两段写成 raw 20838-20858 与 20896-20917，并显式排除 20831-20837（工作清单把双计时器段算进锁里了）。" }
  ]
}
```

**(c) `script-queue-dispatch`** —— `guard` 改为**两条**（现盘只有 `test/append-packs.test.ts`，
而 `0x1F5` 这条重试派发点的守卫是 `test/op-1f5-dequeue.test.ts`）。`guard` 字段是**单路径** ⇒
用**最贴近本条**的那条，另一条进 `note`：

```jsonc
{
  "id": "script-queue-dispatch",
  "emulator": {
    "guard": "test/op-1f5-dequeue.test.ts",
    "note": "…（保留现文，末句 '三处放行点的完整清单见 script-request-queue-drain-dispatch' 保留）…本条的代表守卫 = `test/op-1f5-dequeue.test.ts`（6 例：三层门正/反例、`sub_40FB60` 入口停靠闸、`dispatching` 赋值点棘轮）；扩展包入队链的守卫 = `test/append-packs.test.ts`。`0x1F5` 的三层门依据棘轮另见 `test/t0157-frame-loop.test.ts`。"
  },
  "journal": [
    { "at": "2026-09-25", "field": "emulator.guard", "what": "T-0157：guard 由 append-packs.test.ts 改指 op-1f5-dequeue.test.ts（`0x1F5` 是本条的重试派发点，前者只覆盖 0x143/exit 链）。" }
  ]
}
```

**(d) `bullet-dirty-from-freeze-or-pending`** —— 现 note 的"修前 emulator 把 46516 只喂
`0x400` 等待门"是**现在时**陈述但已被本波次取代（`T-0167`/`T-0154` 已把它接进
`sceneNeedsRender` 与 freeze 置脏）⇒ 改成现在时（沿革已在 note 自己的 T-0154 段里，不必重复）：

```jsonc
{
  "id": "bullet-dirty-from-freeze-or-pending",
  "emulator": {
    "note": "引擎：`sub_4B4040` raw 136718-136719 的收尾 `if (*(_QWORD *)(Scene+46512)) Scene[46508] = 1;` —— 8 字节一起判 ⇒ 46512（强制冻结）与 46516（池挂起）**任一非零**就把本遍标脏。emulator：`SceneState.pending`（src/renderer/scene/state.ts）是 `scNeedsRender` 的第一项；帧驱动每帧由 `host.poolPending()` 锁存 `Engine.scenePending`（src/frame/loop.ts，raw 46516 的等价物），freeze 那一半由 `scBeginRenderPass` 的 freeze 分支无条件置脏。⇒ 46516 有两条消费者（渲染判据 + `0x400` 等待门），**不再是"只喂等待门"**。★本条由 2026-09 P1 修复轮（tickets/T-0167）落地，冻结那一半由 T-0154 补（守卫 test/scene-t0154-scene-state.test.ts 第 ⑤ 组）。"
  },
  "journal": [
    { "at": "2026-09-25", "field": "emulator.note", "what": "T-0157：删掉已被取代的现在时句（『修前 emulator 把 46516 只喂 0x400 等待门』），改为逐条现状。" }
  ]
}
```

### 3.2 `analysis/opcode-gaps.json`

**(a) `0x7c`** —— 现有的 `missing[]`（若有）按体拆成**两条**、都指向**选择/列表框子系统**（不是本票）：

```jsonc
{ "opcode": "0x7c", "kind": "missing-consumer", "status": "partial",
  "missing": [
    { "what": "`Engine[387940]` 的列表收尾派发：置位时清 0，并在队列恰剩 1 项（`497380 < 497384 && 497384 - 497380 == 1`）时调 `sub_40FB60` 放行脚本队列。★全反编译只有 3 处引用（构造清零 raw 22605 + 本指令的读 raw 25816 与写 raw 25818）⇒ **无写者、门恒假**；emulator 不接线是**正确**的（不许编一个写者），本条要的是**写者所在的子系统**。",
      "ticket": "T-0157", "raw": "25816-25822" },
    { "what": "`Engine[51848]`（选择/列表框的当前项游标）的消费者缺席：本指令把它复位成 −1，而它有真读者（主循环 raw 20005/20013/20286：`>= 0` 且 `< _this[23008]` 时当跳转表索引算 ip 落点）。emulator 的选择/列表框模型未建 ⇒ 该格只被写。",
      "ticket": "T-0157", "raw": "25812-25815" }
  ],
  "note": "…（保留现文）…★T-0157 另核：本指令的**深度校验是无条件的**（raw 25798-25807；`430712` 的初值/整块复位值都是 −1 ⇒ 不存在 `want === -1 就跳过` 的哨兵口径）；四格复位里只有 `51848` 有真读者，另三格（81776/81768/51840）无读者 ⇒ 不建模。`_this[107678]`(=430712) 的三处写者：raw 20365-20374（右键取消路由，emulator 的 `#cancelRoute()` **已落**）、raw 13997-14008（`effect_flags & 0x20` 臂，**未落**）、raw 20870-20877（`0x4000000` 臂，**未落**）。" }
```

**(b) `0x1f5`** —— 现有条目的 note 补一句（三层门 + 极性 + 邻域订正），`disposition` 保持 `implemented`：

```jsonc
{ "opcode": "0x1f5", "kind": "missing-branch", "status": "implemented",
  "note": "体 raw 25214-25236 的三层门逐条落地：① `_this[429756]`（锁深度 = dword 107439 = `frameCount`）`<= 0`；② `_this[429752]`（停靠标志 = dword 107438 = `frameTickLock`）**原值非 0** 才进；③ `_this[497400]`（= dword 124350 = `dispatchInProgress`）`== 0` 才派发；清位（raw 25227）在判 ③ 之后、派发（raw 25229 = `sub_40FB60` = control.ts 的 `dispatchNextRequest`）之前。★复核订正：『队列恰剩 1 项』（`497380 < 497384 && 497384-497380 == 1`）**不属于本指令** —— 那条判据在 `0x7C`（raw 25819-25821）。★『清 429752 是无条件的』与『两个字段被折叠成一个键』两条指控都不成立（清位在 `if` 之内；`frameTickLock`/`frameCount` 是两个独立键、与体逐格对应）。守卫 test/op-1f5-dequeue.test.ts（6 例）+ test/t0157-frame-loop.test.ts（体侧三层门与极性棘轮）。",
  "raw": "25214-25236" }
```

### 3.3 `analysis/functions.json` / `fields.json`（新增候选）

```jsonc
// functions.json（若 0x24E 的 handler 尚未单列）
{ "addr": "0x4258C0", "name": "op_24e_store", "raw": "32959-32967",
  "purpose": "`0x24E`（argc 1）：`_this[92340] = readIntOperand(1)`。该格被主循环当**位组**读（bit0 raw 21114、bit1 raw 26023/13910/13923）⇒ 语义 =『动画/效果跳过与推进的开关位组』，不是不透明整数。",
  "notes": "语料 `i24e` 422 处：`10001`（bit0）413 / `0` 3 / `1` 3 / `10003`（bit0+bit1）3。" }

// fields.json（订正现有条目：`msgField92340` 的 meaning 现在写「语义未定位（写入端/读取端都只有这一条）」）
{ "name": "msg_field_92340", "offset": "0x16b3c", "meaning": "动画/效果位组（`0x24E` 写）：bit0 = 主循环 `0x400` 动画等待门的放行附加条件（raw 21114，与 `system:EffectSkipOnClick` 相与）；bit1 = 「本帧不算画面推进」的旁路条件（raw 26023 的 `0x243`、raw 13910/13923 的逐字泵出口）。",
  "evidence": "raw 32965（写）；raw 21114 / 26023 / 13910 / 13923（读）" }
```

## 4. 别人该接（跨文件/跨票，本票**没动**）

| # | 文件 | 具体改什么 | 判据 / 守卫 | raw 锚点 | 为什么本票不做 |
|---|---|---|---|---|---|
| 1 | `src/vm/engine.ts` | `0x7c` 的另两条写者：① `effect_flags & 0x20` 臂 —— 在 ADV 泵的输入处理里加一个分支：`rewindMainBase[cur] != -1` 时写 `redisplayMode = effectFlags \| 0x6000000; effectFlags = 0; redisplayReturn = (本帧指令条数); redisplayScriptId = frame.scriptId;` 并把 ip 回退到 `rewindMainBase[cur]`；② `0x4000000` 臂（raw 20870-20877）—— 同形，另含 `v28[95782] = v28[95781] + 4 * _this[4*v26+489648]`（本帧 ip 改写） | 新增合成用例：`rewindMainBase[cur] != -1` 时触发该臂，断言 `redisplayMode/redisplayReturn/redisplayScriptId` 三格被写且 ip 回退；**未实现前** `test/t0157-frame-loop.test.ts` 的 `P3 0x7c：…三处写者` 与「`effectFlags & 0x20` 零落点」两条会红，提示回去改登记 | 13997-14008 / 20870-20877 | 文件归 `T-0173`（父票硬边界：禁改 `src/vm/engine.ts`） |
| 2 | `src/frame/loop.ts` + `src/vm/engine.ts` | `cap:frame-render-gate-mainloop` 的剩余两条：① raw 21114 的 `Engine[92340] & 1` 门（`anim` 支的 `0x400` 放行块）；② raw 13923-13929 的第二落点（`Engine[388212]` 支多出的 `result = 0`「这一帧不算画面推进」）与那道 bit1 读 | 各加一条 `set:DrawMode=1` / `i24e 10001` 前置的守卫；`test/t0157-frame-loop.test.ts` 的 `P2 frame-render-gate：`Engine[92340]` bit0` 已把"依据在体里 + emulator 无落点"钉住（接上后请**改这条登记**而不是删） | 21109-21140 / 13910-13929 / 26023 | `src/vm/engine.ts` 归 `T-0173`；`src/frame/loop.ts` **本票可写**但缺 `host` 缝（见 #3） |
| 3 | `src/frame/host.ts`（+ 两宿主实现） | 若要真接 #2：`FrameHost` 需要一个"本帧是否允许跳过效果"的缝（或让驱动直接读配置 `system:EffectSkipOnClick` + `engineValues[msgField92340]`）—— 现在驱动只经 `e.serviceWaitGate(nowMs)` 一问，门内一整套（`sub_407EA0` 清池计时器 + `sub_4B4040` 重提交 + `sub_4B51E0`/`sub_4BBA90`）都没有落点 | 同 #2；另需 `host` 侧一条断言（清计时器与重提交各一次） | 21135-21139 | `src/frame/host.ts` 本票**可写**，但**没有** diff 就不动它（避免与 `T-0167`/`T-0173` 撞车） |
| 4 | 选择/列表框子系统（新票） | `387940` 的**写者**与 `51848` 的**读者**：前者决定 `0x7C` 的收尾派发要不要接线，后者是"当前项游标 → 跳转表落点"的整条链 | `test/t0157-frame-loop.test.ts` 的 `P3 0x7c：387940…` 会在"引擎里多出写者"时转红（提示回去改登记）；`51848` 的读者守卫需新票自建 | 22605 / 25816-25822 / 20005/20013/20286 | 属另一个子系统（`emulator/menu`），本票只登记 |
| 5 | 电影对象子系统（新票） | `0x20F` 的影片对象表（`Engine+4*i+378688`）与生命周期（播完即销毁 + `effect_flags & 0x2000` 的清置，raw 20896-20917），以及 `native.playMovie` 的真实现 | `test/t0157-frame-loop.test.ts` 的 `P2 frame-render-gate：帧提交段与电影段同轮先后` 钉住了现状（`0x20F` 只到宿主缝） | 20896-20917 / 31605-31670 | 归 `renderer/**`（父票硬边界）与 `gfx-misc` 的宿主缝 |

## 5. 我的改动文件清单

| 文件 | 性质 | 规模 |
|---|---|---|
| `app/amayui-emulator/test/t0157-frame-loop.test.ts` | **新建**（本票唯一进仓库的产物；15 例，`@tier T0 @kind core @subsystem frame`） | 559 行 / 新增文件 |
| `app/amayui-emulator/.tmp/t0157/mutate-red.mjs` | 临时工具（判别力证明；不进仓库、不进 `tests[]`） | 约 200 行 / 新增文件 |
| `tickets/T-0157/changes-frame.md` | 本文件 | 新增 |
| `tickets/T-0157/ticket.json` | 票据收尾（`tests[]` / `doneWhy` / `--note`） | 由 ledger CLI 写入 |

**没有**改任何 `src/**`（本批 12 条读体后没有一条需要新写行为代码 —— 见 §0/§1）。

### 5.1 关于 `verify` 与 3 条基线红

```text
npm run verify  → typecheck ×3 + typecheck:test + test:all + check:dead-writes
判绿口径（CONTEXT §6）：test:all / verify **有 3 条已知基线红**（票 T-0146），**不新增红**就是绿：
  · engine-slot（SAVE70/71 storedDwords）
  · save-slot（真槽 format）
  · scene-report（可绘制项 24 ≤ 缺纹理项 26）
本票实测：tests 1559 / pass 1554 / fail 3 / skipped 2 ⇒ 红集合**恰好**是那 3 条，**本票新增红 0**。
★与 CONTEXT §6 记的 1544 例差 15 例 = **本票新增的 15 例**（全绿）；总数从 1544 → 1559 自洽。
```

## 6. 读体时发现的**新**事实（尤其与报告/台账不符的）

1. ★**`i24e` 的语料分布与报告的用法相反着**：报告/台账用 `i24e 10001`（422 处的 **413**）论证
   "bit1 = 0 ⇒ 真机走到 raw 13923 支"；但同一个值里 **bit0 = 1** ⇒ raw 21114 的 `0x400` 动画门
   **在近全部语料上被挡住**（引擎只 `break`，不做清计时器/重提交/清 `0x400`）。
   两个位**互为反相**，不能只引其中一半。⇒ 见 §3.1(a)。
   （分布实测：`10001` 413 / `0` 3 / `1` 3 / `10003` 3 = **422**。）
2. ★**`0x7c` 的"主循环两条臂"里已经落了一条**：raw 20365-20374 的**右键取消路由**就是
   `src/vm/engine.ts` 的 `#cancelRoute()`（写 `redisplayMode` + `redisplayScriptId`、ip 回退；
   `redisplayReturn` 有意不写）。报告 §4.1 #304 与 `verify-verdicts` 的 `missed` 都把它算作"未实现"
   ⇒ 准确的说法是"三处写者里已落一处、另两臂未落"。
3. ★**`0x1f5` 的体里没有队列长度判据**（复核已订正）；但复核记录里给的
   `suggestedGuard`（`e.dispatching = true ⇒ 断言派发一条`）**与体极性相反**（体是 `== 0` 才派发）
   ⇒ 本票按体钉"非 0 不派发"，并把该极性做成棘轮。
4. ★**`sleep` 语料 = 385 处，其中 n<10 = 50 处**（`1` 38 + `0` 12），报告写的 **51 处多 1**；
   四个桶（`1f4` 334 / `1` 38 / `0` 12 / `10` 1）与报告逐字一致 ⇒ 是"合计"那一格写错，不是桶错。
5. ★**锁 `429752` 挡的是 raw 20838-20858 与 20896**，**不是** raw 20831-20837
   （工作清单 §T-0167 那一行写"还挡住 raw 20831-20837 的 10ms/10000ms 双计时器刷新"——
   那段在锁门**之前**）。已按体订正并做成棘轮（`mutate-red` 第 7 步证明它有判别力）。
6. ★**`Engine[92340]` 不是"语义未定位"**：`fields.json` 的 `msg_field_92340`（`engineFieldIds.ts:229`）
   现在仍写「写入端/读取端都只有这一条」，实测有 **1 写 + 4 读**（写 = `0x24E` raw 32965；
   读 = raw 21114 的 bit0、raw 26023/13910/13923 的 bit1）⇒ 该 meaning 已过期（§3.3 给了订正片段）。
7. ★**反编译器给每个函数都输出一行原型声明**（例：raw 410 的 `sub_41A0E0` 原型 vs raw 25215 的定义）
   ⇒ 任何"切某个函数的体"的脚本都必须按 `//----- (地址)` 头切，`indexOf('void __thiscall sub_X')`
   会切到"从原型到文件尾"（本票第一版守卫就是这么错的，由 `mutate-red` 第 1 步暴露）。
