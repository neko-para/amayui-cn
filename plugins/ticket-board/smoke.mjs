/**
 * @amayui/ticket-board — 离线冒烟：不装进 profile、也不起 web 服务，用 node:fs 假装
 * `ctx.fs`，直接跑 Host 半的 `apply()`，再拿注册到的路由 handler 打一发
 * `GET /dsh-tickets/api/list`，核对返回的台账汇总与真实 `tickets/` 目录一致。
 *
 * 用法（仓库根）：`node plugins/ticket-board/smoke.mjs`
 *
 * 为什么值得留：静态 bundle 的 Host 半只在 profile 启动时才挂载，装完必须重启才能验；
 * 这个脚本让「聚合逻辑 + 路由 + JSON 形状」在没有重启的情况下也能被核对。
 */
import * as nodeFs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')

const fail = []
function check(ok, label, detail) {
  if (ok) {
    console.log('  ✓ ' + label)
  } else {
    console.log('  ✗ ' + label + (detail ? ' — ' + detail : ''))
    fail.push(label)
  }
}

/** node:fs 支撑的最小 FsTarget/FsDirEntry 替身（只覆盖 Host 半真正用到的方法）。 */
function makeFs(root) {
  const target = (p) => ({ targetKey: p })
  return {
    async resolve(p, opts) {
      const cwd = (opts && opts.cwd) || root
      return target(path.resolve(cwd, p))
    },
    async listDir(t) {
      return nodeFs.readdirSync(t.targetKey, { withFileTypes: true }).map((e) => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : e.isFile() ? 'file' : 'other',
        target: target(path.join(t.targetKey, e.name)),
      }))
    },
    async readText(t) {
      return nodeFs.readFileSync(t.targetKey, 'utf8')
    },
  }
}

function fakeResponse() {
  return {
    statusCode: 0,
    headers: null,
    body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers },
    end(text) { this.body = text },
  }
}

async function call(handler, url, method) {
  const res = fakeResponse()
  await handler({ url, method: method || 'GET' }, res)
  let json = null
  try { json = JSON.parse(res.body) } catch (e) { /* 保留原文 */ }
  return { status: res.statusCode, json, raw: res.body }
}

const mod = await import('./lib/index.js')
const routes = []
const effects = []
const ctx = {
  fs: makeFs(ROOT),
  webServer: { register: (route) => { routes.push(route); return () => {} } },
  effect(fn) { const d = fn(); effects.push(d); return d },
  get(name) { return name === 'sandboxPolicy' ? { workspaceRoot: ROOT } : undefined },
}

mod.apply(ctx)

console.log('\n[1] 插件注册面')
check(mod.name === 'amayui-ticket-board', "name = 'amayui-ticket-board'")
check(Array.isArray(mod.inject) && mod.inject.includes('webServer') && mod.inject.includes('fs'),
  "inject 含 fs + webServer（webServer 必须 inject，否则路由静默不挂）", JSON.stringify(mod.inject))
check(routes.length === 1, '注册了 1 条路由', String(routes.length))
check(routes[0] && routes[0].kind === 'prefix' && routes[0].path === '/dsh-tickets',
  "路由 kind=prefix path='/dsh-tickets'（无尾斜杠）", routes[0] && routes[0].path)
check(effects.length === 1 && typeof effects[0] === 'function', 'ctx.effect 返回了 disposer（可撤销副作用）')

const handler = routes[0].handler

console.log('\n[2] GET /dsh-tickets/api/list')
const list = await call(handler, '/dsh-tickets/api/list')
check(list.status === 200 && list.json && list.json.ok === true, 'HTTP 200 + ok:true',
  'status=' + list.status + ' ' + String(list.raw).slice(0, 120))

const data = list.json || {}
const dirs = nodeFs.readdirSync(path.join(ROOT, 'tickets'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^T-\d{4}$/.test(e.name)).map((e) => e.name).sort()
const tickets = data.tickets || []

check(data.root === ROOT, 'root 解析为仓库根', String(data.root))
check(tickets.length === dirs.length, '票数 = tickets/ 下的 T-XXXX 目录数',
  tickets.length + ' vs ' + dirs.length)
check(tickets.map((t) => t.id).join(',') === dirs.join(','), 'id 集合与目录名逐一对应')
check(Array.isArray(data.issues) && data.issues.length === 0, '所有 ticket.json 均可解析（issues 为空）',
  JSON.stringify(data.issues))

console.log('\n[3] 汇总字段（看板按优先级展示的数据面）')
const c = data.counts || {}
const sum = c.doing + c.open + c.blocked + c.done + c.dropped
check(sum === c.total && c.total === tickets.length, 'counts 分状态之和 = total = 票数',
  JSON.stringify(c))
const byStatus = {}
for (const t of tickets) byStatus[t.status] = (byStatus[t.status] || 0) + 1
check(['doing', 'open', 'blocked', 'done', 'dropped'].every((s) => (c[s] || 0) === (byStatus[s] || 0)),
  'counts 与逐票统计一致', JSON.stringify(byStatus))

const PENDING = ['doing', 'open', 'blocked']
const pending = tickets.filter((t) => PENDING.indexOf(t.status) >= 0)
check(pending.length > 0, '至少有一张「还要做」的票（否则模态无内容）', String(pending.length))
check(pending.every((t) => ['P0', 'P1', 'P2', 'P3'].indexOf(t.priority) >= 0),
  '待办票的 priority 都在 P0..P3（分组键合法）', pending.map((t) => t.priority).join(','))
check(pending.every((t) => t.title && t.title.trim()), '待办票 title 非空')
check(tickets.filter((t) => t.status !== 'dropped').every((t) => t.acceptance.length > 0),
  '非 dropped 票 acceptance 非空（判据是票据纪律）')
check(pending.every((t) => Array.isArray(t.evidence)), 'evidence 是数组（模态逐条渲染锚点）')
check(pending.every((t) => Array.isArray(t.docs)), 'docs 是文件名数组（过程文档计数）')

for (const p of ['P0', 'P1', 'P2', 'P3']) {
  const n = pending.filter((t) => t.priority === p).length
  console.log('    ' + p + ' → ' + n + ' 张')
}

console.log('\n[4] 路由边界')
const diag = await call(handler, '/dsh-tickets/')
check(diag.status === 200 && diag.json && Array.isArray(diag.json.endpoints), 'GET /dsh-tickets/ 返回端点清单')
const missing = await call(handler, '/dsh-tickets/api/nope')
check(missing.status === 404 && missing.json && missing.json.ok === false, '未知端点 → 404 + ok:false')

console.log('\n' + (fail.length ? '✗ 失败 ' + fail.length + ' 项：' + fail.join(' / ') : '✓ 全部通过') + '\n')
process.exit(fail.length ? 1 : 0)
