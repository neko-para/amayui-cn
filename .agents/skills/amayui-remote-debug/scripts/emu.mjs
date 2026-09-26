#!/usr/bin/env node
/**
 * emu.mjs —— **调试实例的核心驱动**（原语库 + 原语 CLI）。
 *
 * ## 它是什么、不是什么
 * - **是**：与实例打交道的那一层薄而稳的原语 —— 发现实例 / 发 debug-query / 读帧与全局 /
 *   合成"能真的点动菜单"的点击 / 等条件 / 收日志 / 起停实例（含 `reset`）/ 抓帧 / 读引擎态快照。
 * - **不是**：任何"某个界面上要做的一串操作"。那类东西一律放 `ops/*.mjs`（一个用例一个文件，
 *   索引见 `ops/README.md`）—— 这样"现在有哪些可用的操作脚本"永远是一眼能看完的一张表。
 *
 * ```bash
 * node .agents/skills/amayui-remote-debug/scripts/emu.mjs status   --instance t0103
 * node .agents/skills/amayui-remote-debug/scripts/emu.mjs reset    --instance t0103     # 重启并等回 TITLE
 * node .agents/skills/amayui-remote-debug/scripts/emu.mjs probe    --instance t0103     # 关键引擎态（色/门/链）
 * node .agents/skills/amayui-remote-debug/scripts/emu.mjs --help
 * ```
 *
 * ## 被实测钉死的四条原语纪律（踩过才写下来的，别绕开）
 * 1. ★**菜单/侧栏类目标要"两帧点击"**（`tap()`）：一次注入 `cursor+press+release` **不激活**
 *    （实测：ADV 侧栏 LOAD 按钮、SAVE 画面底部按钮都点不动；`load-slot.mjs` 的 `click` 只对
 *    TITLE 的第 1 层菜单有效）。`tap()` = `move`（先到旁边再到位，产生 hover）→ `press`
 *    → 停 **≥120ms（≥2 帧）** → `release`。
 * 2. ★**悬停靠"位置变化"**：`InputManager` 只在坐标真的变了才做命中测试 ⇒ 同一点重复 `move` 无效。
 * 3. ★**"视觉展开 ≠ 逻辑展开"**（`tickets/T-0028`）：ADV 侧栏可以看起来已经展开、但热点仍是折叠态
 *    （点它什么也不发生）。必须先悬停**折叠条**（矩形 1230,233..1280,493）让展开 label 跑一遍，
 *    热点才会被重登记。
 * 4. ★**所有读态都要能容忍瞬时不可用**：实例刚起 / 正在装载时 `snapshot` 会拒（"没等到帧边界"）、
 *    没有渲染页时 `debug-query` 会 503 ⇒ `dq()` 内置重试，`waitReady()` 先等帧循环在跑。
 *
 * ## 与插件/宿主的关系
 * - 命令面走 DSH 插件的**每实例路由** `POST /dsh-emulator/<id>/api/debug-query`（不需要端口号）；
 * - 实例发现优先走插件 `GET /dsh-emulator/api/__instances`（带活/死判定），
 *   插件不在时退化为读注册表 `.tmp/instances/<id>/instance.json`（心跳龄自己算）；
 * - `start/stop/reset` 自己 spawn/杀宿进程（与插件 `lib/tools.js:456-465` 同一套参数：
 *   `--import tsx src/web/host.ts --instance <id> --port 0 --idle-sec 0 --attach-headless` + `AMAYUI_AUDIO_ENABLED=0`
 *   + `detached`），所以**不依赖插件在线**也能 reset。
 *
 * ## ★"谁来当渲染页"不是这一层的事（重要）
 * 这一层只发命令、读结果 —— **不模拟设备、不起自己的浏览器页、不用 playwright/puppeteer**。
 * VM 活在渲染页里：要么宿主的无头页（`--attach-headless`），要么人打开的面板页。
 * 本机实测：**无头页会起一个死一个**（宿主日志 `无头渲染页退出 code=4294967295`）⇒ 实际在跑的是
 * DSH 面板那一页。**面板被收起/切走时 Chromium 会节流 rAF，VM 帧循环停摆**（症状：`snapshot` 报
 * "没等到帧边界"）。所以本脚本把这两种"没有可用渲染页"的情形**分开报**（见 `diagnose()`），
 * 而不是假装成功 —— 修法是设备侧的事：把面板那一页调回前台，或用插件重起该实例。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

export const REPO = path.resolve(import.meta.dirname, '..', '..', '..', '..');
export const TMP = path.join(REPO, '.tmp');
export const PLUGIN = 'http://127.0.0.1:3080/dsh-emulator';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 心跳龄超过它就当记录过期（宿主每 5s 写一次）。 */
export const HEARTBEAT_STALE_MS = 20_000;

