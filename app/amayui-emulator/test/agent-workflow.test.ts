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
