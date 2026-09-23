/** @tier T0 @kind tool @subsystem host */

/**
 * **闸门 A 回归测试**：`withNativeTap` 让"宿主没实现的 native 调用"不再静默。
 *
 * 背景：`NativeBridge` 的方法几乎都是可选的，`c.native.setLight?.(...)` 在宿主未实现时会**静默变成空操作**
 * —— 无日志、无计数、控制窗里也看不到。实测有 11 个被 `ops.ts` 调用的方法处于这种状态，而对应的 opcode
 * 全都标着"真实现"。本测试锁死"一定会留下痕迹"这条性质。
 *
 * ★2026-09（`tickets/T-0013`）追加**宿主能力面守卫**：把"两个宿主实现了哪些桥方法"钉成显式清单 ——
 * 桥方法的差异必须落在 `DECLARED_HOST_DIVERGENCE` 内，宿主自己新增的方法必须落在两份非桥清单内。
 * 这样"headless 悄悄少一个能力"或"某宿主自己长出一个没人知道的桥方法"都会立刻变红，
 * 而不是等到某条链路跑出怪结果才发现。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRIDGE_METHODS, DropRecorder, withNativeTap } from '../src/vm/nativeTap.js';
import { PixiBackend } from '../src/renderer/pixiBackend.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';

test('未实现的方法被调用时会记事件（方法名/次数/实参/归因 opcode）', () => {
  let opcode = 0x32f;
  const rec = new DropRecorder(() => opcode);
  const inner = {
    log: (m: string) => void m,
    playSound: (id: number) => void id,
  };
  const tapped = withNativeTap(inner, rec) as unknown as {
    log(m: string): void;
    playSound(id: number, vol: number): void;
    setLight(idx: number, on: boolean): void;
    setRenderState(state: number, value: number): void;
  };

  tapped.setLight(3, false);
  tapped.setLight(4, false);
  opcode = 0x340;
  tapped.setRenderState(22, 1);

  const list = rec.list();
  assert.equal(list.length, 2, '两个未实现方法各记一条');
  const light = list.find((e) => e.method === 'setLight')!;
  assert.equal(light.count, 2, '次数累加');
  assert.equal(light.sample, '4, false', '采样保留最近一次实参');
  assert.deepEqual(light.opcodes, ['0x32f'], '归因到 opcode');
  assert.ok(light.why.includes('无报错'), '每条都带"缺了它会有什么无报错表现"的说明');
  assert.equal(list[0]!.count >= list[1]!.count, true, '按次数降序（影响大的先看）');
  assert.equal(rec.totalCalls(), 3, '总调用次数');
});

test('已实现的方法原样转发，且不进事件表', () => {
  const rec = new DropRecorder();
  const got: unknown[] = [];
  const inner = {
    log: (m: string) => got.push(m),
    playSound: (id: number, vol: number) => got.push([id, vol]),
  };
  const tapped = withNativeTap(inner, rec) as unknown as {
    log(m: string): void;
    playSound(id: number, vol: number): void;
    playBgm(id: number): void;
  };
  tapped.log('hi');
  tapped.playSound(7, 100);
  tapped.playBgm(9); // 未实现 → 记事件
  assert.deepEqual(got, ['hi', [7, 100]], '已实现的方法行为不变');
  assert.equal(rec.count(), 1);
  assert.equal(rec.list()[0]!.method, 'playBgm');
});

test('Proxy 不会被当成 thenable（否则 await 会挂住）', async () => {
  const rec = new DropRecorder();
  const tapped = withNativeTap({ log: () => {} }, rec) as unknown as Record<string, unknown>;
  assert.equal(tapped['then'], undefined, 'then 必须为 undefined');
  await Promise.resolve(tapped); // 不应挂起
  assert.equal(rec.count(), 0, '探测 then 不应产生事件');
});

test('数据属性（非函数）透传；未实现的数据属性不会凭空出现', () => {
  const rec = new DropRecorder();
  const marker = { hello: 'world' };
  const tapped = withNativeTap({ log: () => {}, input: marker }, rec) as unknown as {
    input?: unknown;
    nothing?: unknown;
  };
  assert.equal(tapped.input, marker, '数据属性原样透传');
  assert.equal(tapped.nothing, undefined, '非桥方法（数据属性）保持 undefined，不会凭空变成真值');
});

// ---------------------------------------------------------------------------
// ★宿主能力面守卫（`tickets/T-0013`）
// ---------------------------------------------------------------------------

/** 原型上的方法名集合（不实例化：pixi 后端需要 WebGL/DOM，构造不出来）。 */
function protoMethods(proto: object): string[] {
  return Object.getOwnPropertyNames(proto)
    .filter((n) => n !== 'constructor')
    .sort();
}

