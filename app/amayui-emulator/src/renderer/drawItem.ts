/**
 * **DrawItem / MeshEntry 数据模型 + 5 个动画窗的纯函数求值器**（引擎 `Scene` 的 map 元素）。
 *
 * 这个模块是 emulator 侧的「引擎数据模型」层：**不依赖 Pixi / DOM**，因此可被单元测试直接驱动
 * （`app/amayui-emulator/test/draw-item-anim-window.test.ts`）。渲染后端（`pixiBackend.ts`）只负责
 * 把这里求出的数值翻译成 Sprite 属性。
 *
 * 字段偏移严格对齐引擎实证布局（元素内偏移 = f32 下标 ×4；`_this` 为 `_DWORD*` ⇒ `_this[K]` = 字节 4K）：
 *
 * | 偏移 | 字段 | 写入者（opcode → 引擎函数） |
 * |---|---|---|
 * | `+0` | flags：bit0 已创建、bit1 动画启用、bit2 额外渲染分支 | `sub_4ACE50` / `sub_4AD0C0` |
 * | `+4` | **纹理槽号**（`draw-texture` 的 op2） | `0x1FB` `sub_4ACE50` |
 * | `+8..+0x14` | **源矩形 left/top/right/bottom**（脚本给 x,y,w,h；引擎存 `SetRect(x, y, x+w, y+h)`） | `0x1FB` |
 * | `+0x18/+0x1C/+0x20` | **pivot**（旋转/缩放中心） | `0x217` `sub_4ACF20` |
 * | `+0x24/+0x28/+0x2C` | **描画位置** | `0x219` `sub_4ACEE0` |
 * | `+0x30` | 混合模式 | `0x203` `sub_4ACF60`（写 `+48`） |
 * | `+0x34` | **动画起点（全项共享一个）** | 5 个 setter 都写 0；驱动首帧锁存 |
 * | `+0x38..+0x48` | 5×delay（颜色/缩放/旋转/平移/flipbook） | `0x202`/`0x21E`/`0x21F`/`0x220`/`0x239` |
 * | `+0x4C..+0x5C` | 5×dur（插值分母） | 同上 |
 * | `+0x60/+0x64` | 颜色 FROM（工作色）/ TO | `0x203` / `0x202` |
 * | `+0x6C/+0xAC` | 缩放矩阵 work/target | `0x21E` `sub_4AD170`（`D3DXMatrixScaling`） |
 * | `+0xEC/+0x12C` | 旋转矩阵 work/target；轴/角在 `+0x1EC..+0x208` | `0x21F` `sub_4AD250`（`D3DXMatrixRotationAxis`） |
 * | `+0x16C/+0x1AC` | 平移矩阵 work/target | `0x220` `sub_4AD3C0`（`D3DXMatrixTranslation`） |
 * | `+0x234/+0x238/+0x23C` | flipbook 标志 / 总帧数 / 每行列数 | `0x239` `sub_4AD4A0` |
 *
 * 证据：`.tmp/re-draw-container.md` §4、`.tmp/re-color-transform.md` §1.4/§2，
 * 以及 `docs-new/03-engine/opcode-table.md` 对应行。
 *
 * ## 逐帧求值器在哪（2026 复核确证；推翻 `.tmp/re-color-transform.md` §2.3 的"没有求值器"结论）
 *
 * 求值器体在 **`sub_49AA30`** 内（raw 117434-117483），它**就是 DrawItem 的动画驱动**：
 * 同一函数里依次驱动颜色窗（117443-117482）、缩放窗（117484-117514）、旋转窗（117516-…）、
 * 平移窗（…-117663）、flipbook 窗（117777-117832），并在末尾 raw 117844 置 pending `Scene+46516`。
 *
 * 调用链（raw 133326-133450 `sub_4AEEA0` = DrawItem 渲染器）：
 * ```
 * 133363  qmemcpy(v26, sub_4AAD40(Scene+1032, &a2), 740)   // 元素 → 局部副本 v26
 * 133375  v6 = v26[24]        // +0x60 = FROM（工作色）
 * 133380  v25 = v6            // 颜色放进调用方局部 v25
 * 133389  sub_49AA30(_this, v26, Scene+46536, COERCE_FLOAT(&v25), v22)   // ★ 传 &v25
 *             └─ 117374  v117 = a4                 // a4 就是 &v25（指针）
 *             └─ 117437  if (!a2[13]) a2[13] = clock   // 首帧锁存共享起点
 *             └─ 117461-117479  we/left 整数 lerp
 *             └─ 117470  *(_DWORD*)LODWORD(v117) = packed   // ★ 结果写回调用方的 v25
 *             └─ 117449-117457 窗末：a2[24] ← a2[25](TO)、a2[25] = NaN、delay/dur 清 0
 * 133443  sub_4A2D50(_this, v26[1], v22, 0, &v26[9], v26[12], v25)      // ★ v25 作 diffuse
 * 133447  qmemcpy(sub_4AAD40(Scene+1032,&a2), v26, 0x2E4)              // ★ 局部副本整体写回元素
 * ```
 *
 * 两点关键（都是上一轮报告搞错的地方）：
 * 1. **求值器存在**，且 `a4` 是"指向调用方颜色变量的指针"（`COERCE_FLOAT(&v25)`）——它把插值结果
 *    **写回调用方局部**、由调用方在 raw 133443 当作 diffuse 交纹理绘制。报告把这段代码误归属给
 *    "元素3 内联 `sub_4A230`"，实际它在 `sub_49AA30` 里、调用点就是 DrawItem 渲染器。
 * 2. **局部副本会写回元素**（raw 133447 `qmemcpy` 740 字节 = `sizeof(DrawItem)`）——所以
 *    "窗末冻结"（`+0x60 ← +0x64`）、"delay/dur 清 0"、"flipbook 源矩形结果"都会**持久化到元素**，
 *    下一帧不会重复累加。报告"写不回元素"的说法也是错的。
 *
 * 另注：插值结果**只写调用方局部、不回写 `+0x60`**（元素 FROM 在整个窗内保持不变）⇒ 每帧都从同一对
 * `FROM/TO` 重算，与 emulator 的 `itemColor` 模型一致。
 */

