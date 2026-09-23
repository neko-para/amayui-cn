/** @tier T0 @kind ratchet @subsystem ledger */

/**
 * **审计报告完整性棘轮**（`tickets/T-0075` 的出口判据）—— 把"审计交付物必须自包含"变成可执行检查。
 *
 * 为什么需要：`T-0075` 的验收里有一条是「每份报告都写明方法、覆盖、kind×severity 统计、复核通过率、
 * 以及『已排除的误报』清单」—— 这类要求**不写进守卫就一定会腐化**（实证：审计总览 §5 写
 * 「执行状态见 §6」，而 §6 **根本不存在**，直到 `T-0075` 轮 9 才补齐）。同样地，机器可读数据清单
 * 原先只躺在 `.tmp/`（gitignored）⇒ 报告引用的"数据清单"对下一个人是不存在的。
 *
 * 判据（红了怎么修）：
 *  - 报告/清单文件缺失 ⇒ **不要删断言**，把文件补回来（或按新证据改判并同步 `T-0075` 的判据）；
 *  - 必需的节标题缺失 ⇒ 补那一节（本测试只钉"节存在 + 关键词"，不钉措辞）；
 *  - 归档清单的计数与报告统计不一致 ⇒ 先查是哪一侧改过，再同步（两侧都是结论，不许单边改数）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', '..');
const AUDIT = 'docs-new/99-records/2026-09-audit';

function read(rel: string): string {
  const p = path.join(ROOT, rel);
  assert.ok(fs.existsSync(p), `审计交付物缺失：${rel}（T-0075 的验收要求它在）`);
  return fs.readFileSync(p, 'utf8');
}

/** 三份明细报告都要有的"方法学四件套"（验收 §2）。 */
const DETAILS = ['-opcodes', '-capabilities', '-docs'];
const REQUIRED = [
  { key: '方法', why: '复现方法（怎么核对引擎侧/emulator 侧）' },
  { key: '覆盖', why: '覆盖数与自报 checked 的口径差异' },
  { key: '统计', why: 'kind × severity 统计表' },
  { key: '误报', why: '已排除的误报清单（便于别人复核审计本身）' },
];

test('★审计明细报告：三份都在，且各自含「方法 / 覆盖 / 统计 / 误报」四件套', () => {
  const missing: string[] = [];
  for (const d of DETAILS) {
    const rel = `${AUDIT}/audit-2026-09${d}.md`;
    const src = read(rel);
    for (const r of REQUIRED) {
      if (!src.includes(r.key)) missing.push(`${rel} 缺「${r.key}」（${r.why}）`);
    }
    // 复核结论必须给出分布（通过率/保留率）—— 只写"复核过了"不算
    if (!/复核?(分布|通过率)|保留率/.test(src)) missing.push(`${rel} 缺复核分布/通过率`);
  }
  assert.deepEqual(missing, [], `审计报告不完整：\n  ${missing.join('\n  ')}`);
});

test('★审计总览：§5 引用的「执行状态」节必须真的存在，且八批各有归属票', () => {
  const src = read(`${AUDIT}/audit-2026-09.md`);
  assert.ok(src.includes('执行状态见 §6'), '§5 的这句引用是本测试的锚点；删它就要同时删掉本断言的理由');
  assert.ok(/^## 6\. 执行状态/m.test(src), '★§6「执行状态」节缺失 —— §5 引用了一个不存在的节（T-0075 轮 9 的原始缺陷）');
  const batches = src.slice(src.indexOf('## 6. 执行状态'));
  for (const b of ['B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7']) {
    assert.ok(new RegExp(`\\|\\s*\\*{0,2}${b}\\*{0,2}\\s*\\|`).test(batches), `§6 缺批次 ${b} 的行`);
  }
  for (const t of ['T-0081', 'T-0076', 'T-0082', 'T-0077', 'T-0083', 'T-0078', 'T-0079']) {
    assert.ok(batches.includes(t), `§6 缺票号 ${t}（每批必须指回它的票）`);
  }
});

test('★机器可读清单已归档（不许只住在 .tmp/）：三份 audit-final-*.json 在票据证据里且计数与报告一致', () => {
  const want: Record<string, [number, number, number]> = {
    opcodes: [95, 9, 0],
    capabilities: [84, 9, 6],
    docs: [67, 13, 2],
  };
  const bad: string[] = [];
  for (const [name, [kept, dropped, unclear]] of Object.entries(want)) {
    const rel = `tickets/T-0075/evidence/audit-final-${name}.json`;
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) {
      bad.push(`${rel} 缺失（.tmp/ 是 gitignore 的临时区，不能当证据落点）`);
      continue;
    }
    const j = JSON.parse(fs.readFileSync(p, 'utf8')) as {
      kept?: unknown[];
      dropped?: unknown[];
      unclear?: unknown[];
    };
    const got = [j.kept?.length ?? -1, j.dropped?.length ?? -1, j.unclear?.length ?? -1];
    if (got[0] !== kept || got[1] !== dropped || got[2] !== unclear) {
      bad.push(`${rel} kept/dropped/unclear=${got.join('/')}，报告口径=${[kept, dropped, unclear].join('/')}`);
    }
  }
  assert.deepEqual(bad, [], `审计数据清单不可复核：\n  ${bad.join('\n  ')}`);
});
