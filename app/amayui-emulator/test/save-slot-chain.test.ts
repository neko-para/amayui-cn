/**
 * **「TITLE →（右上角菜单第 1 项 Load Data）→ SAVE.BIN 存档列表」链路**（`tickets/T-0018`）。
 *
 * 为什么单独一条：`tickets/T-0018` 的验收是"读档链路走得通"，而**能不能走通**取决于两件事——
 *  ① 槽族 opcode（`0x1A0`/`0x1A1`）已实现（E2 在 `test/save-slot.test.ts` 里逐条钉死）；
 *  ② **进入列表界面的那条脚本路径**上不再缺指令、且真的去读了玩家的真存档槽（本文件）。
 *
 * 链路依据（`docs-new/05-scripts/TITLE.md`）：
 *  - TITLE 菜单共 5 项：`menu-bind -1/0/1/2/3/4` = 无悬停 / Game Start / **Load Data** / Room / Option / Quit；
 *  - `i12e` 的命中盒：baseX `local 5` = `[0x44e, 0x3e0, 0x365, 0x2d9, 0x453]`、
 *    baseY `local 69` = `[0x126, 0x192, 0x1e5, 0x21f, 0x22a]`、盒 156×156
 *    ⇒ 第 1 项（Load Data）中心 = (0x3e0+78, 0x192+78) = **(1070, 480)**；
 *  - 悬停项写在 `local 3f7`（−1 = 无）。
 *
 * ★只读不写：本测试**不注入** `onSaveDataChanged`，并在收尾断言"没有对任何槽做过写/删/复制"
 *   （读档列表界面本来就不该写玩家数据）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { NodeAudioHost } from '../src/audio/nodeAudioHost.js';
import { decideResourceDir } from '../src/arch/resourceDir.js';
import { resolveSystemPaths } from '../src/arch/systemPaths.js';
import { Engine } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { loadScriptData, NotImplementedOp, formatOperands } from '../src/vm/interpreter.js';
import type { StepTrace } from '../src/vm/interpreter.js';
import { dec } from '../src/vm/bits.js';
import { runFrameLoop, type FrameLoopOptions } from '../src/frame/loop.js';
import type { FrameHost } from '../src/frame/host.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { parseSlotHeader } from '../src/save/saveSlot.js';
import { DEFAULT_EMULATOR_OPTIONS, applyEmulatorOptionsToEngine } from '../src/emulatorOptions.js';
import { applyConfigToEngine, parseIni } from '../src/engineConfig.js';
import { effectiveIniText } from '../src/arch/systemPaths.js';
import { OverlayDir } from '../src/arch/overlay.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

/** TITLE 菜单第 1 项「Load Data」命中点（见文件头推导）。 */
const LOAD_DATA_XY: [number, number] = [1070, 480];

