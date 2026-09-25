# T-0175 · F 波单元：本票剩余 acceptance 项的逐条处置（单元 = `changes-f.md`）

> 范围：`tickets/T-0175/ticket.json` 的 **15 条 acceptance** 全覆盖（含"收尾三连"与 ①–⑬）。
> 本轮只做**落在我文件范围内**的条目；范围外的（① / ⑬ 归 `T-0169`、② 归 `T-0019`、⑩ 需越界改动）**如实登记并写重开条件**。
> 权威 = `engine/天结_unpacked.exe_utf8.c`（只读）+ 当前工作树代码。所有代码行号都是**改后**的行号（本文件写完时的工作树）。
> ★**本文件由本单元独占**；`analysis/**`、`CONTEXT.md`、`docs-new/**`、`tickets/*/ticket.json` 一个字节都没动。

---

## §1 逐条处置表（15 条）

图例：**[本轮做掉]** = 带命名守卫 + 红→绿；**[已落地]** = 引当前代码行核实；**[不做/登记]** = 写 why + 重开条件；**[别人的]** = 有归属，本单元不动。

| # | 条目（票面） | 处置 | 当前代码行 / 证据 |
|---|---|---|---|
| 1 | 逐条核实现状并给出处置，不得留空 | ✅ **本条即本文档** | 15 条全覆盖（本表 + §2/§4） |
| 2 | ① `scriptEngineFlag` 初值/复位值 = 1、`engine.ts:793` 注释键名、cancel-message 三态机极性 | **[别人的]** —— 归 `T-0169`（`src/vm/engine.ts` 与 `src/frame/**` 是本轮硬边界） | 出处 `tickets/T-0161/changes-c161.md` §5 表第 1 行（raw 22591 / 17961 / 20119-20126）；本单元未动 `engine.ts` |
| 3 | ② 消息窗行**淡入色窗接线** | **[别人的]** —— 归 `T-0019`（`src/vm/handlers/msgwin.ts` + `src/vm/msgwin.ts` 是本轮硬边界；`renderer/drawitem/animWindow.ts` 半边本轮无主） | 出处 `T-0161` §5 表第 2 行（raw 72336-72348：`MessageSpeed*MessageFade/100` 整数除法 + 两字段 >0 才建窗）。★本轮的 `T-0019` 拆分单元**已回滚**（主 agent 通报：半成品归档到 `.tmp/t0019-split-wip/`，`handlers/msgwin.ts` + `vm/msgwin.ts` 回到 HEAD 原状）⇒ ② 仍然悬空 |
| 4 | ③ 宿主媒体/触摸/呈现缝：`confirmSlotOverwrite`/`slotWriteFailed` 进桥、`0x25b` 媒体缝、`setTextureObjectParam` **拆缝** | **部分做掉**：<br>· `confirmSlotOverwrite`/`slotWriteFailed` **已进桥**（`BRIDGE_METHODS` + `WHY` 文案）<br>· `setTextureObjectParam` **已拆**成 `setTextureObjectColor` + `setTextureObjectSubParam`，生产路径改调新名（旧名保留 + 显式回退），**两条既有守卫已按新名 retarget**（`test/op-a2-a3.test.ts`、`test/op-15xx-gfx-texture-vm.test.ts`）<br>· `0x25b` 图像加载 + `0x25a` 的 `sub_4A5470` 下发 **如实登记为不做**（见 §4-③） | 见 §1.1 的三条子项 |
| 5 | ④ `copySaveSlot` 源槽只有 `.STH` 时漏复制 `.DAT` | ✅ **[已落地]**（票面前提**已被取代**，`T-0159` §4.2 已过期） | `src/arch/nodeFileSource.ts:246-252`：两条**独立**写（`if (d) await this.writeSaveSlot(to, d);` 与 `if (t) await this.writeSlotThumb(to, t);`）⇒ 源槽只有 `.STH` 时仍然写 thumb |
| 6 | ⑤ `textureCache.setSlotPixels` 静默忽略；「换尺寸/释放 ⇒ 旧纹理入 `DestroyQueue`」**不可测** | ✅ **[本轮两条都做掉]**（后半 = 可测性；**前半 = 返回值语义**，原先判"不做"后改判做掉 —— 见 §1.2 的 a2） | 见 §1.2 |
| 7 | ⑥ `src/live2d/**` 实例 `+16` EyeBlinkMotion 与 `+23` 眨眼门控未建模 | ✅ **[已落地]**（由 `T-0166` 第 3 批做掉） | `src/live2d/blink.ts`（新，214 行，`blinkStep`/`BLINK_DEFAULTS`/`BLINK_FIELDS`）；`src/live2d/mtn.ts:251`（`blink: BlinkMotion`）、`:263` / `:286`（`blinkEnabled`，**缺省 false**）；`src/live2d/runtime.ts:754-759`（`l2dBlinkTick` 第一句 `if (!inst.blinkEnabled \|\| !inst.model) return null;`）、`:725`（`l2dAdvance` 里调用）。★**门恒 0 是引擎的真实行为**（构造清 0 + 全库 0 写者，见 `tickets/T-0166/changes-c166-blink.md` §2）⇒ `src/live2d/` 里 blink 符号齐备，判据两条都成立 |
| 8 | ⑦ `session.#awaitTextureBound` 可观测 + 四路同键次序可测 | ✅ **[本轮做掉]** | 见 §1.3 |
| 9 | ⑧ `src/live2d/assetLoader.ts:142` 的 `0x345` 失败支也抛错 | ✅ **[已落地]**（由 `T-0178` 做掉） | `src/live2d/assetLoader.ts:140-162` 的 `bindTextureToSlot`：**只有"文件取不到"**（`if (!bytes)`，`:150`）才 `onFail?.({...})`（`:153-157`）；槽空/解码失败不抛（`:160` 直接 `l2dBindTexture` 返回 true）。守卫 `test/l2d-texture-load-failure.test.ts`（3 例） |
| 10 | ⑨ `presenter.ts:291` 把 `mulColor` 当 tint 下发（字节序无真机对照） | ✅ **[不做/登记 + 就地写清重开条件]** | 见 §1.4 |
| 11 | ⑩ `0x137` / `0x30a` 的越界诊断（引擎写错误缓冲 + `sub_4034D0` 非致命上报） | **[不做/登记]** | 见 §4-⑩（需先给 `operandPlan.ts` 声明计划 + 把 `test/opcode-operands.test.ts:51/55` 那两条从白名单迁出 —— 该测试文件**不属本单元文件范围**） |
| 12 | ⑪ 注释漂移：`test/engine-field-store.test.ts:112-113` 与 `test/ptr.test.ts:110-113` | ✅ **[已落地]**（两处**在本轮开工前就已经与体一致**，见 §1.5） | ① `test/engine-field-store.test.ts:112-114`：已写"消费端**已落地**（`armCoexistAutoMessage` + `#autoMessageInterval`，`T-0151` 落 + `T-0161` 加生产读者棘轮）；仍未建模的是**第二个计算点** raw 20416-20426"；② `test/ptr.test.ts:110-114`：`ptr0 = op1 = src`、`ptr1 = op2 = dest`（**方向正确**），本轮**补了一句**明写这件事 + 引方向守卫 |
| 13 | ⑫ `toFullWidth` 两份实现去重 | ✅ **[已落地]** | `src/vm/operand.ts:183` 的 `export function toFullWidthAscii`；唯一再导出处在 **`src/vm/handlers/msgwin.ts:2391`** 的 `import { toFullWidthAscii as toFullWidth } from '../operand.js'`（说明注释在 `:2388-2390` 写明"两份实现一旦漂移…本地别名保留 `toFullWidth` 以免动调用点"）。★`msgwin.ts` 里本地副本已删（`toFullWidth` 只作为 import 别名出现），`:2329` 是唯一调用点 |
| 14 | 收尾三连：`build-tickets.mjs` + `tickets.js --validate` + `ticket-ledger.test.ts` | ✅ **绿** | ① `tickets.js --validate` = **✅ 176 张 / 0 条 ✗ / 15 条行号漂移警告**（本单元修掉了一条**真**硬错：`T-0086 evidence[1]` 的锚点被我拆缝吃掉 ⇒ 已按纪律**改指不删**为 `emitTextureColor(c.native, slot, normalizeTextureColor(color));`，见 §3-4）；② `test/ticket-ledger.test.ts` = **绿**（6/6）；③ `build-tickets.mjs`：本单元**不改任何票面 status/acceptance**，看板不受影响 ⇒ 不需要重建（若主 agent 想统一刷一遍，跑它也是幂等的） |
| 15 | ⑬ `_this[107678]` 的两条主循环写者未落 | **[别人的]** —— 归 `T-0169`（`src/vm/engine.ts` + `src/frame/**`） | 出处 `tickets/T-0157/changes-frame.md` §4「别人该接」#1 与 `analysis/opcode-gaps.json` 的 `0x7c`（opcode 124）`missing[2]`；emulator 只落了 `#cancelRoute()`（`engine.ts:1338`） |

