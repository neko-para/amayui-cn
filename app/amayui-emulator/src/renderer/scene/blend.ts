/**
 * **alpha 混合模式模型** —— 引擎 `DrawItem+0x30`、`MeshEntry[9]` 与场景默认混合（`Scene+1260`）
 * 的**同一套 4 值枚举**，以及它在 emulator 侧的"逐绘制项状态机"。
 * （`tickets/T-0017`；引擎依据全部来自 `engine/天结_unpacked.exe_utf8.c` 的 raw 行号 + `.lst` 逐指令核对。）
 *
 * ## 枚举（值 → D3D 混合组合）
 * | 值 | D3D | 语义 |
 * |---|---|---|
 * | 0 / ≥4 | （draw-item：**不改**；mesh/model：`SRCALPHA/INVSRCALPHA`） | 默认 |
 * | 1 | `SRCALPHA(5)` / `ONE(2)` | 加算 |
 * | 2 | `ONE(2)` / `ZERO(1)`，**门控** | 覆盖（不混合） |
 * | 3 | `BLENDOP_REVSUBTRACT(3)` + `SRCALPHA(5)` / `ONE(2)` | 减算（`dst − src·sa`） |
 *
 * 依据：draw-item = `sub_4A2D50` raw 123089-123121（selector = 第 6 参 = 元素 `+0x30`，送达见
 * `sub_4AEEA0` raw 133443）；mesh/model = `sub_49E390` raw 119369-119399 / `sub_49E700` raw 119512-119578
 * （selector = `MeshEntry[9]`，送达见 `sub_4AF1C0` raw 133617）；场景默认 = `sub_4535F0`
 * raw 65855-65913（selector = `Scene+1260`，写点 = 指令 `0x33F` op1 → `sub_427A90` raw 34442-34444）。
 * 判定全是 `cmp 1/2/3` 的 if 链（无跳转表）；两处被 Hex-Rays 丢掉的 `DESTBLEND` 由
 * `engine/天结_unpacked.exe_utf8.lst` 解出（`.text:004A3191 push 1`、`.text:004A31BB push 2`）。
 *
 * ## ★两条容易忽略的引擎事实（本文件必须照做，不许"顺手统一"）
 * 1. **值 2 是门控的**：只有"当前渲染目标槽（`Scene+46456`，由 `0x20D` 写）指向的纹理创建模式
 *    （`CTexture+1048`，由 `0x1F8` 的 op4 写）== 1"（= 正在往 **mode-1 离屏表面**画）时才设 `(ONE,ZERO)`；
 *    否则**什么都不设**（沿用当前状态）。raw 119381-119386 / 123110-123115。
 * 2. ★**"全局 state 机会泄漏"这条读法已被证否**（`T-0041`，2026-09-16）：draw-item 的 `0`/≥4 确实
 *    **自己**不设 blend state（raw 123100-123117 跳 LABEL_42），但**每项一次 `ID3DXSprite::Begin`**
 *    会先把状态重设成 sprite 自身的默认 —— `sub_4A2D50` 在设任何状态**之前**调
 *    `(sprite+20)=SetTransform` + `(sprite+32)=Begin(16)，flags = D3DXSPRITE_ALPHABLEND`（raw 123087-123088），
 *    之后才设采样器/`ALPHATESTENABLE`/选择子（raw 123090-123120，全部是设备 vtable 间接调用 `+228`/`+276`
 *    ⇒ 符号 grep 看不到"合并段里的 SetRenderState"）⇒ 选择子 `0` 落到 **sprite 默认（SRCALPHA/INVSRCALPHA）**，
 *    mesh 留下的 `(ONE,ZERO)`（raw 119474-119476）**不会**传给后续 draw-item。
 *    ⇒ 真机就是"**每项从默认开始**"；`leakStateAcrossEntries` 因此只是**实验开关**（复刻那个并不存在的
 *    泄漏，用来解释 T-0017 的 E4 对照为什么必须关掉它），**默认 false 才是引擎事实**。
 *    mesh 侧另有显式默认：`sub_49E390`（raw 119397-119400）与 `sub_49E700`（raw 119521-119540）在
 *    选择子 `0`/≥4 时设 `(19,5)+(20,6=INVSRCALPHA)`。
 *
 * ## 与 Pixi 的对应（宿主侧映射，见 `pixi/presenter.ts`）
 * Pixi 的颜色是**预乘**的 ⇒ `D3D(SRCALPHA, ONE)` = `'add'`、`(SRCALPHA, INVSRCALPHA)` = `'normal'`、
 * `REVSUBTRACT + (SRCALPHA, ONE)` = `'subtract'`（`dst − src·sa`，公式一致）。唯一**近似**是
 * `(ONE, ZERO)` → `'none'`（关混合）：当 α<255 时 Pixi 写的是预乘色（偏暗），而 D3D 写的是未预乘的
 * `tex×diffuse`。这条差异登记在 `tickets/T-0017/notes.md`（要彻底对齐需要非预乘的着色路径）。
 */

