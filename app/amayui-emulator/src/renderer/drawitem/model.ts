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

/**
 * `Item.flags` 的位（引擎 740 字节元素 `+0`）。
 *
 * - `ITEM_FLAG_VISIBLE` = bit0：**可见/参与绘制**。读点 raw 133361（`sub_4AEEA0` 的绘制门）、
 *   132512（`sub_4ADC20`：`& 1 == 0 ⇒ 纹理槽 −1`）；写点 `|= 1u`（如 `0x1FB` 的 `sub_4ACE50` raw 131826）。
 * - `ITEM_FLAG_ANIM_WIN` = bit1：**A 层（一次性动画窗）已挂**。读点 raw 117436（`sub_49AA30` 的 A 层门）；
 *   写点 = 5 个窗 setter（`sub_4AD0C0`/`4AD170`/`4AD250`/`4AD3C0`/`4AD4A0`，raw 131969-132133）。
 * - `ITEM_FLAG_ANIM_LOOP` = bit2：**B 层（周期/循环动画层）已挂**。全反编译唯一读取点 = raw 133390
 *   （`sub_4AEEA0`：`(flags & 4) == 0 ⇒ 跳过整层`；命中时 raw 133395 强制"世界矩阵有效"）；
 *   写点 = `0x231`–`0x235` 五个 setter（raw 132229/132250/132274/132301/132330）；
 *   清点 = `0x230`（`sub_4AD580` raw 132173）。
 *   语义与 5 条通道的消费端见 `docs-new/03-engine/b3-bit2-model-spec-2026-09.md`。
 */
export const ITEM_FLAG_VISIBLE = 0b001;
export const ITEM_FLAG_ANIM_WIN = 0b010;
export const ITEM_FLAG_ANIM_LOOP = 0b100;

/**
 * **B 层（bit2）周期/循环通道**（引擎 `Item+524..+560` 的 5 组格子，下标复用 `W_*`）。
 *
 * ★与 A 层的 `AnimWin` 是**两套独立机制**（bit1 = 一次性过渡，bit2 = 无限周期），
 *   `+568/+572`（flipbook 帧数/列数）由两层**共用**（见 `Item.fbFrames/fbCols`）。
 *
 * 每个通道只有"起点 + 周期"两格；`period > 0` = 该通道启用（引擎 raw 118103/118135/118223/118234/118344
 * 的 `if (周期 > 0)`）。起点槽为 0 时**当帧锁存 now**（raw 118105-118106 / 118137-118138 / 118225-118226 /
 * 118236-118237 / 118346-118347），锁存值经渲染期整块回写（raw 133448）持久化。
 */
export interface LoopWin {
  /** 起点槽（`+524/+528/+532/+536/+540`）：0 ⇒ 求值当帧锁存 now。 */
  start: number;
  /** 周期 ms（`+544/+548/+552/+556/+560`）：`<= 0` ⇒ 本通道不跑。 */
  period: number;
}

