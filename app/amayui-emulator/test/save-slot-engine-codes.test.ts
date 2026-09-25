/** @tier T0 @kind core @subsystem save */

/**
 * **`T-0159`：存档槽链路的引擎口径守卫**（2026-09 全指令核对批次 `save-slot`；P2 7 / P3 7）。
 *
 * 与 `save-slot.test.ts`（T-0018 的链路回归）分工：那份钉"链路走得通"，本文件钉**结果码口径与
 * 判据来源** —— 也就是审计里那些"返回码多出一个引擎没有的值 / 判据比引擎宽或窄 / 自造格式"的条目。
 *
 * | 用例 | 引擎体（`engine/天结_unpacked.exe_utf8.c` 行号 = raw） | 钉住的行为 |
 * |---|---|---|
 * | `0x19E` 覆盖确认 | `sub_42D980` raw 38306-38316 | 文件**存在且头不合法** ⇒ 问宿主一次；答"否"（`sub_406650(...)==7` = IDNO）⇒ `op1 = 1` + 原文件不动 |
 * | `0x19E` 写失败 | `sub_42D980` raw 38317-38322 | `op1 = 1`（不是 2）+ 宿主错误串缝被通知（`sub_40A4C0(..., aE, 5)`） |
 * | `0x19F` 码域 | `sub_42DB10` raw 38346-38362 + `sub_410160` raw 19411-19412/19930-19932 | `op1 ∈ {1, -1, 0}`：打不开 1；头读不出**且** `a4 = set:SaveVersion1 ∈ {2,3}` ⇒ **-1**；其余（含容器读失败）⇒ 0 |
 * | `0x19F` 空装载 | 同上（raw 19408-19416 的空循环 ⇒ 主出口 0） | 帧一个都没装上 ⇒ `op1 = 0` 但日志必须说"未恢复任何帧" |
 * | `0x1A0` 字节口径 | `sub_438120` raw 45115（`ReadFile(...,0x124)` + `NumberOfBytesRead == 292`） | 恰好 292 B ⇒ 0；291 B ⇒ 2 |
 * | 头判据来源 | raw 45117-45127（魔数 + **+8 游戏名** strcmp）+ raw 23745（`set:GameName` → `Engine+698912`） | 引擎的真判据是 **+8 的游戏名**；`+4` 的版本串是**本工程**的额外判据（引擎不比它） |
 * | `0x1AE` 空槽 | `sub_42E1F0` raw 38532-38546（`sub_43BF20`/`sub_4A5260` 失败 ⇒ 2，文件停在 0 字节） | `op3` 槽没有像素 ⇒ `op1 = 2` 且 `.STH` 是 **0 字节**（不再写自造块 `AMYTH1`） |
 * | `0x1AE` DrawMode | raw 38537（`_this[166964] == 1` ⇒ D3D 截图 `sub_4A5260`） | `set:DrawMode = 1` 时**显式声明**走了非 D3D 实现（缺该分支） |
 * | `0x1AF` 空文件 | `sub_42E320` raw 38569-38592 + `sub_4036B0` raw 9564-9570 | 打开成功但读入失败（0 字节）⇒ **2**（不是 1）；文件不存在 ⇒ 1 |
 * | `0x1AF` 非 BMP | raw 38580-38583（`sub_43E9F0` 校验 `BM`）；raw 119663-119676（D3D 路的第二格式） | 非 BMP 且非旧版自造块 ⇒ 2；旧版 `AMYTH1` 块仍读得回（0，跨越版本的历史容忍） |
 * | `0x1AC` 两次独立复制 | `sub_42E0A0` raw 38504-38511 | `.DAT`/`.STH` 是**两次独立调用** ⇒ `{dat:false, sth:true}` ⇒ **1**；`{dat:true, sth:false}` ⇒ 2；都失败 ⇒ 2 |
 * | 操作数触碰 | raw 38303/38383/38530（先 `sub_41BF50(_this, 2)` 再建文件名） | 存档槽族 8 条**先读 op2/op3**，再判宿主能力（`ALLOW_UNDERRUN` 的理由口径，见 `changes-slots.md`） |
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Engine } from '../src/vm/engine.js';
import { StubNative } from '../src/vm/native.js';
import type { NativeBridge } from '../src/vm/native.js';
import type { FileSource } from '../src/arch/fileSource.js';
import { OPS } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import { readIntOperand } from '../src/vm/operand.js';
import { parseIni, type EngineConfig } from '../src/engineConfig.js';
import { SAVE_HEADER_BYTES } from '../src/save/saveData.js';
import { buildSlotFile, parseSlotHeader } from '../src/save/saveSlot.js';
import { loadSlotIntoEngine } from '../src/vm/handlers/save-slot.js';
import type { BinArg } from '../src/script/bin.js';
import { im, instr, mkEngine, trackArgs } from './harness.js';

/** 全局 int 槽（`op1` 这类"写目标"实参；立即数写不了）。 */
const gInt = (n: number): BinArg => ({ type: 3, raw: n }) as unknown as BinArg;

