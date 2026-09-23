/**
 * 主进程的**资源读取 IPC**：脚本字节 / 任意文件 / 引擎配置 / 图像（AGF 解码） / 玩家存档。
 *
 * 两条互不相干的路径：
 *  - **资源**（只读）：`install/`（汉化版）+ ALF 切片，经 `NodeFileSource`；图像在这里就地解码成
 *    top-down RGBA 再交给渲染进程（Node 侧有 zlib/fs）。
 *  - **玩家数据**（`SYS4REG.INI` / `SAVE\SAVE.DAT`）：走 `OverlayDir`（系统存档目录 + overlay）——
 *    读 overlay → base（真游戏），写只写 overlay ⇒ 继承玩家设置而**永不写坏真存档**。
 *    与 Node 侧（`run.ts`/`src/arch/nodeFileSource.ts`）共用同一份实现，避免两侧行为漂移。
 *
 * ★`tickets/T-0134` WS-3：真实现已下沉到 `src/host/service.ts`（`HostService`，**零 electron import**、
 *   每实例一份）。本文件只剩**传输层**：IPC 通道名 / 自定义协议 / 启动摘要 —— 每个 handler 体是一行委托
 *   ⇒ 通道名、`[main] …` 日志文案、返回的数据形状都与重构前逐字一致（Electron 零行为变更）。
 *   落点是 `paths.ts` 的 `REPO_ROOT` ⇒ **默认实例**（= 现状路径：`.tmp/` + 真游戏 base/overlay）。
 */
import * as path from 'node:path';
import { ipcMain, protocol } from 'electron';
import { REPO_ROOT, RESOURCE_DIR } from '../paths.js';
import { defaultHostService, type HostService } from '../../src/host/service.js';

/** 音频流式协议名（`amayui-audio://<id>`；见 `docs/13-audio-plan.md` §3.3）。 */
export const AUDIO_SCHEME = 'amayui-audio';

/**
 * 进程内默认宿主服务（单例；`logging.ts` 拿的是**同一个**对象 ⇒ 共享 appenders）。
 *
 * ★刻意**懒构造**（不在模块顶层 `new`）：`main.ts` 先 `initLogFile()` 写日志头、再 `logSystemPaths()`；
 *   顶层构造会让 appenders 在日志头之前打开（虽然 `'a'` 标志能保证内容顺序，但没有必要冒这个险）。
 */
function host(): HostService {
  return defaultHostService({ repoRoot: REPO_ROOT, resourceDir: RESOURCE_DIR });
}

/** 启动摘要：写清这次的 base/overlay 是哪两份目录、资源根/资源版本各是什么。 */
export function logSystemPaths(): void {
  host().logSystemPaths();
}

/**
 * 防丢键棘轮（与 `NodeFileSource.saveConfig` 同口径）：新文本的键数不得少于当前生效的那份。
 *
 * ★**名字刻意留在本文件**：`tickets/T-0031` 的锚点棘轮以 `function configRatchetOk` 这个字面串为锚
 *   （`tickets/T-0134` WS-3 的保锚项）。真实现已下沉到 `HostService.configRatchetOk`，这里是一行薄壳；
 *   本文件内的 handler 一律走 `host().saveConfigIni(…)`（棘轮在服务里），所以这层壳**只**为保锚存在。
 */
function configRatchetOk(text: string, prev: string | null): boolean {
  return host().configRatchetOk(text, prev);
}

