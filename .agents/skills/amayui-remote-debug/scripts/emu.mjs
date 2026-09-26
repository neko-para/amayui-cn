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
  /** 列表第 i 行的 y（**只是兜底公式**：2026-09-26 实测同一台机上 `y=570 ⇒ 078` 而 `y=630 ⇒ 077`，
   *  说明列表带滚动偏移 ⇒ 真路径是 `calibrateRowY()` 探两点拟合，再用 `global 138e` 核对）。 */
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
 * ★**标题 = `TITLE.BIN`**（用户口径 2026-09-26）；**不要**把 `SBUNKI`/`SBUNKIMOVE` 当成标题动画：
 * 它们是**装载画面族**（存档/读档画面的背景与动画），证据 = 装载那一步的帧链
 * `[slot-load] 装载时的帧链：0=SYSTEM4 1=TITLE 2=SAVE 3=SBUNKI 4=SBUNKIMOVE`（`SAVE.BIN` 调出来的）。
 * ⇒ 看到 `cur = SBUNKI.BIN` 意味着**还在装载流程里**（或那次装载的残留），**不是**"回到了标题"；
 *   `reset` 与"从 TITLE 读档"的前置都只认 `TITLE.BIN`。
 * （本条来自一次实测误判：曾据此放宽前置，结果把"其实还在装载链里"误当成"在标题"。）
 */
export const TITLE_BIN = 'TITLE.BIN';
/** 装载画面族：出现它说明在走 `SAVE.BIN` 的装载流程（不是标题）。 */
export const LOAD_UI_FAMILY = ['SBUNKI.BIN', 'SBUNKIMOVE.BIN'];
export const isTitle = (bin) => bin === TITLE_BIN;
export const isLoadUiFamily = (bin) => LOAD_UI_FAMILY.includes(bin);

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
  /**
   * ★**动作 id 白名单**（真源 = `src/SN0000.txt` 的派发链 `label_00001554` 逐项 `eq (local-int 0) (local-ptr 0) <id>`）：
   * SN0000 认得的只有这 15 个：`0`（空）/ `1`=MENU / `5`=REPLAYVOICE / `6`=HISTORY / `d`=SAVE / `e`=LOAD /
   * `f`=CONFIG / `10`=INFO / `15`=SBUNKI，其余 `2/3/4/7/b/c` 也是它认的分支（脚本族不同名字可能不同）。
   * ⇒ 写面**拒绝**白名单外的值（写进去只会"点了没反应"，最难查）。
   */
  VALID_IDS: [0x0, 0x1, 0x2, 0x3, 0x4, 0x5, 0x6, 0x7, 0xb, 0xc, 0xd, 0xe, 0xf, 0x10, 0x15],
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
 * ★写前按 `SIDEBAR.VALID_IDS` 校验（越界 id 会让"点了没反应"这种最难查的失败出现）；
 *   校验失败**一个槽都不写**（`forceIntArray` 先校验后落值）。
 * 返回逐项回执行，便于进日志/证据。
 */
