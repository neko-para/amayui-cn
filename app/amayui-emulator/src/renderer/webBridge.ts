/**
 * **`window.api` 的 web 实现**（`tickets/T-0134` Phase 2；设计来源 `tickets/T-0133` §3 的通道映射表）。
 *
 * ## 它替代了什么
 *
 * Electron 侧 `window.api` 由 `electron/preload.ts` 经 contextBridge 给出，形态只有四种
 * （`invoke` / `send` / `sendSync` / `on`）。这里给出**同形**的浏览器实现：
 *
 * | preload 形态 | 这里 |
 * |---|---|
 * | `ipcRenderer.invoke` | `POST <base>/<method>`（JSON args；二进制响应用信封，见 `src/web/envelope.ts`） |
 * | `ipcRenderer.send`（单向） | `POST <base>/event`（`{channel, args}`；关窗路径用 `sendBeacon`） |
 * | `ipcRenderer.sendSync`（**唯一同步**：`logLineSync`） | `navigator.sendBeacon` —— 返回值本来就没人用（`traceLog.ts:49`），语义损失仅"极端情况尾部几行日志" |
 * | `ipcRenderer.on`（订阅） | `GET <base>/events` 的 SSE，按 `channel` 派发 |
 *
 * ⇒ **VM / 场景 / Pixi 代码零改动**：`boot.ts`、`ipcFileSource.ts`、`renderer.ts` 一行都不用动，
 * 只要在这个对象装好之后（`renderer.js` 之前）把它挂到 `window.api`。
 *
 * ## 三个刻意的取舍
 *
 * 1. **不提供 `audioStreamBase`** ⇒ `WebAudioHost` 的 `streamUrl()` 返回 undefined，引擎退回
 *    `load + decode + play`（`T-0133` §B.2 的正式降级路径）；调试用途本来就静音（`audio.enabled=false`）。
 * 2. **不提供 `setSystemCursor`** ⇒ 渲染侧调用点写的是 `?.`，缺失即 no-op（`T-0133` §0.9 订正 2：
 *    这是"可做但故意不做"，不是能力缺口）。
 * 3. **字节一律以 `Uint8Array` 返回**（不是 Electron 的 `number[]`）：`ipcFileSource` 拿到就
 *    `new Uint8Array(x)`，而 `new Uint8Array(uint8)` 是合法拷贝 ⇒ 运行期同义、且省掉
 *    "MB 级数组转 JS number[]"那一次放大。类型上按 `Window['api']` 的口径断言（见 `api()`）。
 *
 * ★**可测性**：`fetch` 与 `EventSource` 都可注入（与 `WebAudioHost` 注入 `createContext` 同法）——
 *   否则这条桥只能靠"真跑一遍浏览器"验证，而那正是本工程反复吃过亏的地方。
 */
import { KIND_HEADER, META_HEADER, decodeEnvelope, encodeEnvelope, formatMeta, parseMeta } from '../web/envelope.js';

/** SSE 事件的最小形状（`EventSource` 的子集；便于注入假实现）。 */
export interface EventSourceLike {
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close(): void;
}

export interface WebBridgeOptions {
  /** API 前缀（缺省同源 `/dsh-emulator/api`）。 */
  base?: string;
  /** SSE 端点（缺省 `<base>` 的兄弟路径 `/dsh-emulator/events`）。 */
  eventsPath?: string;
  /** 诊断输出（缺省 `console.debug` 之外的静默；宿主可接进日志通道）。 */
  log?: (line: string) => void;
  /** 注入 fetch（测试用）。 */
  fetchImpl?: typeof fetch;
  /** 注入 EventSource 工厂（测试用）。 */
  createEventSource?: (url: string) => EventSourceLike;
  /** 注入 sendBeacon（测试用；缺省 `navigator.sendBeacon`）。 */
  beacon?: (url: string, data: string) => boolean;
}

/** 一次 RPC 的解析结果。 */
interface RpcResult {
  kind: 'json' | 'bin';
  json: unknown;
  meta: Record<string, unknown>;
  parts: Uint8Array[];
}

