/**
 * 控制窗（ControlWindow）逻辑——独立小窗，提供重启 / 指令日志开关 / 未知指令桩跳过 / 状态展示。
 * 通过 preload 暴露的 IPC 与主进程、主渲染窗交互（见 electron/preload.ts 与 main.ts）。
 *   - 重启：`controlRestart()` → 主进程 reload 主窗口渲染器（重跑完整 boot）。
 *   - 指令日志开关：`controlSetTraceAll(enabled)` → 主进程转发到渲染窗（onTraceAll）。
 *   - **未知指令桩跳过**：渲染器遇「未实现 opcode」会停下来并上报 pendingUnknown；本窗显示该指令 +
 *     「作为桩函数跳过」按钮，点击 → `controlSkipOp(opcode)` → 主进程转发 → 渲染窗登记 no-op 桩
 *     （Engine.unknownOpStubs）并从**同一条指令**重试继续。
 *   - 状态展示：收听 `onControlStatus`（渲染窗上报的 ControlStatus）。
 */
import type { ControlStatus } from '../src/renderer/ipcFileSource.js';

declare global {
  interface Window {
    api: {
      controlRestart(): void;
      controlSetTraceAll(enabled: boolean): void;
      /** 设置定向 trace 白名单（opcode 列表；空 = 不过滤）。 */
      controlSetTraceFilter(ops: number[]): void;
      /** 强制关闭（主进程侧销毁窗口并退出）——渲染窗卡住时的唯一出路。 */
      controlForceClose(): void;
      /** 把某个未知 opcode 作为桩函数跳过并继续执行。 */
      controlSkipOp(opcode: number): void;
      /** 某未知 opcode 已被登记为桩函数（收掉「待处理」块）。 */
      onControlOpSkip(cb: (opcode: number) => void): void;
      onControlStatus(cb: (s: ControlStatus) => void): void;
    };
  }
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const binEl = el<HTMLSpanElement>('bin');
const ignoredCountEl = el<HTMLSpanElement>('ignoredCount');
const ignoredBox = el<HTMLDivElement>('ignored');
const internalCountEl = el<HTMLSpanElement>('internalCount');
const internalBox = el<HTMLDivElement>('internal');
const skippedCountEl = el<HTMLSpanElement>('skippedCount');
const skippedBox = el<HTMLDivElement>('skipped');
const gapsCountEl = el<HTMLSpanElement>('gapsCount');
const gapsBox = el<HTMLDivElement>('gaps');
const droppedCountEl = el<HTMLSpanElement>('droppedCount');
const droppedBox = el<HTMLDivElement>('dropped');
const traceFilterInput = el<HTMLInputElement>('traceFilter');
const btnTraceApply = el<HTMLButtonElement>('btnTraceApply');
const perfEl = el<HTMLSpanElement>('perf');
const errorBox = el<HTMLDivElement>('error');
const btnTraceAll = el<HTMLButtonElement>('btnTraceAll');
const btnCopySkipped = el<HTMLButtonElement>('btnCopySkipped');
const btnCopyIgnored = el<HTMLButtonElement>('btnCopyIgnored');
const btnCopyInternal = el<HTMLButtonElement>('btnCopyInternal');
const btnCopyGaps = el<HTMLButtonElement>('btnCopyGaps');
const btnCopyDropped = el<HTMLButtonElement>('btnCopyDropped');
const unknownBlock = el<HTMLDivElement>('unknownBlock');
const unknownInfo = el<HTMLDivElement>('unknownInfo');
const unknownHint = el<HTMLDivElement>('unknownHint');
const btnSkipUnknown = el<HTMLButtonElement>('btnSkipUnknown');

let traceAll = false;
/** 当前等待处理的未知指令（= 渲染窗上报的 pendingUnknown；null 表示没有）。 */
let pending: ControlStatus['pendingUnknown'] | null = null;
/** 各清单的最新内容（供「复制全部」用；清单每 0.5s 重刷，直接划选很难操作）。 */
let skippedItems: NonNullable<ControlStatus['skipped']> = [];
let ignoredItems: ControlStatus['ignored'] = [];
let internalItems: ControlStatus['internal'] = [];
let gapItems: NonNullable<ControlStatus['gaps']> = [];
let droppedItems: NonNullable<ControlStatus['dropped']> = [];

/** 把输入框里的 opcode 列表解析成 number[]（接受 `1fb` / `0x1fb`，逗号或空格分隔）。 */
function parseOpList(s: string): number[] {
  return s
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => Number(x.toLowerCase().startsWith('0x') ? x : `0x${x}`))
    .filter((n) => Number.isFinite(n) && n >= 0);
}

/** 复制文本到剪贴板；失败时回退到临时 textarea + execCommand。返回是否成功。 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/** 「复制全部」：把清单按一行一条复制（只名字，不含指令码数值）。点后按钮短暂显示结果。 */
function wireCopyButton(btn: HTMLButtonElement, lines: () => string[], label: string): void {
  let timer = 0;
  btn.addEventListener('click', () => {
    const items = lines();
    const done = (msg: string): void => {
      btn.textContent = msg;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        btn.textContent = label;
      }, 1500);
    };
    if (items.length === 0) {
      done('（空）');
      return;
    }
    void copyText(items.join('\n')).then((ok) => done(ok ? `已复制 ${items.length} 条` : '复制失败'));
  });
}

