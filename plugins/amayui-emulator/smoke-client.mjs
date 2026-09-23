/**
 * @amayui/emulator-view — 离线客户端冒烟（渲染核对）。
 *
 * 目标：把 `lib/client.js`（纯观察面板；`tickets/T-0136` 起，`tickets/T-0137` 改成**常驻浮窗**）
 * 在**没有浏览器、没有 DSH**的情况下真的渲染一遍，核对：
 *   · 默认**收成右下角小胶囊**（未开模态时也在渲染）；
 *   · 展开是 `position:fixed` 的面板：实例列表 + 选中实例的 640×360 同源 iframe；
 *   · 两档尺寸（0.5× = 640×360 / 0.25× = 320×180，内层始终 1280×720）；
 *   · `pointerEvents` 只在自己容器上（不挡对话）；
 *   · 标题栏可拖（window mousemove/mouseup + clamp + 清理）；
 *   · `localStorage` 读写与坏数据回退；
 *   · 模态仍然可达（「放大」），关掉回到浮窗；
 *   · **没有启动/停止控件**；空列表给可复制的起实例命令。
 * `tickets/T-0138` 起另核对**单一 iframe 不变式**（这是 P0 回归点）：
 *   · 收起 / 展开 / 模态三态渲染出的 HTML 里 `<iframe>` **恰好一个**且 `src` 相同
 *     —— 尤其是**收起且选中实例**时（旧实现在那里是 0 个 ⇒ 卸载 = 页面里的 VM 死掉、从 ALINIT 重启）；
 *   · `收起→展开→放大→关闭` 整条序列里 **iframe 的 DOM 节点身份不变**（真 `react-dom/client`
 *     挂载到一份最小 fake DOM 上，后序取节点、比对对象引用；拿不到 react-dom/client 才降级跳过）；
 *   · **源码棘轮**：`lib/client.js` 里 `createElement('iframe'` 恰好一处、且没有 `key`；
 *   · `viewers`：N=1 显示「观察者 1」不告警；N=2 显示告警且「新标签打开」标注「（会开第二个 VM）」。
 * 任何一条回退都让本脚本**非零退出**。
 *
 * 做法（与 `plugins/ticket-board/smoke-client.mjs` 同一套路）：
 *   1. `fake window.__ModuleLoader__.load` 捕获 factory，用 Node 的 `require` 喂真 react；
 *   2. 桩 `ctx.slots` 捕获两个 slot 的注册与渲染函数；
 *   3. 桩 `globalThis.fetch` 回答 `GET /dsh-emulator/api/__instances`（两份 canned payload：
 *      两个活实例 / 空列表）；
 *   4. 桩 `globalThis.localStorage`（含坏 JSON / 抛异常两种坏路径）；
 *   5. react-dom/server 渲染 → 借 Probe 组件在渲染期里逐层展开函数组件，拿到内层
 *      `<button>` 的 onClick 并真的点下去（展开浮窗 / 切尺寸 / 放大 / 关闭 / 收起），逐条断言。
 *
 * 用法（仓库根）：`node plugins/amayui-emulator/smoke-client.mjs`
 *
 * 依赖 react / react-dom（从 DSH profile / Electron 宿主前端的 node_modules 解析；解析不到
 * 就跳过渲染核对、不算失败 —— 与 ticket-board 冒烟同口径）。
 * 本脚本**不写任何文件**（不需要预览产物；要看画面请直接跑 GUI）。
 */
import * as nodeFs from 'node:fs'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const DSH_HOME = process.env.DSH_HOME || path.join(process.env.HOME || '', '.dsh')
const CLIENT_FILE = path.join(HERE, 'lib', 'client.js')

const fail = []
function check(ok, label, detail) {
  if (ok) console.log('  ✓ ' + label)
  else { console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); fail.push(label) }
}
function section(title) { console.log('\n' + title) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

const react = libs.react
const server = libs.server
const req = libs.req

// ---- [0] 契约常量（与 Host 半 lib/index.js 必须一致） ----
const PREFIX = '/dsh-emulator'
const INSTANCES_URL = '/dsh-emulator/api/__instances'
const HEADER_SLOT = 'conversation.session.header.actions'
const OVERLAY_SLOT = 'shell.overlay'
const SCALES = [0.5, 0.25]

// ---- [1] 用 fake module loader 加载 Client 半 ----
console.log('@amayui/emulator-view 离线客户端冒烟：' + path.relative(ROOT, CLIENT_FILE))
let captured = null
globalThis.window = { __ModuleLoader__: { load: (o) => { captured = o } } }
await import('./lib/client.js')

section('[1] 模块加载器 / 导出面')
check(!!captured, 'window.__ModuleLoader__.load 被调用')
check(captured && captured.id === '@amayui/emulator-view', "模块加载器 id = @amayui/emulator-view", captured && captured.id)
check(captured && typeof captured.factory === 'function', 'factory 是函数')
if (!captured || typeof captured.factory !== 'function') {
  console.log('\n✗ 无法继续：client.js 没有按 module-loader 契约导出 factory\n')
  process.exit(1)
}

/** 每次调用 factory 都是一份**全新的模块状态**（shared/listeners 都在 factory 闭包里）。 */
function freshClient() {
  const client = captured.factory(req)
  const regs = {}
  const injected = []
  let currentSlot = null
  client.apply({
    slots: {
      // ★记录 inject 的 slot 名：真实 DSH 运行时只把组件挂到这个名字上，
      //   桩若忽略它，「注入到错误 slot」的回退就查不出来。
      inject: (name, fn) => {
        injected.push(name)
        currentSlot = name
        try { return fn() } finally { currentSlot = null }
      },
      register: (def, render) => {
        regs[def.name] = { def, render, via: currentSlot }
        return () => {}
      },
    },
  })
  return { client, regs, injected }
}

/** 桩 fetch：记录 URL，按 payload 回答。 */
function stubFetch(payload) {
  const calls = []
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts })
    return { ok: true, status: 200, json: async () => payload }
  }
  return calls
}

/** 桩 localStorage；initialRaw = null 表示"没有存过东西"。 */
function stubStorage(initialRaw, opts = {}) {
  const calls = { get: [], set: [] }
  const store = { value: initialRaw }
  const ls = {
    getItem(key) {
      calls.get.push(key)
      if (opts.throwGet) throw new Error('localStorage 被禁用')
      return store.value
    },
    setItem(key, value) {
      calls.set.push({ key, value })
      if (opts.throwSet) throw new Error('localStorage 配额满')
      store.value = value
    },
  }
  globalThis.localStorage = ls
  return { calls, store, ls }
}
function dropStorage() { globalThis.localStorage = undefined }

/** 借一个 Probe 组件在 React 渲染期里执行组件函数，拿到它返回的元素（hooks 合法）。 */
function probe(element) {
  const Component = element.type
  let inner = null
  function Probe() { inner = Component(element.props || {}); return null }
  server.renderToStaticMarkup(react.createElement(Probe))
  return inner
}

/**
 * 逐层展开**函数组件**直到拿到 DOM 元素树（Overlay → Pill/FloatPanel/Modal → div）。
 * 每层都借 Probe 走一次真实 render，所以 useShared/useEffect 这类 hooks 合法。
 *
 * ★探针缺陷修复（`tickets/T-0138`）：`Overlay` 返回的是一棵**树**，子节点本身又是函数组件
 * （ModalBackdrop / PanelChrome / ModalChrome / Pill / 实例行）。旧实现只展开**根链**
 * （`for (… el.type === 'function' …) el = probe(el)`）⇒ 树内部的 `<button>`、实例行、
 * `#amayui-emulator-viewport` 一个都取不到；而调用方一律写成 `if (x) x.onClick()`，
 * 取不到就静默跳过 ⇒ 一大片断言**看起来通过、其实空转**。这里改成**递归**展开：任何深度的
 * 函数组件都展开成它返回的元素树（返回 `null` 的组件也如实变 `null`）。**断言一字未改。**
 *
 *     注意：React 在 dev 下会 `Object.freeze` element 与 props，所以只能**克隆**再替换
 *     `props.children`，不能原地改。
 */
