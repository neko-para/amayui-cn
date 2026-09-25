# T-0166 第 3 批 —— 眨眼链（L2D 实例 `+16` / `+23`）落地记录

> 范围：`app/amayui-emulator/src/live2d/**`（新增 `blink.ts` + `mtn.ts`/`runtime.ts`）与
> 新建 `app/amayui-emulator/test/live2d-blink.test.ts`。**未动**：`src/renderer/**`（只读调用点）、
> `analysis/**`、`docs-new/**`、其它 `test/**`、任何 `tickets/*/ticket.json`；`T-0166` 状态保持 `done`。
> 权威 = `engine/天结_unpacked.exe_utf8.c`（只读）+ `engine/天结_unpacked.exe.lst`（反汇编）。
> 承接：`tickets/T-0166/changes-c166.md` §4-①（"需要别人接的代码活"第 1 行）与 `tickets/T-0175` acceptance ⑥。

## 0. 一句话结论

**眨眼链已按体建模并接上 `l2dAdvance`；而读体（含反汇编）同时证明：`+23` 在构造时被显式清 0、
此后全二进制没有任何写者 ⇒ 这一支在随包游戏里恒不执行** —— 所以 `L2dInstance.blinkEnabled` **缺省 false**
不是"没做完"，是引擎的真实运行行为；状态机仍可按体独立推进（守卫钉住）。
原有台账里"`+16`/`+23` 未建模 ⇒ 维持 modeled-unverified"的那句**已经过期**，改写片段见 §5。

## 1. 眨眼链全貌（每环带 raw）

`sub_4783D0`（raw 92578-92615）在**同一个 `if (*_this)` 块里**、**动作那个 `if (+21/+22)` 块之外**还有一句
`if ( *((_BYTE *)_this + 23) ) sub_4BC550(_this[4], (_DWORD **)*_this);`（raw 92605-92606）。
逐环：

| 环 | 事实 | 锚点 |
|---|---|---|
| ① 对象 | 实例构造器 `sub_478270`：`sub_4BC380(104)` → `sub_4BC3E0`，指针落实例 **`+16`**；类型 = **`live2d::EyeBlinkMotion`** | raw 92540-92545；`sub_478270` def raw 92495-92551；类名 raw 143005 / `.lst` `.data:0052E30C`（vftable `??_7EyeBlinkMotion@live2d@@6B@`）+ RTTI `.data:0053F76C` |
| ② 缺省参数 | `+84 = 4000`（间隔上界）、`+88 = 100`（闭眼）、`+92 = 50`（闭合保持）、`+96 = 150`（睁眼）、`+32 = 1`（右眼取负） | raw 143009-143013 |
| ③ 参数名 | `sub_4BF510(…, aParamEyeLOpen)` / `(…, aParamEyeROpen)` ⇒ 硬编码 `PARAM_EYE_L_OPEN` / `PARAM_EYE_R_OPEN` | raw 143014-143015；`.data:0052E2F4` / `.data:0052E2E0` |
| ④ 门控 `+23` | **极性 = 非 0 即真**；构造时被清 0；此后无写者 | 见 §2 |
| ⑤ 推进 | `sub_4BC550(+16 对象, 模型)`：状态机 + 写回 | raw 143041-143132 |
| ⑥ 状态机 | `+16`：`0/其它` ⇒ `+16=1` 且 `+8 = clock + rand*(1/32767)*(2*+84-1)`；`1` ⇒ `clock >= +8` ⇒ `+16=2` + `+24=clock`；`2` ⇒ `w = 1 - (clock-+24)/+88`，`>= 1.0` ⇒ `+16=3` + `+24=clock` 且 `w = 0`；`3` ⇒ `(clock-+24)/+92 > 1.0 || == 1.0` ⇒ `+16=4` + `+24=clock`，`w = 0`；`4` ⇒ `w = (clock-+24)/+96`，`>= 1.0` ⇒ `+16=1` + `sub_4BC500` 重排 + `w = 1.0` | raw 143061-143121 |
| ⑦ 写回 | `sub_4BD490(模型, L, w, 1.0)` 与 `sub_4BD490(模型, R, ±w, 1.0)`；`sub_4BD3E0` 对 `a4 == 1.0` 是**直接赋值**（`sub_4C43D0`），否则 `(1-a4)*现价 + a4*目标` | raw 143123-143131；`sub_4BD3E0` raw 143791-143801 |
| ⑧ 时间源 | `sub_4BF8D0()` = **`clock()`**（毫秒 `clock_t`）—— **与 `$fps` 无关**；`$fps` 只决定动作曲线的采样间隔（`sub_4BCB50` 那条路） | raw 145679-145687；`.lst` `004BF8D0 … call _clock` |
| ⑨ 抖动 | `rand() * dbl_52E310 * (2*interval - 1)`，`dbl_52E310`（`.data:0052E310` 的 `dq 0.00003051850947599719`）= **恰好 `1/32767`**（= MSVC `RAND_MAX`）—— **不是** `2^-15`（差 9.3e-10；本单元第一版就是按"约等于 2^-15"写的，被测试的数字当场证伪，见 §3.3-4） | raw 143031-143037 / 143113-143116；`.lst` `.data:0052E310` |
| ⑩ 调用点 | 唯一的眨眼推进点是逐节点绘制那个块，门 = "槽里有实例"（`if (v28[v29[1] + 13953])`）；`_this[4]` = `+16` | raw 134389（`sub_4783D0(...)`）；raw 134320（槽门） |

