/**
 * @amayui/ticket-board — 离线客户端冒烟：用真实的 `tickets/` 数据（先让 Host 半的
 * 路由跑一遍）喂给 Client 半，再把它注册的两个 slot 组件用 react-dom/server 渲染成
 * HTML，核对「顶部按钮」与「按优先级分组的模态」真的渲染出了内容。
 *
 * 用法（仓库根）：`node plugins/ticket-board/smoke-client.mjs`
 *
 * 依赖 react / react-dom（从 DSH profile 的 node_modules 解析；解析不到就跳过，
 * 不算失败——本脚本只在有 React 可用的机器上做渲染核对）。
 * 产物：`.tmp/ticket-board-preview.html`（可直接在浏览器/preview_html 里看）。
 */
import * as nodeFs from 'node:fs'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const DSH_HOME = process.env.DSH_HOME || path.join(process.env.HOME || '', '.dsh')

const fail = []
function check(ok, label, detail) {
  if (ok) console.log('  ✓ ' + label)
  else { console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); fail.push(label) }
}

// ---- react / react-dom 解析（找不到就跳过，不是插件的问题） ----
function resolveReact() {
  const candidates = [
    // 本仓库里唯一一份真实 react/react-dom：Electron 宿主前端（React 18，够做静态渲染核对）。
    path.join(ROOT, 'app', 'amayui-toolkit', 'index.js'),
    // profile / 插件自身的 node_modules（若是 pnpm 装进来的也能命中）。
    path.join(DSH_HOME, 'profiles', 'index.js'),
    path.join(HERE, 'index.js'),
  ]
  for (const c of candidates) {
    try {
      const req = createRequire(c)
      return { react: req('react'), server: req('react-dom/server'), req }
    } catch (e) { /* 试下一个 */ }
  }
  return null
}

const libs = resolveReact()
if (!libs) {
  console.log('\n⚠ 未解析到 react / react-dom（app/amayui-toolkit 或 profile 的 node_modules 里没有），跳过渲染核对。\n')
  process.exit(0)
}

// ---- [1] 拿真实 payload：Host 半 → 路由 handler ----
function makeFs(root) {
  const t = (p) => ({ targetKey: p })
  return {
    async resolve(p, opts) { return t(path.resolve((opts && opts.cwd) || root, p)) },
    async listDir(x) {
      return nodeFs.readdirSync(x.targetKey, { withFileTypes: true }).map((e) => ({
        name: e.name, type: e.isDirectory() ? 'directory' : e.isFile() ? 'file' : 'other',
        target: t(path.join(x.targetKey, e.name)),
      }))
    },
    async readText(x) { return nodeFs.readFileSync(x.targetKey, 'utf8') },
  }
}

const host = await import('./lib/index.js')
const routes = []
host.apply({
  fs: makeFs(ROOT),
  webServer: { register: (r) => { routes.push(r); return () => {} } },
  effect: (fn) => fn(),
  get: (n) => (n === 'sandboxPolicy' ? { workspaceRoot: ROOT } : undefined),
})

const res = { writeHead() {}, end(t) { this.body = t } }
await routes[0].handler({ url: '/dsh-tickets/api/list', method: 'GET' }, res)
const payload = JSON.parse(res.body)

console.log('\n[1] 真实台账 payload')
check(payload.ok === true && payload.tickets.length > 0, 'Host 路由返回 ' + payload.tickets.length + ' 张票')

// ---- [2] 加载 Client 半（模块加载器格式） ----
let captured = null
globalThis.window = { __ModuleLoader__: { load: (o) => { captured = o } } }
await import('./lib/client.js')
check(captured && captured.id === '@amayui/ticket-board', '模块加载器 id = @amayui/ticket-board')
check(typeof captured.factory === 'function', 'factory 是函数')

const req = libs.req
const client = captured.factory(req)
check(client.name === 'amayui-ticket-board' && Array.isArray(client.inject), "name/inject 导出正常")

