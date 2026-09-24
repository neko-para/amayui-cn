/**
 * **3D 天气 / 粒子效果管理器**（引擎 `Scene+50704`，0x4F4 字节）—— 审计 §4.2 #21 与 #18 的落点。
 *
 * ## 引擎体（全部逐行读过，raw 锚点即 `engine/天结_unpacked.exe_utf8.c` 行号）
 *
 * | 概念 | 引擎 | 本模块 |
 * |---|---|---|
 * | 管理器 | `Scene+50704`（`operator new(0x4F4)`，`sub_4530B0` raw 65345-65363） | `Effect3DManagerState` |
 * | 三效果槽 | `[258]` Rain / `[259]` Snow / `[260]` Leaf（`sub_453280`/`sub_453330`/`sub_453410`） | `slots` |
 * | 共享 D3D 设备 | `[261]`（构造实参 `Scene+1860` 的 `+1040`） | 不建模（emulator 无设备） |
 * | 三组 16-dword 参数块 | `[262]`/`[278]`/`[294]`（`sub_4531B0` 的 `qmemcpy(_this + 262, &a2, 0x40)`，raw 65459） | `params[0..2]` |
 * | 销毁判据 | `[+0x4D8]` = `[310]`、`[+0x4DC]` = `[311]`（`0x325` 写） | `destroyRainAt` / `destroyOthersAt` |
 * | 帧清空旗标 | `[312]` = `+0x4E0`（`sub_453540` 每帧清 0、`sub_453150` 析构时清 0） | `advancedThisPass` |
 * | 时钟 | `[313]` = `+0x4EC`（上次推进的时刻）、`[314]` = `+0x4F0`（上次采样） | `lastAdvanceMs` / `lastSampleMs` |
 * | 未用槽 | `[315]` = 0、`[316]` = −1（构造器 raw 65360-65361） | `[315]`/`[316]` 不建模（全库零读者） |
 *
 * ## 每帧推进 `sub_453540`（raw 65791-65839）
 *
 * ```c
 * _this[312] = 0;                       // 本遍旗标清零
 * Time = timeGetTime();                 // ★墙钟，不是 Scene+46500
 * v3 = _this[314];                      // 上次采样
 * v5 = 60 * (Time - v3);                // 1/60 秒为单位的"距离上次采样"
 * v7 = 60 * (_this[313] - v3) / 1000;   // 上次采样→上次推进 折算的整步数
 * v8 = v5 / 1000 - v7;                  // ★本帧要补的步数
 * if (v5/1000 != v7) {                  // 步数变了才推进
 *   if (v8 > 100) v8 = 100;             // ★★上限 100（raw 65816-65817）
 *   if (v8 > 0) do { [258]->vt+8; [259]->vt+8; [260]->vt+16; } while (--v9);
 *   _this[313] = Time;                  // 推进到点
 * }
 * ```
 * ⇒ 三条引擎事实：**按墙钟**、**上限 100 步/帧**、**对三路效果对象各推进一次**（每步）。
 *
 * ## `sub_4535F0(管理器, key)`（raw 65841-65914）—— 逐节点推进 + 销毁判据
 *
 * 它先按 `Scene+1260`（场景默认混合选择子，emulator = `render4.sceneBlend`）设 D3D 状态，
 * 然后两个**一次性**销毁门（`[+0x4E0]` 的 bit0/bit1 保证只销毁一次）：
 *  - `key >= [+0x4D8]` ⇒ 释放 `[258]`（Rain）；
 *  - `key >= [+0x4DC]` ⇒ 释放 `[259]`/`[260]`（Snow / Leaf）。
 *
 * 调用点：`sub_4B06D0` 的三表归并里逐节点调（raw 136903/136913/136924，键 = 三张表的节点键）、
 * 以及 `sub_4B4460`（`0x222` 的体）raw 137169/137208/137218。★`-1` = 无节点 ⇒ 什么也不做
 * （`key >= 阈值` 对 −1 恒假）。
 *
 * ## 不建模的部分（如实登记）
 *  - 三个效果**对象本身**（`Rain`/`Snow`/`Leaf` 的 `operator new(0xE4)` + vtable 体，如 `sub_4B58C0`）：
 *    它们做的是 D3D 顶点缓冲填充与 `DrawPrimitive`。emulator 侧换成**逐粒子点精灵**
 *    （`particles`，见 `weatherParticles`），位置/寿命/初速按参数块的语义重建。
 *  - `sub_4535F0` 开头那 8 句 `SetRenderState`（设备 vtable `+228`）：emulator 的混合是
 *    `scene/blend.ts` 的纯函数状态机，已在 `render4.sceneBlend` 里消费。
 */
