/**
 * 控制窗（ControlWindow）逻辑——独立小窗，提供重启 / 指令日志开关 / 未知指令桩跳过 / 状态展示。
 *
 * 通过 preload 暴露的 IPC 与主进程、主渲染窗交互（契约见 `src/renderer/ipcProtocol.ts`）：
 *   - 重启：`controlRestart()` → 主进程 reload 主窗口渲染器（重跑完整 boot）。
 *   - 指令日志开关：`controlSetTraceAll(enabled)` → 主进程转发到渲染窗（onTraceAll）。
 *   - **未知指令桩跳过**：渲染器遇「未实现 opcode」会停下来并上报 pendingUnknown；本窗显示该指令 +
 *     「作为桩函数跳过」按钮，点击 → `controlSkipOp(opcode)` → 主进程转发 → 渲染窗登记 no-op 桩
 *     （`Engine.unknownOpStubs`）并从**同一条指令**重试继续。
 *   - 状态展示：收听 `onControlStatus`（渲染窗上报的 `ControlStatus`）。
 *
 * 拆分：DOM 句柄见 `./dom.ts`，清单渲染见 `./listView.ts`，剪贴板见 `./clipboard.ts`；
 * 本文件只保留"状态 + 接线"，不再重复五行渲染逻辑。
 */
import type { ControlStatus } from '../src/renderer/ipcProtocol.js';
import { lists, ui } from './dom.js';
import { ListView } from './listView.js';

let traceAll = false;
/** 当前等待处理的未知指令（= 渲染窗上报的 pendingUnknown；null 表示没有）。 */
let pending: ControlStatus['pendingUnknown'] | null = null;

/** 把输入框里的 opcode 列表解析成 number[]（接受 `1fb` / `0x1fb`，逗号或空格分隔）。 */
function parseOpList(s: string): number[] {
  return s
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => Number(x.toLowerCase().startsWith('0x') ? x : `0x${x}`))
    .filter((n) => Number.isFinite(n) && n >= 0);
}

// ---- 五张清单（渲染格式只有这一处；复制文本与显示文本同源）----

const ignoredView = new ListView<ControlStatus['ignored'][number]>({
  elements: lists.ignored,
  unit: '个',
  emptyText: '（暂无）',
  // 只显示助记符（name 已是语义名或 iXXX 数值），不列指令码数值。
  rowOf: (it) => ({ text: it.name }),
});

/** 已插桩但有专门处理（消息窗/声音/数组排序/字段写入…）：按引擎语义执行，只是不产出可渲染输出。 */
const internalView = new ListView<ControlStatus['internal'][number]>({
  elements: lists.internal,
  unit: '个',
  emptyText: '（暂无）',
  rowOf: (it) => ({ text: it.name }),
});

/** 已跳过的未知指令（用户在按钮上点过、已登记为 no-op 桩）。只显示助记符 + 执行次数。 */
const skippedView = new ListView<ControlStatus['skipped'][number]>({
  elements: lists.skipped,
  unit: '个',
  emptyText: '（暂无已跳过指令）',
  rowOf: (it) => ({ text: `${it.name} ×${it.count}` }),
});

/**
 * ★闸门 B 清单：**能力缺口** —— 这条指令被当作 no-op 跳过，但脚本给它传了**非平凡实参**，
 * 即"脚本真的想做点什么，而我没做"。样例操作数只放在 title 与复制文本里（避免刷屏）。
 */
const gapsView = new ListView<NonNullable<ControlStatus['gaps']>[number]>({
  elements: lists.gaps,
  unit: '种',
  emptyText: '（暂无：被忽略的指令都没有收到实参）',
  rowOf: (it) => ({
    text: `${it.name} ×${it.count}`,
    title: `最近实参：${it.sample.join(' ')}`,
    copy: `${it.name} ×${it.count}｜${it.sample.join(' ')}`,
  }),
});

/**
 * ★闸门 A 清单：**意图被丢弃** —— 脚本调用了一个宿主没实现的 native 方法（`?.` 静默 no-op）。
 * 每条显示：方法名 ×次数、触发它的 opcode、以及"缺了它会有什么无报错的表现"。
 */
const droppedView = new ListView<NonNullable<ControlStatus['dropped']>[number]>({
  elements: lists.dropped,
  unit: '种',
  emptyText: '（暂无：宿主没有丢弃任何 native 意图）',
  rowOf: (it) => ({
    text: `${it.method} ×${it.count} ← ${it.opcodes.join(',')}｜${it.why}`,
    title: `最近实参：${it.sample}`,
  }),
});

// ---- 小视图 ----

/** 同步"启用指令日志"按钮的文案与高亮。 */
function updateTraceBtn(): void {
  ui.btnTraceAll.textContent = `启用指令日志：${traceAll ? '开（全量）' : '关（仅未知）'}`;
  ui.btnTraceAll.classList.toggle('on', traceAll);
}

