/** @tier T0 @kind core @subsystem host */

/**
 * **实例注册表 / 同 id 互斥 / 闲置自停守卫**（`tickets/T-0136`）。
 *
 * 这三件事的失败模式都很"安静"，所以判据必须钉在磁盘与真进程上：
 *
 * | 判据 | 静默失败的样子 |
 * |---|---|
 * | 原子写（`tmp` + `rename`） | 插件轮询到"半个 JSON"⇒ 面板偶尔空白，还查不出原因 |
 * | 活/死过滤（pid + 心跳） | `kill -9` 后的陈旧记录永远挡住同名实例，或面板列出早就没了的实例 |
 * | 闲置自停 | 没人看也不退 ⇒ 累积一堆监听回环端口的僵尸；或反过来把正在看的实例误杀 |
 *
 * ★最后一条用**真进程**验（`--idle-sec 1`）：纯判据（`shouldIdleStop`）只证明"算得对"，
 * 不证明"宿主真的照它退且摘干净记录"。真进程那段是数秒级，且不碰任何真资产（仓库根是临时目录）。
 */
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  HEARTBEAT_STALE_MS,
  isAlive,
  isValidInstanceId,
  listInstances,
  readRecord,
  registryPath,
  removeRecord,
  writeRecord,
  type InstanceRecord,
} from '../src/host/registry.js';
import { shouldIdleStop, summarizeStatus } from '../src/web/host.js';

/** `app/amayui-emulator`（`--import tsx` 与 `src/web/host.ts` 都以它为 cwd）。 */
const APP = path.resolve(import.meta.dirname, '..');

/** 一条记录应有的落点根（与 `instanceLayout` 的具名实例同口径）。 */
function rootOf(repoRoot: string, id: string): string {
  return path.join(repoRoot, '.tmp', 'instances', id);
}

/** 一个用完即删的临时"仓库根"（`.tmp/instances/...` 的基准）。 */
function tmpRepo(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amayui-registry-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** 造一条记录：缺省是"活的"（本进程 pid + 刚刚的心跳）。 */
function rec(repoRoot: string, id: string, over: Partial<InstanceRecord> = {}): InstanceRecord {
  const now = Date.now();
  return {
    id,
    pid: process.pid,
    port: 41234,
    host: '127.0.0.1',
    repoRoot,
    startedAt: now,
    heartbeatAt: now,
    ...over,
  };
}

/** 已死进程的 pid：让 `spawnSync` 起一个立刻退出并**已回收**的子进程，它的 pid 一定不存在。 */
function deadPid(): number {
  const r = spawnSync(process.execPath, ['-e', '0']);
  const pid = r.pid;
  assert.ok(typeof pid === 'number' && pid > 0, 'spawnSync 必须给出 pid');
  return pid;
}

/** 轮询直到 `probe()` 说"好了"（返回 `null` = 超时）。 */
async function waitFor<T>(probe: () => T | null, timeoutMs: number): Promise<T | null> {
  const t0 = Date.now();
  for (;;) {
    const v = probe();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) return null;
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** 给一个 Promise 加超时（超时 = 判据失败，不是挂死）。 */
function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(msg)), ms).unref();
    }),
  ]);
}

test('registryPath = `<root>/instance.json`（冻结口径：插件按它找记录）', () => {
  assert.equal(registryPath('/a/b'), path.join('/a/b', 'instance.json'));
});

test('★往返：`writeRecord` → `readRecord` 逐字段一致（含 `lastStatus` 摘要）', (t) => {
  const repo = tmpRepo(t);
  const r = rec(repo, 'dbg-a', {
    port: 53819,
    lastStatus: { bin: 'SC0000.BIN', frames: 1234, gate: 'wait-input' },
  });
  writeRecord(r);
  assert.deepEqual(readRecord(rootOf(repo, 'dbg-a')), r);
  // 具名实例的落点就是 `<repo>/.tmp/instances/<id>/instance.json`（插件扫描的那一条）。
  assert.ok(fs.existsSync(path.join(rootOf(repo, 'dbg-a'), 'instance.json')));
});

