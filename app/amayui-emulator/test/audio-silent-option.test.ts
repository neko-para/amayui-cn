/**
 * `T-0103` 需求守卫：**禁用所有音频实际播放的开关**（`emulator.config.json` 的 `audio.enabled`
 * + 命令行/环境变量 `AMAYUI_AUDIO_ENABLED`）。
 *
 * ## 它到底关掉什么（写清楚，免得以后有人把它当"关掉音频子系统"用）
 * **关掉的是宿主输出**：`WebAudioHost` 不建 `AudioContext`、不起播、不建 `<audio>`、不做流式。
 * **引擎侧照跑**：`AudioEngine` 的通道/延迟播/语音仲裁/BGM 淡变仍然按真宿主同一套规则推进
 * （`decode` 改为**从容器头读精确时长** ⇒ "语音占线/SE 通道何时释放"的判据不变）
 * ⇒ digest / 场景报告不受影响 —— 这是"开关只影响怎么跑、不影响语义"的硬要求。
 *
 * ## 本守卫锁六件事
 *  ① 解析：`{"audio":{"enabled":false}}` 生效；未知键 `audio.xxx` 报 problem；
 *  ② 宽松输入与合并：`normalizeEmulatorOptions` 补全、`mergeEmulatorOptions` 让覆盖优先；
 *  ③ **命令行优先于文件**：`applyEnvOverrides`（接受 0/1/true/false/on/off/yes/no；认不出**不猜**、留 problem 行）；
 *  ④ `loadEmulatorOptions` 真的把环境变量套上（用显式 env 对象，不依赖本机环境）；
 *  ⑤ **静音宿主的行为**：不建 context（工厂抛错也不被调用）、`decode` 给得出时长、`play` 回可停/可调/可问位置的句柄、
 *     `streamUrl` 返回 undefined、`resume()` 不碰 context；
 *  ⑥ 测试的**默认口径**：`test/options.test.env` 里必须有 `AMAYUI_AUDIO_ENABLED=0`（否则"测试默认静音"只是口头约定）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUDIO_ENABLED_ENV,
  DEFAULT_EMULATOR_OPTIONS,
  applyEnvOverrides,
  envOverridesOf,
  mergeEmulatorOptions,
  normalizeEmulatorOptions,
  parseBoolish,
  parseEmulatorOptions,
} from '../src/emulatorOptions.js';
import { loadEmulatorOptions } from '../src/emulatorOptionsFile.js';
import { WebAudioHost } from '../src/renderer/audio/webAudioHost.js';
import type { AudioClip, PlayOptions } from '../src/audio/audioEngine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const REPO = path.join(APP, '..', '..');

/** 造一段最小 WAV：`byteRate` = 44100×2ch×16bit/8 = **88200 B/s**，`data` = 44100 B ⇒ 时长 **0.5s**。 */
function tinyWav(dataBytes = 44100): Uint8Array {
  const b = new Uint8Array(44 + dataBytes);
  const put = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i);
  };
  const u32 = (o: number, v: number): void => {
    b[o] = v & 0xff;
    b[o + 1] = (v >> 8) & 0xff;
    b[o + 2] = (v >> 16) & 0xff;
    b[o + 3] = (v >>> 24) & 0xff;
  };
  put(0, 'RIFF');
  u32(4, 36 + dataBytes);
  put(8, 'WAVE');
  put(12, 'fmt ');
  u32(16, 16);
  u32(24, 44100); // sampleRate
  u32(28, 44100 * 2 * 1); // byteRate = rate × channels × bits/8 = 88200 B/s（⇒ 44100 B 的 data = 0.5s）
  put(36, 'data');
  u32(40, dataBytes);
  return b;
}

const PLAY: PlayOptions = { loop: false, gain: 0.5, pan: 0 };

