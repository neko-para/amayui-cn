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

  /** SSE 客户端（`push` 的扇出目标）。 */
  const clients = new Set<http.ServerResponse>();
  /** 调试查询的等待者（`id` → resolve）；与 `electron/ipc/control.ts` 的 `debugQueryWaiters` 同形。 */
  const waiters = new Map<number, (result: unknown) => void>();
  let querySeq = 0;

  // ---- 注册表 / 心跳 / 闲置（`T-0136`）----
  /** 最近一次"任何请求"（含 `/events`、静态、`/api/*`）的时刻；闲置判据的活动基准。 */
  let lastActivityMs = Date.now();
  /** listen 成功的时刻（与 `InstanceRecord.startedAt` 同值）。 */
  let startedAt = 0;
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

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((err: Error) => {
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
      });
      return;
    }

    // ---- 健康检查（冒烟/代理就绪探测用）----
    if (p === '/health') {
      sendJson(res, 200, { ok: true, instance, layout: app.layout, distDir });
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
        log(`[web] status ${JSON.stringify(args[0] ?? null).slice(0, 200)}`);
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
      sendJson(res, 404, { error: `not found: ${rel}` });
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
    listen: () =>
      new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(opts.port ?? 8899, opts.host ?? '127.0.0.1', () => {
          const port = (server.address() as { port: number }).port;
          // ---- 注册表（`T-0136`）：listen 成功才登记，端口用**真实**那一个（`--port 0` 时 OS 分配）----
          startedAt = Date.now();
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
          resolve(port);
        });
      }),
  };
}

/** CLI：`node --import tsx src/web/host.ts --instance a --port 8899 [--idle-sec 600]`。 */
if (process.argv[1] && /web[\\/]host\.[cm]?[jt]s$/.test(process.argv[1])) {
  const argOf = (name: string, dflt?: string): string | undefined => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : dflt;
  };
  const repoRoot = argOf('--repo-root') ?? path.resolve(import.meta.dirname, '..', '..', '..', '..');
  const idleRaw = argOf('--idle-sec');
  const web = createWebHost({
    repoRoot,
    instance: argOf('--instance', 'default'),
    port: Number(argOf('--port', '8899')),
    host: argOf('--bind', '127.0.0.1'),
    // 不给就用 env `AMAYUI_WEB_IDLE_SEC`，再缺省 600（`resolveIdleSec`）。
    idleSec: idleRaw !== undefined ? Number(idleRaw) : undefined,
  });
  const port = await web.listen();
  console.log(`[web] 就绪 http://127.0.0.1:${port}/（实例 ${argOf('--instance', 'default')}；Ctrl-C 收工）`);
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
}
