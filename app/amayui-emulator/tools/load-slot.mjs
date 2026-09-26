#!/usr/bin/env node
/**
 * load-slot.mjs —— **兼容壳**：转发到 `ops/load-from-title.mjs`。
 *
 * 2026-09-26 起读档流程被拆成两层（见 `ops/README.md`）：
 * - 原语（点击/等条件/读态/起停）在 `emu.mjs`；
 * - 用例（从哪个界面载入）在 `ops/*.mjs`，本文件当初实现的那条 = `ops/load-from-title.mjs`。
 * 本文件保留**只为不让既有文档/技能里的命令失效**，实现已不再单独一份（避免两份漂移）。
 *
 * 用法（与以前一致）：
 *   node app/amayui-emulator/tools/load-slot.mjs --instance t0103 --slot 78
 *   node .../load-slot.mjs --list
 *
 * 退出码：0 = 已载入；1 = 参数/实例/流程问题（旧版的 2「载入未发生」也归到 1）。
 */
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { listInstances } from './emu.mjs';

const argOf = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d;
};

if (process.argv.includes('--list')) {
  const all = await listInstances();
  for (const r of all) {
    console.log(`${r.live ? '●' : '○'} ${r.id} port=${r.port ?? '?'} pid=${r.pid ?? '?'} bin=${r.bin ?? '?'} gate=${r.gate ?? '?'}`);
  }
  console.log('（槽目录口径：<repo>/.tmp/instances/<id>/{overlay,base}/SAVE/SAVE<NN>.DAT）');
  process.exit(all.some((r) => r.live) ? 0 : 1);
}

const id = argOf('instance');
const slot = argOf('slot');
if (!id || slot === undefined) {
  console.error('用法：load-slot.mjs --instance <id> --slot <0..99>（或 --list）');
  process.exit(1);
}

const target = path.join(import.meta.dirname, 'ops', 'load-from-title.mjs');
const child = spawn(process.execPath, [target, '--instance', id, '--slot', String(slot), ...process.argv.slice(2).filter((a) => a.startsWith('--expect'))], {
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 1));