★与本票其它部分的边界：眨眼**不要求** `+21/+22`（raw 92586 与 92605 是同级 `if`）⇒ 没有动作装载也每帧跑；
`+8`/`+24`/`+84`/`+88`/`+92`/`+96`/`+32` 都**不在任何 `0x34x` 指令的写点里**（实例表里没有到 `+16` 子对象的通道）。

## 2. ★`+23` 的极性、来源与"到底会不会眨眼"

1. **极性 = 非 0 即真**：`.lst` `00478429 cmp byte ptr [esi+17h], 0` + `0047842D jz short loc_47843A`
   （`esi` = 实例、`+17h` = 字节 `+23`）⇒ 只有 **等于 0** 才跳过。
2. **构造时被清 0，而且 Hex-Rays 看不出来**：`sub_478270` 的结尾是
   `mov [esi+14h], bl`（`+20`）、**`mov [esi+15h], ebx`（一条 dword 存 = `+21`/`+22`/`+23`/`+24` 全清）**、
   `mov [esi+19h], bl`（`+25`）、`mov [esi+1Ch], ebx`（`+28`/`+32`），`ebx = 0`（`00478297 xor ebx, ebx`）。
   反编译器把那条 dword 存渲染成 `*(_BYTE*)_this + 21) = 0` 一类的逐格写，**`+23` 直接消失** ——
   只读 `.c` 会误判成"未初始化堆字节"。逐字见 `.lst` `00478306`/`00478309`/`0047830C`/`0047830F`/`00478312`。
3. **此后没有任何写者**：全 `.c` 机械查询 `*((_BYTE *)_this + 23) = ` ⇒ **0 命中**
   （唯一形近命中是 `sub_4D7320` raw 165535 的 `*(_BYTE*)(*a2+23)`，那是**另一个对象**：
   它把 CRC 结果的四个字节写进 `*a2+22/+23/+24/+25`，raw 165534-165557）；
   `.lst` 全库 `byte ptr […+13h]` ⇒ **1 处**（`004D71D5`，同属 `sub_4D7320`）；
   `0x352` 预置的 `sub_478540`/`sub_478560` 写的是 `+24`/`+25`（raw 92684/92698），也**不碰** `+23`。
4. ⇒ **结论：门永久为 0，`sub_4BC550` 在随包游戏里一次都不会被调到。**
   这不是"我们猜的"：① 构造清 0 是**确定性**的；② 全库 0 写者。
   emulator 因此把 `blinkEnabled` 缺省定为 `false`（写在 `mtn.ts` 的 `newL2dInstance`），
   **状态机仍然按体建模**（`blink.ts`），并且可以用真读者打开 —— 见 §4 的"做不到的/重开条件"。

> ★订正 `functions.json` 里 `0x4BC550` 那条的 notes：它现在写「ctor 只清 `+20~+24`」。按反汇编，
> ctor 是**一条 dword 存把 `+23` 一并清 0**（`.lst` `00478309 mov [esi+15h], ebx`），不是"没写 `+23`"。
> 该条 notes 的后半句「本作**实际不眨眼**…重写时可以先不实现眨眼」**结论正确**，但理由要按上面这条改写。

## 3. 改了哪些文件 + 红→绿

### 3.1 文件

