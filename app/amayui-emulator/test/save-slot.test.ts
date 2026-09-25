/** @tier T1 @kind core @subsystem save */

/**
 * **存档槽链路回归**（`tickets/T-0018`）：读头 `0x1A0` / 读档 `0x1A1` / 存档 `0x19E` / 删 `0x1AB` /
 * 复制 `0x1AC` / `.STH` `0x1AE`·`0x1AF`。
 *
 * 三层证据：
 *  - **E4**：本机真存档槽（`…\SAVE\SAVE00.DAT`）的头 —— 文件时间与头里那 6 个 u16 必须一致，
 *    游玩秒数 > 0（这就是"`0x1A0` 的字段布局"的实证，见 `saveSlot.ts` 文件头）；
 *  - **E2**：合成引擎上的存档→读档往返（`load-int`/`load-string` 取回登记值 = 本票验收 ②）；
 *  - **E2**：`NodeFileSource` 的槽**写**只碰 overlay（真存档槽一个字节都不动）。
 *    ★`T-0153` 订正：**删**是例外（引擎 `DeleteFileA` 打在真实目录，raw 38473-38481）⇒ 两侧都删、
 *    base 那一份先隔离到 `<overlay>/SAVE/.deleted/`；本文件下面那条槽用例的断言已随之 retarget。
 */
import { test } from 'node:test';
import { classifyRealSlot, findRealFiles, readReal, realSlotDirs, type RealFile } from './realSlots.js';
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
import { isBmp } from '../src/vm/bmp.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import type { BinArg, BinInstruction, ScriptBinary } from '../src/script/bin.js';
import { buildScriptBin } from './engineSlotFixtures.js';
import { synthSlotScript } from './harness.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

const im = (n: number): BinArg => ({ type: 0, raw: n }) as unknown as BinArg;
const gInt = (slot: number): BinArg => ({ type: 3, raw: slot }) as unknown as BinArg;
const instr = (opcode: number, args: BinArg[] = []): BinInstruction =>
  ({ opcode, name: `i${opcode.toString(16)}`, argc: args.length, args, byteOffset: 0, index: 0 }) as unknown as BinInstruction;

