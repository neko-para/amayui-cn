/** @tier T0 @kind core @subsystem frame */

/**
 * **`T-0175` ① 与 ⑬ 的守卫**（本单元 `T-0169` 承接；票面由主 agent 收）。
 *
 * ## ① `scriptEngineFlag`（`_this[174812]` = 字节 699248）的构造初值与复位值都是 **1**
 *  - 构造 `sub_415640` raw 22591 / 整体复位 `sub_40DF10` raw 17961：`*(_DWORD *)(_this + 699248) = 1;`
 *  - 唯一写者 = `0x142`（`sub_422930` raw 31026 `_this[174812] = op1`）；唯一读者 = 导出查询
 *    `sub_4765C0`（raw 91057-91061，工程内零调用）⇒ emulator 侧只建"值本身"。
 *  - 复位落点 = `handlers/control.ts` 的 `op_exit_script`（`sub_40DF10` 的 emulator 等价物）。
 *
 * ## ⑬ `Engine[430712]`（= `_this[107678]` = `redisplayScriptId`）的三条写者，逐条处置
 * | 写者 | 位置 | 游标 | 处置 |
 * |---|---|---|---|
 * | raw 13997-14008 | `sub_409700`（主循环 `0x10000000` 臂） | 主 `122372+cur` | **不做**：`0x10000000` 的唯二置位端是 `0x8E`/`0x95`（panelB，语料 **0** 处）；`handlers/panel.ts` 已登记 emulator 不建模 panelB ⇒ 该臂在语料上不可达 |
 * | raw 20365-20374 | `sub_411BC0`（等待泵右键） | 主 `489488+4*cur` ≡ `122372+cur` | **已落**（`Engine.#cancelRoute`，`T-0167`） |
 * | raw 20859-20881 | 主循环 `0x4000000` 臂 | **备用** `122412+cur` | **本票落**：`Engine.serviceRedisplayExit()` + `src/frame/loop.ts` 帧首调用 |
 * ★第 3 条这一臂的三格与另两条是同一批引擎格（`redisplayMode`/`redisplayReturn`/`redisplayScriptId`）
 * ⇒ `0x7C`（`local-ret`）对三条路天然成立。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REDISPLAY_MODE } from '../src/vm/engine.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import { ExitScript, OPS } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import { runFrameLoop } from '../src/frame/loop.js';
import type { FrameHost } from '../src/frame/host.js';
import type { FileSource } from '../src/arch/fileSource.js';
import type { BinArg } from '../src/script/bin.js';
import { im, instr, mkEngine } from './harness.js';

/** 单个"游离帧"上的手动派发门面（`harness.ts` 的 `mkEngine` + `makeCtx` 的薄包装）。
 *  返回 handler 的返回值（`0x9 exit-script` 是 async 的，测试要 `await` 它的 rejection）。 */
function opRunner(e: ReturnType<typeof mkEngine>): (op: number, args?: BinArg[]) => unknown {
  const f = e.curScript();
  return (op, args = []) => {
    const h = OPS.get(op);
    assert.ok(h, `0x${op.toString(16)} 应在 OPS 里`);
    return h!(makeCtx(e, f, instr(op, args), e.native, () => {}));
  };
}

test('★① scriptEngineFlag（_this[174812]）构造初值 = 1（raw 22591）：engineValues 一建好就是 1', () => {
  const e = mkEngine([]);
  assert.equal(
    e.engineValues.get(ENGINE_FIELD.scriptEngineFlag),
    1,
    '★raw 22591 `*(_DWORD *)(_this + 699248) = 1;`（构造 `sub_415640`）—— 修前是 undefined（`?? 0` ⇒ 0）',
  );
  // `0x142` 是唯一写者（raw 31026），写 0 / 写 1 都要照体落进同一格
  const run = opRunner(e);
  run(0x142, [im(0)]);
  assert.equal(e.engineValues.get(ENGINE_FIELD.scriptEngineFlag), 0, '0x142 op1=0 ⇒ 0（`CONFIG.txt:40 i142 0`）');
  run(0x142, [im(1)]);
  assert.equal(e.engineValues.get(ENGINE_FIELD.scriptEngineFlag), 1, '0x142 op1=1 ⇒ 1（`CONFIG.txt:354 i142 1`）');
});

