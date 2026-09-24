#!/usr/bin/env node
/**
 * load-slot.mjs —— **读档固定流程**（把「TITLE → Load Data → 选槽 → 载入」固化成一条命令）。
 *
 * 为什么有它：调试时最常做的一件事是「从某个真机存档起跑」，但那个界面每次都要重新对坐标
 * （`tools/shot.cjs:254-256` 自陈踩过：`--load 78` 只是标记，实际载入列表当前行）。
 * 本脚本把已实测的坐标 + 翻页方式 + 载入判据固定在这里，并对每一步做**可核对的输出**。
 *
 * 用法：
 *   node .agents/skills/amayui-remote-debug/scripts/load-slot.mjs --slot 78
 *   node .agents/skills/amayui-remote-debug/scripts/load-slot.mjs --instance t0103 --slot 78
 *   node .../load-slot.mjs --list                 # 只列活实例与存档目录，不驱动
 *
 * 前置：
 *   1) 目标实例必须**活着且带渲染页**（`--attach-headless` 或有人开着面板），否则 debug-query 503：
 *      cd app/amayui-emulator && node --import tsx src/web/host.ts --instance <id> --port 0 --attach-headless --idle-sec 0
 *   2) 槽文件要能被该实例的文件源看到（overlay → base）：
 *      <repo>/.tmp/instances/<id>/{overlay,base}/SAVE/SAVE<NN>.DAT（槽号两位；见 src/arch/systemPaths.ts）
 *
 * 坐标口径（**debug-query 的虚拟坐标 = capture 的 1280×720 像素坐标**，2026-09-24 实测）：
 *   · TITLE 菜单第 1 项 Load Data      : (1070, 480)      ← src/TITLE.txt:100 的 i12e 命中盒算出
 *   · 存档列表 · 页号按钮「N0」(N=0..9) : (606 + 42*N, 30)（像素扫描绿高亮：页 0 → x606、页 70 → x900，步长 42.0）
 *   · 存档列表 · 第 i 行（0..9）        : y = 90 + 60*i（行分隔带实测 64/124/184/…/604 ⇒ 行中心 90/150/…/630；实点 y570 ⇒ 槽 078）
 *   · 左下「LOAD」按钮                  : (145, 686)（像素扫描：绿钮 x114..176 / y672..700）
 *   · 确认框「是」                      : (636, 321)
 *   ★**不要用左右大箭头翻页**：实测点 (41,359)/(1238,359) 不翻页（页高亮不动）；页号按钮一击到位。
 *
 * 判据：载入完成后日志（`<repo>/.tmp/instances/<id>/log/amayui-emulator.log`）出现 `[slot-load]`。
 *   ★日志里**没有槽号**（引擎 §0x1A0 只回结果码）⇒ 脚本无法自动核对"载入的是不是目标槽"；
 *     要核内容指纹请用缩略图（`src/tools/slotThumbPng.ts <SAVE<NN>.STH> out.png`）或 capture 看画面。
 *
 * 退出码：0 = 已载入（日志判据通过）；1 = 参数/实例/起跑状态问题；2 = 载入未发生（日志无 `[slot-load]`）。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// ---------- 坐标表（改这里就是改流程） ----------
const XY = {
  loadData: [1070, 480],
  /** 存档列表第 `tens` 个页号按钮（= 第 tens 个百页）的中心；实测：页 0 → x606、页 70 → x900，步长 42.0（像素扫描绿高亮）。 */
  pageButton: (tens) => [606 + 42 * tens, 30],
  loadButton: [145, 686],
  confirmYes: [636, 321],
  rowX: 400,
  /** 列表第 i 行（0..9）的 y；由行分隔带实测（64/124/184/…/604 ⇒ 行中心 90/150/…/630）并与实点核对过（y570 ⇒ 槽 078）。 */
  rowY: (i) => 90 + 60 * i,
};

function argOf(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt;
}
const hasFlag = (n) => process.argv.includes(`--${n}`);