test('★① 解析：`audio.enabled=false` 生效；未知键/类型错都报 problem（不静默）', () => {
  const ok = parseEmulatorOptions('{"audio":{"enabled":false}}');
  assert.equal(ok.options.audio.enabled, false, '显式 false 必须生效');
  assert.deepEqual(ok.problems, [], `不该有问题：${ok.problems.join(' | ')}`);

  const bad = parseEmulatorOptions('{"audio":{"enable":false}}');
  assert.equal(bad.options.audio.enabled, true, '未知键 ⇒ 保留默认（true）');
  assert.ok(bad.problems.some((p) => p.includes('audio.enable')), `未知键必须报：${bad.problems.join(' | ')}`);

  const wrong = parseEmulatorOptions('{"audio":{"enabled":"no"}}');
  assert.equal(wrong.options.audio.enabled, true, '类型不对 ⇒ 保留默认');
  assert.ok(wrong.problems.some((p) => p.includes('audio.enabled')), '类型不对必须报');
});

test('★② 宽松输入/合并：`normalize` 补全，`mergeEmulatorOptions` 让覆盖优先', () => {
  assert.equal(normalizeEmulatorOptions({ boot: { showLogo: false } }).audio.enabled, true, '半份输入 ⇒ 默认 true');
  assert.equal(DEFAULT_EMULATOR_OPTIONS.audio.enabled, true, '★默认必须是"出声"（真游戏行为）');

  const file = parseEmulatorOptions('{"audio":{"enabled":true},"boot":{"showLogo":false}}').options;
  const merged = mergeEmulatorOptions(file, { audio: { enabled: false } });
  assert.equal(merged.audio.enabled, false, '★覆盖优先于文件');
  assert.equal(merged.boot.showLogo, false, '未被覆盖的键保持文件值');
});

test('★③ 命令行覆盖：取值口径 + 认不出时**不猜**', () => {
  assert.equal(parseBoolish('0'), false);
  assert.equal(parseBoolish(' OFF '), false);
  assert.equal(parseBoolish('1'), true);
  assert.equal(parseBoolish('Yes'), true);
  assert.equal(parseBoolish('maybe'), undefined, '认不出必须是 undefined（不猜）');

  const opts = normalizeEmulatorOptions({ audio: { enabled: true } });
  const lines = applyEnvOverrides(opts, { [AUDIO_ENABLED_ENV]: '0' });
  assert.equal(opts.audio.enabled, false, '★环境变量覆盖文件');
  assert.ok(lines.some((l) => l.includes('环境变量覆盖')), `要留一行生效说明：${lines.join(' | ')}`);

  const opts2 = normalizeEmulatorOptions({ audio: { enabled: false } });
  const lines2 = applyEnvOverrides(opts2, { [AUDIO_ENABLED_ENV]: 'nonsense' });
  assert.equal(opts2.audio.enabled, false, '认不出 ⇒ 保留原值');
  assert.ok(lines2.some((l) => l.includes('认不出')), `要留一行 problem：${lines2.join(' | ')}`);

  assert.deepEqual(envOverridesOf({}), {}, '没设环境变量 ⇒ 没有覆盖');
  assert.deepEqual(envOverridesOf({ [AUDIO_ENABLED_ENV]: '0' }), { audio: { enabled: false } }, '结构化传递（Electron 主→渲染）');
});

