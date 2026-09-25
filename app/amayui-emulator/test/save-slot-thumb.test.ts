/** @tier T1 @kind core @subsystem save */

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
import { findRealFiles, firstRealFile, realSlotDirs } from './realSlots.js';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
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

/**
 * ★从 `save-slot-chain.test.ts` 拆出（`tickets/T-0128`）：那条文件里两条用例都是"驱动真链路"的
 *   重型 E3（单文件 17.5 s），node:test 按文件分进程并行 ⇒ 拆开后两者可同时跑。
 *   ★判据一字未改（只搬位置）。
 */
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
  // ★2026-09-23（`tickets/T-0128`）：原来直接用**本机**的真槽目录，于是这条"E3"是否真跑取决于
  //   "本机列表首页上有没有占用槽"。实测本机只有 **78/79** 两个真槽（在列表第 8 页附近）⇒
  //   首页全是空槽 ⇒ 脚本**根本不调 `0x1AF`**（探针实测 `readSlotThumb` 调用数 = **0**），
  //   而断言只看 `setSlotPixels`，于是它以前要么静默跳过、要么在闸门打开后假红。
  //   现在把真槽**复制到槽 0**（临时目录）：**判据不变**（走的还是真链路 + 真 `.STH` 解码），
  //   但不再依赖"本机首页恰好有槽"—— 任何机器上都是确定性 E3。
  const realDat = firstRealFile(ROOT, 'DAT');
  const realSth = firstRealFile(ROOT, 'STH');
  if (!realDat || !realSth) {
    t.skip(`本机没有真存档槽/缩略图（${realSlotDirs(ROOT).join(' / ')}）`);
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amayui-thumb-'));
  const baseDir = path.join(tmp, 'game');
  const overlayDir = path.join(tmp, 'overlay');
  fs.mkdirSync(path.join(overlayDir, 'SAVE'), { recursive: true });
  fs.copyFileSync(realDat.path, path.join(overlayDir, 'SAVE', 'SAVE00.DAT'));
  fs.copyFileSync(realSth.path, path.join(overlayDir, 'SAVE', 'SAVE00.STH'));
  const system = { baseDir, overlayDir };
  const src = new NodeFileSource({ resourceDir, system });

  const input = new InputManager();
  const scene = new HeadlessScene({ audioHost: new NodeAudioHost({ source: src }) });
  const thumbs: { slot: number; w: number; h: number; bytes: number }[] = [];
  const orig = scene.setSlotPixels.bind(scene);
  scene.setSlotPixels = (slot: number, w: number, h: number, rgba: Uint8Array) => {
    thumbs.push({ slot, w, h, bytes: rgba.length });
    // ★`tickets/T-0175` 的 ⑤ 前半：返回值必须**透传**（`boolean` = 该槽有没有 surface）；
    //   丢掉它会让 `0x1AF` 把这次调用当成"宿主不实现该缝"，从而不再按真实存在性写结果码。
    return orig(slot, w, h, rgba);
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
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.equal(t320.bytes, 320 * 180 * 4, '像素缓冲应为 RGBA 320×180');
});
