/** @tier T1 @kind core @subsystem save */

/**
 * **存档槽链路回归**（`tickets/T-0018`）：读头 `0x1A0` / 读档 `0x1A1` / 存档 `0x19E` / 删 `0x1AB` /
 * 复制 `0x1AC` / `.STH` `0x1AE`·`0x1AF`。
 *
 * 三层证据：
 *  - **E4**：本机真存档槽（`…\SAVE\SAVE00.DAT`）的头 —— 文件时间与头里那 6 个 u16 必须一致，
 *    游玩秒数 > 0（这就是"`0x1A0` 的字段布局"的实证，见 `saveSlot.ts` 文件头）；
 *  - **E2**：合成引擎上的存档→读档往返（`load-int`/`load-string` 取回登记值 = 本票验收 ②）；
 *  - **E2**：`NodeFileSource` 的槽读写**只碰 overlay**（真存档槽一个字节都不动）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/vm/engine.js';
import { StubNative } from '../src/vm/native.js';
import type { FileSource } from '../src/arch/fileSource.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS } from '../src/vm/ops.js';
import { readIntOperand, writeIntOperand } from '../src/vm/operand.js';
import { dec, enc } from '../src/vm/bits.js';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { INI_FILE, resolveSystemPaths } from '../src/arch/systemPaths.js';
import {
  SLOT_STATE_MAGIC,
  buildSlotFile,
  decodeSlotState,
  encodeSlotState,
  parseSlotFile,
  parseSlotHeader,
  slotRelPath,
  slotThumbRelPath,
} from '../src/save/saveSlot.js';
import { encodeSaveData } from '../src/save/saveData.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import type { BinArg, BinInstruction, ScriptBinary } from '../src/script/bin.js';
import { buildScriptBin } from './engineSlotFixtures.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

const im = (n: number): BinArg => ({ type: 0, raw: n }) as unknown as BinArg;
const gInt = (slot: number): BinArg => ({ type: 3, raw: slot }) as unknown as BinArg;
const instr = (opcode: number, args: BinArg[] = []): BinInstruction =>
  ({ opcode, name: `i${opcode.toString(16)}`, argc: args.length, args, byteOffset: 0, index: 0 }) as unknown as BinInstruction;

/** 造一个装了合成脚本的引擎（含一张空脚本，供 `load-int` 写回操作数）。 */
function mkEngine(fsLike: FileSource): { e: Engine; script: ScriptBinary } {
  const e = new Engine(new StubNative(() => {}));
  const script: ScriptBinary = {
    signature: 'SYS4450 ',
    isVer5: false,
    headerLen: 0x3c,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
    ],
    instructions: [instr(0x1a7)], // comment（无害：只为让帧里有条指令）
    labelTargets: new Set<number>(),
    raw: new Uint8Array(0x3c + 12),
  };
  loadScriptIntoFrame(e.curScript(), script, 'TEST.BIN', 0);
  e.fileSource = fsLike;
  return { e, script };
}

/**
 * 跑一条 handler 并读回它写进操作数槽的值。
 * ★**输出操作数必须是池槽（这里用 global-int）**：引擎的 `writeIntOperand` 只认池类型，
 * 立即数（type 0）写不了 —— 真实脚本也是这样写的（`i1a0 (global-int f7ffd) (global-int f8019) …`）。
 */
async function runOp(e: Engine, opcode: number, args: BinArg[]): Promise<(k: number) => number> {
  const h = OPS.get(opcode);
  assert.ok(h, `0x${opcode.toString(16)} 应在 OPS 里`);
  const use = instr(opcode, args);
  await h!(makeCtx(e, e.curScript(), use, e.native, () => {}));
  return (k: number): number => readIntOperand(e, e.curScript(), use, k);
}