### §1.1 ③ 的三条子项

**(a) `confirmSlotOverwrite` / `slotWriteFailed` 进桥 —— 做掉（声明面那一半）。**

- `src/vm/native.ts`：`NativeBridge` 新增两个可选方法（带 raw 依据的长注释）——
  `confirmSlotOverwrite?(slot: number): boolean`（引擎 `sub_42D980` raw 38309-38313，
  `MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 = 0x34`；返回 `false` = `IDNO = 7` ⇒ 调用方 `op1 = 1` 且原文件不动）
  与 `slotWriteFailed?(slot: number, message: string): void`（`sub_40A4C0` raw 38320）。
  注释里写明**引擎默认按钮是「否」** ⇒ "无对话框时继续写"是**反向**退化。
- `src/vm/nativeTap.ts`：`BRIDGE_METHODS` 加 `'confirmSlotOverwrite'` / `'slotWriteFailed'`，
  `WHY` 表加对应两条文案（"不实现 ⇒ 恒按玩家点了是 / 只剩一条日志"）。
- **为什么两个真宿主都不实现（这一半刻意不做）**：`test/native-tap.test.ts` 的两张表
  （`DECLARED_HOST_DIVERGENCE` 与 `NON_BRIDGE`）要求"宿主新增桥方法 ⇒ 同步登记"，
  而该测试文件**不属本单元文件范围**。只给一个宿主实现会让 `DECLARED_HOST_DIVERGENCE` 立刻红；
  两宿主都实现 `slotWriteFailed`（都能 log）但 `confirmSlotOverwrite` 只有 Pixi 有对话框
  ⇒ 仍是非对称。⇒ **保持两宿主对称（都不实现）**：行为与修前**逐字相同**，
  但这次缺口进闸门 A 可数（修前 `?.` 是真静默）—— 这正是 `T-0159` §4.1 要的那一步的**可观测前提**。
  ★**真正落地宿主实现的前置条件**：把 `test/native-tap.test.ts` 的 `DECLARED_HOST_DIVERGENCE`
  加 `'confirmSlotOverwrite'`（并在注释里写明"headless 无对话框 ⇒ 恒按是"）。见 §4-③。
- 守卫：`test/native-seams-t0175.test.ts`（4 例）—— ① 四条缝在 `BRIDGE_METHODS` 里；
  ② 生产路径调新名；③ 宿主不实现 ⇒ 不抛 + **进缺口清单**（并断言 `confirmSlotOverwrite?.(3) !== false`，
  即"没缝时不许假装玩家点了否"）；④ 两宿主都不实现这四条（对称 ⇒ 不动差异表）。

**(b) `setTextureObjectParam` 拆缝 —— 做掉。**

- 症状（`T-0163` §7-1）：一条缝两种语义 —— `0x246` 写 CTexture **子对象**的 `vtable+56`
  （`obj+1044`，raw 32696-32697 的 **÷100**）而 `0x1F9`/`0x249` 写**颜色**（`Scene[5*slot+467]`，
  raw 32750-32757 的 ARGB）。宿主拿到同一个 `(slot, value)` **不可能分辨**。
- 拆法：`src/vm/native.ts` 新增
  `setTextureObjectColor?(slot: number, argb: number): void`（颜色，入参已归一化）与
  `setTextureObjectSubParam?(slot: number, value: number): void`（子对象参数，入参已 ÷100）；
  旧名 `setTextureObjectParam?` **保留**并标 `@deprecated`（写明"新代码请用拆开的两个"）。
- 生产路径：`src/vm/handlers/gfx-texture.ts` 新增局部 `emitTextureColor()`（新名优先、
  没有则**显式**回退旧名 —— 单次调用，不是双写）；`0x246` 的 handler 改调 `setTextureObjectSubParam`。
  两处颜色（`0x1F9` 的 bindTexture 路径 + `0x249`）都改走 `emitTextureColor`。
- 守卫：同上 `test/native-seams-t0175.test.ts` 的 ② 与 ④（含 `doesNotMatch` 反例：颜色不许再直连旧名）。
- ⚠️ 与出处**不符**的一处：`T-0163` §5 把 `0x1F9` 也算成 `setTextureObjectParam` 的消费者 ——
  **在 `0x1F9` handler 里确实有**（`src/vm/handlers/gfx-texture.ts:322` 改前），所以 §5 没错；
  但 `T-0163` §7-1 把 `0x1F9` 写成唯一颜色消费者、漏了 `0x249`（`gfx-texture.ts:115`）。
  ⇒ 拆缝必须**两处都改**，只改 `0x249` 会留下一条颜色直连旧名（本单元的 `doesNotMatch` 守卫就是钉这个）。

**(c) `0x25b` 的图像加载 + `0x25a` 的 `sub_4A5470` 下发 —— 不做（登记）。** 见 §4-③。

### §1.2 ⑤（`textureCache`）

**后半（可测性）—— 本轮做掉。**

- 判据（票面）：`create(slot, 新尺寸) ⇒ pendingDestroyCount === 1`；同尺寸复用 ⇒ 不增。
- 修前的死角的**准确形状**：`decideCreateTexture`（`src/renderer/pixi/textureCache.ts:113-136`）
  **已经**把三态决策抽成纯函数（这一步是更早的单元做的），但它只覆盖**决策**；
  "`#pendingDestroy.push(old.tex)` 那一行真的会走到"这段**接线**仍然只在有 DOM 时可达
  （建画布要 `document.createElement`）⇒ Node 里 `#canvasSlots` 恒空、`decision` 恒 `fresh`。