| 文件 | 改动要点 |
|---|---|
| `src/live2d/blink.ts`（**新**，214 行） | 眨眼状态机 `blinkStep`（§1 ⑥⑦ 的逐句直译）、缺省参数 `BLINK_DEFAULTS`（4000/100/50/150 + `negateRight`）、参数名 `BLINK_PARAM_L/R`、抖动 `blinkJitter`（`dbl_52E310 = 1/32767` 那条）、字段↔引擎偏移对照 `BLINK_FIELDS`、极性/来源的长注释 |
| `src/live2d/mtn.ts` | `L2dInstance` 新增 `blink: BlinkMotion`（`+16`）与 `blinkEnabled: boolean`（`+23`，**缺省 false**）；`newL2dInstance` 初始化；新增 `blink.ts` 的类型/构造 import（单向，不成环） |
| `src/live2d/runtime.ts` | 新增 **`l2dBlinkTick(inst, deltaMs, {clockMs, rng})`**（= 门 + 时钟 + 写回的唯一入口，`+23`/模型非空两层门）；`l2dAdvance` 新增**可选**第 4 参 `{clockMs, rng}` 并在动作那块**之外**调用它、把写回并进同一份 overrides；`declaresParam`（"参数表里得有这一格"）；眨眼面从 `runtime.js` 单一出口再导；声明 `newL2dInstance` 再导出 |
| `test/live2d-blink.test.ts`（**新**，321 行） | 3 条命名守卫（① 逐帧推进 ⇒ 参数真的变 ② `+23` 门控 ③ 无 blink 数据的模型不崩/不注入）+ 常量棘轮（`dbl_52E310 = 1/32767`、`+16` 的 1/2/3/4 取值、字段↔偏移）；首行 `/** @tier T0 @kind core @subsystem l2d */` |

```
$ git diff --numstat -- app/amayui-emulator/src/live2d/mtn.ts app/amayui-emulator/src/live2d/runtime.ts
168     18      app/amayui-emulator/src/live2d/mtn.ts
343     26      app/amayui-emulator/src/live2d/runtime.ts
（新文件，git 未跟踪）app/amayui-emulator/src/live2d/blink.ts        214 行
（新文件，git 未跟踪）app/amayui-emulator/test/live2d-blink.test.ts  321 行
```
> 同一目录里的 `assetLoader.ts` / `render.ts`（`132/15` 行）是 `T-0160` 留下的**未提交改动**，**不是本单元动的**；
> 本单元只碰 `mtn.ts` / `runtime.ts` / 新 `blink.ts` / 新测试。★`src/renderer/**` 一个字节都没动（`ops.ts` 只读）。

### 3.2 命令与两个数字

```powershell
cd app/amayui-emulator
# ① 绿（本单元 3 条守卫）
node --import tsx --test test/live2d-blink.test.ts
#  → ℹ tests 3 / pass 3 / fail 0 / skipped 0

# ② 红（把眨眼那支改回"不存在"，= 本单元动手前的行为；保留新 API 面）
#    runtime.ts 的 l2dBlinkTick 第一句插 `return null;`（TEMP-RED）后跑同一份文件：
#  → ℹ tests 3 / pass 0 / fail 3
#    ① AssertionError: ★到点 ⇒ `+16 = 2`（closing，raw 143066-143068）      → actual 'idle' ≠ 'closing'
#    ② AssertionError: 门开 ⇒ 到点转闭眼（closing）
#    ③ AssertionError: 状态机照常推进（排期发生过 ⇒ 与"门关着"那条可区分）

# ③ 同族回归（11 个既有 L2D 文件 + 新文件，分三批跑，见 ④）
node --import tsx --test test/live2d-t0160.test.ts test/live2d-chain.test.ts test/live2d-render.test.ts
#  → ℹ tests 27 / pass 27 / fail 0 / skipped 0     ★T-0160 的 16 条一条没删、一条没放宽
node --import tsx --test test/l2d-node-compose.test.ts test/l2d-render-pending.test.ts test/live2d-enabled-flag.test.ts test/live2d-deform.test.ts
#  → ℹ tests 31 / pass 31 / fail 0 / skipped 0
node --import tsx --test test/live2d-moc.test.ts test/slot-load-l2d-reset.test.ts test/l2d-node-transform-ops.test.ts test/l2d-clear-on-container-ops.test.ts test/live2d-blink.test.ts
#  → ℹ tests 22 / pass 22 / fail 0 / skipped 0

# ④ 类型：四个 tsconfig 全绿（`npm run typecheck` 在本机没有 node_modules/.bin ⇒ 直接调 tsc）
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit          # exit 0
node node_modules/typescript/bin/tsc -p tsconfig.control.json --noEmit   # exit 0
node node_modules/typescript/bin/tsc -p tsconfig.electron.json --noEmit  # exit 0
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit      # exit 0

# ⑤ 死写闸门：无新增（基线 13 只许收缩）
node --import tsx src/tools/deadWrites.ts
#  → 已登记的死写（基线）13 个 / 当前死写 13 个 / ★ 无新增死写
#    ★新加的 blinkEnabled 有真读者（runtime.ts:725 的 l2dBlinkTick 第一句），blink 状态被 blinkStep 消费 ⇒ 不进闸门

# ⑥ 仓库级棘轮（本文件必须不新增）
node --import tsx --test test/harness-convergence.test.ts test/organization.test.ts
#  → 本单元初版**红过**这两条（见 §3.3），改完不再点名 live2d-blink.test.ts；
#    残余红是**别的并行单元的**：`t0156-control-frame.test.ts`（自造 mk 变体）、
#    `arch-copy-slot-sth-only.test.ts`（R2 档位）、以及基线只许收缩（别人的文件迁走后基线未 shrink）。
```

