/** @tier T0 @kind core @subsystem audio */

/**
 * **headless 的音频能力**（`tickets/T-0006`，B3 的一环）：宿主（`NodeAudioHost`）+ 帧泵（驱动每帧 tick）。
 *
 * 为什么要这个文件：修前 `HeadlessScene` **没有** `audio` ⇒ 两份 chain / report 里所有音频意图都进
 * 闸门 A 的"意图被丢弃"清单，于是 headless 看不到"延迟 SE 什么时候响、语音通道什么时候释放、
 * BGM 淡变走到哪"，这些差异**不会报错**、只会让 headless 与 Electron 的表现悄悄分叉。
 *
 * 本文件锁三件事：
 *  1. 时长推断（容器头 → 秒）：headless 没有 Web Audio，但"时长"是 SE 通道释放/语音占线的判据；
 *  2. 宿主行为：`{id}`/`{name}` 两种定位、解码失败、`streamUrl` 不提供（强制走 load+decode+play）；
 *  3. **帧泵**：驱动每帧的 `tick` 真的推进 headless 的音频语义（延迟 SE 到点才响、BGM 淡变按步走），
 *     而"没给宿主"时 `audio` 是**条件能力**（闸门 A 记缺口，而不是静默空实现）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/vm/engine.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { runFrameLoop } from '../src/frame/loop.js';
import type { FrameHost } from '../src/frame/host.js';
import type { BinArg, BinInstruction, ScriptBinary } from '../src/script/bin.js';
import type { AudioByteSource } from '../src/audio/nodeAudioHost.js';
import { NodeAudioHost, audioDurationSec } from '../src/audio/nodeAudioHost.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { DropRecorder, withNativeTap } from '../src/vm/nativeTap.js';
import { FakeAudioHost } from './fakeAudioHost.js';

// ==================== 1. 时长推断（容器头 → 秒） ====================

function u32(buf: Uint8Array, o: number, v: number): void {
  buf[o] = v & 255;
  buf[o + 1] = (v >> 8) & 255;
  buf[o + 2] = (v >> 16) & 255;
  buf[o + 3] = (v >>> 24) & 255;
}
function asciiAt(buf: Uint8Array, o: number, s: string): void {
  for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i);
}
function u64(buf: Uint8Array, o: number, v: number): void {
  u32(buf, o, v % 0x100000000);
  u32(buf, o + 4, Math.floor(v / 0x100000000));
}

/** 合成一个最小 WAV（`fmt ` 16B + `data`）。 */
function wavBytes(byteRate: number, dataSize: number): Uint8Array {
  const b = new Uint8Array(44 + dataSize);
  asciiAt(b, 0, 'RIFF');
  u32(b, 4, 36 + dataSize);
  asciiAt(b, 8, 'WAVE');
  asciiAt(b, 12, 'fmt ');
  u32(b, 16, 16);
  u32(b, 20, 1); // PCM
  u32(b, 22, 1); // 单声道（u16，高位为 0）
  u32(b, 24, 44100); // 采样率
  u32(b, 28, byteRate);
  u32(b, 32, 2); // blockAlign
  u32(b, 34, 16); // bits
  asciiAt(b, 36, 'data');
  u32(b, 40, dataSize);
  return b;
}

/** 合成一个最小两页 OGG（首页带 identification packet，末页带 granule）。 */
function oggBytes(sampleRate: number, granule: number): Uint8Array {
  const page0 = 27 + 1 + 30;
  const page1 = 27 + 1 + 1;
  const b = new Uint8Array(page0 + page1);
  asciiAt(b, 0, 'OggS');
  b[4] = 0; // version
  b[5] = 2; // BOS
  u64(b, 6, 0);
  u32(b, 14, 1); // serial
  u32(b, 18, 0); // page seq
  b[26] = 1; // 1 segment
  b[27] = 30; // 段长 = identification packet 长度
  const payload = 28;
  b[payload] = 1;
  asciiAt(b, payload + 1, 'vorbis');
  u32(b, payload + 7, 0); // vorbis version
  b[payload + 11] = 1; // channels
  u32(b, payload + 12, sampleRate);
  b[payload + 29] = 1; // framing
  // 末页（EOS）
  const p1 = page0;
  asciiAt(b, p1, 'OggS');
  b[p1 + 5] = 4; // EOS
  u64(b, p1 + 6, granule);
  u32(b, p1 + 14, 1);
  u32(b, p1 + 18, 1);
  b[p1 + 26] = 1;
  b[p1 + 27] = 1;
  b[p1 + 28] = 0;
  return b;
}

