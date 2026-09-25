/** @tier T0 @kind core @subsystem adv */

/**
 * `T-0151`（消息窗 / 文本渲染修缺批）**`src/vm/**` 半边**的守卫 —— 逐条对着
 * `engine/天结_unpacked.exe_utf8.c` 的 raw 行号写（行号 = 本文件注释里的 `raw N`）。
 *
 * 覆盖的工作清单条目（`app/amayui-emulator/.tmp/p1-fix/p23-worklist2.md` §T-0151）：
 *  - `0x212`/`0x213`/`0x25D`（对象表项为空 ⇒ 两个写都跳过）
 *  - `0x2BD`/`0x2BE`（**第二个**字重格）
 *  - `0x75`/`0x197`（字号同步写进 5 / 4 格派生态 + 10 个窗对象）
 *  - `0x1A5`/`0x2FE`（可选字体表白名单警告；豁免 `"AGE Extend"`）
 *  - `0x303`（op2 **原样**存进 `win+288`，不归一）
 *  - `0x301`（`op1 == 0` ⇒ 默认窗重定向 + 对象表存在性门）
 *  - `0x6E` 的 ADV 门序（`ReadTextSkip` 门关闭时 `97050` **不参与**）
 *  - `0x82` 的 op3 bit6 / bit4-5（DrawItem id 起点后移 `win+132` / 移除 `win+276/+280`）
 *  - `0x7D`（十六进制串入队）**未实现的有据登记**
 *  - 三条**棘轮**（改前即绿，防回潮）：`0x73` 九格同构 / `0x71` 三条出口清 `122496` /
 *    `0x6E` 的 `0x8000000` 三个清零点 / `0x70` 的两组 w/h 语义槽
 *
 * 纪律：本文件只用共享 harness（`test/harness.ts`），不自造 `mk()` / 帧循环。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MsgWinInput } from '../src/text/layout.js';
import type { Engine } from '../src/vm/engine.js';
import { ADV_ACTIVE } from '../src/vm/engine.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { MSGWIN_OPS, MSGWIN_TEXT_GAPS } from '../src/vm/handlers/msgwin.js';
import { StubNative } from '../src/vm/native.js';
import { im, instr, loc, mkEngine, str } from './harness.js';

/** 记录 `c.log`（= `native.log`）的假件 —— 警告串断言用。 */
class LoggingNative extends StubNative {
  readonly logs: string[] = [];
  constructor() {
    super((m) => {
      this.logs.push(m);
    });
  }
  has(frag: string): boolean {
    return this.logs.some((l) => l.includes(frag));
  }
}

/** 记录 `msgWinSync` 载荷的假件 —— 发布通道（层序 / 区间）断言用。 */
class SyncNative extends StubNative {
  readonly syncs: { win: number; input: MsgWinInput }[] = [];
  constructor() {
    super(() => {});
  }
  override msgWinSync(win: number, input: MsgWinInput): void {
    this.syncs.push({ win, input });
  }
  last(): { win: number; input: MsgWinInput } {
    const v = this.syncs.at(-1);
    if (!v) throw new Error('没有记录到任何 msgWinSync');
    return v;
  }
}

/** 顺序派发 `n` 条指令。 */
async function run(e: Engine, n: number): Promise<void> {
  for (let i = 0; i < n; i++) await stepOnce(e);
}

/** 把 `message:ReadTextSkip` 设为 `v`（运行期配置对象就是注册表）。 */
function setReadTextSkip(e: Engine, v: number): void {
  if (!e.config) e.config = { values: new Map(), sections: [], order: new Map() };
  e.config.values.set('message:readtextskip', v);
}

// ---------------------------------------------------------------------------
// P2 · 消息窗对象表（`0x212`/`0x213`/`0x25D`）
// ---------------------------------------------------------------------------

