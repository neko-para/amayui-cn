/**
 * **本工程槽（`format = 0` + 状态块）的"存档退栈 / 读档转移"契约**（`tickets/T-0061`）。
 *
 * 用户实测症状：第一个 ADV 场景里存档 → 槽 070 有了，但**读档后停在存档界面**。
 * 根因（逐条对齐 oracle 后确认，两条都在这条链上）：
 *
 * 1. **存档要退到哪一帧由脚本说了算**：引擎写入内核 `sub_40CD10` 的 case 3 是
 *    `v10 = _this[166963]; if (v10 < 0) v10 = _this[95776];` —— `_this[166963]` = **`0x1AD`（`i1ad`）**，
 *    而每个 ADV 脚本都在进主循环前 `i1ad`（`src/$1$SC0330.txt:44-46`：`call 场景初始化` → `i1ad` → `jmp 主循环`；
 *    语料 **1100 处 / 337 个脚本**）⇒ 玩家从**存档菜单**存盘时，`cur` 是菜单帧，内存里那格仍是 ADV 帧，
 *    **引擎存的是 ADV 帧**（就是玩家说的"自动退栈"）。修前 emulator 存 `e.cur` = 菜单帧。
 * 2. **读档必须放弃调用方**：引擎 `sub_410160` 的 a6=1 段（raw 19464-19476）`cur = 0` + 装载存档脚本
 *    ⇒ SAVE.BIN 那类界面脚本不会继续跑。修前本工程格式"不转移"⇒ 菜单留在屏上。
 *
 * 另外两处一并锁住：帧记录带**帧号**（引擎帧记录是按帧号铺的）与**返回帧链 `caller`**（引擎记录的 `[0]`）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Engine } from '../src/vm/engine.js';
import { OPS, loadScriptIntoFrame } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import { StubNative } from '../src/vm/native.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { parseIni } from '../src/engineConfig.js';
import { parseSlotFile, type SlotStateBlock } from '../src/save/saveSlot.js';
import { loadSlotIntoEngine } from '../src/vm/handlers/save-slot.js';
import { parseScriptBytes } from '../src/script/bin.js';
import type { FileSource } from '../src/arch/fileSource.js';
import { buildScriptBin } from './engineSlotFixtures.js';

const ADV_ID = 77;
const MENU_ID = 51;

const SCRIPTS = new Map([
  // filler 一旦被执行会撞上未实现/读档语义，所以统一用 `0xAE`（`i0ae`，argc 0）——本文件的脚本只被**装载**、不被执行。
  [ADV_ID, { name: 'SC0000.BIN', data: buildScriptBin([{ op: 0xae, args: [] }, { op: 0x71, args: [{ type: 0, raw: 1 }] }]) }],
  [MENU_ID, { name: 'SAVE.BIN', data: buildScriptBin([{ op: 0xae, args: [] }, { op: 0xae, args: [] }]) }],
]);

/** 内存 FileSource：读脚本 + 槽读写（写入的字节按槽号留住，供"存档→读档"往返）。 */
function mkSource(): FileSource & { slots: Map<number, Uint8Array> } {
  const slots = new Map<number, Uint8Array>();
  return {
    slots,
    readFile: async () => new Uint8Array(0),
    readScript: async (id: number) => {
      const s = SCRIPTS.get(id);
      return s ? { index: id, name: s.name, data: s.data } : null;
    },
    readSaveSlot: async (s: number) => slots.get(s) ?? null,
    writeSaveSlot: async (s: number, data: Uint8Array) => {
      slots.set(s, data);
    },
  } as unknown as FileSource & { slots: Map<number, Uint8Array> };
}

/** 造一个"ADV 帧 0 + 菜单帧 3"的引擎（`cur` 在菜单上，帧 0 是 ADV 场景）。 */
function mkEngine(src: FileSource): Engine {
  const e = new Engine(new StubNative(() => {}));
  e.fileSource = src;
  loadScriptIntoFrame(e.frames[0]!, parseScriptBytes(SCRIPTS.get(ADV_ID)!.data), 'SC0000.BIN', ADV_ID);
  e.frames[0]!.ip = 1; // ADV 停在显示消息那条
  e.frames[0]!.caller = -1;
  loadScriptIntoFrame(e.frames[3]!, parseScriptBytes(SCRIPTS.get(MENU_ID)!.data), 'SAVE.BIN', MENU_ID);
  e.frames[3]!.ip = 1;
  e.frames[3]!.caller = 0;
  e.cur = 3; // 玩家在存档菜单里按了"保存"
  return e;
}

