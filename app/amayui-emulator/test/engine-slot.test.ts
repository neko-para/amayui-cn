/** @tier T1 @kind core @subsystem save */

/**
 * **真游戏槽的状态主体解析**（`tickets/T-0059`）—— `src/vm/engineSlot.ts` 的守卫。
 *
 * 三层断言：
 *  1. **合成槽往返**：按 `sub_40CD10` 的写入布局造一份 body（帧镜像 + 三个池 + 三张表 + 绘制项清单），
 *     再按容器口径（`sub_436DE0` 置乱 + LZSS + 两个内层 CRC）包起来 ⇒ `decodeEngineSlot` 必须逐字段解回；
 *     ★并**故意改坏一个 body 字节** ⇒ 两个 CRC 至少有一个红，解码**如实失败**（不给出错位的帧表）；
 *  2. **落点换算**：`resolveSlotResumeIp`（`0x3` call-script 表优先、`0x71` 消息表兜底、`advance` 语义、
 *     越界 ⇒ null）与 `resolveSlotRetStack`（表 C 下标 → 返回点 dword 偏移 `+3`）；
 *  3. **E4 真槽**：本机 `%LOCALAPPDATA%\Eushully\天結いキャッスルマイスター\SAVE\SAVE??.DAT` 全部解出，
 *     且**每帧记录的落点 opcode 与语义自洽**（末帧 = `0x71` 消息、调用方帧 = `0x3` call-script）。
 *     没有真槽的机器上跳过（不假装通过）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SLOT_IMAGE_PRELUDE_BYTES,
  SLOT_IMAGE_RECORDS_AT,
  SLOT_IMAGE_SLOTS_AT,
  decodeEngineSlot,
  parseEngineSlotBody,
  resolveSlotResumeIp,
  resolveSlotRetStack,
  type EngineSlotFrame,
} from '../src/vm/engineSlot.js';
import { crc32, crc32MsbFirst } from '../src/util/crc32.js';
import { parseScriptBytes, type ScriptBinary } from '../src/script/bin.js';
import { OPCODE_TABLE } from '../src/opcodes.js';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { resolveResourceDir } from '../src/arch/resourceDir.js';
import { resolveSystemPaths } from '../src/arch/systemPaths.js';
import { SEEDS, buildBody, buildScriptBin, buildSlotFile, drawItemRecord } from './engineSlotFixtures.js';
import { ENGINE_DRAW_ITEM_BYTES, decodeEngineDrawItem } from '../src/vm/engineDrawItem.js';
import { assertFlags } from '../src/vm/native.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');



test('合成槽：容器往返 ⇒ 帧记录 / 三个池 / 三张表 / 图像清单逐字段解出', () => {
  const body = buildBody({
    savedCur: 1,
    savedRet: 7,
    pre8: 16,
    frames: [
      { returnFrame: -1, scriptId: 0, retIdx: [], messageIdx: 7, callIdx: 13 },
      { returnFrame: 0, scriptId: 0x13b7, retIdx: [83], messageIdx: 197, callIdx: -1 },
    ],
    ints: [3, 0, 1, 0, 5],
    floats: [1.5, 0],
    strings: ['', 'ABC', ''],
    ipTables: [
      [10, 20],
      [30],
      [40, 50, 60],
    ],
    images: [{ at: 0, id: 12345, flag: 1, param: 9 }],
    drawItems: [
      { handle: 0x18a88, record: drawItemRecord({ tex: 4, src: [0, 0, 2048, 1152] }) },
      { handle: 0x19835, record: drawItemRecord({ tex: 17, src: [182, 794, 316, 1530], pos: [1148, 0] }) },
    ],
  });
  const file = buildSlotFile(body, SEEDS);
  const dec = decodeEngineSlot(file);
  assert.ok(dec.ok, `合成槽必须解出（实际 ${dec.ok ? '' : dec.reason}）`);
  if (!dec.ok) return;
  const { payload: p, container } = dec;
  assert.equal(p.savedCur, 1);
  assert.equal(p.savedRet, 7);
  assert.equal(p.pre8, 16);
  assert.equal(p.frames.length, 2);
  assert.deepEqual(p.frames[0], { returnFrame: -1, scriptId: 0, retIdx: [], messageIdx: 7, callIdx: 13 });
  assert.deepEqual(p.frames[1], { returnFrame: 0, scriptId: 0x13b7, retIdx: [83], messageIdx: 197, callIdx: -1 });
  assert.deepEqual(p.ints, [3, 0, 1, 0, 5]);
  assert.deepEqual(p.floats, [1.5, 0]);
  assert.deepEqual(p.strings, ['', 'ABC', '']);
  assert.deepEqual(p.ipTableA, [10, 20]);
  assert.deepEqual(p.ipTableB, [30]);
  assert.deepEqual(p.ipTableC, [40, 50, 60]);
  assert.deepEqual(p.images[0], { id: 12345, flag: 1, param: 9 });
  assert.equal(p.records[0]!.id, 0, `记录区起点 = ${SLOT_IMAGE_RECORDS_AT}`);
  assert.deepEqual(p.drawItems?.map((d) => d.handle), [0x18a88, 0x19835], '绘制项清单逐条解出（handle 顺序照文件）');
  assert.equal(p.drawItems?.[0]?.record.length, ENGINE_DRAW_ITEM_BYTES, '记录体 = 740 B 原样字节');
  assert.equal(new DataView(p.drawItems![1]!.record.buffer, p.drawItems![1]!.record.byteOffset).getInt32(4, true), 17, '第 2 条记录体里的 tex');
  assert.equal(container.declaredBytes, container.decompressedBytes, '头 +240 与内层解压尺寸一致');
});

test('★绘制项清单的步长 = `4 + 4*size`（每条 2964 B）—— 第 2/3 条的 handle 必须读对', () => {
  // 真槽 79 的实测口径（`tickets/T-0083`）：`memcpy` 只搬 740 B，而推进是 `&v67[4 * hFile]`
  // （`hFile` = 记录**字节数** 740）⇒ 每条后面还有 2220 B 未用区。按 `1 + size/4`（744 B）读
  // 会把记录体内部的字节当成下一条的 handle（实测得到 `0,0,0,0xb6,…`）。
  const handles = [0x18a88, 0x19835, 0x19a28];
  const body = buildBody({
    savedCur: 0,
    savedRet: -1,
    pre8: 0,
    frames: [{ returnFrame: -1, scriptId: 100, retIdx: [], messageIdx: -1, callIdx: -1 }],
    ints: [],
    floats: [],
    strings: [],
    ipTables: [[], [], []],
    drawItems: handles.map((h, k) => ({ handle: h, record: drawItemRecord({ tex: k + 1, src: [0, 0, 8, 8] }) })),
  });
  const dec = decodeEngineSlot(buildSlotFile(body, SEEDS));
  assert.ok(dec.ok);
  if (!dec.ok) return;
  assert.deepEqual(dec.payload.drawItems?.map((d) => d.handle), handles, '三条 handle 全部读对（步长 2964 B）');
  assert.deepEqual(
    dec.payload.drawItems?.map((d) => new DataView(d.record.buffer, d.record.byteOffset).getInt32(4, true)),
    [1, 2, 3],
    '每条的记录体也是各自那一份（没有串位）',
  );
});

test('绘制项清单结构不符 ⇒ `drawItems = null`（不致命，也不当成坏档）', () => {
  const base = {
    savedCur: 0,
    savedRet: -1,
    pre8: 0,
    frames: [{ returnFrame: -1, scriptId: 100, retIdx: [], messageIdx: -1, callIdx: -1 }],
    ints: [],
    floats: [],
    strings: [],
    ipTables: [[], [], []] as [number[], number[], number[]],
  };
  // ① 记录字节数不是 740 ⇒ 守卫拒绝（引擎只把 740 B 搬进 740 B 元素；别的值会溢出）
  const bad1 = decodeEngineSlot(buildSlotFile(buildBody({ ...base, drawItems: [{ handle: 1 }], drawItemsHeader: { size: 999 } }), SEEDS));
  assert.ok(bad1.ok, '清单读不出来不致命（槽本身仍然解析成功）');
  if (bad1.ok) assert.equal(bad1.payload.drawItems, null, 'size ≠ 740 ⇒ null');
  // ② count 大到越界 ⇒ null
  const bad2 = decodeEngineSlot(buildSlotFile(buildBody({ ...base, drawItems: [{ handle: 1 }], drawItemsHeader: { count: 4096 } }), SEEDS));
  assert.ok(bad2.ok);
  if (bad2.ok) assert.equal(bad2.payload.drawItems, null, 'count 越界 ⇒ null');
  // ③ body 里根本没有清单（本工程槽/旧布局）⇒ 也是 null（装载点据此退回 (B) 近似）
  const none = decodeEngineSlot(buildSlotFile(buildBody(base), SEEDS));
  assert.ok(none.ok);
  if (none.ok) assert.equal(none.payload.drawItems, null, '没有清单 ⇒ null');
});

test('★body 被改坏一个字节 ⇒ 内层 CRC 拒绝（不返回错位的帧表）', () => {
  const body = buildBody({
    savedCur: 0,
    savedRet: 0,
    pre8: 1,
    frames: [{ returnFrame: -1, scriptId: 0, retIdx: [], messageIdx: 0, callIdx: -1 }],
    ints: [1],
    floats: [],
    strings: [],
    ipTables: [[0], [], []],
  });
  // 负例构造：**先**按正确 body 算 CRC，再改一个 body 字节（帧记录里的 scriptId）⇒ 内层校验必须红。
  const good = buildSlotFile(body, SEEDS);
  const crcA = crc32MsbFirst(body);
  const crcB = crc32(body);
  body[SLOT_IMAGE_PRELUDE_BYTES + 4] ^= 0xff;
  const bad = buildSlotFile(body, { ...SEEDS, crcOverride: [crcA, crcB] });
  const okDec = decodeEngineSlot(good);
  assert.equal(okDec.ok, true, '未改坏的那份必须能解（否则负例没有意义）');
  const dec = decodeEngineSlot(bad);
  assert.equal(dec.ok, false, 'CRC 不符必须如实失败');
  assert.match(dec.ok ? '' : dec.reason, /CRC/, '失败原因应指向内层 CRC');
});

test('落点换算：`0x3` call-script 表优先且 advance=true；`0x71` 消息表兜底且 advance=false', () => {
  // 指令序列（dword 下标）：0: i0ae, 1..2: i071 1（argc1 → dword 1..3）…
  const bin = buildScriptBin([
    { op: 0xae, args: [] }, //                        dword 0
    { op: 0x71, args: [{ type: 0, raw: 1 }] }, //     dword 1..3（0x71 表[0] = 1）
    { op: 0x03, args: [{ type: 0, raw: 0x5264 }] }, // dword 4..6（0x3 表[0] = 4）
    { op: 0x71, args: [{ type: 0, raw: 2 }] }, //     dword 7..9（0x71 表[1] = 7）
  ]);
  const script = parseScriptBytes(bin);
  assert.deepEqual(script.ipTables[0], [1, 7], '0x71 表 = 消息指令的 dword 偏移');
  assert.deepEqual(script.ipTables[1], [4], '0x3 表 = call-script 指令的 dword 偏移');
  assert.deepEqual(script.ipTables[2], [], '0x8F 表为空');

  const mk = (callIdx: number, messageIdx: number): EngineSlotFrame => ({
    returnFrame: -1,
    scriptId: 0,
    retIdx: [],
    messageIdx,
    callIdx,
  });
  const byCall = resolveSlotResumeIp(script, mk(0, 1));
  assert.deepEqual(byCall, { instr: 2, advance: true, from: 'call', dword: 4 }, 'callIdx 优先（调用点不重放）');
  const byMsg = resolveSlotResumeIp(script, mk(-1, 0));
  assert.deepEqual(byMsg, { instr: 1, advance: false, from: 'message', dword: 1 }, '消息点要重放');
  assert.equal(resolveSlotResumeIp(script, mk(-1, 99)), null, '消息下标越界 ⇒ null');
  assert.equal(resolveSlotResumeIp(script, mk(-1, -1)), null, '两个都没有 ⇒ null');
});

test('返回栈换算：表 C 下标 → 返回点 dword 偏移（+3）；越界项丢弃并计数', () => {
  const bin = buildScriptBin([
    { op: 0x8f, args: [{ type: 0, raw: 0x1234 }] }, // dword 0..2（0x8F 表[0] = 0）
    { op: 0xae, args: [] }, //                        dword 3
    { op: 0x8f, args: [{ type: 0, raw: 0x5678 }] }, // dword 4..6（0x8F 表[1] = 4）
  ]);
  const script: ScriptBinary = parseScriptBytes(bin);
  assert.deepEqual(script.ipTables[2], [0, 4], '0x8F 表 = call 指令的 dword 偏移');
  const r = resolveSlotRetStack(script, { returnFrame: 0, scriptId: 1, retIdx: [0, 1, 99, -1], messageIdx: -1, callIdx: -1 });
  assert.deepEqual(r.retStack, [3, 7], '表 C 值 + 3（= 引擎 raw 18945 的 `+3`）');
  assert.equal(r.dropped, 2, '越界/非法下标被丢弃（不假装还原）');
});

test('★E4：本机真槽全部解出，且每帧记录的落点 opcode 与语义自洽', async (t) => {
  const system = resolveSystemPaths(REPO);
  const dir = path.join(system.baseDir, 'SAVE');
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((f) => /^SAVE\d\d\.DAT$/.test(f)).sort();
  } catch {
    names = [];
  }
  if (names.length === 0) {
    t.skip(`本机没有真存档槽（${dir}）`);
    return;
  }
  const src = new NodeFileSource({ resourceDir: resolveResourceDir(REPO), system });
  let checkedFrames = 0;
  let slots = 0;
  const failures: string[] = [];
  for (const name of names) {
    const bytes = new Uint8Array(fs.readFileSync(path.join(dir, name)));
    const dec = decodeEngineSlot(bytes);
    if (!dec.ok) {
      failures.push(`${name}: ${dec.reason}`);
      continue;
    }
    slots++;
    const p = dec.payload;
    if (p.frames[0]!.scriptId !== 0) failures.push(`${name}: 根帧脚本 id = ${p.frames[0]!.scriptId}（真槽应是 0）`);
    if (p.frames[0]!.returnFrame !== -1) failures.push(`${name}: 根帧 returnFrame = ${p.frames[0]!.returnFrame}（应是 -1）`);
    for (let k = 0; k <= p.savedCur; k++) {
      const rec = p.frames[k]!;
      const sb = await src.readScript(rec.scriptId);
      if (!sb) {
        failures.push(`${name} 帧${k}: 脚本 0x${rec.scriptId.toString(16)} 读不到`);
        continue;
      }
      const script = parseScriptBytes(sb.data);
      const ip = resolveSlotResumeIp(script, rec);
      if (!ip) {
        failures.push(`${name} 帧${k}（${sb.name}）: 落点解不出（call=${rec.callIdx} msg=${rec.messageIdx}）`);
        continue;
      }
      // 语义：末帧（存档帧）停在消息（0x71）；更早的帧停在 call-script（0x3）；根帧也是 0x3。
      const op = script.instructions[ip.instr]!.opcode;
      const want = ip.from === 'call' ? 0x03 : 0x71;
      if (op !== want) failures.push(`${name} 帧${k}（${sb.name}）: 落点 opcode=0x${op.toString(16)} ≠ 0x${want.toString(16)}`);
      checkedFrames++;
    }
  }
  assert.deepEqual(failures, [], `真槽解析/落点自洽性检查失败：\n${failures.join('\n')}`);
  assert.ok(slots >= 1 && checkedFrames >= slots, `至少检查了 ${slots} 个槽、${checkedFrames} 帧`);
});

test('★E4b：真槽的**绘制项清单**逐条可解码（handle 唯一 + flags 位已知 + 记录 740 B）', (t) => {
  // 为什么单列一条：清单的**步长**（`4 + 4*size` = 2964 B/条）与 740 B 记录的字段偏移，
  // 只要错一处就会静默画出垃圾（不会报错）。这里拿本机/缓存里的真槽逐条解码：
  //  ① 记录长度必须 740；② handle 不能重复（重复 = 串位）；③ `assertFlags` 不抛（位全在已知集合里，
  //  否则说明偏移读错了）；④ `decodeEngineDrawItem` 不抛。真槽 79 实测 69 条、全 `0b001`/`0b011`。
  const system = resolveSystemPaths(REPO);
  const dirs = [path.join(system.baseDir, 'SAVE'), path.join(system.overlayDir, 'SAVE')];
  const found: { name: string; bytes: Uint8Array }[] = [];
  for (const dir of dirs) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir).filter((f) => /^SAVE\d\d\.DAT$/.test(f)).sort();
    } catch {
      names = [];
    }
    for (const n of names) found.push({ name: n, bytes: new Uint8Array(fs.readFileSync(path.join(dir, n))) });
  }
  if (found.length === 0) {
    t.skip(`本机没有真存档槽（${dirs.join(' 与 ')}）`);
    return;
  }
  let slots = 0;
  let withList = 0;
  let items = 0;
  const failures: string[] = [];
  for (const { name, bytes } of found) {
    const dec = decodeEngineSlot(bytes);
    if (!dec.ok) continue; // 坏档/旧布局由上面的 E4 负责，这里只看能解开的那些
    slots++;
    const list = dec.payload.drawItems;
    if (!list) continue;
    withList++;
    const seen = new Set<number>();
    for (const d of list) {
      items++;
      if (d.record.length !== ENGINE_DRAW_ITEM_BYTES) {
        failures.push(`${name}: handle 0x${d.handle.toString(16)} 的记录长度 ${d.record.length} ≠ ${ENGINE_DRAW_ITEM_BYTES}`);
        continue;
      }
      if (seen.has(d.handle)) failures.push(`${name}: handle 0x${d.handle.toString(16)} 出现两次（步长/串位？）`);
      seen.add(d.handle);
      try {
        const it = decodeEngineDrawItem(d.handle, d.record);
        assertFlags('drawitem', it.handle, it.flags);
      } catch (err) {
        failures.push(`${name}: handle 0x${d.handle.toString(16)} 解码/校验失败 —— ${(err as Error).message}`);
      }
    }
  }
  assert.deepEqual(failures, [], `真槽绘制项清单解码失败：\n${failures.join('\n')}`);
  assert.ok(slots >= 1, `至少解出一个真槽（实际 ${slots}）`);
  t.diagnostic(`[E4b] 真槽 ${slots} 个（带绘制项清单 ${withList} 个），逐条解码 ${items} 项`);
});

test('`buildScriptBin` 自检：三张表长度 = 对应 opcode 的出现次数（表口径棘轮）', () => {
  const bin = buildScriptBin([
    { op: 0x71, args: [{ type: 0, raw: 1 }] },
    { op: 0x71, args: [{ type: 0, raw: 2 }] },
    { op: 0x8f, args: [{ type: 0, raw: 9 }] },
    { op: 0xae, args: [] },
  ]);
  const s = parseScriptBytes(bin);
  assert.equal(s.ipTables[0]!.length, 2);
  assert.equal(s.ipTables[2]!.length, 1);
  assert.equal(s.instructions.length, 4, '指令流止于第一张表（min(offset)）');
  assert.equal(OPCODE_TABLE.find((o) => o.opcode === 0x71)!.argc, 1, '0x71 的 argc = 1（表项口径的前提）');
});
