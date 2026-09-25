/** @tier T0 @kind core @subsystem audio */

/**
 * **T-0152 音频批 · P2 守卫**（审计 `docs-new/99-records/2026-09-impl-audit/` 的 `module=audio.ts`）。
 *
 * 这一族此前大多**已由 P1 轮修过一半**（`0xbc`/`0xc4`/`0x2c0`/`0x2f7`/`0x2ff`/`0x302`，见
 * `.tmp/p1-fix/dispositions.json`）⇒ 本文件只钉**本轮新处置**的那几条，逐条在测试名里带
 * 对象（opcode / 机制）+ 引擎 raw 锚点。与既有 `test/audio-opcodes.test.ts`（VM→意图）与
 * `test/audio-engine.test.ts`（宿主行为）分工**不重叠**：这里测的是"两半接起来之后，
 * 引擎字段面与宿主行为是否一致"。
 *
 * 覆盖的 P2（14 条里本轮处置的 9 条）：
 *  - `0xb4`/`0xb5` `missing-branch`：设备通道值域 **0..14**（`SE_CHANNELS` = 15，不是 10）；
 *  - `0xb8` `missing-behavior`：停 BGM **不动** `#bgm.mode`/`#enabled.bgm`（停 → 重播习语）；
 *  - `0xbf` `missing-behavior`：**推翻** —— 状态位翻转属 `0xC4`/`0x1BD`（P1 已修），0xBF 体里没有；
 *  - `0xc2` `approximation`（`audioEngine.ts` 侧）：op2 是**节流毫秒**、不是每帧步长；
 *  - `0xc2` `missing-branch` + `missing-behavior`：`set:TransferMusicVolume` 的 1/2 两支 + ADV 分叉；
 *  - `0x1ba` `missing-consumer`：四段体收尾 `sub_406DF0` 的**外层门**（`set:DependMovieSound`）；
 *  - `0x2f6` `missing-operand-io`（两条）：四格清零 + `Engine[122501]` 刷新；
 *  - `0x2f7` `missing-operand-io`：`Engine[21315+ch] = 1` 落引擎字段（P1 已修，本轮补往返守卫）；
 *  - `0x2f8` `missing-operand-io`：pan 的**设备格** `设备[375+ch]`；
 *  - `0x2ff` `missing-operand-io`：原值直写（不钳位）。
 *
 * 未建模项一律**显式登记**（见 `tickets/T-0152/changes-audio.md`），不用"测试里不提"掩盖。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, Frame, ADV_ACTIVE } from '../src/vm/engine.js';
import { makeCtx } from '../src/vm/step.js';
import { NATIVE_OPS } from '../src/vm/ops.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { parseIni } from '../src/engineConfig.js';
import { AudioEngine, SE_CHANNELS, SE_ENABLE_RELEASE_CHANNELS } from '../src/audio/audioEngine.js';
import { FakeAudioHost } from './fakeAudioHost.js';
import { im, instr, RecordingAudioNative } from './harness.js';
import type { BinArg, BinInstruction } from '../src/script/bin.js';
import type { AudioIntent } from '../src/audio/audioEngine.js';

const INI = `[sound]
Music=1
SE=1
Voice=1
[set]
DependMovieSound=2
TransferMusicVolume=0
`;

interface Rig {
  e: Engine;
  native: RecordingAudioNative;
  step: (op: number, args?: BinArg[]) => void;
  logs: string[];
}

/** 造一个装了配置的引擎 + 录制型宿主（`instr`/`im` 来自 `test/harness.ts`）。 */
function rig(ini = INI): Rig {
  const native = new RecordingAudioNative();
  const e = new Engine(native);
  e.config = parseIni(ini);
  const f = new Frame();
  const logs: string[] = [];
  const step = (op: number, args: BinArg[] = []): void => {
    const ins = instr(op, args) as unknown as BinInstruction;
    const h = NATIVE_OPS.get(op);
    assert.ok(h, `0x${op.toString(16)} 应在 NATIVE_OPS（音频族真实现）里`);
    h!(makeCtx(e, f, ins, native, (m) => logs.push(m)));
  };
  return { e, native, step, logs };
}

/** 造一个引擎 + **显式日志函数**的宿主（`FakeAudioHost.log` 是原型方法 ⇒ 不能当回调解引用）。 */
function mkEng(): { host: FakeAudioHost; eng: AudioEngine; logs: string[] } {
  const logs: string[] = [];
  const host = new FakeAudioHost({ onLog: (m) => logs.push(m) });
  return { host, eng: new AudioEngine(host, { log: (m) => logs.push(m) }), logs };
}

/** 只取 `bgm-transfer-volume` 意图（它夹在 `bgm-play`/`bgm-fade` 之间 ⇒ 不能用 `last`）。 */
function transfers(native: RecordingAudioNative): AudioIntent[] {
  return native.intents.filter((i) => i.kind === 'bgm-transfer-volume');
}

// ===========================================================================
// 0xB4 / 0xB5：设备通道值域 0..14（引擎 15 条通道，不是 10 条）
// ===========================================================================

