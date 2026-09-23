/** @tier T0 @kind core @subsystem save */

/**
 * **读档装载点的画面语义（装载点按存档替换绘制项）与 A/B 模型一致** —— `tickets/T-0083`。
 *
 * 背景（2026-09 用户实测症状）：TITLE → Load Data → 读档，画面上留着 TITLE 的菜单板与那条
 * 「天空碎片阶梯」（handle 0x12C/0x12E/0x130/0x132/0x134，156×156）。
 *
 * ★2026-09 以体订正 —— 本文件此前的判据（"装载点不得整批清容器"）**是反的**：
 * 引擎的装载路径**清空并重装绘制项容器**（`sub_410160` raw 19806-19832）：
 *  ① delete-walk 释放 `Engine+323864` = **`Scene+1032`**（那张 740 B 绘制项 map）的全部结点，
 *     复位哨兵（`head->next = head`/`head->prev = head`/`head->last = head`）+ `size(Engine+323872) = 0`；
 *  ② 按存档 body 里那份清单逐条 `sub_49A300`（740 B 默认构造）→ `memcpy(scratch, p, 740)` →
 *     `sub_40C910`（find-or-create）+ `sub_40C310`（赋值）插回。
 * ⇒ **上一屏的绘制项一个不留，画面 = 存档当时的场景**。
 * 而 raw 19913-19915 的两次 `sub_403EF0` 复位的是**两个 仮想ディスプレイ**（`Engine+0x55D8`/`0xCAC0`；
 * 体 raw 9958-9971 = 点击热点/路由表 + 鼠标游标），**与绘制项无关** —— 旧注释把这两件事混成一条，
 * 才推出"引擎靠保留上一屏的绘制项把画面还原回来"。
 *
 * 本文件锁四件事：
 *  - 引擎真槽（body 里有可解析清单）⇒ 装载点必须**替换**绘制项：上一屏的项全部作废、存档那 N 项就位；
 *  - **不动网格**：引擎的清场只走 `Scene+1032` 那棵树（`Scene+1064` 的网格一个结点都不动）
 *    ⇒ `clearDrawContainer`/`clearMeshSlots` 都不许调（emulator 的 `clearDrawContainer` 会把网格一起清）；
 *  - body **没有**清单（本工程槽 `format = 0`／旧布局）⇒ 退回 (B) 步的 `ownerFrame` 近似；
 *  - **A/B 一致**：同一份脚本"正常跑到某句话"与"读档落到同一句话"，模型逐项相等。
 *
 * ★实证（真槽 79，`SAVE79.DAT`）：清单 69 条，第 1 条就是 SN0000 的背景 —— handle `0x18A88`、
 * slot 4、src (0,0,2048,1152)、dst (−768,−272)；第 2 条起 `0x19835…` 是 ADV 侧栏（正是 SN0000
 * 自己 `detach-texture 19834 19` 的区间）。早先清单没被消费（且步长算错成 744 B/条）⇒ TITLE 那些项
 * （handle 10..309，**全部**用槽 4）留在模型里，而 ②b 按存档把槽 4 重绑到 `BG050ABL`(2048×1152)
 * ⇒ 它们按标题屏的源矩形采这张背景 = 用户看到的那条台阶与那块采样越界的灰板。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Engine } from '../src/vm/engine.js';
import { OPS, NATIVE_OPS, loadScriptIntoFrame } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { parseScriptBytes } from '../src/script/bin.js';
import type { Item } from '../src/renderer/drawItem.js';
import { buildBody, buildScriptBin, buildSlotFile, drawItemRecord, SEEDS } from './engineSlotFixtures.js';

const im = (v: number): { type: number; raw: number } => ({ type: 0, raw: v });
const loc = (v: number): { type: number; raw: number } => ({ type: 0x9, raw: v });

/** 记账宿主：记下装载点调了哪些容器操作，其余交给共享模型。 */
class Screen extends HeadlessScene {
  readonly calls: string[] = [];
  constructor() {
    super({});
  }
  /** 让场景"画"一项（走共享层建项 ⇒ `ownerFrame` 记账与真实 `0x1FB` 路径一致）。 */
  draw(handle: number, slot: number, ownerFrame: number): void {
    this.configureDrawItem({
      handle,
      layer: handle,
      tex: slot,
      srcX: 0,
      srcY: 0,
      srcW: 0x500,
      srcH: 0x2d0,
      dstX: 0,
      dstY: 0,
      ownerFrame,
    });
  }
  override clearDrawContainer(): void {
    this.calls.push('clearDrawContainer');
    super.clearDrawContainer();
  }
  override clearMeshSlots(): void {
    this.calls.push('clearMeshSlots');
    super.clearMeshSlots();
  }
  override releaseFrameHold(): void {
    this.calls.push('releaseFrameHold');
    super.releaseFrameHold();
  }
  override dropFrameItems(frame: number): number {
    this.calls.push(`dropFrameItems:${frame}`);
    return super.dropFrameItems(frame);
  }
  override restoreDrawItems(items: readonly Item[]): number {
    this.calls.push(`restoreDrawItems:${items.length}`);
    return super.restoreDrawItems(items);
  }
}

