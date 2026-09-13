/**
 * **外置选项文件（`emulator.config.json`）回归** —— `src/emulatorOptions.ts`（纯解析/套用）+
 * `src/emulatorOptionsFile.ts`（node-only 读取）。
 *
 * 背景（用户要求）：跑回归/截图时 `SYSTEM4 → LOGO → INIT → TITLE` 里的 LOGO（版权页 + LOGO.MPG）
 * 纯粹是等待 ⇒ 需要一个"当作版权页已经看过"的开关。目前**只有一个选项** `boot.showLogo`。
 *
 * 引擎依据（`docs-new/03-engine/flow-control.md` §10）：
 *  - `load-show-logo`(0x130) `sub_42F7A0` 把 `_this[96983]` 写回操作数（raw 39346）；
 *  - `src/SYSTEM4.txt:144-146`：非 0 → `call-script 5262 // LOGO`；0 → 跳到 `:149 INIT`/`:150 TITLE`；
 *  - 构造 `sub_415640` 置 1（raw 22589）= 真游戏默认；`exit-script` `sub_428A60` 置 0（raw 35207）。
 *
 * ★本文件里最重要的两条"不许退化"的守卫：
 *  1. **不配任何东西 = 真游戏行为**（`showLogo` 默认 `true`，`_this[96983]` 写 1）；
 *  2. **测试/库调用不受本机配置文件影响** —— `runGameStartChain()` 等 library 入口一律用默认值，
 *     只有 CLI 入口才 `loadEmulatorOptions()` 读文件（否则"测试结果取决于开发机上某个 JSON"）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_EMULATOR_OPTIONS,
  EMULATOR_OPTIONS_ENV,
  EMULATOR_OPTIONS_FILE,
  LOGO_FLAG_FIELD,
  applyEmulatorOptions,
  parseEmulatorOptions,
} from '../src/emulatorOptions.js';
import { describeEmulatorOptions, emulatorOptionsOf, loadEmulatorOptions, resolveOptionsPath } from '../src/emulatorOptionsFile.js';
import { Engine } from '../src/vm/engine.js';
import { StubNative } from '../src/vm/stubNative.js';
import { InputManager } from '../src/vm/input.js';
import { runGameStartChain } from '../src/tools/gameStartChain.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');
/** 仓库根（选项文件的默认位置在它下面）。 */
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..');

// ---------------------------------------------------------------------------
// 纯解析
// ---------------------------------------------------------------------------

test('默认值 = 真游戏行为：showLogo=true（构造 sub_415640 置 _this[96983]=1，raw 22589）', () => {
  assert.equal(DEFAULT_EMULATOR_OPTIONS.boot.showLogo, true);
  // 与 Engine 构造函数的初值一致 ⇒ "没有任何配置文件"时行为不变
  const e = new Engine(new StubNative(() => {}), new InputManager());
  assert.equal(e.engineValues.get(LOGO_FLAG_FIELD), 1, 'Engine 构造默认 _this[96983] 应为 1');
  assert.equal(LOGO_FLAG_FIELD, 96983, '字段号 = 引擎 _this[96983]（byte 0x5EB5C）');
});

test('parseEmulatorOptions：正常解析（含 $comment 说明键）', () => {
  const r = parseEmulatorOptions('{"$comment":"说明","boot":{"showLogo":false}}');
  assert.equal(r.options.boot.showLogo, false);
  assert.deepEqual(r.problems, [], '$comment 是允许的说明键，不算未知键');
  assert.equal(parseEmulatorOptions('{}').options.boot.showLogo, true, '缺 boot ⇒ 默认');
  assert.equal(parseEmulatorOptions('{"boot":{}}').options.boot.showLogo, true, '缺 showLogo ⇒ 默认');
  assert.equal(parseEmulatorOptions('{"boot":{"showLogo":true}}').options.boot.showLogo, true);
});

