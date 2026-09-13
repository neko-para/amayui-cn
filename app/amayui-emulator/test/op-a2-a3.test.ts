/**
 * **复评台账 A2 + A3 的回归测试**（2026-09）。
 *
 * A2 = `0x7B` `0x1BB` `0x25A` `0xAE`（写"有读者"的引擎状态 / 控制流）
 * A3 = 文本/消息族 `0x7A` `0x1D2` `0x25C` `0x25E` `0x25F` `0x205` `0x245` `0x246` `0x249`
 *      + 读取端 `0x1D3` `0x1D4` `0x2F3`
 * 另含接线项：`0x199`（`0x7B` 的读取端；此前命中即硬报错）与语音记录 push（`0xC4`/`0x1BD`/`0x2F4`）。
 *
 * 台账见 `docs-new/03-engine/stub-reaudit-2026-09.md`；逐条引擎实证写在各 handler 的注释里。
 * raw 行号 = `engine/天结_unpacked.exe_utf8.c`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StubNative } from '../src/vm/native.js';
import { Engine, Frame } from '../src/vm/engine.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import { ENGINE_FIELD_OPS } from '../src/vm/handlers/engine-fields.js';
import { formatNumberCell } from '../src/vm/handlers/msgwin.js';
import { dec, enc } from '../src/vm/bits.js';
import { ITEM_TEXT, ITEM_VOICE, ITEM_GROUP_START } from '../src/vm/textItems.js';
import type { BinArg, BinInstruction } from '../src/script/bin.js';
import { im, instr, str } from './harness.js';

/** 本帧 int 槽（type 0x9）—— 只有池操作数能做**写目标**，立即数不行。 */
const loc = (slot: number): BinArg => ({ type: 0x9, raw: slot }) as unknown as BinArg;


interface Harness {
  e: Engine;
  f: Frame;
  native: StubNative;
  step: (op: number, args?: BinArg[]) => void;
  trace: (op: number, args?: BinArg[]) => { handlerKind: string; next: number | null };
}

function mk(): Harness {
  const native = new StubNative(() => {});
  const e = new Engine(native);
  const f = new Frame();
  const step = (op: number, args: BinArg[] = []): void => {
    const h = OPS.get(op);
    assert.ok(h, `0x${op.toString(16)} 应在 OPS 里`);
    h!(makeCtx(e, f, instr(op, args), native, () => {}));
  };
  const trace = (op: number, args: BinArg[] = []) => {
    const ctx = makeCtx(e, f, instr(op, args), native, () => {});
    const h = OPS.get(op) ?? NATIVE_OPS.get(op);
    assert.ok(h, `0x${op.toString(16)} 应在某张表里`);
    h!(ctx);
    return { handlerKind: OPS.has(op) ? 'OPS' : 'NATIVE_OPS', next: ctx._nextIp };
  };
  return { e, f, native, step, trace };
}

/** A2 + A3 的全部 opcode（含接线项）。 */
const A2_A3 = [
  0x7b, 0x1bb, 0x25a, 0xae, // A2
  0x7a, 0x1d2, 0x1d3, 0x1d4, 0x2f3, 0x25c, 0x25e, 0x25f, 0x205, 0x245, 0x246, 0x249, // A3
  0x199, // 接线：0x7B 的读取端
];

test('注册表棘轮：A2/A3 的每条都落在真实现表里，且不在 ENGINE_INTERNAL_OPS', () => {
  for (const op of A2_A3) {
    const inOps = OPS.has(op) || NATIVE_OPS.has(op);
    assert.ok(inOps, `0x${op.toString(16)} 应已实现（OPS 或 NATIVE_OPS）`);
    assert.equal(ENGINE_INTERNAL_OPS.has(op), false, `0x${op.toString(16)} 不得同时留在 stub 表里`);
  }
  // 过去"压根没注册"的三条读取端（命中即 NotImplementedOp）
  for (const op of [0x1d3, 0x1d4, 0x2f3, 0x199]) {
    assert.ok(OPS.has(op), `0x${op.toString(16)} 必须注册（否则命中即硬报错）`);
  }
});

