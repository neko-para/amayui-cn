/**
 * `.MTN`（Live2D Animator Motion，**文本**）解析器 + 动作播放态。
 *
 * ## 来源
 *  - **O** 反编译 oracle：`sub_4BE490`（raw 144631 起，`Live2DMotion` 的文本读法）
 *  - **E** 资产实证：`raw-parts` 下 330 个 `.MTN`
 *
 * ## 文本形态（330/330 实测）
 * ```
 * # Live2D Animator Motion Data
 * $fps=30
 * $fadein=1000
 * $fadeout=1000
 * <PARAM>=v0,v1,v2,…            # **等间隔**采样曲线（值序列，不是 (t,v) 对）
 * VISIBLE:<部件ID>=0|1          # ★部件显隐（覆盖 .moc 里的初始 visible 位）
 * LAYOUT:X=… / Y=… / SCALE_X=… / SCALE_Y=…   # ★动作自带布局：模型摆放就靠它
 * ```
 * E 的键直方图：`$fps/$fadein/$fadeout` 各 330、`LAYOUT:{X,Y,SCALE_X,SCALE_Y}` 各 237、
 * `VISIBLE:<部件名>` 79 组（按部件名各不相同）。**`LAYOUT:ANCHOR_*` 在语料里 0 次**
 * （CONTEXT 曾把 ANCHOR 列为可能键，实测本作不用 —— 解析器仍容忍它，但别把它当必需）。
 *
 * ## 播放口径（O 见 `live2d.md` §5）
 *  - 装载即入队（`0x34E` → `sub_4BCA20(queue, motion, 1)`）；
 *  - 推进**绑在"节点绘制"那一次调用**上（`sub_4783D0` → `sub_4BCB50`），**没有独立逐帧 tick**；
 *  - `$fadein/$fadeout` 是毫秒；`$fps` 决定采样间隔（`帧 = 时间ms * fps / 1000`）。
 */

/** 一条参数曲线（等间隔采样）。 */
export interface MtnCurve {
  paramId: string;
  values: number[];
}

export interface MtnLayout {
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  scaleX: number;
  scaleY: number;
}

export interface Mtn {
  name: string;
  fps: number;
  fadeInMs: number;
  fadeOutMs: number;
  curves: MtnCurve[];
  /** 部件显隐覆盖（`VISIBLE:` 行）。 */
  visible: Map<string, boolean>;
  /** 动作自带布局（`LAYOUT:` 行；缺省 = 见 `DEFAULT_LAYOUT`）。 */
  layout: MtnLayout;
  /** 曲线最长采样数（= 动作总帧数）。 */
  frames: number;
  /** 动作时长（ms）= `frames / fps * 1000`。 */
  durationMs: number;
}

/** `LAYOUT:` 缺省值（E：语料里没写 LAYOUT 的 93 个动作按引擎缺省摆）。 */
export const DEFAULT_LAYOUT: MtnLayout = { x: 0, y: 0, anchorX: 0.5, anchorY: 0.5, scaleX: 1, scaleY: 1 };

/**
 * 解析 `.MTN` 文本。
 *
 * 容错口径（照 SDK 的"读一行认一行"）：
 *  - 空行 / `#` 注释 ⇒ 跳过；
 *  - 未知 `$…=` ⇒ 忽略（但 `$fps/$fadein/$fadeout` 认）；
 *  - 未知 `X=…` ⇒ **当参数曲线**（参数名可以是任何字符串）；
 *  - `VISIBLE:` / `LAYOUT:` 是保留前缀，优先匹配。
 */