- 本轮补的：`TextureCache` 构造函数加**第三个可选参数** `canvasFactory?: CanvasFactory`
  （`textureCache.ts:104-136` 的接口 + `:191` 起的构造 + `#hasCanvasFactory()`），
  建画布那一步从"硬编码 `document.createElement`"改成"工厂优先、无工厂才 DOM"
  （`textureCache.ts` 的 `create()` 里 `this.#hasCanvasFactory() && w > 0 && h > 0` 那一段）。
  ★**生产行为逐字不变**：`PixiBackend` 不传这个参数 ⇒ `hasDom` 仍由 `typeof document !== 'undefined'` 推出
  （守卫第 4 例专门钉这条：不注入 ⇒ 不建槽、不入队、不抛）。
- 守卫：`test/texture-destroy-wiring.test.ts`（**6 例**，T0，无 DOM 依赖）——
  ① 换尺寸 ⇒ `pendingDestroyCount === 1` 且 `collectGarbage()` 销毁的是**旧**那张；
  ② 同尺寸 ⇒ 复用（画布数不增）+ 队列不增；③ `release` ⇒ 入队 + flush 幂等；④ 不注入 ⇒ 与修前逐字相同；
  ⑤⑥ 前半：`setSlotPixels` 的三态 + `undefined`/`false` 不许混。
- **红→绿**：把 `this.#pendingDestroy.push(old!.tex);` 注释掉 ⇒ 该文件 **4/6 红**（①②）；
  恢复 ⇒ **6/6 绿**。

**前半（`setSlotPixels` 返 `void` ⇒ handler 无条件 `op1 = 0`）—— ★改判：本轮也做掉（a2）。**
- 修前：`setSlotPixels` 返回 `void`，槽没有画布时 `log` 后 `return`；`handlers/save-slot.ts` 的 `0x1AF`
  在 `c.native.setSlotPixels?.(...)` 之后**无条件**写 `op1 = 0` ⇒「脚本拿到成功、画面却空」。
  引擎在同情形下 `sub_40BF20`/`sub_49E9D0` 已经失败 ⇒ 结果码应走 **2**（raw 38584-38592 的 `v7 = 0` 那档）。
- **我原来判"不做"的理由（跨宿主语义决定）已被一条更细的读体推翻**：
  - headless 侧**不需要**编一个"记录即成功"的宽容答案 —— 它自己就有"该槽有没有表面"的真答案：
    `proceduralSlots`（`0x1F8` create-texture 建的）∪ `slotImgid`（已绑定文件图像的）；
  - headless 的 `note(...)` 无条件记（观测面照旧），只是**返回值**回答真实存在性
    ⇒ 两条宿主**同口径**（"该槽的 surface 在不在"），差异表一个字都不用动
    （`setSlotPixels` 本来就是桥方法、两宿主都实现）。
- 落点：`src/vm/native.ts` 的签名 `setSlotPixels?(...): boolean | void`（注释写明三态语义）；
  `renderer/pixi/textureCache.ts` 返回 `boolean`（无画布/无 ctx ⇒ `false`）；
  `renderer/headlessScene.ts` 返回 `hadSurface`；
  `handlers/save-slot.ts` 的 `op_slot_thumb_read`：`landed === false` ⇒ `op1 = 2` + 一条 `log`
  （`undefined`（宿主不实现该缝）⇒ **保持旧行为写 0**，不许把"没有缝"误判成"解入失败"）。
- 守卫：`test/texture-destroy-wiring.test.ts` 的两条新用例 —— ① `setSlotPixels` 三态
  （没表面 `false` / 建过 `true` / 释放后 `false`）；② `undefined` 与 `false` **不许混**
  （前者保持旧行为、后者写 2）。
- ★**仍未做**：`0x1AF` 的"第二格式（`BM` 不符 ⇒ `+8 ∈ {1,2} 且 +12 == 0`）解入"（`T-0159` §4.4，
  属 D3D 路，本机 `set:DrawMode = 0` ⇒ 不可见）—— 那条仍在 `SLOT_GAPS`，与本条无关。

### §1.3 ⑦（屏障②可观测 + 四路同键次序）

**(a) 让 `0x1F9` 之后的 `#awaitTextureBound` 可观测 —— 本轮做掉。**

- 修前的三重不可见：`DebugQuery` 问不到；trace 里没有逐次证据
  （`PixiBackend.#barriers` **只在真的等到图时**才 +1，`pendingCount === 0` 直接 return）；
  唯一守卫 `test/no-boot-preload.test.ts:98-105` 是**源文本匹配**（找 `texturesIdle` 与 `present(` 的先后）。
- 新增 `src/renderer/app/textureBarrier.ts`（**纯函数模块**，无副作用）：
  - `TEXTURE_BARRIER_OPS = [0x1f9, 0x249]`（`0x249` 是 `T-0102` 轮 9 的 emulator 侧补充）；
  - `shouldAwaitTextureBarrier(opcode)`；
  - `observeTextureBarrier(opcode, slot, awaitSeam)` → `{ triggered, hostSeam, awaited, trace, note }`：
    **过门才调缝**、**没缝不抛不 await 但留一条痕**、trace 行带 opcode 与槽号。
- `src/renderer/app/session.ts`：
  - `#awaitTextureBound` 改成调 `observeTextureBarrier(...)`（**删掉旧的内联 opcode 集合**，
    判据从此只有一份）；过门时 `#texBarrier.calls++`、真 await 时 `#texBarrier.awaits++`、
    把 `trace` 行写进 trace（"没缝"那条按一次性去重，避免刷屏）；
  - `#texBarrier` 账经 `runQuery` 的**新 `barrier` 命令**对外可见（`barrier: () => …`），
    文案里同时给 `hostWaits`（宿主真的等到图的次数，经**已登记**的 `digestHostCounters()` 读出 ——
    **不新开宿主方法**，因为 `PixiBackend` 的公开面每加一个都要登记进 native-tap 的非桥清单）。
- `src/vm/debugQuery.ts`：`DebugQueryHost` 加可选 `barrier?: () => string`；`runQuery` 加 `case 'barrier'`；
  帮助文本两处（文件头命令集 + `DEBUG_QUERY_HELP`）同步。
- 守卫：`test/texture-barrier-observable.test.ts`（4 例，T0）——
  ① 派发一次 `0x1F9` ⇒ 缝**恰好调 1 次**、返回的 promise 真的被 await（`setTimeout` 闸门证明"await 前没放行"）；
  ② 同族门（`0x249` 过、`0x1f8/0x1fa/0x1fb/0x208/0x24a/0x0/0x6e` 不过，且不过门时**缝一次都不碰**）；
  ③ 没缝 ⇒ 不抛、`awaited === undefined`、留痕（并断言与修前的 no-op 逐字等价）；
  ④ 源棘轮（session 走 `observeTextureBarrier`、`barrier:` 注入在、旧的内联 opcode 集合**必须已消失**）。

**(b) 四路同键次序用例 —— 本轮做掉。**