test('★① 整体复位（sub_40DF10 raw 17961）也把 scriptEngineFlag 置回 1', async () => {
  const e = mkEngine([]);
  const run = opRunner(e);
  run(0x142, [im(0)]); // 先弄脏
  assert.equal(e.engineValues.get(ENGINE_FIELD.scriptEngineFlag), 0, '前置：已被 0x142 改成 0');
  // `exit-script`（0x9）= 引擎 `sub_428A60`（释放 40 帧 + 清内存池 + `sub_40DF10` + 重载根脚本）。
  // 没有 fileSource ⇒ 复位做完后在重载根脚本那一步抛 `ExitScript`（这是 product 语义：
  // 根脚本缺失 = 程序退出）。复位发生在那之前，所以这里能观察到 raw 17961 的效果。
  e.fileSource = { readScript: async () => null } as unknown as FileSource;
  // 顺手钉同一段的另一格：`raw 17973` 把逐字泵的闩锁 `Engine[388212]`（= `_this[97053]`）清 0
  e.engineValues.set(97053, 1);
  await assert.rejects(
    async () => {
      await run(0x9);
    },
    (err: unknown) => err instanceof ExitScript,
    '没有根脚本 ⇒ 抛 ExitScript（引擎 = Command_Exit）',
  );
  assert.equal(e.engineValues.get(97053), 0, '★raw 17973：整体复位把逐字泵闩锁清 0（构造 raw 22604 同形）');
  assert.equal(
    e.engineValues.get(ENGINE_FIELD.scriptEngineFlag),
    1,
    '★raw 17961 `*(_DWORD *)(_this + 699248) = 1;` ⇒ 整体复位必须种回 1',
  );
});

/**
 * 造一帧「重显示模式下收到输入」的现场。
 *
 * ★`dwordToInstr` 必须手工给：引擎的备用回退游标是 **dword 偏移**（`0x7B` 的 op2），
 * 而 `test/harness.ts` 的 `scriptDerived()` 给的是空表（合成脚本没有 `raw` 可反推）。
 * 这里三条指令都是 argc 0（1 dword/条）⇒ 偏移 0/1/2 与数组下标同值。
 */
function redisplayScene(): ReturnType<typeof mkEngine> {
  const e = mkEngine([instr(0x6e, []), instr(0x6e, []), instr(0x6e, [])], 'REDISPLAY.BIN');
  const f = e.curScript();
  f.script!.dwordToInstr = [0, 1, 2];
  for (const [i, ins] of f.script!.instructions.entries()) ins.index = i; // 1 dword/条 ⇒ index = dword 偏移
  return e;
}

test('★⑬ 主循环 0x4000000 臂（raw 20859-20881）：输入 ⇒ 退出重显示 + 写三格 + ip 回退到**备用**游标', () => {
  const e = redisplayScene();
  const f = e.curScript();
  f.ip = 1; // 停在中间那条：`redisplayReturn` 应当记下它（raw 20874 的 `sub_4051E0` = (ip-ip_base)>>2）
  e.engineValues.set(ENGINE_FIELD.rewindAltBase + e.cur, 2); // `0x7B` 的 op2（raw 28731）
  const savedFlags = (REDISPLAY_MODE | 0x8) | 0;
  e.effectFlags = savedFlags;
  e.input.pressMouse(0); // 一帧里有"新按下事件"（消费刷 raw 20862 才吃得到）

  assert.equal(e.serviceRedisplayExit(), true, '★raw 20863：有输入 ⇒ 本臂处理');
  assert.equal(f.ip, 2, '★raw 20877：`frame.ip = ip_base + 4 * 备用游标`（= 第 3 条）');
  assert.equal(e.effectFlags, 0, '★raw 20873：`_this[174801] = 0`（清**整个** effect_flags）');
  assert.equal(
    e.engineValues.get(ENGINE_FIELD.redisplayMode),
    (0x8 | 0x2000000) | 0,
    '★raw 20870-20872：模式字 = （已清 0x4000000 的）旧 flags | **0x2000000**',
  );
  assert.equal(
    e.engineValues.get(ENGINE_FIELD.redisplayScriptId),
    f.scriptId,
    '★raw 20876：`Engine[430712] = frame[95796]`（与 0x199/右键取消同一格）',
  );
  assert.equal(
    e.engineValues.get(ENGINE_FIELD.redisplayReturn),
    1,
    '★raw 20874：`sub_4051E0` = (ip − ip_base) >> 2 = **当前指令的 dword 偏移**（不是 +1）',
  );
  assert.equal(e.input.inputMask, 0, '★raw 20865：掩码格 `Engine[699208] = 0`');
  assert.equal(e.input.hasPending(), false, '★raw 20862 是**消费刷**（读后即清）⇒ 这次输入不再留给等待泵');
});