/** 只提供"读槽 / 读脚本"的内存 FileSource。 */
function fakeSource(slot: number, bytes: Uint8Array, scriptId: number, script: Uint8Array): Engine['fileSource'] {
  return {
    readSaveSlot: async (s: number) => (s === slot ? bytes : null),
    readScript: async (id: number) =>
      id === scriptId ? { index: id, name: 'SN0000.BIN', data: script } : null,
  } as unknown as Engine['fileSource'];
}

/** 跑某帧的一条指令（用它自己的 opcode handler；两张注册表都要查，见 `handlers/index.ts`）。 */
async function run(e: Engine, frameIndex: number, ip: number): Promise<void> {
  const frame = e.frames[frameIndex]!;
  const instr = frame.script!.instructions[ip]!;
  const h = OPS.get(instr.opcode) ?? NATIVE_OPS.get(instr.opcode);
  assert.ok(h, `opcode 0x${instr.opcode.toString(16)} 未注册`);
  await h!(makeCtx(e, frame, instr, e.native, () => {}));
}

test('★真槽：装载点按存档**替换**绘制项（上一屏全部作废 + 存档那 2 项就位 + 网格不动）', async () => {
  // 引擎格式槽：1000 条图像槽记录里 4 号标了"要重载"、12 号只登记；纹理槽 3 号标了重载。
  // 绘制项清单：2 条（handle 0x18a88 = 背景 / 0x19835 = ADV 侧栏），记录体按引擎 740 B 布局。
  const script = buildScriptBin([{ op: 0xae, args: [] }]);
  const body = buildBody({
    savedCur: 0,
    savedRet: -1,
    pre8: 0,
    frames: [{ returnFrame: -1, scriptId: 100, retIdx: [], messageIdx: -1, callIdx: -1 }],
    ints: [],
    floats: [],
    strings: [],
    ipTables: [[], [], []],
    images: [{ at: 3, id: 0x999, flag: 1, param: 0 }],
    records: [
      { at: 4, id: 0x888, flag: 1, param: 0 },
      { at: 12, id: 0x777, flag: 0, param: 0 },
    ],
    drawItems: [
      { handle: 0x18a88, record: drawItemRecord({ tex: 4, src: [0, 0, 2048, 1152], pos: [-768, -272], flags: 3 }) },
      { handle: 0x19835, record: drawItemRecord({ tex: 17, src: [182, 794, 316, 1530], pos: [1148, 0] }) },
    ],
  });
  const bytes = buildSlotFile(body, { ...SEEDS, format: 3, aux: 20 });

  const screen = new Screen();
  const e = new Engine(screen);
  e.fileSource = fakeSource(3, bytes, 100, script);
  // "上一屏"：TITLE 那层（帧 1 画的，handle 10 = 全屏背景、0x12C = 菜单板）—— 引擎里它们**必须消失**；
  // 调用方菜单帧 2 画的 UI 层（0x1d4c0+）也一样；再放一项"不带 ownerFrame"的（取当前帧 = 2）。
  screen.draw(0xa, 4, 1);
  screen.draw(0x12c, 4, 1);
  screen.draw(0x1d4c0, 7, 2);
  screen.setCurrentFrame(2);
  screen.configureDrawItem({ handle: 0x1d600, layer: 0x1d600, tex: 7, srcX: 0, srcY: 0, srcW: 1, srcH: 1, dstX: 0, dstY: 0 });
  screen.setCurrentFrame(-1);
  // 网格（ADV 的幕/遮罩就是 MeshObj）：装载点**不得**动它（引擎的清场只走 Scene+1032）。
  screen.scene.meshes.set(0x19258, {
    handle: 0x19258,
    layer: 0x19258,
    flags: 1,
    state0: 0xffffffff,
    state1: 0,
    verts: [],
    baseColors: [],
    blend: 0,
  } as never);

  // 调用方 = 帧 2（SAVE/LOAD 菜单）：`0x1A1` 读档。
  const caller = buildScriptBin([{ op: 0x1a1, args: [loc(0x10), im(3)] }]);
  loadScriptIntoFrame(e.frames[2]!, parseScriptBytes(caller), 'SAVE.BIN', 51);
  e.frames[3]!.caller = 2;
  e.cur = 2;
  await run(e, 2, 0);

  // ---- 机械判据：替换（restoreDrawItems），不整批清容器、不走 (B) 近似 ----
  assert.deepEqual(
    screen.calls.filter((c) => c.startsWith('restoreDrawItems')),
    ['restoreDrawItems:2'],
    `★有清单时装载点必须按存档替换绘制项（实际 ${screen.calls.join(' ') || '（无）'}）`,
  );
  assert.ok(
    !screen.calls.includes('clearDrawContainer'),
    `装载点不得调 clearDrawContainer（它会把网格一起清；引擎的清场只走 Scene+1032，实际 ${screen.calls.join(' ')}）`,
  );
  assert.ok(!screen.calls.includes('clearMeshSlots'), '装载点不得调 clearMeshSlots');
  assert.deepEqual(
    screen.calls.filter((c) => c.startsWith('dropFrameItems')),
    [],
    '★body 里有清单 ⇒ 不走 (B) 步的 ownerFrame 近似',
  );
  assert.ok(screen.calls.includes('releaseFrameHold'), '装载点必须 releaseFrameHold（(A) 步：不留旧像素）');

  // ---- 上一屏的项全部作废、存档那 2 项就位 ----
  assert.deepEqual(
    [...screen.scene.drawItems.keys()].sort((a, b) => a - b),
    [0x18a88, 0x19835],
    '★只剩存档清单里那两项（TITLE 的 0xa/0x12c、菜单帧的 0x1d4c0/0x1d600 全部作废）',
  );
  const bg = screen.scene.drawItems.get(0x18a88)!;
  assert.equal(bg.tex, 4, '背景项的纹理槽 = 4（②b 刚把槽 4 重绑到存档里的图像）');
  assert.deepEqual([bg.srcX, bg.srcY, bg.srcW, bg.srcH], [0, 0, 2048, 1152], '源矩形（left/top/right/bottom ⇒ 差）');
  assert.deepEqual([bg.posX, bg.posY], [-768, -272]);
  assert.equal(bg.flags, 3, 'flags 原样（bit0 可见 + bit1 A 层窗）');
  assert.equal(bg.ownerFrame, -1, '还原出来的项不属于本进程任何帧（免得被 fallback 当成上一屏）');
  assert.ok(screen.scene.meshes.has(0x19258), '网格不动（引擎的清场只走 Scene+1032 那棵树）');

  // ---- 存档声明的槽重建（②b；与 `tickets/T-0071` 同口径）----
  assert.equal(e.texSlots.get(4), 0x888, '★图像槽 4 ← 存档里的 id');
  assert.equal(e.texSlots.get(12), 0x777, '图像槽 12 也登记（flag = 0 ⇒ 不重载）');
  assert.equal(screen.slotImgid.get(4), 0x888, '图像槽 4 走宿主重新解码（flag == 1）');
  assert.equal(screen.slotImgid.get(3), 0x999, '纹理槽 3 走宿主重新解码（flag == 1）');
  assert.equal(screen.slotImgid.get(12), undefined, 'flag = 0 的槽不重载');
  assert.ok(
    screen.logs.some((m) => m.includes('按存档还原绘制项 2/2 项')),
    `要有"按存档还原绘制项"的日志（实际 ${screen.logs.filter((m) => m.includes('slot-load')).join(' | ')}）`,
  );
});