/** 内存版槽存储（只实现本票用到的 FileSource 槽方法）。 */
function memoryFs(): FileSource & { slots: Map<number, Uint8Array>; thumbs: Map<number, Uint8Array> } {
  const slots = new Map<number, Uint8Array>();
  const thumbs = new Map<number, Uint8Array>();
  return {
    slots,
    thumbs,
    readFile: async () => new Uint8Array(0),
    readScript: async (id: number) => ({
      index: id,
      name: 'SAVE.BIN',
      // 续跑会**装脚本**（`tickets/T-0063`：帧要装到入口再由 i0ae 落点）⇒ 给一份最小可用脚本
      data: buildScriptBin([
        { op: 0xae, args: [] },
        { op: 0x71, args: [{ type: 0, raw: 1 }] },
      ]),
    }),
    readSaveSlot: async (s) => slots.get(s) ?? null,
    writeSaveSlot: async (s, d) => void slots.set(s, d),
    deleteSaveSlot: async (s) => ({ dat: slots.delete(s), sth: thumbs.delete(s) }),
    copySaveSlot: async (from, to) => {
      const d = slots.get(from);
      const t = thumbs.get(from);
      if (d) slots.set(to, d);
      if (t) thumbs.set(to, t);
      return { dat: d !== undefined, sth: t !== undefined };
    },
    readSlotThumb: async (s) => thumbs.get(s) ?? null,
    writeSlotThumb: async (s, d) => void thumbs.set(s, d),
  };
}

// ---------------------------------------------------------------------------
// E4：真存档槽的头（本机 47 个 SAVE??.DAT 里的字段布局实证）
// ---------------------------------------------------------------------------
test('E4：真存档槽的头 → 0x1A0 的六个 u16 = 年/月/日/时/分/秒（与文件时间一致）+ 游玩秒数', (t) => {
  const paths = resolveSystemPaths(REPO);
  const file = path.join(paths.baseDir, 'SAVE', 'SAVE00.DAT');
  if (!fs.existsSync(file)) {
    t.skip(`本机没有真存档槽 ${file}`);
    return;
  }
  const bytes = new Uint8Array(fs.readFileSync(file));
  const r = parseSlotHeader(bytes);
  assert.equal(r.ok, true, r.ok ? '' : r.reason);
  if (!r.ok) return;
  const h = r.header;
  const st = fs.statSync(file);
  assert.equal(h.magic, 'S4SD');
  // 头的日期 = 存档时间（文件 mtime，本地时区）
  assert.equal(h.year, st.mtime.getFullYear(), '头 +264 = 年');
  assert.equal(h.month, st.mtime.getMonth() + 1, '头 +266 = 月');
  assert.equal(h.day, st.mtime.getDate(), '头 +270 = 日（★+268 是星期、0x1A0 不取）');
  assert.equal(h.hour, st.mtime.getHours(), '头 +272 = 时');
  assert.equal(h.minute, st.mtime.getMinutes(), '头 +274 = 分');
  assert.ok(Math.abs(h.second - st.mtime.getSeconds()) <= 2, `头 +276 = 秒（${h.second} vs ${st.mtime.getSeconds()}）`);
  assert.ok(h.playSeconds > 0, `头 +280 = 游玩秒数（实际 ${h.playSeconds}）`);
  assert.equal(h.format, 3, '真槽的 format（≥3 = 模幂混淆 + 压缩）');
});

test('E4：真存档槽能读到整份"头"；状态主体是引擎私有布局 ⇒ engineFormat = true（缺口已登记）', (t) => {
  const paths = resolveSystemPaths(REPO);
  const file = path.join(paths.baseDir, 'SAVE', 'SAVE00.DAT');
  if (!fs.existsSync(file)) {
    t.skip(`本机没有真存档槽 ${file}`);
    return;
  }
  const r = parseSlotFile(new Uint8Array(fs.readFileSync(file)));
  assert.equal(r.ok, true, r.ok ? '' : r.reason);
  if (!r.ok) return;
  assert.equal(r.data.engineFormat, true, '引擎格式（format ≥ 1）⇒ 只读头');
  assert.equal(r.data.state, null, '引擎槽没有本工程状态块');
  assert.equal(r.data.tables.ints.size, 0, '★不假装读到了表：引擎槽的表布局未分析（SLOT_GAPS）');
  assert.ok(r.data.header.playSeconds > 0);
});

