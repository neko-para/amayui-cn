/**
 * **`0x2C7` SBSubstr / `0x2EB` GetConfig("set:GameVersion") / `0x2E6`+`0x2E7` 配置读写 / 配置回写**
 * —— TITLE「Version X.YY.ZZZZ」与"改了设置要落盘"这两件事的回归。
 *
 * ## 为什么这三条是一组
 * `src/TITLE.txt:583-592` 的画法：
 * ```text
 * i2eb (local-string 0)                        ← 0x2EB：set:GameVersion → 串0
 * i2c7 (local-string 1) (local-string 0) 0 1   ← 0x2C7：字节 [0,1) → "1"
 * i2ec (local-int 3ed) (local-string 1)        ← 0x2EC：atoi("1") = 1
 * i23b 6f 0 (local-int 3ed) 3c2 f7 1 1         ← 0x23B：CG 数字条画 1 位、补零
 * … 再取 [2,2) → "07"、[5,4) → "0019"
 * ```
 * 三条全是 no-op 时屏幕上就是占位值 **"0.00.0000"**（实测截图 `.tmp/stylecheck-0-title.png`）；
 * 而 `0x2E7`/`0x2E6` 是"设置界面改 auto-message pitch → 脚本回读"的闭环，
 * 它写的是**内存里的配置表**，落盘要靠 `Engine.onConfigChanged` → `FileSource.saveConfig`
 * （写到系统存档目录的 overlay，见 `src/arch/systemPaths.ts`）。
 *
 * 断言分四层：
 *  1. 纯函数：SJIS 字节切分 + 全角边界修正（`text/sjis.ts`）；
 *  2. 指令层：`0x2EB`/`0x2C7`/`0x2EC` 串起来就是 TITLE 的三段版本号；
 *  3. 配置层：`0x2E7` 写 → `0x2E6` 读回；`formatIni` 往返不丢键、不乱序；
 *  4. E3 真实语料：启动链跑到 TITLE 后，CG 数字条画出的是 **1/0/7/0/0/1/9**（而不是全 0）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine, Frame } from '../src/vm/engine.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS, NATIVE_OPS } from '../src/vm/ops.js';
import { dec } from '../src/vm/bits.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { resolveResourceDir } from '../src/arch/resourceDir.js';
import { INI_FILE, resolveSystemPaths } from '../src/arch/systemPaths.js';
import { InputManager } from '../src/vm/input.js';
import { loadScriptData, stepOnce } from '../src/vm/interpreter.js';
import { ExitScript, ScriptReset } from '../src/vm/ops.js';
import { applyConfigToEngine, DEFAULT_GAME_VERSION, ENGINE_BUILTIN_GAME_VERSION, formatIni, parseIni } from '../src/engineConfig.js';
import { sjisSubstr } from '../src/text/sjis.js';
import type { BinArg, BinInstruction } from '../src/script/bin.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
/** 系统存档目录 + overlay（玩家数据的唯一来源；见 src/arch/systemPaths.ts）。 */
const SYSTEM = resolveSystemPaths(REPO);
/** 真游戏的 `SYS4REG.INI`（base 那侧）。本机有；没有时测试退化到"空配置 + 引擎/emulator 缺省"。 */
const REAL_INI = path.join(SYSTEM.baseDir, INI_FILE);
/** 当前生效的 INI 文本（overlay 优先、否则真游戏那份）。 */
function effectiveIniText(): string {
  try {
    return fs.readFileSync(REAL_INI, 'utf8');
  } catch {
    return '';
  }
}

const im = (v: number): BinArg => ({ type: 0, raw: v }) as unknown as BinArg;
const lit = (s: string): BinArg => ({ type: 2, raw: 0, str: s }) as unknown as BinArg; // 字符串字面量
/** 本帧 `local-string` **值**槽（type 0xB；读/写都作用在 `frame.locals.str`）。 */
const locStr = (i: number): BinArg => ({ type: 0xb, raw: i }) as unknown as BinArg;
/** 本帧 `local-int` **值**槽（type 9；读/写都作用在 `frame.locals.int`）。 */
const locInt = (i: number): BinArg => ({ type: 9, raw: i }) as unknown as BinArg;

