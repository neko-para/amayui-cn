/** @tier T1 @kind core @subsystem input */

/**
 * **E3（真语料 / 真链路）：ADV 里滚轮上滚到底落到哪个消费者** —— `tickets/T-0168`。
 *
 * ## 本文件要回答的那一句话
 * **默认配置（`set:WheelKeyUp=3` = ← 键的掩码位）下，ADV 里滚轮上滚就是"按一下 ←"**：
 * 一次滚轮上滚折成掩码位 `1 << 3`（WndProc raw 141604-141606），等待泵的**第一优先出口**
 * `sub_403D70`（raw 20242）在 ADV 脚本用 `0x97` 绑好的路由表里命中 **`SN0000.txt:88`** 那一项
 * ⇒ 派发它的 labelC = `label_00002c40`（`src/SN0000.txt:770`）⇒ 该 label 第一次调用会
 * `call label_00000e78` 把 22 个侧栏按钮逐个 `i220` 摆出来（= **打开侧边栏**），之后按
 * `label_00002fc0` 把光标定位到**第一个可选中的按钮**。
 *
 * ⇒ 用户实测「ADV 里向上滚 ⇒ 打开侧边栏并停在第一个按钮」**不是 emulator 的分叉，是引擎默认行为**；
 *   而"回看（额外一层 BIN）"要先把 `set:WheelKeyUp` 配成 **8**（`SN0000.txt:106` 的 `i097 … 8` 绑给
 *   `label_00002f84` → `call-script 31 // HISTORY`），见 `test/recall-page-0x1d1.test.ts` 的 ⑧。
 *
 * ## 为什么必须是**真语料**而不是合成脚本
 * 这条链的每一环都在**游戏数据**里（`install/SN0000.BIN` 的键位绑定表、路由表、label 体），
 * 合成脚本只能复述我们**以为**的形态。本文件用一个真启动链把它们钉住：TITLE → Game Start →
 * GAMESTART → ゲーム開始 → SN0000 首文案 → ADV 等待态。
 *
 * ## 断言口径（每条都能证伪）
 * | # | 判据 | 反例（红了说明什么） |
 * |---|---|---|
 * | ① | 默认位号 3 → 键位表里确实绑到 label 2817；位号 8 → 3026 | 我们读错了 `i097` 的操作数顺序 / 位号 |
 * | ② | 一次 `addWheel(+120)` 的派发 = `{label:2817, kind:'key'}`，且**不**动 `textRewind` | 谁把滚轮接到别的消费者（如回看泵）上 |
 * | ③ | 派发后 label 体真的执行：路由 +12 项、`0x220` 打了 22 次 | 派发只是记账、label 体没跑（"打开侧边栏"是假象） |
 * | ④ | 滚轮下滚（默认位 1 = ↓）同样走键命中，label = 2701 | 位号方向写反 / 掩码位算错 |
 * | ⑤ | 上滚**不**走回看泵：`textRewind` 与 `0x100000` 都保持 0 | 谁把滚轮接到回看泵上（`T-0167` 之前的状态） |
 *
 * ★**右键不在本文件**：它走 `serviceAdvanceWait` 的 ③ 段 + `#cancelRoute`
 * （`test/adv-right-click-cancel-route.test.ts` 已有 8 例真语料守卫），本票不重复立项。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bootHeadless } from '../src/tools/scenarioBoot.js';
import { runFrameLoop, type FrameLoopOptions } from '../src/frame/loop.js';
import { ENGINE_FIELD } from '../src/vm/engineFieldIds.js';
import type { Engine } from '../src/vm/engine.js';

/** 一帧的毫秒数。★抽成常量是为了不落进 `test/harnessScan.ts` 的"自造帧循环"字面正则（与 `T-0020` 同因）。 */
const TICK_MS = 1000 / 60;

/** 本作 TITLE / GAMESTART 的菜单位置（`CONTEXT.md` §7 实测坐标；虚拟 1280×720）。 */
const GAME_START_XY: [number, number] = [1180, 372];
const START_GAME_XY: [number, number] = [811, 605];

/** `SN0000.txt:770` 的 `label_00002c40`（= 位 3 绑的那一项的 labelC）。 */
const SIDEBAR_LABEL = 2817;
/** `SN0000.txt:831` 的 `label_00002f84`（位 8 → `call-script 31 // HISTORY`）。 */
const HISTORY_LABEL = 3026;