/** 变换三元组（引擎里都是 3 个连续的 f32）。 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * 一个动画窗（引擎 DrawItem 有 5 个，每个只有 `delay` / `dur` 两个字段，布局同构）。
 * ★**起点不是每窗一个**：全项共享 `DrawItem+0x34` 一个 `start`（任何窗的 setter 都把它写 0 ⇒ 下一帧锁存）
 *   —— `sub_4AD0C0`/`sub_4AD170`/`sub_4AD250`/`sub_4AD3C0`/`sub_4AD4A0` 全部写 `+52 = 0`
 *   （raw 131970 / 132002 / 132047 / 132099 / 132134）。
 */
export interface AnimWin {
  /** 延迟（ms）：`+0x38/+0x3C/+0x40/+0x44/+0x48`。 */
  delay: number;
  /** 时长（ms，插值分母）：`+0x4C/+0x50/+0x54/+0x58/+0x5C`。 */
  dur: number;
  /** 是否被 setter 配置过（引擎里"配置过但 dur=0"⇒ 当帧立即收尾，与"从未配置"必须区分）。 */
  set: boolean;
}

/** 窗口下标（与引擎 5 个窗一一对应）。 */
export const W_COLOR = 0;
export const W_SCALE = 1;
export const W_ROT = 2;
export const W_TRANS = 3;
export const W_FLIPBOOK = 4;

