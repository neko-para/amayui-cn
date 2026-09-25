/**
 * **A4 图元 / 网格 / 纹理 / 渲染状态族**（13 条，2026-09 落地；★2026-09 又补 3 条转场写入 `0x24F`/`0x250`/`0x251` ⇒ 共 16 条）。
 *
 * 这一族在复评台账里的判据是「写有读者的引擎状态 / 改渲染状态」——语料用量很大：
 * `0x258` 11356 处、`0x238` 2056 处（**`0x400` 等待计时器，有读者**：`Engine.gatePending`）、
 * `0x20E` 786 处、`0x229` 716 处、`0x224` 334 处、`0x242` 350 处。
 * 它们此前一律是 `ENGINE_INTERNAL_OPS` 的纯 no-op（或 `STUB_NATIVE_OPS` 的记录式桩）。
 *
 * 实现分两档（与全项目口径一致：**能建模的建模、纯渲染侧的走宿主缝**）：
 *
 * | opcode | handler | 引擎做的事 | emulator |
 * |---|---|---|---|
 * | `0x238` | `sub_4248C0` raw 32303-32312 | `Engine[92338] = 0`、`Engine[92339] = op1` | **建模**：装载 `0x400` 等待门的计时器（`Engine.gateWaitStart/gateWaitMs`；见 `tickets/T-0024`） |
 * | `0x258` | `sub_425D20` raw 33156-33185 | 按 op2 的 bit0/bit1 写**四格**：`Scene+1872/+1876` 与其镜像 `Scene+21872/+21876` | **建模一张表**：`Engine.texSlotFlags`（镜像表缺；且四格引擎**只写不读**、本工程也无生产读者 ⇒ dead-writes 基线，回链 `T-0154`） |
 * | `0x1FC` | `sub_422F80` raw 31303-31310 | `sub_4AC470(Scene, op1)`：复位该 DrawItem 的变换字段（+104/+132..+164 清零） | 宿主缝 `resetPrimTransform` |
 * | `0x1FE` | `sub_423060` raw 31330-31345 | 读 op2..op5 **4 个 float**（不除 100）→ `sub_4AC660(Scene, op1, …)` | 宿主缝 `setPrimTransform4` |
 * | `0x207` | `sub_423480` raw 31494-31521 | `sub_4A3980(Scene, op1 槽, op2 槽, src[4], dst[4])`（源/目标同尺寸矩形） | 宿主缝 `blitSlotToSlot` |
 * | `0x20E` | `sub_41A200` raw 25277-25287 | `sub_4A50C0(Scene, 0x26)` → `sub_498B60`（设备 `Clear(0,0,3,0,1.0,0)`）→ `sub_4A50C0(Scene, -1)` → `sub_498B60` | 宿主缝 `commitGraphics` |
 * | `0x224` | `sub_41A290` raw 25301-25305 | `sub_4AA180(Scene)` → `sub_4A9BE0(Scene+1048)`：清转场表 | 宿主缝 `clearTransitions` |
 * | `0x24F` | `sub_4258F0` raw 32969-32995 | `sub_4AF6A0` raw 133703-133787：**SetBlindWipe**（转场记录 `[0]=2`） | 宿主缝 `setTransition`（记录 24 格） |
 * | `0x250` | `sub_425980` raw 32997-33023 | `sub_4AF880` raw 133789-133858：转场记录 `[0]=3`、`[13]=0`（渲染端 = `SlideBlur`） | 宿主缝 `setTransition` |
 * | `0x251` | `sub_425A10` raw 33025-33055 | `sub_4AFA30` raw 133860-133935：转场记录 `[0]=3`、`[13]=1`（渲染端 = `ZoomBlur`） | 宿主缝 `setTransition` |
 * | `0x229` | `sub_423FE0` raw 31984-32001 | `sub_49A690` 复位 + `sub_49A6C0(op1, op2)` + `sub_49A6F0(f3,f4,f5)`（Scene[278/279]、[286..288]） | 宿主缝 `setDrawModeBlock` |
 * | `0x242` | `sub_4251A0` raw 32649-32658 | `sub_4AD9A0(Scene, op1, op2)`：写 DrawItem `+720` 与相邻对象 `+504` | 宿主缝 `setDrawEntryParam` |
 * | `0x256` | `sub_425C30` raw 33120-33135 | `sub_4ACD10(Scene, op1, op2, f3,f4,f5)`：按 id 找 DrawItem 后写字段 | 宿主缝 `setSlotParams` |
 * | `0x321` | `sub_426BD0` raw 33839-33850 | `sub_4AE280(Scene, op1, op2, op3)`：MeshEntry `result[op2 + 7] = op3`（**无范围校验**） | 宿主缝 `setMeshEntryAttr` |
 * | `0x32A` | `sub_426F80` raw 34003-34010 | `sub_4A0750(Scene, op1)`：3D 模型槽析构 + delete + 置 0 | 宿主缝 `release3DSlot` |
 * | `0x32D` | `sub_427040` raw 34033-34054 | `A = min(op1, 255)`、`op2` 的 **最低字节 = 蓝 / 第三字节 = 红**（各 ÷255）→ `sub_499DF0(Scene, r,g,b,a)` | 宿主缝 `set3DColor`（★轴向照体，见该 handler） |
 *
 * 说明：A4 的 11 条渲染侧指令**不会**改脚本操作数、也不改控制流（那两条建模的也不回写操作数），
 * 因此它们从 VM 视角不可观测；建模/转发的意义是"emulator 侧的渲染模型与引擎一致"，
 * 且从此不再以"无依据的 no-op"出现在 stub 台账里。
 */
import type { OpHandler, StepCtx } from '../step.js';
import { readFloatOperand, readIntOperand } from '../operand.js';
import { operandsFor, type PlannedOperands } from '../operandPlan.js';
import { ENGINE_FIELD } from '../engineFieldIds.js';

