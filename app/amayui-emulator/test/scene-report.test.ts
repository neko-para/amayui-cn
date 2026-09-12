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
import { runSceneReport, summarizeReport } from '../src/report.js';
import { resolveResourceDir } from '../src/arch/resourceDir.js';

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
