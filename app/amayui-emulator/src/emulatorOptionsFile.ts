/**
 * **外置选项文件的读取**（node-only）—— 纯解析在 `emulatorOptions.ts`。
 *
 * 为什么要分开：渲染进程按 esbuild `platform: 'browser'` 打包，**不能** import `node:fs`；
 * 所以渲染侧走 Electron 主进程 IPC 拿文本（`electron/ipc/files.ts` 的 `read-emulator-options`），
 * 再交给 `parseEmulatorOptions`。本模块只给 Node 入口（`run.ts` / `report.ts` / CLI 工具）用。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  applyEnvOverrides,
  EMULATOR_OPTIONS_ENV,
  EMULATOR_OPTIONS_FILE,
  parseEmulatorOptions,
  type EmulatorOptions,
  type ParseEmulatorOptionsResult,
} from './emulatorOptions.js';
import { decideResourceDir, type ResourceDirDecision } from './arch/resourceDir.js';

/**
 * 解析选项文件路径：环境变量 `AMAYUI_EMULATOR_CONFIG`（绝对路径，或相对仓库根）优先，
 * 否则 `<仓库根>/emulator.config.json`。（与 `arch/resourceDir.ts` 的 `AMAYUI_RESOURCE_DIR` 同一套约定。）
 */
export function resolveOptionsPath(repoRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env[EMULATOR_OPTIONS_ENV];
  if (override && override.trim().length > 0) {
    return path.isAbsolute(override) ? override : path.join(repoRoot, override);
  }
  return path.join(repoRoot, EMULATOR_OPTIONS_FILE);
}

export interface LoadedEmulatorOptions extends ParseEmulatorOptionsResult {
  /** 实际查看的路径（无论是否存在）。 */
  path: string;
  /** 文件是否存在并读到了内容。 */
  exists: boolean;
  /** 读到的原文（仅 `exists=true` 时有）—— Electron 主进程靠它把同一份内容交给渲染进程，避免二次读盘。 */
  text?: string;
  /** 读文件本身失败时的原因（权限/目录等）；`exists=false` 时为 undefined。 */
  readError?: string;
  /**
   * **环境变量覆盖**的生效说明行（`AMAYUI_AUDIO_ENABLED` 等；`tickets/T-0103`）——
   * 空 = 这次运行没有覆盖。取值非法也会在这里留一行（`⚠ …`）。
   */
  envApplied: string[];
}

/**
 * 读 + 解析选项文件。**永不抛**：不存在 / 读不动 / 内容坏 ⇒ 默认值 + 说明。
 *
 * 不存在时 `problems` 为**空**（这是正常的"没配就用默认"），调用方据 `exists` 决定日志措辞。
 */
export function loadEmulatorOptions(repoRoot: string, env: NodeJS.ProcessEnv = process.env): LoadedEmulatorOptions {
  const p = resolveOptionsPath(repoRoot, env);
  let text: string;
  try {
    text = fs.readFileSync(p, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      const options = parseEmulatorOptions('').options;
      return { path: p, exists: false, options, problems: [], envApplied: applyEnvOverrides(options, env) };
    }
    const options = parseEmulatorOptions('').options;
    return {
      path: p,
      exists: false,
      options,
      problems: [`读取失败（${(err as Error).message}）⇒ 全用默认值`],
      readError: (err as Error).message,
      envApplied: applyEnvOverrides(options, env),
    };
  }
  const parsed = parseEmulatorOptions(text);
  // ★环境变量覆盖**在文件之后**（命令行优先于文件；`tickets/T-0103` 的 audio 开关就是靠这条）
  const envApplied = applyEnvOverrides(parsed.options, env);
  return { path: p, exists: true, text, ...parsed, envApplied };
}

/** 便捷：只要选项值（不关心路径/问题）。 */
export function emulatorOptionsOf(repoRoot: string, env: NodeJS.ProcessEnv = process.env): EmulatorOptions {
  return loadEmulatorOptions(repoRoot, env).options;
}

/**
 * **用已读到的选项文件决定资源根**（CLI / Electron 主进程用）—— 把 `resources.path` 接进
 * `decideResourceDir` 的第三档，且**相对基准 = 该 config 文件所在目录**（不是仓库根、不是 cwd）。
 *
 * ⚠️ 库入口（`runGameStartChain` 等）**不要**用它：那会让测试取决于开发机上的一个 JSON。
 * 它们用 `decideResourceDir` 显式传 `configResourcePath` + `configDir`，或干脆只认显式 `resourceDir`。
 */
export function resourceDirOf(
  loaded: LoadedEmulatorOptions,
  repoRoot: string,
  opt: { cli?: string; env?: NodeJS.ProcessEnv } = {},
): ResourceDirDecision {
  const cfg = loaded.options.resources.path;
  return decideResourceDir(repoRoot, {
    ...(opt.cli ? { cli: opt.cli } : {}),
    env: opt.env ?? process.env,
    ...(cfg ? { configResourcePath: cfg, configDir: path.dirname(loaded.path) } : {}),
  });
}

/** 一行式日志（存在/不存在 + 问题），供各入口直接打。 */
export function describeEmulatorOptions(loaded: LoadedEmulatorOptions): string[] {
  const lines: string[] = [];
  const defaults = `boot.showLogo=${loaded.options.boot.showLogo} resources.version=${loaded.options.resources.version} audio.enabled=${loaded.options.audio.enabled}`;
  if (!loaded.exists) {
    lines.push(`[options] 未找到 ${loaded.path}（用默认值：${defaults}）`);
  } else {
    lines.push(`[options] ${loaded.path}`);
  }
  for (const p of loaded.problems) lines.push(`[options] ⚠ ${p}`);
  // ★环境变量覆盖的生效说明（`tickets/T-0103` 的 audio 开关靠它可见：改了哪个值、来自哪个变量）
  for (const e of loaded.envApplied) lines.push(`[options] ${e}`);
  return lines;
}
