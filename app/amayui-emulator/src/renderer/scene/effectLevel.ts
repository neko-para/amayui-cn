/**
 * **`Scene+46668` 3D 效果等级**（审计 §4.2 #20 `scene-3d-effect-level-writer`，P1）
 * 与它决定的两个 **scratch 槽（36/37）的创建模式**。
 *
 * ## 引擎体（raw 锚点 = `engine/天结_unpacked.exe_utf8.c`）
 *
 * `sub_4A6EE0`（场景初始化）raw 126548-126572：
 * ```c
 * if ( a3 < -1 || a3 > 2 || a3 == -1 )            {   // 没显式给档位 ⇒ 读 D3D 版本能力
 *   if ( v13 < 0xFFFF0200 ) *(_DWORD *)(_this + 46668) = v13 >= 0xFFFF0100;   // 0 或 1
 *   else                    *(_DWORD *)(_this + 46668) = 2;
 * } else                    *(_DWORD *)(_this + 46668) = a3;                  // 显式 0/1/2
 * if ( *(int *)(_this + 46668) >= 2 ) {
 *   sub_4A2C10(_this, 36, v9, (int)v11, 1);   // ★mode 1
 *   sub_4A2C10(_this, 37, v9, (int)v11, 1);
 * } else {
 *   sub_4A2C10(_this, 36, v9, (int)v11, 2);   // ★mode 2
 *   sub_4A2C10(_this, 37, v9, (int)v11, 2);
 * }
 * ```
 *
 * ## 为什么 mode 不是"只记录"
 *
 * `sub_4A2C10` 的第 5 实参就是 `CTexture+1048` 的创建模式（`0x1F8` 的 op4 走同一条路，
 * 见 `handlers/gfx-texture.ts`）。而 `scene/blend.ts` 的**混合门控**判据正是
 * "当前渲染目标槽的纹理创建模式 == 1"（`0x203`/`0x322` 的选择子 2；raw 123110-123115 /
 * 119381-119386）⇒ 等级 **2** 时 36/37 是 mode-1 离屏表面、可以吃到 `(ONE,ZERO)` 覆盖，
 * 等级 0/1 时不是 ⇒ **画面真的不同**。这也正是审计那句"emulator 恒等于等级 0 的无效果支"的机理。
 *
 * ## emulator 的取值
 *
 * 呈现后端是 WebGL（Pixi）：没有 D3D9 的 `0xFFFF0100` 版本上限 ⇒ 等价于"设备能力满档"
 * ⇒ `newSceneState()` 取 **2**（取值理由与可注入入口见 `SceneState.effect3DLevel` 与
 * `scSetEffect3DLevel`）。守卫 = `test/scene-3d-effect-level.test.ts`（三档断言 mode 与效果档位）。
 */

/** 转场用的两个 scratch 槽（引擎 `sub_4A2C10(_this, 36|37, …)`）。 */
export const SCENE_SCRATCH_SLOT_A = 36;
export const SCENE_SCRATCH_SLOT_B = 37;

/** `Scene+46668` 的合法档位（引擎 `a3 ∈ {0,1,2}`）。 */
export const EFFECT3D_LEVELS = [0, 1, 2] as const;

/**
 * **等级 ⇒ scratch 槽的创建模式**（`sub_4A6EE0` raw 126563-126572）：`>= 2 ⇒ 1`、否则 `2`。
 *
 * 为什么单独一个纯函数：它是**唯一**一处"等级 → 槽 mode"的映射，`newSceneState` 与
 * `scSetEffect3DLevel` 都调它（口径一处，不会出现"构造时一套、改等级时另一套"）。
 */
export function sceneScratchMode(level: number): number {
  return level >= 2 ? 1 : 2;
}

/**
 * **等级 ⇒ 主/副 ID3DXEffect 的资源 id**（raw 134820-134855 的惰性建）。
 *
 * `level >= 2 ⇒ 201`、`level >= 1 ⇒ 200`、否则 `null`（不建）；副槽 `level > 1 ⇒ 203`。
 * `0x326` 的**共享**效果另有资源 202 与 `level >= 1` 门（raw 23917-23932）。
 */
export function effect3DResourceFor(level: number): { main: number | null; alt: number | null } {
  return {
    main: level >= 2 ? 201 : level >= 1 ? 200 : null,
    alt: level > 1 ? 203 : null,
  };
}

/** 共享效果（`0x326`）的资源 id 与其门（`Scene+46668 >= 1`）。 */
export const EFFECT3D_SHARED_RESOURCE = 202;
export const EFFECT3D_SHARED_MIN_LEVEL = 1;
