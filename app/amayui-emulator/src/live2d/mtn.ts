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

// ★眨眼那一半（实例 `+16`/`+23`）在 `blink.ts`：与动作队列互相独立，但共用同一个实例记录。
//   这里是**唯一的** import 方向（blink.ts 不认识 mtn.ts）⇒ 不会成环。
import { newBlinkMotion, type BlinkMotion } from './blink.js';

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
  /**
   * 循环位 —— 引擎的**动作记录 `+36`**（不是实例 `+20`）：`sub_4784D0` 写它
   * （raw 92648 `*(_BYTE *)(result + 36) = *(_BYTE *)(_this + 20);`），而 `sub_4784D0`
   * **只在动作槽 0 的支线**里被调用（raw 92837；槽 1 支线 raw 92843-92860 没有它）
   * ⇒ 槽 1 的动作永远是"不循环"。
   */
  loop: boolean;
  /** 预置动作号（`0x352` 写，`0x34E` 绑）。 */
  pendingIndex?: number;
}

/**
 * **一个动作记录**（引擎实例 `+4`/`+8` 指向的那个对象，`sub_4BE490` 建）。
 *
 * 为什么单独建模（`tickets/T-0160`，审计 row 91/93/96）：引擎的 `0x34E` 是
 * `_this[1或2] = sub_4BE490(字节, 长)` —— **每次装载都新建一个动作对象**，随后
 * ① 才把 `0x352` 预置的纹理号/动作号写进它（`+4`/`+8`）、② 解析错则 `return 0`
 * （坏对象**留在**记录槽里、不入队），③ 入队。emulator 旧模型只有一张
 * `motions: Map<槽, Mtn>`，既没有 `+4/+8` 这两个落点，也没有"新对象"语义。
 */
export interface L2dMotionRecord {
  /** 动作对象（`sub_4BE490` 的返回值）。 */
  motion: Mtn;
  /** `+4`：`0x352`（`which == 0`）预置的纹理号，装载时从实例 `+28` 应用，用后清 0。 */
  textureNo: number;
  /** `+8`：`0x352`（`which != 0`）预置的动作号，装载时从实例 `+32` 应用，用后清 0。 */
  motionNo: number;
  /** `+36`：循环位（只有动作槽 0 会被 `sub_4784D0` 写）。 */
  loop: boolean;
  /**
   * `sub_4BCE90()` = "动作对象解析出错"标记。
   *
   * ★emulator 的口径（诚实登记）：我们的 `parseMtn` 是**容错**解析（读一行认一行，从不抛），
   * 没有 SDK 那个错误标志位；这里用"**一条曲线都没解析出来**"当它的等价物
   * （`startMotionOnSlot` 计算后传进来，见那里的说明）。
   */
  parseError: boolean;
}

