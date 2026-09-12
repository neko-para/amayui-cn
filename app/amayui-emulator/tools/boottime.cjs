/**
 * 计时探针：启动 Electron 应用（真实主进程 + 渲染窗），轮询诊断日志里出现 `-> TITLE.BIN` 的时刻，
 * 打印"启动 → TITLE 用了多久"，然后杀掉进程。用于分辨「启动慢」与「启动卡住」。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.resolve(__dirname, '..');
const ROOT = path.resolve(APP, '..', '..');
const LOG = path.join(ROOT, '.tmp', 'amayui-emulator.log');

// 清掉旧日志，保证读到的是本次运行
try {
  fs.rmSync(LOG, { force: true });
} catch {
  /* ignore */
}

const t0 = Date.now();
const child = spawn(process.execPath, [path.join(APP, 'node_modules', 'electron', 'cli.js'), '.'], {
  cwd: APP,
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
});

let done = false;
const tick = setInterval(() => {
  let text = '';
  try {
    text = fs.readFileSync(LOG, 'utf8');
  } catch {
    return;
  }
  if (text.includes('-> TITLE.BIN')) {
    done = true;
    console.log(`\n[boot] 到达 TITLE 用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    clearInterval(tick);
    child.kill();
  }
}, 500);

setTimeout(() => {
  if (!done) {
    console.log(`\n[boot] ${((Date.now() - t0) / 1000).toFixed(1)}s 仍未到 TITLE（可疑：卡住或极慢）`);
    clearInterval(tick);
    child.kill();
  }
}, 180000);

child.on('exit', () => {
  clearInterval(tick);
  process.exit(0);
});
