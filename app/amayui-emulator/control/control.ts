/**
 * 控制窗（ControlWindow）逻辑——独立小窗，提供重启 / 指令日志开关 / 状态展示。
 * 通过 preload 暴露的 IPC 与主进程、主渲染窗交互（见 electron/preload.ts 与 main.ts）。
 *   - 重启：`controlRestart()` → 主进程 reload 主窗口渲染器（重跑完整 boot）。
 *   - 指令日志开关：`controlSetTraceAll(enabled)` → 主进程转发到渲染窗（onTraceAll）。
 *   - 状态展示：收听 `onControlStatus`（渲染窗上报的 { bin, ignored, traceAll }）。
 */
declare global {
  interface Window {
    api: {
      controlRestart(): void;
      controlSetTraceAll(enabled: boolean): void;
      onControlStatus(cb: (s: { bin: string; ignored: { opcode: number; name: string }[]; traceAll: boolean; error?: string }) => void): void;
    };
  }
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const binEl = el<HTMLSpanElement>('bin');
const ignoredCountEl = el<HTMLSpanElement>('ignoredCount');
const ignoredBox = el<HTMLDivElement>('ignored');
const errorBox = el<HTMLDivElement>('error');
const btnTraceAll = el<HTMLButtonElement>('btnTraceAll');

let traceAll = false;

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

window.api.onControlStatus((s) => {
  binEl.textContent = s.bin || '…';
  traceAll = !!s.traceAll;
  updateTraceBtn();
  renderIgnored(s.ignored ?? []);
  renderError(s.error);
});

updateTraceBtn();
renderIgnored([]);
renderError(undefined);
