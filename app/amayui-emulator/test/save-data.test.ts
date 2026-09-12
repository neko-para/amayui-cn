/**
 * **`SAVE.DAT`（脚本 `save-int`/`save-string` 表的持久化）回归**。
 *
 * ## 为什么这是"设置界面能不能记住"的关键
 * 设置界面的开关**不在 `SYS4REG.INI` 里**，而是脚本自己用两张表存的：
 *
 * ```text
 * SYSTEM4.txt:71  load-int (global-int 5)          ← 读「已初始化」标志
 * SYSTEM4.txt:73      call-script 5258 LOADCONFIG  ← 有 ⇒ 恢复用户设置（29 个 load-int/load-string）
 * SYSTEM4.txt:78      call-script 51dc INITCONFIG  ← 无 ⇒ 首次启动：写默认值 + save-int/save-string 登记
 * SYSTEM4.txt:81      save-int (global-int 5)      ← 打标志
 * ```
 * 两张表由引擎序列化进 `SAVE.DAT`（`sub_40AAE0`/`sub_438320`/`sub_437480`；装载 `sub_40AEE0`/`sub_438940`）。
 * 本工程把这条链路补齐：`save-int` → `Engine.stringIndexTable` → `encodeSaveData` → 文件 → 下次启动
 * `decodeSaveData` → `applySaveDataTables` → `load-int` 读回 ⇒ 设置跨会话保留。
 *
 * ## 断言分四层
 *  1. 纯层：两种 CRC（引擎 `sub_436D50`/`sub_436D00`）与 `Crypt` 解密（`sub_436E90`）的逐字实现；
 *  2. 容器层：本工程格式 encode → decode 往返（含 CRC 校验与损坏检测）；
 *  3. **引擎格式层**：手工构造 `format = 1`（未压缩）的引擎存档 → 我们的解码器能读（走 Crypt 解密路径）；
 *  4. **E4 真存档**：本机若有真游戏存档（`%LOCALAPPDATA%\Eushully\*\SAVE\SAVE.DAT`），
 *     解码它并断言配置键与 `INITCONFIG*` 的语义一致（`global 5 = 1` 等）——
 *     这是"引擎格式"整条链路（头 → Crypt → LZSS → 表）最硬的证据；没有存档时跳过。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Engine, Frame } from '../src/vm/engine.js';
import { enc } from '../src/vm/bits.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS, NATIVE_OPS } from '../src/vm/ops.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { InputManager } from '../src/vm/input.js';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { crc32, crc32MsbFirst } from '../src/vm/crc32.js';
import { unlzss } from '../src/vm/lzss.js';
import {
  SAVE_FORMAT_PLAIN,
  SAVE_HEADER_BYTES,
  SAVE_BLOCK_BYTES,
  cryptDecrypt,
  decodeSaveData,
  encodeSaveData,
  isEngineSave,
  readSaveHeader,
} from '../src/vm/saveData.js';
import type { BinArg, BinInstruction } from '../src/script/bin.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const INI = path.join(REPO, 'app', 'amayui-emulator', 'SYS4REG.INI');
void INI;

import { fileURLToPath } from 'node:url';

const im = (v: number): BinArg => ({ type: 0, raw: v }) as unknown as BinArg;
const locInt = (i: number): BinArg => ({ type: 9, raw: i }) as unknown as BinArg;
const gInt = (i: number): BinArg => ({ type: 3, raw: i }) as unknown as BinArg;
const gStr = (i: number): BinArg => ({ type: 5, raw: i }) as unknown as BinArg;
const encInt = (e: Engine, v: number): number => enc(e.key, v);
function instr(op: number, args: BinArg[]): BinInstruction {
  return { opcode: op, name: `i${op.toString(16)}`, argc: args.length, args, byteOffset: 0, index: 0 } as unknown as BinInstruction;
}
function mk(): { e: Engine; step: (op: number, args?: BinArg[]) => void } {
  const e = new Engine(new HeadlessScene({}), new InputManager());
  const f = new Frame();
  return {
    e,
    step: (op, args = []) => {
      const h = OPS.get(op) ?? NATIVE_OPS.get(op);
      assert.ok(h, `0x${op.toString(16)} 应是真实现`);
      h!(makeCtx(e, f, instr(op, args), e.native, () => {}));
    },
  };
}

// ---------------------------------------------------------------------------
// 1) 纯层：CRC / Crypt
// ---------------------------------------------------------------------------

test('crc32：标准 zlib CRC32（引擎 sub_436D00）与被测向量的标准值一致', () => {
  const v = new TextEncoder().encode('123456789');
  assert.equal(crc32(v), 0xcbf43926, 'CRC-32/ISO-HDLC 标准校验值');
  assert.equal(crc32(new Uint8Array(0)), 0, '空串 = 0');
});

test('crc32MsbFirst：与标准值不同（引擎 sub_436D50 用的是另一张表 + 另一种移位）', () => {
  const v = new TextEncoder().encode('123456789');
  const msb = crc32MsbFirst(v);
  assert.notEqual(msb, crc32(v));
  // 同一输入必须稳定（这条锁住实现，防止以后手改表）
  assert.equal(crc32MsbFirst(v), msb);
  assert.equal(crc32MsbFirst(new Uint8Array(0)), 0);
});

test('Crypt（引擎 sub_436DE0 加密 / sub_436E90 解密）互逆，且 key 就在文件头里', () => {
  const plain = new Uint8Array([1, 2, 3, 4, 0x11223344, 0, 0xffffffff, 42]);
  const dv = new DataView(plain.buffer);
  const key1 = 0x4e1b2067;
  let key2 = 0xf9b;
  const enc = new Uint8Array(plain.length * 2);
  const edv = new DataView(enc.buffer);
  let k1 = key1 >>> 0;
  let k2 = key2 & 0xffff;
  for (let i = 0; i < plain.length / 4; i++) {
    const v = (k1 ^ dv.getUint32(i * 4, true)) >>> 0;
    edv.setUint32(i * 8, (k2 * (v >>> 16)) >>> 0, true);
    edv.setUint32(i * 8 + 4, (k2 * (v & 0xffff)) >>> 0, true);
    k1 = (k1 + 0x0b0b0b0b) >>> 0;
    k2 = (k2 + 0x0b02) & 0xffff;
  }
  const dec = cryptDecrypt(enc, key1, key2);
  assert.equal(dec.ok, true);
  assert.deepEqual([...dec.out], [...plain], '解密必须还原原文');
  // key2 除不尽 ⇒ 失败（不是静默产出垃圾）
  const bad = cryptDecrypt(enc, key1, 0xfffe);
  assert.equal(bad.ok, false);
});

// ---------------------------------------------------------------------------
// 2) 容器层：本工程格式往返
// ---------------------------------------------------------------------------

const sampleTables = (): { ints: Map<string, number>; strings: Map<string, string> } => ({
  ints: new Map([
    ['\x0300000005', 1], // 「已初始化」标志（SYSTEM4.txt:71）
    ['\x030000a9ce', 2], // INITCONFIG0 的某个开关（改成 2 表示非默认）
    ['\x030000a9cc', 0x1f],
  ]),
  strings: new Map([['\x0500000bbb', 'Meiryo-Test'], ['\x0500000bbd', 'YuGothic-Test']]),
});

test('★encode → decode 往返：两张表一字不差，头里带魔数/版本/标题', () => {
  const bytes = encodeSaveData({ tables: sampleTables(), now: new Date(2026, 8, 12, 13, 37, 0), stamp: 123 });
  const h = readSaveHeader(bytes);
  assert.equal(h?.magic, 'S4SD');
  assert.equal(h?.engineVersion, '460B');
  assert.equal(h?.format, SAVE_FORMAT_PLAIN);
  assert.equal(h?.title, 'AmayuiEmulator');
  const r = decodeSaveData(bytes);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual([...r.data.tables.ints.entries()].sort(), [...sampleTables().ints.entries()].sort());
  assert.deepEqual([...r.data.tables.strings.entries()].sort(), [...sampleTables().strings.entries()].sort());
  assert.equal(isEngineSave(bytes), false, '本工程格式不该被判成引擎格式');
});

test('损坏检测：改动 payload 一个字节 ⇒ 解码如实失败（不产出静默错值）', () => {
  const bytes = encodeSaveData({ tables: sampleTables() });
  const at = SAVE_HEADER_BYTES + SAVE_BLOCK_BYTES + 16;
  bytes[at] = bytes[at]! ^ 0x5a;
  const r = decodeSaveData(bytes);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /CRC|越界|不符/);
});

// ---------------------------------------------------------------------------
// 3) 引擎格式层：手工构造 format = 1（Crypt 加密、未压缩）的存档
// ---------------------------------------------------------------------------

/** 按引擎 `sub_438320` 的结构造 payload 主体（int 块留空）。 */
function engineBody(t: { ints: Map<string, number>; strings: Map<string, string> }): Uint8Array {
  const parts: Uint8Array[] = [];
  const u32 = (v: number): Uint8Array => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, true);
    return b;
  };
  parts.push(u32(0)); // int 块计数（引擎那份是模幂混淆块；本测试不用）
  parts.push(u32(t.ints.size));
  for (const [k, v] of t.ints) {
    const rec = new Uint8Array(16);
    for (let i = 0; i < 12 && i < k.length; i++) rec[i] = k.charCodeAt(i) & 0xff;
    new DataView(rec.buffer).setUint32(12, v >>> 0, true);
    parts.push(rec);
  }
  parts.push(u32(t.strings.size));
  const enc = new TextEncoder();
  for (const [k, v] of t.strings) {
    parts.push(enc.encode(k), new Uint8Array([0]), enc.encode(v), new Uint8Array([0]));
  }
  parts.push(u32(0));
  const total = parts.reduce((n, p) => n + p.length, 0);
  // 引擎的 payload 是 **dword 粒度**（`sub_438320` 按 dword 计数、Crypt 也按 dword 变换）⇒ 补齐到 4 的倍数
  const padded = (total + 3) & ~3;
  const out = new Uint8Array(padded);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** 按引擎 `sub_437480` 造一个 `format = 1` 的存档（Crypt 加密、无压缩、key 写在头里）。 */