// ---------------------------------------------------------------------------
// A2
// ---------------------------------------------------------------------------

test('0x7B → 0x199：设置/读取本帧「重显示」回退游标（含备用游标与模式位）', () => {
  const { e, f, trace } = mk();
  e.cur = 3;
  // 0x7B <主游标> <备用游标>
  OPS.get(0x7b)!(makeCtx(e, f, instr(0x7b, [im(42), im(77)]), e.native, () => {}));
  assert.equal(e.engineValues.get(122372 + 3), 42);
  assert.equal(e.engineValues.get(122412 + 3), 77);

  // 0x199：模式位未置 ⇒ 用主游标，并把当前 ip+1 存进 122453、清 effect_flags
  e.effectFlags = 0x123;
  f.ip = 10;
  const r = trace(0x199);
  assert.equal(r.next, 42, '0x199 应跳到主回退游标（引擎 ip = base + 4*游标）');
  assert.equal(e.effectFlags, 0, '0x199 会清 effect_flags（旧值存进 122452）');
  assert.equal(e.engineValues.get(122452), (0x123 | 0x6000000) | 0);
  assert.equal(e.engineValues.get(122453), 11);

  // 模式位已置 ⇒ 用备用游标，且只改 122452 的两位
  e.engineValues.set(122452, 0x6000000);
  const r2 = trace(0x199);
  assert.equal(r2.next, 77, '模式位 0x4000000 已置时用备用游标');
  assert.equal(e.engineValues.get(122452), (0x6000000 & 0xf9ffffff) | 0x2000000);

  // 游标缺省 -1 ⇒ 不动控制流、不改 ip
  const { e: e2, f: f2, trace: t2 } = mk();
  f2.ip = 5;
  const r3 = t2(0x199);
  assert.equal(r3.next, null, '无游标时 0x199 不得改控制流');
  assert.equal(f2.ip, 5);
});

test('0x1BB SetTB：1 ⇒ 记账、0 ⇒ 暂停、其它 ⇒ 按引擎同文抛错', () => {
  const { e, step } = mk();
  step(0x1bb, [im(0)]);
  assert.equal(e.engineValues.get(97055), 0x80000000 | 0, 'i1bb 0 ⇒ Engine[97055] = 0x80000000');
  step(0x1bb, [im(1)]);
  assert.equal(e.engineValues.get(97055), 0, 'i1bb 1 ⇒ 归零（正常记账）');
  assert.throws(() => step(0x1bb, [im(2)]), /SetTBの引数が不正です/, '非法值走引擎的 ShowMessage 异常');
});

test('0x25A：消息态影片 = 字段（模式 1 + id）；0x25B 同族为模式 2', () => {
  const { e, step } = mk();
  step(0x25a, [im(0x1234)]);
  assert.equal(e.engineValues.get(92379), 1, '模式位 = 1（影片）');
  assert.equal(e.engineValues.get(92380), 0x1234, 'id 写进 92380');
  step(0x25b, [im(0x5678)]);
  assert.equal(e.engineValues.get(92381), 0x5678, '0x25B 写的是 92381（图像 id）');
});

test('0xAE：非读档流程（门控 0）严格 no-op；门控置位时按版本选组并收尾', () => {
  const { e, step } = mk();
  const before = JSON.stringify([...e.engineValues]);
  step(0xae);
  assert.equal(JSON.stringify([...e.engineValues]), before, 'Engine[95780]==0 ⇒ 引擎直接返回，不写任何字段');

  // 门控置位 + sv1=2：cur 已等于存档记录的帧 ⇒ 清门（版本 2 还会置 97054）
  e.config = { values: new Map([['set:saveversion1', 2], ['set:saveversion2', 2]]), sections: [], order: new Map() };
  e.cur = 5;
  e.engineValues.set(95780, 1);
  e.engineValues.set(140457, 5); // savedCur
  e.engineValues.set(140458, 9); // savedRet
  step(0xae);
  assert.equal(e.engineValues.get(95780), 0);
  assert.equal(e.engineValues.get(95777), 9);
  assert.equal(e.engineValues.get(97054), 1);

  // sv1=1 但 sv2 ≠ 20 ⇒ 不匹配该分支（引擎只在 sv2==20 时走版本 1）
  e.engineValues.set(95780, 1);
  e.config.values.set('set:saveversion1', 1);
  e.config.values.set('set:saveversion2', 2);
  step(0xae);
  assert.equal(e.engineValues.get(95780), 1, '版本不匹配 ⇒ 该分支不进（门保持）');
});