export function registerFileIpc(): void {
  // 读脚本（call-script 索引 -> 原始字节 + 文件名）
  ipcMain.handle('read-script', async (_e, index: number) => await host().readScript(index));
  /**
   * 按**文件名**读一个脚本（读档时要按名装载 `CALLBACK_LOAD.BIN`，见 `tickets/T-0072`）。
   * 与 `read-script` 同一条读取路径，只是用名字换统一 id（引擎 `sub_455000(FileDB, name)`）。
   */
  ipcMain.handle('read-script-by-name', async (_e, name: string) => await host().readScriptByName(name));
  // 读任意文件（原始字节）
  ipcMain.handle('read-file', async (_e, p: string) => await host().readFile(p));

  // 已装载的扩展包包号（升序）。渲染侧 0x143(i143) 用它派发各包的 $n$AUTORUN.BIN。
  // 扫描+注册在 NodeFileSource 内完成（扫资源根 *.AAI、按文件头 @264 的包号），与引擎 sub_455750 同口径。
  ipcMain.handle('append-packs', async () => await host().appendPackNumbers());

  // 读引擎配置文件 SYS4REG.INI（启动时填充引擎字段用；见 src/engineConfig.ts）。
  // ★overlay 优先：有本工程写过的那份就用它，否则读真游戏那份（⇒ 继承玩家的显示/声音/文本设置）。
  ipcMain.handle('read-config-ini', async () => await host().readConfigIni());

  // 写回引擎配置（脚本用 SetConfig 族改了配置 ⇒ 渲染进程把整份 INI 文本发过来）。
  // 安全：**只写 overlay**（真游戏的 INI 一个字节都不动），所以不需要白名单路径校验。
  ipcMain.handle('save-config-ini', async (_e, text: string) => await host().saveConfigIni(text));

  // 外置选项文件 `emulator.config.json`（**只读**；渲染进程无 fs ⇒ 由主进程读文本、渲染侧解析）。
  // ★主进程在 `paths.ts` 已经读过一次（资源根要用 `resources.path`）⇒ 服务侧同样只读一次，不二次读盘。
  // 不存在是正常情况（返回 exists=false），渲染侧据此用默认值；解析/校验在 src/emulatorOptions.ts。
  ipcMain.handle('read-emulator-options', () => host().readEmulatorOptions());

  // ---- SAVE.DAT（`save-int`/`save-string` 表的持久化；设置界面的开关靠它跨会话保留）----
  // 读：overlay → base（base 那份是真游戏的，引擎加密格式也照读：用于"继承玩家真存档"）。
  ipcMain.handle('read-save-data', async () => await host().readSaveData());
  ipcMain.handle('write-save-data', async (_e, data: Uint8Array) => await host().writeSaveData(data));

  /**
   * **两侧** `SAVE.DAT` 的原始字节（overlay 在前、base 在后；缺的那侧不出现）。
   *
   * 为什么不让渲染侧直接读 base：渲染进程没有 fs（只能经 IPC）。而"按 key 并表"必须在**解出表之后**做
   * （加密格式在 `src/save/saveData.ts` 里解）⇒ 主进程只把两份字节交出去（`tickets/T-0069`）。
   */
  ipcMain.handle('read-save-data-both', async () => await host().readSaveDataBoth());

  /**
   * 「已使用文件」标志（`SAVE.DAT` 开头的 int 块 = FileDB 的鉴赏/解锁表）：**两侧取并集**。
   *
   * 与 `read-save-data` 的区别：那个只返回优先级最高的那一份；标志是**单调集合**（引擎只会加、不会删），
   * 而 overlay 那份可能是旧版本写的（缺 flag 块）或落后于真游戏那份 ⇒ 并集才不丢玩家的回想进度。
   */
  ipcMain.handle('read-save-flags', async () => await host().readSaveFlags());

  // ---- 存档槽族（`SAVE\SAVE%2.2d.DAT` + `.STH`；`tickets/T-0018`）----
  // 引擎侧对应 `0x1A0` 读头 / `0x1A1` 读档 / `0x19E` 存档 / `0x1AB` 删 / `0x1AC` 复制 / `0x1AE`·`0x1AF` `.STH`。
  // ★写/删**只碰 overlay**（真游戏那份槽一个字节都不动）；读 overlay → base（⇒ 能直接读玩家的真存档槽）。
  //   槽号合法性（整数 + 0..999）与文件落点都在服务侧（`HostService`）校验。
  ipcMain.handle('read-save-slot', async (_e, slot: number) => await host().readSaveSlot(slot));
  ipcMain.handle('write-save-slot', async (_e, slot: number, data: Uint8Array) => await host().writeSaveSlot(slot, data));
  ipcMain.handle('delete-save-slot', async (_e, slot: number) => await host().deleteSaveSlot(slot));
  ipcMain.handle('copy-save-slot', async (_e, from: number, to: number) => await host().copySaveSlot(from, to));
  ipcMain.handle('read-slot-thumb', async (_e, slot: number) => await host().readSlotThumb(slot));
  ipcMain.handle('write-slot-thumb', async (_e, slot: number, data: Uint8Array) => await host().writeSlotThumb(slot, data));

  // 读内置字体文件（`res/fonts/<file>`）。**白名单式**：拒绝任何含 `..` 或绝对路径的请求。
  ipcMain.handle('font', async (_e, file: string) => await host().font(file));

  // 按统一资源 id 取一张图像：resolveEntry(id) -> AGF 字节 -> 解码成 top-down RGBA
  ipcMain.handle('image', async (_e, id: number) => await host().image(id));

  /**
   * **按统一资源 id 取原始字节**（`{name, data}`；取不到返回 null）。
   *
   * ★为什么不能复用上面的 `image`：那条通道会立刻走 `decodeAgfRgba`，而 Live2D 的纹理是
   * **普通 PNG**（引擎走 `D3DXCreateTextureFromFileInMemory`，见 `docs-new/03-engine/live2d.md`）
   * ⇒ AGF 解码器对它必然返回 null。`.MOC` / `.MTN` 同理不是图像。
   * 渲染侧拿字节后自己按类型解（`IpcFileSource.readById` → `live2d/assetLoader` / `pixi/l2dTextures`）。
   */
  ipcMain.handle('read-by-id', async (_e, id: number) => await host().readById(id));

  // 音乐表（SYS4INI 尾部：曲号 → 文件 id + 包内分组表）。VM 的 0x1D6/0x1D7/0x1D8 与 BGM 曲号解析用它。
  ipcMain.handle('music-table', async () => await host().musicTable());

  // 按统一资源 id（数字）或**文件名**（字符串）取一段音频的原始字节。
  //  - SE / 语音：剧本操作数就是统一文件 id（实测 `play-sound-effect 2e` → 46 = SE004.WAV）；
  //  - BGM：剧本操作数是**曲号**，等价于文件名 `BGM%03d.OGG`（见 docs-new/03-engine/sound-system.md §5）。
  // 返回 Buffer（→ renderer 侧 Uint8Array）：单条最大 ~350KB，直接走 IPC 比协议更简单；
  // BGM（2–6MB）走下面的 `amayui-audio://` 流式协议，不经过这条。
  ipcMain.handle('audio', async (_e, key: number | string) => await host().audio(key));
}