- 新增 `test/presenter-merge-order.test.ts`（4 例，T0）：
  - **同键**（图元 / 文本 / mesh / L2D 节点共用一个归并键）⇒ 可见次序 = `item → text → mesh → l2d`；
  - **不同键**（键序与路序故意错开：L2D 100 / 文本 200 / mesh 300 / 图元 400）⇒ 次序 = `l2d, text, mesh, item`；
  - 反向自检两条（L2D 键改到最大 ⇒ 次序随之改变；`item,mesh,text,l2d` 与观测值可区分）。
  - L2D 批次由**合成模型**产生（`l2dLoadModel` 只填三个 `Map`，不读资源 ⇒ **T0 成立**，无需 `NodeFileSource`）。
  - ★本文件**不 import `Engine`**：`Engine → ops → handlers/**` 会把整条 VM 装配链拉进测试，
    而这个链此刻正被并行单元重构（见 §2 的树级阻塞）—— 那是"在测别人的模块图"。
- **红→绿（变异证明）**：把 `presenter.ts` 里四路的 `order` 整体反转（`0→3, 1→2, 2→1, 3→0`）
  ⇒ 该文件 **2/4 红**（两条正向次序断言红，两条反向自检仍绿）；写回 ⇒ **4/4 绿**。
  这就是票面要的"反转 `order` 必红"。

### §1.4 ⑨（`mulColor` 当 tint）—— 不做（登记 + 就地写清重开条件）

- **出处说 → 代码里是**：`tickets/T-0160/changes-live2d.md` §4 写「Pixi 合成端把 `mulColor` 当 tint」+
  「`presenter.ts:291-357`（`drawL2d`，目前不读 `b.mulColor`）」。
  **代码里其实是**：`presenter.ts` **一个字节都没读 `mulColor`**（全仓 `mulColor` 只有
  `src/live2d/{runtime,render,mtn}.ts` 三处）。⇒ 所以**不存在**"字节序下发错了"这个可见缺陷，
  真正的事实是"**这个量没有渲染消费者**"。
- 数据面已就绪：`src/live2d/runtime.ts:405-408` 的 `decodeL2dMulColor`
  （`[BYTE2,BYTE1,BYTE0]/255`，依据 = `sub_4BD150` 的**实参序** raw 34813-34818 —— 不是 RGBA 顺序的猜测）；
  `src/live2d/render.ts:227-228` 把三分量塞进批次（`mulColor`）。
- 为什么不直接映射成 Pixi `tint`：引擎那条链经 `sub_4BD3E0` 进 **SDK 的纹理混合**
  （`*(1-a4)*现价 + a4*目标`，raw 143791-143801），而 Pixi 的等价物只有逐通道乘法的 `tint`
  （不含 SDK 那层插值/预乘语义）⇒ 直接映射会引入**没有真机对照**的可见色差。
  这正是 `T-0160` §4 说的"做错是**新引入的可见错**"。
- **重开条件（任一条成立就该做）**：① 拿到真机对照（同 id 的 L2D 部件在真机截图与
  `mulColor` 解码值能对上 ⇒ 定死 R/G/B 落位）；② 语料里出现**非恒等**乘色且差异可被 E4 截图复现
  （那时"不下发"本身成了可见缺陷，两害相权取有对照的那个）。
- 落点：`src/renderer/pixi/presenter.ts` 的 `l2dBatchList` 定义之前（`:285-303` 的长注释），
  就地写清"前提已过期 / 数据面就绪 / 为什么不下发 / 两条重开条件 / 现状不算静默"。
- 现状**不算静默**：字段在模型与快照里都可见；缺口应登记在 `analysis/opcode-gaps.json` 的 `0x34f` 条目
  （台账待应用见 §3）。

### §1.5 ⑪（两处注释）

- `test/engine-field-store.test.ts:112-114`：票面说"注释仍写「消费端尚未实现 ⇒ 见 T-0076」"。
  **实际不是**：该行已经是「★消费端**已落地**（`armCoexistAutoMessage` + `#autoMessageInterval`，
  `tickets/T-0151` 落 + `tickets/T-0161` 加"生产读者棘轮"）；仍未建模的是**第二个计算点**
  raw 20416-20426（被 `Engine[122501]` 门控、「行数 − 基准」**不减 1**）⇒ 见 `tickets/T-0161` / `T-0175`」
  ⇒ **本轮零改动**（票面前提已被更早的单元取代）。
- `test/ptr.test.ts:110-114`：票面（`T-0162` §6-5）说注释把 `ptr0` 写成 dest、`ptr1` 写成 src。
  **实际方向是对的**（`ptr0 = &global.int[10]` 标着"**源 op1**"、`ptr1` 标着"**目标 op2**"，
  与体 `memcpy(dest = addr(op2), src = addr(op1))` 一致；断言用同一地址 ⇒ 两种口径都成立）。
  ⇒ 本轮**只加一句**把这件事写死（"本行与体一致；方向写反过一版"）+ 引方向守卫
  `test/operand-memcpy-direction.test.ts`（该文件存在）。
- 纪律：动手前后各跑一次锚点工具。`tickets.js --anchors-in test/engine-field-store.test.ts`
  = **（无）0 条**；`--anchors-in test/ptr.test.ts` = **（无）0 条** ⇒ 两个文件都没有票面锚点，
  改注释不会打红锚点棘轮（`--validate` 的 16 条红与本单元无关，见 §2）。

---

## §2 红 → 绿数字（本单元）