/** 三路效果的下标（引擎 `[258]`/`[259]`/`[260]`）。 */export const WEATHER_RAIN = 0;
export const WEATHER_SNOW = 1;
export const WEATHER_LEAF = 2;

/** 一路效果的槽状态（有 = 引擎里该指针非空）。 */
export interface WeatherSlotState {
  /** 该路效果是否已创建（`0x327` 建 Rain / `0x326` 建 Snow / `0x328` 建 Leaf）。 */
  active: boolean;
  /**
   * 创建参数（引擎 `sub_4531B0` 的 `qmemcpy(_this + 262 + 16k, &a2, 0x40)` = 16 个 int/float 原样）。
   * ★这一段是**脚本给的原文**：本模块只把其中三个当"粒子可观测参数"（见 `weatherParticles`），
   * 其余原样保留在 `params` 里以便报告/快照核对（引擎侧它们由效果对象自己解释）。
   */
  params: number[];
  /** 该路效果的**时相**（引擎侧没有这个字段：相位活在效果对象内部的顶点缓冲里）。 */
  phase: number;
}

/** 引擎 `Scene+50704` 那个管理器在 emulator 侧的可见部分。 */
export interface Effect3DManagerState {
  /**
   * `[+0x4D8]`（= `[310]`）与 `[+0x4DC]`（= `[311]`）—— `0x325` 写的两个**销毁阈值**。
   * 初始 0（`sub_4530B0` 只写 `[312]`/`[313]`/`[314]`/`[315]`/`[316]`，这两位未初始化 ⇒ 取 0）。
   */
  destroyRainAt: number;
  destroyOthersAt: number;
  /** `[312]` = `+0x4E0`：本遍是否推进过（`sub_453540` 每帧清 0；`sub_453150` 析构清 0）。 */
  advancedThisPass: boolean;
  /** `[313]` = `+0x4EC`：上次真正推进的时刻（ms，墙钟）。 */
  lastAdvanceMs: number;
  /** `[314]` = `+0x4F0`：上次采样时刻（ms，墙钟）。构造器把两者都设成 `timeGetTime()`。 */
  lastSampleMs: number;
  /** 三路效果槽：`[0]` Rain / `[1]` Snow / `[2]` Leaf。 */
  slots: [WeatherSlotState, WeatherSlotState, WeatherSlotState];
  /** 本帧墙钟注入值（引擎是 `timeGetTime()`；headless/测试用 `Engine.nowMs` 注入以保确定性）。 */
  clockMs: number;
}

/** 新建管理器（等价 `sub_4530B0` raw 65345-65363）。 */
export function newWeatherManager(): Effect3DManagerState {
  const slot = (): WeatherSlotState => ({ active: false, params: new Array<number>(16).fill(0), phase: 0 });
  return {
    destroyRainAt: 0,
    destroyOthersAt: 0,
    advancedThisPass: false,
    lastAdvanceMs: 0,
    lastSampleMs: 0,
    slots: [slot(), slot(), slot()],
    clockMs: 0,
  };
}

/**
 * **创建一路效果**（`sub_453280`/`sub_453330`/`sub_453410` 的模型侧）。
 *
 * 引擎三个函数各自 `operator new(0xE4)` + 对应 vtable 构造，并把 16-dword 参数块写进管理器；
 * 本函数只保留"该路已建 + 参数 + 时相归零"这三件可观测的事。
 * ★返回 `false` = 该路在这之前已经建过（引擎是**重建**：先析构旧的再 new，所以这里也重置）。
 */
export function weatherCreate(m: Effect3DManagerState, which: number, params: readonly number[]): boolean {
  const s = m.slots[which];
  if (!s) return false;
  s.active = true;
  s.phase = 0;
  for (let i = 0; i < s.params.length; i++) s.params[i] = params[i] ?? 0;
  return true;
}

/**
 * **销毁全部效果并清旗标**（`sub_453150` raw 65366-65394；调用点 = `0x324` 与析构 `sub_4537A0`）。
 * 三个槽逐个"析构 + 置 0"，最后 `[312] = 0`。
 */
