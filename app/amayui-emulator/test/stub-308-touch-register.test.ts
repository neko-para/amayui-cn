/** @tier T0 @kind ratchet @subsystem ops */

/**
 * ★**T-0111 判据②（`0x308` 触摸注册）+ T-0163 的 `0x308` 三条**（P2 `missing-behavior` /
 * P3 `missing-operand-io` / P3 `stale-ledger`）。
 *
 * 处置（票面已定、本轮执行）=「**有据 no-op 登记**」：把 `[0x308, op_stub_unhandled]` 从
 * `STUB_NATIVE_OPS` 移出，改登记进同文件的 `ENGINE_INTERNAL_OPS`（带 why + raw 锚点），
 * **不再打 `unhandled` 日志**。
 *
 * ## 引擎体（本次逐行读体确证，raw = `engine/天结_unpacked.exe_utf8.c`）
 *  - `0x308` handler = `sub_426B20`（raw **33808-33815**）：写 arity 槽（`3` ⇒ argc 1）→
 *    `v2 = sub_41BF50(_this, 1)`（**读 op1**）→ `sub_407B20(dword_55E1BC, _this[96981], v2)`
 *    （第 2 实参 = `_this[96981]` = HWND 格，同一格被 `GetWindowPlacement`/`SetCursorPos` 当 hwnd 用）。
 *  - 被调体 `sub_407B20`（raw **12579-12618**）：`LoadLibraryA("USER32.DLL")`（字面量 raw 4292 ——
 *    标识符在 `.c` 里叫 `LibFileName`，无 `USER32` 字样，本次按 raw 4292 的字符串值确认）→
 *    门 `a3 || (GetConfig("system:LimitTouch") & 1)`（raw 12590；`a3` = `0x308` 的 op1；
 *    字面量 raw 4291）⇒ 真取 `GetProcAddress(h, "UnregisterTouchWindow")`（raw 4289）调 `(hwnd)`；
 *    假取 `GetProcAddress(h, "RegisterTouchWindow")`（raw 4290）调 `(hwnd, 2)`；随后 `FreeLibrary`；
 *    **三条出边**（含 `LoadLibraryA` 失败支）都写 `_this[1954] = a3`（raw 12605/12610/12615）。
 *  - `_this[1954]` 在**整份反编译里 3 写 0 读**（`grep '1954]'` 仅 3 命中，全在这三条出边）
 *    ⇒ 对 VM 不可观测（不写脚本操作数、不改 ip/cur）。
 *  - 语料 **31279 处 / 345 个文件**（`^i308 ` 实测计数）—— 每一次在 emulator 里都只应"合法跳过"。
 *
 * ## 为什么登记成 no-op 而不是造一个宿主触点
 * 引擎侧唯一的真实副作用是 **USER32 的窗口级触摸注册**（`RegisterTouchWindow(hwnd, 2)`）；emulator
 * 没有 HWND 概念、也没有窗口级触摸注册面（触屏/指针输入由 Electron/DOM 层持有）⇒ 造一个
 * `native.registerTouchWindow?.(...)` 的空实现只是把"无宿主触点"换个地方写，且会给 `_this[1954]`
 * 造一个**假消费者**（该字段 3 写 0 读，`check:dead-writes` 正是拦这个）。
 * 扩展点（若将来要做）：宿主缝 `registerTouchWindow(hwnd, unregister: boolean)` + 配置读
 * `system:LimitTouch`（bit0），二者都在 `src/vm/native.ts`/`nativeTap.ts`（**不属本票文件范围**）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS, loadScriptIntoFrame } from '../src/vm/ops.js';
import { STUB_NATIVE_OPS } from '../src/vm/handlers/stubs.js';
import { StubNative } from '../src/vm/native.js';
import { Engine } from '../src/vm/engine.js';
import { stepOnce } from '../src/vm/interpreter.js';
import type { BinInstruction, ScriptBinary } from '../src/script/bin.js';
import { scriptDerived } from './harness.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', '..');
const STUBS = path.join(ROOT, 'app/amayui-emulator/src/vm/handlers/stubs.ts');
const H = 0x3c;

function script(opcode: number, argc: number): ScriptBinary {
  const one: BinInstruction = {
    opcode,
    name: `i${opcode.toString(16)}`,
    argc,
    args: Array.from({ length: argc }, (_, i) => ({ type: 0, raw: 0x64 + i })),
    byteOffset: H,
    index: 0,
  };
  return {
    ...scriptDerived(),
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
    instructions: [one],
    labelTargets: new Set<number>(),
    raw: new Uint8Array(H + 4 + 8 * argc),
  };
}

/** 记录 `unhandled` 调用的宿主（旧 `op_stub_unhandled` 的日志点）。 */
class SpyNative extends StubNative {
  readonly unhandledCalls: string[] = [];
  unhandled(opcode: number, name: string): void {
    this.unhandledCalls.push(`${opcode}:${name}`);
  }
}

