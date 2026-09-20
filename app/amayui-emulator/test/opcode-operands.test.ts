/**
 * **操作数口径核验**（`tickets/T-0082` RF-A 的第一步，审计 `docs-new/03-engine/audit-2026-09-opcodes.md`）。
 *
 * 审计查出的 13 处「操作数类型/顺序/多写少写」错误里，有一类可以被**机械**发现：
 * handler 只碰了 `argc` 声明的一部分操作数（少读/少写 ⇒ 脚本那一格永远是旧值），或者碰了越界的下标。
 * 引擎每条 handler 体都会写 arity 槽（`_this[30*cur+95805] = 2*argc+1`），所以「读几位」在引擎侧是有据的；
 * emulator 侧此前没有任何东西对照它 —— 本守卫用 `args` 的 Proxy 记录 handler 到底碰了哪几格。
 *
 * 判据（`scripts/asm/opcodes.json` 的 `argc` = 文档/引擎一致口径）：
 *  - **越界**：碰了 `> argc` 的下标 ⇒ 直接失败（脚本里那一格不存在）；
 *  - **漏读**：1..argc 里有的格子一次也没被碰 ⇒ 记入 `ALLOW_UNDERRUN`（每条必须写清原因 + 票），
 *    否则失败（新增漏读即红）。★这正是 `0x34B`（丢 op4..op6）、`0x1F9`（丢 op3）、`0x20F`（丢 op2/op3）这三条
 *    审计结论的机械形态 —— 其中 `0x20F` 已按体修复（`tickets/T-0077`）、`0x1F9` 已按体补 op3 颜色参
 *    （raw 31225-31232；理由见 `handlers/gfx-texture.ts`），它们的白名单条目删除后测试依然绿，
 *    就是"修好了"的机械证明。
 *
 * ★**白名单里混着两类，别再混为一谈**（2026-09 逐条核体后拆分）：
 *  - 「确认是 bug，按票排期」：体证实引擎确实消费那一格而 emulator 没做 ⇒ 待修（如 `0x34B`）；
 *  - 「有据豁免」：体证实**引擎也不消费那一格**（被调函数形参未出现）、或**缺消费端**（emulator 无
 *    对应模型可写）⇒ 不是待修 bug，理由必须带 raw 行号证据（`0x1D3`/`0x1D4`/`0x2F3`/`0x33F`；
 *    判据与守卫见 `test/op-underun-fixups.test.ts`）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { StubNative } from '../src/vm/native.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import type { BinArg, BinInstruction, ScriptBinary } from '../src/script/bin.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', '..');

/**
 * 已知「漏读」白名单：**只允许存量**，新增即红。
 * 每条都要写清「体里其实读了几格 / 为什么暂时不补 / 票」。
 */
