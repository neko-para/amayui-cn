// @amayui/emulator-view — Client half, **pure observer panel** (`tickets/T-0136`),
// now a **resident floating PiP** by default (`tickets/T-0137`, supersedes the modal-only form).
// `tickets/T-0138`: **单一 iframe** —— 三种形态只改 style，切换形态绝不重建 iframe。
//
// Registers two slots, both over the host half's plain HTTP API (a static bundle has no
// `host.call` pairing — same approach as `plugins/uimap` and `plugins/ticket-board`):
//   * `conversation.session.header.actions` — 常驻「🖥 调试画面」按钮（带活实例数徽标）；
//   * `shell.overlay`                      — **常驻浮窗**：默认收成右下角一枚小胶囊
//                                            （「🖥」+ 活实例数徽标）；点开是可拖、两档缩放的
//                                            `position: fixed` 面板；「放大」再进全屏模态。
//                                            关掉模态**回到浮窗**（不是什么都不剩）。
//
// ★★**单一 iframe（`tickets/T-0138` 的核心不变量）**：整棵树里**只有一个**
//   `createElement('iframe')`，**没有 `key`**，只在**选中实例变化**时改 `src`；收起 / 展开 /
//   模态三种形态只在**同一个 DOM 节点**上换容器的 style（收起 = `visibility:hidden` +
//   `pointerEvents:'none'`，**绝不 unmount、也不用 `display:none`** —— 后者会挂起页面）。
//   ★为什么这条是硬约束：web 形态下 **VM 跑在页面里**（`tickets/T-0136` 钉住的架构事实）⇒
//   React 卸载 iframe = 该实例的 VM 直接死掉、重新挂载 = 从 `ALINIT` 重跑。旧的三个 JSX 分支
//   （胶囊 / 浮窗 / 模态各挂一个同 `src` 的 iframe）就是这样让用户点「放大」后**整实例重启**的
//   （实测取证见 `tickets/T-0138/evidence/iframe-reload-forensics.txt`：一条 status 流 + 一条完整
//   重引导链）。本文件里 `createElement('iframe'` **只允许出现一次**（`smoke-client.mjs` 有源码棘轮）。
//
// ★**面板不启动任何东西**：实例的生命周期只由 agent/CLI 持有（用户 2026-09-23 的四项选择）。
//   面板做三件事：轮询 `GET /dsh-emulator/api/__instances`、列出活实例、把选中的那个嵌进
//   `/dsh-emulator/<id>/` 的同源 iframe。列表为空时显示"怎么起一个实例"的命令。
//
// ★**观察者数（`viewers`）**：宿主半按实例统计活 SSE 代理连接数（每实例的 VM 只应该被**一个**
//   页面附着）。面板显示「观察者 N」；N>1 时明确告警「两个页面 = 两个 VM 抢同一个 overlay/log」，
//   并把「新标签打开」的文案改成「新标签打开（会开第二个 VM）」（**保留可点**，只标注风险）。
//
// ★**点击穿透**：DSH 的 `shell.overlay` 层本身是 **click-through** 的（框架原话：*The layer
//   itself is click-through — entries opt back into pointer events*）⇒ `pointerEvents:'auto'`
//   只加在本插件**自己的容器**（胶囊 / 面板 / 模态背板）上，绝不包裹页面、也不加全局拦截。
//
// ★**为什么 640×360 / 320×180 而不是把 iframe 设小**：模拟器内部视口是**写死**的 1280×720
//   （`src/renderer/viewport.ts` + `setupPixiStage` 的 canvas style）⇒ 要"小画面"只能对 iframe
//   **整体缩放**（外层 `transform: scale(0.5)` / `scale(0.25)` 两档）；`inputAttach` 的 `toVirtual`
//   走 `getBoundingClientRect()`，缩放后坐标映射仍然自洽。
window.__ModuleLoader__.load({
  id: '@amayui/emulator-view',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var react = require('react')

    var PREFIX = '/dsh-emulator'
    var VIEW_W = 1280
    var VIEW_H = 720
    var SCALES = [0.5, 0.25]          // 两档：640×360（默认）与 320×180
    var POLL_MS = 3000
    var STORE_KEY = '@amayui/emulator-view.panel.v1'
    var FLOAT_Z = 1200
    var MODAL_Z = 1300                // 模态背板；面板 / 画面框在 MODAL_Z + 10
    var MODAL_ABOVE = MODAL_Z + 10
    var START_CMD = 'cd app/amayui-emulator && node --import tsx src/web/host.ts --instance dbg-a'

    // 模态里那种"大屏细看"的几何：已知常量算出来（不测量 ⇒ SSR/离线冒烟也能核对）。
    var MODAL_PAD = 12
    var MODAL_BODY_GAP = 10
    var MODAL_LIST_W = 380
    var CHROME_H = 46                 // 展开态标题栏(+外边距)占的高度：画面框就排在这下面
    var LIST_H = 118                  // 展开态实例列表 maxHeight（`lib` 里的同一个数）

    var DEFAULTS = { collapsed: true, x: null, y: null, scale: SCALES[0], selectedId: null }

    var BTN = { background: '#333', color: '#eee', border: '1px solid #555', borderRadius: 4, padding: '4px 10px', cursor: 'pointer' }
    var WARN = { color: '#ffd479', background: '#3a2c10', border: '1px solid #7a5f22', borderRadius: 4, padding: '6px 8px', fontSize: 12, lineHeight: 1.7 }
    var NEWTAB = { color: '#7cb7ff', fontSize: 12 }
    var NEWTAB_WARN = { color: '#ffd479', fontSize: 12 }

    // ---- 浏览器能力探测（SSR / 无 window 时全部走默认，不炸）----
    function win() {
      try { return typeof window !== 'undefined' && window ? window : null } catch (e) { return null }
    }
    function storage() {
      try {
        var g = typeof globalThis !== 'undefined' ? globalThis : null
        var ls = g ? g.localStorage : null
        return ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function' ? ls : null
      } catch (e) { return null }
    }
    function viewport() {
      var w = win()
      return {
        w: w && w.innerWidth ? w.innerWidth : 1440,
        h: w && w.innerHeight ? w.innerHeight : 900,
      }
    }
    function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)) }
    function isNum(n) { return typeof n === 'number' && isFinite(n) }
    function px(n) { return Math.round(n) + 'px' }
    /** `viewers` 是宿主半（`lib/index.js`）新加的字段：老宿主没有时按 0 处理（渲染绝不炸）。 */
    function viewersOf(it) {
      var n = it && it.viewers
      return isNum(n) && n > 0 ? Math.round(n) : 0
    }

    // ---- 持久化：一个带插件前缀的 key，存 {collapsed,x,y,scale,selectedId} ----
    // 每一次 localStorage 访问都在 try/catch 里：隐私模式 / 配额满 / 坏 JSON / 形状不对
    // 一律退回默认值，绝不让面板炸掉。
    function readStore() {
      var out = { collapsed: DEFAULTS.collapsed, x: DEFAULTS.x, y: DEFAULTS.y, scale: DEFAULTS.scale, selectedId: DEFAULTS.selectedId }
      try {
        var ls = storage()
        if (!ls) return out
        var raw = ls.getItem(STORE_KEY)
        if (!raw || typeof raw !== 'string') return out
        var obj = JSON.parse(raw)
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out
        if (typeof obj.collapsed === 'boolean') out.collapsed = obj.collapsed
        if (isNum(obj.x)) out.x = obj.x
        if (isNum(obj.y)) out.y = obj.y
        if (SCALES.indexOf(obj.scale) >= 0) out.scale = obj.scale
        if (typeof obj.selectedId === 'string' && obj.selectedId) out.selectedId = obj.selectedId
        return out
      } catch (e) { return out }
    }

    function writeStore(state) {
      try {
        var ls = storage()
        if (!ls) return
        ls.setItem(STORE_KEY, JSON.stringify({
          collapsed: !!state.collapsed,
          x: isNum(state.x) ? state.x : null,
          y: isNum(state.y) ? state.y : null,
          scale: SCALES.indexOf(state.scale) >= 0 ? state.scale : DEFAULTS.scale,
          selectedId: typeof state.selected === 'string' && state.selected ? state.selected : null,
        }))
      } catch (e) { /* 隐私模式 / 配额满：忽略，面板照常工作 */ }
    }

    var restored = readStore()

    // ---- 共享态（头部按钮、胶囊、面板、模态共用一个订阅源）----
    var shared = {
      open: false,                        // 全屏模态（「放大」）
      collapsed: restored.collapsed,      // 默认 true = 收成小胶囊
      x: restored.x,
      y: restored.y,
      scale: restored.scale,
      instances: [], selected: restored.selectedId, fetchedAt: 0, error: '',
    }
    var listeners = new Set()
    function bump() { for (var l of listeners) l() }
    function setShared(patch) { Object.assign(shared, patch); bump() }
    function useShared() {
      var pair = react.useState(0)
      var force = pair[1]
      react.useEffect(function () {
        var fn = function () { force(function (n) { return n + 1 }) }
        listeners.add(fn)
        return function () { listeners.delete(fn) }
      }, [])
      return shared
    }

    function persistState() { writeStore(shared) }

    // 视口尺寸只在**尺寸变化**时进 state：位置要么是持久化值、要么由它算。
    function useViewportSize() {
      var pair = react.useState(function () { return viewport() })
      var set = pair[1]
      react.useEffect(function () {
        var w = win()
        if (!w || typeof w.addEventListener !== 'function') return
        var fn = function () { set(viewport()) }
        w.addEventListener('resize', fn)
        fn()
        return function () { if (typeof w.removeEventListener === 'function') w.removeEventListener('resize', fn) }
      }, [])
      return pair[0]
    }

    function fmtClock(ms) {
      if (!ms) return '—'
      try {
        var d = new Date(ms)
        var p = function (n) { return (n < 10 ? '0' : '') + n }
        return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
      } catch (e) { return '—' }
    }

    function fmtAge(ms) {
      if (!ms) return '—'
      var s = Math.max(0, Math.round((Date.now() - ms) / 1000))
      return s < 60 ? (s + 's 前') : (Math.round(s / 60) + 'min 前')
    }

    async function refresh() {
      try {
        var res = await fetch(PREFIX + '/api/__instances', { cache: 'no-store' })
        var json = null
        try { json = await res.json() } catch (e) { /* 空体 */ }
        if (!res.ok || !json) {
          // 单次轮询失败（插件还没重启加载新路由 / 网络抖动）别把已选实例抖没：只显示错误。
          setShared({ error: '读实例注册表失败：HTTP ' + res.status + '（插件可能需要重启 web profile）' })
          return
        }
        var list = Array.isArray(json.instances) ? json.instances : []
        var sel = shared.selected
        var stillThere = false
        for (var i = 0; i < list.length; i++) if (list[i].id === sel) stillThere = true
        if (!stillThere) sel = list.length ? list[0].id : null
        var changed = sel !== shared.selected
        setShared({ instances: list, selected: sel, fetchedAt: Date.now(), error: '' })
        if (changed) persistState()
      } catch (e) {
        setShared({ error: String(e && e.message ? e.message : e) })
      }
    }

    // ---- 三个状态之间的迁移（每一个都落 localStorage） ----
    // ★这些函数**只改 shared**：形态由 Overlay 的 style 计算体现 ⇒ iframe 节点不动。
    function expand() { setShared({ collapsed: false, open: false }); persistState(); void refresh() }
    function collapse() { setShared({ collapsed: true, open: false }); persistState() }
    function maximize() { setShared({ collapsed: false, open: true }); persistState(); void refresh() }
    function closeModal() { setShared({ open: false, collapsed: false }); persistState() }
    function cycleScale() {
      var i = SCALES.indexOf(shared.scale)
      var next = SCALES[(i + 1) % SCALES.length]
      if (i < 0) next = SCALES[0]
      setShared({ scale: next })
      persistState()
    }
    function selectInstance(id) { setShared({ selected: id }); persistState() }

    // ---- 拖动：标题栏 mousedown + window mousemove/mouseup，位置 clamp 在视口内 ----
    // 处理函数放模块作用域（身份稳定）：这样「注册」与「清理」拿到的是同一个函数。
    var drag = null
    var panelEl = null

    function onMove(ev) {
      if (!drag) return
      var vp = viewport()
      var x = clamp((ev && ev.clientX != null ? ev.clientX : 0) - drag.dx, 0, Math.max(0, vp.w - (drag.w || 0)))
      var y = clamp((ev && ev.clientY != null ? ev.clientY : 0) - drag.dy, 0, Math.max(0, vp.h - (drag.h || 0)))
      setShared({ x: Math.round(x), y: Math.round(y) })
    }

    function onUp() {
      drag = null
      var w = win()
      if (w && typeof w.removeEventListener === 'function') {
        w.removeEventListener('mousemove', onMove)
        w.removeEventListener('mouseup', onUp)
      }
      persistState()
    }

    function startDrag(e) {
      // 标题栏里的按钮 / 链接不触发拖动（否则点「收起」也会把面板挪几像素）。
      var tag = e && e.target && e.target.tagName ? String(e.target.tagName).toUpperCase() : ''
      if (tag === 'BUTTON' || tag === 'A') return
      if (e && typeof e.preventDefault === 'function') e.preventDefault()
      var rect = null
      try {
        if (panelEl && typeof panelEl.getBoundingClientRect === 'function') rect = panelEl.getBoundingClientRect()
      } catch (err) { rect = null }
      if (!rect) {
        var vp = viewport()
        var w0 = VIEW_W * shared.scale + 24
        rect = { left: Math.max(16, vp.w - w0 - 16), top: Math.max(16, vp.h - 440), width: w0, height: 440 }
      }
      var ex = e && e.clientX != null ? e.clientX : rect.left
      var ey = e && e.clientY != null ? e.clientY : rect.top
      drag = { dx: ex - rect.left, dy: ey - rect.top, w: rect.width, h: rect.height }
      setShared({ x: Math.round(rect.left), y: Math.round(rect.top) })
      var w = win()
      if (w && typeof w.addEventListener === 'function') {
        w.addEventListener('mousemove', onMove)
        w.addEventListener('mouseup', onUp)
      }
    }

    // ---- 头部按钮（徽标 = 活实例数）----
    function HeaderButton() {
      var s = useShared()
      var n = s.instances.length
      react.useEffect(function () {
        // 关闭时也低频刷新，好让徽标有意义（不打开面板也能看到有几个实例活着）。
        void refresh()
        var t = setInterval(function () { void refresh() }, 15000)
        return function () { clearInterval(t) }
      }, [])
      var badge = {
        display: 'inline-block', minWidth: 16, height: 16, lineHeight: '16px', textAlign: 'center',
        borderRadius: 8, marginLeft: 6, padding: '0 4px', fontSize: 11,
        background: n ? '#3ddc84' : '#555', color: n ? '#0b2a18' : '#ccc',
      }
      return react.createElement(
        'button',
        {
          id: 'amayui-emulator-open',
          title: n ? ('调试画面：当前有 ' + n + ' 个活实例（纯观察，不启动）') : '调试画面：当前没有活实例（面板只观察，不负责启动）',
          onClick: function () { expand() },
          style: { display: 'inline-flex', alignItems: 'center' },
        },
        '🖥 调试画面',
        react.createElement('span', { style: badge }, String(n)),
      )
    }

    // ---- 面板 / 模态共用的零件 ----
    function rowsFor(s) {
      var rows = []
      for (var j = 0; j < s.instances.length; j++) {
        ;(function (it) {
          var on = it.id === s.selected
          var nv = viewersOf(it)
          rows.push(react.createElement('div', {
            key: it.id,
            id: 'amayui-emulator-inst-' + it.id,
            onClick: function () { selectInstance(it.id) },
            style: {
              display: 'flex', alignItems: 'center', gap: 10, padding: '5px 8px', cursor: 'pointer',
              border: '1px solid ' + (on ? '#d8b24a' : '#333'), background: on ? 'rgba(216,178,74,.12)' : '#191919',
              borderRadius: 4, fontSize: 12, marginBottom: 4, minWidth: 340,
            },
          },
            react.createElement('code', { style: { color: on ? '#f0d68a' : '#ddd', minWidth: 90 } }, it.id),
            react.createElement('span', { style: { color: '#8ab4f8', minWidth: 66 } }, ':' + it.port),
            react.createElement('span', { style: { color: '#9fd6a0', minWidth: 120 } }, it.bin ? ('BIN ' + it.bin) : 'BIN —'),
            react.createElement('span', { style: { color: '#888', minWidth: 96 } }, 'f=' + (it.frames == null ? '—' : it.frames)),
            react.createElement('span', { style: { color: nv > 1 ? '#ffd479' : '#888', minWidth: 96 } }, '👁 观察者 ' + nv),
            react.createElement('span', { style: { color: '#888', minWidth: 110 } }, '起于 ' + fmtClock(it.startedAt)),
            react.createElement('span', { style: { color: '#777' } }, '♥ ' + fmtAge(it.heartbeatAt)),
          ))
        })(s.instances[j])
      }
      return rows
    }

    function selectedOf(s) {
      for (var i = 0; i < s.instances.length; i++) if (s.instances[i].id === s.selected) return s.instances[i]
      return null
    }

    /**
     * 观察者告警 / 「新标签打开」的文案。
     *
     * ★语义（README 同步写清）：`viewers` = 宿主侧代理到该实例 `/events` 的**活 SSE 连接数**，
     *   一个页面（含 iframe 里的那一份）算一个。web 形态下 **VM 跑在页面里** ⇒ 同一实例上
     *   **第二个页面 = 第二个 VM**，两个 VM 抢同一个 overlay/log，所以 N>1 必须明说。
     *   策略选择：**保留「新标签打开」但把它标注成「（会开第二个 VM）」**（不是隐藏），
     *   因为运维场景确实可能需要——只是不能悄悄发生。
     */
    function viewerWarnText(n) {
      return '⚠ 观察者 ' + n + '：同一个实例上有 ' + n + ' 个页面（每个页面 = 一个 VM，会抢同一份 overlay/log）——请只保留一个，关掉多余标签页。'
    }
    function viewerWarnEl(s) {
      var sel = selectedOf(s)
      if (!sel) return null
      var n = viewersOf(sel)
      if (n <= 1) return null
      return react.createElement('div', { key: 'vwarn', id: 'amayui-emulator-viewers-warn', style: WARN }, viewerWarnText(n))
    }
    function newTabEl(s) {
      var sel = selectedOf(s)
      if (!sel) return null
      var n = viewersOf(sel)
      var label = n > 1 ? '新标签打开（会开第二个 VM）' : '新标签打开'
      var title = n > 1
        ? ('同一个实例上已有 ' + n + ' 个观察者；再开一个标签页 = 第二个 VM（会抢同一份 overlay/log）——先关掉多余的标签页再点')
        : '在第二个标签页里打开同一个实例（会起第二个 VM，抢同一份 overlay/log）——确定要这样用再点'
      return react.createElement('a', {
        key: 'new', id: 'amayui-emulator-newtab', href: PREFIX + '/' + sel.id + '/', target: '_blank', rel: 'noreferrer',
        title: title, style: n > 1 ? NEWTAB_WARN : NEWTAB,
      }, label)
    }

    /**
     * ★**全树唯一的 `<iframe>`**（源码棘轮：本文件里 `createElement('iframe'` 恰好一处）。
     *
     * 无 `key`、`src` 只在 `selected.id` 变化时改变 ⇒ React 在形态切换时**复用同一个 DOM 节点**
     * （位置稳定 + 无 key ⇒ 同类型同位置在协调里就是同一个实例）。收起态它仍然在 DOM 里，
     * 只是外层容器 hidden —— 见 `viewportStyle`。
     */
    function viewEl(s, vp) {
      var selected = selectedOf(s)
      var scale = s.scale
      var frame = {
        width: VIEW_W, height: VIEW_H, border: '0', display: 'block',
        transform: 'scale(' + scale + ')', transformOrigin: 'top left',
      }
      // ★容器的定位/可见性**只能**来自 `viewportStyle`（它是三种形态的唯一几何真源）。
      //   漏掉这一步的后果（已实测）：容器退回静态位置 ⇒ 画面框被**无条件画在左上角**，
      //   而且收起时也不会隐藏（`visibility` 没人设）。
      var style = viewportStyle(s, vp)
      delete style.id
      if (!selected) {
        // 没有选中实例时画面框本就该是空的 ⇒ 连容器一起藏掉（只留 chrome 里的列表与提示）。
        style.visibility = 'hidden'
        style.pointerEvents = 'none'
      }
      return react.createElement('div', { id: 'amayui-emulator-viewport', style: style },
        selected
          ? react.createElement('iframe', { src: PREFIX + '/' + selected.id + '/', style: frame, title: 'amayui emulator ' + selected.id })
          : react.createElement('div', { style: { color: '#888', fontSize: 13, padding: 16 } }, '点左边一行选中实例'))
    }

    // ---- 形态几何：三种形态都只体现在这几个 style 上（iframe 节点不动）----

    /** 展开态外框（也是拖动要测的那个矩形）。 */
    function panelStyle(s, vp) {
      var w = VIEW_W * s.scale + 24
      var maxH = Math.max(240, vp.h - 32)
      return {
        position: 'fixed', zIndex: FLOAT_Z, pointerEvents: 'auto',
        width: w, maxHeight: maxH, overflow: 'auto',
        background: '#1e1e1e', color: '#ddd', border: '1px solid #444', borderRadius: 6,
        padding: 10, boxShadow: '0 8px 28px rgba(0,0,0,.45)',
        boxSizing: 'border-box',
        ...(isNum(s.x) && isNum(s.y)
          ? { left: px(s.x), top: px(s.y) }
          : { right: px(16), bottom: px(16) }),
      }
    }

    /** 模态「大屏细看」的盒子几何：由已知常量算出来（画面框的外框 + 内边距 + 列表 + 间距）。 */
    function modalBox(s) {
      var vw = VIEW_W * s.scale
      var vh = VIEW_H * s.scale
      return {
        w: vw + MODAL_PAD * 2 + MODAL_BODY_GAP + MODAL_LIST_W,
        h: vh + MODAL_PAD * 2 + CHROME_H + MODAL_BODY_GAP,
        viewW: vw, viewH: vh,
      }
    }
    function modalOrigin(s, vp) {
      var b = modalBox(s)
      return { x: Math.max(8, Math.round((vp.w - b.w) / 2)), y: Math.max(8, Math.round((vp.h - b.h) / 2)) }
    }

    /**
     * ★**承载唯一 iframe 的那个容器**的 style —— 收起 / 展开 / 模态的**唯一差异**就在这里。
     *
     * * 展开：`position:fixed` 落在持久化的 `{x,y}` 上、排在标题栏 + 列表之下（`CHROME_H + LIST_H`）；
     * * 模态：`position:fixed`、排在居中大盒子的标题栏 + 内边距之下，`zIndex = MODAL_Z + 10`；
     * * 收起：**同一个盒子**（同位置、同尺寸）但 `visibility:'hidden'` + `pointerEvents:'none'`
     *   —— 不 unmount（否则 VM 死）、也**不用 `display:'none'`**（那会让浏览器挂起页面、
     *   帧计数停住；`visibility` 只影响绘制）。展开回来必须是同一个会话。
     */
    function viewportStyle(s, vp) {
      var w = VIEW_W * s.scale
      var h = VIEW_H * s.scale
      var top
      var left
      if (s.open) {
        var o = modalOrigin(s, vp)
        left = o.x + MODAL_PAD + MODAL_LIST_W + MODAL_BODY_GAP
        top = o.y + MODAL_PAD + CHROME_H
      } else {
        var panelW = VIEW_W * s.scale + 24
        var listH = s.instances.length ? LIST_H : 74
        var vh = VIEW_H * s.scale
        if (isNum(s.x) && isNum(s.y)) {
          // 拖过的位置：画面框排在面板**下方**（面板顶 + 标题栏 + 列表）。
          left = s.x + 10
          top = s.y + 10 + CHROME_H + listH
        } else {
          // ★没拖过：面板按 `panelStyle` 锚在**右下角**（`right:16; bottom:16`，冒烟钉住了这条），
          //   所以画面框只能排在面板**上方** —— 否则会垂出屏幕底。
          //   实测教训（2026-09-23）：旧实现在这个分支里用常量假想「面板高 440」并往下叠，
          //   1440×900 下算出 top=634、底边 994 > 900 ⇒ 画面框有一半在屏幕外。
          left = Math.max(8, vp.w - 16 - panelW + 10)
          top = Math.max(8, vp.h - 16 - (CHROME_H + listH) - 10 - vh)
        }
      }
      var hidden = !!s.collapsed && !s.open
      return {
        id: 'amayui-emulator-viewport',
        position: 'fixed', left: px(left), top: px(top), zIndex: s.open ? MODAL_ABOVE : FLOAT_Z,
        width: w, height: h, overflow: 'hidden',
        visibility: hidden ? 'hidden' : 'visible',
        pointerEvents: hidden ? 'none' : 'auto',
      }
    }

    function emptyEl() {
      return react.createElement('div', { key: 'empty', style: { color: '#999', fontSize: 13, lineHeight: 1.7, maxWidth: 620 } },
        '当前没有活实例。实例由 agent / CLI 持有，面板只观察、不启动：',
        react.createElement('pre', { style: { background: '#161616', border: '1px solid #333', borderRadius: 4, padding: 8, fontSize: 12, color: '#cfe8cf', overflowX: 'auto' } }, START_CMD),
        '（另：加 --port 0 让 OS 分配端口；实例闲置 10 分钟没人看也没命令会自己退出，用 --idle-sec 改，0 = 关；',
        '实例退出后磁盘状态仍留在 .tmp/instances/<id>/。）')
    }

    function errorEl(s) {
      if (!s.error) return null
      return react.createElement('div', { key: 'err', style: { color: '#ff8a8a', background: '#3a1414', border: '1px solid #7a2e2e', borderRadius: 4, padding: '6px 8px', fontSize: 12, wordBreak: 'break-all' } }, s.error)
    }

    function statusEl(s) {
      return react.createElement('span', { key: 'st', style: { color: '#8a8a8a', fontSize: 12 } },
        '活实例 ' + s.instances.length + ' · 每 ' + (POLL_MS / 1000) + 's 刷新' + (s.fetchedAt ? '（' + fmtClock(s.fetchedAt) + '）' : ''))
    }

    // ---- 收起态：右下角一枚小胶囊（自己的容器才 pointerEvents:'auto'）----
    // ★它只是**另一个兄弟节点**：画面框（唯一 iframe）仍然挂在 DOM 里，收起的隐藏由
    //   `viewportStyle` 负责 —— 胶囊与 iframe 之间没有父子/替换关系。
    function Pill() {
      var s = useShared()
      var n = s.instances.length
      var badge = {
        display: 'inline-block', minWidth: 16, height: 16, lineHeight: '16px', textAlign: 'center',
        borderRadius: 8, marginLeft: 2, padding: '0 4px', fontSize: 11,
        background: n ? '#3ddc84' : '#555', color: n ? '#0b2a18' : '#ccc',
      }
      return react.createElement('button', {
        id: 'amayui-emulator-pill',
        title: n ? ('调试画面浮窗已收起：' + n + ' 个活实例 —— 点一下展开（收起**不会**停掉实例的 VM）') : '调试画面浮窗已收起：当前没有活实例 —— 点一下展开',
        onClick: function () { expand() },
        style: {
          position: 'fixed', right: 16, bottom: 16, zIndex: FLOAT_Z,
          pointerEvents: 'auto',
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', borderRadius: 16, cursor: 'pointer',
          background: '#1e1e1e', color: '#ddd', border: '1px solid #555',
          boxShadow: '0 6px 20px rgba(0,0,0,.45)', fontSize: 13,
        },
      },
        '🖥',
        react.createElement('span', { style: badge }, String(n)),
      )
    }

    // ---- 展开态：position:fixed 的常驻浮窗（可拖 / 两档尺寸）----
    // 只渲染**面板本体**（标题栏 + 列表）；画面框是**兄弟节点**（Overlay 里唯一那一份）。
    // 收起时它 `visibility:hidden`（保留在 DOM 里，几何锚点稳定）但不拦截点击；
    // 模态时整个不渲染（模态自己那套 chrome 顶上）—— 两处都碰不到 iframe。
    function PanelChrome(props) {
      var s = props.s
      // ★模态里**不渲染**面板本体：否则浮窗会跟模态同时可见（两个 chrome 叠在一起），
      //   模态的按钮集合也会混进浮窗的「收起 / 尺寸档 / 放大」。这里卸载是安全的 ——
      //   面板里**没有 iframe**（唯一的 iframe 挂在 Overlay 的那个常驻兄弟容器里）。
      //   ★收起时相反：面板必须**留在 DOM**（`visibility:hidden`，几何锚点稳定）。
      if (s.open) return null
      var selected = selectedOf(s)
      var scale = s.scale
      // 收起态：保留盒子（画面框的位置锚点就是它），但不画、不挡。
      var hidden = !!s.collapsed && !s.open
      var list = s.instances.length
        ? react.createElement('div', { key: 'list', style: { maxHeight: LIST_H, overflow: 'auto' } }, rowsFor(s))
        : emptyEl()

      return react.createElement('div', {
        id: 'amayui-emulator-panel',
        ref: function (node) { panelEl = node },
        style: Object.assign({}, panelStyle(s, props.vp), hidden ? { visibility: 'hidden', pointerEvents: 'none' } : null),
      },
        react.createElement('div', {
          key: 'bar',
          onMouseDown: startDrag,
          style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap', cursor: 'move', userSelect: 'none' },
        },
          react.createElement('strong', { key: 't' }, '🖥 调试画面'),
          statusEl(s),
          react.createElement('span', { key: 'sp', style: { flex: 1 } }),
          react.createElement('button', { key: 'collapse', id: 'amayui-emulator-collapse', style: BTN, onClick: collapse }, '收起'),
          react.createElement('button', { key: 'scale', id: 'amayui-emulator-scale', style: BTN, onClick: cycleScale }, '尺寸档 ' + scale + '×'),
          react.createElement('button', { key: 'max', id: 'amayui-emulator-maximize', style: BTN, onClick: maximize }, '放大'),
          newTabEl(s),
          react.createElement('button', { key: 'refresh', id: 'amayui-emulator-refresh', style: BTN, onClick: function () { void refresh() } }, '↻ 刷新'),
        ),
        react.createElement('div', { key: 'errwrap' }, errorEl(s)),
        react.createElement('div', { key: 'warnwrap' }, viewerWarnEl(s)),
        react.createElement('div', { key: 'body', style: { display: 'flex', flexDirection: 'column', gap: 8 } }, list),
      )
    }

    // ---- 模态：「放大」时的大屏细看（背板是**另一个兄弟节点**，不包裹画面框）----
    function ModalBackdrop(props) {
      var s = props.s
      if (!s.open) return null
      return react.createElement('div', {
        id: 'amayui-emulator-backdrop',
        onClick: function (e) { if (e.target === e.currentTarget) closeModal() },
        style: {
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)',
          // ★背板 z-index **低于**画面框与模态面板：它是"另一个兄弟"，不包裹 iframe。
          zIndex: MODAL_Z, pointerEvents: 'auto',
        },
      })
    }

    function ModalChrome(props) {
      var s = props.s
      var scale = s.scale
      var o = modalOrigin(s, props.vp)
      var b = modalBox(s)
      var chromeStyle = {
        position: 'fixed', left: px(o.x), top: px(o.y), zIndex: MODAL_ABOVE, pointerEvents: 'auto',
        width: b.w, maxHeight: '92vh', overflow: 'auto', boxSizing: 'border-box',
        background: '#1e1e1e', color: '#ddd', border: '1px solid #444', borderRadius: 6, padding: MODAL_PAD,
      }
      if (!s.open) return null
      return react.createElement('div', { id: 'amayui-emulator-modal', style: chromeStyle },
        react.createElement('div', { key: 'bar', style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' } },
          react.createElement('strong', { key: 't' }, '🖥 天結いキャッスルマイスター · 调试画面'),
          statusEl(s),
          react.createElement('span', { key: 'sp', style: { flex: 1 } }),
          react.createElement('button', { key: 'refresh', id: 'amayui-emulator-refresh', style: BTN, onClick: function () { void refresh() } }, '↻ 刷新'),
          newTabEl(s),
          react.createElement('button', { key: 'close', id: 'amayui-emulator-close', style: { background: '#5a2020', color: '#fff', border: '1px solid #a34545', borderRadius: 4, padding: '4px 10px', cursor: 'pointer' }, onClick: closeModal }, '关闭'),
        ),
        react.createElement('div', { key: 'errwrap' }, errorEl(s)),
        react.createElement('div', { key: 'warnwrap' }, viewerWarnEl(s)),
        // ★这里**没有** iframe：画面框是 Overlay 里那个常驻兄弟节点，位置由 viewportStyle 给。
        react.createElement('div', { key: 'body', style: { display: 'flex', gap: MODAL_BODY_GAP, alignItems: 'flex-start', flexWrap: 'wrap' } },
          s.instances.length
            ? react.createElement('div', { key: 'list', style: { minWidth: MODAL_LIST_W, maxHeight: b.viewH, overflowY: 'auto' } }, rowsFor(s))
            : emptyEl()),
      )
    }

    /**
     * `shell.overlay` 的常驻组件。**树里有且只有一个 iframe**：
     *
     *   Overlay
     *     ├─ ModalBackdrop   （仅模态；兄弟节点，z 最低）
     *     ├─ PanelChrome     （展开态的面板本体；收起 / 模态时 visibility:hidden 仍挂 DOM）
     *     ├─ ModalChrome     （仅模态；兄弟节点）
     *     ├─ <div id="amayui-emulator-viewport"> ← ★唯一的 iframe 挂在这里，永远排第三
     *     └─ Pill            （仅收起）
     *
     * 兄弟的**顺序与类型在三种形态间完全一致**（条件渲染只产出 `null`，元素位置不挪）⇒ React
     * 复用同一个 iframe DOM 节点；形态差异全部落在 `viewportStyle` / 两个 chrome 的 style 上。
     */
    function Overlay() {
      var s = useShared()
      var vp = useViewportSize()
      var selected = selectedOf(s)

      react.useEffect(function () {
        // 常驻轮询：胶囊上的徽标即使不开面板也要是活的。
        void refresh()
        var t = setInterval(function () { void refresh() }, POLL_MS)
        return function () { clearInterval(t) }
      }, [])

      react.useEffect(function () {
        // 卸载时清掉可能还挂着的拖动监听（拖动中途组件被卸载的情形）。
        return function () {
          drag = null
          panelEl = null
          var w = win()
          if (w && typeof w.removeEventListener === 'function') {
            w.removeEventListener('mousemove', onMove)
            w.removeEventListener('mouseup', onUp)
          }
        }
      }, [])

      return react.createElement('div', { id: 'amayui-emulator-overlay' },
        react.createElement(ModalBackdrop, { key: 'backdrop', s: s }),
        react.createElement(PanelChrome, { key: 'panel', s: s, vp: vp }),
        react.createElement(ModalChrome, { key: 'modal', s: s, vp: vp }),
        viewEl(s, vp),
        (!s.open && s.collapsed) ? react.createElement(Pill, { key: 'pill' }) : null,
      )
    }

    var name = 'amayui-emulator-view'
    var inject = ['slots']
    function apply(ctx) {
      ctx.slots.inject('conversation.session.header.actions', function () {
        return ctx.slots.register(
          { name: 'conversation.session.header.actions', id: 'amayui-emulator-open', order: 36 },
          function () { return react.createElement(HeaderButton) },
        )
      })
      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register(
          { name: 'shell.overlay', id: 'amayui-emulator-dialog', order: 160 },
          function () { return react.createElement(Overlay) },
        )
      })
    }

    exports.name = name
    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