const REPO = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const TMP = path.join(REPO, '.tmp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 实例发现与驱动 ----------
async function instances() {
  try {
    const r = await fetch('http://127.0.0.1:3080/dsh-emulator/api/__instances');
    return (await r.json()).instances ?? [];
  } catch (e) {
    console.error(`✗ 拿不到实例列表（DSH 插件没起来？）：${e.message}`);
    process.exit(1);
  }
}

/** ★`args` 是**一条完整命令串**（`"click 1070 480"`），不是分词数组 —— 见 SKILL.md §3。 */
async function dq(base, args) {
  const r = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ args: [args] }),
  });
  if (!r.ok) throw new Error(`debug-query HTTP ${r.status}`);
  const j = await r.json();
  if (j.ok === false) throw new Error(`debug-query 拒绝：${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

const click = async (base, [x, y], settle = 260) => {
  await dq(base, `click ${x} ${y}`);
  await sleep(settle);
};
const curScript = async (base) => {
  const j = await dq(base, 'frame');
  const l = (j.lines || []).find((x) => x.includes('←cur')) || '';
  const m = l.match(/\]\s+(\S+)\s/);
  return m ? m[1] : '?';
};
async function waitFor(base, want, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    const c = await curScript(base);
    if (c === want) return true;
    if (Date.now() - t0 > timeoutMs) return false;
    await sleep(600);
  }
}

/** 等日志里出现 needle（用于「载入完成」这种没有 VM 可查的判据）。
 *  ★按**行号**切尾，不按字节偏移：日志是 UTF-8 中文，字节数 ≠ 字符数（踩过：slice(byteOffset) 切过头 ⇒ 永远看不到标记）。 */
async function waitLog(logPath, needle, fromLine, timeoutMs) {
  const read = () => {
    try {
      return fs.readFileSync(logPath, 'utf8').split('\n');
    } catch {
      return [];
    }
  };
  const t0 = Date.now();
  for (;;) {
    const hit = read().slice(fromLine).filter((l) => l.includes(needle));
    if (hit.length > 0) return hit;
    if (Date.now() - t0 > timeoutMs) return null;
    await sleep(500);
  }
}

// ---------- 主流程 ----------
const list = await instances();
if (hasFlag('list') || list.length === 0) {
  console.log(`活实例（${list.length}）：`);
  for (const i of list) console.log(`  · ${i.id}  port=${i.port} bin=${i.bin} frames=${i.frames} viewers=${i.viewers}`);
  console.log(`存档根（真机）：%LOCALAPPDATA%\\Eushully\\天結いキャッスルマイスター\\SAVE`);
  console.log(`实例可见的槽目录：<repo>/.tmp/instances/<id>/{base,overlay}/SAVE/（缺槽就先拷过去）`);
  process.exit(list.length === 0 ? 1 : 0);
}

const id = argOf('instance', list.length === 1 ? list[0].id : null);
const inst = list.find((x) => x.id === id);
if (!inst) {
  console.error(`✗ 没有实例 ${id}；活着的：${list.map((x) => x.id).join(', ') || '（无）'}`);
  process.exit(1);
}
if (!inst.viewers || inst.viewers < 1) {
  console.error(`✗ 实例 ${id} 没有渲染页（viewers=${inst.viewers ?? 0}）⇒ debug-query 会 503；用 --attach-headless 重起它`);
  process.exit(1);
}

const slot = Number(argOf('slot', NaN));
if (!Number.isInteger(slot) || slot < 0 || slot > 99) {
  console.error('✗ 需要 --slot <0..99>');
  process.exit(1);
}

const base = `http://127.0.0.1:3080/dsh-emulator/${id}/api/debug-query`;
const logPath = path.join(TMP, 'instances', id, 'log', 'amayui-emulator.log');
const logBefore = (() => {
  try {
    return fs.readFileSync(logPath, 'utf8').split('\n').length;
  } catch {
    return 0;
  }
})();

console.log(`▶ 实例 ${id}（port=${inst.port}，viewers=${inst.viewers}）→ 载入槽 ${slot}`);

// ① 起跑状态：TITLE（点 Load Data 进列表）或**已经在 SAVE.BIN**（直接接着用）
const cur0 = await curScript(base);
if (cur0 === 'SAVE.BIN') {
  console.log('  当前已在存档列表（SAVE.BIN）⇒ 跳过点 Load Data');
} else if (cur0 === 'TITLE.BIN') {
  await click(base, XY.loadData, 900);
  if (!(await waitFor(base, 'SAVE.BIN', 20000))) {
    console.error('✗ 点了 Load Data 但没进 SAVE.BIN');
    process.exit(1);
  }
  await sleep(1800); // 列表画出来
} else {
  console.error(`✗ 当前 cur=${cur0}，既不是 TITLE.BIN 也不是 SAVE.BIN —— 本流程从标题画面起跑；请先重启实例（同 id 会拒绝并行）`);
  process.exit(1);
}

// ② 直接点目标「百」页的页号按钮（**不要**用左右大箭头：实测 (41,359)/(1238,359) 点了不翻页）
const tens = Math.floor(slot / 10);
await click(base, XY.pageButton(tens), 900);
await sleep(600);
console.log(`  翻页：点页号按钮「${tens}0」@ ${XY.pageButton(tens).join(',')} ⇒ 期望显示 ${String(tens).padStart(2, '0')}0..${String(tens).padStart(2, '0')}9`);

// ③ 选行 → LOAD → 确认
const ones = slot % 10;
await click(base, [XY.rowX, XY.rowY(ones)], 700);
console.log(`  选行：第 ${ones} 行 (y=${XY.rowY(ones)})`);
await click(base, XY.loadButton, 900);
await sleep(600);
await click(base, XY.confirmYes, 900);

// ④ 判据：日志出现 [slot-load]
const lines = await waitLog(logPath, '[slot-load]', logBefore, 25000);
if (!lines) {
  console.error('✗ 25s 内日志没有 [slot-load]：载入没发生（槽为空？页码不对？槽文件不在实例可见目录？）');
  process.exit(2);
}
console.log('✔ 已载入（日志判据 [slot-load]）：');
for (const l of lines) console.log('   ' + l.trim().slice(0, 220));

// ⑤ 载入后回落到哪个脚本（给调用者一个立刻可用的观测量）
await sleep(2500);
console.log(`  载入后 cur = ${await curScript(base)}`);
console.log(`  ★核对槽号：日志里没有槽号字段（引擎 §0x1A0 只回结果码），所以「载入的是不是目标槽」要用内容指纹核：`);
console.log(`    · 真机槽文件的缩略图/帧链：node app/amayui-emulator/src/tools/slotThumbPng.ts <SAVE${slot}.STH> out.png`);
console.log(`    · 或直接 capture 看画面（debug-query: {"args":["capture"]}）`);
process.exit(0);
