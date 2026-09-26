#!/usr/bin/env node
/**
 * ops/load-from-title.mjs —— **用例：从 TITLE（标题画面）的「Load Data」载入真机存档槽 N**。
 *
 * 前置：实例活着且带渲染页（`emu.mjs reset --instance <id>` 之后的实例天然满足）。
 *       槽文件要在实例可见目录里：`.tmp/instances/<id>/{overlay,base}/SAVE/SAVE<NN>.DAT`。
 * 判据：① 开屏成功（`cur = SAVE.BIN`）② 日志出现 `[slot-load]` ③（可选 `--expect BIN`）载入后帧链到该脚本。
 * 已实测：2026-09-26（槽 78 / 79 各一次，见 tickets/T-0188/evidence/）。
 *
 * ★反 flake（`tickets/T-0185` 的实测）：刚起的实例首跑点 Load Data 偶发进不去 SAVE.BIN
 *   （20s 超时，失败文案指向"槽为空/页码不对"这类**误导性**原因）⇒ 本脚本在"开屏"这一步
 *   **自动重试一次**；仍失败才报错退出。
 *
 * 用法：
 *   node .agents/skills/amayui-remote-debug/scripts/ops/load-from-title.mjs --instance sn187 --slot 79
 *   node .../ops/load-from-title.mjs --instance sn187 --slot 78 --expect SN0000.BIN
 */
import { XY, binOf, pickSlotInSaveScreen, tap, waitBin, waitTicking } from '../emu.mjs';

const argOf = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d;
};
const id = argOf('instance');
const slot = Number(argOf('slot'));
const expect = argOf('expect', undefined);
if (!id || !Number.isFinite(slot)) {
  console.error('用法：load-from-title.mjs --instance <id> --slot <0..99> [--expect BIN]');
  process.exit(2);
}

console.log(`▶ [ops] 从 TITLE 载入槽 ${slot}（实例 ${id}）`);
await waitTicking(id);
const start = await binOf(id);
console.log(`  起跑状态：cur = ${start}`);
if (start !== 'TITLE.BIN' && start !== 'SAVE.BIN') {
  throw new Error(`本用例只从 TITLE 起跑（当前 ${start}）——先 emu.mjs reset --instance ${id}`);
}

/** 开屏：TITLE →（Load Data）→ SAVE.BIN；首跑偶发失败 ⇒ 重试一次（T-0185）。 */
async function openSaveScreen() {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const cur = await binOf(id);
    if (cur === 'SAVE.BIN') {
      console.log('  已在 SAVE/LOAD 画面（跳过点 Load Data）');
      return;
    }
    console.log(`  点 Load Data @ ${XY.loadData.join(',')}（第 ${attempt} 次）`);
    await tap(id, ...XY.loadData, { settleMs: 1500 });
    if (await waitBin(id, 'SAVE.BIN', { timeoutMs: 20_000 })) {
      console.log('  ✔ 已进 SAVE/LOAD 画面');
      return;
    }
    console.log(`  ↻ 第 ${attempt} 次没进 SAVE.BIN（${await binOf(id)}）—— 这就是 T-0185 记的首跑 flake，重试`);
  }
  throw new Error('两次都没进 SAVE.BIN：槽文件不在实例可见目录？实例没起稳？');
}

await openSaveScreen();
const r = await pickSlotInSaveScreen(id, slot, { expect });
console.log(`✔ [ops] 已载入槽 ${slot}：cur = ${r.bin}`);