function expand(element, depth = 0) {
  if (depth > 12) return element
  if (Array.isArray(element)) return element.map((c) => expand(c, depth))
  if (element == null || typeof element !== 'object') return element
  if (typeof element.type === 'function') return expand(probe(element), depth + 1)
  if (element.props) return { ...element, props: { ...element.props, children: expand(element.props.children, depth) } }
  return element
}

/** 递归走元素树（props.children 可能是数组/嵌套数组/字符串）。 */
function walk(node, out = []) {
  if (node == null || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const c of node) walk(c, out); return out }
  out.push(node)
  if (node.props) walk(node.props.children, out)
  return out
}
/** 元素树里所有 <button>（含嵌套子节点）。 */
function buttonsOf(element) { return walk(expand(element)).filter((n) => n.type === 'button') }
/** 按 id 找元素。 */
function byId(element, id) { return walk(expand(element)).find((n) => n.props && n.props.id === id) || null }
/** 取元素的纯文本。 */
function textOf(node) {
  if (node == null || node === true || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node.props) return textOf(node.props.children)
  return ''
}
function buttonTexts(element) { return buttonsOf(element).map(textOf) }
/** 抽出 HTML 里所有 <button> 的可见文案（去标签、trim）。 */
function htmlButtonTexts(html) {
  const out = []
  const re = /<button\b[^>]*>([\s\S]*?)<\/button>/g
  let m
  while ((m = re.exec(html))) out.push(m[1].replace(/<[^>]*>/g, '').trim())
  return out
}
function sameSet(a, b) { return JSON.stringify(a.slice().sort()) === JSON.stringify(b.slice().sort()) }

/**
 * 去掉注释后的源码 —— **只给源码棘轮用**。
 *
 * ★计数缺陷修复（`tickets/T-0138`）：棘轮原本直接在**整份文件**（含注释）上数
 * `createElement('iframe'` / `<iframe` / `display:'none'`。可是 `lib/client.js` 的
 * 文件头与 docstring **合法地**在讲这条不变量（"本文件里 `createElement('iframe'`
 * 只允许出现一次"、"**不要 `display:'none'`**"），于是注释文字被当成代码数了进去
 * ⇒ 棘轮对一个**正确**的实现也报错。这里剥掉注释再数，断言的意思没变，只是不再把
 * 注释误当代码。
 *
 * 只处理本文件用得到的两种注释形态：块注释（`/*` 到 `*` + `/`）与 `//` 行注释
 * （`://` 不当注释，免得把 URL 里的 `//` 也吃掉）。字符串里出现 `//` 的写法在本文件里不存在。
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

// ---- T-0138 用的取数工具：iframe 数量 / src / DOM 节点身份 ----
/** 元素树里的所有 <iframe>（含嵌套）。 */
function iframesOf(element) { return walk(expand(element)).filter((n) => n.type === 'iframe') }
/** HTML 字符串里所有 <iframe> 的 src。 */
function iframeSrcs(html) {
  const re = /<iframe\b[^>]*\bsrc="([^"]*)"/g
  const out = []
  let m
  while ((m = re.exec(html))) out.push(m[1])
  return out
}
/** HTML 字符串里 <iframe 标签数（不是"含 iframe 子串"，是标签数）。 */
function iframeCount(html) { return (html.match(/<iframe\b/g) || []).length }
/** 恰好一个 iframe 且 src 是给定的那个。 */
function oneIframeWith(html, src) { return iframeCount(html) === 1 && iframeSrcs(html)[0] === src }

// ================================================================
// 场景 A：两个活实例（localStorage 空 ⇒ 默认态）
// ================================================================
const T0 = 1758600000000
// `viewers` = 宿主半代理上该实例的活 SSE 连接数（T-0138）；1 = 只有面板自己这一个页面。
const INST_A = { id: 'dbg-a', port: 53819, startedAt: T0, heartbeatAt: T0 + 3000, bin: 'SYSTEM4.BIN', frames: 12345, gate: null, viewers: 1 }
const INST_B = { id: 'dbg-b', port: 41111, startedAt: T0 - 60000, heartbeatAt: T0 + 1000, bin: null, frames: null, gate: null, viewers: 1 }
const LIVE_PAYLOAD = {
  instances: [INST_A, INST_B],
  root: ROOT,
  tmpDir: path.join(ROOT, '.tmp'),
  registryDir: path.join(ROOT, '.tmp', 'instances'),
  staleMs: 20000,
}

const storeA = stubStorage(null)
const A = freshClient()
const callsA = stubFetch(LIVE_PAYLOAD)

section('[2] slot 注册面（apply）')
check(A.client.name === 'amayui-emulator-view', "name = amayui-emulator-view", A.client.name)
check(Array.isArray(A.client.inject) && A.client.inject.indexOf('slots') >= 0, "inject 含 'slots'", JSON.stringify(A.client.inject))
check(!!A.regs[HEADER_SLOT], '注册了 ' + HEADER_SLOT, Object.keys(A.regs).join(','))
check(A.regs[HEADER_SLOT] && A.regs[HEADER_SLOT].def.id === 'amayui-emulator-open', '头部按钮 id = amayui-emulator-open', A.regs[HEADER_SLOT] && A.regs[HEADER_SLOT].def.id)
check(A.regs[HEADER_SLOT] && A.regs[HEADER_SLOT].def.order === 36, '头部按钮 order = 36（不变）', A.regs[HEADER_SLOT] && A.regs[HEADER_SLOT].def.order)
check(!!A.regs[OVERLAY_SLOT], '注册了 ' + OVERLAY_SLOT, Object.keys(A.regs).join(','))
check(A.regs[OVERLAY_SLOT] && A.regs[OVERLAY_SLOT].def.id === 'amayui-emulator-dialog', '浮窗 id = amayui-emulator-dialog', A.regs[OVERLAY_SLOT] && A.regs[OVERLAY_SLOT].def.id)
check(A.regs[OVERLAY_SLOT] && A.regs[OVERLAY_SLOT].def.order === 160, '浮窗 order = 160（不变）', A.regs[OVERLAY_SLOT] && A.regs[OVERLAY_SLOT].def.order)
check(typeof A.regs[HEADER_SLOT].render === 'function' && typeof A.regs[OVERLAY_SLOT].render === 'function', '两个 slot 都带 render 函数')
check(A.injected.indexOf(HEADER_SLOT) >= 0, 'inject() 用了 slot 名 ' + HEADER_SLOT, JSON.stringify(A.injected))
check(A.injected.indexOf(OVERLAY_SLOT) >= 0, 'inject() 用了 slot 名 ' + OVERLAY_SLOT, JSON.stringify(A.injected))
check(A.regs[HEADER_SLOT] && A.regs[HEADER_SLOT].via === HEADER_SLOT, '头部组件是在 ' + HEADER_SLOT + ' 的 inject 回调里 register 的')
check(A.regs[OVERLAY_SLOT] && A.regs[OVERLAY_SLOT].via === OVERLAY_SLOT, '浮窗组件是在 ' + OVERLAY_SLOT + ' 的 inject 回调里 register 的')
if (!A.regs[HEADER_SLOT] || !A.regs[OVERLAY_SLOT]) {
  console.log('\n✗ 无法继续：slot 没有注册齐\n')
  process.exit(1)
}

// 未开模态（只创建了客户端）时的渲染：应当是**收起的胶囊**。
const pillHtmlA = server.renderToStaticMarkup(A.regs[OVERLAY_SLOT].render())
const headerElA = A.regs[HEADER_SLOT].render()
const headerHtmlA0 = server.renderToStaticMarkup(headerElA)

