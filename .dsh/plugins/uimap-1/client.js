// 天結 UI 元素地图（工具 A）+ 清理工作台（工具 B）Client 半：
// 修复：
// 1) 列填充预览前先 putImageData 还原原始块（原图透明区 drawImage 无法覆盖，必须用原始 ImageData 还原）；
// 2) keepL/keepR 左右独立，工作画布上叠加金色边界线，按住拖拽调整保留宽度。

let timerApi = null

const shared = { scan: null, selected: {}, open: false, imgLoaded: false }
const listeners = new Set()
function bump() { for (const l of listeners) l() }
function setShared(patch) { Object.assign(shared, patch); bump() }
function useShared() {
  const [, force] = React.useState(0)
  React.useEffect(() => {
    const fn = () => force((n) => n + 1)
    listeners.add(fn)
    return () => listeners.delete(fn)
  }, [])
  return shared
}

const btnStyle = {
  padding: '3px 10px', border: '1px solid #d8dce3', borderRadius: '4px', background: '#fff', cursor: 'pointer',
  font: '12px/1.4 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif',
}
const KEEP_PRESETS = [
  { label: '纯色底 15', v: 15 },
  { label: '渐变底 20', v: 20 },
  { label: '面板 40', v: 40 },
  { label: '小按钮 23', v: 23 },
]

return {
  inject: ['timer'],
  apply(ctx) {
    timerApi = ctx.timer
    const slots = ctx.get('slots')
    if (slots === undefined) return
    slots.inject('tool.call.toolview', () => slots.register(
      { name: 'tool.call.toolview', key: 'amayui_uimap' },
      (props) => React.createElement(AmayuiUimapToolView, props),
    ))
    slots.inject('shell.overlay', () => slots.register(
      { name: 'shell.overlay', id: 'uimap-dialog', order: 100 },
      () => React.createElement(UimapOverlay),
    ))
  },
}

function drawMap(ctx2d, img, scan, selected, hovered, minPx, onlySel) {
  const W = scan.size.w, H = scan.size.h
  ctx2d.clearRect(0, 0, W, H)
  ctx2d.drawImage(img, 0, 0, W, H)
  const visible = scan.blocks.filter((b) => b.px >= minPx && (!onlySel || selected[b.index]))
  for (const b of visible) {
    const x = b.x0, y = b.y0, w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1
    if (selected[b.index]) {
      ctx2d.fillStyle = 'rgba(201,138,0,.35)'
      ctx2d.fillRect(x, y, w, h)
      ctx2d.strokeStyle = '#c98a00'
      ctx2d.lineWidth = 2
      ctx2d.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
    } else {
      const c = colorOf(b)
      ctx2d.fillStyle = c.fill
      ctx2d.strokeStyle = c.stroke
      ctx2d.lineWidth = 1
      ctx2d.fillRect(x, y, w, h)
      ctx2d.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
    }
    if (b.index === hovered) {
      ctx2d.strokeStyle = '#c98a00'
      ctx2d.lineWidth = 2
      ctx2d.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
    }
  }
}

function colorOf(b) {
  if (b.px >= 100000) return { fill: 'rgba(224,123,0,.10)', stroke: '#e07b00' }
  if (b.px >= 3000) return { fill: 'rgba(31,122,214,.10)', stroke: '#1f7ad6' }
  if (b.px >= 500) return { fill: 'rgba(43,168,90,.10)', stroke: '#2ba85a' }
  return { fill: 'rgba(154,162,173,.08)', stroke: '#9aa2ad' }
}

