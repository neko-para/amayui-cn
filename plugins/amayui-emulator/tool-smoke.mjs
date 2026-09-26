#!/usr/bin/env node
/**
 * tool-smoke.mjs —— `lib/tools.js` 的**离线自测**（假 root；不碰真实例、不碰 DSH 容器）。
 *
 * 覆盖 `tickets/T-0191` 的三个新动作：`action=ops`（查询）/ `action=op`（执行）/ `action=op-create`（创建）。
 * ★它同时是"**文件 fd stdio**"那条纪律的回归：受限沙箱下 `spawn` 的默认 `stdio:'pipe'` 会 EPERM
 *   （`tickets/T-0192` 实测）—— 本自测真跑一次 spawn，若有人把 `doOp` 改成 pipe，这里会红。
 *
 * 跑法（不需要 DSH、不需要实例、不需要网络）：
 *   node plugins/amayui-emulator/tool-smoke.mjs
 * 产物落在 `<repo>/.tmp/tools-smoke/`（gitignore 的临时区）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createExecutor, listOps, opsDir, parseOpsIndex, readOpFile } from './lib/tools.js'

const HERE = import.meta.dirname
const ROOT = path.resolve(HERE, '..', '..', '.tmp', 'tools-smoke')
const OPS = path.join(ROOT, 'app', 'amayui-emulator', 'tools', 'ops')
const LOGDIR = path.join(ROOT, '.tmp', 'emudbg')

let pass = 0
const fails = []
function check(ok, what, detail) {
  if (ok) {
    pass++
    console.log(`  ✓ ${what}`)
  } else {
    fails.push(`${what}${detail ? ` —— ${detail}` : ''}`)
    console.log(`  ✗ ${what}${detail ? ` —— ${detail}` : ''}`)
  }
}

// ── 造一个假 root（ops 目录 + 模板 + 一条 demo op + 一份索引 + 一个"活"实例记录）────────────
fs.rmSync(ROOT, { recursive: true, force: true })
fs.mkdirSync(OPS, { recursive: true })
fs.mkdirSync(LOGDIR, { recursive: true })
const instDir = path.join(ROOT, '.tmp', 'instances', 'fake')
fs.mkdirSync(instDir, { recursive: true })
fs.writeFileSync(
  path.join(instDir, 'instance.json'),
  JSON.stringify({
    id: 'fake',
    pid: process.pid, // 当前进程一定"活着" ⇒ 注册表判活通过
    port: 65535,
    host: '127.0.0.1',
    repoRoot: ROOT,
    startedAt: Date.now(),
    heartbeatAt: Date.now(),
    lastStatus: { bin: 'TITLE.BIN', frames: 1, gate: 'sleep' },
  }),
)
fs.writeFileSync(
  path.join(OPS, '_template.mjs'),
  '// ops/{{NAME}}.mjs —— **用例：{{PURPOSE}}**（{{DATE}} 生成）\nconsole.log("template")\n',
)
fs.writeFileSync(
  path.join(OPS, 'demo.mjs'),
  [
    '#!/usr/bin/env node',
    '/**',
    ' * ops/demo.mjs —— **用例：假 op（离线自测用）**',
    ' *',
    ' * 前置：假实例（pid = 自测进程）。',
    ' * 判据：打印 `[demo] ok` 即达成。',
    ' * ★副作用：无。',
    ' */',
    'const i = process.argv.indexOf("--instance");',
    'console.log(`[demo] instance=${i >= 0 ? process.argv[i + 1] : "?"}`);',
    'console.log(`[demo] args=${process.argv.slice(2).join(" ")}`);',
    'console.log("[demo] ok");',
  ].join('\n'),
  'utf8',
)
fs.writeFileSync(
  path.join(OPS, 'README.md'),
  [
    '# ops 索引',
    '',
    '## 怎么跑',
    '',
    '| 脚本 | 用例 | 前置 | 判据 | 副作用 | 状态 |',
    '|---|---|---|---|---|---|',
    '| `demo.mjs` | 假 op | 假实例 | 打印 ok | 无 | ✅ 自测 |',
    '| `_template.mjs` | 模板 | — | — | — | 模板 |',
    '',
    '## 待登记（**未实测**）',
    '',
    '| 待登记用例 | 已知信息 | 缺什么 |',
    '|---|---|---|',
    '| `demo-pending.mjs`（假） | 什么都没有 | 全部 |',
  ].join('\n'),
  'utf8',
)

const exec = createExecutor({ getRoot: () => ROOT, spawned: new Map(), toolLog: () => {} })