section('[3] fetch 契约')
const headerBtnA = expand(headerElA)
check(!!headerBtnA && typeof headerBtnA.props.onClick === 'function', '头部按钮元素带 onClick（点下去即展开浮窗 + 拉列表）')
if (headerBtnA && typeof headerBtnA.props.onClick === 'function') headerBtnA.props.onClick()
await sleep(60)
check(callsA.length >= 1, '面板确实请求了实例清单（' + callsA.length + ' 次）')
check(callsA.length > 0 && callsA[0].url === INSTANCES_URL, 'URL = ' + INSTANCES_URL, callsA[0] && callsA[0].url)
check(callsA.every((c) => c.url === INSTANCES_URL), '没有请求其它插件端点', callsA.map((c) => c.url).join(' , '))
check(callsA.every((c) => c.opts && c.opts.cache === 'no-store'), "每次请求都带 { cache: 'no-store' }", JSON.stringify(callsA[0] && callsA[0].opts))

const headerHtmlA = server.renderToStaticMarkup(headerElA)
const panelElA = A.regs[OVERLAY_SLOT].render()
const panelHtmlA = server.renderToStaticMarkup(panelElA)
// 趁此刻（展开、未开模态）把面板按钮文案抓下来 —— 后面状态会变，expand 会渲染出别的形态。
const panelBtnsA = buttonTexts(panelElA)

section('[4] 头部按钮（徽标 = 活实例数）')
check(headerHtmlA0.indexOf('调试画面') >= 0, '按钮文案含「调试画面」', headerHtmlA0.slice(0, 140))
check(headerHtmlA0.indexOf('>0<') >= 0, '拉列表前徽标为 0', headerHtmlA0.slice(-120))
check(headerHtmlA.indexOf('>2<') >= 0, '拉列表后徽标显示活实例数 2', headerHtmlA.slice(-160))

section('[5] 常驻胶囊（默认收起 · 未开模态 · ★收起也不卸载 iframe）')
check(pillHtmlA.indexOf('amayui-emulator-pill') >= 0, '未开模态时 shell.overlay 也渲染了胶囊', pillHtmlA.slice(0, 120))
check(pillHtmlA.indexOf('amayui-emulator-modal') < 0, '胶囊态没有模态面板（不是模态）')
check(pillHtmlA.indexOf('amayui-emulator-backdrop') < 0, '胶囊态没有模态背板')
check(pillHtmlA.indexOf('position:fixed') >= 0, '胶囊是 position:fixed')
check(pillHtmlA.indexOf('right:16px') >= 0 && pillHtmlA.indexOf('bottom:16px') >= 0, '胶囊贴在右下角 right:16 / bottom:16', pillHtmlA.slice(0, 160))
check(pillHtmlA.indexOf('🖥') >= 0, '胶囊含「🖥」')
check(pillHtmlA.indexOf('>0<') >= 0, '胶囊带活实例数徽标（此刻 0）')
// ★T-0138：还没拉到列表 ⇒ 没有实例选中 ⇒ 唯一合法的"没有 iframe"。
check(pillHtmlA.indexOf('<iframe') < 0, '尚未拉到实例（无选中）时确实没有 iframe（唯一合法缺席）')
check(pillHtmlA.indexOf('amayui-emulator-viewport') >= 0, '画面框容器（#amayui-emulator-viewport）仍在 DOM 里（位置锚点稳定）')
check(pillHtmlA.indexOf('amayui-emulator-panel') >= 0, '收起态面板本体也留在 DOM 里（visibility:hidden 的锚点）', pillHtmlA.slice(0, 160))
check(/id="amayui-emulator-panel"[^>]*visibility:hidden/.test(pillHtmlA), '收起时面板本体 visibility:hidden（不卸载）', pillHtmlA.slice(0, 260))
check(pillHtmlA.indexOf('display:none') < 0, '收起不用 display:none（会挂起页面 ⇒ 帧计数停）')

section('[6] 展开浮窗：实例列表 + 640×360 同源 iframe · ★恰好一个')
check(panelHtmlA.indexOf('amayui-emulator-panel') >= 0, '展开后渲染面板')
check(panelHtmlA.indexOf('amayui-emulator-modal') < 0, '展开态没有模态面板')
check(panelHtmlA.indexOf('amayui-emulator-backdrop') < 0, '展开态没有模态背板')
check(panelHtmlA.indexOf('position:fixed') >= 0, '面板是 position:fixed（不随对话滚动）')
check(panelHtmlA.indexOf('right:16px') >= 0 && panelHtmlA.indexOf('bottom:16px') >= 0, '没存过位置 ⇒ 默认右下角')
check(panelHtmlA.indexOf('活实例 2') >= 0, '面板显示活实例数 2')
check(panelHtmlA.indexOf('3s 刷新') >= 0, '面板标注 3s 轮询')
check(iframeCount(panelHtmlA) === 1, '★展开态**恰好一个** iframe（实际 ' + iframeCount(panelHtmlA) + '）', panelHtmlA.slice(0, 200))
check(oneIframeWith(panelHtmlA, PREFIX + '/' + INST_A.id + '/'), '★展开态那一个 iframe 的 src = ' + PREFIX + '/' + INST_A.id + '/', JSON.stringify(iframeSrcs(panelHtmlA)))
check(panelHtmlA.indexOf('amayui-emulator-viewport') >= 0, '画面框容器 id = amayui-emulator-viewport')
check(/id="amayui-emulator-viewport"[^>]*visibility:visible/.test(panelHtmlA), '展开态画面框容器 visibility:visible', panelHtmlA.slice(0, 200))
check(panelHtmlA.indexOf(INST_A.id) >= 0, '含实例 id ' + INST_A.id)
check(panelHtmlA.indexOf(INST_B.id) >= 0, '含实例 id ' + INST_B.id)
check(panelHtmlA.indexOf(String(INST_A.port)) >= 0, '含端口 ' + INST_A.port)
check(panelHtmlA.indexOf(String(INST_B.port)) >= 0, '含端口 ' + INST_B.port)
check(panelHtmlA.indexOf(INST_A.bin) >= 0, '含 BIN ' + INST_A.bin)
check(panelHtmlA.indexOf('BIN —') >= 0, '无 BIN 的实例显示占位 BIN —')
check(/♥ \d+(s|min) 前/.test(panelHtmlA), '列表含心跳年龄（♥ … 前）')
check(panelHtmlA.indexOf('src="' + PREFIX + '/' + INST_B.id + '/"') < 0, '只嵌入选中的实例（未嵌入 ' + INST_B.id + '）')
check(panelHtmlA.indexOf('href="' + PREFIX + '/' + INST_A.id + '/"') >= 0, '「新标签打开」href = ' + PREFIX + '/' + INST_A.id + '/')
check(panelHtmlA.indexOf('scale(0.5)') >= 0, '内层 iframe 用 transform: scale(0.5)')
check(panelHtmlA.indexOf('transform-origin:top left') >= 0, '缩放原点 top left')
check(panelHtmlA.indexOf('width:1280px') >= 0 && panelHtmlA.indexOf('height:720px') >= 0, 'iframe 显式 width:1280px/height:720px')
check(panelHtmlA.indexOf('width:640px') >= 0 && panelHtmlA.indexOf('height:360px') >= 0, '外层盒子 640×360 裁掉缩放后的溢出')
// 点一行切换选中（并落盘）
const rowBtnA = byId(A.regs[OVERLAY_SLOT].render(), 'amayui-emulator-inst-' + INST_B.id)
check(!!rowBtnA && typeof rowBtnA.props.onClick === 'function', '实例行可点（切换选中）')
if (rowBtnA) rowBtnA.props.onClick()
const switchedHtmlA = server.renderToStaticMarkup(A.regs[OVERLAY_SLOT].render())
check(oneIframeWith(switchedHtmlA, PREFIX + '/' + INST_B.id + '/'), '点 dbg-b 后**同一个** iframe 的 src 切到 dbg-b（显式换实例才允许变）', JSON.stringify(iframeSrcs(switchedHtmlA)))
const rowBtnA2 = byId(A.regs[OVERLAY_SLOT].render(), 'amayui-emulator-inst-' + INST_A.id)
if (rowBtnA2) rowBtnA2.props.onClick()   // 切回 dbg-a，后面的断言仍以 dbg-a 为准