/** 一个 draw-item（引擎 740 字节元素）在 emulator 侧的建模。 */
export interface Item {
  /** Scene map 的 key（= 图元 id = 绘制层序，越小越先画）。 */
  handle: number;
  /** 绘制层序（= handle；元素内部其实不存 layer，这里保留便于排序/诊断）。 */
  layer: number;
  /** **纹理槽号**（引擎 DrawItem`+4`；由 `draw-texture` 的 **op2** 给出）。 */
  tex: number;
  /** 源矩形左上角（脚本 op3/op4；引擎元素里是 `+8/+0xC`）。 */
  srcX: number;
  srcY: number;
  /** 源矩形宽高（脚本 op5/op6；引擎元素里是 `+0x10-+8` / `+0x14-0xC`）。 */
  srcW: number;
  srcH: number;
  /** `+0x18/+0x1C/+0x20`：**旋转/缩放中心 pivot**（`0x217` 写）。 */
  pivotX: number;
  pivotY: number;
  pivotZ: number;
  /** `+0x24/+0x28/+0x2C`：**描画位置**（`0x219` 写；未写时 = draw-texture 的 op7/op8）。 */
  posX: number;
  posY: number;
  posZ: number;
  /** `+0x30` 混合模式。 */
  blend: number;
  /** `+0x34` 动画起点（**全项共享一个**；0 = 首帧锁存 clock，引擎 raw 117437-117438）。 */
  animStart: number;
  /** 5 个动画窗：0=颜色/α、1=缩放、2=旋转、3=平移、4=flipbook。 */
  wins: AnimWin[];
  /** `+0x60` ARGB（工作色 / FROM；`0x203` 写）。 */
  from: number;
  /** `+0x64` ARGB（目标色 / TO；`0x202` 写）。 */
  to: number;
  /** `+0x68`：使用世界矩阵标志。 */
  useWorld: boolean;
  /** `+0x6C`(work) / `+0xAC`(target)：缩放矩阵（`0x21E` 写 target）。 */
  scaleWork: Vec3;
  scaleTarget: Vec3;
  /** `+0xEC`(work) / `+0x12C`(target)：旋转矩阵；轴/角在 `+0x1EC..0x208`（`0x21F` 写）。 */
  rotWork: { axis: Vec3; deg: number };
  rotTarget: { axis: Vec3; deg: number };
  /** `+0x16C`(work) / `+0x1AC`(target)：平移矩阵（`0x220` 写）。 */
  transWork: Vec3;
  transTarget: Vec3;
  /** `+0x234/0x238/0x23C`：flipbook 标志 / 总帧数 / 每行列数（`0x239` 写）。 */
  fbFlags: number;
  fbFrames: number;
  fbCols: number;
  /**
   * flipbook 窗结束后**保持**的帧序号（`-1` = 不保持、复位到 `srcX/srcY`）。
   * 引擎的 flipbook 求值在 `sub_49AA30` 里对**元素的一个局部副本**做（raw 117828-117831 写的是副本），
   * 所以元素上的 `dur` 永不清零 ⇒ **每一帧都重新进入"窗已结束"分支**并把源矩形设成"末帧或复位"。
   * 这个字段就是那个每帧结果在 emulator 侧的持久化（等价物）。
   */
  fbHold: number;
  /** draw-texture 的目标位置（op7/op8；仅诊断，实际绘制位置取 `posX/posY`）。 */
  dstX: number;
  dstY: number;
  /** bit0 存在 | bit1 动画启用。 */
  flags: number;
}

/**
 * mesh（元素2 = MeshEntry，60 字节）**自己的**颜色动画窗：`+36 start / +40 delay / +44 dur`。
 * ★与 DrawItem 的窗布局不同 —— 元素2 有自己独立的起点（引擎 raw 133509-133511 锁存），
 *   而 DrawItem 的 5 个窗共享 `+0x34` 一个起点。
 */
export interface MeshWin {
  start: number;
  delay: number;
  dur: number;
}

/** 一个 mesh（黑/色覆盖层）在 emulator 侧的建模。 */
export interface MeshObj {
  handle: number;
  layer: number;
  flags: number; // 仅 bit0 存在 | bit1 颜色动画
  /** `+52`（=元素下标 13）state0：起始色。 */
  state0: number;
  /** `+56`（=元素下标 14）state1：目标色（`== -1` 表示"无 TO"）。 */
  state1: number;
  anim?: MeshWin;
}

/** draw-texture（`0x1FB`）的配置载荷。 */
export interface DrawItemConfig {
  handle: number;
  layer: number;
  tex: number;
  srcX: number;
  srcY: number;
  srcW: number;
  srcH: number;
  dstX: number;
  dstY: number;
}

const ZERO_WIN = (): AnimWin => ({ delay: 0, dur: 0, set: false });

/**
 * 新建一个 draw-item（等价引擎元素构造函数 `sub_49A300`）。
 *
 * ★`sub_49A300` **把 `flags` 清 0**（raw 116899 `*(_DWORD *)a2 = 0;`）⇒ **bit0 未置 = 尚不可绘制**。
 * bit0 只由 `0x1FB` draw-texture（`sub_4ACE50` raw 131826 `|= 1u`）置上。
 * 这个区别很重要：任何"缺失即建项"的 setter（引擎 `sub_4AAA50`）建出的项都是 flags=0，
 * 渲染器 `sub_4AEEA0` 以 `(*elem & 1) != 0` 为绘制门（raw 133361），所以这种项**不会出画**。
 */