export function parseMtn(text: string | Uint8Array, name = ''): Mtn {
  const src = typeof text === 'string' ? text : new TextDecoder('latin1').decode(text);
  let fps = 30;
  let fadeInMs = 0;
  let fadeOutMs = 0;
  const curves: MtnCurve[] = [];
  const visible = new Map<string, boolean>();
  const layout: MtnLayout = { ...DEFAULT_LAYOUT };

  for (const rawLine of src.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const rhs = line.slice(eq + 1).trim();

    if (key === '$fps') {
      fps = Number(rhs) || fps;
      continue;
    }
    if (key === '$fadein') {
      fadeInMs = Number(rhs) || 0;
      continue;
    }
    if (key === '$fadeout') {
      fadeOutMs = Number(rhs) || 0;
      continue;
    }
    if (key.startsWith('$')) continue; // 其它 $-指令本作不用

    if (key.startsWith('VISIBLE:')) {
      visible.set(key.slice('VISIBLE:'.length).trim(), rhs !== '0');
      continue;
    }
    if (key.startsWith('LAYOUT:')) {
      const field = key.slice('LAYOUT:'.length).trim().toUpperCase();
      const v = Number(rhs);
      if (!Number.isFinite(v)) continue;
      if (field === 'X') layout.x = v;
      else if (field === 'Y') layout.y = v;
      else if (field === 'SCALE_X') layout.scaleX = v;
      else if (field === 'SCALE_Y') layout.scaleY = v;
      else if (field === 'ANCHOR_X') layout.anchorX = v;
      else if (field === 'ANCHOR_Y') layout.anchorY = v;
      continue;
    }

    const values = rhs
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((v) => Number.isFinite(v));
    if (values.length === 0) continue;
    curves.push({ paramId: key, values });
  }

  let frames = 0;
  for (const c of curves) frames = Math.max(frames, c.values.length);
  const durationMs = fps > 0 ? (frames / fps) * 1000 : 0;
  return { name, fps, fadeInMs, fadeOutMs, curves, visible, layout, frames, durationMs };
}

/** 曲线在 `t`（帧，可为小数）处的值：等间隔采样 + 线性插值 + 端值续接。 */
export function curveValue(curve: MtnCurve, frame: number): number {
  const n = curve.values.length;
  if (n === 0) return 0;
  if (n === 1) return curve.values[0]!;
  if (frame <= 0) return curve.values[0]!;
  if (frame >= n - 1) return curve.values[n - 1]!;
  const i = Math.floor(frame);
  const t = frame - i;
  return curve.values[i]! + (curve.values[i + 1]! - curve.values[i]!) * t;
}

/** 淡入淡出权重（O：`$fadein`/`$fadeout` 毫秒；`elapsed` 与 `duration` 也是毫秒）。 */
export function fadeWeight(motion: Mtn, elapsedMs: number, durationMs: number): number {
  let w = 1;
  if (motion.fadeInMs > 0 && elapsedMs < motion.fadeInMs) w = Math.min(w, elapsedMs / motion.fadeInMs);
  if (motion.fadeOutMs > 0) {
    const remain = durationMs - elapsedMs;
    if (remain < motion.fadeOutMs) w = Math.min(w, Math.max(0, remain) / motion.fadeOutMs);
  }
  return Math.max(0, Math.min(1, w));
}

/** 一条正在播放的动作。 */
export interface MotionPlay {
  motion: Mtn;
  /** 已播时长（ms）。 */
  elapsedMs: number;
  /** 循环位（`0x34E` op4）。 */
  loop: boolean;
  /** 预置动作号（`0x352` 写，`0x34E` 绑）。 */
  pendingIndex?: number;
}

/**
 * 一个 L2D 实例槽的**运行态**（= 引擎 76 字节实例里对绘制有意义的那部分，见 `live2d.md` §2）。
 *
 * 与引擎的字段对应：
 *  - `model`/`motions` ← `+0` 模型 / `+4`+`+8` 两条动作槽；
 *  - `textures` ← `+36+4*i` 十张纹理；
 *  - `pendingTextureNo`/`pendingMotionNo` ← `+24/+28` 与 `+25/+32`（`0x352` 写、`0x34E` 消费）；
 *  - `queue` ← `+12` MotionQueueManager（这里简化为"当前动作 + 下一个"）。
 */
