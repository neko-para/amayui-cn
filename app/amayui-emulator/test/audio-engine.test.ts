/**
 * **音频引擎回归**（`src/audio/audioEngine.ts`）：SE / 语音 / BGM 的通道行为、音量与 pan、
 * 延迟播、ADV 寄存器与冲刷、BGM 淡变与压低、解码缓存。
 *
 * 这一组测试锁的是**引擎侧语义**（证据见 `docs-new/03-engine/sound-system.md`，
 * 每条 `test()` 的注释里给出对应 opcode / raw 行号），不碰 Web Audio —— 宿主由
 * `test/fakeAudioHost.ts` 顶替。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine, VOLUME_MAX } from '../src/audio/audioEngine.js';
import { FakeAudioHost } from './fakeAudioHost.js';

/** 造一个「引擎 + 假宿主」；`durations` 可指定每个 id 的时长（秒）。 */
function mk(opts: { durations?: Record<number, number>; cacheBytes?: number; streaming?: boolean; missing?: Array<number | string>; positionOf?: (id: number) => number } = {}): {
  host: FakeAudioHost;
  eng: AudioEngine;
  logs: string[];
} {
  const logs: string[] = [];
  const host = new FakeAudioHost({
    sizeOf: (id) => (opts.durations?.[id] ? opts.durations[id]! * 1000 : 4096),
    durationOf: (id) => opts.durations?.[id] ?? 1,
    streaming: opts.streaming ?? false,
    missing: new Set((opts.missing ?? []).map((k) => (typeof k === 'number' ? `id:` + k : k))),
    positionOf: opts.positionOf,
  });
  const eng = new AudioEngine(host, { cacheBytes: opts.cacheBytes, log: (m) => logs.push(m) });
  return { host, eng, logs };
}

// ==================== SE：0xB4 / 0xB5 / 0xBA / 0xB6 / 0x2BF ====================

test('0xB4 只装载不起播；0xB5 才起播（loop=false）', async () => {
  const { host, eng } = mk();
  eng.seLoad(46, 1); // PLAY-SOUND-EFFECT SE004.WAV → 通道 1
  await eng.idle();
  assert.deepEqual(host.loads, ['id:46'], '装载读了字节（SE 用统一文件 id）');
  assert.equal(host.plays.length, 0, '装载本身不发声（引擎 sub_4B4F60 只建缓冲绑通道）');
  assert.equal(eng.debug().se[1]!.loadedId, 46);

  eng.sePlay(1, false); // i0b5 1
  assert.equal(host.plays.length, 1);
  assert.equal(host.plays[0]!.opts.loop, false, '0xB5 = 播一次（SoundBuffer +9296 = 0）');
});

test('0xBA 起播带循环标志（与 0xB5 的唯一差别）', async () => {
  const { host, eng } = mk();
  eng.seLoad(50, 2);
  await eng.idle();
  eng.sePlay(2, true); // i0ba 2
  assert.equal(host.plays.at(-1)!.opts.loop, true);
});

test('起播先于装载完成 ⇒ 装载完自动起播（不丢音）', async () => {
  const { host, eng } = mk();
  eng.sePlay(3, false); // 先起播（引擎里脚本总是先 0xB4 再 0xB5，这里防御乱序）
  assert.equal(host.plays.length, 0, '还没有 clip ⇒ 不能起播');
  eng.seLoad(46, 3);
  await eng.idle();
  assert.equal(host.plays.length, 1, '装载完成后自动起播');
  assert.equal(host.plays[0]!.id, 46);
});

/**
 * ★**同一通道换装不同 id ⇒ 必须播出新 id**（2026-09：用户报「点『ゲーム開始』音效错」的回归锁）。
 *
 * 依据：`GAMESTART.txt:1307-1308` 是相邻的 `play-sound-effect 51e3 1` + `i0b5 1`（id 20963 = SE009.WAV）；
 * 通道 1 上此前已绑着 TITLE 点击音装的 id 50（SE002.WAV）。真实的 Electron 日志当时是
 * `[audio] SE ch1 起播 id=50`（`.tmp/se-51e3-analysis.md` §2/E2）—— 播的是**旧**音效。
 *
 * 为什么这个用例能抓到：引擎的 `0xB4` 是**同步**装载（`sub_4B4F60` raw 137630 → `sub_4B6570`
 * 先释放旧缓冲 raw 138906-138908、再绑新缓冲 raw 138925），而 emulator 是异步装载 ——
 * 同一个同步突发里的 `0xB5` 只能看到**上一个** clip。若把 `seLoad` 里的"换装即作废旧绑定"删掉，
 * 本测试会红（得到 14755 / 50），这正是「缺陷必须让测试失败」的口径。
 */