test('★⑬ 三条负对照：门未置 / 无输入 / 备用游标为 -1 —— 各自与 raw 20860/20863/20868 同形', () => {
  // ① raw 20860：不在重显示模式 ⇒ 本臂不跑（连输入都不消费）
  const a = redisplayScene();
  a.effectFlags = 0x8;
  a.input.pressMouse(0);
  assert.equal(a.serviceRedisplayExit(), false, 'raw 20860：`(flags & 0x4000000) == 0` ⇒ 不跑');
  assert.equal(
    a.engineValues.get(ENGINE_FIELD.redisplayMode),
    undefined,
    '★门未置时三格一个都不写（raw 20870-20876 在门内）',
  );
  assert.equal(a.input.hasPending(), true, '★而且**不消费**输入（消费刷在 20862，门内）');

  // ② raw 20863：这一帧没有输入 ⇒ 什么都不做
  const b = redisplayScene();
  b.effectFlags = REDISPLAY_MODE;
  b.input.consumeEdges();
  assert.equal(b.serviceRedisplayExit(), false, 'raw 20863：掩码为 0 ⇒ 不处理');
  assert.equal(b.effectFlags & REDISPLAY_MODE, REDISPLAY_MODE, '模式位保持');

  // ③ raw 20868：备用游标 = -1 ⇒ 只清门/掩码，不改 ip、不写三格
  const c = redisplayScene();
  const cf = c.curScript();
  cf.ip = 1;
  c.engineValues.set(ENGINE_FIELD.rewindAltBase + c.cur, -1);
  c.effectFlags = REDISPLAY_MODE | 0x8;
  c.input.pressMouse(0);
  assert.equal(c.serviceRedisplayExit(), false, 'raw 20868：`备用游标 == -1` ⇒ 不改控制流');
  assert.equal(cf.ip, 1, '★ip 不动');
  assert.equal(c.effectFlags & REDISPLAY_MODE, 0, '★但 raw 20866 已经清了模式位（门与输入都已消费）');
  assert.equal(
    c.engineValues.get(ENGINE_FIELD.redisplayMode),
    undefined,
    '★三格仍不写（它们在 raw 20870 之后）',
  );
});

test('★⑬ 帧驱动接线：`runFrameLoop` 每帧开头都会跑这一臂（引擎里它在字格泵之前）', async () => {
  const e = redisplayScene();
  e.engineValues.set(ENGINE_FIELD.rewindAltBase + e.cur, 2);
  e.effectFlags = REDISPLAY_MODE;
  e.input.pressMouse(0);
  const host: FrameHost = { now: () => 0 };
  const r = await runFrameLoop(e, host, {
    gates: { anim: 'ignore', sleep: 'wait', advance: 'ignore', stage: 'ignore' },
    services: { winReveal: false, charGrid: false },
    present: 'never',
    maxStepsPerFrame: 0, // 本用例只验帧首那一臂 ⇒ 不派发指令（合成脚本没有真操作数）
    maxFrames: 1,
  });
  assert.equal(r.frames, 1, '前置：真的跑了一帧');
  assert.equal(
    e.lastDispatch?.kind,
    'redisplay-exit',
    '★帧首调用 `serviceRedisplayExit()`（引擎 raw 20859-20881 在帧的最前段）',
  );
  assert.equal(e.engineValues.get(ENGINE_FIELD.redisplayScriptId), e.curScript().scriptId, '三格已写');
});