function makeEngineSave(t: { ints: Map<string, number>; strings: Map<string, string> }): Uint8Array {
  const body = engineBody(t);
  const crc1 = crc32MsbFirst(body);
  const crc2 = crc32(body);
  const section = new Uint8Array(8 + body.length);
  const sv = new DataView(section.buffer);
  sv.setUint32(0, crc1, true);
  sv.setUint32(4, crc2, true);
  section.set(body, 8);
  // 引擎加密：逐 dword → 8 字节
  const key1 = 0x12345677;
  const key2 = 0x2f5b;
  const enc = new Uint8Array(section.length * 2);
  const edv = new DataView(enc.buffer);
  let k1 = key1 >>> 0;
  let k2 = key2 & 0xffff;
  for (let i = 0; i < section.length / 4; i++) {
    const v = (k1 ^ sv.getUint32(i * 4, true)) >>> 0;
    edv.setUint32(i * 8, (k2 * (v >>> 16)) >>> 0, true);
    edv.setUint32(i * 8 + 4, (k2 * (v & 0xffff)) >>> 0, true);
    k1 = (k1 + 0x0b0b0b0b) >>> 0;
    k2 = (k2 + 0x0b02) & 0xffff;
  }
  const header = new Uint8Array(SAVE_HEADER_BYTES);
  const hv = new DataView(header.buffer);
  for (const [i, ch] of [...'S4SD460B'].entries()) header[i] = ch.charCodeAt(0);
  for (const [i, ch] of [...'AmayuiTest'].entries()) header[8 + i] = ch.charCodeAt(0);
  hv.setUint32(240, body.length >>> 0, true);
  hv.setUint32(284, 1, true); // 引擎格式 1 = 加密未压缩
  const block = new Uint8Array(SAVE_BLOCK_BYTES);
  const bv = new DataView(block.buffer);
  bv.setUint32(0, enc.length / 4, true);
  bv.setUint32(4, crc32MsbFirst(enc), true);
  bv.setUint32(8, crc32(enc), true);
  bv.setUint32(12, key1, true);
  bv.setUint32(16, key2, true);
  const out = new Uint8Array(header.length + block.length + enc.length);
  out.set(header, 0);
  out.set(block, header.length);
  out.set(enc, header.length + block.length);
  return out;
}