// ---------------------------------------------------------------------------
// A3：文本项记录表
// ---------------------------------------------------------------------------

test('0x1D2 → 0x1D3：文本项 push + 按 key 查询（含组首停止、越界返回 0）', () => {
  const { e, f, step } = mk();
  step(0x80, [im(8)]); // 默认窗 = 8（0x80 同时写 Engine[21631] 与 msgwin.defaultWin）
  const rd = (slot: number): number => dec(e.key, f.locals.int.get(slot) ?? 0) | 0;
  const q = (o1: number, o2: number, o3: number, start: number, key: number) => {
    step(0x1d3, [loc(o1), loc(o2), im(o3), im(start), im(key)]);
    return { ok: rd(o1), value: rd(o2) };
  };
  // 空表：start=0 越界 ⇒ op1=0、op2 保持 0（引擎 sub_457960 提前返回）
  assert.deepEqual(q(1, 2, 0, 0, 7), { ok: 0, value: 0 });

  step(0x1d2, [im(7), im(100)]); // key=7 value=100
  step(0x1d2, [im(8), im(200)]);
  assert.equal(e.textItems.records.length, 2);
  assert.equal(e.textItems.records[0]!.flags & ITEM_TEXT, ITEM_TEXT);
  assert.deepEqual(q(1, 2, 0, 0, 7), { ok: 1, value: 100 }, '命中 key=7 ⇒ op1=1、op2=100');
  assert.deepEqual(q(1, 2, 0, 0, 8), { ok: 1, value: 200 });
  assert.deepEqual(q(1, 2, 0, 1, 7), { ok: 0, value: 0 }, '从下标 1 起扫 ⇒ 看不到第 0 条');

  // 同组内"最后一次命中覆盖前面的"（引擎不提前 break）
  step(0x1d2, [im(7), im(999)]);
  assert.deepEqual(q(1, 2, 0, 0, 7), { ok: 1, value: 999 }, '同组内后匹配者胜出');

  // 组首：0x71（新一段消息）在该窗置标记 ⇒ 下一条 push 带组首位、扫描在此停
  OPS.get(0x71)!(makeCtx(e, f, instr(0x71, [im(8)]), e.native, () => {}));
  step(0x1d2, [im(7), im(1234)]);
  const last = e.textItems.records[e.textItems.records.length - 1]!;
  assert.equal(last.flags & ITEM_GROUP_START, ITEM_GROUP_START, '新一段消息后的第一条记录 = 组首');
  assert.deepEqual(q(1, 2, 0, 0, 7), { ok: 1, value: 999 }, '扫描在组首前停 ⇒ 看不到新一组的 1234');
  assert.deepEqual(q(1, 2, 0, 3, 7), { ok: 1, value: 1234 }, '从组首那条本身起扫才看得到它');
});