// ---------------------------------------------------------------------------
// 坐标表（存档列表画面；改这里就是改流程）—— 实测口径见 load-slot.mjs 头部的像素扫描记录
// ---------------------------------------------------------------------------
export const XY = {
  /** TITLE 菜单第 1 项 Load Data（`src/TITLE.txt:100` 的 i12e 命中盒算出）。 */
  loadData: [1070, 480],
  /** 列表页号按钮「N0」的中心：页 0 → x606、页 70 → x900，步长 42.0。 */
  pageButton: (tens) => [606 + 42 * tens, 30],
  /** 左下 LOAD 按钮（绿钮 x114..176 / y672..700）。 */
  loadButton: [145, 686],
  /** 确认框「是」。 */
  confirmYes: [636, 321],
  rowX: 400,
  /** 列表第 i 行的 y（行中心 90/150/…/630；实点 y570 ⇒ 槽 078 已核对）。 */
  rowY: (i) => 90 + 60 * i,
  /** ADV 右侧**折叠**侧栏的热点条（矩形 1230,233-1280,493 的中心）—— 悬停它才展开。 */
  advSidebarStrip: [1255, 363],
  /** ADV 展开侧栏里各按钮的**中心**（rect 起点 y=114/164/214…，h=47、步长 50，来自 `src/SN0000.txt:54-62` 的 i090）。
   *  ★**位置不固定**：侧栏内容是可配置的（默认布局里甚至没有 SAVE/LOAD）⇒ 调用方不许把"第 i 个 = 某功能"
   *  写死；`ops/load-from-adv.mjs` 用**候选扫描 + 模式断言**找按钮，并且跑之前会把 `cache/SAVE.DAT`
   *  放进实例（见 `stagePlayerData`），让布局可复现。 */
  advSidebarButton: (i) => [1220, 137 + 50 * i],
  /** 侧栏候选按钮的扫描上限（9 格：0..8）。 */
  ADV_BUTTON_COUNT: 9,
  /** SAVE/LOAD 画面底部那一行（左起 SAVE / LOAD 两个页签；★坐标待实测复核）。 */
  saveScreen: { saveTab: [66, 694], loadTab: [132, 694], back: [1219, 700] },
};

// ---------------------------------------------------------------------------
// 实例发现 / 存活
// ---------------------------------------------------------------------------
/** 插件视角的活实例列表（插件不在线 ⇒ 退化为注册表扫描）。 */
export async function listInstances() {
  try {
    const r = await fetch(`${PLUGIN}/api/__instances`);
    const j = await r.json();
    if (Array.isArray(j.instances)) {
      // ★插件回执里**没有** `live`/`pid`（只有 `heartbeatAt` 与 `staleMs`）⇒ 这里自己归一化，
      //   否则所有实例都会被当成"死"的（实测踩过：`status` 全打 ○）。
      const staleMs = Number(j.staleMs ?? HEARTBEAT_STALE_MS);
      return j.instances.map((x) => {
        const age = x.heartbeatAt ? Date.now() - Number(x.heartbeatAt) : NaN;
        return { ...x, heartbeatAgeMs: age, live: x.live ?? (Number.isFinite(age) ? age < staleMs : false) };
      });
    }
  } catch {
    /* 插件不在线：走注册表 */
  }
  return scanRegistry();
}

/** 直接扫 `<.tmp>/instances/<id>/instance.json`（心跳龄自己算；插件不在线时的兜底）。 */
export function scanRegistry() {
  const root = path.join(TMP, 'instances');
  const out = [];
  let names = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return out;
  }
  for (const id of names) {
    const f = path.join(root, id, 'instance.json');
    if (!fs.existsSync(f)) continue;
    try {
      const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
      const age = Date.now() - Number(rec.heartbeatAt ?? rec.startedAt ?? 0);
      out.push({
        id,
        port: rec.port,
        pid: rec.pid,
        live: age < HEARTBEAT_STALE_MS,
        heartbeatAgeMs: age,
        bin: rec.lastStatus?.bin,
        frames: rec.lastStatus?.frames,
        gate: rec.lastStatus?.gate,
      });
    } catch {
      /* 半个记录：跳过 */
    }
  }
  return out;
}

export function instanceDir(id) {
  return path.join(TMP, 'instances', id);
}
export function logFile(id) {
  return path.join(instanceDir(id), 'log', 'amayui-emulator.log');
}

/** 解析 `--instance`：给了就用，没给且只有一个活实例就自动选（并打印选了谁）。 */
export async function resolveInstance(id) {
  const all = await listInstances();
  if (id) {
    const rec = all.find((x) => x.id === id);
    if (!rec) throw new Error(`没有实例 ${id}；活着的：${all.filter((x) => x.live).map((x) => x.id).join(', ') || '（无）'}`);
    return rec;
  }
  const live = all.filter((x) => x.live);
  if (live.length === 1) {
    console.log(`（未给 --instance ⇒ 用唯一活实例 ${live[0].id}）`);
    return live[0];
  }
  throw new Error(`--instance 必给（当前活实例 ${live.length} 个：${live.map((x) => x.id).join(', ') || '无'}）`);
}

export async function isLive(id) {
  const all = await listInstances();
  return Boolean(all.find((x) => x.id === id && x.live));
}

// ---------------------------------------------------------------------------
// debug-query（含瞬时失败重试）
// ---------------------------------------------------------------------------
/** 瞬时故障的特征：没有渲染页(503) / 快照没等到帧边界 —— 都可以重试。 */
const TRANSIENT = /没有渲染页|HTTP 503|没等到帧边界|HTTP 504/;

/**
 * 发一条 debug-query 命令。`args` 是**一条完整命令串**（`"click 1070 480"`）。
 * @returns {{lines: string[]}} 插件回执（`ok:false` 会抛，瞬时故障按 `retries` 重试）。
 */