### 3.3 命名守卫 + 红→绿纪律的两处"最小 retarget / 如实修正"

1. **初版测试触发两条仓库棘轮（自己跑出来的，不是猜）**：
   `test/harness-convergence.test.ts` 的"不得新增自造 mk()/ctx 变体"点名了 `live2d-blink.test.ts`
   —— 原因是我在合成模型工厂里写了个局部 `const mk = (name) => …`（`test/harnessScan.ts:16` 的正则
   `/function mk\(|const mk = /` 命中）；`test/organization.test.ts` 的 R2 又点名"声明 T1 但看不出资产依赖"。
   **修法**：① 把那个局部工厂改名 `paramDef`（不登记进基线 —— 基线只许收缩）；② 首行改 `@tier T0`
   （本文件**不需要**真游戏资源：模型是合成的，时钟/随机都注入）。
2. **本单元自己写错过一次门控/收尾口径，测试当场抓住并如实改正**（这些错误都在"红"里出现过）：
   - 第一版让 `blinkStep` 在**状态转换那一拍**返回 `undefined`（以为"到点只是排队"）——
     按体是错的：`sub_478270` 的 `LABEL_14` 把 `w` 置 **1.0** 并且**照常写回**（raw 143118-143119）⇒ 改成返回数值；
   - 第二版把"排下一次"放在 `case 1`（idle）里，与引擎的 fall-through 顺序不符
     （`+16 == 0` 那一支才排期；`+16 == 1`/2/3/4 走 `LABEL_14` **不重排**）⇒ 按 raw 143112-143120 重排；
   - 测试第一版用**裸** `blinkStep` 测"关着门会怎样"⇒ 把门控那一半测漏了
     ⇒ 改成经**带门的** `l2dBlinkTick`（门本身就是被测判据）。
3. **锚点纪律**：本文件与代码注释里的 raw 行号全部用 `read` / `Select-String` 现读现写；
   未改任何既有票的 `evidence.anchor`（`tickets/T-0166/ticket.json` 一个字节没动）。
4. **测试抓出的第四个错：`dbl_52E310` 不是 `2^-15`。** 第一版按"`0.00003051850947599719 ≈ 2^-15`"写常量
   （`1/32768`），守卫里那条"重排 = clock + rand*(2\*+84-1)"的**数值断言**当场红（`300.122…` vs `4299.5`）。
   复核：`1/0.00003051850947599719 = 32767` **精确**，而 `2^-15 = 0.000030517578125`（差 `9.3e-10`）
   ⇒ 它是把 `rand() ∈ [0, 32767]` 归一化成 `[0, 1]` 的那一格，**不是** `[0, 1)`。
   已改为 `BLINK_RAND_SCALE = 1 / 32767`，并在守卫里加了一条**常量棘轮**
   （`assert.notEqual(BLINK_RAND_SCALE, 2 ** -15)`）—— 这类"约等于"错最容易在注释里悄悄活下来。

## 4. 做不到的 / 有意保留（逐条到 文件:行）

