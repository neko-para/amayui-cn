/**
 * **`FrameDigest` 契约测试**（`tickets/T-0003` 验收 4 / 设计文档 §4 的 G1、G3 量具）。
 *
 * 本文件锁四件事：
 *  1. **G1 确定性**：同一脚本同一时钟策略跑两次 ⇒ digest 序列**逐字节相等**（否则 G1/G3 都无意义）；
 *  2. **段划分可执行**：同一脚本 + 同一输入下，**宿主能力面不同**（有/无音频帧泵、present 策略不同）
 *     的两个宿主产出**逐帧相同的 `engine` 段**，差异只落在 `host` 段 —— 这正是"对外表现一致"的定义；
 *  3. **负向控制**：故意改一个动画窗的 delay ⇒ digest **恰好从某帧起**变红，且 `diffEngineDigest`
 *     指名是哪一项（`items[0]`）—— 没有这条，"相等"可能只是"什么都没记"；
 *  4. **规范化**：键序变化/浮点尾差不改变哈希（否则挪一个字段就会让全部历史 digest 假红）。
 *
 * ★本文件能证明什么、不能证明什么（诚实边界）：CI 里跑不了 Electron（需要 GPU/窗口，见设计文档 D7），
 * 因此这里比的是**两个 headless 宿主档案**。"Electron 与 headless 逐帧一致"由 **G3**（`npm run replay`：
 * Electron `--record` 落时钟+输入+digest，headless 复现同一序列）在本地闸门证明。
 * 这条边界写在 `docs-new/04-app/emulator-frame-loop-design.md` 的 §4 与 `emulator.md` 的闸门清单里。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/vm/engine.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { runFrameLoop } from '../src/frame/loop.js';
import type { FrameHost } from '../src/frame/host.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { scConfigureDrawItem, scSetDrawColor } from '../src/renderer/sceneModel.js';
import { DigestCollector } from '../src/frame/observer.js';
import { canonicalize, digestFromLine, digestToLine, diffEngineDigest, fnv1a32, hashEngine } from '../src/frame/digest.js';
import { FakeAudioHost } from './fakeAudioHost.js';
import type { BinArg, BinInstruction, ScriptBinary } from '../src/script/bin.js';

const FRAME_MS = 1000 / 60;

const im = (n: number): BinArg => ({ type: 0, raw: n }) as unknown as BinArg;
const instr = (opcode: number, args: BinArg[] = []): BinInstruction =>
  ({ opcode, name: `i${opcode.toString(16)}`, argc: args.length, args, byteOffset: 0, index: 0 }) as unknown as BinInstruction;

/** 造一个装了合成脚本、宿主为 `HeadlessScene` 的引擎。`audioHost` 给了 ⇒ 宿主才**有** `audio` 能力。 */
function mk(ops: BinInstruction[], audioHost?: FakeAudioHost): { e: Engine; scene: HeadlessScene } {
  const scene = new HeadlessScene(audioHost ? { audioHost } : {});
  const e = new Engine(scene);
  const script: ScriptBinary = {
    signature: 'SYS0000',
    isVer5: false,
    headerLen: 0,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [],
    instructions: ops.map((o, i) => ({ ...o, index: i })),
    labelTargets: new Set(),
    raw: new Uint8Array(0),
  };
  loadScriptIntoFrame(e.curScript(), script, 'FAKE.BIN');
  return { e, scene };
}

/** 一帧派发一条 `0x101` 的脚本（`n` 条 ⇒ 天然跑 `n` 帧）。 */
const pollN = (n: number): BinInstruction[] => Array.from({ length: n }, () => instr(0x101));

interface HostProfile {
  /** 是否有音频帧泵（Electron 有；`present:'never'` 的 tracer 没有）。 */
  audio: boolean;
  /** 宿主对 `needsRender()` 的回答（Electron = 脏/动画未完成才画）。 */
  wantRender: boolean;
}

/**
 * 造一个固定步长虚拟时钟的宿主档案。
 * ★两个档案的差别**只在宿主义务**（音频泵 / 是否合成），不在模型推进：`advanceModel` 两边都做，
 * 否则 `engine` 段会因"模型没推进"而天然不同（那就不是在测"能力面差异不漏进 engine"了）。
 */
