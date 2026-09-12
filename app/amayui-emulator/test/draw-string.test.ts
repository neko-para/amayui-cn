/**
 * 回归测试：**`0x204` draw-string（把一整串文本直绘进纹理槽）**。
 *
 * 症状（2026 实测）：「设置界面**中间的项目的文字没有渲染，而是全是纯白色**」。
 *
 * 引擎事实（raw）：
 *  - `0x204`（`sub_423390` raw 31454）：`op1`=纹理槽、`op2`=x、`op3`=y、`op4`=字符串 →
 *    `sub_456710(Font, 槽, 串, x, y)`（raw 68470）。**三个门**（raw 68478-68480）：
 *    该槽的 `CTexture` 必须存在、必须可锁定、串必须非空 —— 否则整条什么都不做。
 *  - 画的是 GDI 整串直绘：不清底、不换行，按 `GetTextMetricsA` 的高度落笔，
 *    字体/颜色/描边取自 `Font` 的全局字段（`+1360` 填充 / `+1364` 描边 / `+1372` 描边档位）。
 *  - `CONFIG1`（设置界面）用它把每行的"项目名 + 数值"写进一张 `create-texture 196 628 360`
 *    出来的离屏槽（`CONFIG1.txt:2760/2773`），再按行裁成 628×30 贴到行上（`:3019-3022`）。
 *    ⇒ 漏了本条：那张槽永远是空的，宿主只能把它当"程序化纹理"画成白块 ⇒ 中间一片纯白。
 *
 * 被测对象：opcode handler（经 `stepOnce`）+ 共享模型（`HeadlessScene`）+ 纯函数
 * `drawStringGlyphs`（字形推进/描边副本）。**canvas 光栅化本身**只在浏览器里有，
 * 由 Electron 侧验证（本文件不假装能测像素）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/vm/engine.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { drawStringGlyphs, advance } from '../src/text/layout.js';
import { TextureCache, canvasPixelSize } from '../src/renderer/pixi/textureCache.js';
import type { DrawStringStyle, NativeBridge } from '../src/vm/native.js';
import type { BinInstruction, ScriptBinary } from '../src/script/bin.js';

const H = 0x3c;
const T_IMM_INT = 0x0;
const T_IMM_STR = 0x2;

/** 造一条指令（与 `test/ops-142-12f-306.test.ts` 同一套最小脚手架）。 */
function script(opcode: number, args: { type: number; raw: number; str?: string }[]): ScriptBinary {
  const instr: BinInstruction = {
    opcode,
    name: `i${opcode.toString(16)}`,
    argc: args.length,
    args: args.map((a) => ({ type: a.type, raw: a.raw, ...(a.str !== undefined ? { str: a.str } : {}) })),
    byteOffset: H,
    index: 0,
  };
  return {
    signature: 'SYS4450 ',
    isVer5: false,
    headerLen: H,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
    ],
    instructions: [instr],
    labelTargets: new Set<number>(),
    raw: new Uint8Array(H + 4 + 8 * args.length),
  };
}

/** 记录 drawString 的宿主。 */
function recorder(): { native: NativeBridge; calls: { slot: number; x: number; y: number; text: string; style: DrawStringStyle }[] } {
  const calls: { slot: number; x: number; y: number; text: string; style: DrawStringStyle }[] = [];
  const native = {
    log: () => {},
    drawString: (slot: number, x: number, y: number, text: string, style: DrawStringStyle) => {
      calls.push({ slot, x, y, text, style });
    },
  } as unknown as NativeBridge;
  return { native, calls };
}