| 项 | 改前 | 改后 | 说明 |
|---|---|---|---|
| `test/texture-destroy-wiring.test.ts`（新） | **4/6 红**（注释掉 `#pendingDestroy.push` 的那次变异） | **6/6 绿** | 红→绿证据（⑤ 两条） |
| `test/presenter-merge-order.test.ts`（新） | **2/4 红**（`order` 整体反转的变异） | **4/4 绿** | 红→绿证据（⑦b） |
| `test/texture-barrier-observable.test.ts`（新） | — | **4/4 绿** | 新增判据（⑦a），4 例均在本轮首次通过 |
| `test/native-seams-t0175.test.ts`（新） | — | **4/4 绿** | 新增判据（③） |
| `test/native-tap.test.ts`（既有守卫） | — | **6/6 绿** | 桥声明面 + 两宿主差异表**都没被破坏**（这是 ③ 能安全落地的前提） |
| `test/op-a2-a3.test.ts`（既有守卫，**retarget**） | **10/11**（拆缝后录制端收不到 `0x246` 的载荷） | **11/11 绿** | 只改标签（`param`→`color` / `subparam`）+ 注释；**断言一条没删、还多了"旧名 0 次"** |
| `test/op-15xx-gfx-texture-vm.test.ts`（既有守卫，**retarget**） | **8/10**（两条 `0x246` 用例挂在旧名上） | **10/10 绿** | 录制端拆成 `param`/`color` 两表 + 新增"旧名不许被调"断言 |
| `test/save-slot-chain.test.ts` / `test/save-slot-thumb.test.ts`（既有守卫，**探针透传**） | `typecheck:test` **2 条 TS2322**（探针返回 void，新签名要 boolean） | **typecheck:test exit 0**、两文件 **2/2 绿** | 探针改成 `return orig(...)`（丢返回值 = 让 `0x1AF` 误判"宿主不实现该缝"） |
| `test/ptr.test.ts` / `test/engine-field-store.test.ts` | — | **绿**（随全量一起跑） | ⑪ 只加了一行注释；两个文件都没有票面锚点 |
| `npm run check:dead-writes` | 基线 11 | **11 / ★无新增死写** | 本单元新增的字段（`#texBarrier`）有真读者（`barrier:` 查询 + trace 行），不进闸门 |
| `npm run typecheck`（tsconfig + control + electron） | — | **exit 0** | 主 agent 中途看到的 `textureCache.ts(843,72) TS2366` 是**中间态**（`: boolean` 已写、末尾 `return true;` 未补），定稿态干净 |
| 聚焦 typecheck（本单元改的 10 个 src + 4 个 test） | — | **0 条错误** | 用临时 `-p` 收敛（见 §2.1） |
| `tickets.js --validate` | 0 警告（E 波收口时） | **✅ 176 张 / 0 条 ✗ / 15 条行号漂移警告** | 本单元修掉了一条**真硬错**（`T-0086 evidence[1]` 被拆缝吃掉 ⇒ 改指新串，见 §3-4） |
| `test/ticket-ledger.test.ts` | 6/6 绿 | **6/6 绿** | 同上 |
| `npm run test:all` | 1575 例 / 1570 过 / 3 红（纯 `T-0146` 基线） | **1604 例 / 1597 过 / 5 红 / 2 skip**（见 §2.2 归因表） | ★**我造成的 2 条守卫红 + 2 条 typecheck 红已全部修掉**；残余 5 条 = **3 条 `T-0146` 基线** + `organization`（`t0107-l2d-asset-id-table.test.ts` 的 `T2` 档位）+ `capability-ledger`（别人改了 `analysis/engine-capabilities.json` 未重跑生成器） |

### §2.1 聚焦 typecheck 的复现命令（树被冻住时的备用手段）

```powershell
cd app/amayui-emulator
# 临时 project（继承 tsconfig.test.json），只收本单元动过的文件
node node_modules/typescript/bin/tsc -p .tmp-tsc-f.json --noEmit
# → 0 条错误（`msgwin` 回滚后连那 36 条也没了）
```

### §2.2 `test:all` 的残余红逐条归因（**"哪些不是我的"看这里**；数据 = 本轮最后一次 `npm run verify` 里 `test:all` 的实测）

**最终实测：`test:all` = tests 1604 / pass 1597 / fail 5 / skipped 2**（`typecheck` + `typecheck:test` 都 exit 0 时的那一次；
`verify` 最终仍 exit 1，唯一原因是这 5 条）。

| # | 红 | 归因 | 证据 |
|---|---|---|---|
| 1 | `engine-slot`（E4 真槽 `SAVEDWORDS`） | **基线红**（`T-0146`） | `CONTEXT.md` §6 明列 |
| 2 | `save-slot`（真槽 `format` 0≠3） | **基线红**（`T-0146`） | 同上 |
| 3 | `scene-report`（可绘制项 24 ≤ 缺纹理项 26） | **基线红**（`T-0146`） | 同上 |
| 4 | `organization.test.ts` 的「默认档有实质覆盖」 | **不是我的** —— 报 `t0107-l2d-asset-id-table.test.ts` 声明 `T2` 但判据看不出 Electron 依赖（`T-0107` 单元的档位问题；主 agent 已代改过它的 pragma） | 该测试期望 `[]`，实际只点名那**一个**文件 |
| 5 | `capability-ledger.test.ts` 的「人可读 md 与数据层同步」 | **不是我的** —— 报 `script-global-int-pool-from-sys4ini` 没出现在 `docs-new/03-engine/engine-capabilities.md` ⇒ 别人改了 `analysis/engine-capabilities.json` 但没重跑 `build-capabilities.mjs` | 报错原文点名该 id |
| — | `script-ledger.test.ts` 的「覆盖率分母 = 磁盘真实数」（首轮在红集合里，末轮已不在） | **不是我的** —— `analysis/scripts.json` 的 `T-0107`/`T-0176` 条目与生成物不同步 | 首轮报 `索引页应含已登记条数`；末轮该条已消失（有人在刷） |
| — | `ops-142-12f-306.test.ts`（首轮红，末轮**已消失**） | **不是我的** —— `T-0169` 单元改 `src/vm/engine.ts`（+221/-16）时的中间态 | 末轮不在红集合里 |
| — | `engine-field-ids.test.ts` 的裸数字棘轮（首轮红，末轮**已消失**） | **不是我的** —— 报 `handlers/control.ts:572`（别人在改的文件） | 末轮不在红集合里 |
| — | `harness-convergence.test.ts` 的「不得新增自造帧循环」（首轮红，末轮**已消失**） | **不是我的** | 末轮不在红集合里 |
| — | `op-a2-a3` / `op-15xx-gfx-texture-vm`（首轮红） | **是我的**（拆缝改了宿主方法名，两条既有守卫录制的是旧名）⇒ **已最小 retarget 修绿** | 单文件复跑 11/11 与 10/10 |
| — | `typecheck:test` 的 2 条 `TS2322`（首轮红） | **是我的**（`setSlotPixels` 新契约）⇒ **已修**（两条探针改成 `return orig(...)`） | `npm run typecheck:test` → **exit 0** |

★**结论：本单元造成的红 = 0**（曾造成的 2 条守卫红 + 2 条 typecheck 红都已修，且修法一律是
"最小 retarget / 探针透传 + 加强断言"，没有删断言、没有放宽 `native.ts` 的契约）。
残余红里 3 条是 `T-0146` 基线、2 条明确指向 `T-0107`/台账生成物（都不是本单元文件）。

---

## §3 台账待应用（**主 agent 串行落地**；本单元一个字节都没动 `analysis/**`）

> 写法照你要求的"可直接照抄"形状：**文件 → match 键 → 新值 → raw 锚点 → guard → journal**。

### §3-1 `analysis/opcode-gaps.json` → 条目 `0x34f`（opcode 847）

- **match 键**：`op === 0x34f`（或 `mnemonic` 含 `l2d-texture-mulcolor`；按主 agent 现行 schema 取其一）。
- **改什么**：`missing[]` 里那条"Pixi 端把 `mulColor` 当 tint"的 `what` 换掉（**只是措辞订正**，
  `ticket`/`raw` 保留）：
  - **新值（`what`）**：
    `0x34F 的乘色已解码成批次字段（live2d/render.ts 的 mulColor，decodeL2dMulColor 按 sub_4BD150 的实参序 [BYTE2,BYTE1,BYTE0]/255），但 presenter 的 drawL2d 无渲染消费者 ⇒ 画面不着色；未接的原因 = 引擎经 sub_4BD3E0 的 SDK 纹理混合（*(1-a4)*现价 + a4*目标），Pixi 只有逐通道 tint，缺真机对照，直接映射会引入新的可见色差。重开条件两条见 src/renderer/pixi/presenter.ts 的 l2dBatchList 注释（T-0175 的 ⑨）`
  - **旧值（要替换掉的原话）**：含"把 `mulColor` 当 tint 下发 / 字节序无真机对照"那一句
    （`tickets/T-0160/changes-live2d.md` §4 的原措辞）。
