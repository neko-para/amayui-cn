/**
 * DrawItem / MeshEntry 的**数据模型**（引擎 `Scene` 元素的语义重建模）。
 *
 * 本模块刻意不依赖 Pixi/DOM，因此可以在 Node 里直接单元测试（见 test/draw-item-*.test.ts）。
 * 字段偏移与实证依据见下方注释；窗口下标常量 `W_*` 是 5 个动画窗在 `win[]` 里的位置。
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