/** `[set]` 段配置（`mkEngine` 造的引擎 `config` 是 null ⇒ 需要配置的用例显式给）。 */
const setCfg = (body: string): EngineConfig => parseIni(`[set]\n${body}`);

/** 内存槽存储（只实现本文件用到的 FileSource 槽方法）。 */
interface SlotStore {
  slots: Map<number, Uint8Array>;
  thumbs: Map<number, Uint8Array>;
  /** `true` ⇒ `writeSaveSlot` 抛（模拟"写打开失败"，引擎 raw 38318）。 */
  failWrite?: boolean;
}

function slotFs(store: SlotStore): FileSource {
  return {
    readFile: async () => new Uint8Array(0),
    readScript: async () => null,
    readSaveSlot: async (s: number) => store.slots.get(s) ?? null,
    writeSaveSlot: async (s: number, d: Uint8Array) => {
      if (store.failWrite) throw new Error('EACCES: 写不了（测试注入）');
      store.slots.set(s, d);
    },
    deleteSaveSlot: async (s: number) => ({ dat: store.slots.delete(s), sth: store.thumbs.delete(s) }),
    copySaveSlot: async (from: number, to: number) => {
      // ★引擎是**两次独立**的 CopyFileA（raw 38505/38510）⇒ 这里也独立（`.DAT` 失败不影响 `.STH`）。
      const d = store.slots.get(from);
      const t = store.thumbs.get(from);
      if (d) store.slots.set(to, d);
      if (t) store.thumbs.set(to, t);
      return { dat: d !== undefined, sth: t !== undefined };
    },
    readSlotThumb: async (s: number) => store.thumbs.get(s) ?? null,
    writeSlotThumb: async (s: number, d: Uint8Array) => void store.thumbs.set(s, d),
  } as unknown as FileSource;
}

/** 只有两张能力（没有槽能力）的 FileSource：用来验"先读操作数、再判宿主能力"。 */
function bareFs(): FileSource {
  return { readFile: async () => new Uint8Array(0), readScript: async () => null } as unknown as FileSource;
}

/** 跑一条 handler 并读回它写进操作数槽的值（与 `save-slot.test.ts` 同口径）。 */
async function runOp(e: Engine, opcode: number, args: BinArg[]): Promise<(k: number) => number> {
  const h = OPS.get(opcode);
  assert.ok(h, `0x${opcode.toString(16)} 应在 OPS 里`);
  const use = instr(opcode, args);
  await h!(makeCtx(e, e.curScript(), use, e.native, () => {}));
  return (k: number): number => readIntOperand(e, e.curScript(), use, k);
}

