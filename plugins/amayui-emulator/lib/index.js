// @amayui/emulator-view — Host half, **pure observer** (`tickets/T-0136`; supersedes the
// start/stop form of `tickets/T-0135`).
//
// ## What it is now
//
// A **read-only window** onto emulator web hosts that *somebody else* started (an agent in a
// terminal, a human, a script). This half NEVER spawns, never stops, never owns a process:
//
//   browser ──/dsh-emulator/<id>/*──▶ [this route: per-instance reverse proxy] ──▶ 127.0.0.1:<port>
//
// ## Where the instance list comes from
//
// The **file registry** (frozen schema, written by the emulator's own web host
// `app/amayui-emulator/src/web/host.ts`). Two layouts, both scanned (dedup by id):
//
//   <workspaceRoot>/.tmp/instances/<id>/instance.json   named instance (--instance dbg-a)
//   <workspaceRoot>/.tmp/instance.json                  default instance (no --instance)
//
//   { id, pid, port, host, repoRoot, startedAt, heartbeatAt, lastStatus?: { bin?, frames?, gate? } }
//
// It is written atomically on listen, refreshed every 5s, deleted on exit. A record is **live**
// iff its `pid` is alive AND `heartbeatAt > Date.now() - 20000`. Reserved id: `api`.
// Because the registry lives on disk, instances started in *another terminal* show up here too —
// that is the whole point of T-0136 (the previous form only knew the child it had spawned).
//
// ## Routes
//
//   GET  /dsh-emulator/api/__instances   → { instances:[{id,port,startedAt,heartbeatAt,bin,frames,gate,viewers}], root, tmpDir, registryDir, staleMs }
//   ANY  /dsh-emulator/<id>/<rest>       → reverse proxy to the live instance (streaming; SSE passes through)
//   GET  /dsh-emulator/ | /dsh-emulator  → 302 to the only live instance, else JSON { instances, hint }
//   unknown id → 404 (never seen) / 410 (record exists but dead, or seen earlier this session)
//
// Service acquisition: `fs` and `webServer` are injected. `webServer` MUST be in `inject`
// (it comes from the `dsh-web-app` bundle, which mounts after the base services) — reading
// `ctx.get('webServer')` at apply time otherwise returns undefined and the route is **silently
// skipped** (the same trap documented in `plugins/ticket-board/README.md` and `plugins/uimap/`).
// `fs` is kept in `inject` because this plugin conceptually reads workspace files; the registry
// itself is scanned with `node:fs` directly (see `tmpDir()`/`instancesDir()` below).
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

export const name = 'amayui-emulator'
export const inject = ['fs', 'webServer']

/** Emulator web host 的路径前缀（与 `lib/client.js` 里的 iframe src 必须是同一个）。 */
const PREFIX = '/dsh-emulator'
/** 触发 `__instances` 扫描的端点段。 */
const INSTANCES_API = 'api/__instances'
/** 保留实例 id：注册表里 `api` 段留给插件自己的控制端点，不允许当实例。 */
const RESERVED_ID = 'api'
/** 缺省实例 id（它的记录落在 `<root>/.tmp/instance.json`，不是 `instances/<id>/`）。 */
const DEFAULT_ID = 'default'
/** 实例 id 的合法形状（与 app 侧 `src/host/registry.ts` 同一口径）。 */
const ID_RE = /^[A-Za-z0-9._-]{1,64}$/

/** id 是否可作实例名（保留段 / `.` / `..` 都不行 —— 后两者会改变路径语义）。 */
function isValidId(id) {
  return ID_RE.test(id) && id !== RESERVED_ID && id !== '.' && id !== '..'
}
/** 记录"活着"的心跳窗口（app 侧每 5s 刷一次 ⇒ 20s = 连续丢 4 次心跳）。 */
const STALE_MS = 20000

