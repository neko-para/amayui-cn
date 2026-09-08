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
  /** 保留旧 raw 兼容名（内部已改为配置 draw-item，不立即出像素） */
  drawTexture?(args: number[]): void;
  /** 保留旧 raw 兼容名（内部改为绑定 slot→imgid） */
  setTexture?(args: number[]): void;
  setFont?(args: number[]): void;
  setString?(s: string): void;
  stringResourceId?(s: string): number;
  getInputType?(): number;
  sleep?(ms: number): void;
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
    this.log(`[native:stub] draw-texture [${args.map((a) => '0x' + a.toString(16)).join(', ')}]`);
  }
  setTexture(args: number[]): void {
    this.log(`[native:stub] set-texture [${args.map((a) => '0x' + a.toString(16)).join(', ')}]`);
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
}