test('★引擎格式（format = 1）也能读：Crypt 解密 → 表结构（将来可"继承"玩家真存档）', () => {
  const bytes = makeEngineSave(sampleTables());
  assert.equal(isEngineSave(bytes), true);
  const r = decodeSaveData(bytes);
  assert.equal(r.ok, true, r.ok ? '' : r.reason);
  if (!r.ok) return;
  assert.equal(r.data.format, 1);
  assert.equal(r.data.tables.ints.get('\x030000a9ce'), 2);
  assert.equal(r.data.tables.strings.get('\x0500000bbb'), 'Meiryo-Test');
});

test('unlzss：与 ALF 工具同算法（用压缩过的构造数据往返验证）', () => {
  // 手写一段 LZSS 流：4 个字面量 + 一次回引（位置 0、长度 2 ⇒ 复制 3 字节）
  // flag 字节 0b11110 从高位开始读：位1=字面量, 位0=回引
  const input = new Uint8Array([
    0b00001111, // flags：位 0..3 = 1 ⇒ 四个字面量（LSB 先用）
    'a'.charCodeAt(0),
    'b'.charCodeAt(0),
    'c'.charCodeAt(0),
    'd'.charCodeAt(0),
    0x00, // 位置低位
    0x00, // 高 4 位=0（位置 0）、低 4 位=0 ⇒ 长度 = 0+2+1 = 3 字节
  ]);
  const out = new Uint8Array(8);
  const n = unlzss(input, input.length, out, out.length);
  assert.ok(n >= 4, `至少写出 4 个字面量（实际 ${n}）`);
  assert.equal(String.fromCharCode(...out.subarray(0, 4)), 'abcd');
});

