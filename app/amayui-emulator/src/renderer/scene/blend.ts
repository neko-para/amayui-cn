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
 * 2. **引擎是全局 state 机、会泄漏**（读代码如此）：draw-item 路径的 `0`/≥4 **不重置** blend state
 *    （raw 123100-123117 直接跳 LABEL_42）⇒ 一个 `1`/`2`/`3` 的项之后的 `0` 项**继承**它；
 *    mesh/model 路径画完后**显式留下** `BLENDOP=ADD` + `(ONE,ZERO)`（raw 119474-119476，
 *    `.lst:0049E681`-`0049E6AF`）⇒ 其后所有 draw-item 的 `0` 项都继承"覆盖"。
 *    ★但**这一条与真机可见行为矛盾**（照做会把 TITLE 的 logo 透明区写成黑、序章背景被覆盖）
 *    ⇒ `walkBlendSequence` 把它放在 `BlendWalkOptions.leakStateAcrossEntries`（**默认 false**），
 *    完整实现、可开关、并登记为未收敛项（详见 `BlendWalkOptions` 的说明与 `tickets/T-0017`）。
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
 * ★**入口档是一个"未确认"**：2D 合并段（raw 134417-136734）内**没有任何** SetRenderState 调用，
 * 也不调 `sub_4535F0` ⇒ 引擎进入合并时用的是**上一帧留下的**状态（3D 效果段 `sub_4535F0` 尾部是
 * `(ONE,ZERO)`，但它在合并**之后**）。emulator 取场景默认（= `'normal'`）——这条差异登记在
 * `tickets/T-0017/notes.md` 的"未确认"，要靠真机对照才能定。
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
 * ★★**`leakStateAcrossEntries` 默认 `false`（= 每个条目从场景默认重新开始）—— 这是"与真机一致"的那一档，
 * 而**不是**"读代码得出"的那一档。** 冲突与依据（`tickets/T-0017`，2026-09 实测）：
 *  - **代码读法**：draw-item 的 `0` 不重置 blend state（raw 123100-123117）、mesh 画完还把状态留在
 *    `(ONE,ZERO)`（raw 119474-119476，`.lst:0049E681`-`0049E6AF`）、`sub_4535F0` 尾部也是 `(ONE,ZERO)`
 *    （`.lst:00453777`-`00453791`）、而 2D 合并段（`sub_4B06D0` raw 134417-136734）里**没有任何**
 *    SetRenderState ⇒ 逐字照做的话，前一个 `1/2/3` 项（或任何 mesh）之后的 `0` 项都会"继承"那个档。
 *  - **实测矛盾**：照做之后 **TITLE 整屏错**（logo 的透明区被写成黑、背景被覆盖：Pixi 的源是**预乘**的，
 *    `(ONE,ZERO)` 会把 α=0 写成黑），序章也出现同类现象；而"每项从场景默认开始"这一档与
 *    真机截图一致（同一场景的 E4 对照见票据）。
 *  ⇒ 结论：**"合并段入口/逐项的 blend 状态由谁重设"这一块我还没读通**（引擎里必然还有一处每项重设，
 *  只是没找到调用点）。在此之前：默认按**真机可见行为**跑；把"泄漏"这条引擎逻辑**完整保留并在
 *  `leakStateAcrossEntries: true` 下可用**（不是删掉、也不是忽略），并把它登记为票据的未收敛项。
 */
export interface BlendWalkOptions {
  /**
   * `true` = 逐字照抄引擎的全局 state 机（`0` 继承前项、mesh 之后留 `(ONE,ZERO)`）。
   * 默认 `false` = 每个条目从场景默认重新开始（与真机可见行为一致；见上方说明）。
   */
  leakStateAcrossEntries?: boolean;
}