test('parseEmulatorOptions：坏输入一律降级为默认值 + 一条 problem（永不抛）', () => {
  const cases: [string, RegExp][] = [
    ['', /文件为空/],
    ['{oops', /JSON 解析失败/],
    ['[1,2]', /顶层必须是对象/],
    ['"x"', /顶层必须是对象/],
    ['{"boot":1}', /"boot" 必须是对象/],
    ['{"boot":{"showLogo":"no"}}', /必须是 true\/false/],
    ['{"boot":{"showLogo":0}}', /必须是 true\/false/],
  ];
  for (const [text, re] of cases) {
    const r = parseEmulatorOptions(text);
    assert.equal(r.options.boot.showLogo, true, `坏输入应降级为默认：${JSON.stringify(text)}`);
    assert.equal(r.problems.length > 0, true, `坏输入应给出 problem：${JSON.stringify(text)}`);
    assert.match(r.problems.join(' '), re, `problem 措辞应说明原因：${JSON.stringify(text)}`);
  }
});

test('parseEmulatorOptions：拼错的键要吵（否则"以为跳过了 LOGO、其实没跳"会让人白等）', () => {
  const a = parseEmulatorOptions('{"boot":{"showlogo":false}}');
  assert.equal(a.options.boot.showLogo, true, '大小写拼错不生效');
  assert.match(a.problems.join(' '), /未知键 "boot\.showlogo"/);
  const b = parseEmulatorOptions('{"Boot":{"showLogo":false}}');
  assert.equal(b.options.boot.showLogo, true);
  assert.match(b.problems.join(' '), /未知顶层键 "Boot"/);
});

test('applyEmulatorOptions：false → _this[96983]=0（SYSTEM4:145 的 jcc 跳 b38 跳过 LOGO）；true → 1', () => {
  const values = new Map<number, number>();
  const off = applyEmulatorOptions(values, { boot: { showLogo: false } });
  assert.equal(values.get(LOGO_FLAG_FIELD), 0, '预设 0 = 版权页已看过 ⇒ SYSTEM4 直接落到 INIT/TITLE');
  assert.match(off.join(' '), /跳过 LOGO/);
  const on = applyEmulatorOptions(values, { boot: { showLogo: true } });
  assert.equal(values.get(LOGO_FLAG_FIELD), 1);
  assert.match(on.join(' '), /真游戏行为/);
  // 与 Engine 构造默认值一致 ⇒ 套用默认选项不会改变任何东西
  const e = new Engine(new StubNative(() => {}), new InputManager());
  applyEmulatorOptions(e.engineValues, DEFAULT_EMULATOR_OPTIONS);
  assert.equal(e.engineValues.get(LOGO_FLAG_FIELD), 1);
});

// ---------------------------------------------------------------------------
// 路径解析 / 读取（node-only）
// ---------------------------------------------------------------------------

test('resolveOptionsPath：默认 = <仓库根>/emulator.config.json；AMAYUI_EMULATOR_CONFIG 可覆盖（绝对/相对）', () => {
  assert.equal(resolveOptionsPath('R', {} as NodeJS.ProcessEnv), path.join('R', EMULATOR_OPTIONS_FILE));
  assert.equal(resolveOptionsPath('R', { [EMULATOR_OPTIONS_ENV]: 'x.json' } as NodeJS.ProcessEnv), path.join('R', 'x.json'));
  const abs = path.resolve('R', 'sub', 'y.json');
  assert.equal(resolveOptionsPath('R', { [EMULATOR_OPTIONS_ENV]: abs } as NodeJS.ProcessEnv), abs);
  assert.equal(resolveOptionsPath('R', { [EMULATOR_OPTIONS_ENV]: '  ' } as NodeJS.ProcessEnv), path.join('R', EMULATOR_OPTIONS_FILE), '空白视为未设置');
});

