/**
 * **宿主服务（HostService）** —— 把原先活在 Electron 主进程 IPC 处理器里的"资源 / 玩家数据 / 诊断"
 * 逻辑抽成**传输中立、每实例一份**的 Node 服务（`tickets/T-0134` WS-3，设计来源 `tickets/T-0133` §B.3）。
 *
 * ## 为什么要它
 *
 * 重构前这些能力全是 `electron/ipc/files.ts` + `electron/logging.ts` 里的**模块级单例**：
 * `const fileSource = new NodeFileSource(…)`、`const systemFiles = new OverlayDir(…)`、
 * `let logAppender = …` —— 于是"一个进程 = 一个实例 = 一份日志/overlay"是白送的，但
 * "agent 调试时人能看到 / 多个调试会话并行"就不可能（两个实例会共用日志、存档互踩）。
 *
 * 本模块把那份逻辑**逐字搬**到这里，落点全部来自 `InstanceLayout`（`src/host/instance.ts`）：
 *
 * ```text
 * Electron 主进程  → defaultHostService({ repoRoot: REPO_ROOT })   （默认实例 = 现状路径）
 * 将来的 web/headless 宿主 → createHostService({ id, repoRoot, root })  （具名实例 = 全隔离）
 * ```
 *
 * ## 三条硬约束
 *  1. **零 `electron` import**：本文件只认 `node:*` 与 `src/*`（渲染/web/测试都能用）；
 *  2. **零行为变更**：每个方法都是 `electron/ipc/files.ts` 对应 handler 体的**逐字搬移**
 *     （同一份 fs/zlib/`NodeFileSource`/`OverlayDir`/`decodeAgfRgba`/`parseIni`/`unionUsedFileIds`/
 *      `envOverridesOf` 用法、同一个返回形状、同一批 `console.log('[main] …')` 文案 ——
 *      那些文案是别的票据的 E4 判据）；
 *  3. **不改 `process.env`**：`env` 只作为参数往下传（`resolveSystemPaths` / `loadEmulatorOptions`
 *     都收 env 参数）⇒ 多个实例可以并存。
 *
 * ★不在这里做的事：任何 `ipcMain` / `protocol` / `Response` / 窗口相关的东西留在 `electron/`；
 *   本模块只回答"读什么、写到哪、返回什么形状"。`electron/ipc/files.ts` 现在是一层薄委托。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

import { NodeFileSource } from '../arch/nodeFileSource.js';
import { OverlayDir, type OverlaySide } from '../arch/overlay.js';
import { INI_FILE, SAVE_DAT_REL } from '../arch/systemPaths.js';
import { describeResourcesLine, type ResourceDirDecision } from '../arch/resourceDir.js';
import { parseIni } from '../engineConfig.js';
import { envOverridesOf, type EmulatorOptionsInput } from '../emulatorOptions.js';
import {
  loadEmulatorOptions,
  resourceDirOf,
  type LoadedEmulatorOptions,
} from '../emulatorOptionsFile.js';
import { unionUsedFileIds } from '../save/saveData.js';
import type { MusicTables } from '../script/alf.js';
// 主进程/宿主跑 AGF 解码（Node 有 zlib/fs）。路径: src/host/ -> ../../../../ = 仓库根
import { decodeAgfRgba } from '../../../../scripts/agf/format.js';
import { instanceLayout, type InstanceLayout, type InstanceOptions } from './instance.js';

// ---------------------------------------------------------------------------
// 诊断落盘（原 `electron/logging.ts` 的三个 appender；关窗同步兜底见 `logSync`）
// ---------------------------------------------------------------------------

/** 一个只写的追加器。 */
export interface Appender {
  write(text: string): void;
}

/** 一个 gzip 追加器（`close()` 会结束 gzip 流并等它 flush 到磁盘）。 */
export interface GzAppender extends Appender {
  close(): Promise<void>;
}

/** 以追加模式打开一个非阻塞写入流；失败时退化为丢弃（不抛，避免影响启动）。 */
export function openAppender(p: string): Appender {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const s = fs.createWriteStream(p, { flags: 'a' });
    s.on('error', (err) => console.error(`[append] ${p}: ${err.message}`));
    return { write: (text: string) => void s.write(text.endsWith('\n') ? text : text + '\n') };
  } catch (err) {
    console.error(`[append] 打开失败 ${p}: ${(err as Error).message}`);
    return { write: () => {} };
  }
}