test('★T-0111②：0x308 在 ENGINE_INTERNAL_OPS（不再在 STUB_NATIVE_OPS）', () => {
  assert.ok(ENGINE_INTERNAL_OPS.has(0x308), '0x308 必须登记进 ENGINE_INTERNAL_OPS');
  assert.equal(OPS.has(0x308), false, '不是真实现');
  assert.equal(NATIVE_OPS.has(0x308), false, '不是 native 缝（引擎侧的 USER32 调用没有 emulator 对应物）');
  assert.equal(STUB_NATIVE_OPS.length, 0, 'STUB_NATIVE_OPS 已空：唯一条目 0x308 改了登记方式');
});

test('★0x308 跑一步：handlerKind=engine-internal、不发 unhandled、不写 Engine[1954]、ip 照常前进', async () => {
  const native = new SpyNative(() => {});
  const e = new Engine(native);
  loadScriptIntoFrame(e.curScript(), script(0x308, 1), 'TEST.BIN');
  const before = e.curScript().ip;
  const t = await stepOnce(e);
  assert.equal(t.handlerKind, 'engine-internal', '0x308 应登记为 engine-internal（有据 no-op）');
  assert.deepEqual(native.unhandledCalls, [], '不再走 unhandled 桩（旧登记方式会打一行 unhandled 日志）');
  assert.equal(e.curScript().ip, before + 1, '不得改 ip/cur（跳过与"读了再丢"可观测等价）');
  assert.equal(
    e.engineValues.has(1954),
    false,
    '`_this[1954]` 3 写 0 读 ⇒ 不建模（登记性缺口；不许为了"不算 no-op"造死写/假消费者）',
  );
});

test('★源文棘轮：0x308 的登记文档带 USER32 两侧副作用 + raw 锚点，旧桩串已消失', () => {
  const src = fs.readFileSync(STUBS, 'utf8');
  assert.ok(src.includes('[0x308, op_engine_internal]'), '新登记点必须在 stubs.ts');
  assert.ok(
    !src.includes('[0x308, op_stub_unhandled]'),
    '旧登记串 `[0x308, op_stub_unhandled]` 必须消失（T-0111 的 evidence 锚点已按棘轮纪律改指到新串）',
  );
  assert.ok(!src.includes('const op_stub_unhandled'), '旧桩 handler 的定义必须删除（它只做 unhandled 记录）');
  // 注释里可以留"它曾是什么"的沿革（第 25 行），但**代码行**不得再有 unhandled 调用点。
  const codeLines = src
    .split('\n')
    .filter((l) => !/^\s*(\*|\/\*)/.test(l))
    .filter((l) => l.includes('native.unhandled'));
  assert.deepEqual(codeLines, [], 'stubs.ts 里不得再有任何 unhandled 调用点（旧登记方式会打日志）');
  for (const s of [
    'USER32',
    'RegisterTouchWindow',
    'UnregisterTouchWindow',
    'system:LimitTouch',
    '1954',
    '31279',
    '33808',
    '12605',
  ]) {
    assert.ok(src.includes(s), `0x308 的登记文档必须出现 ${s}（审计 T-0163 的 stale-ledger 行要求）`);
  }
});
