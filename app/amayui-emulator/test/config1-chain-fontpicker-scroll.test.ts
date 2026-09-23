/** @tier T1 @kind core @subsystem config */
/**
 * 字体选择器 / 滚动条两条探针（各 1 次全链路）
 *
 * ★从 `test/config1-chain.test.ts` 拆出（`tickets/T-0115`/`T-0126` 的「T1 内部共享链路」）：
 *   该文件原来在一个进程里**串行**跑 9 次 CONFIG1 全链路（单文件实测 59 s ≈ 整轮 verify 的一半以上）。
 *   九个变体的注入各不相同 ⇒ **没有可 memo 的共享状态**；但 node:test 是**按文件分进程并行**的
 *   ⇒ 把互不相干的探针**按文件拆开**：CPU 总工作量一字不变，墙钟从「九次相加」变成「最慢那一组」。
 *   ★判据一字不改（只搬位置）—— 这是「分档不降判据」的直接要求。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runConfig1Chain } from '../src/tools/config1Chain.js';
import { itemRenderPlacement, makeItem } from '../src/renderer/drawItem.js';

/**
 * ★2026-09 实测反馈：「**打开字体选择框 → 右键退出 → 再滚动列表**，滚动条中间 scale 出来的区域
 * 会漂到左边」。
 *
 * 根因链（全部可在本链路里观测）：
 *  1. `CONFIG1.txt:1045` 在打开字体选择器（`call-script 51dd`）前把脚本全局 `707ffa/707ffb`
 *     （**弹窗原点**，`CONFIG1.txt:1046-1048` 按行号算）置成 `0x348/0x78+0x32·n`，**从不复位**；
 *  2. 滚动条中段的 `0x217` pivot 被算成 `707ffa + 32e`（`CONFIG1.txt:2960`、`CONFIG2.txt:1424`），
 *     而它的**描画位置**是 `32e` ⇒ `pivot ≠ pos`（本例实测 pivotRel = 0x348 = 840）；
 *  3. 引擎把 pivot **原样**存进 DrawItem`+24/+28/+32`（`sub_4ACF20`，新建项默认 0 —— `sub_49A300`），
 *     渲染是 `v' = S·R·(v − pivot) + t + pivot`。Pixi 侧必须**同时**取
 *     `position = pivot`、`pivot = pivot − pos`；只改后者而位置用 `pos` 时，中段会整体平移
 *     `pivot − pos`（scaleX = 1 ⇒ 左移 840px）—— 这正是用户看到的"漂到左边"。
 *
 * 断言口径：**渲染出来的左边缘**（用渲染器同一份映射 `itemRenderPlacement` 算）必须与上/下盖的
 * `dstX` 一致。修前会差 `pivotRel`（840），修后为 0。
 */
test('★字体选择器开关过之后滚动：拇指中段的**渲染位置**不得漂移（pivot ≠ pos 的映射回归）', async () => {
  const r = await runConfig1Chain({ fontPickerProbe: true, fontPickerCloseThenScroll: true });
  const fp = r.fontPicker;
  assert.ok(fp?.opened, '应先打开字体选择器（$1$SELFONT）');
  assert.ok((fp?.names.length ?? 0) >= 9, `选择器应列出候选面名（实际 ${fp?.names.length}）`);
  assert.equal(fp?.scriptAfterClose, 'CONFIG1.BIN', '右键退出后应回到 CONFIG1');
  const origin = fp?.popupOrigin;
  assert.ok(origin && origin.x !== 0, `弹窗原点 707ffa 应仍是脚本留下的非零值（实际 ${JSON.stringify(origin)}）`);

  const t = fp?.afterCloseScroll;
  assert.ok(t, '关闭选择器并滚动后应能取到拇指三段');
  assert.equal(t!.middle.pivotRelX, origin!.x, '★中段 pivot 被算成「弹窗原点 + 轨道 x」⇒ pivotRel = 弹窗原点（本回归的前提）');

  // 渲染器同一份映射：走世界矩阵的段 = `position = pivot (+t)`、`pivotLocal = pivot − pos`；
  // 不走世界矩阵的段是纯 2D（`position = pos`，pivot/scale/rot/trans 一律不参与）。
  const renderedLeft = (seg: NonNullable<typeof t>['top']): number => {
    if (!seg.useWorld) return seg.dstX;
    const it = makeItem({
      handle: 1,
      layer: 1,
      tex: 0,
      srcX: 0,
      srcY: 0,
      srcW: seg.srcW,
      srcH: seg.srcH,
      dstX: seg.dstX,
      dstY: seg.dstY,
    });
    it.pivotX = seg.dstX + seg.pivotRelX;
    it.pivotY = seg.dstY + seg.pivotRelY;
    it.scaleTarget = { x: seg.scaleX, y: seg.scaleY, z: 1 };
    const pl = itemRenderPlacement(it, 0);
    return pl.position.x + pl.scale.x * (0 - pl.pivot.x);
  };
  assert.equal(t!.top.useWorld, false, '上/下盖没有变换指令 ⇒ 纯 2D 路径');
  assert.equal(t!.middle.useWorld, true, '中段有 `0x1FD` ⇒ 走世界矩阵');
  assert.equal(renderedLeft(t!.top), t!.top.dstX, '上盖（纯 2D）渲染位置 = dstX（回归基准）');
  assert.equal(
    renderedLeft(t!.middle),
    t!.middle.dstX,
    `★中段渲染左边缘必须回到轨道 x（实际 ${renderedLeft(t!.middle)} vs ${t!.middle.dstX}）` +
      '—— 修前会左移 pivotRel（= 弹窗原点）',
  );
  assert.equal(renderedLeft(t!.middle), t!.top.dstX, '三段必须同列');
});