/** 一个 draw-item（引擎 740 字节元素）在 emulator 侧的建模。 */
export interface Item {
  /** Scene map 的 key（= 图元 id = 绘制层序，越小越先画）。 */
  handle: number;
  /** 绘制层序（= handle；元素内部其实不存 layer，这里保留便于排序/诊断）。 */
  layer: number;
  /**
   * **画这一项的那一帧**（emulator 记账，引擎没有这一格；`-1` = 未知，例如构造器默认项与**读档还原**出来的项）。
   *
   * ★2026-09 以体订正（`tickets/T-0083`）：真机制**不是**"丢上一屏的项"，而是"**清空 + 按存档重装**" ——
   * `sub_410160` raw 19806-19832 先 delete-walk 清 `Scene+1032`（那张 740 B 绘制项 map）、复位哨兵、
   * `size = 0`，再把存档 body 里那份清单逐条插回 ⇒ 读档后的画面 = 存档当时的场景，与"哪一帧画的"无关。
   * （早先引的依据 `sub_403EF0`（raw 19913-19915）复位的是两个**仮想ディスプレイ** = 点击热点/路由表 +
   * 游标，**不碰绘制项容器**。）
   *
   * ⇒ 本字段**降级为 fallback**：只有 body 里**没有**绘制项清单（本工程槽 `format = 0`／旧布局 `sv1 = 1/2`）
   * 或清单解析失败时，装载点才用它近似"被放弃的那条调用链那一层 UI"（`scDropFrameItems`）。
   * 还原出来的项一律 `ownerFrame = -1`，免得被那套 fallback 当成上一屏丢掉。
   */
  ownerFrame: number;
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
  /**
   * `+720`（= `a2[180]`）：`0x242`（`sub_4251A0` → `sub_4AD9A0` raw 132346-132361）**直写**该格。
   *
   * ★**bit0 = "此项动画不参与等待门"**（`tickets/T-0024`，引擎依据）：
   *  - `sub_49AA30` raw 117843-117844：本项窗还在跑时，**只有** bit0 为 0 才置池挂起位 `Scene+46516`；
   *  - 同函数 raw 117440-117442：bit0 为 1 ⇒ 本项豁免 `Scene+46512` 的强制冻结（窗不被"跳过"截断）。
   *  序章 `src/SN0000.txt:1043-1048` 正是 `i220 f8023 0 13880 …`（80 000 ms 慢推）+ `i242 f8023 1` + `i238 64` + `wait`。
   */
  entryParam: number;
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
  /**
   * **B 层（bit2）5 条周期通道**（`+524..+560`；下标复用 `W_*`）。见 `LoopWin` 的说明。
   * `0x230` 清全部 `period` 与 `W_FLIPBOOK.start`；`0x231`–`0x235` 各配一条。
   */
  loops: LoopWin[];
  /** `+576`：B 层颜色往复的**目标色**（ARGB；`0x232` 写，构造器默认 −1 = 不透明白）。 */
  loopTo: number;
  /** `+592`（16 f32 的缩放矩阵）：B 层缩放往复的**目标缩放**（`0x233` 写 `D3DXMatrixScaling`）。 */
  loopScale: Vec3;
  /** `+580/+584/+588`：B 层**匀速旋转**的轴（`0x234` 写，raw 132309-132311）。 */
  loopAxis: Vec3;
  /** `+656`（16 f32 的平移矩阵）：B 层平移往复的**目标平移**（`0x235` 写 `D3DXMatrixTranslation`）。 */
  loopTrans: Vec3;
  /** bit0 存在 | bit1 A 层动画窗 | bit2 B 层周期动画（见 `ITEM_FLAG_*`）。 */
  flags: number;
}

/**
 * mesh（元素2 = MeshEntry，60 字节）**自己的**颜色动画窗：`+40 start(entry[10]) / +44 delay(entry[11]) / +48 dur(entry[12])`。
 * ★`+36`（= `entry[9]`）**不是**窗的一部分，它是**混合模式选择子**（见本接口下方的 blend 字段）。
 *   raw 依据：`sub_4AE330` raw 132834-132843 写 `[10]=0 / [11]=a3(delay) / [12]=a4(dur)`；
 *   绘制期 `sub_4AF1C0` raw 133533-133538 读 `v40[10]`（起点，为 0 则锁存 `Scene+46500`）/`[11]`/`[12]`。
 *   （2026-09 订正：此前写 `+36 start / +40 delay / +44 dur`，整体错了一个 int。）
 * ★与 DrawItem 的窗布局不同 —— 元素2 有自己独立的起点（引擎 raw 133509-133511 锁存），
 *   而 DrawItem 的 5 个窗共享 `+0x34` 一个起点。
 */
export interface MeshWin {
  start: number;
  delay: number;
  dur: number;
}

/**
 * mesh 的一个顶点（引擎 VB 记录 36 字节：`x,y,z,w,DWORD diffuse,u,v,attr,attr`）。
 *
 * emulator 只取其中 5 个：位置 + UV。**坐标是屏幕像素**（`sub_4AF1C0` 把源数组原样写进 VB，
 * 只减 0.5 半像素；投影矩阵 `D3DXMatrixOrthoLH(显示宽, -显示高)` ⇒ 单位 = 像素）。
 */
export interface MeshVertex {
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
}