export function makeItem(cfg: DrawItemConfig): Item {
  return {
    handle: cfg.handle,
    layer: cfg.layer,
    tex: cfg.tex,
    srcX: cfg.srcX,
    srcY: cfg.srcY,
    srcW: cfg.srcW,
    srcH: cfg.srcH,
    pivotX: 0,
    pivotY: 0,
    pivotZ: 0,
    posX: cfg.dstX,
    posY: cfg.dstY,
    posZ: 0,
    blend: 0,
    animStart: 0,
    wins: [ZERO_WIN(), ZERO_WIN(), ZERO_WIN(), ZERO_WIN(), ZERO_WIN()],
    from: 0xffffffff,
    to: 0xffffffff,
    useWorld: false,
    scaleWork: { x: 1, y: 1, z: 1 },
    scaleTarget: { x: 1, y: 1, z: 1 },
    rotWork: { axis: { x: 0, y: 0, z: 0 }, deg: 0 },
    rotTarget: { axis: { x: 0, y: 0, z: 0 }, deg: 0 },
    transWork: { x: 0, y: 0, z: 0 },
    transTarget: { x: 0, y: 0, z: 0 },
    fbFlags: 0,
    fbFrames: 0,
    fbCols: 0,
    fbHold: -1,
    dstX: cfg.dstX,
    dstY: cfg.dstY,
    flags: 0, // ★没有任何位 —— bit0 由 draw-texture(0x1FB) 置
  };
}

/** 引擎 `sub_4AAA50` 的等价物：为 setter 建一个"缺失即建"的默认项（`flags = 0` ⇒ 尚不可绘制）。 */
export function makeDefaultItem(handle: number, layer = handle): Item {
  return makeItem({ handle, layer, tex: 0, srcX: 0, srcY: 0, srcW: 0, srcH: 0, dstX: 0, dstY: 0 });
}

/** 新建一个 mesh（等价 `0x320` create-mesh 的建项）。 */
export function makeMesh(handle: number, layer: number): MeshObj {
  return { handle, layer, flags: 1, state0: 0xffffffff, state1: 0, anim: undefined };
}

/** 窗相位。 */
export type WinPhase = 'none' | 'before' | 'active' | 'after';

/**
 * 动画窗相位判定（**有副作用**：`+0x34` 起点为 0 时锁存当前 clock —— 引擎 raw 117437-117438
 * `if (!a2[13]) a2[13] = *(float*)(Scene+46500)`；起点是**全项共享**的一个字段）。
 *
 * - `none`   ：该窗从未被 setter 配置 ⇒ 不参与动画；
 * - `before` ：已锁存但仍在 delay 期 ⇒ 保持 `work`/`from`；
 * - `active` ：窗内 ⇒ `t = (clock − start − delay) / dur`（**无 clamp**；窗口条件已保证 0<t<1）；
 * - `after`  ：窗已结束（含 `dur = 0` 的"配置过但零时长"）⇒ 调用方做一次性收尾（`work ← target`）。
 */
export function winPhase(it: Item, idx: number, clock: number): { phase: WinPhase; t: number } {
  const w = it.wins[idx]!;
  if (!w.set) return { phase: 'none', t: 0 };
  if (it.animStart === 0) it.animStart = clock; // ★首帧锁存（引擎 raw 117438）
  const s = it.animStart + w.delay;
  if (clock < s) return { phase: 'before', t: 0 };
  if (w.dur <= 0) return { phase: 'after', t: 1 };
  if (clock >= s + w.dur) return { phase: 'after', t: 1 };
  return { phase: 'active', t: (clock - s) / w.dur };
}

/** 窗是否已结束（`none` 视为结束 —— 未配置 = 无动画可等）。 */
export function windowDone(it: Item, idx: number, clock: number): boolean {
  const p = winPhase(it, idx, clock);
  return p.phase === 'none' || p.phase === 'after';
}

/** 窗末收尾：`work ← target`（颜色窗则 `from ← to`），并清该窗（引擎 `a2[18]=0; a2[23]=0`）。 */
export function freezeWindow(it: Item, idx: number): void {
  if (idx === W_COLOR) it.from = it.to;
  else if (idx === W_SCALE) it.scaleWork = { ...it.scaleTarget };
  else if (idx === W_ROT) it.rotWork = { axis: { ...it.rotTarget.axis }, deg: it.rotTarget.deg };
  else if (idx === W_TRANS) it.transWork = { ...it.transTarget };
  // flipbook：把「末帧 / 复位」持久化（引擎每帧重算，见 `fbHold` 注释）
  else if (idx === W_FLIPBOOK) it.fbHold = (it.fbFlags & 1) !== 0 ? it.fbFrames - 1 : -1;
  const w = it.wins[idx]!;
  w.delay = 0;
  w.dur = 0;
  w.set = false;
}

