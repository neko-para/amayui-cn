/** @tier T0 @kind core @subsystem host */
/**
 * **二进制腿不许被 `number[]`/base64 拖回去**（`tickets/T-0180` ①+②）的守卫。
 *
 * 背景（都是实测，不是估算）：
 *  - `Array.from(uint8)` 把 1MB 的资源变成 `number[]` 要 **40ms / +33.9MB 堆**，3.7MB 的要 **131ms / +89.7MB**
 *    （同样的字节走 `Uint8Array` 直传是 0.1 / 1.1 / 3.6ms）—— 而两条传输腿（web 的二进制响应体、
 *    Electron 的结构化克隆）本来就能直接搬 typed array；
 *  - `capture` 的 PNG 若塞进 `debug-query` 的 JSON 回执，要付 base64（+33% 膨胀）+ `stringify` 3.6ms
 *    + `parse` 1.7ms + 解码 0.6ms。
 *
 * 守两件事：
 *  ① **host 读出来的就是 `Uint8Array`**（行为）：`HostService.readScript/readFile` 直接给 `fileSource`
 *     的那份字节，**不**经 `Array.from`；渲染侧的 `FileSource` 也真的能把它交给 VM；
 *  ② **接线**（棘轮）：① 的四个落点与 ② 的"宿主落盘"四段接线 —— 少任何一条，优化就会**静默消失**
 *     （退回 `number[]` 或退回 base64 都不会让别的东西变红，只会让卡顿/内存悄悄回来）。
 *
 * ★T0（纯合成）：实例建在 `.tmp/` 下的 `mkdtemp` 里、资源根指向**不存在**的目录 ⇒ 不读未入库真资产。
 */
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as fss from 'node:fs';
import * as path from 'node:path';

import { createHostService, type HostService } from '../src/host/service.js';
import { IpcFileSource } from '../src/renderer/ipcFileSource.js';

const APP = path.resolve(import.meta.dirname, '..');
const REPO = path.resolve(APP, '..', '..');
const TMP = path.join(APP, '.tmp');

/** 读源码（棘轮用）。 */
const read = (rel: string): string => fss.readFileSync(path.join(APP, rel), 'utf8');

/** 一个临时实例（资源根指向不存在的目录 ⇒ 绝不读真资产）。 */
async function tempInstance(t: TestContext, tag: string): Promise<{ root: string; svc: HostService }> {
  await fs.mkdir(TMP, { recursive: true });
  const root = await fs.mkdtemp(path.join(TMP, `t0180-bin-${tag}-`));
  const svc = createHostService({
    id: `bin-${tag}`,
    repoRoot: REPO,
    root,
    resourceDir: path.join(root, 'no-resources'),
    env: {},
  });
  t.after(async () => {
    await svc.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, svc };
}

test('★① readFile 原样透传 Uint8Array（不是 number[]，也不经 Array.from）', async (t) => {
  const { root, svc } = await tempInstance(t, 'readfile');
  const p = path.join(root, 'payload.bin');
  const bytes = Buffer.alloc(4096);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) & 0xff;
  await fs.writeFile(p, bytes);

  const got = await svc.readFile(p);
  assert.ok(got instanceof Uint8Array, '必须是 Uint8Array（number[] 会在传输腿前被放大 3~10 倍）');
  assert.equal(Array.isArray(got), false, '不许退化成数组');
  assert.equal(got.length, bytes.length);
  assert.deepEqual([...got.subarray(0, 8)], [...bytes.subarray(0, 8)], '字节要逐字一致');
  assert.deepEqual([...got.subarray(-8)], [...bytes.subarray(-8)], '尾部也要一致（别只搬了前一段）');
});

test('★② 调试产物：宿主自己落盘，回执只有路径（纯文件名白名单挡住路径穿越）', async (t) => {
  const { root, svc } = await tempInstance(t, 'artifact');

  // ① 正常一次：字节真的落在**本实例**的产物目录里
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  const ok = await svc.writeDebugArtifact('capture-20260101-000000-1.png', png);
  assert.ok(ok, '合法名字 + 非空字节 ⇒ 必须落盘');
  assert.equal(ok!.path, 'capture-20260101-000000-1.png', '`path` 是纯文件名（与"宿主写 <dir>/<name>"自洽）');
  const onDisk = await fs.readFile(path.join(ok!.dir, ok!.path));
  assert.deepEqual([...onDisk], [...png], '落盘的字节必须与给的一模一样（PNG 头不能被谁改写）');
  // ★默认实例的产物目录就是插件读的那处（插件固定看 `<repo>/.tmp/emudbg/`）
  assert.equal(
    svc.layout.debugArtifactDir,
    path.join(root, 'emudbg'),
    '具名实例的产物落**实例自己的根**下（与 base/overlay/log 同一份隔离）',
  );

  // ② 名字是不可信输入：路径穿越/绝对路径/非法扩展名一律**拒绝且不落盘**
  for (const bad of ['../../escape.png', 'a/b.png', '..', '', '/abs.png', 'x.exe']) {
    assert.equal(await svc.writeDebugArtifact(bad, png), null, `必须拒绝 ${JSON.stringify(bad)}`);
  }
  const entries = await fs.readdir(root);
  assert.deepEqual(
    entries.filter((e) => e !== 'overlay' && e !== 'base' && e !== 'log' && e !== 'no-resources'),
    ['emudbg'],
    '被拒的名字不许在实例根里留下任何东西（只有那一个产物目录）',
  );
  assert.deepEqual(await fs.readdir(path.join(root, 'emudbg')), ['capture-20260101-000000-1.png'], '被拒的没落盘');

  // ③ 空字节不当产物（避免留下 0B 的假 PNG 让后来者以为抓到了）
  assert.equal(await svc.writeDebugArtifact('empty.png', new Uint8Array(0)), null);
});