function instr(op: number, args: BinArg[]): BinInstruction {
  return { opcode: op, name: `i${op.toString(16)}`, argc: args.length, args, byteOffset: 0, index: 0 } as unknown as BinInstruction;
}

function mk(cfgText?: string): {
  e: Engine;
  /** 与 `step` 共用的帧 —— **必须从这里读 locals**（`e.curScript()` 是另一个帧）。 */
  f: Frame;
  step: (op: number, args?: BinArg[]) => void;
  /** 读本帧 `local-int` 槽（引擎侧存 DEC 编码值，与 `title-exit.test.ts` 同口径）。 */
  int: (i: number) => number;
  /** 读本帧 `local-string` 槽。 */
  str: (i: number) => string | undefined;
} {
  const e = new Engine(new HeadlessScene({}), new InputManager());
  if (cfgText !== undefined) e.config = parseIni(cfgText);
  const f = new Frame();
  return {
    e,
    f,
    int: (i) => dec(e.key, f.locals.int.get(i) ?? 0),
    str: (i) => f.locals.str.get(i),
    step: (op, args = []) => {
      // 真实现可能在 OPS（VM 核心）或 NATIVE_OPS（转发宿主/配置）里；桩表不算真实现。
      const h = OPS.get(op) ?? NATIVE_OPS.get(op);
      assert.ok(h, `0x${op.toString(16)} 应在 OPS/NATIVE_OPS 里（真实现）`);
      h!(makeCtx(e, f, instr(op, args), e.native, () => {}));
    },
  };
}

// ---------------------------------------------------------------------------
// 1) 纯函数：SJIS 字节切分
// ---------------------------------------------------------------------------

test('sjisSubstr：ASCII 版本号按**字节**三段切（TITLE 的真实用法）', () => {
  const v = '1.07.0019';
  assert.equal(sjisSubstr(v, 0, 1).text, '1');
  assert.equal(sjisSubstr(v, 2, 2).text, '07');
  assert.equal(sjisSubstr(v, 5, 4).text, '0019');
  // 越界 / 长度 0 ⇒ 空串（引擎 raw 42299-42316 的失败分支写空串）
  assert.equal(sjisSubstr(v, v.length, 4).text, '');
  assert.equal(sjisSubstr(v, 3, 0).text, '');
  assert.equal(sjisSubstr(v, 0, -1).text, '');
});

test('sjisSubstr：起点/终点落在全角字中间 ⇒ 丢 1 字节（并给出引擎的那两种警告）', () => {
  // 「あいう」= 每字 2 字节，共 6 字节
  const s = 'あいう';
  assert.deepEqual(sjisSubstr(s, 0, 2), { text: 'あ' }, '恰好一个字 ⇒ 无警告');
  assert.deepEqual(sjisSubstr(s, 2, 2), { text: 'い' });
  assert.equal(sjisSubstr(s, 0, 3).text, 'あ', '终点切在全角字的首字节 ⇒ 丢末字节');
  assert.equal(sjisSubstr(s, 0, 3).warning, 'trail');
  // 起点落在「あ」的第二个字节 ⇒ 丢首字节后只剩 1 字节，而它又是「い」的首字节 ⇒ 再丢 ⇒ 空串
  const mid = sjisSubstr(s, 1, 2);
  assert.equal(mid.text, '');
  assert.equal(mid.warning, 'trail', '两种修正都发生了（先 lead 后 trail，最终记最后一种）');
  // 半角/全角混排：全角 Ａ(2B) + '1'(1B)
  assert.equal(sjisSubstr('Ａ1', 0, 2).text, 'Ａ');
  assert.equal(sjisSubstr('Ａ1', 2, 1).text, '1');
});