const im = (v: number): { type: number; raw: number } => ({ type: 0, raw: v });
const loc = (v: number): { type: number; raw: number } => ({ type: 0x9, raw: v });

/** 跑某个帧里的一条指令（用它自己的 opcode handler）。 */
async function run(e: Engine, frameIndex: number, ip: number): Promise<void> {
  const frame = e.frames[frameIndex]!;
  const instr = frame.script!.instructions[ip]!;
  await OPS.get(instr.opcode)!(makeCtx(e, frame, instr, e.native, () => {}));
}

test('★存档退栈：`0x1AD`(`i1ad`) 记的帧优先于 `cur`（引擎 sub_40CD10 的 `_this[166963]`）', async () => {
  const src = mkSource();
  const e = mkEngine(src);
  // ADV 脚本进主循环前调过 `i1ad` ⇒ `Engine[166963] = 0`（帧 0）
  e.engineValues.set(ENGINE_FIELD.storedCur, 0);

  const h = OPS.get(0x19e)!;
  const use = { opcode: 0x19e, name: 'i19e', argc: 2, args: [loc(0x10), im(7)], byteOffset: 0, index: 0 };
  await h(makeCtx(e, e.curScript(), use as never, e.native, () => {}));

  const bytes = src.slots.get(7);
  assert.ok(bytes, '槽 7 应被写出');
  const parsed = parseSlotFile(bytes!);
  assert.ok(parsed.ok && parsed.data.state, '写出的槽应能解出状态块');
  const st = parsed.data.state as SlotStateBlock;
  assert.equal(st.cur, 0, '★存的是 `i1ad` 记的帧 0（ADV），不是按下保存时的菜单帧 3');
  assert.equal(st.frames.length, 1, '只存 0..0（引擎按 0..savedCur 铺帧记录）');
  assert.deepEqual(
    st.frames.map((f) => ({ index: f.index, scriptId: f.scriptId, ip: f.ip, caller: f.caller })),
    [{ index: 0, scriptId: ADV_ID, ip: 1, caller: -1 }],
    '★帧号 + 返回帧链都要在（引擎帧记录的 [0]/[1]）',
  );
});