const ALLOW_UNDERRUN: Record<string, string> = {
  // ---- 已登记为 no-op / engine-internal（见 analysis/opcode-gaps.json；它们本就不读操作数）----
  '0x10c': 'engine-internal no-op（有据跳过 —— 体写 VK→掩码位表 `Input[1176+VK]`（op2 经键码表 `Input[1432+键码]`），但 emulator 无键码表/VK→位表、宿主键盘也不进掩码 ⇒ 写入无消费者；T-0052 落地后必须转真实现）',
  '0x137': 'engine-internal no-op（ResetStack；int 栈家族语料 1 处、无压栈 ⇒ 观测等价）',
  '0x2fa': 'engine-internal no-op（只写无人读的 Engine[1951]）',
  '0x308': 'STUB_NATIVE_OPS 的 unhandled 桩（op1/Engine[1954] 未建模；见 stubs.ts 注释）',
  '0x30a': 'engine-internal no-op（键位注册；emulator 无按键表）',
  '0x325': 'engine-internal no-op（有据：体写 Effect3D 管理器 [+0x4D8]/[+0x4DC] 的销毁判据，emulator 无 Effect3D 子系统）',
  '0x326': 'engine-internal no-op；体建 ID3DXEffect 并重建 Snow（3D 子系统缺口 ⇒ T-0076）',
  '0x1a7': '`comment`：引擎体就是 nop（dev 注释）',
  // ---- 合成指令下的"提前返回"（不是漏读：真实脚本路径带真实上下文）----
  '0x2fc': '引擎语义如此：无触点路径只写 op1 后立即 return（op2..op5 保持不动；raw 40798-40799）—— emulator 恒无触点',
  '0x19e': 'save-slot 族：合成指令里没有 fileSource/slot 数据 ⇒ 提前返回（真实路径读 op1..）',
  '0x19f': '同上（短读）',
  '0x1a0': '同上（读槽头）',
  '0x1a1': '同上（读档）',
  '0x1ab': '同上（删档）',
  '0x1ac': '同上（复制档）',
  '0x1ae': '同上（写 .STH）',
  '0x1af': '同上（读 .STH 校验）',
  '0x1c9': '音频设备初始化：合成指令里 native 未建模 ⇒ 提前返回',
  '0xc7': 'config 读取带 selector：合成指令给的 selector=0 非法 ⇒ 按 onBadSelector:skip 不写 op2（引擎同）',
  '0x228': '项不存在 ⇒ 走引擎的失败分支（只写 op1=1，不写 op3/4/5）—— 真实路径项存在时三者都写',
  // ---- 确认是 bug，按票排期（修完请从这里删掉，测试会自动要求它通过）----
  '0x12e': '悬停命中：审计 P2 `op-8-F3/F4`（遍历 count 个矩形、op2 未按体读）⇒ T-0077',
  // ---- 核体后判定为「引擎也不消费该格」的有据豁免（不是待修 bug）----
  // ★`0x1D3`/`0x1D4`/`0x2F3` 的共同事实：`sub_457960`/`sub_457A20` 的**第 3 形参 `a3` 在函数体里
  //   一次都没出现**（raw 69328-69364 / 69366-69406，逐字核过：`sub_457A20` 只写 `*a2/*a3/*a4` = 其
  //   第 2/3/4 形参，即输出指针）⇒ 调用方那三次 `sub_41BF50(_this, 3)` 是**声明偏大的死读**，
  //   引擎读了也不用。emulator 不读它 = 与引擎**可观测行为一致**；补一个只读不用的 `readIntOperand`
  //   是死读（纪律禁止的"只写不读"的镜像），故按「有据豁免」保留。
  '0x1d3': '引擎体的 arg[3] 是死读：sub_42D4A0 raw 38124 读 op3 ⇒ 传 sub_457960 第 3 形参 a3（raw 38125），该形参在 69328-69364 全函数体未出现 ⇒ 引擎不消费；op4=起始下标 / op5=key',
  '0x1d4': '引擎体的 arg[3] 是死读：sub_42D510 raw 38141 读 op3 ⇒ 传 sub_457A20 第 3 形参 a5（raw 38142），该形参在 69366-69406 全函数体未出现 ⇒ 引擎不消费；op4=起始下标（选择器恒 0）',
  '0x2f3': '引擎体的 arg[4] 是死读：sub_431A10 raw 40736 读 op4 ⇒ 传 sub_457A20 第 3 形参 a5（raw 40737），该形参在 69366-69406 全函数体未出现 ⇒ 引擎不消费；op5=起始下标 / op6=选择器',
  '0x33f': '★核体后有据豁免（缺消费端，不是"未定论"）：sub_427A90 raw 34423-34446 **三格全读**——op2=α（>255 钳 255；<0 ⇒ 由 op1 索取的绘制项当前 α，raw 34430 sub_4ADD60 读 DrawItem+96）、op3=颜色（<0 ⇒ 该项当前色，raw 34440）→ 写 `Scene+1264`，由效果通路 raw 65904-65907 下发成 shader 混合常量。emulator **没有绘制项 `Item.+96` 当前 α/当前色模型、也没有 Scene+1264 的效果常量通路** ⇒ 无处安放该值（写个只写不读的字段即死写）⇒ 缺消费端，回链 T-0017（混合模式/效果通路票）',
  '0x347': 'Live2D 节点指令：op3/op4 未读 ⇒ 审计 P2 已列（与 0x34B 同族）⇒ T-0077',
  '0x348': '★审计 P2：`0x348` 实为轴角旋转（轴 +464/468/472、角 +488），emulator 只碰 1/2 ⇒ T-0077',
  '0x34b': '★审计 P2/P1：`0x34B` 把 op2 当缩放百分数、丢 op4..op6 ⇒ T-0077',
};

