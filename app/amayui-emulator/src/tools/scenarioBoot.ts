/**
 * **headless 启动装配（G3 用）** —— 把 Electron 的 `renderer/app/boot.ts` 那套"跑脚本之前的状态"
 * 在 Node 侧照做一遍。
 *
 * 为什么必须照做（而不是像 `report.ts` 那样只读脚本）：digest 相等要求**初始引擎状态**也相等 ——
 *  - `SYS4REG.INI` → `Engine.config` + 引擎字段（配置门的真源；`SYSTEM4` 开头就读它）；
 *  - `emulator.config.json`（`boot.showLogo`）→ 决定 `SYSTEM4` 是否 `call-script LOGO`；
 *  - `SAVE.DAT`（`save-int`/`save-string` 表）→ `SYSTEM4.txt:71 load-int (global 5)` 的分支；
 *  - 音乐表（SYS4INI 尾部）→ `0x1D6/0x1D7/0x1D8` 的曲号解析。
 * 少做一步，回放就会在"脚本刚跑起来"的地方分叉（而那看起来会像是 VM 的 bug）。
 *
 * 与 `boot.ts` 的**刻意差异**（都要写清，不许沉默）：
 *  - 不读 `window.api`（Node 侧直接走 `NodeFileSource`；两边读的是**同一份** overlay/base）；
 *  - 不实现配置/存档**回写**（回放是只读观测；写了会污染玩家数据）；
 *  - 不预载图像、不建 Pixi（headless 无纹理；`0x208` 的答案见 `HeadlessOptions.imageSize`）。
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../vm/engine.js';
import { loadScriptData } from '../vm/interpreter.js';
import { DropRecorder, withNativeTap } from '../vm/nativeTap.js';
import { audioBootIntents } from '../vm/handlers/audio.js';
import { NodeFileSource } from '../arch/nodeFileSource.js';
import { decideResourceDir, describeResourcesLine } from '../arch/resourceDir.js';
import { resolveSystemPaths } from '../arch/systemPaths.js';
import { applyConfigToEngine, parseIni } from '../engineConfig.js';
import { DEFAULT_EMULATOR_OPTIONS, applyEmulatorOptionsToEngine, normalizeEmulatorOptions, type EmulatorOptions } from '../emulatorOptions.js';
import { HeadlessScene } from '../renderer/headlessScene.js';
import { headlessFrameHost } from '../renderer/headlessFrameHost.js';
import { NodeAudioHost } from '../audio/nodeAudioHost.js';
import type { FrameHost } from '../frame/host.js';
import type { InputManager } from '../vm/input.js';

export interface HeadlessBootOptions {
  /** 启动脚本索引（默认 0 = SYSTEM4.BIN；与 Electron 的 `boot.ts` 一致）。 */
  script?: number;
  /** 资源根（默认 `install/`；`AMAYUI_RESOURCE_DIR` 可换）。 */
  resourceDir?: string;
  /** 读玩家数据（`SYS4REG.INI` + `SAVE.DAT`）；缺省 **true**（与 Electron 一致）。 */
  system?: boolean;
  /** 外置选项（不给 = 默认值；CLI 入口才读文件，避免测试受开发机影响）。 */
  emulatorOptions?: EmulatorOptions;
  /** 音频宿主（给了 ⇒ headless 也有真 `AudioEngine`；缺省不给 ⇒ 音频意图被闸门 A 记成丢弃）。 */
  audio?: boolean;
  /** 图像尺寸解析器（`0x208` 的答案；不给 ⇒ 恒 0×0 并记缺口）。 */
  imageSize?: (imgid: number) => { w: number; h: number } | null;
  log?: (msg: string) => void;
}

export interface HeadlessBoot {
  e: Engine;
  scene: HeadlessScene;
  src: NodeFileSource;
  host: FrameHost;
  /** 未被宿主实现的调用（闸门 A）——"这个宿主缺哪些能力"的可数清单。 */
  drops: DropRecorder;
  /** 已装载的启动脚本名。 */
  bootScript: string;
  log: (msg: string) => void;
}