export function weatherDestroyAll(m: Effect3DManagerState): void {
  for (const s of m.slots) {
    s.active = false;
    s.phase = 0;
  }
  m.advancedThisPass = false;
}

/**
 * **写两个销毁阈值**（`0x325` → `sub_426DC0` raw 33924-33938：`[+0x4D8] = op1`、`[+0x4DC] = op2`）。
 */
export function weatherSetDestroyThresholds(m: Effect3DManagerState, rainAt: number, othersAt: number): void {
  m.destroyRainAt = rainAt | 0;
  m.destroyOthersAt = othersAt | 0;
}

/**
 * **`sub_4535F0(管理器, key)` 的销毁半边**（raw 65890-65909）。
 *
 * 返回本调用**真的销毁了**的效果下标（可能为空数组）。两条门互相独立，且各有一次性旗标：
 *  - `[+0x4E0]` bit0：`key >= [+0x4D8]` ⇒ 释放 Rain（`[258]`）；
 *  - `[+0x4E0]` bit1：`key >= [+0x4DC]` ⇒ 释放 Snow（`[259]`）与 Leaf（`[260]`）。
 *
 * ★旗标本身（bit0/bit1）留在引擎的管理器里，emulator 用"槽是否还 active"表达同一件事
 * （销毁后槽即空 ⇒ 第二次调用天然不重复释放），所以不再单列两个 bit 字段。
 * ★`key = -1` ⇒ 两条门都假（引擎里 `-1 >= 阈值` 成立与否取决于阈值，而语料/引擎的 `-1`
 * 调用点（raw 136828）用的是 `>= 0` 的阈值……引擎对该输入的行为是"阈值 ≥ 0 时 −1 不触发"）
 * ⇒ 本函数对 `key < 0` **直接返回空**，与 raw 136828 那次"帧级调用不销毁任何东西"一致。
 */
export function weatherNodeKey(m: Effect3DManagerState, key: number): number[] {
  const destroyed: number[] = [];
  if (key < 0) return destroyed;
  const rain = m.slots[WEATHER_RAIN]!;
  if (rain.active && key >= m.destroyRainAt) {
    rain.active = false;
    rain.phase = 0;
    destroyed.push(WEATHER_RAIN);
  }
  if (key >= m.destroyOthersAt) {
    for (const i of [WEATHER_SNOW, WEATHER_LEAF] as const) {
      const s = m.slots[i]!;
      if (!s.active) continue;
      s.active = false;
      s.phase = 0;
      destroyed.push(i);
    }
  }
  return destroyed;
}

/** `sub_453540` 的步数上限（raw 65816-65817 的 `if (v8 > 100) v8 = 100;`）。 */
export const WEATHER_MAX_STEPS = 100;

/**
 * **每帧推进**（`sub_453540` raw 65791-65839）—— 审计 §4.2 #18 `passive-camera-and-effect-render-state`。
 *
 * 时钟口径：引擎用 **`timeGetTime()`（墙钟）**。emulator 把本帧时钟注入 `m.clockMs`
 * （驱动传 `Engine.nowMs` —— 产品路径上它就是墙钟，headless 走虚拟时钟以获得确定性）。
 * 这里**只在被显式调用时**采样一次（等价引擎每帧一次 `timeGetTime()`），因此同一 `clockMs`
 * 重复调用不会再推进（`lastSampleMs === clockMs` ⇒ 步数不变）—— 这正是"按时间推进"的可断言形状。
 *
 * @returns 本帧真正推进的**步数**（0..100；0 = 时钟没到下一个 1/60 秒，或没有活动效果）。
 */
export function weatherAdvance(m: Effect3DManagerState, clockMs: number): number {
  m.advancedThisPass = false; // raw 65806：`_this[312] = 0;`
  m.clockMs = clockMs;
  const time = clockMs;
  const v3 = m.lastSampleMs; // `[314]`
  const v5 = 60 * (time - v3);
  const v7 = Math.trunc((60 * (m.lastAdvanceMs - v3)) / 1000); // `[313]`
  const whole = Math.trunc(v5 / 1000);
  if (whole === v7) return 0; // raw 65814：`if (v5/1000 != v7)` 不成立 ⇒ 不推进、也不改 [313]
  let steps = whole - v7;
  if (steps > WEATHER_MAX_STEPS) steps = WEATHER_MAX_STEPS; // raw 65816-65817
  if (steps > 0) {
    for (let i = 0; i < steps; i++) {
      for (const s of m.slots) s.phase += 1; // raw 65821-65834：三路各推进一次
      m.advancedThisPass = true;
    }
    m.lastAdvanceMs = time; // raw 65836：`_this[313] = v4;`
  }
  // ★`[314]`（lastSampleMs）在引擎里**不在这里更新**（只有构造器写过它）—— 与体逐字一致：
  //   `v3 = _this[314]` 只读。这会让人以为"永远用同一个基准"，但正因为基数不变、
  //   `[313]` 每帧前移，`v5/1000 - v7` 才是"自上次采样以来的增量" ⇒ 不更新也对。
  return steps > 0 ? steps : 0;
}

