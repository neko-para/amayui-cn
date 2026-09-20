# T-0097 · 过程文档（changes.md）

## 2026-09-20

## 轮 7 · 第④项（`Engine/0x408` scope 复核）—— 已落地（主 agent）

**结论：原 `Engine/0x408 draw_item_container` 是 scope 错的重复条目，已删并改写为 `Engine/0x408 input_manager`。**

证据（逐条读体，全部 `engine/天结_unpacked.exe_utf8.c` 行号）：

| 断言 | 体证据 |
|---|---|
| `Engine+1032` 是 **Input(DInput) 管理器对象** | 引擎 ctor raw **22461** `sub_477DD0((_DWORD *)(_this + 1032))`（`_this` = Engine）；`sub_477DD0` 体内 raw **92386** `_this[259] = 7`（= `set_key_total` 默认）、raw **92387-92393** `_this[260..266] = 200/205/208/203/28/57/14`（默认键码）、raw **91575** `GetAsyncKeyState(_this[a2 + 1432])`、raw **92381** `memset(_this + 1176, 255, 0x400)`（VK→掩码位表，`0x10C` 的消费者） |
| 同一对象在 DInput 初始化路径被用 | raw **11993** `sub_406C70(_this, …)` → `sub_478050(_this + 258, a2, hWnd)`（`_this` = Engine，调用点 raw **23676**）；`sub_478050` 体 raw 92439 |
| 复位路径也打它 | `sub_40DF10` raw **18058/18060** `sub_478090(_this + 1032, …)` / `sub_477220(_this + 1032, &v18)` |
| 绘制项容器在 **`Scene+0x408`** | `sub_4AAA50(_this, a2)` raw **130039** `v3 = (_DWORD *)(_this + 1032)`；`_this` = `0x223` 在 raw **31957** 传的 `_this + 80708`（= **`Engine+0x4ED10`** / byte 322832，见 `Engine/0x4ED10 scene`）。★本表初版把基址写成 `Engine+0x4ECD0`（=322768，**偏 64 字节**），轮 7 由 T-0091③ 的规格分析发现并全库订正（`fields.json` 13 处 + `functions.json` 12 处 + 两处文档） |

**顺带发现并订正的同族错误（同类 scope 错）**：`Engine/0x428 mesh_container` 也是错的 —— mesh 容器在 **`Scene+0x428`**（raw **132729/132803/132817** `sub_40DC30(_this + 266, &a2)`、raw **130559/131238/133502** `sub_40DC30((_DWORD *)(_this + 1064), …)`，这些函数的 `_this` 与同体内 `sub_4AAA50`/`sub_4AAD40(_this + 258)` 相同 = Scene）。已改为 `Scene/0x428 mesh_container`。

**第一层连带订正（`analysis/functions.json`，12 处块内定点替换）**：
- `sub_4AEEA0`/`sub_4ACF60`/`sub_4AD0C0` 的 `signature_override.param0`：`this(Engine*)` → `this(Scene*)`（raw **31415** `sub_4AD0C0(_this + 80708,…)`、raw **31450** `sub_4ACF60(_this + 80708,…)` —— opcode handler 的 `_this` 是 Engine，传进来的是 Scene）；`sub_4AAD40` → `this(std::map<uint32_t,DrawItem>*)`（arg0 = 容器基址本身，各调用点传 `Scene+1032`）。
- 6 处 `fields_used` 里的旧名 `this->draw_item_container` / `Scene+1032 draw_item_container` / `this->draw_item_container(_this+258/[1032])` 全部改为 `Scene+0x408 draw_item_map`（旧名已从 `fields.json` 删除，不改就是悬空引用）。
- 工具侧：`report.js --set` 不支持数组/对象值（`parseKv` 只认 bool/数字），故这次用了一个**块内定点替换脚本**（`.tmp/t0097-4/fix-functions.mjs`：按 `"addr"` 定位块行区间 → 字面替换 → 每处断言命中次数 → `JSON.parse` 自检 → tmp+rename 原子写），**不重排整文件**。

**文档同步**：
- `docs-new/03-engine/engine-reset-mainloop.md` §A.3 的「命中已知字段」表：`draw_item_container` → `input_manager`(0x408) + 订正说明（该表对应 `sub_40DF10`，其 raw 18058/18060 正是这处）。
- `docs-new/03-engine/runtime-memory.md` 新增 **§1.2 内嵌子对象基址（★同偏移不同 scope）**：Engine 域子对象表 + 「凡 `_this+258` 是绘制项 map ⇒ 首参是 Scene」的 scope 判据。

**锚点申报**：`tickets/T-0097/ticket.json` 的 `evidence[2].anchor` 由 `draw_item_container`（该字面串已从 `fields.json` 删除）**retarget** 为 `"name":"input_manager"` —— 这是「被锚文件被改进而锚点必须跟着走」的正当 retarget，不是删证据。
