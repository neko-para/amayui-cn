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
import { createRequire } from 'node:module'
import { createExecutor, scanRegistry } from './tools.js'

/**
 * `defineTool` **延迟加载**（不是顶层 `import`）。
 *
 * 为什么：本包是**工作区插件**（以 junction 挂在 profile 的 `node_modules/@amayui/` 下），
 * `@deepseek-ai/dsh-tools` 只在**profile 的** node_modules 里 —— 从仓库根直接
 * `node plugins/amayui-emulator/smoke.mjs` 时**解析不到**它。而离线冒烟（`smoke.mjs`）
 * 正是从仓库根跑的，顶层 import 会让**整份冒烟**在解析阶段就 `ERR_MODULE_NOT_FOUND`。
 * 延迟到"真的要注册工具"那一刻（且只在 `ctx.tools` 存在时），面板/代理那两条主路径
 * 就与工具面解耦了 —— 这也让 `smoke.mjs` 能在假 ctx 下走完。
 */
function loadDefineTool() {
  const require_ = createRequire(import.meta.url)
  const mod = require_('@deepseek-ai/dsh-tools')
  return mod.defineTool
}

export const name = 'amayui-emulator'
// ★`tools` 在 `inject` 里：**工具面**必须等工具服务挂上才能注册（与 uimap 同一个坑）。
//   `webServer` 在 `inject` 里：**GUI 面板**的每实例反向代理要等 web 服务挂上；
//   少了它，路由会被**静默跳过**（`ctx.get('webServer')` 在 apply 时是 undefined）。
export const inject = ['fs', 'webServer', 'tools']

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

  // ★GUI 面板**不持有任何子进程** ⇒ 没有需要清理的卸载钩子（纯观察，T-0136 的设计）。
  //   （agent tool 那一半的 `start` 是另一回事：见下面 `spawned` 的注释。）

  // ──────────────────────────────────────────────────────────────────────────
  // agent tool：`amayui_emulator`（`tickets/T-0181`）—— 把"每次现场写一个 .mjs 去驱动
  // emulator"收敛成一次工具调用。实现全在 `lib/tools.js`（纯逻辑、可离线自测）。
  //
  // 为什么放在这一个包里、而不是新建插件：**命令面只有一条**（`POST <instance>/api/debug-query`）。
  // 那个实例端口、注册表布局、"活"的判据（pid + 20s 心跳）都已经在本文件里实现了；
  // 另开一个包就得再抄一遍这些口径（两处真源 = 之后必然漂移的债）。这里只多两件事：
  // 工具注册 + 本进程起的实例的进程句柄。
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * **本进程**起的实例（只用于"我自己起的那个"的收尾）。
   *
   * ★它与"纯观察"不冲突：面板（`lib/client.js`）依然没有任何启动/停止；`start`/`stop` 是
   *   **agent 显式要求**的，句柄也只覆盖这一条来源。别人的实例（人开的、别的终端开的）
   *   一律只读 —— `stop` 要先在注册表里看见它、再显式 `force` 才动，见 `lib/tools.js`。
   */
  const spawned = new Map()

  // ★`ctx.tools` 在**离线冒烟**里是不存在的（`smoke.mjs` 用假 ctx）⇒ 这里要能优雅降级：
  //   工具面挂了就照常注册，没有工具面（或注入没生效）就只打一条日志、**不能让插件装载失败**
  //   —— 面板（`lib/client.js`）与反向代理是这个包的主职责，不该被工具面拖下水。
  if (ctx.tools && typeof ctx.tools.register === 'function') {
    let defineTool = null
    try {
      defineTool = loadDefineTool()
    } catch (err) {
      console.error(`[emudbg] ✗ 加载 @deepseek-ai/dsh-tools 失败（${err && err.message}）⇒ tool 未注册；面板与代理不受影响`)
    }
    if (defineTool) ctx.tools.register(defineTool({
    name: 'amayui_emulator',
    description:
      '驱动《天結いキャッスルマイスター》emulator 的调试实例（起停 / 发调试命令 / 抓帧落盘 / 注入输入 / 计时器 / 等条件），' +
      '取代「每次临时写一个 .mjs 脚本去 fetch debug-query」的做法。' +
      'action=instances 列活实例（id/port/pid/bin/frames/gate/心跳龄，读 .tmp 文件注册表，跨终端可见）；' +
      'action=start 以**受管后台进程**起一个实例（--attach-headless + 静音 + --idle-sec，返回真实端口；没有无头页时 debug-query 必然 503，故缺省开）；' +
      'action=stop 收掉实例（只收本进程起的；别人的要 force=true）；' +
      'action=query 发任意调试命令（run/global/frame/slot/barrier/snapshot/restore/focus…），回执行 + **往返毫秒**；' +
      'action=capture 抓帧 → **PNG 落盘 .tmp/emudbg/**，只回 {path,bytes,width,height}（base64 绝不回传，避免烧上下文）；' +
      'action=input 注入 click/move/leave/press/release/wheel/key（click 缺省**合成悬停**：菜单类界面必须先悬停再点，实测不悬停点不动）；' +
      'action=profile 是 profile on/off/reset/report [minMs]/watch/slow 的封装（归因卡顿用）；' +
      'action=wait 等 bin/gate/frames/global 到某个条件（带超时，替代 sleep + 反复 frame 猜）。' +
      '调试命令表见 app/amayui-emulator/src/vm/debugCommand.ts；坐标是引擎虚拟 1280×720。',
    parameters: {
      action: {
        type: 'string',
        required: true,
        description: 'instances | start | stop | query | capture | input | profile | wait',
      },
      instance: {
        type: 'string',
        description: '实例 id（.tmp/instances/<id>）。start 时可省略（自动生成）；其余动作省略则要求"恰好一个活实例"。',
      },
      command: { type: 'string', description: 'query：一条调试命令原文，如 "frame"、"global 12721e"、"run"。' },
      commands: {
        type: 'array',
        items: { type: 'string' },
        description: 'query：一组命令（逐条量往返毫秒），比连续调用省一轮模型往返。',
      },
      kind: { type: 'string', description: 'input：click | move | leave | press | release | wheel | key' },
      x: { type: 'integer', description: 'input：虚拟坐标 x（0..1280）。' },
      y: { type: 'integer', description: 'input：虚拟坐标 y（0..720）。' },
      button: { type: 'string', description: 'input：left（缺省）| right。' },
      delta: { type: 'integer', description: 'input.kind=wheel：滚轮量（一格 ±120，负 = 下滚）。' },
      vk: { type: 'integer', description: 'input.kind=key：Windows 虚拟键码（38=↑、13=Enter）。' },
      hover: {
        type: 'boolean',
        description: 'input.kind=click：先合成一次悬停（移到旁边再移到目标，等 hover_wait_ms）再点。缺省 true —— 菜单类界面不悬停点不动。',
      },
      hover_wait_ms: { type: 'integer', description: 'input：合成悬停后等多久再点（缺省 250）。' },
      settle_ms: { type: 'integer', description: 'input：整条动作做完后再等多久（缺省 0；配合 capture 时可设 300~1500）。' },
      keyup: { type: 'boolean', description: 'input.kind=key：是否自动补一条 keyup（缺省 true；长按场景设 false）。' },
      port: { type: 'integer', description: 'start：--port（缺省 0 = OS 分配，真实端口从注册表读回）。' },
      idle_sec: { type: 'integer', description: 'start：--idle-sec（缺省 0 = 关掉闲置自停，agent 用的实例不该自己消失）。' },
      headless: { type: 'boolean', description: 'start：是否 --attach-headless（缺省 true；关掉则 agent 发命令必然 503）。' },
      out: { type: 'string', description: 'capture：落盘文件名（相对 .tmp/emudbg/，缺省 <id>-<MMDD-HHMMSS>.png）。' },
      sub: { type: 'string', description: 'profile：on | off | reset | report | watch | slow' },
      min_ms: { type: 'integer', description: 'profile report：只列累计 ≥ 该毫秒的指令（归因卡顿的常用档位 20）。' },
      watch: { type: 'string', description: 'profile sub=watch：on | off' },
      slow_ms: { type: 'integer', description: 'profile sub=slow：慢帧阈值毫秒。' },
      until: {
        type: 'object',
        additionalProperties: true,
        description:
          'wait：条件对象（可多个，全部成立才算达成）。bin（正则，如 "TITLE"）、gate（"free"/"waiting"）、frames_above / frames_below / frames_change（整数）、global（正则，配 global_idx 打在该全局槽那一行上）。',
      },
      global_idx: { type: 'string', description: 'wait：要顺带读的全局 int 下标（十六进制口径，如 12721e），配合 until.global 匹配。' },
      timeout_ms: { type: 'integer', description: '本动作超时（wait 缺省 30000；query/capture 缺省 30000）。' },
      poll_ms: { type: 'integer', description: 'wait：轮询间隔（缺省 200）。' },
      wait_ms: { type: 'integer', description: 'start：等注册表出现活记录的上限（缺省 20000）。' },
      grace_ms: { type: 'integer', description: 'stop：SIGTERM 后等多久再强杀进程树（缺省 8000）。' },
      force: { type: 'boolean', description: 'stop：收掉**不是本进程起的**实例时必须显式给 true。' },
      include_dead: { type: 'boolean', description: 'instances：连"记录在但 pid/心跳已过期"的也列出来（live=false）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean', required: true },
          action: { type: 'string', required: true },
          instance: { type: 'string' },
          elapsedMs: { type: 'integer' },
          note: { type: 'string' },
          path: { type: 'string' },
          bytes: { type: 'integer' },
          width: { type: 'integer' },
          height: { type: 'integer' },
          instances: { type: 'array', items: { type: 'object', additionalProperties: true } },
          results: { type: 'array', items: { type: 'object', additionalProperties: true } },
          lines: { type: 'array', items: { type: 'string' } },
          satisfied: { type: 'boolean' },
        },
      },
      render: (args, value) => [{ type: 'text', text: renderToolResult(value) }],
    },
    // 起实例要等 tsx 冷启 + 无头页；wait 自带 timeout_ms ⇒ 给足上限，别让框架先掐。
    timeoutMs: 300000,
    execute: createExecutor({
      getRoot: () => workspaceRoot(),
      spawned,
      toolLog: (line) => {
        try {
          console.error(line)
        } catch {
          /* 日志失败不影响工具 */
        }
      },
    }),
    }))
  } else {
    console.error('[emudbg] ✗ ctx.tools 不在（工具服务没挂上）⇒ agent tool `amayui_emulator` **未注册**；面板与代理不受影响')
  }

  // 启动时把已有实例打一条（agent 一进来就能从日志看到现场；失败不影响装载）。
  try {
    const { instances } = scanRegistry(workspaceRoot(), true)
    if (instances.length) console.error(`[emudbg] 活实例 ${instances.length} 个：${instances.map((i) => `${i.id}:${i.port}`).join(', ')}`)
  } catch {
    /* 注册表还没建 = 正常 */
  }
}

