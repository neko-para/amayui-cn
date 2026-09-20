/**
 * **操作数漏读白名单「核体后处置」的守卫**（`test/opcode-operands.test.ts` 的 `ALLOW_UNDERRUN`
 * 那一节的机械镜像）。
 *
 * 那节里 5 条曾挂在「确认是 bug，按票排期」下，核 `engine/天结_unpacked.exe_utf8.c` 的
 * **handler 体**（grep 定义头 `//----- (00XXXXXX)` 定位，不按邻近常量猜）后分成两类，
 * 本文件把两类的结论都钉成断言 —— 免得日后有人"顺手补齐"造成与引擎分叉：
 *
 * | opcode | handler | 体 raw | 引擎实际读 | 处置 |
 * |---|---|---|---|---|
 * | `0x1F9` | `sub_422CB0` | 31192-31243 | **op1/op2/op3 全读**（op3 归一化成 `0xFFrrggbb` 作颜色参） | 按体补实现 ⇒ 白名单条目**已删** |
 * | `0x1D3` | `sub_42D4A0` | 38113-38128 | op1 写 / op2 写 / **op3 是死读**（传 `sub_457960` 第 3 形参，体里未出现）/ op4=起始下标 / op5=key | 有据豁免 |
 * | `0x1D4` | `sub_42D510` | 38131-38145 | op1 写 / op2 写 / **op3 是死读**（传 `sub_457A20` 第 3 形参）/ op4=起始下标（选择器恒 0） | 有据豁免 |
 * | `0x2F3` | `sub_431A10` | 40724-40741 | op1/op2/op3 写 / **op4 是死读**（同上传第 3 形参）/ op5=起始下标 / op6=选择器 | 有据豁免 |
 * | `0x33F` | `sub_427A90` | 34412-34448 | **op1/op2/op3 全读**（写 `Scene+1260`/`Scene+1264`） | 缺消费端（效果常量通路未建模）⇒ 有据豁免，回链 `T-0017` |
 *
 * ★「死读」的判据是**被调函数的形参在函数体里一次都没出现**，不是"看不出用途"：
 * `sub_457960`（raw 69328-69364）与 `sub_457A20`（raw 69366-69406）只写自己的输出指针
 * `*a2/*a3/*a4`（= 第 2/3/4 形参）⇒ 调用方多传的那一格既不进比较、也不进输出。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine, Frame } from '../src/vm/engine.js';
import { StubNative } from '../src/vm/native.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import { normalizeTextureColor } from '../src/vm/handlers/gfx-texture.js';
import { dec } from '../src/vm/bits.js';
import type { BinArg } from '../src/script/bin.js';
import { im, instr, loc } from './harness.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', '..');

/**
 * 用**记录型 args** 跑一条 handler，返回被碰过的操作数（1-based）—— 与 `opcode-operands.test.ts`
 * 的 `runOne` 同一口径。
 */
function touched(op: number, args: BinArg[], native: StubNative): number[] {
  const e = new Engine(native);
  const f = new Frame();
  const seen = new Set<number>();
  const proxied = new Proxy(args, {
    get(t, p, r) {
      if (typeof p === 'string' && /^\d+$/.test(p)) seen.add(Number(p) + 1);
      return Reflect.get(t, p, r);
    },
  });
  const h = OPS.get(op) ?? NATIVE_OPS.get(op) ?? ENGINE_INTERNAL_OPS.get(op);
  assert.ok(h, `0x${op.toString(16)} 未注册`);
  h!(makeCtx(e, f, instr(op, proxied), native, () => {}));
  return [...seen].sort((a, b) => a - b);
}

