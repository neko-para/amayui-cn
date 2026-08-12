// batch-run.js —— 通用批量任务执行器（batch-task-runner 技能自带）
//
// 读取 tasks.json + PROMPT 模板，按顺序用 codex exec 子进程执行每个任务：
//   - 每个任务：codex exec --approve-for-me --ephemeral -o <output> <渲染后的提示词>
//   - stdout/stderr 追加到 logs/<id>.log；状态写入 status.json，并刷新 PROGRESS.md
//
// tasks.json 格式:
//   { "tasks": [ { "id": "...", "input": "...", "output": "...", ...任意字段 } ] }
// PROMPT 模板用 {{字段名}} 占位符（大小写不敏感），从任务对象取值。
//
// 用法:
//   node batch-run.js --tasks tasks.json --prompt PROMPT.md [--dir <工作目录>]
//     [--only <id>] [--from <id>] [--to <id>] [--force] [--retries <n>]
//     [--dry-run] [--init] [--codex <可执行文件>]

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function usage() {
  console.log(`用法: node batch-run.js --tasks <tasks.json> --prompt <PROMPT.md> [选项]
  --tasks <文件>    任务清单 JSON（必需）：{ "tasks": [ { id, input, output, ... } ] }
  --prompt <文件>   PROMPT 模板（必需），支持 {{字段名}} 占位符
  --dir <目录>      工作目录（默认 tasks 文件所在目录）
  --only <id>       只执行指定任务
  --from <id>       从该任务开始（含）
  --to <id>         到该任务结束（含）
  --force           已完成也重跑
  --retries <n>     每次调用失败重试次数（默认 1）
  --dry-run         只打印将执行的命令，不真正调用
  --init            仅生成初始 PROGRESS.md 后退出
  --codex <path>    codex 可执行文件（默认 codex）`);
}

function parseArgs(argv) {
  const opts = {
    tasks: null, prompt: null, dir: null, only: null, from: null, to: null,
    force: false, retries: 1, dryRun: false, init: false, codex: 'codex',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tasks') opts.tasks = path.resolve(argv[++i]);
    else if (a === '--prompt') opts.prompt = path.resolve(argv[++i]);
    else if (a === '--dir') opts.dir = path.resolve(argv[++i]);
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
  if (!opts.tasks || !opts.prompt) { usage(); process.exit(1); }
  if (!opts.dir) opts.dir = path.dirname(opts.tasks);
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const workDir = opts.dir;
fs.mkdirSync(path.join(workDir, 'logs'), { recursive: true });

const tasksDef = JSON.parse(fs.readFileSync(opts.tasks, 'utf8'));
const tasks = tasksDef.tasks;
if (!Array.isArray(tasks) || tasks.length === 0) {
  console.error('tasks.json 必须包含非空 tasks 数组');
  process.exit(1);
}
const template = fs.readFileSync(opts.prompt, 'utf8');

const statusPath = path.join(workDir, 'status.json');
let status = fs.existsSync(statusPath) ? JSON.parse(fs.readFileSync(statusPath, 'utf8')) : {};
if (!status.byId) status.byId = {};

function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderPrompt(t) {
  let p = template;
  for (const [k, v] of Object.entries(t)) {
    const val = typeof v === 'string' ? v : JSON.stringify(v);
    p = p.replace(new RegExp(`\\{\\{\\s*${escRe(k)}\\s*\\}\\}`, 'gi'), val);
  }
  return p;
}

function ensureStatus(t) {
  if (!status.byId[t.id]) {
    status.byId[t.id] = {
      id: t.id, state: 'pending', attempts: 0, output: t.output || null,
      lastError: null,
    };
  }
  return status.byId[t.id];
}

function saveStatus() {
  status.updatedAt = new Date().toISOString();
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2), 'utf8');
}

