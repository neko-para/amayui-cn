/** @tier T0 @kind core @subsystem host */

/**
 * **宿主服务（HostService）守卫** —— `tickets/T-0134` WS-3（设计来源 `tickets/T-0133` §B.3）。
 *
 * 守的是"把 Electron IPC 里的单例下沉成传输中立、每实例一份的 Node 服务"这件事的四条硬判据：
 *  1. **写盘只落该实例的 `overlayDir`**（不碰默认实例 / 仓库 `.tmp` 那套现状落点）；
 *  2. **防丢键棘轮不变**（新文本键数 < 现有 ⇒ 拒绝回写）；
 *  3. **两个实例的 log/trace/replay 两两不同**，且可以同时创建、同时写；
 *  4. **`src/host/service.ts` 零 `electron` import**，且**不改 `process.env`**
 *     （多实例靠传参，不靠改全局 —— 这是 `T-0133` §B.3.3 坑 2）。
 *
 * ★T0（纯合成）：实例建在 `app/amayui-emulator/.tmp/` 下的 `mkdtemp` 临时目录里，
 *   资源根显式指向**不存在的目录** ⇒ 绝不读 `install/`·`raw/` 那类未入库真资产，也绝不写仓库现状路径。
 *   默认实例的落点（`instanceLayout({repoRoot})`）只用来做"没被动过"的对照。
 */
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { createHostService, defaultHostService, type HostService } from '../src/host/service.js';
import { instanceLayout } from '../src/host/instance.js';

/** `app/amayui-emulator/`。 */
const APP = path.resolve(import.meta.dirname, '..');
/** 仓库根（`app/amayui-emulator/test` 往上三级；与 `electron/paths.ts` 的 REPO_ROOT 同指一处）。 */
const REPO = path.resolve(APP, '..', '..');
/** 本工程的临时草稿区（gitignored；实例目录建在它下面）。 */
const TMP = path.join(APP, '.tmp');

/** 文件存在与否（不抛）。 */
async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** 一个临时实例：`root` 在 `.tmp/` 下、资源根指向不存在的目录、`env` 显式给空（不吃开发机环境变量）。 */
interface TempInstance {
  root: string;
  svc: HostService;
}

