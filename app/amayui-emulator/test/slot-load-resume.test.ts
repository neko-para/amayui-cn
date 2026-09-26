/** @tier T1 @kind core @subsystem save */

/**
 * **真游戏槽的读档续跑（VM 层）**（`tickets/T-0059`）—— `0x1A1` + `0xAE` 的实际行为。
 *
 * 这条链路此前只做到"控制转移 + 重载根脚本"（`tickets/T-0056`），**续不到存档当时的场景**。
 * 现在按引擎口径补齐（`sub_410160` 的 a4=3 段 + 脚本侧 `sub_4192F0`）：
 *
 * ```text
 * 0x1A1（读档）: 解状态主体 → 还原三个池 + 逐帧记录 → cur = 0 → 帧 0 ← 记录 0 的脚本（入口 ip=0）
 *                → `Engine[95780] = 1`（「正在读档」门）
 * i0ae（在每一帧入口）: 按记录重算**本帧** ip（`0x3` call-script 表优先、否则 `0x71` 消息表）
 *                → cur < savedCur ⇒ `sub_40F750(3)`：把记录[cur+1] 的脚本装进帧 cur+1 并切过去
 *                → cur == savedCur ⇒ 收尾（`95777 = savedRet`、`95780 = 0`）
 * ```
 *
 * 断言分两层：
 *  - **合成槽**（确定性，任何机器都跑）：造两个可控脚本（根帧停在 call-script、存档帧停在消息），
 *    逐条断言池还原、帧记录还原、两步走栈、收尾值；
 *  - **E3 真槽**（本机有存档才跑）：用真 `SAVE00.DAT` 装载，断言帧 0 = SYSTEM4.BIN 且**第一步走栈**
 *    真的把存档帧脚本（如 SC1560.BIN）装进帧 1（这就是"续到存档当时"的判据）。
 */
import { test } from 'node:test';
import { firstRealFile, readReal, realSlotDirs, slotNumberOf } from './realSlots.js';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Engine } from '../src/vm/engine.js';
import { OPS } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import { StubNative } from '../src/vm/native.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { parseIni } from '../src/engineConfig.js';
import { decodeEngineSlot } from '../src/vm/engineSlot.js';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { resolveResourceDir } from '../src/arch/resourceDir.js';
import { resolveSystemPaths } from '../src/arch/systemPaths.js';
import { runFrameLoop } from '../src/frame/loop.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import type { FrameHost } from '../src/frame/host.js';
import { SEEDS, buildBody, buildScriptBin, buildSlotFile } from './engineSlotFixtures.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

const SAVE_VERSION_INI = '[set]\nSaveVersion1 = 3\nSaveVersion2 = 20\n';

/** 造一个引擎：配置里带 `set:SaveVersion1/2`（`0xAE` 按它选帧记录槽位组）。 */
function mkEngine(): Engine {
  const e = new Engine(new StubNative(() => {}));
  e.config = parseIni(SAVE_VERSION_INI);
  return e;
}

/** 只提供"读槽 / 读脚本"两个能力的内存 FileSource。 */
function fakeFileSource(slotBytes: Uint8Array, scripts: Map<number, { name: string; data: Uint8Array }>): Engine['fileSource'] {
  return {
    readSaveSlot: async (s: number) => (s === 0 ? slotBytes : null),
    readScript: async (id: number) => {
      const s = scripts.get(id);
      return s ? { index: id, name: s.name, data: s.data } : null;
    },
  } as unknown as Engine['fileSource'];
}

/** 跑一条指令（用 `frame` 作为当前帧）。 */
async function run(e: Engine, frameIndex: number, ip: number): Promise<void> {
  const frame = e.frames[frameIndex]!;
  const instr = frame.script!.instructions[ip]!;
  await OPS.get(instr.opcode)!(makeCtx(e, frame, instr, e.native, () => {}));
}