test('同一通道换装不同 id：0xB4 + 0xB5 必须播出新 id（不得复用旧 clip）', async () => {
  const { host, eng } = mk();
  eng.seLoad(14755, 1); // TITLE.txt:19  play-sound-effect 39a3 1（SE005.WAV）→ 通道 1
  await eng.idle();
  eng.sePlay(1, false);
  assert.equal(host.plays.at(-1)!.id, 14755, '通道首次装载：正常起播');

  eng.seLoad(50, 1); // TITLE.txt:316-317（点 TITLE 的 Game Start）
  eng.sePlay(1, false);
  await eng.idle();
  assert.equal(host.plays.at(-1)!.id, 50, '换装 SE002 后必须播 SE002（不是残留的 SE005）');

  eng.seLoad(20963, 1); // GAMESTART.txt:1307-1308（点 ゲーム開始）
  eng.sePlay(1, false);
  await eng.idle();
  assert.equal(host.plays.at(-1)!.id, 20963, '换装 SE009 后必须播 SE009（不是残留的 SE002）');
});

test('同一通道重复装载**同一个** id：仍命中缓存、无需等装载即可起播（不引入额外延迟）', async () => {
  const { host, eng } = mk();
  eng.seLoad(46, 4);
  await eng.idle();
  eng.sePlay(4, false);
  const n = host.plays.length;
  eng.seLoad(46, 4); // 同 id 重复装载（同一界面反复点同一个按钮）
  eng.sePlay(4, false);
  assert.equal(host.plays.length, n + 1, '同 id 不丢同步起播（缓存命中）');
  assert.equal(host.plays.at(-1)!.id, 46);
});

test('0xB6 停止通道；0x2F6 之外的通道也立即静音', async () => {
  const { host, eng } = mk();
  eng.seLoad(46, 0);
  await eng.idle();
  eng.sePlay(0, true);
  const p = host.plays.at(-1)!;
  eng.seStop(0); // i0b6 0
  assert.equal(p.stopped, true);
  assert.equal(eng.debug().se[0]!.playing, false);
});

test('0x2BF 延迟播 SE：到期前不响、tick 过后起播', async () => {
  const { host, eng } = mk();
  eng.seLoad(46, 1);
  await eng.idle();
  eng.sePlayDelayed(1, false, 200); // i2bf 1 0 c8
  eng.tick(1000, false);
  assert.equal(host.plays.length, 0, '延迟未到 ⇒ 不起播');
  eng.tick(1100, false);
  assert.equal(host.plays.length, 0, '还差 100ms');
  eng.tick(1250, false);
  assert.equal(host.plays.length, 1, '到期起播（引擎每帧 sub_4B5230 的等价物）');
});

test('非循环 SE 播完自动腾出通道（时长到期）', async () => {
  const { host, eng } = mk({ durations: { 46: 0.5 } });
  eng.seLoad(46, 1);
  await eng.idle();
  eng.sePlay(1, false);
  eng.tick(100, false);
  assert.equal(eng.debug().se[1]!.playing, true);
  eng.tick(700, false);
  assert.equal(eng.debug().se[1]!.playing, false, '0.5s 后收尾');
  assert.equal(host.plays.at(-1)!.stopped, true);
});

test('通道越界只记日志、不抛（引擎报 dsPlaySound 分支）', () => {
  const { eng, logs } = mk();
  eng.sePlay(99, false);
  eng.voicePan(7, 0);
  assert.ok(logs.some((l) => l.includes('SE 通道越界')), `应有越界日志：${logs.join(' | ')}`);
  assert.ok(logs.some((l) => l.includes('语音通道越界')));
});

// ==================== 语音：0xC4 / 0x1BD / 0x2F4 / 0x2C0 / 0x2F5 / 0x2F6 / 0x2F7 / 0x2F8 / 0x2FF / 0x302 ====================

test('0xC4 播语音到通道 0；0x1BD 带循环位', async () => {
  const { host, eng } = mk();
  eng.voicePlay(0, 77, false); // play-voice（FIA1155.OGG）
  await eng.idle();
  assert.equal(host.plays.length, 1);
  assert.equal(host.plays[0]!.id, 77);
  assert.equal(host.plays[0]!.opts.loop, false);
  eng.voicePlay(0, 129, true); // i1bd
  await eng.idle();
  assert.equal(host.plays.at(-1)!.opts.loop, true);
});