test('★① 渲染侧 FileSource 收下 Uint8Array 后原样交给 VM（不再依赖 number[]）', async () => {
  const script = new Uint8Array([1, 2, 3, 4, 5]);
  const raw = new Uint8Array([9, 8, 7]);
  const prev = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    api: {
      // ★返回形状就是主进程/结构克隆给的那份（typed array；老实现是 number[]，这里刻意只喂 typed array
      //   ⇒ 若 IpcFileSource 还指望数组语义，这条会红）。
      readScript: async () => ({ index: 7, name: 'A.BIN', data: script }),
      readFile: async () => raw,
    },
  };
  try {
    const fsSrc = new IpcFileSource();
    const s = await fsSrc.readScript(7);
    assert.ok(s, 'readScript 要命中');
    assert.ok(s!.data instanceof Uint8Array, '脚本字节必须是 Uint8Array');
    assert.deepEqual([...s!.data], [...script], '字节要一致（不能因为换类型丢内容）');
    assert.ok((await fsSrc.readFile('x')) instanceof Uint8Array, 'readFile 也必须给 Uint8Array');
  } finally {
    if (prev === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = prev;
  }
});

test('★接线棘轮：两条优化缺任何一段都会静默失效（退回 number[] / 退回 base64）', () => {
  const service = read('src/host/service.ts');
  const webHost = read('src/web/host.ts');
  const protocol = read('src/renderer/ipcProtocol.ts');
  const bridge = read('src/renderer/webBridge.ts');
  const preload = read('electron/preload.ts');
  const ipc = read('electron/ipc/files.ts');
  const session = read('src/renderer/app/session.ts');
  const instance = read('src/host/instance.ts');

  // ---- ① `number[]` 不许在这条路上出现 ----
  assert.doesNotMatch(service, /data:\s*number\[\]/, 'HostService 的脚本字节不许声明成 number[]');
  assert.doesNotMatch(service, /=\s*Array\.from\(|return\s+Array\.from\(/, '槽/文件的读取不许再摊成数组（注释里提"实测开销"是允许的）');
  assert.doesNotMatch(webHost, /Uint8Array\.from\(/, 'web 宿主不许再复制一份字节（r.data 本来就是 typed array）');
  assert.doesNotMatch(protocol, /data:\s*number\[\]/, '`Window.api` 的脚本字节不许声明成 number[]');
  assert.doesNotMatch(preload, /readFile:.*number\[\]/, 'preload 的 readFile 不该再有 number[] 口径');
  assert.doesNotMatch(preload, /readScript.*data:number\[\]/, 'preload 的 readScript 声明也不许退回 number[]');
  assert.match(service, /async readFile\(p: string\): Promise<Uint8Array>/, 'readFile 的返回类型要写死 Uint8Array');

  // ---- ② `capture` 的 PNG 不许回到 JSON 腿（除非宿主没有那条通道 ⇒ 显式回退）----
  assert.match(service, /async writeDebugArtifact\(/, 'HostService 要有落盘缝');
  assert.match(instance, /debugArtifactDir/, 'InstanceLayout 要给出产物目录');
  assert.match(webHost, /case 'write-debug-artifact'/, 'web 宿主要有这条路（DSH 形态唯一的路）');
  assert.match(bridge, /writeDebugArtifact:\s*async/, 'web 桥要暴露它（走 octet-stream 上行）');
  assert.match(preload, /write-debug-artifact/, 'Electron preload 要有这条通道');
  assert.match(ipc, /write-debug-artifact/, 'Electron 主进程要有这个 handler');
  assert.match(session, /#writeDebugArtifact\(/, '渲染侧的 capture 要走落盘缝');
  assert.match(
    session,
    /png:\s*bytesToBase64\(png\)/,
    '并且**保留**"宿主没有该缝时回退 base64"（缺了它旧 preload 就彻底抓不到帧）',
  );
  assert.match(
    session,
    /if \(!fn\) return null/,
    '回退判据必须是"通道不存在"，不是"写失败了就偷偷塞 base64"（后者会把 1.8MB 悄悄塞回上下文）',
  );

  // ---- ② 的**消费侧**：回执里没有 `png` 了，谁还只认它就等于哑掉 ----
  //   `debugsrv.cjs` 的 `rendererCapturePng` 是 `dbg.cjs shot/screencap` 与 `capture <路径>` 的公共入口；
  //   它必须**优先读宿主落盘的那份**，只在旧宿主回 base64 时才解码（行为在下面那条测试里实测）。
  const debugsrv = read('tools/debugsrv.cjs');
  assert.match(debugsrv, /r\?\.path[\s\S]{0,400}?fs\.readFileSync/, '`rendererCapturePng` 要读宿主落盘的文件');
  assert.match(debugsrv, /const b64 = r\?\.png/, '并且保留旧宿主（`png` = base64）的读法');
  assert.match(read('tools/webhost-shot.cjs'), /cap\.json\.path/, 'webhost-shot 的 capture 也要认新形状');
});

/**
 * **把 `tools/debugsrv.cjs` 里的 `rendererCapturePng` 抠出来实测**（`tickets/T-0180` ② 的消费侧）。
 *
 * 为什么值得这么麻烦：那个函数是 `dbg.cjs shot` / `screencap` / `capture <路径>` 的**唯一公共入口**，
 * 而它在守护进程里（要起 Electron 才跑得到）。★但它的失败模式是**静默哑掉**：回执从 base64 换成
 * `{path,dir}` 之后，只认 `png` 的旧写法会让"抓帧"整条命令报"渲染窗没给出 PNG" —— 看起来像渲染页坏了。
 * 所以这里把函数体原样抠出来，喂三种回执（新形状 / 旧形状 / 报错）实测。
 */
test('★② 消费侧：`rendererCapturePng` 要认新形状（读回宿主落盘的那份）、也仍认旧形状（base64）', async (t) => {
  const src = read('tools/debugsrv.cjs');
  const start = src.indexOf('async function rendererCapturePng(');
  assert.ok(start >= 0, 'debugsrv.cjs 里必须有 rendererCapturePng');
  // ★按**花括号配平**切（不是找换行）：这个函数的注释里就有 `{path,dir,bytes}` 这类花括号。
  let depth = 0;
  let end = -1;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  assert.ok(end > start, '函数体要能配平切出来');
  const body = src.slice(start, end);
  // 依赖注入：函数体只用到 fs / path / 一个 debug-query 往返 ⇒ 三者都从外面给。
  const made: string[] = [];
  const makeRendererCapture = (reply: unknown): (() => Promise<Uint8Array>) =>
    new Function(
      'sendDebugQuery',
      'fs',
      'path',
      `${body}\nreturn rendererCapturePng;`,
    )(
      async () => reply,
      {
        readFileSync: (p: string) => {
          made.push(p);
          if (p === path.join('D:', 'dir', 'x.png')) return Buffer.from([1, 2, 3]);
          throw new Error('ENOENT: no such file');
        },
      },
      path,
    ) as () => Promise<Uint8Array>;

  // ① 新形状：宿主已落盘 ⇒ 读回 `<dir>/<path>`
  made.length = 0;
  const a = await makeRendererCapture({ ok: true, path: 'x.png', dir: path.join('D:', 'dir'), bytes: 3 })();
  assert.deepEqual([...a], [1, 2, 3], '必须读回宿主写的那份字节（不是去解 base64）');
  assert.deepEqual(made, [path.join('D:', 'dir', 'x.png')], '拼的路径必须是 <dir>/<path>');

  // ② 旧形状（旧宿主）：仍能 base64 解码
  const old = Buffer.from([9, 9, 9, 9]).toString('base64');
  const b = await makeRendererCapture({ ok: true, png: old })();
  assert.deepEqual([...b], [9, 9, 9, 9], '旧宿主回 base64 时不许哑掉');

  // ③ 真错（渲染窗 ok:false）：必须抛出并带上它给的那句话
  await assert.rejects(
    () => makeRendererCapture({ ok: false, lines: ['capture：当前宿主没有 capture 能力'] })(),
    /没有 capture 能力/,
  );
  // ④ 报了路径但文件读不回来：也要抛（不能静默回 0 字节的"图"）
  await assert.rejects(
    () => makeRendererCapture({ ok: true, path: 'missing.png', dir: path.join('D:', 'dir') })(),
    /读不回来/,
  );
});