// ---------------------------------------------------------------------------
// 2) 指令层：0x2EB → 0x2C7 → 0x2EC（TITLE 的版本号三段）
// ---------------------------------------------------------------------------

test('★0x2EB + 0x2C7 + 0x2EC：从配置取出真实版本号并切成 TITLE 的三段数字', () => {
  const { step, int, str } = mk('[set]\r\nGameVersion=1.07.0019\r\n');
  step(0x2eb, [locStr(0)]); // local-string 0 = "1.07.0019"
  assert.equal(str(0), '1.07.0019');

  const take = (start: number, len: number): number => {
    step(0x2c7, [locStr(1), locStr(0), im(start), im(len)]);
    step(0x2ec, [locInt(0x3ed), locStr(1)]); // atoi → local-int 3ed
    return int(0x3ed);
  };
  assert.equal(take(0, 1), 1, '第一段 "1"');
  assert.equal(take(2, 2), 7, '第二段 "07"（0x23B 按 2 位补零画 → "07"）');
  assert.equal(take(5, 4), 19, '第三段 "0019"（按 4 位补零画 → "0019"）');
});

test('0x2EB：INI 没有 [set] GameVersion 时用 emulator 缺省（= 被模拟 exe 的 FileVersion）', () => {
  const { step, str } = mk('[message]\r\nMessageSpeed=5\r\n');
  step(0x2eb, [locStr(0)]);
  // 引擎内建其实是 "1.00"（raw a100），但真游戏 INI 没有 `[set]` 节 ⇒ 直接用内建会让 TITLE 画 1.00；
  // 这里用的是"被模拟的那份 exe（修正补丁 amayui_107.exe = 1.07.0019）"的版本串。见 engineConfig.ts。
  assert.equal(ENGINE_BUILTIN_GAME_VERSION, '1.00', '引擎内建常量本身不变');
  assert.equal(DEFAULT_GAME_VERSION, '1.07.0019', 'emulator 缺省 = 被模拟 exe 的 FileVersion');
  assert.equal(str(0), '1.07.0019');
  // 未加载配置（null）时同样回退到该缺省，而不是空串
  const bare = mk().e;
  const f = new Frame();
  const h = OPS.get(0x2eb)!;
  h(makeCtx(bare, f, instr(0x2eb, [locStr(0)]), bare.native, () => {}));
  assert.equal(f.locals.str.get(0), '1.07.0019');
});

test('0x2C7：越界切片写空串（不是旧值、不是抛错）', () => {
  const { step, str } = mk();
  step(0x192, [locStr(0), lit('abc')]); // set-string：local-string 0 = "abc"
  step(0x2c7, [locStr(1), locStr(0), im(10), im(2)]);
  assert.equal(str(1), '', '起点越界 ⇒ 空串');
  step(0x2c7, [locStr(1), locStr(0), im(0), im(2)]);
  assert.equal(str(1), 'ab');
});

// ---------------------------------------------------------------------------
// 3) 配置层：0x2E7 写 ↔ 0x2E6 读 + INI 回写
// ---------------------------------------------------------------------------

test('★0x2E7 写 / 0x2E6 读：AutoMessagePitch{0,1} 的闭环（设置界面 → 脚本回读）', () => {
  const { f, step, int } = mk('[message]\r\nAutoMessagePitch0=0\r\nAutoMessagePitch1=0\r\n');
  step(0x2e6, [im(0), locInt(0x57bc)]);
  assert.equal(int(0x57bc), 0, '初值来自 INI');
  step(0x2e7, [im(0), im(1234)]); // CONFIG1 拖动滑条 → SetConfig
  step(0x2e6, [im(0), locInt(0x57bc)]);
  assert.equal(int(0x57bc), 1234, '写进去的值要能立刻读回');
  step(0x2e7, [im(1), im(56)]);
  step(0x2e6, [im(1), locInt(0x57bd)]);
  assert.equal(int(0x57bd), 56, '索引 1 是另一个键');
  // 越界选择器（引擎走报错分支）：不写操作数（这里直接读原始槽，避免 dec/enc 口径混淆）
  f.locals.int.set(0x57be, 999);
  step(0x2e6, [im(9), locInt(0x57be)]);
  assert.equal(f.locals.int.get(0x57be), 999, 'op1 ∉ {0,1} ⇒ 只报错、不写回');
});

