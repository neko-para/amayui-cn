// 天結 UI 元素地图（工具 A）+ 清理工作台（工具 B）Host 半：
// - 工具 amayui_uimap：shell 调 scan_blocks.py --json-only 扫描 PNG 连通块，最近一次结果存内存
// - RPC uimap-state / uimap-export / uimap-clean-export
// - webServer 路由 /dsh-uimap（无尾斜杠）
// pkg-3：Python 解释器自适应——先试 python3（macOS 约定），找不到回退 python（Windows 常见），
//        扫描命令与导出的清理脚本均使用检测到的解释器。
// pkg-4：清理导出命令新增 --keep-t/--keep-b（上下保留，四边保留）。
// pkg-5：新增 RPC uimap-clean-list——读取 .tmp/<名>_groups.json（优先）或 _selected.json，
//        返回可独立载入的块清单（清理工作台不再依赖地图选中）。
// pkg-8：新增 RPC uimap-scan——直接执行扫描（供会话头部「🔍 UI 地图」一键按钮与模态「🔄 重新扫描」
//        使用，无需 agent 触发工具卡片）；runScan 抽为公共函数供工具 execute 复用。
// pkg-10：清理导出支持行填充——方案块标记 fillAxis='row' 时生成 --fill-row <absY>（与 --fill-col 并列），
//         四边 --keep-l/r/t/b 照常输出；amayui_uimap 工具描述同步注明列/行填充。
return {
  inject: ['fs'],
  apply(ctx) {
    const fs = ctx.get('fs')
    if (fs === undefined) return
    const sandboxPolicy = ctx.get('sandboxPolicy')
    const webServer = ctx.get('webServer')

    let root = undefined
    let latest = null
    let py = 'python3'
    let pyChecked = false

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

    async function resolvePython(sh, base) {
      if (pyChecked) return py
      const workdir = base || root || (sandboxPolicy && sandboxPolicy.workspaceRoot)
      for (const cand of ['python3', 'python']) {
        try {
          const spec = sh.resolve({ command: cand + ' --version', workdir: workdir, timeoutMs: 15000, stdoutMaxBytes: 4096 })
          const r = await sh.run(spec)
          if (r.exitCode === 0) { py = cand; pyChecked = true; return py }
        } catch (e) { /* try next candidate */ }
      }
      throw new Error('未找到 Python 解释器（python3/python），无法运行 scripts/uimap/*.py')
    }

    // 公共扫描函数：执行 scan_blocks.py 并更新 latest（工具 execute 与 RPC uimap-scan 共用）
    async function runScan(png, alpha, minPx, base, signal) {
      const sh = ctx.get('shell')
      if (!sh) throw new Error('shell 服务不可用，无法运行 scan_blocks.py')
      const interpreter = await resolvePython(sh, base)
      const tmpJson = '.tmp/uimap_scan_tmp.json'
      const cmd = interpreter + ' scripts/uimap/scan_blocks.py ' + quote(png) + ' --alpha ' + alpha + ' --min-px ' + minPx + ' --json-only ' + quote(tmpJson)
      const spec = sh.resolve({ command: cmd, workdir: base, timeoutMs: 120000, stdoutMaxBytes: 16384 })
      const result = await sh.run(spec)
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
        '交互地图已在本工具卡片中生成，可点「🖥 全屏选择」打开大画布：',
        '· 图上块分级画框（橙≥100k / 蓝≥3k / 绿≥500 / 灰更小），悬停看详情；',
        '· 点击选中/取消，选中块显示金色蒙层；',
        '· 选中后点「🧹 清理工作台」对每块做密度统计 + 选列即时预览；',
        '',
        '选好后点「导出选中 JSON」或「导出清理方案」。',
      ].join('\n')
    }

    harness.registerTool(ctx, harness.defineTool({
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
    }))

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

    // 一键扫描：会话头部按钮 / 模态重新扫描（png 缺省用上次路径）
    harness.handle('uimap-scan', async (args) => {
      try {
        const base = root || (sandboxPolicy && sandboxPolicy.workspaceRoot)
        if (!base) return { ok: false, error: '无法确定工程根目录' }
        let png = String((args && args.png) || '').trim()
        if (!png) png = latest ? latest.rel : ''
        if (!png) return { ok: false, error: '未提供 png 且尚未扫描过，请在模态输入框中填写路径' }
        if (png.includes('..')) return { ok: false, error: 'png 路径不能包含 ..' }
        const alpha = args && args.alpha !== undefined ? Math.max(0, Math.min(255, args.alpha | 0)) : 128
        const minPx = args && args.min_px !== undefined ? Math.max(1, args.min_px | 0) : 300
        root = base
        const s = await runScan(png, alpha, minPx, base)
        return {
          ok: true,
          scan: { ready: true, rel: s.rel, png: s.png, size: s.size, alpha: s.alpha, min_px: s.min_px, blocks: s.blocks, imageUrl: s.imageUrl },
        }
      } catch (e) {
        return { ok: false, error: String(e && e.message || e) }
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

    // 清理工作台独立块清单：优先 .tmp/<名>_groups.json，回退 _selected.json
    harness.handle('uimap-clean-list', async () => {
      if (!latest) return { ok: false, error: '尚未扫描' }
      const base = root || (sandboxPolicy && sandboxPolicy.workspaceRoot)
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
    })

    // 清理方案导出：keepL/keepR/keepT/keepB 独立；写方案 JSON + 生成 clean_fill.py 链式脚本
    harness.handle('uimap-clean-export', async (args) => {
      if (!latest) return { ok: false, error: '尚未扫描' }
      const blocks = Array.isArray(args && args.blocks) ? args.blocks : []
      if (!blocks.length) return { ok: false, error: '方案为空' }
      const base = root || (sandboxPolicy && sandboxPolicy.workspaceRoot)
      if (!base) return { ok: false, error: '无法确定工程根目录' }
      const policy = sandboxPolicy ? sandboxPolicy.resolve() : undefined
      const sh = ctx.get('shell')
      let interpreter = py
      if (!pyChecked) {
        if (!sh) throw new Error('shell 服务不可用，无法生成清理脚本')
        interpreter = await resolvePython(sh, base)
      }
      const name = (latest.png.replace(/\.png$/i, '') || 'map') + '_clean'
      const jsonRel = '.tmp/' + name + '.json'
      const shRel = '.tmp/' + name + '.sh'
      const plan = { png: latest.png, size: latest.size, blocks }
      await fs.writeText(await fs.resolve(jsonRel, { cwd: base }), JSON.stringify(plan, null, 2), undefined, undefined, policy)
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
      await fs.writeText(await fs.resolve(shRel, { cwd: base }), lines.join('\n'), undefined, undefined, policy)
      return { ok: true, jsonPath: jsonRel, scriptPath: shRel, block_count: blocks.length }
    })
  },
}
