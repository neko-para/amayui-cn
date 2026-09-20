/**
 * **读档装载点的画面语义（B）与 A/B 模型一致（C）** —— `tickets/T-0083` 的 B5 步。
 *
 * 背景（2026-09 用户实测症状）：TITLE → Load Data → 读档，画面变成「TITLE 背景 + ADV 遮罩」。
 * 引擎的装载路径（`sub_410160` raw 19276-19936）**不清绘制容器** —— 27 个被调函数里没有任何
 * `sub_4AB7A0`/`sub_41A130`/`sub_40BF80`；它靠两件事把画面弄对：
 *  ① **保留**上一屏的绘制项：装载路径刚按存档重建了槽表与纹理对象（②b），那些项当场指向存档里的图像
 *     （绘制期解析 `Scene[slot+10614]` 对象指针 + `Scene[5*slot+466]` 槽表）；
 *  ② 复位两个**仮想ディスプレイ**对象（raw 19913-19915 `sub_403EF0`；体 raw 9958-9971 =
 *     `_this[258] = 0` 项数清零 + `_this[959] = -1` + `_this[960] = 0` + 构造侧的 `SetRectEmpty`）
 *     ⇒ **上一屏那一层 UI 整体不再组成**（菜单/列表必须消失）。
 *
 * emulator 是单一扁平绘制表、没有"平面"对象 ⇒ 用 `Item.ownerFrame`（"这一项是哪一帧画的"）近似 ②：
 * 装载点只丢掉**被放弃的调用方帧**画出来的项。本文件锁三件事：
 *  - 装载点**不得**整批清容器（`clearDrawContainer`/`clearMeshSlots` 都不许调）；
 *  - 调用方那层 UI 必须消失、ADV 层必须留下、存档声明的槽必须重建；
 *  - **A/B 一致**：同一份脚本"正常跑到某句话"与"读档落到同一句话"，模型逐项相等。
 *
 * ★实证（`npm run shot -- --load 79`，2026-09）：不丢调用方那层时，读档后存档列表整屏留在画面上
 * （handle ≥ `0x1d4c0` 约 131 项）；`CALLBACK_LOAD.BIN:16` 的 `detach-texture 1adb0 7d0`
 * = 释放 [0x1adb0, 0x1b580)，那一段是**立绘层**，删不掉列表（日志实测 `drawItems=0`）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Engine } from '../src/vm/engine.js';
import { OPS, NATIVE_OPS, loadScriptIntoFrame } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { parseScriptBytes } from '../src/script/bin.js';
import { buildBody, buildScriptBin, buildSlotFile, SEEDS } from './engineSlotFixtures.js';

const im = (v: number): { type: number; raw: number } => ({ type: 0, raw: v });
const loc = (v: number): { type: number; raw: number } => ({ type: 0x9, raw: v });

/** 记账宿主：记下装载点调了哪些"整批/按帧"的容器操作，其余交给共享模型。 */
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

test('★(B) 装载点不整批清容器：只丢被放弃调用方那层 UI，ADV 层与存档声明的槽都在', async () => {
  // 引擎格式槽：1000 条图像槽记录里 4 号标了"要重载"、12 号只登记；纹理槽 3 号标了重载。
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
  });
  const bytes = buildSlotFile(body, { ...SEEDS, format: 3, aux: 20 });

  const screen = new Screen();
  const e = new Engine(screen);
  e.fileSource = fakeSource(3, bytes, 100, script);
  // "上一屏"：ADV 层（帧 0/1 画的，handle 0x1ad00/0x1d300 = 立绘/场景层，**祖先帧 ⇒ 必须留下**）
  // + 调用方菜单帧 2 画的 UI 层（0x1d4c0+）+ 它调出来的帧 3（`SBUNKI` 那类，0x1d500+ ⇒ 属于被放弃的链）。
  screen.draw(0x1ad00, 4, 0);
  screen.draw(0x1d300, 7, 1);
  screen.draw(0x1d4c0, 7, 2);
  screen.draw(0x1d4c1, 7, 2);
  screen.draw(0x1d500, 7, 3);
  // ★不带 `ownerFrame` 的建项路径（文本/`0x1FB` 之外的那些）：归属取"当前帧"（VM 每步下发）。
  screen.setCurrentFrame(2);
  screen.configureDrawItem({
    handle: 0x1d600,
    layer: 0x1d600,
    tex: 7,
    srcX: 0,
    srcY: 0,
    srcW: 1,
    srcH: 1,
    dstX: 0,
    dstY: 0,
  });
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

  // 调用方 = 帧 2（SAVE/LOAD 菜单）：`0x1A1` 读档；帧 3 是它调出来的（`caller = 2`）。
  const caller = buildScriptBin([{ op: 0x1a1, args: [loc(0x10), im(3)] }]);
  loadScriptIntoFrame(e.frames[2]!, parseScriptBytes(caller), 'SAVE.BIN', 51);
  e.frames[3]!.caller = 2;
  e.cur = 2;
  await run(e, 2, 0);

  // ---- (B) 的机械判据：装载点**没有**整批清容器 ----
  assert.ok(
    !screen.calls.includes('clearDrawContainer'),
    `装载点不得调 clearDrawContainer（实际 ${screen.calls.join(' ') || '（无）'}）`,
  );
  assert.ok(!screen.calls.includes('clearMeshSlots'), '装载点不得调 clearMeshSlots');
  assert.ok(screen.calls.includes('releaseFrameHold'), '装载点必须 releaseFrameHold（(A) 步）');
  assert.deepEqual(
    screen.calls.filter((c) => c.startsWith('dropFrameItems')),
    ['dropFrameItems:2', 'dropFrameItems:3'],
    '★丢的是**被放弃的那条调用链**（caller 2 + 它调出来的 3），祖先帧 0/1 不碰',
  );

  // ---- 被放弃那条链的 UI 消失、祖先层留下、网格不动 ----
  assert.deepEqual(
    [...screen.scene.drawItems.keys()].sort((a, b) => a - b),
    [0x1ad00, 0x1d300],
    '★菜单帧（0x1d4c0/0x1d4c1）、它调出的帧（0x1d500）与不带 ownerFrame 的建项（0x1d600，取当前帧=2）都被丢掉；' +
      '祖先层（0x1ad00/0x1d300）保留',
  );
  assert.ok(screen.scene.meshes.has(0x19258), '网格容器不整批清（引擎装载路径没有网格清场）');

  // ---- 存档声明的槽重建（②b；与 `tickets/T-0071` 同口径）----
  assert.equal(e.texSlots.get(4), 0x888, '★图像槽 4 ← 存档里的 id');
  assert.equal(e.texSlots.get(12), 0x777, '图像槽 12 也登记（flag = 0 ⇒ 不重载）');
  assert.equal(screen.slotImgid.get(4), 0x888, '图像槽 4 走宿主重新解码（flag == 1）');
  assert.equal(screen.slotImgid.get(3), 0x999, '纹理槽 3 走宿主重新解码（flag == 1）');
  assert.equal(screen.slotImgid.get(12), undefined, 'flag = 0 的槽不重载');
  assert.ok(
    screen.logs.some((m) => m.includes('丢掉被放弃的调用链（帧 2,3）画的 UI 绘制项 4 个')),
    `要有"丢掉调用链那种 UI 层"的日志（实际 ${screen.logs.filter((m) => m.includes('slot-load')).join(' | ')}）`,
  );
});

