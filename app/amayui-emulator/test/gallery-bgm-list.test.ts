/**
 * **回想 → BGM 鉴赏（第三个按钮）的四条被跳过指令**（2026-09 用户实测：进到 BGM 鉴赏，列表空白）。
 *
 * | opcode | 引擎 | 语义 | 为什么跳过它会坏 |
 * |---|---|---|---|
 * | `0x19D` | `sub_42D8E0` → `sub_4181F0(FileDB, id)` | `op1 ← 该统一文件 id 是否**已被打开过**`（0/1） | ★`SETMEMOIR.BIN` 靠它逐条问 `12265c[i]`（BGM 的 36 个文件 id）⇒ 解锁曲目下标写进 `122731`、数量 `12272f`、收集率 `12272e`；`MMODE.BIN` 按 `122731` 画每一行。**全 0 ⇒ 整屏空白** |
 * | `0x1BF` | `sub_419840` | 按 `Engine[122504]` 置**跳读态** `Engine[122503]=1`（顺带清 122504 的 bit16） | `play-bgm`（`0xBF`）的"语音在播时暂停 BGM"分支读它 ⇒ 快进时的 BGM 行为与真机相反 |
 * | `0x21D` | `sub_423C60` → `sub_4AC0D0`（`Scene::CopyScene`） | 把源绘图项（+网格）整份复制到目标 handle | `ROOM`/`MMODE`/`CGMODE`/`HMODE` 把预置的「全屏过渡幕布」（handle 0）复制成临时项再单独改色做淡入淡出 ⇒ 复制不出来就**没有过渡幕布**，后续 `set-draw-color` 全落空 |
 * | `0xB8` | `sub_419720` | **停 BGM**（清 `effect_flags` bit0x200 + 推进淡出 + `sub_489B50`），不动 `sound:Music` | BGM 鉴赏进界面/换曲试听时不停止上一首 ⇒ 会串音 |
 *
 * 关键实证：`i19d` 的键是**统一文件 id**（`MUINIT.BIN` 的 A 表：`12265d=0x147`、`12265e=0x17`…），
 * 而"已打开"的写入点只有 `sub_4559C0`（按 id 打开文件）⇒ emulator 的 `Engine.usedFileIds` 在
 * 按 id 取资源的三处打点（`0x1F9` set-texture、`play-bgm` 曲号解析、脚本装载）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { makeCtx } from '../src/vm/step.js';
import { OPS, NATIVE_OPS, ENGINE_INTERNAL_OPS } from '../src/vm/ops.js';
import { StubNative } from '../src/vm/stubNative.js';
import { NotImplementedOp, loadScriptData, stepOnce } from '../src/vm/interpreter.js';
import { ExitScript, loadScriptIntoFrame, ScriptReset } from '../src/vm/ops.js';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { resolveResourceDir } from '../src/arch/resourceDir.js';
import { resolveSystemPaths } from '../src/arch/systemPaths.js';
import { SAVE_DAT_REL } from '../src/arch/systemPaths.js';
import { decodeSaveData, encodeSaveData } from '../src/vm/saveData.js';
import { parseScriptBytes } from '../src/script/bin.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { dec } from '../src/vm/bits.js';
import type { AudioIntent } from '../src/audio/audioEngine.js';
import type { BinArg, BinInstruction } from '../src/script/bin.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const RES = resolveResourceDir(ROOT);

const im = (v: number): BinArg => ({ type: 0, raw: v }) as unknown as BinArg;
const gInt = (n: number): BinArg => ({ type: 3, raw: n }) as unknown as BinArg;
const lInt = (n: number): BinArg => ({ type: 9, raw: n }) as unknown as BinArg;
const instr = (op: number, args: BinArg[]): BinInstruction =>
  ({ opcode: op, name: `i${op.toString(16)}`, argc: args.length, args, byteOffset: 0, index: 0 }) as unknown as BinInstruction;

/** 记录音频意图的宿主。 */
class RecordingNative extends StubNative {
  readonly intents: AudioIntent[] = [];
  constructor() {
    super(() => {});
  }
  override audio(intent: AudioIntent): void {
    this.intents.push(intent);
  }
  get last(): AudioIntent {
    const v = this.intents.at(-1);
    assert.ok(v, '没有记录到任何音频意图');
    return v;
  }
}