// ---- 工具结果卡片 ----
function AmayuiUimapToolView(props) {
  const shared = useShared()
  const [exportMsg, setExportMsg] = React.useState('')
  const [exporting, setExporting] = React.useState(false)
  const block = props && props.block
  const isSettled = !!(block && block.kind === 'tool-result')
  const callName = block && (block.kind === 'tool-result' ? (block.call && block.call.name) || 'amayui_uimap' : block.name) || 'amayui_uimap'
  const argsRaw = block && (block.kind === 'tool-result' ? (block.call && block.call.argsRaw) : block.argsRaw) || ''
  let argPng = ''
  try {
    const parsed = argsRaw ? JSON.parse(argsRaw) : null
    if (parsed && parsed.png) argPng = String(parsed.png)
  } catch (e) { /* ignore */ }

  let resultText = ''
  if (isSettled && Array.isArray(block.content)) {
    for (const c of block.content) {
      if (c && c.type === 'text' && c.text) resultText += c.text + '\n'
    }
  }

  const selList = Object.keys(shared.selected).map(Number).sort((a, b) => a - b)

  function doExport() {
    if (!selList.length) { setExportMsg('尚未选中任何块'); return }
    setExporting(true)
    setExportMsg('')
    host.call('uimap-export', { indices: selList }).then((r) => {
      setExporting(false)
      if (r && r.ok) setExportMsg('已导出 ' + r.selected_count + ' 个块 → ' + r.path)
      else setExportMsg('导出失败：' + String(r && r.error || '未知错误'))
    }).catch((e) => {
      setExporting(false)
      setExportMsg('导出失败：' + String(e && e.message || e))
    })
  }

  return React.createElement('div', { style: {
    font: '12px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif',
    color: '#222', background: '#fff', border: '1px solid #d8dce3', borderRadius: '8px',
    padding: '8px', maxWidth: '100%', boxSizing: 'border-box',
  } },
    React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px 10px', alignItems: 'center', marginBottom: '6px' } },
      React.createElement('b', null, '🔍 UI 元素地图'),
      React.createElement('span', { style: { color: '#666' } },
        callName + (argPng ? ' · ' + argPng : '') + ' · 已选 ' + selList.length + ' 个块'),
      React.createElement('button', {
        onClick: () => setShared({ open: true }),
        style: Object.assign({}, btnStyle, { background: '#1f7ad6', borderColor: '#1f7ad6', color: '#fff' }),
      }, '🖥 全屏选择'),
      React.createElement('button', { onClick: doExport, disabled: exporting, style: Object.assign({}, btnStyle, { background: '#c98a00', borderColor: '#c98a00', color: '#fff' }) },
        exporting ? '导出中…' : '导出选中 JSON'),
      React.createElement('button', { onClick: () => setShared({ selected: {} }), style: btnStyle }, '清空'),
    ),
    resultText && React.createElement('pre', { style: {
      margin: '4px 0', padding: '6px 8px', background: '#f6f7f9', borderRadius: '4px',
      font: '11px/1.5 ui-monospace,Menlo,monospace', color: '#333', whiteSpace: 'pre-wrap', maxHeight: '120px', overflow: 'auto',
    } }, resultText),
    exportMsg && React.createElement('div', { style: { color: '#1f7a3d', margin: '4px 0', fontFamily: 'ui-monospace,Menlo,monospace' } }, exportMsg),
    selList.length > 0 && React.createElement('div', { style: { marginTop: '4px', border: '1px solid #d8dce3', borderRadius: '6px', maxHeight: '140px', overflow: 'auto' } },
      selList.map((idx) => {
        const b = shared.scan && shared.scan.blocks.find((x) => x.index === idx)
        if (!b) return null
        return React.createElement('div', { key: idx, style: {
          display: 'flex', gap: '8px', padding: '2px 8px', fontFamily: 'ui-monospace,Menlo,monospace', fontSize: '11px',
        } },
          React.createElement('span', { style: { color: '#8a94a3', width: '36px', flex: 'none' } }, '#' + b.index),
          React.createElement('span', { style: { flex: '1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
            b.w + '×' + b.h + '  x=' + b.x0 + '..' + b.x1 + ' y=' + b.y0 + '..' + b.y1),
          React.createElement('span', { style: { color: '#98a1b0' } }, b.px),
        )
      }),
    ),
    React.createElement('div', { style: { marginTop: '6px', color: '#98a1b0', fontSize: '11px' } },
      '点「全屏选择」打开大画布点选；导出后 agent 读取 .tmp/' + (argPng ? argPng.replace(/\.png$/i, '') : '') + '_selected.json 继续。'),
  )
}

// ---- 全屏模态 ----
function UimapOverlay() {
  const shared = useShared()
  const [view, setView] = React.useState('map')
  const [minPx, setMinPx] = React.useState(300)
  const [onlySel, setOnlySel] = React.useState(false)
  const [zoom, setZoom] = React.useState(1)
  const [hovered, setHovered] = React.useState(null)
  const [tip, setTip] = React.useState(null)
  const [exportMsg, setExportMsg] = React.useState('')
  const [exporting, setExporting] = React.useState(false)
  const [err, setErr] = React.useState(null)
  const canvasRef = React.useRef(null)
  const imgRef = React.useRef(null)
  const wrapRef = React.useRef(null)

  React.useEffect(() => {
    if (!shared.open) return
    setErr(null)
    host.call('uimap-state', {}).then((s) => {
      if (s && s.ready) setShared({ scan: s, imgLoaded: false })
      else setErr('尚未扫描：请先让助手运行 amayui_uimap 工具。')
    }).catch((e) => setErr('读取扫描状态失败：' + String(e && e.message || e)))
  }, [shared.open])

  React.useEffect(() => {
    if (!shared.open || !shared.scan) return
    const img = imgRef.current
    if (!img) return
    if (img.complete && img.naturalWidth > 0) { setShared({ imgLoaded: true }); return }
    if (!timerApi) return
    const dispose = timerApi.timeout(() => setShared({ imgLoaded: true }), 2500)
    return () => dispose()
  }, [shared.open, shared.scan])

  React.useEffect(() => {
    const cv = canvasRef.current
    const img = imgRef.current
    if (!cv || !img || !shared.scan || !shared.imgLoaded) return
    drawMap(cv.getContext('2d'), img, shared.scan, shared.selected, hovered, minPx, onlySel)
  }, [shared.scan, shared.imgLoaded, shared.selected, hovered, minPx, onlySel])

  if (!shared.open) return null
  const scan = shared.scan
  const selCount = Object.keys(shared.selected).filter((i) => shared.selected[i]).length
  const listItems = scan
    ? scan.blocks.filter((b) => b.px >= minPx && (!onlySel || shared.selected[b.index])).slice().sort((a, b) => b.px - a.px)
    : []

  function stagePoint(e) {
    const cv = canvasRef.current
    const r = cv.getBoundingClientRect()
    return {
      x: (e.clientX - r.left) * scan.size.w / r.width,
      y: (e.clientY - r.top) * scan.size.h / r.height,
    }
  }

  function blockAt(x, y) {
    for (const b of scan.blocks) {
      if (b.px < minPx) continue
      if (onlySel && !shared.selected[b.index]) continue
      if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return b
    }
    return null
  }

  function onMove(e) {
    if (!scan || !shared.imgLoaded) return
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
    if (!scan || !shared.imgLoaded) return
    const p = stagePoint(e)
    const b = blockAt(p.x, p.y)
    if (!b) return
    const next = Object.assign({}, shared.selected)
    if (next[b.index]) delete next[b.index]
    else next[b.index] = true
    setShared({ selected: next })
  }

  function toggleSel(index) {
    const next = Object.assign({}, shared.selected)
    if (next[index]) delete next[index]
    else next[index] = true
    setShared({ selected: next })
  }

  function doExport() {
    const indices = Object.keys(shared.selected).map(Number).filter((i) => shared.selected[i])
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

  return React.createElement('div', { style: {
    position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(15,18,24,.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
    font: '12px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif',
    pointerEvents: 'auto', boxSizing: 'border-box',
  } },
    React.createElement('div', { style: {
      width: '96%', maxWidth: '1500px', height: '92%', display: 'flex', flexDirection: 'column',
      background: '#fff', borderRadius: '10px', border: '1px solid #d8dce3', overflow: 'hidden',
      boxShadow: '0 12px 40px rgba(0,0,0,.35)',
    } },
      React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px 12px', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #d8dce3', background: '#fafbfc' } },
        React.createElement('b', { style: { fontSize: '13px' } }, '🖥 UI 元素地图 · ' + (view === 'map' ? '选择' : '清理工作台')),
        scan && view === 'map' && React.createElement('span', { style: { color: '#666' } },
          scan.png + ' · ' + scan.size.w + '×' + scan.size.h + ' · ' + scan.blocks.length + ' 块 · 已选 ' + selCount),
        React.createElement('span', { style: { flex: '1' } }),
        view === 'map'
          ? React.createElement('button', {
              onClick: () => setView('clean'),
              style: Object.assign({}, btnStyle, { background: '#2ba85a', borderColor: '#2ba85a', color: '#fff' }),
            }, '🧹 清理工作台（' + selCount + ' 块）')
          : React.createElement('button', { onClick: () => setView('map'), style: btnStyle }, '← 返回选择'),
        React.createElement('button', { onClick: () => setShared({ open: false }), style: Object.assign({}, btnStyle, { background: '#e5484d', borderColor: '#e5484d', color: '#fff' }) }, '✕ 关闭'),
      ),
      view === 'map'
        ? React.createElement('div', { style: { flex: 1, display: 'flex', minHeight: 0 } },
            React.createElement('div', { style: { flex: 1, overflow: 'auto', padding: '10px', background: 'repeating-conic-gradient(#fff 0 25%, #f0f0f0 0 50%) 0 0/16px 16px', position: 'relative' } },
              err && React.createElement('div', { style: { color: '#b3261e', margin: '8px' } }, err),
              !scan && React.createElement('div', { style: { color: '#666', padding: '20px' } }, '加载中…'),
              scan && React.createElement('div', { ref: wrapRef, style: { position: 'relative', display: 'inline-block', transform: 'scale(' + zoom + ')', transformOrigin: 'top left' } },
                React.createElement('canvas', {
                  ref: canvasRef, width: scan.size.w, height: scan.size.h,
                  onMouseMove: onMove, onMouseLeave: () => { setHovered(null); setTip(null) }, onClick,
                  style: { display: 'block' },
                }),
                tip && React.createElement('div', { style: {
                  position: 'absolute', left: tip.left, top: tip.top, pointerEvents: 'none',
                  background: 'rgba(20,24,32,.92)', color: '#fff', padding: '6px 9px', borderRadius: '5px',
                  font: '12px/1.5 ui-monospace,Menlo,monospace', whiteSpace: 'pre', zIndex: 20, maxWidth: '340px',
                } }, tip.text),
                React.createElement('img', { ref: imgRef, src: scan.imageUrl, alt: '', style: { display: 'none' },
                  onLoad: () => setShared({ imgLoaded: true }) }),
              ),
            ),
            React.createElement('div', { style: { width: '280px', flex: 'none', borderLeft: '1px solid #d8dce3', display: 'flex', flexDirection: 'column', minHeight: 0 } },
              React.createElement('div', { style: { padding: '6px 10px', borderBottom: '1px solid #d8dce3', fontWeight: 600 } },
                '连通块清单（' + listItems.length + '）'),
              React.createElement('div', { style: { flex: 1, overflow: 'auto' } },
                listItems.length === 0
                  ? React.createElement('div', { style: { padding: '8px', color: '#98a1b0' } }, '（无符合条件的块）')
                  : listItems.map((b) => React.createElement('div', {
                      key: b.index,
                      onClick: () => toggleSel(b.index),
                      onMouseEnter: () => setHovered(b.index),
                      onMouseLeave: () => setHovered(null),
                      style: {
                        display: 'flex', alignItems: 'center', gap: '8px', padding: '3px 10px', cursor: 'pointer',
                        background: shared.selected[b.index] ? 'rgba(201,138,0,.18)' : (hovered === b.index ? '#e8effa' : 'transparent'),
                      },
                    },
                      React.createElement('input', { type: 'checkbox', checked: !!shared.selected[b.index], readOnly: true }),
                      React.createElement('span', { style: { color: '#8a94a3', fontFamily: 'ui-monospace,Menlo,monospace', width: '34px', flex: 'none' } }, '#' + b.index),
                      React.createElement('span', { style: { flex: '1', fontFamily: 'ui-monospace,Menlo,monospace', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                        b.w + '×' + b.h + '  x=' + b.x0 + '..' + b.x1),
                      React.createElement('span', { style: { color: '#98a1b0', fontSize: '11px' } }, b.px),
                    )),
              ),
              exportMsg && React.createElement('div', { style: { padding: '6px 10px', borderTop: '1px solid #d8dce3', color: '#1f7a3d', fontFamily: 'ui-monospace,Menlo,monospace', fontSize: '11px' } }, exportMsg),
              React.createElement('div', { style: { padding: '6px 10px', borderTop: '1px solid #d8dce3', color: '#98a1b0', fontSize: '11px' } },
                '点击图上块选中/取消（金色蒙层）；选中后进「清理工作台」。'),
            ),
          )
        : React.createElement(CleanWorkbench, { scan, selected: shared.selected }),
    ),
  )
}

// ---- 清理工作台（keepL/keepR 独立 + 画布拖拽边界 + 原始 ImageData 还原）----
function CleanWorkbench({ scan, selected }) {
  const [curIdx, setCurIdx] = React.useState(0)
  const [mode, setMode] = React.useState('fill')
  const [keepL, setKeepL] = React.useState(15)
  const [keepR, setKeepR] = React.useState(15)
  const [fillColRel, setFillColRel] = React.useState(null)
  const [density, setDensity] = React.useState(null)
  const [err, setErr] = React.useState(null)
  const [pasteSrc, setPasteSrc] = React.useState('')
  const [pasteX0, setPasteX0] = React.useState('')
  const [pasteY0, setPasteY0] = React.useState('')
  const [pasteX1, setPasteX1] = React.useState('')
  const [pasteY1, setPasteY1] = React.useState('')
  const [plan, setPlan] = React.useState([])
  const [planMsg, setPlanMsg] = React.useState('')
  const [exporting, setExporting] = React.useState(false)
  const [dragging, setDragging] = React.useState(null) // 'l' | 'r' | null
  const workRef = React.useRef(null)
  const histRef = React.useRef(null)
  const srcImgRef = React.useRef(null)
  const mainImgRef = React.useRef(null)
  const origRef = React.useRef(null) // 原始块 ImageData（还原用）
  const dragRef = React.useRef(null) // { side, startX, startKeep }

  const selIndices = Object.keys(selected).filter((i) => selected[i]).map(Number).sort((a, b) => a - b)
  const block = selIndices.length ? scan.blocks.find((b) => b.index === selIndices[curIdx]) : null

  // 主图加载完成 → 绘制当前块并缓存原始 ImageData
  React.useEffect(() => {
    const img = mainImgRef.current
    if (!img || !block || !scan) return
    if (!(img.complete && img.naturalWidth > 0)) return
    const cv = workRef.current
    if (!cv) return
    const bw = block.x1 - block.x0 + 1, bh = block.y1 - block.y0 + 1
    cv.width = bw; cv.height = bh
    const ctx2d = cv.getContext('2d')
    ctx2d.clearRect(0, 0, bw, bh)
    ctx2d.drawImage(img, block.x0, block.y0, bw, bh, 0, 0, bw, bh)
    origRef.current = ctx2d.getImageData(0, 0, bw, bh)
    const dens = computeDensity(origRef.current.data, bw, bh)
    setDensity(dens)
    setFillColRel(null)
  }, [block, scan])

  // 预览：先 putImageData 还原原始，再应用填充/透明/粘贴，最后画保留边界线
  React.useEffect(() => {
    const cv = workRef.current
    const img = mainImgRef.current
    if (!cv || !img || !block || !scan) return
    if (!(img.complete && img.naturalWidth > 0) || !origRef.current) return
    const bw = block.x1 - block.x0 + 1, bh = block.y1 - block.y0 + 1
    const ctx2d = cv.getContext('2d')
    ctx2d.putImageData(origRef.current, 0, 0) // 还原（透明像素也能被覆盖）
    if (mode === 'fill' && fillColRel !== null && fillColRel !== undefined) {
      applyColumnFill(ctx2d, bw, bh, keepL, keepR, fillColRel)
    } else if (mode === 'transparent') {
      applyTransparent(ctx2d, bw, bh)
    } else if (mode === 'paste') {
      const srcImg = srcImgRef.current
      const sx0 = parseInt(pasteX0, 10), sy0 = parseInt(pasteY0, 10), sx1 = parseInt(pasteX1, 10), sy1 = parseInt(pasteY1, 10)
      if (srcImg && srcImg.complete && srcImg.naturalWidth > 0 && !isNaN(sx0) && !isNaN(sy0) && !isNaN(sx1) && !isNaN(sy1)) {
        ctx2d.drawImage(srcImg, sx0, sy0, sx1 - sx0 + 1, sy1 - sy0 + 1, 0, 0, bw, bh)
      }
    }
    // 保留区边界线（金色，拖拽侧红色高亮）
    if (mode === 'fill') {
      ctx2d.fillStyle = 'rgba(201,138,0,.08)'
      ctx2d.fillRect(0, 0, keepL, bh)
      ctx2d.fillRect(bw - keepR, 0, keepR, bh)
      ctx2d.strokeStyle = dragging === 'l' ? '#e5484d' : '#c98a00'
      ctx2d.lineWidth = 2
      ctx2d.beginPath(); ctx2d.moveTo(keepL + 1, 0); ctx2d.lineTo(keepL + 1, bh); ctx2d.stroke()
      ctx2d.strokeStyle = dragging === 'r' ? '#e5484d' : '#c98a00'
      ctx2d.beginPath(); ctx2d.moveTo(bw - keepR - 1, 0); ctx2d.lineTo(bw - keepR - 1, bh); ctx2d.stroke()
    }
  }, [mode, keepL, keepR, fillColRel, block, scan, pasteSrc, pasteX0, pasteY0, pasteX1, pasteY1, dragging])

  // 直方图
  React.useEffect(() => {
    const cv = histRef.current
    if (!cv || !density || !block) return
    const bw = block.x1 - block.x0 + 1
    cv.width = Math.max(bw, 40); cv.height = 64
    const ctx2d = cv.getContext('2d')
    ctx2d.clearRect(0, 0, cv.width, cv.height)
    const max = Math.max(1, ...density.cols)
    for (let x = 0; x < bw; x++) {
      const h = Math.round(density.cols[x] / max * 56)
      let color = '#1f7ad6'
      if (x === fillColRel) color = '#c98a00'
      else if (x < keepL || x >= bw - keepR) color = '#d8dce3'
      ctx2d.fillStyle = color
      ctx2d.fillRect(x, 64 - h, 1, h)
    }
    const maxR = Math.max(1, ...density.rows)
    ctx2d.fillStyle = '#9aa2ad'
    for (let y = 0; y < density.rows.length && y < 8; y++) {
      const h = Math.round(density.rows[y] / maxR * 56)
      ctx2d.fillRect(0, y + 64 - 8, h, 1)
    }
  }, [density, fillColRel, keepL, keepR, block])

  if (!block) {
    return React.createElement('div', { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#98a1b0', padding: '40px' } },
      '请先在地图视图中选中要清理的块（点图上的块或勾选清单）。')
  }
  const bw = block.x1 - block.x0 + 1
  const scale = Math.max(2, Math.min(8, Math.round(480 / bw)))

  function onHistClick(e) {
    const cv = histRef.current
    if (!cv || !density) return
    const r = cv.getBoundingClientRect()
    const col = Math.floor((e.clientX - r.left) / r.width * bw)
    setFillColRel(Math.max(0, Math.min(bw - 1, col)))
  }

  // 画布拖拽：按下时判定命中哪条边界线
  function canvasMouseDown(e) {
    const cv = workRef.current
    const r = cv.getBoundingClientRect()
    const x = Math.round((e.clientX - r.left) / r.width * bw)
    const hitL = Math.abs(x - keepL) <= 2
    const hitR = Math.abs(x - (bw - keepR)) <= 2
    if (hitL || hitR) {
      const side = hitL ? 'l' : 'r'
      dragRef.current = { side, startX: x, startKeep: side === 'l' ? keepL : keepR }
      setDragging(side)
    }
  }
  function canvasMouseMove(e) {
    if (!dragRef.current) return
    const cv = workRef.current
    const r = cv.getBoundingClientRect()
    const x = Math.round((e.clientX - r.left) / r.width * bw)
    const d = dragRef.current
    const delta = x - d.startX
    const maxKeep = Math.max(0, bw - 4)
    if (d.side === 'l') setKeepL(Math.max(0, Math.min(maxKeep, d.startKeep + delta)))
    else setKeepR(Math.max(0, Math.min(maxKeep, d.startKeep - delta)))
  }
  function canvasMouseUp() {
    dragRef.current = null
    setDragging(null)
  }

  function addToPlan() {
    const entry = {
      index: block.index,
      x0: block.x0, y0: block.y0, x1: block.x1, y1: block.y1,
      w: block.w, h: block.h,
      mode,
    }
    if (mode === 'fill') {
      const fc = fillColRel !== null && fillColRel !== undefined ? fillColRel : keepL
      entry.keepL = keepL
      entry.keepR = keepR
      entry.fillCol = block.x0 + fc
    } else if (mode === 'paste') {
      entry.paste = {
        src: pasteSrc,
        x0: parseInt(pasteX0, 10), y0: parseInt(pasteY0, 10),
        x1: parseInt(pasteX1, 10), y1: parseInt(pasteY1, 10),
      }
    }
    const next = plan.concat([entry])
    setPlan(next)
    setPlanMsg('已加入 #' + block.index + '（' + (mode === 'fill' ? '列填充 L=' + keepL + ' R=' + keepR + ' col=' + entry.fillCol : mode === 'transparent' ? '置透明' : '贴底图') + '）')
    if (curIdx < selIndices.length - 1) setCurIdx(curIdx + 1)
  }

  function removePlan(i) {
    setPlan(plan.filter((_, k) => k !== i))
  }

  function doExportPlan() {
    if (!plan.length) { setPlanMsg('方案为空：请先逐块「加入方案」'); return }
    setExporting(true)
    setPlanMsg('')
    host.call('uimap-clean-export', { blocks: plan }).then((r) => {
      setExporting(false)
      if (r && r.ok) setPlanMsg('已导出方案 → ' + r.jsonPath + ' · 清理脚本 → ' + r.scriptPath)
      else setPlanMsg('导出失败：' + String(r && r.error || '未知错误'))
    }).catch((e) => {
      setExporting(false)
      setPlanMsg('导出失败：' + String(e && e.message || e))
    })
  }

  return React.createElement('div', { style: { flex: 1, display: 'flex', minHeight: 0 } },
    React.createElement('div', { style: { flex: 1, overflow: 'auto', padding: '12px' } },
      React.createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' } },
        React.createElement('b', null, '清理块 ' + (curIdx + 1) + '/' + selIndices.length),
        React.createElement('button', { onClick: () => setCurIdx(Math.max(0, curIdx - 1)), disabled: curIdx === 0, style: btnStyle }, '‹ 上一块'),
        React.createElement('button', { onClick: () => setCurIdx(Math.min(selIndices.length - 1, curIdx + 1)), disabled: curIdx >= selIndices.length - 1, style: btnStyle }, '下一块 ›'),
        React.createElement('span', { style: { color: '#666', fontFamily: 'ui-monospace,Menlo,monospace' } },
          '#' + block.index + '  ' + block.w + '×' + block.h + '  x=' + block.x0 + '..' + block.x1 + ' y=' + block.y0 + '..' + block.y1),
      ),
      React.createElement('div', { style: {
        border: '1px solid #d8dce3', borderRadius: '6px', padding: '8px', background: 'repeating-conic-gradient(#fff 0 25%, #f0f0f0 0 50%) 0 0/16px 16px',
        display: 'inline-block', marginBottom: '8px',
      } },
        React.createElement('canvas', { ref: workRef, style: {
          width: bw * scale, height: block.h * scale, imageRendering: 'pixelated', display: 'block', cursor: dragging ? 'ew-resize' : 'pointer',
        },
          onMouseDown: canvasMouseDown, onMouseMove: canvasMouseMove, onMouseUp: canvasMouseUp, onMouseLeave: canvasMouseUp }),
        React.createElement('img', { ref: mainImgRef, src: scan.imageUrl, alt: '', style: { display: 'none' } }),
        React.createElement('img', { ref: srcImgRef, src: pasteSrc ? '/dsh-uimap/' + pasteSrc.replace(/^\//, '') : '', alt: '', style: { display: 'none' } }),
      ),
      React.createElement('div', { style: { marginBottom: '8px' } },
        React.createElement('div', { style: { color: '#666', marginBottom: '2px', fontSize: '11px' } },
          '列笔画密度（蓝=笔画多 灰=保留区 金色=当前填充列；点击选列）：'),
        React.createElement('canvas', { ref: histRef, onClick: onHistClick, style: {
          border: '1px solid #d8dce3', borderRadius: '4px', cursor: 'pointer', display: 'block', width: '100%', maxWidth: '640px',
        } }),
      ),
      err && React.createElement('div', { style: { color: '#b3261e', margin: '4px 0' } }, err),
    ),
    React.createElement('div', { style: { width: '320px', flex: 'none', borderLeft: '1px solid #d8dce3', display: 'flex', flexDirection: 'column', minHeight: 0 } },
      React.createElement('div', { style: { padding: '8px 12px', borderBottom: '1px solid #d8dce3' } },
        React.createElement('div', { style: { fontWeight: 600, marginBottom: '6px' } }, '清理方式'),
        React.createElement('div', { style: { display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' } },
          React.createElement('button', { onClick: () => setMode('fill'), style: Object.assign({}, btnStyle, mode === 'fill' ? { background: '#1f7ad6', borderColor: '#1f7ad6', color: '#fff' } : {}) }, '列填充'),
          React.createElement('button', { onClick: () => setMode('transparent'), style: Object.assign({}, btnStyle, mode === 'transparent' ? { background: '#1f7ad6', borderColor: '#1f7ad6', color: '#fff' } : {}) }, '置透明'),
          React.createElement('button', { onClick: () => setMode('paste'), style: Object.assign({}, btnStyle, mode === 'paste' ? { background: '#1f7ad6', borderColor: '#1f7ad6', color: '#fff' } : {}) }, '贴底图'),
        ),
        mode === 'fill' && React.createElement('div', null,
          React.createElement('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '6px' } },
            KEEP_PRESETS.map((p) => React.createElement('button', { key: p.v, onClick: () => { setKeepL(p.v); setKeepR(p.v) }, style: Object.assign({}, btnStyle, keepL === p.v && keepR === p.v ? { borderColor: '#1f7ad6', color: '#1f7ad6' } : {}) }, p.label)),
          ),
          React.createElement('div', { style: { display: 'flex', gap: '8px', marginBottom: '6px', alignItems: 'center' } },
            React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '4px' } },
              '左 L',
              React.createElement('input', { type: 'number', min: '0', max: '80', value: keepL, onChange: (e) => setKeepL(Math.max(0, Math.min(80, parseInt(e.target.value, 10) || 0))), style: { width: '52px' } }),
            ),
            React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '4px' } },
              '右 R',
              React.createElement('input', { type: 'number', min: '0', max: '80', value: keepR, onChange: (e) => setKeepR(Math.max(0, Math.min(80, parseInt(e.target.value, 10) || 0))), style: { width: '52px' } }),
            ),
          ),
          React.createElement('div', { style: { color: '#666', fontSize: '11px', marginBottom: '6px' } },
            '填充列（绝对 x）：' + (fillColRel !== null && fillColRel !== undefined ? block.x0 + fillColRel : '未选（默认 ' + (block.x0 + keepL) + '）') + '  ← 点直方图选列；左右边界可在图上拖拽'),
        ),
        mode === 'paste' && React.createElement('div', null,
          React.createElement('div', { style: { color: '#666', fontSize: '11px', marginBottom: '4px' } }, '来源图（相对工程根，如 res/SO021.png）：'),
          React.createElement('input', { value: pasteSrc, onChange: (e) => setPasteSrc(e.target.value), placeholder: 'res/SO021.png', style: { width: '100%', boxSizing: 'border-box', marginBottom: '6px', padding: '3px 6px' } }),
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginBottom: '6px' } },
            React.createElement('input', { value: pasteX0, onChange: (e) => setPasteX0(e.target.value), placeholder: 'src x0', style: { padding: '3px 6px' } }),
            React.createElement('input', { value: pasteY0, onChange: (e) => setPasteY0(e.target.value), placeholder: 'src y0', style: { padding: '3px 6px' } }),
            React.createElement('input', { value: pasteX1, onChange: (e) => setPasteX1(e.target.value), placeholder: 'src x1', style: { padding: '3px 6px' } }),
            React.createElement('input', { value: pasteY1, onChange: (e) => setPasteY1(e.target.value), placeholder: 'src y1', style: { padding: '3px 6px' } }),
          ),
          React.createElement('div', { style: { color: '#98a1b0', fontSize: '11px' } },
            '预览在左侧画布显示；来源区域会拉伸到当前块大小。'),
        ),
      ),
      React.createElement('div', { style: { padding: '8px 12px', borderBottom: '1px solid #d8dce3' } },
        React.createElement('button', { onClick: addToPlan, style: Object.assign({}, btnStyle, { background: '#c98a00', borderColor: '#c98a00', color: '#fff', width: '100%' }) }, '＋ 加入方案（下一块）'),
      ),
      React.createElement('div', { style: { flex: 1, overflow: 'auto', padding: '4px 0' } },
        plan.length === 0
          ? React.createElement('div', { style: { padding: '8px 12px', color: '#98a1b0' } }, '方案为空：逐块设置后点「加入方案」。')
          : plan.map((p, i) => React.createElement('div', { key: i, style: {
              display: 'flex', gap: '6px', alignItems: 'center', padding: '4px 12px', borderBottom: '1px solid #f0f2f5',
            } },
              React.createElement('span', { style: { color: '#8a94a3', fontFamily: 'ui-monospace,Menlo,monospace', width: '30px', flex: 'none' } }, '#' + p.index),
              React.createElement('span', { style: { flex: '1', fontSize: '11px', color: '#333' } },
                p.mode === 'fill' ? ('填充 L=' + p.keepL + ' R=' + p.keepR + ' col=' + p.fillCol)
                  : p.mode === 'transparent' ? '置透明' : ('贴 ' + (p.paste && p.paste.src || '?'))),
              React.createElement('button', { onClick: () => removePlan(i), style: Object.assign({}, btnStyle, { padding: '1px 8px', color: '#e5484d' }) }, '✕'),
            )),
      ),
      React.createElement('div', { style: { padding: '8px 12px', borderTop: '1px solid #d8dce3' } },
        React.createElement('button', { onClick: doExportPlan, disabled: exporting, style: Object.assign({}, btnStyle, { background: '#2ba85a', borderColor: '#2ba85a', color: '#fff', width: '100%', marginBottom: '6px' }) },
          exporting ? '导出中…' : '⬇ 导出清理方案 + 脚本'),
        planMsg && React.createElement('div', { style: { color: '#1f7a3d', fontSize: '11px', fontFamily: 'ui-monospace,Menlo,monospace', wordBreak: 'break-all' } }, planMsg),
      ),
    ),
  )
}