export class WebBridge {
  readonly #base: string;
  readonly #events: string;
  readonly #log: (line: string) => void;
  /**
   * `fetch` 的**裸调包装**。
   *
   * ★**真 bug 的教训（`T-0135` 端到端实跑抓到的）**：把 `fetch` 存进字段再 `this.#fetch(url)`
   *   调用时，receiver 是**这个桥实例**，而浏览器里 `fetch` 是 `Window` 上的方法 ⇒
   *   `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`。
   *   裸调 `fetch(...)`（`this` 为 undefined）才被 WebIDL 当作全局接收者。
   *   ★Node 的 `fetch` 不挑 receiver ⇒ `test/web-bridge.test.ts` 注入的假 fetch 抓不到这个错，
   *     所以这条包装 + 那条"receiver 不许是桥实例"的断言必须一直在。
   */
  readonly #fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readonly #makeEs: ((url: string) => EventSourceLike) | null;
  readonly #beacon: ((url: string, data: string) => boolean) | null;
  /** channel → 订阅者集合（`onX` 的注册表）。 */
  readonly #listeners = new Map<string, Set<(value: unknown) => void>>();
  #es: EventSourceLike | null = null;
  /**
   * 本页面在**宿主**那边的观察者序号（`tickets/T-0140`）：宿主在 SSE 首帧用 `observer` 通道下发。
   *
   * ★为什么页面要记它：`renderer-status` 原本无法归因 —— 两个页面附着同一实例时，两套 `frames`
   *   计数器交错写进宿主日志，看起来就像"一个 VM 的 frames 回落"（`T-0138` 实跑踩过）。
   *   带上序号后每条状态都能按来源拆开看。
   */
  #observerId: number | null = null;
  /** 宿主进程的 `startedAt`（随 `observer` 一起下发）。宿主重启 ⇒ 它变了 ⇒ 序号要重新认领。 */
  #observerHost: number | null = null;

  constructor(opts: WebBridgeOptions = {}) {
    this.#base = (opts.base ?? '/dsh-emulator/api').replace(/\/$/, '');
    this.#events = opts.eventsPath ?? `${this.#base.replace(/\/api$/, '')}/events`;
    this.#log = opts.log ?? ((): void => {});
    const raw = opts.fetchImpl ?? fetch;
    this.#fetch = (input, init) => raw(input, init);
    this.#makeEs =
      opts.createEventSource ??
      (typeof EventSource !== 'undefined' ? (url: string) => new EventSource(url) as unknown as EventSourceLike : null);
    this.#beacon =
      opts.beacon ??
      (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
        ? (url: string, data: string) => navigator.sendBeacon(url, data)
        : null);
  }

  // ==================== 传输 ====================

