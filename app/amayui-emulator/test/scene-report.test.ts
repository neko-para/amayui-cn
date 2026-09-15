/**
 * **场景执行报告 + 快照回归**的测试。
 *
 * 两件要锁死的事：
 *  1. **确定性**：同一条脚本跑两次，JSONL 与快照**逐字节一致**（否则"快照进仓库做 diff"就不成立）。
 *     做法是报告用自己的**虚拟时钟**（每遇到帧指令推进固定 ms），不依赖 `performance.now()`。
 *  2. **能看见缺口**：报告必须给出「能力缺口 / 意图被丢弃 / headless 语义缺口」三张清单 ——
 *     它们是"隐性能力缺失"的可数证据（本工具第一次跑就查出了"缺失即建项"这个真 bug）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSceneReport, summarizeReport, reportLoopOptions } from '../src/report.js';
import { resolveResourceDir } from '../src/arch/resourceDir.js';
import { SLEEP_GATE } from '../src/vm/engine.js';
import { runFrameLoop } from '../src/frame/loop.js';
import { im, instr, mkEngine } from './harness.js';
import type { BinInstruction } from '../src/script/bin.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
// 资源根 = install/（汉化版）：与产品、e2e 链路测试读同一套语料
const RAW = resolveResourceDir(ROOT);



// 120k 步足以越过启动画面进入 draw-texture 阶段（实测 0x1fb 首次出现在 step 96154）
const OPTS = { script: 0, steps: 120_000, write: false as const, resourceDir: RAW, frameMs: 16 };

test('场景执行报告：产出 op 计数 / 模型快照 / 三张缺口清单', async () => {
  const { report, jsonl, snapshotText } = await runSceneReport(OPTS);

  assert.ok(report.meta.steps > 1000, `应执行足量指令（实际 ${report.meta.steps}）`);
  assert.ok(Object.keys(report.opCounts).length > 10, '应命中多种 opcode');
  // 这条路线一定会跑 draw-texture（启动画面）
  assert.ok(report.opCounts['0x1fb'], '应含 draw-texture(0x1fb) 的计数');
  assert.ok(jsonl.length > 100, `JSONL 应有足量行（实际 ${jsonl.length}）`);
  assert.ok(jsonl.every((l) => typeof JSON.parse(l).op === 'string'), 'JSONL 每行都是合法 JSON 且有 op 字段');

  // 模型快照：至少要有图元；且必须区分"可绘制"与"仅由 setter 建出的空项"
  const c = report.snapshot.counts;
  assert.ok(c.drawItems > 0, '快照应有绘制项');
  assert.ok(c.drawableItems >= 0 && c.placeholderItems >= 0, '两个计数都应存在');
  assert.equal(c.drawItems, c.drawableItems + c.placeholderItems, '空项 + 可绘制 = 总数');
  assert.ok(snapshotText.includes('场景快照'), '应产出人可读快照文本');

  // ★闸门 A：这条路线确实会调用宿主没实现的 native（setLight / stringResourceId / unhandled …）
  assert.ok(report.droppedIntents.length > 0, '应有"意图被丢弃"清单');
  assert.ok(
    report.droppedIntents.every((d) => d.why.length > 0),
    '每条丢弃都要带"缺了它会怎样"的说明',
  );
  // ★闸门 B：也应有"被忽略但收到实参"的能力缺口（如消息窗配置类指令）
  assert.ok(report.gaps.length > 0, '应有能力缺口清单');
  assert.ok(report.gaps.every((g) => g.sample.length > 0), '缺口应带样例操作数');

  const text = summarizeReport(report);
  assert.ok(text.includes('能力缺口'), '摘要应包含缺口一行');
});

test('确定性：同一场景跑两次，JSONL 与快照逐字节一致（快照可进仓库做 diff）', async () => {
  const a = await runSceneReport(OPTS);
  const b = await runSceneReport(OPTS);
  assert.equal(a.jsonl.length, b.jsonl.length, 'JSONL 行数应一致');
  assert.deepEqual(a.jsonl, b.jsonl, 'JSONL 应逐行一致（虚拟时钟保证不依赖墙钟）');
  assert.equal(a.snapshotText, b.snapshotText, '快照文本应完全一致');
  assert.equal(a.report.meta.clockMs, b.report.meta.clockMs, '虚拟时钟应一致');
});

test('--ops 白名单：只把指定 opcode 写进 JSONL，但计数仍覆盖全部', async () => {
  const { report, jsonl } = await runSceneReport({ ...OPTS, ops: [0x1fb, 0x202] });
  const ops = new Set(jsonl.map((l) => JSON.parse(l).op as string));
  for (const o of ops) assert.ok(o === '0x1fb' || o === '0x202', `白名单外的 op 不应出现：${o}`);
  assert.ok(jsonl.length > 0, '白名单内应有命中');
  assert.ok(Object.keys(report.opCounts).length > ops.size, 'opCounts 仍应覆盖全部命中（不受白名单影响）');
  assert.deepEqual(report.meta.opFilter, ['0x1fb', '0x202']);
});

/**
 * ★★**门分支必须放行 + 记帧**（`tickets/T-0010`）★★
 *
 * 修前 report 的驱动档是 `gates: { anim: 'ignore', sleep: 'ignore' }`（B1 逐句照抄旧循环的"没有这两条分支"）
 * ⇒ ① `sleep`（`0xC8`）等于不存在，脚本直接冲过等待；② `0x400` 位永远留着，内批此后每帧只放行 1 条
 * ——同一脚本在 report 与 Electron 里的门行为**不同源**（用它得出的 E3 结论不代表产品路径）。
 *
 * ★还有一条**只改档位就会踩的坑**：把 `ignore` 改成 `'wait'` 而**不给门分支记帧**会**挂死**
 * （report 的时钟只在帧边界前进 ⇒ 永远到不了 `sleepUntil`；实测 `stopReason=cap`、steps 停在 1）。
 * 所以本测试直接驱动 `reportLoopOptions()` 这一份**真配置**（不是复制一份），用合成脚本钉住三件事：
 * 门真的按 `nowMs` 放行、`0x238` 计时器真的被等满、位真的被清。
 */
