#!/usr/bin/env node
/**
 * ops/load-from-adv.mjs —— **用例：从 ADV 界面（游戏内）的右侧侧栏进入存档/读档画面，载入真机存档槽 N**。
 *
 * ## ★★本用例**会修改侧边栏配置**（运行期）
 * 开跑时它会把 ADV 侧栏（charm 表）**在运行期写死**成固定排布：
 *
 * ```
 * global 13b0[0..8] ← [0xd, 0xe, 1, 0xb, 0xc, 2, 3, 4, 5]      // 第 0 格 = SAVE，第 1 格 = LOAD
 * ```
 *
 * - 为什么必须这么做：侧栏是**可配置**的，**默认布局里根本没有 SAVE/LOAD**
 *   （`src/INITCHARM.txt:6` = `[1 b c 2 3 4 5 6 7]`），玩家排布又存在 `SAVE.DAT` 里 ⇒
 *   不写死就没法确定"哪一格是 LOAD"（见 `tickets/T-0189` / `evidence/sidebar-charm-table-findings.md`）。
 * - 改的范围：**只改运行期内存**（emu 侧按 ENC 写脚本全局池），**不写回 `SAVE.DAT`**、不动玩家数据；
 *   但**本实例当次运行内的侧栏排布确实被改了**（下一次 `reset` 即恢复玩家排布）。
 * - 想保留玩家排布：加 `--keep-sidebar`（那时走**候选扫描**，扫不到就报错而不是乱点）。
 *
 * ## 为什么写死之后还是要"点前确认"
 * 派发是**点击时**读表（`src/SN0000.txt:401`）⇒ 写死即生效；但写命令可能失败（旧构建没有 `set-array`），
 * 所以脚本会**读回** `global 13b0..13b8` 校验，校验不过就退回候选扫描并把这件事打在日志里。
 *
 * ## 两条必须照做的实测纪律
 * 1. ★**"视觉展开 ≠ 逻辑展开"**（`tickets/T-0028`）：侧栏进场时看着就是展开的，但热点仍是**折叠态**
 *    （矩形 1230,233–1280,493）⇒ 直接点展开后的按钮位置**什么都不会发生**。必须先悬停折叠条
 *    `XY.advSidebarStrip` 让展开 label 重登记热点，再去点按钮。
 * 2. ★**按钮要"两帧点击"**（`emu.tap()`）：一次注入 `cursor+press+release` 不激活（实测点不动）。
 *
 * 前置：实例**已经在一个带 ADV 侧栏的场景里**（SN0000/SC0000/NOVEL 一族），且 `emu.mjs status` 说「可驱动」。
 * 判据：① 侧栏表校验通过（或退回扫描命中）② `cur = SAVE.BIN` ③ **`f7ff0 == 1`（读档模式，安全断言）**
 *       ④ 日志出现 `[slot-load]` ⑤（可选 `--expect BIN`）载入后帧链到该脚本。
 *
 * ★状态（2026-09-26）：实现完成，**端到端未跑通验证**（验证到一半实例损坏、用户中止）——
 *   票面（`tickets/T-0188` 判据④）已如实登记，**不假称通过**。
 *
 * 用法：
 *   node .../ops/load-from-adv.mjs --instance sn187 --slot 78 [--expect SN0000.BIN] [--keep-sidebar]
 */
import {
  SIDEBAR,
  XY,
  binOf,
  cancel,
  forceSidebarLayout,
  globalOf,
  hover,
  pickSlotInSaveScreen,
  readSidebarLayout,
  tap,
  waitBin,
  waitTicking,
} from '../emu.mjs';

/**
 * ★**模式全局** `f7ff0`（场景脚本进 SAVE 画面前 `mov (global-int f7ff0) <v>`）：
 * 实测（2026-09-26，`src/SN0000.txt:589/599` 的两条侧栏入口分别置 0 / 1）：
 *   `f7ff0 == 0` ⇒ **存档**画面；`f7ff0 == 1` ⇒ **读档**画面。
 * 这条是**安全断言**：在存档画面里点槽位会**覆盖**存档 ⇒ 不确认是读档模式就绝不往下点。
 */
const LOAD_MODE_VALUE = 1;

const argOf = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d;
};
const hasFlag = (n) => process.argv.includes(`--${n}`);
const id = argOf('instance');
const slot = Number(argOf('slot'));
const expect = argOf('expect', undefined);
const keepSidebar = hasFlag('keep-sidebar');
if (!id || !Number.isFinite(slot)) {
  console.error('用法：load-from-adv.mjs --instance <id> --slot <0..99> [--expect BIN] [--keep-sidebar]');
  process.exit(2);
}

console.log(`▶ [ops] 从 ADV 侧栏载入槽 ${slot}（实例 ${id}）`);
await waitTicking(id);
const start = await binOf(id);
console.log(`  起跑状态：cur = ${start}`);
if (start === 'TITLE.BIN' || start === 'SAVE.BIN') {
  throw new Error(`本用例要从**游戏内的 ADV 场景**起跑（当前 ${start}）——先用 ops/load-from-title.mjs 进一段剧情`);
}