// ---------------------------------------------------------------------------
// 头契约（合成槽）：写进去什么，0x1A0 就必须读出什么
// ---------------------------------------------------------------------------
test('0x1A0：写进头的 SYSTEMTIME 与游玩秒数能被原样读回；缺文件/坏魔数分别是 1 / 2', async () => {
  const store = memoryFs();
  const { e } = mkEngine(store);
  const state = {
    key: 0x1234,
    cur: 0,
    frames: [],
    globals: { int: [], float: [], str: [] },
    playSeconds: 4242,
  };
  const when = new Date(2026, 4, 8, 23, 55, 13); // 2026-05-08 23:55:13（本地时区）
  store.slots.set(3, buildSlotFile({ tables: { ints: new Map(), strings: new Map() }, usedFileIds: [], state, now: when }));

  // 输出操作数 = global-int 槽（0x10..0x18）；op2 = 槽号（立即数）
  const out = (base: number, slot: BinArg): BinArg[] => [gInt(base), slot, ...Array.from({ length: 7 }, (_, i) => gInt(base + 1 + i))];
  const read = await runOp(e, 0x1a0, out(0x10, im(3)));
  assert.equal(read(1), 0, 'op1 = 0（成功）');
  assert.equal(read(3), 2026, 'op3 = 年');
  assert.equal(read(4), 5, 'op4 = 月');
  assert.equal(read(5), 8, 'op5 = 日（★不是星期）');
  assert.equal(read(6), 23, 'op6 = 时');
  assert.equal(read(7), 55, 'op7 = 分');
  assert.equal(read(8), 13, 'op8 = 秒');
  assert.equal(read(9), 4242, 'op9 = 游玩秒数');

  // 槽不存在 ⇒ op1 = 1（引擎 `CreateFileA` 失败那条）
  const read2 = await runOp(e, 0x1a0, out(0x20, im(7)));
  assert.equal(read2(1), 1, '打不开 ⇒ op1 = 1');

  // 魔数坏 ⇒ op1 = 2（引擎 `sub_438120` 校验失败那条）
  const bad = buildSlotFile({ tables: { ints: new Map(), strings: new Map() }, usedFileIds: [], state, now: when });
  bad[0] = 0x58; // 'X'
  store.slots.set(8, bad);
  const read3 = await runOp(e, 0x1a0, out(0x30, im(8)));
  assert.equal(read3(1), 2, '头校验失败 ⇒ op1 = 2');
});

