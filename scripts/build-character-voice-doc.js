// build-character-voice-doc.js —— 把 .tmp/character-analysis/analyses/ 下
// 全部角色语气分析按 id 升序合并为 docs/keywords-角色语气.md（供翻译时引用）。
//
// 用法:
//   node scripts/build-character-voice-doc.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const dir = path.join(ROOT, '.tmp', 'character-analysis');
const outPath = path.join(ROOT, 'docs', 'keywords-角色语气.md');

const status = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
const speakers = JSON.parse(fs.readFileSync(path.join(dir, 'speakers.json'), 'utf8'));
const index = JSON.parse(fs.readFileSync(path.join(dir, 'corpus-index.json'), 'utf8'));

const ids = Object.keys(status.byId)
  .sort((a, b) => parseInt(a, 16) - parseInt(b, 16))
  .filter((id) => status.byId[id].state === 'done');

const toc = [];
const bodies = [];
for (const id of ids) {
  const st = status.byId[id];
  const md = fs.readFileSync(st.output, 'utf8');
  const anchor = `${id}-${st.name}角色语气`.toLowerCase().replace(/[^\w\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  toc.push(`- [${id} ${st.name}（${st.pages} 页）](#${anchor})`);
  bodies.push(md.trim());
}

const header = `# 角色语气（天結いキャッスルマイスター）

> 更新：${new Date().toISOString()}
> 用途：翻译/校对台词时保持角色语气一致；每个角色一份语气文档，含日文原文风格与中文译文风格（如已有译文）。
> 来源：\`src/*.txt\` 中 \`// FROM: <id> <名称>\` 标注的说话人，按 \`scripts/list-speakers.js\` + \`scripts/extract-speaker-corpus.js\` 提取全部台词（日文原文 + 中文译文）。
> 规则：单次分析最多 500 页；页数 >500 的角色按固定种子随机采样 3 次后合并；旁白（none）不在此文档。
> 全量语料与分角色详细文档位于 \`.tmp/character-analysis/\`（corpus / samples / analyses / logs），本文件为汇总版。

## 目录

${toc.join('\n')}

---

${bodies.join('\n\n---\n\n')}
`;

fs.writeFileSync(outPath, header, 'utf8');
console.log(`已生成 ${outPath}（${ids.length} 个角色，${(Buffer.byteLength(header) / 1024 / 1024).toFixed(2)} MB）`);
