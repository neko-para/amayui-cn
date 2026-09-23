/** @tier T1 @kind core @subsystem config */
/**
 * 退出设置页的重派生门（旁白 / 门没开）—— 2 次全链路
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

/**
 * ★`tickets/T-0102` 的核心判据（此前**没有**这条守卫）：**「回 ADV」重派生真的会改全局文字色**。
 *
 * 引擎的「退出设置页 → 回 ADV」路径 = `src/CONFIG.txt:225-269`：按 `3f37` 重派生 `14acda`
 * （`3f37 < 0` ⇒ 旁白 ⇒ 0）→ `call label_00001ae8`（重算 `f807b` 并 `i076/i077` 应用）→ `i071 2` → `:269` 的 `i082`。
 * 用户实测的紫色残留就发生在这条路上，所以必须钉住它**在 emulator 里确实会生效**。
 *
 * 本用例用 `advReturnProbe`（真实 `install/CONFIG.BIN` + 角色设定页 + 强制退出）跑两组：
 *  - **旁白**（`3f37 = -1`）⇒ `14acda = 0`、`Engine[21664]` 必须变回 `#ffffff`、且 `i082` 被执行；
 *  - **门没开**（`1397 = 0`）⇒ `CONFIG.txt:225` 的 `local10 = ((g0==1)||(g0==6)) && (1397==1)` 为 0
 *    ⇒ 整块（含 `i082`）被跳过、全局**保持**进页前的紫。
 *
 * ★为什么值得一条：这两条一起把「重派生算错」这条曾经的假设**排除**掉（前一组证明脚本逻辑是对的、
 * 后一组给出"看起来没修"的可复现形态），并让 `T-0104`（`i082` 只是 stub）成为剩下的主要候选。
 */
test('★T-0102：退出设置页的重派生会改全局文字色（旁白 ⇒ #ffffff；门没开 ⇒ 保持原色且不执行 i082）', async () => {
  const narration = await runConfig1Chain({ previewProbe: true, advReturnProbe: { g1397: 1, msg: -1 } });
  const a = narration.advReturn;
  assert.ok(a, '应给出 advReturn 探针结果');
  assert.equal(a!.before.fill, '#ff90b6', '前提：角色设定页跑完时全局被留在最后一行那个角色色（脚本 `0xff90b6`）');
  assert.equal(a!.before.c14acda, 12, '前提：进退出路径前的角色号是角色页最后一行那个');
  assert.ok(a!.sawI082, '旁白路径必须执行到 CONFIG.txt:269 的 i082（= 用户报的那条未知指令）');
  assert.equal(a!.after.c14acda, 0, '旁白（3f37 < 0）必须把角色号重派生为 0');
  assert.equal(a!.after.fill, '#ffffff', '旁白 ⇒ adcd[0] = 白 ⇒ Engine[21664] 必须从角色色变回 #ffffff');
  // ★`T-0104`：`i082` 不是 stub —— 它必须与引擎那道门**一致**：
  //   引擎 `if (v8 > op2 && op2 >= 0)`（记录表条数 > op2）⇒ 记录表为空时**引擎也什么都不做**，
  //   非空则必须重发布一次。本链路（CONFIG 页，无 ADV 消息历史）通常为空 ⇒ 先把它记下来，
  //   免得后人把"0 次重发布"误读成"实现没做"；正向用例在 `test/op-0104-gdi-repaint.test.ts`。
  if (a!.recordsAtI082 > 0) {
    assert.ok(
      a!.republishByI082 >= 1,
      `★记录表非空（${a!.recordsAtI082} 条）⇒ i082 必须重发布该窗（实得 ${a!.republishByI082}）`,
    );
  } else {
    assert.equal(
      a!.recordsAtI082,
      0,
      `i082 执行时记录表条数应被探针记下（实得 ${a!.recordsAtI082}；-1 = 没跑到 i082）`,
    );
    assert.equal(a!.republishByI082, 0, '★记录表为空 ⇒ 引擎那道门也拦住（emulator 必须同样什么都不做）');
  }

  // 门没开：`1397 != 1` ⇒ 整块被跳过（这正是"退出后仍紫"的一种可复现形态）
  const gated = await runConfig1Chain({ previewProbe: true, advReturnProbe: { g1397: 0, msg: -1 } });
  const g = gated.advReturn!;
  assert.equal(g.sawI082, false, '1397 != 1 ⇒ CONFIG.txt:225 的门把整块跳过 ⇒ i082 不得被执行');
  assert.equal(g.republishByI082, 0, 'i082 没执行 ⇒ 不得有它触发的重发布（对照）');
  assert.equal(g.after.fill, '#ff90b6', '门没开 ⇒ 全局保持进页前的角色色（脚本 `0xff90b6`；别当成"重派生算错"）');
  assert.equal(g.after.c14acda, 12, '门没开 ⇒ 角色号也不得被重派生');
});