/**
 * 取本族的**操作数计划视图**；缺计划 = 编程错误（`test/operand-plan.test.ts` 会核验本族每条都有计划）。
 *
 * ★本族（`tickets/T-0082` 批次"场景/图元状态族"）18 条；`0x33f` **按策略排除**（引擎三格全读但
 * 本工程无消费端，见 `src/vm/operandPlan.ts` 本批次头部说明）。
 */
function planFor(c: StepCtx): PlannedOperands {
  const p = operandsFor(c);
  if (!p) throw new Error(`0x${c.instr.opcode.toString(16)}：场景/图元状态族走操作数计划层，但没有声明计划`);
  return p;
}
import type { OpTable } from './shared.js';

/**
 * `0x238`（sub_4248C0 raw 32303-32312）：**装载 `0x400` 等待门的计时器**（`tickets/T-0024`）。
 *
 * 引擎写的是 `Engine[92338] = 0`（起点清零）、`Engine[92339] = op1`（时长 ms）——
 * 这两格 = 图形池基址别名的 `_this[11630]`/`_this[11631]`（字节 369352/369356），
 * 正是 `sub_407E20`（raw 12762-12786）读的**等待计时器**。⇒ 脚本的 `i238 N` + `wait`（`0x21C`）= "等 N 毫秒"：
 * 计时器未到点 ⇒ `sub_407E20` 返回 1 ⇒ 主循环 `0x400` 分支（raw 21109-21152）不放行。
 *
 * ★2026-09 订正：原注释记的"画布/视口尺寸对"没有依据（语料 2056 处取值全是整毫秒，
 * 且 `src/SN0000.txt` 等处每条 `i238` 都紧跟 `wait`）；`engineValues` 里那两格仍照写
 * （同一份语义的第二视图，供报告/digest 与 `0x238` 的既有证据锚点使用）。
 */
const op_load_wait_timer: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const v = (plan.int(1) ?? 0);
  e.gateWaitStart = 0; // Engine[92338]：起点清零 ⇒ 下一帧由 sub_407E20 锁存
  e.gateWaitMs = v; // Engine[92339]：时长（ms）
  e.engineValues.set(ENGINE_FIELD.waitTimerStart, 0);
  e.engineValues.set(ENGINE_FIELD.waitTimerMs, v);
};

/**
 * **`0x243`（`sub_41B180` raw 26016-26031，argc 0）**：**复位 `0x400` 等待门的计时器**。
 *
 * 体全文（含门控）：
 * ```
 * _this[30*cur + 95805] = 1;                                  // arity 槽 ⇒ argc=0（有据）
 * if ( (*(_BYTE *)(_this + 369360) & 2) == 0 ) {              // Engine[92340] 的 bit1（= 0x24E 写的那个字段）
 *     _this[92336] = 1;                                       // ★字节 369344：全反编译 4 处写、0 处读 ⇒ 只写不读
 *     _this[92338] = 0;  _this[92339] = 0;                     // 等待计时器：起点/时长双双清零
 * }
 * ```
 * ⇒ 与 `0x238`（`sub_4248C0` 装载计时器）成对：`i238 N` 装、`i243` 清。
 * ★语料 **341 处 / 338 个脚本**（`local-ret` 之后第二多），未实现时命中即 `NotImplementedError`
 *   —— 审计 P1 `op-3-002` 把这条列在「无注册也无登记」里（`analysis/opcode-gaps.json` 现已标 implemented）。
 *
 * emulator：清 `Engine.gateWaitStart/gateWaitMs`（`0x400` 门的真消费端，见 `Engine.gatePending`）
 * 并同步 `engineValues` 的第二视图（与 `0x238` 同口径）。★`Engine[92336]` 只写不读 ⇒ **不建模**
 * （与 `0x2FA` 同判据：建一个没人读的字段等于死写）。
 */
const op_reset_wait_timer: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const gate = e.engineValues.get(ENGINE_FIELD.msgField92340) ?? 0;
  if ((gate & 2) !== 0) return; // 门控：bit1 置位时引擎整段跳过
  e.gateWaitStart = 0;
  e.gateWaitMs = 0;
  e.engineValues.set(ENGINE_FIELD.waitTimerStart, 0);
  e.engineValues.set(ENGINE_FIELD.waitTimerMs, 0);
};

/**
 * `0x258`（sub_425D20 raw 33156-33185）：纹理槽标志对。
 *
 * 体全文（raw 33161-33184）：
 * ```
 * v2 = readIntOperand(2);
 * result = &_this[5 * readIntOperand(1) + 80708];     // = Scene + 20*槽（Scene = Engine + 322832）
 * if (v2 & 1) { result[468] = 1; result[5468] = 1; } else { result[468] = 0; result[5468] = 0; }
 * if (v2 & 2) { result[469] = 1; result[5469] = 1; } else { result[469] = 0; result[5469] = 0; }
 * ```
 * ⇒ 每条槽各写 **四格**：`Scene+1872/+1876`（bit0/bit1）与 `Scene+21872/+21876`（同两格的镜像表）。
 *
 * ★**本工程只建模一张表**（`Engine.texSlotFlags`，值 = `bit0 | bit1<<1`）：镜像表 `Scene+21872`
 * **没有对应物**（缺口，见 `changes-gfxstate.md` 的台账项）。
 * ★**这张表是"建模≠有消费端"**（与 `0x238` 的等待计时器不同）：引擎侧这四格是**只写不读**
 * （全反编译无读点），emulator 侧 `Engine.texSlotFlags` 也**零生产读者** ⇒ 已登记在
 * `dead-writes.baseline.json` 的 `known`（回链 `T-0154`）。照本工程判据（`0x238`/`0x2FA`：
 * 写一个没人读的字段等于死写、不建模），这里保留状态只为"脚本语义可观测 + 将来接装载路径"，
 * **不是**"已经生效"——别把它当有消费端的能力。
 * 语料 11356 处（本族用量最大）。
 */