async function tempInstance(t: TestContext, tag: string): Promise<TempInstance> {
  await fs.mkdir(TMP, { recursive: true });
  const root = await fs.mkdtemp(path.join(TMP, `host-svc-${tag}-`));
  const svc = createHostService({
    id: `svc-${tag}`,
    repoRoot: REPO,
    root, // 具名实例的自定义根 ⇒ base=<root>/base、overlay=<root>/overlay，全在临时区里
    resourceDir: path.join(root, 'no-resources'), // 不存在的资源根 ⇒ 绝不读真资产
    env: {},
  });
  t.after(async () => {
    await svc.close(); // 先排空 gzip 回放流，再删目录
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, svc };
}

test('★写盘只落该实例的 overlayDir（仓库 .tmp 的现状落点一个字节都不动）', async (t) => {
  // ★先取对照：默认实例（= 重构前 Electron 的落点）的那两份文件现在是什么状态，写完必须原样。
  const dflt = instanceLayout({ repoRoot: REPO, env: {} });
  const defaultDat = path.join(dflt.overlayDir, 'SAVE', 'SAVE.DAT');
  const defaultSlot = path.join(dflt.overlayDir, 'SAVE', 'SAVE00.DAT');
  const before = { dat: await exists(defaultDat), slot: await exists(defaultSlot) };

  const { root, svc } = await tempInstance(t, 'write');
  const w = await svc.writeSaveData(new Uint8Array([1, 2, 3, 4]));
  const s = await svc.writeSaveSlot(0, new Uint8Array([9, 8, 7]));

  // ① 文件真的落在**这个实例**的 overlay 里（`OverlayDir` 只写 overlay）
  const dat = path.join(root, 'overlay', 'SAVE', 'SAVE.DAT');
  const slot = path.join(root, 'overlay', 'SAVE', 'SAVE00.DAT');
  assert.equal(await exists(dat), true, `writeSaveData 必须落在实例 overlay：${dat}`);
  assert.equal(await exists(slot), true, `writeSaveSlot 必须落在实例 overlay：${slot}`);
  assert.equal((await fs.readFile(dat)).length, 4);
  assert.equal((await fs.readFile(slot)).length, 3);
  assert.equal(w?.path, dat, 'writeSaveData 返回的落点必须是实例里的那份');
  // ② 不在**仓库的真 `.tmp`**（默认实例的 root）下面
  const realTmp = path.join(REPO, '.tmp');
  for (const p of [dat, slot]) {
    assert.equal(p.startsWith(realTmp + path.sep), false, `${p} 不得落在仓库 .tmp 里`);
  }
  // ③ 默认实例的 overlay（重构前的落点）在这次写前后**没有任何变化**
  assert.equal(await exists(defaultDat), before.dat, '默认实例的 SAVE.DAT 不得被这次写创建/删除');
  assert.equal(await exists(defaultSlot), before.slot, '默认实例的 SAVE00.DAT 不得被这次写创建/删除');
  assert.equal(s, null, 'writeSaveSlot 的返回形状与重构前一致（成功 = null）');
});

test('★防丢键棘轮：新文本键数 < 现有 ⇒ 拒绝（真实现在 HostService）', async (t) => {
  const { root, svc } = await tempInstance(t, 'ratchet');
  const big = '[SECTION]\nA=1\nB=2\nC=3\n';
  const small = '[SECTION]\nA=1\n';

  // 没有可比的那份（首次启动）⇒ 放行
  assert.equal(svc.configRatchetOk(big, null), true);
  // 键数变少 ⇒ 拒绝；键数持平/变多 ⇒ 放行
  assert.equal(svc.configRatchetOk(small, big), false, '3 个键 → 1 个键必须被拒绝');
  assert.equal(svc.configRatchetOk(big, big), true);
  assert.equal(svc.configRatchetOk(`${big}D=4\n`, big), true);

  // 端到端：盘上没有旧份 ⇒ 先写成功；再拿小份覆盖 ⇒ 被棘轮拒掉（盘上仍是大的那份）
  assert.deepEqual(await svc.saveConfigIni(big), { path: path.join(root, 'overlay', 'SYS4REG.INI') });
  assert.equal(await svc.saveConfigIni(small), null, '少键回写必须返回 null（不落盘）');
  const back = await svc.readConfigIni();
  assert.equal(back?.text, big, '被拒之后盘上必须仍是原来那份');
  assert.equal(back?.side, 'overlay');
  // 空文本/非字符串：与重构前 `save-config-ini` 同口径（返回 null，不写）
  assert.equal(await svc.saveConfigIni(''), null);
});

test('★两个实例：六个落点两两不同，且可同时创建/同时写（互不踩）', async (t) => {
  const a = await tempInstance(t, 'iso-a');
  const b = await tempInstance(t, 'iso-b');
  assert.notEqual(a.svc.layout.id, b.svc.layout.id);
  for (const k of ['root', 'baseDir', 'overlayDir', 'logPath', 'tracePath', 'replayPath'] as const) {
    assert.notEqual(a.svc.layout[k], b.svc.layout[k], `${k} 必须两两不同（否则两个实例会互相串）`);
  }
  assert.notEqual(a.svc.log, b.svc.log, '两个实例的 appender 必须是各自的（不是共享单例）');

  // 并发写：各写各的 overlay，谁都不许覆盖谁
  await Promise.all([a.svc.writeSaveData(new Uint8Array([1])), b.svc.writeSaveData(new Uint8Array([2]))]);
  const da = await fs.readFile(path.join(a.root, 'overlay', 'SAVE', 'SAVE.DAT'));
  const db = await fs.readFile(path.join(b.root, 'overlay', 'SAVE', 'SAVE.DAT'));
  assert.deepEqual([...da], [1]);
  assert.deepEqual([...db], [2]);
});

test('★`defaultHostService()` 是 memo 的（Electron 两个模块必须拿到同一个实例）', async (t) => {
  await fs.mkdir(TMP, { recursive: true });
  const root = await fs.mkdtemp(path.join(TMP, 'host-svc-memo-'));
  const first = defaultHostService({
    id: 'svc-memo',
    repoRoot: REPO,
    root,
    resourceDir: path.join(root, 'no-resources'),
    env: {},
  });
  t.after(async () => {
    await first.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  // ★不给参数也应拿到同一个对象（此后忽略参数）；`files.ts` 与 `logging.ts` 靠这条共享 appenders。
  const second = defaultHostService();
  assert.equal(second, first);
  assert.equal(second.layout.logPath, first.layout.logPath);
});

test('★源码棘轮：service.ts 零 electron import；建实例不改 `process.env`', async (t) => {
  // ① 传输中立：`src/host/service.ts` 的 import/动态 import 都不许指向 electron
  const src = await fs.readFile(path.join(APP, 'src', 'host', 'service.ts'), 'utf8');
  const importLines = src
    .split('\n')
    .filter((l) => /^\s*(import|export)\b/.test(l) || /^\s*\}\s*from\b/.test(l));
  const bad = importLines.filter((l) => /['"]electron(?:['"/])/.test(l));
  assert.deepEqual(bad, [], `src/host/service.ts 必须零 electron import：\n  ${bad.join('\n  ')}`);
  const codeLines = src.split('\n').map((l) => l.replace(/\/\/.*$/, ''));
  assert.equal(
    codeLines.some((l) => /import\s*\(\s*['"]electron/.test(l)),
    false,
    '动态 import(electron) 同样不行（宿主服务必须能在纯 Node 下跑）',
  );

  // ② 多实例靠**传参**：env 只是入参，`process.env` 一个字节都不许动
  await fs.mkdir(TMP, { recursive: true });
  const root = await fs.mkdtemp(path.join(TMP, 'host-svc-env-'));
  const before = JSON.stringify(process.env);
  const svc = createHostService({
    id: 'svc-env',
    repoRoot: REPO,
    root,
    resourceDir: path.join(root, 'no-resources'),
    env: { ...process.env, AMAYUI_OVERLAY_DIR: path.join(root, 'env-overlay') },
  });
  t.after(async () => {
    await svc.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  assert.equal(JSON.stringify(process.env), before, 'process.env 必须一个字节都不变');
  // env 参数确实生效（而不是被忽略）⇒ 多实例的隔离入口是它
  assert.equal(svc.layout.overlayDir, path.join(root, 'env-overlay'));
});

test('★锚点棘轮：files.ts 的四个字面串仍在；logging.ts 的同步落尾仍走服务', async () => {
  const filesSrc = await fs.readFile(path.join(APP, 'electron', 'ipc', 'files.ts'), 'utf8');
  for (const anchor of [
    'read-save-slot',
    "ipcMain.handle('write-save-data'",
    'function configRatchetOk',
    'read-save-data-both',
  ]) {
    assert.ok(filesSrc.includes(anchor), `files.ts 必须仍含锚点字面串 ${JSON.stringify(anchor)}`);
  }
  const loggingSrc = await fs.readFile(path.join(APP, 'electron', 'logging.ts'), 'utf8');
  assert.ok(loggingSrc.includes("'log-line-sync'"), 'logging.ts 的通道名不得改');
  assert.match(loggingSrc, /svc\.logSync\(line\)/, 'log-line-sync 必须走服务的同步落尾（不得改成异步）');
});
