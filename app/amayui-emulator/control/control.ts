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

/**
 * 指令码的规范写法（**所有清单行都以它开头**）。
 *
 * ★为什么必须带 opcode：助记符在缺名时是 `i0b5` 这种"i + 三位十六进制"，极易与
 * 别的 opcode 混读 —— 2026-09 用户实测就把 `0x0B5`（`i0b5`，DsPlaySound 音轨）看成了
 * `0x05B`（`ne`，已实现），于是以为"已实现的指令被当成缺口"。带上 `0x0b5` 后不可能再混。
 */
function opHex(opcode: number): string {
  return `0x${opcode.toString(16).padStart(3, '0')}`;
}

const ignoredView = new ListView<ControlStatus['ignored'][number]>({
  elements: lists.ignored,
  unit: '个',
  emptyText: '（暂无：被忽略的指令都收到了实参 → 见上面的「能力缺口」）',
  // 行首列指令码（见 opHex 的说明），随后是助记符（语义名或 iXXX 数值）。
  rowOf: (it) => ({ text: `${opHex(it.opcode)} ${it.name}` }),
});

/** 已跳过的未知指令（用户在按钮上点过、已登记为 no-op 桩）。只显示助记符 + 执行次数。 */
const skippedView = new ListView<ControlStatus['skipped'][number]>({
  elements: lists.skipped,
  unit: '个',
  emptyText: '（暂无：已跳过且未收到实参的指令）',
  rowOf: (it) => ({ text: `${opHex(it.opcode)} ${it.name} ×${it.count}` }),
});

/**
 * ★闸门 B 清单：**能力缺口** —— 这条指令被当作 no-op 跳过，但脚本给它传了**非平凡实参**，
 * 即"脚本真的想做点什么，而我没做"。
 *
 * ★它是「被跳过」集合里**唯一**会列出这些指令的地方：`真·忽略`/`已跳过指令` 两栏已把
 * 进过本表的 opcode 排除掉（否则同一条会在面板上出现两遍）。因此行首标注来源 `[忽略]`/
 * `[已跳过]`，信息不丢。样例操作数只放在 title 与复制文本里（避免刷屏）。
 */