test('★原子写：不留 `.tmp`、不留半截文件、且覆盖掉崩溃写者留下的 `.tmp`', (t) => {
  const repo = tmpRepo(t);
  const root = rootOf(repo, 'atomic');
  const file = registryPath(root);
  fs.mkdirSync(root, { recursive: true });
  // ① 先放一条"上一版"记录（模拟正在跑的上一个进程）
  fs.writeFileSync(file, JSON.stringify(rec(repo, 'atomic', { port: 1111 })), 'utf8');
  // ② 再放一个崩溃写者留下的半截临时文件
  fs.writeFileSync(`${file}.tmp`, '{"id":"atomic","pid":', 'utf8');

  const fresh = rec(repo, 'atomic', { port: 2222, startedAt: 1, heartbeatAt: 2 });
  writeRecord(fresh);

  // 正式文件必须**整份**是新记录（不是与旧内容拼接，也不是半截）
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), fresh);
  assert.deepEqual(readRecord(root), fresh);
  assert.equal(fs.existsSync(`${file}.tmp`), false, 'rename 之后不许留 `.tmp`');
});

test('★坏 JSON / 缺字段 / 不存在 ⇒ `readRecord` 一律 `null`（读者不炸）', (t) => {
  const repo = tmpRepo(t);
  const root = rootOf(repo, 'bad');
  fs.mkdirSync(root, { recursive: true });
  assert.equal(readRecord(root), null, '文件不存在');
  fs.writeFileSync(registryPath(root), '{not json', 'utf8');
  assert.equal(readRecord(root), null, '坏 JSON');
  fs.writeFileSync(registryPath(root), JSON.stringify({ id: 'bad', port: 1 }), 'utf8');
  assert.equal(readRecord(root), null, '缺 pid/心跳等必填字段');
  fs.writeFileSync(registryPath(root), JSON.stringify(rec(repo, 'bad', { port: 99999 })), 'utf8');
  assert.equal(readRecord(root), null, '端口越界 = 坏记录');
  fs.writeFileSync(registryPath(root), JSON.stringify(rec(repo, 'api')), 'utf8');
  assert.equal(readRecord(root), null, '保留 id 不该出现在注册表里');
});

test('★`listInstances`：死 pid 被过滤，活的心跳过期也被过滤，坏的当不存在', (t) => {
  const repo = tmpRepo(t);
  const base = path.join(repo, '.tmp', 'instances');
  const now = Date.now();
  writeRecord(rec(repo, 'alive', { startedAt: now - 20, heartbeatAt: now }));
  writeRecord(rec(repo, 'dead', { pid: deadPid(), startedAt: now - 10, heartbeatAt: now }));
  writeRecord(rec(repo, 'stale', { startedAt: now - 30, heartbeatAt: now - HEARTBEAT_STALE_MS - 1000 }));
  // 一个没有 `instance.json` 的目录（刚建好还没起、或没起完就崩了）
  fs.mkdirSync(path.join(base, 'empty-dir'), { recursive: true });

  const live = listInstances(base);
  assert.deepEqual(
    live.map((r) => r.id),
    ['alive'],
    `只该剩 alive（实际 ${JSON.stringify(live.map((r) => r.id))}）`,
  );
  assert.equal(live[0]!.pid, process.pid);
});

test('★`listInstances`：按 `startedAt` 升序（面板顺序稳定，不随目录序漂）', (t) => {
  const repo = tmpRepo(t);
  const base = path.join(repo, '.tmp', 'instances');
  const now = Date.now();
  writeRecord(rec(repo, 'third', { startedAt: now - 1, heartbeatAt: now }));
  writeRecord(rec(repo, 'first', { startedAt: now - 300, heartbeatAt: now }));
  writeRecord(rec(repo, 'second', { startedAt: now - 100, heartbeatAt: now }));
  assert.deepEqual(
    listInstances(base).map((r) => r.id),
    ['first', 'second', 'third'],
  );
});

