/** @tier T0 @kind core @subsystem host */

/**
 * **实例布局（instance 隔离）守卫** —— `tickets/T-0134` WS-3（设计来源 `tickets/T-0133` §B.3）。
 *
 * 守的是"多实例能不能真的互不干扰"的地基：**路径两两不同** + **不改 `process.env`** +
 * **具名实例不继承玩家真存档**。`HostService` 侧的写盘落点由 `test/host-service.test.ts` 守。
 *
 * ★为什么不 import `electron/paths.ts` 来对比三个常量：那个文件用 `__dirname`（给 esbuild 打的 CJS 壳用），
 *   在 ESM 测试里 import 会直接 `ReferenceError`。⇒ 改用**字面期望值**（默认实例的路径公式）
 *   ＋一条**源码棘轮**（那三个常量确实是从 `instanceLayout` 取的）—— 两条合起来等价于原来的断言，
 *   而且后者才是真正要钉住的不变量（"路径口径只有一份"）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { DEFAULT_INSTANCE_ID, describeInstance, instanceLayout, isDefaultInstance } from '../src/host/instance.js';

/** 仓库根：`<repo>/app/amayui-emulator/test` 往上三级（与 `electron/paths.ts` 的 REPO_ROOT 同指一处）。 */
const REPO = path.resolve(import.meta.dirname, '..', '..', '..');
const APP = path.resolve(import.meta.dirname, '..');

test('★默认实例的三条路径 = 重构前的公式（零行为变更）', () => {
  const l = instanceLayout({ repoRoot: REPO, env: {} });
  assert.equal(l.id, DEFAULT_INSTANCE_ID);
  assert.equal(l.logPath, path.join(REPO, '.tmp', 'amayui-emulator.log'));
  assert.equal(l.tracePath, path.join(REPO, '.tmp', 'scene-trace.jsonl'));
  assert.equal(l.replayPath, path.join(REPO, '.tmp', 'replay-trace.jsonl.gz'));
  assert.ok(isDefaultInstance(l.id));
  // 默认实例的 base/overlay 仍走 resolveSystemPaths（= 能继承玩家真存档；这是 Electron 现状）。
  assert.ok(l.baseDir.length > 0);
  assert.ok(l.overlayDir.length > 0);
});

test('★源码棘轮：electron/paths.ts 的三个常量确实取自 instanceLayout（口径只有一份）', () => {
  const src = fs.readFileSync(path.join(APP, 'electron', 'paths.ts'), 'utf8');
  assert.match(src, /instanceLayout\(\{\s*repoRoot:\s*REPO_ROOT\s*\}\)/, '必须用 REPO_ROOT 建默认布局');
  assert.match(src, /export const LOG_PATH = DEFAULT_LAYOUT\.logPath;/, 'LOG_PATH 必须取自布局');
  assert.match(src, /export const TRACE_PATH = DEFAULT_LAYOUT\.tracePath;/, 'TRACE_PATH 必须取自布局');
  assert.match(src, /export const REPLAY_PATH = DEFAULT_LAYOUT\.replayPath;/, 'REPLAY_PATH 必须取自布局');
  // 反例：不许再出现自己 path.join 拼日志路径（那会变成第二份口径）。
  assert.doesNotMatch(src, /path\.join\(REPO_ROOT,\s*'\.tmp',\s*'amayui-emulator\.log'\)/);
});

test('★具名实例：base/overlay/log/trace/replay 全在实例根下（不继承玩家真存档）', () => {
  const l = instanceLayout({ repoRoot: REPO, id: 'dbg-a' });
  const root = path.join(REPO, '.tmp', 'instances', 'dbg-a');
  assert.equal(l.root, root);
  assert.equal(l.baseDir, path.join(root, 'base'));
  assert.equal(l.overlayDir, path.join(root, 'overlay'));
  assert.equal(l.logPath, path.join(root, 'log', 'amayui-emulator.log'));
  assert.equal(l.tracePath, path.join(root, 'log', 'scene-trace.jsonl'));
  assert.equal(l.replayPath, path.join(root, 'log', 'replay-trace.jsonl.gz'));
  // ★关键判据：**不**等于默认实例的 base（否则会并上玩家真存档；`T-0133` §B.3.3 坑 1）。
  const dflt = instanceLayout({ repoRoot: REPO, env: {} });
  assert.notEqual(l.baseDir, dflt.baseDir);
  assert.notEqual(l.overlayDir, dflt.overlayDir);
});