- **raw**：`143791-143801`（`sub_4BD3E0` 的 `(1-a4)*现价 + a4*目标`）、`34813-34818`（`decodeL2dMulColor` 的实参序）。
- **guard**：无新增守卫（如实登记型）；现有 `test/opcode-gaps.test.ts` 的 schema 棘轮继续覆盖。
- **journal（建议一句）**：`T-0175-F 订正 0x34f 的 missing 措辞：真问题是"无渲染消费者"而非"字节序错"（代码里 presenter 从不读 mulColor）。`

### §3-2 `analysis/opcode-gaps.json` → 条目 `0x1af`（opcode 431，`load-slot-thumb`）——★有一处**实质加强**

- **match 键**：`op === 0x1af`。
- **改什么**：若该条 `missing[]` 里有"`setSlotPixels` 静默忽略而 handler 无条件 `op1 = 0`"这一条
  （`T-0159` §4.3 的 P3 `missing-consumer`）⇒ **删掉该条 `missing` 并把 disposition 改判 `implemented`**
  （或按现行 schema 保留 `partial` 但 `missing` 里换成"第二格式解入未建模"那条）。
- **新值（依据）**：
  `T-0175-F：setSlotPixels 签名改为 boolean|void，两宿主同口径回答"该槽有没有 surface"（Pixi=有没有画布；headless=proceduralSlots∪slotImgid）；handler 在 landed===false 时写 op1=2（= 引擎 sub_40BF20/sub_43E9F0 在该格的失败档），landed===undefined（宿主不实现该缝）保持旧行为写 0。`
- **raw**：`38584-38592`（`0x1AF` 的结果码：`CreateFileA` 失败 ⇒ 1；已打开但 `ReadFile(...,0xE)` 失败 ⇒ 2）、
  `16072`（`sub_40BF20`）、`49926`（`sub_43E9F0` = ddReadBmp）。
- **guard**：**`test/texture-destroy-wiring.test.ts`**（6 例，含 `setSlotPixels` 三态两条）。
- **journal**：`T-0175-F 把 0x1AF 的 missing-consumer 关掉：返回值语义接通（红→绿见 changes-f.md §2）。`

### §3-3 `analysis/engine-capabilities.json` → 纹理槽参数下发一族（**只在已有条目时补一句**）

- **match 键**：现有条目里 `emulator.note` 含 `setTextureObjectParam` 的那条（若没有该条目 ⇒ **不要新建**：
  它不是"引擎常态能力"，只是宿主缝形状）。
- **新值（追加一句）**：
  `★T-0175 的 ③：setTextureObjectParam 已拆成 setTextureObjectColor（颜色，0x1F9 的 op3 / 0x249 的 op3 ⇒ Scene[5*slot+467]）与 setTextureObjectSubParam（0x246 的子对象 vtable+56，op2÷100）；旧名保留为迁移期回退，生产路径只调新名。`
- **raw**：`32750-32757`（颜色）、`32696-32697`（÷100）。
- **guard**：`test/native-seams-t0175.test.ts`（4 例）、`test/op-15xx-gfx-texture-vm.test.ts`（10 例）。
- **journal**：`T-0175-F 拆宿主缝 setTextureObjectParam（T-0163 §7-1 的交接项已闭）。`

### §3-4 `tickets/T-0086/ticket.json` —— ✅ **已由本单元当场修好**（记录在案，不需你再动）

- my 拆缝把 `evidence[1].anchor` 的旧串吃掉了 ⇒ 按"锚点是 ABI，只改指不删"：
  `anchor` 改为 `emitTextureColor(c.native, slot, normalizeTextureColor(color));`、`line` 99→134、
  `file`/`note` 未动，并追加了 history 说明（`tickets/T-0086/notes.md`）。
- **实测**：`tickets.js --validate` = ✅ 176 张 / 0 ✗。

### §3-5 `analysis/fields.json` / `analysis/functions.json`

- **不需要新增任何条目**：本单元没有建任何引擎字段/函数
  （`#texBarrier` 是渲染会话的观测账；`T-0175-F` 只动了宿主缝形状与 handler 结果码）。

### §3-6 `app/amayui-emulator/test/native-tap.test.ts` 的两张表（**不是台账，但同一批"待他人"**）

- `DECLARED_HOST_DIVERGENCE`：**本轮不动**（四条新缝两宿主都不实现 ⇒ 对称）。
  将来若让 `PixiBackend` 真的弹框实现 `confirmSlotOverwrite`，必须往该表**按字典序**插 `'confirmSlotOverwrite'`。
- `NON_BRIDGE`：**本轮不动**（我一度给 `PixiBackend` 加了 `countBarriers()`，被该表当场抓红 ⇒
  已撤掉，改走**已登记**的 `digestHostCounters().barriers` 读同一个数）。

---

## §4 别人该接（点名的文件 + 判据 + 为什么本单元不动）

### ⑩ `0x137` / `0x30a` 的越界诊断（**本单元不做**）

- 要做的三件事（一件都不能少，否则要么红要么假绿）：
  1. `src/vm/operandPlan.ts` 给 `0x137`（argc 1）与 `0x30a`（argc 2）**声明操作数计划**；
  2. 把 `src/vm/handlers/stubs.ts` 的 `[0x137, op_engine_internal]`(`:86`) 与
     `[0x30a, op_engine_internal]`(`:386`) 迁出 `ENGINE_INTERNAL_OPS`、改成 `OPS` 里的真 handler；
  3. 把 `test/opcode-operands.test.ts:51`（`'0x137': 'engine-internal no-op（ResetStack；…）'`）
     与 `:55`（`'0x30a': 'engine-internal no-op（键位注册；emulator 无按键表）'`）两条**从白名单删掉**
     （声明了计划又留在白名单 ⇒ `operand-plan` 棘轮红）。
- 还有④：两条的语义不同 —— `0x137` 是"写错误缓冲 + `sub_4034D0` **非致命上报**、随后**继续执行**"
  （raw 30714-30718；字面量 raw 4423 `ResetStackの引数が不正です．`），`0x30a` 是
  `_CxxThrowException(ShowMessage)`（raw 33830-33833，字面量 raw 4436）⇒ 后者可以直接复用
  `ShowMessageError`，前者需要一个**非致命**的上报面（`NativeBridge` 现无此面）。
- **为什么本单元不动**：① 第 3 步落在 `test/opcode-operands.test.ts`，**不属本单元文件范围**；
  ② 非致命上报面是"新宿主缝 + 两宿主对称"（同 §1.1(a) 的约束）⇒ 需要一次跨文件协调。
  ③ 语料各 1 处且都合法 ⇒ 当前不可见，不是产品路径缺口。
- **重开条件**：有人愿意同时改上面四个文件（含那个测试）时一次做完；单独做任一步都会留下一处红。

### ③(c) `0x25b` / `0x25a` 的宿主媒体缝（**本单元不做**）

