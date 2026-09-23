/** @tier T1 @kind core @subsystem frame */

/**
 * **T-0102 章节推进链的判据**（2026-09-23，用 T-0114 的远程调试器在真运行上取证后补的棘轮）。
 *
 * ## 这一轮订正了什么（先说结论，免得后人再踩）
 *
 * T-0102 的 §E 曾把「`SCJUMP` 把 `global 0` 从 6 盖成 1」记成「**两道门都没挡住**」，并把门量写成
 * `1dd7/3318/1521/2f3c`（`$1$SCJUMP.txt` 的读法）。远程调试器实测推翻了这个底稿：
 *
 * 1. **跑的不是 `$1$SCJUMP.txt`**：运行期帧栈是 `SYSTEM4 → ALLMAP → SCJUMP.BIN`，而 `SCJUMP.BIN`
 *    有 **16059** 条指令（= `src/SCJUMP.txt`，18152 行）；`src/$1$SCJUMP.txt` 只有 698 行（包 1 变体）。
 * 2. **门的变量名是 `13d7`/`13d8`/`13d9`…，不是 `1dd7`**（`SCJUMP.txt:39/48/57`）。
 * 3. 这些量是**「该节已演过」标志**，`SCJUMP` 因此是一个「**跳到第一个没演过的节**」的进度机；
 *    `mov (global-int 0) 1` 是**选中某节**（`g0 = 1` = SYSTEM4 的「ADV シナリオ実行」模式）—— **设计如此**。
 * 4. `global 0 == 6` 才是「NOVEL 模式」⇒ 窗口走 `create-mesh` 半透明黑幕；`!= 6` 走 `draw-texture`
 *    的纸窗。**只有 `SC0000` 的 G0000（序章）段写 `6`**（`SC0000.txt:1292`），G0001 段一处都不写
 *    ⇒ 选中 G0001 之后 `g0` 停在 1、窗口变纸窗（= 用户报的白底）。
 *
 * ## 这两组断言在钉什么
 *
 * - **行为组**（真 BIN，`install/SCJUMP.BIN`）：把 `jcc` 的**真极性**钉死 —— 它同时钉住
 *   `cond≠0 → op2`、`op2==0xFFFFFFFF 表示落下句`、以及「跳过已演过的节」这套语义。
 *   ★**判别力**：若把 `jcc` 读成 `cond≠0 → op3`（= T-0102 §E 曾经的读法），
 *   `13d7=1 & 13d8=0` 那一组的 `3f3c` 会变成 `0`，本用例立刻红。
 * - **源棘轮组**：把「跑的是哪一个 SCJUMP」「门读哪个变量」「模式分派器在哪」「只有谁写 6」
 *   四件事钉在脚本真源上（便宜、不需要跑链路）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/vm/engine.js';
import { StubNative } from '../src/vm/native.js';
import { parseScriptBytes } from '../src/script/bin.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { enc } from '../src/vm/bits.js';
import { decIntSlot } from '../src/vm/ref.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

const SCJUMP_BIN = path.join(ROOT, 'install', 'SCJUMP.BIN');

/** 把 `install/<name>` 装进当前帧（真 BIN；`SCJUMP` 是 18152 行的巨型分派，不适合造合成脚本）。 */
function loadReal(name: string, file: string): Engine {
  const e = new Engine(new StubNative(() => {}));
  const bytes = new Uint8Array(fs.readFileSync(file));
  const script = parseScriptBytes(bytes);
  loadScriptIntoFrame(e.curScript(), script, name);
  return e;
}

/** 读全局 int（**解码后**；池里存的是 ENC 过的值 —— 与 `debugQuery` 的 `global` 同口径）。 */
function g(e: Engine, idx: number): number {
  return decIntSlot(e.key, e.globals.int.get(idx));
}

/** 写全局 int（按当前 `key` 编码）。 */
function setG(e: Engine, idx: number, v: number): void {
  e.globals.int.set(idx, enc(e.key, v));
}