/**
 * 合成指令（全 int 本地槽）无法覆盖的 opcode：**必须逐条写明原因**，而不是静默跳过。
 * 这些指令依赖操作数类型（指针/字面数组/label）或依赖运行时状态（除零、程序退出、模块加载）。
 */
const EXPECTED_THROW: Record<string, string> = {
  '0x1': '程序退出（引擎 `_CxxThrowException(&1, Command_Exit)`）',
  '0x53': '除数为 0 ⇒ 引擎抛除零异常（合成指令里除数是 0）',
  '0x54': '模数为 0 ⇒ 同 0x53',
  '0x60': 'random 模数为 0 ⇒ 同 0x53',
  '0x61': '需要**指针型**目标操作数（合成指令给的是 int 本地槽）',
  '0x63': '同 0x61（需要指针型）',
  '0x12c': '同 0x61（需要指针型）',
  '0x64': 'copy-local-array 需要字面数组数据（脚本携带的 dataArray）',
  '0x8c': 'jmp 需要有效 label（合成指令的 label 为 0）',
  '0x8f': 'call 需要有效 label',
  '0xa0': 'jcc 需要有效 label',
  '0x14b': 'AGERC 模块加载：只接受 id=0x5250（AGERC.DLL）',
  '0x7c': 'local-ret（重显示返回端）：要求 redisplayMode 的 0x2000000 位置位（合成指令没有上下文 ⇒ 引擎同样抛 aEnd.hwl）',
  '0x14c': 'AGERC 导出绑定：需要先加载模块（合成指令里模块未加载）',
  '0x14d': 'AGERC 槽调用：需要先绑定导出',
  '0x192': '需要**字符串型**目标操作数（合成指令给的是 int 本地槽）',
  '0x193': '同 0x192（需要字符串型）',
  '0x1a9': '需要字符串下标操作数（合成指令给的是 int 本地槽）',
  '0x1aa': '同 0x1a9',
  '0x2c7': '同 0x192（需要字符串型）',
  '0x2c8': '同 0x192（需要字符串型）',
  '0x2c9': '需要**指针型**目标操作数（同 0x61）',
  '0x2dd': '同 0x192（需要字符串型）',
  '0x2eb': '同 0x192（需要字符串型）',
  // ★B3（`tickets/T-0076`）新注册的两条字符串族：合成指令给不出字符串型操作数（`0x1B2` 读 op1 字符串、
  //   `0x1C8` 写 op1 字符串）⇒ 与 0x192/0x1A9 同因；语义与守卫见 `test/op-1b2-text-buffer.test.ts`。
  '0x1b2': '需要**字符串型**源操作数（同 0x192）',
  '0x1c8': '需要**字符串型**目标操作数（同 0x192）',
};

// 合成指令会触发 async 路径（`exit`/`exit-script` 的脚本退出信号、模块加载等）。本测试只关心操作数口径，
// 这些 promise 的结局与被测断言无关 ⇒ 显式吞掉，避免 node:test 报"asynchronous activity after the test ended"。
process.on('unhandledRejection', () => {});

interface Row {
  op: number;
  argc: number;
  touched: number[];
  kind: string;
}

