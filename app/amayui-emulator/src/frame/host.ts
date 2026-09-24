/**
 * **帧宿主接口** —— 一帧里"引擎之外"需要的全部能力。
 *
 * 为什么要这个接口（2026-09，用户要求"让 headless 与 UI 的核心驱动完全一致"）：
 * 现在每个入口各自写了一遍帧循环（`session.ts` / `report.ts` / 两份 chain / `run.ts`），
 * 而它们对宿主的诉求其实只有很少几项。把这几项显式化成接口后，**驱动只需要一份**
 * （`frameLoop.ts`），Electron 与 headless 只在"实现了哪些能力"上分叉。
 *
 * ★**可选性是刻意的**：`present`/`needsRender`/`poolPending`/`texturesIdle`/`audio` 目前只有
 * Electron 宿主有（`PixiBackend`）。B1 阶段（零行为变更）驱动对"宿主没有该能力"必须降级而不是报错，
 * 否则 headless 进不来；B3 会把 `audio`/`needsRender` 语义补到 headless 侧（那样两条路径才真的等价）。
 * 缺哪些能力 → 见 `tickets/T-0013`（宿主能力面入桥）。
 */
import type { AudioIntent } from '../audio/audioEngine.js';
import type { SceneState } from '../renderer/scene/state.js';
import type { DigestHost } from './digest.js';