/**
 * **逐帧驱动**（引擎 `sub_49AA30` / 元素驱动体的等价物）：把所有已配置动画窗按墙钟推进，
 * 窗末做一次性收尾 —— 引擎 raw 117496（缩放 `qmemcpy(a2+27, a2+43, 0x40)`）、
 * 117550（旋转 `a2+59 ← a2+75`）、117646（平移 `a2+91 ← a2+107`）、117831（flipbook 回写源矩形）。
 * 全部窗结束后清项级动画位 `flags &~ 2`（raw 117835）与共享起点 `+0x34 = 0`（raw 117837）。
 */
export function advanceWindows(it: Item, clock: number): void {
  if (!(it.flags & 2)) return;
  let pending = false;
  for (let i = 0; i < 5; i++) {
    const p = winPhase(it, i, clock);
    if (p.phase === 'before' || p.phase === 'active') pending = true;
    else if (p.phase === 'after') freezeWindow(it, i);
  }
  if (!pending) {
    it.flags &= ~2;
    it.animStart = 0;
  }
}

/** 线性插值三元组。 */
export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/**
 * **引擎的整数 lerp —— DrawItem 颜色窗（窗0）的逐帧求值器**（raw 117466-117479）。
 *
 * ```
 * we   = clock − delay − start          // "已过时间"（引擎 v18）
 * left = start + dur − (clock − delay)  // "剩余时间"（引擎 v19）= dur − we
 * ch   = (left·from_ch + we·to_ch) / dur  // 整数除法（截断；窗内 we/left 均 > 0，dur > 0 已前置保证）
 * ```
 * 通道字节序 = B(0) / G(8) / R(16) / A(24)（`B | G<<8 | R<<16 | A<<24`）。
 * ★是**截断**不是四舍五入：`from=0x00, to=0xFF, dur=2, we=1` ⇒ **127**（不是 128）。
 * ★与元素2（mesh）的浮点式**不是同一条公式**，见 {@link lerpArgbFloat}。
 */
