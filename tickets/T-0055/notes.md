# T-0055 过程笔记 —— 0xD3/0xD4/0xD5「阶梯动画时间表」

## 1. 这三条到底是什么

一开始容易被当成三条互不相关的指令（0xD3 无操作数、0xD4 四个、0xD5 一个）。看语料形态就清楚了：

```
label_0000706c
i0d3                                    ; 清表
i0d4 10 1e label_000070c8 label_000070d4 ; 追加 30 条，每条 +16ms
i0d4 1 2 label_000070d4 label_000070d4  ; 收尾哨兵
i0d5 ffffffff                          ; 起表 + 置 0x40 门（本条不前进）
ret

label_000070c8
call label_0000b39c                     ; = i20c 帧刷新
label_000070d4
add (local-int 210) (local-int 210) 1   ; ★局部槽号是**十六进制**：0x210 = 528
ret
```

⇒ 它是一套 **"按时间表把同一段代码分多次执行"** 的小语言：`0xD4` 声明"什么时候跳到哪个 label"，
主循环负责在到点时把 `pc` 指过去；脚本体 `ret` 回到 `i0d5` 自身（调度器压的返回点就是它）。

语料 7 处：`SAVE.txt`（存档动画）、`HISTORY.txt`（回想列表缓动）、`ADDEXP.txt`（经验条）、
`BTL.txt`×4（战斗单位入场 / 结算）。可见它的用途统一是**逐帧阶梯动画**。

## 2. 反编译读到的四个部件

| 部件 | 位置 | 作用 |
|---|---|---|
| `0xD3` `sub_42AC40` | raw 36668 | 清表：写游标 -1、下标 0、打断 label -1、`begin==end` |
| `0xD4` `sub_42E940` | raw 38801 | 追加 `op2` 条 `{t = 上一条 + op1, 100, op3, op4}`（★时刻跨调用累计） |
| `0xD5` `sub_42ACC0` | raw 36689 | `95805=0`（**本条不前进**）→ `index==0` 时刷输入/记脚本身份/起计时器/排序 → `index < 写游标` ⇒ 置 `0x40`，否则 `95805=3` |
| **`sub_408F10`** | raw 13612-13684（主循环 raw 21154-21156 调用） | 消费者：到点 ⇒ 清门 + 压返回点 + `pc = 条目入口`；未到点 ⇒ 本遍什么都不派发 |

配套：`sub_453A90`/`sub_453BB0`（ms 计时器，raw 66115/66215）、`sub_405360`（压返回点，raw 11031，`a2=0`
即"回到当前指令"）、`sub_42A180`（introsort，raw 36219）。

## 3. 两条必须记死的口径

### ① 派发次数 = 条目数 − 1

`i0d5` 的判据是 `index < _this[430688]`，而 `430688` 是 `0xD4` 追加时的**写游标**（每条 +1，
从 -1 起）⇒ 建表结束时 = 条目数 − 1。走到最后一条时脚本就往下走了 ⇒ **最后一条永远不会被派发**。

语料正好印证：`HISTORY` 写 `4 + 1 + 2 = 7` 条，而 `label_00003aa8` 的 `local 492` 从 0 数到 5
再做 `div …, 5` 的缓动 ⇒ **取样点 0..5 = 6 次派发**。所以那个"多出来的第 7 条"是**收尾哨兵**：
它的唯一职责是让 `i0d5` 的判据在正确的时刻失效。

### ② "到点" = 时钟被推到 t

`sub_408F10`：`v6 = t - elapsed`；
- `v6 >= 50` ⇒ `Sleep(1)` 后 return（本遍不派发）；
- `v6 < 50` ⇒ `if (v6 > 0) Sleep(v6)` ⇒ **把时钟精确推到目标时刻**再派发。

所以净效果是"到点才派发"，`50` 只是"一次别睡太久"的分段。emulator 的帧粒度下无法 `Sleep(v6)`，
等价做法 = **帧时钟 >= t 才算到点**（`v6 ∈ (0,50)` 那一档表现为至多多等一帧）。

### ③ "落后"入口（`tail`）