function mk(native: StubNative = new StubNative(() => {})): {
  e: Engine;
  run: (op: number, args: BinArg[]) => void;
} {
  const e = new Engine(native, new InputManager());
  const f = e.curScript();
  return {
    e,
    run: (op, args) => {
      const h = OPS.get(op) ?? NATIVE_OPS.get(op) ?? ENGINE_INTERNAL_OPS.get(op);
      assert.ok(h, `0x${op.toString(16)} 应已注册`);
      h!(makeCtx(e, f, instr(op, args), native, () => {}));
    },
  };
}
const local = (e: Engine, i: number): number => dec(e.key, e.curScript().locals.int.get(i) ?? 0);

test('注册表棘轮：四条都不再是「未知/引擎内部 no-op」', () => {
  assert.ok(NATIVE_OPS.has(0xb8), '0xB8（停 BGM）属音频族 ⇒ NATIVE_OPS');
  assert.ok(OPS.has(0x19d), '0x19D（已使用查询）是纯 VM 状态 ⇒ OPS');
  assert.ok(OPS.has(0x1bf), '0x1BF（跳读态）是纯 VM 状态 ⇒ OPS');
  assert.ok(OPS.has(0x21d), '0x21D（CopyScene）转发 native ⇒ OPS');
  for (const op of [0xb8, 0x19d, 0x1bf, 0x21d]) {
    assert.ok(!ENGINE_INTERNAL_OPS.has(op), `0x${op.toString(16)} 不应再是 engine-internal no-op`);
  }
});

test('0x19D：op1 = 该统一文件 id 是否已被打开过（引擎 sub_4181F0）', () => {
  const { e, run } = mk();
  run(0x19d, [lInt(0), im(23)]);
  assert.equal(local(e, 0), 0, '没打开过 ⇒ 0');
  e.markFileUsed(23);
  run(0x19d, [lInt(0), im(23)]);
  assert.equal(local(e, 0), 1, '打开过 ⇒ 1');
  run(0x19d, [lInt(0), im(24)]);
  assert.equal(local(e, 0), 0, '别的 id 互不影响');
  e.markFileUsed(0x30003b2); // 扩展包 id（高字节 = 包号）
  run(0x19d, [lInt(0), im(0x30003b2)]);
  assert.equal(local(e, 0), 0, '扩展包资源：set:SaveVersion1 缺席（=0 < 3）⇒ 恒 0（引擎 raw 38275-38281）');
});

test('0x19D：set:SaveVersion1≥3 且 SaveVersion2≥10 时扩展包 id 也如实回答', () => {
  const { e, run } = mk();
  e.config = { values: new Map([['set:saveversion1', 3], ['set:saveversion2', 10]]) } as unknown as Engine['config'];
  e.markFileUsed(0x30003b2);
  run(0x19d, [lInt(0), im(0x30003b2)]);
  assert.equal(local(e, 0), 1);
});

test('0x1BF：按 122504（消息跳读态）置 122503；顺带清 122504 的 bit16', () => {
  const { e, run } = mk();
  // 122504 = 0（不是"通常消息模式"）⇒ 置跳读态
  run(0x1bf, []);
  assert.equal(e.engineValues.get(122503), 1);
  // 122504 的 bit0 已置（通常消息模式）⇒ 不再置位（先把两个字段都清掉再验）
  e.engineValues.set(122503, 0);
  e.engineValues.set(122504, 1);
  run(0x1bf, []);
  assert.equal(e.engineValues.get(122503), 0, 'bit0 在 ⇒ 不进跳读态');
  // 122504 带 bit16 ⇒ 先整字段清 0，于是 bit0 也没了 ⇒ 置跳读态
  e.engineValues.set(122504, 0x10001);
  run(0x1bf, []);
  assert.equal(e.engineValues.get(122504), 0, 'bit16 在 ⇒ 整字段归零（引擎 raw 24880-24881）');
  assert.equal(e.engineValues.get(122503), 1);
});

