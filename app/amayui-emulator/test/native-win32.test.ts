/**
 * **宿主侧真实光标（`native/win32-input`）** 守卫 —— `tickets/T-0053`（缺口）/ `T-0058`（落地）。
 *
 * 背景（`0x10A` 的两半件）：
 *  - **引擎侧**：`op_set_mouse_pos` → `InputManager.setCursor(x, y)` ⇒ `0x109` 读回、hover/`0x12E` 用新位置；
 *  - **宿主侧**：引擎 `sub_421EA0`（raw 30530-30598）是 `ClientToScreen` + **`SetCursorPos`** ——
 *    浏览器/Electron 没有这个 API，所以补了一个 N-API 原生模块（CMake + C++ + node-addon-api）。
 *
 * 本文件的四条断言（都**不动用户的光标**）：
 *  1. 加载器的**降级契约**：没有构建产物时必须 `available === false` + 一行 `reason`，
 *     且门面的每个函数都返回 `null`/`false`（模拟器不能因为缺原生模块起不来）；
 *  2. 搜索链顺序（env 覆盖 → build/Release → build/<Config> → prebuilds）—— 将来接 `prebuildify` / 打包
 *     成 asar 时靠它指路，顺序错了会静默加载到旧产物；
 *  3. **真产物存在时**：只读探测（`getCursorPos`/`getVirtualScreenRect`）必须给出合理的数值
 *     （**只读**：写方向的验证在 `native/win32-input/tools/smoke.cjs`，需要显式环境变量）；
 *  4. **接线**：`0x10A` 必须把**同一对虚拟坐标**交给宿主缝；两个 headless 宿主必须把该缝实现成
 *     no-op（否则闸门 A 会把语料 1678 处 `i10a` 全记成"宿主缺口"，纯噪声）。
 *
 * 另加两条**源码棘轮**（主进程的 IPC 换算无法在 node:test 里跑：`electron/*.ts` 依赖 `electron` 运行时）：
 * 三跳换算（虚拟→客户区→屏幕 DIP→物理）与 `main.ts` 的装配次序。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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
const NATIVE_DIR = path.join(REPO, 'native', 'win32-input');
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
  _loadAddon(o?: { root?: string; env?: Record<string, string | undefined> }): {
    available: boolean;
    reason: string;
    addonPath: string | null;
    tried: string[];
  };
  _candidatePaths(o?: { root?: string; env?: Record<string, string | undefined>; platform?: string; arch?: string }): string[];
} {
  return require_(path.join(NATIVE_DIR, 'index.js'));
}

// ---------------------------------------------------------------------------
// 1) 降级契约
// ---------------------------------------------------------------------------

test('原生模块缺失 ⇒ 加载器降级为 available=false + 一行原因，门面函数全部安全空实现', () => {
  const w32 = loadFacade();
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'win32-input-empty-'));
  try {
    const r = w32._loadAddon({ root: emptyDir, env: {} });
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

test('搜索链顺序：env 覆盖 → build/Release → build/<Config> → prebuilds/<platform>-<arch>', () => {
  const w32 = loadFacade();
  const root = path.join('X:', 'fake-root');
  const withEnv = w32._candidatePaths({
    root,
    env: { AMAYUI_WIN32_INPUT_NODE: path.join(root, 'custom.node') },
    platform: 'win32',
    arch: 'x64',
  });
  assert.equal(withEnv[0], path.join(root, 'custom.node'), '★env 覆盖必须排第一（打包后指向 asar.unpacked 用）');
  const noEnv = w32._candidatePaths({ root, env: {}, platform: 'win32', arch: 'x64' });
  const idx = (needle: string): number => noEnv.findIndex((p) => p.includes(needle));
  assert.ok(idx(path.join('build', 'Release')) >= 0, 'cmake-js 默认产物 build/Release 必须在链上');
  assert.ok(
    idx(path.join('build', 'Release')) < idx(path.join('build', 'Debug')),
    'Release 必须排在 Debug 前（否则调试产物会被静默优先加载）',
  );
  assert.ok(idx(path.join('build', 'Release')) < idx('prebuilds'), 'prebuilds 排最后（本项目默认不发预编译）');
  assert.ok(
    noEnv.some((p) => p.endsWith(path.join('prebuilds', 'win32-x64', 'win32_input.node'))),
    '预编译落点约定为 prebuilds/<platform>-<arch>/（接 prebuildify 时不用改调用方）',
  );
});

// ---------------------------------------------------------------------------
// 2) 真产物：只读探测
// ---------------------------------------------------------------------------

test('★E3：真产物存在时，加载成功且只读查询给出合理数值（不动光标）', (t) => {
  const w32 = loadFacade();
  if (!w32.available) {
    t.skip(`本机没构建原生模块（${w32.reason}）—— 跑 native/win32-input 的 npm run build 后本测试会真正执行`);
    return;
  }
  assert.ok(w32.addonPath && fs.existsSync(w32.addonPath), `addonPath 必须存在：${w32.addonPath}`);
  if (process.platform !== 'win32') {
    assert.equal(w32.supported, false, '非 Windows：能加载但 supported=false（函数返回 null/false）');
    return;
  }
  assert.equal(w32.supported, true, 'Windows 上 supported 应为 true');
  const p = w32.getCursorPos();
  assert.ok(p && Number.isFinite(p.x) && Number.isFinite(p.y), `getCursorPos 应给出数值：${JSON.stringify(p)}`);
  const r = w32.getVirtualScreenRect();
  assert.ok(r && r.width > 0 && r.height > 0, `虚拟屏矩形应有效：${JSON.stringify(r)}`);
  assert.ok(
    p.x >= r.x - 1 && p.x <= r.x + r.width + 1 && p.y >= r.y - 1 && p.y <= r.y + r.height + 1,
    `光标应落在虚拟屏内（cursor=${JSON.stringify(p)} screen=${JSON.stringify(r)}）`,
  );
});

// ---------------------------------------------------------------------------
// 3) 接线：0x10A 把同一对坐标交给宿主缝
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
// 4) 源码棘轮：主进程的三跳换算与装配次序（`electron/*.ts` 依赖 electron 运行时，无法 import 进测试）
// ---------------------------------------------------------------------------

test('★主进程换算棘轮：客户区 → 内容区原点 → DIP→物理（缺最后一跳 ⇒ 缩放≠100% 时光标挪偏）', () => {
  const src = fs.readFileSync(path.join(REPO, 'app', 'amayui-emulator', 'electron', 'nativeAddon.ts'), 'utf8');
  assert.match(src, /ipcMain\.on\('set-system-cursor'/, '必须注册 set-system-cursor 通道');
  assert.match(src, /win\.getContentBounds\(\)/, '必须补上窗口内容区原点（DIP 屏幕坐标）');
  assert.match(src, /screen\.dipToScreenPoint\(dip\)/, '★必须做 DIP→物理（SetCursorPos 吃物理像素）');
  assert.match(src, /w32\.setCursorPos\(phys\.x, phys\.y\)/, '最后落到原生模块的 SetCursorPos');
  assert.match(src, /if \(!w32 \|\| !w32\.supported\)/, '不可用时必须降级（只记一行诊断，不抛错）');
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