test('★0x212/0x213/0x25D：窗对象表项为空 ⇒ 两个写都跳过（raw 31751-31753 / 31769-31774 / 33259-33264 的 `if (v)`）', async () => {
  const e = mkEngine([
    // 表外下标（引擎的表 = `Font[261..270]` 共 10 格 ⇒ 0..9）：不得凭空建对象
    instr(0x212, [im(12), im(0x11)]),
    instr(0x213, [im(12), im(0x22), im(0x23)]),
    instr(0x25d, [im(12), im(0x44), im(0x45)]),
    // 正对照：表内下标
    instr(0x212, [im(3), im(0x11)]),
    instr(0x213, [im(3), im(0x22), im(0x23)]),
    instr(0x25d, [im(3), im(0x44), im(0x45)]),
  ]);
  await run(e, 3);
  assert.equal(e.msgwin.objects.get(12), undefined, '表外下标必须**不建对象**（引擎读的是表外内存 ⇒ 不发明）');
  await run(e, 3);
  const o = e.msgwin.objects.get(3);
  assert.ok(o, '表内下标 3 是引擎真有的 10 格之一');
  assert.equal(o.f100, 0x11);
  assert.equal(o.f104, 0x22);
  assert.equal(o.f108, 0x23);
  assert.equal(o.f276, 0x44);
  assert.equal(o.f280, 0x45);
  // 10 格表本身（引擎 `Font[261..270]`，由构造创建；raw 24114-24152 无条件解引用 ⇒ 恒存在）
  for (let i = 0; i < 10; i++) assert.ok(e.msgwin.objects.get(i), `窗对象表第 ${i} 格必须存在`);
  assert.equal(e.msgwin.objects.get(10), undefined, '第 10 格起在表外');
});

// ---------------------------------------------------------------------------
// P2 · 字重：第二个格（`0x2BD` / `0x2BE`）
// ---------------------------------------------------------------------------

