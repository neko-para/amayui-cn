/** @tier T0 @kind core @subsystem ops */

/**
 * **`0x82` / `0x1D1` 的发布起点 = `win+104`（`op3` bit6 时再加 `win+132`）** —— 引擎 raw 79684-79688：
 * ```text
 * v44 = *(_DWORD *)(_this + 4 * v175 + 1044);   // 该窗对象
 * v45 = *(_DWORD *)(v44 + 104);                 // win+104 = 本次绘制的 id 起点
 * v155 = v45;
 * if ( (a4 & 0x40) != 0 )                       // op3 bit6
 *   v155 = *(_DWORD *)(v44 + 132) + v45;        //   ⇒ 再加 win+132（行游标）
 * ```
 * emulator 有**两处同形落点**（`src/vm/handlers/msgwin.ts`）：`0x82`（`op_gdi_repaint_window`）与
 * `0x1D1`（`op_recall_page_repaint`，`sub_4675A0` 是 `sub_466000` 的孪生兄弟）——
 * 两处都是 `emitWin(e, win, (mode & REPAINT_KEEP_SURFACE) !== 0 ? o.f104 + o.f132 : o.f104)`；
 * `styleOfWin`（`src/vm/msgwin.ts:288-290`）把该实参发布成 **`input.style.itemId`** ⇒ 渲染侧层序由它决定
 * （`src/text/textLayer.ts`：`style.itemId > 0 ? style.itemId : TEXT_LAYER_BASE + win`）。
 *
 * ★本文件补的是**该 bit6 分支的独立断言**（此前只有"重发布一次"的守卫 `op-0104-gdi-repaint.test.ts` ⑤，
 * 它只数**调用次数**、不看载荷 ⇒ 起点算错也不会红）。少加 `win+132` 会把整窗文字发到**错误的层**
 * （被普通图元盖住或盖住别人）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BinArg } from '../src/script/bin.js';
import { StubNative } from '../src/vm/native.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { enc } from '../src/vm/bits.js';
import { im, instr, loc, mkEngine } from './harness.js';

/** 全局 int 槽操作数（type 3）—— 与 `op-0104-gdi-repaint.test.ts` 同形（`i082` 的 op4/op5）。 */
const gint = (slot: number): BinArg => ({ type: 3, raw: slot }) as unknown as BinArg;

/** 两条指令的实参形状相同：`<win> <start> <mode> <fill> <outline>`（`0x82` argc 5、`0x1D1` argc 5）。 */
const args = (mode: number): BinArg[] => [loc(5), loc(6), im(mode), gint(0xf807b), gint(0xf807c)];

/** 跑一次该指令（win=0、start=0、给定 `op3`），返回载荷里的 `style.itemId`。 */
async function runEmit(op: number, mode: number, f104: number, f132: number): Promise<(number | undefined)[]> {
  const seen: (number | undefined)[] = [];
  const native = new StubNative(() => {});
  // ★载荷形状 = `MsgWinInput`：起点在 **`input.style.itemId`**（不是 `input.itemId`）。
  (native as unknown as { msgWinSync: (w: number, input: { style?: { itemId?: number } }) => void }).msgWinSync =
    (_w, input) => {
      seen.push(input?.style?.itemId);
    };
  const e = mkEngine([instr(op, args(mode))], 'CONFIG.BIN', native);
  e.textItems.records.push({ win: 0, v20: 0, v24: 0, v32: 0, flags: 0 } as never);
  // ★local-int 槽必须 **ENC** 后写（`readIntOperand` 对 local-int 过 DEC）—— 与 0x0104 守卫同一口径。
  e.curScript().locals.int.set(6, enc(e.key, 0)); // op2 = start
  e.curScript().locals.int.set(5, enc(e.key, 0)); // op1 = win
  const o = e.msgwin.object(e.msgwin.resolveWin(0));
  o.f104 = f104;
  o.f132 = f132;
  await stepOnce(e);
  return seen;
}

for (const op of [0x82, 0x1d1] as const) {
  test(`★0x${op.toString(16)}：\`op3 & 0x40\`（bit6）⇒ 发布起点 = \`win+104 + win+132\`（引擎 raw 79687-79688）`, async () => {
    // 不带 bit6 ⇒ 引擎先把 `win+104/+108` 清 0（raw 79634-79653）⇒ 起点读到的是清完之后的 0。
    assert.deepEqual(await runEmit(op, 0, 100, 7), [0], '不带 bit6 ⇒ 先清 `win+104` ⇒ 起点 0');
    assert.deepEqual(
      await runEmit(op, 0x40, 100, 7),
      [107],
      '★带 bit6 ⇒ 不清、且起点 = `win+104 + win+132`（少加 ⇒ 落到错误层；多加 ⇒ 盖住别人）',
    );
  });

  test(`0x${op.toString(16)}：\`win+132\` 为 0 时 bit6 不改变起点（退化情形，防止把 0 当"未设置"特判）`, async () => {
    assert.deepEqual(await runEmit(op, 0x40, 42, 0), [42]);
  });
}