const op_set_slot_flags: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const slot = (plan.int(1) ?? 0);
  const flags = (plan.int(2) ?? 0);
  // bit0/bit1 各自写成 0/1（raw 33164-33183 的四个 if/else，不是整份 `flags & 3`）
  e.texSlotFlags.set(slot, flags & 0x3);
};

/** `0x1FC`（sub_422F80）：复位图元的变换（DrawItem 的缩放/旋转/平移字段清零）。 */
const op_reset_prim_transform: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const handle = (plan.int(1) ?? 0);
  c.native.resetPrimTransform?.(handle);
};

/** `0x1FE`（sub_423060）：图元变换 4 浮点（op2..op5 **原样**，与 0x1FD 的 ÷100 不同）。 */
const op_prim_transform4: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const handle = (plan.int(1) ?? 0);
  const a = (plan.float(2) ?? 0);
  const b = (plan.float(3) ?? 0);
  const d = (plan.float(4) ?? 0);
  const f = (plan.float(5) ?? 0);
  c.native.setPrimTransform4?.(handle, a, b, d, f);
};

/** `0x207`（sub_423480 raw 31494-31521）：槽→槽 StretchRect（源/目标矩形同尺寸）。 */
const op_blit_slot_to_slot: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const src = (plan.int(1) ?? 0);
  const dst = (plan.int(2) ?? 0);
  const x = (plan.int(3) ?? 0);
  const y = (plan.int(4) ?? 0);
  const w = (plan.int(5) ?? 0);
  const h = (plan.int(6) ?? 0);
  const dx = (plan.int(7) ?? 0);
  const dy = (plan.int(8) ?? 0);
  // 引擎：src = {op3, op4, op3+op5, op4+op6}、dst = {op7, op8, op7+op5, op8+op6}
  c.native.blitSlotToSlot?.(src, dst, [x, y, x + w, y + h], [dx, dy, dx + w, dy + h]);
};

/**
 * **`0x32`**（`i032`，`sub_41E2D0` raw 27955-28008）：**槽→槽的缩放转送**（引擎名 **StretchTexture**）。
 *
 * 十个操作数：`op1` = 源槽、`op2` = 目标槽、`op3..6` = 源矩形 `(x, y, w, h)`、`op7..10` = 目标矩形。
 * 引擎把两对 (x,y,w,h) 先化开成 `[x1,y1,x2,y2]`（raw 27974-27983），再按 `set:DrawMode`
 * （`Engine[166964]`，raw 27982 `v3 = *(_DWORD *)(_this + 667856) == 0`）分两条路：
 *  - `== 0`（GDI）→ `(*(vtable+64))(Scene+7912, op2, dx,dy,dx+dw,dy+dh, op1, x,y,x+w,y+h)`（raw 27986-28000）：
 *    **文本/2D 对象自己的转送**（`Scene+7912`），参数就是同一个 10 元组（只有 op1/op2 的实参位置换了）；
 *  - `!= 0`（D3D）→ `sub_4A87A0(Scene, 源槽, 目标槽, &源矩形, &目标矩形)`（raw 127933-128129）：
 *    两个矩形各自按所在 **surface 的边界**夹取（一侧被夹时另一侧按比例跟随），再缩放转送；
 *    源/目标 surface 不存在 ⇒ 打「コピー元/コピー先テクスチャが作成されていません． TEXTURE=%d」并返回 0。
 *  ★**两路送进宿主的矩形完全相同**（`src = (op3,op4,+op5,+op6)`、`dst = (op7,op8,+op9,+op10)`，
 *    只是实参顺序不同）⇒ 本 handler 对两条路都调同一个宿主缝，**不会**因为分支而改变画面。
 *    真正的差异（夹取/比例跟随 + 缺 surface 的报错）落在宿主侧，也就是 `sub_4A87A0` 那一条 ——
 *    它已经按 D3D 路实现（`renderer/pixi/textureCache.ts` 的 `blitSlotToSlot` + `clampScaledBlit`）。
 *  ★**订正（`tickets/T-0155`）**：GDI 那一支（`set:DrawMode == 0`，**本机 INI 实测的缺省值**）
 *    在 emulator 里没有对应的 2D 对象通路（`Scene+7912` 的 vtable 未建模），所以这里**如实登记为
 *    缺口**而不是补一条假的转发：要真做，需要在 `src/renderer/**` 侧建"2D 转送对象"并让
 *    `blitSlotToSlot` 按 DrawMode 选路（见 `changes-gfxstate.md` 的耦合点 ①）。
 *
 * ★语料 **337 处，形态完全一致**：`i032 2 e 0 0 500 2d0 0 0 140 b4` —— 把**全屏槽 2** 的
 * `(0,0,1280,720)` 缩成**槽 0xe** 的 `(0,0,320,180)`；上下文是
 * `create-texture 2 500 2d0 2` → `i20d 2`（以槽 2 为渲染目标）→ `i20e` → `i20c` → 还原渲染目标 →
 * `create-texture e 140 b4 2` → **本指令** → `i1ae … e`（把槽 0xe 写成 `.STH` 缩略图）⇒
 * **存档缩略图的"缩屏"这一步**（`src/SC5450.txt:3009-3021` 等 337 个 ADV 脚本同型）。
 * emulator：与 `0x207` 共用宿主缝 `blitSlotToSlot`（Pixi 在两张画布间 `drawImage`；
 * headless 只把这次下发记进 `scene.render4.blits`）。守卫 `test/op-032-stretch-texture.test.ts`。
 */