/**
 * 跑固定步数，并回报「`global 0` 第一次被写」时**正在执行的那条指令的 ip**。
 *
 * 为什么必须跑够步数才断言：`mov global0 1`（idx 42）之后**下一条**才是 `mov 3f3c 1`（idx 43）
 * ⇒ 一看到 `global0` 变了就断言 `3f3c`，会读到**还没写**的旧值（首版就是这么假红的）。
 * ip 本身也是判据：写发生在 idx 42（G0001 支）还是 35（G0000 支），直接区分两条支。
 */
async function runSteps(e: Engine, n: number): Promise<{ firstWriteIp: number | null }> {
  const before = g(e, 0);
  let firstWriteIp: number | null = null;
  for (let i = 0; i < n; i++) {
    const fr = e.curScript();
    if (!fr || fr.script === null) break;
    const ipBefore = fr.ip;
    await stepOnce(e);
    if (firstWriteIp === null && g(e, 0) !== before) firstWriteIp = ipBefore;
  }
  return { firstWriteIp };
}

test('★T-0102：SCJUMP 的节选择 —— `13d7=1`（序章已演）时选中 G0001（`3f3c=1`，g0=1）', async (t) => {
  if (!fs.existsSync(SCJUMP_BIN)) return t.skip('install/SCJUMP.BIN 不存在（无资源的环境）');
  const e = loadReal('SCJUMP.BIN', SCJUMP_BIN);
  setG(e, 0x3f3d, 1); // 章号：ALLMAP 在 `b22a == 0` 时置的（运行期实测）
  setG(e, 0x13d7, 1); // ★序章 G0000 已演（SC0000.txt:1282 写的）
  setG(e, 0x13d8, 0); // G0001 还没演（实测「未写过」= 0）
  setG(e, 0xf8080, 0x7fffffff); // SETADVFLAG 抬满 ⇒ `gr f8080, 10` 放行
  const { firstWriteIp } = await runSteps(e, 30);
  assert.equal(g(e, 0), 1, 'SCJUMP 应把 global0 写成 1（= SYSTEM4 的「ADV シナリオ」模式）');
  assert.equal(
    firstWriteIp,
    42,
    '★写必须落在 idx 42（G0001 支的 `mov global0 1`）—— 若 jcc 极性读反（cond≠0→op3），会落在 idx 35',
  );
  assert.equal(g(e, 0x3f3c), 1, '★应选中 G0001（3f3c=1）');
  assert.equal(g(e, 0xf8080), 10, '选完必须落再入锁（f8080=10）');
});

test('★T-0102：同一支脚本在 `13d7=0`（序章未演）时选中 G0000（`3f3c=0`，写落在 idx 35）', async (t) => {
  if (!fs.existsSync(SCJUMP_BIN)) return t.skip('install/SCJUMP.BIN 不存在（无资源的环境）');
  const e = loadReal('SCJUMP.BIN', SCJUMP_BIN);
  setG(e, 0x3f3d, 1);
  setG(e, 0x13d7, 0);
  setG(e, 0xf8080, 0x7fffffff);
  const { firstWriteIp } = await runSteps(e, 30);
  assert.equal(g(e, 0), 1, '两条支都会把 global0 写成 1（进入 ADV 模式）');
  assert.equal(firstWriteIp, 35, '★13d7=0 ⇒ 走 idx 35（G0000 支）');
  assert.equal(g(e, 0x3f3c), 0, '★应选中 G0000（3f3c=0）');
});

test('★T-0102：运行的是 `src/SCJUMP.txt`，不是 `src/$1$SCJUMP.txt`（两者门量不同）', () => {
  const srcDir = path.join(ROOT, 'src');
  const big = fs.readFileSync(path.join(srcDir, 'SCJUMP.txt'), 'utf8').split('\n');
  const pack1 = fs.readFileSync(path.join(srcDir, '$1$SCJUMP.txt'), 'utf8').split('\n');

  // ① `3f3d == 1` 那一支的第一道门读 `13d7`（真源）—— `1dd7` 是**包 1 变体**的读法
  const at = big.findIndex((l) => l === 'label_00000390');
  assert.ok(at > 0, 'SCJUMP.txt 应有 label_00000390（3f3d=1 那一支）');
  assert.equal(big[at + 1], 'ne (local-int 1) (global-int 13d7) 1', '这一支的门应读 13d7');
  assert.equal(big[at + 5], 'mov (global-int 0) 1', '该支的 G0000 选择写（idx 35）应在门之后');
  const at1 = pack1.findIndex((l) => l === 'label_00000390');
  assert.ok(at1 > 0, '$1$SCJUMP.txt 也应有同名的段头');
  assert.match(pack1[at1 + 1]!, /\(global-int 1dd7\)/, '$1$SCJUMP.txt 才是读 1dd7 的那个（两者别混）');

  // ② 规模差异就是"跑错了文件"最容易看出来的地方：1.8 万行 vs 几百行
  assert.ok(big.length > 18000, `SCJUMP.txt 应有 1.8 万行；实际 ${big.length}`);
  assert.ok(pack1.length < 1000, `$1$SCJUMP.txt 应只有几百行；实际 ${pack1.length}`);
});