function updateTraceBtn(): void {
  btnTraceAll.textContent = `启用指令日志：${traceAll ? '开（全量）' : '关（仅未知）'}`;
  btnTraceAll.classList.toggle('on', traceAll);
}

function renderIgnored(ignored: { opcode: number; name: string }[]): void {
  ignoredItems = ignored;
  ignoredCountEl.textContent = `(${ignored.length} 个)`;
  ignoredBox.textContent = '';
  if (ignored.length === 0) {
    ignoredBox.textContent = '（暂无）';
    return;
  }
  // 只显示助记符（name 已是语义名或 iXXX 数值），不列指令码数值。
  for (const it of ignored) {
    const d = document.createElement('div');
    d.textContent = it.name;
    ignoredBox.appendChild(d);
  }
}

/** 已插桩但有专门处理（消息窗/声音/数组排序/字段写入…）：按引擎语义执行，只是不产出可渲染输出。 */
function renderInternal(list: ControlStatus['internal'] | undefined): void {
  const items = list ?? [];
  internalItems = items;
  internalCountEl.textContent = `(${items.length} 个)`;
  internalBox.textContent = '';
  if (items.length === 0) {
    internalBox.textContent = '（暂无）';
    return;
  }
  for (const it of items) {
    const d = document.createElement('div');
    d.textContent = it.name;
    internalBox.appendChild(d);
  }
}

/** 已跳过的未知指令（用户在按钮上点过、已登记为 no-op 桩）。只显示助记符 + 执行次数。 */
function renderSkipped(list: ControlStatus['skipped'] | undefined): void {
  const items = list ?? [];
  skippedItems = items;
  skippedCountEl.textContent = `(${items.length} 个)`;
  skippedBox.textContent = '';
  if (items.length === 0) {
    skippedBox.textContent = '（暂无已跳过指令）';
    return;
  }
  // 不再显示 `0x…` 指令码数值（与「已忽略」清单一致，便于直接复制助记符）。
  for (const it of items) {
    const d = document.createElement('div');
    d.textContent = `${it.name} ×${it.count}`;
    skippedBox.appendChild(d);
  }
}

/**
 * 「未知指令」块：有 pendingUnknown 才显示（按钮 = 把该指令当无副作用桩函数跳过并继续执行）；
 * 没有则整块隐藏（包括按钮），避免误点。
 */
function renderUnknown(): void {
  const p = pending;
  if (!p) {
    unknownBlock.hidden = true;
    btnSkipUnknown.disabled = false;
    btnSkipUnknown.textContent = '作为桩函数跳过并继续';
    return;
  }
  unknownBlock.hidden = false;
  unknownInfo.textContent = `0x${p.opcode.toString(16)} ${p.name} @ ${p.script} ip=${p.instrIndex} (0x${p.byteOffset.toString(16)})`;
  unknownHint.textContent = `点击后按无副作用 no-op 桩跳过这条指令，并从同一条指令处继续执行（不读操作数、不改写 VM 状态）`;
  btnSkipUnknown.disabled = false;
  btnSkipUnknown.textContent = `作为桩函数跳过：0x${p.opcode.toString(16)} ${p.name}`;
}

/**
 * ★闸门 A 清单：**意图被丢弃** —— 脚本调用了一个宿主没实现的 native 方法（`?.` 静默 no-op）。
 * 每条显示：方法名 ×次数、触发它的 opcode、以及"缺了它会有什么无报错的表现"。
 */
function renderDropped(list: ControlStatus['dropped'] | undefined): void {
  const items = list ?? [];
  droppedItems = items;
  droppedCountEl.textContent = `(${items.length} 种)`;
  droppedBox.textContent = '';
  if (items.length === 0) {
    droppedBox.textContent = '（暂无：宿主没有丢弃任何 native 意图）';
    return;
  }
  for (const it of items) {
    const d = document.createElement('div');
    d.textContent = `${it.method} ×${it.count} ← ${it.opcodes.join(',')}｜${it.why}`;
    d.title = `最近实参：${it.sample}`;
    droppedBox.appendChild(d);
  }
}

/**
 * ★闸门 B 清单：**能力缺口** —— 这条指令被当作 no-op 跳过，但脚本给它传了**非平凡实参**，
 * 即"脚本真的想做点什么，而我没做"。样例操作数挂在 title 上（避免刷屏）。
 */
function renderGaps(list: ControlStatus['gaps'] | undefined): void {
  const items = list ?? [];
  gapItems = items;
  gapsCountEl.textContent = `(${items.length} 种)`;
  gapsBox.textContent = '';
  if (items.length === 0) {
    gapsBox.textContent = '（暂无：被忽略的指令都没有收到实参）';
    return;
  }
  for (const it of items) {
    const d = document.createElement('div');
    d.textContent = `${it.name} ×${it.count}`;
    d.title = `最近实参：${it.sample.join(' ')}`;
    gapsBox.appendChild(d);
  }
}