/** 本工程格式（`format = 0`）的一个合法槽字节。 */
function ourSlot(playSeconds = 7): Uint8Array {
  return buildSlotFile({
    tables: { ints: new Map(), strings: new Map() },
    usedFileIds: [],
    state: { key: 1, cur: 0, frames: [], globals: { int: [], float: [], str: [] }, playSeconds },
  });
}

/** 一个头不合法的槽（魔数坏）⇒ 引擎 `sub_438120` 返回 0。 */
function badHead(playSeconds = 7): Uint8Array {
  const b = ourSlot(playSeconds);
  b[0] = 0x58; // 'X'
  return b;
}

/** 记账 + 确认缝的宿主（`SlotHostSeams`；宿主未声明 ⇒ 全部走"无该能力"）。 */
function seamsHost(
  logs: string[],
  answer: boolean | null,
): NativeBridge & { asked: number[]; failed: { slot: number; message: string }[] } {
  const n = new StubNative((m) => void logs.push(m)) as unknown as NativeBridge & {
    asked: number[];
    failed: { slot: number; message: string }[];
    confirmSlotOverwrite?: (slot: number) => boolean;
    slotWriteFailed?: (slot: number, message: string) => void;
  };
  n.asked = [];
  n.failed = [];
  if (answer !== null) {
    n.confirmSlotOverwrite = (slot: number): boolean => {
      n.asked.push(slot);
      return answer;
    };
  }
  n.slotWriteFailed = (slot: number, message: string) => void n.failed.push({ slot, message });
  return n;
}

// ---------------------------------------------------------------------------
// 0x19E：覆盖确认（引擎 MB_YESNO|MB_ICONQUESTION，0x34 = YESNO|ICONQUESTION|DEFBUTTON2）
// ---------------------------------------------------------------------------

test('★T-0159 0x19E：槽存在但头不合法 ⇒ 问宿主一次；答"否" ⇒ op1 = 1 且原文件一个字节不变', async () => {
  const store: SlotStore = { slots: new Map([[2, badHead()]]), thumbs: new Map() };
  const logs: string[] = [];
  const host = seamsHost(logs, false);
  const e = mkEngine([instr(0x1a7, [])], 'TEST.BIN', host);
  e.fileSource = slotFs(store);
  const before = [...store.slots.get(2)!];

  const read = await runOp(e, 0x19e, [gInt(0x10), im(2)]);
  assert.equal(read(1), 1, '引擎 raw 38312-38313：`CloseHandle` + `sub_42B4B0(_this,1,1)` ⇒ op1 = 1');
  assert.deepEqual([...store.slots.get(2)!], before, '★原文件必须保持不动（引擎那条分支走不到写侧）');
  assert.deepEqual(host.asked, [2], '问的正是 op2 那个槽');
  assert.ok(
    logs.some((l) => l.includes('覆盖确认')),
    `被拒绝时要有日志（ADR-010 的记录义务）；实际日志：\n${logs.join('\n')}`,
  );
});

test('★T-0159 0x19E：头合法 / 槽不存在 ⇒ 不问；宿主没有确认缝 ⇒ 恒按"点了是"覆盖', async () => {
  const store: SlotStore = { slots: new Map([[3, ourSlot()]]), thumbs: new Map() };
  const logs: string[] = [];
  const host = seamsHost(logs, false); // 即使宿主**会**答否，也不该被问
  const e = mkEngine([instr(0x1a7, [])], 'TEST.BIN', host);
  e.fileSource = slotFs(store);

  const ok = await runOp(e, 0x19e, [gInt(0x10), im(3)]);
  assert.equal(ok(1), 0, '合法旧槽 ⇒ 直接覆盖成功（引擎 `sub_438120(...) == 1` ⇒ 跳过确认框）');
  assert.deepEqual(host.asked, [], '★合法槽不该问');

  // 槽不存在 ⇒ 只读打开失败（raw 38306 带 0x8000000 = "不存在即返回 INVALID_HANDLE_VALUE"）⇒ 同样不问
  const fresh = await runOp(e, 0x19e, [gInt(0x10), im(9)]);
  assert.equal(fresh(1), 0, '新槽（文件不存在）⇒ 直接写');
  assert.deepEqual(host.asked, [], '★文件不存在时不问（引擎那条 if 根本不进）');

  // 宿主**没有**确认缝 ⇒ 按"玩家点了是"（登记缺口，见 changes-slots.md）
  const store2: SlotStore = { slots: new Map([[4, badHead()]]), thumbs: new Map() };
  const e2 = mkEngine([instr(0x1a7, [])], 'TEST.BIN', seamsHost(logs, null));
  e2.fileSource = slotFs(store2);
  const noSeam = await runOp(e2, 0x19e, [gInt(0x10), im(4)]);
  assert.equal(noSeam(1), 0, '★无宿主对话框 ⇒ 恒按"点了是"覆盖（`SLOT_GAPS` 的既有缺口）');
});

