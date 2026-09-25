/** @tier T1 @kind core @subsystem config */
/**
 * 重派生的三条分支（种子 / g0=6 / g0=1 走剧情）—— 3 次全链路
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
 * ★`tickets/T-0102` 判据 3 的**判决实验**：`i082` 到底会不会重画、用**哪个**颜色重画。
 *
 * 判据 3 原本的首要嫌疑是「文本入队时的样式快照（`MsgSlot.fontStyle`）又被绕过 ⇒ 光栅化回退到
 * 当前全局样式」。本用例用两组把这条嫌疑**判死**：
 *  - 记录表非空（`seedRecords` = 模拟「ADV 侧已有文本项」）⇒ 引擎那道门（`v8 > op2`，raw 79502）打开
 *    ⇒ `i082` 必须**恰好重发布一次**，且载荷里的正文色 = **重派生后的实时色**（不是快照里的旧色）。
 *    本链路该窗没有入队快照（`snapFill === null`）⇒ `styleOfWin` 走的就是 `globalFontSnapshot` 回退
 *    ⇒ 「快照绕过」在**取色**这一环不成立。
 *  - `g0 = 6`（`src/SC0000.txt:1292` 的真实值）⇒ `CONFIG.txt:262` 的假分支跳 `label_000014a8`
 *    ⇒ **跳过** `:265 i071 2` + `:266 call label_00001d38`（后者末尾 `:437 show-text 2 (global-string d5d)`
 *    会把当前消息文本**重新入队**）⇒ 记录表仍空 ⇒ `i082` 的门不过。
 *  - `g0 = 1` 且 `3f37 >= 0`（= 用户在剧情里按「戻る」的那条路）⇒ **会**走重新入队（`0x71` + `show-text`）
 *    ⇒ 新快照是按**重派生之后**的全局色钉的（脚本顺序：`:260 call label_00001ae8` 在前、`:266` 在后）。
 *
 * ★为什么必须钉住这三条：判据 3 的结论是"取色环没有错、错在**哪条分支**被走到"，而分支完全由
 * `g0`/`1397`/`3f37` 这三个**继承来的全局**决定 —— 守卫把它们钉死，后人就不会再把
 * "退出后仍紫"误判成取色 bug（真凶是脚本被跳过时 `14acda`/`f807b` 保留了 CONFIG2 的残留）。
 */