test('ADV 激活位期间 0xC4 只寄存 ⇒ 位清除后的第一帧才冲刷（引擎 raw 20146/24966）', async () => {
  const { host, eng } = mk();
  eng.voiceDefer(0, 162, false); // 0xC4 在 ADV 位下的分支
  eng.tick(1000, true);
  await eng.idle();
  assert.equal(host.plays.length, 0, 'ADV 还没结束 ⇒ 不出声');
  assert.equal(eng.debug().voice[0]!.deferred, 162);
  eng.tick(1100, false);
  await eng.idle();
  assert.equal(host.plays.length, 1, '位清除 ⇒ 冲刷并起播');
  assert.equal(host.plays[0]!.id, 162);
  assert.equal(eng.debug().voice[0]!.deferred, null, '冲刷后清空寄存');
});

test('0x2F6 复位语音通道会丢掉寄存（引擎同帧清 Engine[122505/122508+ch]）', async () => {
  const { host, eng } = mk();
  eng.voiceDefer(1, 200, false);
  eng.voiceReset(1); // i2f6 1
  eng.tick(1000, false);
  await eng.idle();
  assert.equal(host.plays.length, 0, '复位后不应再冲刷出来');
});

test('0x2C0 / 0x2F5 语音排队（带延迟；到点且通道空闲才起播）', async () => {
  const { host, eng } = mk();
  eng.voiceQueue(2, 320, 0, 150); // i2f5 320 0 96 2
  eng.tick(1000, false);
  assert.equal(host.plays.length, 0, '延迟未到');
  eng.tick(1200, false);
  await eng.idle();
  assert.equal(host.plays.length, 1, '到期起播');
  assert.equal(host.plays[0]!.id, 320);
});

test('0x2F8 设语音通道 pan（±10000 → -1..+1；0 = 中央）', async () => {
  const { host, eng } = mk();
  eng.voicePlay(0, 162, false);
  await eng.idle();
  const p = host.plays.at(-1)!;
  assert.equal(p.pan, 0, '缺省中央');
  eng.voicePan(0, -VOLUME_MAX); // i2f8 0 -2710（全左）
  assert.equal(p.pan, -1);
  eng.voicePan(0, 5000);
  assert.equal(p.pan, 0.5);
  eng.voicePan(0, 999999); // 钳制（引擎对称钳制 ±10000）
  assert.equal(p.pan, 1);
});

test('0x2FF 只是预备、0x302 才生效并改增益（每通道音量因子）', async () => {
  const { host, eng } = mk();
  eng.voicePlay(0, 162, false);
  await eng.idle();
  const p = host.plays.at(-1)!;
  const base = p.gain;
  eng.voiceFactorPrepare(0, 5000); // i2ff
  assert.equal(p.gain, base, '预备不改变音量');
  assert.equal(eng.debug().voice[0]!.prepared, 5000);
  eng.voiceFactorApply(0, 5000); // i302 0 2710/2
  assert.equal(p.gain, base * 0.5, '因子 50% ⇒ 增益减半');
  assert.equal(eng.debug().voice[0]!.prepared, null);
});

test('语音通道占用：非循环语音播完即空闲（可被下一条队列使用）', async () => {
  const { host, eng } = mk({ durations: { 162: 0.3 } });
  eng.voicePlay(0, 162, false);
  await eng.idle();
  eng.voiceQueue(0, 163, 0, 0);
  eng.tick(100, false);
  await eng.idle();
  assert.equal(host.plays.filter((p) => p.id === 163).length, 0, '前一条还在播（占线）⇒ 队列不抢通道');
  eng.tick(500, false);
  await eng.idle();
  assert.equal(host.plays.filter((p) => p.id === 163).length, 1, '前一条收尾后才排空队列');
});

// ==================== BGM：0xBF / 0xB7 / 0xB9 / 0xBB / 0xBC / 0xC2 ====================

test('0xBF/0xB7 播 BGM（循环）；0xB9 不循环；同 id 同循环不重启', async () => {
  const { host, eng } = mk();
  eng.bgmPlay(18, true); // play-bgm 12
  await eng.idle();
  assert.equal(host.plays.length, 1);
  assert.equal(host.plays[0]!.id, 18);
  assert.equal(host.plays[0]!.opts.loop, true);
  eng.bgmPlay(18, true);
  await eng.idle();
  assert.equal(host.plays.length, 1, '同 id 同循环 ⇒ 不重启（引擎同 id 同 loop 直接返回）');
  eng.bgmPlay(0x20, false); // i0b9 20
  await eng.idle();
  assert.equal(host.plays.at(-1)!.opts.loop, false);
  assert.equal(host.plays.at(-2)!.stopped, true, '换曲先停旧曲');
});