test('★0x204：读 op1..op4 并把「位置 + 文本 + 全局样式」交给宿主（CONFIG1 的写法）', async () => {
  const { native, calls } = recorder();
  const e = new Engine(native);
  // 全局样式字段（`CONFIG1.txt:2800-2802` 就是 `i075 1e` + `i076 ffffff` + `i077 ffffff` 这一组）
  e.msgwin.font.mainSize = 30;
  e.msgwin.font.mainBold = false;
  e.engineValues.set(21664, 0xffffff); // 填充色（0x76）
  e.engineValues.set(21665, 0x000000); // 描边色（0x77）
  e.engineValues.set(21667, 3); // 描边档位（Font+1372）
  e.engineValues.set(21670, 1);
  e.engineValues.set(21671, 1);

  loadScriptIntoFrame(
    e.curScript(),
    script(0x204, [
      { type: T_IMM_INT, raw: 196 }, // 纹理槽
      { type: T_IMM_INT, raw: 5 }, // x
      { type: T_IMM_INT, raw: 6 }, // y
      { type: T_IMM_STR, raw: 0, str: '窗口顕示' }, // 串（立即字符串操作数）
    ]),
    'TEST.BIN',
  );
  const t = await stepOnce(e);
  assert.notEqual(t.handlerKind, 'unimplemented', '0x204 必须是已实现指令（不再是宿主桩）');
  assert.equal(calls.length, 1, '应把整串交给宿主一次');
  assert.deepEqual([calls[0]!.slot, calls[0]!.x, calls[0]!.y, calls[0]!.text], [196, 5, 6, '窗口顕示']);
  assert.equal(calls[0]!.style.size, 30, '字号取全局主字号（Font+201684）');
  assert.equal(calls[0]!.style.fill, '#ffffff');
  assert.equal(calls[0]!.style.outline, '#000000');
  assert.equal(calls[0]!.style.outlineMode, 3);
});

test('★0x204：空串不画（引擎 raw 68480 的 `&& *a3` 门）', async () => {
  const { native, calls } = recorder();
  const e = new Engine(native);
  loadScriptIntoFrame(
    e.curScript(),
    script(0x204, [
      { type: T_IMM_INT, raw: 196 },
      { type: T_IMM_INT, raw: 0 },
      { type: T_IMM_INT, raw: 0 },
      { type: T_IMM_STR, raw: 0, str: '' },
    ]),
    'TEST.BIN',
  );
  await stepOnce(e);
  assert.equal(calls.length, 0);
});

test('★共享模型：直绘文本记进槽、快照可见；create-texture 重建表面时清空', () => {
  const s = new HeadlessScene({});
  s.createTexture(196, 628, 360, 0);
  const style: DrawStringStyle = {
    family: 'Amayui CN',
    size: 30,
    weight: 400,
    fill: '#ffffff',
    outline: '#000000',
    outlineMode: 3,
    outlineDx: 1,
    outlineDy: 1,
  };
  s.drawString(196, 5, 6, '窗口顕示', style);
  s.drawString(196, 5, 36, '画面模式', style);
  assert.deepEqual(
    s.scene.slotText.get(196)?.map((x) => x.text),
    ['窗口顕示', '画面模式'],
    '两条都记在槽 196 上',
  );
  const snap = s.snapshot();
  assert.deepEqual(snap.slotText, [{ slot: 196, count: 2, sample: '窗口顕示' }], '快照里能看到直绘文本');
  assert.match(s.snapshotText(), /slot-text slot=196 条数=2/, '人可读快照里也要有');
  // 引擎：create-texture 会新建表面 ⇒ 之前画上去的字随之消失
  s.createTexture(196, 628, 360, 0);
  assert.equal(s.scene.slotText.get(196), undefined, '重建表面应清掉直绘文本');
  // 程序化槽的尺寸由 create-texture 给出（`0x208` getter 用）
  assert.deepEqual(s.getTextureSize(196), { w: 628, h: 360 });
});