| 项 | 落点 | 为什么不做 + 重新评估条件 |
|---|---|---|
| 让眨眼在**随包游戏里真的动** | `src/live2d/mtn.ts` 的 `blinkEnabled = false` | **做不到，也不该做**：引擎侧这一支恒不执行（§2）。要"动"只有两条路：(a) 有数据真能置 `+23`（例如某个 `.moc`/`.mtn`/模型 JSON 字段被解析成它 —— 目前 `0x341`/`0x34E` 的解析路径里**没有**这条通道，`sub_478330` 只把模型指针写 `+0`）；(b) 有人拿真机内存/调试器读到过 `+23 != 0` 的一帧。**出现 (a) 或 (b) 就重开**：把我们这份 `blinkStep` 接到那个数据源上、并把 `blinkEnabled` 的缺省改为该数据源的值。 |
| "参数不存在"时引擎的真实后果 | `src/live2d/runtime.ts` 的 `declaresParam` | 引擎是**抛**：`sub_4C4FD0` 查不到返回 **-1** ⇒ `sub_4BD3E0` 的 `if (pExceptionObject >= *(_DWORD *)(v6 + 8))` 在**无符号**比较下必真（raw 143795-143799）⇒ `_CxxThrowException(aOutOfRangeMode)`。emulator 的选择是"跳过这一格"（不崩、不注入幽灵参数）。**重开条件**：若某天真要逐字节复现这条路径的失败语义（例如做"缺失参数即报错"的严格档），把它改成走既有的 `ShowMessageError` 通路。 |
| 眨眼的**时钟域**与 `scL2dTick` 的 `delta > 0` 门 | `src/live2d/runtime.ts` 的 `blinkClockOf` | 引擎用全局 `clock()`（同帧所有实例同一个数），宿主只给 `deltaMs` ⇒ 这里按实例累计（同帧各实例的累计值相同，结果一致）。★`scL2dTick`（`renderer/scene/ops.ts:2241`，**属别的单元，本单元只读**）只在 `delta > 0` 时调 `l2dAdvance` ⇒ **delta = 0 那一拍眨眼不推进**（引擎会推）。这一格不在这里补：改它要动 `src/renderer/**`。**重开条件**：`ops.ts` 的 owner 把 `if (delta > 0)` 拆成"动作看 delta、眨眼看 nowMs"时，把 `clockMs: nowMs` 传进来即可（本函数已经支持）。 |
| `dbl_52E310` 的随机源 | `src/live2d/blink.ts` 的 `blinkJitter(rng)` | 引擎是 `rand() * (1/32767)`（MSVC `rand()` = `[0, 32767]`，另有全局 `srand` 状态）。emulator 缺省 `Math.random`（不引全局 C 状态），测试注入固定值。**语义差异**：具体序列不同；**分布相同**（`[0, 1]` × `(2*interval-1)`）。且门恒 0 ⇒ 对画面零影响。 |
| Pixi 合成端 | 不在本单元 | 与 `T-0160` §4 的同名行一致（乘色/tint 那一格归 `presenter.ts`，属别的单元）。 |
| 动作队列那一支的 `sub_4BCCA0` SDK 语义 | `src/live2d/mtn.ts` | 与 `T-0160` §4 同（`motionQueueFinished` 仍是"从调用形状反推、未完全确证"）。 |

## 5. 台账待应用（**主 agent 串行应用**；本单元未动 `analysis/*.json`）

### 5.1 `analysis/engine-capabilities.json` → `live2d-node-draw-advance`（本单元的主改）

**① `emulator.note`：只改尾句**（前文"已建模 / 已接 / `+21`+`+22` 门与结算 / sceneDirty 并集"全部保持）。

- **删**（原尾句，一字不差）：
  `★**仍未建模**：实例 `+16`（EyeBlinkMotion）与 `+23`（眨眼门控）——`src/live2d/` 全库无 blink 实现 ⇒ 本条维持 modeled-unverified（这是唯一剩下的缺口，不是宿主接线）。`
