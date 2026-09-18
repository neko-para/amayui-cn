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

## 2026-09-18

## 第 3 次变更（2026-09）——★读档后"回到标题界面"的真因：画面没被装回去

用户实测（第 2 次变更之后）：缩略图正常了，但**读档后回到标题界面**（点击还能推进 ADV ⇒ 流程其实续上了）。

### 定位（真语料实测，逐条）
1. **续跑本身是对的**：加载用户那份 `SAVE70.DAT`（`cur=2` = `SN0000`，帧 0/1/2 = SYSTEM4/NOVEL/SN0000）
   后，`0xAE` 走栈到 `cur=2`、门清、`SN0000` 的 ip 在推进（= 点击能推进 ADV）。
2. **画面是空的**：headless 复现里 `drawItems=0` 从读档一直到最后。GUI 有"留帧"机制
   （`pixiBackend` 的 `HOLD_MAX_FRAMES`）⇒ 屏上继续显示上一屏 = 玩家看到的"标题界面"。
3. **为什么空**：ADV 的背景/立绘是**一次性**画的，而每帧的落点都在那些绘制**之后**。实测 `NOVEL.BIN`：

   | 指令 | 内容 |
   |---|---|
   | 21 | `i0ae`（落点入口） |
   | 39 | `set-texture …` |
   | **43** | **`draw-texture 186a0 …`（= 背景）** |
   | 123 | `call-script <场景>`（把控制交给 SN0000） |
   | **124** | **帧 1 的存档落点** ⇒ 43 那一笔被跳过 |

   `SN0000.BIN` 从入口到主循环（`label_000037f0` 的 `i0ae`）之间**一处 `draw-texture` 都没有**。
4. **引擎靠什么**：存档里带**绘制/槽记录**（`_this[81174]`/`[86174]` 的 1000×2 组 5 dword 表 = 20000 字节），
   读档按它 `sub_4559C0` + `sub_4A3800` 把图像装回槽、并把画面重放出来（raw 19843-19910）。

### 改动
- `src/renderer/scene/present.ts`（新）：与宿主无关的**呈现态快照** `scSnapshotPresent` /
  `scRestorePresent`（`drawItems`/`meshes`/`msgWins`/`msgRanges`/`slotText`/`slotModes`；深拷贝 + 先清后装 +
  `msgRev` 递增 ⇒ 文本重新光栅化）。
- `NativeBridge` 新增两个缝 `snapshotPresent` / `restorePresent`（`nativeTap` 允许清单同步），
  Pixi 与 headless 两宿主都实现（都调上面那份共享函数 ⇒ 不会各写一份）。
- `SlotStateBlock` 新增 `texSlots`（槽号 → 统一文件 id）与 `present`（快照）；
  `saveSlotFromEngine` 写它们，`loadSlotIntoEngine` 读档时**先还原 `texSlots` + 逐条 `bindTexture`、
  再 `restorePresent`**（在续跑脚本继续跑之前；模型以 handle 为键 ⇒ 脚本重画是覆盖而不是叠加）。
- ★**撤回上一轮把 `0x259` 实现成"清绘制项"的做法**：读 `sub_41A3A0` 的完整体后确认它只是把两张槽表每条
  的 `[0]/[1]` 清 0（`*(result-5000)=0; *result=0; *(result-4999)=0; result[1]=0;` 步长 5 × 1000）⇒
  清的是**槽记录**（"槽 → 统一文件 id"），不碰绘制项。每个 ADV 场景开头都会调它（517 处），
  实现成清 `drawItems` 会**在每个场景开头把画面清掉** —— 这正是"读档后什么都不剩"的一部分成因。

### 判据
- 新守卫：`test/slot-save-resume.test.ts` 的"呈现态快照"一条 —— 存档方摆 2 个绘制项 + 1 个消息窗 +
  槽模式 + `texSlots`，**换一套干净的引擎/宿主**读回来，逐项断言都在；`0x259` 那条改成断言
  "只丢槽记录、绘制项与网格不受影响"。
- typecheck ×3 / 全测试 / 死写检查见 changes 末尾（`npm run verify`）。
- 仍需 GUI 目视：重新存一次档（旧档没有快照段）后读档 ⇒ 应直接看到 ADV 画面。

## 2026-09-18

## 第 4 次变更（2026-09）——★把 **VM 侧的 ADV 状态**也带走（侧边栏/遮罩/背景动/首句文字）

用户实测（第 3 次变更之后）：缩略图正常、续跑到 ADV 了，但

