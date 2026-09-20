/**
 * **ADV/场景的 VM 侧状态快照**（`tickets/T-0063`）—— 读档时"画面之外"那些也会丢的东西。
 *
 * 为什么需要：读档把帧按 scriptId 装回**入口**再走栈到存档落点 ⇒ 入口到落点之间的初始化会重跑，
 * 但**存档时已有的**那批状态不会自己回来，而 `loadSlotIntoEngine` 为了清掉旧 UI 还会 `routes.reset()` /
 * `msgwin.reset()` ⇒ 2026-09 用户实测的四条症状都指向这里：
 *  - **侧边栏 hover 不展开**：热点区（`RoutePanel.entries`）没了；
 *  - **ADV 窗的遮罩 / 窗口态**不对：`MsgWindow` 的标量态（`showing`/`flags`/`skipMode`…）与文本项账本没了；
 *  - **背景不再移动**：阶梯动画时间表（`StageLoop` 的 `entries/cursor/index/t0`…）没了；
 *  - 一些开关位（`engineValues` 里的面板/淡入标志）被复位。
 *
 * 引擎那边这些状态是**读档流程自己搬回去**的（`sub_410160` 的装载段搬 `Engine+84088` 的 40 B 窗口态、
 * 复位两张面板、`sub_45F1B0` 额外块…）⇒ emulator 用"存一份、读档装回"达到同一效果。
 *
 * 只搬**纯数据**（数字/字符串/数组）；Map 类容器（`routes` 的 entries、`textItems.records`、
 * `textItems.pages`、`stage.entries` 都是数组 ✓）逐条拷。
 * ★`T-0095` 补：回看页索引表 + 双游标（`textItems.pages`/`cursor`/`baseCursor`）也走这里 ——
 * 引擎侧它们的持久化载体是 `SaveTextBuf.dat`（与 72B 记录表同一个缓冲区，raw 69553）。
 */
import type { Engine } from './engine.js';
import type { RouteEntry } from './route.js';
import type { BacklogPage, TextItemRecord } from './textItems.js';
import type { StageEntry } from './stageLoop.js';

/** 阶梯动画时间表（`StageLoop` 的可搬子集）。 */
export interface StageStateJson {
  entries: StageEntry[];
  cursor: number;
  index: number;
  t0: number;
  exitLabel: number;
  cur: number;
  scriptId: number;
  resumeDword: number;
}

/**
 * 回看页索引表 + 双游标（`T-0095`）。
 *
 * 引擎里这张表**是持久化的**：`SaveTextBuf.dat` 的缓冲区首 dword = 页条数、随后 8 B/条
 * （写 `sub_457CE0` raw 69553/69572；读 `sub_45F1B0` 先清两表 raw 74482、再逐条 push raw 74490-74494），
 * 缓冲区大小 = `44*记录条数 + 8*页条数`（raw 69553）⇒ 记录表与页表**同进同出**。
 * emulator 不写 `SaveTextBuf.dat`，用本快照承担同一角色（与 `textItems` 的 72B 记录表并列）。
 */
export interface BacklogStateJson {
  pages: BacklogPage[];
  /** `Font[860]`（`Font+3440`）：当前读游标。 */
  cursor: number;
  /** `Font[859]`（`Font+3436`）：push 时刻的末项下标。 */
  baseCursor: number;
}

/** ADV/场景的 VM 侧状态。 */
export interface AdvStateJson {
  /** `engineValues`（引擎字段表）里除"读档流程自己用"的几格之外的全部。 */
  fields?: [number, number][];
  routes?: RouteEntry[];
  /** `MsgWindow` 的标量字段（数字；Map 类容器不进这里）。 */
  msgwin?: Record<string, number>;
  textItems?: TextItemRecord[];
  /**
   * 回看页索引表 + 双游标。★**可选**：`T-0095` 之前存的档没有这一格
   * （装载时按"引擎读档会把表读成空"处理 —— 那也确实是旧档的等价语义，因为旧引擎侧没有模型）。
   */
  backlog?: BacklogStateJson;
  stage?: StageStateJson;
}

/** 读档流程自己占用的字段：**不进快照、也不被快照覆盖**（否则会和装载流程打架）。 */
const LOAD_FLOW_FIELDS = new Set<number>([95776, 95777, 95780, 97054]); // cur/callRet/读档门/读档收尾标志

export function snapshotAdvState(e: Engine): AdvStateJson {
  const fields: [number, number][] = [];
  for (const [k, v] of e.engineValues) if (!LOAD_FLOW_FIELDS.has(k) && typeof v === 'number') fields.push([k, v]);
  const msgwin: Record<string, number> = {};
  for (const [k, v] of Object.entries(e.msgwin)) if (typeof v === 'number') msgwin[k] = v;
  const st = e.stage;
  return {
    fields,
    routes: e.routes.entries.map((r) => ({ ...r })),
    msgwin,
    textItems: e.textItems.records.map((r) => ({ ...r })),
    backlog: {
      pages: e.textItems.pages.map((p) => ({ ...p })),
      cursor: e.textItems.cursor,
      baseCursor: e.textItems.baseCursor,
    },
    stage: {
      entries: st.entries.map((x) => ({ ...x })),
      cursor: st.cursor,
      index: st.index,
      t0: st.t0,
      exitLabel: st.exitLabel,
      cur: st.cur,
      scriptId: st.scriptId,
      resumeDword: st.resumeDword,
    },
  };
}

/** 装回（调用方已先做过 `routes.reset()`/`msgwin.reset()` —— 这里把**存档时**那份装回去）。 */
export function restoreAdvState(e: Engine, s: AdvStateJson): void {
  if (s.fields) for (const [k, v] of s.fields) e.engineValues.set(k, v);
  if (s.routes) {
    e.routes.entries.length = 0;
    for (const r of s.routes) e.routes.entries.push({ ...r });
  }
  if (s.msgwin) {
    for (const [k, v] of Object.entries(s.msgwin)) {
      (e.msgwin as unknown as Record<string, unknown>)[k] = v;
    }
  }
  if (s.textItems) {
    e.textItems.records.length = 0;
    for (const r of s.textItems) e.textItems.records.push({ ...r });
  }
  if (s.backlog) {
    e.textItems.pages.length = 0;
    for (const p of s.backlog.pages) e.textItems.pages.push({ ...p });
    e.textItems.cursor = s.backlog.cursor;
    e.textItems.baseCursor = s.backlog.baseCursor;
  }
  if (s.stage) {
    const st = e.stage;
    st.entries.length = 0;
    for (const x of s.stage.entries) st.entries.push({ ...x });
    st.cursor = s.stage.cursor;
    st.index = s.stage.index;
    st.t0 = s.stage.t0;
    st.exitLabel = s.stage.exitLabel;
    st.cur = s.stage.cur;
    st.scriptId = s.stage.scriptId;
    st.resumeDword = s.stage.resumeDword;
  }
}
