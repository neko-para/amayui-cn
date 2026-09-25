/** @tier T0 @kind core @subsystem vm */
/**
 * **帧 / 指令计时器的守卫**（`tickets/T-0180`）。
 *
 * 为什么值得单独守（而不是"跑一次看看"）：
 *  - 它是**诊断工具**：报错了不会让游戏崩，只会让人**看错方向**（比崩更贵）。
 *    本工程已经有过多起"结论与真因不符"的事故，而这次的起因（存档页切换 ~4s 阻塞）
 *    正是"读代码读不出来"的那类 —— 计时器本身必须可信。
 *  - 最容易悄悄坏掉的两处：① 关了之后**不零成本**（`beginOp` 每次都取时钟）；
 *    ② 帧看门狗把"主线程被占住"与"宿主没给帧"混成一句 —— 而这两种的修法完全不同。
 *
 * 本文件只测**计时器自己的语义**（注入时钟 ⇒ 断言确定性）；"接线真的接上了"由下面的源码棘轮钉。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Profiler, MAX_SLOW_FRAMES, opName } from '../src/vm/profile.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EMU = path.resolve(HERE, '..');

/** 造一个被测试捏着时钟的计时器。 */
function harness(): { p: Profiler; at: (ms: number) => void; logs: string[] } {
  const p = new Profiler();
  let t = 1000;
  p.setClock(() => t);
  const logs: string[] = [];
  p.attachLog((m) => logs.push(m));
  return { p, at: (ms: number) => (t = ms), logs };
}

test('★关闭时指令计时必须**零成本**：`beginOp()` 直接返回 0（不取时钟）', () => {
  const p = new Profiler();
  let calls = 0;
  p.setClock(() => {
    calls++;
    return 1234;
  });
  assert.equal(p.beginOp(), 0, '关着时 `beginOp` 必须返回 0（哨兵值 = 未计时）');
  assert.equal(calls, 0, '关着时**一次时钟都不许取**');
  p.endOp(0x1a0, 'slot-read-header', 0);
  assert.deepEqual(p.opStats(), [], '`endOp(…, 0)` 不该记任何东西');

  p.setOpEnabled(true);
  assert.notEqual(p.beginOp(), 0, '开了之后才返回起始时刻');
  assert.equal(calls, 1, '开了之后才取时钟');
});

test('★按 opcode 记账：次数 / 合计 / 最坏一次都对，报告按合计降序', () => {
  const { p, at } = harness();
  p.setOpEnabled(true);

  /** 跑"一条指令"：`at(start)` 定起点，`at(start+ms)` 定终点。 */
  const once = (op: number, name: string, ms: number, startMs: number): void => {
    at(startMs);
    const t0 = p.beginOp();
    at(startMs + ms);
    p.endOp(op, name, t0);
  };
  once(0x1af, 'slot-thumb-read', 3, 2000);
  once(0x1af, 'slot-thumb-read', 7, 3000);
  once(0x1a0, 'slot-read-header', 1, 4000);

  const stats = p.opStats();
  assert.equal(stats.length, 2);
  assert.equal(stats[0]!.op, 0x1af, '合计大的排前面');
  assert.equal(stats[0]!.name, 'slot-thumb-read');
  assert.equal(stats[0]!.count, 2);
  assert.equal(stats[0]!.totalMs, 10);
  assert.equal(stats[0]!.maxMs, 7, '最坏一次 = 7ms');
  assert.equal(stats[1]!.op, 0x1a0);

  const lines = p.report(1).join('\n');
  assert.match(lines, /0x1af/, '报告里要有 opcode');
  assert.match(lines, /合计ms/, '报告要有表头');
  assert.match(lines, /指令计时=\*\*开\*\*/, '报告要自报开关状态');
  assert.match(p.report(1000).join('\n'), /没有累计 ≥ 1000ms 的指令/, 'minMs 要真的过滤');
});

test('★帧看门狗：**占住主线程**与**宿主没给帧**必须分开报（两者的修法不同）', () => {
  const { p, at, logs } = harness();
  p.setSlowThresholdMs(200);

  // ① 工作耗时长（主线程被占住）
  at(10_000);
  p.beginFrame(0);
  at(14_200); // 干了 4.2s
  const slow = p.endFrame(7, 812);
  assert.ok(slow, '超阈值必须返回记录');
  assert.equal(slow!.workMs, 4200);
  assert.equal(slow!.steps, 812);
  assert.match(logs.at(-1)!, /占住主线程\*\* 4200ms/, '工作耗时长的那句要明确是"占住主线程"');

  // ② 间隔长但工作短（宿主没给帧）—— 同一帧长必须报成另一句
  at(20_000);
  p.beginFrame(812);
  at(20_003); // 只干了 3ms
  const slow2 = p.endFrame(8, 812);
  assert.ok(slow2, '间隔超阈值同样要记');
  assert.equal(slow2!.workMs, 3);
  assert.equal(slow2!.gapMs, 20_000 - 14_200, '间隔 = 本次帧首 − 上次帧末');
  assert.match(logs.at(-1)!, /宿主没给帧/, '间隔长 ≠ 我们算得慢，措辞必须区分开');

  // ③ 都不超阈值 ⇒ 不记、不打日志（★间隔也要小：帧首紧接上一帧末，像真跑 60fps 那样）
  const before = logs.length;
  at(20_020);
  p.beginFrame(812);
  at(20_030);
  assert.equal(p.endFrame(9, 812), null, '正常帧不该进慢帧表');
  assert.equal(logs.length, before, '正常帧不该刷日志');
});

