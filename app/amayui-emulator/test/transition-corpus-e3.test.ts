/** @tier T1 @kind core @subsystem transition */

/**
 * **E3：真语料里的转场窗** —— `tickets/T-0084`。
 *
 * 前面两个文件守的是"模型对不对"（纯函数 + 手搓记录）。本文件守的是**它在真脚本上真的会起来**：
 * 冷启动 `SC0010.BIN`（语料里含 `i251`×2 + `i250`，`src/SC0010.txt:1349/1408/1583`）跑到那三条时，
 * 共享窗口推进器必须让记录**活动起来**（`t` 随帧走），并在 `[1]+[2]+[3]` 到点后**把整张表清空**
 * （引擎 raw 136840-136841）。
 *
 * 为什么值得单独一条：纯函数测试不会发现"宿主忘了每帧调 `scTransitionTick`"或"记录写进的是另一张表"
 * 这类断线；这条用一个**真实脚本**把它们钉住（不需要像素 —— 像素在 Electron 里由 `npm run shot` 看）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { decideResourceDir } from '../src/arch/resourceDir.js';
import { resolveSystemPaths } from '../src/arch/systemPaths.js';
import { Engine } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { loadScriptData } from '../src/vm/interpreter.js';
import { runFrameLoop } from '../src/frame/loop.js';
import type { FrameHost } from '../src/frame/host.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { scActiveTransitions, scTransitionsPending } from '../src/renderer/scene/transition.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

test('★E3（真语料）：SC0010 的 i250/i251 让转场窗真的起来，到点后清空整表', async (t) => {
  const resourceDir = decideResourceDir(REPO, { env: process.env }).dir;
  const src = new NodeFileSource({ resourceDir, system: resolveSystemPaths(REPO) });
  const boot = await src.readScriptByName('SC0010.BIN');
  if (!boot) {
    t.skip('资源根里没有 SC0010.BIN');
    return;
  }
  const scene = new HeadlessScene({});
  const e = new Engine(scene, new InputManager());
  e.fileSource = src;
  loadScriptData(e, boot.data, boot.name);

  let clock = 0;
  const seen: { id: number; cat: number; sub: number; dur: number; t: number }[] = [];
  let cleared = false;
  const host: FrameHost = {
    now: () => clock,
    advanceModel: (tm) => {
      scene.advanceModel(tm);
      for (const a of scActiveTransitions(scene.scene)) {
        if (!seen.some((s) => s.id === a.id)) {
          seen.push({ id: a.id, cat: a.rec[0] ?? -1, sub: a.rec[13] ?? -1, dur: a.rec[3] ?? 0, t: a.rt.t });
        }
      }
      if (seen.length > 0 && scene.scene.render4.transitions.size === 0) cleared = true;
    },
    poolPending: () => scene.poolPending(),
  };
  await runFrameLoop(e, host, {
    gates: { anim: 'wait', sleep: 'wait', advance: 'pump' },
    advFrame: true,
    advErrors: 'swallow',
    maxStepsPerFrame: 20000,
    maxFrames: 6000,
    initialScript: boot.name,
    onUnknown: () => 'continue',
    until: () => cleared,
    onFrameEnd: () => {
      clock += 1000 / 60;
    },
  });

  assert.ok(seen.length > 0, 'SC0010 里应至少有一条转场窗真的活动起来（i250/i251）');
  for (const s of seen) {
    assert.ok(s.cat >= 0 && s.cat <= 3, `类别应在 0..3（实际 ${s.cat}）`);
    assert.ok(s.dur > 0, `活动中的记录时长应 > 0（实际 ${s.dur}）`);
    assert.ok(s.t >= 0 && s.t < 1, `t 在活动期内应在 [0,1)（实际 ${s.t}）`);
  }
  assert.equal(
    scTransitionsPending(scene.scene),
    false,
    '跑到窗口结束（或到帧上限）时不该还挂着活动转场',
  );
  assert.ok(cleared, '★窗口结束后整张记录表必须被清空（引擎 raw 136840-136841）');
});