test('★两个实例的五个落点两两不同（隔离的充要条件）', () => {
  const a = instanceLayout({ repoRoot: REPO, id: 'a' });
  const b = instanceLayout({ repoRoot: REPO, id: 'b' });
  const d = instanceLayout({ repoRoot: REPO, env: {} });
  const keys = ['baseDir', 'overlayDir', 'logPath', 'tracePath', 'replayPath'] as const;
  for (const k of keys) {
    assert.notEqual(a[k], b[k], `${k}: a/b 必须不同`);
    assert.notEqual(a[k], d[k], `${k}: a/default 必须不同`);
    assert.notEqual(b[k], d[k], `${k}: b/default 必须不同`);
  }
});

test('★env 是参数：覆盖生效且 `process.env` 一个字节都不改（多实例的前提）', () => {
  const before = JSON.stringify(process.env);
  const base = path.join(REPO, '.tmp', 'probe-base');
  const overlay = path.join(REPO, '.tmp', 'probe-overlay');
  const l = instanceLayout({
    repoRoot: REPO,
    env: { ...process.env, AMAYUI_SYSTEM_DIR: base, AMAYUI_OVERLAY_DIR: overlay },
  });
  assert.equal(l.baseDir, base);
  assert.equal(l.overlayDir, overlay);
  assert.equal(JSON.stringify(process.env), before, 'process.env 必须不变（多实例靠传参，不靠改全局）');
});

test('★replay 路径可被 env 指定（回放录制现状：AMAYUI_REPLAY_PATH）', () => {
  const target = path.join(REPO, '.tmp', 'probe-replay.jsonl.gz');
  const named = instanceLayout({ repoRoot: REPO, id: 'r', env: { ...process.env, AMAYUI_REPLAY_PATH: target } });
  assert.equal(named.replayPath, target);
  const dflt = instanceLayout({ repoRoot: REPO, env: { ...process.env, AMAYUI_REPLAY_PATH: target } });
  assert.equal(dflt.replayPath, target);
});

test('★用具名实例的 env 覆盖 base（"从模板 seed 一份干净档"的入口）', () => {
  const seeded = path.join(REPO, '.tmp', 'template-base');
  const l = instanceLayout({ repoRoot: REPO, id: 'seeded', baseDir: seeded });
  assert.equal(l.baseDir, seeded);
  // overlay 仍在实例根下 ⇒ 写盘不会碰模板。
  assert.equal(l.overlayDir, path.join(REPO, '.tmp', 'instances', 'seeded', 'overlay'));
});

test('★实例 id 会被拼进路径 ⇒ 非法 id 必须拒绝（防逃逸）', () => {
  for (const bad of ['../evil', 'a/b', 'a\\b', '', '   ', 'x'.repeat(65)]) {
    assert.throws(() => instanceLayout({ repoRoot: REPO, id: bad }), /非法实例 id/, `应拒绝 ${JSON.stringify(bad)}`);
  }
  for (const ok of ['a', 'dbg-1', 'run.2', 'A_b-3', DEFAULT_INSTANCE_ID]) {
    assert.doesNotThrow(() => instanceLayout({ repoRoot: REPO, id: ok }));
  }
});

test('describeInstance 摘要带实例 id（排障时一眼看出读的是哪一份）', () => {
  const l = instanceLayout({ repoRoot: REPO });
  assert.ok(describeInstance(l).includes('instance=default'));
  assert.ok(describeInstance(l).includes(l.logPath));
});
