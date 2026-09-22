/**
 * **宿主侧真实光标（`native/host-input`）** 守卫 —— `tickets/T-0053`（缺口）/ `T-0058`（Windows 落地）/
 * `T-0116`（macOS 落地）/ `T-0117`（预置产物）/ `T-0119`（两个平台实现合并成一个 addon）。
 *
 * 背景（`0x10A` 的两半件）：
 *  - **引擎侧**：`op_set_mouse_pos` → `InputManager.setCursor(x, y)` ⇒ `0x109` 读回、hover/`0x12E` 用新位置；
 *  - **宿主侧**：引擎 `sub_421EA0`（raw 30530-30598）是 `ClientToScreen` + **`SetCursorPos`** ——
 *    浏览器/Electron 没有这个 API，所以补了一个 N-API 原生模块
 *    （`native/host-input`：Windows = `SetCursorPos`、macOS = `CGWarpMouseCursorPosition`，
 *    见模块 README 与 `src/host_input.h` 的口径）。
 *
 * 本文件的断言（都**不动用户的光标**）：
 *  1. 加载器的**降级契约**：没有构建产物时必须 `available === false` + 一行 `reason`，
 *     且门面的每个函数都返回 `null`/`false`（模拟器不能因为缺原生模块起不来）；
 *  2. **搜索链顺序**（env 覆盖 → build/Release → build/<Config> → prebuilds/<platform>-<arch> →
 *     `prebuilds/<platform>-universal`）—— 顺序错了会静默加载到旧产物/单架构产物；
 *  3. 门面在不可用（或本平台没有实现）时全 `null`/`false`，且原生层抛错也被兜住；
 *  4. **真产物存在时**：只读探测（`getCursorPos`/`getVirtualScreenRect`，其它平台专有查询各自只读）
 *     必须给出合理数值（**只读**：写方向的验证在 `native/host-input/tools/smoke.cjs`，需要显式环境变量）；
 *  5. **平台专有函数在别的平台上不存在** ⇒ 门面兜成 `null`/`false`（调用方不必分平台）；
 *  6. **预置产物棘轮**（`tickets/T-0117`）：darwin 通用二进制必须在库、必须双架构、`minos` 必须 11.0
 *     —— 防"用单架构本地构建覆盖它"与"deployment target 被悄悄抬高"；
 *  7. **接线**：`0x10A` 把**同一对虚拟坐标**交给宿主缝；两个 headless 宿主把该缝实现成 no-op
 *     （否则闸门 A 会把语料 1678 处 `i10a` 全记成"宿主缺口"，纯噪声）。
 *
 * 另加三条**源码棘轮**（主进程的 IPC 换算与渲染侧换算无法在 node:test 里跑：`electron/*.ts` 依赖
 * electron 运行时；`pixiBackend.ts` 依赖浏览器）：三跳换算（客户区 → 内容区原点 → DIP→物理）、
 * 装配次序、以及渲染侧与 `inputAttach.toVirtual` 共用同一套 canvas rect。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { Engine } from '../src/vm/engine.js';
import { OPS } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import { StubNative } from '../src/vm/native.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { loc } from './harness.js';
import { enc } from '../src/vm/bits.js';
import type { BinArg, BinInstruction, ScriptBinary } from '../src/script/bin.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const NATIVE_DIR = path.join(REPO, 'native', 'host-input');
const PREBUILD = path.join(NATIVE_DIR, 'prebuilds', 'darwin-universal', 'host_input.node');
const require_ = createRequire(import.meta.url);

/** 原生模块的 JS 门面（CJS：主进程与测试都用 `require` 语义加载，避免 ESM 具名导出探测的不确定性）。 */
function loadFacade(): {
  available: boolean;
  supported: boolean;
  reason: string;
  addonPath: string | null;
  getCursorPos(): { x: number; y: number } | null;
  setCursorPos(x: number, y: number): boolean;
  getVirtualScreenRect(): { x: number; y: number; width: number; height: number } | null;
  getSystemMetrics(index: number): number | null;
  getAsyncKeyState(vk: number): number | null;
  showCursor(show: boolean): number | null;
  postMouseMove(x: number, y: number): boolean;
  isAccessibilityTrusted(): boolean;
  _loadAddon(o?: { root?: string; env?: Record<string, string | undefined>; platform?: string; arch?: string }): {
    available: boolean;
    reason: string;
    addonPath: string | null;
    tried: string[];
  };
  _candidatePaths(o?: { root?: string; env?: Record<string, string | undefined>; platform?: string; arch?: string }): string[];
  _makeFacade(api: unknown): {
    getCursorPos(): { x: number; y: number } | null;
    setCursorPos(x: number, y: number): boolean;
    getVirtualScreenRect(): { x: number; y: number; width: number; height: number } | null;
    getSystemMetrics(index: number): number | null;
    getAsyncKeyState(vk: number): number | null;
    showCursor(show: boolean): number | null;
    postMouseMove(x: number, y: number): boolean;
    isAccessibilityTrusted(): boolean;
  };
} {
  return require_(path.join(NATIVE_DIR, 'index.js'));
}

