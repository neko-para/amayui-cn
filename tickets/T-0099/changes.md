# T-0099 · 过程文档（changes.md）

## 2026-09-21

## 2026-09-21

## 第 1 次变更：**结论 = 值得改**，已在门判定处落地「到点当帧派发」

### 判据 1 前半：引擎到底怎么走（raw 逐行）

`engine/天结_unpacked.exe_utf8.c` 主循环 raw **21176-21181**：

```c
if ( (v35 & 0x20000000) != 0 ) {            // SLEEP_GATE 置位
  sub_409400(_this);                        // 等节拍 + 推一个字 + （无窗在节流时）清 0x20000000
  if ( *(_DWORD *)(_this + 489860) ) goto LABEL_215;   // 0x300 闸门槽活跃 ⇒ **当轮就派发**
}
else if ( v35 >= 0 ) { … else { LABEL_215: 派发一条指令 } }
```

⇒ 到点后引擎要么**当轮**走 `LABEL_215`，要么落回循环顶再走一次 —— 而引擎的"下一轮"只是
`Sleep(0)`（raw 21172）+ 输入泵级的**廉价迭代**，不是一帧。emulator 的循环迭代 = 一帧
（产品是 `requestAnimationFrame`，测试是虚拟时钟 +16.67ms）⇒ 旧写法"本帧只清门、下一帧才派发"
**每处多等一帧**（实测 40ms 档：**66.7ms = 4 帧**，引擎约 **50ms = 3 帧**）。

### 判据 1 后半：用 `SLEEP_GATE`/`sleepUntil` 的指令与读者（全列）

| 角色 | 位置 | 语义 |
|---|---|---|
| **写端 ①** `0xC8` `sleep` | `handlers/frame.ts` 的 `op_sleep` | `sleepUntil = nowMs + max(1, n)`，置位 |
| **写端 ②** `0x6E` `show-text` 第②路 | `handlers/msgwin.ts`（raw 28380/28382） | MessageSpeed≠0 且 ADV 未置 ⇒ 置位 + `sleepUntil = now + max(1, MessageSpeed)` |
| **写端 ③** `0x196` `display-furigana` 第①②路 | `handlers/msgwin.ts`（raw 29093/29095；`T-0094` 落地） | 同形机制（语料 6341 处） |
| **读者（驱动）** | `frame/loop.ts` 的 `sleep` 分支 | 本票改的就是这里 |
| **读者（观察者）** | `renderer/app/session.ts` 的 `case 'sleep'` | **只写 trace、不改状态**（注释明写"清位是驱动的事"）—— 与本改动不冲突 |
| **读者（报告）** | `frame/digest.ts`（`sleepUntil` 入 digest）、`report.ts`（其自造循环必须让 sleep 分支占一帧） | 只读 |

`waitFlags` 是 `effectFlags` 的别名（`engine.ts` 的 getter/setter）⇒ 三个写端都落在同一格，无第二真源。

### 判据 2：改动（**只动门判定处**）

```ts
if (gates.sleep === 'clear' || nowMs >= e.sleepUntil) {
  e.waitFlags &= ~SLEEP_GATE;
  if (gates.sleep !== 'clear' && !e.textRevealing) batch = true;   // ← 新增：当帧走常规派发
}
```
- 动画窗 / 转场窗 / 阶梯时间表的到点语义**一行未动**；`gates.sleep === 'clear'` 的行为也没变（测试专用档）。
- ★**为什么要有 `!e.textRevealing`（第一次尝试搬家了，记下来）**：第一版写成"门一清就派发" ⇒
  `test/adv-reveal-under-throttle.test.ts` 的坑 B 立刻**从"显完 8 字"退化成"停在 5 字"**：
  引擎里 `0x20000000` 是**逐字泵**在置/清（`sub_409400` 只在"没有窗在节流"时才清它），
  还在逐字时引擎**不会**掉进派发路径；而 emulator 把"节流到期"与"泵还活着"折在同一个门上
  ⇒ 必须显式排除"泵还在跑"这一态。加上它之后两个用例同时绿。

### 判据 3：守卫（收紧 + 双向）

`test/op-3-004-furigana-outer-gate.test.ts` 的 E3 时序断言由"上限 80ms"收紧为
**恰好 `ceil(MessageSpeed/帧长)` 帧**（40ms 档 = 3 帧 = 50ms，容差 0.01），并补一条**反向断言**
"任何一处都不得短于 MessageSpeed"（不许为了对齐帧而放宽门）。丢步/卡死的断言保留（指令序列逐条相同）。

**辨别力已机械证明**：把 `batch = true` 那行改回"永不"⇒
`★每处必须恰好等 3 帧（=50ms…）实际 Δ=67,67,67,67,67,67,67,67,67,67ms`（**正是票面实测的 66.7ms/4 帧**），
其余 9 条全绿 ⇒ 只有这一条判据在钉它；还原后 10/10。

### 验证

`npm run verify` 全绿（typecheck ×3 + 全量测试 + 死写闸门）；`op-10-002`/`wait-gate-timer`/`adv-reveal-under-throttle`/
`frame-loop`/`adv-msgwin` 全在列。
