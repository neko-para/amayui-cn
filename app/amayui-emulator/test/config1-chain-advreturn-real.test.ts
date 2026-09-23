/** @tier T1 @kind core @subsystem config */
/**
 * 判据 3 收尾：真路径实测值（g0=6 + 旁白 + 记录表非空）—— 1 次全链路
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
 * ★`tickets/T-0102` 判据 3 的**收尾**：把上面三组"强制置值"换成**真路径实测的那一组**。
 *
 * 实测出处（E4，`.tmp/t0102-adv-trace.mts`：真语料 `SYSTEM4 → TITLE → GAMESTART → SN0000`，
 * 在 **ADV 显示态那一帧（frame 5912）**采样）：
 * ```
 * g0 = 6      （`SETFATE.BIN` frame 5228 置；另一处 `SC0000.txt:1292` 的 `mov (global-int 0) 6` 同值）
 * 1397 = 1    （`SN0000.BIN` frame 5912 置 —— 与 `3f38` 同一处分派设置）
 * 3f38 = 1
 * 3f37 = -1   （旁白：`SETFATE.BIN` frame 5228 置）
 * 14acda = 0 / f807b = 0xffffff
 * 文本项记录 = 2（600 帧后 6）⇒ **非空**
 * ```
 * ⇒ 真路径落在「`g0=6` + 旁白 + 记录表**非空**」这一组合上：门是**开**的（`(6==6) && (1397==1)`）、
 * `:262` 走假分支（跳过 `i071 2` + 重新入队）、但 `:269 i082` 的门（`记录表条数 > op2`）**过得去**
 * ⇒ 引擎/实现都必须**用重派生后的实时白重画一次**。这三条各自都有守卫，但**组合**此前没钉住
 * —— 而"门没开 ⇒ 整块跳过"那条（组一/组二的反面）正是最容易被误当成真凶的假设。
 */
test('★T-0102 判据 3 收尾：真路径实测值（g0=6 + 旁白 + 记录表非空）⇒ 门开、色转白、i082 用实时白重画**一次**', async () => {
  const real = await runConfig1Chain({
    previewProbe: true,
    advReturnProbe: { g0: 6, g1397: 1, msg: -1, seedRecords: 3 },
  });
  const r = real.advReturn!;
  assert.equal(r.before.fill, '#ff90b6', '前提：角色设定页跑完时全局被留在最后一行那个角色色（脚本 `0xff90b6`）');
  // ★`T-0104` 判据 4 的**可自动化那一半**（用户实测原话：「ADV → 设置界面 → 右键退出 ⇒ 命中未知指令 i082 而硬停」）：
  //   这条退出链跑的**就是** `CONFIG.txt:269` 那一笔（`sawI082` 在下一条断言），所以"它不再硬停"
  //   等价于"这条链的未实现指令清单为空"。谁把 `0x82` 从真实现表里挪走（退回桩/删注册），这里立即红。
  assert.deepEqual(
    real.unimplemented,
    [],
    '★ADV 语境的退出链不得有未实现指令 —— 用户实测的 `i082` 硬停必须彻底消失（T-0104 判据 4）',
  );
  assert.equal(r.sawI082, true, '★门开（g0=6 ∈ {1,6} 且 1397=1）⇒ 必须跑到 CONFIG.txt:269 的 i082');
  assert.equal(r.after.c14acda, 0, '旁白（3f37 < 0）⇒ 角色号必须重派生为 0');
  assert.equal(r.after.fill, '#ffffff', 'adcd[0] = 白 ⇒ 全局填充色必须从紫变白');
  assert.equal(r.recordsAtI082, 3, '种子落进记录表（真路径实测 2..6 条 ⇒ 非空）');
  assert.equal(r.republishByI082, 1, '★记录表非空 ⇒ i082 必须重画该窗**恰好一次**（与引擎 raw 79502 的门同口径）');
  assert.ok(r.restyleByI082, '重画载荷必须被捕获');
  assert.equal(r.restyleByI082!.fill, '#ffffff', '★重画用的是**重派生后的实时白**（不是入队快照里的紫）');
  assert.equal(r.restyleByI082!.snapshot, false, '该窗此刻没有入队快照 ⇒ styleOfWin 走 globalFontSnapshot 回退');
  assert.ok(
    !r.opsSyncedAfterI076.includes(0x6e),
    '★`g0 = 6` ⇒ `:262` 假分支跳过 `show-text`（所以"重画"这一笔只能靠 i082，不能靠重新入队）',
  );
});