test('loadEmulatorOptions：文件不存在 ⇒ 默认值且 problems 为空（"没配"是正常情况）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amayui-opt-'));
  const NO_ENV = {} as NodeJS.ProcessEnv; // 显式空环境：本用例要的是"这个 dir 里没文件"，不能被 npm test 的钉住值覆盖
  try {
    const r = loadEmulatorOptions(dir, NO_ENV);
    assert.equal(r.exists, false);
    assert.equal(r.path, path.join(dir, EMULATOR_OPTIONS_FILE));
    assert.equal(r.options.boot.showLogo, true);
    assert.deepEqual(r.problems, []);
    assert.match(describeEmulatorOptions(r).join('\n'), /未找到/);
    assert.equal(emulatorOptionsOf(dir, {} as NodeJS.ProcessEnv).boot.showLogo, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadEmulatorOptions：读到真文件 ⇒ 生效；坏 JSON ⇒ 默认值 + problems 上浮', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amayui-opt-'));
  const NO_ENV = {} as NodeJS.ProcessEnv; // ★显式传空环境：否则 npm test 的 AMAYUI_EMULATOR_CONFIG 会覆盖 dir（见文件末尾的"钉住"用例）
  try {
    fs.writeFileSync(path.join(dir, EMULATOR_OPTIONS_FILE), '{"boot":{"showLogo":false}}', 'utf8');
    const off = loadEmulatorOptions(dir, NO_ENV);
    assert.equal(off.exists, true);
    assert.equal(off.options.boot.showLogo, false);
    assert.deepEqual(off.problems, []);
    assert.match(describeEmulatorOptions(off).join('\n'), /emulator\.config\.json/);

    fs.writeFileSync(path.join(dir, EMULATOR_OPTIONS_FILE), '{bad', 'utf8');
    const bad = loadEmulatorOptions(dir, NO_ENV);
    assert.equal(bad.exists, true);
    assert.equal(bad.options.boot.showLogo, true, '坏 JSON ⇒ 默认值');
    assert.equal(bad.problems.length, 1);

    // 环境变量换路径
    fs.writeFileSync(path.join(dir, 'other.json'), '{"boot":{"showLogo":false}}', 'utf8');
    const viaEnv = loadEmulatorOptions(dir, { [EMULATOR_OPTIONS_ENV]: 'other.json' } as NodeJS.ProcessEnv);
    assert.equal(viaEnv.path, path.join(dir, 'other.json'));
    assert.equal(viaEnv.options.boot.showLogo, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ★两条"不许退化"的守卫
// ---------------------------------------------------------------------------

test('★测试用环境把选项钉在"空配置"上：本机 emulator.config.json 怎么改都不影响测试', () => {
  // 机制：npm test / npm run verify 用 `node --env-file=test/options.test.env`（见 package.json），
  //      把 AMAYUI_EMULATOR_CONFIG 指向 emulator.config.test.json（= 全默认）。这样"我本地为了省 LOGO 等待
  //      把它设成 false"不会让测试变成不稳定/不可复现（2026-09 用户实测踩到，本用例把它钉住）。
  const pinned = process.env[EMULATOR_OPTIONS_ENV];
  assert.ok(pinned, 'npm test 必须通过 --env-file 设置 AMAYUI_EMULATOR_CONFIG（见 test/options.test.env）');
  assert.match(pinned!, /emulator\.config\.test\.json$/);
  const r = loadEmulatorOptions(REPO_ROOT); // ← 用 process.env（被钉住）
  assert.deepEqual(r.problems, [], `钉住的选项文件必须干净：${r.problems.join(' / ')}`);
  assert.equal(r.options.boot.showLogo, true, '钉住 ⇒ 无论本机怎么改，测试里都是默认值（播 LOGO）');
  assert.match(r.path, /emulator\.config\.test\.json$/);
  // 反证：用空环境读**本机**文件，可以看到它可能被改成 false —— 说明"钉住"确实在起作用
  const local = loadEmulatorOptions(REPO_ROOT, {} as NodeJS.ProcessEnv);
  console.log(`[options] 本机 emulator.config.json → showLogo=${local.options.boot.showLogo}（测试固定用上面的空配置，不受它影响）`);
});

test('★示例文件 emulator.config.example.json 必须是"默认行为"（showLogo=true），且本机私有文件被 gitignore', () => {
  // ★2026-09 修正：**不再**断言仓库根 `emulator.config.json` 的值 —— 那是**本机私有开关**
  //   （测试者会把它改成 false 以省掉 LOGO 等待），断言它等于默认值会让"用它"变成"跑不过测试"。
  //   现在：`.example.json` 是入库的用法示例（必须等于默认行为），真文件在 .gitignore 里。
  const example = path.resolve(APP_ROOT, '..', '..', `${EMULATOR_OPTIONS_FILE.replace(/\.json$/, '')}.example.json`);
  assert.equal(fs.existsSync(example), true, `仓库根应有示例文件：${example}`);
  const text = fs.readFileSync(example, 'utf8');
  const parsed = parseEmulatorOptions(text);
  assert.deepEqual(parsed.problems, [], `示例文件必须干净：${parsed.problems.join(' / ')}`);
  assert.equal(parsed.options.boot.showLogo, true, '示例值必须是真游戏行为（播 LOGO）——照抄它不会改变行为');
  // 本机私有文件若存在：只要求"能解析、无问题"，**不管它的值**（那是使用者的选择）
  const local = path.resolve(APP_ROOT, '..', '..', EMULATOR_OPTIONS_FILE);
  if (fs.existsSync(local)) {
    const r = loadEmulatorOptions(path.dirname(local));
    assert.deepEqual(r.problems, [], `本机选项文件若存在必须写得对：${r.problems.join(' / ')}`);
  }
  const ignore = fs.readFileSync(path.resolve(APP_ROOT, '..', '..', '.gitignore'), 'utf8');
  assert.match(ignore, /^\/emulator\.config\.json$/m, '本机私有选项文件应被 gitignore（不许入库）');
});

test('★library 入口不得自己读配置文件：`runGameStartChain` 的默认参数 = 真游戏行为', () => {
  // 断言方式：库模块里不许出现对 node-only 读取模块的引用（否则测试结果取决于开发机上的 JSON）。
  const chain = fs.readFileSync(path.join(APP_ROOT, 'src', 'tools', 'gameStartChain.ts'), 'utf8');
  assert.equal(chain.includes('emulatorOptionsFile'), false, 'gameStartChain 不该 import emulatorOptionsFile（只有 CLI 才读文件）');
  assert.match(chain, /opt\.emulatorOptions \?\? DEFAULT_EMULATOR_OPTIONS/, '必须显式回退到默认值');
  const report = fs.readFileSync(path.join(APP_ROOT, 'src', 'report.ts'), 'utf8');
  assert.match(report, /opt\.emulatorOptions \?\? DEFAULT_EMULATOR_OPTIONS/);
  const cfg = fs.readFileSync(path.join(APP_ROOT, 'src', 'tools', 'config1Chain.ts'), 'utf8');
  assert.match(cfg, /opt\.emulatorOptions \?\? DEFAULT_EMULATOR_OPTIONS/);
});

/**
 * E3：`boot.showLogo=false` ⇒ cold boot **不进** LOGO，但**仍然**要走到 SN0000 首文案。
 *
 * 这是本选项唯一有意义的验收：既证明"真的跳过了"，又证明"跳过之后链路还是完整的"
 * （真机里"0 ⇒ 跳过"是 `exit-script`/GAMEOVER 走过的路径，但那时 `SYSTEM4` 的 `ip0..143` 已跑过一遍；
 *  预设 0 只跑一遍 —— 差异见 `src/emulatorOptions.ts` 文件头，必须靠这条断言兜住）。
 */
test('E3：showLogo=false ⇒ scriptTrail 不含 LOGO，且仍到达 SN0000 首文案', async () => {
  const r = await runGameStartChain({ emulatorOptions: { boot: { showLogo: false } } });
  assert.equal(
    r.scriptTrail.some((s) => s.startsWith('LOGO')),
    false,
    `关掉 showLogo 后不应进入 LOGO，实际轨迹 ${r.scriptTrail.slice(0, 8).join(',')}`,
  );
  assert.ok(r.reachedGameStart, '跳过 LOGO 后仍应能到达 GAMESTART');
  assert.equal(r.gameStartResult, 1, '「ゲーム開始」仍应正常返回');
  assert.ok(r.firstTextReached, '跳过 LOGO 后仍应到达 SN0000 首文案');
  assert.equal(r.firstTextIp, 901, '首文案 ip 应与默认路径一致（SN0000.txt:1225）');
});

// ★"默认会经过 LOGO"的反向断言不在这里再跑一遍 —— `test/game-start-chain.test.ts` 的 E3 已经跑了一次
//   默认链路，那条断言就加在那里（省一次 ~3.7s 的整链运行）。