test('★T-0159 0x19E：写失败 ⇒ op1 = 1（引擎 raw 38317-38322）且宿主错误串缝收到通知', async () => {
  const store: SlotStore = { slots: new Map(), thumbs: new Map(), failWrite: true };
  const logs: string[] = [];
  const host = seamsHost(logs, null);
  const e = mkEngine([instr(0x1a7, [])], 'TEST.BIN', host);
  e.fileSource = slotFs(store);

  const read = await runOp(e, 0x19e, [gInt(0x10), im(5)]);
  assert.equal(read(1), 1, '★引擎两种写失败都是 1（`sub_40A4C0` + `sub_42B4B0(_this,1,1)`），不是 2');
  assert.equal(host.failed.length, 1, '写失败必须通知宿主（`sub_40A4C0(..., aE, 5)` 的等价缝）');
  assert.equal(host.failed[0]!.slot, 5);
  assert.match(host.failed[0]!.message, /保存/, '错误串要带引擎那条文案的语义（raw 4331 的 `aE`）');
  assert.equal(store.slots.has(5), false, '没写成功 ⇒ 槽文件不存在');
});

// ---------------------------------------------------------------------------
// 0x19F：结果码只能是引擎那三个值（{1, -1, 0}）—— 2 是 emulator 自造的
// ---------------------------------------------------------------------------

test('★T-0159 0x19F：码域 {1, -1, 0} —— 头读不出且 set:SaveVersion1∈{2,3} ⇒ -1；=1 ⇒ 0；打不开 ⇒ 1', async () => {
  const e = mkEngine([instr(0x1a7, [])]);
  e.fileSource = slotFs({ slots: new Map([[6, badHead()]]), thumbs: new Map() });
  e.config = setCfg('SaveVersion1=3'); // 引擎 a4（raw 38353-38357 读的正是这个键）
  const a = await runOp(e, 0x19f, [gInt(0x10), im(6)]);
  assert.equal(a(1), -1, '★引擎唯一的 -1 出口：a4 ∈ {2,3} 且 `sub_438120` 返回 0（raw 19411-19412）');

  const e1 = mkEngine([instr(0x1a7, [])]);
  e1.fileSource = slotFs({ slots: new Map([[6, badHead()]]), thumbs: new Map() });
  e1.config = setCfg('SaveVersion1=1'); // a4 = 1 ⇒ 整个 a4==2/3 段被跳过（raw 19408）
  const b = await runOp(e1, 0x19f, [gInt(0x10), im(6)]);
  assert.equal(b(1), 0, '★a4 = 1 ⇒ 引擎连头都不读、主出口 `return 0`（raw 19930-19932）');

  const e2 = mkEngine([instr(0x1a7, [])]);
  e2.fileSource = slotFs({ slots: new Map(), thumbs: new Map() });
  const c = await runOp(e2, 0x19f, [gInt(0x10), im(6)]);
  assert.equal(c(1), 1, 'CreateFileA 失败 ⇒ 常量 1（raw 38571-38572）');
});