function renderProgress() {
  const rows = tasks.map((t) => {
    const s = status.byId[t.id] || { state: 'pending', output: t.output };
    const mark = { pending: '待处理', running: '执行中', done: '✅ 完成', failed: '❌ 失败' }[s.state] || s.state;
    const out = s.output ? `\`${path.basename(s.output)}\`` : '—';
    return `| ${t.id} | ${mark} | ${out} |`;
  });
  const doc = [
    `# 批量任务进展（${path.basename(workDir)}）`,
    '',
    `> 更新：${new Date().toISOString()}`,
    `> 任务 ${tasks.length} 个，按 tasks.json 顺序执行；单任务 = 一次 codex exec 调用。`,
    `> 输出：\`outputs/\`，日志：\`logs/\`，模板：\`PROMPT.md\`。`,
    '',
    '| id | 状态 | 输出 |',
    '|----|------|------|',
    ...rows,
    '',
  ];
  fs.writeFileSync(path.join(workDir, 'PROGRESS.md'), doc.join('\n'), 'utf8');
}

function runCodex(prompt, outFile, logFile) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const log = fs.createWriteStream(logFile, { flags: 'a' });
    const args = ['exec', '--approve-for-me', '--ephemeral', '-o', outFile, prompt];
    if (opts.dryRun) {
      console.log(`[dry-run] ${opts.codex} ${args.map((a) => (a.length > 90 ? a.slice(0, 90) + '…' : a)).join(' ')}`);
      console.log(`          stdout/stderr -> ${logFile}`);
      log.end();
      resolve();
      return;
    }
    // stdin 必须 ignore：codex exec 检测到 stdin 是管道时会一直等待输入
    const child = spawn(opts.codex, args, {
      cwd: ROOT,
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

async function execTask(t) {
  const st = ensureStatus(t);
  const prompt = renderPrompt(t);
  const outFile = path.resolve(workDir, t.output || `outputs/${t.id}.md`);
  const logFile = path.join(workDir, 'logs', `${t.id}.log`);

  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    st.state = 'running';
    st.attempts++;
    st.lastError = null;
    saveStatus();
    renderProgress();
    try {
      console.log(`[${new Date().toISOString()}] ${t.id} -> ${path.basename(outFile)}`);
      await runCodex(prompt, outFile, logFile);
      st.state = 'done';
      st.output = outFile;
      saveStatus();
      renderProgress();
      console.log(`[${new Date().toISOString()}] ${t.id}: ✅ 完成 -> ${outFile}`);
      return;
    } catch (e) {
      st.lastError = `${e.message}`;
      console.error(`[${new Date().toISOString()}] ${t.id}: 第 ${attempt + 1} 次尝试失败: ${e.message}`);
      if (attempt < opts.retries) console.error(`  重试（剩余 ${opts.retries - attempt} 次）…`);
    }
  }
  st.state = 'failed';
  saveStatus();
  renderProgress();
}

async function main() {
  let list = tasks;
  if (opts.only) list = list.filter((t) => t.id === opts.only);
  else {
    if (opts.from) list = list.filter((t) => t.id >= opts.from);
    if (opts.to) list = list.filter((t) => t.id <= opts.to);
  }
  if (!list.length) {
    console.error('没有匹配的任务（检查 --only/--from/--to）。');
    process.exit(1);
  }
  for (const t of list) ensureStatus(t);
  if (opts.init) {
    saveStatus();
    renderProgress();
    console.log(`已生成/刷新 ${path.join(workDir, 'PROGRESS.md')}（${list.length} 个任务）。`);
    return;
  }

  let done = 0, failed = 0, skipped = 0;
  for (const t of list) {
    const st = status.byId[t.id];
    if (!opts.force && st.state === 'done') {
      skipped++;
      console.log(`跳过（已完成）: ${t.id}`);
      continue;
    }
    await execTask(t);
    if (status.byId[t.id].state === 'done') done++;
    else if (status.byId[t.id].state === 'failed') failed++;
  }
  console.log(`\n===== 汇总 ===== 完成 ${done} / 失败 ${failed} / 跳过 ${skipped}`);
  if (failed) {
    console.log('失败任务（可用 --only <id> --force 重跑）:');
    for (const t of list) {
      const s = status.byId[t.id];
      if (s.state === 'failed') console.log(`  ${s.id}: ${s.lastError}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