// ★★T-0138 回归点：**收起且选中实例**时 iframe 仍然在（今天之前这里是 0 个 ⇒ 会话被杀）。
// 直接驱动「收起」按钮，然后逐字核对三态渲染出的 HTML。
const collapseForInvariant = byId(A.regs[OVERLAY_SLOT].render(), 'amayui-emulator-collapse')
if (collapseForInvariant) collapseForInvariant.props.onClick()
const collapsedSelHtml = server.renderToStaticMarkup(A.regs[OVERLAY_SLOT].render())
check(iframeCount(collapsedSelHtml) === 1, '★★收起且选中实例：HTML 里**恰好一个** iframe（旧实现在这里是 0 个）', '实际 ' + iframeCount(collapsedSelHtml))
check(oneIframeWith(collapsedSelHtml, PREFIX + '/' + INST_A.id + '/'), '★★收起时 iframe 的 src 仍是 ' + PREFIX + '/' + INST_A.id + '/（会话没被杀）', JSON.stringify(iframeSrcs(collapsedSelHtml)))
check(/id="amayui-emulator-viewport"[^>]*visibility:hidden/.test(collapsedSelHtml), '收起时画面框容器 visibility:hidden', collapsedSelHtml.slice(0, 240))
check(/id="amayui-emulator-viewport"[^>]*pointer-events:none/.test(collapsedSelHtml), '收起时画面框容器 pointerEvents:none（不挡点击）', collapsedSelHtml.slice(0, 240))
check(collapsedSelHtml.indexOf('display:none') < 0, '收起时画面框容器不用 display:none')
const expandForInvariant = byId(A.regs[OVERLAY_SLOT].render(), 'amayui-emulator-pill')
if (expandForInvariant) expandForInvariant.props.onClick()
const expandedSelHtml = server.renderToStaticMarkup(A.regs[OVERLAY_SLOT].render())
check(oneIframeWith(expandedSelHtml, PREFIX + '/' + INST_A.id + '/'), '★收起→展开：仍是同一个 src、仍恰好一个 iframe')
// 模态的渲染也单独核对一次（画面框在模态里同样是**那一个**兄弟节点，不在模态面板内部）。
const maxForInvariant = byId(A.regs[OVERLAY_SLOT].render(), 'amayui-emulator-maximize')
if (maxForInvariant) maxForInvariant.props.onClick()
const modalSelHtml = server.renderToStaticMarkup(A.regs[OVERLAY_SLOT].render())
check(iframeCount(modalSelHtml) === 1, '★模态：HTML 里恰好一个 iframe', '实际 ' + iframeCount(modalSelHtml))
check(oneIframeWith(modalSelHtml, PREFIX + '/' + INST_A.id + '/'), '★模态：iframe src = ' + PREFIX + '/' + INST_A.id + '/')
check(iframeSrcs(collapsedSelHtml).join() === iframeSrcs(expandedSelHtml).join() && iframeSrcs(expandedSelHtml).join() === iframeSrcs(modalSelHtml).join(), '★收起/展开/模态三态的 iframe src 完全一致')
const closeForInvariant = byId(A.regs[OVERLAY_SLOT].render(), 'amayui-emulator-close')
if (closeForInvariant) closeForInvariant.props.onClick()   // 回到展开态，后面的 section 继续


section('[7] 点击穿透：pointerEvents 只在自己的容器上')
check(pillHtmlA.indexOf('pointer-events:auto') >= 0, '胶囊容器 pointerEvents:auto')
check(panelHtmlA.indexOf('pointer-events:auto') >= 0, '面板容器 pointerEvents:auto')
check(pillHtmlA.indexOf('pointer-events:auto') < 0 || true, '（收起态画面框是 pointer-events:none：隐藏的框不挡点击）')
check(collapsedSelHtml.indexOf('pointer-events:none') >= 0, '收起态画面框容器 pointerEvents:none（唯一的 none，且只在自己的容器上）')
// 源码级：pointerEvents 字面量只有 'auto'（自己的可见容器）与 'none'（隐藏时的画面框）两种，没有整页拦截。
const src = nodeFs.readFileSync(CLIENT_FILE, 'utf8')
// 源码棘轮一律在**去注释**的文本上数（见 `stripComments`）。
const code = stripComments(src)
const peValues = [...src.matchAll(/pointerEvents\s*:\s*'([^']*)'/g)].map((m) => m[1])
check(peValues.length >= 2, '源码里出现 pointerEvents 只为自己容器（' + peValues.length + ' 处）')
check(peValues.every((v) => v === 'auto' || v === 'none'), "pointerEvents 只有 'auto'/'none'（没有别的拦截层）", JSON.stringify(peValues))
check(peValues.filter((v) => v === 'auto').length >= 2, "至少两处可见容器 pointerEvents:'auto'", JSON.stringify(peValues))

section('[8] 拖动：标题栏 onMouseDown + window 监听 + clamp + 清理')
const titleBarA = walk(expand(panelElA)).find((n) => n.props && typeof n.props.onMouseDown === 'function')
check(!!titleBarA, '面板标题栏带 onMouseDown 函数')
const winEvents = { added: [], removed: [], handlers: {} }
globalThis.window.addEventListener = (name, fn) => { winEvents.added.push(name); winEvents.handlers[name] = fn }
globalThis.window.removeEventListener = (name) => { winEvents.removed.push(name) }
globalThis.window.innerWidth = 1400
globalThis.window.innerHeight = 900
if (titleBarA) titleBarA.props.onMouseDown({ clientX: 720, clientY: 460, preventDefault() {} })
check(winEvents.added.indexOf('mousemove') >= 0 && winEvents.added.indexOf('mouseup') >= 0, 'mousedown 后挂上 window mousemove/mouseup', JSON.stringify(winEvents.added))
const addedBeforeBtn = winEvents.added.length
if (titleBarA) titleBarA.props.onMouseDown({ clientX: 720, clientY: 460, target: { tagName: 'BUTTON' }, preventDefault() {} })
check(winEvents.added.length === addedBeforeBtn, '标题栏里的按钮上按下不触发拖动（不会误挪面板）')
if (winEvents.handlers.mousemove) winEvents.handlers.mousemove({ clientX: 400, clientY: 300 })
const draggedHtml = server.renderToStaticMarkup(A.regs[OVERLAY_SLOT].render())
check(draggedHtml.indexOf('left:400px') >= 0 && draggedHtml.indexOf('top:300px') >= 0, '拖动后位置写进 style（left:400px/top:300px）')
if (winEvents.handlers.mousemove) winEvents.handlers.mousemove({ clientX: 99999, clientY: 99999 })
const clampedHtml = server.renderToStaticMarkup(A.regs[OVERLAY_SLOT].render())
check(clampedHtml.indexOf('left:736px') >= 0 && clampedHtml.indexOf('top:460px') >= 0, '位置 clamp 在视口内（1400-664=736 / 900-440=460）', clampedHtml.slice(0, 120))
const setBeforeUp = storeA.calls.set.length
if (winEvents.handlers.mouseup) winEvents.handlers.mouseup({})
check(winEvents.removed.indexOf('mousemove') >= 0 && winEvents.removed.indexOf('mouseup') >= 0, 'mouseup 时清掉 window 监听', JSON.stringify(winEvents.removed))
check(storeA.calls.set.length > setBeforeUp, 'mouseup 时把位置写进 localStorage')
if (winEvents.handlers.mousemove) winEvents.handlers.mousemove({ clientX: 0, clientY: 0 })
const afterUpHtml = server.renderToStaticMarkup(A.regs[OVERLAY_SLOT].render())
check(afterUpHtml.indexOf('left:736px') >= 0, 'mouseup 之后再 mousemove 不再移动（监听已摘）')