/**
 * 「未知指令」块：有 pendingUnknown 才显示（按钮 = 把该指令当无副作用桩函数跳过并继续执行）；
 * 没有则整块隐藏（包括按钮），避免误点。
 */
function renderUnknown(): void {
  const p = pending;
  if (!p) {
    ui.unknownBlock.hidden = true;
    ui.btnSkipUnknown.disabled = false;
    ui.btnSkipUnknown.textContent = '作为桩函数跳过并继续';
    return;
  }
  ui.unknownBlock.hidden = false;
  ui.unknownInfo.textContent = `0x${p.opcode.toString(16)} ${p.name} @ ${p.script} ip=${p.instrIndex} (0x${p.byteOffset.toString(16)})`;
  ui.unknownHint.textContent = `点击后按无副作用 no-op 桩跳过这条指令，并从同一条指令处继续执行（不读操作数、不改写 VM 状态）`;
  ui.btnSkipUnknown.disabled = false;
  ui.btnSkipUnknown.textContent = `作为桩函数跳过：0x${p.opcode.toString(16)} ${p.name}`;
}

/**
 * ★性能/门控遥测 —— 回答"到底是慢还是坏"：
 *  - `指令/秒` 明显偏低（正常 30–60 万）⇒ 有东西在拖 VM（历史上是逐条 JSONL 的 IPC 洪泛）；
 *  - `门` 长时间不变 ⇒ **卡住**（`0x400` 动画等待 / `sleep` / `paused` 未知指令待跳过），不是慢；
 *  - `JSONL` 猛涨 ⇒ 定向 trace 开着且命中过多（会拖慢主进程写盘）。
 */
function renderPerf(p: ControlStatus['perf']): void {
  if (!p) {
    ui.perf.textContent = '…';
    return;
  }
  const gate = p.gate ? `门=${p.gate}(${(p.gateMs / 1000).toFixed(1)}s)` : '门=无';
  ui.perf.textContent =
    `${p.stepsPerSec.toLocaleString()} 指令/秒  ${gate}  帧=${p.frames}` +
    (p.jsonlLines > 0 ? `  JSONL=${p.jsonlLines.toLocaleString()} 行` : '');
  const stuck = p.gate !== '' && p.gateMs > 3000;
  ui.perf.style.color = stuck ? '#ff9d5c' : '#7cfc00';
  ui.perf.title = stuck ? '门控持续 >3s：如果画面也没动，就是卡住（不是慢）' : '';
}

function renderError(msg?: string): void {
  if (msg) {
    ui.error.textContent = `⚠️ ${msg}`;
    ui.error.classList.add('show');
  } else {
    ui.error.textContent = '';
    ui.error.classList.remove('show');
  }
}

// ---- 接线 ----

ui.btnRestart.addEventListener('click', () => {
  window.api.controlRestart();
});

ui.btnForceClose.addEventListener('click', () => {
  // 主进程侧销毁窗口并退出：即使渲染窗被高频 IPC / 长指令批拖住也能收场。
  window.api.controlForceClose();
});

ui.btnTraceAll.addEventListener('click', () => {
  traceAll = !traceAll;
  window.api.controlSetTraceAll(traceAll);
  updateTraceBtn();
});

// 定向 trace：把白名单发给渲染窗（空 = 全部）。渲染窗把它写成 .tmp/scene-trace.jsonl。
ui.btnTraceApply.addEventListener('click', () => {
  const ops = parseOpList(ui.traceFilter.value);
  window.api.controlSetTraceFilter(ops);
  ui.btnTraceApply.textContent = ops.length ? `已应用 ${ops.length} 条` : '已清空（记全部）';
  window.setTimeout(() => {
    ui.btnTraceApply.textContent = '应用';
  }, 1500);
});

ui.btnSkipUnknown.addEventListener('click', () => {
  if (!pending) return;
  // 防重复点击：下一次状态上报会带回 pendingUnknown=undefined，届时按钮恢复可用。
  ui.btnSkipUnknown.disabled = true;
  ui.btnSkipUnknown.textContent = '已请求跳过，等待渲染窗…';
  window.api.controlSkipOp(pending.opcode);
});

window.api.onControlStatus((s) => {
  ui.bin.textContent = s.bin || '…';
  traceAll = !!s.traceAll;
  updateTraceBtn();
  if (document.activeElement !== ui.traceFilter && s.traceFilter) {
    ui.traceFilter.value = s.traceFilter.join(','); // 渲染窗回读（正在输入时不同步，免得打断打字）
  }
  ignoredView.set(s.ignored);
  internalView.set(s.internal);
  skippedView.set(s.skipped);
  gapsView.set(s.gaps);
  droppedView.set(s.dropped);
  renderPerf(s.perf);
  pending = s.pendingUnknown ?? null;
  renderUnknown();
  renderError(s.error);
});

// 初始态（渲染窗还没上报时也要有画面）。
updateTraceBtn();
ignoredView.set([]);
internalView.set([]);
skippedView.set([]);
gapsView.set([]);
droppedView.set([]);
renderPerf(undefined);
renderUnknown();
renderError(undefined);