/**
 * 以 gzip 追加一个文件（大体积轨迹用）。**不做 `flags:'a'`**：gzip 是多成员流，追加虽然合法
 * （gunzip 会依次读所有成员），但"一次运行一个文件"更好 diff ⇒ 这里用 `'w'`（覆盖）。
 */
export function openGzAppender(p: string): GzAppender {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const file = fs.createWriteStream(p, { flags: 'w' });
    const gz = zlib.createGzip({ level: 6 });
    gz.pipe(file);
    file.on('error', (err) => console.error(`[append] ${p}: ${err.message}`));
    return {
      write: (text: string) => void gz.write(text.endsWith('\n') ? text : text + '\n'),
      close: () =>
        new Promise<void>((resolve) => {
          file.on('close', () => resolve());
          gz.end(); // 结束 gzip ⇒ 写尾部 ⇒ file 收到 end ⇒ close
        }),
    };
  } catch (err) {
    console.error(`[append] 打开 gzip 失败 ${p}: ${(err as Error).message}`);
    return { write: () => {}, close: () => Promise.resolve() };
  }
}

// ---------------------------------------------------------------------------
// HostService
// ---------------------------------------------------------------------------

/** `createHostService` 的入参：实例布局选项 + 资源根覆盖。 */
export interface HostServiceOptions extends InstanceOptions {
  /**
   * 资源根覆盖（`install/` / `raw/`）。缺省 ⇒ 沿用现状决策链：
   * `AMAYUI_RESOURCE_DIR` > `resources.path` > 默认 `install/`（见 `resourceDirOf`）。
   * Electron 侧显式传 `paths.ts` 的 `RESOURCE_DIR` ⇒ 与 `paths.ts` **同一份**（零行为变更）。
   */
  resourceDir?: string;
}

/** `HostService` 构造的上下文（工厂函数把 `HostServiceOptions` 拆成 layout + 这两个）。 */
export interface HostServiceContext {
  /** 仓库根（只用于 `res/fonts` 与 `emulator.config.json` 的解析；**不用 `__dirname` 猜**）。 */
  repoRoot?: string;
  /** 环境变量来源（缺省 `process.env`）；**只读**，本模块不改它。 */
  env?: NodeJS.ProcessEnv;
}

/**
 * 一个实例的宿主服务：**落点全来自 `layout`**，行为与重构前的 Electron IPC 逐字一致。
 */
export class HostService {
  /** 本实例的落点（base/overlay/log/trace/replay）。 */
  readonly layout: InstanceLayout;
  /** 生效的资源根（`install/` 或覆盖值）。 */
  readonly resourceDir: string;
  /** 内置字体目录（`font` 通道的白名单根）。 */
  readonly fontDir: string;

  /** 诊断日志（renderer 经 `log-line` 追加）。 */
  readonly log: Appender;
  /** 结构化指令轨迹（`append-trace-line`）。 */
  readonly trace: Appender;
  /** 回放轨迹（`append-replay-line`；gzip，退出前 `close()` 等 flush）。 */
  readonly replay: GzAppender;

  /** 主进程侧的资源读取；`log` 把「扩展包扫描/注册」等一次性诊断写进主进程日志。 */
  readonly #fileSource: NodeFileSource;
  /** 玩家数据的 overlay 层（`SYS4REG.INI` + `SAVE\SAVE.DAT` + 存档槽）。 */
  readonly #systemFiles: OverlayDir;

  readonly #repoRoot: string;
  readonly #env: NodeJS.ProcessEnv;
  /** 外置选项（`emulator.config.json`）**只读一次**（惰性：不碰它的实例不读盘）。 */
  #loaded: LoadedEmulatorOptions | null = null;
  /** 资源根决策（惰性；`resourceDir` 显式给出时不必算）。 */
  #decision: ResourceDirDecision | null = null;