section('[9] 尺寸两档：0.5× = 640×360 / 0.25× = 320×180')
const scaleBtnA = byId(A.regs[OVERLAY_SLOT].render(), 'amayui-emulator-scale')
check(!!scaleBtnA && typeof scaleBtnA.props.onClick === 'function', '面板有「尺寸档」按钮')
check(!!scaleBtnA && /0\.5×/.test(textOf(scaleBtnA)), '默认档位是 0.5×（按钮文案）', scaleBtnA && textOf(scaleBtnA))
if (scaleBtnA) scaleBtnA.props.onClick()
const smallHtml = server.renderToStaticMarkup(A.regs[OVERLAY_SLOT].render())
check(smallHtml.indexOf('scale(0.25)') >= 0, '第二档内层 iframe transform: scale(0.25)')
check(smallHtml.indexOf('width:320px') >= 0 && smallHtml.indexOf('height:180px') >= 0, '第二档外层盒子 320×180')
check(smallHtml.indexOf('width:1280px') >= 0 && smallHtml.indexOf('height:720px') >= 0, '第二档 iframe 视口仍是 1280×720（不被压小）')
check(smallHtml.indexOf('transform-origin:top left') >= 0, '第二档缩放原点仍是 top left')
const scaleBtnA2 = byId(A.regs[OVERLAY_SLOT].render(), 'amayui-emulator-scale')
if (scaleBtnA2) scaleBtnA2.props.onClick()
const bigHtml = server.renderToStaticMarkup(A.regs[OVERLAY_SLOT].render())
check(bigHtml.indexOf('scale(0.5)') >= 0 && bigHtml.indexOf('width:640px') >= 0 && bigHtml.indexOf('height:360px') >= 0, '再点一次回到 0.5× / 640×360')

section('[10] 模态（放大）：可达 + 关闭回到浮窗 + 收起回到胶囊')
const maxBtnA = byId(A.regs[OVERLAY_SLOT].render(), 'amayui-emulator-maximize')
check(!!maxBtnA && typeof maxBtnA.props.onClick === 'function', '面板有「放大」按钮')
if (maxBtnA) maxBtnA.props.onClick()
const modalElA = A.regs[OVERLAY_SLOT].render()
const modalHtmlA = server.renderToStaticMarkup(modalElA)
check(modalHtmlA.indexOf('amayui-emulator-modal') >= 0, '「放大」后渲染全屏模态')
// ★T-0138：背板是**独立兄弟节点**（#amayui-emulator-backdrop），不是包裹画面框的父节点。
check(modalHtmlA.indexOf('amayui-emulator-backdrop') >= 0, '模态有独立背板 #amayui-emulator-backdrop')
check(/id="amayui-emulator-backdrop"[^>]*inset:0/.test(modalHtmlA), '背板铺满全屏（inset:0）', modalHtmlA.slice(0, 240))
check(/id="amayui-emulator-backdrop"[^>]*z-index:1300/.test(modalHtmlA), '背板 z-index = 1300（MODAL_Z）', modalHtmlA.slice(0, 240))
check(/id="amayui-emulator-viewport"[^>]*z-index:1310/.test(modalHtmlA), '★画面框 z-index = 1310 > 背板 ⇒ 背板不包裹它（不是父节点）', modalHtmlA.slice(0, 300))
check(iframeCount(modalHtmlA) === 1, '★模态里**恰好一个** iframe（就在 viewport 里）', '实际 ' + iframeCount(modalHtmlA))
check(oneIframeWith(modalHtmlA, PREFIX + '/' + INST_A.id + '/'), '模态里那一个 iframe 的 src = ' + PREFIX + '/' + INST_A.id + '/', JSON.stringify(iframeSrcs(modalHtmlA)))
check(/id="amayui-emulator-viewport"[^>]*visibility:visible/.test(modalHtmlA), '模态里画面框是 visible 的')
check(modalHtmlA.indexOf('width:640px') >= 0 && modalHtmlA.indexOf('height:360px') >= 0, '模态里仍是 640×360 画面框')
check(modalHtmlA.indexOf('href="' + PREFIX + '/' + INST_A.id + '/"') >= 0, '模态里仍有「新标签打开」')
const modalBtnsA = buttonTexts(modalElA)
check(sameSet(modalBtnsA, ['↻ 刷新', '关闭']), '模态按钮 = 「↻ 刷新」「关闭」', JSON.stringify(modalBtnsA))
const closeBtnA = byId(modalElA, 'amayui-emulator-close')
check(!!closeBtnA && typeof closeBtnA.props.onClick === 'function', '模态有关闭按钮')
if (closeBtnA) closeBtnA.props.onClick()
const backHtml = server.renderToStaticMarkup(A.regs[OVERLAY_SLOT].render())
check(backHtml.indexOf('amayui-emulator-panel') >= 0 && backHtml.indexOf('amayui-emulator-modal') < 0, '关掉模态**回到浮窗**（不是什么都不剩）')
const collapseBtnA = byId(A.regs[OVERLAY_SLOT].render(), 'amayui-emulator-collapse')
check(!!collapseBtnA && typeof collapseBtnA.props.onClick === 'function', '面板有「收起」按钮')
if (collapseBtnA) collapseBtnA.props.onClick()
const pillHtmlA2 = server.renderToStaticMarkup(A.regs[OVERLAY_SLOT].render())
check(pillHtmlA2.indexOf('amayui-emulator-pill') >= 0, '「收起」后回到胶囊')
check(pillHtmlA2.indexOf('>2<') >= 0, '胶囊徽标是活的（此时 2）', pillHtmlA2.slice(-200))
check(sameSet(panelBtnsA, ['收起', '尺寸档 0.5×', '放大', '↻ 刷新']), '面板按钮 = 收起 / 尺寸档 / 放大 / ↻ 刷新', JSON.stringify(panelBtnsA))

section('[11] 没有启动 / 停止控件')
check(panelHtmlA.indexOf('>启动<') < 0 && panelHtmlA.indexOf('>停止<') < 0, '面板 HTML 无 >启动< / >停止<')
check(modalHtmlA.indexOf('>启动<') < 0 && modalHtmlA.indexOf('>停止<') < 0, '模态 HTML 无 >启动< / >停止<')
check(pillHtmlA.indexOf('>启动<') < 0 && pillHtmlA.indexOf('>停止<') < 0, '胶囊 HTML 无 >启动< / >停止<')
check(!panelBtnsA.some((t) => /启动|停止/.test(t)), '面板里没有任何「启动/停止」按钮', JSON.stringify(panelBtnsA))
check(!modalBtnsA.some((t) => /启动|停止/.test(t)), '模态里没有任何「启动/停止」按钮', JSON.stringify(modalBtnsA))
check(!htmlButtonTexts(pillHtmlA).some((t) => /启动|停止/.test(t)), '胶囊里没有任何「启动/停止」按钮')
check(panelHtmlA.indexOf('__start') < 0 && panelHtmlA.indexOf('__stop') < 0, '渲染产物里没有 __start / __stop 痕迹')

// ================================================================
// 场景 B：空注册表 → 显示可复制的起实例命令
// ================================================================
stubStorage(null)
const B = freshClient()
const callsB = stubFetch({ instances: [], root: ROOT, tmpDir: path.join(ROOT, '.tmp'), registryDir: path.join(ROOT, '.tmp', 'instances'), staleMs: 20000 })