test('★body 里没有清单（本工程槽/旧布局）⇒ 退回 (B) 近似：只丢被放弃调用链那层 UI', async () => {
  const script = buildScriptBin([{ op: 0xae, args: [] }]);
  const body = buildBody({
    savedCur: 0,
    savedRet: -1,
    pre8: 0,
    frames: [{ returnFrame: -1, scriptId: 100, retIdx: [], messageIdx: -1, callIdx: -1 }],
    ints: [],
    floats: [],
    strings: [],
    ipTables: [[], [], []],
  });
  const bytes = buildSlotFile(body, { ...SEEDS, format: 3, aux: 20 });

  const screen = new Screen();
  const e = new Engine(screen);
  e.fileSource = fakeSource(3, bytes, 100, script);
  // ADV 层（帧 0/1 画的，**祖先帧 ⇒ 必须留下**）+ 调用方菜单帧 2 的 UI 层 + 它调出来的帧 3。
  screen.draw(0x1ad00, 4, 0);
  screen.draw(0x1d300, 7, 1);
  screen.draw(0x1d4c0, 7, 2);
  screen.draw(0x1d4c1, 7, 2);
  screen.draw(0x1d500, 7, 3);
  screen.setCurrentFrame(2);
  screen.configureDrawItem({ handle: 0x1d600, layer: 0x1d600, tex: 7, srcX: 0, srcY: 0, srcW: 1, srcH: 1, dstX: 0, dstY: 0 });
  screen.setCurrentFrame(-1);
  screen.scene.meshes.set(0x19258, {
    handle: 0x19258,
    layer: 0x19258,
    flags: 1,
    state0: 0xffffffff,
    state1: 0,
    verts: [],
    baseColors: [],
    blend: 0,
  } as never);

  const caller = buildScriptBin([{ op: 0x1a1, args: [loc(0x10), im(3)] }]);
  loadScriptIntoFrame(e.frames[2]!, parseScriptBytes(caller), 'SAVE.BIN', 51);
  e.frames[3]!.caller = 2;
  e.cur = 2;
  await run(e, 2, 0);

  assert.deepEqual(
    screen.calls.filter((c) => c.startsWith('restoreDrawItems')),
    [],
    '没有清单 ⇒ 不能按存档替换（否则会把画面清空）',
  );
  assert.deepEqual(
    screen.calls.filter((c) => c.startsWith('dropFrameItems')),
    ['dropFrameItems:2', 'dropFrameItems:3'],
    '★丢的是**被放弃的那条调用链**（caller 2 + 它调出来的 3），祖先帧 0/1 不碰',
  );
  assert.deepEqual(
    [...screen.scene.drawItems.keys()].sort((a, b) => a - b),
    [0x1ad00, 0x1d300],
    '★菜单帧（0x1d4c0/0x1d4c1）、它调出的帧（0x1d500）与不带 ownerFrame 的建项（0x1d600，取当前帧=2）都被丢掉；' +
      '祖先层（0x1ad00/0x1d300）保留',
  );
  assert.ok(screen.scene.meshes.has(0x19258), '网格容器不整批清（引擎装载路径没有网格清场）');
  assert.ok(
    screen.logs.some((m) => m.includes('丢掉被放弃的调用链（帧 2,3）')),
    `要有"退回 (B) 近似"的日志（实际 ${screen.logs.filter((m) => m.includes('slot-load')).join(' | ')}）`,
  );
});