test('★P2 0xb4/0xb5：设备通道值域是 0..14（raw 138599 `a2 > 0xE`）—— 12/14 载荷必须真的起播', async () => {
  // 引擎：`sub_4B6020` 的值域门 `if ( a2 > 0xE )` 才是 `dsPlaySound`（raw 138599-138604）；
  // 15 这条边界另有实证：`sub_4B60C0` 的 `a2 >= 15`（raw 138630）、`sub_4B69B0` 删 15 个
  // critical section（raw 139101-139108）⇒ **设备通道表长度 = 15**。修前宿主只建 10 格
  // （`SE_CHANNELS = 10`）⇒ 10..14 被 `#seChannel` 判越界**静默丢音**。
  assert.equal(SE_CHANNELS, 15, 'SE 通道表长度 = 设备通道表长度 15（修前 10）');
  assert.equal(SE_ENABLE_RELEASE_CHANNELS, 10, '但「关 SE」的释放循环上界仍是 10（raw 13561-13568）');

  const { host, eng, logs } = mkEng();

  // 通道 14（设备 12..14 是语音的通道，值域内 ⇒ 引擎会照 `sub_4B73E0` 起播）
  eng.seLoad(46, 14);
  await eng.idle();
  eng.sePlay(14, false);
  assert.equal(host.plays.length, 1, '★通道 14 必须真的起播（修前静默丢弃）');
  assert.equal(host.plays[0]!.id, 46);
  assert.ok(!logs.some((l) => l.includes('SE 通道越界 14')), `通道 14 不得判越界：${logs.join(' | ')}`);

  // 通道 10/11（备用直通格）：值域内 ⇒ 同样不判越界
  eng.seLoad(50, 10);
  await eng.idle();
  eng.sePlay(10, false);
  assert.equal(host.plays.length, 2, '通道 10 在值域内 ⇒ 起播');
  assert.ok(!logs.some((l) => l.includes('SE 通道越界 10')));

  // 边界外（15 / 负数）仍是越界：只记日志、不抛
  eng.sePlay(15, false);
  eng.sePlay(-1, false);
  assert.equal(host.plays.length, 2, '15 / -1 不起播');
  assert.ok(logs.some((l) => l.includes('SE 通道越界 15')), `15 应记越界：${logs.join(' | ')}`);
  assert.ok(logs.some((l) => l.includes('SE 通道越界 -1')), `-1 应记越界：${logs.join(' | ')}`);
});

test('★P2 0xb4/0xb5：0xBB 关 SE 只停 0..9（不得连带停掉 12..14 那三个语音设备通道）', async () => {
  // 引擎 `sub_408D90` 关 SE 的循环上界 = 10（raw 13561-13568）⇒ 12..14 不归它管。
  const { host, eng } = mkEng();
  eng.seLoad(46, 14);
  await eng.idle();
  eng.sePlay(14, true);
  assert.equal(host.active.length, 1, '通道 14 在播');
  eng.setEnabled('se', false); // i0bb 0
  assert.equal(host.active.length, 1, '★关 SE 不释放 10..14（引擎只逐个释放 0..9）');
});

// ===========================================================================
// 0xB8：停 BGM 不动模式/开关
// ===========================================================================

test('★P2 0xb8：停 BGM **不动** `#bgm.mode`/`#enabled.bgm`（raw 24817-24829 体里没有这些写）', async () => {
  // 引擎 `sub_419720`：`帧状态槽 = 1` + 清 `effect_flags` bit0x200 + `sub_489B50(停)`，
  // **不碰**任何 BGM 模式/开关字段。若宿主在停的时候把 `#bgm.mode` 清 0，
  // 后续 `0xB7`/`0xBF` 会被 `bgmPlay` 的 `mode === 0` 门**静默**挡掉（只有宿主日志）⇒
  // 语料 77 处 `i0b8`（40 个文件，`i0b8 → i0b7 0 → i0c3 → i0c2` 换曲习语）整段静音。
  const { host, eng } = mkEng();
  eng.bgmPlay(18, true, { id: 18 }); // 曲号 18（`res` 直给 ⇒ 不依赖资源树）
  await eng.idle();
  assert.equal(host.plays.length, 1, '先真的起播一首');
  assert.equal(eng.debug().bgm!.mode, 1, '缺省 mode = 1（开）');

  eng.bgmStop(); // i0b8
  assert.equal(eng.debug().bgm!.mode, 1, '★停 BGM 后 mode 必须原样保留（不动开关字段）');
  assert.equal(eng.debug().enabled.bgm, true, '★enabled.bgm 同样保留');

  // 停 → 重播习语：`i0b8`（停）后 `i0b7 0`（重播当前曲）在宿主侧必须真的再次起播
  eng.bgmPlay(18, true, { id: 18 }); // i0b7 0（VM 侧把 op1=0 解成"当前曲 id"）
  await eng.idle();
  assert.equal(host.plays.length, 2, '★停完还能重播（mode 没被停动作清掉）');
  assert.equal(host.plays.at(-1)!.opts.loop, true);
});