/** 展开侧栏（悬停折叠条 → 让展开 label 重登记热点）。 */
async function expandSidebar() {
  await hover(id, ...XY.advSidebarStrip, { settleMs: 700 });
}

/** 校验"表真的被写成了固定排布"（写命令可能失败/旧构建不支持）。 */
async function overrideSidebar() {
  if (keepSidebar) {
    console.log('  --keep-sidebar：**不改**侧栏，走候选扫描（不保证找到 LOAD）');
    return false;
  }
  console.log(
    `  ★改侧栏配置（运行期）：global 0x${SIDEBAR.tableGlobal.toString(16)}[0..${SIDEBAR.slots - 1}] ← [${SIDEBAR.FORCED_LAYOUT
      .map((v) => '0x' + v.toString(16))
      .join(', ')}]（第 0 格 SAVE / 第 1 格 LOAD；只改内存，不写回 SAVE.DAT）`,
  );
  try {
    await forceSidebarLayout(id);
  } catch (e) {
    console.log(`  ⚠ 写侧栏表失败（${e.message}）⇒ 退回候选扫描`);
    return false;
  }
  const back = await readSidebarLayout(id);
  const want = SIDEBAR.FORCED_LAYOUT;
  const ok = back.length >= want.length && want.every((v, i) => back[i] === v);
  console.log(`  读回校验：${back.map((v) => '0x' + v.toString(16)).join(' ')} ⇒ ${ok ? '✔ 已按固定排布' : '✗ 与期望不符'}`);
  return ok;
}

/** 确定路径：表已写死 ⇒ 直接点第 1 格（LOAD）。 */
async function openViaFixedSlot(i) {
  const [x, y] = XY.advSidebarButton(i);
  console.log(`  点固定第 ${i} 格（LOAD）@ ${x},${y}`);
  await expandSidebar();
  await hover(id, x, y, { settleMs: 400 });
  await tap(id, x, y, { settleMs: 1300, hoverFirst: false });
  return await waitBin(id, 'SAVE.BIN', { timeoutMs: 12_000 });
}

/** 候选扫描（表没写死时的兜底）：0..8 逐格试，不是存档画面就右键取消再试下一格。 */
async function openViaScan() {
  for (let i = 0; i < XY.ADV_BUTTON_COUNT; i++) {
    const [x, y] = XY.advSidebarButton(i);
    console.log(`  扫描第 ${i} 格 @ ${x},${y}`);
    await expandSidebar();
    await hover(id, x, y, { settleMs: 400 });
    await tap(id, x, y, { settleMs: 1200, hoverFirst: false });
    if (await waitBin(id, 'SAVE.BIN', { timeoutMs: 6000 })) {
      console.log(`  ✔ 第 ${i} 格进入存档/读档画面`);
      return true;
    }
    console.log(`  第 ${i} 格不是存档画面（cur=${await binOf(id)}）⇒ 右键取消，继续`);
    await cancel(id);
    await hover(id, 640, 400, { settleMs: 300 });
  }
  return false;
}

/** 确保当前画面是**读档**模式；不是就先点底部 LOAD 页签切换，仍不是则中止（绝不点槽位）。 */
async function ensureLoadMode() {
  const mode = await globalOf(id, 'f7ff0');
  if (mode === LOAD_MODE_VALUE) return;
  console.log(`  当前是存档模式（f7ff0=${mode}）⇒ 点底部 LOAD 页签切模式 @ ${XY.saveScreen.loadTab.join(',')}`);
  await tap(id, ...XY.saveScreen.loadTab, { settleMs: 1000 });
  const mode2 = await globalOf(id, 'f7ff0');
  if (mode2 !== LOAD_MODE_VALUE) {
    throw new Error(
      `切不到读档模式（f7ff0=${mode2}，期望 ${LOAD_MODE_VALUE}）⇒ 已中止，**没有点任何槽位**` +
        `（在存档画面里点槽位会覆盖存档）。底部页签的坐标是待实测项；也可先用 capture 看画面标题是 SAVE 还是 LOAD。`,
    );
  }
}

const forced = await overrideSidebar();
const opened = forced ? await openViaFixedSlot(SIDEBAR.FORCED_LAYOUT.indexOf(SIDEBAR.ID.LOAD)) : false;
if (!opened) {
  if (forced) console.log('  固定格没进存档画面 ⇒ 退回候选扫描');
  if (!(await openViaScan())) {
    throw new Error(
      '扫完 9 格都没有能打开存档/读档画面的格子：这个场景的侧栏里没有 SAVE/LOAD' +
        '（默认布局就是这样，见 src/INITCHARM.txt:6）⇒ 换一条路径（先用 ops/load-from-title.mjs 从 TITLE 读档），' +
        '或检查写命令是否可用（`set-array`，tickets/T-0189）。',
    );
  }
}
console.log(`  ✔ 已进入存档/读档画面（cur=${await binOf(id)}；侧栏${forced ? '已按固定排布写入' : '走候选扫描'}）`);
await ensureLoadMode();
const r = await pickSlotInSaveScreen(id, slot, { expect });
console.log(`✔ [ops] 已载入槽 ${slot}：cur = ${r.bin}`);