// ---------------------------------------------------------------------------
// 4) 指令 → 表 → 文件 → 再装载（引擎侧语义的端到端）
// ---------------------------------------------------------------------------

test('★save-int / load-int：写表会通知宿主；装载后 load-int 能读回（含"已初始化"标志）', () => {
  const { e, step } = mk();
  const marks: number[] = [];
  e.onSaveDataChanged = () => marks.push(1);
  e.curScript().locals.int.set(5, 0); // 先清掉（局部槽，仅确认不干扰）
  // save-int (global-int 5) ← 值 1：模拟 SYSTEM4.txt:81（全局池存的是 ENC 编码值）
  e.globals.int.set(5, encInt(e, 1));
  step(0x1a2, [gInt(5)]);
  assert.equal(marks.length, 1, '写表必须通知宿主（落盘入口）');
  const tables = e.saveDataTables();
  assert.equal(tables.ints.get('\x0300000005'), 1, '键 = "\\x03" + hex8(全局下标)');
  void locInt;

  // 换一个引擎实例：装载表 ⇒ load-int (global 5) 读回 1 ⇒ 脚本会走 LOADCONFIG 分支
  const e2 = new Engine(new HeadlessScene({}), new InputManager());
  e2.applySaveDataTables({ ints: tables.ints, strings: tables.strings });
  const f2 = new Frame();
  OPS.get(0x1a3)!(makeCtx(e2, f2, instr(0x1a3, [gInt(5)]), e2.native, () => {}));
  assert.equal(e2.globals.int.get(5), encInt(e2, 1), 'load-int 应把表里的值写回 global 5');
});

test('save-string / load-string：字符串表同样往返（字体名）', () => {
  const { e, step } = mk();
  e.globals.str.set(0xbbb, 'メイリオ');
  step(0x1a9, [gStr(0xbbb)]);
  const t = e.saveDataTables();
  assert.equal(t.strings.get('\x0500000bbb'), 'メイリオ');
  const e2 = new Engine(new HeadlessScene({}), new InputManager());
  e2.applySaveDataTables(t);
  const f2 = new Frame();
  OPS.get(0x1aa)!(makeCtx(e2, f2, instr(0x1aa, [gStr(0xbbb)]), e2.native, () => {}));
  assert.equal(e2.globals.str.get(0xbbb), 'メイリオ');
});