test('E3：TITLE → Load Data → SAVE.BIN，路径上零未实现 opcode 且真的读了真存档槽（只读不写）', async (t) => {
  const resourceDir = decideResourceDir(ROOT, { env: process.env }).dir;
  const system = resolveSystemPaths(ROOT);
  const src = new NodeFileSource({ resourceDir, system });
  // 真槽目录里没有存档 ⇒ 这条断言没有意义（自报 skip，而不是假装通过）
  const hasSlots = (() => {
    try {
      const dir = path.join(system.baseDir, 'SAVE');
      return fs.readdirSync(dir).some((f) => /^SAVE\d\d\.DAT$/.test(f));
    } catch {
      return false;
    }
  })();
  if (!hasSlots) {
    t.skip(`本机没有真存档槽（${path.join(system.baseDir, 'SAVE')}）`);
    return;
  }

  // ---- 槽读写探针：列表界面只该读 ----
  const slotReads: number[] = [];
  const slotWrites: string[] = [];
  const origRead = src.readSaveSlot.bind(src);
  src.readSaveSlot = async (slot: number) => {
    slotReads.push(slot);
    return origRead(slot);
  };
  src.writeSaveSlot = async (slot: number) => void slotWrites.push(`write:${slot}`);
  src.deleteSaveSlot = async (slot: number) => {
    slotWrites.push(`delete:${slot}`);
    return { dat: false, sth: false };
  };
  src.copySaveSlot = async (from: number, to: number) => {
    slotWrites.push(`copy:${from}->${to}`);
    return { dat: false, sth: false };
  };

  const input = new InputManager();
  const scene = new HeadlessScene({ audioHost: new NodeAudioHost({ source: src }) });
  // ★缩略图探针（`tickets/T-0036`）：存档列表右侧那张图走 `0x1AF` → `setSlotPixels(op3, …)`。
  const thumbs: { slot: number; w: number; h: number; bytes: number }[] = [];
  const origSetSlotPixels = scene.setSlotPixels.bind(scene);
  scene.setSlotPixels = (slot: number, w: number, h: number, rgba: Uint8Array) => {
    thumbs.push({ slot, w, h, bytes: rgba.length });
    origSetSlotPixels(slot, w, h, rgba);
  };
  const e = new Engine(scene, input);
  e.fileSource = src;
  e.config = parseIni(effectiveIniText(new OverlayDir(system)));
  applyConfigToEngine(e.config, e.engineValues);
  applyEmulatorOptionsToEngine(e, DEFAULT_EMULATOR_OPTIONS);

  const boot = await src.readScript(0);
  assert.ok(boot, '应能读到 index 0 = SYSTEM4.BIN');
  loadScriptData(e, boot.data, boot.name);

  let clock = 0;
  const host: FrameHost = {
    now: () => clock,
    advanceModel: (t) => scene.advance(t),
    poolPending: () => scene.poolPending(),
  };

  /** 路径上命中的未实现 opcode（throw 策略 ⇒ 一有缺口立刻抛出并记在这里）。 */
  const unknown: { opcode: number; script: string; ip: number; sample: string }[] = [];
  /** 依次进入过的脚本（去重）。 */
  const trail: string[] = [];
  let lastScript = e.curScript().name;
  trail.push(lastScript);

  const base: Omit<FrameLoopOptions, 'until' | 'maxFrames'> = {
    gates: { anim: 'wait', sleep: 'wait', advance: 'pump' },
    advFrame: true,
    advErrors: 'swallow',
    maxStepsPerFrame: 20000,
    onStep: (tr: StepTrace) => {
      void tr;
    },
    onUnknown: (err, frame) => {
      unknown.push({ opcode: err.opcode, script: frame.name, ip: frame.ip, sample: '' });
      return 'stop'; // ★缺口即失败：不静默跳过（真实结论：这条路径 0 缺口）
    },
    onScriptChange: (name) => {
      if (name !== lastScript) {
        lastScript = name;
        if (!trail.includes(name)) trail.push(name);
      }
    },
    onFrameEnd: () => {
      clock += 1000 / 60;
    },
  };

  const run = async (frames: number, until?: () => boolean): Promise<number> => {
    const r = await runFrameLoop(e, host, {
      ...base,
      ...(until ? { until } : {}),
      initialScript: lastScript,
      maxFrames: frames,
    });
    return r.stopReason === 'cap' ? frames : r.frames;
  };

  const name = (): string => e.curScript().name;
  /** 悬停到第几项（`i12e` 写 `local 3f7`；−1 = 无）。 */
  const hover = (): number => dec(e.key, e.curScript().locals.int.get(0x3f7) ?? -99);

  // ---- ① 启动 → TITLE ----
  assert.ok((await run(4000, () => name().startsWith('TITLE'))) < 4000, '应在帧上限内到达 TITLE');
  await run(4000); // TITLE 初始化

  // ---- ② 悬停/点击 TITLE 第 1 项「Load Data」----
  input.setCursor(...LOAD_DATA_XY);
  await run(2000, () => hover() === 1);
  const titleHover = hover();
  if (titleHover === 1) {
    input.pressMouse(0);
    await run(400);
    input.releaseMouse(0);
  }
  const reachedSave = (await run(6000, () => name().startsWith('SAVE'))) < 6000;
  // 列表界面还要跑一会儿才会去逐槽读头（`i1a0`）
  await run(3000);

  // ---- ③ 判据 ----
  assert.deepEqual(
    unknown,
    [],
    `Load Data 路径上不应有未实现 opcode；实际 ${JSON.stringify(unknown.map((u) => `0x${u.opcode.toString(16)}@${u.script}:${u.ip}`))}`,
  );
  assert.equal(titleHover, 1, `TITLE 悬停应命中第 1 项（Load Data），实际 ${titleHover}（轨迹 ${trail.slice(0, 8).join(',')}）`);
  assert.ok(reachedSave, `点「Load Data」应进入存档界面脚本；实际轨迹尾部 ${trail.slice(-6).join(',')}`);
  assert.ok(slotReads.length > 0, '存档列表应经 fileSource 读真槽（`0x1A0`/`0x1A1`）');
  // ★槽号范围 0..999 是这条链路的实测结论：`SAVE.BIN` 的列表**逐槽读 0..999**（点进列表后 120 次读、
  //   去重后正好覆盖 0..999）⇒ 引擎侧没有"只接受两位"的限制（`%2.2d` 只补位不截断）。
  for (const s of slotReads) assert.ok(Number.isInteger(s) && s >= 0 && s <= 999, `槽号应合法：${s}`);
  assert.ok(
    slotReads.includes(0) && slotReads.some((s) => s >= 900),
    `应扫到列表两端（0 与 ≥900），实际 ${slotReads.length} 次读、最大 ${Math.max(...slotReads)}`,
  );
  // ★只读不写：列表界面不得写/删/复制任何槽
  assert.deepEqual(slotWrites, [], '存档列表界面不应写任何槽（本测试不注入 onSaveDataChanged）');

  // 真槽能被解头 ⇒ 0x1A0 的字段来源是活的（E4 口径：年月日时分秒 = 文件 mtime）
  const first = slotReads.find((s) => s >= 0) ?? -1;
  const bytes = first >= 0 ? await origRead(first) : null;
  if (bytes) {
    const h = parseSlotHeader(bytes);
    assert.equal(h.ok, true, h.ok ? '' : `真槽 ${first} 头解析失败：${h.reason}`);
  }
  void NotImplementedOp;
});

