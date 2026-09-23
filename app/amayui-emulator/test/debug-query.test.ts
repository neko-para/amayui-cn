/** @tier T0 @kind tool @subsystem tool */

/**
 * `T-0114` 第 1 步守卫：**调试查询（direct query）**。
 *
 * 覆盖三件事：
 *  1. **值口径**：`global` 必须给"**解码后**"的值（引擎 int 池内存里是 ENC 过的；脚本写 6 存的是 `enc(key,6)`）
 *     —— T-0102 真的踩过这个坑（只看 raw `0x4000` 判不出是 1 还是 6）；
 *  2. **未写过 = 0**：与操作数读侧同口径（`decIntSlot(key, undefined) === 0`），且要**显式标出**"未写过"；
 *  3. **纯只读 + 不 eval**：查询不得改变引擎状态（跑前后快照一致）；源码里不许出现 `eval(`/`new Function`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Engine } from '../src/vm/engine.js';
import { StubNative } from '../src/vm/native.js';
import { enc } from '../src/vm/bits.js';
import { runQuery } from '../src/vm/debugQuery.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SRC = path.join(ROOT, 'app/amayui-emulator/src/vm/debugQuery.ts');

function mkEngine(): Engine {
  const e = new Engine(new StubNative(() => {}));
  e.key = 0;
  return e;
}

test('★global 给的是**解码后**的值（脚本写 6 ⇒ 报 6，不是 raw 0x18000）', () => {
  const e = mkEngine();
  e.globals.int.set(0, enc(e.key, 6));
  const r = runQuery(e, 'global 0');
  assert.equal(r.ok, true);
  assert.match(r.lines[0]!, /= 6 /, `应报解码值 6；实得 ${r.lines[0]}`);
  assert.match(r.lines[0]!, /raw 0x18000/, '同时给出原始编码值，便于与脚本字面量对照');
});

test('★未写过的全局：报"未写过"且值按 0（与操作数读侧同口径）', () => {
  const e = mkEngine();
  const r = runQuery(e, 'global 1dd7');
  assert.equal(r.ok, true);
  assert.match(r.lines[0]!, /未写过/);
  assert.match(r.lines[0]!, /= 0 /);
});

test('global 支持批量（count）与 hex 下标', () => {
  const e = mkEngine();
  e.globals.int.set(0x10, enc(e.key, 7));
  e.globals.int.set(0x11, enc(e.key, 8));
  const r = runQuery(e, 'global 10 2');
  assert.equal(r.lines.length, 2);
  assert.match(r.lines[0]!, /global 0x10 = 7 /);
  assert.match(r.lines[1]!, /global 0x11 = 8 /);
});

test('frame 折叠空槽、列出活帧；给下标则展开且带局部量', () => {
  const e = mkEngine();
  const fr = e.frames[0]!;
  fr.name = 'SN0000.BIN';
  fr.scriptId = 0x74; // ★活帧判据之一：scriptId >= 0（新建 Engine 的 frames[i] 默认 scriptId=-1 ⇒ 算空槽）
  fr.locals.int.set(1, enc(e.key, 3));
  // 第 1 帧做成"调用链上的活帧"（有脚本对象、ip 有进展）
  const fr1 = e.frames[1]!;
  fr1.name = 'DRAWCHARM.BIN';
  fr1.scriptId = 0x46;
  fr1.ip = 151;
  fr1.script = { instructions: new Array(152) } as never;

  const list = runQuery(e, 'frame');
  assert.equal(list.ok, true);
  assert.match(list.lines[0]!, /cur=0/, '首行给出 cur');
  assert.match(list.lines[0]!, /活帧 2/, '首行给出活帧数（用户实测 40 帧里绝大多数是空壳）');
  assert.ok(
    list.lines.some((l) => l.includes('SN0000.BIN')) && list.lines.some((l) => l.includes('DRAWCHARM.BIN')),
    `活帧应列出脚本名；实得 ${JSON.stringify(list.lines)}`,
  );
  assert.ok(
    !list.lines.some((l) => l.startsWith('  [3]')),
    '空槽**不该**逐条展开（应折叠）',
  );

  const all = runQuery(e, 'frame all');
  assert.ok(
    all.lines.some((l) => l.startsWith('  [3]')),
    '`frame all` 应强制全列（含空槽）',
  );

  const one = runQuery(e, 'frame 0');
  assert.ok(
    one.lines.some((l) => l.includes('local 0x1 = 3')),
    `展开帧应列出解码后的局部量；实得 ${JSON.stringify(one.lines)}`,
  );
});

test('未知命令 / 参数缺失：ok=false 且给出用法', () => {
  const e = mkEngine();
  for (const q of ['nope', 'global', 'slot', 'flocal 1']) {
    const r = runQuery(e, q);
    assert.equal(r.ok, false, `「${q}」应失败`);
    assert.ok(r.lines.length > 1, '失败时要给帮助');
  }
});

test('★纯只读：查询前后引擎状态不变', () => {
  const e = mkEngine();
  e.globals.int.set(0, enc(e.key, 6));
  e.frames[0]!.locals.int.set(2, enc(e.key, 9));
  // ★快照必须覆盖**门计时器**：`run` 查询曾用 `engine.gatePending(nowMs)` 取门状态，
  //   而那个方法**会写** `gateWaitStart` ⇒ 只读查询产生了副作用。
  //   首版守卫只快照 globals/locals/cur/ip/texSlots ⇒ **漏掉了这一类**。现在补齐。
  const snap = (): string =>
    JSON.stringify({
      g: [...e.globals.int.entries()],
      l: [...e.frames[0]!.locals.int.entries()],
      cur: e.cur,
      ip: e.frames[0]!.ip,
      tex: [...e.texSlots.entries()],
      gateWaitMs: e.gateWaitMs,
      gateWaitStart: e.gateWaitStart,
      sceneFreeze: e.sceneFreeze,
      scenePending: e.scenePending,
      waitFlags: e.waitFlags,
      effectFlags: e.effectFlags,
      engineValues: [...e.engineValues.entries()],
    });
  e.gateWaitMs = 1234; // 造一个"计时器在途"的态，逼出惰性写
  const before = snap();
  for (const q of ['global 0', 'local 2', 'frame', 'frame 0', 'slot 11', 'run', 'help', '?']) {
    runQuery(e, q);
  }
  const after = snap();
  assert.equal(after, before, '★查询不得改变引擎状态（含门计时器 —— 首版守卫漏了这一类）');
});

test('★源码棘轮：调试查询不许 eval（白名单解析）', () => {
  const src = fs.readFileSync(SRC, 'utf8');
  assert.ok(!/\beval\s*\(/.test(src), '不得使用 eval');
  assert.ok(!/new\s+Function\s*\(/.test(src), '不得使用 new Function');
});