test('配置写会通知宿主（onConfigChanged）—— 这是"落盘"的唯一入口', () => {
  const { e, step } = mk('[message]\r\nAutoMessagePitch0=0\r\n');
  const seen: string[] = [];
  e.onConfigChanged = (cfg) => seen.push(formatIni(cfg));
  step(0x2e7, [im(0), im(7)]);
  step(0x141, [im(3)]); // 0x141 直写 message:MesWinAlpha（同一入口）
  assert.equal(seen.length, 2, '两次写各通知一次');
  assert.match(seen[1]!, /MesWinAlpha=3/i);
  assert.match(seen[1]!, /AutoMessagePitch0=7/i);
});

test('formatIni：往返不丢键、不改分节/键顺序（只改一个值时 INI 不该被重排）', () => {
  const base = effectiveIniText();
  // 真游戏的 INI **没有** `[set]` 节（那节由引擎退出时按配置注册表写）⇒ 这里补上，
  // 专门验证"额外/未知分节也会原样保留、不被重排"。
  const original = /\[set\]/i.test(base)
    ? base
    : `${base}\r\n[set]\r\nGameVersion=1.07.0019\r\nVerRegPos=\r\n`;
  const cfg = parseIni(original);
  const back = formatIni(cfg);
  const again = parseIni(back);
  assert.deepEqual([...again.values.entries()].sort(), [...cfg.values.entries()].sort(), '键值集合一致');
  assert.deepEqual(again.sections, cfg.sections, '分节顺序一致');
  const seq = (c: ReturnType<typeof parseIni>): string[] =>
    c.sections.flatMap((s) => (c.order.get(s.toLowerCase()) ?? []).map((k) => `${s}:${k.toLowerCase()}`));
  assert.deepEqual(seq(again), seq(cfg), '键出现顺序一致');
  assert.match(back, /\[set\]\r?\nGameVersion=1\.07\.0019/, '[set] 段与其中的键原样保留');
  assert.match(back, /\[message\]/, '分节头保留');
});