/**
 * **注册音频流式协议**（必须在 `app.whenReady()` **之前**调用）。
 *
 * 为什么需要：BGM 单曲 2–6MB、解码成 PCM 约 30–50MB/曲（见 `docs/13-audio-plan.md` §3.2）。
 * 用 `<audio src="amayui-audio://1">` 让 Chromium 自己按 Range 拉块，渲染进程零拷贝、支持 seek/loop。
 */
export function registerAudioScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: AUDIO_SCHEME,
      privileges: { standard: true, stream: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true },
    },
  ]);
}

/** 协议处理器（`app.whenReady()` 之后调用）：`amayui-audio://<id>` + 标准 `Range` 语义。 */
export function registerAudioProtocol(): void {
  protocol.handle(AUDIO_SCHEME, async (req) => {
    const url = new URL(req.url);
    // ★id 走**路径**（`amayui-audio://audio/31`）而不是主机名：WHATWG URL 会把纯数字主机名当 **IPv4**
    //   解析（`amayui-audio://31` → hostname `0.0.0.31`）⇒ 用主机名取 id 会得到 NaN（实测 400）。
    //   段是纯数字 ⇒ 统一文件 id；否则 ⇒ 文件名（BGM 曲号 → `BGM031.OGG`）。
    const seg = decodeURIComponent(url.pathname.replace(/^\//, '') || url.hostname);
    const isId = /^\d+$/.test(seg);
    if (seg === '') {
      console.log(`[main] audio-stream 非法资源：${req.url}`);
      return new Response('bad resource', { status: 400 });
    }
    const range = parseRangeHeader(req.headers.get('range'));
    const hit = await host().readAudioRange(isId ? Number(seg) : seg, range);
    if (!hit) {
      console.log(`[main] audio-stream ${seg} 取不到（range=${req.headers.get('range') ?? '-'}）`);
      return new Response('not found', { status: 404 });
    }
    const len = hit.data.length;
    // ★`Response` 的 BodyInit 不收 `Uint8Array<ArrayBufferLike>`（TS 的 lib.dom 口径）⇒ 显式切出 ArrayBuffer
    const body = hit.data.buffer.slice(hit.data.byteOffset, hit.data.byteOffset + hit.data.byteLength) as ArrayBuffer;
    const headers: Record<string, string> = {
      'content-type': mimeOfAudio(hit.name),
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
      // 页面是 `file://` 起源 ⇒ 对自定义 scheme 的请求按跨源处理，必须给 CORS 头，
      // 否则 `<audio>` / `fetch` 会被拦（而 `decodeAudioData` 回退照常工作，极难定位）。
      'access-control-allow-origin': '*',
    };
    console.log(`[main] audio-stream ${seg} name=${hit.name} status=${range ? 206 : 200} len=${len}/${hit.total}`);
    if (range) {
      const start = range.start;
      const end = start + len - 1;
      headers['content-range'] = `bytes ${start}-${end}/${hit.total}`;
      headers['content-length'] = String(len);
      return new Response(body, { status: 206, headers });
    }
    headers['content-length'] = String(len);
    return new Response(body, { status: 200, headers });
  });
}

/** 解析 `Range: bytes=a-b`（只支持单区间；`b` 可省略）。 */
function parseRangeHeader(header: string | null): { start: number; end: number } | null {
  if (!header) return null;
  const m = /bytes=(\d*)-(\d*)/.exec(header);
  if (!m) return null;
  const start = m[1] ? Number(m[1]) : 0;
  const end = m[2] ? Number(m[2]) : Number.MAX_SAFE_INTEGER;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return { start, end };
}

/** 音频 MIME（实测只有 `.wav`(RIFF PCM16) 与 `.ogg`(Ogg Vorbis) 两种，见 13-audio-plan.md §1）。 */
function mimeOfAudio(name: string): string {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.ogg' || ext === '.oga') return 'audio/ogg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.mp3') return 'audio/mpeg';
  return 'application/octet-stream';
}
