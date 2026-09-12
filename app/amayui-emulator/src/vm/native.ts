/** 子系统/系统调用的抽象接口 + 桩实现。
 *  VM 里所有引擎子系统调用（声音/渲染/字体/输入/睡眠/日志）都经此 bridge。
 *  桩实现只记录（无界面）；PixiBackend 实现真实渲染。
 *
 *  Plan A：改为「引擎式」模型——指令只**配置对象**（draw-item/mesh/纹理槽/颜色），
 *  由渲染器每帧 `present()` 合成整个场景图；渲染与 VM 指令解耦。
 *  约定：桥对渲染对象做**严格 flag 校验**——配置了未逐字段解码的 flag 位 → 抛 `UnknownFlagError`，绝不静默忽略。
 */
import type { InputManager } from './input.js';
import type { MsgWinInput } from '../text/layout.js';

/** 已知 draw-item flag 位（引擎实测）：bit0 存在 | bit1 颜色动画。bit2(&4, sub_49BCC0 分支) 未逐字解码 ⇒ 拒绝。 */
export const KNOWN_DRAW_ITEM_FLAGS = 0b011;
/** 已知 mesh flag 位：bit0 存在 | bit1 颜色动画。 */
export const KNOWN_MESH_FLAGS = 0b011;

/** 配置了不认识的 flag → 硬中断（与 NotImplementedOp 互补，杜绝静默误渲染）。 */
export class UnknownFlagError extends Error {
  constructor(
    public readonly kind: 'drawitem' | 'mesh',
    public readonly handle: number,
    public readonly flags: number,
    public readonly unknown: number,
  ) {
    super(
      `unknown ${kind} flag 0x${flags.toString(16)} @ handle 0x${handle.toString(16)} : ` +
        `未解码位 0x${unknown.toString(16)} —— 严格校验要求：配置了不认识的 flag 必须立即中断`,
    );
    this.name = 'UnknownFlagError';
  }
}

export function assertFlags(kind: 'drawitem' | 'mesh', handle: number, flags: number): void {
  const mask = kind === 'drawitem' ? KNOWN_DRAW_ITEM_FLAGS : KNOWN_MESH_FLAGS;
  const unknown = flags & ~mask;
  if (unknown !== 0) throw new UnknownFlagError(kind, handle, flags, unknown);
}

/** draw-item（图像）配置。layer = op2（2a/2b）；dst 为屏幕位置。 */
export interface DrawItemConfig {
  handle: number;
  layer: number;
  srcX: number;
  srcY: number;
  srcW: number;
  srcH: number;
  dstX: number;
  dstY: number;
  /** 纹理号（仅日志；实际按 slot 绑定的 imgid 取图） */
  tex: number;
}

export interface MeshVertexSpec {
  x: number;
  y: number;
  u: number;
  w: number;
  diffuse: number;
}

export interface MeshCreateSpec {
  handle: number;
  layer: number;
  vcount: number;
  verts: MeshVertexSpec[];
}

/** `0x204` draw-string 的样式载荷（handler 从引擎全局样式字段组装；宿主只光栅化，见 `globalTextStyle`）。 */
export interface DrawStringStyle {
  /** 字族（已由 `fontSet.resolveFace` 解析成浏览器可用族名）。 */
  family: string;
  /** 字号 px（引擎 `Font+201684`，`0x75` 写）。 */
  size: number;
  /** 字重（400/700；引擎的加粗是"再画一遍"，见 raster 的说明）。 */
  weight: number;
  /** 填充色 `#rrggbb`（引擎 `Font+1360`，`0x76` 写）。 */
  fill: string;
  /** 描边色 `#rrggbb`（引擎 `Font+1364`，`0x77` 写）。 */
  outline: string;
  /** 描边档位（引擎 `Font+1372`）：0 无 / 1 单向 / 2 同位叠 / 3 四向。 */
  outlineMode: 0 | 1 | 2 | 3;
  outlineDx: number;
  outlineDy: number;
}

