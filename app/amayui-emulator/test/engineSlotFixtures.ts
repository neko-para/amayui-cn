/**
 * **真游戏槽的测试夹具**（`tickets/T-0059`）—— 合成脚本二进制 + 合成槽 body/容器。
 *
 * 为什么把夹具抽出来：`test/engine-slot.test.ts`（解析层）与 `test/slot-load-resume.test.ts`（VM 层）
 * 必须用**同一份**布局口径造槽，否则两边会各自漂移（一边改步长、另一边还按旧布局断言）。
 *
 * 口径来源（都是本仓/反编译里已确证的事实）：
 *  - 脚本二进制：头 0x3C + 指令流 + 三张表；表 `{len, offset}` 与表项**都是相对 headerLen 的 dword 下标/偏移**
 *    （`scripts/asm/reassembler.mjs:212-225` 的组装侧 + 真语料 64/64 命中率实测，见 `tickets/T-0059`）；
 *    表 1/2/3 = `0x71`（消息）/`0x3`（call-script）/`0x8F`（call）指令的偏移。
 *  - 槽 body：`sub_410160`（读）+ `sub_40CD10`（写）的 `a4 == 3` 布局（帧镜像 + 池块 + 图像清单）；
 *  - 容器：292 B 头 + 20 B 块 + `sub_436E90` 置乱流（LZSS 压 + 两个内层 CRC）。
 */
import { crc32, crc32MsbFirst } from '../src/vm/crc32.js';
import {
  SLOT_IMAGE_PRELUDE_BYTES,
  SLOT_IMAGE_SLOTS_AT,
  lzssLiterals,
  scrambleSlotPayload,
  type EngineSlotFrame,
} from '../src/vm/engineSlot.js';

export interface FakeOp {
  op: number;
  args: { type: number; raw: number }[];
}

/** 造一份真实口径的 v4 脚本二进制（`SYS4450`），三张表按指令出现位置自动生成。 */
export function buildScriptBin(ops: FakeOp[]): Uint8Array {
  const HEADER = 0x3c;
  const code: number[] = [];
  const marks: { idx: number; op: number }[] = [];
  let dword = 0;
  for (const o of ops) {
    marks.push({ idx: dword, op: o.op });
    code.push(o.op);
    for (const a of o.args) code.push(a.type, a.raw);
    dword += 1 + 2 * o.args.length;
  }
  const pick = (op: number): number[] =>
    marks
      .filter((m) => m.op === op)
      .map((m) => m.idx)
      .sort((a, b) => a - b);
  const t1 = pick(0x71);
  const t2 = pick(0x03);
  const t3 = pick(0x8f);
  const footerAt = dword; // = (codeEnd - HEADER) / 4
  const out = new Uint8Array(HEADER + 4 * code.length + 4 * (t1.length + t2.length + t3.length));
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) out[i] = 'SYS4450 '.charCodeAt(i)!;
  dv.setUint32(0x24, t1.length, true);
  dv.setUint32(0x28, footerAt, true);
  dv.setUint32(0x2c, t2.length, true);
  dv.setUint32(0x30, footerAt + t1.length, true);
  dv.setUint32(0x34, t3.length, true);
  dv.setUint32(0x38, footerAt + t1.length + t2.length, true);
  code.forEach((v, i) => dv.setUint32(HEADER + 4 * i, v >>> 0, true));
  [...t1, ...t2, ...t3].forEach((v, i) => dv.setUint32(HEADER + 4 * code.length + 4 * i, v >>> 0, true));
  return out;
}

