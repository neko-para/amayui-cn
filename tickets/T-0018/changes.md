# T-0018 · 过程文档（changes.md）

## 第 1 次变更（2026-09）：整条存档槽链路（存 / 读 / 读头 / 短读 / 删 / 复制 / `.STH`）

### 改了什么

| 位置 | 改动 |
|---|---|
| `src/vm/saveSlot.ts`（新增） | 槽路径 `SAVE/SAVE%2.2d.DAT`·`.STH`（`%2.2d` 精度 2 ⇒ 补 0，E4 真槽就是 `SAVE00.DAT`）；292 B 头解析（`S4SD`/`S3SD` + 版本 `strcmp` + **264/266/270/272/274/276** + **280 游玩秒数** + 284 format）；本工程状态块 `SlotStateBlock`（`AMYS1\n` + JSON）+ 编解码；`buildSlotFile`/`parseSlotFile`（引擎格式 ⇒ `engineFormat: true`、空表、`state: null`）；`SLOT_GAPS` |
| `src/vm/handlers/save-slot.ts`（新增） | 8 条 handler：`0x19E` `0x19F` `0x1A0` `0x1A1` `0x1AB` `0x1AC` `0x1AE` `0x1AF`；`loadSlotIntoEngine`（两张表 + 已使用文件标志 + 池/帧/游标/游玩秒数；引擎格式槽只接头里的 `+280`）与 `saveSlotFromEngine` |
| `src/vm/handlers/index.ts` | `SAVE_SLOT_OPS` 合进 `OPS`（与 `NATIVE_OPS`/`ENGINE_INTERNAL_OPS` 保持两两不交） |
| `src/vm/saveData.ts` | `encodeSaveData`/`parsePayload` 支持**可选尾块**（`SaveDataDecoded.trailing`）；★**修 bug**：读侧原本没吃掉记录区之后那个尾部块 dword ⇒ `trailing` 前面多 4 个 `00`，状态块魔数匹配失败（读档只还原两张表的真凶） |
| `src/arch/fileSource.ts` | 新增可选槽接口 `readSaveSlot` / `writeSaveSlot` / `deleteSaveSlot` / `copySaveSlot` / `readSlotThumb` / `writeSlotThumb` |
| `src/arch/nodeFileSource.ts` | 实现上述接口：**读 overlay → base，写/删只碰 overlay**（真存档槽一个字节都不动） |
| `src/vm/engine.ts` | `Engine.playSeconds`（存档头 `+280` 的口径） |
| `src/frame/loop.ts` | 每帧完成时按 `delta/1000` 累加 `playSeconds`（`0 < delta <= 1000` 才计，避免挂起/大跳） |
| `test/save-slot.test.ts`（新增，10 条） | E4 真槽头（对文件 mtime）+ `format = 3`；`0x1A0` 往返与 1/2 两个错误码；`0x19E→0x1A1` 往返（`load-int`/`load-string`、全局池 DEC、ip、游玩秒数）；★`0x1A1` 不写 `op1`（哨兵 + 引擎格式槽）；`0x19F` 写 `op1`；`0x1AB`/`0x1AC` 的 0/1/2；`0x1AE`/`0x1AF` `.STH` 往返；状态块编解码；`NodeFileSource` 只写 overlay；`%2.2d` 路径格式；无宿主能力不抛错 |
| `docs-new/03-engine/opcode-table.md` | `0x190`/`0x19E`/`0x19F`/`0x1A0`/`0x1A1`/`0x1AB`/`0x1AC`/`0x1AE`/`0x1AF` 九行从"仅映射"补成逐条读体结论；★**订正** `0x1A1`（旧注"存档到槽位"为误） |
| `docs-new/03-engine/save-data.md` | 新增 §7「存档槽链路」（opcode 表 + 路径 + `0x1A1` 不写操作数 + ENC 不变量 + 游玩秒数记账 + 语料用量 + 本工程槽格式 + `SLOT_GAPS`）；改 §3 头 `+280` 的描述（累计游玩秒数）；§6 现状表把"存档槽 ❌ 未实现"改成 ✅ |
| `docs-new/04-app/emulator.md` | §9 缺口行：`0x1A0 未实现` → 链路已通 + 剩余 `SLOT_GAPS` |
| `analysis/functions.json` | 新增 12 条（`sub_42D980`/`sub_42DB10`/`sub_42DC70`/`sub_42DFC0`/`sub_42E0A0`/`sub_42E1F0`/`sub_42E320`/`sub_42D830`/`sub_438120`/`sub_4380F0`/`sub_410160`/`sub_40CD10`）+ 改 3 条（`sub_42DDE0` = `op_load_slot_42DDE0`、`sub_437980`、`sub_438120`）；函数 467 → 479 |
| `analysis/engine-capabilities.json` | 新增 `save-slot-chain`（触发/缺失时静默/读的字段/`modeled-verified` E2，guard=`test/save-slot.test.ts`）；`save-data-tables-persistence` 的 emulator note 去掉"存档槽未接" |
| `analysis/scripts.json` | `SC0330` 条目补 3 段 layout（`i1a0` 存在性判定 532-545、`i1a1` q-load 571-582、`i19e`+`i1ae` 存槽与缩略图 17533-17596）+ 2 个槽 + 2 条 gotchas/gaps + capability 链接 |

### 两条"先红后绿"的实测（本轮真踩到的）