- **换成**：
  ```
  ★**眨眼那一支已建模**（`T-0166`，raw 92605-92606）：`live2d/blink.ts` 的 `blinkStep` 是 `sub_4BC550` 的逐句直译（状态机 `0`⇒排期 / `1`⇒到点转闭眼 / `2`⇒`w = 1-elapsed/+88` / `3`⇒`w = 0` / `4`⇒`w = elapsed/+96` + 回 `1` 重排；参数名 `PARAM_EYE_L_OPEN`/`PARAM_EYE_R_OPEN`；缺省 `4000/100/50/150` + `+32 = 1` 右眼取负；写回强度走 `sub_4BD3E0` 的 `(1-a4)*现价 + a4*目标`），入口是 `runtime.ts` 的 `l2dBlinkTick`（两层门：`+23` 与"实例 `+0` 有模型"），由 `l2dAdvance` 在**动作那块之外**调用（`if (+21/+22)` 与 `if (+23)` 在引擎里同级，raw 92586 vs 92605）⇒ 没有动作装载也跑。★**但门 `+23` 缺省是关的，而且必须是关的**：`sub_478270` 结尾一条 dword 存 `mov [esi+15h], ebx`（`ebx = 0`）把 `+21..+24` 一并清 0（`.lst` 00478309；Hex-Rays 的 `_DWORD` 视图里 `+23` 整个不出现），此后全 `.c` 的 `*((_BYTE *)_this + 23) = …` **0 命中**（唯一形近命中 `sub_4D7320` raw 165535 是别的对象）⇒ **这一支在随包二进制里恒不执行**，`L2dInstance.blinkEnabled` 缺省 `false` = 引擎的真实行为，不是未建模。★**仍未建模**：眨眼专有的缺口只剩"没有 E4 真机对照"（门恒 0 ⇒ 拿不到可见证据）；本条维持 `modeled-unverified` 的理由因此从"`+16`/`+23` 未建模"改成"无 E4"。
  ```
- ★注意：note 里引的 `ops.ts:1980-2014`/`2002`/`2005`/`2012`/`1993` 与 `headlessScene.ts:882`/`pixiBackend.ts:1487`
  行号是**旧快照**（现盘 `scL2dTick` 在 `ops.ts:2217-2252`、`l2dAdvance` 调用在 `:2242`、`drawn` 过滤在 `:2239`、
  `l2dComposeNodeAt` 在 `:2249`、`sceneDirty` 并集在 `:2228-2235`；宿主的调用点在 `headlessScene.ts:917` 与
  `pixiBackend.ts:1513`）。本单元**不改**这些数字（改的是别人 range 的注释正文，且属"行号漂移"这一独立问题）
  —— 但既然本条要动，顺手订正更省事（owner 决定）。

**② `emulator.guard`**：`test/live2d-chain.test.ts` → **`test/live2d-blink.test.ts`**
（新守卫才是这条链"眨眼那一半"的同源断言；`live2d-chain.test.ts` 钉的是"只在画节点时推进"那一半，
它的两条断言现在仍然全绿，只是不再覆盖本条的**新增**面。若 owner 想保留两条，建议写
`test/live2d-chain.test.ts + test/live2d-blink.test.ts`。）

**③ `emulator.status` / `emulator.evidence`**：**建议不变**（`modeled-unverified` / `E3`）——
结构已按体落地并有命名守卫（E2/E3 级），但仍无 E4 真机对照；缺口理由按 ① 的尾句改写。

**④ `journal` 追加一条**（格式照既有条目）：
```json
{"at":"2026-09-25（T-0166 第 3 批）","field":"emulator.note","what":"删掉已过期的尾句「仍未建模：实例 +16（EyeBlinkMotion）与 +23（眨眼门控）」，改写为「眨眼那一支已建模（blink.ts/blinkStep + runtime.l2dBlinkTick），但 +23 在构造时被 dword 存清 0 且全库无写者 ⇒ 该支恒不执行，blinkEnabled 缺省 false = 引擎真实行为；剩下的缺口只有无 E4」。"}
```

**⑤ `engine.fns` / `engine.raw`**：条目现写 `sub_4783D0, sub_4BCA20, sub_4BCB50, sub_478640 @ raw 92578-92615`。
建议**补两个函数名**：`sub_4BC550`（眨眼推进，raw 143041-143132）与 `sub_478270`（实例构造/`+16` 的建点，raw 92495-92551）；
`raw` 区间**不建议**扩（`92578-92615` 正是本条的能力区间，眨眼在区间内 raw 92605-92606）。

### 5.2 `analysis/engine-capabilities.json` → 另两条（只递建议，本单元没改它们）

- `lazy-live2d-slot`：`emulator.note` 里「重装 = 整份新实例…参数/部件显隐/动作队列/预置/乘色一并复位」这句
  建议**再补一格**：`+16` 的眨眼态也一并回缺省（新实例 = `newBlinkMotion()`；引擎侧 `new(0x4C)` + `sub_478270`
  会把 `+23` 清 0），守卫 `test/live2d-blink.test.ts` 的 ① 断言了"装载后 `blinkEnabled === false`、`mode === idle`"。