// ---------------------------------------------------------------------------
// 验收 ②：存档 → 读档往返，`load-int`/`load-string` 取回登记值
// ---------------------------------------------------------------------------
test('★0x19E 存档 → 0x1A1 读档：两张表（load-int/load-string）、全局池与游标都回来了', async () => {
  const store = memoryFs();
  // ---- 存档侧：写表 + 全局池 + 游玩时长，然后存档到槽 1 ----
  const a = mkEngine(store);
  a.e.playSeconds = 3661.5;
  a.e.stringIndexTable.set('\x030000a9ce', 2);
  a.e.stringTable.set('\x0500000bbb', 'Amayui CN');
  a.e.globals.int.set(0x40, enc(a.e.key, 12345)); // 全局 int 池在**运行时就是 ENC 过的**（`operand.ts` 写入即 ENC、读出即 DEC）
  a.e.globals.float.set(0x41, 1.5);
  a.e.globals.str.set(0x42, 'こんにちは');
  a.e.curScript().ip = 3;
  const saveRead = await runOp(a.e, 0x19e, [gInt(0x10), im(1)]);
  assert.equal(saveRead(1), 0, '存档应成功（op1 = 0）');
  assert.ok(store.slots.has(1), '槽 1 应有文件');

  // ---- 读档侧：另一个引擎（干净状态）读同一个槽 ----
  const b = mkEngine(store);
  b.e.stringIndexTable.set('\x030000a9ce', 99);
  b.e.globals.int.set(0x40, enc(b.e.key, 1));
  const loadRead = await runOp(b.e, 0x1a1, [gInt(0x10), im(1)]);
  // 引擎 `0x1A1` **不写任何操作数**（raw 21217 调度器丢弃返回值、`sub_42DDE0` 不调 `sub_42B4B0`）⇒
  // op1 的值来自"整份池被还原"（槽里没有 0x10 ⇒ 0），而不是状态码。这条独立性由下面那个专用测试守住。
  assert.equal(loadRead(1), 0, '0x1A1 不写状态码 ⇒ op1 是还原后的池值（槽里没有 0x10 ⇒ 0）');

  // ① 表：`load-int`（0x1A3）/`load-string`（0x1AA）取回登记值 —— 本票验收 ②
  const li = instr(0x1a3, [gInt(0xa9ce)]);
  await OPS.get(0x1a3)!(makeCtx(b.e, b.e.curScript(), li, b.e.native, () => {}));
  assert.equal(readIntOperand(b.e, b.e.curScript(), li, 1), 2, 'load-int 应把存档时的 2 写回操作数槽（VM 可见值 = 2）');
  const ls = instr(0x1aa, [{ type: 5, raw: 0xbbb } as unknown as BinArg]);
  await OPS.get(0x1aa)!(makeCtx(b.e, b.e.curScript(), ls, b.e.native, () => {}));
  assert.equal(b.e.globals.str.get(0xbbb), 'Amayui CN', 'load-string 应取回存档时的字体名');

  // ② 全局池 + 游标 + 游玩时长（int 池经 DEC；float/str 池无混淆）
  assert.equal(dec(b.e.key, b.e.globals.int.get(0x40) ?? 0), 12345, '全局 int 池按存档时的 key 一起还原 ⇒ DEC 回 12345');
  assert.equal(b.e.globals.float.get(0x41), 1.5);
  assert.equal(b.e.globals.str.get(0x42), 'こんにちは');
  assert.equal(b.e.playSeconds, 3661, '游玩秒数取整后写进槽（3661.5 ⇒ 3661）');
  // ★续跑改成"引擎那条路"（`tickets/T-0063`）：读档把帧装到**入口**、把落点放进 `saveResume`，
  //   由脚本入口那条 `i0ae` 落 ip/走栈 ⇒ 这里断言"入队 + 帧 0 从入口跑"，落点在 `0xAE` 时生效。
  assert.equal(b.e.cur, 0, 'cur = 0（引擎 `Engine[383104] = 0`：从帧 0 入口开始走栈）');
  assert.equal(b.e.curScript().ip, 0, '帧 0 被装到入口');
  assert.ok(b.e.saveResume, '续跑记录已入队（脚本入口的 i0ae 会用）');
  assert.equal(b.e.saveResume!.frames[0]!.instr, 3, '落点 = 存档时那条指令（3）');
});

