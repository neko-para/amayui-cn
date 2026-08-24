// @amayui/html-preview-card — Host half.
// Registers the model-visible `preview_html` tool. The HTML is passed as a tool
// argument; the browser card reads it directly from the call args, so no host
// memory or RPC is needed and the card survives replay/reload.
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'html-preview-card'
export const inject = ['tools']

function extractTitle(html, fallback) {
  if (fallback && String(fallback).trim()) return String(fallback).trim()
  const m = String(html).match(/<title[^>]*>([^<]*)<\/title>/i)
  if (m && m[1] && m[1].trim()) return m[1].trim()
  return 'HTML 预览'
}

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'preview_html',
    description:
      '在对话内生成并预览一段 HTML（内嵌 iframe 卡片 + 可展开全屏模态）。' +
      '调用后本工具结果卡片会用 iframe(srcdoc) 实时渲染传入的 html，卡片顶部标题行可点击，' +
      '以全屏模态打开完整预览。适合替代「写临时 html 文件再手动打开」来预览界面 HTML —— ' +
      '例如 amayui-ui-text-render 渲染的图片文字叠加预览。' +
      'HTML 请尽量自包含：内嵌图片请用 base64 data URI（相对路径图片在 iframe 中不会加载）；' +
      '如依赖脚本请传 allowScripts。',
    parameters: {
      html: {
        type: 'string',
        required: true,
        description: '要预览的完整 HTML 字符串（可为 <html> 文档或片段；缺 <html> 时客户端自动补全 body）。',
      },
      title: {
        type: 'string',
        description: '卡片/模态标题；缺省自动取文档 <title>，再缺省为 "HTML 预览"。',
      },
      height: {
        type: 'integer',
        description: '卡片内嵌预览高度 px（默认 300）。',
      },
      allowScripts: {
        type: 'boolean',
        description: '是否允许执行内嵌脚本（默认 false；纯 HTML/CSS 预览无需开启）。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          title: { type: 'string', required: true },
          note: { type: 'string' },
        },
      },
      render: (args, value) => [{ type: 'text', text: value.note || 'HTML 预览卡片已生成。' }],
    },
    timeoutMs: 30000,
    async execute(args) {
      const html = String(args.html || '')
      if (!html.trim()) throw new Error('html 参数必填')
      if (html.length > 500000) throw new Error('html 过长（>500KB），请精简或分段预览')
      const title = extractTitle(html, args.title)
      return {
        ok: true,
        title,
        note: 'HTML 预览卡片已生成：点击卡片标题行可在模态中展开完整预览。',
      }
    },
  }))
}