- 要做的事：`NativeBridge` 新增一条媒体缝（例如 `setMessageMedia?(mode: 1 | 2, id: number): void`
  或分成 `showMessageImage` / `showMessageMovie`），并让 `0x25b` 的**图像加载分支**
  （非全屏 `display:ScreenMode == 0` 时 `sub_408440` 真解码，raw 33215-33219，失败
  `_CxxThrowException(Command_ShowMessage_Exception)`）与 `0x25a` 的 `sub_4A5470(Scene, id)`
  （raw 33198-33201 的两条门）有落点。
- 现状（如实）：`src/vm/handlers/engine-fields.ts:182`（`0x25b`）只写**两格字段**
  （`msgMediaImageId` + `constWrites` 的 `mediaMode = 2`，`T-0161` 补的那半），
  `:489-496`（`0x25a`）只写 `mediaMode = 1` / `mediaId` —— **加载/下发整块没有**。
  `_this[92377]`（模式镜像）在 emulator **无维护者**（`T-0161` §5 表第 3 行点名）。
- **为什么本单元不动**：语料 `i25a` **0 处** / `i25b` **0 处**（`engine-fields.ts:487` 的实测）
  ⇒ 落点不可见；而"做"需要：新宿主缝 + 两宿主实现（对称约束同 §1.1(a)）+ `92377` 的写者
  （在 `engine.ts`/`frame/**`，**硬边界**）。⇒ **投入产出比与边界都不成立**。
- **重开条件（任一条）**：① 语料出现 `i25a`/`i25b`（换版本/新脚本）；② 有人同时放开
  `src/vm/engine.ts` 与 `test/native-tap.test.ts` 两个文件；③ 用户点名做"消息态影片/图像"这条链。

### ⑤ 前半（`setSlotPixels` 的返回值语义）—— ✅ **本轮改判做掉**（见 §1.2 的 (a2)）；仍需别人接的只剩
`0x1AF` 的"第二格式（AGF/dd 系表面）解入"（`T-0159` §4.4，D3D 路，本机 `set:DrawMode = 0` ⇒ 不可见）。

### ⑪ 的那两个文件 —— 本单元已收口（§1.5），无需别人接。

### `ops-142-12f-306.test.ts` 的那条红（**新增一节，供你分派**）

- 现象：`0x142：把 op1 写进引擎字段 _this[174812]（构造/复位默认 1，脚本可控）` 断言
  `engineValues.get(174812) === undefined`（"默认不占位"）而实际是 `1`。
- **归因：`T-0169` 单元正在改 `src/vm/engine.ts`**（`+221/-16`）—— 这正是本单元 acceptance ① 里
  那条"构造与整体复位把 `engineValues[scriptEngineFlag] = 1`（raw 22591/17961）"的落地。
  ⇒ 该单元的**同一批改动**要么把这条守则一起 retarget（断言 `=== 1`，并把"为什么"写清），
  要么按体确认初值不是 1。**本单元不碰**（`engine.ts` 是硬边界）。
- 复现：`cd app/amayui-emulator && node --import tsx --test test/ops-142-12f-306.test.ts`（5 例 / 1 红）。

### `engine-field-ids.test.ts` 的裸数字棘轮（**同上，供你分派**）

- 现象：报 `handlers\control.ts:572` 有裸数字 `engineValues.get/set` 键。
- **归因：`src/vm/handlers/control.ts` 是别人在改的文件**（`git status` 显示 ` M`）。
- **本单元不碰**（不是我的文件范围条目，也没动过 `control.ts`）。

---

## §5 改动文件清单（本单元，全部 LF）

| 文件 | 规模 | 内容 |
|---|---|---|
| `app/amayui-emulator/src/renderer/app/textureBarrier.ts` | **新**（~120 行） | 屏障②的纯判据 + 可观测包装（⑦a） |
| `app/amayui-emulator/src/vm/native.ts` | +~80 行 | 四条缝声明（`confirmSlotOverwrite`/`slotWriteFailed`/`setTextureObjectColor`/`setTextureObjectSubParam`）+ 旧名标 `@deprecated`（③） |
| `app/amayui-emulator/src/vm/nativeTap.ts` | +~25 行 | `BRIDGE_METHODS` 加四条 + `WHY` 加六条文案（③） |
| `app/amayui-emulator/src/vm/handlers/gfx-texture.ts` | +~25 / -6 | 新增 `emitTextureColor()`；两处颜色改走新名；`0x246` 改走 `setTextureObjectSubParam`；两段注释改指拆缝（③） |
| `app/amayui-emulator/src/vm/handlers/save-slot.ts` | +~14 / -1 | `0x1AF`：`setSlotPixels` 返回 `false` ⇒ `op1 = 2`（+ 一条 log）；`undefined` ⇒ 保持旧行为（⑤ 前半） |
| `app/amayui-emulator/src/renderer/headlessScene.ts` | +~12 / -2 | `setSlotPixels` 改返 `boolean`（`proceduralSlots` ∪ `slotImgid` = 该槽有没有 surface）——**与 Pixi 同口径**（⑤ 前半） |
| `app/amayui-emulator/src/renderer/pixi/textureCache.ts` | +~50 / -6 | `CanvasFactory` 接口 + 构造第三参 + `#hasCanvasFactory()` + 建画布那一步改走工厂（⑤ 后半）；`setSlotPixels` 改返 `boolean`（⑤ 前半） |
| `app/amayui-emulator/src/renderer/app/session.ts` | +~35 / -5 | `#texBarrier` 账 + `#awaitTextureBound` 改走 `observeTextureBarrier`（删内联 opcode 集合）+ `barrier:` 查询注入（⑦a） |
| `app/amayui-emulator/src/renderer/pixiBackend.ts` | ±0（**净零**） | 曾加过 `countBarriers()` 后**撤掉**（会把 native-tap 的非桥清单打红，那份清单不属本单元范围）⇒ 最终用**已登记**的 `digestHostCounters()` |
| `app/amayui-emulator/src/vm/debugQuery.ts` | +~14 | `DebugQueryHost.barrier` + `case 'barrier'` + 两处帮助文本（⑦a） |
| `app/amayui-emulator/src/renderer/pixi/presenter.ts` | +~19（**纯注释**） | `l2dBatchList` 之前写清 `mulColor` 的前提过期/为什么不下发/重开条件（⑨） |
| `app/amayui-emulator/test/texture-destroy-wiring.test.ts` | **新**（~190 行） | ⑤ 的六条判据（含红→绿 + `setSlotPixels` 三态） |
| `app/amayui-emulator/test/texture-barrier-observable.test.ts` | **新**（~110 行） | ⑦a 的四条判据 |
| `app/amayui-emulator/test/presenter-merge-order.test.ts` | **新**（~215 行） | ⑦b 的四条判据（含变异红） |
| `app/amayui-emulator/test/native-seams-t0175.test.ts` | **新**（~95 行） | ③ 的四条判据 |
| `app/amayui-emulator/test/ptr.test.ts` | +1 行注释 | ⑪：把"方向与体一致"写死 |
| `app/amayui-emulator/test/op-15xx-gfx-texture-vm.test.ts` | +~20 / -6（**retarget**） | 录制端拆成 `param`/`color` 两表 + "旧名不许被调"断言（③ 拆缝的连带） |
| `app/amayui-emulator/test/op-a2-a3.test.ts` | +~12 / -5（**retarget**） | 同上（`param`→`color`/`subparam` 两标签） |
| `app/amayui-emulator/test/save-slot-chain.test.ts` | +5 / -1（**探针透传**） | `setSlotPixels` 探针改成 `return orig(...)`（丢返回值 = 让 `0x1AF` 误判"宿主不实现该缝"） |
| `app/amayui-emulator/test/save-slot-thumb.test.ts` | +3 / -1（**探针透传**） | 同上 |
| `app/amayui-emulator/test/engine-field-store.test.ts` | **0 改动** | ⑪：票面前提已被更早单元取代（§1.5） |
| `tickets/T-0086/ticket.json` | 1 条 evidence（**锚点改指**）+ notes.md 一段 | 拆缝吃掉旧锚串 ⇒ 按纪律改指新串（§3-4） |

