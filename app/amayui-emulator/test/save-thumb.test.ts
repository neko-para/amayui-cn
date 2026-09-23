/** @tier T1 @kind core @subsystem save */

/**
 * **`.STH` 存档缩略图 = BMP**（`tickets/T-0036`）：编解码 + `0x1AE`/`0x1AF` 的 op3 语义 + 真槽 E4。
 *
 * 引擎真源：
 *  - 写 `0x1AE`（`sub_42E1F0` raw 38515-38550）→ `sub_43BF20(Engine+1978, op3, handle)`（raw 47838，ddWriteBmp）
 *    写 `"BM"` + 40 字节 DIB + 24bpp 位；
 *  - 读 `0x1AF`（`sub_42E320` raw 38553-38594）→ `sub_40BF20`（raw 16072）→ `sub_43E9F0`（raw 49926，ddReadBmp）
 *    校验 `19778` 后把 BMP 解进 `op3` 那个纹理槽；
 *  - 真实调用面：`src/SAVE.txt:2086-2095`（先 `create-texture … 140 b4 0` = 320×180，再 `i1af`，判
 *    `op1 == 0` 后 `draw-texture … 140 b4 …` 画到列表右侧）。
 * E4（本机真槽）：47 个 `SAVE??.STH` 全是 172,854 字节 = 54 + 320×180×3，且头里 `bfSize` 写的是 172,840
 * （引擎 raw 47894 只加了 40 字节 DIB 头、漏算自己的 14 字节文件头）⇒ **解码不许信 bfSize**。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BMP_MAGIC, decodeBmp, encodeBmp, isBmp } from '../src/vm/bmp.js';
import { Engine } from '../src/vm/engine.js';
import { loadScriptIntoFrame, OPS } from '../src/vm/ops.js';
import { makeCtx } from '../src/vm/step.js';
import { readIntOperand } from '../src/vm/operand.js';
import { resolveSystemPaths } from '../src/arch/systemPaths.js';
import type { FileSource } from '../src/arch/fileSource.js';
import type { NativeBridge } from '../src/vm/native.js';
import type { BinArg, BinInstruction, ScriptBinary } from '../src/script/bin.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

const im = (n: number): BinArg => ({ type: 0, raw: n }) as unknown as BinArg;
const gInt = (n: number): BinArg => ({ type: 3, raw: n }) as unknown as BinArg;
const instr = (opcode: number, args: BinArg[] = []): BinInstruction =>
  ({ opcode, name: `i${opcode.toString(16)}`, argc: args.length, args, byteOffset: 0, index: 0 }) as unknown as BinInstruction;

/** 造一个装了合成脚本的引擎 + 记录纹理槽像素读写的 native。 */
function mkEngine(fsLike: FileSource): {
  e: Engine;
  written: { slot: number; w: number; h: number; rgba: Uint8Array }[];
  serve: { slot: number; w: number; h: number; rgba: Uint8Array } | null;
} {
  const written: { slot: number; w: number; h: number; rgba: Uint8Array }[] = [];
  const state = { serve: null as null | { slot: number; w: number; h: number; rgba: Uint8Array } };
  const native = {
    log: () => {},
    setSlotPixels: (slot: number, w: number, h: number, rgba: Uint8Array) => void written.push({ slot, w, h, rgba }),
    getSlotPixels: (slot: number) => (state.serve && state.serve.slot === slot ? state.serve : null),
  } as unknown as NativeBridge;
  const e = new Engine(native);
  const sc: ScriptBinary = {
    signature: 'SYS4450 ',
    isVer5: false,
    headerLen: 0x3c,
    localVars: [0, 0, 0, 0, 0, 0],
    subHeaderLength: 0,
    tables: [
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
      { length: 0, offset: 1 },
    ],
    instructions: [instr(0x1a7)],
    labelTargets: new Set<number>(),
    raw: new Uint8Array(0x3c + 12),
  };
  loadScriptIntoFrame(e.curScript(), sc, 'TEST.BIN', 0);
  e.fileSource = fsLike;
  return { e, written, serve: state.serve };
}

/** 只实现 `.STH` 两个方法的 FileSource。 */
function thumbFs(store: Map<number, Uint8Array>): FileSource {
  return {
    readFile: async () => new Uint8Array(0),
    readScript: async () => null,
    readSlotThumb: async (slot) => store.get(slot) ?? null,
    writeSlotThumb: async (slot, data) => void store.set(slot, data),
  } as unknown as FileSource;
}