  /** 发一次 RPC 并把响应解成 `{kind, json, meta, parts}`（**不**吞错：失败要让调用方看见）。 */
  async #rpc(method: string, args: unknown[], body?: Uint8Array): Promise<RpcResult> {
    const url = `${this.#base}/${method}`;
    const init: RequestInit = body
      ? {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream', 'x-amayui-args': formatMeta({ args }) },
          body: body as unknown as BodyInit,
        }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ args }) };
    const res = await this.#fetch(url, init);
    if (!res.ok) {
      throw new Error(`web 桥 ${method} 失败：HTTP ${res.status} ${res.statusText}`);
    }
    const kind = (res.headers.get(KIND_HEADER) ?? 'json') === 'bin' ? 'bin' : 'json';
    const meta = parseMeta(res.headers.get(META_HEADER));
    if (kind === 'json') {
      return { kind, json: await res.json(), meta, parts: [] };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    return { kind, json: null, meta, parts: decodeEnvelope(buf) };
  }

  /** JSON RPC。 */
  async #json(method: string, ...args: unknown[]): Promise<unknown> {
    return (await this.#rpc(method, args)).json;
  }

  /** 二进制 RPC：0 段 = "取不到"（与 Electron 侧的 `null` 同义），1 段 = 有效载荷。 */
  async #bin(method: string, ...args: unknown[]): Promise<{ meta: Record<string, unknown>; bytes: Uint8Array | null }> {
    const r = await this.#rpc(method, args);
    return { meta: r.meta, bytes: r.parts.length > 0 ? r.parts[0]! : null };
  }

  /** 二进制入参 RPC（写存档/写槽：body 是单段信封，其余参数走 `x-amayui-args`）。 */
  async #sendBytes(method: string, bytes: Uint8Array, ...args: unknown[]): Promise<unknown> {
    const { encodeEnvelope } = await import('../web/envelope.js');
    return (await this.#rpc(method, args, encodeEnvelope([bytes]))).json;
  }

  /** 单向消息（`ipcRenderer.send` 的等价物）。 */
  #send(channel: string, ...args: unknown[]): void {
    void this.#fetch(`${this.#base}/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel, args }),
    }).catch((err: Error) => this.#log(`[web] event ${channel} 发送失败：${err.message}`));
  }

  /** 订阅一个主→页 的 channel；返回取消订阅函数（`ipcRenderer.on` 的等价物）。 */
  #on(channel: string, cb: (value: unknown) => void): () => void {
    let set = this.#listeners.get(channel);
    if (!set) {
      set = new Set();
      this.#listeners.set(channel, set);
    }
    set.add(cb);
    this.connect();
    return () => {
      set!.delete(cb);
    };
  }

  /** 建立 SSE 长连（幂等）。渲染入口应在 boot 前调一次；`onX` 也会懒调它。 */
  connect(): void {
    if (this.#es || !this.#makeEs) {
      if (!this.#makeEs) this.#log('[web] 没有 EventSource ⇒ 主→页 的推送不可用（订阅会静默收不到）');
      return;
    }
    const es = this.#makeEs(this.#events);
    es.onmessage = (ev) => this.#dispatch(ev.data);
    es.onerror = (err) => this.#log(`[web] SSE 连接异常：${String(err)}（浏览器会自动重连）`);
    this.#es = es;
    this.#log(`[web] SSE 已连接：${this.#events}`);
  }

  /** 拆掉 SSE（关窗/卸载路径；`EventSource` 不拆会拖着连接）。 */
  close(): void {
    this.#es?.close();
    this.#es = null;
  }

  #dispatch(data: string): void {
    let o: { channel?: unknown; args?: unknown };
    try {
      o = JSON.parse(data);
    } catch {
      this.#log(`[web] SSE 帧不是 JSON：${data.slice(0, 120)}`);
      return;
    }
    const channel = typeof o.channel === 'string' ? o.channel : '';
    // ★观察者序号（`T-0140`）：宿主在 SSE 首帧下发，**不进订阅表**（没有业务订阅者）。
    //   宿主重启后序号会从头再发 ⇒ 用它带来的 `startedAt` 判断"是不是同一个宿主"，避免旧序号留用。
    if (channel === 'observer') {
      const p = (Array.isArray(o.args) ? o.args[0] : null) as { id?: unknown; hostStartedAt?: unknown } | null;
      if (p && typeof p.id === 'number') {
        const host = typeof p.hostStartedAt === 'number' ? p.hostStartedAt : null;
        if (this.#observerHost !== null && host !== null && this.#observerHost !== host) this.#observerId = null;
        this.#observerHost = host;
        this.#observerId = p.id;
        this.#log(`[web] 观察者序号 #${p.id}（宿主 startedAt=${host ?? '?'}）`);
      }
      return;
    }
    const set = this.#listeners.get(channel);
    if (!set || set.size === 0) return;
    const value = Array.isArray(o.args) ? o.args[0] : undefined;
    for (const cb of set) cb(value);
  }

  // ==================== `window.api` ====================

  /**
   * 造出与 `Window['api']` **同形**的对象。
   *
   * 故意**不提供**的成员（都已在注释里说明理由）：
   * `audioStreamBase`（走静音/解码退化）、`setSystemCursor`（可做但故意不做）、`record*`（录制是
   * Electron 录制器的场景）、以及全部 `control*`（控制面板是另一个页面，不是这个 iframe）。
   * 调用点对这些成员一律写了 `?.`（`ipcProtocol.ts` 把它们声明为可选），所以缺失是**受支持的降级**。
   */
  api(): Window['api'] {
    const bridge = this;
    const api = {
      // ---- 资源读取（字节一律 Uint8Array；见文件头的取舍 3）----
      readScript: async (index: number) => {
        const { meta, bytes } = await bridge.#bin('read-script', index);
        if (!bytes) return null;
        return { index: Number(meta.index ?? index), name: String(meta.name ?? ''), data: bytes } as never;
      },
      readScriptByName: async (name: string) => {
        const { meta, bytes } = await bridge.#bin('read-script-by-name', name);
        if (!bytes) return null;
        return { index: Number(meta.index ?? -1), name: String(meta.name ?? name), data: bytes } as never;
      },
      readFile: async (p: string) => (await bridge.#bin('read-file', p)).bytes as never,
      /**
       * **落一份调试取证产物**（`capture` 的 PNG；`tickets/T-0180` ②）：字节走 `application/octet-stream`
       * POST（单段信封，与 `writeSaveSlot` 同一条腿），回执是 JSON（路径/字节数）—— 那条 JSON 腿因此
       * 不必再搬 ~2.4MB 的 base64。宿主拒绝（非法名/写失败）⇒ 返回 `null`，调用方回退 base64。
       */
      writeDebugArtifact: async (name: string, data: Uint8Array) => {
        const r = (await bridge.#sendBytes('write-debug-artifact', data, name)) as
          | { path?: unknown; dir?: unknown; bytes?: unknown }
          | null;
        // ★宿主**拒绝**（非法名/写失败）时回的是 `{error}`，不是抛错 ⇒ 这里收窄成 `null`
        //   （声明的语义就是"落不了盘"），调用方据此回退 base64 —— 抓到的帧不能因为落盘失败就丢。
        if (!r || typeof r.path !== 'string' || typeof r.dir !== 'string') return null;
        return { path: r.path, dir: r.dir, bytes: Number(r.bytes ?? data.length) };
      },
      appendPacks: async () => (await bridge.#json('append-packs')) as number[],
      readConfigIni: async () => (await bridge.#json('read-config-ini')) as never,
      saveConfigIni: async (text: string) => (await bridge.#json('save-config-ini', text)) as never,
      readEmulatorOptions: async () => (await bridge.#json('read-emulator-options')) as never,
      readSaveData: async () => (await bridge.#bin('read-save-data')).bytes,
      writeSaveData: async (data: Uint8Array) => {
        await bridge.#sendBytes('write-save-data', data);
      },
      readSaveFlags: async () => (await bridge.#json('read-save-flags')) as number[] | null,
      readSaveDataBoth: async () => {
        const r = await bridge.#rpc('read-save-data-both', []);
        return r.parts;
      },
      readSaveSlot: async (slot: number) => (await bridge.#bin('read-save-slot', slot)).bytes,
      // `0x1A0` 槽头：只搬前 292 字节（整份 `.DAT` 有 1~1.5MB，而 LOAD 画面一帧问 120 次 ⇒ 4.8s）
      readSaveSlotHead: async (slot: number) => (await bridge.#bin('read-save-slot-head', slot)).bytes,
      writeSaveSlot: async (slot: number, data: Uint8Array) => {
        await bridge.#sendBytes('write-save-slot', data, slot);
      },
      deleteSaveSlot: async (slot: number) => (await bridge.#json('delete-save-slot', slot)) as never,
      copySaveSlot: async (from: number, to: number) => (await bridge.#json('copy-save-slot', from, to)) as never,
      readSlotThumb: async (slot: number) => (await bridge.#bin('read-slot-thumb', slot)).bytes,
      writeSlotThumb: async (slot: number, data: Uint8Array) => {
        await bridge.#sendBytes('write-slot-thumb', data, slot);
      },
      image: async (id: number) => {
        const { meta, bytes } = await bridge.#bin('image', id);
        if (!bytes) return null;
        return {
          name: String(meta.name ?? ''),
          width: Number(meta.width ?? 0),
          height: Number(meta.height ?? 0),
          data: bytes,
        } as never;
      },
      readById: async (id: number) => {
        const { meta, bytes } = await bridge.#bin('read-by-id', id);
        if (!bytes) return null;
        return { name: String(meta.name ?? ''), data: bytes } as never;
      },
      audio: async (key: number | string) => (await bridge.#bin('audio', key)).bytes,
      musicTable: async () => (await bridge.#json('music-table')) as never,
      font: async (file: string) => (await bridge.#bin('font', file)).bytes,

      // ---- 诊断落盘 ----
      logLine: (text: string) => bridge.#send('log-line', text),
      /**
       * 唯一同步通道的**降级**（`T-0133` §4.3）：`sendBeacon` 是异步且没有返回值，
       * 而调用点（`traceLog.ts:49`）本来就忽略返回值 ⇒ 语义损失仅"极端情况丢尾部几行"。
       */
      logLineSync: (text: string): string => {
        if (bridge.#beacon) bridge.#beacon(`${bridge.#base}/event`, JSON.stringify({ channel: 'log-line-sync', args: [text] }));
        else bridge.#send('log-line-sync', text);
        return '';
      },
      appendTraceLine: (line: string) => bridge.#send('append-trace-line', line),
      appendReplayLine: (line: string) => bridge.#send('append-replay-line', line),
      sendRendererStatus: (s: unknown) => {
        // 附上观察者序号（`T-0140`）：宿主据此把每条状态归因到具体页面。`s` 是对象时浅拷贝加一个字段，
        // 非对象（不该发生）就原样透传 —— 这条通道**绝不允许**因为加诊断字段而把状态本身弄丢。
        const payload =
          s && typeof s === 'object' && !Array.isArray(s) ? { ...(s as object), observer: bridge.#observerId } : s;
        return bridge.#send('renderer-status', payload);
      },
      sendDebugQueryResult: (payload: unknown) => bridge.#send('renderer-debug-query-result', payload),
      sendBreakPaused: (payload: unknown) => bridge.#send('renderer-break-paused', payload),
      sendBreakList: (payload: unknown) => bridge.#send('renderer-break-list', payload),
      closeWindow: () => bridge.#send('close-window'),

      // ---- 主→页 的推送（订阅）----
      onTraceAll: (cb: (enabled: boolean) => void) => bridge.#on('renderer-set-trace-all', cb as (v: unknown) => void),
      onTraceFilter: (cb: (ops: number[]) => void) => bridge.#on('renderer-set-trace-filter', cb as (v: unknown) => void),
      onControlSkipOp: (cb: (opcode: number) => void) => bridge.#on('renderer-skip-op', cb as (v: unknown) => void),
      onDebugQuery: (cb: (payload: { id: number; text: string }) => void) =>
        bridge.#on('renderer-debug-query', cb as (v: unknown) => void),
      onBreakCommand: (cb: (cmd: unknown) => void) => bridge.#on('renderer-break-command', cb),
    };
    return api as unknown as Window['api'];
  }
}

/**
 * 把这条桥装到 `window.api` 上（**必须在 `renderer.js` 之前**）。
 *
 * 为什么由调用方决定"装不装"而不是本模块自动装：`electron/preload.ts` 已经装过一份，
 * 两者同时存在会让"到底走的哪条桥"变成不可判定的事（本工程最忌讳的那种症状）。
 */
export function installWebBridge(opts: WebBridgeOptions = {}): WebBridge {
  const bridge = new WebBridge(opts);
  (globalThis as unknown as { api: Window['api'] }).api = bridge.api();
  bridge.connect();
  return bridge;
}