const gapsView = new ListView<NonNullable<ControlStatus['gaps']>[number]>({
  elements: lists.gaps,
  unit: '种',
  emptyText: '（暂无：被跳过的指令都没有收到实参）',
  rowOf: (it) => ({
    text: `${it.source === 'skipped' ? '[已跳过]' : '[忽略]'} ${opHex(it.opcode)} ${it.name} ×${it.count}`,
    title: `最近实参：${it.sample.join(' ')}`,
    copy: `${opHex(it.opcode)} ${it.name} ×${it.count}｜${it.sample.join(' ')}`,
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

// ---- 调试台（`tickets/T-0114`）：输入指令 → 生效（lldb 风格）----
//
// 为什么改成"输入指令"而不是点按钮：T-0102 排查里要反复问"某个量现在是多少 / 谁改的它"，
// 按钮式 UI 每个新问题都要加控件；命令台只要一条输入框，且与 lldb/gdb 的手感一致。
//
// 通路：命令行 →（本题在**面板侧**解析，纯字符串）→
//   · 断点类动作 → `controlBreakCommand` → 主 → 渲染窗；
//   · 其它一律当**查询** → `debugQuery`（invoke，要回答案）。
// 状态来源：断点表与"已暂停"由渲染窗**推送**（`onBreakList` / `onBreakPaused`），面板不存副本。
type BreakRow = { id: number; kind: string; where?: string; condition: string; hits: number };
type BreakPaused = { id: number; where: string; detail?: string } | null;
let breakRows: BreakRow[] = [];
let breakPaused: BreakPaused = null;
let replSeq = 0;
/** 控制台转录（保留最近 N 行，避免无限增长）。 */
const transcript: string[] = [];
const TRANSCRIPT_MAX = 400;

function pushTranscript(line: string): void {
  transcript.push(line);
  while (transcript.length > TRANSCRIPT_MAX) transcript.shift();
  ui.replOut.textContent = transcript.join('\n');
  ui.replOut.scrollTop = ui.replOut.scrollHeight;
}

function renderState(): void {
  if (breakPaused) {
    ui.replState.textContent = `⏸ 暂停在断点 #${breakPaused.id} @ ${breakPaused.where}${breakPaused.detail ? `（${breakPaused.detail}）` : ''} —— 输入 c 继续，或直接查询`;
  } else {
    ui.replState.textContent = breakRows.length ? `断点 ${breakRows.length} 条` : '';
  }
}

function renderBreaks(lines: string[]): void {
  lines.push(breakRows.length ? `断点 ${breakRows.length} 条：` : '（断点表为空）');
  for (const b of breakRows) {
    lines.push(`  #${b.id} ${b.kind === 'step' ? '条件断点' : `事件断点(${b.where})`} ${b.condition || '(无条件)'}  命中 ${b.hits}`);
  }
}

/** 执行一行命令（解析在面板侧 —— 纯字符串，不需要引擎）。 */
async function runRepl(raw: string): Promise<void> {
  const line = raw.trim();
  if (line === '') return;
  pushTranscript(`> ${line}`);

  // 面板侧的命令表（与 `src/vm/debugBreak.ts` 的 `parseDebugCommand` 同形）；
  // ★为什么不 import 渲染窗的模块：控制窗与渲染窗是**两个编译单元**，
  //   跨单元 import 会把后者的类型/依赖拖进来（`ipcProtocol.ts` 的 `recordScript` 注释记过同类事故）。
  const parts = line.split(/\s+/);
  const cmd = parts[0]!.toLowerCase();
  const rest = parts.slice(1);

  if (cmd === '?' || cmd === 'help') {
    pushTranscript(
      [
        'b <条件>              条件断点：每条指令**执行前**求一次条件，满足即停',
        '                      例：b global 0x11 == 5260 ／ b（= 每条都停）',
        'b event <类型> <条件>  语义事件断点（改状态那一刻停）',
        '                      类型：global-write / slot-bind',
        '                      例：b event global-write idx == 0',
        'bl                    列断点（含命中次数）',
        'd [id]                删一条；省略 id = 全删',
        'c                     继续（从当前指令走过去）',
        '其它                  当查询：global 0 ／ local 1 ／ frame ／ slot 0x11 ／ run',
        '★数字口径：0x… = 十六进制；含 a-f 的串 = 十六进制；纯数字 = 十进制',
      ].join('\n'),
    );
    return;
  }
  if (cmd === 'c' || cmd === 'cont' || cmd === 'continue') {
    window.api.controlBreakCommand({ kind: 'continue' });
    pushTranscript('（已请求继续）');
    return;
  }
  if (cmd === 'bl' || cmd === 'breakpoints') {
    const lines: string[] = [];
    renderBreaks(lines);
    pushTranscript(lines.join('\n'));
    return;
  }
  if (cmd === 'd' || cmd === 'delete') {
    const id = rest[0] === undefined ? undefined : Number.parseInt(rest[0], 10);
    if (rest[0] !== undefined && !Number.isInteger(id)) {
      pushTranscript(`✗ delete：id 必须是整数（收到「${rest[0]}」）`);
      return;
    }
    window.api.controlBreakCommand(id === undefined ? { kind: 'clear' } : { kind: 'clear', id });
    return;
  }
  if (cmd === 'b' || cmd === 'break') {
    if (rest[0]?.toLowerCase() === 'event') {
      // ★**不在面板侧校验类型**：渲染窗的 `debugBreak.ts` 才是真相源（`EVENT_KINDS`）。
      //   面板曾硬编码一份列表，结果渲染窗加了 `global-float-write` 之后面板还在拒 —— 用户实测踩到。
      //   教训：跨编译单元**复制**一份"合法值清单"，守卫（测的是渲染窗那份）**钉不住**它。
      //   现在一律透传，由渲染窗解析并回一条可读错误（错误会经 `onBreakList.error` 显示在转录区）。
      window.api.controlBreakCommand({
        kind: 'set',
        breakKind: 'event',
        where: (rest[1] ?? '').toLowerCase(),
        condition: rest.slice(2).join(' '),
      });
      return;
    }
    window.api.controlBreakCommand({ kind: 'set', breakKind: 'step', condition: rest.join(' ') });
    return;
  }

  // 其它一律当查询（invoke：要回答案）
  ui.btnReplRun.disabled = true;
  try {
    const r = (await window.api.debugQuery({ id: ++replSeq, text: line })) as {
      ok?: boolean;
      lines?: unknown;
    } | null;
    const body = Array.isArray(r?.lines) ? (r!.lines as unknown[]).map((l) => String(l)).join('\n') : '（无结果）';
    pushTranscript(r?.ok === false ? `✗\n${body}` : body);
  } catch (err) {
    pushTranscript(`✗ 查询通道出错：${(err as Error).message}`);
  } finally {
    ui.btnReplRun.disabled = false;
  }
}

ui.btnReplRun.addEventListener('click', () => {
  const v = ui.replInput.value;
  ui.replInput.value = '';
  void runRepl(v);
});
ui.replInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const v = ui.replInput.value;
    ui.replInput.value = '';
    void runRepl(v);
  }
});
ui.btnReplHelp.addEventListener('click', () => void runRepl('?'));
ui.btnReplCopy.addEventListener('click', () => {
  const text = transcript.join('\n');
  const done = (): void => {
    ui.btnReplCopy.textContent = '已复制';
    window.setTimeout(() => {
      ui.btnReplCopy.textContent = '复制全部';
    }, 1200);
  };
  void navigator.clipboard.writeText(text).then(done, () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      done();
    } catch {
      ui.btnReplCopy.textContent = '复制失败';
    }
    document.body.removeChild(ta);
  });
});
window.api.onBreakList((raw: unknown) => {
  const p = raw as { list?: BreakRow[]; paused?: BreakPaused; error?: string };
  breakRows = p.list ?? [];
  breakPaused = p.paused ?? null;
  renderState();
  if (p.error) pushTranscript(`✗ ${p.error}`);
});
window.api.onBreakPaused((raw: unknown) => {
  const q = raw as { id: number; where: string; detail?: string };
  breakPaused = { id: q.id, where: q.where, ...(q.detail ? { detail: q.detail } : {}) };
  renderState();
  pushTranscript(`⏸ 断点 #${q.id} 命中 @ ${q.where}${q.detail ? `（${q.detail}）` : ''} —— 输入 c 继续`);
});

window.api.onControlStatus((s) => {
  ui.bin.textContent = s.bin || '…';
  traceAll = !!s.traceAll;
  updateTraceBtn();
  if (document.activeElement !== ui.traceFilter && s.traceFilter) {
    ui.traceFilter.value = s.traceFilter.join(','); // 渲染窗回读（正在输入时不同步，免得打断打字）
  }
  ignoredView.set(s.ignored);
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
skippedView.set([]);
gapsView.set([]);
droppedView.set([]);
renderPerf(undefined);
renderUnknown();
renderError(undefined);