test('语音记录（0xC4/0x1BD/0x2F4）→ 0x1D4 / 0x2F3 查询', () => {
  const { e, f, step, trace } = mk();
  const rd = (slot: number): number => dec(e.key, f.locals.int.get(slot) ?? 0) | 0;
  e.engineValues.set(5053, 0x11); // 通道 0 的附带值
  e.engineValues.set(5053 + 2, 0x22); // 通道 2
  trace(0xc4, [im(0x7001)]); // 通道 0、循环位 0
  trace(0x1bd, [im(0x7002)]); // 通道 0、循环位 1
  trace(0x2f4, [im(0x7003), im(0), im(2)]); // 通道 2
  assert.equal(e.textItems.records.length, 3);
  assert.equal(e.textItems.records[0]!.flags & ITEM_VOICE, ITEM_VOICE);
  assert.deepEqual(
    e.textItems.records.map((r) => [r.v20, r.v24, r.sel32, r.v28]),
    [
      [0x7001, 0, 0, 0x11],
      [0x7002, 1, 0, 0x11],
      [0x7003, 0, 2, 0x22],
    ],
    '语音记录字段：+20=id、+24=循环位、+32=通道、+28=Engine[5053+通道]',
  );

  // 0x1D4（选择器恒 0）⇒ 命中通道 0 的最后一条（0x7002），写 op1/op2
  step(0x1d4, [loc(1), loc(2), im(0), im(0)]);
  assert.equal(rd(1), 0x7002);
  assert.equal(rd(2), 1);

  // 0x2F3（选择器 = op6）⇒ 通道 2 ⇒ 写 op1/op2/op3
  step(0x2f3, [loc(1), loc(2), loc(3), im(0), im(0), im(2)]);
  assert.equal(rd(1), 0x7003);
  assert.equal(rd(2), 0);
  assert.equal(rd(3), 0x22);

  // 未命中 ⇒ -1/-1/0（引擎初值）
  step(0x2f3, [loc(1), loc(2), loc(3), im(0), im(0), im(7)]);
  assert.equal(rd(1), -1);
  assert.equal(rd(2), -1);
  assert.equal(rd(3), 0);

  // `i1bb 0` 期间不记账（引擎三处 push 的公共门）
  step(0x1bb, [im(0)]);
  const n = e.textItems.records.length;
  trace(0xc4, [im(0x7004)]);
  assert.equal(e.textItems.records.length, n, 'i1bb 0 期间语音记录也不得入表');
});

// ---------------------------------------------------------------------------
// A3：消息窗对象 / 数字直绘 / 纹理
// ---------------------------------------------------------------------------

test('0x7A / 0x25C / 0x25E / 0x25F：写消息窗对象字段（含颜色组装）', () => {
  const { e, step } = mk();
  step(0x80, [im(4)]); // 默认窗 = 4（op1=0 ⇒ resolveWin 取它）
  step(0x7a, [im(0), im(11), im(22)]);
  let o = e.msgwin.object(4);
  assert.deepEqual([o.pre48a, o.pre48b], [11, 22]);

  step(0x25c, [im(4), im(1), im(2), im(3), im(4), im(5), im(6), im(7)]);
  o = e.msgwin.object(4);
  assert.deepEqual(o.block224, [1, 3, 4, 5, 6 + 4, 7 + 5, 1, 2, 0, 0, 0, -1, -1],
    '文本块 13 dword：引擎 qmemcpy 的顺序（[1..3]=op4..op6、[4]=op7+op5、[5]=op8+op6、[6..7]=op2/op3）');

  step(0x25e, [im(4), im(0xaa), im(0xbb), im(300), im(0x010203)]);
  o = e.msgwin.object(4);
  assert.equal(o.f256, 0xaa);
  assert.equal(o.f260, 0xbb);
  assert.equal(o.f272, ((255 << 24) | (0x01 << 16) | (0x02 << 8) | 0x03) | 0, 'alpha>255 截断为 255，RGB 取 op5 低 3 字节');

  step(0x25f, [im(4), im(0xcc), im(0xdd), im(0x0a0b0c)]);
  o = e.msgwin.object(4);
  assert.equal(o.f264, 0xcc);
  assert.equal(o.f268, ((0xdd & 0xff) << 24) | (0x0a << 16) | (0x0b << 8) | 0x0c);
});