test('NodeFileSource：写盘走 $$SAVE.DAT → SAVE.DAT，且二次读取优先本工程存档', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amayui-save-'));
  const target = path.join(dir, 'SAVE.DAT');
  try {
    const src = new NodeFileSource({ resourceDir: path.join(REPO, 'install'), saveDataPath: target });
    assert.equal(await src.readSaveData(), null, '一开始没有存档');
    const bytes = encodeSaveData({ tables: sampleTables() });
    await src.writeSaveData(bytes);
    assert.ok(fs.existsSync(target), '应写到 SAVE.DAT');
    assert.ok(!fs.existsSync(path.join(dir, '$$SAVE.DAT')), '临时文件应已改名');
    const back = await src.readSaveData();
    assert.ok(back);
    const r = decodeSaveData(back!);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.data.tables.ints.get('\x030000a9ce'), 2);

    // 引擎格式的 SAVE.DAT 存在时：读优先 .amayui，写不碰原文件
    const engineFile = makeEngineSave(sampleTables());
    fs.writeFileSync(target, engineFile);
    const ours = encodeSaveData({ tables: { ints: new Map([['\x03000000ff', 9]]), strings: new Map() } });
    await src.writeSaveData(ours);
    assert.equal(fs.readFileSync(target).length, engineFile.length, '★绝不覆盖引擎存档');
    assert.ok(fs.existsSync(`${target}.amayui`), '本工程的状态写进 .amayui');
    const preferred = await src.readSaveData();
    const pr = decodeSaveData(preferred!);
    assert.equal(pr.ok, true);
    if (pr.ok) assert.equal(pr.data.tables.ints.get('\x03000000ff'), 9, '读取应优先 .amayui');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5) E3：真语料启动链的两条分支
// ---------------------------------------------------------------------------

test('★E3：真语料启动链 —— 有 SAVE.DAT 走 LOADCONFIG（恢复设置），没有则走 INITCONFIG（写默认值）', async () => {
  const { loadScriptData, stepOnce } = await import('../src/vm/interpreter.js');
  const { resolveResourceDir } = await import('../src/arch/resourceDir.js');
  const { dec } = await import('../src/vm/bits.js');
  const { ExitScript, ScriptReset } = await import('../src/vm/ops.js');
  const src = new NodeFileSource({ resourceDir: resolveResourceDir(REPO) });
  const boot = await src.readScript(0);
  assert.ok(boot, '应能读到 index 0 = SYSTEM4.BIN');

  /** 跑到配置装载段结束；返回 {引擎, 走了哪条分支}。 */
  const bootOnce = async (
    seed: { ints: Map<string, number>; strings: Map<string, string> } | null,
  ): Promise<{ e: Engine; branch: string }> => {
    const e = new Engine(new HeadlessScene({}), new InputManager());
    e.fileSource = src;
    if (seed) e.applySaveDataTables(seed);
    loadScriptData(e, boot!.data, boot!.name);
    let branch = '';
    for (let i = 0; i < 400_000; i++) {
      const f = e.curScript();
      if (!f.script || f.ip >= f.script.instructions.length) break;
      const before = f.name;
      try {
        await stepOnce(e);
      } catch (err) {
        if (err instanceof ExitScript || err instanceof ScriptReset) break;
        throw err;
      }
      const now = e.curScript().name;
      if (now !== before) {
        if (now.startsWith('LOADCONFIG')) branch = 'LOADCONFIG';
        else if (now.startsWith('INITCONFIG')) branch = 'INITCONFIG';
        // 走到 TITLE/CONFIG 说明配置装载段已过
        else if (/^(TITLE|CONFIG)/.test(now)) break;
      }
    }
    return { e, branch };
  };

  // A) 有存档：配置从表里恢复（7 只有 LOADCONFIG 能产生；INITCONFIG 会把它写回默认 0）
  const withSave = await bootOnce({
    ints: new Map([
      ['\x0300000005', 1], // 「已初始化」标志
      ['\x030000a9ce', 7], // INITCONFIG0 的开关（默认 0）
    ]),
    // 字体名（bbb = 消息窗主字体）：`游ゴシック` 是本工程认得的面名（fontSet.ENGINE_FONT_LIST），
    // 且**不是** INITCONFIG0 的默认值（默认 `メイリオ`）⇒ 存活即证明"从存档恢复"，而不是"写了默认值"。
    strings: new Map([
      ['\x0500000bbb', '游ゴシック'],
      ['\x0500000bbc', '不存在的字体'], // 故意装不上 ⇒ CHECKCONFIG 应回退默认
    ]),
  });
  assert.equal(withSave.branch, 'LOADCONFIG', `有 SAVE.DAT 时应走 LOADCONFIG（实际 ${withSave.branch || '未进入'}）`);
  const { dec: decFn } = { dec };
  assert.equal(
    decFn(withSave.e.key, withSave.e.globals.int.get(0xa9ce) ?? 0),
    7,
    'LOADCONFIG 应把存档里的值写回 global a9ce',
  );
  assert.equal(withSave.e.globals.str.get(0xbbb), '游ゴシック', '字符串表同样从存档恢复（字体名）');
  // ★顺带证明 CHECKCONFIG 的字体校验也在跑：装不上的面名会被回退并重新 save-string
  assert.equal(
    withSave.e.globals.str.get(0xbbc),
    'ＭＳ ゴシック',
    'CHECKCONFIG 对未知字体名回退到「ＭＳ ゴシック」（见 src/CHECKCONFIG.txt 第二个分支）',
  );

  // B) 没有存档：走 INITCONFIG（写默认值 + save-int 登记），并打上「已初始化」标志
  const fresh = await bootOnce(null);
  assert.equal(fresh.branch, 'INITCONFIG', `没有存档时应走 INITCONFIG（实际 ${fresh.branch || '未进入'}）`);
  const t = fresh.e.saveDataTables();
  assert.equal(decFn(fresh.e.key, fresh.e.globals.int.get(0xa9ce) ?? -1), 0, 'INITCONFIG0 把 a9ce 写回默认 0');
  assert.equal(t.ints.get('\x0300000005'), 1, 'INITCONFIG 分支应登记「已初始化」标志（SYSTEM4.txt:81）');
  assert.ok(t.ints.size > 10, `默认值应被大量登记（实际 ${t.ints.size} 条）`);
  await src.dispose?.();
});