/** 造一个装了合成脚本的引擎（含一张空脚本，供 `load-int` 写回操作数）。 */
function mkEngine(fsLike: FileSource): { e: Engine; script: ScriptBinary } {
  const e = new Engine(new StubNative(() => {}));
  // ★合成槽脚本 = 共享夹具（`tickets/T-0129` 上收；`save-thumb` 那份逐字相同）
  const script: ScriptBinary = synthSlotScript();
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
test('E4：真存档槽的头 → 0x1A0 的六个 u16 = 存档时刻（SYSTEMTIME）+ 游玩秒数', (t) => {
  // ★`tickets/T-0128`：改为**两侧都看**（base + overlay）—— 本机真槽只在 overlay 一侧，
  //   原写法（只查 base）在这些用例上是"静默跳过"。
  const slots = findRealFiles(REPO, 'DAT');
  if (slots.length === 0) {
    t.skip(`本机没有真存档槽（${realSlotDirs(REPO).join(' / ')}）`);
    return;
  }
  // ★2026-09-23：原来在**第一个**真槽上逐字段断「头 == 文件 mtime」。闸门打开后实测：
  //   本机 SAVE79 与 mtime **逐秒一致**（= 这个字段确实是存档时刻），而 SAVE78 的 mtime 是后来
  //   被重写/复制过的（头 00:48:39 vs mtime 13:26）⇒ 单槽硬比 mtime 会随"文件有没有被碰过"假红。
  //   改成两层：① 每个槽的头都必须是**合法 SYSTEMTIME**（年/月/日/时/分/秒 在有效范围、format∈引擎域、游玩秒数>0）；
  //            ② **至少一个**槽的头与 mtime 一致（证明这个字段就是存档时刻 —— 这是判据的核心，不能省）。
  //
  // ★★2026-09-25（`tickets/T-0146`）：**判据①只适用于"真游戏写的槽"** —— 先按字节判作者。
  //   为什么必须分：overlay 是**本工程唯一的写目标**（`src/arch/systemPaths.ts`），本机那里混着
  //   两个 **emulator 自己写出来的**槽 `SAVE70/71`（`+284 = 0 = SAVE_FORMAT_PLAIN` + `AMYS1` 状态尾块，
  //   来源 = T-0061/T-0062/T-0063 的用户实测存档，见 `test/realSlots.ts` 头注）⇒ 它们**不是**真游戏槽，
  //   拿"真槽 format 必须 ≥3"去要求它们是把判据用错了对象（本工程槽的 `format=0` 正是为了**互不误读**）。
  //   ★跳过（`ours`）只允许用在**已用正向判据证明**的槽上（`classifyRealSlot`：format=0 **且**尾块解得出
  //   本工程状态块）；**看不懂的第三种作者一律失败**（`unknown` ⇒ 断言红）—— 这样"跳过"不会变成掩盖真回归的暗门。
  //   ★引擎槽仍然**逐个**要求：头合法、format ∈ 1..3、游玩秒数 > 0、且至少一个与 mtime 一致。
  const engine: { slot: RealFile; bytes: Uint8Array }[] = [];
  const ours: { name: string; why: string }[] = [];
  const unknown: string[] = [];
  for (const slot of slots) {
    const bytes = readReal(slot);
    const o = classifyRealSlot(bytes);
    if (o.kind === 'engine') engine.push({ slot, bytes });
    else if (o.kind === 'ours') ours.push({ name: slot.name, why: o.why });
    else unknown.push(`${slot.name}: ${o.why}`);
  }
  assert.deepEqual(
    unknown,
    [],
    `既不是引擎槽、也不是本工程槽的真槽（第三种作者 ⇒ 不许静默跳过）：\n${unknown.join('\n')}`,
  );
  if (engine.length === 0) {
    t.skip(
      `本机这份目录里没有**真游戏**写的槽（全是本工程槽：${ours.map((o) => o.name).join(' / ') || '一个都没有'}）`,
    );
    return;
  }
  t.diagnostic(
    `[E4] 真槽 ${slots.length} 个 = 引擎槽 ${engine.length} 个 + 本工程槽 ${ours.length} 个` +
      `${ours.length ? `（${ours.map((o) => `${o.name}：${o.why}`).join('；')}）` : ''}`,
  );

  const lines: string[] = [];
  let matched = 0;
  for (const { slot, bytes } of engine) {
    const r = parseSlotHeader(bytes);
    assert.equal(r.ok, true, r.ok ? '' : `${slot.name}: ${r.reason}`);
    if (!r.ok) return;
    const h = r.header;
    const st = fs.statSync(slot.path);
    assert.equal(h.magic, 'S4SD', `${slot.name} 魔数`);
    assert.ok(h.year >= 2000 && h.year <= 2100, `${slot.name} 年合法（${h.year}）`);
    assert.ok(h.month >= 1 && h.month <= 12, `${slot.name} 月合法（+266 = ${h.month}）`);
    assert.ok(h.day >= 1 && h.day <= 31, `${slot.name} 日合法（+270 = ${h.day}；★+268 是星期、0x1A0 不取）`);
    assert.ok(h.hour <= 23 && h.minute <= 59 && h.second <= 59, `${slot.name} 时/分/秒合法（+272/+274/+276）`);
    assert.ok(h.playSeconds > 0, `${slot.name} 头 +280 = 游玩秒数（实际 ${h.playSeconds}）`);
    // ★判据钉在**引擎自己的域**上（`saveSlot.ts` 的 `SlotHeader.format` 文档：真槽写 1/2/3）：
    //   本机 56/56 都是 3，写 1/2 的是引擎的旧布局（`SLOT_GAPS` 记着"仍未解析"）⇒ 两者都是「引擎槽」。
    assert.ok(
      h.format >= 1 && h.format <= 3,
      `${slot.name} 的 format ∈ 1..3（= 引擎 SaveVersion1；实测本机真槽全是 3，实际 ${h.format}）`,
    );
    const same =
      h.year === st.mtime.getFullYear() && h.month === st.mtime.getMonth() + 1 && h.day === st.mtime.getDate() &&
      h.hour === st.mtime.getHours() && h.minute === st.mtime.getMinutes() &&
      Math.abs(h.second - st.mtime.getSeconds()) <= 2;
    if (same) matched++;
    lines.push(
      `  ${slot.name}: 头 ${h.year}-${h.month}-${h.day} ${h.hour}:${h.minute}:${h.second}` +
        ` / mtime ${st.mtime.toLocaleString()} ${same ? '（一致）' : '（文件被重写过 ⇒ 不参与一致性判据）'}`,
    );
  }
  // 本工程槽（emulator 写的）：头字段**同形**（同一个 `buildSlotFile` 写 +264..+280），所以也逐项查一遍
  // —— 这是"这些槽确实是我们自己写的那一份"的交叉验证。★**不查 `playSeconds > 0`**：那是引擎槽侧的
  // "存档时钟"判据；本工程槽的 +280 是 `SlotStateBlock.playSeconds`，刚开档就是 0，为 0 不是异常。
  for (const { name } of ours) {
    const slot = slots.find((s) => s.name === name)!;
    const r = parseSlotHeader(readReal(slot));
    assert.equal(r.ok, true, r.ok ? '' : `${name}: ${r.reason}`);
    if (!r.ok) continue;
    const h = r.header;
    assert.equal(h.magic, 'S4SD', `${name}（本工程槽）魔数`);
    assert.equal(h.format, 0, `${name}（本工程槽）+284 = SAVE_FORMAT_PLAIN = 0`);
    assert.ok(
      h.year >= 2000 && h.year <= 2100 && h.month >= 1 && h.month <= 12 && h.day >= 1 && h.day <= 31 &&
        h.hour <= 23 && h.minute <= 59 && h.second <= 59,
      `${name}（本工程槽）头 +264..+276 也必须是合法 SYSTEMTIME（同一个写侧）`,
    );
  }
  assert.ok(
    matched >= 1,
    `至少应有一个真槽的头部时刻与文件 mtime 一致（= 头 +264..+276 确实是存档时刻）；实测：\n${lines.join('\n')}`,
  );
});

test('E4：真存档槽能读到整份"头"；状态主体是引擎私有布局 ⇒ engineFormat = true（缺口已登记）', (t) => {
  // ★`T-0146`：`firstRealFile` 取的是**名字最小**的那个（`SAVE00`），但那**不保证**是引擎槽
  //   （本机 `SAVE70/71` 就是 emulator 写在 overlay 的本工程槽）⇒ 按判据挑**引擎槽**；
  //   一个引擎槽都没有（这台机器没玩过 / 只有本工程槽）⇒ `t.skip`（与本用例原来的"没有真槽就跳"同口径）。
  const engine = findRealFiles(REPO, 'DAT').filter((f) => classifyRealSlot(readReal(f)).kind === 'engine');
  const slot = engine[0];
  if (!slot) {
    t.skip(`本机没有**真游戏**写的槽（${realSlotDirs(REPO).join(' / ')}）`);
    return;
  }
  const r = parseSlotFile(readReal(slot));
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
  // ★`T-0159` 订正（**旧前提不成立**）：旧写法依赖"宿主拿不到该槽像素 ⇒ 写一个 `AMYTH1\n{…}` 自造空块并报 0"，
  //   而引擎在那一格是**失败**——`op3` 槽没创建 ⇒ `sub_43BF20`/`sub_4A5260` 返回 0 ⇒ `op1 = 2`、
  //   `.STH` 停在 **0 字节**（`sub_42E1F0` raw 38532-38546）；自造块格式已按体废弃（写侧删除，读侧只留历史容忍）。
  //   ⇒ 这里给宿主一份该槽的像素（真机 = 脚本 `create-texture` 出来的画布槽），走的仍是"写 BMP"那条真实路径；
  //   "没有像素 ⇒ 2 + 0 字节"那一格由 `test/save-slot-engine-codes.test.ts` 钉死。
  (e.native as unknown as { getSlotPixels: (s: number) => unknown }).getSlotPixels = (slot: number) =>
    slot === 14 ? { w: 2, h: 2, rgba: new Uint8Array(2 * 2 * 4) } : null;
  const tw0Read = await runOp(e, 0x1ae, [gInt(0x10), im(4), im(14)]);
  assert.equal(tw0Read(1), 0, '写 .STH 应成功（该槽有像素 ⇒ `encodeBmp` 那条真实路径）');
  assert.ok(isBmp(store.thumbs.get(4)!), '写出的 `.STH` 必须是 BMP（引擎 raw 47838 的 `"BM"` + DIB）');
  const cp2Read = await runOp(e, 0x1ac, [gInt(0x10), im(4), im(5)]);
  assert.equal(cp2Read(1), 0, '两份都复制成功 ⇒ op1 = 0');
  assert.ok(store.thumbs.has(5), '槽 5 的 .STH 也应被复制');

  // .STH 往返：`0x1AE` 写、`0x1AF` 读（`tickets/T-0036`：op3 是**纹理槽**，内容是 BMP）
  const trRead = await runOp(e, 0x1af, [gInt(0x10), im(4), im(0)]);
  assert.equal(trRead(1), 0, '读刚写的 BMP `.STH` 应成功（`decodeBmp` 认得它）');

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

    // ★`T-0153` 订正（前提被取代）：删槽**两侧都删**。引擎的 `DeleteFileA` 打在真实存档目录
    //   （`sub_42DFC0` raw 38473-38481：`"%s\\SAVE%2.2d.DAT"` + `sub_408A40` 给的目录），而本工程的读
    //   会回落 base ⇒ 只删 overlay 时"只存在于 base 的槽删不掉"（返回码 1 对引擎的 0），而且删掉自己
    //   那份会让基座的旧槽复活。base 那一份删前会先隔离到 `<overlay>/SAVE/.deleted/`（字节不丢）。
    //   ★写路径的安全规则（本文件上面那条"只写 overlay"）**不变**。
    await src.deleteSaveSlot(1);
    assert.ok(!fs.existsSync(overlayTarget), 'overlay 那份应被删');
    assert.ok(!fs.existsSync(baseTarget), '★base 那份同样被删（引擎语义：删的就是真实目录里那一份）');
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
