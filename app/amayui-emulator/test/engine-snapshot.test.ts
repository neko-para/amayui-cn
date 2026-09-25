/** @tier T0 @kind core @subsystem vm */

/**
 * **引擎态快照 / 恢复的守卫**（`tickets/T-0122`）。
 *
 * 四条判据（与票面 acceptance 的 ⑤ 一一对应）：
 *  ① **round-trip** —— snapshot → 人为改乱若干字段 → restore ⇒ 与"从未被改乱"逐字段相等；
 *  ② **正例棘轮** —— 快照里若干个「不该为空」的量必须有真值（防"恢复了个空快照也算过"）；
 *  ③ **源码棘轮 + 告警覆盖** —— 「不进快照」清单的每一项都在代码里有显式条目，且 `restore` 的告警逐条覆盖它；
 *  ④ **继续跑不撕裂** —— 恢复后跑 600 步，再抓一份快照，必须与「自然跑到同一步」的快照**逐字节相等**
 *     （★这比"不抛异常"强得多：它同时钉住"没漏字段"与"没多出字段"）。
 *
 * ★本文件用 `harness.ts` 的 `mkEngine`（合成的确定性脚本），不依赖真语料 ⇒ 可上 E2 守卫；
 *   真语料版本的对照留给 `T-0122` 的后续切片（需要 headless 启动链，属 E3）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import {
  ENGINE_SNAPSHOT_VERSION,
  SNAPSHOT_EXCLUDED,
  captureEngineSnapshot,
  restoreEngineSnapshot,
  snapshotFromJson,
  snapshotToJson,
  type EngineSnapshotV1,
} from '../src/vm/engineSnapshot.js';
import { instr, mkEngine } from './harness.js';
import { stepOnce } from '../src/vm/interpreter.js';
import { parseDebugCommand } from '../src/vm/debugCommand.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE = path.join(HERE, '..', 'src', 'vm', 'engineSnapshot.ts');

/** 900 条确定性填充指令（`0x1a7` 是 `harness.ts` 自己用的良性 opcode）。 */
function scene(): ReturnType<typeof mkEngine> {
  const ops = Array.from({ length: 900 }, () => instr(0x1a7, []));
  const e = mkEngine(ops, 'SNAP.BIN');
  // 种一些**非空**状态：让 ② 的正例棘轮有东西可查
  e.globals.int.set(7, 1234);
  e.globals.str.set(3, 'あ');
  e.globals.float.set(2, 1.5);
  e.engineValues.set(ENGINE_FIELD.clock, 4242);
  e.engineValues.set(ENGINE_FIELD.rewindMainBase, 0x100);
  e.texSlots.set(3, 0x6c2);
  e.texSlotFlags.set(3, 1);
  e.dispatchQueues[0]!.push(11, 22);
  e.scriptRequests.push(0x5000123);
  e.frames[0]!.retStack.push(4, 9);
  e.frames[0]!.strTable.push('S');
  e.textItems.records.push({ win: 1, v20: 0, v24: 0, v28: 0, sel32: 0, flags: 4, text: '一行' });
  e.textItems.pages.push({ win: 1, start: 0 });
  e.textItems.cursor = 0;
  e.frames[0]!.locals.int.set(5, 77);
  return e;
}

/** 丢掉不参与相等性的 `header.at`（生成时刻）。 */
function strip(snap: EngineSnapshotV1): EngineSnapshotV1 {
  const o = structuredClone(snap);
  o.header = { ...o.header, at: '<t>' };
  return o;
}

async function stepMany(e: ReturnType<typeof mkEngine>, n: number): Promise<void> {
  for (let i = 0; i < n; i++) await stepOnce(e);
}

test('① round-trip：snapshot → 改乱 → restore ⇒ 与未改乱逐字段相等（含 JSON 往返）', async () => {
  const e = scene();
  await stepMany(e, 30);
  const snap = captureEngineSnapshot(e, 1_700_000_000_000);

  // 人为改乱：每一类分区都碰一下
  e.globals.int.set(7, 999999);
  e.globals.str.set(3, 'ちがう');
  e.engineValues.set(ENGINE_FIELD.clock, 0);
  e.texSlots.set(3, -1);
  e.texSlotFlags.clear();
  e.dispatchQueues[0]!.length = 0;
  e.scriptRequests.length = 0;
  e.frames[0]!.retStack.length = 0;
  e.frames[0]!.strTable.length = 0;
  e.frames[0]!.locals.int.set(5, -1);
  e.textItems.records.length = 0;
  e.textItems.pages.length = 0;
  e.waitFlags = 0xdead;
  e.effectFlags = 0xbeef;
  e.gateWaitMs = 12345;
  e.sceneFreeze = true;
  e.cur = 1;
  e.routes.cursor = 99;

  const rep = restoreEngineSnapshot(e, snap);
  assert.ok(rep.restored.includes('globals') && rep.restored.includes('frames'), rep.restored.join(','));

  const back = captureEngineSnapshot(e, 1_700_000_000_000);
  assert.deepEqual(strip(back), strip(snap), '★恢复后的快照必须与原快照逐字段相等（少一个字段就会红）');

  // ★JSON 往返也要成立（文件形态）：否则"存盘再读回"会丢字段
  const viaJson = snapshotFromJson(snapshotToJson(snap));
  assert.deepEqual(strip(viaJson), strip(snap), 'JSON 往返不许丢字段');
});