export async function forceSidebarLayout(id, layout = SIDEBAR.FORCED_LAYOUT) {
  const bad = layout.filter((v) => !SIDEBAR.VALID_IDS.includes(v));
  if (bad.length) {
    throw new Error(
      `侧栏排布里出现派发链不认的动作 id：${bad.map((v) => '0x' + v.toString(16)).join(' ')}` +
        `（合法集见 SIDEBAR.VALID_IDS，真源 = src/SN0000.txt 的派发链）`,
    );
  }
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

/** 路由表项数（`RoutePanel.snapshotState().entries`）—— 判"侧栏展开的热点是否已登记"用。 */
export async function routeCount(id) {
  const s = await snapshotOf(id);
  const entries = s.routes?.entries;
  return Array.isArray(entries) ? entries.length : NaN;
}

/** 侧栏展开态的热点项数下限（折叠态只有 2~3 项：折叠条 + 全屏热点；展开后 +9 个按钮 ⇒ ≥10）。 */
export const SIDEBAR_EXPANDED_MIN_ROUTES = 10;

/**
 * **等虚拟机"不忙"了再点**（`tickets/T-0188`，用户实测 2026-09-26）：
 * 存档列表的每页要**同步**读 10 个槽头（引擎 `0x1A0`，一处 ~84–117ms ⇒ 一页可到数秒）——
 * 这段时间**渲染页被 JS 阻塞**，此期间注入的点击会**丢**（用户原话：「加载存档界面比预期慢，
 * 导致点 79 的动作过快丢失了」）。`cur` 变成 `SAVE.BIN` **不代表列表画完了**。
 *
 * 判据 = **`debug-query` 的往返耗时**：阻塞时请求要么超时、要么很慢；空闲时 `frame` 只要几十~两百 ms。
 * 连续 `stable` 次快于 `fastMs` 才算"不忙"（默认 2 次 < 600ms）。
 */
export async function waitIdle(id, { timeoutMs = 25_000, fastMs = 600, stable = 2, intervalMs = 250 } = {}) {
  const t0 = Date.now();
  let ok = 0;
  for (;;) {
    const t = Date.now();
    let ms = Infinity;
    try {
      await dq(id, 'frame', { retries: 0, timeoutMs: 8000 });
      ms = Date.now() - t;
    } catch {
      ms = Infinity; // 阻塞/超时 ⇒ 当作"忙"
    }
    ok = ms <= fastMs ? ok + 1 : 0;
    if (ok >= stable) return { waitedMs: Date.now() - t0, lastMs: ms };
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(
        `等虚拟机空闲超时（${timeoutMs}ms，最后一次往返 ${ms === Infinity ? '超时' : ms + 'ms'}）：` +
          `页面可能还在同步读存档头（引擎 0x1A0 一页可到数秒）⇒ 这段时间点击会丢。`,
      );
    }
    await sleep(intervalMs);
  }
}

/**
 * **等 ADV 侧栏"真的可用"**（`tickets/T-0188`，用户口径 2026-09-26）：
 * ★**序章一样有侧栏**，只是要先等它的**渐变动画**跑完 —— 动画期间热点还没重登记，点/悬停都会落空
 * （实测：序章第一页直接点按钮 ⇒ 9 格扫描全落空，误以为"这个场景没有侧栏"）。
 *
 * 判据（机器可读）：`RoutePanel` 的**项数**从折叠态（2~3）涨到展开态（≥ `SIDEBAR_EXPANDED_MIN_ROUTES`）
 * **并连续两次采样保持稳定**（= 展开 label 末尾的 `call label_00000320` 已把 9 个按钮热点登记完）。
 * ★为什么不看 `global 1399`：它在动画**开始**就置 2（`src/SN0000.txt:50` 的展开分支），
 *   离"热点可用"还差整段动画；也不看 `bin`（场景名在动画前后不变）。
 */
export async function waitSidebarReady(id, { timeoutMs = 20_000, intervalMs = 400, settleMs = 500 } = {}) {
  await hover(id, ...XY.advSidebarStrip, { settleMs });
  const t0 = Date.now();
  let last = -1;
  let stable = 0;
  for (;;) {
    const n = await routeCount(id).catch(() => NaN);
    if (Number.isFinite(n) && n >= SIDEBAR_EXPANDED_MIN_ROUTES && n === last) stable++;
    else stable = 0;
    last = Number.isFinite(n) ? n : -1;
    if (stable >= 2) return { routes: n, waitedMs: Date.now() - t0 };
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(
        `等侧栏展开超时（${timeoutMs}ms，最后路由项数 ${last}；期望 ≥${SIDEBAR_EXPANDED_MIN_ROUTES}）：` +
          `① 光标要在折叠条上（${XY.advSidebarStrip.join(',')}，靠"位置变化"触发命中）；` +
          `② 序章也有侧栏，但**要等渐变动画跑完**（热点在动画末尾才重登记）；` +
          `③ 若这个场景确实没有 ADV 侧栏（战斗/工房等），要用它们各自的 ops（见 ops/README.md）。`,
      );
    }
    await sleep(intervalMs);
  }
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
 * **行 y 的自标定** —— ⚠**当前不可用，保留作记录**。
 *
 * 2026-09-26 曾用它 + `global 138e` 做"选中的是不是目标行"的核对，实测**是假阴性**：
 * 画面明确显示 079 已选中（确认框也是 079、缩略图就是 79 的内容）而 `138e` 仍读 7
 * —— `138e` 是 `SAVE.DAT` 里**上一次读档**留下的旧值（`SAVE.txt:11-14` 启动时 load-int 进来），
 * **不随鼠标选行变化**。⇒ 选行对不对**不能靠它**；正确做法是载入后用**槽指纹**核对
 * （见 `slotFingerprint`：把槽头 `savedCur`/帧记录数与日志 `[slot-load] 真槽装载…` 对齐）。
 * 这里保留函数是因为它记录的"探两点拟合"思路对将来的列表类界面仍可能有用，
 * 但**调用方必须提供真的会变的信号**，否则它会返回 `null`（两点读数相同 ⇒ 调用方走兜底公式）。
 */