test('★`listInstances`：传 `<repo>/.tmp` 也能同时看见默认实例与具名实例（两种扫描口径）', (t) => {
  const repo = tmpRepo(t);
  const now = Date.now();
  // 默认实例的记录落在 `<repo>/.tmp/instance.json`（它的 `instanceLayout().root` 就是 `.tmp`）
  writeRecord(rec(repo, 'default', { startedAt: now - 200, heartbeatAt: now }));
  // 具名实例在 `<repo>/.tmp/instances/<id>/instance.json`
  writeRecord(rec(repo, 'named', { startedAt: now - 100, heartbeatAt: now }));

  assert.deepEqual(
    listInstances(path.join(repo, '.tmp')).map((r) => r.id),
    ['default', 'named'],
  );
  assert.deepEqual(
    listInstances(path.join(repo, '.tmp', 'instances')).map((r) => r.id),
    ['named'],
    '具名口径（插件扫描的常态）不受影响',
  );
});

test('★`listInstances`：目录不存在 ⇒ 空数组（首启无实例不是错误）', (t) => {
  const repo = tmpRepo(t);
  assert.deepEqual(listInstances(path.join(repo, '.tmp', 'instances')), []);
});

test('★`removeRecord` 幂等：不存在也不抛，且顺带清掉 `.tmp`', (t) => {
  const repo = tmpRepo(t);
  const root = rootOf(repo, 'gone');
  removeRecord(root); // 不存在
  writeRecord(rec(repo, 'gone'));
  fs.writeFileSync(`${registryPath(root)}.tmp`, 'half', 'utf8');
  removeRecord(root);
  assert.equal(readRecord(root), null);
  assert.equal(fs.existsSync(`${registryPath(root)}.tmp`), false);
  removeRecord(root); // 再删一次
});

test('★`isAlive`：本进程活着；已回收的子进程 pid 是死的；0/负数不是"活"', () => {
  assert.equal(isAlive(process.pid), true);
  assert.equal(isAlive(deadPid()), false);
  assert.equal(isAlive(0), false);
  assert.equal(isAlive(-1), false);
});

test('★`isValidInstanceId`：保留段/路径逃逸/超长一律拒绝，正常 id 接受', () => {
  for (const bad of ['api', '../x', 'a/b', 'a\\b', '', '   ', 'x'.repeat(65), '.', '..']) {
    assert.equal(isValidInstanceId(bad), false, `应拒绝 ${JSON.stringify(bad)}`);
  }
  for (const ok of ['a', 'default', 'dbg-1', 'run.2', 'A_b-3', 'x'.repeat(64)]) {
    assert.equal(isValidInstanceId(ok), true, `应接受 ${JSON.stringify(ok)}`);
  }
});

test('shouldIdleStop：无观察者 + 两条超时才自停；`0` 关；有观察者永不自停', () => {
  const base = { idleSec: 600, clients: 0, lastActivityMs: 0, startedAt: 0 };
  assert.equal(shouldIdleStop({ ...base, now: 600_001 }), true);
  assert.equal(shouldIdleStop({ ...base, now: 600_000 }), false, '恰好等于阈值不算超');
  assert.equal(shouldIdleStop({ ...base, now: 600_001, idleSec: 0 }), false, '`0` = 关');
  assert.equal(shouldIdleStop({ ...base, now: 600_001, clients: 1 }), false, '有 SSE 观察者 ⇒ 不自停');
  assert.equal(
    shouldIdleStop({ ...base, now: 10, idleSec: 5, lastActivityMs: 0, startedAt: 9 }),
    false,
    '刚起来（startedAt 未超阈）不许被判闲置',
  );
  assert.equal(
    shouldIdleStop({ ...base, now: 10_000, idleSec: 5, lastActivityMs: 9_000, startedAt: 0 }),
    false,
    '刚刚有请求（lastActivityMs 未超阈）不许被判闲置',
  );
});

test('summarizeStatus：`renderer-status` 的任意形状都收窄成 `{bin,frames,gate}` 或空，不抛', () => {
  assert.deepEqual(
    summarizeStatus({ bin: 'SC0001.BIN', perf: { frames: 42, gate: 'wait-click' } }),
    { bin: 'SC0001.BIN', frames: 42, gate: 'wait-click' },
  );
  // 缺 perf / perf 形状不对 / 字段类型不对 ⇒ 只是少了那几项，仍然不抛
  assert.deepEqual(summarizeStatus({ bin: 'X' }), { bin: 'X' });
  assert.deepEqual(summarizeStatus({ perf: { frames: 'NaN' as unknown as number } }), {});
  // 完全不是对象 ⇒ 调用方（心跳）保持上一次摘要
  for (const junk of [null, undefined, 0, 'x', [], true]) {
    assert.equal(summarizeStatus(junk), null, `应返回 null：${JSON.stringify(junk) ?? 'undefined'}`);
  }
});