test('★0x2BD：真支同时写 `Font+218516` 与 `Font+1248`（raw 33393-33399）⇒ 第二个格 = Engine[21636]', async () => {
  const e = mkEngine([instr(0x2bd, [im(1)]), instr(0x2bd, [im(0)])]);
  await run(e, 1);
  assert.equal(e.engineValues.get(ENGINE_FIELD.fontWeight), 700, 'Font+218516（raw 33393）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.logfontMainWeight), 700, 'Font+1248（raw 33394）');
  await run(e, 1);
  assert.equal(e.engineValues.get(ENGINE_FIELD.fontWeight), 0, '假支写 0（raw 33398）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.logfontMainWeight), 0, '假支写 0（raw 33399）');
});

test('★0x2BE：真支同时写 `Font+218588` 与 `Font+1308`（raw 33413-33419）⇒ 第二个格 = Engine[21651]', async () => {
  const e = mkEngine([instr(0x2be, [im(1)]), instr(0x2be, [im(0)])]);
  await run(e, 1);
  assert.equal(e.engineValues.get(ENGINE_FIELD.rubyWeight), 700, 'Font+218588（raw 33413）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.logfontRubyWeight), 700, 'Font+1308（raw 33414）');
  await run(e, 1);
  assert.equal(e.engineValues.get(ENGINE_FIELD.rubyWeight), 0);
  assert.equal(e.engineValues.get(ENGINE_FIELD.logfontRubyWeight), 0, 'raw 33419');
});

// ---------------------------------------------------------------------------
// P2/P3 · 字号 setter 的派生态（`0x75` / `0x197`）
// ---------------------------------------------------------------------------

test('★0x75：字号同步写进 5 格（raw 24063-24070）—— `Font+201684/+1232/+101972` 与 `Font+1236/+101976`', async () => {
  const e = mkEngine([instr(0x75, [im(30)])]);
  await run(e, 1);
  assert.equal(e.engineValues.get(ENGINE_FIELD.fontSize), 30, 'Font+201684 / 4 = 71745（raw 24063）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.logfontMain), -30, 'Font+1232 = -a2（raw 24064）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.mainLfHeightVertical), -30, 'Font+101972（raw 24065）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.mainGlyphHalf), -15, 'Font+1236 = a2 / -2（raw 24068，C 向零截断）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.mainGlyphHalfVertical), -15, 'Font+101976（raw 24069）');
});

test('★0x197：注音字号写 4 格派生态（raw 24109-24112）—— 且是**整数向零截断**', async () => {
  const e = mkEngine([instr(0x197, [im(15)]), instr(0x197, [im(-15)])]);
  await run(e, 1);
  assert.equal(e.engineValues.get(ENGINE_FIELD.rubySize), 15, 'Font+218584 / 4 = 75970（raw 24108）');
  // C 的整数除法**向零截断**：15 / -2 = -7（不是 -8）。用 JS 写时必须 Math.trunc。
  assert.equal(e.engineValues.get(ENGINE_FIELD.rubyGlyphHalf), -7, 'Font+1296 = a2 / -2（raw 24109）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.rubyGlyphHalfVertical), -7, 'Font+102036（raw 24110）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.rubyLfHeight), -15, 'Font+1292 = -a2（raw 24111）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.rubyLfHeightVertical), -15, 'Font+102032（raw 24112）');
  await run(e, 1);
  assert.equal(e.engineValues.get(ENGINE_FIELD.rubyGlyphHalf), 7, '负字号：-15 / -2 = 7.5 → 7（向零截断的另一半）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.rubyLfHeight), 15, '-a2 = 15');
});

test('★0x197：新字号逐个写进 10 个窗对象（`Font[261..270]`）的 `+200`/`+204`（raw 24113-24152）', async () => {
  const e = mkEngine([instr(0x2be, [im(1)]), instr(0x197, [im(12)])]);
  await run(e, 1); // 先把注音 lfWeight 写成 700（`+204` 的来源是 `Font[327]` = Font+1308，raw 24113）
  await run(e, 1);
  for (let i = 0; i < 10; i++) {
    const o = e.msgwin.objects.get(i);
    assert.ok(o, `窗对象 ${i} 必须存在（raw 24114-24152 逐个无条件解引用）`);
    assert.equal(o.f200, 12, `窗对象 ${i} 的 +200 = 新字号（raw 24115-24152 每两行一格）`);
    assert.equal(o.f204, 700, `窗对象 ${i} 的 +204 = Font[327]（= Font+1308 的当前值）`);
  }
  assert.equal(e.msgwin.objects.get(10), undefined, '第 10 格在表外 ⇒ 不得被写');
});

// ---------------------------------------------------------------------------
// P2 · 面名白名单警告（`0x1A5` / `0x2FE`）
// ---------------------------------------------------------------------------

test('★0x1A5：不在可选字体表且非 "AGE Extend" ⇒ 打警告串（raw 41385-41392）；表内面名与 AGE Extend 不打', async () => {
  const n = new LoggingNative();
  const e = mkEngine(
    [instr(0x1a5, [str('存在しないフォント')]), instr(0x1a5, [str('AGE Extend')]), instr(0x1a5, [str('ＭＳ ゴシック')])],
    'FAKE.BIN',
    n,
  );
  await run(e, 3);
  assert.ok(n.has('警告：'), 'raw 41390 的 `警告：[%s]は選択可能フォントの一覧に含まれていません。`');
  assert.ok(n.has('存在しないフォント'), '警告串带面名');
  assert.equal(
    n.logs.filter((l) => l.includes('警告：')).length,
    1,
    '只有表外那一条打警告：`sub_428990` 命中（表内）与 `strcmp(Source, "AGE Extend") == 0` 都豁免（raw 41385）',
  );
});

test('★0x2FE：注音面名走同一道白名单警告（raw 41613-41620）+ 写 4 格注音派生态（raw 41622-41627）', async () => {
  const n = new LoggingNative();
  const e = mkEngine([instr(0x197, [im(15)]), instr(0x2fe, [str('でっち上げ')])], 'FAKE.BIN', n);
  await run(e, 2);
  assert.ok(n.has('警告：') && n.has('でっち上げ'), 'raw 41618 的警告串');
  assert.equal(e.engineValues.get(ENGINE_FIELD.rubyGlyphHalf), -7, 'Font+1296 = Font+218584 / -2（raw 41623，向零截断）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.rubyLfHeight), -15, 'Font+1292 = -Font+218584（raw 41626）');
});

// ---------------------------------------------------------------------------
// P3 · `0x303` 原样存 + `0x301` 默认窗重定向
// ---------------------------------------------------------------------------

test('★0x303：op2 **原样**写进 `win+288`（raw 68415）—— 不许归一成 0/1/2', async () => {
  const e = mkEngine([instr(0x303, [im(1), im(7), im(400)])]);
  await run(e, 1);
  const g = e.msgwin.geom(1);
  assert.equal(g.align, 7, 'raw 68415：`*(_DWORD *)(result + 288) = a3`（a3 = op2 原值）');
  assert.equal(g.alignWidth, 400);
});

test('★0x301：`op1 == 0` ⇒ 重定向到默认窗（raw 10748-10749）；对象表里没有该窗 ⇒ 什么都不做（raw 10750）', async () => {
  const e2 = mkEngine([instr(0x80, [im(4)]), instr(0x301, [im(0)])]);
  e2.msgwin.defaultWin = 4;
  const o4 = e2.msgwin.object(4);
  o4.f132 = 9;
  const o1 = e2.msgwin.object(1);
  o1.f132 = 5;
  await run(e2, 2);
  assert.equal(o4.f132, 0, 'op1 = 0 重定向到 `Font[307]` = 默认窗 4（raw 10748-10752）');
  assert.equal(o1.f132, 5, '窗 1 不是默认窗 ⇒ 不被碰');
  // 表外下标：`sub_404F80` 的 `if (*(Font + 4*v2 + 1044))` 门（raw 10750）不成立 ⇒ 什么都不做
  const e3 = mkEngine([instr(0x301, [im(12)])]);
  await run(e3, 1);
  assert.equal(e3.msgwin.objects.get(12), undefined, '门不成立 ⇒ 连对象都不建');
});

// ---------------------------------------------------------------------------
// P2 · `0x6E` 的 ADV 门序（ReadTextSkip 门关闭时 `97050` 不参与）
// ---------------------------------------------------------------------------

test('★0x6E 门序：`ReadTextSkip == 0` ⇒ `122455 = 0`，**跳读/自动位（`97050`）不得把它翻成 1**（raw 28339-28343）', async () => {
  const e = mkEngine([instr(0x6e, [im(1), str('あ')])]);
  setReadTextSkip(e, 0); // 门关（随包 INI 默认）
  e.msgwin.skipMirror = 1; // `Engine[1415]`：跳读中
  e.msgwin.skipMode = 1; // `Engine[97050]`：跳读/自动模式
  await run(e, 1);
  assert.equal(e.msgwin.showing, 0, '门关那一支**只有** `if (!122455) goto LABEL_11; else 122455 = 0`（raw 28341-28343）');
  assert.equal(e.effectFlags & ADV_ACTIVE, 0, '门关 ⇒ 不置 `0x8000000`');
});

test('★0x6E 门序：门开时 `97050` 只**保持**显示态（raw 28488-28490 的 `!sub_48F000` 支），不无中生有', async () => {
  // 门开 + 本页有内容 ⇒ 置 ADV 且 122455 = 1（raw 28358-28359）
  const a = mkEngine([instr(0x6e, [im(1), str('あ')])]);
  setReadTextSkip(a, 1);
  await run(a, 1);
  assert.equal(a.msgwin.showing, 1, '门开 + 本页有内容 ⇒ raw 28359 `122455 = 1`');
  assert.notEqual(a.effectFlags & ADV_ACTIVE, 0, 'raw 28358 `174801 |= 0x8000000`');
  // 门开 + 本页**没有**内容 + 跳读中 ⇒ 保持原值（0 就还是 0；raw 28352-28353 的 `if (97050) goto LABEL_11`）
  const b = mkEngine([instr(0x6e, [im(1), str('')])]);
  setReadTextSkip(b, 1);
  b.msgwin.skipMode = 1;
  await run(b, 1);
  assert.equal(b.msgwin.showing, 0, '`sub_48F000` 返回 0 + `97050 != 0` ⇒ 走 LABEL_11（**不清也不置**）');
});

// ---------------------------------------------------------------------------
// P3 · `0x82` 的 op3 位
// ---------------------------------------------------------------------------

test('★0x82：op3 bit6（0x40）把 DrawItem id 起点后移 `win+132`（raw 79684-79688）', async () => {
  const n1 = new SyncNative();
  const e1 = mkEngine([instr(0x82, [im(1), im(0), im(0), im(0), im(0)])], 'FAKE.BIN', n1);
  e1.textItems.pushText(1, 0, 0); // 过越界门（raw 79502 的 `v8 > a3`）
  e1.msgwin.object(1).f104 = 0x500;
  e1.msgwin.object(1).f132 = 7;
  await run(e1, 1);
  assert.equal(n1.last().input.style.itemId, 0, 'op3 无 bit6 ⇒ 旧表面被清（`+104/+108` 归零，raw 79644-79647）');

  const n2 = new SyncNative();
  const e2 = mkEngine([instr(0x82, [im(1), im(0), im(0x40), im(0), im(0)])], 'FAKE.BIN', n2);
  e2.textItems.pushText(1, 0, 0);
  e2.msgwin.object(1).f104 = 0x500;
  e2.msgwin.object(1).f132 = 7;
  await run(e2, 1);
  assert.equal(n2.last().input.style.itemId, 0x500 + 7, 'bit6 ⇒ 保留 `+104` 并把 `+132` 加进 id 起点（raw 79686-79688）');
});

test('★0x82：op3 bit4/bit5（0x30）另移除 `win+276/+280`（raw 79649-79653）', async () => {
  const e = mkEngine([instr(0x82, [im(1), im(0), im(0x10), im(0), im(0)])]);
  e.textItems.pushText(1, 0, 0);
  const o = e.msgwin.object(1);
  o.f276 = 0x600;
  o.f280 = 3;
  await run(e, 1);
  assert.equal(o.f276, 0, 'raw 79652 的 `sub_4ABB60(…, win+276, win+280)`');
  assert.equal(o.f280, 0);
});

// ---------------------------------------------------------------------------
// `0x82` 的颜色恢复端（raw 80239-80262）+ 覆写色进该窗快照（孪生 `0x1D1` 两项都有）
// ---------------------------------------------------------------------------

test('★0x82 颜色恢复（raw 80239-80262）：覆写色只在本次发布可见，收尾恢复成调用前的值 —— 不许泄漏到后续绘制', async () => {
  const n = new SyncNative();
  const seen: (number | undefined)[] = [];
  // 载荷是在 `emitWin` 里发出的 ⇒ 在发布点读一次全局填充色 = "本次重画用的色"
  const e = mkEngine([instr(0x82, [im(1), im(0), im(2), im(0xb690ff), im(0x000000)])], 'FAKE.BIN', n);
  const origSync = n.msgWinSync.bind(n);
  n.msgWinSync = (w: number, input: MsgWinInput): void => {
    seen.push(e.engineValues.get(ENGINE_FIELD.colorFill));
    origSync(w, input);
  };
  e.textItems.pushText(1, 0, 0); // 过越界门（raw 79502 的 `v8 > a3`）
  e.engineValues.set(ENGINE_FIELD.colorFill, 0x112233);
  e.engineValues.set(ENGINE_FIELD.colorOutline, 0x445566);

  await run(e, 1);

  assert.deepEqual(seen, [0xff90b6], '★发布点看到覆写色（`f807b` 的 BGR 读入 = 0xff90b6）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.colorFill), 0x112233, '★收尾恢复填充色（raw 80256-80262 的 guard `v145 != v138 || v158`）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.colorOutline), 0x445566, '★收尾恢复描边色（raw 80239-80245 的 guard `v146 != v128 || v158`）');

  // 不带 bit1 ⇒ 一个色都不动、也不进恢复块（raw 79663 `v158 = a4 & 2` 恒 0 且两格值未变）
  const e2 = mkEngine([instr(0x82, [im(1), im(0), im(0), im(0xb690ff), im(0)])]);
  e2.textItems.pushText(1, 0, 0);
  e2.engineValues.set(ENGINE_FIELD.colorFill, 0x112233);
  await run(e2, 1);
  assert.equal(e2.engineValues.get(ENGINE_FIELD.colorFill), 0x112233, '无 bit1 ⇒ 不改色（也不触发恢复写）');
});

test('★0x82 覆写色进该窗快照：目标窗**已有**字体快照时，覆写色仍必须到得了载荷（孪生 `0x1D1` 的 `captureFontStyle`）', async () => {
  const n = new SyncNative();
  const e = mkEngine(
    [instr(0x6e, [im(1), str('あ')]), instr(0x82, [im(1), im(0), im(2), im(0xb690ff), im(0x000000)])],
    'FAKE.BIN',
    n,
  );
  e.textItems.pushText(1, 0, 0); // 过越界门（raw 79502 的 `v8 > a3`）
  e.engineValues.set(ENGINE_FIELD.colorFill, 0x112233);
  await run(e, 1); // `0x6E` show-text ⇒ 该窗入队时就钉下了字体快照
  // 目标窗**已有快照**（= 该窗的文本早已入队过）⇒ `styleOfWin` 只认 `slot.fontStyle`（:251）
  const stale = e.msgwin.slot(1).fontStyle;
  if (!stale) throw new Error('前提不成立：该窗应当已有字体快照');
  assert.equal(stale.main.fill, '#332211', '前提：快照色 = 入队时刻的全局填充色（字段是 COLORREF ⇒ `hex6(bgrToRgb(0x112233))`）');

  await run(e, 1); // `0x82` 带覆写色

  const payload = n.last().input.style;
  assert.equal(payload.main.fill, '#ff90b6', '★覆写色进载荷（`f807b` 的 BGR 读入）—— 不换快照就会停留在旧色 #332211');
  assert.equal(payload.main.outline, '#000000', '描边同样（`f807c`）');
  assert.equal(payload.ruby.fill, '#ff90b6', '注音与正文共用同一套 `Font+1360/+1364` ⇒ 同步');
  assert.equal(e.engineValues.get(ENGINE_FIELD.colorFill), 0x112233, '全局字段仍被恢复（raw 80239-80262）');
  // ★发布期的换色必须**还原**：引擎这一笔不留持久状态（收尾把全局两格写回调用前的值），
  //   而 `config1-chain-advreturn-real.test.ts` 的探针要求 `i082` 那一刻该窗仍是"没有入队快照"。
  assert.equal(e.msgwin.slot(1).fontStyle, stale, '★发布后快照还原成原对象（不留发布期的临时样式）');
});

// ---------------------------------------------------------------------------
// P2 · `0x196` 的第 4 实参 = `Engine[97055]`（记账门）—— 它真正的后果在"记不记已画行"
// ---------------------------------------------------------------------------

test('★0x6E/0x196 的第 5 实参 = `Engine[97055]`：`i1bb 0` 期间**不记已画行**（raw 83941-83942 的 `if (a5 >= 0)`）', async () => {
  const on = mkEngine([instr(0x6e, [im(1), str('あ')]), instr(0x196, [im(1), str('い'), str('い')])]);
  await run(on, 2);
  assert.equal(on.textItems.records.length, 2, '门开（97055 = 0）⇒ 两段正文各记一条已画行');

  const off = mkEngine([instr(0x6e, [im(1), str('あ')]), instr(0x196, [im(1), str('い'), str('い')])]);
  off.engineValues.set(ENGINE_FIELD.textBaseGate, 0x80000000); // `i1bb 0`（暂停记账）
  await run(off, 2);
  assert.equal(off.textItems.records.length, 0, '★门关 ⇒ 一条都不记（但文本照样入队）');
  assert.equal(off.msgwin.textOf(1).includes('あ'), true, '排版/绘制不受这道门影响（raw 83941 之后照画）');
});

test('★0x6F 的换行记录同样受记账门（raw 81549 的 `if (a3 >= 0)`，a3 = `Engine[97055]`）', async () => {
  const on = mkEngine([instr(0x6e, [im(1), str('あ')]), instr(0x6f, [im(1)])]);
  await run(on, 2);
  assert.equal(on.textItems.records.length, 2, '正文 + 换行各一条');

  const off = mkEngine([instr(0x6e, [im(1), str('あ')]), instr(0x6f, [im(1)])]);
  off.engineValues.set(ENGINE_FIELD.textBaseGate, 0x80000000);
  await run(off, 2);
  assert.equal(off.textItems.records.length, 0, '★门关 ⇒ 换行记录也不 push');
});

// ---------------------------------------------------------------------------
// P3 · `0x72` 尾段的交付块门（`!(mask & 0x40)`）：跳读中不清 ADV、不挂等待门
// ---------------------------------------------------------------------------

test('★0x72：跳读中（`Engine[1415] != 0`）不进交付块 ⇒ 不清 ADV、不挂等待门（raw 28518 / 28539-28547）', async () => {
  const e = mkEngine([instr(0x6e, [im(1), str('あ')]), instr(0x72, [im(1)])]);
  setReadTextSkip(e, 1);
  await run(e, 1);
  assert.notEqual(e.effectFlags & ADV_ACTIVE, 0, '门开 ⇒ 0x6E 置 ADV');
  e.msgwin.skipMirror = 1; // = `0x88 1` 置的 `Engine[1415]`（raw 28487-28488 合成 mask bit6）
  e.msgwin.skipMode = 1;
  await stepOnce(e); // 0x72
  assert.notEqual(
    e.effectFlags & ADV_ACTIVE,
    0,
    '★跳读中 ⇒ 交付块（含 `174801 &= ~0x8000000`）整个被跳过（raw 28518）',
  );
  assert.equal(e.awaitingAdvance, false, '★ADV 仍置 ⇒ LABEL_17 的等待门不挂（raw 28540）');

  // 非跳读（`Engine[1415] == 0`）：照旧清 ADV + 挂等待门
  const n = mkEngine([instr(0x6e, [im(1), str('あ')]), instr(0x72, [im(1)])]);
  setReadTextSkip(n, 1);
  await run(n, 1);
  assert.notEqual(n.effectFlags & ADV_ACTIVE, 0);
  await stepOnce(n); // 0x72
  assert.equal(n.effectFlags & ADV_ACTIVE, 0, 'raw 28520：非跳读时清 `0x8000000`');
  assert.equal(n.awaitingAdvance, true, 'raw 28547：ADV 已清 ⇒ 挂等待推进门');
});

// ---------------------------------------------------------------------------
// P2 · `0x7D` 的有据登记
// ---------------------------------------------------------------------------


test('★0x7D（十六进制串入队）：未实现 ⇒ 必须在缺口表里诚实登记，且**不在**派发表里（不许静默）', () => {
  const gap = MSGWIN_TEXT_GAPS.find((g) => g.opcode === 0x7d);
  assert.ok(gap, '`MSGWIN_TEXT_GAPS` 必须登记 0x7D');
  assert.match(gap.raw, /^\d+(-\d+)?$/, 'raw 锚点格式 = 台账口径');
  assert.equal(
    MSGWIN_OPS.some(([op]) => op === 0x7d),
    false,
    '未实现 ⇒ 不得进 MSGWIN_OPS（否则等于谎报）；命中时由派发层抛 NotImplementedOp',
  );
  assert.equal(gap.handler, 'sub_41F580', 'raw 28736 的 handler');
});

// ---------------------------------------------------------------------------
// 棘轮（改前即绿）：`0x73` 九格同构 / `0x71` 三条出口 / `0x6E` 的三个清零点 / `0x70` 两组槽
// ---------------------------------------------------------------------------

test('★棘轮 0x73：CharGrid 的九格与 `sub_456430` 的 `v13[0..9]` 一一对应（raw 68292-68304）', async () => {
  const e = mkEngine([
    instr(0x73, [im(1), im(0x11), im(0x12), im(0x13), im(0x14), im(0x15), im(0x16), im(0x17), im(0x18), im(0x19)]),
  ]);
  await run(e, 1);
  const g = e.msgwin.gridOf(1);
  assert.ok(g);
  assert.equal(g.srcSurface, 0x13, 'win+60 ← op4 = a5（raw 68294）');
  assert.equal(g.originX, 0x14, 'win+64 ← op5（raw 68295）');
  assert.equal(g.originY, 0x15, 'win+68 ← op6（raw 68296）');
  assert.equal(g.cellW, 0x16, 'win+72 − +64 ← op7（raw 68297 的 v13[2]）');
  assert.equal(g.cellH, 0x17, 'win+76 − +68 ← op8（raw 68299 的 v13[4] = a9 + a7）');
  assert.equal(g.textX, 0x11, 'win+80 ← op2（raw 68292 的 v13[5] = a3）');
  assert.equal(g.textY, 0x12, 'win+84 ← op3（raw 68293）');
  assert.equal(g.gate, true, 'win+88 = 1（raw 68301）');
  assert.equal(g.cells, 0x18, 'win+92 = win+96 ← op9（raw 68302-68303）');
  assert.equal(g.tickMs, 0x19, 'op10 → `sub_453AD0`（raw 28619-28620）');
});

test('★棘轮 0x71：三条出口都写 `122496 = 0`（raw 28444/28449/28457）⇒ `msgwin.alt` 恒 0', async () => {
  const e = mkEngine([instr(0x71, [im(1)])]);
  e.msgwin.alt = 5; // 人为置非 0（引擎全库**没有**写非 0 的地方 ⇒ 只可能是外部注入）
  await run(e, 1);
  assert.equal(e.msgwin.alt, 0, 'raw 28444/28449/28457：三条出口一条不落');
});

test('★棘轮 0x6E：`0x8000000` 的三个清零点都在（raw 28520 的 0x72 / raw 24966 的 0xFA / raw 20144 的显示态泵）', async () => {
  /** 门开时让 `0x6E` 置上 ADV（raw 28358），并把 `0x72` 排在它后面。 */
  const armed = (): Engine => {
    const e = mkEngine([instr(0x6e, [im(1), str('あ')]), instr(0x72, [im(1)])]);
    setReadTextSkip(e, 1);
    return e;
  };
  const a = armed();
  await run(a, 1);
  assert.notEqual(a.effectFlags & ADV_ACTIVE, 0);
  a.serviceAdv(); // = 引擎显示态主泵 `sub_411900` 的「未显示完判定」（raw 20144）
  assert.equal(a.effectFlags & ADV_ACTIVE, 0, '显示态泵：`!122455 && !122496 && !(mask & 0x40)` ⇒ 清 `0x8000000`');

  const b = armed();
  await run(b, 2); // 0x6E 置 ADV → 0x72（raw 28520 在 `!122496 && !(mask & 0x40)` 块里）
  assert.equal(b.effectFlags & ADV_ACTIVE, 0, '`0x72` raw 28520');

  const e2 = mkEngine([instr(0xfa, [])]);
  setReadTextSkip(e2, 1);
  e2.effectFlags |= ADV_ACTIVE;
  await run(e2, 1);
  assert.equal(e2.effectFlags & ADV_ACTIVE, 0, '`0xFA` raw 24966');
});

test('★棘轮 0x70：w/h 同时写进几何与换行边界两组槽（raw 73157-73163），`0x1C1` 只改后者', async () => {
  const e = mkEngine([instr(0x70, [im(1), im(880), im(148), im(190), im(557)]), instr(0x1c1, [im(1), im(600), im(120)])]);
  await run(e, 1);
  const g = e.msgwin.geom(1);
  assert.equal(g.w, 880, '`v10[5] = a3`（win+20，raw 73157）');
  assert.equal(g.h, 148, '`v10[6] = a4`（win+24，raw 73158）');
  assert.equal(g.wrapRight, 880, '`+36 = a3`（raw 73162）');
  assert.equal(g.wrapBottom, 148, '`+40 = a4`（raw 73163）');
  assert.equal(g.x, 190, '`+12 = a5`（raw 73154）');
  assert.equal(g.y, 557, '`+16 = a6`（raw 73155）');
  await run(e, 1);
  assert.equal(g.w, 880, '`0x1C1`（`sub_4563D0`）只写 `+36/+40` ⇒ 几何不变');
  assert.equal(g.wrapRight, 600);
  assert.equal(g.wrapBottom, 120);
});
