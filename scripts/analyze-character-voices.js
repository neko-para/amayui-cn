// analyze-character-voices.js —— 按 speakers.json/corpus-index.json 的 id 升序，
// 逐个用 `codex exec` 子进程分析角色语气：
//   - 页数 <= limit：1 次调用，读全量语料，输出 analyses/<id>-<name>.md；
//   - 页数 >  limit：3 次随机采样调用（每次 <= limit 页）+ 1 次合并调用。
// 每次调用的最终回复经 `-o` 写入对应输出文件，stdout/stderr 记入 logs/ 独立日志。
// 工作进展记录在 status.json，并据此生成 PROGRESS.md。
//
// 用法:
//   node scripts/analyze-character-voices.js --init          # 只生成初始 PROGRESS.md
//   node scripts/analyze-character-voices.js                 # 顺序执行全部（跳过已完成）
//   node scripts/analyze-character-voices.js --only 7f       # 只处理指定角色
//   node scripts/analyze-character-voices.js --from 64       # 从某角色开始（含）
//   node scripts/analyze-character-voices.js --force --only 1
//   node scripts/analyze-character-voices.js --dry-run       # 只打印将执行的命令

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_DIR = path.join(ROOT, '.tmp', 'character-analysis');

function usage() {
  console.log(`用法: node analyze-character-voices.js [选项]
  --dir <目录>      工作目录（默认 <工程根>/.tmp/character-analysis）
  --root <工程根>   工程根目录（默认脚本上级目录）
  --only <id>       只处理指定角色（hex）
  --from <id>       从该角色开始（含，hex）
  --to <id>         到该角色结束（含，hex）
  --force           已完成也重跑
  --retries <n>     每次调用失败重试次数（默认 1）
  --dry-run         只打印将执行的命令
  --init            仅根据现有状态生成/刷新 PROGRESS.md 后退出
  --codex <path>    codex 可执行文件（默认 codex）`);
}

function parseArgs(argv) {
  const opts = {
    dir: DEFAULT_DIR, root: ROOT, only: null, from: null, to: null,
    force: false, retries: 1, dryRun: false, init: false, codex: 'codex',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') opts.dir = path.resolve(argv[++i]);
    else if (a === '--root') opts.root = path.resolve(argv[++i]);
    else if (a === '--only') opts.only = argv[++i];
    else if (a === '--from') opts.from = argv[++i];
    else if (a === '--to') opts.to = argv[++i];
    else if (a === '--force') opts.force = true;
    else if (a === '--retries') opts.retries = parseInt(argv[++i], 10);
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--init') opts.init = true;
    else if (a === '--codex') opts.codex = argv[++i];
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else { usage(); process.exit(1); }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const dir = opts.dir;
fs.mkdirSync(path.join(dir, 'analyses'), { recursive: true });
fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });

const speakers = JSON.parse(fs.readFileSync(path.join(dir, 'speakers.json'), 'utf8'));
const index = JSON.parse(fs.readFileSync(path.join(dir, 'corpus-index.json'), 'utf8'));
const limit = index.limit;

const statusPath = path.join(dir, 'status.json');
let status = {};
if (fs.existsSync(statusPath)) status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));

// ---------- 状态与进展文档 ----------
function charKey(c) {
  return c.id;
}

function ensureStatus(c) {
  const k = charKey(c);
  if (!status.byId) status.byId = {};
  if (!status.byId[k]) {
    status.byId[k] = {
      id: c.id, name: c.name, pages: c.pages,
      method: c.pages > limit ? 'sampled' : 'full',
      state: 'pending', attempts: 0, output: null, parts: [], lastError: null,
    };
  }
  return status.byId[k];
}

function saveStatus() {
  status.updatedAt = new Date().toISOString();
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2), 'utf8');
}

function renderProgress() {
  const rows = Object.values(status.byId || {})
    .sort((a, b) => parseInt(a.id, 16) - parseInt(b.id, 16))
    .map((s) => {
      const stateMark = {
        pending: '待处理', running: '分析中', done: '✅ 完成', failed: '❌ 失败',
      }[s.state] || s.state;
      const method = s.method === 'sampled' ? `${limit}×3 采样+合并` : '全量单次';
      const out = s.output ? `\`analyses/${path.basename(s.output)}\`` : '—';
      return `| ${s.id} | ${s.name} | ${s.pages} | ${s.method} | ${stateMark} | ${out} |`;
    });
  const header = [
    '# 角色语气分析工作进展（天結いキャッスルマイスター）',
    '',
    `> 更新：${new Date().toISOString()}`,
    `> 角色 ${Object.values(status.byId || {}).length} 个；顺序按 id 升序；单次分析最多 ${limit} 页，超出随机采样 3 次；none（旁白）不处理。`,
    `> 语料：\`corpus/\`、采样：\`samples/\`、分析结果：\`analyses/\`、调用日志：\`logs/\`。`,
    '',
    '| id | 名称 | 页数 | 方式 | 状态 | 输出 |',
    '|----|------|------|------|------|------|',
    ...rows,
    '',
  ];
  fs.writeFileSync(path.join(dir, 'PROGRESS.md'), header.join('\n'), 'utf8');
}