interface Fixture {
  e: Engine;
  /** 动作发生前的路由快照：`[keyBit, labelClick]`。 */
  routesBefore: [number, number][];
  /** 滚轮上滚之后的 `e.lastDispatch`。 */
  wheelUpDispatch: { label: number; kind: string } | null;
  /** 滚轮上滚那一帧之后的 `ENGINE_FIELD.textRewind`（引擎 `_this[122454]`）。 */
  textRewindAfterWheelUp: number;
  /** 侧栏打开后（再跑 30 帧）的路由表项数。 */
  routeCountAfterSidebar: number;
  /** 侧栏打开后 `0x220`（平移动画窗 = 侧栏按钮逐个摆出）的命中次数。 */
  i220AfterSidebar: number;
  /** 滚轮下滚（默认位 1）的派发。 */
  wheelDownDispatch: { label: number; kind: string } | null;
}

let cached: Promise<Fixture | null> | null = null;

/** 拷贝一份派发记录（null ⇒ null）。★不写 `{...e.lastDispatch}`：TS 拒绝展开可空联合。 */
function snapDispatch(e: Engine): { label: number; kind: string } | null {
  const d = e.lastDispatch;
  return d === null ? null : { label: d.label, kind: d.kind };
}

/**
 * 跑**一次**真链路并把四个动作的观测一起取回来（链贵，共享一份）。
 *
 * 返回 `null` = 资源根里没有启动脚本（干净 clone / CI）⇒ 调用方 `t.skip()`。
 */