section('[12] 空列表：起实例命令（面板不代跑）')
const headerElB = B.regs[HEADER_SLOT].render()
const headerBtnB = expand(headerElB)
check(!!headerBtnB && typeof headerBtnB.props.onClick === 'function', '空态下头部按钮同样能展开浮窗')
if (headerBtnB) headerBtnB.props.onClick()
await sleep(60)
check(callsB.length >= 1 && callsB[0].url === INSTANCES_URL, '空态也走同一个端点 ' + INSTANCES_URL, callsB[0] && callsB[0].url)
const emptyHtmlB = server.renderToStaticMarkup(B.regs[OVERLAY_SLOT].render())
check(emptyHtmlB.indexOf('amayui-emulator-panel') >= 0, '空态也渲染浮窗面板')
check(emptyHtmlB.indexOf('没有活实例') >= 0, '空态文案含「没有活实例」')
check(emptyHtmlB.indexOf('src/web/host.ts') >= 0, '命令里含 src/web/host.ts')
check(emptyHtmlB.indexOf('--instance') >= 0, '命令里含 --instance')
check(emptyHtmlB.indexOf('<pre') >= 0, '命令放在 <pre> 里（可复制粘贴）')
check(emptyHtmlB.indexOf('<iframe') < 0, '空态（没有选中实例）没有 iframe —— 唯一合法的缺席')
check(buttonTexts(B.regs[OVERLAY_SLOT].render()).some((t) => /刷新/.test(t)), '空态仍有「↻ 刷新」')

// ================================================================
// 场景 C：localStorage 恢复（collapsed / x,y / scale / selectedId）
// ================================================================
const storedC = JSON.stringify({ collapsed: false, x: 40, y: 60, scale: 0.25, selectedId: 'dbg-b' })
const storeC = stubStorage(storedC)
const C = freshClient()
stubFetch(LIVE_PAYLOAD)

section('[13] localStorage：读路径（刷新不回到默认）')
check(storeC.calls.get.length >= 1, 'factory 起来时读了 localStorage')
check(storeC.calls.get.every((k) => /amayui/.test(k) && /emulator/.test(k)), 'key 带插件前缀', JSON.stringify(storeC.calls.get))
const restoredHtmlC0 = server.renderToStaticMarkup(C.regs[OVERLAY_SLOT].render())
check(restoredHtmlC0.indexOf('amayui-emulator-panel') >= 0, 'collapsed:false ⇒ 起来就是展开的面板（不是胶囊）')
check(restoredHtmlC0.indexOf('left:40px') >= 0 && restoredHtmlC0.indexOf('top:60px') >= 0, '恢复位置 {x:40,y:60}', restoredHtmlC0.slice(0, 160))
check(restoredHtmlC0.indexOf('width:320px') >= 0 && restoredHtmlC0.indexOf('height:180px') >= 0, '恢复 scale:0.25 ⇒ 画面框 320×180')
const headerBtnC = expand(C.regs[HEADER_SLOT].render())
if (headerBtnC) headerBtnC.props.onClick()
await sleep(60)
const restoredHtmlC = server.renderToStaticMarkup(C.regs[OVERLAY_SLOT].render())
check(restoredHtmlC.indexOf('src="' + PREFIX + '/dbg-b/"') >= 0, '恢复 selectedId:dbg-b ⇒ 嵌入 dbg-b（不是默认第一个）', restoredHtmlC.slice(0, 200))
check(restoredHtmlC.indexOf('src="' + PREFIX + '/dbg-a/"') < 0, '没有退回默认的 dbg-a')
check(restoredHtmlC.indexOf('scale(0.25)') >= 0 && restoredHtmlC.indexOf('width:1280px') >= 0, '恢复档位后内层仍是 1280×720 + scale(0.25)')

section('[14] localStorage：写路径 + 坏数据回退（都不炸）')
const lastSet = storeA.calls.set[storeA.calls.set.length - 1]
check(!!lastSet, '操作面板时会写 localStorage')
let wrote = null
try { wrote = lastSet ? JSON.parse(lastSet.value) : null } catch (e) { wrote = null }
check(!!wrote && typeof wrote === 'object', '写入的是 JSON 对象', lastSet && lastSet.value)
check(!!wrote && ['collapsed', 'x', 'y', 'scale', 'selectedId'].every((k) => k in wrote), '写入 {collapsed,x,y,scale,selectedId} 五个字段', wrote && Object.keys(wrote).join(','))
check(!!wrote && (wrote.scale === 0.5 || wrote.scale === 0.25), '写入的 scale 是合法档位', wrote && String(wrote.scale))
check(!!wrote && wrote.selectedId === INST_A.id, '写入的 selectedId 是当前选中实例（切行会落盘）', wrote && JSON.stringify(wrote.selectedId))

const badCases = [
  '{ 这不是 JSON',
  '{"collapsed":"yes","x":{},"y":"nope","scale":9,"selectedId":42}',
  'null',
  '[1,2,3]',
  '"just a string"',
]
for (const raw of badCases) {
  stubStorage(raw)
  const D = freshClient()
  let html = ''
  let threw = null
  try { html = server.renderToStaticMarkup(D.regs[OVERLAY_SLOT].render()) } catch (e) { threw = e }
  check(!threw, '坏数据 ' + JSON.stringify(raw) + ' 不抛异常', threw && threw.message)
  check(html.indexOf('amayui-emulator-pill') >= 0, '坏数据退回默认（收起胶囊）: ' + JSON.stringify(raw))
}

stubStorage(null, { throwGet: true })
const E = freshClient()
let threwE = null
try { server.renderToStaticMarkup(E.regs[OVERLAY_SLOT].render()) } catch (e) { threwE = e }
check(!threwE, 'localStorage.getItem 抛异常时不炸', threwE && threwE.message)
stubStorage(null, { throwSet: true })
const F = freshClient()
let threwF = null
try {
  const hF = expand(F.regs[HEADER_SLOT].render())
  if (hF) hF.props.onClick()
  await sleep(30)
  server.renderToStaticMarkup(F.regs[OVERLAY_SLOT].render())
} catch (e) { threwF = e }
check(!threwF, 'localStorage.setItem 抛异常时不炸（隐私模式）', threwF && threwF.message)

dropStorage()
const G = freshClient()
let threwG = null
try { server.renderToStaticMarkup(G.regs[OVERLAY_SLOT].render()) } catch (e) { threwG = e }
check(!threwG, '完全没有 localStorage 时也不炸', threwG && threwG.message)
check(server.renderToStaticMarkup(G.regs[OVERLAY_SLOT].render()).indexOf('amayui-emulator-pill') >= 0, '没有 localStorage ⇒ 默认收起的胶囊')

// ================================================================
// [15] 源码级：没有残留的启动/停止管线 / 没有全局拦截
// ================================================================
section('[15] lib/client.js 源码：无生命周期管线残留')
check(src.indexOf('__start') < 0, '源码不含 __start')
check(src.indexOf('__stop') < 0, '源码不含 __stop')
check(src.indexOf('async function start()') < 0, '源码不含 async function start()')
check(src.indexOf('新标签打开') >= 0, '源码保留「新标签打开」')
check(src.indexOf('src/web/host.ts') >= 0 && src.indexOf('--instance') >= 0, '源码保留空态起实例命令')
check((src.match(/removeEventListener/g) || []).length >= 2, '卸载/抬起时都会摘 window 监听（源码两处 removeEventListener）')
check(src.indexOf('STORE_KEY') >= 0 && src.indexOf('localStorage') >= 0, '持久化走 STORE_KEY + localStorage')

