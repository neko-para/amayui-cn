/** @tier T0 @kind core @subsystem ops */

/**
 * **`0x23F` 槽尺寸 getter**（`tickets/T-0076` 的 B3 补；语料 3 处 = FIELD×2 / BTL×1）。
 *
 * 引擎体（`sub_4307B0` raw 40019-40031，argc 2）：`v2 = _this[op2 + 94672]`；`v2 == 0` ⇒ `op1 = -1`，
 * 否则 `op1 = (int)(sub_4080B0(v2) * 1000.0)`（`dbl_51FB50 = 1000.0`，raw 4393）。
 * ★`sub_4080B0`（体 raw 12960-12980）按 `node[+1084]` 分派 vtable `+40`/`+68` 取尺寸；
 * 本文语料里 `0x23F` 的 `op2` 是**刚 `create-texture` 的槽**（`src/FIELD.txt:13718-13721`，120×120 正方形）
 * ⇒ **宽/高不可分辨**（已在 handler 注释披露）；`0x23E`（同族另一半）语料 0 处 ⇒ `deferred`。
 *
 * ★`T-0153`（VM 半边）**最小 retarget**：修前本文件钉的是
 * 「`create-texture 2a 78 78 0` ⇒ 即使**没有对象**也答 `120000`」——那正是与引擎相反的那条
 * `host-invented`（`0x23F` 的取值来源本该是**对象表** `Engine[slot + 94672]`，不是 `0x1F8` 记的
 * 表面尺寸）。现在取值来源改成宿主的对象表缝（`native.slotNodeSize`，两宿主同判据）⇒
 * **「先让该槽有对象」成了答出 120000 的前提**；没有对象时引擎写 −1（raw 40025-40027）。
 * 全部原有锚点（`src/FIELD.txt:13718-13721`、`dbl_51FB50`、释放后回 −1、`×1000` 截断）**一条未删**，
 * 只是把"对象表"这一步显式补上（旧前提不成立，理由见上）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Engine } from '../src/vm/engine.js';
import { OPS, NATIVE_OPS } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import { StubNative } from '../src/vm/native.js';

/**
 * 记录型桩：复刻两个真宿主（`PixiBackend`/`HeadlessScene`）在 `0x23F` 上的判据 ——
 * `0x1F8` 记该槽**表面**尺寸、`0x20F` play-movie 惰性建该槽**对象**，
 * 两者在才答得出尺寸（`renderer/slotSurface.ts` 的 `slotNodeSizeOf`，本票 renderer 半边交付）。
 * ★本桩**只**服务本文件；真判据的唯一实现是 `slotSurface.ts`（不在这里抄第二份）。
 */
class NodeStub extends StubNative {
  readonly nodes = new Set<number>();
  readonly surfaces = new Map<number, { w: number; h: number }>();

  constructor() {
    super(() => {});
  }

  override playMovie(_id: number, slot: number, _mode: number): void {
    this.nodes.add(slot);
  }

  override createTexture(slot: number, w: number, h: number, _mode: number): void {
    this.surfaces.set(slot, { w, h });
  }

  /** `0x1FA`：真宿主在这里撤该槽的表面与对象（`TextureCache.release`，raw 31245-31269）。 */
  override releaseTexture(slot: number): void {
    this.surfaces.delete(slot);
    this.nodes.delete(slot);
  }

  /** ★不加 `override`：`slotNodeSize` 是 `NativeBridge` 的**可选**缝，`StubNative` 刻意不实现它。 */
  slotNodeSize(slot: number): { present: boolean; w: number; h: number } | undefined {
    if (!this.nodes.has(slot)) return { present: false, w: 0, h: 0 };
    const s = this.surfaces.get(slot);
    return s ? { present: true, w: s.w, h: s.h } : { present: true, w: 0, h: 0 };
  }
}

function instr(op: number, argc: number, args: { type: number; raw: number }[]): never {
  return { opcode: op, name: `i${op.toString(16)}`, argc, args, byteOffset: 0, index: 0 } as never;
}

test('★0x23F：op1 = 槽尺寸 ×1000；缺槽 ⇒ −1（与 0x1FA 释放联动）', async () => {
  const native = new NodeStub();
  const e = new Engine(native);
  const frame = e.frames[0]!;
  const out = 0x10; // 出参：**本地** int 槽（type 0x9 才可写，见 `operand.ts`）
  const { dec } = await import('../src/vm/bits.js');
  const read = (): number => dec(e.key, frame.locals.int.get(out) ?? 0) | 0; // `| 0`：引擎的 −1 就是 0xFFFFFFFF
  const args = (slot: number): { type: number; raw: number }[] => [{ type: 0x9, raw: out }, { type: 0x0, raw: slot }];
  const run = async (op: number, argc: number, a: { type: number; raw: number }[]): Promise<void> => {
    const h = OPS.get(op) ?? NATIVE_OPS.get(op); // 0x1F8/0x23F 在 OPS、0x1FA 在 NATIVE_OPS
    assert.ok(h, `opcode 0x${op.toString(16)} 未注册`);
    await h!(makeCtx(e, frame, instr(op, argc, a), e.native, () => {}));
  };

  // 缺槽 ⇒ −1（引擎 `v2 == 0` 分支）。
  await run(0x23f, 2, args(42));
  assert.equal(read(), -1, '缺槽 ⇒ −1');

  // `create-texture 2a 78 78 0`（= 120×120，正是 `src/FIELD.txt:13718` 那一行）⇒ 120000。
  await run(0x1f8, 4, [
    { type: 0x0, raw: 42 },
    { type: 0x0, raw: 0x78 },
    { type: 0x0, raw: 0x78 },
    { type: 0x0, raw: 0 },
  ]);
  // ★`T-0153` retarget：`0x23F` 读的是**对象表**（`_this[op2 + 94672]`），不是 `create-texture`
  //   记的表面尺寸 ⇒ 只 `create-texture` 还答不出尺寸（下一行断言），必须先有对象。
  await run(0x23f, 2, args(42));
  assert.equal(
    read(),
    -1,
    '★只有 create-texture（没有对象）⇒ −1 —— 引擎 raw 40025-40027；旧断言在这里答 120000，是与引擎相反的那条',
  );
  // ★语料同序（`src/FIELD.txt:13718-13721`：create-texture → `i236` → `i23f`）：建出该槽对象后才可查。
  //   这里用 `0x20F` play-movie 走同一条"惰性建 `Engine[slot+94672]`"（`0x236` 的 handler 尚未注册）。
  await run(0x20f, 3, [
    { type: 0x0, raw: 0x18a9c },
    { type: 0x0, raw: 42 },
    { type: 0x0, raw: 0 },
  ]);
  await run(0x23f, 2, args(42));
  assert.equal(read(), 120000, '★120 × 1000（`×1000` 取整，与 `dbl_51FB50` 同口径）');

  // `release-texture 2a` ⇒ 尺寸记录随之消失 ⇒ 又回 −1。
  await run(0x1fa, 1, [{ type: 0x0, raw: 42 }]);
  await run(0x23f, 2, args(42));
  assert.equal(read(), -1, '释放后 ⇒ −1（不留陈旧尺寸）');
});
