// @amayui/emulator-view — **agent tool** half (`tickets/T-0181`).
//
// ## 为什么有这一层（真实的返工账）
//
// 在它之前，"让 agent 自己驱动一个 emulator 实例"的**唯一**做法是**每次现场手写一个 .mjs**：
// 起实例（贴一条长命令行、自己管后台进程、自己从注册表把端口捞回来）→ 发命令（`fetch` +
// 自己量往返毫秒）→ `capture`（**把 1.8MB 的 base64 PNG 打到 stdout，直接把模型上下文烧掉**）→
// 想等"跑到 TITLE"只能 `Start-Sleep` + 反复 `frame` 去猜。
// 定位"存档页 80→90 卡 1.5s"那一轮，这套循环跑了十几次，每一次都是一份新脚本。
//
// 本模块把那一套收敛成**一个 agent tool**（`amayui_emulator`）。三条硬设计：
//
//  1. **复用既有 HTTP 路由，不另写驱动逻辑**（两处真源是最贵的债）。命令面就是
//     `app/amayui-emulator/src/web/host.ts` 的 `POST /api/debug-query` —— 与 GUI 面板、
//     与 `--attach-headless` 的无头页**同一条路**；命令表仍是 `src/vm/debugCommand.ts` 那一份。
//     本模块**不解析**任何仿真命令（只拼字符串、转发、读回执），唯一例外是 `wait` 的**只读探针**
//     （`frame` / `global`），因为"等条件"本身是宿主侧的能力，VM 没有。
//  2. **PNG 只落盘、绝不回模型**：`capture` 的回执里 `png` 是 base64（1280×720 ≈ 1.8MB）；
//     本模块**就地解码写文件**，只回 `{path, bytes, width, height}`。base64 不出这个函数。
//  3. **往返耗时是证据**：每个动作都回 `elapsedMs`（`query` 另有逐条 `roundTripMs`）——
//     "卡多久"是用户要的那条数据，不能丢。
//
// ## 为什么直连实例端口，而不是走本插件的 `/dsh-emulator/<id>/…` 代理
//
// 同一条路由、同一份契约，但**少一跳 TCP**。把插件自己加的那一跳算进 `roundTripMs` 会**污染证据**
// （用户要量的是引擎的卡顿，不是插件代理的开销）。GUI 面板走代理（同源 iframe 需要它），
// agent 走直连：**两个调用方，一条被调用的路由**。
//
// ## 与 `lib/index.js` 的分工（同一份 observer 不变量）
//
// `lib/index.js` 的「纯观察」不变量（不 spawn、不 stop）说的是**GUI 面板**：面板不持有任何东西。
// 本文件是 **agent tool** 的另一半：`start`/`stop` 由 **agent** 显式要求，进程句柄只活在本进程的
// `spawned` 表里、只用于"我自己起的那个实例"的收尾；**别人的实例**（人开的、别的终端开的）
// 一律只读，`stop` 要先看见它、再显式 `force`。两条不变量因此不冲突：面板仍然不启动任何东西。
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

/** 实例注册表里"活着"的心跳窗口（与 `lib/index.js` / app 侧同一口径）。 */
const STALE_MS = 20000
/** 实例 id 的合法形状（与 app 侧 `src/host/instance.ts`、`lib/index.js` 同一口径）。 */
const ID_RE = /^[A-Za-z0-9._-]{1,64}$/
/** 保留段：`api` 是插件自己的控制端点，不能当实例名。 */
const RESERVED_ID = 'api'
/** 缺省实例的 id（它的记录在 `<root>/.tmp/instance.json`）。 */
const DEFAULT_ID = 'default'
/** 命令面：与 `--attach-headless` 的无头页走**同一条**。 */
const QUERY_PATH = '/api/debug-query'
/** 单个动作的缺省超时（宿主侧对 debug-query 有自己的 8s 上限，这里只做最后兜底）。 */
const DEFAULT_TIMEOUT_MS = 30000
/** `wait` 的缺省轮询间隔。200ms 足够"跟得上帧"，又不会把宿主的命令队列塞满。 */
const DEFAULT_POLL_MS = 200
/** `input` 的合成悬停：先移到目标**左侧偏移**处，让 `setCursor` 真的看到位置变化。 */
const HOVER_OFFSET_X = 2

// ────────────────────────────────────────────────────────────────────────────
// 注册表（只读；本插件与宿主之间唯一的契约）
// ────────────────────────────────────────────────────────────────────────────

export function isValidId(id) {
  return typeof id === 'string' && ID_RE.test(id) && id !== RESERVED_ID && id !== '.' && id !== '..'
}

/** pid 是否活着（`EPERM` = 活着但不归我管）。 */
export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return Boolean(err && err.code === 'EPERM')
  }
}

function readRecordFile(file) {
  try {
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null
    if (!isValidId(rec.id)) return null
    if (!Number.isInteger(rec.pid) || rec.pid <= 0) return null
    const port = Number(rec.port)
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return null
    if (!Number.isFinite(Number(rec.heartbeatAt))) return null
    return rec
  } catch {
    return null
  }
}

