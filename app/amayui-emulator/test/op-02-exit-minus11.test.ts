/** @tier T0 @kind core @subsystem vm */

/**
 * `0x02 exit` 的 **-11** 分支（`tickets/T-0092`，审计 `op-2-10`）。
 *
 * 引擎体（**权威 = listing** `engine/天结_unpacked.exe_utf8.lst:0041A837-0041A895`；`.c` 的 raw
 * 25649-25660 是 Hex-Rays 的误渲染，见下）：
 *
 * ```text
 * 0041A85A  push    offset aSetSaveversion_0   ; "set:SaveVersion2"
 * 0041A865  mov     dword ptr [esi+5D884h], 0FFFFFFFFh   ; _this[95777] = -1（call_ret）
 * 0041A86F  call    eax                          ; R2 = GetConfig("set:SaveVersion2")   ← vtable 槽 +4
 * 0041A877  push    eax                          ; ★最后那次 sub_40F750 的 a3（跨过中间那次 call）
 * 0041A87B  push    offset aSetSaveversion       ; "set:SaveVersion1"
 * 0041A886  call    eax                          ; R1 = GetConfig("set:SaveVersion1")
 * 0041A888  push    eax                          ; a2 = R1
 * 0041A88B  call    sub_40F750                   ; sub_40F750(this, a2 = SV1, a3 = SV2)
 * 0041A895  retn
 * ```
 *
 * `sub_40F750`（raw 18877-18951）的 a2/a3 分派表**没有任何一支退出程序**：
 *  - `a2==1 && a3∈{10,20}`：`sub_40ED40` 装该版本记录里的脚本 + 按记录还原表下标；
 *  - `a2==1 && a3∉{10,20}` / `a2∉{1,2,3}`：**什么都不做**（raw 18899 / 18934 的 `return`）；
 *  - `a2∈{2,3}`：`sub_40ED40` 装记录脚本 + 恢复 ip/返回栈，随后 `sub_4380F0`（时间戳）。
 *
 * ★因此"无记录 0"**不是**程序退出：旧实现（`control.ts` 的 `else` 兜底）抛 `ExitScript` 与体相反。
 * 本文件的断言：① `pendingRecord0` 为真时仍走装载支（不回归）；② 无记录 0 时不抛 `ExitScript`、
 * 不做程序退出，且 `set:SaveVersion1/2` 的**读**真的发生（改注册表值 ⇒ 分派结果跟着变，且值不被回写）；
 * ③ -11 之外的分支（`>=0` 返回调用层 / 其余负值 = 程序退出）不变。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Engine } from '../src/vm/engine.js';
import { ExitScript, loadScriptIntoFrame } from '../src/vm/ops.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { StubNative } from '../src/vm/stubNative.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { parseIni } from '../src/engineConfig.js';
import { parseScriptBytes } from '../src/script/bin.js';
import type { EngineSlotResume } from '../src/vm/engineSlot.js';
import { buildScriptBin } from './engineSlotFixtures.js';

/** 合成脚本：`0x2 exit` + `0x1a8 dev_ukn`（引擎内部纯 no-op，0 操作数）。 */
const CALLBACK_SCRIPT = (): Uint8Array =>
  buildScriptBin([
    { op: 0x2, args: [] },
    { op: 0x1a8, args: [] },
  ]);

/** 记录 0 的脚本（只用来证明"装载支真的把脚本换进帧 0"；内容是单条 `0x2`）。 */
const RECORD0_SCRIPT = (): Uint8Array => buildScriptBin([{ op: 0x2, args: [] }]);

const RECORD0_ID = 0x51;

function mkEngine(logs: string[]): Engine {
  return new Engine(new StubNative((m) => logs.push(m)));
}

/** 帧 0 里跑着 `CALLBACK_LOAD.BIN` 且返回帧 = -11（`sub_410160` 的装载握手，raw 19577/19695）。 */
function armCallback(e: Engine, name = 'CALLBACK_LOAD.BIN'): void {
  loadScriptIntoFrame(e.frames[0]!, parseScriptBytes(CALLBACK_SCRIPT()), name, 0);
  e.frames[0]!.caller = -11;
}

/** 一条最小续跑记录（记录 0 = 帧 0 的槽）。 */
function resume0(over: Partial<EngineSlotResume> = {}): EngineSlotResume {
  return {
    savedCur: 0,
    savedRet: 0,
    sv1: 3,
    sv2: 20,
    pendingRecord0: true,
    frames: [{ returnFrame: -1, scriptId: RECORD0_ID, retIdx: [], messageIdx: -1, callIdx: -1 }],
    ...over,
  };
}