test('0x1AB 删槽 / 0x1AC 复制槽 / 0x1AE·0x1AF 的 .STH 往返', async () => {
  const store = memoryFs();
  const { e } = mkEngine(store);
  const state = { key: 0, cur: 0, frames: [], globals: { int: [], float: [], str: [] }, playSeconds: 1 };
  store.slots.set(2, buildSlotFile({ tables: { ints: new Map(), strings: new Map() }, usedFileIds: [], state }));

  // 复制 2 → 4：源槽只有 `.DAT`（真实存档是 `.DAT`+`.STH` 两份，这里先覆盖"第二份失败"那支）
  // 引擎 raw 38505-38511：`v5 = !CopyFileA(DAT)`；`if (!CopyFileA(STH)) v5 = 2;` ⇒ 第二份失败 = 2（不是 1，1 只表示 `.DAT` 就失败了）
  const cpRead = await runOp(e, 0x1ac, [gInt(0x10), im(2), im(4)]);
  assert.equal(cpRead(1), 2, '只复制了 .DAT（没有 .STH）⇒ 引擎口径 op1 = 2');
  assert.ok(store.slots.has(4), '槽 4 的 .DAT 已写出（第一份成功后才轮到第二份）');

  // `0x1AE` 给槽 4 补一份 `.STH`，再复制一次 ⇒ 两份都成功 ⇒ op1 = 0
  const tw0Read = await runOp(e, 0x1ae, [gInt(0x10), im(4), im(14)]);
  assert.equal(tw0Read(1), 0, '写 .STH 应成功');
  const cp2Read = await runOp(e, 0x1ac, [gInt(0x10), im(4), im(5)]);
  assert.equal(cp2Read(1), 0, '两份都复制成功 ⇒ op1 = 0');
  assert.ok(store.thumbs.has(5), '槽 5 的 .STH 也应被复制');

  // .STH 往返：`0x1AE` 写、`0x1AF` 读（`tickets/T-0036`：op3 是**纹理槽**，内容是 BMP）
  const trRead = await runOp(e, 0x1af, [gInt(0x10), im(4), im(0)]);
  assert.equal(trRead(1), 0, '读本工程写的 .STH（自描述空块）应成功');

  // 删槽：两个文件都在 ⇒ op1 = 0
  const delRead = await runOp(e, 0x1ab, [gInt(0x10), im(4)]);
  assert.equal(delRead(1), 0, '两个文件都删掉 ⇒ op1 = 0');
  assert.equal(store.slots.has(4), false);
  assert.equal(store.thumbs.has(4), false, '.STH 也要删');
});

test('槽状态块：编解码自洽 + 非本工程尾块 ⇒ null（不会误读引擎槽）', () => {
  const state = {
    key: 7,
    cur: 1,
    frames: [{ scriptId: 0x33, name: 'SAVE.BIN', ip: 42, retStack: [1, 2] }],
    globals: { int: [[1, 2] as [number, number]], float: [[3, 0.5] as [number, number]], str: [[4, 'x'] as [number, string]] },
    playSeconds: 9,
  };
  const enc = encodeSlotState(state);
  assert.ok(new TextDecoder().decode(enc).startsWith(SLOT_STATE_MAGIC), '尾块应带本工程魔数');
  assert.deepEqual(decodeSlotState(enc), state, '编解码自洽');
  assert.equal(decodeSlotState(new Uint8Array([1, 2, 3, 4])), null, '别家的尾块 ⇒ null');
  assert.equal(decodeSlotState(undefined), null);
});

