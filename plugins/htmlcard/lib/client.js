// @amayui/html-preview-card — Client half (pre-bundled module-loader format).
// Registers the `preview_html` tool card (inline iframe preview + clickable
// header) and the full-screen `shell.overlay` modal. HTML is read from the
// tool-call args, so there is no host RPC and the card replays/reloads cleanly.
window.__ModuleLoader__.load({
  id: '@amayui/html-preview-card',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    let react = require('react')

    const shared = { open: false, current: null }
    const listeners = new Set()
    function bump() { for (const l of listeners) l() }
    function setShared(patch) { Object.assign(shared, patch); bump() }
    function useShared() {
      const [, force] = react.useState(0)
      react.useEffect(() => {
        const fn = () => force((n) => n + 1)
        listeners.add(fn)
        return () => listeners.delete(fn)
      }, [])
      return shared
    }

    function documentize(html) {
      const s = String(html || '')
      if (/^\s*<!doctype/i.test(s) || /^\s*<html/i.test(s)) return s
      return '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">' + s + '</body></html>'
    }

    function sandboxProp(allowScripts) {
      return { sandbox: allowScripts ? 'allow-scripts' : '' }
    }

    const btnStyle = {
      padding: '3px 10px', border: '1px solid #d8dce3', borderRadius: '4px', background: '#fff', cursor: 'pointer',
      font: '12px/1.4 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif',
    }

    function parseArgs(block) {
      const argsRaw = block && (block.kind === 'tool-result' ? (block.call && block.call.argsRaw) : block.argsRaw) || ''
      let html = '', title = '', height = 300, allowScripts = false
      try {
        const p = argsRaw ? JSON.parse(argsRaw) : null
        if (p) {
          html = String(p.html || '')
          title = String(p.title || '')
          height = (p.height | 0) > 0 ? (p.height | 0) : 300
          allowScripts = !!p.allowScripts
        }
      } catch (e) { /* ignore */ }
      return { html, title, height, allowScripts }
    }

    // ---- tool result card: inline preview + clickable header (opens modal) ----
    function HtmlPreviewToolView(props) {
      const shared = useShared()
      const block = props && props.block
      const { html, title, height, allowScripts } = parseArgs(block)
      const label = title || 'HTML 预览'

      function openModal(e) {
        if (e && e.stopPropagation) e.stopPropagation()
        setShared({ open: true, current: { html, title: label, allowScripts } })
      }

      return react.createElement('div', { style: {
        font: '12px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif',
        color: '#222', background: '#fff', border: '1px solid #d8dce3', borderRadius: '8px',
        padding: '8px', maxWidth: '100%', boxSizing: 'border-box',
      } },
        react.createElement('div', {
          onClick: openModal,
          style: {
            display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 8px', margin: '-8px -8px 8px',
            borderBottom: '1px solid #d8dce3', background: '#f5f7fa', borderRadius: '8px 8px 0 0', cursor: 'pointer',
          },
        },
          react.createElement('b', { style: { fontSize: '13px' } }, '🖥 ' + label),
          react.createElement('span', { style: { color: '#8a94a3', fontSize: '11px' } }, '点击标题行在模态中打开完整预览'),
          react.createElement('span', { style: { flex: '1' } }),
          react.createElement('button', {
            onClick: openModal,
            style: Object.assign({}, btnStyle, { background: '#1f7ad6', borderColor: '#1f7ad6', color: '#fff' }),
          }, '展开预览'),
        ),
        html
          ? react.createElement('iframe', Object.assign({
              srcDoc: documentize(html),
              title: label,
              style: { width: '100%', height: height + 'px', border: '1px solid #d8dce3', borderRadius: '6px', background: '#fff', display: 'block' },
            }, sandboxProp(allowScripts)))
          : react.createElement('div', { style: { color: '#98a1b0', padding: '8px' } }, '（未解析到 HTML）'),
      )
    }

    // ---- full-screen modal ----
    function HtmlPreviewOverlay() {
      const shared = useShared()
      if (!shared.open) return null
      const cur = shared.current || {}
      const label = cur.title || 'HTML 预览'
      function close() { setShared({ open: false }) }

      return react.createElement('div', { style: {
        position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(15,18,24,.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
        font: '12px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif',
        pointerEvents: 'auto', boxSizing: 'border-box',
      } },
        react.createElement('div', { style: {
          width: '94%', maxWidth: '1400px', height: '92%', display: 'flex', flexDirection: 'column',
          background: '#fff', borderRadius: '10px', border: '1px solid #d8dce3', overflow: 'hidden',
          boxShadow: '0 12px 40px rgba(0,0,0,.35)',
        } },
          react.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderBottom: '1px solid #d8dce3', background: '#fafbfc' } },
            react.createElement('b', { style: { fontSize: '13px' } }, '🖥 ' + label),
            react.createElement('span', { style: { flex: '1' } }),
            react.createElement('button', { onClick: close, style: Object.assign({}, btnStyle, { background: '#e5484d', borderColor: '#e5484d', color: '#fff' }) }, '✕ 关闭'),
          ),
          react.createElement('iframe', Object.assign({
            srcDoc: documentize(cur.html),
            title: label,
            style: { flex: 1, width: '100%', border: '0', background: '#fff' },
          }, sandboxProp(cur.allowScripts))),
        ),
      )
    }

    const name = 'html-preview-card'
    const inject = ['slots']
    function apply(ctx) {
      ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
        { name: 'tool.call.toolview', key: 'preview_html' },
        (props) => react.createElement(HtmlPreviewToolView, props),
      ))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'htmlcard-dialog', order: 200 },
        () => react.createElement(HtmlPreviewOverlay),
      ))
    }

    exports.name = name
    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
