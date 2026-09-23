/** @tier T0 @kind core @subsystem audio */

/**
 * **音频指令族 → 宿主意图**（`src/vm/handlers/audio.ts`）回归。
 *
 * 锁两件事：
 *  1. **操作数顺序/含义**与引擎一致（证据：`docs-new/03-engine/sound-system.md` §7 的每条 raw 行号）——
 *     例如 `0xB4` 是 `(id, 通道)`、`0x2F5` 是 `(id, 附带, 延迟, 通道)`、`0x2F4` 的通道在 **op3**；
 *  2. **ADV 激活位分叉**：位在时发 `voice-defer`（寄存），位不在时发 `voice-play`（立即）。
 *
 * 为什么值得单独测：这一族此前大多**不在任何表里**（命中即硬报错），剩下几条是 no-op；
 * 一旦操作数顺序错了，症状是"音效/语音串台或指定了错的通道"，而且**不报错**。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StubNative } from '../src/vm/native.js';
import { Engine, Frame, ADV_ACTIVE } from '../src/vm/engine.js';
import { makeCtx } from '../src/vm/step.js';
import { ENGINE_INTERNAL_OPS, NATIVE_OPS, OPS } from '../src/vm/ops.js';
import { parseIni } from '../src/engineConfig.js';
import { audioBootIntents } from '../src/vm/handlers/audio.js';
import type { AudioIntent } from '../src/audio/audioEngine.js';
import type { BinArg, BinInstruction } from '../src/script/bin.js';
import { im, instr, str } from './harness.js';

const INI = `[sound]
Volume0=80
Volume1=60
SE=1
Voice=1
Music=1
MusicFadeOnVoicePlaying=1
[set]
KeepMusicVolume=1
`;


/** 记录音频意图的宿主（其余走 StubNative 的记录实现）。 */
class RecordingNative extends StubNative {
  readonly intents: AudioIntent[] = [];
  constructor() {
    super(() => {});
  }
  override audio(intent: AudioIntent): void {
    this.intents.push(intent);
  }
  get last(): AudioIntent {
    const v = this.intents.at(-1);
    assert.ok(v, '没有记录到任何音频意图');
    return v;
  }
}

function mk(): { e: Engine; native: RecordingNative; step: (op: number, args?: BinArg[]) => void; logs: string[] } {
  const native = new RecordingNative();
  const e = new Engine(native);
  e.config = parseIni(INI);
  const f = new Frame();
  const logs: string[] = [];
  const step = (op: number, args: BinArg[] = []): void => {
    const instr = {
      opcode: op, name: `i${op.toString(16)}`, argc: args.length, args, byteOffset: 0, index: 0,
    } as unknown as BinInstruction;
    const h = NATIVE_OPS.get(op);
    assert.ok(h, `0x${op.toString(16)} 应在 NATIVE_OPS（音频族真实现）里`);
    h!(makeCtx(e, f, instr, native, (m) => logs.push(m)));
  };
  return { e, native, step, logs };
}

test('SE：0xB4 (id, 通道) / 0xB5·0xBA (通道, 循环位) / 0xB6 / 0x2BF (通道, 循环, 延迟ms)', () => {
  const { native, step } = mk();
  step(0xb4, [im(46), im(1)]); // play-sound-effect 2e 1
  assert.deepEqual(native.last, { kind: 'se-load', id: 46, ch: 1 });
  step(0xb5, [im(1)]); // i0b5 1
  assert.deepEqual(native.last, { kind: 'se-play', ch: 1, loop: false });
  step(0xba, [im(2)]); // i0ba 2
  assert.deepEqual(native.last, { kind: 'se-play', ch: 2, loop: true });
  step(0xb6, [im(1)]); // i0b6 1
  assert.deepEqual(native.last, { kind: 'se-stop', ch: 1 });
  step(0x2bf, [im(3), im(1), im(200)]); // i2bf 3 1 c8
  assert.deepEqual(native.last, { kind: 'se-delay', ch: 3, loop: true, delayMs: 200 });
});