export interface NativeBridge {
  log(msg: string): void;
  /** 共享输入状态（Engine 构造时赋值；渲染器经它写 / VM 经它读）。 */
  input?: InputManager;
  playSound?(id: number, volume: number): void;
  playBgm?(id: number): void;
  playVoice?(id: number): void;
  /** 0x1FB draw-texture（sub_422E70）：8 操作数 `[slot, layer, srcX, srcY, srcW, srcH, dstX, dstY]`。
   *  ★与 `configureDrawItem` 的关系：draw-texture 是"**按纹理槽绘制**"；`op_draw_texture` 解析操作数后
   *  经本方法转发（默认实现即转 `configureDrawItem`）。宿主可覆写本方法做"槽→实际图像"的额外解析。 */
  drawTexture?(args: number[]): void;
  /** 0x1F9 set-texture（sub_422CB0）：`[imgid, slot, color]` —— 引擎里**唯一的槽↔图像绑定**。
   *  ★与 `bindTexture` 的关系：本方法默认转发 `bindTexture(imgid, slot)`。 */
  setTexture?(args: number[]): void;
  /** 0x1F8 create-texture：`[slot, w, h, mode]` —— 释放该槽旧纹理对象并**新建**一张（程序化纹理）。
   *  emulator 建模为"该槽的图像缓存失效并重取"（见 PixiBackend）。 */
  createTexture?(slot: number, w: number, h: number, mode: number): void;
  /**
   * 0x204 draw-string（sub_423390 → `sub_456710`）：把一整串文本**直绘进纹理槽** `slot`（GDI 路径）。
   * `(x, y)` = 文本左上角（引擎在 `Font+201680 == 1` 时会再加一次 ascent 修正）。
   * 宿主只负责光栅化：用 `style` 把 `text` 画到该槽的表面（保留原有像素，不清底）。
   */
  drawString?(slot: number, x: number, y: number, text: string, style: DrawStringStyle): void;
  /** 0x1FD（sub_422FD0 → `sub_4AC5F0`）：**立即缩放**（无动画窗）。op2/3/4 = sx/sy/sz（**÷100**，`dbl_5201F0`）。
   *  引擎写 `DrawItem+0x68 = 1`（用世界矩阵）与 `+0x6C`（缩放 work 矩阵）。 */
  setScale?(handle: number, sx: number, sy: number, sz: number): void;
  /**
   * 0x1FF（sub_4230F0 → `sub_4AC750`）：**DrawItem 的像素平移**（op2/op3/op4 = x/y/z float，像素单位）。
   * 引擎：`DrawItem+0x68 = 1`（用世界矩阵）+ `D3DXMatrixTranslation(元素+0x16C, x,y,z)` 写**平移 work 矩阵**，
   * **立即生效、无动画窗**（与 0x220 写 target + 开窗不同）。对照：**平移用像素、缩放用百分数**。
   */
  setDrawTranslation?(handle: number, x: number, y: number, z: number): void;
  /**
   * 0x208（sub_4302E0 → `sub_49ED60`）：**纹理尺寸查询**，返回该槽纹理的原始宽高。
   * 引擎读 `CTexture+1040/+1044`；槽越界/未创建时返回 0/0（引擎只记日志、不改控制流）。
   * ★这是 getter：调用方会把结果**写回脚本操作数 2/3**，漏掉会造成脚本层逻辑错误。
   */
  getTextureSize?(slot: number): { w: number; h: number };
  /**
   * 0x23B（sub_424970）：**按 CG 数字条画数值**。
   * 实现方负责：先删 DrawItem/Mesh 的 `[id, id+digits)` 区间，再按记录逐位建 DrawItem。
   * `rec` = 7 dword（[0] 纹理槽 / [1] x0 / [2] y0 / [3] 单字宽 / [4] 字高 / [5] 字内空隙 / [6] 字距）；
   * `flags` bit0 = 补前导零、bit1 = 居中、bit2 = 左对齐。
   */
  drawCgNumber?(id: number, rec: readonly number[], value: number, x: number, y: number, digits: number, flags: number): void;
  /** 0x32F（sub_4272B0 → `sub_49A150`）：**D3D 灯光开关** `LightEnable(idx, on)`（idx=0..9；同族 sub_49A080=SetLight）。 */
  setLight?(idx: number, on: boolean): void;
  /** 0x342（sub_427C70 → `sub_4A1A60`）：**销毁 Live2D 模型实例槽**（Scene+55812 的 10 槽，析构 + delete + 置 0）。 */
  destroyL2DSlot?(slot: number): void;
  /** 0x352（sub_4283B0 → `sub_4A1AC0`）：Live2D 槽参数——按 `sel` 置**待纹理 ID**(+24/+28) 或**待动作 ID**(+25/+32)。 */
  l2dSlotSet?(slot: number, sel: number, value: number): void;
  /** 0x23D（sub_41A300）：**销毁 movie/纹理槽 42..999**（CMovieToTexture 族析构 + Scene 卸槽）。 */
  releaseMovieSlots?(): void;
  /** 0x32B（sub_41A4A0）：**清 D3DX 网格层级槽表**（Scene+50708 区 1000 槽，逐项 delete）。 */
  clearMeshSlots?(): void;
  /** 0x259（sub_41A3A0）：清两张 1000×2 组 5-DWORD 记录表（只清记录、不 delete 对象）。 */
  clearSlotRecords?(): void;
  /** 0x340（sub_427B60 → `sub_49A2D0`）：下发渲染状态（设备 vtable+228，状态 #22）。 */
  setRenderState?(state: number, value: number): void;
  setFont?(args: number[]): void;
  setString?(s: string): void;
  stringResourceId?(s: string): number;
  getInputType?(): number;
  sleep?(ms: number): void;
  // ★菜单派发（0xA1/0xA2/0xA3）**没有**宿主方法：表是 VM 状态（`Engine.menuMap`），
  //   查表跳转在同文件的 handlers/menu.ts 里完成 —— 见那里的说明（曾因多余的桥方法产生"假缺口"）。
  unhandled?(opcode: number, name: string): void;