/** 抽象混合档（与 Pixi 解耦；宿主负责映射到 `BLEND_MODES`）。 */
export type BlendState = 'normal' | 'add' | 'none' | 'subtract';

/** 判断混合档所需的环境（都来自 Scene 模型，见 `scene/state.ts` 的 `render4`）。 */
export interface BlendEnv {
  /**
   * **当前渲染目标纹理槽**（`Scene+46456`；`-1` = 后台缓冲）。由指令 `0x20D`（`sub_423770`
   * raw 31594-31602 → `sub_4A50C0` raw 124819-124912）写。
   */
  renderTargetSlot: number;
  /** 纹理槽的**创建模式**（`CTexture+1048`；由 `0x1F8` 的 op4 传入 `sub_4A2C10`→`sub_48AC40` raw 107026）。 */
  slotMode: (slot: number) => number | undefined;
  /**
   * `*(SceneHolder+1164) == 1` —— draw-item 路径末尾那条**追加覆盖**的唯一外部条件
   * （raw 123117-123121：`!Scene+46676 && Scene+46456 < 0 && *(Scene+1860 指向的持有者 + 1164) == 1`
   * ⇒ 强制 `(ONE,ZERO)`）。
   *
   * ★**未建模**：`Scene+1860` 是"渲染持有者"（其 `+1040` 是 D3D 设备，见 `sub_49E390` raw 119368），
   * 但 `+1164` 的语义未定（raw 49408 一处读、68484/71595 等处读的是**别的**对象）。
   * 默认 `false` = 该覆盖不生效；这条留在 `tickets/T-0017/notes.md` 的"未确认"里。
   */
  holder1164Is1?: boolean;
  /** `Scene+46676`（3D/文字渲染冻结总闸）—— emulator 未建模，默认 `false`。 */
  sceneFrozen?: boolean;
}

/** 门控：正在往 **mode-1 的离屏渲染目标**上画。 */
export function blendGateOpen(env: BlendEnv): boolean {
  const slot = env.renderTargetSlot;
  return slot >= 0 && env.slotMode(slot) === 1;
}

/**
 * **draw-item 路径**（`DrawItem+0x30`）的选择子 → 混合档。返回 `null` = **不改状态**（继承当前档）。
 *
 * raw 123093-123121：`1`→(5,2)、`2`→门控 (2,1)、`3`→(171,3)+(5,2)、`0`/≥4 → 什么都不设；
 * 末尾还有那条追加覆盖（见 `BlendEnv.holder1164Is1`）。
 */
export function blendForSelector(sel: number, env: BlendEnv): BlendState | null {
  let out: BlendState | null;
  if (sel === 1) out = 'add';
  else if (sel === 2) out = blendGateOpen(env) ? 'none' : null;
  else if (sel === 3) out = 'subtract';
  else out = null;
  // 追加覆盖（raw 123117-123121）：不动画冻结 + 画到后台缓冲 + 持有者 +1164==1 ⇒ 强制覆盖。
  if (!env.sceneFrozen && env.renderTargetSlot < 0 && env.holder1164Is1 === true) return 'none';
  return out;
}

/**
 * **mesh / DrawModel 路径**（`MeshEntry[9]`）的选择子 → 混合档。与 draw-item 的差别只有 `0`/≥4：
 * 这里**显式设 `(SRCALPHA, INVSRCALPHA)`**（raw 119387-119394 的 else 分支），不是"继承"。
 */
export function meshBlendForSelector(sel: number, env: BlendEnv): BlendState | null {
  if (sel === 1) return 'add';
  if (sel === 2) return blendGateOpen(env) ? 'none' : null;
  if (sel === 3) return 'subtract';
  return 'normal';
}

/**
 * **mesh/DrawModel 画完之后留下的状态**：`BLENDOP=ADD` + `(ONE, ZERO)` = 覆盖
 * （raw 119474-119476；`.lst` 逐指令 `push 1/0ABh`、`push 2/13h`、`push 1/14h`）。这是引擎的**行为**，
 * 不是笔误 —— 见本文件头部第 2 条。
 */
export const MESH_TRAILING_BLEND: BlendState = 'none';

/**
 * **场景默认混合**（`sub_4535F0` raw 65855-65889，selector = `Scene+1260`）→ 混合档。
 * ★注意它**没有门控**：`Scene+1260 == 2` 时无条件 `(ONE,ZERO)`。
 */
export function sceneDefaultBlend(sel: number): BlendState {
  if (sel === 1) return 'add';
  if (sel === 2) return 'none';
  if (sel === 3) return 'subtract';
  return 'normal';
}