async function runOp(e: Engine, opcode: number, args: BinArg[]): Promise<(k: number) => number> {
  const h = OPS.get(opcode);
  assert.ok(h, `0x${opcode.toString(16)} 应在 OPS 里`);
  const use = instr(opcode, args);
  await h!(makeCtx(e, e.curScript(), use, e.native, () => {}));
  return (k: number): number => readIntOperand(e, e.curScript(), use, k);
}

/** 造一张 w×h 的图案（每像素颜色不同，便于逐点比对）。 */
function pattern(w: number, h: number): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      rgba[i] = (x * 7) & 0xff;
      rgba[i + 1] = (y * 11) & 0xff;
      rgba[i + 2] = (x * y * 3) & 0xff;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

// ---------------------------------------------------------------------------
// BMP 编解码
// ---------------------------------------------------------------------------

test('BMP：编码→解码逐点一致（含奇数宽度 ⇒ 行 4 字节对齐）', () => {
  for (const [w, h] of [
    [320, 180],
    [3, 2], // 3*3 = 9 字节/行 ⇒ 补到 12
    [1, 1],
  ] as const) {
    const rgba = pattern(w, h);
    const bmp = encodeBmp({ width: w, height: h, rgba });
    assert.equal(isBmp(bmp), true);
    assert.equal(new DataView(bmp.buffer).getUint16(0, true), BMP_MAGIC);
    assert.equal(new DataView(bmp.buffer).getUint32(2, true), bmp.length, 'bfSize 写真实值（不与引擎的少 14 同款）');
    const back = decodeBmp(bmp);
    assert.ok(back, `${w}x${h} 应能解回`);
    assert.equal(back.width, w);
    assert.equal(back.height, h);
    assert.deepEqual([...back.rgba], [...rgba], `${w}x${h} 像素应逐点一致`);
  }
});

test('BMP：自顶向下（负高度）也能解；非 BMP / 压缩 / 截断 ⇒ null（不假装成功）', () => {
  const w = 2;
  const h = 2;
  const rgba = pattern(w, h);
  const bottomUp = encodeBmp({ width: w, height: h, rgba });
  // 手工做一个自顶向下的变体：高度取负、并把像素行顺序反过来
  const topDown = bottomUp.slice();
  new DataView(topDown.buffer).setInt32(22, -h, true);
  const rowBytes = 8; // ceil(2*3/4)*4 = 8
  const rows: number[][] = [];
  for (let y = 0; y < h; y++) rows.push([...topDown.slice(54 + y * rowBytes, 54 + (y + 1) * rowBytes)]);
  rows.reverse().forEach((row, y) => topDown.set(row, 54 + y * rowBytes));
  const back = decodeBmp(topDown);
  assert.ok(back);
  assert.deepEqual([...back.rgba], [...rgba], '自顶向下的行序也要正确翻转');

  assert.equal(decodeBmp(new Uint8Array([1, 2, 3, 4])), null, '非 BMP');
  assert.equal(decodeBmp(new Uint8Array(0)), null, '空');
  const compressed = bottomUp.slice();
  new DataView(compressed.buffer).setUint32(30, 1, true); // BI_RLE8
  assert.equal(decodeBmp(compressed), null, '压缩形态不猜');
  assert.equal(decodeBmp(bottomUp.slice(0, 60)), null, '截断文件 ⇒ null（2×2 需要 54+16=70 字节）');
});

// ---------------------------------------------------------------------------
// E4：本机真槽的 .STH
// ---------------------------------------------------------------------------