  constructor(layout: InstanceLayout, resourceDir: string, ctx: HostServiceContext = {}) {
    this.layout = layout;
    this.resourceDir = resourceDir;
    this.#repoRoot = ctx.repoRoot ?? '';
    this.#env = ctx.env ?? process.env;
    this.fontDir = path.join(this.#repoRoot, 'res', 'fonts');

    // ★与重构前同一个构造顺序/同一套 log 回调（`[main] …` 前缀由这里加）。
    this.#fileSource = new NodeFileSource({
      resourceDir,
      system: { baseDir: layout.baseDir, overlayDir: layout.overlayDir },
      log: (m) => console.log(`[main] ${m}`),
    });
    this.#systemFiles = new OverlayDir(
      { baseDir: layout.baseDir, overlayDir: layout.overlayDir },
      { log: (m) => console.log(`[main] ${m}`) },
    );

    // 三个 appender 一律按**本实例的路径**建（每实例独立；这就是"日志不再串"的那一半）。
    this.log = openAppender(layout.logPath);
    this.trace = openAppender(layout.tracePath);
    this.replay = openGzAppender(layout.replayPath);
  }

  // ---- 诊断落盘 ----------------------------------------------------------

  /**
   * **关窗前的同步落尾**（`log-line-sync`）—— 必须同步、绝不排队：
   * `fs.appendFileSync` 一旦被 renderer 的高频日志打满，主进程会连"关窗"都做不了，
   * 所以只有这一条保留同步（其余走非阻塞 `WriteStream`）。
   */
  logSync(text: string): void {
    try {
      fs.appendFileSync(this.layout.logPath, text + '\n');
    } catch (err) {
      console.error(`[log-line-sync] ${(err as Error).message}`);
    }
  }

  /** 结束 gzip 回放流并等它 flush 到磁盘（`will-quit` 用；缺尾部 = 整份轨迹不可解）。 */
  async close(): Promise<void> {
    await this.replay.close();
  }

  /** 启动摘要：写清这次的 base/overlay 是哪两份目录、资源根/资源版本各是什么。 */
  logSystemPaths(): void {
    console.log(`[main] system dir (base) -> ${this.layout.baseDir}`);
    console.log(`[main] system dir (overlay) -> ${this.layout.overlayDir}`);
    console.log(`[main] ${describeResourcesLine(this.#options().options, this.#resourceDecision())}`);
  }

  // ---- 资源（只读） ------------------------------------------------------

  /** 读脚本（call-script 索引 -> 原始字节 + 文件名）。 */
  async readScript(index: number): Promise<{ index: number; name: string; data: number[] } | null> {
    const r = await this.#fileSource.readScript(index);
    if (!r) return null;
    return { index: r.index, name: r.name, data: Array.from(r.data) };
  }

  /**
   * 按**文件名**读一个脚本（读档时要按名装载 `CALLBACK_LOAD.BIN`，见 `tickets/T-0072`）。
   * 与 `readScript` 同一条读取路径，只是用名字换统一 id（引擎 `sub_455000(FileDB, name)`）。
   */
  async readScriptByName(name: string): Promise<{ index: number; name: string; data: number[] } | null> {
    const r = await this.#fileSource.readScriptByName(name);
    if (!r) return null;
    return { index: r.index, name: r.name, data: Array.from(r.data) };
  }

  /** 读任意文件（原始字节；路径原样透传 —— 与重构前 `read-file` 通道同口径）。 */
  async readFile(p: string): Promise<number[]> {
    const b = await this.#fileSource.readFile(p);
    return Array.from(b);
  }

  /**
   * 已装载的扩展包包号（升序）。渲染侧 0x143(i143) 用它派发各包的 `$n$AUTORUN.BIN`。
   * 扫描+注册在 NodeFileSource 内完成（扫资源根 *.AAI、按文件头 @264 的包号），与引擎 sub_455750 同口径。
   */
  async appendPackNumbers(): Promise<number[]> {
    return await this.#fileSource.appendPackNumbers();
  }

  /** 主进程已读到的外置选项（`read-emulator-options` 通道；渲染进程无 fs ⇒ 由这里给文本）。 */
  readEmulatorOptions(): {
    path: string;
    exists: boolean;
    text: string;
    envOverrides: EmulatorOptionsInput;
  } {
    const o = this.#options();
    console.log(`[main] emulator options -> ${o.path} (exists=${o.exists})`);
    // ★`envOverrides`（`tickets/T-0103`）：渲染进程读不到 `process.env` ⇒ 把 `AMAYUI_AUDIO_ENABLED`
    //   之类**结构化**传过去（不改文件文本，免得抹掉文件里的 `$comment` 说明）。渲染侧与文件值合并，
    //   环境变量优先 —— 这就是"测试用命令行引入静音"的那条路（`test/options.test.env`）。
    const envOverrides = envOverridesOf(this.#env);
    if (envOverrides.audio?.enabled !== undefined) {
      console.log(`[main] emulator options env override -> audio.enabled=${envOverrides.audio.enabled}`);
    }
    return { path: o.path, exists: o.exists, text: o.text ?? '', envOverrides };
  }

  // ---- 引擎配置（`SYS4REG.INI`） -----------------------------------------

  /**
   * 读引擎配置文件 `SYS4REG.INI`（启动时填充引擎字段用；见 `src/engineConfig.ts`）。
   * ★overlay 优先：有本工程写过的那份就用它，否则读真游戏那份（⇒ 继承玩家的显示/声音/文本设置）。
   */
  async readConfigIni(): Promise<{ path: string; text: string; side: OverlaySide } | null> {
    const hit = await this.#systemFiles.readText(INI_FILE);
    if (!hit) {
      console.log('[main] config ini: overlay/base 都没有 SYS4REG.INI（引擎字段用默认值）');
      return null;
    }
    console.log(`[main] config ini -> ${hit.path} (${hit.side}, ${hit.text.length} bytes)`);
    return { path: hit.path, text: hit.text, side: hit.side };
  }

  /**
   * 防丢键棘轮（与 `NodeFileSource.saveConfig` 同口径）：新文本的键数不得少于当前生效的那份。
   * ★`electron/ipc/files.ts` 里保留了同名薄壳（`tickets/T-0031` 的锚点棘轮），真实现是这一份。
   */
  configRatchetOk(text: string, prev: string | null): boolean {
    if (prev === null) return true;
    const count = (t: string): number => parseIni(t).values.size;
    if (count(text) >= count(prev)) return true;
    console.log(
      `[main] save-config-ini 拒绝回写：新文本 ${count(text)} 个键 < 现有 ${count(prev)} 个` +
        '（疑似配置未装载就写回）',
    );
    return false;
  }

  /**
   * 写回引擎配置（脚本用 SetConfig 族改了配置 ⇒ 渲染进程把整份 INI 文本发过来）。
   * 安全：**只写 overlay**（真游戏的 INI 一个字节都不动），所以不需要白名单路径校验。
   */
  async saveConfigIni(text: string): Promise<{ path: string } | null> {
    if (typeof text !== 'string' || text.length === 0) return null;
    const prev = await this.#systemFiles.readText(INI_FILE);
    if (!this.configRatchetOk(text, prev?.text ?? null)) return null;
    const target = await this.#systemFiles.write(INI_FILE, text);
    console.log(`[main] config ini <- ${target} (${text.length} bytes)`);
    return { path: target };
  }

  // ---- `SAVE.DAT`（`save-int`/`save-string` 表的持久化） ------------------

  /**
   * 读 `SAVE.DAT`：overlay → base（base 那份是真游戏的，引擎加密格式也照读：用于"继承玩家真存档"）。
   */
  async readSaveData(): Promise<Buffer | null> {
    const hit = await this.#systemFiles.read(SAVE_DAT_REL);
    if (!hit) {
      console.log(
        `[main] save data: overlay/base 都没有 ${SAVE_DAT_REL}（首次启动 ⇒ 走 INITCONFIG 默认值分支）`,
      );
      return null;
    }
    console.log(`[main] save data -> ${hit.path} (${hit.side}, ${hit.data.length} bytes)`);
    return Buffer.from(hit.data); // Buffer 经 IPC 到达渲染进程即 Uint8Array
  }

  /** 写 `SAVE.DAT`：**只写 overlay**（真存档在 base，读时优先 overlay）。 */
  async writeSaveData(data: Uint8Array): Promise<{ path: string } | null> {
    if (!data || data.length === 0) return null;
    // ★只写 overlay：真存档（base）**永远**不被覆盖，所以不再需要"探测对方是不是引擎格式"。
    const target = await this.#systemFiles.write(SAVE_DAT_REL, Buffer.from(data));
    console.log(`[main] save data <- ${target} (${data.length} bytes)`);
    return { path: target };
  }

  /**
   * **两侧** `SAVE.DAT` 的原始字节（overlay 在前、base 在后；缺的那侧不出现）。
   *
   * 为什么不让渲染侧直接读 base：渲染进程没有 fs（只能经 IPC）。而"按 key 并表"必须在**解出表之后**做
   * （加密格式在 `src/save/saveData.ts` 里解）⇒ 这里只把两份字节交出去（`tickets/T-0069`）。
   */
  async readSaveDataBoth(): Promise<Buffer[]> {
    const out: Buffer[] = [];
    for (const p of [this.#systemFiles.overlayFile(SAVE_DAT_REL), this.#systemFiles.baseFile(SAVE_DAT_REL)]) {
      try {
        out.push(fs.readFileSync(p));
      } catch {
        /* 该侧没有 */
      }
    }
    console.log(`[main] save data both -> ${out.map((b) => b.length).join(' + ') || '（都没有）'}`);
    return out;
  }

  /**
   * 「已使用文件」标志（`SAVE.DAT` 开头的 int 块 = FileDB 的鉴赏/解锁表）：**两侧取并集**。
   *
   * 与 `readSaveData` 的区别：那个只返回优先级最高的那一份；标志是**单调集合**（引擎只会加、不会删），
   * 而 overlay 那份可能是旧版本写的（缺 flag 块）或落后于真游戏那份 ⇒ 并集才不丢玩家的回想进度。
   */
  async readSaveFlags(): Promise<number[] | null> {
    const bufs: Buffer[] = [];
    for (const p of [this.#systemFiles.overlayFile(SAVE_DAT_REL), this.#systemFiles.baseFile(SAVE_DAT_REL)]) {
      try {
        bufs.push(fs.readFileSync(p));
      } catch {
        /* 该侧没有 */
      }
    }
    if (bufs.length === 0) return null;
    const { ids, layouts } = unionUsedFileIds(bufs.map((b) => new Uint8Array(b)));
    console.log(`[main] save flags -> ${ids.length} 个（${layouts.join(' + ')}）`);
    return ids;
  }

  // ---- 存档槽族（`SAVE\SAVE%2.2d.DAT` + `.STH`；`tickets/T-0018`） --------
  // 引擎侧对应 `0x1A0` 读头 / `0x1A1` 读档 / `0x19E` 存档 / `0x1AB` 删 / `0x1AC` 复制 / `0x1AE`·`0x1AF` `.STH`。
  // ★写/删**只碰 overlay**（真游戏那份槽一个字节都不动）；读 overlay → base（⇒ 能直接读玩家的真存档槽）。
  //   `slot` 由脚本给（`SAVE%2.2d` 会把 0 补成 `00`、999 原样打印 ⇒ 见下面的范围注释）。
  // ★范围 0..999 是实测出来的：`SAVE.BIN` 的列表**逐槽读 0..999**（1000 项；2026-09 探针：
  //   点「Load Data」进列表后 `0x1A0` 读了 120 次、槽号去重后正好 0..999 全覆盖）。
  //   引擎侧没有范围校验（`%2.2d` 只补位不截断 ⇒ 槽 999 就是 `SAVE999.DAT`），这里做整数与范围校验
  //   只为"路径一定是 SAVE\SAVE<数字>.DAT"，避免负数/NaN 拼出奇怪的路径。
  #slotOk(slot: unknown): slot is number {
    return typeof slot === 'number' && Number.isInteger(slot) && slot >= 0 && slot <= 999;
  }

  /** 读一个存档槽（overlay → base；非法槽号/取不到 ⇒ null）。 */
  async readSaveSlot(slot: number): Promise<Buffer | null> {
    if (!this.#slotOk(slot)) return null;
    const b = await this.#fileSource.readSaveSlot(slot);
    if (!b) return null;
    console.log(`[main] save slot ${slot} -> ${b.length} bytes`);
    return Buffer.from(b); // Buffer 经 IPC 到达渲染进程即 Uint8Array
  }

  /** 写一个存档槽（**只写 overlay**；成功 ⇒ null，与重构前 `write-save-slot` 同形状）。 */
  async writeSaveSlot(slot: number, data: Uint8Array): Promise<null> {
    if (!this.#slotOk(slot) || !data || data.length === 0) return null;
    await this.#fileSource.writeSaveSlot(slot, Buffer.from(data));
    console.log(`[main] save slot ${slot} <- ${data.length} bytes（只写 overlay）`);
    return null;
  }

  /** 删一个槽（两个文件都试；返回各自是否删掉了）。 */
  async deleteSaveSlot(slot: number): Promise<{ dat: boolean; sth: boolean } | null> {
    if (!this.#slotOk(slot)) return null;
    return await this.#fileSource.deleteSaveSlot(slot);
  }

  /** 复制一个槽（源 overlay → base，目标只写 overlay）。 */
  async copySaveSlot(from: number, to: number): Promise<{ dat: boolean; sth: boolean } | null> {
    if (!this.#slotOk(from) || !this.#slotOk(to)) return null;
    return await this.#fileSource.copySaveSlot(from, to);
  }

  /** 读槽缩略图 `.STH`（overlay → base）。 */
  async readSlotThumb(slot: number): Promise<Buffer | null> {
    if (!this.#slotOk(slot)) return null;
    const b = await this.#fileSource.readSlotThumb(slot);
    return b ? Buffer.from(b) : null;
  }

  /** 写槽缩略图 `.STH`（只写 overlay）。 */
  async writeSlotThumb(slot: number, data: Uint8Array): Promise<null> {
    if (!this.#slotOk(slot) || !data || data.length === 0) return null;
    await this.#fileSource.writeSlotThumb(slot, Buffer.from(data));
    return null;
  }

  // ---- 图像 / 音频 / 字体 ------------------------------------------------

  /**
   * 读内置字体文件（`<repoRoot>/res/fonts/<file>`）。**白名单式**：拒绝任何含 `..` 或绝对路径的请求。
   */
  async font(file: string): Promise<Buffer | null> {
    if (typeof file !== 'string' || file.length === 0) return null;
    const full = path.resolve(this.fontDir, file);
    if (!full.startsWith(this.fontDir + path.sep)) {
      console.log(`[main] font 拒绝越界路径: ${file}`);
      return null;
    }
    try {
      const buf = fs.readFileSync(full);
      console.log(`[main] font -> ${file} (${(buf.length / 1024).toFixed(0)}KB)`);
      // ★返回 Buffer 而不是 Array.from(buf)：CJK 字体 24MB，转成 number[] 会变成
      //   数千万个 JS number（structured clone 极慢且吃内存）。Buffer 经 IPC 到达渲染进程即 Uint8Array。
      return buf;
    } catch (err) {
      console.log(`[main] font 读取失败 ${file}: ${(err as Error).message}`);
      return null;
    }
  }

  /** 按统一资源 id 取一张图像：resolveEntry(id) -> AGF 字节 -> 解码成 top-down RGBA。 */
  async image(id: number): Promise<{ name: string; width: number; height: number; data: Uint8Array } | null> {
    const r = await this.#fileSource.readById(id);
    if (!r) return null;
    const img = decodeAgfRgba(r.data);
    if (!img) return null;
    // Buffer 经 structured clone 到 renderer 变 Uint8Array
    return { name: r.name, width: img.width, height: img.height, data: img.rgba };
  }

  /**
   * **按统一资源 id 取原始字节**（`{name, data}`；取不到返回 null）。
   *
   * ★为什么不能复用上面的 `image`：那条通道会立刻走 `decodeAgfRgba`，而 Live2D 的纹理是
   * **普通 PNG**（引擎走 `D3DXCreateTextureFromFileInMemory`，见 `docs-new/03-engine/live2d.md`）
   * ⇒ AGF 解码器对它必然返回 null。`.MOC` / `.MTN` 同理不是图像。
   * 渲染侧拿字节后自己按类型解（`IpcFileSource.readById` → `live2d/assetLoader` / `pixi/l2dTextures`）。
   */
  async readById(id: number): Promise<{ name: string; data: Buffer } | null> {
    const r = await this.#fileSource.readById(id);
    if (!r) return null;
    // Buffer 经 structured clone 到 renderer 变 Uint8Array（同 'font'/'audio' 通道的口径）
    return { name: r.name, data: Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength) };
  }

  /** 音乐表（SYS4INI 尾部：曲号 → 文件 id + 包内分组表）。VM 的 0x1D6/0x1D7/0x1D8 与 BGM 曲号解析用它。 */
  async musicTable(): Promise<MusicTables> {
    return await this.#fileSource.musicTables();
  }

  /**
   * 按统一资源 id（数字）或**文件名**（字符串）取一段音频的原始字节。
   *  - SE / 语音：剧本操作数就是统一文件 id（实测 `play-sound-effect 2e` → 46 = SE004.WAV）；
   *  - BGM：剧本操作数是**曲号**，等价于文件名 `BGM%03d.OGG`（见 docs-new/03-engine/sound-system.md §5）。
   * 返回 Buffer（→ renderer 侧 Uint8Array）：单条最大 ~350KB，直接走 IPC 比协议更简单；
   * BGM（2–6MB）走 `amayui-audio://` 流式协议，不经过这条。
   */
  async audio(key: number | string): Promise<Buffer | null> {
    const r = typeof key === 'string' ? await this.#fileSource.readByName(key) : await this.#fileSource.readById(key);
    if (!r) {
      console.log(`[main] audio ${JSON.stringify(key)} 取不到（resolve/切片失败）`);
      return null;
    }
    return Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength);
  }

  /**
   * 音频流式的**区间读取**（`amayui-audio://` 协议用）：`key` 是统一文件 id（数字）或文件名（字符串），
   * `range` 为 `null` ⇒ 整段（此时 `total = data.length`，与重构前协议处理器的兜底同口径）。
   */
  async readAudioRange(
    key: number | string,
    range: { start: number; end: number } | null,
  ): Promise<{ name: string; data: Uint8Array; total: number } | null> {
    const isId = typeof key === 'number';
    if (range) {
      return isId
        ? await this.#fileSource.readByIdRange(key, range.start, range.end)
        : await this.#fileSource.readByNameRange(key, range.start, range.end);
    }
    const r = isId ? await this.#fileSource.readById(key) : await this.#fileSource.readByName(key);
    return r ? { name: r.name, data: r.data, total: r.data.length } : null;
  }

  // ---- 内部：惰性选项/资源根 --------------------------------------------

  /** 外置选项（`emulator.config.json`）读一次并记住（与 `paths.ts` 的 `EMULATOR_OPTIONS` 同源）。 */
  #options(): LoadedEmulatorOptions {
    this.#loaded ??= loadEmulatorOptions(this.#repoRoot, this.#env);
    return this.#loaded;
  }

  /** 资源根决策（`AMAYUI_RESOURCE_DIR` > `resources.path` > 默认 `install/`）。 */
  #resourceDecision(): ResourceDirDecision {
    this.#decision ??= resourceDirOf(this.#options(), this.#repoRoot, { env: this.#env });
    return this.#decision;
  }
}

/**
 * 建一个宿主服务（**每实例一份**）。`resourceDir` 缺省时走现状决策链（`loadEmulatorOptions` +
 * `resourceDirOf`，honours `AMAYUI_RESOURCE_DIR` / `resources.path` / 默认 `install/`）。
 */
export function createHostService(opts: HostServiceOptions): HostService {
  const layout = instanceLayout(opts);
  const resourceDir = opts.resourceDir ?? resourceDirOf(loadEmulatorOptions(opts.repoRoot, opts.env), opts.repoRoot, {
    env: opts.env,
  }).dir;
  return new HostService(layout, resourceDir, {
    repoRoot: opts.repoRoot,
    ...(opts.env ? { env: opts.env } : {}),
  });
}

let defaultService: HostService | null = null;

/**
 * **进程内默认实例**（Electron 用）：`files.ts` / `logging.ts` 各调一次也拿到**同一个**对象
 * （appenders 必须共享，否则两条通道写进两个流）。
 *
 * ★`repoRoot` 由调用方传（Electron 传 `paths.ts` 的 `REPO_ROOT`）——本模块**不许**用
 *   `__dirname`/`import.meta` 猜（那两个在 ESM/CJS 两侧语义不同，见 `instance.ts` 的同款说明）。
 *   首次调用必须带 `opts`；之后忽略参数（幂等）。
 */
export function defaultHostService(opts?: HostServiceOptions): HostService {
  if (!defaultService) {
    if (!opts) {
      throw new Error(
        'defaultHostService() 首次调用必须给 HostServiceOptions（repoRoot 由宿主传入；src/host/** 不许猜 __dirname）',
      );
    }
    defaultService = createHostService(opts);
  }
  return defaultService;
}