/**
 * 扫描注册表（两种布局，按 id 去重）。
 *
 * `liveOnly=false` 时把"记录在但 pid/心跳已过期"的也带回来（`live:false`）—— 这是 `stop` 需要的：
 * 一个刚被 `kill -9` 的实例留下的残记录，`instances` 不该把它当活的，但收尾时要知道"有这么个东西"。
 */
export function scanRegistry(root, liveOnly = true) {
  const tmpDir = path.join(root, '.tmp')
  const instancesDir = path.join(tmpDir, 'instances')
  const out = []
  const push = (rec) => {
    if (!rec || (!liveOnly && out.some((e) => e.id === rec.id))) return
    if (out.some((e) => e.id === rec.id)) return // 两处都登记了同一个 id ⇒ 只留第一条
    const live = isPidAlive(Number(rec.pid)) && Number(rec.heartbeatAt) > Date.now() - STALE_MS
    if (liveOnly && !live) return
    const st = rec.lastStatus && typeof rec.lastStatus === 'object' ? rec.lastStatus : {}
    out.push({
      id: rec.id,
      port: Number(rec.port),
      pid: Number(rec.pid),
      live,
      heartbeatAgeMs: Math.max(0, Date.now() - Number(rec.heartbeatAt)),
      bin: st.bin ?? null,
      frames: st.frames ?? null,
      gate: st.gate ?? null,
      startedAt: Number(rec.startedAt) || 0,
    })
  }
  push(readRecordFile(path.join(tmpDir, 'instance.json')))
  let entries = []
  try {
    entries = fs.readdirSync(instancesDir, { withFileTypes: true })
  } catch {
    /* 目录还没建 = 一个具名实例都没起过（不是错误） */
  }
  for (const ent of entries) {
    if (!ent.isDirectory() || !isValidId(ent.name)) continue
    const rec = readRecordFile(path.join(instancesDir, ent.name, 'instance.json'))
    if (rec && rec.id === ent.name) push(rec)
  }
  out.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
  return { instances: out, tmpDir, instancesDir, staleMs: STALE_MS }
}

/** 某实例的记录文件（两种布局）。 */
function recordFile(root, id) {
  const tmpDir = path.join(root, '.tmp')
  return path.join(id === DEFAULT_ID ? tmpDir : path.join(tmpDir, 'instances', id), 'instance.json')
}

/** 读一个实例记录（活着才回，除非 `allowStale`）。 */
export function readRecord(root, id, allowStale = false) {
  if (!isValidId(id)) return null
  const rec = readRecordFile(recordFile(root, id))
  if (!rec || rec.id !== id) return null
  const live = isPidAlive(Number(rec.pid)) && Number(rec.heartbeatAt) > Date.now() - STALE_MS
  if (!live && !allowStale) return null
  return { ...rec, live }
}

// ────────────────────────────────────────────────────────────────────────────
// HTTP：唯一被调用的路由 = `POST <instance>/api/debug-query`
// ────────────────────────────────────────────────────────────────────────────

/**
 * 发一条调试命令，**并量它自己的往返毫秒**。
 *
 * 返回 `{ status, ms, body }`：`body` 是宿主原样回的 JSON（形状见 `src/web/host.ts` 的
 * `debug-query` 分支：`{query, ok, lines[], png?}`，或超时的 `{ok:false, lines:[…]}`）。
 * ★**不吞 HTTP 状态**：503（没有渲染页）与 504（页面卡住）语义完全不同，必须让调用方看见
 *   —— 这正是"起实例忘了 `--attach-headless`"与"引擎真的卡住"的区分点。
 */
export function postDebugQuery(port, command, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const payload = Buffer.from(JSON.stringify({ args: [String(command)] }), 'utf8')
    const started = Date.now()
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: QUERY_PATH,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': String(payload.length) },
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const ms = Date.now() - started
          const text = Buffer.concat(chunks).toString('utf8')
          let body = null
          try {
            body = JSON.parse(text)
          } catch {
            body = { ok: false, lines: [`回执不是 JSON（HTTP ${res.statusCode}）：${text.slice(0, 200)}`] }
          }
          resolve({ status: res.statusCode || 0, ms, body })
        })
      },
    )
    // 宿主侧对 debug-query 有自己的超时（`AMAYUI_DEBUG_QUERY_TIMEOUT_MS`，缺省 8s）并会回 504；
    // 这里只是**最后兜底**，设得比它宽，免得把宿主的 504 证据换成本地的 ETIMEDOUT。
    req.setTimeout(Math.max(timeoutMs, 12000), () => {
      req.destroy(new Error(`本地等待超过 ${Math.max(timeoutMs, 12000)}ms`))
    })
    req.on('error', (err) => {
      resolve({ status: 0, ms: Date.now() - started, body: { ok: false, lines: [`请求失败：${err.message}`] } })
    })
    req.end(payload)
  })
}

/** 把回执的 `lines` 压成一行（工具回执要短；完整行仍在卡片里由 render 决定）。 */
function firstLine(body) {
  const lines = body && Array.isArray(body.lines) ? body.lines : []
  return lines.length ? String(lines[0]) : ''
}

// ────────────────────────────────────────────────────────────────────────────
// PNG：只落盘，不回 base64
// ────────────────────────────────────────────────────────────────────────────