export function apply(ctx) {
  const webServer = ctx.webServer
  const getPolicy = () => ctx.get('sandboxPolicy')

  /** 仓库/工作区根：HTTP 请求没有 agent/session 上下文，只能从可选服务/环境拿（uimap 同口径）。 */
  function workspaceRoot() {
    const p = getPolicy()
    if (p && p.workspaceRoot) return p.workspaceRoot
    return process.env.DSH_WORKSPACE_ROOT || process.cwd()
  }

  /**
   * 注册表落点（与 app 侧 `src/host/registry.ts` 同一口径，两种布局都要覆盖）：
   *
   *   <root>/.tmp/instances/<id>/instance.json   具名实例
   *   <root>/.tmp/instance.json                  缺省实例（id = "default"）
   *
   * ★这里**直接用 `node:fs` 而不是注入的 `ctx.fs`**：注册表是我们自己的、gitignored 的
   *   临时区（`.tmp/`），且需要在"纯 HTTP 请求"上下文里按实例热读/热扫（`ctx.fs` 是给
   *   工作区文件的沙箱化通道，为一次 `readdir` 走一层异步 resolve 反而更绕）。app 侧写它、
   *   我们只读它。
   */
  function tmpDir() {
    return path.join(workspaceRoot(), '.tmp')
  }

  function instancesDir() {
    return path.join(tmpDir(), 'instances')
  }

  /** 某实例的记录文件。 */
  function recordFile(id) {
    return path.join(id === DEFAULT_ID ? tmpDir() : path.join(instancesDir(), id), 'instance.json')
  }

  /**
   * 本会话"见过"的实例 id（墓碑）。
   *
   * 记录在实例退出时会被删掉 ⇒ 只看磁盘的话，刚被杀的实例会从"存在但过期(410)"退化成
   * "从没见过(404)"。agent/面板看到过它就说明它存在过，所以这里按会话记一笔：
   * 见过且现在没有活记录 ⇒ 410（更可读的"它没了"），完全没见过 ⇒ 404。
   */
  const seen = new Set()

  /** pid 是否活着（`EPERM` = 活着但不归我管）。 */
  function isAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false
    try {
      process.kill(pid, 0)
      return true
    } catch (err) {
      return err && err.code === 'EPERM'
    }
  }

  /** 读**一个**记录文件（坏 JSON / 半文件 / 缺字段都当不存在 —— 绝不因此炸掉请求）。 */
  function readRecordFile(file) {
    try {
      const rec = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null
      if (typeof rec.id !== 'string' || !isValidId(rec.id)) return null
      if (!Number.isInteger(rec.pid) || rec.pid <= 0) return null
      const port = Number(rec.port)
      if (!Number.isInteger(port) || port <= 0 || port > 65535) return null
      if (!Number.isFinite(Number(rec.heartbeatAt))) return null
      return rec
    } catch {
      return null
    }
  }

  /** 按 id 读记录（含缺省实例那条特殊布局）。 */
  function readRecord(id) {
    if (!isValidId(id)) return null
    const rec = readRecordFile(recordFile(id))
    // 记录里的 id 必须与我们找的一致（防"目录名 ≠ 记录 id"的错位/手工伪造）。
    return rec && rec.id === id ? rec : null
  }

  /** 活记录判定：pid 活着 **且** 心跳在窗口内（与 app 侧 `listInstances` 同口径）。 */
  function isLive(rec) {
    if (!rec) return false
    if (!(Number(rec.heartbeatAt) > Date.now() - STALE_MS)) return false
    return isAlive(Number(rec.pid))
  }

  /**
   * 每实例的**活 SSE 代理连接数**（`viewers`，`tickets/T-0138`）。
   *
   * 为什么在**这一层**数：web 形态下 **VM 跑在页面里** ⇒ 同一个实例被第二个页面附着就是
   * **第二个 VM**，两个 VM 抢同一份 overlay/log。宿主自己的 `/events` 数不到"代理之后的页面数"，
   * 而这个反向代理是**唯一**的入口 ⇒ 在这里按实例数"有几个页面在听 SSE"最准，且**不需要 app 侧改**。
   *
   * 口径：一个响应只要**上游回的是 `text/event-stream`** 就 +1（不是所有 `/events` 请求都算 ——
   * 端口写错/上游不吐 SSE 时不能虚报），`res` 关闭时 -1；用一个 `WeakSet` 保证**每个响应只减一次**
   * （`close`/`error` 可能都来），计数不会被减成负数。
   */
  const viewers = new Map()
  const countedOnce = new WeakSet()

  function viewersOf(id) {
    const n = viewers.get(id)
    return Number.isInteger(n) && n > 0 ? n : 0
  }
  function viewerAdd(id) {
    viewers.set(id, viewersOf(id) + 1)
  }
  function viewerDrop(id) {
    const n = viewersOf(id) - 1
    if (n > 0) viewers.set(id, n)
    else viewers.delete(id)
  }

  /** 一条记录 → 面板用的瘦身形状。 */
  function toEntry(rec) {
    const st = rec.lastStatus && typeof rec.lastStatus === 'object' ? rec.lastStatus : {}
    return {
      id: rec.id,
      port: Number(rec.port),
      startedAt: Number(rec.startedAt) || 0,
      heartbeatAt: Number(rec.heartbeatAt) || 0,
      bin: st.bin ?? null,
      frames: st.frames ?? null,
      gate: st.gate ?? null,
      viewers: viewersOf(rec.id),
    }
  }

  /** 扫描注册表（两种布局，按 id 去重）→ 活实例 + 记墓碑。 */
  function scanInstances() {
    const dir = instancesDir()
    const out = []
    const added = new Set()
    const push = (rec) => {
      seen.add(rec.id)
      if (added.has(rec.id)) return // 两处都登记了同一个 id ⇒ 只留第一条
      if (!isLive(rec)) return
      added.add(rec.id)
      out.push(toEntry(rec))
    }
    // 1) 缺省实例：<root>/.tmp/instance.json
    const def = readRecordFile(path.join(tmpDir(), 'instance.json'))
    if (def && isValidId(def.id)) push(def)
    // 2) 具名实例：<root>/.tmp/instances/<id>/instance.json
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      // 目录还没建 = 一个具名实例都没起过（不是错误）
    }
    for (const ent of entries) {
      if (!ent.isDirectory() || !isValidId(ent.name)) continue
      const rec = readRecordFile(path.join(dir, ent.name, 'instance.json'))
      if (!rec || rec.id !== ent.name) continue // 坏 JSON / 目录名与 id 不符 ⇒ 跳过，不抛
      push(rec)
    }
    out.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)) // 新的在前（面板 UX）
    return { live: out, dir }
  }

  function sendJson(res, status, value, extraHeaders) {
    const body = Buffer.from(JSON.stringify(value ?? null), 'utf8')
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': String(body.length),
      ...(extraHeaders || {}),
    })
    res.end(body)
  }

  /**
   * 反向代理：把浏览器对 `<PREFIX>/<id>/*` 的请求原样转给该实例。
   *
   * ★**流式**：不缓冲、不改写、不设请求/响应超时 —— `/events` 是 SSE 长连（宿主每 15s 发心跳），
   *   任何"空闲超时"都会把它掐断；`api/*` 二进制信封也必须逐字节原样过。
   */
  function proxy(req, res, rec, upstreamPath) {
    const up = http.request(
      {
        host: '127.0.0.1',
        port: rec.port,
        path: upstreamPath,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${rec.port}` },
      },
      (upRes) => {
        res.writeHead(upRes.statusCode || 502, upRes.headers)
        // SSE 的首帧可能还没写；先把响应头推出去，别让浏览器干等。
        if (typeof res.flushHeaders === 'function') res.flushHeaders()
        // ★观察者计数（T-0138）：只有**真的成了 SSE** 才算一个观察者（见 viewers 的注释）。
        const ctype = String(upRes.headers['content-type'] || '')
        if (upstreamPath === '/events' && ctype.indexOf('text/event-stream') >= 0 && !countedOnce.has(res)) {
          countedOnce.add(res)
          viewerAdd(rec.id)
          res.on('close', () => {
            if (!countedOnce.delete(res)) return // 已经减过（close 可能来两次）⇒ 不重复减
            viewerDrop(rec.id)
          })
        }
        upRes.pipe(res)
      },
    )
    up.on('error', (err) => {
      if (!res.headersSent) {
        sendJson(res, 502, { error: `上游实例 <${rec.id}> 出错：${err.message}`, id: rec.id, port: rec.port })
      } else {
        try { res.end() } catch { /* 已经断了 */ }
      }
    })
    // SSE 不能被请求体超时掐断；普通请求也不需要上传超时（本地回环）。
    up.setTimeout(0)
    // 浏览器关掉 iframe/SSE 时，把上游连接也收掉（否则宿主会一直以为还有观察者）。
    res.on('close', () => { try { up.destroy() } catch { /* 已经没了 */ } })
    req.pipe(up)
  }

  function errorJson(res, status, id, reason, hint) {
    if (typeof id === 'string' && id) seen.add(id)
    return sendJson(res, status, { error: reason, id: id || null, hint })
  }

  async function handler(req, res) {
    const url = req.url || ''
    const q = url.indexOf('?')
    const pathname = q >= 0 ? url.slice(0, q) : url
    const search = q >= 0 ? url.slice(q) : ''
    const rel = pathname.replace(/^\/dsh-emulator\/?/, '').replace(/\/+$/, '')

    // ---- 1) 实例清单（唯一"自有"端点；不触发任何进程动作）----
    if (rel === INSTANCES_API || rel === 'api/instances') {
      const { live, dir } = scanInstances()
      return sendJson(res, 200, { instances: live, root: workspaceRoot(), tmpDir: tmpDir(), registryDir: dir, staleMs: STALE_MS })
    }
    if (rel.startsWith('api/') || rel === 'api') {
      return sendJson(res, 404, {
        error: `未知的插件端点：${pathname}`,
        hint: `只有 GET ${PREFIX}/${INSTANCES_API}；实例路径形如 ${PREFIX}/<id>/…`,
      })
    }

    // ---- 2) 裸前缀：恰有一个活实例就跳过去，否则回列表 + 提示 ----
    if (rel === '') {
      const { live } = scanInstances()
      if (live.length === 1) {
        const target = `${PREFIX}/${live[0].id}/`
        res.writeHead(302, { location: target, 'cache-control': 'no-store' })
        res.end()
        return
      }
      return sendJson(res, 200, {
        instances: live,
        hint: live.length === 0
          ? '还没有活实例。实例只由 agent/CLI 起（本面板不负责启动）：cd app/amayui-emulator && node --import tsx src/web/host.ts --instance dbg-a'
          : '有多个活实例，请用 /dsh-emulator/<id>/ 指定一个。',
      })
    }

    // ---- 3) 每实例路径：/dsh-emulator/<id>/<rest> ----
    const slash = rel.indexOf('/')
    const id = slash >= 0 ? rel.slice(0, slash) : rel
    const rest = slash >= 0 ? rel.slice(slash + 1) : ''
    if (!isValidId(id)) {
      return errorJson(res, 404, null, `非法/保留的实例 id：${id}`, `id 需匹配 [A-Za-z0-9._-]{1,64}，且不能是保留段 "${RESERVED_ID}"`)
    }
    const rec = readRecord(id)
    if (!isLive(rec)) {
      const known = rec !== null || seen.has(id)
      return errorJson(
        res,
        known ? 410 : 404,
        id,
        known
          ? `实例 <${id}> 已不在运行（记录${rec ? '在但 pid/心跳已过期' : '已删除'}）`
          : `没有见过实例 <${id}>`,
        `用 GET ${PREFIX}/${INSTANCES_API} 看当前活实例；起一个：cd app/amayui-emulator && node --import tsx src/web/host.ts --instance ${id}`,
      )
    }
    seen.add(id)
    return proxy(req, res, rec, `/${rest}${search}`)
  }

  ctx.effect(() => webServer.register({ kind: 'prefix', path: PREFIX, handler }))

  // ★本插件**不持有任何子进程** ⇒ 没有需要清理的卸载钩子（纯观察，T-0136 的设计）。
}