test('0xBC 模式 0 = 关（停 BGM）；0xC2 淡变到 0 会停', async () => {
  const { host, eng } = mk();
  eng.bgmPlay(18, true);
  await eng.idle();
  const p = host.plays.at(-1)!;
  eng.bgmMode(0); // i0bc 1
  assert.equal(p.stopped, true);
  assert.equal(eng.debug().enabled.bgm, false);
  eng.bgmPlay(19, true);
  await eng.idle();
  assert.equal(host.plays.length, 1, '关掉后不再起播');
  eng.bgmMode(1);
  eng.bgmPlay(19, true);
  await eng.idle();
  eng.bgmFadeTo(0, 50); // i0c2 0 64
  eng.tick(1000, false);
  eng.tick(1016, false);
  eng.tick(1032, false);
  assert.equal(eng.debug().bgm!.playing, false, '淡到 0 ⇒ 停（引擎进度满且目标为 0 时 stop）');
});

test('★0xC1 BGM 暂停/继续：流式宿主走 `setPaused`；缓冲宿主「停播 + offsetSec 续播」', async () => {
  // ① 流式（Electron 的常态路径）：暂停直达播放句柄，位置由 `<audio>` 自己保留
  const s = mk({ streaming: true });
  s.eng.bgmPlay(18, true);
  const stream = s.host.streams.at(-1)!;
  s.eng.bgmPause(true);
  assert.deepEqual(stream.pauseHistory, [true], '暂停下达到流式句柄（不是 stop）');
  assert.equal(stream.stopped, false, '暂停不释放播放（引擎 SetPause 保留位置）');
  assert.equal(s.eng.debug().bgm!.paused, true);
  s.eng.bgmPause(false);
  assert.deepEqual(stream.pauseHistory, [true, false], '继续同样下达');
  s.eng.bgmStop();
  assert.equal(s.eng.debug().bgm!.paused, false, '停播清暂停位（引擎 `sub_489B50` raw 106186）');

  // ② 缓冲宿主（没有 `setPaused`）：暂停 = 停播 + 记位置，继续 = 用 `offsetSec` 从原位续播
  const b = mk({ positionOf: () => 12.5 });
  b.eng.bgmPlay(18, true);
  await b.eng.idle();
  const first = b.host.plays.at(-1)!;
  b.eng.bgmPause(true);
  assert.equal(first.stopped, true, '宿主无 setPaused ⇒ 停播（位置已由 positionSec 记下）');
  assert.equal(b.eng.debug().bgm!.playing, false);
  assert.equal(b.eng.debug().bgm!.paused, true);
  b.eng.bgmPause(false);
  assert.equal(b.host.plays.length, 2, '继续 ⇒ 重新起播');
  assert.equal(b.host.plays.at(-1)!.opts.offsetSec, 12.5, '从暂停位置续播（引擎 sub_4B5A30 的偏移等价物）');
});

test('★BGM 曲号按文件名解析（`BGM%03d.OGG`），不是统一文件 id', async () => {
  const { host, eng } = mk();
  eng.bgmPlay(0x1f, true); // TITLE.txt:14 play-bgm 1f（标题曲）
  await eng.idle();
  assert.deepEqual(host.loads, ['name:BGM031.OGG'], '曲号 31 ⇒ 文件名 BGM031.OGG');
  assert.equal(eng.debug().bgm!.name, 'BGM031.OGG');
  assert.equal(host.plays.at(-1)!.id, 0x1f, '诊断里仍记曲号');
});

test('BGM 文件名取不到 ⇒ 退回统一 id（兜底 + 留日志）', async () => {
  const { host, eng, logs } = mk({ missing: ['name:BGM031.OGG'] });
  eng.bgmPlay(0x1f, true);
  await eng.idle();
  assert.deepEqual(host.loads, ['name:BGM031.OGG', 'id:31'], '名字失败后退回老行为（按 id）');
  assert.ok(logs.some((l) => l.includes('退回按统一 id')), `应有兜底日志：${logs.join(' | ')}`);
});

test('0xBB 关 SE 会把在播的 SE 通道全部停掉', async () => {
  const { host, eng } = mk();
  eng.seLoad(46, 0);
  eng.seLoad(50, 1);
  await eng.idle();
  eng.sePlay(0, true);
  eng.sePlay(1, true);
  assert.equal(host.active.length, 2);
  eng.setEnabled('se', false); // i0bb 0
  assert.equal(host.active.length, 0, '关总线 = 通道全停（引擎 sub_408D90 对 0..9 逐个 sub_4B60C0）');
});