1. 存档时**存档页闪掉一瞬间**（露出 ADV 画面）；
2. 读档后**中心没有 ADV 文字**（点一下才出现）；**背景不再移动**；**ADV 窗的遮罩没了**；**侧边栏无法 hover 展开**。

### 归因
第 3 次变更只把**宿主模型**（`drawItems`/`mesh`/`msgWins`/`slotModes`…）装了回去，而读档流程还会：
`routes.reset()` + `msgwin.reset()` + `msgWinClearAll()`（为清掉旧 UI），并且**帧从入口重跑**到落点 ——
入口→落点之间那段初始化**会重跑**，但"存档当时已有、且不由那段代码重建"的 VM 侧状态**不会自己回来**：

| 症状 | 丢的是 |
|---|---|
| 侧边栏无法 hover | `RoutePanel.entries`（热点区）—— 被 `routes.reset()` 清掉、没有别处重建 |
| ADV 窗遮罩/窗口态不对 | `MsgWindow` 的标量态（`showing`/`flags`/`skipMode`…）+ 文本项账本 `textItems.records` |
| 背景不再移动 | 阶梯动画时间表 `StageLoop`（`entries/cursor/index/t0/exitLabel`…） |
| 面板/淡入等开关位 | `engineValues` 里那些引擎字段（`panelShown` 等）被复位 |
| 中心没有首句文字 | 本工程槽的落点是"循环里当时那条指令"（不是消息）⇒ 存档当时那句话不会被重放 |

引擎那边这些是**读档流程自己搬回去**的（`sub_410160` 装载段搬 40 B 窗口态、复位两张面板、`sub_45F1B0` 额外块…），
且它的帧记录里那一格就是 **`0x71`（消息）表下标** ⇒ 读档会**重放存档当时那句话**。

### 改动
- 新增 `src/vm/advState.ts`：`snapshotAdvState(e)` / `restoreAdvState(e, s)` —— 搬 5 样：
  `engineValues`（除读档流程自用的 `cur/callRet/读档门/收尾标志` 四格）、`routes.entries`、
  `MsgWindow` 的标量字段、`textItems.records`、`StageLoop`（表 + 游标/起点/打断 label…）。
- `SlotStateBlock.adv` 存它；读档时在"清空之后、续跑脚本继续之前"装回。
- `Frame.lastMsgIp`：`0x71`（message-show）处记录本帧最后一次"开始消息"的指令下标；
  `SlotFrameState.lastMsgIp` 随档保存；**末帧的读档落点优先用它** ⇒ 重放存档当时那句话（引擎同语义）。

### 判据
- `test/slot-save-resume.test.ts` 的呈现态快照一条扩到 VM 侧：热点区/阶梯动画表/文本项账本/
  消息窗标量态/引擎字段在"换一套干净引擎"后逐项回来；并断言末帧落点 = `lastMsgIp`。
- typecheck ×3 / 634 测试 633 pass 0 fail 1 skip / 死写 0。

### 关于"存档页闪一下"
脚本侧本来就要求"把当前画面渲进离屏槽"（`i20d 2` → `i20e` → `i20c` → `i032` → `i1ae`），
而列表那层若在存档子程序之前已被自己清掉（列表脚本退出路径的清屏），屏上就会短暂露出 ADV ——
真机的缩略图同样是"没有列表的干净场景"（`SAVE00.STH` 实测）。若真机闪得没这么明显，
差异点在"我们把 `i20c` 的合成**同步**做了"（引擎的帧刷新也是同步的），可以再调。

## 2026-09-18

## 第 5 次变更（收尾）：用户实测通过 + BGM 拆票

用户 2026-09-19 实测：读档后**中心立刻有文字、背景会动、ADV 遮罩在、侧边栏 hover 正常** —— 第 4 次变更的
\dv\ 快照 + \lastMsgIp\ 重放达成了四条症状的修复 ⇒ 本票收尾（守卫 \	est/slot-save-resume.test.ts\）。

同一次实测又暴露一条**不属于本票**的缺口：**读档后该场景的 BGM 丢失**（SAVE.txt 的 \i0b8\ 停播 + 续跑跳过场景的
\play-bgm\ + emulator 跳过 \CALLBACK_LOAD\ 的 \i0b7 0\）⇒ 另开 \T-0064\（音乐运行态 + 读档重播），
本票的 \SLOT_GAPS ⑥\（跳过 CALLBACK_LOAD 那一跳）随之收窄为
