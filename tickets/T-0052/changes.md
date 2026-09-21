# T-0052 · 过程文档（changes.md）

## 2026-09-21

## 2026-09-21

## 第 1 次变更：键盘 → 掩码位 0..6 接上（判据 1/2/4/5 落地，判据 3 到合成脚本级）

### ① VK→虚拟位表（按体）

引擎 Input 构造 raw **92383-92400** 逐行核实：
```c
_this[259] = 7;                                  // SetKeyTotal 默认 7（与 T-0098 的 0xFE 同格）
_this[_this[1632] + 1176] = 0;   // VK 38  ↑
_this[_this[1637] + 1176] = 1;   // VK 39  →
_this[_this[1640] + 1176] = 2;   // VK 40  ↓
_this[_this[1635] + 1176] = 3;   // VK 37  ←
_this[_this[1460] + 1176] = 4;   // VK 13  Enter
_this[_this[1489] + 1176] = 5;   // VK 32  Space
_this[_this[1446] + 1176] = 6;   // VK 8   BackSpace
```
⇒ `src/vm/input.ts` 新增 **`DEFAULT_VK_TO_BIT`**（就这 7 项）。★**未映射的 VK 返回 undefined 且不动任何位**：
引擎那格没映射时 `1 << 0` 会**污染 ↑ 位**，所以不能"当成位 0"。

### ② 两把刷子的两半都接上

| 方法 | 键盘部分 | 语义（引擎） |
|---|---|---|
| `flushPending()`（消费刷 `sub_478090`） | `m \|= keyEdge & 0x7f` | 引擎吸的是**键挂起**（`_this[1159]`）⇒ 只给**按下沿**（消费一次即清 ⇒ 一次按下 = 一次派发） |
| `flushHeld()`（实时刷 `sub_4780D0`） | `m \|= (keysHeld \| keyEdge) & 0x7f` | 引擎用 `GetAsyncKeyState` 轮询真值 ⇒ **按住态**每帧为真（菜单才能连续移动） |

配套：`pressKey(vk)`/`releaseKey(vk)`/`releaseAllKeys()`、`keysHeld` 进 `snapshot()/restore()`（`--record`/`--replay` 的输入状态面）、`hasPending()` 计入 `keyEdge`。
★DOM 侧（`renderer/pixi/inputAttach.ts`）：`keydown`/`keyup` + `blur`/`visibilitychange` → 上面三个方法；
键码用 **`KeyboardEvent.keyCode`**（它在本作要的 7 个键上就是 Windows VK），`key` 作兜底；命中映射表的键 `preventDefault()`（免方向键滚页）。

### ③ 守卫 `test/keyboard-mask.test.ts`（6 条）

① 表就是引擎那 7 条（其余 VK 无位）；② **两把刷子**：`flushPending` 给沿、`consumeEdges` 后沿清而按住态在、
`releaseKey` 后按住态清（但未消费的沿仍在实时刷里）；③ 未映射键不动任何位；④ **`0x100` 真派发**：
按 ↑ ⇒ 掩码 bit0 ⇒ 跳 `joy-callback 0` 登记的 label（同时钉住"掩码分支压的返回点**不加 1**、默认键分支加 1"
这个既有不对称）；⑤ 鼠标 bit4/5 与手柄 bit(4+i) 不受影响、键盘不占 7..；⑥ 快照/还原带 `keysHeld`。

★**辨别力已机械证明**：把两处 `m |= …keyEdge/keysHeld…` 注释掉（= 回到修前）⇒ **6 条里 4 条红**
（含 `0x100` 真派发那条），另 2 条（表 / 未映射键）本就与刷子无关 ⇒ 只有该红的那几条红；还原后 6/6 绿。

### ⑤ 文档 + 台账

- `docs-new/03-engine/input-system.md` §11：新增"键盘 → 掩码位 0..6"整段（位表、DOM 接线、两把刷子口径、
  以及**仍缺**的两条）。
- `analysis/engine-capabilities.json` **新增条目 `input-keyboard-to-mask-bits`**（`subsystem=输入`，
  `status=modeled-verified` / `evidence=E2` / `guard=test/keyboard-mask.test.ts`，`whySilent` 写清
  "缺了不报错、只是键盘完全没反应"以及"按住态 vs 按下沿"两侧的坑）⇒ `--recount` + `build-capabilities.mjs`
  + `--validate` 全绿（137 条）。

### 仍未做（票不结的理由）

- **判据 3 的 E3**（真 ADV 场景里用键盘走侧栏菜单）本轮只到**合成脚本级**（`0x100` 真派发到
  `joy-callback 0`）；真 ADV 场景的键盘 E3 需要在链路里注入键盘事件（`ScenarioSpec` 目前只有鼠标/滚轮事件）
  ⇒ 登记为下一步。
- **按键绑定改写路径**：`0x107`/`0x10B`/`0x10C` 写进 `Engine.engineValues` 的 `keyTableBase`/`keyTable2Base`
  **没有读者**（引擎那张 VK→位表可被它们改写）⇒ 本轮只实现默认值，缺口写进能力条目 note 与本文档。