/** 走一遍混合状态机的条目（**必须按绘制顺序**给）。 */
export interface BlendEntry {
  /** `'item'` = DrawItem（含文本项）；`'mesh'` = MeshEntry / DrawModel。 */
  kind: 'item' | 'mesh';
  /** 该条目的选择子（`Item.blend` / `MeshObj.blend`）。 */
  blend: number;
}

/**
 * **逐绘制项复刻引擎的混合状态机**，返回**每个条目实际生效的混合档**。
 *
 * 顺序 = presenter 的三路归并顺序（引擎 `sub_4B06D0` 同序）。初始档 = 场景默认
 * （`Scene+1260`；未设 `0x33F` 时 = `'normal'`，与 emulator 既有行为一致）。
 *
 * ★**每项的入口档 = `ID3DXSprite::Begin(16)` 设的默认**（`T-0041` 已定论）：2D 合并段
 * （raw 134417-136734）自己确实不设状态，但**每个 draw-item 的绘制函数**都包在
 * `SetTransform + Begin(16)` … `(sprite+44)` 里（raw 123087-123088 / 123250）⇒ 每项都从
 * sprite 默认（正常 alpha 混合）开始；`sub_4535F0` 的 `(ONE,ZERO)` 只影响不走 sprite 的路径。
 * emulator 取场景默认（= `'normal'`）与之等价。
 */
export function walkBlendSequence(
  entries: readonly BlendEntry[],
  env: BlendEnv,
  sceneBlend: number,
  opt: BlendWalkOptions = {},
): BlendState[] {
  const leak = opt.leakStateAcrossEntries ?? false;
  const out: BlendState[] = [];
  let cur: BlendState = sceneDefaultBlend(sceneBlend);
  for (const e of entries) {
    // ★关闭"泄漏"档时：**每个条目从场景默认重新开始**（= 真机可见行为，见 `BlendWalkOptions`）。
    if (!leak) cur = sceneDefaultBlend(sceneBlend);
    if (e.kind === 'item') {
      const next = blendForSelector(e.blend, env);
      if (next !== null) cur = next;
      out.push(cur);
      continue;
    }
    const next = meshBlendForSelector(e.blend, env);
    if (next !== null) cur = next;
    out.push(cur);
    if (leak) cur = MESH_TRAILING_BLEND; // 画完之后引擎把状态留在 (ONE,ZERO)（raw 119474-119476）
  }
  return out;
}

/**
 * `walkBlendSequence` 的档位。
 *
 * ★★**`leakStateAcrossEntries` 默认 `false`（= 每个条目从默认重新开始）—— 这就是引擎事实**，
 * 依据已由 `T-0041` 在 2026-09-16 读通（raw 锚点见下）：
 *  - 2D draw-item 的 blend 由**每项一次 `ID3DXSprite::Begin(16)`**（flags = D3DXSPRITE_ALPHABLEND）重设：
 *    `sub_4A2D50` 在设任何状态**之前**调 `(sprite+20)=SetTransform` + `(sprite+32)=Begin(16)`
 *    （raw 123087-123088），随后才设采样器 / `ALPHATESTENABLE` / 选择子（raw 123090-123120；
 *    **全是设备 vtable 间接调用** `+228`/`+276` ⇒ 符号 grep 看不到"合并段里的 SetRenderState"）；
 *    收尾调 `sprite+44`（raw 123250）。⇒ 选择子 `0`/≥4（自己什么都不设）落到 **sprite 默认
 *    （`SRCALPHA`/`INVSRCALPHA`）**，前一项的档与 mesh 留下的 `(ONE,ZERO)`（raw 119474-119476）
 *    **都不会**传给后续 draw-item。
 *  - mesh 侧另有显式默认：`sub_49E390`（raw 119397-119400）与 `sub_49E700`（raw 119521-119540）
 *    在选择子 `0`/≥4 时设 `(19,5)+(20,6=INVSRCALPHA)`。
 *  - 曾经的"读法冲突"来自把 vtable 间接调用当成不存在：`SetRenderState` = `(*(*(device)+228))`，
 *    228 = 57×4 = `IDirect3DDevice9::SetRenderState` 的槽。
 *  ⇒ 默认档 = `'normal'`（每项从默认开始）；`leakStateAcrossEntries: true` 只作为**实验开关**
 *  （复刻那个并不存在的泄漏，用来解释 T-0017 的 E4 对照为什么必须关掉它）。
 */
export interface BlendWalkOptions {
  /**
   * `true` = 逐字照抄引擎的全局 state 机（`0` 继承前项、mesh 之后留 `(ONE,ZERO)`）。
   * 默认 `false` = 每个条目从场景默认重新开始（与真机可见行为一致；见上方说明）。
   */
  leakStateAcrossEntries?: boolean;
}
