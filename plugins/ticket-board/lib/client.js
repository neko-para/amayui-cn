// @amayui/ticket-board — Client half (pre-bundled module-loader format).
//
// Registers two things:
//   · `conversation.session.header.actions` — the常驻 「📋 需求单」 button at the
//     top of the session (with a pending-count badge);
//   · `shell.overlay` — the full-screen modal that lists every ticket the
//     ledger still owes work on (doing / pending, optionally blocked),
//     grouped by priority P0→P3.
//
// Client→Host is plain HTTP (`/dsh-tickets/api/list`): a static bundle has no
// `harness.handle`/`host.call` pairing. The payload is read-only leaf data, so
// the modal needs no host memory and re-fetches on demand.
window.__ModuleLoader__.load({
  id: '@amayui/ticket-board',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const react = require('react')

    const API = '/dsh-tickets/api/list'
    // 缓存新鲜度：模态内每次打开若超过该时长就静默重取（点「刷新」可强制）。
    const STALE_MS = 30000

    const PRIORITY_ORDER = ['P0', 'P1', 'P2', 'P3']
    const PRIORITY_META = {
      P0: { label: 'P0 · 最高', color: '#b3261e', bg: '#fdeceb' },
      P1: { label: 'P1 · 高', color: '#b45309', bg: '#fdf3e3' },
      P2: { label: 'P2 · 中', color: '#1f6feb', bg: '#eaf2fe' },
      P3: { label: 'P3 · 低', color: '#57606a', bg: '#f0f2f5' },
    }
    // 「还要做什么」的三种状态；done / dropped 不在看板里（它们不再欠工作）。
    const STATUS_ORDER = ['doing', 'open', 'blocked']
    const STATUS_META = {
      doing: { mark: '🔜', label: '正在处理', color: '#1f6feb', bg: '#e8f1fd' },
      open: { mark: '⬜', label: '待处理', color: '#57606a', bg: '#f0f2f5' },
      blocked: { mark: '⛔', label: '被阻塞', color: '#9a6700', bg: '#fdf5e2' },
    }
    const TYPE_LABEL = {
      bug: '缺陷', req: '需求', refactor: '重构', analysis: '分析',
      docs: '文档', tooling: '工具', translation: '翻译',
    }
    const FONT = '12px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif'
    const MONO = '11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'

    const btnStyle = {
      padding: '3px 10px', border: '1px solid #d8dce3', borderRadius: '4px', background: '#fff',
      cursor: 'pointer', font: '12px/1.4 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif', color: '#24292f',
    }

    // ---- module-local store (the two slot occupants share one modal) ----
    const shared = {
      open: false,
      data: null,
      loading: false,
      error: '',
      fetchedAt: 0,
      expanded: {},
      // 默认只展示「还要做」的两类；被阻塞的票单独一个开关（它们确实还欠工作，但插不上手）。
      filter: { doing: true, open: true, blocked: false },
      area: 'all',
      q: '',
    }
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

    async function load(force) {
      if (shared.loading) return
      if (!force && shared.data && Date.now() - shared.fetchedAt < STALE_MS) return
      setShared({ loading: true, error: '' })
      try {
        const res = await fetch(API + '?t=' + Date.now(), { headers: { accept: 'application/json' } })
        const text = await res.text()
        let out = null
        try { out = JSON.parse(text) } catch (e) {
          setShared({ loading: false, error: 'API 返回非 JSON（HTTP ' + res.status + '）：' + String(text).slice(0, 160) })
          return
        }
        if (out && out.ok) setShared({ data: out, fetchedAt: Date.now(), loading: false, error: '' })
        else setShared({ loading: false, error: (out && out.error) || ('HTTP ' + res.status) })
      } catch (e) {
        setShared({ loading: false, error: 'API 请求失败：' + String((e && e.message) || e) })
      }
    }

    function statusRank(s) {
      const i = STATUS_ORDER.indexOf(s)
      return i < 0 ? 9 : i
    }
    function cmpTicket(a, b) {
      return statusRank(a.status) - statusRank(b.status) || String(a.id).localeCompare(String(b.id))
    }
    function pendingCount(data) {
      if (!data || !data.tickets) return 0
      return data.tickets.filter((t) => t.status === 'doing' || t.status === 'open').length
    }
    function areasOf(data) {
      const set = {}
      for (const t of (data && data.tickets) || []) {
        if (STATUS_ORDER.indexOf(t.status) >= 0 && t.area) set[t.area] = 1
      }
      return Object.keys(set).sort()
    }
    function matches(t) {
      const f = shared.filter
      if (!f[t.status]) return false
      if (shared.area !== 'all' && t.area !== shared.area) return false
      const q = String(shared.q || '').trim().toLowerCase()
      if (!q) return true
      const hay = [t.id, t.title, t.area, t.type, TYPE_LABEL[t.type], t.why].join(' ').toLowerCase()
      return hay.indexOf(q) >= 0
    }
    function toggleExpand(id) {
      const next = Object.assign({}, shared.expanded)
      if (next[id]) delete next[id]
      else next[id] = true
      setShared({ expanded: next })
    }

    // ---- shared bits ----
    function pill(text, color, bg, extra) {
      return react.createElement('span', {
        key: 'p' + text,
        style: Object.assign({
          display: 'inline-block', padding: '1px 6px', borderRadius: '3px', background: bg, color: color,
          font: '11px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif', whiteSpace: 'nowrap',
        }, extra || {}),
      }, text)
    }

    function section(title, children, key) {
      return react.createElement('div', { key: key || title, style: { marginTop: '8px' } },
        react.createElement('div', { style: { color: '#8a94a3', fontSize: '11px', marginBottom: '3px' } }, title),
        children,
      )
    }

    function ticketDetails(t) {
      const rows = []

      if (t.why) {
        rows.push(section('为什么 / 现象与影响',
          react.createElement('div', { style: { whiteSpace: 'pre-wrap', color: '#24292f' } }, t.why)))
      }
      if (t.acceptance && t.acceptance.length) {
        rows.push(section('判据（怎么算做完）· ' + t.acceptance.length + ' 条',
          react.createElement('ol', { style: { margin: '0', paddingLeft: '20px', color: '#24292f' } },
            t.acceptance.map((a, i) => react.createElement('li', { key: i, style: { marginBottom: '2px' } }, a)))))
      }
      if (t.evidence && t.evidence.length) {
        rows.push(section('证据锚点 · ' + t.evidence.length + ' 条',
          react.createElement('ul', { style: { margin: '0', paddingLeft: '18px', listStyle: 'none' } },
            t.evidence.map((e, i) => react.createElement('li', { key: i, style: { marginBottom: '3px' } },
              react.createElement('code', { style: { font: MONO, color: '#0a3069', background: '#f2f5f8', padding: '0 4px', borderRadius: '3px' } }, e.file || '(未给文件)'),
              e.anchor ? react.createElement('span', null,
                react.createElement('span', { style: { color: '#98a1b0' } }, ' : '),
                react.createElement('code', { style: { font: MONO, color: '#8250df', background: '#f6f2fd', padding: '0 4px', borderRadius: '3px' } }, e.anchor),
              ) : null,
              typeof e.line === 'number' ? react.createElement('span', { style: { color: '#98a1b0' } }, ' (L' + e.line + ')') : null,
              e.note ? react.createElement('div', { style: { color: '#5b6572', fontSize: '11px', paddingLeft: '2px' } }, '· ' + e.note) : null,
            )))))
      }

      const meta = []
      if (t.blockedBy && t.blockedBy.length) {
        meta.push(react.createElement('div', { key: 'b', style: { marginTop: '8px' } },
          react.createElement('span', { style: { color: '#8a94a3', fontSize: '11px' } }, '前置票：'),
          react.createElement('code', { style: { font: MONO, color: '#9a6700' } }, t.blockedBy.join(', '))))
      }
      if (t.tests && t.tests.length) {
        meta.push(section('守卫（测试）', react.createElement('ul', { key: 't', style: { margin: '0', paddingLeft: '18px', color: '#24292f' } },
          t.tests.map((x, i) => react.createElement('li', { key: i },
            react.createElement('code', { style: { font: MONO } }, x))))))
      }
      const linkLists = []
      if (t.links && t.links.docs && t.links.docs.length) linkLists.push('docs: ' + t.links.docs.join(', '))
      if (t.links && t.links.analysis && t.links.analysis.length) linkLists.push('analysis: ' + t.links.analysis.join(', '))
      if (t.links && t.links.tickets && t.links.tickets.length) linkLists.push('tickets: ' + t.links.tickets.join(', '))
      if (linkLists.length) {
        meta.push(section('回链', react.createElement('div', { key: 'l', style: { color: '#5b6572', font: MONO } },
          linkLists.map((x, i) => react.createElement('div', { key: i }, x)))))
      }
      if (t.docs && t.docs.length) {
        meta.push(react.createElement('div', { key: 'd', style: { marginTop: '8px', color: '#8a94a3', fontSize: '11px' } },
          '过程文档（tickets/' + t.dir + '/）：' + t.docs.join('、')))
      }
      if (t.evidenceFiles > 0) {
        meta.push(react.createElement('div', { key: 'e', style: { marginTop: '4px', color: '#8a94a3', fontSize: '11px' } },
          'evidence/ 附件：' + t.evidenceFiles + ' 个文件'))
      }
      if (t.droppedWhy) {
        meta.push(section('关单理由', react.createElement('div', { key: 'w', color: '#b3261e' }, t.droppedWhy)))
      }

      return react.createElement('div', {
        style: {
          marginTop: '6px', paddingTop: '6px', borderTop: '1px dashed #e3e6ea',
          font: '12px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif',
        },
      }, rows, meta)
    }

    function ticketCard(t) {
      const sm = STATUS_META[t.status] || STATUS_META.open
      const open = !!shared.expanded[t.id]
      const badges = []
      badges.push(react.createElement('code', {
        key: 'id', style: { font: MONO, fontWeight: '700', color: '#24292f', background: '#f2f5f8', padding: '1px 5px', borderRadius: '3px' },
      }, t.id))
      badges.push(pill(sm.mark + ' ' + sm.label, sm.color, sm.bg, { key: 'st' }))
      badges.push(pill(TYPE_LABEL[t.type] || t.type, '#57606a', '#f6f8fa', { key: 'ty' }))
      if (t.area) badges.push(pill(t.area, '#0a3069', '#eef4fb', { key: 'ar', font: MONO }))

      const notes = []
      if (t.docs && t.docs.length) notes.push('+' + t.docs.length + 'doc')
      if (t.evidence && t.evidence.length) notes.push('证据 ' + t.evidence.length)
      if (t.acceptance && t.acceptance.length) notes.push('判据 ' + t.acceptance.length)
      if (t.blockedBy && t.blockedBy.length) notes.push('阻塞 ' + t.blockedBy.join('/'))

      return react.createElement('article', {
        key: t.id,
        style: {
          border: '1px solid #e3e6ea', borderLeft: '3px solid ' + sm.color, borderRadius: '6px',
          padding: '7px 9px', marginBottom: '7px', background: '#fff',
        },
      },
        react.createElement('div', {
          onClick: () => toggleExpand(t.id),
          style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', cursor: 'pointer' },
        },
          badges,
          notes.length ? react.createElement('span', { style: { color: '#98a1b0', fontSize: '11px' } }, notes.join(' · ')) : null,
          react.createElement('span', { style: { flex: '1' } }),
          t.updatedAt ? react.createElement('span', { style: { color: '#98a1b0', fontSize: '11px' } }, t.updatedAt) : null,
          react.createElement('span', { style: { color: '#8a94a3', fontSize: '11px' } }, open ? '▾ 收起' : '▸ 详情'),
        ),
        react.createElement('div', {
          onClick: () => toggleExpand(t.id),
          style: { marginTop: '4px', fontWeight: '600', color: '#111418', cursor: 'pointer' },
        }, t.title || '(无标题)'),
        open ? ticketDetails(t) : null,
      )
    }

    function groupBlock(p, list) {
      const meta = PRIORITY_META[p]
      return react.createElement('section', { key: p, style: { marginBottom: '14px' } },
        react.createElement('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px', borderRadius: '5px',
            background: meta.bg, color: meta.color, fontWeight: '700', fontSize: '12px', marginBottom: '7px',
          },
        },
          react.createElement('span', null, meta.label),
          react.createElement('span', { style: { fontWeight: '400', opacity: .8 } }, list.length + ' 张'),
          react.createElement('span', { style: { flex: '1' } }),
          react.createElement('span', { style: { fontWeight: '400', opacity: .75, fontSize: '11px' } },
            list.filter((t) => t.status === 'doing').length + ' 处理中'),
        ),
        list.map(ticketCard),
      )
    }

    function toggleChip(status) {
      const on = !!shared.filter[status]
      const next = Object.assign({}, shared.filter)
      next[status] = !on
      setShared({ filter: next })
    }

    function chip(status) {
      const m = STATUS_META[status]
      const on = !!shared.filter[status]
      return react.createElement('button', {
        key: status,
        onClick: () => toggleChip(status),
        style: {
          padding: '2px 9px', borderRadius: '11px', cursor: 'pointer', fontSize: '11px',
          border: '1px solid ' + (on ? m.color : '#d8dce3'),
          background: on ? m.bg : '#fff',
          color: on ? m.color : '#98a1b0',
          fontFamily: 'inherit',
        },
        title: on ? '点击隐藏这一类' : '点击显示这一类',
      }, m.mark + ' ' + m.label + '（' + (shared.data && shared.data.counts ? (shared.data.counts[status] || 0) : 0) + '）')
    }

    // ---- session-header button ----
    function HeaderTicketButton() {
      useShared()
      react.useEffect(() => { load(false) }, [])
      const n = pendingCount(shared.data)
      return react.createElement('button', {
        onClick: () => { setShared({ open: true }); load(false) },
        style: Object.assign({}, btnStyle, {
          background: '#0f766e', borderColor: '#0f766e', color: '#fff', padding: '2px 10px', fontSize: '12px',
        }),
        title: '查看当前需求单（tickets/ 台账：正在处理 / 待处理）',
      }, '📋 需求单' + (shared.data ? ' ' + n : ''))
    }

    // ---- full-screen modal ----
    function TicketBoardOverlay() {
      const s = useShared()
      react.useEffect(() => { if (s.open) load(false) }, [s.open])
      if (!s.open) return null

      const data = s.data
      const all = (data && data.tickets) || []
      const visible = all.filter(matches)
      const groups = PRIORITY_ORDER
        .map((p) => ({ p: p, list: visible.filter((t) => (t.priority || 'P3') === p).sort(cmpTicket) }))
        .filter((g) => g.list.length > 0)
      const areas = areasOf(data)
      const counts = (data && data.counts) || {}

      function close() { setShared({ open: false }) }

      const body = []
      if (s.error) {
        body.push(react.createElement('div', {
          key: 'err', style: { padding: '10px 12px', borderRadius: '6px', background: '#fdeceb', color: '#b3261e' },
        }, '读取票据台账失败：' + s.error,
          react.createElement('div', { style: { color: '#8a94a3', fontSize: '11px', marginTop: '4px' } },
            '端点 ' + API + '（Host 半个插件把 tickets/<ID>/ticket.json 汇总成 JSON；未加载该 bundle 时请重启 web profile）')))
      }
      if (groups.length === 0) {
        body.push(react.createElement('div', {
          key: 'empty', style: { padding: '24px', textAlign: 'center', color: '#98a1b0' },
        }, s.loading ? '正在读取 tickets/ …' : '没有符合当前筛选的票据（正在处理 / 待处理）。'))
      }
      for (const g of groups) body.push(groupBlock(g.p, g.list))

      return react.createElement('div', {
        style: {
          position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(15,18,24,.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
          font: FONT, pointerEvents: 'auto', boxSizing: 'border-box',
        },
      },
        react.createElement('div', {
          style: {
            width: '94%', maxWidth: '1100px', height: '92%', display: 'flex', flexDirection: 'column',
            background: '#fff', borderRadius: '10px', border: '1px solid #d8dce3', overflow: 'hidden',
            boxShadow: '0 12px 40px rgba(0,0,0,.35)',
          },
        },
          // header
          react.createElement('div', {
            style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderBottom: '1px solid #d8dce3', background: '#fafbfc', flexWrap: 'wrap' },
          },
            react.createElement('b', { style: { fontSize: '13px' } }, '📋 当前需求单'),
            react.createElement('span', { style: { color: '#5b6572', fontSize: '11px' } },
              '还要做什么：正在处理 + 待处理，按优先级分组（真源 tickets/<ID>/ticket.json）'),
            react.createElement('span', { style: { flex: '1' } }),
            react.createElement('span', { style: { color: '#8a94a3', fontSize: '11px' } },
              '台账 ' + (counts.total || 0) + ' 张 · ✅ ' + (counts.done || 0) + ' 已完 · 🚫 ' + (counts.dropped || 0) + ' 关单'),
            react.createElement('button', {
              onClick: () => load(true),
              disabled: !!s.loading,
              style: Object.assign({}, btnStyle, { opacity: s.loading ? .6 : 1 }),
            }, s.loading ? '读取中…' : '↻ 刷新'),
            react.createElement('button', {
              onClick: close,
              style: Object.assign({}, btnStyle, { background: '#e5484d', borderColor: '#e5484d', color: '#fff' }),
            }, '✕ 关闭'),
          ),
          // toolbar
          react.createElement('div', {
            style: { display: 'flex', alignItems: 'center', gap: '7px', padding: '7px 12px', borderBottom: '1px solid #e3e6ea', background: '#fff', flexWrap: 'wrap' },
          },
            react.createElement('span', { style: { color: '#8a94a3', fontSize: '11px' } }, '状态'),
            STATUS_ORDER.map(chip),
            react.createElement('span', { style: { width: '10px' } }),
            react.createElement('span', { style: { color: '#8a94a3', fontSize: '11px' } }, '域'),
            react.createElement('select', {
              value: s.area,
              onChange: (e) => setShared({ area: e.target.value }),
              style: Object.assign({}, btnStyle, { padding: '2px 4px' }),
            }, [react.createElement('option', { key: 'all', value: 'all' }, '全部')].concat(
              areas.map((a) => react.createElement('option', { key: a, value: a }, a)))),
            react.createElement('input', {
              value: s.q,
              placeholder: '搜索 id / 标题 / 域 / 现象…',
              onChange: (e) => setShared({ q: e.target.value }),
              style: Object.assign({}, btnStyle, { width: '220px', cursor: 'text' }),
            }),
            react.createElement('span', { style: { flex: '1' } }),
            react.createElement('span', { style: { color: '#8a94a3', fontSize: '11px' } }, '显示 ' + visible.length + ' 张'),
          ),
          // body
          react.createElement('div', { style: { flex: '1', overflow: 'auto', padding: '12px', background: '#fbfcfd' } }, body),
          // footer
          react.createElement('div', {
            style: { padding: '5px 12px', borderTop: '1px solid #e3e6ea', background: '#fafbfc', color: '#98a1b0', fontSize: '11px', display: 'flex', gap: '10px', flexWrap: 'wrap' },
          },
            react.createElement('span', null, 'tickets/ @ ' + ((data && data.root) || '?')),
            react.createElement('span', null, '读取于 ' + (s.fetchedAt ? new Date(s.fetchedAt).toLocaleTimeString() : '—')),
            data && data.issues && data.issues.length
              ? react.createElement('span', { style: { color: '#b3261e' } }, '⚠ ' + data.issues.length + ' 个文件夹读取失败：' + data.issues.map((i) => i.id).join(', '))
              : null,
          ),
        ),
      )
    }

    const name = 'amayui-ticket-board'
    const inject = ['slots']
    function apply(ctx) {
      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'ticket-board-dialog', order: 150 },
        () => react.createElement(TicketBoardOverlay),
      ))
      ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
        { name: 'conversation.session.header.actions', id: 'ticket-board-open', order: 35 },
        () => react.createElement(HeaderTicketButton),
      ))
    }

    exports.name = name
    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