test('★(C) A/B 一致：正常跑到某句话 vs 读档落到同一句话，模型逐项相等', async () => {
  // 同一份脚本：0 = set-texture（背景槽）、1 = draw-texture（背景项）、2 = i0ae（续跑落点在此收尾）、
  // 3 = 显示消息（存档记录里的落点 = `0x71` 表[0]）。
  const script = buildScriptBin([
    { op: 0x1f9, args: [im(0x51c3), im(4), im(0)] },
    { op: 0x1fb, args: [im(0x1ae00), im(4), im(0), im(0), im(0x500), im(0x2d0), im(0), im(0)] },
    { op: 0xae, args: [] },
    { op: 0x71, args: [im(1)] },
  ]);
  const body = buildBody({
    savedCur: 0,
    savedRet: -1,
    pre8: 0,
    frames: [{ returnFrame: -1, scriptId: 100, retIdx: [], messageIdx: 0, callIdx: -1 }],
    ints: [],
    floats: [],
    strings: [],
    ipTables: [[], [], []],
  });
  const bytes = buildSlotFile(body, { ...SEEDS, format: 3, aux: 20 });

  // ---- A：读档到那句话（0x1A1 → 入口 i0ae 走栈收尾）----
  const sa = new Screen();
  const ea = new Engine(sa);
  ea.fileSource = fakeSource(3, bytes, 100, script);
  sa.draw(0x1ad00, 4, 0); // "上一屏"就是同一个 ADV 场景（引擎保留它的项）
  sa.draw(0x1d4c0, 7, 2); // 而菜单帧（调用方）那层必须消失
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
  sb.draw(0x1ad00, 4, 0);
  sb.scene.meshes.set(0x19640, { handle: 0x19640, layer: 0x19640, flags: 1, state0: 0xffffffff, state1: 0, verts: [], baseColors: [], blend: 0 } as never);
  await run(eb, 0, 0);
  await run(eb, 0, 1);
  await run(eb, 0, 2);

  // ---- 判据：模型逐项相等（绘制项 / 纹理槽 / 落点）----
  const keys = (s: Screen): number[] => [...s.scene.drawItems.keys()].sort((a, b) => a - b);
  assert.deepEqual(keys(sa), keys(sb), '★绘制项集合一致（A = 保留的上一屏 + init 重画；B = 同一条路）');
  // ★网格（幕/遮罩）也要一致且非空：装载路径**不清网格容器**（旧实现 `clearMeshSlots()` 会让 A 变空）。
  assert.deepEqual(
    [...sa.scene.meshes.keys()].sort((a, b) => a - b),
    [...sb.scene.meshes.keys()].sort((a, b) => a - b),
    '★网格集合一致（装载点不得清网格）',
  );
  assert.deepEqual([...sa.scene.meshes.keys()], [0x19640], 'A 的网格还在（装载点没有整批清网格）');
  assert.deepEqual([...sa.scene.drawItems.keys()].sort((a, b) => a - b), [0x1ad00, 0x1ae00]);
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
