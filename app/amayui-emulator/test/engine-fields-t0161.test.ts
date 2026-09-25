/** @tier T0 @kind core @subsystem vm */

/**
 * **T-0161（引擎字段 / 配置读写批）—— 引擎字段侧的逐条守卫**。
 *
 * 夹具 = `harness.mkEngine` + `stepOnce`（**产品同款驱动**，不新造 `mk()` 变体 —— 见
 * `test/harness-convergence.test.ts` 的 T-0020 棘轮）；不依赖未入库真游戏资源（故 **T0**，
 * 见 `test/organization.test.ts` 的 R2）。
 *
 * 全部按**读体**结论（锚点 = `engine/天结_unpacked.exe_utf8.c` 行号）：
 *  1. `0x201`（`sub_4302B0` raw 39859-39863）：`op1 = _this[166964]`（= 667856/4）。该字段的**生产端**
 *     在引擎里有四个写点：构造 raw 23572-23574（`*(a1 + 667856) = GetConfig(aSetDrawmode)`）、
 *     主循环/复位后 raw 35271-35273（同形、无条件）、清零点 raw 17979、脚本端 `0x200`/`sub_423170`
 *     raw 31372（**带门**：`1 << op1` 必须在 `set:CreateObject` 位图里，否则报 `aComsetdrawmode` 且不写）。
 *     emulator 修前**一个生产者都没有**（`set:DrawMode` 未进 `CONFIG_FIELD_BINDINGS`）⇒ getter 恒 0。
 *  2. `0x25B`（`sub_425E20` raw 33206-33221）：体内写**两格** —— `_this[92379] = 2`（消息态模式 =
 *     图像）与 `_this[92381] = op1`（图像 id），随后才是
 *     `if (!_this[167990]) { v3 = sub_41BF50(_this, 1); return sub_408440(_this, v3); }` 的加载分支
 *     （那一段见 `tickets/T-0161/changes-c161.md` 的缺口登记）。
 *  3. `0xD9`（`sub_419970` raw 24939-24949）：`_this[174801] &= ~0x1000`，且 **`if (_this[124350])
 *     _this[95779] &= ~0x1000`**。`124350` 的写点由 `handlers/control.ts` 的 `setDispatching`
 *     （`tickets/T-0157`）落地（raw 18149/18980/25176/25187/25667）⇒ 派发中的被派发脚本（帧 37）
 *     那一刻门**成立**。但 emulator 把 `_this[95779]` 建模成了**两处**：`Engine.dispatchSavedFlags`
 *     （`control.ts:382/373` 的存/取，真正的活槽）与 `engineValues[95779]`（只有本 handler 读写）。
 *     ⇒ 修前 0xD9 清的是**没有别人读的那一份**。本票把活槽也清（`op-a5.test.ts:176-189` 钉住的
 *     `engineValues` 那一份**保持原样**、不放宽）。
 *     ★另：`sub_419970` 的返回值 `-4097` **不参与任何控制流** —— 唯一调用点 raw 20161-20165
 *     `((void (__thiscall *)(int *))_this[v7 + 168999])(_this);` 把函数指针**强转成返回 `void`**
 *     ⇒ 位模式被丢弃（审计 `0xd9 missing-consumer` 的前提被推翻）。
 *  4. `0x2E9` 的**消费端**（审计 `0x2e9 missing-consumer`）：`_this[122464]` 现在有真读者 ——
 *     `handlers/msgwin.ts` 的 `armCoexistAutoMessage`（raw 28556-28586）与 `vm/engine.ts` 的
 *     `#autoMessageInterval`（raw 20384-20399 / 28568-28581），公式 =（该窗行数 − 1 − 本字段）×
 *     `message:AutoMessagePitch{0,1}` + `message:AutoMessageTime{0,1}`，再夹到 ≥ 100 ms。
 *     ★**没有** `message:AutoMessageSpeed` / `message:AutoMessageMinTime` 这两个键（4 个
 *     `AutoMessage*` 键的引擎字符串见 raw 4309-4313）—— 本文件用一条静态棘轮钉住"读者还在"。
 *  5. `0x148`/`0x149`（`sub_42FEC0` / 写侧 `sub_4229A0`）：读写 `_this[97058]`。引擎里该槽的读者是窗口
 *     过程 `sub_4B9240`（raw 141038-141043：`timeGetTime() - dword_55E1D8 > *(dword_55E1BC + 388232)`
 *     才继续走弹系统对话框的分支）⇒ emulator 没有「点击去抖 / 系统对话框」宿主子系统，这一格
 *     **写进/读出都不被生产路径消费**（如实登记，不编消费者）。
 *  6. `0x142`（`sub_422930` raw 31020-31027）：`_this[174812] = op1`（= 字节 699248）。构造
 *     `sub_415640`（raw 22591）与整体复位 `sub_40DF10`（raw 17961）都置 **1** —— 那两处在
 *     `src/vm/engine.ts`（不在本票可写路径内）⇒ 本文件只钉字段 id 与写侧两条，初值缺口登记在
 *     `tickets/T-0161/changes-c161.md`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BinInstruction } from '../src/script/bin.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { StubNative } from '../src/vm/native.js';
import { decIntSlot } from '../src/vm/ref.js';
import { applyConfigToEngine, parseIni } from '../src/engineConfig.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import type { Engine } from '../src/vm/engine.js';
import { im, instr, loc, mkEngine } from './harness.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', 'src');

/** 夹具（**唯一**，不新造 `mk()` 变体）：`mkEngine` 建引擎 + 装合成脚本，`stepOnce` 逐条执行。 */
function rig(ops: BinInstruction[], ini?: string): Engine {
  const e = mkEngine(ops, 'T0161F.BIN', new StubNative(() => {}));
  if (ini !== undefined) e.config = parseIni(ini);
  return e;
}