test('时长推断：WAV 用 data 大小 ÷ byteRate（SE 族，`SE004.WAV` 就是 RIFF）', () => {
  // 44100Hz 16bit 单声道 = 88200 B/s；0.5s ⇒ 44100B
  assert.equal(audioDurationSec(wavBytes(88200, 44100)), 0.5);
  assert.equal(audioDurationSec(wavBytes(88200, 88200)), 1);
});

test('时长推断：OGG 用末页 granule ÷ 采样率（BGM/语音族）', () => {
  assert.equal(audioDurationSec(oggBytes(48000, 144000)), 3);
  assert.equal(audioDurationSec(oggBytes(44100, 44100)), 1);
});

test('时长推断：认不出的容器 ⇒ null（调用方按"解码失败"处理，不猜）', () => {
  assert.equal(audioDurationSec(new Uint8Array([1, 2, 3, 4])), null, '太短');
  assert.equal(audioDurationSec(new Uint8Array(200)), null, '全 0 既不是 RIFF 也不是 OggS');
  const badOgg = oggBytes(48000, 0);
  assert.equal(audioDurationSec(badOgg), null, 'granule 为 0 ⇒ 推不出时长（不返回 0 假装成功）');
});

// ==================== 2. NodeAudioHost（真字节来源 + 不出声） ====================

/** 假字节源：`byId`/`byName` 两张表。 */
function fakeSource(files: { id?: Record<number, Uint8Array>; name?: Record<string, Uint8Array> }): AudioByteSource {
  return {
    readById: async (id) => {
      const d = files.id?.[id];
      return d ? { name: `id${id}`, data: d } : null;
    },
    readByName: async (name) => {
      const d = files.name?.[name];
      return d ? { name, data: d } : null;
    },
  };
}

test('NodeAudioHost：`{id}` 走统一文件 id（SE/语音），`{name}` 走文件名（BGM）', async () => {
  const src = fakeSource({
    id: { 46: wavBytes(88200, 44100) },
    name: { 'BGM031.OGG': oggBytes(44100, 44100 * 2) },
  });
  const host = new NodeAudioHost({ source: src });

  const se = await host.load({ id: 46 });
  assert.ok(se, '按 id 取到字节');
  assert.equal((await host.decode(46, se!))!.durationSec, 0.5);
  assert.deepEqual(host.loads, ['id:46']);

  // BGM 传的是**曲号**时也要能解析（引擎 `bgmFileName` 的等价形式）
  const bgm = await host.load({ name: '031' });
  assert.ok(bgm, '曲号 031 ⇒ BGM031.OGG');
  assert.equal((await host.decode(31, bgm!))!.durationSec, 2);
  assert.deepEqual(host.loads, ['id:46', 'name:BGM031.OGG']);
});

test('NodeAudioHost：取不到字节 / 认不出容器 ⇒ null（走引擎的"装载失败"路，不静默当成功）', async () => {
  const logs: string[] = [];
  const host = new NodeAudioHost({ source: fakeSource({ id: {} }), log: (m) => logs.push(m) });
  assert.equal(await host.load({ id: 999 }), null);
  assert.ok(logs.some((l) => l.includes('取字节失败')), '留痕');

  const host2 = new NodeAudioHost({ source: fakeSource({ id: { 7: new Uint8Array(100) } }) });
  assert.equal(await host2.decode(7, new Uint8Array(100)), null, '认不出容器 ⇒ 解码失败');
});

