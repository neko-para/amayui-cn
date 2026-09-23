/** @tier T0 @kind core @subsystem host */

/**
 * **静态产物缺失的判据**（`tickets/T-0143`）。
 *
 * ## 为什么值得一条守卫
 *
 * 实测事故：`app/amayui-emulator/dist/web/` 整个目录不在磁盘上（`dist/` 被 `.gitignore` 全量忽略
 * ⇒ 没有任何工具会替它恢复），于是 DSH 面板里只剩一句 `{"error":"not found: index.html"}`。
 * 那句话把「**你没构建**」和「请求了一个不存在的资源」压成同一个 404、且不含产物绝对路径与修法
 * ⇒ 排障方向被带到插件路由/反向代理/端口上去，绕了一圈才回到"产物没了"。
 *
 * 这条守卫同时钉两件事（都不依赖本机 `dist/` 是否恰好存在）：
 *
 * | 判据 | 静默失败的样子 |
 * |---|---|
 * | 缺产物时 404 正文含 `reason`/`distDir`/`fix` | 只回 `not found` ⇒ 排障被带偏 |
 * | 启动时打一条含绝对路径与构建命令的告警 | 缺失只体现在"页面打不开"，宿主照常健康 ⇒ 没人知道为什么 |
 * | 产物齐时 `GET /` 是 200 且 `text/html` | 自检/提示把**正常**情形也搞坏（误报比不报更糟） |
 *
 * ★两种情形各起一个真进程、各指向不同的 `--dist-dir`（临时目录）：这样"缺产物"这条**不会**
 *   因为跑测试的机器上 `dist/web` 恰好存在而假通过。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** `app/amayui-emulator`（`--import tsx` 与 `src/web/host.ts` 都以它为 cwd）。 */
const APP = path.resolve(import.meta.dirname, '..');

/** 起一个宿主，返回 `{ port, out, stop }`；`out` 是累积的 stdout+stderr。 */
async function startHost(opts: {
  repo: string;
  id: string;
  distDir: string;
}): Promise<{ port: number; log: () => string; stop: () => Promise<void> }> {
  const child = spawn(
    process.execPath,
    [
      '--import', 'tsx', 'src/web/host.ts',
      '--instance', opts.id, '--port', '0', '--repo-root', opts.repo,
      // ★闲置自停关掉：这条用例只看启动时的自检与静态响应，不要让它中途自己退。
      '--idle-sec', '0',
      '--dist-dir', opts.distDir,
    ],
    { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, AMAYUI_WEB_IDLE_SEC: '' } },
  );
  let out = '';
  child.stdout?.on('data', (b: Buffer) => { out += String(b); });
  child.stderr?.on('data', (b: Buffer) => { out += String(b); });
  const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()));

  // 启动横幅里有真实端口（`--port 0`）。
  const deadline = Date.now() + 90_000;
  let port = 0;
  while (Date.now() < deadline) {
    const m = /就绪 http:\/\/127\.0\.0\.1:(\d+)\//.exec(out);
    if (m) {
      port = Number(m[1]);
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!port) {
    child.kill('SIGKILL');
    throw new Error(`宿主没在 90s 内就绪。输出：\n${out}`);
  }
  // ★横幅与自检都是**启动期日志**，收集到它们比"看到端口"可能要晚一两个 tick ⇒ 等自检那行出现
  //   （有 `build-electron.mjs` 一律会打；缺产物时打告警、齐备时不打 ⇒ 以"告警或 250ms 静默"为准）。
  const settleUntil = Date.now() + 3000;
  while (Date.now() < settleUntil && !/build-electron\.mjs/.test(out)) {
    await new Promise((r) => setTimeout(r, 50));
  }
  await new Promise((r) => setTimeout(r, 250));
  return {
    port,
    log: () => out,
    stop: async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    },
  };
}

test(
  '★缺 web 产物：启动时告警含绝对路径与构建命令；`GET /` 的 404 正文能指向修法',
  { timeout: 180_000 },
  async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'amayui-dist-missing-'));
    const distDir = path.join(repo, 'empty-dist');
    fs.mkdirSync(distDir, { recursive: true });
    let host: Awaited<ReturnType<typeof startHost>> | null = null;
    try {
      host = await startHost({ repo, id: 'distmiss', distDir });

      // ① 启动自检：绝对路径 + 可照抄的构建命令
      const log = host.log();
      assert.match(log, /web 产物缺失/, `启动时必须告警"产物缺失"。输出：\n${log}`);
      assert.ok(log.includes(distDir), `告警里必须有**绝对**产物目录（便于一眼看出读的是哪）。输出：\n${log}`);
      assert.match(log, /build-electron\.mjs/, `告警里必须有可照抄的构建命令。输出：\n${log}`);

      // ② `GET /` 的 404 正文：机器可读地指出"未构建" + 路径 + 修法
      const res = await fetch(`http://127.0.0.1:${host.port}/`);
      assert.equal(res.status, 404);
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body.error, 'not found: index.html', '保留原 error 形状（面板/工具可能已经在匹配它）');
      assert.equal(body.distDir, distDir, '404 正文里要有产物目录的绝对路径');
      assert.match(String(body.fix ?? ''), /build-electron\.mjs/, '404 正文里要有修法命令');
      assert.ok(String(body.reason ?? '').length > 0, '404 正文里要说清"未构建"而不是"资源不存在"');

      // ③ 宿主本身**照常健康**：缺产物只影响"给页面看的静态产物"，不该把实例也弄没
      const health = (await fetch(`http://127.0.0.1:${host.port}/health`).then((r) => r.json())) as {
        ok?: boolean;
        instance?: string;
      };
      assert.equal(health.ok, true);
      assert.equal(health.instance, 'distmiss');
    } finally {
      if (host) await host.stop();
      fs.rmSync(repo, { recursive: true, force: true });
    }
  },
);

test(
  '★产物齐备：同一个自检**不误报**，`GET /` 是 200 且 `text/html`',
  { timeout: 180_000 },
  async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'amayui-dist-ok-'));
    const distDir = path.join(repo, 'ok-dist');
    fs.mkdirSync(distDir, { recursive: true });
    // 三个产物**齐备**（内容不重要：这条钉的是"自检不会把正常情形判成缺失"）。
    fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>ok</title>');
    fs.writeFileSync(path.join(distDir, 'bridge.js'), '/* bridge */');
    fs.writeFileSync(path.join(distDir, 'renderer.js'), '/* renderer */');
    let host: Awaited<ReturnType<typeof startHost>> | null = null;
    try {
      host = await startHost({ repo, id: 'distok', distDir });
      assert.doesNotMatch(host.log(), /web 产物缺失/, `产物齐备时**不许**告警（误报比不报更糟）。输出：\n${host.log()}`);
      const res = await fetch(`http://127.0.0.1:${host.port}/`);
      assert.equal(res.status, 200);
      assert.match(String(res.headers.get('content-type') ?? ''), /text\/html/, '`GET /` 必须回 HTML');
      const txt = await res.text();
      assert.match(txt, /<title>ok<\/title>/, '回的就该是那个 index.html');
    } finally {
      if (host) await host.stop();
      fs.rmSync(repo, { recursive: true, force: true });
    }
  },
);