/** 按 `sub_40CD10` 的 `case 3` 布局造一份 body（帧镜像 + 池块 + 图像清单）。 */
export function buildBody(opt: {
  savedCur: number;
  savedRet: number;
  pre8: number;
  frames: EngineSlotFrame[];
  ints: number[];
  floats: number[];
  strings: string[];
  ipTables: [number[], number[], number[]];
  images?: { at: number; id: number; flag: number; param: number }[];
}): Uint8Array {
  const imageBytes = 1044 * opt.savedCur + 22296;
  const enc = new TextEncoder();
  const strBlob = opt.strings.map((s) => [...enc.encode(s), 0]).flat();
  const intsLen = opt.ints.length;
  const ipLens = opt.ipTables.map((t) => t.length);
  const total =
    imageBytes + 24 + 4 * intsLen + 4 * opt.floats.length + 4 + 4 * Math.ceil(strBlob.length / 4) +
    4 * (ipLens[0]! + ipLens[1]! + ipLens[2]!);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setInt32(0, opt.savedCur, true);
  dv.setInt32(4, opt.savedRet, true);
  dv.setInt32(8, opt.pre8, true);
  for (const img of opt.images ?? []) {
    const at = SLOT_IMAGE_SLOTS_AT + 12 * img.at;
    dv.setInt32(at, img.id, true);
    dv.setInt32(at + 4, img.flag, true);
    dv.setInt32(at + 8, img.param, true);
  }
  for (let k = 0; k < opt.frames.length; k++) {
    const f = opt.frames[k]!;
    const at = SLOT_IMAGE_PRELUDE_BYTES + 1044 * k;
    dv.setInt32(at, f.returnFrame, true);
    dv.setInt32(at + 4, f.scriptId, true);
    dv.setInt32(at + 8, f.retIdx.length, true);
    f.retIdx.forEach((v, j) => dv.setInt32(at + 12 + 4 * j, v, true));
    dv.setInt32(at + 4 * 259, f.messageIdx, true);
    dv.setInt32(at + 4 * 260, f.callIdx, true);
  }
  let p = imageBytes;
  dv.setInt32(p, intsLen, true);
  dv.setInt32(p + 4, opt.floats.length, true);
  dv.setInt32(p + 8, opt.strings.length, true);
  dv.setInt32(p + 12, ipLens[0]!, true);
  dv.setInt32(p + 16, ipLens[1]!, true);
  dv.setInt32(p + 20, ipLens[2]!, true);
  p += 24;
  opt.ints.forEach((v, i) => dv.setInt32(p + 4 * i, v, true));
  p += 4 * intsLen;
  opt.floats.forEach((v, i) => dv.setFloat32(p + 4 * i, v, true));
  p += 4 * opt.floats.length;
  dv.setInt32(p, Math.ceil(strBlob.length / 4), true);
  p += 4;
  out.set(Uint8Array.from(strBlob), p);
  p += 4 * Math.ceil(strBlob.length / 4);
  for (const t of opt.ipTables) {
    t.forEach((v, i) => dv.setInt32(p + 4 * i, v, true));
    p += 4 * t.length;
  }
  return out;
}

export const SEEDS = { seed1: 0x572c4a08, seed2: 0x266f };

/** 把 body 包成真槽容器（292 B 头 + 20 B 块 + 置乱流），口径同 `sub_437480`/`sub_436DE0`。 */
export function buildSlotFile(
  body: Uint8Array,
  opt: { seed1: number; seed2: number; format?: number; aux?: number; crcOverride?: [number, number]; playSeconds?: number },
): Uint8Array {
  const decomp = new Uint8Array(8 + body.length);
  const dvd = new DataView(decomp.buffer);
  dvd.setUint32(0, (opt.crcOverride?.[0] ?? crc32MsbFirst(body)) >>> 0, true);
  dvd.setUint32(4, (opt.crcOverride?.[1] ?? crc32(body)) >>> 0, true);
  decomp.set(body, 8);
  const lz = lzssLiterals(decomp);
  const plain = new Uint8Array(4 * Math.ceil((12 + lz.length) / 4));
  const pd = new DataView(plain.buffer);
  pd.setUint32(0, decomp.length, true);
  pd.setUint32(4, decomp.length, true);
  pd.setUint32(8, lz.length, true);
  plain.set(lz, 12);
  const scrambled = scrambleSlotPayload(plain, opt.seed1, opt.seed2);
  const out = new Uint8Array(292 + 20 + scrambled.length);
  const dv = new DataView(out.buffer);
  const enc = (s: string, at: number): void => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i) & 0xff;
  };
  enc('S4SD', 0);
  enc('460B', 4);
  dv.setUint32(240, decomp.length, true);
  dv.setInt32(280, opt.playSeconds ?? 4242, true);
  dv.setUint32(284, opt.format ?? 3, true);
  dv.setUint32(288, opt.aux ?? 20, true);
  dv.setUint32(292, scrambled.length / 4, true);
  dv.setUint32(304, opt.seed1 >>> 0, true);
  dv.setUint32(308, opt.seed2 >>> 0, true);
  out.set(scrambled, 312);
  return out;
}