const regs = {}
client.apply({
  slots: {
    inject: (name, fn) => fn(),
    register: (def, render) => { regs[def.name] = { def, render }; return () => {} },
  },
})

console.log('\n[2] slot 注册面')
check(!!regs['conversation.session.header.actions'], '注册了 conversation.session.header.actions（顶部按钮）')
check(regs['conversation.session.header.actions'].def.id === 'ticket-board-open', '顶部按钮 id = ticket-board-open')
check(!!regs['shell.overlay'], '注册了 shell.overlay（模态）')
check(regs['shell.overlay'].def.id === 'ticket-board-dialog', '模态 id = ticket-board-dialog')

// ---- [3] 渲染：按钮 → 打开模态 → 分组内容 ----
const react = libs.react
const server = libs.server

globalThis.fetch = async () => ({ status: 200, text: async () => JSON.stringify(payload) })

const headerEl = regs['conversation.session.header.actions'].render()
const headerHtml = server.renderToStaticMarkup(headerEl)
console.log('\n[3] 顶部按钮')
check(headerHtml.indexOf('需求单') >= 0, '按钮文案含「需求单」', headerHtml.slice(0, 120))
const pending = payload.tickets.filter((t) => t.status === 'doing' || t.status === 'open')
check(headerHtml.indexOf(String(pending.length)) >= 0, '按钮带待办数徽标 ' + pending.length, headerHtml.slice(0, 160))

// 点按钮：setShared({open:true}) + load(false)；等一拍让 fetch 落地。
// 服务端渲染没有交互，所以借一个探针组件在 React 渲染期里直接调用组件函数，
// 拿到它返回的元素（onClick 在内层 <button> 上），再把点击真实地发出去。
const HeaderComponent = headerEl.type
let innerHeader = null
function HeaderProbe() { innerHeader = HeaderComponent(); return null }
server.renderToStaticMarkup(react.createElement(HeaderProbe))
check(innerHeader && typeof innerHeader.props.onClick === 'function', '按钮元素带 onClick')
innerHeader.props.onClick()
await new Promise((r) => setTimeout(r, 30))

const modalHtml = server.renderToStaticMarkup(regs['shell.overlay'].render())
console.log('\n[4] 模态内容')
check(modalHtml.indexOf('当前需求单') >= 0, '标题「当前需求单」')
for (const p of ['P0', 'P1', 'P2', 'P3']) {
  const n = pending.filter((t) => t.priority === p).length
  if (n > 0) check(modalHtml.indexOf(p + ' · ') >= 0, '含优先级分组 ' + p + '（' + n + ' 张）')
}
check(modalHtml.indexOf(pending[0].id) >= 0, '含票号 ' + pending[0].id)
check(modalHtml.indexOf('正在处理') >= 0 && modalHtml.indexOf('待处理') >= 0, '含状态图例（正在处理 / 待处理）')
check(modalHtml.indexOf('判据') >= 0, '含「判据」小节（acceptance）')
check(modalHtml.indexOf('tickets/ @ ' + ROOT) >= 0, '页脚回显台账根目录')
const shownIds = pending.filter((t) => modalHtml.indexOf(t.id) >= 0).length
check(shownIds === pending.length, '全部 ' + pending.length + ' 张待办票都渲染进了模态', String(shownIds))

const outDir = path.join(ROOT, '.tmp')
nodeFs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, 'ticket-board-preview.html')
nodeFs.writeFileSync(outFile, '<!doctype html><html><head><meta charset="utf-8"><title>需求单模态预览</title></head><body style="margin:0;background:#eef1f4">'
  + modalHtml.replace('position:fixed;', 'position:relative;') + '</body></html>', 'utf8')
console.log('\n  预览：' + outFile)

console.log('\n' + (fail.length ? '✗ 失败 ' + fail.length + ' 项：' + fail.join(' / ') : '✓ 全部通过') + '\n')
process.exit(fail.length ? 1 : 0)