test('BGM：0xB7 循环 / 0xB9 一次 / 0xBF 带策略 / 0xBC 模式 / 0xC2 淡变', () => {
  const { e, native, step } = mini();
  step(0xb7, [im(0x29)]); // i0b7 29（CONFIG1 的 BGM 预览）
  assert.deepEqual(native.last, { kind: 'bgm-play', bgm: 0x29, loop: true });
  step(0xb9, [im(0x20)]); // i0b9 20
  assert.deepEqual(native.last, { kind: 'bgm-play', bgm: 0x20, loop: false });
  step(0xbf, [im(18)]); // play-bgm 12
  assert.deepEqual(native.last, { kind: 'bgm-play', bgm: 18, loop: true });
  assert.ok(
    native.intents.some((i) => i.kind === 'policy' && i.keepMusicVoice && i.fadeOnVoice),
    '0xBF 会先下发 set:KeepMusicVolume / sound:MusicFadeOnVoicePlaying 策略',
  );
  // ★0xBC（`sub_408CF0` raw 13521-13534）：存 id → 改配置 → `sub_489B50`（停 + 清 id）→ 装回 id →
  //   `sub_489F80(Music, 0, Music[261])` 用当前循环位重播 ⇒ 三条意图，不是一条。
  step(0xbc, [im(1)]); // i0bc 1 ⇒ 模式 0（关）
  assert.deepEqual(
    native.intents.slice(-3).map((i) => i.kind),
    ['bgm-mode', 'bgm-stop', 'bgm-play'],
    '0xBC = 切模式 + 停一次 + 重播当前曲（引擎 sub_408CF0 的三步）',
  );
  assert.deepEqual(native.intents.at(-2), { kind: 'bgm-stop' });
  assert.deepEqual(native.intents.at(-1), { kind: 'bgm-play', bgm: 18, loop: true });
  // `0xC2 0 <step>`：目标 0 ⇒ 先把当前曲 id 清掉（`sub_489D10` raw 106317-106318），再下发淡变。
  step(0xc2, [im(0), im(100)]);
  assert.deepEqual(native.last, { kind: 'bgm-fade', value: 0, step: 100 });
  assert.equal(e.engineValues.get(174713), 0, '淡到 0 ⇒ 当前曲 id 已清（0xC0 从此读到 0）');
});

test('★BGM 运行态（`Music[259]` = `_this[174713]`）：0xB7 0 = 重播当前曲、0xC3 = 登记曲号不播、0xB8 清 0', () => {
  const { e, native, step } = mk();
  // ① 起播 `play-bgm 12` ⇒ 运行态当前曲 id = 18
  step(0xbf, [im(18)]);
  assert.equal(e.engineValues.get(174713), 18, '0xBF 起播时写当前曲 id（引擎 sub_489C20 的 `Music[259] = a2`）');
  assert.equal(e.engineValues.get(174715), 1, '0xBF 同时置循环位（`Music[261]` = `_this[174715]`）');

  // ② `i0b7 0` ⇒ **重播当前曲**（不是"播曲号 0"）：引擎 `sub_489F80` 的 `a2 == 0 && Music[259] != 0` 分支
  step(0xb7, [im(0)]);
  assert.deepEqual(native.last, { kind: 'bgm-play', bgm: 18, loop: true }, '★i0b7 0 重播当前曲（语料 30 处全是这一形）');
  assert.equal(e.engineValues.get(174715), 1, '0xB7 恒写循环位 = 1');

  // ③ `i0b9 0` ⇒ 同样重播当前曲、但循环位 = 0
  step(0xb9, [im(0)]);
  assert.deepEqual(native.last, { kind: 'bgm-play', bgm: 18, loop: false });
  assert.equal(e.engineValues.get(174715), 0, '0xB9 恒写循环位 = 0');

  // ④ `i0c3 6`：**只登记曲号，不播**（`sub_420F10` 只有 `Music[259] = op1`）
  const before = native.intents.length;
  step(0xc3, [im(6)]);
  assert.equal(native.intents.length, before, '0xC3 不发任何意图（引擎只写字段）');
  assert.equal(e.engineValues.get(174713), 6, '0xC3 写当前曲 id');

  // ⑤ `i0c2 <音量> <步长>`（目标非 0）⇒ **把刚登记的曲放起来**（`sub_489D10` 的起播分支）
  step(0xc2, [im(10000), im(2500)]);
  assert.deepEqual(
    native.intents.slice(-2),
    [{ kind: 'bgm-play', bgm: 6, loop: false }, { kind: 'bgm-fade', value: 10000, step: 2500 }],
    '★"i0c3 登记 + i0c2 淡入"习语里真正起播的那一步',
  );

  // ⑥ `i0b8`：停 + **清当前曲 id**（`sub_489B50` 的第一件事）
  step(0xb8);
  assert.deepEqual(native.last, { kind: 'bgm-stop' });
  assert.equal(e.engineValues.get(174713), 0, '★0xB8 清当前曲 id（读档 BGM 还原链靠"存档里的 id"补回来）');

  // ⑦ 清掉之后再 `i0b7 0` ⇒ 引擎走 `sub_489B50`（`Music[259] == 0`）⇒ 不发起播意图
  const afterStop = native.intents.length;
  step(0xb7, [im(0)]);
  assert.equal(native.intents.length, afterStop, '当前曲 id 为 0 ⇒ `i0b7 0` 不重播（引擎同分支）');
});

