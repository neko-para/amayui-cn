/** @tier T0 @kind core @subsystem render */

/**
 * **动画判据的两条口径**（`tickets/T-0002` 的 A2 / `tickets/T-0008` 的 D3 / `tickets/T-0024`）。
 *
 * 修前只有**一条**：`scAnimationsDone` 只查**窗 0（颜色窗）**，却被两处同时使用 ——
 * ① "这一帧该不该合成"（`needsRender`）② "`0x400` 门能不能放行"。两者的正确范围**不同**：
 *
 * | 判据 | 函数 | 范围 | 为什么 |
 * |---|---|---|---|
 * | 合成 | `scAnimationsPending` | mesh 全窗 + draw item **5 个窗** | 引擎每 present 才求值一次动画 ⇒ 任何窗在跑就必须继续合成，否则中间帧不上屏 |
 * | `0x400` 门（池挂起位） | `scPoolPending` | mesh 全窗 + draw item 5 窗，**排除 `+720` bit0 的元素** | 引擎 `sub_49AA30` raw 117843-117844 就是这条；门 = 本位 + `0x238` 计时器（`T-0024`） |
 *
 * ★本文件一律按引擎的调用序 **`scAdvance(clock) → 判据(clock)`** 走：
 * `advanceWindows` 会在"所有窗都结束"时清项级动画位（`flags &~ 2`），而判据只读不写。
 *
 * ★另一个被本文件暴露的既有偏差（已登记进 `tickets/T-0002` 的 notes，不在本次改动范围内）：
 * 窗的"起点未锁存"用的是 **`animStart === 0` 哨兵**（引擎 `+0x34`），而 headless 的虚拟时钟**从 0 起**
 * ⇒ 在 `clock === 0` 那一刻配置的动画会被反复重新锁存、永远不结束。真实使用里动画都在若干帧之后配置
 * （wall clock 更不可能为 0）⇒ 本文件从 `T0 = 16` 起算，与真实使用一致。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HeadlessScene } from '../src/renderer/headlessScene.js';
import { scAdvance, scAnimationsPending, scPoolPending, sceneNeedsRender } from '../src/renderer/sceneModel.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const H = 0x100;
/** 虚拟时钟起点（非 0，见文件头说明）。 */
const T0 = 16;

function sceneWithItem(): HeadlessScene {
  const s = new HeadlessScene({});
  s.configureDrawItem({ handle: H, layer: 1, tex: 1, srcX: 0, srcY: 0, srcW: 10, srcH: 10, dstX: 0, dstY: 0 });
  return s;
}

/** 走一帧（引擎序：先推进窗、再判"还有没有窗在跑"）——**合成口径**。 */
function frame(s: HeadlessScene, clock: number): boolean {
  scAdvance(s.scene, clock);
  return !scAnimationsPending(s.scene, clock);
}

test('A2：**缩放窗**在跑时不得判成"跑完"（修前只查颜色窗 ⇒ 会误判）', () => {
  const s = sceneWithItem();
  s.setScaleAnim(H, 0, 1000, 2, 2, 2); // delay=0、dur=1000
  assert.equal(frame(s, T0), false, '窗刚配置 ⇒ 有动画在跑');
  assert.equal(frame(s, 500), false, '窗内 ⇒ 仍在跑');
  assert.equal(frame(s, T0 + 1000), true, '窗结束（clock >= start+delay+dur）⇒ 跑完');
});

test('A2：**旋转窗**同理（每个窗都要参与判定）', () => {
  const s = sceneWithItem();
  s.setRotationAnim(H, 0, 1000, 0, 0, 1, 90);
  assert.equal(frame(s, T0), false, '旋转窗在跑');
  assert.equal(frame(s, T0 + 1000), true, '旋转窗结束');
});

test('A2：**平移窗**同理', () => {
  const s = sceneWithItem();
  s.setTranslationAnim(H, 0, 1000, 10, 20, 30);
  assert.equal(frame(s, T0), false, '平移窗在跑');
  assert.equal(frame(s, T0 + 1000), true, '平移窗结束');
});

test('A2：**flipbook 窗**同理', () => {
  const s = sceneWithItem();
  s.setFlipbook(H, 0, 1000, 4, 2, 0);
  assert.equal(frame(s, T0), false, 'flipbook 窗在跑');
  assert.equal(frame(s, T0 + 1000), true, 'flipbook 窗结束');
});