/**
 * **已声明的宿主能力差异**（pixi 实现、headless 未实现的桥方法）。
 *
 * 这份清单就是"契约"：任何增删都要同步改这里 + 在 `tickets/T-0013` 里说明。
 * 分类与理由：
 *  - **纹理/像素**（headless 没有渲染目标）：`preloadImage` / `texturesIdle` / `present`
 *    —— headless 的"合成"是出快照（`snapshot()` 清脏位），不是画像素；
 *  - **音频**（T-0006 待补：headless 缺音频帧泵）：`audio` / `playSound` / `playBgm` / `playVoice`；
 *  - **影片/输入/收尾**（headless 无窗口/无消息泵）：`playMovie` / `getInputType` / `sleep` /
 *    `startFrameLoop` / `unhandled`；
 *  - **GDI 文本/字符串资源**（headless 不落纹理）：`setFont` / `setString` / `stringResourceId`。
 * ★`poolPending` 与 `needsRender` **不在**本表里：两个宿主都必须实现
 *   （前者 = `0x400` 门的池挂起位，`T-0013`/`T-0024`；后者 = "该不该合成"，判据在共享层
 *   `sceneNeedsRender`，headless 的脏位由共享模型的 `scene.dirty` 提供 —— `T-0003` 的 B3）。
 */
const DECLARED_HOST_DIVERGENCE = [
  'audio',
  'getInputType',
  'playBgm',
  'playMovie',
  'playSound',
  'playVoice',
  'preloadImage',
  'present',
  'setFont',
  'setString',
  'sleep',
  'startFrameLoop',
  'stringResourceId',
  'texturesIdle',
  'unhandled',
];

/**
 * **宿主自己的（非桥）方法**：诊断/测试缝/**帧宿主能力**。它们**不该**经 `native.*` 调用，
 * 所以刻意不进 `NativeBridge`；但也不能随手加 —— 加一个就要在这份清单里登记一次（想清楚它该不该入桥）。
 *
 * ★`advanceModel` / `digestState` / `digestHostCounters`（`tickets/T-0003`/`T-0004`）**刻意不入桥**：
 * 它们不是"VM 让宿主做事"，而是**帧宿主**（`src/frame/host.ts`）与宿主之间的契约 —— 调用方是
 * 帧驱动/会话的装配层（`session.ts` 构造 `FrameHost` 字面量），不是 opcode handler。
 * 入桥会把"VM 能调什么"与"驱动能问什么"混成一个面（`needsRender`/`poolPending` 入桥是因为
 * **VM 路径也会读它们**：门判据在会话里、经 `#native` 调用）。两者都由 `FrameHost` 的编译期检查兜住。
 */