test('★纯函数：直绘文本按引擎等宽网格推进 + 描边副本位置', () => {
  // 半角 0.5em、全角 1em（引擎 lfWidth = 字高/2）
  assert.equal(advance('A', 30), 15);
  assert.equal(advance('窗', 30), 30);
  const g0 = drawStringGlyphs('A窗', 5, 6, 30, 0, 1, 1);
  assert.deepEqual(
    g0.map((g) => [g.ch, g.x, g.y, g.role, g.alpha]),
    [
      ['A', 5, 6, 'fill', 1],
      ['窗', 20, 6, 'fill', 1],
    ],
    '推进量：半角 15 → 全角 30；档位 0 只有一遍填充',
  );
  const g3 = drawStringGlyphs('窗', 100, 200, 30, 3, 2, 3);
  assert.equal(g3.length, 5, '档位 3 = 四次对角副本 + 一次填充');
  assert.deepEqual(
    g3.filter((g) => g.role === 'outline').map((g) => [g.x, g.y]),
    [
      [102, 203],
      [98, 197],
      [102, 197],
      [98, 203],
    ],
  );
  assert.deepEqual(g3.at(-1), { ch: '窗', x: 100, y: 200, role: 'fill', alpha: 1 });
  const g2 = drawStringGlyphs('窗', 0, 0, 30, 2, 0, 0);
  assert.deepEqual(
    g2.map((g) => [g.role, g.alpha]),
    [
      ['fill', 1],
      ['outline', 0.25],
    ],
    '档位 2 = 同位叠一遍 1/4 强度副本',
  );
});

test('★纹理槽：没先 create-texture 的槽上直绘 = 不画（引擎 raw 68478 的门）', () => {
  const logs: string[] = [];
  const tc = new TextureCache((m) => logs.push(m));
  const style: DrawStringStyle = {
    family: 'Amayui CN',
    size: 30,
    weight: 400,
    fill: '#ffffff',
    outline: '#000000',
    outlineMode: 0,
    outlineDx: 0,
    outlineDy: 0,
  };
  // 注意：Node 里没有 document ⇒ `create` 不会真的建 canvas（浏览器侧才有），
  // 因此这条只锁"没有表面就不画、并且要说清楚"这一条语义。
  tc.drawString(196, 5, 6, 'x', style);
  assert.ok(
    logs.some((l) => l.includes('没有 create-texture')),
    `应记一条"被忽略"的日志，实际：${logs.join(' | ')}`,
  );
});

/**
 * ★**程序化槽画布必须按 DPR 取物理尺寸**（2026-09 用户实测"非 ADV 窗口的字整体像粗体"的根因）。
 *
 * 直绘文本（`0x204 draw-string` → `0x1F8 create-texture` 的表面）曾按 **1×** 建画布，
 * 而消息窗文本（`rasterFrame`）按 DPR 光栅化 + `resolution: res`。两条路径的纹理进的是同一个
 * Pixi 舞台（logical 1280×720 @ resolution=DPR）⇒ 1× 的那张会被**放大 DPR 倍**显示：
 * 笔画发虚、边缘糊开，观感比消息窗文本粗一档。修法 = 槽画布同样 `ceil(逻辑×DPR)` 并把
 * `resolution` 告诉 Pixi（`cropSprite` 的 frame 本来就是逻辑坐标，Pixi 会按 resolution 折回）。
 *
 * 断言口径与 `text/raster.ts` 的 `rasterFrame` 完全一致（都是 `ceil(w*res)`）——两条路径不许再分叉。
 */
test('★程序化槽画布尺寸 = ceil(逻辑 × DPR)（与消息窗 rasterFrame 同口径）', () => {
  assert.deepEqual(canvasPixelSize(628, 360, 1), { cw: 628, ch: 360 }, 'DPR=1 时不变');
  assert.deepEqual(canvasPixelSize(628, 360, 1.25), { cw: 785, ch: 450 }, 'CONFIG1 的 628×360 槽在 1.25× 下的物理尺寸');
  assert.deepEqual(canvasPixelSize(628, 360, 2), { cw: 1256, ch: 720 }, 'DPR 上限 2');
  assert.deepEqual(canvasPixelSize(0, 0, 1.25), { cw: 1, ch: 1 }, '空尺寸不产生 0 宽画布');
  // 与消息窗路径同一条公式：日志里 615×115 的窗纹理 = 逻辑 492×92 @1.25
  assert.deepEqual(canvasPixelSize(492, 92, 1.25), { cw: 615, ch: 115 }, '与 [text] 纹理尺寸口径一致');
});