function runOne(op: number, argc: number, native: StubNative): Row {
  const e = new Engine(native, new InputManager());
  // 让 async 类 handler（call-script / load-frame / exit）不产生 unhandledRejection：给一个"永远 pending"的 FileSource
  (e as unknown as { fileSource: unknown }).fileSource = new Proxy(
    {},
    { get: () => () => new Promise(() => {}) },
  );
  const f = e.curScript();
  const touched = new Set<number>();
  const realArgs: BinArg[] = [];
  for (let i = 0; i < argc; i++) realArgs.push({ type: 0x9, raw: 0x40 + i } as unknown as BinArg);
  const args = new Proxy(realArgs, {
    get(t, p, r) {
      if (typeof p === 'string' && /^\d+$/.test(p)) touched.add(Number(p) + 1); // 1-based
      return Reflect.get(t, p, r);
    },
  });
  const instr: BinInstruction = {
    opcode: op,
    name: `i${op.toString(16)}`,
    argc,
    args,
    byteOffset: 0,
    index: 0,
  } as unknown as BinInstruction;
  const sc: ScriptBinary = {
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
    instructions: [instr],
    labelTargets: new Set<number>(),
    raw: new Uint8Array(0),
  };
  // 直接塞进帧里（不经过 loadScriptIntoFrame 的校验：有些 opcode 的 argc 与实际读法不一致，正是要测的）
  (f as unknown as { script: ScriptBinary }).script = sc;
  const h = OPS.get(op) ?? NATIVE_OPS.get(op) ?? ENGINE_INTERNAL_OPS.get(op);
  assert.ok(h, `0x${op.toString(16)} 未注册`);
  const ret = h!(makeCtx(e, f, instr, native, () => {})) as unknown as Promise<unknown> | undefined;
  // async 类 handler（exit / exit-script / 模块加载）会返回 promise：等它结算并吞掉结局，
  // 否则 node:test 会把它记成"测试结束后的异步活动"而判定整文件失败（与本测试的断言无关）。
  if (ret && typeof (ret as { then?: unknown }).then === 'function') void ret.catch(() => {});
  return { op, argc, touched: [...touched].sort((a, b) => a - b), kind: 'ran' };
}

test('★操作数口径：每个已注册 opcode 不得碰越界操作数，且 1..argc 全被碰（漏读需在白名单里说明）', () => {
  const ops = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/asm/opcodes.json'), 'utf8')) as {
    opcode: number;
    argc: number;
  }[];
  const overrun: string[] = [];
  const underrun: string[] = [];
  const crashed: string[] = [];
  let checked = 0;

  for (const o of ops) {
    const op = o.opcode;
    const argc = o.argc;
    if (!OPS.has(op) && !NATIVE_OPS.has(op) && !ENGINE_INTERNAL_OPS.has(op)) continue;
    if (argc === 0) {
      // argc=0：只验证"不碰任何操作数"
      try {
        const r = runOne(op, 0, new StubNative(() => {}));
        if (r.touched.length) overrun.push(`0x${op.toString(16)} argc=0 但碰了 ${r.touched.join(',')}`);
      } catch (err) {
        const key = `0x${op.toString(16)}`;
        if (!EXPECTED_THROW[key]) crashed.push(`${key}(argc=0)：${(err as Error).message.slice(0, 80)}`);
      }
      checked++;
      continue;
    }
    try {
      const r = runOne(op, argc, new StubNative(() => {}));
      checked++;
      const beyond = r.touched.filter((n) => n > argc);
      if (beyond.length) overrun.push(`0x${op.toString(16)} argc=${argc} 但碰了 ${beyond.join(',')}`);
      const missing = [];
      for (let n = 1; n <= argc; n++) if (!r.touched.includes(n)) missing.push(n);
      if (missing.length) {
        const key = `0x${op.toString(16)}`;
        if (!ALLOW_UNDERRUN[key]) underrun.push(`${key} argc=${argc} 未碰 ${missing.join(',')}`);
      }
    } catch (err) {
      const key = `0x${op.toString(16)}`;
      if (!EXPECTED_THROW[key]) crashed.push(`${key}：${(err as Error).message.slice(0, 80)}`);
    }
  }

  // 崩溃/异常：先单独报（多为"依赖真实脚本上下文"的指令，需要逐条评估而不是静默跳过）
  assert.deepEqual(crashed, [], `handler 在合成指令上抛错（需逐条评估或加进 SKIP 并写明理由）：\n  ${crashed.join('\n  ')}`);
  assert.deepEqual(overrun, [], `越界读取操作数：\n  ${overrun.join('\n  ')}`);
  assert.deepEqual(underrun, [], `漏读操作数（不在白名单里）：\n  ${underrun.join('\n  ')}`);
  assert.ok(checked > 250, `核验覆盖数异常：${checked}`);
});
