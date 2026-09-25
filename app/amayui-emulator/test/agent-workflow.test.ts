/** @tier T0 @kind tool @subsystem tool */

/**
 * **多 agent 工作流的工具链守卫**（三份台账 CLI + 三份 SKILL.md 的共享协议节）。
 *
 * 为什么需要这条守卫：`tickets.js` / `scripts.js` / `capabilities.js` 是**唯一**会写三份台账真源的
 * 程序，而一个主 agent + 多个并行子代理会同时跑它们。真实会话里踩过三类坑，本文件把它们钉住：
 *
 * 1. **`--set` 的 ASCII 逗号切分**：`--set whySilent=… (1102,294) …` 会把值拆成**数组**（`engine.fns=a,b`
 *    正是靠这个特性）⇒ 类型错了、`--validate` 红、只能手改 JSON。修法是 `--set-json k=<json>`。
 * 2. **手改 JSON 后 `counts` 陈旧**：技能文档明确允许直接编辑 `analysis/*.json`，但那不会重算 `counts`，
 *    守卫随即报 `counts.modeled-verified 应为 48` / md 统计行不一致。修法是 `--recount`（本文件钉住它
 *    真的会重算、真的会写回、已同步时打"无变化"）。
 * 3. **锚点是跨 agent 的 ABI**：`tickets/<ID>/ticket.json` 的 `evidence[].anchor` 与
 *    `analysis/scripts.json` 的 `layout[].anchor` 要求**别的文件里存在某个字面串**。改被锚文件之前
 *    必须能问"谁锚在我这里" ⇒ `--anchors-in`（只读）。
 *
 * 以及一条**防漂移**守卫：三个 SKILL.md 里各有一份**同源**的「★多 agent 并行纪律」节
 * （节号随技能不同：5/8/9），归一化节号后必须**逐字节相同** —— 否则纪律会在三处各自漂移。
 *
 * 本文件**不碰真实台账**：所有写入型断言都在 `.tmp/` 下的临时副本上做（`--root` 指向副本）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const TMP_ROOT = path.join(REPO, '.tmp');
const ENGINE_SCRIPTS = path.join(REPO, '.agents', 'skills', 'amayui-engine-analysis', 'scripts');
const TICKET_SCRIPTS = path.join(REPO, '.agents', 'skills', 'amayui-ticket-ledger', 'scripts');
const CAPABILITIES = path.join(ENGINE_SCRIPTS, 'capabilities.js');
const SCRIPTS = path.join(ENGINE_SCRIPTS, 'scripts.js');
const TICKETS = path.join(TICKET_SCRIPTS, 'tickets.js');
const CAPS_JSON = path.join(REPO, 'analysis', 'engine-capabilities.json');
const SCRIPTS_JSON = path.join(REPO, 'analysis', 'scripts.json');

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** 在 `.tmp/` 下建一个一次性沙箱（`.tmp/` 是 gitignore 的临时区，不会污染仓库）。 */
function sandbox(tag: string): string {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(TMP_ROOT, `agent-workflow-${tag}-`));
}

function run(tool: string, args: string[]): RunResult {
  const r = spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8' });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** 目录内容快照（用来断言"只读"：跑完必须逐字节不变）。 */
function snapshot(dir: string): string {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(`${path.relative(dir, p)}:${fs.readFileSync(p, 'utf8')}`);
    }
  };
  walk(dir);
  return out.join('\n');
}