test('A2：**delay 期**也算"还在跑"（窗未开始不等于结束）', () => {
  const s = sceneWithItem();
  s.setScaleAnim(H, 200, 1000, 2, 2, 2); // delay=200
  assert.equal(frame(s, T0), false, 'delay 期');
  assert.equal(frame(s, T0 + 100), false, '仍在 delay');
  assert.equal(frame(s, T0 + 1100), false, '窗内（delay+dur = 1200）');
  assert.equal(frame(s, T0 + 1200), true, 'delay+dur 都过了');
});

test('A2：**颜色窗**（窗 0）保持原判据不变（修前唯一被查的那个）', () => {
  const s = sceneWithItem();
  s.setDrawColor(H, 0, 1000, 0x11223344);
  assert.equal(frame(s, T0), false, '颜色窗在跑');
  assert.equal(frame(s, T0 + 1000), true, '颜色窗结束');
});

test('A2：无动画的项不影响判定（空项/普通项 ⇒ 立刻"跑完"）', () => {
  const s = sceneWithItem();
  assert.equal(frame(s, T0), true, '没有任何窗 ⇒ 跑完');
});

/**
 * **池挂起位 `Scene+46516` 的口径**（`tickets/T-0024`）：序章的 80 000 ms 慢推不是靠"门只看颜色窗"绕过门的，
 * 而是脚本用 **`i242 <handle> 1`**（`DrawItem+720` bit0）把它**排除**出池挂起位（引擎 `sub_49AA30` raw 117843-117844）。
 */
test('T-0024：`+720` bit0 的元素不参与池挂起位（序章 80 000 ms 慢推），颜色窗照旧参与', () => {
  const s = sceneWithItem();
  s.setTranslationAnim(H, 0, 0x13880, 0, 1, 0); // = SN0000.txt:1043 的那条
  assert.equal(scAnimationsPending(s.scene, T0), true, '合成口径：有窗在跑 ⇒ 要继续合成');
  assert.equal(scPoolPending(s.scene, T0), true, '未排除 ⇒ 池挂起位被置（"此项还在动"）');
  s.setDrawEntryParam(H, 1); // = SN0000.txt:1045 的 `i242 (global-int f8023) 1`
  assert.equal(scPoolPending(s.scene, T0), false, '`+720` bit0 ⇒ 本项不置池挂起位（门不再等它）');
  assert.equal(scPoolPending(s.scene, T0 + 40000), false, '40 s 后仍是同一个结论（单调）');

  const s2 = sceneWithItem();
  s2.setDrawColor(H, 0, 1000, 0x11223344);
  assert.equal(scPoolPending(s2.scene, T0), true, '颜色窗在跑 ⇒ 池挂起位置上 ⇒ 门必须等');
  scAdvance(s2.scene, T0 + 1000);
  assert.equal(scPoolPending(s2.scene, T0 + 1000), false, '颜色窗结束 ⇒ 池空闲 ⇒ 放行');
});

/**
 * 证据棘轮：上面那条测试的依据是**脚本里真的存在**那条 80 000 ms 平移窗，且紧随其后就被 `i242 … 1` 排除
 * （`i238 64` = 100 ms 计时器 + `wait`）。脚本改了（值变小 / `i242` 被删）⇒ 这条断言变红 ⇒ 回来重核 `scPoolPending`。
 */
test('T-0024：序章的 `i220 … 0 13880` + `i242 … 1` + `i238 64` + `wait` 仍在（证据锚点棘轮）', () => {
  const s = fs
    .readFileSync(path.join(HERE, '..', '..', '..', 'src', 'SN0000.txt'), 'utf8')
    .split(/\r?\n/);
  const i = s.findIndex((l) => l.trim() === 'i220 (global-int f8023) 0 13880 (local-int 0) (local-int 1) 0');
  assert.notEqual(i, -1, '找不到 SN0000 的 80 000 ms 平移窗（T-0024 的实证锚点）');
  assert.equal(s[i + 1]?.trim(), 'mov (global-int f8047) 1', `锚点行号漂移（当前 ${i + 1}）`);
  assert.equal(s[i + 2]?.trim(), 'i242 (global-int f8023) 1', '慢推必须被 `i242 … 1` 排除出池挂起位');
  assert.equal(s[i + 4]?.trim(), 'i238 64', '门靠 `i238` 的 100 ms 计时器放行');
  assert.equal(s[i + 5]?.trim(), 'wait', '计时器之后紧跟 `wait`（置 0x400 门）');
});

/**
 * **"这一帧该不该合成"的判据**（`tickets/T-0008` 的 D3）：共享层函数 `sceneNeedsRender`。
 * 修前这条判据只活在 `PixiBackend.needsRender()` 里、且读了宿主自己的 `waitFlags` 镜像
 * （只置不清 ⇒ **永久为真**）⇒ 既测不到，也让"引擎式 present"永不生效。
 */
