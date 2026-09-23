/**
 * **调试观察宿主的 web 服务端**（`tickets/T-0135` Phase 2；设计来源 `tickets/T-0133` §B.4、`T-0135/notes.md`）。
 *
 * ## 它是什么
 *
 * 一个**独立进程**（不是 Electron、不是 headless）：`node:http` 只绑 `127.0.0.1`，对外提供四件事：
 *
 * | 端点 | 用途 |
 * |---|---|
 * | `GET /` · `GET /<file>` | 渲染页与已构建的浏览器 bundle（`dist/web/*`） |
 * | `POST /api/<method>` | 宿主能力（22 个方法，对应 `HostService`）；JSON 或**二进制信封**（见 `envelope.ts`） |
 * | `POST /api/event` | 渲染页 → 宿主的**单向**消息（`ipcRenderer.send` 的等价物） |
 * | `GET /events` | **SSE**：宿主 → 渲染页的推送（`ipcRenderer.on` 的等价物） |
 *
 * 于是浏览器里的 `webBridge`（`src/renderer/webBridge.ts`）就能把 `window.api` 装起来，
 * 而 **VM / 场景 / Pixi 代码一行不改**。
 *
 * ## 为什么是 SSE 而不是 WebSocket
 *
 * 控制面推送是**单向**的（宿主→页），而 SSE 在 DSH 的 `webServer` 上已被实测可用、且**不需要代理
 * WebSocket 升级**（`T-0135/notes.md` §1）。渲染页→宿主那条方向走普通 POST，本来就不需要长连。
 *
 * ## 每实例一份（`T-0133` §B.3）
 *
 * `HostService` 按 `--instance <id>` 构造 ⇒ log / trace / replay / base / overlay 全落在
 * `<repo>/.tmp/instances/<id>/` 下，**不碰真游戏存档、不与别的实例互踩**；缺省实例 = 现状路径。
 *
 * ## 注册表 / 同 id 互斥 / 闲置自停（`T-0136`）
 *
 * listen 成功后把 `{id,pid,port,host,repoRoot,startedAt,heartbeatAt,lastStatus}` **原子写**进
 * `<root>/instance.json`（`src/host/registry.ts`），之后每 5s 刷心跳 ⇒ DSH 插件（或任何读者）
 * 只要扫 `.tmp/instances/<id>/instance.json` 就能发现**所有**活实例，不需中心进程。
 *
 * 三条随之而来的纪律：
 *  1. **同 id 互斥**：同 id = 同一份 overlay/log ⇒ 已有"活记录"（pid 活 **且** 心跳新鲜）时
 *     本进程**直接失败**（非零退出），且失败发生在建 `HostService` 之前 —— 不碰既有实例一个字节；
 *  2. **摘干净**：`close()` / SIGINT / SIGTERM 都会删记录（记录寿命 = 进程寿命）；
 *  3. **闲置自停**：`--idle-sec <秒>`（缺省 600，`0` 关；env `AMAYUI_WEB_IDLE_SEC`）——
 *     没有 SSE 观察者**且**无任何请求持续超过阈值 ⇒ 自己删记录、收服务、退 0（磁盘状态保留）。
 *
 * ## 用法
 *
 * ```bash
 * cd app/amayui-emulator
 * node --import tsx src/web/host.ts --instance dbg-a --port 8899
 * # 或 port 0 让 OS 分配（启动日志里会打出真实端口）
 * node --import tsx src/web/host.ts --instance dbg-a --port 0 --idle-sec 600
 * ```
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

import { instanceLayout } from '../host/instance.js';
import { HEARTBEAT_STALE_MS, isAlive, readRecord, removeRecord, writeRecord, type InstanceRecord } from '../host/registry.js';
import { createHostService } from '../host/service.js';
import { KIND_HEADER, META_HEADER, decodeEnvelope, encodeEnvelope, formatMeta, parseMeta } from './envelope.js';

/** SSE 的心跳间隔（防中间层按空闲超时掐断；顺带让代理侧知道连接活着）。 */
const SSE_HEARTBEAT_MS = 15000;
/** 注册表心跳周期：每 5s 把 `heartbeatAt`（与已知的 `lastStatus`）刷进 `instance.json`。 */
const HEARTBEAT_MS = 5000;
/**
 * 闲置检查周期（ms）。**实际间隔 = min(它, idleSec*1000)**：缺省 600s 的实例就是 15s 一查，
 * 而 `--idle-sec 1` 这类秒级配置能在秒级被发现（守卫测试靠这条才不用等 15s）。
 */
const IDLE_CHECK_MS = 15000;
/** 闲置自停的缺省阈值（秒）；`0` = 关。可用 `--idle-sec` / `AMAYUI_WEB_IDLE_SEC` 覆盖。 */
const DEFAULT_IDLE_SEC = 600;
/** 单次请求体上限（写存档/槽；与 Electron IPC 的实际量级同数量级，留足余量）。 */
const MAX_BODY_BYTES = 256 * 1024 * 1024;
/**
 * 调试查询的超时（渲染页卡住时不能让 agent 的 curl 永远挂着）。
 * 可用 `AMAYUI_DEBUG_QUERY_TIMEOUT_MS` 覆盖（冒烟测试要短超时；正常运行 8s 够）。
 */
const DEBUG_QUERY_TIMEOUT_MS = Number(process.env.AMAYUI_DEBUG_QUERY_TIMEOUT_MS ?? 8000);