export async function dq(id, cmd, { retries = 3, gapMs = 400, timeoutMs = 30_000 } = {}) {
  let last;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(`${PLUGIN}/${id}/api/debug-query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ args: [cmd] }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const j = await r.json().catch(() => null);
      const text = JSON.stringify(j ?? {});
      if (j && j.ok !== false) return j;
      last = new Error(text.slice(0, 200));
      if (!TRANSIENT.test(text)) throw last;
    } catch (e) {
      last = e;
      if (!TRANSIENT.test(String(e.message))) {
        if (i >= retries) throw e;
      }
    }
    if (i < retries) await sleep(gapMs);
  }
  throw last ?? new Error('debug-query 失败');
}

/** 等帧循环真的在跑（刚起的实例会先没有渲染页 / 还没进帧边界）。 */
export async function waitReady(id, { timeoutMs = 90_000, intervalMs = 1000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    try {
      await dq(id, 'frame', { retries: 0, timeoutMs: 8000 });
      return true;
    } catch (e) {
      if (Date.now() - t0 > timeoutMs) throw new Error(`waitReady(${id}) 超时：${e.message}`);
      await sleep(intervalMs);
    }
  }
}

/**
 * **实例可用性分类**（把"没有渲染页"与"页面在但帧循环停摆"分开 —— 两者的修法不同）。
 * `state`：`ticking`（可驱动）/ `no-viewer`（503）/ `stalled`（帧边界等不到）/ `missing` / `error`。
 */
export async function diagnose(id) {
  const all = await listInstances();
  const rec = all.find((x) => x.id === id);
  if (!rec) return { state: 'missing' };
  const viewers = rec.viewers ?? null;
  try {
    const p = await probeOf(id);
    return { state: 'ticking', viewers, probe: p };
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (/没有渲染页|HTTP 503/.test(msg)) return { state: 'no-viewer', viewers, error: msg };
    if (/没等到帧边界/.test(msg)) return { state: 'stalled', viewers, error: msg };
    return { state: 'error', viewers, error: msg };
  }
}

/** 给人看的一句话诊断（含修法；修法都在设备侧，不在这层）。 */
export function explainDiagnosis(id, d) {
  switch (d.state) {
    case 'missing':
      return `实例 ${id} 不在注册表里（没起？跑 emu.mjs status 看有哪些）`;
    case 'no-viewer':
      return `实例 ${id} 现在**没有渲染页**（viewers=${d.viewers ?? 0}）⇒ debug-query 必然 503。` +
        `修法：用插件 action=start 重起（带 --attach-headless），或在 DSH 面板里选中该实例让页面挂上去。`;
    case 'stalled':
      return `实例 ${id} 的页面在（viewers=${d.viewers ?? 0}）但**帧循环停摆**（snapshot 报"没等到帧边界"）` +
        `——多半是面板那一页被收起/切走、被 Chromium 节流了 rAF。` +
        `修法：把该实例的面板页调回前台（保持可见），或用插件重起该实例。`;
    default:
      return `实例 ${id} 读态失败：${d.error}`;
  }
}

/** 等实例**可驱动**（有渲染页 **且** 帧循环在跑）。用例脚本开跑前必须过这一关。 */
export async function waitTicking(id, { timeoutMs = 60_000, intervalMs = 1500 } = {}) {
  const t0 = Date.now();
  let d = await diagnose(id);
  while (d.state !== 'ticking') {
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`waitTicking(${id}) 超时：${explainDiagnosis(id, d)}`);
    }
    await sleep(intervalMs);
    d = await diagnose(id);
  }
  return d.probe;
}

// ---------------------------------------------------------------------------
// 读态
// ---------------------------------------------------------------------------
/** 当前帧链：`{cur, bin, frames:[{name, ip, scriptId, caller}], raw}`。 */
export async function frameOf(id) {
  const j = await dq(id, 'frame', { retries: 2 });
  const lines = j.lines ?? [];
  const cur = Number((lines[0]?.match(/cur=(\d+)/) ?? [])[1] ?? -1);
  const frames = [];
  for (const l of lines) {
    const m = l.match(/\[(\d+)\]\s+(\S+)\s+scriptId=0x([0-9a-f]+)\s+ip=(\d+)\/(\d+)\s+caller=(-?\d+)/);
    if (m) frames.push({ idx: Number(m[1]), name: m[2], scriptId: parseInt(m[3], 16), ip: Number(m[4]), ipMax: Number(m[5]), caller: Number(m[6]) });
  }
  const bin = (lines.find((l) => l.includes('←cur'))?.match(/\]\s+(\S+)\s/) ?? [])[1] ?? frames.find((f) => f.idx === cur)?.name ?? '?';
  return { cur, bin, frames, raw: lines.join('\n') };
}

export const binOf = async (id) => (await frameOf(id)).bin;

/** 读脚本全局 int（`hex` = 引擎口径的下标，如 `f7ff0`）。 */
export async function globalOf(id, hex) {
  const j = await dq(id, `global ${hex}`, { retries: 2 });
  const txt = (j.lines ?? []).join('\n');
  const m = txt.match(/=\s*(-?\d+)/) ?? txt.match(/(-?\d+)/);
  return m ? Number(m[1]) : NaN;
}

export async function globalsOf(id, keys) {
  const out = {};
  for (const k of keys) out[k] = await globalOf(id, k);
  return out;
}

/** 引擎态快照（**大**：池 + 帧链 + 引擎字段 + 文本项；要小读数用 `probeOf`）。 */
export async function snapshotOf(id) {
  const j = await dq(id, 'snapshot', { retries: 4, timeoutMs: 60_000 });
  const line = (j.lines ?? []).find((l) => l.trim().startsWith('{'));
  if (!line) throw new Error(`snapshot 回执里没有 JSON：${(j.lines ?? []).join(' ').slice(0, 200)}`);
  return JSON.parse(line);
}

/** 关键引擎态（`§4.2 读 VM 真值` 的常用几格）——小、快、够用来判"文字颜色/▼ 武装/帧链"。 */
export async function probeOf(id) {
  const s = await snapshotOf(id);
  const val = (k) => (s.engineValues ?? []).find((p) => p[0] === k)?.[1];
  const bgrToRgb = (v) => ((v & 0xff) << 16) | (v & 0xff00) | ((v >>> 16) & 0xff);
  const hex = (v) => (v === undefined ? null : `#${(bgrToRgb(v) >>> 0).toString(16).padStart(6, '0')}`);
  const frames = s.frames ?? [];
  return {
    at: s.header?.at,
    cur: s.cur,
    chain: frames.map((f) => `${f.name}:${f.ip}`).join(' > '),
    /** 引擎时钟（`Engine[92333]`，ms）—— **实例新鲜度**的判据：刚起的实例只应有几十秒。 */
    clockMs: val(92333),
    effectFlags: (s.gates?.effectFlags ?? 0) >>> 0,
    /** 0x40000000 = 逐字/▼ 武装（bit30）。 */
    charRevealArmed: ((s.gates?.effectFlags ?? 0) & 0x40000000) !== 0,
    /** 0x80000000 = 等玩家推进的等待门。 */
    awaitingAdvance: ((s.gates?.effectFlags ?? 0) & 0x80000000) !== 0,
    fillRaw: val(21664),
    fill: hex(val(21664)),
    outlineRaw: val(21665),
    charCursor: val(107704),
    charModulus: val(107705),
    textItemCount: (s.textItems?.records ?? []).length,
  };
}

// ---------------------------------------------------------------------------
// 输入原语（见文件头 §1/§2/§3）
// ---------------------------------------------------------------------------
export async function hover(id, x, y, { settleMs = 400, fromX = x - 2 } = {}) {
  if (fromX !== x) await dq(id, `move ${fromX} ${y}`);
  await dq(id, `move ${x} ${y}`);
  await sleep(settleMs);
}

/**
 * **ADV 侧栏（charm 表）排布**：`global 13b0[0..8]` 的 9 项动作 id（`tickets/T-0189`）。
 *
 * - 语义：`1` = MENU、`0xd` = SAVE、`0xe` = LOAD（其余 id 见 `src/SN0000.txt` 的派发链）；
 * - **默认布局里没有 SAVE/LOAD**（`src/INITCHARM.txt:6` = `[1 b c 2 3 4 5 6 7]`）；
 * - 玩家排布存在 `SAVE.DAT` 里（`CHARMEDIT` 改的就是它）⇒ **用例不许假设位置**；
 * - 派发是**点击时**读表（`src/SN0000.txt:401`）⇒ 测试期可以在点击前把它写死（`forceSidebarLayout`）。
 */
export const SIDEBAR = {
  tableGlobal: 0x13b0,
  slots: 9,
  ID: { MENU: 0x1, SAVE: 0xd, LOAD: 0xe },
  /** 测试期固定排布：SAVE / LOAD 放到第 0 / 1 格，其余沿用默认（`1 b c 2 3 4 5 6 7` 里去掉已用的）。 */
  FORCED_LAYOUT: [0xd, 0xe, 1, 0xb, 0xc, 2, 3, 4, 5],
};

/** 写一个**脚本全局 int**（`set-global <下标> <值>`；下标/值按命令行口径：`0x…` 或含 a-f = 十六进制）。 */
export async function setGlobal(id, index, value) {
  const j = await dq(id, `set-global ${hexTok(index)} ${value}`, { retries: 2 });
  return (j.lines ?? []).join('\n');
}

/** 写一个**全局数组元素**（`set-array <基址> <元素下标> <值>`；数组 = 连续全局槽）。 */
export async function setArray(id, base, index, value) {
  const j = await dq(id, `set-array ${hexTok(base)} ${index} ${value}`, { retries: 2 });
  return (j.lines ?? []).join('\n');
}

export const hexTok = (n) => `0x${(n >>> 0).toString(16)}`;

/**
 * **把 ADV 侧栏定死成固定排布**（`tickets/T-0189` 的 H2；`ops/load-from-adv.mjs` 开跑前自动调用）。
 *
 * ★只改**运行期内存**（emu 侧按 ENC 写脚本全局池），**不写回 `SAVE.DAT`** ⇒ 玩家数据不受影响；
 *   但**效果是改了侧栏配置**（本实例当次运行内），所以调用方必须在输出里明确声明。
 * 返回逐项回执行，便于进日志/证据。
 */
export async function forceSidebarLayout(id, layout = SIDEBAR.FORCED_LAYOUT) {
  const lines = [];
  for (let i = 0; i < layout.length; i++) {
    lines.push(await setArray(id, SIDEBAR.tableGlobal, i, layout[i]));
  }
  return lines;
}

/** 读回侧栏表（校验用）：逐项 `global 13b0+i`。 */
export async function readSidebarLayout(id, slots = SIDEBAR.slots) {
  const out = [];
  for (let i = 0; i < slots; i++) out.push(await globalOf(id, (SIDEBAR.tableGlobal + i).toString(16)));
  return out;
}

/**
 * **两帧点击**：菜单/侧栏/底部按钮都要它（一次注入 cursor+press+release 不激活）。
 * `move → press → 停 holdMs(≥120ms) → release`。`button='right'` 用来**取消/返回**（引擎的取消路由）。
 */
export async function tap(id, x, y, { holdMs = 180, settleMs = 700, hoverFirst = true, button = 'left' } = {}) {
  const btn = button === 'right' ? ' right' : '';
  if (hoverFirst) {
    await dq(id, `move ${x - 2} ${y}`);
    await sleep(120);
  }
  await dq(id, `move ${x} ${y}`);
  await sleep(120);
  await dq(id, `press ${x} ${y}${btn}`);
  await sleep(holdMs);
  await dq(id, `release ${x} ${y}${btn}`);
  await sleep(settleMs);
}

/** 右键取消（面板/子界面的通用退出口；引擎把右键交给取消路由）。 */
export async function cancel(id, { settleMs = 900 } = {}) {
  await tap(id, 640, 360, { settleMs, hoverFirst: false, button: 'right' });
}

/** 抓一帧到 `.tmp/emudbg/<out>`（PNG 由宿主直写；回执不含图像数据）。 */
export async function capture(id, out) {
  const cmd = out ? `capture ${out}` : 'capture';
  const j = await dq(id, cmd, { retries: 2 });
  const m = (j.lines ?? []).join('\n').match(/(\S+\.png)/);
  const rel = m ? m[1] : null;
  return { rel, abs: rel ? path.join(REPO, rel) : null, lines: j.lines ?? [] };
}

// ---------------------------------------------------------------------------
// 等条件
// ---------------------------------------------------------------------------
export async function waitBin(id, want, { timeoutMs = 30_000, intervalMs = 500 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const bin = await binOf(id);
    if (bin === want) return true;
    if (Date.now() - t0 > timeoutMs) return false;
    await sleep(intervalMs);
  }
}

/** 读日志（按需 tail）。 */
export function readLog(id, { tail } = {}) {
  try {
    const lines = fs.readFileSync(logFile(id), 'utf8').split(/\r?\n/);
    return tail ? lines.slice(-tail) : lines;
  } catch {
    return [];
  }
}

/** 当行数（做"这条日志是本次动作产生的"游标用）。 */
export function logCursor(id) {
  return readLog(id).length;
}

/** 等**本次动作之后**才出现的日志行（`since` = `logCursor()` 的返回值）。 */
export async function waitLog(id, needle, { since = 0, timeoutMs = 30_000, intervalMs = 300 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const lines = readLog(id).slice(since).filter((l) => l.includes(needle));
    if (lines.length) return lines;
    if (Date.now() - t0 > timeoutMs) return null;
    await sleep(intervalMs);
  }
}

export function lastSlotLoad(id) {
  const lines = readLog(id).filter((l) => l.includes('[slot-load] 真槽装载'));
  return lines.at(-1) ?? null;
}

// ---------------------------------------------------------------------------
// 存档列表画面：选槽 → 载入（**两个 ops 共用的那一段 UI 流程**）
// ---------------------------------------------------------------------------
/**
 * 在**已经打开的 SAVE/LOAD 画面**上选槽并载入（这是"UI 原语"，不是用例；
 * "从哪个界面打开这张画面"由 `ops/*.mjs` 负责）。
 *
 * @param expect 可选：载入后应出现的 bin 名（出现在帧链里即算过）。
 */
export async function pickSlotInSaveScreen(id, slot, { expect, timeoutMs = 45_000 } = {}) {
  const before = logCursor(id);
  const tens = Math.floor(slot / 10);
  const ones = slot % 10;
  const rowIdx = ones; // 页内行号（0 基）：`global 138e`（SAVE.txt:11 载入的那一格）
  console.log(`  选槽：点页号按钮「${tens}0」@ ${XY.pageButton(tens).join(',')}`);
  await tap(id, ...XY.pageButton(tens), { settleMs: 700 });
  console.log(`  选行：第 ${ones} 行 (y=${XY.rowY(ones)})`);
  // ★选行要**核对 + 重试**：`global 138e` = 页内行号（0 基），实测它会跟着选中行变
  //   （2026-09-26：点 y=678 ⇒ 138e=7 ⇒ 对话框里是槽 077）。对不上就再点一次，
  //   免得"点了但没选中"一路走到 LOAD 才发现（那时对话框问的是别的槽，最坏会覆盖存档）。
  let rowOk = false;
  for (let attempt = 1; attempt <= 3 && !rowOk; attempt++) {
    await tap(id, XY.rowX, XY.rowY(ones), { settleMs: 700 });
    const sel = await globalOf(id, '138e').catch(() => NaN);
    rowOk = sel === rowIdx;
    console.log(`    第 ${attempt} 次点行 ⇒ global 138e = ${sel}（期望 ${rowIdx}）${rowOk ? ' ✔' : ' ↻'}`);
  }
  if (!rowOk) throw new Error(`三次都没选中第 ${ones} 行（global 138e 对不上）—— 别继续（LOAD 会问别的槽）`);
  console.log('  点 LOAD');
  await tap(id, ...XY.loadButton, { settleMs: 900 });
  // ★确认「是」：对话框出现有延迟，而**在哪个槽上确认**由 138e 决定 ⇒ 这里按"最多点 3 次、
  //   直到日志出现 [slot-load]"来收口（点空 = 无事发生，不是危险操作；真正的危险是选错行，上面已核对）。
  //   只按一次是旧口径，实测会撞上"对话框还没出现 ⇒ 点了空 ⇒ 45s 超时"（2026-09-26）。
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`  确认「是」@ ${XY.confirmYes.join(',')}（第 ${attempt} 次）`);
    await tap(id, ...XY.confirmYes, { settleMs: 700, hoverFirst: false });
    if (await waitLog(id, '[slot-load]', { since: before, timeoutMs: attempt === 3 ? timeoutMs : 5000 })) break;
  }
  const hit = await waitLog(id, '[slot-load]', { since: before, timeoutMs: 1000 });
  if (!hit) {
    throw new Error(
      `点了载入但 ${timeoutMs}ms 内日志没有 [slot-load]（槽空？页码不对？槽文件不在实例可见目录？见 T-0185 的"首跑失败"一节）`,
    );
  }
  for (const l of hit) console.log('   ' + l.trim().slice(0, 200));
  if (expect) {
    const ok = await waitBin(id, expect, { timeoutMs });
    if (!ok) throw new Error(`载入后 ${timeoutMs}ms 内没看到 ${expect}（当前 ${await binOf(id)}）`);
    console.log(`  ✔ 帧链已到 ${expect}`);
  }
  return { slot, log: hit, bin: await binOf(id) };
}

