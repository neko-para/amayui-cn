/**
 * **纹理帧屏障②的观测面**（`tickets/T-0175` 的 ⑦，出处 `tickets/T-0166` §4-③）。
 *
 * ## 为什么单独成模块
 *
 * `RendererSession.#awaitTextureBound` 在 `set-texture`(0x1F9) 之后 `await native.texturesIdle()`，
 * 这是**产品路径上唯一一处"VM 停下来等宿主把图载完"**的屏障。修前它有三重不可见：
 *  1. `DebugQuery` 问不到（`slot` 查询只答宿主槽状态，没有"屏障跑过几次/刚刚有没有等"这一面）；
 *  2. trace 里没有逐次证据（只有 `PixiBackend` 内部的 `#barriers` 计数，而它**只在真的等到图时**
 *     才 +1 —— 见 `pixiBackend.ts` 的 `texturesIdle()`，`pendingCount === 0` 直接 return）；
 *  3. 唯一的守卫是**源文本匹配**（`test/no-boot-preload.test.ts:98-105` 在 `pixiBackend.ts` 里找
 *     `texturesIdle` 与 `present(` 的先后）—— 它证明"这两个字都在文件里"，证明不了
 *     "派发一次 0x1F9 ⇒ 屏障被 await 一次"。
 *
 * 本模块把**决策**抽成纯函数：`shouldAwaitTextureBarrier` 说得清"哪条 opcode 会过门、
 * 没缝时怎么办"，`observeTextureBarrier` 是同一份判据的**可观测包装** —— session 用它，
 * 测试也用它（`test/texture-barrier-observable.test.ts`）。
 *
 * ★**判据里唯一"引擎侧"的那条是 0x1F9，`0x249` 是 emulator 侧的补充**（`tickets/T-0102` 轮 9）：
 * 引擎的 `sub_425310`（raw 32717-32768）与 `sub_422CB0` 是同一族"按统一 id 把纹理载入槽"，
 * 两条都走宿主的**异步** `bindTexture` ⇒ 只认 0x1F9 会漏掉 0x249（语料 20 处 / 8 脚本）。
 *
 * ★**可选缝语义**（本项目刚立的纪律，见 `T-0164` 的 `hasSlotTexture`）：宿主不实现
 * `texturesIdle` ⇒ **不抛、不变行为**，本次只是"没有屏障可等"，并留一条可数的痕。
 */

/** 会触发纹理帧屏障的 opcode（`0x1F9` = 引擎的 `set-texture`；`0x249` = emulator 侧补充，见文件头）。 */
export const TEXTURE_BARRIER_OPS: readonly number[] = [0x1f9, 0x249];

/** 本 opcode 是否过屏障的门。 */
export function shouldAwaitTextureBarrier(opcode: number): boolean {
  return TEXTURE_BARRIER_OPS.includes(opcode | 0);
}

/** `observeTextureBarrier` 的结果（`observed === true` 才有 `trace` 行）。 */
export interface TextureBarrierObservation {
  opcode: number;
  /** 本次派发是否过了门（= 屏障**被调用**；不代表宿主真的等了图）。 */
  triggered: boolean;
  /** 宿主有没有这条缝；`triggered && !hostSeam` ⇒ `note` 里写明"没有可等的屏障"。 */
  hostSeam: boolean;
  /** 操作数下标——`0x1F9` 的槽号在 op2、`0x249` 在 op2（两条同形；`-1` = 池里没有）。 */
  slot: number;
  /** 包给宿主的 promise（未过门时为 `undefined`）。 */
  awaited: Promise<void> | undefined;
  /** 给 trace 的一行（`undefined` = 本次不该留痕：没过门）。 */
  trace: string | undefined;
  /** 一句话结论（给报告/DebugQuery 用）。 */
  note: string;
}

/**
 * **屏障的可观测包装**：过门 ⇒ 调 `awaitSeam`（宿主缝）并把 `trace` 行交回调用方。
 *
 * `awaitSeam` 缺失（宿主不实现可选缝）时**不抛**：`awaited` 为 `undefined`、`trace` 写明
 * "没有宿主缝可等" —— 与修前的行为**逐字相同**（修前也只是 `if (this.#native.texturesIdle)` 跳过），
 * 差别只在"现在这件事有痕、可数、可测"。
 *
 * @param opcode 刚派发的那条指令。
 * @param slot 该指令的槽号（仅用于 trace/可读性；缺失传 `-1`）。
 * @param awaitSeam `native.texturesIdle`（可选缝；undefined = 宿主不实现）。
 */
export function observeTextureBarrier(
  opcode: number,
  slot: number,
  awaitSeam: (() => Promise<void>) | undefined,
): TextureBarrierObservation {
  const op = opcode | 0;
  if (!shouldAwaitTextureBarrier(op)) {
    return {
      opcode: op,
      triggered: false,
      hostSeam: typeof awaitSeam === 'function',
      slot,
      awaited: undefined,
      trace: undefined,
      note: `0x${(op >>> 0).toString(16)} 不过纹理屏障（只有 ${TEXTURE_BARRIER_OPS.map((v) => `0x${v.toString(16)}`).join('/')} 过）`,
    };
  }
  if (typeof awaitSeam !== 'function') {
    return {
      opcode: op,
      triggered: true,
      hostSeam: false,
      slot,
      awaited: undefined,
      trace:
        `=== texture-barrier 0x${op.toString(16)} slot=${slot} —— 宿主不实现 texturesIdle ⇒ 无屏障可等` +
        '（纹理异步就绪后由 `#healSlot`/到货置脏自愈；本行是"这件事发生过"的唯一痕迹） ===',
      note: '宿主未实现可选缝 texturesIdle ⇒ 不 await、不抛（与原行为一致）',
    };
  }
  return {
    opcode: op,
    triggered: true,
    hostSeam: true,
    slot,
    awaited: awaitSeam(),
    trace: `=== texture-barrier await 0x${op.toString(16)} slot=${slot}（等宿主把该槽的图像载完后再派发下一条） ===`,
    note: '屏障②被 await：图像载入（IPC 异步）与随后的 0x208/0x1FB 之间插入同步点',
  };
}