test('0xB8：停 BGM（清 effect_flags bit0x200 时先推进淡出）', () => {
  const native = new RecordingNative();
  const { e, run } = mk(native);
  e.effectFlags = 0x200;
  run(0xb8, []);
  assert.deepEqual(native.intents.at(-2), { kind: 'bgm-fade', value: 0, step: 100 }, '清 bit0x200 并推进淡出');
  assert.deepEqual(native.last, { kind: 'bgm-stop' });
  assert.equal(e.effectFlags & 0x200, 0, 'bit0x200 已清');

  const n2 = native.intents.length;
  e.effectFlags = 0;
  run(0xb8, []);
  assert.equal(native.intents.length, n2 + 1, '位不在 ⇒ 只发 bgm-stop');
  assert.deepEqual(native.last, { kind: 'bgm-stop' });
});

test('0x21D：CopyScene 把源绘图项复制到目标 handle；源不存在 ⇒ false', () => {
  const scene = new HeadlessScene();
  scene.configureDrawItem({ handle: 0, layer: 0, tex: 7, srcX: 1, srcY: 2, srcW: 30, srcH: 40, dstX: 5, dstY: 6 });
  const { e, run } = mk(scene as unknown as StubNative);
  run(0x21d, [im(0), im(0x7d0)]);
  const src = scene.scene.drawItems.get(0)!;
  const dst = scene.scene.drawItems.get(0x7d0);
  assert.ok(dst, '目标 handle 应被建出来');
  assert.deepEqual({ ...dst, handle: 0, layer: 0 }, { ...src }, '载荷整份复制（只换 handle/layer）');
  assert.notEqual(dst, src, '必须是独立的一份（引擎 qmemcpy）');
  dst.posX = 999;
  assert.notEqual(src.posX, 999, '此后改目标不影响源');
  assert.equal(e.usedFileIds.size, 0, '0x21D 与"已使用文件表"无关');
  // 源不存在：返回 false（引擎打「コピー元のシーンが存在しません」）
  assert.equal(scene.copyScene(0xdead, 0xbeef), false);
});

// ---------------------------------------------------------------------------
// SAVE.DAT 的「已使用文件」块（= 鉴赏进度的持久化载体）
// ---------------------------------------------------------------------------

/** MUINIT 的 A 表（36 首 BGM 的统一文件 id；见 docs-new/05-scripts/MUINIT.md）。 */
const BGM_FILE_IDS = [
  0x147, 0x17, 2, 3, 4, 5, 6, 7, 0xa, 8, 0xc, 0xb, 9, 0x20, 0x21, 0x22, 0x23, 0xd, 0xe, 0xf,
  0x10, 0x11, 0x13, 0x12, 0x14, 0x15, 0x16, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x18, 0x1f, 0x29f1, 0xae3,
];

test('SAVE.DAT 的「已使用文件」块：本工程格式写入→读回（鉴赏进度随存档持久化）', () => {
  const tables = { ints: new Map([['\u00030', 1]]), strings: new Map<string, string>() };
  const bytes = encodeSaveData({ tables, usedFileIds: [3, 0x17, 100, 0x30003b2] });
  const r = decodeSaveData(bytes);
  assert.ok(r.ok, r.ok ? '' : r.reason);
  assert.equal(r.data.usage.layout, 'emulator');
  assert.deepEqual(
    [...r.data.usage.usedFileIds].sort((a, b) => a - b),
    [3, 0x17, 100],
    '本工程只写本体 id（包内 id 在引擎的另一块里，我们暂不写）',
  );
  // 不写标志时块仍在（2 dword 头）——读侧不误判
  const empty = decodeSaveData(encodeSaveData({ tables }));
  assert.ok(empty.ok);
  assert.equal(empty.data.usage.usedFileIds.size, 0);
});