test('★慢帧明细有上限（长卡顿不许把内存/日志刷爆），但总数照记', () => {
  const { p, at } = harness();
  p.setSlowThresholdMs(10);
  for (let i = 0; i < MAX_SLOW_FRAMES + 5; i++) {
    at(100_000 + i * 1000);
    p.beginFrame(0);
    at(100_000 + i * 1000 + 50);
    p.endFrame(i, 0);
  }
  assert.equal(p.slowFrames().length, MAX_SLOW_FRAMES, '明细留 MAX_SLOW_FRAMES 条');
  assert.equal(p.slowCount, MAX_SLOW_FRAMES + 5, '总数仍要数全');
  assert.match(p.report().join('\n'), new RegExp(`慢帧 ${MAX_SLOW_FRAMES + 5} 次`), '报告里要看得见被截断的总数');
});

test('★每帧最慢指令：只在指令计时开着时才有，且**只算本帧**（不串帧）', () => {
  const { p, at } = harness();
  p.setOpEnabled(true);
  p.setSlowThresholdMs(10);

  const once = (op: number, name: string, ms: number, startMs: number): void => {
    at(startMs);
    const t0 = p.beginOp();
    at(startMs + ms);
    p.endOp(op, name, t0);
  };

  at(50_000);
  p.beginFrame(0);
  once(0x1a0, 'slot-read-header', 5, 50_001);
  once(0x1af, 'slot-thumb-read', 30, 50_010);
  at(50_050);
  const f1 = p.endFrame(1, 2);
  assert.ok(f1);
  assert.equal(f1!.top[0]!.op, 0x1af, '本帧最慢的排第一');
  assert.equal(f1!.top[0]!.ms, 30);
  assert.equal(f1!.top[0]!.count, 1);

  // 下一帧：上一帧的累计不许混进来
  at(60_000);
  p.beginFrame(2);
  at(60_050); // 本帧没有指令
  const f2 = p.endFrame(2, 2);
  assert.ok(f2);
  assert.deepEqual(f2!.top, [], '本帧没跑指令 ⇒ 本帧的 top 必须是空的（不许把上一帧的算进来）');

  // 全局统计仍然累计两条
  assert.equal(p.opStats().length, 2);
});

test('★源码棘轮：`stepOnce` 真的包了 handler、帧看门狗真的在 `yield()` **之前**收尾', () => {
  const interp = fs.readFileSync(path.join(EMU, 'src', 'vm', 'interpreter.ts'), 'utf8');
  assert.match(interp, /const t0 = profiler\.beginOp\(\);/, '`stepOnce` 要开始计时');
  assert.match(interp, /await handler\(ctx\);\s*\n\s*profiler\.endOp\(op, instr\.name, t0\);/, '`endOp` 必须紧跟在 handler 之后（否则量到的是别的东西）');

  const loop = fs.readFileSync(path.join(EMU, 'src', 'frame', 'loop.ts'), 'utf8');
  assert.match(loop, /profiler\.beginFrame\(steps\)/, '帧首要开账');
  // ★次序是判据本身：`yield()` 之后是"等下一帧"，把它算进"工作耗时"就分不出"谁慢"
  assert.match(
    loop,
    /profiler\.endFrame\(frames - 1, steps\);\s*\n\s*await host\.yield\?\.\(\);/,
    '`endFrame` 必须在 `await host.yield()` **之前**',
  );

  const cmd = fs.readFileSync(path.join(EMU, 'src', 'vm', 'debugCommand.ts'), 'utf8');
  assert.match(cmd, /if \(cmd === 'profile'\)/, '命令表要认识 `profile`（单一真源：渲染窗与控制面板共用它）');
  assert.match(cmd, /profile \[子命令\]/, '帮助文本要列出它（否则没人知道有这个东西）');

  const sess = fs.readFileSync(path.join(EMU, 'src', 'renderer', 'app', 'session.ts'), 'utf8');
  assert.match(sess, /case 'profile'/, '渲染窗要真的派发它');
});

test('`opName` 用十六进制（日志里比十进制好认）', () => {
  assert.equal(opName(0x1af), '0x1af');
  assert.equal(opName(0), '0x0');
});
