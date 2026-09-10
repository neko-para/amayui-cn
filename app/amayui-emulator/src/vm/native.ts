/** 子系统/系统调用的抽象接口 + 桩实现。
 *  VM 里所有引擎子系统调用（声音/渲染/字体/输入/睡眠/日志）都经此 bridge。
 *  桩实现只记录（无界面）；PixiBackend 实现真实渲染。
 *
 *  Plan A：改为「引擎式」模型——指令只**配置对象**（draw-item/mesh/纹理槽/颜色），
 *  由渲染器每帧 `present()` 合成整个场景图；渲染与 VM 指令解耦。
 *  约定：桥对渲染对象做**严格 flag 校验**——配置了未逐字段解码的 flag 位 → 抛 `UnknownFlagError`，绝不静默忽略。
 */
import type { InputManager } from './input.js';

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
  /** 0x1FD（sub_422FD0）：3D 缩放变换（`sub_4AC5F0` 设缩放矩阵，百分数）。 */
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
  /** 0xA1 (sub_433A40)：菜单派发表复位。 */
  menuReset?(): void;
  /** 0xA2 (sub_434F10)：登记菜单项 key→label。 */
  menuBind?(key: string, value: number): void;
  unhandled?(opcode: number, name: string): void;

  // ---- Plan A：类型化渲染配置（严格 flag 校验） ----
  configureDrawItem?(cfg: DrawItemConfig): void;
  bindTexture?(imgid: number, slot: number): void;
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
   * 0x21E（sub_423CA0 → `sub_4AD170`）：**缩放动画窗（窗1）**。op2=delay、op3=dur、op4/5/6=sx/sy/sz（÷256）。
   * 引擎写 DrawItem`+0x3C` delay / `+0x50` dur / `+0xAC` 目标缩放矩阵，窗末 `work(+)0x6C ← target`。
   */
  setScaleAnim?(handle: number, delay: number, dur: number, sx: number, sy: number, sz: number): void;
  /** 0x21F（sub_423D40 → `sub_4AD250`）：**旋转动画窗（窗2）**。op2=delay、op3=dur、op4/5/6=轴、op7=角（度）。 */
  setRotationAnim?(handle: number, delay: number, dur: number, ax: number, ay: number, az: number, deg: number): void;
  /** 0x220（sub_423DE0 → `sub_4AD3C0`）：**平移动画窗（窗3）**。op2=delay、op3=dur、op4/5/6=位移（不除 256）。 */
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

/** 无界面桩实现：全部记录 + 返回默认，绝不触发真实渲染/音频/输入。 */
export class StubNative implements NativeBridge {
  constructor(private onLog: (msg: string) => void = (m) => console.log(m)) {}

  log(msg: string): void {
    this.onLog(msg);
  }
  playSound(id: number, volume: number): void {
    this.log(`[native:stub] play-sound-effect id=0x${id.toString(16)} vol=${volume}`);
  }
  playBgm(id: number): void {
    this.log(`[native:stub] play-bgm id=0x${id.toString(16)}`);
  }
  playVoice(id: number): void {
    this.log(`[native:stub] play-voice id=0x${id.toString(16)}`);
  }
  drawTexture(args: number[]): void {
    // 默认实现：把 draw-texture 的 8 操作数解释为绘制项配置（与 op_draw_texture 同一语义）
    const [slot = 0, layer = 0, x = 0, y = 0, w = 0, h = 0, p = 0, q = 0] = args;
    this.log(`[native:stub] draw-texture slot=${slot} layer=${layer} src=(${x},${y},${w}x${h}) dst=(${p},${q})`);
  }
  setTexture(args: number[]): void {
    const [imgid = 0, slot = 0] = args;
    this.log(`[native:stub] set-texture imgid=0x${imgid.toString(16)} slot=${slot}`);
  }
  createTexture(slot: number, w: number, h: number, mode: number): void {
    this.log(`[native:stub] createTexture slot=${slot} ${w}x${h} mode=${mode}`);
  }
  setScale(handle: number, sx: number, sy: number, sz: number): void {
    this.log(`[native:stub] setScale h=0x${handle.toString(16)} (${sx},${sy},${sz})`);
  }
  setDrawTranslation(handle: number, x: number, y: number, z: number): void {
    this.log(`[native:stub] setDrawTranslation h=0x${handle.toString(16)} (${x},${y},${z})`);
  }
  getTextureSize(slot: number): { w: number; h: number } {
    this.log(`[native:stub] getTextureSize slot=${slot}`);
    return { w: 0, h: 0 };
  }
  drawCgNumber(id: number, rec: readonly number[], value: number, x: number, y: number, digits: number, flags: number): void {
    this.log(`[native:stub] drawCgNumber id=0x${id.toString(16)} rec=[${rec.join(',')}] value=${value} (${x},${y}) digits=${digits} flags=${flags}`);
  }
  setLight(idx: number, on: boolean): void {
    this.log(`[native:stub] setLight idx=${idx} on=${on}`);
  }
  destroyL2DSlot(slot: number): void {
    this.log(`[native:stub] destroyL2DSlot slot=${slot}`);
  }
  l2dSlotSet(slot: number, sel: number, value: number): void {
    this.log(`[native:stub] l2dSlotSet slot=${slot} sel=${sel} v=${value}`);
  }
  releaseMovieSlots(): void {
    this.log('[native:stub] releaseMovieSlots (42..999)');
  }
  clearMeshSlots(): void {
    this.log('[native:stub] clearMeshSlots');
  }
  clearSlotRecords(): void {
    this.log('[native:stub] clearSlotRecords (1000x2 记录表)');
  }
  setRenderState(state: number, value: number): void {
    this.log(`[native:stub] setRenderState #${state} = ${value}`);
  }
  setFont(args: number[]): void {
    this.log(`[native:stub] set-font [${args.map((a) => '0x' + a.toString(16)).join(', ')}]`);
  }
  setString(s: string): void {
    this.log(`[native:stub] set-string "${s}"`);
  }
  stringResourceId(s: string): number {
    this.log(`[native:stub] string-resource-id "${s}"`);
    return -1;
  }
  getInputType(): number {
    return 0;
  }
  menuReset(): void {
    this.log('[native:stub] menuReset (0xA1)');
  }
  menuBind(key: string, value: number): void {
    this.log(`[native:stub] menuBind key"${key}"=0x${value.toString(16)}`);
  }
  sleep(ms: number): void {
    this.log(`[native:stub] sleep ${ms}`);
  }
  unhandled(opcode: number, name: string): void {
    this.log(`[native:stub] unhandled subsystem opcode 0x${opcode.toString(16)} (${name})`);
  }