  // ---- 消息窗文本（引擎「每窗一张离屏表面」的等价物）----
  /**
   * **同步一个消息窗的文本内容**（引擎 `0x6E`/`0x6F`/`0x71`/`0x196` 与各属性指令之后）。
   * 宿主负责：排版在共享层 `scene/ops.ts` 里做（两宿主同一份语义），宿主只做光栅化/记录。
   */
  msgWinSync?(win: number, input: MsgWinInput): void;
  /** 清空一个消息窗（引擎 `0x85` / `0x301` / `0x71` 开始新一段）。 */
  msgWinClear?(win: number): void;
  /** 全部清空（`op_exit_script` 的 `msgwin.reset()`）。 */
  msgWinClearAll?(): void;

  // ---- Plan A：类型化渲染配置（严格 flag 校验） ----
  configureDrawItem?(cfg: DrawItemConfig): void;
  bindTexture?(imgid: number, slot: number): void;
  /**
   * **纹理帧屏障**：等本帧新绑定的图像载入完成（可选实现）。
   *
   * 引擎 `set-texture`(0x1F9 → `sub_422CB0`) 是**同步**读文件 + 解码 ⇒ 同一帧"绑定 + 画"必然一致；
   * renderer 侧走 IPC 异步，宿主必须在合成前补齐，否则会出现「新一屏文本已画上来、背景还没切换」
   * 的时序错位。headless 宿主无纹理 ⇒ 不实现（返回 undefined 即跳过）。
   */
  texturesIdle?(): Promise<void>;
  createMesh?(spec: MeshCreateSpec): void;
  /** 0x322 set-vertex-color：置 state0（ARGB）。 */
  setVertexColor?(handle: number, state0: number): void;
  /** 0x323 set-vertex-color-alpha：置 delay/count/state1，置动画位。 */
  setVertexColorAlpha?(handle: number, delay: number, count: number, state1: number): void;
  /** 0x203 set-draw-color-alpha：置 from 色（ARGB）。 */
  setDrawColorAlpha?(handle: number, from: number): void;
  /** 0x1F7 detach-texture（sub_422BC0）：删单/区间图元。op1=handle、op2=count；count≤1 删单，count>1 删 [handle,handle+count)。 */
  detachTexture?(handle: number, count: number): void;
  /** 0x202 set-draw-color：置 delay/count/to 色，置动画位。 */
  setDrawColor?(handle: number, delay: number, count: number, to: number): void;
  /**
   * 0x217（sub_423B20, raw 31791）：**对象变换 pivot** `sub_4ACF20(_this+80708, handle, f2, f3, f4)`。
   * 引擎：`sub_4AAA50` 保证 key 存在 → `map[key]` → 写元素下标 `6/7/8` = DrawItem`+24/+28/+32`
   * = **回転/拡大縮小の中心（pivot）**；`sub_49AA30` 绘制期用 `T(-pivot) → 动画矩阵 → T(+pivot)` 夹住。
   */
  setDrawPivot?(handle: number, x: number, y: number, z: number): void;
  /**
   * 0x219（sub_423BA0, raw 31807）：**描画位置** `sub_4ACEE0(_this+80708, handle, f2, f3, f4)`。
   * 引擎：与 `sub_4ACF20` 逐行同构，唯写元素下标 `9/10/11` = DrawItem`+36/+40/+44` = 描画位置 (x,y,z)；
   * 绘制期 `sub_4AEEA0` 把 `&v26[9]` 作第 5 参交 `sub_4A2D50` → `CTexture::Draw`。
   */
  setDrawPos?(handle: number, x: number, y: number, z: number): void;
  /**
   * 0x21E（sub_423CA0 → `sub_4AD170`）：**缩放动画窗（窗1）**。op2=delay、op3=dur、op4/5/6=sx/sy/sz（**÷100**）。
   * 引擎写 DrawItem`+0x3C` delay / `+0x50` dur / `+0xAC` 目标缩放矩阵，窗末 `work(+)0x6C ← target`。
   */
  setScaleAnim?(handle: number, delay: number, dur: number, sx: number, sy: number, sz: number): void;
  /** 0x21F（sub_423D40 → `sub_4AD250`）：**旋转动画窗（窗2）**。op2=delay、op3=dur、op4/5/6=轴、op7=角（度）。 */
  setRotationAnim?(handle: number, delay: number, dur: number, ax: number, ay: number, az: number, deg: number): void;
  /** 0x220（sub_423DE0 → `sub_4AD3C0`）：**平移动画窗（窗3）**。op2=delay、op3=dur、op4/5/6=位移（**不除**，像素）。 */
  setTranslationAnim?(handle: number, delay: number, dur: number, x: number, y: number, z: number): void;
  /** 0x239（sub_424900 → `sub_4AD4A0`）：**flipbook 窗（窗4）**。op2=delay、op3=dur、op4=总帧数、op5=列数、op6=标志(bit0=保持末帧)。 */
  setFlipbook?(handle: number, delay: number, dur: number, frames: number, cols: number, flags: number): void;
  /** 0x344（sub_427CB0）：纹理槽变换 `sub_4AFBF0(_this+80708, handle, value)`（置 map 项 `|=1`、`[+4]=value`）。 */
  setTextureTransform?(handle: number, value: number): void;
  /** 0x352（sub_4283B0）：图形子系统 `sub_4A1AC0(_this+80708, op1, op2, op3)`（按 op2 选 sub_478560/sub_478540）。 */
  gfxSubsystem?(a2: number, a3: number, a4: number): void;
  /** 0x1F6（sub_41A130）：`sub_4AB7A0(_this+80708)` —— 整批释放绘制项/网格（保留纹理槽）。 */
  clearDrawContainer?(): void;
  /** 0x20C（sub_41A1A0）：每帧 `sub_4B4040(_this+80708)`（帧刷新；emulator 渲染循环自行 present，可选）。 */
  frameTick?(): void;
  /** 0x21C u00416270：置等待旗标位（0x400）。 */
  setWaitFlag?(mask: number): void;
  /** 0x1FA release-texture：释放某 layer。 */
  releaseTexture?(layer: number): void;
  /** 0x20F play-movie：起播视频句柄。 */
  playMovie?(id: number): void;
  /** 每帧渲染合成（由渲染帧循环调用）。 */
  present?(): void;
  /** 启动每帧渲染循环（Pixi ticker）。 */
  startFrameLoop?(now?: number): void;
}

export { StubNative } from './stubNative.js';
