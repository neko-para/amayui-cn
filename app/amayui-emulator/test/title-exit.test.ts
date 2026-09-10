/**
 * **TITLE「点击退出」端到端回归**（E3：真实脚本 + 模拟输入）。
 *
 * 这一次的现场：用户点了 TITLE 的「退出」，画面像卡死、连窗口都关不掉。
 * 排查结论（两条独立成因）：
 *  1. **IPC 洪泛**：上一版"场景执行报告"默认对**每条指令**发一次 IPC，主进程再 `appendFileSync` 同步写盘
 *     ⇒ 一次会话写出 109MB 轨迹、主进程被同步写盘打满 ⇒ 窗口关闭（主进程动作）也做不了。
 *     已修：默认只在控制窗**显式设置 opcode 白名单**时才记；主进程改 WriteStream。
 *  2. **输入竞态**：TITLE 的菜单派发要求 VM **在"按住"期间轮询到一次**（置 `3fb` bit0 做 debounce），
 *     然后在"抬起"后派发。一轮 VM 批可达上万条指令，浏览器的一次快速点击（down+up）可能整段落在
 *     两次轮询之间 ⇒ 脚本从未看到按下 ⇒ 菜单永不派发（"点了没反应"）。
 *     已修：`InputManager.pressLatch`（按下保持到被读到一次为止）。
 *
 * 本测试同时覆盖**快速点击**与**正常点击**两种时序，确保都不会丢。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { Engine } from '../src/vm/engine.js';
import { InputManager } from '../src/vm/input.js';
import { loadScriptData, stepOnce } from '../src/vm/interpreter.js';
import { ExitScript, ScriptReset } from '../src/vm/ops.js';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { dec } from '../src/vm/bits.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, '..', '..', '..', 'raw');
/** 一帧的"指令"（与 src/report.ts 同口径）：遇到就推进虚拟时钟 + 驱动场景窗。 */
const FRAME_OPS = new Set([0x1f4, 0x20c, 0x23c]);

interface Rt {
  e: Engine;
  input: InputManager;
  clock: number;
}
async function makeRt(src: NodeFileSource, boot: { data: Uint8Array; name: string }): Promise<Rt> {
  const input = new InputManager();
  const e = new Engine(new HeadlessScene(), input);
  e.fileSource = src;
  loadScriptData(e, boot.data, boot.name);
  return { e, input, clock: 0 };
}
/** 跑到 TITLE 的输入轮询循环；返回停止原因（null=跑满步数）。 */
async function run(rt: Rt, n: number): Promise<string | null> {
  for (let i = 0; i < n; i++) {
    const f = rt.e.curScript();
    if (!f.script || f.ip >= f.script.instructions.length) return 'script-end';
    rt.e.nowMs = rt.clock;
    let t;
    try {
      t = await stepOnce(rt.e);
    } catch (err) {
      if (err instanceof ExitScript) return 'EXIT';
      if (err instanceof ScriptReset) return 'RESET';
      return `error: ${(err as Error).message}`;
    }
    if (FRAME_OPS.has(t.opcode)) {
      rt.clock += 16;
      (rt.e.native as HeadlessScene).advance(rt.clock);
    }
  }
  return null;
}
const local = (rt: Rt, i: number): number => dec(rt.e.key, rt.e.curScript().locals.int.get(i) ?? 0);

/** TITLE「退出」菜单项的命中坐标（由 i12e 命中区扫描得到的质心；见 .tmp 排查记录）。 */
const QUIT_XY: [number, number] = [1180, 630];

async function clickQuit(quick: boolean): Promise<{ res: string | null; script: string; hover: number }> {
  const src = new NodeFileSource({ rawDir: RAW });
  const boot = await src.readScript(0);
  assert.ok(boot, '应能读到 index 0 = SYSTEM4.BIN');
  const rt = await makeRt(src, boot);
  await run(rt, 200_000); // 启动 → LOGO → TITLE 轮询循环

  rt.input.setCursor(...QUIT_XY);
  await run(rt, 200);
  const hover = local(rt, 0x3f7); // i12e 的命中项（TITLE 菜单键）
  rt.input.pressMouse(0);
  if (!quick) await run(rt, 400); // 正常点击：按住期间让 VM 轮询到
  rt.input.releaseMouse(0);
  const res = await run(rt, 60_000);
  const script = rt.e.curScript().name;
  await src.dispose?.();
  return { res, script, hover };
}

test('TITLE 点击「退出」（正常点击：按住→抬起）→ 走到 QUIT.BIN 并 EXIT', async () => {
  const r = await clickQuit(false);
  assert.equal(r.hover, 4, `(1180,630) 应命中 TITLE 菜单第 4 项（退出）；实际命中 ${r.hover}（菜单布局可能变了）`);
  assert.equal(r.res, 'EXIT', `应触发程序退出；实际 ${r.res ?? '无退出'}（停在 ${r.script}）`);
});

test('TITLE 点击「退出」（★快速点击：down+up 落在同一次轮询之间）同样不丢', async () => {
  // 这正是用户遇到"点了没反应"的时序：靠 InputManager.pressLatch 保证按下被读到一次。
  const r = await clickQuit(true);
  assert.equal(r.res, 'EXIT', `快速点击也必须触发退出；实际 ${r.res ?? '无退出'}（停在 ${r.script}）`);
});

test('InputManager：按下保持位只被消费一次（读后即恢复为真实按钮态）', () => {
  const im = new InputManager();
  assert.equal(im.readButtons(), 0, '初始未按下');
  im.pressMouse(0);
  assert.equal(im.readButtons(), 1, '首次读：看到按下');
  im.releaseMouse(0);
  assert.equal(im.readButtons(), 0, '再次读：保持位已消费，回到真实按钮态（0）');
  // 按住不放时由真实按钮态继续返回 1
  im.pressMouse(0);
  assert.equal(im.readButtons(), 1);
  assert.equal(im.readButtons(), 1, '按住不放：持续返回 1（与引擎的按钮态一致）');
});