export async function calibrateRowY(id, targetRow, { yA = 480, yB = 680 } = {}) {
  const probe = async (y) => {
    const before = await globalOf(id, '138e').catch(() => NaN);
    await tap(id, XY.rowX, y, { settleMs: 450 });
    const after = await globalOf(id, '138e').catch(() => NaN);
    // ★只有"读数确实变了"才算有效探针（138e 这种陈旧值 ⇒ 直接判标定失败，别拿它当行号）。
    return before === after ? NaN : after;
  };
  const rowA = await probe(yA);
  const rowB = await probe(yB);
  if (!Number.isFinite(rowA) || !Number.isFinite(rowB) || !(rowB > rowA)) return null;
  const slope = (rowB - rowA) / (yB - yA);
  const y = yA + (targetRow - rowA) / slope;
  return Math.round(Math.max(60, Math.min(710, y)));
}

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
  console.log(`  选槽：点页号按钮「${tens}0」@ ${XY.pageButton(tens).join(',')}`);
  // ★**进画面后先等虚拟机不忙**（列表首屏要同步读 10 个槽头，`0x1A0`；此时点击会丢）。
  const idle0 = await waitIdle(id).catch((e) => {
    console.log(`  ⚠ waitIdle（首屏）：${e.message}`);
    return null;
  });
  if (idle0) console.log(`  虚拟机空闲（${idle0.waitedMs}ms，最后一次往返 ${idle0.lastMs}ms）⇒ 可以点行`);
  await tap(id, ...XY.pageButton(tens), { settleMs: 700 });
  // ★**切页同样要等**（每页重画 = 又一轮同步读头）。
  const idle1 = await waitIdle(id).catch((e) => {
    console.log(`  ⚠ waitIdle（切页）：${e.message}`);
    return null;
  });
  if (idle1) console.log(`  切页后空闲（${idle1.waitedMs}ms，最后一次往返 ${idle1.lastMs}ms）`);
  // ★行 y：用兜底公式 `XY.rowY()`（实测 `y=570 ⇒ 槽 078`、`y=630 ⇒ 槽 079`，**已用确认框缩略图核对**）。
  //   **不用** `global 138e` 核对 —— 它是 SAVE.DAT 里的陈旧值、不随选行变化（实测假阴性会把对的流程杀掉）；
  //   选行对不对由**载入后的槽指纹**对账（见函数末尾 `verifyLoadedSlot`）。
  const rowY = XY.rowY(ones);
  // ★**点行就会弹「要读取吗？」确认框**（2026-09-26 实测：单选一行 ⇒ 框出现、该行高亮、缩略图 = 该槽）
  //   ⇒ **不要再点左下角的 LOAD 按钮**（那一步会把对话框的流程带偏：之后点「是」落空 ⇒ 45s 超时）。
  //   失败时**重来一轮**（重新选行 ⇒ 重新弹框），而不是继续盲点。
  for (let round = 1; round <= 2; round++) {
    console.log(`  选行：第 ${ones} 行 (y=${rowY})${round > 1 ? '（第 2 轮重来）' : ''}`);
    await tap(id, XY.rowX, rowY, { settleMs: 1200 });
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`  确认「是」@ ${XY.confirmYes.join(',')}（第 ${attempt} 次）`);
      await tap(id, ...XY.confirmYes, { settleMs: 700, hoverFirst: false });
      if (await waitLog(id, '[slot-load]', { since: before, timeoutMs: attempt === 3 ? 8000 : 5000 })) break;
    }
    if (await waitLog(id, '[slot-load]', { since: before, timeoutMs: 500 })) break;
    console.log('  ↻ 这一轮没载入 ⇒ 重新选行再确认');
  }
  const hit = await waitLog(id, '[slot-load]', { since: before, timeoutMs: 1000 });
  if (!hit) {
    throw new Error(
      `点了载入但 ${timeoutMs}ms 内日志没有 [slot-load]（槽空？页码不对？槽文件不在实例可见目录？见 T-0185 的"首跑失败"一节）`,
    );
  }
  for (const l of hit) console.log('   ' + l.trim().slice(0, 200));
  // ★**槽指纹对账**：引擎日志里没有槽号（`0x1A0` 只回结果码）⇒ 拿槽头的 `savedCur`/帧记录数
  //   与日志 `[slot-load] 真槽装载：… savedCur=N、帧记录 M 条` 对齐（核不过就**报警**，不静默）。
  await verifyLoadedSlot(id, slot, hit);
  if (expect) {
    const ok = await waitBin(id, expect, { timeoutMs });
    if (!ok) throw new Error(`载入后 ${timeoutMs}ms 内没看到 ${expect}（当前 ${await binOf(id)}）`);
    console.log(`  ✔ 帧链已到 ${expect}`);
  }
  return { slot, log: hit, bin: await binOf(id) };
}