// ---------- 提示词 ----------
const DOC_SECTIONS = `输出为完整 Markdown，结构固定为以下五节（每节都要具体，引用典型台词佐证，不要空泛）：
# <id> <name>（角色语气）
## 角色信息
（语料规模：N 页 / M 文件；出场脚本示例）
## 日文表达风格
（自称/称呼、敬语与亲疏、句尾与语气助词、口头禅与惯用句、句长与节奏、情绪表达、其他特征）
## 中文译文风格
（如有译文：自称/称呼处理、语气转换、固定译词、需保持一致的表达；若无译文，写“暂无译文，翻译时按上述日文风格处理”）
## 翻译一致性注意事项
（面向后续翻译的 checklist：哪些词/句尾/称呼应统一，哪些角色特征不能丢）`;

function promptSmall(c) {
  return `你是《天結いキャッスルマイスター》(Amayui Castle Meister) 汉化工程的角色语气分析师。
请阅读语料文件：${c.corpus}
这是角色「${c.name}」(id=${c.id}) 的全部台词（共 ${c.pages} 页，${c.fileCount} 个脚本文件）。每页格式为：
  [脚本名:行号]
  日：<日文原文>
  中：<中文译文>（只有已翻译的页才有此行；未翻译页只有日文）

任务：分析该角色的说话风格与语气，产出可长期引用的角色语气文档。
${DOC_SECTIONS}
全程使用简体中文。只阅读语料、输出文档内容即可；不要执行任何修改文件或网络的 shell 命令。你的最终回复就是该文档。`;
}

function promptSample(c, s) {
  return `你是《天結いキャッスルマイスター》(Amayui Castle Meister) 汉化工程的角色语气分析师。
请阅读语料文件：${c.samples[s - 1]}
这是角色「${c.name}」(id=${c.id}) 的随机采样 ${s}/3（每份最多 ${limit} 页；角色总语料 ${c.pages} 页）。每页格式为：
  [脚本名:行号]
  日：<日文原文>
  中：<中文译文>（只有已翻译的页才有此行）

任务：基于本份采样分析该角色的说话风格与语气，产出一份**采样分析草稿 ${s}/3**。
${DOC_SECTIONS}
在文档末尾注明“（基于采样 ${s}/3，非全量语料）”。全程使用简体中文。
只阅读语料、输出文档内容即可；不要执行任何修改文件或网络的 shell 命令。你的最终回复就是该草稿。`;
}

function promptMerge(c) {
  const parts = c.samples.map((_, i) => `${path.join(dir, 'analyses', `${c.id}-${c.name}.s${i + 1}.md`)}`).join('、');
  return `你是《天結いキャッスルマイスター》(Amayui Castle Meister) 汉化工程的角色语气分析师。
角色「${c.name}」(id=${c.id}) 的三份采样分析草稿位于：
${c.samples.map((_, i) => `  ${path.join(dir, 'analyses', `${c.id}-${c.name}.s${i + 1}.md`)}`).join('\n')}
（角色总语料 ${c.pages} 页，来自随机采样 3 次。）

任务：阅读三份草稿，合并提炼为一篇完整、无重复的角色语气文档。
${DOC_SECTIONS}
覆盖三份草稿的全部要点；若草稿间冲突，以更具体、更可佐证的表述为准并在相应处注明。
全程使用简体中文。只阅读文件、输出文档内容即可；不要执行任何修改文件或网络的 shell 命令。你的最终回复就是该文档。`;
}