test('★A/B 一致：正常跑到某句话 vs 读档（按存档替换）落到同一句话，模型逐项相等', async () => {
  // 同一份脚本：0 = set-texture（背景槽）、1 = draw-texture（背景项）、2 = i0ae（续跑落点在此收尾）、
  // 3 = 显示消息（存档记录里的落点 = `0x71` 表[0]）。
  const script = buildScriptBin([
    { op: 0x1f9, args: [im(0x51c3), im(4), im(0)] },
    { op: 0x1fb, args: [im(0x1ae00), im(4), im(0), im(0), im(0x500), im(0x2d0), im(0), im(0)] },
    { op: 0xae, args: [] },
    { op: 0x71, args: [im(1)] },
  ]);
  // 存档里的清单 = 场景当时那一项（就是 A 侧要还原的背景项，handle 0x1ad00、槽 4）。
  const body = buildBody({
    savedCur: 0,
    savedRet: -1,
    pre8: 0,
    frames: [{ returnFrame: -1, scriptId: 100, retIdx: [], messageIdx: 0, callIdx: -1 }],
    ints: [],
    floats: [],
    strings: [],
    ipTables: [[], [], []],
    drawItems: [{ handle: 0x1ad00, record: drawItemRecord({ tex: 4, src: [0, 0, 0x500, 0x2d0] }) }],
  });
  const bytes = buildSlotFile(body, { ...SEEDS, format: 3, aux: 20 });

  // ---- A：读档到那句话（0x1A1 → 入口 i0ae 走栈收尾）----
  const sa = new Screen();
  const ea = new Engine(sa);
  ea.fileSource = fakeSource(3, bytes, 100, script);
  sa.draw(0x1d4c0, 7, 2); // 调用方菜单帧那层：必须被"按存档替换"清掉
  // ★网格（ADV 的遮罩/幕就是 MeshObj）：装载点**不得**动它（旧实现调 `clearMeshSlots()` ⇒ 这条会红）。
  sa.scene.meshes.set(0x19640, { handle: 0x19640, layer: 0x19640, flags: 1, state0: 0xffffffff, state1: 0, verts: [], baseColors: [], blend: 0 } as never);
  const caller = buildScriptBin([{ op: 0x1a1, args: [loc(0x10), im(3)] }]);
  loadScriptIntoFrame(ea.frames[2]!, parseScriptBytes(caller), 'SAVE.BIN', 51);
  ea.cur = 2;
  await run(ea, 2, 0);
  await run(ea, 0, 0); // set-texture（场景 init 重跑）
  await run(ea, 0, 1); // draw-texture
  await run(ea, 0, 2); // 入口 i0ae ⇒ 落点 + 收尾

  // ---- B：正常跑到那句话（同一份脚本从入口顺序执行；`i0ae` 因门关着直接返回）----
  const sb = new Screen();
  const eb = new Engine(sb);
  loadScriptIntoFrame(eb.frames[0]!, parseScriptBytes(script), 'SN0000.BIN', 100);
  sb.draw(0x1ad00, 4, 0); // 正常路：这一项是脚本自己 `draw-texture` 画的
  sb.scene.meshes.set(0x19640, { handle: 0x19640, layer: 0x19640, flags: 1, state0: 0xffffffff, state1: 0, verts: [], baseColors: [], blend: 0 } as never);
  await run(eb, 0, 0);
  await run(eb, 0, 1);
  await run(eb, 0, 2);

  // ---- 判据：模型逐项相等（绘制项 / 网格 / 纹理槽 / 落点）----
  const keys = (s: Screen): number[] => [...s.scene.drawItems.keys()].sort((a, b) => a - b);
  assert.deepEqual(keys(sa), keys(sb), '★绘制项集合一致（A = 按存档还原 + init 重画；B = 同一条路）');
  // ★网格（幕/遮罩）也要一致且非空：装载路径**不清网格容器**（旧实现 `clearMeshSlots()` 会让 A 变空）。
  assert.deepEqual(
    [...sa.scene.meshes.keys()].sort((a, b) => a - b),
    [...sb.scene.meshes.keys()].sort((a, b) => a - b),
    '★网格集合一致（装载点不得清网格）',
  );
  assert.deepEqual([...sa.scene.meshes.keys()], [0x19640], 'A 的网格还在（装载点没有整批清网格）');
  assert.deepEqual([...sa.scene.drawItems.keys()].sort((a, b) => a - b), [0x1ad00, 0x1ae00]);
  // ★更强的一条：A 里那个**还原出来**的项与 B 里**脚本画出来**的那一项逐字段相等
  //   （唯一允许的差别是 emulator 自己的记账格 `ownerFrame`）。
  const iA = sa.scene.drawItems.get(0x1ad00)!;
  const iB = sb.scene.drawItems.get(0x1ad00)!;
  for (const k of ['tex', 'srcX', 'srcY', 'srcW', 'srcH', 'posX', 'posY', 'posZ', 'flags', 'from', 'to'] as const) {
    assert.equal(iA[k], iB[k], `★还原项与脚本画出的项在 ${k} 上必须一致`);
  }
  assert.equal(iA.ownerFrame, -1, '还原项：ownerFrame = −1（引擎没有这一格）');
  assert.equal(iB.ownerFrame, 0, '脚本画的项：ownerFrame = 画它的那一帧');
  // ★槽表是**定长 1000 项**（引擎的镜像表就是 1000 条），空槽在文件里是全 0 ⇒ 登记出来是 `slot → 0`。
  //   这里只比"有内容的那些格"（值非 0），否则会被 998 个空槽淹掉判据。
  const nz = (m: Map<number, number>): [number, number][] =>
    [...m.entries()].filter(([, v]) => v !== 0).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(nz(ea.texSlots), nz(eb.texSlots), '★纹理槽表一致（有内容的格逐项相等）');
  assert.deepEqual(nz(ea.texSlots), [[4, 0x51c3]], '两边都只有 init 的 `set-texture` 那一格');
  assert.deepEqual([...sa.slotImgid.entries()], [...sb.slotImgid.entries()], '★宿主槽绑定一致');
  assert.equal(
    ea.engineValues.get(ENGINE_FIELD.loadInProgress),
    0,
    'A 走栈收尾（读档门已清）—— 也就是说 A/B 是"同一句话"的同一状态',
  );
  assert.ok(!sa.scene.drawItems.has(0x1d4c0), '★调用方那层 UI 不在 A 的模型里（B 里本来就没有）');
  // 落点对齐：手工跑指令（`run`）不像 `stepOnce` 那样推进 ip ⇒ 把 B 的下一条摆到同一句上再比。
  eb.frames[0]!.ip = 3;
  assert.equal(ea.frames[0]!.ip, 3, '★A 落在存档那句话（0x71 表[0] ⇒ 指令 3）');
  assert.equal(eb.frames[0]!.ip, 3, 'B 跑到同一句话（下一条 = 指令 3）');
  assert.equal(ea.frames[0]!.script!.instructions[3]!.opcode, 0x71, '两边的那句话都是 `0x71` 显示消息');
  assert.equal(eb.frames[0]!.script!.instructions[3]!.opcode, 0x71, '同上');
});
