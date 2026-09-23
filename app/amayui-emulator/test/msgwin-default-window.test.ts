/** @tier T0 @kind core @subsystem adv */

/**
 * `T-0101` 守卫（D5）：**「默认窗」只能有一个真源** —— 在任何 `i080` 之前，`i071 0` 压的回看页与
 * `i1d2` 压的文本项记录必须是**同一个窗**。
 *
 * ## 修前的形状（静默分歧）
 * - `MsgWindow.defaultWin`（`vm/msgwin.ts`，初值 **1**）= 引擎 `Font+1228` 的初值（raw **78899**
 *   `*(_DWORD *)(_this + 1228) = 1;`），`resolveWin(0)` 用它；
 * - `handlers/text-items.ts` 的 `defaultWin(e)` 读 `engineValues[21631] ?? 0`，而 `engineValues`
 *   稀疏表里**没有**这一格 ⇒ `i080` 之前是 **0**。
 * ⇒ 同一条 `i071 0` 压的页 `win = 1`、`i1d2` 压的记录 `win = 0`。今天没有按窗过滤的读端（不可观测），
 *   一旦有就会静默错配。
 *
 * ## 修法（本票）
 * 读侧改读 `msgwin.defaultWin`（唯一真源）；`0x80` 的那行镜像写 `engineValues[21631]` 随之删除。
 *
 * ## 本守卫锁的事
 *  1. 未跑任何 `i080` 时：`i071 0` 的页 `win` == `i1d2` 的记录 `win` == **1**（= 引擎初值，不是 0）；
 *  2. `i080 3` 之后两者**同时**变成 3（单一真源，不会只动一边）；
 *  3. 源码棘轮：`handlers/text-items.ts` 的 `defaultWin` 不许再读 `engineValues[defaultWindow]`，
 *     且全 `src/` 不许再出现 `textSlotArg`（D6 已删除的死字段）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/vm/engine.js';
import { StubNative } from '../src/vm/native.js';
import { OPS } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import type { BinArg, BinInstruction } from '../src/script/bin.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

const im = (n: number): BinArg => ({ type: 0, raw: n }) as unknown as BinArg;
const instr = (opcode: number, args: BinArg[]): BinInstruction =>
  ({ opcode, name: `i${opcode.toString(16)}`, argc: args.length, args, byteOffset: 0, index: 0 }) as unknown as BinInstruction;

/** 派发一条指令（走真实 handler 表）。 */
function dispatch(e: Engine, op: number, args: BinArg[], native: StubNative): void {
  const h = OPS.get(op) ?? e.native;
  const handler = OPS.get(op);
  assert.ok(handler, `0x${op.toString(16)} 应有 handler`);
  void h;
  handler!(makeCtx(e, e.curScript(), instr(op, args), native, () => {}));
}

test('★T-0101 D5：任何 `i080` 之前，回看页与文本项记录的 `win` 必须相同（都是引擎初值 1）', () => {
  const native = new StubNative(() => {});
  const e = new Engine(native);
  // 前提：还没有任何 i080
  assert.equal(e.msgwin.defaultWin, 1, '前提：MsgWindow.defaultWin 初值 = 1（= 引擎 Font+1228 初值，raw 78899）');

  dispatch(e, 0x71, [im(0)], native); // i071 0：新一段消息，win 参数 0 ⇒ 取默认窗
  dispatch(e, 0x1d2, [im(0x7001), im(0x1234)], native); // i1d2：push 一条文本项记录

  const page = e.textItems.pages[e.textItems.pages.length - 1];
  const rec = e.textItems.records[e.textItems.records.length - 1];
  assert.ok(page, 'i071 应压出一条回看页');
  assert.ok(rec, 'i1d2 应压出一条文本项记录');
  assert.equal(page.win, 1, '★回看页的 win（`resolveWin(0)` ⇒ MsgWindow.defaultWin）');
  assert.equal(rec.win, 1, '★记录的 win（`defaultWin(e)`）—— 修前这里是 0，与页不一致');
  assert.equal(
    rec.win,
    page.win,
    '★两处取「默认窗」的口径必须一致（D5：修前 1 vs 0，今天不可观测但会静默错配）',
  );
});

test('★T-0101 D5：`i080 3` 之后两处**同时**变成 3（单一真源，不会只动一边）', () => {
  const native = new StubNative(() => {});
  const e = new Engine(native);
  dispatch(e, 0x80, [im(3)], native); // 设默认窗 = 3
  assert.equal(e.msgwin.defaultWin, 3, '0x80 必须写唯一真源');
  dispatch(e, 0x71, [im(0)], native);
  dispatch(e, 0x1d2, [im(0x7001), im(1)], native);
  assert.equal(e.textItems.pages[e.textItems.pages.length - 1]!.win, 3, '页取默认窗 = 3');
  assert.equal(e.textItems.records[e.textItems.records.length - 1]!.win, 3, '记录取默认窗 = 3');
});

test('★T-0101（源码棘轮）：D5 读侧不许再读 engineValues、D6 的 textSlotArg 必须已删干净', () => {
  const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const ti = read('app/amayui-emulator/src/vm/handlers/text-items.ts');
  const fn = /export function defaultWin\(e: Engine\): number \{[\s\S]*?\n\}/.exec(ti);
  assert.ok(fn, '找不到 defaultWin 实现（守卫结构变了？）');
  assert.equal(
    /ENGINE_FIELD\.defaultWindow/.test(fn![0]),
    false,
    '★D5：defaultWin 不许再读 `engineValues[ENGINE_FIELD.defaultWindow]`（那会造成第二个真源）',
  );
  assert.match(fn![0], /e\.msgwin\.defaultWin/, 'D5：必须读唯一真源 `e.msgwin.defaultWin`');

  // D6：全 src/ 不许再有 textSlotArg **代码**（注释里保留历史说明是允许的 ⇒ 先剥注释再查）
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith('.ts') && strip(fs.readFileSync(p, 'utf8')).includes('textSlotArg')) {
        offenders.push(path.relative(ROOT, p));
      }
    }
  };
  walk(path.join(ROOT, 'app/amayui-emulator/src'));
  assert.deepEqual(
    offenders,
    [],
    '★D6：`textSlotArg` 已整条删除 ⇒ 代码里不该再有它（注释里的历史说明不算）',
  );
});