test('★读档续跑：本工程槽也走引擎那条路（帧 0 从入口跑 → 入口 i0ae 落点收尾）', async () => {
  const src = mkSource();
  const save = mkEngine(src);
  save.engineValues.set(ENGINE_FIELD.storedCur, 0);
  const saveOp = { opcode: 0x19e, name: 'i19e', argc: 2, args: [loc(0x10), im(7)], byteOffset: 0, index: 0 };
  await OPS.get(0x19e)!(makeCtx(save, save.curScript(), saveOp as never, save.native, () => {}));

  // 换一个"干净"的引擎（跨实例读档），把槽读回来。
  const e = mkEngine(src);
  const loadOp = { opcode: 0x1a1, name: 'i1a1', argc: 2, args: [loc(0x10), im(7)], byteOffset: 0, index: 0 };
  const ctx = makeCtx(e, e.curScript(), loadOp as never, e.native, () => {});
  await OPS.get(0x1a1)!(ctx);

  assert.equal(e.cur, 0, '★cur = 0（引擎 `Engine[383104] = 0`）：逐帧走栈从帧 0 入口开始');
  assert.equal(e.curScript().name, 'SC0000.BIN', '帧 0 = 存档记录的脚本（装载后**在入口**，不是直接摆到存档 ip）');
  assert.equal(e.curScript().ip, 0, '从入口跑（引擎 `sub_40F750(3)` 装载后的位置）');
  assert.equal(ctx._nextIp, 0, '★读档 handler 必须 `jump(0)`（否则 stepOnce 会把入口第一条吃掉）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.loadInProgress), 1, '置「正在读档」门 ⇒ 脚本入口的 i0ae 会走栈');
  assert.ok(e.saveResume, '续跑记录已入队');
  assert.equal(e.saveResume!.savedCur, 0);
  assert.equal(e.saveResume!.frames[0]!.instr, 1, '落点 = 存档时那条指令（本工程槽直接存指令下标）');
  assert.equal(e.frames[3]!.ip, 1, '★调用方（菜单帧）的 ip 不前进：它被放弃了');

  // 帧 0 入口那条 i0ae（fixture 脚本第 0 条）⇒ cur == savedCur ⇒ 落点 + 收尾
  await run(e, 0, 0);
  assert.equal(e.curScript().ip, 1, '★落在存档记的那条指令上');
  assert.equal(e.engineValues.get(ENGINE_FIELD.loadInProgress), 0, '收尾：清读档门');
  assert.equal(e.saveResume, null, '续跑记录消费完即清');
  assert.equal(e.engineValues.get(ENGINE_FIELD.storedCur), 0, '`0x1AD` 那格跟进到续档帧');
  void src;
});

test('★呈现态快照：存档把画面（绘制项/文本窗/纹理槽记录）一起带走，读档装回（`tickets/T-0063`）', async () => {
  const src = mkSource();
  const { HeadlessScene } = await import('../src/renderer/headlessScene.js');

  // ① 存档方：摆几个"画面"上的东西（背景绘制项 + 一个消息窗 + 槽记录），再存盘。
  const sceneA = new HeadlessScene({});
  const eA = mkEngine(src);
  eA.native = sceneA as never; // 快照来自宿主
  sceneA.scene.drawItems.set(0x1000, { handle: 0x1000, layer: 0x1000, tex: 3 } as never);
  sceneA.scene.drawItems.set(0x1001, { handle: 0x1001, layer: 0x1001, tex: 4 } as never);
  sceneA.scene.msgWins.set(1, { win: 1, style: {}, lines: [], glyphCount: 0, revealed: 0 } as never);
  sceneA.scene.render4.slotModes.set(3, 2);
  eA.texSlots.set(3, 0x51c3);
  // VM 侧那批状态（`tickets/T-0063`：热点区/消息窗标量/文本项/阶梯动画/引擎字段）
  eA.routes.entries.push({ x0: 10, y0: 20, x1: 30, y1: 40, labelEnter: 7, labelLeave: 8, labelClick: 9, keyBit: 5 });
  eA.stage.entries.push({ t: 100, body: 0x1234, tail: 0x5678 });
  eA.stage.cursor = 2;
  eA.textItems.records.push({ win: 1, v20: 0x19a28, v24: 3, v28: 0, sel32: 0, flags: 1 } as never);
  eA.msgwin.showing = 3;
  eA.engineValues.set(12957, 1); // panelShown
  eA.frames[0]!.lastMsgIp = 2; // 本帧最后一次 0x71 的位置
  eA.engineValues.set(ENGINE_FIELD.storedCur, 0);
  const saveOp = { opcode: 0x19e, name: 'i19e', argc: 2, args: [loc(0x10), im(7)], byteOffset: 0, index: 0 };
  await OPS.get(0x19e)!(makeCtx(eA, eA.curScript(), saveOp as never, eA.native, () => {}));
  const parsed = parseSlotFile(src.slots.get(7)!);
  assert.ok(parsed.ok && parsed.data.state, '槽里应有状态块');
  const st = parsed.data.state as SlotStateBlock;
  assert.ok(st.present, '★状态块要带呈现态快照（否则读档后画面空白）');
  assert.deepEqual(st.texSlots, [[3, 0x51c3]], '★纹理槽记录也要带（引擎同：那两张 1000×2 的表）');

  // ② 读档方：换一套干净的引擎 + 宿主，读档后画面必须回来。
  const sceneB = new HeadlessScene({});
  const eB = new Engine(new StubNative((m) => sceneB.log(m)));
  eB.native = sceneB as never;
  eB.fileSource = src;
  const loadOp = { opcode: 0x1a1, name: 'i1a1', argc: 2, args: [loc(0x10), im(7)], byteOffset: 0, index: 0 };
  await OPS.get(0x1a1)!(makeCtx(eB, eB.curScript(), loadOp as never, eB.native, () => {}));
  assert.deepEqual([...sceneB.scene.drawItems.keys()].sort(), [0x1000, 0x1001], '★绘制项回来了（ADV 背景/立绘）');
  assert.ok(sceneB.scene.msgWins.has(1), '★消息窗文本回来了（续跑落点在循环里，不会重发这条消息）');
  assert.equal(sceneB.scene.render4.slotModes.get(3), 2, '槽模式也回来了');
  assert.equal(eB.texSlots.get(3), 0x51c3, 'VM 侧的纹理槽表也还原了');
  // ★VM 侧状态（否则：侧边栏 hover 不展开 / 遮罩不对 / 背景不动 —— 用户实测的三条症状）
  assert.equal(eB.routes.entries.length, 1, '★热点区回来了（侧边栏 hover）');
  assert.deepEqual(
    eB.routes.entries[0] && { x0: eB.routes.entries[0].x0, labelClick: eB.routes.entries[0].labelClick },
    { x0: 10, labelClick: 9 },
    '热点区的坐标与派发 label 一并还原',
  );
  assert.equal(eB.stage.entries.length, 1, '★阶梯动画时间表回来了');
  assert.equal(eB.stage.cursor, 2);
  assert.equal(eB.textItems.records.length, 1, '★文本项账本回来了');
  assert.equal(eB.msgwin.showing, 3, '★消息窗标量态回来了');
  assert.equal(eB.engineValues.get(12957), 1, '引擎字段（面板显示标志）也还原了');
  // ★末帧落在"存档当时那句话"上（`lastMsgIp`）
  assert.equal(parsed.data.state && (parsed.data.state as SlotStateBlock).frames[0]!.lastMsgIp, 2, '存档要带 lastMsgIp');
  assert.equal(eB.saveResume?.frames[0]?.instr, 2, '读档落点 = 那句话（重放它 ⇒ 屏幕上立刻有文字）');
  // ★走栈期间的画面保持（`tickets/T-0069`）：读档装好的快照要挂成 `loadHold`，走栈步里被场景入口的
  //   一次性绘制覆盖掉时**当场装回**（否则玩家看到"快照（带遮罩）→ 又播一遍无遮罩 → 遮罩淡入"）。
  assert.ok(eB.loadHold, '读档后应挂上 loadHold（走栈期间反复装回的画面）');
  sceneB.scene.drawItems.clear(); // 模拟"场景入口重跑把画面改掉了"
  sceneB.scene.drawItems.set(0xdead, { handle: 0xdead, layer: 0xdead, tex: 1 } as never);
  await run(eB, 0, 0); // 帧 0 入口的 i0ae = 一个走栈步
  assert.deepEqual(
    [...sceneB.scene.drawItems.keys()].sort(),
    [0x1000, 0x1001],
    '★走栈步要把快照装回（覆盖掉重跑产生的中间画面）',
  );
  assert.equal(eB.loadHold, null, '收尾（cur == savedCur）时松手：此后的脚本绘制要如实可见');
});

test('★BGM 还原：存档带「当前曲 id」、读档重播它（引擎 CALLBACK_LOAD 的 `i0b7 0`，`tickets/T-0064`）', async () => {
  const src = mkSource();
  type AudioIntent = import('../src/audio/audioEngine.js').AudioIntent;
  /** 记录音频意图的宿主。 */
  class Rec extends StubNative {
    readonly intents: AudioIntent[] = [];
    constructor() {
      super(() => {});
    }
    override audio(i: AudioIntent): void {
      this.intents.push(i);
    }
  }

  // ① 存档方：模拟"ADV 场景正在播 `play-bgm d`（曲号 13）"——运行态就在 `_this[174713]`/`[174715]`。
  const eA = mkEngine(src);
  eA.engineValues.set(ENGINE_FIELD.musicField, 13);
  eA.engineValues.set(ENGINE_FIELD.musicLoopField, 1);
  eA.engineValues.set(ENGINE_FIELD.storedCur, 0);
  const saveOp = { opcode: 0x19e, name: 'i19e', argc: 2, args: [loc(0x10), im(7)], byteOffset: 0, index: 0 };
  await OPS.get(0x19e)!(makeCtx(eA, eA.curScript(), saveOp as never, eA.native, () => {}));
  const st = parseSlotFile(src.slots.get(7)!).data.state as SlotStateBlock;
  assert.deepEqual(
    st.adv?.fields?.find(([k]) => k === ENGINE_FIELD.musicField),
    [ENGINE_FIELD.musicField, 13],
    '★状态块要带运行态「当前曲 id」（引擎把它写进镜像 [2]：raw 17469-17471）',
  );

  // ② 读档方：干净的引擎（运行态本来是 0）+ 记录意图的宿主。
  const nativeB = new Rec();
  const eB = new Engine(nativeB);
  eB.fileSource = src;
  const loadOp = { opcode: 0x1a1, name: 'i1a1', argc: 2, args: [loc(0x10), im(7)], byteOffset: 0, index: 0 };
  await OPS.get(0x1a1)!(makeCtx(eB, eB.curScript(), loadOp as never, nativeB, () => {}));

  assert.equal(eB.engineValues.get(ENGINE_FIELD.musicField), 13, '★存档里的当前曲 id 装回来了（raw 19911）');
  assert.deepEqual(
    nativeB.intents,
    [{ kind: 'bgm-play', bgm: 13, loop: true }],
    '★读档必须重播它（引擎：CALLBACK_LOAD.BIN:20 的 `i0b7 0`；否则续跑跳过场景的 play-bgm ⇒ 整场没音乐）',
  );

  // ③ 存档里没有 BGM（id = 0）⇒ 不发意图（引擎 `Music[259] == 0` 分支）。
  const eC = mkEngine(src);
  eC.engineValues.set(ENGINE_FIELD.musicField, 0);
  eC.engineValues.set(ENGINE_FIELD.storedCur, 0);
  await OPS.get(0x19e)!(makeCtx(eC, eC.curScript(), saveOp as never, eC.native, () => {}));
  const nativeD = new Rec();
  const eD = new Engine(nativeD);
  eD.fileSource = src;
  await loadSlotIntoEngine(eD, 7, { full: true });
  assert.deepEqual(nativeD.intents, [], 'id = 0 的槽读档不重播任何东西');
  assert.equal(eD.engineValues.get(ENGINE_FIELD.musicField), 0);
});

test('★0x259（clearSlotRecords）只复位标志两位：槽→imgid 与绘制项/网格都不受影响（口径纠错）', async () => {
  // ① VM 侧：0x259 必须请求宿主清记录（此前宿主没实现 ⇒ 控制面板报"忽略 clearSlotRecords"）
  const log: string[] = [];
  const e = new Engine(new StubNative((m) => log.push(m)));
  const noop = { opcode: 0x259, name: 'i259', argc: 0, args: [], byteOffset: 0, index: 0 };
  // `0x258` 先写一位标志（`texSlotFlags`），再由 `0x259` 整表复位 —— 引擎 raw 33156-33185 / 25357-25374。
  await OPS.get(0x258)!(
    makeCtx(
      e,
      e.curScript(),
      { opcode: 0x258, name: 'i258', argc: 2, args: [im(5), im(3)], byteOffset: 0, index: 0 } as never,
      e.native,
      () => {},
    ),
  );
  assert.equal(e.texSlotFlags.get(5), 3, '0x258 写入 bit0|bit1');
  await OPS.get(0x259)!(makeCtx(e, e.curScript(), noop as never, e.native, () => {}));
  assert.ok(
    log.some((m) => m.includes('clearSlotRecords')),
    `0x259 要请宿主清槽记录；实际日志 ${JSON.stringify(log)}`,
  );
  // ★`0x259` 就是 `0x258` 的整表复位器：标志位必须归零
  //   （此前漏了这一步 ⇒ 引擎已复位而 emulator 残留；`texSlotFlags` 目前只写不读，所以只表现成口径不对）
  assert.equal(e.texSlotFlags.size, 0, '★0x259 必须复位 texSlotFlags（= 0x258 写入的那两位）');

  // ② 宿主侧（headless）：只复位标志位；**「槽→imgid」记录、绘制项、网格必须都留着**
  //    （引擎体内只把两张记录表的 `+8`/`+12` 清 0，**imgid 那一格不动** ⇒ 画面不受影响。
  //     一度误实现成清 `drawItems` ⇒ 读档后全黑；又一度误实现成清 `slotImgid` ⇒ 槽号→图像索引被掐断，
  //     `draw-texture` 回落 1×1 白占位块 ⇒ `tickets/T-0102` 的"ADV 窗口白底"）
  const { HeadlessScene } = await import('../src/renderer/headlessScene.js');
  const scene = new HeadlessScene({});
  scene.scene.drawItems.set(0x1234, {} as never);
  scene.scene.drawItems.set(0x5678, {} as never);
  scene.scene.meshes.set(0x9abc, {} as never);
  scene.slotImgid.set(3, 0x51c3);
  (scene as unknown as { clearSlotRecords(): void }).clearSlotRecords();
  assert.equal(scene.slotImgid.size, 1, '★槽→imgid 记录**保留**（引擎清的是 +8/+12，不是 imgid）');
  assert.equal(scene.slotImgid.get(3), 0x51c3, '★而且是原值（0x1F9 写的 imgid 不被 0x259 触碰）');
  assert.equal(scene.scene.drawItems.size, 2, '★绘制项**不**受影响（这不是它清的表）');
  assert.equal(scene.scene.meshes.size, 1, '网格也不受影响（那是 0x32B 的表）');
});

test('未调用 `i1ad` 的实例：退回 `e.cur`（引擎 `if (v10 < 0)` 分支）', async () => {
  const src = mkSource();
  const e = mkEngine(src); // 从没设过 storedCur（engineValues 里没这一格）
  const use = { opcode: 0x19e, name: 'i19e', argc: 2, args: [loc(0x10), im(8)], byteOffset: 0, index: 0 };
  await OPS.get(0x19e)!(makeCtx(e, e.curScript(), use as never, e.native, () => {}));
  const parsed = parseSlotFile(src.slots.get(8)!);
  assert.ok(parsed.ok && parsed.data.state);
  assert.equal((parsed.data.state as SlotStateBlock).cur, 3, '没有 i1ad ⇒ 用当时的 cur（3 = 菜单帧）');
});

test('老槽兼容：状态块里没有 `index`/`caller` ⇒ 按数组序归位、续跑仍入队且不炸', async () => {
  const src = mkSource();
  // 手工塞一个"老格式"槽：frames 无 index/caller。
  const { buildSlotFile } = await import('../src/save/saveSlot.js');
  const bytes = buildSlotFile({
    tables: { ints: new Map(), strings: new Map() },
    usedFileIds: [],
    state: {
      key: 0,
      cur: 0,
      frames: [{ scriptId: ADV_ID, name: 'SC0000.BIN', ip: 1, retStack: [] }],
      globals: { int: [], float: [], str: [] },
      playSeconds: 1,
    } as SlotStateBlock,
  });
  src.slots.set(9, bytes);
  const e = mkEngine(src);
  const loadOp = { opcode: 0x1a1, name: 'i1a1', argc: 2, args: [loc(0x10), im(9)], byteOffset: 0, index: 0 };
  const ctx = makeCtx(e, e.curScript(), loadOp as never, e.native, () => {});
  await OPS.get(0x1a1)!(ctx);
  assert.equal(e.cur, 0, '老槽按数组序落到帧 0');
  assert.equal(e.curScript().name, 'SC0000.BIN');
  assert.equal(ctx._nextIp, 0, '仍然走"帧 0 入口"那条路');
  assert.ok(e.saveResume, '续跑记录已入队');
  assert.equal(e.saveResume!.frames[0]!.instr, 1, '老槽的 ip 同样直接当落点');
  await run(e, 0, 0);
  assert.equal(e.curScript().ip, 1, '入口 i0ae 落到存档 ip');
  assert.equal(e.engineValues.get(ENGINE_FIELD.loadInProgress), 0, '收尾清门');
});