// ---------------------------------------------------------------------------
// 1) 降级契约
// ---------------------------------------------------------------------------

test('原生模块缺失 ⇒ 加载器降级为 available=false + 一行原因，门面函数全部安全空实现', () => {
  const host = loadFacade();
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'host-input-empty-'));
  try {
    const r = host._loadAddon({ root: emptyDir, env: {} });
    assert.equal(r.available, false, '空目录里不该找到 .node');
    assert.ok(r.reason.length > 0, 'reason 必须给出可读原因（诊断用）');
    assert.equal(r.addonPath, null);
    assert.ok(r.tried.length > 0, '应记录尝试过的候选路径');
    assert.ok(
      r.tried.every((t) => t.includes(emptyDir)),
      `候选路径必须落在给定 root 下（实际 ${r.tried.slice(0, 3).join(' | ')}）`,
    );
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});

test('搜索链顺序：env 覆盖 → build/Release → build/Debug → prebuilds/<platform>-<arch> → prebuilds/<platform>-universal', () => {
  const host = loadFacade();
  const root = path.join(path.sep, 'fake-root');
  const withEnv = host._candidatePaths({
    root,
    env: { AMAYUI_HOST_INPUT_NODE: path.join(root, 'custom.node') },
    platform: 'win32',
    arch: 'x64',
  });
  assert.equal(withEnv[0], path.join(root, 'custom.node'), '★env 覆盖必须排第一（打包后指向 asar.unpacked 用）');
  const noEnv = host._candidatePaths({ root, env: {}, platform: 'darwin', arch: 'arm64' });
  const idx = (needle: string): number => noEnv.findIndex((p) => p.includes(needle));
  assert.ok(idx(path.join('build', 'Release')) >= 0, 'cmake-js 默认产物 build/Release 必须在链上');
  assert.ok(
    idx(path.join('build', 'Release')) < idx(path.join('build', 'Debug')),
    'Release 必须排在 Debug 前（否则调试产物会被静默优先加载）',
  );
  assert.ok(idx(path.join('build', 'Release')) < idx('prebuilds'), '本地构建产物优先于预置产物（改了源码跑 build 即生效）');
  assert.ok(
    noEnv.some((p) => p.endsWith(path.join('prebuilds', 'darwin-arm64', 'host_input.node'))),
    '按 arch 的预编译落点必须在链上（接 prebuildify 时不用改调用方）',
  );
  assert.ok(
    noEnv.some((p) => p.endsWith(path.join('prebuilds', 'darwin-universal', 'host_input.node'))),
    '★通用（fat）二进制的兜底落点必须在链上 —— 仓库预置的就是它（tickets/T-0117）',
  );
  assert.ok(
    idx(path.join('prebuilds', 'darwin-arm64')) < idx(path.join('prebuilds', 'darwin-universal')),
    '按 arch 的落点排在通用落点之前（更具体者优先）',
  );
});