// ---------- codex 调用 ----------
function runCodex(prompt, outFile, logFile) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const log = fs.createWriteStream(logFile, { flags: 'a' });
    const args = ['exec', '--approve-for-me', '--ephemeral', '-o', outFile, prompt];
    if (opts.dryRun) {
      console.log(`[dry-run] ${opts.codex} ${args.map((a) => (a.length > 80 ? a.slice(0, 80) + '…' : a)).join(' ')}`);
      console.log(`          stdout/stderr -> ${logFile}`);
      resolve();
      return;
    }
    // stdin 必须 ignore：codex exec 检测到 stdin 是管道时会一直等待输入
    const child = spawn(opts.codex, args, {
      cwd: opts.root,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let errText = '';
    child.stdout?.on('data', (d) => log.write(d));
    child.stderr?.on('data', (d) => { log.write(d); errText += d; });
    child.on('error', (e) => {
      log.end();
      reject(new Error(`spawn 失败: ${e.message}`));
    });
    child.on('close', (code, signal) => {
      log.end();
      if (code === 0) resolve();
      else {
        const tail = errText ? `；stderr 尾部: ${errText.slice(-500)}` : '';
        reject(new Error(`codex 退出码 ${code}${signal ? ` (${signal})` : ''}${tail}`));
      }
    });
  });
}

function fname(c) {
  return `${c.id}-${c.name}`;
}

async function analyzeChar(c) {
  const k = charKey(c);
  const st = ensureStatus(c);
  const base = fname(c);
  const calls = [];
  if (c.pages > limit) {
    for (let s = 1; s <= c.samples.length; s++) {
      calls.push({
        prompt: promptSample(c, s),
        out: path.join(dir, 'analyses', `${base}.s${s}.md`),
        log: path.join(dir, 'logs', `${base}.s${s}.log`),
      });
    }
    calls.push({
      prompt: promptMerge(c),
      out: path.join(dir, 'analyses', `${base}.md`),
      log: path.join(dir, 'logs', `${base}.merge.log`),
    });
  } else {
    calls.push({
      prompt: promptSmall(c),
      out: path.join(dir, 'analyses', `${base}.md`),
      log: path.join(dir, 'logs', `${base}.log`),
    });
  }

  if (opts.dryRun) {
    for (const call of calls) {
      await runCodex(call.prompt, call.out, call.log);
    }
    return;
  }

  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    st.state = 'running';
    st.attempts++;
    st.lastError = null;
    st.parts = calls.map((c2) => c2.out);
    saveStatus();
    renderProgress();
    try {
      for (const call of calls) {
        console.log(`[${new Date().toISOString()}] ${k} ${c.name}: ${path.basename(call.out)} -> ${path.basename(call.log)}`);
        await runCodex(call.prompt, call.out, call.log);
      }
      st.state = 'done';
      st.output = path.join(dir, 'analyses', `${base}.md`);
      saveStatus();
      renderProgress();
      console.log(`[${new Date().toISOString()}] ${k} ${c.name}: ✅ 完成 -> ${st.output}`);
      return;
    } catch (e) {
      st.lastError = `${e.message}`;
      console.error(`[${new Date().toISOString()}] ${k} ${c.name}: 第 ${attempt + 1} 次尝试失败: ${e.message}`);
      if (attempt < opts.retries) {
        console.error(`  重试（剩余 ${opts.retries - attempt} 次）…`);
      }
    }
  }
  st.state = 'failed';
  saveStatus();
  renderProgress();
}

// ---------- 主流程 ----------
async function main() {
  const chars = speakers.characters.map((c) => ({
    ...c,
    ...(index.byId[c.id] || {}),
  }));
  let list = chars;
  if (opts.only) list = list.filter((c) => c.id === opts.only);
  else {
    if (opts.from) list = list.filter((c) => parseInt(c.id, 16) >= parseInt(opts.from, 16));
    if (opts.to) list = list.filter((c) => parseInt(c.id, 16) <= parseInt(opts.to, 16));
  }
  if (!list.length) {
    console.error('没有匹配的角色（检查 --only/--from/--to 的 hex id）。');
    process.exit(1);
  }

  for (const c of list) {
    ensureStatus(c);
  }
  if (opts.init) {
    saveStatus();
    renderProgress();
    console.log(`已生成/刷新 ${path.join(dir, 'PROGRESS.md')}（${list.length} 个角色）。`);
    return;
  }

  let done = 0, failed = 0, skipped = 0;
  for (const c of list) {
    const st = status.byId[charKey(c)];
    if (!opts.force && st.state === 'done') {
      skipped++;
      console.log(`跳过（已完成）: ${c.id} ${c.name}`);
      continue;
    }
    await analyzeChar(c);
    const s2 = status.byId[charKey(c)];
    if (s2.state === 'done') done++;
    else if (s2.state === 'failed') failed++;
  }
  console.log(`\n===== 汇总 ===== 完成 ${done} / 失败 ${failed} / 跳过 ${skipped}`);
  if (failed) {
    console.log('失败角色（可用 --only <id> --force 重跑）:');
    for (const c of list) {
      const s2 = status.byId[charKey(c)];
      if (s2.state === 'failed') console.log(`  ${s2.id} ${s2.name}: ${s2.lastError}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