const op_stretch_texture: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) return;
  // 十格全 int（计划 `0x32`）：槽号 + 两个矩形。缺实参按 0（引擎那条链要求十个都在，缺只可能来自测试构造）
  const srcSlot = p.int(1) ?? 0;
  const dstSlot = p.int(2) ?? 0;
  const x = p.int(3) ?? 0;
  const y = p.int(4) ?? 0;
  const w = p.int(5) ?? 0;
  const h = p.int(6) ?? 0;
  const dx = p.int(7) ?? 0;
  const dy = p.int(8) ?? 0;
  const dw = p.int(9) ?? 0;
  const dh = p.int(10) ?? 0;
  // 引擎把 (x,y,w,h) 化开成 [x1,y1,x2,y2]（raw 27976-27983）
  c.native.blitSlotToSlot?.(srcSlot, dstSlot, [x, y, x + w, y + h], [dx, dy, dx + dw, dy + dh]);
};

/**
 * `0x20E`（sub_41A200 raw 25277-25287）：图形提交（渲染状态 38 包裹 + 设备 Clear）。
 *
 * 体全文（raw 25279-25286）：
 * ```
 * if ( Engine[80684] == 1 && Engine[92322] == -1 ) {   // ← 两道门都成立才做"状态包裹"
 *     sub_4A50C0(Scene, 0x26);                          // mode 38
 *     sub_498B60(Engine + 80393);                       // Clear(0,0,3,0,1.0,0) ①
 *     sub_4A50C0(Scene, -1);
 * }
 * return sub_498B60(Engine + 80393);                    // Clear ②（**无条件**，两条路都会走）
 * ```
 * ★**订正（`tickets/T-0155`）**：门成立时设备被 **Clear 两次**（Clear 是幂等的 ⇒ 可观测差异只有
 * "多一遍全屏清"这一次 GPU 提交），门不成立时 Clear 一次。emulator 的宿主缝 `commitGraphics`
 * 两者都调一次 ⇒ **门恒假那一侧与引擎等价**，而门真那一侧少一次 Clear。
 *
 * ★**未做（如实登记）**：这不是"补一行 `count=2`"就够了 —— 门的两格在 emulator 侧都没有真值：
 * `Engine[80684]`（raw 25280）与 `Engine[92322]`（= `-1`）都没有置位点被定位（`92322` 属
 * `Scene+369288` 那一族"非脚本路径"，与 `0x24E` 写的 `92340` 相邻但不同格）。⇒ 要照体实现，
 * 得先给 `commitGraphics` 加一个"是否清两次"的实参并让两个宿主按门值传
 * （缝在 `src/vm/native.ts` + `nativeTap.ts`，宿主在 `src/renderer/**` —— 两者都不在本单元范围，
 * 见 `changes-gfxstate.md` 的耦合点 ②）。语料 786 处，本机随包 INI 下 `Engine[80684]` 取值未定。
 */
const op_commit_graphics: OpHandler = (c) => {
  planFor(c); // 0 操作数：仍然走计划层（缺计划 = 编程错误；`test/operand-plan.test.ts` 核验）
  // 引擎：`if (Engine[80684] == 1 && Engine[92322] == -1)` 才做状态包裹，但**两条路径都会**调 `sub_498B60`。
  // ★两道门的字段都没有可信真值（见本条 docstring 的「未做」）⇒ 宿主缝按"清一次"调用（= 门假那一支）。
  c.native.commitGraphics?.();
};

/**
 * `0x224`（sub_41A290 raw 25301-25305）：清转场表。
 *
 * 体是 `sub_4AA180(Scene)` → `sub_4A9BE0(Scene+1048)`；`sub_4A9BE0`（raw 129282-129302）把该 map 的
 * **每个节点 delete 掉**再复位头尾（`_this[2] = 0`）⇒ 真的清空，不只是"记一笔"（宿主侧照此清 `transitions`）。
 */
const op_clear_transitions: OpHandler = (c) => {
  const plan = planFor(c);
  c.native.clearTransitions?.();
};