function mkHost(scene: HeadlessScene, profile: HostProfile): { host: FrameHost; box: { clock: number; draws: number } } {
  const box = { clock: 0, draws: 0 };
  const host: FrameHost = {
    now: () => box.clock,
    advanceModel: (nowMs) => scene.advanceModel(nowMs),
    present: () => {
      box.draws++;
    },
    needsRender: () => profile.wantRender,
    poolPending: () => scene.poolPending(),
    digestState: () => scene.scene,
    digestHostCounters: () => scene.digestHostCounters(),
    ...(profile.audio ? { audio: (intent) => scene.audio?.(intent) } : {}),
  };
  return { host, box };
}

/** 跑同一段脚本 `frames` 帧，返回 digest 序列。 */
async function runOnce(
  ops: BinInstruction[],
  frames: number,
  profile: HostProfile,
  step?: { prep?: (scene: HeadlessScene) => void; atFrame?: { frame: number; fn: (scene: HeadlessScene) => void } },
): Promise<{ digests: DigestCollector; draws: number }> {
  const { e, scene } = mk(ops, profile.audio ? new FakeAudioHost() : undefined);
  step?.prep?.(scene);
  const { host, box } = mkHost(scene, profile);
  const digests = new DigestCollector();
  let ended = 0;
  const r = await runFrameLoop(e, host, {
    gates: { anim: 'ignore', sleep: 'ignore', advance: 'ignore' },
    services: { winReveal: false, charGrid: false },
    advFrame: false,
    maxStepsPerFrame: 1,
    maxFrames: frames,
    audio: profile.audio ? 'host' : 'never',
    present: 'needsRender',
    observer: digests,
    onFrameEnd: () => {
      // ★在**帧末**配置窗（digest 已取过）⇒ 从下一帧起才可见。真实脚本也是跑若干帧后才配动画
      //   （`animStart === 0` 是"未锁存"的哨兵，在 clock === 0 那刻配置会被反复重锁，见 T-0002 的 D1）。
      if (step?.atFrame && ended === step.atFrame.frame) step.atFrame.fn(scene);
      ended++;
      box.clock += FRAME_MS;
    },
  });
  assert.equal(r.frames, frames, '每帧 1 条指令 ⇒ 恰好跑满 frames 帧');
  assert.equal(digests.digests.length, frames, '每个完整帧恰好一份 digest');
  return { digests, draws: box.draws };
}

const PROFILE_A: HostProfile = { audio: true, wantRender: false };
const PROFILE_B: HostProfile = { audio: false, wantRender: true };

test('G1：同一脚本 + 同一时钟策略跑两次 ⇒ digest 序列逐字节相等', async () => {
  const a = await runOnce(pollN(6), 6, PROFILE_A);
  const b = await runOnce(pollN(6), 6, PROFILE_A);
  assert.deepEqual(a.digests.lines(), b.digests.lines(), '两次跑必须逐字节相同（G1）');
  assert.deepEqual(a.digests.hashes(), b.digests.hashes());
});

test('★engine 段跨宿主能力面一致：有无音频泵 / 是否合成，都不改变逐帧 engine 段（差异只在 host 段）', async () => {
  const a = await runOnce(pollN(8), 8, PROFILE_A);
  const b = await runOnce(pollN(8), 8, PROFILE_B);
  assert.deepEqual(
    a.digests.digests.map((d) => d.engine),
    b.digests.digests.map((d) => d.engine),
    'engine 段必须逐帧逐字段相等（G3 比的就是它）',
  );
  assert.deepEqual(a.digests.hashes(), b.digests.hashes(), '短哈希同理');
  // host 段**允许**不同：档案 A 有音频泵且不合成，档案 B 反之。
  const lastA = a.digests.digests.at(-1)!;
  const lastB = b.digests.digests.at(-1)!;
  assert.ok(lastA.host.audioIntents > 0, 'A 有音频泵 ⇒ 有意图计数');
  assert.equal(lastB.host.audioIntents, 0, 'B 没有音频 ⇒ 0');
  assert.equal(a.draws, 0, 'A 的宿主自我判断"不需要重画" ⇒ 一次都没画（模型仍每帧推进）');
  assert.ok(b.draws > 0, 'B 真的画了');
});

