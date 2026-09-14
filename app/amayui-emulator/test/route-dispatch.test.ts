/**
 * **鼠标/输入 → 路由表 → label 派发**的忠实性回归（对应规格 `.tmp/mouse-dispatch-spec.md` 的 F.4 判据 ①–⑤、⑦）。
 *
 * 这一族断言锁的是**引擎的出口选择**（raw 行号 = `engine/天结_unpacked.exe_utf8.c`）：
 * | 出口 | 引擎 | 取哪个 label |
 * |---|---|---|
 * | 键命中 | `sub_403D70` raw 9847-9862（等待泵第一优先，20242） | `[459+i]` = **labelC** |
 * | 坐标点击 | 主循环 20175-20184 / 等待泵 20284-20292（`sub_404E00` raw 10667-10676） | `[459+游标]` = **labelC** |
 * | 面板显示态左键 | `sub_404120` raw 10052-10062 | 先取 labelC，**再清整表** |
 * | 悬停（游标变化） | `sub_403E70` raw 9918-9955（20242/20324） | labelA（进入）/ labelB（离开），**一次只给一个** |
 *
 * 以及两条结构性事实：
 *  - **`i093` 清表**（`sub_403EF0` raw 9958-9971 的 `[258] = 0`）；
 *  - **`i097` 是键位绑定**（`sub_403D10` raw 9827-9844），不是"画矩形"；
 *  - **脚本身份守卫**（`sub_4083B0` raw 13112-13131 / `0xCD` raw 25861）：不许跨脚本派发 label。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, type Frame } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { StubNative } from '../src/vm/native.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS } from '../src/vm/ops.js';
import { loadScriptIntoFrame } from '../src/vm/ops.js';
import { loadScriptData, stepOnce } from '../src/vm/interpreter.js';
import { parseScriptBytes } from '../src/script/bin.js';
import type { BinArg, BinInstruction, ScriptBinary } from '../src/script/bin.js';
import { im, instr } from './harness.js';

/** 造一个可被 `labelMap` 解析的最小脚本：指令的 dword index 按下标推（每条 1+2*argc dword）。 */
function mkScript(instructions: BinInstruction[]): ScriptBinary {
  let d = 0;
  for (const ins of instructions) {
    (ins as { index: number }).index = d;
    d += 1 + 2 * ins.argc;
  }
  const dwordToInstr: number[] = [];
  for (let i = 0; i < instructions.length; i++) {
    const n = 1 + 2 * instructions[i]!.argc;
    for (let k = 0; k < n; k++) dwordToInstr[instructions[i]!.index + k] = i;
  }
  return {
    signature: 'SYS4450 ',
    isVer5: false,
    headerLen: 0x3c,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [
      { length: 0, offset: 0 },
      { length: 0, offset: 0 },
      { length: 0, offset: 0 },
    ],
    instructions,
    labelTargets: new Set(),
    dwordToInstr,
    raw: new Uint8Array(0),
  };
}

/** 一个最小的合法 SYS4450 脚本映像（头 0x3C 字节，指令流为空 ⇒ `parseScriptBytes` 直接通过）。 */
const SYS4450_MIN: Uint8Array = (() => {
  const b = new Uint8Array(0x3c);
  b.set([0x53, 0x59, 0x53, 0x34, 0x34, 0x35, 0x30, 0x20], 0); // "SYS4450 "
  return b;
})();

