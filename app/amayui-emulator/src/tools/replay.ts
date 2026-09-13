/**
 * **G3 回放跑手**（`tickets/T-0004` 验收 4 / `T-0005` 验收 2）：把 Electron 录的轨迹在 headless 复现。
 *
 * ```bash
 * npm run replay .tmp/gamestart-electron.jsonl            # 逐帧比对 engine 段
 * npm run replay .tmp/gamestart-electron.jsonl --limit 600
 * npm run replay .tmp/x.jsonl --out .tmp/x-replay.jsonl   # 顺带录一份回放轨迹
 * ```
 * 判据（设计文档 §4 的 G3）：**同一份 Scenario + 录下来的时钟 + 录下来的输入 ⇒ 逐帧 digest 的
 * `engine` 段相等**。`host` 段不参与（宿主义务履行量天然不同）。
 *
 * 退出码：0 = 全等；1 = 有差异（打印首帧与首帧的各字段差异）；2 = 用法/文件错误。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { bootHeadless } from './scenarioBoot.js';
import { parseTrace, runReplay, TraceRecorder } from '../frame/trace.js';
import { mergeObservers, type FrameObserver } from '../frame/observer.js';
import { emulatorOptionsOf } from '../emulatorOptionsFile.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function argOf(name: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt;
}

async function main(): Promise<void> {
  const tracePath = process.argv.slice(2).find((a) => !a.startsWith('--') && a !== argOf('out') && a !== argOf('limit'));
  if (!tracePath) {
    console.error('用法：npm run replay <trace.jsonl> [--limit N] [--out <replay.jsonl>] [--audio]');
    process.exitCode = 2;
    return;
  }
  if (!fs.existsSync(tracePath)) {
    console.error(`找不到轨迹文件：${tracePath}`);
    process.exitCode = 2;
    return;
  }
  const limit = Number(argOf('limit', '0'));
  const raw = fs.readFileSync(tracePath);
  // 录制侧（Electron）写的是 **gzip**（每帧约 12KB ⇒ 纯文本几十 MB）；headless `--out` 写纯文本。
  // 按魔数判断（而不是扩展名）——文件名是人起的，魔数才是事实。
  const isGz = raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b;
  const text = isGz ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  const all = parseTrace(text);
  const frames = limit > 0 ? all.frames.slice(0, limit) : all.frames;
  if (frames.length === 0) {
    console.error('轨迹里没有任何 frame 行');
    process.exitCode = 2;
    return;
  }
  console.log(
    `[replay] ${tracePath}${isGz ? '（gzip）' : ''}：scenario=${all.header?.scenario ?? '(无头)'} 帧=${frames.length}` +
      `${limit > 0 && all.frames.length > limit ? `（截取前 ${limit} / 共 ${all.frames.length}）` : ''}`,
  );

  const boot = await bootHeadless({
    script: all.header?.script ?? 0,
    audio: process.argv.includes('--audio'),
    // ★与录制侧看同一份 `emulator.config.json`（`boot.showLogo` 会改变启动路径 ⇒ 必须同源）。
    emulatorOptions: emulatorOptionsOf(REPO_ROOT),
    log: (m) => {
      if (/^\[(config|save|options|music|boot)\]/.test(m)) console.log(m);
    },
  });

  const outPath = argOf('out');
  let recorder: TraceRecorder | null = null;
  if (outPath) {
    fs.mkdirSync(outPath.replace(/[\\/][^\\/]*$/, ''), { recursive: true });
    fs.writeFileSync(outPath, '');
    recorder = new TraceRecorder({
      scenario: `${all.header?.scenario ?? 'replay'}-replayed`,
      script: all.header?.script ?? 0,
      write: (l) => fs.appendFileSync(outPath!, l + '\n'),
      ...(all.header?.policy ? { policy: all.header.policy } : {}),
      note: `headless replay of ${tracePath}`,
    });
    recorder.start();
  }
  const extra: FrameObserver[] = [];
  if (recorder) extra.push(recorder);

  const r = await runReplay({
    e: boot.e,
    host: boot.host,
    header: all.header,
    frames,
    // ★把录下来的 `0x208`（纹理尺寸）答案喂回 headless 宿主：它是**宿主输入**（依赖加载状态），
    //   不是引擎语义 —— 见 `TraceFrame.tex` 与 `HeadlessScene.setTextureSizeAnswers`。
    restoreHostInput: (rec) => boot.scene.setTextureSizeAnswers(rec?.tex ?? []),
    ...(extra.length ? { observer: mergeObservers(...extra) } : {}),
  });

  const same = r.ok;
  if (same) {
    console.log(
      `[replay] ✅ engine 段逐帧相等（比对 ${r.compared} 帧；录制 ${r.counts.recorded} / 回放 ${r.counts.replayed}` +
        `${r.extraFrames > 0 ? `，回放多跑 ${r.extraFrames} 帧（未比对）` : ''}）`,
    );
  } else {
    console.error(
      `[replay] ❌ 不一致：首帧 ${r.firstDiffFrame}（录制 ${r.counts.recorded} 帧 / 回放 ${r.counts.replayed} 帧）` +
        `，不一致帧 ${r.diffFrames.length}${r.diffFrames.length >= 20 ? '+' : ''} 个：${r.diffFrames.slice(0, 20).join(',')}`,
    );
    for (const d of r.firstDiff) console.error(`  - ${d}`);
  }
  if (outPath) console.log(`[replay] 回放轨迹 → ${outPath}`);
  process.exitCode = same ? 0 : 1;
}

void main();