const NON_BRIDGE = {
  'pixiBackend.ts': [
    'advanceModel',
    // ★`attachL2dHost`（`tickets/T-0054`）：装配缝 —— 把 `Engine`（L2D 三张表的持有者）交给宿主的
    //   **场景模型**。它不是"VM 让宿主做事"（opcode 一条都不调它），而是 `e.fileSource = src` 那一类
    //   装配步骤；调用方是装配层（`boot.ts`）。入桥会把"装配"混进"VM 能调什么"。
    'attachL2dHost',
    // ★`audioSilent` / `setAudioSilent`（`tickets/T-0106`）：**运行开关 + 诊断缝**，不是"VM 让宿主做事" ——
    //   调用方是装配层（`boot.ts` 在装载 `emulator.config.json` / `AMAYUI_AUDIO_ENABLED` **之后**按
    //   `audio.enabled` 切静音）与诊断/HUD。没有一条 opcode 调它们；入桥会把"这次运行出不出声"
    //   这种**运行开关**混进 VM 的操作数面（而且它是宿主实现细节，headless 侧根本不需要）。
    //   ★清单必须按**字典序**写（守卫拿排序后的集合比对）。
    'audioSilent',
    // ★`captureFrame`（`tickets/T-0134` WS-2 的帧捕获缝）：**帧宿主能力**，与 `advanceModel`/`digestState`
    //   同类 —— 调用方是装配层（`session.ts` 的 `#frameHost()` 把它接成 `FrameHost.capture`），
    //   再由 `shot` 命令/人类看的帧流经 `capturePng(host)` 调用。**没有一条 opcode 调它**；
    //   入桥会把"取像素"混进"VM 能让宿主做什么"，而 headless 侧根本没有像素（它刻意不实现）。
    'captureFrame',
    'debugAudio',
    'debugItemState',
    'digestHostCounters',
    'digestState',
    'drainTextureSizeLog',
    'resolveItemTexture',
    'setAudioSilent', // 同 `audioSilent`（T-0106）；清单按字典序：它在最后
  ],
  'headlessScene.ts': [
    'advance',
    'advanceModel',
    'digestHostCounters',
    'digestState',
    'drainTextureSizeLog',
    'note',
    'outcome',
    'setTextureSizeAnswers',
    'slotTable',
    'snapshot',
    'snapshotText',
  ],
};

test('★桥能力面：宿主桥方法差异必须在"已声明的可选能力"内（T-0013）', () => {
  const bridge = new Set<string>(BRIDGE_METHODS);
  const pixi = protoMethods(PixiBackend.prototype).filter((n) => bridge.has(n));
  const head = protoMethods(HeadlessScene.prototype).filter((n) => bridge.has(n));

  const pixiOnly = pixi.filter((n) => !head.includes(n));
  const headOnly = head.filter((n) => !pixi.includes(n));
  const divergence = [...new Set([...pixiOnly, ...headOnly])].sort();

  assert.deepEqual(
    divergence,
    DECLARED_HOST_DIVERGENCE,
    '宿主能力差异变了：新增能力要么补进 headless，要么更新 DECLARED_HOST_DIVERGENCE 并说明理由',
  );
  assert.deepEqual(headOnly, [], 'headless 不应有"pixi 没有"的桥方法（差异只允许一个方向）');

  // 帧驱动/会话要用的三个能力必须真的在桥的声明面里（否则 `?.` 的缺口连闸门 A 都不记）
  for (const m of ['needsRender', 'poolPending', 'preloadImage']) {
    assert.ok(bridge.has(m), `${m} 必须在 NativeBridge 里声明`);
  }
  // ★"每帧都要问"的两个判据，两个宿主都必须能回答（差异只允许出现在"画/不画"这类能力上）
  for (const m of ['poolPending', 'needsRender']) {
    assert.ok(pixi.includes(m), `pixi 必须实现 ${m}`);
    assert.ok(head.includes(m), `headless 必须实现 ${m}`);
  }
});

test('★桥能力面：宿主的方法要么在桥里，要么在"非桥"清单里登记过（T-0013）', () => {
  const bridge = new Set<string>(BRIDGE_METHODS);
  for (const [file, proto] of [
    ['pixiBackend.ts', PixiBackend.prototype],
    ['headlessScene.ts', HeadlessScene.prototype],
  ] as const) {
    const outside = protoMethods(proto).filter((n) => !bridge.has(n));
    assert.deepEqual(
      outside,
      NON_BRIDGE[file],
      `${file} 的非桥方法集合变了：新方法要么入桥（NativeBridge + BRIDGE_METHODS），要么登记进 NON_BRIDGE`,
    );
  }
});