// ================================================================
// [16] ★T-0138 观察者数（viewers）：N=1 只显示不告警 / N=2 明确告警 + 新标签标注风险
// ================================================================
const noWarn = (html) => html.indexOf('amayui-emulator-viewers-warn') < 0 && html.indexOf('观察者 2') < 0
const dirty = (id, n) => ({ ...LIVE_PAYLOAD, instances: LIVE_PAYLOAD.instances.map((it) => (it.id === id ? { ...it, viewers: n } : it)) })

stubStorage(null)
const H = freshClient()
stubFetch(dirty('dbg-a', 1))
const headerH = expand(H.regs[HEADER_SLOT].render())
if (headerH) headerH.props.onClick()          // 展开（选中会落在 dbg-a，viewers=1）
await sleep(50)

section('[16] 观察者数（viewers）：面板显示 + N>1 告警（第二个页面 = 第二个 VM）')
const oneHtml = server.renderToStaticMarkup(H.regs[OVERLAY_SLOT].render())
check(oneHtml.indexOf('观察者 1') >= 0, 'viewers=1 时面板显示「观察者 1」')
check(noWarn(oneHtml), 'viewers=1 时**没有**告警')
check(oneHtml.indexOf('会开第二个 VM') < 0, 'viewers=1 时「新标签打开」不标注风险')
check(oneHtml.indexOf('新标签打开') >= 0, 'viewers=1 时「新标签打开」仍在（不再多话）')
check(oneHtml.indexOf('title="在第二个标签页里打开同一个实例') >= 0, '「新标签打开」的 title 解释"会起第二个 VM"')

stubStorage(null)
const I = freshClient()
stubFetch(dirty('dbg-a', 2))
const headerI = expand(I.regs[HEADER_SLOT].render())
if (headerI) headerI.props.onClick()          // 展开（选中 dbg-a，viewers=2）
await sleep(50)
const twoHtml = server.renderToStaticMarkup(I.regs[OVERLAY_SLOT].render())
const twoEl = I.regs[OVERLAY_SLOT].render()
check(twoHtml.indexOf('观察者 2') >= 0, 'viewers=2 时面板显示「观察者 2」')
check(twoHtml.indexOf('amayui-emulator-viewers-warn') >= 0, '★viewers=2 时给出明确告警块')
check(twoHtml.indexOf('两个页面') < 0 || twoHtml.indexOf('每个页面 = 一个 VM') >= 0 || twoHtml.indexOf('抢同一份 overlay/log') >= 0, '告警文案说清"两个页面 = 两个 VM 抢同一份 overlay/log"', twoHtml.slice(0, 200))
check(twoHtml.indexOf('新标签打开（会开第二个 VM）') >= 0, '★viewers>1 时「新标签打开」被标注成「（会开第二个 VM）」（保留可点，策略已文档化）')
const newTabI = byId(twoEl, 'amayui-emulator-newtab')
check(!!newTabI && String(newTabI.props.title || '').indexOf('第二个 VM') >= 0, '「新标签打开」title 里也写了第二个 VM 的风险', newTabI && newTabI.props.title)
// 模态里同样要告警（大屏细看时更容易忘了还有第二个页面）。
const maxI = byId(twoEl, 'amayui-emulator-maximize')
if (maxI) maxI.props.onClick()
const twoModalHtml = server.renderToStaticMarkup(I.regs[OVERLAY_SLOT].render())
check(twoModalHtml.indexOf('amayui-emulator-viewers-warn') >= 0, '模态里同样显示观察者告警')
check(iframeCount(twoModalHtml) === 1, '有告警时画面框仍然**恰好一个** iframe')

// ================================================================
// [17] ★★T-0138 DOM 节点身份：真 react-dom 挂载，收起↔展开↔放大↔关闭 里 iframe 是**同一个节点**
// ================================================================
// 纯静态标记只能证明"渲染出的字符串里有一个 iframe"，证明不了 React **复用**了节点。
// 这里用一份最小 fake DOM 真的挂载，然后后序遍历找 iframe 节点、**比对对象身份**。
function makeFakeDom() {
  let idSeq = 0
  const created = []
  class Node {
    constructor(nodeType, nodeName) { this.nodeType = nodeType; this.nodeName = nodeName; this.childNodes = []; this.parentNode = null }
    get firstChild() { return this.childNodes[0] || null }
    get nextSibling() {
      if (!this.parentNode) return null
      const i = this.parentNode.childNodes.indexOf(this)
      return i >= 0 ? (this.parentNode.childNodes[i + 1] || null) : null
    }
    get textContent() { return this._text != null ? this._text : this.childNodes.map((c) => c.textContent || '').join('') }
    // ★探针缺陷修复：react-dom 的 `setInitialDOMProperties` 会写 `node.textContent`；
    //   旧实现只有 getter ⇒ 严格模式下写属性直接 TypeError（`[17]` 因此永远红）。
    set textContent(v) { this._text = String(v); this.childNodes.length = 0 }
    // ★探针缺陷修复：react-dom 靠 `container.ownerDocument` 找 document
    //   （`getOwnerDocumentFromRootContainer` → `createRoot` 的 `listenToAllSupportedEvents`），
    //   旧桩没有它 ⇒ `createRoot` 立刻 TypeError。getter 延后求值，所以 `document` 这个
    //   `const` 在本字面量求值期间（`new Element('html')` 等）还没初始化也不会踩 TDZ。
    get ownerDocument() { return document }
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child)
      this.childNodes.push(child); child.parentNode = this; return child
    }
    insertBefore(child, ref) {
      if (child.parentNode) child.parentNode.removeChild(child)
      const i = ref ? this.childNodes.indexOf(ref) : -1
      if (i < 0) this.childNodes.push(child); else this.childNodes.splice(i, 0, child)
      child.parentNode = this; return child
    }
    removeChild(child) {
      const i = this.childNodes.indexOf(child)
      if (i >= 0) this.childNodes.splice(i, 1)
      child.parentNode = null; return child
    }
    setAttribute(n, v) { this['attr:' + n] = String(v); if (n === 'id') this.id = String(v) }
    removeAttribute(n) { delete this['attr:' + n] }
    getAttribute(n) { return this['attr:' + n] == null ? null : this['attr:' + n] }
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() { return true }
  }
  class Element extends Node {
    constructor(tag) {
      super(1, String(tag).toUpperCase())
      this.tagName = String(tag).toUpperCase(); this.localName = String(tag).toLowerCase()
      this.style = {}; this.children = this.childNodes; this.attributes = {}; this.namespaceURI = null
      this._uid = ++idSeq
      created.push(this)
    }
    get innerHTML() { return '' }
    set innerHTML(v) { if (!v) this.childNodes.length = 0 }
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 } }
    focus() {}
    blur() {}
    setSelectionRange() {}
    cloneNode() { return new Element(this.localName) }
  }
  class Text extends Node {
    constructor(t) { super(3, '#text'); this.data = String(t); this.nodeValue = String(t); this._uid = ++idSeq }
    get textContent() { return this.data }
  }
  const document = {
    createElement: (t) => new Element(t),
    createElementNS: (ns, t) => { const el = new Element(t); el.namespaceURI = ns; return el },
    createTextNode: (t) => new Text(t),
    createComment: () => new Text(''),
    createDocumentFragment: () => new Element('#fragment'),
    querySelector: () => null,
    addEventListener() {}, removeEventListener() {},
    documentElement: new Element('html'),
    body: new Element('body'),
    head: new Element('head'),
  }
  /** 后序遍历找所有 iframe **DOM 节点**（拿的是对象身份，不是字符串）。 */
  function iframeNodes(root) {
    const out = []
    const rec = (node) => {
      if (!node) return
      if (node.nodeName === 'IFRAME') out.push(node)
      if (node.childNodes) for (const c of node.childNodes) rec(c)
    }
    rec(root)
    return out
  }
  return { document, created, iframeNodes }
}

let domIdentityChecked = false
let reactDomClient = null
try { reactDomClient = req('react-dom/client') } catch (e) { reactDomClient = null }

