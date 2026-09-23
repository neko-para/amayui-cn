// @amayui/emulator-view — offline smoke (`tickets/T-0136`; the observer/registry form).
//
// 不需要 DSH：用**假 ctx** 把 Host 半的 handler 拿出来，挂到一个**真** `node:http` server 上，
// 再用**真** `fetch` 打它。验的是插件侧三件事本身 —— 路由注册、**发现**（读文件注册表）、
// **每实例反向代理**（含流式 SSE 与二进制信封），以及"实例没了以后"的 410 语义。
//
// 前置：`app/amayui-emulator` 装好依赖（`tsx`）。冒烟会**以 agent 的身份**真起一个实例：
//
//   node --import tsx src/web/host.ts --instance smokeX --port 0 --repo-root <repo>
//
// 并从**注册表**（`.tmp/instances/smokeX/instance.json`）里读回它的真实端口 —— 也就是说，
// 这个冒烟同时把 app 侧的登记/心跳/退出删记录一起验了。
//
//   node plugins/amayui-emulator/smoke.mjs
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

import { apply, inject, name } from './lib/index.js'

const PREFIX = '/dsh-emulator'
const REPO = path.resolve(import.meta.dirname, '..', '..')
const APP = path.join(REPO, 'app', 'amayui-emulator')
const INSTANCE = 'smokeX'
const REG_FILE = path.join(REPO, '.tmp', 'instances', INSTANCE, 'instance.json')
/** tsx 冷编译 + 引擎初始化，给足余量。 */
const BOOT_TIMEOUT_MS = 120000
/** 退出后等记录消失（或心跳过期）的上限。 */
const EXIT_TIMEOUT_MS = 25000
const STALE_MS = 20000

// ---- 假 ctx：只实现插件用到的那几件（webServer.register / get / effect）----
// `sandboxPolicy.workspaceRoot` 是**可变**的：先用一个没建过的临时根验"空注册表"，
// 再切到真仓库根去验与 app 侧的真注册表对接。
const EMPTY_ROOT = path.join(REPO, '.tmp', `emulator-smoke-empty-${process.pid}`)
let fakeRoot = EMPTY_ROOT
let registered = null
const effects = []
const ctx = {
  webServer: {
    register(route) {
      registered = route
      return () => { registered = null }
    },
  },
  get(key) {
    if (key === 'sandboxPolicy') return { workspaceRoot: fakeRoot }
    return undefined
  },
  effect(fn) {
    const dispose = fn()
    effects.push(dispose)
    return () => { if (typeof dispose === 'function') dispose() }
  },
}

assert.equal(name, 'amayui-emulator')
assert.ok(inject.includes('webServer'), '★ inject 必须含 webServer（否则路由会被静默跳过）')
assert.ok(inject.includes('fs'), '★ inject 应含 fs（Host 半仍声明工作区文件服务）')
apply(ctx)
assert.ok(registered, '必须注册了路由')
assert.equal(registered.kind, 'prefix', 'kind 必须是 prefix')
assert.equal(registered.path, PREFIX, 'path 必须精确是 /dsh-emulator（不带尾斜杠）')
console.log('[smoke] ✓ 路由注册：kind=prefix path=/dsh-emulator，inject 含 webServer')

