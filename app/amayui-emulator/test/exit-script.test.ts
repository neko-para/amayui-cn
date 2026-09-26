/** @tier T1 @kind core @subsystem vm */

/** exit-script(0x9) 与 load-show-logo(0x130,+96983) 的「GAMEOVER → 回标题且不再播 LOGO/版权页」机制测试。
 *  依据 engine：
 *   - sub_415640(构造) 置 `_this[96983]`(byte 387932)=1 → SYSTEM4 `load-show-logo → jcc → call-script LOGO`。
 *   - sub_428A60(exit-script) 置 `_this[96983]`=0 并 `sub_40ED40(0,…)` 重载根脚本 0 继续。
 *   - 故 GAMEOVER → exit-script → 回标题 reboot 后 load-show-logo 读 0 → jcc 跳过 LOGO（不再重播版权页）。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine, Frame } from '../src/vm/engine.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { makeCtx } from '../src/vm/step.js';
import { NATIVE_OPS, loadScriptIntoFrame } from '../src/vm/ops.js';
import { readIntOperand } from '../src/vm/operand.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { StubNative } from '../src/vm/native.js';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { resolveResourceDir } from '../src/arch/resourceDir.js';
import type { BinInstruction, BinArg, ScriptBinary } from '../src/script/bin.js';
import { scriptDerived } from './harness.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
// 资源根 = install/（汉化版），与产品一致；AMAYUI_RESOURCE_DIR 可覆盖（见 src/arch/resourceDir.ts）
const RAW_DIR = resolveResourceDir(ROOT);

function instr(opcode: number, args: BinArg[]): BinInstruction {
  return { opcode, name: 'x', argc: args.length, args, byteOffset: 0, index: 0 };
}
/** 局部 int 操作数（TYPE_LOCAL_INT=0x9）。 */
const localInt = (raw: number): BinArg => ({ type: 0x9, raw });

test('load-show-logo(0x130) 读 _this[96983]：构造=1(LOGO on)、exit-script 后=0(LOGO off)', () => {
  const native = new StubNative(() => {});
  const e = new Engine(native);
  const f = new Frame();
  const run = (arg: BinArg) => {
    const c = makeCtx(e, f, instr(0x130, [arg]), native, () => {});
    NATIVE_OPS.get(0x130)!(c);
    return c;
  };
  // 构造默认 1 → LOGO 应播
  assert.equal(e.engineValues.get(96983), 1, '默认 +96983 应为 1');
  const i1 = instr(0x130, [localInt(2)]);
  run(localInt(2));
  assert.equal(readIntOperand(e, f, i1, 1), 1, 'load-show-logo: +96983=1 → local-int 2 = 1（LOGO 播放）');
  // exit-script 把 96983 置 0 → LOGO 跳过
  e.engineValues.set(96983, 0);
  run(localInt(2));
  assert.equal(readIntOperand(e, f, i1, 1), 0, 'load-show-logo: +96983=0 → local-int 2 = 0（LOGO 跳过）');
});

test('exit-script(0x9)：重置引擎 + 置 _this[96983]=0 + 重载根脚本 INDEX0 并继续(cur=0)', async () => {
  const src = new NodeFileSource({ resourceDir: RAW_DIR });
  const native = new StubNative(() => {});
  const e = new Engine(native);
  e.fileSource = src;

  // 把一个「单条 exit-script」的合成脚本装入帧0（模拟 GAMEOVER 时执行的 exit-script 指令）。
  const bootSrc: ScriptBinary = {
    ...scriptDerived(),
    signature: 'SYS0000',
    isVer5: false,
    headerLen: 0,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [],
    instructions: [instr(0x9, [])],
    labelTargets: new Set(),
    raw: new Uint8Array(0),
  };
  loadScriptIntoFrame(e.curScript(), bootSrc, 'FAKE.BIN');
  assert.equal(e.curScript().name, 'FAKE.BIN', '前置：帧0 是合成脚本');

  const t = await stepOnce(e); // 执行 exit-script(0x9)
  assert.equal(t.opcode, 0x9, 'stepOnce 应执行了 exit-script');

  // 断言：引擎已重置到干净根态，且根脚本 0 被重载、cur=0（不再停在 reset）。
  assert.equal(e.cur, 0, 'exit-script 后 cur 应回 0（干净根态）');
  assert.equal(e.curScript().name, 'SYSTEM4.BIN', 'exit-script 后应重载根脚本 INDEX0=SYSTEM4.BIN');
  assert.equal(e.curScript().script!.instructions.length > 0, true, '根脚本应有指令');
  assert.equal(e.curScript().ip, 0, '根脚本应从 ip0 重新开始');
  assert.equal(e.engineValues.get(96983), 0, 'exit-script 应把 _this[96983] 置 0（回标题不再播 LOGO/版权页）');
  assert.equal(e.callRet, -1, 'callRet 应复位 -1');

  await src.dispose?.();
});