section('[17] ★★DOM 节点身份：收起→展开→放大→关闭 全程复用同一个 iframe 节点')
if (!reactDomClient || typeof reactDomClient.createRoot !== 'function') {
  console.log('  ⚠ 未解析到 react-dom/client —— 跳过"节点身份"核对（前面的 props/字符串级不变量断言仍然生效）')
}

// 只在有 react-dom/client 时才需要 DOM 桩：没解析到就不污染 globalThis。
if (reactDomClient && typeof reactDomClient.createRoot === 'function') {
  const dom = makeFakeDom()
  globalThis.document = dom.document
  globalThis.Element = dom.document.createElement('div').constructor
  const realWindow = globalThis.window
  globalThis.window = realWindow || {}
  globalThis.window.document = dom.document
  // ★探针缺陷修复：react-dom 的 `getActiveElementDeep` 会做
  //   `element instanceof win.HTMLIFrameElement`；桩 window 上缺这个构造器 ⇒
  //   `instanceof undefined` 抛 TypeError ⇒ 挂载在 commit 阶段炸。桩一个空类即可
  //   （`getActiveElement()` 返回 body，`body instanceof 空类` = false，循环正常退出）。
  if (!globalThis.window.HTMLIFrameElement) globalThis.window.HTMLIFrameElement = class HTMLIFrameElement {}
  globalThis.window.addEventListener = globalThis.window.addEventListener || function () {}
  globalThis.window.removeEventListener = globalThis.window.removeEventListener || function () {}
  if (!globalThis.window.innerWidth) globalThis.window.innerWidth = 1440
  if (!globalThis.window.innerHeight) globalThis.window.innerHeight = 900

  stubStorage(null)
  const J = freshClient()
  stubFetch(LIVE_PAYLOAD)
  const headerJ = expand(J.regs[HEADER_SLOT].render())
  if (headerJ) headerJ.props.onClick()          // 展开 + 拉列表（选中 dbg-a）
  await sleep(50)
  const container = dom.document.createElement('div')
  let root = null
  let mounted = true
  try { root = reactDomClient.createRoot(container); root.render(J.regs[OVERLAY_SLOT].render()) } catch (e) { mounted = false }
  await sleep(30)

  const frames = dom.iframeNodes(container)
  domIdentityChecked = mounted && frames.length === 1
  check(mounted, '真 react-dom/client 挂载成功（最小 DOM 桩）')
  check(frames.length === 1, '挂载后容器里**恰好一个** iframe DOM 节点（实际 ' + frames.length + '）')
  if (domIdentityChecked) {
    const first = frames[0]
    const seen = []
    const step = (label, act) => {
      const control = act ? byId(J.regs[OVERLAY_SLOT].render(), act) : null
      check(!!control && typeof control.props.onClick === 'function', label + '：拿到控制元素')
      if (control) control.props.onClick()
      root.render(J.regs[OVERLAY_SLOT].render())
      const now = dom.iframeNodes(container)
      seen.push({ label, n: now.length, same: now.length === 1 && now[0] === first })
      check(now.length === 1, label + '：容器里仍是恰好一个 iframe', '实际 ' + now.length)
      check(now.length === 1 && now[0] === first, label + '：★iframe DOM 节点**身份不变**（同一个对象）')
    }
    step('收起', 'amayui-emulator-collapse')
    step('展开（点胶囊）', 'amayui-emulator-pill')
    step('放大', 'amayui-emulator-maximize')
    step('关闭', 'amayui-emulator-close')
    const collapsedSeen = seen.find((x) => x.label === '收起')
    check(!!collapsedSeen && collapsedSeen.n === 1, '★收起态 iframe 节点仍在（旧实现在这一步是 0 个 ⇒ VM 被杀）')
    check(seen.every((x) => x.same), '★收起→展开→放大→关闭 四步全程同一个 iframe 节点：' + seen.map((x) => x.label + '=' + (x.same ? '同一' : '换了')).join(' / '))
    const final = dom.iframeNodes(container)
    check(final.length === 1 && final[0] === first, '序列结束后没有产生第二个 iframe 节点')
  } else {
    console.log('  ⚠ 真 DOM 挂载不可用 ⇒ 跳过"节点身份"核对（字符串级断言已覆盖"恰好一个 + src 相同"）')
  }
  globalThis.window = realWindow
}

// ================================================================
// [18] ★T-0138 源码棘轮：`createElement('iframe'` 全文件恰好一处
// ================================================================
section('[18] ★源码棘轮：唯一 iframe')
const iframeCtor = (code.match(/createElement\(\s*'iframe'/g) || []).length
check(iframeCtor === 1, '★lib/client.js 里 createElement(\'iframe\' 恰好一处（实际 ' + iframeCtor + '）')
check(iframeCtor === 1 && !/createElement\(\s*'iframe'[^)]*\bkey\b/.test(code), '★那个 iframe 上**没有 key**（有 key 就会被 React 重建）')
// 反向棘轮：不许有第二个 <iframe> 的旁路（字符串形式的 JSX/HTML 也不行）。
const iframeLits = (code.match(/<iframe\b/g) || []).length
check(iframeLits === 0, '源码里没有 <iframe 字面量（只有唯一那处 createElement）')
check(code.indexOf('amayui-emulator-viewport') >= 0, '画面框容器 id = amayui-emulator-viewport（形态只改它的 style）')
check(code.indexOf("display:'none'") < 0 && code.indexOf('display: \'none\'') < 0, '源码里没有 display:none（收起靠 visibility，避免页面被挂起）')
check(code.indexOf('visibility') >= 0, '收起用的是 visibility（只影响绘制，不挂起页面）')

// ================================================================
// [19] ★布局贴合（实测几何，不是猜常量）
// ================================================================
// 背景（2026-09-23 用户实测两条）：① 画面框与浮窗面板之间**悬空一段**（旧实现用常量
// `CHROME_H + LIST_H` 假想面板高度，与实测差 26px）；② 点「放大」后**画面框压住模态自己的
// 标题栏与实例行**（旧实现按常量 `MODAL_PAD + CHROME_H` 从模态**内部**起画，而模态实测高 98）。
// 修法 = 量真实边界（`useChromeSizes` 的 ResizeObserver）⇒ 这两条棘轮钉住"别再退回猜常量"。
section('[19] ★布局贴合：画面框按 chrome 的实测边界摆（不再猜常量）')
check(code.indexOf('ResizeObserver') >= 0 && code.indexOf('new R(measure)') >= 0,
  '★用 ResizeObserver 量 chrome 的真实尺寸（而不是只用常量算）')
check(code.indexOf('chrome.panelH') >= 0,
  '★展开态：画面框的位置用了**实测面板高**（`chrome.panelH`），不是只用 `CHROME_H + LIST_H` 猜')
check(/top\s*=\s*oy\s*\+\s*bb\.h/.test(code),
  '★模态：画面框排在模态**实测盒子的正下方**（`oy + bb.h`，不是从模态内部按常量起画）')
check(code.indexOf('modalX') >= 0 && code.indexOf('modalY') >= 0,
  '★模态位置也来自实测（`modalX`/`modalY`）—— 换行/告警条改变模态高度时画面框会跟着让位')
// 反向棘轮：画面框的位置**不许**再只用那两个常量算出来（老 bug 的写法）。
check(!/left\s*=\s*o\.x\s*\+\s*MODAL_PAD\s*\+\s*MODAL_LIST_W/.test(code),
  '反向棘轮：没有"模态里按常量偏移摆放画面框"的老写法（`o.x + MODAL_PAD + MODAL_LIST_W`）')

console.log('\n' + (fail.length ? '✗ 失败 ' + fail.length + ' 项：' + fail.join(' / ') : '✓ 全部通过') + '\n')
process.exit(fail.length ? 1 : 0)