/**
 * 从 PNG 字节流里读宽高（`IHDR` 固定是第一个块：8 字节签名 + 4 长度 + 4 类型 + 4 宽 + 4 高）。
 *
 * ★为什么要自己解：只需 8 个字节就能回答"这张图多大"，为此去拉一个图像库
 *   （甚至只是为了一个尺寸而整张解码）都不值 —— 本插件零运行时依赖。
 *   签名不是 PNG ⇒ 回 `null`（让上层把"这居然不是 PNG"当异常报出来，而不是报个假尺寸）。
 */
export function pngSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

// ────────────────────────────────────────────────────────────────────────────
// 只读探针（`wait` 用）：从 `frame` / `global` 的**人读文本**里取机读字段
// ────────────────────────────────────────────────────────────────────────────

/**
 * 解析 `frame` 回执（文本形状见 `src/vm/debugQuery.ts` 的 `case 'frame'`）。
 *
 * ★为什么用正则读文本、不新开一条"机读"命令：命令面是 app 侧的真源，**本插件不该为了自己
 *   方便去改它**（那会多出第二条真源）。这几行文本是稳定契约（有守卫测试），换个读法就够用。
 */
export function parseFrameLines(lines) {
  const out = { cur: null, count: null, live: null, bin: null, ip: null, ok: false, raw: [] }
  if (!Array.isArray(lines)) return out
  out.raw = lines.map(String)
  const head = out.raw[0] || ''
  let m = head.match(/^cur=(\d+)\s+帧数=(\d+)（活帧 (\d+)/)
  if (m) {
    out.cur = Number(m[1])
    out.count = Number(m[2])
    out.live = Number(m[3])
  } else {
    m = head.match(/^cur=(\d+)\s+帧数=(\d+)/)
    if (m) {
      out.cur = Number(m[1])
      out.count = Number(m[2])
    }
  }
  for (const line of out.raw) {
    if (!line.includes('←cur')) continue
    const f = line.match(/\[\d+\]\s+(\S+)\s+scriptId=0x[0-9a-f]+\s+ip=(\d+)/i)
    if (f) {
      out.bin = f[1]
      out.ip = Number(f[2])
    }
    break
  }
  out.ok = out.count !== null
  return out
}

/** 解析 `run` 回执里的门控与当前脚本（`case 'run'` 的文本形状）。 */
export function parseRunLines(lines) {
  const out = { gate: null, advActive: null, bin: null, ok: false }
  if (!Array.isArray(lines)) return out
  for (const raw of lines) {
    const line = String(raw)
    let m = line.match(/^门：waitFlags=0x([0-9a-f]+)\s+gateWaitMs=(\d+)\s+gateWaitStart=(\d+)\s+sceneFreeze=(\d+)\s+scenePending=(\d+)/i)
    if (m) {
      // 与人读口径一致：waitFlags/sceneFreeze/scenePending 任一非零 ⇒ 有东西在门/冻结。
      out.gate = Number(m[1]) !== 0 || Number(m[4]) !== 0 || Number(m[5]) !== 0 ? 'waiting' : 'free'
      out.waitFlags = Number(m[1])
      continue
    }
    m = line.match(/^advActive=(\w+)/)
    if (m) {
      out.advActive = m[1]
      continue
    }
    m = line.match(/当前帧\s+(\S+)\s+ip=/)
    if (m) out.bin = m[1]
  }
  out.ok = out.gate !== null
  return out
}

/** 取 `global <idx>` 回执的第一行（`global 0x… = <dec> (0x…) [raw 0x…]`）。 */
export function globalLine(lines) {
  if (!Array.isArray(lines) || !lines.length) return ''
  return String(lines[0])
}

// ────────────────────────────────────────────────────────────────────────────
// 工具实现（`ctx.tools.register` 的 execute）
// ────────────────────────────────────────────────────────────────────────────

/** 参数校验：整数区间，超范围就是调用方的错，直接抛（工具层统一报"参数非法"）。 */
function intIn(value, name, min, max, dflt) {
  if (value === undefined || value === null) {
    if (dflt === undefined) throw new Error(`${name} 必填`)
    return dflt
  }
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`${name} 必须是数（收到 ${JSON.stringify(value)}）`)
  const i = Math.trunc(n)
  if (i < min || i > max) throw new Error(`${name} 必须在 ${min}..${max}（收到 ${i}）`)
  return i
}

/**
 * 把一次 `input` 的**动作**翻成命令序列。
 *
 * ★**合成悬停**（`hover:true`，`click` 缺省开）：`click` 本身就会先 `cursor` 再 `press`，
 *   但引擎的悬停判定是"**位置真的变了**才做命中测试"（`src/vm/input.ts` 的 `setCursor`：
 *   同一点连发两次 **不** 产生第二次 hover）。TITLE 那类菜单**必须**先悬停若干帧再点，
 *   实测不悬停点不动 ⇒ 这里合成 `move(旁边) → move(目标) → 等 N ms → click(目标)`。
 */