/**
 * 一个 L2D 实例槽的**运行态**（= 引擎 76 字节实例里对绘制有意义的那部分，见 `live2d.md` §2）。
 *
 * 与引擎的字段对应：
 *  - `model` ← `+0` 模型；`records` ← `+4`+`+8` 两条**动作记录**（`0x34E` 每次新建）；
 *  - `textures` ← `+36+4*i` 十张纹理；
 *  - `pendingTextureNo`/`pendingMotionNo` ← `+24/+28` 与 `+25/+32`（`0x352` 写、`0x34E` 消费）；
 *  - `loop` ← `+20`（`sub_4784D0` 写、`sub_478500` 清）、`loaded` ← `+21`/`+22`（装载标志）；
 *  - `mulColor`/`mulColors` ← `0x34F` 解码出的乘色（`sub_478590` 逐纹理下发）；
 *  - `current` ← `+12` MotionQueueManager 的"当前在播那一条"（简化模型）。
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
  /** 动作槽（0/1）→ 动作记录（引擎 `+4`/`+8`）。 */
  records: Map<number, L2dMotionRecord>;
  /** 当前动作（`null` = 队列空）。 */
  current: MotionPlay | null;
  /** `+20`：播放/循环位（`sub_4784D0` 写；`0x350` 的 `sub_478500` 清）。 */
  loop: boolean;
  /** `+21`/`+22`：**动作槽 0/1「已装载、还没结算」标志**（`0x34E` 置、`sub_4783D0` 结算）。 */
  loaded: [boolean, boolean];
  /** `0x352` 预置：`pendingTextureNo`（op2==0）。 */
  pendingTextureNo: number | null;
  /** `0x352` 预置：`pendingMotionNo`（op2!=0）。 */
  pendingMotionNo: number | null;
  /** 部件显隐覆盖（模型初始 `visible` 位 + 动作的 `VISIBLE:`）。 */
  partVisible: Map<string, boolean>;
  /** `0x34F` 解码出的乘色三分量（`[BYTE2/255, BYTE1/255, BYTE0/255]`，见 `sub_428400` raw 34810-34818）。 */
  mulColor: [number, number, number] | null;
  /** `0x34F` 收到的**原始打包值**（诊断/守卫用；`-1` = `sub_4ADD60` 查不到工作色）。 */
  mulColorRaw: number | null;
  /** `0x34F` 的**逐纹理**下发（`sub_478590` raw 92729-92740：只对已有纹理槽调 `sub_4BD150`）。 */
  mulColors: Map<number, [number, number, number]>;
  /**
   * **实例 `+16` 的眨眼运动态**（`live2d::EyeBlinkMotion`，104 字节对象）——
   * 构造点 `sub_478270` 的 `sub_4BC380(104)` → `sub_4BC3E0`（raw 92540-92545）。
   *
   * ★它与动作队列（`+12`）**互相独立**：`sub_4783D0` 里那个 `if (*((_BYTE*)_this + 23))`
   * 在 `if (+21 || +22)` 那个块**之外**（raw 92605 vs raw 92586）⇒ 没有动作装载时照样每帧跑。
   */
  blink: BlinkMotion;
  /**
   * **实例 `+23` 的眨眼门控**（字节；极性 = **非 0 即真**，`.lst` `00478429 cmp byte ptr [esi+17h],0`
   * + `jz`）。
   *
   * ★★**随包二进制里这一格是构造时被清 0、且没有任何写者**：`.lst` 的 `sub_478270` 结尾
   * `mov [esi+15h], ebx`（`ebx = 0`）一条 **dword** 存把 `+21..+24` 一并清掉（Hex-Rays 的 `_DWORD`
   * 视图只渲染成 `+21 = 0`，`+23` 整个看不见 —— 只读 `.c` 会误判成"未初始化"）；此后全 `.c` 的
   * `*((_BYTE *)_this + 23) = …` **0 命中**、`.lst` 的 `byte ptr […+13h]` 全库仅 1 处且属别的对象
   * （`004D71D5`，`sub_4D7320`）。⇒ **缺省必须是 `false`**（= 引擎的真实运行行为，门永久为 0）；
   * 把它默认打开就是编模型（详见 `blink.ts` 文件头的"极性与来源"）。
   */
  blinkEnabled: boolean;
}

/** 建一个空实例槽。 */
export function newL2dInstance(slot: number): L2dInstance {
  return {
    slot,
    modelId: null,
    model: null,
    params: new Map(),
    textures: new Map(),
    records: new Map(),
    current: null,
    loop: false,
    loaded: [false, false],
    pendingTextureNo: null,
    pendingMotionNo: null,
    partVisible: new Map(),
    mulColor: null,
    mulColorRaw: null,
    mulColors: new Map(),
    blink: newBlinkMotion(),
    // ★`+23` 缺省 0（随包二进制里没有写者 ⇒ 那支永不执行）；见字段说明与 `blink.ts` 文件头。
    blinkEnabled: false,
  };
}

/**
 * 装模型：重置参数与部件显隐（引擎 `0x341` 是"槽非空先析构再建"，即惰性重建）。
 *
 * ★`tickets/T-0160`（审计 row 280/281）：`0x341` 的真身是 `sub_4A1860` raw 121674-121681 ——
 * **先** `sub_4785E0(旧实例) + operator delete(旧实例) + 槽 = 0`，**再** `new(0x4C)` + 解析。
 * 而 `sub_4785E0`（raw 92745-92762）里就有 `sub_4BD020(模型)` 与
 * `if (_this[3]) { sub_478500(_this); …销毁动作队列 }` ⇒ **换装/重装会把动作队列 + `+20/+21/+22` 一并复位**。
 * emulator 的等价做法 = 装模型时**整份换成一个新实例对象**（`l2dLoadModel`），不是往旧实例里塞字段。
 */
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
 * 装动作（= `0x34E` 的 `sub_478640`，raw 92815-92861）。
 *
 * 逐句对齐（两条槽支线差别**只在 ④⑤**）：
 * ```c
 * if ( !*_this ) return 0;                       // ★模型/实例不存在 ⇒ 彻底 no-op
 * _this[1或2] = sub_4BE490(a3, a4);              // ① 每次装载**新建**动作记录
 * if ( sub_4BCE90() ) return 0;                  // ② 解析错 ⇒ 坏记录留着、不入队、不置标志
 * if (+24) { 记录+4 = _this[7]; +24 = 0; _this[7] = 0; }   // ③ 应用 0x352 预置
 * if (+25) { 记录+8 = _this[8]; +25 = 0; _this[8] = 0; }
 * sub_4BCA20(_this[3], _this[1或2], 1);          // ④ 装载即入队
 * [仅槽 0] sub_4784D0(_this, a5);                // ⑤ 只有槽 0 消费循环位 op4
 * +21或+22 = 1;                                  // ⑥ 装载标志
 * ```
 *
 * @returns 是否真的装载了（`false` = 门挡掉或解析错；`0x34E` 的 handler 据此报错）。
 */
