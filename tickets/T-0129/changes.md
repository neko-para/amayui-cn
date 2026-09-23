# T-0129 · 变更记录

## 第 1 次变更（2026-09-23）：注册表分类棘轮收成一张表（8 处 → 1 处）

### 做了什么

新增 `test/registry-classification.test.ts`（2 例，`@tier T0 @kind ratchet @subsystem vm`）：把散在
**8 个票文件**里的「这个 opcode 属于哪张表」的重复棘轮收成**一张数据表** `[opcode, 期望类别, 出处/理由]`：

| 原位置 | 覆盖的 opcode |
|---|---|
| `test/op-a4-a6.test.ts` | A6 ×3 + A4 ×13 |
| `test/op-a5.test.ts` | A5 ×11 |
| `test/op-a2-a3.test.ts` | A2/A3 ×13 + 读取端 4 条（更严：必须 `OPS`） |
| `test/op-1cb-2c8-2c9.test.ts` | 0x1CB / 0x2C8 / 0x2C9 |
| `test/op-327-32e-setweather-noop.test.ts` | SETWEATHER 族 ×5（`ENGINE_INTERNAL_OPS`） |
| `test/op-191-fabs.test.ts` | 0x191 |
| `test/op-d0-wallclock.test.ts` | 0xD0（整条用例只做分类） |
| `test/op-132-134-queue.test.ts` | 0x132/0x133/0x134 |

**判据没有降低，反而更严**：新表的每条同时断「**恰好在一张表里**」（三表两两不交由 `registry-tables.test.ts` 守）
**且就在它该在的那张**里，并给出**出处票号**；`op-132-134` 的循环里没有的「同 id 重复登记」也被第 2 条用例拦住。

- **删除 7 条重复用例**（上述文件里那 6 条纯分类用例 + 各处混在其它用例里的分类断言行），
  原地留下**指针注释**（指明去哪张表），不删任何行为断言。
- 顺便用自己写的新用例抓到一次**自己的错**：初版把 0x1D3/0x1D4/0x2F3/0x199 同时登记成
  「宽松集合」与「严格 `OPS`」⇒ 「表里没有重复登记」那条当场红。**这就是"去重"该有的自检。**

### 证伪（判别力实测）

把 `src/vm/handlers/engine-fields.ts` 里 `[0xd0, op_wall_clock_ms]` 那一行删掉（模拟"升级实现时忘了改分类"）：

```
✖ ★opcode 实现类别（一张表）：恰好在一张表里，且就在它该在的那张
   0xd0 三张表全无（命中即 NotImplementedOp）—— T-0093：墙钟毫秒（体里有真实效果：写 op1）
```

还原 ⇒ 绿。★原来那 8 处**各自**也能红，但改一处分类要改 9 个地方 —— 现在只改这一张表。

### 数字

| 口径 | 前 | 后 |
|---|---|---|
| 测试文件 | 165 | **166** |
| 用例 | 1086 | **1082**（−7 条重复、+2 条收编后的守卫，另有 `registry-classification` 的 2 条） |
| `npm run verify` | 31.3 s | **31.8 s**（全绿） |

★「用例变少」正是本票的目的：删掉的是**已被更强替身覆盖**的那一份，不是覆盖面。

---

## 仍未做（本票剩余范围）

1. **`adv-msgwin.test.ts:415-501/511-523` 的 5 组路由用例** → 让位给 `route-dispatch.test.ts`
   （后者用真 `stepOnce`、返回点精确到 `gateDword===17`）。预计 −5 例 / −90 行。**替身位置已核过**。
2. **存档族 10 文件 / 60 例 → 7 文件 / 51 例**：`save-slot-chain` → 并入 `slot-load-transfer`；
   `save-slot` 吃掉 `save-thumb` 的 2 例重复；`slot-load-screen` + `slot-load-l2d-reset` → `slot-load-presentation`。
   ★`save-slot-tdz` **必须保持独立**（import 顺序本身是被测对象）。
3. **`option-font-speed-menu.test.ts` 拆 3 主题**（字体表并入 `adv-msgwin`、菜单并入 `op-a2-a3`、注册表部分并入本表）⇒ 整文件可删。
4. **结构债**（与 `T-0020` 同源）：三份逐字重复的 Proxy `touched`、`RecordingNative` 2 份、WAV/OGG 合成件 2 份、
   `mkEngine(fsLike)` 2 份 ⇒ 上收 `test/harness.ts` 或新建 `test/operandHarness.ts`。

★纪律：每处去重都要在 changes.md 给出**被删断言的替身位置**（`file:line`）与**替身更强在哪里**，
并按本票 acceptance 用闸门 E 抽样复跑（删完仍必须被 ≥1 条测试抓到）。