export interface L2dInstance {
  slot: number;
  /** 模型文件 id（诊断用）。 */
  modelId: number | null;
  model: import('./moc.js').MocModel | null;
  /** 参数（用模型参数定义的 `defaultValue` 初始化，动作/`0x351` 会覆盖）。 */
  params: Map<string, number>;
  /** 纹理号 → 图像文件 id（`0x345` 写）。 */
  textures: Map<number, number>;
  /** 动作槽（0/1）→ 已载动作。 */
  motions: Map<number, Mtn>;
  /** 当前动作（动作槽号）；`null` = 没有。 */
  current: MotionPlay | null;
  /** `0x352` 预置：`pendingTextureNo`（op2==0）。 */
  pendingTextureNo: number | null;
  /** `0x352` 预置：`pendingMotionNo`（op2!=0）。 */
  pendingMotionNo: number | null;
  /** 部件显隐覆盖（模型初始 `visible` 位 + 动作的 `VISIBLE:`）。 */
  partVisible: Map<string, boolean>;
}

/** 建一个空实例槽。 */
export function newL2dInstance(slot: number): L2dInstance {
  return {
    slot,
    modelId: null,
    model: null,
    params: new Map(),
    textures: new Map(),
    motions: new Map(),
    current: null,
    pendingTextureNo: null,
    pendingMotionNo: null,
    partVisible: new Map(),
  };
}

/** 装模型：重置参数与部件显隐（引擎 `0x341` 是"槽非空先析构再建"，即惰性重建）。 */
export function attachModel(inst: L2dInstance, modelId: number, model: import('./moc.js').MocModel): void {
  inst.modelId = modelId;
  inst.model = model;
  inst.params = new Map();
  inst.partVisible = new Map();
  for (const p of model.params) {
    if (!p.id) continue;
    inst.params.set(p.id.name, p.defaultValue);
  }
  for (const part of model.parts) {
    if (part.id) inst.partVisible.set(part.id.name, part.visible);
  }
}

/**
 * 装动作（= `0x34E`：`sub_478640`）：
 * ① 绑定 `0x352` 预置的纹理号/动作号；② 动作槽 +4/+8 ← 动作；
 * ③ `sub_4BCA20(queue, motion, 1)` **装载即入队**；④ 循环位 `op4` 写进播放态。
 */
export function startMotion(inst: L2dInstance, motion: Mtn, motionSlot: number, loop: boolean): void {
  inst.motions.set(motionSlot, motion);
  if (inst.pendingMotionNo != null) {
    inst.pendingMotionNo = null;
  }
  if (inst.pendingTextureNo != null) {
    inst.pendingTextureNo = null;
  }
  inst.current = { motion, elapsedMs: 0, loop };
  // 动作自带的部件显隐立即生效（引擎在动作入队时写 visible 表）。
  for (const [part, vis] of motion.visible) inst.partVisible.set(part, vis);
}

/**
 * **推进动作**（= `sub_4BCB50`，只在"节点绘制"那一次调用里发生）。
 *
 * @returns 本帧的动作参数覆盖（`paramId → 值`）；没有在播动作 ⇒ 空。
 */
export function advanceMotion(inst: L2dInstance, deltaMs: number): Map<string, number> {
  const out = new Map<string, number>();
  const play = inst.current;
  if (!play) return out;
  play.elapsedMs += deltaMs;
  const dur = play.motion.durationMs;
  if (dur > 0 && play.elapsedMs > dur) {
    if (play.loop) play.elapsedMs %= dur;
    else play.elapsedMs = dur;
  }
  const frame = (play.elapsedMs / 1000) * play.motion.fps;
  const w = fadeWeight(play.motion, play.elapsedMs, dur);
  for (const c of play.motion.curves) {
    const target = curveValue(c, frame);
    const cur = inst.params.get(c.paramId) ?? 0;
    // fade 权重作用于"本次覆盖的强度"：w=0 ⇒ 保持原值（装载瞬间的淡入）
    out.set(c.paramId, cur + (target - cur) * w);
  }
  return out;
}

/** 复位动作队列（`0x350`）。 */
export function resetMotionQueue(inst: L2dInstance): void {
  inst.current = null;
}