test('NodeAudioHost：`fallbackDurationSec` 兜底；`streamUrl` 不给（强制 load+decode+play）', async () => {
  const host = new NodeAudioHost({
    source: fakeSource({ id: { 7: new Uint8Array(100) } }),
    fallbackDurationSec: (id) => (id === 7 ? 1.25 : null),
  });
  const clip = await host.decode(7, new Uint8Array(100));
  assert.equal(clip!.durationSec, 1.25, '兜底生效');
  assert.equal(host.streamUrl({ id: 7 }), undefined, '不提供流式 ⇒ 与"一次性解码"的引擎路径同构');

  // play 只记账（headless 无声）
  const pb = host.play(clip!, { gain: 0.5, pan: 0, loop: false });
  assert.equal(host.plays.length, 1);
  pb.setGain(0.25);
  assert.equal(host.plays[0]!.gain, 0.25, '音量变化可断言');
  pb.stop();
  assert.equal(host.plays[0]!.stopped, true);
});

// ==================== 3. 帧泵：驱动每帧 tick ⇒ headless 音频真的推进 ====================

const im = (n: number): BinArg => ({ type: 0, raw: n }) as unknown as BinArg;
const instr = (opcode: number, args: BinArg[] = []): BinInstruction =>
  ({ opcode, name: `i${opcode.toString(16)}`, argc: args.length, args, byteOffset: 0, index: 0 }) as unknown as BinInstruction;
/** `n` 条空转指令（`0x101` poll-input）：让脚本活过若干帧 —— 否则第 1 帧就撞脚本尾，
 *  按驱动语义那一帧**不算完整帧**（不发 tick/不让帧）⇒ 帧泵根本没机会跑。 */
const polls = (n: number): BinInstruction[] => Array.from({ length: n }, () => instr(0x101));

/** 造一个装了合成脚本、native = HeadlessScene 的引擎。 */
function mkScene(ops: BinInstruction[], audioHost: FakeAudioHost): HeadlessScene {
  const scene = new HeadlessScene({ audioHost, onLog: () => {} });
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
  // 引擎实例要能被驱动读到（`mkScene` 只返回 scene，这里用闭包把 e 带出去）
  (scene as unknown as { __e: Engine }).__e = e;
  return scene;
}

test('★帧泵：驱动每帧 tick ⇒ 延迟 SE 到点才响（headless 也能看到"什么时候响"）', async () => {
  const host = new FakeAudioHost({ durationOf: () => 0.5 });
  // 0xB4 = se-load(46, ch1)；0x2BF = se-delay(ch1, loop=0, delay=500ms)；其余帧空转
  const scene = mkScene([instr(0xb4, [im(46), im(1)]), instr(0x2bf, [im(1), im(0), im(500)]), ...polls(200)], host);
  const e = (scene as unknown as { __e: Engine }).__e;
  const box = { clock: 0 };
  const playsPerFrame: number[] = [];
  const fh: FrameHost = {
    now: () => box.clock,
    audio: (intent) => scene.audio?.(intent),
    yield: () => scene.audioEngine!.idle(), // 每帧让异步装载落地（等价渲染进程的帧间空隙）
  };
  const r = await runFrameLoop(e, fh, {
    gates: { anim: 'ignore', sleep: 'ignore', advance: 'ignore' },
    services: { winReveal: false, charGrid: false },
    advFrame: false,
    maxStepsPerFrame: 10,
    maxFrames: 7,
    onFrameEnd: () => {
      playsPerFrame.push(host.plays.length);
      box.clock += 100; // 每帧 100ms
    },
  });

  assert.equal(r.stopReason, 'cap');
  assert.deepEqual(
    playsPerFrame,
    [0, 0, 0, 0, 0, 1, 1],
    '时钟 0..400ms 不响、500ms 那一帧响一次（delay 由**帧泵**推进，而不是靠装载完成顺手播）',
  );
  assert.equal(host.plays[0]!.id, 46, '播的是装载的那个 id');
});