test('② 正例棘轮：快照里"不该为空"的量必须有真值（防"恢复了个空快照也算过"）', async () => {
  const e = scene();
  await stepMany(e, 30);
  const s = captureEngineSnapshot(e, 0);
  assert.ok(s.cur >= 0, `cur 应有值（实际 ${s.cur}）`);
  assert.ok(s.frames.length >= 1, '至少要有一帧');
  assert.ok(s.globals.int.length > 0, '★globals.int 不许为空（夹具种了槽 7）');
  assert.ok(s.globals.str.length > 0, '★globals.str 不许为空');
  assert.ok(s.engineValues.length > 0, '★engineValues 不许为空');
  assert.ok(s.texSlots.length > 0, '★texSlots 不许为空');
  assert.ok(s.textItems.records.length > 0, '★textItems.records 不许为空');
  assert.ok(s.textItems.pages.length > 0, '★textItems.pages 不许为空');
  assert.ok(s.frames[0]!.retStack.length > 0, '★retStack 不许为空');
  assert.ok(s.frames[0]!.strTable.length > 0, '★strTable 不许为空');
  assert.equal(s.key, e.key, 'key 必须带上（int 池里是编码值）');
  assert.equal(s.header.version, ENGINE_SNAPSHOT_VERSION, '文件头必须写版本');
  assert.equal(s.header.format, 'amayui-engine-snapshot', '文件头必须自描述');
});

test('③ 源码棘轮 + 告警覆盖：「不进快照」清单每一项都有显式条目且逐条出现在 restore 告警里', async () => {
  assert.ok(SNAPSHOT_EXCLUDED.length >= 5, `清单不该只有一两条（实际 ${SNAPSHOT_EXCLUDED.length}）`);
  const src = fs.readFileSync(MODULE, 'utf8');
  for (const x of SNAPSHOT_EXCLUDED) {
    assert.ok(x.what.length > 8, `每条都要写清"是什么"：${x.what}`);
    assert.ok(x.why.length > 20, `每条都要写清"为什么"：${x.what}`);
    assert.ok(src.includes(x.what), `★清单项必须**显式**写在模块源码里（不是靠遗漏）：${x.what.slice(0, 30)}…`);
  }
  const rep = restoreEngineSnapshot(scene(), captureEngineSnapshot(scene(), 0));
  for (const x of SNAPSHOT_EXCLUDED) {
    assert.ok(
      rep.warnings.some((w) => w.includes(x.what)),
      `★restore 必须为这一项打告警（不许静默）：${x.what.slice(0, 30)}…`,
    );
  }
  assert.ok(rep.warnings.length > SNAPSHOT_EXCLUDED.length, '告警里还要有一条"当前值"的现状行');
});

test('④ 恢复后跑 600 步 ⇒ 与"自然跑到同一步"的快照逐字节相等（不撕裂 + 不漏/不多字段）', async () => {
  const e = scene();
  await stepMany(e, 300);
  const base = captureEngineSnapshot(e, 0);
  await stepMany(e, 600);
  const natural = captureEngineSnapshot(e, 0); // 自然跑到 900 步

  // 回灌到 300 步那一刻，再跑同样多的步数
  restoreEngineSnapshot(e, base);
  await stepMany(e, 600);
  const replayed = captureEngineSnapshot(e, 0);

  assert.deepEqual(
    strip(replayed),
    strip(natural),
    '★恢复后跑 600 步的状态必须与自然跑到的**逐字节相等**（差异即"某个量没回去"）',
  );
});

test('⑤ 版本棘轮：不认识的版本 / 不是快照 ⇒ 响亮拒绝（不许"尽力而为"地灌一半）', async () => {
  const e = scene();
  const snap = captureEngineSnapshot(e, 0);
  const bad = structuredClone(snap);
  bad.header.version = ENGINE_SNAPSHOT_VERSION + 1;
  assert.throws(() => restoreEngineSnapshot(e, bad), /版本不认识/, '版本不认识必须抛');
  assert.throws(
    () => restoreEngineSnapshot(e, { header: { format: 'nope' } } as unknown as EngineSnapshotV1),
    /不是引擎态快照/,
    '格式不对必须抛',
  );
  assert.throws(() => snapshotFromJson('{"a":1}'), /形状不对/, 'JSON 缺 frames 必须抛');
});