test('门面在不可用（api=null）时全函数返回 null/false，且原生层抛错也被兜住 —— 调用方零分支', () => {
  const host = loadFacade();
  const f = host._makeFacade(null);
  for (const [name, fallback] of [
    ['getCursorPos', null],
    ['getVirtualScreenRect', null],
    ['getSystemMetrics', null],
    ['getAsyncKeyState', null],
    ['showCursor', null],
  ] as const) {
    assert.equal((f as unknown as Record<string, (...a: unknown[]) => unknown>)[name](0), fallback, `${name} 必须退化成 null`);
  }
  assert.equal(f.setCursorPos(1, 2), false);
  assert.equal(f.postMouseMove(1, 2), false);
  assert.equal(f.isAccessibilityTrusted(), false);
  const boom = host._makeFacade({
    getCursorPos() {
      throw new Error('boom');
    },
    setCursorPos() {
      throw new TypeError('bad args');
    },
  });
  assert.equal(boom.getCursorPos(), null, '原生层抛错必须降级成"这次没成功"，不许让调用方崩');
  assert.equal(boom.setCursorPos(1, 2), false);
});

// ---------------------------------------------------------------------------
// 2) 真产物：只读探测 + 平台专有函数的存在性
// ---------------------------------------------------------------------------

/** 本平台的原生实现是否是「真实现」（win32 / darwin；其余平台只有空实现）。 */
const NATIVE_PLATFORM = process.platform === 'win32' || process.platform === 'darwin';

test('★E3：真产物存在时，加载成功且只读查询给出合理数值（不动光标）', (t) => {
  const host = loadFacade();
  if (!host.available) {
    t.skip(`本机没构建原生模块也没预置产物（${host.reason}）—— 跑 native/host-input 的 npm run build 后本测试会真正执行`);
    return;
  }
  assert.ok(host.addonPath && fs.existsSync(host.addonPath), `addonPath 必须存在：${host.addonPath}`);
  if (!NATIVE_PLATFORM) {
    assert.equal(host.supported, false, `非 win32/darwin（${process.platform}）：能加载但 supported=false`);
    return;
  }
  assert.equal(host.supported, true, `${process.platform} 上 supported 应为 true`);
  const p = host.getCursorPos();
  assert.ok(p && Number.isFinite(p.x) && Number.isFinite(p.y), `getCursorPos 应给出数值：${JSON.stringify(p)}`);
  const r = host.getVirtualScreenRect();
  assert.ok(r && r.width > 0 && r.height > 0, `虚拟屏矩形应有效：${JSON.stringify(r)}`);
  assert.ok(
    p.x >= r.x - 1 && p.x <= r.x + r.width + 1 && p.y >= r.y - 1 && p.y <= r.y + r.height + 1,
    `光标应落在虚拟屏内（cursor=${JSON.stringify(p)} screen=${JSON.stringify(r)}）`,
  );
});

test('★平台专有函数只在自己平台存在：别的平台上由门面兜成 null/false（调用方不必分平台）', () => {
  const host = loadFacade();
  if (process.platform === 'darwin') {
    assert.equal(typeof host.isAccessibilityTrusted(), 'boolean', 'darwin：辅助功能授权态是诊断面（只有 postMouseMove 需要它）');
    assert.equal(host.getSystemMetrics(0), null, 'win32 专有的查询在 darwin 上必须退化成 null');
    assert.equal(host.getAsyncKeyState(1), null);
    assert.equal(host.showCursor(true), null);
    return;
  }
  if (process.platform === 'win32') {
    assert.equal(typeof host.getSystemMetrics(0), 'number', 'win32：SM_* 查询是真实现');
    assert.equal(typeof host.getAsyncKeyState(1), 'number');
    assert.equal(host.postMouseMove(1, 2), false, 'darwin 专有的投递在 win32 上必须退化成 false');
    assert.equal(host.isAccessibilityTrusted(), false);
    return;
  }
  // Linux 等：一个平台函数都不注册
  assert.equal(host.supported, false);
  for (const v of [host.getSystemMetrics(0), host.getAsyncKeyState(1), host.showCursor(true), host.getCursorPos(), host.getVirtualScreenRect()]) {
    assert.equal(v, null);
  }
  assert.equal(host.setCursorPos(1, 2), false);
  assert.equal(host.postMouseMove(1, 2), false);
});