/**
 * **转场（wipe）记录写入族：`0x24F` / `0x250` / `0x251`**（`tickets/T-0076` 的 B3 补；与 `0x224` 同一张
 * `Scene+1048` 转场表）。三条是缺口台账里排名最前的"零注册"指令（`i251` 44 处 / 21 文件、
 * `i250` 34 处 / 20 文件、`i24f` 6 处 / 6 文件）⇒ 未实现时命中即 `NotImplementedOp`。
 *
 * 体位置（三条相邻）：raw 32969-32995 / 32997-33023 / 33025-33055，下落函数 = `sub_4AF6A0`（raw 133703）/
 * `sub_4AF880`（raw 133789）/ `sub_4AFA30`（raw 133860）。三个下落函数在全反编译里**各只有 1 处调用点**
 * （就是各自的 opcode handler）⇒ 它们不是引擎内部流程，而是这三条指令的实现体。
 *
 * 记录结构（读体的全部结论）：`Scene+1048` 的转场记录 = **96 字节 = 24 dword/条**，键 = `op1`。
 *  - `sub_4AAAF0(Scene, op1)`：**确保记录存在**。缺失时用 `sub_49A640`（raw 117059-117077）建默认值：
 *    `[0..3]=0`、`[4]=-1`、`[5..8]=0`、`SetRect(+36)` ⇒ `[9..12]=0`、`[13]=0`；**`[14..23]` 引擎未初始化**
 *    （Hex-Rays 的 `char v10[96]` 无 memset，只写了前 56 字节）⇒ 本层按 0 起（偏差记在此，已写进守卫测试）。
 *  - 操作数（`.lst` 的 `push 0Ah…push 1` 与 arity 槽 `N = 2*argc+1`（0x15/0x15/0x19）双向核对）：
 *    `op1` = 记录键、`op2` = 工作纹理槽（记录 `[4]`；引擎按该槽 `sub_4A2C10` 建/换 CTexture）、
 *    `op3` = 起始绘制项 id（`[5]`）、`op4` = 跨度 count（`[7]`）、末两格 = 延迟/时长（`[2]`/`[3]`）。
 *  - ★**`op2` 的工作纹理槽在写记录之前要走一次"检查/重建"**（raw 133743-133783，**三条 wipe 的
 *    下落函数里只有 `0x24F` 这条有**）：
 *    ```
 *    v13 = *(int **)(Scene + 4*a3 + 42456);                 // Scene 的纹理槽对象表（a3 = op2）
 *    if (v13) { v14 = *(Scene+42600)[262];                  // 当前渲染目标对象的字节 +1048
 *               if (v13[262] == v14) goto LABEL_8; }        // 槽已存在**且**它的 +1048 == 当前渲染目标 id ⇒ 直接用
 *    else { v13 = *(int **)(Scene + 42600); v14 = v13[262]; }  // 槽不存在 ⇒ 拿当前对象的宽/高/id
 *    sub_4A2C10(Scene, a3, v13[260], v13[261], v14);        // 建/换绑工作纹理（宽 = [260]、高 = [261]、id = v14）
 *    LABEL_8: …逐格写记录…
 *    ```
 *    ⇒ 语义 = **"工作纹理对象必须与当前渲染目标一致，不一致就按当前对象重建"**；**记录照写**
 *    （`sub_4A2C10` 在两支之后都汇到 `LABEL_8`，不存在"检查不过就 return"）。
 *  - `[0]==2` ⇒ **盲式擦除**：`[13]` = 类型（`switch (v95)` 0..11 各画法，raw 134945-135800）、`[14]` =
 *    分割宽度（`v384[14]` 在每条分支里当条形宽度，raw 134951 起）、`[15]` = 目标绘制项 handle
 *    （`sub_459EA0(Scene+1032, &v384[15])`，查不到就直接清 `[3]`，raw 134889-134893）。
 *  - `[0]==3` ⇒ **插值转场**：`[16..19]` → `[20..23]` 四通道按 `t` lerp（raw 135815-135821），`[13]` =
 *    效果选择子（`== 1` ⇒ `ZoomBlur` + CenterU/V，否则 `SlideBlur`，raw 135837-135858）。
 *  - `[5]`/`[7]` 两格在渲染路径里当**绘制项区间**用（`v384[5] + v384[7]`，raw 135941/136585）并与
 *    `[Scene+1112, +1112+Scene+1116)` 比（raw 134874）⇒ 与 `0x224` 的转场表同属"渲染序"概念。
 *  - `[6]`/`[8]`（`0x24F` 写的 op5/op6）在本转场渲染路径里**未见读取**（如实记缺口）。
 *  - 消费端 = 帧渲染器 `sub_4B06D0` 的转场窗（raw 134856-136321）：`[1]` 首帧从时钟 `Scene+46500` 锁存；
 *    `[1]+[2]` 起、`[1]+[2]+[3]` 到点 ⇒ `sub_4AAE10(...)[3] = 0` 收尾（raw 134941-134942）。
 * emulator：**建模记录 + 宿主缝**（与 `0x224` 同口径）—— `native.setTransition(op1, [[下标, 值]…])` 把引擎真写的
 * 每一格落进 `SceneState.render4.transitions`（`id → 24 格`，经 `scene/snapshot.ts` 导出，报告/测试可断言），
 * 并置脏（`tickets/T-0003`：模型变更 ⇒ 下一帧重新合成）。
 * ★**未建模**（转场渲染器本身，扩展点）：`sub_4A2C10` 的工作纹理对象创建/换模式；`sub_4B06D0` 的扫描带绘制与
 * `Scene+46508/46512/46516` 脏标志；以及"窗口未到点 ⇒ `0x400` 门挂起"的阻塞语义
 * （见 `analysis/engine-capabilities.json` 的 `clock-read-transition-window`）。扩展点 = 在 `scene/ops.ts` 里
 * 按 `render4.transitions` 的 24 格实现扫描带 + 让门判据读窗口剩余时间，`Scene+46508` 的置脏同时接上。
 * ★**`op2` 的工作纹理检查也没有宿主缝**（`tickets/T-0155`）：要照体做，得先有一条
 * `ensureWorkingTexture(slot, w, h, renderTargetId)` 的 `NativeBridge` 缝 + 宿主侧的槽对象表
 * （缝在 `src/vm/native.ts`/`nativeTap.ts`、表在 `src/renderer/**` ⇒ 两者都不在本单元范围；
 * 见 `changes-gfxstate.md` 的耦合点 ③）。**记录那一半不受影响**（体里两支都照写）。
 */
const op_set_blind_wipe: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const id = (plan.int(1) ?? 0); // op1 = 记录键（= `[15]` 的目标绘制项 handle）
  const texSlot = (plan.int(2) ?? 0); // op2 = 工作纹理槽
  const first = (plan.int(3) ?? 0); // op3 = 起始绘制项 id
  const span = (plan.int(4) ?? 0); // op4 = 跨度 count
  const p5 = (plan.int(5) ?? 0); // op5
  const p6 = (plan.int(6) ?? 0); // op6
  const type = (plan.int(7) ?? 0); // op7 = 盲式类型（引擎按 **unsigned** 比 0xB）
  const split = (plan.int(8) ?? 0); // op8 = 分割宽度
  let delay = (plan.int(9) ?? 0); // op9 = 延迟
  let dur = (plan.int(10) ?? 0); // op10 = 时长
  let kind = type;
  let splitN = split;
  if (split < 1) {
    // raw 133730-133738：分割宽度 ≤ 0 ⇒ 打 `aSetblindwipe`（「関数：SetBlindWipe エラー：分割幅が０以下です．」）
    // 并把 a9/a10/a11/a8 就地改成 (1, 0, 0, -1)，随后 **goto LABEL_4** ⇒ 仍照写记录（不是提前返回）
    splitN = 1;
    dur = 0;
    delay = 0;
    kind = -1;
  } else if (type >>> 0 > 0xb) {
    // raw 133740-133787：类型不在 0..11（a8 是 unsigned int，负数会走这里）⇒ 打 `aSetblindwipe_0`
    //（「タイプが不正です．」）后直接 return —— **不写记录**（与上面那条不同，已在守卫测试里分别断言）
    return;
  }
  // raw 133751-133773：`sub_4AAE10(Scene+1048, &id)` 的逐格写入（[9..12] 与 [16..23] 本族不写 ⇒ 保持默认）
  c.native.setTransition?.(id, [
    [0, 2],
    [1, 0],
    [2, delay],
    [3, dur],
    [4, texSlot],
    [5, first],
    [6, p5],
    [7, span],
    [8, p6],
    [13, kind],
    [14, splitN],
    [15, id],
  ]);
};

