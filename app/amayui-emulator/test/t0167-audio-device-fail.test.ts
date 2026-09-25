/** @tier T0 @kind ratchet @subsystem audio */

/**
 * ★**音频「设备创建失败」档**（审计 §4.2 #35 `audio-device-init` 的 `missing-behavior`；票 `T-0167`）。
 *
 * ## 引擎是这样（raw 逐行）
 * `sub_406CE0`（raw 12011-12039）在 `sound:UseDirect == 1` 时走
 * `sub_4B5C50`（raw 138380 惰性 `LoadLibrary("DSOUND.DLL")`）→ `sub_4B5CF0`（raw 138415 `DirectSoundCreate`）。
 * `sub_4B5CF0(...) != 1`（设备建不起来）时 raw 12028-12036 逐字：
 * ```c
 * v6 = MessageBoxA(hWnd, Text, aDirectsound, 0x41u);   // 弹一条提示
 * _this[174801] &= ~0x1000000u;                        // 清 effect_flags 的 bit24
 * if ( v6 == 1 ) SetConfig("sound:Sound", 0);          // 玩家点了 OK ⇒ 把该配置键写 0
 * _this[5010] = 1;                                     // Engine+20040（本反编译内只写不读，raw 12035）
 * ```
 * `sub_4B5CF0` 内部的失败串 = raw 138463 `"ERROR dsCreat:オブジェクトの生成に失敗しました． %s\r\n"`
 * ⇒ **此后一切通道调用早退 = 静默降级**：引擎不崩、不抛，只是没有声音。
 *
 * ## emulator 修前
 * `WebAudioHost.#ensureCtx()` 直接 `new AudioContext()` / `createContext()`，**不接异常**
 * ⇒ 设备不可用时异常从 `play()`/`decode()` 抛进 `AudioEngine` 与帧循环 —— 这是引擎里**不存在**的硬失败。
 * （`audio.enabled=false` 的「显式静音档」不是这一档：它不弹、不改键、也不去建设备。）
 *
 * ## 本文件钉三件事
 *  1. 设备创建失败 ⇒ `play()` **不抛**、回一个可问位置/可停/可调音量的记账句柄（引擎侧状态机不断），
 *     并留下**同一句**失败串（E4 归因靠它）；
 *  2. 失败档**粘住**：不再重试建设备；`decode()` 回 `null`、`streamUrl()` 不假装能流式（= 引擎的早退口径）；
 *  3. 反面：设备正常 ⇒ `deviceFailed === false`、`contextState === 'running'`
 *     （证明上面那道门真的在判设备，不是恒真的摆设）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebAudioHost } from '../src/renderer/audio/webAudioHost.js';
import { must } from './harness.js';
import type { AudioClip, AudioPlayback, PlayOptions } from '../src/audio/audioEngine.js';

const PLAY: PlayOptions = { loop: false, gain: 0.5, pan: 0 };
/** 记账路径只要 `id/durationSec`：设备失败档在**解码之前**就早退了（引擎同样早退）。 */
const CLIP: AudioClip = { id: 7, durationSec: 0.5, bytes: 44100 };

test('★① 设备创建失败 ⇒ `play()` 不抛、回记账句柄、留引擎同文失败串', () => {
  const logs: string[] = [];
  let made = 0;
  const host = new WebAudioHost({
    log: (m) => logs.push(m),
    createContext: () => {
      made++;
      throw new Error('no audio device');
    },
  });

  let pb: AudioPlayback | undefined;
  assert.doesNotThrow(() => {
    pb = host.play(CLIP, PLAY);
  }, '★引擎在设备失败时是**静默降级**，不允许把异常抛给帧循环');

  assert.equal(made, 1, '应尝试建过一次设备');
  assert.equal(host.info().deviceFailed, true, '★失败档必须可观测（info().deviceFailed）');
  assert.ok(
    logs.some((l) => l.includes('オブジェクトの生成に失敗しました')),
    `必须留引擎同文的失败串（raw 138463）：${logs.join(' | ')}`,
  );
  assert.ok(
    logs.some((l) => l.includes('no audio device')),
    `失败原因要带上（宿主自己的 message）：${logs.join(' | ')}`,
  );

  const h = must(pb, '记账句柄');
  assert.doesNotThrow(() => {
    h.setGain(0.25);
    h.setPan(-0.5);
    h.setLoop(true);
    h.setPaused?.(true);
  }, '失败档的句柄仍要能被引擎调（否则引擎侧状态机会与真宿主分叉）');
  const pos = h.positionSec?.();
  assert.ok(typeof pos === 'number' && pos >= 0, `句柄要给得出位置（实得 ${String(pos)}）`);
  assert.doesNotThrow(() => h.stop());
});

test('★② 失败档粘住：不再重试建设备；`decode` 回 null；`streamUrl` 不给 URL', async () => {
  let made = 0;
  const host = new WebAudioHost({
    silent: false,
    streamBase: 'amayui-audio://',
    log: () => {},
    createContext: () => {
      made++;
      throw new Error('device gone');
    },
  });

  host.play(CLIP, PLAY);
  host.resume();
  const clip = await host.decode(7, new Uint8Array([1, 2, 3, 4]));
  assert.equal(made, 1, `★失败档粘住 ⇒ 不再重试建设备（引擎失败后通道一律早退）；实得 ${made}`);
  assert.equal(clip, null, 'decode 在失败档必须回 null（等价于"这次解码没成功"）');
  assert.equal(
    host.streamUrl({ id: 46 }),
    undefined,
    '★失败档不假装能流式 —— 与 `play`/`decode` 同一口径（引擎失败后**所有**通道早退）',
  );
  assert.equal(host.info().streamEnabled, false);
});

test('★③ 反面：设备正常 ⇒ `deviceFailed === false`、`contextState === running`', () => {
  const fakeCtx = {
    state: 'running',
    sampleRate: 48000,
    currentTime: 0,
    destination: {},
    resume: async () => undefined,
    close: async () => undefined,
  } as unknown as AudioContext;
  const host = new WebAudioHost({ log: () => {}, createContext: () => fakeCtx });
  host.resume();
  assert.equal(host.info().deviceFailed, false, '设备正常时不许误报失败档');
  assert.equal(host.info().deviceError, null, '设备正常时不应有失败原因');
  assert.equal(host.info().contextState, 'running');
});
