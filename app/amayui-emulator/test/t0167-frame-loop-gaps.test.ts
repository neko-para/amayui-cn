/** @tier T0 @kind ratchet @subsystem frame */

/**
 * ★**帧循环两条 `missing-branch` 的现场**（审计 §4.5 补漏 #16/#17；票 `T-0167`）。
 *
 * 这两条都因为**文件归属**（`src/frame/**` 与 `src/vm/engine.ts` 归别的单元）本轮**不许改** ⇒
 * 处置是「按体核实 + 如实登记 + 写清重开条件」。本文件把它们**钉成可失败的断言**：
 *  1. **写者/读者真的接上了**：`Scene+46528`（dword `92340`）的置位点是 `0x24E`（`sub_4258C0` raw 32965），
 *     读它 bit1 的是 `0x243`（`sub_41B180` raw 26023）—— 审计 #16 说「emulator 没有这个字段（grep 零命中）」，
 *     这两条行为断言就是反证（删掉 `0x24E` 的 store 映射或 `0x243` 的 bit1 门 ⇒ 当场红）。
 *  2. **缺口登记还在**（棘轮）：等待泵那条支路目前**不读** bit1（体 raw 13910/13923 读它），
 *     且 `set:DrawMode=1` 那一段只落到 `skipWaitGate()`；谁按体补齐 ⇒ 这条棘轮必须同步改，
 *     台账 `frame-render-gate-mainloop` 的 note 也必须把那两条 missing-branch 清掉。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stepOnce } from '../src/vm/interpreter.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { mkEngine, im } from './harness.js';
import type { BinInstruction } from '../src/script/bin.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

const instr = (opcode: number, args = [] as BinInstruction['args']): BinInstruction =>
  ({ opcode, name: `i${opcode.toString(16)}`, argc: args.length, args, byteOffset: 0, index: 0 }) as unknown as BinInstruction;

/** 依序执行三条：`i24e <v>`（写 `Scene+46528`）→ `i238 500`（装等待计时器）→ `i243`（按 bit1 决定清不清）。 */
async function runGatePair(v: number): Promise<number> {
  const e = mkEngine([
    instr(0x24e, [im(v)]), // 引擎 sub_4258C0 raw 32965：_this[92340] = op1
    instr(0x238, [im(500)]), // 装计时器（Engine[92338] = 0 / Engine[92339] = 500）
    instr(0x243, []), // sub_41B180 raw 26023：`if ((369360 & 2) == 0) { 清计时器 }`
  ]);
  for (let i = 0; i < 3; i++) {
    const t = await stepOnce(e);
    assert.notEqual(t.handlerKind, 'unimplemented', '三条都必须是真实现（不是桩）');
  }
  return e.gateWaitMs;
}

test('★① `Scene+46528` 的写者/读者真的接上了：`0x24E` 写、`0x243` 读它的 bit1', async () => {
  assert.equal(ENGINE_FIELD.msgField92340, 92340, '字段登记 = dword 92340（= 字节 369360 = Scene+46528）');
  // 语料形状：`i24e 10001`（= 0x2711）—— bit1 = 0 ⇒ 0x243 必须执行「清等待计时器」那一段。
  assert.equal(await runGatePair(0x2711), 0, '★bit1 = 0 ⇒ `0x243` 清掉 `i238` 装的计时器（体 raw 26023-26029）');
  // bit1 置位 ⇒ 体里整段跳过（`if ((369360 & 2) == 0)` 不成立）。
  assert.equal(await runGatePair(2), 500, '★bit1 = 1 ⇒ `0x243` 整段跳过、计时器原值保留');
});

test('★② 缺口登记还在（棘轮）：等待泵那条支路尚未读 bit1（体 raw 13910/13923 读它）', () => {
  const engineSrc = fs.readFileSync(path.join(HERE, '..', 'src', 'vm', 'engine.ts'), 'utf8');
  assert.match(
    engineSrc,
    /setDrawMode/,
    '`serviceRevealAdvanceInput` 里那条 `DrawMode == 1 ⇒ skipWaitGate()`（体 raw 13910-13915 的等价物）应仍在',
  );
  assert.ok(
    !/msgField92340/.test(engineSrc),
    '★登记缺口：等待泵支路目前不读 `Scene+46528` 的 bit1 ⇒ 谁按体（raw 13910/13923、13923-13929 的 `result = 0`）补齐，' +
      '这条棘轮与台账 `frame-render-gate-mainloop` 的 note 必须同步更新（本条就是为了让"静默补齐"变红）',
  );
  const ledger = JSON.parse(
    fs.readFileSync(path.join(REPO, 'analysis', 'engine-capabilities.json'), 'utf8'),
  ) as { entries: { id: string; emulator: { status: string; note: string } }[] };
  const cap = ledger.entries.find((x) => x.id === 'frame-render-gate-mainloop');
  assert.ok(cap, '台账应有 frame-render-gate-mainloop');
  assert.equal(cap!.emulator.status, 'partial', '这两条缺口未落地 ⇒ 该条必须仍是 partial');
  for (const anchor of ['raw 13923-13929', 'raw 20838-20858', 'raw 32965']) {
    assert.ok(
      cap!.emulator.note.includes(anchor),
      `★台账 note 必须留着实测锚点「${anchor}」（审计 §4.5 #16/#17 的两条 missing-branch 的现场）`,
    );
  }
});