/**
 * 载入后**核对槽号**：拿槽文件的头（`savedCur` / 帧记录数）与日志里的装载参数对账。
 * ★这是"载入的是不是目标槽"唯一可机读的口径（引擎不回槽号）；不一致时**报警但不回滚**
 *   （载入本身是只读操作，最坏是"载错了槽"，再载一次即可）。
 */
async function verifyLoadedSlot(id, slot, logLines) {
  const fp = await slotFingerprint(id, slot).catch(() => null);
  if (!fp) {
    console.log(`  ⚠ 槽 ${slot} 的文件读不到（不在实例可见目录？）⇒ 跳过指纹对账`);
    return;
  }
  const txt = logLines.join('\n');
  const savedCur = Number((txt.match(/savedCur=(-?\d+)/) ?? [])[1] ?? NaN);
  const recCount = Number((txt.match(/帧记录\s*(\d+)\s*条/) ?? [])[1] ?? NaN);
  const ok = savedCur === fp.savedCur && (Number.isNaN(recCount) || recCount === fp.frames.length);
  console.log(
    `  槽指纹对账：槽 ${slot} 文件 savedCur=${fp.savedCur}/帧记录 ${fp.frames.length} 条` +
      ` vs 日志 savedCur=${savedCur}/帧记录 ${recCount} 条 ⇒ ${ok ? '✔ 一致' : '✗ 不一致'}`,
  );
  if (!ok) console.log('  ⚠ 载入的槽与目标槽**不一致**（引擎不回槽号；可用 slotThumbPng 看缩略图复核）');
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
    if (isTitle(bin)) {
      const p = await probeOf(id);
      console.log(`  ✔ 已回到 TITLE（${bin}；${Date.now() - t0}ms；引擎时钟 ${Math.round((p.clockMs ?? 0) / 1000)}s）`);
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
  throw new Error(`reset 后 ${titleTimeoutMs}ms 内没回到 TITLE.BIN（当前 ${await binOf(id)}${isLoadUiFamily(await binOf(id)) ? '（装载画面族：还在装载流程里）' : ''}）`);
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