function mini(): { e: Engine; native: RecordingNative; step: (op: number, args?: BinArg[]) => void } {
  return mk();
}

test('0xBB 写配置 sound:SE 并下发开关；0xC6 写 sound:VolumeN 并下发音量', () => {
  const { e, native, step } = mk();
  step(0xbb, [im(0)]);
  assert.deepEqual(native.last, { kind: 'enable', target: 'se', on: false });
  step(0xbb, [im(1)]);
  assert.deepEqual(native.last, { kind: 'enable', target: 'se', on: true });
  assert.equal(e.config!.values.get('sound:se'), 1, '开关写回配置（0xC7 读的就是它）');

  step(0xc6, [im(2), im(5000)]);
  assert.deepEqual(native.last, { kind: 'volume', category: 2, value: 5000 });
  assert.equal(e.config!.values.get('sound:volume2'), 5000, '音量写回配置（设置界面滑块持久化）');
  const n = native.intents.length;
  step(0xc6, [im(9), im(1)]); // 越界：引擎报错分支，不写不发
  assert.equal(native.intents.length, n, '类别越界不产生意图');
});

test('★0x1BA SetSoundMode：op1 = 1 音乐 / 2 SE / 3 语音 / 4 影片；四分支复用 0xBB/0xBC 的同一批体', () => {
  const { e, native, step, logs } = mk();

  // ① op1 = 1（音乐）：体 = `sub_408CF0(this, op2)`（raw 29994-29998）。★与 0xBC 的唯一差别是 a2 = op2 原值。
  step(0x1ba, [im(1), im(1)]); // 开音乐（sound:Music = 1 ≥ 0 ⇒ 只切模式，不做 ±3）
  assert.deepEqual(
    native.intents.slice(-2),
    [{ kind: 'bgm-mode', mode: 1 }, { kind: 'bgm-stop' }],
    '音乐分支 = 切模式 + 停一次（此刻无当前曲 ⇒ 不重播）',
  );
  step(0x1ba, [im(1), im(0)]); // 关音乐：1 − 3 = −2
  assert.deepEqual(native.intents.at(-2), { kind: 'bgm-mode', mode: 0 });
  assert.equal(e.config!.values.get('sound:music'), -2, '关音乐 = `sound:Music` 减 3（引擎 ±3，raw 13525-13540）');

  // ② op1 = 2（SE）：体 = `sub_408D90`（raw 13545-13571），关时释放 SE 通道 0..9
  const n1 = native.intents.length;
  step(0x1ba, [im(2), im(0)]);
  assert.deepEqual(native.last, { kind: 'enable', target: 'se', on: false });
  assert.equal(e.config!.values.get('sound:se'), 0);
  step(0x1ba, [im(2), im(0)]); // 与现状相同 ⇒ 引擎 `(a2 != 0) == v3` 直接返回（raw 13552-13553）
  assert.equal(native.intents.length, n1 + 1, '数值未变 ⇒ 早退：不写配置、不发第二条意图');

  // ③ op1 = 3（语音）：体 = `sub_408E20`（raw 13573-13599），关时释放通道 12/13/14
  step(0x1ba, [im(3), im(0)]);
  assert.deepEqual(native.last, { kind: 'enable', target: 'voice', on: false });
  assert.equal(e.config!.values.get('sound:voice'), 0);
  step(0x1ba, [im(3), im(1)]);
  assert.deepEqual(native.last, { kind: 'enable', target: 'voice', on: true });

  // ④ op1 = 4（影片）：体 = `sub_408EB0`（raw 13601-13609）—— 只写 `sound:Movie`
  const n2 = native.intents.length;
  step(0x1ba, [im(4), im(1)]);
  assert.equal(e.config!.values.get('sound:movie'), 1, '影片分支写配置（整份 INI 会回写，有消费者）');
  assert.equal(native.intents.length, n2, '影片播放器音轨下发未建模 ⇒ 不发假意图（缺口已登记）');

  // ⑤ 非法类别：`SetSoundModeの引数が不正です．`（raw 30016-30017）⇒ 什么都不写
  step(0x1ba, [im(9), im(1)]);
  assert.equal(native.intents.length, n2, '非法类别不产生意图');
  assert.ok(logs.some((l) => l.includes('SetSoundMode')), `报错分支必须留痕：${logs.join(' | ')}`);
});

