// @amayui/ticket-board — Host half.
//
// Serves the ticket ledger (`tickets/<ID>/ticket.json`, the唯一真源) to the
// browser half as one JSON document over a plain HTTP route. This is a STATIC
// bundle: the process-global `harness.handle`/`host.call` pairing that a dynamic
// Cordis package gets does not exist here, so Client↔Host is HTTP — the same
// choice @amayui/uimap made. Every value in the response is a leaf field copied
// out of the ledger; no Cordis/Session object ever crosses the wire.
//
// Service acquisition: `fs` and `webServer` are declared in `inject`, so Cordis
// parks this plugin until both are mounted. `webServer` comes from the
// `dsh-web-app` bundle, which loads AFTER the base `fs` service; reading
// `ctx.get('webServer')` at apply time without injecting it would return
// undefined and the route would be silently skipped. `sandboxPolicy` is optional
// and read lazily — it is the only place an agentless route can learn the
// workspace root.

export const name = 'amayui-ticket-board'
export const inject = ['fs', 'webServer']

/** A ticket folder is exactly `T-\d{4}`; anything else under tickets/ is ignored. */
const TICKET_DIR = /^T-\d{4}$/
/** Process-doc ordering, mirroring scripts/build-tickets.mjs (known names first). */
const KNOWN_DOCS = ['notes.md', 'changes.md', 'repro.md', 'design.md', 'evidence.md']
const STATUSES = ['doing', 'blocked', 'open', 'done', 'dropped']

const str = (v) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v))
const arr = (v) => (Array.isArray(v) ? v : [])
const msg = (e) => String((e && e.message) || e)