// ---------------------------------------------------------------------------
// 落盘纪律：槽读写只碰 overlay
// ---------------------------------------------------------------------------
test('NodeFileSource：槽写盘只写 overlay\\SAVE\\SAVE01.DAT，真存档槽字节不变', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amayui-slot-'));
  const baseDir = path.join(dir, 'game');
  const overlayDir = path.join(dir, 'game.overlay');
  try {
    const src = new NodeFileSource({
      resourceDir: path.join(REPO, 'install'),
      system: { baseDir, overlayDir },
    });
    // base（真游戏那份）放一个槽，内容随便但要能被认出来
    const rel = slotRelPath(1);
    const baseTarget = path.join(baseDir, rel);
    fs.mkdirSync(path.dirname(baseTarget), { recursive: true });
    const engineSlot = new Uint8Array(400);
    engineSlot.set([0x53, 0x34, 0x53, 0x44], 0); // 'S4SD'
    fs.writeFileSync(baseTarget, engineSlot);
    assert.equal(await src.readSaveSlot(1).then((b) => b?.length), 400, '读时应继承 base 那份');

    const state = { key: 1, cur: 0, frames: [], globals: { int: [], float: [], str: [] }, playSeconds: 5 };
    const ours = buildSlotFile({ tables: { ints: new Map([['\x0300000005', 1]]), strings: new Map() }, usedFileIds: [], state });
    await src.writeSaveSlot(1, ours);
    const overlayTarget = path.join(overlayDir, rel);
    assert.ok(fs.existsSync(overlayTarget), '应写到 overlay');
    assert.deepEqual([...fs.readFileSync(baseTarget)], [...engineSlot], '★真存档槽字节不变');
    assert.equal(await src.readSaveSlot(1).then((b) => b?.length), ours.length, '读取优先 overlay');

    // .STH 同理
    await src.writeSlotThumb(1, new Uint8Array([1, 2, 3, 4]));
    assert.ok(fs.existsSync(path.join(overlayDir, slotThumbRelPath(1))), '.STH 应写到 overlay');
    assert.equal(await src.readSlotThumb(1).then((b) => b?.length), 4);

    // 删槽只删 overlay（base 那份仍在 ⇒ 引擎语义下"删了又继承回来"是正常的）
    await src.deleteSaveSlot(1);
    assert.ok(!fs.existsSync(overlayTarget), 'overlay 那份应被删');
    assert.ok(fs.existsSync(baseTarget), 'base 那份不动');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('槽路径格式与引擎的 `%2.2d`（精度 2 ⇒ 补 0）一致', () => {
  assert.equal(slotRelPath(0), 'SAVE/SAVE00.DAT');
  assert.equal(slotRelPath(7), 'SAVE/SAVE07.DAT');
  assert.equal(slotRelPath(42), 'SAVE/SAVE42.DAT');
  assert.equal(slotThumbRelPath(3), 'SAVE/SAVE03.STH');
});

test('★0x1A1 不写操作数（引擎不调 sub_42B4B0）；0x19F 才写 op1', async () => {
  const store = memoryFs();
  const { e } = mkEngine(store);
  // 造一个**引擎格式**（format 3）的槽：本工程只读头（state 为空、两张表为空）⇒ 池**不会**被替换，
  // 于是 `op1` 槽里那个哨兵只有在 handler 主动写它时才会变。
  const eng = new Uint8Array(400);
  eng.set([0x53, 0x34, 0x53, 0x44], 0); // 'S4SD'
  eng.set([0x34, 0x36, 0x30, 0x42], 4); // '460B'
  new DataView(eng.buffer).setUint32(284, 3, true); // format 3（真槽口径）
  new DataView(eng.buffer).setInt32(280, 4242, true); // 头 +280 = 游玩秒数（引擎 raw 44812）
  store.slots.set(6, eng);

  e.globals.int.set(0x10, enc(e.key, 0x5aa5));
  const loadUse = instr(0x1a1, [gInt(0x10), im(6)]);
  await OPS.get(0x1a1)!(makeCtx(e, e.curScript(), loadUse, e.native, () => {}));
  assert.equal(readIntOperand(e, e.curScript(), loadUse, 1), 0x5aa5, '★0x1A1 不写 op1（哨兵原样）');
  assert.equal(e.playSeconds, 4242, '引擎槽的状态主体未解，但头的 +280（游玩秒数）要接上（否则存档重新计时）');

  const read = await runOp(e, 0x19f, [gInt(0x11), im(6)]);
  assert.equal(read(1), 0, '0x19F（短读档）**写** op1：引擎 raw 38362 有 sub_42B4B0');
});

test('无宿主槽能力（StubNative/无 fileSource）时读档链路不抛错：0x19F 报 1（打不开），0x1A1 静默', async () => {
  const e = new Engine(new StubNative(() => {})); // 没有 fileSource
  const read = await runOp(e, 0x19f, [gInt(0x10), im(0)]);
  assert.equal(read(1), 1, '0x19F 打不开 ⇒ op1 = 1（与引擎"文件不存在"同码）');
  const loadUse = instr(0x1a1, [gInt(0x10), im(0)]);
  await OPS.get(0x1a1)!(makeCtx(e, e.curScript(), loadUse, e.native, () => {}));
  assert.equal(readIntOperand(e, e.curScript(), loadUse, 1), 1, '★0x1A1 一个字节都不写：op1 仍是 0x19F 刚写下的 1（引擎不写 op1）');
});

// 让"写回操作数"的辅助函数被使用（避免 lint 噪音）：它其实覆盖了 handler 的写入路径。
void encodeSaveData;
void writeIntOperand;
void INI_FILE;