1. `0x19E → 0x1A1` 往返里 `load-int` 取回的**不是**存档时的值：
   先怀疑 handler，用探针打出 `globals.int.get(key)` = 32768 而不是 2 —— 那是**池里存的是 ENC 值**（`enc(0,2) = 0x8000`），
   读侧应看 `readIntOperand` 的 DEC 结果（32768 是假象）。⇒ 断言改成 VM 可见值（`readIntOperand` / `dec(key, …)`）。
2. 修好①后仍失败：`parseSlotFile` 返回 `state: null`。逐层打点定位到 `decodeSaveData` 的 `trailing` 前面多了 4 个 `00`
   （`buildPayload` 写的尾部块首 dword，读侧没跳过）⇒ 骨架放进 §"改了什么"的 `saveData.ts` 一行。

### 判据

```text
npx tsx --test test/save-slot.test.ts   → 10/10 绿
npm run verify                          → 512/512 绿（typecheck + tests + 死写检测：无新增死写）
三份台账守卫（ticket / capability / script-ledger）→ 见 tickets/README.md 与收尾实测
```

E4 与 E3 的边界：本机**没有**可交互的真机对照（E4 视觉比对做不了）⇒ 本票的 E4 只用"真槽文件头 vs 文件 mtime"
这类**离线可复现**的对照；E3 则是**真语料 + 真玩家存档槽**跑出来的（下一节）。

## 第 2 次变更（2026-09）：E3 —— 真语料点进「Load Data」列表，零未实现 opcode

### 怎么发现的

E2 只证明"handler 对"，不证明"菜单点得进去"。于是照 `test/game-start-chain.test.ts` 的办法起一条真语料链路：
`SYSTEM4 → LOGO → TITLE →（菜单第 1 项 Load Data）→ SAVE.BIN`。命中点按 `docs-new/05-scripts/TITLE.md`
的数组算：baseX `0x3e0` / baseY `0x192` / 盒 156×156 ⇒ 中心 **(1070, 480)**。

第一次跑的诊断（`.tmp/t18-loadmenu-probe.mts`）：

```text
① 到 TITLE: 308 TITLE.BIN
② 悬停后: hover = 1                    ← 命中第 1 项 Load Data
③ 点击后到达: 1 SAVE.BIN | trail = …,$5$SETL2DMOC.BIN,SAVE.BIN
   unknown   = ["0x2e5@SAVE.BIN:175"]   ← ★唯一缺口
   slotReads = 120 [0,1,…,11]
```

### 补的那条：`0x2E5` = 读**水平**滚轮（一次性消费）

- 引擎 `sub_4310D0`（raw 40342-40350）逐字：`v2 = _this[1950]; _this[1950] = 0; writeIntOperand(1, v2);`
  —— 与 `0x10D`（竖直，`_this[1949]`）**同形状、不同累加器**。
- 累加侧 = WndProc `case 0x20E`（WM_MOUSEHWHEEL，raw 141585-141611）：只有 `(Engine+699204 & 0x90100000) == 0`
  才 `+= (short)HIWORD(wParam)`；否则改派发 `set:HWheelKeyUp/Down`。
- 真实用例 `src/SAVE.txt:204-205`：同一次轮询里先 `read-mouse-wheel (local 14)` 再 `i2e5 (local 15)`
  ⇒ **只实现竖直那个，列表的横向翻页永远读 0**（静默失效）。语料里 `i2e5` 只出现在 `SAVE.txt:205/304`。
- 实现：`InputManager.wheelDelta` / `hwheelDelta`（`addWheel` / `addHWheel`、都进 `snapshot()`/`restore()`
  以保回放一致）+ `consumeWheelDelta` / `consumeHWheelDelta` + `handlers/input.ts` 的 `0x2E5`；
  渲染侧 `wheel` 事件把 `deltaX` 原样喂水平累加器（`deltaY` 仍取负喂竖直）。

### 收尾实测

```text
npx tsx --test test/save-slot-chain.test.ts   → 1/1 绿（7.3 s）
   · TITLE 悬停命中第 1 项（Load Data）；点击后进入 SAVE.BIN
   · 路径上**零**未实现 opcode
   · fileSource 真的读了 120 次真槽（去重后 0..999 全覆盖）—— 槽号范围由此实测（引擎无范围校验）
   · 没有任何 write/delete/copy（列表界面只读；本测试不注入 onSaveDataChanged）
npx tsx --test test/wheel.test.ts             → 7/7 绿（含 0x2E5 与 0x10D 互不消费）
npm run verify                                → **516/516 全绿**（typecheck + 全套 + 死写检测：无新增死写）
三份台账守卫（ticket / capability / script-ledger）→ 16/16 绿
```

### 顺带修的两处"接线层"缺口

| 位置 | 改动 |
|---|---|
| `electron/ipc/files.ts` + `electron/preload.ts` + `src/renderer/ipcProtocol.ts` + `src/renderer/ipcFileSource.ts` | ★**Electron 路径原先根本没接槽**：`NodeFileSource` 在主进程只传了 `resourceDir`（`#overlay === null`）⇒ 槽读写全部空转。现在主进程把它也接上 `system: SYSTEM_PATHS`，并新增 6 条 IPC 通道（`read/write/delete/copy/read-slot-thumb/write-slot-thumb`）；槽号范围 0..999（实测 `SAVE.BIN` 逐槽读 0..999） |
| `src/renderer/pixi/inputAttach.ts` | `wheel` 事件除了 `-deltaY`（竖直）再喂 `deltaX`（水平）；日志一并打出 `hsum` |
