/** @tier T1 @kind core @subsystem l2d */

/**
 * `tickets/T-0178`：`0x345`（装 L2D 纹理）的**失败语义** —— 引擎只有一条抛点，且与 `0x34E` **故意不对称**。
 *
 * ## 体证（`engine/天结_unpacked.exe_utf8.c`）
 * ```text
 * sub_427CF0（0x345 handler，raw 34519-34553）
 *   v4 = sub_4A1970(Scene, res, op1, hFile, dwBytes, op2, op3);   // raw 34540
 *   if ( v4 != 1 ) { … 组「L2Dテクスチャファイル %s の読み込みに失敗しました」（raw 34548）
 *                    _CxxThrowException(Command_ShowMessage_Exception)（码 65543，raw 34550-34551） }
 * sub_4A1970（raw 121703-121721）
 *   if ( ReadFile(hFile, v9, v7, &dwBytes, 0) ) { sub_478370(...); GlobalFree(v9); **return 1**; }
 *   else { GlobalFree(v9); **return 0**; }
 *            ★`sub_478370`（raw 92567-92575：`!_this` ⇒ 0、`D3DXCreateTextureFromFileInMemory < 0` ⇒ 0）
 *              的返回值**被丢掉了** ⇒ 「槽里没有模型」「图解码失败」在引擎里**不抛**。
 * 对照 0x34E：`sub_4A19F0`（raw 121724-121743）**原样 `return v12`**（= `sub_478640` 的结果）
 *   ⇒ 那条「实例槽里没有模型」**会抛**（见 test/input.test.ts 的前置说明与 test/live2d-t0160.test.ts）。
 * ```
 *
 * ## 为什么要有这条守卫
 * 修前 emulator 的 `bindTextureToSlot` 在「文件取不到」时只写一条 log、返回 false ⇒ 引擎里会让脚本
 * **停下来并弹错误串**的那条路被静默吞掉（语料 `i345` **437 处**）。本守卫同时钉住**反向**：
 * 「文件在、槽里没模型」**不许**抛（否则会把引擎里安静留空的纹理格变成硬错误）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPS, NATIVE_OPS } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import { im, instr, mkEngine } from './harness.js';
import { ShowMessageError } from '../src/vm/native.js';
import type { BinArg } from '../src/script/bin.js';
import type { Engine } from '../src/vm/engine.js';
import type { FileSource } from '../src/arch/fileSource.js';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

/** 找一个含 `SYS4INI.BIN` 的资源根（`raw/` 优先，其次 `install/`）。 */
function findResourceRoot(): string | null {
  for (const cand of ['raw', 'install']) {
    const dir = path.join(ROOT, cand);
    if (fs.existsSync(path.join(dir, 'SYS4INI.BIN'))) return dir;
  }
  return null;
}

/** 走真实 handler 表派发一条合成指令（与 `live2d-chain.test.ts` / `live2d-t0160.test.ts` 同一路径）。 */
async function dispatch(e: Engine, op: number, args: BinArg[]): Promise<void> {
  const handler = OPS.get(op) ?? NATIVE_OPS.get(op);
  assert.ok(handler, `0x${op.toString(16)} 应有 handler（不该落到未实现）`);
  await handler(makeCtx(e, e.curScript(), instr(op, args), e.native, () => {}));
}

/** 一个**总是取不到**的资产源（引擎那条路 = `sub_4559C0`/`ReadFile` 失败）。 */
const missingSource = { readById: async () => null } as unknown as FileSource;

/** `SETL2DMOC` 给 TITLE 装的三张纹理之一（`src/SETL2DMOC.txt:25` 的 `i345 4f9f (global-int f8c47) 0`）。 */
const ID_TITLE_TEX0 = 0x4f9f;

test('★T-0178 0x345：纹理**文件取不到** ⇒ 抛 ShowMessageError（引擎 raw 34548 的「L2Dテクスチャファイル %s…」）', async () => {
  const e = mkEngine([]);
  e.fileSource = missingSource;
  await assert.rejects(
    () => dispatch(e, 0x345, [im(0x7ffff0), im(0), im(0)]),
    (err: unknown) => {
      assert.ok(err instanceof ShowMessageError, `应抛 ShowMessageError（实际 ${String(err)}）`);
      assert.equal(err.engineText, 'L2Dテクスチャファイル 0x7ffff0 の読み込みに失敗しました');
      assert.equal(err.opcode, 0x345);
      return true;
    },
    '引擎 sub_427CF0 raw 34542-34551：sub_4A1970 返回 0（ReadFile 失败）⇒ 组串 + _CxxThrowException',
  );
});

test('★T-0178 0x345：纹理**文件在、实例槽里没有模型** ⇒ **不抛**（引擎 raw 121712-121714 丢掉了 sub_478370 的结果）', async (t) => {
  const root = findResourceRoot();
  if (!root) {
    t.skip('找不到含 SYS4INI.BIN 的资源根 —— 跳过（真资产用例）');
    return;
  }
  const e = mkEngine([]);
  e.fileSource = new NodeFileSource({ resourceDir: root });
  // 槽 0 里没有模型（没跑过 0x341）——引擎此时 `sub_478370` 的 `!_this` 支返回 0，但那个 0 被丢弃
  await dispatch(e, 0x345, [im(ID_TITLE_TEX0), im(0), im(0)]);
  const inst = e.l2dSlots.get(0);
  assert.equal(inst?.model ?? null, null, '槽里仍**没有模型**（0x345 不装模型；`ensureSlot` 只建空壳，见 lazy-live2d-slot）');
  assert.equal(inst?.modelId ?? null, null, 'modelId 仍为空');
  assert.equal(inst?.textures.get(0), ID_TITLE_TEX0, '纹理绑定照记（0x345 的正常副作用，与引擎 sub_4BD070 同侧）');
});

test('★T-0178 对照 0x34E：**动作文件在、实例槽里没有模型** ⇒ 抛（同族两条的不对称是引擎行为）', async (t) => {
  const root = findResourceRoot();
  if (!root) {
    t.skip('找不到含 SYS4INI.BIN 的资源根 —— 跳过（真资产用例）');
    return;
  }
  const e = mkEngine([]);
  e.fileSource = new NodeFileSource({ resourceDir: root });
  // `src/TITLE.txt:554` 的 `i34e 5274 0 0 1`：文件 TITLE.MTN 存在，但实例槽 0 空
  await assert.rejects(
    () => dispatch(e, 0x34e, [im(0x5274), im(0), im(0), im(1)]),
    (err: unknown) => {
      assert.ok(err instanceof ShowMessageError, `应抛 ShowMessageError（实际 ${String(err)}）`);
      assert.equal(err.engineText, 'L2Dモーションファイル TITLE.MTN の読み込みに失敗しました');
      assert.equal(err.opcode, 0x34e);
      return true;
    },
    '对照：sub_4A19F0 raw 121734 原样返回 sub_478640 的结果（槽空 ⇒ 0）⇒ raw 34722-34731 抛',
  );
});