/** `0x250` → `sub_4AF880`（raw 133789-133858）：转场记录 `[0]=3`、`[13]=0`（渲染端 `SlideBlur` 分支）。 */
const op_set_transition_slide_blur: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const id = (plan.int(1) ?? 0); // op1 = 记录键
  const texSlot = (plan.int(2) ?? 0); // op2 = 工作纹理槽
  const first = (plan.int(3) ?? 0); // op3 = 起始绘制项 id
  const span = (plan.int(4) ?? 0); // op4 = 跨度 count
  const p5 = (plan.int(5) ?? 0); // op5 → `[16]`（通道 A 起点）
  const p6 = (plan.int(6) ?? 0); // op6 → `[19]`（通道 D 起点）
  const p7 = (plan.int(7) ?? 0); // op7 → `[20]`（通道 A 终点）
  const p8 = (plan.int(8) ?? 0); // op8 → `[23]`（通道 D 终点）
  const delay = (plan.int(9) ?? 0); // op9 = 延迟
  const dur = (plan.int(10) ?? 0); // op10 = 时长
  // raw 133830-133856：通道 B/C 两对**显式清零**（`SlideBlur` 只用 A/D 两个自由度）
  c.native.setTransition?.(id, [
    [0, 3],
    [1, 0],
    [2, delay],
    [3, dur],
    [4, texSlot],
    [5, first],
    [7, span],
    [13, 0],
    [16, p5],
    [17, 0],
    [18, 0],
    [19, p6],
    [20, p7],
    [21, 0],
    [22, 0],
    [23, p8],
  ]);
};

/** `0x251` → `sub_4AFA30`（raw 133860-133935）：转场记录 `[0]=3`、`[13]=1`（渲染端 `ZoomBlur` 分支）。 */
const op_set_transition_zoom_blur: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const id = (plan.int(1) ?? 0); // op1 = 记录键
  const texSlot = (plan.int(2) ?? 0); // op2 = 工作纹理槽
  const first = (plan.int(3) ?? 0); // op3 = 起始绘制项 id
  const span = (plan.int(4) ?? 0); // op4 = 跨度 count
  const a = (plan.int(5) ?? 0); // op5 → `[16]`（通道 A 起点）
  const b = (plan.int(6) ?? 0); // op6 → `[17]`（通道 B 起点）
  const cc = (plan.int(7) ?? 0); // op7 → `[18]`（通道 C 起点）
  const d = (plan.int(8) ?? 0); // op8 → `[20]`（通道 A 终点）
  const ee = (plan.int(9) ?? 0); // op9 → `[21]`（通道 B 终点）
  const f = (plan.int(10) ?? 0); // op10 → `[22]`（通道 C 终点）
  const delay = (plan.int(11) ?? 0); // op11 = 延迟
  const dur = (plan.int(12) ?? 0); // op12 = 时长
  // raw 133905-133932：通道 D 两格**显式清零**（`ZoomBlur` 用 A/B/C 三个自由度 + CenterU/V）
  c.native.setTransition?.(id, [
    [0, 3],
    [1, 0],
    [2, delay],
    [3, dur],
    [4, texSlot],
    [5, first],
    [7, span],
    [13, 1],
    [16, a],
    [17, b],
    [18, cc],
    [19, 0],
    [20, d],
    [21, ee],
    [22, f],
    [23, 0],
  ]);
};

/** `0x229`（sub_423FE0 raw 31984-32001）：绘制模式 5 元组（2 int + 3 float）。 */
const op_set_draw_mode: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const a = (plan.int(1) ?? 0);
  const b = (plan.int(2) ?? 0);
  const x = (plan.float(3) ?? 0);
  const y = (plan.float(4) ?? 0);
  const z = (plan.float(5) ?? 0);
  c.native.setDrawModeBlock?.(a, b, x, y, z);
};

/** `0x242`（sub_4251A0 raw 32649-32658）：写 DrawItem `+720`（与相邻对象的 `+504`）。 */
const op_set_draw_entry_param: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const entry = (plan.int(1) ?? 0);
  const value = (plan.int(2) ?? 0);
  c.native.setDrawEntryParam?.(entry, value);
};

/**
 * `0x256`（sub_425C30 raw 33120-33135）→ `sub_4ACD10`（raw 131733）：
 * **按 id 区间做立即平移** —— `op1` = 起始 handle、`op2` = **count**（区间 `[op1, op1+op2)`）、
 * `op3/4/5` = 平移 x/y/z（float）。引擎对区间内**已存在**的绘制项执行
 * `+0x68 = 1`（用世界矩阵）+ `D3DXMatrixTranslation(+0x16C, …)`（写 **work** 矩阵，立即生效）+ 置脏。
 *
 * ★不是"随便写几个字段"：`DRAWCHARM.txt:182-186` 用它把收起态的侧边栏 21 个槽整体推 +0x6e
 *   （= 唯一的"收起摆位"手段）。宿主缝 `setSlotParams` 必须真的应用平移，见 `tickets/T-0028`。
 */
const op_set_slot_params: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const handle = (plan.int(1) ?? 0);
  const count = (plan.int(2) ?? 0);
  const x = (plan.float(3) ?? 0);
  const y = (plan.float(4) ?? 0);
  const z = (plan.float(5) ?? 0);
  c.native.setSlotParams?.(handle, count, x, y, z);
};