/** 一个 mesh（顶点色四边形）在 emulator 侧的建模。 */
export interface MeshObj {
  handle: number;
  layer: number;
  /**
   * 引擎 entry[0]：**bit0 = 几何已建**（`sub_4ADFE0` 的 `*v21 |= 1`，draw 门 `sub_4AF1C0`
   * 的 `& 1` 判定）、bit1 = 颜色动画窗。★只被 `0x322/0x323` 碰过的 mesh 没有几何 ⇒ **不画**。
   */
  flags: number;
  /** `+52`（=元素下标 13）state0：起始色。 */
  state0: number;
  /** `+56`（=元素下标 14）state1：目标色（`== -1` 表示"无 TO"）。 */
  state1: number;
  anim?: MeshWin;
  /**
   * 顶点几何（`0x320` 的 op2/op3/op4 = x/y/z 浮点数组、op7/op8 = u/v 浮点数组）。
   * 空 = 没有顶点缓冲（引擎 `sub_4A2280` 没建成功 ⇒ bit0 不置 ⇒ 不画）。
   */
  verts: MeshVertex[];
  /**
   * 逐顶点**基础色**（ARGB，`0x320` 的 op5=`sub_42AEA0` alpha 数组、op6=rgb 数组；
   * 引擎在 `sub_432150` 里 `dec(key, …)` 解码后按 `(a<<24)|(rgb&0xFFFFFF)` 合成）。
   * 最终像素色 = 基础色 × 插值态色（`CalcDiffuse` 逐通道 `×/255`）。
   */
  baseColors: number[];
  /**
   * `0x322` 的 op2 → 引擎 entry[9] = **网格绘制的 alpha 混合模式选择子**。
   *
   * 消费点 = `sub_4AF1C0` raw 133617 `sub_49E390(…, entry[9])`，其中 `a8 = entry[9]` 走
   * `if (a8==1) SetRenderState(19,5)/(20,2)` / `a8==2` / `a8==3 ·(171,3)` 等分支
   * （`sub_49E390` raw 119370-119399）。**emulator 未接**（与 `Item` 的 blend 字段同一类缺口，
   * 见 `dead-writes.baseline.json` 与能力台账 `drawitem.mix-mode`）。
   * ★2026-09 订正：此前这里写"语料里恒为 0"是**错的** —— 实测 `set-vertex-color` 3919 处里
   *   `0` × 2373、`1` × 28、变量 `(global-int 4fd1)` × 1518，而 `4fd1` 有 28 处被 `mov … 1`
   *   ⇒ 运行期确实会出现 `1`（加算）。见 `tickets/T-0017/notes.md` 的语料统计。
   */
  blend: number;
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
  /** 画这一项的那一帧（`Item.ownerFrame` 的来源；缺省 = 未知）。 */
  ownerFrame?: number;
}

const ZERO_WIN = (): AnimWin => ({ delay: 0, dur: 0, set: false });
const ZERO_LOOP = (): LoopWin => ({ start: 0, period: 0 });

/**
 * 新建一个 draw-item（等价引擎元素构造函数 `sub_49A300`）。
 *
 * ★`sub_49A300` **把 `flags` 清 0**（raw 116899 `*(_DWORD *)a2 = 0;`）⇒ **bit0 未置 = 尚不可绘制**。
 * bit0 只由 `0x1FB` draw-texture（`sub_4ACE50` raw 131826 `|= 1u`）置上。
 * 这个区别很重要：任何"缺失即建项"的 setter（引擎 `sub_4AAA50`）建出的项都是 flags=0，
 * 渲染器 `sub_4AEEA0` 以 `(*elem & 1) != 0` 为绘制门（raw 133361），所以这种项**不会出画**。
 *
 * ★B 层默认值照 `sub_49A300` raw 116995-117046：5 组起点/周期全 0、`+576 = -1`（不透明白）、
 *   `+592` 缩放矩阵与 `+656` 平移矩阵 = 单位（⇒ `loopScale = (1,1,1)`、`loopTrans = (0,0,0)`）、
 *   `+580` 轴 = 0。
 */