/**
 * ★性能/门控遥测 —— 回答"到底是慢还是坏"：
 *  - `指令/秒` 明显偏低（正常 30–60 万）⇒ 有东西在拖 VM（历史上是逐条 JSONL 的 IPC 洪泛）；
 *  - `门` 长时间不变 ⇒ **卡住**（`0x400` 动画等待 / `sleep` / `paused` 未知指令待跳过），不是慢；
 *  - `JSONL` 猛涨 ⇒ 定向 trace 开着且命中过多（会拖慢主进程写盘）。
 */
function renderPerf(p: NonNullable<ControlStatus['perf']> | undefined): void {
  if (!p) {
    perfEl.textContent = '…';
    return;
  }
  const gate = p.gate ? `门=${p.gate}(${(p.gateMs / 1000).toFixed(1)}s)` : '门=无';
  perfEl.textContent =
    `${p.stepsPerSec.toLocaleString()} 指令/秒  ${gate}  帧=${p.frames}` +
    (p.jsonlLines > 0 ? `  JSONL=${p.jsonlLines.toLocaleString()} 行` : '');
  const stuck = p.gate !== '' && p.gateMs > 3000;
  perfEl.style.color = stuck ? '#ff9d5c' : '#7cfc00';
  perfEl.title = stuck ? '门控持续 >3s：如果画面也没动，就是卡住（不是慢）' : '';
}

function renderError(msg?: string): void {
  if (msg) {
    errorBox.textContent = `⚠️ ${msg}`;
    errorBox.classList.add('show');
  } else {
    errorBox.textContent = '';
    errorBox.classList.remove('show');
  }
}

el<HTMLButtonElement>('btnRestart').addEventListener('click', () => {
  window.api.controlRestart();
});

el<HTMLButtonElement>('btnForceClose').addEventListener('click', () => {
  // 主进程侧销毁窗口并退出：即使渲染窗被高频 IPC / 长指令批拖住也能收场。
  window.api.controlForceClose();
});

btnTraceAll.addEventListener('click', () => {
  traceAll = !traceAll;
  window.api.controlSetTraceAll(traceAll);
  updateTraceBtn();
});

// 各清单每 0.5s 重刷（无法稳定划选）→ 提供「复制全部」，一行一条、只含助记符。
wireCopyButton(btnCopySkipped, () => skippedItems.map((it) => `${it.name} ×${it.count}`), '复制全部');
wireCopyButton(btnCopyIgnored, () => ignoredItems.map((it) => it.name), '复制全部');
wireCopyButton(btnCopyInternal, () => internalItems.map((it) => it.name), '复制全部');
wireCopyButton(btnCopyGaps, () => gapItems.map((it) => `${it.name} ×${it.count}｜${it.sample.join(' ')}`), '复制全部');
wireCopyButton(
  btnCopyDropped,
  () => droppedItems.map((it) => `${it.method} ×${it.count} ← ${it.opcodes.join(',')}｜${it.why}`),
  '复制全部',
);

// 定向 trace：把白名单发给渲染窗（空 = 全部）。渲染窗把它写成 .tmp/scene-trace.jsonl。
btnTraceApply.addEventListener('click', () => {
  const ops = parseOpList(traceFilterInput.value);
  window.api.controlSetTraceFilter(ops);
  btnTraceApply.textContent = ops.length ? `已应用 ${ops.length} 条` : '已清空（记全部）';
  window.setTimeout(() => {
    btnTraceApply.textContent = '应用';
  }, 1500);
});

btnSkipUnknown.addEventListener('click', () => {
  if (!pending) return;
  // 防重复点击：渲染窗确认（onControlOpSkip）或下一次状态上报会把 pending 清掉再恢复可用。
  btnSkipUnknown.disabled = true;
  btnSkipUnknown.textContent = '已请求跳过，等待渲染窗…';
  window.api.controlSkipOp(pending.opcode);
});

// 渲染窗确认「已登记为桩函数」：立刻收掉「待处理」块（不依赖下一次状态轮询）。
window.api.onControlOpSkip((opcode) => {
  if (pending && pending.opcode === opcode) {
    pending = null;
    renderUnknown();
    renderError(undefined);
  }
});

window.api.onControlStatus((s) => {
  binEl.textContent = s.bin || '…';
  traceAll = !!s.traceAll;
  updateTraceBtn();
  if (document.activeElement !== traceFilterInput && s.traceFilter) {
    traceFilterInput.value = s.traceFilter.join(','); // 渲染窗回读（正在输入时不同步，免得打断打字）
  }
  renderIgnored(s.ignored ?? []);
  renderInternal(s.internal);
  renderSkipped(s.skipped);
  renderGaps(s.gaps);
  renderDropped(s.dropped);
  renderPerf(s.perf);
  pending = s.pendingUnknown ?? null;
  renderUnknown();
  renderError(s.error);
});

updateTraceBtn();
renderIgnored([]);
renderInternal([]);
renderSkipped([]);
renderGaps([]);
renderDropped([]);
renderPerf(undefined);
renderUnknown();
renderError(undefined);