// ---- 像素统计与填充工具 ----
function computeDensity(data, bw, bh) {
  const counts = new Map()
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a < 128) continue
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  let bgKey = -1, bgCount = 0
  for (const [k, c] of counts) { if (c > bgCount) { bgCount = c; bgKey = k } }
  const bgR = (bgKey >> 8) << 4, bgG = ((bgKey >> 4) & 0xf) << 4, bgB = (bgKey & 0xf) << 4
  const cols = new Array(bw).fill(0)
  const rows = new Array(bh).fill(0)
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const i = (y * bw + x) * 4
      const a = data[i + 3]
      if (a < 128) continue
      const dr = Math.abs(data[i] - bgR), dg = Math.abs(data[i + 1] - bgG), db = Math.abs(data[i + 2] - bgB)
      if (dr + dg + db > 120) { cols[x]++; rows[y]++ }
    }
  }
  return { cols, rows, bg: { r: bgR, g: bgG, b: bgB } }
}

function applyColumnFill(ctx2d, bw, bh, keepL, keepR, fillColRel) {
  const imgData = ctx2d.getImageData(0, 0, bw, bh)
  const d = imgData.data
  const rightFrom = bw - keepR
  for (let y = 0; y < bh; y++) {
    const rowBase = y * bw * 4
    const srcIdx = rowBase + fillColRel * 4
    const sr = d[srcIdx], sg = d[srcIdx + 1], sb = d[srcIdx + 2], sa = d[srcIdx + 3]
    for (let x = keepL; x < rightFrom; x++) {
      const dst = rowBase + x * 4
      d[dst] = sr; d[dst + 1] = sg; d[dst + 2] = sb; d[dst + 3] = sa
    }
  }
  ctx2d.putImageData(imgData, 0, 0)
}

function applyTransparent(ctx2d, bw, bh) {
  const imgData = ctx2d.getImageData(0, 0, bw, bh)
  const d = imgData.data
  for (let i = 3; i < d.length; i += 4) d[i] = 0
  ctx2d.putImageData(imgData, 0, 0)
}