test('★续跑装载：池 + 帧记录 + 帧 0（记录 0 的脚本）+ 读档门；调用方脚本被放弃', async () => {
  // 根脚本：入口 i0ae，然后一条 call-script（0x3 表[0] = 2）—— 真脚本（SYSTEM4/ADV）也是这个形状。
  const rootBin = buildScriptBin([
    { op: 0xae, args: [] }, //                                   dword 0
    { op: 0x03, args: [{ type: 0, raw: 101 }] }, //               dword 1..3（0x3 表[0] = 1）
    { op: 0x71, args: [{ type: 0, raw: 1 }] }, //                 dword 4..6（0x71 表[0] = 4）
  ]);
  // 存档帧脚本：入口 i0ae，然后一条显示消息（0x71 表[0] = 1）—— 续跑要落在这条上。
  const gameBin = buildScriptBin([
    { op: 0xae, args: [] }, //                                    dword 0
    { op: 0x71, args: [{ type: 0, raw: 1 }] }, //                 dword 1..3（0x71 表[0] = 1）
    { op: 0x05, args: [] }, //                                    dword 4: ret
    { op: 0x8f, args: [{ type: 0, raw: 0x40 }] }, //              dword 5..7（0x8F 表[0] = 5 ⇒ 返回栈 [8]）
  ]);
  const body = buildBody({
    savedCur: 1,
    savedRet: 77,
    pre8: 6,
    frames: [
      { returnFrame: -1, scriptId: 100, retIdx: [], messageIdx: 0, callIdx: 0 },
      { returnFrame: 0, scriptId: 101, retIdx: [0], messageIdx: 0, callIdx: -1 },
    ],
    ints: [0, 3, 0, 1],
    floats: [2.5],
    strings: ['', 'HELLO'],
    ipTables: [[], [], []],
  });
  const bytes = buildSlotFile(body, { ...SEEDS, playSeconds: 1234 });
  const scripts = new Map([
    [100, { name: 'ROOT.BIN', data: rootBin }],
    [101, { name: 'GAME.BIN', data: gameBin }],
  ]);

  const e = mkEngine();
  e.fileSource = fakeFileSource(bytes, scripts);
  // 调用方（模拟 SAVE.BIN，id 51）在帧 2：读档后它必须被放弃（`cur` 切到 0，ip 不前进）。
  e.frames[2]!.script = null;
  e.frames[2]!.ip = 0;

  // ---- ① 0x1A1 读档（handler 自己会把控制转到帧 0 的入口） ----
  const callerScript = buildScriptBin([{ op: 0x1a1, args: [{ type: 0x9, raw: 0x10 }, { type: 0, raw: 0 }] }]);
  const { parseScriptBytes } = await import('../src/script/bin.js');
  const { loadScriptIntoFrame } = await import('../src/vm/ops.js');
  loadScriptIntoFrame(e.frames[2]!, parseScriptBytes(callerScript), 'SAVE.BIN', 51);
  e.cur = 2;
  const callerIp = e.frames[2]!.ip;
  await run(e, 2, 0);

  assert.equal(e.cur, 0, '★cur 切到帧 0（引擎 `Engine[383104] = 0`）');
  assert.equal(e.curScript().name, 'ROOT.BIN', '帧 0 = 记录 0 的脚本（不是硬编码的根脚本 0）');
  assert.equal(e.curScript().ip, 0, '从帧 0 脚本的入口继续（引擎 `95782 = 95781`）');
  assert.equal(e.curScript().caller, -1, '根帧的 returnFrame = -1');
  assert.equal(e.engineValues.get(ENGINE_FIELD.loadInProgress), 1, '置「正在读档」门');
  assert.equal(e.frames[2]!.ip, callerIp, '★调用方帧的 ip 不前进（它被放弃）');
  assert.equal(e.playSeconds, 1234, '头 +280 的游玩秒数接上');

  // 池（文件里是明文）：int 进 `Engine.globals.int` **必须 ENC**（引擎 0x1A1 读完池也整体 ENC 一遍，
  // 读侧一律 DEC ⇒ 存明文会让续跑后所有全局量读成垃圾）；float/string 没有这层。
  const { dec } = await import('../src/vm/bits.js');
  assert.equal(dec(e.key, e.globals.int.get(1) ?? 0), 3, 'int 池[1] = 3（读侧 DEC 还原）');
  assert.equal(dec(e.key, e.globals.int.get(3) ?? 0), 1, 'int 池[3] = 1');
  assert.equal(e.globals.int.get(0), undefined, '零值不装（读侧缺省即 0，省 100 万项 Map）');
  assert.notEqual(e.globals.int.get(1), 3, '★内存里必须是 ENC 态（否则 DEC 一遍会读错）');
  assert.equal(e.globals.float.get(0), 2.5, 'float 池（明文，无 ENC）');
  assert.equal(e.globals.str.get(1), 'HELLO', 'string 池（明文，无 ENC）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.musicField), 6, '镜像[2] → `_this[174713]`');
  assert.ok(e.saveResume, '续跑记录已就绪');
  assert.equal(e.saveResume!.savedCur, 1);
  assert.equal(e.saveResume!.savedRet, 77);
  assert.equal(e.saveResume!.frames.length, 2);

  // ---- ② 帧 0 入口的 i0ae：落 ip（call-script 的下一条）⇒ 装帧 1 并切过去 ----
  await run(e, 0, 0);
  assert.equal(e.frames[0]!.ip, 2, '★根帧停在 call-script（dword 1）⇒ 续到**它的下一条**（指令 2）');
  assert.equal(e.cur, 1, '走栈到帧 1');
  assert.equal(e.frames[1]!.name, 'GAME.BIN', '帧 1 = 记录 1 的脚本');
  assert.equal(e.frames[1]!.scriptId, 101, '脚本 id 取自记录（不是猜的）');
  assert.equal(e.frames[1]!.caller, 0, '帧 1 的返回帧 = 记录里的 0');
  assert.deepEqual(e.frames[1]!.retStack, [8], '返回栈由**表 C 下标 + 3** 换算（0x8F 表[0]=5 ⇒ 8）');
  assert.equal(e.frames[1]!.ip, 0, '新帧从入口开始（ip=0）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.loadInProgress), 1, '还没到存档帧 ⇒ 门仍开着');

  // ---- ③ 帧 1 入口的 i0ae：落到存档消息 ⇒ 收尾 ----
  await run(e, 1, 0);
  assert.equal(e.cur, 1, '存档帧就是当前帧');
  assert.equal(e.frames[1]!.ip, 1, '★续到存档当时的**消息指令**（重放这条消息）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.loadInProgress), 0, '收尾：清「正在读档」门');
  assert.equal(e.engineValues.get(ENGINE_FIELD.callRet), 77, '收尾写回 savedRet');
  assert.equal(e.saveResume, null, '续跑记录消费完即清');
});

test('★真槽续跑不依赖 INI 的 `[set]` 段：`sv1/sv2` 取自**槽文件头**（`tickets/T-0065`）', async () => {
  // 复现：把真存档复制进来后，玩家的 `SYS4REG.INI` 里**根本没有 `[set]` 段**（实测）——
  // 旧写法 `cfgInt(cfg, 'set:SaveVersion1', 0)` 得到 0，而 0 不在 `SAVE_VERSION_BRANCH` 里
  // ⇒ `0xAE` 直接返回 ⇒ 走栈不发生 ⇒ 一路跑回 TITLE（用户实测症状）。
  // 现在 `sv1/sv2` 由 `loadSlotIntoEngine` 从**被读的那份槽自己的容器头**（+284/+288）带进续跑记录。
  const rootBin = buildScriptBin([
    { op: 0xae, args: [] },
    { op: 0x03, args: [{ type: 0, raw: 101 }] },
  ]);
  const gameBin = buildScriptBin([
    { op: 0xae, args: [] },
    { op: 0x71, args: [{ type: 0, raw: 1 }] },
    { op: 0x05, args: [] },
    { op: 0x8f, args: [{ type: 0, raw: 0x40 }] },
  ]);
  const body = buildBody({
    savedCur: 1,
    savedRet: 5,
    pre8: 0,
    frames: [
      { returnFrame: -1, scriptId: 100, retIdx: [], messageIdx: -1, callIdx: 0 },
      { returnFrame: 0, scriptId: 101, retIdx: [0], messageIdx: 0, callIdx: -1 },
    ],
    ints: [],
    floats: [],
    strings: [],
    ipTables: [[], [], []],
  });
  // ★容器头声明 sv1=3 / sv2=20（真槽就是这样：`sub_40CD10` 把 `set:SaveVersion1/2` 写进头）
  const bytes = buildSlotFile(body, { ...SEEDS, format: 3, aux: 20 });
  const scripts = new Map([
    [100, { name: 'ROOT.BIN', data: rootBin }],
    [101, { name: 'GAME.BIN', data: gameBin }],
  ]);

  const e = new Engine(new StubNative(() => {}));
  e.config = parseIni('[display]\nScreenMode=1\n'); // ★刻意**没有** `[set]` 段（= 玩家 INI 的实测形态）
  e.fileSource = fakeFileSource(bytes, scripts);
  const { parseScriptBytes } = await import('../src/script/bin.js');
  const { loadScriptIntoFrame } = await import('../src/vm/ops.js');
  const caller = buildScriptBin([{ op: 0x1a1, args: [{ type: 0x9, raw: 0x10 }, { type: 0, raw: 0 }] }]);
  loadScriptIntoFrame(e.frames[2]!, parseScriptBytes(caller), 'SAVE.BIN', 51);
  e.cur = 2;
  await run(e, 2, 0);

  assert.ok(e.saveResume, '续跑记录已入队');
  assert.equal(e.saveResume!.sv1, 3, '★sv1 取自槽头（不是 INI）');
  assert.equal(e.saveResume!.sv2, 20, '★sv2 取自槽头');
  // 帧 0 入口的 `i0ae`：sv1=3 分支 ⇒ 落 ip + 走栈到帧 1（旧写法在这里什么都不做）
  await run(e, 0, 0);
  assert.equal(e.cur, 1, '★走栈发生了（旧写法：sv1=0 没有分支 ⇒ 卡在帧 0）');
  assert.equal(e.frames[1]!.name, 'GAME.BIN', '帧 1 装上了存档记录里的脚本');
  assert.equal(e.frames[0]!.ip, 2, '帧 0 落在 call-script 的下一条');
});

test('★读档整池清零后写回文件前缀 + 装回「槽 → 图像」表（`tickets/T-0071` / 订正 `T-0187`）', async () => {
  // 两条引擎口径（`sub_410160` raw 19705/19747 与 19843-19910）：
  //  ① int 池的还原是 `memset(pool, 0, 4*Engine[382952] + 4)` + `memcpy(pool, fileInts, 4*count)`
  //     —— ★**按池容量清零，再写回文件前缀**。旧注释（`T-0071`）写的「只覆盖池内下标/不得清掉池外下标」
  //     其前提「memset 只动 `0..count`」**已在 2026-09-27 被真机只读实测推翻**（`tickets/T-0187/recheck.md` §5.10）：
  //     真机 `Engine+382952` = 0x00708ADC = 7,375,836 ≫ SAVE78 的 int count = 1,015,792
  //     ⇒ `[count, capacity)` 装载后为 0 ⇒ 两个入口（TITLE / ADV）之间不残留状态。
  //     ADV 用到的 `global 708ada`(7,375,578)/`f8c48`(1,018,952) 在池内 ⇒ 同样清零，
  //     必须由**装载路径重新派生**（引擎做法：`CALLBACK_LOAD`/`SETCHARM`/`set-texture`…）。
  //  ② 1000 条 20 B 的**图像槽表**要装回 `Engine.texSlots`（= `0x1F9` `set-texture` 写的那张表），
  //     并且 `flag == 1 && id >= 0` 的条目要**重新解码**（宿主 `bindTexture`）—— 读档续跑跳过了场景 init，
  //     那些 `set-texture <背景大图> <槽>` 不会再执行（实测槽 79：槽 4 ← `BG050ABL.AGF`）。
  const rootBin = buildScriptBin([{ op: 0xae, args: [] }]);
  const scriptId = 100;
  const body = buildBody({
    savedCur: 0,
    savedRet: -1,
    pre8: 0,
    frames: [{ returnFrame: -1, scriptId, retIdx: [], messageIdx: -1, callIdx: -1 }],
    ints: [0, 7], // 池长 2：下标 0..1
    floats: [],
    strings: [],
    ipTables: [[], [], []],
    // 100 个纹理槽里只有 3 号槽标了"要重载"
    images: [{ at: 3, id: 0x999, flag: 1, param: 0 }],
    // 1000 个图像槽：4 号标了重载、12 号没标（只登记不重载）
    records: [
      { at: 4, id: 0x888, flag: 1, param: 0 },
      { at: 12, id: 0x777, flag: 0, param: 0 },
      { at: 20, id: -1, flag: 1, param: 0 },
    ],
  });
  const bytes = buildSlotFile(body, { ...SEEDS, format: 3, aux: 20 });

  const logs: string[] = [];
  const native = new StubNative((m) => logs.push(m));
  const bound: [number, number][] = [];
  (native as unknown as { bindTexture: (id: number, slot: number) => void }).bindTexture = (id, slot) =>
    bound.push([id, slot]);
  const e = new Engine(native);
  // 只提供"读槽 3 / 读脚本"两个能力（`fakeFileSource` 只认槽 0，这里要读槽 3）。
  e.fileSource = {
    readSaveSlot: async (s: number) => (s === 3 ? bytes : null),
    readScript: async (id: number) => (id === scriptId ? { index: id, name: 'ROOT.BIN', data: rootBin } : null),
  } as unknown as Engine['fileSource'];
  // 读档前的"当前进程状态"：池外下标（200 万）必须有值、池内下标 0 也要有旧值 —— 装载后**两者都应为 0**
  // （引擎按池容量 memset ⇒ 与文件 count 无关；`T-0187` 订正）。
  const { enc } = await import('../src/vm/bits.js');
  e.globals.int.set(2_000_000, enc(e.key, 424242));
  e.globals.int.set(0, enc(e.key, 1234));
  // ★`tickets/T-0187` ③：Font 的**场景态**同样必须由控制转移复位（值 = `Engine.resetFontSceneState()` 的
  //   raw 锚点：`sub_40DF10` raw 18025 的 `sub_465390` ⇒ 78891-78894/78951、raw 18077 清 `Font+1392`）。
  //   这里摆成"上一场戏留下的值"：`followTextMode=1`（= 序章链跑过 `src/NOVEL.txt:8 i1b1 1`）、阿瓦罗黄、描边 3 向。
  e.engineValues.set(ENGINE_FIELD.followTextMode, 1);
  e.engineValues.set(ENGINE_FIELD.colorFill, 0xffe100);
  e.engineValues.set(ENGINE_FIELD.outlineMode, 3);

  const { parseScriptBytes } = await import('../src/script/bin.js');
  const { loadScriptIntoFrame } = await import('../src/vm/ops.js');
  const caller = buildScriptBin([{ op: 0x1a1, args: [{ type: 9, raw: 0x10 }, { type: 0, raw: 3 }] }]);
  loadScriptIntoFrame(e.frames[2]!, parseScriptBytes(caller), 'SAVE.BIN', 51);
  e.cur = 2;
  await run(e, 2, 0);

  const { dec } = await import('../src/vm/bits.js');
  assert.equal(
    e.globals.int.get(2_000_000),
    undefined,
    '★装载按**池容量** memset 整池清零 ⇒ 池外下标（> 文件 count）也必须读成 0（2026-09-27 订正，见 T-0187/recheck.md §5.10）',
  );
  assert.equal(e.globals.int.get(0), undefined, '池内下标 0 被文件里的 0 覆盖（引擎的 memset 段）');
  assert.equal(dec(e.key, e.globals.int.get(1) ?? 0), 7, '池内下标 1 = 文件里的值');

  assert.equal(e.texSlots.get(4), 0x888, '★图像槽 4 ← 存档里的 id');
  assert.equal(e.texSlots.get(12), 0x777, '图像槽 12 也登记（flag = 0 ⇒ 不重载）');
  assert.equal(e.texSlots.get(20), undefined, 'id < 0 的空槽不登记');
  assert.deepEqual(
    bound.sort((a, b) => a[1] - b[1]),
    [
      [0x999, 3],
      [0x888, 4],
    ],
    '★只有标了 flag == 1 的槽（纹理槽 3、图像槽 4）走宿主重新解码',
  );
  assert.ok(
    logs.some((m) => m.includes('重建存档里的图像槽 1 个 + 纹理槽 1 个')),
    `要有"重建图像槽"的日志（实际 ${logs.filter((m) => m.includes('slot-load')).join(' | ')}）`,
  );
  // ★(A) 步（`tickets/T-0083`）：装载点必须**释放留帧** —— 引擎装载路径复位显示态（`sub_403EF0` raw 19913-19915），
  //   没有"保留旧像素"的概念 ⇒ 读档瞬间屏上应是当前模型，不能是上一屏（TITLE/菜单）的旧像素。
  assert.ok(
    logs.some((m) => m.includes('releaseFrameHold')),
    `装载点必须调用 releaseFrameHold（实际 ${logs.filter((m) => m.includes('frame-hold') || m.includes('releaseFrameHold')).join(' | ') || '（无）'}）`,
  );
  // ★`tickets/T-0187` ③：控制转移 = 回到根帧重新进场景 ⇒ Font 的**场景态**回引擎初值。
  //   ★判据（用户 2026-09-27 口径「读档总是能正确恢复表现」+ 实测）：不复位 ⇒ 先读序章档再读章节档时
  //   `Font+1392` 留 1 ⇒ `0x73` 的 ▼ 走「跟随笔位」分支算到屏外；复位后由重跑的脚本入口按场景重新设定
  //   （序章链 `src/NOVEL.txt:8 i1b1 1`；章节链 `SYSTEM4 > SC0000` 不设 ⇒ 保持 0 = ADV 窗固定位）。
  assert.equal(
    e.engineValues.get(ENGINE_FIELD.followTextMode),
    0,
    '★读档必须把 `Font+1392` 归 0（raw 18077 的整块复位那一半；不复位 ⇒ ▼ 被上一场戏的 `i1b1 1` 带到屏外）',
  );
  assert.equal(e.engineValues.get(ENGINE_FIELD.colorFill), 0xffffff, '`Font+1360` 回白（raw 78891）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.outlineMode), 1, '`Font+1372` 回 1（raw 78894）');
});

test('0xAE 的门关着 ⇒ 不动任何帧状态（与引擎的门控路径逐字一致）', async () => {
  const e = mkEngine();
  const frame = e.frames[0]!;
  const bin = buildScriptBin([
    { op: 0xae, args: [] },
    { op: 0x71, args: [{ type: 0, raw: 1 }] },
  ]);
  const { parseScriptBytes } = await import('../src/script/bin.js');
  const { loadScriptIntoFrame } = await import('../src/vm/ops.js');
  loadScriptIntoFrame(frame, parseScriptBytes(bin), 'ROOT.BIN', 0);
  frame.ip = 1; // 假装正跑在消息那条上
  e.engineValues.set(ENGINE_FIELD.loadInProgress, 0);
  e.saveResume = { savedCur: 1, savedRet: 9, frames: [] };
  await run(e, 0, 0); // i0ae（门关着）
  assert.equal(frame.ip, 1, 'ip 不变');
  assert.equal(e.cur, 0, 'cur 不变');
  assert.ok(e.saveResume, '记录原样留着（引擎同样直接返回）');
});

test('★E3：真 SAVE00.DAT ⇒ 帧 0 = SYSTEM4.BIN，且第一步走栈真的装上存档帧的脚本', async (t) => {
  const system = resolveSystemPaths(REPO);
  // ★`tickets/T-0128`：两侧都看（base + overlay）
  const slot = firstRealFile(REPO, 'DAT');
  if (!slot) {
    t.skip(`本机没有真存档槽（${realSlotDirs(REPO).join(' / ')}）`);
    return;
  }
  const slotNo = slotNumberOf(slot.name); // ★`0x1A1` 的 op2 = **槽号**（本机 78/79，不是 0）
  const bytes = readReal(slot);
  const dec = decodeEngineSlot(bytes);
  assert.ok(dec.ok, `真槽必须解出（${dec.ok ? '' : dec.reason}）`);
  if (!dec.ok) return;
  const payload = dec.payload;
  const savedScriptId = payload.frames[payload.savedCur]!.scriptId;

  const src = new NodeFileSource({ resourceDir: resolveResourceDir(REPO), system });
  const e = mkEngine();
  e.fileSource = src;
  const { parseScriptBytes } = await import('../src/script/bin.js');
  const { loadScriptIntoFrame } = await import('../src/vm/ops.js');
  const callerBin = buildScriptBin([{ op: 0x1a1, args: [{ type: 0x9, raw: 0x10 }, { type: 0, raw: slotNo }] }]);
  loadScriptIntoFrame(e.frames[1]!, parseScriptBytes(callerBin), 'SAVE.BIN', 51);
  e.cur = 1;
  await run(e, 1, 0);

  assert.equal(e.cur, 0, '读档后 cur = 0');
  // ★引擎的**第一步**不是装记录 0，而是把帧 0 交给 `CALLBACK_LOAD.BIN`（`sub_410160` raw 19916-19918，
  //   返回帧 = **-11** 哨兵）；它 `exit` 时 `sub_41A820` 见 -11 才 `sub_40F750` 装记录 0（`tickets/T-0072`）。
  //   那一跳做的是"上一个画面的收尾"：ADV 退出(`i19b`)、渲染目标回后台缓冲(`i20d -1`)、
  //   释放 2000 个句柄(`detach-texture 110000 2000`)、SE/语音通道复位、`global 3f36 = 0`…
  //   ⇒ 少了它，续跑就带着上一场的 ADV/消息窗状态（实测：ADV 文字落进 1 号窗而不是 8 号窗）。
  assert.match(e.curScript().name, /^CALLBACK_LOAD\.BIN$/, `帧 0 应是读档回调（实际 ${e.curScript().name}）`);
  assert.equal(e.frames[0]!.caller, -11, '★返回帧 = -11 哨兵（`sub_41A820` 那条分支的入口条件）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.loadInProgress), 1, '读档门置位');
  assert.ok(e.saveResume, '续跑记录就绪');
  assert.ok(e.saveResume!.pendingRecord0, '★回调还没跑 ⇒ "exit 时装记录 0"的标志挂着');
  assert.equal(e.saveResume!.savedCur, payload.savedCur);

  // ---- 跑回调到它 `exit`：-11 分支把记录 0 的脚本装进帧 0（等价于引擎 CALLBACK_LOAD 那一跳收尾）----
  {
    let clock0 = 0;
    const host0: FrameHost = { now: () => clock0 };
    await runFrameLoop(e, host0, {
      gates: { anim: 'clear', sleep: 'ignore', advance: 'ignore' },
      advFrame: false,
      maxStepsPerFrame: 20000,
      maxFrames: 10,
      present: 'never',
      audio: 'never',
      // ★用**逐条**停止条件：回调 exit 那一刻就把记录 0 的脚本装进帧 0 并 jump(0)，
      //   帧边界判会太迟（SYSTEM4 会在同一帧里继续跑完启动链）。
      stopAfterStep: () => e.curScript().name.startsWith('SYSTEM4'),
      onUnknown: () => 'continue',
      onFrameEnd: () => {
        clock0 += 1000 / 60;
      },
    });
  }
  assert.match(e.curScript().name, /^SYSTEM4\.BIN$/, `回调收尾后帧 0 = 记录 0 的脚本（实际 ${e.curScript().name}）`);
  assert.equal(e.frames[0]!.caller, -1, '引擎此处 `_this[95777] = -1` ⇒ 帧 0 的返回帧归 -1');
  assert.equal(e.saveResume!.pendingRecord0, false, '标志消费掉');

  // 真脚本里找入口的 i0ae（`SYSTEM4.txt:143`）并执行它 ⇒ 走栈第一步。
  const root = e.frames[0]!.script!;
  const aeIdx = root.instructions.findIndex((i) => i.opcode === 0xae);
  assert.ok(aeIdx >= 0, 'SYSTEM4.BIN 里应有 i0ae（真语料 143 行）');
  await run(e, 0, aeIdx);
  if (payload.savedCur > 0) {
    assert.equal(e.cur, 1, '★走栈到帧 1（存档帧的调用方）');
    assert.equal(e.frames[1]!.scriptId, payload.frames[1]!.scriptId, '★帧 1 装的是**存档记录里的脚本**');
    assert.equal(e.frames[1]!.ip, 0, '新帧从入口开始');
    const sb = await src.readScript(payload.frames[1]!.scriptId);
    assert.equal(e.frames[1]!.name, sb?.name, `帧 1 脚本名应与文件 id 对应（${sb?.name}）`);
    assert.notEqual(e.frames[1]!.scriptId, 51, '不是调用方脚本（续跑成功，而不是回到读档界面）');
  } else {
    assert.equal(e.engineValues.get(ENGINE_FIELD.loadInProgress), 0, 'savedCur=0 ⇒ 一步收尾');
  }
  void savedScriptId;

  // ---- ④ ★端到端（E4）：读档后**继续跑帧循环**，走栈必须自己走完并真的活在存档帧的脚本里 ----
  // 这一步不手工调 0xAE：帧 0（SYSTEM4）从入口跑到 `label_00000b00` 的 i0ae 时自己开始走栈，
  // 直到 cur == savedCur 收尾 —— 也就是说"玩家点继续"之后游戏真的回到存档当时那个脚本。
  const scene = new HeadlessScene({});
  let clock = 0;
  const host: FrameHost = {
    now: () => clock,
    advanceModel: (t) => scene.advance(t),
    poolPending: () => scene.poolPending(),
  };
  const unknown: string[] = [];
  const trail: string[] = [];
  let last = e.curScript().name;
  trail.push(last);
  /** 走栈期间读档门必须是 1，收尾才变 0 ⇒ 用它当"走完了"的判据（否则一开头就是 0，会立刻退出）。 */
  let sawGate = false;
  const walked = (): boolean => {
    const g = e.engineValues.get(ENGINE_FIELD.loadInProgress) ?? 0;
    if (g === 1) sawGate = true;
    return sawGate && g === 0;
  };
  const r = await runFrameLoop(e, host, {
    gates: { anim: 'clear', sleep: 'ignore', advance: 'ignore' },
    advFrame: false,
    maxStepsPerFrame: 20000,
    maxFrames: 300,
    present: 'never',
    audio: 'never',
    until: walked,
    onUnknown: (err, frame) => {
      unknown.push(`0x${err.opcode.toString(16)}@${frame.name}`);
      return 'continue';
    },
    onScriptChange: (name) => {
      if (name !== last) {
        last = name;
        if (!trail.includes(name)) trail.push(name);
      }
    },
    onFrameEnd: () => {
      clock += 1000 / 60;
    },
  });
  assert.notEqual(r.stopReason, 'error', `续跑后的帧循环不得报错（轨迹尾部 ${trail.slice(-4).join(' → ')}）`);
  assert.equal(e.engineValues.get(ENGINE_FIELD.loadInProgress), 0, '★走栈自己走完（读档门已清）');
  const savedName = (await src.readScript(payload.frames[payload.savedCur]!.scriptId))?.name ?? '';
  assert.ok(
    savedName !== '' && (e.curScript().name === savedName || trail.includes(savedName)),
    `★读档后必须活到存档帧的脚本里（期望 ${savedName}；实际当前 ${e.curScript().name}，轨迹 ${trail.slice(0, 8).join(' → ')}）`,
  );
  assert.ok(
    !trail.includes('TITLE.BIN'),
    `★续跑不得落回标题画面（引擎靠帧 0 的 i0ae 把控制交给存档帧，SYSTEM4 的 call-script TITLE 不该执行；轨迹 ${trail.slice(0, 10).join(' → ')}）`,
  );
  t.diagnostic(`续跑后轨迹：${trail.join(' → ')}；路径上被跳过的未实现 opcode：${unknown.length} 个（不判失败，属场景机制缺口）`);
});