// ===========================================================================
// 0xC2：op2 是节流毫秒 / TransferMusicVolume / ADV 分叉
// ===========================================================================

test('★P2 0xc2：`bgm-fade` 的 step = `op2<1000?10:1`、throttleMs = `op2<1000?op2/10:op2/1000`', () => {
  // 引擎 raw 29831-29839：`v4 = op2<1000 ? op2/10 : op2/1000` 交 `sub_453A60` 当节流，
  // `v9 = op2<1000 ? 10 : 1` 是 `sub_489D10` 的进度增量 ⇒ **op2 不是每帧步长**。
  const { native, step } = rig();
  step(0xbf, [im(18)]);
  step(0xc2, [im(10000), im(500)]); // i0c2 2710 1f4（语料实测 3 处）
  assert.deepEqual(native.last, { kind: 'bgm-fade', value: 10000, step: 10, throttleMs: 50 });
  step(0xc2, [im(10000), im(2500)]); // i0c2 2710 9c4（语料实测 242 处）
  assert.deepEqual(native.last, { kind: 'bgm-fade', value: 10000, step: 1, throttleMs: 2 });
  step(0xc2, [im(0), im(0)]); // op2 = 0（语料 2 处）⇒ 增量 10、无节流
  assert.deepEqual(native.last, { kind: 'bgm-fade', value: 0, step: 10, throttleMs: 0 });
});

test('★P2 0xc2：节流真的排程 —— op2 = 500 与 2000 的每次 CALL 增量不同（引擎那两档）', async () => {
  // 引擎：`sub_489E50(Music, 100)` 每次把 `Music[262]` **+100**（raw 106328），但**只有**
  // `sub_453A60` 那格到期才 CALL 一次（raw 29836 写入节流、`sub_489D10` raw 106287 判 `a3 <= t`）。
  //   op2 = 500  ⇒ 增量 10、节流 50ms  ⇒ 10 次 CALL / 500ms 走完 0→100
  //   op2 = 2000 ⇒ 增量 1、 节流 2ms   ⇒ 100 次 CALL / 200ms 走完
  // 修前把 op2 当"每帧进度"（progress += op2）⇒ 两档都 1 帧走完、时长差消失。
  // ★断言口径：`debug().bgm.gain` 是**目标增益**（`#bgmGain()`，与淡变进度无关），
  //   淡变要看播放句柄的 `gainHistory`（每次 CALL 一次 `setGain`）。
  const hostA = new FakeAudioHost({ onLog: () => {} });
  const fast = new AudioEngine(hostA, { log: () => {} });
  fast.bgmPlay(18, true, { id: 18 });
  await fast.idle();
  fast.bgmFadeTo(0, 10, 50); // op2 = 500 ⇒ 增量 10 / 节流 50ms
  for (const t of [1000, 1040, 1050, 1100, 1150, 1200]) fast.tick(t, false);
  const histA = hostA.plays[0]!.gainHistory;
  assert.deepEqual(histA, [1, 0.9, 0.8, 0.7, 0.6, 0.5], '★首值 1 + 1000/1050/1100/1150/1200 各一次 CALL（1040 那次不到期）');
  assert.ok(Math.abs(histA[1]! - 0.9) < 1e-9, `第 1 次 CALL 降 10%（增量 10/100）：${histA[1]}`);
  assert.ok(Math.abs(histA[5]! - 0.5) < 1e-9, `第 5 次 CALL 后 = 1 − 5×0.1：${histA[5]}`);

  const hostB = new FakeAudioHost({ onLog: () => {} });
  const slow = new AudioEngine(hostB, { log: () => {} });
  slow.bgmPlay(18, true, { id: 18 });
  await slow.idle();
  slow.bgmFadeTo(0, 1, 2); // op2 = 2000 ⇒ 增量 1 / 节流 2ms
  for (const t of [2000, 2002, 2004, 2006]) slow.tick(t, false);
  const histB = hostB.plays[0]!.gainHistory;
  assert.deepEqual(histB, [1, 0.99, 0.98, 0.97, 0.96], '★首值 1 + 2000/2002/2004/2006 各一次 CALL');
  assert.ok(Math.abs(histB[1]! - 0.99) < 1e-9, `第 1 次 CALL 降 1%（增量 1/100）：${histB[1]}`);
  assert.ok(Math.abs(histB[4]! - 0.96) < 1e-9, `第 4 次 CALL 后 = 1 − 4×0.01：${histB[4]}`);
});

