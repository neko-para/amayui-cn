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
const skippedCountEl = el<HTMLSpanElement>('skippedCount');
const skippedBox = el<HTMLDivElement>('skipped');
const errorBox = el<HTMLDivElement>('error');
const btnTraceAll = el<HTMLButtonElement>('btnTraceAll');
const unknownBlock = el<HTMLDivElement>('unknownBlock');
const unknownInfo = el<HTMLDivElement>('unknownInfo');
const unknownHint = el<HTMLDivElement>('unknownHint');
const btnSkipUnknown = el<HTMLButtonElement>('btnSkipUnknown');

let traceAll = false;
/** 当前等待处理的未知指令（= 渲染窗上报的 pendingUnknown；null 表示没有）。 */
let pending: ControlStatus['pendingUnknown'] | null = null;

function updateTraceBtn(): void {
  btnTraceAll.textContent = `启用指令日志：${traceAll ? '开（全量）' : '关（仅未知）'}`;
  btnTraceAll.classList.toggle('on', traceAll);
}

function renderIgnored(ignored: { opcode: number; name: string }[]): void {
  ignoredCountEl.textContent = `(${ignored.length} 个)`;
  ignoredBox.textContent = '';
  if (ignored.length === 0) {
    ignoredBox.textContent = '（暂无已忽略指令）';
    return;
  }
  // 只显示助记符（name 已是语义名或 iXXX 数值），不再额外打印 opcode 数字。
  for (const it of ignored) {
    const d = document.createElement('div');
    d.textContent = it.name;
    ignoredBox.appendChild(d);
  }
}

/** 已跳过的未知指令（用户在按钮上点过、已登记为 no-op 桩）。 */
function renderSkipped(list: ControlStatus['skipped'] | undefined): void {
  const items = list ?? [];
  skippedCountEl.textContent = `(${items.length} 个)`;
  skippedBox.textContent = '';
  if (items.length === 0) {
    skippedBox.textContent = '（暂无已跳过指令）';
    return;
  }
  for (const it of items) {
    const d = document.createElement('div');
    d.textContent = `0x${it.opcode.toString(16)} ${it.name} ×${it.count}`;
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

btnTraceAll.addEventListener('click', () => {
  traceAll = !traceAll;
  window.api.controlSetTraceAll(traceAll);
  updateTraceBtn();
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
  renderIgnored(s.ignored ?? []);
  renderSkipped(s.skipped);
  pending = s.pendingUnknown ?? null;
  renderUnknown();
  renderError(s.error);
});

updateTraceBtn();
renderIgnored([]);
renderSkipped([]);
renderUnknown();
renderError(undefined);