test('语音与 BGM 重叠：策略打开时压低 BGM，语音收尾后恢复', async () => {
  const { host, eng } = mk({ durations: { 162: 0.2 } });
  eng.setPolicy(true, true); // set:KeepMusicVolume=1 + sound:MusicFadeOnVoicePlaying=1
  eng.bgmPlay(18, true);
  await eng.idle();
  const bgm = host.plays.at(-1)!;
  const full = bgm.gain;
  eng.voicePlay(0, 162, false);
  await eng.idle();
  eng.tick(100, false);
  assert.ok(bgm.gain < full, `语音在播 ⇒ BGM 被压低（${bgm.gain} < ${full}）`);
  eng.tick(400, false); // 语音 0.2s 收尾
  assert.equal(bgm.gain, full, '语音收尾 ⇒ 恢复');
});

test('策略关闭时不压低（默认行为）', async () => {
  const { host, eng } = mk({ durations: { 162: 5 } });
  eng.bgmPlay(18, true);
  await eng.idle();
  const bgm = host.plays.at(-1)!;
  const full = bgm.gain;
  eng.voicePlay(0, 162, false);
  await eng.idle();
  eng.tick(100, false);
  assert.equal(bgm.gain, full, '未开策略 ⇒ BGM 不受语音影响');
});

// ==================== 音量（0xC5/0xC6/0xC7 的落地端） ====================

test('0xC6 音量：主音量与分总线各自乘进增益', async () => {
  const { host, eng } = mk();
  eng.seLoad(46, 0);
  await eng.idle();
  eng.sePlay(0, true);
  const p = host.plays.at(-1)!;
  assert.equal(p.gain, 1, '全 10000 ⇒ 增益 1');
  eng.setVolume(0, 5000); // sound:Volume0（主）
  assert.equal(p.gain, 0.5);
  eng.setVolume(2, 5000); // sound:Volume2（SE）
  assert.equal(p.gain, 0.25, '主 × SE = 0.25');
  assert.ok(p.gainHistory.length >= 3, '每次设音量都下发到在播的通道');
});

test('0xC6 类别越界不写（引擎 sprintf("setVolume") 报错分支）', () => {
  const { eng, logs } = mk();
  eng.setVolume(9, 100);
  assert.ok(logs.some((l) => l.includes('类别越界')));
});

// ==================== 缓存 / 流式 / 帧泵噪声 ====================

test('解码缓存按 id 复用（同通道走快路径、换通道走缓存，都只 decode 一次）', async () => {
  const { host, eng } = mk();
  for (let i = 0; i < 2; i++) {
    eng.voicePlay(0, 162, false);
    await eng.idle();
  }
  assert.equal(host.decodes.filter((id) => id === 162).length, 1, '同通道重播不重新解码');
  eng.voicePlay(1, 162, false); // 换通道 ⇒ 会走 #ensureClip（但应命中缓存）
  await eng.idle();
  assert.equal(host.decodes.filter((id) => id === 162).length, 1, '换通道也复用已解码的 clip');
  assert.equal(eng.debug().cache.hits, 1, '缓存命中计数');
  assert.equal(eng.debug().cache.misses, 1);
});

test('缓存超预算会淘汰（LRU 保留最近用过的）', async () => {
  const { host, eng } = mk({ cacheBytes: 3000 });
  for (const id of [1, 2, 3, 4]) {
    host.log(`--${id}`);
    eng.seLoad(id, 0);
    await eng.idle();
  }
  assert.ok(eng.debug().cache.bytes <= 3000 + 4096, `缓存应有界（当前 ${eng.debug().cache.bytes}）`);
  assert.ok(eng.debug().cache.clips < 4, '超预算后不会把全部保留');
});

test('宿主支持流式时 BGM 走 <audio>（不 decode），SE/语音仍走字节+解码', async () => {
  const { host, eng } = mk({ streaming: true });
  eng.bgmPlay(18, true);
  eng.seLoad(46, 0);
  await eng.idle();
  assert.equal(host.streams.length, 1, 'BGM 走流式');
  assert.equal(host.streams[0]!.url, 'amayui-audio://audio/BGM018.OGG', 'BGM 传文件名（曲号 → BGM%03d.OGG）');
  assert.deepEqual(host.decodes, [46], '只有 SE 走了解码（BGM 不占 PCM 内存）');
});

test('取字节/解码失败只记日志，不抛（引擎同级失败是 ShowMessage 异常，这里降级为静音）', async () => {
  const { host, eng, logs } = mk({ missing: [7] });
  eng.seLoad(7, 0);
  await eng.idle();
  assert.equal(host.plays.length, 0);
  assert.ok(logs.some((l) => l.includes('取字节失败')));
});