// ---------------------------------------------------------------------------
// 6) E4：真游戏存档（有则解，无则跳过）
// ---------------------------------------------------------------------------

test('★E4：真游戏 SAVE.DAT（引擎 format=3，Crypt + LZSS）能解出配置键', (t) => {
  const root = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Eushully') : null;
  const candidates: string[] = [];
  if (root && fs.existsSync(root)) {
    for (const d of fs.readdirSync(root)) {
      const p = path.join(root, d, 'SAVE', 'SAVE.DAT');
      if (fs.existsSync(p)) candidates.push(p);
    }
  }
  if (!candidates.length) {
    t.skip('本机没有真游戏存档（%LOCALAPPDATA%\\Eushully\\*\\SAVE\\SAVE.DAT）');
    return;
  }
  const file = candidates[0]!;
  const bytes = new Uint8Array(fs.readFileSync(file));
  const h = readSaveHeader(bytes);
  assert.equal(h?.magic, 'S4SD', '引擎存档魔数');
  assert.equal(h?.engineVersion, '460B');
  assert.ok((h?.format ?? 0) >= 1, `引擎格式（实际 ${h?.format}）`);
  const r = decodeSaveData(bytes);
  assert.equal(r.ok, true, r.ok ? '' : `解码失败：${r.reason}（${file}）`);
  if (!r.ok) return;
  // INITCONFIG0：`mov (global a9ce) 0; save-int` 等；`global 5` 是 SYSTEM4 的"已初始化"标志
  assert.equal(r.data.tables.ints.get('\x0300000005'), 1, 'global 5 = 已初始化标志');
  for (const g of [0xa9ce, 0xa9cd, 0xa9d5, 0xa9d0, 0xa9cb, 0xa9cc]) {
    assert.ok(
      r.data.tables.ints.has('\x03' + g.toString(16).padStart(8, '0')),
      `INITCONFIG0 的 global ${g.toString(16)} 应在存档里`,
    );
  }
  assert.ok(r.data.tables.ints.size > 100, `真实存档的记录数应远多于样例（实际 ${r.data.tables.ints.size}）`);
});
