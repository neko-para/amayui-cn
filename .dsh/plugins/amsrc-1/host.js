// 天結文案定位：在 src/*.txt 中搜索 `// 输入原文：…` 注释行（reflow 正文与日文存档不计入），
// 返回命中页块的完整取证信息（行号/说话人/日文原句/正文/上下文），供 amayui-script-update 评估流程直接使用，无需再跑 adv-context.js。
return {
  inject: ['fs'],
  apply(ctx) {
    const fs = ctx.get('fs')
    if (fs === undefined) return

    const COMMENT_PREFIX = '// 输入原文：'
    const PAGE_END = '// 页面结束'
    const TEXT_INSTR = /^(show-text|display-furigana|concat|end-text-line|draw-string)\b/

    // 归一化：去掉 <br> 与一切空白（含换行），使粘贴的游戏文本可与注释行对比
    function normalize(s) {
      return String(s).replace(/<br\s*\/?>/gi, '').replace(/\s+/g, '')
    }

    // 与 scripts/adv-context.js 的 parsePage 保持一致：向上找最近 // FROM:，向下收集正文到 // 页面结束
    function parsePage(lines, i) {
      const commentLine = i
      const commentText = lines[i].slice(COMMENT_PREFIX.length).trim()
      let from = 'none'
      for (let k = i - 1; k >= 0; k--) {
        const t = lines[k].trim()
        if (t.startsWith('// FROM:')) {
          from = t.replace(/^\/\/ FROM:\s*/, '')
          break
        }
        if (t.startsWith(COMMENT_PREFIX) || t === PAGE_END) break
      }
      const body = []
      let j = i + 1
      while (j < lines.length) {
        const t = lines[j].trim()
        if (TEXT_INSTR.test(t) || t === PAGE_END) {
          if (t !== PAGE_END) body.push(lines[j].trim())
          if (t === PAGE_END) {
            j++
            break
          }
          j++
        } else {
          break
        }
      }
      return { start: commentLine, end: j - 1, commentLine, commentText, from, body }
    }

    function parsePages(lines) {
      const pages = []
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].startsWith(COMMENT_PREFIX)) continue
        const page = parsePage(lines, i)
        pages.push(page)
        i = page.end
      }
      return pages
    }

    // 提取 /* 原文存档 */ 内的日文原句（与 adv-context --raw 同口径；多行存档取各 show-text 引号内容）
    function extractOriginal(lines, start) {
      let original = ''
      for (let li = start - 1; li >= 0; li--) {
        const t = lines[li].trim()
        if (t === '*/') {
          for (let li2 = li - 1; li2 >= 0; li2--) {
            if (lines[li2].includes('/* 原文存档')) {
              const inner = []
              for (let li3 = li2 + 1; li3 < li; li3++) inner.push(lines[li3].trim())
              const texts = []
              for (const l of inner) {
                const m = l.match(/^show-text\s+\d+\s+"([\s\S]*)"\s*$/)
                if (m) texts.push(m[1])
              }
              original = texts.length ? texts.join('\n') : inner.join('\n')
              break
            }
          }
          break
        }
        if (t.startsWith('// FROM:') || t.startsWith(COMMENT_PREFIX) || t === PAGE_END) break
      }
      return original
    }

    function formatResult(value) {
      const out = []
      out.push(`搜索文案：${value.query}`)
      out.push(`已扫描 ${value.scannedFiles} 个 src/*.txt（仅匹配 // 输入原文： 注释行，已忽略 <br> 与空白/换行差异）`)
      if (value.note) out.push(value.note)
      if (value.matches.length === 0) {
        out.push('未找到匹配。可尝试：')
        out.push('1. 缩短片段（取 4–10 个连续字符）；')
        out.push('2. 确认输入的是汉化译文而非日文原文；')
        out.push('3. 该句可能尚未翻译或位于 data/ 基线中（src 为开发源）。')
        return out.join('\n')
      }
      out.push(`命中 ${value.matches.length} 处${value.truncated ? '（已按 limit 截断）' : ''}：`)
      value.matches.forEach((m, i) => {
        out.push('')
        out.push(`【命中 ${i + 1}】${m.file}（脚本：${m.script}）`)
        out.push(`  行号：${m.line}（页块 ${m.blockStart}–${m.blockEnd}）`)
        out.push(`  说话人：${m.speaker}`)
        out.push(`  译文：${m.translation}`)
        if (m.original) out.push(`  日文原句：${m.original}`)
        if (m.body.length) out.push(`  正文行：${m.body.join(' / ')}`)
        if (m.neighbors.length) {
          out.push(`  上下文（前后各 ${value.neighborsRequested} 个页块）：`)
          for (const nb of m.neighbors) out.push(`    [行 ${nb.start}–${nb.end}] ${nb.speaker}：${nb.translation}`)
        }
      })
      out.push('')
      out.push('提示：上述取证信息已含说话人、日文原句、正文与上下文，评估时无需再运行 scripts/adv-context.js。')
      return out.join('\n')
    }

    harness.registerTool(ctx, harness.defineTool({
      name: 'amayui_locate_text',
      description: '在天結汉化工程 src/*.txt 中定位一段游戏译文文案并取证：只匹配 `// 输入原文：…` 注释行（reflow 正文与 /* 原文存档 */ 不计入，避免同一句命中多份），返回文件、脚本名、行号、说话人（// FROM:）、日文原句、页块行号范围、正文行与上下文页块。评估流程（amayui-script-update）第一步的定位取证可由本工具直接完成，无需再运行 adv-context.js。用户给出疑似有问题的译文片段、要求定位某句译文或评估某句翻译时使用。',
      parameters: {
        text: { type: 'string', required: true, description: '需要定位的译文片段：直接粘贴游戏内看到的文字，可含换行；内部会忽略 <br> 与空白差异' },
        neighbors: { type: 'integer', description: '目标页块前后各取几个页块作为上下文（默认 2，范围 0–10）' },
        limit: { type: 'integer', description: '最多返回的命中数（默认 20）' }
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string', required: true },
            scannedFiles: { type: 'integer', required: true },
            neighborsRequested: { type: 'integer', required: true },
            truncated: { type: 'boolean', required: true },
            note: { type: 'string' },
            matches: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  file: { type: 'string', required: true },
                  script: { type: 'string', required: true },
                  line: { type: 'integer', required: true },
                  speaker: { type: 'string', required: true },
                  translation: { type: 'string', required: true },
                  original: { type: 'string', required: true },
                  blockStart: { type: 'integer', required: true },
                  blockEnd: { type: 'integer', required: true },
                  body: { type: 'array', required: true, items: { type: 'string' } },
                  neighbors: {
                    type: 'array',
                    required: true,
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        start: { type: 'integer', required: true },
                        end: { type: 'integer', required: true },
                        speaker: { type: 'string', required: true },
                        translation: { type: 'string', required: true }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        render: (args, value) => [{ type: 'text', text: formatResult(value) }]
      },
      timeoutMs: 60000,
      async execute(args, exec) {
        const q = normalize(args.text)
        const neighbors = Math.max(0, Math.min(10, args.neighbors === undefined ? 2 : args.neighbors))
        const limit = Math.max(1, args.limit === undefined ? 20 : args.limit)
        if (q.length === 0) {
          return { query: String(args.text), scannedFiles: 0, neighborsRequested: neighbors, matches: [], truncated: false, note: '查询内容为空。' }
        }

        // 确定工程根目录：优先会话 cwd，回退 sandboxPolicy.workspaceRoot
        let root
        try {
          root = exec.agent && exec.agent.session && exec.agent.session.meta ? exec.agent.session.meta.cwd : undefined
        } catch (e) {
          root = undefined
        }
        if (!root) {
          const sp = ctx.get('sandboxPolicy')
          if (sp && sp.workspaceRoot) root = sp.workspaceRoot
        }
        if (!root) throw new Error('无法确定工程根目录（会话 cwd 与 sandboxPolicy.workspaceRoot 均不可用）')

        const srcTarget = await fs.resolve('src', { cwd: root, signal: exec.signal })
        let entries
        try {
          entries = await fs.listDir(srcTarget, exec.signal)
        } catch (e) {
          throw new Error(`无法列出 ${root}/src（请确认当前工作区是天結汉化工程）：${e.message}`)
        }

        const matches = []
        let scannedFiles = 0
        for (const entry of entries) {
          if (exec.signal.aborted) break
          if (entry.type !== 'file' || !entry.name.endsWith('.txt')) continue
          scannedFiles++
          let content
          try {
            content = await fs.readText(entry.target, exec.signal)
          } catch (e) {
            continue
          }
          const lines = content.split(/\r\n|\r|\n/)
          const pages = parsePages(lines)
          for (let p = 0; p < pages.length; p++) {
            const page = pages[p]
            if (normalize(page.commentText).includes(q)) {
              const fromIdx = Math.max(0, p - neighbors)
              const toIdx = Math.min(pages.length - 1, p + neighbors)
              const neighborList = []
              for (let k = fromIdx; k <= toIdx; k++) {
                if (k === p) continue
                const pg = pages[k]
                neighborList.push({ start: pg.start + 1, end: pg.end + 1, speaker: pg.from, translation: pg.commentText })
              }
              matches.push({
                file: `src/${entry.name}`,
                script: entry.name.slice(0, -4),
                line: page.commentLine + 1,
                speaker: page.from,
                translation: page.commentText,
                original: extractOriginal(lines, page.start),
                blockStart: page.start + 1,
                blockEnd: page.end + 1,
                body: page.body,
                neighbors: neighborList
              })
              if (matches.length >= limit) break
            }
          }
          if (matches.length >= limit) break
        }
        return {
          query: String(args.text),
          scannedFiles,
          neighborsRequested: neighbors,
          matches: matches.slice(0, limit),
          truncated: matches.length >= limit
        }
      }
    }))
  }
}