// ---------------------------------------------------------------------------
// 起 / 停 / reset（自己 spawn，不依赖插件在线）
// ---------------------------------------------------------------------------
export function readRecord(id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(instanceDir(id), 'instance.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 起一个实例（参数与插件 `lib/tools.js:456-465` 一致：`--port 0 --idle-sec 0 --attach-headless`
 * + `AMAYUI_AUDIO_ENABLED=0` + `detached`）。返回 `{pid, logPath}`；**不**等 TITLE（用 `waitTitled`）。
 */
export function startInstance(id, { idleSec = 0, headless = true, extraArgs = [] } = {}) {
  const appDir = path.join(REPO, 'app', 'amayui-emulator');
  const outDir = path.join(TMP, 'emudbg');
  fs.mkdirSync(outDir, { recursive: true });
  const logPath = path.join(outDir, `${id}.log`);
  const argv = ['--import', 'tsx', 'src/web/host.ts', '--instance', id, '--port', '0', '--idle-sec', String(idleSec)];
  if (headless) argv.push('--attach-headless');
  argv.push(...extraArgs);
  const out = fs.openSync(logPath, 'a');
  const child = spawn(process.execPath, argv, {
    cwd: appDir,
    env: { ...process.env, AMAYUI_AUDIO_ENABLED: '0' },
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  child.unref();
  fs.closeSync(out);
  return { pid: child.pid, logPath };
}

/** 进程是否还在（Windows 上 `kill(pid,0)` 对已退出的进程抛 ESRCH）。 */
export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 停一个实例（SIGTERM → 宽限 → `taskkill /T /F` 收整棵树；哑窗是子进程，不收会成孤儿）。
 * ★判据是**进程真的没了**（`pidAlive`），不是"注册表不新鲜" —— 心跳有 20s 容差，
 *   拿它当判据会**以为停掉了而其实还在跑**（实测：reset 后新旧两个宿主并存，debug-query 答的是旧的那个）。
 */
export async function stopInstance(id, { graceMs = 6000, forceAfterMs = 8000 } = {}) {
  const rec = readRecord(id);
  const pid = rec?.pid;
  if (!pid) return { stopped: false, reason: '注册表里没有 pid' };
  try {
    process.kill(pid, 'SIGTERM');
  } catch (e) {
    return { stopped: false, reason: `SIGTERM 失败：${e.message}` };
  }
  const t0 = Date.now();
  while (Date.now() - t0 < graceMs) {
    await sleep(300);
    if (!pidAlive(pid)) return { stopped: true, pid };
  }
  await new Promise((res) => {
    const k = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    k.on('exit', res);
    k.on('error', res);
  });
  const t1 = Date.now();
  while (Date.now() - t1 < forceAfterMs) {
    await sleep(300);
    if (!pidAlive(pid)) return { stopped: true, pid, forced: true };
  }
  throw new Error(`停不掉实例 ${id}（pid=${pid} 仍在跑）—— 手工 taskkill /PID ${pid} /T /F`);
}

/** 等实例登记为活（宿主 listen 后写注册表）；给 `expectPid` 时还要**pid 对得上**（防陈旧记录）。 */
export async function waitRegistered(id, { timeoutMs = 25_000, expectPid } = {}) {
  const t0 = Date.now();
  for (;;) {
    const rec = readRecord(id);
    const okPid = expectPid === undefined || Number(rec?.pid) === Number(expectPid);
    if (rec && okPid && (await isLive(id))) return rec;
    if (Date.now() - t0 > timeoutMs) return null;
    await sleep(400);
  }
}

/**
 * **reset**：把实例重启到 TITLE（先停掉在跑的，再起，再等到 `TITLE.BIN` 且帧循环在跑）。
 * 这是"从干净状态复现"的唯一入口，别用"手动点回标题"。
 *
 * ★两步新鲜度断言（都是踩出来的）：
 *   1. `waitTicking()` —— 必须有**在跑**的渲染页，否则点击不会被处理（旧版只看 `frame`，
 *      会被一个停摆的旧页面骗过去）；
 *   2. 到 TITLE 后读引擎时钟（`Engine[92333]`）—— 旧页面残留的 VM 早跑了几百秒，
 *      新起的只应有几十秒；超阈值就**报错**而不是继续（`--allow-stale` 可关掉这条）。
 */
export async function resetInstance(id, { titleTimeoutMs = 180_000, idleSec = 0, headless = true, allowStale = false, freshMs = 120_000 } = {}) {
  const wasLive = await isLive(id);
  if (wasLive) {
    console.log(`  stop 掉在跑的实例（重置必须从干净状态起）`);
    await stopInstance(id);
  }
  const { pid, logPath } = startInstance(id, { idleSec, headless });
  console.log(`  起实例 pid=${pid}（log=${path.relative(REPO, logPath).split(path.sep).join('/')}）`);
  const rec = await waitRegistered(id, { expectPid: pid });
  if (!rec) throw new Error(`实例 ${id} 在 25s 内没登记为活（看 ${logPath} 尾部）`);
  console.log(`  已登记：port=${rec.port}`);
  let probe;
  try {
    probe = await waitTicking(id, { timeoutMs: titleTimeoutMs });
  } catch (e) {
    throw new Error(`reset 起完实例但**没有可驱动的渲染页**：${e.message}`);
  }
  const t0 = Date.now();
  while (Date.now() - t0 < titleTimeoutMs) {
    const bin = await binOf(id);
    if (bin === 'TITLE.BIN') {
      const p = await probeOf(id);
      console.log(`  ✔ 已回到 TITLE（${Date.now() - t0}ms；引擎时钟 ${Math.round((p.clockMs ?? 0) / 1000)}s）`);
      if (!allowStale && Number.isFinite(p.clockMs) && p.clockMs > freshMs) {
        throw new Error(
          `reset 后引擎时钟已 ${Math.round(p.clockMs / 1000)}s（> ${Math.round(freshMs / 1000)}s）⇒ 回答命令的是**旧页面残留的 VM**，不是刚起的实例。` +
            `修法：把该实例的面板页关掉/刷新，让它重新挂到新实例上；或用一个新的 --instance id 重跑。`,
        );
      }
      return { id, port: readRecord(id)?.port, pid, elapsedMs: Date.now() - t0, clockMs: p.clockMs };
    }
    await sleep(800);
  }
  throw new Error(`reset 后 ${titleTimeoutMs}ms 内没到 TITLE.BIN（当前 ${await binOf(id)}）`);
}

// ---------------------------------------------------------------------------
// 存档文件指纹（"载入的是不是目标槽"——引擎日志里没有槽号，只能自己核）
// ---------------------------------------------------------------------------
/** 该实例可见的槽文件路径（overlay → base，与 `src/arch/systemPaths.ts` 同序）。 */
export function slotFilePath(id, slot) {
  const nn = String(slot).padStart(2, '0');
  for (const sub of ['overlay', 'base']) {
    const f = path.join(instanceDir(id), sub, 'SAVE', `SAVE${nn}.DAT`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

/**
 * 用引擎自己的解析器读槽头（`npx tsx src/tools/saveDump.ts`）—— 拿 `savedCur` / 帧记录数 /
 * 各帧 scriptId，用来与日志 `[slot-load] 真槽装载：… savedCur=…、帧记录 N 条` 对齐。
 */
export async function slotFingerprint(id, slot, { timeoutMs = 60_000 } = {}) {
  const f = slotFilePath(id, slot);
  if (!f) return null;
  const appDir = path.join(REPO, 'app', 'amayui-emulator');
  const rel = path.relative(appDir, f);
  const out = await new Promise((res) => {
    const p = spawn(process.execPath, ['--import', 'tsx', 'src/tools/saveDump.ts', rel], { cwd: appDir, windowsHide: true });
    let buf = '';
    const timer = setTimeout(() => p.kill(), timeoutMs);
    p.stdout.on('data', (d) => (buf += d));
    p.stderr.on('data', (d) => (buf += d));
    p.on('close', () => {
      clearTimeout(timer);
      res(buf);
    });
    p.on('error', () => {
      clearTimeout(timer);
      res('');
    });
  });
  const savedCur = Number((out.match(/savedCur=(-?\d+)/) ?? [])[1] ?? NaN);
  const frames = [...out.matchAll(/帧 (\d+): scriptId=0x([0-9a-f]+) 返回帧=(-?\d+)/g)].map((m) => ({
    idx: Number(m[1]),
    scriptId: parseInt(m[2], 16),
    returnFrame: Number(m[3]),
  }));
  return { file: path.relative(REPO, f).split(path.sep).join('/'), savedCur, frames, raw: out };
}

// ---------------------------------------------------------------------------
// CLI（只暴露**原语**；用例脚本在 ops/ 下）
// ---------------------------------------------------------------------------
const HELP = `emu.mjs —— 调试实例核心驱动（原语层）

用法：node .agents/skills/amayui-remote-debug/scripts/emu.mjs <子命令> [--instance <id>] [参数]

  status                     实例一览 + 当前 bin/帧数/门（就绪判据）
  reset                      重启实例并等回 TITLE（唯一合法的"回到干净状态"）
  start | stop               只起/只停（不起等 TITLE）
  frame                      当前帧链（含 ←cur）
  probe                      关键引擎态：帧链 / effectFlags(▼ 武装位) / 字体填充色 / 字格游标
  globals <hex,hex,…>        读脚本全局 int（引擎口径下标，如 f7ff0）
  set-global <下标> <值>       ★写脚本全局 int（按 ENC 写；只改运行期内存，不写回 SAVE.DAT）
  set-array <基址> <i> <值>    ★写全局数组元素（= set-global 基址+i）
  sidebar [--show]           ADV 侧栏（charm 表 13b0）：无参 = 写死固定排布；--show = 只读回当前排布
  cap [名字.png]             抓一帧到 .tmp/emudbg/
  tap <x> <y>                两帧点击（菜单/侧栏/底部按钮必须用它）
  hover <x> <y>              悬停（靠位置变化触发）
  wait-bin <BIN>             等当前脚本变成 BIN
  log [--tail N] [--grep 串] 读实例日志

用例脚本（从某个界面载入存档等）在 scripts/ops/ 下，索引见 ops/README.md。`;

function parseArgv(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      // ★收尾的裸开关（`--show` 后面没有值）也要记成 true —— 旧写法在那种情况下会记成 undefined（踩过）。
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) opt[a.slice(2)] = true;
      else opt[a.slice(2)] = argv[++i];
    } else pos.push(a);
  }
  return { pos, opt };
}

async function main() {
  const { pos, opt } = parseArgv(process.argv.slice(2));
  const cmd = pos[0];
  if (!cmd || cmd === 'help' || opt.help) {
    console.log(HELP);
    return;
  }
  const id = typeof opt.instance === 'string' ? opt.instance : undefined;
  if (cmd === 'status') {
    const all = await listInstances();
    if (!all.length) console.log('（没有实例记录）');
    for (const r of all) {
      const flag = r.live ? '●' : '○';
      const pid = r.pid ?? readRecord(r.id)?.pid ?? '?';
      let tick = '';
      if (r.live) {
        const d = await diagnose(r.id);
        tick = `  ${d.state === 'ticking' ? '可驱动' : '不可驱动：' + explainDiagnosis(r.id, d)}`;
      }
      console.log(
        `${flag} ${r.id} port=${r.port ?? '?'} pid=${pid} viewers=${r.viewers ?? '?'} bin=${r.bin ?? '?'} frames=${r.frames ?? '?'} gate=${r.gate ?? '?'}${tick}`,
      );
    }
    if (id) {
      await waitReady(id, { timeoutMs: 10_000 });
      const f = await frameOf(id);
      console.log(`\n${id}：cur=${f.cur} bin=${f.bin}`);
      console.log(f.raw);
    }
    return;
  }
  if (!id) throw new Error(`${cmd} 需要 --instance <id>`);
  // ★除起停/重置/status 外，其余命令都要求实例**真的在注册表里** —— 否则插件会回一句
  //   "未知实例"之类的文本，而被 `globalOf` 解析成 NaN（实测：`sidebar --show --instance __nope__`
  //   打出 9 个 NaN 而不是报错）。
  if (!['start', 'stop', 'reset'].includes(cmd)) {
    await resolveInstance(id);
  }
  switch (cmd) {
    case 'reset':
      await resetInstance(id, { idleSec: Number(opt['idle-sec'] ?? 0) });
      break;
    case 'start': {
      const r = startInstance(id, { idleSec: Number(opt['idle-sec'] ?? 0) });
      console.log(`已起 pid=${r.pid}（log=${r.logPath}）；用 wait-bin TITLE.BIN 等它`);
      break;
    }
    case 'stop': {
      const r = await stopInstance(id);
      console.log(JSON.stringify(r));
      break;
    }
    case 'frame':
      console.log((await frameOf(id)).raw);
      break;
    case 'probe':
      console.log(JSON.stringify(await probeOf(id), null, 1));
      break;
    case 'globals': {
      const keys = String(pos[1] ?? '').split(',').filter(Boolean);
      console.log(JSON.stringify(await globalsOf(id, keys)));
      break;
    }
    case 'set-global': {
      // set-global <下标> <值>（下标/值：0x… 或含 a-f = 十六进制，纯数字 = 十进制）
      const idx = Number(pos[1]?.startsWith('0x') ? pos[1] : /[a-f]/i.test(pos[1] ?? '') ? '0x' + pos[1] : pos[1]);
      const val = Number(pos[2]?.startsWith('0x') ? pos[2] : /[a-f]/i.test(pos[2] ?? '') ? '0x' + pos[2] : pos[2]);
      console.log(await setGlobal(id, idx, val));
      break;
    }
    case 'set-array': {
      const base = Number(pos[1]?.startsWith('0x') ? pos[1] : /[a-f]/i.test(pos[1] ?? '') ? '0x' + pos[1] : pos[1]);
      console.log(await setArray(id, base, Number(pos[2]), Number(pos[3]?.startsWith('0x') ? pos[3] : /[a-f]/i.test(pos[3] ?? '') ? '0x' + pos[3] : pos[3])));
      break;
    }
    case 'sidebar': {
      // sidebar            ⇒ 写死固定排布（= ops/load-from-adv 开跑前做的那件事）
      // sidebar --show     ⇒ 只读回当前排布
      if (opt.show === true) {
        const back = await readSidebarLayout(id);
        console.log(`global 0x${SIDEBAR.tableGlobal.toString(16)}[0..${back.length - 1}] = ${back.map((v) => '0x' + v.toString(16)).join(' ')}`);
        break;
      }
      for (const l of await forceSidebarLayout(id)) console.log(l);
      console.log('★只改运行期内存（不写回 SAVE.DAT）；本实例当次运行的侧栏排布已被改为固定排布');
      break;
    }
    case 'cap': {
      const r = await capture(id, pos[1]);
      console.log(`→ ${r.rel}`);
      break;
    }
    case 'tap':
      await tap(id, Number(pos[1]), Number(pos[2]));
      console.log(`已两帧点击 (${pos[1]},${pos[2]})`);
      break;
    case 'hover':
      await hover(id, Number(pos[1]), Number(pos[2]));
      console.log(`已悬停 (${pos[1]},${pos[2]})`);
      break;
    case 'wait-bin': {
      const ok = await waitBin(id, pos[1], { timeoutMs: Number(opt['timeout-ms'] ?? 60_000) });
      console.log(ok ? `✔ ${pos[1]}` : `✗ 没等到 ${pos[1]}（当前 ${await binOf(id)}）`);
      process.exitCode = ok ? 0 : 1;
      break;
    }
    case 'log': {
      let lines = readLog(id, opt.tail ? { tail: Number(opt.tail) } : undefined);
      if (opt.grep) lines = lines.filter((l) => l.includes(String(opt.grep)));
      console.log(lines.join('\n'));
      break;
    }
    default:
      console.error(`未知子命令：${cmd}\n\n${HELP}`);
      process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((e) => {
    console.error(`✗ ${e.message}`);
    process.exitCode = 1;
  });
}