test('0x205：数字格式化（补零/符号/溢出）+ op2 写回（x 前进量）', () => {
  // ★引擎的缓冲区是**从右往左填**、只有写过的格子才有字符（未写的格子是 NUL，串从首个写过的格子开始）
  //   ⇒ 返回的 ascii 不含前导空格，"左侧空了几格"由 `start`（引擎的 v13）表达。
  assert.deepEqual(formatNumberCell(123, 4, 0), { ascii: '123', start: 1 }, '宽 4 的右对齐 ⇒ 左侧空 1 格');
  assert.deepEqual(formatNumberCell(7, 3, 1), { ascii: '007', start: 0 }, 'bit0 补前导零');
  assert.deepEqual(formatNumberCell(7, 3, 8), { ascii: '+7', start: 1 }, 'bit3 正数带 +（占一格）');
  assert.deepEqual(formatNumberCell(-42, 4, 0), { ascii: '-42', start: 1 }, '负数符号占一格');
  assert.deepEqual(formatNumberCell(-5, 1, 0), { ascii: '#', start: 0 }, '字段太窄（宽-2<0）⇒ 溢出标记 #');

  // handler 部分：op2（x）是 in/out —— 引擎 `*x = x + 前进量`
  const { e, f, step } = mk();
  const rd = (slot: number): number => dec(e.key, f.locals.int.get(slot) ?? 0) | 0;
  const set = (slot: number, v: number): void => void f.locals.int.set(slot, enc(e.key, v));
  e.engineValues.set(71744, 1);
  e.engineValues.set(71745, 10); // cy = 字号 = 10
  set(5, 100); // x
  step(0x205, [im(196), loc(5), im(50), im(7), im(4), im(0)]);
  // 右对齐全角：宽 4 装 1 位数 ⇒ 左侧空 3 格，前进量 = start*cy = 3*10
  assert.equal(rd(5), 130, 'op2 应被回写为 x + 前进量（3 个空格 × cy=10）');
  // 左对齐（bit2）⇒ 前进量 0 ⇒ x 不变
  set(5, 100);
  step(0x205, [im(196), loc(5), im(50), im(7), im(4), im(4)]);
  assert.equal(rd(5), 100);
  // 半角（bit16）+ 居中（bit1）⇒ start*cy/2 = 3*10/2
  set(5, 100);
  step(0x205, [im(196), loc(5), im(50), im(7), im(4), im(0x10000 | 2)]);
  assert.equal(rd(5), 115);
});

test('0x249 / 0x245 / 0x246：纹理槽绑定与对象参数转发', () => {
  const calls: Array<[string, number, number]> = [];
  const native = new StubNative(() => {});
  const spy = native as unknown as {
    bindTexture?: (imgid: number, slot: number) => void;
    setTextureObjectFloat?: (slot: number, value: number) => void;
    setTextureObjectParam?: (slot: number, value: number) => void;
  };
  spy.bindTexture = (imgid, slot) => calls.push(['bind', imgid, slot]);
  spy.setTextureObjectFloat = (slot, value) => calls.push(['float', slot, value]);
  spy.setTextureObjectParam = (slot, value) => calls.push(['param', slot, value]);
  const e = new Engine(native);
  const f = new Frame();
  const step = (op: number, args: BinArg[]): void => {
    const h = OPS.get(op);
    assert.ok(h, `0x${op.toString(16)} 应在 OPS 里`);
    h!(makeCtx(e, f, instr(op, args), native, () => {}));
  };

  step(0x249, [im(0x5250), im(196), im(0x00ff00)]);
  assert.equal(e.texSlots.get(196), 0x5250, '0x249 按 id 绑定槽');
  assert.ok(e.isFileUsed(0x5250), '0x249 会打开文件 ⇒ 必须记「已使用」（鉴赏解锁的判据）');
  step(0x245, [im(196), im(500)]);
  step(0x246, [im(196), im(250)]);
  assert.deepEqual(calls, [
    ['bind', 0x5250, 196],
    ['param', 196, 0x00ff00],
    ['float', 196, 500],
    ['param', 196, 250],
  ]);
});

test('A2/A3 的实现没有把字段写进别的表（三表不相交 + 新表已接入 index）', () => {
  // index.ts 必须把新模块拼进 OPS —— 通过"0x1D2 能解析"与"ENGINE_FIELD_OPS 里 0x25A 不再是通用 store"侧面确认
  assert.ok(OPS.get(0x1d2));
  assert.ok(OPS.get(0x25a));
  assert.equal(ENGINE_FIELD_OPS.some(([op]) => op === 0x25a), true, '0x25A 由 ENGINE_FIELD_OPS 提供（专用 handler）');
});
