/** @tier T0 @kind core @subsystem render */

/**
 * **`0x147` 的 n（点数）路径**（`tickets/T-0158` 的 P3 `0x147` ×2）。
 *
 * 引擎 `sub_42FD60`（raw 39655-39702）逐字：
 * ```
 * 39675  v3 = sub_41BF50(_this, 6);                 // n
 * 39676  v4 = (POINT *)operator new[](8 * v3);      // ★**无条件**分配
 * 39679  if ( v3 > 0 ) { …逐点写 v4[i]… }
 * 39689  PolygonRgn = CreatePolygonRgn(v4, v3, 2);
 * 39690  if ( PolygonRgn ) { PtInRegion → op1 }
 * 39698  else { sub_4034C0(_this, asc_520808);  sub_42B4B0(_this, 1, 0); }   // 错误串 + op1 = 0
 * ```
 * 两处修复点：
 * ① **`n ≤ 1` 的失败支是确定可达的**（`CreatePolygonRgn` 在 `count < 2` 时返回 NULL）——
 *    可观测结果同为 `op1 = 0`，但引擎那句 `"リージョン作成失敗しました"`（raw 4451）此前完全没有。
 * ② 修前是「`n > MAX_POINTS`（2^20）直接 throw」—— 那是**引擎体里没有的上限**，把一个"引擎正常写
 *    `op1 = 0` 并继续执行"的输入变成了**硬停**（整步抛异常）。引擎那侧唯一的边界是
 *    `8n` 字节的 `operator new[]`（32 位宿主上 n > 0x0FFFFFFF 就分配不出来）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPS } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/native.js';
import { makeCtx } from '../src/vm/step.js';
import { dec, enc } from '../src/vm/bits.js';
import { im, instr, loc, mkEngine } from './harness.js';

const XS = 0x10;
const YS = 0x20;

/** 跑一次 `i147`，返回 `{ hit, logs }`。点数组按 `n` 逐格写（n 很大时只写前几格）。 */
function run147(cs: { x: number; y: number; n: number }): { hit: number; logs: string[] } {
  const e = mkEngine([]);
  const f = e.curScript();
  e.key = 0;
  const set = (slot: number, v: number): void => void f.locals.int.set(slot, enc(e.key, v));
  set(1, cs.x);
  set(2, cs.y);
  // 一个**平凡但成区**的三角形（足够让 n ≥ 2 的分支真跑 geometry）
  [0, 0, 10, 0, 0, 10].forEach((v, i) => set(XS + i, v));
  [0, 0, 0, 10, 10, 0].forEach((v, i) => set(YS + i, v));
  const logs: string[] = [];
  const ctx = makeCtx(
    e,
    f,
    instr(0x147, [loc(0), loc(1), loc(2), loc(XS), loc(YS), im(cs.n)]),
    new StubNative(() => {}),
    (m) => logs.push(m),
  );
  const h = OPS.get(0x147);
  assert.ok(h, '0x147 必须注册在已实现表');
  h!(ctx);
  const raw = f.locals.int.get(0);
  assert.notEqual(raw, undefined, 'op1 必须被写（引擎两条路径都写 op1：39693 / 39699）');
  return { hit: dec(e.key, raw!) | 0, logs };
}

test('★P3 0x147：n = 1 走引擎的"建区失败"支（`op1 = 0` + 错误串），不是静默', () => {
  const { hit, logs } = run147({ x: 0, y: 0, n: 1 });
  assert.equal(hit, 0, '`count < 2` ⇒ GDI 建不出区 ⇒ op1 = 0（raw 39696-39700）');
  assert.equal(logs.length, 1, '★修前完全静默；引擎 raw 39698 打错误串');
  assert.match(logs[0]!, /リージョン作成失敗/, '引擎同文 `asc_520808`（raw 4451）');
});

test('★P3 0x147：n = 0 同走失败支（点数组一格未写 = raw 39679 的 `v3 > 0` 假支）', () => {
  const { hit, logs } = run147({ x: 0, y: 0, n: 0 });
  assert.equal(hit, 0);
  assert.equal(logs.length, 1);
  assert.match(logs[0]!, /リージョン作成失敗/);
});

test('★P3 0x147 host-invented：`n > 2^20` **不再抛异常**（引擎没有这个上限；只有 `8n` 的分配边界）', () => {
  const n = 0x10000000; // 2^28 = 268435456：远超旧的 MAX_POINTS（2^20），也超过 8n 的 32 位可分配范围
  let out: { hit: number; logs: string[] } | null = null;
  assert.doesNotThrow(() => {
    out = run147({ x: 0, y: 0, n });
  }, '★修前 `if (n > MAX_POINTS) throw` 会把整步执行打断成异常');
  assert.equal(out!.hit, 0, '引擎那条路径的可观测结果仍是 op1 = 0');
  assert.match(out!.logs[0]!, /operator new/, '日志说明边界来自 `operator new[](8n)`（raw 39676）');
});

test('★0x147：n = 2 的退化多边形仍走 geometry（没被上面的早退吃掉）', () => {
  const { hit, logs } = run147({ x: 0, y: 0, n: 2 });
  assert.equal(logs.length, 0, 'n ≥ 2 ⇒ 不打印错误串');
  assert.equal(typeof hit, 'number', '两条边不成区 ⇒ GDI 也算得出结果（这里只要求不抛、有 op1）');
});