export interface WebHostOptions {
  /** 仓库根（`instanceLayout` 与资源解析的基准）。 */
  repoRoot: string;
  /** 实例 id（缺省 `default` = 现状路径；具名 ⇒ `.tmp/instances/<id>/`）。 */
  instance?: string;
  /** 监听端口（缺省 8899；`0` = 让 OS 分配）。 */
  port?: number;
  /** 监听地址（**缺省且推荐 `127.0.0.1`**；不要绑 0.0.0.0，这套路由没有认证）。 */
  host?: string;
  /** 静态产物目录（缺省 `<repoRoot>/app/amayui-emulator/dist/web`）。 */
  distDir?: string;
  /** 诊断输出。 */
  log?: (line: string) => void;
  /** 额外/覆盖的环境变量（传给 `HostService` 的 `env` 参数，**不改 `process.env`**）。 */
  env?: NodeJS.ProcessEnv;
  /**
   * **闲置自停**阈值（秒）：既没有 SSE 观察者、又没有任何请求持续超过它 ⇒ 实例自己收工
   * （写一行日志、删注册项、`close()`、`process.exit(0)`；磁盘状态保留）。
   *
   * 缺省 `600`；`0` = 关。CLI `--idle-sec` 优先，其次 env `AMAYUI_WEB_IDLE_SEC`。
   */
  idleSec?: number;
  /**
   * **自持一个无头渲染页**（`tickets/T-0140`；CLI `--attach-headless`，缺省关）。
   *
   * 为什么需要它：web 形态下 **VM 跑在页面里** ⇒ 没有页面附着的实例，`/health` 正常但 agent 的
   * `debug-query` 必然 503。要让 agent **不依赖人**就能驱动实例，宿主得自己附一个隐藏的渲染页
   * （手法同 `plugins/amayui-emulator/e2e-shot.cjs` 的哑窗：`show:false` + 不抢焦点）。
   *
   * 缺省关（避免无谓地起一个 Electron 渲染进程）；开了才付出这个代价。
   */
  attachHeadless?: boolean;
  /** 无头渲染页用哪个 Electron 可执行文件（缺省从 `app/amayui-emulator/node_modules/.bin` 找）。 */
  electronPath?: string;
}

/** 渲染页状态摘要（`renderer-status` 的极小切片；注册表只发布这三项）。 */
export interface StatusSummary {
  bin?: string;
  frames?: number;
  gate?: string;
}

/**
 * 把 `renderer-status` 的 payload **防御性**收窄成摘要（形状不认识 ⇒ `null`）。
 *
 * ★为什么必须防御：这条通道由**渲染页**发（`session.notifyStatus`），字段集随版本演进；
 * 注册表是个"旁路"读者，任何形状都不该让宿主抛错或写坏 `instance.json`。
 */
export function summarizeStatus(payload: unknown): StatusSummary | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  const out: StatusSummary = {};
  if (typeof p.bin === 'string') out.bin = p.bin;
  const perf = p.perf;
  if (perf && typeof perf === 'object' && !Array.isArray(perf)) {
    const pf = perf as Record<string, unknown>;
    if (typeof pf.frames === 'number' && Number.isFinite(pf.frames)) out.frames = pf.frames;
    if (typeof pf.gate === 'string') out.gate = pf.gate;
  }
  return out;
}

/**
 * **闲置自停的纯判据**（提出来的唯一理由：守卫测试可以直接钉住它，不必等真进程）。
 *
 * 四条全部成立才自停：开了阈值、**没有**观察者（`clients === 0`）、**自上次活动起**超过阈值、
 * **自启动起**也超过阈值。后两条一起挡住"刚起来还没来得及被连上就被判闲置"。
 */
export function shouldIdleStop(s: {
  idleSec: number;
  clients: number;
  now: number;
  lastActivityMs: number;
  startedAt: number;
}): boolean {
  if (!(s.idleSec > 0)) return false;
  if (s.clients > 0) return false;
  const ms = s.idleSec * 1000;
  if (s.now - s.lastActivityMs <= ms) return false;
  if (s.now - s.startedAt <= ms) return false;
  return true;
}

/** 归一化闲置阈值：入参 > env > 缺省（负/NaN/非数一律回退缺省）。 */
function resolveIdleSec(value: number | undefined, env: NodeJS.ProcessEnv): number {
  const ok = (n: number): boolean => Number.isFinite(n) && n >= 0;
  if (typeof value === 'number' && ok(value)) return value;
  const raw = env.AMAYUI_WEB_IDLE_SEC;
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (ok(n)) return n;
  }
  return DEFAULT_IDLE_SEC;
}

/** 一条 SSE 推送（宿主→页）。 */
interface Push {
  channel: string;
  args: unknown[];
}

export interface WebHost {
  readonly server: http.Server;
  /** 实际监听端口（`port: 0` 时以它为准）。 */
  port(): number;
  /** 向所有 SSE 客户端推一条消息（控制面用：traceAll / skipOp / debugQuery / breakCommand…）。 */
  push(channel: string, ...args: unknown[]): void;
  /** 关服务（含 SSE 长连）。 */
  close(): Promise<void>;
  /**
   * 只收掉**自持的无头渲染页**（`tickets/T-0140`；没附过就是 no-op）。
   *
   * 与 `close()` 分开的理由：`process.on('exit')` 里**不能 await**（同步钩子），而那是"异常退出也
   * 别留一个孤儿渲染页"的唯一兜底点 ⇒ 需要一个同步的收尾动作。
   */
  detachHeadless?(): void;
}

/** 把 JSON 回出去。 */
function sendJson(res: http.ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value ?? null), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    [KIND_HEADER]: 'json',
    'content-length': String(body.length),
    // 代理链路上别被 gzip 白压（JSON 会被压，这里不拦；二进制才需要 no-transform）
  });
  res.end(body);
}

/** 把 0..n 段字节按信封回出去（元数据走 `x-amayui-meta`）。 */
function sendBin(res: http.ServerResponse, parts: readonly Uint8Array[], meta: Record<string, unknown> = {}): void {
  const body = Buffer.from(encodeEnvelope(parts));
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    [KIND_HEADER]: 'bin',
    [META_HEADER]: formatMeta(meta),
    'content-length': String(body.length),
    // ★原始 RGBA/字体/MOC 都是已压缩或高熵数据 ⇒ 明确拒绝变换，省掉 level-1 gzip 白压（T-0133 §7.2）
    'cache-control': 'no-store, no-transform',
  });
  res.end(body);
}

