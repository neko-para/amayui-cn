# T-0076 · 过程文档（notes.md）

## 2026-09-19

B0（T-0081）缺口台账建成后，本票的范围被量化：语料用到但三张注册表都没有的 opcode 共 **58 条**（累计 2394 次调用），审计只覆盖了其中语料量最大的 21 条；完整清单按语料量排序见 docs-new/03-engine/opcode-gaps.md。0x2E9 / 0x228 已在 B1 落地（disposition=implemented）。

## 2026-09-19

B3 批次（目标轮 2）又落地两条 + 一处口径订正：① **0x243**（复位 0x400 等待门计时器，语料 341 处/338 脚本）—— 与 0x238 成对；门控 Engine[92340] bit1；Engine[92336] 全反编译 4 写 0 读 ⇒ 不建模；守卫 test/op-a4-a6.test.ts。② **0x1A6 halve-strlen**（语料 217 处/215 脚本）—— op1 = strlen(op2)>>1，**字节**口径；守卫 test/op-string-len.test.ts。③ 顺带订正 **0x2C5**：引擎 strlen 是**字节**长（SJIS 日文 2 字节/字），emulator 此前与 0x2C6（_mbstrlen 字符数）共用 .length ⇒ 日文串长度偏小一半；现按体分开（新增 text/layout.ts 的 sjisByteLength）。缺口台账：未实现 58 → 56 条、语料调用 2394 → 1836 次。

## 2026-09-19

B3 第三条（目标轮 3）：**0x20B FillTexture**（语料 204 处/187 脚本）—— 往纹理槽表面填纯色矩形。按体（sub_423690 raw 31569-31592 → sub_4A4C70 raw 124572 起）：op1=槽、op2/op3=左上角、op4/op5=**宽/高**（旧注『op4=op2+宽』写反，已订正 opcode-table.md）、op6=α 夹 255、op7=RGB 组装成 0xFFRRGGBB（A 固定 FF）。实现：GFX_TEXTURE_NATIVE_OPS 的 op_fill_texture → 新宿主缝 native.fillSlotRect（Pixi 走 TextureCache.fillSlotRect 真画进槽画布；headless 记 SceneState.slotFills，与 slotText 同源设计；桩/白名单同步），守卫 test/op-20b-fill-texture.test.ts。缺口台账：未实现 58 → 55 条、语料调用 2394 → 1632 次。下一条候选：local-ret(668，需先读懂 HWL 深度/返回机制)、0x140(181)、0x223(178，Scene+1048 记录表族)、0x235/0x230(需先定渲染侧语义，否则新增字段会被 check:dead-writes 拦)。

## 2026-09-19

B3 第四条（目标轮 4，本批最大的一条）：**0x7C local-ret**（语料 **668 处 / 334 个脚本**）—— 它不是普通的

## 2026-09-19

B3 第五条（目标轮 5）：**0x140 定性并登记为 deferred**（语料 181 处/181 文件，每场景 1 处）。体（sub_42FBC0 raw 39570-39638）：op2/op3 两个字符串有界拷进 256B 缓冲、op4 一个 int，组成 {str2,str3,op4} 后调 **间接函数指针** dword_55E1B4(8, Engine[96981], &v16)（返回值写回 op1），前后按 Engine[167990]（显示模式）套 sub_406050/sub_406220。dword_55E1B4 由 sub_453870 运行时取得（另有 cmd 3/4 两处调用）⇒ **静态定不了目标服务**，实现前需要真机观察/动态调试；按计划第 3 类处置（显式缺口 + 依据）登记，不再当成

## 2026-09-19

B3 第六/七条（用户要求继续后第 1 轮）：① **0x191 fabs**（语料 13 处）—— op1 = |op2|（浮点；体 raw 37896-37906：arity 槽=5 ⇒ argc 2、sub_41C300(2) → fabs → writeFloatOperand(1)）；实现 ARITHMETIC_OPS 的 op_fabs，守卫 test/op-191-fabs.test.ts。② **0x307 SetConfig(system:EffectSkipOnClick)**（语料 3 处，含开机写入 INITREGINPUT.txt:6）—— 它是 0x306 getter 的**唯一写入端**（审计 P1 op-3-003）；实现 ENGINE_FIELD_OPS 的 op_set_effect_skip（setConfigValue，与 0x306 同一份注册表），守卫 test/engine-config.test.ts 的 0x307→0x306 往返断言。台账：已实现 6 → 8 条、未实现 53 → 51 条、语料调用 783 → 767 次。