test('★0xC1 翻转 `Music[260]`（BGM 暂停位）并把新值下发宿主；起播/停播清 0；NoMusic 槽不下发', () => {
  const { e, native, step } = mk();
  step(0xbf, [im(18)]); // 先起播：Music[259] = 18
  step(0xc1);
  assert.deepEqual(native.last, { kind: 'bgm-pause', paused: true }, '首次 ⇒ 置暂停位并把新值下发');
  assert.equal(e.engineValues.get(174714), 1, 'Music[260] = 1（`_this[174714]`）');
  step(0xc1);
  assert.deepEqual(native.last, { kind: 'bgm-pause', paused: false }, '★是翻转（不是单向置位）');
  assert.equal(e.engineValues.get(174714), 0);

  // 起播（`sub_489F80` raw 106365 / `sub_489C20` raw 106240）与停播（`sub_489B50` raw 106186）都清暂停位
  step(0xc1);
  assert.equal(e.engineValues.get(174714), 1);
  step(0xb7, [im(0)]); // i0b7 0 = 重播当前曲
  assert.equal(e.engineValues.get(174714), 0, '0xB7 重播 ⇒ 清暂停位');
  step(0xc1);
  step(0xb8); // i0b8 停
  assert.equal(e.engineValues.get(174714), 0, '0xB8 停 ⇒ 清暂停位');

  // 音源关掉（`sound:Music < 0`）⇒ 当前槽 = −1 = NoMusic，其 vtable+12（`sub_4350E0`）是空桩
  e.config!.values.set('sound:music', -1);
  const before = native.intents.length;
  step(0xc1);
  assert.equal(native.intents.length, before, 'NoMusic 槽 ⇒ 引擎那一步是空桩，不下发暂停意图');
  assert.equal(e.engineValues.get(174714), 1, '但暂停位本身仍翻转（引擎先写 `Music[260]` 再调后端）');
});

test('语音：0xC4/0x1BD（通道 0）与 ADV 激活位分叉（寄存 vs 立即）', () => {
  const { e, native, step } = mk();
  step(0xc4, [im(162)]); // play-voice 162
  assert.deepEqual(native.last, { kind: 'voice-play', ch: 0, id: 162, loop: false });
  step(0x1bd, [im(0x27f)]);
  assert.deepEqual(native.last, { kind: 'voice-play', ch: 0, id: 0x27f, loop: true });

  e.effectFlags |= ADV_ACTIVE;
  step(0xc4, [im(320)]);
  assert.deepEqual(native.last, { kind: 'voice-defer', ch: 0, id: 320, loop: false }, 'ADV 位在 ⇒ 寄存');
  e.effectFlags &= ~ADV_ACTIVE;
  step(0xc4, [im(320)]);
  assert.equal(native.last.kind, 'voice-play', 'ADV 位清除 ⇒ 立即起播');
});