/** 只提供 `readScript` 的内存 FileSource。 */
function fakeFileSource(): Engine['fileSource'] {
  return {
    readScript: async (id: number) =>
      id === RECORD0_ID ? { index: id, name: 'SYSTEM4.BIN', data: RECORD0_SCRIPT() } : null,
  } as unknown as Engine['fileSource'];
}

// ---------------------------------------------------------------------------
// ② 无记录 0：不抛 ExitScript、不做程序退出
// ---------------------------------------------------------------------------

test('② caller=-11 且无记录 0：不抛 ExitScript、不退出程序，只写 call_ret = -1（引擎 raw 0041A865）', async () => {
  const logs: string[] = [];
  const e = mkEngine(logs);
  armCallback(e);
  const f = e.frames[0]!;

  let thrown: unknown = null;
  const trace = await stepOnce(e).catch((x: unknown) => {
    thrown = x;
    return null;
  });
  assert.equal(
    thrown,
    null,
    `★"无记录 0"必须什么都不做（旧实现抛 ExitScript = 程序退出）；实际抛了 ${String(thrown)}`,
  );
  assert.ok(!(thrown instanceof ExitScript), '尤其不得是 ExitScript');
  assert.ok(trace, '应正常返回一条 trace（说明"一次控制转移"没被误当成"整个程序退出"）');
  assert.equal(trace.opcode, 0x2);

  // ① `_this[95777] = -1`（fields.json：0x5D884 = call_ret）
  assert.equal(e.engineValues.get(ENGINE_FIELD.callRet), -1, '分支第一件事就是写 call_ret = -1');
  // 不切换帧、不碰 frame.caller（引擎只写全局 call_ret；帧记录的 [0] 格由 sub_40ED40 抄写，raw 18637）
  assert.equal(e.cur, 0, '帧不变');
  assert.equal(f.caller, -11, 'frame.caller 保持 -11（本分支不写它）');
  assert.equal(f.ip, 1, '返回到 stepOnce 后走默认推进（exit 是 0 操作数指令）');

  // ② `set:SaveVersion1/2` 的读：无配置 ⇒ 注册表内建默认 1/0 ⇒ 分派表两支都不进
  const joined = logs.join('\n');
  assert.match(joined, /sub_40F750\(sv1=1, sv2=0\)/, '必须把读到的 sv1/sv2 报出来');
  assert.match(joined, /两支都不进 ⇒ 直接 return（不动作）/, 'sv1=1/sv2=0 ⇒ 什么都不做');
  assert.match(joined, /无记录 0 可装 ⇒ 不动作/);

  // ③ 程序仍在跑：下一条指令照常执行（这就是"没有程序退出"的可观测形式）
  const t2 = await stepOnce(e);
  assert.equal(t2.opcode, 0x1a8, '下一句 dev_ukn 照常执行');
  assert.equal(f.ip, 2);
});

test('② `set:SaveVersion1/2` 真的被读：改注册表值 ⇒ 分派支跟着变（且**只读**，值不被回写）', async () => {
  const cases: { ini: string; sv1: number; sv2: number; branch: RegExp }[] = [
    { ini: '[set]\nSaveVersion1 = 1\nSaveVersion2 = 0\n', sv1: 1, sv2: 0, branch: /两支都不进 ⇒ 直接 return（不动作）/ },
    { ini: '[set]\nSaveVersion1 = 1\nSaveVersion2 = 10\n', sv1: 1, sv2: 10, branch: /sv1=1 的部分还原（a3∈\{10,20\}）/ },
    { ini: '[set]\nSaveVersion1 = 1\nSaveVersion2 = 20\n', sv1: 1, sv2: 20, branch: /sv1=1 的部分还原（a3∈\{10,20\}）/ },
    { ini: '[set]\nSaveVersion1 = 2\nSaveVersion2 = 0\n', sv1: 2, sv2: 0, branch: /装载记录脚本（a2==2\/3/ },
    { ini: '[set]\nSaveVersion1 = 3\nSaveVersion2 = 20\n', sv1: 3, sv2: 20, branch: /装载记录脚本（a2==2\/3/ },
    // a2 ∉ {1,2,3}（含注册表缺键时的 0）⇒ 什么都不做
    { ini: '[set]\nSaveVersion1 = 0\nSaveVersion2 = 20\n', sv1: 0, sv2: 20, branch: /两支都不进 ⇒ 直接 return（不动作）/ },
  ];
  for (const c of cases) {
    const logs: string[] = [];
    const e = mkEngine(logs);
    e.config = parseIni(c.ini);
    armCallback(e);
    const before = JSON.stringify([...e.config.values]);

    const thrown = await stepOnce(e).then(
      () => null,
      (x: unknown) => x,
    );
    assert.equal(thrown, null, `sv1=${c.sv1}/sv2=${c.sv2} 不得抛异常`);
    const joined = logs.join('\n');
    assert.match(joined, new RegExp(`sub_40F750\\(sv1=${c.sv1}, sv2=${c.sv2}\\)`), '读到的值 = 注册表里的值');
    assert.match(joined, c.branch, `sv1=${c.sv1}/sv2=${c.sv2} 的分派支`);
    // ★审计 `op-2-10` 说这一支"把结果写回配置" —— 体里没有写（两次 call 都是 vtable 槽 +4 的 GetConfig，
    //   写侧是槽 +12 的 sub_492AB0，本分支一次都没调；见 control.ts 的 readSaveVersionPair 头注）。
    assert.equal(JSON.stringify([...e.config.values]), before, '★本分支只读：注册表值不得被改写');
  }
});