test('★P2 0xc2：`set:TransferMusicVolume` 的 2 = 跳到目标、1 = 按进度插值（raw 24041-24053）', () => {
  // 引擎：`0xC2` 在 bit0x200 已置时读配置并调 `sub_418580(Music, v)`（raw 29826-29830）；
  // `v == 1` ⇒ 按 `Music[262]` 进度插值；`v == 2` ⇒ 直接跳到目标；其余 ⇒ 无动作。
  const { e, native, step } = rig();
  step(0xbf, [im(18)]); // 先起播
  step(0xc2, [im(10000), im(500)]); // 第一次：bit0x200 本来没置 ⇒ **不**发 transfer
  assert.ok(
    !native.intents.some((i) => i.kind === 'bgm-transfer-volume'),
    'bit0x200 未置时不得发 transfer（引擎那个 if 不成立）',
  );
  assert.equal(e.effectFlags & 0x200, 0x200, '本次已把 bit0x200 置上');

  // ★transfer 在 fade **之前**发（引擎 raw 29826-29831：先 sub_418580，再置 bit0x200、再 sub_489D10）
  step(0xc2, [im(10000), im(500)]); // 第二次：bit0x200 已置 ⇒ 发 transfer（配置缺省 0）
  assert.deepEqual(transfers(native), [{ kind: 'bgm-transfer-volume', mode: 0 }]);
  assert.equal(e.effectFlags & 0x200, 0x200, 'bit0x200 保持置位');

  // 配置置 2 ⇒ 跳到目标
  e.config!.values.set('set:transfermusicvolume', 2);
  step(0xc2, [im(10000), im(500)]);
  assert.deepEqual(transfers(native).at(-1), { kind: 'bgm-transfer-volume', mode: 2 });

  // 配置置 1 ⇒ 按进度插值（引擎那支不改淡变起点）
  e.config!.values.set('set:transfermusicvolume', 1);
  step(0xc2, [im(10000), im(500)]);
  assert.deepEqual(transfers(native).at(-1), { kind: 'bgm-transfer-volume', mode: 1 });
});

test('★P3 0xc2：ADV 激活位在场时**不走**主路（不清/不置 bit0x200、不清曲 id、不起播）', () => {
  // 引擎 raw 29815-29823：`effect_flags & 0x8000000` ⇒ 只 `sub_489D10(Music, op1, op2)` +
  // `sub_489E50(Music, 100)`，**没有** bit0x200 那一段、也不碰 `Music[259]`。
  const { e, native, step } = rig();
  step(0xbf, [im(18)]);
  const beforeId = e.engineValues.get(ENGINE_FIELD.musicField);
  e.effectFlags &= ~0x200; // 归零，便于看 ADV 路有没有偷偷置它
  e.effectFlags |= ADV_ACTIVE;
  const intentsBefore = native.intents.length;
  step(0xc2, [im(0), im(500)]); // 主路此时会"清当前曲 id + 起播"
  const after = native.intents.slice(intentsBefore);
  assert.equal(after.length, 1, `ADV 路只出 1 条意图：${JSON.stringify(after)}`);
  assert.equal(after[0]!.kind, 'bgm-fade');
  assert.equal(e.engineValues.get(ENGINE_FIELD.musicField), beforeId, '★ADV 路不清当前曲 id');
  assert.equal(e.effectFlags & 0x200, 0, '★ADV 路不置 bit0x200');
});

// ===========================================================================
// 0x1BA：四段体收尾 sub_406DF0 的外层门
// ===========================================================================

test('★P2 0x1ba：四段体收尾调 `sub_406DF0` —— 外层门（`set:DependMovieSound` + movie 位）满足才下发', () => {
  // 引擎 raw 12041-12110：`v4 = a3 != 0`；`if ((effect_flags & 0x2000) && _this[94671] &&
  // GetConfig(set:DependMovieSound) == a2)` ⇒ 才写影片对象的 +1144 并 sub_4879E0。
  // fixture 是 `DependMovieSound=2` ⇒ 只有**类别 2（SE）**那一条能过门。
  const { e, native, step, logs } = rig();
  const gate = (): AudioIntent[] => native.intents.filter((i) => i.kind === 'movie-dependent-audio');

  // ① movie 位没置 ⇒ 门不满足（引擎第一个条件就不成立），一条意图都不该有
  step(0x1ba, [im(2), im(0)]); // 关 SE（fixture 是 SE=1 ⇒ 会真的写）
  assert.deepEqual(gate(), [], 'movie 位未置 ⇒ sub_406DF0 的外层门不满足');
  assert.ok(logs.some((l) => l.includes('sub_406DF0 收尾')), `收尾必须有诊断：${logs.join(' | ')}`);

  // ② 置 movie 位（`effect_flags & 0x2000`）+ 类别 = 配置里的 2 ⇒ 门满足
  e.effectFlags |= 0x2000;
  e.config!.values.set('sound:se', 1); // 复位成"开"，好让这次切换真的写
  step(0x1ba, [im(2), im(0)]);
  assert.deepEqual(gate(), [{ kind: 'movie-dependent-audio', category: 2, on: 0 }], '★门满足 ⇒ 下发');

  // ③ 同一形态走类别 1（音乐）⇒ 配置是 2，门不满足（引擎的 `== a2` 不成立）
  const n = gate().length;
  step(0x1ba, [im(1), im(0)]); // 关音乐
  assert.equal(gate().length, n, '类别 1 与配置 2 不等 ⇒ 不发');

  // ④ `on` 是**归一成 0/1**（raw 12052 `v4 = a3 != 0`）：传 7 与传 1 同效
  //    （`switchVoiceEnable` 有幂等门：与现状相同就早退 ⇒ 先把 sound:Voice 置 0 造出变化）
  e.config!.values.set('set:dependmoviesound', 3);
  e.config!.values.set('sound:voice', 0);
  step(0x1ba, [im(3), im(7)]); // 开语音，值 7
  assert.deepEqual(gate().at(-1), { kind: 'movie-dependent-audio', category: 3, on: 1 }, '★值 7 归一成 1');

  // ⑤ 值 0 ⇒ `v4 = 0`（关方向）
  e.config!.values.set('sound:voice', 1);
  step(0x1ba, [im(3), im(0)]);
  assert.deepEqual(gate().at(-1), { kind: 'movie-dependent-audio', category: 3, on: 0 }, '★关方向值 = 0');
});