test('★帧泵：BGM 淡变按帧步进（`0xC2` 的目标靠 tick 走到）', async () => {
  const host = new FakeAudioHost({ durationOf: () => 30 });
  const scene = mkScene([instr(0xbf, [im(31)]), instr(0xc2, [im(0), im(50)]), ...polls(200)], host);
  const e = (scene as unknown as { __e: Engine }).__e;
  const box = { clock: 0 };
  const fh: FrameHost = { now: () => box.clock, audio: (i) => scene.audio?.(i), yield: () => scene.audioEngine!.idle() };
  await runFrameLoop(e, fh, {
    gates: { anim: 'ignore', sleep: 'ignore', advance: 'ignore' },
    services: { winReveal: false, charGrid: false },
    advFrame: false,
    maxStepsPerFrame: 10,
    maxFrames: 6,
    onFrameEnd: () => (box.clock += 100),
  });
  const bgm = host.streams.at(-1) ?? host.plays.at(-1);
  assert.ok(bgm, 'BGM 起播了');
  const hist = 'gainHistory' in bgm ? bgm.gainHistory : [];
  assert.ok(hist.length > 2, `淡变被逐帧推进（历史 ${JSON.stringify(hist)}）`);
  assert.equal(
    hist[hist.length - 1],
    0,
    `走到目标 0：${JSON.stringify(hist)}（每帧一步、不是一次到位，也不是原地不动）`,
  );
});

test('★条件能力：没给 audioHost ⇒ `audio` 不存在 ⇒ 闸门 A 记缺口（不是静默空实现）', () => {
  const rec = new DropRecorder(() => 0xb4);
  const bare = withNativeTap(new HeadlessScene({}), rec) as unknown as {
    audio?: (i: { kind: 'se-play'; ch: number; loop: boolean }) => void;
  };
  bare.audio?.({ kind: 'se-play', ch: 1, loop: false });
  assert.deepEqual(rec.list().map((e) => e.method), ['audio'], '缺口可见');

  const rec2 = new DropRecorder();
  const wired = withNativeTap(new HeadlessScene({ audioHost: new FakeAudioHost() }), rec2) as unknown as {
    audio?: (i: { kind: 'se-load'; ch: number; id: number }) => void;
  };
  wired.audio?.({ kind: 'se-load', ch: 1, id: 46 });
  assert.deepEqual(rec2.list(), [], '给了宿主 ⇒ 能力存在，不留"假缺口"');
});

test('★帧泵：ADV 激活位期间寄存的语音，位清除后的**下一次 tick** 冲刷（T-0006 验收 2/3）', async () => {
  const host = new FakeAudioHost({ durationOf: () => 1 });
  const scene = new HeadlessScene({ audioHost: host, onLog: () => {} });

  // 引擎语义：`0xC4` 在 ADV 位（`effect_flags & 0x8000000`）为真时走 `voice-defer`（寄存），
  // 位清除后由 `tick(nowMs, advActive=false)` 统一冲刷（`audioEngine.tick` 的第 1 步）。
  scene.audio?.({ kind: 'tick', nowMs: 0, advActive: true });
  scene.audio?.({ kind: 'voice-defer', ch: 0, id: 354, loop: false });
  scene.audio?.({ kind: 'tick', nowMs: 16, advActive: true });
  await scene.audioEngine!.idle();
  assert.equal(host.plays.length, 0, 'ADV 位还在 ⇒ 只寄存、不出声');

  scene.audio?.({ kind: 'tick', nowMs: 32, advActive: false });
  await scene.audioEngine!.idle();
  assert.equal(host.plays.length, 1, '位清除后的那次 tick 冲刷');
  assert.equal(host.plays[0]!.id, 354, '播的是寄存的语音 id');
});