test('E4：真 `SAVE00.STH` 就是 320×180 的 24bpp BMP，且引擎的 bfSize 少写了 14', (t) => {
  const file = path.join(resolveSystemPaths(REPO).baseDir, 'SAVE', 'SAVE00.STH');
  if (!fs.existsSync(file)) {
    t.skip(`本机没有真缩略图 ${file}`);
    return;
  }
  const bytes = new Uint8Array(fs.readFileSync(file));
  assert.equal(bytes.length, 54 + 320 * 180 * 3, '长度 = BMP 头 + 像素（E4：172,854）');
  const bmp = decodeBmp(bytes);
  assert.ok(bmp, '应能解出');
  assert.equal(bmp.width, 320);
  assert.equal(bmp.height, 180);
  // 像素不是常量（真缩略图有内容）
  const first = [...bmp.rgba.slice(0, 3)];
  let differs = false;
  for (let i = 4; i < bmp.rgba.length; i += 4 * 971) {
    if (bmp.rgba[i] !== first[0] || bmp.rgba[i + 1] !== first[1] || bmp.rgba[i + 2] !== first[2]) differs = true;
  }
  assert.equal(differs, true, '真缩略图应有非均匀像素');
  // ★引擎把 bfSize 写成"像素字节数 + 40"（漏掉自己的 14 字节文件头）⇒ 解码头必须不依赖它
  const bfSize = new DataView(bytes.buffer).getUint32(2, true);
  assert.equal(bfSize, 320 * 180 * 3 + 40, 'E4：真槽头里的 bfSize = 像素 + 40（不是文件长度）');
  assert.equal(bytes.length - bfSize, 14, '差正好是 14 字节文件头');
});

// ---------------------------------------------------------------------------
// 0x1AF / 0x1AE 的 op3 语义
// ---------------------------------------------------------------------------

test('★0x1AF：把 .STH（BMP）解出的像素写进 op3 指定的纹理槽；op1 = 0', async () => {
  const store = new Map<number, Uint8Array>();
  const { e, written } = mkEngine(thumbFs(store));
  const rgba = pattern(8, 4);
  store.set(7, encodeBmp({ width: 8, height: 4, rgba }));

  const read = await runOp(e, 0x1af, [gInt(0x10), im(7), im(0x1234)]);
  assert.equal(read(1), 0, '成功 ⇒ op1 = 0');
  assert.equal(written.length, 1, '应把像素交给 op3 那个纹理槽');
  assert.equal(written[0]!.slot, 0x1234, '★op3 才是纹理槽（旧实现完全忽略它）');
  assert.equal(written[0]!.w, 8);
  assert.equal(written[0]!.h, 4);
  assert.deepEqual([...written[0]!.rgba], [...rgba], '像素逐点一致');
});

test('0x1AF：缺文件 ⇒ 1；非 BMP 且长度前缀也不成立 ⇒ 2；本工程旧格式（长度前缀）仍算读到', async () => {
  const store = new Map<number, Uint8Array>();
  const { e, written } = mkEngine(thumbFs(store));
  const missing = await runOp(e, 0x1af, [gInt(0x10), im(3), im(1)]);
  assert.equal(missing(1), 1, '打不开 ⇒ 1');

  store.set(4, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  const bad = await runOp(e, 0x1af, [gInt(0x10), im(4), im(1)]);
  assert.equal(bad(1), 2, '解不出 ⇒ 2');
  assert.equal(written.length, 0, '解不出时不得往纹理槽写东西');

  // 本工程 T-0018 的自描述块：4 字节小端长度前缀 + 载荷 ⇒ 认得出来（不写像素）
  const payload = new TextEncoder().encode('AMYTH1\n{}');
  const legacy = new Uint8Array(4 + payload.length);
  new DataView(legacy.buffer).setUint32(0, payload.length, true);
  legacy.set(payload, 4);
  store.set(5, legacy);
  const ok = await runOp(e, 0x1af, [gInt(0x10), im(5), im(1)]);
  assert.equal(ok(1), 0, '旧格式（本工程写的空块）仍算读到');
});

test('★0x1AE：把 op3 纹理槽的像素写成 .STH（BMP）—— 与 0x1AF 往返一致', async () => {
  const store = new Map<number, Uint8Array>();
  const ctx = mkEngine(thumbFs(store));
  const rgba = pattern(16, 9);
  // 宿主提供该槽的像素（Pixi 侧由 TextureCache 读 canvas；headless 返回 null）
  (ctx.e.native as unknown as { getSlotPixels: (s: number) => unknown }).getSlotPixels = (slot: number) =>
    slot === 0x55 ? { w: 16, h: 9, rgba } : null;

  const write = await runOp(ctx.e, 0x1ae, [gInt(0x10), im(2), im(0x55)]);
  assert.equal(write(1), 0, '写成功 ⇒ op1 = 0');
  const bytes = store.get(2);
  assert.ok(bytes && isBmp(bytes), '★写出的 .STH 必须是 BMP');
  const decoded = decodeBmp(bytes!);
  assert.ok(decoded);
  assert.deepEqual([decoded.width, decoded.height], [16, 9]);
  assert.deepEqual([...decoded.rgba], [...rgba], '往返（写→读）像素逐点一致');
});