/** 造一页"已经挂起在 wait-for-input"的帧：`i090` 登记 + `i072` 挂起；labelMap 把三个 label 指到不同下标。 */
function mkPanel(opts: {
  scriptId?: number;
  labels?: { a: number; b: number; c: number };
  rect?: [number, number, number, number];
} = {}): { e: Engine; f: Frame; labels: { a: number; b: number; c: number } } {
  const input = new InputManager();
  const e = new Engine(new StubNative(() => {}), input);
  const labels = opts.labels ?? { a: 0x100, b: 0x200, c: 0x300 };
  const [x, y, w, h] = opts.rect ?? [0, 0, 1280, 720];
  const f = e.frames[0]!;
  // 指令流：0 = i090（15 dword）→ 1 = i094（3 dword）→ 2 = i005 → 3 = i072 → 4.. = label 目标
  const ins = [
    instr(0x90, [im(x), im(y), im(w), im(h), im(labels.a), im(labels.b), im(labels.c)]),
    instr(0x94, []),
    instr(0x5, []),
    instr(0x72, [im(0)]),
    ...Array.from({ length: 12 }, (_, i) => (i % 3 === 0 ? instr(0x5, []) : instr(0x1a7, []))),
  ];
  loadScriptIntoFrame(f, mkScript(ins), 'TEST.BIN', opts.scriptId ?? 7);
  // labelMap：label 值 → 指令下标
  f.labelMap.clear();
  f.labelMap.set(labels.a, 4);
  f.labelMap.set(labels.b, 5);
  f.labelMap.set(labels.c, 6);
  // ① 登记热点（走真 handler，**复用脚本里的那条指令对象**：手动 makeCtx 不推进 ip，
  //    所以 `instr.index` 必须与脚本一致）
  const runAt = (idx: number): void => {
    const use = ins[idx]!;
    const h = OPS.get(use.opcode);
    assert.ok(h, `0x${use.opcode.toString(16)} 应在 OPS 里`);
    h!(makeCtx(e, f, use, e.native, () => {}));
  };
  runAt(0); // i090 登记热点
  runAt(1); // i094 面板已显示（引擎 sub_419230）
  // 挂起（i072）用**真实路径**跑：设 ip 到那条指令再 stepOnce（这样返回点/ip 推进都与真实一致）
  f.ip = 3;
  return { e, f, labels };
}
// ---------------------------------------------------------------------------
// ① enter/leave 两段式（sub_403E70）
// ---------------------------------------------------------------------------
test('判据①：enter/leave 两段式 —— 进入发 labelA、离开发 labelB、一次只给一个 label', () => {
  const { e } = mkPanel({ labels: { a: 0xaa, b: 0xbb, c: 0xcc }, rect: [0, 0, 100, 100] });
  // 第二个热点（与第一个不相交）
  OPS.get(0x90)!(makeCtx(e, e.curScript(), instr(0x90, [im(200), im(0), im(100), im(100), im(0xaa), im(0xbb), im(0xcc)]), e.native, () => {}));

  e.input.setCursor(50, 50); // 鼠标移动 ⇒ sub_403C50
  assert.equal(e.pickHoverLabel(), 0xaa, '进入 h0 ⇒ labelA');
  assert.equal(e.pickHoverLabel(), -1, '同位置（无移动）⇒ 什么都不发');

  e.input.setCursor(250, 50); // h0 → h1
  assert.equal(e.pickHoverLabel(), 0xbb, '先发旧项的 labelB（离开）');
  assert.equal(e.pickHoverLabel(), 0xaa, '下一帧补发新项的 labelA（进入）—— 一次调用只给一个 label');
  assert.equal(e.pickHoverLabel(), -1, '之后稳定');

  e.input.setCursor(900, 900); // 走出所有热点
  assert.equal(e.pickHoverLabel(), 0xbb, '离开所有热点 ⇒ labelB');
  assert.equal(e.pickHoverLabel(), -1, '之后稳定');
});