function buildInputCommands(args) {
  const kind = String(args.kind || '').toLowerCase()
  const button = args.button === 'right' || args.button === '右' || args.button === 1 ? 'right' : 'left'
  const hover = args.hover === undefined ? kind === 'click' : Boolean(args.hover)
  const hoverWaitMs = intIn(args.hover_wait_ms, 'hover_wait_ms', 0, 10000, 250)
  const seq = []
  const xy = () => {
    const x = intIn(args.x, 'x', 0, 4096)
    const y = intIn(args.y, 'y', 0, 4096)
    return { x, y }
  }
  switch (kind) {
    case 'click': {
      const { x, y } = xy()
      if (hover) {
        seq.push({ cmd: `move ${Math.max(0, x - HOVER_OFFSET_X)} ${y}`, waitMs: 0 })
        seq.push({ cmd: `move ${x} ${y}`, waitMs: hoverWaitMs })
      }
      seq.push({ cmd: `click ${x} ${y}${button === 'right' ? ' 右' : ''}`, waitMs: intIn(args.settle_ms, 'settle_ms', 0, 30000, 0) })
      break
    }
    case 'move': {
      const { x, y } = xy()
      seq.push({ cmd: `move ${x} ${y}`, waitMs: intIn(args.settle_ms, 'settle_ms', 0, 30000, 0) })
      break
    }
    case 'leave':
      seq.push({ cmd: 'leave', waitMs: intIn(args.settle_ms, 'settle_ms', 0, 30000, 0) })
      break
    case 'press': {
      const { x, y } = xy()
      seq.push({ cmd: `press ${x} ${y}${button === 'right' ? ' 右' : ''}`, waitMs: intIn(args.settle_ms, 'settle_ms', 0, 30000, 0) })
      break
    }
    case 'release':
      seq.push({
        cmd: args.x === undefined ? `release${button === 'right' ? ' 右' : ''}` : `release ${xy().x} ${xy().y}${button === 'right' ? ' 右' : ''}`,
        waitMs: intIn(args.settle_ms, 'settle_ms', 0, 30000, 0),
      })
      break
    case 'wheel': {
      const delta = intIn(args.delta, 'delta', -12000, 12000)
      const cmd = args.x === undefined ? `wheel ${delta}` : `wheel ${delta} ${xy().x} ${xy().y}`
      seq.push({ cmd, waitMs: intIn(args.settle_ms, 'settle_ms', 0, 30000, 0) })
      break
    }
    case 'key': {
      const vk = intIn(args.vk, 'vk', 1, 255)
      seq.push({ cmd: `key ${vk}`, waitMs: 0 })
      // `key` = 按下；不抬起就会一直被当成按住（长按要成对发）⇒ 缺省补齐 keyup。
      if (args.keyup !== false) seq.push({ cmd: `keyup ${vk}`, waitMs: intIn(args.settle_ms, 'settle_ms', 0, 30000, 0) })
      break
    }
    default:
      throw new Error(`input.kind 必须是 click/move/leave/press/release/wheel/key 之一（收到 ${JSON.stringify(args.kind)}）`)
  }
  return { seq, hover, button }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 创建一个 `amayui_emulator` 工具的 execute 实现。
 *
 * 依赖注入（`deps`）而不是闭包抓 `ctx`：这个函数要能被**离线自测**直接调用
 * （`plugins/amayui-emulator/tool-smoke.mjs`），不必起一个 Cordis 容器。
 */
export function createExecutor(deps) {
  const { getRoot, spawned, toolLog } = deps

  function log(line) {
    try {
      if (toolLog) toolLog(`[emudbg] ${line}`)
    } catch {
      /* 日志失败绝不能影响工具本身 */
    }
  }

  /** 找实例：给了 `instance` 就用它（活的才收），没给就用唯一活实例。 */
  function resolveInstance(args, { allowDead = false } = {}) {
    const root = getRoot()
    const want = args && args.instance !== undefined && args.instance !== null ? String(args.instance) : ''
    if (want) {
      if (!isValidId(want)) throw new Error(`instance id 非法：${JSON.stringify(want)}（允许 [A-Za-z0-9._-]{1,64}，"api" 保留）`)
      const rec = readRecord(root, want, allowDead)
      if (!rec) {
        const known = readRecord(root, want, true)
        throw new Error(
          known
            ? `实例 <${want}> 不活（pid=${known.pid} 或心跳已过期 ${Math.round((Date.now() - Number(known.heartbeatAt)) / 1000)}s）`
            : `没有实例 <${want}>。用 action=instances 看活实例；要起一个用 action=start。`,
        )
      }
      return rec
    }
    const { instances } = scanRegistry(root, true)
    if (instances.length === 1) return readRecord(root, instances[0].id) || instances[0]
    if (instances.length === 0) throw new Error('没有活实例。用 action=start 起一个（缺省 --attach-headless）。')
    throw new Error(`有 ${instances.length} 个活实例，必须用 instance 指定一个：${instances.map((i) => i.id).join(', ')}`)
  }

  /** 发一批命令，逐条量往返（`instance` 直连端口）。 */
  async function runCommands(port, commands, timeoutMs) {
    const results = []
    const total = Date.now()
    for (const item of commands) {
      const cmd = typeof item === 'string' ? item : item.cmd
      const { status, ms, body } = await postDebugQuery(port, cmd, timeoutMs)
      results.push({ cmd, status, roundTripMs: ms, ok: Boolean(body && body.ok), lines: (body && body.lines) || [] })
      if (item && item.waitMs) await sleep(item.waitMs)
    }
    return { results, elapsedMs: Date.now() - total }
  }

  // ── action=start ──────────────────────────────────────────────────────────
  async function doStart(args) {
    const root = getRoot()
    const id = String(args.instance || `dbg-${Date.now().toString(36).slice(-5)}`)
    if (!isValidId(id)) throw new Error(`instance id 非法：${JSON.stringify(id)}`)
    const existing = readRecord(root, id, true)
    if (existing && existing.live) {
      throw new Error(`实例 <${id}> 已经在跑（pid=${existing.pid} port=${existing.port}）—— 同 id 互斥，换一个 id 或先 stop。`)
    }
    const port = intIn(args.port, 'port', 0, 65535, 0)
    const idleSec = intIn(args.idle_sec, 'idle_sec', 0, 86400, 0)
    const headless = args.headless === undefined ? true : Boolean(args.headless)
    const appDir = path.join(root, 'app', 'amayui-emulator')
    if (!fs.existsSync(path.join(appDir, 'src', 'web', 'host.ts'))) {
      throw new Error(`找不到 ${path.join(appDir, 'src', 'web', 'host.ts')} —— getRoot 给的不是本工程根？`)
    }
    const logDir = path.join(root, '.tmp', 'emudbg')
    fs.mkdirSync(logDir, { recursive: true })
    const logPath = path.join(logDir, `${id}.log`)
    const argv = ['--import', 'tsx', 'src/web/host.ts', '--instance', id, '--port', String(port), '--idle-sec', String(idleSec)]
    if (headless) argv.push('--attach-headless')
    const out = fs.openSync(logPath, 'a')
    const started = Date.now()
    // ★静音（`AMAYUI_AUDIO_ENABLED=0`）：用户那轮定位用的就是它；一次起 3 个实例时音频设备会互相抢。
    // ★`detached`: 让实例自成进程组 —— 插件（= DSH 宿主）卸载/重启时**不**把它带走，
    //   "实例归 agent 管"这条才成立（反过来，agent 不知道的实例才需要显式 stop）。
    const child = spawn(process.execPath, argv, {
      cwd: appDir,
      env: { ...process.env, AMAYUI_AUDIO_ENABLED: '0' },
      detached: true,
      stdio: ['ignore', out, out],
      windowsHide: true,
    })
    child.unref()
    fs.closeSync(out)
    log(`start id=${id} pid=${child.pid} port=${port} headless=${headless} log=${logPath}`)
    spawned.set(id, { pid: child.pid, startedAt: started, logPath, requestedPort: port })
    // 等注册表出现（listen 之后由宿主机原子写）⇒ 从这里把**真实端口**捞回来。
    const deadline = Date.now() + intIn(args.wait_ms, 'wait_ms', 0, 60000, 20000)
    let rec = null
    while (Date.now() < deadline) {
      await sleep(300)
      rec = readRecord(root, id, true)
      if (rec && rec.live) break
      if (child.exitCode !== null) break
    }
    if (!rec || !rec.live) {
      const tail = readLogTail(logPath, 12)
      throw new Error(
        `实例 <${id}> 在 ${Date.now() - started}ms 内没有登记为活（pid=${child.pid}${child.exitCode !== null ? `, exit=${child.exitCode}` : ''}）。` +
          `日志尾部：\n${tail}`,
      )
    }
    return {
      ok: true,
      action: 'start',
      instance: id,
      port: rec.port,
      pid: rec.pid,
      headless,
      idleSec,
      elapsedMs: Date.now() - started,
      logPath: path.relative(root, logPath).split(path.sep).join('/'),
      note:
        `实例已起（--attach-headless ${headless ? '开' : '关'}、--idle-sec ${idleSec}、静音）。` +
        (headless ? '' : '★没有无头页 ⇒ debug-query 会 503。') +
        `端口 ${rec.port}。收工记得 action=stop。`,
    }
  }

  function readLogTail(file, lines) {
    try {
      const all = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
      return all.slice(-lines).join('\n')
    } catch {
      return '(读不到日志)'
    }
  }

  // ── action=stop ───────────────────────────────────────────────────────────
  async function doStop(args) {
    const root = getRoot()
    const id = args.instance === undefined || args.instance === null ? '' : String(args.instance)
    let target = null
    if (id) {
      if (!isValidId(id)) throw new Error(`instance id 非法：${JSON.stringify(id)}`)
      target = readRecord(root, id, true)
      if (!target) throw new Error(`没有实例 <${id}> 的记录（两种注册表布局都找过）`)
    } else {
      const mine = [...spawned.entries()].filter(([k]) => !id || k === id)
      const live = []
      for (const [k, v] of mine) if (isPidAlive(v.pid)) live.push({ key: k, ...v })
      if (live.length !== 1) {
        throw new Error(
          live.length === 0
            ? '本进程没有自己起的活实例；要收别人的实例请显式给 instance（并可能需要 force）。'
            : `本进程起了多个实例（${live.map((l) => l.key).join(', ')}），请用 instance 指定。`,
        )
      }
      target = readRecord(root, live[0].key, true) || { id: live[0].key, pid: live[0].pid, live: isPidAlive(live[0].pid) }
    }
    const handle = spawned.get(target.id)
    // ★别人的实例要显式 force：注册表是**磁盘上的**、跨进程可见 ⇒ 没有 force 就可能一键杀掉
    //   用户正在看/正在用的那个实例（它共用 overlay/log，杀了就丢进度）。这是刻意的摩擦。
    if (!handle && !args.force) {
      throw new Error(
        `实例 <${target.id}>（pid=${target.pid}）不是本进程起的。要收掉它请显式 force=true` +
          `（★它会丢 VM 进度：overlay/log 在磁盘上还在，但帧/场景要从 ALINIT 重跑）。`,
      )
    }
    const t0 = Date.now()
    let forceKilled = false
    try {
      process.kill(target.pid, 'SIGTERM')
    } catch (err) {
      log(`stop ${target.id}: SIGTERM 失败 ${err.message}（可能已经没了）`)
    }
    const graceMs = intIn(args.grace_ms, 'grace_ms', 0, 30000, 8000)
    while (Date.now() - t0 < graceMs && isPidAlive(target.pid)) await sleep(150)
    if (isPidAlive(target.pid)) {
      // ★Windows 上 `SIGTERM` 走的是 TerminateProcess（宿主没机会跑 `close()`）；
      //   走到这里说明连它都没收掉（或平台语义不同）⇒ 上 taskkill 连**子进程树**
      //   （`--attach-headless` 的哑窗是宿主的子进程，不一起收就会变成孤儿）。
      forceKilled = true
      killTree(target.pid)
      const t1 = Date.now()
      while (Date.now() - t1 < 5000 && isPidAlive(target.pid)) await sleep(150)
    }
    spawned.delete(target.id)
    // 宿主正常退出会删注册项；被硬杀则留一条残记录（20s 后自然不算活）。
    await sleep(200)
    const left = readRecord(root, target.id, true)
    log(`stop ${target.id} pid=${target.pid} force=${forceKilled} 用时=${Date.now() - t0}ms`)
    return {
      ok: !left || !left.live,
      action: 'stop',
      instance: target.id,
      pid: target.pid,
      forceKilled,
      elapsedMs: Date.now() - t0,
      recordLeft: Boolean(left),
      note: left
        ? '进程已结束；注册表残记录还在（心跳过期后自动不算活，20s；磁盘状态保留）。'
        : '进程已结束，注册项已摘。',
    }
  }

  function killTree(pid) {
    if (process.platform === 'win32') {
      try {
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
        return
      } catch {
        /* 落到下面用 SIGKILL 兜底 */
      }
    }
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* 已经没了 */
    }
  }

  // ── action=capture ────────────────────────────────────────────────────────
  /**
   * 抓一帧 → **PNG 落盘**，回执只带路径/字节数/尺寸。
   *
   * ★`tickets/T-0180` ②后：**宿主已经把 PNG 写进 `<repo>/.tmp/emudbg/`**（渲染页经二进制腿上送，
   *   回执里只有 `path`/`bytes`）⇒ 这里只读回文件量个尺寸，**不再 base64 解码**。
   *   回执里仍有 `png`（base64）只可能是**旧宿主/旧 preload**（没有那条通道时的回退）——那时按老路走。
   */
  async function doCapture(args, rec) {
    const root = getRoot()
    const t0 = Date.now()
    const { status, ms, body } = await postDebugQuery(rec.port, 'capture', intIn(args.timeout_ms, 'timeout_ms', 1000, 120000, DEFAULT_TIMEOUT_MS))
    const hostRel = body && typeof body.path === 'string' ? body.path : ''
    if (!hostRel && !(body && body.png)) {
      throw new Error(`capture 没拿到 png/path（HTTP ${status}，用时 ${ms}ms）：${(body && (body.lines || []).join(' | ')) || '(空回执)'}`)
    }
    // ① 新路：宿主已落盘 ⇒ 只读回那份（量尺寸/搬名），**不碰 base64**。
    //    `dir` 是宿主报的**绝对**产物目录（具名实例落实例根下）⇒ 用 `dir` 拼绝对路径最稳；
    //    没有 `dir`（旧宿主）时才退回"相对仓库根"的老口径。
    // ② 旧路（回退）：回执里还是 base64 ⇒ 就地解码后写盘（行为与 T-0180 之前逐字一致）
    let abs
    let buf
    if (hostRel) {
      const dir = body && typeof body.dir === 'string' ? body.dir : ''
      abs = path.isAbsolute(hostRel) ? hostRel : dir ? path.join(dir, hostRel) : path.join(root, hostRel)
      buf = fs.readFileSync(abs)
    } else {
      buf = Buffer.from(String(body.png), 'base64')
      const outDir = path.join(root, '.tmp', 'emudbg')
      fs.mkdirSync(outDir, { recursive: true })
      const name = String(args.out || '').trim() || `${rec.id}-${stamp()}.png`
      if (name.includes('..')) throw new Error('out 不能包含 ..')
      abs = path.isAbsolute(name) ? name : path.join(outDir, name)
      fs.writeFileSync(abs, buf)
    }
    // `out` 指定了别的名字 ⇒ 把宿主写的那份**搬过去**（不重复写一份；`renameSync` 不复制字节）
    const want = String(args.out || '').trim()
    if (want) {
      if (want.includes('..')) throw new Error('out 不能包含 ..')
      const outDir = path.join(root, '.tmp', 'emudbg')
      const target = path.isAbsolute(want) ? want : path.join(outDir, want)
      if (path.resolve(target) !== path.resolve(abs)) {
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.renameSync(abs, target)
        abs = target
      }
    }
    const size = pngSize(buf)
    const rel = path.relative(root, abs).split(path.sep).join('/')
    log(`capture ${rec.id} → ${rel} ${buf.length}B ${size ? `${size.width}x${size.height}` : '?'} rtt=${ms}ms${hostRel ? '（宿主直写）' : '（回退 base64）'}`)
    return {
      ok: true,
      action: 'capture',
      instance: rec.id,
      path: rel,
      absPath: abs,
      bytes: buf.length,
      width: size ? size.width : null,
      height: size ? size.height : null,
      hostWrote: Boolean(hostRel),
      pngRoundTripMs: ms,
      elapsedMs: Date.now() - t0,
      note: `PNG 已落盘（回执不含图像数据）。看画面用 read_image('${rel}')。`,
    }
  }

  function stamp() {
    const d = new Date()
    const p = (n, w = 2) => String(n).padStart(w, '0')
    return `${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  }

  // ── action=wait ───────────────────────────────────────────────────────────
  /**
   * 等条件成立。**只读探针**：`frame`（帧数/当前脚本）+ 可选的 `global`。
   *
   * ★为什么不新增一条宿主侧"等待"命令：那要改 `app/**`（命令表是 app 侧真源），而这里的
   *   等待是**调用方**的诉求，不是引擎的能力。轮询一条只读查询就够，且不需要动产品代码。
   * ★为什么集中在一轮里取一次 `frame` 再评所有条件：`次/圆` 是成本，探针不该比被观察的东西还重。
   */
  async function doWait(args, rec) {
    const until = args.until
    if (!until || typeof until !== 'object' || Array.isArray(until)) {
      throw new Error('wait 需要 until 对象，例如 {"bin":"TITLE"} 或 {"frames_above":600} 或 {"gate":"free"}')
    }
    const timeoutMs = intIn(args.timeout_ms, 'timeout_ms', 100, 300000, 30000)
    const pollMs = intIn(args.poll_ms, 'poll_ms', 50, 5000, DEFAULT_POLL_MS)
    // ★`global_idx`（读哪个下标，十六进制口径与脚本一致）与 `until.global`（打在那行上的**正则**）
    //   是两个字段：同一个字段既当"下标"又当"期望值"必然歧义。
    const globalIdx = until.global_idx === undefined ? null : String(until.global_idx)
    const deadline = Date.now() + timeoutMs
    const t0 = Date.now()
    let polls = 0
    let last = { frames: null, bin: null, gate: null, globalLine: '' }
    while (true) {
      polls++
      const probe = await postDebugQuery(rec.port, 'frame', 15000)
      if (probe.status === 503) {
        throw new Error(`wait：实例 <${rec.id}> 没有渲染页（503）⇒ 没人能跑 VM。起实例时加 --attach-headless。`)
      }
      const fr = parseFrameLines(probe.body && probe.body.lines)
      let gate = null
      if (until.gate !== undefined) {
        const run = await postDebugQuery(rec.port, 'run', 15000)
        gate = parseRunLines(run.body && run.body.lines).gate
      }
      let gl = ''
      if (globalIdx !== null) {
        const g = await postDebugQuery(rec.port, `global ${globalIdx}`, 15000)
        gl = globalLine(g.body && g.body.lines)
      }
      last = { frames: fr.count, bin: fr.bin, gate, globalLine: gl, cur: fr.cur, ip: fr.ip }

      const checks = []
      if (until.frames_above !== undefined) checks.push({ k: 'frames_above', want: Number(until.frames_above), got: fr.count, pass: fr.count !== null && fr.count > Number(until.frames_above) })
      if (until.frames_below !== undefined) checks.push({ k: 'frames_below', want: Number(until.frames_below), got: fr.count, pass: fr.count !== null && fr.count < Number(until.frames_below) })
      if (until.frames_change !== undefined) {
        const from = Number(until.frames_change)
        checks.push({ k: 'frames_change', want: `≠ ${from}`, got: fr.count, pass: fr.count !== null && fr.count !== from })
      }
      if (until.bin !== undefined) checks.push({ k: 'bin', want: String(until.bin), got: fr.bin, pass: regexTest(until.bin, fr.bin) })
      if (until.gate !== undefined) checks.push({ k: 'gate', want: String(until.gate), got: gate, pass: regexTest(until.gate, gate) })
      if (globalIdx !== null) checks.push({ k: 'global', want: String(until.global), got: gl, pass: regexTest(until.global, gl) })

      if (checks.length === 0) throw new Error('wait.until 里没有任何可判定的条件（支持 bin / gate / frames_above / frames_below / frames_change / global，global 需配 global_idx）')
      if (checks.every((c) => c.pass)) {
        return {
          ok: true,
          action: 'wait',
          instance: rec.id,
          satisfied: true,
          elapsedMs: Date.now() - t0,
          polls,
          state: last,
          checks,
          note: `${checks.length} 个条件全部成立（轮询 ${polls} 次，${Date.now() - t0}ms）。`,
        }
      }
      if (Date.now() >= deadline) {
        return {
          ok: false,
          action: 'wait',
          instance: rec.id,
          satisfied: false,
          elapsedMs: Date.now() - t0,
          polls,
          state: last,
          checks,
          note: `超时（${timeoutMs}ms，轮询 ${polls} 次）条件仍未成立。`,
        }
      }
      await sleep(pollMs)
    }
  }

  /** 条件是字符串 ⇒ 当**正则**（`/…/` 里的斜杠可选），数字 ⇒ 精确相等。 */
  function regexTest(pattern, actual) {
    if (actual === null || actual === undefined) return false
    if (typeof pattern === 'number') return String(actual) === String(pattern)
    const s = String(pattern)
    try {
      return new RegExp(s).test(String(actual))
    } catch {
      return String(actual) === s
    }
  }

  // ── 入口 ─────────────────────────────────────────────────────────────────
  return async function execute(args) {
    const action = String(args.action || '').toLowerCase()
    const t0 = Date.now()
    switch (action) {
      case 'instances': {
        const root = getRoot()
        const { instances } = scanRegistry(root, !args.include_dead)
        log(`instances → ${instances.length} 个（include_dead=${Boolean(args.include_dead)}）`)
        return {
          ok: true,
          action: 'instances',
          instances,
          elapsedMs: Date.now() - t0,
          note: instances.length
            ? `${instances.length} 个${args.include_dead ? '' : '活'}实例。`
            : '没有活实例。用 action=start 起一个。',
        }
      }
      case 'start':
        return doStart(args)
      case 'stop':
        return doStop(args) // 自己 resolve（可以只收"本进程起的"）
      case 'query': {
        const rec = resolveInstance(args)
        const cmds = Array.isArray(args.commands) && args.commands.length ? args.commands.map(String) : null
        if (!cmds && !args.command) throw new Error('query 需要 command（一条命令）或 commands（一组）')
        const { results, elapsedMs } = await runCommands(rec.port, cmds || [String(args.command)], intIn(args.timeout_ms, 'timeout_ms', 1000, 120000, DEFAULT_TIMEOUT_MS))
        return {
          ok: results.every((r) => r.ok),
          action: 'query',
          instance: rec.id,
          port: rec.port,
          results,
          elapsedMs,
          note: results.map((r) => `${r.cmd} → HTTP ${r.status}, ${r.roundTripMs}ms`).join('；'),
        }
      }
      case 'capture':
        return doCapture(args, resolveInstance(args))
      // ★`until.global`（正则，打在 global 那一行上）与顶层 `global`（要读哪个下标）是两个字段，别混。
      case 'wait':
        return doWait(args, resolveInstance(args))
      case 'input': {
        const rec = resolveInstance(args)
        const { seq, hover, button } = buildInputCommands(args)
        const { results, elapsedMs } = await runCommands(rec.port, seq, intIn(args.timeout_ms, 'timeout_ms', 1000, 120000, DEFAULT_TIMEOUT_MS))
        return {
          ok: results.every((r) => r.ok),
          action: 'input',
          instance: rec.id,
          kind: String(args.kind || '').toLowerCase(),
          button,
          hovered: hover,
          commands: results.map((r) => ({ cmd: r.cmd, roundTripMs: r.roundTripMs, ok: r.ok, line: firstLine({ lines: r.lines }) })),
          elapsedMs,
          note: `${results.length} 条命令${hover ? '（含合成悬停）' : ''}，共 ${elapsedMs}ms。`,
        }
      }
      case 'profile': {
        const rec = resolveInstance(args)
        const sub = String(args.sub || 'report').toLowerCase()
        const cmd = sub === 'report'
          ? `profile report${args.min_ms === undefined ? '' : ` ${intIn(args.min_ms, 'min_ms', 0, 3600000)}`}`
          : sub === 'watch'
            ? `profile watch ${String(args.watch || 'on').toLowerCase()}`
            : sub === 'slow'
              ? `profile slow ${intIn(args.slow_ms, 'slow_ms', 1, 3600000)}`
              : `profile ${sub}`
        if (!/^profile (on|off|reset|report( \d+)?|watch (on|off)|slow \d+)$/.test(cmd)) {
          throw new Error(`profile.sub 只支持 on/off/reset/report/watch/slow（收到 ${JSON.stringify(args.sub)}）`)
        }
        const { status, ms, body } = await postDebugQuery(rec.port, cmd, intIn(args.timeout_ms, 'timeout_ms', 1000, 120000, DEFAULT_TIMEOUT_MS))
        return {
          ok: Boolean(body && body.ok),
          action: 'profile',
          instance: rec.id,
          cmd,
          status,
          roundTripMs: ms,
          lines: (body && body.lines) || [],
          elapsedMs: Date.now() - t0,
          note: `${cmd} → HTTP ${status}, ${ms}ms。`,
        }
      }
      default:
        throw new Error(
          `action 必须是 instances/start/stop/query/capture/input/profile/wait 之一（收到 ${JSON.stringify(args.action)}）`,
        )
    }
  }
}