test('★T-0159 0x19F：帧记录一条都装不上 ⇒ op1 = 0（与引擎同码），但日志必须说"未恢复任何帧"', async () => {
  const bytes = buildSlotFile({
    tables: { ints: new Map(), strings: new Map() },
    usedFileIds: [],
    state: {
      key: 1,
      cur: 0,
      frames: [{ index: 0, scriptId: 0xdead, name: 'GONE.BIN', ip: 0, retStack: [], caller: -1 }],
      globals: { int: [], float: [], str: [] },
      playSeconds: 3,
    },
  });
  const logs: string[] = [];
  const e = mkEngine([instr(0x1a7, [])], 'TEST.BIN', new StubNative((m) => void logs.push(m)));
  e.fileSource = slotFs({ slots: new Map([[7, bytes]]), thumbs: new Map() });
  const read = await runOp(e, 0x19f, [gInt(0x10), im(7)]);
  assert.equal(read(1), 0, '引擎此处也是 0（raw 19408-19416 的空循环路径 ⇒ 主出口 0）⇒ 不许用 op1 判"装载完整性"');
  assert.ok(
    logs.some((l) => l.includes('一个都没装上')),
    `一条帧都没恢复时必须留日志（否则 op1 = 0 会被当成"装载成功"）；实际：\n${logs.join('\n')}`,
  );
});

// ---------------------------------------------------------------------------
// 0x1A0：定长 292 B 读口径 + 头判据来源（+8 游戏名 vs +4 版本）
// ---------------------------------------------------------------------------

test('★T-0159 0x1A0：定长 292 B 口径 —— 恰好 292 B 算成功（0）、291 B ⇒ 2', async () => {
  const full = ourSlot();
  assert.ok(full.length > SAVE_HEADER_BYTES, '夹具应当比 292 长（否则量不到"只读 292"这层）');
  const store: SlotStore = {
    slots: new Map([
      [8, full.slice(0, SAVE_HEADER_BYTES)], // 恰好 292：引擎 `NumberOfBytesRead == 292` ⇒ 成功
      [9, full.slice(0, SAVE_HEADER_BYTES - 1)], // 291：`NumberOfBytesRead != 292` ⇒ op1 = 2
    ]),
    thumbs: new Map(),
  };
  const e = mkEngine([instr(0x1a7, [])]);
  e.fileSource = slotFs(store);
  const out = (base: number, slot: BinArg): BinArg[] => [
    gInt(base),
    slot,
    ...Array.from({ length: 7 }, (_, i) => gInt(base + 1 + i)),
  ];

  const a = await runOp(e, 0x1a0, out(0x10, im(8)));
  assert.equal(a(1), 0, '★恰好 292 B（无状态主体）在引擎里**算成功**（raw 45115 只读 0x124 并要求 == 292）');
  assert.equal(a(9), 7, 'op9 = 头 +280 的游玩秒数照常');

  const b = await runOp(e, 0x1a0, out(0x20, im(9)));
  assert.equal(b(1), 2, '★291 B ⇒ `NumberOfBytesRead != 292` ⇒ `sub_438120` 返回 0 ⇒ op1 = 2');
});