test('★T-0102 判决实验：记录表非空 ⇒ i082 用重派生后的实时色重画一次；g0=6 走跳过分支（不重新入队）', async () => {
  // 一：记录表非空 ⇒ 门开 ⇒ 必须重画恰好一次，且用**实时**色
  const seeded = await runConfig1Chain({
    previewProbe: true,
    advReturnProbe: { g1397: 1, msg: -1, seedRecords: 3 },
  });
  const s = seeded.advReturn!;
  // ★`T-0151` retarget（**前提被取代**，不是放宽断言；承接 `T-0170` 的同一条判据）：
  //   `T-0170` 把旧断言 `=== 3` 改成 `=== 6`（"3 种子 + 3 行正文"），但漏了一道门 ——
  //   `CONFIG.txt:41 i1bb 0` … `:355 i1bb 1`，ADV 样例正文在 `:177-179`（夹在中间）⇒
  //   `Engine[97055] = 0x80000000` 期间引擎**不记任何记录**（`sub_46BE30` raw 83941-83942 /
  //   `sub_4691D0` raw 81549 / `sub_46B100` raw 82726 / `sub_461A10` raw 76380-76381）。
  //   ⇒ 本链路真值 = **只有种子**（3）。判据实验与守卫见 `config1-chain-advreturn-real.test.ts` 的同名注释。
  assert.ok(s.recordsAtI082 >= 3, '种子必须落进记录表且**非空**（门读的就是它；下界 = 种子数）');
  assert.equal(
    s.recordsAtI082,
    3,
    '★真值 = **只有 3 个种子**（本链路的正文入队落在 `i1bb 0` 区间 ⇒ 引擎不记；raw 83941-83942 / 81549）',
  );
  assert.equal(s.republishByI082, 1, '★记录表非空 ⇒ i082 必须重发布该窗**恰好一次**');
  assert.ok(s.restyleByI082, 'i082 那一笔的发布载荷必须被探针捕获（窗口号 + 颜色 + 是否有快照）');
  assert.equal(s.restyleByI082!.win, 9, '重画的窗必须是那个 ADV 窗口');
  assert.equal(
    s.restyleByI082!.fill,
    s.after.fill,
    '★重画用的必须是**重派生后的实时色**（与 after.fill 一致 ⇒ 取色环没有绕过）',
  );
  assert.equal(s.restyleByI082!.snapshot, false, '该窗此刻没有入队快照 ⇒ styleOfWin 走 globalFontSnapshot 回退');
  assert.equal(s.restyleByI082!.snapFill, null, '★快照的"没有"是 null 而不是 undefined（判 `!== undefined` 会误判）');
  assert.equal(s.restyleByI082!.liveFill, s.after.fill, '载荷色 == 那一刻的实时全局色（同一来源，互为印证）');

  // 二：`g0 = 6`（真实 ADV 值之一）⇒ `:262` 假分支 ⇒ 跳过 `i071 2` + 重新入队 ⇒ i082 仍然不画
  const six = await runConfig1Chain({ previewProbe: true, advReturnProbe: { g0: 6, g1397: 1, msg: -1 } });
  const x = six.advReturn!;
  assert.equal(x.sawI082, true, '`g0 = 6` 同样满足 `:220-225` 的重派生门 ⇒ 必须跑到 i082');
  assert.equal(x.after.fill, '#ffffff', '`g0 = 6` + 旁白 ⇒ 仍必须重派生为白');
  // ★`T-0151` retarget（**前提被取代**，与 `config1-chain-advreturn-real.test.ts` 同一条）：
  //   `T-0170` 这里写的是"跳过重新入队 ⇒ 记录表仍空"是**修前缺陷**、并断言 `recordsAtI082 === 3`、
  //   `republishByI082 === 1`。缺的那道门是 `i1bb`：CONFIG.txt 整段正文（含 `:177-179` 的 ADV 样例）
  //   跑在 `:41 i1bb 0` … `:355 i1bb 1` 之间 ⇒ `Engine[97055] = 0x80000000` ⇒ 引擎的**每一处**
  //   记录 push 都被 `if (a5 >= 0)` / `if (a3 >= 0)` 挡掉（raw 83941-83942 / 81549 / 82726 /
  //   76380-76381）⇒ 本组（**没塞种子**）表就是**空**的，`i082` 那道越界门（raw 79502 的 `v8 > op2`）
  //   在引擎里**也**过不去 ⇒ 不重画。旧断言 `=== 3` / `=== 1` 才是把"表恒空"这个**缺陷**当成了引擎行为。
  //   ★正面判据（证明这道门不是"实现没做"）：`test/op-0104-gdi-repaint.test.ts` 用合成指令直接
  //   写记录表后 `i082` 必重画；`test/t0151-msgwin-vm.test.ts` 的
  //   `★0x6E/0x196 的第 5 实参 = Engine[97055]：i1bb 0 期间**不记已画行**` 是这道门的红→绿守卫。
  assert.equal(
    x.recordsAtI082,
    0,
    '★本组**没塞种子** + 本链路的正文入队落在 `i1bb 0` 区间 ⇒ 记录表为空（raw 83941-83942 / 81549）',
  );
  assert.equal(
    x.republishByI082,
    0,
    '★记录表为空 ⇒ `i082` 的越界门（raw 79502 的 `v8 > op2`）在**引擎里也**过不去 ⇒ 什么都不做',
  );
  assert.ok(
    !x.opsSyncedAfterI076.includes(0x6e),
    '★`g0 = 6` 不得出现 `show-text`（0x6E）：`:262` 假分支跳过了 `:265/:266` 的重新入队',
  );

  // 三：`g0 = 1` 且 `3f37 >= 0`（= 剧情里按「戻る」）⇒ **会**重新入队，且新快照按重派生后的色钉
  const inScene = await runConfig1Chain({ previewProbe: true, advReturnProbe: { g0: 1, g1397: 1, msg: 0 } });
  const y = inScene.advReturn!;
  assert.equal(y.after.fill, '#ffffff', '剧情路线（g0=1、有当前消息号）也必须重派生为白');
  assert.ok(y.opsSyncedAfterI076.includes(0x71), '★该分支必须先 `i071 2` 清窗（`:265`）');
  assert.ok(y.opsSyncedAfterI076.includes(0x6e), '★然后 `:437 show-text 2` 把当前消息文本重新入队（脚本自己填内容）');
  // ★`T-0151` retarget（与上面 `x` 同一条前提）：
  //   `T-0170` 这里断言 `recordsAtI082 === 3` / `republishByI082 === 1`（"重入队也会 push 已画行记录"）。
  //   但 `:437` 的 `show-text 2` 同样跑在 `i1bb 0` 区间内（`CONFIG.txt:41`…`:355`）⇒ 引擎不记
  //   （raw 83941-83942）⇒ 本组表也为空 ⇒ `i082` 的门过不去 ⇒ 不重画。
  //   分支区分仍由上面两条 `opsSyncedAfterI076` 断言保证（那两条不受影响）。
  assert.equal(
    y.recordsAtI082,
    0,
    '★本组**没塞种子**；`:437` 的重入队也在 `i1bb 0` 区间 ⇒ 记录表为空（raw 83941-83942）',
  );
  assert.equal(
    y.republishByI082,
    0,
    '★记录表为空 ⇒ `i082` 的越界门（raw 79502）在引擎里也过不去 ⇒ 不重画（与 `x` 组同）',
  );
});