/** 读整个请求体（带上限）。 */
function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error(`请求体过大（>${MAX_BODY_BYTES}B）`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** 从请求里取参数：二进制请求把其余参数放在 `x-amayui-args`，JSON 请求放在 `{args}`。 */
async function readArgs(req: http.IncomingMessage): Promise<{ args: unknown[]; payload: Uint8Array | null }> {
  const body = await readBody(req);
  const isOctet = String(req.headers['content-type'] ?? '').startsWith('application/octet-stream');
  if (isOctet) {
    const meta = parseMeta((req.headers['x-amayui-args'] as string | undefined) ?? null) as { args?: unknown[] };
    const envelope = requireEnvelope(body);
    return { args: Array.isArray(meta.args) ? meta.args : [], payload: envelope };
  }
  if (body.length === 0) return { args: [], payload: null };
  const parsed = JSON.parse(body.toString('utf8')) as { args?: unknown[] };
  return { args: Array.isArray(parsed.args) ? parsed.args : [], payload: null };
}

/**
 * 单段信封（**写字节**类请求的 body：写存档/写槽/写缩略图）。
 *
 * ★为什么写方向也用信封而不是"裸 body"：读方向已经是信封（`src/web/envelope.ts`），
 *   两个方向共用一个格式才不会漂移（"半个协议"是本工程反复吃过亏的地方，
 *   而且 `webBridge.#sendBytes` 已经按信封编码）。
 */
function requireEnvelope(body: Buffer): Uint8Array {
  if (body.length === 0) return new Uint8Array(0);
  const parts = decodeEnvelope(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  return parts.length > 0 ? parts[0]! : new Uint8Array(0);
}

/**
 * 造一个 web 宿主（**不**自动 listen —— 调用方拿 `server` 自己 listen 或调 `listen()` 辅助）。
 */
export function createWebHost(opts: WebHostOptions): WebHost & { listen(): Promise<number> } {
  const log = opts.log ?? ((l: string): void => console.log(l));
  const env = opts.env ?? process.env;
  const distDir = opts.distDir ?? path.join(opts.repoRoot, 'app', 'amayui-emulator', 'dist', 'web');
  const instance = opts.instance ?? 'default';
  const layout = instanceLayout({ repoRoot: opts.repoRoot, id: instance, env });
  const idleSec = resolveIdleSec(opts.idleSec, env);

  // ---- 同 id 互斥（`T-0136`）-------------------------------------------------
  // ★必须在 `createHostService` **之前**：它一构造就会打开/建 log、overlay、base 三个落点，
  //   而"同 id"意味着**同一份** log/overlay ⇒ 先拒才能保证"不碰既有实例的一个字节"。
  //   判活 = pid 活着 **且** 心跳新鲜：`kill -9` 留下的死记录（心跳过期）不该挡住重启。
  const existing = readRecord(layout.root);
  if (existing && isAlive(existing.pid) && Date.now() - existing.heartbeatAt <= HEARTBEAT_STALE_MS) {
    throw new Error(
      `实例 ${instance} 已在运行 pid=${existing.pid} port=${existing.port}（同 id 共用同一份 overlay/log ⇒ 拒绝启动；` +
        `要并行请换 --instance <别的 id>，要接管请先停掉 pid=${existing.pid}）`,
    );
  }

  const app = createHostService({
    repoRoot: opts.repoRoot,
    id: instance,
    // ★env 只作**参数**下传（`T-0133` §B.3.3 坑 2：多实例靠传参，不改 `process.env`）
    env,
  });
  log(`[web] 实例 ${instance} → base=${app.layout.baseDir} overlay=${app.layout.overlayDir} log=${app.layout.logPath}`);

  /** SSE 客户端（`push` 的扇出目标`）。键即**观察者序号**：`0` = 宿主自附的无头渲染页，`>=1` = 外部页面。 */
  const clients = new Set<http.ServerResponse>();
  /**
   * 观察者序号（`tickets/T-0140`）：每来一个 SSE 连接 +1，随 `observers` 通道下发。
   *
   * ★为什么必须存在：`[web] status` 只说"有个渲染页报了帧"，不说**是哪一个**。实测（T-0138）
   *   两个页面同时附着时，它们的 `frames` 两套计数器会交错着写进同一份日志 ⇒ 看起来像
   *   "frames 自己掉回 35"，排障时极难判读。带上序号后每一条都能归因。
   */
  let viewerSeq = 0;
  /** 每个响应自己的观察者序号（`WeakMap`：连接断了自动释放）。 */
  const viewerId = new WeakMap<http.ServerResponse, number>();
  /** 调试查询的等待者（`id` → resolve）；与 `electron/ipc/control.ts` 的 `debugQueryWaiters` 同形。 */
  const waiters = new Map<number, (result: unknown) => void>();
  let querySeq = 0;

  // ---- 注册表 / 心跳 / 闲置（`T-0136`）----
  /** 最近一次"任何请求"（含 `/events`、静态、`/api/*`）的时刻；闲置判据的活动基准。 */
  let lastActivityMs = Date.now();
  /** listen 成功的时刻（与 `InstanceRecord.startedAt` 同值）。 */
  let startedAt = 0;
  /** 供页面识别"宿主是不是同一个"用的稳定标识（**不随心跳变**；`startedAt` 本来就是这种量）。 */
  let observerStartedAt = 0;
  /** 要发布的那条记录；`listen()` 成功才建（**没有监听端口就不该出现在注册表里**）。 */
  let record: InstanceRecord | null = null;
  /** 最近一次 `renderer-status` 的摘要（心跳带上它）。 */
  let lastStatus: StatusSummary | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let idleTimer: NodeJS.Timeout | null = null;
  /** 自停只允许发生一次（不然 15s 后第二轮会去 `close()` 一个已关的 server）。 */
  let selfStopping = false;

  /** 把当前记录（含新心跳/新状态）原子写回磁盘。 */
  function publishRecord(): void {
    if (!record) return;
    record.heartbeatAt = Date.now();
    if (lastStatus) record.lastStatus = lastStatus;
    try {
      writeRecord(record);
    } catch (err) {
      // 注册表是**旁路**：写不进去（只读盘/权限）不该把调试宿主带停。
      log(`[web] 注册表写入失败 ${layout.root}：${(err as Error).message}`);
    }
  }

  function clearTimers(): void {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (idleTimer) clearInterval(idleTimer);
    heartbeatTimer = null;
    idleTimer = null;
  }

  /** 收服务（含 SSE 长连）+ 摘掉注册项。`close()` / 信号 / 自停三条路径共用它。 */
  async function closeHost(): Promise<void> {
    clearTimers();
    // ★先收无头渲染页（`T-0140`）：它的 SSE 也是 `clients` 里的一员，反过来的顺序会让我们
    //   一边关 server 一边等它断连，白等一轮。杀不掉也要继续往下走（收不干净不能挡住退出）。
    if (headlessChild) {
      try {
        headlessChild.kill('SIGTERM');
      } catch {
        /* 已经没了 */
      }
      headlessChild = null;
    }
    for (const c of clients) {
      try {
        c.end();
      } catch {
        /* 忽略 */
      }
    }
    clients.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      await app.close();
    } finally {
      // ★注册项的寿命 = 进程的寿命：`close()` 是正常退出路径，必须在这里摘掉（否则重启会被自己挡住）。
      removeRecord(layout.root);
    }
  }

  /** 闲置：写一行日志 → 删注册项 → 收服务 → 退 0（磁盘状态保留）。 */
  async function stopSelf(): Promise<void> {
    if (selfStopping) return;
    selfStopping = true;
    log(`[web] 闲置 ${idleSec}s 且无观察者 ⇒ 自停`);
    removeRecord(layout.root);
    try {
      await closeHost();
    } catch {
      /* 收不干净也要退：留个僵尸监听比退不掉更糟 */
    }
    process.exit(0);
  }

  function idleTick(): void {
    if (
      shouldIdleStop({
        idleSec,
        clients: clients.size,
        now: Date.now(),
        lastActivityMs,
        startedAt,
      })
    ) {
      void stopSelf();
    }
  }

  // ---- 自持无头渲染页（`tickets/T-0140` 的 `--attach-headless`）----------------
  /**
   * 宿主自己附的那个隐藏渲染页的进程（缺省 `null` = 没附）。
   *
   * ★它**不是**"第二个渲染者"：它与本实例是 1:1 的（宿主退出/被闲置自停时一起收），
   *   而"第二渲染者"指的是**第二个外部页面**（人开的面板标签、重复的 iframe）—— 那种才是
   *   两个 VM 抢同一份 overlay/log。所以这里的告警口径是"**除了我自己的无头页之外**还有别人吗"。
   */
  let headlessChild: ChildProcess | null = null;
  /** 无头页**当前**还连着几个 SSE（`0` = 没连/已断）—— 告警文案与"外部渲染者"的计数都要减掉它。 */
  let headlessClients = 0;
  /** 无头页**第一个** SSE 还没认领（认领后立刻置 false）。 */
  let headlessFirstSse = false;

  /** 找 Electron 可执行文件（缺省 `<app>/node_modules/.bin/electron`，Windows 上是 `.cmd`）。 */
  function resolveElectron(): { exe: string; needsShell: boolean } | null {
    const appDir = path.join(opts.repoRoot, 'app', 'amayui-emulator');
    if (opts.electronPath) {
      // 显式给了路径就照用；`.cmd/.bat` 在 Windows 上必须走 shell（见下）。
      return { exe: opts.electronPath, needsShell: /\.(cmd|bat)$/i.test(opts.electronPath) };
    }
    const win = process.platform === 'win32';
    const cands = win
      ? [
          // ★优先**真 exe**：`.cmd` 在 Windows 上必须 `shell: true` 才能 spawn（本机实测踩过
          //   `Error: spawn EINVAL`，node 24 起 `.cmd` 不再被隐式套 shell）。
          path.join(appDir, 'node_modules', 'electron', 'dist', 'electron.exe'),
          path.join(appDir, 'node_modules', '.bin', 'electron.cmd'),
        ]
      : [
          path.join(appDir, 'node_modules', '.bin', 'electron'),
          path.join(appDir, 'node_modules', 'electron', 'dist', 'electron'),
        ];
    for (const c of cands) {
      try {
        if (!fs.existsSync(c)) continue;
        // ★`/\.(cmd|bat)$/`（不是 `/\.cm?d$/`）：`.cmd` 与 `.bat` 都要 shell，写错了 `.bat` 会漏。
        return { exe: c, needsShell: /\.(cmd|bat)$/i.test(c) };
      } catch {
        /* 继续找下一个 */
      }
    }
    return null;
  }

  /**
   * 起一个隐藏的渲染页连到本实例（幂等：已经在跑就不重复起）。
   *
   * ★**为什么不用 `--headless` 之类的 Electron 开关**而是"哑窗"（`show:false`）：见
   *   `plugins/amayui-emulator/e2e-shot.cjs` 的实测记录 —— 本机沙箱初始化会失败，所以哑窗脚本
   *   里带 `--no-sandbox`，且窗口必须真的存在（离屏渲染 = 没有像素，`capture` 会拿不到画面）。
   * ★**子进程必须由宿主收掉**：注册了 `process.on('exit')` 兜底（SIGKILL 之外的路径都能清干净）。
   */
  function attachHeadless(port: number): void {
    if (headlessChild) return;
    const found = resolveElectron();
    if (!found) {
      log(
        '[web] ✗ --attach-headless：找不到 electron（找过 app/amayui-emulator/node_modules/{electron/dist,.bin}）' +
          ' ⇒ 本实例仍然可用，但**没有渲染页**，agent 的 debug-query 会 503',
      );
      return;
    }
    const script = path.join(opts.repoRoot, 'app', 'amayui-emulator', 'tools', 'attach-headless.cjs');
    if (!fs.existsSync(script)) {
      log(`[web] ✗ --attach-headless：缺少 ${script}`);
      return;
    }
    // 有别的页面已经在跑 ⇒ 再附一个就是**第二个 VM**（明确告警，但仍按用户要求附上；见 headlessChild 注释）。
    if (clients.size > 0) {
      log(
        `[web] ⚠ --attach-headless：**已经**有 ${clients.size} 个观察者了（人开的面板/别的页面）⇒ ` +
          '再附一个无头页就是第二个 VM，两者会抢同一份 overlay/log。建议先关掉那个页面。',
      );
    }
    const url = `http://127.0.0.1:${port}/`;
    let child: ChildProcess;
    try {
      child = spawn(found.exe, [script, '--url', url, '--instance', instance], {
        cwd: path.join(opts.repoRoot, 'app', 'amayui-emulator'),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        // ★Windows 上 `.cmd`/`.bat` 不套 shell 会 `spawn EINVAL`（node 24 的实测）；
        //   `shell: true` 时参数是直传的（无用户输入），路径已加引号处理空格。
        ...(found.needsShell ? { shell: true } : {}),
      });
    } catch (err) {
      // ★起不来**不能**把宿主带走：宿主的主要职责是服务渲染页，附页只是"让它不依赖人"。
      log(`[web] ✗ --attach-headless 起不来（${(err as Error).message}）⇒ 实例仍可用但没有渲染页`);
      return;
    }
    headlessChild = child;
    headlessFirstSse = true; // 它的第一个 SSE 由上面的 `/events` 分支认领（见 `isSelfHeadless`）
    child.stdout?.on('data', (b: Buffer) => log(`[headless] ${b.toString('utf8').trimEnd()}`));
    child.stderr?.on('data', (b: Buffer) => log(`[headless] ${b.toString('utf8').trimEnd()}`));
    // ★`spawn` 的失败也可能是**异步**的（ENOENT/EINVAL 走 'error' 事件）⇒ 必须接，否则崩进程。
    child.on('error', (err) => {
      if (headlessChild === child) {
        headlessChild = null;
        headlessFirstSse = false;
      }
      log(`[web] ✗ --attach-headless 子进程出错：${err.message} ⇒ 实例仍可用但没有渲染页`);
    });
    child.on('exit', (code, sig) => {
      if (headlessChild === child) {
        headlessChild = null;
        headlessFirstSse = false;
        // ★子进程一死，它那条 SSE 的 `close` 回调不一定来得及把名额减回去（连接是被进程死带走的）
        //   ⇒ 在这里补一次；幂等（`headlessClients` 直接用 0，不做减法，避免减成负数）。
        headlessClients = 0;
      }
      log(`[web] 无头渲染页退出 code=${code} sig=${sig ?? '-'}（实例 ${instance} 又变回"没有渲染页"）`);
    });
    log(`[web] 已附无头渲染页：${url}（pid=${child.pid}；agent 现在可以直接 debug-query）`);
  }

  const server = http.createServer((req, res) => {    void handle(req, res).catch((err: Error) => {
      log(`[web] ✗ ${req.method} ${req.url}：${err.message}`);
      try {
        sendJson(res, 500, { error: err.message });
      } catch {
        /* 头已发出去就无法回错 */
      }
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // ★任何请求都算"有人在用"（SSE 长连、静态页、`/health`、`/api/*`）——
    //   闲置自停的前提是"确实没人看"，漏记任何一类都会把正在看的实例误杀。
    lastActivityMs = Date.now();
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    const p = url.pathname;

    // ---- SSE ----
    if (p === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store, no-transform',
        connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      clients.add(res);
      // ★**第二渲染者防护**（`tickets/T-0140`）：web 形态下 VM 跑在页面里 ⇒ 第二个页面附着
      //   就是**第二个 VM**，两个 VM 抢同一份 overlay/log。这里的策略是**允许 + 显著告警**
      //   （不是拒绝），理由：浏览器刷新时新旧 SSE 会**短暂并存**，硬拒会把正常刷新打成失败；
      //   而"两个 VM 真的在抢"这件事必须留下可查的痕迹（日志 + `/health.viewers`）。
      const vid = viewerSeq++;
      viewerId.set(res, vid);
      // 本宿主正自持无头页时，**第一个**连上来的观察者就是它自己（`--attach-headless` 在 listen
      // 之后立刻起它，顺序上它就是第一个）⇒ 不算"第二个渲染者"；之后它断开时要能**减回去**。
      const isSelfHeadless = headlessFirstSse;
      if (isSelfHeadless) {
        headlessFirstSse = false;
        headlessClients++;
      }
      const externals = clients.size - headlessClients;
      log(`[web] 观察者 #${vid} 接入（现共 ${clients.size} 个${isSelfHeadless ? '；这个是无头自持页' : ''}）`);
      // ★**第二渲染者防护**（`tickets/T-0140`）：web 形态下 VM 跑在页面里 ⇒ 第二个**外部**页面
      //   附着就是**第二个 VM**，两个 VM 抢同一份 overlay/log。策略是**允许 + 显著告警**（不是拒绝），
      //   理由：浏览器刷新时新旧 SSE 会**短暂并存**，硬拒会把正常刷新打成失败；而"两个 VM 真的在抢"
      //   必须留下可查的痕迹（日志 + `/health.viewers`）。自持的无头页不算外部渲染者。
      if (externals > 1) {
        log(
          `[web] ⚠ 第二渲染者：实例 ${instance} 现在有 ${externals} 个**外部**渲染页` +
            `（另有无头自持页 ${headlessClients} 个）` +
            ' ⇒ 多个 VM 会抢同一份 overlay/log。请只保留一个页面（关掉多余的标签/面板实例）。',
        );
      }
      // 序号 + 是否自持页：页面据此在日志里归因（`observer` 字段），`self` 让"我们自己那个无头页"一眼可辨。
      try {
        res.write(
          `data: ${JSON.stringify({
            channel: 'observer',
            args: [{ id: vid, hostStartedAt: observerStartedAt, self: isSelfHeadless }],
          })}\n\n`,
        );
      } catch {
        /* 首帧写失败 = 页面已经走了；`close` 会清 */
      }
      const hb = setInterval(() => {
        try {
          res.write(': hb\n\n');
        } catch {
          /* 下面 close 会清 */
        }
      }, SSE_HEARTBEAT_MS);
      req.on('close', () => {
        clearInterval(hb);
        clients.delete(res);
        // 自持无头页断开 ⇒ 把它的名额还回去（否则"外部渲染者"数会永远少算一个）。
        if (isSelfHeadless) headlessClients = Math.max(0, headlessClients - 1);
        // 观察者退出也留一条（`clients.size === 0` 意味着"没人看了"，随时可能被闲置自停收走）。
        log(`[web] 观察者 #${vid} 断开（现共 ${clients.size} 个）`);
      });
      return;
    }

    // ---- 健康检查（冒烟/代理就绪探测用）----
    if (p === '/health') {
      // ★`viewers`（`tickets/T-0140`）：当前 SSE 观察者数 = 有几个渲染页在跑这个实例的 VM。
      //   `>1` 就是"两个 VM 抢同一份 overlay/log"的**可机读**信号（面板与 agent 都据此告警）。
      sendJson(res, 200, {
        ok: true,
        instance,
        layout: app.layout,
        distDir,
        viewers: clients.size,
        viewersWarn: clients.size > 1,
      });
      return;
    }

    // ---- API ----
    if (p.startsWith('/api/')) {
      const method = p.slice('/api/'.length).replace(/\/$/, '');
      if (method === 'event') {
        // `webBridge` 发的是 `{channel, args}`（不是 `{args}`）⇒ 这里单独解析。
        const raw = await readBody(req);
        let msg: { channel?: unknown; args?: unknown } = {};
        try {
          msg = raw.length ? (JSON.parse(raw.toString('utf8')) as typeof msg) : {};
        } catch {
          throw new Error('event：body 不是 JSON');
        }
        handleEvent(String(msg.channel ?? ''), Array.isArray(msg.args) ? msg.args : []);
        sendJson(res, 200, null);
        return;
      }
      if (method === 'debug-query') {
        // ★`tickets/T-0135`：web 形态下 agent 的控制面 —— 与 Electron 的 `control-debug-query`
        //   同一套语义（同一张命令表：`move/click/leave/capture/focus/…` 由渲染页解析执行），
        //   差别只是"主进程转发"换成了"SSE 下发 + POST 回执"。
        const { args } = await readArgs(req);
        const text = String(args[0] ?? '');
        if (clients.size === 0) {
          return sendJson(res, 503, {
            ok: false,
            error: '没有渲染页连着 SSE ⇒ 没人能执行这条命令（先在 DSH 里打开调试画面/iframe）',
          });
        }
        const id = ++querySeq;
        let timedOut = false;
        const result = await new Promise<unknown>((resolve) => {
          const timer = setTimeout(() => {
            timedOut = true;
            waiters.delete(id);
            resolve({ ok: false, query: text, lines: [`查询超时（渲染页 ${DEBUG_QUERY_TIMEOUT_MS}ms 内没回执）`] });
          }, DEBUG_QUERY_TIMEOUT_MS);
          waiters.set(id, (r) => {
            clearTimeout(timer);
            waiters.delete(id);
            resolve(r);
          });
          push('renderer-debug-query', { id, text });
        });
        // ★超时与"没人连"必须可区分：前者 504（连了但不答 ⇒ 页面卡住/命令没实现），
        //   后者 503（没有渲染页 ⇒ 先把画面打开）。agent 侧据此决定下一步。
        return sendJson(res, timedOut ? 504 : 200, result);
      }
      if (method === 'push') {
        // 控制面注入（供 agent 侧 CLI / 插件代理调用）：把一条消息扇出给所有页面。
        const { args } = await readArgs(req);
        const channel = String(args[0] ?? '');
        if (!channel) throw new Error('push：args[0] 必须是 channel');
        push(channel, ...args.slice(1));
        sendJson(res, 200, { pushed: channel, clients: clients.size });
        return;
      }
      await handleApi(method, req, res);
      return;
    }

    // ---- 静态产物 ----
    if (req.method === 'GET' || req.method === 'HEAD') {
      serveStatic(p === '/' ? '/index.html' : p, res);
      return;
    }
    sendJson(res, 405, { error: `method not allowed: ${req.method}` });
  }

  /**
   * 渲染页 → 宿主的**单向**消息（`ipcRenderer.send` 的等价物）。
   *
   * 通道名与 `electron/preload.ts` 的那批 `send` 一一对应；这里把它们落到**同一个**
   * `HostService` 的 appenders 上 ⇒ 默认实例下与 Electron 的落点/文案完全一致（`T-0133` §B.3.1）。
   */
  function handleEvent(channel: string, args: unknown[]): void {
    const text = String(args[0] ?? '');
    switch (channel) {
      case 'log-line':
        app.log.write(text);
        return;
      case 'log-line-sync':
        // 同步落尾（关窗/卸载路径）—— 这是唯一"曾经同步"的通道（`T-0133` §4.3）。
        app.logSync(text);
        return;
      case 'append-trace-line':
        app.trace.write(text);
        return;
      case 'append-replay-line':
        app.replay.write(text);
        return;
      case 'renderer-status': {
        // 状态上报：调试用途下只落日志（控制面板在 Phase 2 是"代理 + SSE"，见 notes §3）。
        //
        // ★`frames` **必须**提到前面来单独打（`tickets/T-0138`）：整条 payload 被
        //   `slice(0, 200)` 截断，而 `frames` 窝在 `perf` 里、早就被截掉 ⇒ 排查"frames 会不会
        //   回零/回落"时，日志里根本没有这个数（当时只能靠注册表每 5s 的心跳去猜，白绕了很多圈）。
        //   它小且是判"实例有没有被重启"的关键量 ⇒ 顶到最前面，稳定可 grep。
        const raw = args[0] as { perf?: { frames?: unknown }; observer?: unknown } | null | undefined;
        const frames = raw && raw.perf && typeof raw.perf.frames === 'number' ? raw.perf.frames : null;
        const who = raw && typeof raw.observer === 'number' ? `#${raw.observer}` : '#?';
        // ★来源（`observer`）与 `frames` 并列打在最前：两个页面附着时，只有带上来源才看得出
        //   "两套计数器在交错"（`T-0138` 的 `402→35` 就是这么来的，见 `viewerSeq` 注释）。
        log(`[web] status obs=${who} frames=${frames === null ? '?' : frames} ${JSON.stringify(raw ?? null).slice(0, 200)}`);
        // ★`T-0136`：同一份 payload 顺手收窄成摘要，交给心跳发布（面板据此显示"跑到哪支 BIN/第几帧"）。
        //   形状不认识 ⇒ `lastStatus` 保持上一次的值，**不抛**（这条通道由渲染页发，字段集随版本演进）。
        const summary = summarizeStatus(args[0]);
        if (summary) lastStatus = summary;
        return;
      }
      case 'renderer-debug-query-result': {
        // ★按 `id` 配对上面那个 `debug-query` 的等待者（与 `electron/ipc/control.ts:113` 同一手法）。
        const payload = (args[0] ?? {}) as { id?: unknown; result?: unknown };
        const w = waiters.get(Number(payload.id));
        if (w) w(payload.result);
        else log(`[web] 收到无主的 debug-query 回执 id=${String(payload.id)}`);
        return;
      }
      case 'renderer-break-paused':
      case 'renderer-break-list':
        push(channel, ...args);
        return;
      case 'close-window':
        log('[web] 渲染页请求关闭（abort 0x1）—— web 形态下页面由 DSH 的 iframe 持有，这里只记一条');
        return;
      default:
        log(`[web] 未处理的单向通道 ${channel}（参数 ${JSON.stringify(args).slice(0, 120)}）`);
    }
  }

  async function handleApi(method: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const { args, payload } = await readArgs(req);
    const n = (i: number): number => Number(args[i] ?? 0);
    const s = (i: number): string => String(args[i] ?? '');
    switch (method) {
      case 'read-script': {
        const r = await app.readScript(n(0));
        return r ? sendBin(res, [Uint8Array.from(r.data)], { index: r.index, name: r.name }) : sendBin(res, []);
      }
      case 'read-script-by-name': {
        const r = await app.readScriptByName(s(0));
        return r ? sendBin(res, [Uint8Array.from(r.data)], { index: r.index, name: r.name }) : sendBin(res, []);
      }
      case 'read-file':
        return sendBin(res, [Uint8Array.from(await app.readFile(s(0)))]);
      case 'append-packs':
        return sendJson(res, 200, await app.appendPackNumbers());
      case 'read-config-ini':
        return sendJson(res, 200, await app.readConfigIni());
      case 'save-config-ini':
        return sendJson(res, 200, await app.saveConfigIni(s(0)));
      case 'read-emulator-options':
        return sendJson(res, 200, app.readEmulatorOptions());
      case 'read-save-data': {
        const b = await app.readSaveData();
        return sendBin(res, b ? [b] : []);
      }
      case 'write-save-data':
        return sendJson(res, 200, await app.writeSaveData(payload ?? new Uint8Array(0)));
      case 'read-save-flags':
        return sendJson(res, 200, await app.readSaveFlags());
      case 'read-save-data-both':
        return sendBin(res, await app.readSaveDataBoth());
      case 'read-save-slot': {
        const b = await app.readSaveSlot(n(0));
        return sendBin(res, b ? [b] : []);
      }
      case 'write-save-slot':
        return sendJson(res, 200, await app.writeSaveSlot(n(0), payload ?? new Uint8Array(0)));
      case 'delete-save-slot':
        return sendJson(res, 200, await app.deleteSaveSlot(n(0)));
      case 'copy-save-slot':
        return sendJson(res, 200, await app.copySaveSlot(n(0), n(1)));
      case 'read-slot-thumb': {
        const b = await app.readSlotThumb(n(0));
        return sendBin(res, b ? [b] : []);
      }
      case 'write-slot-thumb':
        return sendJson(res, 200, await app.writeSlotThumb(n(0), payload ?? new Uint8Array(0)));
      case 'image': {
        const img = await app.image(n(0));
        return img
          ? sendBin(res, [img.data], { name: img.name, width: img.width, height: img.height })
          : sendBin(res, []);
      }
      case 'read-by-id': {
        const r = await app.readById(n(0));
        return r ? sendBin(res, [r.data], { name: r.name }) : sendBin(res, []);
      }
      case 'audio': {
        const key = args[0];
        const b = await app.audio(typeof key === 'string' ? key : n(0));
        return sendBin(res, b ? [b] : []);
      }
      case 'music-table':
        return sendJson(res, 200, await app.musicTable());
      case 'font': {
        const b = await app.font(s(0));
        return sendBin(res, b ? [b] : []);
      }
      default:
        return sendJson(res, 404, { error: `unknown api: ${method}` });
    }
  }

  /**
   * 静态产物自检（`tickets/T-0143`）：`index.html` 不在就**在启动时**把话说清楚。
   *
   * 为什么值得单做一件事（本工程实测踩过）：`dist/` 整个被 `.gitignore` 忽略，产物缺失只能靠人重跑
   * 构建；而缺产物时宿主只会回一个 `{"error":"not found: index.html"}`——那句话把"你没构建"
   * 和"请求了一个不存在的资源"压成同一个 404，排障方向会被带到插件路由/反向代理/端口上去。
   * 这里在 listen 成功时打一条**含绝对路径 + 可照抄命令**的告警（不阻止启动：实例仍然活着，
   * 这一点本身也是有用的信息）。
   */
  function checkDistAssets(): void {
    const required = ['index.html', 'bridge.js', 'renderer.js'];
    const missing = required.filter((f) => {
      try {
        return !fs.existsSync(path.join(distDir, f));
      } catch {
        return true;
      }
    });
    if (missing.length === 0) return;
    log(
      `[web] ⚠ web 产物缺失（${missing.join(' / ')}）⇒ 渲染页打不开，DSH 面板会显示 ` +
        `{"error":"not found: ${missing[0]}"}。\n` +
        `[web]   产物目录：${distDir}\n` +
        '[web]   修法：cd app/amayui-emulator && node build-electron.mjs\n' +
        '[web]   （实例本身照常运行、/health 正常；缺的只是"给页面看的静态产物"）',
    );
  }

  function serveStatic(p: string, res: http.ServerResponse): void {
    const rel = decodeURIComponent(p).replace(/^\/+/, '');
    const full = path.resolve(distDir, rel);
    // 目录逃逸守卫（与 `electron/ipc/files.ts` 的 font 白名单同口径）。
    if (!full.startsWith(distDir + path.sep) && full !== distDir) {
      sendJson(res, 403, { error: 'path escapes dist' });
      return;
    }
    let data: Buffer;
    try {
      data = fs.readFileSync(full);
    } catch {
      // ★缺的就是那几个产物 ⇒ 回一个**能指向修法**的 404（而不是光秃秃的 `not found`）。
      const isBuildArtifact = rel === 'index.html' || rel === 'bridge.js' || rel === 'renderer.js';
      sendJson(res, 404, {
        error: `not found: ${rel}`,
        ...(isBuildArtifact
          ? {
              reason: 'web 产物未构建（dist/web 里没有这个文件）',
              distDir,
              fix: 'cd app/amayui-emulator && node build-electron.mjs',
            }
          : {}),
      });
      return;
    }
    const ext = path.extname(full).toLowerCase();
    const type =
      ext === '.html'
        ? 'text/html; charset=utf-8'
        : ext === '.js'
          ? 'text/javascript; charset=utf-8'
          : ext === '.css'
            ? 'text/css; charset=utf-8'
            : ext === '.png'
              ? 'image/png'
              : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'content-length': String(data.length) });
    res.end(data);
  }

  function push(channel: string, ...args: unknown[]): void {
    const frame = `data: ${JSON.stringify({ channel, args })}\n\n`;
    for (const c of clients) {
      try {
        c.write(frame);
      } catch {
        clients.delete(c);
      }
    }
  }

  return {
    server,
    port: () => {
      const a = server.address();
      return typeof a === 'object' && a ? a.port : 0;
    },
    push,
    close: closeHost,
    detachHeadless: (): void => {
      if (!headlessChild) return;
      try {
        headlessChild.kill('SIGTERM');
      } catch {
        /* 已经没了 */
      }
      headlessChild = null;
    },
    listen: () =>
      new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(opts.port ?? 8899, opts.host ?? '127.0.0.1', () => {
          const port = (server.address() as { port: number }).port;
          // ---- 注册表（`T-0136`）：listen 成功才登记，端口用**真实**那一个（`--port 0` 时 OS 分配）----
          startedAt = Date.now();
          observerStartedAt = startedAt;
          record = {
            id: instance,
            pid: process.pid,
            port,
            host: opts.host ?? '127.0.0.1',
            repoRoot: opts.repoRoot,
            startedAt,
            heartbeatAt: startedAt,
          };
          publishRecord();
          heartbeatTimer = setInterval(publishRecord, HEARTBEAT_MS);
          heartbeatTimer.unref?.();
          if (idleSec > 0) {
            // ★秒级阈值也要秒级生效（否则 `--idle-sec 1` 得等 15s 才被查一次）；
            //   正常 600s 配置下就是 15s 一查。
            const every = Math.min(IDLE_CHECK_MS, Math.max(250, idleSec * 1000));
            idleTimer = setInterval(idleTick, every);
            idleTimer.unref?.();
          }
          // ★静态产物自检（`T-0143`）：放在 `resolve(port)` **之前**，让所有启动期日志都先写完 ——
          //   否则 `await web.listen()` 的调用方会在横幅（"就绪 http://…"）**之前**拿到端口，
          //   于是任何"看到端口就断言横幅"的调用方（如 `host-registry.test.ts`）会偶发假红。
          checkDistAssets();
          resolve(port);
          // ★自持无头渲染页（`T-0140`）：**在 listen 之后**才附 —— 它要连的是这个真实端口
          //   （`--port 0` 时端口只有这里才知道）。缺省关 ⇒ 这里一个字节的行为都不变。
          if (opts.attachHeadless) attachHeadless(port);
        });
      }),
  };
}