test('★T-0159 头判据：引擎比的是 +8 的**游戏名**（`set:GameName` → `Engine+698912`），+4 是本工程的额外判据', () => {
  const bytes = ourSlot(); // `buildSlotFile` 默认 title = 'AmayuiEmulator'（写在 +8）

  // ① 引擎的真判据：提供游戏名 ⇒ 比对 +8；不符 ⇒ 头不合法（code 2）
  const same = parseSlotHeader(bytes, { gameName: 'AmayuiEmulator' });
  assert.equal(same.ok, true, '★名字一致 ⇒ 头合法（引擎 raw 45123 的 strcmp 通过）');
  const diff = parseSlotHeader(bytes, { gameName: 'SOMETHING_ELSE' });
  assert.equal(diff.ok, false, '★名字不符 ⇒ 头不合法（引擎打「このゲームのセーブデータではありません」）');
  if (!diff.ok) assert.equal(diff.code, 2);
  // 不给游戏名（emulator 未建模 `set:GameName`）⇒ 跳过该项检查（登记缺口）
  assert.equal(parseSlotHeader(bytes).ok, true, '未提供游戏名 ⇒ 不做该项检查（缺口见 SLOT_GAPS）');

  // ② +4 是本工程的额外判据：引擎体里**没有**对 +4 的任何比较（raw 45117-45127 只有 +0 魔数与 +8）
  const v = bytes.slice();
  v.set([0x39, 0x39, 0x39, 0x39], 4); // '9999'
  assert.equal(
    parseSlotHeader(v).ok,
    false,
    '★emulator 保留 +4 判据（与真槽 E4 一致：本作 = 460B）；引擎不比它 ⇒ 这是本工程更严的额外判据',
  );
  assert.equal(parseSlotHeader(v, { engineVersion: '9999' }).ok, true, '可注入 ⇒ 换 exe 时改这里');
});

test('★T-0159 魔数：引擎按 `strncmp(Str1, Engine+698904, 2)` 二选一（本 exe 实测 S4SD）；S3SD 容忍可关', () => {
  const s3 = ourSlot();
  s3.set([0x53, 0x33, 0x53, 0x44], 0); // 'S3SD'
  assert.equal(parseSlotHeader(s3).ok, true, '默认容忍旧魔数（读老槽的历史容忍，登记在 SLOT_GAPS）');
  assert.equal(
    parseSlotHeader(s3, { acceptLegacyMagic: false }).ok,
    false,
    '★严格模式下只认本 exe 的 S4SD（引擎在该 exe 上只会选中一个魔数）',
  );
  assert.equal(parseSlotHeader(ourSlot(), { acceptLegacyMagic: false }).ok, true, 'S4SD 在严格模式下仍合法');
});

// ---------------------------------------------------------------------------
// 0x1AE：空槽 ⇒ 2 + 空文件；DrawMode = 1 ⇒ 显式声明
// ---------------------------------------------------------------------------

test('★T-0159 0x1AE：op3 槽没有像素 ⇒ op1 = 2 且 .STH 是 **0 字节**空文件（不再写自造块 AMYTH1）', async () => {
  const store: SlotStore = { slots: new Map(), thumbs: new Map() };
  const logs: string[] = [];
  const e = mkEngine([instr(0x1a7, [])], 'TEST.BIN', new StubNative((m) => void logs.push(m)));
  e.fileSource = slotFs(store);

  const read = await runOp(e, 0x1ae, [gInt(0x10), im(2), im(0x55)]);
  assert.equal(read(1), 2, '★引擎：`sub_43BF20`/`sub_4A5260` 返回 0 ⇒ `v7 = 2`（raw 38541/38546）');
  const bytes = store.thumbs.get(2);
  assert.ok(bytes, '★`.STH` 必须存在（引擎的 `CreateFileA` 在调用前已经建好，raw 38532）');
  assert.equal(bytes!.length, 0, '★而且必须是 **0 字节**（两条路都不写任何字节）—— 不许再写 `AMYTH1` 自造块');
  assert.ok(
    logs.some((l) => l.includes('AMYTH1')),
    `废弃自造块这件事要留一条日志（否则回退行为静默）；实际：\n${logs.join('\n')}`,
  );
});