`v8 = (还有下一条) && (下一条.t - elapsed < 0)` ⇒ 取 `dword[2+v8]`：**已经落后**就用第 4 个操作数
（`tail`），否则第 3 个（`body`）。语料里 `body` = 重活 + 公共尾、`tail` = 那个公共尾
（`BTL.txt:3507` 的 `jcc … label_0001233c` 就是 body 直接跳 tail）⇒ 掉帧时省掉重活、只把计数追上。

## 4. 实现落点

| 文件 | 内容 |
|---|---|
| `src/vm/stageLoop.ts` | `StageLoop`（状态）+ `runStageService`（= `sub_408F10`）+ `STAGE_GATE` |
| `src/vm/handlers/stage.ts` | `op_stage_reset` / `op_stage_add` / `op_stage_run` |
| `src/vm/engine.ts` | `Engine.stage` + `serviceStageLoop()` |
| `src/frame/loop.ts` | `stage` 门档（`'wait'`/`'ignore'`）+ 派发批 break 条件加 `STAGE_GATE` |
| `src/report.ts` | `consumesFrame` 加 `'stage'`（否则虚拟时钟不前进） |
| `test/stage-loop.test.ts` | 11 条守卫（含 E3 真语料） |

`0xD5` 的"本条不前进"用 `c.jump(c.frame.ip)` 表达（引擎是 `95805 = 0`）。

## 5. 踩过的三个坑（都留在守卫里）

1. **合成脚本的 label 必须是真实 dword 偏移**：`1 + 2*argc`，我第一版把 argc=0 的 no-op 当成 3 dword，
   label 指到了指令中间 ⇒ `labelMap` 查不到 ⇒ 走"跳过条目"分支、只派发 1 次。守卫里现在把布局写成注释。
2. **`.txt` 里的操作数都是十六进制**：`(local-int 210)` 是槽 **0x210 = 528**，不是 210。
   第一版断言读 210 得 0，白查了一轮。
3. **收尾必须挡住"落进脚本体"**：合成脚本若不终止，跑完时间表后会 fall through 进 `body`/`tail`
   把计数搅乱（多 2 次）。加一条 `abort` 作为收尾，计数就干净了。

## 6. 顺带修正

- `script/bin.ts` 的 `labelTargets` 对 `0xD4` 把 label 操作数记成 `[0]`（其实是"间隔 ms"）
  ⇒ 改 `[2,3]`，与 `scripts/asm/age-shared.mjs` 的 `isLabelArgument`（`x >= 2`）同口径。
  该集合目前只被工具读（`frame.labelMap` 是**全部**指令下标），VM 不受影响。
- 重新生成 `scripts/asm/opcodes.json`：除本单三条的状态列外，还带出上一单（T-0054 acceptance #6）
  遗留的 `0x34F/0x350/0x351`（argc 由 `null` → 2/1/3、状态 → 已核对）—— 即"md 真源改了但没重跑
  `build-opcodes.js`"。这三个 opcode 在 `src/*.txt` 里出现 0 次 ⇒ 无行为影响；重新生成后
  `.tmp/opcodes.before.json` 与新文件的 diff 仅这 6 条。

## 7. 验证

```
cd app/amayui-emulator
npx tsx --test test/stage-loop.test.ts      # 11/11
npm test                                    # 598 测试 / 597 通过 / 0 失败（1 skip）
npm run verify                              # typecheck ×3 + 测试 + dead-writes
node .agents/skills/amayui-engine-analysis/scripts/scripts.js . --validate
node .agents/skills/amayui-engine-analysis/scripts/capabilities.js . --validate
node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --validate
```

E3 数字（`SAVE.BIN` 的 `label_0000706c` 段，32 条目）：**31 次派发**（= 32 − 1）、
末条（`t = 481 ms`）在 **496 ms** 的帧上派发、共 **31 帧**、`local 0x210` = 31。

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

过程笔记见 notes.md。要点：① 三条指令是**一套小语言**，只实现其中一条没有意义；② 真正的难点不在 handler 而在**帧循环的门**（`0x40` 置位期间整个脚本停摆）；③ 两条口径（派发次数 = 条目数 − 1、到点 = 时钟推到 t）都是逐行核对 raw 得出的，写错都会表现为「动画不对但一切正常」。
