/**
 * `T-0052` 判据 ③ 的 **E3**：**真实 TITLE 菜单只用键盘走通**（移动 + 确认），并用"只按 Enter"作对照。
 *
 * ## 为什么用 TITLE（真实脚本）
 * TITLE 在 `src/TITLE.txt:40-52` 注册 `joy-callback 0..b`，:134 起每帧 `i100` 扫掩码；菜单项由
 * `menu-dispatch (local-int 3f7)` 派发（`label_000010b8`）。链路 = 宿主 keydown →
 * `InputManager.pressKey`（VK→虚拟位，`DEFAULT_VK_TO_BIT`）→ `0x100` 扫位 → `joyJump[bit]` →
 * TITLE 的 `joy-callback <bit>` label → 菜单动作。**全程不碰鼠标**。
 *
 * ## 实测出的两组确定性落点（本守卫钉住的就是它们）
 * | 键盘序列 | 结果 |
 * |---|---|
 * | `↓`（VK40 ⇒ 位2 ⇒ `joy-callback 2`）→ `Enter`（VK13 ⇒ 位4 ⇒ `label_00000eec` → `menu-dispatch`） | **TITLE → GAMESTART**（选中项落到 Game Start 并确认） |
 * | `Enter`（不动） | **仍在 TITLE**（对照组：证明上一条不是"Enter 是全局热键"，而是移动键把选中项挪到了有效项） |
 *
 * ★节拍要点（踩过）：**按下只保持 ~4 帧**再松开，松开后留 ~1 s（`settleMs: 1000`）。
 * 长按会让 `0x100` 每帧重复扫到同一位 ⇒ 选中项连续移动，落点不再确定。
 *
 * ★本条同时是 `ScenarioSpec` 新能力（`keydown`/`keyup` + `vk`）的真实用例 —— 判据 ③ 原先正卡在
 *   "spec 没有键盘事件"。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootHeadless } from '../src/tools/scenarioBoot.js';
import { applyScenarioEvent, runScenario, type ScenarioSpec } from '../src/frame/scenario.js';
import { dec } from '../src/vm/bits.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

const VK = { UP: 38, DOWN: 40, ENTER: 13, BACK: 8 } as const;

function findResourceRoot(): string | null {
  for (const cand of ['raw', 'install']) {
    const dir = path.join(ROOT, cand);
    if (fs.existsSync(path.join(dir, 'SYS4INI.BIN'))) return dir;
  }
  return null;
}

/** 跑一条"到 TITLE → 若干键盘动作 → Enter"，返回脚本序列与 TITLE 期间的选中项序列。 */
async function runKeyboardTitle(
  moves: Array<typeof VK.UP | typeof VK.DOWN | typeof VK.BACK>,
): Promise<{ scripts: string[]; sels: number[] }> {
  const boot = await bootHeadless({ script: 0, audio: false, log: () => {} });
  const e = boot.e;
  const scripts: string[] = [];
  const sels: number[] = [];
  const events: ScenarioSpec['events'] = [];
  let first = true;
  for (const vk of moves) {
    events.push({
      kind: 'keydown',
      vk,
      settleMs: first ? 2000 : 1000,
      ...(first ? { afterMarker: '-> TITLE.BIN' } : {}),
      note: `按下 VK ${vk}`,
    });
    events.push({ kind: 'keyup', vk, settleMs: 64, note: `松开 VK ${vk}（保持 4 帧）` });
    first = false;
  }
  // ★若这之前还没有任何事件（`moves` 为空）⇒ Enter 自己带 afterMarker
  events.push({
    kind: 'keydown',
    vk: VK.ENTER,
    settleMs: first ? 2000 : 1000,
    ...(first ? { afterMarker: '-> TITLE.BIN' } : {}),
    note: 'Enter 确认',
  });
  events.push({ kind: 'keyup', vk: VK.ENTER, settleMs: 2000, note: 'Enter 松开（保持 4 帧）' });

  await runScenario({
    e,
    host: boot.host,
    spec: {
      name: 't0052-keyboard-title',
      boot: { script: 0 },
      clock: { kind: 'fixed', stepMs: 16 },
      gates: { anim: 'wait', sleep: 'wait', advance: 'pump' },
      maxFrames: 12000,
      events,
    },
    observer: {
      onFrameStart: () => {
        const s = e.curScript().name;
        if (scripts[scripts.length - 1] !== s) scripts.push(s);
        if (s.startsWith('TITLE')) sels.push(dec(e.key, e.curScript().locals.int.get(0x3f7) ?? 0) | 0);
      },
    },
  });
  await boot.src.dispose?.();
  return { scripts, sels };
}