function json(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ---------------------------------------------------------------------------
// (a) 三个台账工具的新开关
// ---------------------------------------------------------------------------

test('★--set-json：值里的 ASCII 逗号不再被拆成数组（--set 的反例也在）', () => {
  const root = sandbox('set-json');
  try {
    fs.mkdirSync(path.join(root, 'analysis'), { recursive: true });
    const capPath = path.join(root, 'analysis', 'engine-capabilities.json');
    fs.copyFileSync(CAPS_JSON, capPath);
    const capId = json(capPath).entries[0].id;

    // ① --set-json：整值按 JSON 解析 ⇒ 含 ASCII 逗号/括号的字符串原样写进去。
    const ok = run(CAPABILITIES, ['--root', root, '--edit', capId, '--set-json', 'emulator.note="why: a (1102,294) b"']);
    assert.equal(ok.status, 0, `--set-json 应成功：${ok.stderr}`);
    const note = json(capPath).entries.find((e: any) => e.id === capId).emulator.note;
    assert.equal(typeof note, 'string', `--set-json 必须写字符串（成了数组 = 逗号切分又发生了）：${JSON.stringify(note)}`);
    assert.ok(note.includes('(1102,294)'), `值必须原样保留：${JSON.stringify(note)}`);

    // ② 反例：同样的值走 --set 会被拆成数组 —— 这就是 --set-json 存在的理由。
    const bad = run(CAPABILITIES, ['--root', root, '--edit', capId, '--set', 'emulator.note=a, b']);
    assert.equal(bad.status, 0, bad.stderr);
    const arr = json(capPath).entries.find((e: any) => e.id === capId).emulator.note;
    assert.ok(Array.isArray(arr), `--set 的逗号切分是已知行为（实际 ${JSON.stringify(arr)}）`);

    // ③ 解析失败必须**响亮失败**（非零退出）并点名 key，不许静默写坏值。
    const err = run(CAPABILITIES, ['--root', root, '--edit', capId, '--set-json', 'emulator.note=[1,2']);
    assert.notEqual(err.status, 0, '--set-json 的非法 JSON 必须非零退出');
    assert.ok(err.stderr.includes('emulator.note'), `报错要点名 key：${err.stderr}`);

    // ④ 结构化数组（layout/slots/gaps）也能整段写：值里的逗号属于 JSON，不属于分隔符。
    const scPath = path.join(root, 'analysis', 'scripts.json');
    fs.copyFileSync(SCRIPTS_JSON, scPath);
    const scId = json(scPath).entries[0].id;
    const sc = run(SCRIPTS, ['--root', root, '--edit', scId, '--set-json', 'gaps=["a,b","c"]']);
    assert.equal(sc.status, 0, sc.stderr);
    const gaps = json(scPath).entries.find((e: any) => e.id === scId).gaps;
    assert.deepEqual(gaps, ['a,b', 'c'], '数组元素里的逗号必须保留');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('★--recount：陈旧 counts 就地修好；已同步时打「无变化」且退出 0', () => {
  const root = sandbox('recount');
  try {
    fs.mkdirSync(path.join(root, 'analysis'), { recursive: true });

    // ---- capabilities.js：把 modeled-verified 改少 1，模拟"手改 JSON 忘了重算 counts" ----
    const capPath = path.join(root, 'analysis', 'engine-capabilities.json');
    fs.copyFileSync(CAPS_JSON, capPath);
    const capDoc = json(capPath);
    const good = capDoc.counts['modeled-verified'];
    capDoc.counts['modeled-verified'] = good - 1;
    fs.writeFileSync(capPath, JSON.stringify(capDoc, null, 2) + '\n');

    const stale = run(CAPABILITIES, ['--root', root, '--validate']);
    assert.notEqual(stale.status, 0, '--validate 必须报出陈旧 counts');
    assert.match(stale.stderr, /counts\.modeled-verified/);
    assert.ok(stale.stderr.includes('[next] counts 陈旧'), `--validate 要给 --recount 提示：${stale.stderr}`);

    const fixed = run(CAPABILITIES, ['--root', root, '--recount']);
    assert.equal(fixed.status, 0, fixed.stderr);
    assert.match(fixed.stdout, new RegExp(`counts: modeled-verified ${good - 1} → ${good}`), fixed.stdout);
    assert.equal(json(capPath).counts['modeled-verified'], good, '--recount 必须把 counts 写回磁盘');

    const again = run(CAPABILITIES, ['--root', root, '--recount']);
    assert.equal(again.status, 0, '已同步时也必须退出 0');
    assert.ok(again.stdout.includes('无变化'), `已同步时应打「无变化」：${again.stdout}`);

    // ---- scripts.js ----
    const scPath = path.join(root, 'analysis', 'scripts.json');
    fs.copyFileSync(SCRIPTS_JSON, scPath);
    const scDoc = json(scPath);
    const total = scDoc.counts.total;
    scDoc.counts.total = total + 7;
    fs.writeFileSync(scPath, JSON.stringify(scDoc, null, 2) + '\n');

    const scStale = run(SCRIPTS, ['--root', root, '--validate']);
    assert.notEqual(scStale.status, 0);
    assert.match(scStale.stderr, /counts\.total/);
    assert.ok(scStale.stderr.includes('[next] counts 陈旧'), scStale.stderr);

    const scFixed = run(SCRIPTS, ['--root', root, '--recount']);
    assert.equal(scFixed.status, 0, scFixed.stderr);
    assert.match(scFixed.stdout, new RegExp(`counts: total ${total + 7} → ${total}`), scFixed.stdout);
    assert.equal(json(scPath).counts.total, total);
    assert.ok(run(SCRIPTS, ['--root', root, '--recount']).stdout.includes('无变化'));

    // ---- tickets.js：票据真源不含 counts 字段，账目在看板上 ⇒ 只读对账+打 diff，退出 0 ----
    const tdir = path.join(root, 'tickets', 'T-0001');
    fs.mkdirSync(tdir, { recursive: true });
    fs.writeFileSync(
      path.join(tdir, 'ticket.json'),
      JSON.stringify(
        {
          id: 'T-0001',
          type: 'tooling',
          status: 'open',
          priority: 'P2',
          area: 'tooling',
          title: '夹具',
          why: '夹具',
          acceptance: ['夹具'],
          history: [{ at: '2026-01-01', what: '创建' }],
        },
        null,
        2,
      ) + '\n',
    );
    const tRecount = run(TICKETS, ['--root', root, '--recount']);
    assert.equal(tRecount.status, 0, tRecount.stderr);
    assert.ok(tRecount.stdout.includes('counts:'), `--recount 应打账目：${tRecount.stdout}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('★--anchors-in：只读列出谁锚在这个文件上（精确/后缀都命中；无命中打「（无）」）', () => {
  const root = sandbox('anchors');
  try {
    // ---- tickets.js：evidence[].file 命中（这是"改写文档前先查谁锚在我这里"的那条命令）----
    const target = 'app/amayui-emulator/src/vm/handlers/save-slot.ts';
    const tdir = path.join(root, 'tickets', 'T-0001');
    fs.mkdirSync(tdir, { recursive: true });
    fs.writeFileSync(
      path.join(tdir, 'ticket.json'),
      JSON.stringify(
        {
          id: 'T-0001',
          type: 'tooling',
          status: 'open',
          priority: 'P2',
          area: 'tooling',
          title: '夹具',
          why: '夹具',
          acceptance: ['夹具'],
          evidence: [{ file: target, anchor: 'SAVE_SLOT_OPS', note: '夹具证据', line: 1 }],
          history: [{ at: '2026-01-01', what: '创建' }],
        },
        null,
        2,
      ) + '\n',
    );

    const beforeTickets = snapshot(root);
    const full = run(TICKETS, ['--root', root, '--anchors-in', path.join(REPO, target)]);
    assert.equal(full.status, 0, full.stderr);
    assert.match(full.stdout, /T-0001 {2}evidence\[0\] {2}anchor="SAVE_SLOT_OPS"/, full.stdout);
    assert.ok(full.stdout.includes('（1 条）'), full.stdout);

    const bare = run(TICKETS, ['--root', root, '--anchors-in', 'save-slot.ts']);
    assert.match(bare.stdout, /evidence\[0\]/, '裸文件名（后缀匹配）也要命中');

    const none = run(TICKETS, ['--root', root, '--anchors-in', 'src/NOPE.txt']);
    assert.equal(none.status, 0, '无命中也必须退出 0');
    assert.ok(none.stdout.includes('（无）'), none.stdout);
    assert.equal(snapshot(root), beforeTickets, '--anchors-in 必须**只读**（不许改任何 ticket.json）');

    // ---- scripts.js：layout 归属的 src 文件命中（锚点本身也支持后缀匹配）----
    const scPath = path.join(root, 'analysis', 'scripts.json');
    fs.mkdirSync(path.dirname(scPath), { recursive: true });
    fs.writeFileSync(
      scPath,
      JSON.stringify(
        {
          _doc: 'fixture',
          statusEnum: { analyzed: '已分析' },
          counts: { total: 1, analyzed: 1 },
          entries: [
            { id: 'FIX', file: 'src/FIX.txt', layout: [{ lines: '1-2', anchor: 'label_fix', what: '夹具段' }] },
          ],
        },
        null,
        2,
      ) + '\n',
    );

    const beforeScripts = snapshot(root);
    const byFile = run(SCRIPTS, ['--root', root, '--anchors-in', 'src/FIX.txt']);
    assert.equal(byFile.status, 0, byFile.stderr);
    assert.match(byFile.stdout, /FIX {2}layout\[0\] {2}lines=1-2 {2}anchor="label_fix"/, byFile.stdout);

    const byAbs = run(SCRIPTS, ['--root', root, '--anchors-in', path.join(root, 'src', 'FIX.txt')]);
    assert.match(byAbs.stdout, /label_fix/, '绝对路径（后缀匹配）也要命中');

    const noneSc = run(SCRIPTS, ['--root', root, '--anchors-in', target]);
    assert.ok(noneSc.stdout.includes('（无）'), noneSc.stdout);
    assert.equal(snapshot(root), beforeScripts, '--anchors-in 必须**只读**');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('三个台账工具都认得 --recount / --set-json / --anchors-in（不因未知开关报错）', () => {
  const root = sandbox('surface');
  try {
    fs.mkdirSync(path.join(root, 'analysis'), { recursive: true });
    fs.copyFileSync(CAPS_JSON, path.join(root, 'analysis', 'engine-capabilities.json'));
    fs.copyFileSync(SCRIPTS_JSON, path.join(root, 'analysis', 'scripts.json'));
    const tdir = path.join(root, 'tickets', 'T-0001');
    fs.mkdirSync(tdir, { recursive: true });
    fs.writeFileSync(
      path.join(tdir, 'ticket.json'),
      JSON.stringify(
        {
          id: 'T-0001', type: 'tooling', status: 'open', priority: 'P2', area: 'tooling',
          title: '夹具', why: '夹具', acceptance: ['夹具'],
          history: [{ at: '2026-01-01', what: '创建' }],
        },
        null,
        2,
      ) + '\n',
    );

    const surfaces: [string, string][] = [
      [CAPABILITIES, 'capabilities.js'],
      [SCRIPTS, 'scripts.js'],
      [TICKETS, 'tickets.js'],
    ];
    for (const [tool, name] of surfaces) {
      for (const flag of ['--recount', '--set-json', '--anchors-in']) {
        const needValue = flag !== '--recount';
        // 带值开关必须**吃掉**自己的值（漏进 VALUE_FLAGS 会让它退化成布尔，下一个参数被当 root）。
        const args = ['--root', root, ...(needValue ? [flag, flag === '--set-json' ? 'nope=["ok"]' : 'README.md'] : [flag])];
        const r = run(tool, args);
        assert.equal(r.status, 0, `${name} ${flag} 应被认出并正常结束（status=${r.status}）：${r.stderr}`);
        assert.ok(!r.stderr.includes('is not a function'), `${name} ${flag} 不应崩溃：${r.stderr}`);
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (a2) 提升进技能的"台账写入口"工具（原先只活在 .tmp/settle/ 的临时区）
// ---------------------------------------------------------------------------
//
// 为什么这些也要守卫：它们是**唯一**会改"条目级"真源的程序（`ledger.js` 改四/六份 analysis/*.json，
// `fix-evidence-lines.js` 改上百张票据的 `evidence[].line`），而它们的正确性靠的是"两阶段 + 恰好命中
// 一条 + 写盘后回读"。临时区里的脚本没人守，退化后只会以"数据被改坏"的形式暴露。

const LEDGER = path.join(ENGINE_SCRIPTS, 'ledger.js');
const GAPS = path.join(ENGINE_SCRIPTS, 'gaps.js');
const FIX_LINES = path.join(TICKET_SCRIPTS, 'fix-evidence-lines.js');
const GAPS_JSON = path.join(REPO, 'analysis', 'opcode-gaps.json');
const hash = (f: string): string =>
  createHash('sha256').update(fs.readFileSync(f)).digest('hex');

test('★ledger.js：默认 dry-run 不落盘；--write 才写；回读复核通过', () => {
  const root = sandbox('ledger-basic');
  try {
    fs.mkdirSync(path.join(root, 'analysis'), { recursive: true });
    const gp = path.join(root, 'analysis', 'opcode-gaps.json');
    fs.copyFileSync(GAPS_JSON, gp);
    // 挑一个**在册且有 missing[]** 的 partial 条目 —— 这正是"给在册条目追加 missing"的场景。
    const doc = json(gp);
    const target = doc.entries.find((e: any) => e.disposition === 'partial' && (e.missing ?? []).length > 0);
    assert.ok(target, '夹具前提：opcode-gaps.json 里应有带 missing[] 的 partial 条目');
    const before = (target.missing ?? []).length;
    const plan = path.join(root, 'plan.json');
    fs.writeFileSync(
      plan,
      JSON.stringify({
        ops: [{
          file: 'analysis/opcode-gaps.json',
          match: { opcode: target.opcode },
          add: { missing: [{ what: '★守卫夹具：追加一条不走"抄旧条目"路径', ticket: 'T-0179', raw: '1-2' }] },
        }],
      }),
    );

    const dryHash = hash(gp);
    const dry = run(LEDGER, ['--root', root, '--plan', plan]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /dry-run/, '缺省必须告诉你是 dry-run');
    assert.equal(hash(gp), dryHash, '★dry-run 必须逐字节不动台账');
    assert.equal((json(gp).entries.find((e: any) => e.opcode === target.opcode).missing ?? []).length, before);

    const w = run(LEDGER, ['--root', root, '--plan', plan, '--write']);
    assert.equal(w.status, 0, w.stderr);
    const after = json(gp).entries.find((e: any) => e.opcode === target.opcode).missing;
    assert.equal(after.length, before + 1, '★add 必须是 append（旧条目一条都不能少）');
    assert.ok(after.some((m: any) => String(m.what).includes('守卫夹具')), '新条目要真在数组里');
    assert.match(w.stdout, /回读复核 1 处通过/, `写盘后必须回读复核：${w.stdout}`);

    // `--check` = 显式 dry-run（与 --write 互斥）——别让它退化成被静默忽略的开关
    const chkHash = hash(gp);
    const chk = run(LEDGER, ['--root', root, '--plan', plan, '--check']);
    assert.equal(chk.status, 0, chk.stderr);
    assert.equal(hash(gp), chkHash, '--check 必须不落盘');
    const both = run(LEDGER, ['--root', root, '--plan', plan, '--check', '--write']);
    assert.equal(both.status, 2, '--check 与 --write 必须互斥');
    assert.equal(hash(gp), chkHash, '互斥报错时也不许落盘');

    // 再跑一次：同一条会被 append 第二次（add 不幂等 —— 文档已写明"计划只能应用一次"）
    const again = run(LEDGER, ['--root', root, '--plan', plan, '--write']);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(json(gp).entries.find((e: any) => e.opcode === target.opcode).missing.length, before + 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('★ledger.js：match 必须恰好命中 1 条；counts 不许直写；patches 的 old 必须恰好 1 次', () => {
  const root = sandbox('ledger-guards');
  try {
    fs.mkdirSync(path.join(root, 'analysis'), { recursive: true });
    fs.copyFileSync(GAPS_JSON, path.join(root, 'analysis', 'opcode-gaps.json'));
    const gp = path.join(root, 'analysis', 'opcode-gaps.json');
    const gpHash = hash(gp);
    // ★名字故意不叫那两个字母的短名 —— `test/harness-convergence.test.ts` 的棘轮按**正则扫全文**
    //   （连注释也算），会把自造 fixture 工厂判成"新抄的 mk 变体"；基线只许收缩，不许为它登记例外。
    const writePlanFile = (name: string, obj: unknown): string => {
      const p = path.join(root, name);
      fs.writeFileSync(p, JSON.stringify(obj));
      return p;
    };

    // ① match 命中 0 条 ⇒ 拒绝（且整个计划都不落盘）
    const miss = run(LEDGER, ['--root', root, '--plan', writePlanFile('m0.json', { ops: [{ file: 'analysis/opcode-gaps.json', match: { opcode: 99999 }, set: { note: 'x' } }] }), '--write']);
    assert.notEqual(miss.status, 0, '命中 0 条必须非零退出');
    assert.match(miss.stderr, /命中 0 条/);

    // ② 条目手术指向非台账（源码/文档）⇒ 拒绝并指路 patches
    const notLedger = run(LEDGER, ['--root', root, '--plan', writePlanFile('m1.json', { ops: [{ file: 'src/SN0000.txt', match: { id: 'x' }, set: { note: 'y' } }] })]);
    assert.notEqual(notLedger.status, 0);
    assert.ok(notLedger.stderr.includes('不是可做条目手术的台账') && notLedger.stderr.includes('patches'), notLedger.stderr);

    // ③ counts 是派生物 ⇒ 拒绝直写，并点名各自的唯一口径入口
    const counts = run(LEDGER, ['--root', root, '--plan', writePlanFile('m2.json', { topLevel: { 'analysis/opcode-gaps.json': { 'counts.byDisposition.partial': 1 } } })]);
    assert.notEqual(counts.status, 0, 'counts 不许直写');
    assert.ok(counts.stderr.includes('gaps.js --recount'), `要指路到唯一口径：${counts.stderr}`);

    // ④ 上面三次都必须**一个字节都没写**
    assert.equal(hash(gp), gpHash, '被拒的计划不许留下半成品');

    // ④b 合法的 topLevel（非 counts）要能写进去，并被回读复核 ——
    //     这条钉住一个真实存在过的 bug：topLevel 的复核路径曾被当成"条目选择器"去 JSON.parse。
    const top = run(LEDGER, ['--root', root, '--plan', writePlanFile('m5.json', { topLevel: { 'analysis/opcode-gaps.json': { '_doc': '★守卫夹具：topLevel 探针' } } }), '--write']);
    assert.equal(top.status, 0, top.stderr);
    assert.match(top.stdout, /回读复核 1 处通过/, top.stdout);
    assert.equal(json(gp)._doc, '★守卫夹具：topLevel 探针');

    // ⑤ patches：非 JSON 目标也能改，但 old 必须恰好 1 次
    const txt = path.join(root, 'probe.txt');
    fs.writeFileSync(txt, 'AAA unique-token BBB');
    const okPatch = run(LEDGER, ['--root', root, '--plan', writePlanFile('m3.json', { patches: { 'probe.txt': [{ old: 'unique-token', new: 'REPLACED' }] } }), '--write']);
    assert.equal(okPatch.status, 0, okPatch.stderr);
    assert.equal(fs.readFileSync(txt, 'utf8'), 'AAA REPLACED BBB', 'patches 要真的换掉');
    const dup = run(LEDGER, ['--root', root, '--plan', writePlanFile('m4.json', { patches: { 'probe.txt': [{ old: 'A', new: 'Z' }] } })]);
    assert.notEqual(dup.status, 0, 'old 出现多次必须拒绝');
    assert.equal(fs.readFileSync(txt, 'utf8'), 'AAA REPLACED BBB', '被拒的 patches 不许半途改掉文件');

    // ⑤b `count`：重复短语要**声明**出现几次并全部替换（用于台账里成片出现的同一指针/措辞）
    const rep = path.join(root, 'rep.txt');
    fs.writeFileSync(rep, 'P1 P2 P3');
    const counted = run(LEDGER, ['--root', root, '--plan', writePlanFile('m6.json', { patches: { 'rep.txt': [{ old: 'P', new: 'Q', count: 3 }] } }), '--write']);
    assert.equal(counted.status, 0, counted.stderr);
    assert.equal(fs.readFileSync(rep, 'utf8'), 'Q1 Q2 Q3', 'count 模式要**全部**换掉');
    // 声明的次数与实际不符 ⇒ 拒绝（防"以为改了 3 处、其实只改了 1 处"）
    const wrongCount = run(LEDGER, ['--root', root, '--plan', writePlanFile('m7.json', { patches: { 'rep.txt': [{ old: 'Q', new: 'R', count: 1 }] } }), '--write']);
    assert.notEqual(wrongCount.status, 0, 'count 与实际不符必须拒绝');
    assert.match(wrongCount.stderr, /应为 1/);
    assert.equal(fs.readFileSync(rep, 'utf8'), 'Q1 Q2 Q3', '被拒的 count 替换不许动文件');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('★gaps.js：--missing 给 raw 键；--stale 认陈旧候选；--recount 委托生成器且**不重写口径**', () => {
  // ---- ① --missing / --stale 走真实台账（只读）----
  const miss = run(GAPS, ['--missing', '0x82']);
  assert.equal(miss.status, 0, miss.stderr);
  assert.match(miss.stdout, /missing\[\]/, miss.stdout);
  assert.match(miss.stdout, /raw=/, `--missing 必须给出 raw 键（ledger.js 的 mutate 靠它定位）：${miss.stdout.slice(0, 300)}`);

  const stale = run(GAPS, ['--stale']);
  assert.equal(stale.status, 0, stale.stderr);
  assert.match(stale.stdout, /陈旧候选/, stale.stdout);
  assert.match(stale.stdout, /三态过滤/, '报告里要写清三级处置，否则读者不知道"候选"该怎么裁');

  // ---- ② --recount 的机制在沙箱里验（不碰真实台账）：它**调用生成器**、然后回读文件打 diff ----
  const root = sandbox('gaps-recount');
  try {
    fs.mkdirSync(path.join(root, 'analysis'), { recursive: true });
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'analysis', 'opcode-gaps.json'),
      JSON.stringify({
        counts: { entries: 99, byDisposition: { partial: 999 } },
        entries: [
          { opcode: 1, mnemonic: 'i1', disposition: 'partial', note: 'x', missing: [{ what: 'a', ticket: 'T-0179', raw: '1-2' }] },
          { opcode: 2, mnemonic: 'i2', disposition: 'partial', note: 'y', missing: [{ what: 'b', ticket: 'T-0179', raw: '3-4' }] },
        ],
      }, null, 2) + '\n',
    );
    // 口径桩：只做"按 entries 重算并写回"——用来证明 gaps.js 是**委托**而不是自带第二份算法。
    fs.writeFileSync(
      path.join(root, 'scripts', 'build-opcode-gaps.mjs'),
      [
        "import * as fs from 'node:fs';",
        "import * as path from 'node:path';",
        'export function buildGapReport(root, opts = {}) {',
        "  const p = path.join(root, 'analysis', 'opcode-gaps.json');",
        "  const doc = JSON.parse(fs.readFileSync(p, 'utf8'));",
        '  const byDisposition = {};',
        '  for (const e of doc.entries) byDisposition[e.disposition] = (byDisposition[e.disposition] ?? 0) + 1;',
        '  if (opts.syncCounts) {',
        '    doc.counts = { entries: doc.entries.length, byDisposition };',
        "    fs.writeFileSync(p, JSON.stringify(doc, null, 2) + '\\n');",
        '  }',
        '  return { report: {}, problems: [] };',
        '}',
        '',
      ].join('\n'),
    );
    const rec = run(GAPS, ['--root', root, '--recount']);
    assert.equal(rec.status, 0, rec.stderr);
    assert.match(rec.stdout, /counts\.byDisposition\.partial: 999 → 2/, `应打出委托人算出的 diff：${rec.stdout}`);
    assert.match(rec.stdout, /唯一口径/, rec.stdout);
    assert.equal(json(path.join(root, 'analysis', 'opcode-gaps.json')).counts.byDisposition.partial, 2);

    // 生成器缺失 ⇒ 响亮失败（不许静默当成功）
    const noGen = sandbox('gaps-nogen');
    try {
      fs.mkdirSync(path.join(noGen, 'analysis'), { recursive: true });
      fs.copyFileSync(GAPS_JSON, path.join(noGen, 'analysis', 'opcode-gaps.json'));
      const r = run(GAPS, ['--root', noGen, '--recount']);
      assert.notEqual(r.status, 0, '没有生成器时必须非零退出（口径不在本工具里）');
      assert.ok(r.stderr.includes('找不到生成器'), r.stderr);
    } finally {
      fs.rmSync(noGen, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('★tickets.js --edit-plan：免转义批量改单，且**两阶段**（状态校验不过 ⇒ 字段也不落盘）', () => {
  const root = sandbox('edit-plan');
  try {
    const mkTicket = (id: string): void => {
      const dir = path.join(root, 'tickets', id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'ticket.json'),
        JSON.stringify({
          id, type: 'tooling', status: 'open', priority: 'P2', area: 'tooling',
          title: '夹具', why: '夹具', acceptance: ['夹具'],
          history: [{ at: '2026-01-01', kind: 'created', what: '创建' }],
        }, null, 2) + '\n',
      );
    };
    mkTicket('T-0001');
    mkTicket('T-0002');
    const testDir = path.join(root, 'app', 'amayui-emulator', 'test');
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'probe.test.ts'), '// probe\n');

    // ---- ① 结果状态 done 的前置校验不过 ⇒ 整份计划不落盘（连 sets 都不写）----
    const bad = path.join(root, 'bad.json');
    fs.writeFileSync(bad, JSON.stringify({
      id: 'T-0001',
      sets: [['tests', ['app/amayui-emulator/test/nope.test.ts']]],
      status: 'done',
    }));
    const rb = run(TICKETS, ['--root', root, '--edit-plan', bad]);
    assert.notEqual(rb.status, 0, '守卫不存在的票不许置 done');
    assert.match(rb.stderr, /整份计划都不落盘/, rb.stderr);
    const t1 = json(path.join(root, 'tickets', 'T-0001', 'ticket.json'));
    assert.equal(t1.status, 'open', '状态不许变');
    assert.equal(t1.tests, undefined, '★两阶段：字段也不许留下半成品');

    // ---- ② 通过 ⇒ sets 与 status 都落盘 ----
    const good = path.join(root, 'good.json');
    fs.writeFileSync(good, JSON.stringify({
      id: 'T-0002',
      sets: [['tests', ['app/amayui-emulator/test/probe.test.ts']], ['doneWhy', '文档/分析票口径：夹具。']],
      status: 'done',
      note: '守卫夹具',
    }));
    const rg = run(TICKETS, ['--root', root, '--edit-plan', good]);
    assert.equal(rg.status, 0, rg.stderr);
    const t2 = json(path.join(root, 'tickets', 'T-0002', 'ticket.json'));
    assert.equal(t2.status, 'done');
    assert.deepEqual(t2.tests, ['app/amayui-emulator/test/probe.test.ts']);
    assert.ok(t2.history.length >= 2, '给了 note ⇒ 应记 history');

    // ---- ③ 直接 --set-status done 也被同一套前置校验拦住 ----
    const direct = run(TICKETS, ['--root', root, '--set-status', 'T-0001', 'done']);
    assert.notEqual(direct.status, 0, '--set-status done 必须有前置校验');
    assert.equal(json(path.join(root, 'tickets', 'T-0001', 'ticket.json')).status, 'open');

    // ---- ④ 沙箱全量自检应通过（说明上面的写入没造出非法票）----
    const v = run(TICKETS, ['--root', root, '--validate']);
    assert.equal(v.status, 0, v.stdout + v.stderr);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('★fix-evidence-lines.js：dry-run 不写盘；--write 只改 line 不改 anchor；--check 只对漂移/失效报警', () => {
  const root = sandbox('fix-lines');
  try {
    fs.mkdirSync(path.join(root, 'analysis'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tickets', 'T-0001'), { recursive: true });
    // 锚点在第 3 行；票据记的是 999（漂移），另有一条锚点已不存在。
    fs.writeFileSync(path.join(root, 'analysis', 'fields.json'), 'a\nb\nANCHOR-OK\nc\n');
    const tp = path.join(root, 'tickets', 'T-0001', 'ticket.json');
    fs.writeFileSync(tp, JSON.stringify({
      id: 'T-0001', type: 'tooling', status: 'open', priority: 'P2', area: 'tooling',
      title: '夹具', why: '夹具', acceptance: ['夹具'],
      evidence: [
        { file: 'analysis/fields.json', anchor: 'ANCHOR-OK', line: 999, note: '漂移' },
        { file: 'analysis/fields.json', anchor: 'ANCHOR-GONE', line: 1, note: '失效' },
      ],
      history: [{ at: '2026-01-01', kind: 'created', what: '创建' }],
    }, null, 2) + '\n');

    const before = fs.readFileSync(tp, 'utf8');
    const dry = run(FIX_LINES, ['--root', root, '--check']);
    assert.notEqual(dry.status, 0, '--check 在"有漂移 + 有失效锚点"时必须非零退出');
    assert.match(dry.stdout, /漂移\*\* 1 条/, dry.stdout);
    assert.match(dry.stdout, /ANCHOR-GONE/, '失效锚点要点名');
    assert.ok(dry.stdout.includes('需人判 retarget') || dry.stdout.includes('retarget'), '失效锚点要交人判，不许静默改锚点');
    assert.equal(fs.readFileSync(tp, 'utf8'), before, '--check 不许写盘');

    const plainDry = run(FIX_LINES, ['--root', root]);
    assert.equal(fs.readFileSync(tp, 'utf8'), before, '缺省 dry-run 不许写盘');
    assert.match(plainDry.stdout, /dry-run/, plainDry.stdout);

    const w = run(FIX_LINES, ['--root', root, '--write']);
    assert.equal(w.status, 0, w.stderr);
    const after = json(tp);
    assert.equal(after.evidence[0].line, 3, '漂移的行号要按锚点重新定位');
    assert.equal(after.evidence[0].anchor, 'ANCHOR-OK', '★锚点串一个字都不许改');
    assert.equal(after.evidence[1].line, 1, '失效锚点的旧行号原样保留（人判之后再动）');
    assert.equal(after.evidence[1].anchor, 'ANCHOR-GONE');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (a3) 行号工具的第二条规则：**多命中且原本没写 `line` ⇒ 不猜**
// ---------------------------------------------------------------------------
//
// 为什么值得一条守卫：同一段锚点串可能落在**语义不同的两处**（实测：审计报告 §4.1 的 finding 表
// 与 §4.6 的"被复核订正"表里各有一份同样的句子，指称并不相同）⇒ 工具替人"取最早一次"就是把
// 猜出来的值写进真源。规则改成"唯一命中才自动补；多命中列成待人选，要填就用 `--pick` 显式指定"。

test('★fix-evidence-lines.js：多命中 + 无旧 line ⇒ 不猜（列待人选）；--pick 才落盘；指错行要响亮失败', () => {
  const root = sandbox('fix-lines-pick');
  try {
    fs.mkdirSync(path.join(root, 'analysis'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tickets', 'T-0001'), { recursive: true });
    // 锚点出现两次（第 3 行与第 7 行）——模拟"同一句话在两节里各一份"。
    fs.writeFileSync(path.join(root, 'analysis', 'fields.json'), 'a\nb\nDUP-ANCHOR\nc\nd\ne\nDUP-ANCHOR\nf\n');
    const tp = path.join(root, 'tickets', 'T-0001', 'ticket.json');
    fs.writeFileSync(tp, JSON.stringify({
      id: 'T-0001', type: 'tooling', status: 'open', priority: 'P2', area: 'tooling',
      title: '夹具', why: '夹具', acceptance: ['夹具'],
      evidence: [{ file: 'analysis/fields.json', anchor: 'DUP-ANCHOR', note: '两处同句' }],
      history: [{ at: '2026-01-01', kind: 'created', what: '创建' }],
    }, null, 2) + '\n');

    // ① dry-run：不猜、不写盘，列成待人选
    const dry = run(FIX_LINES, ['--root', root]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /待人选.*1 条/, dry.stdout);
    // 候选行必须逐条打出来（沙箱里没有 markdown 标题，所以是"（无标题）"）
    assert.match(dry.stdout, /3 行\s+（无标题）/, dry.stdout);
    assert.match(dry.stdout, /7 行\s+（无标题）/, dry.stdout);
    assert.equal(json(tp).evidence[0].line, undefined, '多命中且无旧 line 时不许写猜测值');

    // ② --write 也**不**猜（这是关键：不会"顺手"填一个）
    const w = run(FIX_LINES, ['--root', root, '--write']);
    assert.equal(w.status, 0, w.stderr);
    assert.equal(json(tp).evidence[0].line, undefined, '--write 在无人指定时也不许填');

    // ③ --pick 指到**不含锚点**的行 ⇒ 拒绝 + 响亮失败 + 不改文件
    const before = fs.readFileSync(tp, 'utf8');
    const bad = run(FIX_LINES, ['--root', root, '--pick', 'T-0001:0=4', '--write']);
    assert.notEqual(bad.status, 0, '指错行的 --pick 必须非零退出');
    assert.match(bad.stdout, /不含.*锚点/, bad.stdout);
    assert.equal(fs.readFileSync(tp, 'utf8'), before, '被拒的 pick 不许动文件');

    // ④ --pick 指到含锚点的那一行 ⇒ 落盘
    const ok = run(FIX_LINES, ['--root', root, '--pick', 'T-0001:0=7', '--write']);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(json(tp).evidence[0].line, 7, '--pick 指定的行要落盘');

    // ⑤ 未被使用的 --pick（下标/票号写错）也要响亮失败
    const unused = run(FIX_LINES, ['--root', root, '--pick', 'T-0001:9=3']);
    assert.notEqual(unused.status, 0, '用不上的 --pick 必须非零退出');
    assert.match(unused.stdout, /未被使用/, unused.stdout);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (b) 防漂移：三个 SKILL.md 的「★多 agent 并行纪律」节必须同源
// ---------------------------------------------------------------------------

const SKILL_FILES = ['amayui-ticket-ledger', 'amayui-engine-analysis', 'amayui-script-analysis'].map((n) =>
  path.join(REPO, '.agents', 'skills', n, 'SKILL.md'),
);

/**
 * 抽出共享的「多 agent 并行纪律」节：从 `## <N>. ★多 agent 并行（subagent / workflow）纪律`
 * 到 `### <N>.6 落在本技能上` **之前**（N.6 是随技能不同的那一段）。
 * 归一化：`## N.` / `### N.M` / 行内 `N.M` 的节号统一成 `§`（三份的节号是 5 / 8 / 9）。
 */
function sharedSection(file: string): string {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const start = lines.findIndex((l) => /^## \d+\. ★多 agent 并行（subagent \/ workflow）纪律$/.test(l));
  assert.ok(start >= 0, `${file} 应有「★多 agent 并行（subagent / workflow）纪律」节`);
  const end = lines.findIndex((l, i) => i > start && /^### \d+\.6 /.test(l));
  assert.ok(end > start, `${file} 的该节应以「### N.6 …」小节作为结束界标（它标记共享部分的终点）`);
  return lines
    .slice(start, end)
    .join('\n')
    .replace(/^## \d+\. /m, '## §. ')
    .replace(/\b\d+\.(?=\d)/g, '§.');
}

test('★共享协议节同源：三个 SKILL.md 的「多 agent 并行纪律」归一化后必须逐字节相同', () => {
  const sections = SKILL_FILES.map(sharedSection);
  const [base] = sections;
  assert.ok(base && base.length > 500, `共享节应被抽到且非空（实际 ${base?.length ?? 0} 字节）`);
  for (let i = 1; i < sections.length; i++) {
    assert.equal(
      sections[i],
      base,
      `${SKILL_FILES[i]} 的共享协议节与 ${SKILL_FILES[0]} 不一致 —— ` +
        '这一节在三个技能里**同源**，改一处必须三处同步（只有「落在本技能上」的 N.6 段随技能不同）',
    );
  }
  assert.ok(!/\d+\.\d/.test(base), '归一化后不应残留 "N.M" 形式的节号（否则守卫会被节号差异蒙混过关）');
});
