# T-0021 · 过程文档（changes.md）

## 2026-09-21

## 2026-09-21

## 第 1 次变更：A1 分层违规已消（存档纯格式层移出 `vm/`）

### 改了什么（纯搬移 + 路径更新；**零行为变更**）

| 从 | 到 | 为什么 |
|---|---|---|
| `src/vm/saveData.ts` | `src/save/saveData.ts` | 存档**格式层**（`SAVE.DAT` 容器/解码/编码/并表）不是 VM 的东西 |
| `src/vm/saveSlot.ts` | `src/save/saveSlot.ts` | 槽文件（`SAVE%2.2d.DAT/.STH`）布局层，同上 |
| `src/vm/crc32.ts` | `src/util/crc32.ts` | 纯算法（`crc32`/`crc32MsbFirst`），与 VM 无关；`util/lzss.ts` 已在 util |

新目录 `src/save/` = **叶子层**：只依赖 `src/util/*`，不 import `vm/`、`arch/`、`renderer/`。

### 依赖方向（本票判据 1）

- `src/arch/nodeFileSource.ts` 此前 import `../vm/saveData.js` + `../vm/saveSlot.js`（**I/O 层反向依赖 VM**）
  ⇒ 现在 import `../save/*.js`。**`src/arch/` 里已经没有任何 `../vm/` 引用**（grep 验证：0 命中）。
- `electron/ipc/files.ts` 的 `../../src/vm/saveData.js` → `../../src/save/saveData.js`（`electron/` 里只剩一条**注释**
  提到旧路径，已一并订正）。
- 其余引用者（`src/run.ts`、`src/tools/saveDump.ts`、`src/tools/scenarioBoot.ts`、`src/renderer/app/configBoot.ts`、
  `src/vm/engine.ts`、`src/vm/engineSlot.ts`、`src/vm/handlers/save-slot.ts` + 7 个测试）全部更新；
  全仓 `from '…vm/(saveData|saveSlot|crc32).js'` 命中 **0**。

### 一处需要判断的地方（写下来免得后人以为是漏改）

`saveSlot.ts` 的 `SlotStateBlock.adv` 原先写成 `import('./advState.js').AdvStateJson`（**类型级**反向边）。
单纯改路径会把它变成 `save → vm` —— 与"依赖方向单向"的判据相悖（`import type` 同样把方向写死）。
⇒ 改成 **`adv?: unknown`**：本层是**不透明载荷的搬运工**，形状由 VM 侧定义（解包方
`src/vm/handlers/save-slot.ts` 交给 `restoreAdvState` 时按 `AdvStateJson` 断言）。这是分层上的**正解**，
不是把类型检查关掉。

### 判据 / 验证

- `npm run typecheck`（3 个 tsconfig：app / control / electron）**全绿** ← 判据 2 的前半。
- `npm test` **全绿**（`save-data`/`overlay`/`save-slot*`/`slot-*` 各链在列）← 判据 2 的后半。
- 票据侧：`T-0018`/`T-0042`/`T-0061`/`T-0068`/`T-0069` 的 **6 条 evidence** 随文件搬家**重定向**
  （锚点字符串不动，只改 `file`；重定向前逐条核对锚点在**新文件**里仍存在）⇒ `tickets.js --validate` 绿。
- `docs-new/04-app/emulator-refactor-plan.md` §10 的第 5 项（本票的来源）标注为已办。