export function lerpArgbWindow(from: number, to: number, we: number, dur: number): number {
  const ch = (shift: number) => {
    const a = (from >>> shift) & 0xff;
    const b = (to >>> shift) & 0xff;
    return (((dur - we) * a + we * b) / dur) | 0;
  };
  return ((ch(24) << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0;
}

/**
 * **引擎的浮点 lerp —— mesh（元素2）的 `CalcDiffuse`**（`sub_4A2050` raw 122287-122294）。
 * `ch = (int)(state1_ch·t + state0_ch·(1−t))`：C 截断、**无 clamp**（`t` 由调用方保证 `∈[0,1]`）。
 * 引擎另有"四通道全 255 ⇒ 直接拷基础色"的快路（raw 122294-122307）。
 */
export function lerpArgbFloat(from: number, to: number, t: number): number {
  const ch = (shift: number) => {
    const a = (from >>> shift) & 0xff;
    const b = (to >>> shift) & 0xff;
    return Math.trunc(b * t + a * (1 - t));
  };
  return ((ch(24) << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0;
}

/**
 * draw-item 的 diffuse 色（full ARGB）。
 *
 * **求值器位置（实证，见文件头"逐帧求值器"一节）**：`sub_49AA30` 内 raw 117434-117483；
 * 由 DrawItem 渲染器 `sub_4AEEA0` 在 raw 133389 以 `a2 = 该 DrawItem` 调用，结果经
 * `a4`（= 调用方 `&v25` 的指针）写回，再于 raw 133443 作为 diffuse 交给纹理绘制。
 */
export function itemColor(it: Item, clock: number): number {
  if (it.flags & 2) {
    const p = winPhase(it, W_COLOR, clock);
    if (p.phase === 'active') {
      // we = clock − start − delay（winPhase 已保证 > 0）；dur > 0 由 winPhase 保证
      const w = it.wins[W_COLOR]!;
      return lerpArgbWindow(it.from, it.to, clock - it.animStart - w.delay, w.dur);
    }
  }
  return it.from >>> 0;
}

/** 缩放（窗1 / `0x21E`）：延迟期保持 `scaleWork`，窗内 `scaleWork → scaleTarget` 逐分量插值。 */
export function itemScale(it: Item, clock: number): Vec3 {
  if (it.flags & 2) {
    const p = winPhase(it, W_SCALE, clock);
    if (p.phase === 'active') return lerpVec3(it.scaleWork, it.scaleTarget, p.t);
    if (p.phase === 'before') return { ...it.scaleWork };
  }
  return it.scaleTarget;
}

/** 旋转（窗2 / `0x21F`）：延迟期保持 `rotWork`，窗内轴与角分别插值（引擎 raw 117587-117620 插值后 `D3DXMatrixRotationAxis`）。 */
export function itemRotationRad(it: Item, clock: number): number {
  let deg = it.rotTarget.deg;
  if (it.flags & 2) {
    const p = winPhase(it, W_ROT, clock);
    if (p.phase === 'before') deg = it.rotWork.deg;
    else if (p.phase === 'active') deg = it.rotWork.deg + (it.rotTarget.deg - it.rotWork.deg) * p.t;
  }
  return (deg * Math.PI) / 180;
}

/** 平移（窗3 / `0x220`）：延迟期保持 `transWork`，窗内 `transWork → transTarget` 逐分量插值。 */
export function itemTranslation(it: Item, clock: number): Vec3 {
  if (it.flags & 2) {
    const p = winPhase(it, W_TRANS, clock);
    if (p.phase === 'active') return lerpVec3(it.transWork, it.transTarget, p.t);
    if (p.phase === 'before') return { ...it.transWork };
  }
  return it.transTarget;
}

/**
 * flipbook（窗4 / `0x239`）→ **源矩形**（不是 UV）。忠实复刻引擎 raw 117797-117831：
 * `frame = frames · (clock − start − delay) / dur`、`col = frame % cols`、`row = frame / cols`，
 * 源矩形偏移 `(col · srcW, row · srcH)`（引擎里源矩形存 left/top/right/bottom，
 * `a2[4] − a2[2]` = 源宽 = 脚本 op5，故偏移量就是 `srcW/srcH`）。
 * 窗结束后：`fbFlags & 1` ⇒ **保持末帧**（`frame = frames − 1`），否则**复位**。
 */
export function itemSrcRect(it: Item, clock: number): { x: number; y: number; w: number; h: number } {
  const base = { x: it.srcX, y: it.srcY, w: it.srcW, h: it.srcH };
  if (it.fbFrames <= 0 || it.fbCols <= 0) return base;
  const p = winPhase(it, W_FLIPBOOK, clock);
  // 窗未配置 / 延迟期：窗已结束过则继续用保持的末帧（`fbHold`），否则用原始矩形
  if (p.phase === 'none') return rectOfFrame(it, base, it.fbHold);
  if (p.phase === 'before') return base;
  const frame = p.phase === 'after' ? ((it.fbFlags & 1) !== 0 ? it.fbFrames - 1 : -1) : Math.floor(it.fbFrames * p.t);
  return rectOfFrame(it, base, frame); // frame < 0 ⇒ 复位
}

/** 把帧序号换算成源矩形（`col = frame % cols`、`row = frame / cols`；`frame < 0` ⇒ 原始矩形）。 */
function rectOfFrame(
  it: Item,
  base: { x: number; y: number; w: number; h: number },
  frame: number,
): { x: number; y: number; w: number; h: number } {
  if (frame < 0) return base;
  return {
    x: base.x + (frame % it.fbCols) * base.w,
    y: base.y + Math.floor(frame / it.fbCols) * base.h,
    w: base.w,
    h: base.h,
  };
}

/** mesh 顶点色窗是否已结束（元素2 自己的起点，引擎 raw 133509-133517）。 */
export function meshWindowDone(m: MeshObj, clock: number): boolean {
  const w = m.anim;
  if (!w) return true;
  if (w.start === 0) w.start = clock;
  if (w.dur <= 0 && w.delay <= 0) return true;
  return clock >= w.start + w.delay + w.dur;
}

/**
 * mesh 顶点色 CalcDiffuse：state0→state1 逐通道插值（黑覆盖层的 alpha 淡入淡出）。
 * 用**元素2 自己的浮点公式**（`sub_4A2050`，raw 122287-122294），与 DrawItem 的整数式不同。
 * 窗末一次性收尾（引擎 raw 133531-133538）：`delay/dur/start` 清 0、`state0 ← state1`、清 bit1。
 */
export function calcDiffuse(m: MeshObj, clock: number): number {
  if (!(m.flags & 2) || !m.anim) return m.state1;
  const w = m.anim;
  if (w.start === 0) w.start = clock; // raw 133511
  if (w.dur > 0 && clock < w.start + w.delay + w.dur) {
    if (clock <= w.start + w.delay) return m.state0; // 延迟期保持 state0
    return lerpArgbFloat(m.state0, m.state1, (clock - w.start - w.delay) / w.dur);
  }
  w.delay = 0;
  w.dur = 0;
  w.start = 0;
  m.state0 = m.state1;
  m.flags &= ~2;
  return m.state1;
}

/** 该 item 是否还有窗没走完（供 0x400 卫门判断）。 */
export function itemAnimationsPending(it: Item, clock: number): boolean {
  if (!(it.flags & 2)) return false;
  for (let i = 0; i < 5; i++) if (!windowDone(it, i, clock)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// setter（指令 → 模型的写入端）
//
// 每个 setter 对应一条 opcode 的引擎 handler；字段偏移见文件头的表。
// 共同副作用：置脏由调用方（渲染后端）负责；这里只改模型。
// 引擎里 5 个 setter 都会把共享起点 `+0x34` 写 0（"下一帧重新锁存"）——
// 见 `sub_4AD0C0` raw 131970 / `sub_4AD170` 132002 / `sub_4AD250` 132047 /
// `sub_4AD3C0` 132099 / `sub_4AD4A0` 132134。
// ---------------------------------------------------------------------------

/** `0x203` set-draw-color-alpha（`sub_4ACF60`）：写 `+0x30` 混合模式、`+0x60` 工作色（FROM）。 */
export function applyDrawColorAlpha(it: Item, from: number, blend = 0): void {
  it.blend = blend;
  it.from = from >>> 0;
}

/** `0x202` set-draw-color（`sub_4AD0C0`）：置 bit1、`+0x34=0`、`+0x38` delay、`+0x4C` dur、`+0x64` TO。 */
export function applyDrawColor(it: Item, delay: number, dur: number, to: number): void {
  it.flags |= 2;
  it.animStart = 0;
  it.wins[W_COLOR] = { delay, dur, set: true };
  it.to = to >>> 0;
}

/** `0x21E`（`sub_4AD170`）：置 `+0x3C` delay、`+0x50` dur、`+0xAC` 目标缩放（sx/sy/sz 已 ÷256）。 */
export function applyScaleAnim(it: Item, delay: number, dur: number, sx: number, sy: number, sz: number): void {
  it.flags |= 2;
  it.animStart = 0;
  it.wins[W_SCALE] = { delay, dur, set: true };
  it.scaleTarget = { x: sx, y: sy, z: sz };
}

/** `0x21F`（`sub_4AD250`）：置 `+0x40` delay、`+0x54` dur、`+0x1F8..0x208` 目标轴/角（度）。 */
export function applyRotationAnim(
  it: Item,
  delay: number,
  dur: number,
  ax: number,
  ay: number,
  az: number,
  deg: number,
): void {
  it.flags |= 2;
  it.animStart = 0;
  it.wins[W_ROT] = { delay, dur, set: true };
  it.rotTarget = { axis: { x: ax, y: ay, z: az }, deg };
}

/** `0x220`（`sub_4AD3C0`）：置 `+0x44` delay、`+0x58` dur、`+0x1AC` 目标平移（不除 256）。 */
export function applyTranslationAnim(
  it: Item,
  delay: number,
  dur: number,
  x: number,
  y: number,
  z: number,
): void {
  it.flags |= 2;
  it.animStart = 0;
  it.wins[W_TRANS] = { delay, dur, set: true };
  it.transTarget = { x, y, z };
}

/** `0x239`（`sub_4AD4A0`）：置 `+0x48` delay、`+0x5C` dur、`+0x238` 帧数、`+0x23C` 列数、`+0x234` 标志。 */
export function applyFlipbook(
  it: Item,
  delay: number,
  dur: number,
  frames: number,
  cols: number,
  flags: number,
): void {
  it.flags |= 2;
  it.animStart = 0;
  it.wins[W_FLIPBOOK] = { delay, dur, set: true };
  it.fbFrames = frames;
  it.fbCols = cols;
  it.fbFlags = flags;
}

/** `0x217`（`sub_4ACF20`）：写 `+0x18/+0x1C/+0x20` = pivot（旋转/缩放中心）。 */
export function applyDrawPivot(it: Item, x: number, y: number, z: number): void {
  it.pivotX = x;
  it.pivotY = y;
  it.pivotZ = z;
}

/** `0x219`（`sub_4ACEE0`）：写 `+0x24/+0x28/+0x2C` = 描画位置。 */
export function applyDrawPos(it: Item, x: number, y: number, z: number): void {
  it.posX = x;
  it.posY = y;
  it.posZ = z;
}

/**
 * `0x1FF`（`sub_4230F0` → `sub_4AC750`）：**DrawItem 的像素平移**（立即生效、无动画窗）。
 * 引擎写 `+0x68 = 1`（用世界矩阵）与 `+0x16C`（平移 **work** 矩阵）⇒ 这里把 work/target 都设为该值；
 * `itemTranslation` 在无窗时返回 target，故写入即生效。
 */
export function applyDrawTranslation(it: Item, x: number, y: number, z: number): void {
  it.useWorld = true;
  it.transWork = { x, y, z };
  it.transTarget = { x, y, z };
}

/** `0x322`（`sub_4AE280`）：mesh 顶点色 state0。 */
export function applyMeshVertexColor(m: MeshObj, state0: number): void {
  m.state0 = state0 >>> 0;
}

/** `0x323`：mesh 顶点色动画窗（`+40` delay / `+44` dur / `+52` state1），置 bit1。 */
export function applyMeshVertexColorAlpha(m: MeshObj, delay: number, dur: number, state1: number): void {
  m.flags |= 2;
  m.state1 = state1 >>> 0;
  m.anim = { start: 0, delay, dur };
}

// ---------------------------------------------------------------------------
// `0x23B`：CG 数字条 → DrawItem 几何（纯函数；引擎 raw 32381-32503）
// ---------------------------------------------------------------------------

/** 一个待建的绘制项（`0x23B` 的输出）。 */
export interface CgDigitItem {
  handle: number;
  /** 纹理槽（记录 `[0]`）。 */
  tex: number;
  srcX: number;
  srcY: number;
  srcW: number;
  srcH: number;
  dstX: number;
  dstY: number;
}

/**
 * **`0x23B` 的几何**（子集：只算要建哪些 DrawItem，不做删除）。
 *
 * 记录 `rec`：`[0]` 纹理槽 / `[1]` x0 / `[2]` y0 / `[3]` 单字宽 / `[4]` 字高 /
 * `[5]` 字内空隙 / `[6]` 字距（`adv = rec[3] + rec[6]`）。
 *
 * 循环：`k` 从 `digits-1` 递减到 0，每轮 `digit = value % 10` 后 `value /= 10`
 * ⇒ **第一个建出的项（handle = id）是"个位"、id+1 是十位…（自右向左）**。
 * 源矩形：`srcX = rec[1] + (rec[3] + rec[5]) · digit`、`srcY = rec[2]`。
 * x 三档：`flags & 2` 居中 `k·adv − adv·(last − 数位 + 1)/2 + op4`；
 * `flags & 4` 左对齐 `(数位 − 1 − (last − k))·adv + op4`；否则右对齐 `k·adv + op4`。
 * 前导零跳过，除非 `flags & 1`（补零）或是个位那一轮。（引擎 raw 32419/32452/32481 的判据）
 */
export function cgDigitItems(
  id: number,
  rec: readonly number[],
  value: number,
  x: number,
  y: number,
  digits: number,
  flags: number,
): CgDigitItem[] {
  const [tex = 0, sx0 = 0, sy0 = 0, cellW = 0, cellH = 0, gap = 0, adv0 = 0] = rec;
  const last = digits - 1;
  if (last < 0) return [];
  const advance = cellW + adv0;
  // 数位个数（引擎：居中/左对齐两档先算有效位数）
  let dc = 1;
  for (let t = Math.trunc(value / 10); t; t = Math.trunc(t / 10)) dc++;

  const out: CgDigitItem[] = [];
  let rem = value;
  for (let k = last; k >= 0; k--) {
    const digit = rem % 10;
    // 引擎判据（raw 32481）：`flags&1 || k == last || 当前剩余值 != 0`
    //（当前剩余值即"这一位有没有内容"；引擎用 v44 = 上一轮除完的余数，等价于本轮的 rem）
    if ((flags & 1) !== 0 || k === last || rem !== 0) {
      let px: number;
      if ((flags & 2) !== 0) px = k * advance - (advance * (last - dc + 1)) / 2 + x;
      else if ((flags & 4) !== 0) px = (dc - 1 - (last - k)) * advance + x;
      else px = k * advance + x;
      out.push({
        handle: id + out.length,
        tex,
        srcX: sx0 + (cellW + gap) * digit,
        srcY: sy0,
        srcW: cellW,
        srcH: cellH,
        dstX: px, // 引擎写入的是 float（居中档会出现 .5）
        dstY: y,
      });
    }
    rem = Math.trunc(rem / 10);
  }
  return out;
}
