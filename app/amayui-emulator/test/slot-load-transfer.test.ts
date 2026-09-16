/**
 * **读档 = 控制转移**（`tickets/T-0056`）—— 用户实测：存档界面点一个槽 → 确认「要读取吗」→
 * 立刻 `[error] Depth が不正です 51 != 54`（控制面版没显示，只能翻日志）。
 *
 * 根因（raw 逐行核对）：
 *  1. `SAVE.txt:219` 登记 `mouse-callback 10 label_00001104`（owner = 51 SAVE.BIN）；
 *  2. 确认框走 `call-script 36` → `SBUNKI.txt:118` 又登记一次 `mouse-callback`（owner = **54 SBUNKI**）；
 *  3. SBUNKI `exit` 后回到 SAVE.BIN，**它不会重新登记**（对比：**存档**路径 `SAVE.txt:1153` 显式
 *     `mov (local-int e) 4` 让主循环重登记；**读档**路径 `label_000039cc` 直接 `ret`）；
 *  4. SAVE.BIN 主循环再调 `get-input-type`(0xCD) ⇒ 守卫比对 `54 != 51` ⇒ 抛。
 *
 * 引擎里第 4 步**不可达**：`0x1A1`（`sub_410160` 的 a6=1 段，raw 19464-19476）在装载完之后
 * `Engine[383120] = 1` + **`cur = 0`** + 装载存档记录的脚本 ⇒ **调用方脚本被放弃**。
 * emulator 此前把它当普通"恢复两张表"，于是调用方接着跑 ⇒ 撞上守卫。
 *
 * 本守卫锁两件事：
 *  - **真游戏（引擎格式）槽**：读档后 `cur` 切到根帧、根脚本被重载、ip 落到根脚本起点，
 *    且**调用方帧不再前进** ⇒ 那一枪打不出来（下面用"接着跑帧循环不抛"钉死）；
 *  - **本工程格式（能直接续档）**：不转移（既有口径不变）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Engine, type Frame } from '../src/vm/engine.js';
import { OPS, loadScriptIntoFrame } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import { StubNative } from '../src/vm/native.js';
import { parseScriptBytes, type BinArg, type BinInstruction, type ScriptBinary } from '../src/script/bin.js';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { resolveSystemPaths } from '../src/arch/systemPaths.js';
import { resolveResourceDir } from '../src/arch/resourceDir.js';
import { LOAD_IN_PROGRESS_FLAG } from '../src/vm/handlers/save-slot.js';
import { runFrameLoop } from '../src/frame/loop.js';
import type { FrameHost } from '../src/frame/host.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

const im = (v: number): BinArg => ({ type: 0, raw: v }) as unknown as BinArg;
const loc = (slot: number): BinArg => ({ type: 0x9, raw: slot }) as unknown as BinArg;

/** 造一份合成脚本二进制（`index` 按真实步长；`dwordToInstr` 必须建，`ret` 要用）。 */
function mkScriptBinary(ops: { op: number; args: BinArg[] }[]): ScriptBinary {
  const instructions: BinInstruction[] = [];
  let dword = 0;
  for (const o of ops) {
    instructions.push({
      opcode: o.op,
      name: `i${o.op.toString(16)}`,
      argc: o.args.length,
      args: o.args,
      byteOffset: 0,
      index: dword,
    } as unknown as BinInstruction);
    dword += 1 + 2 * o.args.length;
  }
  const dwordToInstr: number[] = [];
  instructions.forEach((ins, i) => {
    for (let d = 0; d < 1 + 2 * ins.argc; d++) dwordToInstr[ins.index + d] = i;
  });
  return {
    signature: 'SYS0000',
    isVer5: false,
    headerLen: 0,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [],
    instructions,
    labelTargets: new Set<number>(),
    dwordToInstr,
    raw: new Uint8Array(0),
  };
}