★**未动**（硬边界）：`src/vm/engine.ts`、`src/frame/**`、`src/vm/handlers/msgwin.ts`、`src/vm/msgwin.ts`、
`analysis/**`、`CONTEXT.md`、`docs-new/**`、任何 `tickets/*/ticket.json`、`test/harness-convergence.baseline.json`、
`test/native-tap.test.ts`、`test/opcode-operands.test.ts`。

★临时文件 `.tmp-tsc-f.json`（聚焦 typecheck 用）**保留在工作树**（`.tmp-` 前缀，`git status` 里可见；
`app/amayui-emulator/tsconfig*.json` 的 `include` 不匹配它 ⇒ 不参与任何构建/测试）。要清掉直接删即可。

---

## §6 与出处结论不符的新事实（"出处说 → 体/代码里是"）

1. **`T-0159` §4.2 说 `copySaveSlot` 漏复制 `.STH`** → **代码里早就是两条独立写**
   （`src/arch/nodeFileSource.ts:246-252`）⇒ 票面 ④ 的前提**已过期**（`T-0175/notes.md` 也记了同一件事）。
2. **`T-0160` §4 说"Pixi 端把 `mulColor` 当 tint 下发（字节序无真机对照）"** → **代码里 `presenter.ts`
   完全不读 `mulColor`**（全仓只有 `live2d/{runtime,render,mtn}.ts` 三处）⇒ 真问题是"**没有渲染消费者**"，
   不是"字节序错了"（详见 §1.4）。字节序那半其实**有依据**：`decodeL2dMulColor` 用的是
   `sub_4BD150` 的**实参序**（raw 34813-34818），不是猜的。
3. **`T-0161` §5 表第 7 行说 `test/engine-field-store.test.ts:112-113` 的注释"仍写消费端未实现"** →
   **实际已改成"消费端已落地 + 仍未建模的是第二个计算点 raw 20416-20426"**（现行 `:112-114`）。
4. **`T-0162` §6-5 说 `test/ptr.test.ts:110-113` 把 `ptr0` 写成 dest、`ptr1` 写成 src** →
   **实际方向是对的**（`ptr0` 标 src、`ptr1` 标 dest，与体 `memcpy(dest=addr(op2), src=addr(op1))` 一致）。
5. **`T-0163` §7-1 说 `0x1F9`/`0x249` 与 `0x246` 共用一条缝（要拆）** → 体里**颜色消费者有两处**：
   `0x249`（`gfx-texture.ts:115` 改前）**与 `0x1F9` 的 bindTexture 路径**（`:322` 改前）——
   §7-1 只点了 `0x1F9`/`0x249` 作为一族，但拆缝时**两处都必须改**（只改一处会留下一条颜色直连旧名）。
6. **`T-0166` §4-③ 说"当前产物侧无从断言，只有源棘轮可写"** → 本轮证明**可以做成行为断言**：
   把判据抽成 `renderer/app/textureBarrier.ts` 的纯函数后，"派发一次 ⇒ 缝调一次 + promise 被 await"
   在 Node 里完全可测（不需要真宿主），源棘轮只需再钉"会话接上了这份判据"。
7. **`T-0175/notes.md:14` 的行号 `src/vm/handlers/msgwin.ts`（去重后的 import 落点）** →
   本轮实测（`msgwin` 回滚后）落点就是 **`src/vm/handlers/msgwin.ts:2391`**；我一度按
   "拆分进行中"记成 `msgwin-obj.ts:12`，**该记录已随回滚作废**（`msgwin-obj.ts` 已被删除）
   ⇒ **票面 ⑫ 的结论正确，落点文件名就是原文件名**。
8. **`T-0159` §4.3 说 `setSlotPixels` 的修法"都需要先动 `native.ts` 的签名"并据此把它列为缺口** →
   本轮证明这条**可以一次做完且不引入跨宿主分叉**：headless 自己就有"该槽有没有表面"的真答案
   （`proceduralSlots` ∪ `slotImgid`），不需要"记录即成功"这种自造宽容
   ⇒ 两宿主同口径返 `boolean`，`test/native-tap.test.ts` 的差异表一个字都不用动（详见 §1.2 的 a2）。
9. **`T-0163` §7-1 的"已声明在案、三宿主无实现"** → 我按 `--anchors-in` 复核时发现**代码里
   `0x245`/`0x246`/`0x1F9` 的 handler 早就在调这些缝**（`gfx-texture.ts` 的三处 `?.()`），
   只是名字混用；"无实现"指的是**宿主侧**（`PixiBackend`/`headlessScene`/`StubNative` 都不实现），
   这两件事不要在报告里混写。

---

## §7 本单元**没做/做不到**的（含重开条件，汇总）

| 项 | 状态 | 重开条件 |
|---|---|---|
| ③ 的"宿主真的实现两条存档缝" | 只进桥，两宿主都不实现 | 放开 `test/native-tap.test.ts` 的 `DECLARED_HOST_DIVERGENCE`（或两宿主对称实现） |
| ③ 的 `0x25b` 图像加载 / `0x25a` 下发 / `92377` 镜像 | 不做（语料 0 处 + 需 `engine.ts`/`frame/**`） | 见 §4-③ 的三条 |
| ⑩ 越界诊断（`0x137`/`0x30a`） | 不做（需改 `test/opcode-operands.test.ts` 白名单 + `operandPlan.ts` + 新宿主上报面） | 见 §4-⑩（四件事一起做） |
| ⑨ `mulColor → tint` | 不做（缺真机对照） | 见 §1.4 的两条 |
| `0x1AF` 的第二格式（AGF/dd 系表面）解入 | 不做（D3D 路，本机 `DrawMode=0` ⇒ 不可见） | 有人做 D3D 路时一起（`T-0159` §4.4） |
| ① / ⑬（`engine.ts`）/ ②（`msgwin.ts`） | 别人的 | `T-0169` / `T-0019` |
| `ops-142` 与 `engine-field-ids` 两条红 | 别人的（`engine.ts` / `handlers/control.ts` 在改） | 见 §4 的两节，已点名文件与复现命令 |
| ⑤ 前半（`setSlotPixels` 返回值 + `op1 = 2`） | ✅ **已做掉**（原判"不做"，读体后改判） | — |
| 收尾三连的绿 | ✅ **已绿**（`--validate` 176/0✗、`ticket-ledger` 6/6、`test:all` 的本单元新增红 = 0） | — |