// ---------------------------------------------------------------------------
// 3) 预置产物棘轮（tickets/T-0117）
// ---------------------------------------------------------------------------

/** 取某个 slice 的最低系统版本（`LC_BUILD_VERSION.minos`，退回旧格式 `LC_VERSION_MIN_MACOSX.version`）。 */
function minOsVersion(file: string, arch: string): string | null {
  const out = execFileSync('otool', ['-l', '-arch', arch, file], { encoding: 'utf8' });
  const build = /cmd LC_BUILD_VERSION[\s\S]*?\n\s*minos\s+(\S+)/.exec(out);
  if (build) return build[1];
  const legacy = /cmd LC_VERSION_MIN_MACOSX[\s\S]*?\n\s*version\s+(\S+)/.exec(out);
  return legacy ? legacy[1] : null;
}

test('★预置产物棘轮：darwin 通用二进制（arm64 + x86_64）必须在库，且最低系统版本 = 11.0', (t) => {
  assert.ok(
    fs.existsSync(PREBUILD),
    `预置产物必须在库：${path.relative(REPO, PREBUILD)} ⇒ 跑 \`cd native/host-input && npm run build:prebuild\`（tickets/T-0117）`,
  );
  if (process.platform !== 'darwin') {
    t.skip('lipo / otool 只有 macOS 有 ⇒ 其它平台只校验"预置产物在库"');
    return;
  }
  const archs = execFileSync('lipo', ['-archs', PREBUILD], { encoding: 'utf8' });
  assert.deepEqual(
    archs.trim().split(/\s+/).sort(),
    ['arm64', 'x86_64'],
    '★必须是**通用二进制** —— 单架构的本地构建产物（`build/Release`）不许覆盖这份预置（改 src 后要重跑 build:prebuild）',
  );
  for (const arch of ['arm64', 'x86_64']) {
    const minos = minOsVersion(PREBUILD, arch);
    assert.ok(minos, `${arch} slice 里找不到最低系统版本标记（LC_BUILD_VERSION / LC_VERSION_MIN_MACOSX）`);
    assert.equal(minos, '11.0', `★${arch} 的 deployment target 必须是 11.0（被抬高 ⇒ 旧系统装不上；由 CMakeLists.txt 顶部的 CMAKE_OSX_DEPLOYMENT_TARGET 决定）`);
  }
});