/** CLI：`node --import tsx src/web/host.ts --instance a --port 8899 [--idle-sec 600] [--attach-headless]`。 */
if (process.argv[1] && /web[\\/]host\.[cm]?[jt]s$/.test(process.argv[1])) {
  const argOf = (name: string, dflt?: string): string | undefined => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : dflt;
  };
  const repoRoot = argOf('--repo-root') ?? path.resolve(import.meta.dirname, '..', '..', '..', '..');
  const idleRaw = argOf('--idle-sec');
  // `--attach-headless` 是**存在即真**的开关（不给值），也可用 env `AMAYUI_ATTACH_HEADLESS=1`。
  const attachHeadless =
    process.argv.includes('--attach-headless') ||
    ['1', 'true', 'yes'].includes(String(process.env.AMAYUI_ATTACH_HEADLESS ?? '').toLowerCase());
  const web = createWebHost({
    repoRoot,
    instance: argOf('--instance', 'default'),
    port: Number(argOf('--port', '8899')),
    host: argOf('--bind', '127.0.0.1'),
    // 不给就用 env `AMAYUI_WEB_IDLE_SEC`，再缺省 600（`resolveIdleSec`）。
    idleSec: idleRaw !== undefined ? Number(idleRaw) : undefined,
    attachHeadless,
    // 缺省 `<repoRoot>/app/amayui-emulator/dist/web`；显式给是为了让守卫测试能指向临时目录
    // （`tickets/T-0143`：缺产物与齐产物两种情形的判据都要能在**不依赖本机 dist/** 的情况下跑）。
    distDir: argOf('--dist-dir'),
  });
  const port = await web.listen();
  console.log(
    `[web] 就绪 http://127.0.0.1:${port}/（实例 ${argOf('--instance', 'default')}` +
      `${attachHeadless ? '；已开 --attach-headless' : ''}；Ctrl-C 收工）`,
  );
  const bye = async (): Promise<void> => {
    try {
      await web.close();
    } finally {
      // ★`close()` 里会摘掉注册项；即便它抛了也要退（退出码 0 = 正常收工，不是崩溃）。
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void bye());
  process.on('SIGTERM', () => void bye());
  // ★兜底：任何非信号退出路径（未捕获异常、`close()` 之外的 `process.exit`）也要把无头子进程带走，
  //   否则它会留着一个连着死宿主的渲染页（占着 Electron 窗口 + 重连风暴）。
  process.on('exit', () => {
    try {
      web.detachHeadless?.();
    } catch {
      /* 退出路径尽力而为 */
    }
  });
}