// ── ① action=ops（查询）────────────────────────────────────────────────────────
console.log('① action=ops（查询：不跑任何东西）')
const ops = await exec({ action: 'ops' })
check(ops.ok === true && Array.isArray(ops.ops), '回 ok + ops[]')
check(
  ops.ops.length === 1 && ops.ops[0].name === 'demo',
  '列出的 op 只有 demo（`_template.mjs` 不入清单）',
  JSON.stringify(ops.ops.map((o) => o.name)),
)
check(/假 op/.test(ops.ops[0].purpose || ''), '用途从文件头解析出来', ops.ops[0].purpose)
check(/假实例/.test(ops.ops[0].pre || ''), '前置解析出来', ops.ops[0].pre)
check(/打印 .*demo.* ok/.test(ops.ops[0].criteria || ''), '判据解析出来', ops.ops[0].criteria)
check(/自测/.test(ops.ops[0].status || ''), '状态从 README 表里取到', ops.ops[0].status)
check(ops.pending.length === 1 && ops.pending[0].name === 'demo-pending', '待登记表被单独列出', JSON.stringify(ops.pending))
check(String(ops.template || '').endsWith('_template.mjs'), 'template 路径报出来', ops.template)

// ── ② action=op（执行；真 spawn 一次）──────────────────────────────────────────
console.log('② action=op（执行：真跑一次 node 子进程，stdio = 文件 fd）')
const run = await exec({ action: 'op', instance: 'fake', name: 'demo', args: ['--slot', '7'], timeout_ms: 30000 })
check(run.ok === true && run.exitCode === 0, '跑通（exit 0）', `exit=${run.exitCode} timedOut=${run.timedOut}`)
check(run.lines.some((l) => l.includes('[demo] ok')), '回执带回日志尾部（判据行）', JSON.stringify(run.lines))
check(run.lines.some((l) => l.includes('--slot 7')), 'args 原样透传给脚本 CLI', JSON.stringify(run.lines))
check(run.lines.some((l) => l.includes('instance=fake')), '--instance 由工具注入', JSON.stringify(run.lines))
check(fs.existsSync(path.join(ROOT, run.logPath)), '日志真的落在 .tmp/emudbg/', run.logPath)

// ── ③ 参数纪律 ────────────────────────────────────────────────────────────────
console.log('③ 参数纪律（实例只有一处真源 / 名字不许穿目录）')
let e1 = null
try {
  await exec({ action: 'op', instance: 'fake', name: 'demo', args: ['--instance', 'other'] })
} catch (e) {
  e1 = e
}
check(!!e1 && /不要再给 --instance/.test(e1.message), 'args 里给 --instance 被拒', e1 && e1.message)
let e2 = null
try {
  await exec({ action: 'op', instance: 'fake', name: 'nope' })
} catch (e) {
  e2 = e
}
check(!!e2 && /没有 op <nope>/.test(e2.message) && /demo/.test(e2.message), 'op 不存在时报出可用清单', e2 && e2.message)
let e3 = null
try {
  await exec({ action: 'op', name: '../evil' })
} catch (e) {
  e3 = e
}
check(!!e3 && /名字非法/.test(e3.message), '非法 op 名字被拒（不许穿目录）', e3 && e3.message)

// ── ④ action=op-create（创建）─────────────────────────────────────────────────
console.log('④ action=op-create（创建：模板 + 占位替换 + 拒绝覆盖）')
const made = await exec({ action: 'op-create', name: 'load-from-battle', purpose: '战斗界面 → 读档槽 N' })
check(made.ok === true && fs.existsSync(path.join(ROOT, made.path)), '生成了文件', made.path)
const body = fs.readFileSync(path.join(ROOT, made.path), 'utf8')
check(
  body.includes('ops/load-from-battle.mjs') && body.includes('战斗界面 → 读档槽 N') && !body.includes('{{'),
  '模板占位被替换干净',
  body.split('\n')[1],
)
check(Array.isArray(made.checklist) && made.checklist.length === 4, '回执给出 4 条待办（三样 + 登记一行）', JSON.stringify(made.checklist))
let e4 = null
try {
  await exec({ action: 'op-create', name: 'load-from-battle' })
} catch (e) {
  e4 = e
}
check(!!e4 && /已存在/.test(e4.message), '拒绝覆盖已有 op', e4 && e4.message)
const after = await exec({ action: 'ops' })
check(
  after.ops.length === 2 && after.ops.some((o) => o.indexed === false),
  '新 op 立刻出现在清单里，且标出"索引里没有这一行"',
  JSON.stringify(after.ops.map((o) => [o.name, o.indexed])),
)

// ── ⑤ 导出面 ─────────────────────────────────────────────────────────────────
console.log('⑤ 导出面（给别的守卫/代码复用）')
check(
  typeof opsDir(ROOT) === 'string' && typeof parseOpsIndex(ROOT).status.get === 'function' && typeof readOpFile === 'function' && typeof listOps(ROOT).ops.length === 'number',
  'listOps / opsDir / parseOpsIndex / readOpFile 可用',
)

console.log(`\n${fails.length ? '✗' : '✓'} tool-smoke：${pass} 通过 / ${fails.length} 失败`)
for (const f of fails) console.log(`  ✗ ${f}`)
process.exitCode = fails.length ? 1 : 0