test('GAMEOVER→回标题不再播版权页：exit-script 后 0x130 读回 0（组合成立）', async () => {
  const src = new NodeFileSource({ resourceDir: RAW_DIR });
  const native = new StubNative(() => {});
  const e = new Engine(native);
  e.fileSource = src;
  const bootSrc: ScriptBinary = {
    ...scriptDerived(),
    signature: 'SYS0000',
    isVer5: false,
    headerLen: 0,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [],
    instructions: [instr(0x9, [])],
    labelTargets: new Set(),
    raw: new Uint8Array(0),
  };
  loadScriptIntoFrame(e.curScript(), bootSrc, 'FAKE.BIN');
  await stepOnce(e); // exit-script → 重载根 + 96983=0
  // 在重载后的根帧上再执行一次 0x130（SYSTEM4 的 LOGO 判定）→ 应读到 0 → jcc 跳过 LOGO。
  const f = e.curScript();
  const gi = instr(0x130, [localInt(2)]);
  const c = makeCtx(e, f, gi, native, () => {});
  NATIVE_OPS.get(0x130)!(c);
  assert.equal(readIntOperand(e, f, gi, 1), 0, '回标题后 load-show-logo 读 +96983=0 → call-script LOGO 被跳过');
  await src.dispose?.();
});

/**
 * ★`tickets/T-0187` ③：整体复位里属于 **Font 的场景态**那一半（`Engine.resetFontSceneState()`）。
 *
 * 引擎锚点：`sub_40DF10`（整体复位）raw 18025 调 `sub_465390(Font, …)` ⇒ raw 78891 `Font+1360 = 0xFFFFFF`、
 * 78892 `+1364 = 0`、78893 `+1368 = 0`、78894 `+1372 = 1`、78951 `+1392 = 0`；raw 18077 再直接清
 * `Engine+86688`（= `Font+1392`）。`exit-script`(`0x9`) = `sub_428A60` raw 35270 ⇒ 就是这次整体复位。
 */
test('★exit-script(0x9)：Font 的**场景态**回引擎初值（填充白 / 描边 0 / 档位 1 / `Font+1392`=0）', async () => {
  const src = new NodeFileSource({ resourceDir: RAW_DIR });
  const native = new StubNative(() => {});
  const e = new Engine(native);
  e.fileSource = src;
  // 前置 = "上一场戏留下的值"：序章 `NOVEL.txt:8 i1b1 1` + 阿瓦罗台词黄 + 3 向描边
  e.engineValues.set(ENGINE_FIELD.followTextMode, 1);
  e.engineValues.set(ENGINE_FIELD.colorFill, 0xffe100);
  e.engineValues.set(ENGINE_FIELD.colorOutline, 0x123456);
  e.engineValues.set(ENGINE_FIELD.outlineMode, 3);
  const bootSrc: ScriptBinary = {
    ...scriptDerived(),
    signature: 'SYS0000',
    isVer5: false,
    headerLen: 0,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [],
    instructions: [instr(0x9, [])],
    labelTargets: new Set(),
    raw: new Uint8Array(0),
  };
  loadScriptIntoFrame(e.curScript(), bootSrc, 'FAKE.BIN');
  await stepOnce(e); // exit-script(0x9)

  assert.equal(e.engineValues.get(ENGINE_FIELD.followTextMode), 0, '★`Font+1392` 回 0（raw 78951 + raw 18077）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.colorFill), 0xffffff, '`Font+1360` 回白（raw 78891）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.colorOutline), 0, '`Font+1364` 回 0（raw 78892）');
  assert.equal(e.engineValues.get(ENGINE_FIELD.outlineMode), 1, '`Font+1372` 回 1（raw 78894）');
  await src.dispose?.();
});