/** 从守卫源码里取出 `ALLOW_UNDERRUN` 的键集（白名单 = "有据豁免"的登记处）。 */
function whitelistKeys(): Set<string> {
  const src = fs.readFileSync(path.join(ROOT, 'app/amayui-emulator/test/opcode-operands.test.ts'), 'utf8');
  const block = /const ALLOW_UNDERRUN[^{]*\{([\s\S]*?)\n\};/.exec(src);
  assert.ok(block, '找不到 ALLOW_UNDERRUN 定义（守卫结构变了？）');
  const keys = new Set<string>();
  for (const m of block[1]!.matchAll(/^\s*'([^']+)':/gm)) keys.add(m[1]!);
  return keys;
}

// ---------------------------------------------------------------------------
// 0x1F9：按体补实现（白名单条目**必须已删**）
// ---------------------------------------------------------------------------

test('★0x1F9 已按体补 op3 ⇒ 条目不许再出现在 ALLOW_UNDERRUN（修复的机械证明 = 删条目后守卫仍绿）', () => {
  assert.equal(whitelistKeys().has('0x1f9'), false, '`0x1f9` 已修复（引擎 raw 31225-31232 确实读 op3）⇒ 必须从 ALLOW_UNDERRUN 删掉');
  assert.deepEqual(
    touched(0x1f9, [im(1), im(2), im(3)], new StubNative(() => {})),
    [1, 2, 3],
    'argc=3 ⇒ 三格必须全被碰（漏 op3 正是审计 P2 那条）',
  );
});

test('★0x1F9 的颜色参（raw 31226-31230）：op3<0 ⇒ 0；否则 A 通道强置 0xFF 后随绑定下发', () => {
  const calls: Array<[string, number, number]> = [];
  const native = new StubNative(() => {});
  const spy = native as unknown as {
    bindTexture?: (imgid: number, slot: number) => void;
    setTextureObjectParam?: (slot: number, value: number) => void;
  };
  spy.bindTexture = (imgid, slot) => calls.push(['bind', imgid, slot]);
  spy.setTextureObjectParam = (slot, value) => calls.push(['param', slot, value]);

  const stepFresh = (args: BinArg[]): void => {
    const e = new Engine(native);
    const f = new Frame();
    const h = OPS.get(0x1f9) ?? NATIVE_OPS.get(0x1f9);
    assert.ok(h, '0x1f9 应在 OPS 或 NATIVE_OPS 里');
    h!(makeCtx(e, f, instr(0x1f9, args), native, () => {}));
    assert.equal(e.texSlots.get(196), 0x5250, '0x1F9 仍必须按 id 绑定槽（原有行为不回归）');
    assert.ok(e.isFileUsed(0x5250), '0x1F9 会打开文件 ⇒ 必须记「已使用」（鉴赏解锁判据）');
  };

  stepFresh([im(0x5250), im(196), im(0x00ff00)]);
  stepFresh([im(0x5250), im(196), im(-1)]);
  stepFresh([im(0x5250), im(196), im(0x123456)]);
  assert.deepEqual(calls, [
    ['bind', 0x5250, 196],
    ['param', 196, 0xff00ff00 | 0], // op3=0x00ff00 ⇒ A 被强置 0xFF（引擎 `| 0xFF00` 那一步）
    ['bind', 0x5250, 196],
    ['param', 196, 0], // op3<0 ⇒ 0（引擎 `if (v6 < 0) v7 = 0`）
    ['bind', 0x5250, 196],
    ['param', 196, 0xff123456 | 0], // ★`0xFFrrggbb` 的位模式（引擎是 i32 ⇒ 高位为 1 时是负数）
  ]);
  // ★与"重型兄弟" 0x249 同一条缝（同一个 sub_4A3800 的颜色参数口径可比对）
  assert.ok(OPS.has(0x249), '0x249 也走 setTextureObjectParam');
});

// ---------------------------------------------------------------------------
// 0x249（T-0086）：与 0x1F9 共用同一处归一化（两处 raw 逐字相同）
// ---------------------------------------------------------------------------

test('★0x249（T-0086）：op3 归一化与 0x1F9 共用一处 —— 负值仍下发 0、A 强置 0xFF、高位字节丢弃', () => {
  const calls: Array<[string, number, number]> = [];
  const native = new StubNative(() => {});
  const spy = native as unknown as {
    bindTexture?: (imgid: number, slot: number) => void;
    setTextureObjectParam?: (slot: number, value: number) => void;
  };
  spy.bindTexture = (imgid, slot) => calls.push(['bind', imgid, slot]);
  spy.setTextureObjectParam = (slot, value) => calls.push(['param', slot, value]);

  const stepFresh = (op3: number): void => {
    const e = new Engine(native);
    const f = new Frame();
    const h = OPS.get(0x249) ?? NATIVE_OPS.get(0x249);
    assert.ok(h, '0x249 应在 OPS 或 NATIVE_OPS 里');
    h!(makeCtx(e, f, instr(0x249, [im(0x5250), im(196), im(op3)]), native, () => {}));
    assert.equal(e.texSlots.get(196), 0x5250, '0x249 仍必须按 id 绑定槽（原有行为不回归）');
    assert.ok(e.isFileUsed(0x5250), '0x249 会打开文件 ⇒ 必须记「已使用」');
  };

  // ①作**枚举值**看（`im(0x80123456)` 在 JS 侧是正数，但引擎/emulator 的操作数域是 i32）：
  stepFresh(-1); // 域内 = i32 的 -1（高位字节 0xFF）⇒ 走 `v6 < 0` 分支
  stepFresh(0x00123456); // 域内正数
  stepFresh(0x00abcdef); // 域内正数、低 24 位全非零
  assert.deepEqual(calls, [
    ['bind', 0x5250, 196],
    ['param', 196, 0], // ★负值 ⇒ 0（引擎 raw 32751-32752 `if (v6 < 0) v7 = 0`）—— 仍下发，不是跳过
    ['bind', 0x5250, 196],
    ['param', 196, 0xff123456 | 0], // op3=0x00123456 ⇒ A 被强置 0xFF（raw 32754）
    ['bind', 0x5250, 196],
    ['param', 196, 0xffabcdef | 0],
  ]);

  // ②作**位模式**看（任务书那条 `0x80123456`）：JS 的 `im()` 走 `| 0`，`0x80123456|0` 就是 i32 的
  //    负数 -2146290602 ⇒ 与 ①的第一条同分支 ⇒ 断言 0（这是"负值落 0"的**正确**结果）。
  assert.equal(
    normalizeTextureColor(0x80123456),
    0,
    '★`0x80123456 | 0 < 0` ⇒ 引擎 `if (v6 < 0) v7 = 0` ⇒ 0（不是 0xFF123456：那个位模式只属于域内值 0x00123456）',
  );
  // ③与 0x1F9 **共用同一处实现**（两处 raw 逐字相同）⇒ 逐值钉死位模式
  assert.equal(normalizeTextureColor(-1), 0);
  assert.equal(normalizeTextureColor(0x00123456), 0xff123456 | 0);
  assert.equal(normalizeTextureColor(0x00abcdef), 0xffabcdef | 0);
  // ④`.lst` 口径核对：本实现 ≡ 引擎的 `sar`/`movzx` 序列（`sub_425310` `.text:004253AF/BA`）。
  //    低 24 位**全枚举**（用计数器而不是 1677 万次 assert，避免把守卫拖慢到几百 ms）。
  const engineFormula = (v: number): number => {
    const v6 = v | 0;
    if (v6 < 0) return 0;
    return (((((v6 >> 16) | 0xff00) << 8) | ((v6 >> 8) & 0xff)) << 8) | (v6 & 0xff);
  };
  let mismatches = 0;
  let firstBad = -1;
  for (let v = 0; v < 0x1000000; v++) {
    if (normalizeTextureColor(v) !== engineFormula(v)) {
      mismatches++;
      if (firstBad < 0) firstBad = v;
    }
  }
  for (const v of [0, -1, -2147483648, 0x7fffffff, 0xff123456 | 0, 0x80abcdef | 0, 0x80123456]) {
    if (normalizeTextureColor(v) !== engineFormula(v)) {
      mismatches++;
      if (firstBad < 0) firstBad = v;
    }
  }
  assert.equal(mismatches, 0, `与引擎公式的分叉数（首个分叉值 ${firstBad}）`);
});

// ---------------------------------------------------------------------------
// 0x1D3 / 0x1D4 / 0x2F3：那一格是"引擎也不消费的死读" ⇒ 有据豁免（不许补假读）
// ---------------------------------------------------------------------------

test('★0x1D3/0x1D4/0x2F3/0x33F 的豁免条目必须留在白名单里，且 emulator 只碰引擎真正消费的格', () => {
  const wl = whitelistKeys();
  for (const k of ['0x1d3', '0x1d4', '0x2f3', '0x33f']) {
    assert.ok(wl.has(k), `${k} 属于「引擎也不消费该格 / 缺消费端」的有据豁免 ⇒ 必须留在 ALLOW_UNDERRUN`);
  }
  // 逐条与体一致：0x1D3 op3 死读；0x1D4 op3 死读；0x2F3 op4 死读；0x33F op2/op3 无消费端
  assert.deepEqual(touched(0x1d3, [loc(1), loc(2), im(0), im(0), im(7)], new StubNative(() => {})), [1, 2, 4, 5]);
  assert.deepEqual(touched(0x1d4, [loc(1), loc(2), im(0), im(0)], new StubNative(() => {})), [1, 2, 4]);
  assert.deepEqual(touched(0x2f3, [loc(1), loc(2), loc(3), im(0), im(0), im(2)], new StubNative(() => {})), [1, 2, 3, 5, 6]);
  assert.deepEqual(touched(0x33f, [im(1), im(0xff), im(0xffffff)], new StubNative(() => {})), [1], '0x33F 目前只承载混合选择子');
});

test('★0x1D3/0x1D4/0x2F3：死读那格取任意值都不改变输出，且**它确实一次也没被碰**（补个裸 read 只会变成死读）', () => {
  const DEAD: Record<number, number> = { 0x1d3: 3, 0x1d4: 3, 0x2f3: 4 }; // 各条那格"死读"操作数的序号
  const run = (op: number, dead: number): { out: [number, number, number]; touched: number[] } => {
    const native = new StubNative(() => {});
    const e = new Engine(native);
    const f = new Frame();
    const h = OPS.get(op);
    const push = OPS.get(0x1d2);
    assert.ok(h && push, `0x${op.toString(16)} / 0x1d2 应在 OPS 里`);
    push(makeCtx(e, f, instr(0x1d2, [im(7), im(100)]), native, () => {})); // 文本项 key=7 value=100
    e.textItems.pushVoice(0, 0x7001, 0, 0, 0); // 语音项：通道 0、循环 0（`0xC4` 那条 push 的表模型）
    // 把那一格换成 dead，并记录 handler 到底碰了哪几格
    const args: BinArg[] =
      op === 0x1d3
        ? [loc(1), loc(2), im(dead), im(0), im(7)]
        : op === 0x1d4
          ? [loc(1), loc(2), im(dead), im(0)]
          : [loc(1), loc(2), loc(3), im(dead), im(0), im(0)];
    const seen = new Set<number>();
    const proxied = new Proxy(args, {
      get(t, p, r) {
        if (typeof p === 'string' && /^\d+$/.test(p)) seen.add(Number(p) + 1);
        return Reflect.get(t, p, r);
      },
    });
    h(makeCtx(e, f, instr(op, proxied), native, () => {}));
    const rd = (s: number): number => dec(e.key, f.locals.int.get(s) ?? 0) | 0;
    return { out: [rd(1), rd(2), rd(3)], touched: [...seen].sort((a, b) => a - b) };
  };
  const EXPECT: Record<number, [number, number, number]> = {
    0x1d3: [1, 100, 0], // 文本项命中 key=7 ⇒ op1=1、op2=100；op3 不写
    0x1d4: [0x7001, 0, 0], // 语音项（选择器恒 0）⇒ op1=id、op2=循环位 0
    0x2f3: [0x7001, 0, 0], // 选择器 = op6 = 0 ⇒ 同一条
  };
  for (const op of [0x1d3, 0x1d4, 0x2f3]) {
    for (const dead of [0, -1, 0x7fffffff, 12345]) {
      const r = run(op, dead);
      assert.deepEqual(r.out, EXPECT[op], `0x${op.toString(16)} 的"死读"格=${dead} 不得改变任何输出`);
      assert.equal(
        r.touched.includes(DEAD[op]!),
        false,
        `★0x${op.toString(16)}：第 ${DEAD[op]} 格引擎读了也不用（被调函数形参未出现）⇒ emulator 不得碰它（碰了就是死读）`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 0x33F：引擎三格全读，但 emulator 缺消费端 ⇒ 有据豁免（写明缺什么 + 回链券）
// ---------------------------------------------------------------------------

test('★0x33F：op2/op3（α/颜色）引擎确实读（raw 34423-34446）⇒ 豁免条目必须写"缺消费端 + T-0017"，不是"未定论"', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app/amayui-emulator/test/opcode-operands.test.ts'), 'utf8');
  const m = /'0x33f':\s*'([^']*)'/.exec(src);
  assert.ok(m, '0x33f 的豁免条目必须存在（它没有可写入的消费端）');
  const reason = m[1]!;
  assert.match(reason, /T-0017/, '必须回链混合模式/效果通路的票');
  assert.match(reason, /3442[0-9]|3443[0-9]|3444[0-9]/, '必须带 raw 行号证据');
  assert.match(reason, /缺消费端|未建模|没有/, '必须点明缺什么（而不是"未定论"）');
});