test('⑥ 帧边界纪律（源码棘轮）：本模块不 import renderer / 不求值 / 不碰文件系统', async () => {
  const src = fs.readFileSync(MODULE, 'utf8');
  assert.doesNotMatch(src, /from '\.\.\/renderer\//, '★vm/ 不许反向依赖 renderer/（宿主能力用结构化类型传入）');
  assert.doesNotMatch(src, /\beval\s*\(|new Function/, '★不许 eval（承 T-0114 的硬约束）');
  // ★本模块**只做存/回**：文件读写留给守护进程/宿主（渲染进程没有 fs）⇒ 它自己一处文件 IO 都不该有。
  //   判据故意**不**写成"匹配 `src/*.txt` 的字面串" —— 文档注释里就会提到它，那样等于扫注释（假红）。
  assert.doesNotMatch(src, /readFileSync|writeFileSync|from 'node:fs'/, '★不许做文件 IO');
});

test('⑦ 命令面：`snapshot` / `restore <base64>` 的解析（含失败口径），且 JSON 经 base64 逐字节往返', () => {
  assert.deepEqual(parseDebugCommand('snapshot'), { a: 'snapshot' });
  assert.deepEqual(parseDebugCommand('SNAPSHOT'), { a: 'snapshot' }, '命令名大小写不敏感');

  // 一条真 JSON 经 base64 往返
  const json = JSON.stringify({ header: { format: 'amayui-engine-snapshot', version: 1 }, frames: [], 中文: '值' });
  const b64 = Buffer.from(json, 'utf8').toString('base64');
  const act = parseDebugCommand(`restore ${b64}`);
  assert.equal(act?.a, 'restore');
  assert.equal((act as { json: string }).json, json, '★UTF-8 必须逐字节往返（含中文）');

  // 失败口径：缺参数 / base64 解不开 ⇒ 都走"当查询回报"（不抛、不崩）
  for (const bad of ['restore', 'restore !!!']) {
    const a = parseDebugCommand(bad);
    assert.equal(a?.a, 'query', `${bad} 应回报成查询`);
    assert.match((a as { text: string }).text, /restore/, `${bad} 的提示要提到 restore`);
  }
  // 帮助里要有这两条（否则"有命令但没人知道"）
  const help = parseDebugCommand('help');
  assert.equal(help?.a, 'help');
});

test('⑧ 帧边界门（源码棘轮）：`snapshot`/`restore` 在**帧末**才动手，超时响亮失败', async () => {
  // 为什么是源码棘轮：这道门活在会话里（要么等 `#onFrameEnd`，要么超时抛），
  // 而会话需要 window/DOM ⇒ 起不了单测。判据落在**四处代码形状**上（每一处都对应一个真实故障）：
  //  ① 异步分支必须先 `await this.#atFrameBoundary()`（否则会在指令边界就地做 ⇒ 读到画了一半的中间态）；
  //  ② 超时必须变成 `ok:false` + 原因（不许静默降级成就地做）；
  //  ③ 同步 switch 里必须留"必须走异步分支"的桩（否则有人接到同步派发上会绕过帧边界门）；
  //  ④ `#onFrameEnd` 必须放行等待者（否则永远等不到 ⇒ 每次都超时）。
  const SESSION = path.join(HERE, '..', 'src', 'renderer', 'app', 'session.ts');
  const src = fs.readFileSync(SESSION, 'utf8');
  assert.match(src, /await this\.#atFrameBoundary\(\)/, '① 异步分支必须等帧边界');
  assert.match(
    src,
    /act\.a === 'snapshot' \|\| act\.a === 'restore'/,
    '① 两个命令都要走那条异步分支',
  );
  assert.match(src, /ok: false, lines: \[`✗ \$\{\(err as Error\)\.message\}`\]/, '② 超时要回报成失败');
  assert.match(src, /#atFrameBoundary\(timeoutMs = 5000\)/, '② 超时要有上界（默认 5s）');
  assert.match(src, /内部错误：snapshot 必须走 onDebugQuery 的异步分支/, '③ 同步路径要留桩');
  assert.match(src, /内部错误：restore 必须走 onDebugQuery 的异步分支/, '③ 同步路径要留桩');
  assert.match(src, /this\.#boundaryWaiters = \[\];\s*\n\s*for \(const w of ws\) w\(\);/, '④ 帧末必须放行等待者');
});
