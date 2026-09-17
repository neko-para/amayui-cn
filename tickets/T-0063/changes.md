# T-0063 · 过程文档（changes.md）

## 2026-09-17

## 第 1 次变更（2026-09）——读档落掉旧绘制项 + 补齐两个被忽略的宿主缝

### 改动
- `src/vm/handlers/save-slot.ts`
  - 真槽路（`restoreEngineSlot`）：在原有的 routes/msgwin 复位之后加 `native.clearDrawContainer?.()`。
  - 本工程状态块路（`loadSlotIntoEngine` 的 ③）：补上 `routes.reset()` + `msgwin.reset()` + `msgWinClearAll()`
    + `clearDrawContainer()`（此前这一段**什么复位都没做**）。
- `src/renderer/scene/ops.ts`：新增 `scClearMeshSlots(s)`（清 `scene.meshes`，对应 `0x32B`）。
- `src/renderer/pixi/textureCache.ts`：新增 `clearSlotRecords()`（只清 `#slotImgid` 这个「槽→imgid」记录，
  **保留** `slotTex`/画布 ⇒ 引擎口径「只清记录不 delete 对象」；`resolve()` 仍能给已绑定的纹理）。
- `src/renderer/pixiBackend.ts`：实现 `clearMeshSlots()`（`0x32B`）/`clearSlotRecords()`（`0x259`）两个宿主缝。
- `src/renderer/headlessScene.ts`：同样实现这两个缝（headless：清模型 + 清 `slotImgid`）。

### 判据
- `test/slot-save-resume.test.ts` 新增一条：两条读档路都必须请求 `clearDrawContainer`（并复位文本/窗口）；
  合成 format=3 槽那一半不依赖本机存档 ⇒ 任何机器都能跑。
- typecheck ×3 绿；`npm test` 633 测试 632 pass 0 fail 1 skip。
- GUI 目视（待用户确认）：读档后存档列表不再覆盖在 ADV 上；若背景长期空白，见 `notes.md` 尾部的细化方案。

## 2026-09-17

## 第 2 次变更（2026-09）——★改用引擎那条续跑路（本工程槽也"从入口跑"），并纠正 0x259 的真实语义

### 为什么推翻第 1 次变更的"整批清绘制项"
第 1 次变更在两条读档路上都请求了 `clearDrawContainer`（清掉全部绘制项）。随后核实：
**ADV 场景的绘制是一次性的** —— 实测 `src/SN0000.txt` 与 `src/$1$SC0330.txt` 在**主循环标签之后**
（`label_000037f0` 起、分别 2827 / 17703 行）只有 **14~16 处 `draw-texture`、2~3 处 `i20c`**，
而 `i1f4`（帧计时）有 30/313 处 ⇒ 循环只跑输入/文本，不会重画背景。整批清掉 ⇒ 读档后背景就再也回不来。

### 引擎那边到底靠什么把画面重建起来
`sub_40F750(3)` 装载 rec[cur] 的脚本时，`sub_40ED40` 把帧 ip 设成**脚本入口**（raw 18847：`95782 = 95781`），
即读档后**场景脚本从 dword 0 重跑一遍**：先跑 init（重画背景/角色、并调用 `i259` 落掉上一场的绘制记录），
再走到入口那条 `i0ae` 把 ip 落到存档位置。⇒ 「界面残留」与「背景不重画」是**同一个原因**：emulator 此前
本工程槽**直接落 ip**、跳过了 init。

### 改动
- `src/vm/handlers/save-slot.ts`（本工程状态块那条路）：不再直接摆 `cur`/`ip`，改成
  ① 每个存档帧按 scriptId 装到**入口**（`loadScriptIntoFrame` ⇒ ip = 0）并还原 `retStack`/`caller`；
  ② 落点（存档时那条**指令下标**）放进 `Engine.saveResume`；
  ③ `cur = 0` + `loadInProgress = 1` + `transferredTo = 0`（帧 0 从入口跑）。
  存档侧相应改为**连空帧一起写** `0..storedCur`（续跑要连续格）。
- `src/vm/engineSlot.ts`：`EngineSlotFrame` 增加 `instr?: number`（本工程槽的**直接落点**）与
  `retStack?: number[]`（本工程槽的返回栈就是 emulator 口径）。
- `src/vm/handlers/frame.ts`（`0xAE`）：① `instr` 存在 ⇒ 直落（不查表、不前进）；② 走栈时**跳过空帧**
  （`scriptId = -1`）；③ 本工程槽不要求 `set:SaveVersion1/2` 匹配（那套只管引擎的表下标槽位）；
  ④ 收尾时把 `0x1AD`(storedCur) 跟进到续档帧。
- `src/renderer/scene/ops.ts`：`0x259` 的语义纠正 —— 它清的是**绘制记录账本**（`scene.drawItems` + 窗口文本，
  引擎那两张 1000×2 组 5 dword 表里字段 0 就是图像的统一文件 id，读档按它重载图像，raw 19878-19893），
  **保留**网格（那是 `0x32B` 的表）与纹理对象（引擎：只清记录、不 delete 对象）⇒ 新增 `scClearSlotRecords`。
- `src/renderer/{pixiBackend,headlessScene}.ts`：`clearSlotRecords()` 调它（并清「槽→imgid」记录）、
  `clearMeshSlots()` 清网格 ⇒ 控制面板里那两条"忽略"消失。
- 两条读档路**不再**请求 `clearDrawContainer`（第 1 次变更的那两行已撤回；面板/文本复位保留）。

### 判据
- `test/slot-save-resume.test.ts`：本工程槽续档 ⇒ `cur=0` + 帧 0 在入口 + `saveResume.frames[0].instr = 1`
  + 入口 `i0ae` 执行后落在 ip=1、门清、记录清；`0x259` 那条断言宿主真的清掉 `drawItems` 且保留 `meshes`。
- `test/save-slot.test.ts` 的往返断言改为"入队 + 帧 0 在入口"（落点在 `0xAE` 时生效）。
- `npm run verify`：typecheck ×3 / 633 测试 631 pass 0 fail 1 skip / 死写 0。