test('★T-0052 ③（E3）：真实 TITLE 菜单键盘 `↓`+`Enter` ⇒ 进 GAMESTART；**只按 Enter 的对照**仍在 TITLE', async (t) => {
  if (!findResourceRoot()) {
    t.skip('找不到含 SYS4INI.BIN 的资源根 —— 跳过（真语料用例）');
    return;
  }
  // ① 本票：↓（位2）移动选中项 → Enter（位4）派发菜单项
  const moved = await runKeyboardTitle([VK.DOWN]);
  const firstNonTitle = moved.scripts.findIndex((s) => !s.startsWith('TITLE') && !s.endsWith('INIT.BIN') && !s.startsWith('$') && s !== 'SYSTEM4.BIN' && s !== 'LOADCONFIG.BIN' && s !== 'ALINIT.BIN' && s !== 'EBINIT.BIN' && s !== 'ITINIT.BIN' && s !== 'SKINIT.BIN' && s !== 'CDINIT2.BIN' && s !== 'BIINIT.BIN' && s !== 'INIT2.BIN' && s !== 'LOGO.BIN');
  assert.notEqual(firstNonTitle, -1, `★键盘 ↓+Enter 必须离开 TITLE（实得序列 ${moved.scripts.join(' → ')}）`);
  assert.equal(
    moved.scripts[firstNonTitle],
    'GAMESTART.BIN',
    `★TITLE 的选中项落到 Game Start 并被 Enter 派发 ⇒ 应进 GAMESTART（实得 ${moved.scripts[firstNonTitle]}）`,
  );
  assert.ok(
    new Set(moved.sels).size > 1,
    `★TITLE 期间的选中项（local 3f7）必须被 ↓ 改动过（实得唯一值 ${[...new Set(moved.sels)].join(',')}）`,
  );

  // ② 对照：不按键直接 Enter ⇒ 仍在 TITLE（证明 ① 的关键是"移动键"，不是"Enter 是全局热键"）
  const direct = await runKeyboardTitle([]);
  const left = direct.scripts.filter((s) => s === 'GAMESTART.BIN');
  assert.deepEqual(left, [], `★对照：只按 Enter 不得离开 TITLE（实得序列 ${direct.scripts.join(' → ')}）`);
});

test('★T-0052 ③（新能力本身）：`ScenarioSpec` 的 `keydown`/`keyup` 分别落到 `pressKey`/`releaseKey`（两把刷子）', () => {
  const calls: string[] = [];
  const fake = {
    setCursor: () => calls.push('cursor'),
    pressMouse: () => calls.push('press'),
    releaseMouse: () => calls.push('release'),
    addWheel: () => calls.push('wheel'),
    pressKey: (vk: number) => {
      calls.push(`keydown:${vk}`);
      return true;
    },
    releaseKey: (vk: number) => calls.push(`keyup:${vk}`),
  } as unknown as Parameters<typeof applyScenarioEvent>[0];
  applyScenarioEvent(fake, { kind: 'keydown', vk: VK.UP });
  applyScenarioEvent(fake, { kind: 'keyup', vk: VK.UP });
  applyScenarioEvent(fake, { kind: 'keydown' }); // 缺 vk ⇒ 什么都不做（不许抛）
  assert.deepEqual(calls, [`keydown:${VK.UP}`, `keyup:${VK.UP}`], 'keydown/keyup 必须分别落到 pressKey/releaseKey');
});