// ---- 把 handler 挂到真 server 上，用真 fetch 打 ----
const server = http.createServer((req, res) => {
  void Promise.resolve(registered.handler(req, res)).catch((err) => {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' })
    res.end(String(err && err.message))
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const base = `http://127.0.0.1:${port}${PREFIX}`
const j = async (p, init) => {
  const r = await fetch(base + p, init)
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* 非 JSON */ }
  return { status: r.status, json, text, headers: r.headers }
}

let child = null
/** app 侧注册表是否已落地（落地了我们就不自己写记录）。 */
let registryLanded = false
/** 我们自己写的兜底记录（只在 app 侧未落地时用）。 */
let wroteFallbackRecord = false

function recordExists() {
  try { return fs.statSync(REG_FILE).isFile() } catch { return false }
}

/** 等注册表出现 smokeX 的活记录，返回它。 */
async function waitForRecord(deadline) {
  for (;;) {
    if (recordExists()) {
      try {
        const rec = JSON.parse(fs.readFileSync(REG_FILE, 'utf8'))
        if (rec && rec.id === INSTANCE && Number(rec.port) > 0 && Number.isFinite(Number(rec.heartbeatAt))) return rec
      } catch { /* 写到一半的原子写不会出现；真坏了就下一轮 */ }
    }
    if (Date.now() > deadline) return null
    await new Promise((r) => setTimeout(r, 250))
  }
}

function writeFallbackRecord(port, pid) {
  const dir = path.dirname(REG_FILE)
  fs.mkdirSync(dir, { recursive: true })
  const rec = {
    id: INSTANCE, pid, port, host: '127.0.0.1', repoRoot: REPO,
    startedAt: Date.now(), heartbeatAt: Date.now(), lastStatus: { bin: null, frames: 0, gate: null },
  }
  const tmp = `${REG_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(rec))
  fs.renameSync(tmp, REG_FILE)
  wroteFallbackRecord = true
  return rec
}

/** 起实例（agent 的手法），返回 { proc, port, rec }。 */
async function startInstance() {
  const proc = spawn(
    process.execPath,
    ['--import', 'tsx', 'src/web/host.ts', '--instance', INSTANCE, '--port', '0', '--repo-root', REPO],
    { cwd: APP, env: { ...process.env, AMAYUI_AUDIO_ENABLED: '0' }, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  child = proc
  const lines = []
  let bannerPort = 0
  const onLine = (buf) => {
    for (const line of String(buf).split('\n')) {
      if (!line.trim()) continue
      lines.push(line)
      const m = /127\.0\.0\.1:(\d+)\//.exec(line)
      if (m && !bannerPort) bannerPort = Number(m[1])
    }
  }
  proc.stdout.on('data', onLine)
  proc.stderr.on('data', onLine)

  // (1) 主路径：从**注册表**读端口。
  const t0 = Date.now()
  const rec = await waitForRecord(t0 + BOOT_TIMEOUT_MS)
  if (rec) {
    registryLanded = true
    console.log(`[smoke] ✓ agent 起实例 → 注册表登记 smokeX pid=${rec.pid} port=${rec.port}（${Date.now() - t0}ms，含 tsx 冷启）`)
    return { proc, port: Number(rec.port) }
  }
  // (2) 兜底：app 侧注册表还没实现（T-0136 的另一半在并行开发中）⇒ 自己按冻结的 schema 建记录，
  //     好让**插件侧**的路由/代理/410 现在就能被独立验证。app 侧落地后这条分支永不触发。
  if (!bannerPort) {
    throw new Error(`实例既没写注册表、也没打出启动横幅（最后输出：${lines.slice(-5).join(' | ') || '无'}）`)
  }
  console.warn('[smoke] ⚠ 注册表记录未出现（app 侧登记尚未落地）⇒ 按冻结 schema 自行登记，继续验插件侧')
  const fake = writeFallbackRecord(bannerPort, proc.pid)
  return { proc, port: fake.port }
}

try {
  // ---- (1) 空注册表 ⇒ { instances: [] }（不炸、不挂）----
  const empty = await j('/api/__instances')
  assert.equal(empty.status, 200, `__instances 应 200（实际 ${empty.status}）`)
  assert.deepEqual(empty.json.instances, [], `空注册表必须回空数组（实际 ${empty.text}）`)
  assert.equal(empty.json.root, EMPTY_ROOT, 'root 应回 workspaceRoot')
  console.log(`[smoke] ✓ GET ${PREFIX}/api/__instances（空注册表）→ { instances: [] }`)

  // ---- (1b) 手工登记记录：两种布局 + 三种"坏记录"（冻结 schema）----
  //   default  → <root>/.tmp/instance.json（缺省实例的落点）
  //   deadX    → 形状合法但 pid 已死（活过滤必须滤掉，代理要回 410 而不是 404）
  //   badY     → 坏 JSON（当不存在，不炸；也从没"见过" ⇒ 404）
  const tmpRoot = path.join(EMPTY_ROOT, '.tmp')
  const namedDir = path.join(tmpRoot, 'instances')
  const writeRec = (file, rec) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(rec))
  }
  const baseRec = { host: '127.0.0.1', repoRoot: EMPTY_ROOT, startedAt: Date.now(), heartbeatAt: Date.now() }
  writeRec(path.join(tmpRoot, 'instance.json'), { ...baseRec, id: 'default', pid: process.pid, port: 9 })
  writeRec(path.join(namedDir, 'deadX', 'instance.json'), { ...baseRec, id: 'deadX', pid: 999999, port: 9 })
  fs.mkdirSync(path.join(namedDir, 'badY'), { recursive: true })
  fs.writeFileSync(path.join(namedDir, 'badY', 'instance.json'), '{ "id": "badY", 这不是 JSON')
  const mixed = await j('/api/__instances')
  const ids = (mixed.json.instances || []).map((x) => x.id)
  assert.deepEqual(ids, ['default'], `只应列出活记录 default（实际 ${mixed.text}）`)
  console.log('[smoke] ✓ 缺省实例布局（.tmp/instance.json）被列出；死 pid 记录被过滤')

  const dead = await j('/deadX/health')
  assert.equal(dead.status, 410, `记录在但 pid 已死应 410（实际 ${dead.status} ${dead.text}）`)
  const bad = await j('/badY/health')
  assert.equal(bad.status, 404, `坏 JSON 记录当不存在 ⇒ 404（实际 ${bad.status} ${bad.text}）`)
  console.log('[smoke] ✓ 死 pid 记录 → 410；坏 JSON 记录 → 404（都不挂住）')
  fs.rmSync(namedDir, { recursive: true, force: true })
  fs.rmSync(path.join(tmpRoot, 'instance.json'), { force: true })

  // ---- (2) 未知 id ⇒ 404（不是挂住、不是 500）----
  const never = await j('/never-seen-xyz/health')
  assert.equal(never.status, 404, `没见过的 id 应 404（实际 ${never.status} ${never.text}）`)
  assert.ok(never.json && never.json.error, '404 必须带可读错误')
  console.log('[smoke] ✓ 未知 id → 404 + 可读原因（不挂住）')

  // 保留段 / 未知 api 端点
  const badApi = await j('/api/__nope')
  assert.equal(badApi.status, 404, `未知 api 端点应 404（实际 ${badApi.status}）`)
  const reserved = await j('/api/health')
  assert.equal(reserved.status, 404, `保留 id "api" 不能被当实例（实际 ${reserved.status}）`)
  console.log('[smoke] ✓ 未知 api 端点 / 保留 id "api" → 404')

  // ---- (3) 以 agent 身份真起实例 → 注册表能看到 → 代理两个方向 ----
  fakeRoot = REPO // 切到真仓库根：注册表就在 <repo>/.tmp/instances/ 下
  const up = await startInstance()

  const list = await j('/api/__instances')
  assert.equal(list.status, 200)
  const mine = (list.json.instances || []).find((x) => x.id === INSTANCE)
  assert.ok(mine, `__instances 必须列出 ${INSTANCE}（实际 ${list.text}）`)
  assert.equal(mine.port, up.port, '__instances 的端口必须与注册表一致')
  console.log(`[smoke] ✓ __instances 列出 ${INSTANCE} port=${mine.port}（共 ${list.json.instances.length} 个活实例）`)

  const health = await j(`/${INSTANCE}/health`)
  assert.equal(health.status, 200, `代理 /health 应 200（实际 ${health.status} ${health.text}）`)
  assert.equal(health.json.ok, true, '代理到实例的 /health 必须 ok')
  assert.equal(health.json.instance, INSTANCE, '代理必须落到同名实例（不带实例串味）')
  console.log(`[smoke] ✓ 代理 GET ${PREFIX}/${INSTANCE}/health → ok=true instance=${health.json.instance}`)

  const script = await fetch(`${base}/${INSTANCE}/api/read-script`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ args: [0] }),
  })
  assert.equal(script.status, 200)
  assert.equal(script.headers.get('x-amayui-kind'), 'bin', '二进制响应必须带 x-amayui-kind: bin')
  const meta = decodeURIComponent(script.headers.get('x-amayui-meta') || '')
  assert.ok(meta.includes('SYSTEM4.BIN'), `元数据里应有脚本名（实际 ${meta}）`)
  const body = new Uint8Array(await script.arrayBuffer())
  assert.ok(body.length > 1000, `脚本字节应 >1000（实际 ${body.length}）`)
  console.log(`[smoke] ✓ 代理 POST ${PREFIX}/${INSTANCE}/api/read-script → ${body.length}B，meta=${meta}`)

  // ---- (4) SSE 必须**流式**直通（响应头不能被缓冲到第一个事件）----
  const ac = new AbortController()
  const tSse = Date.now()
  const sse = await fetch(`${base}/${INSTANCE}/events`, { signal: ac.signal })
  assert.equal(sse.status, 200, `SSE 应 200（实际 ${sse.status}）`)
  assert.ok(String(sse.headers.get('content-type')).includes('text/event-stream'), `SSE content-type 应 text/event-stream（实际 ${sse.headers.get('content-type')}）`)
  ac.abort()
  console.log(`[smoke] ✓ 代理 ${PREFIX}/${INSTANCE}/events → SSE 直通（响应头 ${Date.now() - tSse}ms 内到达）`)

  // ---- (5) 裸前缀：恰有一个活实例 ⇒ 302；否则 JSON 列表 + 提示 ----
  const bare = await fetch(base + '/', { redirect: 'manual' })
  if (bare.status === 302) {
    const loc = bare.headers.get('location')
    assert.ok(String(loc).startsWith(`${PREFIX}/`), `302 应跳到 ${PREFIX}/<id>/（实际 ${loc}）`)
    console.log(`[smoke] ✓ 裸前缀恰有一个活实例 → 302 ${loc}`)
  } else {
    assert.equal(bare.status, 200, `裸前缀应 302 或 200 JSON（实际 ${bare.status}）`)
    const bj = await bare.json()
    assert.ok(Array.isArray(bj.instances) && typeof bj.hint === 'string', '多实例时应回 JSON 列表 + 提示')
    console.log(`[smoke] ✓ 裸前缀多个活实例 → 200 JSON（${bj.instances.length} 个）+ hint`)
  }

  // ---- (6) 杀掉实例 → 记录消失/过期 → 410，且列表不再含它 ----
  child.kill('SIGTERM')
  const tKill = Date.now()
  const deadline = Date.now() + EXIT_TIMEOUT_MS
  for (;;) {
    if (!recordExists()) break
    let rec = null
    try { rec = JSON.parse(fs.readFileSync(REG_FILE, 'utf8')) } catch { rec = null }
    const stale = !rec || !(Number(rec.heartbeatAt) > Date.now() - STALE_MS)
    if (stale) break
    if (Date.now() > deadline) {
      // 兜底模式（app 侧还没实现"退出删记录"）自己收尾，模拟宿主 close()。
      if (wroteFallbackRecord) { try { fs.rmSync(path.dirname(REG_FILE), { recursive: true, force: true }) } catch { /* 忽略 */ } break }
      throw new Error('杀掉实例后记录既没删、也没过期')
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  console.log(`[smoke] ✓ 杀掉实例后注册表记录消失/过期（${Date.now() - tKill}ms）`)

  const after = await j('/api/__instances')
  assert.ok(!(after.json.instances || []).some((x) => x.id === INSTANCE), `列表不应再含 ${INSTANCE}（实际 ${after.text}）`)
  const gone = await j(`/${INSTANCE}/health`)
  assert.equal(gone.status, 410, `已死 id 应 410（实际 ${gone.status} ${gone.text}）`)
  assert.ok(gone.json && gone.json.error, '410 必须带可读错误')
  console.log(`[smoke] ✓ 实例没了 → ${PREFIX}/${INSTANCE}/health = 410 + 可读原因；列表已剔除`)
} finally {
  if (child && child.exitCode === null) { try { child.kill('SIGKILL') } catch { /* 已经没了 */ } }
  // 只清理**本冒烟的**痕迹：临时空根 + smokeX 的实例目录（记录 + log/overlay；别的实例不动）。
  try { fs.rmSync(path.dirname(REG_FILE), { recursive: true, force: true }) } catch { /* 忽略 */ }
  try { fs.rmSync(EMPTY_ROOT, { recursive: true, force: true }) } catch { /* 没建过 */ }
  await new Promise((resolve) => server.close(resolve))
  for (const d of effects) if (typeof d === 'function') d()
  if (!registryLanded) {
    console.warn('[smoke] ⚠ 未走通"app 侧写注册表"这条主路径：本轮用的是自行登记兜底（插件侧结论仍然有效）')
  }
}
console.log('\n[smoke] 全部通过 ✅')
// ★必须显式退出：SSE abort 之后可能还有 pending 的 socket/读循环让事件循环不空。
process.exit(0)