test('★T-0159 0x1AE：set:DrawMode = 1 ⇒ 日志显式声明走了非 D3D 实现（引擎 raw 38537 的截图分支未建模）', async () => {
  const rgba = new Uint8Array(2 * 2 * 4);
  const logs: string[] = [];
  const native = new StubNative((m) => void logs.push(m)) as unknown as NativeBridge & {
    getSlotPixels: (s: number) => { w: number; h: number; rgba: Uint8Array } | null;
  };
  native.getSlotPixels = (s: number) => (s === 0x55 ? { w: 2, h: 2, rgba } : null);
  const store: SlotStore = { slots: new Map(), thumbs: new Map() };
  const e = mkEngine([instr(0x1a7, [])], 'TEST.BIN', native);
  e.fileSource = slotFs(store);
  e.config = setCfg('DrawMode=1');

  const read = await runOp(e, 0x1ae, [gInt(0x10), im(3), im(0x55)]);
  assert.equal(read(1), 0, '有像素 ⇒ 0（本机 DrawMode = 0 时引擎走的就是这条；D3D 分支未建模，见日志）');
  assert.ok(
    logs.some((l) => l.includes('DrawMode') && l.includes('D3D')),
    `★DrawMode = 1 时必须显式声明近似（不许静默走另一条实现）；实际：\n${logs.join('\n')}`,
  );
});

// ---------------------------------------------------------------------------
// 0x1AF：0 字节 ⇒ 2（打开成功、读入失败）
// ---------------------------------------------------------------------------

test('★T-0159 0x1AF：0 字节 .STH ⇒ op1 = 2；文件不存在 ⇒ 1（"打不开"与"读入失败"是两件事）', async () => {
  const store: SlotStore = { slots: new Map(), thumbs: new Map([[3, new Uint8Array(0)]]) };
  const e = mkEngine([instr(0x1a7, [])]);
  e.fileSource = slotFs(store);

  const empty = await runOp(e, 0x1af, [gInt(0x10), im(3), im(1)]);
  assert.equal(empty(1), 2, '★引擎 raw 38569-38592：打开成功（文件存在）⇒ 读入失败 ⇒ 2（不是 1）');

  const missing = await runOp(e, 0x1af, [gInt(0x10), im(4), im(1)]);
  assert.equal(missing(1), 1, '文件不存在 ⇒ CreateFileA 失败 ⇒ 1（raw 38571-38572）');
});

test('★T-0159 0x1AF：非 BMP 且不是旧版自造块 ⇒ 2；旧版 AMYTH1 块仍读得回（0）', async () => {
  const payload = new TextEncoder().encode('AMYTH1\n{"slot":5}');
  const legacy = new Uint8Array(4 + payload.length);
  new DataView(legacy.buffer).setUint32(0, payload.length, true);
  legacy.set(payload, 4);
  const other = new TextEncoder().encode('NOTABMP\n{}');
  const notOurs = new Uint8Array(4 + other.length);
  new DataView(notOurs.buffer).setUint32(0, other.length, true);
  notOurs.set(other, 4);

  const written: number[] = [];
  const native = new StubNative(() => {}) as unknown as NativeBridge & { setSlotPixels: (s: number) => void };
  native.setSlotPixels = (s: number) => void written.push(s);
  const store: SlotStore = { slots: new Map(), thumbs: new Map([[5, legacy], [6, notOurs]]) };
  const e = mkEngine([instr(0x1a7, [])], 'TEST.BIN', native);
  e.fileSource = slotFs(store);

  const ours = await runOp(e, 0x1af, [gInt(0x10), im(5), im(1)]);
  assert.equal(ours(1), 0, '★旧版自造块（本工程 T-0018 时期写的槽）仍算读到了 —— 读侧的历史容忍');
  assert.deepEqual(written, [], '旧块不是 BMP ⇒ 不往纹理槽写像素');

  const bad = await runOp(e, 0x1af, [gInt(0x10), im(6), im(1)]);
  assert.equal(bad(1), 2, '★认不出的内容 ⇒ 2（引擎 `sub_43E9F0` 校验 `BM` 失败那条）');
});

// ---------------------------------------------------------------------------
// 0x1AC：两次独立复制（.DAT 失败不影响 .STH）
// ---------------------------------------------------------------------------