export function startMotion(
  inst: L2dInstance,
  motion: Mtn,
  motionSlot: number,
  loop: boolean,
  parseError = false,
): boolean {
  // ★门（raw 92817 `if ( !*_this ) return 0;`）：`*_this` = 实例 `+0` 的模型指针。
  if (!inst.model) return false;
  // ① 新动作记录（**新对象** ⇒ `+4/+8/+36` 都是缺省，不继承上一条）
  const rec: L2dMotionRecord = { motion, textureNo: 0, motionNo: 0, loop: false, parseError };
  inst.records.set(motionSlot, rec);
  // ② 解析错 ⇒ 记录里留着坏对象，但不入队、不置标志、不消费预置（raw 92822-92824 / 92844-92846）
  if (parseError) return false;
  // ③ `0x352` 预置落到动作记录 `+4`/`+8` 并清标志（raw 92824-92835）
  if (inst.pendingTextureNo != null) {
    rec.textureNo = inst.pendingTextureNo;
    inst.pendingTextureNo = null;
  }
  if (inst.pendingMotionNo != null) {
    rec.motionNo = inst.pendingMotionNo;
    inst.pendingMotionNo = null;
  }
  // ④ 装载即入队（raw 92836 / 92858）
  inst.current = { motion, elapsedMs: 0, loop: motionSlot === 0 ? loop : rec.loop };
  // ⑤ 只有动作槽 0 消费循环位 op4（raw 92837）—— 槽 1 支线没有 `sub_4784D0`
  if (motionSlot === 0) {
    inst.loop = loop;
    rec.loop = loop;
  }
  // ⑥ 装载标志（raw 92838 `+21 = 1` / 92859 `+22 = 1`）
  if (motionSlot === 0) inst.loaded[0] = true;
  else inst.loaded[1] = true;
  // 动作自带的部件显隐立即生效（引擎在动作入队时写 visible 表）。
  for (const [part, vis] of motion.visible) inst.partVisible.set(part, vis);
  return true;
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

/**
 * **队列空了没有** —— 引擎 `sub_4783D0` raw 92588 的 `sub_4BCCA0(_this[3])`。
 *
 * ★这一跳的 SDK 语义只能从**调用点的形状**反推（`sub_4BCCA0` 在 Live2D 插件里，不在本 exe 的
 *   `.c` 里）：它所在的块做的是「`+22` 清了就算完」/「`+20` 还在就**重新入队**槽 0 的动作」/
 *   「否则清 `+21`」，而重新入队只对**循环播完**才有意义 ⇒ 判据取"队列里没有在播的动作，
 *   或非循环动作已到片尾"。这段反推在 changes 里登记为**未完全确证**。
 */
export function motionQueueFinished(inst: L2dInstance): boolean {
  const play = inst.current;
  if (!play) return true;
  if (play.loop) return false;
  const dur = play.motion.durationMs;
  return dur > 0 && play.elapsedMs >= dur;
}

/**
 * **复位动作队列**（`0x350` 的 `sub_4A1AA0` → `sub_478500` raw 92653-92664）。
 *
 * 引擎逐字：`if (*(_DWORD*)_this) { sub_4BCD40(队列); *(_WORD*)(_this+21) = 0; _this[20] = 0; }`
 * ⇒ ① **模型非空**才是门（槽不存在/槽里没模型 ⇒ 什么都不做）；② 清 `+21`/`+22`（`_WORD` 两字节一起清）；
 * ③ 清 `+20`（`_this` 是 `char*` ⇒ `_this[20]` 是**字节** `+20`）。
 * ★动作记录的 `+36`（循环位）**不在**清点里 —— 审计 row 96 的括注「动作记录上的循环位也没清」
 * 指的是 emulator 缺这一整块，不是引擎清了它。
 */
export function resetMotionQueue(inst: L2dInstance): boolean {
  if (!inst.model) return false;
  inst.current = null;
  inst.loaded = [false, false];
  inst.loop = false;
  return true;
}