test('★预置产物就是"没编译器也能用"的那条路：加载器在 build/ 不存在时会命中 prebuilds/', () => {
  const host = loadFacade();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'host-input-prebuilt-'));
  try {
    // 只把预置产物按落点约定放好（模拟「clone 下来、没跑过 build」的机器）。
    // ★平台显式传 darwin：本文件在任何平台上都要跑（Windows 开发机也不该红）。
    const dir = path.join(root, 'prebuilds', `darwin-${process.arch}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(PREBUILD, path.join(dir, 'host_input.node'));
    const r = host._loadAddon({ root, env: {}, platform: 'darwin', arch: process.arch });
    assert.equal(r.available, true, `按 arch 的落点应能加载：${r.reason}`);
    assert.equal(r.addonPath, path.join(dir, 'host_input.node'));
    // 通用落点同样认得（`darwin-universal` 不随 process.arch 变）。
    const dir2 = path.join(root, 'prebuilds', 'darwin-universal');
    fs.mkdirSync(dir2, { recursive: true });
    fs.copyFileSync(PREBUILD, path.join(dir2, 'host_input.node'));
    const r2 = host._loadAddon({ root, env: { AMAYUI_HOST_INPUT_NODE: '' }, platform: 'darwin', arch: 'x64' });
    assert.equal(r2.addonPath, path.join(dir2, 'host_input.node'), 'x64 上应命中通用落点（按 arch 的目录不存在）');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4) 接线：0x10A 把同一对坐标交给宿主缝
// ---------------------------------------------------------------------------

/** 合成一条 `i10a`（0x10A）并执行；`seen` 收集宿主缝收到的坐标。 */
async function runSetMousePos(x: number, y: number): Promise<{ seen: [number, number][]; engineX: number; engineY: number }> {
  const seen: [number, number][] = [];
  const native = new StubNative(() => {});
  // 只替换这一条缝（其它照旧走 StubNative）—— 记录宿主收到了什么。
  (native as unknown as { setSystemCursor(x: number, y: number): void }).setSystemCursor = (a, b) => {
    seen.push([a, b]);
  };
  const e = new Engine(native);
  const args: BinArg[] = [loc(0x10), loc(0x11)];
  const instr = { opcode: 0x10a, name: 'i10a', argc: 2, args, byteOffset: 0, index: 0 } as unknown as BinInstruction;
  // 先把两个操作数槽写成目标值（脚本里通常来自 read-mouse-pos / 常量）。
  // ★局部 int 池存的是 **ENC 位模式**（`enc(e.key, v)`）——直接写明文会让 `readIntOperand` 解出别的东西。
  e.curScript().locals.int.set(0x10, enc(e.key, x));
  e.curScript().locals.int.set(0x11, enc(e.key, y));
  const script: ScriptBinary = {
    signature: 'SYS0000',
    isVer5: false,
    headerLen: 0,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [],
    instructions: [instr],
    labelTargets: new Set<number>(),
    dwordToInstr: [0],
    raw: new Uint8Array(0),
  };
  e.curScript().script = script;
  await OPS.get(0x10a)!(makeCtx(e, e.curScript(), instr, native, () => {}));
  return { seen, engineX: e.input.readX(), engineY: e.input.readY() };
}

test('0x10A：宿主缝收到**与引擎侧同一对**虚拟坐标（两半件不许各算一套）', async () => {
  const { seen, engineX, engineY } = await runSetMousePos(1220, 360);
  assert.deepEqual(seen, [[1220, 360]], '宿主缝必须被调用一次，且参数就是 i10a 的两个操作数');
  assert.equal(engineX, 1220, '引擎侧坐标（0x109 的真源）');
  assert.equal(engineY, 360);
});

test('headless 宿主把 setSystemCursor 实现成 no-op（不是"缺缝"⇒ 不灌噪声进闸门 A）', () => {
  const stub = new StubNative(() => {});
  assert.equal(typeof stub.setSystemCursor, 'function', 'StubNative 必须实现这条缝');
  assert.equal((stub as unknown as { setSystemCursor(x: number, y: number): void }).setSystemCursor(1, 2), undefined);
  const scene = new HeadlessScene({});
  assert.equal(typeof scene.setSystemCursor, 'function', 'HeadlessScene 必须实现这条缝');
  assert.equal((scene as unknown as { setSystemCursor(x: number, y: number): void }).setSystemCursor(1, 2), undefined);
});

// ---------------------------------------------------------------------------
// 5) 源码棘轮：主进程的三跳换算与装配次序（`electron/*.ts` 依赖 electron 运行时，无法 import 进测试）
// ---------------------------------------------------------------------------

test('★主进程换算棘轮：客户区 → 内容区原点 → DIP→物理（缺最后一跳 ⇒ 缩放≠100% 时光标挪偏）', () => {
  const src = fs.readFileSync(path.join(REPO, 'app', 'amayui-emulator', 'electron', 'nativeAddon.ts'), 'utf8');
  assert.match(src, /ipcMain\.on\('set-system-cursor'/, '必须注册 set-system-cursor 通道');
  assert.match(src, /win\.getContentBounds\(\)/, '必须补上窗口内容区原点（DIP 屏幕坐标）');
  assert.match(src, /screen\.dipToScreenPoint\(dip\)/, '★必须做 DIP→物理（SetCursorPos 吃物理像素）');
  // ★最后一跳是「有则用」：macOS 没有 dipToScreenPoint（它的屏幕坐标本来就是点）⇒ 不许写成无条件调用。
  assert.match(src, /typeof screen\.dipToScreenPoint === 'function'/, '★Windows 才做 DIP→物理（macOS 做了就是双重换算）');
  assert.match(src, /host\.setCursorPos\(phys\.x, phys\.y\)/, '最后落到原生模块的 setCursorPos');
  assert.match(src, /if \(!host \|\| !host\.supported\)/, '不可用时必须降级（只记一行诊断，不抛错）');
  // ★模块是一个而不是"按平台挑一个"（tickets/T-0119）：加载的是 host-input。
  assert.match(src, /const HOST_MODULE = 'host-input'/, '★只加载 native/host-input（一个 addon 两个平台实现）');
  assert.match(src, /'\[native\] host-input available='/);
  const preload = fs.readFileSync(path.join(REPO, 'app', 'amayui-emulator', 'electron', 'preload.ts'), 'utf8');
  assert.match(preload, /setSystemCursor: \(clientX: number, clientY: number\)/, 'preload 必须把通道暴露给渲染进程');
  const main = fs.readFileSync(path.join(REPO, 'app', 'amayui-emulator', 'electron', 'main.ts'), 'utf8');
  const iLog = main.indexOf('registerLogIpc()');
  const iNative = main.indexOf('initNativeAddon()');
  assert.ok(iLog >= 0 && iNative > iLog, '★initNativeAddon() 必须在 registerLogIpc() 之后（否则那行诊断丢进空实现）');
});

test('★渲染侧换算棘轮：虚拟→客户区用的是 `inputAttach.toVirtual` 的同一套 rect（互为逆运算）', () => {
  const src = fs.readFileSync(path.join(REPO, 'app', 'amayui-emulator', 'src', 'renderer', 'pixiBackend.ts'), 'utf8');
  const m = /setSystemCursor\(x: number, y: number\): void \{[\s\S]{0,600}?\n  \}/.exec(src);
  assert.ok(m, 'PixiBackend 必须实现 setSystemCursor');
  assert.match(m![0], /getBoundingClientRect\(\)/, '必须用同一个 canvas rect（与 toVirtual 互为逆）');
  assert.match(m![0], /VIEW_W/, '必须按虚拟宽换算');
  assert.match(m![0], /window\.api\?\.setSystemCursor\?\./, '必须经 IPC 交给主进程，且允许通道缺失');
});

test('★工具棘轮：`tools/verify-cursor.cjs` 与合并后的模块保持一致（它只能在 Electron 里跑，`npm test` 抓不到 ReferenceError）', () => {
  const src = fs.readFileSync(path.join(REPO, 'app', 'amayui-emulator', 'tools', 'verify-cursor.cjs'), 'utf8');
  assert.match(src, /'native', 'host-input'/, '必须加载 native/host-input（一个 addon 两个平台实现，不再按平台挑路径）');
  assert.doesNotMatch(
    src,
    /\bMODULE\b/,
    '★不许再引用已删除的 `MODULE` 绑定 —— 合并（`tickets/T-0119`）时就手滑留了一处，`npm test` 全绿但这个工具在 Electron 里当场 ReferenceError',
  );
  assert.match(src, /AMAYUI_CURSOR_VERIFY/, 'T-0058 的证据锚点（"默认不动鼠标"的开关）必须保留');
});