test('★T-0102：`global 0` 是 SYSTEM4 的**実行モード分派键**（1=ADV 内联，2..8=各场景脚本）', () => {
  const sys = fs.readFileSync(path.join(ROOT, 'src', 'SYSTEM4.txt'), 'utf8');
  // g0==1 ⇒ **不**进场景分派，落到内联的 ADV 管线
  assert.match(
    sys,
    /eq \(local-int 0\) \(global-int 0\) 1\njcc \(local-int 0\) ffffffff label_00001cb0/,
    'SYSTEM4 应有「g0==1 ⇒ 落下句（内联 ADV）」的分派',
  );
  // g0==2..8 ⇒ call-script 各场景脚本（注释里带脚本名 —— 用它当锚点，顺带证明映射）
  for (const line of [
    'eq (local-int 0) (global-int 0) 2',
    'call-script 5265  // ALLMAP',
    'call-script 5266  // REIGN',
    'call-script 5267  // FIELD',
    'call-script 5268  // NOVEL',
    'call-script 5269  // STUDIO',
    'call-script 526a  // DEAL',
  ]) {
    assert.ok(sys.includes(line), `SYSTEM4 缺分派行：${line}`);
  }
  // 「不正な実行モード」—— 越界模式会 abort（说明这个键就是模式，不是随手用的临时量）
  assert.ok(sys.includes('不正な実行モード'), 'SYSTEM4 的越界分支必须还在（模式键的证据）');
});

test('★T-0102：`mov (global-int 0) 6` 全语料只有 `SC0000.txt:1292`（G0000/序章段）', () => {
  const srcDir = path.join(ROOT, 'src');
  const sc = fs.readFileSync(path.join(srcDir, 'SC0000.txt'), 'utf8').split('\n');
  const hits = sc
    .map((l, i) => ({ l, n: i + 1 }))
    .filter((x) => x.l.includes('mov (global-int 0) 6'));
  assert.equal(hits.length, 1, `SC0000 里应只有一处写 6；实际 ${JSON.stringify(hits)}`);
  const at = hits[0]!.n;
  // 它必须落在 G0000（序章）段里：段头是 `label_000049f4` + `mov (global-int 13d7) 1`
  const head = sc.slice(0, at).join('\n');
  assert.ok(
    head.lastIndexOf('label_000049f4') > head.lastIndexOf('label_00004ab8'),
    '`mov global0 6` 必须属于 G0000（label_000049f4）段，而不是 G0001（label_00004ab8）段',
  );
  // G0001 段（序章：遺跡に入る）里一处都不写 ⇒ 选中 G0001 之后 g0 停在 1 ⇒ 窗口走纸窗支
  const g1Start = sc.findIndex((l) => l === 'label_00004ab8');
  assert.ok(g1Start > 0, 'SC0000 应有 G0001 段头 label_00004ab8');
  const nextSection = sc.findIndex((l, i) => i > g1Start && l.startsWith('comment "▼'));
  const g1Body = sc.slice(g1Start, nextSection < 0 ? g1Start + 80 : nextSection).join('\n');
  assert.equal(
    /\(global-int 0\)/.test(g1Body),
    false,
    '★G0001 段不得出现任何 `(global-int 0)`（它靠 G0000 留下的 6，而 SCJUMP 会先把它改成 1）',
  );
});
