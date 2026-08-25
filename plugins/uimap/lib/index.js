// @amayui/uimap — Host half.
// Registers the model-visible `amayui_uimap` tool, the `/dsh-uimap/<png>` image
// route, and the `/dsh-uimap/api/*` JSON endpoints the browser card calls
// (state / scan / export / clean-list / clean-export). This is a static bundle
// (survives restart), so the client↔host bridge is plain HTTP instead of the
// dynamic-package `harness.handle`/`host.call` pairing.
//
// Service acquisition: `tools`, `fs`, `shell`, `webServer` are declared in
// `inject` so Cordis parks this plugin until all four are mounted. `webServer`
// comes from the `dsh-web-app` bundle, which loads AFTER the base services
// (`tools`/`fs`/`shell`), so it MUST be injected — reading `ctx.get('webServer')`
// at apply time (without inject) returns undefined while only base is up, which
// silently skips the image/API route. `sandboxPolicy` is optional, read lazily.
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'amayui-uimap'
export const inject = ['tools', 'fs', 'shell', 'webServer']

export function apply(ctx) {
  const fs = ctx.fs
  const shell = ctx.shell
  const webServer = ctx.webServer
  const getPolicy = () => ctx.get('sandboxPolicy')

  let root = undefined
  let latest = null
  let py = 'python3'
  let pyChecked = false

  function workspaceRoot(exec) {
    try {
      if (exec && exec.agent && exec.agent.session) {
        const s = exec.agent.session
        if (s.meta && s.meta.cwd) return s.meta.cwd
        if (s.header && s.header.cwd) return s.header.cwd
      }
    } catch (e) { /* ignore */ }
    const policy = getPolicy()
    if (policy && policy.workspaceRoot) return policy.workspaceRoot
    return undefined
  }

  function quote(s) {
    return "'" + String(s).replace(/'/g, "'\\''") + "'"
  }

  async function resolvePython(sh, base) {
    if (pyChecked) return py
    const policy = getPolicy()
    const workdir = base || root || (policy && policy.workspaceRoot)
    for (const cand of ['python3', 'python']) {
      try {
        const spec = sh.resolve({ command: cand + ' --version', workdir, timeoutMs: 15000, stdoutMaxBytes: 4096 })
        const r = await sh.run(spec)
        if (r.exitCode === 0) { py = cand; pyChecked = true; return py }
      } catch (e) { /* try next candidate */ }
    }
    throw new Error('未找到 Python 解释器（python3/python），无法运行 scripts/uimap/*.py')
  }

  // 公共扫描函数：执行 scan_blocks.py 并更新 latest（工具 execute 与 API uimap-scan 共用）
  async function runScan(png, alpha, minPx, base, signal) {
    if (!shell) throw new Error('shell 服务不可用，无法运行 scan_blocks.py')
    if (!fs) throw new Error('fs 服务不可用，无法读写扫描结果')
    const interpreter = await resolvePython(shell, base)
    const tmpJson = '.tmp/uimap_scan_tmp.json'
    const cmd = interpreter + ' scripts/uimap/scan_blocks.py ' + quote(png) + ' --alpha ' + alpha + ' --min-px ' + minPx + ' --json-only ' + quote(tmpJson)
    const spec = shell.resolve({ command: cmd, workdir: base, timeoutMs: 120000, stdoutMaxBytes: 16384 })
    const result = await shell.run(spec)
    if (result.exitCode !== 0) {
      const stderr = result.stderr && result.stderr.text ? result.stderr.text : '(无 stderr)'
      throw new Error('scan_blocks.py 失败 (exit ' + result.exitCode + '): ' + stderr)
    }
    const target = await fs.resolve(tmpJson, { cwd: base })
    const text = await fs.readText(target, signal)
    const data = JSON.parse(text)
    latest = {
      rel: png,
      png: data.png,
      size: data.size,
      alpha: data.alpha,
      min_px: data.min_px,
      blocks: data.blocks,
      imageUrl: '/dsh-uimap/' + png,
    }
    return latest
  }

  function formatResult(value) {
    const name = (value.png || 'map').replace(/\.png$/i, '')
    return [
      '已扫描：' + value.png + '（' + value.size.w + '×' + value.size.h + '，alpha≥' + value.alpha + '，min_px≥' + value.min_px + '）→ ' + value.block_count + ' 个连通块。',
      '',
      '交互地图已在本工具卡片中生成，可点「🖥 全屏选择」打开大画布：',
      '· 图上块分级画框（橙≥100k / 蓝≥3k / 绿≥500 / 灰更小），悬停看详情；',
      '· 点击选中/取消，选中块显示金色蒙层；',
      '· 选中后点「🧹 清理工作台」对每块做密度统计 + 选列即时预览；',
      '',
      '选好后点「导出选中 JSON」或「导出清理方案」。',
    ].join('\n')
  }

  function defineAmayuiUimapTool() {
    return defineTool({
      name: 'amayui_uimap',
      description: '扫描天結 UI 图片（PNG）的 alpha 连通块并生成交互式 UI 元素地图。调用后：1) 用 scan_blocks.py 全图扫描连通块并记住结果；2) 在本工具结果卡片中生成交互入口，点「🖥 全屏选择」打开全屏模态（图上块分级画框、悬停看详情、点击选中/取消并显示金色蒙层、可缩放，右侧清单可过滤/勾选）；3) 选中块后可进「🧹 清理工作台」：逐块统计行列笔画密度直方图、点击选列/选行即时预览列填充与行填充（保留上下左右 N px 复制选定列/行，四边保留可拖拽独立配置）、支持置透明与跨图贴底图预览，导出清理方案 JSON + clean_fill.py 调用脚本到 .tmp/。替代「猜坐标 → cc_scan 逐点查询」的人工定位循环与手工构造清理命令。用户要求定位 UI 元素坐标/按钮区域/待清理文字块/生成清理脚本时使用；无 OCR、无 AI，纯几何连通块扫描。',
      parameters: {
        png: { type: 'string', required: true, description: 'UI 图片 PNG 路径：相对工程根（如 res/SO020.png）或绝对路径' },
        alpha: { type: 'integer', description: 'alpha 前景阈值，默认 128（实体范围）；要含羽化边缘用 1' },
        min_px: { type: 'integer', description: '过滤小于该像素数的连通块，默认 300' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            png: { type: 'string', required: true },
            size: {
              type: 'object', required: true, additionalProperties: false,
              properties: { w: { type: 'integer', required: true }, h: { type: 'integer', required: true } },
            },
            alpha: { type: 'integer', required: true },
            min_px: { type: 'integer', required: true },
            block_count: { type: 'integer', required: true },
            imageUrl: { type: 'string', required: true },
            note: { type: 'string' },
          },
        },
        render: (args, value) => [{ type: 'text', text: formatResult(value) }],
      },
      timeoutMs: 120000,
      async execute(args, exec) {
        const png = String(args.png || '').trim()
        if (!png) throw new Error('png 参数必填')
        if (png.includes('..')) throw new Error('png 路径不能包含 ..')
        const alpha = args.alpha === undefined ? 128 : Math.max(0, Math.min(255, args.alpha | 0))
        const minPx = args.min_px === undefined ? 300 : Math.max(1, args.min_px | 0)
        const base = workspaceRoot(exec)
        if (!base) throw new Error('无法确定工程根目录')
        root = base
        const s = await runScan(png, alpha, minPx, base, exec.signal)
        return {
          png: s.png,
          size: s.size,
          alpha: s.alpha,
          min_px: s.min_px,
          block_count: s.blocks.length,
          imageUrl: s.imageUrl,
          note: '交互地图已生成，请在工具卡片中点「全屏选择」查看并点选元素。',
        }
      },
    })
  }

  // ---- /dsh-uimap/api/* JSON endpoint handlers (client calls via fetch) ----
  async function apiState() {
    if (!latest) return { ready: false }
    return {
      ready: true,
      rel: latest.rel,
      png: latest.png,
      size: latest.size,
      alpha: latest.alpha,
      min_px: latest.min_px,
      blocks: latest.blocks,
      imageUrl: latest.imageUrl,
    }
  }

  async function apiScan(args) {
    try {
      const policy = getPolicy()
      const base = root || (policy && policy.workspaceRoot)
      if (!base) return { ok: false, error: '无法确定工程根目录' }
      const input = args || {}
      let png = String(input.png || '').trim()
      if (!png) png = latest ? latest.rel : ''
      if (!png) return { ok: false, error: '未提供 png 且尚未扫描过，请在模态输入框中填写路径' }
      if (png.includes('..')) return { ok: false, error: 'png 路径不能包含 ..' }
      const alpha = input.alpha !== undefined ? Math.max(0, Math.min(255, input.alpha | 0)) : 128
      const minPx = input.min_px !== undefined ? Math.max(1, input.min_px | 0) : 300
      root = base
      const s = await runScan(png, alpha, minPx, base)
      return {
        ok: true,
        scan: { ready: true, rel: s.rel, png: s.png, size: s.size, alpha: s.alpha, min_px: s.min_px, blocks: s.blocks, imageUrl: s.imageUrl },
      }
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) }
    }
  }

  async function apiExport(args) {
    if (!latest) return { ok: false, error: '尚未扫描' }
    if (!fs) return { ok: false, error: 'fs 服务不可用' }
    const input = args || {}
    const raw = input.indices
    const indices = Array.isArray(raw) ? raw.map(Number).filter((n) => Number.isInteger(n)) : []
    const byIndex = {}
    for (const b of latest.blocks) byIndex[b.index] = b
    const components = indices.map((i) => byIndex[i]).filter(Boolean)
    if (!components.length) return { ok: false, error: '没有有效的选中块' }
    const out = {
      png: latest.png,
      size: latest.size,
      alpha: latest.alpha,
      min_px: latest.min_px,
      selected_count: components.length,
      components: components.map((b) => ({ index: b.index, x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, w: b.w, h: b.h, px: b.px })),
    }
    const policy = getPolicy()
    const base = root || (policy && policy.workspaceRoot)
    if (!base) return { ok: false, error: '无法确定工程根目录' }
    const name = (latest.png.replace(/\.png$/i, '') || 'map') + '_selected.json'
    const rel = '.tmp/' + name
    const target = await fs.resolve(rel, { cwd: base })
    await fs.writeText(target, JSON.stringify(out, null, 2), undefined, undefined, policy && policy.resolve())
    return { ok: true, path: rel, selected_count: components.length }
  }

  async function apiCleanList() {
    if (!latest) return { ok: false, error: '尚未扫描' }
    if (!fs) return { ok: false, error: 'fs 服务不可用' }
    const policy = getPolicy()
    const base = root || (policy && policy.workspaceRoot)
    if (!base) return { ok: false, error: '无法确定工程根目录' }
    const name = (latest.png.replace(/\.png$/i, '') || 'map')
    for (const rel of ['.tmp/' + name + '_groups.json', '.tmp/' + name + '_selected.json']) {
      try {
        const target = await fs.resolve(rel, { cwd: base })
        const info = await fs.stat(target)
        if (!info || info.type !== 'file') continue
        const text = await fs.readText(target)
        const data = JSON.parse(text)
        if (data && Array.isArray(data.groups)) {
          const groups = data.groups
            .filter((g) => g && Array.isArray(g.indices) && g.indices.length)
            .map((g) => ({ name: String(g.name || '组'), indices: g.indices.map(Number).filter((n) => Number.isInteger(n)) }))
            .filter((g) => g.indices.length)
          if (groups.length) return { ok: true, source: rel, groups }
        } else if (data && Array.isArray(data.components)) {
          const indices = data.components.map((c) => c.index).filter((n) => Number.isInteger(n))
          if (indices.length) return { ok: true, source: rel, indices }
        }
      } catch (e) { /* try next */ }
    }
    return { ok: false, error: '未找到 ' + name + '_groups.json / _selected.json' }
  }

  async function apiCleanExport(args) {
    if (!latest) return { ok: false, error: '尚未扫描' }
    if (!fs) return { ok: false, error: 'fs 服务不可用' }
    const input = args || {}
    const blocks = Array.isArray(input.blocks) ? input.blocks : []
    if (!blocks.length) return { ok: false, error: '方案为空' }
    const policy = getPolicy()
    const base = root || (policy && policy.workspaceRoot)
    if (!base) return { ok: false, error: '无法确定工程根目录' }
    let interpreter = py
    if (!pyChecked) {
      if (!shell) return { ok: false, error: 'shell 服务不可用，无法生成清理脚本' }
      interpreter = await resolvePython(shell, base)
    }
    const name = (latest.png.replace(/\.png$/i, '') || 'map') + '_clean'
    const jsonRel = '.tmp/' + name + '.json'
    const shRel = '.tmp/' + name + '.sh'
    const plan = { png: latest.png, size: latest.size, blocks }
    await fs.writeText(await fs.resolve(jsonRel, { cwd: base }), JSON.stringify(plan, null, 2), undefined, undefined, policy && policy.resolve())
    const lines = [
      '#!/bin/bash',
      'set -e',
      '# 天結 UI 清理方案：' + name + '（由清理工作台导出，逐块调用 scripts/uimap/clean_fill.py；解释器 ' + interpreter + '）',
      '',
    ]
    let prev = latest.rel
    blocks.forEach((b, i) => {
      const out = '.tmp/' + name + '_' + (i + 1) + '.png'
      let cmd = interpreter + ' scripts/uimap/clean_fill.py ' + quote(prev) + ' ' + quote(out) +
        ' --x0 ' + b.x0 + ' --y0 ' + b.y0 + ' --x1 ' + b.x1 + ' --y1 ' + b.y1
      if (b.mode === 'transparent') cmd += ' --transparent'
      else if (b.mode === 'paste' && b.paste && b.paste.src) {
        cmd += ' --paste-src ' + quote(b.paste.src) +
          ' --paste-x0 ' + b.paste.x0 + ' --paste-y0 ' + b.paste.y0 +
          ' --paste-x1 ' + b.paste.x1 + ' --paste-y1 ' + b.paste.y1
      } else {
        const keepL = b.keepL === undefined ? 15 : b.keepL
        const keepR = b.keepR === undefined ? keepL : b.keepR
        const keepT = b.keepT === undefined ? 0 : b.keepT
        const keepB = b.keepB === undefined ? 0 : b.keepB
        cmd += ' --keep-l ' + keepL + ' --keep-r ' + keepR + ' --keep-t ' + keepT + ' --keep-b ' + keepB
        if (b.fillAxis === 'row' && b.fillRow !== undefined) {
          cmd += ' --fill-row ' + b.fillRow
        } else {
          const fillCol = b.fillCol === undefined ? b.x0 + keepL : b.fillCol
          cmd += ' --fill-col ' + fillCol
        }
      }
      lines.push('# 块 #' + b.index + ' (' + b.w + '×' + b.h + ')')
      lines.push(cmd)
      lines.push('')
      prev = out
    })
    lines.push('echo "完成：最终清理图 = ' + prev + '"')
    await fs.writeText(await fs.resolve(shRel, { cwd: base }), lines.join('\n'), undefined, undefined, policy && policy.resolve())
    return { ok: true, jsonPath: jsonRel, scriptPath: shRel, block_count: blocks.length }
  }

  async function dispatchApi(method, args) {
    // Client sends the original dynamic-RPC names (uimap-scan / uimap-state /
    // uimap-export / uimap-clean-list / uimap-clean-export). Strip the `uimap-`
    // prefix so both the long and short forms route to the same handler.
    const m = method.startsWith('uimap-') ? method.slice(6) : method
    switch (m) {
      case 'state': return apiState()
      case 'scan': return apiScan(args)
      case 'export': return apiExport(args)
      case 'clean-list': return apiCleanList()
      case 'clean-export': return apiCleanExport(args)
      default: return { ok: false, error: 'unknown api: ' + method }
    }
  }

  // ---- route: images at /dsh-uimap/<png>, JSON at /dsh-uimap/api/<method> ----
  if (webServer) {
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/dsh-uimap',
      handler: async (req, res) => {
        try {
          const url = req.url || ''
          const q = url.indexOf('?')
          const pathname = q >= 0 ? url.slice(0, q) : url
          const rel = pathname.replace(/^\/dsh-uimap\/?/, '')
          if (rel.startsWith('api/')) {
            const method = rel.slice(4).replace(/\/$/, '')
            const body = await readJsonBody(req)
            const out = await dispatchApi(method, body)
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify(out))
            return
          }
          if (!rel || rel.includes('..')) {
            res.writeHead(400, { 'Content-Type': 'text/plain' })
            res.end('bad path')
            return
          }
          const policy = getPolicy()
          const base = policy && policy.workspaceRoot
          if (!base) {
            res.writeHead(500, { 'Content-Type': 'text/plain' })
            res.end('no workspace root')
            return
          }
          if (!fs) {
            res.writeHead(500, { 'Content-Type': 'text/plain' })
            res.end('no fs')
            return
          }
          const target = await fs.resolve(rel, { cwd: base })
          const info = await fs.stat(target)
          if (!info || info.type !== 'file') {
            res.writeHead(404, { 'Content-Type': 'text/plain' })
            res.end('not found: ' + rel)
            return
          }
          const bytes = await fs.readBytes(target, undefined, info.size || (1 << 26))
          res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(bytes.byteLength) })
          res.end(bytes)
        } catch (e) {
          try {
            res.writeHead(500, { 'Content-Type': 'text/plain' })
            res.end('uimap route error')
          } catch (_) { /* ignore */ }
        }
      },
    }))
  }

  ctx.tools.register(defineAmayuiUimapTool())
}

async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const buf = Buffer.concat(chunks)
  if (!buf.length) return {}
  try {
    return JSON.parse(buf.toString('utf8'))
  } catch {
    return {}
  }
}
