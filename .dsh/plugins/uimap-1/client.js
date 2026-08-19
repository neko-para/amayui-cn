// 天結 UI 元素地图（工具 A 直接形态）Client 半：
// 在 cordis_run 卡片（tool.view.cordis, key self）内渲染可交互 UI 元素地图。
// 数据经 host.call('uimap-state') 拉取最近一次扫描；导出经 host.call('uimap-export') 直写工程 .tmp/。

const btnStyle = {
  padding: '3px 10px', border: '1px solid #d8dce3', borderRadius: '4px', background: '#fff', cursor: 'pointer',
  font: '12px/1.4 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif',
}

return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    slots.inject('tool.view.cordis', () => slots.register(
      { name: 'tool.view.cordis', key: 'self' },
      () => React.createElement(UimapMap),
    ))
  },
}

function UimapMap() {
  const [state, setState] = React.useState(null)
  const [loading, setLoading] = React.useState(true)
  const [err, setErr] = React.useState(null)
  const [selected, setSelected] = React.useState({})
  const [hovered, setHovered] = React.useState(null)
  const [minPx, setMinPx] = React.useState(300)
  const [onlySel, setOnlySel] = React.useState(false)
  const [zoom, setZoom] = React.useState(1)
  const [imgLoaded, setImgLoaded] = React.useState(false)
  const [tip, setTip] = React.useState(null)
  const [exportMsg, setExportMsg] = React.useState('')
  const [exporting, setExporting] = React.useState(false)
  const canvasRef = React.useRef(null)
  const imgRef = React.useRef(null)
  const wrapRef = React.useRef(null)

  const refresh = React.useCallback(() => {
    setLoading(true)
    setErr(null)
    host.call('uimap-state', {}).then((s) => {
      setLoading(false)
      if (s && s.ready) {
        setState(s)
        setMinPx(s.min_px)
        setSelected({})
        setImgLoaded(false)
      } else {
        setState(null)
        setErr('尚未扫描：请先让助手运行 amayui_uimap 工具扫描一张 UI 图。')
      }
    }).catch((e) => {
      setLoading(false)
      setErr('读取扫描状态失败：' + String(e && e.message || e))
    })
  }, [])

  React.useEffect(() => { refresh() }, [refresh])

  // 原图加载完成后重绘
  React.useEffect(() => {
    const img = imgRef.current
    if (!img || !state) return
    if (img.complete && img.naturalWidth > 0) { setImgLoaded(true); return }
    const t = setTimeout(() => setImgLoaded(true), 2000)
    return () => clearTimeout(t)
  }, [state])

  // 绘制画布
  React.useEffect(() => {
    const cv = canvasRef.current
    const img = imgRef.current
    if (!cv || !img || !state || !imgLoaded) return
    const W = state.size.w, H = state.size.h
    const ctx2d = cv.getContext('2d')
    ctx2d.clearRect(0, 0, W, H)
    ctx2d.drawImage(img, 0, 0, W, H)
    const visible = state.blocks.filter((b) => b.px >= minPx && (!onlySel || selected[b.index]))
    for (const b of visible) {
      const c = colorOf(b)
      ctx2d.fillStyle = c.fill
      ctx2d.strokeStyle = c.stroke
      ctx2d.lineWidth = 1
      const x = b.x0, y = b.y0, w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1
      ctx2d.fillRect(x, y, w, h)
      ctx2d.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
      if (b.index === hovered || selected[b.index]) {
        ctx2d.strokeStyle = '#c98a00'
        ctx2d.lineWidth = 2
        ctx2d.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
      }
    }
  }, [state, imgLoaded, minPx, onlySel, selected, hovered])

  function colorOf(b) {
    if (b.px >= 100000) return { fill: 'rgba(224,123,0,.10)', stroke: '#e07b00' }
    if (b.px >= 3000) return { fill: 'rgba(31,122,214,.10)', stroke: '#1f7ad6' }
    if (b.px >= 500) return { fill: 'rgba(43,168,90,.10)', stroke: '#2ba85a' }
    return { fill: 'rgba(154,162,173,.08)', stroke: '#9aa2ad' }
  }

  function stagePoint(e) {
    const cv = canvasRef.current
    const r = cv.getBoundingClientRect()
    return {
      x: (e.clientX - r.left) * state.size.w / r.width,
      y: (e.clientY - r.top) * state.size.h / r.height,
    }
  }

  function blockAt(x, y) {
    for (const b of state.blocks) {
      if (b.px < minPx) continue
      if (onlySel && !selected[b.index]) continue
      if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return b
    }
    return null
  }

  function onMove(e) {
    if (!state || !imgLoaded) return
    const p = stagePoint(e)
    const b = blockAt(p.x, p.y)
    setHovered(b ? b.index : null)
    if (b) {
      const wr = wrapRef.current.getBoundingClientRect()
      setTip({
        left: e.clientX - wr.left + 14,
        top: e.clientY - wr.top + 14,
        text: '#' + b.index + '   x=' + b.x0 + '..' + b.x1 + '  y=' + b.y0 + '..' + b.y1 + '\n' + (b.w) + '×' + (b.h) + '   px=' + b.px,
      })
    } else {
      setTip(null)
    }
  }

  function onClick(e) {
    if (!state || !imgLoaded) return
    const p = stagePoint(e)
    const b = blockAt(p.x, p.y)
    if (!b) return
    setSelected((sel) => {
      const next = Object.assign({}, sel)
      if (next[b.index]) delete next[b.index]
      else next[b.index] = true
      return next
    })
  }

  function toggleSel(index) {
    setSelected((sel) => {
      const next = Object.assign({}, sel)
      if (next[index]) delete next[index]
      else next[index] = true
      return next
    })
  }

  function doExport() {
    const indices = Object.keys(selected).map(Number).filter((i) => selected[i])
    if (!indices.length) { setExportMsg('尚未选中任何块'); return }
    setExporting(true)
    setExportMsg('')
    host.call('uimap-export', { indices }).then((r) => {
      setExporting(false)
      if (r && r.ok) setExportMsg('已导出 ' + r.selected_count + ' 个块 → ' + r.path)
      else setExportMsg('导出失败：' + String(r && r.error || '未知错误'))
    }).catch((e) => {
      setExporting(false)
      setExportMsg('导出失败：' + String(e && e.message || e))
    })
  }

  const selCount = Object.keys(selected).filter((i) => selected[i]).length
  const listItems = state
    ? state.blocks.filter((b) => b.px >= minPx && (!onlySel || selected[b.index])).slice().sort((a, b) => b.px - a.px)
    : []

  return React.createElement('div', { style: {
    font: '12px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif',
    color: '#222', background: '#fff', border: '1px solid #d8dce3', borderRadius: '8px',
    padding: '8px', maxWidth: '100%', boxSizing: 'border-box',
  } },
    React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px 10px', alignItems: 'center', marginBottom: '6px' } },
      React.createElement('b', null, 'UI 元素地图'),
      state && React.createElement('span', { style: { color: '#666' } },
        state.png + ' · ' + state.size.w + '×' + state.size.h + ' · ' + state.blocks.length + ' 块 · 已选 ' + selCount),
      React.createElement('button', { onClick: refresh, style: btnStyle }, '⟳ 刷新'),
      React.createElement('button', { onClick: () => setZoom((z) => Math.min(3, z * 1.3)), style: btnStyle }, '＋'),
      React.createElement('button', { onClick: () => setZoom((z) => Math.max(0.1, z / 1.3)), style: btnStyle }, '－'),
      React.createElement('button', { onClick: () => setZoom(1), style: btnStyle }, '适应'),
      React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '4px' } },
        '最小面积',
        React.createElement('input', { type: 'range', min: '0', max: '20000', step: '100', value: minPx,
          onChange: (e) => setMinPx(+e.target.value), style: { width: '110px' } }),
        React.createElement('span', null, minPx)),
      React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '4px' } },
        React.createElement('input', { type: 'checkbox', checked: onlySel, onChange: (e) => setOnlySel(e.target.checked) }),
        '只显示选中'),
      React.createElement('button', { onClick: () => setSelected({}), style: btnStyle }, '清空'),
      React.createElement('button', { onClick: doExport, disabled: exporting, style: Object.assign({}, btnStyle, { background: '#c98a00', borderColor: '#c98a00', color: '#fff' }) },
        exporting ? '导出中…' : '导出选中 JSON'),
    ),
    err && React.createElement('div', { style: { color: '#b3261e', margin: '4px 0' } }, err),
    exportMsg && React.createElement('div', { style: { color: '#1f7a3d', margin: '4px 0', fontFamily: 'ui-monospace,Menlo,monospace' } }, exportMsg),
    loading && !state && React.createElement('div', { style: { color: '#666', padding: '12px 0' } }, '加载中…'),
    state && React.createElement('div', { style: { position: 'relative', overflow: 'auto', maxHeight: '520px', border: '1px solid #d8dce3', borderRadius: '6px', background: 'repeating-conic-gradient(#fff 0 25%, #f0f0f0 0 50%) 0 0/16px 16px' } },
      React.createElement('div', { ref: wrapRef, style: { position: 'relative', display: 'inline-block', transform: 'scale(' + zoom + ')', transformOrigin: 'top left' } },
        React.createElement('canvas', {
          ref: canvasRef, width: state.size.w, height: state.size.h,
          onMouseMove: onMove, onMouseLeave: () => { setHovered(null); setTip(null) }, onClick,
          style: { display: 'block' },
        }),
        tip && React.createElement('div', { style: {
          position: 'absolute', left: tip.left, top: tip.top, pointerEvents: 'none',
          background: 'rgba(20,24,32,.92)', color: '#fff', padding: '6px 9px', borderRadius: '5px',
          font: '12px/1.5 ui-monospace,Menlo,monospace', whiteSpace: 'pre', zIndex: 20, maxWidth: '340px',
        } }, tip.text),
        React.createElement('img', { ref: imgRef, src: state.imageUrl, alt: '', style: { display: 'none' },
          onLoad: () => setImgLoaded(true) }),
      ),
    ),
    state && React.createElement('div', { style: { marginTop: '6px', border: '1px solid #d8dce3', borderRadius: '6px', maxHeight: '220px', overflow: 'auto' } },
      listItems.length === 0
        ? React.createElement('div', { style: { padding: '8px', color: '#98a1b0' } }, '（无符合条件的块）')
        : listItems.map((b) => React.createElement('div', {
            key: b.index,
            onClick: () => toggleSel(b.index),
            onMouseEnter: () => setHovered(b.index),
            onMouseLeave: () => setHovered(null),
            style: {
              display: 'flex', alignItems: 'center', gap: '8px', padding: '3px 8px', cursor: 'pointer',
              background: selected[b.index] ? '#fff6e0' : (hovered === b.index ? '#e8effa' : 'transparent'),
            },
          },
            React.createElement('input', { type: 'checkbox', checked: !!selected[b.index], readOnly: true }),
            React.createElement('span', { style: { color: '#8a94a3', fontFamily: 'ui-monospace,Menlo,monospace', width: '36px', flex: 'none' } }, '#' + b.index),
            React.createElement('span', { style: { flex: '1', fontFamily: 'ui-monospace,Menlo,monospace', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
              b.w + '×' + b.h + '  x=' + b.x0 + '..' + b.x1 + ' y=' + b.y0 + '..' + b.y1),
            React.createElement('span', { style: { color: '#98a1b0', fontSize: '11px' } }, b.px),
          )),
    ),
    React.createElement('div', { style: { marginTop: '6px', color: '#98a1b0', fontSize: '11px' } },
      '悬停看详情；点击选中/取消；导出后 agent 读取 .tmp/' + (state ? state.png.replace(/\.png$/i, '') : '') + '_selected.json 继续。'),
  )
}