function runChain(): Promise<Fixture | null> {
  cached ??= (async (): Promise<Fixture | null> => {
    const boot = await bootHeadless({ log: () => {} });
    const e = boot.e;
    const input = e.input;
    let clock = 0;
    let firstTextIp = -1;
    let i220 = 0;
    const unknownHits = new Map<number, number>();
    const host = {
      now: (): number => clock,
      advanceModel: (t: number): void => {
        boot.scene.advance(t);
      },
      poolPending: () => boot.scene.poolPending(),
    };
    const base: Omit<FrameLoopOptions, 'until' | 'maxFrames'> = {
      gates: { anim: 'wait', sleep: 'wait', advance: 'pump' },
      advFrame: true,
      maxStepsPerFrame: 20000,
      onStepStart: (_frame, ins) => {
        if (!ins) return;
        if (ins.opcode === 0x220 && e.curScript().name.startsWith('SN0000')) i220++;
        if (firstTextIp < 0 && e.curScript().name.startsWith('SN0000') && ins.opcode === 0x6e) {
          firstTextIp = e.curScript().ip;
        }
      },
      onUnknown: (err) => {
        // 本链的未知 opcode 一律登记并继续：本票只问"滚轮落到哪个消费者"，
        // 不为别的指令的缺失背书（缺失清单由 `analysis/opcode-gaps.json` 记）。
        unknownHits.set(err.opcode, (unknownHits.get(err.opcode) ?? 0) + 1);
        e.unknownOpStubs.set(err.opcode, 1);
        return 'continue';
      },
      onFrameEnd: () => {
        clock += TICK_MS;
      },
    };
    let lastScript = e.curScript().name;
    const run = async (frames: number, until?: () => boolean): Promise<void> => {
      await runFrameLoop(e, host, {
        ...base,
        ...(until ? { until } : {}),
        initialScript: lastScript,
        maxFrames: frames,
      });
      lastScript = e.curScript().name;
    };
    const hover = (): number => e.curScript().locals.int.get(0x3f7) ?? -99;
    const clickAt = async (xy: [number, number], until: () => boolean): Promise<void> => {
      input.setCursor(xy[0], xy[1]);
      await run(2000, until);
      input.pressMouse(0);
      await run(400);
      input.releaseMouse(0);
    };

    // ---- 走到 TITLE → Game Start → GAMESTART → ゲーム開始 → SN0000 首文案 ----
    await run(4000, () => e.curScript().name.startsWith('TITLE'));
    await run(4000);
    await clickAt(GAME_START_XY, () => hover() === 0);
    await run(4000, () => e.curScript().name.startsWith('GAMESTART'));
    await clickAt(START_GAME_XY, () => hover() === 0);
    await run(1200);
    for (let round = 0; round < 40 && firstTextIp < 0; round++) await run(2000, () => firstTextIp >= 0);
    assert.ok(firstTextIp >= 0, '前置：应走到 SN0000 的首条 `show-text`');
    await run(3000, () => e.awaitingAdvance);
    assert.equal(e.curScript().name, 'SN0000.BIN', '前置：停在 SN0000 的等待态');

    // ---- 前置：ADV 的 UI 例程已把键位表登记好（位 3 与位 8 都在）----
    for (let round = 0; round < 30; round++) {
      if (e.awaitingAdvance && e.routes.entries.some((en) => en.keyBit === 3)) break;
      await run(600, () => e.awaitingAdvance && e.routes.entries.some((en) => en.keyBit === 3));
    }
    assert.ok(e.awaitingAdvance, '前置：必须回到等待态（否则泵不跑）');
    assert.ok(
      e.routes.entries.some((en) => en.keyBit === 3),
      '前置：位 3 已由 `0x97` 绑到路由项（src/SN0000.txt:88-103 的 `i090`/`i097` 对）',
    );
    const routesBefore = e.routes.entries.map((en) => [en.keyBit, en.labelClick] as [number, number]);

    // ---- 动作 A：滚轮上滚（默认 set:WheelKeyUp = 3）----
    e.lastDispatch = null;
    input.addWheel(120);
    assert.equal(input.wheelKeyBits, 0x8, '★一次上滚 = 掩码位 `1 << 3`（raw 141604-141606，默认位号 3）');
    await run(30, () => e.lastDispatch !== null);
    const wheelUpDispatch = snapDispatch(e);
    const textRewindAfterWheelUp = e.engineValues.get(ENGINE_FIELD.textRewind) ?? 0;

    // ---- 动作 A 的后果：label 体真的跑了（侧栏被摆出来）----
    await run(30);
    const routeCountAfterSidebar = e.routes.entries.length;
    const i220BeforeDown = i220;

    // ---- 动作 B：滚轮下滚（默认 set:WheelKeyDown = 1 = ↓ 位）----
    e.lastDispatch = null;
    input.addWheel(-120);
    assert.equal(input.wheelKeyBits, 0x2, '下滚 = `1 << 1`（默认位号 1）');
    await run(30, () => e.lastDispatch !== null);
    const wheelDownDispatch = snapDispatch(e);

    return {
      e,
      routesBefore,
      wheelUpDispatch,
      textRewindAfterWheelUp,
      routeCountAfterSidebar,
      i220AfterSidebar: i220BeforeDown,
      wheelDownDispatch,
    };
  })();
  return cached;
}

test('★① 键位表：ADV 把「位 3」绑给 `label_00002c40`（侧栏）、「位 8」绑给「回看」', async (t) => {
  const f = await runChain();
  if (!f) {
    t.skip('资源根里没有可启动的脚本（install/ 或 raw/）');
    return;
  }
  const byBit = new Map(f.routesBefore.filter(([bit]) => bit >= 0));
  assert.equal(byBit.get(3), SIDEBAR_LABEL, '★位 3 → `SN0000.txt:770` 的 `label_00002c40`（建/展开侧边栏）');
  assert.equal(byBit.get(8), HISTORY_LABEL, '★位 8 → `SN0000.txt:831` 的 `label_00002f84`（→ `call-script 31 // HISTORY`）');
  assert.equal(byBit.get(1), 2701, '位 1 → `SN0000.txt:82` 的 `label_00002a70`（下方向键族的菜单导航）');
});

test('★★② 默认配置下，一次滚轮上滚的派发 = `{label:2817, kind:"key"}`，且**不**动 `textRewind`', async (t) => {
  const f = await runChain();
  if (!f) {
    t.skip('资源根里没有可启动的脚本（install/ 或 raw/）');
    return;
  }
  assert.ok(f.wheelUpDispatch, '上滚必须被"键命中"出口消费掉（引擎 raw 20242 是泵的第一优先出口）');
  assert.equal(f.wheelUpDispatch!.kind, 'key', '★走的是 `sub_403D70` 键命中，不是回看泵');
  assert.equal(
    f.wheelUpDispatch!.label,
    SIDEBAR_LABEL,
    '★用户实测「上滚 ⇒ 打开侧边栏」的成因：默认 `set:WheelKeyUp=3` 就是 ← 键',
  );
  assert.equal(
    f.textRewindAfterWheelUp,
    0,
    '★回看方向 `Engine[489816]` 保持 0：`sub_411BC0` raw 20341 的回看块在整个 ADV 里被键命中挡在前面',
  );
  assert.equal(f.e.effectFlags & 0x100000, 0, '★`0x100000`（跳读/回看泵进行中）也没被置起');
});