## 2026-09-19

B3 第八条（目标轮 13）：**0x223**（语料 178 处/178 个脚本，剩余缺口中语料量最高的一条）—— 给绘制项登记「区域记录」。体：sub_423F00（raw 31936-31958，arity 槽 17 ⇒ argc 8）读 op1..op8 → sub_4ADDB0(Scene, handle=op1, 槽=op2, …)，后者在 Scene+1048 的 map 里按 handle 写 9 dword（[0]=0,[1]=0,[2]=op7,[3]=op8,[4]=op2,[5]=op3,[6]=op5,[7]=op4,[8]=op6；★6/7 与 op5/op4 交叉），并在该槽无纹理对象时 sub_4A2C10 惰性建。实现：GFX_ITEM_OPS 的 op_set_item_region + 新字段 Engine.itemRegions（**逐格原样存，不做语义猜测**）；★标为「部分」：惰性建纹理与渲染侧消费端仍未建模（缺口留在本票）。守卫 test/op-223-item-region.test.ts（写序逐格断言 + 覆盖/多 handle）。台账：未实现 51 → 50 条、语料调用 767 → 589 次；已实现 8 → 9。

## 2026-09-20

### 本轮为何仍保持 doing（P0 的核心危害未完全消除）

判据对照：
1. ✅ **每条按三种处置之一落地** —— `unimplemented` 已降到 **0**（语料 0）；未注册项全部变成"读过体 + 写清扩展点"的 `deferred` / 有据 no-op。
2. 🔜 **优先补会回写操作数的 getter**：`0x228`/`0x23F`/`0x191`/`0x2E9` ✅ 已实现；**`0x23A` 仍未实现**（判据 1 的第 ③ 条：已显式登记缺口 —— `Engine+91322` 表元素类型未确证、全反编译无写点、`+1068` 无消费者）。
3. ✅ **`0x307` 与 `0x306` 成对**（MODE 1 已完成）。
4. ✅ **守卫**：`test/opcode-gaps.test.ts`（新增未登记缺口即红）+ `test/opcode-operands.test.ts` 覆盖。
5. ✅ **capabilities 台账**：`render-3d-layer-dual-commit`（0x222）已从 `n/a-known` 改为 **absent / E1**（note 写明"原先标 n/a-known 掩盖了缺口"）。
6. ✅ **`npm run verify` 全绿**（722 tests / 721 pass / 1 skip / 0 fail，死写 0）。

**仍不满足本票标题的"命中即硬停"这一半**：`deferred` 条目**不在任何注册表里**，其语义不会被执行
（严格模式抛 `NotImplementedOp`，诊断模式跳过并计数）。实测残留 = **31 条 / 312 处语料调用点**：
- 最大三档：`0x140`(**181**，经 `dword_55E1B4` 运行时解析 ⇒ 需真机/动态) / `0x28`(32) / `0x86`(16)；
- 其后：`0x222`(10) / `0x87`(9) / `0x22f`(7) / `0x22c`(6) / `0x236`(6) / `0x36`(5) / `0x1d0`(5) / `0x22d`(5)，其余 ≤4；
- 本次新判定的 6 条：`0x22a`(2)/`0x22c`(6)/`0x22d`(5)/`0x22f`(7)/`0x1c4`(1)/`0x23a`(1)。

⇒ **收口条件建议改为**：当 `deferred` 里"语料 > 0"的条数降到 0（即每条都进了某张表或有等价的宿主缝）时才关本票；
在此之前它是"待建模型"的公共账本，扩展点写在 `analysis/opcode-gaps.json` 的 note 与 `docs-new/03-engine/opcode-gaps.md` §6。
派生票：`T-0084`（转场扫描带渲染）、`T-0085`（`set:BlankExtentMode` 门）、`T-0086`（`0x249` 归一化，done）。
