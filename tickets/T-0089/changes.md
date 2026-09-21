# T-0089 · 过程文档（changes.md）

## 2026-09-21

## 2026-09-21

## 第 1 次变更：环已消（`loadScriptIntoFrame` 下沉到叶子模块 `vm/scriptFrame.ts`）

### 修前的证据（本机复现，逐字保留）

新写的守卫 `test/save-slot-tdz.test.ts` 的**第一版**（只 import `handlers/save-slot` + `engine`）在修前跑出来：

```
src/vm/handlers/index.ts:67
  ...SAVE_SLOT_OPS, // 0x19E/0x19F/… 存档槽链路
     ^
ReferenceError: Cannot access 'SAVE_SLOT_OPS' before initialization
```

⇒ 与票面描述逐字一致（**模块级**抛错，整个测试文件一行都跑不到，看起来像"测试坏了"）。

### 修法（票面判据 1 的第一种方案）

环的三条边是：
```
handlers/save-slot.ts --import { loadScriptIntoFrame } from '../ops.js'-->  vm/ops.ts（桶文件）
vm/ops.ts             --re-export from-->                                  handlers/index.ts
handlers/index.ts     --顶层 ...SAVE_SLOT_OPS-->                            handlers/save-slot.ts
```
`loadScriptIntoFrame` 的**函数体只碰 `Frame`**（无任何注册表依赖）⇒ 把它从 `handlers/control.ts`
搬到**叶子模块** `src/vm/scriptFrame.ts`（只 `import type` `Frame` 与 `ScriptBinary`）：

| 文件 | 改动 |
|---|---|
| `src/vm/scriptFrame.ts` | **新增**：`loadScriptIntoFrame` 本体（含原文档注释） |
| `handlers/control.ts` | 改成 `import { loadScriptIntoFrame } from '../scriptFrame.js'` + `export { loadScriptIntoFrame }`（既有 `from './control.js'` 的调用点不受影响） |
| `handlers/index.ts` | `export { ExitScript } from './control.js'` + `export { loadScriptIntoFrame } from '../scriptFrame.js'`（桶文件 API 不变：`vm/ops.js` 仍导出它） |
| `handlers/save-slot.ts` | 环边改向：`'../ops.js'` → `'../scriptFrame.js'` |
| `handlers/frame.ts` | **同型环边**一并改向（`index → frame → ops → index`，同一个坑） |

`src/vm/ops.ts`（桶文件）的对外 API **一字未变** ⇒ 全仓 100+ 处 `from '…/vm/ops.js'` 的调用点无需改动。

### 守卫 `test/save-slot-tdz.test.ts`（4 条）

① `save-slot.ts` 不得 import `'../ops.js'`、也不得 import `'./index.js'`（静态棘轮，防止边长回来）；
② `handlers/frame.ts` 同样不得 import `'../ops.js'`；
③ **动态判据**：本文件**只** import `save-slot`（handler 模块）+ `engine`（不 import ops）也能跑完
   —— 修前这里 TDZ，修后 4/4 绿（这就是"环被消掉"的可执行证明）；
④ `loadScriptIntoFrame` 必须在叶子模块里定义，且该模块不得 import `handlers/` 或 `ops.js`。

### 顺带

`test/slot-load-l2d-reset.test.ts` 里那条"必须先 import `vm/ops.js`"的工作区注释改成**历史口径 + 现状**
（保留原锚点字符串，另写明"环已消、删掉这行也不会再 TDZ"）—— 锚点棘轮不红，读的人也知道现在是什么状态。

### 验证

`npm run verify` 全绿（typecheck ×3 + 全量测试 + 死写闸门）；`slot-load-*`/`slot-save-*`/`save-slot` 全在列。