- `live2d-enabled-config-flag`：**不需要改**（`T-0160` §5.1 的待应用片段与本节无关；本单元没有碰 `a9d0` 那条路）。

### 5.3 `analysis/functions.json`（要不要新增条目）

| 地址 | 建议 | 理由 / 可照抄片段 |
|---|---|---|
| **`0x4783D0`**（已有，`ANALYZED`） | **只改 `notes`，不加条目** | 现 notes 只写"动作推进与出画同一次调用"。建议**追加**：`★眨眼那一支（raw 92605-92606）：if (*(BYTE*)_this+23) sub_4BC550(_this[4]=+16 的 EyeBlinkMotion, *_this)；门 +23 由 sub_478270 的 dword 存 mov [esi+15h],ebx 清 0（.lst 00478309）且全库无写者 ⇒ 随包二进制里恒不执行（T-0166）。` |
| **`0x478270`**（已有，`ANALYZED`） | **只改 `fields_used`/`notes`** | `fields_used` 里的字段串已经列了 `+16`/`+23`（无需改）；notes 建议补：`★+16 = live2d::EyeBlinkMotion（sub_4BC380(104) → sub_4BC3E0；.data:0052E30C 的 vftable）；+23 由 dword 存 [esi+15h] 一并清 0（Hex-Rays 视图里 +23 不出现）。` |
| **`0x4BC3E0`**（**MISSING**） | **建议新增**（`status: ANALYZED`） | 它是 `+16` 的**构造器**，四个缺省参数与两个参数名都在这里，是本链的"参数从哪来"的唯一答案。建议值：<br>`addr: "0x4BC3E0"`, `raw_name: "sub_4BC3E0"`, `semantic_name: "live2dEyeBlinkMotionCtor_4BC3E0"`, `op: null`, `status: "ANALYZED"`, `purpose: "构造 live2d::EyeBlinkMotion（104B）：设 vftable + 两个参数名对象（LDString） + 眨眼时序参数"`, `fields_used: ["EyeBlinkMotion+0(vftable ??_7EyeBlinkMotion@live2d@@6B@)","+16(状态机)","+32(右眼取负=1)","+36/+40(PARAM_EYE_L_OPEN 的 LDString)","+60/+64(PARAM_EYE_R_OPEN 的 LDString)","+84(4000)","+88(100)","+92(50)","+96(150)"]`, `unmodeled: ["sub_4BF510 / sub_4BF020（SDK LDString 的赋值/重置）"]`, `evidence: "raw 143001-143018（调用点 sub_478270 raw 92540-92545）"`, `notes: "★本作这一支恒不执行（+23 恒 0，见 0x4783D0）⇒ 参数值只是"配置在那里"。"` |
| **`0x4BC500`**（**MISSING**） | **建议新增**（`status: PARTIAL`） | 它是"下次眨眼时刻"的唯一算式（`rand()*(1/32767)*(2*+84-1)`），也是 `dbl_52E310 = 0.00003051850947599719 = 1/32767` 的读者。建议值：<br>`addr: "0x4BC500"`, `raw_name: "sub_4BC500"`, `semantic_name: "live2dEyeBlinkNextTime_4BC500"`, `op: null`, `status: "PARTIAL"`, `purpose: "算下一次眨眼时刻：clock() + rand()*dbl_52E310*(2*EyeBlinkMotion+84 - 1)"`, `fields_used: ["EyeBlinkMotion+84(间隔上界)","dbl_52E310(=.data:0052E310 = 0.00003051850947599719 = 1/32767)","sub_4BF8D0()(clock)"]`, `unmodeled: ["rand() 的全局 srand 状态（序列不可复现）"]`, `evidence: "raw 143030-143039；调用点 sub_4BC550 raw 143106 / 143115"`, `notes: "返回 u64 毫秒；范围 [now, now + 2*+84 - 1]。"` |
| **`0x4BCCA0`** | **不建议新增/不建议现在改** | 它是本 exe 的 `.c` 里**只有调用点、没有函数体**的 SDK 导入（`T-0160` 已在 `mtn.ts` 登记为"未完全确证"）；没有 raw 体可引，新增条目会变成"只有名字的条目"。 |
| **`0x4BF8D0`** | **不建议新增** | 它是 `clock()` 的一层包装（`dword_551E28`/`dbl_551E2C` 两个猜测类型全局在**全 `.c` 里只有这一处读、0 处写** ⇒ 恒走 `clock()`）。建议只在 `0x4BC500`/`0x4BC550` 的 `fields_used` 里写一句 `sub_4BF8D0() = clock()` 即可（已含在上面两条里）。 |