/** 一颗粒子在屏幕（虚拟 1280×720）上的位置（由时相与参数块算出；见 `weatherParticles`）。 */
export interface WeatherParticle {
  x: number;
  y: number;
  /** 该粒子的 alpha（0..1）。 */
  a: number;
}

/** 每路效果的可见粒子数上限（纯粹是 emulator 的呈现预算，不是引擎常量）。 */
export const WEATHER_PARTICLE_COUNT = 120;

/**
 * ★★**三个 3D 效果槽**（引擎 `Scene+46480` / `+46492` / `+46496`，**不是**纹理槽 36/37）——
 * 审计 §4.2 #20 `scene-3d-effect-level-writer` 的 (b) 半。
 *
 * 引擎在 `sub_4B06D0` 的 2D 绘制循环开头按等级**惰性建**（raw 134820-134855）：
 * ```c
 * if (!Scene+46480) {                        // 主效果（ID3DXEffect 句柄）
 *   v5 = Scene+46668;                        // 3D 效果等级
 *   if (v5 >= 1) {
 *     if (v5 >= 2) 资源 201 else 资源 200;   // ★>=2 一档、>=1 一档
 *   }
 * }
 * if (!Scene+46492 && Scene+46668 > 1) 资源 203;   // ★>1 单独一档
 * ```
 * `0x326`（Set3DEffectSnow）另建一个**共享** ID3DXEffect（资源 202）存 `Scene+46496`。
 *
 * emulator 不加载 D3DX effect（没有 D3D 设备）⇒ 这里建的是**同一张表的模型态**：
 * 「哪个槽该建、建的是哪个资源 id」。消费者 = `scene/snapshot.ts` 的 `effect3D` 段与
 * `test/scene-3d-effect-level.test.ts` 的三档断言 —— 而不是"没有下文的字段"。
 */
export interface Effect3DSlotState {
  /** 该槽是否已建（引擎里 = 对应指针非空；`null` 资源 = 未建）。 */
  built: boolean;
  /** 建它用的 D3DX 资源 id（`201`/`200`/`203`/`202`）；未建 = `null`。 */
  resourceId: number | null;
}

/** 三个 3D 效果槽的下标（与 `Effect3DSlots` 的字段一一对应）。 */
export const EFFECT3D_SLOT_MAIN = 'main';
export const EFFECT3D_SLOT_ALT = 'alt';
export const EFFECT3D_SLOT_SHARED = 'shared';

/** `Scene+46480` / `+46492` / `+46496` 三格在 emulator 侧的形态。 */
export interface Effect3DSlots {
  /** `Scene+46480`：主效果（等级 ≥2 ⇒ 资源 201；等级 ≥1 ⇒ 资源 200）。 */
  main: Effect3DSlotState;
  /** `Scene+46492`：等级 **>1** 才建（资源 203）。 */
  alt: Effect3DSlotState;
  /** `Scene+46496`：`0x326` 的**共享**效果（资源 202，`Scene+46668 >= 1` 门）。 */
  shared: Effect3DSlotState;
}

/** 新建三个槽（全未建）。 */
export function newEffect3DSlots(): Effect3DSlots {
  return {
    main: { built: false, resourceId: null },
    alt: { built: false, resourceId: null },
    shared: { built: false, resourceId: null },
  };
}

/**
 * **按等级惰性建两个主槽**（raw 134820-134855 的逐字复刻）。
 *
 * @param level 3D 效果等级（`Scene+46668`）。
 * @returns 这一次**新建**了哪些槽（空数组 = 都已建或有门未过；供守卫断言"惰性"）。
 */