export interface FrameHost {
  /**
   * 单调毫秒。Electron = 真实墙钟（`performance.now()`）；headless = 虚拟时钟（由调用方推进）。
   * 驱动每帧开头读它并写进 `e.nowMs` —— **这是"同一脚本同一时刻"可比的前提**（见 D1）。
   */
  now(): number;
  /** 让出一帧：Electron = `requestAnimationFrame`；headless = 立即 resolve（或不实现）。 */
  yield?(): Promise<void>;
  /**
   * **推进模型到本帧时钟**（引擎：合成时按 `CalcDiffuse`/窗状态求值 ⇒ 窗的相位与收尾在"这一帧的时间"上推进）。
   * 驱动在**每帧末**调一次，参数是本帧时钟。headless 实现（`scAdvance`）；pixi 目前把推进放在 presenter 里
   * （`tickets/T-0008` 的 D3 要在 B4 把它拆出来，与这里对齐）。
   *
   * `opts.freeze` = 引擎 `Scene+46512`（强制冻结 / 立即收尾；`tickets/T-0091` 的 G1）：
   * 为真时所有 A 层动画窗 + 转场窗**当帧跳到终态**（raw 117449 / 133517 / 134941），
   * 而不是按墙钟继续跑。驱动每帧末传 `e.sceneFreeze`（置位者 `sub_407EA0` raw 12796）。
   * ★不给（或给 false）时行为与旧版一致 ⇒ 只实现 `advanceModel(nowMs)` 的宿主仍然合法。
   */
  advanceModel?(nowMs: number, opts?: { freeze?: boolean }): void;
  /** 合成一帧（渲染）。headless 无（它只推进模型 + 出快照）。★可以是异步的：Electron 在合成前要等纹理屏障。 */
  present?(): void | Promise<void>;
  /** "这一帧该不该合成"。headless 无。 */
  needsRender?(): boolean;
  /**
   * **本遍推进/合成时"池是否挂起"** —— `Scene+46516`（引擎绘制期"还有元素在动"；`tickets/T-0024`）。
   *
   * ★口径 = 共享层 `scPoolPending`（mesh 窗 + draw item 5 个窗，**排除 `+720` bit0 的元素**）：
   * 排除项有引擎依据（`sub_49AA30` raw 117843-117844），也是序章 80 000 ms 慢推不钉住门的原因
   * （`src/SN0000.txt:1043-1048` 的 `i220` + `i242 … 1`）。
   *
   * ★**无参**且只回答"上一遍"：驱动在每帧末 `advanceModel(nowMs)` 之后取一次，锁存进
   * `Engine.scenePending`（引擎 raw 130427-130428 每遍绘制开头清零、绘制期置位 ⇒ 门读到的是**上一遍**的值）。
   * 未实现 ⇒ 驱动按"池不挂起"处理（`gates.anim: 'wait'` 就只等 `0x238` 计时器）。
   */
  poolPending?(): boolean;
  /** 纹理帧屏障（引擎 `0x1F9` 是同步读文件，renderer 走异步 IPC ⇒ 需要补偿）。headless 无纹理，跳过。 */
  texturesIdle?(): Promise<void>;
  /** 音频帧泵（`Engine+430600` 那一族的等价物）。目前只有 Electron 有（见 T-0006）。 */
  audio?(intent: AudioIntent): void;
  /**
   * **外部挂起渲染**（引擎 `Engine+675968`，dword 下标 **168992**；`tickets/T-0167` 的 §4.2 #7）。
   *
   * 引擎的**两个**写入点都在窗口/显示层，而不是脚本层：
   *  - 置 1：`sub_406050`（raw 11517-11544）—— 弹模态框 / 切显示模式**之前**「挂起渲染」
   *    （`*(_DWORD *)(_this + 675968) = 1;`，随即 `SendMessageA(hwnd, 0x1400, …)` 并置 `effect_flags |= 0x200000`）；
   *  - 清 0：`sub_406220`（raw 11625-11631）—— `SetWindowPos` 之后恢复。
   * 主循环的帧提交门（raw 20742-20745）读到它非 0 时 `v92 = 0`：**整个 D3D 提交块被跳过**
   * （含 raw 20750-20751 的帧时钟写与 raw 20758 的 `sub_4B4040`）。
   *
   * ⇒ emulator 里"弹窗/切显示模式"就是宿主（窗口层）的事，所以它是宿主缝；未实现 ⇒ 视为"未挂起"。
   * ★注意名字：字段名 `aSetIsreggist` 与 raw 20577 的 `set:IsReggist` 配置读**无关**（那是局部量 `v97`），
   *   审计报告 §4.2 #7 把它写成「外部暂停（aSetIsreggist）」是张冠李戴。
   */
  renderSuspended?(): boolean;
  /**
   * **本宿主的场景模型**（`FrameDigest` 的输入之一；`tickets/T-0003` 验收 4）。
   *
   * ★为什么不按设计文档 §3 把 `digest()` 整个放在宿主上：digest 的 engine 段大部分是 **Engine**
   * 的状态（`script`/`gates`/`routes`/`pages`），只有场景模型在宿主里。让两个宿主各拼一份 digest
   * 就是"同一件事两份实现"（`T-0008` 的 `waitFlags` 镜像与 `scAnimationsDone` 口径漂移都是这么来的）。
   * ⇒ 纯函数构建器在 `frame/digest.ts`（唯一一份），宿主只交出自己的场景模型。
   */
  digestState?(): SceneState;
  /** 宿主义务计数（屏障/音频意图/字体缺字）—— 进 `FrameDigest.host` 段，**不参与两宿主比较**。 */
  digestHostCounters?(): DigestHost;
  /**
   * **抓一帧当前合成结果为 PNG 字节**（可选能力）。
   *
   * ★为什么在**帧宿主**这一层、而不是宿主各自的 IPC：`tickets/T-0133` §B.4.4 —— 截图与输入/焦点
   * 一样是"宿主无关"的诉求，人类看的帧流与 agent 的 `shot` 必须是**同一条路径**（否则两者会漂移）。
   * 因此它是 `FrameHost` 的一个可选成员，由**像素宿主**实现（Pixi 侧 = `PixiBackend.captureFrame`）。
   *
   * ★**headless 宿主不实现它**（`headlessFrameHost.ts` 刻意不提供）：headless 的"合成"是推进模型 +
   * 出快照，本来就没有像素 —— "没有这张能力"正是它的语义，而不是缺陷。调用方据此降级（见 `capturePng`）。
   */
  capture?(): Promise<Uint8Array>;
}

/**
 * **桥对"抓一帧"的唯一下沉点**（`tickets/T-0134` WS-2 的冻结接口）。
 *
 * 语义（三条，逐条都有守卫）：
 *  1. 宿主**没有** `capture` ⇒ 返回 `null`（headless = 没有像素；调用方据此降级，**不是**错误路径）；
 *  2. 宿主有 ⇒ 原样返回它的 PNG 字节；
 *  3. `capture()` **自己抛** ⇒ 原样往外抛（不吞）。"没有能力"与"有能力但这次失败"必须可区分：
 *     前者是常态（headless），后者是真故障，吞掉就会变成"截图偶尔变空"这种最难查的症状。
 */
export async function capturePng(host: FrameHost): Promise<Uint8Array | null> {
  if (!host.capture) return null;
  return host.capture();
}
