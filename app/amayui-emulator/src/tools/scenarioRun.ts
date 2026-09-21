/**
 * **headless Scenario 跑手**（`tickets/T-0005` 的 B5）：跑一份 `ScenarioSpec`，可选把轨迹录下来。
 *
 * 用法：
 * ```bash
 * npm run scenario -- --scenario tools/scenarios/gamestart.json
 * npm run scenario -- --scenario tools/scenarios/gamestart.json --out .tmp/gamestart-headless.jsonl
 * ```
 * 它和 `tools/record.cjs`（Electron 跑手）**跑的是同一份 spec**：
 *  - 相同：`name` / `boot.script` / `clock` 策略 / `gates` / `maxFrames` / `events`（`atMs`/`atFrame` 同义；
 *    `afterMarker` 在 Electron 侧看日志标记、在这里看 `e.curScript().name` —— 同一个谓词的两种观测）；
 *  - 不同：`clock: {kind:'wall'}` 只有 Electron 能跑（它才有墙钟）。这里若 spec 写 wall，会按
 *    `--frame-ms`（缺省 1000/60）当**固定步长**跑并在输出里明确标注是近似。
 *
 * ★"两宿主等价"的正式判据是 **G3**（`npm run replay`：Electron 录的时钟+输入 → headless 复现同一
 * digest 序列），不是本命令。本命令是"同一个 Scenario 也能在 headless 里跑"的跑手（B5 验收 1）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootHeadless } from './scenarioBoot.js';
import { parseScenarioSpec, runScenario, type ScenarioSpec } from '../frame/scenario.js';
import { DigestCollector, mergeObservers, type FrameObserver } from '../frame/observer.js';
import { TraceRecorder } from '../frame/trace.js';
import { describeEmulatorOptions, loadEmulatorOptions } from '../emulatorOptionsFile.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function argOf(name: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt;
}

async function main(): Promise<void> {
  const specPath = argOf('scenario');
  if (!specPath) {
    console.error(
      '用法：npm run scenario -- --scenario <spec.json> [--out <trace.jsonl>] [--frame-ms N]\n' +
        '  路径基准：两者都按 **cwd** 解析（在包目录下跑时，示例里的 `tools/scenarios/…` 与 `.tmp/…` 都指包内）；\n' +
        '  起跑时会打印 `[paths] --out = <绝对路径>`。Electron 跑手（record/shot）则按**仓库根**解析并校验越界。',
    );
    process.exitCode = 2;
    return;
  }
  const raw = JSON.parse(fs.readFileSync(specPath, 'utf8')) as Partial<ScenarioSpec>;
  const wallApprox = typeof raw.clock === 'object' && raw.clock !== null && (raw.clock as { kind?: string }).kind === 'wall';
  const frameMs = Number(argOf('frame-ms', String(1000 / 60)));
  if (wallApprox) raw.clock = { kind: 'fixed', stepMs: frameMs }; // Electron 的墙钟在 headless 里没有意义
  const spec = parseScenarioSpec(JSON.stringify(raw));

  // ★外置选项必须在**装载脚本之前**读进来（`SYSTEM4` 开头就查 `boot.showLogo`）：headless 跑手与
  //   Electron 跑手必须看**同一份** `emulator.config.json`，否则从第一帧起就是两条路径
  //   （实测：默认值 true 会去播 LOGO/版权页，而本机配置是 false ⇒ 脚本轨迹完全不同）。
  const options = loadEmulatorOptions(REPO_ROOT);
  for (const l of describeEmulatorOptions(options)) console.log(l);

  const boot = await bootHeadless({
    ...(spec.boot?.script !== undefined ? { script: spec.boot.script } : {}),
    emulatorOptions: options.options,
    log: (m) => {
      if (/^\[(config|save|options|music|boot)\]/.test(m)) console.log(m);
    },
  });
  console.log(
    `[scenario] ${spec.name}：脚本 ${boot.bootScript}，时钟 ${spec.clock.kind}` +
      (wallApprox ? `（wall ⇒ 近似为固定 ${frameMs.toFixed(3)}ms/帧）` : '') +
      `，事件 ${spec.events.length} 条`,
  );

  const collector = new DigestCollector();
  const outPath = argOf('out');
  // ★`tickets/T-0032`（第 4 条：示例路径基准要说清）：本跑手的 `--scenario`/`--out` 都按 **cwd** 解析
  //   （与两个 Electron 跑手 `record.cjs`/`shot.cjs` 的"仓库根 + 前置校验"**不同** —— 那两份走
  //   `tools/paths.cjs`）。这里不搬基准（会改产物落点），但**把最终绝对路径打出来**，
  //   让"基准是哪个"永远不用猜；越界的 mkdir 也只会在本进程里报 ENOENT/EPERM 而不会拉死 Electron。
  if (outPath) console.log(`[paths] --out = ${path.resolve(outPath)}（基准 = cwd ${process.cwd()}）`);
  const recorder = outPath
    ? new TraceRecorder({
        scenario: spec.name,
        script: spec.boot?.script ?? 0,
        write: (l) => fs.appendFileSync(outPath, l + '\n'),
        // 纹理尺寸答案也录进轨迹（回放侧要把它们喂回去；见 `TraceFrame.tex`）。
        drainTextureSizes: () => boot.scene.drainTextureSizeLog(),
        ...(spec.maxStepsPerFrame !== undefined || spec.gates
          ? { policy: { ...(spec.maxStepsPerFrame !== undefined ? { maxStepsPerFrame: spec.maxStepsPerFrame } : {}), ...(spec.gates ? { gates: spec.gates } : {}) } }
          : {}),
        note: 'headless scenario run',
      })
    : null;
  if (outPath && recorder) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, '');
    recorder.start();
  }
  const observers: FrameObserver[] = [collector];
  if (recorder) observers.push(recorder);

  const result = await runScenario({ e: boot.e, host: boot.host, spec, observer: mergeObservers(...observers) });
  console.log(
    `[scenario] 结束：${result.frames} 帧 / ${result.steps} 步 / stop=${result.stopReason}；digest ${collector.digests.length} 份`,
  );
  const drops = boot.drops.list();
  if (drops.length) {
    console.log(`[scenario] 宿主未实现调用 ${drops.length} 类（闸门 A）：${drops.map((d) => `${d.method}×${d.count}`).join(' ')}`);
  }
  if (outPath) console.log(`[scenario] 轨迹 → ${outPath}`);
  process.exitCode = 0;
}

void main();