/**
 * `0x321`（sub_426BD0 raw 33839-33850）：MeshEntry 属性。
 *
 * 体全文（raw 33845-33849）：`v5 = readIntOperand(3); v4 = readIntOperand(2); v2 = readIntOperand(1);`
 * → `sub_4AE280(Scene, v2, v4, v5)`；被调体（raw 132798-132807）只有三句：
 * ```
 * sub_4AAB80(Scene, a2);                       // 缺失即建项
 * sub_40DC30(Scene + 266*4, &a2)[a3 + 7] = a4; // ★直接派生地址写：**没有任何范围校验**
 * Scene[11627] = 1;                            // 置脏
 * ```
 * ★**订正（`tickets/T-0155`）**：引擎对 `op2` 的取值域**不做任何校验**（`a3` 是 int，
 * `result[a3 + 7] = a4` 可以落在记录外的内存上 ⇒ 真机上是越界写）—— 所以"合法槽号范围"引擎
 * 自己也没定义。emulator 侧按 `Map<mesh, Map<index, value>>` 收下任意键（**比引擎安全**，
 * 且不改脚本可见行为：这条不回写操作数、不改控制流）⇒ 这里**不补一个引擎没有的校验**，
 * 只把"没有校验"这件事写清楚，免得下游以为"越界槽号会被拦"。
 * ★另：引擎写的是**一个 dword**（`a4` 原样），而消费端 `meshColor` 按字节取倍率
 * （`presenter` 的 `meshAttrsTint` 只读 ≥2 的下标）⇒ 本层保留原值，不在 handler 里截断
 * （截断会让快照/报告看不到脚本下发的原值）。
 */
const op_set_mesh_entry_attr: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const mesh = (plan.int(1) ?? 0);
  const index = (plan.int(2) ?? 0);
  const value = (plan.int(3) ?? 0);
  c.native.setMeshEntryAttr?.(mesh, index, value);
};

/** `0x32A`（sub_426F80 raw 34003-34010）：释放 3D 模型槽。 */
const op_release_3d_slot: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const slot = (plan.int(1) ?? 0);
  c.native.release3DSlot?.(slot);
};

/**
 * `0x32D`（sub_427040 raw 34033-34054）：**3D 颜色**。
 *
 * 引擎逐字（raw 34043-34053）：
 * ```
 * v2 = readIntOperand(1); v3 = readIntOperand(2);
 * if (v2 > 255) v2 = 255;                                     // 只判上界，**不**判负
 * v4 = (u8)v3 | ((BYTE1(v3) | (((v2 << 8) | BYTE2(v3)) << 8)) << 8);   // ARGB：B=u8 / G=BYTE1 / R=BYTE2 / A=v2
 * v6 = BYTE2(v4)·1/255 ; v7 = BYTE1(v3)·1/255 ; v8 = (u8)v3·1/255 ; v9 = HIBYTE(v4)·1/255
 * sub_499DF0(Scene, v6, v7, v8, v9)
 * ```
 * 轴向靠 `sub_499DF0`（raw 116583-116637）反推：`_this[13947] = v13 | ((v10 | ((v8 | (v15 << 8)) << 8)) << 8)`
 * 里 `v8 ← a2`、`v10 ← a3`、`v13 ← a4`、`v15 ← a5`，而 D3D 的 `SetRenderState(139, …)` 收的是
 * `(R<<16)|(G<<8)|B` ⇒ **`a2` = 红 = `BYTE2(v4)`、`a4` = 蓝 = 最低字节**。
 *
 * ★**订正（`tickets/T-0155`）**：修前实现把 `op2` 的**最低字节当红**（`(rgb & 0xff)/255`）、
 * 第三字节当蓝 ⇒ 所有 `0x32d` 下发的颜色**红蓝互换**。它不回写操作数、不报错，只在画面上错，
 * 所以只能靠合成指令的宿主缝实参钉住（守卫 `test/gfx-state-operand-io.test.ts`）。
 */
const op_set_3d_color: OpHandler = (c) => {
  const plan = planFor(c);
  const e = c.e;
  const a = (plan.int(1) ?? 0);
  const rgb = (plan.int(2) ?? 0) >>> 0; // 引擎按**无符号**取字节（`(u8)v3` / `BYTE1` / `BYTE2`）
  const alpha = (a > 255 ? 255 : a) / 255; // raw 34046-34047：只判 `> 255`（负值不钳）
  const r = ((rgb >>> 16) & 0xff) / 255; // raw 34049：BYTE2(v4) = 第三字节
  const g = ((rgb >>> 8) & 0xff) / 255; // raw 34050：BYTE1(v3)
  const b = (rgb & 0xff) / 255; // raw 34051：(u8)v3 = 最低字节
  c.native.set3DColor?.(r, g, b, alpha);
};


/**
 * `0x20D` **设置渲染目标**（`sub_423770` raw 31594-31602，argc=1）：`op1` → `sub_4A50C0(Scene, op1)`
 * （raw 124819-124912）。引擎里 `-1` = 回到后台缓冲（同函数 raw 127911 / 25284 的 `0xFFFFFFFF` 用法）。
 *
 * ★**它不是"渲染侧记录"就完了**：`0x203`/`0x322` 的混合选择子**值 2 是门控的** ——
 * 只有"当前渲染目标槽指向的纹理创建模式 == 1"（= 正在往 mode-1 离屏表面画）时才设 `(ONE,ZERO)` 覆盖，
 * 否则**什么都不设**（沿用当前混合）。见 `renderer/scene/blend.ts` 与 `tickets/T-0017`。
 * 语料用量：841 处（`i20d 2` / `i20d (local-int 0)`）。
 */
const op_set_render_target: OpHandler = (c) => {
  const plan = planFor(c);
  const slot = (plan.int(1) ?? 0);
  c.native.setRenderTarget?.(slot);
};