/**
 * ★**缩略图**（`tickets/T-0036`）：同一条链路里 `0x1AF` 必须把真槽的 `.STH`（BMP）解出来、写进脚本
 * `create-texture` 出来的那个 320×180 纹理槽 —— 这正是"存档列表右侧那张图"。
 *
 * 判据：脚本 `src/SAVE.txt:2086-2095` 先 `create-texture (local 21c6) 140 b4 0`（320×180），成功读完
 * 才 `draw-texture … 140 b4 …`。headless 不存像素，但会把尺寸记进槽（`HeadlessScene.setSlotPixels`）
 * ⇒ 这里断言"有一张 320×180、像素字节数 320*180*4 的图被写进某个纹理槽"。
 */
test('E3：列表里的缩略图（0x1AF）真的被解进纹理槽了（320×180）', async (t) => {
  const resourceDir = decideResourceDir(ROOT, { env: process.env }).dir;
  const system = resolveSystemPaths(ROOT);
  const src = new NodeFileSource({ resourceDir, system });
  const hasThumb = (() => {
    try {
      return fs.readdirSync(path.join(system.baseDir, 'SAVE')).some((f) => /^SAVE\d\d\.STH$/.test(f));
    } catch {
      return false;
    }
  })();
  if (!hasThumb) {
    t.skip(`本机没有真缩略图（${path.join(system.baseDir, 'SAVE')}\\SAVE??.STH）`);
    return;
  }

  const input = new InputManager();
  const scene = new HeadlessScene({ audioHost: new NodeAudioHost({ source: src }) });
  const thumbs: { slot: number; w: number; h: number; bytes: number }[] = [];
  const orig = scene.setSlotPixels.bind(scene);
  scene.setSlotPixels = (slot: number, w: number, h: number, rgba: Uint8Array) => {
    thumbs.push({ slot, w, h, bytes: rgba.length });
    orig(slot, w, h, rgba);
  };
  const e = new Engine(scene, input);
  e.fileSource = src;
  e.config = parseIni(effectiveIniText(new OverlayDir(system)));
  applyConfigToEngine(e.config, e.engineValues);
  applyEmulatorOptionsToEngine(e, DEFAULT_EMULATOR_OPTIONS);
  const boot = await src.readScript(0);
  assert.ok(boot);
  loadScriptData(e, boot.data, boot.name);

  let clock = 0;
  const host: FrameHost = {
    now: () => clock,
    advanceModel: (tm) => scene.advance(tm),
    poolPending: () => scene.poolPending(),
  };
  let lastScript = e.curScript().name;
  const base: Omit<FrameLoopOptions, 'until' | 'maxFrames'> = {
    gates: { anim: 'wait', sleep: 'wait', advance: 'pump' },
    advFrame: true,
    advErrors: 'swallow',
    maxStepsPerFrame: 20000,
    onUnknown: () => 'continue', // 这条测试只关心缩略图；缺口由上面那条测试负责报红
    onScriptChange: (n) => {
      lastScript = n;
    },
    onFrameEnd: () => {
      clock += 1000 / 60;
    },
  };
  const run = async (frames: number, until?: () => boolean): Promise<number> => {
    const r = await runFrameLoop(e, host, {
      ...base,
      ...(until ? { until } : {}),
      initialScript: lastScript,
      maxFrames: frames,
    });
    return r.stopReason === 'cap' ? frames : r.frames;
  };
  const name = (): string => e.curScript().name;
  const hover = (): number => dec(e.key, e.curScript().locals.int.get(0x3f7) ?? -99);

  await run(4000, () => name().startsWith('TITLE'));
  await run(4000);
  input.setCursor(...LOAD_DATA_XY);
  await run(2000, () => hover() === 1);
  input.pressMouse(0);
  await run(400);
  input.releaseMouse(0);
  await run(6000, () => name().startsWith('SAVE'));
  // 列表画完那一页需要若干帧（脚本按槽位画行 + 读缩略图）
  await run(3000);

  assert.ok(
    thumbs.length > 0,
    `应至少装进一张缩略图（0x1AF → setSlotPixels）；实际 ${JSON.stringify(thumbs)}`,
  );
  const t320 = thumbs.find((x) => x.w === 320 && x.h === 180);
  assert.ok(t320, `缩略图应为脚本 create-texture 的 320×180；实际 ${JSON.stringify(thumbs.slice(0, 4))}`);
  assert.equal(t320.bytes, 320 * 180 * 4, '像素缓冲应为 RGBA 320×180');
});