  // Plan A：桩版本记录 + 校验（严格）
  configureDrawItem(cfg: import('./native.js').DrawItemConfig): void {
    this.log(`[native:stub] configureDrawItem h=0x${cfg.handle.toString(16)} layer=${cfg.layer}`);
  }
  bindTexture(imgid: number, slot: number): void {
    this.log(`[native:stub] bindTexture imgid=0x${imgid.toString(16)} slot=${slot}`);
  }
  createMesh(spec: import('./native.js').MeshCreateSpec): void {
    this.log(`[native:stub] createMesh h=0x${spec.handle.toString(16)} v=${spec.vcount}`);
  }
  setVertexColor(handle: number, state0: number): void {
    this.log(`[native:stub] setVertexColor h=0x${handle.toString(16)} state0=0x${state0.toString(16)}`);
  }
  setVertexColorAlpha(handle: number, delay: number, count: number, state1: number): void {
    this.log(`[native:stub] setVertexColorAlpha h=0x${handle.toString(16)} d=${delay} c=${count} to=0x${state1.toString(16)}`);
  }
  setDrawColorAlpha(handle: number, from: number): void {
    this.log(`[native:stub] setDrawColorAlpha h=0x${handle.toString(16)} from=0x${from.toString(16)}`);
  }
  detachTexture(handle: number, count: number): void {
    this.log(`[native:stub] detachTexture h=0x${handle.toString(16)} count=${count}`);
  }
  setDrawColor(handle: number, delay: number, count: number, to: number): void {
    this.log(`[native:stub] setDrawColor h=0x${handle.toString(16)} d=${delay} c=${count} to=0x${to.toString(16)}`);
  }
  setWaitFlag(mask: number): void {
    this.log(`[native:stub] setWaitFlag 0x${mask.toString(16)}`);
  }
  releaseTexture(layer: number): void {
    this.log(`[native:stub] releaseTexture layer=${layer}`);
  }
  playMovie(id: number): void {
    this.log(`[native:stub] playMovie id=0x${id.toString(16)}`);
  }
  setDrawPivot(handle: number, x: number, y: number, z: number): void {
    this.log(`[native:stub] setDrawPivot h=0x${handle.toString(16)} (${x},${y},${z})`);
  }
  setDrawPos(handle: number, x: number, y: number, z: number): void {
    this.log(`[native:stub] setDrawPos h=0x${handle.toString(16)} (${x},${y},${z})`);
  }
  setScaleAnim(handle: number, delay: number, dur: number, sx: number, sy: number, sz: number): void {
    this.log(`[native:stub] setScaleAnim h=0x${handle.toString(16)} d=${delay} dur=${dur} s=(${sx},${sy},${sz})`);
  }
  setRotationAnim(handle: number, delay: number, dur: number, ax: number, ay: number, az: number, deg: number): void {
    this.log(`[native:stub] setRotationAnim h=0x${handle.toString(16)} d=${delay} dur=${dur} axis=(${ax},${ay},${az}) θ=${deg}`);
  }
  setTranslationAnim(handle: number, delay: number, dur: number, x: number, y: number, z: number): void {
    this.log(`[native:stub] setTranslationAnim h=0x${handle.toString(16)} d=${delay} dur=${dur} t=(${x},${y},${z})`);
  }
  setFlipbook(handle: number, delay: number, dur: number, frames: number, cols: number, flags: number): void {
    this.log(`[native:stub] setFlipbook h=0x${handle.toString(16)} d=${delay} dur=${dur} frames=${frames} cols=${cols} flags=${flags}`);
  }
  setTextureTransform(handle: number, value: number): void {
    this.log(`[native:stub] setTextureTransform h=0x${handle.toString(16)} v=${value}`);
  }
  gfxSubsystem(a2: number, a3: number, a4: number): void {
    this.log(`[native:stub] gfxSubsystem op1=${a2} op2=${a3} op3=${a4}`);
  }
  clearDrawContainer(): void {
    this.log('[native:stub] clearDrawContainer');
  }
  frameTick(): void {
    /* 每帧调用，stub 不记日志（避免刷屏） */
  }
}