test('★④ 文件 + 环境变量：`loadEmulatorOptions` 真的套上（显式 env，不依赖本机环境）', () => {
  const dir = fs.mkdtempSync(path.join(APP, '.tmp-audioopt-'));
  const cfg = path.join(dir, 'emulator.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ audio: { enabled: true }, boot: { showLogo: false } }), 'utf8');
  try {
    const env = { AMAYUI_EMULATOR_CONFIG: cfg, [AUDIO_ENABLED_ENV]: '0' };
    const loaded = loadEmulatorOptions(REPO, env);
    assert.equal(loaded.exists, true, '配置文件应被读到');
    assert.equal(loaded.options.audio.enabled, false, '★环境变量 > 文件里的 true');
    assert.ok(loaded.envApplied.length >= 1, '要留一行生效说明');
    assert.equal(loaded.options.boot.showLogo, false, '文件里的其它键照旧生效');

    const noEnv = loadEmulatorOptions(REPO, { AMAYUI_EMULATOR_CONFIG: cfg });
    assert.equal(noEnv.options.audio.enabled, true, '没有环境变量 ⇒ 用文件值');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('★⑤ 静音宿主：不建 AudioContext、不起播、不建 <audio>；引擎侧要的时长/位置照给', async () => {
  const logs: string[] = [];
  let ctxMade = 0;
  const host = new WebAudioHost({
    silent: true,
    log: (m) => logs.push(m),
    createContext: () => {
      ctxMade++;
      throw new Error('静音模式不得创建 AudioContext');
    },
  });

  assert.equal(host.silent, true);
  assert.equal(host.info().contextState, 'silent', 'info 要能看出是静音');
  assert.equal(host.info().streamEnabled, false, '静音模式不启用流式');
  host.resume(); // 不得抛、不得建 context
  assert.equal(ctxMade, 0, '★resume 也不得建 AudioContext');

  const clip = await host.decode(7, tinyWav());
  assert.ok(clip, '静音模式仍要给得出 clip（引擎靠它的时长判"语音占线/SE 释放"）');
  assert.ok(
    Math.abs((clip as AudioClip).durationSec - 0.5) < 0.001,
    `时长应从容器的 byteRate/data 算出 0.5s（实得 ${(clip as AudioClip).durationSec}）`,
  );
  assert.equal(ctxMade, 0, '★decode 不得建 AudioContext');

  const pb = host.play(clip as AudioClip, PLAY);
  assert.equal(host.silentPlayCount, 1, '起播应被记账');
  assert.equal(ctxMade, 0, '★play 不得建 AudioContext');
  pb.setGain(0.25);
  pb.setPan(-0.5);
  pb.setLoop(true);
  assert.doesNotThrow(() => pb.setPaused?.(true));
  const pos = pb.positionSec?.();
  assert.ok(typeof pos === 'number' && pos >= 0, `句柄要给得出位置（实得 ${String(pos)}）`);
  assert.doesNotThrow(() => pb.stop());

  assert.equal(host.streamUrl({ id: 46 }), undefined, '静音模式不假装能流式 ⇒ 引擎退回解码路径');
  assert.ok(
    logs.some((l) => l.includes('静音模式')),
    `必须留一行"静音模式"日志（E4 归因靠它）：${logs.join(' | ')}`,
  );
});

test('★⑤ 反面：非静音宿主**会**建 context（证明上面的门是真的），且运行期 `setSilent(true)` 会关掉它', () => {
  let closed = 0;
  const fakeCtx = {
    state: 'running',
    sampleRate: 48000,
    currentTime: 0,
    destination: {},
    resume: async () => undefined,
    close: async () => {
      closed++;
    },
  } as unknown as AudioContext;
  const host = new WebAudioHost({ log: () => {}, createContext: () => fakeCtx });
  assert.equal(host.silent, false);
  host.resume(); // 建 context
  assert.equal(host.info().contextState, 'running', '非静音 ⇒ 真的建了 context');

  host.setSilent(true);
  assert.equal(closed, 1, `切静音必须关闭既有 context（否则"静音"只是不再新建）；close 应被调用一次（实得 ${closed}）`);
  assert.equal(host.info().contextState, 'silent');
});

test('★⑥ 测试默认口径：`test/options.test.env` 必须把音频关掉（并用 --env-file 引入）', () => {
  const envFile = fs.readFileSync(path.join(APP, 'test', 'options.test.env'), 'utf8');
  assert.match(envFile, /^AMAYUI_AUDIO_ENABLED=0$/m, '★测试必须默认静音（tickets/T-0103 的要求）');
  const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  assert.match(pkg.scripts['test'] ?? '', /--env-file=test\/options\.test\.env/, '环境必须由命令行显式引入（--env-file）');
});