test('★report 的驱动口径：sleep 门真等满虚拟时钟、0x400 计时器真被等满（T-0010）', async () => {
  /** 用 report 的真配置驱动一个合成脚本，返回可核对的账。 */
  const drive = async (ops: BinInstruction[]): Promise<{ clock: number; frames: number; steps: number; flags: number; stop: string }> => {
    const e = mkEngine(ops);
    let clock = 0;
    let frames = 0;
    let steps = 0;
    const r = await runFrameLoop(e, { now: () => clock }, {
      ...reportLoopOptions({
        boundary: () => {
          frames++;
          clock += 16; // report 的 `--frame-ms` 默认 16
        },
        onStep: () => steps++,
        onUnknown: () => 'stop',
        onError: () => 'stop',
      }),
      // ★必须有帧上限：漏记帧的形态是"门永不放行" ⇒ 无上限就会**挂死整个测试**（而不是失败）。
      maxFrames: 2000,
      // 脚本尾即停（等价于 report 的 `until`：步数上限 / ip 越界）
      until: () => {
        const f = e.curScript();
        return !f.script || f.ip >= f.script.instructions.length;
      },
    });
    return { clock, frames, steps, flags: e.waitFlags >>> 0, stop: r.stopReason };
  };
  /** 漏记帧的形态 = 门永不放行 ⇒ 跑满 `maxFrames`。 */
  const notStuck = (r: { stop: string }, what: string): void =>
    assert.notEqual(r.stop, 'cap', `${what}：不得因门永不放行而跑满帧上限（漏给门分支记帧就是这个形态）`);

  // ① `sleep 500`（0xC8）：引擎语义 = 帧让步到 `nowMs >= sleepUntil` ⇒ 16ms/帧需 32 帧左右
  const a = await drive([instr(0xc8, [im(500)]), instr(0x101, []), instr(0x101, [])]);
  notStuck(a, 'sleep 门');
  assert.equal(a.steps, 3, 'sleep + 两条 nop 都派发');
  assert.ok(a.clock >= 500, `虚拟时钟必须走满 500ms（实际 ${a.clock}ms）—— 修前只有 16ms`);
  assert.ok(a.frames >= 31, `至少要 31 个帧让步（实际 ${a.frames}）`);
  assert.equal(a.flags & SLEEP_GATE, 0, '★SLEEP_GATE 必须被清掉（修前永远留着）');

  // ② `0x238` 装载 200ms 计时器 + `0x21C` 置 0x400：门要等计时器到期（引擎 `sub_407E20` raw 12762-12786）
  const b = await drive([instr(0x238, [im(200)]), instr(0x21c, []), instr(0x101, []), instr(0x101, [])]);
  notStuck(b, '0x400 计时器门');
  assert.equal(b.steps, 4);
  assert.ok(b.clock >= 200, `0x400 门必须等满计时器 200ms（实际 ${b.clock}ms）`);
  assert.equal(b.flags & 0x400, 0, '★0x400 位必须被清掉（修前永远留着）');

  // ③ 无计时器的 `0x21C`：池挂起位无从判定（report `present:'never'`）⇒ 下一帧即放行，但**位要清**
  const c = await drive([instr(0x21c, []), instr(0x101, []), instr(0x101, [])]);
  notStuck(c, '无计时器的 0x400 门');
  assert.equal(c.steps, 3);
  assert.equal(c.flags & 0x400, 0, '0x400 位必须被清掉');
  assert.ok(c.clock < 200, `没有计时器时不应多等（实际 ${c.clock}ms）`);

  /**
   * ★**"连续多少条指令算一帧"的阈值不许被当成驱动的批上限**（`T-0010` 实现时实测踩到）：
   * report 的这两个数是**两个不同的 1**——驱动的 `maxStepsPerFrame` 是 1（一轮一条），
   * 而帧边界阈值是 `ReportOptions.maxStepsPerFrame ?? 4096`。混用会让 script 0 的
   * `frames` 从 29 变成 60000、`clockMs` 从 464 变成 960000（时钟粒度被改掉 ⇒ 快照/门判据全变）。
   */
  const driveMany = async (boundaryEverySteps?: number): Promise<{ frames: number; clock: number }> => {
    const e = mkEngine(Array.from({ length: 300 }, () => instr(0x101, [])));
    let clock = 0;
    let frames = 0;
    await runFrameLoop(e, { now: () => clock }, {
      ...reportLoopOptions({
        boundary: () => {
          frames++;
          clock += 16;
        },
        ...(boundaryEverySteps === undefined ? {} : { boundaryEverySteps }),
        onStep: () => {},
        onUnknown: () => 'stop',
        onError: () => 'stop',
      }),
      maxFrames: 5000,
      until: () => {
        const f = e.curScript();
        return !f.script || f.ip >= f.script.instructions.length;
      },
    });
    return { frames, clock };
  };
  const manyDefault = await driveMany();
  assert.equal(manyDefault.frames, 0, '★默认阈值 4096：300 条 nop 里不该出现帧边界（这是 report 的时钟粒度）');
  const manyTight = await driveMany(2);
  // `++stepsThisFrame > 2` ⇒ 每 3 条推进一次（先自增再比较）⇒ 300 条 = 100 帧
  assert.equal(manyTight.frames, 100, `阈值 2 时应每 3 条推进一次（实际 ${manyTight.frames}）`);
});