/** 本机第一个真游戏槽（`SAVE??.DAT`）；找不到 ⇒ 跳过（不假装通过）。 */
function firstRealSlot(dir: string): number | null {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const slots = names
    .map((f) => /^SAVE(\d\d)\.DAT$/.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
  return slots.length > 0 ? slots[0]! : null;
}

/** "SAVE.BIN 形状"的调用方帧：`0x1A1 读档` 之后紧跟 `0xCD get-input-type`（= 会撞守卫的那条）。 */
function callerOps(slot: number): { op: number; args: BinArg[] }[] {
  return [
    { op: 0x1a1, args: [loc(0x10), im(slot)] },
    { op: 0xcd, args: [] },
    { op: 0x5, args: [] },
  ];
}

/** 把调用方脚本放进帧 `frameIdx`（真实运行时 SAVE.BIN 也在非 0 帧里），并把它设为当前帧。 */
function putCaller(e: Engine, frameIdx: number, scriptId: number, ops: { op: number; args: BinArg[] }[]): Frame {
  const f = e.frames[frameIdx]!;
  loadScriptIntoFrame(f, mkScriptBinary(ops), 'CALLER.BIN', scriptId);
  e.cur = frameIdx;
  return f;
}

test('★E3：读真游戏槽 ⇒ 控制转移到根脚本（`cur=0` + 重载），调用方帧不再前进（那一枪打不出来）', async (t) => {
  const system = resolveSystemPaths(REPO);
  const src = new NodeFileSource({ resourceDir: resolveResourceDir(REPO), system });
  const slotDir = path.join(system.baseDir, 'SAVE');
  const slot = firstRealSlot(slotDir);
  if (slot === null) {
    t.skip(`本机没有真存档槽（${slotDir}）`);
    return;
  }

  const native = new StubNative(() => {});
  const e = new Engine(native);
  e.fileSource = src;
  // SAVE.DAT 的「已初始化」标志（`SYSTEM4.txt:71` 的 `load-int (global 5)`）—— 读真槽**不得**把它洗掉。
  const FLAG_KEY = '\x0300000005';
  e.applySaveDataTables({ ints: new Map([[FLAG_KEY, 1]]), strings: new Map() });
  // 调用方 = SAVE.BIN(51) 在帧 2；它带着"上一个子脚本（SBUNKI, id 54）留下的鼠标回调身份"。
  const caller = putCaller(e, 2, 51, callerOps(slot));
  e.input.mouseJump = 623; // = SBUNKI.txt:118 的 label（dword 0x26f）
  e.input.mouseJumpOwner = 54; // = SBUNKI.BIN 的统一 id
  caller.locals.int.set(0x210, 0); // 无关局部量，仅让调用方帧"有内容"
  assert.equal(e.curScript().scriptId, 51, '调用方 = SAVE.BIN(51)');

  // 第一条指令：`0x1A1` 读档（走 0x1A1 的 handler ⇒ 含控制转移）。
  const instr0 = caller.script!.instructions[0]!;
  await OPS.get(0x1a1)!(makeCtx(e, caller, instr0, e.native, () => {}));

  // ★控制转移：cur 切到帧 0、根脚本（SYSTEM4）被重载、从它的开头继续。
  assert.equal(e.cur, 0, '★读档后 cur = 0（引擎 `Engine[383104] = 0`，raw 19471）');
  assert.equal(e.curScript().ip, 0, '从根脚本开头继续');
  assert.match(e.curScript().name, /^SYSTEM4\.BIN$/, `帧 0 应是重载的根脚本（实际 ${e.curScript().name}）`);
  assert.equal(e.engineValues.get(LOAD_IN_PROGRESS_FLAG), 1, '置「正在读档」门（raw 19470；`0xAE` 读它）');
  assert.equal(caller.ip, 0, '★调用方帧的 ip 不前进（它后面的 0xCD 不会被派发）');
  assert.equal(caller.scriptId, 51, '调用方帧原样留着（引擎也不清帧）');
  // ★真游戏槽的两张表**未解析**（`SLOT_GAPS`）⇒ 不得拿空表覆盖现有的 SAVE.DAT 表。
  assert.equal(e.saveDataTables().ints.get(FLAG_KEY), 1, '现有 SAVE.DAT 表（含「已初始化」标志）必须保住');

  // ★真·回归断言：继续跑帧循环（真资源根 ⇒ SYSTEM4 的启动链），**不得抛出那条守卫错误**。
  let clock = 0;
  const host: FrameHost = { now: () => clock };
  const trail: string[] = [e.curScript().name];
  const r = await runFrameLoop(e, host, {
    gates: { anim: 'clear', sleep: 'ignore', advance: 'ignore' },
    services: { winReveal: false, charGrid: false },
    advFrame: false,
    maxStepsPerFrame: 5000,
    maxFrames: 400,
    present: 'never',
    audio: 'never',
    onScriptChange: (name) => {
      if (trail[trail.length - 1] !== name) trail.push(name);
    },
    onFrameEnd: () => {
      clock += 1000 / 60;
    },
  });
  assert.notEqual(r.stopReason, 'error', '读档后的启动链不得报错（修前这里就是 Depth が不正です）');
  assert.ok(
    trail.some((n) => n.startsWith('SYSTEM4')) && !trail.includes('CALLER.BIN'),
    `启动链应从根脚本重新走（轨迹 ${trail.slice(0, 6).join(' → ')}）`,
  );
});

test('★边界：本工程格式（带状态块）仍直接续档，不转移', async () => {
  const { buildSlotFile } = await import('../src/vm/saveSlot.js');
  const native = new StubNative(() => {});
  const e = new Engine(native);
  const caller = putCaller(e, 2, 51, [{ op: 0x1a1, args: [loc(0x10), im(3)] }]);
  // 写一个**本工程格式**的槽（带状态块：cur=0 + 一帧），只经内存 FileSource 交付。
  const bytes = buildSlotFile({
    tables: { ints: new Map(), strings: new Map() },
    usedFileIds: [],
    state: {
      key: 0,
      cur: 0,
      frames: [{ scriptId: 51, name: 'CALLER.BIN', ip: 0, retStack: [] }],
      globals: { int: [], float: [], str: [] },
      playSeconds: 7,
    },
  });
  e.fileSource = {
    readSaveSlot: async (s: number) => (s === 3 ? bytes : null),
  } as unknown as Engine['fileSource'];
  const instr0 = caller.script!.instructions[0]!;
  await OPS.get(0x1a1)!(makeCtx(e, caller, instr0, e.native, () => {}));
  assert.equal(e.cur, 0, '本工程格式：cur 取自状态块');
  assert.equal(e.engineValues.get(LOAD_IN_PROGRESS_FLAG), undefined, '不置「正在读档」门 ⇒ 没转移');
  assert.equal(e.playSeconds, 7, '状态块的游玩秒数被还原（= 走了续档那条路）');
  assert.equal(e.curScript().name, 'CALLER.BIN', '调用方会话继续（不重载根脚本）');
});

test('★E3：真语料 —— SAVE.BIN 的读档路径**不**重登记鼠标回调，存档路径**重登记**（脚本侧口径棘轮）', () => {
  const saveTxt = fs.readFileSync(path.join(REPO, 'src', 'SAVE.txt'), 'utf8');
  const sbunkiTxt = fs.readFileSync(path.join(REPO, 'src', 'SBUNKI.txt'), 'utf8');
  // 读档 YES 分支：`call label_0000706c`（阶梯动画）→ … → `i1a1`（读档）→ `ret`，中间没有 `(local-int e) 4`。
  assert.match(
    saveTxt,
    /i1a1 \(local-int 12\) \(local-int 214\)\nret/,
    '读档分支以 `i1a1` + `ret` 收尾（依赖引擎的控制转移）',
  );
  // 存档分支：`mov (local-int e) 4` + `ret`（显式让主循环重新登记回调）。
  assert.match(saveTxt, /mov \(local-int e\) 4\nret/, '存档分支必须 `e = 4` + `ret`');
  assert.match(sbunkiTxt, /mouse-callback 10 label_000009f8/, 'SBUNKI 自己会登记鼠标回调（owner 被它改写）');
});
