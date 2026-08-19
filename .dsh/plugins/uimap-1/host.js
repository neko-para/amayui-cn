// 天結 UI 元素地图（工具 A 直接形态）Host 半：
// - 工具 amayui_uimap：shell 调 scan_blocks.py --json-only 扫描 PNG 连通块，最近一次结果存内存
// - RPC uimap-state：Client 拉取最近一次扫描（blocks + 图片 URL）
// - RPC uimap-export：Client 提交选中块 index 清单 → 直写 .tmp/<名>_selected.json
// - webServer 路由 /dsh-uimap（无尾斜杠；带尾斜杠会导致 match 拼出 /dsh-uimap// 永不命中）
return {
  inject: ['fs'],
  apply(ctx) {
    const fs = ctx.get('fs')
    if (fs === undefined) return
    const sandboxPolicy = ctx.get('sandboxPolicy')
    const webServer = ctx.get('webServer')

    let root = undefined
    let latest = null // { rel, png, size, alpha, min_px, blocks, imageUrl }

    function workspaceRoot(exec) {
      try {
        if (exec && exec.agent && exec.agent.session && exec.agent.session.meta && exec.agent.session.meta.cwd) {
          return exec.agent.session.meta.cwd
        }
      } catch (e) { /* ignore */ }
      if (sandboxPolicy && sandboxPolicy.workspaceRoot) return sandboxPolicy.workspaceRoot
      return undefined
    }

    function quote(s) {
      return "'" + String(s).replace(/'/g, "'\\''") + "'"
    }

    // ---- 图片直出路由：/dsh-uimap/<相对路径> ----
    // 注意：register path 不带尾斜杠；match 逻辑是 pathname.startsWith(prefix + '/')
    if (webServer) {
      ctx.effect(() => webServer.register({
        kind: 'prefix',
        path: '/dsh-uimap',
        handler: async (req, res) => {
          try {
            const url = req.url || ''
            const q = url.indexOf('?')
            const pathname = q >= 0 ? url.slice(0, q) : url
            let rel = pathname.replace(/^\/dsh-uimap\/?/, '')
            if (!rel || rel.includes('..')) {
              res.writeHead(400, { 'Content-Type': 'text/plain' })
              res.end('bad path')
              return
            }
            const base = sandboxPolicy && sandboxPolicy.workspaceRoot
            if (!base) {
              res.writeHead(500, { 'Content-Type': 'text/plain' })
              res.end('no workspace root')
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

    function formatResult(value) {
      const name = (value.png || 'map').replace(/\.png$/i, '')
      return [
        '已扫描：' + value.png + '（' + value.size.w + '×' + value.size.h + '，alpha≥' + value.alpha + '，min_px≥' + value.min_px + '）→ ' + value.block_count + ' 个连通块。',
        '',
        '交互地图已在本插件 Run 卡片中生成：',
        '· 图上块分级画框（橙≥100k / 蓝≥3k / 绿≥500 / 灰更小），悬停看详情，点击选中/取消（金色加粗框）；',
        '· 右侧清单按像素数排序，可勾选、可「只显示选中」、可调最小面积过滤；',
        '· 画布可缩放（− / + / 适应宽度）。',
        '',
        '选好后点「导出选中 JSON」→ 文件写入 .tmp/' + name + '_selected.json，直接读取该文件即可继续处理。',
      ].join('\n')
    }

    harness.registerTool(ctx, harness.defineTool({
      name: 'amayui_uimap',
      description: '扫描天結 UI 图片（PNG）的 alpha 连通块并生成交互式 UI 元素地图。调用后：1) 用 scan_blocks.py 全图扫描连通块并记住结果；2) 在本插件 Run 卡片中渲染可交互地图（图上块分级画框、悬停看详情、点击选中/取消、可缩放，右侧清单可过滤/勾选）；3) 用户选好后点「导出选中 JSON」，Host 把清单直写 .tmp/<名>_selected.json 并返回路径。替代「猜坐标 → cc_scan 逐点查询」的人工定位循环，无需再生成 HTML 文件手动打开。用户要求定位 UI 元素坐标/按钮区域/待清理文字块时使用；无 OCR、无 AI，纯几何连通块扫描。',
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
        if (!base) throw new Error('无法确定工程根目录（会话 cwd 与 sandboxPolicy.workspaceRoot 均不可用）')
        root = base
        const sh = ctx.get('shell')
        if (!sh) throw new Error('shell 服务不可用，无法运行 scan_blocks.py')
        const tmpJson = '.tmp/uimap_scan_tmp.json'
        const cmd = 'python3 scripts/uimap/scan_blocks.py ' + quote(png) + ' --alpha ' + alpha + ' --min-px ' + minPx + ' --json-only ' + quote(tmpJson)
        const spec = sh.resolve({ command: cmd, workdir: base, timeoutMs: 120000, stdoutMaxBytes: 16384 })
        const result = await sh.run(spec)
        if (result.exitCode !== 0) {
          const stderr = result.stderr && result.stderr.text ? result.stderr.text : '(无 stderr)'
          throw new Error('scan_blocks.py 失败 (exit ' + result.exitCode + '): ' + stderr)
        }
        const target = await fs.resolve(tmpJson, { cwd: base })
        const text = await fs.readText(target, exec.signal)
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
        return {
          png: data.png,
          size: data.size,
          alpha: data.alpha,
          min_px: data.min_px,
          block_count: data.blocks.length,
          imageUrl: latest.imageUrl,
          note: '交互地图已生成，请在 Run 卡片中查看并点选元素。',
        }
      },
    }))

    // ---- Client→Host RPC ----
    harness.handle('uimap-state', async () => {
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
    })

    harness.handle('uimap-export', async (args) => {
      if (!latest) return { ok: false, error: '尚未扫描' }
      const raw = args && args.indices
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
      const base = root || (sandboxPolicy && sandboxPolicy.workspaceRoot)
      if (!base) return { ok: false, error: '无法确定工程根目录' }
      const name = (latest.png.replace(/\.png$/i, '') || 'map') + '_selected.json'
      const rel = '.tmp/' + name
      const target = await fs.resolve(rel, { cwd: base })
      const policy = sandboxPolicy ? sandboxPolicy.resolve() : undefined
      await fs.writeText(target, JSON.stringify(out, null, 2), undefined, undefined, policy)
      return { ok: true, path: rel, selected_count: components.length }
    })
  },
}