/** 读本帧 `local-int` 槽的**真值**（池里是 ENC 位模式，必须 `decIntSlot`）。 */
const decodeLocal = (e: Engine, n: number): number | undefined =>
  decIntSlot(e.key, e.curScript().locals.int.get(n));

// ---------------------------------------------------------------------------
// 1) 0x201 DrawMode：配置 → 字段 → getter
// ---------------------------------------------------------------------------

test('★0x201：`set:DrawMode=1` 经配置绑定进 `_this[166964]` 后，getter 读回 1（修前恒 0）', async () => {
  const e = rig([instr(0x201, [loc(5)])], '[set]\r\nDrawMode=1\r\n');
  applyConfigToEngine(e.config!, e.engineValues);
  await stepOnce(e);
  assert.equal(decodeLocal(e, 5), 1, 'raw 39862 `sub_42B4B0(_this, 1, _this[166964])`');

  // 反向：配置为 0 / 无该键 ⇒ 字段 0（引擎构造期无条件 `= GetConfig(...)`，内建缺省 0）
  const b = rig([instr(0x201, [loc(5)])], '[set]\r\nDrawMode=0\r\n');
  applyConfigToEngine(b.config!, b.engineValues);
  await stepOnce(b);
  assert.equal(decodeLocal(b, 5), 0);
  const c = rig([instr(0x201, [loc(5)])], '[message]\r\nMessageSpeed=5\r\n');
  applyConfigToEngine(c.config!, c.engineValues);
  await stepOnce(c);
  assert.equal(decodeLocal(c, 5), 0, '键不在 ⇒ 不写字段 ⇒ getter 读 0（与引擎内建缺省同值）');
});

// ---------------------------------------------------------------------------
// 2) 0x25B：两个字段（模式 2 + 图像 id）
// ---------------------------------------------------------------------------

test('★0x25B：同时写 `_this[92379] = 2`（模式=图像）与 `_this[92381] = op1`', async () => {
  const e = rig([instr(0x25b, [im(0x5678)]), instr(0x25a, [im(0x1234)]), instr(0x25b, [im(0x9999)])]);
  await stepOnce(e);
  assert.equal(e.engineValues.get(ENGINE_FIELD.mediaMode), 2, 'raw 33211 `_this[92379] = 2;`');
  assert.equal(e.engineValues.get(ENGINE_FIELD.msgMediaImageId), 0x5678, 'raw 33212 `_this[92381] = result;`');
  // 与 0x25A 不对称性对照：影片写模式 1、图像写模式 2（同一格）
  await stepOnce(e);
  assert.equal(e.engineValues.get(ENGINE_FIELD.mediaMode), 1);
  await stepOnce(e);
  assert.equal(e.engineValues.get(ENGINE_FIELD.mediaMode), 2, '两族共用同一格 ⇒ 后写者胜');
  assert.equal(e.engineValues.get(ENGINE_FIELD.mediaId), 0x1234, '影片 id 格不被图像族碰');
});

// ---------------------------------------------------------------------------
// 3) 0xD9：派发中时的 95779（活槽）
// ---------------------------------------------------------------------------