/**
 * ★2026 实测反馈的回归闸：「**切换页面时，第一页滚到底，切到第二页滚动条会溢出范围**」。
 *
 * 根因不在滚动条本身（它的数学是对的）：`CONFIG1` 的"切左侧分类"是
 * **置 `7dd=1` → 脚本 `exit` → CONFIG.BIN 重新 `call-script` 调回来**，
 * 而重入时**帧槽被复用** ⇒ 一旦脚本载入没有重建帧局部池，
 * 上一页的滚动起点 `local5620` 就会漏进新一页（新页最大起点更小）：
 *
 * ```
 * 上一页滚到底 start=6；新一页 12 项 ⇒ maxStart=3
 * 拇指顶 = 106 + (428 − 拇指高)·6/3 → 320  ← 轨道只有 106..534 ⇒ 拇指溢出轨道
 * ```
 *
 * 本用例按用户的操作顺序复现（滚到底 → 切分类 → 再切回来），断言**每一步**都满足
 * `0 ≤ start ≤ maxStart` 且拇指完整落在轨道内（106..534）。
 */
test('★CONFIG1 滚动条：滚到底后切分类，滚动位置必须随新页重置（拇指不得溢出轨道）', async () => {
  const r = await runConfig1Chain({ scrollProbe: true });
  const steps = r.scrollSteps;
  assert.ok(steps && steps.length >= 4, `应采到 4 个滚动状态，实际 ${JSON.stringify(steps)}`);
  const TRACK_TOP = 106;
  const TRACK_BOTTOM = 106 + 428;
  for (const s of steps) {
    assert.ok(s.start >= 0, `[${s.tag}] 滚动起点不得为负：${s.start}`);
    assert.ok(s.start <= s.maxStart, `[${s.tag}] 滚动起点不得超过最大起点：${s.start} > ${s.maxStart}`);
    if (s.maxStart === 0) continue; // 该页不需要滚动条（引擎也不画）
    assert.ok(
      s.thumbTop >= TRACK_TOP - 0.5 && s.thumbTop + s.thumbH <= TRACK_BOTTOM + 0.5,
      `[${s.tag}] 拇指必须落在轨道内：top=${s.thumbTop} h=${s.thumbH}（轨道 ${TRACK_TOP}..${TRACK_BOTTOM}）`,
    );
  }
  // 具体现场：第一页确实滚到了底，切页后回到顶部（否则就是"局部量泄漏"又回来了）
  const [enter, bottom, switched] = steps!;
  assert.equal(enter!.start, 0, '刚进入时应停在列表顶部');
  assert.ok(bottom!.maxStart > 0 && bottom!.start === bottom!.maxStart, `第一页应能滚到底：${JSON.stringify(bottom)}`);
  assert.equal(switched!.start, 0, `切到新分类后滚动位置应重置为 0（实际 ${switched!.start}）`);
  assert.ok(
    switched!.thumbTop + switched!.thumbH <= TRACK_BOTTOM + 0.5,
    `切页后拇指不得溢出轨道：top=${switched!.thumbTop} h=${switched!.thumbH}`,
  );
});