test('T-0008：sceneNeedsRender = 脏 || 仍有动画；**不看** 0x400 门（门由帧驱动负责）', () => {
  const s = sceneWithItem();
  assert.equal(sceneNeedsRender(s.scene, T0, false), false, '不脏、无动画 ⇒ 不必合成');
  assert.equal(sceneNeedsRender(s.scene, T0, true), true, '脏 ⇒ 必须合成');
  s.setScaleAnim(H, 0, 1000, 2, 2, 2);
  assert.equal(sceneNeedsRender(s.scene, T0, false), true, '有动画在跑 ⇒ 必须合成');
  scAdvance(s.scene, T0 + 1000);
  assert.equal(sceneNeedsRender(s.scene, T0 + 1000, false), false, '动画跑完且不脏 ⇒ 可以不再合成（"永久为真"被修掉）');
});

/**
 * 棘轮比对的是**代码**，所以先剥注释：本轮修复的说明文字本身就写着"修前这里是 `this.waitFlags`"，
 * 直接 grep 全文会把「记录历史的注释」误判成「回归的代码」（ticket 台账的 anchor 棘轮同理，是已知取舍）。
 */
function stripComments(src: string): string {
  // `(^|\s)\/\/` 而非裸 `\/\/`：避免把字符串里的 `https://` 当成行注释起点。
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

test('T-0008：宿主**不得**再用自己的 waitFlags 镜像做渲染判据（源码棘轮，防回归）', () => {
  const dir = path.join(HERE, '..', 'src', 'renderer');
  for (const name of ['pixiBackend.ts', 'headlessScene.ts'] as const) {
    const code = stripComments(fs.readFileSync(path.join(dir, name), 'utf8'));
    assert.equal(
      /this\.waitFlags/.test(code),
      false,
      `${name} 不应保存/读取 waitFlags 镜像（门状态的真源是 Engine.waitFlags）`,
    );
    assert.equal(
      /waitFlags\s*(?:\|=|&=|\^=|\+=|-=)/.test(code),
      false,
      `${name} 不应就地改 waitFlags（门状态的真源是 Engine.waitFlags）`,
    );
    // 形参默认值 `present(nowMs?, waitFlags = 0)` 是合法的（只做诊断日志），故只查字段写入。
    assert.equal(
      /this\.waitFlags\s*=/.test(code),
      false,
      `${name} 不应写入 waitFlags 字段（门状态的真源是 Engine.waitFlags）`,
    );
    assert.equal(
      /^\s*(?:private|public|protected|readonly|\s)*waitFlags\s*[:=]/m.test(code),
      false,
      `${name} 不应声明 waitFlags 字段（门状态的真源是 Engine.waitFlags）`,
    );
  }
});

/**
 * ★**源码棘轮：引擎不许保留"只有测试在调"的门面方法**（`tickets/T-0014`）。
 *
 * 修前 `Engine.pickHoverLabel()` 在 `src/` 里**零调用者**（产品路径早已把那一对调用内联进
 * `serviceAdvanceWait()`），只剩测试在调 —— 引擎为一个"产品不走"的路径保留了 API。
 * `T-0014` 把门面挪到 `test/harness.ts`（`pickHoverLabel(e)`，逐字复刻那一对调用）。
 * 这里剥注释后再查，免得把"记录这段历史的注释"误判成回归。
 */
test('T-0014：`Engine` 不得再挂"只被测试调用"的悬停门面（`pickHoverLabel`，源码棘轮）', () => {
  const engineSrc = stripComments(fs.readFileSync(path.join(HERE, '..', 'src', 'vm', 'engine.ts'), 'utf8'));
  assert.equal(
    /pickHoverLabel/.test(engineSrc),
    false,
    'Engine 不应有 pickHoverLabel（产品路径用 `serviceAdvanceWait`；测试门面在 test/harness.ts）',
  );
  // 产品路径那一对调用必须还在（删门面不许把产品路径一起删掉）
  // ★2026-09（P1 `adv-advance-route-table` / `msgwin-backlog-cursor`）：`hoverDispatchAllowed` 现在
  //   收本帧掩码当参数（泵算一次后复用，与 raw 20315 的 `*v2` 同口径）⇒ 调用点是
  //   `hoverDispatchAllowed(mask)`。断言因此只钉**方法名 + 那一对调用**，不钉括号里的实参形状。
  assert.ok(
    /hoverDispatchAllowed\s*\(/.test(engineSrc) && /nextHoverLabel\s*\(\)/.test(engineSrc),
    '引擎里必须仍有 hoverDispatchAllowed(...) + routes.nextHoverLabel() 这一对（产品悬停派发的真身）',
  );
});