test('★0xD9：派发中（124350 = 1）⇒ 清 `Engine.dispatchSavedFlags` 的 0x1000 位（修前只清了死槽）', async () => {
  const e = rig([instr(0xd9, [])]);
  e.effectFlags = 0x1000 | 0x2000;
  e.dispatchSavedFlags = 0x1000 | 0x8;
  e.engineValues.set(ENGINE_FIELD.dispatchInProgress, 1);
  await stepOnce(e);
  assert.equal(e.effectFlags & 0x1000, 0, '`_this[174801] &= ~0x1000`');
  assert.equal(e.effectFlags & 0x2000, 0x2000, '只清那一位');
  assert.equal(e.dispatchSavedFlags, 0x8, '`if (_this[124350]) _this[95779] &= ~0x1000` ⇒ 活槽也要清');

  // 非派发中：活槽**一位都不动**（raw 24946 的门）
  const b = rig([instr(0xd9, [])]);
  b.dispatchSavedFlags = 0x1000 | 0x8;
  b.engineValues.set(ENGINE_FIELD.dispatchInProgress, 0);
  await stepOnce(b);
  assert.equal(b.dispatchSavedFlags, 0x1000 | 0x8, '124350 == 0 ⇒ 不碰 95779');
});

// ---------------------------------------------------------------------------
// 4) 0x2E9：行基准的消费端棘轮（防"又变回只写不读"）
// ---------------------------------------------------------------------------

test('★0x2E9：`_this[122464]` 在 emulator 里有**生产读者**（自动翻页时长公式的两处）', () => {
  const readers: { file: string; hits: number }[] = [];
  const walk = (dir: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith('.ts')) {
        const rel = path.relative(SRC, p).replace(/\\/g, '/');
        if (rel === 'vm/handlers/engine-fields.ts' || rel === 'vm/engineFieldIds.ts') continue; // 写者/定义
        const text = fs.readFileSync(p, 'utf8');
        const hits = (text.match(/ENGINE_FIELD\.autoMessageBaseline|autoMessageBaseline\b/g) ?? []).length;
        if (hits > 0) readers.push({ file: rel, hits });
      }
    }
  };
  walk(SRC);
  assert.ok(
    readers.length >= 1,
    '`_this[122464]` 的消费端（raw 20384-20399 / 28556-28586 的 AutoMessage 时长公式）必须仍在 src 里；' +
      '若它被删掉，这个字段就退回"只写不读"⇒ 本棘轮会红',
  );
  assert.ok(
    readers.some((r) => r.file === 'vm/handlers/msgwin.ts'),
    `msgwin.ts 的 armCoexistAutoMessage 是它的第一个读者（实得 ${JSON.stringify(readers)}）`,
  );
});

test('0x2E9：写侧无门无变换（`_this[122464] = op1`，含负值）', async () => {
  const e = rig([instr(0x2e9, [im(-3)])]);
  await stepOnce(e);
  assert.equal(e.engineValues.get(ENGINE_FIELD.autoMessageBaseline), -3, 'raw 33584-33586 原样写');
});

// ---------------------------------------------------------------------------
// 5) 0x148 / 0x149：全局槽（读者是宿主窗口过程 ⇒ 登记为缺口）
// ---------------------------------------------------------------------------

test('0x148/0x149：`_this[97058]` 读写往返（引擎里读者是 WndProc sub_4B9240，emulator 无该子系统）', async () => {
  const e = rig([instr(0x149, [im(250)]), instr(0x148, [loc(9)])]);
  assert.equal(e.globalSlot97058, 0, '初值 0');
  await stepOnce(e); // 写
  assert.equal(e.globalSlot97058, 250);
  await stepOnce(e); // 读
  assert.equal(decodeLocal(e, 9), 250);
});

// ---------------------------------------------------------------------------
// 6) 0x142：字段 id 与写侧（初值/复位 1 见缺口登记）
// ---------------------------------------------------------------------------

test('0x142：`_this[174812]`（= 字节 699248）可写 0/1；★构造/复位的初值 1 仍需 engine.ts 落地', async () => {
  assert.equal(ENGINE_FIELD.scriptEngineFlag, 174812);
  assert.equal(ENGINE_FIELD.scriptEngineFlag * 4, 699248, 'raw 里的字节偏移形态');
  const e = rig([instr(0x142, [im(0)]), instr(0x142, [im(1)])]);
  await stepOnce(e);
  assert.equal(e.engineValues.get(ENGINE_FIELD.scriptEngineFlag), 0, 'CONFIG.txt:40 进设置页置 0');
  await stepOnce(e);
  assert.equal(e.engineValues.get(ENGINE_FIELD.scriptEngineFlag), 1, 'CONFIG.txt:354 离开设置页置 1');
});