export function makeItem(cfg: DrawItemConfig): Item {
  return {
    handle: cfg.handle,
    layer: cfg.layer,
    ownerFrame: cfg.ownerFrame ?? -1,
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
    entryParam: 0, // `+720`：0x242 直写（bit0 = 此项动画不参与等待门）
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
    loops: [ZERO_LOOP(), ZERO_LOOP(), ZERO_LOOP(), ZERO_LOOP(), ZERO_LOOP()],
    loopTo: 0xffffffff, // 构造器 raw 117014：`+576 = -1`（不透明白）
    loopScale: { x: 1, y: 1, z: 1 }, // raw 117008-117046：`+592` = 单位缩放矩阵
    loopAxis: { x: 0, y: 0, z: 0 }, // raw 116995-117014：B 层字段清零
    loopTrans: { x: 0, y: 0, z: 0 }, // `+656` = 单位平移矩阵
    flags: 0, // ★没有任何位 —— bit0 由 draw-texture(0x1FB) 置
  };
}

/** 引擎 `sub_4AAA50` 的等价物：为 setter 建一个"缺失即建"的默认项（`flags = 0` ⇒ 尚不可绘制）。 */
export function makeDefaultItem(handle: number, layer = handle): Item {
  return makeItem({ handle, layer, tex: 0, srcX: 0, srcY: 0, srcW: 0, srcH: 0, dstX: 0, dstY: 0 });
}

/**
 * 新建一个 mesh 条目（等价引擎 `sub_4AAB80` 的"缺失即建项"）。
 *
 * ★`flags = 0`：**没有几何 ⇒ 不画**。只有 `0x320` create-mesh 真正建好顶点缓冲
 * （`sub_4ADFE0` 的 `*v21 |= 1`）才置 bit0；只被 `0x322/0x323` 碰过的条目在引擎里
 * 既不画也不报错 —— 早前 emulator 在这里置了 bit0，于是"只有颜色的空 mesh"被画成
 * 一整屏黑（正是 SN0000 黑屏的两个成因之一）。
 */
export function makeMesh(handle: number, layer: number): MeshObj {
  return {
    handle,
    layer,
    flags: 0,
    state0: 0,
    state1: 0,
    anim: undefined,
    verts: [],
    baseColors: [],
    blend: 0,
  };
}

/**
 * **深拷贝一个 draw-item**（`0x21D` CopyScene 用）。
 *
 * 引擎 `sub_4AC0D0` 对元素做的是 `qmemcpy(dst, src+4, 0x2E4)` = **按位浅拷贝整块 740 字节**：
 * 标量、5 个动画窗、三个矩阵、颜色全都复制成**独立的一份**（此后改 dst 不影响 src）。
 * emulator 的 `Item` 里 `wins`/`scale*`/`rot*`/`trans*` 是引用类型 ⇒ 必须逐个复制，
 * 否则两个 handle 会共享同一批窗/矩阵（与引擎不同）。
 * `handle`/`layer` 取**目标** handle（emulator 里 handle = map key，用于排序与诊断）。
 */
export function cloneItem(it: Item, dstHandle: number): Item {
  return {
    ...it,
    handle: dstHandle,
    layer: dstHandle,
    wins: it.wins.map((w) => ({ ...w })),
    loops: it.loops.map((l) => ({ ...l })),
    scaleWork: { ...it.scaleWork },
    scaleTarget: { ...it.scaleTarget },
    rotWork: { axis: { ...it.rotWork.axis }, deg: it.rotWork.deg },
    rotTarget: { axis: { ...it.rotTarget.axis }, deg: it.rotTarget.deg },
    transWork: { ...it.transWork },
    transTarget: { ...it.transTarget },
    loopScale: { ...it.loopScale },
    loopAxis: { ...it.loopAxis },
    loopTrans: { ...it.loopTrans },
  };
}

/** 深拷贝一个 mesh（`0x21D` CopyScene 用；语义同 `cloneItem`）。 */
export function cloneMesh(m: MeshObj, dstHandle: number): MeshObj {
  return {
    ...m,
    handle: dstHandle,
    layer: dstHandle,
    anim: m.anim ? { ...m.anim } : undefined,
    verts: m.verts.map((v) => ({ ...v })),
    baseColors: [...m.baseColors],
  };
}