test('语音：0x2F4 (id, 附带, 通道) / 0x2C0 / 0x2F5 (id, 附带, 延迟, 通道)', () => {
  const { native, step } = mk();
  step(0x2f4, [im(700), im(0), im(2)]); // i2f4 2bc 0 2
  assert.deepEqual(native.last, { kind: 'voice-play', ch: 2, id: 700, loop: false });
  step(0x2c0, [im(0x162), im(0), im(100)]); // i2c0 ⇒ 通道 0
  assert.deepEqual(native.last, { kind: 'voice-queue', ch: 0, id: 0x162, aux: 0, delayMs: 100 });
  step(0x2f5, [im(0x162), im(1), im(50), im(2)]); // i2f5 ⇒ 通道 = op4
  assert.deepEqual(native.last, { kind: 'voice-queue', ch: 2, id: 0x162, aux: 1, delayMs: 50 });
});

test('语音：0x2F6 复位 / 0x2F7 状态位 / 0x2F8 pan / 0x2FF 预备 / 0x302 生效', () => {
  const { native, step } = mk();
  step(0x2f6, [im(2)]); // i2f6 2
  assert.deepEqual(native.last, { kind: 'voice-reset', ch: 2 });
  step(0x2f7, [im(1)]);
  assert.deepEqual(native.last, { kind: 'voice-flag', ch: 1 });
  step(0x2f8, [im(0), im(0)]); // i2f8 0 0（全库 1.4 万处：pan 归中）
  assert.deepEqual(native.last, { kind: 'voice-pan', ch: 0, pan: 0 });
  step(0x2ff, [im(0), im(5000)]);
  assert.deepEqual(native.last, { kind: 'voice-factor-prepare', ch: 0, value: 5000 });
  step(0x302, [im(0), im(10000)]); // i302 0 2710
  assert.deepEqual(native.last, { kind: 'voice-factor-apply', ch: 0, value: 10000 });
});

test('启动灌值：audioBootIntents 把 SYS4REG.INI 的音量/开关/策略翻成意图', () => {
  const e = mk().e;
  const intents = audioBootIntents(e.config);
  const vol = intents.filter((i) => i.kind === 'volume');
  assert.deepEqual(
    vol.map((i) => (i.kind === 'volume' ? [i.category, i.value] : [])),
    [[0, 80], [1, 60]], // 只有 INI 里真的出现的键才下发
    `音量意图应逐个类别下发：${JSON.stringify(intents)}`,
  );
  assert.ok(intents.some((i) => i.kind === 'enable' && i.target === 'se' && i.on));
  assert.ok(intents.some((i) => i.kind === 'enable' && i.target === 'voice' && i.on));
  assert.ok(intents.some((i) => i.kind === 'bgm-mode' && i.mode === 1), 'sound:Music >= 0 ⇒ 开');
  assert.ok(
    intents.some((i) => i.kind === 'policy' && i.keepMusicVoice && i.fadeOnVoice),
    'set:KeepMusicVolume / sound:MusicFadeOnVoicePlaying ⇒ policy',
  );
});

test('注册表分类棘轮：音频族全在 NATIVE_OPS，且不在另外两张表里', () => {
  const audioOps = [
    0xb4, 0xb5, 0xb6, 0xb7, 0xb9, 0xba, 0xbb, 0xbc, 0xc1, 0xbf, 0xc2, 0xc4, 0xc6, 0x1bd,
    0x1ba, 0x2bf, 0x2c0, 0x2f4, 0x2f5, 0x2f6, 0x2f7, 0x2f8, 0x2ff, 0x302,
  ];
  for (const op of audioOps) {
    assert.ok(NATIVE_OPS.has(op), `0x${op.toString(16)} 应在 NATIVE_OPS`);
    assert.ok(!OPS.has(op), `0x${op.toString(16)} 不应在 OPS（它不是 VM 核心指令）`);
    assert.ok(!ENGINE_INTERNAL_OPS.has(op), `0x${op.toString(16)} 不应再是 engine-internal no-op`);
  }
});