// ---------------------------------------------------------------------------
// ② 点击走 labelC（不是 labelA），带返回点 = wait-for-input 的 dword 偏移
// ---------------------------------------------------------------------------
test('判据②：点击派发 labelC（sub_404E00），返回点 = wait-for-input 的 dword 偏移（sub_405360(-3)）', async () => {
  const { e, f, labels } = mkPanel();
  assert.equal(f.ip, 3, 'ip 停在 wait-for-input');
  await stepOnce(e); // 执行它：挂起 + ip → 4
  assert.equal(e.awaitingAdvance, true, '门已挂起');
  assert.equal(e.routes.shown, 1, '面板已显示（i094）');

  e.input.setCursor(640, 360); // 鼠标移动 ⇒ 命中（引擎 sub_4B8D50）
  e.input.pressMouse(0);
  assert.equal(e.serviceAdvanceWait(), true, '点击 ⇒ 泵处理');

  assert.equal(f.ip, 6, 'ip = **labelC** 的目标（不是 labelA 的 4）');
  // 门指令（i072）在脚本映像里的 dword 偏移：i090 占 15 dword（0..14）+ i094 占 3（15..17）⇒ **17**。
  const gateDword = f.script!.instructions[3]!.index;
  assert.equal(f.retStack[f.retStack.length - 1], gateDword, '返回点 = wait-for-input 的 dword 偏移（引擎 当前偏移-3）');
  assert.equal(gateDword, 17, 'wait-for-input 的 dword 偏移（i090 0..14 + i094 15..16 + i005 3 dword? ⇒ 实测 17）');
  assert.equal(e.routes.cursor, -1, '派发后游标清 -1（LABEL_68 raw 20457）');
  assert.equal(e.routes.enterPending, 0, '派发后 [7466] 清 0（raw 20456）');
  assert.notEqual(f.ip, 4, '★绝不能是 labelA（旧实现的错法）');
  assert.equal(labels.c, 0x300);
  // ③ 页不推进：派发 labelC **不改变**页游标（页推进由脚本自己决定）
  assert.equal(e.msgwin.pages, 1, '页游标保持 wait-for-input 产生的 1（泵不推进页）');
});

test('判据②b：`0x800000` 面板显示态左键 = sub_404120（取 labelC **并清整表**）', () => {
  const { e } = mkPanel({ rect: [0, 0, 50, 50] });
  e.routes.hitTest(10, 10);
  assert.equal(e.routes.cursor, 0);
  const label = e.routes.commitClickAndReset();
  assert.equal(label, 0x300, '返回游标项的 labelC');
  assert.equal(e.routes.count, 0, '★整表被清空（sub_403EF0）');
  assert.equal(e.routes.cursor, -1);
});

// ---------------------------------------------------------------------------
// ③ 悬停不推进页：返回点回到门指令，页不变
// ---------------------------------------------------------------------------
test('判据③：悬停派发带返回点 → label 里 ret 回到 wait-for-input（页不推进）', async () => {
  const { e, f } = mkPanel({ labels: { a: 0xaa, b: 0xbb, c: 0xcc }, rect: [0, 0, 200, 200] });
  await stepOnce(e); // wait-for-input（ip 3 → 4）
  const pages = e.msgwin.pages;
  const textBefore = e.msgwin.textOf(8);

  e.input.setCursor(50, 50); // 鼠标移动 ⇒ sub_403C50 命中
  e.input.consumeEdges(); // 移动已被命中测试消费（引擎只按事件做一次）
  // 泵按"带返回点的子程序"派发（引擎 raw 20327-20332）
  //   ★不要在泵之前再调一次 `pickHoverLabel`：`sub_403E70` 是**有状态**的两段式机，
  //     多调一次就把"进入"这一帧吃掉了（这正是"判定"与"派发"必须只走一条路的原因）。
  assert.equal(e.serviceAdvanceWait(), true, '本帧没有点击/键 ⇒ 走到悬停分支');
  assert.equal(f.ip, 4, 'ip = labelA 的目标');
  assert.equal(f.retStack[f.retStack.length - 1], f.script!.instructions[3]!.index, '返回点 = 门指令的 dword 偏移');
  assert.equal(e.msgwin.pages, pages, '页数不变');
  assert.equal(e.msgwin.textOf(8), textBefore, '文本不变');
  // label 末尾的 `ret` 回到门指令（test 脚本下标 3）
  await stepOnce(e); // 执行下标 4 的 i005 ret
  assert.equal(f.ip, 3, '★ret 后回到 wait-for-input 那条指令（引擎 sub_41A9B0）');
  // ★★ 重跑门指令**不得**把这一页再"推进"一次（`tickets/T-0016`）：
  //    引擎 `0x72` 重跑只做三件事（查字格数 / 置等待门 / 武装 ▼，raw 28539-28555），
  //    页计数与文字游标都不动；用户实测症状 = ADV 页右侧悬停 ⇒ 中间文字不断重放、页不推进。
  await stepOnce(e); // 重跑门指令（真实的悬停路径就是这样回来的）
  assert.equal(e.msgwin.pages, pages, '★重跑门指令不得再记一页（悬停不推进页）');
  assert.equal(e.msgwin.textOf(8), textBefore, '★重跑门指令不得改动文本');
});