test(
  '★真进程 `--idle-sec 1`：登记（真端口/真 pid/心跳）→ 秒级自停 → 记录被摘掉',
  { timeout: 120_000 },
  async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'amayui-idle-'));
    const id = 'idle-probe';
    const root = rootOf(repo, id);
    // ★`--import tsx` 从 cwd（= app 目录）解析；`--port 0` 让 OS 分配真实端口。
    const child = spawn(
      process.execPath,
      [
        '--import', 'tsx', 'src/web/host.ts',
        '--instance', id, '--port', '0', '--idle-sec', '1', '--repo-root', repo,
      ],
      {
        cwd: APP,
        stdio: ['ignore', 'pipe', 'pipe'],
        // 别继承外部可能设着的闲置阈值（CLI 参数优先，但让子进程环境干净一点更好排障）
        env: { ...process.env, AMAYUI_WEB_IDLE_SEC: '' },
      },
    );
    let out = '';
    child.stdout?.on('data', (b: Buffer) => {
      out += String(b);
    });
    child.stderr?.on('data', (b: Buffer) => {
      out += String(b);
    });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.on('exit', (code, signal) => resolve({ code, signal }));
    });

    try {
      // ① 等登记。★故意**不**打 /health：那会刷新活动时刻，把自停推后（探测只读文件）。
      const r = await waitFor(() => readRecord(root), 60_000);
      assert.ok(r, `60s 内没登记（子进程输出：\n${out}）`);
      assert.equal(r.id, id);
      assert.equal(r.pid, child.pid);
      assert.ok(r.port > 0, '`--port 0` ⇒ 记录里必须是 OS 分配的真实端口');
      assert.equal(r.host, '127.0.0.1');
      assert.equal(r.repoRoot, repo);
      assert.ok(r.heartbeatAt >= r.startedAt);
      assert.equal(isAlive(r.pid), true, '刚刚登记 ⇒ pid 必须活着');
      // ★横幅要**单独等**（`T-0177`）：`src/web/host.ts` 的顺序是 `publishRecord()`（raw 941，
      //   先把记录写盘）→ 一大段启动工作 → `log('[web] 就绪 http://…')`（raw 990）。
      //   注册表文件是**同步**落盘的，而 stdout 是**管道**（父进程的 `data` 回调要等事件循环）⇒
      //   「记录已出现」并不蕴含「横幅已进 `out`」。全量并行跑时这里实测偶发红
      //   （`out` 里只有 `[web] 实例 …` 那一行）。判据本身不变（仍要求横幅 + 真实端口），
      //   只是不再假设"记录一出现横幅就已刷出"。
      const banner = await waitFor(() => (/就绪 http:\/\/127\.0\.0\.1:/.test(out) ? out : null), 30_000);
      assert.ok(banner, `30s 内没等到启动横幅（子进程输出：\n${out}）`);
      assert.match(out, /就绪 http:\/\/127\.0\.0\.1:/, '必须有启动横幅（含真实端口）');

      // ② 等它自己收工：检查周期被阈值压到 1s ⇒ 秒级（阈值 1s + 一次检查）
      const { code, signal } = await withTimeout(exited, 60_000, `进程没在 60s 内自停（输出：\n${out}）`);
      assert.equal(signal, null, `不该被信号杀掉（输出：\n${out}）`);
      assert.equal(code, 0, `自停是正常退出（输出：\n${out}）`);
      assert.match(out, /闲置 1s 且无观察者 ⇒ 自停/, '必须留下那行自停日志');
      assert.equal(readRecord(root), null, '自停必须摘掉注册项（否则下一个同名实例会被自己挡住）');
      assert.deepEqual(listInstances(path.join(repo, '.tmp', 'instances')), [], '列表里也不该再有它');
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      fs.rmSync(repo, { recursive: true, force: true });
    }
  },
);