export function apply(ctx) {
  const fs = ctx.fs
  const webServer = ctx.webServer
  const getPolicy = () => ctx.get('sandboxPolicy')

  /**
   * The workspace root an agentless HTTP request should read `tickets/` from.
   * `sandboxPolicy.workspaceRoot` is the deployment's own fallback root and is
   * the authoritative answer; the env var and cwd are last-resort fallbacks so
   * a profile that mounts no policy still resolves something diagnosable (the
   * value is echoed in every response as `root`).
   */
  function workspaceRoot() {
    const policy = getPolicy()
    if (policy && typeof policy.workspaceRoot === 'string' && policy.workspaceRoot) return policy.workspaceRoot
    if (typeof process !== 'undefined' && process.env && process.env.DSH_WORKSPACE_ROOT) return process.env.DSH_WORKSPACE_ROOT
    if (typeof process !== 'undefined' && typeof process.cwd === 'function') return process.cwd()
    return ''
  }

  /** Process docs + evidence-file count of one ticket folder (best effort). */
  async function dirMeta(id, root, signal) {
    const empty = { docs: [], evidenceFiles: 0 }
    try {
      const dir = await fs.resolve('tickets/' + id, { cwd: root })
      const entries = await fs.listDir(dir, signal)
      const docs = entries
        .filter((e) => e.type === 'file' && /\.md$/i.test(e.name))
        .map((e) => e.name)
        .sort((a, b) => (KNOWN_DOCS.indexOf(a) + 1 || 99) - (KNOWN_DOCS.indexOf(b) + 1 || 99) || a.localeCompare(b))
      const ev = entries.find((e) => e.type === 'directory' && e.name === 'evidence')
      let evidenceFiles = 0
      if (ev && ev.target) {
        try {
          const files = await fs.listDir(ev.target, signal)
          evidenceFiles = files.filter((e) => e.type === 'file').length
        } catch (e) { /* an unreadable evidence/ dir is not a ledger error */ }
      }
      return { docs, evidenceFiles }
    } catch (e) {
      return empty
    }
  }

  /** Copy the machine-readable half of one ticket.json into a flat, wire-safe object. */
  async function slimTicket(folder, raw, root, signal) {
    const meta = await dirMeta(folder, root, signal)
    const history = arr(raw.history)
    const last = history.length ? history[history.length - 1] : undefined
    const links = raw.links && typeof raw.links === 'object' ? raw.links : {}
    return {
      id: str(raw.id) || folder,
      dir: folder,
      type: str(raw.type) || 'req',
      status: str(raw.status) || 'open',
      priority: str(raw.priority) || 'P2',
      area: str(raw.area),
      title: str(raw.title),
      why: str(raw.why),
      droppedWhy: str(raw.droppedWhy),
      acceptance: arr(raw.acceptance).map(str),
      tests: arr(raw.tests).map(str),
      blockedBy: arr(raw.blockedBy).map(str),
      evidence: arr(raw.evidence).map((e) => ({
        file: str(e && e.file),
        anchor: str(e && e.anchor),
        note: str(e && e.note),
        line: e && typeof e.line === 'number' ? e.line : undefined,
      })),
      links: {
        docs: arr(links.docs).map(str),
        analysis: arr(links.analysis).map(str),
        tickets: arr(links.tickets).map(str),
      },
      docs: meta.docs,
      evidenceFiles: meta.evidenceFiles,
      historyCount: history.length,
      updatedAt: str(last && last.at),
    }
  }

  /** Read every `tickets/<ID>/ticket.json` and fold the ledger into one payload. */
  async function loadTickets(signal) {
    const root = workspaceRoot()
    if (!fs) return { ok: false, error: 'fs 服务不可用，无法读取票据台账' }
    if (!root) return { ok: false, error: '无法确定工作区根目录（sandboxPolicy.workspaceRoot 为空）' }

    let entries
    try {
      const dir = await fs.resolve('tickets', { cwd: root })
      entries = await fs.listDir(dir, signal)
    } catch (e) {
      return { ok: false, root, dir: 'tickets', error: '读取 tickets/ 失败：' + msg(e) }
    }

    const folders = entries
      .filter((e) => e.type === 'directory' && TICKET_DIR.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name))

    const tickets = []
    const issues = []
    for (const folder of folders) {
      const rel = 'tickets/' + folder.name + '/ticket.json'
      try {
        const file = await fs.resolve(rel, { cwd: root })
        const text = await fs.readText(file, signal)
        const raw = JSON.parse(text)
        if (!raw || typeof raw !== 'object') throw new Error('ticket.json 不是对象')
        tickets.push(await slimTicket(folder.name, raw, root, signal))
      } catch (e) {
        // 坏 JSON 由 tickets.js --validate 报；这里只记录，不让整个看板失败
        issues.push({ id: folder.name, file: rel, error: msg(e) })
      }
    }

    const counts = { total: tickets.length, doing: 0, blocked: 0, open: 0, done: 0, dropped: 0 }
    for (const s of STATUSES) counts[s] = 0
    for (const t of tickets) {
      if (Object.prototype.hasOwnProperty.call(counts, t.status)) counts[t.status] += 1
    }

    return {
      ok: true,
      dir: 'tickets',
      root,
      generatedAt: new Date().toISOString(),
      counts,
      tickets,
      issues,
    }
  }

  function sendJson(res, status, body) {
    const text = JSON.stringify(body)
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(text)),
      'Cache-Control': 'no-store',
    })
    res.end(text)
  }

  async function readJsonBody(req) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const buf = Buffer.concat(chunks)
    if (!buf.length) return {}
    try {
      return JSON.parse(buf.toString('utf8'))
    } catch (e) {
      return {}
    }
  }

  // ---- route: GET|POST /dsh-tickets/api/list ----
  // `webServer.register` joins prefix + '/', so the path must NOT end in a slash.
  if (webServer) {
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/dsh-tickets',
      handler: async (req, res) => {
        try {
          const url = req.url || ''
          const q = url.indexOf('?')
          const pathname = q >= 0 ? url.slice(0, q) : url
          const rel = pathname.replace(/^\/dsh-tickets\/?/, '').replace(/\/$/, '')

          if (req.method === 'POST') await readJsonBody(req)

          if (rel === 'api/list') {
            sendJson(res, 200, await loadTickets(undefined))
            return
          }
          if (rel === '' || rel === 'api') {
            sendJson(res, 200, {
              ok: true,
              endpoints: ['api/list'],
              note: 'GET|POST /dsh-tickets/api/list → 票据台账（tickets/<ID>/ticket.json）汇总',
            })
            return
          }
          sendJson(res, 404, { ok: false, error: 'unknown endpoint: ' + pathname })
        } catch (e) {
          try {
            sendJson(res, 500, { ok: false, error: 'ticket-board route error: ' + msg(e) })
          } catch (e2) { /* headers already sent */ }
        }
      },
    }))
  }
}

// Exported for the offline smoke check (plugins/ticket-board/smoke.mjs); the
// cordis loader only reads `name` / `inject` / `apply`.
export const __internal = { TICKET_DIR, KNOWN_DOCS, STATUSES }