// ===========================================================================
// 0x2F6 / 0x2F7 / 0x2F8 / 0x2FF：引擎字段面
// ===========================================================================

test('★P2 0x2f6：清四格 + 刷 `Engine[122501]` = 三路语音是否还有正忙（raw 33685-33692）', () => {
  const { e, native, step } = rig();
  const S = ENGINE_FIELD.voiceChannelStateBase;
  const F = ENGINE_FIELD.voiceChannelFactorBase;
  const R = ENGINE_FIELD.voiceRegBase;
  const RF = ENGINE_FIELD.voiceRegFlagBase;

  // 先把 ch=1 的四格都写脏（0x2F7 写状态位、0x2FF 写因子位+值、ADV 路写寄存槽）
  step(0x2f7, [im(1)]);
  step(0x2ff, [im(1), im(5000)]);
  e.engineValues.set(R + 1, 640);
  e.engineValues.set(RF + 1, 1);
  assert.equal(e.engineValues.get(S + 1), 1);
  assert.equal(e.engineValues.get(F + 1), 1);

  step(0x2f6, [im(1)]);
  assert.deepEqual(native.last, { kind: 'voice-reset', ch: 1 });
  assert.equal(e.engineValues.get(S + 1), 0, 'Engine[21315+ch] = 0（raw 33685）');
  assert.equal(e.engineValues.get(F + 1), 0, 'Engine[21318+ch] = 0（raw 33686）');
  assert.equal(e.engineValues.get(R + 1), 0, 'Engine[122505+ch] = 0（raw 33687）');
  assert.equal(e.engineValues.get(RF + 1), 0, 'Engine[122508+ch] = 0（raw 33688）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.voiceRegSingle), 0, '★三路都清了 ⇒ 122501 = 0（raw 33691-33692）');

  // 还有一路武装着 ⇒ 122501 = 1（`sub_404CB0` 的"三路里是否有正忙的"）
  step(0x2f7, [im(2)]);
  step(0x2f6, [im(0)]);
  assert.equal(e.engineValues.get(ENGINE_FIELD.voiceRegSingle), 1, '★ch=2 仍武装 ⇒ 122501 = 1');
  step(0x2f6, [im(2)]);
  assert.equal(e.engineValues.get(ENGINE_FIELD.voiceRegSingle), 0, '全清 ⇒ 回 0');
});

test('★P3 0x2f6：ch 越界（3..14）时**字段照写**（引擎无门直接下标，不静默丢弃）', () => {
  // 引擎 `sub_426820` 对 ch 没有值域门（`_this[v2 + 21315]`）⇒ 字段照写。
  // 本工程只建模 0..2 的宿主通道对象，但**字段面**必须与引擎同形（否则 engineValues 不可复核）。
  const { e, step } = rig();
  step(0x2f7, [im(5)]);
  assert.equal(e.engineValues.get(ENGINE_FIELD.voiceChannelStateBase + 5), 1, '0x2F7 对 ch=5 照写字段');
  step(0x2f6, [im(5)]);
  assert.equal(e.engineValues.get(ENGINE_FIELD.voiceChannelStateBase + 5), 0, '0x2F6 对 ch=5 照清字段');
});

test('★P2 0x2f7：置位 → 翻转协议 → 0x2F6 清位的往返（Engine[21315+ch] 的 0/1/0x10000 三态）', () => {
  // 0x2F7（raw 33694-33704）= `Engine[21315+ch] = 1`；0xC4/0x1BD（raw 29872-29889）二态翻转；
  // 0x2F6（raw 33685）清 0 —— 三态在同一格上串起来（P1 修了一半，本轮补往返守卫）。
  const { e, native, step } = rig();
  const S = ENGINE_FIELD.voiceChannelStateBase;
  step(0x2f7, [im(0)]);
  assert.equal(e.engineValues.get(S), 1, '0x2F7 置 1');
  assert.deepEqual(native.last, { kind: 'voice-flag', ch: 0 });
  step(0xc4, [im(162)]);
  assert.equal(e.engineValues.get(S), 0x10001, '★已武装 ⇒ |0x10000（raw 29877-29880）');
  step(0xc4, [im(163)]);
  assert.equal(e.engineValues.get(S), 0, '★0x10000 已置 ⇒ 整个清 0（raw 29873-29876）');
  step(0x2f7, [im(0)]);
  step(0x2f6, [im(0)]);
  assert.equal(e.engineValues.get(S), 0, '0x2F6 清 0（往返闭合）');
});

test('★P2 0x2f8：pan 的**设备格** `设备[375+ch]`（钳制后的值）落进引擎字段面', () => {
  const { e, native, step } = rig();
  step(0x2f8, [im(2), im(-5000)]);
  assert.deepEqual(native.last, { kind: 'voice-pan', ch: 2, pan: -5000 });
  assert.equal(e.engineValues.get(ENGINE_FIELD.voicePanBase + 2), -5000, 'Engine 字段面记下钳制后的 pan');
  step(0x2f8, [im(0), im(999999)]); // 越界 ⇒ 对称钳到 +10000
  assert.equal(e.engineValues.get(ENGINE_FIELD.voicePanBase), 10000, '★对称钳制（引擎 sub_4B6940 的两半）');
  step(0x2f8, [im(1), im(-999999)]);
  assert.equal(e.engineValues.get(ENGINE_FIELD.voicePanBase + 1), -10000);
});

test('★P2 0x2ff：`Engine[21321+ch]` 是**原值直写**（不 clampVolume；同格可被 0x302 写成 0x10000）', () => {
  const { e, native, step } = rig();
  const V = ENGINE_FIELD.voiceChannelFactorValueBase;
  const F = ENGINE_FIELD.voiceChannelFactorBase;
  step(0x2ff, [im(0), im(20000)]); // 超出 0..10000
  assert.deepEqual(native.last, { kind: 'voice-factor-prepare', ch: 0, value: 20000 });
  assert.equal(e.engineValues.get(V), 20000, '★原值直写（修前若钳位会得 10000）');
  assert.equal(e.engineValues.get(F), 1, '「有因子值」位 = 1（raw 33728-33740 的第一条写）');
  step(0x2ff, [im(1), im(-3)]);
  assert.equal(e.engineValues.get(V + 1), -3, '负值同样原值（该格不是 0..10000 域）');
  // 同格在 0x302 被写成 0x10000 —— 这正是"它不是 0..10000 域"的实证
  step(0x302, [im(0), im(5000)]);
  assert.equal(e.engineValues.get(F), 0x10000, '0x302 写 0x10000（远超 10000 ⇒ 证明该域无界）');
  assert.equal(e.engineValues.get(V), 5000, '0x302 的 op2 同样原值');
});

// ===========================================================================
// 0xBF：**推翻**审计的那一条（状态位翻转属 0xC4/0x1BD）
// ===========================================================================

test('★P2 0xbf：体里**没有**语音状态位翻转（推翻审计）—— 0xBF 一个 Engine 槽都不写', () => {
  // 审计把「`Engine[21315]/[21318]` 的 0x10000 翻转」记在 0xBF 名下，读体（`sub_420CC0`
  // raw 29753-29780）后**推翻**：0xBF 只做 bit0x200 清理 + `sub_489C20` 起播 + 两个配置门；
  // 翻转在 `sub_420F70`（0xC4，raw 29872-29889）与 `sub_4212C0`（0x1BD，raw 30031-30043）。
  const { e, native, step } = rig();
  const S = ENGINE_FIELD.voiceChannelStateBase;
  const F = ENGINE_FIELD.voiceChannelFactorBase;
  step(0x2f7, [im(0)]);
  step(0x2ff, [im(0), im(5000)]); // 两格都武装（= 1）
  const sBefore = e.engineValues.get(S);
  const fBefore = e.engineValues.get(F);
  const n = native.intents.length;
  step(0xbf, [im(18)]); // play-bgm
  assert.equal(e.engineValues.get(S), sBefore, '★0xBF 不动 21315（翻转在 0xC4/0x1BD）');
  assert.equal(e.engineValues.get(F), fBefore, '★0xBF 不动 21318');
  assert.equal(e.engineValues.get(ENGINE_FIELD.musicField), 18, '但曲 id 照写（sub_489C20）');
  assert.ok(
    native.intents.slice(n).some((i) => i.kind === 'bgm-play'),
    `0xBF 仍要起播：${JSON.stringify(native.intents.slice(n))}`,
  );
});

// ===========================================================================
// 0xC4 的 `122501`（P1 已修，这里补"设计意图"那条往返）
// ===========================================================================

test('★P2 0xc4：`if (Engine[21293]) Engine[122501] = 1`（raw 29910-29911）与 0x2F6 的刷新配对', () => {
  const { e, step } = rig();
  // ★幂等门：`sub_408E20` 的判据是 `(a2 != 0) == 现值` ⇒ "本来就开着"时**不写** 21293
  //   （fixture 的 Voice=1 是"已开"，所以要先关一次再开，才能真的落 21293）。
  step(0x1ba, [im(3), im(0)]);
  assert.equal(e.engineValues.get(ENGINE_FIELD.voiceEnabledField), 0, '关语音 ⇒ 21293 = 0');
  step(0x1ba, [im(3), im(1)]);
  assert.equal(e.engineValues.get(ENGINE_FIELD.voiceEnabledField), 1, '开语音 ⇒ 21293 = 1（raw 13573-13599）');
  e.engineValues.set(ENGINE_FIELD.voiceRegSingle, 0);
  step(0xc4, [im(162)]);
  assert.equal(e.engineValues.get(ENGINE_FIELD.voiceRegSingle), 1, '★语音开 ⇒ 播语音把记号置 1');
  step(0x2f6, [im(0)]);
  assert.equal(e.engineValues.get(ENGINE_FIELD.voiceRegSingle), 0, '0x2F6 按"三路是否还有正忙"刷回 0');
});

// ===========================================================================
// P3 批次（本轮同批处置）
// ===========================================================================

test('★P3 0x2f4：按 op3 做两个槽的翻转 + ADV 寄存/清寄存（raw 33620-33648）', () => {
  const { e, native, step } = rig();
  const S = ENGINE_FIELD.voiceChannelStateBase;
  const F = ENGINE_FIELD.voiceChannelFactorBase;
  const R = ENGINE_FIELD.voiceRegBase;
  const RF = ENGINE_FIELD.voiceRegFlagBase;

  // ① 非 ADV：先武装两格（0x2F7/0x2FF）⇒ 0x2F4 各翻一次（1 → 0x10001），并**清寄存槽**
  step(0x2f7, [im(2)]);
  step(0x2ff, [im(2), im(5000)]);
  e.engineValues.set(R + 2, 999);
  e.engineValues.set(RF + 2, 7);
  step(0x2f4, [im(700), im(0), im(2)]);
  assert.equal(e.engineValues.get(S + 2), 0x10001, '★op3=2 的那一格被翻转（不是固定通道 0）');
  assert.equal(e.engineValues.get(F + 2), 0x10001, '因子槽同样翻转');
  assert.equal(e.engineValues.get(R + 2), 0, '★非 ADV ⇒ 寄存槽清 0（raw 33646-33647）');
  assert.equal(e.engineValues.get(RF + 2), 0, '★非 ADV ⇒ 标志槽清 0');
  assert.deepEqual(native.last, { kind: 'voice-play', ch: 2, id: 700, loop: false });

  // ② ADV 激活位在场：改走寄存（不立即起播）
  e.effectFlags |= ADV_ACTIVE;
  step(0x2f4, [im(701), im(3), im(1)]);
  assert.equal(e.engineValues.get(R + 1), 701, '★ADV ⇒ 寄存 id 到 [122505+ch]（raw 33641）');
  assert.equal(e.engineValues.get(RF + 1), 3, '★ADV ⇒ 寄存 op2 **原值** 到 [122508+ch]（raw 33642）');
  const after = native.intents.at(-1);
  assert.equal(after!.kind, 'voice-defer', 'ADV 位在 ⇒ 意愿是寄存而不是立即起播');
});

test('★P3 0x2f4：循环位取 op2 的**低 1 位**（`& 1`），不是 `!= 0`（raw 33648 → 142663）', () => {
  const { native, step } = rig();
  step(0x2f4, [im(700), im(2), im(0)]); // op2 = 2 ⇒ `2 & 1 = 0` ⇒ **不循环**
  assert.equal((native.last as { loop: boolean }).loop, false, '★op2 = 2 ⇒ 不循环（修前 `!= 0` 会判成循环）');
  step(0x2f4, [im(700), im(3), im(0)]); // op2 = 3 ⇒ `3 & 1 = 1` ⇒ 循环
  assert.equal((native.last as { loop: boolean }).loop, true);
  step(0x2f4, [im(700), im(-1), im(0)]); // op2 = -1 ⇒ `-1 & 1 = 1` ⇒ 循环
  assert.equal((native.last as { loop: boolean }).loop, true);
});

test('★P3 0x2f6 overreach：引擎对 ch 无值域门 ⇒ 字段照写（本工程只建模 0..2 的宿主通道）', () => {
  // 引擎 `sub_426820`（raw 33682-33690）：`_this[v2 + 21315]` 无门 ⇒ ch = 7 也照写/照清。
  // 本工程只建 3 个宿主通道对象，但**字段面**必须与引擎同形（否则 engineValues 不可复核）。
  const { e, step } = rig();
  step(0x2f7, [im(7)]);
  assert.equal(e.engineValues.get(ENGINE_FIELD.voiceChannelStateBase + 7), 1, '0x2F7 对 ch=7 照写');
  step(0x2f6, [im(7)]);
  assert.equal(e.engineValues.get(ENGINE_FIELD.voiceChannelStateBase + 7), 0, '0x2F6 对 ch=7 照清');
});

test('★P3 0x2bf：SE 通道越界要打出引擎的错误串（raw 137725 门 / 137736-137737 报错）', () => {
  const { native, step, logs } = rig();
  step(0x2bf, [im(10), im(0), im(100)]); // 引擎门是 `a2 < 10` ⇒ 10 越界
  assert.equal(native.intents.filter((i) => i.kind === 'se-delay').length, 0, '越界不发 se-delay');
  assert.ok(
    logs.some((l) => l.includes('SetDelay') && l.includes('不正なSound番号')),
    `越界必须留痕（引擎串常量 raw 5197）：${logs.join(' | ')}`,
  );
  step(0x2bf, [im(9), im(0), im(100)]);
  assert.deepEqual(native.last, { kind: 'se-delay', ch: 9, loop: false, delayMs: 100 });
});

test('★P3 0x302：宿主**不**清"预备值"（引擎只写 [21321+ch]，raw 33767-33777）', async () => {
  const host = new FakeAudioHost({ onLog: () => {} });
  const eng = new AudioEngine(host, { log: () => {} });
  eng.voiceFactorPrepare(0, 5000); // i2ff
  assert.equal(eng.debug().voice[0]!.prepared, 5000);
  eng.voiceFactorApply(0, 8000); // i302
  assert.equal(eng.debug().voice[0]!.factor, 8000, '生效值 = op2');
  assert.equal(eng.debug().voice[0]!.prepared, 5000, '★预备值保留（引擎不清 [21321+ch]）');
});

test('★P3 0x2ff / 0x302：预备值存**原值**（可被写成 0x10000 的那一格不是 0..10000 域）', async () => {
  const host = new FakeAudioHost({ onLog: () => {} });
  const eng = new AudioEngine(host, { log: () => {} });
  eng.voiceFactorPrepare(0, 20000);
  assert.equal(eng.debug().voice[0]!.prepared, 20000, '★原值直写（修前若钳位会得 10000）');
  eng.voiceFactorPrepare(0, -3);
  assert.equal(eng.debug().voice[0]!.prepared, -3, '负值同样原值');
});

test('★P3 0x1bc：**不发** voice-reset（引擎的释放循环被 `_this+85160` 门住，而那格全库无写者）', () => {
  // 读体（票 T-0152）：`sub_4197A0` raw 24851-24855 的 `for (i=0;i<3;++i) sub_4B60C0(Voice,i+12)`
  // 在 `if (*(_DWORD *)(_this + 85160))` 里，而 `_this + 85160` 在整个反编译里**只有两处读、
  // 没有写者**（`Engine[21293]` = `+85172` 才是被写的那格）⇒ 门恒不成立、一个通道都不释放。
  // ⇒ emulator 此前无条件发 3 条 `voice-reset`（宿主会停掉正在播的语音）是**多发**的一次停播。
  const { e, native, step } = rig();
  const n = native.intents.length;
  step(0x1bc);
  assert.deepEqual(
    native.intents.slice(n),
    [],
    '★0x1BC 不发任何「释放通道」意图（引擎那半被恒假门挡住）',
  );
  // 但字段清零照做（引擎真正做的那半，raw 24857-24869）
  assert.equal(e.engineValues.get(ENGINE_FIELD.voiceChannelStateBase), 0);
  assert.equal(e.engineValues.get(ENGINE_FIELD.voiceRegSingle), 0);
});

test('★P3 0x1c9：op1（驱动 id）落引擎字段（引擎 `sub_4B8490` 把它写进驱动对象，raw 140301）', () => {
  const { e, step } = rig();
  step(0x1c9, [im(3), im(7), im(9)]);
  assert.equal(e.engineValues.get(ENGINE_FIELD.audioDeviceDriverId), 3, '★驱动 id 落字段（修前只进日志）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.audioDeviceField0), 7);
  assert.equal(e.engineValues.get(ENGINE_FIELD.audioDeviceField1), 9);
});

test('★P3 0xc6：音量**原值直存**（引擎 sub_4071D0/sub_4B68A0 原值直用，raw 29978-29981）', () => {
  // 引擎那一族对脚本给的音量没有钳位：`sound:Volume0..4` 与设备格存的都是原值；
  // 钳位只应发生在"0..10000 → 增益"的换算里（否则配置回写/持久化会与真机不同）。
  const { e, native, step, logs } = rig();
  step(0xc6, [im(0), im(20000)]); // 越界（>10000）
  assert.deepEqual(native.last, { kind: 'volume', category: 0, value: 20000 });
  assert.equal(e.config!.values.get('sound:volume0'), 20000, '★配置存原值（修前会存 10000）');
  step(0xc6, [im(1), im(-50)]);
  assert.equal(e.config!.values.get('sound:volume1'), -50, '负值同样原值');

  // 类别越界：引擎 sprintf 出 `SetVolumeの引数が不正です．`（raw 4413/29978-29981）⇒ 必须留痕
  const before = native.intents.length;
  step(0xc6, [im(9), im(100)]);
  assert.equal(native.intents.length, before, '类别越界不发意图');
  assert.ok(
    logs.some((l) => l.includes('SetVolume') && l.includes('不正')),
    `类别越界必须打出引擎的错误串：${logs.join(' | ')}`,
  );
});