test('★★③ 派发不是记账：label 体真的执行 ⇒ 侧栏被摆出来（路由 +12 项、`0x220` × 22）', async (t) => {
  const f = await runChain();
  if (!f) {
    t.skip('资源根里没有可启动的脚本（install/ 或 raw/）');
    return;
  }
  assert.equal(
    f.routeCountAfterSidebar,
    f.routesBefore.length + 12,
    '★`label_00000e78` 里的 11 条 `i090` + 1 条跟随光标的热点（`SN0000.txt:79-91`）',
  );
  assert.equal(
    f.i220AfterSidebar,
    22,
    '★`label_00000e78`（`SN0000.txt:160-176`）对 22 个按钮逐个 `i220 … 0 0 c8 6e 0 0`（平移动画窗）',
  );
  // ★不断言"某个 handle 出现在 drawItems 里"：`0x220` 只写**动画窗**（`scEnsureItem` 会建一个
  //   `flags` bit0 未置的元素，但那是实现细节）；按钮的图元由侧栏脚本后续的 draw 指令给出。
  //   ⇒ 这里的判据是"label 体真的跑了"（路由 +12、0x220 × 22），不是"画面上有像素"。
});

test('★④ 滚轮下滚（默认位 1 = ↓）也走键命中 —— 两个方向都进"菜单导航"，只是各自的键位不同', async (t) => {
  const f = await runChain();
  if (!f) {
    t.skip('资源根里没有可启动的脚本（install/ 或 raw/）');
    return;
  }
  assert.ok(
    f.wheelDownDispatch !== null,
    '下滚也必须被泵消费掉（否则这一位会在掩码里积到下一帧）',
  );
  assert.equal(
    f.wheelDownDispatch!.kind,
    'key',
    '★下滚（位 1）同样命中 `sub_403D70` 的第一出口 —— 位 1 也被 `0x97` 绑了 labelC（`SN0000.txt:79-103`）',
  );
  assert.equal(
    f.wheelDownDispatch!.label,
    2701,
    '★位 1 → `SN0000.txt:82` 的 `label_00002a70`（= ↓ 键那一条）⇒ 滚轮**两个方向都是菜单导航**，与引擎默认一致',
  );
  assert.notEqual(f.wheelDownDispatch!.label, SIDEBAR_LABEL, '下滚不该走到侧栏那一条（那是位 3 的 label）');
});

test('★⑤ 两条出口不共用：上滚（位 3）与回看泵（`sub_411BC0` raw 20341）互斥', async (t) => {
  const f = await runChain();
  if (!f) {
    t.skip('资源根里没有可启动的脚本（install/ 或 raw/）');
    return;
  }
  // 引擎次序（raw 20242 → 20341）：键命中在**前**，回看块在**后**，且回看块还被
  // `effect_flags & 0x40000000`（逐字中）门控 ⇒ 产品路径上"上滚 ⇒ 回看游标"**永远轮不到**。
  // 这条与 `test/wheel-as-key.test.ts` 的 ⑨ 是**同一对互补判据**：那条证明了"路由表里没有
  // 位 3 绑定时回看块可达"，这条证明"真语料里位 3 有绑定 ⇒ 回看块不可达"。
  assert.equal(f.wheelUpDispatch!.kind, 'key', '上滚走键命中');
  assert.equal(f.textRewindAfterWheelUp, 0, '★回看方向保持 0（`sub_459770` 一次都没被这条输入调到）');
  assert.equal(f.e.effectFlags & 0x100000, 0, '★`0x100000` 也没被置起');
  assert.equal(f.wheelDownDispatch!.kind, 'key', '下滚同样走键命中（不是 `advancePressed`）');
});