// ---------------------------------------------------------------------------
// ① pendingRecord0 为真 ⇒ 仍走装载支（不回归）
// ---------------------------------------------------------------------------

test('① pendingRecord0 为真 ⇒ 帧 0 ← 记录 0 的脚本（既有正确路径不回归，tickets/T-0072）', async () => {
  const logs: string[] = [];
  const e = mkEngine(logs);
  // ★注册表写内建默认 1/0（= 引擎 a2==1/a3==0 ⇒ 不动作），而槽自己声明 3/20 ⇒ 必须按**槽**走装载支
  //   （来源优先级与 `0xAE` 一致，`tickets/T-0065`）。
  e.config = parseIni('[set]\nSaveVersion1 = 1\nSaveVersion2 = 0\n');
  armCallback(e);
  e.fileSource = fakeFileSource();
  e.saveResume = resume0();

  await stepOnce(e);

  assert.equal(e.curScript().name, 'SYSTEM4.BIN', '★帧 0 换成记录 0 的脚本');
  assert.equal(e.frames[0]!.scriptId, RECORD0_ID, '脚本身份 token = 记录里的 scriptId');
  assert.equal(e.frames[0]!.caller, -1, '引擎：`_this[95777] = -1` 由 sub_40ED40 写进帧记录的 [0]');
  assert.equal(e.saveResume!.pendingRecord0, false, '标志被消费');
  assert.equal(e.engineValues.get(ENGINE_FIELD.callRet), -1, 'call_ret = -1（本分支第一件事）');
});

test('① 变体：sv1=1/sv2=20（a2==1 且 a3∈{10,20}）也在装载支 ⇒ 同样装记录脚本', async () => {
  const logs: string[] = [];
  const e = mkEngine(logs);
  e.config = parseIni('[set]\nSaveVersion1 = 1\nSaveVersion2 = 20\n');
  armCallback(e);
  e.fileSource = fakeFileSource();
  e.saveResume = resume0({ sv1: 1, sv2: 20 });

  await stepOnce(e);
  assert.equal(e.curScript().name, 'SYSTEM4.BIN', 'a2==1/a3==20 那一支同样调 sub_40ED40 装记录脚本');
});

// ---------------------------------------------------------------------------
// ③ -11 之外的分支：行为不变
// ---------------------------------------------------------------------------

test('③ -11 之外的分支不变：caller>=0 返回调用层；-1 与其它负值 = 程序退出（引擎 LABEL_14）', async () => {
  // caller = 0（跨脚本返回调用层）：cur 切回 0、不抛
  {
    const logs: string[] = [];
    const e = mkEngine(logs);
    const f = e.frames[1]!;
    loadScriptIntoFrame(f, parseScriptBytes(CALLBACK_SCRIPT()), 'CALLER.BIN', 0);
    f.caller = 0;
    e.cur = 1;
    await stepOnce(e);
    assert.equal(e.cur, 0, 'caller>=0 ⇒ 回到调用帧');
    assert.equal(e.callRet, 0, '引擎 callRet = 调用帧');
    assert.equal(f.ip, 0, 'jump(-1)：控制流已转移，调用帧不再推进');
  }
  // caller = -1（顶层脚本 exit）与其它负值（-2/-12）⇒ 引擎 LABEL_14 `_CxxThrowException(&2, Command_Exit)`
  for (const caller of [-1, -2, -12]) {
    const logs: string[] = [];
    const e = mkEngine(logs);
    armCallback(e, 'TOP.BIN');
    e.frames[0]!.caller = caller;
    const thrown = await stepOnce(e).then(
      () => null,
      (x: unknown) => x,
    );
    assert.ok(thrown instanceof ExitScript, `caller=${caller} ⇒ 程序退出（ExitScript）`);
  }
  // caller = -10（派发哨兵）：既有覆盖在 test/route-dispatch.test.ts / test/append-packs.test.ts
  //（i143 派发 + `exit` 的 -10 分支 = `sub_40FB60` 的下一条），此处不重复。
});