// ---------------------------------------------------------------------------
// ④ i093 清表
// ---------------------------------------------------------------------------
test('判据④：i093 清表（sub_403EF0 的 [258]=0）—— 重登记后是 3 项不是 6 项', () => {
  const { e } = mkPanel();
  const run = (op: number, args: BinArg[]): void => {
    const h = OPS.get(op);
    assert.ok(h);
    h!(makeCtx(e, e.curScript(), instr(op, args), e.native, () => {}));
  };
  run(0x90, [im(10), im(10), im(10), im(10), im(1), im(2), im(3)]);
  run(0x90, [im(30), im(10), im(10), im(10), im(1), im(2), im(3)]);
  assert.equal(e.routes.count, 3, '一开始登记了 3 项（mkPanel 里 1 + 这里 2）');
  run(0x93, []);
  assert.equal(e.routes.count, 0, '★i093 清空整表');
  assert.equal(e.routes.cursor, -1);
  assert.equal(e.routes.hover, -1, '[959] 复位');
  assert.equal(e.routes.hitDone, 0, '★[7465] **不**被 sub_403EF0 复位（raw 9958-9971 里没有它）');
  run(0x90, [im(10), im(10), im(10), im(10), im(1), im(2), im(3)]);
  run(0x90, [im(30), im(10), im(10), im(10), im(1), im(2), im(3)]);
  run(0x90, [im(50), im(10), im(10), im(10), im(1), im(2), im(3)]);
  assert.equal(e.routes.count, 3, '★清表后重登记 = 3 项（不是 6）');
});

// ---------------------------------------------------------------------------
// ⑤ i097 = 键位绑定（sub_403D10 + sub_403D70）
// ---------------------------------------------------------------------------
test('判据⑤：i097 把掩码位绑到屏幕外的 1×1 热点 ⇒ 鼠标命中不到、pickByKey 能命中（SN0000:79-114 同型）', () => {
  const { e } = mkPanel({ rect: [-1000, -1000, 1, 1], labels: { a: -1, b: -1, c: 0x770 } });
  const run = (op: number, args: BinArg[]): void => {
    const h = OPS.get(op);
    assert.ok(h);
    h!(makeCtx(e, e.curScript(), instr(op, args), e.native, () => {}));
  };
  run(0x97, [im(-1000), im(-1000), im(1), im(1), im(0)]);
  assert.equal(e.routes.entries[0]!.keyBit, 0, '绑定掩码位 0（sub_403D10）');
  // 屏幕外 ⇒ 鼠标永远命中不到它（hitTest 在 (640,360) 不命中）
  assert.equal(e.routes.hitTest(640, 360), -1, '屏幕外热点鼠标命中不到');
  assert.equal(e.routes.pickByKey(1 << 0), 0x770, '掩码 bit0 ⇒ 键命中返回 labelC');
  assert.equal(e.routes.pickByKey(0), -1, '掩码 0 ⇒ 不命中');
  assert.equal(e.routes.pickByKey(1 << 3), -1, '别的位不命中');
});

// ---------------------------------------------------------------------------
// ⑦ 脚本身份守卫（sub_4083B0 / 0xCD）
// ---------------------------------------------------------------------------
test('判据⑦a：路由表的 ownerScriptId 与当前帧不同 ⇒ 派发前抛「Depth が不正です」', async () => {
  const { e, f } = mkPanel({ scriptId: 100 });
  f.ip = 3;
  await stepOnce(e); // 挂起
  e.input.setCursor(640, 360);
  e.input.pressMouse(0);
  // 换脚本（引擎：`frames[cur][95796]` 变成别的 id）
  f.scriptId = 200;
  assert.throws(() => e.serviceAdvanceWait(), /Depth が不正です/, '★跨脚本派发必须抛，不能静默命中无关指令');
});