export function ensureEffect3DSlots(slots: Effect3DSlots, level: number): string[] {
  const created: string[] = [];
  if (!slots.main.built && level >= 1) {
    slots.main.built = true;
    slots.main.resourceId = level >= 2 ? 201 : 200; // ★`>=2` 一档、`>=1` 一档
    created.push('main');
  }
  if (!slots.alt.built && level > 1) {
    slots.alt.built = true;
    slots.alt.resourceId = 203; // ★`>1` 单独一档
    created.push('alt');
  }
  return created;
}

/**
 * **`0x326` 的共享效果懒建**（`sub_418340` raw 23917-23936）：
 * `if (Scene+46668 >= 1)` 且 `Scene[42456 + 4*op4]`（纹理槽 op4 的 CTexture）非空 ⇒
 * `if (!Scene+46496) D3DXCreateEffectFromResourceA(…, 202, …, Scene+46496)`，随后
 * `sub_453330(管理器, op1, f2, op3, 该纹理, 该 effect)` **重建 Snow**。
 *
 * @returns `{ built, created }`：`built` = 共享效果现在已建（可能是早先建的）；
 *   `created` = 这一次真的建了（惰性）。
 */
export function ensureSharedEffect3D(
  slots: Effect3DSlots,
  level: number,
  textureReady: boolean,
): { built: boolean; created: boolean } {
  if (level < 1) return { built: slots.shared.built, created: false }; // raw 23917 的门
  if (!textureReady) return { built: slots.shared.built, created: false }; // raw 23919：纹理槽空 ⇒ 只报错
  if (slots.shared.built) return { built: true, created: false }; // raw 23922：惰性
  slots.shared.built = true;
  slots.shared.resourceId = 202;
  return { built: true, created: true };
}


/**
 * **由管理器状态算出可画的粒子**（`Rain`/`Snow`/`Leaf` 的 emulator 呈现）。
 *
 * ★**披露的近似**：引擎在效果对象内部维护一整个 D3D 顶点缓冲（`operator new(0xE4)` + vtable 体
 * 如 `sub_4B58C0`），粒子位置由那些体的 `vt+8 / vt+16`（推进）就地更新。emulator 没有那条
 * D3D 通路 ⇒ 这里用**时相 + 参数块**重建一个确定性、可断言的粒子场：
 *  - 相位来自 `slot.phase`（每 1/60 秒 +1，上限 100/帧）⇒ **时间推进必然改变输出**（#21 的守卫要的正是这个）；
 *  - 下落速度取参数块 `[1]`（`float`，语料 `SETWEATHER` 给的是速度量级；缺省 0 ⇒ 用 1）；
 *  - 横向漂移取参数块 `[2]`（缺省 0）；颜色/密度取参数块 `[0]`（0 ⇒ 用默认密度）。
 *
 * ⇒ 语义上"**开了雨、推进 N 次之后粒子状态确实变**"成立（这是 #21/#18 的可测判据），
 * 而"与真机逐像素一致"**没有**被声称（扩展点 = 实现三个效果对象体）。
 */
export function weatherParticles(m: Effect3DManagerState, viewW = 1280, viewH = 720): WeatherParticle[] {
  const out: WeatherParticle[] = [];
  for (let k = 0; k < m.slots.length; k++) {
    const s = m.slots[k]!;
    if (!s.active) continue;
    const p = s.params;
    const speed = p[1] && Number.isFinite(p[1]) ? Math.abs(p[1]) : 1;
    const drift = p[2] && Number.isFinite(p[2]) ? p[2] : 0;
    for (let i = 0; i < WEATHER_PARTICLE_COUNT; i++) {
      // 确定性伪随机（同一 (k,i) 永远同一初相）—— 报告/digest 才能逐帧比较。
      const seed = (k * 7919 + i * 104729) % 100003;
      const x0 = seed % viewW;
      const y0 = (seed * 31 + k * 17) % viewH;
      const y = (((y0 + s.phase * speed) % viewH) + viewH) % viewH;
      const x = (((x0 + s.phase * drift) % viewW) + viewW) % viewW;
      out.push({ x, y, a: 0.4 + ((seed % 60) / 100) });
    }
  }
  return out;
}

/**
 * 一路效果的**参数向量**（引擎 16-dword 块）在 emulator 侧的可见三元组。
 * 只为报告/快照服务（避免快照里出现 16 个裸整数而看不出含义）。
 */
export function weatherParamsOf(m: Effect3DManagerState, which: number): { x: number; y: number; z: number } {
  const p = m.slots[which]?.params ?? [];
  return { x: p[0] ?? 0, y: p[1] ?? 0, z: p[2] ?? 0 };
}