/**
 * `0x33F` **设置场景混合/颜色**（`sub_427A90` raw 34411-34448，argc=3）。
 *
 * 引擎逐字（raw 34422-34446，★读序 = **op2 → op3 → op1（两次）**）：
 * ```
 * v2 = readIntOperand(2);                                   // α
 * v3 = readIntOperand(3);                                   // 颜色
 * if (v2 <= 255) { if (v2 < 0) v2 = (unsigned)sub_4ADD60(Scene, readIntOperand(1)) >> 24; }
 * else v2 = 255;                                            // ★>255 钳 255；<0 ⇒ 由 op1 索取的项**当前 α**
 * if (v3 < 0) v3 = sub_4ADD60(Scene, readIntOperand(1));    // <0 ⇒ 该项**当前色**（整份 ARGB）
 * v6 = readIntOperand(1); v7 = _this[93384];                // = Scene
 * *(v7 + 1260) = v6;                                        // 场景默认混合选择子（消费点 sub_4535F0 raw 65858-65889）
 * *(v7 + 1264) = (u8)v3 | ((BYTE1(v3) | (((v2 << 8) | BYTE2(v3)) << 8)) << 8);
 * ```
 * ⇒ 两格的**轴向与 `0x32d` 完全同款**（ARGB：B=最低字节 / G=BYTE1 / R=BYTE2 / α=v2）。
 *
 * ★**`Scene+1264` 那半仍未建模**（`tickets/T-0017` 的未收敛项）：它在 raw 65904-65907 被下发给
 * 效果对象（`Scene+1036` vtable+12 = 混合常量 + `Scene+1040` vtable+20 = `Scene+1264`），
 * 是**效果通路的 shader 常量**，emulator 没有这条通路（建一个只写不读的字段就是死写，本工程判据）。
 * 本 handler 只承载混合选择子（`Scene+1260`，它会真的改变画面）。
 *
 * ★**订正（`tickets/T-0155`）**：修前实现只读 op1 ⇒ **op2/op3 两格整体没读**，α/颜色带回退的
 * 语义（`i33f 1 -1 -1` = "沿用该绘制项当前色"）被整段丢掉。现在三格按体读满并算出回退值
 * （回退源 = 宿主缝 `getDrawItemColor`，与 `0x202`/`0x203` 的 `sub_4ADD60` 同一个缝）。
 * 守卫 `test/gfx-state-operand-io.test.ts` 钉"三格全读 + 回退实参"；`Scene+1264` 的落点仍缺。
 * 语料用量：1 处（`src/SETWEATHER.txt:80 i33f 1 ff ffffff`）。
 */
const op_set_scene_blend: OpHandler = (c) => {
  const e = c.e;
  // ★读序照体：先 op2（α）、再 op3（颜色），回退时才读 op1；最后 op1 再读一次（`Scene+1260`）。
  let alpha = readIntOperand(e, c.frame, c.instr, 2);
  let color = readIntOperand(e, c.frame, c.instr, 3);
  if (alpha > 255) alpha = 255; // raw 34433-34435
  else if (alpha < 0) alpha = ((c.native.getDrawItemColor?.(readIntOperand(e, c.frame, c.instr, 1)) ?? -1) >>> 24); // raw 34427-34431
  if (color < 0) color = c.native.getDrawItemColor?.(readIntOperand(e, c.frame, c.instr, 1)) ?? -1; // raw 34437-34441
  const blend = readIntOperand(e, c.frame, c.instr, 1); // raw 34442-34444：`Scene+1260`
  // `Scene+1264` 的装配照体（raw 34446）—— 当前没有消费端，故不落地，只在这里写明口径：
  //   argb = (α << 24) | (color & 0xFFFFFF)
  void (((alpha & 0xff) << 24) | (color & 0xffffff));
  c.native.setSceneBlend?.(blend);
};

/** A4 族（真实现：2 条建模 + 16 条宿主缝；★`0x20D`/`0x33F` 是 `T-0017` 加的，★`0x24F`/`0x250`/`0x251` 是 `T-0076` 的 B3 补）。 */
export const GFX_STATE_OPS: OpTable = [
  [0x1fc, op_reset_prim_transform], // 复位图元变换
  [0x1fe, op_prim_transform4], // 图元变换 4 浮点
  [0x207, op_blit_slot_to_slot], // 槽→槽 StretchRect（同尺寸）
  [0x32, op_stretch_texture], // ★i032：槽→槽**缩放**转送（StretchTexture；存档缩略图的缩屏步）
  [0x20e, op_commit_graphics], // 图形提交（Clear）
  [0x224, op_clear_transitions], // 清转场表
  [0x24f, op_set_blind_wipe], // ★转场：SetBlindWipe（记录 [0]=2、[13]=类型 0..11）
  [0x250, op_set_transition_slide_blur], // ★转场：[0]=3、[13]=0（SlideBlur）
  [0x251, op_set_transition_zoom_blur], // ★转场：[0]=3、[13]=1（ZoomBlur）
  [0x229, op_set_draw_mode], // 绘制模式 5 元组
  [0x238, op_load_wait_timer], // 装载 0x400 等待门的计时器（建模）
  [0x243, op_reset_wait_timer], // ★复位 0x400 等待门的计时器（语料 341 处/338 脚本；审计 P1 op-3-002 缺口）
  [0x242, op_set_draw_entry_param], // DrawItem +720
  [0x256, op_set_slot_params], // 按 id 写 DrawItem 字段
  [0x258, op_set_slot_flags], // 纹理槽标志对（建模）
  [0x321, op_set_mesh_entry_attr], // MeshEntry 属性
  [0x32a, op_release_3d_slot], // 释放 3D 模型槽
  [0x32d, op_set_3d_color], // 3D 颜色
  [0x20d, op_set_render_target], // ★设置渲染目标（T-0017：混合选择子值 2 的门控依据）
  [0x33f, op_set_scene_blend], // ★场景默认混合选择子（Scene+1260）
];