test('★负向控制：改一个动画窗的 delay ⇒ digest 恰好从第 5 帧起变红，且 diff 指名 items[0]', async () => {
  const HANDLE = 0x1e000;
  /**
   * 建一个可绘制的项（`flags & 1`）并配一个淡出窗（`0x202` 的窗才会真的配上）。
   * ★在**第 3 帧末**才配置（而不是开跑前）：`animStart === 0` 是"未锁存"的哨兵，虚拟时钟从 0 起 ⇒
   * 在 clock 0 配置的窗会被反复重锁。真实脚本同样跑若干帧后才配动画（`T-0002` 的 D1 记过这一条）。
   */
  const windowAt = (delayMs: number) => (scene: HeadlessScene): void => {
    scConfigureDrawItem(scene.scene, {
      handle: HANDLE,
      layer: 100,
      srcX: 0,
      srcY: 0,
      srcW: 1280,
      srcH: 720,
      dstX: 0,
      dstY: 0,
      tex: 1,
    });
    assert.equal(scSetDrawColor(scene.scene, HANDLE, delayMs, 200, 0x00ffffff), 'applied', '窗必须真的配上（不是建了个空项）');
  };
  const atFrame = { frame: 3 };
  const now = await runOnce(pollN(8), 8, PROFILE_A, { atFrame: { ...atFrame, fn: windowAt(0) } });
  const delayed = await runOnce(pollN(8), 8, PROFILE_A, { atFrame: { ...atFrame, fn: windowAt(2 * FRAME_MS) } });

  const diffs = now.digests.digests.map((d, i) => diffEngineDigest(d, delayed.digests.digests[i]!));
  const firstDiff = diffs.findIndex((d) => d.length > 0);
  // 窗在第 3 帧末配置 ⇒ 第 4 帧才**锁存起点**（那一帧 `t = 0`，两个 delay 都还看不出差别）
  // ⇒ 第 5 帧起 delay 才真的改变求值色。这一帧的滞后就是引擎的 `+0x34` 起点锁存语义（T-0002 的 D1）。
  assert.equal(firstDiff, 5, `窗在第 3 帧末配置 ⇒ 第 5 帧起才可见（实测 ${firstDiff}）`);
  assert.ok(
    diffs[firstDiff]!.some((s) => s.startsWith('items[0]')),
    `diff 必须指名是哪一项：${JSON.stringify(diffs[firstDiff])}`,
  );
  assert.ok(diffs.slice(5).every((d) => d.length > 0), '第 5 帧之后每一帧都不同');
});

test('规范化：键序与浮点尾差不改变哈希（避免"挪字段 ⇒ 全部历史 digest 假红"）', () => {
  assert.equal(canonicalize({ b: 1, a: [{ y: 2, x: 1 }] }), canonicalize({ a: [{ x: 1, y: 2 }], b: 1 }));
  assert.equal(fnv1a32(canonicalize({ v: 1 / 3 })), fnv1a32(canonicalize({ v: 0.3333333333333333 })), '6 位小数内视为相等');
  assert.notEqual(fnv1a32('a'), fnv1a32('b'));
  assert.equal(fnv1a32(''), '811c9dc5', 'FNV-1a 空串偏移基准');
});

test('JSONL 往返：`digestToLine` → `digestFromLine` 保真（`--record`/`--replay` 的落盘格式）', async () => {
  const { digests } = await runOnce(pollN(3), 3, PROFILE_A);
  for (const d of digests.digests) {
    const back = digestFromLine(digestToLine(d));
    assert.deepEqual(back, d, `第 ${d.frame} 帧往返必须完全一致`);
    assert.equal(back.hash, hashEngine(back.engine), '哈希可由 engine 段重算出来（回放侧要能自证）');
  }
  assert.throws(() => digestFromLine('{}'), '坏行必须抛，不许静默跳过');
});