/**
 * 工具回执的**人读**渲染（模型看到的是同一份 output 对象，这里只决定卡片正文）。
 * 意在"一眼看出发生了什么 + 那条证据"：往返毫秒、PNG 路径与尺寸、超时的条件差在哪。
 */
function renderToolResult(v) {
  if (!v || typeof v !== 'object') return '（空回执）'
  const head = `amayui_emulator ${v.action}${v.instance ? ` <${v.instance}>` : ''}${v.ok === false ? ' · 未达成' : ''}`
  const body = []
  if (v.action === 'instances') {
    for (const i of v.instances || []) {
      body.push(`  ${i.live ? '●' : '○'} ${i.id} port=${i.port} pid=${i.pid} bin=${i.bin || '?'} frames=${i.frames ?? '?'} gate=${i.gate || '?'} 心跳 ${Math.round(i.heartbeatAgeMs / 1000)}s 前`)
    }
  } else if (v.action === 'query') {
    for (const r of v.results || []) {
      body.push(`  $ ${r.cmd}   [HTTP ${r.status} · ${r.roundTripMs}ms]`)
      for (const l of (r.lines || []).slice(0, 12)) body.push(`      ${l}`)
    }
  } else if (v.action === 'capture') {
    body.push(`  PNG → ${v.path}（${v.bytes}B，${v.width}×${v.height}；capture 往返 ${v.pngRoundTripMs}ms）`)
  } else if (v.action === 'input') {
    for (const c of v.commands || []) body.push(`  $ ${c.cmd}   [${c.roundTripMs}ms] ${c.ok ? '' : '✗ '}${c.line || ''}`)
  } else if (v.action === 'wait') {
    for (const c of v.checks || []) body.push(`  ${c.pass ? '✓' : '✗'} ${c.k}: 期望 ${c.want}，实得 ${c.got}`)
  } else if (v.action === 'profile') {
    body.push(`  $ ${v.cmd}   [HTTP ${v.status} · ${v.roundTripMs}ms]`)
    for (const l of (v.lines || []).slice(0, 20)) body.push(`      ${l}`)
  } else if (v.action === 'start' || v.action === 'stop') {
    body.push(`  ${v.note || ''}`)
  }
  body.push(`  ⏱ ${v.elapsedMs ?? 0}ms${v.note && v.action !== 'start' && v.action !== 'stop' ? ` · ${v.note}` : ''}`)
  return [head, ...body].join('\n')
}