test('★E4：真机系统存档（`SAVE\\SAVE.DAT`）解出鉴赏进度；overlay 旧副本与 base 取并集', async () => {
  const src = new NodeFileSource({ resourceDir: RES, system: resolveSystemPaths(ROOT) });
  const merged = await src.readSaveFlags();
  if (!merged) {
    await src.dispose?.(); // 这台机器上没有真机系统存档 ⇒ E4 依赖本机玩家数据，跳过不算失败
    return;
  }
  assert.ok(merged.length > 0, '并集不该为空（本工程 overlay 那份可能是旧版本写的、缺 flag 块 ⇒ 必须靠 base 兜住）');

  const basePath = src.overlay?.baseFile(SAVE_DAT_REL);
  if (basePath && fs.existsSync(basePath)) {
    const r = decodeSaveData(new Uint8Array(fs.readFileSync(basePath)));
    assert.ok(r.ok, r.ok ? '' : `真机存档解析失败：${r.reason}`);
    assert.equal(r.data.usage.layout, 'engine-new', '真机 format≥3 ⇒ 2 dword 头 + 混淆值的布局');
    const set = new Set(merged);
    const hit = BGM_FILE_IDS.filter((id) => set.has(id));
    // ★2026-09 本机实测 = 31/36（缺 0x15/0x16/0x1d 三首 + 两张 OP/ED 影片 id）。
    //   这里只断言"能解出进度"，免得玩家继续玩之后这条变红；期望值记在注释里。
    assert.ok(hit.length >= 1, `真机存档里应有已收集的 BGM（实测 31/36）；实际 ${hit.length}/36`);
    assert.ok(
      r.data.usage.usedFileIds.size >= 1000,
      `真机存档的「已使用文件」应有上千条（实测 11106）；实际 ${r.data.usage.usedFileIds.size}`,
    );
  }
  await src.dispose?.();
});

// ---------------------------------------------------------------------------
// E3：真实语料跑「回想 → BGM 鉴赏」的数据链（启动 → SETMEMOIR → MMODE）
// ---------------------------------------------------------------------------

const FRAME_OPS = new Set([0x1f4, 0x20c, 0x23c]);

test('★E3：真实语料下 SETMEMOIR 能把「已播放过的 BGM」标成解锁（此前恒 0 ⇒ 列表空白）', async () => {
  const src = new NodeFileSource({ resourceDir: RES });
  const native = new HeadlessScene();
  const e = new Engine(native, new InputManager());
  e.fileSource = src;
  const music = await src.musicTables();
  e.musicTable = { other: music.other, base: music.base, groups: [] }; // 与 boot.ts/run.ts 同口径

  const boot = await src.readScript(0);
  assert.ok(boot, '应能读到 SYSTEM4.BIN');
  loadScriptData(e, boot.data, boot.name);

  let clock = 0;
  const run = async (n: number): Promise<void> => {
    for (let i = 0; i < n; i++) {
      const f = e.curScript();
      if (!f.script || f.ip >= f.script.instructions.length) return;
      e.nowMs = clock;
      try {
        const t = await stepOnce(e);
        if (FRAME_OPS.has(t.opcode)) {
          clock += 16;
          native.advance(clock);
        }
      } catch (err) {
        if (err instanceof ExitScript || err instanceof ScriptReset) return;
        if (err instanceof NotImplementedOp) {
          throw new Error(`这条路径上不该再有未知指令：0x${err.opcode.toString(16)} @ ${err.scriptName}`);
        }
        throw err;
      }
    }
  };
  const call = async (id: number): Promise<void> => {
    const caller = e.cur;
    e.cur = caller + 1;
    const frame = e.curScript();
    frame.caller = caller;
    const s = await src.readScript(id);
    assert.ok(s, `应能读到 0x${id.toString(16)}`);
    loadScriptIntoFrame(frame, parseScriptBytes(s.data), s.name);
  };

  await run(200_000); // 启动 → LOGO → TITLE（TITLE.txt:14 `play-bgm 1f` 会解锁标题曲）
  assert.equal(e.curScript().name, 'TITLE.BIN', '应停在 TITLE 的输入轮询循环');
  assert.ok(e.isFileUsed(23), '标题曲（曲号 0x1f → 文件 id 23）应已被标记为「已打开」');

  await call(0x524c); // SETMEMOIR（ROOM.txt:68 的入口）
  await run(200_000);

  const g = (slot: number): number => dec(e.key, e.globals.int.get(slot) ?? 0);
  assert.equal(g(0x122730), 36, 'BGM 曲目总数（MUINIT 的 A 表非空条目数）');
  assert.ok(g(0x12272f) >= 1, `已解锁数应 ≥ 1（修好前恒 0 ⇒ 列表空白）；实际 ${g(0x12272f)}`);
  assert.equal(g(0x122731 + 1), 2, '★解锁表的第 1 项 = 曲号表下标 2 = 文件 id 0x17 = 标题曲 BGM031.OGG');
  assert.equal(g(0x12272e), 2, '收集率 = 1/36 ≈ 2%');

  await src.dispose?.();
});