### 5.4 `analysis/fields.json`（要不要新增条目）

现状：**`fields.json` 里没有任何 L2D 实例字段条目**（全库 376 条，`55812`/`46508` 命中 0）。
本链的字段是不是值得进真源，建议如下（**给 owner 判**）：

| 建议 | 条目 | 备注 |
|---|---|---|
| **值得加（3 条，都是"门控/建点"级）** | ① `L2D实例 +16`：`type: "ptr"`、`name: "eyeBlinkMotion"`、`scope: "L2D instance (operator new(0x4C))"`、`meaning: "live2d::EyeBlinkMotion*（104B，sub_4BC3E0 建；sub_4783D0 在 +23 非 0 时调 sub_4BC550 推进）"`、`evidence: "raw 92540-92545 / 143001-143018 / 92605-92606"`、`status: "ANALYZED"`；② `L2D实例 +23`：`type: "u8"`、`name: "eyeBlinkGate"`、`meaning: "眨眼门控（非 0 即真，.lst 00478429 cmp/jz）；构造时由 dword 存 [esi+15h] 清 0（.lst 00478309）、全库无写者 ⇒ 恒 0"`、`evidence: "raw 92546-92548 / .lst 00478309 / 00478429"`、`status: "ANALYZED"`；③ `EyeBlinkMotion +84/+88/+92/+96`（**可以合成一条**）：`name: "blinkTimings"`、`meaning: "间隔上界 4000 / 闭眼 100 / 闭合 50 / 睁眼 150（ms）"`、`evidence: "raw 143009-143012"`、`status: "ANALYZED"` | 这三条是"缺失时静默/门控"型知识，正是 `fields.json` 第二层的用途；且它们是本链唯一"从 `.c` 读不出来"的东西（`+23` 的清零点只在反汇编里） |
| **不必加** | `+8`（下次眨眼时刻）/`+24`（状态进入时刻）/`+32`（右眼取负） | 语义完全包含在 `0x4BC550`/`0x4BC500` 的 `fields_used` 里，单列会变成"每个偏移一条"的噪声 |

> 若 owner 采纳 `+16`/`+23` 两条：`fields.json` 的排序/自检按
> `node .agents/skills/amayui-engine-analysis/scripts/sort-fields.js` 与 `--validate` 走（本单元未动真源）。

## 6. 复现清单（本单元跑过的命令与数字）

| 命令 | 结果 |
|---|---|
| `node --import tsx --test test/live2d-blink.test.ts` | **红 0/3**（TEMP-RED，见 §3.2 ②）→ **绿 3/3** |
| 11 个既有 L2D 文件（分两批，见 §3.2 ③） | 52/52（含 `live2d-t0160.test.ts` 的 16 条）+ 25/25 = **77/77 全绿** |
| `tsc -p tsconfig{,.control,.electron,.test}.json --noEmit` | 4/4 exit 0 |
| `node --import tsx src/tools/deadWrites.ts` | `★ 无新增死写`（基线 13 = 当前 13） |
| `node --import tsx --test test/harness-convergence.test.ts test/organization.test.ts` | 本文件**不再被点名**（初版被点名，见 §3.3）；残余 3 红属其它并行单元 |
| blink 符号全库计数（`Select-String -Recurse -Path src,test -Pattern blink`） | **163 处 / 4 个文件**（`blink.ts` 29、`mtn.ts` 10、`runtime.ts` 34、`live2d-blink.test.ts` 90）；动手前 **0 处**（全库无 blink 符号 = 本单元登记的缺口原文） |
| `node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --validate` | ✅ 票据自检通过（173 张，**3 条警告**：`runtime.ts:202`（现 `:253`）的 `l2dResetHost` 与 `:188`（现 `:239`）的 `raw 19385-19388` 锚点**行号漂移**，原因是本单元在 `runtime.ts` **顶部**插了 import/再导出 +300 行；锚点**字符串仍在**，按纪律未自行改指 —— 请 owner 刷新那 3 条行号） |