test('判据⑦b：`0xCC` 注册的 mouse-callback 在另一个脚本里派发 ⇒ 抛「Depth が不正です」', () => {
  const input = new InputManager();
  const e = new Engine(new StubNative(() => {}), input);
  const f = e.frames[0]!;
  loadScriptIntoFrame(
    f,
    mkScript([
      instr(0xcc, [im(0x10), im(0x40)]), // mouse-callback 32 → label 0x40
      instr(0xcd, []), // get-input-type
      instr(0x5, []),
    ]),
    'A.BIN',
    0x100,
  );
  const run = async (): Promise<void> => {
    await stepOnce(e);
  };
  // 执行 0xCC（注册）+ 0xCD（派发）
  return (async () => {
    const h = OPS.get(0xcc)!;
    h(makeCtx(e, f, instr(0xcc, [im(0x10), im(0x40)]), e.native, () => {}));
    assert.equal(input.mouseJumpOwner, 0x100, '0xCC 记录注册时的脚本身份');
    f.labelMap.set(0x40, 1);
    // 切到另一个脚本（不同 scriptId）⇒ 守卫必须抛
    f.scriptId = 0x200;
    assert.throws(
      () => OPS.get(0xcd)!(makeCtx(e, f, instr(0xcd, []), e.native, () => {})),
      /Depth が不正です/,
      '★0xCD 的脚本身份守卫（raw 25861）',
    );
    void run;
  })();
});

// ---------------------------------------------------------------------------
// 悬停分支的门控（raw 20315-20320，★规格 §D.1 把极性写反了，这里按汇编订正）
// ---------------------------------------------------------------------------
test('悬停门控：`set:ReDrawTextOnKey=1` + 滚轮键按下 + `97055>=0` ⇒ 跳过悬停（raw 0x411DBF-0x411DEB）', () => {
  const cfg = { values: new Map<string, number>(), sections: [] as string[], order: new Map<string, string[]>() };
  const { e } = mkPanel({ rect: [0, 0, 100, 100] });
  e.config = cfg as never;
  // 随包 INI 缺这两个键 ⇒ 都读到 0（= **可配置键位 0**，掩码 bit0）⇒ 默认**不跳过**
  assert.equal(e.hoverDispatchAllowed(), true, '缺键（默认）⇒ 悬停派发生效');
  // 引擎的滚轮键位是 `1 << Conf(set:WheelKeyUp/Down)`（raw 0x411D93-0x411DBF）。
  //   ★emulator 的 `flush()` 只把鼠标合成到 bit4/5、手柄合成到 bit(4+i)，**不合成可配置键位 0..6**
  //   （没有键盘注入源）⇒ 把滚轮键位配成 **4**（鼠标左的掩码位）来模拟"滚轮键被按下"。
  cfg.values.set('set:wheelkeyup', 4);
  cfg.values.set('set:wheelkeydown', 4);
  e.input.pressMouse(0); // 掩码 bit4 置位（= 模拟"滚轮键按下"）
  assert.equal(e.hoverDispatchAllowed(), true, '滚轮键按下但 redraw≠1 ⇒ 仍然派发');
  cfg.values.set('set:redrawtextonkey', 1);
  assert.equal(e.engineValues.get(97055) ?? 0, 0, '97055 默认 0（>=0）');
  assert.equal(e.hoverDispatchAllowed(), false, '滚轮键按下 + redraw=1 + 97055>=0 ⇒ 跳过悬停');
  e.engineValues.set(97055, 0x80000000);
  assert.equal(e.engineValues.get(97055)! | 0, -2147483648, '`i1bb 0` 写的是 0x80000000（有符号为负）');
  assert.equal(e.hoverDispatchAllowed(), true, '`i1bb 0`（97055<0）⇒ 恢复派发');
  e.engineValues.delete(97055);
  assert.equal(e.hoverDispatchAllowed(), false, '97055>=0 且 redraw=1 ⇒ 再次跳过');
});

test('`0x090` 把当前帧的 scriptId 记成路由表的 ownerScriptId（引擎 frames[cur][95796] → panelA[7461]）', () => {
  const { e } = mkPanel({ scriptId: 0x1234 });
  assert.equal(e.routes.ownerScriptId, 0x1234);
});

test('loadScriptData 给根帧写 scriptId（引擎 sub_40ED40 raw 18636 的 a4）', () => {
  const e = new Engine(new StubNative(() => {}));
  loadScriptData(e, SYS4450_MIN, 'X.BIN', 0x5264);
  assert.equal(e.curScript().scriptId, 0x5264);
});