/** 建好引擎与宿主，但**不跑帧**（调用方自己用 `runScenario`/`runFrameLoop` 跑）。 */
export async function bootHeadless(o: HeadlessBootOptions = {}): Promise<HeadlessBoot> {
  const log = o.log ?? ((): void => {});
  const options = normalizeEmulatorOptions(o.emulatorOptions ?? DEFAULT_EMULATOR_OPTIONS);
  // 资源根：显式 `resourceDir` > `AMAYUI_RESOURCE_DIR` > `resources.path` > `install/`。
  // ★这里 `resources.path` 的相对基准取仓库根（选项不是本函数读来的 ⇒ 不知道 config 文件在哪）；
  //   从文件读选项的 CLI 入口请自己算好 `resourceDir` 再传进来（见 `emulatorOptionsFile.ts` 的 `resourceDirOf`）。
  const resourceDecision = decideResourceDir(REPO_ROOT, {
    ...(o.resourceDir ? { cli: o.resourceDir } : {}),
    env: process.env,
    ...(options.resources.path ? { configResourcePath: options.resources.path, configDir: REPO_ROOT } : {}),
  });
  log(`[options] ${describeResourcesLine(options, resourceDecision)}`);
  const resourceDir = resourceDecision.dir;
  const withSystem = o.system !== false;
  const src = new NodeFileSource({
    resourceDir,
    ...(withSystem ? { system: resolveSystemPaths(REPO_ROOT) } : {}),
    log,
  });
  const scene = new HeadlessScene({
    ...(o.imageSize ? { imageSize: o.imageSize } : {}),
    ...(o.audio ? { audioHost: new NodeAudioHost({ source: src, log }), onLog: log } : {}),
  });
  const engineRef: { e?: Engine } = {};
  const drops = new DropRecorder(() => engineRef.e?.currentOpcode ?? 0);
  const e = new Engine(withNativeTap(scene as object, drops) as HeadlessScene);
  engineRef.e = e;
  e.fileSource = src;
  // ★Live2D 运行态（T-0054）：槽/节点/动作三张表在 Engine 上，挂给场景宿主以便
  //   ① 帧末推进动作（scL2dTick，两宿主同一份）；② 快照能导出节点与出画判据。
  scene.scene.l2dHost = e;

  // ① SYS4REG.INI → config + 引擎字段（`boot.ts` 的同一步；只读，不回写）。
  const ini = withSystem ? await src.readConfig() : null;
  if (ini) {
    const cfg = parseIni(ini.text);
    e.config = cfg;
    applyConfigToEngine(cfg, e.engineValues);
    log(`[config] ${ini.path}（${ini.side}）键=${cfg.values.size} 个`);
  } else {
    log('[config] 没有 SYS4REG.INI（引擎字段用默认值）');
  }
  // ② 外置选项（必须在装载脚本之前：`SYSTEM4` 开头就查 `boot.showLogo`；`resources.version` 决定字体表）。
  for (const n of applyEmulatorOptionsToEngine(e, options)) log(`[options] ${n}`);
  // ③ SAVE.DAT（`save-int`/`save-string` 表；同样必须在 `loadScriptData` 之前）。
  if (withSystem) {
    const bytes = await e.fileSource?.readSaveData?.();
    if (bytes) {
      const { decodeSaveData, mergeSaveDataFallbacks } = await import('../save/saveData.js');
      const r = decodeSaveData(bytes);
      if (r.ok) {
        // ★按 key 并表（`tickets/T-0069`）：overlay 那份可能缺**按槽**的记录（标题/状态/日期）
        const both = await e.fileSource?.readSaveDataBoth?.();
        const m = mergeSaveDataFallbacks(r.data.tables, (both ?? []).slice(1), log);
        e.applySaveDataTables(m.tables);
        const merged = await e.fileSource?.readSaveFlags?.();
        const flags = merged && merged.length > 0 ? merged : [...r.data.usage.usedFileIds];
        e.setUsedFileIds(flags);
        log(`[save] ${r.data.tables.ints.size} 个 int / ${r.data.tables.strings.size} 个 string，已使用文件 ${flags.length} 个`);
      } else {
        log(`[save] 无法解析 SAVE.DAT：${r.reason}`);
      }
    } else {
      log('[save] 无 SAVE.DAT（首次启动：走 INITCONFIG 分支）');
    }
  }
  // ④ 音频启动意图 + 音乐表（与 `boot.ts` 同序）。
  for (const intent of audioBootIntents(e.config)) scene.audio?.(intent);
  try {
    const music = await src.musicTables();
    e.musicTable = { other: music.other, base: music.base, groups: [] };
    log(`[music] 曲号表 ${e.musicTable.base.length} 条`);
  } catch (err) {
    log(`[music] 曲号表取得失败：${(err as Error).message}`);
  }
  // ⑤ 装载启动脚本。
  const index = o.script ?? 0;
  const boot = await src.readScript(index);
  if (!boot) throw new Error(`无法装载脚本索引 ${index}`);
  loadScriptData(e, boot.data, boot.name);
  log(`[boot] index ${index} -> ${boot.name}`);

  return { e, scene, src, host: headlessFrameHost(scene, () => e.nowMs), drops, bootScript: boot.name, log };
}

/** 仓库根（与 `run.ts`/`report.ts` 同口径：本文件在 `app/amayui-emulator/src/tools/`）。 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');