test('★T-0159 0x1AC：.DAT/.STH 是两次独立调用 —— 只 .STH 成功 ⇒ 1；只 .DAT 成功 ⇒ 2；都失败 ⇒ 2', async () => {
  const copyFs = (dat: boolean, sth: boolean): FileSource =>
    ({
      readFile: async () => new Uint8Array(0),
      readScript: async () => null,
      copySaveSlot: async () => ({ dat, sth }),
    }) as unknown as FileSource;

  const e = mkEngine([instr(0x1a7, [])]);
  const cases: [boolean, boolean, number][] = [
    [true, true, 0],
    [false, true, 1], // ★"源槽只有 .STH" ⇒ .DAT 那次失败 ⇒ 1（.STH 那次成功不改码）
    [true, false, 2],
    [false, false, 2], // `.STH` 的失败码覆盖 `.DAT` 的（raw 38510-38511）
  ];
  for (const [dat, sth, want] of cases) {
    e.fileSource = copyFs(dat, sth);
    const read = await runOp(e, 0x1ac, [gInt(0x10), im(1), im(2)]);
    assert.equal(read(1), want, `copySaveSlot = {dat:${dat}, sth:${sth}} ⇒ op1 = ${want}（引擎 raw 38504-38511）`);
  }
});

// ---------------------------------------------------------------------------
// 操作数触碰：8 条都"先读 op2/op3，再判宿主能力"
// ---------------------------------------------------------------------------

test('★T-0159 存档槽族 8 条：宿主没有槽能力时也必须**先读** op2/op3（先读后判）', async () => {
  const cases: [number, number][] = [
    [0x19e, 2],
    [0x19f, 2],
    [0x1a0, 2],
    [0x1a1, 2],
    [0x1ab, 2],
    [0x1ac, 3],
    [0x1ae, 3],
    [0x1af, 3],
  ];
  for (const [op, argc] of cases) {
    const e = mkEngine([instr(0x1a7, [])]);
    e.fileSource = bareFs(); // 没有 readSaveSlot/writeSaveSlot/... ⇒ 各 handler 在读到 op2/op3 之后提前返回
    const { args, hits } = trackArgs(
      Array.from({ length: argc }, (_, i) => (i === 0 ? gInt(0x10) : im(i))),
    );
    const h = OPS.get(op);
    assert.ok(h, `0x${op.toString(16)} 应在 OPS 里`);
    await h!(makeCtx(e, e.curScript(), instr(op, args), e.native, () => {}));
    const touched = hits();
    assert.ok(
      touched.includes(2),
      `★0x${op.toString(16)}：op2 必须被读（引擎 raw 38303/38383/38530 先取槽号再建文件名）` +
        ` ⇒ ALLOW_UNDERRUN 的理由是"早退在写侧"，不是"没读操作数"；实际 ${JSON.stringify(touched)}`,
    );
    if (argc === 3) {
      assert.ok(touched.includes(3), `★0x${op.toString(16)}：op3 也必须被读；实际 ${JSON.stringify(touched)}`);
    }
  }
});

// `loadSlotIntoEngine` 与 `0x19F` 共用同一处码域实现（`0x1A1` 的返回值被调度器丢弃 ⇒ 只有这里能直测）。
test('★T-0159 loadSlotIntoEngine：坏头 + a4 ∈ {2,3} ⇒ code = -1（与 0x19F 同一处实现）', async () => {
  const e = mkEngine([instr(0x1a7, [])]);
  e.fileSource = slotFs({ slots: new Map([[11, badHead()]]), thumbs: new Map() });
  e.config = setCfg('SaveVersion1=2');
  const r = await loadSlotIntoEngine(e, 11, { full: false });
  assert.equal(r.code, -1, '★引擎唯一的 -1 出口（raw 19411-19412）');
  assert.equal(r.transferredTo, null, 'a6 = 0 不转移');
});
