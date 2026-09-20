# T-0087 · 过程文档（changes.md）

## 2026-09-20

## 2026-09（轮 4）：容器错位修复

**第 1 次变更 —— 把 `0x223` 从「无人读的死模型」改回引擎的真实容器。**

### 改了什么
| 文件 | 变更 |
|---|---|
| `src/vm/handlers/gfx-item.ts` | handler 改名 `op_set_item_region` → `op_set_transition_fade`（注册键 `[0x223, …]` 不变）；落点改为 `c.native.setTransition(key, writes)`（= `0x24F`/`0x250`/`0x251` 的**同一条宿主缝**）；条目移出「查询族」块，另立「转场记录表 `Scene+1048`」块；注释按体重写（含 raw 行号与 `_this + 262` = 字节 1048 的推导） |
| `src/vm/engine.ts` | **删掉死模型 `itemRegions`**（原 458-466 整块）—— 该字段写入端存在、**生产代码零读者**，且 `check:dead-writes` 只扫 `Item`/`MeshObj`，覆盖不到它 |
| `test/op-223-transition-fade.test.ts` | **新建**（宿主改 `HeadlessScene`，仍走真实 `stepOnce` 派发 + 槽解码）；4 条断言 |
| `test/op-223-item-region.test.ts` | **删除**（旧断言全部建立在 `Engine.itemRegions` 上） |
| `test/draw-item-loop-anim.test.ts` | 1 行注释里的旧文件名同步 |
| `docs-new/03-engine/opcode-table.md` | `0x223` 行语义改写（「转场记录 `Scene+1048`·类别 0（全屏交叉淡化）写入端」）+ 分析状态 `仅映射` → `已核对` |
| `analysis/opcode-gaps.json` | `0x223` note **保留原文 + 追加** `★★订正（T-0087）`；`disposition` 仍为 `implemented`（此前已实现，本次是**改对容器**而非从无到有） |

### 行为怎么变
- **之前**：`i223` 的 9 个数进 `Engine.itemRegions`（**没人读**）⇒ 语料 **178 处 / 178 文件**的**类别 0 转场对渲染端完全不可见**；且记录只有 9 格、丢了引擎「先建 24 格默认记录（`[4] = -1`、`[9..13] = 0`）再覆盖前 9 格」的行为。
- **之后**：写进 `SceneState.render4.transitions`（与 `0x24F`/`0x250`/`0x251` 同一张表），长度 **24**，`[0] = 0`（类别 0），前 9 格逐格与引擎相等；`[9..13]` 保持默认。

### 判据 / 证据
- 机械判据：**白名单式** —— 新守卫断言 `length === 24`、`[0] === 0`、前 9 格 `deepEqual [0,0,55,66,7,11,33,22,44]`、`[9..13]` 默认、`(e as any).itemRegions === undefined`。
- 同表不串格：与 `0x24F` 的记录并存，`test/op-24f-250-251-transitions.test.ts` **保持 8/8 绿**。
- 引擎侧证据：`sub_423F00`（raw 31936-31958，argc 8/arity 槽 17）→ `sub_4ADDB0`（raw 132590-132635，`sub_4AAE10(_this + 262, &a2)`、`[0] = 0`）；独立复核由主流程逐行完成。

### ★实现坑（已写进代码注释）
8 个操作数**必须先读进局部量**再调用：写成内联 `setTransition?.(id, [[2, o(7)], …])` 时，**可选调用在宿主没有该缝时不会求值实参**（`StubNative` 无 `setTransition`）⇒ 8 个操作数**一个都不读**，`test/opcode-operands.test.ts` 直接红（第一版即如此）。

### 顺带订正（不在本票范围但相关）
`docs-new/03-engine/transition-render-spec-2026-09.md` §2.3 的 `[13]` 行把**类别 0** 的来源误记为 `a10`：`a10` 属**类别 1 的写入端 `sub_4ADEE0`**（12 参 `a2..a12`，raw 132679）；类别 0 的 `sub_4ADDB0` 只有 `a2..a9` 且**不写 `[13]`**。已订正该格。

### 仍记缺口（不掩盖）
`sub_4ADDB0` 头部的**惰性（重）建纹理层**分支（`sub_4A2C10`，`operator new(0x460)` 的对象内部）未读完 ⇒ 未建模；属**渲染端**缺口，不是本票判据。
