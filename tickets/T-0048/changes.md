# T-0048 · 过程文档（changes.md）

## 2026-09-16

## 落地与取证（2026-09）

- **实现**：`handlers/input.ts` 的 `INPUT_OPS[0x10a] = op_set_mouse_pos`（读 op1/op2 → `InputManager.setCursor(x, y, true)`）。
  守卫 `test/input.test.ts`：① `OPS.has(0x10a) && !ENGINE_INTERNAL_OPS.has(0x10a)`（不得拿 no-op 桩糊）；
  ② 位置变化触发一次 `onCursorMove`（= 引擎 WM_MOUSEMOVE 的 `sub_403C50` 命中测试）、位置不变不触发；
  ③ 0x10A → 0x109 往返（同一 (x,y)）。
- **语义落库**：`analysis/functions.json` 新增 `0x421EA0`（ANALYZED，含未建模项）；`opcode-table.md` 的 0x10A 行
  由「仅映射」转「已核对」并重生成 `scripts/asm/opcodes.json`；`input-system.md` §8 增补 0x10A 行；
  `analysis/scripts.json` 的 `SC0330` 新增 `711-793` 段（ADV 侧栏 `f7ffb` 状态机 + 光标钉住）与对应 gotcha。
- **★路线订正（实测）**：ADV **条带热点**（`i090 4ce e9 32 104 label_00000c74 …`）的 enter 处理器
  `label_00000c74` **不含** `i10a` —— 它只做"展开侧栏"（`i093` + 16 槽 `i220` 平移 + `1399 = 2` + 重登记热点表）。
  `i10a 4c4 (global-int 13a0)` 在**侧栏槽位处理器** `label_00002954/2a70/2b3c/2c40` 里，而这些槽注册在
  **屏幕外的 1×1 热点**（`i090 (local 0)(local 1) 1 1 …`，y≈1000 ⇒ 鼠标命中不到）⇒ 只能由 `pickByKey`
  （键盘/手柄掩码位）派发。故「悬停条带 ⇒ 展开」这条路径**不经过** 0x10A；那条 warp 的语义是
  "用键盘/手柄在侧栏里操作时，把鼠标光标跟着挪进栏内（x=1220，Y 保持）"，好让随后鼠标驱动的 hover 对上。
- **因此本单没有加 E3 端到端守卫**（诚实记录）：story 脚本那条 warp 走的是键盘掩码路由，而 emulator 的
  键盘掩码位（0..6）目前**不合成**（`flushHeld` 只合成鼠标/手柄，见 input.ts 的说明）⇒ headless 里根本
  派发不到那些槽位处理器；另外三条语料用途（ALLMAP 拖动回夹 / BUNKI·SBUNKI 光标记忆 / SELSTAGE 对话框居中）
  各自需要地图状态、配置位与关卡状态，代价不成比例。语义已由单元守卫钉死，若要 E3，建议随
  「键盘掩码位接入」那条一起做。