test('NodeFileSource：没给 system 时**完全不落盘**（测试/链路工具不碰玩家数据）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amayui-nosys-${process.pid}-`));
  const base = path.join(dir, 'base');
  const overlay = path.join(dir, 'overlay');
  try {
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(path.join(base, INI_FILE), '[message]\r\nMesWinAlpha=8\r\n');
    const src = new NodeFileSource({ resourceDir: path.join(REPO, 'install') });
    assert.equal(src.overlay, null, '未配置 system ⇒ 没有 overlay 层');
    assert.equal(await src.readConfig(), null, '不读玩家数据');
    assert.equal(await src.readSaveData(), null, '不读玩家存档');
    await src.saveConfig('a=1\r\n'); // no-op
    await src.writeSaveData(new Uint8Array([1, 2, 3])); // no-op
    assert.equal(fs.readdirSync(base).length, 1, 'base 里只有原来那个 INI');
    assert.equal(fs.existsSync(overlay), false, 'overlay 目录都不该被创建');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('applyConfigToEngine 不受 formatIni 影响：往返后仍能灌字段', () => {
  const text = effectiveIniText();
  const cfg = parseIni(text);
  const values = new Map<number, number>();
  const a = applyConfigToEngine(cfg, values);
  const values2 = new Map<number, number>();
  const b = applyConfigToEngine(parseIni(formatIni(cfg)), values2);
  assert.deepEqual(b, a, '往返后写入的字段集合一致');
  if (text.length > 0) assert.ok(a.length >= 5, `至少应绑上几个键（实际 ${a.length}）`);
});

// ---------------------------------------------------------------------------
// 4) E3：真实语料跑到 TITLE，看 CG 数字条画出的位数
// ---------------------------------------------------------------------------

/** 一帧的"指令"（与 src/report.ts 同口径）：遇到就推进虚拟时钟 + 驱动场景窗。 */
const FRAME_OPS = new Set([0x1f4, 0x20c, 0x23c]);

test('★E3：启动链跑到 TITLE 后，版本号数字条画的是 1/0/7/0/0/1/9（不再是 0.00.0000）', async () => {
  const src = new NodeFileSource({ resourceDir: resolveResourceDir(REPO) });
  const boot = await src.readScript(0);
  assert.ok(boot, '应能读到 index 0 = SYSTEM4.BIN');
  const scene = new HeadlessScene({});
  const e = new Engine(scene, new InputManager());
  e.fileSource = src;
  // 与两个宿主同口径：启动时读当前生效的 SYS4REG.INI 灌引擎字段（0x2EB 取的就是这份配置）。
  // ★真游戏那份**没有 `[set]` 节** ⇒ 走到 `DEFAULT_GAME_VERSION`（= 被模拟的 amayui_107.exe 的
  //   FileVersion 1.07.0019）—— 这条断言同时守着"版本号别退回 1.00"。
  const cfg = parseIni(effectiveIniText());
  e.config = cfg;
  applyConfigToEngine(cfg, e.engineValues);
  loadScriptData(e, boot.data, boot.name);

  let clock = 0;
  for (let i = 0; i < 200_000; i++) {
    const f = e.curScript();
    if (!f.script || f.ip >= f.script.instructions.length) break;
    e.nowMs = clock;
    let t;
    try {
      t = await stepOnce(e);
    } catch (err) {
      if (err instanceof ExitScript || err instanceof ScriptReset) break;
      throw err;
    }
    if (FRAME_OPS.has(t.opcode)) {
      clock += 16;
      scene.advance(clock);
    }
  }

  const rec = e.cgDigits.get(0);
  assert.ok(rec, 'TITLE 应登记过 CG 数字条记录 0（0x2DA）');
  const [tex, x0, y0, cellW, , gap] = rec!;
  assert.equal(tex, 4);
  // 版本号三段都画在同一 y（记录 y0）上；**handle 序 = 自右向左**（`cgDigitItems` 的 k 从高位往低位走、
  // 而 x = k·advance + x ⇒ k 越大越靠右），所以每段要 reverse 回"从左到右"再拼。
  const digitAt = new Map<number, number>();
  for (const it of scene.scene.drawItems.values()) {
    if (it.srcY !== y0) continue;
    if (it.srcX < x0 || it.srcX >= x0 + (cellW + gap) * 10) continue;
    digitAt.set(it.handle, Math.round((it.srcX - x0) / (cellW + gap)));
  }
  // TITLE.txt:586/589/592 的三处 `i23b`：起始 id 0x6f/0x70/0x72，位数 1/2/4，flags=1（补零）
  const piece = (id: number, n: number): string =>
    Array.from({ length: n }, (_, i) => digitAt.get(id + i) ?? -1)
      .reverse()
      .join('');
  assert.equal(
    `${piece(0x6f, 1)}.${piece(0x70, 2)}.${piece(0x72, 4)}`,
    '1.07.0019',
    `TITLE 的版本号应来自 INI 的 set:GameVersion（实际数字项 ${[...digitAt.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([h, d]) => `${h.toString(16)}:${d}`)
      .join(' ')}）`,
  );
  await src.dispose?.();
});
